// demo/worktree-carry-teardown.test.mjs — the CARRY/teardown collision (#2360).
//
// createWorktree's CARRY (#506 / ASK F) copies the source tree's VISIBLE dirty state into every
// fork. Teardown is clean-only (D60), so while the shared tree was dirty, a completed item's
// worktree was BORN dirty with foreign paths and could NEVER be removed — every completion leaked
// a tree and pinned its branch
// (docs/incidents/2026-10-19-worktree-carry-teardown-collision.md).
//
// The SEAT path (claimWorktree / prepareSeatWorkspace) now forks HEAD-CLEAN, so a completed item's
// worktree is removable even while the shared tree is dirty. CARRY stays available as an explicit
// OPT-IN (`carry: true`) for a direct caller that wants the anti-stale guarantee (#240).
//
// Failing-first: before the fix the seat fork carried the source's dirt and the teardown REFUSED.
// Run: node demo/worktree-carry-teardown.test.mjs  (exit 0 = pass)

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { claimWorktree, createWorktree, removeClaimedWorktree } from "../src/worktree.mjs";

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

/** `git status --porcelain` in `dir`, trimmed (empty = clean). */
async function porcelain(dir) {
	return (await run("git", ["-C", dir, "status", "--porcelain"])).stdout.trim();
}

const base = await mkdtemp(join(tmpdir(), "durig-carry-"));
const repo = join(base, "repo");
const source = join(repo, "durig");
try {
	await mkdir(source, { recursive: true });
	await writeFile(join(source, "tracked.txt"), "original\n");
	await run("git", ["init", "-q", repo]);
	await run("git", ["-C", repo, "add", "."]);
	await run("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);

	// The shared tree is DIRTY — a tracked edit plus an untracked file: the collision's input.
	await writeFile(join(source, "tracked.txt"), "the operator's uncommitted edit\n");
	await writeFile(join(source, "operator-scratch.mjs"), "// the operator's untracked work\n");
	check("the source tree is dirty before the fork", (await porcelain(source)) !== "", await porcelain(source));

	console.log("\nThe SEAT path forks HEAD-CLEAN even though the source is dirty");
	const wt = await claimWorktree({ source, worktreeRoot: repo, itemLabel: "item-1" });
	check("claimWorktree created the fork", existsSync(wt.worktree), wt.worktree);
	check(
		"the seat fork is BORN CLEAN (no carried foreign dirt)",
		(await porcelain(wt.worktree)) === "",
		`fork status: ${JSON.stringify(await porcelain(wt.worktree))}`,
	);

	console.log("\n...so a completed item's worktree CAN be torn down");
	const removed = await removeClaimedWorktree({ worktree: wt.worktree });
	check("the teardown removed the worktree", removed.removed === true, JSON.stringify(removed));
	check("the worktree path is gone", !existsSync(wt.worktree));

	console.log("\nThe source's uncommitted work is UNTOUCHED (the fork never moves it)");
	check(
		"the operator's tracked edit and untracked file are still in the shared tree",
		(await readFile(join(source, "tracked.txt"), "utf8")) === "the operator's uncommitted edit\n" &&
			existsSync(join(source, "operator-scratch.mjs")),
	);

	console.log("\nCARRY remains an explicit OPT-IN for a direct caller (anti-stale, #240)");
	const carriedTarget = join(repo, "item-carry");
	await createWorktree({ source, target: carriedTarget, carry: true });
	check(
		"an opt-in carry still copies the source's visible state into the fork",
		(await porcelain(carriedTarget)) !== "",
		`carry fork status: ${JSON.stringify(await porcelain(carriedTarget))}`,
	);

	console.log(failures === 0 ? "\nPASS — a seat fork is born clean, so its teardown works while the shared tree is dirty" : `\nFAIL — ${failures} check(s) failed`);
} catch (err) {
	console.error("ERROR:", err?.message?.slice(0, 500));
	failures += 1;
} finally {
	await rm(base, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
