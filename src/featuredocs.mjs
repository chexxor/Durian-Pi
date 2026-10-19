// The FEATURES-row drift signal, read out of git history.
//
// D62 / ROADMAP 46: every new or changed capability carries its own doc
// acceptance — the docs/FEATURES.md row — or the item records an explicit "no
// feature surface" note. The merge gate (docs/runbooks/merge.md, "Trust, but
// verify") enforces that by hand with a `git log --grep '^feat'` sweep; a prose
// gate drifts, so the sweep is turned into data here and judged by the `check`
// rule `feature-row-missing` (src/checkup.mjs).
//
// Like src/provenance.mjs this module only READS git: git is already the
// append-only, hash-chained change log, so the signal needs no new write path.
// It returns PLAIN VALUES so checkup stays a linter over data — the rule never
// runs a subprocess or touches the filesystem.
//
// Honesty rule (same as provenance): "no git / not a repository / no commits" is
// UNKNOWN, not clean. readFeatureDocs returns null and the rule is reported
// SKIPPED with its reason, never silently passed.
//
// Stated LIMITS (mirroring the merge.md block this replaces): only `feat`
// commits; only a same-commit touch of docs/FEATURES.md; a doc added in a LATER
// commit still reads as drift. A commit's "no feature surface" note is detected
// from its subject, or from a caller-supplied `notesById` map (item id -> true)
// when the note lives in the item rather than the commit message.

import { execFileSync } from "node:child_process";

/** The doc a shipped capability must carry a row in (D62). */
export const FEATURES_DOC = "docs/FEATURES.md";

/** Marker git log uses to start a commit record; chosen to be non-prose. */
const COMMIT_MARKER = "@@@";
/** Field separator inside a marker line (subject never contains a newline). */
const FIELD_SEP = "\x1f";

/**
 * Run git and return trimmed stdout, or null when git, the repository, or the
 * command is unavailable. Every failure mode collapses to null deliberately:
 * from a reader's point of view "I could not read this" is one state.
 */
function git(args, cwd) {
	try {
		return execFileSync("git", args, {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 10000,
			maxBuffer: 32 * 1024 * 1024,
		}).trim();
	} catch {
		return null;
	}
}

/**
 * The shared working tree's current branch, or null when git/the repository is
 * unavailable (the same UNKNOWN-not-clean rule as readFeatureDocs). A detached
 * HEAD reads as "" - both a feature branch and a detached HEAD are the
 * `shared-tree-on-main` condition: the shared tree must sit on the integration
 * branch, or a seat whose cwd fell back to it writes to a feature branch
 * (2026-10-19, devtools #2412 - docs/incidents/2026-10-17-seat-root-fallback-commit.md).
 */
export function readSharedTreeBranch({ root = process.cwd() } = {}) {
	return git(["branch", "--show-current"], root);
}

/**
 * Parse `git log --pretty=format:@@@%H<US>%s --name-only` output into the plain
 * entries `check` consumes. Pure, so the mapping is asserted without git.
 *
 * A marker line starts a commit; every following non-blank line is a path that
 * commit touched. `noSurfaceNote` is true when the subject says so, or when the
 * caller's `notesById` records it for the item id (`#N`) in the subject — the
 * gate's escape hatch, which lives in the item rather than the commit.
 *
 * @param {string} raw
 * @param {{notesById?: Record<string|number, boolean>}} [opts]
 * @returns {Array<{sha:string, subject:string, touchedFeatures:boolean, noSurfaceNote:boolean}>}
 */
export function parseFeatureLog(raw, { notesById = {} } = {}) {
	const entries = [];
	let current = null;
	for (const line of String(raw ?? "").split("\n")) {
		if (line.startsWith(COMMIT_MARKER)) {
			const rest = line.slice(COMMIT_MARKER.length);
			const sep = rest.indexOf(FIELD_SEP);
			current = {
				sha: sep === -1 ? rest : rest.slice(0, sep),
				subject: sep === -1 ? "" : rest.slice(sep + 1),
				files: [],
			};
			entries.push(current);
		} else if (current && line.trim() !== "") {
			current.files.push(line.trim());
		}
	}
	return entries.map((e) => {
		const id = /#(\d+)/.exec(e.subject);
		return {
			sha: e.sha,
			subject: e.subject,
			touchedFeatures: e.files.includes(FEATURES_DOC),
			noSurfaceNote:
				/no feature surface/i.test(e.subject) ||
				(id !== null && (notesById[id[1]] === true || notesById[Number(id[1])] === true)),
		};
	});
}

/**
 * Read the FEATURES-row drift signal from `root`'s git history.
 *
 * @param {object} [opts]
 * @param {string} [opts.root]   repository (or any dir inside it) to read
 * @param {string|null} [opts.since]  git `--since` bound, e.g. "2026-10-17" or "30 hours ago"
 * @param {Record<string|number, boolean>} [opts.notesById]  item id -> "no feature surface" note recorded
 * @returns {Array<object>|null} entries, or null when history could not be read
 */
export function readFeatureDocs({ root = process.cwd(), since = null, notesById = {} } = {}) {
	const args = [
		"-C",
		root,
		"log",
		"--no-color",
		`--pretty=format:${COMMIT_MARKER}%H${FIELD_SEP}%s`,
		"--name-only",
		"--grep=^feat",
	];
	if (since) args.push(`--since=${since}`);
	const raw = git(args, root);
	return raw === null ? null : parseFeatureLog(raw, { notesById });
}
