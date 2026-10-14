// demo/broker.test.mjs — the resident broker (PUSH-ARCHITECTURE §3.2/§3.3; D45).
//
// The gap this closes: a queue item is inert until something drives it, and today
// that something is a human invoking `run`. This proves the broker's two halves:
//   - `drivePass` runs one wake pass against a real harness and reports the seats
//     it actually woke (`onWoke`), so a caller can cool them off;
//   - `runWakeLoop` is driven by the store's own in-process commit stream: a commit
//     (here, a second enqueue) re-enters a pass with no external clock, and the loop
//     stops at its bound so a test and `--max-duration` can end it.
//
// Failing-first: before src/broker.mjs exists this dies with ERR_MODULE_NOT_FOUND.
// Run: node demo/broker.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { RigQueue, Router, Seats, compilePersona, enqueueItem, registerSeat } from "../src/rig.mjs";
import { WAKE_CONTENT } from "../src/driver.mjs";
import { WakeScheduler, createWakeSignal } from "../src/scheduler.mjs";
import { drivePass, runWakeLoop } from "../src/broker.mjs";

const ctx = BACKGROUND_CONTEXT;
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);

// MemoryStorage doubles as the raw `probeStorage` here; a real broker opens a
// separate handle so an unreadable seat cannot fail the driving harness (P5/#110).
const storage = new MemoryStorage();
const harness = await Harness.open(storage, { models, registry }, ctx);

await harness.commit(async (tx) => {
	const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
	await configure(tx, c.id, {
		model: { provider: "faux", modelId: "faux-seat" },
		instructions: compilePersona({ role: "worker" }),
	});
	await registerSeat(tx, "worker", c.id, "worker");
	await enqueueItem(tx, "pm", "worker", "the first task", "details");
}, ctx);

const seats = (await harness.documentState(Seats, undefined, ctx)).value.seats;
const wakeCount = async () => {
	const conv = await harness.conversation(seats.worker.conversationId, ctx);
	const page = await conv.entries({}, 500, undefined, ctx);
	return page.items.filter((e) => JSON.stringify(e).includes(WAKE_CONTENT)).length;
};

/* ------------------- drivePass: one pass, and it reports the wake ------------------- */

const woke = [];
const first = await drivePass(harness, storage, {
	context: ctx,
	onWoke: (name) => woke.push(name),
});
assert.equal(first.actioned, 1, "one pass wakes the seat with a queued item");
assert.deepEqual(woke, ["worker"], "onWoke names the seat actually woken, for the cooldown");
assert.equal(await wakeCount(), 1, "the fixed wake text is what the seat received");

/* ------------------ runWakeLoop: a commit re-enters a pass, no clock ------------------ */

const scheduler = new WakeScheduler({ minIntervalMs: 0, seatCooldownMs: 0 });
const signal = createWakeSignal();
const unsubscribe = harness.subscribeCommits((publication) => {
	scheduler.notify(publication);
	if (scheduler.dirty) signal.raise();
});

// The follow-up enqueue lands from the end-of-pass hook, so it is a genuine store
// commit the loop must react to on its next turn (not part of the pass that woke).
let supervised = 0;
const result = await runWakeLoop({
	harness,
	probeStorage: storage,
	scheduler,
	signal,
	context: ctx,
	maxPasses: 2,
	supervise: async () => {
		supervised++;
		if (supervised === 1) {
			await harness.commit(async (tx) => {
				await enqueueItem(tx, "pm", "worker", "the second task", "details");
			}, ctx);
		}
		return [];
	},
});

assert.equal(result.passes, 2, "the loop ran the forced startup pass and the commit-driven pass");
assert.equal(result.stoppedBy, "max-passes", "the loop stops at its bound rather than running forever");
assert.ok(
	(await wakeCount()) >= 2,
	"the second pass was re-entered from the commit stream, with no external clock",
);

// A bounded run must wake itself to re-check the deadline when nothing changes —
// otherwise `serve --max-duration` would rest forever in `signal.wait`.
const idleScheduler = new WakeScheduler({ minIntervalMs: 0, seatCooldownMs: 0 });
const bounded = await runWakeLoop({
	harness,
	probeStorage: storage,
	scheduler: idleScheduler,
	signal: createWakeSignal(),
	context: ctx,
	maxDurationMs: 30,
});
assert.equal(bounded.stoppedBy, "max-duration", "a bounded broker exits at its deadline while idle");

unsubscribe();
await harness.close(ctx);
console.log("BROKER TEST PASS (a pass wakes and reports its seats; commits re-enter the loop without a clock)");
process.exit(0);
