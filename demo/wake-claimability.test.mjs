// demo/wake-claimability.test.mjs — A WAKE IS A CLAIM OFFER, NOT "A ROW EXISTS FOR YOU" (#6189).
//
// WHY THIS FILE EXISTS. The lead seat reported four consecutive wakes in a row with nothing
// claimable (2026-11-10, log window 08:19:43 - 08:22:44, seven `WAKE lead` lines 30 s apart).
// `selectWakes` asked only `it.status === "queued"`. A queued row whose `blockedBy` gate is still
// open, or whose `requires` capability the seat does not advertise, is NOT claimable: `claim_work`
// answers NO_QUEUED_WORK and lists it as SKIPPED. So the predicate offered an action the verb
// refused - the same "the prompt lies" shape #4557 and #4607 were written to close, and the same
// cheap-signal-may-accept-but-never-decide principle as #3575.
//
// THE RULE APPLIED HERE IS ALREADY RATIFIED (#2673/#2677): `workable(item, seat, {items, capabilities})`
// in src/rig.mjs. This demo does not invent a predicate; it asserts that the WAKE path uses the one the
// CLAIM path already uses. Two homes for a gate rule is a rule that drifts (#6112).
//
// ANTI-VACUITY: every "no wake" assertion is paired with the fact that a `queued` row for that seat
// really exists in the input, so the test cannot pass because the seat had nothing at all.
//
// Run: node demo/wake-claimability.test.mjs   (exit 0 = pass)
import assert from "node:assert/strict";

import { selectWakes } from "../src/driver.mjs";
import { WakeScheduler } from "../src/scheduler.mjs";
import { workable } from "../src/rig.mjs";

const seats = { worker: { conversationId: 1 }, gatekeeper: { conversationId: 2 } };

function run(items, scheduler = new WakeScheduler({ minIntervalMs: 0, seatCooldownMs: 0 }), seat = "worker") {
	const skips = [];
	const wakes = selectWakes({
		seats,
		items,
		parkedChanged: (seatName, sig) => scheduler.parkedChanged(seatName, sig),
		onSkip: (e) => skips.push(e),
	});
	// EVERY assertion below is about ONE seat. The other seat appears in the input because a gate is a
	// real row owned by somebody else, and it legitimately wakes for its own work - counting total wakes
	// would assert about the wrong seat and hide the rule under an unrelated wake.
	return { wakes: wakes.filter((w) => w.name === seat), allWakes: wakes, skips };
}

const queuedFor = (items, seat) => items.filter((it) => it.to === seat && it.status === "queued");

/* 1. THE DEFECT, NAMED BEFORE IT IS FIXED: a queued row gated on an OPEN row.
   `workable` already says no; the wake predicate must say the same thing. */
const openGate = [
	{ id: 10, to: "worker", status: "queued", subject: "build B", blockedBy: [9] },
	{ id: 9, to: "gatekeeper", status: "claimed", subject: "build A" },
];
assert.equal(queuedFor(openGate, "worker").length, 1, "the gated row is really there (anti-vacuity)");
assert.equal(
	workable(openGate[0], "worker", { items: openGate }).workable,
	false,
	"the claim predicate already refuses this row",
);
assert.equal(run(openGate).wakes.length, 0, "a seat woken for a row it cannot claim is a no-op wake");
assert.equal(run(openGate).allWakes.length, 1, "the seat that OWNS the open gate does wake for its own claimed item - the rule is per seat, not a global silence");
const gatedSkip = run(openGate).skips.find((s) => s.seat === "worker");
assert.ok(gatedSkip, "the refusal is reported, never silent");
assert.match(gatedSkip.reason, /^queued-gated:gate-open:#9\(claimed\)$/, "the SKIP line names the gate and its state");

/* 2. THE OTHER DIRECTION: the gate closes, the wake fires. A suppression-only test is vacuous. */
const closedGate = [
	{ id: 10, to: "worker", status: "queued", subject: "build B", blockedBy: [9] },
	{ id: 9, to: "gatekeeper", status: "done", subject: "build A" },
];
assert.equal(workable(closedGate[0], "worker", { items: closedGate }).workable, true, "the claim predicate says workable");
const afterClose = run(closedGate);
assert.equal(afterClose.wakes.length, 1, "closing the gate wakes the seat");
assert.equal(afterClose.wakes[0].name, "worker", "the wake is for the seat that can now claim");
assert.equal(afterClose.wakes[0].reason, "queued", "the wake is a claim offer, so the seat gets the claim body");

/* 3. A CANCELLED gate is a DROPPED gate: the row is not workable, and it is not a transient wait. */
const cancelledGate = [
	{ id: 10, to: "worker", status: "queued", subject: "build B", blockedBy: [9] },
	{ id: 9, to: "gatekeeper", status: "cancelled", subject: "build A (dropped)" },
];
assert.equal(run(cancelledGate).wakes.length, 0, "a row gated on a cancelled row is not a claim offer");
assert.match(
	run(cancelledGate).skips.find((s) => s.seat === "worker").reason,
	/queued-gated:gate-cancelled:#9/,
	"a cancelled gate is named as cancelled, not as merely open",
);

/* 4. A capability the seat does not advertise is not claimable either - the same predicate, same result. */
const needsCap = [{ id: 11, to: "worker", status: "queued", subject: "needs implement", requires: "implement" }];
assert.equal(run(needsCap).wakes.length, 0, "an item demanding a capability the seat does not have is not a claim offer");
const capable = { worker: { conversationId: 1, capabilities: ["implement"] }, gatekeeper: { conversationId: 2 } };
assert.equal(
	selectWakes({ seats: capable, items: needsCap }).length,
	1,
	"the same row wakes the seat when it advertises the capability - the refusal is the capability, not the row",
);

/* 5. THE CONSERVATIVE DEFAULT SURVIVES THE WAKE PATH: an unknown gate id is ambiguous, and a false
   negative starves real work. Ambiguity must NOT suppress. */
const unknownGate = [{ id: 12, to: "worker", status: "queued", subject: "gated on a row that does not exist", blockedBy: [999] }];
assert.equal(run(unknownGate).wakes.length, 1, "an ambiguous gate is WORKABLE by ruling, so the seat is still woken");

/* 6. THE ACCEPTANCE SHAPE THE REPORTER ASKED FOR: one HELD row and one QUEUED row on the same seat
   produce exactly ONE wake, and releasing the held row produces one. */
const mixed = [
	{ id: 20, to: "worker", status: "held", subject: "parked backlog" },
	{ id: 21, to: "worker", status: "queued", subject: "real work" },
];
const sched = new WakeScheduler({ minIntervalMs: 0, seatCooldownMs: 0 });
const first = run(mixed, sched);
assert.equal(first.wakes.length, 1, "held plus queued wakes once, not twice");
assert.equal(first.wakes[0].reason, "queued", "the wake is the claimable row, not the parked one");
const again = run(mixed, sched);
assert.equal(again.wakes.length, 1, "the queued row still wakes on the next pass - dedup only suppresses parked sets");
const released = [
	{ id: 20, to: "worker", status: "queued", subject: "parked backlog, released" },
	{ id: 21, to: "worker", status: "queued", subject: "real work" },
];
assert.equal(run(released, sched).wakes.length, 1, "releasing a held row wakes the seat");

/* 7. A gated queue does not erase a STALLED CLAIM: the stalled-claim branch is untouched by this rule. */
const stalled = [
	{ id: 30, to: "worker", status: "queued", subject: "gated work", blockedBy: [31] },
	{ id: 31, to: "gatekeeper", status: "queued", subject: "the gate" },
	 { id: 32, to: "worker", status: "claimed", subject: "a claim whose run died" },
];
const stalledRun = run(stalled);
assert.equal(stalledRun.wakes.length, 1, "the seat with a stalled claim is still woken even though its queued row is gated");
assert.equal(stalledRun.wakes[0].reason, "stalled-claim", "and it wakes for the reason that is true");
assert.equal(stalledRun.allWakes.filter((w) => w.name === "gatekeeper").length, 1, "the gate's own queued row wakes its owner");

/* 8. FALSIFIER: the rule is the gate, not the status. Re-applying the OLD predicate to the same input
   wakes - so the test would fail if the predicate were dropped, and it proves the input is non-empty. */
const oldPredicate = openGate.filter((it) => it.to === "worker" && it.status === "queued").length;
assert.equal(oldPredicate, 1, "the pre-#6189 predicate sees a queued row for this seat");
assert.equal(run(openGate).wakes.length, 0, "the new predicate does not wake on it");
assert.match(gatedSkip.reason, /gate-open:#9/, "and the log names why, so a never-waking seat is not a mystery");

console.log(
	"WAKE-CLAIMABILITY PASS — open gate: 0 wakes (SKIP names the gate); closed gate: 1 wake; cancelled gate: 0; " +
		"unknown gate: 1; stalled claim: 1",
);
