// src/multiplex.mjs — the ATTACH MULTIPLEXER: N clients on ONE session, ONE merged inbox, ONE broadcast.
//
// WHY THIS EXISTS (goal mwn0dyqj-5pfi52 task-6, D338). `tui.mjs --attach` (task-5) made the durable
// TUI a read-only VIEWER of the session the broker already owns instead of a second writer. That was
// half the product: an operator who is IN the session still has to do something. The shape asked for
// is a tmux-like multiplexer — several clients attached to ONE session, each typing into it and each
// seeing it, and NO client allowed to become a second owner. This module is that layer: it never
// opens a store, never starts a process, and owns no state of its own — the caller hands over the
// handle it already holds and the registry it wants.
//
// THE TWO BROADCAST LEGS, MEASURED ON THIS BOX (.spike/probe-watch-fanout2.mjs, 2026-11-20,
// Linux / Fedora Linux 45 / kernel 7.2.15-300.fc45.x86_64 / node v24.22.1):
//   FANOUT-ON-OWNING-HANDLE — WORKS. Two independently acquired src/livewatch.mjs `watchLive`
//     handles on the SAME (session-owning) Harness each received the identical sequence
//     `run_start,turn_start,message_start,run_end`. A Chord `WatchHandle` installs the SOLE
//     listener ("start() installs the sole serialized asynchronous listener",
//     vendor/pi-main/packages/durable/docs/spec.md §9.1), so N clients = N watch acquisitions on
//     the owning Session, NOT N listeners on one handle. That is the one broadcast output.
//   VIEWER-WATCH-BROADCAST — DEAD, and the layer says so rather than delivering nothing quietly.
//     A watch acquired through a readOnly Harness on a SEPARATE `openNodeSqliteStorage` handle
//     received ZERO events from the writer's commits, even after the viewer read the transcript and
//     ticks passed. spec.md:2054-2057 "the Session's own observers see each held commit" — observers
//     belong to a Session, and a readOnly open "loads live tasks as committed, reconciles nothing"
//     (spec.md:838-840). What DOES cross is a READ (measured: the viewer's `conversation.entries()`
//     returned the writer's `pi.assistant` answer), so a cross-process client's leg is a RE-READ on
//     a cadence the caller chooses.
//
// THE MERGED INPUT STREAM is the library's, not this layer's: every client's input is a `SubmissionDraft`
// admitted by `Conversation.submit` into the built-in `pi.inbox` (docs/spec.md §6; dist/harness/inbox.js:4-5
// `kind: "pi.inbox"`), whose items are ID-ordered ("Items are in ID order.", spec.md:2877). That
// sentence IS the contract for "N clients, one ordered stream" — this module never re-sorts.

import { ConversationIdle, InboxDoc, LiveDoc } from "@earendil-works/pi-durable";
import { watchLive } from "./livewatch.mjs";
import { writeIntent } from "./broker.mjs";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

/** The conversation documents a client may subscribe to, and the token that reads each. */
export const SUBSCRIBE = { live: LiveDoc, inbox: InboxDoc };

/**
	* A client registry, OWNED BY THE CALLER: one multiplexer per session, one entry per attached
	* client. It holds no state of its own, so this layer adds no long-lived process or lifecycle.
	*/
export function createMultiplexer() {
	const clients = new Map();
	return {
		attach: (client) => clients.set(client.id, client),
		reattach: (client) => clients.set(client.id, client), // the same pane, re-opened
		detach: (client) => clients.delete(client.id),
		list: () => [...clients.values()],
		clients: () => [...clients.keys()],
	};
}

/**
	* Attach one client to one conversation of the session the caller's harness drives.
	*
	* @param {Harness} harness the handle the CALLER already holds — this module never opens one.
	* @param {ConversationId} conversationId the token this client subscribes to (spec.md §9.2).
	* @param {Object} opts `{context, id, readOnly, docs, dbPath, seat, now, onEvent}`.
	*   `readOnly` is passed in because `HarnessOptions` does not reach the Harness for reading back;
	*   the caller knows it (`tui.mjs` decided it from `tuiOpenVerdict` — task-5).
	* @returns {Object} the client `{id, leg, events, watches, sees}` plus `refresh()` (viewer leg),
	*   `act()` (its routed input) and `detach()`.
	*
	* `events` is the client's unified broadcast log: watch callbacks (owning handle) and re-read
	* deliveries (attached handle) both append to it, so a pane renders ONE stream either way.
	*/
export async function multiplexAttach(harness, conversationId, {
	// The caller's own client identity — a pane name, a seat name, a tmux window.
		client = `client-${process.pid}`,
		context = BACKGROUND_CONTEXT,
		readOnly = false,
		docs = ["live"],
		seat = null,
		dbPath = null,
		now = Date.now(),
		onEvent = null,
} = {}) {
	const client_ = {
		// A watch acquired through a viewer handle hears nothing (measured), so a viewer's leg is a
		// re-read; an owner's leg is the watch itself. `leg` names which, for the report and the pin.
		leg: readOnly ? "re-read" : "watch",
		// The one fact this layer needs from the caller: whether this handle can write at all.
		write: !readOnly,
		id: client,
		conversationId,
		watches: [],
		// What this client has already shown, so a re-read appends only what is new.
		sees: { entryIds: new Set(), inboxIds: [] },
		events: [],
	};

	const deliver = (events) => {
		if (!events.length) return;
		client_.events.push(...events);
		onEvent?.(events);
	};

	for (const name of docs) {
		const token = SUBSCRIBE[name];
		if (!token) continue; // an unknown subscription name is ignored, never a silent live feed
		// `watchLive` translates pi.live into the event shapes the rig's surfaces already speak
		// (run_start / turn_start / message_start / message_update / run_end); the inbox watch hands
		// back raw ID-ordered items, which IS the merged stream.
		const handle = name === "live"
			? await watchLive(harness, conversationId, context)
			: await harness.watchDoc(token, conversationId, context);
		if (handle === undefined) continue; // watchDoc acquisition never creates: absent reads absent
		if (name === "live") {
			// THE ONE BROADCAST. `start()` installs THIS client's own listener, so N clients = N
			// watch acquisitions on the owning Session, not N listeners on one handle
			// (spec.md §9.1 — "start() installs the sole serialized asynchronous listener").
			await handle.start(async (batch) => {
				deliver(batch.map((e) => ({ ...e, via: "live" })));
			});
		} else {
			// The inbox watch carries the MERGED INPUT STREAM: ID-ordered queued items from every
			// client (spec.md:2877 "Items are in ID order.").
			await handle.start(async (call) => {
				if (call?.kind !== "value") return;
				const items = call.value?.items ?? [];
				const fresh = items.filter((i) => !client_.sees.inboxIds.includes(i.id));
				client_.sees.inboxIds = items.map((i) => i.id);
				deliver(fresh.map((i) => ({ type: "inbox_item", via: "inbox", id: i.id, mode: i.mode, content: i.content ?? null })));
			});
		}
		client_.watches.push({ name, handle });
	}

	// The attached client's leg: fresh reads DO cross processes, so a caller that renders a viewer
	// pane calls this on its own cadence. Its cost is one document snapshot + one entry page.
	if (readOnly) {
	client_.refresh = async () => {
		const inbox = await harness.snapshot(InboxDoc, conversationId, context);
		const conv = await harness.conversation(conversationId, context);
		const page = await conv.entries({}, 500, undefined, context);
		const fresh = page.items.filter((e) => !client_.sees.entryIds.has(e.id));
		for (const e of fresh) client_.sees.entryIds.add(e.id);
		deliver(fresh.map((e) => ({ type: "entry", kind: e.kind, id: e.id })));
		return { inbox: inbox?.items ?? [], entries: page.items };
	};
	}

	// The client's ACT, routed rather than dropped (task-5's rule: a silently dropped act is the
	// accepted-and-ignored lie class). An owner admits with its own writer; an attached client
	// goes to the broker's inbox spool for the resident writer to admit.
	client_.act = async (content, { requestId = null, whenBusy = "followUp", whenIdle = null, to = seat } = {}) => {
	if (client_.write) {
		const conv = await harness.conversation(conversationId, context);
		// ONE merged stream: every client's input is a SubmissionDraft into the same pi.inbox.
		// spec.md §6 admission: idle + empty inbox -> placed (+ run and generation); busy or
		// non-empty inbox -> queued; `whenIdle: "reject"` while idle -> ConversationIdle.
		return await conv.submit(
			{
				type: "input",
				content: String(content ?? ""),
				...(requestId ? { requestId } : {}),
				...(whenBusy ? { whenBusy } : {}),
				// the admission table's `whenIdle: "reject"` leg: an attached client that must not
				// start a run of its own gets the refusal by name instead of a silent queue.
				...(whenIdle ? { whenIdle } : {}),
			},
			context,
		);
	}
	if (dbPath && to) {
	// The seat route already exists: src/broker.mjs `applyRequest` `message` op submits with
	// the broker's own writer. The client's identity becomes the spool's `from`.
		return { spooled: writeIntent(dbPath, {
			op: "message",
			to,
			content: String(content ?? ""),
			from: client_.id,
			...(requestId ? { requestId } : {}),
			createdAt: new Date(now).toISOString(),
		}) };
		}
	// No silent drop: today the ONLY spool target is a SEAT. An attached client aimed at the
	// session's own conversation has no route, so the error names the fix.
	throw new Error(
		`multiplex: an ATTACHED client cannot act on conversation ${conversationId} — ` +
		"the broker's spool routes a `message` intent to a seat (src/broker.mjs applyRequest " +
		"throws `unknown seat` for the root conversation); give this client a seat, or extend " +
		"SPOOL_OPS with a session-level input op",
	);
	};

	client_.detach = async () => {
	for (const w of client_.watches) {
		try {
			await w.handle.stop();
		} catch {
			// a closing Session may refuse the stop; the watch is already detached
		}
	}
	};

	return client_;
}

/**
	* The merged stream as the library sees it: submission records in ID order across every client.
	* `scanSubmissions` orders by ID (vendor/pi-main/packages/durable/dist/types.d.ts:1172 — "in
	* `query.order` (default ascending) by ID"), so this IS the one ID-ordered input stream promised,
	* not a per-client view.
	*/
export async function mergedInputStream(storage, { conversationId = null, limit = 100 } = {}, context = BACKGROUND_CONTEXT) {
	// `scanSubmissions` is a STORAGE read (types.d.ts:1172 — "in `query.order` (default ascending)
	// by ID"), the same read src/broker.mjs:50 and src/readapi.mjs:886 already use. The page IS
	// the merged stream: one ID-ordered list of every client's submission, not a per-client view.
	const page = await storage.scanSubmissions(
		{ order: "ascending", ...(conversationId ? { conversationId } : {}) },
		limit,
		undefined,
		context,
	);
	return page.items;
}

/** The one inbox of one conversation, in the library's ID order. Read-only. */
export async function inboxView(harness, conversationId, context = BACKGROUND_CONTEXT) {
	return (await harness.snapshot(InboxDoc, conversationId, context))?.items ?? [];
}

/** Is this rejection the library's "conversation is idle" refusal? (the admission table's leg.) */
export function isConversationIdle(err) {
	return err?.name === ConversationIdle?.name || /ConversationIdle/.test(String(err?.message ?? err));
}
