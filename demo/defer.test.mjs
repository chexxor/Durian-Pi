// demo/defer.test.mjs — a seat can stop and ask (ROADMAP item 5).
//
// The research gap this closes is MAST's "no reason to defer to humans" (6.8%):
// a seat that cannot proceed had exactly two options, invent an answer or go
// quiet, and neither is visible to anyone. So the feature is two halves and both
// are asserted here — the item is PARKED (durable state, so it cannot be
// forgotten) and the wait is VISIBLE (an attention notice, because prose appears
// nowhere an operator looks).
//
// Driven through the real Router tools on a real harness with scripted faux
// responses, so the tool wrappers, the org-edge gate and the commit boundaries
// are all exercised rather than a re-implementation of them. MemoryStorage means
// no database and no temp directory.
import assert from "node:assert/strict";
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
	DEFERRED_TO_HUMAN,
	DEFERRED_TO_NOBODY,
	Edges,
	RigQueue,
	Router,
	Seats,
	compilePersona,
	enqueueItem,
	registerSeat,
} from "../src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);

await harness.commit(async (tx) => {
	const mk = async (name, role) => {
		const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
		await configure(tx, c.id, {
			model: { provider: "faux", modelId: "faux-seat" },
			instructions: compilePersona({ role }),
		});
		await registerSeat(tx, name, c.id, role);
	};
	await mk("pm", "program manager");
	await mk("worker", "implementation engineer");
	await mk("intruder", "unaffiliated agent");
	const ed = await tx.doc(Edges);
	// The intruder is deliberately granted nothing, so the edge gate has
	// something to refuse.
	ed.edges = [
		{ from: "pm", maySendTo: ["worker"] },
		{ from: "worker", maySendTo: ["pm"] },
	];
	// Three items, so the deferral cases do not fight over queue positions:
	// #1 and #2 to worker, #3 to the intruder.
	await enqueueItem(tx, "pm", "worker", "Build the widget", "details");
	await enqueueItem(tx, "pm", "worker", "Second task", "details");
	await enqueueItem(tx, "pm", "intruder", "Sneaky task", "details");
}, ctx);

const roster = (await harness.documentState(Seats, undefined, ctx)).value.seats;
const queueState = async () => (await harness.documentState(RigQueue, undefined, ctx)).value;
const item = async (id) => (await queueState()).items.find((it) => it.id === id);

/** Everything a seat said or saw, as one searchable string. */
async function transcript(name) {
	const c = await harness.conversation(roster[name].conversationId, ctx);
	const pg = await c.entries({}, 200, undefined, ctx);
	return pg.items.map((e) => JSON.stringify(e)).join("\n");
}

// One scripted turn: the tool call, then the text that ends it. Scripted per
// turn rather than up front so a desync in call ordering cannot silently shift
// every later scenario.
let firstTurn = true;
async function call(name, toolName, toolArgs) {
	const batch = [
		fauxAssistantMessage([fauxToolCall(toolName, toolArgs)], { stopReason: "toolUse" }),
		fauxAssistantMessage(fauxText("ok")),
	];
	if (firstTurn) {
		faux.setResponses(batch);
		firstTurn = false;
	} else {
		faux.appendResponses(batch);
	}
	const c = await harness.conversation(roster[name].conversationId, ctx);
	await (await c.submit({ type: "input", content: "go" }, ctx)).wait(ctx);
}

/* ------------------------------------------- 1. defer to the human operator */

await call("worker", "claim_work", {});
assert.equal((await item(1)).status, "claimed", "the item must be claimed before it can be deferred");

const itemsBefore = (await queueState()).items.length;
await call("worker", "defer_work", { itemId: 1, question: "Which widget did you mean?" });

const parked = await item(1);
assert.equal(parked.status, "deferred", "deferring parks the item rather than leaving it claimed");
assert.equal(parked.question, "Which widget did you mean?", "the question is recorded with the item");
	// #4574: THE VALUE IS THE BUG. A no-target deferral records NOBODY, not the operator — site 121's
	// COMPARISON stays exactly as it is (nothing is enqueued either way); only this value and the messages move.
	assert.equal(
		parked.deferredTo,
		DEFERRED_TO_NOBODY,
		"with no `to`, NOBODY was asked — the value records that rather than naming the operator",
	);
assert.ok(
	parked.transitions.some((t) => t.event === "deferred"),
	"the deferral is appended to the audit trail",
);
assert.equal(
	(await queueState()).items.length,
	itemsBefore,
	"deferring to the human enqueues nothing: the operator's channel is attention, not the queue",
);
	// #4574: SITE 126 IS A BEHAVIOUR ASSERTION IN DISGUISE — it reads as message content and pins the
	// no-target message to the OLD contract. The regex follows the new message.
	assert.match(
		await transcript("worker"),
		/deferred with NO target/,
		"the seat is told what happened — and now what happened is that NOBODY was asked",
	);

/* ------------------------------------------------ 2. the wait is visible */

const notices = computeAttention(
	Object.entries(roster).map(([name, s]) => ({ name, conversationId: s.conversationId })),
	(await queueState()).items,
	new Map(),
);
const awaiting = notices.find((n) => n.kind === "deferred_awaiting_answer");
assert.ok(awaiting, `a parked item must raise a notice; got ${JSON.stringify(notices)}`);
assert.equal(awaiting.seat, "worker", "the notice belongs to the seat holding the item");
	assert.match(awaiting.detail, /nobody has been asked/i, "it says NOBODY was asked rather than naming a person who was never asked");
	assert.doesNotMatch(awaiting.detail, /waiting on human/, "it does NOT fall back to the old waiting-on-human reading");
assert.equal(awaiting.scope, "seat", "notices carry a scope alongside the seat");

/* ------------------------------- 3. resume is possible: not a dead end */

await call("worker", "resume_work", { itemId: 1 });
assert.equal((await item(1)).status, "claimed", "resume_work takes the item back");
assert.ok((await item(1)).transitions.some((t) => t.event === "resumed"));

// Resume on an item that is not deferred must refuse rather than flip it.
await call("worker", "resume_work", { itemId: 1 });
assert.match(await transcript("worker"), /is not deferred \(status=claimed\)/, "resume refuses a non-deferred item");
assert.equal((await item(1)).status, "claimed", "and changes nothing when it does");

// The whole point of resume: the seat can finish the work afterwards.
await call("worker", "complete_work", { itemId: 1, resultSummary: "built it" });
assert.equal((await item(1)).status, "done", "a resumed item can still be completed");

/* -------------------------------------- 4. defer to a seat asks that seat */

await call("worker", "claim_work", {});
await call("worker", "defer_work", { itemId: 2, question: "Which widget?", to: "pm" });

const asked = await item(2);
assert.equal(asked.status, "deferred");
assert.equal(asked.deferredTo, "pm", "the deferral names the seat that can answer");
const question = (await queueState()).items.find((it) => it.subject?.startsWith("QUESTION #2"));
assert.ok(question, "asking a seat enqueues the question as real work, not prose");
assert.equal(question.to, "pm", "the question is addressed to the seat that was asked");
assert.equal(question.from, "worker", "and comes from the seat that is blocked");
assert.equal(question.body, "Which widget?", "the question body is the question the seat was given");

/* ------------------------- 5. asking a seat is a send, so the edge gate applies */

await call("intruder", "claim_work", {});
await call("intruder", "defer_work", { itemId: 3, question: "Can I ask?", to: "pm" });
	// #4574: THIS ASSERTION USED TO ENCODE THE BUG — it required an off-edge deferral to be REFUSED, which IS
	// the forced escalation. PARKED IS NOT SENT, so it is now recorded and not delivered.
	assert.doesNotMatch(
		await transcript("intruder"),
		/DEFER_WORK_ERROR/,
		"an off-edge deferral is NOT refused — the org edge governs SENDING, not parking",
	);
	const parkedOffEdge = await item(3);
const refused = await item(3);
	// #4574: the deferral is now ACCEPTED and RECORDED. This is a STRENGTHENING, not a softening: the old
	// pair checked one thing (a refusal); these check that the refusal is gone, the seat is recorded, it is
	// not relabelled as the operator, and nothing was sent.
	assert.equal(parkedOffEdge.status, "deferred", "the off-edge deferral took effect");
	assert.equal(parkedOffEdge.deferredTo, "pm", "and RECORDS the seat that should answer");
	assert.notEqual(parkedOffEdge.deferredTo, DEFERRED_TO_HUMAN, "and does NOT become an operator question — the assertion that would have saved #4124 hours");
assert.ok(
	!(await queueState()).items.some((it) => it.subject?.startsWith("QUESTION #3")),
	"and enqueued no question",
);

/* ------------------------------ 6. only the seat holding an item can defer it */

await call("pm", "defer_work", { itemId: 2, question: "not mine to defer" });
assert.match(await transcript("pm"), /addressed to pm, not you|addressed to worker, not you/, "the target must hold the item");
assert.equal((await item(2)).status, "deferred", "someone else's deferral does not change the item");

/* =================================== F30: hold_work / release_work =================================== */
// hold_work parks a claimed item in "held" status, making it unreachable by
// claim_work. release_work restores it to "queued" so selectWakes can re-wake it.

// First we need a claimed item to test hold_work on. Resume item 2 from deferred.
await call("worker", "resume_work", { itemId: 2 });
assert.equal((await item(2)).status, "claimed", "item 2 is claimed after resume");
// Then hold it.
await call("worker", "hold_work", { itemId: 2, reason: "blocked on upstream" });
assert.equal((await item(2)).status, "held", "hold_work sets status to held");
assert.equal((await item(2)).heldReason, "blocked on upstream", "heldReason is recorded");
assert.ok((await item(2)).transitions.some((t) => t.event === "held"), "held transition is appended");

// The held item must NOT be returned by claim_work (oldest-queued path).
const nextQueued = (await queueState()).items.find((it) => it.to === "worker" && it.status === "queued");
assert.equal(nextQueued, undefined, "no queued items for worker while #2 is held");
// claim_work should return NO_QUEUED_WORK since #2 is held, not queued.
const noQueuedResult = await transcript("worker");
assert.ok(noQueuedResult.includes("NO_QUEUED_WORK") || noQueuedResult.includes("claim_work"),
	"claim_work on a seat with only held items returns NO_QUEUED_WORK");

// --- F30(b): release_work restores the item to queued ---
await call("worker", "release_work", { itemId: 2 });
assert.equal((await item(2)).status, "queued", "release_work sets status back to queued");
assert.ok((await item(2)).transitions.some((t) => t.event === "released"), "released transition is appended");
// Now claim_work can pick it up again.
const queueAfterRelease = (await queueState()).items;
const reQueued = queueAfterRelease.find((it) => it.id === 2 && it.status === "queued");
assert.ok(reQueued, "#2 is back in queued status after release_work");

await harness.close(ctx);
console.log("DEFER TEST PASS (parks the item, is visible to a human, resumes, asks a seat, edge-gated, hold/release)");
process.exit(0);
