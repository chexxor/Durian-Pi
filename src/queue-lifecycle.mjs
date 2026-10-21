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
 * the field model and every consumer agree on the names. */
export const STAGES = ["open", "active", "closed"];

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
 * - `deferred` — a `question` block, `stage` unchanged (`active` when the holder deferred, `open` when
 *   the supervisor escalated a never-claimed row).
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
 * `deferred` does not force a stage — it is `active` when the holder deferred it and `open` when the
 * supervisor escalated a row nobody had claimed (§2, architect F1).
 */
export function effectiveStage(item) {
	if (item?.stage !== undefined) {
		if (!STAGES.includes(item.stage)) {
			throw new Error(`unknown stage ${JSON.stringify(item.stage)} on item #${item?.id}`);
		}
		return item.stage;
	}
	const status = legacyStatusOf(item);
	if (status === "done" || status === "cancelled") return "closed";
	if (status === "claimed") return "active";
	if (status === "deferred") return wasEverClaimed(item) ? "active" : "open";
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
 * rendered before: `queued`/`held` for an open item, `claimed`/`deferred` for an active one. A closed
 * item renders its outcome.
 */
export function legacyStatus(item) {
	const stage = effectiveStage(item);
	if (stage === "closed") return legacyStatusOf(item) === "cancelled" ? "cancelled" : "done";
	if (stage === "active") return effectiveBlock(item) === null ? "claimed" : "deferred";
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
export function canAutoOpen(block) {
	if (!block || typeof block !== "object") return false;
	if (block.source !== "declared") return false;
	if (block.reason !== "dependency") return false;
	const constraints = Array.isArray(block.constraints) ? block.constraints : [];
	return constraints.length > 0 && constraints.every((c) => c?.kind === "queue");
}
