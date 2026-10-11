// Attention: derive operator-visible notices from durable state. Pure
// functions over storage-shaped inputs so the same computation backs both
// `durig status` (one-shot) and the `durig watch` stream, and so the
// proving test can drive it without a live model.
//
// Blocked means one of two things an operator must hear about:
// - "idle_with_queued_work": work is addressed to the seat but nothing of
//   theirs is in flight and their last run settled — nobody will pick it
//   up until something wakes the seat.
// - "last_run_failed": the seat's most recent run ended unanswered (crash,
//   abort, provider error). The reason travels with the notice.

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
 * @param {Map<number|string, {status:string, reason?:string}|undefined>} latestByConv
 *        latest submission record per conversation id (any status)
 * @returns {Array<{scope:string, seat:string, kind:string, detail:string}>}
 *
 * Every notice carries a `scope`, added alongside `seat` rather than replacing
 * it (additive, so an existing reader keying on `seat` keeps working). Seat
 * notices are `scope:"seat"`; the metrics layer contributes rig- and
 * queue-scoped notices with a null seat, and a per-seat renderer must exclude
 * those EXPLICITLY - filtering on the seat field alone would put a rig-wide
 * notice on whichever seat row happened to match.
 */
export function computeAttention(seats, queueItems, latestByConv, errorByConv = new Map()) {
	const notices = [];
	for (const seat of seats) {
		const queued = queueItems.filter((it) => it.to === seat.name && it.status === "queued");
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
