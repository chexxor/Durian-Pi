// demo/broker-reconcile.test.mjs — idempotent intent drain + stale-lease reconciliation
// (ROADMAP 66, delegate-owned; the durable prerequisite for a command spool).
//
// Two restart hazards this closes:
//   1. A crash between submitting an inbox intent and unlinking its file re-drains the
//      same intent; without a requestId that is a SECOND submission. Every intent now
//      carries a requestId, and the harness dedupes by (conversation, requestId), so
//      the re-drain is a no-op submission.
//   2. A broker that dies mid-generation leaves a `<db>.genlock.<i>` lease whose holder
//      pid is gone. The acquire path steals it lazily; the broker now reconciles dead
//      leases once at start and logs it, and only removes a pid the OS reports as
//      non-existent (ESRCH) — an EPERM holder is live and is kept.
//
// Failing-first: HEAD's `writeIntent` stored no requestId and `reconcileGenerationSlots`
// did not exist, so the idempotency and lease assertions cannot pass.
// Run: node demo/broker-reconcile.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { Router, compilePersona, registerSeat } from "../src/rig.mjs";
import { WakeScheduler, createWakeSignal } from "../src/scheduler.mjs";
import { drainIntentInbox, runWakeLoop, writeIntent } from "../src/broker.mjs";
import { reconcileGenerationSlots } from "../src/genlock.mjs";

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(tmpdir(), "durig-reconcile-"));
const dbPath = join(dir, "reconcile.db");
const logFile = `${dbPath}.broker.log`;

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const storage = new MemoryStorage();
const harness = await Harness.open(storage, { models, registry }, ctx);

let workerConvId;
await harness.commit(async (tx) => {
	const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
	await configure(tx, c.id, {
		model: { provider: "faux", modelId: "faux-seat" },
		instructions: compilePersona({ role: "worker" }),
	});
	await registerSeat(tx, "worker", c.id, "worker");
	workerConvId = c.id;
}, ctx);

// A pid that existed and has now exited, so `process.kill(pid, 0)` reports ESRCH.
const deadPid = spawnSync(process.execPath, ["-e", "process.exit(0)"]).pid;

try {
	// --- Part A: an intent with no requestId is stored with one --------------------
	{
		const file = writeIntent(dbPath, { to: "worker", from: "operator", content: "auto-id" });
		const stored = JSON.parse(readFileSync(file, "utf8"));
		assert.ok(
			typeof stored.requestId === "string" && stored.requestId.length > 0,
			"an intent written without a requestId gets one",
		);
		rmSync(file, { force: true }); // keep the inbox clear for the next part
	}

	// --- Part B: re-draining the same intent does not double-submit ----------------
	{
		const file = writeIntent(dbPath, {
			to: "worker",
			from: "operator",
			content: "hello",
			requestId: "req-fixed",
		});
		const first = await drainIntentInbox(harness, storage, { dbPath, context: ctx });
		assert.equal(first.delivered, 1, "the first drain delivers the intent");
		assert.ok(!existsSync(file), "a delivered intent file is removed");

		// The crash window: the submit committed but the unlink did not, so the same
		// intent is spooled again and re-drained.
		writeIntent(dbPath, { to: "worker", from: "operator", content: "hello", requestId: "req-fixed" });
		const second = await drainIntentInbox(harness, storage, { dbPath, context: ctx });
		assert.equal(second.delivered, 1, "the re-drain is delivered (not dead-lettered)");

		const page = await storage.scanSubmissions(
			{ conversationId: workerConvId, order: "ascending" },
			100,
			undefined,
			ctx,
		);
		const inputs = page.items.filter((s) => s.type === "input");
		assert.equal(inputs.length, 1, "the same requestId is submitted exactly once");
	}

	// --- Part C: dead leases are reconciled, live ones are kept --------------------
	{
		const stale = `${dbPath}.genlock.0`;
		writeFileSync(stale, JSON.stringify({ pid: deadPid, seat: "ghost", since: new Date(0).toISOString() }));
		const live = `${dbPath}.genlock.1`;
		writeFileSync(live, JSON.stringify({ pid: process.pid, seat: "me", since: new Date().toISOString() }));

		const removed = reconcileGenerationSlots(dbPath);
		assert.equal(removed.length, 1, "exactly the dead lease is reconciled");
		assert.ok(!existsSync(stale), "a slot whose holder pid is gone is removed");
		assert.ok(existsSync(live), "a slot held by a live pid is kept");
		rmSync(live, { force: true });
	}

	// --- Part D: the broker reconciles leases at start and logs it -----------------
	{
		writeFileSync(`${dbPath}.genlock.2`, JSON.stringify({ pid: deadPid, seat: "ghost", since: new Date(0).toISOString() }));
		const scheduler = new WakeScheduler({ minIntervalMs: 0, seatCooldownMs: 0 });
		const result = await runWakeLoop({
			harness,
			probeStorage: storage,
			scheduler,
			signal: createWakeSignal(),
			context: ctx,
			dbPath,
			maxPasses: 1,
		});
		assert.equal(result.stoppedBy, "max-passes", "the bounded broker stops at its pass bound");
		const log = readFileSync(logFile, "utf8");
		assert.ok(/RECONCILE leases=1/.test(log), "the broker logs the lease reconciliation at start");
	}

	console.log(
		"BROKER RECONCILE PASS (intents carry a requestId and re-drain idempotently; dead generation leases are reconciled at start while live ones are kept)",
	);
} finally {
	try {
		await harness.close(ctx);
	} catch (err) {
		console.error(`CLEANUP WARNING (harness): ${err?.message ?? err}`);
	}
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}
process.exit(0);
