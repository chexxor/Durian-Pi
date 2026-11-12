// demo/queue-control-spool.test.mjs — the operator/delegate QUEUE-CONTROL spool op, end to end.
//
// WHY THIS EXISTS. The operator ratified propose-and-apply for the delegate (2026-11-12T17:5xZ) and
// asked for real control over the queue. `cli.mjs` cannot write while a broker drives
// (`refuseWhileBrokerDrives`), so the control plane in resident mode IS the spool: a request the broker
// applies with its own harness. This demo proves the op the ruling needs:
//
//   1. PROPOSE is the default — a queue request with no `apply` changes NOTHING and returns the exact
//      transitions it would append (so "what would this do" and "do it" are the same code path);
//   2. APPLY appends transitions and mutates the row, and every transition names the actor and the
//      AUTHORITY (`delegate (operator-authorised)`), because a change nobody can attribute is a change
//      nobody can review;
//   3. the DO NOTHING defect is fixed: a row gated on a CANCELLED row is reported as stranded, and the
//      `repair-gates` action releases exactly that dead gate (the 151 measured on this rig, plus the two
//      live casualties #3503/#5885 of the zero-build close);
//   4. AUTHORIZATION is real, not a comment: a seat identity is refused for a queue-control op, while the
//      operator and the delegate are both admitted.
//
// Run: node demo/queue-control-spool.test.mjs   (exit 0 = pass)

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { RigQueue, registerSeat } from "../src/rig.mjs";
import {
  SPOOL_OPS,
  authorizeSpoolRequest,
  drainIntentInbox,
  intentErrorDir,
  readIntentResult,
  writeIntent,
} from "../src/broker.mjs";

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(tmpdir(), "durig-queue-ctl-"));
const dbPath = join(dir, "ctl.db");

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(RigQueue);
const storage = new MemoryStorage();
const harness = await Harness.open(storage, { models, registry }, ctx);

let convId;
await harness.commit(async (tx) => {
  const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
  await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" }, instructions: "work" });
  await registerSeat(tx, "impl", c.id, "worker");
  convId = c.id;
}, ctx);

// The measured shape: a cancelled prerequisite, two dependents stranded by it, one claimed row, one
// plain queued row. Ids are chosen to match the live rig's casualties (#3503/#5885 on cancelled #3377).
await harness.commit(async (tx) => {
  const q = await tx.doc(RigQueue);
  const push = (id, status, extra) =>
    q.items.push({ id, from: "pm", to: "impl", subject: `row ${id}`, body: "", status, transitions: [], ...extra });
  push(3377, "cancelled", { subject: "LANDING LIST (docs-only) — scribe-item-1257" });
  push(3503, "held", { blockedBy: [3377], subject: "REGISTERED (held, gated on #3377)" });
  push(5885, "held", { blockedBy: [3377], to: "pm", subject: "SUCCESSOR to #5322 (parked, gated on #3377)" });
  push(4000, "queued", { subject: "a plain queued row" });
  push(4001, "claimed", { subject: "a row being worked right now" });
  q.nextId = 5000;
}, ctx);

const readItems = async () => (await harness.snapshot(RigQueue, undefined, ctx)).items.map((i) => ({
  id: String(i.id),
  status: i.status,
  priority: i.priority ?? null,
  prioritySet: i.prioritySet ? JSON.parse(JSON.stringify(i.prioritySet)) : null,
  blockedBy: (i.blockedBy ?? []).map(String),
  transitions: (i.transitions ?? []).map((t) => ({ event: t.event, by: t.by, authority: t.authority ?? null, gate: t.gate ?? null })),
}));

/** Spool one queue request, drain it with the broker's own harness, and return the recorded result. */
async function run(request) {
  const requestId = `demo-${Math.random().toString(16).slice(2)}`;
  writeIntent(dbPath, { op: "queue", to: "queue", from: "delegate", requestId, createdAt: new Date().toISOString(), ...request });
  await drainIntentInbox(harness, storage, { dbPath, context: ctx });
  const result = readIntentResult(dbPath, requestId);
  if (result) return result;
  // A REFUSED request is dead-lettered, not answered: read the reason from the error channel so the
  // demo asserts what a producer would actually see (a silent null is exactly the "accepted and
  // ignored" class this rig keeps paying for).
  const errDir = intentErrorDir(dbPath);
  const files = readdirSync(errDir).filter((f) => f.endsWith(".error.json")).sort();
  if (files.length === 0) return null;
  const file = files[files.length - 1];
  // The REASON lives in a sibling `.reason` file (deadLetterIntent); the JSON body is the original
  // request, which also carries the caller's own `reason` field — reading that by mistake is how a
  // refusal gets misreported as "x".
  const reasonText = readFileSync(join(errDir, `${file}.reason`), "utf8").trim();
  const body = JSON.parse(readFileSync(join(errDir, file), "utf8"));
  return { ok: false, error: reasonText, code: body.refusal?.code ?? null };
}

console.log("=== 1. THE OP IS DECLARED, AND A SEAT IS REFUSED ===");
assert.ok(SPOOL_OPS.includes("queue"), "`queue` is part of the spool vocabulary (a new mutating verb EXTENDS the list)");
assert.equal(authorizeSpoolRequest({ op: "queue", from: "delegate" }).allowed, true, "the delegate is admitted to queue control");
assert.equal(authorizeSpoolRequest({ op: "queue", from: "operator" }).code, "operator-queue-control", "the operator is admitted under its own code");
assert.equal(authorizeSpoolRequest({ op: "queue", from: "impl" }).allowed, false, "a SEAT cannot mutate the queue through the spool");
assert.equal(authorizeSpoolRequest({ op: "queue", from: "impl" }).code, "not-operator-plane", "and the refusal is a structured code a producer can read");
assert.equal(authorizeSpoolRequest({ op: "pause", from: "delegate" }).allowed, false, "the delegate is NOT admitted to control-plane ops (pause/config stay the operator's)");
console.log("  ok   queue is declared; delegate + operator admitted; a seat and the wider control plane are not");

console.log("\n=== 2. PROPOSE IS THE DEFAULT AND WRITES NOTHING ===");
const before = await readItems();
const census = await run({ action: "stranded", apply: false });
assert.equal(census.ok, true, "the census request is applied");
assert.equal(census.result.census.count, 2, "the two rows gated on cancelled #3377 are reported stranded");
assert.deepEqual(census.result.census.rows.map((r) => r.id).sort(), ["3503", "5885"], "and they are named, with their seat and gate");
const proposed = await run({ action: "repair-gates", apply: false, reason: "propose only" });
assert.equal(proposed.result.applied, 0, "no apply flag: nothing was written");
assert.equal(proposed.result.proposed, 2, "but the plan says exactly two changes");
assert.equal(proposed.result.transitions[0].event, "gate-released", "and the transition it would append");
assert.deepEqual(await readItems(), before, "the queue is byte-for-byte unchanged after a propose");
console.log("  ok   census = 2 stranded; propose returns the plan and mutates nothing");

console.log("\n=== 3. APPLY REPAIRS THE DEAD GATE AND ATTRIBUTES THE CHANGE ===");
const applied = await run({ action: "repair-gates", apply: true, reason: "prerequisite cancelled" });
assert.equal(applied.result.applied, 2, "two rows repaired");
const afterRepair = await readItems();
for (const id of ["3503", "5885"]) {
  const row = afterRepair.find((r) => r.id === id);
  assert.deepEqual(row.blockedBy, [], `#${id} no longer carries the dead gate`);
  const t = row.transitions.find((x) => x.event === "gate-released");
  assert.ok(t, `#${id} records the repair as a transition`);
  assert.equal(t.by, "delegate");
  assert.equal(t.authority, "delegate (operator-authorised)", "the transition carries the AUTHORITY, not just a name");
}
const other = afterRepair.find((r) => r.id === "4000");
assert.deepEqual(other.blockedBy, [], "an unrelated row is untouched");
console.log("  ok   both stranded rows released, transitions attributed, unrelated rows untouched");

console.log("\n=== 4. PRIORITY IS A LEASE, APPLIED WITH ITS AUTHORITY ===");
const until = new Date(Date.now() + 3600_000).toISOString();
const prio = await run({ action: "priority", ids: ["4000"], priority: "now", reason: "operator: landing is the priority", expiresAt: until, apply: true });
assert.equal(prio.result.applied, 1, "one row leased");
const leased = (await readItems()).find((r) => r.id === "4000");
assert.equal(leased.priority, "now", "the row is prioritised");
assert.equal(leased.prioritySet.expiresAt, until, "the lease records its expiry (urgency cannot become a permanent park)");
assert.equal(leased.prioritySet.authority, "delegate (operator-authorised)", "and who leased it");
const claimed = await run({ action: "priority", ids: ["4001"], priority: "now", reason: "x", expiresAt: until, apply: true });
assert.equal(claimed.ok, false, "a claimed row is refused");
assert.match(String(claimed.error ?? ""), /claimed/, "and a CLAIMED row is refused: ordering it races the turn acting on it");
console.log("  ok   lease applied with expiry + authority; a claimed row is refused with its reason");

console.log("\n=== 5. A CANCEL NAMES WHAT IT WOULD STRAND ===");
const cancel = await run({ action: "cancel", ids: ["4000"], reason: "superseded", apply: false });
assert.equal(cancel.result.strands.length, 0, "#4000 has no dependents, so nothing would be stranded");
assert.equal(cancel.result.proposed, 1, "the cancel is planned");
const stillQueued = (await readItems()).find((r) => r.id === "4000");
assert.equal(stillQueued.status, "queued", "a proposed cancel does not cancel");
const cancelled = await run({ action: "cancel", ids: ["4000"], reason: "superseded", apply: true });
assert.equal(cancelled.result.applied, 1, "applied");
assert.equal((await readItems()).find((r) => r.id === "4000").status, "cancelled", "the row is terminal");
const badClaimed = await run({ action: "cancel", ids: ["4001"], reason: "wip", apply: true });
assert.match(String(badClaimed.error ?? ""), /preempt/, "cancelling a claimed row names the safe mechanism instead");
console.log("  ok   strands reported, propose does not cancel, apply does, claimed row refused");

console.log("\n=== 6. THE BLAST-RADIUS RULE AND THE ERROR CHANNEL ===");
const manyIds = ["3503", "5885"]; // small: no confirmation needed
const small = await run({ action: "priority", ids: manyIds, priority: "next", reason: "x", expiresAt: until, apply: true });
assert.equal(small.result.applied, 2, "a small plan applies without confirmation");
const unknown = await run({ action: "cancel", ids: ["424242"], reason: "x", apply: true });
assert.equal(unknown.ok, false, "an unknown id is refused rather than silently ignored");
assert.match(String(unknown.error ?? ""), /unknown item/, "the refusal is dead-lettered with its REASON, not swallowed");
const errDir = intentErrorDir(dbPath);
assert.ok(readdirSync(errDir).filter((f) => f.endsWith(".reason")).length >= 1, "and the reason is on disk where a producer can read it");
console.log("  ok   small plan applies; unknown id refused through the dead-letter channel");

rmSync(dir, { recursive: true, force: true });
console.log("\nQUEUE-CONTROL-SPOOL PASS — propose writes nothing, apply attributes everything, a dead gate has a repair, a cancel names its casualties");
