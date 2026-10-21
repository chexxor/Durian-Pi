// demo/tui-landing-fill.test.mjs — the landing screen must FILL the terminal (#3941, FIX A)
//
// TWO INDEPENDENT DEFECTS, both in already-landed code:
//   WIDTH  — the flexible cells are capped (LANDING_FIXED_WIDTH 33 + briefCap 24 + action 16 tops a
//            row out near 74 cells) and nothing pads to the terminal width, so everything right of
//            the content is blank. A 12-seat row rendered BYTE-IDENTICAL at 80, 120 and 160 columns.
//   HEIGHT — the layout derived height from WIDTH (`Math.max(10, Math.floor(width * 0.3))` and
//            `Math.min(8, …)`), and `composeFrame` only CLIPS, never pads — so a 120x40 or 160x50
//            terminal got a ~17-row frame and 23-33 blank rows underneath.
//
// FAILING-FIRST: on the pre-fix tree every assertion in sections 1-3 fails (short frame, unpadded
// rows, byte-identical rows across widths, a capped roster). The floor assertions in section 4
// already pass and must KEEP passing — they are the reason the caps existed.
//
// Run: node demo/tui-landing-fill.test.mjs   (exit 0 = pass)

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

// 12 seats — the size the operator's report used, and enough to exercise the degrade window.
const SEATS = [
	{ name: "impl", role: "implementation engineer" },
	{ name: "qa", role: "verifier" },
	{ name: "qa2", role: "verifier" },
	{ name: "pm", role: "coordinator" },
	{ name: "scribe", role: "documentation" },
	{ name: "devtools", role: "tooling" },
	{ name: "auditor", role: "audit" },
	{ name: "architect", role: "design" },
	{ name: "designer", role: "interface design" },
	{ name: "lead", role: "technical lead" },
	{ name: "security", role: "security" },
	{ name: "advocate", role: "workflow reviewer" },
];
// Long subjects, so the brief has something to ABSORB at large widths.
const SUBJECT =
	"prepare_workspace says Forked from base ref X and leaves the worktree at MAIN, which is a false success";
const QUEUE = SEATS.map((s, i) => ({
	id: 1000 + i,
	from: "pm",
	to: s.name,
	subject: SUBJECT,
	status: i % 3 === 0 ? "claimed" : "queued",
}));
const HEALTH = { seats: SEATS, queueItems: QUEUE, attention: [] };

const frame = (params = {}) => frameToLines(renderTui({ seats: SEATS, health: HEALTH, queueItems: QUEUE, ...params }));
const roster = (lines) => {
	const start = 2;
	const end = lines.findIndex((l, i) => i > start && l.trim() === "");
	return lines.slice(start, end < 0 ? lines.length : end);
};
const seatRow = (lines, name) => roster(lines).find((l) => l.includes(name));

try {
	console.log("\n=== 1. HEIGHT: the frame fills the terminal's ROWS, not a fraction of its WIDTH ===");
	for (const [w, h] of [
		[120, 40],
		[160, 50],
		[80, 24],
	]) {
		const lines = frame({ width: w, height: h, selectedSeat: "impl" });
		check(`${w}x${h}: the frame is exactly ${h} rows`, lines.length === h, `got ${lines.length}`);
	}

	console.log("\n=== 2. WIDTH: every painted row is padded to the terminal width (no blank stripe) ===");
	for (const [w, h] of [
		[120, 40],
		[160, 50],
	]) {
		const lines = frame({ width: w, height: h, selectedSeat: "impl" });
		const short = lines.filter((l) => textWidth(l) !== w);
		check(
			`${w}x${h}: all ${lines.length} rows are exactly ${w} cells`,
			short.length === 0,
			`${short.length} row(s) off-width, first: ${JSON.stringify(short[0]?.slice(0, 60))}`,
		);
	}

	console.log("\n=== 3. The flexible cells ABSORB the extra width at large sizes ===");
	const at80 = frame({ width: 80, height: 24, selectedSeat: "impl" });
	const at160 = frame({ width: 160, height: 50, selectedSeat: "impl" });
	const r80 = seatRow(at80, "impl");
	const r160 = seatRow(at160, "impl");
	check("the seat row is NOT byte-identical at 80 and 160 columns", r80 !== r160, "the flexible cell did not grow");
	check(
		"at 160 the brief shows more of the subject than at 80",
		r160.replace(/\s+$/, "").length > r80.replace(/\s+$/, "").length,
		`80:${r80.replace(/\s+$/, "").length} 160:${r160.replace(/\s+$/, "").length}`,
	);
	check("the item id is never truncated at 160", r160.includes("#1000"), r160.slice(0, 80));

	console.log("\n=== 4. The ROSTER uses the available height: all seats painted when they fit ===");
	for (const [w, h] of [
		[120, 40],
		[160, 50],
	]) {
		const lines = frame({ width: w, height: h, selectedSeat: "impl" });
		const painted = SEATS.filter((s) => seatRow(lines, s.name)).length;
		check(`${w}x${h}: all ${SEATS.length} seats painted`, painted === SEATS.length, `painted ${painted}`);
		const indicators = lines.filter((l) => /more seat/.test(l));
		check(`${w}x${h}: no "more seats" indicator when they all fit`, indicators.length === 0, indicators.join(" | "));
	}

	console.log("\n=== 5. FLOOR DISCIPLINE preserved: no overflow across 40..160 columns ===");
	for (const w of [40, 44, 48, 60, 80, 100, 120, 160]) {
		const lines = frame({ width: w, height: 24, selectedSeat: "impl" });
		const over = lines.filter((l) => textWidth(l) > w);
		check(`${w} cols: no row exceeds the width`, over.length === 0, `${over.length} overflow, first: ${JSON.stringify(over[0]?.slice(0, 70))}`);
	}
	check(
		"44 cols still renders the landing row (the declared floor)",
		frame({ width: 44, height: 24, selectedSeat: "impl" }).some((l) => /working|idle|parked/.test(l)),
		"no landing row at 44",
	);

	console.log(
		failures === 0
			? "\nPASS — the landing screen fills the terminal in both dimensions, and the floor still holds"
			: `\nFAIL — ${failures} check(s) failed`,
	);
} catch (err) {
	console.error("ERROR:", err?.message?.slice(0, 600));
	failures += 1;
}

process.exit(failures === 0 ? 0 : 1);
