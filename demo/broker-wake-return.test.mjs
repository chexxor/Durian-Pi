// demo/broker-wake-return.test.mjs — the resident broker wakes and returns instead of
// parking on the runs it woke (ROADMAP 54, delegate-owned).
//
// HEAD's `drivePass` always awaited `waitForIdle` on every conversation a pass woke, so
// the broker loop could not turn while a run was live. The earlier D65 fix scoped that
// wait so a wake-relevant commit can end it — but the call still *awaits* and never
// returns while the run is live, so a pass with no commit to raise the signal parks the
// loop (the observed ~15-minute pass gap, and a `serve --stop` that could not be
// honoured). Item 54 gives `drivePass` a `waitForWakes` boundary: the resident broker
// passes `false`, returns at once, and drains the ordinary scope once on loop exit
// (F11). A one-shot `run` keeps the in-tick wait.
//
// Failing-first: HEAD ignores the unknown `waitForWakes` option and awaits the 4s run,
// so the return-time bound below fails. Run: node demo/broker-wake-return.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { Router, Seats, compilePersona, enqueueItem, registerSeat } from "../src/rig.mjs";
import { WakeScheduler, createWakeSignal } from "../src/scheduler.mjs";
import { drivePass, runWakeLoop, writeIntent } from "../src/broker.mjs";
import { WAKE_CONTENT } from "../src/driver.mjs";

const SLOW_RUN_MS = 4000; // the long generation a pass must not park on
const RETURN_BOUND_MS = 1000; // drivePass(waitForWakes:false) must return inside this...

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(tmpdir(), "durig-wake-return-"));
const dbPath = join(dir, "wake-return.db");
const logFile = `${dbPath}.broker.log`;

const faux = fauxProvider({ models: [{ id: "slow-model" }, { id: "target-model" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const storage = new MemoryStorage();
const harness = await Harness.open(storage, { models, registry }, ctx);

// The factory branches on the request model, so the slow run is deterministic no
// matter which seat the harness starts first.
const responseFor = (_context, _options, _state, model) =>
	model.id === "slow-model"
		? new Promise((resolve) => setTimeout(() => resolve(fauxAssistantMessage("slow reply")), SLOW_RUN_MS))
		: fauxAssistantMessage("target reply");
faux.setResponses(Array.from({ length: 16 }, () => responseFor));

await harness.commit(async (tx) => {
	for (const [name, modelId] of [["slow", "slow-model"], ["target", "target-model"]]) {
		const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
		await configure(tx, c.id, {
			model: { provider: "faux", modelId },
			instructions: compilePersona({ role: "worker" }),
		});
		await registerSeat(tx, name, c.id, "worker");
	}
	await enqueueItem(tx, "operator", "slow", "a long task", "body");
}, ctx);
const slowConvId = (await harness.documentState(Seats, undefined, ctx)).value.seats.slow.conversationId;

// Part 1 (failing-first): a pass wakes the slow seat but must not park on its 4s run.
{
	const t0 = Date.now();
	const { actioned } = await drivePass(harness, storage, { context: ctx, waitForWakes: false });
	const elapsed = Date.now() - t0;
	assert.ok(actioned >= 1, "the slow seat is woken");
	assert.ok(
		elapsed < RETURN_BOUND_MS,
		`drivePass(waitForWakes:false) must return without awaiting the slow run (took ${elapsed}ms)`,
	);
	// F11: the caller that does not wait in-tick must still drain before closing.
	await harness.waitForIdle(ctx);
}

// Part 2 (the roadmap acceptance, integration): a resident broker keeps turning
// while a slow run is in flight, so a spooled intent is delivered without waiting
// for that run.
await harness.commit((tx) => enqueueItem(tx, "operator", "slow", "another long task", "body"), ctx);
const scheduler = new WakeScheduler({ minIntervalMs: 200, seatCooldownMs: 0 });
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
	dbPath,
	maxDurationMs: SLOW_RUN_MS + 6000,
	isStopping: () => stop,
});
const readLog = () => (existsSync(logFile) ? readFileSync(logFile, "utf8") : "");
const countMatches = (re) => (readLog().match(re) ?? []).length;
while (countMatches(/WAKE slow/g) < 1 && Date.now() - started < 5000) {
	await new Promise((r) => setTimeout(r, 20));
}
const spooledAt = Date.now();
writeIntent(dbPath, { to: "target", from: "operator", content: "an intent that must not wait" });
let deliveredAt = null;
while (Date.now() - spooledAt < RETURN_BOUND_MS && deliveredAt === null) {
	if (countMatches(/INTENT delivered=1/g) >= 1) deliveredAt = Date.now();
	else await new Promise((r) => setTimeout(r, 20));
}
stop = true;
signal.raise(); // unpark a pass that may be waiting on the scheduler floor
await loop; // F11: the loop's exit drain waits for the slow run rather than abandoning it
unsubscribe();
assert.ok(
	deliveredAt !== null && deliveredAt - spooledAt < RETURN_BOUND_MS,
	`the spooled intent must be delivered while slow is still generating (within ${RETURN_BOUND_MS}ms)`,
);

// The wake is durable, not lost: the slow seat's conversation carries the wake text.
const slowConv = await harness.conversation(slowConvId, ctx);
const entries = await slowConv.entries({}, 200, undefined, ctx);
assert.ok(
	entries.items.some((e) => JSON.stringify(e).includes(WAKE_CONTENT)),
	"the wake was delivered, not dropped",
);

await harness.close(ctx);
try {
	rmSync(dir, { recursive: true, force: true });
} catch (err) {
	console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
}
console.log(
	`BROKER WAKE-RETURN PASS (drivePass returns without awaiting the slow run; a spooled intent was delivered ${deliveredAt - spooledAt}ms in while it generated)`,
);
process.exit(0);
