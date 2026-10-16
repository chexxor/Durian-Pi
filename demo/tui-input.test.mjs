// demo/tui-input.test.mjs — B1/H5: the type-to-seat input line and bracketed paste.
// The input line is a pure state machine (no TTY, no store), so it is tested headless.
//
// FAILING-FIRST: `src/tui/input.mjs` does not exist yet (RED). The properties that
// matter, and why:
//   - a pasted newline must NOT submit (one paste = one intent, not N);
//   - a typed `q` (or any command letter) is literal text, never a command — the
//     entrypoint stops routing keys to the driver while input mode is active;
//   - paste markers are consumed whole, and control bytes in the payload are dropped
//     so a crafted paste cannot inject a terminal sequence into the intent.
//
// Run: node demo/tui-input.test.mjs  (exit 0 = pass)

let failures = 0;
function check(label, condition, detail = "") {
	if (condition) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

try {
	console.log("\n=== B1/H5: type-to-seat input line ===\n");
	const { createInputLine, PASTE_START, PASTE_END } = await import("../src/tui/input.mjs");

	console.log("1. typing is literal text; Enter submits once");
	{
		const input = createInputLine();
		check("a typed line accumulates", input.feed("claim #624").submitted === false && input.value === "claim #624");
		check("a command letter is literal, not a command", input.feed("q").submitted === false && input.value === "claim #624q");
		check("Enter submits", input.feed("\r").submitted === true);
	}

	console.log("2. backspace edits; Esc and Ctrl+C cancel");
	{
		const input = createInputLine();
		input.feed("abc");
		input.feed("\x7f");
		check("backspace removes one character", input.value === "ab");
		check("Esc cancels", createInputLine().feed("\x1b").cancelled === true);
		check("Ctrl+C cancels", createInputLine().feed("\x03").cancelled === true);
	}

	console.log("3. bracketed paste is one literal payload, never N submits");
	{
		const input = createInputLine();
		const result = input.feed(`${PASTE_START}line one\nline two${PASTE_END}`);
		check("paste does not submit", result.submitted === false);
		check("embedded newlines become spaces (one line)", input.value === "line one line two", `got ${JSON.stringify(input.value)}`);
		check("paste mode is closed", input.pasting === false);
		check("a following Enter is the only submit", input.feed("\r").submitted === true);
	}

	console.log("4. a paste split across chunks is still one paste");
	{
		const input = createInputLine();
		input.feed("\x1b[20");
		check("an incomplete marker is buffered, not treated as text", input.value === "");
		input.feed(`0~abc${PASTE_END}`);
		check("the split paste resolves to its payload", input.value === "abc", `got ${JSON.stringify(input.value)}`);
	}

	console.log("5. control bytes in a payload cannot reach the intent");
	{
		const input = createInputLine();
		input.feed(`${PASTE_START}ok\x1b]52;c;x\x07end${PASTE_END}`);
		check("an OSC/BEL in the payload is dropped", !/[\x00-\x1f\x7f]/.test(input.value), JSON.stringify(input.value));
		check("the visible text survives", input.value.includes("ok") && input.value.includes("end"));
	}

	console.log("6. the renderer shows the input row and its key hint");
	{
		const { renderTui, frameToLines } = await import("../src/tui/client.mjs");
		const seats = [{ name: "impl", role: "engineer" }];
		const frame = renderTui({
			seats,
			turns: [],
			health: { seats, queueItems: [], attention: [] },
			queueItems: [],
			width: 80,
			color: false,
			inputText: "claim #624",
		});
		const text = frameToLines(frame).join("\n");
		check("the typed text is shown", text.includes("claim #624"));
		check("the footer advertises send/cancel", text.includes("Enter=send") && text.includes("Esc=cancel"));
	}

	console.log(failures === 0 ? "\nPASS - the input line is literal, bounded, and paste-safe" : `\nFAIL - ${failures} check(s) failed`);
} catch (err) {
	console.error("ERROR:", err);
	failures += 1;
}

process.exit(failures === 0 ? 0 : 1);
