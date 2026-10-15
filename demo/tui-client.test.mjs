// demo/tui-client.test.mjs - TUI C3: headless frame assertions for src/tui/client.mjs.
//
// FAILING-FIRST: import the module - it doesn't exist yet - error (RED).
// After landing src/tui/client.mjs - import succeeds, render returns valid Frame (GREEN).
//
// Run: node demo/tui-client.test.mjs  (exit 0 = pass)

import { readFile } from "node:fs/promises";
import { join } from "node:path";

let failures = 0;
function check(label, condition, detail = "") {
	if (condition) {
		console.log(`  ok   ${label}`);
	} else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

// Test data
const dummySeats = [
	{ name: "pm", role: "program manager" },
	{ name: "impl", role: "implementation engineer" },
	{ name: "qa", role: "independent verifier" },
	{ name: "lead", role: "technical lead" },
];

const dummyTurns = [
	{ kind: "operator", ts: 1, text: "Process the queue" },
	{ kind: "agent", ts: 2, text: "I will check the queue" },
	{ kind: "thinking", ts: 2, text: "Step 1: read queue\nStep 2: analyze" },
	{ kind: "tools", ts: 3, call: { name: "claim_work", args: { itemId: 42 } }, result: null },
	{ kind: "operator", ts: 4, text: "What about the bug?" },
];

const dummyPartial = {
	attempt: 1,
	text: "I am checking the queue right",
	thinking: null,
	tools: [{ name: "claim_work", callId: "abc" }],
	hasContent: true,
};

const dummyHealth = {
	seats: dummySeats,
	queueItems: [],
	attention: [],
	uptime: 3600,
};

const dummyQueueItems = [];

try {
	console.log("\n=== TUI C3: src/tui/client.mjs ===\n");

	// Import the module
	const tuiModule = await import("../src/tui/client.mjs");

	// Exports exist
	console.log("1. Module exports");
	check("renderTui is a function", typeof tuiModule.renderTui === "function");
	check("Frame is a class", typeof tuiModule.Frame === "function");
	check("frameToLines is a function", typeof tuiModule.frameToLines === "function");
	check("formatTuiToolName is a function", typeof tuiModule.formatTuiToolName === "function");

	// Basic frame
	console.log("\n2. renderTui - basic frame");
	const frame1 = tuiModule.renderTui({
		seats: dummySeats,
		turns: dummyTurns,
		partial: null,
		health: dummyHealth,
		queueItems: dummyQueueItems,
		width: 80,
		color: false,
	});
	check("frame is a Frame instance", frame1 instanceof tuiModule.Frame);
	check("frame has lines array", Array.isArray(frame1.lines));
	check("frame height > 0", frame1.height > 0);
	check("frame header present", frame1.lines[0]?.includes("durig"));
	check("frame seat rows present", frame1.lines.some((l) => l.includes("pm")));
	// Transcript: agent turn shows with arrow
	check("frame transcript shows agent", frame1.lines.some((l) => l.includes("◀") || l.includes("agent")));

	// With streaming partial
	console.log("\n3. renderTui - with streaming partial");
	const frame2 = tuiModule.renderTui({
		seats: dummySeats,
		turns: dummyTurns,
		partial: dummyPartial,
		health: dummyHealth,
		queueItems: dummyQueueItems,
		width: 80,
		color: false,
	});
	check("partial shows streaming header", frame2.lines.some((l) => l.includes("streaming")));
	check("partial shows text", frame2.lines.some((l) => l.includes("checking the queue")));

	// 60 columns (floor)
	console.log("\n4. renderTui - 60 columns (floor)");
	const frame3 = tuiModule.renderTui({
		seats: dummySeats,
		turns: dummyTurns,
		partial: null,
		health: dummyHealth,
		queueItems: dummyQueueItems,
		width: 60,
		color: false,
	});
	check("60-col frame valid", frame3.height > 0);
	check("no line exceeds 60 chars", frame3.lines.every((l) => l.length <= 60));

	// 80 columns (pinned)
	console.log("\n5. renderTui - 80 columns (pinned)");
	const frame4 = tuiModule.renderTui({
		seats: dummySeats,
		turns: dummyTurns,
		partial: null,
		health: dummyHealth,
		queueItems: dummyQueueItems,
		width: 80,
		color: false,
	});
	check("80-col frame valid", frame4.height > 0);
	check("no line exceeds 80 chars", frame4.lines.every((l) => l.length <= 80));

	// Empty data
	console.log("\n6. renderTui - empty data");
	const frame5 = tuiModule.renderTui({
		seats: [],
		turns: [],
		partial: null,
		health: {},
		queueItems: [],
		width: 80,
		color: false,
	});
	check("empty frame is valid", frame5 instanceof tuiModule.Frame);
	check("empty frame has height > 0", frame5.height > 0);

	// Helper
	console.log("\n7. formatTuiToolName helper");
	check("tool name extracted", tuiModule.formatTuiToolName({ name: "write", args: {} }) === "write");
	check("default name for null", tuiModule.formatTuiToolName(null) === "tool");

	// Color stripping
	console.log("\n8. frameToLines strips ANSI colors");
	const frameWithColor = tuiModule.renderTui({
		seats: dummySeats,
		turns: [],
		partial: null,
		health: {},
		queueItems: [],
		width: 80,
		color: true,
	});
	const strippedLines = tuiModule.frameToLines(frameWithColor);
	check("stripped lines are clean strings", strippedLines.every((l) => typeof l === "string" && !/\x1b/.test(l)));

	// Regression: no storage/harness/driver imports
	console.log("\n9. Regression: no storage/harness/drive imports");
	const source = await readFile(join(process.cwd(), "src/tui/client.mjs"), "utf8");
	check("no storage import", !source.includes("storage"));
	check("no harness import", !source.includes("harness"));
	check("no driver import", !source.includes("import.*driver") && !source.includes("from.*driver"));

	console.log(failures === 0
		? "\nPASS - TUI C3 client module verified"
		: `\nFAIL - ${failures} check(s) failed`);
} catch (err) {
	console.error("ERROR:", err);
	failures += 1;
}

process.exit(failures === 0 ? 0 : 1);
