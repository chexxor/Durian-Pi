// demo/broker-liveness-failsafe.test.mjs — #3398: the broker liveness probe must be
// FAIL-SAFE (unknown ⇒ ALIVE), and the bounded stop drain must actually abandon a hung
// waitForIdle at its deadline.
//
// THE DEFECT (found via impl-item-2574's stop-and-report): both probes classified a
// process as DEAD for any thrown error other than EPERM —
//
//   return err?.code === "EPERM";      // main, before this fix
//
// That is fail-OPEN toward dead. The bug the probe serves is a FALSE-DEAD report
// (`serve --stop` returning `stopped:true` for a live broker), and a false dead admits a
// SECOND WRITER — the double-writer corruption class. On Windows EPERM is the common case
// for a process you do not own, so the rule worked on the usual path and silently
// mis-classified the unusual one: the worst shape for a probe, because tests written from
// the usual path pass.
//
// FAILING-FIRST: with `=== "EPERM"` restored, the synthetic-unknown and EINVAL cases below
// fail (the probe reports dead). With `!== "ESRCH"` they pass.
//
// Run: node demo/broker-liveness-failsafe.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	brokerAlive,
	brokerHealth,
	pidAlive,
	runWakeLoop,
	stopRequestPath,
} from "../src/broker.mjs";

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

// `process.kill` is the OS seam these probes use, so the demo drives it directly and
// restores it in `finally`: a test that cannot produce an unusual error code cannot test
// the unusual path, and the unusual path is the whole defect.
const realKill = process.kill;
function withKill(thrown, fn) {
	process.kill = () => {
		const err = new Error(`synthetic ${thrown}`);
		err.code = thrown;
		throw err;
	};
	try {
		return fn();
	} finally {
		process.kill = realKill;
	}
}

const dir = mkdtempSync(join(tmpdir(), "durig-liveness-"));
const freshState = { pid: 4242, heartbeatAt: Date.now() };

try {
	console.log("\n=== a thrown code we do NOT recognise means ALIVE (the ruling) ===");
	const unknown = withKill("EWHATEVER", () => ({ pid: pidAlive(4242), alive: brokerAlive(freshState) }));
	check("pidAlive: an unknown error code is ALIVE, not dead", unknown.pid === true, JSON.stringify(unknown));
	check("brokerAlive: an unknown error code is ALIVE, not dead", unknown.alive === true, JSON.stringify(unknown));

	console.log("\n=== the two codes that DO carry meaning ===");
	check("EPERM (exists, cannot signal) is ALIVE", withKill("EPERM", () => pidAlive(4242)) === true);
	check("ESRCH (no such process) is DEAD — the only dead answer", withKill("ESRCH", () => pidAlive(4242)) === false);
	check("brokerAlive agrees on ESRCH", withKill("ESRCH", () => brokerAlive(freshState)) === false);

	console.log("\n=== EINVAL (a malformed pid) is ALIVE: unknown ⇒ alive, by ruling ===");
	// The cost asymmetry is the reason: a false ALIVE refuses to start one more broker;
	// a false DEAD reports a live broker as stopped and admits a second writer.
	check("EINVAL is ALIVE", withKill("EINVAL", () => pidAlive(4242)) === true);

	console.log("\n=== brokerHealth does NOT cover this: it inherits the probe ===");
	// #2581's brokerHealth is the stronger signal, but its first leg IS brokerAlive, so it
	// cannot be cited as making the probe moot — it reproduces it.
	const health = withKill("EWHATEVER", () => brokerHealth(freshState, { now: Date.now(), streamTimeoutMs: 300_000 }));
	check("brokerHealth reports UP on an unknown error code", health.state !== "down", JSON.stringify(health));
	check("brokerHealth says WHY it is down only for a real death", withKill("ESRCH", () => brokerHealth(freshState)).state === "down");

	console.log("\n=== the bounded drain ABANDONS a hung waitForIdle at the deadline ===");
	// Before this test, B4 (demo/broker-cooperative-stop) reached the deadline branch but
	// its `waitForIdle` resolved instantly — nothing proved the BOUND fires. A drain that
	// waits forever while reporting healthy is worse than a kill for a STOP path.
	{
		const db = join(dir, "hung.db");
		// A stop requested longer ago than the grace: the deadline has already expired.
		writeFileSync(stopRequestPath(db), String(Date.now() - 60_000));
		let waited = false;
		const harness = {
			documentState: async () => ({ value: {} }),
			inspect: async () => ({ submissions: [], tasks: [] }),
			// NEVER resolves: the drain must be abandoned, not awaited.
			waitForIdle: () => {
				waited = true;
				return new Promise(() => {});
			},
			conversation: async () => null,
		};
		const storage = {
			findDocument: async () => null,
			scanDocuments: async () => ({ items: [] }),
			document: async () => null,
			scanSubmissions: async () => ({ items: [] }),
		};
		const scheduler = {
			markDirty() {},
			shouldRun: () => false,
			delayUntilReady: () => 1_000,
			beginPass() {},
			endPass() {},
			seatFilter: () => true,
			recordWakes() {},
			msUntilSeatReady: () => Infinity,
			clearSeatCooldown() {},
		};
		const started = Date.now();
		const result = await Promise.race([
			runWakeLoop({
				harness,
				probeStorage: storage,
				scheduler,
				signal: { raise() {}, wait: async () => {} },
				context: {},
				dbPath: db,
				stopGraceMs: 5_000,
			}),
			new Promise((resolve) => setTimeout(() => resolve({ hung: true }), 10_000)),
		]);
		const elapsed = Date.now() - started;
		check("the stop path returned instead of hanging on a dead waitForIdle", result.hung !== true, JSON.stringify(result));
		check("it reported the deadline, not a signal", result.stoppedBy === "deadline", JSON.stringify(result));
		check("the bound fired promptly (well under the 10s guard)", elapsed < 9_000, `elapsed=${elapsed}ms`);
		check("the hung wait was actually entered (the branch was exercised)", waited === true);
	}

	assert.ok(true);
	console.log(
		failures === 0
			? "\nFAIL-SAFE LIVENESS PASS (unknown ⇒ alive; ESRCH is the only dead; the drain is bounded)"
			: `\nFAIL-SAFE LIVENESS FAIL — ${failures} check(s)`,
	);
} catch (err) {
	console.error("ERROR:", err?.message ?? err);
	failures += 1;
} finally {
	process.kill = realKill;
	rmSync(dir, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
