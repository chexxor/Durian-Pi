// src/context.mjs — item 27's per-seat context-consumption measure (ROADMAP 27, #1192).
//
// Why this exists: a seat's context only ever grows, and the FIRST signal an operator
// gets is a seat behaving worse — not a number. This is that number, read from what the
// store already persists (D11: no harness, no write path, no egress), so `status`/`watch`
// and the TUI can show context pressure BEFORE it becomes a behaviour change.
//
// THE MEASURE. Per seat, the NEWEST assistant entry's `usage`, summed as
// input + output + cacheRead + cacheWrite (the four fields the vendor type carries —
// `vendor/…/pi-ai/dist/types.d.ts` `interface Usage`). `reasoning` is a SUBSET of
// `output` (the same type says so), so adding it would DOUBLE-COUNT; it is carried
// through for display but never summed.
//
// THE DENOMINATOR IS THREE-STATE, AND THE STATE TRAVELS WITH THE VALUE. ROADMAP 27 is
// explicit that "advertised != usable": a percentage-of-window display against a vendor
// figure is false precision. So we never emit a fraction without naming which denominator
// produced it, and we prefer the most trustworthy one that is actually available:
//
//   measured   — item 97's EFFECTIVE window (#1087, qa): a property of the weights, so it
//                takes a measurement. Not built yet, so it is absent today — but the state
//                is reserved and wins the moment it exists.
//   declared   — the operator's declared usable window (config): the honest middle, and
//                the best available today.
//   advertised — the vendor catalog figure: the least trustworthy, so it is LAST.
//
// When none is available the denominator is `null` and NO fraction is produced (a bare
// token count is still honest; a percentage with no window is not).
//
// WHAT THE NUMBER IS NOT, and this is the part a guard must carry (ROADMAP 208 / #5049):
//
//   1. `consumed` is ONE TURN's moved tokens, NOT the live context head. The newest
//      assistant entry is the newest REPORTED count, so a seat that was compacted or reset
//      after a long turn keeps reporting that old turn until its NEXT turn. D199/D200
//      recorded exactly this artifact (a seat reading 244,751 after its own capacity change).
//      So the measure also reports its HEAD STATE: whether a `pi.compaction`/`pi.reset`
//      entry sits NEWER than the turn it measured. A measure behind such a boundary is
//      labelled stale and must not be treated as pressure the seat is in right now.
//   2. `cacheRead` is in the sum, so the axis is "tokens the provider MOVED", not "tokens
//      re-read". On this rig the two differ by ~20x (an 8,757-token cached prefix costs
//      ~0.1s of prompt time), so a fraction can exceed 1 while the seat's actual prompt is
//      small. Anything that shows the fraction has to say which axis it is on.

/** The four `usage` fields that sum to the tokens a turn consumed. `reasoning` is
 * deliberately absent: the vendor type documents it as a subset of `output`. */
export const CONSUMED_USAGE_FIELDS = ["input", "output", "cacheRead", "cacheWrite"];

/** The three denominator states, most trustworthy first. The ORDER is the resolution
 * rule, so a reader can see why one won. */
export const CONTEXT_DENOMINATORS = ["measured", "declared", "advertised"];

/**
 * The entry kinds that RESET a seat's head. Mirrors `HEAD_MARKER_KINDS` in
 * `src/compacteval.mjs` — one vocabulary for "the head moved" — and `demo/context-over-window.test.mjs`
 * pins that the two lists agree, because the drift would show up as a guard silently
 * stopping firing, not as a failure.
 */
export const CONTEXT_HEAD_MARKERS = ["pi.compaction", "pi.reset"];

/** A finite, strictly-positive window, or null. Zero/negative/NaN are "no window". */
function positiveOrNull(value) {
	const n = typeof value === "number" ? value : Number(value);
	return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The tokens one turn's `usage` consumed: input + output + cacheRead + cacheWrite.
 * Returns null when there is no usage object at all (an assistant turn the provider
 * did not report counts for), and 0 when every field is present and zero — a real,
 * honest zero is not the same as "unknown".
 */
export function usageConsumed(usage) {
	if (!usage || typeof usage !== "object") return null;
	let sum = 0;
	let sawField = false;
	for (const field of CONSUMED_USAGE_FIELDS) {
		const value = usage[field];
		if (Number.isFinite(value)) {
			sum += value;
			sawField = true;
		}
	}
	return sawField ? sum : null;
}

/**
 * The newest assistant entry's `usage` from a newest-first page (the order
 * `readSeatPages` returns). A turn with no usage is skipped rather than terminating the
 * scan: the newest entry is often a pure tool call whose provider reported nothing, and
 * the last REPORTED count is still the seat's context. Returns null when no assistant
 * entry carries usage.
 */
export function newestAssistantUsage(entries) {
	for (const entry of entries ?? []) {
		if (entry?.kind !== "pi.assistant") continue;
		const message = Array.isArray(entry.model) ? entry.model[0] : null;
		const usage = message?.usage;
		if (usage && typeof usage === "object" && usageConsumed(usage) !== null) return usage;
	}
	return null;
}

/**
 * Where the measured turn sits relative to the head. A newest-first page (the order
 * `readSeatPages` returns) is assumed, and that assumption is LOAD-BEARING but safe: only a
 * marker NEWER than the measured entry can invalidate it, and a newer entry is always at
 * least as near the head of the page as an entry that IS on the page — so a BOUNDED page
 * cannot miss the boundary that matters. `demo/context-over-window.test.mjs` pins that with
 * a deep fixture rather than trusting the argument.
 *
 *   no-usage         — no assistant entry on the page reports usage; the measure says nothing.
 *   current          — nothing has moved the head since the measured turn.
 *   behind-boundary  — a compaction/reset is NEWER than the measured turn: the number is a
 *                      HISTORIC turn's cost, not this seat's pressure. Reported, never hidden,
 *                      but it is not a firing condition.
 *   unknown          — the entries carry no ids, so the ordering cannot be established.
 */
export function headState(entries) {
	let sawUsage = false;
	let usageEntryId = null;
	let sawBoundary = false;
	let boundaryEntryId = null;
	for (const entry of entries ?? []) {
		if (!sawUsage && entry?.kind === "pi.assistant") {
			const message = Array.isArray(entry.model) ? entry.model[0] : null;
			if (usageConsumed(message?.usage) !== null) {
				sawUsage = true;
				usageEntryId = Number.isFinite(entry.id) ? entry.id : null;
			}
		}
		if (!sawBoundary && CONTEXT_HEAD_MARKERS.includes(entry?.kind)) {
			sawBoundary = true;
			boundaryEntryId = Number.isFinite(entry.id) ? entry.id : null;
		}
		if (sawUsage && sawBoundary) break;
	}
	if (!sawUsage) return { state: "no-usage", usageEntryId: null, boundaryEntryId };
	if (!sawBoundary) return { state: "current", usageEntryId, boundaryEntryId: null };
	if (usageEntryId === null || boundaryEntryId === null) return { state: "unknown", usageEntryId, boundaryEntryId };
	return boundaryEntryId > usageEntryId
		? { state: "behind-boundary", usageEntryId, boundaryEntryId }
		: { state: "current", usageEntryId, boundaryEntryId };
}

/**
 * Resolve the denominator: the most trustworthy state that has a value, plus ALL three
 * candidates so a renderer can show why (and what it fell back from). `denominator` is
 * null when no state has a window — the caller must then show the bare token count.
 */
export function windowState({ measured = null, declared = null, advertised = null } = {}) {
	const candidates = {
		measured: positiveOrNull(measured),
		declared: positiveOrNull(declared),
		advertised: positiveOrNull(advertised),
	};
	for (const denominator of CONTEXT_DENOMINATORS) {
		const value = candidates[denominator];
		if (value !== null) return { denominator, value, candidates };
	}
	return { denominator: null, value: null, candidates };
}

/**
 * The whole measure for one seat: the consumed token count, the usage it came from (for
 * display, including `reasoning`), the resolved window with its three candidates, and the
 * fraction — which is null unless a window exists. `windows` is `{measured, declared,
 * advertised}`; the caller decides where each comes from (see `readRigHealth`).
 */
export function contextConsumption(entries, windows = {}) {
	const usage = newestAssistantUsage(entries);
	const consumed = usageConsumed(usage);
	const window = windowState(windows);
	return {
		consumed,
		usage: usage
			? {
					input: Number.isFinite(usage.input) ? usage.input : null,
					output: Number.isFinite(usage.output) ? usage.output : null,
					cacheRead: Number.isFinite(usage.cacheRead) ? usage.cacheRead : null,
					cacheWrite: Number.isFinite(usage.cacheWrite) ? usage.cacheWrite : null,
					// Display-only: documented as a SUBSET of `output`, never summed.
					reasoning: Number.isFinite(usage.reasoning) ? usage.reasoning : null,
				}
			: null,
		window,
		fraction: consumed !== null && window.value !== null ? consumed / window.value : null,
		// #5049: whether this measure still describes the head. A renderer may print the number
		// either way; a GUARD may not treat a behind-boundary measure as current pressure.
		head: headState(entries),
	};
}

/**
 * The fraction over which one turn exceeded its window: 1, not a warning band. The measure is
 * one turn's moved tokens, so a value BELOW 1 cannot honestly say "the head is approaching the
 * window" — it can only say this turn fit. Only over-1 states a fact: a single turn moved more
 * than the window allows. (The TUI's display bands in `src/tui/ctxline.mjs` — crit at 0.9 — are
 * a display choice about the same number; they are not a trigger and are not this threshold.)
 */
export const CONTEXT_OVER_WINDOW_FRACTION = 1;

/**
 * Does this measure describe ONE TURN THAT MOVED MORE THAN ITS WINDOW, on a head that is still
 * current? Returns `{fired, reason}` either way — the REASON is the point, because the excluded
 * cases are what stop the guard becoming a false alarm that gets switched off (#3539):
 *
 *   no-usage         — nothing was measured.
 *   no-window        — no denominator at any state, so there is no fraction to compare.
 *   within-window    — the turn fit inside its window.
 *   behind-boundary  — a compaction/reset is newer than the measured turn (the D199/D200 artifact:
 *                      a post-reset seat legitimately prints a fraction over 1).
 *   head-unknown     — the page carries no entry ids, so the boundary cannot be located.
 *
 * `keepRecentTokens` is the compaction verb's OWN gate (the selection gate is the accumulation
 * budget, not the window — `compactionReport`, #4898). It is supplied by the caller who read the
 * config; when it is absent the result says the gate is unknown rather than inventing a number,
 * so a remedy can tell the operator whether `compact` would cut or decline.
 */
export function contextOverWindow(measure, { keepRecentTokens = null } = {}) {
	const consumed = measure?.consumed ?? null;
	if (consumed === null) return { fired: false, reason: "no-usage" };
	const window = measure?.window ?? null;
	if (!window || window.value === null) return { fired: false, reason: "no-window" };
	const fraction = measure?.fraction ?? null;
	if (fraction === null || fraction <= CONTEXT_OVER_WINDOW_FRACTION) return { fired: false, reason: "within-window" };
	const state = measure?.head?.state ?? "unknown";
	if (state !== "current") return { fired: false, reason: state === "behind-boundary" ? "behind-boundary" : `head-${state}` };
	const keep = Number.isFinite(keepRecentTokens) ? keepRecentTokens : null;
	return {
		fired: true,
		reason: null,
		fraction,
		consumed,
		denominator: window.denominator,
		windowValue: window.value,
		cacheRead: measure?.usage?.cacheRead ?? null,
		head: measure.head,
		keepRecentTokens: keep,
		willCut: keep === null ? null : consumed >= keep,
	};
}
