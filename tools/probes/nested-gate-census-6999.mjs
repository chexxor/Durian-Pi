#!/usr/bin/env node
/* #6999 - magnitude: how many live rows have a gate hop that is DEAD only at depth > 1,
   i.e. the predicate reports `gate-open:#X(queued)` while X itself can never close?
   Reads the queue JSON on stdin:  node cli.mjs queue --json --no-body | node tools/probes/nested-gate-census-6999.mjs
   Exit 0 always; it is a census, not a gate. */
import { readFileSync } from "node:fs";
const raw = readFileSync(0, "utf8");
const doc = JSON.parse(raw.slice(raw.indexOf("{")));
const items = doc.items ?? [];
const byId = new Map(items.map((it) => [it.id, it]));
const TERMINAL = new Set(["done", "cancelled"]);

// depth-1 verdict, exactly as src/rig.mjs workable() computes it
function d1(item) {
  for (const id of item.blockedBy ?? []) {
    const t = byId.get(id);
    if (!t) continue;
    if (t.status === "done") continue;
    return { ok: false, reason: t.status === "cancelled" ? `gate-cancelled:#${id}` : `gate-open:#${id}(${t.status})` };
  }
  return { ok: true, reason: null };
}

// transitive walk: can this row EVER become claimable? bounded, cycle-guarded
const MAX_DEPTH = 8;
function closable(item, depth = 0, seen = new Set()) {
  if (depth > MAX_DEPTH) return { ok: null, hop: `depth>${MAX_DEPTH}` };
  for (const id of item.blockedBy ?? []) {
    const t = byId.get(id);
    if (!t) continue;
    if (t.status === "done") continue;
    if (t.status === "cancelled") return { ok: false, hop: `#${id} cancelled` };
    if (seen.has(id)) return { ok: false, hop: `#${id} cycle` };
    seen.add(id);
    const r = closable(t, depth + 1, seen);
    if (!r.ok) return { ok: false, hop: `#${id}(${t.status}) -> ${r.hop}` };
  }
  return { ok: true, hop: null };
}

let open = 0, deadDirect = 0, nestedDead = 0, cycles = 0, unresolvable = 0, gated = 0;
const examples = [];
for (const it of items) {
  if (!(it.blockedBy ?? []).length) continue;
  gated++;
  const v = d1(it);
  if (v.ok) continue;
  if (v.reason.startsWith("gate-cancelled")) { deadDirect++; continue; }
  open++;
  const c = closable(it);
  if (c.ok === null) { unresolvable++; continue; }
  if (!c.ok) {
    if (/cycle/.test(c.hop)) cycles++;
    nestedDead++;
    if (examples.length < 12) examples.push(`#${it.id} (${it.to}) reason=${v.reason} chain=${c.hop}`);
  }
}
console.log(`rows scanned: ${items.length}; rows with a gate: ${gated}`);
console.log(`gate-open at depth 1: ${open}`);
console.log(`  of those, permanently uncloseable (a hop is cancelled or the chain cycles): ${nestedDead}`);
console.log(`  reported by the predicate as a cycle: ${cycles}`);
console.log(`  chain deeper than ${MAX_DEPTH}: ${unresolvable}`);
console.log(`gate directly on a cancelled row: ${deadDirect}`);
console.log("examples:");
for (const e of examples) console.log("  " + e);
process.exit(0);
