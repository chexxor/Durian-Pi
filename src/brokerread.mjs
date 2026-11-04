// src/brokerread.mjs — the broker's READ service (ROADMAP 71 spool extension).
//
// Why this exists. pi-durable is a library with ONE owner per process: the broker
// opens the Harness/Storage, and any other process that calls
// `openNodeSqliteStorage` is a SECOND owner. That second owner is not merely a
// reader — `SqliteStorage.document()` wraps its read in `db.transaction()` =
// `BEGIN IMMEDIATE`, so a CLI viewer's read takes the broker's WRITE lock. A
// `log --follow` / `watch` / `ui.mjs` poll then contends with the broker's commits
// and times out its 5 s busy window, poisoning the session (`SessionFailed`).
//
// The fix is the one the library intends ("one owner, many clients"): the broker is
// the only client of pi-durable, and every other process asks the broker for reads.
// This module is the broker side of that ask, applied through the command spool
// with the broker's OWN storage (`probeStorage`). It uses pi-durable's own
// interface — the `Storage` methods (`findDocument`/`document`/`scanEntries`/…)
// and durig's readapi seam over them — never raw SQL against the vendor schema.

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  readLiveState,
  readQueueCensus,
  readQueueItems,
  readQueueRow,
  readRigHealth,
  readSeatList,
  readSeatRoots,
} from "./readapi.mjs";
import { readFeed } from "./eventfeed.mjs";
import { conversationExhausted, readOlderEntries } from "./rigstory.mjs";

/**
 * The closed set of read views a spooled `read` request may ask for. Coarse views
 * (one request = one render payload) rather than a storage-method proxy:
 * `readRigHealth` alone makes dozens of storage calls, and a per-call round-trip
 * through the ~1 s broker inbox would make `status` take minutes.
 */
export const READ_VIEWS = ["seats", "queue", "queue-row", "queue-census", "roots", "health", "live", "entries", "feed", "document", "exhausted", "older"];

/** The non-secret config keys `readRigHealth` reads. The CLI sends ONLY these: the
 * broker must never receive the provider key that lives in the full config. */
function healthConfig(request) {
  return {
    DURIG_CONTEXT_WINDOW: request.contextWindow ?? undefined,
    DURIG_STRANDED_MS: request.strandedMs ?? undefined,
  };
}

/**
 * Apply one `read` request with the broker's own storage. Returns a
 * JSON-serializable payload; `drainIntentInbox` records it in the result channel.
 * An unknown view throws, so the drain dead-letters it with the reason.
 */
export async function dispatchRead(storage, request, { dbPath, context = BACKGROUND_CONTEXT } = {}) {
  if (!storage) throw new Error("read: the broker has no storage handle (probeStorage) to serve this request");
  const view = request.view;
  if (view === "seats") return await readSeatList(storage, context);
  if (view === "queue") return await readQueueItems(storage, context);
  // #4986: a row-scoped read, so an audit of a few rows costs those rows and not the whole store. The queue is
  // ONE document, so this does not narrow the STORAGE read — it narrows the PAYLOAD, which is the half a session
  // pays for (21,927,512 bytes was the full dump on this rig).
  if (view === "queue-row") {
    if (request.id === undefined || request.id === null || String(request.id) === "")
      throw new Error("queue-row: needs an item id");
    return await readQueueRow(storage, request.id, context);
  }
  // #5016: the census a narrowed read has to ship with — row count, per-state counts, and the attention derived
  // from ALL rows. Served broker-side so a seat can ask "what did I not see" without paying for the 22 MB document
  // over the spool: the answer is a few hundred bytes. This is the view that makes `--no-body` and the filters
  // honest rather than merely smaller.
  if (view === "queue-census") return await readQueueCensus(storage, context);
  if (view === "roots") return await readSeatRoots(storage, context);
  if (view === "health") {
    return await readRigHealth(storage, dbPath, request.slots, {
      modelsBySeat: request.modelsBySeat ?? {},
      windowsBySeat: request.windowsBySeat ?? {},
      entryLimit: request.entryLimit,
      cfg: healthConfig(request),
    });
  }
  if (view === "live") {
    return await readLiveState(storage, request.conversationId, context);
  }
  if (view === "entries") {
    const query = { conversationId: request.conversationId, order: request.order ?? "descending" };
    if (request.minEntryId !== undefined && request.minEntryId !== null) query.minEntryId = request.minEntryId;
    const page = await storage.scanEntries(query, request.limit ?? 20, undefined, context);
    return { items: page.items, nextCursor: page.nextCursor ?? null };
  }
  if (view === "feed") {
    return await readFeed(storage, context, { sinceSeq: request.sinceSeq ?? 0 });
  }
  if (view === "document") {
    const rec = await storage.findDocument(
      { kind: request.kind, scope: request.scope },
      "current",
      context,
    );
    if (!rec) return { found: false, value: null };
    const doc = await storage.document(rec.id, "current", context);
    return { found: true, value: doc?.value ?? null };
  }
  if (view === "exhausted") {
    return await conversationExhausted(storage, request.conversationId, request.oldestLoadedId, context);
  }
  if (view === "older") {
    return await readOlderEntries(
      storage,
      request.conversationId,
      request.oldestLoadedId,
      request.limit,
      context,
    );
  }
  throw new Error(`unknown read view: ${view} (known: ${READ_VIEWS.join(", ")})`);
}
