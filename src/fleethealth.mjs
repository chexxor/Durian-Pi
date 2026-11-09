// src/fleethealth.mjs — the ONE implementation of "what is the fleet actually doing, and did it fail?"
//
// WHY THIS EXISTS (promoted 2026-11-08, #5789, from the working `.spike/delegate/` probes). The milestone
// acceptance for ROADMAP 331 is not "compaction got fixed" — it is "the compaction failure count STOPS
// GROWING". Nothing in `tools/` counted that: `git ls-files tools/` was 49 files and none of them count
// generation outcomes or compaction failures. The probes that did count lived in gitignored `.spike/` and
// were gone by the time anyone wanted them (#5617 records exactly that loss). A re-spiked probe is not
// verification; a tool with a demo is.
//
// WHY IT READS THE STORE DIRECTLY. `tasks` is the store's own record of every generation and every
// compaction, with its outcome. Reading it with `node:sqlite` in `readOnly: true` mode opens no harness and
// claims no ownership, so the instrument answers while the broker is wedged — the state in which every other
// read verb times out (`read health: timed out awaiting the broker's result`, pitfall 139). It writes
// nothing: no entries, no tasks, no files.
//
// THE ATTRIBUTION IS THE PRODUCT, NOT THE TABLE. A number nobody can point at is not an instrument. Every
// failure class therefore carries the seats and conversations it came from. Seat names come from the rig's
// own seat list when it can be read; when it cannot, attribution falls back to the conversation id and the
// tool SAYS so rather than inventing a name.
//
// FAMILY KEYS ARE NORMALISED, AND THAT IS A FINDING, NOT A DETAIL. Measured on the live store (2026-11-08):
// compaction failures are 431 of 2,335 records. The raw error messages fragment the SAME cause into many
// pseudo-families — the spend-cap refusals alone appear as at least ten distinct strings differing only in
// the projected dollar figure ($0.001165, $0.001197, $0.001229, …, counts 23, 16, 15, 12, 10, 9, 9, 8, …).
// A counter keyed on the raw message would report "421 kinds of failure, one of each" and would be useless
// for the acceptance, which is a TREND. So families are classified by cause first, and only then by a
// digit-normalised message.

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

/** A caller-supplied seat map: {"42": "impl"} or [{name, conversationId}]. Nothing else in the store keys
 * health by seat name, so this is how a row becomes a seat rather than a conversation id. */
export function readSeatMap(path) {
  if (!path) return null;
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (Array.isArray(raw)) return Object.fromEntries(raw.map((s) => [s.conversationId, s.name]));
  return raw;
}

/** Outcome buckets, from `state.outcome.status`. `null` is IN FLIGHT, not a failure. */
export const OUTCOME_BUCKETS = ["completed", "failed", "aborted", "inFlight"];

/**
 * Cause families. Patterns are listed in the order they are tested, and each one is a pattern SEEN IN THE
 * STORE, not a guess. Anything unclassified keeps its message with digits normalised to `#`, so a new cause
 * shows up as its own row instead of hiding inside a number.
 */
export function classifyFamily(message) {
  if (!message) return "unknown-outcome";
  const m = String(message).toLowerCase();
  if (m.includes("hit the token limit")) return "token-limit-incomplete-summary";
  if (m.includes("spend_cap_exceeded") || m.includes("spend cap")) return "spend-cap-refusal";
  if (m.includes("is not available") || m.includes("no_model")) return "model-unavailable";
  if (m.includes("database is locked") || m.includes("sqlite_busy")) return "store-locked";
  if (m.includes("timed out")) return "timeout";
  return m.replace(/\d+/g, "#").slice(0, 80);
}

/** Count an array of outcome strings into the four buckets. Pure, so a demo can pin it without a store. */
export function countOutcomes(outcomes) {
  const t = { completed: 0, failed: 0, aborted: 0, inFlight: 0 };
  for (const o of outcomes) {
    if (o === "completed") t.completed += 1;
    else if (o === "failed") t.failed += 1;
    else if (o === "aborted") t.aborted += 1;
    else t.inFlight += 1;
  }
  return t;
}

function rows(db, kind, cutoff) {
  return db
    .prepare(
      "select conversation_id, json_extract(record, '$.state.outcome.status') as outcome," +
        " json_extract(record, '$.state.outcome.error.message') as message," +
        " json_extract(record, '$.state.outcome.error.detail.reason') as reason," +
        " json_extract(record, '$.startedAt') as startedAt, json_extract(record, '$.endedAt') as endedAt from tasks where kind = ?" +
        (cutoff === null ? "" : " and json_extract(record, '$.startedAt') >= ?"),
    )
    .all(JSON.stringify(kind), ...(cutoff === null ? [] : [cutoff]));
}

/**
 * Read the fleet's health from a store. `sinceMin` bounds the window; pass `null` for all time.
 * Returns { db, windowMinutes, generations, compaction, queueCensus, seatsResolved, seatCount }.
 */
export function readFleetHealth(dbPath, { sinceMin = 360, seatMap = null } = {}) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const cutoff = sinceMin === null ? null : Date.now() - sinceMin * 60000;
    const seatByConv = new Map();
    for (const [conv, name] of Object.entries(seatMap ?? {})) seatByConv.set(Number(conv), name);
    let seatsResolved = seatByConv.size > 0;
    try {
      // The rig keeps its seat list as a document; durable stores the doc's value in the revision rows.
      const seats = db
        .prepare("select content from document_revisions where kind = ? order by seq desc limit 1")
        .all(JSON.stringify("durig.seats"));
      for (const row of seats) {
        const value = JSON.parse(row.content ?? "null");
        const list = Array.isArray(value?.seats) ? value.seats : Array.isArray(value) ? value : [];
        for (const s of list) if (s?.name && s?.conversationId != null) seatByConv.set(s.conversationId, s.name);
      }
      seatsResolved = seatByConv.size > 0;
    } catch {
      seatsResolved = false;
    }

    const seat = (conv) => seatByConv.get(conv) ?? `conv:${conv}`;

    const tally = (kind) => {
      const rowsOf = rows(db, kind, cutoff);
      const totals = countOutcomes(rowsOf.map((r) => r.outcome));
      const bySeat = new Map();
      const families = new Map();
      for (const r of rowsOf) {
        const name = seat(r.conversation_id);
        const rec = bySeat.get(name) ?? { seat: name, conversationId: r.conversation_id, completed: 0, failed: 0, aborted: 0, inFlight: 0 };
        if (r.outcome === "completed") rec.completed += 1;
        else if (r.outcome === "failed") rec.failed += 1;
        else if (r.outcome === "aborted") rec.aborted += 1;
        else rec.inFlight += 1;
        bySeat.set(name, rec);
        if (r.outcome === "failed") {
          const family = classifyFamily(r.message);
          const f = families.get(family) ?? { family, reason: r.reason ?? null, count: 0, seats: new Set(), conversations: new Set(), firstAt: r.startedAt, lastAt: r.startedAt };
          f.count += 1;
          f.seats.add(name);
          f.conversations.add(r.conversation_id);
          if (r.startedAt < f.firstAt) f.firstAt = r.startedAt;
          if (r.startedAt > f.lastAt) f.lastAt = r.startedAt;
          families.set(family, f);
        }
      }
      return {
        total: rowsOf.length,
        ...totals,
        bySeat: [...bySeat.values()].sort((a, b) => b.failed - a.failed || b.total - a.total || a.seat.localeCompare(b.seat)),
        failureClasses: [...families.values()]
          .sort((a, b) => b.count - a.count || a.family.localeCompare(b.family))
          .map((f) => ({ family: f.family, reason: f.reason, count: f.count, seats: [...f.seats].sort(), conversations: [...f.conversations].sort(), firstAt: f.firstAt, lastAt: f.lastAt })),
      };
    };

    const queueCensus = db
      .prepare("select json_extract(record, '$.status') as status, count(*) as n from tasks where kind = ? group by 1 order by n desc")
      .all(JSON.stringify("durig.queue"));

    return {
      db: dbPath,
      windowMinutes: sinceMin,
      cutoff: cutoff,
      seatsResolved,
      generations: tally("pi.generation"),
      compaction: tally("pi.compaction"),
      incompleteSummary: tally("pi.compaction").failureClasses.find((f) => f.family === "token-limit-incomplete-summary")?.count ?? 0,
      queueCensus,
    };
  } finally {
    db.close();
  }
}
