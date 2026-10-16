// demo/sanitize.test.mjs — H1: untrusted model/tool text must not emit terminal
// control sequences at any human render surface.
//
// FAILING-FIRST: `src/sanitize.mjs` does not exist yet, so the import below throws
// (RED). After H1 lands it imports, sanitises, and every renderer integrates (GREEN).
//
// Run: node demo/sanitize.test.mjs  (exit 0 = pass)

let failures = 0;
function check(label, condition, detail = "") {
	if (condition) {
		console.log(`  ok   ${label}`);
	} else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

try {
	console.log("\n=== H1: terminal-text sanitisation ===\n");

	const { sanitizeTerminalText } = await import("../src/sanitize.mjs");

	console.log("1. Escapes are stripped, plain text survives");
	check("OSC 52 clipboard write removed", !sanitizeTerminalText("before\x1b]52;c;aGFja2Vk\x07after").includes("\x1b"));
	check("OSC 8 hyperlink removed", !sanitizeTerminalText("see \x1b]8;;https://evil.example\x07here\x1b]8;;\x07").includes("\x1b"));
	check("OSC 0 title spoof removed", !sanitizeTerminalText("\x1b]0;spoofed\x07text").includes("\x1b"));
	check("raw clear-screen CSI removed", !sanitizeTerminalText("a\x1b[2Jb").includes("\x1b"));
	check("cursor-hide CSI removed", !sanitizeTerminalText("a\x1b[?25lb").includes("\x1b"));
	check("non-allowlisted SGR removed", !sanitizeTerminalText("\x1b[38;5;9mred").includes("\x1b"));
	check("lone ESC removed", !sanitizeTerminalText("a\x1bb").includes("\x1b"));
	check("8-bit C1 CSI introducer removed", !sanitizeTerminalText("a\u009b2Jb").includes("\u009b"));
	check("8-bit C1 OSC introducer removed", !sanitizeTerminalText("a\u009d0;spoof\u0007b").includes("\u009d"));
	check("8-bit C1 ST terminates an OSC", !sanitizeTerminalText("a\x1b]8;;x\u009cb").includes("\x1b\]"));
	check("bare C1 controls removed", !/[\u0080-\u009f]/.test(sanitizeTerminalText("a\u0085\u0090b")));
	check("an OSC aborts at an unexpected ESC (does not swallow later text)", sanitizeTerminalText("\x1b]0;x\x1b[31mred").includes("red"));
	check("C0 controls removed", !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(sanitizeTerminalText("a\x00\x07\x1bb")));
	check("plain prose unchanged", sanitizeTerminalText("hello world") === "hello world");
	check("newline and tab survive", sanitizeTerminalText("a\nb\tc") === "a\nb\tc");
	check("content around the escape is preserved", sanitizeTerminalText("before\x1b]52;c;x\x07after") === "beforeafter");
	check("null input is empty", sanitizeTerminalText(null) === "");

	console.log("\n2. The renderer's own SGR allowlist survives");
	check("bold survives", sanitizeTerminalText("a\x1b[1mb").includes("\x1b[1m"));
	check("red survives", sanitizeTerminalText("a\x1b[31mb").includes("\x1b[31m"));
	check("reset survives", sanitizeTerminalText("a\x1b[0mb").includes("\x1b[0m"));

	console.log("\n3. renderTui never emits injected escapes (TUI surface)");
	const { renderTui, frameToLines } = await import("../src/tui/client.mjs");
	const hostile = "start\x1b]52;c;cGF5bG9hZA==\x07 mid \x1b]0;pwned\x07 end \x1b[2J";
	const frame = renderTui({
		seats: [{ name: "impl", role: "engineer" }],
		turns: [{ kind: "agent", ts: 1, text: hostile }],
		health: { seats: [{ name: "impl", role: "engineer" }], queueItems: [], attention: [] },
		queueItems: [],
		width: 80,
		color: false,
	});
	const tuiJoined = frame.lines.join("\n");
	check("no OSC in the frame", !tuiJoined.includes("\x1b]"));
	check("no clear-screen in the frame", !tuiJoined.includes("\x1b[2J"));
	check("escaped literal text is visible", frameToLines(frame).join(" ").includes("mid"));
	const hostilePartial = renderTui({
		seats: [{ name: "impl", role: "engineer" }],
		turns: [],
		partial: { hasContent: true, text: "live\x1b]52;c;x\x07", thinking: null, tools: [] },
		health: { seats: [{ name: "impl", role: "engineer" }], queueItems: [], attention: [] },
		queueItems: [],
		width: 80,
		color: false,
	});
	check("no OSC in the streaming row", !hostilePartial.lines.join("\n").includes("\x1b]"));

	console.log("\n4. formatChat never emits injected escapes (log surface)");
	const { formatChat } = await import("../src/chatview.mjs");
	const chat = formatChat([{ kind: "pi.assistant", model: [{ role: "assistant", timestamp: 1, content: [{ type: "text", text: hostile }] }] }], { width: 100 });
	check("chat has no OSC", !chat.includes("\x1b]"));
	check("chat has no clear-screen", !chat.includes("\x1b[2J"));

	console.log("\n5. formatSnapshot never emits injected escapes (watch surface)");
	const { formatSnapshot } = await import("../src/watchview.mjs");
	const snap = formatSnapshot({
		db: "x.sqlite",
		health: {
			seats: [{ name: "impl", role: "engineer" }],
			queueItems: [],
			attention: [],
			streaming: { impl: { text: hostile, thinking: "", tools: [] } },
		},
	});
	check("snapshot has no OSC", !snap.includes("\x1b]"));
	check("snapshot has no clear-screen", !snap.includes("\x1b[2J"));

	console.log(failures === 0
		? "\nPASS - untrusted text is sanitised at every render surface"
		: `\nFAIL - ${failures} check(s) failed`);
} catch (err) {
	console.error("ERROR:", err);
	failures += 1;
}

process.exit(failures === 0 ? 0 : 1);
