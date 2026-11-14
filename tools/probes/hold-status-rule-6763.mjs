#!/usr/bin/env node
/*
 * hold-status-rule-6763.mjs — who may park a row, in which status, and what the refusal says.
 * (#6763: pm's BUILD ADD widens hold_work to the sender for QUEUED rows, and says it must follow
 * the ordering fix. This measures hold_work as it is, so the rule is pinned to a measurement rather
 * than to a plan.)
 * Run: node tools/probes/hold-status-rule-6763.mjs    exit 1 while the rule is missing or misordered.
 */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { RigQueue, Router, Seats, compilePersona, enqueueItem, registerSeat, isTerminalItem } from "../../src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;
const faux = fauxProvider({ models: [{ id: "faux-6763" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);

await harness.commit(async (tx) => {
	for (const [n, r] of [["pm", "program manager"], ["impl", "implementation engineer"], ["qa", "quality assurance"]]) {
		const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
		await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-6763" }, instructions: compilePersona({ role: r }) });
		await registerSeat(tx, n, c.id, r);
	}
}, ctx);

async function mk(status) {
	let id = null;
	await harness.commit(async (tx) => {
		const held = status === "held";
		id = await enqueueItem(tx, "pm", "impl", `row in status ${status}`, "body", null, false, null, held);
		if (!held && status !== "queued") {
			const q = await tx.doc(RigQueue);
			const item = q.items.find((x) => x.id === id);
			if (item) item.status = status;
			return { items: q.items, nextId: q.nextId };
		}
		return true;
	}, ctx);
	return id;
}
const row = async (id) => (await harness.snapshot(RigQueue, undefined, ctx)).items.find((x) => x.id === id);

async function run(seat, tool, args) {
	const roster = await harness.snapshot(Seats, undefined, ctx);
	faux.setResponses([fauxAssistantMessage([fauxToolCall(tool, args)], { stopReason: "toolUse" }), fauxAssistantMessage(fauxText("done"))]);
	const c = await harness.conversation(roster.seats[seat].conversationId, ctx);
	await (await c.submit({ type: "input", content: "go" }, ctx)).wait(ctx);
	const pg = await c.entries({}, 50, undefined, ctx);
	return (pg.items ?? []).flatMap((e) => (e.model ?? []).flatMap((m) => m.content ?? []))
		.filter((cc) => cc.type === "text").map((cc) => String(cc.text)).join(" ").slice(0, 300);
}

const gaps = [];
const say = (t) => console.log(t);
say("hold_work, every actor x every status, answered by the tool as it stands:");
for (const status of ["queued", "claimed", "held", "deferred", "done", "cancelled"]) {
	const id = await mk(status);
	for (const seat of ["impl", "pm", "qa"]) {
		const role = seat === "impl" ? "recipient" : seat === "pm" ? "sender" : "stranger";
		const answer = await run(seat, "hold_work", { itemId: id, reason: "parked by test" });
		const after = (await row(id))?.status;
		say(`  MEASURED  ${role.padEnd(9)} x ${status.padEnd(9)} -> ${answer || "(no text)"}   [row now: ${after}]`);

		if (isTerminalItem({ status }) && after !== status)
			gaps.push(`MUTATION: a hold attempt on TERMINAL row #${id} (${status}) changed it to ${after}`);
		if (isTerminalItem({ status }) && !/terminal|already (done|cancelled)/i.test(answer))
			gaps.push(`ORDERING: ${role} on a ${status} row got an authority/status answer, not a terminality answer: "${answer}"`);
		if (role === "sender" && status === "queued" && after !== "held")
			gaps.push(`RULE MISSING: the sender cannot park its own queued row (the widening #6477 asks for): "${answer}"`);
		if (role === "recipient" && status === "held" && !/already held/i.test(answer))
			gaps.push(`LEGIBILITY: re-parking a parked row answers "${answer}" - it never says "already held" and reads as an instruction to claim it`);
		if (role === "stranger" && !/addressed to|not you|unknown/i.test(answer))
			gaps.push(`LEGIBILITY: a stranger's refusal names no holder: "${answer}"`);
		if (role === "sender" && status === "claimed" && after === "held")
			gaps.push(`AUTHORITY: the sender parked a row the recipient had CLAIMED - work in progress was taken out of the queue`);
	}
}

say("\nThe admission order the widening must follow (five verbs got it backwards, #6671)");
say("  1. exists          -> 'unknown item #N'");
say("  2. terminal        -> 'already <status> (terminal); there is nothing to park'");
say("  3. authority       -> recipient: its own row, queued or claimed. Sender: QUEUED rows only.");
say("                        A coordinating seat that minted nothing may park nothing - release only.");
say("  4. applicability   -> already held -> 'already held'; claimed by another seat -> name the holder");
say("Every refusal names the state, the actor and the next verb.");
say("The invariant preserved: a parked row is never wake-able, and only the parties can park one.");

say(gaps.length ? `\nRESULT: RED - ${gaps.length} missing or misordered rule(s)` : "\nRESULT: GREEN");
process.exit(gaps.length ? 1 : 0);
