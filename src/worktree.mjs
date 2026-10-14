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
import { readlink, rmdir, symlink, unlink } from "node:fs/promises";
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
	// A junction rather than a symlink because Windows creates it without elevation; the packages
	// it links to resolve their own absolute paths back into durig's real vendor tree.
	const modules = join(cwd, "node_modules");
	if (!existsSync(modules) && existsSync(join(source, "node_modules"))) {
		await symlink(join(source, "node_modules"), modules, "junction");
	}

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
	// The bridge goes first, and this is not tidiness. A recursive delete of a worktree FOLLOWS a
	// junction into its target on Windows, so removing a worktree with a node_modules bridge
	// deletes durig's real node_modules - and, because those packages are themselves junctions
	// into vendor/pi-main, it reached the vendored tree as well (docs/DOGFOOD.md F8).
	await unlinkModulesBridge(root, source, worktree);
	const args = ["-C", root, "worktree", "remove", ...(force ? ["--force"] : []), worktree];
	await run("git", args);
}

/**
 * Drop the node_modules LINK, leaving its target alone.
 *
 * Refuses to continue if the link cannot be dropped, because proceeding to a recursive delete is
 * the one outcome worse than failing: the safe direction is to leave the worktree in place.
 */
async function unlinkModulesBridge(root, source, worktree) {
	const inside = relative(root, resolve(source));
	const cwd = inside === "" ? worktree : join(worktree, inside);
	const modules = join(cwd, "node_modules");
	try {
		await readlink(modules);
	} catch {
		// Absent, or a real directory that this module did not create. Either way there is no link
		// to drop, and deleting a real directory here would be the very hazard being avoided.
		return false;
	}
	const failures = [];
	// `unlink` removes a file link, `rmdir` a directory one (a junction is a directory): which one
	// applies depends on what the link is, so both are tried rather than guessed.
	for (const drop of [() => unlink(modules), () => rmdir(modules)]) {
		try {
			await drop();
			return true;
		} catch (error) {
			failures.push(error?.message ?? String(error));
		}
	}
	throw new Error(
		`refusing to remove ${worktree}: cannot unlink the node_modules bridge at ${modules} ` +
			`(${failures.join("; ")}) - removing the worktree now could delete that link's TARGET`,
	);
}
