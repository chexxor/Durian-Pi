// src/sanitize.mjs — untrusted model/tool text must never emit terminal control
// sequences. Model output is DATA: only our renderers may choose escape sequences,
// because an OSC 52 clipboard write or an OSC 8 hyperlink executes in the operator's
// terminal, not ours, and both have been used to turn a poisoned clipboard into code
// execution on paste.
//
// This is an ALLOWLIST, not a denylist. A denylist of "known bad" sequences is
// unbounded (every terminal adds codes), and a partial match is worse than none: a
// lone ESC swallows whatever the renderer writes next, and a surviving `\x1b[2J`
// wipes the frame the operator is reading. Anything not explicitly recognised is
// removed whole, including its payload, so no fragment can be reinterpreted.
//
// Escape sequences arrive in two encodings, and both must be handled: the 7-bit ESC
// forms (`ESC [` CSI) and the 8-bit C1 forms (U+009B CSI, U+009D OSC). A terminal may
// honour either, so stripping only ESC leaves a working bypass; this was found by
// reading `chalk/ansi-regex` and `sindresorhus/string-width` (vendor/eval/).
//
// The allowlist keeps the handful of SGR codes our own palette uses. That is a
// deliberate trade: a model can still colour its own text (a cosmetic spoof), but it
// cannot move the cursor, clear the screen, retitle the window, write the clipboard,
// or open a link. If the palette ever stops needing a code here, remove it.

// The exact SGR parameter lists the renderers may pass through. Kept as whole
// parameter strings (`0;1`) so a compound sequence is only allowed when EVERY part
// is known; `38;5;9` (256-colour) is deliberately absent.
const ALLOWED_SGR = new Set(["0", "1", "2", "7", "22", "30", "31", "32", "33", "34", "35", "36", "37", "39"]);

// CSI parameter bytes (0x30-0x3F: digits and ;:<=>?), intermediate bytes
// (0x20-0x2F) and a final byte (0x40-0x7E).
const CSI_PARAM = /[\x30-\x3f]/;
const CSI_INTERMEDIATE = /[\x20-\x2f]/;
const CSI_FINAL = /[\x40-\x7e]/;

// DCS/PM/APC/SOS introducers (ESC P/^/_/X): string sequences like OSC.
const STRING_INTRODUCERS = new Set(["]", "P", "^", "_", "X"]);

// String sequences (OSC and DCS/PM/APC/SOS) run until BEL (0x07), C1 ST (0x9C) or
// ST (ESC \). An unexpected ESC aborts the sequence the way terminals do, rather
// than scanning to end of input and swallowing every later frame.
function consumeStringSequence(s, start) {
	let j = start;
	while (j < s.length) {
		const code = s.charCodeAt(j);
		if (code === 0x07 || code === 0x9c) return j + 1;
		if (s[j] === "\x1b") return s[j + 1] === "\\" ? j + 2 : j;
		j++;
	}
	return s.length; // unterminated: drop the tail
}

// Unicode FORMAT characters are a DIFFERENT class from control sequences, and the
// allowlist above never sees them: a bidi override (U+202A-202E, U+2066-2069) carries
// no glyph and no cells, so `code < 0x20 || (0x7f..0x9f)` does not match it. That
// matters more than a display bug — a bidi override REORDERS what the operator reads,
// so a rendered frame can say something the data does not, and an invisible character
// (ZWSP, word joiner, BOM, soft hyphen, LRM) can hide content inside a command.
//
// Stripped, with ONE exception: ZWJ (U+200D) is structural for emoji clusters —
// `src/textwidth.mjs` already counts a ZWJ sequence as one grapheme — so removing it
// would visibly split them. Per class, not one blanket strip (#3962).
const FORMAT_CHAR = /\p{Cf}/u;
const ZWJ = "\u200d";

export function sanitizeTerminalText(text) {
	const s = String(text ?? "");
	let out = "";
	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		const code = s.charCodeAt(i);

		// Newline and tab are layout, not control: the renderers wrap and indent on
		// them, and neither can move the cursor.
		if (ch === "\n" || ch === "\t") {
			out += ch;
			continue;
		}

		const esc = code === 0x1b;
		const c1Csi = code === 0x9b;
		const c1Osc = code === 0x9d;
		if (esc || c1Csi || c1Osc) {
			const next = s[i + 1];
			// The introducer itself is one byte for C1, two for the ESC form; the
			// first argument byte sits just past it.
			const start = c1Csi || c1Osc ? i + 1 : i + 2;
			if (c1Csi || (esc && next === "[")) {
				let j = start;
				while (j < s.length && CSI_PARAM.test(s[j])) j++;
				while (j < s.length && CSI_INTERMEDIATE.test(s[j])) j++;
				const final = j < s.length && CSI_FINAL.test(s[j]) ? s[j] : null;
				if (final === "m") {
					const params = s.slice(start, j);
					const parts = params === "" ? [""] : params.split(";");
					if (parts.every((p) => ALLOWED_SGR.has(p))) out += s.slice(i, j + 1);
				}
				// Skip a well-formed sequence's final byte; an unterminated CSI drops
				// whatever remains, because a bare introducer plus text is exactly the
				// swallow-the-next-write hazard.
				i = final === null ? s.length : j;
				continue;
			}
			if (c1Osc || (esc && next === "]")) {
				i = consumeStringSequence(s, start) - 1;
				continue;
			}
			if (esc && STRING_INTRODUCERS.has(next)) {
				i = consumeStringSequence(s, i + 2) - 1;
				continue;
			}
			// Any other introducer (a two-character escape, a charset select, or a
			// lone introducer): drop it and let the loop continue, so its arguments
			// can only surface as inert text, never as a live escape.
			continue;
		}

		// Remaining C0 controls (bell, backspace, carriage return, ...), DEL, and the
		// C1 range: dropped, because carriage return can overwrite the line and the
		// rest are noise the renderer did not ask for.
		if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) continue;

		// Invisible FORMAT characters (bidi controls, zero-width spaces, BOM, soft
		// hyphen): dropped, except ZWJ, which is structural for emoji.
		if (FORMAT_CHAR.test(ch) && ch !== ZWJ) continue;

		out += ch;
	}
	return out;
}
