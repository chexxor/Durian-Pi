// worktree.mjs — isolate a seat's work from the tree the operator is editing.
//
// Why this exists: seats are confined (SC1) but confined to whatever `cwd` they are given, and
// nothing was giving them one - so before this they worked in durig's LIVE tree, where an author
// seat could overwrite the operator's uncommitted work. A per-item worktree is what makes "the
// operator reviews a diff, then merges" true instead of aspirational, and it is also what bounds
// the verifier's shell-write residual: a verifier can scribble freely in its own copy, where
// nothing of the operator's is at stake.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
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
