// demo/run.test.mjs — the queue drives itself (ROADMAP 38).
//
// The gap this closes: a queue item addressed to a seat is inert. `send_work`
// only writes a row, so a routed chain dies after one hop unless an external
// actor sends again — the "you have to keep poking it" behaviour. src/driver.mjs
// is the missing clock: it wakes a seat that has queued work and nothing
// advancing it, and `durian-pi run` holds the harness open until the rig is
// quiescent.
//
// Driven through the real Router tools on a real harness with scripted faux
// responses, so the tool wrappers and commit boundaries are exercised rather
// than re-implemented. MemoryStorage: no database, no temp dir.
import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
	fauxAssistantMessage,
	fauxProvider,
	fauxText,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import {
	Edges,
	RigQueue,
	Router,
	Seats,
	compilePersona,
	enqueueItem,
	registerSeat,
} from "../src/rig.mjs";
import { driveOnce, selectWakes } from "../src/driver.mjs";

/* ----------------------------- 1. the selection rule, without a harness */

// Woken: queued work, nothing in flight, no live lease.
assert.deepEqual(
	selectWakes({
		seats: { a: { conversationId: 1 }, b: { conversationId: 2 }, c: { conversationId: 3 } },
		items: [
			{ to: "a", status: "done" },
			{ to: "b", status: "queued" },
			{ to: "c", status: "deferred" },
		],
	}),
	[{ name: "b", conversationId: 2 }],
	"only a seat with QUEUED work is woken; done and deferred items are not work",
);
assert.deepEqual(
	selectWakes({
		seats: { b: { conversationId: 2 } },
		items: [{ to: "b", status: "queued" }],
		pendingConvIds: new Set([2]),
	}),
	[],
	"a seat with a submission already in flight is not woken again",
);
assert.deepEqual(
	selectWakes({
		seats: { b: { conversationId: 2 } },
		items: [{ to: "b", status: "queued" }],
		busySeats: new Set(["b"]),
	}),
	[],
	"a seat holding a live generation lease is already advancing",
);

/* ------------------------------- 2. the driver end to end, no external send */

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
	};
	await mk("pm", "program manager");
	await mk("worker", "implementation engineer");
	const ed = await tx.doc(Edges);
	ed.edges = [
		{ from: "pm", maySendTo: ["worker"] },
		{ from: "worker", maySendTo: ["pm"] },
	];
	// #1 is real work for worker; completing it enqueues DONE #2 to pm, which the
	// driver must then wake pm for — the closure the old code left stranded.
	await enqueueItem(tx, "pm", "worker", "Build the widget", "details");
}, ctx);

const seats = (await harness.documentState(Seats, undefined, ctx)).value.seats;
const queueItems = async () => (await harness.documentState(RigQueue, undefined, ctx)).value.items;
const item = async (id) => (await queueItems()).find((it) => it.id === id);

// worker: claim #1, complete it. pm: claim the DONE #2, acknowledge it.
faux.setResponses([
	fauxAssistantMessage([fauxToolCall("claim_work", {})], { stopReason: "toolUse" }),
	fauxAssistantMessage([fauxToolCall("complete_work", { itemId: 1, resultSummary: "built it" })], { stopReason: "toolUse" }),
	fauxAssistantMessage(fauxText("done")),
	fauxAssistantMessage([fauxToolCall("claim_work", {})], { stopReason: "toolUse" }),
	fauxAssistantMessage([fauxToolCall("complete_work", { itemId: 2, resultSummary: "acknowledged" })], { stopReason: "toolUse" }),
	fauxAssistantMessage(fauxText("ok")),
]);

const pass = async () =>
	driveOnce(harness, {
		seats,
		items: await queueItems(),
		pendingConvIds: new Set(),
		busySeats: new Set(),
		context: ctx,
	});

// No send() to worker anywhere here — the driver alone advances the chain.
assert.equal(await pass(), 1, "pass 1 wakes worker: it has work and nothing advancing it");
await harness.waitForIdle(ctx);
assert.equal((await item(1)).status, "done", "the woken seat did the work without an external send");

assert.equal(await pass(), 1, "pass 2 wakes pm for the DONE notice worker produced (the closure)");
await harness.waitForIdle(ctx);
assert.equal((await item(2)).status, "done", "the sender is woken to close the loop");
assert.ok(
	(await queueItems()).every((it) => it.status === "done" || it.status === "deferred"),
	"the DONE-of-DONE loop does not start: completing a notice enqueues nothing (item 39)",
);

assert.equal(await pass(), 0, "pass 3 wakes no one — that is quiescence, and `run` exits there");

const workerConv = await harness.conversation(seats.worker.conversationId, ctx);
const workerText = (await workerConv.entries({}, 200, undefined, ctx)).items
	.map((e) => JSON.stringify(e))
	.join("\n");
assert.match(workerText, /You have queued work/, "the wake is what the worker was driven by");
assert.match(workerText, /claim_work/, "and the worker acted on it");

await harness.close(ctx);
console.log("RUN TEST PASS (the driver wakes a seat with queued work; the chain completes with no external send)");
process.exit(0);
