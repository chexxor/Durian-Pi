#!/usr/bin/env node
/*
 * #7123 review instrument - what cancellation actually does to a row that waits on it.
 * Falsifier: exit 1 while (a) cancelling a gated parent strands its dependents with no removal path,
 * (b) the notice reaches only the parent's other party, never the dependent's parties, and
 * (c) `release_work` refuses to un-park a stranded row, leaving cancel as the only exit.
 * Run: node tools/probes/stranded-gate-cascade-7123.mjs   (tree: branch item-7123, pi-durable 1.3.0)
 */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { Edges, RigQueue, Router, Seats, cancelItem, compilePersona, enqueueItem, registerSeat, workable } from "../../src/rig.mjs";
import { readFileSync } from "node:fs";

const failures = [];
const check = (green, msg) => {
  console.log(`  ${green ? "PASS" : "FAIL"}  ${msg}`);
  if (!green) failures.push(msg);
};
const measured = (m) => console.log(`  MEASURED  ${m}`);

const ctx = BACKGROUND_CONTEXT;
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels(); models.setProvider(faux.provider);
const registry = createRegistry(); registry.install(Router);
const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);

let parentId, dependentId;
let cancelMessage = "";
await harness.commit(async (tx) => {
  for (const [n, r] of [["pm", "program manager"], ["lead", "lead"], ["impl", "implementation engineer"], ["qa", "verification engineer"]]) {
    const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
    await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" }, instructions: compilePersona({ role: r }) });
    await registerSeat(tx, n, c.id, r);
  }
  const seats = await tx.doc(Seats);
  seats.seats.pm.capabilities = [];
  seats.seats.impl.capabilities = ["implement"];
  seats.seats.qa.capabilities = ["verify"];
  const ed = await tx.doc(Edges);
  ed.edges = [{ from: "pm", maySendTo: ["impl", "qa"] }, { from: "lead", maySendTo: ["impl"] }];

  parentId = await enqueueItem(tx, "lead", "impl", "the parent that will be cancelled", "body");
  dependentId = await enqueueItem(tx, "pm", "qa", "the dependent that waits on it", "body", null, false, null, false, [parentId]);
  const parent = (await tx.doc(RigQueue)).items.find((i) => i.id === parentId);
  const outcome = await cancelItem(tx, { item: parent, me: "lead", reason: "superseded" });
  cancelMessage = outcome.message;
}, ctx);

const items = (await harness.snapshot(RigQueue, undefined, ctx)).items;
const dependent = items.find((i) => i.id === dependentId);
const verdict = workable(dependent, "qa", { items, capabilities: ["verify"] });

console.log("--- 1. cancellation strands the dependent");
measured(`cancel response: "${cancelMessage}"`);
measured(`dependent #${dependentId} (pm->qa) gate: ${JSON.stringify(dependent.blockedBy)} verdict: ${JSON.stringify(verdict)}`);
check(verdict.workable === false && verdict.reason === `gate-cancelled:#${parentId}`, "the dependent is permanently unworkable after its parent is cancelled (positive non-workability, not ambiguity)");
check(cancelMessage.includes("lead") && !cancelMessage.includes("qa"), "the notice went to the parent's other party only - the dependent's parties (pm, qa) were never told");

console.log("--- 2. is there any removal path?");
const rig = readFileSync("src/rig.mjs", "utf8");
const removalSites = [...rig.matchAll(/\.blockedBy\s*=\s*(?:null|\[\])|blockedBy:\s*null/g)];
measured(`removal sites in src/rig.mjs: ${removalSites.length}`);
check(removalSites.length > 0, "GREEN requires a verb that clears a void reference; today there are 0 removal sites, so the stranded gate has no exit except cancel_work on the dependent");

console.log("--- 3. standing exists, knowledge does not");
const dead = dependent.blockedBy.find((id) => items.find((i) => i.id === id)?.status === "cancelled");
const dependentParties = new Set([dependent.from, dependent.to, dependent.block?.resolver].filter(Boolean));
const parentParties = new Set([items.find((i) => i.id === dead)?.from, items.find((i) => i.id === dead)?.to]);
measured(`dependent parties: ${[...dependentParties].join(", ")}; cancelled parent's parties: ${[...parentParties].join(", ")}`);
check(dependentParties.size > 0, "the dependent's own parties always have standing to clear the reference under the authority rule (authority binds to the row being edited), so the gap is informational, not authority");
check([...parentParties].some((p) => dependentParties.has(p)), "but the notice route can never reach them: here the parent's parties (lead, impl) are DISJOINT from the dependent's (pm, qa), so 'notify the other party' cannot inform the seat whose work is stranded");

console.log("--- 4. release is already refused on a stranded row");
check(/deadGateId\(item, queue\.items\)/.test(rig), "release_work refuses to un-park a row whose gate names a cancelled row (src/rig.mjs:1413-1415) - so a held stranded row cannot even be surfaced as claimable");

console.log("\n=== FALSIFIER ===");
console.log(failures.length ? "RED - cancellation strands dependents, notifies nobody who can act, and offers no removal path" : "GREEN - cancel records stranded dependents and a repair path exists");
await harness.close(ctx);
process.exit(failures.length ? 1 : 0);
