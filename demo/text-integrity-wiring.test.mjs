// demo/text-integrity-wiring.test.mjs — #4371: the detector is WIRED, not merely built.
//
// A detector that only runs on demand reports the breakage AFTER the tree is broken. This asserts the
// TWO wirings — the `check` path (error severity) and the LANDING precondition in scripts/land.mjs —
// and it does so FAILING-FIRST: a flattened tracked file makes BOTH refuse, and a normal file passes
// BOTH. A rule wired into one path and not the other is half a guard, and the landing half is the one
// the 04:21Z incident needed.
//
// Run: node demo/text-integrity-wiring.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { landingChangedPaths, readTextIntegrity, trackedChangedPaths } from "../src/textintegrity.mjs";
import { auditRig } from "../src/checkup.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const LAND = join(HERE, "..", "scripts", "land.mjs");

const git = (cwd, argv) => execFileSync("git", argv, { cwd, encoding: "utf8" }).trim();
const SPEC = {
	version: 2,
	seats: [
		{ name: "author", role: "implementation engineer", capabilities: ["implement"], model: "faux/m1" },
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
	queueItems: [],
	featureDocs: [],
	commitMessages: [],
	sharedTreeBranch: "main",
};
const hasFinding = (r, id) => (r.findings ?? []).some((f) => f.id === id);
const ruleStatus = (r, id) => (r.checks ?? []).find((c) => c.id === id)?.status;

const tmp = mkdtempSync(join(tmpdir(), "durig-ti-"));
const repo = join(tmp, "repo");
const MULTI = Array.from({ length: 40 }, (_, i) => `export const line${i} = ${i};`).join("\n") + "\n";
try {
	mkdirSync(repo, { recursive: true });
	git(repo, ["init", "-q", "-b", "main", "."]);
	git(repo, ["config", "user.email", "t@t"]);
	git(repo, ["config", "user.name", "t"]);
	writeFileSync(join(repo, "src.mjs"), MULTI);
	git(repo, ["add", "src.mjs"]);
	git(repo, ["commit", "-qm", "init"]);

	/* ─── 1. a NORMAL file passes BOTH paths ─────────────────────────────────── */
	console.log("\n1. a normal file passes both paths");
	writeFileSync(join(repo, "src.mjs"), MULTI.replace("line0 = 0", "line0 = 100"));
	const changed = trackedChangedPaths({ root: repo });
	assert.ok(changed.includes("src.mjs"), "the changed file is in scope");
	assert.deepEqual(readTextIntegrity({ root: repo, paths: changed }), [], "a normal edit has no faults");
	const okAudit = auditRig({ ...BASE, textIntegrity: [] });
	assert.equal(hasFinding(okAudit, "text-integrity"), false, "the check path is quiet");
	assert.equal(ruleStatus(okAudit, "text-integrity"), "pass", "and the rule RAN (not skipped)");
	console.log("  ok   normal edit: no faults, check quiet and running");

	/* ─── 2. a FLATTENED file is caught by the CHECK path (ERROR severity) ───── */
	console.log("\n2. a flattened file is caught by the CHECK path");
	writeFileSync(join(repo, "src.mjs"), MULTI.replace(/\n/g, " ")); // the 04:21Z flattening
	const found = readTextIntegrity({ root: repo, paths: ["src.mjs"] });
	assert.equal(found.length, 1, "the collapse is detected");
	assert.ok(found[0].faults.some((f) => f.kind === "collapsed"), "and it is the COLLAPSE kind");
	const badAudit = auditRig({ ...BASE, textIntegrity: found });
	assert.equal(hasFinding(badAudit, "text-integrity"), true, "the check path reports it");
	assert.equal(ruleStatus(badAudit, "text-integrity"), "fail");
	assert.equal(badAudit.exitCode, 1, "ERROR severity: a broken tree stops every seat, so check exits 1");
	assert.match(badAudit.findings.find((f) => f.id === "text-integrity").fix, /restore from HEAD/, "the remedy names what to restore from");
	console.log("  ok   collapse: detected, ERROR severity, check exits 1, remedy named");

	/* ─── 3. the LANDING precondition catches it ON A BRANCH ────────────────── */
	console.log("\n3. the LANDING precondition catches it on a branch");
	git(repo, ["checkout", "-q", "-b", "feat"]); // the branch CARRIES the flattening
	git(repo, ["add", "src.mjs"]);
	git(repo, ["commit", "-qm", "flatten src.mjs by accident"]);
	git(repo, ["checkout", "-q", "main"]); // the working tree is main's (clean) version again — no commit needed
	const landingPaths = landingChangedPaths({ root: repo, branch: "feat", base: "main" });
	assert.ok(landingPaths.includes("src.mjs"), "the landing scope names the file");
	// Judged on the BRANCH's blob against MAIN, not the (clean) working tree.
	const landingBad = readTextIntegrity({ root: repo, paths: landingPaths, rev: "feat", headRev: "main" });
	assert.equal(landingBad.length, 1, "the landing path sees the collapse on the branch");
	assert.ok(landingBad[0].faults.some((f) => f.kind === "collapsed"), "and names it a collapse");
	// ...and the real lander REFUSES, which is the half the incident needed.
	const out = spawnSync(process.execPath, [LAND, "feat", "--repo", repo, "--db", join(repo, "rig.sqlite")], {
		cwd: repo,
		encoding: "utf8",
		env: { ...process.env, DURIG_MAX_CONCURRENT_SEATS: "2" },
	});
	let report = null;
	try {
		report = JSON.parse(out.stdout);
	} catch {
		report = null;
	}
	assert.notEqual(out.status, 0, `land refuses a collapsed branch; got exit ${out.status}: ${out.stdout?.slice(0, 200)}`);
	assert.match(report?.error ?? "", /TEXT INTEGRITY/, "and the refusal names text integrity");
	assert.match(report?.error ?? "", /src\.mjs/, "...and the file");
	console.log("  ok   land REFUSES the collapsed branch (the half that PREVENTS rather than reports)");

	console.log("\nTEXT-INTEGRITY-WIRING TEST PASS (both paths refuse a flattened file; both pass a normal one)");
} finally {
	rmSync(tmp, { recursive: true, force: true });
}
process.exit(0);
