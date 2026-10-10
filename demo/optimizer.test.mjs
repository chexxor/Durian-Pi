// Optimizer integration test: seat instructions and work requests can be
// machine-optimized through the rig's own model stack, with provenance
// recorded on the stored artifact. Faux provider plays the optimizer.
// Run: node demo/optimizer.test.mjs  (exit 0 = pass)
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
import { RigQueue, Router, registerSeat, Seats } from "../src/rig.mjs";
import { optimizeInstruction } from "../src/optimizer.mjs";

const ctx = BACKGROUND_CONTEXT;

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);

const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);

// Part 1: the optimizer function itself rewrites text via the model stack.
faux.setResponses([fauxAssistantMessage(fauxText("SHARPER VERSION"))]);
const opt = await optimizeInstruction(
	models,
	{ provider: "faux", modelId: "faux-seat" },
	"please kinda maybe write the thing",
	{ kind: "instruction" },
);
assert.equal(opt.optimized, "SHARPER VERSION", "optimizer must return the model's rewrite");
console.log("OPTIMIZER CALL OK:", opt.optimized);

// Part 2: send_work with optimize:true stores the optimized body + provenance.
await harness.commit(async (tx) => {
	const worker = await tx.createConversation({ ownership: { kind: "ownerless" } });
	await configure(tx, worker.id, { model: { provider: "faux", modelId: "faux-seat" } });
	await registerSeat(tx, "worker", worker.id, "implementation");
}, ctx);

faux.setResponses([
	// The worker turn calls send_work asking for optimization; the optimizer
	// call drains first (global faux order), then the tool result settles.
	fauxAssistantMessage(
		[fauxToolCall("send_work", {
			to: "worker",
			subject: "Build it",
			body: "rough draft body",
			optimize: true,
		})],
		{ stopReason: "toolUse" },
	),
]);
// Faux drains in global call order: run-gen 1 (the toolUse message above)
// already consumed setResponses[0]; next generation is the TOOL's optimizer
// call, then the run's continuation. So the optimizer rewrite comes first.
faux.appendResponses([
	fauxAssistantMessage(fauxText("OPTIMIZED BODY")),
	fauxAssistantMessage(fauxText("CONTINUATION")),
]);

const roster = ((await harness.documentState(Seats, undefined, ctx))?.value?.seats ?? {});
const conv = await harness.conversation(roster.worker.conversationId, ctx);
const run = await conv.submit({ type: "input", content: "send optimized work" }, ctx);
await run.wait(ctx);

const q = ((await harness.documentState(RigQueue, undefined, ctx))?.value ?? {});
const items = q.items ?? [];
assert.equal(items.length, 1, `expected 1 queued item, got ${items.length}`);
assert.equal(items[0].body, "OPTIMIZED BODY", `stored body=${items[0].body}`);
assert.equal(items[0].optimizedVia, "faux/faux-seat", `provenance=${items[0].optimizedVia}`);
console.log(`SEND_WORK OPTIMIZE OK: body="${items[0].body}" via=${items[0].optimizedVia}`);

// Part 3: without optimize flag, body passes through untouched and
// provenance stays null (human-written).
faux.setResponses([
	fauxAssistantMessage(
		[fauxToolCall("send_work", { to: "worker", subject: "Raw", body: "as written" })],
		{ stopReason: "toolUse" },
	),
	fauxAssistantMessage(fauxText("SENT-RAW")),
]);
const run2 = await conv.submit({ type: "input", content: "send raw work" }, ctx);
await run2.wait(ctx);
const q2 = ((await harness.documentState(RigQueue, undefined, ctx))?.value ?? {});
const rawItem = (q2.items ?? []).find((it) => it.subject === "Raw");
assert.ok(rawItem, "raw item enqueued");
assert.equal(rawItem.body, "as written", "raw body must pass through untouched");
assert.equal(rawItem.optimizedVia, null, `raw provenance=${rawItem.optimizedVia}`);
console.log("PASS-THROUGH OK");

console.log("OPTIMIZER TEST PASS");
process.exit(0);
