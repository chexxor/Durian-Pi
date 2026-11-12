// demo/human-defer-lease.test.mjs — parking on the operator is a LEASE, and when it lapses `lead` decides.
//
// WHY THIS EXISTS. Measured 2026-11-12T20:1xZ on the live rig (7,502 rows): **493 rows carried
// `deferredTo: "human"`**, median age 5 days, oldest 23 — 32% of the non-terminal queue, and 84 of them were
// LANDING work while the operator was away. The team was not idle (35 rows closed in 4 h); it was addressed
// to an absent human. `status` printed that as nine alarms. The operator ratified the fix as "lead decides,
// pm routes, with a 5-day lease".
//
// This pins the three halves, each of which is a separate claim:
//   1. `defer_work` to the human REFUSES without `resumeBy` (and refuses a past instant or > 5 days), and the
//      refusal names the legal alternative — ask `lead`/`pm`, or hold with a lease;
//   2. the census sees lapsed parks AND the legacy rows that never had a clock (`no-clock`), because a rule
//      that only sees new rows fixes none of the 493;
//   3. `selectWakes` wakes `lead` with reason `escalation` when that census is non-empty, does not wake it
//      when it is empty, does not wake a paused/busy/stopped lead, and does not re-wake on an unchanged set.
//
// Run: node demo/human-defer-lease.test.mjs   (exit 0 = pass)

import assert from "node:assert/strict";
import { MAX_HUMAN_DEFER_MS, escalations, escalationSignature, escalationText, validateHumanDefer } from "../src/deferlease.mjs";
import { selectWakes } from "../src/driver.mjs";

const NOW = Date.parse("2026-11-12T20:30:00.000Z");
const inDays = (d) => new Date(NOW + d * 86_400_000).toISOString();
const deferred = (id, extra = {}) => ({
  id: String(id),
  status: "deferred",
  deferredTo: "human",
  transitions: [{ at: new Date(NOW - 5 * 86_400_000).toISOString(), event: "deferred", to: "human" }],
  ...extra,
});
const seats = { lead: { conversationId: 21 }, impl: { conversationId: 9 } };
const wakeFor = (items, opts = {}) =>
  selectWakes({ seats, items, pendingConvIds: new Set(), busySeats: new Set(), stoppedConvIds: new Set(), paused: false, ...opts });

console.log("=== 1. A PARK ON THE OPERATOR NEEDS A CLOCK ===");
{
  const noClock = validateHumanDefer({ to: "human" }, NOW);
  assert.equal(noClock.ok, false, "a human deferral with no resumeBy is REFUSED");
  assert.match(noClock.refusal, /resumeBy/, "the refusal names the missing field");
  assert.match(noClock.refusal, /lead/, "and names the legal alternative in the same breath (a seat with authority)");

  assert.equal(validateHumanDefer({ to: "human", resumeBy: inDays(2) }, NOW).ok, true, "two days out is a legal park");
  assert.equal(validateHumanDefer({ to: "human", resumeBy: inDays(5) }, NOW).ok, true, "at the 5-day bound is legal");
  assert.equal(validateHumanDefer({ to: "human", resumeBy: inDays(6) }, NOW).ok, false, "past 5 days is refused");
  assert.equal(validateHumanDefer({ to: "human", resumeBy: inDays(-1) }, NOW).ok, false, "a past instant is refused");
  assert.equal(validateHumanDefer({ to: "human", resumeBy: "soon" }, NOW).ok, false, "a non-instant is refused");
  assert.equal(MAX_HUMAN_DEFER_MS, 5 * 24 * 3600 * 1000, "the bound is the operator's five days");

  // Asking a SEAT is not a human park: unchanged, no clock demanded.
  assert.deepEqual(validateHumanDefer({ to: "lead" }, NOW), { ok: true, resumeBy: null }, "a seat-targeted deferral needs no lease");
  console.log("  ok   no clock / past / >5 d / non-instant refused with an alternative; a seat target is unchanged");
}

console.log("\n=== 2. THE CENSUS SEES THE LEGACY ROWS TOO (the 493 do not have clocks) ===");
{
  const items = [
    deferred(1, { deferLease: { resumeBy: inDays(1) } }), // live clock: NOT escalated
    deferred(2, { deferLease: { resumeBy: inDays(-1) } }), // lapsed
    deferred(3), // legacy: no clock at all
    { id: "4", status: "deferred", deferredTo: "lead", transitions: [] }, // parked on a seat
    { id: "5", status: "queued", deferredTo: "human", transitions: [] }, // not deferred
  ];
  const census = escalations(items, NOW);
  assert.deepEqual(census.rows.map((r) => r.id).sort(), ["2", "3"], "only the lapsed and the clock-less human parks escalate");
  assert.equal(census.rows.find((r) => r.id === "2").why, "lapsed");
  assert.equal(census.rows.find((r) => r.id === "3").why, "no-clock", "a legacy park is named as having had no clock, not as lapsed");
  assert.ok(census.rows[0].ageMs > 4 * 86_400_000, "the age comes from the defer transition, so a reader sees how long");
  assert.match(escalationText(census), /lead decides, pm routes/, "the one line names the decider");
  assert.equal(escalations([{ id: "6", status: "deferred", deferredTo: "human", deferLease: { resumeBy: inDays(1) } }], NOW).count, 0, "a park inside its clock is not an escalation");
  console.log("  ok   lapsed + no-clock escalate with ages; a live clock, a seat park and a queued row do not");
}

console.log("\n=== 3. LEAD IS WOKEN, ONCE, AND ONLY WHEN THE SET CHANGES ===");
{
  const escalated = [deferred(7)];
  const wake = wakeFor(escalated).find((w) => w.name === "lead");
  assert.ok(wake, "lead is woken when a park is past its clock");
  assert.equal(wake.reason, "escalation", "and the wake names the reason, so the caller can pick a matching body");
  assert.equal(wake.escalationCount, 1, "the count travels with the wake");

  assert.equal(wakeFor([]).find((w) => w.name === "lead"), undefined, "no escalation, no wake: lead sleeps");
  assert.equal(wakeFor([deferred(8, { deferLease: { resumeBy: inDays(2) } })]).find((w) => w.name === "lead"), undefined, "a park inside its clock does not wake lead");

  const seen = new Set();
  const parkedChanged = (_seat, sig) => (seen.has(sig) ? false : (seen.add(sig), true));
  assert.ok(wakeFor(escalated, { parkedChanged }).find((w) => w.name === "lead"), "first pass with a new escalation set wakes lead");
  assert.equal(wakeFor(escalated, { parkedChanged }).find((w) => w.name === "lead"), undefined, "an UNCHANGED set does not re-wake: a wake carrying no news sustains the loop (#5740)");
  const sig = escalationSignature(escalations(escalated, NOW).rows);
  assert.equal(typeof sig, "string", "the dedup key is the escalation signature");
  assert.equal(escalationSignature([]), "", "and an empty census has an empty signature");

  assert.equal(wakeFor(escalated, { paused: true }).find((w) => w.name === "lead"), undefined, "a PAUSED rig wakes nobody");
  assert.equal(wakeFor(escalated, { busySeats: new Set(["lead"]) }).find((w) => w.name === "lead"), undefined, "a busy lead is not woken");
  assert.equal(wakeFor(escalated, { pendingConvIds: new Set([21]) }).find((w) => w.name === "lead"), undefined, "a lead already mid-submission is not woken");

  // THE SUPPRESSION-ORDER DEFECT this demo caught: the dedup signature was first consulted BEFORE the
  // pending guard, so the pass that logged `SKIP lead reason=pending` also recorded the escalation as "told"
  // — and the wake never came once the turn settled. Here the signature is taken only when the wake ISSUES,
  // so a pending pass does not consume it.
  const seenDuringPending = new Set();
  const pendingChanged = (_seat, sig) => (seenDuringPending.has(sig) ? false : (seenDuringPending.add(sig), true));
  assert.equal(wakeFor(escalated, { pendingConvIds: new Set([21]), parkedChanged: pendingChanged }).find((w) => w.name === "lead"), undefined, "pending suppresses the wake");
  assert.ok(wakeFor(escalated, { parkedChanged: pendingChanged }).find((w) => w.name === "lead"), "and the SAME set still escalates once lead is free — the suppressed pass did not spend the signature");
  assert.equal(wakeFor(escalated, { stoppedConvIds: new Set([21]) }).find((w) => w.name === "lead"), undefined, "a stopped lead is not woken");
  console.log("  ok   escalation wakes lead once per changed set; empty/inside-clock/paused/busy/pending/stopped do not");
}

console.log("\nHUMAN-DEFER-LEASE PASS — a park on the operator has a 5-day clock, and the clock running out hands the decision to lead");
