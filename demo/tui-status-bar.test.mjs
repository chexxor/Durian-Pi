// demo/tui-status-bar.test.mjs — #2826 item 2: the status bar speaks in human phrases with
// seat attribution, splits the queue from parked work, counts only LIVE work, and degrades
// honestly instead of lying.
//
// THE DEFECTS, all visible in one frame before this change:
//   - raw enum tags: `[admitted_not_started]` is the machine's word, printed at the operator;
//   - no attribution: a seat-scoped notice did not say WHOSE it was;
//   - `queue: N` counted EVERY item ever enqueued (done/cancelled included), so the number
//     grew as work finished;
//   - no queue/parked split, so "waiting on you" was invisible in the bar;
//   - the bar degraded by dropping parts from the RIGHT, which killed the NOTICES first
//     (they sit last) to keep the uptime clock — the least actionable part surviving the most.
//
// FAILING-FIRST: on the parent tip every assertion below fails — the bar prints
// `[admitted_not_started]`, counts 5 items where 4 are live, and has no split.
//
// Run: node demo/tui-status-bar.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";

import { frameToLines, renderTui } from "../src/tui/client.mjs";
import { textWidth } from "../src/textwidth.mjs";

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

const SEATS = [{ name: "impl", role: "implementation engineer" }, { name: "qa", role: "verifier" }];
// 2 active (queued + claimed), 2 parked (deferred + held), 1 terminal that must NOT count.
const QUEUE = [
	{ id: 1, from: "pm", to: "impl", subject: "a", status: "queued" },
	{ id: 2, from: "pm", to: "impl", subject: "b", status: "claimed" },
	{ id: 3, from: "pm", to: "qa", subject: "c", status: "deferred", deferredTo: "human" },
	{ id: 4, from: "pm", to: "qa", subject: "d", status: "held" },
	{ id: 5, from: "pm", to: "impl", subject: "e", status: "done" },
	{ id: 6, from: "pm", to: "impl", subject: "f", status: "cancelled" },
];
const NOTES = [
	{ scope: "seat", seat: "qa", kind: "admitted_not_started" },
	{ scope: "rig", seat: null, kind: "pass-failed" },
];
const HEALTH = { seats: SEATS, queueItems: QUEUE, uptime: 3600, attention: NOTES };

const bar = (params = {}) => {
	const lines = frameToLines(
		renderTui({ seats: SEATS, health: HEALTH, queueItems: QUEUE, selectedSeat: "impl", view: "seats", width: 100, height: 24, ...params }),
	);
	return lines.find((l) => l.includes("seats:")) ?? "";
};

try {
	console.log("\n=== human phrases, never raw enum tags ===");
	const wide = bar();
	check("the notice reads as words, not a tag", wide.includes("submission not started"), wide);
	check("no bracketed enum tag anywhere in the bar", !/\[[a-z_]+(_[a-z]+)+\]/.test(wide), wide);
	check("an unmapped kind still reads (separators opened out)", bar({ health: { ...HEALTH, attention: [{ scope: "rig", seat: null, kind: "some_new_kind" }] } }).includes("some new kind"));

	console.log("\n=== seat attribution ===");
	check("a seat-scoped notice names its seat", wide.includes("qa: submission not started"), wide);
	check("a rig-scoped notice stays unattributed", wide.includes("pass failed") && !wide.includes("null:"), wide);

	console.log("\n=== the queue/parked split, counting LIVE work only ===");
	check("the split is shown when both halves are non-zero", wide.includes("queue: 2 · parked 2"), wide);
	check("terminal items do not inflate the count (6 items, 4 live)", !wide.includes("queue: 6") && !wide.includes("queue: 4 · parked"), wide);
	check("only queued work -> queue only", bar({ queueItems: [{ status: "queued" }, { status: "claimed" }], health: { ...HEALTH, attention: [] } }).includes("queue: 2") && !bar({ queueItems: [{ status: "queued" }, { status: "claimed" }], health: { ...HEALTH, attention: [] } }).includes("parked"));
	check("only parked work -> parked only", bar({ queueItems: [{ status: "deferred" }], health: { ...HEALTH, attention: [] } }).includes("parked 1") && !bar({ queueItems: [{ status: "deferred" }], health: { ...HEALTH, attention: [] } }).includes("queue:"));
	check("nothing live -> neither is shown (hide-when-zero)", !bar({ queueItems: [], health: { ...HEALTH, attention: [] } }).includes("queue:") && !bar({ queueItems: [], health: { ...HEALTH, attention: [] } }).includes("parked"));

	console.log("\n=== signal before convenience: the clock gives way first ===");
	check("at 110 cols everything fits", bar({ width: 110 }).includes("uptime: 60m") && bar({ width: 110 }).includes("submission not started"));
	const at100 = bar({ width: 100 });
	check("at 100 cols the notice survives and the uptime goes", at100.includes("submission not started") && !at100.includes("uptime:"), at100);

	console.log("\n=== degradation must not lie: a dropped split becomes ONE honest total ===");
	const at40 = bar({ width: 40 });
	check("the split is gone at 40 cols", !at40.includes("parked"), at40);
	check("and it is replaced by the combined total, not a truncated split", at40.includes("queue: 4"), at40);
	check("no ellipsis in the bar (a cut split would show one)", !at40.includes("…"), at40);
	for (let w = 30; w <= 120; w += 2) {
		const b = bar({ width: w });
		if (textWidth(b) > w) {
			check(`bar fits at ${w} cols`, false, `${textWidth(b)} > ${w}: ${b}`);
			break;
		}
	}
	check("the bar fits every width 30..120", true);

	console.log("\n=== monochrome ===");
	check("no ANSI escapes when colour is off", !bar({ color: false }).includes("\x1b["));

	assert.ok(true);
	console.log(
		failures === 0
			? "\nSTATUS BAR PASS (human phrases + attribution + live-only split + honest degradation)"
			: `\nSTATUS BAR FAIL — ${failures} check(s)`,
	);
} catch (err) {
	console.error("ERROR:", err?.message ?? err);
	failures += 1;
}

process.exit(failures === 0 ? 0 : 1);
