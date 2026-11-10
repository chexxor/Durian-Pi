#!/usr/bin/env node
/*
 * Probe for the #6225 ruling on REVISE AUTHORITY (architect).
 * Run: node tools/probes/revise-authority.mjs   (exit 0 = probe completed; the rows are the claims)
 *
 * It answers, by running the real Router tools on a throwaway store:
 *   1. Who may edit the subject/body of a QUEUED row?
 *   2. May the coordinator that ROUTED the row touch it?
 *   3. Once claimed, may ANYONE revise - including the owner?
 *   4. Is there ANY post-intake write path for the GATE fields (blockedBy/requires/tier/block)?
 *   5. If gates exist, is a gate cycle detected?
 * Ground truth is the item's stored state and its transition log, not the tool's prose.
 */
import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { Edges, RigQueue, Router, Seats, compilePersona, enqueueItem, registerSeat, workable } from "../../src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);

await harness.commit(async (tx) => {
  for (const [name, role] of [
    ["lead", "technical lead"],
    ["pm", "program manager"],
    ["devtools", "implementation engineer"],
    ["stranger", "unaffiliated agent"],
  ]) {
    const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
    await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" }, instructions: compilePersona({ role }) });
    await registerSeat(tx, name, c.id, role);
  }
  const ed = await tx.doc(Edges);
  ed.edges = [
    { from: "lead", maySendTo: ["pm", "devtools"] },
    { from: "pm", maySendTo: ["lead", "devtools"] },
    { from: "devtools", maySendTo: ["pm", "lead"] },
  ];
  // The measured case: LEAD mints the row, DEVTOOLS owns it, PM coordinates it.
  await enqueueItem(tx, "lead", "devtools", "Mint 10 rows in one batch", "original body"); // #1
  await enqueueItem(tx, "pm", "devtools", "Ungated task", "no gate at intake", null, false, "small", false, null, null, null); // #2
}, ctx);

const roster = (await harness.snapshot(Seats, undefined, ctx)).seats;
const item = async (id) => (await harness.snapshot(RigQueue, undefined, ctx)).items.find((it) => it.id === id);
const events = async (id) => (await item(id)).transitions.map((t) => `${t.event}:${t.by}`).join(",");

async function call(name, tool, args) {
  faux.setResponses([fauxAssistantMessage([fauxToolCall(tool, args)], { stopReason: "toolUse" }), fauxAssistantMessage(fauxText("ok"))]);
  const c = await harness.conversation(roster[name].conversationId, ctx);
  await (await c.submit({ type: "input", content: "go" }, ctx)).wait(ctx);
}

const rows = [];
function probe(scenario, expect, got) {
  rows.push({ scenario, expect, got, ok: expect === got });
}

/* 1. The coordinator, not a party, tries to amend the row it routed. */
await call("pm", "revise_work", { itemId: 1, body: "PM constraint: gate at creation, return a table" });
probe("coordinator (pm, not a party) revises a queued row it routed", "original body", (await item(1)).body);

/* 2. Both parties may, while queued. */
await call("lead", "revise_work", { itemId: 1, body: "lead corrected the body" });
probe("minting party (lead) revises while queued", "lead corrected the body", (await item(1)).body);
await call("devtools", "revise_work", { itemId: 1, subject: "devtools tidied the subject" });
probe("owning party (devtools) revises while queued", "devtools tidied the subject", (await item(1)).subject);

/* 3. After a claim, nobody - not even the owner - can revise. */
await call("devtools", "claim_work", { itemId: 1 });
await call("lead", "revise_work", { itemId: 1, body: "amended under their hands" });
probe("minting party revises after the row is claimed", "lead corrected the body", (await item(1)).body);
await call("devtools", "revise_work", { itemId: 1, body: "owner amends after claim" });
probe("owning party revises its own claimed row", "lead corrected the body", (await item(1)).body);

/* 4. There is no post-intake write path for the GATE. */
await call("pm", "revise_work", { itemId: 2, blockedBy: [1] });
probe("coordinator adds a gate to a queued row via revise_work", "no gate", (await item(2)).blockedBy ? "gate landed" : "no gate");
await call("pm", "gate_work", { itemId: 2, blockedBy: [1] });
probe("there is no verb that writes a gate after intake", "no gate", (await item(2)).blockedBy ? "gate landed" : "no gate");

/* 5. A gate cycle is not detected. */
await harness.commit(async (tx) => {
  const q = await tx.doc(RigQueue);
  q.items.push({ id: 900, from: "pm", to: "devtools", subject: "A waits on B", body: "x", status: "queued", transitions: [], blockedBy: [901] });
  q.items.push({ id: 901, from: "pm", to: "devtools", subject: "B waits on A", body: "x", status: "queued", transitions: [], blockedBy: [900] });
}, ctx);
const all = (await harness.snapshot(RigQueue, undefined, ctx)).items;
const a = workable(all.find((it) => it.id === 900), "devtools", { items: all });
const b = workable(all.find((it) => it.id === 901), "devtools", { items: all });
probe("a gate cycle A->B->A terminates", "one of them workable", a.workable || b.workable ? "workable" : "both starve: " + a.reason + " / " + b.reason);

console.log("probe: revise authority  tree:", process.cwd());
for (const r of rows) console.log(`${r.ok ? "  as-is " : "  GAP   "}  ${r.scenario}  | expect=${r.expect}  got=${r.got}`);
console.log(`audit trail on #1: ${await events(1)}`);
console.log(`${rows.length} cases; ${rows.filter((r) => !r.ok).length} gap(s) measured.`);
process.exit(0);
