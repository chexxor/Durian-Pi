// demo/overtaken.test.mjs — "overtaken by events" is decided by the TWIN'S STATUS, and a notice is not work.
//
// WHY THIS EXISTS. The operator asked which backlog rows can be cancelled because the world moved on
// (2026-11-12T19:3xZ). `check`'s `duplicate-item` rule prescribes "cancel #id as a duplicate of #twin" —
// and on the live rig that prescription was WRONG for 17 of 18 exact-subject pairs, because the twin was
// CANCELLED, meaning the live row is the re-issue and the survivor. Following the rule would have
// destroyed live intents. Two further traps this demo pins, both found by reading the tool's own output:
//
//   1. `terminal` is TWO states: a DONE twin means the work is complete (safe to cancel); a CANCELLED
//      twin means this row is what survived it (never cancel). One word, opposite verdicts.
//   2. a NOTICE carries another row's id in its subject (`CANCELLED #6060: …`), so the duplicate matcher
//      pairs the notice with that row — 7 of the first 14 "safe to cancel" ids were notices. A notice is
//      a RECORD; retiring it is the retention rule (#7279), never an overtaken-by-events call.
//
// Run: node demo/overtaken.test.mjs   (exit 0 = pass)

import assert from "node:assert/strict";
import { classifyOvertaken, verdictText } from "../src/overtaken.mjs";

const row = (id, status, extra = {}) => ({ id: String(id), status, blockedBy: [], notice: false, subject: `row ${id}`, ...extra });
const dup = (id, twin, overlap = 1) => ({ id: String(id), twin: String(twin), overlap });

console.log("=== 1. THE TWIN'S STATUS DECIDES — done cancels, cancelled SURVIVES ===");
{
  const rows = [row(1, "done"), row(2, "cancelled"), row(10, "held"), row(11, "queued")];
  const settled = classifyOvertaken(rows, [dup(10, 1)]);
  assert.deepEqual(settled.safeCancelIds, ["10"], "a DONE twin means the work is complete: safe to cancel");
  assert.deepEqual(settled.classes["survivor-of-cancel"], [], "and nothing is filed as a survivor");

  const survivor = classifyOvertaken(rows, [dup(11, 2)]);
  assert.deepEqual(survivor.safeCancelIds, [], "a CANCELLED twin must NOT produce a cancel");
  assert.deepEqual(survivor.classes["survivor-of-cancel"].map((r) => r.id), ["11"], "it is filed as the re-issue");
  assert.match(verdictText(survivor.counts), /DO NOT cancel/, "and the verdict says so in words a reader cannot misread");
  console.log("  ok   done ⇒ safe; cancelled ⇒ survivor; the verdict text states both");
}

console.log("\n=== 2. A NOTICE IS A RECORD, NOT AN OVERTAKEN ROW (the 7-of-14 defect) ===");
{
  // The live defect: pm's notice `CANCELLED #2712: …` was paired with #2712 and filed as "settled duplicate".
  const rows = [row(2712, "cancelled", { subject: "the real row" }), row(6660, "queued", { notice: true, subject: "CANCELLED #2712: BUILD — apply the predicate" })];
  const result = classifyOvertaken(rows, [dup(6660, 2712)]);
  assert.deepEqual(result.safeCancelIds, [], "a notice is never 'safe to cancel' as an overtaken row");
  assert.deepEqual(result.classes.notice.map((r) => r.id), ["6660"], "it is filed as a notice");
  assert.deepEqual(result.classes["survivor-of-cancel"], [], "and not as a survivor either — its lifecycle is retention (#7279)");
  assert.match(verdictText(result.counts), /retention/, "the verdict names the retention class separately");
  console.log("  ok   the notice goes to the retention class, whatever its subject names");
}

console.log("\n=== 3. A SATISFIED GATE IS NOT AN OVERTAKEN ROW — it is work that can start ===");
{
  const rows = [row(20, "done"), row(21, "queued", { blockedBy: ["20"] }), row(22, "queued", { blockedBy: ["23"] }), row(23, "queued")];
  const result = classifyOvertaken(rows, []);
  assert.deepEqual(result.classes["gate-satisfied"].map((r) => r.id), ["21"], "a row gated on a DONE row is claimable, and reported as such");
  assert.deepEqual(result.safeCancelIds, [], "it is NOT a cancellation candidate — the work still needs doing");
  assert.equal(result.classes["gate-satisfied"][0].gateDone[0], "20", "and the report names the gate that is already met");
  console.log("  ok   gate-satisfied rows are surfaced as claimable, never as cancellable");
}

console.log("\n=== 4. SILENCE WHEN THE EVIDENCE IS MISSING ===");
{
  const rows = [row(30, "held"), row(31, "queued")];
  const missingTwin = classifyOvertaken(rows, [dup(30, 999)]);
  assert.deepEqual(missingTwin.safeCancelIds, [], "an unresolved twin makes no claim: no cancel");
  assert.deepEqual(missingTwin.classes["survivor-of-cancel"], [], "and it is not called a survivor either");
  const noFindings = classifyOvertaken(rows, []);
  assert.equal(JSON.stringify(noFindings.safeCancelIds), "[]", "no findings means no candidates, not an error");
  const terminalRows = classifyOvertaken([row(40, "done"), row(41, "cancelled")], [dup(40, 41)]);
  assert.deepEqual(terminalRows.safeCancelIds, [], "terminal rows are not backlog and never candidates");
  console.log("  ok   an unresolved twin, an empty finding list and terminal rows all yield no candidates");
}

console.log("\nOVERTAKEN PASS — done cancels, cancelled survives, notices are records, satisfied gates are work");
