#!/usr/bin/env node
/*
 * #7141 - the blessed-ref writer surface, measured. What can a SEAT's shell command do to
 * refs/heads/main and refs/heads/staging through src/confine.mjs, and where does the string guard
 * stop being the boundary?
 * Falsifier: exit 1 while any direct ref-moving command naming main or staging is ALLOWED.
 * Run: node tools/probes/blessed-ref-writer-surface-7141.mjs
 */
import { refusalFor } from "../../src/confine.mjs";
import { readFileSync } from "node:fs";

const SHA = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
const root = process.cwd();

const direct = [
  ["update-ref main", `git update-ref refs/heads/main ${SHA}`],
  ["update-ref staging", `git update-ref refs/heads/staging ${SHA}`],
  ["branch -f main", "git branch -f main item-7141"],
  ["branch -f staging", "git branch -f staging item-7141"],
  ["merge --ff-only main", "git merge --ff-only main"],
  ["symbolic-ref HEAD to main", "git symbolic-ref HEAD refs/heads/main"],
  ["update-ref own item branch", "git update-ref refs/heads/item-7141 HEAD"],
  ["worktree add main", "git worktree add .worktrees/extra main"],
  ["reset --hard main", "git reset --hard main"],
  ["push main", "git push origin main"],
  ["commit on main", "git commit -m names another item"],
];

const indirect = [
  ["script that writes refs internally", "node scripts/land.mjs item-7141 --suite"],
  ["inline node writing the ref", `node -e "require('node:child_process').execSync('git update-ref refs/heads/main ${SHA}')"`],
  ["commit-tree / write-tree (object writes)", "git commit-tree 4b825dc642cb6eb9a060e54bf8d8d33f60861559 -m x"],
  ["git config", "git config core.reflock 1"],
];

console.log("=== direct ref-writing commands: what refusalFor allows a seat to run ===");
let allowedDirect = 0;
for (const [what, cmd] of direct) {
  const r = refusalFor(cmd, { root, cwd: root });
  if (r) console.log(`  REFUSED  ${what}`);
  else { allowedDirect++; console.log(`  ALLOWED  ${what}`); }
}
console.log(`  ${allowedDirect} of ${direct.length} direct commands allowed`);

console.log("=== indirect paths (the guard sees the command string, not the effect) ===");
let allowedIndirect = 0;
for (const [what, cmd] of indirect) {
  const r = refusalFor(cmd, { root, cwd: root });
  if (r) console.log(`  REFUSED  ${what}`);
  else { allowedIndirect++; console.log(`  ALLOWED  ${what}`); }
}
console.log(`  ${allowedIndirect} of ${indirect.length} indirect paths allowed`);

const land = readFileSync("scripts/land.mjs", "utf8");
const refWrites = [...land.matchAll(/git (update-ref|merge|branch|worktree)[^\n]*/g)].map((m) => m[0].slice(0, 60));
console.log(`=== scripts/land.mjs writes refs by design (${refWrites.length} git ref commands found)`);
for (const r of refWrites.slice(0, 6)) console.log(`  ${r}`);

console.log("\n=== FALSIFIER ===");
console.log(allowedDirect === 0
  ? "GREEN - no direct command can move main or staging"
  : `RED - ${allowedDirect} direct ref-moving commands are allowed; ${allowedIndirect} indirect paths sit outside the string guard's reach either way`);
process.exit(allowedDirect === 0 ? 0 : 1);
