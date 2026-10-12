// demo/driversurvive.test.mjs — P5: the driver must survive an unresolvable path (#110).
//
// DOGFOOD F14: a `pi.live` document with an empty base and orphaned appends throws
// `unresolvable path: ["generation","message","content",0]` when it is materialized.
// A fresh `run`/`send` process that read that document died on the first pass, so no
// wake was ever delivered and every claimed item was stranded — the rig looked
// "held" while nothing advanced.
//
// This demo reproduces the exact corruption FROM THE DRIVER PATH (a fresh harness,
// then `driveOnce`) and asserts the driver survives it and continues its passes.
// Against the old code this throws PathError and the demo fails (captured as the
// failing-first evidence). MemoryStorage: no database, no temp dir.
import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { Edges, RigQueue, Router, Seats, compilePersona, enqueueItem, registerSeat } from "../src/rig.mjs";
import { driveOnce } from "../src/driver.mjs";

const ctx = BACKGROUND_CONTEXT;

// A fresh harness over the shared storage. The driver opens its own harness in a new
// process; using a second one here is what makes the corrupt document get re-read.
function openHarness(storage) {
	const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
	const models = createModels();
	models.setProvider(faux.provider);
	const registry = createRegistry();
	registry.install(Router);
	return Harness.open(storage, { models, registry }, ctx);
}

const storage = new MemoryStorage();
const seed = await openHarness(storage);

let badConversationId;
await seed.commit(async (tx) => {
	const mk = async (name) => {
		const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
		await configure(tx, c.id, {
			model: { provider: "faux", modelId: "faux-seat" },
			instructions: compilePersona({ role: "worker" }),
		});
		await registerSeat(tx, name, c.id, "worker");
		return c.id;
	};
	badConversationId = await mk("bad");
	await mk("good");
	const ed = await tx.doc(Edges);
	ed.edges = [
		{ from: "bad", maySendTo: ["good"] },
		{ from: "good", maySendTo: ["bad"] },
	];
	await enqueueItem(tx, "pm", "bad", "work for the corrupt seat", "details");
	await enqueueItem(tx, "pm", "good", "work for the healthy seat", "details");
}, ctx);

// Corrupt `pi.live` for the bad conversation: base `{}` plus an orphaned append, the
// exact F14 shape. A read now throws `unresolvable path: [...,"content",0]`.
const livePage = await storage.scanDocuments(
	{ scope: { kind: "conversation", conversationId: badConversationId }, at: "current", kind: "pi.live" },
	10,
	undefined,
	ctx,
);
const liveId = livePage.items[0].id;
await storage.commit(
	[
		{
			type: "document.change",
			id: liveId,
			content: { kind: "delta", version: 1, ops: [["a", ["generation", "message", "content", 0, "text"], "orphan"]] },
		},
	],
	ctx,
);

// A driver process, fresh against that storage.
const driver = await openHarness(storage);
const seats = (await driver.documentState(Seats, undefined, ctx)).value.seats;
const items = async () => (await driver.documentState(RigQueue, undefined, ctx)).value.items;

const failures = [];
const pass = async () =>
	driveOnce(driver, {
		seats,
		items: await items(),
		pendingConvIds: new Set(),
		busySeats: new Set(),
		context: ctx,
		storage,
		onError: (f) => failures.push(f),
	});

// Pass 1: the bad seat's document cannot be materialized; the driver must report it
// and still wake the healthy seat — not exit before any wake is delivered.
assert.equal(await pass(), 1, "the driver survives the bad document and wakes the healthy seat");
assert.equal(failures.length, 1, "the unreadable conversation is reported, not silently dropped");
assert.equal(failures[0].name, "bad", "the failure names the seat whose document is unreadable");
assert.deepEqual(
	failures[0].error?.path,
	["generation", "message", "content", 0],
	"the reported failure is the exact F14 unresolvable path",
);

// Pass 2: the driver continues its passes; the same bad seat is retried and skipped,
// the healthy seat is woken again, and nothing throws.
assert.equal(await pass(), 1, "a later pass still survives and keeps waking the healthy seat");
assert.equal(failures.length, 2, "the bad document is retried, not cached as a permanent skip");

// The stranded item is still durably queued for a human/repair — never silently
// completed or dropped by the guard.
assert.equal(
	(await items()).find((it) => it.to === "bad")?.status,
	"queued",
	"the unreadable seat's work remains queued for repair, not lost",
);

await driver.close(ctx);
console.log("DRIVER SURVIVE TEST PASS (an unresolvable pi.live path no longer kills the driver)");
process.exit(0);
