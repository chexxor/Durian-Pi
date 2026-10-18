// demo/compact-spool.test.mjs — `compact` as a command-spool op (ROADMAP 71 addendum, #1904).
//
// The gap: `compact` was an EXTERNAL CLI writer — it refused while a broker drove
// (`refuseWhileBrokerDrives`) and refused a seat holding a live generation lease, so a live
// rig could not compact at all. pi-durable is BUILT for live compaction: `conversation.compact()`
// commits a `pi.compaction` task that runs alongside the conversation and places a summary
// entry (the transcript is preserved). The spool (#912) already applies typed ops with the
// broker's OWN harness — one writer, one scheduler. This proves `compact` rides it.
//
// Failing-first: against main before this op existed, the request is an UNKNOWN op — it is
// dead-lettered, no result is recorded, and no `pi.compaction` entry lands, so the assertions
// below fail. Run: node demo/compact-spool.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { CompactionEntry, configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { Router, registerSeat } from "../src/rig.mjs";
import { WakeScheduler, createWakeSignal } from "../src/scheduler.mjs";
import {
	SPOOL_OPS,
	awaitIntentResult,
	drainIntentInbox,
	intentResultDir,
	readIntentFiles,
	runWakeLoop,
	writeIntent,
} from "../src/broker.mjs";

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(tmpdir(), "durig-compact-spool-"));
const dbPath = join(dir, "compact.db");
const seatName = "stuffed";
const INSTRUCTIONS = "fold the early turns into a summary, keep the latest work";

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const storage = new MemoryStorage();
const harness = await Harness.open(storage, { models, registry }, ctx);
harness.resume();

let convId;
await harness.commit(async (tx) => {
	const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
	await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" } });
	await registerSeat(tx, seatName, c.id, "implementation");
	convId = c.id;
}, ctx);

const conv = await harness.conversation(convId, ctx);
const compactionIds = async () => {
	const page = await conv.entries({ order: "descending" }, 200, undefined, ctx);
	return new Set(page.items.filter((e) => e.kind === CompactionEntry.kind).map((e) => String(e.id)));
};

try {
	// Seed a LONG transcript so there is a prefix to summarize (same shape as compact.test.mjs).
	const TURNS = 30;
	for (let i = 0; i < TURNS; i++) {
		faux.setResponses([fauxAssistantMessage(fauxText(`ack-${i}`))]);
		const run = await conv.submit({ type: "input", content: `turn-${i} ${"x".repeat(4000)}` }, ctx);
		await run.wait(ctx);
	}
	assert.equal((await compactionIds()).size, 0, "no compaction entry before the request");

	// 1. The op is in the spool's closed vocabulary.
	assert.ok(SPOOL_OPS.includes("compact"), `compact must be in SPOOL_OPS (got ${JSON.stringify(SPOOL_OPS)})`);

	// 2. The broker APPLIES the request with its own harness (the drain inside drivePass).
	const R1 = "req-compact-1";
	writeIntent(dbPath, {
		op: "compact",
		to: seatName,
		instructions: INSTRUCTIONS,
		requestId: R1,
		from: "operator",
	});
	// The summarization is a model call: give the faux provider one reply for it.
	faux.setResponses([fauxAssistantMessage(fauxText("(faux) folded summary"))]);
	const looped = await runWakeLoop({
		harness,
		probeStorage: storage,
		scheduler: new WakeScheduler({ minIntervalMs: 0, seatCooldownMs: 0 }),
		signal: createWakeSignal(),
		context: ctx,
		dbPath,
		maxPasses: 1,
	});
	assert.ok(looped.passes >= 1, "the broker loop ran a pass");

	// 3. The result channel records the outcome under the requestId.
	const resultPath = join(intentResultDir(dbPath), `${R1}.json`);
	assert.ok(existsSync(resultPath), "the result channel recorded the compact request");
	const res = JSON.parse(readFileSync(resultPath, "utf8"));
	assert.equal(res.ok, true, `the compact applied (${JSON.stringify(res)})`);
	assert.equal(res.op, "compact");
	assert.equal(res.result.seat, seatName);
	assert.ok(
		res.result.summaryEntryId != null,
		`a REAL summary entry id is reported, not just a task id (got ${res.result.summaryEntryId})`,
	);

	// 4. PROOF IN THE STORE: the reported entry is the `pi.compaction` entry that landed.
	const ids = await compactionIds();
	assert.equal(ids.size, 1, `exactly one pi.compaction entry landed (got ${ids.size})`);
	assert.ok(ids.has(String(res.result.summaryEntryId)), "the reported summaryEntryId is the stored one");
	assert.equal(readIntentFiles(dbPath).length, 0, "the applied request left the spool");

	// 5. IDEMPOTENT: the SAME requestId applies ONCE (the spool's existing ledger).
	writeIntent(dbPath, {
		op: "compact",
		to: seatName,
		instructions: INSTRUCTIONS,
		requestId: R1,
		from: "operator",
	});
	const dup = await drainIntentInbox(harness, storage, { dbPath, context: ctx });
	assert.deepEqual(dup, { delivered: 0, deadLettered: 0, duplicates: 1 }, `duplicate drain ${JSON.stringify(dup)}`);
	assert.equal((await compactionIds()).size, 1, "a duplicate requestId does not compact a second time");

	// 6. The seat is NOT stopped/aborted by the compaction, and the transcript is preserved.
	const subs = await storage.scanSubmissions({ conversationId: convId, order: "descending" }, 10, undefined, ctx);
	assert.ok(
		subs.items.every((s) => !String(s.reason ?? "").startsWith("aborted:")),
		"compact did not abort the seat",
	);
	const all = await conv.entries({}, 500, undefined, ctx);
	assert.ok(JSON.stringify(all.items).includes("turn-0 "), "the earliest turn is still durable (context shrank, transcript kept)");

	// 7. The PRODUCER half (`cli.mjs` uses it): awaitIntentResult resolves the broker's outcome,
	//    and a request that never lands times out rather than hanging forever.
	const waitDir = mkdtempSync(join(tmpdir(), "durig-await-"));
	try {
		mkdirSync(intentResultDir(waitDir), { recursive: true });
		writeFileSync(
			join(intentResultDir(waitDir), "r1.json"),
			JSON.stringify({ requestId: "r1", op: "compact", ok: true, result: { summaryEntryId: 7 } }),
		);
		const got = await awaitIntentResult(waitDir, "r1", { timeoutMs: 1000, intervalMs: 5 });
		assert.equal(got.ok, true, "a recorded result resolves");
		assert.equal(got.result.result.summaryEntryId, 7);
		const missing = await awaitIntentResult(waitDir, "never", { timeoutMs: 30, intervalMs: 5 });
		assert.equal(missing.ok, false, "an absent result does not resolve as success");
		assert.match(missing.reason, /timed out/);
	} finally {
		rmSync(waitDir, { recursive: true, force: true });
	}

	console.log(
		"COMPACT-SPOOL PASS (broker applies op:compact with its own harness; a real pi.compaction entry lands; duplicate requestId applies once; seat not aborted)",
	);
} finally {
	try {
		await harness.close(ctx);
	} catch (err) {
		console.error(`harness close: ${err?.message ?? err}`);
	}
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}
process.exit(0);
