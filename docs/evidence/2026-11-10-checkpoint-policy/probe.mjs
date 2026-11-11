// docs/evidence/2026-11-10-checkpoint-policy/probe.mjs — the measurement behind the #6171 ruling.
//
// WHAT IS BEING MEASURED. `defineDoc(...).checkpointWhen(value, ops, info)` decides whether a document
// change is stored as a full BASE or as a DELTA. Reads walk back to the nearest base and re-apply every
// delta in between: pi-durable 1.3.0, dist/storage/sqlite/storage.js:426-450 (`materializeDocument`:
// one SELECT for the base, one SELECT for the tail, then `apply()` per revision), and the WRITE path
// materializes the doc too (dist/session/transaction.js:597 calls the predicate during commit assembly).
// So a doc that never checkpoints makes every read AND every write linear in the number of changes
// since creation. The question this answers is how much of that cost each policy actually buys back.
//
// Run: node docs/evidence/2026-11-10-checkpoint-policy/probe.mjs   (exit 0; no model, no key, no broker)
import { mkdtempSync, rmSync, statSync, readFileSync } from "node:fs";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { defineDoc } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

const ITEMS = Number(process.env.PROBE_ITEMS ?? process.argv[2] ?? 5000); // the live rig's queue is 5,077 rows (src/readapi.mjs:181)
const VERBS = Number(process.env.PROBE_VERBS ?? process.argv[3] ?? 3000); // one fleet-day: 12 seats x ~250 queue verbs
const BODY = 240; // bytes of body per item, so the base has a realistic size
/* The GATE parameters. #6171's ruling picks bound 200 for RigQueue; the acceptance line said only that
   the probe "exits 0 and prints" the bound - a printout can never fail, so the bound is asserted here.
   Override CHECKPOINT_BOUND to prove the gate bites. */
const QUEUE_BOUND = Number(process.env.CHECKPOINT_BOUND ?? 200);
const WRITE_SLACK = Number(process.env.CHECKPOINT_WRITE_SLACK ?? 2); // write cost may not exceed 2x the never-checkpoint baseline
const CYCLE = ["claimed", "deferred", "claimed", "held", "queued", "claimed", "done", "cancelled"];

const makeDoc = (predicate) =>
	defineDoc({
		kind: "probe.queue",
		version: 1,
		scope: "session",
		initial: () => ({
			nextId: ITEMS + 1,
			items: Array.from({ length: ITEMS }, (_, i) => ({
				id: i + 1,
				from: "pm",
				to: "impl",
				subject: `item ${i + 1}`,
				body: "x".repeat(BODY),
				status: "queued",
				transitions: [{ at: "2026-11-10T00:00:00Z", event: "enqueued", by: "pm" }],
			})),
		}),
		checkpointWhen: predicate,
	}, BACKGROUND_CONTEXT);

async function run(label, predicate) {
	let bases = 0;
	const counted = (value, ops, info) => {
		const decided = predicate(value, ops, info);
		if (decided) bases++;
		return decided;
	};
	const doc = makeDoc(counted);
	const dir = mkdtempSync(join(tmpdir(), "checkpoint-probe-"));
	const dbPath = join(dir, "probe.sqlite");
	const storage = await openNodeSqliteStorage(dbPath);
	const models = createModels();
	models.setProvider(fauxProvider({ models: [{ id: "faux-seat" }] }).provider);
const registry = createRegistry();
	const harness = await Harness.open(storage, { models, registry }, BACKGROUND_CONTEXT);

	await harness.commit(
		async (tx) => {
		await tx.doc(doc); // create the doc: the only unconditional base
	}, BACKGROUND_CONTEXT);

	const t0 = process.hrtime.bigint();
	for (let i = 0; i < VERBS; i++) {
		await harness.commit(
		async (tx) => {
			const q = await tx.doc(doc);
			q.items[i % ITEMS].status = CYCLE[i % CYCLE.length];
		},
		BACKGROUND_CONTEXT,
	);
	}
	const writeMs = Number(process.hrtime.bigint() - t0) / 1e6;

	const rec = await storage.findDocument({ kind: "probe.queue", scope: { kind: "session" } }, "current", BACKGROUND_CONTEXT);
	const reads = [];
	let materialized;
	for (let i = 0; i < 25; i++) {
		const t = process.hrtime.bigint();
		materialized = await storage.document(rec.id, "current", BACKGROUND_CONTEXT);
		reads.push(Number(process.hrtime.bigint() - t) / 1e6);
	}
	reads.sort((a, b) => a - b);
	const valueBytes = JSON.stringify(materialized.value).length;

	const line = {
		policy: label,
		basesWritten: bases,
		deltasSinceBase: materialized.deltasSinceBase,
		valueBytes,
		readMsMedian: Number(reads[12].toFixed(2)),
		readMsMax: Number(reads[24].toFixed(2)),
		verbsMsTotal: Number(writeMs.toFixed(1)),
		storeBytes: statSync(dbPath).size,
	};
	await storage.close();
	rmSync(dir, { recursive: true, force: true });
	return line;
}

const pinVersion = JSON.parse(readFileSync(join(process.cwd(), "node_modules/@earendil-works/pi-durable/package.json"), "utf8")).version;
console.log(
	`probe header: pi-durable ${pinVersion}, ` +
		`node ${process.version}, ${ITEMS} items, ${VERBS} verbs in separate commits, ${BODY}B bodies`,
);
const results = [];
for (const [label, predicate] of [
	["never  () => false", () => false],
	["every verb (semantic key)", () => true],
	["bound 50", (_v, _o, info) => info.deltasSinceBase >= 50],
	[`bound ${QUEUE_BOUND}`, (_v, _o, info) => info.deltasSinceBase >= QUEUE_BOUND],
	["bound 1000", (_v, _o, info) => info.deltasSinceBase >= 1000],
	[`semantic + bound ${QUEUE_BOUND}`, (value, _o, info) => info.deltasSinceBase >= QUEUE_BOUND || value.items.every((it) => it.status === "done" || it.status === "cancelled")],
]) {
	const line = await run(label, predicate);
	results.push(line);
	console.log(line);
}

/* ---------------- the gate ---------------- */
const byPolicy = Object.fromEntries(results.map((r) => [r.policy, r]));
const never = byPolicy["never  () => false"];
const chosen = byPolicy[`bound ${QUEUE_BOUND}`];
const always = byPolicy["every verb (semantic key)"];
const failures = [];
const gate = (cond, claim) => { if (!cond) failures.push(claim); };

// 1. The unbounded case is unbounded: the chain grows past the bound (commits are group-committed,
//    so the chain length is not exactly the verb count - it is the revision count, which grows without limit).
gate(never.deltasSinceBase > QUEUE_BOUND, `never-checkpointed chain should exceed the bound ${QUEUE_BOUND}, measured ${never.deltasSinceBase}`);
// 2. The chosen bound holds, and the base is actually written.
gate(chosen.deltasSinceBase <= QUEUE_BOUND, `bound ${QUEUE_BOUND}: deltasSinceBase ${chosen.deltasSinceBase} exceeds it`);
gate(chosen.basesWritten > 0, `bound ${QUEUE_BOUND}: no base was written, so the bound is not doing anything`);
// 3. The bound buys a faster read, or it is not a reason to write bases.
gate(chosen.readMsMedian < never.readMsMedian, `bound ${QUEUE_BOUND} read median ${chosen.readMsMedian} ms is not better than never ${never.readMsMedian} ms`);
// 4. Write cost stays within the slack, or the single-writer seam is the victim.
gate(chosen.verbsMsTotal <= WRITE_SLACK * never.verbsMsTotal, `bound ${QUEUE_BOUND} write cost ${chosen.verbsMsTotal} ms exceeds ${WRITE_SLACK}x the never baseline ${never.verbsMsTotal} ms`);
// 5. The prohibition: keying a hot doc on the verb class is measurably the worst policy.
gate(always.verbsMsTotal > chosen.verbsMsTotal, `the verb-class policy (${always.verbsMsTotal} ms) is not worse than the bound (${chosen.verbsMsTotal} ms) - the prohibition in the ruling is unsupported`);

console.log(`\nGATE: pi-durable ${pinVersion}, ${ITEMS} items, ${VERBS} verbs, bound ${QUEUE_BOUND}, write slack ${WRITE_SLACK}`);
for (const r of results) console.log(`  ${r.policy.padEnd(24)} bases=${String(r.basesWritten).padEnd(5)} deltas=${String(r.deltasSinceBase).padEnd(6)} readMedian=${String(r.readMsMedian).padEnd(6)} ms writeTotal=${String(r.verbsMsTotal).padEnd(8)} ms`);
if (failures.length) {
	console.log(`RESULT: FAIL (${failures.length})`);
	for (const f of failures) console.log(`  - ${f}`);
	process.exit(1);
}
console.log("RESULT: PASS - the bound holds, the read is faster, the write cost is inside the slack, and the verb-class key is measurably worse.");
