// demo/queue-ops.test.mjs — the operator/delegate queue-control PLANNERS, pinned offline.
//
// WHY THIS EXISTS. The operator ratified propose-and-apply for the delegate and asked for real control
// over the team's queue (2026-11-12T17:5xZ). The risk that has to be engineered away is the one the
// operator named — an inconsistent queue state — and the rig already HAS one: `workable()` treats a
// CANCELLED prerequisite as positive non-workability (lead-ratified, #2677 "terminal != done"), so a
// dependent of a cancelled row can never be claimed, and nothing repairs it. `tools/queue-drain-audit.mjs`
// found 151 such rows, and the first hour of the operator's own zero-build close stranded two more
// (#3503 and #5885, both gated on cancelled #3377).
//
// This demo pins the three things that decide whether giving a delegate apply-authority is safe:
//   1. the CENSUS is exactly "gated on a cancelled row" — not `done` (already satisfied), not `open`
//      (ordinary back-pressure), not an unknown id (the documented conservative default);
//   2. every PLAN is computed before anything is written, so propose and apply are one code path —
//      a plan that cannot say exactly which transitions it appends has no business applying;
//   3. the guardrails: a lease on every priority, a refusal on a CLAIMED row, and a cancel that NAMES the
//      dependents it would strand instead of stranding them silently.
//
// Run: node demo/queue-ops.test.mjs   (exit 0 = pass)

import assert from "node:assert/strict";
import {
  CONFIRM_THRESHOLD,
  planCancel,
  planPriority,
  planQueueAction,
  planRelease,
  planRepairGates,
  confirmGate,
  strandedGates,
} from "../src/queueops.mjs";

const AT = "2026-11-12T18:00:00.000Z";
const SOON = "2026-11-13T06:00:00.000Z";

const item = (id, status, extra = {}) => ({ id: String(id), status, to: "impl", from: "pm", subject: `row ${id}`, transitions: [], ...extra });

console.log("=== 1. THE CENSUS IS 'GATED ON A CANCELLED ROW', AND NOTHING ELSE ===");
{
  const items = [
    item(1, "cancelled"),
    item(2, "done"),
    item(3, "queued", { blockedBy: ["1"] }), // STRANDED: cancelled gate
    item(4, "queued", { blockedBy: ["2"] }), // satisfied: done
    item(5, "queued", { blockedBy: ["6"] }), // open gate: ordinary back-pressure
    item(6, "claimed"),
    item(7, "queued", { blockedBy: ["999"] }), // unknown id: conservative default = workable
    item(8, "cancelled", { blockedBy: ["1"] }), // a cancelled row cannot be stranded
    item(9, "held", { blockedBy: ["1"] }), // a dead gate hides here longest
  ];
  const census = strandedGates(items);
  assert.deepEqual(census.rows.map((r) => r.id).sort(), ["3", "9"], "only rows gated on a CANCELLED row are stranded");
  assert.equal(census.count, 2);
  const r3 = census.rows.find((r) => r.id === "3");
  assert.equal(r3.gateId, "1", "the census names the DEAD GATE, so a repair can be targeted");
  assert.equal(r3.to, "impl", "and the seat, so the repair can be routed without reopening the store");
  console.log("  ok   cancelled gate stranded; done / open / unknown / terminal dependents are not");
}

console.log("\n=== 2. THE MEASURED CASE: #3503 AND #5885, GATED ON CANCELLED #3377 ===");
{
  // The shapes taken from the live rig (selfdev.sqlite, 2026-11-12T17:3xZ).
  const items = [
    item(3377, "cancelled", { subject: "LANDING LIST (docs-only) — scribe-item-1257 @fe1434e" }),
    item(3503, "held", { to: "scribe", blockedBy: ["3377"], subject: "REGISTERED (held, gated on #3377) — ledger row" }),
    item(5885, "held", { to: "pm", blockedBy: ["3377"], subject: "SUCCESSOR to #5322 (parked, gated on #3377)" }),
  ];
  const census = strandedGates(items);
  assert.deepEqual(census.rows.map((r) => r.id).sort(), ["3503", "5885"], "both live casualties are found");
  const plan = planRepairGates(items, { at: AT, from: "delegate", reason: "prerequisite cancelled during the zero-build close" });
  assert.equal(plan.ok, true);
  assert.equal(plan.changes.length, 2);
  assert.deepEqual(plan.changes[0].gateReleased, ["3377"], "the repair releases the DEAD gate by id");
  assert.equal(plan.transitions[0].event, "gate-released");
  assert.equal(plan.transitions[0].by, "delegate");
  assert.equal(plan.transitions[0].authority, "delegate (operator-authorised)", "the transition carries the AUTHORITY, not just the name");
  console.log("  ok   both casualties are found and the repair names the gate, the actor and the authority");
}

console.log("\n=== 3. A REPAIR ONLY REMOVES A DEAD GATE — IT IS NOT A CHAIN EDITOR ===");
{
  const items = [item(1, "cancelled"), item(2, "queued"), item(3, "queued", { blockedBy: ["1", "2"] })];
  const plan = planRepairGates(items, { at: AT });
  assert.deepEqual(plan.changes[0].gateReleased, ["1"], "only the cancelled gate is released; the live one stays");
  const refusal = planRepairGates(items, { at: AT, ids: ["2"] });
  assert.equal(refusal.ok, false, "repairing a row with no dead gate is refused");
  assert.match(refusal.refusal, /not gated on a cancelled row/, "and the refusal says why");
  const empty = planRepairGates([item(1, "cancelled"), item(2, "queued")], { at: AT });
  assert.equal(empty.ok, true);
  assert.equal(empty.changes.length, 0, "a clean queue repairs nothing rather than erroring");
  console.log("  ok   dead gate released, live gate kept, non-stranded id refused, clean queue is a no-op");
}

console.log("\n=== 4. PRIORITY IS A LEASE, AND A CLAIMED ROW IS NOT REORDERABLE ===");
{
  const items = [item(10, "queued"), item(11, "held"), item(12, "claimed")];
  const good = planPriority(items, { ids: ["10", "11"], priority: "now", reason: "operator: landing is the priority", expiresAt: SOON, at: AT, from: "delegate" });
  assert.equal(good.ok, true);
  assert.equal(good.changes.length, 2);
  assert.equal(good.transitions[0].event, "priority");
  assert.equal(good.transitions[0].authority, "delegate (operator-authorised)");
  assert.equal(good.lease.expiresAt, SOON);

  assert.equal(planPriority(items, { ids: ["10"], priority: "urgent", reason: "x", expiresAt: SOON, at: AT }).ok, false, "an unknown priority value is refused");
  assert.equal(planPriority(items, { ids: ["10"], priority: "now", expiresAt: SOON, at: AT }).ok, false, "a priority without a reason is refused");
  assert.equal(planPriority(items, { ids: ["10"], priority: "now", reason: "x", at: AT }).ok, false, "a priority without an expiry is refused (a lease, not a flag)");
  assert.equal(planPriority(items, { ids: ["10"], priority: "now", reason: "x", expiresAt: "2026-11-01T00:00:00.000Z", at: AT }).ok, false, "an expiry in the past is refused");
  assert.equal(
    planPriority(items, { ids: ["10"], priority: "now", reason: "x", expiresAt: "2027-12-01T00:00:00.000Z", at: AT }).ok,
    false,
    "a 30-day-plus lease is refused (urgency cannot become a permanent park)",
  );
  const claimed = planPriority(items, { ids: ["12"], priority: "now", reason: "x", expiresAt: SOON, at: AT });
  assert.equal(claimed.ok, false, "a CLAIMED row is refused: ordering it races the turn acting on it");
  assert.match(claimed.refusal, /claimed/);
  console.log("  ok   2 rows leased; bad value, no reason, no expiry, past expiry, >30 d and claimed all refused");
}

console.log("\n=== 5. A CANCEL NAMES WHAT IT WOULD STRAND — the defect that created this module ===");
{
  const items = [
    item(3377, "queued"),
    item(3503, "held", { blockedBy: ["3377"] }),
    item(5885, "held", { blockedBy: ["3377"] }),
    item(9000, "queued", { blockedBy: ["3378"] }),
    item(3378, "queued"),
  ];
  const plan = planCancel(items, { ids: ["3377"], reason: "superseded by the per-bin landing", at: AT, from: "delegate" });
  assert.equal(plan.ok, true);
  assert.equal(plan.changes.length, 1);
  assert.deepEqual(plan.strands.map((s) => s.id).sort(), ["3503", "5885"], "the two dependents are NAMED before the cancel lands");
  assert.equal(plan.strands[0].gateId, "3377", "each strand names the gate that would kill it");
  assert.equal(plan.transitions[0].event, "cancelled");
  assert.equal(plan.transitions[0].authority, "delegate (operator-authorised)");

  const together = planCancel(items, { ids: ["3377", "3503"], reason: "both retired", at: AT });
  assert.deepEqual(together.strands.map((s) => s.id), ["5885"], "a dependent cancelled in the same apply is not reported as stranded");

  const claimed = planCancel([item(5, "claimed")], { ids: ["5"], reason: "x", at: AT });
  assert.equal(claimed.ok, false, "a CLAIMED row is refused");
  assert.match(claimed.refusal, /preempt/, "and the refusal names the mechanism that IS safe");
  assert.equal(planCancel(items, { ids: ["3377"], at: AT }).ok, false, "a cancel without a reason is refused");
  assert.equal(planCancel(items, { ids: ["424242"], reason: "x", at: AT }).ok, false, "an unknown id is refused");
  console.log("  ok   dependents named (not stranded), same-apply cancels excluded, claimed/unknown/reasonless refused");
}

console.log("\n=== 6. RELEASE UN-PARKS A ROW AND RECORDS WHO IT WAS WAITING ON ===");
{
  // 493 rows were `deferredTo: "human"` on the live rig (median age 5 days, 84 of them landing work). A
  // row parked on a human for a decision the human has already given is not waiting — it is stuck.
  const rows = [item(60, "deferred", { deferredTo: "human" }), item(61, "held"), item(62, "claimed"), item(63, "queued"), item(64, "done")];
  const plan = planRelease(rows, { ids: ["60", "61"], reason: "the decision this waited on is the standing directive", at: AT, from: "delegate" });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.changes.map((c) => [c.id, c.from, c.to]), [["60", "deferred", "queued"], ["61", "held", "queued"]], "deferred and held rows both return to queued");
  assert.equal(plan.transitions[0].event, "released");
  assert.equal(plan.transitions[0].from, "human", "the transition records the audience it LEFT, so the park is not erased from the record");
  assert.equal(plan.transitions[1].from, undefined, "a held row had no audience, and none is invented");
  assert.equal(plan.transitions[0].authority, "delegate (operator-authorised)");
  assert.equal(planRelease(rows, { ids: ["62"], reason: "x", at: AT }).ok, false, "a CLAIMED row is refused: it is in flight");
  assert.match(planRelease(rows, { ids: ["62"], reason: "x", at: AT }).refusal, /claimed/);
  assert.equal(planRelease(rows, { ids: ["64"], reason: "x", at: AT }).ok, false, "a terminal row is refused");
  assert.equal(planRelease(rows, { ids: ["60"], at: AT }).ok, false, "a release without a reason is refused");
  console.log("  ok   deferred/held -> queued with the audience recorded; claimed/terminal/reasonless refused");
}

console.log("\n=== 7. BLAST RADIUS, AND THE DISPATCH ===");
{
  const many = Array.from({ length: CONFIRM_THRESHOLD + 1 }, (_, i) => item(1000 + i, "queued"));
  const big = planPriority(many, { ids: many.map((r) => r.id), priority: "now", reason: "x", expiresAt: SOON, at: AT });
  assert.equal(big.ok, true);
  assert.equal(confirmGate(big, {}).ok, false, `a plan over ${CONFIRM_THRESHOLD} rows needs explicit confirmation`);
  assert.match(confirmGate(big, {}).refusal, new RegExp(`${CONFIRM_THRESHOLD + 1} rows`), "and the refusal states the size");
  assert.equal(confirmGate(big, { confirm: true }).ok, true, "with confirmation it proceeds");
  assert.equal(confirmGate(planPriority([item(1, "queued")], { ids: ["1"], priority: "now", reason: "x", expiresAt: SOON, at: AT }), {}).ok, true, "a small plan needs no confirmation");

  assert.equal(planQueueAction("nope", [], {}).ok, false, "an unknown action is refused");
  assert.equal(planQueueAction("stranded", [item(1, "cancelled"), item(2, "queued", { blockedBy: ["1"] })], {}).census.count, 1, "the stranded action is the census");
  console.log("  ok   >threshold refuses until confirmed; dispatch refuses an unknown action");
}

console.log("\nQUEUE-OPS PASS — the census has a reader, every change is a plan with its transitions, and a cancel cannot hide what it strands");

console.log("\n=== 7. THE CENSUS HAS A READER: `check` FINDS A STRANDED GATE ===");
{
  // The defect this module exists for is that a tool printed the census and NOTHING consumed it, so
  // 151 stranded rows accrued for weeks. This is the negative control for the `stranded-gate` rule
  // (registered in demo/starter.test.mjs CONTROL_FOR): the SAME census drives the audit, so `check` and
  // the repair verb can never disagree about which rows are stranded.
  const { auditRig, RULES } = await import("../src/checkup.mjs");
  assert.ok(RULES.some((r) => r.id === "stranded-gate"), "the rule is declared");
  const rigArgs = (queueItems) => ({
    rig: "rig.json",
    spec: { seats: [{ name: "impl", role: "implementation engineer" }], edges: [] },
    specConstitution: "constitution",
    stored: { reason: "read", text: "constitution" },
    storedSeats: ["impl"],
    modelsBySeat: { impl: "faux/model-a" },
    runbooks: [],
    queueItems,
  });
  const stranded = auditRig(rigArgs([item(3377, "cancelled"), item(3503, "held", { blockedBy: ["3377"] })]));
  const finding = stranded.findings.find((f) => f.id === "stranded-gate");
  assert.ok(finding, "a row gated on a cancelled row is REPORTED, so the census has a reader");
  assert.match(finding.detail, /#3377/, "the finding names the dead gate");
  assert.match(finding.fix, /repair-gates/, "and the fix names the repair verb");
  assert.equal(finding.severity, "fix-now", "fix-now on purpose: 151 findings must not make `check` exit 1 forever");
  const clean = auditRig(rigArgs([item(1, "cancelled"), item(2, "done"), item(3, "queued", { blockedBy: ["2"] })]));
  assert.equal(clean.findings.some((f) => f.id === "stranded-gate"), false, "a healthy chain produces no finding");
  console.log("  ok   `check` reports the stranded row, names the gate and the repair; a healthy chain is quiet");
}
