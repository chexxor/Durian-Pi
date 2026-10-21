// demo/local-reset.test.mjs — D105: a LOCAL-provider seat draws a fresh context
// boundary per NEW work item.
//
// Operator directive D105 (2026-10-18; lead #2164 seam ruling (c)): a seat whose
// RESOLVED provider is `local` (a small-window local model) must start each NEW work
// item from a clean model context, so the previous item's transcript does not crowd
// out the durable instructions. The boundary is the EXISTING `pi.reset` mechanism; the
// SIGNAL is the resolved `provider` recorded on the seat doc (set by `up`, landing-gated;
// here written directly, as `up` will); the ACT is the broker's, on the WAKE path,
// BETWEEN runs.
//
// Proves:
//   (a) the planner fires for a local seat and ONLY for the OLDEST queued item;
//   (b) a NON-LOCAL seat is never planned (paid seats unchanged);
//   (c) no boundary mid-item (a claimed item is held), over a live lease, while a run
//       is in flight, or while paused;
//   (d) exactly ONE boundary per NEW item (the `contextItemId` marker makes a re-plan a
//       no-op for the same item, and a second item draws a second boundary);
//   (e) through `drivePass`, the boundary lands BEFORE the wake and the seat STILL
//       claims and completes the item.
// Run: node demo/local-reset.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { RigQueue, Router, Seats, enqueueItem, registerSeat } from "../src/rig.mjs";
import { fillRoster, makeSeatEnv } from "../src/seattools.mjs";
import { applyLocalContextBoundaries, drivePass, planLocalContextBoundaries } from "../src/broker.mjs";

const ctx = BACKGROUND_CONTEXT;

/* ----------------------------- (a)-(d) pure planner ----------------------------- */

const localSeat = { conversationId: 1, provider: "local" };
const paidSeat = { conversationId: 2, provider: "deepinfra" };
const items = [
  { id: 10, to: "local", status: "queued" },
  { id: 11, to: "local", status: "queued" },
  { id: 12, to: "paid", status: "queued" },
];

const planned = planLocalContextBoundaries({ seats: { local: localSeat, paid: paidSeat }, items });
assert.equal(planned.length, 1, "only the local seat is planned");
assert.equal(planned[0].name, "local");
assert.equal(planned[0].itemId, 10, "the boundary targets the OLDEST queued item (claim_work's rule)");

assert.equal(
  planLocalContextBoundaries({ seats: { local: { conversationId: 1, provider: "deepinfra" } }, items }).length,
  0,
  "a non-local seat is NEVER planned (paid seats keep their durable context)",
);
assert.equal(
  planLocalContextBoundaries({ seats: { local: { conversationId: 1 } }, items }).length,
  0,
  "a seat with no recorded provider is not local and is unchanged",
);
assert.equal(
  planLocalContextBoundaries({ seats: { local: localSeat }, items: [{ id: 10, to: "local", status: "claimed" }] }).length,
  0,
  "no boundary mid-item (a claimed item is held)",
);
// #2337: `deferred` and `held` are STILL mid-item — the seat will resume them, so a boundary now
// wipes the continuation context. Reachable through the live pass (deferred/held rows live in the
// RigQueue doc the broker feeds the planner). The auditor's exact input is the last row.
assert.equal(
  planLocalContextBoundaries({ seats: { local: localSeat }, items: [{ id: 10, to: "local", status: "deferred" }] }).length,
  0,
  "no boundary mid-item (a DEFERRED item is still held by the seat)",
);
assert.equal(
  planLocalContextBoundaries({ seats: { local: localSeat }, items: [{ id: 10, to: "local", status: "held" }] }).length,
  0,
  "no boundary mid-item (a HELD item is still held by the seat)",
);
assert.deepEqual(
  planLocalContextBoundaries({
    seats: { l: { conversationId: 1, provider: "local" } },
    items: [
      { id: 10, to: "l", status: "deferred" },
      { id: 12, to: "l", status: "queued" },
    ],
  }),
  [],
  "the auditor's exact input: a deferred #10 must not draw a mid-item boundary for #12",
);
assert.equal(
  planLocalContextBoundaries({ seats: { local: localSeat }, items, busySeats: new Set(["local"]) }).length,
  0,
  "no boundary over a live generation lease",
);
assert.equal(
  planLocalContextBoundaries({ seats: { local: localSeat }, items, pendingConvIds: new Set([1]) }).length,
  0,
  "no boundary while a run is in flight",
);
assert.equal(
  planLocalContextBoundaries({ seats: { local: localSeat }, items, paused: true }).length,
  0,
  "no boundary while the rig is paused (no NEW work is taken)",
);
assert.equal(
  planLocalContextBoundaries({ seats: { local: { conversationId: 1, provider: "local", contextItemId: 10 } }, items }).length,
  0,
  "the contextItemId marker makes a re-plan for the SAME item a no-op",
);
assert.equal(
  planLocalContextBoundaries({ seats: { local: localSeat }, items: [] }).length,
  0,
  "no queued work means no boundary to draw",
);

/* ------------------------------- realized harness ------------------------------- */

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const roster = new Map();
const storage = new MemoryStorage();
const harness = await Harness.open(storage, { models, registry, env: makeSeatEnv(roster) }, ctx);

let firstId;
let secondId;
await harness.commit(async (tx) => {
  for (const [name, provider] of [
    ["localw", "local"],
    ["paidw", "deepinfra"],
  ]) {
    const conv = await tx.createConversation({ ownership: { kind: "ownerless" } });
    await configure(tx, conv.id, { model: { provider: "faux", modelId: "faux-seat" } });
    await registerSeat(tx, name, conv.id, "worker");
    (await tx.doc(Seats)).seats[name].provider = provider; // the `up` half's field, set directly
  }
  firstId = await enqueueItem(tx, "boss", "localw", "item one", "body");
  secondId = await enqueueItem(tx, "boss", "localw", "item two", "body");
  await enqueueItem(tx, "boss", "paidw", "paid item", "body");
}, ctx);

const seats = (await harness.documentState(Seats, undefined, ctx)).value.seats;
const localConv = seats.localw.conversationId;
const paidConv = seats.paidw.conversationId;

const resetCount = async (convId) => {
  const conv = await harness.conversation(convId, ctx);
  const page = await conv.entries({ order: "descending" }, 100, undefined, ctx);
  return page.items.filter((e) => e.kind === "pi.reset").length;
};
const headKind = async (convId) => {
  const conv = await harness.conversation(convId, ctx);
  const page = await conv.entries({ order: "descending" }, 1, undefined, ctx);
  return page.items[0]?.kind ?? null;
};

// (1) apply the boundary for the local seat's first item; the non-local seat is untouched.
const plans1 = planLocalContextBoundaries({ seats, items: (await harness.documentState(RigQueue, undefined, ctx)).value.items });
assert.equal(plans1.length, 1, "the local seat is planned; the non-local seat is not");
const applied1 = await applyLocalContextBoundaries(harness, plans1, ctx);
assert.equal(applied1.length, 1, "the boundary was applied");
assert.equal(await headKind(localConv), "pi.reset", "the boundary is at the HEAD of the local conversation");
assert.equal(await resetCount(localConv), 1, "exactly one boundary written");
assert.equal(await resetCount(paidConv), 0, "the non-local seat is UNCHANGED (no boundary)");

// (2) idempotent: the marker records the anchored item, so a re-plan draws nothing.
const seatsAfter1 = (await harness.documentState(Seats, undefined, ctx)).value.seats;
assert.equal(seatsAfter1.localw.contextItemId, firstId, "the boundary records the item it anchored");
const itemsAfter1 = (await harness.documentState(RigQueue, undefined, ctx)).value.items;
assert.equal(
  planLocalContextBoundaries({ seats: seatsAfter1, items: itemsAfter1 }).length,
  0,
  "no second boundary for the SAME item",
);

// (3) mid-item: while the seat holds the claimed item, no boundary is drawn.
await harness.commit(async (tx) => {
  const it = (await tx.doc(RigQueue)).items.find((i) => i.id === firstId);
  it.status = "claimed";
  it.transitions.push({ at: new Date().toISOString(), event: "claimed", by: "localw" });
}, ctx);
const itemsClaimed = (await harness.documentState(RigQueue, undefined, ctx)).value.items;
assert.equal(
  planLocalContextBoundaries({ seats: seatsAfter1, items: itemsClaimed }).length,
  0,
  "no boundary while the seat is mid-item (never drop a claimed item across the transition)",
);

// (4) the item completes; the NEXT item draws a NEW boundary (one per NEW item).
await harness.commit(async (tx) => {
  const it = (await tx.doc(RigQueue)).items.find((i) => i.id === firstId);
  it.status = "done";
}, ctx);
const items2 = (await harness.documentState(RigQueue, undefined, ctx)).value.items;
const plans2 = planLocalContextBoundaries({ seats: seatsAfter1, items: items2 });
assert.equal(plans2.length, 1, "the NEW item draws a new boundary");
assert.equal(plans2[0].itemId, secondId, "the boundary targets the new item");
await applyLocalContextBoundaries(harness, plans2, ctx);
assert.equal(await resetCount(localConv), 2, "exactly ONE boundary per NEW item (two items, two boundaries)");

await harness.close(ctx);

/* ------------------- (e) end-to-end through drivePass ------------------- */

const faux2 = fauxProvider({ models: [{ id: "faux-seat" }] });
const models2 = createModels();
models2.setProvider(faux2.provider);
const registry2 = createRegistry();
registry2.install(Router);
const roster2 = new Map();
const storage2 = new MemoryStorage();
const harness2 = await Harness.open(storage2, { models: models2, registry: registry2, env: makeSeatEnv(roster2) }, ctx);

let soloId;
await harness2.commit(async (tx) => {
  const conv = await tx.createConversation({ ownership: { kind: "ownerless" } });
  await configure(tx, conv.id, { model: { provider: "faux", modelId: "faux-seat" } });
  await registerSeat(tx, "solo", conv.id, "worker");
  (await tx.doc(Seats)).seats.solo.provider = "local";
  soloId = await enqueueItem(tx, "boss", "solo", "the only job", "body");
}, ctx);

const seats2 = (await harness2.documentState(Seats, undefined, ctx)).value.seats;
fillRoster(roster2, seats2);
const soloConv = seats2.solo.conversationId;

faux2.setResponses([
  fauxAssistantMessage([fauxToolCall("claim_work", {})], { stopReason: "toolUse" }),
  fauxAssistantMessage([fauxToolCall("complete_work", { itemId: soloId, resultSummary: "done" })], { stopReason: "toolUse" }),
  fauxAssistantMessage(fauxText("finished")),
]);

await drivePass(harness2, storage2, { context: ctx, onWoke: () => {} });

const soloConvHandle = await harness2.conversation(soloConv, ctx);
const soloPage = await soloConvHandle.entries({ order: "descending" }, 100, undefined, ctx);
assert.equal(
  soloPage.items.filter((e) => e.kind === "pi.reset").length,
  1,
  "drivePass drew the boundary before the wake",
);
const soloItem = (await harness2.documentState(RigQueue, undefined, ctx)).value.items.find((i) => i.id === soloId);
assert.equal(soloItem.status, "done", "the seat STILL claims and completes the item after the boundary");
// The boundary precedes the work: the oldest pi.reset is older than the newest tool result.
const resets = soloPage.items.filter((e) => e.kind === "pi.reset");
const completes = soloPage.items.filter((e) => e.kind === "pi.tool-result");
assert.ok(resets.length === 1 && completes.length > 0, "the boundary and the work both exist");

await harness2.close(ctx);

console.log(
  "LOCAL-RESET TEST PASS (D105: a local seat draws one fresh pi.reset per NEW item, before the wake; non-local unchanged; never mid-item/lease/in-flight/paused; the seat still completes its item)",
);
process.exit(0);
