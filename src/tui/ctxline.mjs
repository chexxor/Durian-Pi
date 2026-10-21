// src/tui/ctxline.mjs — ROADMAP 98 (#1108): the TUI's context read-surface line.
//
// One concern: render ONE seat's context-consumption measure (item 27, src/context.mjs)
// as a single header line. This module owns NO measure and NO denominator logic — it
// consumes the measure verbatim and only decides how to WRITE it (ROADMAP 98: "must reuse
// item 27's measure rather than invent a second one"; #1108: "the TUI owns NO denominator
// logic").
//
// The three-state denominator TRAVELS WITH THE VALUE (src/context.mjs), so a fraction is
// never shown without naming which window produced it:
//   measured <=100%   `ctx 31.4%/300k`
//   measured >100%    `ctx 314K/300K eff · 105%`   (tokens + basis word + UNCLAMPED percent)
//   declared          `ctx 31.4%/300k ·decl`
//   advertised-only   `ctx 302.1k/1.0M advertised` (FULL word; percent WITHHELD — no `%`)
//   missing usage     `ctx n/a`                    (never `0%`; dim tone; no band)
//
// FLOOR (the width ladder). The atomic unit is (basis-badge, denominator, percent): they
// drop TOGETHER or not at all, and the raw token count always survives. Rungs, widest
// first: full -> band word -> the pair (`ctx 302.1k`) -> compact overflow (`ctx 314K`).
// A basis-less percent (`ctx 31%`) is FORBIDDEN, and the line is NEVER cut mid-string: when
// even the narrowest rung does not fit we return it whole and let the frame overflow, so
// the ctx line is never truncated in favour of other header parts.
//
// BANDS: `[high]` (60–90%) and `[crit]` (>=90%) render ONLY when a percent renders; the
// advertised-only form has no percent, so no band. The WORD carries the meaning and colour
// is an accent on top, so the band survives NO_COLOR.
//
// The band rule, stated once so the next reader does not re-derive the #1128-vs-#1142
// contradiction (designer #1680, verbatim): **bands attach to REMAINING-WINDOW readings — i.e.
// when 0 < percent <= 100. At >100% the band is suppressed: the unclamped percent already states
// the excess, and the band's job (proximity to degradation) is subsumed.**
//
// Reading of the spec for the one case it does not spell out (declared, >100%): the pair
// stays atomic, so the badge rides the compressed pair — `ctx 314K/300K ·decl · 105%`.
// Likewise the >100% form carries no band: the unclamped percent already IS the signal
// there, and stacking `[crit]` on `105%` would encode one state twice.
import { ANSI } from "../ansi.mjs";
// Measure in terminal CELLS, not JavaScript code units — the same H4 helper and row budget the
// other conversation rows use (client.mjs), so the ladder and the row harness agree (designer #1680).
import { textWidth } from "../textwidth.mjs";

/** The line's label. Fixed so a reader can grep the surface. */
export const CONTEXT_LABEL = "ctx";

/** Band thresholds, widest first. `min` is a fraction of the window. */
export const CONTEXT_BANDS = Object.freeze([
	{ min: 0.9, word: "crit", tone: "red" },
	{ min: 0.6, word: "high", tone: "yellow" },
]);

/** The gutter every row of the frame carries (matches the header/rule indent). */
const GUTTER = "  ";

/** `302.1k` — the token count at display precision (one decimal, lowercase `k`). */
function fmtTokens(n) {
	if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return String(n);
}

/** `314K` — the compact/overflow count: whole thousands, uppercase `K`. */
function fmtCompact(n) {
	if (n >= 1e6) return `${Math.round(n / 1e6)}M`;
	if (n >= 1000) return `${Math.round(n / 1000)}K`;
	return String(n);
}

/** `300k` / `1.0M` — the window size: whole thousands drop the decimal, millions keep one. */
function fmtWindow(n) {
	if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
	const k = n / 1000;
	if (k >= 1) return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
	return String(n);
}

/** The band for a fraction, or null when none applies. */
export function bandFor(fraction) {
	if (!Number.isFinite(fraction)) return null;
	return CONTEXT_BANDS.find((b) => fraction * 100 >= b.min * 100) ?? null;
}

function dim(text, color) {
	return color ? `${ANSI.dim}${text}${ANSI.reset}` : text;
}

function accent(tone, text, color) {
	if (!color || !tone) return text;
	const code = ANSI[tone] ?? "";
	return code ? `${code}${text}${ANSI.reset}` : text;
}

/**
 * The rungs of the width ladder, widest first, as plain (uncoloured) strings plus the
 * band the widest rung carries. `band` is null when no rung shows a percent.
 */
function rungsFor(measure) {
	const consumed = measure?.consumed;
	if (consumed === null || consumed === undefined) return { rungs: [`${CONTEXT_LABEL} n/a`], band: null };

	const tokens = fmtTokens(consumed);
	const compact = fmtCompact(consumed);
	const value = measure?.window?.value ?? null;
	const basis = measure?.window?.denominator ?? null;
	const fraction = measure?.fraction ?? null;

	// No window: a bare token count is honest, a percentage with no window is not.
	if (value === null || fraction === null) {
		return { rungs: [`${CONTEXT_LABEL} ${tokens}`], band: null };
	}

	if (basis === "advertised") {
		return {
			rungs: [`${CONTEXT_LABEL} ${tokens}/${fmtWindow(value)} advertised`, `${CONTEXT_LABEL} ${tokens}`],
			band: null,
		};
	}

	const badge = basis === "declared" ? " ·decl" : "";
	const pct = fraction * 100;

	if (fraction > 1) {
		const word = basis === "measured" ? " eff" : "";
		return {
			rungs: [
				`${CONTEXT_LABEL} ${compact}/${fmtCompact(value)}${word}${badge} · ${Math.round(pct)}%`,
				`${CONTEXT_LABEL} ${tokens}${badge}`,
				`${CONTEXT_LABEL} ${compact}`,
			],
			band: null,
		};
	}

	const pair = `${CONTEXT_LABEL} ${pct.toFixed(1)}%/${fmtWindow(value)}${badge}`;
	const band = bandFor(fraction);
	// The floor is the token count (`ctx 302.1k`); the compact `ctx 314K` form belongs ONLY to the
	// >100% overflow shape, so it is not a rung here (designer #1680 ruling 1, step 4).
	return {
		rungs: [band ? `${pair} [${band.word}]` : pair, pair, `${CONTEXT_LABEL} ${tokens}`],
		band,
	};
}

/**
 * Render the ctx line for one seat's measure (from `health.context[seat]`).
 *
 * @param {Object|null} measure — item 27's measure: `{consumed, usage, window:{denominator,value}, fraction}`
 * @param {Object} [opts]
 * @param {number} [opts.width] — terminal width; the line's content budget is `width - 2`
 *   (the gutter). `Infinity` (default) always takes the widest rung.
 * @param {boolean} [opts.color] — emit ANSI (false = NO_COLOR/plain)
 * @returns {string} the whole line, gutter included; never cut mid-string
 */
export function formatContextLine(measure, { width = Infinity, color = false } = {}) {
	const inner = Number.isFinite(width) ? Math.max(0, width - 2) : Infinity;
	const { rungs, band } = rungsFor(measure);
	// The budget is CELLS (designer #1680 ruling 1), through the shared H4 helper.
	const chosen = rungs.find((r) => textWidth(r) <= inner) ?? rungs[rungs.length - 1];
	// Colour is an ACCENT on the band WORD, never on the whole line: the word carries the
	// meaning (it survives NO_COLOR), so colour must not become the signal.
	const word = `[${band?.word}]`;
	const painted =
		band && chosen.endsWith(word) ? chosen.slice(0, -word.length) + accent(band.tone, word, color) : chosen;
	return GUTTER + dim(painted, color);
}
