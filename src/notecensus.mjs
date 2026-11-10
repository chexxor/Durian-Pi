// src/notecensus.mjs — the ONE implementation of "does this seat actually have a continuity note, did it
// read it, and did compaction use it?" (#6082, milestone N18 row 9).
//
// WHY THIS EXISTS. N18 row 9 says the mechanism is "armed, never exercised". That claim is not checkable
// per seat: `status` knows a seat exists, and `docs/evidence/.../milestone-check.mjs` counts store-wide
// totals, but nothing says which of the 12 seats woke, worked, wrote a note, read it back, and had that note
// stand in for a summariser call. Measured on the live store 2026-11-10: 1902 `pi.compaction` entries, of
// which 5 carry a continuity note, 4 carry the deterministic digest and 1,893 are summariser output. A
// milestone that is "done" on average is not done for the seat that is about to lose its context.
//
// WHY IT READS THE STORE DIRECTLY. Same reason as src/fleethealth.mjs (#5789): a `node:sqlite` open in
// `readOnly: true` mode opens no harness and claims no ownership, so the census answers while the broker is
// wedged - the state in which every broker-routed read times out. It writes nothing. The three facts come
// from ONE pass over `entries`, so `status` does not pay a scan per seat.
//
// THE THREE FACTS, and exactly what each can and cannot prove:
//   1. noteExists / noteWritten - a `durig.notes` document for the seat's conversation, and whether it was
//      ever WRITTEN. A note doc can exist because `read_note` materialises the empty initial state; "the doc
//      is there" is not "the seat has a note". The census reports both, so the distinction is not lost.
//   2. readNoteCalls - TRANSCRIPT ENTRIES CARRYING A `read_note` TOOL CALL, and separately
//      `noteToolsOffered` - the turns whose request DECLARED the note tools. They are different numbers, and
//      conflating them is the classic false green: on this rig the naive scan read 25 "read_note calls" for a
//      fleet that actually made 5, because every `pi.system` entry names the tools it offered. Zero calls with a
//      written note means the seat never re-read it after a boundary.
//   3. compaction sources - every `pi.compaction` summary is classified by what produced it: the NOTE
//      (the extension supplied the summary - its own note, or a seed drawn from the seat's claimed/queued
//      item; either way NO model call), the deterministic DIGEST (extension armed, nothing to render), or a
//      SUMMARISER call (the extension did not intercept). A seat whose compactions are all summariser output is
//      a seat the mechanism has never reached, whatever the config says.

import { DatabaseSync } from "node:sqlite";

/** What pi-durable puts in the record of a compaction summary entry. */
const COMPACTION_KIND = '"kind":"pi.compaction"';
/** The two markers the continuity extension writes into a summary it supplied. */
const NOTE_MARKER = "CONTINUITY NOTE";
const DIGEST_MARKER = "Deterministic digest";

/**
 * Pure: classify ONE compaction summary text by the thing that produced it. Kept separate from the store
 * read so a demo can pin the vocabulary without a 600 MB store.
 * Returns "note" | "digest" | "summariser".
 */
export function compactionSource(text) {
  const t = String(text ?? "");
  if (t.includes(NOTE_MARKER)) return "note";
  if (t.includes(DIGEST_MARKER)) return "digest";
  return "summariser";
}

export const COMPACTION_SOURCES = ["note", "digest", "summariser"];

/** Is a note document's initial state still untouched? The extension's `initial()` is the exact shape. */
export function noteStateIsEmpty(content) {
  try {
    const v = JSON.parse(content);
    return (
      v &&
      v.itemId === null &&
      v.seat === null &&
      v.goal === null &&
      (!Array.isArray(v.verified) || v.verified.length === 0) &&
      (!Array.isArray(v.done) || v.done.length === 0) &&
      v.next === null &&
      v.updatedAt === null
    );
  } catch {
    return false;
  }
}

/**
 * Read the census. `seats` is [{name, conversationId}]; when it is missing the rows are labelled by
 * conversation id and `unnamed: true`, rather than inventing a name (the fleet-health rule).
 */
export function readNoteCensus(dbPath, { seats = null } = {}) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    // ONE pass over entries answers facts 2 and 3 for every conversation at once. TWO traps the first version
    // fell into, both measured on the live store (2026-11-10):
    //   - `pi.system` entries carry the REQUEST's tool declarations, so a plain `record like '%"name":"read_note"%'`
    //     counts every turn in which the tool was OFFERED: on this rig that read 25 "read_note calls" for a fleet
    //     that had actually made 5. "Offered" and "used" are different facts and both are useful, so they are
    //     counted separately and named differently.
    //   - the three compaction buckets must be mutually exclusive: the extension's summary contains the note AND
    //     the digest beneath it, so a row matching both markers would be counted twice.
    const rows = db.prepare(
      `select conversation_id,
              sum(case when json_extract(record, '$.kind') = 'pi.assistant'
                        and record like '%"type":"toolCall"%' and record like ? then 1 else 0 end) as read_note_calls,
              sum(case when json_extract(record, '$.kind') = 'pi.assistant'
                        and record like '%"type":"toolCall"%' and record like ? then 1 else 0 end) as write_note_calls,
              sum(case when json_extract(record, '$.kind') = 'pi.assistant'
                        and record like '%"type":"toolCall"%' and record like ? then 1 else 0 end) as handoff_calls,
              sum(case when json_extract(record, '$.kind') = 'pi.system' and record like ? then 1 else 0 end) as note_tools_offered,
              sum(case when record like ? then 1 else 0 end) as compactions,
              sum(case when record like ? and record like ? then 1 else 0 end) as via_note,
              sum(case when record like ? and record not like ? and record like ? then 1 else 0 end) as via_digest,
              sum(case when record like ? and record not like ? and record not like ? then 1 else 0 end) as via_summariser
         from entries
         group by conversation_id`,
    ).all(
      '%"name":"read_note"%',
      '%"name":"write_note"%',
      '%"name":"continue_from_note"%',
      '%"name":"read_note"%',
      `%${COMPACTION_KIND}%`,
      `%${COMPACTION_KIND}%`, `%${NOTE_MARKER}%`,
      `%${COMPACTION_KIND}%`, `%${NOTE_MARKER}%`, `%${DIGEST_MARKER}%`,
      `%${COMPACTION_KIND}%`, `%${NOTE_MARKER}%`, `%${DIGEST_MARKER}%`,
    );
    const byConv = new Map(rows.map((r) => [r.conversation_id, r]));

    // Fact 1: the note document, and whether any revision ever wrote into it. A `delta` revision is a
    // write_note commit; a lone `base` revision is the empty initial state a `read_note` call created.
    const noteDocs = db
      .prepare(
        `select d.id, json_extract(d.record, '$.scope.conversationId') as conversation_id,
                count(r.document_id) as revisions,
                sum(case when r.kind = 'delta' then 1 else 0 end) as deltas,
                max(case when r.kind = 'base' and json_extract(r.content, '$.goal') is not null then 1 else 0 end) as base_has_content
           from documents d
           left join document_revisions r on r.document_id = d.id
          where d.kind = ?
          group by d.id`,
      )
      .all('"durig.notes"');
    const notes = new Map(noteDocs.map((n) => [n.conversation_id, n]));

    const wanted = seats?.length ? seats : [...byConv.keys()].map((conversationId) => ({ name: `conv-${conversationId}`, conversationId, unnamed: true }));
    const census = wanted.map((seat) => {
      const stats = byConv.get(seat.conversationId) ?? {
        read_note_calls: 0, write_note_calls: 0, handoff_calls: 0, note_tools_offered: 0,
        compactions: 0, via_note: 0, via_digest: 0, via_summariser: 0,
      };
      const note = notes.get(seat.conversationId);
      return {
        seat: seat.name,
        conversationId: seat.conversationId,
        ...(seat.unnamed ? { unnamed: true } : {}),
        noteDoc: !!note,
        noteWritten: !!note && (note.deltas > 0 || note.base_has_content === 1),
        noteRevisions: note?.revisions ?? 0,
        readNoteCalls: Number(stats.read_note_calls ?? 0),
        writeNoteCalls: Number(stats.write_note_calls ?? 0),
        handoffCalls: Number(stats.handoff_calls ?? 0),
        // Turns whose request DECLARED the note tools. Offered is not used: a seat can have the tools and never
        // reach for them, which is exactly the "armed, never exercised" state this census exists to expose.
        noteToolsOffered: Number(stats.note_tools_offered ?? 0),
        compactions: Number(stats.compactions ?? 0),
        compactionVia: {
          note: Number(stats.via_note ?? 0),
          digest: Number(stats.via_digest ?? 0),
          summariser: Number(stats.via_summariser ?? 0),
        },
        // The seat's most recent compaction, classified: the answer to "is THIS seat on the note path now?"
        latestCompactionVia: latestCompactionSource(db, seat.conversationId),
      };
    });

    const totals = census.reduce(
      (acc, row) => {
        acc.notes += row.noteWritten ? 1 : 0;
        acc.noteDocs += row.noteDoc ? 1 : 0;
        acc.readNoteCalls += row.readNoteCalls;
        acc.noteToolsOffered += row.noteToolsOffered;
        acc.compactions += row.compactions;
        for (const key of COMPACTION_SOURCES) acc[key] += row.compactionVia[key];
        return acc;
      },
      { seats: census.length, notes: 0, noteDocs: 0, readNoteCalls: 0, noteToolsOffered: 0, compactions: 0, note: 0, digest: 0, summariser: 0 },
    );

    return { seats: census, totals };
  } finally {
    db.close();
  }
}

function latestCompactionSource(db, conversationId) {
  const row = db
    .prepare(
      `select record from entries
        where conversation_id = ? and record like ?
        order by id desc limit 1`,
    )
    .get(conversationId, `%${COMPACTION_KIND}%`);
  if (!row) return null;
  // The summary lives in the entry's model text; a compaction entry's record also carries the reason, so
  // classify the whole record - the markers only appear in the summary text.
  return compactionSource(row.record);
}

/** Compact human rendering: one line per seat, sorted by the thing that is most actionable. */
export function renderCensus(census) {
  const lines = [];
  lines.push(
    `continuity notes: ${census.totals.notes}/${census.totals.seats} seats have a written note; ` +
      `${census.totals.readNoteCalls} read_note calls across ${census.totals.noteToolsOffered} turns that offered the tools; ` +
      `${census.totals.compactions} compactions -> note ${census.totals.note}, digest ${census.totals.digest}, summariser ${census.totals.summariser}`,
  );
  for (const row of census.seats) {
    lines.push(
      `  ${String(row.seat).padEnd(12)} conv ${String(row.conversationId).padEnd(7)} note=${row.noteWritten ? "written" : row.noteDoc ? "empty doc" : "none"}` +
        `  read_note ${row.readNoteCalls}x (offered ${row.noteToolsOffered}x)  compactions ${row.compactions} (note ${row.compactionVia.note}, digest ${row.compactionVia.digest}, summariser ${row.compactionVia.summariser})` +
        `  latest: ${row.latestCompactionVia ?? "no compaction"}`,
    );
  }
  return lines.join("\n");
}
