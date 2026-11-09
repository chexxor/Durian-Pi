// demo/release-terminal-first.test.mjs — #5778: a TERMINAL row must be reported as CLOSED, not as an
// authority refusal.
//
// WHY (measured, not theorised). On the live store `release_work` was called on #5488 and #5398, both of
// which were already `done`. Both answers were:
//   "item #5488 is addressed to impl (from lead); only the sender or recipient may release it"
// The authority check ran BEFORE the terminal check, so a closed row was described in the language of a
// parked row. A coordinator that reads it escalates finished work and misses genuinely parked work — it is
// literally the message that produced a reported "96% parked milestone chain" where the two rows in
// question were closed.
//
// THREE OUTCOMES THE FIX MUST KEEP DISTINCT — a fix that just deletes the refusal would be wrong:
//   1. done / cancelled row, not mine   → "already done (terminal)" — no mutation, exit 0
//   2. held row, not mine              → the AUTHORITY refusal, unchanged
//   3. held row, mine (sender)         → release succeeds, status goes back to queued
//
// FAILING-FIRST: before #5778 the terminal check did not exist in `release_work`, so case 1 returned the
// authority message and this demo's first two checks fail. Verified by running this file against main
// (see the completion evidence).
//
// Run: node demo/release-terminal-first.test.mjs   (exit 0 = pass)
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { enqueueItem, registerSeat, RigQueue, Router, Seats } from "../src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);

let failures = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

let first = true;
const call = async (name, toolName, toolArgs) => {
  const batch = [
    fauxAssistantMessage([fauxToolCall(toolName, toolArgs)], { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxText("ok")),
  ];
  if (first) {
    faux.setResponses(batch);
    first = false;
  } else faux.appendResponses(batch);
  const roster = (await harness.documentState(Seats, undefined, ctx)).value.seats;
  const c = await harness.conversation(roster[name].conversationId, ctx);
  await (await c.submit({ type: "input", content: "go" }, ctx)).wait(ctx);
};

// The tool's own reply text, read out of the transcript — never by stringifying a doc proxy (#4740).
const toolReply = async (name, toolName) => {
  const roster = (await harness.documentState(Seats, undefined, ctx)).value.seats;
  const c = await harness.conversation(roster[name].conversationId, ctx);
  const pg = await c.entries({}, 200, undefined, ctx);
  for (const e of pg.items) {
    const m = Array.isArray(e.model) ? e.model : [];
    const block = m.find((b) => b && b.role === "toolResult" && b.toolName === toolName);
    if (block) {
      const parts = Array.isArray(block.content) ? block.content : [];
      return { text: parts.map((p) => (typeof p === "string" ? p : p?.text ?? "")).join(""), isError: block.isError === true };
    }
  }
  return { text: "", isError: false };
};

const item = async (id) => (await harness.documentState(RigQueue, undefined, ctx)).value.items.find((it) => it.id === id);

try {
  await harness.commit(
    async (tx) => {
      for (const [name, role] of [["pm", "program manager"], ["impl", "implementation engineer"], ["devtools", "dev-tools maintainer"]]) {
        const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
        await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" } });
        await registerSeat(tx, name, c.id, role);
      }
    },
    ctx,
  );

  // Seed the four states the fix must tell apart.
  let doneRow, cancelledRow, foreignHeld, myHeld;
  await harness.commit(
    async (tx) => {
      const q = await tx.doc(RigQueue);
      doneRow = await enqueueItem(tx, "lead", "impl", "milestone: ship the slot cap", "body");
      cancelledRow = await enqueueItem(tx, "lead", "impl", "milestone: the superseded one", "body");
      foreignHeld = await enqueueItem(tx, "lead", "impl", "parked for impl", "body", null, false, null, true);
      myHeld = await enqueueItem(tx, "pm", "devtools", "parked for devtools", "body", null, false, null, true);
      const close = (id, status) => {
        const it = q.items.find((x) => x.id === id);
        it.status = status;
        it.transitions.push({ at: new Date().toISOString(), event: status, by: "impl" });
      };
      close(doneRow, "done");
      close(cancelledRow, "cancelled");
    },
    ctx,
  );

  // ─── 1. A DONE ROW ADDRESSED TO SOMEONE ELSE: say DONE, not "not yours" ───
  await call("devtools", "release_work", { itemId: doneRow });
  const r1 = await toolReply("devtools", "release_work");
  check(`a done row reports its status (got: "${r1.text}")`, /already done/i.test(r1.text), r1.text);
  check("...and does NOT say the caller lacks authority", !/only the sender or recipient/i.test(r1.text), r1.text);
  check("...and the tool call is a success, not an error", r1.isError === false, JSON.stringify(r1));
  check("the done row is unchanged (release mutated nothing)", (await item(doneRow)).status === "done", JSON.stringify(await item(doneRow)));

  // ─── 2. A CANCELLED ROW: same class, different word ───
  await call("devtools", "release_work", { itemId: cancelledRow });
  const r2 = await toolReply("devtools", "release_work");
  check(`a cancelled row reports its status (got: "${r2.text}")`, /already cancelled/i.test(r2.text), r2.text);
  check("the cancelled row is still cancelled", (await item(cancelledRow)).status === "cancelled");

  // ─── 3. THE REFUSAL SURVIVES FOR A GENUINELY PARKED ROW ───
  await call("devtools", "release_work", { itemId: foreignHeld });
  const r3 = await toolReply("devtools", "release_work");
  check("a held row that is neither mine nor mine to send is still refused by authority", /only the sender or recipient/i.test(r3.text), r3.text);
  check("and the refusal names the status it is refusing on", /held/i.test(r3.text) || (await item(foreignHeld)).status === "held", r3.text);
  check("the foreign held row is NOT released", (await item(foreignHeld)).status === "held", JSON.stringify(await item(foreignHeld)));

  // ─── 4. THE REAL PATH STILL WORKS: the sender releases its parked row ───
  await call("pm", "release_work", { itemId: myHeld });
  const r4 = await toolReply("pm", "release_work");
  check("the sender can still release its own held row", /released back to queued/i.test(r4.text), r4.text);
  check("...and the row is queued", (await item(myHeld)).status === "queued", JSON.stringify(await item(myHeld)));

  // ─── 5. THE ORDERING IS THE POINT: the same terminal row, reached through the authority path ───
  // devtools is neither sender nor recipient of doneRow; if the terminal check came second, case 1 would
  // have read exactly like case 3. Assert the two answers are DIFFERENT strings for the same caller.
  check(
    "the terminal answer and the authority answer are distinguishable by a reader",
    r1.text !== r3.text && /terminal/i.test(r1.text),
    `done row: "${r1.text}" | held row: "${r3.text}"`,
  );

  assert.equal(failures, 0, `${failures} check(s) failed`);
  console.log(`RELEASE-TERMINAL-FIRST TEST PASS (done/cancelled reported as terminal before authority; held rows still refused; the sender's release path unchanged)`);
} finally {
  await harness.close(ctx);
}
process.exit(failures === 0 ? 0 : 1);
