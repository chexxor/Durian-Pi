#!/usr/bin/env node
// tools/conflict-blocks.mjs — print every conflict block in a file (or every marked file in a
// worktree) with its side-by-side sides, so a human can decide in one bounded read instead of
// scrolling markers with `sed`.
//
// TRIGGER: tools/ref-recut.mjs reports NEEDS-HUMAN, or `grep -c '^<<<<<<< '` is nonzero in a
// worktree you are about to hand-resolve.
// Exact command:
//   node tools/conflict-blocks.mjs --worktree .spike/recut-item-3570 [--file src/rig.mjs] [--context 3]
// Cost: measured 2026-11-14, Linux, Fedora Linux 45, kernel 7.2.15-300.fc45.x86_64, node v24.22.1 —
// one file read per marked file; 8 worktrees in 0.2 s. No git calls, no suite.
// Exit 0 when no blocks were found, 1 when blocks were printed (a nonzero here is "work remains").
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const wt = argv.includes("--worktree") ? argv[argv.indexOf("--worktree") + 1] : null;
const only = argv.includes("--file") ? argv[argv.indexOf("--file") + 1] : null;
const ctx = Number(argv.includes("--context") ? argv[argv.indexOf("--context") + 1] : 3);
if (!wt) { console.error("conflict-blocks: need --worktree <path>"); process.exit(2); }

let files = [];
if (only) files = [only];
else {
  const st = spawnSync("git", ["status", "--porcelain"], { cwd: wt, encoding: "utf8" });
  files = st.stdout.split("\n").filter((l) => l.trim() && !l.includes("node_modules")).map((l) => l.slice(3).trim());
}

let total = 0;
for (const f of files) {
  const p = join(wt, f);
  if (!existsSync(p) || statSync(p).isDirectory()) continue;
  const lines = readFileSync(p, "utf8").split("\n");
  let i = 0, n = 0;
  while (i < lines.length) {
    if (lines[i].startsWith("<<<<<<<")) {
      n++; total++;
      let j = i;
      while (j < lines.length && !lines[j].startsWith(">>>>>>>")) j++;
      const eq = lines.findIndex((l, k) => k > i && k < j && l.startsWith("======="));
      console.log(`\n=== ${f} block ${n} (lines ${i + 1}-${j + 1})`);
      if (ctx > 0) for (let k = Math.max(0, i - ctx); k < i; k++) console.log(`  ctx ${k + 1}: ${lines[k].slice(0, 160)}`);
      if (eq === -1) {
        console.log("  [no ======= separator — a one-sided block]");
        for (let k = i + 1; k < j; k++) console.log(`  ALL: ${lines[k].slice(0, 200)}`);
      } else {
        console.log("  OURS:");
        for (let k = i + 1; k < eq; k++) console.log(`    ${lines[k].slice(0, 200)}`);
        console.log("  THEIRS:");
        for (let k = eq + 1; k < j; k++) console.log(`    ${lines[k].slice(0, 200)}`);
      }
      i = j;
    }
    i++;
  }
  if (n) console.log(`(${n} block(s) in ${f})`);
}
console.log(`conflict-blocks: ${total} block(s) across ${files.length} candidate file(s) in ${wt}`);
process.exit(total === 0 ? 0 : 1);
