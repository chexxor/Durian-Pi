// demo/broker-read-nopass.test.mjs — #2321: a `watch` READ poll must NOT force a wake pass.
//
// The operator requirement (2026-10-19): `node cli.mjs watch` is the operator's window into
// the team, and it polls a `read` intent every ~750 ms. Before this fix the broker's idle loop
// treated ANY inbox file as wake-relevant (`markDirty()` + `continue`), so every poll ran a
// FULL wake/supervisor pass (~80/min). Those passes' reads on the probe connection contend
// with the harness's own commits in-process, which is the hot loop that repeatedly took the
// broker down (#2237). A read is non-mutating and idempotent, so it must be served in place
// WITHOUT a pass.
//
// FAILING-FIRST: with the old idle path this demo fails — each poll adds a `PASS` line to
// `<db>.broker.log`. Run: node demo/broker-read-nopass.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { Router, compilePersona, registerSeat } from "../src/rig.mjs";
import { WakeScheduler, createWakeSignal } from "../src/scheduler.mjs";
import { awaitIntentResult, brokerLogPath, runWakeLoop, writeIntent } from "../src/broker.mjs";

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(tmpdir(), "durig-read-nopass-"));
const dbPath = join(dir, "nopass.db");

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const storage = new MemoryStorage();
const harness = await Harness.open(storage, { models, registry }, ctx);

await harness.commit(async (tx) => {
  const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
  await configure(tx, c.id, {
    model: { provider: "faux", modelId: "faux-seat" },
    instructions: compilePersona({ role: "worker" }),
  });
  await registerSeat(tx, "worker", c.id, "worker");
}, ctx);

/** How many wake passes the broker has logged (D46 `<db>.broker.log`). */
const passCount = () => {
  try {
    return readFileSync(brokerLogPath(dbPath), "utf8")
      .split("\n")
      .filter((line) => / PASS /.test(line)).length;
  } catch {
    return 0;
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let loop = null;
try {
  // NO floor: a pass runs the instant something is dirty, so any pass observed is one a poll
  // forced — never a periodic one.
  const scheduler = new WakeScheduler({ minIntervalMs: 0, seatCooldownMs: 0 });
  const signal = createWakeSignal();
  // The resident loop, bounded so the demo terminates on its own.
  loop = runWakeLoop({
    harness,
    probeStorage: storage,
    scheduler,
    signal,
    context: ctx,
    dbPath,
    maxDurationMs: 10_000,
  });

  // Prime: the loop's first pass is forced (work may have been queued before it started).
  const primedBy = Date.now() + 4000;
  while (passCount() === 0 && Date.now() < primedBy) await sleep(25);
  const passesBefore = passCount();
  assert.ok(passesBefore >= 1, `the resident loop ran its priming pass (PASS lines=${passesBefore})`);

  // A watch-like poller: 4 reads, each awaited exactly as `readViaBroker` awaits its own.
  for (let i = 0; i < 4; i += 1) {
    const requestId = `watch-poll-${i}-${process.pid}`;
    writeIntent(dbPath, {
      op: "read",
      view: "health",
      from: "cli",
      requestId,
      createdAt: new Date().toISOString(),
    });
    const outcome = await awaitIntentResult(dbPath, requestId, { timeoutMs: 8000 });
    assert.ok(outcome.ok, `read poll ${i} was served (${outcome.reason ?? "ok"})`);
  }
  const passesAfter = passCount();
  assert.equal(
    passesAfter,
    passesBefore,
    `a read poll must NOT force a wake pass (PASS ${passesBefore} -> ${passesAfter})`,
  );
  console.log(
    `BROKER READ-NO-PASS PASS (4 watch-like reads served with ZERO wake passes; PASS count stayed ${passesBefore})`,
  );
} finally {
  try {
    await loop;
  } catch (err) {
    console.error(`loop: ${err?.message ?? err}`);
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
