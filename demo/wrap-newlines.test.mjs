// demo/wrap-newlines.test.mjs — ROADMAP 101: newlines are preserved in the transcript,
// long lines WRAP, and the committed turn and the live partial render the same text the
// same way.
//
// THE BUG: `src/watchview.mjs`'s `truncate()` flattens with `.replace(/\s+/g, " ")`, and
// both prose branches of `transcriptTurnLines` in `src/tui/client.mjs` rendered through it.
// So a turn of three paragraphs arrived as one run-on row, a blank line vanished, and a
// long line ended in an ellipsis. The live-partial path had its OWN wrapper, which is how
// the same text rendered one way while streaming and another way once committed.
//
// FAILING-FIRST: run this file against the unamended tree (any checkout of main before
// #3309) and it fails on the first assertion — `wrapLines` does not exist, and the
// three-line turn collapses to one line.
//
// Run: node demo/wrap-newlines.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";

import { frameToLines, renderTui } from "../src/tui/client.mjs";
import { textWidth, wrapLines } from "../src/textwidth.mjs";

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

// The turn the acceptance names: THREE lines, with a BLANK line between them.
const THREE_LINES = "first paragraph\n\nthird paragraph";
const LONG_LINE =
	"this single line of prose is deliberately longer than the eighty column viewport so that it has to wrap instead of being cut off with an ellipsis at the edge";

const seats = [{ name: "impl", role: "implementation engineer" }];
const health = { seats, queueItems: [], attention: [] };
const convo = (params) =>
	frameToLines(
		renderTui({ seats, health, selectedSeat: "impl", view: "conversation", width: 80, height: 24, ...params }),
	);
// The text rows of the turn that carries `glyph`: the glyph row plus its 4-cell hanging
// continuations and blank rows, with the gutter removed and trailing blank rows trimmed.
// (A continuation row is exactly `    text`; anything else ends the block.)
const turnBlock = (lines, glyph) => {
	const start = lines.findIndex((l) => l.includes(glyph));
	if (start < 0) return [];
	const out = [lines[start].slice(lines[start].indexOf(glyph) + 1).trimStart().trimEnd()];
	for (let i = start + 1; i < lines.length; i += 1) {
		const row = lines[i];
		if (row === "") {
			out.push("");
			continue;
		}
		if (row.startsWith("    ")) {
			out.push(row.slice(4).trimEnd());
			continue;
		}
		break;
	}
	while (out.length > 0 && out[out.length - 1] === "") out.pop();
	return out;
};

try {
	console.log("\n=== the shared wrapper: newlines and blank lines survive ===");
	check("three lines with a blank line -> three rows", JSON.stringify(wrapLines(THREE_LINES, 80)) === JSON.stringify(["first paragraph", "", "third paragraph"]), JSON.stringify(wrapLines(THREE_LINES, 80)));
	check("no row carries the whole flattened turn", wrapLines(THREE_LINES, 80).length === 3);
	check("a lone trailing newline is a terminator, not a blank row", wrapLines("a\n", 80).length === 1);
	check("empty text is one empty row", JSON.stringify(wrapLines("", 80)) === JSON.stringify([""]));

	console.log("\n=== long lines wrap; nothing is truncated ===");
	const wrapped = wrapLines(LONG_LINE, 40);
	check("wraps into several rows", wrapped.length > 1, `rows=${wrapped.length}`);
	check("no ellipsis anywhere", !wrapped.join("").includes("…"), wrapped.join("|"));
	check("no row exceeds the width", wrapped.every((l) => textWidth(l) <= 40), wrapped.map((l) => textWidth(l)).join(","));
	check("the words are all still there", wrapped.join(" ").replace(/\s+/g, " ") === LONG_LINE);
	check("a word longer than the line is hard-split, not dropped", wrapLines("x".repeat(30), 10).every((l) => textWidth(l) <= 10) && wrapLines("x".repeat(30), 10).join("") === "x".repeat(30));

	console.log("\n=== a line that FITS is returned verbatim (no reformatting) ===");
	const indented = "    const x = 1;   // two spaces before this comment";
	check("indentation and inner spacing preserved", wrapLines(indented, 80)[0] === indented, JSON.stringify(wrapLines(indented, 80)[0]));
	const wide = wrapLines("日本語のテキストは全角なので二セル", 20);
	check("CJK measured in cells", wide.every((l) => textWidth(l) <= 20), wide.map((l) => textWidth(l)).join(","));

	console.log("\n=== the COMMITTED turn keeps its three lines and its blank line (80x24 golden) ===");
	const committed = convo({ turns: [{ kind: "agent", text: THREE_LINES }] });
	const committedText = turnBlock(committed, "◀");
	check(
		"the turn renders three rows: paragraph, BLANK, paragraph",
		JSON.stringify(committedText) === JSON.stringify(["first paragraph", "", "third paragraph"]),
		JSON.stringify(committedText),
	);
	check("the blank line survived as a blank row", committedText.some((r) => r === ""));
	check("the turn did not collapse into one row", !committed.some((l) => l.includes("first paragraph third paragraph")));

	console.log("\n=== a long committed line WRAPS inside the 80-column frame ===");
	const longFrame = convo({ turns: [{ kind: "agent", text: LONG_LINE }] });
	const longRows = turnBlock(longFrame, "◀");
	check("more than one row", longRows.length > 1, `rows=${longRows.length}`);
	check("no ellipsis in the frame", !longFrame.join("\n").includes("…"));
	check("every frame row fits 80 cells", longFrame.every((l) => textWidth(l) <= 80), longFrame.filter((l) => textWidth(l) > 80).join(" | "));
	check(
		"the full text is present across the rows",
		longRows.join(" ").replace(/\s+/g, " ") === LONG_LINE,
		JSON.stringify(longRows.join(" ")),
	);

	console.log("\n=== committed and LIVE-PARTIAL render the same text the same way ===");
	const liveFrame = convo({ partial: { hasContent: true, text: LONG_LINE, thinking: "", tools: [], toolCalls: [] } });
	const liveRows = turnBlock(liveFrame, "●");
	check(
		"the live partial wraps into the same rows",
		JSON.stringify(liveRows) === JSON.stringify(longRows),
		`live=${JSON.stringify(liveRows)} committed=${JSON.stringify(longRows)}`,
	);
	const liveThree = turnBlock(convo({ partial: { hasContent: true, text: THREE_LINES, thinking: "", tools: [], toolCalls: [] } }), "●");
	check(
		"a live partial keeps its blank line too",
		JSON.stringify(liveThree) === JSON.stringify(["first paragraph", "", "third paragraph"]),
		JSON.stringify(liveThree),
	);

	console.log("\n=== the OPERATOR turn wraps as well (same bug, other branch) ===");
	const opRows = turnBlock(convo({ turns: [{ kind: "operator", text: THREE_LINES }] }), "▶");
	check(
		"operator turn keeps three rows with the blank one",
		JSON.stringify(opRows) === JSON.stringify(["first paragraph", "", "third paragraph"]),
		JSON.stringify(opRows),
	);

	assert.ok(true);
	console.log(
		failures === 0
			? "\nWRAP-NEWLINES PASS (blank lines kept, long lines wrap, committed == live partial)"
			: `\nWRAP-NEWLINES FAIL — ${failures} check(s)`,
	);
} catch (err) {
	console.error("ERROR:", err?.message ?? err);
	failures += 1;
}

process.exit(failures === 0 ? 0 : 1);
