#!/usr/bin/env node
// tools/conflict-blocks.mjs — print every conflict block in a file (or every marked file in a
// worktree) with its side-by-side sides, so a human can decide in one bounded read instead of
// scrolling markers with `sed`.
//
// TRIGGER: tools/ref-recut.mjs reports NEEDS-HUMAN, or `grep -c '^<<<<<<< '` is nonzero in a
// worktree you are about to hand-resolve.
// Exact command:
//   node tools/conflict-blocks.mjs --worktree .spike/recut-item-3570 [--file src/rig.mjs] [--context 3]
//   Untruncated lines (a hand-union needs the exact text): add --full.
//   Several worktrees in one call: --worktree a,b,c.  Sweep every recut worktree: --census.
// Cost: measured 2026-11-14, Linux, Fedora Linux 45, kernel 7.2.15-300.fc45.x86_64, node v24.22.1 —
// one file read per marked file; 8 worktrees in 0.2 s; --census over 15 recut worktrees in 0.4 s.
// No git calls beyond one `git status --porcelain` per worktree, no suite.
// Exit 0 when no blocks were found, 1 when blocks were printed (a nonzero here is "work remains").
//
// Addendum 2026-11-14 (delegate): truncation at 200 chars hid the tail of long lines, which is
// exactly where a hand-union decision lives (trailing arguments, closing braces). --full exists
// because a truncated block cannot be unioned safely; the census mode exists because counting
// `<<<<<<<` by hand across 15 worktrees costs a command per worktree.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
let wtList = argv.includes("--worktree")
  ? argv[argv.indexOf("--worktree") + 1].split(",").map((s) => s.trim()).filter(Boolean)
  : [];
if (argv.includes("--census")) {
  const root = argv.includes("--root") ? argv[argv.indexOf("--root") + 1] : ".spike";
  wtList = readdirSync(root)
    .filter((d) => d.startsWith("recut-") && statSync(join(root, d)).isDirectory())
    .map((d) => join(root, d));
}
const only = argv.includes("--file") ? argv[argv.indexOf("--file") + 1] : null;
const ctx = Number(argv.includes("--context") ? argv[argv.indexOf("--context") + 1] : 3);
const full = argv.includes("--full") || argv.includes("full");
const cut = (s) => (full ? s : s.slice(0, 200));
if (!wtList.length) { console.error("conflict-blocks: need --worktree <path>[,<path>...] or --census"); process.exit(2); }

let grand = 0;
for (const wt of wtList) grand += report(wt);
console.log(`conflict-blocks: ${grand} block(s) total`);
process.exit(grand === 0 ? 0 : 1);

function report(wt) {
  if (!existsSync(wt)) { console.error(`conflict-blocks: ${wt} does not exist`); return 0; }
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
        console.log(`\n=== ${wt}/${f} block ${n} (lines ${i + 1}-${j + 1})`);
        if (ctx > 0) for (let k = Math.max(0, i - ctx); k < i; k++) console.log(`  ctx ${k + 1}: ${cut(lines[k])}`);
        if (eq === -1) {
          console.log("  [no ======= separator — a one-sided block]");
          for (let k = i + 1; k < j; k++) console.log(`  ALL: ${cut(lines[k])}`);
        } else {
          console.log("  OURS (main):");
          for (let k = i + 1; k < eq; k++) console.log(`    ${cut(lines[k])}`);
          console.log("  THEIRS (item ref):");
          for (let k = eq + 1; k < j; k++) console.log(`    ${cut(lines[k])}`);
        }
        i = j;
      }
      i++;
    }
    if (n) console.log(`(${n} block(s) in ${f})`);
  }
  return total;
}
