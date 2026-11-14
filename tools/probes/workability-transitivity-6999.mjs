#!/usr/bin/env node
/* #6999 - IS WORKABILITY TRANSITIVE? Three falsifiable probes against the real predicate
   and the real claim verb (src/rig.mjs `workable`, `deadGateId`, `claim_work`).

   Fixture (ids assigned in enqueue order):
     #1 gate CLOSED  (done)
     #2 gate DEAD    (cancelled)
     #3 leaf: gated on #1           -> should be workable
     #4 nested: gated on #5         -> #5 is queued AND gated on #2 (dead)
     #5 mid:  gated on #2
     #6 cycle: gated on #7; #7 gated on #6

   Exit 0 only if EVERY assertion holds. Exit 1 names the first one that does not.
   This is a probe, not a demo-suite test: run it with `node tools/probes/...` and read the exit code.
*/
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { Edges, RigQueue, Router, Seats, compilePersona, enqueueItem, registerSeat } from "../../src/rig.mjs";
import { workable, deadGateId } from "../../src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels(); models.setProvider(faux.provider);
const registry = createRegistry(); registry.install(Router);
const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);

let nextId = 0;
await harness.commit(async (tx) => {
  for (const [n, r] of [["pm", "program manager"], ["devtools", "implementation engineer"]]) {
    const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
    await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" }, instructions: compilePersona({ role: r }) });
    await registerSeat(tx, n, c.id, r);
  }
  const ed = await tx.doc(Edges);
  ed.edges = [{ from: "pm", maySendTo: ["devtools"] }, { from: "devtools", maySendTo: ["pm"] }];
  const mk = async (subject, blockedBy) => { nextId++; await enqueueItem(tx, "pm", "devtools", subject, "body", null, false, null, false, blockedBy); };
  await mk("CLOSED", null);             // #1  -> set done
  await mk("DEAD", null);               // #2  -> set cancelled
  await mk("CONTROL-gated-on-done", [1]); // #3
  await mk("MID-gated-on-dead", [2]);   // #4
  await mk("LEAF-gated-on-mid", [4]);   // #5  <- the nested chain
  await mk("CYCLE-A", [7]);             // #6
  await mk("CYCLE-B", [6]);             // #7
  const q = await tx.doc(RigQueue);
  q.items.find((it) => it.id === 1).status = "done";   // CLOSED gate
  q.items.find((it) => it.id === 2).status = "cancelled"; // DEAD gate
}, ctx);

const items = (await harness.snapshot(RigQueue, undefined, ctx)).items;
const roster = (await harness.snapshot(Seats, undefined, ctx)).seats;
const verdict = (id) => workable(items.find((it) => it.id === id), "devtools", { items, capabilities: roster.devtools.capabilities ?? [] });

const failures = [];
function check(label, expected, actual) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(actual)}${ok ? "" : ` expected ${JSON.stringify(expected)}`}`);
  if (!ok) failures.push(label);
}

console.log("--- 1. a row whose gate is done is workable (control)");
check("#3 (gated on done #1) workable", true, verdict(3).workable);

console.log("--- 2. a row whose gate is a live-but-unworkable row: what does the predicate say?");
console.log("    #5 gate #4 is queued; #4 is gated on cancelled #2.");
console.log("    verdict:", JSON.stringify(verdict(4)));
console.log("    deadGateId(#4):", JSON.stringify(deadGateId(items.find((it) => it.id === 5), items)));
check("#5 is NOT workable", false, verdict(5).workable);
check("the reason names the DEAD hop (#2), not merely the open one (#3)", "gate-cancelled:#2", verdict(5).reason);

console.log("--- 3. cycle guard: does the walk terminate?");
const t0 = Date.now();
const cycle = verdict(6);
const ms = Date.now() - t0;
console.log("    verdict:", JSON.stringify(cycle), "in", ms, "ms");
check("cycle does not hang (bounded)", true, ms < 1000);
check("cycle A->B->A is reported as a cycle, not as a plain open gate", true, /cycle|self|ancestor/.test(cycle.reason ?? ""));

console.log("--- 4. THE BY-ID CLAIM PATH: does it consult the predicate at all?");
const claimed = await (async () => {
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("claim_work", { itemId: 5 })], { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxText("ok")),
  ]);
  const c = await harness.conversation(roster.devtools.conversationId, ctx);
  await (await c.submit({ type: "input", content: "go" }, ctx)).wait(ctx);
  return (await harness.snapshot(RigQueue, undefined, ctx)).items.find((it) => it.id === 5);
})();
console.log("    claim_work(itemId=5) -> status:", claimed ? claimed.status : "(no item)", "| transitions:", claimed.transitions.map((t) => t.event + ":" + t.by).join(","));
check("an unworkable row is NOT claimable by id", "queued", claimed ? claimed.status : "(missing)");

console.log("--- 5. oldest-workable selection reports the skip reason");
const picked = (await harness.snapshot(RigQueue, undefined, ctx)).items.filter((it) => it.status === "queued");
console.log("    still queued:", picked.map((it) => `#${it.id}`).join(", ") || "(none)");

console.log("\n=== PROBE RESULT ===");
console.log(failures.length ? `FAILED (${failures.length}): ${failures.join("; ")}` : "ALL PASS");
process.exit(failures.length ? 1 : 0);
