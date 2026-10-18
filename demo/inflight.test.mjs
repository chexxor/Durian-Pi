// demo/inflight.test.mjs — the MID-RUN trigger of the active degeneration guard (item A / #1767).
//
// Failing-first: before src/inflight.mjs exists this dies with ERR_MODULE_NOT_FOUND. After, it
// proves the two halves of the trigger:
//   (1) PURE  — assessInflightTurn trips on the reused causes (wall-clock #874, model-aware
//       streamed volume #1705, named prose patterns #875) and stays quiet on a healthy turn;
//   (2) LIVE  — on a REAL harness driven by a streaming faux model, a watch folded from
//       pi-durable's agent event stream (`watchEvents`) trips a SINGLE runaway turn WHILE it is
//       still streaming — BEFORE `turn_end` — which is exactly what the post-settlement guard
//       (src/degeneration.mjs `assessRun`) cannot do.
//
// Run: node demo/inflight.test.mjs  (exit 0 = pass)

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage, watchEvents } from "@earendil-works/pi-durable";

import { DEGEN_DEFAULTS } from "../src/degeneration.mjs";
import { assessInflightTurn, createInflightWatch, inflightWindow, INFLIGHT_DEFAULTS } from "../src/inflight.mjs";

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

/* ─── 1. pure: the reused causes ─────────────────────────────────────────── */
console.log("\nassessInflightTurn — a healthy in-flight turn is NOT flagged");
const healthy = assessInflightTurn({ elapsedMs: 1200, streamedChars: 200, streamedText: "here is a plan", contextWindow: 100_000 });
check("a short, small, clean turn does not trip", healthy.degenerate === false, JSON.stringify(healthy));
check("no reasons on a healthy turn", healthy.reasons.length === 0, JSON.stringify(healthy.reasons));

console.log("\nassessInflightTurn — wall-clock cause reuses #874's bound");
const slow = assessInflightTurn({ elapsedMs: DEGEN_DEFAULTS.maxTurnDurationMs, streamedChars: 10 });
check("a turn at the #874 bound trips", slow.degenerate === true, JSON.stringify(slow));
check("the reason names the wall-clock cause", slow.reasons[0]?.startsWith("turn-duration-ms="), JSON.stringify(slow.reasons));
check("the default wall-clock bound IS #874's", INFLIGHT_DEFAULTS.maxTurnDurationMs === DEGEN_DEFAULTS.maxTurnDurationMs);
check("just under the bound stays quiet", assessInflightTurn({ elapsedMs: DEGEN_DEFAULTS.maxTurnDurationMs - 1 }).degenerate === false);

console.log("\nassessInflightTurn — model-aware streamed-volume bound (#1705)");
const windowed = assessInflightTurn({ elapsedMs: 1000, streamedChars: 4000, contextWindow: 1000 });
check("streamed tokens at the declared window trip", windowed.degenerate === true, JSON.stringify(windowed));
check("the reason names streamed-tokens", windowed.reasons.some((r) => r.startsWith("streamed-tokens=")), JSON.stringify(windowed.reasons));
check(
	"with NO window declared, the volume bound is OFF (never invent a fraction)",
	assessInflightTurn({ elapsedMs: 1000, streamedChars: 4_000_000 }).degenerate === false,
);
check(
	"a declared DURIG_CONTEXT_WINDOW resolves to the model-aware denominator",
	inflightWindow({ DURIG_CONTEXT_WINDOW: 200_000 }, "prov/model") === 200_000,
);
check("no declaration resolves to null", inflightWindow({}, "prov/model") === null);

console.log("\nassessInflightTurn — streamed PROSE reuses #875's named-pattern registry");
const wall = Array.from({ length: 70 }, (_, i) => `Step ${i % 10}.`).join(" ");
const prose = assessInflightTurn({ elapsedMs: 1000, streamedText: wall });
check("a streamed short-sentence wall trips", prose.degenerate === true, JSON.stringify(prose.patterns));
check("the reason NAMES the pattern", prose.reasons.includes("degenerate-text=short-sentence-wall"), JSON.stringify(prose.reasons));
check("ordinary streamed prose does not match a pattern", assessInflightTurn({ elapsedMs: 5, streamedText: "The plan is simple and the file is small." }).patterns.length === 0);

/* ─── 2. live: a single runaway turn trips BEFORE it settles ─────────────── */
console.log("\nlive — a SINGLE runaway turn is detected while it is still streaming");
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

	// A long reply streamed slowly: the turn lasts seconds, so a small wall-clock bound must
	// trip MID-turn. The bound is injected, so the demo is fast and deterministic.
	faux.setResponses([fauxAssistantMessage(fauxText("word ".repeat(300)))]);

	let settled = false;
	let updatesBeforeTrip = 0;
	let updates = 0;
	let trip = null;
	let tripBeforeSettle = false;
	const watch = createInflightWatch({
		opts: { maxTurnDurationMs: 1500 },
		onTrip: (assessment) => {
			trip = assessment;
			tripBeforeSettle = !settled;
		},
	});

	const stream = await watchEvents(harness, convId, ctx);
	stream.start(async (events) => {
		for (const event of events) {
			if (event.type === "message_update") {
				updates += 1;
				if (trip === null) updatesBeforeTrip += 1;
			}
		}
		watch.observeBatch(events);
		if (events.some((e) => e.type === "turn_end" || e.type === "run_end")) settled = true;
	});

	const conv = await harness.conversation(convId, ctx);
	await (await conv.submit({ type: "input", content: "produce a long reply" }, ctx)).wait(ctx);
	await stream.stop();

	check("the live turn actually streamed many updates", updates > 10, `updates=${updates}`);
	check("the watch tripped at all", trip !== null, JSON.stringify(watch.trip));
	check("it tripped BEFORE the turn settled (before turn_end)", tripBeforeSettle === true);
	check("it tripped mid-stream, after real streamed updates", updatesBeforeTrip > 0, `updatesBeforeTrip=${updatesBeforeTrip}`);
	check("the trip reason is the reused wall-clock cause", trip?.reasons?.[0]?.startsWith("turn-duration-ms="), JSON.stringify(trip?.reasons));
	check("the trip carries the elapsed time it saw", Number.isFinite(trip?.elapsedMs) && trip.elapsedMs >= 1500, JSON.stringify(trip?.elapsedMs));
	check("the watch reports tripped", watch.tripped === true);
	check("the trip fired on the SAME turn that later settled", settled === true);
} finally {
	await harness.close(ctx);
}

console.log(failures === 0 ? "\nPASS — a runaway turn is detected mid-stream, before it settles" : `\nFAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
