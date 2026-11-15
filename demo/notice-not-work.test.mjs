// demo/notice-not-work.test.mjs — a NOTICE is an acknowledgement, not work.
//
// THE STATE THIS NAMES (operator request 2026-11-15, "the queue is overwhelming"). Measured on this rig with
// `node tools/queue-pressure.mjs` (host line printed by the tool itself): of 1,656 non-terminal rows, 461 were
// protocol notices and 152 were ROADMAP registrations. 322 notices sat in `queued` and 321 of them passed
// `workable()`, so a seat could claim an acknowledgement and spend a turn on it. ROADMAP 39 named the two
// fixes in 2026 — suppress a notice of a notice, or make notices non-claimable — and only the first shipped.
//
// FAILING-FIRST (docs/failing-first-recipe.md, Method 1: run the test before the fix exists). Run it against
// the tip this change was written on:
//   git archive HEAD src | tar -x -C .spike/redfirst
//   cp demo/notice-not-work.test.mjs .spike/redfirst/demo/notice-not-work.test.mjs
//   node .spike/redfirst/demo/notice-not-work.test.mjs   # RED: workable() accepts a notice, nothing acks it
//   node demo/notice-not-work.test.mjs                   # GREEN: same file, the shipped code
//
// Cost: <1 s, no store, no network, no model (fauxProvider + MemoryStorage).
// Run: node demo/notice-not-work.test.mjs   (exit 0 = pass)

import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { RigQueue, Edges, compilePersona, enqueueItem, registerSeat, workable } from "../src/rig.mjs";
import { classifyRow, isNoticeItem, isRegistrationItem, queueShape } from "../src/queueclass.mjs";
import { planAcknowledgeNotices, planQueueAction } from "../src/queueops.mjs";
import { selectWakes } from "../src/driver.mjs";

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

// A plain array is a faithful fake queue for a pure predicate: no harness, no store, no clock.
const row = (over = {}) => ({
	id: 1,
	from: "pm",
	to: "impl",
	subject: "build the landing screen",
	body: "src/watchview.mjs",
	status: "queued",
	notice: false,
	transitions: [{ at: "2026-11-14T10:00:00.000Z", event: "queued", by: "pm" }],
	...over,
});

console.log("=== 1. a notice is not workable, work still is (the ONE predicate the claim path uses) ===");
const notice = row({ id: 900, subject: "DONE #899: build the landing screen", body: "completed by impl", notice: true, to: "pm" });
const cancelNotice = row({ id: 901, subject: "CANCELLED #898: old request", body: "cancelled by lead: superseded", notice: true, to: "pm" });
const legacyNotice = row({ id: 902, subject: "DONE #777: an ack from before the flag", notice: undefined, to: "pm" });
const realWork = row({ id: 903, subject: "fix the wake body", body: "src/driver.mjs" });

check("workable(): a DONE notice is refused", workable(notice, "pm", { items: [notice, realWork] }).workable === false, JSON.stringify(workable(notice, "pm", { items: [] })));
check("the refusal NAMES the kind of row", workable(notice, "pm", { items: [] }).reason === "notice-not-work", workable(notice, "pm", { items: [] }).reason);
check("workable(): a CANCELLED notice is refused too", workable(cancelNotice, "pm", { items: [] }).workable === false);
check("workable(): a LEGACY flag-less DONE row is still recognised", workable(legacyNotice, "pm", { items: [] }).workable === false, JSON.stringify(workable(legacyNotice, "pm", { items: [] })));
check("workable(): real work is still workable", workable(realWork, "impl", { items: [realWork] }).workable === true, JSON.stringify(workable(realWork, "impl", { items: [realWork] })));
check("a WORK row whose subject merely looks like a notice is still work", workable(row({ id: 904, subject: "DONE #3384: please confirm before I close it", notice: false }), "impl", { items: [] }).workable === true);

console.log("\n=== 2. the seat is not WOKEN for a notice, and not woken for a registration either ===");
const seats = { pm: { conversationId: 1, capabilities: [] }, impl: { conversationId: 2, capabilities: [] } };
const wakeItems = [notice, realWork];
const woken = selectWakes({ seats, items: wakeItems, pendingConvIds: new Set(), busySeats: new Set(), stoppedConvIds: new Set() });
check("impl wakes for the real work", woken.some((w) => w.name === "impl"), JSON.stringify(woken));
check("pm does NOT wake for the notice alone", !woken.some((w) => w.name === "pm"), JSON.stringify(woken));

const skipped = [];
selectWakes({ seats, items: [notice], pendingConvIds: new Set(), busySeats: new Set(), stoppedConvIds: new Set(), onSkip: (s) => skipped.push(s) });
check("the SKIP line says no-work rather than advertising work", skipped.some((s) => s.seat === "pm" && s.reason === "no-work"), JSON.stringify(skipped));
check("a notice-only queue produces no parked wake", !skipped.some((s) => s.reason.startsWith("queued-gated:notice")), JSON.stringify(skipped));

const registration = row({ id: 905, subject: "ROADMAP 92 (BACKLOG — hold, do not start)", status: "held", to: "impl" });
const parked = selectWakes({ seats, items: [registration], pendingConvIds: new Set(), busySeats: new Set(), stoppedConvIds: new Set(), onSkip: (s) => skipped.push(s) });
check("a registration does not wake a seat", parked.length === 0, JSON.stringify(parked));

console.log("\n=== 3. the classification is ONE predicate, and the order of the test is load-bearing ===");
check("a notice is a notice", isNoticeItem(notice) === true);
check("a notice whose subject contains registration words is NOT a registration", isRegistrationItem(row({ subject: "CANCELLED #1088: ROADMAP 92 (BACKLOG — hold, do not start)", notice: true })) === false);
check("a registration is a registration", isRegistrationItem(registration) === true);
check("plain work is neither", classifyRow(realWork) === "work", classifyRow(realWork));

console.log("\n=== 4. the census the operator can read: three buckets that SUM to the live rows ===");
const shape = queueShape([notice, cancelNotice, legacyNotice, realWork, registration, row({ id: 906, subject: "a held real task", status: "held" })]);
check("rows and live rows are counted", shape.rows === 6 && shape.live === 6, JSON.stringify(shape));
check("work + notice + registration == live rows", shape.work + shape.notice + shape.registration === shape.live, JSON.stringify({ work: shape.work, notice: shape.notice, registration: shape.registration, live: shape.live }));
check("notice bucket is 3", shape.notice === 3, String(shape.notice));
check("registration bucket is 1", shape.registration === 1, String(shape.registration));
check("work bucket is 2", shape.work === 2, String(shape.work));
check("queued work is counted apart from parked work", shape.queuedWork === 1, String(shape.queuedWork));

console.log("\n=== 5. the ack PLAN is the same function the operator verb uses (one rule, two surfaces) ===");
const plan = planAcknowledgeNotices([notice, realWork], { seats: ["pm"], from: "delegate" });
check("the plan closes exactly the pm notice", plan.changes.length === 1 && plan.changes[0].id === "900" && plan.changes[0].to === "done", JSON.stringify(plan.changes));
check("the transition names the item the notice is ABOUT", plan.transitions[0].about === 899, JSON.stringify(plan.transitions[0]));
check("the dispatch through planQueueAction reaches the same plan", planQueueAction("acknowledge-notices", [notice], { seats: ["pm"] }).changes.length === 1);
check("an unknown action is still refused", planQueueAction("nope", [], {}).ok === false);
check("the registrations census names the ledger copies", planQueueAction("registrations", [registration], {}).census.count === 1);
// THE CLAIMED-NOTICE SKIP (the bulk verb's blast-radius rule). Measured on this rig 2026-11-15
// (`node tools/queue-pressure.mjs`): noticeByStatus {"deferred":126,"held":8,"queued":322,"claimed":5} — five
// notices were CLAIMED, i.e. in flight. The module's own authority rule (`planCancel` refuses the same shape)
// says a bulk plan never touches a row in flight; the driver pre-filters `queued`, so only the sweep needs it.
// The claim returns to `queued` on the seat's turn end, and the next pass acknowledges it.
const claimedNotice = { ...notice, status: "claimed" };
const sweep = planAcknowledgeNotices([notice, claimedNotice, realWork], { from: "delegate" });
check("the sweep skips a CLAIMED notice and names it", sweep.changes.length === 1 && sweep.census.skippedClaimed.includes("900"), JSON.stringify({ changes: sweep.changes, skipped: sweep.census.skippedClaimed }));
check("...and the skip is said out loud, not silently dropped", typeof sweep.note === "string" && sweep.note.includes("CLAIMED"), String(sweep.note));

console.log("\n=== 6. the mint gate: no duplicates, a burst cap, and lineage required under pressure ===");
const { mintGate, lineageOf } = await import("../src/rig.mjs");

const oneOpen = [realWork];
check("a duplicate subject for the same seat is refused", mintGate(oneOpen, { to: "impl", subject: "fix the wake body", body: "src/driver.mjs", seats: 1 }).ok === false);
check("the duplicate refusal names the existing row", String(mintGate(oneOpen, { to: "impl", subject: "fix the wake body", seats: 1 }).refusal).includes("#903"));
check("the same subject for a DIFFERENT seat is not a duplicate", mintGate(oneOpen, { to: "qa", subject: "fix the wake body", seats: 1 }).ok === true);
// The tier ratchet (#60) latches a chain by re-sending the SAME base subject to the SAME seat. Refusing that
// mint would be refusing a documented feature, so a tiered duplicate stays allowed — and it stays recorded.
const tiered = row({ id: 904, subject: "TASK [3/6]: expose the masking layer", tier: "feature" });
check(
	"a TIERED re-send of the same subject is the ratchet, not a duplicate",
	mintGate([tiered], { to: "impl", subject: "TASK [3/6]: expose the masking layer", tier: "feature", seats: 1 }).ok === true,
);
check(
	"but it is still recorded as a duplicate so `check` can report it",
	mintGate([tiered], { to: "impl", subject: "TASK [3/6]: expose the masking layer", tier: "feature", seats: 1 }).duplicateOf === 904,
);

// THE BURST, not a standing count. A standing cap would have refused the next mint to `impl` on the day it
// shipped (impl holds 439 open rows on the live store), which is an outage; a burst cap refuses fan-out while
// it is happening, measured over the SAME window the check rule reports. The fixture timestamps are relative
// to now so the window arithmetic cannot age into a false pass.
const freshRows = (n, base) => Array.from({ length: n }, (i) => row({ id: base + i, subject: `task ${i}`, body: "src/x.mjs", transitions: [{ at: new Date(Date.now() - 3600000).toISOString(), event: "queued", by: "pm" }] }));
const hundredBurst = freshRows(100, 1000);
const burstGate = mintGate(hundredBurst, { to: "impl", subject: "task 101", body: "src/x.mjs", seats: 20 });
check("the burst refuses the 101st row in one seat's window", burstGate.ok === false && burstGate.burst === 100, JSON.stringify(burstGate));
check("the burst refusal names the number, the window and the knob", String(burstGate.refusal).includes("mint-burst cap is 100") && String(burstGate.refusal).includes("DURIG_MINT_BURST_CAP") && String(burstGate.refusal).includes("7-day pressure window"), String(burstGate.refusal));
check("inside the burst, the same seat is still sent rows", mintGate(freshRows(99, 1000), { to: "impl", subject: "task 100", body: "src/x.mjs", seats: 20 }).ok === true);
check("a PARKED mint is outside the burst (parking is the escape the refusal names)", mintGate(hundredBurst, { to: "impl", subject: "task 101", body: "src/x.mjs", held: true, seats: 20 }).ok === true);

// Under the band (10/seat) a parentless row is allowed and recorded as an orphan; over the band it is refused
// unless it names its lineage. The band is FLEET-wide: the caller has to name the roster, because a per-seat
// trigger at 10 rows would have stopped every mint on the day it shipped (impl alone holds 439 open rows).
const eightOpen = freshRows(8, 2000);
check("under the band, a parentless mint is allowed", mintGate(eightOpen, { to: "impl", subject: "polish the panel", seats: 2 }).ok === true);
const twelveOpen = freshRows(12, 3000);
const parentless = mintGate(twelveOpen, { to: "impl", subject: "polish the panel", seats: 1 });
check("over the band, a parentless mint is refused", parentless.ok === false && parentless.burst === 12, JSON.stringify(parentless));
check("the lineage refusal says what would satisfy it", String(parentless.refusal).includes("ROADMAP") && String(parentless.refusal).includes("DURIG_BAND_PER_SEAT"));
check("the refusal names the fleet it was judged against", parentless.fleet?.seats === 1 && parentless.fleet?.limit === 10, JSON.stringify(parentless.fleet));
check("over the band, a mint naming a ROADMAP item is allowed", mintGate(twelveOpen, { to: "impl", subject: "ROADMAP 375 — fix the wake clock", body: "", seats: 1 }).ok === true);
check("over the band, a mint naming an artifact path is allowed", mintGate(twelveOpen, { to: "impl", subject: "fix the footer", body: "the change is in src/watchview.mjs", seats: 1 }).ok === true);
check("over the band, a mint with a gate is allowed", mintGate(twelveOpen, { to: "impl", subject: "follow the chain", blockedBy: [3000], seats: 1 }).ok === true);
check(
	"a caller that cannot name the roster is not band-judged (the duplicate and burst rules still apply)",
	mintGate(twelveOpen, { to: "impl", subject: "polish the panel" }).ok === true && mintGate(twelveOpen, { to: "impl", subject: "polish the panel" }).fleet === null,
);
check("the lineage is recorded on the row", Boolean(lineageOf({ subject: "ROADMAP 375 — fix the wake clock" }).kind), JSON.stringify(lineageOf({ subject: "ROADMAP 375" })));

console.log("\n=== 7. driven end to end: the wake closes the notice, and the seat never claims it ===");
const ctx = BACKGROUND_CONTEXT;
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
// Router is registered so the real tool surface exists; the scripted turn makes NO tool call, so a
// acknowledged notice cannot have been claimed by the seat.
const { Router } = await import("../src/rig.mjs");
registry.install(Router);
const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);

const convIds = {};
await harness.commit(async (tx) => {
	for (const [name, role] of [["pm", "program manager"], ["impl", "implementation engineer"], ["qa", "verification engineer"]]) {
		const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
		await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" }, instructions: "answer briefly" });
		await registerSeat(tx, name, c.id, role);
		convIds[name] = c.id;
	}
	await enqueueItem(tx, "pm", "impl", "Build the widget", "src/widget.mjs");
	await enqueueItem(tx, "impl", "pm", "DONE #1: Build the widget", "completed", null, true);
	// pm must have REAL work, otherwise it is not woken and — by design — its notice is not acknowledged yet.
	await enqueueItem(tx, "pm", "pm", "ROADMAP 12 — review the widget", "src/widget.mjs");
	await enqueueItem(tx, "impl", "qa", "DONE #2: an acknowledgement for a seat with no work", "ack", null, true);
}, ctx);
const before = await harness.snapshot(RigQueue, undefined, ctx);
check("the notice exists before the pass", before.items.length === 4 && before.items.some((it) => it.notice === true && it.status === "queued"), JSON.stringify(before.items.map((it) => [it.id, it.status, it.notice])));

const { driveOnce } = await import("../src/driver.mjs");
const actioned = await driveOnce(harness, {
	seats: { pm: { conversationId: convIds.pm }, impl: { conversationId: convIds.impl }, qa: { conversationId: convIds.qa } },
	items: before.items,
	pendingConvIds: new Set(),
	busySeats: new Set(),
	stoppedConvIds: new Set(),
	context: ctx,
});
check("both seats were woken for real work (the notice woke nobody)", actioned === 2, String(actioned));

const after = await harness.snapshot(RigQueue, undefined, ctx);
const ackd = after.items.find((it) => it.notice === true);
check("the notice is now done", ackd?.status === "done", String(ackd?.status));
check("it was ACKNOWLEDGED, not claimed or completed", (ackd?.transitions ?? []).some((t) => t.event === "acknowledged") && !(ackd?.transitions ?? []).some((t) => t.event === "claimed"), JSON.stringify(ackd?.transitions));
check("the notice row is RETAINED, not deleted", after.items.length === 4, String(after.items.length));
check("the work row was untouched by the sweep", after.items.find((it) => !it.notice)?.status !== "done", JSON.stringify(after.items.map((it) => [it.id, it.status])));
const qaNotice = after.items.find((it) => it.to === "qa");
check("a notice for a seat that was NOT woken is acknowledged too (the ack costs no seat turn)", qaNotice?.status === "done" && (qaNotice?.transitions ?? []).some((t) => t.event === "acknowledged"), JSON.stringify([qaNotice?.status, qaNotice?.transitions]));

console.log("\n=== 8. a row minted with a registration subject is created HELD, not claimable ===");
const heldStore = await Harness.open(new MemoryStorage(), { models, registry }, ctx);
await heldStore.commit(async (tx) => {
	await registerSeat(tx, "pm", convIds.pm, "program manager");
	await enqueueItem(tx, "pm", "impl", "ROADMAP 92 (BACKLOG — hold, do not start) [3/6]: expose the masking layer", "src/x.mjs");
}, ctx);
const heldQueue = await heldStore.snapshot(RigQueue, undefined, ctx);
const regRow = heldQueue.items[0];
check("the registration is structural", regRow?.registration === true, JSON.stringify(regRow?.registration));
check("and it is created HELD, so it cannot occupy a claim slot", regRow?.status === "held", String(regRow?.status));
check("and it is not workable", workable(regRow, "impl", { items: heldQueue.items }).workable === false, JSON.stringify(workable(regRow, "impl", { items: [] })));

console.log("\n=== 9. a mint the fan-out gate REFUSES is recorded, not just printed ===");
// The refusal has to be COUNTABLE. A gate that only returns a sentence to one seat is unmeasurable, and an
// unmeasured limit is eventually quietly raised (the inert-key class, ROADMAP 272). `enqueueItem` cannot
// write it itself — its refusal throws, and the throwing commit rolls the write back — so the send_work
// handler records it in its own commit.
const { recordMintRefusal } = await import("../src/rig.mjs");
const dupGate = mintGate(after.items, { to: "impl", subject: "Build the widget" });
check("the gate refuses the duplicate before anything is written", dupGate.ok === false, JSON.stringify(dupGate));
const recorded = await recordMintRefusal(harness, ctx, { by: "pm", to: "impl", subject: "Build the widget", gate: dupGate });
const ledger = (await harness.snapshot(RigQueue, undefined, ctx)).mintRefusals ?? [];
check("the refusal is committed as a transition-shaped event", recorded && ledger.length === 1, JSON.stringify(ledger));
check("...and it names seat, kind and reason so the census can count it", ledger[0]?.event === "mint-refused" && ledger[0]?.kind === "duplicate" && ledger[0]?.by === "pm" && ledger[0]?.to === "impl" && String(ledger[0]?.reason).includes("already holds an open row"), JSON.stringify(ledger[0]));
check("...and no row was minted by the refusal", (await harness.snapshot(RigQueue, undefined, ctx)).items.length === after.items.length, String((await harness.snapshot(RigQueue, undefined, ctx)).items.length));

// WIRING: the same record is written by the REAL send_work tool, not only by the helper. A separate store
// (the section-7 seats are already mid-wake, and a second submit into a woken conversation does not settle).
// The seat's turn is scripted with faux: no network, no key.
const wiredStore = await Harness.open(new MemoryStorage(), { models, registry }, ctx);
const wiredIds = {};
await wiredStore.commit(async (tx) => {
	for (const [name, role] of [["pm", "program manager"], ["impl", "implementation engineer"]]) {
		const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
		await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" }, instructions: compilePersona({ role }) });
		await registerSeat(tx, name, c.id, role);
		wiredIds[name] = c.id;
	}
	const ed = await tx.doc(Edges);
	ed.edges = [{ from: "pm", maySendTo: ["impl"] }, { from: "impl", maySendTo: ["pm"] }];
	await enqueueItem(tx, "pm", "impl", "Build the widget", "src/widget.mjs");
}, ctx);
faux.appendResponses([
	fauxAssistantMessage([fauxToolCall("send_work", { to: "impl", subject: "Build the widget", body: "src/widget.mjs" })], { stopReason: "toolUse" }),
	fauxAssistantMessage(fauxText("understood")),
]);
await (await wiredStore.conversation(wiredIds.pm, ctx).then((c) => c.submit({ type: "input", content: "go" }, ctx))).wait(ctx);
const wired = (await wiredStore.snapshot(RigQueue, undefined, ctx)).mintRefusals ?? [];
check("the tool path refuses the duplicate mint", (await wiredStore.snapshot(RigQueue, undefined, ctx)).items.length === 1, String((await wiredStore.snapshot(RigQueue, undefined, ctx)).items.length));
check("the tool path records the refusal too", wired.length === 1 && wired[0].kind === "duplicate" && wired[0].by === "pm", JSON.stringify(wired));
const bounded = Array.from({ length: 150 }, (_, n) => ({ ok: false, refusal: `refusal ${n}`, kind: "cap" }));
for (const g of bounded) await recordMintRefusal(harness, ctx, { by: "pm", to: "impl", subject: `task ${g.refusal}`, gate: g });
check("the ledger is bounded, so it is a signal and not a second queue", (await harness.snapshot(RigQueue, undefined, ctx)).mintRefusals.length === 100, String((await harness.snapshot(RigQueue, undefined, ctx)).mintRefusals.length));

console.log("\n=== 10. the CAP refusal is recorded the same way (task-5's literal clause) ===");
// The duplicate is not the only refusal that has to be countable: "a seat already holding N open rows cannot be
// minted past the cap, and the refusal is recorded as a transition". `recordMintRefusal` derives `kind` from the
// gate's shape — duplicateOf -> duplicate, band -> lineage, otherwise burst — so the BURST record is only kind-correct
// if the burst verdict carries NO `band` key (src/rig.mjs mintGate: the burst return omits `band`, the lineage return carries it).
const capGate = mintGate(hundredBurst, { to: "impl", subject: "task 101", body: "src/x.mjs", seats: 20 });
check("the cap refusal is the burst kind, not the lineage kind", capGate.ok === false && capGate.burst === 100 && !("band" in capGate) && capGate.duplicateOf === null, JSON.stringify({ k: Object.keys(capGate), burst: capGate.burst }));
const capRecorded = await recordMintRefusal(harness, ctx, { by: "pm", to: "impl", subject: "task 101", gate: capGate });
const capLedger = (await harness.snapshot(RigQueue, undefined, ctx)).mintRefusals ?? [];
check("the cap refusal is committed as a transition-shaped event", capRecorded && capLedger.at(-1)?.event === "mint-refused" && capLedger.at(-1)?.kind === "burst", JSON.stringify(capLedger.at(-1)));
check("...and the record names the cap, the window and the knob so a census can count it", String(capLedger.at(-1)?.reason).includes("mint-burst cap is 100") && String(capLedger.at(-1)?.reason).includes("7-day pressure window") && String(capLedger.at(-1)?.reason).includes("DURIG_MINT_BURST_CAP"), String(capLedger.at(-1)?.reason));
check("...and the ledger is still bounded at 100, so the cap cannot become a second queue", capLedger.length === 100, String(capLedger.length));
check("...and no row was minted by the cap refusal", (await harness.snapshot(RigQueue, undefined, ctx)).items.length === after.items.length, String((await harness.snapshot(RigQueue, undefined, ctx)).items.length));
console.log(failures === 0 ? "\nNOTICE-NOT-WORK TEST PASS (0 failures)" : `\nNOTICE-NOT-WORK TEST FAIL (${failures} failures)`);
process.exit(failures === 0 ? 0 : 1);
