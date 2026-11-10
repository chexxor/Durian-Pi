// demo/hold-queued-row.test.mjs — a row addressed to you can be PARKED without claiming it first (#5724).
//
// WHY THIS FILE EXISTS (the measurement, from architect's #5661, reproduced here rather than quoted).
// `hold_work` required `status === "claimed"`. So a seat that wanted to park a row addressed to it —
// "registered, do not start" — had to claim first, then hold. Two consequences, both real:
//   (1) the cycle costs two calls and one wasted claim, and `complete_work` then refuses the held row,
//       so the claim is not recoverable as a completion;
//   (2) between the claim and the hold the row is `claimed`, which is a state the driver has to reason
//       about — the wake-vs-workable gap already registered as #5438.
// `send_work(..., held: true)` already exists for a sender parking a row at intake, but a RECIPIENT has
// no equivalent: it cannot re-park a live queued row without claiming it.
//
// FAILING-FIRST. On the unfixed tree the first assertion below throws: `hold_work` on a QUEUED row
// addressed to the caller answers "item #N is not claimed by you (status=queued)" and the row stays
// `queued` — i.e. still wake-able by the driver's selector (`src/broker.mjs:127`, which selects
// `status === "queued"`). Run it before the change to see the red:
//   node demo/hold-queued-row.test.mjs   (exit 1 before the fix, 0 after)
//
// The change is deliberately narrow. It does NOT add a status, does NOT widen who may act on a row
// (a row addressed to someone else still refuses, a terminal row still refuses), and does not touch the
// wake selector: the whole point is that a parked row is never wake-able, so parking must go straight
// from `queued` to `held`.
//
// Run: node demo/hold-queued-row.test.mjs   (exit 0 = pass)
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

import {
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
	await mk("impl", "implementation engineer");
	await mk("other", "implementation engineer");
	const ed = await tx.doc(Edges);
	ed.edges = [{ from: "pm", maySendTo: ["impl", "other"] }];
	// (1) a live queued row addressed to impl; (2) a queued row addressed to OTHER, used as the
	// negative control; (3) a row impl claims and completes, so the terminal refusal is exercised too.
	await enqueueItem(tx, "pm", "impl", "park me without claiming", "body A");
	await enqueueItem(tx, "pm", "other", "not yours to park", "body B");
	await enqueueItem(tx, "pm", "impl", "claim then finish", "body C");
}, ctx);
const roster = (await harness.snapshot(Seats, undefined, ctx)).seats;
const queue = async () => (await harness.snapshot(RigQueue, undefined, ctx));
const item = async (id) => (await queue()).items.find((it) => it.id === id);
const transcriptOf = async (name) => {
	const c = await harness.conversation(roster[name].conversationId, ctx);
	const pg = await c.entries({}, 200, undefined, ctx);
	return pg.items.map((e) => JSON.stringify(e)).join("\n");
};

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

/* The exact predicate the broker's wake selector uses (src/broker.mjs:127). A row the driver can wake
 * for is a row `status === "queued"`. Nothing in this change may make a parked row match it. */
const wakeableFor = async (seat) =>
	((await queue()).items ?? []).filter((it) => it.to === seat && it.status === "queued").map((it) => it.id);

console.log("\n1. parking a queued row addressed to me: no claim, no wake window");
assert.deepEqual(await wakeableFor("impl"), [1, 3], "before parking, impl has wake-able rows");
await call("impl", "hold_work", { itemId: 1, reason: "backlog registration, do not start" });
const parked = await item(1);
assert.equal(parked.status, "held", "hold_work on a QUEUED row addressed to me parks it (it did not before #5724)");
assert.equal(parked.heldReason, "backlog registration, do not start", "the park reason is recorded");
assert.ok(
	(parked.transitions ?? []).some((t) => t.event === "held" && t.by === "impl"),
		"the transition is recorded with the seat that parked it",
);
// #6150: the park is RECORDED as structure, and a row parked with only a prose reason records that
// there is no structural gate - which is the finding a metric must be able to see.
assert.equal(parked.park?.class, "unattributed", "the park class is recorded on the row, not inferred from its prose");
assert.ok(/nothing recorded/.test(parked.park?.basis ?? ""), "the record names what is missing: no gate ids, no authored block");
assert.ok(parked.park?.recordedAt, "the record carries when it was written, so a stale class can be checked");
assert.ok(!(await wakeableFor("impl")).includes(1), "a parked row is NOT wake-able — the claim window is gone");

/* The claim that used to be forced: claim-then-hold. It still works, so nothing that used it breaks. */
await call("impl", "claim_work", { itemId: 3 });
assert.equal((await item(3)).status, "claimed", "claiming still works");
await call("impl", "hold_work", { itemId: 3, reason: "waiting on an answer" });
assert.equal((await item(3)).status, "held", "holding a claimed row still parks it");
assert.ok((await item(3)).park?.class, "a park recorded through hold_work carries a class too");

console.log("\n2. the seam is not widened: who may park, and what may be parked");
await call("impl", "hold_work", { itemId: 2, reason: "wrong seat" });
assert.equal((await item(2)).status, "queued", "a row addressed to ANOTHER seat is not parked by me");
const foreign = await transcriptOf("impl");
assert.ok(
	foreign.includes("addressed to other, not you"),
	"the refusal names the actual cause (the row is not addressed to me), not 'not claimed'",
);

console.log("\n3. the cycle closes in one call each way");
await call("pm", "release_work", { itemId: 1 }); // the sender may release its own parked row (#5661)
assert.equal((await item(1)).status, "queued", "release restores the row to queued");
assert.ok((await wakeableFor("impl")).includes(1), "after release the row is wake-able again");
assert.equal((await item(1)).park, null, "a RELEASED row has no park record (#6150): leaving one behind makes a running row count as parked");

console.log("\n4. a terminal row is not a parked row");
await call("impl", "claim_work", { itemId: 1 });
await call("impl", "complete_work", { itemId: 1, resultSummary: "done" });
await call("impl", "hold_work", { itemId: 1, reason: "should not be possible" });
assert.equal((await item(1)).status, "done", "hold_work refuses a done row");

console.log("HOLD-QUEUED-ROW PASS — parking no longer costs a claim, and parked rows stay un-wakeable");
