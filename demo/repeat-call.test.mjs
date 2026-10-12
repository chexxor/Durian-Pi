// Repeat-call tolerance test: an LLM operator may call claim_work (or
// complete_work) more than once in a turn. The second call must return a
// friendly structured state, not crash with a settled-transaction error.
// Run: node demo/repeat-call.test.mjs  (exit 0 = pass)
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
import { RigQueue, Router, registerSeat } from "../src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);

const registry = createRegistry();
registry.install(Router);

const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);

await harness.commit(async (tx) => {
	const worker = await tx.createConversation({ ownership: { kind: "ownerless" } });
	await configure(tx, worker.id, { model: { provider: "faux", modelId: "faux-seat" } });
	await registerSeat(tx, "worker", worker.id, "implementation");
}, ctx);

// Seed one queued item directly so claim_work has something to claim.
await harness.commit(async (tx) => {
	const { enqueueItem } = await import("../src/rig.mjs");
	await enqueueItem(tx, "someone", "worker", "Do the thing", "Body of the thing.");
}, ctx);

// Worker turn 1 calls claim_work TWICE in the same turn (the failure shape
// from the roadmap: second call hit a settled overlay/transaction).
faux.setResponses([
	fauxAssistantMessage(
		[fauxToolCall("claim_work", {}), fauxToolCall("claim_work", {})],
		{ stopReason: "toolUse" },
	),
	fauxAssistantMessage(fauxText("done looking")),
]);

const seatsDoc = await harness.documentState((await import("../src/rig.mjs")).Seats, undefined, ctx);
const roster = seatsDoc?.value?.seats ?? {};
const workerConv = await harness.conversation(roster.worker.conversationId, ctx);

const run = await workerConv.submit({ type: "input", content: "Check your queue." }, ctx);
await run.wait(ctx);

const qDoc = await harness.documentState(RigQueue, undefined, ctx);
const q = qDoc?.value ?? {};
for (const it of q.items ?? []) {
	console.log(`QUEUE #${it.id} [${it.status}] ${it.from}->${it.to} :: ${it.subject}`);
}

// The run must settle without an unhandled error, and the item must be
// claimed exactly once.
const assert = (cond, msg) => { if (!cond) { console.error("ASSERT FAIL:", msg); process.exit(1); } };

// Inspect the tool results in the worker's transcript: BOTH claim_work calls
// must have produced friendly outputs (the first the item, the second
// NO_QUEUED_WORK), and neither may carry a settled/error marker.
const pg = await workerConv.entries({}, 50, undefined, ctx);
const toolTexts = [];
for (const e of pg.items) {
	const s = JSON.stringify(e);
	if (s.includes("toolResult") || s.includes("tool_result") || s.includes("toolUse")) {
		toolTexts.push(s);
	}
}
const joined = toolTexts.join("\n");
console.log("--- tool-result entries found:", toolTexts.length);
for (const t of toolTexts) console.log("ENTRY:", t.slice(0, 300));
assert(!joined.includes("settled"), "no tool result may mention a settled transaction");
assert(!joined.includes("SETTLED") && !joined.includes("TRANSACTION_ERROR"), "no transaction error markers allowed");
// A second claim_work in one turn: nothing is QUEUED, but the seat now holds a
// CLAIMED item (it claimed it in the first call). The stalled-claim legal move
// (#118) makes the second call a pure read that REVEALS the seat's oldest
// claimed-by-me item instead of a dead-end NO_QUEUED_WORK — still no crash, no
// double-claim (claimed-events stays 1), no settled/error marker.
assert(joined.includes("STALLED_CLAIM"), "second claim_work must reveal the seat's held claim (stalled-claim legal move)");
assert(!joined.includes("NO_QUEUED_WORK"), "a seat holding a claimed item must not get NO_QUEUED_WORK");
const items = q.items ?? [];
assert(items.length === 1, `expected 1 item, got ${items.length}`);
assert(items[0].status === "claimed", `item should be claimed, got ${items[0].status}`);
console.log("REPEAT-CALL TEST PASS");
process.exit(0);
