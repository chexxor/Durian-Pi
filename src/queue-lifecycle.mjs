// src/queue-lifecycle.mjs — the structured GATE field model (queue-lifecycle redesign v2, slice M1a).
//
// WHY (docs/reviews/queue-lifecycle-redesign.md, ACCEPTED 2026-10-19; incident
// docs/incidents/2026-10-19-held-rows-orphaned-by-cleared-gates.md): a parked item was not required to
// name a machine-readable reason it is parked, who or what clears it, or a date to look again, so the
// queue could orphan work. This slice is FIELD-EARLY (lead #3048): it defines the `block` shape and the
// `reviewBy` defaults, and the existing enqueue path persists it — nothing more.
//
// SCOPE, deliberately narrow: the field model only. There is NO stage/block MAPPING and NO claimability
// PREDICATE here (those are the later slices M1b/M4, and `workable` is owned by #2673 per lead #3034) —
// so a reader can tell, from the file, what has and has not been converted yet.
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
