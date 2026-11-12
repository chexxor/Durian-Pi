#!/usr/bin/env node
/*
 * gate-authority-census-6782.mjs — the numbers behind lead's amendment of D261.
 *
 * Input is the sanctioned read seam's own answer, not a second opener on the store:
 *   DURIG_DB=<store> node cli.mjs queue --no-body > /tmp/queue-dump.json
 *   node tools/probes/gate-authority-census-6782.mjs /tmp/queue-dump.json
 * (A probe that opens the live store with a different pi-durable version fails on the schema —
 *  measured: "Durable SQLite schema version 2 is newer than supported version 1". Reads go through
 *  the broker's read API, D111/D272.)
 *
 * It answers:
 *   1. how many rows are stranded by a DEAD gate (gate names a cancelled row);
 *   2. how many are gated on a row that will never resolve (held/deferred);
 *   3. whether the rig records gate edits at all, so a removal can be attributed;
 *   4. whether a standing predicate exists that reads the authored block rather than an inference.
 * exit 1 while the classes exist and no verb can clear them.
 */
import { readFileSync } from "node:fs";

const dump = JSON.parse(readFileSync(process.argv[2], "utf8"));
const items = dump.items ?? [];
const byId = new Map(items.map((it) => [it.id, it]));

const party = (it, seat) => it.from === seat || it.to === seat;
const gated = items.filter((it) => Array.isArray(it.blockedBy) && it.blockedBy.length > 0);
const held = items.filter((it) => it.status === "held");
const authored = held.filter((it) => it.block && it.block.source !== "legacy");
const legacyHeld = held.filter((it) => !it.block || it.block.source === "legacy");
const deadGate = (it) => it.blockedBy.some((id) => { const t = byId.get(id); return t && t.status === "cancelled"; });
const stuckLive = (it) => it.blockedBy.some((id) => { const t = byId.get(id); return t && (t.status === "held" || t.status === "deferred"); });
const missingGate = (it) => it.blockedBy.some((id) => !byId.has(id));
const selfGate = (it) => it.blockedBy.includes(it.id);
const cycle = (it) => it.blockedBy.some((id) => (byId.get(id)?.blockedBy ?? []).includes(it.id));
const gateEvents = items.filter((it) => (it.transitions ?? []).some((t) => t.event === "gated" || t.event === "ungated"));

console.log(`dump: ${items.length} rows, statuses ${JSON.stringify(items.reduce((a, it) => (a[it.status] = (a[it.status] ?? 0) + 1, a), {}))}`);
console.log(`  gated rows: ${gated.length}`);
console.log(`  gated by a CANCELLED row (dead gate, unrepairable today): ${gated.filter(deadGate).length}`);
console.log(`  gated by a row that is HELD or DEFERRED (live, but never resolving): ${gated.filter(stuckLive).length}`);
console.log(`  gated on a nonexistent id: ${gated.filter(missingGate).length}`);
console.log(`  gated on itself: ${gated.filter(selfGate).length}`);
console.log(`  in a two-row cycle: ${gated.filter(cycle).length}`);
console.log(`  gated on a target that can NEVER resolve (cancelled or parked): ${gated.filter((it) => deadGate(it) || stuckLive(it)).length} of ${gated.length} gated rows`);
console.log(`  rows carrying a gated/ungated transition event: ${gateEvents.length}`);
console.log(`  held rows: ${held.length}; authored block: ${authored.length}; no authored block: ${legacyHeld.length}`);
console.log(`  held rows with no authored block where pm is not a party: ${legacyHeld.filter((it) => !party(it, "pm")).length}`);

const rig = readFileSync(new URL("../../src/rig.mjs", import.meta.url), "utf8");
const lifecycle = readFileSync(new URL("../../src/queue-lifecycle.mjs", import.meta.url), "utf8");
const failures = [];
if (!rig.includes("gate_work"))
	failures.push(`no gate-edit verb exists: ${gated.filter(deadGate).length} rows are stranded by a dead gate and the only verb that changes their state is cancel (terminal)`);
if (gateEvents.length === 0 && !rig.includes("ungated"))
	failures.push("the rig writes no gated/ungated event, so a removal can never be attributed to an author");
if (/resolver: claimed \? item\.to : "pm"/.test(lifecycle))
	failures.push('legacyBlock invents resolver "pm" (src/queue-lifecycle.mjs:256): standing derived from an inference the record cannot show');

console.log(failures.length ? `\nRESULT: RED - ${failures.length}` : "\nRESULT: GREEN");
for (const f of failures) console.log(`  GAP  ${f}`);
process.exit(failures.length ? 1 : 0);
