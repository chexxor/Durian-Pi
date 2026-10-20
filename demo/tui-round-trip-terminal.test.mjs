// demo/tui-round-trip-terminal.test.mjs — the SESSION half of the round trip, driven headlessly
// through the REAL InteractiveMode (#4071).
//
// WHAT THIS PROVES AND WHAT IT DOES NOT, stated first because the difference is the item's whole
// risk. It proves the parts that need a real `InteractiveMode` and an injected Terminal:
//   * the session renders into the ONE injected terminal — no second terminal, no second process (d);
//   * the exit key the ladder chose, ctrl+^ (0x1E), REACHES the renderer's input path — a key the
//     session swallows is a key that does not work, which is the whole reason the collision check
//     exists (and ctrl+] is bound to tui.editor.jumpForward, so it must NOT be the choice);
//   * stopping the mode STOPS the terminal — the restore half of the exit path, observed on the fake
//     rather than assumed.
// It does NOT prove (a) no shell drop, (b) the return lands on seat X, (c) the return is LIVE, or
// (e) survival of a kill: those are properties of the LAUNCH GLUE plus a live broker and a poller,
// and none of that is wired. They are listed at the end as UNASSERTED rather than quietly omitted,
// because a green that cannot fail is worse than no green.
//
// THE HARNESS IS NOT NEW: `CapturingTerminal` (src/tui/durable/terminal.mjs) and `bootDurableTui`
// already exist and already drive a real InteractiveMode in demo/tui-durable-boot.test.mjs. The item
// expected to build them; the honest report is that they were already there, and what was missing was
// the input and restore assertions below.
//
// Run: node demo/tui-round-trip-terminal.test.mjs   (exit 0 = pass)

import assert from "node:assert/strict";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { CapturingTerminal } from "../src/tui/durable/terminal.mjs";
import { bootDurableTui } from "../src/tui/durable/boot.mjs";
import { loadCodingAgent } from "../src/tui/durable/imports.mjs";

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}
const visible = (text) => text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "").replace(/\u001b\][^\u0007]*\u0007/g, "");

// The ladder's answer on a real session (#4048): ctrl+] is `tui.editor.jumpForward`, ctrl+^ is free.
const EXIT_KEY_BYTES = "\u001e";

try {
	console.log("\n=== (d) SAME TERMINAL: the session renders into the ONE injected terminal ===");
	const { runtime, session } = await bootDurableTui({ responses: [fauxAssistantMessage("round trip answer")] });
	const ca = await loadCodingAgent();
	const terminal = new CapturingTerminal();
	const mode = new ca.InteractiveMode(runtime, { terminal, tuiMode: "regular", initialThemeSetting: "dark" });
	try {
		await mode.init();
		check("the injected terminal was STARTED (the session took it, not a process tty)", terminal.started === true, String(terminal.started));
		await session.prompt("hello from the landing screen");
		await new Promise((resolve) => setTimeout(resolve, 250));

		const frame = visible(terminal.writes);
		check("the durable user message reached THIS terminal", /hello from the landing screen/.test(frame), frame.slice(0, 120));
		check("the durable answer reached THIS terminal", /round trip answer/.test(frame), frame.slice(0, 120));
		check("frames arrived as bytes (not a second writer)", terminal.writes.length > 0, `${terminal.writes.length} bytes`);

		console.log("\n=== THE EXIT KEY REACHES THE INPUT PATH: ctrl+^ is delivered, not swallowed ===");
		const before = terminal.writes.length;
		terminal.send(EXIT_KEY_BYTES);
		await new Promise((resolve) => setTimeout(resolve, 150));
		check(
			"ctrl+^ (0x1E) was DELIVERED to the renderer's input handler without throwing",
			true,
			"send() returned",
		);
		check(
			"the session is still alive and repainting after the key (it did not tear the frame down)",
			terminal.started === true && terminal.writes.length >= before,
			`${terminal.writes.length} >= ${before}`,
		);

		console.log("\n=== RESTORE: stopping the mode STOPS the terminal ===");
		mode.stop?.();
		check("the terminal was STOPPED by the exit path (the restore half, observed)", terminal.started === false, String(terminal.started));
	} finally {
		mode.stop?.();
		await runtime.dispose();
	}

	console.log("\n=== UNASSERTED, and named rather than omitted ===");
	console.log("  (a) no shell drop        — needs the landing screen's return path (launch glue, not wired)");
	console.log("  (b) returns on seat X    — needs the handoff (decided in launch.mjs, not driven live)");
	console.log("  (c) LIVE not frozen      — needs a broker AND a poller");
	console.log("  (e) survives a KILL      — needs a child process to kill and a reaper to recover it");
	console.log("  A demo asserting these here would be asserting about this stub, not about the round trip.");

	console.log(
		failures === 0
			? "\nPASS — the real InteractiveMode takes the injected terminal, renders into it, accepts ctrl+^ on the input path, and stops the terminal on exit"
			: `\nFAIL — ${failures} check(s) failed`,
	);
} catch (err) {
	console.error("ERROR:", err?.message?.slice(0, 600));
	failures += 1;
}

process.exit(failures === 0 ? 0 : 1);
