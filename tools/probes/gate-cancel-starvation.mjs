#!/usr/bin/env node
/*
 * gate-cancel-starvation.mjs — the failing-first run for #6215.

 Creates, on a real store (MemoryStorage, no model), a row whose `blockedBy` names a CANCELLED row, and
 reports what the rig does with it. Run it on the tree BEFORE the guard and on the tree AFTER:

   before: the row is written, and 50 claim passes claim it 0 times - permanent starvation, no symptom.
   after:  the write is refused and the row never exists.

 Run: node tools/probes/gate-cancel-starvation.mjs   (exit 0 either way; the printed lines are the finding)
*/
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { enqueueItem, RigQueue, workable } from "../../src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;
const harness = await Harness.open(new MemoryStorage(), { models: createModels(), registry: createRegistry() }, ctx);

let parentId = null;
await harness.commit(async (tx) => {
	const q = await tx.doc(RigQueue);
	parentId = await enqueueItem(tx, "pm", "impl", "container row", "umbrella registration");
	q.items.find((it) => it.id === parentId).status = "cancelled";
}, ctx);

let written = 0;
let refusal = null;
try {
	await harness.commit(async (tx) => {
		written = await enqueueItem(tx, "pm", "impl", "child of a cancelled row", "body", null, false, null, false, [parentId]);
	}, ctx);
} catch (err) {
	refusal = err;
}

const items = (await harness.snapshot(RigQueue, undefined, ctx)).items;
const child = items.find((it) => it.subject === "child of a cancelled row");

console.log(`guard present? ${refusal ? "YES - enqueue threw" : `NO - the row was written (id ${written})`}`);
if (refusal) console.log(`  refusal: ${refusal.message}`);
if (child) {
	let claims = 0;
	for (let pass = 0; pass < 50; pass += 1) if (workable(child, "impl", { items }).workable) claims += 1;
	console.log(`  the row EXISTS and is workable on ${claims} of 50 claim passes; reason: ${workable(child, "impl", { items }).reason}`);
} else {
	console.log("  the row does not exist: nothing to starve.");
}

await harness.close(ctx);
