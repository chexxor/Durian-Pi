// src/inflight.mjs — the MID-RUN half of the active degeneration guard (item A / #1767).
//
// WHY. The existing guard (src/degeneration.mjs `assessRun`) is POST-SETTLEMENT: it reads
// COMMITTED entry pages, so it can only judge a run that already finished. `superviseOnce`
// runs between passes, and the resident broker passes `waitForWakes:false` (src/broker.mjs),
// so a turn that never settles is INVISIBLE to it and blocks quiescence (the F11 drain) —
// exactly the qa incident (docs/incidents/2026-10-17-qa-context-degeneration.md). This module
// is the TRIGGER that fires WHILE the agent is running, from the live observation seam.
//
// THE SEAM. `harness.subscribeCommits` fires on COMMITS — post-settlement, so it cannot see a
// turn that never settles. The in-flight seam is pi-durable's agent event stream,
// `watchEvents(harness, conversationId, ctx)` (dist/harness/events.d.ts): a `snapshot` plus a
// serialized batch per commit carrying `run_start`/`turn_start`, `message_update` (streamed
// text deltas + partial `usage`), `tool_execution_*`, `turn_end`/`run_end`. `message_update`
// fires many times DURING one turn (measured: 116 updates over a ~12.6s faux turn), so a bound
// on elapsed wall-clock and/or streamed volume can trip BEFORE `turn_end` — the point of item A.
//
// DETERMINISTIC-FIRST (#1766 Q3: zero false positives before enabling). Every cause is a
// number or a NAMED pattern, and it REUSES the landed detectors rather than duplicating them:
//   - per-turn WALL-CLOCK  → the SAME bound as #874 (`DEGEN_DEFAULTS.maxTurnDurationMs`), the
//     cause that reads a number the harness already persists, not a parse of prose;
//   - streamed VOLUME      → MODEL-AWARE: trip when estimated streamed tokens reach a share of
//     the seat's context window (DURIG_CONTEXT_WINDOW via src/config.mjs, the same denominator
//     state src/context.mjs defines; #1705). No window → NO token bound (honest: never invent a
//     fraction, per ROADMAP 27);
//   - degenerate PROSE     → the NAMED-PATTERN registry of #875 (`matchTextPatterns`), applied
//     to the text streamed SO FAR, so the reason names the pattern.
//
// SCOPE. This is the TRIGGER only (item A). The cooperative HALT actuator is item B (#1768) and
// the detect → halt → wait-idle → resolve ORDERING is the SHARED core of item C (#1769). Nothing
// here writes: `assessInflightTurn` is pure and `createInflightWatch` only folds events and
// reports a legible reason to its caller. No new write path, no new schema.

import { matchTextPatterns } from "./attention.mjs";
import { declaredContextWindow } from "./config.mjs";
import { DEGEN_DEFAULTS } from "./degeneration.mjs";

/**
 * Conservative, operator-tunable trip points. The wall-clock bound is the SAME cause as #874,
 * so a per-turn bound means one thing across durig; the rest are the in-flight-only bounds.
 */
export const INFLIGHT_DEFAULTS = {
	// Reuse #874's per-turn wall-clock cause and default (5 min): a legitimately slow turn must
	// never be reset, so the bound only catches a run burning minutes per turn without progress.
	maxTurnDurationMs: DEGEN_DEFAULTS.maxTurnDurationMs,
	// MODEL-AWARE volume bound (#1705): trip once the STREAMED text is estimated to have reached
	// this share of the seat's declared context window. Only consulted when a window is known.
	contextWindowFraction: 1,
	// Streamed text → tokens. The honest, model-agnostic estimate the harness itself uses for
	// prose (~4 chars/token); it only ever makes the bound MORE permissive, never less.
	charsPerToken: 4,
	// Optional ABSOLUTE streamed-character bound for the no-window case. null = off: with no
	// window declared we do NOT invent one, so only wall-clock (and prose) can trip.
	maxStreamedChars: null,
};

/** The declared context window for a seat, or null — the model-aware denominator (#1705). */
export function inflightWindow(config, modelKey = null) {
	return declaredContextWindow(config, modelKey);
}

/**
 * Assess ONE in-flight turn. Pure: no clock, no I/O — the caller passes `elapsedMs` and the
 * streamed text so the decision is deterministic and testable without a terminal or a harness.
 *
 * @param {{elapsedMs?:number, streamedChars?:number, streamedText?:string, contextWindow?:number|null}} turn
 * @returns {{degenerate:boolean, reasons:string[], elapsedMs:number, streamedChars:number,
 *   streamedTokens:number, contextWindow:number|null, patterns:string[]}}
 */
export function assessInflightTurn(turn, opts = {}) {
	const o = { ...INFLIGHT_DEFAULTS, ...opts };
	const elapsedMs = Number.isFinite(turn?.elapsedMs) ? turn.elapsedMs : 0;
	const streamedChars = Number.isFinite(turn?.streamedChars)
		? turn.streamedChars
		: typeof turn?.streamedText === "string"
			? turn.streamedText.length
			: 0;
	const streamedTokens = Math.ceil(streamedChars / o.charsPerToken);
	const contextWindow =
		Number.isFinite(turn?.contextWindow) && turn.contextWindow > 0 ? turn.contextWindow : null;
	const patterns =
		typeof turn?.streamedText === "string" && turn.streamedText.length > 0
			? matchTextPatterns(turn.streamedText)
			: [];

	const reasons = [];
	if (elapsedMs >= o.maxTurnDurationMs) {
		reasons.push(`turn-duration-ms=${elapsedMs}>=${o.maxTurnDurationMs}`);
	}
	if (contextWindow !== null && streamedTokens >= contextWindow * o.contextWindowFraction) {
		reasons.push(`streamed-tokens=${streamedTokens}>=${contextWindow * o.contextWindowFraction}`);
	}
	if (o.maxStreamedChars !== null && streamedChars >= o.maxStreamedChars) {
		reasons.push(`streamed-chars=${streamedChars}>=${o.maxStreamedChars}`);
	}
	for (const pattern of patterns) reasons.push(`degenerate-text=${pattern}`);

	return { degenerate: reasons.length > 0, reasons, elapsedMs, streamedChars, streamedTokens, contextWindow, patterns };
}

/** The concatenated `text_delta` of one `message_update` event (empty for any other event). */
function streamedDelta(event) {
	if (event?.type !== "message_update") return "";
	const changes = Array.isArray(event.changes) ? event.changes : [];
	let text = "";
	for (const change of changes) {
		if (change?.type === "text_delta" && typeof change.delta === "string") text += change.delta;
	}
	return text;
}

/**
 * Fold a live `AgentEventStream` into the CURRENT turn and report the first trip — the trigger.
 * Stateless about storage and the clock's source (both injected), so a demo can drive it with a
 * real harness and a controlled clock. `onTrip` fires AT MOST ONCE per turn (a judge/actuator
 * must not be spammed by every later `message_update`); the watch resets at `turn_end`.
 *
 * @param {{onTrip?:(assessment:object)=>void, opts?:object, now?:()=>number}} [config]
 */
export function createInflightWatch({ onTrip, opts = {}, now = () => Date.now() } = {}) {
	let turnStartedAt = null;
	let streamedText = "";
	let attempt = 0;
	let last = null;
	let trip = null;

	const evaluate = (at) => {
		if (turnStartedAt === null) return last;
		last = assessInflightTurn(
			{ elapsedMs: at - turnStartedAt, streamedChars: streamedText.length, streamedText, attempt },
			opts,
		);
		if (last.degenerate && trip === null) {
			trip = last;
			if (typeof onTrip === "function") onTrip(last);
		}
		return last;
	};

	return {
		/** Observe one event or one batch; returns the current assessment. */
		observeBatch(events, at = now()) {
			const batch = Array.isArray(events) ? events : [events];
			for (const event of batch) {
				switch (event?.type) {
					case "run_start":
						turnStartedAt = at;
						streamedText = "";
						attempt = 0;
						break;
					case "turn_start":
						turnStartedAt = at;
						streamedText = "";
						break;
					case "message_start":
						attempt += 1;
						break;
					case "message_update":
						streamedText += streamedDelta(event);
						break;
					case "turn_end":
					case "run_end": {
						const final = evaluate(at);
						turnStartedAt = null;
						return final;
					}
					default:
						break;
				}
			}
			return evaluate(at);
		},
		/** The latest in-flight assessment (null before the first observed turn). */
		current: () => last,
		get tripped() {
			return trip !== null;
		},
		/** The first trip's assessment, or null. */
		get trip() {
			return trip;
		},
	};
}
