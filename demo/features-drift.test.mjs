// demo/features-drift.test.mjs — the FEATURES-row drift SWEEP (#2462; D62 / ROADMAP 46).
//
// The `check` rule `feature-row-missing` (src/checkup.mjs) judges drift, but it needs a
// CALLER to read git history (src/featuredocs.mjs) and hand it the data. That caller is
// gated on cli.mjs serialization, so scripts/features-drift.mjs is the un-gated periodic
// equivalent — it reuses the SAME reader, so the sweep and the rule cannot disagree.
//
// This proves the sweep's contract on a THROWAWAY temp repository (hermetic; the real
// repo is never touched):
//   - a `feat` commit with no docs/FEATURES.md row and no "no feature surface" note is DRIFT
//   - a `feat` commit that touches docs/FEATURES.md is NOT drift
//   - a `feat` commit whose subject says "no feature surface" is NOT drift
//   - a non-`feat` commit is not considered at all
//   - a clean history exits 0; drift exits 1; UNKNOWN (not a repo) exits 2, never 0
//
// FAILING-FIRST: before scripts/features-drift.mjs existed there was no sweep to run —
// `node scripts/features-drift.mjs` was MODULE_NOT_FOUND (exit 1), so every assertion
// below that shells out to it failed.
//
// Run: node demo/features-drift.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { parseFeatureLog } from "../src/featuredocs.mjs";

let failures = 0;
function check(label, condition, detail = "") {
	if (condition) {
		console.log(`  ok   ${label}`);
	} else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

const sweep = fileURLToPath(new URL("../scripts/features-drift.mjs", import.meta.url));

// A clean env for the temp repo's git calls: drop any ambient GIT_DIR/GIT_* the seat may
// have pinned (D109/#2259) so `git -C <tmp>` really targets <tmp>, and fix an identity.
function gitEnv() {
	const env = { ...process.env };
	for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"]) delete env[k];
	env.GIT_AUTHOR_NAME = "demo";
	env.GIT_AUTHOR_EMAIL = "demo@example.invalid";
	env.GIT_COMMITTER_NAME = "demo";
	env.GIT_COMMITTER_EMAIL = "demo@example.invalid";
	return env;
}

function git(repo, args) {
	return spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", env: gitEnv() });
}

function write(repo, rel, text) {
	const abs = join(repo, rel);
	mkdirSync(dirname(abs), { recursive: true });
	writeFileSync(abs, text);
}

function commit(repo, message) {
	const staged = git(repo, ["add", "-A"]);
	assert.equal(staged.status, 0, `git add failed: ${staged.stderr}`);
	const done = git(repo, ["commit", "-m", message, "--no-gpg-sign"]);
	assert.equal(done.status, 0, `git commit failed: ${done.stderr}`);
}

function runSweep(repo) {
	return spawnSync(process.execPath, [sweep, "--repo", repo, "--json"], {
		encoding: "utf8",
		env: gitEnv(),
	});
}

// Defensive: when the sweep is missing (or crashes) its stdout is not JSON. Parsing must
// degrade to an empty report so the assertions FAIL cleanly instead of throwing.
function reportOf(stdout) {
	try {
		return JSON.parse(stdout) ?? {};
	} catch {
		return {};
	}
}

function subjectsOf(stdout) {
	return (reportOf(stdout).drifted ?? []).map((d) => d.subject);
}

const root = mkdtempSync(join(tmpdir(), "durig-featdrift-"));
const clean = mkdtempSync(join(tmpdir(), "durig-featdrift-clean-"));
const notRepo = mkdtempSync(join(tmpdir(), "durig-featdrift-norepo-"));

try {
	console.log("\n=== FEATURES-row drift sweep ===\n");

	/* --- a pure unit check of the parser the sweep and the rule share --- */
	const parsed = parseFeatureLog(
		"@@@aaa\x1ffeat: add widget\nsrc/widget.mjs\n@@@bbb\x1ffeat: no feature surface\nsrc/x.mjs\n@@@ccc\x1fchore: tidy\ndocs/FEATURES.md\n",
	);
	check("parser: only a `feat` subject with no FEATURES.md touch is drift", parsed.length === 3);
	check(
		"parser: drift flag is per-commit",
		parsed[0].touchedFeatures === false && parsed[0].noSurfaceNote === false &&
			parsed[2].touchedFeatures === true,
		JSON.stringify(parsed),
	);
	check("parser: a subject saying 'no feature surface' clears the commit", parsed[1].noSurfaceNote === true);

	/* --- a repo with drift --- */
	const init = git(root, ["init"]);
	assert.equal(init.status, 0, `git init failed: ${init.stderr}`);
	write(root, "README.md", "# temp\n");
	commit(root, "chore: initial commit");

	let sweepResult = runSweep(root);
	check("no feat commit yet -> sweep exits 0", sweepResult.status === 0, `status=${sweepResult.status}`);
	check("no feat commit yet -> checked 0", reportOf(sweepResult.stdout).checked === 0);

	write(root, "src/widget.mjs", "export const w = 1;\n");
	commit(root, "feat: add the widget (#9001)");

	sweepResult = runSweep(root);
	check("a feat commit with no FEATURES.md row -> sweep exits 1", sweepResult.status === 1, `status=${sweepResult.status}`);
	check(
		"the drifted commit is named",
		subjectsOf(sweepResult.stdout).some((s) => s.includes("add the widget")),
		sweepResult.stdout,
	);

	// A feat commit that DOES carry the row must not be added to the drift set.
	write(root, "docs/FEATURES.md", "| capability | where | proof |\n");
	commit(root, "feat: document the widget row (#9002)");
	sweepResult = runSweep(root);
	check(
		"a feat commit touching docs/FEATURES.md is NOT drift",
		!subjectsOf(sweepResult.stdout).some((s) => s.includes("document the widget row")),
		sweepResult.stdout,
	);

	// A feat commit whose subject records the escape hatch must not be added either.
	write(root, "src/internal.mjs", "export const i = 1;\n");
	commit(root, "feat: refactor internals (no feature surface) (#9003)");
	sweepResult = runSweep(root);
	check(
		"a feat commit saying 'no feature surface' is NOT drift",
		!subjectsOf(sweepResult.stdout).some((s) => s.includes("refactor internals")),
		sweepResult.stdout,
	);
	check(
		"exactly the one unrowed feat commit is drift",
		subjectsOf(sweepResult.stdout).length === 1,
		JSON.stringify(subjectsOf(sweepResult.stdout)),
	);

	/* --- a clean repo exits 0 --- */
	const initClean = git(clean, ["init"]);
	assert.equal(initClean.status, 0, `git init failed: ${initClean.stderr}`);
	write(clean, "README.md", "# temp\n");
	commit(clean, "chore: initial commit");
	write(clean, "src/thing.mjs", "export const t = 1;\n");
	write(clean, "docs/FEATURES.md", "| capability | where | proof |\n");
	commit(clean, "feat: add thing with its row (#9004)");
	const cleanResult = runSweep(clean);
	check("a clean history -> sweep exits 0", cleanResult.status === 0, `status=${cleanResult.status} ${cleanResult.stdout}`);

	/* --- UNKNOWN is not clean --- */
	const unknownResult = runSweep(notRepo);
	check("a non-repository -> sweep exits 2 (UNKNOWN, never 0)", unknownResult.status === 2, `status=${unknownResult.status}`);
	check("the UNKNOWN report says so", reportOf(unknownResult.stdout).unknown === true, unknownResult.stdout);

	console.log(
		failures === 0 ? "\nPASS — features-drift sweep verified" : `\nFAIL — ${failures} check(s) failed`,
	);
} finally {
	for (const dir of [root, clean, notRepo]) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch (err) {
			console.warn(`cleanup: could not remove ${dir}: ${err.message}`);
		}
	}
}

process.exit(failures === 0 ? 0 : 1);
