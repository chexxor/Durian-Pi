#!/usr/bin/env node
/* Does a gate parameter passed to revise_work SILENTLY VANISH?
   A party (allowed) calls revise_work with a blockedBy field. If the call succeeds
   and the gate is absent, the seat believes it gated the row and it did not. */
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
  for (const [n, r] of [["pm", "program manager"], ["devtools", "implementation engineer"]]) {
    const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
    await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" }, instructions: compilePersona({ role: r }) });
    await registerSeat(tx, n, c.id, r);
  }
  const ed = await tx.doc(Edges); ed.edges = [{ from: "pm", maySendTo: ["devtools"] }, { from: "devtools", maySendTo: ["pm"] }];
  await enqueueItem(tx, "pm", "devtools", "Ungated row", "body"); // #1
  await enqueueItem(tx, "pm", "devtools", "Blocker", "body", null, false, null, false, null, null, null); // #2
}, ctx);
const roster = (await harness.snapshot(Seats, undefined, ctx)).seats;
const item = async (id) => (await harness.snapshot(RigQueue, undefined, ctx)).items.find((it) => it.id === id);
async function call(name, tool, args) {
  faux.setResponses([fauxAssistantMessage([fauxToolCall(tool, args)], { stopReason: "toolUse" }), fauxAssistantMessage(fauxText("ok"))]);
  const c = await harness.conversation(roster[name].conversationId, ctx);
  await (await c.submit({ type: "input", content: "go" }, ctx)).wait(ctx);
  const pg = await c.entries({}, 50, undefined, ctx);
  return (pg.items ?? []).map((e) => {
    const m = (e.model ?? []).flatMap((x) => x.content ?? []);
    return m.map((c) => `${c.type}: ${JSON.stringify(c).slice(0, 200)}`).join(" || ");
  }).join("\n");
}
const control = await call("pm", "revise_work", { itemId: 1, body: "control revise, no gate" });
console.log("CONTROL  revise_work(body only) -> stored:", (await item(1)).body, "| transitions:", (await item(1)).transitions.map(t=>t.event+":"+t.by).join(","));
const out = await call("pm", "revise_work", { itemId: 1, body: "revised by the sender, with a gate", blockedBy: [2] });
const it = await item(1);
console.log("sender revise_work with blockedBy=[2]:");
console.log("  tool said:", out.replace(/\s+/g, " ").slice(0, 200));
console.log("  stored body:", it.body);
console.log("  stored blockedBy:", it.blockedBy ?? "(absent)");
console.log("  -> the gate", it.blockedBy ? "LANDED" : "did not land; the call was refused by the tool schema:");
console.log("  refusal text:", (out.match(/Validation failed[^"]*/i) || ["(none)"])[0]);
process.exit(0);
