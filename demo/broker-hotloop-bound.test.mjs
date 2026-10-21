// demo/broker-hotloop-bound.test.mjs — #2237: a PERSISTENTLY-throwing pass must not hot-loop,
// and `serve --stop` must terminate the loop even while an intent is pending.
//
// The observed defect (recurrence-8 follow-up, post-reboot broker pid 5840): a storage error
// threw inside every pass BEFORE `drainIntentInbox` completed, so the spooled intent files
// stayed pending. The idle branch marked the scheduler dirty whenever the inbox was non-empty,
// and `shouldRun` only checks the floor + the dirty bit — so the retry backoff (`in=60000ms`)
// was bypassed and the loop ran a pass every floor tick (the log showed `WAKE-RETRY ... pass-threw`
// every ~0.5 s, all `in=60000ms`). `serve --stop` cleared broker.json while the orphan kept looping.
//
// FAILING-FIRST: with the old idle branch this demo fails — the pass count is one per floor tick
// (dozens over 1.2 s) instead of being bounded by the backoff.
//
// Run: node demo/broker-hotloop-bound.test.mjs   (exit 0 = pass)

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { Router, registerSeat } from "../src/rig.mjs";
import { WakeScheduler, createWakeSignal } from "../src/scheduler.mjs";
import { readIntentFiles, runWakeLoop, writeIntent, writeStopRequest } from "../src/broker.mjs";

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(tmpdir(), "durig-hotloop-"));

let failures = 0;
const check = (label, cond, detail = "") => {
  if (cond) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function makeHarness() {
  const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
  const models = createModels();
  models.setProvider(faux.provider);
  const registry = createRegistry();
  registry.install(Router);
  const storage = new MemoryStorage();
  const harness = await Harness.open(storage, { models, registry }, ctx);
  return { harness, storage };
}

/** The real harness with `documentState` throwing PERSISTENTLY — the observed shape: every
 * pass throws BEFORE `drainIntentInbox` completes, so the spooled intent stays pending. */
function throwingHarness(harness) {
  const makeErr = () => {
    const inner = new Error("database is locked");
    inner.name = "SqliteError";
    const outer = new Error("session failed while reading a document");
    outer.name = "SessionFailed";
    outer.cause = inner;
    return outer;
  };
  return new Proxy(harness, {
    get(target, prop) {
      if (prop === "documentState") return () => {
        throw makeErr();
      };
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

const passCount = (logFile) =>
  existsSync(logFile) ? readFileSync(logFile, "utf8").split("\n").filter((line) => / PASS /.test(line)).length : 0;

const seedSeat = (harness) =>
  harness.commit(async (tx) => {
    const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
    await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" } });
    await registerSeat(tx, "solo", c.id, "worker");
  }, ctx);

try {
  /* ---- A. a persistent throw + a pending intent must NOT hot-loop ---- */
  console.log("\nA. a persistently-throwing pass with a pending intent is BOUNDED by the backoff");
  {
    const { harness, storage } = await makeHarness();
    const logPath = join(dir, "hotloop.db");
    const logFile = `${logPath}.broker.log`;
    try {
      await seedSeat(harness);
      // A PENDING non-read intent the throwing drain can never consume.
      writeIntent(logPath, { to: "solo", from: "operator", content: "deliver me" });
      const result = await runWakeLoop({
        harness: throwingHarness(harness),
        probeStorage: storage,
        scheduler: new WakeScheduler({ minIntervalMs: 10, seatCooldownMs: 0 }),
        signal: createWakeSignal(),
        context: ctx,
        dbPath: logPath,
        maxDurationMs: 1200,
        wakeRetryMs: 200,
        wakeRetryMaxMs: 400,
      });
      check("the intent is STILL pending (each pass threw before the drain)", readIntentFiles(logPath).length === 1, `pending=${readIntentFiles(logPath).length}`);
      const logText = readFileSync(logFile, "utf8");
      const threwPasses = (logText.match(/PASS-FAILED/g) ?? []).length;
      check("throwing passes are BOUNDED by the backoff, not one per floor tick", threwPasses >= 1 && threwPasses <= 8, `PASS-FAILED lines=${threwPasses} over 1200ms (retry 200ms->400ms)`);
      check("the throwing pass is VISIBLE in <db>.broker.log as PASS-FAILED", /PASS-FAILED/.test(logText), logText.trim().slice(0, 300));
      check("...and the cause chain is named (SessionFailed <- SqliteError)", /cause=.*SqliteError/.test(logText), logText.trim().slice(0, 300));
    } finally {
      await harness.close(ctx);
    }
  }

  /* ---- B. `serve --stop` terminates the loop even with an intent pending ---- */
  console.log("\nB. `serve --stop` stops a looping, persistently-throwing broker");
  {
    const { harness, storage } = await makeHarness();
    const stopPath = join(dir, "stop.db");
    try {
      await seedSeat(harness);
      writeIntent(stopPath, { to: "solo", from: "operator", content: "deliver me" });
      const loop = runWakeLoop({
        harness: throwingHarness(harness),
        probeStorage: storage,
        scheduler: new WakeScheduler({ minIntervalMs: 10, seatCooldownMs: 0 }),
        signal: createWakeSignal(),
        context: ctx,
        dbPath: stopPath,
        maxDurationMs: 10_000,
        wakeRetryMs: 200,
        wakeRetryMaxMs: 400,
      });
      await sleep(120);
      writeStopRequest(stopPath); // exactly what `serve --stop` writes
      const result = await loop;
      check("`serve --stop` STOPS the loop (stoppedBy=stop)", result.stoppedBy === "stop", `stoppedBy=${result.stoppedBy} passes=${result.passes}`);
    } finally {
      await harness.close(ctx);
    }
  }

  console.log(
    failures === 0
      ? "\nPASS — a persistently-throwing pass is bounded by the retry backoff, is logged as PASS-FAILED, and `serve --stop` stops it"
      : `\nFAIL — ${failures} check(s) failed`,
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exit(failures === 0 ? 0 : 1);
