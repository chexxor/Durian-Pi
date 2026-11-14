#!/usr/bin/env node
/*
 * stranded-gate-census-6664.mjs - count the stranded gates before choosing a severity (#6664, ruling 1)

lead's order: severity is set by measurement, not asserted. docs/WORK-ITEM-SCHEMA.md:188 declares
`blockedBy-resolves` as an ERROR rule; src/checkup.mjs implements 23 rules and `blockedBy-resolves` is
not among them (verified: node --input-type=module -e "import('./src/checkup.mjs').then(m=>console.log(m.RULES.length, m.RULES.map(r=>r.id).join(',')))" -> 23 ids, none named blockedBy-resolves).
So the rule is declared and unenforced, and its severity cannot be chosen until the population is counted.

Read path is the sanctioned one: src/readclient.mjs readData (broker-served when a broker is alive,
read-only harness fallback otherwise) - the same path tools/held-gate-audit.mjs uses. It reads ACTIVE
rows only, not just parked ones, which is the population the check rule would fire on.

 Run: DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite node tools/probes/stranded-gate-census-6664.mjs
 Exit: 0 if no stranded gate on the snapshot; 1 if there are (count printed).
*/
import { readData } from "../../../src/readclient.mjs";
import { readQueueItems, TERMINAL_QUEUE_STATUSES, activeQueueItems } from "../../../src/readapi.mjs";

const db = process.env.DURIG_DB ?? "./selfdev.sqlite";
const items = await readData(db, "queue", {}, (storage) => readQueueItems(storage));
if (!Array.isArray(items)) {
	console.error("read failed: expected the queue row array");
	process.exit(1);
}

const now = new Date().toISOString();
const statusOf = new Map(items.map((i) => [i.id, i.status]));
const counts = {};
for (const i of items) counts[i.status] = (counts[i.status] ?? 0) + 1;
const active = activeQueueItems(items);

const stranded = [];
for (const item of active) {
	const gate = Array.isArray(item.blockedBy) ? item.blockedBy.filter((n) => Number.isInteger(n) && n > 0) : [];
	if (!gate.length) continue;
	const missing = gate.filter((id) => !statusOf.has(id));
	const cancelled = gate.filter((id) => statusOf.get(id) === "cancelled");
	if (!missing.length && !cancelled.length) continue;
	const authored = item.block ?? null;
	const first = item.transitions?.[0]?.at;
	stranded.push({
		id: item.id,
		status: item.status,
		from: item.from,
		to: item.to,
		missing,
		cancelled,
		hasResolver: Boolean(authored?.resolver),
		hasReviewBy: Boolean(authored?.reviewBy),
		ageDays: first ? Math.floor((Date.now() - Date.parse(first)) / 86400000) : null,
	});
}

const byStatus = {};
for (const s of stranded) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
const gatedActive = active.filter((i) => Array.isArray(i.blockedBy) && i.blockedBy.length).length;
const ages = stranded.map((s) => s.ageDays).filter((n) => n !== null).sort((a, b) => a - b);

console.log(`snapshot ${now}  db ${db}`);
console.log(`rows ${items.length}  statuses ${Object.entries(counts).map(([k, v]) => k + "=" + v).join(", ")}`);
console.log(`active rows carrying a structured gate: ${gatedActive} of ${active.length} active`);
console.log(`STRANDED (active row whose gate names a CANCELLED or non-existent id): ${stranded.length}`);
console.log(`  by status: ${Object.entries(byStatus).map(([k, v]) => k + "=" + v).join(", ")}`);
console.log(`  gate ids naming a non-existent row: ${stranded.reduce((n, s) => n + s.missing.length, 0)}`);
console.log(`  gate ids naming a CANCELLED row: ${stranded.reduce((n, s) => n + s.cancelled.length, 0)}`);
console.log(`  stranded rows whose authored block names a resolver: ${stranded.filter((s) => s.hasResolver).length}`);
console.log(`  stranded rows whose authored block carries a reviewBy: ${stranded.filter((s) => s.hasReviewBy).length}`);
if (ages.length) console.log(`  age (days since first transition): min ${ages[0]}, median ${ages[Math.floor(ages.length / 2)]}, max ${ages[ages.length - 1]}`);
for (const s of stranded.slice(0, 12))
	console.log(`  #${s.id} [${s.status}] ${s.from}->${s.to} dead=${s.dead ? "" : ""}${[...s.cancelled.map((x) => "cancelled#" + x), ...s.missing.map((x) => "missing#" + x)].join(",")} resolver=${s.hasResolver ? "yes" : "no"} reviewBy=${s.hasReviewBy ? "yes" : "no"}`);

const pct = ((stranded.length / active.length) * 100).toFixed(1);
console.log(
	"\nSeverity read: " +
	(stranded.length === 0
		? "no population on this snapshot - the rule may be error from day one."
		: stranded.length > 50
			? `${stranded.length} stranded rows = ${pct}% of active rows. A rule that fires on that many rows on its first run is noise, and noise gets disabled (#3539). Declare it attention/soft in docs/WORK-ITEM-SCHEMA.md, count it, and raise it only as the population falls.`
			: `${stranded.length} stranded rows (${pct}% of active) - bounded enough for error severity.`)
);
process.exit(stranded.length ? 1 : 0);
