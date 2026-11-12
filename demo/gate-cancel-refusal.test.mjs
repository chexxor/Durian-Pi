// demo/gate-cancel-refusal.test.mjs — a `blockedBy` gate may not name a CANCELLED row (#6215).
//
// WHY. `workable()` (#2673, the ONE claimability predicate that claim selection and broker wake
// selection both read) refuses a row whose gate names a cancelled id: `gate-cancelled:#<id>`.
// `cancelled` is terminal and can never become `done`, so that refusal is permanent. Nothing at
// ENQUEUE time stopped such a gate from being written, so the rig could create a row no seat could
// ever claim, and the only symptom was a seat that never wakes.
//
// Measured on the live store with tools/probes/gate-starvation-census.mjs (run 2026-11-12, exit 0):
// 484 gate references, 67 of them naming a CANCELLED row, 19 of those dependents still held or
// deferred — permanently unclaimable, invisible in every count that says "queued".
//
// CONTRACT proved here, in three layers:
//   1. the RULE: `deadGateIds` names every gate that can never close (cancelled = dead, done = fine,
//      absent = ambiguous and therefore NOT dead — the #2673 conservative default);
//   2. the STARVATION: such a row is not workable on any pass, under either claim strategy, and its
//      gate has no exit;
//   3. the ENQUEUE GUARD: the real write path refuses to create the gate, writes nothing, and says
//      what to do instead — while gates on DONE rows and gates on ids that do not exist still go through.
//
// Failing-first: on HEAD before this change the same `send_work({blockedBy:[<cancelled id>]})`
// succeeds and the item sits unclaimable forever. Falsifier in the completion names the command.
//
// Run: node demo/gate-cancel-refusal.test.mjs   (exit 0 = pass)
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
	fauxAssistantMessage,
	fauxProvider,
	fauxText,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { computeAttention } from "../src/attention.mjs";
import {
	deadGateId,
	deadGateIds,
	enqueueItem,
	queueItemLine,
	registerSeat,
	RigQueue,
	Router,
	Seats,
	selectNextWork,
	workable,
} from "../src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;
let failures = 0;
function check(label, condition, detail = "") {
	if (condition) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
	}
}

/* ─── 1. the rule, as one function three surfaces share ───────────────────── */
console.log("\n1. deadGateIds — which gates can never close");
const items = [
	{ id: 1, status: "cancelled" },
	{ id: 2, status: "done" },
	{ id: 3, status: "queued" },
	{ id: 4, status: "held" },
];
check("a cancelled gate is dead", deadGateIds({ blockedBy: [1] }, items).join(",") === "1");
check("a done gate is not dead (it reached its terminal state as work)", deadGateIds({ blockedBy: [2] }, items).length === 0);
check("a live gate is not dead", deadGateIds({ blockedBy: [3, 4] }, items).length === 0);
check("an id that names no row is AMBIGUOUS, not dead (#2673 conservative default)", deadGateIds({ blockedBy: [9999] }, items).length === 0);
check("every dead id is listed, not just the first", deadGateIds({ blockedBy: [1, 2, 1, 3] }, items).join(",") === "1");
check("deadGateId stays the singular alias the release refusal reads", deadGateId({ blockedBy: [2, 1] }, items) === 1);
check("no gate -> no dead gate", deadGateIds({}, items).length === 0 && deadGateIds({ blockedBy: null }, items).length === 0);

/* ─── 2. the starvation: a dead gate has no exit ───────────────────────────── */
console.log("\n2. a row gated on a cancelled id is unclaimable on every pass");
const cancelledParent = { id: 10, from: "pm", to: "impl", status: "cancelled", subject: "container" };
const starved = { id: 11, from: "pm", to: "impl", status: "queued", subject: "child of a cancelled row", blockedBy: [10] };
const roster = [cancelledParent, starved];

check("workable() refuses it", workable(starved, "impl", { items: roster }).workable === false);
check("the refusal NAMES the dead gate", workable(starved, "impl", { items: roster }).reason === "gate-cancelled:#10");
// The same row, selected 50 times, is never claimable: the gate cannot close because the row it names is
// terminal. This is the "forever" the defect is about, made countable.
let claimedInFiftyPasses = 0;
for (let pass = 0; pass < 50; pass += 1) {
	const picked = selectNextWork(roster, "impl", { strategy: "oldest_first" });
	if (picked.item) claimedInFiftyPasses += 1;
}
check("50 claim passes claim it 0 times", claimedInFiftyPasses === 0, `${claimedInFiftyPasses}`);
check("the skip is reported with the reason, not silently", selectNextWork(roster, "impl").skipped.map((s) => s.reason).join(",") === "gate-cancelled:#10");
check("the same under priority_first (a lease cannot rescue a dead gate)", selectNextWork([{ ...starved, priority: { priority: "now", reason: "urgent", expiresAt: new Date(Date.now() + 60000).toISOString() } }, cancelledParent], "impl", { strategy: "priority_first" }).item === null);

/* ─── 3. the queue line says so, so a seat is not left guessing ────────────── */
console.log("\n3. the row a seat reads carries the DEAD-GATE marker");
const line = queueItemLine(starved, roster);
check("the line names the gate", line.includes("blockedBy=10"), line);
check("the line says the gate is DEAD and which id", line.includes("DEAD-GATE=#10"), line);
check("a live gate is NOT marked dead", !queueItemLine({ id: 12, status: "queued", from: "pm", to: "impl", subject: "x", blockedBy: [2] }, roster).includes("DEAD-GATE"));

/* ─── 4. `durig status` sees it ────────────────────────────────────────────── */
console.log("\n4. computeAttention turns it into an operator notice");
const seats = [{ name: "impl", conversationId: 1 }];
const notices = computeAttention(seats, roster, new Map([[1, { settled: true }]]), new Map()).filter((n) => n.kind === "starved_gate");
check("the notice exists for the starved seat", notices.length === 1, JSON.stringify(notices));
check("it names both the dependent and the dead gate", /#11 gates on cancelled #10/.test(notices[0]?.detail ?? ""), notices[0]?.detail);
check("it says the GATE is the problem, not the seat", /GATE is the problem/i.test(notices[0]?.detail ?? ""), notices[0]?.detail);
const clean = computeAttention(seats, [{ id: 20, from: "pm", to: "impl", status: "queued", subject: "fine", blockedBy: [2] }, cancelledParent], new Map(), new Map()).filter((n) => n.kind === "starved_gate");
check("a row gated on a DONE row produces no such notice", clean.length === 0, JSON.stringify(clean));

/* ─── 5. the write path REFUSES it ─────────────────────────────────────────── */
console.log("\n5. enqueue: the guard refuses the gate and writes nothing");
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);

try {
	await harness.commit(async (tx) => {
		for (const [name, role] of [["pm", "program manager"], ["impl", "implementation engineer"]]) {
			const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
			await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" } });
			await registerSeat(tx, name, c.id, role);
		}
	}, ctx);

	const queue = async () => (await harness.snapshot(RigQueue, undefined, ctx)).items;
	const roster0 = await harness.snapshot(Seats, undefined, ctx);
	const call = async (name, toolName, toolArgs) => {
		const batch = [
			fauxAssistantMessage([fauxToolCall(toolName, toolArgs)], { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxText("ok")),
		];
		faux.appendResponses(batch);
	 const c = await harness.conversation(roster0.seats[name].conversationId, ctx);
		await (await c.submit({ type: "input", content: "go" }, ctx)).wait(ctx);
	};

	// A parent that gets CANCELLED (the same write `cancel_work` performs: status + transition).
	let parentId = null;
	await harness.commit(async (tx) => {
		const q = await tx.doc(RigQueue);
	 parentId = await enqueueItem(tx, "pm", "impl", "container row", "an umbrella registration");
		const row = q.items.find((it) => it.id === parentId);
		row.status = "cancelled";
		row.transitions.push({ at: new Date().toISOString(), event: "cancelled", by: "pm" });
	}, ctx);
	check("the parent is cancelled", (await queue()).find((it) => it.id === parentId).status === "cancelled");

	const before = (await queue()).length;
	let refusal = null;
	try {
		await harness.commit(async (tx) => {
			await enqueueItem(tx, "pm", "impl", "child of a cancelled row", "body", null, false, null, false, [parentId]);
		}, ctx);
	} catch (err) {
		refusal = err;
	}
	check("enqueueItem THROWS on a gate naming a cancelled row", refusal instanceof Error, String(refusal));
	check("the refusal names the cancelled id", String(refusal?.message).includes(`#${parentId}`), refusal?.message);
	check("the refusal says why (can never reach done)", /can never reach done/i.test(String(refusal?.message)), refusal?.message);
	check("the refusal says what to do instead", /Gate on the row that carries the work/i.test(String(refusal?.message)), refusal?.message);
check("NOTHING was written: the starved row never enters the queue", (await queue()).length === before, `${(await queue()).length} vs ${before}`);

	// The guard must not be a blanket ban: legitimate gates still go through.
	await harness.commit(async (tx) => {
		const q = await tx.doc(RigQueue);
		const doneId = await enqueueItem(tx, "pm", "impl", "real work", "body", null, false, null, false, null);
		q.items.find((it) => it.id === doneId).status = "done";
		await enqueueItem(tx, "pm", "impl", "gated on a DONE row", "body", null, false, null, false, [doneId]);
		await enqueueItem(tx, "pm", "impl", "gated on an id that does not exist", "body", null, false, null, false, [99999]);
		await enqueueItem(tx, "pm", "impl", "ungated", "body", null, false, null, false, null);
	}, ctx);
	const after = await queue();
	check("a gate on a DONE row is still accepted", after.some((it) => it.subject === "gated on a DONE row" && JSON.stringify(it.blockedBy) === `[${after.find((it) => it.subject === "real work").id}]`));
	check("a gate on an ABSENT id is still accepted (ambiguous, stays workable)", after.some((it) => it.subject === "gated on an id that does not exist"));
	check("the absent-id row is workable, not starved", workable(after.find((it) => it.subject === "gated on an id that does not exist"), "impl", { items: after }).workable === true);

	// Through the TOOL, not just the function: the sender sees the refusal, and no row is created.
	const beforeTool = (await queue()).length;
	await call("pm", "send_work", { to: "impl", subject: "via the verb", body: "body", blockedBy: [parentId] });
	check("send_work created no row for a dead gate", (await queue()).length === beforeTool, `${(await queue()).length} vs ${beforeTool}`);
	const pmTranscript = await (async () => {
	 const c = await harness.conversation(roster0.seats.pm.conversationId, ctx);
	 const pg = await c.entries({}, 200, undefined, ctx);
	 return pg.items.map((e) => JSON.stringify(e)).join("\n");
	})();
	check("the refusal reaches the sender's transcript", /CANCELLED and can never reach done/i.test(pmTranscript), "");

	// And the starvation is VISIBLE on the row a seat reads, end to end through the store.
	const starvedRow = { id: 100, from: "pm", to: "impl", status: "queued", subject: "already starved", blockedBy: [parentId] };
	check("the rendered queue line for an existing starved row marks it DEAD-GATE", queueItemLine(starvedRow, [...after, starvedRow]).includes("DEAD-GATE=#" + parentId));
} finally {
	await harness.close(ctx);
}

console.log(
	failures === 0
		? "\nPASS — a gate that can never close is refused at write time and named at read time"
		: `\nFAIL — ${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
