// Config provenance: which revision of durig ran, and what was enabled.
//
// Why this exists (ROADMAP item 19): `metrics` can see that a measure moved but
// not what was live when it moved, so "I changed the config and the measure
// moved" is a coincidence rather than an inference. A rig is driven by a
// committed spec, so git is already the append-only change log — `security.sec`
// preferred exactly this over adding a store write path, because a write path
// would add a mutable, untrusted attribution surface while git is already
// append-only and hash-chained. This module therefore only READS.
//
// Three honesty rules, all of which the security position asked for:
//   - "no repository" is unknown, not clean. A published or vendored copy of
//     durig is not evidence that the tree was clean, it is absence of evidence.
//   - a dirty tree is a FLAG, because the revision then does not describe what
//     ran; printing a hash without it implies more than it can support.
//   - git authorship is not authentication. The revision identifies content,
//     not who wrote it, and nothing here should be read as a trust claim.

import { execFileSync } from "node:child_process";

/** The extension durig installs itself, so "the active set" is never empty and
 * a change in durig itself is visible as a change in what was live. */
export const BUILTIN_EXTENSION = "durig.router";

/**
 * Run git and return trimmed stdout, or null when git, the repository, or the
 * command is unavailable. Every failure mode collapses to null deliberately:
 * from a reader's point of view "I could not read this" is one state, and a
 * caller must not have to tell "no git installed" from "not a repository" to
 * report the provenance honestly.
 */
function git(args, cwd) {
	try {
		return execFileSync("git", args, {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 5000,
		}).trim();
	} catch {
		return null;
	}
}

/**
 * Read the repository revision and whether the working tree is dirty.
 *
 * `-- .` is load-bearing: durig is usually a subtree of a larger repository, so
 * an unscoped `git status` reports every sibling project's edits. Measured in
 * this repository: unscoped reported 92 changed paths while the durig subtree
 * reported 0 — a flag that is always true is worse than no flag. Scoping to the
 * working directory is what makes the answer about durig.
 *
 * Untracked files count as dirty (the default), because an untracked extension
 * module is genuinely part of the active set and is genuinely absent from the
 * revision. Gitignored files never appear, which is why rig databases and
 * `node_modules` do not make every reading dirty.
 *
 * @param {string} [cwd]
 * @returns {{revision: string|null, dirty: boolean|null, reason: string|null}}
 */
export function gitProvenance(cwd = process.cwd()) {
	const revision = git(["rev-parse", "--short", "HEAD"], cwd);
	if (!revision) {
		return {
			revision: null,
			dirty: null,
			reason: "no git revision (not a repository, or no commits yet)",
		};
	}
	const status = git(["status", "--porcelain", "--", "."], cwd);
	if (status === null) {
		return { revision, dirty: null, reason: "the working tree could not be read" };
	}
	return { revision, dirty: status.length > 0, reason: null };
}

/**
 * The active extension set: what was installed when a seat ran.
 *
 * `declared` is what the configuration names — the file paths in
 * `DURIG_EXTENSIONS`. Paths rather than loaded names because loading a module
 * executes it, and a read-only `metrics` query must not run arbitrary code to
 * report what it would have run.
 *
 * @param {string[]} declared
 * @returns {string[]}
 */
export function activeSet(declared = []) {
	return [BUILTIN_EXTENSION, ...declared];
}

/**
 * One line for a person. Kept pure so the wording is asserted in a test rather
 * than eyeballed, and so the dirty case cannot silently lose its warning.
 *
 * @param {{revision: string|null, dirty: boolean|null, reason: string|null}} provenance
 * @param {string[]} active
 */
export function formatProvenance(provenance, active) {
	const { revision, dirty, reason } = provenance ?? {};
	let where;
	if (revision === null || revision === undefined) {
		where = `rev unknown (${reason ?? "unavailable"})`;
	} else if (dirty === true) {
		where = `rev ${revision} DIRTY (uncommitted changes: this revision does not describe what ran)`;
	} else if (dirty === false) {
		where = `rev ${revision} clean`;
	} else {
		where = `rev ${revision}, tree unreadable (${reason ?? "unknown"})`;
	}
	return `config  ${where} · active: ${active.join(", ")}`;
}
