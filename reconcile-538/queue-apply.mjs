// queue-apply.mjs — reconstruct durig's queue document from its stored base+delta revisions.
//
// GROUNDING (do not take this script's word for it; verify):
// - The live store is the SQLite DB named by durig's config (DURIG_DB). Copy it (+ -wal/-shm)
//   before reading so the live broker is never blocked or mutated.
// - The queue document is a pi-durable document (kind "durig.queue"); its full state is stored in
//   document_revisions as a base revision plus ordered delta revisions.
// - Deltas are chord delta ops; the format and application are REUSED from @earendil-works/chord's
//   own applyImmutable (see node_modules/@earendil-works/chord/dist/delta/apply-immutable-trusted.js),
//   not reimplemented here.
//
// USAGE:  node reconcile-538/queue-apply.mjs <db-copy.sqlite> <out.json> [itemIds csv]
//   e.g.  node reconcile-538/queue-apply.mjs "$env:TEMP\durig-dbcopy\selfdev.sqlite" queue.json 538,610,632,503,549
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';

const seatRootFromFile = new URL('..', import.meta.url); // <worktree>/
const chordUrl = new URL('./node_modules/@earendil-works/chord/dist/delta/index.js', seatRootFromFile);
const { applyImmutable } = await import(chordUrl.href);

const [dbPath, outPath, wantedCsv] = process.argv.slice(2);
if (!dbPath || !outPath) {
  console.error('usage: node reconcile-538/queue-apply.mjs <db-copy.sqlite> <out.json> [itemIds csv]');
  process.exit(2);
}

const db = new DatabaseSync(dbPath, { readOnly: true });

const docRow = db.prepare("SELECT id FROM documents WHERE kind='\"durig.queue\"'").get();
if (!docRow) throw new Error('no durig.queue document in this store');
const queueDocId = docRow.id;

const baseRow = db.prepare(
  "SELECT seq, content FROM document_revisions WHERE document_id = ? AND kind = 'base' ORDER BY seq DESC LIMIT 1"
).get(queueDocId);
let doc = JSON.parse(baseRow.content);

const deltas = db.prepare(
  "SELECT seq, content FROM document_revisions WHERE document_id = ? AND kind = 'delta' AND seq > ? ORDER BY seq"
).all(queueDocId, baseRow.seq);

let applied = 0;
let lastSeq = baseRow.seq;
for (const d of deltas) {
  const ops = JSON.parse(d.content);
  doc = applyImmutable(doc, ops);
  applied++;
  lastSeq = d.seq;
}

writeFileSync(outPath, JSON.stringify(doc, null, 1), 'utf8');
console.log(`durig.queue doc=${queueDocId} base@seq=${baseRow.seq} deltas+${applied} through=${lastSeq} nextId=${doc.nextId} items=${doc.items.length}`);

if (wantedCsv) {
  const wanted = new Set(wantedCsv.split(',').map(Number));
  for (const it of doc.items) {
    if (wanted.has(it.id)) {
      const f = `queue-item-${it.id}.json`;
      writeFileSync(f, JSON.stringify(it, null, 1), 'utf8');
      console.log(`${f}: from=${it.from} to=${it.to} status=${it.status}`);
    }
  }
}
db.close();
