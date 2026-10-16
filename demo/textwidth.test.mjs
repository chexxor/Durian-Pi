// demo/textwidth.test.mjs — H4: width is measured in terminal CELLS, not JS code
// units, for CJK, emoji (incl. ZWJ/keycap/flags), Hangul jamo, combining marks and
// variation selectors. Vectors lifted from vendor/eval/string-width/test.js.
//
// FAILING-FIRST: src/textwidth.mjs does not exist yet (RED).
//
// Run: node demo/textwidth.test.mjs  (exit 0 = pass)

import { textWidth, sliceToWidth } from "../src/textwidth.mjs";
import { truncate, pad } from "../src/watchview.mjs";
import { renderTui } from "../src/tui/client.mjs";
import { ScreenBuffer, createChecker, fixtureTurns, health, seats, turns } from "./tui-harness.mjs";

const { check, done } = createChecker("cell-width measurement");
console.log("\n=== H4: cell-width measurement ===\n");

console.log("1. basic and East-Asian width");
for (const [input, expected] of [
	["", 0],
	["a", 1],
	["hello world", 11],
	["你好", 4],
	["hello世界", 9],
	["한국어", 6],
	["ㄱ", 2],
]) {
	check(`${JSON.stringify(input)} = ${expected}`, textWidth(input) === expected, `got ${textWidth(input)}`);
}
check("ambiguous is narrow by default", textWidth("±") === 1);
check("ambiguous can be wide", textWidth("±", { ambiguousIsNarrow: false }) === 2);

console.log("\n2. controls are zero-width; ANSI is ignored");
check("tab is zero width", textWidth("\t") === 0);
check("newline is zero width", textWidth("\n") === 0);
check("control in text", textWidth("a\u0001b") === 2);
check("malformed surrogate is zero width", textWidth("\uD800") === 0);
check("ANSI SGR is not counted", textWidth("\u001B[31mred\u001B[0m") === 3);
check("ANSI with emoji", textWidth("\u001B[32m✅ Pass\u001B[0m") === 7);

console.log("\n3. emoji, ZWJ, keycap, flags");
for (const [input, expected] of [
	["😀", 2],
	["a😀b", 4],
	["👋🏽", 2],
	["👨‍👩‍👧‍👦", 2],
	["1️⃣", 2],
	["🇺🇸", 2],
	["Hello 👋 世界", 13],
]) {
	check(`${JSON.stringify(input)} = ${expected}`, textWidth(input) === expected, `got ${textWidth(input)}`);
}

console.log("\n4. variation selectors and narrow symbols");
check("emoji with VS16 is wide", textWidth("⚡\uFE0F") === 2);
check("warning with VS15 is narrow", textWidth("⚠\uFE0E") === 1);
check("warning with VS16 is wide", textWidth("⚠\uFE0F") === 2);
check("heart suit stays narrow", textWidth("♥") === 1);

console.log("\n5. combining marks and Hangul jamo");
check("combining mark joins its base", textWidth("e\u0301") === 1);
check("combining marks alone are zero", textWidth("\u0301\u0302") === 0);
check("enclosing mark adds nothing", textWidth("a\u20DD") === 1);
check("combining with full-width", textWidth("東京\u0301") === 4);
check("decomposed Hangul syllable", textWidth("가") === 2);
check("repeated leading jamo stay additive", textWidth("ᄀᄀ") === 4);
check("halfwidth kana with dakuten", textWidth("ﾊﾞ") === 2);

console.log("\n6. sliceToWidth never splits a cluster and stops on a cell");
check("ASCII slice", sliceToWidth("hello", 3) === "hel");
check("CJK slice stops before a wide glyph", sliceToWidth("你好世界", 3) === "你");
check("zero cells is empty", sliceToWidth("abc", 0) === "");
check("a combining mark stays with its base", sliceToWidth("e\u0301x", 1) === "e\u0301");
check("a ZWJ emoji stays whole", sliceToWidth("👨‍👩‍👧‍👦abc", 2) === "👨‍👩‍👧‍👦");
check("slice respects a narrower budget", sliceToWidth("你好世界", 2) === "你");

console.log("\n7. renderers use cells");
check("truncate stops on a cell boundary", truncate("你好世界", 3) === "你…");
check("truncate leaves a fitting string alone", truncate("你好", 4) === "你好");
check("pad pads by cells, not code units", pad("你", 4) === "你  ");

console.log("\n8. integration: a CJK frame never overflows the viewport");
{
	const cjkTurns = [turns.operator("请检查队列"), turns.agent("世界🙂" + "很长的文字".repeat(6)), ...fixtureTurns()];
	const frame = renderTui({
		seats: seats(),
		health: health(),
		queueItems: [],
		turns: cjkTurns,
		width: 48,
		height: 24,
		view: "conversation",
		selectedSeat: "impl",
	});
	const buffer = new ScreenBuffer(48, 24).paint(frame.lines);
	check("the CJK conversation frame fits 48 columns", buffer.overflowCells === 0 && buffer.overflowRows === 0, `cells=${buffer.overflowCells} rows=${buffer.overflowRows}`);
	check("the CJK prose is present", frame.lines.join("\n").includes("世界"));
}

process.exit(done() ? 0 : 1);
