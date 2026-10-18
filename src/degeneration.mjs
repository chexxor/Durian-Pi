// src/degeneration.mjs — detect a seat that has gone degenerate so the broker can
// RESET it before it burns the rig (mitigations 1+2 for the F29 class).
//
// Why this exists: durig already MEASURES step repetition and malformed tool calls
// (metrics.mjs) but nothing ACTED on them, so a seat could loop for hours and fill the
// rig with junk — seen live when `impl` degraded to word salad and wrote scratch files.
// The detector here is the missing reflex; supervisor.mjs turns a hit into a reset.
//
// Judged per RUN, not per conversation: the newest contiguous block of entries above the
// last `pi.user` wake. An old degenerate run sitting behind a wake is history, and must
// not keep the seat resetting forever. A page already ending in `pi.reset` is skipped
// outright, so a reset is not re-applied before the seat has run again (idempotence).

import {
	countLanguageDriftTurns,
	countMalformedToolCalls,
	countPseudoToolCalls,
	countTextPatternTurns,
} from "./attention.mjs";

/**
 * Conservative, operator-tunable trip points. Deliberately high: the repeat predicate
 * counts a legitimate identical call (re-reading a file after editing it) as a repeat,
 * so a low threshold would reset healthy seats. A run must badly OUTGROW a bound, not
 * merely touch it. (The limits are the mitigation for a run that never self-terminates;
 * being wrong here costs one context reset, not lost work — the transcript is durable.)
 */
export const DEGEN_DEFAULTS = {
	maxToolTurns: 50, // assistant turns that emit a tool call, within the run
	maxRepeats: 3, // identical tool calls within the run
	maxMalformed: 2, // harness malformed-argument rejections within the run
	maxPseudoToolCalls: 1, // a tool call emitted AS TEXT (no rejection to see): the run could not act
	// A reply written in another language (a Chinese-family model drifting back to its native
	// script). One clearly-CJK reply is the tell, because it self-conditions every later turn and
	// nothing else would reset it. The two thresholds keep a quoted Chinese string inside an
	// English report from tripping this.
	maxLanguageDrift: 1, // assistant turns whose reply is predominantly CJK
	minLanguageDriftChars: 40, // CJK characters that must appear in the reply
	minLanguageDriftRatio: 0.5, // share of the reply's CJK+Latin letters that are CJK
	// One turn matching a named PROSE pattern is enough: a word-salad turn is already a whole
	// wasted turn, and the patterns themselves are conservative (see TEXT_PATTERNS). The registry
	// names the pattern in the reason so a firing cause is legible.
	maxDegenerateText: 1,
	// CONTEXT PRESSURE is a SEAT-LEVEL signal, not a per-run one (lead #1816 Q1): the seat's CURRENT
	// context size is monotone and SURVIVES wakes, so it is read from the newest assistant entry of
	// the WHOLE page. The trip is a raw-token FLOOR **AND** a FRACTION of the resolved window, with a
	// CEILING (lead #1816 Q2): a pure fraction trips prematurely on a small window, and a huge
	// ADVERTISED window must not push the trip ABOVE the real degradation point (qa degraded at
	// 367,559 tokens against an advertised 1,048,576 — "advertised != usable").
	minContextTokens: 200_000, // FLOOR: below this, context alone never trips
	// FRACTION of the resolved window — CALIBRATED on qa's real conv-15 turns (#1705 Defect B), not anchored.
	// The four cited turns, all against an advertised 1,048,576: 70742 = 351,353 tokens (the first
	// visibly degenerate one), 70973 = 351,597, 71053 = 352,581, 71502 = 367,559 (the collapse). So the
	// trip must sit at or below 351,353 / 1,048,576 = 0.335 to catch the FIRST degenerate turn; 0.35
	// (367,002) missed the first three. 0.33 (346,030) catches all four and still clears the healthy
	// 300,000 anchor (0.286). The lower end of that bracket rests on a synthetic healthy figure, so the
	// wiring half must not ENABLE the trip until a real healthy-session measurement replaces it.
	contextFraction: 0.33,
	contextCeilingTokens: 600_000, // CEILING: the trip never exceeds this
	// The RESOLVED window (measured > declared > advertised), supplied by the caller (the cli.mjs
	// model-resolution half). null => the context cause is SKIPPED with a `why`, never guessed.
	contextWindowTokens: null,
	// Per-turn WALL-CLOCK, its OWN cause and NOT the prose detector. It reads a number the harness
	// already persists (AssistantMessage.durationMs), not a parse of prose, so a healthy long
	// document cannot trip it — the failure mode that reverted the D78 text heuristic. Deliberately
	// HIGH (5 min): a legitimately slow turn must never be reset, so the bound only catches a run
	// that is burning minutes per turn without progressing. Operator-tunable through `opts`, the
	// same seam as every other limit here.
	maxTurnDurationMs: 5 * 60_000,
	repeatHorizon: 3, // matches metrics.REPEAT_HORIZON: a repeat is seen within 3 calls
};

function messageOf(entry) {
	return Array.isArray(entry?.model) ? entry.model[0] : null;
}

/** Stable stringify, so the same arguments in a different key order compare equal. */
function canonical(value) {
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	const keys = Object.keys(value).sort();
	return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}

/** The `name|canonical(args)` keys of the tool calls one assistant entry emitted. */
function toolCallKeys(entry) {
	const content = messageOf(entry)?.content;
	if (!Array.isArray(content)) return [];
	return content
		.filter((part) => part?.type === "toolCall")
		.map((part) => `${String(part.name ?? "")}|${canonical(part.arguments)}`);
}

/**
 * Assess one seat's entry page. `entriesNewestFirst` is storage order (as
 * `readSeatPages` returns it), so the current run is read by walking backwards from the
 * newest entry until the wake that started it.
 *
 * @returns {{degenerate:boolean, justReset:boolean, reasons:string[], toolTurns:number,
 *   repeats:number, malformed:number, pseudoToolCalls:number, languageDrift:number,
 *   degenerateText:Object, contextTokens:number, turnDurationMs:number, calls:number}}
 */
export function assessRun(entriesNewestFirst, opts = {}) {
	const o = { ...DEGEN_DEFAULTS, ...opts };
	const items = Array.isArray(entriesNewestFirst) ? entriesNewestFirst : [];
	const empty = {
		degenerate: false,
		justReset: false,
		reasons: [],
		toolTurns: 0,
		repeats: 0,
		malformed: 0,
		pseudoToolCalls: 0,
		languageDrift: 0,
		degenerateText: {},
		contextTokens: 0,
		contextWindow: null,
		contextTrip: null,
		contextSkip: "no-entries",
		turnDurationMs: 0,
		calls: 0,
	};
	if (items.length === 0) return empty;

	// The current run: entries newer than the last wake OR the last reset, reversed to read
	// forward in time. A `pi.reset` is a RUN BOUNDARY exactly like a wake — it starts a fresh
	// context, so entries older than it are history. Without this, the run that was JUST reset
	// still counted as the current run (a reset is not a `pi.user`), so the guard re-fired every
	// pass: 20+ consecutive `pi.reset` entries with no intervening turn (#1704).
	const runNewestFirst = [];
	let justReset = false;
	for (const entry of items) {
		if (entry?.kind === "pi.user") break;
		if (entry?.kind === "pi.reset") {
			justReset = true;
			break;
		}
		runNewestFirst.push(entry);
	}
	const run = [...runNewestFirst].reverse();

	// Every per-TURN cause is counted over ASSISTANT turns only. A `pi.tool-result` entry is the
	// TOOL's runtime, not a model turn: its `durationMs` is how long the tool ran, so a
	// legitimate ~5-minute demo sweep was read as a ~5-minute MODEL stall and tripped the stall
	// bound, resetting the seat in a hot loop (#1703). The harness's malformed-argument marker is
	// the one exception: it rides the tool RESULT, so `malformed` stays over the whole run.
	const assistantRun = run.filter((entry) => entry?.kind === "pi.assistant");

	let toolTurns = 0;
	let calls = 0;
	let repeats = 0;
	const recent = [];
	for (const entry of assistantRun) {
		const keys = toolCallKeys(entry);
		if (keys.length > 0) toolTurns++;
		for (const key of keys) {
			calls++;
			if (recent.includes(key)) repeats++;
			recent.push(key);
			if (recent.length > o.repeatHorizon) recent.shift();
		}
	}

	const malformed = countMalformedToolCalls(run);
	// A tool call written as TEXT submits nothing to the harness, so it never becomes a
	// validation rejection — the `malformed` count above is structurally blind to it. That
	// run settled "done" while the seat did not act, so it is its own degenerate cause.
	const pseudoToolCalls = countPseudoToolCalls(assistantRun);
	// A reply in another language is a separate fault from repetition: the run can be
	// structurally clean and still be unusable to the operator, and a drifted turn
	// self-conditions the next. `countLanguageDriftTurns` owns the script test.
	const languageDrift = countLanguageDriftTurns(assistantRun, {
		minChars: o.minLanguageDriftChars,
		minRatio: o.minLanguageDriftRatio,
	});
	// Degenerate PROSE: the same shape the D78 heuristic chased, but read by a NAMED-PATTERN
	// registry so each shape is independently testable and the reason names the pattern. Counted
	// per pattern, so a run can trip on one shape without the others.
	const degenerateText = countTextPatternTurns(assistantRun);
	const contextTokens = (() => {
		// CONTEXT PRESSURE is the SEAT's current size, read from the newest assistant entry of the
		// WHOLE page (it survives wakes); every other cause above stays per-run (lead #1816 Q1).
		for (const entry of items) {
			if (entry?.kind !== "pi.assistant") continue;
			const tokens = messageOf(entry)?.usage?.totalTokens;
			if (Number.isFinite(tokens)) return tokens;
		}
		return 0;
	})();
	// The slowest single ASSISTANT turn of the run. `durationMs` is absent on legacy messages, so a
	// run of old entries reads 0 and is never flagged on this cause. Tool-result durations are the
	// TOOL's runtime and are deliberately excluded (#1703).
	const turnDurationMs = assistantRun.reduce((max, entry) => {
		const ms = messageOf(entry)?.durationMs;
		return Number.isFinite(ms) ? Math.max(max, ms) : max;
	}, 0);

	const reasons = [];
	if (toolTurns >= o.maxToolTurns) reasons.push(`tool-turns=${toolTurns}>=${o.maxToolTurns}`);
	if (repeats >= o.maxRepeats) reasons.push(`repeats=${repeats}>=${o.maxRepeats}`);
	if (malformed >= o.maxMalformed) reasons.push(`malformed=${malformed}>=${o.maxMalformed}`);
	if (pseudoToolCalls >= o.maxPseudoToolCalls) {
		reasons.push(`pseudo-tool-call=${pseudoToolCalls}>=${o.maxPseudoToolCalls}`);
	}
	if (languageDrift >= o.maxLanguageDrift) {
		reasons.push(`language-drift=${languageDrift}>=${o.maxLanguageDrift}`);
	}
	for (const [pattern, count] of Object.entries(degenerateText)) {
		if (count >= o.maxDegenerateText) {
			reasons.push(`degenerate-text=${pattern}=${count}>=${o.maxDegenerateText}`);
		}
	}
	const contextWindow =
		Number.isFinite(o.contextWindowTokens) && o.contextWindowTokens > 0 ? o.contextWindowTokens : null;
	// Trip at min(fraction*window, ceiling), and only ABOVE the raw-token floor (lead #1816 Q2).
	const contextTrip =
		contextWindow === null ? null : Math.min(contextWindow * o.contextFraction, o.contextCeilingTokens);
	let contextSkip = null;
	if (contextWindow === null) contextSkip = "no-context-window";
	else if (contextTokens < o.minContextTokens) contextSkip = "below-floor";
	else if (contextTokens < contextTrip) contextSkip = "below-trip";
	if (contextTrip !== null && contextTokens >= o.minContextTokens && contextTokens >= contextTrip) {
		reasons.push(`context-tokens=${contextTokens}>=${contextTrip}`);
	}
	if (turnDurationMs >= o.maxTurnDurationMs) {
		reasons.push(`turn-duration-ms=${turnDurationMs}>=${o.maxTurnDurationMs}`);
	}

	return {
		degenerate: reasons.length > 0,
		justReset,
		reasons,
		toolTurns,
		repeats,
		malformed,
		pseudoToolCalls,
		languageDrift,
		degenerateText,
		contextTokens,
		contextWindow,
		contextTrip,
		contextSkip,
		turnDurationMs,
		calls,
	};
}
