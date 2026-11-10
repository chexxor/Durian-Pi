#!/usr/bin/env node
/* #6225: enumerate EVERY lever a coordinating seat has over a row it routed but did not mint.
   Run: node tools/probes/coordinator-levers.mjs */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { Edges, RigQueue, Router, Seats, compilePersona, enqueueItem, registerSeat } from "../../src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels(); models.setProvider(faux.provider);
const registry = createRegistry(); registry.install(Router);
const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);
await harness.commit(async (tx) => {
  for (const [n, r] of [["lead", "technical lead"], ["pm", "program manager"], ["devtools", "implementation engineer"]]) {
    const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
    await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" }, instructions: compilePersona({ role: r }) });
    await registerSeat(tx, n, c.id, r);
  }
  const ed = await tx.doc(Edges);
  ed.edges = [{ from: "lead", maySendTo: ["pm", "devtools"] }, { from: "pm", maySendTo: ["lead", "devtools"] }, { from: "devtools", maySendTo: ["pm", "lead"] }];
  await enqueueItem(tx, "lead", "devtools", "Row lead minted, pm coordinated", "body"); // #1
  await enqueueItem(tx, "lead", "devtools", "A row devtools will finish", "body", null, false);    // #2
  await enqueueItem(tx, "pm", "devtools", "A row PM minted itself", "body", null, false, "small", true, null, null, null); // #3: minted BY pm, HELD
}, ctx);
const roster = (await harness.snapshot(Seats, undefined, ctx)).seats;
const item = async (id) => (await harness.snapshot(RigQueue, undefined, ctx)).items.find((it) => it.id === id);
async function call(name, tool, args) {
  faux.setResponses([fauxAssistantMessage([fauxToolCall(tool, args)], { stopReason: "toolUse" }), fauxAssistantMessage(fauxText("ok"))]);
  const c = await harness.conversation(roster[name].conversationId, ctx);
  await (await c.submit({ type: "input", content: "go" }, ctx)).wait(ctx);
  const pg = await c.entries({}, 50, undefined, ctx);
  return (pg.items ?? []).flatMap((e) => (e.model ?? []).flatMap((m) => m.content ?? []))
    .filter((cc) => cc.type === "text").map((cc) => String(cc.text)).join(" ").slice(0, 220);
}
console.log("coordinator (pm) over a queued row it routed but did not mint (#1, from=lead to=devtools):");
for (const [verb, args] of [
  ["revise_work", { itemId: 1, body: "constraint" }],
  ["hold_work", { itemId: 1, reason: "gate it" }],
  ["release_work", { itemId: 1 }],
  ["cancel_work", { itemId: 1, reason: "stale" }],
  ["defer_work", { itemId: 1, question: "does this need a gate?" }],
]) {
  const r = await call("pm", verb, args);
  console.log(`  ${verb.padEnd(13)} -> ${r.includes("not yours") || r.includes("addressed to") || r.includes("Error") || r.includes("not your") ? "REFUSED" : r || "(no effect)"}`);
}
console.log("state of #1 after the attempts:", JSON.stringify({ status: (await item(1)).status, blockedBy: (await item(1)).blockedBy ?? "absent" }));
console.log("own mint, held row #3 (from=pm to=devtools):", JSON.stringify({status:(await item(3)).status, tier:(await item(3)).tier, block:(await item(3)).block ?? "absent"}));
console.log("  pm holds its own minted row ->", await call("pm", "hold_work", { itemId: 3, reason: "gate not written" }));
console.log("  pm releases its own minted row ->", await call("pm", "release_work", { itemId: 3 }));
// Make #2 genuinely TERMINAL rather than asserting it is: claim it, complete it.
console.log("  devtools claims #2 ->", (await call("devtools", "claim_work", { itemId: 2 })).slice(0, 60));
console.log("  devtools completes #2 ->", (await call("devtools", "complete_work", { itemId: 2, resultSummary: "done" })).slice(0, 60));
console.log(`  status of #2 now: ${(await item(2)).status}`);
const doneRow = await call("pm", "release_work", { itemId: 2 });
console.log(`release_work on a genuinely terminal row (#2) -> ${doneRow.slice(0, 120)}`);
process.exit(0);
