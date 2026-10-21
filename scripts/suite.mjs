// scripts/suite.mjs — run every demo/*.test.mjs CONCURRENTLY and CLASSIFY the outcome (#2126).
//
// The plain loop (`for f in demo/*.test.mjs; do node $f; done`) collapses a resource
// abort into a bare nonzero code, so a commit-starvation batch reads as a regression.
// This runner uses src/suite.mjs to separate the two and prints ONE legible verdict:
//
//   node scripts/suite.mjs              # 8 demos at a time (default)
//   node scripts/suite.mjs --jobs 16    # or DURIG_SUITE_JOBS=16
//
// Exit 0 = GREEN (every demo passed); 2 = ENVIRONMENTALLY-BLOCKED (none failed, some
// could not RUN — commit starvation, NOT a regression); 1 = FAILED (a real failure).
//
// WHY a pool and not one loop: each demo is a separate Node process with its own temp
// dir/store, and the sequential loop leaves most of the box idle for ~10 minutes. The
// demos are process-isolated by construction; running N of them at once is safe as long
// as a demo does not reach for a shared mutable path. A demo that only passes alone is
// NOT hermetic and its failure under this runner is a real defect to fix in the demo.
//
// Failure lines are printed in TEST ORDER after the pool drains, so two runs of the same
// red suite produce the same report (a completion-order print would not).
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { classifyDemoResult, formatSuiteVerdict, summarizeSuite } from "../src/suite.mjs";

const DEFAULT_JOBS = 8;
const MAX_JOBS = 32;
// A demo that hangs must not wedge the whole pool. 300s is far above the slowest real
// demo (~30s); the kill is reported as a failure, never silently swallowed.
const TEST_TIMEOUT_MS = 300_000;

const root = process.cwd();
const demoDir = join(root, "demo");
const tests = readdirSync(demoDir)
  .filter((n) => n.endsWith(".test.mjs"))
  .sort();

// One private temp root per RUN and one directory per TEST, forwarded as
// TMP/TEMP/TMPDIR. Two demos that both call os.tmpdir() then cannot collide on a
// fixed child name (a real non-hermetic failure that only shows up under a pool).
const runTemp = mkdtempSync(join(tmpdir(), "durig-suite-"));
const tempFor = (test) => join(runTemp, test.replace(/\.test\.mjs$/, ""));
function cleanupTemp() {
  try {
    rmSync(runTemp, { recursive: true, force: true });
  } catch (error) {
    // A leftover temp tree is harmless; hiding the failure would not be.
    console.error(`suite: could not remove ${runTemp}: ${error.message}`);
  }
}

function resolveJobs(argv) {
  const flagAt = argv.findIndex((a) => a === "--jobs" || a.startsWith("--jobs="));
  const raw =
    flagAt >= 0
      ? argv[flagAt].includes("=")
        ? argv[flagAt].slice(argv[flagAt].indexOf("=") + 1)
        : argv[flagAt + 1]
      : process.env.DURIG_SUITE_JOBS ?? String(DEFAULT_JOBS);
  const jobs = Number(raw);
  if (!Number.isInteger(jobs) || jobs < 1 || jobs > MAX_JOBS) {
    console.error(`suite: --jobs must be an integer 1..${MAX_JOBS} (got ${JSON.stringify(raw)})`);
    process.exit(2);
  }
  return jobs;
}

/** Run one demo; never rejects, so one bad child cannot abort the pool. */
function runOne(test) {
  return new Promise((resolve) => {
    const testTemp = tempFor(test);
    mkdirSync(testTemp, { recursive: true });
    const child = spawn(process.execPath, [join("demo", test)], {
      cwd: root,
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, TMPDIR: testTemp, TEMP: testTemp, TMP: testTemp },
    });
    let stderr = "";
    let timedOut = false;
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, TEST_TIMEOUT_MS);
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({ test, exitCode: null, signal: null, stderr: `${stderr}\nsuite: spawn failed: ${error.message}` });
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        test,
        exitCode: timedOut ? 124 : code,
        signal,
        stderr: timedOut ? `${stderr}\nsuite: timed out after ${TEST_TIMEOUT_MS}ms` : stderr,
      });
    });
  });
}

const jobs = resolveJobs(process.argv.slice(2));
const results = new Array(tests.length);
let next = 0;
async function worker() {
  for (;;) {
    const index = next++;
    if (index >= tests.length) return;
    results[index] = await runOne(tests[index]);
  }
}
await Promise.all(Array.from({ length: Math.min(jobs, tests.length) }, worker));

const rows = results.filter(Boolean);
for (const row of rows) {
  const cls = classifyDemoResult(row);
  if (cls.kind !== "pass") {
    console.error(`  ${cls.kind === "environmental" ? "ENV " : "FAIL"} demo/${row.test} — ${cls.reason}`);
  }
}

const summary = summarizeSuite(rows);
console.log(`${formatSuiteVerdict(summary)} — jobs=${jobs}, demos=${tests.length}`);
cleanupTemp();
process.exit(summary.exitCode);
