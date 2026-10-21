// demo/format.test.mjs — the `format [--check] [-- <paths>]` verb (ROADMAP 90).
//
// FAILING-FIRST: before the verb existed, `node cli.mjs format ...` fell through to
// the unknown-command branch (exit 2, {ok:false,usage}), so it neither formatted a
// file nor gated on one. Run against the pre-change tree, this file fails.
//
// The verb wraps the PINNED prettier (devtools' #933 half: prettier 3.9.10 +
// .prettierrc.json). It is explicit-paths-only and never a tree walk or a hook.
//
// Run: node demo/format.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "durig-format-"));
const durigDir = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
// format opens no store, but point DURIAN_PI_DB at a temp file so nothing is created
// in the checkout even if a future change reaches for storage.
const env = { ...process.env, DURIG_PROVIDER: "faux", DURIG_DB: join(dir, "rig.sqlite") };
const cli = (args) => {
	const res = spawnSync(process.execPath, ["cli.mjs", ...args], { cwd: durigDir, env, encoding: "utf8" });
	return { code: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
};
const json = (res) => JSON.parse(res.stdout);

// Deliberately unformatted: missing spaces, double space in the name, stray spaces
// inside the parens and around `return`.
const UNFORMATTED = "const x=1\nfunction  f( ){return    x}\n";

try {
	const file = join(dir, "messy.mjs");
	writeFileSync(file, UNFORMATTED);

	// 1. --check on an unformatted file: non-zero, reports it, writes NOTHING.
	const check1 = cli(["format", "--check", file]);
	assert.equal(check1.code, 1, `--check on an unformatted file exits 1 (stdout: ${check1.stdout.slice(0, 200)})`);
	const j1 = json(check1);
	assert.equal(j1.ok, false);
	assert.equal(j1.command, "format");
	assert.equal(j1.check, true);
	assert.equal(j1.unformatted, 1);
	assert.equal(j1.files[0].status, "unformatted");
	assert.equal(readFileSync(file, "utf8"), UNFORMATTED, "--check must not write");

	// 2. format normalizes the file and reports it.
	const fmt = cli(["format", file]);
	assert.equal(fmt.code, 0, `format exits 0 (stderr: ${fmt.stderr.slice(0, 200)})`);
	const j2 = json(fmt);
	assert.equal(j2.ok, true);
	assert.equal(j2.check, false);
	assert.equal(j2.files[0].status, "formatted");
	const formatted = readFileSync(file, "utf8");
	assert.notEqual(formatted, UNFORMATTED, "format changed the file");
	assert.match(formatted, /const x = 1;/, "the spacing was normalized");

	// 3. --check now passes — this is the gate the item asks to keep beside node --check.
	const check2 = cli(["format", "--check", file]);
	assert.equal(check2.code, 0, `--check on a formatted file exits 0 (stdout: ${check2.stdout.slice(0, 200)})`);
	const j3 = json(check2);
	assert.equal(j3.ok, true);
	assert.equal(j3.unformatted, 0);
	assert.equal(j3.files[0].status, "unchanged");

	// 4. Idempotent: a second format is a no-op and byte-stable.
	const fmt2 = cli(["format", file]);
	assert.equal(fmt2.code, 0);
	assert.equal(json(fmt2).files[0].status, "unchanged");
	assert.equal(readFileSync(file, "utf8"), formatted, "a clean run is byte-stable");

	// 5. Explicit paths only: no path is an error, never a tree walk.
	const none = cli(["format"]);
	assert.equal(none.code, 1, "format with no paths exits 1");
	assert.match(json(none).error, /explicit paths/);

	// 6. The `-- <paths>` separator form, and a missing file is a reported error.
	const sep = cli(["format", "--check", "--", file]);
	assert.equal(sep.code, 0, "the `-- <paths>` form works");
	const missing = cli(["format", join(dir, "nope.mjs")]);
	assert.equal(missing.code, 1, "a missing file exits 1");
	assert.equal(json(missing).files[0].status, "error");

	// 7. The verb is discoverable from the help.
	const help = cli(["help"]);
	assert.match(help.stderr, /format \[--check\] \[-- <paths>\]/, "help lists the format verb");

	console.log("FORMAT TEST PASS (format normalizes; --check gates; explicit paths only; idempotent)");
} finally {
	rmSync(dir, { recursive: true, force: true });
}
process.exit(0);
