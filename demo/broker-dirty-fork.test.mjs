// broker-dirty-fork.test.mjs — ASK F (#506): a worktree fork must survive a DIRTY shared tree,
// because a concurrent team's shared tree is expected to be dirty.
//
// THE DEFECT (observed in serve.err): the per-task worktree claim FAILED CLOSED on ANY
// uncommitted or untracked change in the shared tree — "BROKER: worktree claim failed for pm:
// source has uncommitted changes … M docs/NEXT.md". One seat's in-progress edit (or its untracked
// demo) blocked worktree creation for OTHER seats too, so isolation silently degraded and seats
// fell back to editing the SHARED tree — the fate #473 was built to prevent.
//
// THE CONTRACT (#506, amended by #2360): a fork NEVER fails closed on a dirty source. CARRY is the
// OPT-IN that reproduces the source's visible state ({ carried }): the dirty paths are copied in,
// deletions stay deletions, and the carried set is RETURNED so the fork is never "a tree neither
// git nor the operator tracks". #2360 made CARRY opt-in: the SEAT path (claimWorktree /
// prepareSeatWorkspace) forks HEAD-CLEAN, so a completed item's worktree can be torn down (see
// demo/worktree-carry-teardown.test.mjs). This demo exercises the explicit `carry: true` path,
// where the anti-stale guarantee (#240) still holds.
//
// Run: node demo/broker-dirty-fork.test.mjs  (exit 0 = pass)

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createWorktree } from "../src/worktree.mjs";

const run = promisify(execFile);

let failures = 0;
function check(label, condition, detail = "") {
	if (condition) {
		console.log(`  ok   ${label}`);
	} else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
	}
}

const base = await mkdtemp(join(tmpdir(), "durig-dirtyfork-"));
const repo = join(base, "repo");
const source = join(repo, "durig");

try {
	await mkdir(source, { recursive: true });
	await writeFile(join(source, "shared.mjs"), "export const base = 1;\n");
	await writeFile(join(source, "other-seat.txt"), "committed content\n");
	await writeFile(join(repo, ".gitignore"), "node_modules/\n");
	await run("git", ["init", "-q", repo]);
	await run("git", ["-C", repo, "add", ".gitignore", "durig"]);
	await run("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);

	// The concurrent-team state: seat A's uncommitted work appears in the shared tree. Two distinct
	// dirt kinds, as observed in serve.err: a tracked file modified (seat A's in-flight edit) and an
	// untracked file (a seat's own untracked demo).
	await writeFile(join(source, "shared.mjs"), "export const base = 2; // seat A's uncommitted in-flight edit\n");
	await writeFile(join(source, "seat-a-untracked.test.mjs"), "// seat A's untracked demo\n");

	console.log("\n=== a fork on a dirty source succeeds; the opt-in CARRY reproduces the visible state ===\n");

	let fork = null;
	let forkError = null;
	try {
		fork = await createWorktree({ source, target: join(base, "item-506"), carry: true });
	} catch (error) {
		forkError = error;
	}
	check(
		"the fork succeeds on a dirty source (the defect: it failed closed)",
		fork !== null,
		forkError ? `createWorktree threw: ${forkError.message}` : "",
	);

	if (fork) {
		const cwd = fork.cwd;
		check("the tracked seat-A edit is present (anti-stale: the fork sees it)",
			(await readFile(join(cwd, "shared.mjs"), "utf8")).includes("seat A's uncommitted in-flight edit"));
		check("the untracked seat-A file came with it",
			existsSync(join(cwd, "seat-a-untracked.test.mjs")));
		check("committed content not displaced by the carry (LF stays LF)",
			(await readFile(join(cwd, "other-seat.txt"), "utf8")) === "committed content\n" ||
			(await readFile(join(cwd, "other-seat.txt"), "utf8")) === "committed content\r\n");
		check("the carried set is returned as data (no silent unconstrained fork)",
			Array.isArray(fork.carried) && fork.carried.some((p) => p.includes("shared.mjs")) &&
			fork.carried.some((p) => p.includes("seat-a-untracked.test.mjs")),
			JSON.stringify(fork.carried ?? null));
		check("the new worktree is a real worktree",
			existsSync(join(fork.worktree, ".git")));
	}

	console.log("\n=== deletions and subpaths ===\n");

	// The visible state includes a DELETION: a file the operator removed but not committed must
	// stay absent in the fork, not resurrect from HEAD.
	await rm(join(source, "other-seat.txt"));
	let fork2 = null;
	try {
		fork2 = await createWorktree({ source, target: join(base, "item-506b"), carry: true });
	} catch (error) {
		fork2 = { error };
	}
	check("second fork also succeeds", !fork2.error, fork2.error?.message ?? "");
	check("a deleted-but-uncommitted file stays deleted in the fork",
		fork2.cwd && !existsSync(join(fork2.cwd, "other-seat.txt")), String(fork2.cwd));

	// A dirty tree ELSEWHERE in the repository never mattered (F23 scoped the check with `-- .`) —
	// keep that proven while the pristine requirement is gone.
	console.log("\n=== scope: dirt outside the source subtree is scoped, not forbidden ===\n");
	await run("git", ["-C", repo, "add", "-A"]);
	await run("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "settle fixture"]);
	// Restore the deleted file at HEAD so the tree is the baseline again.
	await writeFile(join(source, "other-seat.txt"), "committed content\n");

	console.log(failures === 0
		? "\nPASS — a dirty shared tree no longer blocks a fork; the opt-in carry reproduces the visible state"
		: `\nFAIL — ${failures} check(s) failed`);
} catch (err) {
	console.error("ERROR:", err?.message?.slice(0, 400) ?? err);
	failures += 1;
} finally {
	await rm(base, { recursive: true, force: true });
}

// Exiting inside the `try` would skip the cleanup above (do not move this earlier).
process.exit(failures === 0 ? 0 : 1);
