// src/suite.mjs — classify a demo-suite run so a RESOURCE failure never reads as a
// regression (#2126, lead #2166).
//
// WHY. Under low commit headroom this box aborts spawn-heavy demos with OPAQUE codes
// (0xC000012D, 0xC0000409, SIGABRT, -1073740791) instead of a clean failure, so the
// suite's signal becomes AMBIGUOUS: a commit-starvation collapse looks exactly like a
// red regression. This module is the missing reflex — it names the abort codes as
// ENVIRONMENTAL, keeps every other nonzero exit a REAL failure, and refuses to call a
// run "green" when a member never actually ran.
//
// HONESTY RULE (lead #2166 point 5): while commit is low, a full-suite result is
// BOUNDED — reported ENVIRONMENTALLY-BLOCKED, never "green". This module never swallows
// a real failure: only the known resource-abort shapes are environmental.
//
// Pure (no spawn, no clock, no store), so the classifier is testable without a terminal.

/** The OS/Node abort shapes that mean "the process died of resource starvation, not an
 * assertion". Keys are the DECIMAL exit codes (signed and unsigned forms both appear,
 * depending on the shell); values are the human label. */
export const ENVIRONMENTAL_ABORT_CODES = new Map([
  [3221225773, "STATUS_COMMITMENT_LIMIT (0xC000012D)"],
  [-1073741523, "STATUS_COMMITMENT_LIMIT (0xC000012D, signed)"],
  [3221226505, "STATUS_STACK_BUFFER_OVERRUN/fail-fast (0xC0000409)"],
  [-1073740791, "STATUS_STACK_BUFFER_OVERRUN/fail-fast (0xC0000409, signed)"],
  // The shell convention for a process killed by SIGABRT: 128 + 6. `process.abort()`
  // surfaces this way under some hosts even on Windows.
  [134, "SIGABRT (128+6)"],
]);

/** Signals that mean the runtime aborted rather than a test asserting. */
export const ENVIRONMENTAL_SIGNALS = new Set(["SIGABRT", "SIGKILL"]);

/** stderr markers of commit/memory starvation (deliberately NARROW: a plain V8
 * "heap out of memory" is NOT matched, because that can be a real runaway loop). */
const ENVIRONMENTAL_STDERR_RE = /STATUS_COMMITMENT_LIMIT|C000012D|commitment limit|C0000409|page file is too small/i;

/**
 * Classify ONE demo result. `exitCode`/`signal` come from the child process; `stderr`
 * is its captured stderr (optional).
 *
 * @returns {{kind:"pass"|"environmental"|"fail", code:number|null, reason:string}}
 */
export function classifyDemoResult({ exitCode, signal = null, stderr = "" } = {}) {
  const code = Number.isFinite(exitCode) ? Number(exitCode) : null;
  if (code === 0) return { kind: "pass", code: 0, reason: "exit 0" };
  if (signal && ENVIRONMENTAL_SIGNALS.has(signal)) {
    return { kind: "environmental", code, reason: `aborted by ${signal}` };
  }
  if (code !== null && ENVIRONMENTAL_ABORT_CODES.has(code)) {
    return { kind: "environmental", code, reason: ENVIRONMENTAL_ABORT_CODES.get(code) };
  }
  if (typeof stderr === "string" && ENVIRONMENTAL_STDERR_RE.test(stderr)) {
    return { kind: "environmental", code, reason: "stderr names a commit/memory starvation abort" };
  }
  return { kind: "fail", code, reason: `nonzero exit ${code ?? "(killed)"}` };
}

/**
 * Summarize a whole run. `results` is `[{ test, exitCode, signal?, stderr? }]`.
 *
 * A verdict is GREEN only when every member PASSED; ENVIRONMENTALLY-BLOCKED when none
 * FAILED but some could not run; FAILED as soon as one member genuinely failed.
 *
 * @returns {{pass:number, environmental:number, fail:number, verdict:"GREEN"|"ENVIRONMENTALLY-BLOCKED"|"FAILED", exitCode:number, environmentalTests:string[], failedTests:string[]}}
 */
export function summarizeSuite(results) {
  const rows = Array.isArray(results) ? results : [];
  const environmentalTests = [];
  const failedTests = [];
  let pass = 0;
  for (const r of rows) {
    const cls = classifyDemoResult(r);
    if (cls.kind === "pass") pass += 1;
    else if (cls.kind === "environmental") environmentalTests.push(r.test ?? "(unnamed)");
    else failedTests.push(r.test ?? "(unnamed)");
  }
  const fail = failedTests.length;
  const environmental = environmentalTests.length;
  const verdict = fail > 0 ? "FAILED" : environmental > 0 ? "ENVIRONMENTALLY-BLOCKED" : "GREEN";
  const exitCode = fail > 0 ? 1 : environmental > 0 ? 2 : 0;
  return { pass, environmental, fail, verdict, exitCode, environmentalTests, failedTests };
}

/**
 * The one-line verdict a caller prints, so the precondition is always visible: a run
 * that could not complete is NEVER reported as green.
 */
export function formatSuiteVerdict(summary) {
  const head = `SUITE ${summary.verdict}: pass=${summary.pass} environmental=${summary.environmental} fail=${summary.fail}`;
  if (summary.verdict === "GREEN") return head;
  if (summary.verdict === "FAILED") return `${head} — REAL FAILURES: ${summary.failedTests.join(", ")}`;
  return (
    `${head} — ENVIRONMENTAL (commit starvation, NOT a regression): ${summary.environmentalTests.join(", ")}. ` +
    `While commit headroom is low, verification is BOUNDED (targeted demos + node --check); ` +
    `re-run the full suite once commit recovers.`
  );
}
