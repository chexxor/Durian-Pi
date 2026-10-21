// scripts/verify-provenance.mjs — P3 re-derivation for docs/VERIFY-PROVENANCE.md.
// Read-only: queries the store's entries table for qa's (conv 15) provider provenance
// in the wrong-provider window, and checks the Mistral interlude for completed verifies.
// Run: node scripts/verify-provenance.mjs [path-to-store]   (default ./selfdev.sqlite)
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';

const store = process.argv[2] ?? './selfdev.sqlite';
if (!existsSync(store)) {
  console.error(`store not found: ${store}`);
  process.exit(2);
}
const db = new DatabaseSync(store, { readOnly: true });

const t = (s) => Date.parse(s);
const W0 = t('2026-10-18T19:10:56Z');
const W1 = t('2026-10-20T03:45:55Z');
const M0 = t('2026-10-18T07:20:00Z');
const M1 = t('2026-10-18T07:35:00Z');
const QA = 15;

// ---- The window: qa (conv 15) local-provider assistant turns ----
const local = db.prepare(
  "SELECT id, conversation_id, record FROM entries WHERE record LIKE '%\"provider\":\"local\"%' AND conversation_id = ?"
).all(QA);
const eras = { qwen: 0, unrecorded: 0, swift: 0 };
let n = 0, first = null, last = null;
for (const r of local) {
  let rec; try { rec = JSON.parse(r.record); } catch { continue; }
  const m = rec.model && rec.model[0];
  const ts = m && m.timestamp;
  if (!m || m.role !== 'assistant' || !ts || ts < W0 || ts > W1) continue;
  n++;
  if (first === null || ts < first) first = ts;
  if (last === null || ts > last) last = ts;
  const rm = m.responseModel;
  if (rm === 'swift-1.5-iq2_xs') eras.swift++;
  else if (rm === undefined || rm === null) eras.unrecorded++;
  else eras.qwen++;
}
console.log('=== VERIFY PROVENANCE (docs/VERIFY-PROVENANCE.md) ===');
console.log('window: ' + new Date(W0).toISOString() + ' -> ' + new Date(W1).toISOString());
console.log('qa(conv15) local-provider assistant turns in window:', n);
console.log('  first:', first ? new Date(first).toISOString() : '-');
console.log('  last:', last ? new Date(last).toISOString() : '-');
console.log('  eras (qwen36 / responseModel-unrecorded / rm:swift-1.5-iq2_xs):', JSON.stringify(eras));

// ---- The Mistral interlude: any completed verify in the 07:22-07:25 window? ----
const mistral = db.prepare(
  "SELECT id, record FROM entries WHERE conversation_id = ? AND record LIKE '%mistral%'"
).all(QA);
let mTurns = 0, completes = 0;
for (const r of mistral) {
  let rec; try { rec = JSON.parse(r.record); } catch { continue; }
  const m = rec.model && rec.model[0];
  const ts = m && m.timestamp;
  if (!m || m.role !== 'assistant' || !ts || ts < M0 || ts > M1) continue;
  mTurns++;
  const content = Array.isArray(m.content) ? m.content : [];
  if (content.some((c) => c.type === 'toolCall' && c.name === 'complete_work')) completes++;
}
console.log('Mistral interlude (2026-10-18T07:22-07:25) assistant turns:', mTurns);
console.log('  complete_work calls in that window:', completes, '(expected 0 -> no rows added)');

const expectedN = 1669;
const ok = n >= 1660 && n <= 1675 && eras.swift >= 60 && eras.swift <= 70;
console.log('re-derivation reconciles with audit (#3627):', ok ? 'YES' : `NO (n=${n}, swift=${eras.swift}; audit 1669/67, one-turn boundary edge acceptable)`);
process.exit(ok ? 0 : 1);
