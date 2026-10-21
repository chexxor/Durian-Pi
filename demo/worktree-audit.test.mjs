// demo/worktree-audit.test.mjs — the worktree audit surface + the teardown leak fix (ROADMAP 76 / #1881).
//
// Failing-first: before `auditWorktrees`/`classifyWorktrees` exist this dies with
// ERR_MODULE_NOT_FOUND. After, it proves:
//   (1) the AUDIT classifies every worktree by the sweep's own rule — queue status, uncommitted
//       count, lock state, keep-reason — so a leaked/dirty tree is visible without guessing;
//   (2) a DIRTY terminal worktree is classified `dirty` with the CORRECT uncommitted count and is
//       NOT reclaimed (the clean gate is load-bearing);
//   (3) LEAK SOURCE A: a refused teardown RELEASES the lock, so the tree no longer hides behind a
//       lock and the sweep can reap it once it is clean.
//
// Run: node demo/worktree-audit.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { auditWorktrees, classifyWorktrees, reconcileOrphanedWorktrees } from "../src/broker.mjs";
import { listWorktrees, removeSeatWorkspace } from "../src/worktree.mjs";

const run = promisify(execFile);
const git = (cwd, ...args) => run("git", ["-C", cwd, ...args]);

const base = mkdtempSync(join(tmpdir(), "durig-wtaudit-"));
const repo = join(base, "repo");
const wt = (id) => join(repo, `item-${id}`);

try {
	mkdirSync(repo, { recursive: true });
	writeFileSync(join(repo, "shared.txt"), "base\n");
	await git(repo, "init", "-q");
	await git(repo, "add", "shared.txt");
	await git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");

	// item-1 live (claimed); item-2 terminal clean (reapable); item-3 terminal DIRTY.
	await git(repo, "worktree", "add", "-q", "-b", "impl-item-1", wt(1));
	await git(repo, "worktree", "add", "-q", "--detach", wt(2));
	await git(repo, "worktree", "add", "-q", "--detach", wt(3));
	writeFileSync(join(wt(3), "shared.txt"), "uncommitted work\n");
	await git(repo, "worktree", "add", "-q", "-b", "impl-item-4", wt(4)); // terminal clean -> reapable
	await git(repo, "worktree", "add", "-q", "-b", "impl-item-5", wt(5)); // live -> kept
	await git(repo, "worktree", "add", "-q", "-b", "impl-item-6", wt(6)); // non-terminal -> kept
	await git(repo, "worktree", "add", "-q", "-b", "impl-item-7", wt(7)); // terminal DIRTY + LOCKED
	writeFileSync(join(wt(7), "shared.txt"), "uncommitted work\n");
	await git(repo, "worktree", "lock", wt(7));
	await git(repo, "worktree", "add", "-q", "-b", "weird-branch", wt(8)); // branch unresolved -> kept
	await git(repo, "worktree", "add", "-q", "-b", "impl-item-9", wt(9)); // terminal clean + LOCKED -> kept
	await git(repo, "worktree", "lock", wt(9));
	await git(repo, "worktree", "add", "-q", "-b", "impl-item-10", wt(10)); // terminal clean, but a SEAT ROOT -> kept

	const liveItemIds = new Set([1, 5]);
	const terminalItemIds = new Set([2, 3, 4, 7, 9, 10]);
	const statusById = new Map([
		[1, "claimed"],
		[2, "done"],
		[3, "done"],
		[4, "done"],
		[5, "claimed"],
		[6, "queued"],
		[7, "done"],
		[9, "done"],
		[10, "done"],
	]);

	// (1) The AUDIT: one entry per worktree, classified by the sweep's rule.
	const entries = await auditWorktrees({ repoPath: repo, liveItemIds, terminalItemIds, statusById, seatRoots: [wt(10)] });
	const byId = new Map(entries.filter((e) => e.itemId != null).map((e) => [e.itemId, e]));
	assert.ok(byId.has(1) && byId.has(10), `the audit lists the item worktrees; got ${[...byId.keys()]}`);
	assert.equal(byId.get(1).keepReason, "live", "a claimed item's worktree is live");
	assert.equal(byId.get(1).status, "claimed", "the audit carries the queue status");
	assert.equal(byId.get(2).keepReason, "reapable", "a terminal, unlocked, clean worktree is reapable");
	assert.equal(byId.get(5).keepReason, "live", "a live branch-held worktree is live");
	assert.equal(byId.get(6).keepReason, "not-terminal", "a non-terminal item's worktree is kept");
	assert.equal(byId.get(8).keepReason, "branch-unresolved", "an unresolvable branch is kept");
	assert.equal(byId.get(9).keepReason, "locked", "a locked terminal worktree is kept (lock held deliberately)");
	assert.equal(byId.get(10).keepReason, "seat-root", "a worktree that is a seat's cwd is in use");

	// (2) A DIRTY terminal worktree: classified `dirty`, with the CORRECT uncommitted count, and
	// NOT reclaimed — the clean gate is load-bearing.
	assert.equal(byId.get(3).keepReason, "dirty", "a terminal worktree with uncommitted work is dirty");
	assert.equal(byId.get(3).uncommitted, 1, "the audit reports the exact uncommitted path count");
	assert.equal(byId.get(7).keepReason, "locked", "a LOCKED worktree is kept by the lock, whatever its dirt");
	assert.equal(byId.get(7).uncommitted, 1, "the audit still reports the uncommitted count under the lock");
	assert.equal(byId.get(7).locked, true, "the audit reports the lock state");

	const removed = await reconcileOrphanedWorktrees({ repoPath: repo, liveItemIds, terminalItemIds, seatRoots: [wt(10)] });
	assert.deepEqual(removed.sort((a, b) => a - b), [2, 4], "only the terminal, unlocked, CLEAN trees are reaped");
	assert.ok(!existsSync(wt(2)) && !existsSync(wt(4)), "the clean orphans are gone");
	assert.ok(existsSync(wt(3)), "the DIRTY terminal worktree is NOT reclaimed");
	assert.ok(existsSync(wt(7)), "the dirty+locked worktree is NOT reclaimed");

	// (3) LEAK SOURCE A: a refused teardown RELEASES the lock (never discards the work), so the
	// tree stops hiding behind a lock and the sweep can reap it once it is clean.
	const before = (await listWorktrees(repo)).find((w) => /item-7$/.test(w.worktree));
	assert.equal(before.locked, true, "item-7 starts LOCKED");
	const teardown = await removeSeatWorkspace({ worktreeRoot: repo, itemId: 7, releaseIfRefused: true });
	assert.equal(teardown.removed, false, "a dirty teardown does not remove the tree");
	assert.equal(teardown.refused, "dirty", "the refusal names the dirty reason");
	assert.equal(teardown.released, true, "the refused teardown RELEASED the lock");
	assert.ok(existsSync(wt(7)), "the uncommitted work is preserved");
	const after = (await listWorktrees(repo)).find((w) => /item-7$/.test(w.worktree));
	assert.equal(after.locked, false, "the worktree is now UNLOCKED (the leak fix)");

	// And once it is clean, the sweep reaps it — the lock no longer blocks reclamation.
	await git(wt(7), "checkout", "--", "shared.txt");
	const removed2 = await reconcileOrphanedWorktrees({ repoPath: repo, liveItemIds, terminalItemIds, seatRoots: [wt(10)] });
	assert.ok(removed2.includes(7), "after cleanup the previously-leaked worktree is reaped");
	assert.ok(!existsSync(wt(7)), "the reaped worktree is gone");

	console.log(
		"WORKTREE AUDIT PASS (every tree classified by status/uncommitted/lock/keep-reason; dirty trees kept with the right count; a refused teardown releases the lock so the sweep can reap it)",
	);
} finally {
	try {
		rmSync(base, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}
process.exit(0);
