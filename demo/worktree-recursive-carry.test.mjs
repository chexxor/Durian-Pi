// demo/worktree-recursive-carry.test.mjs — #998 / #506: a second worktree under the same
// source must NOT be carried into itself.
//
// Defect: createWorktree() forks HEAD and then CARRYs the source's visible (uncommitted)
// state into the new worktree. When an item worktree already exists under the source (and
// the just-created target does too), `git status` in the source lists both as untracked
// directories, so the carry walks them as ordinary dirty paths — including the target
// itself, whose copy destination lands INSIDE its own source:
//     cp(source/item-2, source/item-2/item-2)  ->  ERR_FS_CP_EINVAL
// A sibling worktree is likewise copied wholesale into the new tree (a whole checkout,
// node_modules and all), which is not "visible state" the seat ever meant to carry.
//
// Failing-first: before the fix, the SECOND prepareSeatWorkspace() rejects with
// ERR_FS_CP_EINVAL and the run exits 1. After the fix it returns a provisioned worktree
// with neither worktree copied in, while a real untracked file IS still carried.
//
// Run: node demo/worktree-recursive-carry.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { prepareSeatWorkspace } from "../src/worktree.mjs";

const run = promisify(execFile);
const base = await mkdtemp(join(tmpdir(), "durig-recursive-carry-"));
const repo = join(base, "repo");

let failures = 0;
async function check(label, fn) {
	try {
		await fn();
		console.log(`  ok   ${label}`);
	} catch (err) {
		failures += 1;
		console.log(`  FAIL ${label} -- ${err.message}`);
	}
}

const git = (args, cwd = repo) => run("git", args, { cwd });

try {
	await run("git", ["init", "-q", repo]);
	await git(["config", "user.email", "demo@durig.test"]);
	await git(["config", "user.name", "durig demo"]);
	await git(["config", "commit.gpgsign", "false"]);
	await writeFile(join(repo, "README.md"), "the tracked baseline\n");
	await git(["add", "README.md"]);
	await git(["commit", "-q", "-m", "baseline"]);

	// First worktree: source is clean, so nothing to carry.
	const first = await prepareSeatWorkspace({ source: repo, worktreeRoot: repo, itemId: 1 });
	await check("first worktree created", async () => {
		assert.equal(first.created, true);
		assert.ok(existsSync(join(repo, "item-1", "README.md")), "item-1 is a real checkout");
	});

	// A real piece of visible state the carry MUST reproduce (this is what #506 is for).
	await writeFile(join(repo, "notes.txt"), "an untracked note that must travel\n");

	// Second worktree: the source now holds `item-1/` (a sibling worktree) and, once
	// `git worktree add` runs, `item-2/` (the target) as untracked paths.
	let second = null;
	let secondError = null;
	try {
		second = await prepareSeatWorkspace({ source: repo, worktreeRoot: repo, itemId: 2 });
	} catch (err) {
		secondError = err;
	}

	await check("second worktree is created without ERR_FS_CP_EINVAL", async () => {
		assert.equal(
			secondError,
			null,
			`second prepareSeatWorkspace threw: ${secondError?.code ?? ""} ${secondError?.message ?? ""}`,
		);
		assert.equal(second.created, true);
	});

	await check("the target worktree is never copied into itself", async () => {
		assert.ok(!existsSync(join(repo, "item-2", "item-2")), "item-2/item-2 must not exist");
	});

	await check("a sibling worktree is not copied into the new worktree", async () => {
		assert.ok(!existsSync(join(repo, "item-2", "item-1")), "item-2/item-1 must not exist");
	});

	await check("the source's real visible state IS still carried", async () => {
		assert.ok(existsSync(join(repo, "item-2", "notes.txt")), "notes.txt must be carried");
	});
} catch (err) {
	failures += 1;
	console.error("ERROR:", err?.message?.slice(0, 400) ?? err);
} finally {
	await rm(base, { recursive: true, force: true }).catch(() => {});
}

console.log(failures === 0
	? "\nPASS — a second worktree under one source is carried safely (no recursive self-copy)"
	: `\nFAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
