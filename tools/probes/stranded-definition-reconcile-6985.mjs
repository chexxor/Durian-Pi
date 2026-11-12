#!/usr/bin/env node
// tools/probes/stranded-definition-reconcile-6985.mjs — #6985: two instruments both print "23",
// and neither prints what it counted. Establish whether they are the same 23 rows.
//
// READ-ONLY. Run: node tools/probes/stranded-definition-reconcile-6985.mjs --db <path>
// exit 0 = the two definitions agree on the same id set; 1 = they do not (the sets are printed).
import { readData } from "../../src/readclient.mjs";
import { readQueueItems } from "../../src/readapi.mjs";

const DB = process.argv.find((a) => a.startsWith("--db="))?.slice(5) ?? process.env.DURIG_DB ?? "./selfdev.sqlite";
const items = await readData(DB, "queue", {}, (s) => readQueueItems(s));
if (!Array.isArray(items)) { console.error("read failed"); process.exit(2); }

const statusOf = new Map(items.map((i) => [i.id, i.status]));
const gate = (i) => (Array.isArray(i.blockedBy) ? i.blockedBy.filter((n) => Number.isInteger(n) && n > 0) : []);
const ACTIVE = new Set(["queued", "held", "deferred", "claimed"]);
const PARKED = new Set(["held", "deferred"]);

// A: the census definition (#6806) - ACTIVE row whose gate names a CANCELLED or non-existent id.
const A = items.filter((i) => ACTIVE.has(i.status) && gate(i).some((id) => !statusOf.has(id) || statusOf.get(id) === "cancelled"));
// B: the workable-impact definition (#6825) - a row workable() would REFUSE because a gate is not done:
//    cancelled OR still open (queued/held/deferred/claimed). Unknown ids are NOT refusals (fail-open, rig.mjs:329).
const B = items.filter((i) => gate(i).some((id) => statusOf.has(id) && statusOf.get(id) !== "done"));
// C: the narrowest one - PARKED rows carrying at least one CANCELLED gate (the "14 held + 9 deferred" shape).
const C = items.filter((i) => PARKED.has(i.status) && gate(i).some((id) => statusOf.get(id) === "cancelled"));

const ids = (rows) => rows.map((r) => r.id).sort((a, b) => a - b);
const set = (rows) => new Set(rows.map((r) => r.id));
const setA = set(A), setB = set(B), setC = set(C);
const inter = [...setA].filter((x) => setB.has(x)).sort((a, b) => a - b);
const sym = [...setA].filter((x) => !setB.has(x)).concat([...setB].filter((x) => !setA.has(x))).sort((a, b) => a - b);

console.log(`snapshot ${new Date().toISOString()}  rows=${items.length}`);
console.log(`A census (active + gate cancelled-or-missing): ${A.length}  ids: ${ids(A).join(",")}`);
console.log(`B workable-refusal (any gate not done):       ${B.length}  ids: ${ids(B).join(",")}`);
console.log(`C parked-with-cancelled-gate:                 ${C.length}  ids: ${ids(C).join(",")}`);
const missing = items.filter((i) => ACTIVE.has(i.status) && gate(i).some((id) => !statusOf.has(id)));
const openOnly = items.filter((i) => ACTIVE.has(i.status) && gate(i).length && !gate(i).some((id) => !statusOf.has(id) || statusOf.get(id) === "cancelled"));
console.log(`  of A: gate names a NON-EXISTENT id in ${missing.length} row(s); cancelled-only in ${A.length - missing.length}`);
console.log(`  of B minus A: gates that are still legitimately OPEN (${openOnly.length} active rows waiting on live rows)`);
console.log(`A & C intersection: ${[...setA].filter((x) => setC.has(x)).length} of ${A.length} / ${C.length}; symmetric difference: ${[...setA].filter((x) => !setC.has(x)).concat([...setC].filter((x) => !setA.has(x))).length}`);
console.log(`A & B intersection: ${inter.length}  symmetric difference: ${sym.length}  ids: ${sym.join(",")}`);
const same = A.length === C.length && [...setA].every((x) => setC.has(x));
console.log(`VERDICT: ${same
	? `SAME population - the census and the parked-gate-cancelled bucket are the same ${A.length} rows (${ids(A).join(",")})`
	: "DIFFERENT populations - the instruments are counting different things"}`);
console.log(`TRAP: definition B ("a gate that is not closed") = ${B.length} rows, ${B.length - A.length} of them waiting on a LIVE row. Anyone quoting ${B.length} as stranded gates is counting legitimate waiting.`);
process.exit(same ? 0 : 1);
