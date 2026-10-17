// demo/feature-row.test.mjs — ROADMAP 46 (FEATURES-row half) / D62: the
// `feature-row-missing` check rule, and the git reader that feeds it.
//
// D62: every new/changed capability carries its own doc acceptance — the
// docs/FEATURES.md row — or its item records an explicit "no feature surface"
// note. The merge gate (docs/runbooks/merge.md) enforces this by hand with a
// `git log --grep '^feat'` sweep; a prose gate goes stale, so it is a `check`
// rule now. auditRig stays PURE: the caller reads git (src/featuredocs.mjs) and
// passes plain data, so this test drives the rule with CRAFTED data and no
// repository, then exercises the real reader against a throwaway repo.
//
// FAILING-FIRST: before the rule existed, `feature-row-missing` was not in
// RULES and auditRig ignored `featureDocs`, so the assertions below fail.
//
// Run: node demo/feature-row.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RULES, auditRig, formatCheck } from "../src/checkup.mjs";
import { FEATURES_DOC, parseFeatureLog, readFeatureDocs } from "../src/featuredocs.mjs";

// A rig whose OTHER rules all pass, so any finding below is a FEATURES-row finding.
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
const audit = (featureDocs) => auditRig({ ...base, featureDocs });
const ids = (r) => r.findings.map((f) => f.id);
const checkFor = (r, id) => (r.checks ?? []).find((c) => c.id === id);

/* 1. the rule exists with the D62 severity --------------------------------- */
const rule = new Map(RULES.map((r) => [r.id, r])).get("feature-row-missing");
assert.ok(rule, "feature-row-missing is a rule");
assert.equal(rule.severity, "fix-now", "a missing doc row does not stop the rig working, so it is fix-now");

/* 2. a feat commit with no FEATURES row and no note FAILS, naming the commit - */
const drifted = audit([
	{ sha: "a1b2c3d4e5f60718", subject: "feat(cli): add the frobnicate verb (#900)", touchedFeatures: false, noSurfaceNote: false },
]);
assert.ok(ids(drifted).includes("feature-row-missing"), `a drifted feat commit is reported; got ${ids(drifted).join(", ")}`);
const finding = drifted.findings.find((f) => f.id === "feature-row-missing");
assert.equal(finding.severity, "fix-now");
assert.match(finding.subject, /a1b2c3d4/, "the subject names the commit");
assert.match(finding.detail, /add the frobnicate verb/, "the detail names what landed");
assert.match(finding.detail, /docs\/FEATURES\.md/, "the detail names the doc that is missing");
assert.equal(checkFor(drifted, "feature-row-missing").status, "fail");
assert.equal(drifted.summary.error, 0, "fix-now never adds an error");
assert.equal(drifted.pass, true, "a fix-now finding never fails a run");
assert.equal(drifted.exitCode, 0);
console.log("  ok   a feat commit with no row FAILS (fix-now, names the commit)");

/* 3. the two ways to satisfy the gate PASS --------------------------------- */
const touched = audit([
	{ sha: "1111111111111111", subject: "feat(cli): add the verb (#901)", touchedFeatures: true, noSurfaceNote: false },
]);
assert.deepEqual(ids(touched), [], `a commit that touched the doc passes; got ${ids(touched).join(", ")}`);
assert.equal(checkFor(touched, "feature-row-missing").status, "pass");

const noted = audit([
	{ sha: "2222222222222222", subject: "feat(guard): internal wiring only (#902)", touchedFeatures: false, noSurfaceNote: true },
]);
assert.deepEqual(ids(noted), [], `a commit with a "no feature surface" note passes; got ${ids(noted).join(", ")}`);
assert.equal(checkFor(noted, "feature-row-missing").status, "pass");
console.log('  ok   a touched doc OR an explicit "no feature surface" note passes');

/* 4. an explicitly EMPTY history is a PASS (the caller read git and found none) */
const empty = audit([]);
assert.deepEqual(ids(empty), []);
assert.equal(checkFor(empty, "feature-row-missing").status, "pass");
console.log("  ok   an empty feat set passes");

/* 5. legible silence: no history supplied -> SKIPPED with a reason, never a false pass */
const none = audit(undefined);
assert.equal(checkFor(none, "feature-row-missing").status, "skipped", "no data is SKIPPED, never passed");
assert.ok(checkFor(none, "feature-row-missing").why, "the skip says why");
assert.deepEqual(ids(none), [], "and reports no finding it cannot ground");
console.log("  ok   no history => SKIPPED with a reason");

/* 6. the human render names the rule and its fix --------------------------- */
const rendered = formatCheck(drifted, { rigDisplay: "rig.json", color: false, seats: 2, storeReason: "read" });
assert.match(rendered, /feature-row-missing/, "the render names the rule");
assert.match(rendered, /fix: /, "the render carries the fix");
console.log("  ok   the render names the rule and its fix");

/* 7. the PURE parse: a git log maps to the rule's input -------------------- */
const RAW = [
	"@@@deadbeefcafe0001\x1ffeat(a): one (#1)",
	"",
	"src/a.mjs",
	"docs/FEATURES.md",
	"@@@deadbeefcafe0002\x1fchore: not a feat, never reaches the reader",
	"",
	"src/b.mjs",
].join("\n");
const parsed = parseFeatureLog(RAW);
assert.equal(parsed.length, 2, "one entry per commit record");
assert.deepEqual(parsed[0], {
	sha: "deadbeefcafe0001",
	subject: "feat(a): one (#1)",
	touchedFeatures: true,
	noSurfaceNote: false,
});
assert.equal(parsed[1].touchedFeatures, false, "a commit that did not touch the doc is false");
// The note can live in the ITEM rather than the commit: notesById resolves it by the #N in the subject.
const notedById = parseFeatureLog(RAW, { notesById: { 1: true } });
assert.equal(notedById[0].noSurfaceNote, true, "notesById marks the item's #N");
// ...and a note in the commit subject is honoured too.
assert.equal(parseFeatureLog("@@@abc\x1ffeat(x): no feature surface here\n").at(0).noSurfaceNote, true);
console.log("  ok   parseFeatureLog maps a git log to the rule's input");

/* 8. the REAL reader: a throwaway repo, read through git ------------------- */
const repo = mkdtempSync(join(tmpdir(), "durig-featrow-"));
const git = (args) => spawnSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
try {
	git(["init", "-q"]);
	git(["config", "user.email", "t@t"]);
	git(["config", "user.name", "t"]);
	mkdirSync(join(repo, "docs"), { recursive: true });
	writeFileSync(join(repo, "src-a.mjs"), "// a\n");
	git(["add", "."]);
	git(["commit", "-qm", "feat(a): no doc row (#1)"]);
	writeFileSync(join(repo, FEATURES_DOC), "# features\n");
	writeFileSync(join(repo, "src-b.mjs"), "// b\n");
	git(["add", "."]);
	git(["commit", "-qm", "feat(b): carries its row (#2)"]);
	writeFileSync(join(repo, "chore.mjs"), "// c\n");
	git(["add", "."]);
	git(["commit", "-qm", "chore: not a feat commit (#3)"]);

	const read = readFeatureDocs({ root: repo });
	assert.ok(Array.isArray(read), "the reader returns entries for a real repo");
	assert.equal(read.length, 2, `only the two feat commits are read; got ${read.length}`);
	const first = read.find((e) => e.subject.includes("#1"));
	const second = read.find((e) => e.subject.includes("#2"));
	assert.equal(first.touchedFeatures, false, "the first feat commit did not touch docs/FEATURES.md");
	assert.equal(second.touchedFeatures, true, "the second feat commit did touch docs/FEATURES.md");
	// the reader's output drives the rule end to end
	const readAudit = audit(read);
	assert.equal(checkFor(readAudit, "feature-row-missing").status, "fail", "the real reader's output fails the rule");
	assert.match(readAudit.findings[0].detail, /no doc row/, "and names the drifted commit");
	assert.equal(checkFor(audit(readFeatureDocs({ root: repo, notesById: { 1: true } })), "feature-row-missing").status, "pass", "an item note clears it");
	// "not a repository" is UNKNOWN, not clean
	assert.equal(readFeatureDocs({ root: join(repo, "nope") }), null, "an unreadable history is null, never an empty pass");
	console.log("  ok   readFeatureDocs reads a real repo (feat-only, same-commit touch, note by item id)");
} finally {
	rmSync(repo, { recursive: true, force: true });
}

console.log("\nFEATURE ROW TEST PASS (drifted fails, touched/noted pass, absent skipped, real git read)");
process.exit(0);
