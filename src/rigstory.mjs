// Reading a seat's recent activity straight from storage is what lets `watch`
// show what each seat is saying without going through the harness: opening a
// harness resumes background work, and a process whose only job is to observe
// must not schedule anything (D11). Entries are reachable because they are the
// same records the transcript is built from.

// Tailing more than a handful of entries costs a scan per seat per render, and
// both facts we need (the newest assistant text and the newest tool call)
// always come from near the top of the transcript. The bound is generous
// because a turn that only calls tools produces several entries with no prose,
// and "what it last said" should look past those to the previous message.
export const SCAN_LIMIT = 24;

// An entry stores its provider message under `model`, and the content shape
// differs by kind: user and system carry a plain string, assistant and tool
// results carry typed parts. Normalizing here keeps every caller from having
// to know that.
export function extractEntryText(entry) {
	const message = Array.isArray(entry?.model) ? entry.model[0] : null;
	if (!message) return null;
	if (typeof message.content === "string") {
		return { role: message.role, text: message.content, toolName: null, isError: message.isError === true };
	}
	const parts = Array.isArray(message.content) ? message.content : [];
	const text = parts
		.filter((part) => part?.type === "text")
		.map((part) => part.text ?? "")
		.join("");
	return { role: message.role, text, toolName: message.toolName ?? null, isError: message.isError === true };
}

// Entries arrive newest-first. "Saying" means the newest assistant utterance;
// the system prompt is deliberately excluded because it is durig's own
// scaffolding, not the seat speaking, and an empty assistant turn (pure tool
// call with no prose) must not overwrite a real message.
export function summarizeEntries(entries) {
	let says = null;
	let toolName = null;
	for (const entry of entries ?? []) {
		if (entry?.kind === "pi.assistant" && says === null) {
			const parsed = extractEntryText(entry);
			if (parsed?.text.trim()) says = parsed.text.trim();
		}
		if (entry?.kind === "pi.tool-result" && toolName === null) {
			toolName = extractEntryText(entry)?.toolName ?? null;
		}
		if (says !== null && toolName !== null) break;
	}
	return { says, toolName };
}

// Read fresh every time. An earlier version cached each seat's summary against
// the newest submission id, but that signal is wrong: a submission records a
// submitted INPUT, so assistant turns append entries without moving it, and the
// cache then pinned the first (empty) reading forever. Measured: entries grew
// 2 -> 5 while the submission id stayed put. A bounded scan per render is cheap
// and cannot go stale.
export async function readSeatHighlights(storage, context, seats) {
	const pages = await readSeatPages(storage, context, seats);
	const highlights = {};
	for (const [name, items] of Object.entries(pages)) {
		highlights[name] = summarizeEntries(items);
	}
	return highlights;
}

/** One bounded page per seat, newest first. This is THE scan: highlights and
 * metrics are both derived from these entries, so a render pays for one pass
 * over the transcripts rather than one per consumer. Measured at 0.9-1.4 ms for
 * 14 seats x 24 entries, against a 750 ms watch poll (docs/METRICS.md). */
export async function readSeatPages(storage, context, seats, limit = SCAN_LIMIT) {
	const pages = {};
	for (const seat of seats) {
		const page = await storage.scanEntries(
			{ conversationId: seat.conversationId, order: "descending" },
			limit,
			undefined,
			context,
		);
		pages[seat.name] = page.items;
	}
	return pages;
}

// ─── Paged backfill (ROADMAP 89) ───────────────────────────────────────────────
//
// The TUI detail view shows the newest page; when the operator reaches the loaded
// top it loads ONE older page on demand. These reads are deliberately SEPARATE from
// `readSeatPages` (the shared per-poll scan): paging back through history must not
// grow the per-poll cost without bound (ROADMAP 89), so the detail view pays for its
// own reads. `maxEntryId` is an INCLUSIVE bound in pi-durable (types.d.ts: "Newest
// entry ID that may be returned"), so a strictly-older read passes
// `oldestLoadedId - 1`.

/**
 * One OLDER page of a conversation's transcript, newest first, strictly older than
 * `oldestLoadedId` (the oldest entry already in hand). Returns `{ items, exhausted }`:
 * a page that does not fill `limit` means nothing older remains — the same fact a
 * limit-1 probe reports, for free (a descending read that hits the end returns short).
 */
export async function readOlderEntries(storage, conversationId, oldestLoadedId, limit = SCAN_LIMIT, context = undefined) {
	const page = await storage.scanEntries(
		{ conversationId, order: "descending", maxEntryId: oldestLoadedId - 1 },
		limit,
		undefined,
		context,
	);
	return { items: page.items, exhausted: page.items.length < limit };
}

/**
 * True when no entry older than `oldestLoadedId` exists — the limit-1 descending
 * probe the indicator's "start of conversation" state is built on. Cheap and honest:
 * it answers only "is there more", never "how much" (a count would need a full scan).
 */
export async function conversationExhausted(storage, conversationId, oldestLoadedId, context = undefined) {
	const page = await storage.scanEntries(
		{ conversationId, order: "descending", maxEntryId: oldestLoadedId - 1 },
		1,
		undefined,
		context,
	);
	return page.items.length === 0;
}
