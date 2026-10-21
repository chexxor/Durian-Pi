// demo/readapi-activity.test.mjs — #2229: `lastActivity` must mean ACTIVITY, not
// "the last admitted submission".
//
// The operator hit: while `qa` (a local-provider seat) was mid-generation,
// `node cli.mjs status` reported `qa.lastActivity: undefined`, so every surface keyed on
// it (the `ui.mjs` viewport) rendered an ACTIVE seat as IDLE — and the operator concluded
// "the local seats are not taking work".
//
// Root cause: `src/readapi.mjs` recovered `admittedAt` by looking up the newest
// submission's admission ENTRY inside the BOUNDED seat page. When that entry had fallen
// off the page (long conversation, or a compaction between admission and read) the field
// was OMITTED even though the seat had entries and was mid-run.
//
// Proves: (1) the normal path still sets lastActivity; (2) THE DEFECT — with a bounded
// page that does not hold the admission entry, an ACTIVE seat STILL reports lastActivity;
// (3) the honest empty state — a seat with no submissions and no entries reports NO field.
// Run: node demo/readapi-activity.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { Router, registerSeat } from "../src/rig.mjs";
import { readRigHealth } from "../src/readapi.mjs";

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(tmpdir(), "durig-readapi-activity-"));
const cwd = join(dir, "seat-workspace");
const dbPath = join(dir, "rig.sqlite");

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const storage = new MemoryStorage();
const harness = await Harness.open(storage, { models, registry }, ctx);

let activeConv;
await harness.commit(async (tx) => {
  for (const name of ["active", "idle"]) {
    const conv = await tx.createConversation({ ownership: { kind: "ownerless" } });
    await configure(tx, conv.id, { model: { provider: "faux", modelId: "faux-seat" }, cwd });
    await registerSeat(tx, name, conv.id, "worker");
    if (name === "active") activeConv = conv.id;
  }
}, ctx);

try {
  // Give the ACTIVE seat a settled run: an admitted input entry PLUS a reply entry, so a
  // page narrower than 2 entries no longer holds the admission entry.
  const conv = await harness.conversation(activeConv, ctx);
  faux.setResponses([fauxAssistantMessage(fauxText("working"))]);
  const sub = await conv.submit({ type: "input", content: "do the work" }, ctx);
  await sub.wait(ctx);

  const byName = (health, n) => (health.seats ?? []).find((s) => s.name === n);

  // (1) NORMAL path: a page wide enough to hold the admission entry.
  const wide = await readRigHealth(storage, dbPath, Infinity, { entryLimit: 50 });
  const activeWide = byName(wide, "active");
  assert.ok(activeWide, "the active seat is present in the health read");
  assert.ok(activeWide.lastActivity, "with a wide page the active seat reports lastActivity");
  assert.ok(
    !Number.isNaN(Date.parse(activeWide.lastActivity)),
    `lastActivity is ISO-8601 (got ${activeWide.lastActivity})`,
  );

  // (2) THE DEFECT: a BOUNDED page (entryLimit=1) that does NOT hold the newest
  //     submission's admission entry. Before the fix, admittedAt stayed undefined and the
  //     field was omitted -> an ACTIVE seat read as IDLE.
  const narrow = await readRigHealth(storage, dbPath, Infinity, { entryLimit: 1 });
  const activeNarrow = byName(narrow, "active");
  assert.ok(
    activeNarrow.lastActivity,
    "#2229: an ACTIVE seat STILL reports lastActivity when its admission entry is off the bounded page",
  );
  assert.ok(
    !Number.isNaN(Date.parse(activeNarrow.lastActivity)),
    `the fallback timestamp is ISO-8601 (got ${activeNarrow.lastActivity})`,
  );

  // (3) The honest empty state: a seat with no submissions and no entries reports NO field.
  assert.equal(
    byName(narrow, "idle").lastActivity,
    undefined,
    "an empty seat reports no lastActivity (no timestamp is invented)",
  );

  console.log(
    "READAPI-ACTIVITY TEST PASS (lastActivity means ACTIVITY: an active seat reports it even when its admission entry has fallen off the bounded page, while an empty seat still reports no field)",
  );
} finally {
  await harness.close(ctx);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
  }
}
process.exit(0);
