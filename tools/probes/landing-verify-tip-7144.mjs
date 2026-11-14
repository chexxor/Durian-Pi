#!/usr/bin/env node
/*
 * #7144 - can the landing gate actually be bound to a verify row?
 * Measures three things before anyone builds it:
 *   1. what scripts/land.mjs consults today (static: no verify row, no evidence field);
 *   2. whether done queue rows carry evidence in the shape the gate would need
 *      (item.evidence = {command, exitCode, artifact}) and how many name a tree;
 *   3. whether, for the unlanded branches in this repo, a DONE verify row exists whose
 *      evidence names that branch's tip sha - i.e. whether the gate would pass anything today.
 * Falsifier: exit 1 when no unlanded branch has a verify row naming its tip.
 * Run: node tools/probes/landing-verify-tip-7144.mjs [--db <path>]
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const db = process.argv.includes("--db") ? process.argv[process.argv.indexOf("--db") + 1] : "../selfdev.sqlite";
if (!process.env.DURIG_DB) console.log(`store: ${db} (via DURIG_DB)`);

const land = readFileSync("scripts/land.mjs", "utf8");
const gate = readFileSync("src/landinggate.mjs", "utf8");
const mentions = [...land.matchAll(/verify|evidence|verifier/gi)].length;
console.log("=== 1. what the landing gate reads today ===");
console.log(`  scripts/land.mjs: ${mentions} mention(s) of verify/evidence/verifier`);
console.log(`  src/landinggate.mjs: ${(gate.match(/verify|evidence|verifier/gi) || []).length} mention(s)`);
console.log("  gate inputs named in landinggate.mjs: argv flags + changedPaths (git diff) + suite exit only");

console.log("=== 2. does the store hold the raw material? ===");
let items = [];
try {
  const out = execSync("node cli.mjs queue --json --no-body", { encoding: "utf8", timeout: 120000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, DURIG_DB: db } });
  items = JSON.parse(out).items ?? [];
} catch (e) {
  console.log(`  could not read the store: ${e.message.split("\n")[0]}`);
  process.exit(2);
}
const done = items.filter((i) => i.status === "done");
const withEvidence = done.filter((i) => i.evidence);
const withArtifact = withEvidence.filter((i) => i.evidence.artifact);
const bareSha = withArtifact.filter((i) => /^[0-9a-f]{7,40}$/.test(String(i.evidence.artifact)));
console.log(`  rows ${items.length}; done ${done.length}; evidence-bearing ${withEvidence.length}; artifact-bearing ${withArtifact.length}; artifact is a bare sha ${bareSha.length}`);
const verifyRows = items.filter((i) => /verify/i.test(i.subject || ""));
const verifyDone = verifyRows.filter((i) => i.status === "done");
console.log(`  rows whose subject says VERIFY: ${verifyRows.length}; of those done: ${verifyDone.length}; done VERIFY rows carrying evidence: ${verifyDone.filter((i) => i.evidence).length}`);

console.log("=== 3. unlanded branches vs a verify row naming the tip ===");
let branches = [];
try {
  branches = execSync("git for-each-ref --format='%(refname:short) %(objectname)' refs/heads", { encoding: "utf8" })
    .trim().split("\n").filter((l) => /^item-/.test(l));
} catch (e) { console.log(`  git read failed: ${e.message.split("\n")[0]}`); }
const pairs = branches.map((l) => l.trim().split(/\s+/));
const unlanded = pairs.filter(([, sha]) => {
  try { execSync(`git merge-base --is-ancestor ${sha} main`, { encoding: "utf8" }); return false; } catch { return true; }
});
// Evidence artifacts are written in many shapes: a bare 7-char sha, "impl-item-253 @ cae04a4",
// "branch item-6999", "main". Match by sha PREFIX so the census is not rigged by string shape.
const shaTokens = new Set();
for (const i of withArtifact) for (const t of String(i.evidence.artifact).matchAll(/[0-9a-f]{7,40}/gi)) shaTokens.add(t[0].toLowerCase());
const verifyDoneWithEvidence = verifyDone.filter((i) => i.evidence);
const matched = unlanded.filter(([, sha]) => [...shaTokens].some((t) => sha.toLowerCase().startsWith(t)));
const verifyMatched = unlanded.filter(([name, sha]) =>
  verifyDoneWithEvidence.some((i) => i.subject.includes(name) || [...shaTokens].some((t) => sha.toLowerCase().startsWith(t) && i.subject.toLowerCase().includes("verify")))
);
console.log(`  unlanded item branches: ${unlanded.length}`);
console.log(`  distinct sha tokens in evidence artifacts: ${shaTokens.size}`);
console.log(`  unlanded branches whose tip is named by SOME done row's evidence artifact: ${matched.length}`);
console.log(`  unlanded branches with a DONE VERIFY row whose subject names the branch: ${unlanded.filter(([name]) => verifyDone.some((i) => i.subject.includes(name))).length}`);
console.log(`  unlanded branches with NO done row mentioning the branch name at all: ${unlanded.filter(([name]) => !done.some((i) => (i.subject || "").includes(name))).length}`);
// Who named the tip: the author's own completion, or a separate verify row?
let selfNamed = 0, independentNamed = 0;
for (const [name, sha] of unlanded) {
  const short = sha.slice(0, 7);
  const rows = done.filter((i) => (i.subject || "").includes(short) || String(i.evidence?.artifact || "").includes(short));
  if (!rows.length) continue;
  if (rows.some((i) => /verify/i.test(i.subject || ""))) independentNamed++;
  else selfNamed++;
}
console.log(`  tip named by a DONE row: ${selfNamed + independentNamed}; of those, rows whose subject says VERIFY: ${independentNamed}; the author's own completion: ${selfNamed}`);
console.log(`  branches whose tip is named by NO done row at all: ${unlanded.length - selfNamed - independentNamed}`);

console.log("\n=== FALSIFIER ===");
const verifyNamed = unlanded.filter(([name]) => verifyDone.some((i) => i.subject.includes(name)));
console.log(verifyNamed.length === 0
  ? "RED - not one unlanded branch has a DONE VERIFY row naming it, so a gate demanding one would refuse every landing"
  : `the gate is passable only where a verify row exists: ${verifyNamed.length} of ${unlanded.length} unlanded branches have a DONE VERIFY row naming the branch`);
process.exit(verifyNamed.length === 0 ? 1 : 0);
