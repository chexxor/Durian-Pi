// demo/notices.test.mjs — a DONE notice must not generate a DONE notice
// (ROADMAP item 39).
//
// complete_work used to enqueue a `DONE #<id>` acknowledgement unconditionally,
// including when the item just completed was ITSELF a DONE notice, so every ack
// spawned an ack: the live queue showed #3 "DONE #1", #5 "DONE #3: DONE #1",
// #9 "DONE #5: DONE #3: DONE #1 ...". It is a protocol defect, not seat
// misbehaviour — every seat did exactly what the tool told it to.
//
// The fix is structural: enqueueItem carries a `notice` flag set at enqueue time
// and complete_work suppresses the ack when the completed item is a notice.
// A LEGACY fallback recognises flag-less DONE items already in a store that
// predates the flag (the existing #5/#9/#11 chain), by the exact subject shape
// complete_work enqueues, so those do not keep looping either.
//
// Driven through the real Router tools on a real harness with scripted faux
// responses, so the tool wrappers and commit boundaries are exercised rather
// than re-implemented. MemoryStorage: no database, no temp dir.
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

// Imported lazily so the BEHAVIOURAL assertions below (the real concern) run and
// fail meaningfully even against a rig.mjs that does not export the predicate;
// on a pre-fix module the loop assertions fail first, which is the point.
const { isDoneNotice } = await import("../src/rig.mjs");

console.log("--- driving the real tools ---");

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
	const ed = await tx.doc(Edges);
	ed.edges = [
		{ from: "pm", maySendTo: ["worker"] },
		{ from: "worker", maySendTo: ["pm"] },
	];
	// #1: real work. #2: a LEGACY flag-less DONE notice, as it would already
	// sit in a store that predates the structural flag.
	await enqueueItem(tx, "pm", "worker", "Build the widget", "details");
	await enqueueItem(tx, "pm", "worker", "DONE #999: an old acknowledgement", "from before the flag");
}, ctx);

const roster = (await harness.documentState(Seats, undefined, ctx)).value.seats;
const queueState = async () => (await harness.documentState(RigQueue, undefined, ctx)).value;
const items = async () => (await queueState()).items;
const item = async (id) => (await items()).find((it) => it.id === id);

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

/* ------------------ 1. real work DOES get exactly one DONE notice */

const seeded = (await items()).length; // 2: #1 real work, #2 legacy notice

await call("worker", "claim_work", {});
assert.equal((await item(1)).status, "claimed");
await call("worker", "complete_work", { itemId: 1, resultSummary: "built it" });

const afterFirst = await items();
assert.equal(afterFirst.length, seeded + 1, "completing real work enqueues exactly one notice");

const ack = afterFirst.find((it) => it.subject?.startsWith("DONE #1:"));
assert.ok(ack, `a DONE notice is enqueued for real work; subjects=${afterFirst.map((i) => i.subject).join(" | ")}`);
assert.equal(ack.to, "pm", "the notice goes back to the sender");
assert.equal(ack.from, "worker", "from the seat that completed the work");

/* ------------------ 2. completing the DONE notice enqueues NO new item */

const ackId = ack.id;
await call("pm", "claim_work", {});
assert.equal((await item(ackId)).status, "claimed", "pm can claim its own DONE notice");
await call("pm", "complete_work", { itemId: ackId, resultSummary: "acknowledged" });

assert.equal(
	(await items()).length,
	seeded + 1,
	"completing a DONE notice enqueues NO new item (the loop is broken)",
);
assert.equal((await item(ackId)).status, "done", "the notice is still marked done");
assert.ok(
	!(await items()).some((it) => it.subject?.startsWith(`DONE #${ackId}:`)),
	"and no ack-of-the-ack exists",
);

/* ------------------ 3. LEGACY flag-less DONE items do not loop either */

await call("worker", "claim_work", {});
assert.equal((await item(2)).status, "claimed");
await call("worker", "complete_work", { itemId: 2, resultSummary: "acknowledged" });
assert.equal(
	(await items()).length,
	seeded + 1,
	"completing a legacy flag-less DONE item enqueues no new item",
);
assert.ok(
	!(await items()).some((it) => it.subject?.startsWith("DONE #2:")),
	"so the pre-existing chain cannot keep looping",
);

/* ------------------ 4. the structural flag and the legacy predicate */

assert.equal(ack.notice, true, "the structural flag is set at enqueue time");
assert.equal((await item(2)).notice, false, "the legacy item carries no flag");
assert.equal(typeof isDoneNotice, "function", "isDoneNotice is exported");
assert.equal(isDoneNotice({ subject: "Build the widget" }), false, "real work is not a notice");
assert.equal(isDoneNotice({}), false, "a flag-less, subject-less item is not a notice");
assert.equal(isDoneNotice(null), false);
assert.equal(isDoneNotice({ notice: true, subject: "anything" }), true, "the flag decides");
assert.equal(isDoneNotice({ subject: "DONE #1: Build the widget" }), true, "legacy DONE shape is recognised");
assert.equal(isDoneNotice({ subject: "DONE #12: DONE #3: DONE #1: x" }), true, "the multi-hop chain too");
assert.equal(isDoneNotice({ subject: "DONE #1 without the separator" }), false, "only the exact shape counts");
assert.equal(isDoneNotice({ subject: "DONE #abc: x" }), false, "the id must be numeric");

await harness.close(ctx);
console.log("NOTICES TEST PASS (real work acks once, completing a DONE notice loops no further, legacy notices are guarded)");
process.exit(0);
