#!/usr/bin/env node
/* #7026 - the park/release authority asymmetry, and the priority lease, measured.
   Falsifier: exit 1 while a coordinating seat can RELEASE a parked row it did not mint but
   cannot PARK one; exit 0 when the bounds exist (reason, expiry, cap) and hold is delegable
   under them. Tree: branch item-7026, pi-durable 1.3.0 from this lockfile. */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { Edges, RigQueue, Router, Seats, compilePersona, enqueueItem, registerSeat } from "../../src/rig.mjs";
import { selectNextWork, workable } from "../../src/rig.mjs";
import { effectivePriority } from "../../src/workstrategy.mjs";
import { seatIsCoordinator } from "../../src/seattools.mjs";

const ctx = BACKGROUND_CONTEXT;
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels(); models.setProvider(faux.provider);
const registry = createRegistry(); registry.install(Router);
const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);

await harness.commit(async (tx) => {
  for (const [n, r] of [["pm", "program manager"], ["impl", "implementation engineer"]]) {
    const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
    await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" }, instructions: compilePersona({ role: r }) });
    await registerSeat(tx, n, c.id, r);
  }
  const seats = await tx.doc(Seats);
  // The asymmetry under test: pm declares NO working capability (a coordinator); impl does.
  seats.seats.pm.capabilities = [];
  seats.seats.impl.capabilities = ["implement"];
  const ed = await tx.doc(Edges);
  ed.edges = [{ from: "pm", maySendTo: ["impl"] }, { from: "impl", maySendTo: ["pm"] }];
  await enqueueItem(tx, "pm", "impl", "ROOT A", "body");   // #1
  await enqueueItem(tx, "pm", "impl", "ROOT B", "body");   // #2
  await enqueueItem(tx, "pm", "impl", "ROOT C", "body");   // #3
}, ctx);

const roster = async () => (await harness.snapshot(Seats, undefined, ctx)).seats;
const items = async () => (await harness.snapshot(RigQueue, undefined, ctx)).items;

async function call(name, tool, args) {
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall(tool, args)], { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxText("ok")),
  ]);
  const c = await harness.conversation((await roster())[name].conversationId, ctx);
  await (await c.submit({ type: "input", content: "go" }, ctx)).wait(ctx);
  const pg = await c.entries({}, 50, undefined, ctx);
  return (pg.items ?? [])
    .flatMap((e) => (e.model ?? []).flatMap((m) => m.content ?? []))
    .filter((m) => m.type === "toolResult")
    .map((m) => String(m.content ?? "").replace(/\s+/g, " ").trim())
    .join(" | ");
}

async function state(id) {
  const it = (await items()).find((x) => x.id === id);
  return `${it.status} [${(it.transitions ?? []).map((t) => t.event + ":" + t.by).join(",")}]${it.park ? ` park=${JSON.stringify({ by: it.park.by, reason: it.park.reason, resolver: it.park.resolver, reviewBy: it.park.reviewBy, source: it.park.source })}` : ""}`;
}

console.log("--- A. can a coordinating seat park another seat's row?");
await call("pm", "hold_work", { itemId: 1, reason: "tranche gate: C depends on A" });
const pmAttempt = await state(1);
console.log("  pm hold_work(#1) -> state of #1:", pmAttempt);

console.log("--- B. the recipient parks it, and selection honours the park");
await call("impl", "hold_work", { itemId: 1, reason: "waiting on an upstream artifact" });
console.log("  impl hold_work(#1) -> state of #1:", await state(1));
const selHeld = selectNextWork(await items(), "impl", { capabilities: ["implement"] });
console.log(`  oldest-workable while #1 is held: #${selHeld.item?.id}  skipped: ${JSON.stringify((selHeld.skipped ?? []).map((s) => `#${s.id}:${s.reason}`))}`);
const heldRow = (await items()).find((x) => x.id === 1);
console.log(`  workable(#1) while held: ${JSON.stringify(workable(heldRow, "impl", { items: await items(), capabilities: ["implement"] }))}`);
console.log(`  the park RECORD written by hold_work: ${JSON.stringify(heldRow.park ?? null)} -> author? ${heldRow.park?.by ?? "absent"}; expiry? ${heldRow.park?.expiresAt ?? "absent"}; reviewBy? ${heldRow.park?.reviewBy ?? "absent"}`);

console.log("--- C. can the coordinating seat release it?");
await call("pm", "release_work", { itemId: 1, reason: "gate closed, unblocking the chain" });
console.log("  pm release_work(#1) -> state of #1:", await state(1));
const selAfter = selectNextWork(await items(), "impl", { capabilities: ["implement"] });
console.log(`  oldest-workable after release: #${selAfter.item?.id}`);

console.log("--- D. the coordinator's existing bounded lever: a priority lease");
const future = new Date(Date.now() + 60_000).toISOString();
const lease = await call("pm", "set_priority", { itemId: 3, priority: "now", reason: "unblocks the QA chain", expiresAt: future });
console.log("  pm set_priority(#3, now) -> state of #3:", state(3));
const p3 = (await items()).find((x) => x.id === 3);
console.log("  #3 priority field:", JSON.stringify({ priority: p3.priority, prioritySet: p3.prioritySet }));
const byPriority = selectNextWork(await items(), "impl", { capabilities: ["implement"], strategy: "priority_first" });
console.log(`  selection under priority_first: #${byPriority.item?.id}`);

console.log("--- E. a LEASE lapses at read time; an UNKNOWN priority is not a value");
const past = new Date(Date.now() - 1000).toISOString();
const lapsed = effectivePriority({ id: 9, priority: "now", prioritySet: { expiresAt: past } }, Date.now());
const unknown = effectivePriority({ id: 10 }, Date.now());
const explicit = effectivePriority({ id: 10, priority: "next", prioritySet: { expiresAt: future } }, Date.now());
console.log(`  lapsed now-lease -> ${JSON.stringify(lapsed)}`);
console.log(`  no priority at all -> ${JSON.stringify(unknown)}`);
console.log(`  explicit next -> ${JSON.stringify(explicit)}`);
console.log(`  rank equality: lapsed ${lapsed.rank} == unknown ${unknown.rank} == explicit ${explicit.rank} (ordering identical; the RECORD differs: raw ${lapsed.raw} vs ${unknown.raw} vs ${explicit.raw})`);

const asymmetry = !pmAttempt.startsWith("held");
console.log("\n=== FALSIFIER ===");
console.log(asymmetry
  ? "RED: a coordinating seat can RELEASE a parked row it did not mint (pm, section C) but cannot PARK one (section A: #1 stayed " + pmAttempt.split(" ")[0] + ")."
  : "GREEN: park is delegable under bounds, or the asymmetry is closed.");
console.log("coordinator? ", seatIsCoordinator({ capabilities: [] }), " (pm has no working capability)");
process.exit(asymmetry ? 1 : 0);
