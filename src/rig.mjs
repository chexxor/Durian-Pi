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
import { Type } from "@earendil-works/pi-ai";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { seatHasReadTool } from "./seattools.mjs";
import { normalizeBlock } from "./queue-lifecycle.mjs";
import { removeSeatWorkspace } from "./worktree.mjs";

/** Seat roster: name -> conversation id + role text. Session singleton. */
export const Seats = defineDoc({
	kind: "durig.seats",
	version: 1,
	scope: "session",
	initial: () => ({ seats: {} }), // name -> {conversationId, role, goal, capabilities}
});

/** Organizational links: from -> allowed recipients. Absent/empty = open. */
export const Edges = defineDoc({
	kind: "durig.edges",
	version: 1,
	scope: "session",
	initial: () => ({ edges: [] }), // [{from, maySendTo:[names]}]
});

/** Constitution file text, injected into every seat's system prompt. */
export const Constitution = defineDoc({
	kind: "durig.constitution",
	version: 1,
	scope: "session",
	initial: () => ({ text: "" }),
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
	initial: () => ({ paused: false, pausedAt: null, pausedBy: null, reason: null }),
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
export function isDoneNotice(item) {
	return item?.notice === true || /^DONE #\d+: /.test(String(item?.subject ?? ""));
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
 * The OLDEST-WORKABLE SELECTION (#2673), extracted so the choice is testable without a
 * harness: `claim_work` with no itemId must return the oldest item that is WORKABLE for this
 * seat, and must REPORT every item it passed over — a starved item is otherwise
 * indistinguishable from an empty queue.
 *
 * Only items addressed to `seat` and still `queued` are candidates; the scan stops at the
 * first workable one, so the order is oldest-first and a later workable item is never
 * preferred over an earlier one.
 */
export function selectOldestWorkable(items, seat, { capabilities = [] } = {}) {
	const skipped = [];
	for (const candidate of items ?? []) {
		if (candidate.to !== seat || candidate.status !== "queued") continue;
		const verdict = workable(candidate, seat, { items, capabilities });
		if (verdict.workable) return { item: candidate, skipped };
		skipped.push({ id: candidate.id, reason: verdict.reason });
	}
	return { item: null, skipped };
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
	return `#${it.id} ${it.status} from=${it.from} to=${it.to} ${it.subject}${gate}`;
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
	queue.items.push({
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
	});
	return id;
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
			parameters: Type.Object({
				to: Type.String({ description: "recipient seat name" }),
				subject: Type.String(),
				body: Type.String(),
				requires: Type.Optional(Type.String({
					description:
						"capability the recipient must advertise; it is checked now AND persisted on the item so claimability can read it",
				})),
				blockedBy: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }), {
					description:
						"structured gate: the queue-item ids this work is blocked on (must resolve to terminal `done` before the item is workable). Omit when ungated.",
				})),
				block: Type.Optional(
					Type.Object({
						source: Type.Optional(
							Type.Union([Type.Literal("declared"), Type.Literal("legacy")]),
						),
						reason: Type.String({
							description:
								"why the item is parked: dependency|question|operator|schedule|resource|manual|backlog|roadmap-gate",
						}),
						resolver: Type.String({
							description:
								"who or what clears the park (mandatory): a seat name, operator|human|automatic, #<id> or RM-<n>",
						}),
						constraints: Type.Optional(
							Type.Array(
								Type.Object({
									kind: Type.String({ description: "queue|roadmap|window" }),
									ref: Type.Optional(Type.Union([Type.String(), Type.Number()])),
									note: Type.Optional(Type.String()),
								}),
							),
						),
						payload: Type.Optional(Type.Object({}, { additionalProperties: true })),
						reviewBy: Type.Optional(
							Type.Union([Type.String(), Type.Null()], {
								description:
									"when to look again (ISO date); omit for the per-reason default, null only for backlog/question",
							}),
						),
					}),
				),
				held: Type.Optional(Type.Boolean({
					description:
						"Create the item PARKED (status held): unclaimable and no wake, so a 'registered, do not start' backlog row cannot starve a working seat. Release it later with release_work.",
				})),
				optimize: Type.Optional(Type.Boolean({
					description: "Rewrite body through the instruction optimizer before enqueueing (costs one model call).",
				})),
				tier: Type.Optional(Type.Union([
					Type.Literal("trivial"),
					Type.Literal("small"),
					Type.Literal("feature"),
					Type.Literal("project"),
				], {
					description: "Ratchet tier for this task (trivial/small/feature/project); assigned at intake and latched onto the chain. Raising above an existing tier needs a `reason`.",
				})),
				reason: Type.Optional(Type.String({
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
							if (oldIdx >= 0 && newIdx > oldIdx && !(args.reason && args.reason.trim())) {
								throw new Error(
									`raising tier ${existing.tier}->${tier} for this task needs a stated reason`,
								);
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
			parameters: Type.Object({ itemId: Type.Optional(Type.Number()) }),
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
					if (!paused) {
						const seatsDoc = await tx.doc(Seats);
						const capabilities = seatsDoc.seats[me]?.capabilities ?? [];
						const picked = selectOldestWorkable(queue.items, me, { capabilities });
						queued = picked.item ?? undefined;
						skipped.push(...picked.skipped);
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
					return null;
				}, context);
				if (found?.kind === "paused") {
					const why = found.reason ? ` (reason: ${found.reason})` : "";
					return toolText(
						`PAUSED: the rig is paused${found.by ? ` by ${found.by}` : ""}${why} — new work is not claimable until ` +
							"`unpause`. Work you ALREADY hold still completes: use complete_work / defer_work.",
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
				const claimText = `${head}\n${found.body}${skippedLine}`;
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
				"(ROADMAP 48 / W2). `resultSummary` stays the narrative; evidence is additive. " +
				"When the item is a LANDING ENTRY, say WHICH of two things happened - `done` means \"this " +
				"entry was PROCESSED\", not \"this artifact arrived\", and a reader holding a gate on it " +
				"reads plain `done` as landed: write `LANDED at <sha>` or `ROUTED to <seat> as <id>, NOT YET " +
				"LANDED` (#4073).",
			parameters: Type.Object({
				itemId: Type.Number(),
				resultSummary: Type.String(),
				evidence: Type.Optional(
					Type.Object({
						command: Type.String({
							description: "the exact command you ran to re-check the artifact",
						}),
						exitCode: Type.Number({ description: "its exit code (0 = pass)" }),
						artifact: Type.Optional(
							Type.String({
								description: "the commit/rev the command ran against, when it names one",
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
					if (!isDoneNotice(item)) {
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
					} catch (err) {
						console.error(
							`complete_work: workspace cleanup for #${args.itemId} failed: ${err?.message ?? err}`,
						);
					}
				}
				return toolText(out);
			},
		}),
		defineTool({
			name: "defer_work",
			description:
				"Stop and ask instead of guessing, or instead of silently stopping. Parks one of your claimed items on a question. Omit `to` to defer to the human operator, who sees it in `status`; pass `to` to also ask another seat. The item stays yours - call resume_work once you have the answer.",
			parameters: Type.Object({
				itemId: Type.Number(),
				question: Type.String({
					description: "the specific question that blocks the item",
				}),
				to: Type.Optional(Type.String({
					description:
						"seat to ask as well as deferring; omit to defer to the human operator",
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
						item.status = "deferred";
						item.question = args.question;
						// #4574: and the default is HONEST. "nobody was asked" and "the operator was asked" are DIFFERENT
						// FACTS; `args.to ?? DEFERRED_TO_HUMAN` made them indistinguishable and manufactured "human".
						item.deferredTo = args.to ?? DEFERRED_TO_NOBODY;
						item.transitions.push({
							at: new Date().toISOString(),
							event: "deferred",
							by: me,
							to: item.deferredTo,
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
							if (!deliverable) {
								return `item #${item.id} parked on ${args.to} — NOT delivered, because the org edge forbids sending to that seat, but the seat is recorded as the one that should ANSWER and it is visible through attention/status. Resume your own item with resume_work(${item.id}) once it answers.`;
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
			parameters: Type.Object({ itemId: Type.Number() }),
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
				"Park one of your claimed items without deferring. The item stays yours but becomes unclaimable until released. Useful when a seat cannot proceed but has no specific question for another party.",
			parameters: Type.Object({
				itemId: Type.Number(),
				reason: Type.Optional(Type.String({
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
					if (item.status !== "claimed")
						return `item #${args.itemId} is not claimed by you (status=${item.status})`;
					item.status = "held";
					if (args.reason) item.heldReason = args.reason;
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
				"Restore a held item to queued, so the driver can re-wake the seat. The recipient may release an item addressed to it; the SENDER may release a held item it created (e.g. a parked backlog registration).",
			parameters: Type.Object({ itemId: Type.Number() }),
			replay: "safe",
			execute: async (args, api, context) => {
				const me = await mySeatName(api, context);
				const out = await api.commit(async (tx) => {
					const queue = await tx.doc(RigQueue);
					const item = queue.items.find((it) => it.id === args.itemId);
					if (!item) return `unknown item #${args.itemId}`;
					if (item.to !== me && item.from !== me)
						return `item #${args.itemId} is addressed to ${item.to} (from ${item.from}); only the sender or recipient may release it`;
					if (item.status !== "held")
						return `item #${args.itemId} is not held (status=${item.status})`;
					item.status = "queued";
					item.transitions.push({
						at: new Date().toISOString(),
						event: "released",
						by: me,
					});
					return `item #${item.id} released back to queued.`;
				}, context);
				return toolText(out);
			},
		}),
		defineTool({
			name: "revise_work",
			description:
				"Update the subject and/or body of a QUEUED item you sent or were sent, before it is claimed. A claimed item is being acted on and is not revised.",
			parameters: Type.Object({
				itemId: Type.Number(),
				subject: Type.Optional(Type.String()),
				body: Type.Optional(Type.String()),
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
				"Cancel one of your items (sent by you or addressed to you) that is no longer worth doing. Terminal: it can never be claimed and the broker will never wake anyone for it. Use it for stale or superseded work instead of leaving it in the queue.",
			parameters: Type.Object({
				itemId: Type.Number(),
				reason: Type.String({
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
					item.status = "cancelled";
					item.cancelReason = args.reason;
					item.transitions.push({
						at: new Date().toISOString(),
						event: "cancelled",
						by: me,
						reason: args.reason,
					});
					return `item #${item.id} cancelled: ${args.reason}`;
				}, context);
				return toolText(out);
			},
		}),
		defineTool({
			name: "peek_queue",
			description:
				"List your queue work: non-terminal items addressed to or sent by you. Pass all=true for every item (any status, any seat) — oversight and debugging.",
			parameters: Type.Object({ all: Type.Optional(Type.Boolean()) }),
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

export { Router };
