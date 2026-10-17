// demo/broker-worktree-sweep.test.mjs — orphaned worktree reconciliation (ROADMAP 73).
//
// The leak: a crash before an item's cleanup (or the recorded recursive-nesting
// defect) leaves `item-*` worktrees behind that pollute `git status`. The sweep
// removes the orphans whose queue item is no longer live — but ONLY when the worktree
// holds no uncommitted work. The removal path uses `rm -rf` once git refuses a dirty
// tree, so `removeClaimedWorktree` now refuses a dirty worktree unless the caller
// passes `force` (D60: never discard a seat's work). A dirty orphan is reported and
// kept.
//
// #1194 NARROWED what counts as an orphan. A worktree that is LOCKED is held deliberately,
// and one with a BRANCH CHECKED OUT is a live seat's workspace (durig puts every item worktree
// ON its item branch, #859) whose removal made the seat's tools fall back to the SHARED tree
// (2026-10-17: #1186, #1196). The sweep now reports and KEEPS both (`worktree-orphan-kept`).
// So the genuinely reapable orphan here is DETACHED and unlocked; the locked/branch-held keep
// is covered end-to-end by demo/worktree-sweep.test.mjs.
//
// Failing-first: HEAD's `removeClaimedWorktree` ignored uncommitted work and would
// have removed the dirty orphan; `reconcileOrphanedWorktrees` did not exist.
// Run: node demo/broker-worktree-sweep.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { reconcileOrphanedWorktrees } from "../src/broker.mjs";
import { removeClaimedWorktree } from "../src/worktree.mjs";

const run = promisify(execFile);
const git = (cwd, ...args) => run("git", ["-C", cwd, ...args]);

const base = mkdtempSync(join(tmpdir(), "durig-sweep-"));
const repo = join(base, "repo");
const wt = (id) => join(repo, `item-${id}`);

try {
	writeFileSync(join(base, "keep"), ""); // ensure base exists before the repo
	mkdirSync(repo, { recursive: true });
	writeFileSync(join(repo, "shared.txt"), "base\n");
	await git(repo, "init", "-q");
	await git(repo, "add", "shared.txt");
	await git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");

	// item-1 is live (claimed); item-2 is a clean orphan; item-3 is a dirty orphan.
	// #1194: only a DETACHED, unlocked worktree is reapable now — a branch-checked-out one is kept.
	await git(repo, "worktree", "add", "-q", "-b", "item1", wt(1));
	await git(repo, "worktree", "add", "-q", "--detach", wt(2));
	await git(repo, "worktree", "add", "-q", "--detach", wt(3));
	writeFileSync(join(wt(3), "shared.txt"), "uncommitted work\n");

	// The guard refuses a dirty worktree unless the caller forces it (D60).
	{
		const refused = await removeClaimedWorktree({ worktree: wt(3) });
		assert.equal(refused.removed, false, "a dirty worktree is not removed without force");
		assert.equal(refused.refused, "dirty", "the refusal names the dirty reason");
		assert.ok(existsSync(wt(3)), "the dirty worktree is left in place");
	}

	// The sweep removes the clean orphan, keeps the live item and the dirty orphan.
	const kept = [];
	const removed = await reconcileOrphanedWorktrees({
		repoPath: repo,
		liveItemIds: new Set([1]),
		onDiagnostic: (d) => kept.push(d),
	});
	assert.deepEqual(removed, [2], "only the clean orphan is removed");
	assert.ok(existsSync(wt(1)), "a live item's worktree is kept");
	assert.ok(!existsSync(wt(2)), "the clean orphan is gone");
	assert.ok(existsSync(wt(3)), "the dirty orphan is kept");
	assert.ok(
		kept.some((d) => d.kind === "worktree-orphan-kept" && d.itemId === 3 && d.reason === "dirty"),
		"the dirty orphan is reported, not silently skipped",
	);

	// `force` is the caller explicitly accepting the loss.
	{
		const forced = await removeClaimedWorktree({ worktree: wt(3), force: true });
		assert.equal(forced.removed, true, "force removes the dirty worktree");
		assert.ok(!existsSync(wt(3)), "the forced worktree is gone");
	}

	console.log(
		"BROKER WORKTREE SWEEP PASS (clean orphaned worktrees are removed; live and dirty ones are kept, the dirty one reported; force is explicit)",
	);
} finally {
	try {
		rmSync(base, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}
process.exit(0);
