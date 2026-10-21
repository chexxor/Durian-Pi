// demo/held-item.test.mjs — create a queue item in a HELD/PARKED state (operator queue-hygiene
// directive, #1885).
//
// WHY: a "registered, do not start" backlog registration must NOT occupy a working seat's
// oldest-first claim slot or wake the seat. Today `send_work` has no held flag, so every item is
// created `queued` and claimable — a backlog row at the head of the queue starves the seat's
// priority work (the observed impl starvation).
//
// Failing-first: before the `held` flag exists, `send_work({held:true})` creates a QUEUED item, so
// the "not returned by claim_work" assertion fails. After, a held item is unclaimable, wakes the seat
// as PARKED (a body that does not advertise work, #4607), shows in peek_queue as parked, and becomes claimable after release_work.
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
const parked = selectWakes({ seats, items: [{ to: "worker", status: "held" }] });
check("a HELD item wakes its seat", parked.length === 1, JSON.stringify(parked));
check("...and the wake names it PARKED, so the body does not advertise queued work (#4607)", parked[0]?.reason === "parked", JSON.stringify(parked));

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
		const run = await (await c.submit({ type: "input", content: "go" }, ctx)).wait(ctx);
		// #4740: RETURN the task record.
		return run;
	};
	const transcript = async (name) => {
		const c = await harness.conversation(roster[name].conversationId, ctx);
		const pg = await c.entries({}, 200, undefined, ctx);
		return pg.items.map((e) => JSON.stringify(e)).join("\n");
	};

// #4740: THE TOOL'S REPLY IS ITS OWN ENTRY, AND `c.entries()` IS NEWEST-FIRST (observed). `answer` on the
// task record is a DECOY — it points at the assistant's closing message, not the tool result.
// AND THE PROBE LESSON, recorded where the next reader will hit it: a `console.log` of a PROXIED object is
// not a neutral instrument. `JSON.stringify(proxy)` IS the "spread it after the commit callback returns" case,
// so a probe that stringifies a doc proxy THROWS the very error it was meant to observe — which is how
// PROBE-J went silent and sent me looking in the wrong place for a pass. THIS helper reads plain text out of
// the entry and never stringifies the proxy itself.
async function toolReply(name, toolName) {
	const c = await harness.conversation(roster[name].conversationId, ctx);
	const pg = await c.entries({}, 200, undefined, ctx);
	const hits = pg.items.filter((x) => {
		const m = Array.isArray(x.model) ? x.model : [];
		return m.some((b) => b && b.role === "toolResult" && b.toolName === toolName);
	});
	if (hits.length === 0) return "";
	const m = Array.isArray(hits[0].model) ? hits[0].model : [];
	const block = m.find((b) => b && b.role === "toolResult" && b.toolName === toolName);
	const parts = Array.isArray(block?.content) ? block.content : [];
	return parts.map((c2) => (typeof c2 === "string" ? c2 : c2?.text ?? "")).join("");
}

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

	// #4740: A CROSS-SEAT HELD SEND to a recipient holding NOTHING CLAIMED. A self-addressed send produced
	// `#undefined`; a recipient with a `claimed` row makes the STALLED branch fire first (both measured).
	// `pm` created every row here and holds none, so it is the recipient that works.
	await call("worker", "send_work", { to: "pm", subject: "Parked backlog row for pm", body: "held", held: true });
	const pmRows = (await queueState()).items.filter((x) => x.to === "pm");
	check(
		"pm holds a held row and NOTHING claimed — the state the describing branch needs",
		pmRows.some((x) => x.status === "held") && !pmRows.some((x) => x.status === "claimed"),
		JSON.stringify(pmRows.map((x) => `${x.id}:${x.status}`)),
	);
	await call("pm", "claim_work", {});
	const said = await toolReply("pm", "claim_work");
	// FOUR ASSERTIONS, and the NEGATIVE is one of them — a negative only EXCLUDES, so it cannot stand alone.
	check("NOT the stalled-claim branch", !/STALLED_CLAIM/.test(said), said.slice(0, 160));
	check("says the queue is NOT empty", /NOT an empty queue/.test(said), said.slice(0, 160));
	check("NAMES the row", /#\d+/.test(said), said.slice(0, 160));
	check("and its CURRENT status", /held/.test(said), said.slice(0, 160));

} finally {
	await harness.close(ctx);
}

console.log(failures === 0 ? "\nPASS — a held item is parked (unclaimable, woken as PARKED) and claimable after release" : `\nFAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
