// src/gitobject.mjs — the ONE git-object verdict the two secret surfaces share (#3128).
//
// WHY THIS MODULE EXISTS. Two surfaces classify the same text and were giving different answers
// about the same token:
//   * src/secretredact.mjs (`afterTool`, the in-harness redactor that rewrites a tool result
//     before pi-durable commits it) had NO git-object test at all — it applied config's
//     "letters AND digits, 40+" rule to everything.
//   * src/secretdetect.mjs (the read-side detector, #828/#1620/#1712) had one, but only for a hex
//     sitting in a git-hash CONTEXT (`HEAD=<sha>`, `commit <sha>`), and it was declared locally.
// Measured on this tree before the change: every commit id in every ref classifies as secret-shaped
// in the redactor (git rev-list --all -> 2516 ids, all 2516 match), and a 40-line
// `git log --format=%H %s` produces 40 injected markers. So a seat cannot read a sha out of a tool
// result — including the `evidence.artifact` field the constitution requires a completion to name
// (#4147/#4154), and any queue body that carries a patch id.
//
// THE RULE (lead #2040 ruling A, #1660): shape never exempts, context never exempts. A 40/64-hex
// token is exempt ONLY when `git cat-file -e <id>^{object}` confirms it resolves in this repo. A
// hex-encoded credential that is not an object STILL FIRES — that is the canary, and it is asserted
// in demo/sha-object-verdict.test.mjs.
//
// THE BUDGET (security position P-4): a probe is a subprocess. A pathological tool result
// (`git cat-file --batch-all-objects`, a packed-refs dump) would turn one tool call into thousands
// of spawns. Distinct candidates are counted first; over the cap nothing is exempted — the token is
// redacted. Unverifiable means redact, never pass.

import { spawnSync } from "node:child_process";

/** A full git object name: 40 hex (SHA-1) or 64 hex (SHA-256). */
export const HEX_OBJECT_SHAPE_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

/** The `CTX=<hash>` / `CTX: <hash>` chunk form, e.g. `HEAD=<sha>` or `base: <sha>`. */
export const GIT_HASH_PAIR_RE =
	/^(?:head|commit|commits|tree|blob|tag|parent|parents|merge|base|sha|sha1|sha256|rev|revision|pin|object|tip|checkout|at)\s*[:=]\s*([0-9a-f]{40}|[0-9a-f]{64})$/i;

/** A git id quoted in prose: "commit <sha>", "pin <sha>", "… -> <sha>". */
export const GIT_HASH_CONTEXT_RE =
	/(?:\b(?:head|commit|commits|tree|blob|tag|parent|parents|merge|base|sha|sha1|sha256|rev|revision|pin|object|tip|checkout|at)\b\s*[:=]?\s*|->\s*)$/i;

/** How many DISTINCT object probes one tool result may spend. An ordinary `git log` surfaces a
 * handful; a pathological dump surfaces thousands. Over this, everything redacts. */
export const MAX_OBJECT_PROBES_PER_PASS = 64;

/** The family label for a hex-shaped token that we could not confirm as an object (P-5): the
 * marker says WHY the value vanished, so a reader can re-read it through a ref name. */
export const UNCONFIRMED_OBJECT_FAMILY = "unconfirmed-object";

/** The git object id inside a candidate token, or null if the token is not one. */
export function objectIdOf(token) {
	if (typeof token !== "string" || token.length === 0) return null;
	const pair = GIT_HASH_PAIR_RE.exec(token);
	if (pair) return pair[1].toLowerCase();
	if (HEX_OBJECT_SHAPE_RE.test(token)) return token.toLowerCase();
	// Any `key=<hex>` / `key: <hex>` chunk carries the candidate on the right-hand side; without this,
	// the whole chunk (e.g. `artifact=<sha>`) is classified as a generic high-entropy run and the id
	// is eaten even though it resolves.
	const tail = /[=:]\s*([0-9a-f]{40}|[0-9a-f]{64})$/i.exec(token);
	return tail ? tail[1].toLowerCase() : null;
}

const globalMemo = new Map();

/**
 * Confirm a 40/64-hex string resolves as a git object in `cwd`. Memoized per (cwd, id). Any
 * failure — not a repo, no such object, no git binary, spawn error — is "not confirmed", so the
 * token is judged as a value on its own. That is the fail-safe direction.
 */
export function isGitObject(hex, cwd = process.cwd()) {
	const key = `${cwd}\u0000${String(hex).toLowerCase()}`;
	if (globalMemo.has(key)) return globalMemo.get(key);
	let ok = false;
	try {
		ok = spawnSync("git", ["cat-file", "-e", `${String(hex).toLowerCase()}^{object}`], { cwd, stdio: "ignore" }).status === 0;
	} catch {
		ok = false;
	}
	globalMemo.set(key, ok);
	return ok;
}

/**
 * The verdict on ONE token. Returns `{exempt, family, reason}`:
 *   exempt  — the token is a confirmed git object; neither surface touches it;
 *   family  — what to call it if it is NOT exempt: UNCONFIRMED_OBJECT_FAMILY for a hex we could
 *             not confirm, otherwise the credential family from the shape table.
 * `isGitObject` is injectable so a demo asserts both sides without touching git.
 */
export function gitObjectVerdict(token, { isGitObject: probe = isGitObject, budget = MAX_OBJECT_PROBES_PER_PASS, candidates = null } = {}) {
	const id = objectIdOf(token);
	if (id === null) return { exempt: false, family: null, reason: "not a git object id" };
	const count = candidates === null ? countObjectCandidates(String(token)) : candidates;
	if (count > budget) return { exempt: false, family: UNCONFIRMED_OBJECT_FAMILY, reason: `probe budget ${budget} exceeded (${count} candidates)` };
	return probe(id)
		? { exempt: true, family: null, reason: "confirmed git object" }
		: { exempt: false, family: UNCONFIRMED_OBJECT_FAMILY, reason: "hex that does not resolve as an object in this repo" };
}

/**
 * Build the per-text checker a surface uses. It counts the distinct candidates ONCE (so a 40-line
 * `git log` does not re-scan the text per token), memoizes each probe, and refuses to exempt
 * anything once the budget is gone. Both surfaces call this, which is the whole point: they cannot
 * disagree about the same token.
 */
export function objectExemptor(text, { isGitObject: probe = isGitObject, budget = MAX_OBJECT_PROBES_PER_PASS } = {}) {
	const candidates = countObjectCandidates(text);
	const overBudget = candidates > budget;
	const memo = new Map();
	return (token) => {
		const id = objectIdOf(token);
		if (id === null) return false;
		if (overBudget) return false; // fail-closed: unprobeable ⇒ redact
		if (!memo.has(id)) memo.set(id, probe(id) === true);
		return memo.get(id);
	};
}

/** How many distinct full git-object ids a text contains. Counted before any probe is spent. */
export function countObjectCandidates(text) {
	const seen = new Set();
	for (const m of String(text ?? "").matchAll(/[0-9a-f]{40}|[0-9a-f]{64}/gi)) seen.add(m[0].toLowerCase());
	return seen.size;
}
