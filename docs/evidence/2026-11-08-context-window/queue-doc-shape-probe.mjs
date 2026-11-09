// queue-doc-shape-probe.mjs — read-only, no model spend.
// Answers one question a delegate keeps getting wrong: can the queue be read straight out of SQLite?
// Run: node docs/evidence/2026-11-08-context-window/queue-doc-shape-probe.mjs [--db ./selfdev.sqlite]
import { DatabaseSync } from "node:sqlite";

const dbPath = (process.argv.find((a) => a.startsWith("--db=")) ?? "--db=./selfdev.sqlite").slice(5);
const db = new DatabaseSync(dbPath, { readOnly: true });

const doc = db.prepare("select id, kind, scope_kind, record from documents where kind = ?").get('"durig.queue"');
if (!doc) {
  console.log("no durig.queue document in", dbPath);
  process.exit(1);
}
const envelope = doc.record;
console.log("== the document row is an envelope, not the queue ==");
console.log("  documents.id:", doc.id, "kind:", doc.kind, "scope:", doc.scope_kind);
console.log("  record:", String(envelope).slice(0, 200));
console.log("  items in the record:", Array.isArray(envelope.items) ? envelope.items.length : "none — the record has no items array");

const revCount = db.prepare("select count(*) n, max(seq) mx from document_revisions where document_id = ?").get(doc.id);
console.log("== the queue is a delta log ==");
console.log("  revisions:", revCount.n, "newest seq:", revCount.mx);
const newest = db.prepare("select seq, version, content from document_revisions where document_id = ? order by seq desc limit 3").all(doc.id);
for (const r of newest) console.log("  seq", r.seq, "op", String(r.content).slice(0, 120));

console.log("== verdict ==");
console.log("  a probe that parses documents.record reports 0 items and looks exactly like an empty queue.");
console.log("  Read the queue through the bounded CLI view instead: node cli.mjs queue --json --no-body --status queued");
console.log("  (the unbounded census returns megabytes: status ships 27.9 MB, 88% of it done/cancelled history — pitfall 166).");
