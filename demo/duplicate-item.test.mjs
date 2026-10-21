// demo/duplicate-item.test.mjs — prove #4075: the claim-time duplicate check is SAME-INTENT
// (same from/to/tier + high subject overlap), NOT byte equality.
//
// WHY THE TEST IS SHAPED THIS WAY, and it is the whole point of the item: the duplicate's cause is
// a ~10s retry OUTSIDE durig's source, so a re-issue carries a NEW tool-call id and #3192's
// originCallId dedup cannot catch it. TWO OF FIVE OBSERVED PAIRS ARE REWORDED, not replayed — a
// byte-equality test would MISS both. So the decisive assertion here is the REWORDED pair.
//
// The rule fires on a NON-TERMINAL item (a seat about to work it), naming the terminal twin.
//
// Run: node demo/duplicate-item.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";

import { auditRig, sameIntent, subjectOverlap, isTerminalStatus } from "../src/checkup.mjs";

const SPEC = {
	version: 2,
	seats: [
		{ name: "author", role: "implementation engineer", capabilities: ["implement", "code"], model: "faux/m1" },
		{ name: "qa", role: "independent verifier", capabilities: ["verify"], model: "faux/m2" },
	],
	edges: [
		{ from: "author", maySendTo: ["qa"] },
		{ from: "qa", maySendTo: ["author"] },
	],
	constitutionInline: "# constitution\nbe good\n",
};
const BASE = {
	rig: "rig.json",
	spec: SPEC,
	specConstitution: SPEC.constitutionInline,
	stored: { reason: "read", text: SPEC.constitutionInline },
	storedSeats: ["author", "qa"],
	modelsBySeat: { author: "faux/m1", qa: "faux/m2" },
};
const hasFinding = (result, id) => (result.findings ?? []).some((f) => f.id === id);
const ruleStatus = (result, id) => (result.checks ?? []).find((c) => c.id === id)?.status;
const audit = (queueItems) => auditRig({ ...BASE, queueItems });

/* ─── 1. the intent helpers ──────────────────────────────────────────────── */
console.log("\nhelpers — sameIntent / subjectOverlap / isTerminalStatus");
assert.equal(isTerminalStatus({ status: "done" }), true, "done is terminal");
assert.equal(isTerminalStatus({ status: "cancelled" }), true, "cancelled is terminal");
assert.equal(isTerminalStatus({ status: "claimed" }), false, "claimed is not terminal");
assert.equal(isTerminalStatus({ status: "held" }), false, "held is not terminal");

assert.equal(subjectOverlap("update the skill path references", "update skill path references"), 1, "near-identical subjects overlap fully");
assert.ok(subjectOverlap("update the skill path references", "refresh the skill path names") > 0, "shared content words overlap");
assert.equal(subjectOverlap("add a widget", "rotate the logs"), 0, "unrelated subjects do not overlap");

const A = { id: 1, from: "pm", to: "devtools", tier: "small", subject: "update skill path references", status: "done" };
assert.equal(sameIntent(A, { ...A, id: 2, status: "queued" }), true, "same from/to/tier + overlap is same-intent");
assert.equal(sameIntent(A, { ...A, id: 2, to: "impl" }), false, "a different `to` is NOT same-intent");
assert.equal(sameIntent(A, { ...A, id: 2, from: "lead" }), false, "a different `from` is NOT same-intent");
assert.equal(sameIntent(A, { ...A, id: 2, tier: "feature" }), false, "a different tier is NOT same-intent");
assert.equal(sameIntent(A, { ...A, id: 2, subject: "rotate the logs" }), false, "low overlap is NOT same-intent");
assert.equal(sameIntent(A, { ...A, id: 1 }), false, "an item is not its own twin");
console.log("  ok   the helpers");

/* ─── 2. THE DECISIVE CASE: a REWORDED pair is still caught ──────────────── */
console.log("\nthe REWORDED pair (what byte equality would MISS)");
const reworded = audit([
	{ id: 41, from: "pm", to: "devtools", tier: "small", status: "done", subject: "update skill path references to S1 names" },
	{ id: 42, from: "pm", to: "devtools", tier: "small", status: "queued", subject: "update the skill path references to S1 names" },
]);
assert.equal(hasFinding(reworded, "duplicate-item"), true, "a REWORDED same-intent pair is a finding (byte equality would miss it)");
assert.equal(ruleStatus(reworded, "duplicate-item"), "fail", "the rule fails for it");
const rw = reworded.findings.find((f) => f.id === "duplicate-item");
assert.match(rw.detail, /#42/, "the finding names the non-terminal item");
assert.match(rw.detail, /#41/, "the finding names the terminal twin");
console.log("  ok   reworded pair caught");

/* ─── 3. a byte-identical replay is also caught (the strongest signal) ───── */
console.log("\nthe byte-identical replay");
const replay = audit([
	{ id: 51, from: "pm", to: "devtools", tier: "small", status: "cancelled", subject: "exactly the same words" },
	{ id: 52, from: "pm", to: "devtools", tier: "small", status: "claimed", subject: "exactly the same words" },
]);
assert.equal(hasFinding(replay, "duplicate-item"), true, "a byte-identical replay is a finding");
console.log("  ok   replay caught");

/* ─── 4. the negatives: no finding when intent differs ──────────────────── */
console.log("\nno finding when the intent differs");
const diffTo = audit([
	{ id: 61, from: "pm", to: "devtools", tier: "small", status: "done", subject: "update skill path references" },
	{ id: 62, from: "pm", to: "impl", tier: "small", status: "queued", subject: "update skill path references" },
]);
assert.equal(hasFinding(diffTo, "duplicate-item"), false, "a different `to` is a different intent");
const diffTier = audit([
	{ id: 71, from: "pm", to: "devtools", tier: "small", status: "done", subject: "update skill path references" },
	{ id: 72, from: "pm", to: "devtools", tier: "feature", status: "queued", subject: "update skill path references" },
]);
assert.equal(hasFinding(diffTier, "duplicate-item"), false, "a different tier is a different intent");
const diffSubject = audit([
	{ id: 81, from: "pm", to: "devtools", tier: "small", status: "done", subject: "update skill path references" },
	{ id: 82, from: "pm", to: "devtools", tier: "small", status: "queued", subject: "rotate the broker logs nightly" },
]);
assert.equal(hasFinding(diffSubject, "duplicate-item"), false, "unrelated subjects are not a duplicate");
const bothLive = audit([
	{ id: 91, from: "pm", to: "devtools", tier: "small", status: "queued", subject: "update skill path references" },
	{ id: 92, from: "pm", to: "devtools", tier: "small", status: "claimed", subject: "update skill path references" },
]);
assert.equal(hasFinding(bothLive, "duplicate-item"), false, "two LIVE twins are not the case — the rule needs an already-TERMINAL twin");
console.log("  ok   negatives hold");

/* ─── 5. unreadable queue → SKIPPED, never a silent pass (D25) ──────────── */
console.log("\nthe queue could not be read");
const unread = auditRig({ ...BASE, queueItems: null });
assert.equal(ruleStatus(unread, "duplicate-item"), "skipped", "the rule is skipped when the queue cannot be read");
assert.ok(unread.checks.find((c) => c.id === "duplicate-item")?.why, "the skip says why");
console.log("  ok   skipped with a reason");

console.log("\nPASS — the duplicate check is same-intent, fires on the non-terminal twin, and catches a REWORDED pair");
