// demo/branch-prune.test.mjs — the prune tool's gate, pinned against a real git fixture.
//
// WHY THIS EXISTS. `tools/branch-prune.mjs` is the verb that removes 120 branches in one pass. A pass whose
// first version deleted NOTHING and printed "branches deleted 0, failed 0, skipped 120, exit 0" is worse than
// a crash, because the next session reads it as a clean prune (SELFDEV pitfall 364: `spawnSync` returns
// `.status`, not `.code`, so `r.code !== 0` is true for every ref). This demo asserts the COUNTS and the
// exit code in both directions, so a silent no-op cannot pass.
//
// Run: node demo/branch-prune.test.mjs     (measured 2026-11-14, Linux, Fedora Linux 45 (Forty Five),
// kernel 7.2.15-300.fc45.x86_64, node v24.22.1, git 2.56.0 — 0.6 s; git + node only, no store, no model,
// no network)
//
// What it proves, in order:
//   1. a ref that IS an ancestor of main is deleted, its worktree removed, and main does NOT move
//   2. a ref that is NOT an ancestor is SKIPPED and the tool exits 1 — it never force-deletes
//   3. a snapshot/archive-named ref is kept even when the plan names it
//   4. a worktree whose removal is refused leaves its branch intact (no half-delete)
//   5. --dry-run deletes nothing
//   6. every deleted ref gets a `git branch <name> <sha>` recovery line in the log
//   7. the worktree reap releases a clean unlocked tree, refuses an unreachable one, leaves a dirty one,
//      and deletes NO ref (rule R-B #3270)
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prunePlan, reapWorktrees } from "../tools/branch-prune.mjs";

const TOOL = join(import.meta.dirname, "..", "tools", "branch-prune.mjs");
const repo = mkdtempSync(join(tmpdir(), "durig-branch-prune-"));
const git = (args) => spawnSync("git", args, { cwd: repo, encoding: "utf8", timeout: 20000 });
const branchExists = (name) => git(["rev-parse", "-q", "--verify", `refs/heads/${name}`]).status === 0;
const worktreeExists = (p) => git(["worktree", "list"]).stdout.includes(p);

function init() {
	git(["init", "-q", "-b", "main"]);
	writeFileSync(join(repo, "a.txt"), "base\n");
	git(["add", "a.txt"]);
	git(["-c", "user.email=test@example.invalid", "-c", "user.name=test", "commit", "-q", "-m", "main: base"]);
}

init();
const mainShaBefore = git(["rev-parse", "main"]).stdout;

/* 1. LANDED: a branch minted off main with no commits of its own — an ancestor, and nothing to lose. */
git(["branch", "item-100", "main"]);
git(["worktree", "add", "-q", ".wt-item-100", "item-100"]);

/* 2. NOT LANDED: one real commit ahead of main. `git branch -d` would refuse it; the gate refuses earlier. */
git(["branch", "item-101", "main"]);
git(["checkout", "-q", "item-101"]);
writeFileSync(join(repo, "work.txt"), "unlanded work\n");
git(["add", "work.txt"]);
git(["-c", "user.email=test@example.invalid", "-c", "user.name=test", "commit", "-q", "-m", "item-101: the work"]);
git(["checkout", "-q", "main"]);
git(["worktree", "add", "-q", ".wt-item-101", "item-101"]);

/* 3. A snapshot name that happens to be an ancestor — branch-cleanup step 4 says never prune it. */
git(["branch", "selfdev-snapshot-7", "main"]);

/* 4. Held by a LOCKED worktree: removal must refuse, and the branch must survive the refusal. */
git(["branch", "item-102", "main"]);
git(["worktree", "add", "-q", ".wt-item-102", "item-102"]);
git(["worktree", "lock", ".wt-item-102"]);

const plan = [
	{ ref: "item-100", worktree: join(repo, ".wt-item-100") },
	{ ref: "item-101", worktree: join(repo, ".wt-item-101") },
	{ ref: "selfdev-snapshot-7", worktree: null },
	{ ref: "item-102", worktree: join(repo, ".wt-item-102") },
];

/* 5. --dry-run first: nothing changes. */
const dry = prunePlan({ repo, plan, dryRun: true });
assert.equal(dry.planned, 4, "dry run sees the whole plan");
assert.ok(dry.log.some((l) => l.startsWith("DRY item-100")), "dry run reports the deletable ref");
assert.ok(branchExists("item-100") && worktreeExists(join(repo, ".wt-item-100")), "--dry-run deletes nothing");
assert.ok(branchExists("item-101"), "--dry-run deletes nothing");

/* 6. The real run. */
const logPath = join(repo, ".spike-prune-log.txt");
const run = prunePlan({ repo, plan, logPath });

assert.equal(run.branchesDeleted, 1, "exactly one branch was deleted — a silent no-op (the .code bug) fails here");
assert.equal(run.worktreesRemoved, 1, "its worktree was released first");
assert.equal(run.skipped, 2, "the unlanded ref and the snapshot name are skipped, with reasons");
assert.equal(run.worktreesFailed, 1, "the locked worktree refuses removal");
assert.equal(run.branchesFailed, 0, "a refused worktree does not become a failed branch delete");
assert.equal(run.ok, false, "a plan that the live gate cannot honour is NOT reported as a clean pass");

assert.ok(!branchExists("item-100"), "the ancestor ref is gone");
assert.ok(!worktreeExists(join(repo, ".wt-item-100")), "and its worktree is released");
assert.ok(branchExists("item-101"), "the unlanded ref survives — nothing is force-deleted");
assert.ok(worktreeExists(join(repo, ".wt-item-101")), "and its worktree is untouched");
assert.ok(branchExists("selfdev-snapshot-7"), "snapshot/archive names are never pruned");
assert.ok(branchExists("item-102") && worktreeExists(join(repo, ".wt-item-102")), "a locked tree is left whole");
assert.equal(git(["rev-parse", "main"]).stdout, mainShaBefore, "pruning refs never moves main");

/* 7. Recovery: the log carries the sha of every ref it removed. */
const log = readFileSync(logPath, "utf8");
assert.ok(/DELETED item-100 @ [0-9a-f]{12} — recover: git branch item-100 [0-9a-f]{40}/.test(log), "recovery line present");
assert.ok(/SKIP item-101: not an ancestor of main/.test(log), "the skip names its reason");

/* 8. Worktree reap: release the trees the rig's own audit calls `reapable`, without touching a ref.
   The audit payload is INJECTED, so the fixture pins the FILTER (reapable + unlocked + clean) and the
   refusal path with no store and no broker. */
git(["branch", "item-103", "main"]);
git(["worktree", "add", "-q", ".wt-reap", "item-103"]);
git(["branch", "item-104", "main"]);
git(["worktree", "add", "-q", ".wt-dirty", "item-104"]); // the audit calls it dirty -> never touched
const audit = JSON.stringify({
	ok: true,
	counts: { "seat-root": 0, live: 0, dirty: 1, locked: 1 },
	worktrees: [
		{ worktree: join(repo, ".wt-reap"), branch: "refs/heads/item-103", keepReason: "reapable", locked: false, uncommitted: 0 },
		{ worktree: join(repo, ".wt-dirty"), branch: "refs/heads/item-104", keepReason: "dirty", locked: false, uncommitted: 4 },
		{ worktree: join(repo, ".wt-missing"), branch: "refs/heads/item-103", keepReason: "reapable", locked: false, uncommitted: 0 },
	],
});
const reap = reapWorktrees({ repo, auditJson: audit });
assert.equal(reap.reapable, 2, "only reapable + unlocked + clean trees are candidates");
assert.equal(reap.removed, 1, "the clean tree is released");
assert.equal(reap.refused, 1, "a path git cannot remove is REFUSED, never forced");
assert.equal(reap.ok, false, "a refusal is reported as a failure, not as a clean pass");
assert.ok(!worktreeExists(join(repo, ".wt-reap")), "the reaped tree is gone");
assert.ok(worktreeExists(join(repo, ".wt-dirty")), "the dirty tree is left for its owner");
assert.ok(branchExists("item-103"), "reaping a worktree never deletes the ref (rule R-B #3270)");
assert.equal(git(["rev-parse", "main"]).stdout, mainShaBefore, "reaping never moves main");

/* 9. CLI exit code: the same verdict the runbook gates on. */
writeFileSync(join(repo, "plan.json"), JSON.stringify({ plan: [{ ref: "item-101", worktree: join(repo, ".wt-item-101") }] }));
const cli2 = spawnSync("node", [TOOL, "--repo", repo, "--plan", join(repo, "plan.json"), "--log", join(repo, "cli-log.txt")], {
	encoding: "utf8",
	timeout: 60000,
});
assert.equal(cli2.status, 1, "exit 1 when a planned ref cannot be pruned — never a silent 0");
assert.ok(/planned 1; branches deleted 0, worktrees removed 0; skipped 1/.test(cli2.stdout), "the printed counts state the no-op");

rmSync(repo, { recursive: true, force: true });
console.log("PASS branch-prune: ancestor deleted, unlanded kept, snapshot kept, locked held, main unmoved, exit 1 on a plan the gate cannot honour; reap released 1 clean tree, refused 1, left the dirty tree, deleted no ref");
