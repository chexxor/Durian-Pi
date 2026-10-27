// demo/verify-scratch-per-tree.test.mjs — #2602 (instance 3 of #1967): `cleanVerifyScratch` must
// catch a PER-TREE failure, so ONE un-removable verify scratch does not abort the whole cleanup.
//
// FAILING-FIRST (RED at HEAD): the loop `await removeClaimedWorktree(...)` has no try/catch, so the
// first tree that THROWS — a scratch holding a junction/symlink, which `removeClaimedWorktree`
// refuses by throwing (Git 2.42 would delete THROUGH the junction) — aborts `cleanVerifyScratch`
// and leaves every LATER scratch un-cleaned (the leak) and the verify-completion call failed.
// GREEN AFTER: the bad tree is reported in `kept` (reason "error") and the cleanup CONTINUES.
//
// Run: node demo/verify-scratch-per-tree.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { cleanVerifyScratch } from "../src/broker.mjs";

const run = promisify(execFile);
const git = (cwd, ...args) => run("git", ["-C", cwd, ...args]);

const base = mkdtempSync(join(tmpdir(), "durig-scratch-pertree-"));
const repo = join(base, "repo");
const badScratch = join(repo, "verify-777"); // holds a junction → removal THROWS
const laterScratch = join(repo, "verify-666"); // must STILL be removed after the throw
const junctionTarget = join(base, "node-modules-target");

try {
	mkdirSync(repo, { recursive: true });
	// `node_modules/` is IGNORED, so the junction inside the scratch does NOT make it "dirty": the
	// tree reaches the junction check (the THROW) instead of being refused as dirty first — the
	// real-world `%TEMP%/verify*` node_modules-junction shape (docs/runbooks/leaked-worktrees.md).
	// `node_modules` WITHOUT the trailing slash (2026-10-26): `node_modules/` matches a DIRECTORY
	// only, and on POSIX the "junction" below is a SYMLINK — not a directory — so git reported the
	// scratch dirty and it never reached the junction check. On Windows a junction IS a directory,
	// which is why the fixture passed there and failed on Linux. The un-slashed pattern ignores both
	// shapes, which is what "node_modules is ignored" was always meant to say.
	writeFileSync(join(repo, ".gitignore"), "node_modules\n");
	await git(repo, "init", "-q");
	await git(repo, "add", ".gitignore");
	await git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");

	// A junction TARGET outside the worktree (never the repo itself — readdir recurses into it).
	mkdirSync(junctionTarget, { recursive: true });
	writeFileSync(join(junctionTarget, "dep.js"), "x\n");

	// The BAD scratch FIRST: a clean tree holding a node_modules junction.
	await git(repo, "worktree", "add", "-q", "--detach", badScratch);
	symlinkSync(junctionTarget, join(badScratch, "node_modules"), "junction");
	// A LATER, ordinary clean scratch — it must not be collateral damage.
	await git(repo, "worktree", "add", "-q", "--detach", laterScratch);

	const status = await git(badScratch, "status", "--porcelain");
	assert.equal(
		status.stdout.trim(),
		"",
		"the bad scratch is CLEAN (node_modules is ignored) so it reaches the junction check",
	);

	// THE CALL MUST NOT THROW. RED at HEAD: it throws on the junction and aborts the whole cleanup.
	const { removed, kept } = await cleanVerifyScratch({ repoPath: repo });

	assert.ok(
		kept.some((k) => k.worktree.endsWith("verify-777") && k.reason === "error"),
		`the un-removable scratch is KEPT with reason "error"; kept=${JSON.stringify(kept)}`,
	);
	assert.ok(
		removed.some((p) => p.endsWith("verify-666")),
		`the scratch AFTER the bad tree is STILL removed (the loop continued); removed=${JSON.stringify(removed)}`,
	);
	assert.ok(!existsSync(laterScratch), "the later scratch is GONE");
	assert.ok(existsSync(badScratch), "the un-removable scratch is left in place (never force-removed)");
	assert.ok(
		existsSync(join(junctionTarget, "dep.js")),
		"the junction TARGET survived (nothing deleted THROUGH it)",
	);

	console.log(
		"VERIFY SCRATCH PER-TREE PASS (#2602: one un-removable scratch is reported and the rest are still cleaned)",
	);
} finally {
	try {
		rmSync(base, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}
process.exit(0);
