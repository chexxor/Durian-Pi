// demo/broker-session-reopen.test.mjs — F2 (#2572): a terminal `SessionFailed` is recovered by a
// close+reopen of the harness, bounded by a reopen cap.
//
// pi-durable's failure model is TERMINAL: the first storage error fails the Session and every
// later call on that harness throws `SessionFailed` (`dist/errors.js`), so `runWakeLoop` retried a
// DEAD harness forever — `PASS-FAILED SessionFailed ... database is locked` on a fresh heartbeat,
// cleared only by a process restart (observed 04:59:30 -> 05:02:32). The fix classifies the failure
// (`isSessionFailed`), calls the CALLER-owned `reopen()` (which atomically closes+reopens BOTH
// handles AND re-subscribes) and re-arms the loop; past `reopenCap` the broker STOPS with a
// terminal `HARNESS-REOPEN-CAP-EXCEEDED` diagnostic instead of looping on a dead Session.
//
// FAILING-FIRST (before the fix): `isSessionFailed` does not exist and `runWakeLoop` ignores
// `reopen`, so scenario A never recovers and scenario B never stops terminally.
//
// Run: node demo/broker-session-reopen.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { Router, enqueueItem, registerSeat } from "../src/rig.mjs";
import { WakeScheduler, createWakeSignal } from "../src/scheduler.mjs";
import { isSessionFailed, runWakeLoop } from "../src/broker.mjs";

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(tmpdir(), "durig-session-reopen-"));

const sessionFailed = () => {
	const inner = new Error("database is locked");
	inner.name = "SqliteError";
	const outer = new Error("Session failed after a storage error; close and reopen it");
	outer.name = "SessionFailed";
	outer.cause = inner;
	return outer;
};

async function makeHarness() {
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
		await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" } });
		await registerSeat(tx, "solo", c.id, "worker");
		await enqueueItem(tx, "operator", "solo", "an item", "body");
		convId = c.id;
	}, ctx);
	return { harness, storage, convId };
}

// A probe whose `scanSubmissions` (used by `readStoppedConvIds`, a per-seat read BEFORE any wake)
// throws `SessionFailed` for its first `failTimes` calls, then delegates. That is the pass-level
// throw a terminal session produces.
function flakyProbe(storage, failTimes) {
	let calls = 0;
	return {
		scanSubmissions: (...a) => {
			calls += 1;
			if (calls <= failTimes) throw sessionFailed();
			return storage.scanSubmissions(...a);
		},
		document: (...a) => storage.document(...a),
		scanDocuments: (...a) => storage.scanDocuments(...a),
	};
}
const cleanProbe = (storage) => ({
	scanSubmissions: (...a) => storage.scanSubmissions(...a),
	document: (...a) => storage.document(...a),
	scanDocuments: (...a) => storage.scanDocuments(...a),
});

try {
	/* 0. the predicate */
	assert.equal(isSessionFailed(sessionFailed()), true, "a SessionFailed is detected");
	assert.equal(isSessionFailed({ name: "Error", cause: sessionFailed() }), true, "and through the cause chain");
	assert.equal(isSessionFailed(new Error("boom")), false, "an ordinary error is not a SessionFailed");
	console.log("  ok   isSessionFailed detects the terminal session failure (and its wrapped form)");

	/* A. one SessionFailed -> reopen -> the broker drives again */
	{
		const { harness, storage } = await makeHarness();
		const logPath = join(dir, "reopen-a.db");
		const diags = [];
		let reopens = 0;
		const result = await runWakeLoop({
			harness,
			probeStorage: flakyProbe(storage, 1),
			readStorage: storage,
			scheduler: new WakeScheduler({ minIntervalMs: 10, seatCooldownMs: 0 }),
			signal: createWakeSignal(),
			context: ctx,
			onDiagnostic: (d) => diags.push(d),
			dbPath: logPath,
			maxDurationMs: 1500,
			wakeRetryMs: 20,
			wakeRetryMaxMs: 60,
			isStopping: () => false,
			reopenCap: 3,
			reopenBackoffMs: 10,
			reopen: async () => {
				reopens += 1;
				return { harness, probeStorage: cleanProbe(storage), readStorage: storage };
			},
		});
		const log = existsSync(`${logPath}.broker.log`) ? readFileSync(`${logPath}.broker.log`, "utf8") : "";
		assert.ok(reopens >= 1, "the loop reopened the harness after the terminal failure");
		assert.match(log, /HARNESS-REOPEN attempt=1/, `the reopen is logged; log=${log.slice(0, 300)}`);
		assert.ok(/PASS \d+/.test(log), `a pass COMPLETED after the reopen; log=${log.slice(0, 300)}`);
		assert.notEqual(result.stoppedBy, "session-failed", "a recovered broker does not stop terminally");
		await harness.close(ctx);
		console.log("  ok   a terminal SessionFailed is recovered by reopen and the broker drives again");
	}

	/* B. a PERSISTENT SessionFailed -> the cap stops the broker terminally */
	{
		const { harness, storage } = await makeHarness();
		const logPath = join(dir, "reopen-b.db");
		const diags = [];
		let reopens = 0;
		const result = await runWakeLoop({
			harness,
			probeStorage: flakyProbe(storage, Number.MAX_SAFE_INTEGER),
			readStorage: storage,
			scheduler: new WakeScheduler({ minIntervalMs: 10, seatCooldownMs: 0 }),
			signal: createWakeSignal(),
			context: ctx,
			onDiagnostic: (d) => diags.push(d),
			dbPath: logPath,
			maxDurationMs: 8000,
			wakeRetryMs: 10,
			wakeRetryMaxMs: 40,
			isStopping: () => false,
			reopenCap: 2,
			reopenBackoffMs: 5,
			reopen: async () => {
				reopens += 1;
				return { harness, probeStorage: flakyProbe(storage, Number.MAX_SAFE_INTEGER), readStorage: storage };
			},
		});
		const log = existsSync(`${logPath}.broker.log`) ? readFileSync(`${logPath}.broker.log`, "utf8") : "";
		assert.equal(result.stoppedBy, "session-failed", `a persistent failure stops the broker terminally; got ${result.stoppedBy}`);
		assert.match(log, /HARNESS-REOPEN-CAP-EXCEEDED/, `the cap diagnostic is logged; log=${log.slice(0, 400)}`);
		assert.ok(diags.some((d) => d.kind === "harness-reopen-cap-exceeded"), "and emitted as a diagnostic");
		assert.equal(reopens, 2, `the reopen ran exactly reopenCap times; got ${reopens}`);
		await harness.close(ctx);
		console.log("  ok   a persistent SessionFailed ends in a TERMINAL stop (cap exceeded), not an endless loop");
	}

	console.log("\nBROKER-SESSION-REOPEN TEST PASS (terminal SessionFailed -> bounded reopen -> drive again, else stop)");
} finally {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}
process.exit(0);
