// Ratcheting task tier test (ROADMAP agent-fleet borrow, RANK 2). Source:
// vendor/eval/agent-fleet docs/ARCHITECTURE.md "Task-tier budgets" — the tier is
// task-scoped and "ratcheted", surviving the next message: lowering is free,
// raising needs a stated reason. Durig shape per the operator ruling (item
// #101): the tier is the PM's size for a request (trivial/small/feature/project,
// mapping S/M/L), assigned at intake to the originating item and LATCHED onto its
// chain (DONE notice / verification / follow-up inherit the tier); a NEW intake
// starts a NEW tier; RAISING needs a reason, LOWERING is free.
// This proves: (a) a send_work tier is stored; (b) the DONE notice inherits the
// completed item's tier (persists across the chain); (c) a follow-up that RAISES
// the tier without a reason is refused; (d) raising with a reason is allowed and
// lowering is free; (e) a fresh intake (new subject) starts a new tier.
// Run: node demo/ratchet.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { RigQueue, Router, Seats, registerSeat } from "../src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);

let pmId, workerId;
await harness.commit(async (tx) => {
	const mk = async (name, role) => {
		const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
		await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" } });
		await registerSeat(tx, name, c.id, role);
		return c.id;
	};
	pmId = await mk("pm", "program manager");
	workerId = await mk("worker", "implementation engineer");
}, ctx);
const pmConv = await harness.conversation(pmId, ctx);

// Drive one tool call on a conversation; returns the tool-result text for `toolName`.
async function driveTool(conv, toolName, args) {
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall(toolName, args)], { stopReason: "toolUse" }),
		fauxAssistantMessage(fauxText("done")),
	]);
	await (await conv.submit({ type: "input", content: "go" }, ctx)).wait(ctx);
	const pg = await conv.entries({}, 200, undefined, ctx);
	const e = pg.items.find(
		(x) => x.kind === "pi.tool-result" && String(x.model?.[0]?.toolName) === toolName,
	);
	return e?.model?.[0]?.content?.[0]?.text ?? "";
}

async function queueItems() {
	return (await harness.documentState(RigQueue, undefined, ctx))?.value?.items ?? [];
}

try {
	const asWorker = { to: "worker" };

	// (a) a tier is stored on the item.
	const r1 = await driveTool(pmConv, "send_work", { ...asWorker, subject: "Task A", body: "do A", tier: "small" });
	assert.ok(/queued item #/.test(r1), `send_work with tier must succeed; got: ${r1.slice(0, 80)}`);
	assert.equal((await queueItems()).find((it) => it.subject === "Task A")?.tier, "small", "tier stored on the item");

	// (c) raise WITHOUT a reason -> refused.
	const r2 = await driveTool(pmConv, "send_work", { ...asWorker, subject: "Task A", body: "more", tier: "feature" });
	assert.ok(/needs a stated reason/.test(r2), `raising without a reason must be refused; got: ${r2.slice(0, 120)}`);

	// (d) raise WITH a reason -> allowed; lowering -> free.
	const r3 = await driveTool(pmConv, "send_work", { ...asWorker, subject: "Task A", body: "more2", tier: "feature", reason: "scope grew" });
	assert.ok(/queued item #/.test(r3), `raise with a reason must succeed; got: ${r3.slice(0, 80)}`);
	const r4 = await driveTool(pmConv, "send_work", { ...asWorker, subject: "Task A", body: "less", tier: "small" });
	assert.ok(/queued item #/.test(r4), `lowering must be free; got: ${r4.slice(0, 80)}`);

	// (b) chain latch: complete the newest Task A item; DONE notice inherits the tier.
	const items = await queueItems();
	const target = [...items].reverse().find((it) => it.subject === "Task A" && it.status === "queued");
	const workerConv = await harness.conversation(workerId, ctx);
	await driveTool(workerConv, "claim_work", {});
	await driveTool(workerConv, "complete_work", { itemId: target.id, resultSummary: "done" });
	const doneNotice = (await queueItems()).find((it) => it.notice === true && it.subject.startsWith("DONE #"));
	assert.ok(doneNotice, "a DONE notice was enqueued");
	assert.equal(doneNotice?.tier, "small", "the DONE notice inherits the completed item's tier (chain latch)");

	// (e) fresh intake (new subject) starts a new tier, unaffected by other tasks.
	const r5 = await driveTool(pmConv, "send_work", { ...asWorker, subject: "Task B", body: "do B", tier: "project" });
	assert.ok(/queued item #/.test(r5), `fresh intake with a new tier must succeed; got: ${r5.slice(0, 80)}`);
	assert.equal((await queueItems()).find((it) => it.subject === "Task B")?.tier, "project", "a fresh intake starts its own tier");

	console.log("RATCHET TEST PASS (tier stored; DONE notice inherits it; raising without a reason refused, with a reason allowed, lowering free; fresh intake new tier)");
} finally {
	await harness.close(ctx);
	void Seats;
}
process.exit(0);
