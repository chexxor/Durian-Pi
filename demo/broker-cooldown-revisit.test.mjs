// demo/broker-cooldown-revisit.test.mjs — the broker re-wakes a seat that a pass
// had to DROP for being inside its per-seat cooldown (delegate-owned revisit-gap fix).
//
// The defect: a pass drops a queued seat whose run settled inside the cooldown
// window (`seatFilter` returns false), and no further commit arrives to trigger
// another pass. Before the fix the seat then sat idle with queued work until an
// unrelated commit happened to run a pass — the "general revisit gap" named in
// docs/NEXT.md. The loop now records when the suppressed seat becomes eligible and
// runs a pass then.
//
// This demo gives ONE seat two queued items and a 1.5 s cooldown. The first wake
// lands at once; the seat's run settles quickly (inside the cooldown), so the
// settle-triggered pass must drop it. With the fix a second wake lands near the
// cooldown's end without any external commit; before it, only the first wake is
// ever written and the bound fails.
//
// Run: node demo/broker-cooldown-revisit.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { RigQueue, Router, Seats, compilePersona, enqueueItem, registerSeat } from "../src/rig.mjs";
import { WakeScheduler, createWakeSignal } from "../src/scheduler.mjs";
import { runWakeLoop } from "../src/broker.mjs";

const COOLDOWN_MS = 1500; // the per-seat cooldown the settle-triggered pass must respect
const WAKE_BOUND_MS = 3000; // a second wake must land inside this window without a commit

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(tmpdir(), "durig-cooldown-"));
const logPath = join(dir, "cooldown.db");
const logFile = `${logPath}.broker.log`;

const faux = fauxProvider({ models: [{ id: "worker-model" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const storage = new MemoryStorage();
const harness = await Harness.open(storage, { models, registry }, ctx);

// An immediate reply: the seat's run settles well inside the cooldown, which is
// exactly what forces the settle-triggered pass to drop it.
faux.setResponses(
	Array.from({ length: 32 }, () => fauxAssistantMessage("acknowledged, no tool call")),
);

await harness.commit(async (tx) => {
	const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
	await configure(tx, c.id, {
		model: { provider: "faux", modelId: "worker-model" },
		instructions: compilePersona({ role: "worker" }),
	});
	await registerSeat(tx, "worker", c.id, "worker");
	// Two items: the first wake has work to do, and the second must be reachable
	// after the cooldown without any further store commit.
	await enqueueItem(tx, "operator", "worker", "item one", "body");
	await enqueueItem(tx, "operator", "worker", "item two", "body");
}, ctx);

const scheduler = new WakeScheduler({ minIntervalMs: 10, seatCooldownMs: COOLDOWN_MS });
const signal = createWakeSignal();
const unsubscribe = harness.subscribeCommits((publication) => {
	scheduler.notify(publication);
	if (scheduler.dirty) signal.raise();
});

const started = Date.now();
let stop = false;
const loop = runWakeLoop({
	harness,
	probeStorage: storage,
	scheduler,
	signal,
	context: ctx,
	dbPath: logPath,
	maxDurationMs: WAKE_BOUND_MS + 2000,
	isStopping: () => stop,
});

// Poll the broker log for the worker's SECOND wake. With the fix the revisit
// pass lands near the cooldown boundary; without it the loop idles until the
// duration bound and only one wake is ever written.
let wakes = 0;
let elapsed = null;
const deadline = started + WAKE_BOUND_MS;
while (Date.now() < deadline && wakes < 2) {
	if (existsSync(logFile)) {
		const log = readFileSync(logFile, "utf8");
		wakes = (log.match(/WAKE worker/g) ?? []).length;
		if (wakes >= 2) elapsed = Date.now() - started;
	}
	await new Promise((r) => setTimeout(r, 25));
}

stop = true;
signal.raise(); // unpark a pass that may be waiting on a run
await loop;
unsubscribe();

assert.ok(
	wakes >= 2,
	`a cooldown-suppressed seat must be re-woken after its cooldown (saw ${wakes} wake(s) in ${WAKE_BOUND_MS}ms)`,
);
assert.ok(
	elapsed !== null && elapsed >= COOLDOWN_MS && elapsed < WAKE_BOUND_MS,
	`the revisit wake must land after the cooldown and inside the bound (took ${elapsed}ms)`,
);

await harness.close(ctx);
try {
	rmSync(dir, { recursive: true, force: true });
} catch (err) {
	console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
}
console.log(
	`BROKER COOLDOWN REVISIT PASS (re-woke ${elapsed}ms in, after a ${COOLDOWN_MS}ms cooldown)`,
);
process.exit(0);
