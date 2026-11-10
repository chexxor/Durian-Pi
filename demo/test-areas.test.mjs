// demo/test-areas.test.mjs — the test-area partition and its check rule (#1558).
//
// The area -> file mapping lives in demo/test-areas.json; THIS is the rule that
// keeps it from rotting. It asserts the REAL manifest covers every
// demo/*.test.mjs exactly once, that selection is faithful, and — the part that
// matters — that the rule FIRES: against crafted bad manifests it must name an
// unmapped file, a ghost entry, a double-mapped file, an empty area and a missing
// manifest. A coverage rule that cannot be shown to fire is the "green suite over
// a dead feature" failure this repo keeps rediscovering.
//
// Run: node demo/test-areas.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { areaNames, candidateTestsOutsideSuite, declaredExclusions, discoverTests, DEFAULT_SUITE_ROOTS, filesForArea, readManifest, selectTests, suiteRoots, validateManifest } from "../src/testareas.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED_AREAS = ["broker", "check", "docs", "guard", "readapi", "rig", "toolchain", "tui", "worktree"];

// 1. The real manifest partitions the real suite.
const v = validateManifest(ROOT);
assert.equal(v.ok, true, `manifest does not cover the suite: ${v.errors.join("; ")}`);

const manifest = readManifest(ROOT);
assert.deepEqual(areaNames(manifest), EXPECTED_AREAS, "the area set changed — update this test deliberately");

// 2. Every listed file is a real test, and the manifest is exactly the suite.
const all = discoverTests(ROOT);
const union = [];
for (const area of areaNames(manifest)) union.push(...filesForArea(manifest, area));
assert.equal(union.length, all.length, "manifest size must equal the suite size (a duplicate would inflate it)");
assert.deepEqual([...union].sort(), all, "manifest must list exactly the files on disk");

// 3. Selection: a full run is everything on disk; an area run is only that area.
assert.deepEqual(selectTests(ROOT).files, all, "a full run must select every test on disk");
const broker = selectTests(ROOT, { area: "broker" });
assert.deepEqual(broker.files, filesForArea(manifest, "broker"));
assert.ok(broker.files.includes("demo/broker.test.mjs"), "the broker area must contain broker.test.mjs");
assert.ok(!broker.files.includes("demo/worktree.test.mjs"), "the broker area must not contain a worktree test");
assert.ok(filesForArea(manifest, "worktree").includes("demo/worktree.test.mjs"), "the worktree area must contain worktree.test.mjs");

// 3b. Membership is DATA, and a test living outside demo/ is a suite member, not a stray (#6132).
//     Discovery used to scan only demo/*.test.mjs, so `tools/compaction-guard-test.mjs` — the guard's own
//     test — was invisible to the pre-landing gate: the full suite printed 282 green and never ran it.
assert.deepEqual(suiteRoots(manifest), DEFAULT_SUITE_ROOTS, "suite roots must be declared in the manifest, not inferred from one directory");
assert.ok(all.includes("tools/compaction-guard-test.mjs"), "the compaction guard's own test must be a suite member");
assert.ok(filesForArea(manifest, "guard").includes("tools/compaction-guard-test.mjs"), "tools/compaction-guard-test.mjs must be mapped to an area (guard)");
assert.ok(!all.includes("tools/what-to-test.mjs"), "the selector tool is not a test, whatever its name suggests");
assert.deepEqual(declaredExclusions(manifest), ["tools/what-to-test.mjs"], "every non-test in a suite root must be declared as an exclusion, not assumed");

// 3c. The gate does not swallow somebody else's suite, and it NAMES what it leaves out.
assert.ok(!all.some((f) => f.startsWith("vendor/")), "the upstream pi clone's own tests are not our suite");
const outside = candidateTestsOutsideSuite(ROOT);
assert.ok(!outside.some((f) => f.startsWith("vendor/") || f.startsWith("node_modules/")), "vendor/ and node_modules/ are excluded deliberately, not by accident");

// 4. Errors, not silent empties.
assert.throws(() => selectTests(ROOT, { area: "no-such-area" }), /unknown area/, "an unknown area must throw, not select nothing");
assert.throws(() => selectTests(ROOT, { area: "broker", all: true }), /mutually exclusive/);

// 5. The rule FIRES: crafted bad manifests are caught, by name.
const tmp = mkdtempSync(join(tmpdir(), "durig-test-areas-"));
try {
	mkdirSync(join(tmp, "demo"));
	mkdirSync(join(tmp, "tools"));
	mkdirSync(join(tmp, "src"));
	for (const f of ["a.test.mjs", "b.test.mjs", "c.test.mjs"]) writeFileSync(join(tmp, "demo", f), "// fixture\n");
	const write = (areas) =>
		writeFileSync(join(tmp, "demo", "test-areas.json"), JSON.stringify({ suiteRoots: [{ dir: "demo", glob: "*.test.mjs", exclude: [] }, { dir: "tools", glob: "*-test.mjs", exclude: [] }], areas }));
	const errs = () => validateManifest(tmp).errors;
	const has = (needle) => errs().some((e) => e.includes(needle));

	write({ rig: ["demo/a.test.mjs", "demo/b.test.mjs", "demo/c.test.mjs"] });
	assert.equal(validateManifest(tmp).ok, true, "a complete crafted manifest must validate");

	// A test added in a NON-demo root is caught the same way a demo one is: unmapped means red, not invisible.
	writeFileSync(join(tmp, "tools", "x-test.mjs"), "// fixture\n");
	write({ rig: ["demo/a.test.mjs", "demo/b.test.mjs", "demo/c.test.mjs"] });
	assert.ok(has('"tools/x-test.mjs" is on disk but not mapped'), `expected an unmapped tools test to fire, got: ${errs().join(" | ")}`);
	write({ rig: ["demo/a.test.mjs", "demo/b.test.mjs", "demo/c.test.mjs"], guard: ["tools/x-test.mjs"] });
	assert.equal(validateManifest(tmp).ok, true, "a tools test mapped to an area validates");

	// Something test-shaped OUTSIDE the declared roots is named, never silently dropped.
	writeFileSync(join(tmp, "src", "orphan-test.mjs"), "// fixture\n");
	assert.ok(
		candidateTestsOutsideSuite(tmp).includes("src/orphan-test.mjs"),
		`a test outside the roots must be named as not covered, got: ${candidateTestsOutsideSuite(tmp).join(" | ")}`,
	);

	write({ rig: ["demo/a.test.mjs", "demo/b.test.mjs"] }); // c unmapped
	assert.ok(has('"demo/c.test.mjs" is on disk but not mapped'), `expected an unmapped-file error, got: ${errs().join(" | ")}`);

	write({ rig: ["demo/a.test.mjs", "demo/b.test.mjs", "demo/c.test.mjs", "demo/ghost.test.mjs"] });
	assert.ok(has('"demo/ghost.test.mjs" is mapped but does not exist'), `expected a ghost-entry error, got: ${errs().join(" | ")}`);

	write({ rig: ["demo/a.test.mjs", "demo/b.test.mjs", "demo/c.test.mjs"], tui: ["demo/a.test.mjs"] });
	assert.ok(has('"demo/a.test.mjs" is mapped to 2 areas'), `expected a double-mapped error, got: ${errs().join(" | ")}`);

	write({ rig: [] });
	assert.ok(has('area "rig" is empty'), `expected an empty-area error, got: ${errs().join(" | ")}`);

	rmSync(join(tmp, "demo", "test-areas.json"));
	assert.ok(has("manifest not found"), "a missing manifest must be an error, not a pass");
} finally {
	rmSync(tmp, { recursive: true, force: true });
}

console.log(`TEST-AREAS TEST PASS (${all.length} tests across ${EXPECTED_AREAS.length} areas; roots: ${suiteRoots(manifest).map((r) => `${r.dir}/${r.glob}`).join(", ")}; declared exclusions: ${declaredExclusions(manifest).join(", ") || "none"}; the coverage rule fires on unmapped/ghost/double-mapped/empty/missing, including a test in a non-demo root; ${outside.length} test-shaped file(s) named as outside the suite)`);
