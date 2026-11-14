#!/usr/bin/env node
// tools/probes/dead-gate-status-split-6998.mjs - #6998: a "dead gate" count that includes terminal rows
// is not a population. Split it, and split the terminal half by WHEN the parent died relative to the
// child's own claim and completion - that is the difference between inert litter and an enforcement hole.
//
// READ-ONLY. Run: node tools/probes/dead-gate-status-split-6998.mjs --db <path>
// exit 0 = every dead-gate row is inert (parent died after the child finished); 1 = at least one row
// completed AFTER its prerequisite was cancelled, i.e. the gate was not enforced at completion.
import { readData } from "../../src/readclient.mjs";
import { readQueueItems } from "../../src/readapi.mjs";

const DB = process.argv.find((a) => a.startsWith("--db="))?.slice(5) ?? process.env.DURIG_DB ?? "./selfdev.sqlite";
const items = await readData(DB, "queue", {}, (s) => readQueueItems(s));
if (!Array.isArray(items)) { console.error("read failed"); process.exit(2); }

const byId = new Map(items.map((i) => [i.id, i]));
const TERMINAL = new Set(["done", "cancelled"]);
const firstAt = (item, events) => (item.transitions ?? []).find((t) => events.includes(t.event))?.at ?? null;
const anyGate = (i) => (Array.isArray(i.blockedBy) ? i.blockedBy.filter((n) => Number.isInteger(n) && n > 0) : []);
const deadGate = (i) => anyGate(i).find((id) => byId.get(id)?.status === "cancelled") ?? null;

let dead = 0;
const byStatus = {};
const retro = [];   // child completed after the parent was cancelled
const drifted = []; // child was CLAIMED before the parent died, then the gate died
const hole = [];    // child completed after the parent died AND was claimed after the parent died
for (const item of items) {
	const d = deadGate(item);
	if (!d) continue;
	dead++;
	byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
	const parentDeadAt = firstAt(byId.get(d), ["cancelled"]);
	const childDoneAt = firstAt(item, ["done"]);
	const childClaimAt = firstAt(item, ["claimed"]);
	if (childDoneAt && parentDeadAt && childDoneAt > parentDeadAt) {
		retro.push({ id: item.id, status: item.status, parent: d, parentCancelled: parentDeadAt, childDone: childDoneAt, claim: childClaimAt });
		if (childClaimAt && childClaimAt > parentDeadAt) hole.push(item.id);
		else drifted.push(item.id);
	}
}
const live = Object.entries(byStatus).filter(([s]) => !TERMINAL.has(s));
console.log(`snapshot ${new Date().toISOString()}  rows ${items.length}  db ${DB}`);
console.log(`rows carrying a dead (cancelled) gate: ${dead}`);
console.log(`  by their own status: ${Object.entries(byStatus).map(([s, n]) => `${s}=${n}`).join(", ")}`);
console.log(`  LIVE stranded (status not terminal): ${live.reduce((n, [, c]) => n + c, 0)}  -> ${live.map(([s, c]) => `${s}=${c}`).join(", ")}`);
console.log(`  terminal rows carrying a dead gate (inert or evidence): ${dead - live.reduce((n, [, c]) => n + c, 0)}`);
console.log(`  of the terminal rows, parent cancelled AFTER the child was done (inert litter): ${retro.length - hole.length - drifted.length}`);
console.log(`  child completed AFTER the parent was cancelled: ${retro.length}`);
console.log(`    - claimed before the parent died, gate drifted after admission: ${drifted.length}`);
console.log(`    - claimed AFTER the parent died: ${hole.length}  ids: ${hole.join(",")}`);
console.log(`VERDICT: ${retro.length === 0 ? "no enforcement hole: every dead gate died after the child finished" : `ENFORCEMENT SIGNAL: ${retro.length} rows completed after their prerequisite was cancelled (${drifted.length} drifted after admission, ${hole.length} claimed after the cancel)`}`);
console.log(`gate-drift finding: ${drifted.length + hole.length} rows were admitted while their gate was live and became stranded later; nothing re-checks a gate after admission.`);
process.exit(retro.length ? 1 : 0);
