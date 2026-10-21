// The WRITE-TARGET RESOLVER (#4366): turn a shell COMMAND STRING into the paths it writes.
//
// WHY THIS EXISTS, and why it is a PIPELINE GAP rather than a missing check: src/seatguard.mjs
// `refusalForWrite({ root, path, content })` is a write guard that ALREADY EXISTS and is
// path-based. It is reached by STRUCTURED tool calls and NEVER by a shell command string, because
// nothing turns `> X`, `Set-Content -Path X` or `cp A B` into a `path`. seatguard.mjs says as much
// in its own comment ("`refusalFor` is not the boundary either, so this is a LAYER under the
// authoritative..."). So this module does ONE job: resolve the string into paths, and REPORT what
// it could not resolve. It does not refuse; the guard downstream does.
//
// DO NOT ADD A VERB LIST. A list added to DENIED_COMMANDS would be the FOURTH list in this tree,
// and the next writer would find a form none of them name - exactly the failure being described.
// This resolves TARGETS, whatever the verb.
//
// HONEST LIMIT (this is a HEURISTIC OVER A STRING, and it is written down rather than implied):
// `$p = Join-Path ...; Set-Content $p`, a pipe into a script, `node -e`, or any computed path will
// evade any resolver. That is why the detector is the belt to this guard's braces rather than a
// redundancy - and why an UNRESOLVABLE form is REPORTED in `unresolved` instead of being dropped.
// A resolver whose silence is indistinguishable from "nothing to check" is worse than none.

import { isAbsolute, resolve as resolvePath } from "node:path";

/**
 * Split a command string into SEGMENTS (token lists), each a single simple command.
 *
 * Deliberately NOT confine.mjs's `shellSegments`: that one treats `&` as a separator, which would
 * split `2>&1` into `2>` and `1` and manufacture a phantom redirect with no target (a false
 * positive refuses ordinary work). Here `2>&1` is consumed whole, `>` / `>>` / `2>` / `*>` / `<`
 * become their OWN tokens, and only `;`, `|`, `&&`, `||` and newline separate commands.
 */
function segments(text) {
	const out = [];
	let tokens = [];
	let cur = "";
	let quote = null;
	const flush = () => {
		if (cur !== "") {
			tokens.push(cur);
			cur = "";
		}
	};
	const end = () => {
		flush();
		if (tokens.length > 0) out.push(tokens);
		tokens = [];
	};
	const s = String(text ?? "");
	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		if (quote !== null) {
			if (ch === quote) {
				quote = null;
				continue;
			}
			if (quote === '"' && ch === "\\" && i + 1 < s.length) {
				cur += s[++i];
				continue;
			}
			cur += ch;
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			continue;
		}
		if (ch === "\\" && i + 1 < s.length) {
			cur += s[++i];
			continue;
		}
		// 2>&1 / 1>&2: a stream MERGE, never a file target. Consume it whole.
		if (/\d?>/.test(s.slice(Math.max(0, i - 1), i + 1)) && s.startsWith("&", i + 1) && /\d/.test(s[i + 2] ?? "")) {
			i += 2;
			continue;
		}
		if (ch === "&" && s[i + 1] === "&") {
			end();
			i++;
			continue;
		}
		if (ch === "|" && s[i + 1] === "|") {
			end();
			i++;
			continue;
		}
		if (ch === ";" || ch === "|" || ch === "\n") {
			end();
			continue;
		}
		// A redirect operator becomes its own token so `>` and its target never merge.
		if (ch === ">") {
			flush();
			let op = ">";
			if (s[i + 1] === ">") {
				op = ">>";
				i++;
			}
			tokens.push(op);
			continue;
		}
		if (ch === "<") {
			flush();
			tokens.push("<");
			continue;
		}
		if (ch === " " || ch === "\t" || ch === "\r") {
			flush();
			continue;
		}
		cur += ch;
	}
	end();
	return out;
}

/** The redirect operators whose FOLLOWING token is a file target. */
const REDIRECT = new Set([">", ">>"]);
/** A leading `2>` / `*>` / `1>` / `&>` fused onto the operator, e.g. `2>out`. */
const FUSED_REDIRECT = /^(\d|\*|&)?(>>?)$/;
/** Cmdlets whose named path parameters name a target. */
const PATH_CMDLETS = new Set([
	"set-content",
	"add-content",
	"out-file",
	"new-item",
	"remove-item",
	"copy-item",
	"move-item",
	"rename-item",
]);
/** Named parameters that name a TARGET (the thing written). */
const TARGET_PARAMS = new Set(["-path", "-literalpath", "-destination", "-filepath"]);
/** Named parameters that must NEVER be read as a target, however path-like their value. */
const NOT_TARGET_PARAMS = new Set(["-value", "-inputobject", "-filter", "-include", "-exclude", "-encoding"]);
/** Copy/move verbs whose LAST argument is the destination. */
const COPY_VERBS = new Set(["cp", "copy", "mv", "move", "xcopy", "robocopy"]);
/** Verbs that change the base directory for following relative targets. */
const CHDIR_VERBS = new Set(["cd", "set-location", "push-location", "chdir"]);

/** A token that cannot be a literal path: a variable, a subexpression, a glob-only token. */
function isComputed(token) {
	return /[$`]/.test(token) || token.startsWith("(");
}

/**
 * Resolve the WRITE TARGETS in a shell command string.
 *
 * @param {string} command
 * @param {{cwd?: string|null}} [opts]  the base a RELATIVE target resolves against
 * @returns {{targets: Array<{path:string, raw:string, why:string, base:string|null}>, unresolved: Array<{raw:string, form:string, why:string}>}}
 */
export function writeTargets(command, { cwd = null } = {}) {
	const targets = [];
	const unresolved = [];
	let base = cwd; // `-C` / `Set-Location` / `Push-Location` move this for later RELATIVE targets

	const push = (raw, why) => {
		const token = String(raw ?? "");
		if (token === "" || token === "-") return;
		if (isComputed(token)) {
			unresolved.push({ raw: token, form: why, why: "a computed path (variable/subexpression) cannot be resolved statically" });
			return;
		}
		const path = base !== null && !isAbsolute(token) ? resolvePath(base, token) : token;
		targets.push({ path, raw: token, why, base });
	};

	for (const tokens of segments(command)) {
		const verb = String(tokens[0] ?? "").toLowerCase();
		// A chdir verb moves the base for the REST of the command.
		if (CHDIR_VERBS.has(verb) || verb === "-c" || tokens[0] === "-C") {
			const arg = tokens[1];
			if (arg && !isComputed(arg)) base = base !== null && !isAbsolute(arg) ? resolvePath(base, arg) : arg;
			else if (arg) unresolved.push({ raw: arg, form: `base (${tokens[0]})`, why: "a computed directory cannot be resolved" });
			continue;
		}
		// `git -C <dir> ...` / `pwsh -C <dir>`: the value is a base, not a target.
		const cIdx = tokens.findIndex((t) => t === "-C");
		if (cIdx !== -1 && tokens[cIdx + 1]) {
			const arg = tokens[cIdx + 1];
			if (!isComputed(arg)) base = base !== null && !isAbsolute(arg) ? resolvePath(base, arg) : arg;
		}

		// Redirection: the token AFTER `>` / `>>` (or fused `2>`) is a target.
		for (let i = 0; i < tokens.length; i++) {
			const t = tokens[i];
			if (REDIRECT.has(t)) {
				push(tokens[i + 1], "redirection");
				i++;
				continue;
			}
			const fused = FUSED_REDIRECT.exec(t);
			if (fused) {
				// `2>` alone -> next token; `2>out` -> the tail is the target.
				const tail = t.slice(fused[0].length);
				if (tail !== "") push(tail, "redirection");
				else push(tokens[i + 1], "redirection");
			}
		}

		// Named path parameters on a path-writing cmdlet.
		if (PATH_CMDLETS.has(verb)) {
			for (let i = 0; i < tokens.length; i++) {
				const t = String(tokens[i]).toLowerCase();
				if (NOT_TARGET_PARAMS.has(t)) {
					i++; // skip its value; `-Value` is NOT a target
					continue;
				}
				if (TARGET_PARAMS.has(t)) push(tokens[i + 1], `named parameter ${tokens[i]}`);
			}
		}

		// Copy/move: the LAST positional argument is the destination.
		if (COPY_VERBS.has(verb)) {
			const positional = tokens.slice(1).filter((t) => !t.startsWith("-"));
			if (positional.length >= 2) push(positional[positional.length - 1], `${verb} destination`);
			else if (positional.length === 1) unresolved.push({ raw: positional[0], form: `${verb} destination`, why: "a copy/move needs both a source and a destination" });
		}
	}
	return { targets, unresolved };
}
