// demo/guard.test.mjs — the SHARED ordering core + resolution, proven END TO END (item C / #1769).
//
// Failing-first: before src/guard.mjs exists this dies with ERR_MODULE_NOT_FOUND. After, it
// proves the ACTIVE guard on a REAL harness, end to end:
//   a run degrades WHILE IN FLIGHT (one runaway turn) → the trigger DETECTS it BEFORE it settles
//   → the core HALTS it cooperatively → WAITS for the lease → RESOLVES it with the
//   cause-appropriate action (the degeneration boundary reset), while the durable transcript AND
//   the CLAIMED QUEUE ITEM remain RECOVERABLE and the SINGLE WRITER is preserved.
//
// The order is the invariant (GUARD_STEPS): detect → halt → wait-idle → resolve. It never resets
// a LIVE lease: it halts and waits first, which is exactly what the old boundary-reset path could
// not do.
//
// Run: node demo/guard.test.mjs  (exit 0 = pass)

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage, watchEvents } from "@earendil-works/pi-durable";

import { haltIdleResolve, planGuard, resolveDegeneration, waitForIdle } from "../src/guard.mjs";
import { createInflightWatch } from "../src/inflight.mjs";
import { enqueueItem, registerSeat, RigQueue } from "../src/rig.mjs";

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

/* ─── 1. pure: the trigger assessment becomes an ordering plan ───────────── */
console.log("\nplanGuard — a plan only when the trigger fired");
check("a healthy assessment plans nothing", planGuard({ seat: { name: "impl", conversationId: 1 }, assessment: { degenerate: false, reasons: [] } }) === null);
const plan = planGuard({ seat: { name: "impl", conversationId: 7 }, assessment: { degenerate: true, reasons: ["turn-duration-ms=9000>=1500"] } });
check("a degenerate assessment names the seat and conversation", plan?.seat === "impl" && plan?.conversationId === 7, JSON.stringify(plan));
check("the cause travels into the plan detail", plan?.detail === "turn-duration-ms=9000>=1500", JSON.stringify(plan));

/* ─── 2. end to end on a real harness ────────────────────────────────────── */
console.log("\nend-to-end — detect → halt → wait-idle → resolve, on a live run");
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
	let itemId = null;
	await harness.commit(async (tx) => {
		const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
		convId = c.id;
		await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" } });
		await registerSeat(tx, "impl", c.id, "implementation");
		itemId = await enqueueItem(tx, "pm", "impl", "E2E_SUBJECT", "E2E_BODY");
		// The seat has CLAIMED the item — the work in flight when it degenerates.
		const q = await tx.doc(RigQueue);
		const it = q.items.find((i) => i.id === itemId);
		it.status = "claimed";
		it.transitions.push({ at: new Date().toISOString(), event: "claimed", by: "impl" });
	}, ctx);

	faux.setResponses([fauxAssistantMessage(fauxText(FULL)), fauxAssistantMessage(fauxText("re-anchored"))]);

	const conv = await harness.conversation(convId, ctx);

	let settled = false;
	let trip = null;
	let tripBeforeSettle = false;
	let guardRun = null;
	const notices = [];
	const watch = createInflightWatch({
		opts: { maxTurnDurationMs: 1500 },
		onTrip: (assessment) => {
			trip = assessment;
			tripBeforeSettle = !settled;
			// The ORDERING: on a trip, run the shared core with the degeneration resolution.
			guardRun = haltIdleResolve(harness, planGuard({ seat: { name: "impl", conversationId: convId }, assessment }), {
				context: ctx,
				resolve: resolveDegeneration,
				onNotice: (n) => notices.push(n),
			});
		},
	});

	// Subscribe BEFORE the run starts, so no `turn_start`/`message_update` batch is missed.
	const stream = await watchEvents(harness, convId, ctx);
	stream.start(async (events) => {
		watch.observeBatch(events);
		if (events.some((e) => e.type === "turn_end" || e.type === "run_end")) settled = true;
	});

	const sub = await conv.submit({ type: "input", content: "produce a long reply" }, ctx);
	const settledSub = await sub.wait(ctx);
	const guard = guardRun ? await guardRun : null;
	await stream.stop();

	// DETECT — before the run settled.
	check("the trigger detected the runaway turn", trip !== null, JSON.stringify(trip));
	check("detection happened BEFORE the turn settled", tripBeforeSettle === true);
	check("the trigger's cause is the reused wall-clock bound", trip?.reasons?.[0]?.startsWith("turn-duration-ms="), JSON.stringify(trip?.reasons));

	// HALT → WAIT IDLE → RESOLVE — in that order.
	check("the core ran", guard !== null, JSON.stringify(guard));
	check("the steps are exactly detect→halt→wait-idle→resolve (halt/wait/resolve recorded)", JSON.stringify(guard?.steps?.map((s) => s.step)) === JSON.stringify(["halt", "wait-idle", "resolve"]), JSON.stringify(guard?.steps));
	check("HALT succeeded", guard?.steps?.[0]?.halted === true, JSON.stringify(guard?.steps?.[0]));
	check("WAIT-IDLE confirmed the lease was released", guard?.steps?.[1]?.idle === true, JSON.stringify(guard?.steps?.[1]));
	check("RESOLVE applied the cause-appropriate action", guard?.steps?.[2]?.applied === true && guard?.steps?.[2]?.action === "reset", JSON.stringify(guard?.steps?.[2]));
	check("the core reports resolved", guard?.resolved === true, JSON.stringify(guard));
	check("a halt notice fired (observable)", notices.length === 1 && notices[0].label === "aborted:degeneration", JSON.stringify(notices));

	// The submission was halted cooperatively, not killed.
	check("the halted submission settled as aborted", settledSub.reason === "aborted", JSON.stringify(settledSub));

	// RESOLUTION is durable and the transcript is preserved (RECOVERABLE).
	const page = await conv.entries({}, 200, undefined, ctx);
	const kinds = page.items.map((e) => e.kind);
	check("the boundary reset is durable (a pi.reset entry exists)", kinds.includes("pi.reset"), JSON.stringify(kinds));
	check("the wake and the partial turn are still in the transcript", kinds.includes("pi.user") && kinds.includes("pi.assistant"), JSON.stringify(kinds));

	// The CLAIMED ITEM is untouched: the guard halted the RUN, it did not touch the QUEUE.
	const q = await harness.documentState(RigQueue, undefined, ctx);
	const item = q?.value?.items?.find((i) => i.id === itemId);
	check("the claimed item is still CLAIMED (recoverable, not lost)", item?.status === "claimed", JSON.stringify(item));
	check("the item's claim transition survived", item?.transitions?.some((t) => t.event === "claimed"), JSON.stringify(item?.transitions));

	// SINGLE WRITER: every write above was admitted by the broker's own harness (the durable
	// reset entry and the aborted submission are harness-written records); no second writer, no
	// history rewrite, nothing deleted.
	check("the conversation is still readable through the single harness", kinds.length >= 3, JSON.stringify(kinds));
} finally {
	await harness.close(ctx);
}

console.log(failures === 0 ? "\nPASS — a run that degrades in flight is detected, halted, and resolved; the item survives" : `\nFAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
