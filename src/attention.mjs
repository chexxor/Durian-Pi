// Attention: derive operator-visible notices from durable state. Pure
// functions over storage-shaped inputs so the same computation backs both
// `durig status` (one-shot) and the `durig watch` stream, and so the
// proving test can drive it without a live model.
//
// Blocked means one of three things an operator must hear about:
// - "idle_with_queued_work": work is addressed to the seat but nothing of
//   theirs is in flight and their last run settled — nobody will pick it
//   up until something wakes the seat.
// - "last_run_failed": the seat's most recent run ended unanswered (crash,
//   abort, provider error). The reason travels with the notice.
// - "deferred_awaiting_answer": the seat parked an item on a question and is
//   waiting for the answer. A deferred item is a fact, not an inference from
//   idleness, so it is reported even when the run also failed.
// - "admitted_not_started": a submission was admitted durably (the input
//   committed) but nothing has started a run for it - the `send` was killed
//   mid-flight (dogfood F11), so the rig reads idle-healthy while a request sits
//   unprocessed. Derived from already-persisted data only (no new write path,
//   D24).

// How long an admitted submission may sit unstarted before it is judged
// stranded. The submission record carries NO admission timestamp of its own
// (scanSubmissions returns only conversationId/type/status/entry/id), so the
// age is recovered from the admitted input ENTRY's timestamp, attached by the
// caller as `admittedAt`. The threshold separates a submission a live harness
// is about to schedule (fresh, under the wire) from one nothing is driving
// (aged past it).
export const STRANDED_ADMITTED_MS = 30_000;

/**
 * Consecutive failed runs after which a seat is surfaced as `repeated_failure`. The driver
 * retries and re-wakes, but a run that keeps failing is a DIAGNOSIS gap: only a human read of the
 * cause breaks the loop, so the supervisor escalates it (ROADMAP 42 / P3).
 */
export const REPEATED_FAILURE_STREAK = 3;

/** Rejected-malformed-arguments tool calls after which a seat is surfaced as `malformed_tool_call`. */
export const MALFORMED_TOOL_CALL_NOTICE = 2;

/**
 * The harness's marker for a tool call whose ARGUMENTS failed schema validation (`invalid_arguments`
 * in pi-durable's tool.ts). This is a CAUSE, not a symptom: a file-not-found or an edit's oldText
 * mismatch is the model's normal feedback loop and must NOT count. The structured diagnostic code
 * is not persisted on the entry (only its text is), so this reads the one marker the harness emits
 * for the malformed-arguments cause — recorded as the blind spot rather than hidden.
 */
const MALFORMED_ARGUMENTS_MARKER = /\[error\] Validation failed for tool "/;

/** Did this entry record a tool call the harness rejected as malformed arguments? */
export function isMalformedToolResult(entry) {
	const message = Array.isArray(entry?.model) ? entry.model[0] : entry?.model;
	if (message?.isError !== true) return false;
	const parts = Array.isArray(message.content) ? message.content : [];
	return MALFORMED_ARGUMENTS_MARKER.test(parts.map((part) => part?.text ?? "").join("\n"));
}

/** How many malformed-argument tool calls are in a seat's entry page. */
export function countMalformedToolCalls(entries) {
	let count = 0;
	for (const entry of entries ?? []) {
		if (entry?.kind !== "pi.tool-result") continue;
		if (isMalformedToolResult(entry)) count++;
	}
	return count;
}

/**
 * The reason a run failed, plus the CAUSE when the entry knows it.
 *
 * A submission record carries a category - "model_error" - and nothing else,
 * while the entry carries the provider's message. Those two are not
 * interchangeable to a reader: a transient rate limit and a real fault look
 * identical as a category, and they call for opposite responses (wait it out,
 * or go investigate). Found by dogfooding, F3 in docs/DOGFOOD.md.
 */
function failureDetail(latest, errorMessage) {
	const reason = String(latest.reason ?? "unknown reason");
	const cause = summarizeError(errorMessage);
	return cause ? `${reason}: ${cause}` : reason;
}

/**
 * A readable one-liner from a provider error string. These usually arrive as
 * "NNN: {json}" with the useful part under `message`, and the raw string can
 * carry a whole response body - so this is best-effort and always bounded.
 * Exported so a caller can reuse it rather than re-deriving the same rule.
 */
export function summarizeError(errorMessage) {
	const raw = String(errorMessage ?? "").trim();
	if (!raw) return "";
	const json = /^(\d{3}):\s*(\{[\s\S]*\})$/.exec(raw);
	if (json) {
		try {
			const parsed = JSON.parse(json[2]);
			const message = parsed?.message ?? parsed?.error?.message;
			if (message) return `${json[1]}: ${String(message).slice(0, 160)}`;
		} catch {
			// Not JSON after all; the bounded raw form below is still useful.
		}
	}
	return raw.replace(/\s+/g, " ").slice(0, 160);
}

/**
 * @param {Array<{name:string, conversationId:number|string, role?:string}>} seats
 * @param {Array<{to:string, status:string}>} queueItems
 *        items may also carry `deferredTo` (which seat, or "human", an item is parked on)
 * @param {Map<number|string, {status:string, reason?:string, admittedAt?:number}|undefined>} latestByConv
 *        latest submission record per conversation id (any status). `admittedAt`
 *        is the timestamp of the submission's admitted input entry, recovered
 *        by the caller from the entry because the record itself has none.
 * @param {Map<number|string, string>} [errorByConv] latest provider error per conversation
 * @returns {Array<{scope:string, seat:string, kind:string, detail:string}>}
 *
 * Every notice carries a `scope`, added alongside `seat` rather than replacing
 * it (additive, so an existing reader keying on `seat` keeps working). Seat
 * notices are `scope:"seat"`; the metrics layer contributes rig- and
 * queue-scoped notices with a null seat, and a per-seat renderer must exclude
 * those EXPLICITLY - filtering on the seat field alone would put a rig-wide
 * notice on whichever seat row happened to match.
 *
 * `nowMs`, `seatsWithSlot` and `strandedMs` pin the facts behind the stranded
 * rule: the submission record and its entry timestamp are persisted, but
 * whether a harness is presently driving the submission is NOT, so "started"
 * is inferred from a live generation slot plus the admission age - passed in
 * here rather than fabricated.
 */
export function computeAttention(
	seats,
	queueItems,
	latestByConv,
	errorByConv = new Map(),
	{ nowMs = Date.now(), seatsWithSlot = new Set(), strandedMs = STRANDED_ADMITTED_MS, failureStreakByConv = new Map(), repeatedFailureStreak = REPEATED_FAILURE_STREAK, malformedCountByConv = new Map(), malformedToolCallNotice = MALFORMED_TOOL_CALL_NOTICE } = {},
) {
	const notices = [];
	for (const seat of seats) {
		const queued = queueItems.filter((it) => it.to === seat.name && it.status === "queued");
		// Work explicitly parked on an unanswered question. This is the visible half
		// of deferring to a human (MAST: no reason to defer to humans, 6.8%): before
		// it, a seat that needed a decision could only say so in prose, and prose
		// appears nowhere an operator looks. Reported before the failed-run check
		// and without `continue`, because a parked item is a durable fact rather
		// than an inference from idleness - a failed run does not unpark it.
		const deferred = queueItems.filter((it) => it.to === seat.name && it.status === "deferred");
		if (deferred.length > 0) {
			// Split the two audiences: a question parked on the human operator (an
			// inbox the seat cannot poll) is a different fact from one parked on a
			// seat. Naming the NEWEST human-parked item matters because the oldest
			// is the most likely to have been superseded - a stale `#1 waiting`
			// points the operator at a question they may already have answered.
			const human = deferred.filter((it) => (it.deferredTo ?? "an answer") === "human");
			const onSeat = deferred.length - human.length;
			const held = human.at(-1) ?? deferred.at(-1);
			notices.push({
				scope: "seat",
				seat: seat.name,
				kind: "deferred_awaiting_answer",
				detail: `${human.length} item(s) parked on the human, ${onSeat} on a seat` + (held ? `; #${held.id} waiting` : ""),
			});
		}
		const streak = failureStreakByConv.get(seat.conversationId) ?? 0;
		if (streak >= repeatedFailureStreak) {
			notices.push({
				scope: "seat",
				seat: seat.name,
				kind: "repeated_failure",
				detail: `${streak} consecutive failed runs; the supervisor escalates it to the human`,
			});
		}
		const malformed = malformedCountByConv.get(seat.conversationId) ?? 0;
		if (malformed >= malformedToolCallNotice) {
			notices.push({
				scope: "seat",
				seat: seat.name,
				kind: "malformed_tool_call",
				detail: `${malformed} tool call(s) rejected as malformed arguments; the seat is emitting invalid argument shapes`,
			});
		}
		const latest = latestByConv.get(seat.conversationId);
		if (latest?.status === "unanswered") {
			notices.push({
				scope: "seat",
				seat: seat.name,
				kind: "last_run_failed",
				detail: failureDetail(latest, errorByConv.get(seat.conversationId)),
			});
			continue; // a failed run explains idleness; one notice per cause
		}
		const inFlight =
			latest?.status === "queued" || latest?.status === "placed";
		// A submission admitted but never started is the rig reading idle-healthy
		// while a request sits unprocessed (dogfood F11): `send` was killed, the
		// submission stayed "queued"/"placed", and until now the inFlight guard
		// suppressed every notice. Detect it from the already-persisted admission
		// age plus the absence of a live generation slot (nothing is running, so
		// nothing will advance it).
		//
		// BLIND SPOT: a viewer never opens a harness (D11), so this cannot tell
		// "no harness will ever drive this submission" from "a live harness is
		// momentarily between scheduling passes"; strandage is inferred from the
		// admission age exceeding the threshold AND the seat holding no LIVE
		// generation slot. A live slot means a run is genuinely ahead of it and the
		// submission is legitimately waiting (backpressure), so it is not flagged;
		// a DEAD slot (stale holder) is treated as nothing running, so the
		// submission IS flagged stranded and the generation_stale notice separately
		// explains the wedged slot.
		if (latest && inFlight) {
			const age = Number.isFinite(latest.admittedAt) ? nowMs - latest.admittedAt : null;
			const seatHasSlot = seatsWithSlot.has(seat.name);
			if (age !== null && age > strandedMs && !seatHasSlot) {
				notices.push({
					scope: "seat",
					seat: seat.name,
					kind: "admitted_not_started",
					detail: `submission #${latest.id ?? latest.entry ?? "?"} admitted ${Math.round(
						age / 1000,
					)}s ago, no run started and no slot held; re-arm it with the resume/doctor verb (item 37(b))`,
				});
			}
		}
		if (queued.length > 0 && !inFlight) {
			notices.push({
				scope: "seat",
				seat: seat.name,
				kind: "idle_with_queued_work",
				detail: `${queued.length} queued item(s), last submission ${
					latest ? latest.status : "none"
				}`,
			});
		}
	}
	return notices;
}
