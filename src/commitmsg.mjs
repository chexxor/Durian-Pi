// The COMMIT-MESSAGE encoding signal, read out of git history (#4349).
//
// WHY A CHECK AND NOT A NOTE: four commits in one session carried a UTF-8 BOM in the subject
// because PowerShell's `Set-Content -Encoding utf8` writes one. Each was caught, rewritten and
// amended — and each time the fix was the same sentence ("stop reaching for Set-Content"). The
// sentence is correct and it is not enough: FOUR CATCHES IS NOT A CATCH RATE, IT IS A MECHANISM
// THAT DOES NOT EXIST. The reason it kept slipping is the reason a check is the right shape — A BOM
// IS INVISIBLE IN EVERY NORMAL VIEW: `git log --oneline` renders it, `git show` renders it, the
// author sees a clean subject, and it surfaces only in a byte-level read.
// A FIFTH subject (30270c0) was NOT amended and IS in history — recorded as a known-reds baseline
// (docs/STATUS.md); the rule's job is BOTH to stop the next one AND to keep finding this one until
// the operator deals with it.
//
// Like src/featuredocs.mjs this module only READS git and returns PLAIN VALUES, so `check` stays a
// linter over data (the rule never runs a subprocess or touches the filesystem).
//
// Honesty rule (same as featuredocs/provenance): "no git / not a repository / no commits" is
// UNKNOWN, not clean. readCommitMessages returns null and the rule is reported SKIPPED with its
// reason, never silently passed.
//
// THREE SURFACES, kept distinct rather than overlapped (#4304/#4305): #4304 guards the WRITE (a
// shell redirect into the shared tree), #4305 detects a bad FILE in the tree, and THIS checks the
// COMMIT MESSAGE, which is neither a file write nor a file in the tree. No half-overlap: the rule
// here reads commit objects only.
//
// STATED LIMIT: a bounded RANGE (the most recent `limit` commits), because the whole history is not
// the point — the point is that a BOM cannot enter unnoticed. A message already in history beyond
// the range is out of scope; this is a gate on new work, not a historical sweep. CORRECTED
// 2026-10-21 (#4692): the premise that "the four BOM subjects were amended and are gone from history"
// is WRONG — there are FIVE subjects, FOUR amended, ONE (30270c0) still in history and recorded as a
// baseline. The rule is CORRECT and its documented scope was the error: its job is both to stop the
// next one AND to keep finding this one until it is dealt with.

import { execFileSync } from "node:child_process";

/** The UTF-8 BOM, as it decodes into a JS string (git gives us utf8 text, not bytes). */
export const BOM = "\uFEFF";

/** Record/field separators for the log format; both are non-prose, so parsing is unambiguous. */
const RECORD_SEP = "\x1e";
const FIELD_SEP = "\x1f";

/**
 * Run git and return raw stdout, or null when git, the repository, or the command is unavailable.
 * Every failure mode collapses to null deliberately: "I could not read this" is one state.
 */
function git(args, cwd) {
	try {
		return execFileSync("git", args, {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 10000,
			maxBuffer: 32 * 1024 * 1024,
		});
	} catch {
		return null;
	}
}

/**
 * The defects in ONE commit message. Pure, so the mapping is asserted without git.
 *
 * A BOM is checked at the START of the subject (the reported case: it renders as nothing and hides
 * in the SHA line) AND anywhere a line starts in the body — a body BOM corrupts a `Co-authored-by`
 * trailer or a `Fixes #N` line, where the parser is strict. NUL and a stray CR are checked in both
 * fields for the same reason: they are invisible and they break a strict reader.
 *
 * @param {{subject?:string, body?:string}} msg
 * @returns {Array<{field:"subject"|"body", kind:"BOM"|"BOM-in-line"|"NUL"|"CR"}>}
 */
export function messageDefects({ subject, body } = {}) {
	const s = String(subject ?? "");
	const b = String(body ?? "");
	const defects = [];
	if (s.startsWith(BOM)) defects.push({ field: "subject", kind: "BOM" });
	if (s.includes("\u0000")) defects.push({ field: "subject", kind: "NUL" });
	if (s.includes("\r")) defects.push({ field: "subject", kind: "CR" });
	if (b.startsWith(BOM) || new RegExp(`(^|\\n)${BOM}`).test(b)) defects.push({ field: "body", kind: "BOM-in-line" });
	if (b.includes("\u0000")) defects.push({ field: "body", kind: "NUL" });
	if (b.includes("\r")) defects.push({ field: "body", kind: "CR" });
	return defects;
}

/**
 * Parse `git log --pretty=format:@@@%H<US>%s<US>%b<RS>` output into plain entries. Pure.
 * The body keeps its own newlines; a record ends at RECORD_SEP.
 *
 * @param {string} raw
 * @returns {Array<{sha:string, subject:string, body:string}>}
 */
export function parseCommitMsgLog(raw) {
	const out = [];
	for (const chunk of String(raw ?? "").split(RECORD_SEP)) {
		const at = chunk.indexOf("@@@");
		if (at === -1) continue;
		const rest = chunk.slice(at + 3);
		const first = rest.indexOf(FIELD_SEP);
		if (first === -1) continue;
		const second = rest.indexOf(FIELD_SEP, first + 1);
		const sha = rest.slice(0, first);
		const subject = second === -1 ? rest.slice(first + 1) : rest.slice(first + 1, second);
		const body = second === -1 ? "" : rest.slice(second + 1);
		out.push({ sha, subject, body: body.replace(/\n+$/, "") });
	}
	return out;
}

/**
 * Read the most recent commit messages from `root`'s git history.
 *
 * @param {object} [opts]
 * @param {string} [opts.root]  repository (or any dir inside it) to read
 * @param {number} [opts.limit] how many recent commits to inspect (default 50)
 * @returns {Array<{sha:string, subject:string, body:string}>|null} entries, or null when unreadable
 */
export function readCommitMessages({ root = process.cwd(), limit = 50 } = {}) {
	const raw = git(
		["-C", root, "log", "--no-color", `-n${limit}`, `--pretty=format:@@@%H${FIELD_SEP}%s${FIELD_SEP}%b${RECORD_SEP}`],
		root,
	);
	return raw === null ? null : parseCommitMsgLog(raw);
}
