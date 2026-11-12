// demo/intent-spool-census.test.mjs — #6139, the LEGIBILITY half: a broker read that does not
// answer must say WHY it did not answer.
//
// "timed out awaiting the broker's result" is not a diagnosis. It is the same sentence for a
// broker parked with a queue of unread reads and for a broker whose drain ran and could not
// reach the harness. The observable that separates them is the spool: how many intents are
// undrained, how many of them are reads, and how long the oldest has waited. `pendingIntentCensus`
// makes that a number, `awaitIntentResult` puts it in the failure, and `cli.mjs status` carries
// it under `broker.spool` - a file read, so it answers even while every broker-routed read is
// timing out.
//
// Run: node demo/intent-spool-census.test.mjs   (exit 0 = pass; no model, no network, no fleet)

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import { awaitIntentResult, pendingIntentCensus, writeIntent } from "../src/broker.mjs";
import { registerSeat } from "../src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(tmpdir(), "durig-spool-census-"));
const db = join(dir, "census.db");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (label, cond, detail = "") => {
  if (cond) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
};

try {
  const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
  const models = createModels();
  models.setProvider(faux.provider);
  const registry = createRegistry();
  const storage = await openNodeSqliteStorage(db);
  const harness = await Harness.open(storage, { models, registry }, ctx);
  await harness.commit(async (tx) => {
    const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
    await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" }, instructions: "worker" });
    await registerSeat(tx, "solo", c.id, "worker");
  }, ctx);
  await harness.waitForIdle(ctx);

  check("an empty spool reads as zero, not as null", (() => {
    const c = pendingIntentCensus(db);
    return c.count === 0 && c.reads === 0 && c.mutations === 0 && c.oldestAgeMs === null;
  })(), JSON.stringify(pendingIntentCensus(db)));

  writeIntent(db, { op: "read", view: "queue", from: "cli", requestId: "r1", createdAt: new Date(Date.now() - 5000).toISOString() });
  writeIntent(db, { op: "read", view: "seats", from: "cli", requestId: "r2", createdAt: new Date(Date.now() - 1000).toISOString() });
  writeIntent(db, { op: "message", to: "solo", from: "operator", text: "spooled steer", requestId: "m1", createdAt: new Date().toISOString() });

  const census = pendingIntentCensus(db);
  check("the census counts every undrained intent", census.count === 3, JSON.stringify(census));
  check("it separates reads from mutations", census.reads === 2 && census.mutations === 1, JSON.stringify(census));
  check("it reports the OLDEST intent's age, in ms", census.oldestAgeMs >= 5000 && census.oldestAgeMs < 6000, JSON.stringify(census));
  const awaited = await awaitIntentResult(db, "r1", { timeoutMs: 300 });
  check("the wait fails - nothing drained it", !awaited.ok, awaited.reason);
  check(
    "the failure names the pending count, the read/mutation split and the oldest age",
    /pending=3/.test(awaited.reason) && /reads=2/.test(awaited.reason) && /mutations=1/.test(awaited.reason) && /oldest=\d+ms/.test(awaited.reason),
    awaited.reason,
  );
  check("and carries the census structurally, so a caller can branch on it", awaited.spool?.count === 3, JSON.stringify(awaited.spool));

  check("a malformed intent is counted, not silently skipped", (() => {
    const inbox = `${db}.broker.inbox`;
    mkdirSync(inbox, { recursive: true });
    writeFileSync(join(inbox, "9999-not-json.json"), "{truncated", "utf8");
    const c = pendingIntentCensus(db);
    return c.count === 4 && c.unreadable === 1;
  })(), JSON.stringify(pendingIntentCensus(db)));

  console.log(`\n${failures === 0 ? "SPOOL-CENSUS PASS" : `SPOOL-CENSUS FAIL (${failures} check(s))`}`);
  process.exit(failures === 0 ? 0 : 1);
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
