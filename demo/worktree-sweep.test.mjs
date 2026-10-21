// demo/worktree-sweep.test.mjs — #1194: the broker's orphaned-worktree sweep must NEVER reap a
// LIVE seat worktree.
//
// The incident it fixes: when impl finished #1109 the `item-1109` worktree was GONE, so the tool
// layer fell back to the seat root and the next `git switch -c` ran in the SHARED tree — switching
// it off `main` (#1186). The same cause put a commit straight on `main` (#1196). The sweep reaped a
// worktree that was LOCKED and had a BRANCH CHECKED OUT (its item's unlanded commits on it),
// because (a) `listWorktrees` threw the `locked` flag away and (b) the sweep keyed only on the
// item's status.
//
// FAILING-FIRST: `listWorktrees` reports `locked: false` for a locked worktree, and
// `reconcileOrphanedWorktrees` reaps the locked and branch-held worktrees (RED).
//
// #1244 REFINED it: a branch-held worktree is now reaped ONLY when its item is TERMINAL,
// unlocked and clean. A LIVE item's branch-held worktree still SURVIVES (this demo's case);
// the terminal+unlocked+clean reap is covered by demo/broker-worktree-sweep.test.mjs.
//
// Run: node demo/worktree-sweep.test.mjs   (exit 0 = pass)

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";

import { listWorktrees } from "../src/worktree.mjs";
import { reconcileOrphanedWorktrees } from "../src/broker.mjs";
import { authorEnv } from "../src/confine.mjs";

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

function git(cwd, argv) {
  const r = spawnSync("git", argv, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${argv.join(" ")} failed: ${r.stderr || r.stdout}`);
  return (r.stdout ?? "").trim();
}

const norm = (p) => String(p).replace(/\\/g, "/");
const reasonOf = (res) => String(res?.error?.message ?? "");

const tmp = mkdtempSync(join(tmpdir(), "durig-sweep-"));
const repo = join(tmp, "repo");

try {
  console.log("\n=== #1194: the orphan sweep must not reap a live worktree ===\n");

  mkdirSync(repo, { recursive: true });
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "t@example.com"]);
  git(repo, ["config", "user.name", "Test"]);
  writeFileSync(join(repo, "a.txt"), "base\n");
  git(repo, ["add", "a.txt"]);
  git(repo, ["commit", "-m", "base"]);
  git(repo, ["branch", "-M", "main"]);

  // item-1: a DEAD item, detached and unlocked — a genuine orphan the sweep should still reap.
  const dead = join(repo, "item-1");
  git(repo, ["worktree", "add", "--detach", dead, "HEAD"]);
  // item-2: LOCKED — held deliberately; git refuses to remove it without an unlock.
  const locked = join(repo, "item-2");
  git(repo, ["worktree", "add", "--detach", locked, "HEAD"]);
  git(repo, ["worktree", "lock", locked]);
  // item-3: on a BRANCH (how every durian-pi item worktree is created, #859) — it carries that
  // branch's unlanded commits.
  const branched = join(repo, "item-3");
  git(repo, ["worktree", "add", "-b", "impl-item-3", branched, "HEAD"]);

  const listedNow = await listWorktrees(repo);
  const byName = (n) => listedNow.find((w) => norm(w.worktree).endsWith(`/${n}`));

  console.log("1. listWorktrees reports the lock and branch state honestly");
  check("a LOCKED worktree is reported locked", byName("item-2")?.locked === true, JSON.stringify(byName("item-2")));
  check("an unlocked worktree is reported unlocked", byName("item-1")?.locked === false, JSON.stringify(byName("item-1")));
  check(
    "a branch-checked-out worktree reports its branch",
    /impl-item-3$/.test(String(byName("item-3")?.branch ?? "")),
    JSON.stringify(byName("item-3")),
  );

  console.log("\n2. the sweep reaps only the genuine orphan");
  const diagnostics = [];
  const removed = await reconcileOrphanedWorktrees({
    repoPath: repo,
    // #1244: item-3 is a LIVE item (non-terminal) — the #1194 safety keeps its branch-held
    // worktree. item-1 is terminal, so its dead detached worktree is reapable.
    liveItemIds: new Set([3]),
    terminalItemIds: new Set([1]),
    onDiagnostic: (d) => diagnostics.push(d),
  });
  check("the dead, detached, unlocked worktree IS reaped (the sweep still works)", removed.includes(1) && !existsSync(dead), JSON.stringify({ removed, exists: existsSync(dead) }));
  check("the LOCKED worktree SURVIVES", existsSync(locked), locked);
  check("the BRANCH-HELD worktree of a LIVE item SURVIVES", existsSync(branched), branched);

  const after = await listWorktrees(repo);
  const stillListed = (p) => after.some((w) => norm(w.worktree) === norm(p));
  check("...and the locked one is still registered", stillListed(locked));
  check("...and the branch-held one is still registered", stillListed(branched));
  check("...and the locked one is STILL locked", after.find((w) => norm(w.worktree) === norm(locked))?.locked === true);
  check("...and the branch-held one is STILL on its branch", /impl-item-3$/.test(String(after.find((w) => norm(w.worktree) === norm(branched))?.branch ?? "")));
  check(
    "the sweep reported WHY it kept them",
    diagnostics.some((d) => d.reason === "locked") && diagnostics.some((d) => d.reason === "live"),
    JSON.stringify(diagnostics),
  );

  console.log("\n3. a LIVE item's worktree is skipped (the pre-existing rule still holds)");
  const live = join(repo, "item-4");
  git(repo, ["worktree", "add", "--detach", live, "HEAD"]);
  const removedLive = await reconcileOrphanedWorktrees({ repoPath: repo, liveItemIds: new Set([4]), onDiagnostic: () => {} });
  check("a live item's worktree is not reaped", existsSync(live) && !removedLive.includes(4), JSON.stringify({ removedLive, exists: existsSync(live) }));

  console.log("\n4. after the sweep, the seat's tools still resolve to its worktree");
  // The point of keeping it. If the sweep had reaped it, the seat's cwd would dangle and its tools
  // would fall back to the SHARED checkout (the #1186/#1196 flip) — which is exactly the state
  // #1151's `DURIAN_PI_EXPECT_WORKTREE` guard exists to catch, and which its own demo covers. What
  // THIS demo proves is the cause-side half: the worktree is still there to work in.
  const seatEnv = authorEnv(new NodeExecutionEnv({ cwd: branched }), branched, { expectWorktree: true });
  const seatWrite = await seatEnv.writeFile(join(branched, "seat-work.txt"), "x\n", BACKGROUND_CONTEXT);
  check("the seat can still WRITE inside its surviving worktree", seatWrite.ok === true, JSON.stringify(seatWrite));
  check("...so its tools never had to fall back to the shared checkout", existsSync(branched) && !/SHARED checkout/.test(reasonOf(seatWrite)));

  console.log(
    failures === 0
      ? "\nPASS - the sweep reaps only a genuine orphan; a locked or branch-held worktree survives, so the seat keeps its root"
      : `\nFAIL - ${failures} check(s) failed`,
  );
} catch (err) {
  console.error("ERROR:", err?.stack ?? err);
  failures += 1;
} finally {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {}
}

process.exit(failures === 0 ? 0 : 1);
