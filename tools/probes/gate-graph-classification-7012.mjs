#!/usr/bin/env node
/* #7012 - does "can never resolve" mean the same thing at depth 1 and transitively,
   and do the two instruments agree? Reads the read-seam dump given as argv[2].
   exit 1 if a row is stranded by a chain the depth-1 census cannot see.
   exit 0 but prints the bucket split: the acceptance test counts PARKED gates and VOID gates
   as one number, which is the defect this probe names. */
import { readFileSync } from "node:fs";

const dump = JSON.parse(readFileSync(process.argv[2] || "queue-dump.json", "utf8"));
const items = dump.items ?? [];
const byId = new Map(items.map((it) => [it.id, it]));
const gated = items.filter((it) => Array.isArray(it.blockedBy) && it.blockedBy.length > 0);

// lead's / #6782 rule, verbatim: depth-1 status test
const deadGate = (it) => it.blockedBy.some((id) => byId.get(id)?.status === "cancelled");
const stuckLive = (it) => it.blockedBy.some((id) => ["held", "deferred"].includes(byId.get(id)?.status));
const depth1 = gated.filter((it) => deadGate(it) || stuckLive(it));

// transitive: can this row EVER be claimed? path-based DFS -> a true cycle is a node on its own path.
const MAX_DEPTH = 8;
function closable(item, depth, path) {
  if (depth > MAX_DEPTH) return { ok: null, why: `depth>${MAX_DEPTH}` };
  for (const id of item.blockedBy ?? []) {
    const t = byId.get(id);
    if (!t) continue;                 // dangling: conservative default, no edge
    if (t.status === "done") continue;
    if (t.status === "cancelled") return { ok: false, why: `#${id} cancelled` };
    if (path.has(id)) return { ok: false, why: `#${id} is a real cycle` };
    path.add(id);
    const r = closable(t, depth + 1, path);
    path.delete(id);
    if (!r.ok) return { ok: false, why: `#${id}(${t.status}) -> ${r.why}` };
  }
  return { ok: true, why: null };
}

const transitive = gated.filter((it) => closable(it, 0, new Set([it.id])).ok === false);
const missed = transitive.filter((it) => !depth1.includes(it));
const realCycles = gated.filter((it) => (it.blockedBy ?? []).some((id) => {
  // an edge back to an ancestor reachable from id
  const seen = new Set();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === it.id) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const nxt of byId.get(cur)?.blockedBy ?? []) if (byId.get(nxt)) stack.push(nxt);
  }
  return false;
}));

console.log(`rows: ${items.length}; gated rows: ${gated.length}`);
console.log(`never-resolvable by the DEPTH-1 rule (#6782 census): ${depth1.length}`);
console.log(`never-resolvable by the TRANSITIVE walk:            ${transitive.length}`);
console.log(`rows the depth-1 rule misses:                       ${missed.length}`);
for (const it of missed.slice(0, 15)) console.log(`  miss #${it.id} to=${it.to} blockedBy=${JSON.stringify(it.blockedBy)} why=${closable(it, 0, new Set([it.id])).why}`);
console.log(`rows in a REAL cycle (path-based DFS): ${realCycles.length}`);

// how many rows would the naive shared-visited-set walk call a cycle? (the #6999 instrument)
function naiveCycleProne(item) {
  const walk = (it, depth, seen) => {
    if (depth > MAX_DEPTH) return null;
    for (const id of it.blockedBy ?? []) {
      const t = byId.get(id);
      if (!t) continue;
      if (t.status === "done") continue;
      if (t.status === "cancelled") return "cancelled";
      if (seen.has(id)) return "cycle";      // shared set: a diamond reads as a cycle
      seen.add(id);
      const r = walk(t, depth + 1, seen);
      if (r) return r;
    }
    return null;
  };
  return walk(item, 0, new Set([item.id])) === "cycle";
}
const naive = gated.filter(naiveCycleProne);
console.log(`rows the SHARED-SET walk calls a cycle: ${naive.length} (real cycles: ${realCycles.length}) -> ${naive.length - realCycles.length} are diamonds misread as cycles`);
// bucket the 156: which are truly VOID, and which are merely PARKED?
const endsInCancelled = (item, depth = 0, path = new Set([item.id])) => {
  if (depth > MAX_DEPTH) return false;
  for (const id of item.blockedBy ?? []) {
    const t = byId.get(id);
    if (!t) continue;
    if (t.status === "done") continue;
    if (t.status === "cancelled") return true;
    if (path.has(id)) continue;
    path.add(id);
    if (endsInCancelled(t, depth + 1, path)) return true;
    path.delete(id);
  }
  return false;
};
const nestedVoid = gated.filter((it) => !deadGate(it) && endsInCancelled(it));
const parkedOnly = gated.filter((it) => stuckLive(it) && !endsInCancelled(it));
console.log(`buckets of the ${depth1.length}: directly cancelled ${gated.filter(deadGate).length}; parked hop that can resolve ${parkedOnly.length}; NESTED VOID (no cancelled hop at depth 1, the chain ends in a cancelled row) ${nestedVoid.length}`);
for (const it of nestedVoid.slice(0, 12)) console.log(`  nested void #${it.id} to=${it.to} blockedBy=${JSON.stringify(it.blockedBy)}`);
// D282 clause (2): "parked AND no authored block AND reviewBy absent/past". How many of the
// 95 stuck-live gates can that rule actually reach, and how many does it dead-lock?
const now = new Date().toISOString();
const parkedNoBlock = (t) => t.status === "held" && (!t.block || t.block.source === "legacy") && (!t.block?.reviewBy || t.block.reviewBy <= now);
const stuckTargets = new Set();
for (const it of gated) for (const id of it.blockedBy ?? []) {
  const t = byId.get(id);
  if (t && (t.status === "held" || t.status === "deferred")) stuckTargets.add(t);
}
const reachable = [...stuckTargets].filter(parkedNoBlock);
const authored = [...stuckTargets].filter((t) => t.block && t.block.source !== "legacy");
const authoredButChainDead = authored.filter((t) => endsInCancelled(t));
console.log(`parked gate TARGETS: ${stuckTargets.size}; reachable by D282 clause 2 (no authored block, reviewBy absent/past): ${reachable.length}; authored: ${authored.length}; authored BUT their own chain ends in a cancelled row -> the rule refuses the removal and the chain can never close: ${authoredButChainDead.length}`);
console.log(`  e.g. ${authoredButChainDead.slice(0, 6).map((t) => `#${t.id}(${t.status}) resolver=${t.block?.resolver ?? "none"}`).join(", ")}`);

console.log("\nVERDICT:", missed.length ? "RED: the acceptance metric undercounts the stranded population" : "GREEN: depth-1 never-resolvable is a superset of the transitive set (no row is missed)");
console.log(`  but the metric is not achievable as written: ${parkedOnly.length} of the ${depth1.length} are parked, not void; clearing them is a scope decision, not a repair.`);
process.exit(missed.length ? 1 : 0);
