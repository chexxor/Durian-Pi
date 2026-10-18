// demo/held-item.test.mjs — create a queue item in a HELD/PARKED state (operator queue-hygiene
// directive, #1885).
//
// WHY: a "registered, do not start" backlog registration must NOT occupy a working seat's
// oldest-first claim slot or wake the seat. Today `send_work` has no held flag, so every item is
// created `queued` and claimable — a backlog row at the head of the queue starves the seat's
// priority work (the observed impl starvation).
//
// Failing-first: before the `held` flag exists, `send_work({held:true})` creates a QUEUED item, so
// the "not returned by claim_work" assertion fails. After, a held item is unclaimable, does not
// wake the seat, shows in peek_queue as parked, and becomes claimable after release_work.
//
// Run: node demo/held-item.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { selectWakes } from "../src/driver.mjs";
import { enqueueItem, registerSeat, RigQueue, Router, Seats } from "../src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;
let failures = 0;
function check(label, condition, detail = "") {
	if (condition) {
		console.log(`  ok   ${label}`);
	} else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
	}
}

/* ─── 1. pure: a HELD item does not wake its seat ────────────────────────── */
console.log("\nselectWakes — a held item does not wake the seat");
const seats = { worker: { conversationId: 2 } };
check("a queued item wakes its seat", selectWakes({ seats, items: [{ to: "worker", status: "queued" }] }).length === 1);
check("a HELD item does NOT wake its seat", selectWakes({ seats, items: [{ to: "worker", status: "held" }] }).length === 0);

/* ─── 2. on a real harness: held is unclaimable until released ───────────── */
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);

try {
	await harness.commit(async (tx) => {
		const mk = async (name, role) => {
			const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
			await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" } });
			await registerSeat(tx, name, c.id, role);
		};
		await mk("pm", "program manager");
		await mk("worker", "implementation engineer");
	}, ctx);

	const roster = (await harness.documentState(Seats, undefined, ctx)).value.seats;
	const queueState = async () => (await harness.documentState(RigQueue, undefined, ctx)).value;
	const item = async (id) => (await queueState()).items.find((it) => it.id === id);
	let first = true;
	const call = async (name, toolName, toolArgs) => {
		const batch = [
			fauxAssistantMessage([fauxToolCall(toolName, toolArgs)], { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxText("ok")),
		];
		if (first) {
			faux.setResponses(batch);
			first = false;
		} else faux.appendResponses(batch);
		const c = await harness.conversation(roster[name].conversationId, ctx);
		await (await c.submit({ type: "input", content: "go" }, ctx)).wait(ctx);
	};
	const transcript = async (name) => {
		const c = await harness.conversation(roster[name].conversationId, ctx);
		const pg = await c.entries({}, 200, undefined, ctx);
		return pg.items.map((e) => JSON.stringify(e)).join("\n");
	};

	// pm sends a NORMAL item, then a HELD one (a parked backlog registration).
	await call("pm", "send_work", { to: "worker", subject: "Normal work", body: "do it" });
	await call("pm", "send_work", { to: "worker", subject: "Backlog registration", body: "do not start", held: true });
	check("a normal send is queued (unchanged behaviour)", (await item(1)).status === "queued", JSON.stringify(await item(1)));
	check("a held send is created HELD, not queued", (await item(2)).status === "held", JSON.stringify(await item(2)));
	check("the held item records a `held` transition", (await item(2)).transitions.some((t) => t.event === "held"));

	// The seat claims: it gets the NORMAL item, never the held one.
	await call("worker", "claim_work", {});
	check("claim_work returns the queued item", (await item(1)).status === "claimed", JSON.stringify(await item(1)));
	check("the HELD item is NOT returned by claim_work (still held)", (await item(2)).status === "held");
	await call("worker", "claim_work", {});
	check("a second claim still leaves the HELD item parked (skipped)", (await item(2)).status === "held");
	check("it reveals the item the seat already holds instead of the held one", /STALLED_CLAIM #1/.test(await transcript("worker")));

	// peek_queue shows it, parked.
	await call("worker", "peek_queue", {});
	const peeked = await transcript("worker");
	check("peek_queue shows the held item", peeked.includes("Backlog registration"), peeked.slice(-200));

	// The SENDER releases the parked backlog row → it becomes claimable.
	await call("pm", "release_work", { itemId: 2 });
	check("the sender may release the held item it created", (await item(2)).status === "queued", JSON.stringify(await item(2)));
	await call("worker", "claim_work", {});
	check("after release the item IS claimable", (await item(2)).status === "claimed", JSON.stringify(await item(2)));
} finally {
	await harness.close(ctx);
}

console.log(failures === 0 ? "\nPASS — a held item is parked (unclaimable, no wake) and claimable after release" : `\nFAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
