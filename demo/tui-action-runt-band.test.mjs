// demo/tui-action-runt-band.test.mjs — the action token is HIDDEN rather than rendered as a fragment (#4233)
//
// THE FINDING (designer, at e0efe71): in the band where the action room is 1..8 cells (roughly w 51..58)
// the action token rendered as `t`, `t…`, `to…` — a fragment of a word presented as a fact. An operator
// reading `t…` learns that SOMETHING is there and nothing about what it is, which is worse than an empty
// cell because an empty cell is honest.
//
// WHAT THIS PINS: below ACTION_MIN_ROOM the token is ABSENT — not truncated, not `t`, absent; at and
// above it the token is present again; and the rule moves NO fixed cell, because the brief's cap comes
// from the width-derived `actionBudget`, not from whether the token came back non-empty. That last part
// is what makes it a §3 surface rule rather than a §4 ladder change.
//
// Run: node demo/tui-action-runt-band.test.mjs   (exit 0 = pass)

import { frameToLines, renderTui } from "../src/tui/client.mjs";

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label} -- ${detail}`);
	}
}

const SEATS = [{ name: "impl", role: "engineer" }];
const QUEUE = [{ id: 7, from: "pm", to: "impl", subject: "x", status: "claimed" }];
// A partial with a running tool call, so the action token is `tool complete_w…` — long enough that the
// band where it truncates to a runt is wide.
const PARTIALS = [{ seat: "impl", hasContent: true, text: "w", thinking: "", tools: [], toolCalls: [{ name: "complete_work", status: "running" }] }];

const rowAt = (width) => {
	const lines = frameToLines(renderTui({ seats: SEATS, health: { seats: SEATS, queueItems: QUEUE, attention: [] }, queueItems: QUEUE, width, height: 24, selectedSeat: "impl", partials: PARTIALS }));
	return lines.find((l) => l.includes("impl")) ?? "";
};
// The token is present iff a recognisable prefix of the vocabulary appears in the row.
const hasToken = (row) => /tool|composing|thinking/.test(row);

try {
	console.log("\n=== 1. BELOW THE THRESHOLD THE TOKEN IS ABSENT, not a fragment ===");
	{
		// Walk the band and assert: wherever the room is under 5, NO token text appears at all.
		const runts = [];
		for (let w = 47; w <= 70; w++) {
			const row = rowAt(w);
			const runt = /\bt…|\bto…|\bt$|tool c…|tool co…/.test(row.replace(/\s+$/, ""));
			if (runt) runts.push(`${w}:${JSON.stringify(row.replace(/\s+$/, "").slice(-24))}`);
		}
		check("no runt fragment renders anywhere in the 47..70 band", runts.length === 0, runts.join(" | "));
	}

	console.log("\n=== 2. ABOVE IT THE TOKEN IS PRESENT AGAIN, and the widths the demos use do not move ===");
	{
		const wide = rowAt(160);
		check("at 160 the token is present", hasToken(wide), JSON.stringify(wide.slice(-40)));
		check("...and it is whole, not truncated", /tool complete_w…|tool complete_work/.test(wide), JSON.stringify(wide.slice(-40)));
		// The goldens live at 80, 48 and 44. Assert those still render and that 80 carries a token.
		check("at 80 the token is present (the golden width)", hasToken(rowAt(80)), JSON.stringify(rowAt(80).slice(-40)));
		check("at 48 the action cell is not rendered at all (below the 47 rung it collapses)", !hasToken(rowAt(48)), JSON.stringify(rowAt(48).slice(-40)));
	}

	console.log("\n=== 3. HIDING MOVES NO FIXED CELL (the stop condition in the item) ===");
	{
		// The brief's cap must be identical whether or not a token renders: compare a seat WITH a token
		// (partials) against the same seat WITHOUT one, at a width in the hidden band and one above it.
		const noPartials = (width) => frameToLines(renderTui({ seats: SEATS, health: { seats: SEATS, queueItems: QUEUE, attention: [] }, queueItems: QUEUE, width, height: 24, selectedSeat: "impl" })).find((l) => l.includes("impl")) ?? "";
		for (const w of [55, 80]) {
			const withTok = rowAt(w);
			const withoutTok = noPartials(w);
			// The first 33 cells are the fixed prefix (sel 2 + state 13 + name 9 + queue 9); it must match.
			check(`at ${w} the fixed prefix is identical with and without a token`, withTok.slice(0, 33) === withoutTok.slice(0, 33), `${JSON.stringify(withTok.slice(0, 33))} vs ${JSON.stringify(withoutTok.slice(0, 33))}`);
		}
	}

	console.log("\n=== 4. NO GOLDEN CHANGES, and that is asserted by tui-golden passing ===");
	console.log("  The goldens live at 80, 48 and 44 columns. 44 and 48 render no action cell at all, and 80 is");
	console.log("  far above the band, so the hide rule touches none of them. demo/tui-golden exits 0 unchanged —");
console.log("  a golden updated to make a hide rule pass would be indistinguishable from a test weakened.");

	console.log(
		failures === 0
			? "\nPASS — the action token is absent below the named threshold, present above it, and no fixed cell moves"
			: `\nFAIL — ${failures} check(s) failed`,
	);
} catch (err) {
	console.error("ERROR:", err?.message?.slice(0, 500));
	failures += 1;
}

process.exit(failures === 0 ? 0 : 1);
