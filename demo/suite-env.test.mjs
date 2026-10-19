// demo/suite-env.test.mjs — #2126: a resource abort is ENVIRONMENTAL, not a regression.
//
// Under low commit headroom this box aborts spawn-heavy demos with opaque codes
// (0xC000012D / 0xC0000409 / SIGABRT / -1073740791), which the bare loop reads as a red
// regression. src/suite.mjs classifies those as ENVIRONMENTAL and refuses to call a run
// "green" when a member never ran.
//
// Proves: (a) exit 0 is pass, an ordinary nonzero is a REAL failure (never swallowed);
// (b) the known abort codes and SIGABRT are environmental; (c) the verdict is GREEN only
// when everything passed, ENVIRONMENTALLY-BLOCKED when none failed but some could not
// run, FAILED as soon as one genuinely failed; (d) the printed verdict never says green
// for a blocked run; (e) END-TO-END: a REAL `process.abort()` child classifies as
// environmental, and a real `process.exit(1)` child as a failure.
// Run: node demo/suite-env.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import {
  ENVIRONMENTAL_ABORT_CODES,
  classifyDemoResult,
  formatSuiteVerdict,
  summarizeSuite,
} from "../src/suite.mjs";

/* ------------------------------- (a)-(d) pure ------------------------------- */

// (a) pass and REAL failure.
assert.equal(classifyDemoResult({ exitCode: 0 }).kind, "pass");
assert.equal(classifyDemoResult({ exitCode: 1 }).kind, "fail", "a bare exit 1 is a REAL failure, never swallowed");
assert.equal(classifyDemoResult({ exitCode: 1, stderr: "AssertionError: x !== y" }).kind, "fail", "an assertion failure is a failure");

// (b) the known abort shapes are environmental (signed and unsigned forms).
for (const code of ENVIRONMENTAL_ABORT_CODES.keys()) {
  assert.equal(classifyDemoResult({ exitCode: code }).kind, "environmental", `code ${code} is environmental`);
}
assert.equal(classifyDemoResult({ exitCode: 0xC000012d }).kind, "environmental", "0xC000012D (unsigned) is environmental");
assert.equal(classifyDemoResult({ exitCode: -1073740791 }).kind, "environmental", "-1073740791 is environmental");
assert.equal(classifyDemoResult({ exitCode: null, signal: "SIGABRT" }).kind, "environmental", "SIGABRT is environmental");
assert.equal(
  classifyDemoResult({ exitCode: 1, stderr: "STATUS_COMMITMENT_LIMIT ..." }).kind,
  "environmental",
  "a commitment-limit stderr marker is environmental",
);
// Deliberately NOT environmental: a V8 heap OOM can be a real runaway loop.
assert.equal(classifyDemoResult({ exitCode: 1, stderr: "JavaScript heap out of memory" }).kind, "fail", "a plain heap OOM stays a failure");

// (c) the verdict.
const allPass = summarizeSuite([{ test: "a", exitCode: 0 }, { test: "b", exitCode: 0 }]);
assert.deepEqual([allPass.verdict, allPass.exitCode], ["GREEN", 0]);
const blocked = summarizeSuite([{ test: "a", exitCode: 0 }, { test: "b", exitCode: 0xc0000409 }]);
assert.deepEqual([blocked.verdict, blocked.exitCode], ["ENVIRONMENTALLY-BLOCKED", 2], "no failures but an abort => blocked");
assert.deepEqual(blocked.environmentalTests, ["b"]);
const failed = summarizeSuite([{ test: "a", exitCode: 1 }, { test: "b", exitCode: 0xc0000409 }]);
assert.deepEqual([failed.verdict, failed.exitCode], ["FAILED", 1], "a real failure wins over an environmental one");

// (d) the printed verdict never claims green for a blocked run.
const line = formatSuiteVerdict(blocked);
assert.match(line, /ENVIRONMENTALLY-BLOCKED/);
assert.match(line, /NOT a regression/);
assert.ok(!/GREEN/.test(line), "a blocked run is never printed as GREEN");
assert.match(formatSuiteVerdict(failed), /REAL FAILURES: a/);

/* --------------------------- (e) end-to-end spawn --------------------------- */

const aborting = spawnSync(process.execPath, ["-e", "process.abort()"], { encoding: "utf8" });
const abortCls = classifyDemoResult({ exitCode: aborting.status, signal: aborting.signal, stderr: aborting.stderr ?? "" });
assert.equal(abortCls.kind, "environmental", `a REAL aborting child is environmental (got ${JSON.stringify(abortCls)})`);

const failing = spawnSync(process.execPath, ["-e", "process.exit(1)"], { encoding: "utf8" });
assert.equal(classifyDemoResult({ exitCode: failing.status, signal: failing.signal }).kind, "fail", "a real exit 1 child is a failure");

const passing = spawnSync(process.execPath, ["-e", "process.exit(0)"], { encoding: "utf8" });
assert.equal(classifyDemoResult({ exitCode: passing.status, signal: passing.signal }).kind, "pass", "a real exit 0 child is a pass");

console.log(
  "SUITE-ENV TEST PASS (a resource abort is classified ENVIRONMENTAL, never a regression; a real failure is never swallowed; the verdict is GREEN only when every demo ran and passed; proven end-to-end against a real aborting child)",
);
process.exit(0);
