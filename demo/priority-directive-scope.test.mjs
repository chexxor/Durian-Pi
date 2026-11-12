// demo/priority-directive-scope.test.mjs — a scoped, leased DIRECTIVE beats a fan-out of `now`.
//
// WHY THIS EXISTS. The operator ratified propose-and-apply and asked for the ability to re-prioritise the
// team's work (2026-11-12T17:5xZ). The obvious implementation is to write `now` onto every row that should
// be prioritised — and it is wrong for a reason this repo has already paid for once: a copied value goes
// stale the moment the queue mints (pitfall 294, where a guard asserted a recorded 5,773-row census while
// the live queue held 7,282). Measured on the live rig the same evening: 33 landing rows promoted by hand
// while 444 real queued rows existed, and pm kept minting.
//
// A DIRECTIVE is one leased statement — "seats X / subjects containing Y are `now` until T" — evaluated at
// CLAIM time. This demo pins the four properties that make that better, and the two that keep it honest:
//   1. a row minted AFTER the directive is covered (a fan-out misses it);
//   2. the lease LAPSES at read time, so urgency cannot become a permanent park;
//   3. scope is seats and/or a subject substring, and an unscoped directive is REFUSED;
//   4. it reorders only under `priority_first` — a declared `oldest_first` policy is not silently
//      rewritten, exactly like `set_priority`'s reported inertness;
//   5. the order function itself is unchanged when no directive exists (an unconfigured rig is untouched);
//   6. the broker APPLIES it to the control doc and nothing else.
//
// Run: node demo/priority-directive-scope.test.mjs   (exit 0 = pass)

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { RigControl, RigQueue, registerSeat, selectNextWork } from "../src/rig.mjs";
import { orderCandidates } from "../src/workstrategy.mjs";
import { planDirective } from "../src/queueops.mjs";
import { drainIntentInbox, readIntentResult, writeIntent } from "../src/broker.mjs";

const AT = Date.parse("2026-11-12T18:00:00.000Z");
const UNTIL = "2026-11-13T23:59:00.000Z";
const row = (id, to, subject, extra = {}) => ({ id: String(id), to, from: "pm", status: "queued", subject, transitions: [], ...extra });
const ids = (rows) => rows.map((r) => r.id);

console.log("=== 1. A ROW MINTED AFTER THE DIRECTIVE IS STILL COVERED (the fan-out defect) ===");
{
  // Two scopes, two meanings, both legible:
  //   --seat impl            every row addressed to impl leads (the chore too — that is what a seat scope says)
  //   --subject "LANDING …"  only rows whose subject matches lead
  const bySeat = { priority: "now", reason: "landing is the priority", expiresAt: UNTIL, seats: ["impl"] };
  const bySubject = { priority: "now", reason: "landing is the priority", expiresAt: UNTIL, subjectContains: "LANDING ENTRY" };
  const before = [row(5, "impl", "unrelated chore"), row(11, "impl", "LANDING ENTRY — item-a")];
  const after = [...before, row(12, "impl", "LANDING ENTRY — item-b, minted later")];
  assert.deepEqual(ids(orderCandidates(before, { strategy: "oldest_first", now: AT })), ["5", "11"], "baseline: with no directive and no priority, id order holds");

  assert.deepEqual(ids(orderCandidates(after, { strategy: "priority_first", now: AT, directive: bySeat })), ["5", "11", "12"], "a SEAT scope lifts every row for that seat, so id order survives inside the lifted group");
  const subjectOrder = orderCandidates(after, { strategy: "priority_first", now: AT, directive: bySubject });
  assert.deepEqual(ids(subjectOrder), ["11", "12", "5"], "a SUBJECT scope lifts exactly the matching rows — including #12, which did not exist when the directive was written");
  assert.equal(subjectOrder[1].id, "12", "the post-directive row outranks the older chore");

  // The comparison that names the alternative: promoting rows by hand leaves the newcomer behind.
  const fannedOut = after.map((r) => (r.id === "11" ? { ...r, priority: "now", prioritySet: { expiresAt: UNTIL } } : r));
  assert.deepEqual(ids(orderCandidates(fannedOut, { strategy: "priority_first", now: AT })), ["11", "5", "12"], "a FAN-OUT puts the post-directive row LAST — the defect a directive exists to avoid");
  console.log("  ok   a post-directive row leads the queue; a subject scope covers rows that do not exist yet");
}

console.log("\n=== 2. THE LEASE LAPSES, AND AN ABSENT DIRECTIVE CHANGES NOTHING ===");
{
  const rows = [row(10, "impl", "unrelated chore"), row(11, "impl", "LANDING ENTRY — item-a")];
  const lapsed = { priority: "now", reason: "x", expiresAt: "2026-11-12T17:00:00.000Z", seats: ["impl"] };
  assert.deepEqual(ids(orderCandidates(rows, { strategy: "priority_first", now: AT, directive: lapsed })), ["10", "11"], "an EXPIRED directive stops applying at read time (a lease, not a flag)");
  const garbage = { priority: "now", reason: "x", expiresAt: "not-a-date", seats: ["impl"] };
  assert.deepEqual(ids(orderCandidates(rows, { strategy: "priority_first", now: AT, directive: garbage })), ["10", "11"], "an unparseable expiry is inert, never urgent");
  const noDirective = ids(orderCandidates(rows, { strategy: "priority_first", now: AT }));
  const withNull = ids(orderCandidates(rows, { strategy: "priority_first", now: AT, directive: null }));
  const oldest = ids(orderCandidates(rows, { strategy: "oldest_first", now: AT }));
  assert.deepEqual(noDirective, oldest, "with NO directive, priority_first on an unprioritised queue is byte-for-byte oldest_first (the pre-existing guarantee)");
  assert.deepEqual(withNull, noDirective, "an explicit null is the same as absent");
  console.log("  ok   lapsed and unparseable directives are inert; no directive = unchanged ordering");
}

console.log("\n=== 3. A DIRECTIVE DOES NOT MAKE AN INELIGIBLE ROW CLAIMABLE ===");
{
  // The separation that makes this safe to grant: the directive enters the ORDER, never `workable()`.
  const rows = [row(20, "impl", "LANDING ENTRY — blocked", { blockedBy: ["99"] }), row(21, "impl", "LANDING ENTRY — open"), row(99, "pm", "the gate", { status: "queued" })];
  const directive = { priority: "now", reason: "landing", expiresAt: UNTIL, subjectContains: "LANDING ENTRY" };
  const picked = selectNextWork(rows, "impl", { strategy: "priority_first", now: AT, directive });
  assert.equal(picked.item.id, "21", "the gated row is passed over even though the directive scopes it");
  assert.deepEqual(picked.skipped.map((s) => [s.id, s.reason]), [["20", "gate-open:#99(queued)"]], "and the skip reason is still the claim rule's, unchanged");
  console.log("  ok   the directive reorders only eligible rows; `workable()` still decides eligibility");
}

console.log("\n=== 4. SCOPE IS REQUIRED AND NARROW; THE LEASE RULES ARE THE ROW RULES ===");
{
  const base = { priority: "now", reason: "landing", expiresAt: UNTIL, at: new Date(AT).toISOString() };
  assert.equal(planDirective({ ...base, seats: ["impl"] }).ok, true, "a seat scope is enough");
  assert.equal(planDirective({ ...base, subjectContains: "LANDING ENTRY" }).ok, true, "a subject scope is enough");
  const unscoped = planDirective({ ...base });
  assert.equal(unscoped.ok, false, "an UNSCOPED directive is refused");
  assert.match(unscoped.refusal, /SCOPE/, "and the refusal says the word");
  assert.equal(planDirective({ ...base, seats: ["impl"], reason: "" }).ok, false, "no reason, no directive");
  assert.equal(planDirective({ ...base, seats: ["impl"], expiresAt: undefined }).ok, false, "no expiry, no directive");
  assert.equal(planDirective({ ...base, seats: ["impl"], expiresAt: "2026-11-12T17:00:00.000Z" }).ok, false, "a past expiry is refused");
  assert.equal(planDirective({ ...base, seats: ["impl"], expiresAt: "2027-06-01T00:00:00.000Z" }).ok, false, "a >30-day lease is refused");
  const planned = planDirective({ ...base, seats: ["impl"], from: "delegate" });
  assert.equal(planned.directive.authority, "delegate (operator-authorised)", "the directive carries its AUTHORITY");
  assert.equal(planned.directive.priority, "now");
  console.log("  ok   seat or subject scope required; reason, expiry and the 30-day cap all enforced");
}

console.log("\n=== 5. THE BROKER APPLIES IT TO THE CONTROL DOC, AND NOWHERE ELSE ===");
{
  const dir = mkdtempSync(join(tmpdir(), "durig-directive-"));
  const dbPath = join(dir, "d.db");
  const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
  const models = createModels();
  models.setProvider(faux.provider);
  const registry = createRegistry();
  registry.install(RigQueue);
  registry.install(RigControl);
  const storage = new MemoryStorage();
  const harness = await Harness.open(storage, { models, registry }, BACKGROUND_CONTEXT);
  await harness.commit(async (tx) => {
    const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
    await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" }, instructions: "work" });
    await registerSeat(tx, "impl", c.id, "worker");
    const q = await tx.doc(RigQueue);
    q.items.push({ id: 1, from: "pm", to: "impl", subject: "a chore", body: "", status: "queued", transitions: [] });
    q.items.push({ id: 2, from: "pm", to: "impl", subject: "LANDING ENTRY — item-a", body: "", status: "queued", transitions: [] });
    q.nextId = 3;
  }, BACKGROUND_CONTEXT);

  const send = async (request) => {
    const requestId = `dir-${Math.random().toString(16).slice(2)}`;
    writeIntent(dbPath, { op: "queue", to: "queue", from: "delegate", requestId, createdAt: new Date().toISOString(), ...request });
    await drainIntentInbox(harness, storage, { dbPath, context: BACKGROUND_CONTEXT });
    return readIntentResult(dbPath, requestId);
  };

  const proposed = await send({ action: "directive", subjectContains: "LANDING ENTRY", priority: "now", reason: "landing", expiresAt: UNTIL, apply: false });
  assert.equal(proposed.result.applied, 0, "propose writes nothing");
  const controlBefore = await harness.snapshot(RigControl, undefined, BACKGROUND_CONTEXT);
  assert.equal(controlBefore?.directive ?? null, null, "the control doc is untouched by a propose");

  const applied = await send({ action: "directive", subjectContains: "LANDING ENTRY", priority: "now", reason: "landing is the priority", expiresAt: UNTIL, apply: true });
  assert.equal(applied.result.applied, 1, "apply writes the directive");
  const controlAfter = await harness.snapshot(RigControl, undefined, BACKGROUND_CONTEXT);
  assert.equal(controlAfter.directive.priority, "now", "the control doc carries the directive");
  assert.equal(controlAfter.directive.authority, "delegate (operator-authorised)");
  const queueAfter = await harness.snapshot(RigQueue, undefined, BACKGROUND_CONTEXT);
  assert.equal(queueAfter.items.find((i) => String(i.id) === "1").priority ?? null, null, "NO ROW was written — that is the whole point");
  assert.equal(queueAfter.items.find((i) => String(i.id) === "2").priority ?? null, null, "no row carries a copied flag");

  const claimOrder = orderCandidates(
    queueAfter.items.map((i) => ({ id: String(i.id), to: i.to, status: i.status, subject: i.subject, priority: i.priority ?? null, prioritySet: i.prioritySet ?? null })),
    { strategy: "priority_first", now: AT, directive: controlAfter.directive },
  );
  assert.equal(claimOrder[0].id, "2", "and the claim order honours it, computed from the control doc");

  const cleared = await send({ action: "directive-clear", apply: true });
  assert.equal(cleared.result.applied, 1, "clear applies");
  assert.equal((await harness.snapshot(RigControl, undefined, BACKGROUND_CONTEXT)).directive ?? null, null, "and the rig returns to its declared policy");

  // A SEAT may not set one: the queue-control gate is the operator plane.
  const denied = await send({ action: "directive", subjectContains: "LANDING", priority: "now", reason: "x", expiresAt: UNTIL, apply: true, from: "impl" });
  assert.equal(denied ?? null, null, "a seat identity is refused (dead-lettered, no result)");

  rmSync(dir, { recursive: true, force: true });
  console.log("  ok   propose writes nothing, apply writes one control field and ZERO rows, clear lapses it, a seat is refused");
}

console.log("\nPRIORITY-DIRECTIVE-SCOPE PASS — one leased scope covers rows that do not exist yet, and no row carries a copied flag");
