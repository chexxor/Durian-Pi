/**
 * src/queueclass.mjs — WHAT A QUEUE ROW IS: work, notice, or ledger registration.
 *
 * WHY THIS MODULE EXISTS (operator request 2026-11-15, "the queue is overwhelming"). `cli.mjs watch` printed
 * `queue 876 queued · 27 claimed · 4970 done · 426 deferred` and that single number was not a count of work.
 * Measured on this rig with `node tools/queue-pressure.mjs` (see the tool header for the host line and cost):
 * of the 1,656 non-terminal rows, 461 were protocol notices and 152 were ROADMAP registrations parked in the
 * queue — 613 rows that are not work, and 321 of the 461 notices passed `workable()`, so a seat could burn a
 * turn claiming an acknowledgement. A number that conflates work with messages cannot be managed, so the
 * classification has to be ONE predicate that every surface reads, not a regex retyped in each view (#5047's
 * pair-of-spellings defect, and D159's "wrong citation reads as verified" lesson both point the same way).
 *
 * DELIBERATELY DEPENDENCY-FREE (the `src/context.mjs` / `src/verifierrole.mjs` pattern): a module that drags
 * store or provider imports makes every importer fragile, and `check`/`watch`/`status` all read this.
 *
 * THREE KINDS, and the order of the test is load-bearing:
 *   - NOTICE      — a DONE/CANCELLED acknowledgement minted by `complete_work`/`cancel_work`. Structural flag
 *                   first, subject shape only as the LEGACY fallback for rows minted before the flag.
 *   - REGISTRATION — a ROADMAP ledger entry that was minted into the queue as a row ("REGISTERED", "BACKLOG",
 *                   "TRIGGER-GATED, DO NOT START"). Its home is docs/ROADMAP.md; the queue is holding a copy.
 *                   Structural `registration: true` first (minted at intake), the published subject pattern as
 *                   the fallback for the 152 rows that predate the flag.
 *   - WORK        — everything else.
 *
 * A notice is checked BEFORE a registration because a notice's subject is `CANCELLED #1088: ROADMAP 92
 * (BACKLOG — hold, do not start) …`: it contains registration words and is NOT a registration. Counting it as
 * one would double-count the same row in two buckets (measured: 19 of the 171 registration-pattern rows are
 * notices — `node .spike/parent-probe.mjs` style census, or `node tools/queue-pressure.mjs`).
 */

/** The published pattern (D142's rule: never report a regex-derived count without the regex). */
export const REGISTRATION_RE = /\b(REGISTERED|REGISTRATION|REGISTER\b|TRIGGER-GATED|DO NOT START|BACKLOG\s*[—-]\s*(hold|do not start))/i;

/** A DONE acknowledgement, structurally or by the exact shape `complete_work` enqueues. */
export function isDoneNotice(item) {
	if (typeof item?.notice === "boolean") return item.notice;
	return /^DONE #\d+: /.test(String(item?.subject ?? ""));
}

/** A CANCELLATION notice (#3470): the message `cancel_work` sends the other party. */
export function isCancellationNotice(item) {
	if (typeof item?.notice === "boolean") return item.notice;
	return /^CANCELLED #\d+: /.test(String(item?.subject ?? ""));
}

/**
 * Is this row a NOTICE of any kind? A notice must never spawn another notice (ROADMAP 39), and from this
 * change onward it is never claimable work either. THE STRUCTURAL FLAG WINS (#3739): the subject-prefix
 * fallback exists only for flag-less rows that predate the flag, because letting a free-text subject that
 * happens to start "DONE #123: " override a structural non-notice is how real work got misclassified.
 */
export function isNoticeItem(item) {
	if (typeof item?.notice === "boolean") return item.notice;
	return isDoneNotice(item) || isCancellationNotice(item);
}

/**
 * Is this row a ROADMAP registration rather than startable work?
 *
 * `registration: true` is written at intake by `enqueueItem` when the subject matches the pattern, so the
 * classification is structural for everything minted from now on; the pattern is the fallback for the rows
 * already in the store. Note the asymmetry with `isNoticeItem`: for a notice the flag is the ONLY authority,
 * for a registration the flag and the pattern agree by construction, so either alone is enough.
 */
export function isRegistrationItem(item) {
	if (item?.registration === true) return true;
	if (isNoticeItem(item)) return false;
	return REGISTRATION_RE.test(String(item?.subject ?? ""));
}

/** The one classification every surface uses. Returns "notice" | "registration" | "work". */
export function classifyRow(item) {
	if (isNoticeItem(item)) return "notice";
	if (isRegistrationItem(item)) return "registration";
	return "work";
}

/** Non-terminal rows only — `done`/`cancelled` are terminal (src/checkup.mjs TERMINAL_STATUSES). */
export const TERMINAL_STATUSES = ["done", "cancelled"];
export const isTerminalRow = (item) => item != null && TERMINAL_STATUSES.includes(item.status);

/**
 * THE SHAPE OF A QUEUE: the census the operator needs before deciding anything.
 * Pure, so `check`, `status`, `watch` and the tool all read the same numbers.
 *
 * `queuedWork` is the number that answers "how much can the fleet actually start?" — a `held` or `deferred`
 * row is parked by a rule, not waiting in the claim lane, so counting it as queued pressure is what made the
 * watch line read 876 when 542 rows were claimable-eligible and 322 of the "queued" rows were messages.
 */
export function queueShape(items = []) {
	const live = (items ?? []).filter((it) => !isTerminalRow(it));
	const out = {
		rows: (items ?? []).length,
		live: live.length,
		notice: 0,
		registration: 0,
		work: 0,
		queuedWork: 0,
		claimableWork: 0,
		awaitingOperator: 0,
		noticeByStatus: {},
		workByStatus: {},
		registrationByStatus: {},
		openWorkBySeat: {},
		queuedWorkBySeat: {},
	};
	for (const item of live) {
	 const kind = classifyRow(item);
	 out[kind] += 1;
	 const bucket = kind === "notice" ? out.noticeByStatus : kind === "registration" ? out.registrationByStatus : out.workByStatus;
	 bucket[item.status] = (bucket[item.status] || 0) + 1;
		if (item.status === "queued" && kind === "work") out.queuedWork += 1;
		if (kind === "work") {
			out.openWorkBySeat[item.to ?? "unaddressed"] = (out.openWorkBySeat[item.to ?? "unaddressed"] || 0) + 1;
			if (item.status === "queued") out.queuedWorkBySeat[item.to ?? "unaddressed"] = (out.queuedWorkBySeat[item.to ?? "unaddressed"] || 0) + 1;
			if (item.deferredTo === "human") out.awaitingOperator += 1;
		}
		if (kind === "notice" && item.status === "queued") out.noticeQueued = (out.noticeQueued || 0) + 1;
	}
	return out;
}

/**
 * THE BAND. Open work is measured against fleet capacity: `perSeat` rows per seat. A fleet of 12 with 1,043
 * open rows is not a queue, it is a ledger, and the only way "manageable" stops being an opinion is a stated
 * limit that a tool can fail against. `perSeat` is the operator's tuning knob, never inferred from the data.
 */
export function bandVerdict(shape, { perSeat = 10, seats = 0 } = {}) {
	const limit = perSeat * seats;
	return {
		perSeat,
		seats,
		limit,
		open: shape.work,
		inside: shape.work <= limit,
		overBy: Math.max(0, shape.work - limit),
	};
}

/**
 * MINT vs CLOSE over a window — the only honest answer to "is the backlog growing".
 * Mint = the row's FIRST `queued` transition; close = its LAST `done`/`cancelled` transition. A row minted
 * before the window and closed inside it counts as a close only, which is correct: the window measures the
 * net change in open rows, not the age of the work.
 */
export function burnRate(items = [], { windowDays = 7, now = Date.now() } = {}) {
	const windowStart = now - windowDays * 86400000;
	const firstEvent = (item, event) => (item.transitions ?? []).find((t) => t.event === event)?.at ?? null;
	const lastEvent = (item, ...events) => {
		const hits = (item.transitions ?? []).filter((t) => events.includes(t.event)).map((t) => t.at).filter(Boolean);
		return hits.length ? hits[hits.length - 1] : null;
	};
	const minted = (items ?? []).filter((it) => {
		const at = firstEvent(it, "queued");
		return at && Date.parse(at) >= windowStart;
	});
	const closed = (items ?? []).filter((it) => {
		const at = lastEvent(it, "done", "cancelled");
		return at && Date.parse(at) >= windowStart;
	});
	return {
		windowDays,
		minted: minted.length,
		mintedNotice: minted.filter(isNoticeItem).length,
		mintedWork: minted.filter((it) => !isNoticeItem(it)).length,
		closed: closed.length,
		closedNotice: closed.filter(isNoticeItem).length,
		closedWork: closed.filter((it) => !isNoticeItem(it)).length,
		netOpen: minted.length - closed.length,
		verdict: minted.length - closed.length > 0 ? "GROWING" : "SHRINKING",
	};
}

/**
 * MINTS PER SEAT inside the window — the BURST half of the fan-out budget (`mintGate`, src/rig.mjs).
 *
 * WHY A BURST AND NOT THE STANDING COUNT: measured on this rig 2026-11-15 (`node tools/queue-pressure.mjs`),
 * `impl` already holds 439 open rows. A gate that reads the standing count refuses the next mint to `impl`
 * on the day it ships — that is an outage, not a budget. A burst gate stops fan-out WHILE IT IS HAPPENING
 * (a split that spawns hundreds of children in a run of passes) and stays silent about backlog that has
 * merely aged, which is what the `check` rule reports instead. Mint = first `queued` transition, the same
 * definition `burnRate` uses; a row minted `held` has none, so parking is not a burst (and is the escape
 * hatch the refusal names).
 */
export function mintedBySeat(items = [], { windowDays = 7, now = Date.now() } = {}) {
	const windowStart = now - windowDays * 86400000;
	const out = {};
	for (const item of items ?? []) {
		const at = (item.transitions ?? []).find((t) => t.event === "queued")?.at ?? null;
		if (!at || Date.parse(at) < windowStart) continue;
		out[item.to] = (out[item.to] ?? 0) + 1;
	}
	return out;
}

/**
 * THE PRESSURE VERDICT — ONE derivation the `check` rule (src/checkup.mjs) and `tools/queue-pressure.mjs` both
 * read, so the gate and the view cannot disagree (#5047's pair-of-spellings lesson: two spellings of the same
 * rule is how one of them goes stale while the other reads as truth).
 *
 * TWO WAYS A QUEUE IS UNMANAGEABLE, each with a DECLARED floor:
 *   - OUT OF BAND — open work exceeds `perSeat x seats`.
 *   - GROWING PAST THE FLEET — the window net-grew by at least ONE FULL FLEET BAND (`band.limit`). A net +4 on
 *     a two-seat rig is a Tuesday, not a crisis; net growth of a whole band per window means the backlog is
 *     growing at the rate the fleet was built to hold, so within one window the rig IS out of band. Without the
 *     floor the rule fires on every fixture that mints anything, which is how a measurement becomes a nuisance.
 */
export function pressureVerdict(shape, items = [], { perSeat = 10, seats = 0, windowDays = 7, now = Date.now() } = {}) {
	const band = bandVerdict(shape, { perSeat, seats });
	const burn = burnRate(items, { windowDays, now });
	const growthFloor = band.limit;
	const growing = burn.netOpen > 0;
	const growingPastFleet = growing && burn.netOpen >= growthFloor;
	return {
		band,
		burn,
		growthFloor,
		outOfBand: !band.inside,
		growing,
		growingPastFleet,
		fail: !band.inside || growingPastFleet,
		reasons: [
			...(band.inside ? [] : [`out of band: ${band.open} open work rows against a band of ${band.limit} (${band.perSeat}/seat x ${band.seats} seats), over by ${band.overBy}`]),
			...(growingPastFleet ? [`growing past the fleet: net +${burn.netOpen} in ${windowDays} d is at least one full band (${growthFloor})`] : []),
		],
	};
}

/** Age buckets of the LIVE rows, measured from the row's first `queued` transition. */
export function ageBuckets(items = [], { now = Date.now() } = {}) {
	const buckets = { "<=2d": 0, "3-7d": 0, "8-14d": 0, "15-30d": 0, ">30d": 0, "no-queued-event": 0 };
	for (const item of items ?? []) {
		if (isTerminalRow(item)) continue;
		const at = (item.transitions ?? []).find((t) => t.event === "queued")?.at ?? null;
		const days = at ? (now - Date.parse(at)) / 86400000 : null;
		buckets[days === null ? "no-queued-event" : days <= 2 ? "<=2d" : days <= 7 ? "3-7d" : days <= 14 ? "8-14d" : days <= 30 ? "15-30d" : ">30d"] += 1;
	}
	return buckets;
}
