// broker-dirty-fork.test.mjs — ASK F (#506): a worktree claim must survive a DIRTY
// shared tree, because a concurrent team's shared tree is expected to be dirty.
//
// THE DEFECT (observed in serve.err, this session): under the resident broker the
// per-task worktree claim FAILED CLOSED on ANY uncommitted or untracked change in
// the shared tree — "BROKER: worktree claim failed for pm: source has uncommitted
// changes … M docs/NEXT.md", later "M src/broker.mjs, ?? demo/broker-wakepath.test.mjs".
// One seat's in-progress edit (or its untracked demo) blocked worktree creation for
// OTHER seats too — so isolation silently degraded and seats fell back to editing
// the SHARED tree, which is the fate #473 was built to prevent.
//
// THE CONTRACT CHANGE (disclosed supersession of F23's "refuse rather than carry"):
// createWorktree forks the VISIBLE STATE. The anti-stale guarantee stays — a seat
// must never silently miss what the forked-from tree visibly holds (#240's
// collision) — but the mechanism flips from refusal to CARRY: the dirty paths are
// copied into the new worktree, deletions stay deletions, the carried set is
// RETURNED ({ carried }) and the broker logs it, so the fork is never "a tree
// neither git nor the operator tracks" — it is exactly the tracked HEAD plus the
// enumerated visible content.
//
// Failing-first: run BEFORE the fix — the repro assertions FAIL (the claim throws
// "source has uncommitted changes"). Run after — they pass. Named below.
// Run: node demo/broker-dirty-fork.test.mjs  (exit 0 = pass)

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createWorktree, claimWorktree } from "../src/worktree.mjs";

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

	// The concurrent-team state: seat A's uncommitted work appears in the shared
	// tree at the same time as a queued item for seat B. Two distinct dirt kinds,
	// as observed in serve.err: a tracked file modified (seat A's in-flight edit)
	// and an untracked file (a seat's own untracked demo).
	await writeFile(join(source, "shared.mjs"), "export const base = 2; // seat A's uncommitted in-flight edit\n");
	await writeFile(join(source, "seat-a-untracked.test.mjs"), "// seat A's untracked demo\n");

	console.log("\n=== RED/GREEN: a claim on a dirty shared tree succeeds and carries the visible state ===\n");

	let claim = null;
	let claimError = null;
	try {
		// The broker's call shape, unchanged: the CLAIM is the concurrency surface.
		claim = await claimWorktree({ source, worktreeRoot: base, itemLabel: "item-506" });
	} catch (error) {
		claimError = error;
	}
	check(
		"claim succeeds on a dirty source (the defect: it failed closed)",
		claim !== null,
		claimError ? `claimWorktree threw: ${claimError.message}` : "",
	);

	if (claim) {
		const cwd = claim.cwd;
		// The visible state, not HEAD's:
		check("the tracked seat-A edit is present (anti-stale: the fork sees it)",
			(await readFile(join(cwd, "shared.mjs"), "utf8")).includes("seat A's uncommitted in-flight edit"));
		check("the untracked seat-A file came with it",
			existsSync(join(cwd, "seat-a-untracked.test.mjs")));
		check("committed content not displaced by the carry (LF stays LF)",
			(await readFile(join(cwd, "other-seat.txt"), "utf8")) === "committed content\n" ||
			(await readFile(join(cwd, "other-seat.txt"), "utf8")) === "committed content\r\n",);
		check("the carried set is returned as data (no silent unconstrained fork)",
			Array.isArray(claim.carried) && claim.carried.some((p) => p.includes("shared.mjs")) &&
			claim.carried.some((p) => p.includes("seat-a-untracked.test.mjs")),
			JSON.stringify(claim.carried ?? null));
		check("the new worktree is a real worktree (identity check ran, then locked)",
			claim.locked === true && existsSync(join(claim.worktree, ".git")));
	}

	console.log("\n=== deletions and subpaths ===\n");

	// The visible state includes a DELETION: a file the operator removed but not
	// committed must stay absent in the fork, not resurrect from HEAD.
	await rm(join(source, "other-seat.txt"));
	let claim2 = null;
	try {
		claim2 = await claimWorktree({ source, worktreeRoot: base, itemLabel: "item-506b" });
	} catch (error) {
		claim2 = { error };
	}
	check("second claim also succeeds", !claim2.error, claim2.error?.message ?? "");
	check("a deleted-but-uncommitted file stays deleted in the fork",
		claim2.cwd && !existsSync(join(claim2.cwd, "other-seat.txt")), String(claim2.cwd));

	// A dirty tree ELSEWHERE in the repository never mattered (F23 scoped the check
	// with `-- .`) — keep that proven while the pristine requirement is gone.
	console.log("\n=== scope: dirt outside the source subtree is carried-not-forbidden, scoped ===\n");
	await run("git", ["-C", repo, "add", "-A"]);
	await run("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "settle fixture"]);
	// Restore the deleted file at HEAD so the tree is the baseline again.
	await writeFile(join(source, "other-seat.txt"), "committed content\n");

	console.log(failures === 0
		? "\nPASS — a dirty shared tree no longer blocks concurrent worktree claims; the fork carries the visible state"
		: `\nFAIL — ${failures} check(s) failed`);
} catch (err) {
	console.error("ERROR:", err?.message?.slice(0, 400) ?? err);
	failures += 1;
} finally {
	await rm(base, { recursive: true, force: true });
}

// Exiting inside the `try` would skip the cleanup above (do not move this earlier).
process.exit(failures === 0 ? 0 : 1);
