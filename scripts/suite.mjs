// scripts/suite.mjs — run every demo/*.test.mjs and CLASSIFY the outcome (#2126).
//
// The plain loop (`for f in demo/*.test.mjs; do node $f; done`) collapses a resource
// abort into a bare nonzero code, so a commit-starvation batch reads as a regression.
// This runner uses src/suite.mjs to separate the two and prints ONE legible verdict:
//
//   node scripts/suite.mjs
//
// Exit 0 = GREEN (every demo passed); 2 = ENVIRONMENTALLY-BLOCKED (none failed, some
// could not RUN — commit starvation, NOT a regression); 1 = FAILED (a real failure).
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { classifyDemoResult, formatSuiteVerdict, summarizeSuite } from "../src/suite.mjs";

const root = process.cwd();
const demoDir = join(root, "demo");
const tests = readdirSync(demoDir)
  .filter((n) => n.endsWith(".test.mjs"))
  .sort();

const results = [];
for (const test of tests) {
  const run = spawnSync(process.execPath, [join("demo", test)], { cwd: root, encoding: "utf8" });
  const cls = classifyDemoResult({ exitCode: run.status, signal: run.signal, stderr: run.stderr ?? "" });
  results.push({ test, exitCode: run.status, signal: run.signal, stderr: run.stderr ?? "" });
  if (cls.kind !== "pass") console.error(`  ${cls.kind === "environmental" ? "ENV " : "FAIL"} demo/${test} — ${cls.reason}`);
}

const summary = summarizeSuite(results);
console.log(formatSuiteVerdict(summary));
process.exit(summary.exitCode);
