#!/usr/bin/env node
/* #6225 — the authority boundary over a queue row, measured.
   Six questions, one run:
     1. who may revise a QUEUED row's intent?
     2. can ANY seat attach a gate to a row after it is minted?
     3. does a schema-rejected field drop the legitimate half of the same call?
     4. is a refused action reported by AUTHORITY or by TERMINALITY first?
     5. can the sender park its own queued row (park vs release symmetry)?
     6. what does a gate pointing at a nonexistent / cancelled id do?
   Run: node tools/probes/revise-authority-boundary.mjs   (exit 0 = probe ran) */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { Edges, RigQueue, Router, Seats, compilePersona, enqueueItem, registerSeat, workable } from "../../src/rig.mjs";

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
  await enqueueItem(tx, "lead", "devtools", "Row lead minted, pm coordinates it", "original intent", null, true, "small", false, null, null, null); // #1
  await enqueueItem(tx, "lead", "devtools", "A row already DONE", "body", null, true, null, true, null, null, null);                        // #2 terminal
  await enqueueItem(tx, "pm", "devtools", "Row pm minted and left QUEUED", "body", null, true, null, false, null, null, null);             // #3
  await enqueueItem(tx, "devtools", "pm", "Gate probe: gated on a nonexistent id", "body", [9999], true, null, false, null, null, null);  // #4
  await enqueueItem(tx, "devtools", "pm", "Gate probe: gated on a row that becomes CANCELLED", "body", [3], true, null, false, null, null, null);       // #5
}, ctx);
const roster = (await harness.snapshot(Seats, undefined, ctx)).seats;
const item = async (id) => (await harness.snapshot(RigQueue, undefined, ctx)).items.find((it) => it.id === id);
async function call(name, tool, args) {
  faux.setResponses([fauxAssistantMessage([fauxToolCall(tool, args)], { stopReason: "toolUse" }), fauxAssistantMessage(fauxText("ok"))]);
  const c = await harness.conversation(roster[name].conversationId, ctx);
  await (await c.submit({ type: "input", content: "go" }, ctx)).wait(ctx);
  const pg = await c.entries({}, 50, undefined, ctx);
  return (pg.items ?? []).flatMap((e) => (e.model ?? []).flatMap((m) => m.content ?? []))
    .filter((cc) => cc.type === "text").map((cc) => String(cc.text)).join(" ").replace(/\n/g, " ").slice(0, 160);
}
const line = (l, r) => console.log("  " + l.padEnd(52) + " " + r);
console.log("Q1 who may revise a QUEUED row's intent (#1 from=lead to=devtools)?");
line("pm (coordinator, NOT a party) revise_work", await call("pm", "revise_work", { itemId: 1, body: "pm's constraint on the row it routed" }));
line("lead (sender) revise_work", await call("lead", "revise_work", { itemId: 1, body: "sender edits intent" }));
line("devtools (recipient) revise_work", await call("devtools", "revise_work", { itemId: 1, body: "recipient edits intent" }));
console.log("Q2 can ANY seat attach a gate after minting?");
line("sender revise_work with blockedBy", await call("lead", "revise_work", { itemId: 1, body: "edit + gate", blockedBy: [3] }));
console.log("Q3 did the LEGITIMATE half of that rejected call land? stored body = " + (await item(1)).body);
console.log("Q4 refusal order: authority first, or terminality first?");
line("pm revise_work on a DONE row", await call("pm", "revise_work", { itemId: 2, body: "x" }));
line("pm cancel_work on a DONE row", await call("pm", "cancel_work", { itemId: 2, reason: "x" }));
line("pm release_work on a DONE row", await call("pm", "release_work", { itemId: 2 }));
console.log("Q5 park vs release symmetry for the SENDER of a QUEUED row (#3 from=pm to=devtools)");
line("pm hold_work on its own queued row", await call("pm", "hold_work", { itemId: 3, reason: "not ripe yet" }));
line("pm cancel_work on its own queued row", await call("pm", "cancel_work", { itemId: 3, reason: "no longer worth doing" }));
console.log("Q6 gate hygiene: what does workable() do with a dangling or cancelled gate?");
const items = (await harness.snapshot(RigQueue, undefined, ctx)).items;
line("#4 blockedBy=[9999] (no such item)", JSON.stringify(workable(await item(4), "pm", { items, capabilities: [] })));
line("#5 blockedBy=[2] (item 2 is DONE)", JSON.stringify(workable(await item(5), "pm", { items, capabilities: [] })));
line("item 3 final status", (await item(3)).status);
await harness.close(ctx);
