// demo/provider-auth-cause.test.mjs — #6081: a missing API key is an ENVIRONMENT, not a seat that fails.
//
// THE DEFECT, measured by the delegate on 2026-11-10: the broker process was started without
// DURIG_LOCAL_API_KEY (read off /proc/<pid>/environ). Every seat generation answered HTTP 401
// "missing or wrong API key", the store filed each run as `model_error`, and the supervisor's
// repeated-failure guard escalated 171 queue rows to the human - including a whole roadmap batch -
// because a credential was absent. One unset variable converted 171 work items into human
// escalations, and the fleet then reported `SKIP <seat> reason=parked-deduped` with nothing to claim.
//
// The rule this pins: a provider that refuses the CREDENTIAL is a DIFFERENT class from a seat that
// cannot make progress. The first is fixed by the operator setting a variable; the second is a
// diagnosis problem that needs a human decision. Escalating an environment fault to a human is the
// wrong verb: the human has nothing to decide, and the queue is now parked on a key.
//
// Proves: (a) the detector separates auth stops from spend stops, transport errors and rate limits;
// (b) computeAttention surfaces `provider_auth` INSTEAD of `repeated_failure`, and the notice NAMES
// the credential variable the rig reads; (c) planEscalations records NO human escalation for an auth
// stop at any streak, while an ordinary repeated failure still escalates at the streak; (d) against a
// REAL store the item is still claimed and never `deferredTo: "human"` after an auth pass, and the
// same seat DOES reach the human on a genuine failure - the old path is not weakened.
// Run: node demo/provider-auth-cause.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";

import { computeAttention } from "../src/attention.mjs";
import { PROVIDER_AUTH_CAUSE, isProviderAuthStopMessage } from "../src/causes.mjs";
import { applyEscalations, planEscalations } from "../src/supervisor.mjs";

/* ------------------------- the shapes the rig actually sees ------------------------- */

// Verbatim in shape from the store rows the delegate read on 2026-11-10: pi-ai prefixes the provider
// response with the status code, and the useful part is inside the JSON body.
const AUTH_TEXT = '401: {"error":{"message":"missing or wrong API key","type":"authentication_error","code":"missing_api_key"}}';
const AUTH_TEXT_PLAIN = "401 Unauthorized: Invalid API key";
const AUTH_TEXT_FORBIDDEN = '403: {"error":{"message":"Forbidden: no credential on this request"}}';
const SPEND_TEXT =
	"spend_cap_exceeded (durig's own cap, out of budget under it - NOT the provider's): local/iq3_s projects $0.000182 " +
	"and would cross DURIG_SPEND_CAP_CALL_USD $0.0500 (one call, projected). No request was sent and no ledger row was written.";
const RATE_LIMIT_TEXT = '429: {"error":{"message":"Rate limit reached. Please try again later."}}';
const TRANSPORT_TEXT = "Connection error.";

const authCases = [
	[AUTH_TEXT, true],
	[AUTH_TEXT_PLAIN, true],
	[AUTH_TEXT_FORBIDDEN, true],
	["401: {\"error\":{\"message\":\"Invalid API key\"}}", true],
	[SPEND_TEXT, false],
	[RATE_LIMIT_TEXT, false],
	[TRANSPORT_TEXT, false],
	["The model returned no tool call.", false],
	["", false],
	[null, false],
	[undefined, false],
];
for (const [text, expected] of authCases) {
	assert.equal(
		isProviderAuthStopMessage(text),
		expected,
		`the detector must ${expected ? "catch" : "refuse"} a credential refusal, not a budget or transport stop: ${String(text).slice(0, 40)}`,
	);
}

/* ----------------------- the notice: named, not buried in a streak ----------------------- */

const nowMs = Date.parse("2026-11-10T12:00:00Z");
const conv = 42;

const notices = computeAttention(
	[{ name: "impl", conversationId: conv }],
	[],
	new Map([[conv, { status: "unanswered" }]]),
	new Map([[conv, AUTH_TEXT]]),
	{ nowMs, failureStreakByConv: new Map([[conv, 5]]) },
);
const authNotice = notices.find((n) => n.kind === PROVIDER_AUTH_CAUSE);
assert.ok(authNotice, `computeAttention names the credential stop as its own class (${PROVIDER_AUTH_CAUSE})`);
assert.match(authNotice.detail, /DURIG_LOCAL_API_KEY/, "the notice names the credential variable the rig reads");
assert.match(authNotice.detail, /environmental/i, "and says what class of problem it is");
assert.equal(notices.find((n) => n.kind === "repeated_failure"), undefined, "one notice per cause: the streak is a symptom of the same missing key");

/* ----------------------- the escalation: surface it, do not park it on a human ----------------------- */

const heldItem = [{ id: 101, to: "impl", status: "claimed", subject: "N18 row", deferredTo: null }];

assert.deepEqual(
	planEscalations({
		seats: [{ name: "impl", conversationId: conv }],
		queueItems: heldItem,
		failureStreakByConv: new Map([[conv, 5]]),
		errorByConv: new Map([[conv, AUTH_TEXT]]),
		nowMs,
	}),
	[],
	"171 rows must not become 171 human escalations because the broker had no key: an environmental stop escalates NOTHING",
);

assert.deepEqual(
	planEscalations({
		seats: [{ name: "impl", conversationId: conv }],
		queueItems: heldItem,
		failureStreakByConv: new Map([[conv, 30]]),
		errorByConv: new Map([[conv, AUTH_TEXT]]),
		nowMs,
	}),
	[],
	"the streak bound does not rescue it: thirty 401s are still one missing variable",
);

// The genuine path must still work, unchanged.
const genuine = planEscalations({
	seats: [{ name: "impl", conversationId: conv }],
	queueItems: heldItem,
	failureStreakByConv: new Map([[conv, 3]]),
	errorByConv: new Map([[conv, "TypeError: cannot read properties of undefined"]]),
	nowMs,
});
assert.equal(genuine.length, 1, "a seat that genuinely cannot progress still reaches the human at the streak");
assert.equal(genuine[0].reason, "repeated_failure", "with the class it always had");

// And the money class is untouched by this change: it still parks on the FIRST stop.
const money = planEscalations({
	seats: [{ name: "impl", conversationId: conv }],
	queueItems: heldItem,
	failureStreakByConv: new Map([[conv, 1]]),
	errorByConv: new Map([[conv, SPEND_TEXT]]),
	nowMs,
});
assert.equal(money.length, 1, "a spend stop is still an escalation, on the first failure");
assert.equal(money[0].reason, "spend_cap_exceeded");

/* ----------------------- against a real store: nothing is parked on the human ----------------------- */

const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
const { createModels } = await import("@earendil-works/pi-ai/models");
const { fauxProvider } = await import("@earendil-works/pi-ai/providers/faux");
const { configure, createRegistry, Harness, MemoryStorage } = await import("@earendil-works/pi-durable");
const { RigQueue, Router, Seats, enqueueItem, registerSeat } = await import("../src/rig.mjs");

const ctx = BACKGROUND_CONTEXT;
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);

let conversationId;
const itemId = await harness.commit(async (tx) => {
	const seatConv = await tx.createConversation({ ownership: { kind: "ownerless" } });
	conversationId = seatConv.id;
	await configure(tx, seatConv.id, { model: { provider: "faux", modelId: "faux-seat" } });
	await registerSeat(tx, "impl", seatConv.id, "implementation");
	(await tx.doc(Seats)).seats.impl.capabilities = ["implement"];
	const id = await enqueueItem(tx, "lead", "impl", "N18 row stalled by a missing key", "body");
	const queue = await tx.doc(RigQueue);
	queue.items.find((it) => it.id === id).status = "claimed";
	return id;
}, ctx);

// A pass over a seat whose every run 401s.
for (let pass = 0; pass < 3; pass++) {
	const queueItems = (await harness.snapshot(RigQueue, undefined, ctx)).items;
	const plans = planEscalations({
		seats: [{ name: "impl", conversationId }],
		queueItems,
		failureStreakByConv: new Map([[conversationId, 5]]),
		errorByConv: new Map([[conversationId, AUTH_TEXT]]),
		nowMs,
	});
	const applied = await applyEscalations(harness, plans, ctx);
	assert.equal(applied.length, 0, `pass ${pass}: an environmental stop writes nothing to the queue`);
}

const afterAuth = (await harness.snapshot(RigQueue, undefined, ctx)).items.find((it) => it.id === itemId);
assert.equal(afterAuth.status, "claimed", "the item is still with the seat - not parked on a human, not dropped");
assert.notEqual(afterAuth.deferredTo, "human", "no human escalation was recorded in the store");
assert.equal(
	(afterAuth.transitions ?? []).filter((t) => t.event === "deferred" && t.by === "supervisor").length,
	0,
	"and no supervisor deferral is even in the transition history",
);

// The SAME seat, now genuinely failing: the escalation still happens.
const genuinePlans = planEscalations({
	seats: [{ name: "impl", conversationId }],
	queueItems: [afterAuth],
	failureStreakByConv: new Map([[conversationId, 4]]),
	errorByConv: new Map([[conversationId, "TypeError: cannot read properties of undefined"]]),
	nowMs,
});
const genuineApplied = await applyEscalations(harness, genuinePlans, ctx);
assert.equal(genuineApplied.length, 1, "the repeated-failure path is not weakened by the new class");
const afterGenuine = (await harness.snapshot(RigQueue, undefined, ctx)).items.find((it) => it.id === itemId);
assert.equal(afterGenuine.status, "deferred");
assert.equal(afterGenuine.deferredTo, "human");

await harness.close(ctx);
console.log(
	`PROVIDER-AUTH CAUSE TEST PASS (${PROVIDER_AUTH_CAUSE} is a named, environmental class: it surfaces in attention with the credential variable it wants, and it escalates NOTHING to the human, while a genuine repeated failure still escalates at the streak and a spend stop still parks on the first failure)`,
);
process.exit(0);
