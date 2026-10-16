// demo/broker-liveness.test.mjs — the broker re-wakes a settled seat without
// waiting for the slowest run (delegate-owned broker-liveness fix).
//
// The defect: `drivePass` ended with `harness.waitForIdle(context)`, which parks
// the WHOLE loop until every ownerless conversation is idle. So when one seat
// runs long, a second seat that settles early is not re-woken for its remaining
// queued work until the long run ends — `status` showed idle seats with queued
// work while one generation was in flight.
//
// This demo gives two seats work. Seat `slow` holds a 4s generation; seat `fast`
// settles at once. With the fix, `fast`'s SECOND wake lands while `slow` is still
// generating (well under 2s). Before it, the second wake is blocked behind the
// 4s run and the bound fails.
//
// Run: node demo/broker-liveness.test.mjs  (exit 0 = pass)
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

const SLOW_RUN_MS = 4000; // the long generation the fast seat must not wait behind
const WAKE_BOUND_MS = 2000; // a second fast wake must land inside this window

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(tmpdir(), "durig-liveness-"));
const logPath = join(dir, "liveness.db");
const logFile = `${logPath}.broker.log`;

const faux = fauxProvider({
  models: [{ id: "slow-model" }, { id: "fast-model" }],
});
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const storage = new MemoryStorage();
const harness = await Harness.open(storage, { models, registry }, ctx);

// The factory is duplicated so every provider call has a step to consume; it
// branches on the request model, so the slow and fast seats are deterministic
// regardless of which run the harness starts first.
const responseFor = (_context, _options, _state, model) =>
  model.id === "slow-model"
    ? new Promise((resolve) =>
        setTimeout(() => resolve(fauxAssistantMessage("slow reply")), SLOW_RUN_MS),
      )
    : fauxAssistantMessage("fast reply");
faux.setResponses(Array.from({ length: 32 }, () => responseFor));

await harness.commit(async (tx) => {
  for (const [name, modelId] of [["slow", "slow-model"], ["fast", "fast-model"]]) {
    const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
    await configure(tx, c.id, {
      model: { provider: "faux", modelId },
      instructions: compilePersona({ role: "worker" }),
    });
    await registerSeat(tx, name, c.id, "worker");
  }
  // Two items each: each seat's FIRST run must settle, and the SECOND wake must
  // follow without waiting on the other seat's long run.
  await enqueueItem(tx, "operator", "slow", "slow item 1", "body");
  await enqueueItem(tx, "operator", "slow", "slow item 2", "body");
  await enqueueItem(tx, "operator", "fast", "fast item 1", "body");
  await enqueueItem(tx, "operator", "fast", "fast item 2", "body");
}, ctx);

const scheduler = new WakeScheduler({ minIntervalMs: 10, seatCooldownMs: 0 });
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
  maxDurationMs: SLOW_RUN_MS + 6000,
  isStopping: () => stop,
});

// Poll the broker log for the fast seat's SECOND wake while the slow run is
// still in flight. The RED behaviour writes it only after the 4s run, so this
// window closes first.
let fastWakes = 0;
let elapsed = null;
const deadline = started + WAKE_BOUND_MS;
while (Date.now() < deadline && fastWakes < 2) {
  if (existsSync(logFile)) {
    const log = readFileSync(logFile, "utf8");
    fastWakes = (log.match(/WAKE fast/g) ?? []).length;
    if (fastWakes >= 2) elapsed = Date.now() - started;
  }
  await new Promise((r) => setTimeout(r, 25));
}

stop = true;
signal.raise(); // unpark a pass that may be waiting on the slow run
await loop;
unsubscribe();

assert.ok(
  fastWakes >= 2,
  `the fast seat must be re-woken while slow is still generating (saw ${fastWakes} wake(s) in ${WAKE_BOUND_MS}ms)`,
);
assert.ok(
  elapsed !== null && elapsed < WAKE_BOUND_MS,
  `the fast seat's second wake must land inside ${WAKE_BOUND_MS}ms (took ${elapsed}ms)`,
);

await harness.close(ctx);
try {
  rmSync(dir, { recursive: true, force: true });
} catch (err) {
  console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
}
console.log(
  `BROKER LIVENESS PASS (fast seat re-woken ${elapsed}ms in, while slow still generating)`,
);
process.exit(0);
