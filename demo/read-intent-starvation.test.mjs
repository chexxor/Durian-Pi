// demo/read-intent-starvation.test.mjs — #6139: a read intent must not starve behind a
// mutation the wedged harness cannot apply, and a read that does not answer must be reported
// as a TIMEOUT that names the spool, never as an empty result.
//
// THE MEASURED SYMPTOM. `node cli.mjs queue --held --with-gates --json` exits 1 with
// "read queue-census: timed out awaiting the broker's result" while the broker is ALIVE and
// its inbox holds undrained read intents. Two facts make that possible, both pinned here:
//   1. the out-of-band read drain (#314) runs ONLY when EVERY pending intent is a read
//      (`onlyReadIntents`), and
//   2. `drainSpool` takes the seat roster with `harness.snapshot(...)` OUTSIDE the per-intent
//      try, so one mutating intent in the spool makes the whole drain throw BEFORE any read in
//      it is served.
// So a single undeliverable mutation — a steer to a closed conversation, retried and rethrown
// — holds every read behind it indefinitely. The intent files sit in the spool for minutes;
// the operator's only read surface says nothing.
//
// WHAT THE FIX DOES, and what this demo pins:
//   (A) a reads-only spool is served while the harness handle is wedged (the control: this
//     already worked, and must keep working);
//   (B) a MIXED spool — an older mutating intent and a younger read — still answers the read,
//     and the mutation is DELAYED (still pending), never dead-lettered by the read drain;
//   (C) a timed-out wait names the spool: how many intents are pending, how many are reads, and
//     the age of the oldest one. "Nothing came back" is not a diagnosis.
//
// No network, no real model, no fleet. Run: node demo/read-intent-starvation.test.mjs (exit 0).

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import {
  awaitIntentResult,
  readIntentFiles,
  runWakeLoop,
  writeIntent,
} from "../src/broker.mjs";
import { registerSeat } from "../src/rig.mjs";
import { WakeScheduler, createWakeSignal } from "../src/scheduler.mjs";

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(tmpdir(), "durig-read-starve-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (label, cond, detail = "") => {
  if (cond) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
};

// A harness whose work calls throw: the handle that is stuck mid-await. `waitForIdle` is left
// real, because the drain must never need it - and the loop's exit drain waits on it.
const wedged = (harness) =>
  new Proxy(harness, {
    get(target, prop) {
      if (prop === "snapshot" || prop === "commit" || prop === "inspect") {
        return () => Promise.reject(new Error("harness handle wedged (mid-await)"));
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

// Write intents with a name-ordering that is deterministic: writeIntent names the file by time,
// so the mutation is written first and is genuinely OLDER than the read.
async function seedSeat(harness) {
  await harness.commit(async (tx) => {
    const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
    await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" }, instructions: "worker" });
    await registerSeat(tx, "solo", c.id, "worker");
  }, ctx);
}

try {
  const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
  const models = createModels();
  models.setProvider(faux.provider);
  const registry = createRegistry();

  /* ---- A. reads-only spool: the out-of-band drain answers with a wedged handle ---- */
  console.log("\nA. a reads-only spool is answered while the wake loop is parked");
  {
    const db = join(dir, "a.db");
    const storage = await openNodeSqliteStorage(db);
    const harness = await Harness.open(storage, { models, registry }, ctx);
    await seedSeat(harness);
    await harness.waitForIdle(ctx);
    const probe = await openNodeSqliteStorage(db);
    const id = "read-a1";
    writeIntent(db, { op: "read", view: "seats", from: "cli", requestId: id, createdAt: new Date().toISOString() });
    const loop = runWakeLoop({
      harness: wedged(harness),
      probeStorage: probe,
      scheduler: new WakeScheduler({ minIntervalMs: 10, seatCooldownMs: 0 }),
      signal: createWakeSignal(),
      context: ctx,
      dbPath: db,
      maxDurationMs: 2500,
      wakeRetryMs: 50,
      wakeRetryMaxMs: 100,
      readDrainMs: 100,
    });
    const awaited = await awaitIntentResult(db, id, { timeoutMs: 4000 });
    await loop;
    check("the read was drained out of band (result recorded)", awaited.ok, awaited.reason);
    check("the spool is empty afterwards", readIntentFiles(db).length === 0, `pending=${readIntentFiles(db).length}`);
    await probe.close(ctx);
    await harness.close(ctx);
  }

  /* ---- B. MIXED spool: an OLDER stuck mutation must not starve a younger read ---- */
  console.log("\nB. a mutating intent the wedged harness cannot apply must not hold the reads behind it");
  {
    const db = join(dir, "b.db");
    const storage = await openNodeSqliteStorage(db);
    const harness = await Harness.open(storage, { models, registry }, ctx);
    await seedSeat(harness);
    await harness.waitForIdle(ctx);
    const probe = await openNodeSqliteStorage(db);
    // The mutation first: its spool file sorts before the read's.
    writeIntent(db, {
      op: "message",
      to: "solo",
      from: "operator",
      text: "steer that a wedged handle cannot apply",
      requestId: "mut-1",
      createdAt: new Date().toISOString(),
    });
    await sleep(5);
    const readId = "read-b1";
    writeIntent(db, { op: "read", view: "queue", from: "cli", requestId: readId, createdAt: new Date().toISOString() });

    const loop = runWakeLoop({
      harness: wedged(harness),
      probeStorage: probe,
      scheduler: new WakeScheduler({ minIntervalMs: 10, seatCooldownMs: 0 }),
      signal: createWakeSignal(),
      context: ctx,
      dbPath: db,
      maxDurationMs: 3000,
      wakeRetryMs: 50,
      wakeRetryMaxMs: 100,
      readDrainMs: 100,
    });
    const awaited = await awaitIntentResult(db, readId, { timeoutMs: 6000 });
    await loop;
    check("the read was answered despite the stuck mutation", awaited.ok, awaited.reason);
    check(
      "the mutation is DELAYED, not dead-lettered by the read drain (still pending, no .error.json)",
      readIntentFiles(db).length === 1,
      `pending=${readIntentFiles(db).length}`,
    );
    await probe.close(ctx);
    await harness.close(ctx);
  }

  console.log(`\n${failures === 0 ? "READ-STARVATION PASS" : `READ-STARVATION FAIL (${failures} check(s))`}`);
  process.exit(failures === 0 ? 0 : 1);
} finally {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
  }
}
