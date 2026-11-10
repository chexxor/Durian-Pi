// .verify/release.mjs — release_work equivalent on the probe rig: held -> queued.
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { registerSeat, enqueueItem, Router, RigQueue } from "../src/rig.mjs";
const db = process.argv[2];
const models = createModels();
models.setProvider(fauxProvider({ models: [{ id: "faux-seat" }] }).provider);
const registry = createRegistry();
registry.install(Router);
const { openNodeSqliteStorage } = await import("@earendil-works/pi-durable/storage/sqlite/node");
const harness = await Harness.open(await openNodeSqliteStorage(db), { models, registry }, BACKGROUND_CONTEXT);
const out = await harness.commit(async (tx) => {
  const queue = await tx.doc(RigQueue);
  const item = queue.items.find((it) => it.to === "parkseat" && it.status === "held");
  if (!item) return "no held row";
  item.status = "queued";
  item.transitions.push({ at: new Date().toISOString(), event: "released", by: "operator" });
  return `released #${item.id}`;
}, BACKGROUND_CONTEXT);
console.log(out);
