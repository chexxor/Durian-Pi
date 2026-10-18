// demo/ratchet.test.mjs — ratcheting task tier (ROADMAP agent-fleet borrow, RANK 2 / #60).
//
// Source of truth: vendor/eval/agent-fleet @ 7c34dde, docs/ARCHITECTURE.md
// "Task-tier budgets" — the tier is task-scoped and "ratcheted": it survives the
// next message; lowering is free, raising needs a stated reason.
//
// Durig shape (operator ruling, item #101): the tier is the PM's size for a
// request — trivial/small/feature/project, mapping the existing S/M/L — assigned
// AT INTAKE to the originating item and LATCHED onto that item's chain (its DONE
// notice, its verification item and any follow-up about the same task inherit the
// tier); a NEW intake (a new subject from the operator) starts a NEW tier.
//
// Driven through the real Router tools on a real harness with scripted faux
// responses, so the tool wrappers, the raise guard and the commit boundaries are
// exercised rather than a re-implementation of them.
//
// Run: node demo/ratchet.test.mjs  (exit 0 = pass)
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
	RATCHET_TIERS,
	RigQueue,
	Router,
	Seats,
	baseTaskSubject,
	compilePersona,
	registerSeat,
	tierIndex,
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
	const ed = await tx.doc(Edges);
	ed.edges = [
		{ from: "pm", maySendTo: ["worker"] },
		{ from: "worker", maySendTo: ["pm"] },
	];
}, ctx);

const roster = (await harness.documentState(Seats, undefined, ctx)).value.seats;
const queueItems = async () => (await harness.documentState(RigQueue, undefined, ctx)).value.items;

/** Drive one tool call on a seat's conversation; return the tool-result text. */
async function driveTool(seatName, toolName, toolArgs) {
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall(toolName, toolArgs)], { stopReason: "toolUse" }),
		fauxAssistantMessage(fauxText("ok")),
	]);
	const c = await harness.conversation(roster[seatName].conversationId, ctx);
	await (await c.submit({ type: "input", content: "go" }, ctx)).wait(ctx);
	const pg = await c.entries({}, 200, undefined, ctx);
	const results = pg.items.filter(
		(x) => x.kind === "pi.tool-result" && String(x.model?.[0]?.toolName) === toolName,
	);
	// `entries()` yields the transcript newest-first, so the just-run tool result
	// is the FIRST match, not the last.
	return results[0]?.model?.[0]?.content?.[0]?.text ?? "";
}

try {
	/* ------------------- the tier vocabulary is ordered and total ------------------- */
	assert.deepEqual(
		RATCHET_TIERS,
		["trivial", "small", "feature", "project"],
		"the tiers are ordered, mapping S/M/L onto trivial/small/feature/project",
	);
	assert.ok(tierIndex("feature") > tierIndex("small"), "raising moves UP the order");
	assert.equal(baseTaskSubject("DONE #7: Task A"), "Task A", "a DONE notice resolves to its base task");

	/* --------------------------- (a) a tier is stored ------------------------------ */
	const r1 = await driveTool("pm", "send_work", {
		to: "worker",
		subject: "Task A",
		body: "do A",
		tier: "small",
	});
	assert.match(r1, /queued item #/, `send_work with a tier must succeed; got: ${r1.slice(0, 120)}`);
	assert.equal(
		(await queueItems()).find((it) => it.subject === "Task A")?.tier,
		"small",
		"the assigned tier is stored on the item",
	);

	/* ------------------- (c) raising WITHOUT a reason is refused ------------------- */
	const r2 = await driveTool("pm", "send_work", {
		to: "worker",
		subject: "Task A",
		body: "more",
		tier: "feature",
	});
	assert.match(
		r2,
		/needs a stated reason/,
		`raising the tier without a reason must be refused; got: ${r2.slice(0, 160)}`,
	);
	assert.equal(
		(await queueItems()).filter((it) => it.subject === "Task A").length,
		1,
		"the refused raise enqueues nothing (the commit is aborted)",
	);

	/* ------------- (d) raising WITH a reason is allowed; lowering is free ---------- */
	const r3 = await driveTool("pm", "send_work", {
		to: "worker",
		subject: "Task A",
		body: "more2",
		tier: "feature",
		reason: "scope grew",
	});
	assert.match(r3, /queued item #/, `raising with a reason must succeed; got: ${r3.slice(0, 120)}`);
	const r4 = await driveTool("pm", "send_work", {
		to: "worker",
		subject: "Task A",
		body: "less",
		tier: "small",
	});
	assert.match(r4, /queued item #/, `lowering must be free; got: ${r4.slice(0, 120)}`);

	/* ---------- (b) chain latch: the DONE notice inherits the tier ---------------- */
	const target = [...(await queueItems())]
		.reverse()
		.find((it) => it.subject === "Task A" && it.status === "queued");
	assert.ok(target, "there is a queued Task A item to complete");
	assert.equal(target.tier, "small", "the newest Task A item carries the lowered tier");
	const claim = await driveTool("worker", "claim_work", { itemId: target.id });
	assert.match(claim, /ITEM #/, `the worker claims the task; got: ${claim.slice(0, 120)}`);
	const done = await driveTool("worker", "complete_work", {
		itemId: target.id,
		resultSummary: "done",
	});
	assert.match(done, /^ok$/, `completing the item succeeds; got: ${done.slice(0, 120)}`);
	const doneNotice = (await queueItems()).find(
		(it) => it.notice === true && it.subject.startsWith("DONE #"),
	);
	assert.ok(doneNotice, "a DONE notice was enqueued");
	assert.equal(
		doneNotice?.tier,
		"small",
		"the DONE notice inherits the completed item's tier (the tier latches on the chain)",
	);

	/* ------------- (e) a fresh intake (new subject) starts a new tier ------------- */
	const r5 = await driveTool("pm", "send_work", {
		to: "worker",
		subject: "Task B",
		body: "do B",
		tier: "project",
	});
	assert.match(r5, /queued item #/, `a fresh intake with a new tier must succeed; got: ${r5.slice(0, 120)}`);
	assert.equal(
		(await queueItems()).find((it) => it.subject === "Task B")?.tier,
		"project",
		"a fresh intake starts its own tier, unaffected by another task's ratchet",
	);

	console.log(
		"RATCHET TEST PASS (tier stored; DONE notice inherits it; raising without a reason refused, with a reason allowed, lowering free; fresh intake new tier)",
	);
} finally {
	await harness.close(ctx);
}
process.exit(0);
