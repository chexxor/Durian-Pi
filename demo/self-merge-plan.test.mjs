// demo/self-merge-plan.test.mjs — the seat's self-merge verb and the check-rule seam, with no repo and no model.
//
// WHY THIS EXISTS. `extensions/self-merge.mjs` is the D212 answer to "the author never lands their own work":
// the policy lives on the extension plane, and the base only has to provide the SHAPE for it. Two things must
// be pinned, and neither needs a git repo or a provider:
//   A. the PLAN the seat runs — what is refused, and what the argv is. A seat must never be able to build a
//      command that pushes, lands `main` into itself, or lands a branch it does not own.
//   B. the SEAM — `cli.mjs check`'s audit can take rules from a loaded extension, and a rule that reports a
//      stale ready ref makes `check` exit 1. Without this demo the seam is asserted, not shown.
//
// Run: node demo/self-merge-plan.test.mjs   (measured 2026-11-14, Linux Fedora Linux 45, kernel
// 7.2.15-300.fc45.x86_64, node v24.22.1 — under 1 s; no store, no broker, no model)
import assert from "node:assert";
import { auditRig } from "../src/checkup.mjs";
import { buildSelfMergePlan, SELF_MERGE_RULE } from "../extensions/self-merge.mjs";

const ROOT = "/repo/shared";

console.log("=== A. the plan: what a seat may and may not run ===");
{
	const good = buildSelfMergePlan({ sharedRoot: ROOT, branch: "item-42", db: "./selfdev.sqlite", heldItemIds: [42], gate: "changed-suite" });
	assert.ok(good.ok, "a seat landing the item it holds is allowed");
	assert.deepEqual(good.argv, ["node", "scripts/land.mjs", "item-42", "--repo", ROOT, "--db", "./selfdev.sqlite", "--changed-suite"], "the verb is the rig's own chokepoint, with the shared root and the store named");
	assert.ok(!good.argv.some((t) => /push/i.test(t)), "the plan cannot contain a push — publishing is the operator's grant");
	assert.ok(good.argv.includes("scripts/land.mjs"), "the seat never hand-merges: it calls the helper that refuses a dirty shared tree and a red gate");
	console.log("  ok   own branch -> land.mjs with the shared root, no push");

	for (const [bad, why] of [
		[{ branch: "main" }, "main is the target, not a branch to land"],
		[{ branch: "" }, "no branch given"],
		[{ branch: "item-99", heldItemIds: [42] }, "a branch for an item this seat does not hold"],
		[{ branch: "wip/foreign-fork", heldItemIds: [42] }, "a branch naming no item id cannot be shown to be the seat's"],
		[{ branch: "item-42", gate: "none" }, "an unknown gate is not a weaker gate, it is no gate"],
	]) {
		const r = buildSelfMergePlan({ sharedRoot: ROOT, db: "./x.sqlite", ...bad });
		assert.equal(r.ok, false, `refused: ${why}`);
		assert.ok(r.refusals.length, "and the refusal says why, so the seat learns the rule instead of guessing");
	}
	console.log("  ok   five refusals, each with a reason");

	const full = buildSelfMergePlan({ sharedRoot: ROOT, branch: "item-42", db: "./x.sqlite", heldItemIds: [42], gate: "suite" });
	assert.ok(full.argv.includes("--suite"), "the full gate is selectable, so a seat can pay for the stronger proof");
	assert.ok(!full.argv.includes("--changed-suite"), "and it is one or the other, never neither");
	console.log("  ok   the gate flag is explicit");
}

console.log("\n=== B. the seam: an extension rule enters the audit like a base rule ===");
{
	const base = { rig: "rig.json", spec: { seats: [] }, specConstitution: "shared norms", stored: { reason: "read", text: "shared norms" }, runbooks: [] };

	const red = auditRig({ ...base, extensionRules: [SELF_MERGE_RULE], extensionFindings: [{ id: SELF_MERGE_RULE.id, subject: "item-101", detail: "ready 48 h, SLA 24 h", fix: "node scripts/land.mjs item-101 --changed-suite" }] });
	const rule = red.checks.find((c) => c.id === SELF_MERGE_RULE.id);
	assert.ok(rule, "the extension rule appears in the checks list, not only in the findings");
	assert.equal(rule.status, "fail", "a stale ready ref is a FAIL, not a note");
	assert.equal(rule.found, 1, "and the count is the number of refs named");
	assert.equal(red.summary.error, 1, "error severity is what makes check exit non-zero");
	assert.equal(red.exitCode, 1, "so a gate can act on the exit code without parsing prose");
	console.log("  ok   one stale ref -> checks fail, summary.error 1, exitCode 1");

	const green = auditRig({ ...base, extensionRules: [SELF_MERGE_RULE], extensionFindings: [] });
	assert.equal(green.checks.find((c) => c.id === SELF_MERGE_RULE.id).status, "pass", "nothing overdue -> the rule passes");
	assert.equal(green.exitCode, 0, "and check does not go red for a clean backlog");
	console.log("  ok   no findings -> pass, exit 0");

	const blind = auditRig({ ...base, extensionRules: [SELF_MERGE_RULE], extensionSkipped: [{ id: SELF_MERGE_RULE.id, why: "git could not be read in this checkout" }] });
	const skipped = blind.checks.find((c) => c.id === SELF_MERGE_RULE.id);
	assert.equal(skipped.status, "skipped", "a rule that could not measure says so");
	assert.ok(skipped.why, "with the reason attached");
	assert.equal(blind.exitCode, 0, "skipped is NOT a pass and is NOT a failure — it is a named state (the #3539 blind-pass shape)");
	console.log("  ok   unmeasurable -> status skipped with a why, exit stays 0");

	const unknown = auditRig({ ...base, extensionRules: [SELF_MERGE_RULE], extensionSkipped: [{ id: SELF_MERGE_RULE.id, why: "the check threw", unknown: true }] });
	assert.equal(unknown.checks.find((c) => c.id === SELF_MERGE_RULE.id).status, "unknown", "a thrown check is UNKNOWN, never silently passed");
	console.log("  ok   a thrown check reads unknown, not clean");

	assert.ok(SELF_MERGE_RULE.severity === "error", "the rule is error-severity on purpose: landing debt is not advisory");
	assert.ok(typeof SELF_MERGE_RULE.what === "string" && SELF_MERGE_RULE.what.length > 0, "every rule names what it measures");
	console.log("  ok   severity and what are declared");
}

console.log("\nSELF-MERGE PLAN + SEAM OK");
