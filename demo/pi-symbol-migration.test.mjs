// demo/pi-symbol-migration.test.mjs — the pi symbol sweep is a tool now, not a scratch file (#6176).
//
// The rename that got the v1.5.1 pin green lived in `.spike/pin-update/migrate-symbols.mjs`: gitignored,
// hard-coded to one absolute path, no exit code, no test. pi-durable 1.5.1 renamed
// `Session.documentState()` to `Session.snapshot()` AND changed what it returns - the VALUE, not a
// `DocumentState` wrapper with `.value`. That second half is the part that silently breaks: a line like
// `const c = await read.snapshot(Constitution, id).value` reads a property of a string and returns
// undefined, which looks like "the doc is missing" rather than "the unwrap is wrong".
//
// The test therefore pins three things: the rename happens, the unwrapping happens, and the sweep does NOT
// mangle `.value` accesses that have nothing to do with a snapshot. The last one is the negative control -
// without it the tool "passes" by rewriting things it should have left alone.
//
// Run: node demo/pi-symbol-migration.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrateSource, residue } from "../tools/pi-symbol-migration.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOOL = join(ROOT, "tools", "pi-symbol-migration.mjs");

/* 1. The pure rules, one fixture per shape. */

// The symbol, and the wrapper read on a variable that held it.
const held = `const c = await input.read.documentState(Constitution, id, ctx);\nif (c?.value) return c.value.text;\n`;
const afterHeld = migrateSource(held);
assert.ok(afterHeld.includes("snapshot(Constitution"), "documentState is renamed");
assert.ok(
	!afterHeld.includes("c?.value") && !afterHeld.includes("c.value"),
	"the variable's wrapper reads are dropped",
);
assert.ok(
	afterHeld.includes("if (c) return c.text;"),
	`the rewrite is exact, not approximate: ${afterHeld}`,
);

// A mock harness stub that returned the wrapper shape.
const stub = 'const harness = { documentState: async () => ({ value: { text: "x" } }) };\n';
assert.ok(
	migrateSource(stub).includes("snapshot: async () => ({})"),
	"the mock stub stops returning a wrapper",
);

// The common single-paren call.
const call = "return await sess.documentState(doc, ctx).value ?? {};\n";
const afterCall = migrateSource(call);
assert.ok(
	afterCall.includes("snapshot(doc, ctx) ?? {}"),
	`the unwrap on a direct call is missing: ${afterCall}`,
);

// NEGATIVE CONTROL: `.value` on something that is not a snapshot must survive.
const unrelated = "const a = ((cfg)).value;\nsettings.value = 3;\n";
assert.equal(
	migrateSource(unrelated),
	unrelated,
	"the sweep rewrote a .value that has nothing to do with snapshot()",
);

// Nested calls are beyond the regexes. The tool must REPORT them, not guess at them.
const nested = "const v = await sess.documentState(getDoc(doc), ctx).value;\n";
const afterNested = migrateSource(nested);
assert.ok(residue(afterNested).length === 1, "a nested snapshot read is not reported as residue");
assert.ok(
	afterNested.includes("snapshot(getDoc(doc), ctx).value"),
	"and it is left intact for a human, not half-rewritten",
);

/* 2. The CLI, on a real tree, with real exit codes. */
const dir = mkdtempSync(join(tmpdir(), "pi-symbol-migration-"));
writeFileSync(join(dir, "clean.mjs"), stub);
writeFileSync(join(dir, "held.mjs"), held);
writeFileSync(join(dir, "nested.mjs"), nested);

const run = (args) =>
	execFileSync(process.execPath, [TOOL, ...args], {
		cwd: dir,
		encoding: "utf8",
	});

// Residue exists (nested.mjs), so the sweep exits 1: a red the caller can gate on.
let exitCode = 0;
let out = "";
try {
	out = run(["--root", ".", "--dirs", ".", "--dry-run", "--json"]);
} catch (err) {
	exitCode = err.code ?? 1;
	out = String(err.stdout ?? "");
}
assert.equal(exitCode, 1, `a capture with residue must exit 1, got ${exitCode}`);
const report = JSON.parse(out);
assert.equal(report.scanned, 3, "three files carried the old symbol");
assert.equal(report.changed, 3, "all three files carry the old symbol, so all three are rewritten");
assert.equal(report.dryRun, true, "the dry run said it was a dry run");
assert.equal(report.residue.length, 1, "exactly one file needs a human");
assert.match(report.residue[0].file, /nested\.mjs/, "and it is the nested one");

// Nothing left to rewrite, nothing left to read: exit 0, and the scan finds nothing to scan.
writeFileSync(join(dir, "clean.mjs"), 'const harness = { snapshot: async () => ({}) };\n');
writeFileSync(join(dir, "held.mjs"), "const c = await input.read.snapshot(Constitution, id, ctx);\nif (c) return c.text;\n");
writeFileSync(join(dir, "nested.mjs"), "const v = await sess.snapshot(getDoc(doc), ctx); // unwrapped by hand\n");
const cleanOut = run(["--root", ".", "--dirs", ".", "--dry-run", "--json"]);
const cleanReport = JSON.parse(cleanOut);
assert.equal(cleanReport.scanned, 0, "a tree with no documentState scans zero files - the tool does not invent work");
assert.equal(cleanReport.residue.length, 0, "the clean tree has no residue");
assert.equal(cleanReport.changed, 0, "and a file already migrated is not counted as changed");

// It WRITES when not dry-run, and the written tree no longer carries the old symbol.
// grep exits 1 when it finds nothing - that is the pass condition here, so it is read, not thrown on.
execFileSync(process.execPath, [TOOL, "--root", ".", "--dirs", "."], { cwd: dir });
let stillOld = "";
try {
	stillOld = execFileSync("grep", ["-rlE", "documentState", ".", "--include=*.mjs"], { cwd: dir, encoding: "utf8" });
} catch (err) {
	// grep's "no matches" exit is 1; anything else is a real error.
	if ((err.status ?? err.code) !== 1) throw err;
	stillOld = "";
}
assert.equal(stillOld.trim(), "", "after a real run, no file should still carry documentState");

rmSync(dir, { recursive: true, force: true });
console.log(
	`PI-SYMBOL-MIGRATION TEST PASS (#6176): rename + unwrap pinned on four shapes, a non-snapshot .value left alone, ${report.scanned} scanned / ${report.changed} rewritten / ${report.residue.length} reported for a human, exit 1 with residue and exit 0 without`,
);
process.exit(0);
