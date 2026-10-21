// demo/shared-tree-on-main.test.mjs — the `shared-tree-on-main` check rule, and the git
// reader that feeds it.
//
// A seat whose cwd fell back to the shared tree can switch it onto its item branch, which breaks
// the landing basis and lets "live" writes land on a feature branch (2026-10-19, devtools #2412 -
// docs/incidents/2026-10-17-seat-root-fallback-commit.md). `auditRig` stays PURE: the caller reads
// the branch (src/featuredocs.mjs) and passes plain data, so this test drives the rule with CRAFTED
// data and no repository, then exercises the real reader against a throwaway repo.
//
// FAILING-FIRST: before the rule existed, `shared-tree-on-main` was not in RULES and auditRig
// ignored `sharedTreeBranch`, so the assertions below fail.
//
// FAILING-FIRST (the landing-gate regression, #2679): `scripts/land.mjs --suite` runs the suite in
// a DETACHED scratch worktree. There the branch reads as "", the rule fired, and the helper refused
// EVERY landing. The rule must IGNORE a linked worktree (a landing scratch or a seat/item worktree)
// while still firing on the SHARED tree off main. Sections 6b/6c/7b below fail before that fix.
//
// Run: node demo/shared-tree-on-main.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RULES, auditRig, formatCheck } from "../src/checkup.mjs";
import { isLinkedWorktree, readSharedTreeBranch } from "../src/featuredocs.mjs";

// A rig whose OTHER rules all pass, so any finding below is a shared-tree finding.
const CONSTITUTION = "shared norms";
const base = {
	rig: "rig.json",
	spec: {
		seats: [
			{ name: "alpha", role: "author", capabilities: ["implement"] },
			{ name: "verifier", role: "independent verifier", capabilities: ["verify"] },
		],
		edges: [
			{ from: "alpha", maySendTo: ["verifier"] },
			{ from: "verifier", maySendTo: ["alpha"] },
		],
	},
	specConstitution: CONSTITUTION,
	stored: { reason: "read", text: CONSTITUTION },
	storedSeats: ["alpha", "verifier"],
	modelsBySeat: { alpha: "faux/model-a", verifier: "faux/model-b" },
};
const audit = (sharedTreeBranch) => auditRig({ ...base, sharedTreeBranch });
const auditLinked = (sharedTreeBranch, sharedTreeLinked) => auditRig({ ...base, sharedTreeBranch, sharedTreeLinked });
const ids = (r) => r.findings.map((f) => f.id);
const checkFor = (r, id) => (r.checks ?? []).find((c) => c.id === id);

/* 1. the rule exists with error severity ----------------------------------- */
const rule = new Map(RULES.map((r) => [r.id, r])).get("shared-tree-on-main");
assert.ok(rule, "shared-tree-on-main is a rule");
assert.equal(rule.severity, "error", "a shared tree off the integration branch must fail a run");

/* 2. an item branch on the shared tree FAILS, naming the branch ------------- */
const drifted = audit("devtools-item-2412");
assert.ok(ids(drifted).includes("shared-tree-on-main"), `an off-main shared tree is reported; got ${ids(drifted).join(", ")}`);
const finding = drifted.findings.find((f) => f.id === "shared-tree-on-main");
assert.equal(finding.severity, "error");
assert.match(finding.subject, /devtools-item-2412/, "the subject names the branch");
assert.match(finding.detail, /not "main"/, "the detail names the expected branch");
assert.equal(checkFor(drifted, "shared-tree-on-main").status, "fail");
assert.equal(drifted.pass, false, "an error fails the run");
assert.equal(drifted.exitCode, 1);
console.log("  ok   an item branch on the shared tree FAILS (error, names the branch)");

/* 3. a detached HEAD is the same condition, and reads legibly --------------- */
const detached = audit("");
assert.ok(ids(detached).includes("shared-tree-on-main"), "a detached shared tree is reported");
assert.match(detached.findings.find((f) => f.id === "shared-tree-on-main").detail, /detached HEAD/, "the detail names the detached state");
console.log("  ok   a detached HEAD FAILS (and says so)");

/* 4. the integration branch PASSES ----------------------------------------- */
const onMain = audit("main");
assert.deepEqual(ids(onMain), [], `a shared tree on main passes; got ${ids(onMain).join(", ")}`);
assert.equal(checkFor(onMain, "shared-tree-on-main").status, "pass");
console.log("  ok   the shared tree on main passes");

/* 5. legible silence: no branch supplied -> SKIPPED with a reason ----------- */
const none = audit(undefined);
assert.equal(checkFor(none, "shared-tree-on-main").status, "skipped", "no data is SKIPPED, never passed");
assert.ok(checkFor(none, "shared-tree-on-main").why, "the skip says why");
assert.deepEqual(ids(none), [], "and reports no finding it cannot ground");
console.log("  ok   no branch supplied => SKIPPED with a reason");

/* 6. the human render names the rule and its fix --------------------------- */
const rendered = formatCheck(drifted, { rigDisplay: "rig.json", color: false, seats: 2, storeReason: "read" });
assert.match(rendered, /shared-tree-on-main/, "the render names the rule");
assert.match(rendered, /switch the shared tree back/, "the render carries the fix");
console.log("  ok   the render names the rule and its fix");

/* 6b. a LINKED worktree is IGNORED (#2679): a landing scratch is detached and a seat worktree is on
 *     its item branch; neither is the SHARED tree, so the rule is SKIPPED with a reason, never
 *     fired. Before the fix the scratch made the rule refuse EVERY landing. */
const linkedDetached = auditLinked("", true);
assert.deepEqual(ids(linkedDetached), [], `a linked detached scratch reports nothing; got ${ids(linkedDetached).join(", ")}`);
assert.equal(checkFor(linkedDetached, "shared-tree-on-main").status, "skipped", "a linked worktree SKIPS the rule, never passes it");
assert.ok(checkFor(linkedDetached, "shared-tree-on-main").why, "the skip says why");
assert.equal(linkedDetached.exitCode, 0, "a linked worktree does not fail the run");
const linkedSeat = auditLinked("impl-item-2679", true);
assert.deepEqual(ids(linkedSeat), [], "a linked seat worktree on its item branch reports nothing");
assert.equal(checkFor(linkedSeat, "shared-tree-on-main").status, "skipped", "and it is skipped there too");
console.log("  ok   a LINKED worktree is ignored (detached scratch + item branch), so landings pass");

/* 6c. the exemption cannot be widened by omission: with the flag off, the SAME off-main branch
 *     still FIRES, so only an explicit linked worktree is exempt. */
const sharedOffMain = auditLinked("devtools-item-2412", false);
assert.ok(ids(sharedOffMain).includes("shared-tree-on-main"), "the shared tree off main still fires with linked=false");
assert.equal(checkFor(sharedOffMain, "shared-tree-on-main").status, "fail");
console.log("  ok   the shared tree off main still fires (linked=false)");

/* 7. the REAL reader: a throwaway repo, read through git ------------------- */
const repo = mkdtempSync(join(tmpdir(), "durig-sharedtree-"));
const git = (args) => spawnSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
try {
	git(["init", "-q"]);
	git(["config", "user.email", "t@t"]);
	git(["config", "user.name", "t"]);
	git(["checkout", "-q", "-b", "main"]);
	writeFileSync(join(repo, "a.txt"), "x\n");
	git(["add", "a.txt"]);
	git(["commit", "-qm", "init"]);
	assert.equal(readSharedTreeBranch({ root: repo }), "main", "the integration branch reads back");
	git(["checkout", "-q", "-b", "devtools-item-2412"]);
	assert.equal(readSharedTreeBranch({ root: repo }), "devtools-item-2412", "an item branch reads back");
	git(["checkout", "-q", "--detach"]);
	assert.equal(readSharedTreeBranch({ root: repo }), "", "a detached HEAD reads as the empty branch");
	assert.equal(readSharedTreeBranch({ root: join(repo, "nope") }), null, "an unreadable repo is null, never an empty pass");
	console.log("  ok   readSharedTreeBranch reads a real repo (main / feature / detached / absent)");

	/* 7b. the linked-worktree reader the CLI passes to auditRig (#2679): the shared tree is NOT
	 *     linked; a `git worktree add` scratch (what scripts/land.mjs creates) IS. */
	assert.equal(isLinkedWorktree({ root: repo }), false, "the shared tree is not a linked worktree");
	const linkedPath = join(tmpdir(), `durig-sharedtree-linked-${process.pid}`);
	const addLinked = git(["worktree", "add", "--detach", linkedPath, "HEAD"]);
	assert.equal(addLinked.status, 0, `worktree add failed: ${addLinked.stderr}`);
	try {
		assert.equal(isLinkedWorktree({ root: linkedPath }), true, "a linked worktree is detected");
		assert.equal(isLinkedWorktree({ root: join(linkedPath, "nope") }), null, "an unreadable repo is null, never false");
		console.log("  ok   isLinkedWorktree tells a linked worktree from the shared tree");
	} finally {
		git(["worktree", "remove", "--force", linkedPath]);
		rmSync(linkedPath, { recursive: true, force: true });
	}
} finally {
	rmSync(repo, { recursive: true, force: true });
}

console.log("\nSHARED-TREE-ON-MAIN TEST PASS (off-main fails, main passes, absent skipped, real git read)");
process.exit(0);
