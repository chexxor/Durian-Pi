// demo/driversurvive-pre.test.mjs — the failing-first control for #110.
//
// This is the negative half of demo/driversurvive.test.mjs: it runs the FROZEN
// pre-fix driver (demo/fixtures/driver-prefix-110.mjs) against the same corrupt
// `pi.live` and asserts it still dies with the exact F14 PathError. The demo is
// self-contained on purpose: a verifier should not have to reconstruct the old
// driver from git, which is where two verification attempts went wrong.
//
// Against the frozen driver the control passes by catching the crash; against the
// FIXED driver it would fail (the fixed code no longer throws), which is why the
// positive demo exists separately.
import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { Edges, RigQueue, Router, Seats, compilePersona, enqueueItem, registerSeat } from "../src/rig.mjs";
import { driveOnce as preFixDriveOnce } from "./fixtures/driver-prefix-110.mjs";

const ctx = BACKGROUND_CONTEXT;

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

// The exact F14 shape: base `{}` plus an orphaned append.
const livePage = await storage.scanDocuments(
	{ scope: { kind: "conversation", conversationId: badConversationId }, at: "current", kind: "pi.live" },
	10,
	undefined,
	ctx,
);
// At v1.5.1 `pi.live` carries version 3. A delta declaring a different version is REFUSED
// (commit returns {stored:0, refused:{}}), which silently un-corrupts the fixture — so the
// version is read from the document rather than hard-coded.
const LIVE_VERSION = (await storage.document(livePage.items[0].id, "current", ctx))?.version ?? 1;
// pi-durable 1.5.1: Storage.commit(batches, receive, context) — group commit.
const corruptResult = await storage.commit(
	[
		[
			{
				type: "document.change",
				id: livePage.items[0].id,
				content: {
					kind: "delta",
					version: LIVE_VERSION,
					ops: [["a", ["generation", "message", "content", 0, "text"], "orphan"]],
				},
			},
		],
	],
	() => {},
	ctx,
);

// A fresh driver process: the corrupt document is read for the first time here.
const pre = await openHarness(storage);
assert.equal(
	corruptResult.stored,
	1,
	"the F14 fixture landed — a refused delta (version mismatch) would silently un-corrupt the document",
);

const seats = (await pre.snapshot(Seats, undefined, ctx)).seats;
const items = (await pre.snapshot(RigQueue, undefined, ctx)).items;

await assert.rejects(
	preFixDriveOnce(pre, { seats, items, pendingConvIds: new Set(), busySeats: new Set(), context: ctx }),
	(error) =>
		error?.name === "PathError" &&
		JSON.stringify(error.path) === JSON.stringify(["generation", "message", "content", 0]),
	"the pre-fix driver must die on the corrupt document with the exact F14 unresolvable path",
);

console.log("DRIVER PRE-FIX CONTROL PASS (the pre-fix driver dies on the corrupt pi.live; the fix is what survives it)");
process.exit(0);
