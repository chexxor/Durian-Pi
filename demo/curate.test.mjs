// demo/curate.test.mjs — queue curation: revise_work and cancel_work (F36).
//
// The gap: the queue had no way to update an item's description or cancel a stale
// one, so ~40 of 60 active selfdev items were interred work the broker would grind.
// This proves the two verbs and the terminal `cancelled` status:
//   - revise_work edits a QUEUED item (sender or holder), refuses a claimed item,
//     and refuses a non-party;
//   - cancel_work terminates an item for either party, records the reason, and a
//     cancelled item is never claimed and never wakes anyone;
//   - a terminal item is not shown as non-terminal work.
//
// Driven through the real Router tools on a MemoryStorage harness with scripted
// faux responses, so the tool wrappers and commit boundaries are exercised.
// Run: node demo/curate.test.mjs  (exit 0 = pass)
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
	isTerminalItem,
	registerSeat,
} from "../src/rig.mjs";
import { selectWakes } from "../src/driver.mjs";

/* ------------------------- pure: terminality and the wake rule ------------------------- */

assert.equal(isTerminalItem({ status: "done" }), true, "done is terminal");
assert.equal(isTerminalItem({ status: "cancelled" }), true, "cancelled is terminal");
assert.equal(isTerminalItem({ status: "queued" }), false, "queued is not terminal");
assert.equal(isTerminalItem({ status: "claimed" }), false, "claimed is not terminal");
assert.deepEqual(
	selectWakes({
		seats: { worker: { conversationId: 1 } },
		items: [{ to: "worker", status: "cancelled" }],
	}),
	[],
	"a cancelled item never wakes its seat",
);

/* ------------------------------- the tools, end to end ------------------------------- */

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
	await mk("intruder", "unaffiliated agent");
	const ed = await tx.doc(Edges);
	ed.edges = [
		{ from: "pm", maySendTo: ["worker"] },
		{ from: "worker", maySendTo: ["pm"] },
	];
	await enqueueItem(tx, "pm", "worker", "Build the widget", "details"); // #1
	await enqueueItem(tx, "pm", "worker", "Second task", "details"); // #2
	await enqueueItem(tx, "pm", "intruder", "Sneaky task", "details"); // #3
}, ctx);

const roster = (await harness.documentState(Seats, undefined, ctx)).value.seats;
const queueState = async () => (await harness.documentState(RigQueue, undefined, ctx)).value;
const item = async (id) => (await queueState()).items.find((it) => it.id === id);

async function transcript(name) {
	const c = await harness.conversation(roster[name].conversationId, ctx);
	const pg = await c.entries({}, 200, undefined, ctx);
	return pg.items.map((e) => JSON.stringify(e)).join("\n");
}

let firstTurn = true;
async function call(name, toolName, toolArgs) {
	const batch = [
		fauxAssistantMessage([fauxToolCall(toolName, toolArgs)], { stopReason: "toolUse" }),
		fauxAssistantMessage(fauxText("ok")),
	];
	if (firstTurn) {
		faux.setResponses(batch);
		firstTurn = false;
	} else {
		faux.appendResponses(batch);
	}
	const c = await harness.conversation(roster[name].conversationId, ctx);
	await (await c.submit({ type: "input", content: "go" }, ctx)).wait(ctx);
}

// 1. The sender revises a queued item before it is picked up.
await call("pm", "revise_work", { itemId: 1, subject: "Build the widget v2", body: "new details" });
assert.equal((await item(1)).subject, "Build the widget v2", "revise_work changes the subject");
assert.equal((await item(1)).body, "new details", "and the body");
assert.ok(
	(await item(1)).transitions.some((t) => t.event === "revised"),
	"the revision is on the audit trail",
);

// 2. A non-party cannot revise someone else's routed item.
await call("intruder", "revise_work", { itemId: 1, body: "hijack" });
assert.match(await transcript("intruder"), /not yours to revise/, "a stranger cannot revise the item");
assert.equal((await item(1)).body, "new details", "and the item is unchanged by the attempt");

// 3. A claimed item is being acted on and cannot be revised under the seat.
await call("worker", "claim_work", {});
assert.equal((await item(1)).status, "claimed", "worker claimed the oldest item (#1)");
await call("pm", "revise_work", { itemId: 1, subject: "too late" });
assert.match(await transcript("pm"), /not queued \(status=claimed\)/, "a claimed item refuses revision");
assert.equal((await item(1)).subject, "Build the widget v2", "and keeps its subject");

// 4. Either party may cancel. The holder cancels #2; the sender cancels #3.
await call("worker", "cancel_work", { itemId: 2, reason: "superseded by #1" });
assert.equal((await item(2)).status, "cancelled", "the holder cancels a queued item");
assert.equal((await item(2)).cancelReason, "superseded by #1", "the reason is recorded");
assert.ok(
	(await item(2)).transitions.some((t) => t.event === "cancelled"),
	"the cancellation is on the audit trail",
);
await call("pm", "cancel_work", { itemId: 3, reason: "stale registration" });
assert.equal((await item(3)).status, "cancelled", "the sender cancels a stale routed item");

// 5. A cancelled item is not claimable: the intruder's only item is gone.
await call("intruder", "claim_work", {});
assert.match(await transcript("intruder"), /NO_QUEUED_WORK/, "a cancelled item is never claimed");

// 6. A finished item cannot be cancelled.
await call("worker", "complete_work", { itemId: 1, resultSummary: "built it" });
assert.equal((await item(1)).status, "done", "worker finished #1");
await call("worker", "cancel_work", { itemId: 1, reason: "oops" });
assert.match(await transcript("worker"), /already done/, "cancelling a done item is refused");

// 7. Terminal items are not "non-terminal work": the intruder's only item is
// cancelled, so its own queue view is empty (the worker still holds the DONE
// notice it SENT, which is legitimately its own non-terminal item).
await call("intruder", "peek_queue", {});
assert.match(await transcript("intruder"), /\(empty\)/, "peek_queue hides a cancelled item");

await harness.close(ctx);
console.log("CURATE TEST PASS (revise_work edits unclaimed work; cancel_work terminates it and it never wakes)");
process.exit(0);
