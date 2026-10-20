// demo/tui-input-overlay.test.mjs — ROADMAP 99: `i` is an INPUT OVERLAY, not a third view.
//
// The bug: pressing `i` set the mode to "input"; the renderer dispatched on
// `view === "conversation"`, so typing over a conversation replaced it with the seat list
// plus an input row, and Esc/submit always returned to the seat list. The conversation —
// the thing the operator was reading — was dropped by an affordance meant to sit on top
// of it.
//
// FAILING-FIRST: `src/tui/viewmode.mjs` does not exist (RED at import), and before the
// renderer learned the overlay contract a conversation + `inputText` produced NO input row
// and the conversation footer (so `Enter=send` was absent).
//
// What is pinned, and why:
//   1. the overlay REMEMBERS the view it was opened over and RESTORES it on close — the
//      transition that was wrong (conversation in → conversation out, not seats out);
//   2. a second `i` cannot clobber the remembered view;
//   3. rendering a conversation WITH the overlay keeps the conversation frame (header,
//      turns, status) and adds the input row + the send/cancel hint;
//   4. the input row CHIPS the addressed seat — the conversation's seat over a
//      conversation, the selected seat over the list (a mis-send has no recall);
//   5. the conversation footer hint is EXACTLY the ruled 44 cells and fits whole at 48
//      cols, dropping `q=quit` first and keeping the navigation keys (designer #1115).
//
// Run: node demo/tui-input-overlay.test.mjs  (exit 0 = pass)

import { renderTui, frameToLines } from "../src/tui/client.mjs";
import { decodeKeys } from "../src/tui/driver.mjs";
import { createViewMode } from "../src/tui/viewmode.mjs";
import { textWidth } from "../src/textwidth.mjs";
import { createChecker } from "./tui-harness.mjs";

const { check, done } = createChecker("TUI input overlay (ROADMAP 99)");
console.log("\n=== TUI input overlay: `i` sits ON TOP of the view ===\n");

const seats = [
	{ name: "pm", role: "program manager" },
	{ name: "impl", role: "implementation engineer" },
];
const turns = [
	{ kind: "operator", text: "please build the thing" },
	{ kind: "agent", text: "working on it" },
];
const health = { seats, queueItems: [], attention: [], uptime: 3600 };

// ── 1. the view/overlay state machine ────────────────────────────────────────────────
console.log("1. the overlay remembers and restores the view it was opened over");
{
	const m = createViewMode();
	check("starts on the seat list", m.view === "seats" && m.mode === "seats" && m.inputting === false);

	m.openConversation();
	check("Enter opens the conversation", m.view === "conversation" && m.mode === "conversation");

	check("`i` opens the overlay", m.enterInput() === true);
	check("the overlay does NOT change the view underneath", m.view === "conversation", `view=${m.view}`);
	check("the mode reads as input while the overlay is open", m.mode === "input" && m.inputting === true);

	check(
		"THE BUG: closing the overlay over a conversation returns to the CONVERSATION",
		m.exitInput() === "conversation" && m.view === "conversation" && m.inputting === false,
		`view=${m.view}`,
	);

	// A double `i` must not overwrite the remembered view (which would strand the operator
	// on the seat list after typing over a conversation).
	m.enterInput();
	m.enterInput();
	m.exitInput();
	check("a second `i` cannot clobber the remembered view", m.view === "conversation", `view=${m.view}`);

	// Over the seat list the overlay returns to the seat list, and Esc/back still works.
	m.closeConversation();
	m.enterInput();
	check("over the seat list the overlay returns to the seat list", m.exitInput() === "seats");
	check("a stray exitInput is a harmless no-op", m.exitInput() === "seats");

	check("`i` decodes to the input request", JSON.stringify(decodeKeys("i")) === JSON.stringify(["input"]));
}

// ── 2. the conversation frame is NOT replaced while typing ───────────────────────────
console.log("\n2. typing over a conversation keeps the conversation frame");
{
	const frame = renderTui({
		seats,
		turns,
		health,
		selectedSeat: "impl",
		view: "conversation",
		width: 80,
		height: 24,
		inputText: "ship it",
	});
	const text = frameToLines(frame).join("\n");
	check("still the conversation view (header)", text.includes("impl · implementation engineer · conversation"));
	check("the operator turn survives", text.includes("please build the thing"));
	check("the agent turn survives", text.includes("working on it"));
	check("the seat list is NOT shown", !text.includes("program manager"), "the conversation was replaced by the list");
	check("the status bar survives", text.includes("seats: 2"));
	check("the input row carries the typed text", text.includes("ship it"));
	check("the input row chips the conversation's seat", text.includes("─ to impl ─"), text);
	check("the footer switches to the send/cancel hint", text.includes("Enter=send") && text.includes("Esc=cancel"));
	check("the conversation hint is not shown while typing", !text.includes("Esc=back"));
	check("the frame still fits the viewport", frame.lines.length <= 24, `lines=${frame.lines.length}`);
}

// ── 3. over the seat list the chip names the SELECTED seat ───────────────────────────
console.log("\n3. over the seat list the chip names the selected seat");
{
	const frame = renderTui({
		seats,
		turns,
		health,
		selectedSeat: "pm",
		view: "seats",
		width: 80,
		height: 24,
		inputText: "hi",
	});
	const text = frameToLines(frame).join("\n");
	check("the seat list is still shown", text.includes("program manager"));
	check("the chip names the selected seat", text.includes("─ to pm ─"), text);
	check("the typed text is shown", text.includes("hi"));
	check("the send/cancel hint is shown", text.includes("Enter=send"));
}

// ── 4. the conversation footer hint: exactly 44 cells, fits at 48 cols ───────────────
console.log("\n4. the conversation footer hint (designer #1115)");
{
	const HINT = "Esc=back  ↑↓=scroll  G=tail  i=input  q=quit";
	const footerAt = (width) => {
		const frame = renderTui({ seats, turns, health, selectedSeat: "impl", view: "conversation", width, height: 24 });
		return frameToLines(frame).at(-1);
	};

	check("the hint is exactly 44 cells", textWidth(HINT) === 44, `cells=${textWidth(HINT)}`);
	const at48 = footerAt(48);
	check("at 48 cols the FULL hint renders whole (48 − 4 = 44)", at48.endsWith(HINT), at48);
	check("at 48 cols the footer fits the viewport", textWidth(at48) <= 48, `cells=${textWidth(at48)}`);
	check("at 48 cols all five bindings are advertised", ["Esc=back", "↑↓=scroll", "G=tail", "i=input", "q=quit"].every((k) => at48.includes(k)));
	check("at 80 cols i=input is advertised", footerAt(80).includes("i=input"));
	check("`r` is NOT advertised in the conversation hint", !at48.includes("r=refresh"));

	// Under 40 cols the row is cut from the RIGHT: q=quit first, then i=input; navigation last.
	const narrow = footerAt(39);
	check("under 40 cols q=quit is dropped first", !narrow.includes("q=quit"), narrow);
	check("under 40 cols i=input is dropped before navigation", !narrow.includes("i=input"), narrow);
	check("under 40 cols the navigation keys survive", narrow.includes("Esc=back") && narrow.includes("↑↓=scroll"), narrow);
}

process.exit(done() ? 0 : 1);
