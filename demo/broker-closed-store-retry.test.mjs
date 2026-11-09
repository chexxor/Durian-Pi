// demo/broker-closed-store-retry.test.mjs — a spooled intent whose apply fails because the
// broker's storage handle is CLOSED must NOT be silently consumed (#5822).
//
// The observed rig: 59 files in `<db>.broker.inbox.error`, EVERY ONE with the reason
// "apply failed: SqliteStorage is closed", spread over three days and correlated with the
// 43 `PASS-FAILED SessionFailed` / `HARNESS-REOPEN` lines in `<db>.broker.log`. pi-durable
// closes the Storage when its Session fails (dist/storage/sqlite/storage.js: `assertOpen()`
// -> "SqliteStorage is closed"), and the drain dead-lettered every intent it met on that
// dead handle. Nothing ever reads the error dir back, so a read that happened to land in the
// same pass as a session failure was LOST, not delayed.
//
// Failing-first: before src/broker.mjs retries a closed-store failure (instead of
// dead-lettering it) and before runWakeLoop treats it as reopen-worthy, this test dies on
// its first assertion. Run:
//   node demo/intent-retry-closed-store.test.mjs   (exit 0 = pass)
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import { compilePersona, registerSeat, Router } from "../src/rig.mjs";
import { WakeScheduler, createWakeSignal } from "../src/scheduler.mjs";
import {
  drainIntentInbox,
  INTENT_RETRY_LIMIT,
  intentErrorDir,
  isClosedStoreError,
  readIntentError,
  readIntentFiles,
  runWakeLoop,
  writeIntent,
} from "../src/broker.mjs";

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(tmpdir(), "durig-closed-store-"));
const CLOSED = "SqliteStorage is closed";
let failures = 0;
const check = (label, cond, detail) => {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label} :: ${detail}`);
  }
};
const deadLetters = (dbPath) =>
  existsSync(intentErrorDir(dbPath)) ? readdirSync(intentErrorDir(dbPath)).filter((n) => n.endsWith(".error.json")) : [];
const logOf = (dbPath) => (existsSync(`${dbPath}.broker.log`) ? readFileSync(`${dbPath}.broker.log`, "utf8") : "");

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);

async function makeRig(name) {
  const dbPath = join(dir, `${name}.db`);
  const storage = await openNodeSqliteStorage(dbPath);
  const harness = await Harness.open(storage, { models, registry }, ctx);
  await harness.commit(async (tx) => {
    const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
    await configure(tx, c.id, {
      model: { provider: "faux", modelId: "faux-seat" },
      instructions: compilePersona({ role: "worker" }),
    });
    await registerSeat(tx, "worker", c.id, "worker");
  }, ctx);
  // A SECOND handle to the same store, closed - exactly the handle a broker keeps using
  // after its Session failed: real pi-durable, real "SqliteStorage is closed".
  const closedHandle = await openNodeSqliteStorage(dbPath);
  await closedHandle.close(ctx);
  return { dbPath, storage, harness, closedHandle };
}

console.log("\nA. one closed handle: the intent is delayed, logged, and delivered after reopen");
{
  const { dbPath, storage, harness, closedHandle } = await makeRig("retry");
  const requestId = "req-retry-1";
  writeIntent(dbPath, { op: "read", view: "queue", from: "cli", requestId, createdAt: new Date().toISOString() });

  let thrown = null;
  try {
    await drainIntentInbox(harness, storage, { dbPath, context: ctx, readStorage: closedHandle });
  } catch (err) {
    thrown = err;
  }
  check(
    "the failure is the library's own closed-handle error",
    thrown instanceof Error && thrown.message.includes(CLOSED) && isClosedStoreError(thrown),
    String(thrown?.message ?? thrown),
  );
  check(
    "the intent is NOT consumed: it stays in the spool, not in the error dir",
    readIntentFiles(dbPath).length === 1 && deadLetters(dbPath).length === 0,
    `pending=${readIntentFiles(dbPath).length} deadLetters=${deadLetters(dbPath).length}`,
  );
  const log = logOf(dbPath);
  check(
    "the retry is VISIBLE in <db>.broker.log with the requestId, the count and the reason",
    /INTENT-RETRY/.test(log) && log.includes(requestId) && log.includes(CLOSED) && /attempts=1\/3/.test(log),
    log.trim().slice(-300) || "(no broker log lines)",
  );

  // The handle is reopened; the SAME intent is then delivered.
  const pendingFile = readIntentFiles(dbPath)[0];
  check("the retry attempt is recorded on the pending intent", existsSync(`${pendingFile}.retry`), `sidecar missing for ${pendingFile}`);
  const live = await openNodeSqliteStorage(dbPath);
  const recovered = await drainIntentInbox(harness, storage, { dbPath, context: ctx, readStorage: live });
  check(
    "after reopen the SAME intent is DELIVERED (nothing was lost)",
    recovered.delivered === 1 && readIntentFiles(dbPath).length === 0,
    JSON.stringify(recovered),
  );
  check("a delivered intent clears its retry sidecar", !existsSync(`${pendingFile}.retry`), `sidecar left at ${pendingFile}.retry`);
  await live.close(ctx);
  await harness.close(ctx);
  await storage.close(ctx);
}

console.log("\nB. the retry is BOUNDED: a permanently closed handle dead-letters with a readable reason");
{
  const { dbPath, storage, harness, closedHandle } = await makeRig("bound");
  const requestId = "req-bound-1";
  const diagnostics = [];
  writeIntent(dbPath, { op: "read", view: "queue", from: "cli", requestId, createdAt: new Date().toISOString() });
  for (let i = 0; i < INTENT_RETRY_LIMIT + 2; i++) {
    try {
      await drainIntentInbox(harness, storage, { dbPath, context: ctx, readStorage: closedHandle, onDiagnostic: (d) => diagnostics.push(d) });
    } catch {
      /* the drain rethrows the closed-handle error while the intent is still pending */
    }
  }
  check(
    `the intent is retried ${INTENT_RETRY_LIMIT} times, then dead-lettered (not pending forever)`,
    readIntentFiles(dbPath).length === 0 && deadLetters(dbPath).length === 1,
    `pending=${readIntentFiles(dbPath).length} deadLetters=${deadLetters(dbPath).length}`,
  );
  const surfaced = readIntentError(dbPath, requestId);
  check(
    "the producer can READ why it failed: the reason names the attempts and the cause",
    surfaced && /apply failed after \d+ attempts/.test(surfaced) && surfaced.includes(CLOSED),
    `readIntentError=${surfaced}`,
  );
  check(
    "the dead-letter record carries a STRUCTURED refusal (code, requestId, attempts)",
    (() => {
      const f = deadLetters(dbPath)[0];
      if (!f) return false;
      const rec = JSON.parse(readFileSync(join(intentErrorDir(dbPath), f), "utf8"));
      return rec.refusal?.code === "apply-failed" && rec.refusal?.requestId === requestId && rec.refusal?.attempts > INTENT_RETRY_LIMIT;
    })(),
    "no structured refusal on the dead-letter",
  );
  check(
    "each retry is reported through onDiagnostic, not only as a file",
    diagnostics.filter((d) => d.kind === "intent-retry" && d.requestId === requestId).length === INTENT_RETRY_LIMIT,
    JSON.stringify(diagnostics.map((d) => d.kind)),
  );
  const log = logOf(dbPath);
  check(
    "the log shows exactly INTENT_RETRY_LIMIT retries for one intent",
    (log.match(/INTENT-RETRY/g) ?? []).length === INTENT_RETRY_LIMIT,
    `INTENT-RETRY lines=${(log.match(/INTENT-RETRY/g) ?? []).length}`,
  );
  await harness.close(ctx);
  await storage.close(ctx);
}

console.log("\nC. the loop REOPENS on a closed handle, so the delayed intent is actually delivered");
{
  const { dbPath, storage, harness } = await makeRig("loop");
  const requestId = "req-loop-1";
  // A handle that is closed until the broker reopens it - the shape of the real failure.
  let reopened = false;
  const deadHandle = {
    async findDocument(...args) {
      if (!reopened) throw new Error(CLOSED);
      return storage.findDocument(...args);
    },
    async document(...args) {
      if (!reopened) throw new Error(CLOSED);
      return storage.document(...args);
    },
  };
  writeIntent(dbPath, { op: "read", view: "queue", from: "cli", requestId, createdAt: new Date().toISOString() });
  let reopenCalls = 0;
  const result = await runWakeLoop({
    harness,
    probeStorage: storage,
    readStorage: deadHandle,
    scheduler: new WakeScheduler({ minIntervalMs: 20, seatCooldownMs: 0 }),
    signal: createWakeSignal(),
    context: ctx,
    dbPath,
    maxDurationMs: 4000,
    wakeRetryMs: 50,
    wakeRetryMaxMs: 200,
    reopen: async () => {
      reopenCalls += 1;
      reopened = true; // the caller closes and reopens the real handles
      return {};
    },
  });
  const log = logOf(dbPath);
  check("the loop called reopen() because the handle was closed", reopenCalls >= 1, `reopenCalls=${reopenCalls} stoppedBy=${result.stoppedBy}`);
  check(
    "the intent was DELIVERED after the reopen, not dead-lettered",
    readIntentFiles(dbPath).length === 0 && deadLetters(dbPath).length === 0,
    `pending=${readIntentFiles(dbPath).length} deadLetters=${deadLetters(dbPath).length}`,
  );
  check(
    "the log names the retry AND the reopen",
    /INTENT-RETRY/.test(log) && /HARNESS-REOPEN/.test(log),
    log.trim().slice(-400),
  );
  await harness.close(ctx);
  await storage.close(ctx);
}

if (failures > 0) {
  console.error(`FAIL: ${failures} assertion(s) failed - a closed-store apply silently consumes spooled intents`);
  process.exit(1);
}
console.log("  ok   a closed-store apply retries, is bounded, is visible, and the intent lands after reopen");
