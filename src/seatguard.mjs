// seatguard.mjs — the durig-side tool-call guard.
//
// Why this exists at all: the operator accepted "full shell" believing pi's own guards covered
// seats. They do not. `arg-guard.js` and `guardrails.json` are pi-CODING-AGENT extensions
// (`pi.on('tool_call', ...)`), durig loads pi-DURABLE extensions only (src/extensions.mjs:17),
// and the harness durig opened passed no hooks at all. This is that guard, built on
// pi-durable's own hook (D38).
//
// What it is NOT: the boundary. A check on a command STRING is unsound by nature - PowerShell
// defeats any allowlist through aliases, `-EncodedCommand` and piped subcommands - so this
// narrows what is already confined, while `src/confine.mjs` is the boundary. Both, not either
// (the security position's F4).

import { AgentDoc, ToolTask, defineExtension, hook } from "@earendil-works/pi-durable";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve as resolveNodePath } from "node:path";
import { refusalFor } from "./confine.mjs";
import { SECRET_PREFIX_PATTERNS } from "./config.mjs";

/** pi-durable's own write-path normalization (tools/path-utils.js): unicode
 * spaces collapse to a plain space and a leading "@" booking prefix is dropped,
 * so the guard's peek resolves the SAME path the write tool will. */
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

/** Resolve a write call's path where the write will LAND. `root` is the seat's
 * own tree; absolute arguments stand as passed (that is what the env does),
 * relative ones resolve against it. */
function absoluteSeatPath(root, path) {
	let normalized = String(path).replace(UNICODE_SPACES, " ");
	if (normalized.startsWith("@")) normalized = normalized.slice(1);
	return isAbsolute(normalized) ? normalized : resolveNodePath(root, normalized);
}

/** The tree a seat's writes resolve against, in the SAME chain `makeSeatEnv` and
 * harness `buildEnv` use: the seat's persisted agent cwd (what `prepare_workspace`
 * writes via `configure`), then `DURIG_SEAT_ROOT`, then this process's cwd.
 * A snapshot that cannot be served leaves the fallback — fail-open, never
 * blocking a write because the guard's own read hiccuped. */
async function seatGraphRoot(api, context) {
	if (api?.conversationId !== undefined && typeof api?.snapshot === "function") {
		try {
			const agent = await api.snapshot(AgentDoc, api.conversationId, context);
			if (agent?.cwd !== undefined) return agent.cwd;
		} catch (err) {
			// fail-open: keep the fallback root, but report the cause rather than swallow it.
			console.error(`SEATGUARD WARNING: seat cwd snapshot failed, using fallback root: ${err?.message ?? err}`);
		}
	}
	return process.env.DURIG_SEAT_ROOT ?? process.cwd();
}

/** Tools whose whole argument is a command string, so that string is what to inspect. */
const SHELL_TOOLS = new Set(["bash", "powershell"]);

/**
 * Refuse a call, or let it through.
 *
 * `ToolHookCall.parent` is set for a nested call - one a running tool made through
 * `executeTool()`, which is how a codemode script reaches any tool - so this covers those too,
 * which a coding-agent `tool_call` event could not.
 */
const MIN_SUSPICIOUS_LENGTH = 400;
const MIN_SUSPICIOUS_LINES = 12;

/**
 * #673: the write tool's corruption refusal.
 *
 * The observed incident: a file-write call handed `write` the ENTIRE serialized
 * payload of a source file as ONE LINE (an accidental `Set-Content`-style
 * serialization — cli.mjs, in the #623 incident). The overwrite is REAL (no
 * error), and the seat keeps working on a file that is now unreadable junk —
 * the failure is invisible until somebody opens the file.
 *
 * Durig's bound: a source file's file-write payload is EXPECTED to be
 * multi-line. A single-line, full-file-length payload against a pre-existing
 * source file is what a serialization accident looks like, so the refusal is
 * worded for the recovery that an overwrite erased: recover from git (the file
 * survives in the working tree's HEAD), NOT by re-writing the same content.
 */
const SERIALIZATION_RE = /(?:^|[\s;{}])(?:const|let|var|import|export|function)\s|"[^"]+"\s*:\s|'[^']+'\s*:\s|[{};]\s*(?:if|for|while|return|new)\s|=>|[\w$]+\s*\(|[=;] ?[\w$]+ ?[=;]|\w+\.\w+\s*\(|\w+\.\w+\s*=|"[^"]*"\s*[,;}]|\][\s,;]*\w/;

/**
 * #673 class 2 (#780): stray control bytes in a text write.
 *
 * The observed incident: docs/DECISIONS.md carried five control bytes — four
 * 0x07 (BEL) + one 0x08 (BS) — that had REPLACED words' leading letters
 * ("branch -D", "add -A", "applyEscalations", …). A shell escape swallowed the
 * text and emitted the byte instead. Like the one-line collapse, the write is
 * REAL and silent: the file is committed with the mangled word and nobody
 * notices until it is read.
 *
 * A text file has no business carrying terminal-control bytes, so a write that
 * INTRODUCES one is refused and the recovery is the same: recover from git.
 * 0x09 (tab), 0x0A (LF) and 0x0D (CR) stay legal — they are ordinary text
 * whitespace and line structure. UTF-8 multibyte sequences never contain a byte
 * below 0x80, so a byte scan cannot false-positive on non-ASCII text.
 *
 * Deliberately WEAK on the target: unlike class 1 this does not need a readable
 * prior — a control byte is corruption whether the file existed or not. The
 * refusal only names the bytes, since WHICH mangled word it was is not knowable
 * from the payload alone.
 */
const ALLOWED_CONTROL = new Set([0x09, 0x0a, 0x0d]);
const TEXT_EXT = /\.(mjs|cjs|js|jsx|ts|mts|cts|json|md|txt|yml|yaml|toml|css|html|sh|ps1)$/i;

export function refusalForControlBytes({ path, content }) {
	if (typeof path !== "string" || typeof content !== "string") return null;
	if (!TEXT_EXT.test(path)) return null; // not a text file: bytes may be the point
	const found = new Set();
	for (let i = 0; i < content.length; i++) {
		const code = content.charCodeAt(i);
		if (code < 0x20 && !ALLOWED_CONTROL.has(code)) found.add(code);
		else if (code === 0x7f) found.add(code);
	}
	if (found.size === 0) return null;
	const hex = [...found].sort((a, b) => a - b).map((c) => `0x${c.toString(16).padStart(2, "0")}`).join(", ");
	return (
		"refused by durig: this write introduces stray control bytes (" + hex + ") into a text " +
		`file (${path}) — that is the shell-escape corruption shape of the #780 incident ` +
		"(a byte swallowed a word). If you meant to emit text, recover the erased word from git " +
		"(the file survives in HEAD) rather than re-writing this content"
	);
}

/**
 * Sources a refusal (a `block`) for a `write` call whose arguments look like the
 * observed corruption incident; `null` otherwise.
 *
 * WEAK check deliberately: this refuses NOTHING unless the referenced target is
 * readable and its old content is multi-line, and only warns on N-of-M wire
 * patterns (#673's 'refuse-on-shape' moat says: phrase the refusal with the
 * RECOVERY hint ("recover from git"), because the realistic emergency is not
 * an error — it is the LACK of one.
 */
export function refusalForWrite({ root, path, content }) {
	if (typeof path !== "string" || typeof content !== "string") return null;
	if (content.includes("\n")) return null; // multi-line content is not the incident
	if (content.length < MIN_SUSPICIOUS_LENGTH) return null;
	/* path: only .mjs/.ts/.js/.json source files bearing multi-line, rug form
	   are prevented from a collapsed rewrite; one-liner config dumps sail through. */
	if (!/\.(mjs|cjs|js|jsx|ts|mts|cts)$/.test(path)) return null;
	if (!SERIALIZATION_RE.test(content)) return null; // not code-shaped, no refusal
	// The file's PRIOR state decides: a pre-existing MULTI-LINE source that this
	// call would collapse is the corruption incident.
	let prior;
	try {
		prior = readFileSync(absoluteSeatPath(root, path), "utf8");
	} catch {
		return null; // unreadable/no prior: not provably a collapse, so not refused
	}
	const priorLines = prior.split(/[\r\n]+/).filter((l) => l.trim() !== "").length;
	if (priorLines < MIN_SUSPICIOUS_LINES) return null;
	return (
		"refused by durig: this write would collapse a multi-line source file " +
		`(${priorLines} lines) to a single line — that is the silent-corruption shape ` +
		"of the #623 incident; if you meant to serialize (JSON.stringify without " +
		"line breaks, or a Set-Content-style dump) write to a NEW .json/.txt " +
		"filename instead, or keep the line structure and edit it in place"
	);
}

/**
 * #1317 (security finding #1315, HIGH): the commit path had NO automated gate, so a
 * secret-shaped line could be committed untouched. This is that gate — it runs on the
 * seat's own `git commit` and reuses #700's scanner (src/config.mjs).
 *
 * Deliberately PRECISION-first: only the provider-PREFIX shapes are tested, NOT the
 * blunt 40+ entropy rule, which fires on the hashes, ids and base64 that are ordinary
 * in a diff (a full git sha is 40 hex chars). A gate that refuses an ordinary commit is
 * an outage, so the trade is the false negative. The refusal names the FILE and never
 * the value (a durable read must not carry the secret).
 */
const GIT_COMMIT_RE = /(^|[\s;&|"'()])git(\s+-C\s+\S+)?\s+commit\b/i;
const TOKEN_RE = /[A-Za-z0-9_+=\-]{16,}/g;

/** The added lines of a unified diff that carry a secret-shaped token. */
export function secretOffendersInDiff(diffText) {
	const offenders = [];
	let path = null;
	for (const raw of String(diffText ?? "").split(/\r?\n/)) {
		if (raw.startsWith("+++ ")) {
			path = raw.slice(4).replace(/^b\//, "");
			continue;
		}
		if (!raw.startsWith("+")) continue;
		const line = raw.slice(1);
		for (const tok of line.match(TOKEN_RE) ?? []) {
			if (SECRET_PREFIX_PATTERNS.some((re) => re.test(tok))) {
				offenders.push({ path });
				break;
			}
		}
	}
	return offenders;
}

/** The content a `git commit` would land: the index, plus the tree when -a/--all. */
function stagedDiff(root, command) {
	const opts = { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 };
	const index = execFileSync("git", ["-C", root, "diff", "--cached", "--unified=0", "--no-color"], opts);
	if (/(^|\s)(-a|--all)(\s|$)/.test(command)) {
		return index + execFileSync("git", ["-C", root, "diff", "HEAD", "--unified=0", "--no-color"], opts);
	}
	return index;
}

/** The block text for a commit whose staged content carries a secret, or null. */
function commitSecretRefusal(root, command) {
	let diff;
	try {
		diff = stagedDiff(root, command);
	} catch {
		// No repo, no HEAD, or git missing: the gate cannot run, so it does not block.
		return null;
	}
	const offenders = secretOffendersInDiff(diff);
	if (offenders.length === 0) return null;
	const files = [...new Set(offenders.map((o) => o.path ?? "(unknown)"))].join(", ");
	return (
		`refused by durig: the staged change carries a secret-shaped value in ${files} — ` +
		"a commit is portable history the operator may publish, so the value would be burned the " +
		"instant it lands. Read it from the ENVIRONMENT instead, remove it from the file, re-stage, " +
		"and never echo the value in the message or a completion"
	);
}

/**
 * Refuse a call, or let it through.
 *
 * `ToolHookCall.parent` is set for a nested call - one a running tool made through
 * `executeTool()`, which is how a codemode script reaches any tool - so this covers those too,
 * which a coding-agent `tool_call` event could not.
 */
export async function beforeTool(call, api, context) {
	const command = SHELL_TOOLS.has(call?.name) ? call.arguments?.command : undefined;
	if (typeof command !== "string") {
		// #673: writes get the same refusal channel (`block`). Two corruption
		// shapes are checked at call time: class 2 (stray control bytes) from the
		// payload alone, class 1 (a multi-line source collapsed to one line) from
		// the arguments plus the target's PRIOR content on disk (the part an
		// overwrite would silently erase), read where the write actually lands:
		// the seat's own tree, not the broker process's cwd.
		if (call?.name === "write") {
			const shape = { path: call.arguments?.path, content: call.arguments?.content };
			const refusal =
				refusalForControlBytes(shape) ??
				refusalForWrite({ root: await seatGraphRoot(api, context), path: shape.path, content: shape.content });
			return refusal === null ? undefined : { block: refusal };
		}
		return undefined;
	}
	const refusal = refusalFor(command);
	if (refusal !== null) return { block: refusal };
	// #1317: a commit lands durable, portable history — gate its staged content.
	if (GIT_COMMIT_RE.test(command)) {
		const block = commitSecretRefusal(await seatGraphRoot(api, context), command);
		if (block !== null) return { block };
	}
	return undefined;
}

/**
 * Installed next to the Router, so every seat is guarded whatever tools it is later given.
 *
 * A refusal is a `block`, which pi-durable surfaces as a blocked call rather than a crash, so a
 * seat can read the reason and `defer_work` on it instead of retrying variants of the command.
 */
export const SeatGuard = defineExtension({
	name: "durig.guard",
	hooks: [hook(ToolTask, { beforeTool })],
});
