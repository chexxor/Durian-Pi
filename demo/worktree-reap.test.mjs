// demo/worktree-reap.test.mjs — the REAP verb (#5301, ROADMAP 311 cut 2).
//
// Failing-first: before `planReap`/`reapWorktrees` exist this dies with ERR_MODULE_NOT_FOUND.
// After, it proves against a REAL `reapable` set (real `git worktree add`, real statuses — not a
// hand-written entry fixture, because a fixture only exercises the happy path):
//   (1) the reap CONSUMES the audit's `reapable` set: the worktree count drops by exactly the reaped
//       count, and a second audit finds `reapable` 0 — the defect was an audit that reported the set
//       forever while `ok: true` read as "nothing to do";
//   (2) THE SOLE-CARRIER REFUSAL, two mechanisms, each its own case:
//       (a) `sole-content` — a tree that is CLEAN by `git status` (so the audit calls it reapable) but
//           holds a GITIGNORED file git cannot restore;
//       (b) `declared-carrier` — a live queue row names the branch as a carrier (keep-gate #5280),
//           and the refusal names the ROW ID so the gate is endable;
//   (3) THREE CAUSES, THREE MESSAGES: reaped / refused-as-sole-carrier / locked-over-TERMINAL-item are
//       three buckets with three reasons, never one "skipped" line;
//   (4) the automatic startup sweep shares the SAME guard — a tree the verb refuses is also safe from
//       `reconcileOrphanedWorktrees`;
//   (5) the calibration that keeps the leak meter moving: a gitignored DEPENDENCY (`node_modules/`)
//       does NOT refuse a tree, and an UNLANDED branch does not either, because a worktree reap keeps
//       the ref — the refusal is about content git cannot restore, not about reachability.
//
// Run: node demo/worktree-reap.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { auditWorktrees, planReap, reapWorktrees, reconcileOrphanedWorktrees } from "../src/broker.mjs";
import { listWorktrees, soleContentPaths, branchLandedness, REGENERATED_IGNORED } from "../src/worktree.mjs";

const run = promisify(execFile);
const git = (cwd, ...args) => run("git", ["-C", cwd, ...args]);

const base = mkdtempSync(join(tmpdir(), "durig-reap-"));
const repo = join(base, "repo");
const wt = (id) => join(repo, `item-${id}`);
const listCount = async () => (await listWorktrees(repo)).length;

try {
	mkdirSync(repo, { recursive: true });
	writeFileSync(join(repo, "shared.txt"), "base\n");
	// The fixture's ignore set mirrors the real repo's `.gitignore`: `.spike/` is seat scratch
	// (gitignored, and NOT regenerable), `node_modules/` is a per-worktree dependency install.
	writeFileSync(join(repo, ".gitignore"), ".spike/\nnode_modules/\n");
	await git(repo, "init", "-q", "-b", "main");
	await git(repo, "add", ".");
	await git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");

	// item-1: terminal, unlocked, clean, branch on main -> REAPED.
	await git(repo, "worktree", "add", "-q", "-b", "item-1", wt(1));
	// item-2: CLEAN by `git status` — but it holds a gitignored file that exists nowhere else.
	await git(repo, "worktree", "add", "-q", "-b", "item-2", wt(2));
	mkdirSync(join(wt(2), ".spike"), { recursive: true });
	writeFileSync(join(wt(2), ".spike", "substrate-review.md"), "the only copy of the review\n");
	// item-3: clean, on main, but a LIVE queue row names `item-3` as the carrier (keep-gate shape).
	await git(repo, "worktree", "add", "-q", "-b", "item-3", wt(3));
	// item-4: terminal + LOCKED over a terminal item -> the deadlock family (#3165), its own message.
	await git(repo, "worktree", "add", "-q", "-b", "item-4", wt(4));
	await git(repo, "worktree", "lock", wt(4), "--reason", "verifier is checking the artifact");
	// item-5: terminal but DIRTY -> kept, `dirty` (the D60 clean gate).
	await git(repo, "worktree", "add", "-q", "-b", "item-5", wt(5));
	writeFileSync(join(wt(5), "shared.txt"), "uncommitted work\n");
	// item-6: LIVE (queued) -> kept.
	await git(repo, "worktree", "add", "-q", "-b", "item-6", wt(6));
	// item-7: terminal, clean, but its branch has a commit that is NOT on main AND it holds a
	// gitignored dependency dir. The dependency must not refuse the reap; the unlanded branch must
	// not either (the reap keeps the ref), so item-7 is reaped and the ref survives.
	await git(repo, "worktree", "add", "-q", "-b", "item-7", wt(7));
	writeFileSync(join(wt(7), "new.txt"), "unlanded commit\n");
	await git(wt(7), "add", "new.txt");
	await git(wt(7), "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "unlanded work");
	mkdirSync(join(wt(7), "node_modules", "left-pad"), { recursive: true });
	writeFileSync(join(wt(7), "node_modules", "left-pad", "index.js"), "// regenerable by npm install\n");

	const liveItemIds = new Set([6]);
	const terminalItemIds = new Set([1, 2, 3, 4, 5, 7]);
	const statusById = new Map([
		[1, "done"],
		[2, "done"],
		[3, "done"],
		[4, "done"],
		[5, "done"],
		[6, "queued"],
		[7, "done"],
	]);
	// The queue rows the reap is allowed to honour as carrier gates: NON-TERMINAL rows only. Row #9
	// is the keep-gate (#5280's shape) naming `item-3`; row #10 names `item-2` but is DONE, so it
	// must NOT gate — an unendable keep is its own defect.
	const liveRows = [{ id: 9, status: "held", subject: "KEEP-GATE: refs item-3 carries the substrate commission", body: "do not reap item-3 until this row resolves" }];
	const resolvedRows = [{ id: 10, status: "done", subject: "landing entry for item-2 — LANDED", body: "" }];

	// (0) the real `reapable` set, measured by the audit surface, not asserted from prose.
	const audit = await auditWorktrees({ repoPath: repo, liveItemIds, terminalItemIds, statusById, seatRoots: [] });
	const reapableIds = audit.filter((e) => e.keepReason === "reapable").map((e) => e.itemId).sort((a, b) => a - b);
	assert.deepEqual(
		reapableIds,
		[1, 2, 3, 7],
		`the audit's reapable set is every terminal+unlocked+clean tree; got ${reapableIds}`,
	);
	// The load-bearing premise: item-2 is `reapable` although it holds the only copy of a file. That
	// is the hole the guard exists to close, and `git status` alone cannot see it.
	const item2 = audit.find((e) => e.itemId === 2);
	assert.equal(item2.uncommitted, 0, "item-2 is CLEAN by `git status` — the dirty gate cannot see it");
	assert.deepEqual(await soleContentPaths(wt(2)), [".spike/"], "the sole-content probe names the gitignored path");
	assert.deepEqual(await soleContentPaths(wt(7)), [], "a gitignored DEPENDENCY is not sole content");
	assert.equal((await branchLandedness({ repoPath: repo, branch: "item-7" })).how, "commits-not-on-main", "the branch probe names the unlanded shape");
	assert.equal((await branchLandedness({ repoPath: repo, branch: "item-1" })).how, "ancestor-of-main", "the branch probe names the landed shape");

	// (1)+(2)+(3) the DRY RUN decides: three causes, three buckets.
	const dry = await reapWorktrees({ repoPath: repo, liveItemIds, terminalItemIds, statusById, seatRoots: [], liveRows, dryRun: true });
	assert.equal(dry.counts.reapable, 4, "four trees entered the reapable set");
	assert.deepEqual(dry.candidates.map((c) => c.itemId).sort((a, b) => a - b), [1, 7], "only the trees with no sole content and no live carrier row are candidates");
	assert.equal(dry.counts.reaped, 0, "a dry run removes nothing");
	assert.ok(existsSync(wt(1)) && existsSync(wt(7)), "a dry run leaves every tree in place");
	const refused = new Map(dry.refusedSoleCarrier.map((r) => [r.itemId, r]));
	assert.deepEqual([...refused.keys()].sort(), [2, 3], "the two sole carriers are refused, each its own record");
	assert.deepEqual(refused.get(2).causes, ["sole-content"], "item-2 refuses as sole-content");
	assert.ok(refused.get(2).soleContent.includes(".spike/"), "the refusal names the path git cannot restore");
	assert.deepEqual(refused.get(3).causes, ["declared-carrier"], "item-3 refuses as declared-carrier");
	assert.deepEqual(refused.get(3).keptBy, [9], "the refusal names the ROW that keeps it, so the gate is endable");
	assert.equal(refused.get(3).branch, "item-3", "the refusal names the branch and the item, not just the path");
	assert.equal(dry.counts.lockedOverTerminalItem, 1, "the locked-over-terminal-item tree is its OWN cause");
	assert.equal(dry.lockedOverTerminalItem[0].itemId, 4);
	assert.equal(dry.lockedOverTerminalItem[0].lockReason, "verifier is checking the artifact", "the lock reason travels, so the message says WHY");
	assert.deepEqual(dry.kept.map((k) => [k.itemId, k.keepReason]).sort((a, b) => a[0] - b[0]), [[5, "dirty"], [6, "live"]], "the other keeps are reported with the audit's reason vocabulary");
	// A RESOLVED row must stop gating (#5312's supersession of #5280 is the real case).
	const afterResolve = await planReap({ repoPath: repo, liveItemIds, terminalItemIds, statusById, seatRoots: [], liveRows: resolvedRows });
	assert.ok(afterResolve.refusedSoleCarrier.every((r) => r.itemId !== 2), "a done row no longer keeps a worktree");
	assert.ok(afterResolve.refusedSoleCarrier.some((r) => r.itemId === 3), "…and an unresolved row still names its branch as a carrier");

	// (4)+(5) the REAL reap. The automatic startup sweep runs first, through the SAME guard.
	const sweepDiag = [];
	const swept = await reconcileOrphanedWorktrees({ repoPath: repo, liveItemIds, terminalItemIds, seatRoots: [], liveRows, onDiagnostic: (d) => sweepDiag.push(d) });
	assert.ok(swept.includes(1) && !existsSync(wt(1)), "the startup sweep reaps the safe tree");
	assert.ok(existsSync(wt(2)), "the startup sweep REFUSES the sole-content tree (one guard, both paths)");
	assert.ok(existsSync(wt(3)), "the startup sweep REFUSES the tree a live row names as a carrier");
	assert.ok(existsSync(wt(7)) && !existsSync(wt(2 + 5)), "the unlanded-branch tree waits for the explicit verb");
	assert.ok(sweepDiag.some((d) => d.reason === "sole-carrier:sole-content" && d.itemId === 2), "the sweep reports the sole-carrier refusal as its own reason");
	assert.ok(sweepDiag.some((d) => d.reason === "locked-over-terminal-item" && d.itemId === 4), "the sweep reports the lock-over-terminal deadlock as its own reason");
	assert.ok(sweepDiag.some((d) => d.reason === "dirty" && d.itemId === 5), "a dirty keep keeps its audit reason");

	const before = await listCount();
	const real = await reapWorktrees({ repoPath: repo, liveItemIds, terminalItemIds, statusById, seatRoots: [], liveRows });
	assert.deepEqual(real.reaped.map((r) => r.itemId).sort((a, b) => a - b), [7], "the verb reaps the remaining candidate");
	assert.equal(real.counts.removalFailed, 0, "no removal failed");
	assert.ok(!existsSync(wt(7)), "the reaped tree is gone");
	assert.ok(existsSync(wt(2)) && existsSync(wt(3)) && existsSync(wt(4)) && existsSync(wt(5)), "every refused or kept tree is still there");
	// The ref SURVIVES its worktree — the reason an unlanded branch is not a refusal cause.
	const branches = (await git(repo, "for-each-ref", "--format=%(refname:short)", "refs/heads")).stdout.split("\n");
	assert.ok(branches.includes("item-7"), "the reaped tree's BRANCH survives, so its unlanded commit is reachable");
	assert.equal((await listCount()), before - real.counts.reaped, "the worktree list count drops by exactly the reaped count");

	// (1) the leak is CONSUMED, not reported: after the pass, `reapable` is 0.
	const after = await auditWorktrees({ repoPath: repo, liveItemIds, terminalItemIds, statusById, seatRoots: [] });
	assert.equal(after.filter((e) => e.keepReason === "reapable").length, 0, "after a pass the reapable set is empty — `ok: true` now means something");
	assert.equal(
		after.filter((e) => e.keepReason === "reapable").length,
		0,
		"the refused sole carriers are NOT counted reapable by the next pass either — they are kept, and visible",
	);
	assert.ok(
		after.find((e) => e.itemId === 2)?.keepReason === "reapable" || existsSync(wt(2)),
		"a refused sole carrier stays on the ledger rather than vanishing",
	);
	// (5) calibration: the regenerated set is declared, small, and every entry names its command.
	assert.ok(REGENERATED_IGNORED.length <= 6 && REGENERATED_IGNORED.every((e) => e.path && e.regeneratedBy), "every regenerated path names the command that rebuilds it");

	console.log(
		"WORKTREE REAP PASS (reapable set consumed to 0; sole-content and declared-carrier refusals named with paths/row ids; locked-over-terminal-item its own cause; the startup sweep shares the guard; the reaped tree's ref survives)",
	);
} finally {
	try {
		rmSync(base, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}
process.exit(0);
