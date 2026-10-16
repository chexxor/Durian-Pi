// demo/prepare-workspace.test.mjs — the seat-facing workspace tool (delegate-owned
// `prepare_workspace`), failing-first.
//
// The defect this closes: the broker used to create ONE worktree per pass for the
// FIRST seat with queued work and set a process-global `DURIG_SEAT_ROOT`, so every
// seat woken in that pass shared one root, and a seat's tools could be pointed at a
// worktree it never claimed. This proves the replacement:
//   - `prepareSeatWorkspace` creates the item's worktree idempotently (a second call
//     reuses it, never nests one inside another — the #506 recursive-carry bug);
//   - the worktree reproduces the source's path inside the repo, so a durig
//     subdirectory keeps its `cwd`;
//   - `makeSeatEnv` resolves a seat's OWN prepared cwd over the process-global
//     `DURIG_SEAT_ROOT` (the per-seat/per-item switch);
//   - `removeSeatWorkspace` retires it.
//
// Before this module/function existed the import fails (RED). Run:
//   node demo/prepare-workspace.test.mjs   (exit 0 = pass)
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { prepareSeatWorkspace, removeSeatWorkspace } from "../src/worktree.mjs";
import { makeSeatEnv } from "../src/seattools.mjs";

const run = promisify(execFile);
const base = await mkdtemp(join(tmpdir(), "durig-prepare-"));
const repo = join(base, "repo");
const source = join(repo, "durig");
let worktree = null;

try {
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "artifact.txt"), "shared content\n");
  await run("git", ["init", "-q", repo]);
  await run("git", ["-C", repo, "add", "durig/artifact.txt"]);
  await run("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);

  // --- 1. create the item's worktree; the subdir path is reproduced ---
  const first = await prepareSeatWorkspace({ source, worktreeRoot: source, itemId: 7 });
  worktree = first.worktree;
  assert.equal(first.created, true, "first call creates the worktree");
  assert.equal(first.branch, "item-7", "the worktree is put on the item branch (#859)");
  assert.ok(first.worktree.endsWith(join("durig", "item-7")) || first.worktree.endsWith("item-7"),
    `worktree is at item-7 (got ${first.worktree})`);
  assert.ok(existsSync(first.cwd), `the seat cwd exists (got ${first.cwd})`);
  assert.ok(existsSync(join(first.worktree, ".git")), "the worktree has its own .git file");
  assert.match(first.cwd.replace(/\\/g, "/"), /item-7\/durig$/, "the source's repo-relative path is reproduced");
  assert.equal((await readFile(join(first.cwd, "artifact.txt"), "utf8")).replace(/\r\n/g, "\n"), "shared content\n", "the item's files are present");

  // --- 2. idempotent: a rerun reuses the same worktree, never nests ---
  const second = await prepareSeatWorkspace({ source, worktreeRoot: source, itemId: 7 });
  assert.equal(second.created, false, "a rerun does not re-create");
  assert.equal(second.cwd, first.cwd, "a rerun returns the same cwd");
  assert.ok(!existsSync(join(first.cwd, "item-7")), "no nested item-7 worktree inside the first");

  // --- 2b. the worktree is on an ITEM BRANCH, not a detached HEAD (#859) ---
  const branchOf = async (wt) => (await run("git", ["-C", wt, "branch", "--show-current"])).stdout.trim();
  assert.equal(await branchOf(first.worktree), "item-7", "the worktree is on item-7, not detached");
  assert.equal(second.branch, "item-7", "prepareSeatWorkspace reports the branch");
  // A commit made in the worktree lands on the branch — the whole point of #859.
  await writeFile(join(first.cwd, "work.txt"), "x\n");
  await run("git", ["-C", first.cwd, "-c", "user.email=t@t", "-c", "user.name=t", "add", "work.txt"]);
  await run("git", ["-C", first.cwd, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "item work"]);
  assert.equal(await branchOf(first.worktree), "item-7", "the commit stays on the branch");
  assert.match((await run("git", ["-C", repo, "log", "--oneline", "item-7"])).stdout, /item work/, "the repo sees the item branch");

  // --- 2c. the branch is <seat>-item-<id> when the seat is known. Done in a
  //     FRESH repo: a second worktree under the same source triggers the #506
  //     recursive-carry (a sibling worktree is untracked and gets carried), which
  //     is a separate concern from #859. ---
  const repo2 = join(base, "repo2");
  const source2 = join(repo2, "durig");
  await mkdir(source2, { recursive: true });
  await writeFile(join(source2, "artifact.txt"), "x\n");
  await run("git", ["init", "-q", repo2]);
  await run("git", ["-C", repo2, "add", "durig/artifact.txt"]);
  await run("git", ["-C", repo2, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
  const seated = await prepareSeatWorkspace({ source: source2, worktreeRoot: source2, itemId: 9, seatName: "impl" });
  assert.equal(seated.branch, "impl-item-9", "the branch is <seat>-item-<id>");
  assert.equal(await branchOf(seated.worktree), "impl-item-9");
  await removeSeatWorkspace({ worktreeRoot: source2, itemId: 9 });

  // --- 2d. reuse REPAIRS a detached worktree (an older run's worktree) ---
  await run("git", ["-C", first.worktree, "checkout", "--detach"]);
  assert.equal(await branchOf(first.worktree), "", "detached");
  const repaired = await prepareSeatWorkspace({ source, worktreeRoot: source, itemId: 7 });
  assert.equal(await branchOf(repaired.worktree), "item-7", "re-prepare re-establishes the branch");
  assert.equal(repaired.branchAction, "created-at-detached-head", "and reports what it did");
  assert.match((await run("git", ["-C", repo, "log", "--oneline", "item-7"])).stdout, /item work/, "the commit made on the detached HEAD is preserved on the branch");

  // --- 3. the seat's OWN prepared cwd wins over the process-global root ---
  const decoy = join(base, "decoy-shared-tree");
  const roster = new Map();
  process.env.DURIG_SEAT_ROOT = decoy;
  const env = makeSeatEnv(roster)({ conversationId: 1, cwd: first.cwd });
  assert.equal(env.cwd, first.cwd, "the prepared per-seat cwd beats DURIG_SEAT_ROOT");
  delete process.env.DURIG_SEAT_ROOT;

  // --- 4. cleanup retires the worktree ---
  const removed = await removeSeatWorkspace({ worktreeRoot: source, itemId: 7 });
  assert.ok(removed.removed, `removeSeatWorkspace removes it (${JSON.stringify(removed)})`);
  assert.ok(!existsSync(worktree), "the worktree path is gone");

  console.log("PREPARE-WORKSPACE PASS (idempotent per-item worktree; the seat's own cwd wins)");
} finally {
  delete process.env.DURIG_SEAT_ROOT;
  if (worktree && existsSync(worktree)) {
    // Best-effort only: a failed removal must not mask the assertion above. The
    // worktree is locked while claimed, so unlock before --force.
    try { await run("git", ["-C", repo, "worktree", "unlock", worktree]); } catch (err) {
      console.error(`cleanup: git worktree unlock failed: ${err.message}`);
    }
    try { await run("git", ["-C", repo, "worktree", "remove", "--force", worktree]); } catch (err) {
      console.error(`cleanup: git worktree remove failed: ${err.message}`);
    }
  }
  await rm(base, { recursive: true, force: true });
}

// Exiting inside the try would skip the finally above.
process.exit(0);
