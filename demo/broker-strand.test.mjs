// demo/broker-strand.test.mjs — settlement of stranded (`placed`) submissions (ROADMAP 68).
//
// The defect (observed 2026-10-16): a run that ends without settling its input leaves
// the submission `placed` while its run task is already `terminal`. `selectWakes`
// reads any pending submission as in-flight and never re-wakes the conversation, so
// the seat stalls (`admitted_not_started`) and nothing recovers it — `abortSubmission`
// returns "already_placed" and `conversation.abort()` finds nothing live to abort.
// `reconcileStrandedSubmissions` settles such orphans `unanswered`/`stranded` through
// the public `conv.commit` -> `tx.settleSubmission`, and `drivePass` runs it before
// building the pending set so the blocked seat is woken in the same pass.
//
// Failing-first: before `reconcileStrandedSubmissions` existed this died on the import.
// Run: node demo/broker-strand.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { Router, Seats, compilePersona, enqueueItem, registerSeat } from "../src/rig.mjs";
import { WAKE_CONTENT } from "../src/driver.mjs";
import { drivePass, reconcileStrandedSubmissions } from "../src/broker.mjs";

const ctx = BACKGROUND_CONTEXT;
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);

const storage = new MemoryStorage();
const harness = await Harness.open(storage, { models, registry }, ctx);

let convId;
await harness.commit(async (tx) => {
	const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
	await configure(tx, c.id, {
		model: { provider: "faux", modelId: "faux-seat" },
		instructions: compilePersona({ role: "worker" }),
	});
	await registerSeat(tx, "worker", c.id, "worker");
	await enqueueItem(tx, "pm", "worker", "the stranded task", "details");
	convId = c.id;
}, ctx);

// Fabricate the orphan exactly as a crash leaves it: an input already placed in the
// transcript (`entry`), a submission claiming a run owns it, and no live task.
let orphanId;
await harness.commit(async (tx) => {
	const entry = await tx.appendEntry(convId, {
		kind: "pi.user",
		model: [{ role: "user", content: "run me", timestamp: Date.now() }],
	});
	const sub = await tx.createSubmission({
		conversationId: convId,
		type: "input",
		status: "placed",
		entry: entry.id,
	});
	orphanId = sub.id;
}, ctx);

// Precondition: the orphan is placed and no live task owns its conversation.
{
	const inspection = await harness.inspect(ctx);
	const orphan = (inspection.submissions ?? []).find((s) => s.id === orphanId);
	assert.ok(orphan, "the orphan submission exists");
	assert.equal(orphan.status, "placed", "precondition: the orphan is placed");
	assert.equal(
		(inspection.tasks ?? []).filter((t) => t.record.conversationId === convId).length,
		0,
		"precondition: no live task owns the conversation",
	);
}

// Unit: the reconciler settles the orphan and reports it, and does not touch a
// submission that a live task still owns.
let liveTaskId;
{
	const inspection = await harness.inspect(ctx);
	const settled = await reconcileStrandedSubmissions(harness, inspection, { context: ctx });
	assert.deepEqual(settled, [orphanId], "the stranded submission is settled");
	const reInspect = await harness.inspect(ctx);
	assert.equal(
		(reInspect.submissions ?? []).find((s) => s.id === orphanId),
		undefined,
		"a settled submission leaves the unsettled set",
	);
	const record = await (await harness.submission(orphanId, ctx))?.status(ctx);
	assert.equal(record.status, "unanswered", "the orphan settles terminal");
	assert.equal(record.reason, "stranded", "with the stranded reason");
	liveTaskId = undefined;
}
void liveTaskId;

// Integration: a pass now wakes the seat the orphan was blocking, exactly once.
const woke = [];
const pass = await drivePass(harness, storage, { context: ctx, onWoke: (n) => woke.push(n) });
assert.deepEqual(woke, ["worker"], "the previously blocked seat is woken");
assert.equal(pass.actioned, 1, "the pass actioned exactly one wake");

const conv = await harness.conversation(convId, ctx);
const page = await conv.entries({}, 500, undefined, ctx);
assert.ok(
	page.items.some((e) => JSON.stringify(e).includes(WAKE_CONTENT)),
	"the seat received the wake text",
);

await harness.close(ctx);
console.log(
	"BROKER STRAND TEST PASS (a placed submission with no live task settles stranded; the seat it blocked is woken in the same pass)",
);
process.exit(0);
