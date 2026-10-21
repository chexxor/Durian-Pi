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
