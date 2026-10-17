// demo/broker-inbox.test.mjs — the broker intent-inbox (delegate-owned).
//
// The gap: the resident broker is the single store writer, so a `send` (which opens
// its own harness) needs `serve --stop` to deliver intent — interrupting in-flight
// runs. The inbox is a file spool the broker drains each pass, submitting each intent
// as a real operator input, so intent can be delivered while the broker drives.
//
// Failing-first: before src/broker.mjs exports writeIntent/readIntentFiles/
// drainIntentInbox this dies with an import error. Run:
//   node demo/broker-inbox.test.mjs   (exit 0 = pass)
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { Seats, Router, compilePersona, registerSeat } from "../src/rig.mjs";
import { WakeScheduler, createWakeSignal } from "../src/scheduler.mjs";
import {
  drainIntentInbox,
  intentErrorDir,
  readIntentFiles,
  runWakeLoop,
  writeIntent,
} from "../src/broker.mjs";

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(tmpdir(), "durig-inbox-"));
const dbPath = join(dir, "inbox.db");

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

const entriesContain = async (needle) => {
  const conv = await harness.conversation(convId, ctx);
  const page = await conv.entries({}, 500, undefined, ctx);
  return page.items.some((e) => JSON.stringify(e).includes(needle));
};

try {
  // 1. The producer spools ONE atomic file; the drain delivers it and clears the spool.
  const spooled = writeIntent(dbPath, {
    to: "worker",
    from: "operator",
    content: "INTENT-ALPHA: please review the spec",
    requestId: null,
    createdAt: new Date().toISOString(),
  });
  assert.ok(spooled.includes("broker.inbox"), `spooled into the inbox dir (${spooled})`);
  assert.equal(readIntentFiles(dbPath).length, 1, "the spool holds the pending intent");

  const drained = await drainIntentInbox(harness, storage, { dbPath, context: ctx });
  assert.deepEqual(drained, { delivered: 1, deadLettered: 0, duplicates: 0 }, `drain result ${JSON.stringify(drained)}`);
  assert.equal(readIntentFiles(dbPath).length, 0, "a delivered intent leaves the spool");
  await harness.waitForIdle(ctx);
  assert.ok(await entriesContain("INTENT-ALPHA"), "the seat's conversation received the intent content");

  // 2. An unknown seat is dead-lettered with its reason, not retried forever.
  writeIntent(dbPath, { to: "ghost", from: "operator", content: "to nobody" });
  const ghost = await drainIntentInbox(harness, storage, { dbPath, context: ctx });
  assert.deepEqual(ghost, { delivered: 0, deadLettered: 1, duplicates: 0 }, `ghost drain ${JSON.stringify(ghost)}`);
  const errFiles = readdirSync(intentErrorDir(dbPath)).filter((n) => n.endsWith(".error.json"));
  assert.equal(errFiles.length, 1, "the undeliverable intent is dead-lettered");
  assert.match(readFileSync(join(intentErrorDir(dbPath), `${errFiles[0]}.reason`), "utf8"), /unknown seat/);

  // 3. An unreadable intent is dead-lettered rather than crashing the pass.
  const junk = join(dbPath + ".broker.inbox", "0000000000000001-0-junk.json");
  writeFileSync(junk, "{not json");
  const bad = await drainIntentInbox(harness, storage, { dbPath, context: ctx });
  assert.equal(bad.deadLettered, 1, "an unreadable intent is dead-lettered");
  assert.equal(bad.delivered, 0, "an unreadable intent is not delivered");

  // 4. Wiring: runWakeLoop drains the inbox on its pass (the broker path, not just the
  //    pure function). A producer may write while the loop lives; the next pass delivers.
  writeIntent(dbPath, { to: "worker", from: "operator", content: "INTENT-BETA: queued via the loop" });
  const result = await runWakeLoop({
    harness,
    probeStorage: storage,
    scheduler: new WakeScheduler({ minIntervalMs: 0, seatCooldownMs: 0 }),
    signal: createWakeSignal(),
    context: ctx,
    dbPath,
    maxPasses: 1,
  });
  assert.ok(result.passes >= 1, "the loop ran a pass");
  await harness.waitForIdle(ctx);
  assert.ok(await entriesContain("INTENT-BETA"), "runWakeLoop delivered the spooled intent through drivePass");

  // 5. The producer must never open the store: that is what makes it safe while the
  //    broker drives. Pin it structurally.
  const producer = readFileSync(new URL("../intent.mjs", import.meta.url), "utf8");
  assert.ok(!producer.includes("openNodeSqliteStorage"), "intent.mjs must not open storage");
  assert.ok(!producer.includes("new Harness") && !producer.includes("Harness.open"), "intent.mjs must not open a harness");

  console.log("BROKER INBOX PASS (spooled intent delivered by the drain and by runWakeLoop; dead-lettered on error; producer never opens the store)");
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
