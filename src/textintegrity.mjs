// Text-integrity detection (#4305): a COLLAPSED NEWLINE STRUCTURE, a missing trailing newline, a BOM,
// a NUL, or invalid UTF-8.
//
// WHY THIS EXISTS AND WHY `node --check` CANNOT DO IT. At 04:21:17Z eight tracked files in the shared
// tree were rewritten as SINGLE LINES. Every one of them still parsed — `node --check` exited 0 —
// because the flattening turns the file's opening `//` header comment into a comment that swallows the
// whole file. The module then exports NOTHING, and the failure surfaces only at IMPORT time
// ("does not provide an export named 'sliceToWidth'"). A syntax check is STRUCTURALLY BLIND to this
// class, so it cannot be the check for it.
//
// THIS IS A DETECTOR, NOT A GUARD. It tells you a file collapsed; the shell-write guard (#4304) is what
// stops the write. The incident was caused by a seat acting on a LEGITIMATE goal (restore the shared
// tree to main) with a tool that was not the right one, which is why the message names WHAT TO RESTORE
// FROM rather than only that something is wrong.
//
// #4371 WIRING: a detector that only runs on demand reports the breakage AFTER the tree is broken, so
// the readers below feed TWO callers - the `check` rule `text-integrity` (error severity) and the
// landing precondition in scripts/land.mjs, which is the half that would have PREVENTED 04:21Z.
// #3342 (`src/trackencoding.mjs`, absent from main) is SUBSUMED by `encodingFaults`; if it ever lands,
// IT SHOULD CALL THESE FUNCTIONS rather than reimplement them.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Count `\n` in a string.
 * @param {string} text
 * @returns {number}
 */
export function newlineCount(text) {
	if (typeof text !== "string") return 0;
	let n = 0;
	for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
	return n;
}

/**
 * Inspect a Buffer for encoding faults, independently of its line structure.
 * @param {Buffer|Uint8Array} bytes
 * @returns {{bom: string|null, nul: boolean, validUtf8: boolean}}
 */
export function encodingFaults(bytes) {
	const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
	let bom = null;
	if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) bom = "UTF-8";
	else if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) bom = "UTF-16LE";
	else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) bom = "UTF-16BE";
	// A NUL in the first 8 KiB is the signature of a UTF-16 body written without a BOM, which is how a
	// PowerShell `>` clobber of a source file usually arrives.
	const nul = buf.subarray(0, Math.min(buf.length, 8192)).includes(0);
	let validUtf8 = true;
	try {
		new TextDecoder("utf-8", { fatal: true }).decode(buf);
	} catch {
		validUtf8 = false;
	}
	return { bom, nul, validUtf8 };
}

/**
 * Compare a file's CURRENT text against its text at HEAD and report every integrity fault.
 *
 * @param {object} input
 * @param {string} input.path       the path as the reader knows it (for the message)
 * @param {string} input.now        current text (decoded)
 * @param {string|null} input.head  text at HEAD, or null when the file is not tracked
 * @param {Buffer} [input.bytes]    raw bytes, when available, for the encoding checks
 * @param {number} [input.minLines] files at or above this line count are subject to the collapse rule
 * @returns {{ok: boolean, faults: Array<{kind: string, detail: string}>}}
 */
export function textIntegrityFaults({ path, now, head, bytes, minLines = 8 }) {
	const faults = [];
	const nowLines = newlineCount(now);
	const headLines = head === null || head === undefined ? null : newlineCount(head);

	// 1. COLLAPSE VERSUS HEAD. A multi-line tracked file becoming one line is not a formatting choice.
	if (headLines !== null && headLines >= minLines) {
		// Refuse when the current file keeps less than a quarter of its structure. The threshold is
		// deliberately blunt: a genuine large edit that removes three quarters of a file's lines should
		// be committed as a rewrite the author can explain, not slipped in under a formatting pass.
		if (nowLines < Math.max(1, Math.floor(headLines / 4))) {
			faults.push({
				kind: "collapsed",
				detail: `newline structure collapsed: ${headLines} lines at HEAD, ${nowLines} now — restore from HEAD (git show HEAD:${path}) and re-apply the intended edit`,
			});
		}
	}

	// 2. A TRAILING NEWLINE IS REQUIRED. Its absence is the cheapest signal of a text round-trip that
	// lost the end of the file.
	if (now.length > 0 && !now.endsWith("\n")) {
		faults.push({ kind: "no-trailing-newline", detail: `file does not end with a newline (${path})` });
	}

	// 3. ENCODING. Same family as the UTF-16LE scratch clobber and the CP1252 docs decode.
	if (bytes) {
		const { bom, nul, validUtf8 } = encodingFaults(bytes);
		if (bom) faults.push({ kind: "bom", detail: `${bom} BOM present (${path}) — write UTF-8 without a BOM` });
		if (nul) faults.push({ kind: "nul", detail: `NUL byte in the first 8 KiB (${path}) — the file is probably UTF-16` });
		if (!validUtf8) faults.push({ kind: "invalid-utf8", detail: `not valid UTF-8 (${path}) — re-decode from HEAD rather than patching bytes` });
	}

	return { ok: faults.length === 0, faults };
}

/**
 * One-line summary for a check/landing report. Names the FILE and the EXPECTED COUNT, so the reader
 * knows what to restore from rather than only that something is wrong (#4305 item 4).
 *
 * @param {string} path
 * @param {Array<{kind: string, detail: string}>} faults
 * @returns {string}
 */
export function describeFaults(path, faults) {
	if (!faults || faults.length === 0) return `${path}: OK`;
	return `${path}: ${faults.map((f) => `[${f.kind}] ${f.detail}`).join("; ")}`;
}

/**
 * The WORKING TREE's tracked paths that DIFFER from HEAD — the files a seat just wrote. The reader's
 * default scope for `check`, and the one the 04:21Z incident would have been caught by (eight tracked
 * files rewritten as single lines, uncommitted).
 *
 * @param {{root?:string}} [opts]
 * @returns {string[]|null} paths, or null when git/the repository is unavailable (UNKNOWN, not clean)
 */
export function trackedChangedPaths({ root = process.cwd() } = {}) {
	try {
		const out = execFileSync("git", ["-C", root, "diff", "--name-only", "HEAD"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 10000,
			maxBuffer: 32 * 1024 * 1024,
		});
		return out.split("\n").map((s) => s.trim()).filter(Boolean);
	} catch {
		return null;
	}
}

/**
 * The paths a BRANCH would bring to `base` — the files a LANDING touches. The landing precondition's
 * scope (#4371 task two, the half that would have prevented 04:21Z).
 *
 * @param {{root?:string, branch?:string, base?:string}} [opts]
 * @returns {string[]|null} paths, or null when git/the repository is unavailable
 */
export function landingChangedPaths({ root = process.cwd(), branch, base = "main" } = {}) {
	if (!branch) return null;
	try {
		const out = execFileSync("git", ["-C", root, "diff", "--name-only", `${base}...${branch}`], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 10000,
			maxBuffer: 32 * 1024 * 1024,
		});
		return out.split("\n").map((s) => s.trim()).filter(Boolean);
	} catch {
		return null;
	}
}

/**
 * Read the text-integrity signal for a set of paths.
 *
 * `rev` selects WHERE the file is read from: null (default) is the WORKING TREE (the `check` caller,
 * where the 04:21Z flattening appeared uncommitted); a ref reads the file AT THAT REF (the landing
 * caller, which must judge the BRANCH's blobs, not the working tree). `headRev` is the comparison base
 * for the collapse rule — HEAD for the working tree, and the BASE branch for a landing (a collapse is
 * judged against what the file looked like before, which for a landing is main).
 *
 * @param {object} opts
 * @param {string} [opts.root]
 * @param {string[]} opts.paths   the paths to inspect (see trackedChangedPaths / landingChangedPaths)
 * @param {number} [opts.minLines]
 * @param {string|null} [opts.rev]      read the file at this ref; null = the working tree
 * @param {string} [opts.headRev]       the comparison base (default HEAD)
 * @returns {Array<{path:string, faults:Array<{kind:string,detail:string}>}>} only the NON-ok files
 */
export function readTextIntegrity({ root = process.cwd(), paths = [], minLines = 8, rev = null, headRev = "HEAD" } = {}) {
	const found = [];
	const show = (spec, enc) =>
		execFileSync("git", ["-C", root, "show", spec], {
			...(enc ? { encoding: "utf8" } : {}),
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 10000,
			maxBuffer: 32 * 1024 * 1024,
		});
	for (const p of paths) {
		let bytes;
		if (rev === null) {
			try {
				bytes = readFileSync(join(root, p));
			} catch {
				continue; // deleted in the working tree: nothing to inspect
			}
		} else {
			try {
				bytes = show(`${rev}:${p}`);
			} catch {
				continue; // not present at that ref (e.g. the branch DELETES it): nothing to inspect
			}
		}
		let head = null;
		try {
			head = show(`${headRev}:${p}`, true);
		} catch {
			head = null; // untracked (or absent at the base): no collapse comparison, by design
		}
		const r = textIntegrityFaults({ path: p, now: bytes.toString("utf8"), head, bytes, minLines });
		if (!r.ok) found.push({ path: p, faults: r.faults });
	}
	return found;
}
