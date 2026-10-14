// Durable event feed — READ-ONLY and ADDITIVE (PIECE 2, docs/PUSH-ARCHITECTURE.md §3.1).
//
// A machine-readable stream of durig events with a MONOTONIC `seq` cursor, so a
// late or reconnecting subscriber resumes instead of replaying history:
//
//   {"seq":10001,"ts":"…","kind":"queue.enqueued","itemId":1,"to":"impl","from":"pm","subject":"…"}
//   {"seq":20001,"ts":"…","kind":"queue.claimed","itemId":1,"seat":"impl"}
//
// Read-only by construction (D11, D24): this module opens NO harness and writes
// nothing. It reads the same storage the `watch` verb reads directly — the
// `durig.seats` and `durig.queue` documents — and derives events from them. It
// is ADDITIVE: no existing reader or writer changes; nothing depends on it.
//
// CURSOR MODEL. `seq` is durable and monotonic over the queue transition log
// plus queue item ids, and survives a process restart because it is derived from
// committed storage, not from a process-local counter (unlike `watch`'s seq):
//
//   seq = itemId * SEQ_STRIDE + transitionIndex + 1
//
// The item id is durable (the queue's own `nextId` namespace), later transitions
// on the same item have a larger `transitionIndex`, and SEQ_STRIDE exceeds any
// plausible transition count per item, so `seq` is strictly increasing in
// (itemId, transitionIndex). A subscriber passes its last `seq` as `sinceSeq`
// and the feed returns only events with a greater `seq` — no replay.
import { RigQueue } from "./rig.mjs";

/**
 * Per-item transition headroom. A single queue item accruing more than this many
 * transitions would be pathological (queued -> claimed <-> deferred -> done is
 * a handful); the stride keeps `seq` strictly increasing without a global map.
 */
export const SEQ_STRIDE = 10000;

/**
 * Read the queue document directly from storage (no harness). Returns the
 * `{ items, nextId }` value, or empty when no queue document exists yet.
 */
async function readQueueValue(storage, context) {
	const rec = await storage.findDocument(
		{ kind: RigQueue.definition.kind, scope: { kind: "session" } },
		"current",
		context,
	);
	if (!rec) return { items: [], nextId: 1 };
	const val = (await storage.document(rec.id, "current", context))?.value ?? {};
	return { items: val.items ?? [], nextId: val.nextId ?? 1 };
}

/**
 * Map one queue transition to a feed event. `transitionIndex` is the position
 * within the item's transition log, which is what makes two transitions on the
 * same item distinct and ordered.
 */
function eventForTransition(item, transition, transitionIndex) {
	const seq = item.id * SEQ_STRIDE + transitionIndex + 1;
	const base = { seq, ts: transition.at, itemId: item.id };
	switch (transition.event) {
		case "queued":
			return {
				...base,
				kind: "queue.enqueued",
				to: item.to,
				from: item.from,
				subject: item.subject,
			};
		case "claimed":
			return { ...base, kind: "queue.claimed", seat: item.to };
		case "done":
			return { ...base, kind: "queue.done", closure: item.notice ? "notice" : "no-follow-on" };
		case "deferred":
			return { ...base, kind: "queue.deferred", seat: item.to };
		default:
			// Unknown transition kinds are still surfaced, not dropped: a feed
			// that silently loses a state change is worse than one with a raw kind.
			return { ...base, kind: `queue.${transition.event}`, seat: item.to };
	}
}

/**
 * Build the full event list from a queue value alone. Pure, so it is unit-tested
 * without storage. Ordered by `seq` ascending.
 */
export function buildEvents(items) {
	const events = [];
	for (const item of items ?? []) {
		const transitions = item.transitions ?? [];
		transitions.forEach((t, i) => events.push(eventForTransition(item, t, i)));
	}
	events.sort((a, b) => a.seq - b.seq);
	return events;
}

/**
 * Read the durable feed from storage. READ-ONLY.
 *
 * @param {object} storage an opened storage (from openNodeSqliteStorage)
 * @param {object} context the background context
 * @param {{ sinceSeq?: number }} [opts] `sinceSeq` resumes strictly after that
 *   cursor; omit (or 0) to read the whole retained feed.
 * @returns {Promise<{ events: Array<object>, nextSeq: number }>} `events` are the
 *   events with `seq > sinceSeq` in order; `nextSeq` is the greatest `seq`
 *   observed (0 when none), the cursor to pass on the next read.
 */
export async function readFeed(storage, context, { sinceSeq = 0 } = {}) {
	const queue = await readQueueValue(storage, context);
	const all = buildEvents(queue.items);
	const seq = Number.isFinite(sinceSeq) ? sinceSeq : 0;
	const events = all.filter((e) => e.seq > seq);
	const nextSeq = all.length ? all[all.length - 1].seq : 0;
	return { events, nextSeq };
}
