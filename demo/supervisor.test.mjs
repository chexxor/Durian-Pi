// demo/supervisor.test.mjs — the narrow supervisor's escalation pass (ROADMAP 42 / P3, #145).
//
// The gap this closes: the driver recovers mechanically (retry, re-wake, doctor) but nothing
// escalates a PERSISTENT problem to the human. Observed this session: a seat failed run after run
// and a question sat parked on a seat for 78 minutes, both with no human-facing escalation.
// The supervisor consumes the derived state and parks the stuck item on the human through the
// EXISTING defer representation (`status:"deferred"`, `deferredTo:"human"`).
//
// Proves: (a) failureStreak counts a leading run of failures; (b) a repeated-failure seat's item
// is escalated; (c) an item already on the human is NOT re-escalated (idempotent); (d) a question
// parked on an unanswering SEAT past the bound is escalated; (e) applyEscalations writes the defer
// representation, and re-planning afterwards plans nothing; (f) the `repeated_failure` notice
// class surfaces in computeAttention.
// Run: node demo/supervisor.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { computeAttention } from "../src/attention.mjs";
import { Edges, RigQueue, Router, Seats, enqueueItem, registerSeat } from "../src/rig.mjs";
import { applyEscalations, failureStreak, planEscalations } from "../src/supervisor.mjs";

/* ------------------------------ pure: failureStreak ------------------------------ */

assert.equal(failureStreak([]), 0, "no submissions is no streak");
assert.equal(
	failureStreak([{ status: "unanswered" }, { status: "unanswered" }, { status: "done" }, { status: "unanswered" }]),
	2,
	"the streak is the LEADING run of failures, not a total count",
);
assert.equal(failureStreak([{ status: "done" }, { status: "unanswered" }]), 0, "a done run ends the streak");

/* ---------------------------- pure: planEscalations ---------------------------- */

const nowMs = Date.parse("2026-10-12T12:00:00Z");
const old = new Date(nowMs - 30 * 60_000).toISOString();
const recent = new Date(nowMs - 60_000).toISOString();

const repeated = planEscalations({
	seats: [{ name: "impl", conversationId: 9 }],
	queueItems: [{ id: 7, to: "impl", status: "claimed", subject: "stuck" }],
	failureStreakByConv: new Map([[9, 3]]),
	nowMs,
});
assert.equal(repeated.length, 1, "a seat with 3 consecutive failures escalates its held item");
assert.equal(repeated[0].reason, "repeated_failure");
assert.equal(repeated[0].itemId, 7);

assert.deepEqual(
	planEscalations({
		seats: [{ name: "impl", conversationId: 9 }],
		queueItems: [{ id: 7, to: "impl", status: "deferred", deferredTo: "human", subject: "stuck" }],
		failureStreakByConv: new Map([[9, 3]]),
		nowMs,
	}),
	[],
	"an item already owned by the human is not re-escalated (idempotent)",
);

// A question parked on ANOTHER SEAT past the bound is escalated to the human.
const parkedOnSeat = planEscalations({
	seats: [],
	queueItems: [
		{
			id: 8,
			to: "impl",
			status: "deferred",
			deferredTo: "lead",
			subject: "ruling needed",
			transitions: [{ event: "deferred", at: old }],
		},
	],
	failureStreakByConv: new Map(),
	nowMs,
});
assert.equal(parkedOnSeat.length, 1, "a question on an unanswering seat past the bound is escalated");
assert.equal(parkedOnSeat[0].reason, "deferred_awaiting_answer");

assert.deepEqual(
	planEscalations({
		seats: [],
		queueItems: [
			{
				id: 9,
				to: "impl",
				status: "deferred",
				deferredTo: "lead",
				subject: "fresh question",
				transitions: [{ event: "deferred", at: recent }],
			},
		],
		failureStreakByConv: new Map(),
		nowMs,
	}),
	[],
	"a freshly parked question is not escalated yet (bounded by time)",
);

/* --------------------------- realized: applyEscalations --------------------------- */

const ctx = BACKGROUND_CONTEXT;
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const storage = new MemoryStorage();
const harness = await Harness.open(storage, { models, registry }, ctx);

let conversationId;
await harness.commit(async (tx) => {
	const conv = await tx.createConversation({ ownership: { kind: "ownerless" } });
	conversationId = conv.id;
	await configure(tx, conv.id, { model: { provider: "faux", modelId: "faux-seat" } });
	await registerSeat(tx, "worker", conv.id, "implementation");
	(await tx.doc(Seats)).seats.worker.capabilities = ["implement"];
	await (async () => {
		const ed = await tx.doc(Edges);
		ed.edges = [{ from: "worker", maySendTo: ["boss"] }];
	})();
}, ctx);

const itemId = await harness.commit(async (tx) => {
	const id = await enqueueItem(tx, "boss", "worker", "Stalled work", "body");
	const queue = await tx.doc(RigQueue);
	queue.items.find((it) => it.id === id).status = "claimed";
	return id;
}, ctx);

const queueItems = (await harness.documentState(RigQueue, undefined, ctx)).value.items;
const plans = planEscalations({
	seats: [{ name: "worker", conversationId }],
	queueItems,
	failureStreakByConv: new Map([[conversationId, 4]]),
	nowMs,
});
const applied = await applyEscalations(harness, plans, ctx);
assert.equal(applied.length, 1, "the escalation was applied");

const after = (await harness.documentState(RigQueue, undefined, ctx)).value.items.find((it) => it.id === itemId);
assert.equal(after.status, "deferred", "the stuck item is parked, not silently dropped");
assert.equal(after.deferredTo, "human", "parked ON THE HUMAN");
assert.equal(after.transitions.at(-1).by, "supervisor", "the deferral is attributed to the supervisor");

// (e) re-planning against the updated queue yields nothing — the write is idempotent.
assert.deepEqual(
	planEscalations({
		seats: [{ name: "worker", conversationId }],
		queueItems: [after],
		failureStreakByConv: new Map([[conversationId, 4]]),
		nowMs,
	}),
	[],
	"a second pass does not re-escalate the same item",
);

/* ------------------ the repeated_failure notice class in computeAttention ------------------ */

const notice = computeAttention(
	[{ name: "worker", conversationId }],
	[],
	new Map([[conversationId, { status: "unanswered" }]]),
	new Map(),
	{ nowMs, failureStreakByConv: new Map([[conversationId, 3]]) },
).find((n) => n.kind === "repeated_failure");
assert.ok(notice, "computeAttention surfaces repeated_failure");
assert.match(notice.detail, /3 consecutive failed runs/);

/* --------- the `spend_cap_exceeded` CAUSE CLASS (#5047, acceptance P7) ---------
   The failure this closes: a cap trip arrives as `model_error`, so the driver retries it (2 SDK retries), the
   supervisor's repeated_failure escalation needs THREE spends to notice, and every one of those attempts costs
   money against the cap that just stopped it. Naming the cause lets the notice and the escalation branch on it. */
const SPEND_TEXT =
	"spend_cap_exceeded (durig's own cap, out of budget under it - NOT the provider's): deepinfra/zai-org/GLM-5.3-Flash " +
	"projects $0.000182 and would cross DURIG_SPEND_CAP_CALL_USD $0.0500 (one call, projected). No request was sent and " +
	"no ledger row was written. Remedy: the OPERATOR raises the named cap deliberately for a named run.";

const spendNotices = computeAttention(
	[{ name: "worker", conversationId }],
	[],
	new Map([[conversationId, { status: "unanswered" }]]),
	new Map([[conversationId, SPEND_TEXT]]),
	{ nowMs, failureStreakByConv: new Map([[conversationId, 3]]) },
);
const spendNotice = spendNotices.find((n) => n.kind === "spend_cap_exceeded");
assert.ok(spendNotice, "computeAttention NAMES the money cause instead of burying it in last_run_failed");
assert.match(spendNotice.detail, /DURIG_SPEND_CAP_CALL_USD/, "and says WHICH cap fired");
assert.match(spendNotice.detail, /not a model fault/);
assert.match(spendNotice.detail, /only the OPERATOR raises a cap/);
assert.equal(spendNotices.find((n) => n.kind === "last_run_failed"), undefined, "one notice per cause: the cap stop replaces the generic failed-run notice");
assert.equal(spendNotices.find((n) => n.kind === "repeated_failure"), undefined, "and the streak notice, whose only cause is the same stop");

const money = planEscalations({
	seats: [{ name: "impl", conversationId: 9 }],
	queueItems: [{ id: 7, to: "impl", status: "claimed", subject: "stuck" }],
	failureStreakByConv: new Map([[9, 1]]),
	errorByConv: new Map([[9, SPEND_TEXT]]),
	nowMs,
});
assert.equal(money.length, 1, "a money stop parks the item on the FIRST failed run — waiting for a streak spends money against the same cap");
assert.equal(money[0].reason, "spend_cap_exceeded", "the plan carries the cause class, not repeated_failure");
assert.match(money[0].question, /DURIG_SPEND_CAP_CALL_USD/, "the human-facing question names the cap to raise");
assert.match(money[0].question, /NOT retried/);
assert.match(money[0].question, /spend\.jsonl/, "and points at the money record");
assert.deepEqual(
	planEscalations({
		seats: [{ name: "impl", conversationId: 9 }],
		queueItems: [{ id: 7, to: "impl", status: "claimed", subject: "stuck" }],
		failureStreakByConv: new Map([[9, 1]]),
		errorByConv: new Map([[9, "Connection error."]]),
		nowMs,
	}),
	[],
	"an ordinary failure still waits for the streak: the money stop is the exception, not a new default",
);

await harness.close(ctx);
console.log(
	"SUPERVISOR TEST PASS (repeated failure and a question parked on an unanswering seat escalate to the human, idempotently, through the existing defer channel; a spend-cap stop is a NAMED cause that parks on the first failure and is not retried)",
);
process.exit(0);
