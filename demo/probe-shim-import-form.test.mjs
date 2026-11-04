// demo/probe-shim-import-form.test.mjs — run the DOCUMENTED command, not a paraphrase of it (#5026).
//
// The landed shim's own header told readers:
//     node --import tools/model-probes/no-headers-timeout-shim.mjs tools/model-probes/gate.mjs <baseUrl> <model>
// On node v24.22.1 that command cannot start: a bare `--import` argument is resolved as a PACKAGE name, so node
// dies with `ERR_MODULE_NOT_FOUND: Cannot find package 'tools'` before the probe runs. The failure is reproducible
// in this repo (re-run here, exit 1), and the fix is one character: `./tools/...`.
//
// WHY A DEMO AND NOT JUST A DOC EDIT: a usage line nobody executes drifts back. This test READS the usage line out
// of the shim's own header, executes it verbatim (gate.mjs with no baseUrl, which prints usage and exits 2 — no
// prompts, no endpoint, no money), and keeps the failing bare form pinned as failing.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHIM = "tools/model-probes/no-headers-timeout-shim.mjs";
const src = fs.readFileSync(path.join(ROOT, SHIM), "utf8");

// ---------------------------------------------------------------- 1. the documented line, taken from the file itself
const usageLine = (src.match(/^\/\/ Usage: (node --import \S+ \S+.*)$/m) ?? [])[1];
assert.ok(
	usageLine,
	"the shim must carry a `// Usage:` line — that line IS the documentation a seat copies",
);
const argv = usageLine.split(/\s+/);
assert.equal(argv[0], "node");
assert.equal(argv[1], "--import");
const importArg = argv[2];
assert.ok(
	importArg.startsWith("./") || importArg.startsWith("/") || importArg.startsWith("file:"),
	`a --import argument must be a PATH, not a bare package-style path: documented as ${JSON.stringify(importArg)} (node resolves a bare path as a package name and dies with ERR_MODULE_NOT_FOUND)`,
);
assert.equal(
	argv[3],
	"tools/model-probes/gate.mjs",
	"the documented target is the gate, so running it with no endpoint must be the safe, prompt-free leg",
);
const bareArg = importArg.replace(/^\.\//, ""); // the form that shipped in the docs until #5026

function run(args) {
	try {
		const out = execFileSync(process.execPath, args, {
			cwd: ROOT,
			stdio: "pipe",
			encoding: "utf8",
		});
		return { code: 0, text: out };
	} catch (err) {
		return { code: err.status ?? -1, text: `${err.stdout ?? ""}${err.stderr ?? ""}` };
	}
}

// ---------------------------------------------------------------- 2. the documented form RUNS (module resolves, gate reaches its own usage)
{
	// Drop the placeholder `<baseUrl> <model>`: the gate's own arg check exits 2 with its usage line. That proves
	// the SHIM loaded and the gate started, and it asks nothing of any provider.
	const r = run([argv[1], argv[2], argv[3]]);
	assert.ok(
		!/ERR_MODULE_NOT_FOUND/.test(r.text),
		`the documented command must not fail to load the shim: ${r.text.slice(0, 300)}`,
	);
	assert.equal(
		r.code,
		2,
		`gate.mjs should reach its own usage check and exit 2, got ${r.code}: ${r.text.slice(0, 300)}`,
	);
	assert.match(
		r.text,
		/usage: node gate\.mjs/,
		"the gate's usage line proves the process actually started under the shim",
	);
}

// ---------------------------------------------------------------- 3. and the old form is still pinned as broken
{
	const r = run([argv[1], bareArg, argv[3]]);
	assert.notEqual(r.code, 0, "the bare form must not be quietly fixed by something else");
	assert.match(
		r.text,
		/ERR_MODULE_NOT_FOUND/,
		"the defect this row fixes, kept reproducible: a bare --import path is a package name to node",
	);
	assert.match(r.text, /Cannot find package 'tools'/);
}

// ---------------------------------------------------------------- 4. the shim really is loaded by the working form
{
	// A prompt-free probe of the shim itself: it replaces global fetch at load. Ask for the module's own export
	// surface through the same import path the docs use, so the docs are tested for BOTH commands they name.
	const r = run([
		"--import",
		`./${SHIM}`,
		"-e",
		"console.log(typeof fetch, typeof globalThis.__durigNoHeadersTimeoutShim ?? 'patched-fetch')",
	]);
	assert.equal(r.code, 0, `loading the shim standalone must work: ${r.text.slice(0, 240)}`);
	assert.match(
		r.text,
		/function/,
		"fetch is still a function after the shim loads (it wraps it, it does not remove it)",
	);
}

console.log(
	`PROBE SHIM IMPORT-FORM PASS (documented line runs verbatim: \`${usageLine}\` → gate usage, exit 2; bare form \`--import ${bareArg}\` still ERR_MODULE_NOT_FOUND; shim loads standalone and keeps fetch a function)`,
);
