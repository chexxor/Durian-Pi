// Durable event feed (PIECE 2, docs/PUSH-ARCHITECTURE.md §3.1): a READ-ONLY,
// ADDITIVE, machine-readable stream of durig events with a monotonic `seq`
// cursor, so a late/reconnecting subscriber resumes rather than replaying.
//
// This demo is failing-first: before src/eventfeed.mjs exists it dies with
// ERR_MODULE_NOT_FOUND (the feed is not implemented). After the implementation
// it proves:
//   (a) a subscriber with no cursor sees nothing on a quiet rig;
//   (b) enqueueing an item emits a `queue.enqueued` event with a durable `seq`;
//   (c) a reconnect from the last `seq` does NOT replay the enqueued event;
//   (d) a later claim emits a NEW event with a strictly greater `seq`.
//
// Read-only by construction: opens storage directly, never attaches a harness
// (D11), and writes nothing. Run: node demo/events.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { enqueueItem, RigQueue, Router } from "../src/rig.mjs";
import { readFeed } from "../src/eventfeed.mjs";

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(tmpdir(), "durig-events-"));
const db = join(dir, "rig.sqlite");

const models = createModels();
models.setProvider(fauxProvider({ models: [{ id: "faux-seat" }] }).provider);
const registry = createRegistry();
registry.install(Router);

// A writer (harness) exists ONLY to make changes, as the queue protocol does.
// The FEED itself opens storage directly and never attaches a harness.
async function withWriter(fn) {
	const storage = await openNodeSqliteStorage(db);
	const harness = await Harness.open(storage, { models, registry }, ctx);
	harness.resume();
	try {
		return await fn(harness);
	} finally {
		await harness.close(ctx);
		await storage.close(ctx);
	}
}

// The subscriber: open storage directly, read the feed, close. No harness.
async function feed(sinceSeq) {
	const storage = await openNodeSqliteStorage(db);
	try {
		return await readFeed(storage, ctx, { sinceSeq });
	} finally {
		await storage.close(ctx);
	}
}

try {
	// Seed a rig with one seat (read-only observers see it, but seats alone
	// emit no queue events).
	await withWriter(async (harness) => {
		await harness.commit(async (tx) => {
			const conv = await tx.createConversation({ ownership: { kind: "ownerless" } });
			const { registerSeat } = await import("../src/rig.mjs");
			await registerSeat(tx, "impl", conv.id, "implementation");
		}, ctx);
	});

	// (a) A subscriber with no cursor sees nothing on a quiet rig.
	const quiet = await feed(0);
	assert.equal(quiet.events.length, 0, "a rig with an empty queue emits no feed events");
	assert.equal(quiet.nextSeq, 0, "nextSeq is 0 when nothing has happened");

	// (b) Enqueue an item -> a `queue.enqueued` event with a durable seq.
	await withWriter((harness) =>
		harness.commit((tx) => enqueueItem(tx, "pm", "impl", "FEED_SUBJECT", "FEED_BODY"), ctx),
	);
	const afterEnqueue = await feed(0);
	const enq = afterEnqueue.events.find((e) => e.kind === "queue.enqueued");
	assert.ok(enq, `queue.enqueued must appear; got ${JSON.stringify(afterEnqueue.events)}`);
	assert.equal(enq.itemId, 1, "the event names the item id");
	assert.equal(enq.to, "impl");
	assert.equal(enq.from, "pm");
	assert.equal(enq.subject, "FEED_SUBJECT");
	assert.ok(Number.isFinite(enq.seq) && enq.seq > 0, `seq must be a positive number (got ${enq.seq})`);
	assert.ok(enq.ts, "the event carries a timestamp");

	// (c) Reconnect from the last seq -> the enqueued event is NOT replayed.
	const reconnected = await feed(enq.seq);
	assert.ok(
		!reconnected.events.some((e) => e.kind === "queue.enqueued" && e.itemId === enq.itemId),
		"a reconnect from the last seq must not replay the enqueue",
	);
	assert.equal(reconnected.events.length, 0, "nothing new happened since the cursor");

	// (d) A later claim emits a NEW event with a strictly greater seq.
	await withWriter(async (harness) => {
		await harness.commit(async (tx) => {
			const q = await tx.doc(RigQueue);
			const item = q.items.find((i) => i.id === 1);
			item.status = "claimed";
			item.transitions.push({ at: new Date().toISOString(), event: "claimed", by: "impl" });
		}, ctx);
	});
	const afterClaim = await feed(enq.seq);
	const claimed = afterClaim.events.find((e) => e.kind === "queue.claimed");
	assert.ok(claimed, `queue.claimed must appear after the cursor; got ${JSON.stringify(afterClaim.events)}`);
	assert.equal(claimed.itemId, 1);
	assert.ok(claimed.seq > enq.seq, `the claim's seq (${claimed.seq}) must exceed the enqueue's (${enq.seq})`);
	assert.ok(
		!afterClaim.events.some((e) => e.kind === "queue.enqueued"),
		"the reconnect window still excludes the earlier enqueue",
	);

	console.log(
		"EVENTS TEST PASS (read-only feed: quiet=0 events; enqueue emits queue.enqueued with a durable seq; reconnect from seq does not replay; a later claim emits a strictly greater seq)",
	);
} finally {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}
process.exit(0);
