// demo/tui-landing.test.mjs — the LANDING screen (ROADMAP 124, designer spec #3307 §1-§7):
// per-seat state, queue size, current-item brief and action type, rendered from the
// readapi data path (#3308) in the ONE vocabulary the bar already uses (#2826).
//
// FAILING-FIRST: on main before #3313 the seat list renders a 3-field row with a NULL
// activity map (`renderSeatList(seats, null, …)`), so there is no state word, no per-seat
// queue, no brief and no action column at all — every assertion below fails.
//
// Run: node demo/tui-landing.test.mjs  (exit 0 = pass)

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

const SEATS = [
	{ name: "impl", role: "implementation engineer" },
	{ name: "qa", role: "verifier" },
	{ name: "advocate", role: "workflow reviewer" },
];
const QUEUE = [
	{ id: 74, from: "pm", to: "impl", subject: "merge the carry stack onto main", status: "claimed" },
	{ id: 1105, from: "pm", to: "impl", subject: "next", status: "queued" },
	// The parked seat: a QUESTION for the operator, which is what the landing screen is for.
	{
		id: 92,
		from: "pm",
		to: "qa",
		subject: "verify it",
		status: "deferred",
		deferredTo: "human",
		question: "supervisor escalation: which tip do I verify?",
	},
];
const HEALTH = {
	seats: SEATS,
	queueItems: QUEUE,
	attention: [{ scope: "seat", seat: "qa", kind: "admitted_not_started" }],
};
// The SAME per-seat partial object the streaming block renders (spec §3).
const PARTIALS = [
	{
		seat: "impl",
		hasContent: true,
		text: "working",
		thinking: "",
		tools: [],
		toolCalls: [{ name: "complete_work", status: "running" }],
	},
];

const frame = (params = {}) =>
	frameToLines(renderTui({ seats: SEATS, health: HEALTH, queueItems: QUEUE, width: 80, height: 24, ...params }));
const seatRows = (params = {}) => {
	const lines = frame({ selectedSeat: "impl", view: "seats", ...params });
	// The roster starts after the header + rule and ends at the first blank row.
	const start = 2;
	const end = lines.findIndex((l, i) => i > start && l.trim() === "");
	return lines.slice(start, end < 0 ? lines.length : end);
};
const rowOf = (name, params = {}) => seatRows(params).find((l) => l.includes(name));

try {
	console.log("\n=== (a) a PARKED seat: state, parked count, the QUESTION brief, blank action ===");
	const parked = rowOf("qa");
	check("renders the state word from the shared vocabulary", parked.includes("◌ parked"), parked);
	check("queue shows the parked count, so 'waiting on you' never reads as idle", parked.includes("0q · 1p"), parked);
	check("brief carries the item id", parked.includes("#92"), parked);
	check("brief carries the QUESTION, not the subject", parked.includes("supervisor"), parked);
	check("the action cell is BLANK (a parked seat is not working)", !parked.includes("composing") && !parked.includes("tool "), parked);
	check("brief truncates with an ellipsis, by cells", parked.includes("…"), parked);

	console.log("\n=== (b) a CLAIMED seat: item brief + the action token from the SAME partial ===");
	const working = rowOf("impl", { partials: PARTIALS });
	check("state word is working", working.includes("● working"), working);
	check("queue counts claimed + queued", working.includes("2q"), working);
	check("brief is the claimed item's id + subject", working.includes("#74") && working.includes("merge the carry"), working);
	check("action token names the tool it is running", working.includes("tool complete_w"), working);
	for (const [partial, token] of [
		[{ seat: "impl", hasContent: true, text: "writing the answer", thinking: "", tools: [], toolCalls: [] }, "composing"],
		[{ seat: "impl", hasContent: true, text: "", thinking: "reasoning", tools: [], toolCalls: [] }, "thinking"],
	]) {
		const row = rowOf("impl", { partials: [partial] });
		check(`action token '${token}' from the partial`, row.includes(token), row);
	}
	const noPartial = rowOf("impl");
	check("no partial -> action cell blank (not a dash)", !noPartial.includes("composing") && !noPartial.trimEnd().endsWith("—"), noPartial);

	console.log("\n=== (c) monochrome / NO_COLOR: the glyph and the word carry the state ===");
	const mono = rowOf("qa", { color: false });
	check("glyph + state word present without colour", mono.includes("◌") && mono.includes("parked"));
	check("no ANSI escapes in the monochrome frame", !frame({ color: false }).join("\n").includes("\x1b["));

	console.log("\n=== (d) the 48-col floor and the narrow fallback (ONE template, two widths) ===");
	const at48 = frame({ width: 48, selectedSeat: "impl" });
	check("48 cols: the landing row still renders (declared minimum is 44)", at48.some((l) => l.includes("◌ parked")), at48.slice(2, 5).join(" | "));
	check("48 cols: nothing overflows the frame", at48.every((l) => textWidth(l) <= 48), at48.filter((l) => textWidth(l) > 48).join(" | "));
	const at44 = frame({ width: 44, selectedSeat: "impl" });
	check("44 cols: still the landing row, nothing overflows", at44.every((l) => textWidth(l) <= 44) && at44.some((l) => l.includes("parked")));
	const narrow = frame({ width: 40, selectedSeat: "impl" });
	check("40 cols: the classic roster row is the honest fallback", narrow.some((l) => l.includes("implementation eng")), narrow.slice(2, 4).join(" | "));
	check("40 cols: no broken columns (no queue/brief cells)", !narrow.slice(2, 6).some((l) => /\d+q\b/.test(l)));
	check("40 cols: nothing overflows", narrow.every((l) => textWidth(l) <= 40));

	console.log("\n=== (e) selection: the cursor glyph marks the selected row ===");
	const rows = seatRows({ selectedSeat: "qa" });
	const qaRow = rows.find((l) => l.includes("qa"));
	const implRow = rows.find((l) => l.includes("impl"));
	check("the selected row carries the ▸ cursor", qaRow.trimStart().startsWith("▸"), qaRow);
	check("an unselected row does not", !implRow.trimStart().startsWith("▸"), implRow);

	console.log("\n=== degrade: more seats than rows, zero queue, no current item ===");
	const many = Array.from({ length: 14 }, (_, i) => ({ name: `seat${i}`, role: "worker" }));
	// #3941: the roster now uses the terminal's ROWS, so 14 seats genuinely FIT in a 24-row frame and
	// the degrade window is no longer exercised at that size. The height is lowered to 16 so the
	// roster really does overflow - the assertions are unchanged, the fixture is honest about when
	// "more seats than rows" is true.
	const crowded = frameToLines(renderTui({ seats: many, health: { seats: many, queueItems: [], attention: [] }, queueItems: [], selectedSeat: "seat0", view: "seats", width: 80, height: 16 }));
	check("a crowded roster stays inside the frame height", crowded.length <= 16, `lines=${crowded.length}`);
	check("it reports the seats it did not paint", crowded.some((l) => /↓ \d+ more seats?/.test(l)), crowded.slice(-8).join(" | "));
	const seatRowLines = crowded.filter((l) => /^[▸ ] [●○◌!✖] /.test(l));
	check("an empty queue renders 0q on every painted seat row", seatRowLines.length > 0 && seatRowLines.every((l) => l.includes("0q")), seatRowLines.join(" | "));
	const scrolled = frameToLines(renderTui({ seats: many, health: { seats: many, queueItems: [], attention: [] }, queueItems: [], selectedSeat: "seat13", view: "seats", width: 80, height: 16 }));
	check("the window follows the selection cursor (both-end indicators)", scrolled.some((l) => /↑ \d+ more seats?/.test(l)), scrolled.slice(2, 5).join(" | "));
	check("a seat with no item renders the em-dash brief", crowded.some((l) => l.includes("—")));
	check("a rig-wide notice (seat:null) never lands in a seat row", !frame({ health: { ...HEALTH, attention: [{ scope: "rig", seat: null, kind: "metrics-drift" }] } }).slice(2, 5).some((l) => l.includes("metrics-drift")));

	console.log("\n=== goldens: 80x24 and 44x24 ===");
	const golden80 = seatRows({ partials: PARTIALS, selectedSeat: "impl" });
	check("80x24 golden pins the three seat rows", golden80.length === 3, JSON.stringify(golden80));
	// #3941 GOLDEN UPDATES (intended, named): the roster now ABSORBS the terminal width and pads
	// every row to it, so these three strings gained the extra brief cells and the trailing pad.
	// Row 1's brief grows (the flexible cell takes the spare columns) and row 3's em-dash row is
	// padded to 80. Nothing else about the rows changed - same glyphs, same state words, same
	// queue counts, same #id.
	check(
		"80x24 golden row 1",
		golden80[0] === "▸ ● working    impl     2q       #74 merge the carry stack ont… tool complete_w…",
		JSON.stringify(golden80[0]),
	);
	check("80x24 golden row 2 (parked: the QUESTION brief)", golden80[1] === "  ◌ parked     qa       0q · 1p  #92 supervisor escalation: wh…                 ", JSON.stringify(golden80[1]));
	check("80x24 golden row 3 (idle, no item)", golden80[2] === "  ○ idle       advocate 0q       —                                              ", JSON.stringify(golden80[2]));
	const golden44 = seatRows({ width: 44, selectedSeat: "impl" });
	check("44x24 golden renders three rows at the floor", golden44.length === 3, JSON.stringify(golden44));
	// #3941: the rows now fill the declared 44 columns instead of stopping 4 cells short, so the
	// bound moves from the old content width (40) to the frame width (44). The INVARIANT is
	// unchanged: no row may exceed the declared minimum.
	check("44x24: every row fits the declared minimum", golden44.every((l) => textWidth(l) <= 44), golden44.map((l) => textWidth(l)).join(","));

	console.log("\n=== nothing overflows at ANY width 40..100 ===");
	const overflows = [];
	for (let w = 40; w <= 100; w += 1) {
		const lines = frame({ width: w, selectedSeat: "impl", partials: PARTIALS });
		const widest = Math.max(...lines.map((l) => textWidth(l)));
		if (widest > w) overflows.push(`${w}->${widest}`);
	}
	check("every frame row fits its terminal", overflows.length === 0, overflows.join(", "));

	assert.ok(true);
	console.log(
		failures === 0
			? "\nLANDING SCREEN PASS (state / queue / brief / action from ONE derivation; floor + narrow fallback; no overflow)"
			: `\nLANDING SCREEN FAIL — ${failures} check(s)`,
	);
} catch (err) {
	console.error("ERROR:", err?.message ?? err);
	failures += 1;
}

process.exit(failures === 0 ? 0 : 1);
