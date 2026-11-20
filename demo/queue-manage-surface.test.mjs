// demo/queue-manage-surface.test.mjs — the OPERATOR'S MANAGE SURFACE, end to end (ROADMAP 381, task-3).
//
// WHY THIS EXISTS AND WHY IT LOOKS LIKE THIS. The operator asked to "view and manage the queue" — select an
// item, change a property of it, and hand it to a seat to discuss/revise. `src/queue-manage.mjs` is the ONE
// core that answers that, and the verification contract for this task is specific about what must be PROVEN
// here, not merely asserted in prose:
//
//   1. MUTATIONS REACH ONLY THE EXISTING WRITE PATHS. Every mutating verb ends at `src/queueops.mjs`'s plan
//      functions and the broker's spool apply — the pin NAMES the function behind each verb (the core exports
//      `MANAGE_VERBS` for exactly this), asserts the resulting ROW TRANSITION, and greps the core for a writer
//      of its own. "No new write path" is a checkable claim, not a comment.
//   2. PROPOSE IS PURE (writes nothing, byte-for-byte) and APPLY IS THE BROKER'S — one code path, two verbs.
//   3. EVERY CHANGE IS ATTRIBUTED (`by` + `authority`), and the printed CHANGE REGISTER says what changed,
//      who did it, and what it STRANDED.
//   4. THE BLAST-RADIUS GATE: >20 rows is refused without `confirm`, then applies with it.
//   5. THE HAND-OFF TAKES NO QUEUE ACTION of its own — it spools `message` and the rows stay BYTE-IDENTICAL.
//   6. A SEAT IS REFUSED (`not-operator-plane`), and a store with NO live broker is REFUSED before an orphan
//      spool file is written (today's behaviour would be a silent no-op).
//
// It is HERMETIC: MemoryStorage + the mocked `fauxProvider` plane, and the spool drain is injected through the
// core's `drain` seam, so the whole surface costs ~5 s with no network, no key, no broker process
// (`docs/runbooks/slow-loop.md`). The CLI half is the same core reached through `cli.mjs queue --manage …`,
// pinned only for the refusals that need no store — the argument surface itself is demo/queue-compat-args.test.mjs.
//
// Run: node demo/queue-manage-surface.test.mjs   (exit 0 = pass)

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { RigQueue, registerSeat } from "../src/rig.mjs";
import { drainIntentInbox, intentErrorDir, intentInboxDir, readIntentError, readIntentResult, writeIntent } from "../src/broker.mjs";
import {
  MANAGE_ACTIONS,
  MANAGE_MUTATING,
  MANAGE_CENSUS,
  MANAGE_PRIORITIES,
  MANAGE_VERBS,
  MANAGE_INTENT_DIRS,
  queueManagePlan,
  queueManageRegisterText,
  queueManageSpool,
  queueDiscussDraft,
  queueDiscussSpool,
} from "../src/queue-manage.mjs";

const ctx = BACKGROUND_CONTEXT;
const ROOT = join(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const dir = mkdtempSync(join(tmpdir(), "durig-queue-manage-"));
const dbPath = join(dir, "manage.db");

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

// The measured shape of the live rig's casualties, plus the parts each verb needs:
//  - #3377 cancelled with two dependents that were left in limbo by it (#3503/#5885 are the real ones);
//  - #3600 a QUEUED gate with two dependents, so a plan can name its casualties BEFORE it writes;
//  - #4100 a row parked on the operator, so `release` has something to un-park;
//  - #4000 queued / #4001 claimed, the plain pair the old pins use;
//  - #9000..#9024 twenty-five rows, so the blast-radius threshold (20) is a measurement, not a comment.
await harness.commit(async (tx) => {
  const q = await tx.doc(RigQueue);
  const push = (id, status, extra = {}) =>
    q.items.push({ id, from: "pm", to: "impl", subject: `row ${id}`, body: "", status, transitions: [], ...extra });
  push(3377, "cancelled", { subject: "LANDING LIST (docs-only) — scribe-item-1257" });
  push(3503, "held", { blockedBy: [3377], subject: "REGISTERED (held, gated on #3377)" });
  push(5885, "held", { blockedBy: [3377], to: "pm", subject: "SUCCESSOR to #5322 (parked, gated on #3377)" });
  push(3600, "queued", { subject: "a prerequisite still open" });
  push(3601, "queued", { blockedBy: [3600], subject: "dependent on #3600" });
  push(3602, "queued", { blockedBy: [3600], to: "pm", subject: "dependent on #3600, pm's" });
  push(4100, "deferred", { deferredTo: "operator", subject: "parked on the operator's answer" });
  push(4000, "queued", { subject: "a plain queued row" });
  push(4001, "claimed", { subject: "a row being worked right now" });
  for (let i = 9000; i < 9025; i += 1) push(i, "queued", { subject: `bulk row ${i}` });
  q.nextId = 5000;
}, ctx);

/** The whole queue as ONE canonical string — byte identity is asserted on this, not on a re-derived summary. */
const readItems = async () =>
  (await harness.snapshot(RigQueue, undefined, ctx)).items.map((i) => ({
    id: String(i.id),
    status: i.status,
    to: i.to,
    priority: i.priority ?? null,
    prioritySet: i.prioritySet
      ? { at: i.prioritySet.at, by: i.prioritySet.by, reason: i.prioritySet.reason, expiresAt: i.prioritySet.expiresAt, authority: i.prioritySet.authority }
      : null,
    deferredTo: i.deferredTo ?? null,
    blockedBy: (i.blockedBy ?? []).map(String),
    transitions: (i.transitions ?? []).map((t) => ({ event: t.event, by: t.by, authority: t.authority ?? null, gate: t.gate ?? null, from: t.from ?? null, reason: t.reason ?? null, to: t.to ?? null, resumeBy: t.resumeBy ?? null })),
  }));
const stamp = async () => JSON.stringify(await readItems());
const nextId = async () => Number((await harness.snapshot(RigQueue, undefined, ctx)).nextId);
const spoolFiles = async () => readdirSync(MANAGE_INTENT_DIRS.inbox(dbPath)).filter((f) => f.endsWith(".json")).length;

/** The HERMETIC seam: the core writes one spool file, and THIS pin is the driver that drains it. */
const drain = async () => drainIntentInbox(harness, storage, { dbPath, context: ctx });
const apply = async (request) => await queueManageSpool(dbPath, request, { drain, from: "delegate" });

try {
  console.log("=== 1. ONE CORE, AND EVERY VERB NAMES THE FUNCTION BEHIND IT ===");
  assert.equal(MANAGE_ACTIONS.length, 11, "eleven actions are declared");
  assert.equal(new Set([...MANAGE_MUTATING, ...MANAGE_CENSUS]).size, 11, "every action is either a MUTATION or a CENSUS — nothing is neither");
  assert.equal(MANAGE_MUTATING.length, 8, "eight of them write");
  assert.equal(MANAGE_CENSUS.length, 3, "three only count");
  assert.deepEqual(MANAGE_PRIORITIES, ["now", "next", "later"], "the priority vocabulary is the rig's own, not free text");
  const bogus = queueManagePlan([], { action: "park" });
  assert.equal(bogus.ok, false, "`park` is not in the vocabulary, so it is REFUSED rather than passed to the dispatcher as free text");
  for (const verb of MANAGE_ACTIONS) {
    assert.ok(bogus.refusal.includes(verb), `the refusal NAMES the known action ${verb}, so a caller can correct the call: ${bogus.refusal}`);
  }
  for (const action of MANAGE_ACTIONS) {
    const target = MANAGE_VERBS[action];
    assert.ok(String(target).includes("queueops.mjs") || String(target).includes("queueclass.mjs"), `the row for ${action} points at an EXISTING rule module: ${target}`);
    assert.ok(/plan[A-Z]\w+|queueShape/.test(String(target)), `and it NAMES the function, not a behaviour: ${target}`);
  }
  // The no-new-writer contract, CHECKED rather than asserted in prose: the core must not reach a writer.
  const coreSource = readFileSync(join(ROOT, "src", "queue-manage.mjs"), "utf8");
  for (const forbidden of ["harness.commit", "Harness.open", "new MemoryStorage", "openNodeSqliteStorage", "tx.doc(", "\.submit("]) {
    assert.ok(!coreSource.includes(forbidden), `the core contains NO ${forbidden} — the apply is the broker's spool, not a writer here`);
  }
  assert.ok(coreSource.includes("planQueueAction") && coreSource.includes("writeIntent"), "and it DOES reach the two existing paths: the plan and the spool");
  const seatPlane = await queueManageSpool(dbPath, { action: "cancel", ids: ["4000"], reason: "a seat must not be able to do this", apply: true }, { drain, from: "impl" });
  assert.equal(seatPlane.ok, false, "a SEAT identity spooling a queue mutation is refused");
  assert.equal(seatPlane.code, "not-operator-plane", "with the structured code a producer can branch on");
  assert.equal(seatPlane.spool, null, "and NOTHING was written on the way to that refusal");
  console.log("  ok   eleven actions, each naming its queueops function; `park` refused by name; a seat refused; the core contains no writer");

  console.log("\n=== 2. PROPOSE IS PURE — AND IT NAMES WHAT IT WOULD STRAND ===");
  const pristine = await stamp();
  const gate = queueManagePlan(await readItems(), { action: "cancel", ids: ["3600"], reason: "prerequisite abandoned" });
  assert.equal(gate.ok, true, "cancelling an OPEN prerequisite is a legal plan");
  assert.equal(gate.verb, "planCancel (src/queueops.mjs)", "the plan says which function it reached");
  assert.equal(gate.proposed, 1, "one row would change");
  assert.equal(gate.strands.length, 2, "and it names BOTH dependents that would be stranded");
  assert.deepEqual(gate.strands.map((s) => s.id).sort(), ["3601", "3602"], "by id, status, seat and gate");
  assert.deepEqual(gate.strands.map((s) => `${s.id}->${s.gateId}`).sort(), ["3601->3600", "3602->3600"], "each names the gate that dies with it");
  assert.equal(gate.by, "delegate", "the transitions it would append carry an actor");
  assert.equal(gate.authority, "delegate (operator-authorised)", "and the AUTHORITY, so the change is reviewable");
  const register = queueManageRegisterText(gate);
  assert.ok(register.includes("NOTHING WAS WRITTEN"), "the human register says the propose wrote nothing, in words");
  assert.ok(register.includes("THIS WOULD STRAND 2 row(s)"), "and prints the casualties, not just a count");
  assert.ok(register.includes("--manage repair-gates"), "and points at the repair that clears them in the same act");
  assert.equal(await stamp(), pristine, "a propose wrote NOTHING, byte for byte");
  const already = queueManagePlan(await readItems(), { action: "cancel", ids: ["3377"], reason: "already terminal" });
  assert.equal(already.ok, false, "a TERMINAL row is refused rather than re-cancelled");
  assert.match(already.refusal, /already cancelled/, "and the refusal names the state");
  const underWay = queueManagePlan(await readItems(), { action: "cancel", ids: ["4001"], reason: "mid-turn" });
  assert.equal(underWay.ok, false, "a CLAIMED row is refused: cancelling under a running turn is the race `preempt` exists to avoid");
  assert.match(underWay.refusal, /CLAIMED/, "and the refusal names which class it is, in the rig's own word");
  console.log("  ok   plan names its function, its actor, its authority and its casualties; terminal and claimed rows refused");

  console.log("\n=== 3. APPLY IS THE BROKER'S SPOOL, AND THE ROW RECORDS THE CHANGE ===");
  const cancelOut = await apply({ action: "cancel", ids: ["3600"], reason: "prerequisite abandoned", apply: true });
  assert.equal(cancelOut.ok, true, "the spool was drained and the broker answered");
  assert.equal(cancelOut.reply.applied, 1, "one row changed");
  assert.equal(cancelOut.reply.op, "queue", "and the reply is the broker's `queue` op record, not this module's invention");
  const cancelledRow = (await readItems()).find((r) => r.id === "3600");
  assert.equal(cancelledRow.status, "cancelled", "the row is terminal");
  const cancelT = cancelledRow.transitions.find((t) => t.event === "cancelled");
  assert.ok(cancelT, "the row records the change as a TRANSITION");
  assert.equal(cancelT.by, "delegate", "attributed to the delegate");
  assert.equal(cancelT.authority, "delegate (operator-authorised)", "with the AUTHORITY the plan promised — plan and apply cannot disagree");
  const stillGated = (await readItems()).filter((r) => r.blockedBy.includes("3600"));
  assert.equal(stillGated.length, 2, "the two dependents are now exactly the casualties the plan named");
  assert.deepEqual(stillGated.map((r) => r.id).sort(), ["3601", "3602"], "same ids, no surprises");
  const repair = await apply({ action: "repair-gates", reason: "release the dead gate", apply: true });
  assert.equal(repair.reply.applied, 4, "the four rows gated on a CANCELLED row (#3503/#5885/#3601/#3602) are released");
  for (const id of ["3503", "5885", "3601", "3602"]) {
    const row = (await readItems()).find((r) => r.id === id);
    assert.deepEqual(row.blockedBy, [], `#${id} no longer carries a dead gate`);
    const t = row.transitions.find((x) => x.event === "gate-released");
    assert.ok(t, `#${id} records the repair`);
    assert.equal(t.authority, "delegate (operator-authorised)", "attributed");
  }
  assert.ok(queueManageRegisterText(repair.reply).includes("gate released"), "the register renders a released gate, not just a status arrow");
  console.log("  ok   apply went through the spool; the row carries the attributed transition; repair-gates clears exactly the census");

  console.log("\n=== 4. PRIORITY IS A LEASE WITH AN EXPIRY AND AN AUTHORITY ===");
  const until = new Date(Date.now() + 3600_000).toISOString();
  const prioPlan = queueManagePlan(await readItems(), { action: "priority", ids: ["3601"], priority: "now", reason: "operator: this is what to land", expiresAt: until });
  assert.equal(prioPlan.ok, true, "the lease is a legal plan");
  assert.equal(prioPlan.verb, "planPriority (src/queueops.mjs)", "the same `set_priority` rule the selector uses");
  assert.equal(prioPlan.lease.expiresAt, until, "carries the expiry the caller gave — urgency cannot become a permanent park");
  const prioOut = await apply({ action: "priority", ids: ["3601"], priority: "now", reason: "operator: this is what to land", expiresAt: until, apply: true });
  assert.equal(prioOut.reply.applied, 1, "leased");
  const leased = (await readItems()).find((r) => r.id === "3601");
  assert.equal(leased.priority, "now", "the row is prioritised");
  assert.equal(leased.prioritySet.expiresAt, until, "the lease records its expiry");
  assert.equal(leased.prioritySet.authority, "delegate (operator-authorised)", "and who leased it, with what authority");
  const racedPrio = await apply({ action: "priority", ids: ["4001"], priority: "now", reason: "x", expiresAt: until, apply: true });
  assert.equal(racedPrio.ok, false, "a CLAIMED row is refused");
  assert.equal(racedPrio.code, "dead-lettered", "the refusal comes back through the broker's error channel, not a guess");
  assert.match(racedPrio.refusal, /queue priority:/, "and names the action it refused");
  const badLevel = queueManagePlan([], { action: "priority", ids: ["3602"], priority: "soon", reason: "x", expiresAt: until });
  assert.equal(badLevel.ok, false, "`soon` is not a priority and never silently means `next`");
  assert.match(badLevel.refusal, /now\|next\|later/, "the refusal prints the legal vocabulary");
  console.log("  ok   lease applied with expiry + authority; claimed row dead-lettered with its reason; bad level refused");

  console.log("\n=== 5. RELEASE UN-PARKS A PARKED ROW (and nothing else) ===");
  const parked = (await readItems()).find((r) => r.id === "4100");
  assert.equal(parked.status, "deferred", "the row starts parked on the operator");
  assert.equal(parked.deferredTo, "operator", "with its audience recorded");
  const rel = await apply({ action: "release", ids: ["4100"], reason: "the operator answered; nothing is awaited", apply: true });
  assert.equal(rel.reply.applied, 1, "un-parked");
  const relRow = (await readItems()).find((r) => r.id === "4100");
  assert.equal(relRow.status, "queued", "back in play");
  assert.equal(relRow.deferredTo, null, "the park's audience is cleared, so nothing reads it as still waiting");
  const relT = relRow.transitions.find((t) => t.event === "released");
  assert.equal(relT.from, "operator", "and the transition records WHICH park it left — a park is never silently erased");
  const relRegister = queueManageRegisterText(rel.reply);
  assert.ok(relRegister.includes("deferred -> queued"), "the register renders the change as a transition of states");
  const parkedAgain = await apply({ action: "release", ids: ["4100"], reason: "nothing parked here", apply: true });
  assert.equal(parkedAgain.ok, true, "releasing an already-`queued` row is idempotent");
  assert.equal(parkedAgain.reply.applied, 1, "and it is the same legal act, not an error");
  console.log("  ok   release moves deferred -> queued with the audience recorded; a cancel has NO inverse here and that is the gap named for the operator");

  console.log("\n=== 6. THE BLAST-RADIUS GATE: >20 ROWS NEED AN EXPLICIT CONFIRMATION ===");
  const bulkIds = [];
  for (let i = 9000; i < 9025; i += 1) bulkIds.push(String(i));
  const bulk = queueManagePlan(await readItems(), { action: "priority", ids: bulkIds, priority: "next", reason: "sweep", expiresAt: until });
  assert.equal(bulk.ok, false, "a plan over 25 rows is refused by the confirm gate");
  assert.match(bulk.refusal, /touches 25 rows \(threshold 20\)/, "naming the size and the threshold, so the caller can decide rather than guess");
  const bulkOut = await apply({ action: "priority", ids: bulkIds, priority: "next", reason: "sweep", expiresAt: until, confirm: true, apply: true });
  assert.equal(bulkOut.ok, true, "with `confirm: true` the same plan applies");
  assert.equal(bulkOut.reply.applied, 25, "all 25 rows");
  assert.equal((await readItems()).filter((r) => r.priority === "next").length, 25, "and exactly 25 rows carry the lease — no drift");
  const untouched = (await readItems()).filter((r) => !bulkIds.includes(r.id) && r.priority);
  assert.equal(untouched.length, 1, "the only other leased row is #3601 from section 4");
  assert.equal((await readItems()).find((r) => r.id === "3601").priority, "now", "the sweep did not touch it");
  console.log("  ok   25 rows refused without confirm, applied with it; nothing outside the scope moved");

  console.log("\n=== 7. THE DISCUSS/REVISE HAND-OFF TAKES NO QUEUE ACTION OF ITS OWN ===");
  const beforeHandoff = await stamp();
  const beforeNext = await nextId();
  const draft = queueDiscussDraft({ item: (await readItems()).find((r) => r.id === "3601"), to: "impl", note: "the operator wants this landed first; split it if it does not fit the seat's window." });
  assert.equal(draft.ok, true, "the draft composes");
  assert.equal(draft.action, "discuss", "it is a DISCUSS, not a mutation");
  assert.deepEqual(draft.queueActions, [], "it DECLARES no queue action — and this is the assertion that makes the declaration mean something");
  assert.equal(draft.spool.op, "message", "the one thing it spools is the seat's own conversation channel");
  assert.equal(draft.spool.to, "impl", "addressed to a registered seat");
  assert.ok(draft.content.includes("#3601"), "naming the item the sentence is about");
  const noAudience = queueDiscussDraft({ item: null, to: "", note: "x" });
  assert.equal(noAudience.ok, false, "a hand-off with no audience is refused rather than sent nowhere");
  assert.match(noAudience.refusal, /--to/, "and says what it needed");
  const handoff = await queueDiscussSpool(dbPath, draft, { drain, from: "delegate" });
  assert.equal(handoff.ok, true, "the broker delivered it");
  assert.equal(handoff.reply.delivered, true, "into the seat's conversation, as the broker's own `message` op says");
  assert.deepEqual(handoff.queueActions, [], "and the OUTCOME declares no queue action either");
  assert.equal(await stamp(), beforeHandoff, "the queue rows are BYTE-IDENTICAL — the hand-off changed nothing in the queue");
  assert.equal(await nextId(), beforeNext, "and minted nothing");
  const events = ["claimed", "completed", "deferred", "minted", "assigned"];
  const after = await readItems();
  for (const ev of events) {
    assert.equal(after.filter((r) => r.transitions.some((t) => t.event === ev && (t.by === "delegate" || t.authority === "delegate (operator-authorised)"))).length, 0, `no ${ev} transition was written by the operator plane`);
  }
  assert.equal(readIntentError(dbPath, handoff.requestId), null, "the hand-off was NOT dead-lettered — `message` is a content op a delegate is admitted to");
  assert.ok(readIntentResult(dbPath, handoff.requestId)?.ok === true, "and its result record is on disk where a producer can read it");
  console.log("  ok   hand-off spools `message` only; rows byte-identical; nextId unchanged; no mint/claim/defer by the operator plane");

  console.log("\n=== 8. NO BROKER, NO ORPHAN SPOOL — the silent no-op REFUSES ===");
  assert.equal(await spoolFiles(), 0, "the spool is empty here: every intent this pin wrote was drained");
  const orphan = await queueManageSpool(dbPath, { action: "cancel", ids: ["3601"], reason: "would otherwise vanish", apply: true }, { from: "delegate" });
  assert.equal(orphan.ok, false, "with NO live broker and no drain supplied, the apply is REFUSED");
  assert.equal(orphan.code, "no-live-broker", "under a structured code");
  assert.equal(orphan.spool, null, "and NO spool file was written — the refusal happened before the write");
  assert.equal(orphan.spool_census.count, 0, "the census it prints says the spool really is empty");
  assert.ok(orphan.refusal.includes("silent no-op"), "and the reason says what would otherwise have happened");
  assert.equal(await spoolFiles(), 0, "still empty — the refusal wrote nothing");
  console.log("  ok   no-broker refused BEFORE writing; the census is printed; nothing was orphaned in the spool");

  console.log("\n=== 9. DEFER PARKS A ROW ON THE OPERATOR WITH A LEASE — the mirror of release ===");
  const deferUntil = new Date(Date.now() + 3 * 3600_000).toISOString();
  const deferPlan = queueManagePlan(await readItems(), { action: "defer", ids: ["4000"], reason: "the operator must choose the landing order", resumeBy: deferUntil });
  assert.equal(deferPlan.ok, true, "parking a QUEUED row on the operator is a legal plan");
  assert.equal(deferPlan.verb, "planDefer (src/queueops.mjs)", "it names the function behind it, like every other verb");
  assert.equal(deferPlan.proposed, 1, "one row");
  assert.deepEqual(deferPlan.changes, [{ id: "4000", from: "queued", to: "deferred", deferredTo: "human", resumeBy: deferPlan.lease.resumeBy }], "the change is the ROW TRANSITION, with the audience and the clock");
  assert.equal(deferPlan.lease.resumeBy, deferUntil, "the lease carries the clock the caller gave");
  assert.ok(queueManageRegisterText(deferPlan).includes("the park resumes at"), "and the human register prints the clock, so a reader knows when the park stops being silent");
  const noClock = queueManagePlan(await readItems(), { action: "defer", ids: ["4000"], reason: "no clock given" });
  assert.equal(noClock.ok, false, "a park on the human WITHOUT a clock is refused, not defaulted to 'forever'");
  assert.match(noClock.refusal, /needs `resumeBy`/, "and the refusal is deferlease.mjs' own sentence — the SAME rule `defer_work` calls");
  const tooFar = queueManagePlan(await readItems(), { action: "defer", ids: ["4000"], reason: "past the bound", resumeBy: new Date(Date.now() + 9 * 24 * 3600_000).toISOString() });
  assert.equal(tooFar.ok, false, "a clock more than 5 days out is refused");
  assert.match(tooFar.refusal, /at most 5 days out/, "naming the bound rather than a number nobody can act on");
  const inFlight = queueManagePlan(await readItems(), { action: "defer", ids: ["4001"], reason: "mid-turn", resumeBy: deferUntil });
  assert.equal(inFlight.ok, false, "a CLAIMED row is refused");
  assert.match(inFlight.refusal, /item #4001 is claimed; this action touches queued or held rows only/, "and the refusal names the row's own state and the states the act touches");
  const deferOut = await apply({ action: "defer", ids: ["4000"], reason: "the operator must choose the landing order", resumeBy: deferUntil, apply: true });
  assert.equal(deferOut.ok, true, "the spool drained and the broker answered");
  assert.equal(deferOut.reply.applied, 1, "one row parked");
  const parkedRow = (await readItems()).find((r) => r.id === "4000");
  assert.equal(parkedRow.status, "deferred", "queued -> deferred");
  assert.equal(parkedRow.deferredTo, "human", "the audience is the operator, the same value readapi.mjs' `awaitingOperator` predicate reads");
  assert.equal(parkedRow.transitions.find((t) => t.event === "deferred").resumeBy, deferUntil, "the transition carries the clock");
  assert.deepEqual((await readItems()).filter((r) => r.status === "deferred").map((r) => r.id), ["4000"], "while parked, the only deferred row is the one this act parked (section 5 already released #4100)");
  const unParked = await apply({ action: "release", ids: ["4000"], reason: "the operator answered", apply: true });
  assert.equal(unParked.reply.applied, 1, "and `release` is its exact inverse for a park this surface wrote");
  assert.equal((await readItems()).find((r) => r.id === "4000").status, "queued", "back in play");
  assert.equal((await readItems()).find((r) => r.id === "4000").transitions.find((t) => t.event === "released").from, "human", "the release names the park it left");
  assert.deepEqual((await readItems()).filter((r) => r.status === "deferred").map((r) => r.id), [], "and after the release no seed row is parked — the pair (defer, release) is a round trip, not a one-way park");
  console.log("  ok   defer parks queued -> deferred with the operator as audience and a lease; release is its inverse; no-clock, too-far and claimed refused");

  console.log("\n=== 10. THE CLI REGISTRATION IS THE SAME CORE, AND ITS REFUSALS COST THE STORE NOTHING ===");
  const cli = (args) => {
    const r = spawnSync(process.execPath, ["cli.mjs", ...args], {
      cwd: join(ROOT),
      env: { ...process.env, DURIG_DB: dbPath, DURIG_PI_DB: dbPath },
      encoding: "utf8",
      timeout: 120000,
    });
    return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
  const badAction = cli(["queue", "--manage", "park", "--id", "4000", "--reason", "x"]);
  assert.equal(badAction.code, 1, "an unknown manage action exits 1 at the CLI");
  assert.equal(JSON.parse(badAction.stdout).ok, false, "with a structured ok:false");
  assert.ok(JSON.parse(badAction.stdout).error.includes("--manage"), "and it names the flag it refused");
  assert.ok(badAction.stderr.includes("known flags:"), "and STDERR still prints the flag table, so the caller can correct the call: ${badAction.stderr.slice(0, 300)}");
  for (const verb of MANAGE_ACTIONS) {
    assert.ok(badAction.stderr.includes(verb), "the CLI refusal names the vocabulary, so a caller can correct the call");
  }
  for (const orphanCase of [["--reason", "x"], ["--until", "2030-01-01T00:00:00.000Z"], ["--priority", "now"], ["--apply"], ["--confirm"]]) {
    const orphan = cli(["queue", ...orphanCase]);
    assert.equal(orphan.code, 1, `queue ${orphanCase[0]} outside --manage exits 1`);
    const oj = JSON.parse(orphan.stdout);
    assert.equal(oj.ok, false, "a structured refusal");
    assert.ok(String(oj.error).includes(orphanCase[0]), `the refusal names ${orphanCase[0]}`);
    assert.ok(String(oj.error).includes("--manage"), "and NAMES the missing half, so the surface is not a dead end");
    assert.ok(!("items" in oj), `and never answers with the document: ${orphan.stdout.slice(0, 200)}`);
  }
  const scoped = cli(["queue", "--manage", "directive", "--reason", "landing first"]);
  assert.equal(scoped.code, 1, "`directive` is refused AT THE CLI: it needs --seat/--subject scope the CLI does not grow");
  assert.match(JSON.parse(scoped.stdout).error, /intent\.mjs/, "and points at the producer that DOES have that scope, instead of half-doing the action");
  assert.ok(!JSON.parse(scoped.stdout).applied, "no partial directive");
  const twoFamilies = cli(["queue", "--manage", "cancel", "--list", "--reason", "x"]);
  assert.equal(twoFamilies.code, 1, "the manage family and the --list family do not quietly compose");
  assert.ok(JSON.parse(twoFamilies.stdout).error.includes("--list"), "naming both halves so the caller can pick one");
  console.log("  ok   the CLI refuses an unknown action, an orphan manage flag, an out-of-scope action and a family collision, each by name");

  console.log(
    "\nQUEUE-MANAGE-SURFACE PASS — one core, eleven actions each naming its `src/queueops.mjs` function (cancel, DEFER, release, priority, repair-gates, directive, directive-clear, acknowledge-notices and the three censuses), propose pure, apply the broker's spool, every change attributed, a cancel names its casualties, a defer names its clock, >20 rows confirm-gated, a hand-off spools `message` only (rows byte-identical), and a store with no broker refuses instead of orphaning a spool file",
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
