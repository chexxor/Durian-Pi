// durian-pi offline demo: full delegation loop on the durable queue.
//
// Scenario: a "pm" seat sends work to a "worker" seat via send_work; the
// worker claims it, completes it; the DONE notice lands back in pm's queue.
// Models are faux (offline): pm's model calls send_work then finishes; the
// worker's model calls claim_work then complete_work. No network, no keys.
//
// Response scripting note (learned in spike R2): scripted responses drain in
// GLOBAL call order across conversations. Call order here:
//   1) pm turn 1  -> send_work tool call
//   2) pm turn 2  -> final answer (worker has not run yet; work sits queued)
//   3) worker turn 1 -> claim_work tool call
//   4) worker turn 2 -> complete_work tool call
//   5) worker turn 3 -> final answer
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

// Register both seats up-front (driver-side bootstrap; a real rig would do
// this through a CLI command).
await harness.commit(async (tx) => {
	const pm = await tx.createConversation({ ownership: { kind: "ownerless" } });
	const worker = await tx.createConversation({ ownership: { kind: "ownerless" } });
	await configure(tx, pm.id, { model: { provider: "faux", modelId: "faux-seat" } });
	await configure(tx, worker.id, { model: { provider: "faux", modelId: "faux-seat" } });
	await registerSeat(tx, "pm", pm.id, "program manager");
	await registerSeat(tx, "worker", worker.id, "implementation");
}, ctx);

const seatsDoc = await harness.documentState((await import("../src/rig.mjs")).Seats, undefined, ctx);
console.log("seats registered:", JSON.stringify(seatsDoc?.value?.seats ?? seatsDoc));

// Scripted responses in global call order (see header).
faux.setResponses([
	// 1) pm turn 1: delegate to worker
	fauxAssistantMessage([
		fauxText("Routing this to the worker."),
		fauxToolCall("send_work", {
			to: "worker",
			subject: "Implement login fix",
			body: "Fix the flaky login test on staging.",
		}),
	], { stopReason: "toolUse" }),
	// 2) pm turn 2: done for now (work sits queued until worker runs)
	fauxAssistantMessage(fauxText("Work queued for worker.")),
	// 3) worker turn 1: claim it
	fauxAssistantMessage(
		[fauxToolCall("claim_work", {})],
		{ stopReason: "toolUse" },
	),
	// 4) worker turn 2: complete it
	fauxAssistantMessage(
		[fauxToolCall("complete_work", { itemId: 1, resultSummary: "Login test stabilized." })],
		{ stopReason: "toolUse" },
	),
	// 5) worker turn 3: idle
	fauxAssistantMessage(fauxText("Queue clear.")),
]);

const { Seats } = await import("../src/rig.mjs");
const seatsVal = await harness.documentState(Seats, undefined, ctx);
const roster = seatsVal?.value?.seats ?? {};
const pmConv = await harness.conversation(roster.pm.conversationId, ctx);
const workerConv = await harness.conversation(roster.worker.conversationId, ctx);

// PM runs first (calls 1-2), then worker runs (calls 3-5).
const pmRun = await pmConv.submit({ type: "input", content: "Ship the login fix." }, ctx);
await pmRun.wait(ctx);
console.log("-- pm run settled");

const workerRun = await workerConv.submit({ type: "input", content: "Check your queue." }, ctx);
await workerRun.wait(ctx);
console.log("-- worker run settled");

// Dump final queue state as evidence.
const qDoc = await harness.documentState(RigQueue, undefined, ctx);
const q = qDoc?.value ?? {};
for (const it of q.items ?? []) {
	console.log(`QUEUE #${it.id} [${it.status}] ${it.from}->${it.to} :: ${it.subject}${it.resultSummary ? ` :: result=${it.resultSummary}` : ""}`);
}

// Assertions - the demo FAILS loudly if the loop did not close.
const assert = (cond, msg) => { if (!cond) { console.error("ASSERT FAIL:", msg); process.exit(1); } };
const items = q.items ?? [];
assert(items.length === 2, `expected 2 items (work + DONE notice), got ${items.length}`);
assert(items[0].status === "done", `item #1 should be done, got ${items[0].status}`);
assert(items[0].resultSummary === "Login test stabilized.", `unexpected result summary`);
assert(items[1].to === "pm" && items[1].subject.startsWith("DONE #1"), `DONE notice should be addressed back to pm`);

console.log("DEMO PASS");
await harness.close(ctx);
