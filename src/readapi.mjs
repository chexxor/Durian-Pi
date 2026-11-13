// The one shared read API over a rig's store (D21, ROADMAP item 8). Every
// viewer and report - `watch`, `log`, `status`, `check`, `metrics`, and any
// future interactive client - needs the same three things: the seats, the queue,
// and the health derived from them. Before this module each caller re-implemented
// the document reads, so a change to how a seat is read had to be made in several
// places and could disagree with itself.
//
// Read-only by construction: nothing here opens a harness or writes storage.
// Opening a harness resumes scheduling, and a process whose only job is to look
// must not schedule (D11). That is why a client can import this and read the
// store without becoming a driver.

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { RigControl, RigQueue, Seats } from "./rig.mjs";
import { openPoolRow, POOL_SIZE_GATE_FRACTION } from "./rig.mjs";
import { SCAN_LIMIT, readSeatPages } from "./rigstory.mjs";
import { computeMetrics } from "./metrics.mjs";
import { computeAttention, countMalformedToolCalls } from "./attention.mjs";
import { failureStreak } from "./supervisor.mjs";
import { strandedMsSetting, declaredContextWindow, compactionSettings } from "./config.mjs";
import { DEFAULT_TIER_TOKENS } from "./config.mjs";
import { DEFAULT_STRATEGY, resolveStrategy } from "./workstrategy.mjs";
import { contextConsumption } from "./context.mjs";
import { scanEntriesForSecrets, secretNotices } from "./secretdetect.mjs";
import { readGenerationSlots } from "./genlock.mjs";
import { deriveSeatAction, partialView, peerGraph } from "./viewmodel.mjs";
import { declaredLocalWindow, localProviderSpecs } from "./providers/local.mjs";

/**
 * The TAIL of `<db>.broker.log`, capped at `maxBytes` (the log is unbounded and NOT rotated, see
 * the `pass-failed` measure's blind spot). Read-only; an absent/unreadable log reads as null, never
 * as an empty pass. A partial first line (no leading ISO timestamp) is skipped by the counter.
 * The path mirrors `brokerLogPath` in src/broker.mjs — inlined here so the read API does not pull
 * the provider stack (broker.mjs imports pi-ai) into every read-only client.
 */
function readBrokerLogTail(dbPath, maxBytes = 256 * 1024) {
	if (!dbPath) return null;
	let fd = null;
	try {
		const path = `${dbPath}.broker.log`;
		const size = statSync(path).size;
		if (size === 0) return "";
		const start = Math.max(0, size - maxBytes);
		fd = openSync(path, "r");
		const buf = Buffer.alloc(size - start);
		readSync(fd, buf, 0, buf.length, start);
		return buf.toString("utf8");
	} catch {
		return null;
	} finally {
		if (fd !== null) {
			try {
				closeSync(fd);
			} catch {
				// best-effort close; the read already succeeded or failed
			}
		}
	}
}

/** The seats DOCUMENT, in the same `{found, value}` shape the broker's generic `document` read
 * view returns. That shape is the compatibility seam: a resident broker outlives the code on disk,
 * and an OLD broker only knows the views that existed when it started — so a new CLI asks for a
 * document it already serves rather than for a view name the broker has never heard of.
 * The raw value (or `{}` for an absent document) is internal: the roster and the work-strategy view
 * are two readings of the SAME document, and splitting them into two storage reads would let them
 * disagree in a single render. */
export async function readSeatsDocument(storage, context = BACKGROUND_CONTEXT) {
	const rec = await storage.findDocument(
		{ kind: Seats.definition.kind, scope: { kind: "session" } },
		"current",
		context,
	);
	if (!rec) return { found: false, value: null };
	return { found: true, value: (await storage.document(rec.id, "current", context))?.value ?? {} };
}

async function readSeatsValue(storage, context = BACKGROUND_CONTEXT) {
	return (await readSeatsDocument(storage, context)).value ?? {};
}

/** Project the seats document into the plain rows a renderer or client consumes. */
function seatRowsFrom(value) {
	return Object.entries(value.seats ?? {}).map(([name, s]) => ({
		name,
		conversationId: s.conversationId,
		role: s.role,
		// Additive (and OMITTED when unset, so the row is byte-identical to the pre-change roster and the
		// broker's JSON payload equals the direct read): what the seat was CREATED with, so a readout can
		// explain why a seat was offered a row. `workStrategy` is the seat's own OVERRIDE, not the
		// resolved value — a reader that wants the effective one asks `readWorkStrategyView`.
		...(s.capabilities === undefined ? {} : { capabilities: s.capabilities }),
		...(s.workStrategy === undefined ? {} : { workStrategy: s.workStrategy }),
		// N19 row 5: the window this seat can actually work in, recorded by `up`. Omitted when unset, so a
		// seat created before N19 reads byte-identically to before.
		...(s.usableWindow === undefined ? {} : { usableWindow: s.usableWindow }),
		...(s.contextWindow === undefined ? {} : { contextWindow: s.contextWindow }),
	}));
}

/** The strategy a rig RESOLVES to, per seat and for the team, with its provenance.
 *
 * Exposed because the operator-facing question is not "what is stored" but "in what order will
 * this seat claim". `source` is the path the value came down (seat > team > default), so a seat
 * override that surprised the operator is visible as `seat` rather than merely "a strategy".
 * Pure over a seats-document value; invalid stored names THROW here (via `resolveStrategy`), which
 * is deliberate: a rig that will refuse every claim on that seat must not first read as healthy.
 */
export function workStrategyView(value) {
	const team = resolveStrategy({ teamStrategy: value.workStrategy });
	const seats = Object.fromEntries(
		Object.entries(value.seats ?? {}).map(([name, s]) => [
			name,
			resolveStrategy({ seatStrategy: s.workStrategy, teamStrategy: value.workStrategy }),
		]),
	);
	return { default: DEFAULT_STRATEGY, team, seats };
}

/** The resolved claim order for a rig, read from its store (see `workStrategyView`). */
export async function readWorkStrategyView(storage, context = BACKGROUND_CONTEXT) {
	return workStrategyView(await readSeatsValue(storage, context));
}

/** The seats a store holds, as the plain {name, conversationId, role} shape a
 * renderer or client consumes. An absent session document is an empty rig, not
 * an error: the wrong-database guardrail is the caller's job (noteEmptyRig). */
export async function readSeatList(storage, context = BACKGROUND_CONTEXT) {
	return seatRowsFrom(await readSeatsValue(storage, context));
}

/**
 * Each seat's PERSISTED root (`pi.agent`.cwd) — the strongest liveness signal the worktree
 * audit (ROADMAP 76) has: a worktree that is some seat's current cwd is IN USE regardless of
 * its item's queue status. Read-only; an unreadable `pi.agent` reads as null, never fatal.
 */
export async function readSeatRoots(storage, context = BACKGROUND_CONTEXT) {
	const seats = await readSeatList(storage, context);
	const roots = [];
	for (const seat of seats) {
		try {
			const rec = await storage.findDocument(
				{ kind: "pi.agent", scope: { kind: "conversation", conversationId: seat.conversationId } },
				"current",
				context,
			);
			const cwd = rec ? (await storage.document(rec.id, "current", context))?.value?.cwd ?? null : null;
			if (cwd) roots.push({ name: seat.name, cwd });
		} catch {
			// A viewer must survive an unreadable pi.agent: skip this seat's root.
		}
	}
	return roots;
}

/**
 * Each seat's PERSISTED model (`pi.agent`.model) as `provider/modelId`, keyed by seat name.
 *
 * #2231: the store DOES record which model a seat runs — in the conversation's `pi.agent`
 * document (`configure` writes it at `up`) — even though the roster (`durig.seats`) does not.
 * The context denominator needs it: with no rig spec the read surface had no model key, so
 * `declaredContextWindow` could not see a LOCAL seat's declared window and
 * `window.denominator` stayed null. Read-only; an unreadable `pi.agent` reads as absent,
 * never fatal (the same survival rule as `readSeatRoots`).
 */
export async function readSeatModels(storage, seats, context = BACKGROUND_CONTEXT) {
	const models = {};
	for (const seat of seats) {
		try {
			const rec = await storage.findDocument(
				{ kind: "pi.agent", scope: { kind: "conversation", conversationId: seat.conversationId } },
				"current",
				context,
			);
			const model = rec ? (await storage.document(rec.id, "current", context))?.value?.model : null;
			if (model && typeof model.provider === "string" && typeof model.modelId === "string") {
				models[seat.name] = `${model.provider}/${model.modelId}`;
			}
		} catch {
			// A viewer must survive an unreadable pi.agent: skip this seat's model.
		}
	}
	return models;
}

/** The queue's items, newest-current document. Returns [] for an absent store so
 * a first-run read is empty rather than exceptional. */
export async function readQueueItems(storage, context = BACKGROUND_CONTEXT) {
	const rec = await storage.findDocument(
		{ kind: RigQueue.definition.kind, scope: { kind: "session" } },
		"current",
		context,
	);
	const value = rec ? (await storage.document(rec.id, "current", context))?.value ?? {} : {};
	return value.items ?? [];
}

/**
 * ONE queue row by id (#4986).
 *
 * WHY A SEPARATE READ, stated honestly: the queue is ONE document (`RigQueue`, `value.items`), so the STORAGE
 * read cannot be narrowed — reading one row reads the document. What CAN be narrowed, and what the rig was
 * paying for, is the PRINT: `node cli.mjs queue` emitted **21,927,512 bytes** on this rig (measured in #4986,
 * and the same reason `cli.mjs status` is 22 MB), and a 17-row audit therefore cost a 22 MB dump that blew
 * through a seat's context before any row was read. A row-scoped read is the difference between "the tool read
 * the store" and "the session paid for the store".
 *
 * `rows` is returned with the row so a caller can tell "this row is one of 2,000" from "this is the whole
 * queue" — a narrow read that hides its own selectivity is how a partial view gets mistaken for the truth.
 * `item: null` is a RESULT, not an exception: the caller decides whether an absent row is an error (the CLI
 * exits 1 on it, because a typo'd id must not look like an empty queue).
 */
export async function readQueueRow(storage, id, context = BACKGROUND_CONTEXT) {
	const items = await readQueueItems(storage, context);
	const want = String(id);
	return {
		id: want,
		item: items.find((i) => String(i.id) === want) ?? null,
		rows: items.length,
	};
}

// The CLOSED state vocabulary for a queue row (#5016) — measured, not guessed. On this rig's live store (5,077
// rows) the distinct values are exactly `done 3805, cancelled 800, held 337, queued 116, deferred 15, claimed 4`,
// and they are the same values the code already keeps in sets: `MID_ITEM_STATUSES` / `LIVE_STATUSES`
// (src/broker.mjs), `TERMINAL_STATUSES` (src/checkup.mjs), `LANDING_QUEUE_STATUSES` below. A filter that accepts
// `--status done2` would answer "no rows" to a typo — the same defect class as an unknown flag, since both turn a
// mistake into an empty success. So the CLI refuses against THIS list and the demo pins it.
export const QUEUE_STATUSES = ["queued", "claimed", "deferred", "held", "done", "cancelled"];

/** Per-state counts over a row set: the census a narrowed view must not be mistaken for. */
export function queueCounts(items) {
	const counts = {};
	for (const it of items) counts[it.status] = (counts[it.status] ?? 0) + 1;
	return counts;
}

/**
 * Narrow a row set by id / state / addressee (#5016). Groups AND together; values within one group OR
 * (`--status queued --status held` means either). Pure and shared by the CLI, the broker view and the demos — a
 * filter written twice is two truths, which is how a viewer and the census start to disagree.
 * It narrows the PAYLOAD only: the queue is ONE document (`RigQueue.value.items`), so every caller has already
 * read it whole. The output says so (`narrowed: "payload"`) rather than letting a small view imply a small read.
 */
export function filterQueueItems(items, { ids = null, statuses = null, to = null } = {}) {
	const idSet = ids?.length ? new Set(ids.map(String)) : null;
	const statusSet = statuses?.length ? new Set(statuses) : null;
	const toSet = to?.length ? new Set(to) : null;
	return items.filter(
		(it) =>
			(!idSet || idSet.has(String(it.id))) &&
			(!statusSet || statusSet.has(it.status)) &&
			(!toSet || toSet.has(it.to)),
	);
}

/**
 * The attention lines derivable from QUEUE ROWS ALONE (#5016), produced by the SAME `computeAttention` the
 * `status` surface uses — the measure and the notice must not become two implementations (the same reason
 * src/metrics.mjs reuses the notice predicate). Stated per kind, honestly: `deferred_awaiting_answer` reads only
 * `status`/`to`/`deferredTo`, so it is emitted here. `idle_with_queued_work`, `last_run_failed`,
 * `repeated_failure`, `admitted_not_started` and `malformed_tool_call` need live generation slots or submission
 * records this read does not take, so emitting them would be a DIFFERENT claim from the one `status` makes — they
 * are excluded, not approximated. A caller that wants the whole surface calls `readRigHealth`.
 */
export function queueAttention(items, seats) {
	return computeAttention(seats ?? [], items, new Map(), new Map()).filter(
		(a) => a.kind === "deferred_awaiting_answer",
	);
}

/**
 * A row that will never change again. `done` and `cancelled` are the two states a queue row can reach and then
 * stop being about: 5,027 of the 6,021 rows in this rig's store (measured 2026-11-09) are terminal, and they are
 * 21.8 MB of the 24.7 MB the queue document serialises to. A "status" that carries them is showing history, not
 * state - and history is what ROADMAP 176 makes recallable from the transcript.
 */
export const TERMINAL_QUEUE_STATUSES = ["done", "cancelled"];

/** The row count a bounded status/queue view may carry. Chosen so a view fits in a terminal scrollback, not so it
 * fits the store: 200 active rows is more than a rig can be acting on at once. */
export const QUEUE_VIEW_ROW_CAP = 200;

/** Rows still in play: anything that is not terminal. */
export function activeQueueItems(items) {
	return (items ?? []).filter((it) => !TERMINAL_QUEUE_STATUSES.includes(it.status));
}

/**
 * BOUND A QUEUE PAYLOAD FOR A VIEW (ROADMAP 331, the read-surface leg).
 *
 * The read is not the cost - the queue is ONE document, so whoever asks has already read all 6,021 rows out of
 * SQLite. The cost is what the view SERIALISES and hands to a broker, a TUI or a human pipe: measured on this
 * rig, `cli.mjs status` returned 28.5 MB, 24.7 MB of it `queueItems`. That is the blowup the continuation notes
 * must not re-introduce.
 *
 * The projection reports what it dropped, in rows AND bytes, so a small view never reads as a small rig. Counts
 * and attention are always derived from the FULL row set before projection (the #5016 rule); this function only
 * decides what travels.
 *
 * @param {Array<object>} items full rows
 * @param {{cap?: number, dropTerminal?: boolean}} [opts]
 * @returns {{rows: Array<object>, shown: number, total: number, droppedTerminal: number, droppedCapped: number,
 *   bytes: {before: number, after: number}}}
 */
export function projectQueueView(items, { cap = QUEUE_VIEW_ROW_CAP, dropTerminal = true } = {}) {
	const rowsAll = items ?? [];
	const active = dropTerminal ? activeQueueItems(rowsAll) : rowsAll;
	const rows = active.slice(0, cap);
	return {
		rows,
		shown: rows.length,
		total: rowsAll.length,
		droppedTerminal: dropTerminal ? rowsAll.length - active.length : 0,
		droppedCapped: active.length - rows.length,
		bytes: { before: JSON.stringify(rowsAll).length, after: JSON.stringify(rows).length },
	};
}

/**
 * Counts over a row set, without touching the store. Same derivation as `readQueueCensus`, but pure, so a view
 * that already has the rows in memory (status, a broker pass) can report the census without a second read.
 */
export function queueCensusOf(items) {
	const rows = items ?? [];
	const counts = {};
	for (const it of rows) counts[it.status] = (counts[it.status] || 0) + 1;
	return {
		rows: rows.length,
		counts,
		terminal: rows.filter((it) => TERMINAL_QUEUE_STATUSES.includes(it.status)).length,
		active: rows.filter((it) => !TERMINAL_QUEUE_STATUSES.includes(it.status)).length,
		// The pool numbers travel with the census, not in a second read: a bounded view must not look like a
		// smaller rig (#5016), and the pool is exactly the part a status-count-only census hides - a pooled row
		// is `queued` like any other, so a full pool and an idle fleet read as "busy".
		pool: poolCounts(rows),
	};
}

/**
 * THE ROW-SIDE POOL COUNTS (N19 row 5 + 7) - docs/POOL-QUEUE-SPEC.md §6.4, the half that needs NO seats.
 *
 * Split out deliberately: `queue --json`'s census comes from a row read that has no seat document in it, so a
 * pool line there must be derivable from rows alone. `poolCensus` is this plus the seat-side warnings. One
 * derivation, two surfaces - the numbers can drift apart only if the code does.
 *
 * `sizeRefused` counts TRANSITIONS, not statuses: a row the size gate refused is still `queued` (nothing about
 * its status changed - only its eligibility for THIS seat changed), so the only durable trace is the
 * `size-refused` event the claim path writes.
 */
export function poolCounts(rows) {
	const list = rows ?? [];
	const pooled = list.filter((it) => it.pool === true);
	const open = pooled.filter(openPoolRow);
	return {
		rows: pooled.length,
		pooled: pooled.length,
		open: open.length,
		// `claimed` is the count the human report and the contract name; `ownerOfRecord` is the same number
		// spelled out for a reader who needs to know WHY a claimed pool row is no longer open (P5).
		claimed: pooled.length - open.length,
		ownerOfRecord: pooled.length - open.length,
		sizeRefused: list.filter((it) => (it.transitions ?? []).some((t) => t.event === "size-refused")).length,
	};
}

/**
 * THE POOL CENSUS (N19 "The Pool", rows 5 + 7) - docs/POOL-QUEUE-SPEC.md §6.4.
 *
 * WHY IT IS SEPARATE FROM `queueCensusOf`: a pooled row is not "someone else's row" - it is work with NO owner
 * yet. Counting it under `queued` makes a rig look busy while every seat is idle, which is exactly the failure
 * the pool is meant to remove. So the three numbers the operator needs - how many rows are in the pool, how
 * many were taken from it, and how many were REFUSED because they are too big - are reported apart from the
 * status counts.
 *
 * `tooBig` answers "is this row invisible to half the fleet?": the row's tier estimate is compared with the
 * LARGEST usable window among seats that declared one. A row bigger than every seat's budget is big-work-only
 * and must say so; a row bigger than ONE seat's budget is simply not for that seat, which the per-seat gate
 * already handles.
 *
 * A seat with NO declared `usableWindow` (created before N19, or a model with no declared context window) is
 * NOT assumed small - it is counted in `seatsWithoutWindow` and excluded from the comparison, because refusing
 * work on a guessed number is the false-negative class #2673 rules against.
 */
export function poolCensus(items, seats = [], tierTokens = DEFAULT_TIER_TOKENS, fraction = POOL_SIZE_GATE_FRACTION) {
	const rows = items ?? [];
	const seatList = seats ?? [];
	const open = rows.filter((it) => it.pool === true && openPoolRow(it));
	const withWindow = seatList.filter((s) => Number.isFinite(s.usableWindow) && s.usableWindow > 0);
	const tooBig = open
		.map((it) => {
			const estimate = tierTokens?.[it.tier];
			if (!Number.isFinite(estimate) || estimate <= 0) return null; // untiered or unmodelled: nothing to warn about
			if (!withWindow.length) return null; // nothing measured -> no warning, per the conservative default
			const cantHold = withWindow.filter((s) => estimate > fraction * s.usableWindow).map((s) => s.name);
			if (!cantHold.length) return null;
			return { id: it.id, tier: it.tier, estimate, tooBigFor: cantHold, unclaimableByAnyone: cantHold.length === withWindow.length };
		})
		.filter(Boolean);
	// ONE derivation for the row-side numbers (`poolCounts`); the seat-side numbers are added on top. Two
	// spellings of "how many rows are in the pool" is the #5047 class the gate rules already learned.
	return {
		...poolCounts(rows),
		tooBig: tooBig,
		seatsWithoutWindow: seatList.filter((s) => !Number.isFinite(s.usableWindow) || s.usableWindow <= 0).map((s) => s.name),
		fraction,
	};
}

/**
 * The deferred backlog, projected to the fields a clock-in digest aggregates: id, seat, subject sliced.
 * A bounded status view drops terminal rows and caps the rest, so the rows that are AWAITING THE OPERATOR can
 * fall out of the payload while the store still holds them — and the digest then reports a backlog of 0 for a
 * store with 384 deferred rows. That is the bug this projection closes: the backlog is a DERIVATION over the full
 * row set, so it must travel with the view that hides the rows it came from (#5016).
 */
export function deferredBacklogRows(items, { subjectChars = 55 } = {}) {
	return (items ?? [])
		.filter((it) => it.status === "deferred")
		.map((it) => ({
			id: it.id,
			to: it.to,
			status: it.status,
			subject: String(it.subject || "").slice(0, subjectChars),
			deferredTo: it.deferredTo,
		}));
}

/** Body-free index of the rows a bounded view dropped: `[{id, status}]`. Opt-in, because it is ~80 KB on this
 * rig's store — a script that must join a branch to its row's state needs it; a seat reading status does not. */
export function terminalStatusIndex(items) {
	return (items ?? [])
		.filter((it) => TERMINAL_QUEUE_STATUSES.includes(it.status))
		.map((it) => ({ id: it.id, status: it.status }));
}

/**
 * Refuse an UNBOUNDED read with a count. A caller who asks for the whole document is asking for something this
 * rig has measured at 24.7 MB; the refusal names the size and the way to widen deliberately, rather than letting
 * the payload sit in the broker's read channel until it times out.
 */
export function refuseOversizedQueueRead(items, { capRows = QUEUE_VIEW_ROW_CAP } = {}) {
	const rows = (items ?? []).length;
	if (rows <= capRows) return null;
	const bytes = JSON.stringify(items).length;
	return `the queue document holds ${rows} rows / ${(bytes / 1048576).toFixed(1)} MB, more than a bounded view's cap of ${capRows} rows. Ask for a slice: --status claimed --to <seat>, or --limit N (1..${capRows}). The full history is in the durable store and is recallable by row id.`;
}

/**
 * The census a narrow queue read carries with it (#5016): how many rows exist, the per-state counts, and the
 * row-derived attention — all computed over the FULL, UN-PROJECTED row set, BEFORE any projection. That order is
 * the point: `--no-body` and the filters drop bytes from the ANSWER, never rows from the DERIVATION, so a smaller
 * view cannot hide the rows that produce a notice. A partial queue read mistaken for the census is this rig's
 * registered failure, and `readQueueRow` returning `rows` is the same correction at a smaller scale.
 */
export async function readQueueCensus(storage, context = BACKGROUND_CONTEXT) {
	const items = await readQueueItems(storage, context);
	const seats = await readSeatList(storage, context);
	return { rows: items.length, counts: queueCounts(items), attention: queueAttention(items, seats), pool: poolCounts(items) };
}

/**
 * The rig-level control document (ROADMAP 131): `paused` and its provenance. Absent
 * store reads as NOT paused, so a first-run/legacy store is unpaused rather than
 * exceptional. Read-only: `status` renders it, it never writes it.
 */
export async function readRigControl(storage, context = BACKGROUND_CONTEXT) {
	try {
		const rec = await storage.findDocument(
			{ kind: RigControl.definition.kind, scope: { kind: "session" } },
			"current",
			context,
		);
		if (!rec) return { paused: false, pausedAt: null, pausedBy: null, reason: null, directive: null };
		const value = (await storage.document(rec.id, "current", context))?.value ?? {};
		return {
			paused: value.paused === true,
			pausedAt: value.pausedAt ?? null,
			pausedBy: value.pausedBy ?? null,
			reason: value.reason ?? null,
			// The active DIRECTIVE (src/queueops.mjs `planDirective`). A reordering policy the operator
			// cannot see in the read they already make is the accepted-and-ignored class: it would
			// reorder claims invisibly. Expiry is reported, never applied, here — the ordering function
			// is the single place that decides whether a lapsed lease still means anything.
			directive: value.directive ?? null,
		};
	} catch {
		// A viewer must survive a corrupt control document: read it as unpaused rather
		// than killing `status`/`watch` (the same discipline as an unreadable pi.live).
		return { paused: false, pausedAt: null, pausedBy: null, reason: null, directive: null, unreadable: true };
	}
}

/** The `pi.live` document for one conversation: run control, the in-flight
 * generation partial, and the current tool round. Absent when the conversation
 * never ran or storage has not materialized it, so {} reads as idle. This is the
 * only place a follower can see work before it commits (ROADMAP 40c). */
// One stderr warning per conversation: a follower is not the writer and cannot
// repair the document, so repeating the same failure every poll is noise.
const warnedUnreadableLive = new Set();
function warnUnreadableLive(conversationId, err) {
	if (warnedUnreadableLive.has(conversationId)) return;
	warnedUnreadableLive.add(conversationId);
	console.error(
		`unreadable pi.live for conversation ${conversationId} (${err?.message ?? err}); reading it as no in-flight partial`,
	);
}

export async function readLiveState(storage, conversationId, context = BACKGROUND_CONTEXT) {
	try {
		const rec = await storage.findDocument(
			{ kind: "pi.live", scope: { kind: "conversation", conversationId } },
			"current",
			context,
		);
		if (!rec) return {};
		return (await storage.document(rec.id, "current", context))?.value ?? {};
	} catch (err) {
		// A viewer must survive a corrupt `pi.live` (P5/#110): one unreadable seat
		// otherwise kills the whole `log --follow`/`watch` session (`unresolvable
		// path: ["generation","message","content",0]`). Report it once and read it
		// as "no in-flight partial" — `{}` is idle by this function's contract — so
		// committed history and every other seat keep rendering.
		warnUnreadableLive(conversationId, err);
		return {};
	}
}

/**
 * The full health snapshot `status` and `watch` render: seats, queue, the peer
 * navigation graph, metrics, and the attention notices. One bounded scan over the
 * transcripts feeds both metrics and highlights (0.9-1.4 ms for 14 seats x 24
 * entries), so a caller pays for one pass rather than one per consumer.
 *
 * `cfg` is passed rather than imported because config loading is the CLI's job
 * (env + file precedence lives in cli.mjs); an absent cfg is valid and leaves the
 * stranded-admission threshold at the module default in src/attention.mjs.
 */
export async function readRigHealth(
	storage,
	dbPath,
	slots,
	{ modelsBySeat = {}, entryLimit = SCAN_LIMIT, cfg = undefined, windowsBySeat = {} } = {},
) {
	// One read of the seats document serves both the roster and the claim-order view, so
	// `status` cannot print a roster and a strategy drawn from different snapshots.
	const seatsValue = await readSeatsValue(storage);
	const seats = seatRowsFrom(seatsValue);
	const queueItems = await readQueueItems(storage);
	// #2231: the roster carries no model, but each conversation's `pi.agent` does. Resolve the
	// seats the caller did NOT already supply a model for, so a LOCAL seat's declared window is
	// visible to the context denominator even when no rig spec was passed (the `status` path).
	const agentModels = await readSeatModels(
		storage,
		seats.filter((seat) => !modelsBySeat[seat.name]),
	);
	// ROADMAP 131: the rig-level paused state (read-only).
	const control = await readRigControl(storage);

	const latestByConv = new Map();
	const failureStreakByConv = new Map();
	for (const seat of seats) {
		const page = await storage.scanSubmissions(
			{ conversationId: seat.conversationId, order: "descending" },
			// A bounded page, not just the latest: the repeated_failure notice needs
			// the LEADING run of failures, and a streak of three is what makes a seat
			// a diagnosis problem (ROADMAP 42).
			5,
			undefined,
			BACKGROUND_CONTEXT,
		);
		// ASK B (#502): a seat's LAST ACTIVITY is its newest submission's admitted
		// input-entry timestamp (recovered in the admittedAt pass below); that is
		// also what watch/highlighting treats as freshness, so status and watch
		// cannot disagree about what "recently active" means.
		latestByConv.set(seat.conversationId, page.items[0]);
		failureStreakByConv.set(seat.conversationId, failureStreak(page.items));
	}
	// Slot-file notices ride alongside seat notices: a live holder means the GPU
	// is busy (healthy waiting), a dead holder means a wedged generation. A LIVE
	// slot for a seat also means that seat's queued submission is legitimately
	// waiting behind a genuine run, so those seat names feed the
	// admitted_not_started suppression (ROADMAP 37a): a dead holder's slot does
	// NOT suppress it, because a gone run means nothing is advancing the
	// submission and it IS stranded.
	const genSlots = Number.isFinite(slots) ? readGenerationSlots(dbPath, slots) : [];
	const seatsWithSlot = new Set(genSlots.filter((g) => g.generatingSeat).map((g) => g.generatingSeat));
	const slotNotices = genSlots.map((g) => ({
		scope: "seat",
		seat: g.generatingSeat ?? `slot-${g.slotIndex}`,
		kind: g.name,
		detail: g.name === "generation_in_flight" ? `generating since ${g.since}` : g.detail,
	}));
	const pages = await readSeatPages(storage, BACKGROUND_CONTEXT, seats, entryLimit);
	// The submission record carries no admission timestamp (scanSubmissions
	// returns id/status/entry only), so recover it from the admitted input ENTRY's
	// timestamp for the admitted_not_started notice. When that entry has fallen off
	// the BOUNDED page (ROADMAP 37a), fall back to the newest entry the page DOES
	// carry, so `lastActivity` keeps meaning ACTIVITY (#2229).
	for (const seat of seats) {
		const latest = latestByConv.get(seat.conversationId);
		const entryId = latest?.entry;
		if (!latest || entryId == null) continue;
		const admitted = (pages[seat.name] ?? []).find((e) => e.id === entryId);
		const ts = admitted?.model?.[0]?.timestamp;
		if (Number.isFinite(ts)) {
			latest.admittedAt = ts;
			continue;
		}
		// #2229 (operator hit): the admission entry is off-page — a long conversation, or a
		// compaction between admission and read — so `admittedAt` stayed undefined and the
		// field was OMITTED, rendering an ACTIVE, mid-run seat as IDLE on `status`/`ui` (the
		// operator concluded "the local seats are not taking work"). `lastActivity` means
		// ACTIVITY, not "the last admitted submission": fall back to the NEWEST entry the
		// seat's page actually carries (newest-first, so the first finite timestamp wins).
		// Still no field when the page holds no timestamp at all — the honest empty state.
		const newestTs = (pages[seat.name] ?? []).map((e) => e?.model?.[0]?.timestamp).find((t) => Number.isFinite(t));
		if (Number.isFinite(newestTs)) latest.admittedAt = newestTs;
	}
	// ASK B (#502): project each seat's last activity onto its row. ISO-8601
	// (Date.toISOString) keeps the JSON contract comparable across surfaces, and
	// an absent row field serializes nowhere (additive to the status contract).
	// No timestamps of our own are invented: no seats/no submissions means no
	// field, which is the honest empty state.
	for (const seat of seats) {
		const lastTs = latestByConv.get(seat.conversationId)?.admittedAt;
		if (Number.isFinite(lastTs)) seat.lastActivity = new Date(lastTs).toISOString();
	}
	const metrics = computeMetrics({
		pages,
		queueItems,
		seats,
		modelsBySeat,
		nowMs: Date.now(),
		// Say the window was cut only when a page actually hit the limit, so
		// "bounded" is a fact about this reading rather than a standing claim.
		bounded: Object.values(pages).some((items) => items.length >= entryLimit),
		// #2643 (ROADMAP 78): the broker's own PASS-FAILED lines, so a thrown pass is MONITORED and
		// not only logged. The only durable artifact of the `pass-failed` diagnostic is the log.
		brokerLog: readBrokerLogTail(dbPath),
	});
	// The failure CAUSE is in the entry, not in the submission record: the record
	// carries a category ("model_error"), the entry carries the provider's
	// message. Collected here because the page is already in hand, so surfacing
	// it costs nothing extra (dogfood F3).
	const errorByConv = new Map();
	for (const seat of seats) {
		for (const entry of pages[seat.name] ?? []) {
			const msg = Array.isArray(entry?.model) ? entry.model[0] : null;
			if (msg?.errorMessage) {
				errorByConv.set(seat.conversationId, msg.errorMessage);
				break; // newest first, so the first hit is the most recent failure
			}
		}
	}
	const malformedCountByConv = new Map();
	for (const seat of seats) {
		malformedCountByConv.set(seat.conversationId, countMalformedToolCalls(pages[seat.name] ?? []));
	}
	// READ-SIDE secret detection (item #828): scan the same committed entry pages
	// the metrics/highlights passes already read, so this adds no scan and no write
	// path — only a signal. The findings carry WHERE, never the value.
	const secretFindings = [];
	for (const seat of seats) {
		secretFindings.push(...scanEntriesForSecrets(seat, pages[seat.name] ?? []));
	}
	// Admission age beyond which an unstarted submission is surfaced as stranded
	// (ROADMAP 37a); null means the module default in src/attention.mjs stands.
	const strandedMs = strandedMsSetting(cfg);
	// In-flight partials, per seat: the same snapshot `log --follow` renders, so a
	// watcher sees a seat working before its turn commits (ROADMAP 40c). A seat with
	// nothing generating contributes nothing rather than an empty entry.
	const streaming = {};
	for (const seat of seats) {
		const partial = partialView(await readLiveState(storage, seat.conversationId));
		if (partial?.hasContent) streaming[seat.name] = partial;
	}
	// ROADMAP 208 / #5049: the same measure feeds the `context_over_window` notice, so the notice and
	// the printed fraction can never disagree about which number was scored.
	const context = seatContextMap({ pages, seats, cfg, modelsBySeat, agentModels, windowsBySeat });
	const compactGate = compactGateMap({ seats, cfg, modelsBySeat, agentModels });
	return {
		seats,
		// The order each seat will claim in, and where that choice came from (seat > team > default).
		// Additive to the JSON contract; `status` gets it via `...health`, `ps` via the same view.
		workStrategy: workStrategyView(seatsValue),
		// N19 rows 5 + 7: the tier -> token table IN FORCE (written by `up`) and the pool census over the rows
		// this read already has. Additive to the JSON contract; the claim path reads the same table from the
		// roster, so status and the gate cannot disagree about what a `project` row costs.
		tierTokens: seatsValue?.tierTokens ?? DEFAULT_TIER_TOKENS,
		pool: poolCensus(queueItems, seats, seatsValue?.tierTokens ?? DEFAULT_TIER_TOKENS),
		queueItems,
		// ROADMAP 131: the rig-level paused state, so `status`/`watch` report it and the
		// operator KNOWS whether new work is being taken.
		control,
		paused: control.paused,
		// The peer navigation graph over the same queue items, so a client can ask
		// "who talks to whom" without re-deriving it from from/to (ROADMAP item 7,
		// D21). Additive to the JSON contract: existing readers ignore it.
		peerGraph: peerGraph(queueItems),
		// Maps serialize as {} in JSON; flatten so watch/status output stays legible.
		latestByConv: Object.fromEntries(latestByConv),
		metrics,
		// Per-seat in-flight partials, so any client can show "streaming now"
		// distinctly from committed turns.
		streaming,
		// Per-seat context consumption with its three-state denominator (ROADMAP 27, #1192).
		context,
		attention: [
			...computeAttention(seats, queueItems, latestByConv, errorByConv, {
				nowMs: Date.now(),
				seatsWithSlot,
				failureStreakByConv,
				malformedCountByConv,
				...(strandedMs === null ? {} : { strandedMs }),
				// #5049: the context measure and the compaction verb's gate, so the notice scores the SAME
				// number the `context` field prints, and its remedy text can say whether `compact` would cut.
				contextBySeat: context,
				compactGateBySeat: compactGate,
			}),
			...slotNotices,
			// Metric notices join the attention channel instead of claiming a screen
			// of their own: same slot, same rendering, and signal only when a measure
			// has actually moved (METRICS.md, "the move").
			...metrics.notices,
			// A secret-shaped value in committed content rides the same attention
			// channel as every other operator-visible fact: same slot, same rendering,
			// names WHERE and never the value.
			...secretNotices(secretFindings),
		],
		// The detection artifact, exposed so a caller (`check`, a future TUI pane)
		// can act on WHERE without re-scanning; carries no value by construction.
		secretFindings,
		// Internal: watch derives highlights from these instead of re-scanning.
		_pages: pages,
	};
}

/**
 * The per-seat context measure for a page map (ROADMAP 27 / #1192, re-shaped by ROADMAP 208 /
 * #5049). One producer, two callers: `readRigHealth` (so `status`/`watch`/the TUI render it
 * verbatim) and `check` (so the `context-over-window` rule scores the number the operator already
 * sees rather than a second computation of it).
 *
 * The three-state denominator travels with the value: `measured` is item 97's effective window
 * (#1087) — reserved and absent today; `declared` is the operator's config; `advertised` is the
 * caller's catalog figure. The caller may supply any of the three per seat via `windowsBySeat`;
 * `declared` otherwise falls back to `DURIG_CONTEXT_WINDOW` / the local provider spec. See
 * src/context.mjs for why the state is not optional, and for the two blind spots (one turn's moved
 * tokens including `cacheRead`, and the head state) that a guard must carry.
 */
export function seatContextMap({ pages, seats, cfg, modelsBySeat = {}, agentModels = {}, windowsBySeat = {} }) {
	const localSpecs = localProviderSpecs(cfg);
	const context = {};
	for (const seat of seats) {
		const supplied = windowsBySeat[seat.name] ?? {};
		// An explicit, spec-supplied model wins over the persisted one (they agree today; the
		// spec is the caller's deliberate answer).
		const modelKey = modelsBySeat[seat.name] ?? agentModels[seat.name] ?? null;
		context[seat.name] = contextConsumption(pages?.[seat.name] ?? [], {
			measured: supplied.measured ?? null,
			declared:
				supplied.declared ??
				declaredContextWindow(cfg, modelKey) ??
				declaredLocalWindow(localSpecs, modelKey),
			advertised: supplied.advertised ?? null,
		});
	}
	return context;
}

/**
 * The compaction verb's OWN gate per seat, so a context notice can say whether `compact <seat>`
 * would cut or decline instead of pointing at a verb that might do nothing. The gate is the
 * ACCUMULATION BUDGET (`keepRecentTokens`), not the window — that is what #4898 established, and
 * it is why "over the window" and "compact will help" are different questions.
 *
 * Reported only when DURIG actually sets it (`DURIG_COMPACTION_KEEP_RECENT_TOKENS` or a
 * per-model override). pi-durable's documented default is NOT substituted here: a number durig
 * does not read must not become a number durig prints, so the gate stays null and the notice says
 * `unknown`.
 */
export function compactGateMap({ seats, cfg, modelsBySeat = {}, agentModels = {} }) {
	// `compactionSettings` FAILS LOUDLY on a malformed value (its documented rule: a key an operator wrote
	// must never be quietly ignored). A bad budget must not take down `status`/`watch`, so the error is
	// carried to the notice instead of thrown — the notice then says the gate is unreadable and why.
	let settings = null;
	let settingsError = null;
	try {
		settings = compactionSettings(cfg ?? {});
	} catch (err) {
		settingsError = String(err?.message ?? err);
	}
	// The policy is NESTED under `.compaction` (measured, not assumed: reading it flat returned `unknown`
	// for a configured rig on the first run of this guard).
	const policy = settings?.compaction ?? {};
	const gates = {};
	for (const seat of seats) {
		const modelKey = modelsBySeat[seat.name] ?? agentModels[seat.name] ?? null;
		const override = modelKey ? settings?.modelOverrides?.[modelKey] : null;
		const fromOverride = Number.isFinite(override?.keepRecentTokens) ? override.keepRecentTokens : null;
		const fromConfig = Number.isFinite(policy.keepRecentTokens) ? policy.keepRecentTokens : null;
		const keep = fromOverride ?? fromConfig;
		gates[seat.name] = {
			keepRecentTokens: keep,
			source: keep === null ? null : fromOverride !== null ? "model-override" : "declared",
			...(settingsError ? { error: settingsError } : {}),
		};
	}
	return gates;
}

/**
 * The queue statuses a LANDING row counts, in the order the renderer may show them.
 * Deliberately the four LIVE statuses and nothing else: `done` and `cancelled` are
 * terminal history, and counting them would make a seat's "queue size" grow forever as
 * it finishes work — a number nobody could explain (ROADMAP 124's warning).
 */
export const LANDING_QUEUE_STATUSES = ["queued", "claimed", "held", "deferred"];

/**
 * The LANDING projection (ROADMAP 124): per seat, what it is working on and how much is
 * waiting behind it, in the shape a landing screen renders.
 *
 * PURE over a `readRigHealth()` snapshot — it takes no storage handle and performs no I/O,
 * so one batched read feeds every seat on the screen. That is the point of the seam
 * (#3103: one spool round trip, never 1+N). A renderer that needs this data must call
 * `readRigHealth` once and pass the result here; it must not loop `readQueueItems` per seat.
 *
 * Per seat:
 *  - `action`  — the seat's current action, using the ONE vocabulary the status bar uses
 *                (`SEAT_ACTIONS` in src/viewmodel.mjs, #2826). Not a parallel enum.
 *  - `queue`   — `{ total, queued, claimed, held, deferred }`; `total` is the sum of those
 *                four live statuses, so the composition is always explainable.
 *  - `claimed` — `{ id, subject }` for the item the seat is working on, or `null`.
 *                `null` is an explicit answer ("nothing claimed"), never a blank field.
 *  - `deferred`— `{ id, subject, deferredTo }` when the seat is parked on a question.
 *  - `notices` — the seat-scoped attention KINDS, unchanged from the health snapshot.
 *  - `lastActivity` — passed through from the seat row, unchanged.
 *
 * The subject is returned as stored; the renderer owns truncation (it knows the width, this
 * module does not), so a brief is never baked into the data path.
 */
export function projectLanding(health) {
	const items = health?.queueItems ?? [];
	const seats = (health?.seats ?? []).map((seat) => {
		const mine = items.filter((it) => it.to === seat.name);
		const counts = { queued: 0, claimed: 0, held: 0, deferred: 0 };
		for (const item of mine) {
			if (Object.hasOwn(counts, item.status)) counts[item.status] += 1;
		}
		const total = LANDING_QUEUE_STATUSES.reduce((n, status) => n + counts[status], 0);
		const action = deriveSeatAction(seat, health);
		const brief = (item) =>
			item ? { id: item.id, subject: item.subject } : null;
		return {
			name: seat.name,
			role: seat.role ?? null,
			// Unchanged passthrough: the landing screen shows the same freshness the seat
			// row already carries, so the two surfaces cannot disagree about "recently active".
			lastActivity: seat.lastActivity ?? null,
			action: action.state,
			focus: action.focus,
			queue: { total, ...counts },
			claimed: brief(action.claimed),
			deferred: action.deferred
				? {
						...brief(action.deferred),
						deferredTo: action.deferred.deferredTo ?? null,
						// The QUESTION is the operator-triage fact a landing row shows for a parked
						// seat (designer spec #3307 §2), so it belongs in the data path rather than
						// being re-read from the store by the renderer.
						question: action.deferred.question ?? null,
					}
				: null,
			notices: action.notices.map((n) => n.kind),
		};
	});
	return { seats };
}
