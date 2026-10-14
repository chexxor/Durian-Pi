// F24 (#257) — two CLI processes writing ONE store collide on entry ids.
//
// Root cause: each per-invocation CLI process opens the store once and caches
// durable_metadata.next_id at open. Two processes that open before either writes
// mint the SAME candidate id for their next entry; the loser's commit fails
// inside its SQLite transaction with `ID <n> already belongs to entry`, and
// pi-durable marks the session "poisoned ... reopen it". Observed live as
//   {"ok":false,"error":"ID 10051 already belongs to entry"}
// with the message never delivered.
//
// This demo is DETERMINISTIC — no wall-clock race. It models the two processes
// as two pi-durable Harness instances over two openNodeSqliteStorage handles to
// one file (exactly what two CLI processes are), then:
//   (a) proves the collision reproduces and matches isEntryIdConflict, and
//   (b) proves withStoreWriteRetry (the helper cli.mjs `send` now runs inside)
//       delivers BOTH writes on a re-opened harness — no message is lost.
//
// Run: node demo/storewrite.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import {
	isEntryIdConflict,
	withStoreWriteRetry,
} from "../src/storewrite.mjs";

const ctx = BACKGROUND_CONTEXT;

const dir = mkdtempSync(join(tmpdir(), "durig-storewrite-"));
const db = join(dir, "rig.sqlite");

const registry = createRegistry();

/** A fresh faux provider + models, so each "process" has its own response queue. */
function mkModels() {
	const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
	const models = createModels();
	models.setProvider(faux.provider);
	return { faux, models };
}

/** Open one "process": a Harness over its OWN storage handle to the shared file. */
async function openProcess() {
	const { faux, models } = mkModels();
	const harness = await Harness.open(await openNodeSqliteStorage(db), { models, registry }, ctx);
	return { harness, faux };
}

/** Create the seat conversation once, through process A, then close it. */
async function seedConversation() {
	const { harness } = await openProcess();
	const id = await harness.commit(async (tx) => {
		const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
		await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" } });
		return c.id;
	}, ctx);
	await harness.close(ctx);
	return id;
}

/** Write one input into the conversation through an already-open process. */
async function writeThrough({ harness, faux }, convId, text) {
	faux.setResponses([fauxAssistantMessage(fauxText(text))]);
	const conv = await harness.conversation(convId, ctx);
	const sub = await conv.submit({ type: "input", content: text }, ctx);
	await sub.wait(ctx);
}

let convId;
try {
	convId = await seedConversation();

	// --- (a) The collision, reproduced deterministically. -------------------
	// Two processes open BEFORE either writes, so both cache next_id. B writes
	// first (advancing next_id on disk); A writes second with a now-stale cached
	// id and collides.
	const A = await openProcess();
	const B = await openProcess();

	await writeThrough(B, convId, "from B"); // B wins the first allocation

	let collision = null;
	try {
		await writeThrough(A, convId, "from A");
	} catch (err) {
		collision = err;
	}
	assert.ok(collision, "the second writer must hit the entry-id collision (the bug this item fixes)");
	assert.ok(
		isEntryIdConflict(collision),
		`the collision must match isEntryIdConflict (got: ${collision?.message ?? collision})`,
	);
	assert.match(
		String(collision?.message ?? collision),
		/ID \d+ already belongs to entry/,
		"it is the exact storage-id conflict, not some other failure",
	);
	// The failed commit ROLLED BACK: A's message is nowhere in the store.
	const entriesAfterCollision = await (await B.harness.conversation(convId, ctx)).entries({}, 50, undefined, ctx);
	const sawA = entriesAfterCollision.items.some((e) =>
		JSON.stringify(e).includes("from A"),
	);
	assert.equal(sawA, false, "the collided write rolled back: nothing of A's message was stored");

	await A.harness.close(ctx);
	await B.harness.close(ctx);

	// --- (b) The fix: withStoreWriteRetry delivers BOTH writes. --------------
	// Model two processes that RACE again, but now wrap each write in the retry
	// the CLI uses. runAttempt opens a FRESH harness each time (re-reading
	// next_id), so a loser retries on a correctly-resynced store and its message
	// lands. Deterministic: we force the interleaving by hand — p2 opens first,
	// then p1 opens (both cache the same next_id), p1 writes, p2 writes and
	// collides, p2's retry re-opens and lands.
	// A stale process handle, opened before a competing write commits.
	const makeStaleProcess = async () => {
		const p = await openProcess();
		return p;
	};

	// pOpen: a process opened at time T (caches next_id T).
	const p2 = await makeStaleProcess();
	// A competing process p1 writes through its OWN harness, advancing next_id.
	const p1 = await openProcess();
	const p1Attempts = [];
	const p2Attempts = [];
	const writeWithRetry = (proc, attempts, text) =>
		withStoreWriteRetry(
			async () => {
				attempts.push(1);
				// On a retry the closure re-opens a fresh harness; on the first
				// attempt it uses the handle it was given (opened at T).
				if (attempts.length === 1) {
					await writeThrough(proc, convId, text);
				} else {
					const fresh = await openProcess();
					try {
						await writeThrough(fresh, convId, text);
					} finally {
						await fresh.harness.close(ctx);
					}
				}
			},
			{ sleep: async () => {} }, // no wall-clock wait in the demo
		);

	// p1 writes first (no contention) — advances next_id on disk.
	await writeWithRetry(p1, p1Attempts, "fixed from p1");
	// p2 now writes with its stale cached id: first attempt collides, retry on a
	// fresh harness lands. Both messages must be present.
	await writeWithRetry(p2, p2Attempts, "fixed from p2");

	assert.ok(p2Attempts.length >= 2, `p2 must have retried at least once (attempts=${p2Attempts.length})`);

	const finalEntries = await (await p1.harness.conversation(convId, ctx)).entries({}, 100, undefined, ctx);
	const blob = finalEntries.items.map((e) => JSON.stringify(e)).join("\n");
	assert.ok(blob.includes("fixed from p1"), "p1's message is delivered");
	assert.ok(blob.includes("fixed from p2"), "p2's message is delivered (the retry did not drop it)");

	await p1.harness.close(ctx);
	await p2.harness.close(ctx);

	console.log(
		"STOREWRITE TEST PASS (a concurrent store write collides on entry ids; withStoreWriteRetry re-opens a resynced store and lands the losing message instead of dropping it)",
	);
} finally {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}
// An exit inside the try would skip cleanup; cleanup is done in finally above.
process.exit(0);
