// src/tui/conversation.mjs — the conversation view's LOADED WINDOW, as a value.
//
// ROADMAP 89: opening a seat's detail view must show its durable transcript, not
// just the newest streaming page. The view starts from the newest `SCAN_LIMIT`
// page and, when the operator reaches the loaded top, loads ONE older page and
// PREPENDS it; the live tail keeps appending at the other end (D40: the in-flight
// partial never becomes a turn). This module owns only that window's state — the
// entries held, the oldest loaded id, whether older entries remain, and the scroll
// offset — so the paging rule is testable without a terminal (the store read is
// injected). Rendering stays in src/tui/client.mjs; the store reads are
// src/rigstory.mjs (`readOlderEntries`/`conversationExhausted`); ui.mjs wires the
// two and owns the keys.

import { buildTurns } from "../viewmodel.mjs";

/**
 * A fresh, empty window. `exhausted` is `null` while UNKNOWN (the newest page does
 * not by itself say whether older entries exist): `true` when the whole transcript
 * fits the page or a probe/page confirmed the end, `false` when older entries are
 * known to remain. The renderer shows the "load older" invite only on a known
 * `false`, and "start of conversation" only on a known `true`.
 */
export function createConversationWindow() {
	return { seat: null, entries: [], exhausted: null, scroll: 0 };
}

/** Point the window at one seat, discarding the previous seat's loaded history. */
export function selectSeat(window, seat) {
	window.seat = seat;
	window.entries = [];
	window.exhausted = null;
	window.scroll = 0;
	return window;
}

/**
 * Merge a freshly-read newest page (newest first) into the window, keyed by entry
 * id so a re-read of the same page is idempotent and no duplicate ever renders.
 * Entries stay sorted newest-first. When the page is short of `limit`, the whole
 * transcript fits in it, so the window is exhausted (no older read is needed).
 */
export function mergeNewest(window, pageNewestFirst, limit) {
	const byId = new Map(window.entries.map((e) => [e.id, e]));
	for (const entry of pageNewestFirst ?? []) {
		if (entry?.id != null) byId.set(entry.id, entry);
	}
	window.entries = [...byId.values()].sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
	if (Number.isFinite(limit) && (pageNewestFirst?.length ?? 0) < limit) window.exhausted = true;
	return window;
}

/** The oldest loaded entry's id, or null when the window holds nothing. */
export function oldestLoadedId(window) {
	return window.entries.length ? window.entries[window.entries.length - 1].id : null;
}

/** The loaded entries in CHRONOLOGICAL order (oldest first) — what `buildTurns` expects. */
export function chronological(window) {
	return [...window.entries].reverse();
}

/** The loaded window's turns, oldest first (the same shape `renderTranscript` consumes). */
export function turnsOf(window) {
	return buildTurns(chronological(window));
}

/**
 * Load ONE older page and keep the first visible turn ANCHORED (designer contract
 * §3 / H8). The store read is injected as `readOlder(oldestLoadedId) ->
 * { items, exhausted }` (newest first, strictly older), so a demo can drive paging
 * without a store. Returns `{ addedEntries, addedTurns }` for the caller to assert
 * against.
 *
 * ANCHOR — the scroll convention. `scroll` here counts turns back from the NEWEST
 * (the same convention `renderTranscript` uses: `end = turns.length - scroll`).
 * Prepending K older turns shifts every existing turn's index by +K, so keeping
 * `scroll` UNCHANGED grows `end` by K and the window covers exactly the turns it
 * covered before — the first visible turn does not move. (The designer's contract
 * states this as "scroll += K"; that is the same rule read from the opposite
 * origin — an offset measured from the OLDEST end, which does grow by K. Under
 * this module's newest-relative convention the delta is 0.) `addedTurns` is still
 * reported so a caller can confirm the prepend happened.
 */
export async function loadOlder(window, readOlder) {
	const oldest = oldestLoadedId(window);
	if (oldest === null) return { addedEntries: 0, addedTurns: 0 };
	const turnsBefore = turnsOf(window).length;
	const { items = [], exhausted } = (await readOlder(oldest)) ?? {};
	const byId = new Map(window.entries.map((e) => [e.id, e]));
	let addedEntries = 0;
	for (const entry of items) {
		if (entry?.id != null && !byId.has(entry.id)) {
			byId.set(entry.id, entry);
			addedEntries += 1;
		}
	}
	window.entries = [...byId.values()].sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
	if (exhausted !== undefined) window.exhausted = exhausted;
	const addedTurns = turnsOf(window).length - turnsBefore;
	return { addedEntries, addedTurns };
}
