// demo/cli-sigint-exits.test.mjs — Ctrl-C ENDS the verb, it does not queue a request to stop.
//
// The operator bug (#314): with a broker resident that cannot answer, `cli.mjs watch --once`
// sat for the full 120 s spool bound and Ctrl-C did nothing, because the SIGINT handler only
// set a `stopping` flag on a loop that was already inside an await. src/signals.mjs makes the
// signal abort the wait itself, and cli.mjs exits 130.
//
// The wedge is forged deterministically: a real store, a `<db>.broker.json` naming a pid that
// is genuinely alive (a child `sleep`-like node process) with a fresh heartbeat and no drain.
// No model, no network, no broker process — the shape is the defect, not the load.
//
// Run: node demo/cli-sigint-exits.test.mjs   (exit 0 = pass; ~6 s)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import { brokerStatePath } from "../src/broker.mjs";
import { compilePersona, registerSeat } from "../src/rig.mjs";

const CLI = join(process.cwd(), "cli.mjs");
const dir = mkdtempSync(join(tmpdir(), "durig-sigint-"));
const dbPath = join(dir, "rig.db");
const ctx = BACKGROUND_CONTEXT;

/** Run one verb, raise SIGINT at `signalAtMs`, return how it exited. */
function verbWithSignal(args, signalAtMs, env = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(process.execPath, [CLI, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, DURIG_DB: dbPath, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    let signalledAt = null;
    const sigTimer = setTimeout(() => {
      signalledAt = Date.now();
      p.kill("SIGINT");
    }, signalAtMs);
    // Outer bound so the measurement itself can never hang the suite.
    const hard = setTimeout(() => { try { p.kill("SIGKILL"); } catch {} }, 20_000);
    p.on("close", (code, sig) => {
      clearTimeout(sigTimer);
      clearTimeout(hard);
      resolve({
        code: code ?? (sig === "SIGINT" ? 130 : null),
        signal: sig,
        wallMs: Date.now() - t0,
        afterSignalMs: signalledAt ? Date.now() - signalledAt : null,
        bytes: out.length,
        out: out.slice(0, 200),
      });
    });
  });
}

/** A pid that is really alive and definitely not a broker. */
function liveFakePid() {
  const c = spawn(process.execPath, ["-e", "setTimeout(() => process.exit(0), 30000)"], { stdio: "ignore" });
  return c;
}

try {
  const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
  const models = createModels();
  models.setProvider(faux.provider);
  const registry = createRegistry();
  const storage = await openNodeSqliteStorage(dbPath);
  const harness = await Harness.open(storage, { models, registry }, ctx);
  await harness.commit(async (tx) => {
    const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
    await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" }, instructions: compilePersona({ role: "worker" }) });
    await registerSeat(tx, "worker", c.id, "worker");
  }, ctx);
  await harness.waitForIdle(ctx);
  await harness.close(ctx);
  await storage.close(ctx);

  const fake = liveFakePid();
  const forge = () => {
    writeFileSync(brokerStatePath(dbPath), JSON.stringify({ pid: fake.pid, since: Date.now(), runToken: "forged-wedge", heartbeatAt: Date.now(), lastPassAt: null }));
  };

  for (const verb of [["watch", "--once", "--json"], ["status", "--json"], ["queue", "--json", "--no-body"]]) {
    forge();
    const r = await verbWithSignal(verb, 1200);
    assert.ok(r.afterSignalMs !== null, `${verb.join(" ")} was never signalled`);
    assert.ok(r.afterSignalMs <= 2000, `${verb.join(" ")} must exit within 2 s of Ctrl-C; took ${r.afterSignalMs} ms`);
    assert.equal(r.code, 130, `${verb.join(" ")} must exit 130 on Ctrl-C, got ${r.code} (signal ${r.signal})`);
    console.log(`SIGINT ${verb.join(" ")}: exit ${r.code} ${r.afterSignalMs} ms after the signal, ${r.bytes} bytes`);
  }

  // The control: with NO broker state, the same verbs answer through the store and exit 0.
  rmSync(brokerStatePath(dbPath), { force: true });
  const local = await verbWithSignal(["status", "--local", "--json"], 19_000);
  assert.equal(local.code, 0, `a broker-less --local read must succeed (got ${local.code}: ${local.out})`);
  assert.ok(local.bytes > 100, "the broker-less read must produce a payload");
  console.log(`LOCAL-READ control: exit ${local.code}, ${local.bytes} bytes in ${local.wallMs} ms`);

  fake.kill();
  console.log("SIGINT-EXITS PASS (3 verbs interrupted in <=2 s with code 130; broker-less read answered)");
} finally {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
  }
}
process.exit(0);
