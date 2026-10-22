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
// and one with a BRANCH CHECKED OUT is a live seat's workspace (durian-pi puts every item worktree
// ON its item branch, #859) whose removal made the seat's tools fall back to the SHARED tree
// (2026-10-17: #1186, #1196). The sweep reports and KEEPS both (`worktree-orphan-kept`).
//
// #1244 REFINED it so the sweep is a real backstop again: a BRANCH-HELD worktree is reaped when
// the branch ENCODES a queue item whose status is TERMINAL, the worktree is UNLOCKED, and it is
// CLEAN. Terminal-ness is ANDed with the #1194 liveness/cleanliness checks — a non-terminal or
// unresolvable id is KEPT. This demo covers both the detached and the branch-held cases.
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

	// #1244: branch-held worktrees. The BRANCH encodes the item id (`item-<N>`; legacy
// `<seat>-item-<N>` is accepted by the same regex); the sweep
	// reaps one ONLY when the branch's item is TERMINAL, the worktree is unlocked and clean.
	await git(repo, "worktree", "add", "-q", "-b", "impl-item-4", wt(4)); // terminal + clean -> reaped
	await git(repo, "worktree", "add", "-q", "-b", "impl-item-5", wt(5)); // LIVE -> kept
	await git(repo, "worktree", "add", "-q", "-b", "impl-item-6", wt(6)); // unknown/non-terminal -> kept
	await git(repo, "worktree", "add", "-q", "-b", "impl-item-7", wt(7)); // terminal but dirty -> kept + notice
	writeFileSync(join(wt(7), "shared.txt"), "uncommitted work\n");
	await git(repo, "worktree", "add", "-q", "-b", "weird-branch", wt(8)); // branch unresolved -> kept

	// The guard refuses a dirty worktree unless the caller forces it (D60).
	{
		const refused = await removeClaimedWorktree({ worktree: wt(3) });
		assert.equal(refused.removed, false, "a dirty worktree is not removed without force");
		assert.equal(refused.refused, "dirty", "the refusal names the dirty reason");
		assert.ok(existsSync(wt(3)), "the dirty worktree is left in place");
	}

	// The sweep removes only TERMINAL, unlocked, CLEAN orphans (#1244), keeps everything else.
	const kept = [];
	const removed = await reconcileOrphanedWorktrees({
		repoPath: repo,
		liveItemIds: new Set([1, 5]),
		terminalItemIds: new Set([2, 3, 4, 7, 8]),
		onDiagnostic: (d) => kept.push(d),
	});
	assert.deepEqual(removed, [2, 4], "only the terminal, unlocked, clean orphans are removed");
	assert.ok(existsSync(wt(1)), "a live item's worktree is kept");
	assert.ok(!existsSync(wt(2)), "the clean detached orphan is gone");
	assert.ok(existsSync(wt(3)), "the dirty detached orphan is kept");
	assert.ok(!existsSync(wt(4)), "#1244: a TERMINAL branch-held, unlocked, clean worktree is reaped");
	assert.ok(existsSync(wt(5)), "a LIVE branch-held worktree is kept");
	assert.ok(existsSync(wt(6)), "a branch-held worktree whose item is NOT terminal is kept");
	assert.ok(existsSync(wt(7)), "a terminal branch-held worktree with uncommitted work is kept");
	assert.ok(existsSync(wt(8)), "a branch-held worktree whose branch does not resolve an id is kept");
	assert.ok(
		kept.some((d) => d.kind === "worktree-orphan-kept" && d.itemId === 3 && d.reason === "dirty"),
		"the dirty detached orphan is reported, not silently skipped",
	);
	assert.ok(
		kept.some((d) => d.itemId === 5 && d.reason === "live"),
		"a live branch-held worktree is reported as live",
	);
	assert.ok(
		kept.some((d) => d.itemId === 6 && d.reason === "not-terminal"),
		"a non-terminal branch-held worktree is reported as not-terminal",
	);
	assert.ok(
		kept.some((d) => d.itemId === 7 && d.reason === "dirty"),
		"a dirty terminal branch-held worktree is reported as dirty",
	);
	assert.ok(
		kept.some((d) => d.itemId === 8 && d.reason === "branch-unresolved"),
		"an unresolvable branch is reported, not reaped",
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
