// demo/worktree-reuse-deps.test.mjs — a poisoned `item-<id>` must not be reused as
// "provisioned" (#916, the reuse-path half of the #822/#869 worktree defect).
//
// The defect: `prepareSeatWorkspace`'s REUSE branch (`existsSync(worktreePath)`) returned
// an existing `item-<id>` dir as a healthy, provisioned worktree WITHOUT checking deps.
// But a first attempt can create the dir and then FAIL inside `installWorktreeDeps`, so
// the dir is left on disk with no `node_modules`; a RETRY then hits the reuse branch and
// reports that dep-less dir as provisioned. The seat is handed a half-provisioned tree.
//
// This demo reproduces the poisoned dir exactly: a repo whose `package.json` has no
// lockfile, so `npm ci` throws AFTER `claimWorktree` has already created the dir. The
// retry must NOT return it as a healthy worktree — it must fail loud.
//
// Failing-first: before the fix, the second call returns `{ created: false }` (a lie), so
// the `assert.rejects` below fails.
// Run: node demo/worktree-reuse-deps.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { prepareSeatWorkspace, removeSeatWorkspace } from "../src/worktree.mjs";

const run = promisify(execFile);
const base = await mkdtemp(join(tmpdir(), "durig-reuse-deps-"));
const repo = join(base, "repo");
const itemId = 9;
const poisoned = join(repo, `item-${itemId}`);

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

try {
	// The repo IS the source (durig's own tree), so `installWorktreeDeps(worktreeRoot)`
	// finds the package.json at the worktree root. A package.json with NO lockfile makes
	// `npm ci` throw — the same trigger the existing prepare-workspace demo uses, offline.
	await writeFile(join(base, "placeholder"), "");
	await run("git", ["init", "-q", repo]);
	await writeFile(join(repo, "artifact.txt"), "shared content\n");
	await writeFile(
		join(repo, "package.json"),
		JSON.stringify({ name: "poison-fixture", version: "1.0.0", private: true }),
	);
	await run("git", ["-C", repo, "add", "artifact.txt", "package.json"]);
	await run("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);

	console.log("\n=== a poisoned item-<id> must not be reused as provisioned ===\n");

	// First attempt: creates the dir, then fails in installWorktreeDeps — leaving the
	// poisoned dir on disk (no cleanup), which is what makes the reuse branch dangerous.
	await check("the first attempt fails (npm ci without a lockfile) and leaves the dir", async () => {
		await assert.rejects(
			prepareSeatWorkspace({ source: repo, worktreeRoot: repo, itemId }),
			/npm ci --prefer-offline failed in/,
			"the first attempt must fail loudly",
		);
		assert.ok(existsSync(poisoned), `the failed attempt left ${poisoned} on disk (poisoned reuse candidate)`);
		assert.ok(!existsSync(join(poisoned, "node_modules")), "and it has no node_modules (not provisioned)");
	});

	// The retry: MUST NOT report the dep-less dir as a healthy provisioned worktree.
	await check("the retry does NOT return the poisoned dir as provisioned (fails loud)", async () => {
		let resolved = null;
		try {
			resolved = await prepareSeatWorkspace({ source: repo, worktreeRoot: repo, itemId });
		} catch (err) {
			assert.match(String(err.message), /npm ci --prefer-offline failed in/, `the retry fails loud (${err.message})`);
			return;
		}
		// If it resolved, it must be genuinely provisioned — never a lie.
		assert.ok(
			existsSync(join(resolved.worktree, "node_modules")),
			`a reused worktree must be provisioned; got ${JSON.stringify(resolved)} with no node_modules`,
		);
	});

	console.log(
		failures === 0
			? "\nWORKTREE REUSE-DEPS PASS (a poisoned item-<id> is repaired or fails loud, never reported healthy)"
			: `\nFAIL — ${failures} check(s) failed`,
	);
} finally {
	// Unlock before removal: the worktree is locked while claimed, and a locked worktree
	// cannot be removed on Windows.
	try {
		await run("git", ["-C", repo, "worktree", "unlock", poisoned]);
	} catch (err) {
		console.error(`cleanup: unlock failed: ${err?.message ?? err}`);
	}
	try {
		await removeSeatWorkspace({ worktreeRoot: repo, itemId, force: true });
	} catch (err) {
		console.error(`cleanup: removeSeatWorkspace failed: ${err?.message ?? err}`);
	}
	try {
		await rm(base, { recursive: true, force: true });
	} catch (err) {
		console.error(`cleanup: rm failed: ${err?.message ?? err}`);
	}
}
process.exit(failures === 0 ? 0 : 1);
