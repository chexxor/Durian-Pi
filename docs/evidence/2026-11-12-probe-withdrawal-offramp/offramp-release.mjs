import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { Edges, compilePersona, registerSeat, RigQueue, Router, Seats, workable } from "../../../src/rig.mjs";
const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(tmpdir(), "offramp3-"));
const db = join(dir, "rig.sqlite");
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels(); models.setProvider(faux.provider);
const registry = createRegistry(); registry.install(Router);
const harness = await Harness.open(await openNodeSqliteStorage(db), { models, registry }, ctx);
await harness.commit(async (tx) => {
  for (const [name, role] of [["pm", "program manager"], ["impl", "implementation engineer"]]) {
    const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
    await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" }, instructions: compilePersona({ role }) });
    await registerSeat(tx, name, c.id, role);
  }
  const ed = await tx.doc(Edges);
  ed.edges = [{ from: "pm", maySendTo: ["impl"] }, { from: "impl", maySendTo: ["pm"] }];
}, ctx);
const roster = (await harness.snapshot(Seats, undefined, ctx)).seats;
const queue = async () => harness.snapshot(RigQueue, undefined, ctx);
const item = async (id) => (await queue()).items.find((i) => i.id === id);
async function call(name, tool, args) {
  faux.setResponses([fauxAssistantMessage([fauxToolCall(tool, args)], { stopReason: "toolUse" }), fauxAssistantMessage(fauxText("done"))]);
  const c = await harness.conversation(roster[name].conversationId, ctx);
  await (await c.submit({ type: "input", content: "go" }, ctx)).wait(ctx);
  const pg = await c.entries({}, 80, undefined, ctx);
  for (const e of pg.items) { const t = e.model?.[0]; if (t?.role === "toolResult") return String(t.content?.[0]?.text ?? "").slice(0, 300); }
  return "(no tool result)";
}
console.log(await call("pm", "send_work", { to: "impl", subject: "PROBE to withdraw", body: "probe", tier: "trivial" }));
const P = (await queue()).items.at(-1)?.id;
console.log(await call("pm", "send_work", { to: "impl", subject: "ROW gated on the probe", body: "gated work", blockedBy: [P], tier: "small" }));
const D = (await queue()).items.at(-1)?.id;
console.log("withdraw:", await call("pm", "cancel_work", { itemId: P, reason: "withdrawn" }));
console.log("1. pm release_work on the dead-gated row:", await call("pm", "release_work", { itemId: D, reason: "trying the off-ramp" }));
console.log("   row status:", (await item(D)).status);
console.log("2. impl hold_work on it (park without claim):", await call("impl", "hold_work", { itemId: D, reason: "parking the dead-gate row" }));
console.log("   row status:", (await item(D)).status, "park:", JSON.stringify((await item(D)).park ?? null));
console.log("3. pm release_work after the hold:", await call("pm", "release_work", { itemId: D, reason: "un-park it" }));
console.log("   row status:", (await item(D)).status);
console.log("4. impl defer_work without a claim:", await call("impl", "defer_work", { itemId: D, question: "is the gate dead?" }));
console.log("5. impl revise_work on the queued row:", await call("impl", "revise_work", { itemId: D, body: "trying to record that the gate is dead" }));
console.log("6. workable verdict:", JSON.stringify(workable(await item(D), "impl", { items: await queue().items, capabilities: ["implement", "code"] })));
await harness.close(ctx);
rmSync(dir, { recursive: true, force: true });
