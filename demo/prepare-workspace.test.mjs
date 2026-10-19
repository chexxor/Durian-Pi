// demo/prepare-workspace.test.mjs — the seat-facing workspace tool (delegate-owned
// `prepare_workspace`), failing-first.
//
// The defect this closes: the broker used to create ONE worktree per pass for the
// FIRST seat with queued work and set a process-global `DURIAN_PI_SEAT_ROOT`, so every
// seat woken in that pass shared one root, and a seat's tools could be pointed at a
// worktree it never claimed. This proves the replacement:
//   - `prepareSeatWorkspace` creates the item's worktree idempotently (a second call
//     reuses it, never nests one inside another — the #506 recursive-carry bug);
//   - the worktree reproduces the source's path inside the repo, so a durian-pi
//     subdirectory keeps its `cwd`;
//   - `makeSeatEnv` resolves a seat's OWN prepared cwd over the process-global
//     `DURIAN_PI_SEAT_ROOT` (the per-seat/per-item switch);
//   - `removeSeatWorkspace` retires it;
//   - `installWorktreeDeps` actually RUNS npm on a package.json-bearing tree
//     (#822: the worktree fixture below has no package.json, so the old demo took
//     the `skipped` early-return and never exercised the npm invocation — which
//     meant `execFile("npm", …)` failing with `spawn npm ENOENT` on Windows went
//     unseen).
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

import { installWorktreeDeps, prepareSeatWorkspace, removeSeatWorkspace } from "../src/worktree.mjs";
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

  // --- 4. installWorktreeDeps RUNS npm when package.json exists (#822) ---
  // A no-dependency package.json + hand-written lockfile is enough for `npm ci`
  // and stays offline/fast. The point is that the npm path is entered at all:
  // the old deleted fixture (no package.json) skipped it, hiding `spawn npm ENOENT`.
  const depDir = join(base, "dep-fixture");
  await mkdir(depDir, { recursive: true });
  await writeFile(join(depDir, "package.json"), JSON.stringify({ name: "dep-fixture", version: "1.0.0", private: true, dependencies: {} }));
  await writeFile(join(depDir, "package-lock.json"), JSON.stringify({
    name: "dep-fixture", version: "1.0.0", lockfileVersion: 3, requires: true,
    packages: { "": { name: "dep-fixture", version: "1.0.0" } },
  }));
  const installed = await installWorktreeDeps(depDir);
  assert.equal(installed.skipped, undefined, "npm is invoked, not skipped (package.json present)");
  assert.equal(installed.ok, true, `npm ci succeeds (${JSON.stringify(installed).slice(0, 160)})`);
  // (Zero-dependency fixtures need not produce node_modules; the load-bearing
  // assertion is that npm was actually spawned and exited 0 rather than ENOENTing.)
  // A package.json without a lockfile must FAIL LOUDLY, and the error must name a
  // cause (not the old empty message from an ENOENT spawn).
  const noLock = join(base, "no-lock");
  await mkdir(noLock, { recursive: true });
  await writeFile(join(noLock, "package.json"), JSON.stringify({ name: "no-lock", version: "1.0.0", private: true }));
  let loudMessage = null;
  try {
    await installWorktreeDeps(noLock);
  } catch (err) {
    loudMessage = err.message;
  }
  assert.ok(loudMessage, "npm ci without a lockfile throws");
  assert.ok(loudMessage.includes("npm ci --prefer-offline failed in"), `the message names the operation (got ${loudMessage})`);
  assert.match(loudMessage, /lock/i, `the message names a cause, not an empty stderr (got ${loudMessage})`);

  // --- 5. cleanup retires the worktree ---
  const removed = await removeSeatWorkspace({ worktreeRoot: source, itemId: 7 });
  assert.ok(removed.removed, `removeSeatWorkspace removes it (${JSON.stringify(removed)})`);
  assert.ok(!existsSync(worktree), "the worktree path is gone");

  // --- 6. #1456: the seat-facing tool can fork from an UNLANDED base ref ---
  // The core already took `ref`; the gap was that `prepare_workspace` never passed one, so no entry
  // point could put a worktree on an unlanded tip — which is what blocked stacking (#1444).
  const seattools = await import("../src/seattools.mjs");
  const prepTool = seattools.SeatTools.tools.find((tool) => tool.name === "prepare_workspace");
  assert.ok(prepTool, "the prepare_workspace tool exists");
  assert.equal(
    prepTool.parameters?.properties?.base?.type, "string",
    "prepare_workspace declares an optional `base` ref parameter",
  );
  assert.equal(
    typeof seattools.prepareWorkspaceOptions, "function",
    "the tool's option builder is exported so a demo can assert the threading",
  );
  const threaded = seattools.prepareWorkspaceOptions({ itemId: 7, seatName: "impl", base: "unlanded", source: "S" });
  assert.equal(threaded.ref, "unlanded", "the base is threaded to the core as `ref`");
  assert.equal(threaded.itemId, 7, "itemId still threads through");
  assert.equal(threaded.seatName, "impl", "seatName still threads through");

  // ...and the core really does fork that ref (the guarantee the tool now exposes).
  const repo3 = join(base, "ref-repo");
  const source3 = join(repo3, "durig");
  await mkdir(source3, { recursive: true });
  await writeFile(join(source3, "artifact.txt"), "on main\n");
  await run("git", ["init", "-q", repo3]);
  await run("git", ["-C", repo3, "add", "durig/artifact.txt"]);
  await run("git", ["-C", repo3, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "main base"]);
  await run("git", ["-C", repo3, "branch", "-M", "main"]);
  await run("git", ["-C", repo3, "checkout", "-q", "-b", "unlanded"]);
  await writeFile(join(source3, "artifact.txt"), "on the unlanded tip\n");
  await run("git", ["-C", repo3, "add", "durig/artifact.txt"]);
  await run("git", ["-C", repo3, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "unlanded tip"]);
  const tip3 = (await run("git", ["-C", repo3, "rev-parse", "HEAD"])).stdout.trim();
  await run("git", ["-C", repo3, "checkout", "-q", "main"]);
  const atBase = await prepareSeatWorkspace({ source: source3, worktreeRoot: source3, itemId: 11, seatName: "impl", ref: "unlanded" });
  assert.equal(
    (await run("git", ["-C", atBase.worktree, "rev-parse", "HEAD"])).stdout.trim(), tip3,
    "the prepared worktree sits at the unlanded base ref, not HEAD",
  );
  assert.match(await readFile(join(atBase.cwd, "artifact.txt"), "utf8"), /unlanded/, "...with the unlanded content present");
  await removeSeatWorkspace({ worktreeRoot: source3, itemId: 11 });

  console.log("PREPARE-WORKSPACE PASS (idempotent per-item worktree; the seat's own cwd wins; npm ci path exercised)");
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
