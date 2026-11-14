// demo/branch-prune.test.mjs — the prune tool's gate, pinned against a real git fixture.
//
// WHY THIS EXISTS. `tools/branch-prune.mjs` is the verb that removes 120 branches in one pass. A pass whose
// first version deleted NOTHING and printed "branches deleted 0, failed 0, skipped 120, exit 0" is worse than
// a crash, because the next session reads it as a clean prune (SELFDEV pitfall 364: `spawnSync` returns
// `.status`, not `.code`, so `r.code !== 0` is true for every ref). This demo asserts the COUNTS and the
// exit code in both directions, so a silent no-op cannot pass.
//
// Run: node demo/branch-prune.test.mjs     (measured 2026-11-14, Linux, Fedora Linux 45 (Forty Five),
// kernel 7.2.15-300.fc45.x86_64, node v24.22.1, git 2.56.0 — 0.5 s, 14 assertions groups; git + node only,
// no store, no model, no network)
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
//   10. --retire-merged plans a merged ref even when a stale ledger row names it as KEEP
//   11. an unmerged ref is deleted only after a thin bundle of it verifies; without --bundle-dir it is skipped
//   12. --unlock-locked + --quarantine releases a locked tree, preserving its residue, without --force
//   13. residue-only trees are released; a tree with a tracked modification or an unrecognised file is kept whole
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prunePlan, reapWorktrees, buildRetirePlan } from "../tools/branch-prune.mjs";

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
assert.equal(run.skipped, 3, "the unlanded ref, the snapshot name and the locked tree are each skipped, with reasons");
assert.equal(run.worktreesFailed, 0, "a locked tree is refused BEFORE anything is touched, so it is not a failed removal");
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

/* 10. --retire-merged: a merged ref is retired even when a STALE ledger KEEP row names it.
   The plan builder reads live git ancestry, not docs/DISPOSITIONS.md, so a row written before the landing
   cannot hold a ref whose tip is provably in main. */
git(["branch", "item-105", "main"]); // merged: zero commits of its own
const built = buildRetirePlan({ repo, activeWithinDays: 7, structuralRefs: new Set(["refs/heads/item-101"]) });
assert.ok(built.plan.some((p) => p.ref === "item-105" && p.merged), "a merged ref is planned regardless of any ledger row");
assert.ok(!built.plan.some((p) => p.ref === "item-101"), "a structural ref is never planned, even when unmerged");
assert.ok(built.excluded.structural >= 1, "the exclusion count is reported, not silent");

/* 11. An UNMERGED ref is deletable only through a verified bundle; without --bundle-dir it is skipped. */
git(["branch", "chain-snap-1", "main"]);
git(["checkout", "-q", "chain-snap-1"]);
writeFileSync(join(repo, "chain.txt"), "chain snapshot content\n");
git(["add", "chain.txt"]);
git(["-c", "user.email=test@example.invalid", "-c", "user.name=test", "commit", "-q", "-m", "chain: content not on main"]);
git(["checkout", "-q", "main"]);
const chainPlan = [{ ref: "chain-snap-1", worktree: null }];
const noBundle = prunePlan({ repo, plan: chainPlan });
assert.equal(noBundle.skipped, 1, "an unmerged ref with no bundle is skipped — its commits exist nowhere else");
assert.ok(branchExists("chain-snap-1"), "and it survives");
const bundleDir = join(repo, "bundles");
const bundled = prunePlan({ repo, plan: chainPlan, bundleDir });
assert.equal(bundled.branchesDeleted, 1, "with a verified bundle the ref is retired");
assert.ok(!branchExists("chain-snap-1"), "the ref is gone");
assert.ok(readFileSync(join(bundleDir, "chain-snap-1.bundle"), "utf8").includes("refs/heads/chain-snap-1"), "the bundle was written and names the ref it carries");
assert.ok(readFileSync(join(bundleDir, "chain-snap-1.sha"), "utf8").trim().length === 40, "the tip sha is recorded for the recovery command");
const verify = git(["bundle", "verify", join(bundleDir, "chain-snap-1.bundle")]);
assert.equal(verify.status, 0, "the bundle verifies — recovery is real, not asserted");
assert.ok(/recover: git fetch .*chain-snap-1\.bundle/.test(bundled.log.join("\n")), "the log names the bundle as the recovery path");
assert.equal(git(["rev-parse", "main"]).stdout, mainShaBefore, "retiring refs never moves main");

/* 12. --unlock-locked + --quarantine: a locked, dirty tree whose ref is merged is released, with its
   uncommitted residue copied out first. Without those flags the same tree is refused. */
git(["branch", "item-106", "main"]);
git(["worktree", "add", "-q", ".wt-locked-dirty", "item-106"]);
writeFileSync(join(repo, ".wt-locked-dirty", "scratch.log"), "probe output\n");
git(["worktree", "lock", ".wt-locked-dirty"]);
const guarded = prunePlan({ repo, plan: [{ ref: "item-106", worktree: join(repo, ".wt-locked-dirty") }] });
assert.equal(guarded.skipped, 1, "a locked tree is refused before its residue is cleaned — cleaning first would destroy the residue the refusal is meant to protect");
assert.ok(readFileSync(join(repo, ".wt-locked-dirty", "scratch.log"), "utf8") === "probe output\n", "the refused tree still holds its residue, unquarantined and uncleaned");
assert.ok(branchExists("item-106") && worktreeExists(join(repo, ".wt-locked-dirty")), "nothing is half-deleted");
const quarantine = join(repo, "quarantine");
const released = prunePlan({ repo, plan: [{ ref: "item-106", worktree: join(repo, ".wt-locked-dirty") }], unlockLocked: true, quarantineDir: quarantine });
assert.equal(released.worktreesRemoved, 1, "unlock + quarantine lets the tree go without --force");
assert.equal(released.branchesDeleted, 1, "and the merged ref is retired with -d");
assert.ok(readFileSync(join(quarantine, ".wt-locked-dirty", "scratch.log"), "utf8") === "probe output\n", "the residue is preserved before the tree is released");

/* 13. RESIDUE vs WORK. A seat's tree can be dirty for two reasons: probe residue, or work that never
   landed. The tool releases only the first, and only after copying it out — `git worktree remove` without
   --force is the last line of defence, so the residue must be cleaned before the call, not forced past it. */
git(["branch", "item-107", "main"]);
git(["worktree", "add", "-q", ".wt-residue", "item-107"]);
writeFileSync(join(repo, ".wt-residue", "run.log"), "probe output\n");
git(["branch", "item-108", "main"]);
git(["worktree", "add", "-q", ".wt-work", "item-108"]);
mkdirSync(join(repo, ".wt-work", "src"), { recursive: true });
writeFileSync(join(repo, ".wt-work", "src", "feature.mjs"), "real work\n");
const q13 = join(repo, "quarantine13");
const mixed = prunePlan({ repo, plan: [{ ref: "item-107", worktree: join(repo, ".wt-residue") }, { ref: "item-108", worktree: join(repo, ".wt-work") }], quarantineDir: q13 });
assert.equal(mixed.worktreesRemoved, 1, "the residue-only tree is released without --force");
assert.ok(!branchExists("item-107"), "and its merged ref is retired");
assert.ok(readFileSync(join(q13, ".wt-residue", "run.log"), "utf8") === "probe output\n", "the residue is archived before it is deleted");
assert.equal(mixed.skipped, 1, "the tree with uncommitted work is skipped, with a reason");
assert.ok(branchExists("item-108") && worktreeExists(join(repo, ".wt-work")), "a seat's uncommitted work is never discarded");
assert.ok(mixed.log.some((l) => l.includes("holds uncommitted WORK")), "the skip names the work it found");
const built13 = buildRetirePlan({ repo, activeWithinDays: null, structuralRefs: new Set() });
assert.ok(!built13.plan.some((p) => p.ref === "item-108"), "buildRetirePlan excludes a ref whose tree holds work before it ever reaches the gate");
assert.ok(built13.excluded.uncommittedWork >= 1, "the exclusion is counted, not silent");

/* 14. An UNMERGED ref is planned only when the pass NAMES it (rule R-B #3270: refs are dispositioned,
   never deleted), and the recency guard outranks the name. A ref name containing a slash must not break
   the bundle path. */
const commit = (msg, env = {}) => spawnSync("git", ["-c", "user.email=test@example.invalid", "-c", "user.name=test", "commit", "-q", "-m", msg], { cwd: repo, encoding: "utf8", env: { ...process.env, ...env } });
git(["branch", "chain/keep-me", "main"]); git(["checkout", "-q", "chain/keep-me"]); writeFileSync(join(repo, "keep-me.txt"), "diverged work\n"); git(["add", "keep-me.txt"]); commit("chain/keep-me: work that conflicts with main"); git(["checkout", "-q", "main"]);
git(["branch", "chain/retire-me", "main"]); git(["checkout", "-q", "chain/retire-me"]); writeFileSync(join(repo, "retire-me.txt"), "snapshot content\n"); git(["add", "retire-me.txt"]); commit("chain/retire-me: a snapshot the verdict already records"); git(["checkout", "-q", "main"]);
const unnamed = buildRetirePlan({ repo, activeWithinDays: null, structuralRefs: new Set() });
assert.ok(!unnamed.plan.some((p) => p.ref.startsWith("chain/")), "unmerged refs are never planned unless the pass names them");
assert.ok(unnamed.excluded.unmergedNotNamed >= 2, "the excluded refs are counted, not silently dropped");
const named = buildRetirePlan({ repo, activeWithinDays: null, structuralRefs: new Set(), retireUnmerged: "^chain/retire" });
assert.ok(named.plan.some((p) => p.ref === "chain/retire-me" && p.bundle), "the named unmerged ref is planned for bundled retirement");
assert.ok(!named.plan.some((p) => p.ref === "chain/keep-me"), "the regex is an allowlist, not a wildcard");
const recencyGuard = buildRetirePlan({ repo, activeWithinDays: 7, structuralRefs: new Set(), retireUnmerged: "^chain/retire" });
assert.ok(!recencyGuard.plan.some((p) => p.ref === "chain/retire-me"), "--active-within overrides the allowlist: a tip younger than the window is live work");
assert.ok(recencyGuard.excluded.activeWithin >= 1, "the guard reports what it protected");
const bundles14 = join(repo, "bundles14");
const r14 = prunePlan({ repo, plan: [{ ref: "chain/retire-me", worktree: null }], bundleDir: bundles14 });
assert.equal(r14.branchesDeleted, 1, "a ref whose name contains a slash is retired through a sanitised bundle");
assert.ok(existsSync(join(bundles14, "chain_retire-me.bundle")), "the bundle file name has no slash in it");
assert.equal(git(["bundle", "verify", join(bundles14, "chain_retire-me.bundle")]).status, 0, "the sanitised bundle verifies");
assert.ok(branchExists("chain/keep-me"), "the unnamed conflicted ref survives the pass");
assert.equal(git(["rev-parse", "main"]).stdout, mainShaBefore, "the pass never moves main");

rmSync(repo, { recursive: true, force: true });
console.log("PASS branch-prune: ancestor deleted, unlanded kept, snapshot kept, locked held, main unmoved, exit 1 on a plan the gate cannot honour; reap released 1 clean tree, refused 1, left the dirty tree, deleted no ref; --retire-merged plans a merged ref past a stale ledger row; an unmerged ref is deleted only through a verified bundle; --unlock-locked + --quarantine released a locked tree with its residue preserved; residue-only trees are released and trees holding uncommitted work are kept whole");
