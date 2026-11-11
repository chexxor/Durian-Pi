#!/usr/bin/env node
/*
 * checkpoint-bound-size-leg.mjs — the leg the checkpoint gate is missing (#6306 acceptance, #6466).

   The ruling keyed the hot queue doc on a bound (200 deltas) and prohibited keying on the verb class.
   The gate proves that at ONE value size. A bound is a comparison between "re-apply N deltas" and
   "write a fresh base", and both sides depend on how big the value is - so a single constant cannot be
   right for every doc. This probe measures three size classes and asserts the shape of the result:

     1. in every class the bound must beat `never` on read time, or it is decoration;
     2. the best bound must NOT decrease as the value grows (a global constant is wrong somewhere);
     3. the verb-class prohibition must be stated with its size condition: for a small value,
        checkpointing every verb is cheaper AND faster than never checkpointing at all.

   Exit 1 while any assertion fails. Run: node tools/probes/checkpoint-bound-size-leg.mjs
   No model, no key, no broker. Numbers belong to THIS tree's dependency set (read from the header).
*/
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { defineDoc } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

const VERBS = Number(process.env.PROBE_VERBS ?? 1000);
const CYCLE = ["claimed", "deferred", "claimed", "held", "queued", "claimed", "done", "cancelled"];

// size classes: (items, body bytes) -> approximate merged value size
const CLASSES = [
	{ name: "small (a note)", items: 20, body: 50 },
	{ name: "medium (one seat's doc)", items: 500, body: 240 },
	{ name: "large (the queue mirror)", items: 5000, body: 1200 },
];

async function run(items, body, predicate) {
	const doc = defineDoc({
		kind: "probe.size",
		version: 1,
		scope: "session",
		initial: () => ({
			nextId: items + 1,
			items: Array.from({ length: items }, (_, i) => ({
				id: i + 1,
				from: "pm", to: "impl", subject: `item ${i + 1}`,
				body: "x".repeat(body),
				status: "queued",
				transitions: [{ at: "2026-11-10T00:00:00Z", event: "enqueued", by: "pm" }],
			})),
		}),
		checkpointWhen: predicate,
	}, BACKGROUND_CONTEXT);

	const dir = mkdtempSync(join(tmpdir(), "checkpoint-size-"));
	const dbPath = join(dir, "probe.sqlite");
	const storage = await openNodeSqliteStorage(dbPath);
	const models = createModels();
	models.setProvider(fauxProvider({ models: [{ id: "faux-seat" }] }).provider);
	const registry = createRegistry();
	const harness = await Harness.open(storage, { models, registry }, BACKGROUND_CONTEXT);

	await harness.commit(async (tx) => { await tx.doc(doc); }, BACKGROUND_CONTEXT);

	const t0 = process.hrtime.bigint();
	for (let i = 0; i < VERBS; i++) {
		await harness.commit(async (tx) => {
			const q = await tx.doc(doc);
			q.items[i % items].status = CYCLE[i % CYCLE.length];
		}, BACKGROUND_CONTEXT);
	}
	const writeMs = Number(process.hrtime.bigint() - t0) / 1e6;

	const rec = await storage.findDocument({ kind: "probe.size", scope: { kind: "session" } }, "current", BACKGROUND_CONTEXT);
	const reads = [];
	let value;
	for (let i = 0; i < 15; i++) {
		const t = process.hrtime.bigint();
		const m = await storage.document(rec.id, "current", BACKGROUND_CONTEXT);
		value = m.value;
		reads.push(Number(process.hrtime.bigint() - t) / 1e6);
	}
	reads.sort((a, b) => a - b);
	const storeBytes = statSync(dbPath).size;
	await storage.close();
	rmSync(dir, { recursive: true, force: true });
	return {
		valueBytes: JSON.stringify(value ?? {}).length,
		readMsMedian: Number(reads[7].toFixed(2)),
		writeMsTotal: Number(writeMs.toFixed(1)),
		storeBytes,
	};
}

const rows = [];
for (const cls of CLASSES) {
	const policies = {
		never: () => false,
		everyVerb: () => true,
		bound50: (_v, _o, info) => info.deltasSinceBase >= 50,
		bound200: (_v, _o, info) => info.deltasSinceBase >= 200,
	};
	const r = {};
	for (const [name, p] of Object.entries(policies)) r[name] = await run(cls.items, cls.body, p);
	rows.push({ class: cls.name, ...r });
}

const pin = JSON.parse(await import("node:fs").then((f) => f.readFileSync(join(process.cwd(), "node_modules/@earendil-works/pi-durable/package.json"), "utf8")));
console.log(`probe header: pi-durable ${pin.version}, node ${process.version}, ${VERBS} verbs per policy`);
for (const r of rows) {
	console.log(`  ${r.class.padEnd(24)} store=${String(r.never.storeBytes).padEnd(9)}B  read median: never=${r.never.readMsMedian} everyVerb=${r.everyVerb.readMsMedian} b50=${r.bound50.readMsMedian} b200=${r.bound200.readMsMedian} | write total: never=${r.never.writeMsTotal} everyVerb=${r.everyVerb.writeMsTotal} b50=${r.bound50.writeMsTotal} b200=${r.bound200.writeMsTotal} ms`);
}

const failures = [];
const gate = (cond, claim) => { if (!cond) failures.push(claim); };

// 1. the bound must beat never in EVERY size class, else it is decoration for that doc.
for (const r of rows) gate(r.bound200.readMsMedian < r.never.readMsMedian, `${r.class}: bound 200 read ${r.bound200.readMsMedian} ms is not better than never ${r.never.readMsMedian} ms`);

// 2. the best (fastest-read) bound must not shrink as the value grows.
const bestBound = (r) => [["b50", r.bound50], ["b200", r.bound200]].sort((a, b) => a[1].readMsMedian - b[1].readMsMedian)[0][0];
const order = { b50: 1, b200: 2 };
for (let i = 1; i < rows.length; i++) {
	const prev = bestBound(rows[i - 1]), cur = bestBound(rows[i]);
	gate(order[cur] >= order[prev], `best bound decreases from ${prev} (${rows[i - 1].class}) to ${cur} (${rows[i].class}) - a single global bound cannot be correct for both`);
}

// 3. a declared bound must fit the write slack in the class it is declared for.
for (const r of rows) {
	const ratio = r.bound200.writeMsTotal / r.never.writeMsTotal;
	gate(ratio <= 2, `${r.class}: bound 200 costs ${ratio.toFixed(2)}x the never write baseline (${r.bound200.writeMsTotal} ms vs ${r.never.writeMsTotal} ms) - the 2x slack the gate asserts cannot hold for this doc`);
}

// 4. the verb-class prohibition must carry its size condition.
for (const r of rows) {
	const worse = r.everyVerb.writeMsTotal > 2 * r.never.writeMsTotal;
	if (!worse) console.log(`  NOTE ${r.class}: per-verb checkpointing is NOT the worst policy here (write ${r.everyVerb.writeMsTotal} ms vs never ${r.never.writeMsTotal} ms; read ${r.everyVerb.readMsMedian} ms vs never ${r.never.readMsMedian} ms) - the prohibition is size-conditional`);
	gate(r.class.includes("large") ? worse : true, `${r.class}: the gate claims the verb-class key is worse, measured otherwise`);
}

console.log(`\nGATE: ${failures.length} violation(s)`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(failures.length ? 1 : 0);
