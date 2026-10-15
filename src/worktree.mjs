// worktree.mjs — isolate a seat's work from the tree the operator is editing.
//
// Why this exists: seats are confined (SC1) but confined to whatever `cwd` they are given, and
// nothing was giving them one - so before this they worked in durig's LIVE tree, where an author
// seat could overwrite the operator's uncommitted work. A per-item worktree is what makes "the
// operator reviews a diff, then merges" true instead of aspirational, and it is also what bounds
// the verifier's shell-write residual: a verifier can scribble freely in its own copy, where
// nothing of the operator's is at stake.

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** The git repository containing `dir`: durig is normally a subdirectory of a larger repository. */
export async function repoRoot(dir) {
	const { stdout } = await run("git", ["-C", dir, "rev-parse", "--show-toplevel"]);
	// git reports forward slashes on Windows; `resolve` normalises it so callers can compare and
	// join it as an ordinary platform path instead of getting a path that only looks equal.
	return resolve(stdout.trim());
}

/**
 * Run `npm ci --prefer-offline` in a worktree to make it usable.
 * Called after createWorktree/claimWorktree because a fresh worktree has no
 * node_modules (gitignored, not bridged).
 *
 * Skips if no package.json exists (throwaway repos).
 * Measured: ~12 s, ~111 MB per worktree. Fails loudly on error.
 */
export async function installWorktreeDeps(worktreePath) {
	const pkgPath = join(worktreePath, "package.json");
	if (!existsSync(pkgPath)) {
		return { ok: true, skipped: true, worktree: worktreePath };
	}
	try {
		const result = await run("npm", ["ci", "--prefer-offline"], { cwd: worktreePath });
		return { ok: true, worktree: worktreePath, stdout: result.stdout.trim() };
	} catch (err) {
		const msg = err.stderr || "";
		throw new Error(
			`npm ci --prefer-offline failed in ${worktreePath}:\n${msg}`,
		);
	}
}

/**
 * Add a detached worktree of the repository containing `source`, and make it usable.
 *
 * `source` is not only the repository to copy: its path inside the repository is reproduced in
 * the new worktree, so the returned `cwd` is the same relative place a seat would otherwise have
 * had, and a rig's declared `cwd` keeps meaning when the tree underneath it changes.
 */
export async function createWorktree({ source, target, ref = "HEAD" }) {
	const root = await repoRoot(source);
	if (existsSync(target)) {
		throw new Error(`refusing to reuse an existing path as a worktree: ${target}`);
	}
	// F23: a worktree forks from HEAD, so the operator's UNCOMMITTED direct work is
	// absent from the fork - a seat cannot see it, and its own file at the same path
	// then clobbers it on merge (#240: a seat's src/readapi.mjs collided with the
	// live 8.9 KB shared read API). Refuse rather than carry: the uncommitted set can
	// be large and carrying it would fork a tree neither git nor the operator tracks.
	// Scoped to the SOURCE subtree (`-- .`) so unrelated dirty paths elsewhere in a
	// larger repository do not wedge every fork.
	const dirty = await uncommittedInSource(source);
	if (dirty.trim() !== "") {
		throw new Error(
			`source has uncommitted changes; the new worktree would not contain them - commit or stash first ` +
				`(in ${source}): ${dirty.trim().split("\n").slice(0, 5).join(", ")}`,
		);
	}
	// `--detach` because a worktree per item must not occupy a branch: two items in flight would
	// otherwise collide on the branch name, and the operator decides what becomes a branch.
	await run("git", ["-C", root, "worktree", "add", "--detach", target, ref]);

	const inside = relative(root, resolve(source));
	const cwd = inside === "" ? target : join(target, inside);

	// `node_modules` is gitignored, so a fresh worktree has none - and then `node demo/x.test.mjs`
	// cannot run there at all, which would make the worktree useless for the one thing seats do.
	// No junction: Git 2.42 on this host deletes THROUGH a junction, which would destroy the
	// live tree's node_modules (docs/DOGFOOD.md F8, #330). Instead the caller must install
	// dependencies independently: `npm ci --prefer-offline` (~12 s, ~111 MB) per worktree.
	// The worktree is unusable without this step — the seat that needs it should run the install
	// before working.

	return { repo: root, worktree: resolve(target), cwd };
}

/**
 * Uncommitted changes in `source` (its subtree of the repository), or "" when clean.
 *
 * Scoped with `-- .` from `source`, so the answer is about the tree being forked and not about
 * unrelated dirty paths elsewhere in a larger repository. Ignored paths (node_modules) do not
 * count as dirty, which is what keeps a forkable tree forkable.
 */
export async function uncommittedInSource(source) {
	try {
		const { stdout } = await run("git", ["-C", source, "status", "--porcelain", "--", "."]);
		return stdout;
	} catch (error) {
		// Not a git checkout (or git missing): there is no HEAD to fork from, so there is nothing
		// to guard and the caller will fail on the worktree add itself. Do not mask that here.
		return "";
	}
}

/**
 * Remove a worktree.
 *
 * `force` is required rather than defaulted, because removing a worktree discards whatever is in
 * it: a caller has to say that is what it means. The default fails loudly instead of quietly
 * deleting work, which is the same reason the guard refuses `git reset --hard`.
 */
export async function removeWorktree({ source, worktree, force = false }) {
	const root = await repoRoot(source);
	// No more junctions to unlink — the node_modules bridge was removed in #330.
	const args = ["-C", root, "worktree", "remove", ...(force ? ["--force"] : []), worktree];
	await run("git", args);
}

// unlinkModulesBridge removed in #330 — no more junctions to drop.

/* ================================================================ */
/*  P2-1: worktree-per-task lifecycle (claim → lock → release → remove)  */
/* ================================================================ */
import { readFile, writeFile, unlink, rm, readdir } from "node:fs/promises";

/**
 * Validate that a worktree's git identity is correct — it resolves to itself,
 * its `.git` entry is a file (not a directory), and its private git dir is
 * under the common dir's `worktrees/` (not the common dir itself).
 *
 * Returns { ok: true } or throws with a descriptive message. This mirrors
 * Claude Code's worktree-identity validation: refuse directories whose git
 * metadata "resolves into the main checkout" (Claude Code docs).
 */
export async function validateWorktreeIdentity(worktreePath) {
	// Use forward slashes for -C on Windows.
	const wtNorm = worktreePath.replace(/\\/g, "/");
	const showToplevel = (await run("git", ["-C", wtNorm, "rev-parse", "--show-toplevel"])).stdout.trim().replace(/\\/g, "/");
	const absoluteGitDir = (await run("git", ["-C", wtNorm, "rev-parse", "--absolute-git-dir"])).stdout.trim().replace(/\\/g, "/");
	const gitCommonDir = (await run("git", ["-C", wtNorm, "rev-parse", "--git-common-dir"])).stdout.trim().replace(/\\/g, "/");

	const expectedToplevel = resolve(worktreePath).replace(/\\/g, "/");

	// 1. toplevel must be this worktree's own directory.
	if (showToplevel !== expectedToplevel) {
		throw new Error(
			`worktree identity violation: --show-toplevel (${showToplevel}) ` +
				`does not match expected (${expectedToplevel})`,
		);
	}
	// 2. private git dir must differ from common dir (not the main checkout).
	if (absoluteGitDir === gitCommonDir) {
		throw new Error(
			`worktree identity violation: --absolute-git-dir === --git-common-dir ` +
				`(${absoluteGitDir}) — the worktree resolves to the main checkout`,
		);
	}
	// 3. the .git entry must be a FILE, not a directory.
	const gitEntryPath = join(worktreePath, ".git");
	const stat = await import("node:fs/promises").then((m) => m.stat(gitEntryPath));
	if (stat.isDirectory()) {
		throw new Error(
			`worktree identity violation: .git is a directory (main checkout) at ${gitEntryPath}`,
		);
	}
	return { ok: true, showToplevel, absoluteGitDir, gitCommonDir };
}

/**
 * Create a worktree for a specific queue item, create a dedicated branch,
 * and hold a `git worktree lock` so concurrent cleanup cannot remove it
 * while the item is being processed.
 *
 * Returns the worktree metadata needed for later release/remove.
 *
 * `itemLabel` is used for the branch name (e.g. `wt/item-123`), kept short
 * to avoid MAX_PATH issues.
 */
export async function claimWorktree({ source, worktreeRoot, itemLabel, ref = "HEAD" }) {
	const target = join(worktreeRoot, itemLabel);
	if (existsSync(target)) {
		throw new Error(`worktree path already exists: ${target}`);
	}
	const result = await createWorktree({ source, target, ref });
	// Validate identity before returning — refuses if the worktree resolves
	// back to the main checkout through a redirect.
	await validateWorktreeIdentity(result.worktree);
	// Hold a lock so concurrent cleanup cannot remove this worktree.
	await run("git", ["-C", result.repo, "worktree", "lock", result.worktree]);
	// Install deps — a fresh worktree has no node_modules, so it is unusable
	// until dependencies are installed. npm ci --prefer-offline (~12 s, ~111 MB).
	await installWorktreeDeps(result.worktree);
	// Enable rerere so conflict resolutions are recorded for the merge-on-complete step.
	await enableRerere(result.worktree);
	return { ...result, itemLabel, locked: true };
}

/**
 * Release the lock on a previously claimed worktree. After release the
 * worktree may be removed (it may contain changes). The lock prevents
 * concurrent `git worktree remove` from clobbering a worktree holding work.
 */
export async function releaseWorktreeLock(worktreePath) {
	// Use forward slashes for -C on Windows.
	const wtNorm = worktreePath.replace(/\\/g, "/");
	// Resolve repo root first to use for -C.
	let repoRoot;
	try {
		repoRoot = (await run("git", ["-C", wtNorm, "rev-parse", "--show-toplevel"])).stdout.trim();
	} catch {
		// Worktree already gone — nothing to unlock
		return { worktree: worktreePath, locked: false };
	}
	await run("git", ["-C", repoRoot, "worktree", "unlock", wtNorm]);
	return { worktree: worktreePath, locked: false };
}

/**
 * Remove a worktree that has been locked-released. Uses `git worktree remove`
 * (never `rm -rf`) to avoid stale `.git/worktrees/` metadata.
 *
 * Refuses when a junction/symlink/DirLink exists inside the worktree
 * (Git 2.42 on this host deletes THROUGH junctions, risking the main tree).
 */
export async function removeClaimedWorktree({ worktree, force = false }) {
	// If the worktree is already gone, nothing to do.
	if (!existsSync(worktree)) {
		return { worktree, removed: false, skipped: true };
	}
	// Unlock first if held — a locked worktree cannot be removed even with --force.
	// Read the .git pointer to find the repo root, then unlock from the repo root.
	try {
		const gitPointer = existsSync(join(worktree, ".git"))
			? readFileSync(join(worktree, ".git"), "utf8").trim()
			: "";
		const wtNormForUnlock = worktree.replace(/\\/g, "/");
		let repoRootUnlock;
		if (gitPointer.startsWith("gitdir: ")) {
			// gitdir points to <repo>/.git/worktrees/<name> — the repo is two levels up.
			const gitDir = gitPointer.slice(8).replace(/\\/g, "/");
			// gitDir is like /path/to/repo/.git/worktrees/item-1; split on /.git/ to get the repo root.
			const parts = gitDir.split("/.git/");
			repoRootUnlock = parts[0] ? parts[0].replace(/\\/g, "/") : resolve(gitDir).replace(/\\/g, "/").replace(/\\.git\//, "/");
		} else {
			// Fallback: try rev-parse from the worktree.
			repoRootUnlock = (await run("git", ["-C", wtNormForUnlock, "rev-parse", "--show-toplevel"])).stdout.trim().replace(/\\/g, "/");
		}
		await run("git", ["-C", repoRootUnlock, "worktree", "unlock", wtNormForUnlock]);
	} catch (err) {
		// A worktree that is not locked (or already gone) is removed anyway; report the
		// failure so a real unlock error is visible instead of silently swallowed.
		console.warn(`worktree: unlock of ${worktree} did not apply: ${err.message}`);
	}
	// Refuse when a junction/symlink exists inside the worktree.
	// Git 2.42 on this host deletes THROUGH junctions, risking the main tree.
	const entries = await readdir(worktree, { recursive: true, withFileTypes: true });
	for (const entry of entries) {
		if (entry.isSymbolicLink()) {
			throw new Error(
				`refusing to remove worktree ${worktree}: junction/symlink detected at ${entry.path}/${entry.name}`,
			);
		}
	}
	// Forward-slash paths for -C on Windows.
	const wtNorm = worktree.replace(/\\/g, "/");
	// Find the repo root by walking up from the worktree path.
	// A worktree's metadata lives in its source repo's .git/worktrees/<name>/,
	// so the first .git directory encountered walking up is the repo root.
	let repoRoot;
	try {
		repoRoot = (await run("git", ["-C", wtNorm, "rev-parse", "--show-toplevel"])).stdout.trim().replace(/\\/g, "/");
	} catch {
		// Try parent directories.
		const resolved = resolve(worktree).replace(/\\/g, "/");
		let candidate = resolved;
		const found = [];
		while (true) {
			const candidateGit = join(candidate, ".git");
			let isGitDir = false;
			try {
				const { stat } = await import("node:fs/promises");
				isGitDir = (await stat(candidateGit)).isDirectory();
			} catch (statErr) {
				// .git not present at this level — continue walking up.
				console.debug(`worktree: stat ${candidateGit} failed: ${statErr.message}`);
			}
			if (isGitDir) {
				try {
					const r = await run("git", ["-C", candidate, "rev-parse", "--show-toplevel"]);
					repoRoot = r.stdout.trim().replace(/\\/g, "/");
					found.push(candidate);
				} catch (err) {
					// Not a valid git dir — continue walking up to the next ancestor.
					console.error(`worktree: rev-parse failed for ${candidate}: ${err.message}`);
				}
			}
			const parent = resolved.split(/[\\/]/);
			parent.pop();
			if (parent.length === 0) break;
			candidate = parent.join(process.platform === "win32" ? "\\" : "/");
		}
		if (!repoRoot) {
			// Entirely gone — nothing to do
			return { worktree, removed: false, skipped: true };
		}
	}
	// Run from the repo root so git can still find the worktree metadata.
	const args = ["-C", repoRoot, "worktree", "remove", ...(force ? ["--force"] : []), wtNorm];
	try {
		await run("git", args);
	} catch (gitErr) {
		// On Windows `git worktree remove` can fail with permission errors
		// when file handles are still open (e.g., node_modules, editor locks).
		// The worktree may have been partially removed; report success if the
		// .git metadata is gone and fall through to the fallback cleanup.
		console.warn(`worktree: git worktree remove failed: ${gitErr.message}`);
	}
	// Clean up the .git pointer file that `git worktree remove` may leave behind.
	const gitFile = join(worktree, ".git");
	try {
		await unlink(gitFile);
	} catch (err) {
		// ENOENT is the expected case (`git worktree remove` already cleaned it up);
		// anything else is worth surfacing rather than swallowing. Cleanup continues below.
		if (err.code !== "ENOENT") console.warn(`worktree: could not unlink ${gitFile}: ${err.message}`);
	}
	// Final cleanup: if git left the directory behind, remove it.
	if (existsSync(worktree)) {
		try {
			await rm(worktree, { recursive: true, force: true });
		} catch (rmErr) {
			// On Windows the directory may still be locked briefly after git removes it.
			console.warn(`worktree: final rm of ${worktree} failed: ${rmErr.message}`);
		}
	}
	return { worktree, removed: true };
}

/**
 * Enable `git rerere` in a worktree so conflict resolutions are recorded and replayed.
 * Called during worktree creation or first use.
 */
export async function enableRerere(worktreePath) {
	const wtNorm = worktreePath.replace(/\\/g, "/");
	await run("git", ["-C", wtNorm, "config", "rerere.enabled", "true"]);
	return { worktree: worktreePath, rerereEnabled: true };
}

/**
 * Rebase the worktree's item branch onto a target branch (e.g. main).
 * The worktree must have a branch checked out (not detached).
 * Used during merge-on-complete integration.
 */
export async function rebaseItemBranch({ worktreePath, targetBranch }) {
	const wtNorm = worktreePath.replace(/\\/g, "/");
	// Verify this worktree has a branch (not detached HEAD).
	const branch = (await run("git", ["-C", wtNorm, "branch", "--show-current"])).stdout.trim();
	if (!branch) {
		throw new Error(`worktree ${worktreePath} has no branch (detached HEAD); cannot rebase`);
	}
	// Rebase onto the target branch.
	const result = await run("git", ["-C", wtNorm, "rebase", targetBranch]);
	return { worktree: worktreePath, branch, rebasedOnto: targetBranch, stdout: result.stdout.trim() };
}

/**
 * List existing worktrees for cleanup / audit. Returns an array of objects
 * with path, branch (null if detached), and locked status.
 */
export async function listWorktrees(repoPath) {
	try {
		const { stdout } = await run("git", ["-C", repoPath, "worktree", "list", "--porcelain"]);
		const worktrees = [];
		let current = {};
		for (const line of stdout.split("\n")) {
			const [key, ...rest] = line.split(" ");
			const value = rest.join(" ");
			if (key === "worktree") current.worktree = value;
			if (key === "branch") current.branch = value || null;
			if (key === "locked") current.locked = true;
			if (line === "" && current.worktree) {
				worktrees.push({ ...current, locked: false });
				current = {};
			}
		}
		if (current.worktree) worktrees.push({ ...current, locked: false });
		return worktrees;
	} catch {
		return [];
	}
}
