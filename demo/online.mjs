// durig ONLINE demo: the same pm->worker delegation loop, but with real
// DeepInfra model traffic instead of faux scripting.
//
// Requirements:
//   DEEPINFRA_API_KEY in the environment (ambient; never printed, never
//   persisted by this script).
//
// What it proves beyond the offline demo:
//   - pi-ai's openai-completions stream works against DeepInfra from a bare
//     pi-durable harness (no pi coding-agent host involved).
//   - The rig tools behave identically with a real model deciding to call
//     them (prompt-driven, not scripted).
//
// Model choice: a small/cheap chat model keeps the cost of one run negligible.
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels, createProvider } from "@earendil-works/pi-ai";
import * as openaiCompletions from "@earendil-works/pi-ai/api/openai-completions";
import {
	configure,
	createRegistry,
	Harness,
	MemoryStorage,
} from "@earendil-works/pi-durable";
import { RigQueue, Router, Seats, registerSeat } from "../src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;

const MODEL_ID = process.env.DURIG_MODEL ?? "zai-org/GLM-5.3-Flash";

const deepinfra = createProvider({
	id: "deepinfra",
	name: "DeepInfra",
	baseUrl: "https://api.deepinfra.com/v1/openai",
	auth: {
		apiKey: {
			name: "DeepInfra API key",
			resolve: async ({ ctx: authCtx }) => {
				const key = await authCtx.env("DEEPINFRA_API_KEY");
				if (!key) return undefined;
				return { auth: { apiKey: key }, source: "DEEPINFRA_API_KEY" };
			},
		},
	},
	models: [{
		id: MODEL_ID,
		name: MODEL_ID,
		api: "openai-completions",
		provider: "deepinfra",
		baseUrl: "https://api.deepinfra.com/v1/openai",
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 8_192,
		maxTokensField: "max_tokens",
		supportsStore: false,
		supportsDeveloperRole: false,
		supportsReasoningEffort: true,
	}],
	api: openaiCompletions,
});

const models = createModels({
	authContext: {
		env: async (name) => process.env[name],
		fileExists: async () => false,
	},
});
models.setProvider(deepinfra);

const registry = createRegistry();
registry.install(Router);

const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);

await harness.commit(async (tx) => {
	const pm = await tx.createConversation({ ownership: { kind: "ownerless" } });
	const worker = await tx.createConversation({ ownership: { kind: "ownerless" } });
	await configure(tx, pm.id, {
		model: { provider: "deepinfra", modelId: MODEL_ID },
		instructions:
			"You are the pm seat. Route implementation work to the worker seat " +
			"with send_work. After sending, say ROUTED and stop.",
	});
	await configure(tx, worker.id, {
		model: { provider: "deepinfra", modelId: MODEL_ID },
		instructions:
			"You are the worker seat. Check your queue with claim_work. If you " +
			"receive work, do it minimally (here: just acknowledge), then report " +
			"with complete_work using the item id you claimed. Then say CLEAR.",
	});
	await registerSeat(tx, "pm", pm.id, "program manager");
	await registerSeat(tx, "worker", worker.id, "implementation");
}, ctx);

const roster = (await harness.documentState(Seats, undefined, ctx)).value.seats;
console.log(`seats up; model ${MODEL_ID}`);

const pmConv = await harness.conversation(roster.pm.conversationId, ctx);
const workerConv = await harness.conversation(roster.worker.conversationId, ctx);

console.log("-- pm run (routes work)");
await (await pmConv.submit(
	{ type: "input", content: "Please have the login flakiness investigated." },
	ctx,
)).wait(ctx);

console.log("-- worker run (claims + completes)");
await (await workerConv.submit(
	{ type: "input", content: "Check your queue and handle anything pending." },
	ctx,
)).wait(ctx);

for (const [nm, cv] of [["pm", pmConv], ["worker", workerConv]]) {
	const pg = await cv.entries({}, 50, undefined, ctx);
	console.log(`== ${nm} transcript ==`);
	for (const e of pg.items) {
		const m = e.model?.[0];
		const errMsg = m && m.stopReason === "error" ? ` ERROR=${m.errorMessage}` : "";
		console.log(nm, e.kind, JSON.stringify(m?.content ?? e.content ?? "").slice(0,150), errMsg);
	}
}
const qState = await harness.documentState(RigQueue, undefined, ctx);
console.log("queue state raw:", JSON.stringify(qState)?.slice(0,200));
const q = qState?.value ?? { items: [] };
for (const it of q.items) {
	console.log(`QUEUE #${it.id} [${it.status}] ${it.from}->${it.to} :: ${it.subject}${it.resultSummary ? ` :: result=${it.resultSummary}` : ""}`);
}

const assert = (cond, msg) => { if (!cond) { console.error("ASSERT FAIL:", msg); process.exit(1); } };
const workItem = q.items.find((it) => it.to === "worker");
assert(workItem, "no work item addressed to worker");
assert(workItem.status === "done", `work item should be done after worker run`);
assert(q.items.some((it) => it.to === "pm" && it.subject.startsWith(`DONE #${workItem.id}`)),
	"DONE notice back to pm missing");

console.log("ONLINE DEMO PASS");
await harness.close(ctx);
