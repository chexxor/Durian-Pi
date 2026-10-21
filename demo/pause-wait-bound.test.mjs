// demo/pause-wait-bound.test.mjs — F10 (#2583): `pause --wait` is BOUNDED.
//
// `applyPauseOp`'s wait loop polled for quiescence with NO deadline, so a run that never settles
// meant `pause --wait` never returned — hanging the operator, and the broker-upgrade step that
// calls it. The fix bounds the wait and returns `{ quiesced:false, waitedMs }` (both fields the
// caller already reports).
//
// FAILING-FIRST (before the fix): the never-settling case never returns, so the race below
// resolves to the sentinel and the assertion fails.
//
// Run: node demo/pause-wait-bound.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";

import { applyPauseOp } from "../src/broker.mjs";

const ctx = undefined;

// A harness whose `inspect` ALWAYS reports in-flight work: the never-settling run.
const neverSettles = {
	commit: async () => {},
	inspect: async () => ({ tasks: [], submissions: [{ id: 1, status: "placed", conversationId: 1 }] }),
};
// A harness with nothing in flight: quiescence on the first poll.
const quiescent = {
	commit: async () => {},
	inspect: async () => ({ tasks: [], submissions: [] }),
};

const withTimeout = (p, ms, sentinel) => Promise.race([p, new Promise((r) => setTimeout(() => r(sentinel), ms))]);

// A short bound so the demo proves the behaviour without waiting a minute.
process.env.DURIG_PAUSE_WAIT_MS = "400";

// 1. the never-settling run: `pause --wait` RETURNS, bounded, with quiesced:false.
const t0 = Date.now();
const result = await withTimeout(applyPauseOp(neverSettles, { paused: true, wait: true }, ctx), 3000, "TIMEOUT");
const elapsed = Date.now() - t0;
assert.notEqual(result, "TIMEOUT", "pause --wait must RETURN, not loop forever (F10)");
assert.equal(result.paused, true, "the pause flag is still set");
assert.equal(result.quiesced, false, "a never-settling run reports quiesced:false");
assert.ok(result.waitedMs >= 400, `it waited at least the bound; got ${result.waitedMs}`);
assert.ok(elapsed < 3000, `it returned within the race window; got ${elapsed}ms`);
console.log("  ok   a never-settling run returns quiesced:false within the bound");

// 2. quiescence is still detected promptly (the bound must not turn a clean pause into a wait).
const t1 = Date.now();
const quick = await withTimeout(applyPauseOp(quiescent, { paused: true, wait: true }, ctx), 3000, "TIMEOUT");
assert.equal(quick.quiesced, true, "a quiescent rig still reports quiesced:true");
assert.ok(Date.now() - t1 < 400, "and it returns well before the bound");
console.log("  ok   a quiescent rig still returns quiesced:true promptly");

// 3. no `--wait` -> the immediate shape is unchanged.
const noWait = await applyPauseOp(quiescent, { paused: true }, ctx);
assert.deepEqual(noWait, { paused: true }, "pause without --wait is unchanged");
console.log("  ok   pause without --wait is unchanged");

console.log("\nPAUSE-WAIT-BOUND TEST PASS (pause --wait returns, bounded, with quiesced:false)");
process.exit(0);
