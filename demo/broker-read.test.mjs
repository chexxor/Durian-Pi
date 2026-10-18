// demo/broker-read.test.mjs — broker-served reads: every CLI/UI read goes through
// the broker's own pi-durable instance, never a second open (ROADMAP 71 spool
// extension).
//
// The defect this proves fixed: pi-durable is one-owner-per-process, and
// `SqliteStorage.document()` wraps a READ in `BEGIN IMMEDIATE`, so a CLI viewer that
// opens the store itself takes the broker's WRITE lock and can time out its session
// (`SessionFailed`). The fix makes the read a spooled request the broker answers with
// its own storage; the client never opens the database.
//
// Failing-first: before src/brokerread.mjs / the `read` spool op / src/readclient.mjs
// exist, this dies at import or on the first drain (the op is unknown and dead-lettered).
// Run: node demo/broker-read.test.mjs   (exit 0 = pass)
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { Seats, Router, compilePersona, registerSeat } from "../src/rig.mjs";
import {
  SPOOL_OPS,
  awaitIntentResult,
  brokerAlive,
  drainIntentInbox,
  readBrokerState,
  writeBrokerState,
  writeIntent,
} from "../src/broker.mjs";
import { READ_VIEWS } from "../src/brokerread.mjs";
import { readViaBroker, brokerAliveFor } from "../src/readclient.mjs";
import { readQueueItems, readSeatList } from "../src/readapi.mjs";

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(tmpdir(), "durig-read-"));
const dbPath = join(dir, "read.db");
let brokerState = null;
let drainer = null;

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const storage = new MemoryStorage();
const harness = await Harness.open(storage, { models, registry }, ctx);

let workerConv;
let verifierConv;
await harness.commit(async (tx) => {
  const c1 = await tx.createConversation({ ownership: { kind: "ownerless" } });
  await configure(tx, c1.id, {
    model: { provider: "faux", modelId: "faux-seat" },
    instructions: compilePersona({ role: "worker" }),
  });
  await registerSeat(tx, "worker", c1.id, "worker");
  workerConv = c1.id;
  const c2 = await tx.createConversation({ ownership: { kind: "ownerless" } });
  await configure(tx, c2.id, {
    model: { provider: "faux", modelId: "faux-seat" },
    instructions: compilePersona({ role: "verifier" }),
  });
  await registerSeat(tx, "verifier", c2.id, "verifier");
  verifierConv = c2.id;
}, ctx);

try {
  // 0. `read` is in the closed spool vocabulary, and the read views are a closed list.
  assert.ok(SPOOL_OPS.includes("read"), "read is a spool op — a read never opens the store");
  assert.deepEqual(READ_VIEWS, [
    "seats",
    "queue",
    "roots",
    "health",
    "live",
    "entries",
    "feed",
    "document",
    "exhausted",
    "older",
  ]);

  // 1. THE BROKER SIDE: a spooled `read` is applied with the broker's OWN storage and
  //    the payload is the SAME shape the direct readapi call returns. This is the
  //    equivalence that lets readclient route to either path without drift.
  const R_SEATS = "read-seats-1";
  writeIntent(dbPath, { op: "read", view: "seats", requestId: R_SEATS, from: "cli" });
  const seatsDrain = await drainIntentInbox(harness, storage, { dbPath, context: ctx });
  assert.deepEqual(seatsDrain, { delivered: 1, deadLettered: 0, duplicates: 0 }, "a read request is applied");
  const readSeats = (await awaitIntentResult(dbPath, R_SEATS, { timeoutMs: 2000 })).result.result;
  assert.deepEqual(
    readSeats,
    await readSeatList(storage, ctx),
    "the broker's `seats` view equals the direct readapi call",
  );
  assert.deepEqual(
    readSeats.map((s) => s.name).sort(),
    ["verifier", "worker"],
    "the broker served the real roster",
  );

  const R_QUEUE = "read-queue-1";
  writeIntent(dbPath, { op: "read", view: "queue", requestId: R_QUEUE, from: "cli" });
  await drainIntentInbox(harness, storage, { dbPath, context: ctx });
  const readQueue = (await awaitIntentResult(dbPath, R_QUEUE, { timeoutMs: 2000 })).result.result;
  assert.deepEqual(readQueue, await readQueueItems(storage, ctx), "the broker's `queue` view equals the direct call");

  // 2. An UNKNOWN read view is dead-lettered by name, never applied — the view set is
  //    closed, exactly like the op set.
  writeIntent(dbPath, { op: "read", view: "telepathy", requestId: "read-bad-view", from: "cli" });
  const badView = await drainIntentInbox(harness, storage, { dbPath, context: ctx });
  assert.equal(badView.deadLettered, 1, "an unknown read view is dead-lettered");

  // 3. THE CLIENT SIDE, end-to-end: with a broker alive, `readViaBroker` spools the
  //    request and returns the broker's payload. The in-process drainer stands in for
  //    the broker's pass loop; the CLIENT process never opens the store.
  writeBrokerState(dbPath, { pid: process.pid, since: new Date().toISOString() });
  brokerState = readBrokerState(dbPath);
  assert.equal(brokerAlive(brokerState), true, "the fixture broker reads as alive");
  assert.equal(brokerAliveFor(dbPath), true, "readclient agrees the broker is alive");

  drainer = setInterval(() => {
    void drainIntentInbox(harness, storage, { dbPath, context: ctx }).catch(() => {});
  }, 25);
  const viaBroker = await readViaBroker(dbPath, "seats", {}, { timeoutMs: 5000 });
  assert.deepEqual(
    viaBroker,
    await readSeatList(storage, ctx),
    "readViaBroker returns the broker's payload (no store opened by the caller)",
  );

  console.log(
    "BROKER READ PASS (read is a spool op; seats/queue views equal the direct readapi calls; an unknown view is dead-lettered; readViaBroker round-trips through the broker's instance)",
  );
} finally {
  if (drainer) clearInterval(drainer);
  if (brokerState) {
    try {
      await brokerState?.clear?.();
    } catch {
      // best-effort: the temp dir is removed below regardless
    }
  }
  try {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}.broker.json`, { force: true });
  } catch (err) {
    console.error(`broker state cleanup: ${err?.message ?? err}`);
  }
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
