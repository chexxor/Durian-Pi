// demo/worktree-scratch.test.mjs — qa verify-scratch in the worktree audit + sweep (ROADMAP 76
// leak source B, #1891).
//
// The addendum to #1881: qa's THROWAWAY verify scratch (`.verify-*`, `verify*`, `wt-*`) is a leak
// source — it is left behind and never reaped. This proves the audit SURFACES it distinctly (kind
// `verify-scratch`, not lumped into `non-item`) and that the sweep reclaims the UNLOCKED + CLEAN
// ones while keeping locked, dirty, and ordinary non-item worktrees.
//
// Failing-first: before the verify-scratch classification exists, these trees read as `non-item`
// and are never reaped. Run: node demo/worktree-scratch.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { auditWorktrees, reconcileOrphanedWorktrees } from "../src/broker.mjs";

const run = promisify(execFile);
const git = (cwd, ...args) => run("git", ["-C", cwd, ...args]);

const base = mkdtempSync(join(tmpdir(), "durig-scratch-"));
const repo = join(base, "repo");
const at = (name) => join(repo, name);

try {
	mkdirSync(repo, { recursive: true });
	writeFileSync(join(repo, "shared.txt"), "base\n");
	await git(repo, "init", "-q");
	await git(repo, "add", "shared.txt");
	await git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");

	// qa verify scratch: an unlocked clean one (reapable), a LOCKED one (kept), a DIRTY one (kept).
	await git(repo, "worktree", "add", "-q", "--detach", at(".verify-111"));
	await git(repo, "worktree", "add", "-q", "--detach", at("verify222"));
	await git(repo, "worktree", "lock", at("verify222"));
	await git(repo, "worktree", "add", "-q", "--detach", at("wt-333"));
	writeFileSync(join(at("wt-333"), "shared.txt"), "uncommitted\n");
	// A CONTROL: an ordinary non-item worktree that is NOT verify scratch — never reaped.
	await git(repo, "worktree", "add", "-q", "--detach", at("scratchdir"));
	// And a terminal item worktree, as a control that items still reap.
	await git(repo, "worktree", "add", "-q", "-b", "impl-item-1", at("item-1"));

	const terminalItemIds = new Set([1]);
	const entries = await auditWorktrees({ repoPath: repo, liveItemIds: new Set(), terminalItemIds });
	const byPath = new Map(entries.map((e) => [e.worktree.replace(/\\/g, "/").split("/").pop(), e]));

	assert.equal(byPath.get(".verify-111").kind, "verify-scratch", "an unlocked verify scratch is classified verify-scratch");
	assert.equal(byPath.get(".verify-111").keepReason, "reapable", "an unlocked, clean verify scratch is reapable");
	assert.equal(byPath.get("verify222").kind, "verify-scratch", "a locked verify scratch is verify-scratch");
	assert.equal(byPath.get("verify222").keepReason, "locked", "a LOCKED verify scratch is kept");
	assert.equal(byPath.get("wt-333").kind, "verify-scratch", "a wt-* scratch is verify-scratch");
	assert.equal(byPath.get("wt-333").keepReason, "dirty", "a DIRTY verify scratch is kept");
	assert.equal(byPath.get("wt-333").uncommitted, 1, "the dirty scratch's uncommitted count is reported");
	assert.equal(byPath.get("scratchdir").kind, "non-item", "an ordinary non-item worktree stays non-item");
	assert.equal(byPath.get("scratchdir").keepReason, "non-item", "an ordinary non-item worktree is kept");
	assert.equal(byPath.get("item-1").kind, "item", "an item worktree is kind item");

	const removed = await reconcileOrphanedWorktrees({ repoPath: repo, liveItemIds: new Set(), terminalItemIds });
	assert.ok(removed.includes(1), "a terminal, clean item worktree is still reaped");
	assert.ok(!existsSync(at(".verify-111")), "the unlocked, clean verify scratch IS reclaimed");
	assert.ok(existsSync(at("verify222")), "the LOCKED verify scratch is kept (verifier-must-lock protects it)");
	assert.ok(existsSync(at("wt-333")), "the DIRTY verify scratch is kept (never discard uncommitted work)");
	assert.ok(existsSync(at("scratchdir")), "an ordinary non-item worktree is NEVER reaped");

	console.log(
		"WORKTREE SCRATCH PASS (qa verify scratch is classified distinctly; unlocked+clean scratch is reclaimed; locked/dirty scratch and ordinary non-item trees are kept)",
	);
} finally {
	try {
		rmSync(base, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}
process.exit(0);
