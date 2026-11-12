#!/usr/bin/env node
/* #7005 - what does the MINT seam accept today, before #7001 lands?
   Each mint is a separate enqueue; the verdict is what actually lands in the queue doc.
   Exit 0 = every assertion held; exit 1 = the named gap is present.
   Tree: this worktree (branch item-7005), pi-durable 1.3.0 from the lockfile. */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { Edges, RigQueue, Router, Seats, compilePersona, enqueueItem, registerSeat } from "../../src/rig.mjs";
import { workable } from "../../src/rig.mjs";

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
  const ed = await tx.doc(Edges);
  ed.edges = [{ from: "pm", maySendTo: ["impl"] }, { from: "impl", maySendTo: ["pm"] }];
  const q = await tx.doc(RigQueue);
  console.log("nextId at start:", q.nextId);
  // #1 the gate
  await enqueueItem(tx, "pm", "impl", "GATE row", "body");
  // #2 a cancelled row
  await enqueueItem(tx, "pm", "impl", "CANCELLED row", "body");
  const items = await tx.doc(RigQueue);
  items.items.find((it) => it.id === 2).status = "cancelled";
}, ctx);

const snap = async () => (await harness.snapshot(RigQueue, undefined, ctx)).items;

function mint(label, blockedBy) {
  return harness.commit(async (tx) => {
    const before = await tx.doc(RigQueue);
    const nextId = before.nextId;
    try {
      const id = await enqueueItem(tx, "pm", "impl", label, "body", null, false, null, false, blockedBy);
      return { id, ok: true, nextIdBefore: nextId };
    } catch (err) {
      return { ok: false, error: err.message, nextIdBefore: nextId };
    }
  }, ctx);
}

const results = [];
async function probe(label, blockedBy) {
  const r = await mint(label, blockedBy);
  const items = await snap();
  const row = r.ok ? items.find((it) => it.id === r.id) : null;
  const v = row ? workable(row, "impl", { items }) : null;
  console.log(`${label}: mint ${r.ok ? `ok id=${r.id}` : `REFUSED (${r.error})`}`);
  if (row) {
    console.log(`   stored blockedBy=${JSON.stringify(row.blockedBy ?? null)} workable=${v.workable} reason=${v.reason}`);
    console.log(`   edge target ids: ${(row.blockedBy ?? []).map((t) => t).join(", ")} (this row is id ${row.id})`);
  }
  results.push({ label, r, row, v });
  return { r, row, v };
}

console.log("--- dangling id (no such row)");
const dangling = await probe("DANGLING-9999", [9999]);
console.log("--- cancelled id");
const cancelled = await probe("CANCELLED-GATE", [2]);
console.log("--- self-gate: blockedBy names the id this row will get");
const self = await probe("SELF-GATE", [results.length + 3]); // nextId at this point
console.log("--- forward reference: gated on a row minted LATER");
const forward = await probe("FORWARD-REF", [99999]);
const later = await mint("THE-GATE-IT-NEEDS", null);
console.log(`   the gate minted after: id=${later.id}`);

console.log("\n=== INVARIANT CHECK: does every accepted edge point to an OLDER id? ===");
const items = await snap();
const violations = items.filter((it) => (it.blockedBy ?? []).some((t) => t >= it.id));
console.log("rows whose gate names an id >= its own:", violations.length ? violations.map((it) => `#${it.id} blockedBy=${JSON.stringify(it.blockedBy)}`).join("; ") : "none");

console.log("\n=== VERDICTS ===");
const gaps = [];
if (dangling.r.ok) gaps.push("mint ACCEPTS a gate id that names no row (dangling gate)");
if (cancelled.r.ok) gaps.push("mint ACCEPTS a gate on an already-cancelled row");
if (self.r.ok && self.row?.blockedBy?.includes(self.row.id)) gaps.push("mint ACCEPTS a self-gate");
if (forward.r.ok) gaps.push("mint ACCEPTS a forward reference to a row that did not exist at mint");
console.log(gaps.length ? "GAPS at the mint seam:\n  " + gaps.join("\n  ") : "mint validates the reference");
process.exit(gaps.length ? 1 : 0);
