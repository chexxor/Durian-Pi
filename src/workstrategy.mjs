// work strategy — the ORDERING POLICY for claim selection, and the PRIORITY LEASE it can sort by.
//
// WHY THIS IS A MODULE AND NOT A BRANCH INSIDE `claim_work`: the ordering choice is already a seam.
// `selectOldestWorkable` was extracted (#2673) precisely so "which item does a seat get" could be decided
// without a harness, and `docs/ROADMAP.md:726` (row 115) already RATIFIES the requirement — "claim
// selection honors an explicit `priority`/`rank` so human ordering survives ingest" — it was parked only
// because it waited on an external PM. This file completes that ruling; it does not invent one.
//
// WHY A TABLE AND NOT AN `if`: a strategy is a POLICY an operator declares, so adding a third one (or a
// future queue-item field it sorts on) must be one entry plus a comparator, never a fork of the selector.
// The table is also what lets an unknown name be REFUSED with the valid set in the message. Silent
// fallback to `oldest_first` would be the accepted-and-ignored class (#5071) this repo keeps paying for:
// the operator sets `priority_first`, a typo makes it inert, and every read still says "ok".
//
// WHY `oldest_first` IS THE DEFAULT AND IS BYTE-FOR-BYTE THE OLD BEHAVIOUR: selection used to scan queue
// ARRAY order and take the first workable row. Array order is insertion order, which is ascending id, so
// `oldest_first` (ascending id) is the same answer — a rig that does not opt in must not change order.
// That equivalence is what `selectOldestWorkable` staying an alias (src/rig.mjs) pins.
//
// WHY PRIORITY IS A CLOSED VOCABULARY AND NOT AN INTEGER: an integer invites `priority: 0` vs `priority: 1`
// vs "higher is better or lower?", and a typo (`priority: "urgent"`) silently becomes either "highest" or
// "ignored" depending on the comparator. `now | next | later` is readable on the row, in a `queue` line,
// and in a coordinator's message, and the parser can refuse anything else by NAME.
//
// WHY UNPRIORITISED ROWS TIE AT `next`: the change must not starve the existing queue. 7,000 rows have no
// `priority` field; if "absent" outranked "later" or vice versa, turning the strategy on would silently
// reshuffle the whole backlog. Tying at the neutral value means `priority_first` on a queue nobody has
// prioritised orders exactly like `oldest_first`, and only an explicit `now`/`later` moves anything.
//
// WHY A PRIORITY EXPIRES (a LEASE, not a flag): `hold` already demonstrates the unbounded-park pathology —
// 197 rows parked at a median 564.9 h, measured by `tools/latency-budget.mjs`. A second unbounded mechanism
// that reorders a seat's queue would inherit the same failure and be harder to see, because the row still
// looks normal. So `set_priority` requires an expiry, the lease LAPSES at read time, and this module is the
// single place that decides "what does this row's priority mean right now" — ordering and the queue line
// both call `effectivePriority`, so a lapsed row never reads as urgent in one view and neutral in another.
//
// Deliberately NOT here: no I/O, no clock capture at import time, no dependency on rig.mjs. Pure functions
// over plain objects, so the whole policy is testable in milliseconds (`demo/workstrategy.test.mjs`).

/** The default strategy — the pre-existing behaviour, so an unconfigured rig is unchanged. */
export const DEFAULT_STRATEGY = "oldest_first";

/**
 * The closed priority vocabulary, ordered most-urgent first. `next` is the NEUTRAL value: a row that never
 * set a priority is treated as `next`, so opting into `priority_first` does not reorder an unprioritised
 * backlog (see the header).
 */
export const PRIORITY_RANK = Object.freeze({ now: 0, next: 1, later: 2 });

/** Every legal priority value, in rank order (the order a refusal message should list them in). */
export const PRIORITY_VALUES = Object.freeze(Object.keys(PRIORITY_RANK));

/** The value an absent, lapsed or unreadable priority means. */
export const NEUTRAL_PRIORITY = "next";

/**
 * The LONGEST priority lease `set_priority` will accept: 30 days.
 *
 * A cap is the difference between "bounded" and "bounded in name only". Without it a caller can pass
 * `expiresAt: "9999-12-31"` and get exactly the unbounded park `hold` already has (197 rows, median
 * 564.9 h). Thirty days is deliberately generous — longer than any tranche on this rig — and it is a
 * constant so a refusal can NAME the limit instead of arguing about it.
 */
export const MAX_PRIORITY_LEASE_MS = 30 * 24 * 60 * 60 * 1000;

/** The strategy table. `order` is prose, so a `status`/`ps` readout can explain the choice it printed. */
export const WORK_STRATEGIES = Object.freeze({
	oldest_first: Object.freeze({
		name: "oldest_first",
		order: "ascending queue-item id (the order items were enqueued) — the historical behaviour",
	}),
	priority_first: Object.freeze({
		name: "priority_first",
		order: "priority rank now < next < later, then ascending id; a row with no priority (or a lapsed lease) ranks as `next`",
	}),
});

/** Every legal strategy name, in declaration order. */
export function strategyNames() {
	return Object.keys(WORK_STRATEGIES);
}

/** True when `name` is a strategy this build implements. */
export function isWorkStrategy(name) {
	return typeof name === "string" && Object.hasOwn(WORK_STRATEGIES, name);
}

/**
 * Refuse an unknown strategy BY NAME, listing the valid set.
 *
 * Throwing (not defaulting) is the ruling: a strategy name is an operator's DECLARATION of policy, and a
 * declaration that is quietly ignored is worse than a startup failure because it reports success while
 * doing something else (#5071).
 *
 * @param {unknown} name
 * @param {{where?: string}} [opts] what the name came from ("seat workStrategy", "DURIG_WORK_STRATEGY", …)
 * @returns {string} the validated name
 */
export function assertWorkStrategy(name, { where = "work strategy" } = {}) {
	if (isWorkStrategy(name)) return name;
	throw new Error(
		`${where}: unknown work strategy ${JSON.stringify(name)} — no such ordering exists, so a value that ` +
			`matched nothing would silently keep ${DEFAULT_STRATEGY}. Valid strategies: ${strategyNames().join(", ")}.`,
	);
}

/**
 * Resolve which strategy applies, and SAY WHERE IT CAME FROM.
 *
 * Precedence is seat > team > default: the asymmetry is real — a `qa` draining a gate chain and an `impl`
 * burning down a backlog want different orders at the same moment — and the source string is what makes
 * `ps`/`status` answer "why is my queue in this order" without the reader opening a config file.
 *
 * An empty or whitespace-only value counts as ABSENT (a config file with `"DURIG_WORK_STRATEGY": ""` is
 * the common unset shape, not a request for a strategy named "");
 *
 * @param {{seatStrategy?: unknown, teamStrategy?: unknown, defaultStrategy?: unknown}} [opts]
 * @returns {{strategy: string, source: "seat"|"team"|"default"}}
 * @throws when the winning value names a strategy this build does not implement
 */
export function resolveStrategy({ seatStrategy, teamStrategy, defaultStrategy } = {}) {
	const present = (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
	const seat = present(seatStrategy);
	if (seat) return { strategy: assertWorkStrategy(seat, { where: "seat workStrategy" }), source: "seat" };
	const team = present(teamStrategy);
	if (team) return { strategy: assertWorkStrategy(team, { where: "team workStrategy" }), source: "team" };
	const fallback = present(defaultStrategy) ?? DEFAULT_STRATEGY;
	return { strategy: assertWorkStrategy(fallback, { where: "default work strategy" }), source: "default" };
}

/**
 * A row's EFFECTIVE priority right now, honouring its lease.
 *
 * Three answers beyond the raw field, each deliberate:
 *  - `lapsed`: the lease in `prioritySet.expiresAt` has passed, so the row ranks as neutral again. This is
 *    decided at READ time because nothing runs at expiry time; a stored `priority: "now"` with a passed
 *    expiry is history, not policy.
 *  - `invalid`: the stored value is not in the vocabulary (hand-edited store). It ranks neutral and is
 *    FLAGGED rather than quietly coerced, so a readout can show it instead of hiding a corrupt row.
 *  - `raw`: what the row says, so a caller can report "now (lapsed 2026-11-13T00:00:00.000Z)".
 *
 * A priority with NO `prioritySet` has no lease and therefore does not lapse. `set_priority` always writes
 * one; a row that predates it has no priority at all.
 *
 * @param {{priority?: unknown, prioritySet?: {expiresAt?: unknown}|null}|null|undefined} item
 * @param {number} [now] epoch ms — injected so the ordering is testable without a clock
 */
export function effectivePriority(item, now = Date.now()) {
	const raw = item?.priority ?? null;
	const expiresAt = item?.prioritySet?.expiresAt ?? null;
	const expiryMs = typeof expiresAt === "string" ? Date.parse(expiresAt) : Number.NaN;
	const hasLease = Number.isFinite(expiryMs);
	const lapsed = hasLease && expiryMs <= now;
	const valid = typeof raw === "string" && Object.hasOwn(PRIORITY_RANK, raw);
	const neutral = { priority: NEUTRAL_PRIORITY, rank: PRIORITY_RANK[NEUTRAL_PRIORITY], raw, expiresAt, lapsed: false, invalid: false };
	if (lapsed) return { ...neutral, lapsed: true };
	if (raw === null) return neutral;
	if (valid) return { ...neutral, priority: raw, rank: PRIORITY_RANK[raw] };
	return { ...neutral, invalid: true };
}

/** Queue ids are positive integers; anything else sorts last, deterministically, rather than as NaN. */
function idOf(item) {
	const n = Number(item?.id);
	return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

/**
 * Order a list of queue rows for claim selection — a NEW array, never a mutation of the queue document.
 *
 * The returned array is ordered but NOT filtered: deciding which rows a seat may claim is `workable`'s job
 * (src/rig.mjs:320), and a second filter here would be a second owner of that rule (#6112's reason for
 * extracting `deadGateId`). So this function only ever answers "in what ORDER do I look".
 *
 * Both strategies break ties by ascending id, so the order is TOTAL and stable: two rows with the same
 * priority cannot swap places between two claims, which would make a skip list and a queue view disagree.
 *
 * @param {Array<object>} items
 * @param {{strategy?: string, now?: number}} [opts]
 * @returns {Array<object>} the same row objects, in strategy order
 * @throws when `strategy` is not implemented (see assertWorkStrategy)
 */
export function orderCandidates(items, { strategy = DEFAULT_STRATEGY, now = Date.now(), directive = null } = {}) {
	assertWorkStrategy(strategy, { where: "orderCandidates" });
	const list = [...(items ?? [])];
	const byId = (a, b) => idOf(a) - idOf(b);
	// `oldest_first` is a DECLARED policy and a directive is a PRIORITY, so a directive reorders nothing
	// here — exactly like `set_priority`, which the tool reports as inert on a seat that does not work
	// `priority_first`. Saying so is cheaper than silently changing what a declared strategy means.
	if (strategy !== "priority_first") return list.sort(byId);
	// A DIRECTIVE is a scoped POLICY evaluated here, at claim time — not a flag copied onto rows. That
	// distinction is why it exists (operator ruling 2026-11-12): a fan-out of `now` onto the rows present
	// at write time silently misses every row minted afterwards, the same recorded-census-goes-stale
	// defect as pitfall 294. A directive matches by SCOPE, so future rows are covered, and it lapses on
	// its own lease. Absent or expired, `directiveRank` is null and ordering is byte-for-byte unchanged.
	const directiveRank = directiveRankOf(directive, now);
	// Cache the rank per row: the sort re-reads each row O(log n) times, and recomputing
	// `Date.parse(expiresAt)` inside the comparator is pure waste on a 7,000-row queue.
	const rank = new Map();
	for (const item of list) {
		const own = effectivePriority(item, now).rank;
		const scoped = directiveRank === null ? null : rankUnderDirective(directive, item, directiveRank);
		rank.set(item, scoped === null ? own : Math.min(own, scoped));
	}
	return list.sort((a, b) => rank.get(a) - rank.get(b) || byId(a) - byId(b));
}

/**
 * The rank a live directive imposes on everything it scopes, or null when the directive is absent or has
 * lapsed. A directive is a LEASE like a row priority: an expired one stops applying at read time, in the
 * one place that decides what a priority means (see the header).
 */
function directiveRankOf(directive, now) {
	if (!directive || typeof directive !== "object") return null;
	const expiryMs = typeof directive.expiresAt === "string" ? Date.parse(directive.expiresAt) : Number.NaN;
	if (!Number.isFinite(expiryMs) || expiryMs <= now) return null;
	const rank = PRIORITY_RANK[directive.priority];
	return Number.isFinite(rank) ? rank : null;
}

/**
 * Does this row fall inside the directive's SCOPE? `null` when it does not, else the directive's rank.
 * Scope is deliberately narrow and legible — a seat and/or a subject substring — because a directive the
 * reader cannot check against a row is an order nobody can audit. No scope field at all is refused at
 * write time (src/queueops.mjs), so it can never mean "everything".
 */
function rankUnderDirective(directive, item, rank) {
	const seats = directive.seats ?? null;
	const contains = directive.subjectContains ?? null;
	if (Array.isArray(seats) && seats.length > 0) {
		if (!seats.includes(item?.to)) return null;
		return rank;
	}
	// `subjectContains` is a string OR a list: landing work is named "LANDING ENTRY", "Land item-6162",
	// "enforce … at land times" and "MERGE ORDER", so one substring cannot scope it honestly. Any match
	// scopes the row (this is an OR, never an AND — a directive that needed every token would match
	// nothing and read as "applied").
	const tokens = Array.isArray(contains) ? contains : typeof contains === "string" ? [contains] : [];
	const subject = String(item?.subject ?? "").toLowerCase();
	for (const token of tokens) {
		const needle = String(token ?? "").trim().toLowerCase();
		if (needle !== "" && subject.includes(needle)) return rank;
	}
	return null;
}

/**
 * Validate and NORMALIZE a `set_priority` request: `{priority, reason, expiresAt}` or a refusal message.
 *
 * Every rule here is load-bearing, and each refuses rather than amends:
 *  - `priority` must be in the closed vocabulary (a typo must not become "highest").
 *  - `reason` must be non-empty: a reordering the recipient cannot explain is how "why is my queue in this
 *    order" becomes a 20-turn escalation, the same argument #6112 makes for a coordinator's release.
 *  - `expiresAt` is REQUIRED and must be a real future instant within `MAX_PRIORITY_LEASE_MS`: an expiry in
 *    the past is a no-op dressed as an action, and one in the year 9999 is the unbounded park `hold`
 *    already demonstrates (197 rows, median 564.9 h).
 *
 * @param {{priority?: unknown, reason?: unknown, expiresAt?: unknown}} args
 * @param {number} [now] epoch ms, injected by the caller so the lease bound is testable
 * @returns {{ok: true, value: {priority: string, reason: string, expiresAt: string}} | {ok: false, error: string}}
 */
export function validatePriorityRequest({ priority, reason, expiresAt } = {}, now = Date.now()) {
	if (!(typeof priority === "string" && Object.hasOwn(PRIORITY_RANK, priority))) {
		return {
			ok: false,
			error: `priority must be one of ${PRIORITY_VALUES.join(", ")} — got ${JSON.stringify(priority ?? null)}`,
		};
	}
	const why = typeof reason === "string" ? reason.trim() : "";
	if (!why) {
		return { ok: false, error: "a priority change must carry a `reason`: the recipient has to be able to read why the order changed" };
	}
	if (why.length > 500) {
		return { ok: false, error: `reason is ${why.length} characters; keep it under 500 (it is written on the row and read in every queue view)` };
	}
	const raw = typeof expiresAt === "string" ? expiresAt.trim() : "";
	if (!raw) {
		return {
			ok: false,
			error:
				"`expiresAt` is required (ISO-8601, in the future, at most 30 days out): an unbounded priority is the " +
				"park-forever pathology `hold` already demonstrates (197 held rows, median 564.9 h)",
		};
	}
	const ms = Date.parse(raw);
	if (!Number.isFinite(ms)) {
		return { ok: false, error: `expiresAt ${JSON.stringify(raw)} is not a parseable instant (ISO-8601, e.g. 2026-11-19T00:00:00Z)` };
	}
	if (ms <= now) {
		return { ok: false, error: `expiresAt ${raw} is in the past — that lease would lapse before it ordered anything` };
	}
	if (ms - now > MAX_PRIORITY_LEASE_MS) {
		const days = Math.round(MAX_PRIORITY_LEASE_MS / 86400000);
		return { ok: false, error: `expiresAt ${raw} is more than ${days} days out — cap the lease so the priority cannot become an unbounded park` };
	}
	return { ok: true, value: { priority, reason: why, expiresAt: new Date(ms).toISOString() } };
}
