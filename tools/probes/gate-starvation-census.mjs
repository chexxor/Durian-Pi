#!/usr/bin/env node
/*
 * gate-starvation-census.mjs — measure every `blockedBy` gate on the CURRENT store and report
 * what each gate resolves to (#6215).
 *
 * Question: `workable()` (#2673) refuses a row whose gate names a CANCELLED id forever, and nothing
 * at enqueue time stops such a gate from being written. How many rows are actually starved right now,
 * and which of them are starved by a CONTAINER (umbrella) row rather than by work?
 *
 * Read-only: it goes through src/readapi.mjs / src/readclient.mjs, the same path `cli.mjs queue`
 * uses, so it never opens a harness and never schedules (D11).
 *
 * Run: node tools/probes/gate-starvation-census.mjs [--db <path>]   (exit 0; the counts are the finding)
 */
import { readData } from "../../src/readclient.mjs";
import { gateView, parkOf } from "../../src/queue-lifecycle.mjs";

const args = process.argv.slice(2);
let db = process.env.DURIG_DB || "./rig.sqlite";
for (let i = 0; i < args.length; i += 1) {
	if (args[i] === "--db") db = args[i + 1];
}

const raw = await readData(db, "queue", {}, (storage) => import("../../src/readapi.mjs").then((r) => r.readQueueItems(storage)));
const items = Array.isArray(raw) ? raw : raw?.items ?? [];

const byId = new Map(items.map((it) => [it.id, it]));
const statusOf = (id) => byId.get(id)?.status ?? "absent";

// Every gate this store records: the structured `blockedBy` plus any `queue` constraint.
const gates = [];
for (const it of items) {
	for (const id of gateView(it).blockedBy ?? []) gates.push({ from: it.id, to: id, row: it });
}

const histogram = {};
for (const g of gates) histogram[statusOf(g.to)] = (histogram[statusOf(g.to)] ?? 0) + 1;

console.log(`rows in the store: ${items.length}`);
console.log(`gate references recorded: ${gates.length}`);
console.log(`gate target status histogram: ${JSON.stringify(histogram)}`);

/* 1. STARVING gates: the target is terminal-closed and can never become `done`. */
const starving = gates.filter((g) => statusOf(g.to) === "cancelled");
console.log(`\nSTARVING gates (target CANCELLED): ${starving.length}`);
for (const g of starving) {
	console.log(
		`  #${g.from} [${g.row.status}] -> gate #${g.to} is cancelled; the row can never be claimed (workable reason: gate-cancelled:#${g.to})`,
	);
}

/* 2. CATEGORY ERROR: a gate whose target is a CONTAINER/registration rather than a unit of work.
 * Structurally: the target is parked, names no work of its own (no `requires`, no gate it is waiting
 * on), and its park is a rule/backlog registration rather than gated work. */
const containers = gates.filter((g) => {
	const target = byId.get(g.to);
	if (!target) return false;
	const park = parkOf(target, { statusOf });
	return target.status === "held" && (park.class === "rule" || target.block?.reason === "backlog");
});
console.log(`\nGates naming a parked REGISTRATION (container as a gate): ${containers.length}`);
for (const g of containers) {
	const target = byId.get(g.to);
	const park = parkOf(target, { statusOf });
	console.log(`  #${g.from} [${g.row.status}] -> gate #${g.to} "${target.subject.slice(0, 60)}" park class ${park.class}`);
}

/* 3. Gates whose target never existed: the conservative default says WORKABLE, so a typo un-gates work. */
const dangling = gates.filter((g) => statusOf(g.to) === "absent");
console.log(`\nGates naming an id that does not exist in the store: ${dangling.length}`);
for (const g of dangling.slice(0, 20)) console.log(`  #${g.from} -> #${g.to} absent`);

/* 4. Self-gates and cycles: permanent deadlock nobody names as such. */
const selfGated = items.filter((it) => (it.blockedBy ?? []).includes(it.id));
console.log(`\nSelf-gated rows: ${selfGated.length}`);
for (const it of selfGated) console.log(`  #${it.id} gates on itself`);

const queued = items.filter((it) => it.status === "queued");
console.log(`\nqueued rows total: ${queued.length}; of those, rows whose gate is dead: ${starving.filter((g) => g.row.status === "queued").length}`);
