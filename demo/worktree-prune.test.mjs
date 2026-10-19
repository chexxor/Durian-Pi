// demo/worktree-prune.test.mjs — WORKTREE-ROT (2/3) PRUNE AFTER REMOVE (#2329).
//
// The vendored `finishing-a-development-branch` skill (Step 6) says: run `git worktree prune`
// after every removal — "one line, prevents silent rot". A worktree directory deleted OUT OF
// BAND (by a harness/viewer, or the `.verify-*`/`wt-*` scratch whose dirs were long gone) leaves
// a STALE registration that keeps listing and confuses `worktree audit`; the 2026-10-19 pass
// found and cleared 25 such registrations.
//
// Proves: after a teardown (removeClaimedWorktree) or a broker sweep (reconcileOrphanedWorktrees),
// the stale registration of an out-of-band-deleted worktree is gone.
//
// Failing-first: on the base the registration persists after both paths (RED).
// Run: node demo/worktree-prune.test.mjs  (exit 0 = pass)

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createWorktree, removeClaimedWorktree, listWorktrees } from "../src/worktree.mjs";
import { reconcileOrphanedWorktrees } from "../src/broker.mjs";

const run = promisify(execFile);

let failures = 0;
function check(label, condition, detail = "") {
	if (condition) {
		console.log(`  ok   ${label}`);
	} else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

const base = await mkdtemp(join(tmpdir(), "durig-prune-"));
const repo = join(base, "repo");
const source = join(repo, "durig");
try {
	await mkdir(source, { recursive: true });
	await writeFile(join(source, "tracked.txt"), "original\n");
	await run("git", ["init", "-q", repo]);
	await run("git", ["-C", repo, "add", "."]);
	await run("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);

	const listed = async () => (await listWorktrees(repo)).map((w) => resolve(w.worktree));

	console.log("\nA teardown PRUNES the stale registration of an out-of-band-deleted tree");
	const a = join(repo, "item-1");
	const b = join(repo, "item-2");
	await createWorktree({ source, target: a });
	await createWorktree({ source, target: b });
	check(
		"both worktrees are registered",
		(await listed()).includes(resolve(a)) && (await listed()).includes(resolve(b)),
		JSON.stringify(await listed()),
	);

	// Delete A's DIRECTORY only — exactly what a harness/viewer (or a crashed run) does. The
	// administrative registration under .git/worktrees/ survives.
	await rm(a, { recursive: true, force: true });
	check("the deleted tree still has a STALE registration (the rot)", (await listed()).includes(resolve(a)), JSON.stringify(await listed()));

	await removeClaimedWorktree({ worktree: b });
	check("the teardown removed B", !existsSync(b));
	check(
		"...and PRUNED A's stale registration",
		!(await listed()).includes(resolve(a)),
		`still listed: ${JSON.stringify(await listed())}`,
	);

	console.log("\nThe broker sweep self-heals a stale registration too (no removal of its own)");
	const c = join(repo, "item-3");
	await createWorktree({ source, target: c });
	await rm(c, { recursive: true, force: true });
	check("C's registration is stale before the sweep", (await listed()).includes(resolve(c)), JSON.stringify(await listed()));
	await reconcileOrphanedWorktrees({ repoPath: repo, liveItemIds: new Set(), terminalItemIds: new Set() });
	check(
		"the broker sweep prunes C's stale registration",
		!(await listed()).includes(resolve(c)),
		`still listed: ${JSON.stringify(await listed())}`,
	);

	console.log(failures === 0 ? "\nPASS — removals and the sweep prune stale registrations" : `\nFAIL — ${failures} check(s) failed`);
} catch (err) {
	console.error("ERROR:", err?.message?.slice(0, 500));
	failures += 1;
} finally {
	await rm(base, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
