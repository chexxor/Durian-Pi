// Persistence test (MVP burn-down #1): the core durability promise. Seed a
// queue and a seat, close the storage (simulating a daemon death), reopen
// storage in the SAME directory, and prove the queue item and seat roster
// survived — then prove claim/complete still work on the reopened store.
// Run: node demo/persistence.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
} from "@earendil-works/pi-durable";
import { openNodeJsonlStorage } from "@earendil-works/pi-durable/storage/jsonl/node";
import { RigQueue, Router, registerSeat, Seats } from "../src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(tmpdir(), "durig-persist-"));

try {
	const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
	const models = createModels();
	models.setProvider(faux.provider);

	const registry = createRegistry();
	registry.install(Router);

	// --- Phase 1: bootstrap, seed, then "die" ---
	{
		const storage = await openNodeJsonlStorage(dir, ctx);
		const harness = await Harness.open(storage, { models, registry }, ctx);

		await harness.commit(async (tx) => {
			const worker = await tx.createConversation({ ownership: { kind: "ownerless" } });
			await configure(tx, worker.id, { model: { provider: "faux", modelId: "faux-seat" } });
			await registerSeat(tx, "worker", worker.id, "implementation");
		}, ctx);

		await harness.commit(async (tx) => {
			const { enqueueItem } = await import("../src/rig.mjs");
			await enqueueItem(tx, "boss", "worker", "Ship the module", "Module X must ship.");
		}, ctx);

		await storage.close(ctx); // the daemon dies here
	}

	// --- Phase 2: restart on the same directory ---
	let workerConvId;
	{
		const storage = await openNodeJsonlStorage(dir, ctx);
		const harness = await Harness.open(storage, { models, registry }, ctx);

		const seatsDoc = await harness.documentState(Seats, undefined, ctx);
		assert.ok(seatsDoc?.value?.seats?.worker, "seat roster must survive restart");
		assert.equal(seatsDoc.value.seats.worker.role, "implementation", "seat role intact");
		workerConvId = seatsDoc.value.seats.worker.conversationId;

		const qDoc = await harness.documentState(RigQueue, undefined, ctx);
		const items = qDoc?.value?.items ?? [];
		assert.equal(items.length, 1, `expected 1 surviving item, got ${items.length}`);
		assert.equal(items[0].status, "queued", `surviving item status=${items[0].status}`);
		assert.equal(items[0].subject, "Ship the module", "subject intact");

		console.log(`SURVIVED RESTART: item #${items[0].id} [${items[0].status}] "${items[0].subject}"`);

		// --- Phase 3: claim + complete still work after restart ---
		faux.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("claim_work", {}),
					fauxToolCall("complete_work", {
						itemId: items[0].id,
						resultSummary: "Shipped.",
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(fauxText("done")),
		]);

		const workerConv = await harness.conversation(workerConvId, ctx);
		const run = await workerConv.submit({ type: "input", content: "Check your queue." }, ctx);
		await run.wait(ctx);

		const qAfter = (await harness.documentState(RigQueue, undefined, ctx))?.value ?? {};
		const it = (qAfter.items ?? []).find((x) => x.id === items[0].id);
		assert.ok(it, "surviving item still present after workflow");
		assert.equal(it.status, "done", `item should reach done after claim+complete, got ${it.status}`);
		console.log(`POST-RESTART WORKFLOW OK: item #${it.id} -> done`);
	}

	console.log("PERSISTENCE TEST PASS");
	process.exitCode = 0;
} finally {
	rmSync(dir, { recursive: true, force: true });
}
