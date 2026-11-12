// demo/workstrategy-claim.test.mjs — the claim path actually OBEYS the declared strategy, and
// `set_priority` is honest about whether it will change anything (D266).
//
// WHY THIS FILE EXISTS. demo/workstrategy.test.mjs pins the POLICY (pure functions) and
// demo/workstrategy-up.test.mjs pins DECLARE -> PERSIST -> READ BACK. Neither drives a claim, so the
// wiring in `src/rig.mjs` — resolve seat > team > default, call `selectNextWork`, append the ORDER
// line only for a non-default strategy — was covered by `node --check` alone. That is the
// passed-the-earlier-layers-and-failed-the-last shape this suite exists to prevent. The three facts
// below are the ones a reader would act on and none is visible from a fixture:
//   1. under the default, the claim reply is BYTE-IDENTICAL to before (no ORDER line, oldest row);
//   2. under `priority_first`, a leased `now` row is picked AHEAD of older rows, and the reply says so;
//   3. the seat override beats the team value, and `set_priority` TELLS the caller when the recipient's
//      resolved strategy ignores priority instead of returning a success-shaped sentence.
//
// Offline and fast (memory storage + the faux provider plane): no network, no keys, no worktree.
// Run: node demo/workstrategy-claim.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { Edges, RigQueue, Router, Seats, compilePersona, enqueueItem, registerSeat } from "../src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);

// `other` advertises a WORKING capability so it is not a coordinator (`seatIsCoordinator`); `pm` has
// none, so the same row is settable by it — that is the authority boundary being tested, not a role name.
await harness.commit(async (tx) => {
	const mk = async (name, role, capabilities) => {
		const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
		await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" }, instructions: compilePersona({ role }) });
		await registerSeat(tx, name, c.id, role);
		if (capabilities) (await tx.doc(Seats)).seats[name].capabilities = capabilities;
	};
	await mk("pm", "program manager");
	await mk("impl", "implementation engineer", ["implement"]);
	await mk("other", "implementation engineer", ["implement"]);
	const ed = await tx.doc(Edges);
	ed.edges = [{ from: "pm", maySendTo: ["impl", "other"] }];
	for (const [subject, to] of [
		["backlog A", "impl"],
		["backlog B", "impl"],
		["backlog C", "impl"],
		["backlog D", "impl"],
		["backlog E", "impl"],
		["backlog F", "impl"],
		["other seat's row", "other"],
	]) {
		await enqueueItem(tx, "pm", to, subject, `${subject} body`);
	}
}, ctx);

const roster = (await harness.snapshot(Seats, undefined, ctx)).seats;
const items = async () => (await harness.snapshot(RigQueue, undefined, ctx)).items;
const item = async (id) => (await items()).find((it) => it.id === id);
const setTeam = (strategy) =>
	harness.commit(async (tx) => {
		(await tx.doc(Seats)).workStrategy = strategy;
	}, ctx);
const setSeat = (name, strategy) =>
	harness.commit(async (tx) => {
		const seats = await tx.doc(Seats);
		if (strategy === null) delete seats.seats[name].workStrategy;
		else seats.seats[name].workStrategy = strategy;
	}, ctx);

let firstTurn = true;
async function say(name, toolName, toolArgs) {
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
	// The tool RESULT is what the seat was told, so assert on the transcript entry, not on a helper.
	const pg = await c.entries({}, 50, undefined, ctx);
	const own = pg.items
		.flatMap((e) => (Array.isArray(e.model) ? e.model : []))
		.filter((m) => m?.role === "toolResult")
		.map((m) => (Array.isArray(m.content) ? m.content.map((c2) => c2?.text ?? "").join("") : String(m.content ?? "")));
	// `entries` is newest-first, so the result of THIS call is the first toolResult in the page.
	return own[0] ?? "";
}

const future = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

try {
	// --- 1. THE DEFAULT IS UNCHANGED: oldest row, and no ORDER line in the reply -----------------
	const defaultClaim = await say("impl", "claim_work", {});
	assert.match(defaultClaim, /ITEM #1 \|/, `the default claim takes the oldest row (got: ${defaultClaim.slice(0, 120)})`);
	assert.ok(!defaultClaim.includes("ORDER:"), "the default strategy adds NO ORDER line — its bytes are the old bytes");

	// --- 2. priority_first picks the LEASED row ahead of older ones, and says so ----------------
	await setTeam("priority_first");
	const leased = await say("pm", "set_priority", {
		itemId: 4,
		priority: "now",
		reason: "operator asked for this first",
		expiresAt: future(2),
	});
	assert.match(leased, /priority=now/, leased);
	assert.match(leased, /DOES change the order/, "the reply says the lease will be honoured by the recipient");
	const stored = await item(4);
	assert.equal(stored.priority, "now", "the row carries the priority");
	assert.equal(stored.prioritySet.by, "pm", "…and who leased it");
	assert.equal(stored.prioritySet.authority, "sender", "…and on what authority (pm sent the row)");
	assert.ok((stored.transitions ?? []).some((t) => t.event === "priority"), "…and a transition, so the reordering is history");
	const ordered = await say("impl", "claim_work", {});
	assert.match(ordered, /ITEM #4 \|/, `priority_first claims #4 ahead of the older #2/#3 (got: ${ordered.slice(0, 120)})`);
	assert.match(ordered, /ORDER: priority_first \(from team\)/, "…and the reply names the strategy and its source");

	// --- 3. the SEAT override beats the team, and set_priority says the lease is inert ----------
	await setSeat("impl", "oldest_first");
	const inert = await say("pm", "set_priority", {
		itemId: 3,
		priority: "now",
		reason: "trying anyway",
		expiresAt: future(2),
	});
	assert.match(inert, /IGNORES priority/, "under the seat's oldest_first the reply says the lease changes NOTHING");
	assert.equal((await item(3)).priority, "now", "the lease is still RECORDED (it applies if the seat changes strategy)");
	const overrideClaim = await say("impl", "claim_work", {});
	assert.match(overrideClaim, /ITEM #2 \|/, "the seat override wins over the team: the oldest row is claimed");
	assert.ok(!overrideClaim.includes("ORDER:"), "a seat that resolves to oldest_first gets no ORDER line");

	// --- 4. a LAPSED lease ranks neutral at READ time (nothing runs at expiry) ------------------
	await setSeat("impl", null); // back to the team's priority_first
	await harness.commit(async (tx) => {
		const q = await tx.doc(RigQueue);
		const row = q.items.find((it) => it.id === 6); // the oldest unclaimed row now
		row.priority = "now";
		row.prioritySet = { at: "2026-01-01T00:00:00.000Z", by: "pm", reason: "expired test lease", expiresAt: "2026-01-02T00:00:00.000Z" };
	}, ctx);
	assert.equal((await item(6)).prioritySet.expiresAt, "2026-01-02T00:00:00.000Z", "the lease is stored in the past");
	const lapsedClaim = await say("impl", "claim_work", {});
	assert.match(lapsedClaim, /ITEM #3 \|/, "an expired lease does NOT win: the oldest row in the effective order is claimed");

	// --- 5. authority, terminal-first, and what may be ordered -----------------------------------
	const foreign = await say("other", "set_priority", {
		itemId: 5,
		priority: "later",
		reason: "not my row",
		expiresAt: future(1),
	});
	assert.match(foreign, /only the sender, the recipient, or a coordinating seat/, foreign);
	assert.equal((await item(5)).priority, undefined, "a seat unrelated to the row changes nothing");

	const claimed = await say("pm", "set_priority", {
		itemId: 1, // claimed in step 1, still open — in flight is not orderable
		priority: "now",
		reason: "too late",
		expiresAt: future(1),
	});
	assert.match(claimed, /still waiting for a seat \(queued or held\)/, claimed);

	// The generator may be a party: the recipient holds a HELD row and leases it for itself.
	await say("impl", "hold_work", { itemId: 5, reason: "parked for a moment" });
	const heldLease = await say("impl", "set_priority", {
		itemId: 5,
		priority: "now",
		reason: "I want it first when it is released",
		expiresAt: future(1),
	});
	assert.match(heldLease, /priority=now until/, heldLease);
	assert.match(heldLease, /applies when it is released/, "the reply names the held-row caveat instead of implying it is live");

	// --- 6. the QUEUE LINE shows the EFFECTIVE priority, so no two views of one row disagree -------
	const peeked = await say("impl", "peek_queue", { all: true });
	assert.match(peeked, /#5 held .*priority=now until=/, `a live lease prints with its expiry (got: ${peeked.slice(0, 400)})`);
	assert.match(
		peeked,
		/#6 .*priority=now~lapsed@2026-01-02T00:00:00.000Z/,
		"a LAPSED lease prints as lapsed with the instant — never as a still-urgent `now`",
	);
	assert.match(peeked, /#7 queued from=pm to=other other seat's row(?!.*priority=)/, "a row with no priority gains no field");

	// --- 7. a lease that cannot expire, or has already, is REFUSED -------------------------------
	const tooLong = await say("pm", "set_priority", {
		itemId: 6,
		priority: "now",
		reason: "forever",
		expiresAt: future(40),
	});
	assert.match(tooLong, /30 days|at most/, `an over-long lease is refused, naming the bound (got: ${tooLong.slice(0, 160)})`);
	const past = await say("pm", "set_priority", {
		itemId: 6,
		priority: "now",
		reason: "already over",
		expiresAt: "2020-01-01T00:00:00.000Z",
	});
	assert.match(past, /in the past/, `a past expiry is refused (got: ${past.slice(0, 160)})`);

	console.log("WORK STRATEGY CLAIM PASS — default unchanged, priority_first reorders the real claim, seat override wins, lapsed lease and refusals all hold");
} finally {
	await harness.close?.(ctx);
}
