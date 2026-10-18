// seatroot.mjs — name the tree a seat is ACTUALLY in (DOGFOOD F21 / #253).
//
// F21: a VERIFIER mistook its ISOLATED item worktree for the LIVE tree, so its judgement about
// "the live tree" was wrong and misleading. The fix is a SURFACE, not a guess: a seat asks and is
// told its resolved root, whether that root is the main checkout or a linked worktree, and —
// loudly — when `DURIG_SEAT_ROOT` disagrees with the root the seat actually resolved.
//
// This is the ONE definition of the resolution chain the F12 guard (cli.mjs), `makeSeatEnv`
// (seattools.mjs) and the write guard (seatguard.mjs) all rely on:
//
//   persisted seat cwd  ->  DURIG_SEAT_ROOT  ->  this process's cwd
//
// It lives here so those callers cannot drift apart (the item's "reuse that seam rather than
// forking"). The persisted seat cwd is the seat's OWN agent cwd (what `prepare_workspace` writes
// via `configure`); it wins over the process-global `DURIG_SEAT_ROOT`, which is only a fallback
// for a seat that never prepared a workspace.

import { statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Resolve a seat's root through the shared chain.
 *
 * `null`/`undefined` mean "unset" (the `??` semantics `makeSeatEnv` used); an empty string is a
 * value like any other and is returned unchanged, so this cannot silently change a caller's
 * behaviour.
 */
export function resolveSeatRoot({ persistedCwd, env = process.env, fallbackRoot = process.cwd() } = {}) {
	if (persistedCwd !== undefined && persistedCwd !== null) return { root: persistedCwd, source: "persisted seat cwd" };
	if (env.DURIG_SEAT_ROOT) return { root: env.DURIG_SEAT_ROOT, source: "DURIG_SEAT_ROOT" };
	return { root: fallbackRoot, source: "process cwd" };
}

/** Are two roots the same directory on this host? Windows paths are case- and separator-insensitive. */
export function sameRoot(a, b) {
	const norm = (p) => resolve(String(p)).replace(/[\\/]+$/, "").toLowerCase();
	return norm(a) === norm(b);
}

/**
 * Which kind of git tree `root` sits in, decided by the NEAREST `.git`:
 *   - a DIRECTORY -> the main checkout;
 *   - a FILE      -> a linked worktree (its `.git` is a gitdir pointer) — an ISOLATED tree;
 *   - none found  -> not a git tree.
 *
 * Walking up from `root` covers a seat rooted at a subdirectory of its repo. Cheap and
 * dependency-free: no `git` subprocess, so it cannot fail on a host without git.
 */
export function classifyGitRoot(root) {
	let dir = resolve(String(root));
	for (;;) {
		try {
			return statSync(join(dir, ".git")).isDirectory() ? "main-worktree" : "linked-worktree";
		} catch {
			// no `.git` here: keep walking toward the filesystem root.
		}
		const parent = dirname(dir);
		if (parent === dir) return "not-a-git-tree";
		dir = parent;
	}
}

/**
 * The report a seat reads back from `seat_root`.
 *
 * Deliberately LOUD about the two ways F21 goes wrong: the root is an isolated worktree, or
 * `DURIG_SEAT_ROOT` disagrees with what the seat resolved (the same disagreement the F12
 * write-side guard fails closed on).
 */
export function describeSeatRoot({ persistedCwd, env = process.env, fallbackRoot = process.cwd() } = {}) {
	const { root, source } = resolveSeatRoot({ persistedCwd, env, fallbackRoot });
	const shown = resolve(String(root));
	const kind = classifyGitRoot(root);
	const note =
		kind === "linked-worktree"
			? " (an ISOLATED worktree — this is NOT the live tree)"
			: kind === "main-worktree"
				? " (the main checkout)"
				: " (not a git tree)";
	const lines = [`SEAT ROOT: ${shown}`, `  source: ${source}`, `  tree: ${kind}${note}`];
	if (env.DURIG_SEAT_ROOT && !sameRoot(env.DURIG_SEAT_ROOT, root)) {
		lines.push(
			`  MISMATCH: DURIG_SEAT_ROOT=${env.DURIG_SEAT_ROOT} differs from this seat's resolved root ${shown}` +
				" — a write-side command (send/run) fails closed on this; fix it with `up --refresh` or unset DURIG_SEAT_ROOT",
		);
	}
	return lines.join("\n");
}
