// demo/degeneration-duration.test.mjs — the per-turn WALL-CLOCK bound, as its OWN cause.
//
// RED BEFORE: src/degeneration.mjs carries no `maxTurnDurationMs` bound, so a turn that ran far
// past it is not flagged and `DEGEN_DEFAULTS.maxTurnDurationMs` is undefined.
// GREEN AFTER: assessRun() flags a run whose SLOWEST turn exceeded the bound as
// `turn-duration-ms=...>=...`, leaves a long-but-legit turn alone, and the supervisor's reset
// handoff names the wall-clock cause.
//
// Why this cause is SAFE where the D78 prose heuristic was not: it reads a NUMBER the harness
// already persists (`AssistantMessage.durationMs`), not a parse of prose, so a healthy long
// document cannot trip it. It is deliberately HIGH (~5 min) and operator-tunable through the same
// `opts` seam as every other bound. See docs/DECISIONS.md D78 (reverted) for the lesson.
//
// Run: node demo/degeneration-duration.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";
import { assessRun, DEGEN_DEFAULTS } from "../src/degeneration.mjs";
import { applyResets } from "../src/supervisor.mjs";

let failures = 0;
function check(label, fn) {
	try {
		fn();
		console.log(`  ok   ${label}`);
	} catch (err) {
		failures += 1;
		console.log(`  FAIL ${label} -- ${err.message}`);
	}
}
async function checkAsync(label, fn) {
	try {
		await fn();
		console.log(`  ok   ${label}`);
	} catch (err) {
		failures += 1;
		console.log(`  FAIL ${label} -- ${err.message}`);
	}
}

const user = (text = "You have queued work.") => ({
	kind: "pi.user",
	model: [{ role: "user", content: [{ type: "text", text }] }],
});

// The RAW storage shape (D78 grounding trap): `entry.model` is an ARRAY of messages, and the
// per-turn wall-clock lives on the assistant message as `durationMs`.
const assistant = ({ durationMs, text = "Working." } = {}) => ({
	kind: "pi.assistant",
	model: [
		{
			role: "assistant",
			content: [{ type: "text", text }],
			...(durationMs === undefined ? {} : { durationMs }),
		},
	],
});

console.log("\n=== degeneration guard: per-turn wall-clock bound ===\n");

check("the default per-turn bound is present and is ~5 minutes", () => {
	assert.ok(Number.isFinite(DEGEN_DEFAULTS.maxTurnDurationMs), "maxTurnDurationMs must be a number");
	assert.equal(DEGEN_DEFAULTS.maxTurnDurationMs, 5 * 60_000);
});

check("a turn past the wall-clock bound is degenerate, named as its own cause", () => {
	const a = assessRun([assistant({ durationMs: 6 * 60_000 }), user()]);
	assert.equal(a.degenerate, true);
	assert.ok(
		a.reasons.some((r) => r.startsWith("turn-duration-ms=")),
		a.reasons.join(","),
	);
	assert.equal(a.turnDurationMs, 6 * 60_000, "the slowest turn is reported");
});

check("a long-but-legit turn under the bound is NOT degenerate", () => {
	const a = assessRun([assistant({ durationMs: 4 * 60_000 }), user()]);
	assert.equal(a.degenerate, false, a.reasons.join(","));
	assert.equal(a.turnDurationMs, 4 * 60_000);
});

check("a legacy turn carrying no durationMs is not flagged", () => {
	const a = assessRun([assistant({}), user()]);
	assert.equal(a.degenerate, false, a.reasons.join(","));
	assert.equal(a.turnDurationMs, 0);
});

check("the bound is operator-tunable through the same opts seam as the other limits", () => {
	const entries = [assistant({ durationMs: 2000 }), user()];
	assert.equal(assessRun(entries, { maxTurnDurationMs: 1000 }).degenerate, true);
	assert.equal(assessRun(entries).degenerate, false, "the 5-min default does not trip on 2 s");
});

check("the slowest turn in the run is what counts, not the last one", () => {
	const entries = [assistant({ durationMs: 1000 }), assistant({ durationMs: 7 * 60_000 }), user()];
	const a = assessRun(entries);
	assert.equal(a.turnDurationMs, 7 * 60_000);
	assert.equal(a.degenerate, true, a.reasons.join(","));
});

check("a slow turn in an OLD run behind a wake is ignored", () => {
	const entries = [
		assistant({ durationMs: 1000 }),
		user("current wake"),
		assistant({ durationMs: 9 * 60_000 }),
		user("old wake"),
	];
	const a = assessRun(entries);
	assert.equal(a.degenerate, false, a.reasons.join(","));
});

await checkAsync("applyResets names the wall-clock cause in the handoff", async () => {
	const handoffs = [];
	const harness = { conversation: async () => ({ reset: async (handoff) => handoffs.push(handoff) }) };
	await applyResets(
		harness,
		[{ seat: "impl", conversationId: 3, reason: "degeneration", detail: "turn-duration-ms=360000>=300000" }],
		{},
	);
	assert.match(handoffs[0], /wall-clock/);
	assert.match(handoffs[0], /turn-duration-ms/);
});

console.log(failures === 0 ? "\nPASS — per-turn wall-clock bound verified" : `\nFAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
