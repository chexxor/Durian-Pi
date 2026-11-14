#!/usr/bin/env node
/*
 * #7038 census - the live population the gate-authority predicate has to cover, measured on the
 * running store (DURIG_DB), not quoted from another seat. Read-only.
 * Run: DURIG_DB=<store> node tools/probes/gate-authority-census-7038.mjs
 */
import { execSync } from "node:child_process";

const raw = execSync("node cli.mjs queue --json --no-body", { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const items = JSON.parse(raw).items;
const byId = new Map(items.map((i) => [i.id, i]));
const TERMINAL = new Set(["done", "cancelled"]);

let held = 0, heldNoBlock = 0, heldSynthesizedPm = 0;
let gated = 0, dangling = 0, selfGate = 0, gateOnCancelled = 0, gateOnHeldOrDeferred = 0, cycles = 0;
const cycleExamples = [], strandedExamples = [], danglingExamples = [];

for (const it of items) {
  if (it.status === "held") {
    held++;
    if (!it.block) {
      heldNoBlock++;
      if (it.from !== "pm" && it.to !== "pm") heldSynthesizedPm++;
    }
  }
  const ids = it.blockedBy ?? [];
  if (!ids.length || TERMINAL.has(it.status)) continue;
  gated++;
  for (const id of ids) {
    const t = byId.get(id);
    if (!t) { dangling++; if (danglingExamples.length < 3) danglingExamples.push(`#${it.id} -> #${id} (absent)`); continue; }
    if (id === it.id) { selfGate++; continue; }
    if (t.status === "cancelled") { gateOnCancelled++; if (strandedExamples.length < 3) strandedExamples.push(`#${it.id} -> #${id} (cancelled)`); continue; }
    if (t.status === "held" || t.status === "deferred") gateOnHeldOrDeferred++;
    // two-node cycle: it names t and t names it
    if ((t.blockedBy ?? []).includes(it.id) && cycles === 0) cycleExamples.push(`#${it.id} <-> #${id}`);
    if ((t.blockedBy ?? []).includes(it.id)) cycles++;
  }
}

console.log(`store snapshot: ${items.length} rows`);
console.log(`held: ${held}; without an authored block: ${heldNoBlock}; of those, pm is not a party (so legacyBlock() synthesizes resolver "pm"): ${heldSynthesizedPm}`);
console.log(`non-terminal rows carrying a gate: ${gated}`);
console.log(`gate references: dangling (target absent): ${dangling}; self-gate: ${selfGate}; on a CANCELLED target: ${gateOnCancelled}; on a held/deferred target: ${gateOnHeldOrDeferred}; two-node cycles: ${cycles}`);
console.log(`examples: ${[...danglingExamples, ...strandedExamples, ...cycleExamples].join(", ") || "none"}`);
console.log(`\nFALSIFIER: ${dangling + selfGate + gateOnCancelled + cycles > 0 ? "RED - mint accepted references that can never resolve" : "GREEN - every recorded gate reference resolves to a live row"}`);
process.exit(dangling + selfGate + gateOnCancelled + cycles > 0 ? 1 : 0);
