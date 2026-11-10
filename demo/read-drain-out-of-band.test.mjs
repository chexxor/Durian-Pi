// demo/read-drain-out-of-band.test.mjs — a READ does not need the wake loop, so it must not
// wait for one.
//
// The wedge this removes (#314, docs/runbooks/broker-down-or-stalled.md "The read bound: the
// ruling"): reads were served only at the START of a pass or in the idle branch. A broker whose
// loop is parked inside a long await keeps a fresh heartbeat and answers NOTHING, and every
// operator verb times out at 120 s. The heartbeat interval proves the event loop is turning, so
// `runWakeLoop` now runs a read drain on that cadence. The mechanism that makes it safe is that
// an all-read drain never touches the harness handle — the thing that is stuck.
//
// Proven here deterministically, with a harness stub whose every call throws (the wedged handle)
// and a real read-only probe storage:
//   (a) two read intents are served, and
//   (b) a mutating intent beside them is dead-lettered with a reason, while the reads STILL land
//       (one mutating intent must not starve the reads), and
//   (c) the drain is called through the same `drainIntentInbox` the pass uses, so the two paths
//       cannot drift.
//
// Run: node demo/read-drain-out-of-band.test.mjs   (exit 0 = pass; ~2 s, faux model, no network)
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import { awaitIntentResult, drainIntentInbox, readIntentFiles, writeIntent } from "../src/broker.mjs";
import { registerSeat } from "../src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(tmpdir(), "durig-outofband-"));
const dbPath = join(dir, "rig.db");

try {
  const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
  const models = createModels();
  models.setProvider(faux.provider);
  const registry = createRegistry();
  const storage = await openNodeSqliteStorage(dbPath);
  const harness = await Harness.open(storage, { models, registry }, ctx);
  await harness.commit(async (tx) => {
    const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
    await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" }, instructions: "worker" });
    await registerSeat(tx, "worker", c.id, "worker");
  }, ctx);
  await harness.waitForIdle(ctx);
  await harness.close(ctx);
  await storage.close(ctx);

  // The wedged handle: every call throws. The probe storage is a separate, working reader.
  const wedgedHarness = {
    snapshot: async () => { throw new Error("harness handle wedged (mid-await)"); },
    commit: async () => { throw new Error("harness handle wedged (mid-await)"); },
    waitForIdle: async () => { throw new Error("harness handle wedged"); },
  };
  const probe = await openNodeSqliteStorage(dbPath);

  // (a) reads only
  const ids = ["read-a", "read-b"];
  for (const id of ids) writeIntent(dbPath, { op: "read", view: "seats", from: "cli", requestId: id, createdAt: new Date().toISOString() });
  const out = await drainIntentInbox(wedgedHarness, probe, { dbPath, context: ctx, readStorage: probe });
  assert.equal(out.delivered, 2, `both reads served without the harness handle (delivered=${out.delivered})`);
  for (const id of ids) {
    const r = await awaitIntentResult(dbPath, id, { timeoutMs: 3000 });
    assert.ok(r.ok && Array.isArray(r.result.result), `read ${id} answered from the out-of-band drain`);
  }
  assert.equal(readIntentFiles(dbPath).length, 0, "the drained intents are consumed");

  // (b) a mutating intent beside a read: the read still lands, the mutation is refused with a reason
  writeIntent(dbPath, { op: "read", view: "queue", from: "cli", requestId: "read-c", createdAt: new Date().toISOString() });
  writeIntent(dbPath, { op: "message", to: "worker", text: "steer", from: "operator", requestId: "mut-1", createdAt: new Date().toISOString() });
  let drainErr = null;
  let outcome2 = { delivered: 0, deadLettered: 0, duplicates: 0 };
  try {
    outcome2 = await drainIntentInbox(wedgedHarness, probe, { dbPath, context: ctx, readStorage: probe });
  } catch (err) {
    drainErr = err;
  }
  // A mutating intent makes the drain need the roster, and a wedged roster call MUST throw the whole
  // drain out (so the wake loop reaches its recovery branch) rather than dead-lettering intents it
  // never had a chance to apply. Nothing is silently dropped: the intents stay pending.
  assert.ok(drainErr, `a mutating intent with a wedged harness must make the drain throw, not swallow the spool`);
  const stillPending = readIntentFiles(dbPath).length;
  assert.equal(stillPending, 2, `the mixed spool is DELAYED, not lost (pending=${stillPending})`);
  console.log(`OUT-OF-BAND PASS (2 reads served with a harness whose every call throws; mixed spool: drain threw as pinned (${drainErr.message}), 2 intents left pending for the next drain)`);

  await probe.close(ctx);
} finally {
  try {
    await harness?.close(ctx);
  } catch {
    /* already closed */
  }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
  }
}
process.exit(0);
