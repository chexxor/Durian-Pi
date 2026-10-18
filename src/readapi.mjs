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
import { RigControl, RigQueue, Seats } from "./rig.mjs";
import { SCAN_LIMIT, readSeatPages } from "./rigstory.mjs";
import { computeMetrics } from "./metrics.mjs";
import { computeAttention, countMalformedToolCalls } from "./attention.mjs";
import { failureStreak } from "./supervisor.mjs";
import { strandedMsSetting, declaredContextWindow } from "./config.mjs";
import { contextConsumption } from "./context.mjs";
import { scanEntriesForSecrets, secretNotices } from "./secretdetect.mjs";
import { readGenerationSlots } from "./genlock.mjs";
import { partialView, peerGraph } from "./viewmodel.mjs";

/** The seats a store holds, as the plain {name, conversationId, role} shape a
 * renderer or client consumes. An absent session document is an empty rig, not
 * an error: the wrong-database guardrail is the caller's job (noteEmptyRig). */
export async function readSeatList(storage, context = BACKGROUND_CONTEXT) {
	const rec = await storage.findDocument(
		{ kind: Seats.definition.kind, scope: { kind: "session" } },
		"current",
		context,
	);
	const value = rec ? (await storage.document(rec.id, "current", context))?.value ?? {} : {};
	return Object.entries(value.seats ?? {}).map(([name, s]) => ({
		name,
		conversationId: s.conversationId,
		role: s.role,
	}));
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
		if (!rec) return { paused: false, pausedAt: null, pausedBy: null, reason: null };
		const value = (await storage.document(rec.id, "current", context))?.value ?? {};
		return {
			paused: value.paused === true,
			pausedAt: value.pausedAt ?? null,
			pausedBy: value.pausedBy ?? null,
			reason: value.reason ?? null,
		};
	} catch {
		// A viewer must survive a corrupt control document: read it as unpaused rather
		// than killing `status`/`watch` (the same discipline as an unreadable pi.live).
		return { paused: false, pausedAt: null, pausedBy: null, reason: null, unreadable: true };
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
	const seats = await readSeatList(storage);
	const queueItems = await readQueueItems(storage);
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
	// timestamp for the admitted_not_started notice; left undefined when that entry
	// has fallen off the bounded page (ROADMAP 37a).
	for (const seat of seats) {
		const latest = latestByConv.get(seat.conversationId);
		const entryId = latest?.entry;
		if (!latest || entryId == null) continue;
		const admitted = (pages[seat.name] ?? []).find((e) => e.id === entryId);
		const ts = admitted?.model?.[0]?.timestamp;
		if (Number.isFinite(ts)) latest.admittedAt = ts;
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
	// ROADMAP 27 / #1192: the per-seat context-consumption measure, exposed on the health
	// snapshot so `status`/`watch` and the TUI render it VERBATIM (the TUI owns no
	// denominator logic). The three-state denominator travels with the value: `measured` is
	// item 97's effective window (#1087) — reserved here and absent today; `declared` is the
	// operator's config; `advertised` is the caller's catalog figure. The caller may supply
	// any of the three per seat via `windowsBySeat`; `declared` otherwise falls back to
	// `DURIG_CONTEXT_WINDOW`. See src/context.mjs for why the state is not optional.
	const context = {};
	for (const seat of seats) {
		const supplied = windowsBySeat[seat.name] ?? {};
		context[seat.name] = contextConsumption(pages[seat.name] ?? [], {
			measured: supplied.measured ?? null,
			declared: supplied.declared ?? declaredContextWindow(cfg, modelsBySeat[seat.name]),
			advertised: supplied.advertised ?? null,
		});
	}
	return {
		seats,
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
