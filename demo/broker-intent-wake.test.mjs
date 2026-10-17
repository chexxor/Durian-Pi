// demo/broker-intent-wake.test.mjs — a spooled operator intent forces a broker pass
// (delegate-owned: closes the "intent waits for an unrelated commit" gap in item 66).
//
// The defect: `drainIntentInbox` runs at the START of a pass, but a resident broker
// only runs a pass on a wake-relevant store commit or a reset. A producer (intent.mjs)
// writes a file to `<db>.broker.inbox` and never touches the store, so on an idle broker
// the operator's intent sits in the inbox until some unrelated commit happens to run a
// pass. The loop now treats a non-empty inbox like a wake-relevant change.
//
// Run: node demo/broker-intent-wake.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { Router, Seats, compilePersona, registerSeat } from "../src/rig.mjs";
import { WakeScheduler, createWakeSignal } from "../src/scheduler.mjs";
import { runWakeLoop, writeIntent } from "../src/broker.mjs";

const DELIVER_BOUND_MS = 3000; // an intent must be drained inside this window

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(tmpdir(), "durig-intent-wake-"));
const logPath = join(dir, "intent.db");
const logFile = `${logPath}.broker.log`;

const faux = fauxProvider({ models: [{ id: "worker-model" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const storage = new MemoryStorage();
const harness = await Harness.open(storage, { models, registry }, ctx);
faux.setResponses(Array.from({ length: 16 }, () => fauxAssistantMessage("acknowledged")));

// One seat, NO queued work: after the first (forced) pass there is nothing dirty, so
// the loop is genuinely idle and only a commit would normally drive the next pass.
await harness.commit(async (tx) => {
	const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
	await configure(tx, c.id, {
		model: { provider: "faux", modelId: "worker-model" },
		instructions: compilePersona({ role: "worker" }),
	});
	await registerSeat(tx, "worker", c.id, "worker");
}, ctx);

const scheduler = new WakeScheduler({ minIntervalMs: 10, seatCooldownMs: 0 });
const signal = createWakeSignal();
const unsubscribe = harness.subscribeCommits((publication) => {
	scheduler.notify(publication);
	if (scheduler.dirty) signal.raise();
});

let stop = false;
const loop = runWakeLoop({
	harness,
	probeStorage: storage,
	scheduler,
	signal,
	context: ctx,
	dbPath: logPath,
	maxDurationMs: DELIVER_BOUND_MS + 3000,
	isStopping: () => stop,
});

// Let the forced startup pass complete and the loop go idle before spooling.
await new Promise((r) => setTimeout(r, 400));

const spooled = writeIntent(logPath, {
	to: "worker",
	from: "operator",
	content: "operator intent body",
	requestId: "demo-intent-1",
});
assert.ok(existsSync(spooled), "the intent file is spooled");

// Poll for the broker's INTENT delivery line. Without the fix the file sits in the
// inbox until the duration bound; with it the idle loop notices the file and passes.
const started = Date.now();
let delivered = false;
const deadline = started + DELIVER_BOUND_MS;
while (Date.now() < deadline && !delivered) {
	if (existsSync(logFile)) {
		delivered = /INTENT delivered=1 dead=0/.test(readFileSync(logFile, "utf8"));
	}
	if (!delivered) await new Promise((r) => setTimeout(r, 25));
}

stop = true;
signal.raise();
await loop;
unsubscribe();

assert.ok(
	delivered,
	`a spooled intent must force a pass and be delivered (no delivery within ${DELIVER_BOUND_MS}ms)`,
);

await harness.close(ctx);
try {
	rmSync(dir, { recursive: true, force: true });
} catch (err) {
	console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
}
console.log("BROKER INTENT WAKE PASS (a spooled intent forced a pass and was delivered while idle)");
process.exit(0);
