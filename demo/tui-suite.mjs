// demo/tui-suite.mjs — one command to run every TUI regression test
// (`npm run test:tui`). It exists so a TUI change is verified the same way every
// time, instead of the operator remembering which demo files to run.
//
// The suite is hermetic (no store, no harness, no TTY), so it is safe to run while
// the broker is live — unlike the full demo suite, which contends with a writer
// (docs/NEXT.md).

import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// Every TUI-specific demo, plus the two render-boundary suites that live outside the
// tui- prefix. `ui-driver` is the driver state machine; `sanitize` guards the escapes
// that reach all three human surfaces.
const files = readdirSync(HERE)
	.filter((f) => /^tui-.*\.test\.mjs$/.test(f) || f === "ui-driver.test.mjs" || f === "sanitize.test.mjs")
	.sort();

const results = [];
for (const file of files) {
	const run = spawnSync(process.execPath, [join(HERE, file)], { encoding: "utf8" });
	results.push({ file, ok: run.status === 0, output: `${run.stdout ?? ""}${run.stderr ?? ""}` });
}

for (const r of results) {
	if (r.ok) {
		console.log(`PASS ${r.file}`);
	} else {
		console.log(`FAIL ${r.file}`);
		const tail = r.output.trim().split("\n").slice(-8).join("\n");
		console.log(tail.replace(/^/gm, "    "));
	}
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} TUI test files passed${failed ? ` — ${failed} FAILED` : ""}`);
process.exit(failed === 0 ? 0 : 1);
