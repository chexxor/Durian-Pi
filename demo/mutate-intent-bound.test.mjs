// demo/mutate-intent-bound.test.mjs — a MUTATING verb fails fast too, not just a read (#314 / #6160)
//
// The read path got a health-derived bound (src/readclient.mjs): a resident broker whose pass clock
// is frozen answers in 10 s or says why. The spool-MUTATING verbs never got that. `cli.mjs pause
// --wait` and `compact` called `awaitIntentResult(...)` with a default `timeoutMs = 15 * 60_000` and
// no progress check at all — against a broker wedged inside an await that is a 900 s silence, which
// is the exact class this goal removes. Ctrl-C rescued it (`stoppableSleep`), but the verb did not
// fail fast on its own.
//
// THREE LEGS, so this is not a test of one string:
//   1. the BOUND FUNCTION, pure: advancing -> the long bound (a compaction is real work), degraded ->
//      the short bound, down -> 0 (nothing will apply it, say so now);
//   2. the LIVE VERB against a forged resident-but-frozen broker: it exits NON-ZERO inside the bound
//      and the message NAMES the cause (heartbeat age, pass age, live leases) and the runbook — and
//      the intent is still in the spool, because reporting a failure while silently discarding the
//      request would be worse;
//   3. the CONTROL: with an ADVANCING broker the wait is not cut short — Ctrl-C still ends it with 130.
//
// Run: node demo/mutate-intent-bound.test.mjs   (exit 0 = pass; ~2 s, no key, no network, no model)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import {
	DEGRADED_MUTATE_TIMEOUT_MS,
	MUTATE_INTENT_TIMEOUT_MS,
	intentInboxDir,
	intentWaitBoundMs,
	readIntentFiles,
	writeIntent,
} from "../src/broker.mjs";
import { registerSeat } from "../src/rig.mjs";

const CLI = join(process.cwd(), "cli.mjs");
const dir = mkdtempSync(join(tmpdir(), "durig-mutate-bound-"));
const dbPath = join(dir, "rig.db");
const ctx = BACKGROUND_CONTEXT;

function runVerb(args, env = {}, signalAtMs = null) {
	return new Promise((resolve) => {
		const t0 = Date.now();
		const p = spawn(process.execPath, [CLI, ...args], {
		cwd: process.cwd(),
		env: { ...process.env, DURIG_DB: dbPath, ...env },
		stdio: ["ignore", "pipe", "pipe"],
		});
		let out = "";
		p.stdout.on("data", (d) => (out += d));
		p.stderr.on("data", (d) => (out += d));
		let sigAt = null;
		const sig = signalAtMs ? setTimeout(() => { sigAt = Date.now(); p.kill("SIGINT"); }, signalAtMs) : null;
		const hard = setTimeout(() => { try { p.kill("SIGKILL"); } catch {} }, 20_000);
		p.on("close", (code, s) => {
			if (sig) clearTimeout(sig);
			clearTimeout(hard);
			resolve({ code, wallMs: Date.now() - t0, out });
		});
	});
}

console.log("\n=== 1. THE BOUND IS HEALTH-DERIVED (pure) ===");
const now = Date.now();
const up = intentWaitBoundMs({ pid: process.pid, heartbeatAt: now, lastPassAt: now - 1000 }, { now });
const degraded = intentWaitBoundMs({ pid: process.pid, heartbeatAt: now, lastPassAt: null }, { now });
const down = intentWaitBoundMs(null, { now });
assert.equal(up.boundMs, MUTATE_INTENT_TIMEOUT_MS, `an ADVANCING broker keeps the long bound (got ${up.boundMs})`);
assert.equal(degraded.boundMs, DEGRADED_MUTATE_TIMEOUT_MS, `a frozen-pass broker gets the degraded bound (got ${degraded.boundMs})`);
assert.equal(down.boundMs, 0, "no resident broker: the wait is 0, not 900 s");
assert.ok(MUTATE_INTENT_TIMEOUT_MS === 900_000, "the healthy bound is 15 min: compaction is real work");
assert.ok(DEGRADED_MUTATE_TIMEOUT_MS === 10_000, "the degraded bound matches the read path's 10 s");
console.log(`  ok   advancing ${up.boundMs} ms · degraded ${degraded.boundMs} ms · down ${down.boundMs} ms`);

try {
	// A real store with a seat, so the verb is talking to a rig, not to nothing.
	const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
	const models = createModels();
	models.setProvider(faux.provider);
	const registry = createRegistry();
	const storage = await openNodeSqliteStorage(dbPath);
	const harness = await Harness.open(storage, { models, registry }, ctx);
	await harness.commit(async (tx) => {
		const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
		await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" } });
		await registerSeat(tx, "worker", c.id, "worker");
	}, ctx);
	await harness.waitForIdle(ctx);
	await harness.close(ctx);
	await storage.close(ctx);

	const fake = spawn(process.execPath, ["-e", "setTimeout(() => process.exit(0), 30000)"], { stdio: "ignore" });

	console.log("\n=== 2. `pause --wait` against a resident broker whose pass is FROZEN ===");
	writeFileSync(`${dbPath}.broker.json`, JSON.stringify({
		pid: fake.pid,
		since: new Date(now).toISOString(),
		runToken: "forged-frozen-pass",
		heartbeatAt: Date.now(),
		lastPassAt: null,
	}));
	const requestId = "mutate-bound-probe";
	writeIntent(dbPath, { op: "pause", to: null, from: "operator", wait: true, requestId, createdAt: new Date().toISOString() });
	// The override keeps the demo fast; leg 1 pins the 10 s default that a real rig gets.
	const frozen = await runVerb(["pause", "--wait", "--reason", "probe"], { DURIG_INTENT_WAIT_MS: "400" });
	assert.ok(frozen.code !== 0, `the verb must fail, not hang: exit ${frozen.code}`);
	assert.ok(frozen.wallMs < 5_000, `it failed in ${frozen.wallMs} ms, inside the bound`);
	assert.match(frozen.out, /degraded/, "the failure names the health state, not 'timed out'");
	assert.match(frozen.out, /heartbeat \d+ ms old/, "the failure names the heartbeat age");
	assert.match(frozen.out, /last completed pass never/, "the failure names the frozen pass clock");
	assert.match(frozen.out, /broker-down-or-stalled\.md/, "the failure points at the runbook");
	const pending = readIntentFiles(dbPath).length;
	assert.ok(pending > 0, `the request is still in the spool (${pending} pending) — a failed verb does not silently discard it`);
	console.log(`  ok   exit ${frozen.code} in ${frozen.wallMs} ms: ${frozen.out.trim().split("\n")[0].slice(0, 120)}`);

	console.log("\n=== 3. CONTROL: an ADVANCING broker is not cut short — Ctrl-C still ends it (130) ===");
	writeFileSync(`${dbPath}.broker.json`, JSON.stringify({
		pid: fake.pid,
		since: new Date(now).toISOString(),
		runToken: "forged-advancing",
		heartbeatAt: Date.now(),
		lastPassAt: Date.now() - 1000,
	}));
	const ctrl = await runVerb(["pause", "--wait", "--reason", "probe2"], {}, 900);
	assert.equal(ctrl.code, 130, `Ctrl-C on the long wait exits 130 (got ${ctrl.code})`);
	assert.match(ctrl.out, /interrupted/, "the report says it was interrupted, not that it succeeded");
	assert.match(ctrl.out, /broker\.inbox/, "and says where the spooled request lives");
	console.log(`  ok   exit ${ctrl.code} in ${ctrl.wallMs} ms`);

	fake.kill();
} finally {
	rmSync(dir, { recursive: true, force: true });
}

console.log("\nMUTATE-INTENT-BOUND PASS — a mutating verb inherits the same health-derived bound as a read");
