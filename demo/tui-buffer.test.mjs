// demo/tui-buffer.test.mjs — Tier 2 mechanics: the screen buffer measures in cells,
// detects overflow, and resizes (docs/TUI-TESTING.md). The golden test proves the
// frames; this proves the instrument that compares them.
//
// Run: node demo/tui-buffer.test.mjs  (exit 0 = pass)

import { ScreenBuffer, cellWidth, displayWidth, createChecker } from "./tui-harness.mjs";

const { check, done } = createChecker("TUI screen buffer");
console.log("\n=== TUI screen buffer (Tier 2 mechanics) ===\n");

console.log("1. cell width");
check("ASCII letters are one cell each", cellWidth("abc") === 3);
check("a CJK ideograph is two cells", cellWidth("界") === 2);
check("an emoji is two cells", cellWidth("🙂") === 2);
check("a combining mark adds nothing", cellWidth("e\u0301") === 1);
check("ANSI is not counted", displayWidth("\x1b[31mred\x1b[0m") === 3);
check("mixed CJK/ASCII sums", cellWidth("a界b") === 4);

console.log("\n2. paint + right-trim");
{
	const buffer = new ScreenBuffer(20, 3);
	buffer.paint(["hello   ", "world"]);
	check("trailing spaces are trimmed", buffer.toLines()[0] === "hello");
	check("content is preserved", buffer.toLines()[1] === "world");
	check("short frames keep their row count", buffer.toLines().length === 2);
}

console.log("\n3. overflow detection");
{
	const buffer = new ScreenBuffer(10, 2);
	buffer.paint(["1234567890", "12345678901", "x", "y"]);
	check("a cell overflow is counted", buffer.overflowCells === 1, `got ${buffer.overflowCells}`);
	check("row overflow is counted (two rows past the height)", buffer.overflowRows === 2, `got ${buffer.overflowRows}`);
	const wide = new ScreenBuffer(4, 2);
	wide.paint(["界界界"]); // three double-width cells = 6 > 4
	check("wide glyphs overflow by real cells", wide.overflowCells === 2, `got ${wide.overflowCells}`);
}

console.log("\n4. resize changes the shape");
{
	const buffer = new ScreenBuffer(80, 24);
	buffer.resize(40, 10);
	check("width updated", buffer.width === 40);
	check("height updated", buffer.height === 10);
	buffer.resize(4, 10);
	buffer.paint(["界界界"]);
	check("overflow is measured against the NEW width", buffer.overflowCells === 2, `got ${buffer.overflowCells}`);
}

process.exit(done() ? 0 : 1);
