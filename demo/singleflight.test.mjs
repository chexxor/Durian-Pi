// Single-seat-at-a-time test (MVP burn-down #6): with the generation-slot
// cap at 1, at most one generation may be in flight at any instant even
// when two seats run concurrently; both must still finish; and a waiting
// seat must be distinguishable from a stuck one via the lease files
// (generation_in_flight vs generation_stale in status/watch attention).
// Run: node demo/singleflight.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
	fauxAssistantMessage,
	fauxProvider,
	fauxText,
} from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { RigQueue, Router, registerSeat } from "../src/rig.mjs";
import {
	readGenerationSlots,
	withGenerationSlot,
	wrapProviderWithSlots,
} from "../src/genlock.mjs";

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(tmpdir(), "durig-singleflight-"));
const db = join(dir, "rig.sqlite");

try {
	// Instrumented faux provider: counts concurrent stream() entries to
	// prove the cap, wrapped by the same gate cli.mjs uses.
	let active = 0;
	let maxObserved = 0;
	const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
	const raw = faux;
	const counted = (call) => (model, context, options) => {
		active += 1;
		maxObserved = Math.max(maxObserved, active);
		const inner = call(model, context, options);
		return {
			...inner,
			async *[Symbol.asyncIterator]() {
				try {
					for await (const ev of inner) yield ev;
				} finally {
					active -= 1;
				}
			},
		};
	};
	const counting = wrapProviderWithSlots(
		{
			...raw.provider,
			stream: counted(raw.provider.stream.bind(raw.provider)),
			streamSimple: counted(raw.provider.streamSimple.bind(raw.provider)),
		},
		{ dbPath: db, slots: 1 },
	);

	const models = createModels();
	models.setProvider(counting);
	const registry = createRegistry();
	registry.install(Router);

	const convIds = {};
	{
		const storage = await openNodeSqliteStorage(db);
		const harness = await Harness.open(storage, { models, registry }, ctx);
		harness.resume();
		try {
			await harness.commit(async (tx) => {
				for (const name of ["alpha", "beta"]) {
					const conv = await tx.createConversation({ ownership: { kind: "ownerless" } });
					await configure(tx, conv.id, { model: { provider: "faux", modelId: "faux-seat" } });
					await registerSeat(tx, name, conv.id, "implementation");
					convIds[name] = conv.id;
				}
			}, ctx);
			faux.setResponses([
				fauxAssistantMessage(fauxText("alpha done")),
				fauxAssistantMessage(fauxText("beta done")),
			]);
			const alpha = await harness.conversation(convIds.alpha, ctx);
			const beta = await harness.conversation(convIds.beta, ctx);
			const results = await Promise.allSettled([
				alpha.submit({ type: "input", content: "go" }, ctx).then((r) => r.wait(ctx)),
				beta.submit({ type: "input", content: "go" }, ctx).then((r) => r.wait(ctx)),
			]);
			for (const [i, r] of results.entries()) {
				assert.equal(r.status, "fulfilled", `seat ${i} run failed: ${r.reason}`);
			}
		} finally {
			await harness.close(ctx);
		}
	}
	assert.equal(maxObserved, 1, `generations overlapped: max ${maxObserved}, want 1`);
	console.log(`CAP OK: two concurrent seats finished with max ${maxObserved} generation in flight`);

	// Slot observability while a lease is held.
	await withGenerationSlot({ dbPath: db, slots: 1, seat: "probe-seat" }, async () => {
		const slots = readGenerationSlots(db, 1);
		assert.equal(slots.length, 1);
		assert.equal(slots[0].name, "generation_in_flight");
		assert.equal(slots[0].generatingSeat, "probe-seat");
		assert.equal(slots[0].stale, false);
	});
	assert.deepEqual(readGenerationSlots(db, 1), [], "released slot must vanish");

	// Stale detection: a slot file whose holder pid is dead must surface as
	// generation_stale — that is what separates waiting-from-stuck.
	writeFileSync(`${db}.genlock.0`, JSON.stringify({ pid: 999999999, seat: "ghost", since: new Date().toISOString() }));
	const stale = readGenerationSlots(db, 1);
	assert.equal(stale[0].name, "generation_stale", `want stale notice for dead holder`);
	assert.match(stale[0].detail, /gone/);

	console.log("SINGLEFLIGHT TEST PASS");
	process.exit(0);
} finally {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}
