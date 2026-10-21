// src/textwidth.mjs â€” measure text in terminal CELLS, not JavaScript code units.
// `String.length` is wrong for everything this UI actually renders: a CJK glyph or an
// emoji is two cells, a combining mark is zero, and a ZWJ family is one grapheme.
//
// This is a faithful port of sindresorhus/string-width (MIT, read at
// vendor/eval/string-width) using the built-in Intl.Segmenter for grapheme
// boundaries and get-east-asian-width for the width table. It is a port rather than
// a dependency because string-width is ESM-only-clean but pulls strip-ansi/ansi-regex
// too, and we already have the one table package installed.
//
// The rules, in order, are string-width's, because each has a real failing case:
//   1. non-printing clusters (ignorable/control/format/marks/surrogates) are width 0;
//   2. RGI emoji clusters are width 2;
//   3. minimally-qualified emoji (ZWJ with >=2 Extended_Pictographic, or a keycap) are 2;
//   4. Hangul L+V(+T) jamo collapse to one width-2 syllable; unmatched jamo stay additive;
//   5. otherwise East Asian Width of the first visible scalar, plus trailing spacing
//      marks and Halfwidth/Fullwidth Forms inside the cluster.

import { eastAsianWidth } from "get-east-asian-width";

const segmenter = new Intl.Segmenter();

// A single negated class with NO quantifier on purpose: a repeated property-class
// pattern backtracks exponentially and can overflow V8's regex stack on a cluster of
// thousands of marks.
const visibleCharacterPattern = /[^\p{Default_Ignorable_Code_Point}\p{Control}\p{Format}\p{Nonspacing_Mark}\p{Enclosing_Mark}\p{Surrogate}]/v;
const spacingMarkPattern = /\p{Spacing_Mark}/v;
const rgiEmojiPattern = /^\p{RGI_Emoji}$/v;
const unqualifiedKeycapPattern = /^[\d#*]\u20E3$/;
const extendedPictographicPattern = /\p{Extended_Pictographic}/gu;

// OSC and CSI (7-bit ESC and 8-bit C1 introducers), the same shapes chalk/ansi-regex
// matches. Width must not count escape bytes; OSC payloads may contain printable
// characters that must not count either.
const ANSI_PATTERN = new RegExp(
	[
		"(?:\\x1b\\]|\\u009d)[^\\u0007\\x1b\\u009c\\u009d]*(?:\\u0007|\\x1b\\\\|\\u009c)",
		"(?:\\x1b\\[|\\u009b)[[\\]()#;?]*(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]",
	].join("|"),
	"g",
);

function stripAnsi(text) {
	return text.includes("\x1b") || text.includes("\u009b") || text.includes("\u009d") ? text.replace(ANSI_PATTERN, "") : text;
}

function isDoubleWidthNonRgiEmoji(segment) {
	// Real emoji clusters are short; guard before running the pictographic scan.
	if (segment.length > 50) return false;
	if (unqualifiedKeycapPattern.test(segment)) return true;
	if (segment.includes("\u200D")) {
		const pictographics = segment.match(extendedPictographicPattern);
		return pictographics !== null && pictographics.length >= 2;
	}
	return false;
}

// The cluster starting at its first visible character, or undefined when the whole
// cluster is non-printing (a combining-mark-only cluster, a lone ZWJ, a VS16).
function baseVisible(segment) {
	const index = segment.search(visibleCharacterPattern);
	return index === -1 ? undefined : segment.slice(index);
}

const isLeadingJamo = (cp) => (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0xa960 && cp <= 0xa97c);
const isVowelJamo = (cp) => (cp >= 0x1160 && cp <= 0x11a7) || (cp >= 0xd7b0 && cp <= 0xd7c6);
const isTrailingJamo = (cp) => (cp >= 0x11a8 && cp <= 0x11ff) || (cp >= 0xd7cb && cp <= 0xd7fb);
const isJamo = (cp) => isLeadingJamo(cp) || isVowelJamo(cp) || isTrailingJamo(cp);

// Returns the cluster's width when it is pure Hangul jamo, else undefined so the
// caller falls through to East Asian Width.
function hangulWidth(visibleSegment, ambiguousAsWide) {
	const codePoints = [];
	for (const character of visibleSegment) {
		if (visibleCharacterPattern.test(character)) codePoints.push(character.codePointAt(0));
	}
	if (codePoints.length === 0) return undefined;
	let width = 0;
	for (let i = 0; i < codePoints.length; i++) {
		const cp = codePoints[i];
		if (!isJamo(cp)) {
			if (width === 0) return undefined;
			for (let rest = i; rest < codePoints.length; rest++) width += eastAsianWidth(codePoints[rest], { ambiguousAsWide });
			return width;
		}
		// A modern L+V(+T) syllable is one block; an unmatched jamo stays additive,
		// which matches how the terminals we target render it.
		if (isLeadingJamo(cp) && isVowelJamo(codePoints[i + 1])) {
			width += 2;
			i += isTrailingJamo(codePoints[i + 2]) ? 2 : 1;
			continue;
		}
		width += eastAsianWidth(cp, { ambiguousAsWide });
	}
	return width;
}

function trailingWidth(visibleSegment, ambiguousAsWide) {
	let extra = 0;
	let first = true;
	for (const character of visibleSegment) {
		if (first) {
			first = false;
			continue;
		}
		if (spacingMarkPattern.test(character) || (character >= "\uFF00" && character <= "\uFFEF")) {
			extra += eastAsianWidth(character.codePointAt(0), { ambiguousAsWide });
		}
	}
	return extra;
}

function clusterWidth(segment, ambiguousAsWide) {
	const visible = baseVisible(segment);
	if (visible === undefined) return 0;
	if (rgiEmojiPattern.test(segment) || isDoubleWidthNonRgiEmoji(segment)) return 2;
	const hangul = hangulWidth(visible, ambiguousAsWide);
	if (hangul !== undefined) return hangul;
	const width = eastAsianWidth(visible.codePointAt(0), { ambiguousAsWide });
	return width + trailingWidth(visible, ambiguousAsWide);
}

/**
 * The number of terminal cells `input` occupies.
 * @param {string} input
 * @param {{ambiguousIsNarrow?: boolean}} [options] â€” false makes East-Asian
 *   "ambiguous" characters two cells; the terminals we target treat them as narrow.
 */
export function textWidth(input, { ambiguousIsNarrow = true } = {}) {
	if (typeof input !== "string" || input.length === 0) return 0;
	const string = stripAnsi(input);
	if (string.length === 0) return 0;
	// Printable ASCII is the common case; skip the segmenter and the table.
	if (/^[\u0020-\u007E]*$/.test(string)) return string.length;
	const ambiguousAsWide = !ambiguousIsNarrow;
	let width = 0;
	for (const { segment } of segmenter.segment(string)) width += clusterWidth(segment, ambiguousAsWide);
	return width;
}

/**
 * The first grapheme of `input` (empty string when there is none). Used by the
 * word-wrapper when a single cluster is wider than the line: it must still advance.
 */
export function firstCluster(input) {
	for (const { segment } of segmenter.segment(String(input ?? ""))) return segment;
	return "";
}

/**
 * The longest prefix of `input` that fits in `cells`, never splitting a grapheme.
 * ANSI is stripped first (callers re-apply their own styling), so the result is plain
 * text; this is the function the renderers should use to bound a row.
 */
export function sliceToWidth(input, cells, { ambiguousIsNarrow = true } = {}) {
	const string = stripAnsi(String(input ?? ""));
	if (cells <= 0 || string.length === 0) return "";
	const ambiguousAsWide = !ambiguousIsNarrow;
	let out = "";
	let used = 0;
	for (const { segment } of segmenter.segment(string)) {
		const width = clusterWidth(segment, ambiguousAsWide);
		if (used + width > cells) break;
		out += segment;
		used += width;
	}
	return out;
}

/**
 * Wrap prose to `width` CELLS, PRESERVING explicit newlines and BLANK LINES
 * (ROADMAP 101). The ONE wrapper for both the committed transcript and the live
 * partial: those two used to flatten with `\s+`, so the same text rendered
 * differently before and after it committed, and a turn that was three paragraphs
 * became one run-on row.
 *
 * The rules, and why each one:
 *  - split on EXPLICIT newlines only (a CRLF counts as one); never on `\s+`;
 *  - a blank line stays a blank line, and an empty string stays one empty line, so
 *    `lines.length` is the caller's line budget and nothing silently vanishes;
 *  - ONE trailing newline is a terminator, not an extra blank line;
 *  - a line that already fits is returned VERBATIM (no trim, no whitespace
 *    collapsing), so indented output and code are never reformatted just for being
 *    rendered; only a line that must wrap is reflowed;
 *  - a too-long line WRAPS, and a single token wider than the line is hard-split by
 *    cells (never through a grapheme), so nothing is ever truncated with an ellipsis.
 *
 * ANSI styling is preserved for width measurement and slicing, but callers should
 * wrap PLAIN text and re-apply their styling per line: a style that spans a wrap
 * point would otherwise be cut in half here.
 */
export function wrapLines(text, width) {
	const w = Math.max(1, Math.floor(width));
	const source = String(text ?? "").replace(/\r\n?/g, "\n");
	const body = source.endsWith("\n") ? source.slice(0, -1) : source;
	const out = [];
	for (const line of body.split("\n")) {
		if (line === "") {
			out.push("");
			continue;
		}
		if (textWidth(line) <= w) {
			out.push(line);
			continue;
		}
		// Reflow: keep the line's own indentation on the first segment and on its
		// continuations, so an indented block stays readable instead of collapsing
		// to flush-left after the first wrap.
		const indent = (line.match(/^[ \t]+/) ?? [""])[0];
		const indentWidth = textWidth(indent);
		const hanging = indentWidth < w ? indent : "";
		const budget = Math.max(1, w - textWidth(hanging));
		let current = "";
		const flush = () => {
			if (current !== "") out.push(hanging + current);
			current = "";
		};
		for (const word of line.trim().split(/[ \t]+/)) {
			if (word === "") continue;
			if (textWidth(word) > budget) {
				flush();
				let rest = word;
				while (textWidth(rest) > budget) {
					const chunk = sliceToWidth(rest, budget) || firstCluster(rest);
					out.push(hanging + chunk);
					rest = rest.slice(chunk.length);
				}
				current = rest;
				continue;
			}
			if (current === "") current = word;
			else if (textWidth(`${current} ${word}`) <= budget) current += ` ${word}`;
			else {
				flush();
				current = word;
			}
		}
		flush();
	}
	return out.length > 0 ? out : [""];
}
