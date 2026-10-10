// durig v2 offline demo: proves the org-edge + capability gate.
//
// Scenario A (refusal): a THIRD seat "intruder" (no edge granting it access)
// tries send_work -> worker. Must throw inside the commit; the tool catches
// and reports SEND_WORK_ERROR.
// Scenario B (pass): pm -> worker with requires:"implement" succeeds.
// All offline via faux models; the driver exercises tools directly through
// conversation submissions, scripting responses in global call order.
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
	fauxAssistantMessage,
	fauxProvider,
	fauxText,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
	configure,
	createRegistry,
	Harness,
	MemoryStorage,
} from "@earendil-works/pi-durable";
import {
	Constitution,
	Edges,
	RigQueue,
	Router,
	Seats,
	compilePersona,
	registerSeat,
} from "../src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);

await harness.commit(async (tx) => {
	const mk = async (name, role) => {
		const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
		await configure(tx, c.id, {
			model: { provider: "faux", modelId: "faux-seat" },
			instructions: compilePersona({ role }),
		});
		await registerSeat(tx, name, c.id, role);
		return c.id;
	};
	const pmId = await mk("pm", "program manager");
	const wkId = await mk("worker", "implementation engineer");
	await mk("intruder", "unaffiliated agent");
	const ed = await tx.doc(Edges);
	ed.edges = [
		{ from: "pm", maySendTo: ["worker"] },
	];
	const seatsDoc = await tx.doc(Seats);
	seatsDoc.seats.worker.capabilities = ["implement"];
	const cd = await tx.doc(Constitution);
	cd.text = "# constitution\nP1 Grounding.";
	console.log("BOOTSTRAP ids:", pmId, wkId);
}, ctx);

const roster = (await harness.documentState(Seats, undefined, ctx)).value.seats;
const intruderConv = await harness.conversation(roster.intruder.conversationId, ctx);
const pmConv = await harness.conversation(roster.pm.conversationId, ctx);

// Scenario A: intruder attempts an edge-forbidden send.
faux.setResponses([
	fauxAssistantMessage(
		[fauxToolCall("send_work", { to: "worker", subject: "sneaky", body: "b" })],
		{ stopReason: "toolUse" },
	),
	fauxAssistantMessage(fauxText("intruder done")),
]);
await (await intruderConv.submit({ type: "input", content: "go" }, ctx)).wait(ctx);

// Scenario B: pm sends with a capability requirement.
faux.appendResponses([
	fauxAssistantMessage(
		[fauxToolCall("send_work", {
			to: "worker",
			subject: "legit",
			body: "b",
			requires: "implement",
		})],
		{ stopReason: "toolUse" },
	),
	fauxAssistantMessage(fauxText("pm done")),
]);
await (await pmConv.submit({ type: "input", content: "route it" }, ctx)).wait(ctx);

const q = (await harness.documentState(RigQueue, undefined, ctx)).value;
console.log("--- evidence ---");
for (const it of q.items) {
	console.log(`QUEUE #${it.id} [${it.status}] ${it.from}->${it.to} :: ${it.subject}`);
}

const assert = (c, m) => { if (!c) { console.error("ASSERT FAIL:", m); process.exit(1); } };
assert(!q.items.some((it) => it.from === "intruder"),
	"intruder's forbidden send must NOT have been enqueued");
assert(q.items.some((it) => it.from === "pm" && it.subject === "legit"),
	"pm's legitimate send must be enqueued");

// Constitution injection proof: the seat's transcript must contain a
// pi.system entry carrying the constitution text.
const pmPg = await pmConv.entries({}, 50, undefined, ctx);
const sysTexts = pmPg.items
	.filter((e) => e.kind === "pi.system")
	.map((e) => JSON.stringify(e.model ?? "") + JSON.stringify(e.content ?? ""));
assert(sysTexts.some((s) => s.includes("P1 Grounding")),
	"constitution text must appear in a seat's system prompt");

console.log("V2 DEMO PASS");
await harness.close(ctx);
