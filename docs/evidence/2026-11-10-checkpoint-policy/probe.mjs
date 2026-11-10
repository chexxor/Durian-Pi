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

const ITEMS = Number(process.argv[2] ?? 5000); // the live rig's queue is 5,077 rows (src/readapi.mjs:181)
const VERBS = Number(process.argv[3] ?? 3000); // one fleet-day: 12 seats x ~250 queue verbs
const BODY = 240; // bytes of body per item, so the base has a realistic size
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
for (const [label, predicate] of [
	["never  () => false", () => false],
	["every verb (semantic key)", () => true],
	["bound 50", (_v, _o, info) => info.deltasSinceBase >= 50],
	["bound 200", (_v, _o, info) => info.deltasSinceBase >= 200],
	["bound 1000", (_v, _o, info) => info.deltasSinceBase >= 1000],
	["semantic + bound 200", (value, _o, info) => info.deltasSinceBase >= 200 || value.items.every((it) => it.status === "done" || it.status === "cancelled")],
]) {
	console.log(await run(label, predicate));
}
