// demo/halt.test.mjs — the IN-BROKER halt actuator (item B / #1768).
//
// Failing-first: before src/halt.mjs exists this dies with ERR_MODULE_NOT_FOUND. After, it
// proves the actuator actually INTERRUPTS a live generation, cooperatively:
//   (1) the legible stop contract: every halt is labelled `aborted:<reason>`;
//   (2) on a REAL harness driven by a streaming faux model, halting mid-turn STOPS the
//       in-flight generation — the committed assistant turn is a PARTIAL, shorter than the
//       scripted full reply, and the submission settles durably with `reason:"aborted"`;
//   (3) the seat stays RECOVERABLE: its transcript is untouched (entries remain) and the same
//       conversation runs a following turn to completion.
//
// The halt is the cooperative `conversation.abort()` seam — never a process kill — so the
// broker remains the SINGLE WRITER and no history is rewritten.
//
// Run: node demo/halt.test.mjs  (exit 0 = pass)

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { haltLabel, haltSeat, haltTask } from "../src/halt.mjs";

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

/* ─── 1. the legible stop contract ───────────────────────────────────────── */
console.log("\nhaltLabel — the legible stop contract");
check("a halt is labelled `aborted:<reason>`", haltLabel("degeneration") === "aborted:degeneration");
check("the reason travels with the label", haltLabel("context-pressure") === "aborted:context-pressure");

/* ─── 2. a seat with no conversation is a no-op, not a crash ─────────────── */
console.log("\nhaltSeat — a seat with no conversation halts nothing");
const emptyHarness = await Harness.open(
	new MemoryStorage(),
	{ models: createModels(), registry: createRegistry() },
	ctx,
);
try {
	const noConv = await haltSeat(emptyHarness, { name: "ghost" }, { reason: "degeneration", context: ctx });
	check("no conversation -> halted:false", noConv.halted === false, JSON.stringify(noConv));
	check("the state names why", noConv.state === "no_conversation", JSON.stringify(noConv));
	check("the label is still legible", noConv.label === "aborted:degeneration");
} finally {
	await emptyHarness.close(ctx);
}

/* ─── 3. live: a mid-run halt INTERRUPTS the in-flight generation ────────── */
console.log("\nlive — a mid-run halt interrupts the generation, cooperatively");
const FULL = "word ".repeat(300); // 1500 chars, streamed slowly so the turn is long
const faux = fauxProvider({
	models: [{ id: "faux-seat", contextWindow: 100_000 }],
	tokensPerSecond: 50,
	tokenSize: { min: 1, max: 2 },
});
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);

try {
	let convId = null;
	await harness.commit(async (tx) => {
		const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
		await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" } });
		convId = c.id;
	}, ctx);

	// A long reply for the run we will halt, then a short one for the recovery turn.
	faux.setResponses([fauxAssistantMessage(fauxText(FULL)), fauxAssistantMessage(fauxText("recovered"))]);

	const conv = await harness.conversation(convId, ctx);
	const sub = await conv.submit({ type: "input", content: "produce a long reply" }, ctx);
	const startedAt = Date.now();

	// Let the generation get well into streaming, then halt it mid-flight.
	await new Promise((r) => setTimeout(r, 1500));
	const notices = [];
	const halt = await haltSeat(harness, { name: "faux-seat", conversationId: convId }, {
		reason: "degeneration",
		context: ctx,
		onNotice: (n) => notices.push(n),
	});
	const haltedAt = Date.now();
	const settled = await sub.wait(ctx);
	const elapsed = haltedAt - startedAt;

	check("the halt reports halted:true", halt.halted === true, JSON.stringify(halt));
	check("the halt state is `aborted`", halt.state === "aborted", JSON.stringify(halt));
	check("the halt label is legible", halt.label === "aborted:degeneration", JSON.stringify(halt.label));
	check("a notice fired (observable)", notices.length === 1 && notices[0].kind === "halted", JSON.stringify(notices));
	check("the notice names the seat", notices[0]?.seat === "faux-seat", JSON.stringify(notices[0]));

	check("the submission settled durably as aborted", settled.reason === "aborted", JSON.stringify(settled));
	check("the submission is unanswered (the turn did not finish)", settled.status === "unanswered", JSON.stringify(settled));

	// The generation was interrupted MID-STREAM: the committed assistant turn is a partial,
	// strictly shorter than the scripted full reply.
	const page = await conv.entries({}, 50, undefined, ctx);
	const assistantText = page.items
		.filter((e) => e.kind === "pi.assistant")
		.map((e) => (Array.isArray(e.model) ? (e.model[0].content ?? []).map((p) => p.text ?? "").join("") : ""))
		.join("");
	check("the in-flight turn was committed as a PARTIAL", assistantText.length > 0 && assistantText.length < FULL.length, `len=${assistantText.length} full=${FULL.length}`);
	check("the halt fired mid-stream, not after the full reply", elapsed < 6000, `elapsed=${elapsed}`);

	// Recoverable: the transcript is untouched (the wake + partial turn survive) and the seat
	// can run again on the SAME conversation — nothing was destroyed or rewritten.
	check("the wake and the partial turn are both still in the transcript", page.items.some((e) => e.kind === "pi.user") && page.items.some((e) => e.kind === "pi.assistant"));
	const sub2 = await conv.submit({ type: "input", content: "recover and continue" }, ctx);
	const settled2 = await sub2.wait(ctx);
	check("the seat is RECOVERABLE: a following turn runs to completion", settled2.status === "done", JSON.stringify(settled2));
	/* ─── 4. live: haltTask interrupts one live generation by id ──────────── */
	console.log("\nlive — haltTask interrupts one live generation by its task id");
	let conv2Id = null;
	await harness.commit(async (tx) => {
		const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
		await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" } });
		conv2Id = c.id;
	}, ctx);
	faux.setResponses([fauxAssistantMessage(fauxText(FULL)), fauxAssistantMessage(fauxText("recovered again"))]);
	const conv2 = await harness.conversation(conv2Id, ctx);
	const sub3 = await conv2.submit({ type: "input", content: "produce another long reply" }, ctx);
	await new Promise((r) => setTimeout(r, 1200));
	const live = (await harness.inspect(ctx)).tasks.find((t) => t.record?.conversationId === conv2Id && t.record?.state?.status === "running");
	check("a live generation task is visible to inspect()", Boolean(live), JSON.stringify(live));
	const taskHalt = await haltTask(harness, live?.record?.id, { reason: "degeneration", context: ctx });
	const settled3 = await sub3.wait(ctx);
	check("haltTask reports halted:true", taskHalt.halted === true, JSON.stringify(taskHalt));
	check("abortTask was admitted (marked)", taskHalt.outcome === "marked", JSON.stringify(taskHalt));
	check("the task-level halt also settles the submission as aborted", settled3.reason === "aborted", JSON.stringify(settled3));
} finally {
	await harness.close(ctx);
}

console.log(failures === 0 ? "\nPASS — a mid-run halt interrupts the generation and leaves the seat recoverable" : `\nFAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
