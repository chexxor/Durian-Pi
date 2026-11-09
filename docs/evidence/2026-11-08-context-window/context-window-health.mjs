#!/usr/bin/env node
// delegate probe: context-window health from the store. Read-only, no model spend, broker-down safe.
// (1) generation outcomes in a window, (2) compaction events and their shape, (3) incomplete-summary hits.
// usage: node .spike/delegate/context-window-health.mjs [--since-min 720]
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.env.DURIG_DB || "./selfdev.sqlite", { readOnly: true });
const sinceMin = Number(process.argv.find((a) => a.startsWith("--since-min="))?.split("=")[1] ?? 720);
const cutoff = Date.now() - sinceMin * 60000;

const kinds = db.prepare("select kind, count(*) n from tasks group by kind order by n desc").all();
console.log("kinds (all time):", kinds.map((k) => `${k.kind}=${k.n}`).join(" "));

const gens = db.prepare(`select json_extract(record,'$.conversationId') conv,
  json_extract(record,'$.state.outcome.status') outcome, json_extract(record,'$.startedAt') startedAt
  from tasks where kind='"pi.generation"' and startedAt >= ?`).all(cutoff);
const byConv = new Map();
for (const g of gens) {
  const r = byConv.get(g.conv) ?? { ok: 0, failed: 0 };
  if (g.outcome === "completed") r.ok++; else r.failed++;
  byConv.set(g.conv, r);
}
console.log(`generations in last ${sinceMin} min: ${gens.length}  completed=${gens.filter((g) => g.outcome === "completed").length} failed=${gens.filter((g) => g.outcome === "failed").length} aborted=${gens.filter((g) => g.outcome === "aborted").length} in-flight=${gens.filter((g) => g.outcome == null).length}`);
for (const [conv, r] of [...byConv.entries()].sort((a, b) => b[1].failed - a[1].failed).slice(0, 15)) console.log(`  conv ${conv}: ok=${r.ok} failed=${r.failed}`);

const comp = db.prepare(`select json_extract(record,'$.conversationId') conv,
  substr(json_extract(record,'$.state'),1,220) state, json_extract(record,'$.startedAt') startedAt
  from tasks where kind='"pi.compaction"' order by id desc limit 12`).all();
console.log("\nlast 12 compaction records:");
for (const c of comp) console.log(`  conv=${c.conv} ts=${new Date(c.startedAt).toISOString()} ${c.state}`);

const hits = db.prepare(`select count(*) n from tasks where record like '%hit the token limit%'`).get();
const anyComp = db.prepare("select count(*) n from tasks where kind='\"pi.compaction\"'").get();
console.log(`\n'hit the token limit' occurrences (all time): ${hits.n};  total pi.compaction records: ${anyComp.n}`);
