// demo/process-leak-guard.test.mjs — pins the kill guard in tools/process-leak-scan.mjs.
// WHY: the scan's whole safety is the predicate that separates "orphaned by a killed parent" from
// "the fleet's broker", "a suite still running", and "this tool itself". Getting it wrong is not a
// slow scan — it SIGTERMs the write leg of the rig or a seat's verifier. The measured leak it exists
// for: 30 reparented `node demo/broker.test.mjs` processes holding 2.42 GB RSS on a box with 10 GB
// available (2026-11-12T12:3xZ, Linux, Fedora Linux 45, kernel 7.2.15-300.fc45.x86_64, node v24.22.1).
// Trigger: any change to the guard in tools/process-leak-scan.mjs.
// Cost: 0.16 s, exit 0. No store, no broker, no seat, no /proc — the predicate is a pure function.
// (The keepalive loop is protected by the --pattern, not by classify; the pattern itself is pinned below.)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

const rigRoot = path.dirname(path.dirname(new URL(import.meta.url).pathname));

const imp = spawnSync("node", ["-e", "import('./tools/process-leak-scan.mjs').then(m=>console.log(typeof m.classify))"], {
	cwd: rigRoot, capture: true, timeout: 30000, encoding: "utf8",
});
assert.equal(imp.status, 0, `import failed: ${imp.stderr.slice(0, 300)}`);
assert.equal(imp.stdout.trim(), "function", "the tool must EXPORT classify, not only run a scan");

const { classify } = await import(path.join(rigRoot, "tools", "process-leak-scan.mjs"));

const base = { pid: 100, selfPid: 999, ancestors: new Set([999, 998]), ageS: 3600, minAgeS: 120, isSupervised: false, brokerPid: null, cmdline: "node demo/broker.test.mjs" };

const cases = [
	["a reparented test runner aged 1 h", { ...base }, true],
	["the fleet broker by pid", { ...base, pid: 56117, brokerPid: 56117 }, false],
	["the fleet broker by cmdline", { ...base, cmdline: "node /repo/cli.mjs serve --max-duration 3600" }, false],
	["a suite child still supervised by a live runner", { ...base, isSupervised: true }, false],
	["a test that started 30 s ago", { ...base, ageS: 30 }, false],
	["this tool's own parent chain", { ...base, pid: 998 }, false],
	["the tool itself", { ...base, pid: 999 }, false],
	["exactly at the min age (boundary is inclusive of kill)", { ...base, ageS: 120 }, true],
	["one second below the min age", { ...base, ageS: 119 }, false],
];

let fails = 0;
for (const [what, input, want] of cases) {
	const got = classify(input).kill;
	if (got === want) console.log(`ok   kill=${want} — ${what}`);
	else { fails += 1; console.log(`FAIL kill=${got} want ${want} — ${what}`); }
}

// Non-vacuous: the default pattern really does match the leak and really does NOT match the fleet's
// write leg or the keepalive loop.
const { DEFAULT_PATTERN } = await import(path.join(rigRoot, "tools", "process-leak-scan.mjs"));
assert.ok(typeof DEFAULT_PATTERN === "string" && DEFAULT_PATTERN.length > 0, "the tool must export its default pattern");
const re = new RegExp(DEFAULT_PATTERN);
assert.ok(re.test("node demo/broker.test.mjs"), "the default pattern must match the leak it was built for");
assert.ok(re.test("node scripts/test.mjs --all --jobs 4"), "the default pattern must match a suite runner");
assert.ok(!re.test("node /repo/cli.mjs serve --max-duration 3600"), "the default pattern must NOT match the fleet broker");
assert.ok(!re.test("node tools/broker-keepalive.mjs --interval 60"), "the default pattern must NOT match the keepalive loop");

console.log(fails ? `${fails} FAILURE(S)` : "all pins hold");
process.exit(fails ? 1 : 0);
