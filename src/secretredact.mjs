// secretredact.mjs — the durig-side IN-HARNESS redaction extension.
//
// Why here and not outside the harness: the transcript writer lives inside
// pi-durable, and a durig-side interception of the store write would make durig a
// SECOND writer on the store the broker already owns — an A1 violation. The one
// sanctioned seam is pi-durable's OWN hook API: `hook(ToolTask, { afterTool })`
// runs INSIDE the single harness process, AFTER a tool executes and BEFORE its
// result entry is COMMITTED, and its return value REPLACES the result
// (dist/harness/tool.js `finalResult`: it resolves the retained output into
// `content`, then runs `afterTool`, then commits). So a secret-bearing tool
// result (e.g. `read .env`, `cat ~/.aws/credentials`) is redacted at the commit
// boundary and the model, the transcript and the store all see the redacted text.
//
// This is the SIBLING of src/seatguard.mjs: same module, same `hook(ToolTask, …)`
// surface, the `afterTool` half rather than the `beforeTool` half.
//
// Discipline (identical to the config guard #700 and the read-side detection
// #828): the redaction NAMES WHERE (tool + the path/command argument + the result
// slot) and NEVER echoes the value. A redaction that printed the secret would BE
// the leak it exists to remove. Detection (#828) watches COMMITTED entries;
// this redacts BEFORE the entry exists — they are complementary, not alternatives.

import * as config from "./config.mjs";

// The value classifier. Reused from src/config.mjs (#700) when that export is
// present; otherwise the identical pattern vocabulary is applied locally, so
// redaction works on a tree that predates the config guard and means exactly the
// same thing once it lands. "Secret-shaped" must have ONE definition across
// durig. (When #700 lands, the local copy below becomes dead fallback and the
// shared export takes over; see the item note.)
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

/** The family label for a secret-shaped token, or null. Authoritative decision is
 * `looksLikeSecret`; the family is best-effort labelling for the marker. */
function familyOf(token) {
	if (!looksLikeSecret(token)) return null;
	for (const p of SECRET_VALUE_PATTERNS) if (p.re.test(token)) return p.name;
	return "secret";
}

// A candidate token is a run of characters with no whitespace, quotes, backticks
// or brackets. `=` and `:` are NOT boundaries (a base64 token may contain `=`),
// so a `KEY=value` assignment is split on the delimiter afterwards.
const TOKEN_RE = /[^\s"'`<>()[\]{},;]+/g;

/**
 * Secret-shaped token SPANS in one text, so a caller can replace exactly the
 * value (never the surrounding punctuation). Returns `{start, end, family}` per
 * hit — never the token text.
 */
export function secretSpans(text) {
	const out = [];
	if (typeof text !== "string" || !text) return out;
	const tail = (s) => s.replace(/[.!?]+$/, "");
	for (const m of text.matchAll(TOKEN_RE)) {
		const raw = m[0];
		const start = m.index ?? 0;
		const push = (value, at) => {
			const family = familyOf(value);
			if (family) out.push({ start: at, end: at + value.length, family });
			return family !== null;
		};
		// The whole chunk first (so a padded base64 token is seen whole), then the
		// trailing-punctuation-trimmed form, then each `KEY=value`/`key:value` RHS.
		if (push(raw, start)) continue;
		const t = tail(raw);
		if (t !== raw && push(t, start)) continue;
		for (let i = 0; i < raw.length; i++) {
			const ch = raw[i];
			if (ch === "=" || ch === ":") {
				const rhs = raw.slice(i + 1);
				if (push(rhs, start + i + 1)) break;
				const rt = tail(rhs);
				if (rt !== rhs && push(rt, start + i + 1)) break;
			}
		}
	}
	return out;
}

/**
 * A safe locator for the tool call: the tool name plus a path-like argument (or
 * a command), named only when it carries no secret-shaped token of its own — so
 * the WHERE we print can never itself echo a value. Returns a suffix string.
 */
export function callLocator(call) {
	const args = call?.arguments ?? {};
	const keys = ["path", "file", "filePath", "filename", "target", "dir", "cwd", "command"];
	for (const key of keys) {
		const v = args[key];
		if (typeof v === "string" && v.length > 0 && secretSpans(v).length === 0) {
			return ` (${key}=${v})`;
		}
	}
	return "";
}

/** The inline marker that replaces a secret token: names WHERE and the family,
 * never the value. */
export function redactionMarker(call, family) {
	return `[redacted by durig: secret-shaped value (${family}) from tool ${call?.name ?? "?"}${callLocator(call)}]`;
}

/** Replace every secret-shaped token in one string with its marker. */
export function redactText(text, call) {
	const spans = secretSpans(text);
	if (spans.length === 0) return text;
	let out = text;
	for (let i = spans.length - 1; i >= 0; i--) {
		const s = spans[i];
		out = out.slice(0, s.start) + redactionMarker(call, s.family) + out.slice(s.end);
	}
	return out;
}

/**
 * The `afterTool` hook: replace a secret-bearing tool result BEFORE it is
 * committed. Returns `undefined` when nothing changed (the harness keeps the
 * original), or a new result with the redacted content. Non-text parts (images)
 * are preserved untouched.
 */
export function afterTool(call, result) {
	if (result === null || typeof result !== "object") return undefined;
	// pi-durable RENAMED the tool-result payload from `content` to `output` on
	// pi's main branch (the pin durig is validated against; pi-main.pin.json,
	// "a tool-result rename that breaks durig's tools"). The harness's
	// `finalResult` builds `final.output` and reads the afterTool return value's
	// `output` back, so an `afterTool` that writes `content` alone has its
	// redaction DROPPED and the raw secret is committed (#1610). Redact every
	// payload field the result actually carries and replace it in the SAME field,
	// so the hook works against both the released `content` shape and the pinned
	// `output` shape (and a tool that returns both, as the demo's does).
	let changed = false;
	const next = { ...result };
	for (const field of ["output", "content"]) {
		const payload = result[field];
		if (typeof payload === "string") {
			const redacted = redactText(payload, call);
			if (redacted !== payload) {
				next[field] = redacted;
				changed = true;
			}
			continue;
		}
		if (!Array.isArray(payload)) continue;
		let partChanged = false;
		const out = payload.map((part) => {
			if (part?.type !== "text" || typeof part.text !== "string") return part;
			const redacted = redactText(part.text, call);
			if (redacted === part.text) return part;
			partChanged = true;
			return { ...part, text: redacted };
		});
		if (partChanged) {
			next[field] = out;
			changed = true;
		}
	}
	return changed ? next : undefined;
}

// The hook is REGISTERED by src/seatguard.mjs, as the sibling `afterTool` binding
// on the already-installed `durig.guard` extension: the cli.mjs install site
// (`openHarness`) is the only place a registry is built, and that file carries
// another item's uncommitted work, so composing the hook into the existing
// installed extension is what makes the redaction ACTIVE today. When the cli.mjs
// install site is free, this can be split into its own `durig.secret-redactor`
// extension with a one-line install.
