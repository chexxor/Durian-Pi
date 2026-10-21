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
import { areaNames, discoverTests, filesForArea, readManifest, selectTests, validateManifest } from "../src/testareas.mjs";

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

// 4. Errors, not silent empties.
assert.throws(() => selectTests(ROOT, { area: "no-such-area" }), /unknown area/, "an unknown area must throw, not select nothing");
assert.throws(() => selectTests(ROOT, { area: "broker", all: true }), /mutually exclusive/);

// 5. The rule FIRES: crafted bad manifests are caught, by name.
const tmp = mkdtempSync(join(tmpdir(), "durig-test-areas-"));
try {
	mkdirSync(join(tmp, "demo"));
	for (const f of ["a.test.mjs", "b.test.mjs", "c.test.mjs"]) writeFileSync(join(tmp, "demo", f), "// fixture\n");
	const write = (areas) => writeFileSync(join(tmp, "demo", "test-areas.json"), JSON.stringify({ areas }));
	const errs = () => validateManifest(tmp).errors;
	const has = (needle) => errs().some((e) => e.includes(needle));

	write({ rig: ["demo/a.test.mjs", "demo/b.test.mjs", "demo/c.test.mjs"] });
	assert.equal(validateManifest(tmp).ok, true, "a complete crafted manifest must validate");

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

console.log(`TEST-AREAS TEST PASS (${all.length} tests across ${EXPECTED_AREAS.length} areas; the coverage rule fires on unmapped/ghost/double-mapped/empty/missing)`);
