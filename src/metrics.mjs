// Metrics: the measures that answer "is this rig getting worse?".
//
// Policy is D24 (the research concerns are measured, not listed); the design is
// docs/METRICS.md. What those two settle is this module's shape: it is PURE. It
// takes entries, queue items and resolved seat models, and returns values that
// carry their own declaration - band, direction, evidence class, blind spot.
// Every surface (`metrics`, `status`, the `watch` footer) renders this one
// computation, so a number can never disagree with itself between views.
//
// Evidence classes are D24's three, named as D24 names them:
//   direct         counted from what the store already persists
//   proxy          a stand-in for a concern that cannot be read directly; the
//                  docs call its baseline "code-gated" because what the tool
//                  surface allows decides whether it can ever read clean
//   config-derived a property of the rig spec, NOT a rate over time (so it has
//                  no direction and no trend - see measureHasTrend)
//
// Nothing here writes, opens a socket, or creates a table.

import { ANSI } from "./ansi.mjs";
import { countMalformedToolCalls } from "./attention.mjs";
import { seatsAreVerifier } from "./checkup.mjs";

/**
 * A tool call whose canonical key duplicates one the same seat made within its
 * previous REPEAT_HORIZON calls is counted as a repeated step. The horizon is
 * what catches an alternating loop (A,B,A,B); it is deliberately short, because
 * a long-range duplicate is more often a legitimate re-read than a stuck seat.
 */
const REPEAT_HORIZON = 3;

/**
 * Tool names that count as retrieving something the answer must be grounded in.
 * The list is the measure's biggest blind spot and is printed with the value: a
 * seat given no read tool at all cannot retrieve, so "100% unverified" can mean
 * the capability is missing rather than that the seat is careless.
 */
export const RETRIEVAL_TOOLS = [
	"read",
	"read_file",
	"grep",
	"glob",
	"search",
	"retrieve",
	"fetch",
	"lookup",
	"corpus_read",
];

/**
 * Every measure declares itself here rather than in documentation, because a
 * clean reading whose blind spot is unwritten reads as a pass. `ambient` is the
 * docs' admission test: a measure reaches the ambient tier only when it is
 * actionable turn-by-turn, rare when abnormal, AND not already visible. Cost
 * fails "actionable"; shared-reviewer-model fails "not already visible" (it is
 * a `check` rule), so both stay in the deliberate table.
 */
export const MEASURES = {
	"step-repetition": {
		scope: "rig",
		klass: "direct",
		direction: "up-worse",
		unit: "of tool calls repeat one the seat just made",
		band: { kind: "relative", enter: 2, exit: 1 },
		ambient: true,
		what: "a seat stuck re-taking a step it already took (MAST step repetition)",
		blind:
			`a legitimate identical call (re-reading a file after editing it) counts as a repeat, and only repeats within ${REPEAT_HORIZON} calls are seen`,
	},
	"malformed-tool-call": {
		scope: "rig",
		klass: "direct",
		direction: "up-worse",
		unit: "tool calls rejected as malformed arguments",
		band: { kind: "absolute", enter: 2, exit: 0 },
		ambient: true,
		what: "a seat emitting tool-call arguments the harness rejects (a cause, not a domain error)",
		blind:
			"reads the harness's validation text on the entry because the structured diagnostic code is not persisted; a differently-worded rejection is missed",
	},
	"unverified-completions": {
		scope: "rig",
		klass: "proxy",
		direction: "up-worse",
		unit: "of completions ran with no retrieval call first",
		band: { kind: "relative", enter: 2, exit: 1 },
		ambient: true,
		what: "work declared complete without retrieving anything to ground it (MAST FC3)",
		blind:
			`"retrieval" means a call named one of ${RETRIEVAL_TOOLS.join("/")}; a seat with no read tool cannot retrieve, so all-unverified can mean the capability is missing`,
	},
	"queue-ageing": {
		scope: "queue",
		klass: "direct",
		direction: "up-worse",
		unit: "minutes since the oldest queued item last changed state",
		band: { kind: "absolute", enter: 30, exit: 15 },
		ambient: true,
		what: "a queued item nobody has picked up",
		blind:
			"counts wall-clock age, not effort: an item can sit queued because the rig is paused",
	},
	"shared-reviewer-model": {
		scope: "rig",
		klass: "config-derived",
		direction: "none",
		unit: "of verifier seats share a model with an author they check",
		band: { kind: "absolute", enter: 1, exit: 0 },
		ambient: false,
		what: "correlated failure: a reviewer sharing the author's blind spot (Anthropic swarm)",
		blind:
			"reads the rig spec, not behaviour; it says a bias CAN be shared, never that it was",
	},
};

/** Config-derived measures have nothing to trend: the arrow would be a lie. */
export function measureHasTrend(measure) {
	return measure.klass !== "config-derived";
}

/** Stable stringify, so two calls with the same arguments in a different key
 * order compare equal. Argument order is not a semantic difference. */
function canonical(value) {
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	const keys = Object.keys(value).sort();
	return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}

/**
 * Malformed-argument tool calls across the rig's pages. Direct: counted from persisted entries via
 * the same predicate the attention notice uses, so the measure and the notice cannot disagree.
 */
export function measureMalformedToolCalls(pages) {
	let value = 0;
	for (const items of Object.values(pages ?? {})) value += countMalformedToolCalls(items);
	return { value };
}

function messageOf(entry) {
	return Array.isArray(entry?.model) ? entry.model[0] : null;
}

function atOf(entry) {
	const t = messageOf(entry)?.timestamp;
	const ms = typeof t === "number" ? t : Date.parse(t ?? "");
	return Number.isFinite(ms) ? ms : 0;
}

/** Tool calls an assistant entry emitted, in the order it emitted them. */
function toolCallsOf(entry) {
	const content = messageOf(entry)?.content;
	if (!Array.isArray(content)) return [];
	return content
		.filter((part) => part?.type === "toolCall")
		.map((part) => ({ name: String(part.name ?? "") }));
}

/** Storage returns entries newest-first; every measure reads time forwards. */
function ascending(items) {
	return [...(items ?? [])].sort((a, b) => atOf(a) - atOf(b));
}

/* ---------------------------------------------------------------- measures */

export function measureStepRepetition(pages) {
	let calls = 0;
	let repeats = 0;
	for (const items of Object.values(pages ?? {})) {
		const recent = [];
		for (const entry of ascending(items)) {
			const content = messageOf(entry)?.content;
			if (!Array.isArray(content)) continue;
			for (const part of content) {
				if (part?.type !== "toolCall") continue;
				const key = `${String(part.name ?? "")}|${canonical(part.arguments)}`;
				calls++;
				if (recent.includes(key)) repeats++;
				recent.push(key);
				if (recent.length > REPEAT_HORIZON) recent.shift();
			}
		}
	}
	return { numerator: repeats, denominator: calls, value: calls === 0 ? null : repeats / calls };
}

export function measureUnverifiedCompletions(pages) {
	let completions = 0;
	let unverified = 0;
	for (const items of Object.values(pages ?? {})) {
		const ordered = ascending(items);
		// A bounded page begins mid-turn, and a completion near that edge would
		// read "unverified" only because its retrieval fell off the page. Start
		// at the first turn boundary so only whole turns are counted.
		const firstUser = ordered.findIndex((entry) => entry?.kind === "pi.user");
		if (firstUser < 0) continue;
		let retrieved = false;
		for (const entry of ordered.slice(firstUser)) {
			if (entry?.kind === "pi.user") {
				retrieved = false;
				continue;
			}
			for (const call of toolCallsOf(entry)) {
				if (RETRIEVAL_TOOLS.includes(call.name)) retrieved = true;
				if (call.name !== "complete_work") continue;
				completions++;
				if (!retrieved) unverified++;
			}
		}
	}
	return {
		numerator: unverified,
		denominator: completions,
		value: completions === 0 ? null : unverified / completions,
	};
}

function lastTransitionAt(item) {
	const t = (item?.transitions ?? []).at(-1)?.at;
	const ms = typeof t === "number" ? t : Date.parse(t ?? "");
	return Number.isFinite(ms) ? ms : null;
}

export function measureQueueAgeing(queueItems, nowMs) {
	const queued = (queueItems ?? []).filter((item) => item?.status === "queued");
	let oldest = null;
	for (const item of queued) {
		const at = lastTransitionAt(item);
		if (at === null) continue;
		const age = nowMs - at;
		if (oldest === null || age > oldest.ageMs) {
			oldest = { id: item.id, to: item.to, ageMs: age, at };
		}
	}
	if (oldest === null) {
		return { numerator: null, denominator: queued.length, value: null, oldest: null };
	}
	return {
		numerator: oldest.ageMs,
		denominator: queued.length,
		value: oldest.ageMs / 60000,
		oldest: { id: oldest.id, to: oldest.to, ageMs: oldest.ageMs },
	};
}

export function measureSharedReviewerModel({ seats = [], modelsBySeat = {} }) {
	const verifiers = seats.filter(seatsAreVerifier);
	const authorModels = new Set(
		seats
			.filter((seat) => !seatsAreVerifier(seat))
			.map((seat) => modelsBySeat[seat.name])
			.filter(Boolean),
	);
	const shared = verifiers.filter((seat) => authorModels.has(modelsBySeat[seat.name]));
	// With no verifier seat there is nothing to judge - that is `check`'s
	// finding to raise, and reporting 0 here would read as an all-clear.
	const judgeable = verifiers.length > 0 && authorModels.size > 0;
	return {
		numerator: shared.length,
		denominator: verifiers.length,
		value: judgeable ? shared.length : null,
		shared: shared.map((seat) => seat.name),
	};
}

/* ------------------------------------------------------------------ window */

/**
 * Split each seat's page into the newest half of its turns and the older half.
 * The baseline is the older half, so a trend exists without any stored state -
 * the whole point of D24's read-only stance. A seat with fewer than two turns
 * contributes only to the current window and reports no baseline.
 */
export function splitWindows(pages) {
	const current = {};
	const previous = {};
	for (const [seat, items] of Object.entries(pages ?? {})) {
		const ordered = ascending(items);
		const starts = [];
		ordered.forEach((entry, i) => {
			if (entry?.kind === "pi.user") starts.push(i);
		});
		if (starts.length < 2) {
			current[seat] = ordered;
			continue;
		}
		const cut = starts[Math.floor(starts.length / 2)];
		previous[seat] = ordered.slice(0, cut);
		current[seat] = ordered.slice(cut);
	}
	return { current, previous };
}

/* -------------------------------------------------------------------- band */

/**
 * Where a value sits relative to its band. A relative band enters at
 * `enter x baseline` and would exit at `exit x baseline`; the deadband is what
 * stops a notice flapping at the boundary. Returns the state word the renderer
 * prints, so no reader needs the threshold.
 */
export function evaluateBand(measure, value, baseline) {
	if (value === null || value === undefined) {
		return { state: "silent", why: "no data in the window" };
	}
	const band = measure.band;
	if (band.kind === "absolute") {
		return { state: value >= band.enter ? "warn" : "ok", threshold: band.enter };
	}
	if (baseline === null || baseline === undefined) {
		// Claim nothing. A value with no baseline is reported, not judged.
		return { state: "unknown", why: "no baseline yet" };
	}
	if (baseline === 0) {
		// k x 0 is 0, so the relative rule could never fire, and a rig could
		// climb from nothing to anything in silence. Any movement off zero is
		// the signal.
		return { state: value > 0 ? "warn" : "ok", threshold: 0 };
	}
	const enter = band.enter * baseline;
	return {
		state: value >= enter ? "warn" : "ok",
		threshold: enter,
		exit: band.exit * baseline,
	};
}

/* ------------------------------------------------------------- computation */

function row(id, result, baseline, extra = {}) {
	const measure = MEASURES[id];
	return {
		id,
		scope: measure.scope,
		klass: measure.klass,
		direction: measure.direction,
		unit: measure.unit,
		what: measure.what,
		blind: measure.blind,
		value: result.value,
		numerator: result.numerator ?? null,
		denominator: result.denominator ?? null,
		baseline: measureHasTrend(measure) && baseline !== undefined ? baseline : null,
		...evaluateBand(measure, result.value, baseline),
		...extra,
	};
}

/**
 * The one computation every surface renders.
 *
 * @param {object} input
 * @param {object} input.pages         seat name -> entries, newest first
 * @param {Array}  input.queueItems    the queue document's items
 * @param {Array}  input.seats         [{name, role}] for the config-derived measure
 * @param {object} input.modelsBySeat  seat name -> "provider/model"
 * @param {number} input.nowMs         injected so tests are deterministic
 * @param {boolean} input.bounded      true when pages were cut by a scan limit
 */
export function computeMetrics({
	pages = {},
	queueItems = [],
	seats = [],
	modelsBySeat = {},
	nowMs = Date.now(),
	bounded = false,
} = {}) {
	const { current, previous } = splitWindows(pages);

	const reps = measureStepRepetition(current);
	const repsPrev = measureStepRepetition(previous);
	const unver = measureUnverifiedCompletions(current);
	const unverPrev = measureUnverifiedCompletions(previous);
	const malformed = measureMalformedToolCalls(current);
	const malformedPrev = measureMalformedToolCalls(previous);
	const ageing = measureQueueAgeing(queueItems, nowMs);
	const shared = measureSharedReviewerModel({ seats, modelsBySeat });

	const measures = [
		row("step-repetition", reps, repsPrev.value ?? null),
		row("malformed-tool-call", malformed, malformedPrev.value ?? null),
		row("unverified-completions", unver, unverPrev.value ?? null),
		row("queue-ageing", ageing, undefined, {
			detail:
				ageing.oldest === null
					? queueItems.length === 0
						? "the queue is empty"
						: "no queued item carries a timestamp"
					: `oldest: #${ageing.oldest.id} to ${ageing.oldest.to}`,
		}),
		row("shared-reviewer-model", shared, undefined, {
			detail: shared.value === null ? "no verifier seat to judge" : shared.shared.join(", ") || "none shared",
		}),
	];

	// Freshness, so a stale reading can never be mistaken for a stable one:
	// the newest entry timestamp is when the data stops, not when we looked.
	const allEntries = Object.values(pages ?? {}).flat();
	const newestAt = allEntries.reduce((max, entry) => Math.max(max, atOf(entry)), 0);
	const turns = allEntries.filter((entry) => entry?.kind === "pi.user").length;

	return {
		window: {
			turns,
			newestAt: newestAt || null,
			bounded,
			// Absence of activity is not improvement (METRICS.md trap 1): say
			// when the data stops rather than rendering a still number as good.
			quietForMs: newestAt ? nowMs - newestAt : null,
		},
		measures,
		// Ambient notices are the out-of-band, admissible subset - the same
		// channel attention already uses, so the metric surface claims no new
		// screen real estate.
		notices: measures
			.filter((measure) => MEASURES[measure.id].ambient && measure.state === "warn")
			.map((measure) => ({
				scope: measure.scope,
				seat: null,
				kind: measure.id,
				detail: `${formatValue(measure)} (${formatBand(measure)})`,
			})),
	};
}

/* --------------------------------------------------------------- rendering */

function formatNumber(value, digits = 2) {
	return Number(value).toFixed(digits);
}

/**
 * What a value is measured against. A rate travels with its baseline; a measure
 * with an absolute band travels with the band instead. Printing "baseline
 * none" for a threshold-based measure would suggest it went unjudged when it
 * was in fact judged against a number the reader never sees.
 */
function formatBand(measure) {
	const band = MEASURES[measure.id].band;
	if (band.kind === "absolute") return `band ${band.enter}`;
	if (measure.baseline === null || measure.baseline === undefined) return "no baseline yet";
	return `baseline ${formatNumber(measure.baseline, 2)}`;
}

/**
 * A value with its unit and count - "3.1 per 10 turns, baseline 0.4", never a
 * bare number. The unit string is the measure's own, so the number cannot be
 * read without what it is a number of.
 */
export function formatValue(measure) {
	if (measure.value === null) return "no data";
	if (measure.id === "queue-ageing") {
		return `${formatNumber(measure.value, 1)} min`;
	}
	const pct = `${formatNumber(measure.value * 100, 0)}%`;
	const counts =
		measure.numerator === null || measure.denominator === null
			? ""
			: ` (${measure.numerator}/${measure.denominator})`;
	return `${pct}${counts}`;
}

/** The arrow carries the DECLARED direction, not just "up". */
function arrowOf(measure) {
	if (!measureHasTrend(MEASURES[measure.id])) return "";
	if (measure.baseline === null || measure.value === null) return "";
	if (measure.value > measure.baseline) return measure.direction === "up-worse" ? " ↑worse" : " ↑better";
	if (measure.value < measure.baseline) return measure.direction === "up-worse" ? " ↓better" : " ↓worse";
	return " =";
}

/**
 * The deliberate view: one row per measure with its baseline, state, class and
 * blind spot. Colour is a convenience only - every state is legible as a word,
 * so the report survives a pipe and a monochrome terminal.
 */
export function formatMetrics(result, { color = false, width = 96 } = {}) {
	const c = (code, text) => (color ? `${code}${text}${ANSI.reset}` : text);
	const lines = [];
	const w = result.window;
	const windowText = `${w.turns} turn(s)${w.bounded ? ", bounded by the scan limit" : ""}${
		w.newestAt ? `, newest ${new Date(w.newestAt).toISOString()}` : ", no entries yet"
	}`;
	lines.push(c(ANSI.cyan, "metrics") + `  window: ${windowText}`);
	if (w.quietForMs !== null && w.quietForMs > 3600000) {
		lines.push(
			c(ANSI.yellow, "  !") +
				` no new data for ${Math.round(w.quietForMs / 3600000)}h - rates below are still, not necessarily good`,
		);
	}
	for (const m of result.measures) {
		const state =
			m.state === "warn"
				? c(ANSI.yellow, "warn")
				: m.state === "ok"
					? c(ANSI.green, "ok")
					: c(ANSI.dim, m.state);
		// Config-derived has no baseline to show, and saying "none" there would
		// read as a missing number rather than a category that cannot have one.
		const against = measureHasTrend(MEASURES[m.id]) ? formatBand(m) : "config-derived";
		const pad = (text, width) =>
			text.replace(/\x1b\[[0-9;]*m/g, "").length >= width
				? text
				: text + " ".repeat(width - text.replace(/\x1b\[[0-9;]*m/g, "").length);
		lines.push(`  ${pad(state, 8)}${m.id.padEnd(24)} ${formatValue(m)}  ${against}${arrowOf(m)}`);
		lines.push(`  ${c(ANSI.dim, `[${m.klass}] ${m.blind}`)}`);
	}
	return lines.join("\n");
}
