// demo/seat-shell-wording.test.mjs — the persona's shell-tool line is GENERATED from the registry and
// pinned at the seat-creation seam (#5731, #5739).
//
// WHY THIS FILE EXISTS (measurements, not wishes).
//   - Scribe's #5701 hand-wrote the same sentence into 12 persona files. `grep -rln "Operating durig"
//     demo/` returned 0 hits: nothing asserted the sentence was there, so a reword could delete it silently.
//   - Lead's ruling (#5739) is that prose is the wrong carrier: src/shellregistry.mjs already computes
//     which shell tool this host registers (`shellPlan()` -> name, degraded, startedBy). A sentence in 12
//     files can disagree with that; a line emitted from the plan cannot.
//
// So the guard checks three things, and the third is what makes the first two mean something:
//   1. ONE SOURCE. The hand-written sentence is gone from every persona file, and the generated line is
//      what the seat receives. Twelve copies of prose and zero tests is the failure mode; one function and
//      a test is not.
//   2. THE LINE IS TRUE FOR THE HOST. For a Linux host with `bash` on PATH it names `bash`; for a Windows
//      host with pwsh it names `powershell`; for a host where NOTHING resolves it says so instead of
//      pretending a shell exists. Injected hosts, no real machines needed — `shellPlan` is already pure.
//   3. THE WIRLING IS THERE. The seat-creation path in cli.mjs must actually compose the line into the
//      instructions. A function nobody calls is documentation, not behaviour — the repo's recurring
//      "load-bearing comment nobody tested" shape.
//
// RED-FIRST: before the change this exits 1 (`shellToolLine` does not exist, and cli.mjs does not call it):
//   node demo/seat-shell-wording.test.mjs   -> exit 1 before, 0 after
// Run: node demo/seat-shell-wording.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { applyInstructionFiles, compilePersona } from "../src/rig.mjs";
import { shellToolLine, shellToolNames, shellPlan } from "../src/shellregistry.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const rigFile = join(ROOT, "rig.selfdev.json");
const cliSrc = await readFile(join(ROOT, "cli.mjs"), "utf8");

/* An injected host: `lookup` stands in for PATH so a Linux box, a Windows box and a shell-less box can all
 * be tested in one process. This is the same seam shellPlan() was built for (#4977). */
const host = (platform, onPath) => ({
	platform,
	env: {},
	exists: () => false,
	lookup: (program) => onPath[program] ?? null,
});

const LINUX = host("linux", { bash: "/usr/bin/bash" });
const WINDOWS = host("win32", { pwsh: "C:\\pwsh\\pwsh.exe" });
const NO_SHELL = host("linux", {});

/* 1. one source, not twelve. */
const spec = JSON.parse(await readFile(rigFile, "utf8"));
await applyInstructionFiles(spec, rigFile);
const seats = spec.seats ?? [];
assert.ok(seats.length >= 1, "rig.selfdev.json has no seats");
const handWritten = seats.filter((seat) => /SHELL TOOL this host actually registered/i.test(compilePersona(seat)));
assert.deepEqual(
	handWritten,
	[],
	`the shell sentence is still hand-written in ${handWritten.length} persona file(s) — prose and the registry would be two sources of truth`,
);
console.log(`persona files no longer hand-carry the sentence: ${seats.length} seats, ${handWritten.length} copies left`);

/* 2. the generated line is true for each host shape. */
const lineLinux = shellToolLine(LINUX);
assert.match(lineLinux, /registered on THIS host: the `bash` tool/, "a Linux host with bash on PATH must be told the `bash` tool is the registered one");
assert.match(lineLinux, /No `powershell` tool is registered/, "the line must say plainly that powershell is NOT registered on a Linux host, so a seat cannot assume it");
assert.ok(!lineLinux.includes("degraded"), "a host where bash resolves must not warn about a degraded shell");

const lineWindows = shellToolLine(WINDOWS);
assert.match(lineWindows, /registered on THIS host: the `powershell` tool/, "a Windows host with pwsh must be told the `powershell` tool is the registered one");
assert.match(lineWindows, /No `bash` tool is registered/, "the Windows line must say bash is not registered there");

const lineDegraded = shellToolLine(NO_SHELL);
assert.match(lineDegraded, /degraded/i, "a host where nothing resolves must be told the shell is degraded, not that it works");
assert.ok(shellPlan(NO_SHELL).degraded === true, "the plan itself reports degraded for a shell-less host");
console.log("generated line, three host shapes:");
console.log("  linux   :", lineLinux.slice(0, 120));
console.log("  win32   :", lineWindows.slice(0, 120));
console.log("  no shell:", lineDegraded.slice(0, 120));

/* The line must cover every shell the registry can register, so a future candidate cannot be missed. */
for (const name of shellToolNames()) {
	assert.ok(
		[lineLinux, lineWindows, lineDegraded].some((l) => l.includes(name)),
		`the generated line never mentions "${name}", which src/shellregistry.mjs can register`,
	);
}

/* 3. the wiring: cli.mjs composes it into the seat's instructions. */
assert.match(
	cliSrc,
	/compilePersona\(seat\),\s*shellToolLine\(\)/,
	"cli.mjs seat creation must join compilePersona(seat) with shellToolLine() — a function nobody calls is not behaviour",
);

/* Negative control: the guard fails when the wiring is removed, so passing means the wiring is real. */
const unwired = cliSrc.replace(/compilePersona\(seat\),\s*shellToolLine\(\)/, "compilePersona(seat)");
assert.ok(
	!/compilePersona\(seat\),\s*shellToolLine\(\)/.test(unwired),
	"the control did not actually remove the call, so it proves nothing",
);
assert.ok(
	!/compilePersona\(seat\),\s*shellToolLine\(\)/.test(unwired),
	"removing the call must make the wiring check fail — it does",
);
console.log("negative control OK: deleting the shellToolLine() call from cli.mjs makes this guard red");

console.log("SEAT-SHELL-WORDING PASS — one generated line, true per host, wired into seat creation");
