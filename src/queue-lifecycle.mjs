// src/queue-lifecycle.mjs — the queue-lifecycle axes: the structured GATE field model (slice M1a) and
// the ONE stage/block MAPPING pair (slice M1b).
//
// WHY (docs/reviews/queue-lifecycle-redesign.md, ACCEPTED 2026-10-19; incident
// docs/incidents/2026-10-19-held-rows-orphaned-by-cleared-gates.md): a parked item was not required to
// name a machine-readable reason it is parked, who or what clears it, or a date to look again, so the
// queue could orphan work. M1a (lead #3048) is FIELD-EARLY: the `block` shape, the `reviewBy` defaults,
// and the existing enqueue path that persists them. M1b (this file's second half) adds the ONE mapping
// legacy status -> axes, and nothing else.
//
// SCOPE, deliberately narrow, and it is the point of the split: this module holds the field model and
// the MAPPING. It defines NO claimability predicate — `workable(item, seat)` is OWNED by #2673 (lead
// #3034: one predicate, one owner; the redesign consumes it and never restates its body) — and the
// mapping is the single source for stage/block so no other module re-derives it (architect F6).
//
// Read-only by construction: no store write, no new writer (D53: the enqueue path is the ONE write path).

/** The workflow axis vocabulary. The MAPPING onto it is a later slice; the vocabulary is fixed here so
 * the field model and every consumer agree on the names.
 *
 * `deferred` IS A STAGE, not a block bolted onto `active` (lead's ruling item 3; architect's measurement
 * at `src/queue-lifecycle.mjs:290`/`:311`). `active` means ONE thing: a live owner is working this item.
 * Representing "parked on an unanswered question" as `active` + `block` puts that row in the SAME stage
 * as a running one, and the stage is the axis the redesign derives `waiting`/`workable` from (#2951) —
 * so the axes would say "someone is on it" while the truth is "nobody may claim it, and the answer must
 * wake it". That is the correctness defect the ruling was written to prevent, not a taxonomy preference. */
export const STAGES = ["open", "active", "deferred", "closed"];

/** The closed reason vocabulary. `backlog` is the registration shape — no clock (F10). */
export const BLOCK_REASONS = [
	"dependency",
	"question",
	"operator",
	"schedule",
	"resource",
	"manual",
	"backlog",
	"roadmap-gate",
];

/** Constraint kinds. Only `queue` gates can ever clear automatically (§4.1) — that rule lives in the
 * later propagation slice; the vocabulary is here because it is part of the field's shape. */
export const CONSTRAINT_KINDS = ["queue", "roadmap", "window"];

/**
 * `reviewBy` defaults in DAYS, per reason (OQ2, adopted from the advocate's reviewed defaults).
 * `null` means "no clock" — `backlog` is the registration shape (no clock by design, F10) and a
 * `question` is cleared by an answer, not by a date. v1's `manual: 1 d` is withdrawn: it floors the
 * median-16 h population into an immediate nag.
 */
export const REVIEW_BY_DAYS = {
	dependency: 7,
	"roadmap-gate": 7,
	operator: 3,
	schedule: 14,
	resource: 3,
	manual: 7,
	backlog: null,
	question: null,
};

const ISO_DAY_MS = 24 * 60 * 60 * 1000;

/** The default `reviewBy` for a reason, as an ISO string, or `null` for a no-clock reason. */
export function reviewByDefault(reason, fromMs = Date.now()) {
	const days = REVIEW_BY_DAYS[reason];
	if (days === undefined) {
		throw new Error(`unknown block reason ${JSON.stringify(reason)}`);
	}
	if (days === null) return null;
	return new Date(fromMs + days * ISO_DAY_MS).toISOString();
}

/** A queue gate reference: `#1234` and `1234` are the same gate, normalized to `#1234`. */
function normalizeQueueRef(ref) {
	if (typeof ref === "number" && Number.isInteger(ref) && ref > 0) return `#${ref}`;
	if (typeof ref !== "string") {
		throw new Error(`queue constraint ref must be a queue-item id, got ${JSON.stringify(ref)}`);
	}
	const m = /^#?(\d+)$/.exec(ref.trim());
	if (!m)
		throw new Error(`queue constraint ref must be a queue-item id, got ${JSON.stringify(ref)}`);
	return `#${m[1]}`;
}

/** A roadmap gate reference: `RM-157` / `RM-28a` (WORK-ITEM-SCHEMA §11). */
function normalizeRoadmapRef(ref) {
	if (typeof ref !== "string") {
		throw new Error(`roadmap constraint ref must be an RM id, got ${JSON.stringify(ref)}`);
	}
	const m = /^RM-(\d+[a-z]?)$/i.exec(ref.trim());
	if (!m)
		throw new Error(`roadmap constraint ref must look like RM-<n>, got ${JSON.stringify(ref)}`);
	return `RM-${m[1]}`;
}

/** One constraint, normalized and validated. `window` carries a note instead of a ref. */
function normalizeConstraint(constraint) {
	if (!constraint || typeof constraint !== "object") {
		throw new Error(`constraint must be an object, got ${JSON.stringify(constraint)}`);
	}
	const kind = constraint.kind;
	if (!CONSTRAINT_KINDS.includes(kind)) {
		throw new Error(
			`constraint kind must be one of ${CONSTRAINT_KINDS.join("|")}, got ${JSON.stringify(kind)}`,
		);
	}
	if (kind === "queue") return { kind, ref: normalizeQueueRef(constraint.ref) };
	if (kind === "roadmap") return { kind, ref: normalizeRoadmapRef(constraint.ref) };
	const note = typeof constraint.note === "string" ? constraint.note.trim() : "";
	if (!note) throw new Error("a window constraint needs a non-empty `note`");
	return { kind, note };
}

/**
 * Normalize and validate an AUTHORED block (the `block` field a writer persists). Fails loudly: an
 * authored block that does not name who or what clears it is exactly the defect this redesign exists
 * to make unrepresentable, so there is no lenient path here.
 *
 * Rules enforced (design §1 (W), §3):
 * - `source` is `declared` | `legacy` and DEFAULTS to `declared`: an authored park IS a declaration (the
 *   `legacy` read-mapping is produced by the mapping slice, which may pass `legacy` explicitly so it can
 *   validate its own rows with this same code). Only `declared` may be a `dependency` (F2: a legacy row
 *   is never promoted to a self-clearing dependency by inference);
 * - `resolver` is mandatory;
 * - a `dependency` needs >= 1 constraint and ALL of them `kind: "queue"`; a `roadmap-gate` needs >= 1
 *   `kind: "roadmap"` constraint;
 * - `reviewBy` is filled from the reason default when absent, and may be an explicit `null` only for a
 *   reason whose default IS null (`backlog`, `question`).
 *
 * @param {object} block the authored block
 * @param {{at?: number|string}} [options] `at` fixes "now" (an ISO string or epoch ms) for `since`/`reviewBy`
 */
export function normalizeBlock(block, options = {}) {
	if (!block || typeof block !== "object") {
		throw new Error(`block must be an object, got ${JSON.stringify(block)}`);
	}
	const atMs = options.at === undefined ? Date.now() : new Date(options.at).getTime();
	if (!Number.isFinite(atMs)) throw new Error(`invalid \`at\`: ${JSON.stringify(options.at)}`);
	const source = block.source === undefined ? "declared" : block.source;
	if (source !== "declared" && source !== "legacy") {
		throw new Error(`block source must be "declared" or "legacy", got ${JSON.stringify(source)}`);
	}
	const reason = block.reason;
	if (!BLOCK_REASONS.includes(reason)) {
		throw new Error(
			`block reason must be one of ${BLOCK_REASONS.join("|")}, got ${JSON.stringify(reason)}`,
		);
	}
	if (reason === "dependency" && source !== "declared") {
		throw new Error(
			'a "dependency" block must have source "declared" (never inferred from a legacy row)',
		);
	}
	const resolver = typeof block.resolver === "string" ? block.resolver.trim() : "";
	if (!resolver) throw new Error("a block must name a non-empty `resolver`");

	const rawConstraints = block.constraints ?? [];
	if (!Array.isArray(rawConstraints)) {
		throw new Error(`block constraints must be an array, got ${JSON.stringify(block.constraints)}`);
	}
	const constraints = rawConstraints.map(normalizeConstraint);
	if (reason === "dependency" && constraints.length === 0) {
		throw new Error('a "dependency" block needs at least one queue constraint');
	}
	if (reason === "dependency" && constraints.some((c) => c.kind !== "queue")) {
		throw new Error(
			'a "dependency" block may only carry queue constraints; use "roadmap-gate" for a roadmap gate or a non-queue constraint',
		);
	}
	if (reason === "roadmap-gate" && !constraints.some((c) => c.kind === "roadmap")) {
		throw new Error('a "roadmap-gate" block needs at least one roadmap constraint');
	}

	const defaultReviewBy = reviewByDefault(reason, atMs);
	let reviewBy;
	if (block.reviewBy === undefined) {
		reviewBy = defaultReviewBy;
	} else if (block.reviewBy === null) {
		if (defaultReviewBy !== null) {
			throw new Error(
				`reviewBy is mandatory for reason ${JSON.stringify(reason)} (use a date, or omit it for the default)`,
			);
		}
		reviewBy = null;
	} else {
		const ms = new Date(block.reviewBy).getTime();
		if (!Number.isFinite(ms)) {
			throw new Error(`reviewBy must be an ISO date, got ${JSON.stringify(block.reviewBy)}`);
		}
		reviewBy = new Date(ms).toISOString();
	}

	const since =
		block.since === undefined ? new Date(atMs).toISOString() : new Date(block.since).toISOString();
	if (since === "Invalid Date") {
		throw new Error(`since must be an ISO date, got ${JSON.stringify(block.since)}`);
	}

	const payload =
		block.payload && typeof block.payload === "object"
			? Object.fromEntries(Object.entries(block.payload).filter(([, v]) => v !== undefined))
			: {};

	return { source, reason, resolver, constraints, payload, since, reviewBy };
}

/* ─── M1b: the ONE mapping, legacy stored status -> the axes ───────────────────────────────────── */

/** The legacy status of a stored row. Absent/unknown reads as `queued` — the shape every pre-redesign
 * item has, and the one the driver already treats as claimable. */
function legacyStatusOf(item) {
	const status = item?.status;
	return typeof status === "string" && status ? status : "queued";
}

/** Was this row ever claimed? The transition log is the honest evidence for "stage unchanged": a seat
 * can only defer or hold an item it CLAIMED, while the supervisor escalates a never-claimed row. */
function wasEverClaimed(item) {
	const transitions = Array.isArray(item?.transitions) ? item.transitions : [];
	return transitions.some((t) => t?.event === "claimed");
}

/** The `since` of a block: the newest park transition, or undefined (the caller then omits the date
 * rather than inventing one). */
function parkTransitionAt(item, events) {
	const transitions = Array.isArray(item?.transitions) ? item.transitions : [];
	for (let i = transitions.length - 1; i >= 0; i--) {
		if (events.includes(transitions[i]?.event)) return transitions[i]?.at;
	}
	return undefined;
}

/**
 * The ONE legacy read-mapping (§9.2). Returns `null` for a row that is not blocked.
 *
 * - `held` — a row whose park was never preceded by a claim is a REGISTRATION (`backlog`, resolver
 *   `pm`); a row a seat parked after claiming is a `manual` park owned by that seat. Both get
 *   `reviewBy: null`: the legacy population is ~160 rows and mapping it to a near-term clock is the
 *   alarm firehose F10/CR-2 name. A human promotes a real park by authoring a `block`.
 * - `deferred` — a `question` block. The stage is `deferred` (#4789): who parked it is carried by
 *   `resolver` (`deferredTo`), not by which stage the row was forced into.
 *
 * Legacy rows are NEVER mapped to `reason: "dependency"` (F2): only an authored declaration may
 * auto-open.
 *
 * Total by construction: it never throws, so it can never turn `check` red across the unmigrated store
 * (advocate CR-1).
 */
function legacyBlock(item) {
	const status = legacyStatusOf(item);
	if (status === "held") {
		const claimed = wasEverClaimed(item);
		return {
			source: "legacy",
			reason: claimed ? "manual" : "backlog",
			resolver: claimed ? item.to : "pm",
			constraints: [],
			payload: item.heldReason ? { note: item.heldReason } : {},
			since: parkTransitionAt(item, ["held"]),
			reviewBy: null,
		};
	}
	if (status === "deferred") {
		const deferredTo = item.deferredTo ?? "human";
		return {
			source: "legacy",
			reason: "question",
			resolver: deferredTo,
			constraints: [],
			payload: {
				deferredTo,
				...(item.question ? { question: item.question } : {}),
			},
			since: parkTransitionAt(item, ["deferred"]),
			reviewBy: null,
		};
	}
	return null;
}

/**
 * The stage of an item: the AUTHORED `stage` when the row has one, else the legacy read-mapping.
 *
 * A stored `deferred` is stage `deferred`, WHOEVER parked it. `wasEverClaimed` is deliberately NOT on
 * this path: whether a seat ever claimed the row says who parked it (the block's `resolver`/`payload`
 * carry that) — it says nothing about whether the item may be claimed now, and using it here made the
 * stage depend on the transition log instead of on the park itself. So both populations that the design
 * split across two stages — a holder deferring its own claimed item, and a supervisor escalating a
 * never-claimed row — are `deferred`, and each names its resolver in its block.
 *
 * (W) ADMISSION, tightened by lead's ruling item 3: on AUTHORED state, `active` admits `block === null`
 * ONLY. The pair `active` + `block` is refused rather than mapped, because it is the exact shape that
 * makes a parked row look like a running one. The LEGACY half stays TOTAL (advocate CR-1): a stored row
 * with no authored `stage` never reaches this check, so ~160 unmigrated rows cannot turn `check` red.
 */
export function effectiveStage(item) {
	if (item?.stage !== undefined) {
		if (!STAGES.includes(item.stage)) {
			throw new Error(`unknown stage ${JSON.stringify(item.stage)} on item #${item?.id}`);
		}
		if (item.stage === "active" && effectiveBlock(item) !== null) {
			throw new Error(
				`item #${item?.id}: stage "active" admits block === null; a parked item is stage "deferred", whose block names the reason and the resolver`,
			);
		}
		return item.stage;
	}
	const status = legacyStatusOf(item);
	if (status === "done" || status === "cancelled") return "closed";
	if (status === "claimed") return "active";
	if (status === "deferred") return "deferred";
	return "open"; // queued, held, and any unknown legacy value
}

/**
 * The block of an item: the AUTHORED `block` when the row has one (`null` means authored-unblocked),
 * else the legacy read-mapping. Absence of the field IS the legacy exemption (design §7) — no flag.
 */
export function effectiveBlock(item) {
	if (item?.block !== undefined) return item.block ?? null;
	return legacyBlock(item);
}

/**
 * The familiar four states, as a VIEW of the axes (§2). Every existing surface keeps rendering what it
 * rendered before: `queued`/`held` for an open item, `claimed` for an active one, `deferred` for a
 * deferred one. A closed item renders its outcome.
 *
 * The mapping goes BOTH ways now, which is the point of the stage: stored `deferred` -> stage
 * `deferred` -> view `deferred`, with no round-trip through `active`. `active` renders `claimed` and
 * NOTHING else, because (W) guarantees an active row carries no block.
 */
export function legacyStatus(item) {
	const stage = effectiveStage(item);
	if (stage === "closed") return legacyStatusOf(item) === "cancelled" ? "cancelled" : "done";
	if (stage === "deferred") return "deferred";
	if (stage === "active") return "claimed";
	return effectiveBlock(item) === null ? "queued" : "held";
}

/**
 * May this block clear itself when its gates complete? True only for a DECLARED `dependency` whose
 * every constraint is a queue gate (§4.1, architect F2/F3). This is the guard that keeps `backlog`
 * (and every legacy read-mapping) out of the one irreversible automatic action the design adds.
 *
 * It is a property of the block model, NOT a claimability predicate: who may claim an item is #2673's
 * `workable`, and it lives there.
 */
/**
 * #5770 — THE BOUNDED PARK VIEW. Born from a measurement, not a wish: `cli.mjs queue --status held`
 * on the live store dumps 438 held + 384 deferred rows WITH bodies, and devtools' unbounded scratch
 * export of the same read reached 25 MB. A census of *why* a row is parked cannot be run through that.
 *
 * What this returns is a projection of ONE row: no body, no subject, only the fields that answer
 * "who parked it, on what, and when do we look again". Three states are kept DISTINCT, because
 * collapsing them is the defect this instrument exists to make visible:
 *   - `gate: "recorded"` — something WAS written: an authored `block` (reason + resolver, validated on
 *     the write path), a `blockedBy` gate, a `heldReason`, or a `deferredTo`;
 *   - `gate: "none"`     — nothing was written: no `blockedBy`, no `block`, no `heldReason`, no
 *     `deferredTo`. `legacyBlock` would DERIVE a park from the status for such a row; this view refuses
 *     to present an inference as a gate, and `basis` says where any reported reason/resolver came from.
 *     THIS is the row a seat cannot tell apart from a released row nobody claimed.
 * `blockedBy` is reported even when the block is inferred, because a gate and a park are different facts.
 */
export const GATE_VIEW_CAP = 200;

export function gateView(item) {
	const blockedBy = Array.isArray(item?.blockedBy)
		? item.blockedBy.filter((id) => Number.isInteger(id) && id > 0)
		: [];
	const authored = item?.block === undefined ? null : item.block ?? null;
	const heldReason = typeof item?.heldReason === "string" && item.heldReason.trim() ? item.heldReason.trim() : null;
	const deferredTo = typeof item?.deferredTo === "string" && item.deferredTo.trim() ? item.deferredTo.trim() : null;
	// NOTHING written about this row: no gate ids, no block, no reason, no deferral target. That is the row
	// a seat cannot tell apart from a released row nobody claimed, so it must be reported as such rather
	// than given the status-derived block that `legacyBlock` would happily invent.
	const recorded = blockedBy.length > 0 || authored !== null || heldReason !== null || deferredTo !== null;
	const block = recorded ? (authored ?? legacyBlock(item)) : null;
	return {
		id: item?.id,
		from: item?.from ?? null,
		to: item?.to ?? null,
		status: legacyStatus(item),
		stage: effectiveStage(item),
		blockedBy: blockedBy.length ? blockedBy : null,
		reason: block?.reason ?? null,
		resolver: block?.resolver ?? null,
		reviewBy: block?.reviewBy ?? null,
		heldReason,
		deferredTo,
		note: block?.payload?.note ?? block?.payload?.question ?? null,
		recorded,
		gate: recorded ? "recorded" : "none",
		basis: authored ? "authored-block" : recorded ? "declared-fields" : "none",
		// #6150: the recorded park class, echoed as written. Derived here would recurse into
		// derivePark, which reads this view; the metric derives the current class from the ids.
		park: item?.park ?? null,
	};
}

export function canAutoOpen(block) {
	if (!block || typeof block !== "object") return false;
	if (block.source !== "declared") return false;
	if (block.reason !== "dependency") return false;
	const constraints = Array.isArray(block.constraints) ? block.constraints : [];
	return constraints.length > 0 && constraints.every((c) => c?.kind === "queue");
}

/* ─── #6150: the RECORDED park class ────────────────────────────────────────────────────────────────
 * A fleet metric that decides "is this a standing rule?" by reading trigger prose is a cheap signal
 * reading text, and #3575 says a cheap signal may accept but must not decide: the count can be moved by
 * wording. The fix is to store WHAT the park is, next to the gate ids that already exist, so a metric
 * filters on structure. Four classes, fixed vocabulary:
 *   `rule`        parked on an EVENT the queue cannot close (a roadmap gate, an operator window, a
 *                 schedule, a manual hold) - no queue-row gate is recorded;
 *   `gated-work`  parked on queue rows, and every one of them is already terminal at the moment of
 *                 recording: the gate is closed and the row is waiting to be reconciled;
 *   `open-gate`   parked on queue rows, at least one of which is still live: real work, still waiting;
 *   `unattributed` nothing was written - no `blockedBy`, no `block`, no `heldReason`, no `deferredTo`.
 * The class is DERIVED from stored fields only; prose is never read here. Where the field is absent (the
 * unmigrated population - #6150 forbids migrating rows) the audit derives it from the same structure and
 * labels it `derived`, and reports any disagreement with the prose heuristic instead of hiding it.
 */
export const PARK_CLASSES = ["rule", "gated-work", "open-gate", "unattributed"];
const TERMINAL_QUEUE_STATUSES = new Set(["done", "cancelled"]);

/** Every queue id this row treats as a gate: the structured `blockedBy` plus any queue constraint. */
export function parkGateIds(item) {
	const ids = new Set(gateView(item).blockedBy ?? []);
	for (const c of effectiveBlock(item)?.constraints ?? []) {
		if (c?.kind !== "queue") continue;
		const n = Number(String(c.ref).replace(/^#/, ""));
		if (Number.isInteger(n) && n > 0) ids.add(n);
	}
	return [...ids].sort((a, b) => a - b);
}

/**
 * Classify the park from STORED STRUCTURE. `statusOf(id)` supplies the status of a gate row ("absent"
 * when the id does not resolve); without it a gate's state is unknown and the row is classed `open-gate`
 * rather than assumed closed - the safe direction, because calling a live gate closed releases work that
 * is not done.
 */
export function derivePark(item, { statusOf = () => "absent" } = {}) {
	const ids = parkGateIds(item);
	if (ids.length) {
		const open = ids.filter((id) => !TERMINAL_QUEUE_STATUSES.has(statusOf(id)));
		if (open.length)
			return { class: "open-gate", basis: `queue gate(s) ${open.map((id) => `#${id}`).join(", ")} still live`, gateIds: ids };
		return { class: "gated-work", basis: `every gate it names (${ids.map((id) => `#${id}`).join(", ")}) is terminal`, gateIds: ids };
	}
	const authored = item?.block ?? null;
	if (authored) {
		const gates = (authored.constraints ?? []).filter((c) => c?.kind !== "queue" && c?.ref);
		return {
			class: "rule",
			basis: `authored ${authored.reason} park (resolver ${authored.resolver})${gates.length ? `, non-queue gate(s) ${gates.map((c) => `${c.kind}:${c.ref}`).join(", ")}` : ""}`,
			gateIds: [],
		};
	}
	// Nothing authored and no gate ids: `legacyBlock` would INFER a `manual`/`backlog` park from the
	// held status, and reporting that inference as a class is exactly the text-shaped shortcut this field
	// exists to replace. Report the absence, and name what the status mapping would have guessed.
	return {
		class: "unattributed",
		basis: `nothing recorded: no blockedBy, no authored block, no heldReason, no deferredTo (the status mapping alone would guess "${legacyBlock(item)?.reason}")`,
		gateIds: [],
	};
}

/** The recorded park if a writer stored one, else the structural derivation (labelled, never guessed). */
export function parkOf(item, { statusOf = () => "absent" } = {}) {
	const recorded = item?.park && typeof item.park === "object" && PARK_CLASSES.includes(item.park.class);
	if (recorded) return { ...item.park, source: "recorded" };
	return { ...derivePark(item, { statusOf }), source: "derived-structure", recordedAt: null };
}
