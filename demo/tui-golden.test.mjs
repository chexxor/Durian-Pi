// demo/tui-golden.test.mjs — Tier 2 golden frames: paint each TUI surface into a
// cell buffer and compare the WHOLE frame to a committed golden
// (docs/TUI-TESTING.md). Substring tests cannot catch a one-cell overflow or a
// layout shift; these can.
//
// Run:            node demo/tui-golden.test.mjs
// Regenerate:     UPDATE_GOLDEN=1 node demo/tui-golden.test.mjs   (review the diff)
//
// Hermetic: no store, no harness, no TTY (D11) — deterministic fixtures only.

import { renderTui } from "../src/tui/client.mjs";
import {
	ScreenBuffer,
	compareGolden,
	createChecker,
	fixtureTurns,
	goldenDiff,
	health,
	partial,
	seats,
	turns,
} from "./tui-harness.mjs";

const { check, done } = createChecker("TUI golden frames");
console.log("\n=== TUI golden frames (Tier 2) ===\n");

const base = { seats: seats(), health: health(), queueItems: [] };
const fixture = fixtureTurns();
const implStream = partial({ text: "reading the queue and claiming #624", seat: "impl" });

const cases = [
	["seats-80", renderTui({ ...base, turns: fixture, width: 80, height: 24 })],
	["seats-48", renderTui({ ...base, turns: fixture, width: 48, height: 24 })],
	[
		"conversation-80",
		renderTui({ ...base, turns: fixture, width: 80, height: 24, view: "conversation", selectedSeat: "impl", scroll: 0 }),
	],
	[
		"conversation-48",
		renderTui({ ...base, turns: fixture, width: 48, height: 24, view: "conversation", selectedSeat: "impl", scroll: 0 }),
	],
	[
		"conversation-streaming-80",
		renderTui({
			...base,
			turns: fixture,
			partials: [implStream],
			partial: implStream,
			width: 80,
			height: 24,
			view: "conversation",
			selectedSeat: "impl",
		}),
	],
	[
		"streaming-80",
		renderTui({ ...base, turns: fixture, partials: [implStream], partial: implStream, width: 80, height: 24 }),
	],
	[
		"toolblock-80",
		renderTui({
			...base,
			turns: [turns.tool("write", { path: "src/x.mjs" }, { resultText: "wrote 3 lines" })],
			width: 80,
			height: 24,
			view: "conversation",
			selectedSeat: "impl",
		}),
	],
	[
		"thinking-80",
		renderTui({
			...base,
			turns: [turns.agent("done"), turns.thinking("checked the queue\nsecond line\nthird line")],
			width: 80,
			height: 24,
			view: "conversation",
			selectedSeat: "impl",
		}),
	],
];

for (const [name, frame] of cases) {
	const width = name.endsWith("-48") ? 48 : 80;
	const buffer = new ScreenBuffer(width, 24).paint(frame.lines);
	const result = compareGolden(buffer.toLines(), name);
	check(
		`${name}: matches golden`,
		result.ok,
		result.missing
			? `missing golden ${result.file} — run: UPDATE_GOLDEN=1 node demo/tui-golden.test.mjs`
			: goldenDiff(result.expected, result.actual),
	);
	check(
		`${name}: never overflows the viewport`,
		buffer.overflowCells === 0 && buffer.overflowRows === 0,
		`cells=${buffer.overflowCells} rows=${buffer.overflowRows}`,
	);
}

process.exit(done() ? 0 : 1);
