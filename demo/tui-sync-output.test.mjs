// demo/tui-sync-output.test.mjs — H3: each frame is wrapped in DECSET 2026
// (synchronized output) so the terminal draws it atomically, and the wrapper is
// disabled when the terminal cannot do it or the operator opts out.
//
// FAILING-FIRST: src/tui/sync.mjs and src/tui/paint.mjs do not exist yet (RED).
//
// Run: node demo/tui-sync-output.test.mjs  (exit 0 = pass)

import { readFile } from "node:fs/promises";
import { join } from "node:path";

let failures = 0;
function check(label, condition, detail = "") {
	if (condition) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

try {
	console.log("\n=== H3: synchronized output (DECSET 2026) ===\n");

	const { createSyncState, SYNC_START, SYNC_END, SYNC_QUERY } = await import("../src/tui/sync.mjs");
	const { composeFrame } = await import("../src/tui/paint.mjs");

	console.log("1. default on a TTY; wrapping preserves the frame");
	{
		const sync = createSyncState({ isTTY: true, env: {} });
		check("enabled by default on a TTY", sync.enabled === true);
		check("start sequence is DECSET 2026 h", SYNC_START === "\x1b[?2026h");
		check("end sequence is DECSET 2026 l", SYNC_END === "\x1b[?2026l");
		const wrapped = sync.wrap("FRAME");
		check("frame is wrapped start+end", wrapped === `${SYNC_START}FRAME${SYNC_END}`);
		check("query is the DECRQM request", SYNC_QUERY === "\x1b[?2026$p");
	}

	console.log("\n2. disabled without a TTY or on opt-out");
	{
		check("non-TTY disables the wrapper", createSyncState({ isTTY: false, env: {} }).enabled === false);
		check("DURIG_TUI_NO_SYNC disables it", createSyncState({ isTTY: true, env: { DURIG_TUI_NO_SYNC: "1" } }).enabled === false);
		const off = createSyncState({ isTTY: false, env: {} });
		check("disabled wrap is identity", off.wrap("FRAME") === "FRAME");
	}

	console.log("\n3. the DECRQM reply is honoured, then removed from input");
	{
		const sync = createSyncState({ isTTY: true, env: {} });
		const kept = sync.consume("abc\x1b[?2026;1$ydef");
		check("a supported reply keeps it enabled", sync.enabled === true);
		check("the reply is stripped from the chunk", kept === "abcdef");
		const unsupported = createSyncState({ isTTY: true, env: {} });
		unsupported.consume("\x1b[?2026;0$y");
		check(";0$y (not recognised) disables it", unsupported.enabled === false);
		const perm = createSyncState({ isTTY: true, env: {} });
		perm.consume("\x1b[?2026;4$y");
		check(";4$y (permanently reset) disables it", perm.enabled === false);
	}

	console.log("\n4. composeFrame clips to height and wraps only when enabled");
	{
		const lines = ["one", "two", "three"];
		const noSync = createSyncState({ isTTY: false, env: {} });
		const yesSync = createSyncState({ isTTY: true, env: {} });
		const plain = composeFrame(lines, { height: 2, sync: noSync });
		const wrapped = composeFrame(lines, { height: 2, sync: yesSync });
		check("clipped to the terminal height", plain.includes("three") === false && plain.includes("two"));
		check("starts with home+clear", plain.startsWith("\x1b[H\x1b[2J"));
		check("sync frame is wrapped", wrapped.startsWith("\x1b[?2026h") && wrapped.endsWith("\x1b[?2026l"));
		check("content is identical once the wrapper is removed", wrapped.slice(SYNC_START.length, -SYNC_END.length) === plain);
		check("composeFrame tolerates a missing sync", composeFrame(lines, { height: 2 }) === plain);
	}

	console.log("\n5. ui.mjs wires the sync state and the query");
	{
		const source = await readFile(join(process.cwd(), "ui.mjs"), "utf8");
		check("ui.mjs imports the sync module", source.includes("tui/sync.mjs"));
		check("ui.mjs sends the DECRQM query", source.includes("SYNC_QUERY"));
		check("ui.mjs composes through composeFrame", source.includes("composeFrame"));
	}

	console.log(failures === 0 ? "\nPASS - synchronized output is enabled when supported" : `\nFAIL - ${failures} check(s) failed`);
} catch (err) {
	console.error("ERROR:", err);
	failures += 1;
}

process.exit(failures === 0 ? 0 : 1);
