#!/usr/bin/env node
/*
 * gate-close-wake-6665.mjs - what actually triggers a wake pass when a gate closes (#6665)

pm's question: does a queue write dirty the scheduler, or must the scheduler derive "queue changed"
from the store each turn? Measure it.

  A. Does a queue-document write made THROUGH the broker's own harness reach notify() as a wake-relevant
     publication? (src/scheduler.mjs:26 names durig.queue in WAKE_DOC_KINDS - is that live?)
  B. After the scheduler has consumed a pass, does the SAME kind of state change dirty it again?
  C. Does a queue write made through a SECOND connection - the shape devtools' probe used - reach the
     in-process observer at all?
  D. At that moment, is there wakeable work the pure driver would act on if a pass ran?

Side measurement the attach forced: src/commitstream.mjs attaches with the pi-durable 1.5.1
observer-object contract. On the lockfile-released 1.3.0 this tree carries, `observeCommits(listener)`
takes a FUNCTION (node_modules/@earendil-works/pi-durable/dist/session/session.js:371), so an object
is stored as a listener and the FIRST publish throws inside the session. That is a real failure mode:
the attach succeeds, nothing looks wrong, and the session dies at the first commit.

Run: node tools/probes/gate-close-wake-6665.mjs      exit 1 when the wake gap is present (it is, today)
*/
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { Harness, createRegistry } from "@earendil-works/pi-durable";
import { createModels } from "@earendil-works/pi-ai";
import { RigQueue, Seats, Router, workable } from "../../../src/rig.mjs";
import { followCommits } from "../../../src/commitstream.mjs";
import { WakeScheduler, isWakeRelevantCommit } from "../../../src/scheduler.mjs";
import { selectWakes } from "../../../src/driver.mjs";

const failures = [];
const check = (cond, msg) => {
	console.log(`  ${cond ? "PASS" : "FAIL"}  ${msg}`);
	if (!cond) failures.push(msg);
};
const note = (m) => console.log(`  MEASURED  ${m}`);

const piVersion = JSON.parse(readFileSync("node_modules/@earendil-works/pi-durable/package.json", "utf8")).version;
const observerObjectContract = piVersion.split(".").map(Number)[1] >= 5;

function attachCommits(harness, listener) {
	if (observerObjectContract) return followCommits(harness, listener);
	const off = harness.subscribeCommits(listener);
	return () => (typeof off === "function" ? off() : off?.detach?.());
}

const dir = mkdtempSync(join(process.cwd(), "tmp-6665-"));
const db = join(dir, "rig.sqlite");
let harness = null;
let extra = null;

try {
	const up = spawnSync(process.execPath, ["cli.mjs", "up", "rig.starter.json", "--no-serve"], {
		env: { ...process.env, DURIG_DB: db, DURIG_PROVIDER: "faux" },
		encoding: "utf8",
	});
	check(up.status === 0, `up --no-serve exit 0 (${up.stderr?.slice(0, 120) || "ok"})`);

	const registry = createRegistry();
	registry.install(Router);
	const storage = await openNodeSqliteStorage(db);
	harness = await Harness.open(storage, { models: createModels(), registry }, BACKGROUND_CONTEXT);

	note(`pi-durable in this tree: ${piVersion}; observer-object contract (>=1.5.1): ${observerObjectContract}`);
	if (!observerObjectContract)
		check(false, "src/commitstream.mjs passes {advance, end} to observeCommits, which in 1.3.0 expects a function: the attach succeeds and the first publish throws (SessionFailed). A version-blind contract is a dormant-broker failure mode with no symptom until wakes stop");

	const scheduler = new WakeScheduler({ minIntervalMs: 0 });
	const publications = [];
	const detach = attachCommits(harness, (pub) => {
		publications.push(pub);
		scheduler.notify(pub);
	});

	// A. queue write through the harness
	await harness.commit(async (tx) => {
		const q = await tx.doc(RigQueue);
		q.items.push({ id: 9001, from: "operator", to: "impl", subject: "the gate to close", status: "queued", blockedBy: [], transitions: [] });
		q.items.push({ id: 9002, from: "operator", to: "impl", subject: "work gated on 9001", status: "held", blockedBy: [9001], transitions: [] });
	}, BACKGROUND_CONTEXT);
	const shape = (p) => (p.changes ?? []).map((c) => c.type + ":" + (c.record?.kind ?? "-")).join(",") || "none";
	note(`publications seen: ${publications.length}; shapes: ${publications.map(shape).join(" | ")}`);
	note(`isWakeRelevantCommit(first): ${publications.length ? isWakeRelevantCommit(publications[0]) : "n/a"}`);
	check(scheduler.dirty, "a queue write through the broker's own harness DOES dirty the scheduler: durig.queue is wake-relevant in practice, not just in WAKE_DOC_KINDS");

	// B. consume the pass, then close the gate with no seat turn at all.
	scheduler.beginPass();
	scheduler.endPass();
	note(`scheduler.dirty after consuming the pass: ${scheduler.dirty}`);
	await harness.commit(async (tx) => {
		const q = await tx.doc(RigQueue);
	 const b = q.items.find((i) => i.id === 9001);
		b.status = "done";
		b.transitions.push({ at: new Date().toISOString(), event: "done", by: "operator" });
	}, BACKGROUND_CONTEXT);
	note(`scheduler.dirty after the in-process gate close: ${scheduler.dirty}`);

	// C. the exposure: the same state change made through a SECOND connection.
	scheduler.beginPass();
	scheduler.endPass();
	extra = await openNodeSqliteStorage(db);
	const extraHarness = await Harness.open(extra, { models: createModels(), registry }, BACKGROUND_CONTEXT);
	await extraHarness.commit(async (tx) => {
		const q = await tx.doc(RigQueue);
		const item = q.items.find((i) => i.id === 9002);
		item.status = "queued";
		item.transitions.push({ at: new Date().toISOString(), event: "released", by: "operator" });
	}, BACKGROUND_CONTEXT);
	await extraHarness.close(BACKGROUND_CONTEXT);
	const verifyStorage = await openNodeSqliteStorage(db);
	const verify = await Harness.open(verifyStorage, { models: createModels(), registry }, BACKGROUND_CONTEXT);
	const freshQueue = await verify.snapshot(RigQueue, undefined, BACKGROUND_CONTEXT);
	const freshRow = (freshQueue?.items ?? []).find((i) => i.id === 9002);
	note(`#9002 status read back from a THIRD connection after the external write: ${freshRow?.status} (transitions: ${(freshRow?.transitions ?? []).map((t) => t.event).join(",") || "none"})`);
	await verify.close(BACKGROUND_CONTEXT);
	note(`scheduler.dirty after an EXTERNAL queue write: ${scheduler.dirty}`);
	note(`scheduler.shouldRun(): ${scheduler.shouldRun()}`);

	// D. is there wakeable work that will never be woken?
	const queue = await harness.snapshot(RigQueue, undefined, BACKGROUND_CONTEXT);
	const seatsDoc = await harness.snapshot(Seats, undefined, BACKGROUND_CONTEXT);
	const items = queue?.items ?? [];
	note(`impl rows: ${items.filter((i) => i.to === "impl").map((i) => `#${i.id} ${i.status} gate ${JSON.stringify(i.blockedBy ?? [])}`).join(", ")}`);
	note(`workable(#9002 for impl): ${JSON.stringify(workable(items.find((i) => i.id === 9002), "impl", { items }))}`);
	const candidates = selectWakes({ seats: seatsDoc?.seats ?? {}, items, pendingConvIds: new Set(), busySeats: new Set(), paused: false });
	note(`selectWakes candidates: ${candidates.map((c) => c.name).join(", ") || "none"}`);
	check(
	!scheduler.dirty && !scheduler.shouldRun() && candidates.length > 0,
	"THE GAP: the driver names a wakeable seat while the scheduler is clean, so no pass runs and the seat sleeps until an unrelated commit arrives"
	);

	detach();
	console.log("\nWhat this settles");
	console.log("  1. durig.queue IS wake-relevant when the write goes through the broker's harness - option 1 already exists for the in-process case.");
	console.log("  2. the scheduler is EVENT-driven: no publication, no pass, however workable the queue has become.");
	console.log("  3. so the answer is neither option as posed: keep the commit stream as the fast path, and add a BOUNDED state tick that dirties only when a derived wake-signature changes. The scheduler stays the only actor that sets the dirty bit (D11), and the pass already re-reads the queue (src/broker.mjs:1368), so deriving from the store costs one snapshot the pass does anyway.");
} finally {
	try { await harness?.close(BACKGROUND_CONTEXT); } catch {}
	try { await extra?.close(BACKGROUND_CONTEXT); } catch {}
	rmSync(dir, { recursive: true, force: true });
}

process.exit(failures.length ? 1 : 0);
