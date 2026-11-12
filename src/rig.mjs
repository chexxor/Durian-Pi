// durig — minimal rig layer on pi-durable.
//
// Design notes:
// - Seats are pi-durable conversations; the seat NAME and role live in a
//   session-scoped registry document so any client can resolve name->id.
// - The cross-seat work queue is a session-scoped singleton document changed
//   in the same atomic commits as the transcripts that produce work, so a
//   queue item can never disagree with the conversation state that made it.
// - Mailbox semantics: every seat's tools see only items addressed to it;
//   completing an item enqueues a DONE notice back to the sender, so both
//   directions flow through one durable queue.
import { configure, defineDoc, defineExtension, defineTool, section } from "@earendil-works/pi-durable";
import { arr, bool, int, lit, nul, num, obj, opt, str, union } from "@earendil-works/pi-schema";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { seatHasReadTool, seatIsCoordinator } from "./seattools.mjs";
import { derivePark, normalizeBlock } from "./queue-lifecycle.mjs";
import { validateHumanDefer } from "./deferlease.mjs";
import { removeSeatWorkspace } from "./worktree.mjs";
import {
	DEFAULT_STRATEGY,
	effectivePriority,
	orderCandidates,
	resolveStrategy,
	validatePriorityRequest,
} from "./workstrategy.mjs";

/** Seat roster: name -> conversation id + role text. Session singleton. */
export const Seats = defineDoc({
	kind: "durig.seats",
	version: 1,
	scope: "session",
	initial: () => ({ seats: {} }), // name -> {conversationId, role, goal, capabilities}
	// REQUIRED in pi-durable 1.5.1 (defineDoc has no default for it). `() => false` keeps every change a
	// delta: no base is written, reads replay the deltas. PROVISIONAL — the real checkpoint policy for the
	// rig docs is a seat decision (ROADMAP 355); see docs/reviews/pi-1.5.1-delta-review-2026-11-10.md §5.
	checkpointWhen: () => false,
});

/** Organizational links: from -> allowed recipients. Absent/empty = open. */
export const Edges = defineDoc({
	kind: "durig.edges",
	version: 1,
	scope: "session",
	initial: () => ({ edges: [] }), // [{from, maySendTo:[names]}]
	checkpointWhen: () => false, // provisional, see Seats above and ROADMAP 355
});

/** Constitution file text, injected into every seat's system prompt. */
export const Constitution = defineDoc({
	kind: "durig.constitution",
	version: 1,
	scope: "session",
	initial: () => ({ text: "" }),
	checkpointWhen: () => false, // provisional, see Seats above and ROADMAP 355
});

/**
 * Rig-level control flags (ROADMAP 131, `pause`/`unpause`). ONE persisted flag: while
 * `paused` is true the driver does NOT wake a seat to CLAIM new work and `claim_work`
 * refuses a NEW claim — but in-flight work SETTLES (a claimed item still finishes; a
 * stalled claim is still re-woken). Session singleton, like the roster: it is the
 * broker's state, changed only by the broker's own writer (the command spool), so
 * `pause` never becomes a second store writer.
 */
export const RigControl = defineDoc({
	kind: "durig.control",
	version: 1,
	scope: "session",
	initial: () => ({ paused: false, pausedAt: null, pausedBy: null, reason: null, directive: null }),
	checkpointWhen: () => false, // provisional, see Seats above and ROADMAP 355
});

/**
 * Gate for send_work: organizational edges (who may send to whom) and
 * capability requirements (A2A-style advertised tags). Throws with a
 * model-readable reason so the sending seat can self-correct.
 */
export async function assertSendAllowed(tx, from, to, requires) {
	const targetId = await seatId(tx, to);
	const edges = await tx.doc(Edges);
	if (edges.edges.length > 0) {
		const link = edges.edges.find((e) => e.from === from);
		if (!link || !link.maySendTo.includes(to)) {
			throw new Error(
				link
					? `org edge forbids ${from} -> ${to}; allowed: ${link.maySendTo.join(", ")}`
					: `no org edge grants ${from} any send target`,
			);
		}
	}
	if (requires) {
		const seats = await tx.doc(Seats);
		const caps = seats.seats[to]?.capabilities ?? [];
		if (!caps.includes(requires)) {
			throw new Error(
				`seat ${to} lacks required capability "${requires}" (has: ${caps.join(", ") || "none"})`,
			);
		}
	}
	return targetId;
}

/**
 * Cross-seat work queue.
 *
 * Status flow: queued -> claimed -> done, plus claimed <-> deferred and
 * claimed -> held -> queued: a seat that cannot proceed without an answer
 * parks the item it holds (`defer_work`) and takes it back once the answer
 * arrives (`resume_work`). A seat that cannot proceed without a specific
 * answer but has no question to ask can park its item (`hold_work`), which
 * makes it unclaimable until released (`release_work`) back to queued.
 *
 * Transitions are appended (audit trail), never mutated in place.
 */
export const RigQueue = defineDoc({
	kind: "durig.queue",
	version: 1,
	scope: "session",
	initial: () => ({ nextId: 1, items: [] }),
	checkpointWhen: () => false, // provisional, see Seats above and ROADMAP 355
});

/**
 * The `deferredTo` value meaning "parked on a question for the human operator".
 *
 * Deliberately not a seat: the operator's channel is `status`/`watch` attention,
 * not the queue, so nothing is enqueued for this. Naming it explicitly is what
 * lets the attention layer say a seat is waiting on a person rather than
 * laundering the question back into seat-to-seat traffic.
 */
export const DEFERRED_TO_HUMAN = "human";

/**
 * The `deferredTo` value meaning **nobody was asked** (#4574).
 *
 * DISTINCT FROM `DEFERRED_TO_HUMAN` ON PURPOSE. The default used to be `args.to ?? DEFERRED_TO_HUMAN`, so a
 * deferral that named no target recorded the OPERATOR as its audience — a status standing in for a fact,
 * where the fact is "nobody was actually asked". Every surface that branches on the value must be able to
 * tell the two apart, which is why attention.mjs renders this one as a sentence rather than a name.
 */
export const DEFERRED_TO_NOBODY = "nobody";

/**
 * Snapshot a pi-durable doc item (or array of items) into plain JS objects.
 *
 * A doc proxy resolves primitive properties fine, but the overlay THROWS
 * "Cannot use a settled overlay" when you call array methods or spread it
 * after the commit callback returns. This helper reads only plain fields
 * INSIDE the commit so the result survives settlement. Seat rule: never
 * let a doc proxy escape the `api.commit` callback — snapshot inside, return plain.
 *
 * @param {object|Array} item a single doc item or array of doc items
 * @returns {object|Array} a plain JS copy (object or array of objects)
 */
export function snapshot(item) {
	if (Array.isArray(item)) {
		return item.map((it) => {
			if (it == null) return it;
			const out = {};
			for (const k of Object.keys(it)) out[k] = it[k];
			return out;
		});
	}
	if (item == null) return item;
	const out = {};
	for (const k of Object.keys(item)) out[k] = item[k];
	return out;
}

/** Resolve a seat name to its conversation id; throws on unknown seat. */
export async function seatId(tx, name) {
	const seats = await tx.doc(Seats);
	const seat = seats.seats[name];
	if (!seat) throw new Error(`unknown seat: ${name}`);
	return seat.conversationId;
}

/** Register a seat inside an existing transaction (caller owns the commit). */
export async function registerSeat(tx, name, conversationId, role) {
	const seats = await tx.doc(Seats);
	if (seats.seats[name]) throw new Error(`seat already registered: ${name}`);
	seats.seats[name] = { conversationId, role };
}

/**
 * Is this queue item a DONE acknowledgement rather than work? Completing a
 * notice must not enqueue another notice, or every ack spawns an ack and the
 * chain (#3 "DONE #1" -> #5 "DONE #3: DONE #1" -> #9 ...) grows without bound,
 * burning a seat turn per hop (ROADMAP 39). The structural `notice` flag is the
 * real mechanism, set at enqueue time; the subject shape is only a LEGACY
 * fallback for DONE items already in a store that predates the flag, which
 * would otherwise keep looping. Matching exactly the shape complete_work
 * enqueues ("DONE #<id>: <subject>") keeps the fallback from catching real work.
 */
/**
 * The CANCELLATION, as data (#3470): mark the item terminal AND notify the other party, the
 * same way `complete_work` notifies them with a DONE notice.
 *
 * WHY THE NOTICE IS THE POINT: a cancellation's reason is the ONE piece of information that
 * distinguishes "superseded" from "duplicate" from "already ruled" from "stale pin", and
 * those imply different next actions for whoever sent the item. Recording it on the item was
 * not enough — from the sender's side the item simply vanished, so they guessed, and guessing
 * cost a full re-registration cycle for eight branches.
 *
 * A NOTICE NEVER SPAWNS A NOTICE (`isNoticeItem`), so cancelling a DONE or CANCELLED notice
 * cannot start a chain (ROADMAP 39). `tx` only needs `doc(RigQueue)`, which is what makes this
 * drivable from a demo without a harness.
 */
export async function cancelItem(tx, { item, me, reason }) {
	item.status = "cancelled";
	item.cancelReason = reason;
	item.transitions.push({ at: new Date().toISOString(), event: "cancelled", by: me, reason });
	// The other party: the sender when the RECIPIENT cancels, the recipient when the SENDER does.
	const other = item.from === me ? item.to : item.from;
	// Three DIFFERENT situations send no notice, and the message is the whole interface the caller
	// has (#3739): "there is no other party" is a correct outcome, "this item is itself a notice" is
	// a classification, and conflating them hid a cancellation that reached nobody.
	const selfOnly = typeof other !== "string" || other.length === 0 || other === me;
	const noticeOfNotice = isNoticeItem(item);
	let noticeId = null;
	if (!noticeOfNotice && !selfOnly) {
		noticeId = await enqueueItem(
			tx,
			me,
			other,
			`CANCELLED #${item.id}: ${item.subject}`,
			`cancelled by ${me}: ${reason}`,
			null,
			true,
			item.tier ?? null,
		);
	}
	const why =
		noticeId !== null
			? `notified ${other} as notice #${noticeId}`
			: selfOnly
				? `no notice sent — there is no other party to notify`
				: `no notice sent — this item is itself a notice`;
	const message = `item #${item.id} cancelled: ${reason} (${why})`;
	return { noticeId, other, message };
}

export function isDoneNotice(item) {
	if (typeof item?.notice === "boolean") return item.notice;
	return /^DONE #\d+: /.test(String(item?.subject ?? ""));
}

/**
 * A CANCELLATION notice (#3470): the message `cancel_work` now sends the OTHER PARTY, so a
 * cancellation no longer looks like an item that silently vanished.
 */
export function isCancellationNotice(item) {
	if (typeof item?.notice === "boolean") return item.notice;
	return /^CANCELLED #\d+: /.test(String(item?.subject ?? ""));
}

/**
 * Is this item a NOTICE of any kind (a DONE ack or a CANCELLATION)? A notice must never
 * spawn another notice, or every terminal transition begets a hop and the chain grows
 * without bound (ROADMAP 39). Both terminal tools consult this instead of their own shape,
 * so a cancellation of a cancellation cannot loop.
 */
export function isNoticeItem(item) {
	// THE STRUCTURAL FLAG WINS (#3739). The subject-prefix fallback exists only for flag-less
	// items that predate the flag; letting it override a structural non-notice is how a WORK item
	// whose free-text subject happens to start "DONE #123: " got cancelled without notifying
	// anyone, while the tool told the caller the item "is itself a notice". Subjects are free
	// text, so the prefix cannot be the authority - only a missing flag can defer to it.
	if (typeof item?.notice === "boolean") return item.notice;
	return /^(?:DONE|CANCELLED) #\d+: /.test(String(item?.subject ?? ""));
}

/**
 * A terminal item is finished either way: `done` (the work happened) or
 * `cancelled` (it no longer should). Both are invisible to the driver and to
 * any "non-terminal work" view, and neither can be claimed — so every place that
 * used to test `status !== "done"` must test this instead, or a cancelled item
 * reappears as phantom work.
 */
export function isTerminalItem(item) {
	return item?.status === "done" || item?.status === "cancelled";
}

/**
 * THE WORKABLE PREDICATE (#2673, lead-ratified definition in #2677). "Is this item claimable
 * BY THIS SEAT, right now?" — the question `claim_work` used to answer with `status ===
 * "queued"` alone, which is why a row blocked on an unclosed gate or an unadvertised
 * capability still occupied the oldest-claim slot and starved the work behind it.
 *
 * Returns `{ workable, reason }`. `reason` is the LEGIBLE skip code (null when workable):
 *   `not-queued:<status>`   — the caller passed something it should not have;
 *   `requires:<cap>`        — the seat does not advertise the capability the item demands;
 *   `gate-open:#<id>(<st>)` — a recorded prerequisite is not DONE yet;
 *   `gate-cancelled:#<id>`  — a recorded prerequisite was CANCELLED: the prerequisite was
 *                             DROPPED, so the item may be stale. "terminal" != "done", and
 *                             this is a POSITIVE non-workability, not an ambiguity.
 *
 * THE CONSERVATIVE DEFAULT (refinement 3) is load-bearing: a MISSING or AMBIGUOUS signal
 * means WORKABLE. A false negative starves a workable item (invisible, and it looks exactly
 * like an empty queue); a false positive hands the seat a maybe-blocked item it can still
 * hold or defer, and the refusal is legible. So a gate id that names nothing in the queue is
 * passed over as unknown rather than treated as unmet.
 *
 * CLAUSE 4 (a persisted provider/seat FAULT) is NOT implemented: no such field exists, and
 * D24 forbids inventing a schema or write path for it. That gap is registered as backlog
 * rather than faked with model-level guessing.
 */
/**
 * The FIRST gate id on this row that names a CANCELLED row, or null when the gate is live.
 *
 * The same semantics as the `gate-cancelled:#<id>` code in `workable` above: a CANCELLED
 * prerequisite is a DROPPED prerequisite, not an unmet one, and a missing id is ambiguous, so it
 * is passed over rather than treated as dead. Extracted because two write paths now need it - the
 * release refusal below and the claim predicate - and a gate rule kept in two places is a rule
 * that drifts (#6112).
 */
export function deadGateId(item, items = []) {
	for (const id of item?.blockedBy ?? []) {
		const target = items.find((it) => it.id === id);
		if (target && target.status === "cancelled") return id;
	}
	return null;
}

export function workable(item, seat, { items = [], capabilities = [] } = {}) {
	if (!item) return { workable: false, reason: "missing-item" };
	if (item.status !== "queued") return { workable: false, reason: `not-queued:${item.status}` };
	const required = typeof item.requires === "string" ? item.requires.trim() : "";
	if (required !== "" && !capabilities.includes(required)) {
		return { workable: false, reason: `requires:${required}` };
	}
	for (const id of item.blockedBy ?? []) {
		const target = items.find((it) => it.id === id);
		// Ambiguous (no such item in the queue): the conservative default says workable.
		if (!target) continue;
		if (target.status === "done") continue;
		if (target.status === "cancelled") return { workable: false, reason: `gate-cancelled:#${id}` };
		return { workable: false, reason: `gate-open:#${id}(${target.status})` };
	}
	return { workable: true, reason: null };
}

/**
 * THE WORKABLE SELECTION (#2673), now ORDER-AWARE.
 *
 * Extracted so the choice is testable without a harness: `claim_work` with no itemId must return the
 * first WORKABLE item for this seat IN STRATEGY ORDER, and must REPORT every item it passed over — a
 * starved item is otherwise indistinguishable from an empty queue.
 *
 * TWO RESPONSIBILITIES, DELIBERATELY SEPARATED:
 *  - ORDER (`orderCandidates`, src/workstrategy.mjs) answers "in what sequence do I look". It is a policy
 *    an operator declares, so it lives in the table-module and can be tested with no store at all.
 *  - CLAIMABILITY (`workable` above) answers "may this seat take this row". It stays here, single-owned:
 *    a second gate rule in the ordering function is how a gate rule drifts (#6112's reason for
 *    extracting `deadGateId`).
 *
 * Only items addressed to `seat` and still `queued` are candidates; the scan stops at the first workable
 * one. Under the default `oldest_first` that is byte-for-byte the historical answer (ascending id ==
 * insertion order == array order), so a rig that does not opt in is unchanged.
 *
 * `strategy` is REQUIRED to be one of the implemented names: an unknown name throws (see
 * `assertWorkStrategy`) rather than silently ordering oldest-first. `now` is injected for tests only.
 */
export function selectNextWork(items, seat, { capabilities = [], strategy = DEFAULT_STRATEGY, now = Date.now(), directive = null } = {}) {
	const skipped = [];
	// The DIRECTIVE enters the ORDER only, never `workable()`: a policy may say which eligible row looks
	// most urgent, and may never make an ineligible one claimable. Keeping the two apart is the same
	// separation the header above describes (#6112), and it is what makes a directive safe to grant.
	for (const candidate of orderCandidates(items, { strategy, now, directive })) {
		if (candidate.to !== seat || candidate.status !== "queued") continue;
		const verdict = workable(candidate, seat, { items, capabilities });
		if (verdict.workable) return { item: candidate, skipped };
		skipped.push({ id: candidate.id, reason: verdict.reason });
	}
	return { item: null, skipped };
}

/**
 * The OLDEST-WORKABLE SELECTION (#2673) — kept as a BACK-COMPATIBLE ALIAS.
 *
 * Six demos import this name (`demo/workable-claim.test.mjs:25`, plus the deferred-stage, pm-release,
 * blockedBy and wake-claimability pins). They are the proof that the strategy change is a no-op for the
 * default: renaming the seam would have forced them to change, and a test that had to be edited to keep
 * passing proves nothing about compatibility. The alias IGNORES any `strategy` passed in — its contract is
 * "oldest", and honouring a strategy here would make a name that says oldest return something else.
 */
export function selectOldestWorkable(items, seat, opts = {}) {
	return selectNextWork(items, seat, { ...opts, strategy: DEFAULT_STRATEGY });
}

/**
 * One rendered line for a queue item in `peek_queue` and in its `.durig/queue-<scope>.md` mirror.
 * A GATED item shows its gate (`blockedBy=1,2`) so a seat reading its own queue sees what the work
 * waits on, not merely that the work exists. Call this INSIDE the commit: `blockedBy` is an array
 * field, and reading a doc proxy after the commit settles throws "Cannot use a settled overlay".
 */
function queueItemLine(it) {
	const gate =
		it.blockedBy && it.blockedBy.length ? ` blockedBy=${[...it.blockedBy].join(",")}` : "";
	// A PRIORITY LEASE is shown with its EFFECTIVE value, not the stored one: an expired `now` that still
	// prints as `now` would read as urgent in the queue view while ordering neutral in the selector — two
	// views of one row disagreeing, which is how a reader concludes the selector is broken. Lapsed rows say
	// so, with the instant, so "why did #6193 stop jumping the queue" is answerable from the line itself.
	const priority = it.priority
		? (() => {
				const eff = effectivePriority(it);
				if (eff.lapsed) return ` priority=${eff.raw}~lapsed@${eff.expiresAt}`;
				if (eff.invalid) return ` priority=${String(eff.raw)}!invalid`;
				return ` priority=${eff.priority}${eff.expiresAt ? ` until=${eff.expiresAt}` : ""}`;
			})()
		: "";
	// #6112: a row that was un-parked says WHO un-parked it and WHY in the same line the seat
	// already reads. A release that is only a `transitions` entry is invisible to a seat scanning
	// its queue, so the row looks as if it un-parked itself and the coordinator's action is lost.
	const release = it.release
		? ` releasedBy=${it.release.by}${it.release.reason ? ` reason=${it.release.reason}` : ""}`
		: "";
	return `#${it.id} ${it.status} from=${it.from} to=${it.to} ${it.subject}${gate}${priority}${release}`;
}

/**
 * Normalize a `blockedBy` gate to the item's structured shape: a plain array of POSITIVE INTEGER
 * queue-item ids, or `null` when there is no gate.
 *
 * The gate is a FIELD, not prose (docs/WORK-ITEM-SCHEMA.md §4/R5). A prose value
 * ("GATED on #1234") is REJECTED here rather than parsed — prose is the unqueryable form the field
 * replaces, and 325 items already prove that form decays. Absence and an empty list both mean
 * UNGATED (an item with no gate is unblocked, never "unknown, so hold" — §7), so both normalize to
 * `null` and the field is omitted from the stored item.
 *
 * Duplicates collapse (a gate is a set); order is preserved so a listing is stable. This is the
 * shape the `workable` predicate reads (#2673 claim selection / #2712 broker wake selection):
 * `item.blockedBy` is either absent or an array of ids that must each resolve to a terminal `done`.
 */
export function normalizeBlockedBy(list) {
	if (list === undefined || list === null) return null;
	if (!Array.isArray(list)) {
		throw new Error(
			`blockedBy must be a list of queue-item ids, not ${typeof list === "string" ? `prose ${JSON.stringify(list)}` : typeof list}`,
		);
	}
	const out = [];
	for (const raw of list) {
		if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
			throw new Error(
				`blockedBy entry must be a positive integer queue-item id, got ${JSON.stringify(raw)}`,
			);
		}
		if (!out.includes(raw)) out.push(raw);
	}
	return out.length ? out : null;
}

/**
 * Enqueue work. Called inside a transaction; returns the assigned item id.
 * `transitions` records who did what and when for the audit trail.
 *
 * `notice` marks a protocol acknowledgement (a DONE notice) rather than work, so
 * completing it can be recognised structurally instead of by its subject.
 *
 * `blockedBy` is the optional structured GATE (operator ruling on #2919; D53 supersedes D24): the
 * queue-item ids this work waits on. It rides THIS enqueue path — the one write path — rather than
 * a parallel store, and is omitted entirely when there is no gate (absence = unblocked).
 *
 * `requires` and `block` ride the same path (queue-lifecycle M1a, lead #3048): `requires` is the
 * capability a claimant must advertise (persisted so claimability can read it — it was previously a
 * send-time check only), and `block` is the structured park (`normalizeBlock` validates it, so the ONE
 * write path is also the one place a malformed park cannot be stored). Both are omitted when absent:
 * absence means "no capability requirement" / "unblocked", never "unknown, so hold".
 */
export async function enqueueItem(
	tx,
	from,
	to,
	subject,
	body,
	optimizedVia = null,
	notice = false,
	tier = null,
	held = false,
	blockedBy = null,
	requires = null,
	block = null,
) {
	const queue = await tx.doc(RigQueue);
	const id = queue.nextId++;
	const gateRequires =
		typeof requires === "string" && requires.trim().length > 0 ? requires.trim() : null;
	const gateBlock = block ? normalizeBlock(block) : null;
	const item = {
		id,
		from,
		to,
		subject,
		body,
		// Provenance: non-null means the body was machine-optimized before
		// enqueue; names the model that did it. Null = human-written.
		optimizedVia,
		// A protocol notice (a DONE ack), not work: completing it enqueues nothing.
		notice,
		// Ratcheting task tier (RANK 2 borrow): the PM's size for the request,
		// assigned at intake and LATCHED onto the item's chain (its DONE notice,
		// verification item and follow-ups inherit it). null = not tiered.
		...(tier ? { tier } : {}),
		// The structured GATE: queue-item ids this item is blocked on, or ABSENT when ungated
		// (docs/WORK-ITEM-SCHEMA.md §4/R5, §7). A plain array of ids so the `workable`
		// predicate (#2673 / #2712) can read it without parsing prose.
		...(blockedBy ? { blockedBy: [...blockedBy] } : {}),
		// The capability a claimant must advertise, persisted so claimability can be decided per seat
		// (F1: it was a send-time check only, so nothing could read it back). Absent = no requirement.
		...(gateRequires ? { requires: gateRequires } : {}),
		// The structured PARK (`block`), validated here so the ONE write path is also the one place a
		// malformed park cannot be stored. Absent = unblocked (the legacy exemption, design §7).
		...(gateBlock ? { block: gateBlock } : {}),
		// A HELD/PARKED item (operator queue-hygiene directive, #1885) is created
		// unclaimable and does NOT wake the recipient: a "registered, do not start"
		// backlog row must not occupy a working seat's oldest-first claim slot.
		// `release_work` restores it to queued when it should become claimable.
		status: held ? "held" : "queued",
		transitions: [{ at: new Date().toISOString(), event: held ? "held" : "queued", by: from }],
	};
	// #6150: a parked row RECORDS what its park is, from structure (gate ids, an authored block), so a
	// fleet metric filters on the field instead of reading prose. It is written BEFORE the push because
	// the doc proxy re-keys the element on push - mutating the plain object afterwards is lost. Only a
	// row that is actually parked gets one; an ungated row is never silently labelled.
	if (held) item.park = parkRecord(queue, item);
	queue.items.push(item);
	return id;
}

/** #6150: the structured park record for a row this commit is parking. */
function parkRecord(queue, item) {
	const statusOf = (id) => queue.items.find((it) => it.id === id)?.status ?? "absent";
	const park = derivePark(item, { statusOf });
	return {
		class: park.class,
		basis: park.basis,
		gateIds: park.gateIds,
		recordedAt: new Date().toISOString(),
	};
}

/**
 * A short, stable digest of a body — the caller's check that a revise LANDED (#3435).
 * Truncated to 16 hex chars: this is a comparison handle for a human or a seat, not a
 * security primitive (the body is not secret; the queue is readable).
 */
export function bodyDigest(body) {
	return createHash("sha256").update(String(body ?? ""), "utf8").digest("hex").slice(0, 16);
}

/**
 * The revise COMPARISON, as data (#3435): apply the submitted fields to `item` and say
 * which of three things happened, so a caller can never mistake "nothing to change" for
 * "your change was dropped".
 *
 *  - `revised`   — at least one field differed and was written (verified by re-reading it
 *                  in the same call); `fields` names what landed.
 *  - `no-change` — every submitted field is byte-identical to the stored one. Nothing was
 *                  written, and the caller is TOLD so, with the stored digest.
 *  - `mismatch`  — a field was submitted, the write was attempted, and the stored value
 *                  still does not equal it. This is the case that used to be reported as
 *                  success; the tool turns it into REVISE_WORK_ERROR.
 *
 * Pure apart from the `item` mutation it is asked to perform; no I/O, so a demo can drive
 * all three outcomes without a store.
 */
export function applyRevise(item, { subject, body } = {}) {
	const submitted = [];
	const changed = [];
	if (subject !== undefined) {
		submitted.push("subject");
		if (subject !== item.subject) {
			item.subject = subject;
			changed.push("subject");
		}
	}
	if (body !== undefined) {
		submitted.push("body");
		if (body !== item.body) {
			item.body = body;
			changed.push("body");
		}
	}
	// Verify inside the same call: a submitted field that did not land is a MISMATCH.
	const failed = [];
	if (subject !== undefined && item.subject !== subject) failed.push("subject");
	if (body !== undefined && item.body !== body) failed.push("body");
	const status = failed.length > 0 ? "mismatch" : changed.length > 0 ? "revised" : "no-change";
	return {
		status,
		fields: status === "mismatch" ? failed : changed,
		submitted,
		digest: bodyDigest(item.body),
		bodyBytes: Buffer.byteLength(String(item.body ?? ""), "utf8"),
	};
}

/**
 * The MESSAGE a revise returns (#3435), one shape per outcome so no caller can read a
 * dropped change as a success:
 *  - `revised`   → names the fields that landed AND the stored body digest + byte count, so
 *                  the caller can compare against what they sent without re-reading;
 *  - `no-change` → says "no change" in those words and that NOTHING was written, with the
 *                  digest — the caller can still tell whether the stored text is the text
 *                  they meant;
 *  - `mismatch`  → an ERROR-shaped line (`REVISE_WORK_ERROR:`), never a success.
 */
export function reviseMessage(item, outcome) {
	if (outcome.status === "mismatch") {
		return `REVISE_WORK_ERROR: item #${item.id} did not take the submitted ${outcome.fields.join(", ")} (stored body sha256=${outcome.digest}); nothing was changed`;
	}
	if (outcome.status === "no-change") {
		return `item #${item.id} no change — the submitted ${outcome.submitted.join(" and ")} already matches the stored text (body sha256=${outcome.digest}); nothing was written`;
	}
	return `item #${item.id} revised (${outcome.fields.join(", ")}); it stays queued for ${item.to}. Stored body sha256=${outcome.digest} (${outcome.bodyBytes} bytes) — compare it with what you sent to verify the write landed.`;
}

// Ratcheting task tier (RANK 2 borrow; source vendor/eval/agent-fleet @ 7c34dde
// docs/ARCHITECTURE.md "Task-tier budgets": the tier is task-scoped and ratcheted
// - lowering is free, raising needs a stated reason). Durig maps the PM S/M/L onto
// the ordered tiers trivial < small < feature < project. Raising = moving to a
// HIGHER index; lowering = same or lower. A new intake (new subject from the
// operator) starts a NEW tier; the chain (DONE notice, verification, follow-up)
// latches onto the originating item's tier.
export const RATCHET_TIERS = ["trivial", "small", "feature", "project"];

/**
 * The base task of a queue-item subject: strip the leading `DONE #<n>: ` (and
 * any QUESTION prefix) so a follow-up, verification or DONE notice of the same
 * task compares against the same originating subject. Used by the raise guard.
 */
export function baseTaskSubject(subject) {
	return String(subject ?? "").replace(/^(DONE|QUESTION) #\d+: /, "");
}

/** Index in RATCHET_TIERS, or -1 if not a known tier. */
export function tierIndex(tier) {
	return RATCHET_TIERS.indexOf(String(tier ?? ""));
}

// Tool results cross the content->output rename in @earendil-works/pi-durable:
// the 1.1.0 release reads `content`, current main reads `output`. Returning
// both keeps durig correct on the published release AND on pinned main, and
// each version ignores the field it does not know.
function toolText(text) {
	const content = [{ type: "text", text }];
	return { content, output: content };
}

// Thin-context return contract (agent-fleet borrow, ROADMAP RANK 1; source of
// truth: vendor/eval/agent-fleet @ 7c34dde, docs/ARCHITECTURE.md "Research
// helpers write findings to disk; the hub resumes specialists with paths, not
// raw dumps"; durig shape per docs/COMPETITORS.md "durig seats already write to
// disk, but our tool results still return bodies; the lesson is the return
// contract"). CONTRACT (verbatim): for claim_work (and any toolText result over
// the threshold), the tool returns a PATH; the full body is written to
// cwd/.durig/<itemId>.md and read back via existing read tools. Results under
// the threshold are unchanged (inline, byte-identical). Additive opt-in seam at
// toolText: small bodies stay inline; only the large claim body is deferred to
// disk. Deterministic per-item path so the demo can assert it and the body is
// idempotently re-readable (re-claim rewrites the same file).
export const TOOL_RESULT_INLINE_LIMIT = 2000;

/**
 * Write an over-threshold tool result body to the seat's disk workspace and
 * return the INLINE STRUCTURED HEADER per the thin-context return contract
 * (RANK-1 / #59) plus the truncation-usability ruling (ROADMAP 42 / #118 half 2,
 * lead #125). Under the threshold (or when there is no usable seat workspace)
 * the original text is returned unchanged, so small/short results stay
 * byte-identical and the coordinator's context stays thin only for the large
 * dump.
 *
 * Over threshold: the FULL body still goes to cwd/.durig/<itemId>.md (body on
 * disk; small results inline — RANK-1/#59 is preserved), but the RETURN is a
 * DELIBERATE STRUCTURED HEADER (item id + path + the decision-relevant fields
 * from/to/subject/status supplied by the caller) — NOT a mid-body byte
 * truncation. A no-read-tool coordinator seat can act on the head, and a seat
 * with a read tool opens the file for the whole body. The path is always
 * present so the body stays retrievable. No new egress surface; no fork of the
 * contract by seat class.
 * @param {{cwd?: string}|undefined} env the executing conversation's ExecutionEnv
 * @param {string} text the full tool-result text
 * @param {number|string} itemId the queue item id (deterministic file name)
 * @param {string|undefined} head the structured header (id + decision fields);
 *   used verbatim over the threshold so the action survives the deferral
 * @returns {string} a structured header (over threshold) or the original text (under)
 */
export function thinResultText(env, text, itemId, head, { inlineBody = false } = {}) {
	if (typeof text !== "string") return text;
	// A seat with no read tool cannot open the returned path, so an over-threshold body must
	// arrive inline or the item is unreadable to it (lead #144 B). Thin-context still holds for
	// every seat that has a read tool: it gets the structured head + the path.
	if (inlineBody || text.length <= TOOL_RESULT_INLINE_LIMIT) return text;
	const cwd = env?.cwd;
	if (!cwd) return text; // no workspace to defer to: keep the inline contract
	const file = join(cwd, ".durig", `${itemId}.md`);
	mkdirSync(join(cwd, ".durig"), { recursive: true });
	writeFileSync(file, text, "utf8");
	// A coordinator seat (pm) has NO read tool (COORDINATOR_REMOVALS), so a bare
	// path made the item unreadable to it — found live on #100, where pm deferred
	// rather than guess. Lead #125: the over-threshold return must be a DELIBERATE
	// STRUCTURED SELECTION of the decision-relevant fields (id + path + the
	// from/to/subject/status head the caller supplies), NOT a mid-body byte cut.
	const structuredHead = head ? head : `[item #${itemId}]`;
	return `${structuredHead}\n\n[item #${itemId}: full text at ${file} - open it with a read tool when you need the whole body.]`;
}

const Router = defineExtension({
	name: "durig.router",
	sections: [
		// Team constitution reaches every seat's system prompt here; the doc
		// is session-scoped so one edit re-arms all seats on next request.
		section("durig-constitution", async (input, context) => {
			const c = await input.read.snapshot(
				Constitution,
				input.conversationId,
				context,
			);
			return c?.text || undefined;
		}),
	],
	tools: [
		defineTool({
			name: "send_work",
			description:
				"Send a work item to another seat. The seat claims it from its queue. " +
				"Pass `held: true` to create it UNCLAIMABLE and un-waking (a parked backlog registration): " +
				"it does not occupy the recipient's oldest-first claim slot and does not wake it until released. " +
				"Pass `blockedBy: [ids]` to record a structured GATE (the queue-item ids this work waits on); " +
				"omit it when there is no gate. Gates are ids, never prose. " +
				"Pass `block` to record WHY a parked item is parked (reason + a mandatory resolver + reviewBy); " +
				"omit it when the item is not parked. Pass `requires` for a capability the claimant must advertise.",
			parameters: obj({
				to: str({ description: "recipient seat name" }),
				subject: str(),
				body: str(),
				requires: opt(str({
					description:
						"capability the recipient must advertise; it is checked now AND persisted on the item so claimability can read it",
				})),
				blockedBy: opt(arr(int({ minimum: 1 }), {
					description:
						"structured gate: the queue-item ids this work is blocked on (must resolve to terminal `done` before the item is workable). Omit when ungated.",
				})),
				block: opt(
					obj({
						source: opt(
							union([lit("declared"), lit("legacy")]),
						),
						reason: str({
							description:
								"why the item is parked: dependency|question|operator|schedule|resource|manual|backlog|roadmap-gate",
						}),
						resolver: str({
							description:
								"who or what clears the park (mandatory): a seat name, operator|human|automatic, #<id> or RM-<n>",
						}),
						constraints: opt(
							arr(
								obj({
									kind: str({ description: "queue|roadmap|window" }),
									ref: opt(union([str(), num()])),
									note: opt(str()),
								}),
							),
						),
						payload: opt(obj({}, { open: true })),
						reviewBy: opt(
							union([str(), nul()], {
								description:
									"when to look again (ISO date); omit for the per-reason default, null only for backlog/question",
							}),
						),
					}),
				),
				held: opt(bool({
					description:
						"Create the item PARKED (status held): unclaimable and no wake, so a 'registered, do not start' backlog row cannot starve a working seat. Release it later with release_work.",
				})),
				optimize: opt(bool({
					description: "Rewrite body through the instruction optimizer before enqueueing (costs one model call).",
				})),
				tier: opt(union([
					lit("trivial"),
					lit("small"),
					lit("feature"),
					lit("project"),
				], {
					description: "Ratchet tier for this task (trivial/small/feature/project); assigned at intake and latched onto the chain. Raising above an existing tier needs a `reason`.",
				})),
				reason: opt(str({
					description: "Required when RAISING the tier for an existing task; lowering is free so a reason is optional then.",
				})),
			}),
			replay: "safe", // pure durable-state write; rerun after crash is idempotent-safe at doc level
			execute: async (args, api, context) => {
				try {
					const me = await mySeatName(api, context);
					let body = args.body;
					let optimizedVia = null;
					if (args.optimize) {
						// The optimizer rides the SAME model stack as the seats,
						// so its cost and latency are honest and it inherits the
						// generation-slot cap automatically.
						const { optimizeInstruction } = await import("./optimizer.mjs");
						// The seat's own configured model does the optimizing, so
						// cost/latency are honest and the slot cap is inherited.
						const modelRef = (await api.agent(context))?.model;
						if (!modelRef) throw new Error("no model configured for this seat; cannot optimize");
						const result = await optimizeInstruction(
							api.models,
							modelRef,
							args.body,
							{ kind: "work_request" },
						);
						body = result.optimized;
						if (!result.rejected) {
							optimizedVia = `${modelRef.provider}/${modelRef.modelId}`;
						}
					}
					const gate = normalizeBlockedBy(args.blockedBy);
					// The park is validated BEFORE the commit, so a malformed block is a legible refusal and
					// never a half-written item (same discipline as the gate above).
					const park = args.block ? normalizeBlock(args.block) : null;
					const id = await api.commit(async (tx) => {
						await assertSendAllowed(tx, me, args.to, args.requires);
						// Ratcheting tier raise guard: raising an already-tiered task's chain
						// to a HIGHER tier requires a stated reason; lowering is free (RANK 2
						// borrow, ARCHITECTURE.md "survives the next message ... raising needs a
						// stated reason"). The reference tier is the newest existing item with
						// the SAME base task subject (the originating item / its chain).
						const tier = args.tier;
						if (tier) {
							const queue = await tx.doc(RigQueue);
							const base = baseTaskSubject(args.subject);
							const existing = [...queue.items]
								.reverse()
								.find((it) => tierIndex(it.tier) >= 0 && baseTaskSubject(it.subject) === base);
							const newIdx = tierIndex(tier);
							const oldIdx = existing ? tierIndex(existing.tier) : -1;
							if (oldIdx >= 0 && newIdx > oldIdx) {
								// #6112 (ruling #6097): RAISING a tier is a decision about the WORK, not about
								// its parking, so it belongs to the row's parties. A coordinating seat may un-park
								// a chain it did not mint (reversible) but may not resize it - the seat that would
								// have to do the larger work is not the seat that minted the request.
								// Lowering stays free, as before.
								if (existing.from !== me && existing.to !== me) {
									throw new Error(
										`raising tier ${existing.tier}->${tier} for this task is refused: the chain was minted by ${existing.from} for ${existing.to}, and only a party of a task may re-tier it`,
									);
								}
								if (!(args.reason && args.reason.trim())) {
									throw new Error(
										`raising tier ${existing.tier}->${tier} for this task needs a stated reason`,
									);
								}
							}
						}
						return enqueueItem(tx, me, args.to, args.subject, body, optimizedVia, false, tier ?? null, args.held === true, gate, args.requires ?? null, park);
					}, context);
					const label =
						args.held === true
							? `parked item #${id} for ${args.to} (held; release with release_work(${id}) to make it claimable)`
							: `queued item #${id} for ${args.to}`;
					return toolText(`${label}${optimizedVia ? ` (body optimized via ${optimizedVia})` : ""}`);
				} catch (err) {
					return toolText(`SEND_WORK_ERROR: ${err && err.stack ? err.stack : String(err)}`);
				}
			},
		}),
		defineTool({
			name: "claim_work",
			description:
				"Claim a work item addressed to you. With no `itemId`, claims the oldest QUEUED item; pass `itemId` to claim that specific item (must be queued and addressed to you). Returns its subject and body.",
			parameters: obj({ itemId: opt(num()) }),
			replay: "safe",
			execute: async (args, api, context) => {
				const { name: me, hasReadTool } = await mySeatReadability(api, context);
				const found = await api.commit(async (tx) => {
					const queue = await tx.doc(RigQueue);
					// ROADMAP 131: while the rig is PAUSED, a seat is not allowed to CLAIM new
					// work. It may still FINISH work it already holds, so the stalled-claim
					// reveal below stays open. The refusal is legible (PAUSED), never silent.
					const control = await tx.doc(RigControl);
					const paused = control?.paused === true;
					if (paused && args.itemId !== undefined) {
						return { kind: "paused", by: control?.pausedBy ?? null, reason: control?.reason ?? null };
					}
					// Claim by id (lead #214 / #239): a seat names a specific item, so
					// operator-priority work can be picked up even when older queued work
					// sits ahead of it. The status whitelist is IDENTICAL to the oldest
					// path (`to === me && status === "queued"`): a `held` item stays
					// unclaimable so #90's hold is not defeated, and deferred/done/
					// cancelled/other seats' items are refused. By-id NEVER falls back
					// to the oldest item or the stalled-claim reveal: naming one item
					// and silently claiming another would be a lie.
					if (args.itemId !== undefined) {
						const named = queue.items.find(
							(it) => it.id === args.itemId && it.to === me && it.status === "queued",
						);
						if (!named) return null;
						named.status = "claimed";
						named.transitions.push({
							at: new Date().toISOString(),
							event: "claimed",
							by: me,
						});
						return {
							kind: "claimed",
							id: named.id,
							from: named.from,
							subject: named.subject,
							body: named.body,
						};
					}
					// Normal claim: the OLDEST WORKABLE queued item addressed to me (#2673). The scan
					// records every item it passes over and WHY, so a starved item is detectable
					// instead of silently occupying the slot ahead of real work. Suppressed while paused.
					const skipped = [];
					let queued;
					let order = null;
					if (!paused) {
						const seatsDoc = await tx.doc(Seats);
						const seatEntry = seatsDoc.seats[me] ?? {};
						const capabilities = seatEntry.capabilities ?? [];
						// WHICH ORDER is a POLICY, resolved where the roster already lives: the seat's own override
						// beats the team's, which beats `oldest_first`. An unknown name THROWS here (with the valid
						// set in the message) instead of quietly claiming oldest-first — a strategy that silently did
						// not apply is the accepted-and-ignored class (#5071), and it would look exactly like a
						// working rig from every read.
						const resolved = resolveStrategy({
							seatStrategy: seatEntry.workStrategy,
							teamStrategy: seatsDoc.workStrategy,
							defaultStrategy: DEFAULT_STRATEGY,
						});
						const control = await tx.doc(RigControl);
						const picked = selectNextWork(queue.items, me, {
							capabilities,
							strategy: resolved.strategy,
							directive: control?.directive ?? null,
						});
						queued = picked.item ?? undefined;
						skipped.push(...picked.skipped);
						order = resolved;
					}
					if (queued) {
						queued.status = "claimed";
						queued.transitions.push({
							at: new Date().toISOString(),
							event: "claimed",
							by: me,
						});
						// Snapshot plain values before returning: the commit
						// releases its overlay after settlement, and a proxy that
						// escapes the callback throws "Cannot use a settled
						// overlay" the moment its properties are read.
						return {
							kind: "claimed",
							id: queued.id,
							from: queued.from,
							subject: queued.subject,
							body: queued.body,
							skipped,
							order,
						};
					}
					// Stalled-claim legal move (ROADMAP 42 / #118): no queued work, but
					// I already hold a CLAIMED item whose run died and the wake told me
					// to claim. Reveal my OLDEST claimed-by-me item (a PURE READ - status
					// unchanged) so I can advance it with complete_work/defer_work instead
					// of looping on NO_QUEUED_WORK. Only CLAIMED items are revealed:
					// deferred/held/stopped items are untouched, so an operator-stopped
					// item is never resurrected (selectWakes never wakes a stopped seat,
					// so this path is never reached for one).
					const stalled = queue.items.find(
						(it) => it.to === me && it.status === "claimed",
					);
					if (stalled) {
						return {
							kind: "stalled",
							id: stalled.id,
							from: stalled.from,
							subject: stalled.subject,
							body: stalled.body,
						};
					}
					// Paused and nothing already held: a legible refusal, not a silent no-op.
					if (paused) return { kind: "paused", by: control?.pausedBy ?? null, reason: control?.reason ?? null };
					// #4713: THE DATA IS CAPTURED **INSIDE** THE CLOSURE, where `queue` is bound. The previous attempt put
					// the lookup after `}, context);`, where `queue` does not exist: `node --check` passed and six demos passed,
					// because none reaches this path with a live queue. `curate` and `rearmclaim` do, and they threw.
					// #4737: SNAPSHOT INSIDE — return PLAIN data. `mine` was a filtered array OF DOC PROXIES and it ESCAPED
					// the commit callback, so reading it afterwards threw `Cannot use a settled overlay`. The file states this
					// rule in its own words at the `plainItem` helper: "never let a doc proxy escape the `api.commit`
					// callback — snapshot inside, return plain." The whole array had to be spread into plain objects, not
					// merely filtered, because the PROXIES are what do not survive settlement.
					const mine = (queue.items ?? [])
						.filter((it) => it.to === me && it.status !== "done" && it.status !== "cancelled")
						.map((it) => ({ id: it.id, status: it.status, from: it.from, subject: it.subject }));
					return mine.length > 0 ? { kind: "none", mine } : null;
				}, context);
				if (found?.kind === "paused") {
					const why = found.reason ? ` (reason: ${found.reason})` : "";
					return toolText(
						`PAUSED: the rig is paused${found.by ? ` by ${found.by}` : ""}${why} — new work is not claimable until ` +
							"`unpause`. Work you ALREADY hold still completes: use complete_work / defer_work.",
					);
				}
					// #4732: THIS BLOCK MUST PRECEDE `if (!found)`. `{ kind: "none", mine }` is TRUTHY, so `!found` is
					// FALSE and the HEADER rendering below (`ITEM #${found.id} | …`) would run against it — producing
					// `ITEM #undefined | from=undefined | subject=undefined`, the string two passes attributed to a
					// malformed fixture row. THE FIXTURE WAS FINE; THE FIX WAS DEAD CODE.
					// #4713: A REFUSAL THAT NAMES NOTHING IS INDISTINGUISHABLE FROM AN EMPTY QUEUE. The 19-turn shape is a
					// row `queued` at WAKE time and held / deferred / claimed-elsewhere by the time this runs — the stalled
					// branch cannot reach it, because it needs a row STILL CLAIMED by this seat.
					if (found?.kind === "none") {
						const oldest = found.mine[0];
						const others = found.mine.length > 1 ? ` (and ${found.mine.length - 1} more row(s) addressed to you)` : "";
						return toolText(
							`NO_QUEUED_WORK — but NOT an empty queue: #${oldest.id} is addressed to you and is now \`${oldest.status}\`${others}. ` +
								(oldest.status === "held"
									? `It is parked awaiting release; a row you hold is not a claim offer.`
									: oldest.status === "claimed"
										? `It is claimed by you — use complete_work or defer_work to advance it.`
										: `It is not claimable in its current state; check \`status\` for who holds it.`)
						);
					}
				if (!found) {
					return toolText("NO_QUEUED_WORK");
				}
				// Build the INLINE STRUCTURED HEADER: item id + the decision-relevant
				// fields (from / subject / status) that a no-read-tool coordinator seat
				// can act on (#118 half 2, lead #125). The full body still travels inline
				// for small claims; over the threshold it goes to disk and the RETURN is
				// this head + the path (see thinResultText).
				const head =
					found.kind === "stalled"
						? `STALLED_CLAIM #${found.id} | from=${found.from} | subject=${found.subject} | status=claimed`
						: `ITEM #${found.id} | from=${found.from} | subject=${found.subject} | status=claimed`;
				// LEGIBILITY (#2673 refinement 4): a skipped item must be SURFACED, not merely
				// logged — an item starved behind an unclosed gate is otherwise indistinguishable
				// from an empty queue, which is how these rows escalated to the operator.
				const skipped = found.skipped ?? [];
				const skippedLine = skipped.length
					? `\n\nSKIPPED (addressed to you, not workable yet): ${skipped.map((s) => `#${s.id} (${s.reason})`).join(", ")}`
					: "";
				// A NON-DEFAULT order is announced, and only then: `WAKE_CONTENT` tells the seat to take "the oldest
				// item addressed to you" (fixed string, ROADMAP 33 / #4557), so a seat handed a LATER row must be
				// told why or it will read the claim as the harness ignoring its instructions. The default path
				// stays byte-identical, which is the same no-op proof the alias provides.
				const orderLine =
					found.kind === "claimed" && found.order && found.order.strategy !== DEFAULT_STRATEGY
						? `\n\nORDER: ${found.order.strategy} (from ${found.order.source}) — this is NOT the oldest workable row; the queue is ordered by priority lease, and this row is the first workable one in that order.`
						: "";
				const claimText = `${head}\n${found.body}${skippedLine}${orderLine}`;
				// Thin-context return contract: an over-threshold body goes to disk and
				// the tool returns the structured head + a path, not the dump (see
				// thinResultText / RANK-1 / #118 half 2).
				return toolText(await thinResultText(api.env, claimText, found.id, head, { inlineBody: !hasReadTool }));
			},
		}),
		defineTool({
			name: "complete_work",
			description:
				"Mark one of your claimed items done with a result. Sends a DONE notice back to the sender. " +
				"Pass `evidence` ({command, exitCode, artifact?}) when you VERIFIED someone's work: it is what " +
				"makes the completion re-checkable, and `check` reports a verifier item completed without it " +
				"(ROADMAP 48 / W2). `resultSummary` stays the narrative; evidence is additive. An `artifact` " +
				"names THE TREE THE CHECK RAN AGAINST - a sha, a branch, or `main` - because a green depends " +
				"on the tree it ran in, and a DERIVED artifact (a generated file, a manifest) must be named " +
				"as MERGED: verifying it on its own branch tip only tests the branch against itself. When the " +
				"item is a LANDING ENTRY, say WHICH of two things happened - `done` means \"this entry was " +
				"PROCESSED\", not \"this artifact arrived\", and a reader holding a gate on it reads plain " +
				"`done` as landed: write `LANDED at <sha>` or `ROUTED to <seat> as <id>, NOT YET LANDED` " +
				"(#4073).",
			parameters: obj({
				itemId: num(),
				resultSummary: str(),
				evidence: opt(
					obj({
						command: str({
							description: "the exact command you ran to re-check the artifact",
						}),
						exitCode: num({ description: "its exit code (0 = pass)" }),
						artifact: opt(
							str({
								description: "THE TREE the command ran against: a sha, a branch, or `main` (a DERIVED artifact as MERGED)",
							}),
						),
					}),
				),
			}),
			replay: "safe",
			execute: async (args, api, context) => {
				const me = await mySeatName(api, context);
				const out = await api.commit(async (tx) => {
					const queue = await tx.doc(RigQueue);
					const item = queue.items.find((it) => it.id === args.itemId);
					if (!item) return `unknown item #${args.itemId}`;
					if (item.to !== me || item.status !== "claimed") {
						return `item #${args.itemId} is not claimed by you (status=${item.status})`;
					}
					// Evidence is OPTIONAL (a free-text completion stays legal), but when it IS
					// given it must be checkable: a blank command is a claim, not evidence, and
					// recording it would let `check`'s verifier rule pass on nothing.
					if (args.evidence !== undefined && String(args.evidence.command ?? "").trim() === "") {
						return "complete_work: `evidence.command` must name the command you ran (evidence is what a verifier re-runs)";
					}
					item.status = "done";
					item.resultSummary = args.resultSummary;
					// Record the re-runnable evidence beside the narrative summary (additive, like
					// `optimizedVia`): `check`'s verification-without-evidence rule reads it.
					if (args.evidence !== undefined) {
						item.evidence = {
							command: args.evidence.command,
							exitCode: args.evidence.exitCode,
							...(args.evidence.artifact === undefined ? {} : { artifact: args.evidence.artifact }),
						};
					}
					item.transitions.push({
						at: new Date().toISOString(),
						event: "done",
						by: me,
					});
					// A DONE notice is an acknowledgement, not work: only real work gets
					// a DONE notice back, or the chain never ends (ROADMAP 39).
					// `isDoneNotice` also covers flag-less DONE items already in the
					// store that predate the structural flag.
					if (!isNoticeItem(item)) {
						// The handoff must be RE-RUNNABLE (ROADMAP 48 / W2; lead #1553: verification
						// MUST re-execute the evidence, accepting a claim is not verification). A
						// completion's evidence is therefore carried ON THE DONE NOTICE - verbatim,
						// as a structured field AND a readable line - so whoever routes or performs
						// the verification receives the exact command + exit code + artifact instead
						// of a summary they would have to trust.
						const ev = item.evidence;
						const evidenceLine = ev
							? `\n\nevidence: \`${ev.command}\` -> exit ${ev.exitCode}${ev.artifact ? ` (artifact ${ev.artifact})` : ""}`
							: "";
						const noticeId = await enqueueItem(
							tx,
							me,
							item.from,
							`DONE #${item.id}: ${item.subject}`,
							`${args.resultSummary}${evidenceLine}`,
							null,
							true,
							// Ratcheting tier LATCH: the DONE notice inherits the completed
							// item's tier, so the chain (DONE -> verification -> follow-up)
							// keeps the same ratio tier across the task's life (RANK 2).
							item.tier ?? null,
						);
						if (ev) {
							const queue = await tx.doc(RigQueue);
							const notice = queue.items.find((it) => it.id === noticeId);
							if (notice) {
								notice.evidence = {
									command: ev.command,
									exitCode: ev.exitCode,
									...(ev.artifact === undefined ? {} : { artifact: ev.artifact }),
								};
							}
						}
					}
					return `ok`;
				}, context);
				let cwdResetNote = "";
				if (out === "ok") {
					// The item is complete, so retire the workspace `prepare_workspace`
					// created. `force: false` never discards uncommitted work: a dirty
					// worktree is refused and left for the operator (D60). Resetting the
					// seat's cwd to the shared tree keeps the next item from inheriting a
					// removed directory.
					try {
						await removeSeatWorkspace({ worktreeRoot: process.cwd(), itemId: args.itemId, releaseIfRefused: true });
						await api.commit(async (tx) => {
							await configure(tx, api.conversationId, { cwd: process.cwd() });
						}, context);
						// #3961: the reset is NOT silent - tell the seat its cwd is now the shared checkout,
						// so the next item's relative write would land there. (The guard also REFUSES such a
						// write; this is the SIGNAL, not the enforcement.)
						cwdResetNote =
							`\nnote: your seat cwd was reset to the shared checkout (${process.cwd()}) after this ` +
							`item - call prepare_workspace before writing for the next one.`;
					} catch (err) {
						console.error(
							`complete_work: workspace cleanup for #${args.itemId} failed: ${err?.message ?? err}`,
						);
					}
				}
				return toolText(out + cwdResetNote);
			},
		}),
		defineTool({
			name: "defer_work",
			description:
				"Stop and ask instead of guessing, or instead of silently stopping. Parks one of your claimed items on a question. Omit `to` to defer to the human operator, who sees it in `status`; pass `to` to also ask another seat. The item stays yours - call resume_work once you have the answer.",
			parameters: obj({
				itemId: num(),
				question: str({
					description: "the specific question that blocks the item",
				}),
				to: opt(str({
					description:
						"seat to ask as well as deferring; omit to defer to the human operator",
				})),
				// OPERATOR RULING 2026-11-12T20:2xZ: parking on the operator is a LEASE. Without a deadline the
				// park is a place for work to disappear — 493 rows were sitting there with a median age of 5 days.
				resumeBy: opt(str({
					description:
						"REQUIRED when deferring to the human operator: an ISO-8601 instant at most 5 days out. At that instant the row escalates to `lead`, who decides rather than leaving it parked.",
				})),
			}),
			replay: "safe",
			execute: async (args, api, context) => {
				try {
					const me = await mySeatName(api, context);
					const out = await api.commit(async (tx) => {
						const queue = await tx.doc(RigQueue);
						const item = queue.items.find((it) => it.id === args.itemId);
						if (!item) return `unknown item #${args.itemId}`;
						if (item.to !== me)
							return `item #${args.itemId} is addressed to ${item.to}, not you`;
						if (item.status !== "claimed")
							return `item #${args.itemId} is not claimed by you (status=${item.status})`;
						// #4574: A DEFERRAL IS NOT A SEND. The comment here used to read "Asking a seat IS a send, so the
						// org-edge and capability gates apply to it exactly as they do to send_work" — AND THAT PREMISE WAS
						// WRONG AND LOAD-BEARING. It read as documentation, so nobody tested it.
						// THE CONSEQUENCE: the gate fired BEFORE anything was recorded, so an off-edge `to:` could only reach
						// the default below — a FORCED ESCALATION to the operator whether or not the operator was the right
						// decider, and #4124 read as an open question for hours while the seat it named had never been asked.
						// SO THE TWO ACTS ARE SPLIT: `assertSendAllowed` governs the `enqueueItem` below — that IS a send and
						// must keep refusing loudly — and it does NOT govern RECORDING a target. Parked is not sent.
						// #4655: TWO FACTS, ONE CATCH — THAT WAS THE DEFECT. `assertSendAllowed` calls `seatId(tx, to)` FIRST,
						// and `seatId` throws `unknown seat: <name>`. So an UNKNOWN NAME and an ORG-EDGE REFUSAL both landed in
						// the single try/catch below, and an unknown target was recorded and rendered as a seat — the original
						// defect in a new spelling. The resolver already exists; nothing new is needed, only SEPARATION.
						// THE RULING: record the name (so the operator sees what was typed), mark it UNASKABLE rather than
						// falling back to nobody, and NAME THE NAME in the sentence.
						let knownSeat = true;
						if (args.to) {
							try {
								await seatId(tx, args.to);
							} catch {
								knownSeat = false;
							}
						}
						let deliverable = false;
						if (args.to) {
							try {
								await assertSendAllowed(tx, me, args.to);
								deliverable = true;
							} catch {
								// The edge forbids SENDING to that seat. Record the target, deliver nothing: it can still ANSWER.
								deliverable = false;
							}
						}
						// THE LEASE (operator ruling 2026-11-12T20:2xZ): a park on the human needs a clock, and the
						// refusal names the legal alternative in the same breath (ask `lead`/`pm`, or hold with a lease).
						const lease = validateHumanDefer({ to: args.to === undefined ? DEFERRED_TO_HUMAN : args.to, resumeBy: args.resumeBy });
						if (!lease.ok) return lease.refusal;
						item.status = "deferred";
						item.question = args.question;
						if (lease.resumeBy) item.deferLease = { resumeBy: lease.resumeBy, by: me, at: new Date().toISOString() };
						else delete item.deferLease;
						// #4574: and the default is HONEST. "nobody was asked" and "the operator was asked" are DIFFERENT
						// FACTS; `args.to ?? DEFERRED_TO_HUMAN` made them indistinguishable and manufactured "human".
						item.deferredTo = args.to ?? DEFERRED_TO_NOBODY;
						item.transitions.push({
							at: new Date().toISOString(),
							event: "deferred",
							by: me,
							to: item.deferredTo,
							...(lease.resumeBy ? { resumeBy: lease.resumeBy } : {}),
						});
						if (args.to && deliverable) {
							await enqueueItem(
								tx,
								me,
								args.to,
								`QUESTION #${item.id}: ${item.subject}`,
								args.question,
							);
						}
							// #4574: the message reports what ACTUALLY happened, which is THREE cases, not two. A no-target
							// deferral says NOBODY was asked — not that the operator was, which is the fact the old default invented.
							if (!args.to) {
								return `item #${item.id} deferred with NO target — nobody was asked, and deferredTo records that rather than naming the operator. The operator sees it on the status line; resume it with resume_work(${item.id}) once you have an answer.`;
							}
							// #4655: AN UNKNOWN NAME IS ITS OWN CASE. Recording it and rendering it as a seat is the original defect;
							// falling back to "nobody" would hide the typo. So it is recorded, marked unaskable, and NAMED.
							if (!knownSeat) {
								return `item #${item.id} parked on '${args.to}' — that target is NOT A KNOWN SEAT, so nobody has been asked. The name is recorded so you can see what was typed; correct it and defer again.`;
							}
							if (!deliverable) {
								return `item #${item.id} parked on ${args.to} — NOT delivered, because the org edge forbids sending to that seat, but the seat is recorded as the one that should ANSWER and it is visible through attention/status. Resume your own item with resume_work(${item.id}) once it answers.`;
							}
							if (args.to === DEFERRED_TO_HUMAN) {
								return `item #${item.id} deferred to the human operator until ${lease.resumeBy}; if nobody answers by then it ESCALATES to lead, who decides. Resume it with resume_work(${item.id}) once you have the answer.`;
							}
							return `item #${item.id} deferred to ${args.to}; that seat has the question. Resume your own item with resume_work(${item.id}) once it answers.`;
					}, context);
					return toolText(out);
				} catch (err) {
					return toolText(`DEFER_WORK_ERROR: ${err && err.stack ? err.stack : String(err)}`);
				}
			},
		}),
		defineTool({
			name: "resume_work",
			description:
				"Take back one of your deferred items once the answer has arrived, so complete_work can finish it.",
			parameters: obj({ itemId: num() }),
			replay: "safe",
			execute: async (args, api, context) => {
				const me = await mySeatName(api, context);
				const out = await api.commit(async (tx) => {
					const queue = await tx.doc(RigQueue);
					const item = queue.items.find((it) => it.id === args.itemId);
					if (!item) return `unknown item #${args.itemId}`;
					if (item.to !== me)
						return `item #${args.itemId} is addressed to ${item.to}, not you`;
					if (item.status !== "deferred")
						return `item #${args.itemId} is not deferred (status=${item.status})`;
					item.status = "claimed";
					item.transitions.push({
						at: new Date().toISOString(),
						event: "resumed",
						by: me,
					});
					return `item #${item.id} resumed; finish it with complete_work or revise it and defer again.`;
				}, context);
				return toolText(out);
			},
		}),
		defineTool({
			name: "hold_work",
			description:
				"Park a row without deferring: one you have claimed, or a QUEUED row addressed to you " +
				"(no claim needed, #5724). The item becomes unclaimable and stops waking the seat until released.",
			parameters: obj({
				itemId: num(),
				reason: opt(str({
					description: "brief explanation for why the item is being held",
				})),
			}),
			replay: "safe",
			execute: async (args, api, context) => {
				const me = await mySeatName(api, context);
				const out = await api.commit(async (tx) => {
					const queue = await tx.doc(RigQueue);
					const item = queue.items.find((it) => it.id === args.itemId);
					if (!item) return `unknown item #${args.itemId}`;
					if (item.to !== me)
						return `item #${args.itemId} is addressed to ${item.to}, not you`;
					// #5724: parking does not require a claim. Before this, re-parking a live row meant
					// claim_work then hold_work — two calls, one wasted claim, and a window in which the row
					// sits as `claimed`. The invariant this protects is that a PARKED row is never wake-able:
					// the driver's selector is `status === "queued"` (src/broker.mjs:127), so going straight
					// from queued to held removes it from wake selection in one step. Deferred and terminal
					// rows still refuse — the seam is widened only for the recipient's own queued row.
					if (item.status !== "claimed" && item.status !== "queued")
						return `item #${item.id} is ${item.status}; hold_work parks a row you hold (claimed) or a queued row addressed to you`;
					item.status = "held";
					if (args.reason) item.heldReason = args.reason;
					// #6150: the park is recorded as structure, not as prose, at the moment it happens.
					item.park = parkRecord(queue, item);
					item.transitions.push({
						at: new Date().toISOString(),
						event: "held",
						by: me,
					});
					return `item #${item.id} held${args.reason ? ` (${args.reason})` : ""}; release with release_work(${item.id}) to restore it to queued.`;
				}, context);
				return toolText(out);
			},
		}),
		defineTool({
			name: "release_work",
			description:
				"Restore a held item to queued, so the driver can re-wake the seat. The recipient may release an item addressed to it; the SENDER may release a held item it created (e.g. a parked backlog registration). " +
				"A COORDINATING seat (one that declares no working capability, e.g. pm) may also release a parked row it did not mint - release is reversible, so it is delegable; cancel, revise and tier are not, and stay with the row's parties. A release by such a seat MUST carry a `reason`, and it is REFUSED when the row's gate names a cancelled item.",
			parameters: obj({
				itemId: num(),
				reason: opt(str({
					description:
						"why the row is being un-parked. Required when the releasing seat is neither the sender nor the recipient; recorded on the row and shown in the queue view.",
				})),
			}),
			replay: "safe",
			execute: async (args, api, context) => {
				const me = await mySeatName(api, context);
				const out = await api.commit(async (tx) => {
					const queue = await tx.doc(RigQueue);
					const seats = await tx.doc(Seats);
					const item = queue.items.find((it) => it.id === args.itemId);
					if (!item) return `unknown item #${args.itemId}`;
					// #5778 — TERMINAL BEFORE AUTHORITY. A closed row is not parked, and the authority refusal
					// speaks about who may act on a LIVE row. Measured on the live store: `release_work` on #5488
					// and #5398 — both already `done` — answered "item #5488 is addressed to impl (from lead); only
					// the sender or recipient may release it". A coordinator reading that reports the row as parked
					// and escalates work that is finished; that is how a milestone chain read as "96% parked".
					// The refusal stays for genuinely non-terminal rows (checked next).
					if (isTerminalItem(item))
						return `item #${args.itemId} is already ${item.status} (terminal); there is nothing to release`;
					// #6112 (ruling #6097) — SCOPED RELEASE AUTHORITY. The party check is kept for everyone, and
					// the coordinator is added to it, not allowed to act on rows it has no relation to.
					// WHY ONLY RELEASE: a released row returns to queued and its sender can hold it again, so a
					// wrong release is one more call to undo; cancel is terminal and revise rewrites the request
					// under someone's feet. Delegable power is power that can be taken back, so the grant stops
					// at release and the refusal NAMES the boundary.
					const isParty = item.to === me || item.from === me;
					const coordinating = seatIsCoordinator({
						name: me,
						role: seats.seats[me]?.role,
						capabilities: seats.seats[me]?.capabilities ? [...seats.seats[me].capabilities] : [],
					});
					if (!isParty && !coordinating)
						return `item #${args.itemId} is addressed to ${item.to} (from ${item.from}); only the sender, the recipient, or a coordinating seat may release it`;
					if (item.status !== "held")
						return `item #${args.itemId} is not held (status=${item.status})`;
					// A release by a seat with no stake in the row is only legible if it says why. Without the
					// reason the sender cannot tell an un-park from a re-park cycle and the queue view records
					// that a row changed state for no stated cause (#6112).
					const reason = typeof args.reason === "string" ? args.reason.trim() : "";
					if (!isParty && !reason)
						return `item #${args.itemId}: a release by a seat that neither sent nor receives the row must carry a reason (release_work(${args.itemId}, reason: "..."))`;
					// A parked row whose gate is a CANCELLED row is not workable, so un-parking it makes it
					// claimable-but-broken: the seat claims it, the gate refuses it, and the row burns a turn
					// for nothing. Refusing the release is the cheap, honest answer, and it is the same
					// `gate-cancelled` semantics the claim predicate already uses (#3747/#3863 class, #6112).
					const dead = deadGateId(item, queue.items);
					if (dead)
						return `item #${args.itemId} not released: its gate names #${dead}, which is cancelled - releasing it would make a row claimable whose prerequisite was dropped`;
					item.status = "queued";
					// #6150: a released row is no longer parked, so its park record goes — leaving a stale
					// `park` behind would make a metric count a running row as parked.
					item.park = null;
					// #6112: the release is STRUCTURE, not only a transition, so the queue line and any metric
					// can read who un-parked the row and why without parsing prose.
					item.release = {
						at: new Date().toISOString(),
						by: me,
						reason: reason || null,
						authority: isParty ? (item.from === me ? "sender" : "recipient") : "coordinator",
					};
					item.transitions.push({
						at: item.release.at,
						event: "released",
						by: me,
						reason: item.release.reason,
					});
					return `item #${item.id} released back to queued${item.release.authority === "coordinator" ? ` by ${me} (coordinator release: ${item.release.reason})` : ""}.`;
				}, context);
				return toolText(out);
			},
		}),
		defineTool({
			name: "set_priority",
			description:
				"Move a row up or down the RECIPIENT's queue by setting its PRIORITY LEASE (now / next / later). " +
				"A priority is a LEASE, not a flag: it needs a `reason` and an `expiresAt` (ISO-8601, in the future, " +
				"at most 30 days out) and it LAPSES back to neutral at that instant. It only changes claim order when " +
				"the recipient's resolved work strategy is `priority_first`; the reply says which strategy is in force, " +
				"because recording a priority under `oldest_first` changes nothing and must not read as success. " +
				"The row's parties (sender/recipient) or a COORDINATING seat may set it.",
			parameters: obj({
				itemId: num(),
				priority: union([lit("now"), lit("next"), lit("later")], {
					description:
						"now = ahead of the backlog, next = the neutral value (what an unprioritised row already ranks as), later = behind it",
				}),
				reason: str({
					description:
						"REQUIRED: why the order changes. Written on the row and shown in every queue view — a reordering the recipient cannot explain is how 'why is my queue in this order' becomes an escalation.",
				}),
				expiresAt: str({
					description:
						"REQUIRED: ISO-8601 instant when the lease lapses, e.g. 2026-11-19T00:00:00Z. In the future, at most 30 days out.",
				}),
			}),
			replay: "safe",
			execute: async (args, api, context) => {
				const me = await mySeatName(api, context);
				const out = await api.commit(async (tx) => {
					const queue = await tx.doc(RigQueue);
					const seats = await tx.doc(Seats);
					const item = queue.items.find((it) => it.id === args.itemId);
					if (!item) return `unknown item #${args.itemId}`;
					// TERMINAL BEFORE AUTHORITY, the #5778 ordering rule: a finished row is not orderable, and telling a
					// coordinator it lacks authority over a row that is already `done` sends it chasing a closed item.
					if (isTerminalItem(item))
						return `item #${args.itemId} is already ${item.status} (terminal); there is nothing to order`;
					// SAME SCOPED AUTHORITY AS `release_work` (#6112, ruling #6097), and for the same reason: moving a
					// third party's row is exactly what a coordinator is FOR (it is the operator's lever into a seat's
					// queue), while a seat with no relation to the row must not silently reprioritise someone else's work.
					// Unlike release, this does NOT go back on its own — but it LAPSES, which is the bounded form of
					// reversibility that makes the delegated power safe to grant.
					const isParty = item.to === me || item.from === me;
					const coordinating = seatIsCoordinator({
						name: me,
						role: seats.seats[me]?.role,
						capabilities: seats.seats[me]?.capabilities ? [...seats.seats[me].capabilities] : [],
					});
					if (!isParty && !coordinating)
						return `item #${args.itemId} is addressed to ${item.to} (from ${item.from}); only the sender, the recipient, or a coordinating seat may set its priority`;
					// A CLAIMED row is being acted on right now: ordering it changes no selection (the selector only picks
					// `queued` rows), so accepting it would record a lever that cannot move. `held` IS accepted: the lease
					// is set while parked and applies the moment release_work makes the row claimable.
					if (item.status !== "queued" && item.status !== "held")
						return `item #${item.id} is ${item.status}; set_priority orders rows still waiting for a seat (queued or held), not one already in flight`;
					const valid = validatePriorityRequest(args);
					if (!valid.ok) return `item #${args.itemId}: ${valid.error}`;
					const at = new Date().toISOString();
					item.priority = valid.value.priority;
					// STRUCTURE, not prose (the same rule as `release` and `park`): who leased it, why, until when, and
					// on what authority, so a reader and a metric both read the row instead of its history.
					item.prioritySet = {
						at,
						by: me,
						reason: valid.value.reason,
						expiresAt: valid.value.expiresAt,
						authority: isParty ? (item.from === me ? "sender" : "recipient") : "coordinator",
					};
					item.transitions.push({ at, event: "priority", by: me, priority: valid.value.priority });
					// THE HONESTY CHECK for this whole feature: a priority is INERT unless the RECIPIENT's resolved
					// strategy is `priority_first`. Resolving it here (the recipient's seat first, then the team) and
					// saying so is what stops "I set a priority and nothing happened" from becoming a mystery, which
					// would be this repo's accepted-and-ignored class (#5071) reintroduced by a new mechanism.
					const recipient = seats.seats[item.to] ?? {};
					const order = resolveStrategy({
						seatStrategy: recipient.workStrategy,
						teamStrategy: seats.workStrategy,
						defaultStrategy: DEFAULT_STRATEGY,
					});
					const where = item.status === "held" ? " (the row is held; the lease applies when it is released)" : "";
					const effect =
						order.strategy === "priority_first"
							? `#${item.to} claims by ${order.strategy} (from ${order.source}), so this DOES change the order it looks in.`
							: `#${item.to} claims by ${order.strategy} (from ${order.source}), which IGNORES priority: the lease is recorded but does NOT change claim order until that seat (or the team) is set to \`priority_first\`.`;
					return `item #${item.id} priority=${valid.value.priority} until ${valid.value.expiresAt}${where} — ${effect}`;
				}, context);
				return toolText(out);
			},
		}),
		defineTool({
			name: "revise_work",
			description:
				"Update the subject and/or body of a QUEUED item you sent or were sent, before it is claimed. A claimed item is being acted on and is not revised.",
			parameters: obj({
				itemId: num(),
				subject: opt(str()),
				body: opt(str()),
			}),
			replay: "safe",
			execute: async (args, api, context) => {
				const me = await mySeatName(api, context);
				const out = await api.commit(async (tx) => {
					const queue = await tx.doc(RigQueue);
					const item = queue.items.find((it) => it.id === args.itemId);
					if (!item) return `unknown item #${args.itemId}`;
					// Either party may revise: the sender corrects a request before it is
					// picked up, or the holder tidies an item it has not started. Anyone
					// else editing a routed item would be a silent spoof.
					if (item.to !== me && item.from !== me)
						return `item #${args.itemId} is not yours to revise (from=${item.from} to=${item.to})`;
					// Only UNCLAIMED work: once claimed the recipient is acting on the
					// item, so changing its body under them would diverge from the run.
					if (item.status !== "queued")
						return `item #${args.itemId} is not queued (status=${item.status}); only unclaimed work can be revised`;
					if (args.subject === undefined && args.body === undefined)
						return "revise_work needs a subject and/or a body";
					// #3435: the OUTCOME must be legible and checkable. A revise that produces no
					// change used to be indistinguishable from a revise that was DROPPED — both
					// came back as a success-shaped sentence — so the only way to notice a lost
					// amendment was to re-read the item, which nobody does on a success path.
					// `applyRevise` returns a status, the fields it actually wrote, and a digest of
					// the STORED body so the caller can verify the write without re-reading.
					const outcome = applyRevise(item, { subject: args.subject, body: args.body });
					if (outcome.status === "mismatch") {
						// A change was submitted and did NOT land. Never report that as success.
						return reviseMessage(item, outcome);
					}
					if (outcome.status === "no-change") return reviseMessage(item, outcome);
					item.transitions.push({
						at: new Date().toISOString(),
						event: "revised",
						by: me,
						fields: outcome.fields,
					});
					return reviseMessage(item, outcome);
				}, context);
				return toolText(out);
			},
		}),
		defineTool({
			name: "cancel_work",
			description:
				"Cancel one of your items (sent by you or addressed to you) that is no longer worth doing. Terminal: it can never be claimed and the broker will never wake anyone for it. The reason is NOTIFIED to the other party as a CANCELLED notice, the same way a completion notifies them with a DONE notice.",
			parameters: obj({
				itemId: num(),
				reason: str({
					description: "why it is cancelled; recorded on the item for the other party and the queue view",
				}),
			}),
			replay: "safe",
			execute: async (args, api, context) => {
				const me = await mySeatName(api, context);
				const out = await api.commit(async (tx) => {
					const queue = await tx.doc(RigQueue);
					const item = queue.items.find((it) => it.id === args.itemId);
					if (!item) return `unknown item #${args.itemId}`;
					if (item.to !== me && item.from !== me)
						return `item #${args.itemId} is not yours to cancel (from=${item.from} to=${item.to})`;
					if (isTerminalItem(item))
						return `item #${args.itemId} is already ${item.status}`;
					const outcome = await cancelItem(tx, { item, me, reason: args.reason });
					return outcome.message;
				}, context);
				return toolText(out);
			},
		}),
		defineTool({
			name: "peek_queue",
			description:
				"List your queue work: non-terminal items addressed to or sent by you. Pass all=true for every item (any status, any seat) — oversight and debugging.",
			parameters: obj({ all: opt(bool()) }),
			replay: "safe",
			execute: async (args, api, context) => {
				const { name: me } = await mySeatReadability(api, context);
				// Default to the seat's own non-terminal work: the whole queue is a ~20 KB
				// context write on a live rig, and it makes "what is mine?" an inference
				// over other seats' history. all=true is the opt-in team-wide view.
				const scope = args.all ? "all" : me;
				const [lines, header] = await api.commit(async (tx) => {
					const queue = await tx.doc(RigQueue);
					const filtered = queue.items.filter((it) =>
						!isTerminalItem(it) && (args.all || it.to === me || it.from === me),
					);
					const counts = {};
					for (const it of filtered) counts[it.status] = (counts[it.status] || 0) + 1;
					const countParts = Object.entries(counts).map(
						([s, c]) => `${c} ${s}`,
					);
					const countSuffix = countParts.length
						? ` — ${countParts.join(", ")}`
						: "";
					const head = `QUEUE (${scope}): ${filtered.length} non-terminal${countSuffix}`;
					// Render to plain strings INSIDE the commit: the commit releases its overlay, and a
					// proxy read (including an array field like `blockedBy`) after settlement throws
					// "Cannot use a settled overlay".
					return [filtered.map(queueItemLine), head];
				}, context);
				// Bounded inline view for per-seat queries to avoid context bloat.
				// Team-wide (all=true) view is uncapped so coordinators can enumerate.
				const N = args.all ? lines.length : 20;
				const cwd = api.env?.cwd;
				let footer = "";
				if (cwd) {
					const file = join(cwd, ".durig", `queue-${scope}.md`);
					mkdirSync(join(cwd, ".durig"), { recursive: true });
					writeFileSync(file, [header, ...lines].join("\n") + "\n", "utf8");
					if (lines.length > N) {
						footer = `\n… showing ${N} of ${lines.length} (full list: ${file})`;
					}
				} else {
					if (lines.length > N) {
						footer = `\n… showing ${N} of ${lines.length} (no workspace for full list)`;
					}
				}
				const body = (lines.length ? [header, ...lines.slice(0, N)].join("\n") : "(empty)") + footer;
				return toolText(body);
			},
}),
],
});

/** Resolve which seat THIS conversation is, from the registry doc. */
async function mySeatName(api, context) {
	return api.commit(async (tx) => {
		const seats = await tx.doc(Seats);
		for (const [name, seat] of Object.entries(seats.seats)) {
			if (seat.conversationId === api.conversationId) return name;
		}
		throw new Error("this conversation is not a registered seat");
	}, context);
}

/**
 * The calling seat's name, plus whether it keeps the read tool. A coordinator does not
 * (`COORDINATOR_REMOVALS`), so this is the predicate that decides whether an over-threshold tool
 * result arrives as the structured head + path (a seat that can read the file) or inline (a seat
 * that cannot) — lead #144 B. The record is snapshotted to plain fields because the commit
 * releases its overlay and a proxy read after settlement throws.
 */
async function mySeatReadability(api, context) {
	return api.commit(async (tx) => {
		const seats = await tx.doc(Seats);
		for (const [name, seat] of Object.entries(seats.seats)) {
			if (seat.conversationId !== api.conversationId) continue;
			return {
				name,
				hasReadTool: seatHasReadTool({
					name,
					role: seat.role,
					capabilities: seat.capabilities ? [...seat.capabilities] : [],
				}),
			};
		}
		throw new Error("this conversation is not a registered seat");
	}, context);
}

/** System-prompt section telling a seat about its role and its queue duties. */
export function seatSections(roleText) {
	return [
section("durig-role", () =>
`You are the "${roleText}" seat of a rig.\n` +
`Your duties arrive through claim_work; report results with complete_work.\n` +
`Delegate with send_work when a task belongs to another seat.`,
{ tag: false }),
];
}

/**
 * Compile structured persona fields into one instructions string.
 * Mirrors CrewAI's role/goal/backstory triad and MetaGPT's constraints;
 * an explicit `instructions` field is appended verbatim when present.
 */
export function compilePersona(seat) {
	const parts = [];
	if (seat.role) parts.push(`You are the ${seat.role}.`);
	if (seat.goal) parts.push(`Your goal: ${seat.goal}`);
	if (seat.backstory) parts.push(`Background: ${seat.backstory}`);
	for (const c of seat.constraints ?? []) parts.push(`Constraint: ${c}`);
	if (seat.capabilities?.length) {
		parts.push(`Advertised capabilities: ${seat.capabilities.join(", ")}`);
	}
	if (seat.instructions) parts.push(seat.instructions);
	return parts.join("\n");
}

/**
 * Resolve each seat's `instructionsFile` pointer into `instructions`, in place, so every
 * consumer of a rig spec (`compilePersona`, the optimizer seam, `previewUp`'s change detection,
 * `detectModelMismatch`, seat creation, and the guard tests that re-read a rig file) resolves a
 * seat persona the SAME way. One implementation, because two would drift.
 *
 * WHY: a seat's system prompt is prose — this rig's 12 seats carry 44,110 characters of it — and
 * it could only live inline in the rig JSON as one escaped string per seat. Editing seat guidance
 * meant editing escapes inside a ~380-line JSON file, which turns a wording change into a
 * corruption event. `instructionsFile: "prompts/<seat>.md"` makes a markdown file the surface.
 *
 * Three rules, each with an incident behind it:
 *  - the FILE WINS when both keys are set, because the file is the surface meant for editing
 *    (the inverse of the constitution's inline-wins rule, where inline is the generated mirror);
 *  - a missing or unreadable file is a HARD failure, never a silent drop — reading one form and
 *    dropping the text is the constitution bug demo/constitution.test.mjs pins: a 13-seat team ran
 *    with no grounding rule and nothing anywhere raised an error;
 *  - exactly ONE trailing newline is stripped, because a POSIX text file ends with one and the
 *    inline string does not. Stripping it keeps the resolved prompt byte-identical to what the
 *    inline spec produced, which is what made the migration provably safe.
 *
 * Paths resolve relative to the rig FILE (falling back to cwd) so a rig in a subdirectory still
 * finds its personas.
 *
 * @param {{seats?: Array<Record<string, unknown>>}} spec parsed rig file (mutated in place)
 * @param {string} rigFile path to the rig file, used for relative resolution
 * @returns {Promise<string[]>} names of seats that set both keys (caller reports the note)
 * @throws when a named persona file cannot be read — a seat must never run with no persona
 */
export async function applyInstructionFiles(spec, rigFile) {
	const dir = dirname(resolve(rigFile));
	const conflicts = [];
	for (const seat of spec.seats ?? []) {
		const ref = seat.instructionsFile;
		if (typeof ref !== "string" || ref === "") continue;
		const candidates = [resolve(dir, ref), resolve(ref)];
		let text;
		for (const p of candidates) {
			try {
				text = await readFile(p, "utf8");
				break;
			} catch {
				/* try the next candidate */
			}
		}
		if (text === undefined) {
			throw new Error(
				`seat ${seat.name ?? "(unnamed)"}: instructionsFile "${ref}" not found (tried: ${candidates.join(
					", ",
				)}) — refusing to configure a seat with no persona`,
			);
		}
		if (typeof seat.instructions === "string" && seat.instructions !== "") conflicts.push(String(seat.name));
		seat.instructions = text.endsWith("\n") ? text.slice(0, -1) : text;
	}
	return conflicts;
}

export { Router };
