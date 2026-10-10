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
 * @param {Array<{name:string, conversationId:number|string, role?:string}>} seats
 * @param {Array<{to:string, status:string}>} queueItems
 * @param {Map<number|string, {status:string, reason?:string}|undefined>} latestByConv
 *        latest submission record per conversation id (any status)
 * @returns {Array<{seat:string, kind:string, detail:string}>}
 */
export function computeAttention(seats, queueItems, latestByConv) {
	const notices = [];
	for (const seat of seats) {
		const queued = queueItems.filter((it) => it.to === seat.name && it.status === "queued");
		const latest = latestByConv.get(seat.conversationId);
		if (latest?.status === "unanswered") {
			notices.push({
				seat: seat.name,
				kind: "last_run_failed",
				detail: String(latest.reason ?? "unknown reason"),
			});
			continue; // a failed run explains idleness; one notice per cause
		}
		const inFlight =
			latest?.status === "queued" || latest?.status === "placed";
		if (queued.length > 0 && !inFlight) {
			notices.push({
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
