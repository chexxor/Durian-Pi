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
import { isInside, refusalFor } from "./confine.mjs";
import { writeTargets } from "./writetargets.mjs";
import { resolveSeatRoot, sameRoot } from "./seatroot.mjs";
import { SECRET_PREFIX_PATTERNS } from "./config.mjs";
import { afterTool as redactToolResult } from "./secretredact.mjs";

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
	return resolveSeatRoot().root;
}

/**
 * The seat's PERSISTED agent cwd (`prepare_workspace` writes it via `configure`), or null when there
 * is none or it cannot be read. Distinct from `seatGraphRoot` (which FALLS BACK): #3961 refuses
 * only when a persisted cwd is KNOWN and equals the shared tree, so an empty/unknown api is not
 * treated as a degradation.
 */
async function persistedSeatCwd(api, context) {
	if (api?.conversationId === undefined || typeof api?.snapshot !== "function") return null;
	try {
		const agent = await api.snapshot(AgentDoc, api.conversationId, context);
		return agent?.cwd ?? null;
	} catch (err) {
		console.error(`SEATGUARD WARNING: seat cwd snapshot failed: ${err?.message ?? err}`);
		return null;
	}
}

/**
 * #3961: refuse a RELATIVE-path write, or a commit, when the seat's cwd has DEGRADED to the SHARED
 * checkout. `complete_work` (src/rig.mjs) retires the item worktree and SILENTLY resets the seat's
 * persisted cwd to the broker's cwd — the shared tree — returning just "ok", so the NEXT item's
 * relative write or commit lands in the shared tree: first #3122 (an untracked write), then a
 * commit ON MAIN that bypassed the landing pass. The remedy is always `prepare_workspace`, and
 * refusing is safe because writing into the shared tree is never what a seat intended.
 *
 * An ABSOLUTE path (or an @-prefixed one) is a deliberate target, so it is left to the existing
 * guards (confine.mjs is the boundary). `process.cwd()` is the shared root because the guard runs
 * inside the broker/CLI process, which is started from the shared checkout.
 */
async function sharedTreeRefusal(api, context, { path = null, command = null, shell = false } = {}) {
	// Only a KNOWN persisted cwd can be "degraded": with no persisted cwd the root is a fallback
	// (DURIG_SEAT_ROOT / process cwd) and a seat that never prepared a workspace is not our case.
	const seatRoot = await persistedSeatCwd(api, context);
	if (seatRoot === null || !sameRoot(seatRoot, process.cwd())) return null;
	// #3992: from a degraded cwd a seat must not RUN anything. A shell command can destroy work in the
	// tree that is not its own (`git checkout`, `git reset`, `git clean`, a raw write script), and that
	// is the operation that has actually destroyed work here. Refuse the whole shell tool rather than
	// classify commands: a classifier that must decide whether `git checkout -- .` is destructive will
	// be wrong. From a degraded cwd there is exactly ONE useful action - prepare_workspace; a seat that
	// wants to inspect can do it from a correct cwd one call later.
	if (shell) {
		return (
			`refused by durig: your seat cwd IS the SHARED checkout (${seatRoot}), not an item worktree - a ` +
			`shell command here can destroy the shared tree. The cwd degrades to the shared tree after ` +
			`complete_work; call prepare_workspace first, then run your command.`
		);
	}
	if (path !== null) {
		const p = String(path).replace(UNICODE_SPACES, " ");
		if (isAbsolute(p) || p.startsWith("@")) return null;
		return (
			`refused by durig: this write uses a RELATIVE path ("${p}") and your seat cwd IS the SHARED ` +
			`checkout (${seatRoot}), not an item worktree — the write would land in the shared tree. The cwd ` +
			`degrades to the shared tree after complete_work; call prepare_workspace first.`
		);
	}
	if (command !== null && GIT_COMMIT_RE.test(command)) {
		return (
			`refused by durig: this commit runs in the SHARED checkout (${seatRoot}), not an item worktree — ` +
			`it would land ON the shared branch and bypass the landing pass. Call prepare_workspace first.`
		);
	}
	return null;
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
/**
 * #1379 (G-A, security position @cf84825): a PEM header CANNOT be caught as a token —
 * TOKEN_RE breaks `-----BEGIN RSA PRIVATE KEY-----` at its spaces into sub-16 fragments —
 * so it is matched on the raw ADDED LINE (trim-aware). Same name-the-file, never-the-value
 * contract as the token path.
 */
const PEM_LINE_RE = /^-----BEGIN [A-Z ]*PRIVATE KEY-----$/;

/** The added lines of a unified diff that carry a secret-shaped token or a PEM header. */
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
		// #1379: the PEM header is matched on the LINE, not as a token (PEM_LINE_RE).
		if (PEM_LINE_RE.test(line.trim())) {
			offenders.push({ path });
			continue;
		}
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
	// stderr is PIPED (not inherited): a failing git would otherwise dump its usage text to the
	// broker's stderr, and #1380's warning path must print the failure kind and nothing else.
	const opts = { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] };
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
	} catch (err) {
		// #1380 (G-B; security position @cf84825 C2): fail-OPEN is RATIFIED at THIS point — the
		// commit needs the same git whose failure opened the gate, so an unscanned commit via
		// this path is already impossible — but a SILENT fail-open is not: this file's own
		// precedent (the cwd-snapshot warning) warns on the same shape of degraded service.
		// MESSAGE ONLY: the failure kind, never diff content, never a token.
		//
		// STANDING GENERALIZATION (recorded, no code; position C2): at any FUTURE enforcement
		// point that does NOT depend on the failing tooling (e.g. a broker-side receive hook
		// scanning content the broker itself assembles), the same gate MUST fail CLOSED, and a
		// security position is required BEFORE such a hook lands.
		const raw = (err?.stderr && String(err.stderr).trim()) || err?.message || String(err);
		const detail = String(raw).split(/\r?\n/)[0].trim().slice(0, 160);
		console.error(
			`SEATGUARD WARNING: the commit-time secret scan could not run (${detail}) — the commit proceeds UNSCANNED`,
		);
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
 * #1966 layer (ii): the broker SPOOL directory (`<db>.broker.inbox`) is a CONTROL-PLANE
 * surface — a spool request carries a PRODUCER-STAMPED `from`, so a seat that can write
 * here could forge `from: "operator"` and drive a control-plane op (pause/configure) or
 * a cross-seat reset/stop/compact. This path-deny NARROWS that surface.
 *
 * BEST-EFFORT, not the boundary: a shell defeats any string check (the F4 reason
 * `refusalFor` is not the boundary either), so this is a LAYER under the authoritative
 * `from`-gate in src/broker.mjs (`authorizeSpoolRequest`). The bypass is DOCUMENTED in
 * demo/control-plane-gate.test.mjs, not hidden.
 */
const SPOOL_PATH_RE = /(?:^|[\\/])[^\\/\s]*\.broker\.inbox(?:\.error)?(?:[\\/]|$)/;
export function refusalForSpoolPath(target) {
	if (typeof target !== "string" || target === "") return null;
	if (!SPOOL_PATH_RE.test(target)) return null;
	return (
		"refused by durig: that path is the broker SPOOL directory (a control-plane surface) — " +
		"a seat may not write it. A spool request carries a producer-stamped `from`, so a write " +
		"here could forge an operator control-plane request (pause/configure/reset). Use the " +
		"operator CLI verbs instead; this is a layer, not the boundary (the `from`-gate refuses it)"
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
		// #1966 layer (ii): a write/edit into the broker spool is refused before it lands.
		if (call?.name === "write" || call?.name === "edit") {
			const spool = refusalForSpoolPath(call.arguments?.path);
			if (spool !== null) return { block: spool };
		}
		// #673: writes get the same refusal channel (`block`). Two corruption
		// shapes are checked at call time: class 2 (stray control bytes) from the
		// payload alone, class 1 (a multi-line source collapsed to one line) from
		// the arguments plus the target's PRIOR content on disk (the part an
		// overwrite would silently erase), read where the write actually lands:
		// the seat's own tree, not the broker process's cwd.
		if (call?.name === "write" || call?.name === "edit") {
			// #3961: a degraded cwd (the shared checkout) must not take a RELATIVE-path write.
			const degraded = await sharedTreeRefusal(api, context, { path: call.arguments?.path });
			if (degraded !== null) return { block: degraded };
		}
		if (call?.name === "write") {
			const shape = { path: call.arguments?.path, content: call.arguments?.content };
			const refusal =
				refusalForControlBytes(shape) ??
				refusalForWrite({ root: await seatGraphRoot(api, context), path: shape.path, content: shape.content });
			return refusal === null ? undefined : { block: refusal };
		}
		return undefined;
	}
	// #3961/#3992: a commit from the DEGRADED cwd (the shared checkout) lands ON main, bypassing the
	// landing pass - refuse it with the precise diagnosis FIRST.
	if (GIT_COMMIT_RE.test(command)) {
		const degraded = await sharedTreeRefusal(api, context, { command });
		if (degraded !== null) return { block: degraded };
	}
	// #3992: any OTHER shell command from a degraded cwd is refused outright, before any command
	// classification - `run` is what has actually destroyed work in this repo.
	const degradedShell = await sharedTreeRefusal(api, context, { shell: true });
	if (degradedShell !== null) return { block: degradedShell };
	// #1966 layer (ii): a shell command naming the spool directory is refused (best-effort).
	// #4374: the refusal is given the seat root and cwd, so a PATH-AWARE entry (`checkout-index`)
	// can resolve its TARGET instead of pattern-matching the verb.
	const guardRoot = await seatGraphRoot(api, context);
	const refusal = refusalFor(command, { root: guardRoot, cwd: guardRoot }) ?? refusalForSpoolPath(command);
	if (refusal !== null) return { block: refusal };
	// #4367: a shell command string that WRITES outside the seat's worktree. The containment guard
	// exists (confine.mjs `confinedEnv`), but only structured calls reach it; this is the resolver's
	// wiring. `unresolved` is REPORTED rather than passed silently — a form nobody could read is a
	// form nobody checked, and its silence must not look like "nothing was wrong".
	const shellWrite = shellWriteRefusal({ command, root: await seatGraphRoot(api, context) });
	if (shellWrite.block !== null) return { block: shellWrite.block };
	if (shellWrite.unresolved.length > 0) {
		console.error(
			`durig guard: ${shellWrite.unresolved.length} write target(s) in this shell command could not be resolved (${shellWrite.unresolved
				.map((u) => u.raw)
				.join(", ")}) — they were NOT checked; prefer the edit tool or a literal path`,
		);
	}
	// #1317: a commit lands durable, portable history — gate its staged content.
	if (GIT_COMMIT_RE.test(command)) {
		const block = commitSecretRefusal(await seatGraphRoot(api, context), command);
		if (block !== null) return { block };
	}
	return undefined;
}

/**
 * #4367: the ROOT-ESCAPE refusal for a SHELL command string.
 *
 * The containment guard ALREADY EXISTS - confine.mjs `confinedEnv` denies "path <x> is outside the
 * seat's worktree" - but it is reached by STRUCTURED tool calls and NEVER by a shell string, because
 * nothing turns `> X`, `Set-Content -Path X` or `cp A B` into a `path`. `writeTargets` is that
 * missing step, and this is the wiring. (NOT `refusalForWrite`: that one refuses a multi-line source
 * being COLLAPSED to one line, a different shape; containment is confine.mjs's job.)
 *
 * Returns the block (or null) plus `unresolved` so the CALLER can report it: an unreadable form is a
 * form nobody checked, and "nothing was checked" must not look like "nothing was wrong".
 *
 * THE REMEDY IS NAMED, and not for politeness: the 04:21Z seat acted on a LEGITIMATE GOAL (restore
 * the shared tree to main) with the WRONG TOOL. A refusal reading "you may not touch the shared
 * tree" would be read as forbidding the GOAL, and the next seat routes AROUND the guard. So it says
 * what to do instead: the edit tool, your own worktree, and a git operation for tracked paths.
 */
export function shellWriteRefusal({ command, root, cwd = root }) {
	const { targets, unresolved } = writeTargets(command, { cwd });
	const escapes = targets.filter((t) => !isInside(root, t.path));
	if (escapes.length === 0) return { block: null, unresolved, targets };
	const named = escapes.map((t) => t.path).join(", ");
	return {
		block:
			`refused by durig: this shell command WRITES outside your worktree — ${named} is outside ${root}. ` +
			`Your goal may be legitimate; the METHOD is not. Use the \`edit\` tool for source files, do the ` +
			`work in your item worktree, and if the shared tree needs restoring that is a git operation on ` +
			`TRACKED paths — never a text rewrite.`,
		unresolved,
		targets,
	};
}

/**
 * Installed next to the Router, so every seat is guarded whatever tools it is later given.
 *
 * A refusal is a `block`, which pi-durable surfaces as a blocked call rather than a crash, so a
 * seat can read the reason and `defer_work` on it instead of retrying variants of the command.
 *
 * The extension carries a SECOND, sibling hook: `afterTool` (src/secretredact.mjs) redacts a
 * secret-shaped value out of a tool result at the commit boundary — same `ToolTask` surface, the
 * other half of the round. Registered here rather than in a new extension because this one is
 * already installed in cli.mjs's `openHarness`; a seat cannot be given a tool without both
 * policies riding it.
 */
export const SeatGuard = defineExtension({
	name: "durig.guard",
	hooks: [hook(ToolTask, { beforeTool }), hook(ToolTask, { afterTool: redactToolResult })],
});
