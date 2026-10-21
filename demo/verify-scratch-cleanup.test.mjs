// demo/verify-scratch-cleanup.test.mjs — verify-scratch cleanup on verify completion (ROADMAP 76
// leak source B PREVENTION, #1907).
//
// #1881/#1891 made qa's throwaway verify scratch VISIBLE and reapable. This is the mechanism the
// verifier runs when its VERIFY COMPLETES: unlock + remove every verify-scratch worktree. A DIRTY
// scratch is REFUSED — never `--force`, never `git clean` — so uncommitted work is preserved.
//
// Failing-first: before `cleanVerifyScratch`/`removeVerifyScratch` exist this dies with
// ERR_MODULE_NOT_FOUND. Run: node demo/verify-scratch-cleanup.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { cleanVerifyScratch, removeVerifyScratch } from "../src/broker.mjs";
import { listWorktrees } from "../src/worktree.mjs";

const run = promisify(execFile);
const git = (cwd, ...args) => run("git", ["-C", cwd, ...args]);

const base = mkdtempSync(join(tmpdir(), "durig-scratch-clean-"));
const repo = join(base, "repo");
const item = join(repo, "item-1");

try {
	mkdirSync(repo, { recursive: true });
	writeFileSync(join(repo, "shared.txt"), "base\n");
	await git(repo, "init", "-q");
	await git(repo, "add", "shared.txt");
	await git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");

	// The verifier's item worktree, with NESTED verify scratch under it (the observed shape).
	await git(repo, "worktree", "add", "-q", "-b", "qa-item-1", item);
	const cleanScratch = join(item, "verify-999");
	const dirtyScratch = join(item, "wt-888");
	await git(repo, "worktree", "add", "-q", "--detach", cleanScratch);
	await git(repo, "worktree", "add", "-q", "--detach", dirtyScratch);
	await git(repo, "worktree", "lock", cleanScratch); // verifier-must-lock while in use
	writeFileSync(join(dirtyScratch, "probe.mjs"), "// a real artifact — must NOT be destroyed\n");
	// A CONTROL: an ordinary non-item worktree that is not verify scratch.
	const control = join(repo, "scratchdir");
	await git(repo, "worktree", "add", "-q", "--detach", control);

	// The verify COMPLETES → the verifier runs the cleanup.
	const { removed, kept } = await cleanVerifyScratch({ repoPath: repo });
	assert.ok(removed.some((p) => p.endsWith("verify-999")), `the clean (even LOCKED) scratch is removed; removed=${JSON.stringify(removed)}`);
	assert.ok(!existsSync(cleanScratch), "the clean verify scratch is GONE after completion");
	assert.ok(existsSync(dirtyScratch), "the DIRTY scratch is NOT removed (never --force/clean)");
	assert.ok(
		kept.some((k) => k.worktree.endsWith("wt-888") && k.reason === "dirty"),
		`the dirty scratch is reported as kept/dirty; kept=${JSON.stringify(kept)}`,
	);
	assert.equal(
		readFileSync(join(dirtyScratch, "probe.mjs"), "utf8"),
		"// a real artifact — must NOT be destroyed\n",
		"the dirty scratch's uncommitted work is preserved byte-for-byte",
	);
	assert.ok(existsSync(control), "an ordinary non-item worktree is NOT touched");

	// removeVerifyScratch removes ONE named scratch (a verifier tidying a single tree).
	rmSync(join(dirtyScratch, "probe.mjs"), { force: true }); // the verifier saves/commits its work first
	const one = await removeVerifyScratch({ worktree: dirtyScratch });
	assert.equal(one.removed, true, "removeVerifyScratch removes the named scratch once it is clean");
	assert.ok(!existsSync(dirtyScratch), "the named scratch is gone");

	// The cleanup is a no-op when there is nothing left to clean.
	const again = await cleanVerifyScratch({ repoPath: repo });
	assert.deepEqual(again.removed, [], "a second cleanup finds nothing to remove");

	const remaining = (await listWorktrees(repo)).map((w) => w.worktree.replace(/\\/g, "/"));
	assert.ok(remaining.some((p) => p.endsWith("scratchdir")), "the control worktree survives every cleanup");

	console.log(
		"VERIFY SCRATCH CLEANUP PASS (on verify completion the scratch is unlocked+removed; a dirty scratch is refused and its work preserved; ordinary non-item trees are untouched)",
	);
} finally {
	try {
		rmSync(base, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}
process.exit(0);
