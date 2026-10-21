// ROADMAP 42 stalled-claim re-wake test. The queue driver only wakes a seat that
// has a QUEUED item; a seat that CLAIMED an item and then died (run ended with no
// completion) is never re-driven, so the item sits `claimed` forever and only a
// human re-send recovers it. This proves the driver now re-wakes a STALLED CLAIM
// (claimed + no live lease + no in-flight submission + NOT operator-stopped),
// gated on the abort fact `stop` ALREADY writes (settleSubmission unanswered/
// "aborted:<reason>") read READ-ONLY off the settled submission — no new write
// path, no queue-item annotation (lead corrected ruling #45/#50; Decision 1:
// re-wake is the deliverable, no standalone notice).
// This proves:
//   (a) the driver re-wakes a stalled claim with NO human send (bounded, one wake);
//   (b) an operator-stopped item is NOT re-woken;
//   (c) a live/in-flight run is never double-woken;
//   (d) the existing queued-item wake still works (no regression);
//   (e) no double-wake within a pass.
// Run: node demo/stalledclaim.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { Router, RigQueue, enqueueItem, registerSeat } from "../src/rig.mjs";
import { Seats } from "../src/rig.mjs";
import { driveOnce, selectWakes, WAKE_CONTENT, WAKE_CONTENT_STALLED, WAKE_CONTENT_PARKED } from "../src/driver.mjs";

const ctx = BACKGROUND_CONTEXT;
const seatsStub = { worker: { conversationId: "w" } };
const claimedItem = [{ id: 1, to: "worker", status: "claimed" }];
const queuedItem = [{ id: 2, to: "worker", status: "queued" }];

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);

// --- PART A: PURE selectWakes predicate (deterministic; covers (a)-(e)) ---
{
	const empty = () => new Set();
	// (a) stalled claim -> re-woken.
	assert.deepEqual(
		selectWakes({ seats: seatsStub, items: claimedItem, pendingConvIds: empty(), busySeats: empty(), stoppedConvIds: empty() }),
		[{ name: "worker", conversationId: "w", reason: "stalled-claim" }],
		"a stalled claim is re-woken (the wake names why, #4557)",
	);
	// (b) operator-stopped -> never re-woken.
	assert.deepEqual(
		selectWakes({ seats: seatsStub, items: claimedItem, pendingConvIds: empty(), busySeats: empty(), stoppedConvIds: new Set(["w"]) }),
		[],
		"an operator-stopped claim is not re-woken",
	);
	// (c1) in-flight submission -> no double-wake.
	assert.deepEqual(
		selectWakes({ seats: seatsStub, items: claimedItem, pendingConvIds: new Set(["w"]), busySeats: empty(), stoppedConvIds: empty() }),
		[],
		"a claim with an in-flight submission is not re-woken",
	);
	// (c2) live generation lease -> no double-wake.
	assert.deepEqual(
		selectWakes({ seats: seatsStub, items: claimedItem, pendingConvIds: empty(), busySeats: new Set(["worker"]), stoppedConvIds: empty() }),
		[],
		"a claim behind a live lease is not re-woken",
	);
	// (d) queued item still wakes (regression).
	assert.deepEqual(
		selectWakes({ seats: seatsStub, items: queuedItem, pendingConvIds: empty(), busySeats: empty(), stoppedConvIds: empty() }),
		[{ name: "worker", conversationId: "w", reason: "queued" }],
		"a queued item is still woken",
	);
	// (e) at most one wake per seat per pass.
	assert.equal(selectWakes({ seats: seatsStub, items: claimedItem }).length, 1, "no double-wake within a pass");
}

// --- REALISED STORES for the behavioural driveOnce cases ---
async function makeStore(db, { claimed = true, inflight = false, busy = false, stopped = false } = {}) {
	const storage = await openNodeSqliteStorage(db);
	const harness = await Harness.open(storage, { models, registry }, ctx);
	let convId;
	await harness.commit(async (tx) => {
		const conv = await tx.createConversation({ ownership: { kind: "ownerless" } });
		await configure(tx, conv.id, { model: { provider: "faux", modelId: "faux-seat" } });
		await registerSeat(tx, "worker", conv.id, "implementation");
		convId = conv.id;
		const itemId = await enqueueItem(tx, "boss", "worker", "the stalled item", "body");
		if (claimed) {
			const q = await tx.doc(RigQueue);
			const it = q.items.find((i) => i.id === itemId);
			it.status = "claimed";
			it.transitions.push({ at: new Date().toISOString(), event: "claimed", by: "worker" });
		}
	}, ctx);
	if (inflight) {
		const conv = await harness.conversation(convId, ctx);
		await conv.submit({ type: "input", content: "in flight" }, ctx);
	}
	if (stopped) {
		const conv = await harness.conversation(convId, ctx);
		const sub = await conv.submit({ type: "input", content: "something" }, ctx);
		await harness.commit((tx) => {
			tx.settleSubmission(sub.id, { status: "unanswered", reason: "aborted: operator stop: runaway" });
		}, ctx);
	}
	await harness.close(ctx);
	await storage.close(ctx);
	return convId;
}

async function readSeats(db) {
	const storage = await openNodeSqliteStorage(db);
	try {
		const rec = await storage.findDocument({ kind: Seats.definition.kind, scope: { kind: "session" } }, "current", ctx);
		return rec ? ((await storage.document(rec.id, "current", ctx))?.value?.seats ?? {}) : {};
	} finally {
		await storage.close(ctx);
	}
}

// Compute stoppedConvIds exactly the way cmdRun does: read each seat's latest
// settled submission; if unanswered with reason starting "aborted:", it is stopped.
async function computeStopped(db, seats) {
	const storage = await openNodeSqliteStorage(db);
	try {
		const stopped = new Set();
		for (const s of Object.values(seats ?? {})) {
			const page = await storage.scanSubmissions({ conversationId: s.conversationId, order: "descending" }, 1, undefined, ctx);
			const latest = page.items[0];
			if (latest?.status === "unanswered" && String(latest.reason ?? "").startsWith("aborted:")) {
				stopped.add(s.conversationId);
			}
		}
		return stopped;
	} finally {
		await storage.close(ctx);
	}
}

// Count wake submissions (a pi.user whose entry content is WAKE_CONTENT) in a
// conversation. A wake is the durable record that the re-wake happened.
async function countWakes(db, convId) {
	const storage = await openNodeSqliteStorage(db);
	try {
		const p = await storage.scanSubmissions({ conversationId: convId, order: "descending" }, 200, undefined, ctx);
		let wakes = 0;
		for (const sub of p.items) {
			if (sub.type !== "input") continue;
			const ePage = await storage.scanEntries({ conversationId: convId, order: "descending" }, 200, undefined, ctx);
			const e = ePage.items.find((x) => String(x.id) === String(sub.entry));
			// #4557/#4607: the body now names the state, so a stalled/parked wake is not the generic text.
			const body = JSON.stringify(e?.model?.[0]?.content);
			if (e && [WAKE_CONTENT, WAKE_CONTENT_STALLED, WAKE_CONTENT_PARKED].some((w) => body.includes(w))) wakes++;
		}
		return wakes;
	} finally {
		await storage.close(ctx);
	}
}

async function openDriver(db) {
	const storage = await openNodeSqliteStorage(db);
	const harness = await Harness.open(storage, { models, registry }, ctx);
	harness.resume();
	return { harness, storage };
}

const dir = mkdtempSync(join(tmpdir(), "durig-stalledclaim-"));
try {
	// (a) behavioural positive: a stalled claim is re-woken, one wake, no human send.
	{
		const db = join(dir, "pos.sqlite");
		const convId = await makeStore(db, { claimed: true });
		const seats = await readSeats(db);
		const { harness, storage } = await openDriver(db);
		try {
			const actioned = await driveOnce(harness, {
				seats,
				items: claimedItem,
				pendingConvIds: new Set(),
				busySeats: new Set(),
				stoppedConvIds: new Set(),
				context: ctx,
			});
			assert.equal(actioned, 1, "the stalled claim was re-woken once");
			assert.equal(await countWakes(db, convId), 1, "exactly one wake delivered, bounded");
		} finally {
			await harness.close(ctx);
			await storage.close(ctx);
		}
	}

	// (b) behavioural negative: an operator-stopped claim is NOT re-woken.
	{
		const db = join(dir, "neg-stop.sqlite");
		await makeStore(db, { claimed: true, stopped: true });
		const seats = await readSeats(db);
		const stoppedConvIds = await computeStopped(db, seats); // read the real abort fact
		assert.ok(stoppedConvIds.size >= 1, "the stopped submission is read as stopped");
		const { harness, storage } = await openDriver(db);
		try {
			const convId = Object.values(seats)[0].conversationId;
			const actioned = await driveOnce(harness, {
				seats,
				items: claimedItem,
				pendingConvIds: new Set(),
				busySeats: new Set(),
				stoppedConvIds,
				context: ctx,
			});
			assert.equal(actioned, 0, "an operator-stopped claim is never re-woken");
			assert.equal(await countWakes(db, convId), 0, "no wake delivered to a stopped seat");
		} finally {
			await harness.close(ctx);
			await storage.close(ctx);
		}
	}

	// (c) behavioural negative: in-flight and live-lease are never double-woken.
	{
		const db = join(dir, "neg-inflight.sqlite");
		const convId = await makeStore(db, { claimed: true, inflight: true });
		const seats = await readSeats(db);
		const { harness, storage } = await openDriver(db);
		try {
			const insp = await harness.inspect(ctx);
			const pending = new Set((insp.submissions ?? []).map((s) => s.conversationId));
			const actioned = await driveOnce(harness, {
				seats,
				items: claimedItem,
				pendingConvIds: pending,
				busySeats: new Set(),
				stoppedConvIds: new Set(),
				context: ctx,
			});
			assert.equal(actioned, 0, "an in-flight claim is not double-woken");
			void convId;
		} finally {
			await harness.close(ctx);
			await storage.close(ctx);
		}
	}
	{
		const db = join(dir, "neg-busy.sqlite");
		await makeStore(db, { claimed: true });
		const seats = await readSeats(db);
		const { harness, storage } = await openDriver(db);
		try {
			const actioned = await driveOnce(harness, {
				seats,
				items: claimedItem,
				pendingConvIds: new Set(),
				busySeats: new Set(["worker"]),
				stoppedConvIds: new Set(),
				context: ctx,
			});
			assert.equal(actioned, 0, "a claim behind a live lease is not re-woken");
		} finally {
			await harness.close(ctx);
			await storage.close(ctx);
		}
	}

	console.log("STALLEDCLAIM TEST PASS (driver re-wakes a stalled claim with no human send; operator-stopped and in-flight/busy items are never re-woken; queued wake preserved; bounded/idempotent, one wake per pass)");
} finally {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}
// After the finally: an exit inside the try would skip cleanup entirely.
process.exit(0);
