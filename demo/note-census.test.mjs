// demo/note-census.test.mjs — the per-seat continuity-note census (#6082, milestone N18 row 9).
//
// N18 row 9 says the compaction mechanism is "armed, never exercised". The census is what makes that
// claim per-seat checkable instead of store-wide and averaged:
//   1. a seat that wrote a note, read it back and was compacted ON the note reads note=written,
//      read_note 1x, compactions (note 1, digest 0, summariser 0);
//   2. the same rig WITHOUT the extension is compacted by the SUMMARISER - the control run that proves the
//      census distinguishes the two paths, not just counts entries;
//   3. a seat that never woke is REPORTED (note=none, 0 compactions) rather than silently absent;
//   4. the buckets are mutually exclusive: the extension's summary contains the note AND the digest, so
//      the three source counts must sum to the compaction count, never exceed it; and
//   5. (#6118) the verdict each seat earns is PROVEN only when the seat WROTE the note and a compaction
//      carried it. A seat whose boundary was covered by a queue seed is SEEDED - the mechanism reached it,
//      its own durability claim is still unproven. A seat with no extension is NOT-ARMED. A seat that never
//      ran is NOT-OBSERVED, not broken.
//
// No real model, no network, no broker: faux answers every request, and the proof of the note path is
// still that the summariser call never happens.
//
// Run: node demo/note-census.test.mjs  (exit 0 = pass)
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import { loadExtensions } from "../src/extensions.mjs";
import { registerSeat, RigQueue, Router } from "../src/rig.mjs";
import { compactionSource, classifySeat, noteStateIsEmpty, readNoteCensus, renderCensus } from "../src/notecensus.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(tmpdir(), "durig-note-census-"));
process.env.DURIG_NOTES_DIR = join(dir, "notes");

const SETTINGS = { compaction: { enabled: true, reserveTokens: 4096, keepRecentTokens: 6000, backgroundTokens: 9000 } };

let failures = 0;
function check(label, condition, detail = "") {
  if (!condition) failures++;
  console.log(`  ${condition ? "OK" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function openRig(storePath, { withContinuity, seatName }) {
  const storage = await openNodeSqliteStorage(storePath);
  const faux = fauxProvider({ models: [{ id: "faux-seat", contextWindow: 128000 }] });
  const models = createModels();
  models.setProvider(faux.provider);
  const registry = createRegistry();
  registry.install(Router);
  if (withContinuity) registry.install(continuityExtension);
  const harness = await Harness.open(storage, { models, registry, settings: SETTINGS }, ctx);
  harness.resume();
  const conversationId = await harness.commit(async (tx) => {
    const conv = await tx.createConversation({ ownership: { kind: "ownerless" } });
    await configure(tx, conv.id, { model: { provider: "faux", modelId: "faux-seat" } });
    await registerSeat(tx, seatName, conv.id, "implementation");
    return conv.id;
  }, ctx);
  return { harness, faux, conversationId, seatName };
}

let continuityExtension;

/* ---- 1. the vocabulary is pinned before any store is touched ---- */
console.log("\n=== 1. what the census means ===");
continuityExtension = (await loadExtensions(["extensions/continuity.mjs"], { cwd: ROOT }))[0]?.extension;
check("the extension loads (the census classifies what it writes)", !!continuityExtension);
check("a summary that carries the note is a NOTE summary",
  compactionSource("CONTINUITY NOTE for item 12\nGoal: ship it") === "note");
check("the note beats the digest when both are present (precedence, not double counting)",
  compactionSource("CONTINUITY NOTE\nDeterministic digest of 5 earlier turn(s)") === "note");
check("a digest with no note is a DIGEST summary", compactionSource("Deterministic digest of 3 earlier turn(s)") === "digest");
check("anything else came from the summariser", compactionSource("The conversation history before this point was compacted") === "summariser");
check("the untouched note state is recognised as empty",
  noteStateIsEmpty(JSON.stringify({ itemId: null, seat: null, goal: null, verified: [], hypotheses: [], constraints: [], done: [], next: null, blockers: [], worktree: null, filesTouched: [], updatedAt: null })));
check("a note with a goal is NOT empty", !noteStateIsEmpty(JSON.stringify({ goal: "ship it", itemId: 3, updatedAt: 12345 })));

/* ---- 2. a seat that woke, worked and was compacted on its note ---- */
console.log("\n=== 2. the exercised seat: note written, read back, compaction took the note ===");
const store = join(dir, "census.sqlite");
const worker = await openRig(store, { withContinuity: true, seatName: "worker" });
try {
  const conv = await worker.harness.conversation(worker.conversationId, ctx);
  await worker.harness.commit(async (tx) => {
    const queue = await tx.doc(RigQueue);
    queue.items.push({ id: queue.nextId, from: "pm", to: "worker", subject: "Close the census", body: "report it per seat", status: "queued" });
    queue.nextId += 1;
  }, ctx);
  const itemId = (await worker.harness.snapshot(RigQueue, undefined, ctx)).items[0].id;

  worker.faux.setResponses([
    fauxAssistantMessage([fauxToolCall("write_note", {
      itemId,
      goal: "Report the note census per seat.",
      verified: [{ claim: "the census reads one pass over entries", evidence: "src/notecensus.mjs" }],
      next: "wire it into status",
    })], { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxText("noted")),
  ]);
  check("the note-writing run settled", (await (await conv.submit({ type: "input", content: "note the item" }, ctx)).wait(ctx)).status === "done");

  worker.faux.setResponses([
    fauxAssistantMessage([fauxToolCall("read_note", {})], { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxText("I have the note")),
  ]);
  check("the note-reading run settled", (await (await conv.submit({ type: "input", content: "re-read the note" }, ctx)).wait(ctx)).status === "done");

  for (let i = 0; i < 20; i++) {
    worker.faux.setResponses([fauxAssistantMessage(fauxText(`ack-${i}`))]);
    await (await conv.submit({ type: "input", content: `turn-${i} ${"x".repeat(2000)} marker-${i}` }, ctx)).wait(ctx);
  }
  const callsBefore = worker.faux.state.callCount;
  const taskId = await conv.compact("fold the early turns", ctx);
  await worker.harness.waitForTask(taskId, ctx);
  check("compacting this seat cost ZERO model calls (the note IS the summary)",
    worker.faux.state.callCount === callsBefore, `before=${callsBefore} after=${worker.faux.state.callCount}`);
} finally {
  await worker.harness.close(ctx);
}

/* ---- 3. the control: the same rig, no extension, compacted by the summariser ---- */
console.log("\n=== 3. the control seat: no extension, so compaction goes to the summariser ===");
const control = await openRig(join(dir, "control.sqlite"), { withContinuity: false, seatName: "control" });
try {
  const conv = await control.harness.conversation(control.conversationId, ctx);
  for (let i = 0; i < 20; i++) {
    control.faux.setResponses([fauxAssistantMessage(fauxText(`ack-${i}`))]);
    await (await conv.submit({ type: "input", content: `turn-${i} ${"x".repeat(2000)} marker-${i}` }, ctx)).wait(ctx);
  }
  const before = control.faux.state.callCount;
  // The control seat has no note, so the harness must reach the model for the summary. faux answers it with
  // plain prose carrying neither marker - which is exactly what the census has to call "summariser".
  control.faux.setResponses([fauxAssistantMessage(fauxText("Earlier turns were about marker-0 through marker-19."))]);
  const taskId = await conv.compact("fold the early turns", ctx);
  await control.harness.waitForTask(taskId, ctx);
  check("without the note the summariser WAS called", control.faux.state.callCount > before,
    `before=${before} after=${control.faux.state.callCount}`);
} finally {
  await control.harness.close(ctx);
}

/* ---- 4. the census, read off the store the rigs just wrote ---- */
console.log("\n=== 4. the census reports all three facts per seat ===");
const census = readNoteCensus(store, {
  seats: [{ name: "worker", conversationId: worker.conversationId }, { name: "never-woke", conversationId: 9999 }],
});
const row = census.seats.find((s) => s.seat === "worker");
check("fact 1: the note document exists AND was written", row.noteDoc && row.noteWritten, `revisions=${row.noteRevisions}`);
check("fact 2: read_note was CALLED, and the count is calls, not declarations",
  row.readNoteCalls === 1 && row.writeNoteCalls === 1, `read ${row.readNoteCalls} write ${row.writeNoteCalls}`);
check("offered and used are reported separately", row.noteToolsOffered >= 1 && row.readNoteCalls === 1,
  `offered ${row.noteToolsOffered}, called ${row.readNoteCalls}`);
// The trap this census is built around: the `pi.system` entry carries the tool DECLARATIONS, so a scan for
// `"name":"read_note"` counts every turn where the tool was merely available. Prove the census counts calls.
const naive = new DatabaseSync(store, { readOnly: true })
  .prepare("select count(*) n from entries where record like ?")
  .get(`%"name":"read_note"%`).n;
check("a naive scan overcounts (declarations read as calls); the census does not",
  naive > row.readNoteCalls, `naive ${naive} vs census ${row.readNoteCalls}`);
check("fact 3: the compaction used the NOTE, not the summariser",
  row.compactionVia.note >= 1 && row.compactionVia.summariser === 0 && row.latestCompactionVia === "note",
  JSON.stringify(row.compactionVia));
check("the source buckets sum to the compaction count (no double counting)",
  row.compactionVia.note + row.compactionVia.digest + row.compactionVia.summariser === row.compactions,
  `note ${row.compactionVia.note} + digest ${row.compactionVia.digest} + summariser ${row.compactionVia.summariser} vs ${row.compactions}`);

const sleeping = census.seats.find((s) => s.seat === "never-woke");
check("a seat that never woke is REPORTED, not skipped",
  sleeping && !sleeping.noteDoc && sleeping.compactions === 0 && sleeping.readNoteCalls === 0 && sleeping.noteToolsOffered === 0 && sleeping.latestCompactionVia === null,
  JSON.stringify(sleeping));

const wholeStore = readNoteCensus(store);
check("without a seat map the rows are labelled by conversation, not invented names",
  wholeStore.seats.every((s) => s.unnamed), wholeStore.seats.map((s) => s.seat).join(","));
check("the store totals are consistent with the per-seat rows",
  wholeStore.totals.compactions === wholeStore.totals.note + wholeStore.totals.digest + wholeStore.totals.summariser,
  JSON.stringify(wholeStore.totals));
check("the rendering is one line per seat plus a header",
  renderCensus(census).split("\n").length === census.seats.length + 1, renderCensus(census));

/* ---- 5. the control store reads as the un-exercised case ---- */
console.log("\n=== 5. the control store: compaction happened, no note was involved ===");
const controlCensus = readNoteCensus(join(dir, "control.sqlite"), { seats: [{ name: "control", conversationId: control.conversationId }] });
const controlRow = controlCensus.seats[0];
check("no note document exists for a seat without the extension", !controlRow.noteDoc && !controlRow.noteWritten);
check("nothing offered the note tools, so nothing could have used them",
  controlRow.noteToolsOffered === 0 && controlRow.readNoteCalls === 0 && controlRow.writeNoteCalls === 0,
  JSON.stringify({ offered: controlRow.noteToolsOffered, read: controlRow.readNoteCalls, write: controlRow.writeNoteCalls }));
check("its compaction is attributed to the summariser", controlRow.compactionVia.summariser >= 1 && controlRow.compactionVia.note === 0,
  JSON.stringify(controlRow.compactionVia));

/* ---- 6. PROVEN vs CLAIMED, per seat (#6118) ---- */
console.log("\n=== 6. the verdict: a boundary covered by a queue seed is SEEDED, not PROVEN ===");
const seeder = await openRig(join(dir, "seeded.sqlite"), { withContinuity: true, seatName: "seeder" });
try {
  const conv = await seeder.harness.conversation(seeder.conversationId, ctx);
  await seeder.harness.commit(async (tx) => {
    const queue = await tx.doc(RigQueue);
    queue.items.push({ id: queue.nextId, from: "pm", to: "seeder", subject: "Classify proven vs claimed", body: "per seat", status: "queued" });
    queue.nextId += 1;
  }, ctx);
  for (let i = 0; i < 20; i++) {
    seeder.faux.setResponses([fauxAssistantMessage(fauxText(`ack-${i}`))]);
    await (await conv.submit({ type: "input", content: `turn-${i} ${"x".repeat(2000)} marker-${i}` }, ctx)).wait(ctx);
  }
  const seededBefore = seeder.faux.state.callCount;
  const seededTask = await conv.compact("fold the early turns", ctx);
  await seeder.harness.waitForTask(seededTask, ctx);
  check("the seed path costs zero model calls too", seeder.faux.state.callCount === seededBefore, `before=${seededBefore} after=${seeder.faux.state.callCount}`);
} finally {
  await seeder.harness.close(ctx);
}
const seededRow = readNoteCensus(join(dir, "seeded.sqlite"), { seats: [{ name: "seeder", conversationId: seeder.conversationId }] }).seats[0];
check("the wake seed makes the doc have content, but it is the RIG writing, not the seat",
  seededRow.noteDoc && seededRow.noteWritten && !seededRow.noteAuthored && seededRow.writeNoteCalls === 0,
  JSON.stringify({ doc: seededRow.noteDoc, written: seededRow.noteWritten, authored: seededRow.noteAuthored, writeCalls: seededRow.writeNoteCalls }));
check("a compaction did carry a note-shaped summary", seededRow.compactionVia.note >= 1, JSON.stringify(seededRow.compactionVia));
check("the seed was written at the wake, so the era shows the conversation armed before the compaction",
  seededRow.compactionEra.armedAt !== null && seededRow.compactionEra.predatesArming === 0,
  JSON.stringify(seededRow.compactionEra));
check("so the verdict is SEEDED, not PROVEN - the seat has nothing durable of its own", seededRow.verdict === "seeded" && seededRow.owner === "seat", `${seededRow.verdict} / ${seededRow.owner} - ${seededRow.why}`);
check("the seat that wrote a note and was compacted on it is PROVEN", row.verdict === "proven" && row.owner === "none", `${row.verdict} / ${row.owner}`);
check("the seat whose extension was never loaded is NOT-ARMED and the operator owns it", controlRow.verdict === "not-armed" && controlRow.owner === "operator", `${controlRow.verdict} / ${controlRow.owner}`);
check("a seat that never ran AND holds nothing is IDLE, owned by routing, not a coverage failure",
  sleeping.verdict === "idle" && sleeping.owner === "pm" && sleeping.heldWork === 0,
  `${sleeping.verdict} / ${sleeping.owner} — ${sleeping.why}`);
const heldButUncompacted = readNoteCensus(join(dir, "seeded.sqlite"), {
  seats: [{ name: "never-woke", conversationId: 9999 }],
  queue: [{ id: 1, to: "never-woke", status: "claimed" }],
}).seats[0];
check("a seat that holds work but has never been compacted is NOT-OBSERVED, not idle",
  heldButUncompacted.verdict === "not-observed" && heldButUncompacted.heldWork === 1,
  `${heldButUncompacted.verdict} — ${heldButUncompacted.why}`);
check("the era splits compactions, so a pre-arming summariser is never read as a defect",
  controlRow.compactionEra.predatesArming === 1 && controlRow.compactionEra.afterArming === 0 && controlRow.verdict === "not-armed",
  JSON.stringify({ era: controlRow.compactionEra, verdict: controlRow.verdict }));
check("the header states the split before any per-seat line", renderCensus(census).split("\n")[0].startsWith("continuity notes: PROVEN 1 of 2"), renderCensus(census).split("\n")[0]);
check("classifySeat is pure and answers without a store",
  classifySeat({ noteWritten: true, noteAuthored: true, compactions: 5, compactionVia: { note: 0, digest: 0, summariser: 5 }, noteToolsOffered: 3, compactionEra: { armedAt: 10, predatesArming: 5, afterArming: 0, afterArmingVia: { note: 0, digest: 0, summariser: 0 }, firstNoteWriteAt: 40, predatesFirstWrite: 5, afterFirstWriteSummariser: 0 } }).verdict === "predates-arming",
  "compactions that predate the extension being armed are history, not a failure rate");
check("post-arming summariser compactions after the note existed are a mechanism defect",
  classifySeat({ noteWritten: true, noteAuthored: true, compactions: 5, compactionVia: { note: 0, digest: 0, summariser: 3 }, noteToolsOffered: 3, compactionEra: { armedAt: 10, predatesArming: 2, afterArming: 3, afterArmingVia: { note: 0, digest: 0, summariser: 3 }, firstNoteWriteAt: 20, predatesFirstWrite: 0, afterFirstWriteSummariser: 3 } }).verdict === "path-not-reached",
  "the only shape that is a real defect");
check("post-arming summariser compactions that all predate the first note write stay OPEN, not a defect",
  classifySeat({ noteWritten: true, noteAuthored: true, compactions: 5, compactionVia: { note: 0, digest: 0, summariser: 3 }, noteToolsOffered: 3, compactionEra: { armedAt: 10, predatesArming: 2, afterArming: 3, afterArmingVia: { note: 0, digest: 0, summariser: 3 }, firstNoteWriteAt: 60, predatesFirstWrite: 3, afterFirstWriteSummariser: 0 } }).verdict === "claimed-only",
  "the row cannot prove a defect, only a gap in observation");
check("an armed compaction that carried neither a note nor a seed is DIGEST-ONLY, owned by the seat",
  classifySeat({ noteWritten: false, noteAuthored: false, compactions: 4, compactionVia: { note: 0, digest: 4, summariser: 0 }, noteToolsOffered: 2, heldWork: 0, compactionEra: { armedAt: 5, predatesArming: 0, afterArming: 4, afterArmingVia: { note: 0, digest: 4, summariser: 0 }, firstNoteWriteAt: null, predatesFirstWrite: 0, afterFirstWriteSummariser: 0 } }).verdict === "digest-only",
  "nothing written, nothing held at the boundary");

rmSync(dir, { recursive: true, force: true });

console.log(`\n${failures === 0 ? "PASS" : "FAIL"}: ${failures} failed check(s) — demo/note-census.test.mjs`);
process.exit(failures === 0 ? 0 : 1);
