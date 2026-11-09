// demo/parked-wake-dedup.test.mjs — a parked seat is woken ONCE PER CHANGE OF ITS PARKED SET (#5741, ruling #5740 option A).
//
// WHY THIS FILE EXISTS (the measurement is in docs/reviews/architecture-parked-wake-loop-2026-11-08.md §1,
// reproduced here as an assertion rather than a quote). One held row and zero queued rows produced FOUR
// wakes in 120 s at +0/+30/+60/+90 s. The wake itself is the trigger for the next one: the submitted wake
// dirties the scheduler, the seat is suppressed by the 30 s cooldown, `cooldownRevisitAt` forces the next
// pass, and the parked branch fires again. Nothing bounds the count. Fleet scale: 4,455 `WAKE ` lines in
// the live log, one seat waking 24 times in an hour while holding nothing claimable.
//
// BOTH DIRECTIONS ARE ASSERTED, because a suppression-only test is vacuous:
//   unchanged parked set -> NO wake (and the suppression is reported, not silent);
//   added row, released row, or a status change -> wake;
//   a QUEUED row alongside parked rows -> the queued wake still fires (the dedup must not touch hasQueued);
//   the default (no parkedChanged predicate) -> wakes every pass, which is the behaviour the fix replaced.
//
// `selectWakes` stays pure: the signature state lives on the WakeScheduler instance, injected as a
// predicate. That is why this demo needs no harness and no model.
//
// Run: node demo/parked-wake-dedup.test.mjs   (exit 0 = pass)
import assert from "node:assert/strict";

import { WAKE_CONTENT_PARKED, parkedSignature, selectWakes } from "../src/driver.mjs";
import { WakeScheduler } from "../src/scheduler.mjs";

const seats = { parkseat: { conversationId: 1 }, other: { conversationId: 2 } };

function run(items, scheduler, extra = {}) {
	const skips = [];
	const parked = [];
	const wakes = selectWakes({
		seats,
		items,
		parkedChanged: (seat, sig) => scheduler.parkedChanged(seat, sig),
		onSkip: (e) => skips.push(e),
		onParked: (e) => parked.push(e),
		...extra,
	});
	return { wakes, skips, parked };
}

/* 1. first pass: the set is new -> wake, and the wake is labelled parked. */
const scheduler = new WakeScheduler({ minIntervalMs: 0, seatCooldownMs: 0 });
const items = [{ id: 1, to: "parkseat", status: "held" }];
const first = run(items, scheduler);
assert.equal(first.wakes.length, 1, "a seat with a new parked set is woken once");
assert.equal(first.wakes[0].name, "parkseat", "the wake is for that seat");
assert.equal(first.wakes[0].reason, "parked", "the wake reason is parked, so the caller picks the parked body");
assert.deepEqual(first.parked, [{ seat: "parkseat", reason: "set-changed" }], "the change is logged as set-changed");

/* 2. second pass, SAME set: no wake, and the reason is named. */
const second = run(items, scheduler);
assert.equal(second.wakes.length, 0, "an unchanged parked set produces no wake - this is the loop that used to run forever");
assert.deepEqual(second.skips.filter((s) => s.seat === "parkseat"), [{ seat: "parkseat", reason: "parked-deduped" }], "the suppression is reported by name, never silent");
assert.deepEqual(second.parked, [{ seat: "parkseat", reason: "deduped" }], "the log says deduped");
assert.equal(scheduler.parkedSignatureOf("parkseat"), "1:held", "the scheduler recorded the signature it deduped against");

/* 3. the set CHANGES -> wake again. Three ways a set changes, each asserted. */
const added = [...items, { id: 2, to: "parkseat", status: "deferred" }];
assert.equal(run(added, scheduler).wakes.length, 1, "a newly parked row wakes the seat");
const released = [{ id: 1, to: "parkseat", status: "queued" }, { id: 2, to: "parkseat", status: "deferred" }];
const releaseRun = run(released, scheduler);
assert.equal(releaseRun.wakes.length, 1, "releasing a row (held -> queued) wakes the seat");
assert.equal(releaseRun.wakes[0].reason, "queued", "the release wakes through the QUEUED branch, not the parked one");

/* 4. a status change inside the parked set is a change, not a no-op. */
const statusChanged = [{ id: 1, to: "parkseat", status: "deferred" }];
assert.notEqual(parkedSignature(statusChanged, "parkseat"), "1:held", "held and deferred are different signatures");
assert.equal(run(statusChanged, scheduler).wakes.length, 1, "a parked row whose status changed wakes the seat");

/* 5. the dedup must not swallow queued work. */
const mixed = [{ id: 3, to: "parkseat", status: "queued" }, { id: 1, to: "parkseat", status: "held" }];
const mixedRun = run(mixed, scheduler);
assert.equal(mixedRun.wakes.length, 1, "a queued row wakes even when the parked set is already known");
assert.equal(mixedRun.wakes[0].reason, "queued", "the reason is queued, so the seat gets the claimable-work body");

/* 6. the seat with nothing at all is still 'no-work', not 'deduped'. */
const emptyRun = run([], scheduler);
assert.equal(emptyRun.wakes.length, 0, "no rows, no wake");
assert.ok(emptyRun.skips.every((s) => s.reason === "no-work"), "an empty seat is reported as no-work, not as deduped");

/* 7. NEGATIVE CONTROL - without the predicate the old behaviour stands, so the dedup is what changed things. */
const noPredicate = selectWakes({ seats, items });
assert.equal(noPredicate.length, 1, "without parkedChanged the parked branch fires every pass (the pre-#5740 behaviour)");
assert.equal(selectWakes({ seats, items }).length, 1, "and again on the identical set - the loop is unbounded without the dedup");

/* 8. the parked wake body must be executable by the seat that receives it (#5740 §4). */
assert.match(WAKE_CONTENT_PARKED, /peek_queue/, "the parked wake names the tool a parked seat actually has");
assert.ok(!/Check `status`/.test(WAKE_CONTENT_PARKED), "the wake must not tell a seat to run a CLI verb it cannot reach from a seat tool");

console.log("PARKED-WAKE-DEDUP PASS — 1 wake for a new set, 0 for the same set, queued work still wakes");
