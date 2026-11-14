#!/usr/bin/env node
/*
 * gate-dead-end-6707.mjs — when a parked row's gate dies, is there a repair path that is not cancellation?
 * (#6707, condition 3 of pm's four: "additive only" is reversible only if a removal path exists)

 Sequence measured through the real verbs:
   1. pm mints a HELD row gated on row 2.
   2. row 2 is cancelled.
   3. every verb that could clear the gate is tried by every party, and the result recorded.

 Exit 1 while the only legal move is to cancel the stranded row.

 Run: node tools/probes/gate-dead-end-6707.mjs
*/
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { Edges, RigQueue, Router, Seats, enqueueItem, registerSeat } from "../../src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;
const faux = fauxProvider({ models: [{ id: "faux-seat", contextWindow: 128000 }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);
const gaps = [];
const gap = (cond, msg) => { console.log(`  ${cond ? "GAP   " : "CLOSED"}  ${msg}`); if (cond) gaps.push(msg); };

const ids = await harness.commit(async (tx) => {
	const convs = {};
	for (const [n, caps] of [["pm", ["route", "plan"]], ["impl", ["implement"]], ["qa", ["verify"]]]) {
		const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
		await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" } });
		await registerSeat(tx, n, c.id, n);
		(await tx.doc(Seats)).seats[n].capabilities = caps;
		convs[n] = c.id;
	}
	const ed = await tx.doc(Edges);
	ed.edges = [{ from: "pm", maySendTo: ["impl", "qa"] }, { from: "impl", maySendTo: ["pm"] }, { from: "qa", maySendTo: ["pm"] }];
	const a = await enqueueItem(tx, "pm", "impl", "parked work waiting on upstream", "body", null, false, null, true, [2]);
	const b = await enqueueItem(tx, "pm", "qa", "the upstream row", "x");
	return { ...convs, a, b };
}, ctx);

async function call(seat, tool, args) {
	const conv = await harness.conversation(ids[seat], ctx);
	const watermark = (await conv.entries({}, 200, undefined, ctx)).items.reduce((m, e) => Math.max(m, Number(e.id) || 0), 0);
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall(tool, args)], { stopReason: "toolUse" }),
		fauxAssistantMessage(fauxText("ok")),
	]);
	await (await conv.submit({ type: "input", content: tool }, ctx)).wait(ctx);
	return ((await conv.entries({ minEntryId: watermark + 1 }, 200, undefined, ctx)).items
		.flatMap((e) => e.model ?? [])
		.filter((m) => m.role === "toolResult" && m.toolName === tool)
		.map((m) => (m.content ?? []).map((c) => c.text ?? "").join(" "))[0] ?? "(no tool result)").replace(/\n/g, " ");
}

async function state(id) {
	const it = (await harness.snapshot(RigQueue, undefined, ctx)).items.find((x) => x.id === id);
	return it ? { status: it.status, blockedBy: it.blockedBy ?? null, from: it.from, to: it.to } : null;
}

console.log("Setup: row #1 (held, gate [2]) and gate #2");
console.log(`  MEASURED  #1: ${JSON.stringify(await state(1))};  #2: ${JSON.stringify(await state(2))}`);

console.log("\n1. Cancel the gate");
console.log(`  MEASURED  cancel_work(#2) by pm -> ${await call("pm", "cancel_work", { itemId: 2, reason: "upstream dropped" })}`);
console.log(`  MEASURED  #1 now: ${JSON.stringify(await state(1))}`);

console.log("\n2. Every verb a party can try, to clear the dead gate");
for (const [seat, verb, args] of [
	["pm", "revise_work", { itemId: 1, body: "same work, gate no longer relevant" }],
	["pm", "release_work", { itemId: 1, reason: "the gate is gone; the work is ready" }],
	["pm", "hold_work", { itemId: 1 }],
	["impl", "claim_work", { itemId: 1 }],
	["impl", "release_work", { itemId: 1, reason: "i am the recipient" }],
	["pm", "revise_work", { itemId: 1, subject: "gate removed", body: "x", blockedBy: [] }],
]) {
	const out = await call(seat, verb, args);
	console.log(`  MEASURED  ${seat}.${verb}(${JSON.stringify(args)}) -> ${out.slice(0, 160)}`);
}
console.log(`  MEASURED  #1 after every attempt: ${JSON.stringify(await state(1))}`);
const after = await state(1);
gap(after.blockedBy?.length > 0 && after.status === "held", "no verb in the rig can remove a gate. `grep -n blockedBy src/rig.mjs` shows writes only at mint (`:464`) and reads everywhere else: 0 removal sites. A parked row whose gate is cancelled can never be made workable by its parties");

console.log("\n3. Is the row stranded, or is there an exit?");
const cancelOut = await call("pm", "cancel_work", { itemId: 1, reason: "no repair path for the gate" });
console.log(`  MEASURED  cancel_work(#1) by pm -> ${cancelOut.slice(0, 160)}`);
const final = await state(1);
console.log(`  MEASURED  #1 final: status=${final.status}`);
gap(final.status === "cancelled", "the only verb that clears a dead gate is a verb that ends the row. Terminal cancellation as the repair path means the WORK is lost to fix the bookkeeping");

console.log("\n4. Does anything report this state?");
const checkSrc = await import("node:fs").then((f) => f.readFileSync(new URL("../../src/checkup.mjs", import.meta.url), "utf8"));
console.log(`  MEASURED  rules in checkup.mjs mentioning blockedBy: ${(checkSrc.match(/blockedBy/g) ?? []).length}; mentioning gate: ${(checkSrc.match(/gate/gi) ?? []).length}`);
gap((checkSrc.match(/blockedBy/g) ?? []).length === 0, "check has no rule for gate integrity, so a row parked on a dead gate is invisible until a seat trips on it");

console.log("\nThe contract this probe asserts once the removal path exists");
console.log("  gate_work(itemId, add?: [ids], remove?: [ids]) - parties only (D258 authority), recorded");
console.log("  {by, reason, at} on the row, notified to the author the way cancellation is (#3470),");
console.log("  validated inside the commit against the combined graph: no self-gate, no cycle, no id that");
console.log("  does not exist, no reference the caller has standing on beyond one hop (#6673).");

console.log(gaps.length ? `\nRESULT: RED - ${gaps.length} unrecoverable state(s)` : "\nRESULT: GREEN - a dead gate can be cleared by a recorded, party-scoped verb and is reported by check");
process.exit(gaps.length ? 1 : 0);
