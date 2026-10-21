// demo/genlock-monotonic.test.mjs — A2 (#2585): genlock aging is pid-first + MONOTONIC.
//
// `slotIsStale` aged a slot with a WALL-CLOCK delta (`Date.now() - Date.parse(since)`), so a clock
// step broke it: BACKWARD made a live-but-hung slot look fresh forever (it could never age out);
// FORWARD made a live holder look ancient and stole it, exceeding the concurrency cap. The fix
// keeps PID LIVENESS primary and measures the secondary age with a MONOTONIC clock (seconds since
// boot, shared across processes), never a wall-clock delta.
//
// FAILING-FIRST (before the fix): `slotIsStale` ignores `sinceUptime`, so the clock-jump cases
// below decide on the wall clock and the assertions fail.
//
// Run: node demo/genlock-monotonic.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir, uptime as osUptime } from "node:os";
import { join } from "node:path";

import { slotIsStale, withGenerationSlot } from "../src/genlock.mjs";

const dir = mkdtempSync(join(tmpdir(), "durig-genlock-mono-"));
const LIVE = process.pid;

try {
	/* 1. PID LIVENESS is PRIMARY: a dead pid is stale whatever the clock says. */
	assert.equal(slotIsStale({ pid: 999999, since: new Date().toISOString() }), true, "a dead pid is stale");
	assert.equal(
		slotIsStale({ pid: 999999, since: new Date().toISOString(), sinceUptime: osUptime() }),
		true,
		"a dead pid is stale even with a fresh monotonic stamp",
	);
	console.log("  ok   a dead pid is stale (pid liveness is primary)");

	/* 2. a LIVE pid with a recent MONOTONIC stamp is NOT stale. */
	assert.equal(
		slotIsStale({ pid: LIVE, since: new Date().toISOString(), sinceUptime: osUptime() }),
		false,
		"a live holder with a fresh monotonic stamp is not stale",
	);

	/* 3. a LIVE pid whose MONOTONIC age exceeds STALE_MS IS stale (a hung holder). */
	assert.equal(
		slotIsStale({ pid: LIVE, since: new Date().toISOString(), sinceUptime: osUptime() - 10_000 }),
		true,
		"a live holder whose monotonic age is past the bound is stale",
	);
	console.log("  ok   the monotonic age decides a live holder (fresh vs hung)");

	/* 4. CLOCK-JUMP robustness — the wall clock must not decide once a monotonic stamp exists.
	 *    (a) a wall `since` far in the PAST but a fresh monotonic stamp -> NOT stale
	 *        (before the fix this read as ancient and a live holder was stolen). */
	assert.equal(
		slotIsStale({ pid: LIVE, since: new Date(0).toISOString(), sinceUptime: osUptime() }),
		false,
		"a backward wall-clock stamp must not steal a live holder",
	);
	/*    (b) a wall `since` far in the FUTURE (a backward clock step) but an OLD monotonic stamp
	 *        -> stale (before the fix this looked fresh forever and the slot could never age out). */
	assert.equal(
		slotIsStale({ pid: LIVE, since: new Date(Date.now() + 86_400_000).toISOString(), sinceUptime: osUptime() - 10_000 }),
		true,
		"a forward wall-clock stamp must not wedge a hung slot",
	);
	console.log("  ok   a clock jump can neither steal a live holder nor wedge a hung slot");

	/* 5. a claimed holder carries the monotonic stamp (so the above is what the broker actually
	 *    writes). */
	const db = join(dir, "rig.sqlite");
	let observed = null;
	await withGenerationSlot({ dbPath: db, slots: 1, seat: "me" }, async () => {
		observed = JSON.parse(readFileSync(`${db}.genlock.0`, "utf8"));
	});
	assert.equal(observed.pid, LIVE, "the slot names the holder pid");
	assert.equal(typeof observed.sinceUptime, "number", "the holder carries a monotonic stamp");
	assert.ok(Math.abs(osUptime() - observed.sinceUptime) < 5, "and it is the shared boot clock, not a wall time");
	console.log("  ok   a claimed holder carries the monotonic stamp");

	console.log("\nGENLOCK-MONOTONIC TEST PASS (pid-liveness primary; monotonic age secondary)");
} finally {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}
process.exit(0);
