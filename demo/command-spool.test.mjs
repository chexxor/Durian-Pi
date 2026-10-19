// demo/command-spool.test.mjs — the command spool: writes as requests the broker
// applies (ROADMAP 71, item #912).
//
// The gap: the intent inbox only delivered a MESSAGE. Every other mutating verb
// (`stop`, `reset`, queue edits) still opened its own harness, so while the broker
// drove it was a second writer — the 2026-10-16 crash class. The spool generalises
// the inbox: a request file names an `op`, the broker APPLIES it with its own
// harness, and the outcome lands in a result channel keyed by `requestId`. A
// duplicate `requestId` applies ONCE (the result file is the idempotency ledger).
//
// Failing-first: before src/broker.mjs exports SPOOL_OPS/intentResultDir and
// drainIntentInbox applies ops, this dies with an import/assert error.
// Run: node demo/command-spool.test.mjs   (exit 0 = pass)
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { Seats, Router, compilePersona, registerSeat } from "../src/rig.mjs";
import { WakeScheduler, createWakeSignal } from "../src/scheduler.mjs";
import {
  SPOOL_OPS,
  drainIntentInbox,
  intentErrorDir,
  intentResultDir,
  readIntentFiles,
  readStoppedConvIds,
  requestOp,
  runWakeLoop,
  writeIntent,
} from "../src/broker.mjs";

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(tmpdir(), "durig-spool-"));
const dbPath = join(dir, "spool.db");

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const storage = new MemoryStorage();
const harness = await Harness.open(storage, { models, registry }, ctx);

let convId;
await harness.commit(async (tx) => {
  const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
  await configure(tx, c.id, {
    model: { provider: "faux", modelId: "faux-seat" },
    instructions: compilePersona({ role: "worker" }),
  });
  await registerSeat(tx, "worker", c.id, "worker");
  convId = c.id;
}, ctx);

const resultFile = (requestId) => join(intentResultDir(dbPath), `${requestId}.json`);
const readResult = (requestId) => JSON.parse(readFileSync(resultFile(requestId), "utf8"));
const submissions = async () => (await harness.inspect(ctx)).submissions ?? [];

try {
  // 0. The vocabulary is a CLOSED list: an absent `op` defaults to "message" so producers
  //    written before the spool keep working, and a mutating verb EXTENDS this array rather
  //    than opening a second writer. The additions so far are `pause`/`unpause` (ROADMAP 131,
  //    #1841), `compact` (ROADMAP 71, #1904), `read` (D111, broker-served reads) and
  //    `configure` (D105/D106 seat-doc-write, #2182).
  assert.deepEqual(
    SPOOL_OPS,
    ["message", "stop", "reset", "compact", "pause", "unpause", "read", "configure"],
    "the spool's op vocabulary",
  );
  assert.equal(requestOp({ to: "worker", content: "hi" }), "message", "an intent with no op is a message");
  assert.equal(requestOp({ op: "stop", to: "worker" }), "stop");
  assert.equal(requestOp({ op: "pause" }), "pause");

  // 1. A MESSAGE request end-to-end through the broker loop: the seat receives it and
  //    the result channel records the outcome under the requestId.
  const R1 = "req-message-1";
  writeIntent(dbPath, { op: "message", to: "worker", from: "operator", content: "SPOOL-ALPHA", requestId: R1 });
  const looped = await runWakeLoop({
    harness,
    probeStorage: storage,
    scheduler: new WakeScheduler({ minIntervalMs: 0, seatCooldownMs: 0 }),
    signal: createWakeSignal(),
    context: ctx,
    dbPath,
    maxPasses: 1,
  });
  assert.ok(looped.passes >= 1, "the loop ran a pass");
  await harness.waitForIdle(ctx);
  const page1 = await (await harness.conversation(convId, ctx)).entries({}, 500, undefined, ctx);
  assert.equal(
    page1.items.filter((e) => JSON.stringify(e).includes("SPOOL-ALPHA")).length,
    1,
    "the message op delivered the body exactly once",
  );
  const r1 = readResult(R1);
  assert.equal(r1.ok, true, "the result channel records ok");
  assert.equal(r1.op, "message", "the result names the op");
  assert.equal(readIntentFiles(dbPath).length, 0, "an applied request leaves the spool");

  // 2. Idempotency: the SAME requestId spooled again (its file survived a crash before
  //    the unlink) is NOT applied a second time — the recorded result is the ledger.
  writeIntent(dbPath, { op: "message", to: "worker", from: "operator", content: "SPOOL-ALPHA", requestId: R1 });
  const dup = await drainIntentInbox(harness, storage, { dbPath, context: ctx });
  assert.deepEqual(dup, { delivered: 0, deadLettered: 0, duplicates: 1 }, `duplicate drain ${JSON.stringify(dup)}`);
  assert.equal(readResult(R1).at, r1.at, "the duplicate did not re-apply (result timestamp unchanged)");
  await harness.waitForIdle(ctx);
  const page2 = await (await harness.conversation(convId, ctx)).entries({}, 500, undefined, ctx);
  assert.equal(
    page2.items.filter((e) => JSON.stringify(e).includes("SPOOL-ALPHA")).length,
    1,
    "a duplicate requestId applies ONCE (no second entry)",
  );

  // 3. A MUTATING op (`stop`) end-to-end while the broker drives: a pending submission
  //    is settled `aborted:` by the broker's own writer, and the seat reads as stopped.
  await (await harness.conversation(convId, ctx)).submit({ type: "input", content: "WORK-IN-FLIGHT" }, ctx);
  const pendingBefore = (await submissions()).find((s) => s.conversationId === convId);
  assert.ok(pendingBefore, "a submission is pending before the stop request");

  const R3 = "req-stop-1";
  writeIntent(dbPath, { op: "stop", to: "worker", reason: "spool test", requestId: R3 });
  const stopped = await drainIntentInbox(harness, storage, { dbPath, context: ctx });
  assert.deepEqual(stopped, { delivered: 1, deadLettered: 0, duplicates: 0 }, `stop drain ${JSON.stringify(stopped)}`);
  const r3 = readResult(R3);
  assert.equal(r3.ok, true, "the stop applied");
  assert.equal(r3.result.seat, "worker");
  assert.equal(r3.result.settled, true, "the pending submission was settled by the broker");

  const after = (await storage.scanSubmissions({ conversationId: convId, order: "descending" }, 1, undefined, ctx))
    .items[0];
  assert.equal(after.status, "unanswered", "the submission is terminal after the stop");
  assert.match(String(after.reason ?? ""), /^aborted: spool test/, "the stop reason is recorded");
  const stoppedIds = await readStoppedConvIds(storage, { worker: { conversationId: convId } }, ctx);
  assert.ok(stoppedIds.has(convId), "the seat reads as stopped on the next pass");

  // 3b. A `reset` op draws the shared reset boundary (#402) with the broker's writer.
  const R4 = "req-reset-1";
  writeIntent(dbPath, { op: "reset", to: "worker", handoff: "RESET-HANDOFF", requestId: R4 });
  const reset = await drainIntentInbox(harness, storage, { dbPath, context: ctx });
  assert.deepEqual(reset, { delivered: 1, deadLettered: 0, duplicates: 0 }, `reset drain ${JSON.stringify(reset)}`);
  const r4 = readResult(R4);
  assert.equal(r4.ok, true, "the reset applied");
  assert.ok(r4.result.resetEntryId != null, "the result names the pi.reset entry it wrote");
  const afterReset = await (await harness.conversation(convId, ctx)).entries({}, 500, undefined, ctx);
  assert.ok(
    afterReset.items.some((e) => e.kind === "pi.reset"),
    "a pi.reset boundary is in the transcript",
  );

  // 3c. A reset for an unknown seat is REFUSED and dead-lettered by name, never a
  //     silent no-op.
  writeIntent(dbPath, { op: "reset", to: "ghost", requestId: "req-reset-ghost" });
  const ghostReset = await drainIntentInbox(harness, storage, { dbPath, context: ctx });
  assert.equal(ghostReset.deadLettered, 1, "a reset for an unknown seat is dead-lettered");

  // 4. An UNKNOWN op is dead-lettered with the known vocabulary, never applied, never
  //    retried forever. "Do not add a fourth kind" — a new verb EXTENDS the list.
  writeIntent(dbPath, { op: "teleport", to: "worker", requestId: "req-bad-op" });
  const bad = await drainIntentInbox(harness, storage, { dbPath, context: ctx });
  assert.equal(bad.deadLettered, 1, "an unknown op is dead-lettered");
  assert.equal(bad.delivered, 0, "an unknown op is not applied");
  const errs = readdirSync(intentErrorDir(dbPath)).filter((n) => n.endsWith(".error.json"));
  assert.ok(
    errs.some((n) => /unknown op/.test(readFileSync(join(intentErrorDir(dbPath), `${n}.reason`), "utf8"))),
    "the dead-letter names the unknown op",
  );

  console.log(
    "COMMAND SPOOL PASS (message end-to-end via the broker loop; duplicate requestId applies once; stop settles a live submission; reset draws the boundary; unknown op/seat dead-lettered)",
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
