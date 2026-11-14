#!/usr/bin/env node
/*
 * #7148 - what breaks if a `promote` verb moves main without a direction and identity check.
 * Built in a THROWAW repo inside this worktree; the real repo's refs are never touched.
 * Falsifier: exit 1 when a promote that trusts "staging -> main" silently loses commits.
 * Run: node tools/probes/promote-verb-failure-modes-7148.mjs
 */
import { execSync, execFileSync } from "node:child_process";
import { refusalFor } from "../../src/confine.mjs";

const git = (repo, args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
const rev = (repo, ref) => git(repo, ["rev-parse", ref]).trim();

console.log("=== 1. the refs the verb is specified against ===");
const refs = execSync("git for-each-ref --format='%(refname)' refs/heads", { encoding: "utf8" }).trim().split("\n");
console.log(`  refs/heads/staging exists in this repo: ${refs.includes("refs/heads/staging")}`);
console.log(`  refs/heads/main exists: ${refs.includes("refs/heads/main")}`);
const verb = execSync("grep -c '\"promote\"' cli.mjs || true", { encoding: "utf8" }).trim();
console.log(`  cli.mjs mentions a "promote" command ${verb} time(s)`);

console.log("=== 2. what a seat can write to those refs today ===");
for (const cmd of [
  "git update-ref refs/heads/staging deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  "git update-ref refs/heads/main deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  "git branch -f staging item-7148",
  "node cli.mjs promote",
  "node cli.mjs promote --dry-run",
  "node scripts/promote.mjs staging main",
  "node -e \"require('node:child_process').execSync('git update-ref refs/heads/main deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef')\"",
]) {
  const r = refusalFor(cmd, { root: process.cwd(), cwd: process.cwd() });
  console.log(`  ${r ? "REFUSED " : "ALLOWED "} ${cmd.slice(0, 52)}`);
}

console.log("=== 3. the direction failure, measured in a throwaway repo ===");
const repo = ".scratch-promote-probe";
execSync(`rm -rf ${repo} && mkdir ${repo} && git init -q ${repo} && git -C ${repo} config user.email probe@durig.local && git -C ${repo} config user.name probe`);
git(repo, ["commit", "-q", "--allow-empty", "-m", "A base"]);
const base = git(repo, ["rev-parse", "HEAD"]);
git(repo, ["branch", "staging", "HEAD"]);
git(repo, ["commit", "-q", "--allow-empty", "-m", "C main-only work"]);
const mainTip = git(repo, ["rev-parse", "HEAD"]);
// staging diverged: base + B, where B is not on main and main is not on staging.
const divergentTip = git(repo, ["commit-tree", git(repo, ["rev-parse", "HEAD^{tree}"]), "-p", base, "-m", "B staging-only work"]);
git(repo, ["update-ref", "refs/heads/staging", divergentTip]);
const stagingTip = git(repo, ["rev-parse", "refs/heads/staging"]);

const ahead = (() => { try { git(repo, ["merge-base", "--is-ancestor", "main", "staging"]); return true; } catch { return false; } })();
let ffCode = 0;
try { git(repo, ["merge", "--ff-only", "refs/heads/staging"]); } catch (e) { ffCode = e.status ?? 1; }
console.log(`  main tip ${mainTip.slice(0, 7)}; staging tip ${stagingTip.slice(0, 7)}; staging is a descendant of main? ${ahead}`);
console.log(`  fast-forward main to staging: exit ${ffCode}`);

const before = Number(git(repo, ["rev-list", "--count", "main"]));
git(repo, ["update-ref", "refs/heads/main", stagingTip]); // the naive promote
const after = Number(git(repo, ["rev-list", "--count", "main"]));
const lost = git(repo, ["rev-list", "--count", mainTip, "^" + stagingTip]);
console.log(`  commits reachable from main before: ${before}; after the naive promote: ${after}`);
console.log(`  naive promote (update-ref main staging): main now points at ${stagingTip.slice(0, 7)} and LOST ${lost} commit(s) that were on main`);

console.log("=== 4. the safe case, so the rule is not 'never promote' ===");
execSync(`rm -rf ${repo} && git init -q ${repo} && git -C ${repo} config user.email probe@durig.local && git -C ${repo} config user.name probe`);
git(repo, ["commit", "-q", "--allow-empty", "-m", "A base"]);
git(repo, ["commit", "-q", "--allow-empty", "-m", "C main-only work"]);
git(repo, ["update-ref", "refs/heads/staging", git(repo, ["commit-tree", git(repo, ["rev-parse", "HEAD^{tree}"]), "-p", git(repo, ["rev-parse", "HEAD"]), "-m", "B verified work"])]);
const ahead2 = (() => { try { git(repo, ["merge-base", "--is-ancestor", "main", "staging"]); return true; } catch { return false; } })();
console.log(`  staging ahead of main (additive)? ${ahead2}  <- this is the only shape the verb may advance`);
console.log("\n=== FALSIFIER ===");
execSync(`rm -rf ${repo}`); // leave no scratch behind
console.log(Number(lost) > 0
  ? "RED - 'promote staging to main' is not safe as a direction: update-ref silently reverts main. The verb must refuse when staging is not a descendant of main, and never force."
  : "GREEN - staging was ahead of main, so the promote was additive");
process.exit(Number(lost) > 0 ? 1 : 0);
