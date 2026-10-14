// demo/scheduler.test.mjs — the change-triggered wake SCHEDULER (PUSH-ARCHITECTURE §3.2/§3.3).
//
// The gap this closes: the driver wakes the right seats, but something must
// decide WHEN it runs. `run` is a clock a human invokes; a resident broker
// reacts to the store's own commit stream instead. This proves the two
// invariants that make that safe — coalescing (many commits, one pass; a change
// during a pass is not lost) and throttling (a global floor plus a per-seat
// cooldown) — first as pure rules, then wired to a real harness commit stream.
//
// Failing-first: before src/scheduler.mjs exists this dies with
// ERR_MODULE_NOT_FOUND. Run: node demo/scheduler.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { RigQueue, Router, Seats, compilePersona, enqueueItem, registerSeat } from "../src/rig.mjs";
import { driveOnce, selectWakes } from "../src/driver.mjs";
import { WakeScheduler, createWakeSignal, isWakeRelevantCommit } from "../src/scheduler.mjs";

/* ------------------------- pure: isWakeRelevantCommit ------------------------- */

assert.equal(isWakeRelevantCommit(undefined), false, "no publication is not a change");
assert.equal(isWakeRelevantCommit({ changes: [] }), false, "an empty commit is not a change");
assert.equal(
	isWakeRelevantCommit({ changes: [{ type: "entry" }] }),
	false,
	"a transcript entry does not change the wake decision",
);
assert.equal(
	isWakeRelevantCommit({ changes: [{ type: "document", record: { kind: "pi.agent" } }] }),
	false,
	"an unrelated document does not change the wake decision",
);
assert.equal(
	isWakeRelevantCommit({ changes: [{ type: "document", record: { kind: "durig.queue" } }] }),
	true,
	"a queue-document change is wake-relevant",
);
assert.equal(
	isWakeRelevantCommit({ changes: [{ type: "document", record: { kind: "durig.seats" } }] }),
	true,
	"a roster change is wake-relevant",
);
assert.equal(
	isWakeRelevantCommit({ changes: [{ type: "submission" }] }),
	true,
	"a submission settling can un-strand a claim, so it is wake-relevant",
);

/* ----------------------- pure: coalescing and the floor ----------------------- */

let clock = 1000;
const sched = new WakeScheduler({ minIntervalMs: 500, now: () => clock });
assert.equal(sched.shouldRun(), false, "a fresh scheduler with no change does not run");
sched.notify({ changes: [{ type: "document", record: { kind: "durig.queue" } }] });
assert.equal(sched.dirty, true, "a relevant commit marks it dirty");
assert.equal(sched.shouldRun(), true, "a dirty scheduler with no prior pass is eligible");

sched.beginPass();
assert.equal(sched.dirty, false, "beginning a pass consumes the changes seen so far");
assert.equal(sched.shouldRun(), false, "a pass already in flight is not re-entered");

// A change arriving DURING the pass must drive the NEXT pass, not be swallowed.
sched.notify({ changes: [{ type: "submission" }] });
assert.equal(sched.dirty, true, "a change during a pass re-marks dirty");
assert.equal(sched.shouldRun(), false, "still no re-entry while the pass is in flight");
sched.endPass();

assert.equal(sched.shouldRun(), false, "the global floor holds after the pass ends");
clock = 1400;
assert.equal(sched.delayUntilReady(), 100, "the loop is told exactly how long to sleep");
assert.equal(sched.shouldRun(), false, "still inside the floor");
clock = 1500;
assert.equal(sched.shouldRun(), true, "at the floor the pending change runs");

sched.beginPass();
assert.throws(() => sched.beginPass(), /already in flight/, "a second concurrent pass is a bug, not silent");
sched.endPass();

const forced = new WakeScheduler({ now: () => 0 });
assert.equal(forced.shouldRun(), false);
forced.markDirty();
assert.equal(forced.shouldRun(), true, "a broker forces its first pass after restart");

/* --------------------------- pure: per-seat cooldown --------------------------- */

const cool = new WakeScheduler({ seatCooldownMs: 1000, now: () => 5000 });
assert.equal(cool.seatReady("a"), true, "an unwoken seat is ready");
cool.recordWakes(["a"]);
assert.equal(cool.seatReady("a", 5400), false, "a seat inside its cooldown is throttled");
assert.equal(cool.seatReady("a", 6000), true, "after the cooldown the seat is ready again");
assert.equal(cool.seatReady("b", 5400), true, "a cooldown is per seat, not global");
const filter = cool.seatFilter(5100);
assert.equal(filter({ name: "a" }), false, "the driveOnce filter drops a cooling seat");
assert.equal(filter({ name: "b" }), true, "and passes a seat that has not been woken");

/* ------------------------------ pure: WakeSignal ------------------------------ */

const pre = createWakeSignal();
pre.raise();
await pre.wait(); // already raised: resolves at once
await pre.wait(5); // timeout path resolves rather than hanging
const live = createWakeSignal();
const waiting = live.wait(1000);
live.raise();
await waiting; // raise interrupts a wait immediately

/* ------------------- harness: a commit stream drives real wakes ------------------- */

const ctx = BACKGROUND_CONTEXT;
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);

let passClock = 10_000;
const broker = new WakeScheduler({ minIntervalMs: 0, seatCooldownMs: 5_000, now: () => passClock });
const commits = [];
const unsubscribe = harness.subscribeCommits((publication) => {
	commits.push(publication);
	broker.notify(publication);
});

await harness.commit(async (tx) => {
	const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
	await configure(tx, c.id, {
		model: { provider: "faux", modelId: "faux-seat" },
		instructions: compilePersona({ role: "worker" }),
	});
	await registerSeat(tx, "worker", c.id, "worker");
	await enqueueItem(tx, "pm", "worker", "a queued task", "details");
}, ctx);

assert.ok(commits.length > 0, "the harness published its commits to the subscriber");
assert.ok(
	commits.some(isWakeRelevantCommit),
	"the enqueue surfaced as a wake-relevant commit on the in-process stream",
);
assert.equal(broker.dirty, true, "and it marked the scheduler dirty");

const seats = (await harness.documentState(Seats, undefined, ctx)).value.seats;
const items = async () => (await harness.documentState(RigQueue, undefined, ctx)).value.items;
const pass = async () => {
	const current = await items();
	const candidates = selectWakes({ seats, items: current });
	const actioned = await driveOnce(harness, {
		seats,
		items: current,
		pendingConvIds: new Set(),
		busySeats: new Set(),
		context: ctx,
		seatFilter: broker.seatFilter(passClock),
	});
	return { candidates, actioned };
};

// Pass 1: the enqueue's commit made a pass eligible and the seat is woken.
assert.equal(broker.shouldRun(), true, "the broker reacts to the enqueue without any external clock");
broker.beginPass();
const first = await pass();
assert.equal(first.candidates.length, 1, "selectWakes finds the queued seat");
assert.equal(first.actioned, 1, "the broker wakes the seat with queued work");
broker.recordWakes(first.candidates.map((w) => w.name), passClock);
await harness.waitForIdle(ctx);
broker.endPass();

// The unscripted seat did not complete the item, so a second enqueue is fresh
// work for the SAME seat — exactly the case the per-seat cooldown must throttle.
await harness.commit(async (tx) => {
	await enqueueItem(tx, "pm", "worker", "a second task", "details");
}, ctx);
assert.equal(broker.shouldRun(), true, "the second enqueue is also eligible");
passClock += 1000; // still inside the 5 s cooldown
broker.beginPass();
const throttled = await pass();
assert.equal(throttled.candidates.length, 1, "the seat still has work");
assert.equal(throttled.actioned, 0, "but the cooldown prevents a second wake inside the window");
broker.endPass();

passClock += 5000; // cooldown elapsed
broker.beginPass();
const resumed = await pass();
assert.equal(resumed.actioned, 1, "after the cooldown the same seat is woken again");
broker.endPass();

unsubscribe();
await harness.close(ctx);
console.log("SCHEDULER TEST PASS (commits coalesce into one pass; floor and per-seat cooldown throttle)");
process.exit(0);
