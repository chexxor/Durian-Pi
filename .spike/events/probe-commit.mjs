import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { Router, enqueueItem } from "../../src/rig.mjs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const db = join(mkdtempSync(join(tmpdir(), "probe-")), "rig.sqlite");
const models = createModels();
models.setProvider(fauxProvider({ models: [{ id: "faux-seat" }] }).provider);
const registry = createRegistry();
registry.install(Router);
const storage = await openNodeSqliteStorage(db);
const harness = await Harness.open(storage, { models, registry }, ctx);
harness.resume();
try {
  const id = await harness.commit((tx) => enqueueItem(tx, "beta", "alpha", "PROBE", "body"), ctx);
  console.log("commit ok id=" + id);
} finally {
  await harness.close(ctx);
  await storage.close(ctx);
}
