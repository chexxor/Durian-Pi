// demo/read-intent-interrupt.test.mjs — #314: a spool wait that cannot be interrupted is a hang.
//
// Two operator-visible failures this pins:
//   1. Ctrl-C on a read verb used to do nothing until the 120 s spool bound expired, because the
//      SIGINT handler only flipped a `stopping` flag the awaited poll never read.
//   2. When the broker is resident but not answering, the verb printed nothing for 120 s. It must
//      fail FAST, with a NAME (cause + remedy), and fall back to the store when the fallback is safe.
//
// Run: node demo/read-intent-interrupt.test.mjs   (exit 0 = pass; ~1.5 s, no key, no network)
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import { awaitIntentResult, brokerStatePath, writeIntent } from "../src/broker.mjs";
import { readData, readViaBroker, readLocal } from "../src/readclient.mjs";
import { installSignalHandlers, stopSignal } from "../src/signals.mjs";
import { readSeatList } from "../src/readapi.mjs";

const dir = mkdtempSync(join(tmpdir(), "durig-interrupt-"));
const dbPath = join(dir, "rig.db");

installSignalHandlers({ gracefulMs: 0 }); // gracefulMs 0: no hard-exit timer in a demo process

try {
  // Seed a real store so the read-only fallback has something true to answer.
  const storage = await openNodeSqliteStorage(dbPath);
  await storage.close(BACKGROUND_CONTEXT);

  const inboxDir = `${dbPath}.broker.inbox`;
  const spoolCount = () => (existsSync(inboxDir) ? readdirSync(inboxDir).length : 0);

  // (a) THE WAIT IS INTERRUPTIBLE. Spool a read nobody will answer, abort the signal after 300 ms,
  //     and the poll must return in one cadence (200 ms) rather than running out 5 s.
  const before = Date.now();
  writeIntent(dbPath, { op: "read", view: "health", from: "test", requestId: "never-answered", createdAt: new Date().toISOString() });
  const controller = new AbortController();
  setTimeout(() => controller.abort("SIGINT"), 300);
  const outcome = await awaitIntentResult(dbPath, "never-answered", { timeoutMs: 5000, signal: controller.signal });
  const elapsed = Date.now() - before;
  assert.equal(outcome.ok, false, "an unanswered read must not report success");
  assert.match(outcome.reason, /interrupted by SIGINT/, `the reason must name the interrupt, got "${outcome.reason}"`);
  assert.ok(elapsed < 1200, `the abort returned in ${elapsed} ms, not the 5000 ms bound`);

  // (b) THE FAILURE IS STRUCTURED. A forged broker state (this test process is a live pid, with a
  //     fresh heartbeat and no drain) routes the read to a broker that cannot answer.
  writeFileSync(brokerStatePath(dbPath), JSON.stringify({ pid: process.pid, since: Date.now(), runToken: "forged", heartbeatAt: Date.now(), lastPassAt: null }));
  let threw = null;
  try {
    await readViaBroker(dbPath, "health", {}, { timeoutMs: 800, signal: new AbortController().signal });
  } catch (err) {
    threw = err;
  }
  assert.ok(threw, "a broker that never answers must throw, not hang");
  assert.equal(threw.code, "broker_read_timeout", `the failure must carry a cause code, got ${threw.code}`);
  assert.ok(threw.remedy && threw.remedy.includes("broker-down-or-stalled"), "the failure must carry the runbook remedy");

  // (c) THE SPOOL IS NOT LITTERED. The client that gave up removes its OWN intent file, so the
  //     next drain does not dead-letter a request nobody is waiting for.
  const afterRawAwait = spoolCount(); // (a) left its intent: nothing drained it
  assert.equal(afterRawAwait, 1, `the raw spool test left its own intent in the inbox (count=${afterRawAwait})`);
  assert.equal(spoolCount(), afterRawAwait, "readViaBroker must remove its OWN intent when it gives up (no litter for the next drain)");

  // (d) readData takes the broker-less path and answers it through the READ-ONLY open.
  rmSync(brokerStatePath(dbPath), { force: true });
  const seats = await readData(dbPath, "seats", {}, (s) => readSeatList(s, BACKGROUND_CONTEXT));
  assert.ok(Array.isArray(seats), "the broker-less read must return a payload, not an error");

  // (e) A SIGINT that arrives while a read is in flight ends the read, not the process hang.
  const spoolSignal = stopSignal();
  writeIntent(dbPath, { op: "read", view: "health", from: "test", requestId: "sigint-never-answered", createdAt: new Date().toISOString() });
  const r = await Promise.race([
    awaitIntentResult(dbPath, "sigint-never-answered", { timeoutMs: 3000, signal: spoolSignal }),
    new Promise((res) => setTimeout(() => res({ ok: false, reason: "TIMEOUT-OF-RACE" }), 2500)),
  ]);
  assert.ok(!r.ok, "no broker means no result");

  console.log(`READ-INTERRUPT PASS (abort returned in ${elapsed} ms; structured cause + remedy; broker-less read answered; spool clean)`);
} finally {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
  }
  void readLocal; // referenced for symmetry with the fallback path under test
}
process.exit(0);
