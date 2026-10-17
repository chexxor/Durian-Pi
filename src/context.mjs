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

/** The four `usage` fields that sum to the tokens a turn consumed. `reasoning` is
 * deliberately absent: the vendor type documents it as a subset of `output`. */
export const CONSUMED_USAGE_FIELDS = ["input", "output", "cacheRead", "cacheWrite"];

/** The three denominator states, most trustworthy first. The ORDER is the resolution
 * rule, so a reader can see why one won. */
export const CONTEXT_DENOMINATORS = ["measured", "declared", "advertised"];

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
	};
}
