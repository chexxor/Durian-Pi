#!/usr/bin/env node
/*
 * #7160 - can a `branchless-violation` check rule be written today, and what does it fire on?
 * Falsifier: exit 1 when the check as specified (recorded mode vs `git worktree list`) fires on rows
 * that are not violations, i.e. the rule starts red.
 * Run: node tools/probes/branchless-check-baseline-7160.mjs
 */
import { execSync } from "node:child_process";

const env = { ...process.env, DURIG_DB: "../selfdev.sqlite" };
const audit = JSON.parse(execSync("node cli.mjs worktree audit --json", { encoding: "utf8", env, maxBuffer: 32 * 1024 * 1024 }));
const items = JSON.parse(execSync("node cli.mjs queue --json --no-body", { encoding: "utf8", env, maxBuffer: 64 * 1024 * 1024 })).items;

const liveItemWorktrees = new Set(audit.worktrees.filter((w) => w.itemId != null).map((w) => w.itemId));
const nonTerminal = items.filter((i) => i.status !== "done" && i.status !== "cancelled");
const claimed = nonTerminal.filter((i) => i.status === "claimed");
const notClaimed = nonTerminal.filter((i) => i.status !== "claimed");

console.log("=== the state the check would run against ===");
console.log(`  worktrees: ${audit.total} (item-linked ${liveItemWorktrees.size}, reapable ${audit.reapable}, dirty ${audit.dirty}, locked ${audit.locked})`);
console.log(`  non-terminal queue rows: ${nonTerminal.length}`);
console.log(`  claimed rows: ${claimed.length}; rows not yet claimed: ${notClaimed.length}`);
console.log(`  non-terminal rows WITH a live worktree: ${nonTerminal.filter((i) => liveItemWorktrees.has(i.id)).length}`);
console.log(`  non-terminal rows WITHOUT one: ${nonTerminal.filter((i) => !liveItemWorktrees.has(i.id)).length}`);

console.log("=== the shared tree the branchless path would write into ===");
const main = audit.worktrees.find((w) => w.branch === "refs/heads/main");
console.log(`  main worktree uncommitted tracked changes: ${main?.uncommitted}`);
console.log(`  seat roots: ${audit.seatRoots.map((s) => `${s.name}=${s.cwd.includes("item-") ? "worktree" : "SHARED CHECKOUT"}`).join(", ")}`);

console.log("=== is there a branchless code path at all? ===");
const seattools = execSync("grep -n 'prepareSeatWorkspace' src/seattools.mjs", { encoding: "utf8" });
console.log(seattools.split("\n").map((l) => `  ${l}`).join("\n"));
const modeHits = execSync("grep -rn 'executionMode\\|branchless' src/ scripts/ | wc -l", { encoding: "utf8" }).trim();
console.log(`  occurrences of executionMode/branchless in src/ scripts/: ${modeHits}`);

console.log("\n=== FALSIFIER ===");
const wouldFire = nonTerminal.filter((i) => !liveItemWorktrees.has(i.id)).length;
console.log(wouldFire > claimed.length
  ? `RED - "mode says isolated but no worktree exists" matches ${wouldFire} rows, most of which are simply unclaimed (prepare_workspace runs at CLAIM). The rule starts red and gets disabled (#3539).`
  : "GREEN - the check's population is small enough to be a rule");
process.exit(wouldFire > claimed.length ? 1 : 0);
