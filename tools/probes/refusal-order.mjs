#!/usr/bin/env node
/* #6225: does revise_work refuse a CLOSED row on AUTHORITY before STATUS?
   The #5778 fix in release_work checks terminal first. If revise_work does not,
   a coordinator reading "not yours to revise" on a done row reports a closed row
   as editable-by-someone-else. */
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
  await enqueueItem(tx, "lead", "devtools", "A closed row", "body"); // #1
}, ctx);
const roster = (await harness.snapshot(Seats, undefined, ctx)).seats;
const item = async (id) => (await harness.snapshot(RigQueue, undefined, ctx)).items.find((it) => it.id === id);
async function call(name, tool, args) {
  faux.setResponses([fauxAssistantMessage([fauxToolCall(tool, args)], { stopReason: "toolUse" }), fauxAssistantMessage(fauxText("ok"))]);
  const c = await harness.conversation(roster[name].conversationId, ctx);
  await (await c.submit({ type: "input", content: "go" }, ctx)).wait(ctx);
  const pg = await c.entries({}, 50, undefined, ctx);
  return (pg.items ?? []).flatMap((e) => (e.model ?? []).flatMap((m) => m.content ?? []))
    .filter((cc) => cc.type === "text").map((cc) => String(cc.text)).join(" ").slice(0, 250);
}
await call("devtools", "claim_work", { itemId: 1 });
await call("devtools", "complete_work", { itemId: 1, resultSummary: "finished" });
console.log("row #1 status:", (await item(1)).status);
console.log("revise_work (non-party, TERMINAL row) ->", await call("pm", "revise_work", { itemId: 1, body: "x" }));
console.log("cancel_work (non-party, TERMINAL row) ->", await call("pm", "cancel_work", { itemId: 1, reason: "stale" }));
console.log("release_work (non-party, TERMINAL row) ->", await call("pm", "release_work", { itemId: 1 }));
process.exit(0);
