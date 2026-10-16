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

import { countMalformedToolCalls } from "./attention.mjs";

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
	maxContextTokens: 400_000, // newest turn's prompt size (a backstop, not the primary trip)
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
 *   repeats:number, malformed:number, contextTokens:number, calls:number}}
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
		contextTokens: 0,
		calls: 0,
	};
	if (items.length === 0) return empty;
	// A just-reset seat has not run since; skip so the reset is not re-applied in a loop.
	if (items[0]?.kind === "pi.reset") return { ...empty, justReset: true };

	// The current run: entries newer than the last wake, reversed to read forward in time.
	const runNewestFirst = [];
	for (const entry of items) {
		if (entry?.kind === "pi.user") break;
		runNewestFirst.push(entry);
	}
	const run = [...runNewestFirst].reverse();

	let toolTurns = 0;
	let calls = 0;
	let repeats = 0;
	const recent = [];
	for (const entry of run) {
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
	const contextTokens = run.reduce((max, entry) => {
		const tokens = messageOf(entry)?.usage?.totalTokens;
		return Number.isFinite(tokens) ? Math.max(max, tokens) : max;
	}, 0);

	const reasons = [];
	if (toolTurns >= o.maxToolTurns) reasons.push(`tool-turns=${toolTurns}>=${o.maxToolTurns}`);
	if (repeats >= o.maxRepeats) reasons.push(`repeats=${repeats}>=${o.maxRepeats}`);
	if (malformed >= o.maxMalformed) reasons.push(`malformed=${malformed}>=${o.maxMalformed}`);
	if (contextTokens >= o.maxContextTokens) reasons.push(`context-tokens=${contextTokens}>=${o.maxContextTokens}`);

	return {
		degenerate: reasons.length > 0,
		justReset: false,
		reasons,
		toolTurns,
		repeats,
		malformed,
		contextTokens,
		calls,
	};
}
