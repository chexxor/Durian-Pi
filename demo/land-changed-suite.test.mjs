// demo/land-changed-suite.test.mjs — a CHANGED-SUITE landing pass can never be reported as a clean suite.
//
// WHY (#4936). `scripts/land.mjs` regression-checks only when `--suite` is passed, and its own report said
// `suite: not run`; the full sweep is ~239 tests / ~10 minutes for a 5-file landing. Tonight that left two
// options — run nothing, or run everything — and a seat under turn pressure picks the first. `--changed-suite`
// is the third option: the set the change DERIVES, selected by the same `tools/what-to-test.mjs` the operator
// uses (a second path→test map is the thing that rots — #4922's one-shared-`looksLikeSecret` direction).
// The cheap path is only honest if it cannot be MISREAD, so the non-negotiable condition is: the pass must
// print which AREAS ran and which did NOT, and an empty derivation must read as NO COVERAGE, not as a pass
// (the same law as #3743's four-state probe and #4858's "a number with no tree/section is not a measurement").
//
// The two shapes that make this safe are pinned below as fixtures:
//   (a) a change with NO mapped test under it → coverage "none", and land.mjs REFUSES rather than advancing
//       main on a gate that ran zero tests;
//   (b) a change touching a SHARED file (`src/seatguard.mjs`) → the UNION of every area whose tests name it,
//       not the first match — otherwise a guard in another area is silently skipped while the number is green.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { areaNames, changedSuiteScope, discoverTests, filesForArea, readManifest, validateManifest } from "../src/testareas.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/* ── the manifest is the partition this all hangs on; if it rotted, every count below is fiction ── */
const coverage = validateManifest(ROOT);
assert.ok(coverage.ok, `the area manifest must partition the suite or the scope report is meaningless: ${coverage.errors.join("; ")}`);
const manifest = readManifest(ROOT);
const areas = areaNames(manifest);
const onDisk = discoverTests(ROOT);
assert.ok(areas.length >= 9, `expected the whole area set to report, got ${areas.length}: ${areas.join(", ")}`);

/* ── fixture (a): NO coverage is reported as no coverage, never as a pass ── */
const none = changedSuiteScope(ROOT, { selected: [] });
assert.equal(none.coverage, "none", "an empty derivation must say none, not 0-failures-passes");
assert.equal(none.ranCount, 0);
assert.deepEqual(none.areasRan, [], "nothing ran, so no area may be credited");
assert.deepEqual(none.areasNotRun, areas, "every area must be named as NOT run");
assert.equal(none.testsNotRun, onDisk.length, "the un-covered count must equal the whole suite on disk");
assert.equal(none.gate.command, "node scripts/test.mjs --all", "the report must ship the full-gate command, not just the deficit");

/* ── a one-area selection states its own deficit ── */
const docsOnly = changedSuiteScope(ROOT, { selected: filesForArea(manifest, "docs") });
assert.deepEqual(docsOnly.areasRan, ["docs"]);
assert.ok(docsOnly.areasNotRun.length === areas.length - 1, `areasNotRun must list every other area, got ${docsOnly.areasNotRun.join(", ")}`);
for (const a of docsOnly.areasNotRun) assert.ok(!docsOnly.areasRan.includes(a), `${a} cannot be both run and not run`);
assert.ok(docsOnly.testsNotRun > 0);
assert.equal(docsOnly.byArea.docs.ran, filesForArea(manifest, "docs").length, "byArea must count what it credited");
assert.equal(docsOnly.byArea.rig.ran, 0);

/* ── a ghost cannot inflate coverage: a selected file that is not on disk is reported, not counted ── */
const ghost = changedSuiteScope(ROOT, { selected: ["demo/does-not-exist.test.mjs", ...filesForArea(manifest, "guard")] });
assert.deepEqual(ghost.missingFromDisk, ["demo/does-not-exist.test.mjs"]);
assert.equal(ghost.coverage, "partial");
assert.equal(ghost.ranCount, filesForArea(manifest, "guard").length, "the ghost must not count as coverage");
assert.deepEqual(ghost.areasRan, ["guard"]);

/* ── fixture (b): a SHARED file selects the UNION of areas, derived by the tool, not by hand ── */
// `--paths` classifies without touching git, and without `--run` the tool only selects — it never runs a
// subset and calls it a gate.
const wtt = spawnSync(process.execPath, [join(ROOT, "tools", "what-to-test.mjs"), "--json", "--paths=src/seatguard.mjs"], { cwd: ROOT, encoding: "utf8" });
assert.equal(wtt.error, undefined, `what-to-test failed to spawn: ${wtt.error}`);
const verdict = JSON.parse(wtt.stdout);
assert.ok(Array.isArray(verdict.selected) && verdict.selected.length > 0, "a shared guard file must derive a non-empty set");
const derived = verdict.selected.map((s) => s.test);
const shared = changedSuiteScope(ROOT, { selected: derived });
const touched = [...new Set(verdict.selected.map((s) => s.area))];
assert.ok(touched.length > 1, `src/seatguard.mjs is named by tests in several areas — the union is the point, got ${touched.join(", ")}`);
assert.deepEqual(shared.areasRan, [...touched].sort(), "the scope must credit the union of areas, not the first match");
assert.ok(shared.areasNotRun.length >= 1, `even a shared-file change leaves areas un-run: ${shared.areasNotRun.join(", ")}`);
assert.equal(shared.ranCount, new Set(derived).size, "every derived test must be credited exactly once");
// The selector's own banner is the second half of the honesty condition: it refuses to be read as a gate.
const text = readFileSync(join(ROOT, "tools", "what-to-test.mjs"), "utf8");
assert.ok(/NEVER LAND ON THE SUBSET/.test(text), "the selector must say out loud that its set is not the landing gate");

/* ── wiring, not just export (#4823's shape): the flag exists AND is wired through the pass ── */
const land = readFileSync(join(ROOT, "scripts", "land.mjs"), "utf8");
for (const [needle, why] of [
	["--changed-suite", "the flag must be parsed and documented"],
	["what-to-test.mjs", "the selection must come from the ONE existing selector, not a second map"],
	["changedSuiteScope(", "the scope must be computed from the area data, not from a hand count"],
	['suiteScope = changedSuiteScope(scratch', "the scope must be measured IN THE SCRATCH (a green in `.` measures the shared tree — #4436)"],
	['coverage === "none"', "the no-coverage shape must exist"],
	["base.suiteScope = suiteScope", "every report path must carry the scope, including the refusal"],
	["suiteScope,", "the final ok report must carry what ran and what did NOT"],
]) assert.ok(land.includes(needle), `scripts/land.mjs is not wired for #4936: missing ${JSON.stringify(needle)} (${why})`);
assert.ok(/--changed-suite found NO coverage/.test(land), "the no-coverage case must REFUSE the landing, not advance main unchecked");
assert.ok(/areas NOT RUN/.test(land), "the pass must print which areas did not run, in words a human sees");
assert.ok(land.includes("wantSuite || wantChangedSuite"), "the suite block must open for either flag (--suite still wins when both are passed)");

/* ── end to end: the PASS refuses, observed and not asserted from source text ── */
// A throwaway repo carries the real (dependency-free) selector — tools/what-to-test.mjs plus
// src/testareas.mjs — and a two-area manifest, so the derived set, the areas that did NOT run, and
// the refusal are all OBSERVED. This is the part a source-text assertion cannot prove: that a real
// landing stops rather than advancing main on a check that checked nothing.
const tmp = mkdtempSync(join(tmpdir(), "durig-changed-suite-"));
const repo = join(tmp, "repo");
let e2e = null;
try {
	const g = (...argv) => {
		const r = spawnSync("git", argv, { cwd: repo, encoding: "utf8" });
		assert.equal(r.status, 0, `git ${argv.join(" ")}: ${r.stderr}`);
		return (r.stdout ?? "").trim();
	};
	mkdirSync(join(repo, "demo"), { recursive: true });
	mkdirSync(join(repo, "src"), { recursive: true });
	mkdirSync(join(repo, "tools"), { recursive: true });
	g("init");
	g("config", "user.email", "t@example.com");
	g("config", "user.name", "Test");
	writeFileSync(join(repo, ".gitignore"), "*.sqlite*\n/.land-scratch-*/\n");
	// A guard that NAMES the file it covers — the needle `what-to-test.mjs` derives from.
	writeFileSync(join(repo, "demo", "ok.test.mjs"), "import { readFileSync } from \"node:fs\";\nreadFileSync(\"ok.txt\", \"utf8\");\nconsole.log(\"ok\");\n");
	writeFileSync(join(repo, "demo", "other.test.mjs"), "console.log(\"other\");\n");
	writeFileSync(join(repo, "demo", "test-areas.json"), `${JSON.stringify({ areas: { primary: ["demo/ok.test.mjs"], secondary: ["demo/other.test.mjs"] } }, null, 1)}\n`);
	copyFileSync(join(ROOT, "tools", "what-to-test.mjs"), join(repo, "tools", "what-to-test.mjs"));
	copyFileSync(join(ROOT, "src", "testareas.mjs"), join(repo, "src", "testareas.mjs"));
	writeFileSync(join(repo, "notes.md"), "base\n");
	g("add", ".");
	g("commit", "-m", "base");
	g("branch", "-M", "main");
	const feature = (name, mutate) => {
		g("switch", "-c", name, "main");
		mutate();
		g("add", ".");
		g("commit", "-m", `feat: ${name}`);
		const sha = g("rev-parse", "HEAD");
		g("switch", "main");
		return sha;
	};
	const runLand = (branch) =>
		spawnSync(process.execPath, [join(ROOT, "scripts", "land.mjs"), branch, "--repo", repo, "--db", join(repo, "t.sqlite"), "--changed-suite"], {
			cwd: repo,
			encoding: "utf8",
			timeout: 90_000,
		});
	const mainOf = () => g("rev-parse", "main");
	const reportOf = (r) => {
		try {
			return JSON.parse(r.stdout);
		} catch {
			assert.fail(`land.mjs printed no JSON report for ${r.args?.join(" ") ?? ""} (exit ${r.status}): ${(r.stdout || r.stderr).slice(0, 400)}`);
		}
	};

	/* (a) NO mapped test under the change → the landing REFUSES, it does not advance */
	feature("feat-uncovered", () => writeFileSync(join(repo, "notes.md"), "changed, and no guard names it\n"));
	const beforeUncovered = mainOf();
	const r1raw = runLand("feat-uncovered");
	const r1 = reportOf(r1raw);
	assert.notEqual(r1raw.status, 0, "the no-coverage pass must exit nonzero");
	assert.match(r1.error, /NO coverage/, `a change with no derived test must refuse the landing, got: ${r1.error}`);
	assert.equal(r1.suiteScope?.coverage, "none", "the report must say no coverage, not zero failures");
	assert.deepEqual(r1.suiteScope?.areasNotRun, ["primary", "secondary"], "no area may be credited when nothing ran");
	assert.equal(mainOf(), beforeUncovered, "main must NOT advance on a gate that ran zero tests");

	/* (b) a derived set that is green → land, and the report names the area it did NOT run */
	const featCovered = feature("feat-covered", () => writeFileSync(join(repo, "ok.txt"), "changed under a named guard\n"));
	const r2 = reportOf(runLand("feat-covered"));
	assert.ok(r2.ok, `a green derived subset should land: ${r2.error}`);
	assert.deepEqual(r2.suiteScope?.areasRan, ["primary"], "the area whose guard names the change is credited");
	assert.deepEqual(r2.suiteScope?.areasNotRun, ["secondary"], `the un-run area must be NAMED, got ${JSON.stringify(r2.suiteScope?.areasNotRun)}`);
	assert.equal(r2.suiteScope?.ranCount, 1, "the subset ran one test of two — and must say so");
	assert.ok((r2.suite ?? []).some((s) => s.test === "ok.test.mjs" && s.exit === 0), "the derived test actually ran");
	assert.ok(!(r2.suite ?? []).some((s) => s.test === "other.test.mjs"), "the un-derived test must NOT have run");
	assert.equal(r2.suiteScope?.testsNotRun, 1);
	g("merge-base", "--is-ancestor", featCovered, "main"); // exits nonzero (and the helper asserts) if main did not take the branch

	/* (c) a RED derived guard still refuses — a subset is not a softer gate */
	feature("feat-red", () => {
		writeFileSync(join(repo, "ok.txt"), "changed again\n");
		writeFileSync(join(repo, "demo", "bad.test.mjs"), "// names ok.txt too\nconsole.error(\"boom\");\nprocess.exit(1);\n");
	});
	const beforeRed = mainOf();
	const r3 = reportOf(runLand("feat-red"));
	assert.notEqual(r3.ok, true, `a derived test that fails must refuse the landing: ${JSON.stringify(r3).slice(0, 300)}`);
	assert.match(r3.error, /bad\.test\.mjs/, `the refusal must name the failing derived test, got: ${r3.error}`);
	assert.equal(mainOf(), beforeRed, "main must NOT advance on a red derived guard");
	assert.ok(r3.suiteScope, "even the refusal carries the scope of what it ran");
	e2e = { ran: r2.suiteScope.ranCount, total: r2.suiteScope.totalTests, notRun: r2.suiteScope.areasNotRun };
} finally {
	rmSync(tmp, { recursive: true, force: true });
}

process.stdout.write(
	`CHANGED-SUITE SCOPE PASS — no-coverage says "none" and refuses; a shared file credits the union ` +
		`(${shared.areasRan.join(", ")}); every report names areas NOT RUN (${shared.areasNotRun.length} of ${areas.length} for the shared-file case) of ${onDisk.length} tests / ${areas.length} areas` +
		` · end to end in a throwaway repo: ${e2e.ran}/${e2e.total} ran, area [${e2e.notRun.join(", ")}] did NOT, and the no-coverage and red-guard landings both refused\n`,
);
