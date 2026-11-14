// Probe for #7643: is the #7143 verify-pair collision rule DECIDABLE?
//   clause A: PASS if S == T
//   clause B: PASS if S is an ancestor of T and "the verified content is identical at T"
//   clause C: REFUSE otherwise
// Every assertion is a real git/node command against this rig's real commits. Exit 0 = all held.
import { execFileSync } from "node:child_process";
import { mkdtempSync, symlinkSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const repo = process.cwd();
const git = (args, cwd = repo) => {
  try {
    return { code: 0, out: execFileSync("git", args, { cwd, encoding: "utf8" }).trim() };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "").trim(), err: (e.stderr ?? "").trim() };
  }
};
const run = (cmd, args, cwd) => {
  try { return { code: 0, out: execFileSync(cmd, args, { cwd, encoding: "utf8" }).trim() }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout ?? "").trim(), err: (e.stderr ?? "").trim() }; }
};
const who = ["-c", "user.email=probe@durig.local", "-c", "user.name=probe"];

let fails = 0;
const check = (name, cond, detail) => {
  fails += cond ? 0 : 1;
  console.log(`${cond ? "PASS" : "FAIL"} ${name} :: ${detail}`);
};

const scratchAt = (sha, tag) => {
  const p = mkdtempSync(join(repo, `.verify-scratch-${tag}-7643`));
  git(["worktree", "add", "--detach", p, sha]);
  try { symlinkSync(join(repo, "node_modules"), join(p, "node_modules")); } catch (e) { /* not needed for the assertion */ }
  return p;
};
const drop = (p) => { git(["worktree", "remove", "--force", p]); rmSync(p, { recursive: true, force: true }); };

/* ── 1. A REAL derived merge on this rig ── */
const T = git(["rev-parse", "main"]).out;
const parents = git(["rev-list", "--parents", "-1", T]).out.split(/\s+/).slice(1);
const S = parents[0];
const Sbase = git(["rev-parse", `${S}^`]).out;
const artifactPaths = git(["diff", "--name-only", Sbase, S]).out.split("\n").filter(Boolean);
console.log(`main tip T=${T}  landed branch tip S=${S}  S touched ${artifactPaths.length} path(s)  parents of T: ${parents.join(", ")}`);

check("1a clause B's ancestry half holds for a real merge",
  git(["merge-base", "--is-ancestor", S, T]).code === 0,
  `git merge-base --is-ancestor ${S.slice(0, 12)} ${T.slice(0, 12)} -> exit 0`);

check("1b clause B's content half is FALSE tree-wide on a real derived merge",
  git(["diff", "--quiet", S, T]).code === 1,
  `git diff --quiet ${S.slice(0, 12)} ${T.slice(0, 12)} -> exit 1 (T carries the other merged work)`);

check("1c even PATH-SCOPED to what S touched, the content half is FALSE on a real merge",
  git(["diff", "--quiet", S, T, "--", ...artifactPaths]).code === 1,
  `git diff --quiet ${S.slice(0, 12)} ${T.slice(0, 12)} -- ${artifactPaths.join(" ")} -> exit 1 (the merge re-resolves a file the branch touched)`);

/* ── 2. The same check, re-run in the two trees: the verdict is the gate ── */
const atS = scratchAt(S, "S");
const atT = scratchAt(T, "T");
const rS = run("node", ["demo/declared-window-seam.test.mjs"], atS);
const rT = run("node", ["demo/declared-window-seam.test.mjs"], atT);
drop(atS); drop(atT);
check("2 a check recorded at S cannot certify T: the same command gives a different verdict",
  rS.code === 1 && rT.code === 0,
  `node demo/declared-window-seam.test.mjs at S -> exit ${rS.code} (${rS.err.split("\n")[0] || "file not present"}); at T -> exit ${rT.code}`);

/* ── 3. SQUASH shape: ancestry alone REFUSEs a landing whose content IS the verified one ── */
const scratch = scratchAt(T, "squash");
const g = (a) => git(a, scratch);
const base = T;
g([...who, "commit", "--allow-empty", "-qm", "probe(#7643): shared base"]);
writeFileSync(join(scratch, "probe-artifact.txt"), "the verified thing\n");
g(["add", "probe-artifact.txt"]);
g([...who, "commit", "-qm", "probe(#7643): branch tip S (the sha a VERIFY row would name)"]);
const Ssyn = g(["rev-parse", "HEAD"]).out;
g(["reset", "--hard", base]);
g([...who, "commit", "--allow-empty", "-qm", "probe(#7643): unrelated work on the landing line"]);
writeFileSync(join(scratch, "probe-artifact.txt"), "the verified thing\n");
g(["add", "probe-artifact.txt"]);
g([...who, "commit", "-qm", "probe(#7643): squash-land the same content on a different history"]);
const Tsquash = g(["rev-parse", "HEAD"]).out;
drop(scratch);

check("3 ancestry-only REFUSEs a landing whose content is identical",
  git(["merge-base", "--is-ancestor", Ssyn, Tsquash]).code === 1,
  `merge-base --is-ancestor ${Ssyn.slice(0, 12)} ${Tsquash.slice(0, 12)} -> exit 1`);
check("3b the content comparison is the only thing that would PASS it",
  git(["diff", "--quiet", Ssyn, Tsquash, "--", "probe-artifact.txt"]).code === 0,
  `git diff --quiet ${Ssyn.slice(0, 12)} ${Tsquash.slice(0, 12)} -- probe-artifact.txt -> exit 0`);

/* ── 4. STALE verify: content moved between S and T ── */
const stale = scratchAt(Ssyn, "stale");
const h = (a) => git(a, stale);
writeFileSync(join(stale, "probe-artifact.txt"), "changed after the check\n");
h(["add", "probe-artifact.txt"]);
h([...who, "commit", "-qm", "probe(#7643): artifact changed on the landing line"]);
const Tchanged = h(["rev-parse", "HEAD"]).out;
drop(stale);

check("4 the content comparison REFUSEs stale evidence",
  git(["diff", "--quiet", Ssyn, Tchanged, "--", "probe-artifact.txt"]).code === 1,
  `git diff --quiet ${Ssyn.slice(0, 12)} ${Tchanged.slice(0, 12)} -- probe-artifact.txt -> exit 1`);

console.log(fails === 0 ? "\nALL CHECKS PASS (exit 0)" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
