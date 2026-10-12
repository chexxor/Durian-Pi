// Concurrent-claim race test (MVP burn-down #2): two runs of the same seat
// claim simultaneously. Exactly one wins the item; the loser gets a friendly
// structured NO_QUEUED_WORK (isError:false), never a crash or a double-claim.
// Run: node demo/race.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
	fauxAssistantMessage,
	fauxProvider,
	fauxText,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
	configure,
	createRegistry,
	Harness,
	MemoryStorage,
} from "@earendil-works/pi-durable";
import { RigQueue, Router, registerSeat, Seats } from "../src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);

const registry = createRegistry();
registry.install(Router);

const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);

await harness.commit(async (tx) => {
	const worker = await tx.createConversation({ ownership: { kind: "ownerless" } });
	await configure(tx, worker.id, { model: { provider: "faux", modelId: "faux-seat" } });
	await registerSeat(tx, "worker", worker.id, "implementation");
	const { enqueueItem } = await import("../src/rig.mjs");
	await enqueueItem(tx, "boss", "worker", "Only item", "Contended body.");
}, ctx);

// Both runs issue the identical claim_work call, so the global faux response
// order cannot favour either run — whichever admits first wins on merit.
faux.setResponses([
	fauxAssistantMessage([fauxToolCall("claim_work", {})], { stopReason: "toolUse" }),
	fauxAssistantMessage(fauxText("ok")),
	fauxAssistantMessage([fauxToolCall("claim_work", {})], { stopReason: "toolUse" }),
	fauxAssistantMessage(fauxText("ok")),
]);

const roster = ((await harness.documentState(Seats, undefined, ctx))?.value?.seats ?? {});
assert.ok(roster.worker?.conversationId, "worker seat registered");
const conv = await harness.conversation(roster.worker.conversationId, ctx);

// Fire both submissions concurrently and let neither abort the other.
const settled = await Promise.allSettled([
	conv.submit({ type: "input", content: "run A" }, ctx).then((r) => r.wait(ctx)),
	conv.submit({ type: "input", content: "run B" }, ctx).then((r) => r.wait(ctx)),
]);
for (const [i, r] of settled.entries()) {
	assert.equal(r.status, "fulfilled", `run ${i} must settle without throwing (${r.reason})`);
}

// Collect every claim_work tool result in the shared transcript.
const pg = await conv.entries({}, 50, undefined, ctx);
const claimResults = [];
for (const e of pg.items) {
	for (const m of e?.model ?? []) {
		if (m.role === "toolResult" && m.toolName === "claim_work") {
			claimResults.push({
				text: m.content?.map((c) => c.text ?? "").join("") ?? "",
				isError: m.isError === true,
			});
		}
	}
}
assert.equal(claimResults.length, 2, `expected 2 claim_work results, got ${claimResults.length}`);

const winners = claimResults.filter((r) => r.text.startsWith("ITEM #"));
// The losing run, with nothing queued but the seat now holding the claim, is
// told the seat's held claim (STALLED_CLAIM #...) — the stalled-claim legal move
// (#118): a friendly non-error read, never a crash and never a double-claim.
const losers = claimResults.filter(
	(r) => r.text === "NO_QUEUED_WORK" || r.text.startsWith("STALLED_CLAIM #"),
);
assert.equal(winners.length, 1, `exactly one winner expected, got ${winners.length}`);
assert.equal(losers.length, 1, `exactly one friendly loser expected, got ${losers.length}`);
assert.equal(losers[0].isError, false, "the losing claim must not be an error");

// The queue itself must show exactly one claimed event — no double-assignment.
const q = ((await harness.documentState(RigQueue, undefined, ctx))?.value ?? {});
const items = q.items ?? [];
assert.equal(items.filter((it) => it.subject === "Only item").length, 1,
	"the contended item must exist exactly once");
const item = items.find((it) => it.subject === "Only item");
assert.equal(item.status, "claimed", `item status=${item.status}`);
assert.equal(
	(item.transitions ?? []).filter((t) => t.event === "claimed").length,
	1,
	"exactly one claimed transition allowed",
);

console.log(`RACE OK: winner="${winners[0].text.split("\n")[0]}" loser="${losers[0].text.split("\n")[0]}"(isError:${losers[0].isError}) claimed-events=1`);
console.log("RACE TEST PASS");
process.exit(0);
