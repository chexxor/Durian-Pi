// demo/worktree-lifecycle.test.mjs — #473: worktree lifecycle wired into claim/completion.
//
// Proves:
// 1. claimWorktree creates worktree + branch + lock + deps
// 2. validateWorktreeIdentity verifies it's a real worktree
// 3. releaseWorktreeLock unlocks it
// 4. removeClaimedWorktree removes it cleanly
//
// Run: node demo/worktree-lifecycle.test.mjs  (exit 0 = pass)

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import {
  claimWorktree,
  removeClaimedWorktree,
  validateWorktreeIdentity,
  releaseWorktreeLock,
  listWorktrees,
} from "../src/worktree.mjs";

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

// Create a test git repo inside the durig repo itself, so git resolution always works.
const testDir = join(process.cwd(), ".durig-test-wt-" + Date.now());
try {
  spawnSync("git", ["init", testDir], { stdio: "pipe" });
  spawnSync("git", ["-C", testDir, "config", "user.email", "test@test.com"], { stdio: "pipe" });
  spawnSync("git", ["-C", testDir, "config", "user.name", "Test"], { stdio: "pipe" });
  // Create a file and commit
  const fs = await import("node:fs/promises");
  await fs.writeFile(join(testDir, "README.md"), "# test");
  spawnSync("git", ["-C", testDir, "add", "."], { stdio: "pipe" });
  spawnSync("git", ["-C", testDir, "commit", "-m", "initial"], { stdio: "pipe" });

  const worktreeRoot = join(testDir, "worktrees");
  // Ensure worktreeRoot dir exists (git worktree add requires parent)
  const fs2 = await import("node:fs");
  fs2.mkdirSync(worktreeRoot, { recursive: true });

  console.log("\n=== #473: worktree lifecycle ===\n");

  // --- 1. claimWorktree creates a worktree ---
  const wt = await claimWorktree({ source: testDir, worktreeRoot, itemLabel: "item-1" });
  check("claimWorktree returns cwd", wt.cwd !== undefined, JSON.stringify(wt));
  check("worktree path exists", existsSync(wt.worktree), wt.worktree);
  check("worktree has its own .git file", existsSync(join(wt.worktree, ".git")), wt.worktree);

  // Verify the worktree resolves to its own toplevel
  const toplevel = spawnSync("git", ["-C", wt.worktree, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: "pipe" });
  check("worktree toplevel is its own dir",
    resolve(toplevel.stdout.trim()) === resolve(wt.worktree),
    `got ${toplevel.stdout.trim()}, expected ${wt.worktree}`);

  // Verify it's detached
  const branch = spawnSync("git", ["-C", wt.worktree, "branch", "--show-current"], { encoding: "utf8", stdio: "pipe" });
  check("worktree is detached (no branch name)", branch.stdout.trim() === "", branch.stdout);

  // --- 2. validateWorktreeIdentity ---
  const id = await validateWorktreeIdentity(wt.worktree);
  check("validateWorktreeIdentity ok", id.ok === true, JSON.stringify(id));

  // --- 3. releaseWorktreeLock ---
  const released = await releaseWorktreeLock(wt.worktree);
  check("releaseWorktreeLock returns locked:false", released.locked === false, JSON.stringify(released));

  // --- 4. listWorktrees shows the worktree ---
  const listed = await listWorktrees(wt.repo);
  // #1453: identity is the PATH, not a substring. `item-10` contains `item-1`, and so does any
  // cwd that names a seat worktree (`item-1444`) — the repo's OWN root is such a path. Match the
  // exact resolved path instead of `includes`.
  check("listWorktrees shows our worktree",
    listed.some(l => resolve(l.worktree) === resolve(wt.worktree)),
    JSON.stringify(listed));

  // --- 5. removeClaimedWorktree ---
  const removed = await removeClaimedWorktree({ worktree: wt.worktree, force: true });
  check("removeClaimedWorktree returns removed:true", removed.removed === true, JSON.stringify(removed));
  check("worktree path no longer exists", !existsSync(wt.worktree));

  // --- 6. verify no residual worktree metadata ---
  const stillListed = await listWorktrees(wt.repo);
  check("removed worktree no longer listed",
    !stillListed.some(l => resolve(l.worktree) === resolve(wt.worktree)),
    JSON.stringify(stillListed));

  // --- 7. worktree creation fails on existing path ---
  // Re-create the worktree first (it was removed above), then try again to verify the guard.
  const wt2 = await claimWorktree({ source: testDir, worktreeRoot, itemLabel: "item-2" });
  try {
    await claimWorktree({ source: testDir, worktreeRoot, itemLabel: "item-2" });
    check("should fail on existing path", false, "no error thrown");
  } catch (err) {
    check("claimWorktree refuses existing path", true, err.message.slice(0, 50));
  } finally {
    await removeClaimedWorktree({ worktree: wt2.worktree, force: true });
  }

  // --- 8. #1453 regression: a path SUBSTRING is not item identity ---
  // `item-10` CONTAINS `item-1`, and the repo's own root contains `item-1` whenever the suite is
  // run from a seat worktree like `item-1444`. The old `!includes("item-1")` assertion therefore
  // could not hold while either existed — that is the false-fail. Identity matching must ignore it.
  const wt10 = await claimWorktree({ source: testDir, worktreeRoot, itemLabel: "item-10" });
  try {
    const entries = await listWorktrees(wt10.repo);
    check("identity: exactly one entry is item-10's worktree",
      entries.filter(l => resolve(l.worktree) === resolve(wt10.worktree)).length === 1,
      JSON.stringify(entries));
    check("the OLD substring form matches item-10's path too (the #1453 false-positive)",
      entries.some(l => l.worktree.includes("item-1")),
      JSON.stringify(entries.map(l => l.worktree)));
  } finally {
    await removeClaimedWorktree({ worktree: wt10.worktree, force: true });
  }

  console.log(failures === 0
    ? "\nPASS — worktree lifecycle wired and tested"
    : `\nFAIL — ${failures} check(s) failed`);
} catch (err) {
  console.error("ERROR:", err.message?.slice(0, 500));
  failures += 1;
} finally {
  try { rmSync(testDir, { recursive: true, force: true }); } catch {}
}

process.exit(failures === 0 ? 0 : 1);
