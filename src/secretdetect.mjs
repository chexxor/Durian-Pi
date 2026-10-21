// READ-SIDE secret DETECTION (lead #824 part b, item #828).
//
// durig cannot PREVENT a secret from reaching the store: the transcript writer
// lives inside pi-durable, and intercepting it would mean a second writer on the
// store the broker already owns — an A1 violation (the broker owns the store; a
// reader must never become a writer, D11/D24). What durig CAN do, read-only,
// through the same entry pages the TUI and `status`/`watch` already scan (D21),
// is DETECT: find secret-shaped content among the COMMITTED entries and raise an
// ATTENTION NOTICE.
//
// Discipline (the same one the config guard #700 uses): the notice NAMES WHERE
// the value landed and NEVER echoes the value. A detection surface that printed
// the secret would BE the leak it exists to report. So a finding carries the
// seat, the entry id, the location inside the entry, and a family label
// ("openai-key") — never the token.
//
// No write path, no scheduling: this module only reads entry pages a caller has
// already scanned. When prevention is impossible, detect and escalate (the same
// add-a-signal pattern as #145) — "we hope nobody echoes a key" becomes "if a
// key lands, we SEE it".

import { spawnSync } from "node:child_process";

import * as config from "./config.mjs";

// The value classifier. Reused from src/config.mjs (#700) when that export is
// present; otherwise the identical pattern vocabulary is applied locally, so
// detection works on a tree that predates the config guard and means exactly the
// same thing once it lands. "Secret-shaped" must have ONE definition across
// durig, so this list is a copy of #700's, not a second opinion.
const SECRET_VALUE_PATTERNS = [
	{ name: "openai-key", re: /^sk-[A-Za-z0-9_-]{16,}$/ },
	{ name: "huggingface-token", re: /^hf_[A-Za-z0-9]{16,}$/ },
	{ name: "github-pat", re: /^ghp_[A-Za-z0-9]{20,}$/ },
	{ name: "google-api-key", re: /^AIza[0-9A-Za-z_-]{20,}$/ },
	// Long high-entropy run: letters AND digits, no path separators, no spaces.
	{ name: "high-entropy-token", re: /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9+_=-]{40,}$/ },
];

function localLooksLikeSecret(value) {
	if (typeof value !== "string") return false;
	const v = value.trim();
	if (v.length < 16) return false;
	return SECRET_VALUE_PATTERNS.some((p) => p.re.test(v));
}

const looksLikeSecret =
	typeof config.looksLikeSecret === "function" ? config.looksLikeSecret : localLooksLikeSecret;

/**
 * The family label for a secret-shaped token, or null when it is not one. The
 * authoritative decision is `looksLikeSecret`; the family is best-effort
 * labelling for the notice ("openai-key"), never the value.
 */
function familyOf(token) {
	if (!looksLikeSecret(token)) return null;
	for (const p of SECRET_VALUE_PATTERNS) if (p.re.test(token)) return p.name;
	return "secret";
}

/* ── git-object echoes are NOT secrets (security #1620/#1712; lead #1660) ──
 * A transcript that quotes a branch tip (`HEAD=<sha>`, `pin <sha>`, `commit <sha>`) is the single
 * collision class that floods the notice — hundreds of secret-shaped locations, ONE class, ZERO key
 * material. The exclusion test is NOT "looks like 40 hex": a real secret can be pure-hex40. It is
 * "CONFIRMED a git object": a pure-hex run in a git-hash CONTEXT is probed with `git cat-file -e`,
 * and ONLY a confirmed object is excluded, so a hex-encoded secret that is not an object STILL FIRES.
 */
const HEX_OBJECT_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
// The words a git hash is quoted with in prose, immediately before the hash.
const GIT_HASH_CONTEXT_RE = /(?:\b(?:head|commit|commits|tree|blob|tag|parent|parents|merge|base|sha|sha1|sha256|rev|revision|pin|object|tip|checkout|at)\b\s*[:=]?\s*|->\s*)$/i;
// The `CTX=<hash>` / `CTX: <hash>` whole-chunk form (the token regex keeps `=`/`:` inside a token).
const GIT_HASH_PAIR_RE = /^(?:head|commit|tree|blob|tag|parent|merge|base|sha|sha1|sha256|rev|revision|pin|object|tip)\s*[:=]\s*([0-9a-f]{40}|[0-9a-f]{64})$/i;

const gitObjectMemo = new Map();
/**
 * Confirm a 40/64-hex string resolves as a git object in `cwd` — THE exclusion test (lead #1660).
 * Memoized per (cwd, hash). A failure (not a repo, no such object, no git) is "not confirmed", so
 * the token still fires — the fail-safe direction. Exported so a caller can reuse the probe.
 *
 * @param {string} hex a lowercase 40/64-hex string
 * @param {string} [cwd]
 * @returns {boolean}
 */
export function isGitObject(hex, cwd = process.cwd()) {
	const key = `${cwd}\u0000${hex}`;
	if (gitObjectMemo.has(key)) return gitObjectMemo.get(key);
	let ok = false;
	try {
		ok = spawnSync("git", ["cat-file", "-e", `${hex}^{object}`], { cwd, stdio: "ignore" }).status === 0;
	} catch {
		ok = false;
	}
	gitObjectMemo.set(key, ok);
	return ok;
}

/**
 * Is this candidate a CONFIRMED git-object echo (and therefore not a secret)? `probe` decides
 * objecthood (default: the real `git cat-file` check). A bare hex with NO git context is never an
 * echo — it is judged as a value on its own.
 */
function isGitObjectEcho(value, text, at, probe) {
	const pair = GIT_HASH_PAIR_RE.exec(value);
	const hex = pair ? pair[1] : HEX_OBJECT_RE.test(value) ? value : null;
	if (hex === null) return false;
	if (!pair && !GIT_HASH_CONTEXT_RE.test(text.slice(0, at))) return false;
	return probe(hex.toLowerCase()) === true;
}

// A candidate token is a run of characters with no whitespace, quotes, backticks
// or the brackets that delimit a value in prose or in JSON. `=` and `:` are NOT
// boundaries here — a high-entropy token may contain `=` (base64 padding) — so a
// `KEY=value` / `"key":"value"` assignment is split on the delimiter afterwards.
const TOKEN_RE = /[^\s"'`<>()[\]{},;]+/g;

// `KEY=value` and `key: value` carry the secret on the right-hand side; the whole
// chunk is tried first (so a padded base64 token is seen whole), then each RHS.
function candidateValues(raw, start) {
	const out = [];
	const push = (value, at) => {
		if (value) out.push({ value, at });
	};
	// Strip a trailing sentence period/bang/question so "…sk-XXXX." still reads
	// as the token, not as a token that merely contains it.
	const trimTail = (s) => s.replace(/[.!?]+$/, "");
	push(trimTail(raw), start);
	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i];
		if (ch === "=" || ch === ":") push(trimTail(raw.slice(i + 1)), start + i + 1);
	}
	return out;
}

/**
 * Secret-shaped tokens in one text segment.
 *
 * @param {string} text
 * @param {{isGitObject?: (hex: string) => boolean}} [opts] `isGitObject` decides whether a
 *   git-hash-context hex is a real git object; it defaults to the real `git cat-file -e` probe.
 *   Pass a stub to keep the call pure in a unit test.
 * @returns {Array<{offset:number, family:string}>} one entry per secret-shaped
 *   token, naming its character offset and family — NEVER the token itself.
 */
export function secretTokens(text, { isGitObject: probe = isGitObject } = {}) {
	const out = [];
	if (typeof text !== "string" || !text) return out;
	for (const m of text.matchAll(TOKEN_RE)) {
		const raw = m[0];
		const start = m.index ?? 0;
		if (isGitObjectEcho(raw, text, start, probe)) continue; // the whole chunk is `HEAD=<sha>` etc.
		for (const { value, at } of candidateValues(raw, start)) {
			if (isGitObjectEcho(value, text, at, probe)) break; // the RHS is a confirmed git object
			const family = familyOf(value);
			if (family) {
				out.push({ offset: at, family });
				break; // one hit per candidate chunk is enough to name the location
			}
		}
	}
	return out;
}

/**
 * The scannable text segments of one entry, each with a WHERE label. Mirrors the
 * entry shape src/rigstory.mjs normalizes: a plain string content (user/system),
 * or typed parts (assistant text/thinking, tool-call arguments).
 *
 * @param {{kind?:string, model?:unknown}} entry
 * @returns {Array<{where:string, text:string}>}
 */
export function entryTextSegments(entry) {
	const message = Array.isArray(entry?.model) ? entry.model[0] : null;
	if (!message) return [];
	if (typeof message.content === "string") {
		return [{ where: "content", text: message.content }];
	}
	const parts = Array.isArray(message.content) ? message.content : [];
	const segs = [];
	parts.forEach((part, i) => {
		if (typeof part?.text === "string") {
			segs.push({ where: `content[${i}].${part.type ?? "text"}`, text: part.text });
		} else if (part?.type === "toolCall") {
			let text = "";
			try {
				text = JSON.stringify(part.arguments ?? {});
			} catch {
				text = ""; // an unserializable argument is not a place a value is stored
			}
			segs.push({ where: `content[${i}].arguments`, text });
		}
	});
	return segs;
}

/**
 * Scan one seat's entry page for secret-shaped content. Findings name WHERE and
 * carry no value.
 *
 * @param {{name:string, conversationId:number|string}} seat
 * @param {Array<object>} entries one bounded page, as readSeatPages returns
 * @returns {Array<{seat:string, conversationId:number|string, entryId:number|string|null,
 *   entryKind:string|null, where:string, offset:number, family:string}>}
 */
export function scanEntriesForSecrets(seat, entries) {
	const findings = [];
	for (const entry of entries ?? []) {
		for (const seg of entryTextSegments(entry)) {
			for (const hit of secretTokens(seg.text)) {
				findings.push({
					seat: seat.name,
					conversationId: seat.conversationId,
					entryId: entry?.id ?? null,
					entryKind: entry?.kind ?? null,
					where: seg.where,
					offset: hit.offset,
					family: hit.family,
				});
			}
		}
	}
	return findings;
}

/**
 * Attention notices for the findings: one per seat, naming each location. The
 * detail NEVER contains the value.
 *
 * @param {Array<object>} findings from scanEntriesForSecrets
 * @param {{perSeat?:number}} [opts] how many locations to list per seat
 * @returns {Array<{scope:string, seat:string, kind:string, detail:string}>}
 */
export function secretNotices(findings, { perSeat = 3 } = {}) {
	const bySeat = new Map();
	for (const f of findings ?? []) {
		if (!bySeat.has(f.seat)) bySeat.set(f.seat, []);
		bySeat.get(f.seat).push(f);
	}
	const notices = [];
	for (const [seat, fs] of bySeat) {
		const shown = fs
			.slice(0, perSeat)
			.map(
				(f) =>
					`entry #${f.entryId ?? "?"} (${f.entryKind ?? "?"}) ${f.where}@${f.offset} [${f.family}]`,
			);
		const more = fs.length > shown.length ? `, +${fs.length - shown.length} more` : "";
		notices.push({
			scope: "seat",
			seat,
			kind: "secret_detected",
			detail:
				`secret-shaped value in committed store content: ${shown.join("; ")}${more}. ` +
				`The value is NOT shown here. Rotate the credential and treat the store as ` +
				`compromised (detection only — durig cannot prevent the write: the transcript ` +
				`writer is inside pi-durable).`,
		});
	}
	return notices;
}
