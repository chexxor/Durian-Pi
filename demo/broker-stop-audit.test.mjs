// demo/broker-stop-audit.test.mjs — #2322: `<db>.broker.log` must record the RECEIPT of a stop
// request, so a broker that was ASKED to stop is distinguishable from one that crashed or was
// killed (a bare `START` with neither a `STOP-REQUESTED` line nor an `EXIT`).
//
// Observed defect: the D46 audit wrote `EXIT reason=<...>` ONLY on a graceful return, so every
// broker since 2026-10-18T16:53 had a bare START and no EXIT (76 STARTs, last EXIT 16:53:55) —
// "why did the broker stop?" was unanswerable.
//
// FAILING-FIRST: before this change no `STOP-REQUESTED` line is written at all.
//
// Run: node demo/broker-stop-audit.test.mjs   (exit 0 = pass)

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { Router, registerSeat } from "../src/rig.mjs";
import { WakeScheduler, createWakeSignal } from "../src/scheduler.mjs";
import { brokerLogPath, runWakeLoop, writeStopRequest } from "../src/broker.mjs";

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(tmpdir(), "durig-stop-audit-"));

let failures = 0;
const check = (label, cond, detail = "") => {
  if (cond) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logOf = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");

async function runScenario(name, { stopViaFile = false, isStopping = () => false, maxDurationMs = 3000 } = {}) {
  const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
  const models = createModels();
  models.setProvider(faux.provider);
  const registry = createRegistry();
  registry.install(Router);
  const storage = new MemoryStorage();
  const harness = await Harness.open(storage, { models, registry }, ctx);
  const dbPath = join(dir, `${name}.db`);
  const signal = createWakeSignal();
  try {
    await harness.commit(async (tx) => {
      const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
      await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" } });
      await registerSeat(tx, "solo", c.id, "worker");
    }, ctx);
    const loop = runWakeLoop({
      harness,
      probeStorage: storage,
      scheduler: new WakeScheduler({ minIntervalMs: 10, seatCooldownMs: 0 }),
      signal,
      context: ctx,
      dbPath,
      maxDurationMs,
      isStopping,
    });
    await sleep(60);
    if (stopViaFile) writeStopRequest(dbPath);
    signal.raise(); // wake the loop from its idle wait so it re-checks immediately
    const result = await loop;
    return { result, log: logOf(brokerLogPath(dbPath)) };
  } finally {
    await harness.close(ctx);
  }
}

try {
  /* ---- A. a SIGNAL stop is recorded before termination ---- */
  console.log("\nA. a signal-driven stop is recorded as STOP-REQUESTED source=signal");
  {
    const t0 = Date.now();
    const { result, log } = await runScenario("signal", { isStopping: () => Date.now() - t0 >= 30 });
    check("the loop stopped on the signal", result.stoppedBy === "signal", `stoppedBy=${result.stoppedBy}`);
    check("the log records the RECEIPT (STOP-REQUESTED source=signal)", /STOP-REQUESTED source=signal/.test(log), log.trim().slice(0, 300));
    check("...and still closes the audit (EXIT reason=signal)", /EXIT pid=\d+ reason=signal/.test(log), log.trim().slice(0, 300));
  }

  /* ---- B. a `.stop` FILE request is recorded before termination ---- */
  console.log("\nB. a `serve --stop` file request is recorded as STOP-REQUESTED source=file");
  {
    const { result, log } = await runScenario("file", { stopViaFile: true });
    check("the loop stopped on the file request", result.stoppedBy === "stop", `stoppedBy=${result.stoppedBy}`);
    check("the log records the RECEIPT (STOP-REQUESTED source=file)", /STOP-REQUESTED source=file/.test(log), log.trim().slice(0, 300));
    check("...and still closes the audit (EXIT reason=stop)", /EXIT pid=\d+ reason=stop/.test(log), log.trim().slice(0, 300));
  }

  /* ---- C. the discriminator: a NON-stop exit must NOT look like a requested stop ---- */
  console.log("\nC. a bound exit carries EXIT but NO STOP-REQUESTED — so a bare START is a kill");
  {
    const { result, log } = await runScenario("bound", { maxDurationMs: 150 });
    check("the loop exited on the bound", result.stoppedBy === "max-duration", `stoppedBy=${result.stoppedBy}`);
    check("EXIT is written for the bound", /EXIT pid=\d+ reason=max-duration/.test(log), log.trim().slice(0, 300));
    check("...and NO STOP-REQUESTED is written (it is specific to a stop REQUEST)", !/STOP-REQUESTED/.test(log), log.trim().slice(0, 300));
  }

  console.log(
    failures === 0
      ? "\nPASS — a requested stop is recorded in <db>.broker.log before termination; a bare START with neither STOP-REQUESTED nor EXIT is a kill/crash"
      : `\nFAIL — ${failures} check(s) failed`,
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exit(failures === 0 ? 0 : 1);
