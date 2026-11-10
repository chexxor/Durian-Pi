// demo/readonly-store-parity.test.mjs — the read-only reader must answer the SAME facts.
//
// src/readonlystore.mjs is a second implementation of four Storage methods (findDocument,
// document, scanSubmissions, scanEntries) over `node:sqlite` with `readOnly: true`. Two
// implementations of one read are a drift hazard, so this demo writes a real rig into a real
// sqlite store through pi-durable, then runs the SAME readapi functions through BOTH opens and
// asserts they are byte-identical. If the shim's SQL or its delta application diverges from the
// vendor's, this test fails.
//
// Run: node demo/readonly-store-parity.test.mjs   (exit 0 = pass; ~2 s, faux model, no network)
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import { openReadOnlyStore } from "../src/readonlystore.mjs";
import { enqueueItem, registerSeat } from "../src/rig.mjs";
import { readQueueItems, readQueueCensus, readSeatList, readSeatModels, readSeatRoots } from "../src/readapi.mjs";
import { readFeed } from "../src/eventfeed.mjs";

const dir = mkdtempSync(join(tmpdir(), "durig-readonly-parity-"));
const dbPath = join(dir, "rig.db");
const ctx = BACKGROUND_CONTEXT;

try {
  const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
  const models = createModels();
  models.setProvider(faux.provider);
  const registry = createRegistry();
  const storage = await openNodeSqliteStorage(dbPath);
  const harness = await Harness.open(storage, { models, registry }, ctx);

  const conv = await harness.commit(async (tx) => {
    const c1 = await tx.createConversation({ ownership: { kind: "ownerless" } });
    const c2 = await tx.createConversation({ ownership: { kind: "ownerless" } });
    await configure(tx, c1.id, { model: { provider: "faux", modelId: "faux-seat" }, instructions: "author" });
    await configure(tx, c2.id, { model: { provider: "faux", modelId: "faux-seat" }, instructions: "verifier" });
    await registerSeat(tx, "impl", c1.id, "implementation engineer");
    await registerSeat(tx, "qa", c2.id, "quality assurance");
    return { impl: c1.id, qa: c2.id };
  }, ctx);

  await harness.commit(async (tx) => {
    await enqueueItem(tx, "operator", "impl", "first item", "body one");
    await enqueueItem(tx, "operator", "qa", "second item", "body two");
  }, ctx);

  // Entry scans, in BOTH orders, plus a forked conversation so the parent-chain walk is covered.
  // `log --follow` polls ascending with minEntryId; the backfill reads descending. A shim that
  // ignores the order silently drops entries between follow polls (found live in chatlog.test).
  const appended = await harness.commit(async (tx) => {
    let last = undefined;
    for (let i = 0; i < 6; i++) {
      last = await tx.appendEntry(conv.impl, { kind: "pi.assistant", model: [{ role: "assistant", content: [{ type: "text", text: `entry ${i}` }] }] });
    }
    return last.id;
  }, ctx);
  const forked = await harness.commit(async (tx) => {
    const child = await tx.forkConversation(conv.impl, appended, { ownership: { kind: "ownerless" } });
    await tx.appendEntry(child.id, { kind: "pi.assistant", model: [{ role: "assistant", content: [{ type: "text", text: "child entry" }] }] });
    return child.id;
  }, ctx);

  await harness.waitForIdle(ctx);
  await harness.close(ctx);
  await storage.close(ctx);

  // Both opens now see the same committed store, with no harness resident.
  const durable = await openNodeSqliteStorage(dbPath);
  const ro = openReadOnlyStore(dbPath);
  // Boundaries derived from the store, not guessed: entry ids depend on the ids the harness minted.
  const allIds = (await durable.scanEntries({ conversationId: conv.impl, order: "ascending", limit: 200 }, 200, undefined, ctx)).items.map((e) => e.id);
  const mid = allIds[3];
  const comparisons = [
    ["seats", (s) => readSeatList(s, ctx)],
    ["queue", (s) => readQueueItems(s, ctx)],
    ["queue-census", (s) => readQueueCensus(s, ctx)],
    ["seat models", (s) => readSeatModels(s, [{ name: "impl", conversationId: 1 }, { name: "qa", conversationId: 2 }], ctx)],
    ["seat roots", (s) => readSeatRoots(s, ctx)],
    ["event feed", (s) => readFeed(s, ctx, { sinceSeq: 0 })],
    ["entries desc", async (s) => (await s.scanEntries({ conversationId: conv.impl, order: "descending", limit: 3 }, 3, undefined, ctx)).items.map((e) => e.id)],
    ["entries asc", async (s) => (await s.scanEntries({ conversationId: conv.impl, order: "ascending", limit: 3 }, 3, undefined, ctx)).items.map((e) => e.id)],
    ["entries asc minEntryId", async (s) => (await s.scanEntries({ conversationId: conv.impl, order: "ascending", minEntryId: mid, limit: 200 }, 200, undefined, ctx)).items.map((e) => e.id)],
    ["entries desc maxEntryId", async (s) => (await s.scanEntries({ conversationId: conv.impl, order: "descending", maxEntryId: mid, limit: 200 }, 200, undefined, ctx)).items.map((e) => e.id)],
    ["entries asc cursor", async (s) => (await s.scanEntries({ conversationId: conv.impl, order: "ascending", limit: 2 }, 2, { after: allIds[1], order: "ascending" }, ctx)).items.map((e) => e.id)],
    ["entries desc cursor", async (s) => (await s.scanEntries({ conversationId: conv.impl, order: "descending", limit: 2 }, 2, { after: mid, order: "descending" }, ctx)).items.map((e) => e.id)],
    [`entries of a forked conversation (asc, walks the parent chain)`, async (s) => (await s.scanEntries({ conversationId: forked, order: "ascending", limit: 200 }, 200, undefined, ctx)).items.map((e) => e.id)],
    [`entries of a forked conversation (desc)`, async (s) => (await s.scanEntries({ conversationId: forked, order: "descending", limit: 4 }, 4, undefined, ctx)).items.map((e) => e.id)],
    ["submissions desc", async (s) => (await s.scanSubmissions({ conversationId: conv.impl, order: "descending" }, 2, undefined, ctx)).items.map((e) => e.id)],
  ];
  const mismatches = [];
  for (const [label, fn] of comparisons) {
    const a = await fn(durable);
    const b = await fn(ro);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      mismatches.push(`${label}: durable=${JSON.stringify(a).slice(0, 200)} readonly=${JSON.stringify(b).slice(0, 200)}`);
    }
  }
  await durable.close(ctx);
  ro.close();

  assert.equal(mismatches.length, 0, `read-only shim disagrees with pi-durable on: ${mismatches.join(" | ")}`);
  const seats = await (async () => { const r = openReadOnlyStore(dbPath); const v = await readSeatList(r, ctx); r.close(); return v; })();
  assert.equal(seats.length, 2, "the read-only path sees the two seats the rig created");
  console.log(`READONLY-PARITY PASS (${comparisons.length} views identical between pi-durable and node:sqlite readOnly; seats=${seats.length})`);
} finally {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
  }
}
process.exit(0);
