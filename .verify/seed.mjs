// .verify/seed.mjs — build a throwaway rig with seat `parkseat` and N held rows (no model spend).
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { registerSeat, enqueueItem, Router } from "../src/rig.mjs";
const n = Number(process.argv[2] ?? 1);
const db = process.argv[3];
const models = createModels();
models.setProvider(fauxProvider({ models: [{ id: "faux-seat" }] }).provider);
const registry = createRegistry();
registry.install(Router);
const { openNodeSqliteStorage } = await import("@earendil-works/pi-durable/storage/sqlite/node");
const harness = await Harness.open(await openNodeSqliteStorage(db), { models, registry }, BACKGROUND_CONTEXT);
await harness.commit(async (tx) => {
  const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
  await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" } });
  await registerSeat(tx, "parkseat", c.id, "implementation engineer");
  for (let i = 0; i < n; i++) {
    await enqueueItem(tx, "pm", "parkseat", `held probe row ${i}`, "parked", null, false, null, true, null, null, { reason: "backlog", resolver: "operator" });
  }
}, BACKGROUND_CONTEXT);
console.log("seeded", n, "held rows into", db);
