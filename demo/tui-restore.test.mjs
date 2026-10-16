// demo/tui-restore.test.mjs — H2: the terminal is restored on EVERY exit path,
// including an uncaught exception or a rejected promise, synchronously and once.
//
// FAILING-FIRST: `src/tui/restore.mjs` does not exist yet, so the import throws
// (RED). After H2 lands the screen object restores in the documented order (GREEN).
//
// Run: node demo/tui-restore.test.mjs  (exit 0 = pass)

import { readFile } from "node:fs/promises";
import { join } from "node:path";

let failures = 0;
function check(label, condition, detail = "") {
	if (condition) {
		console.log(`  ok   ${label}`);
	} else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

function fakeStdout() {
	const writes = [];
	return {
		isTTY: true,
		writes,
		write(text) {
			writes.push(text);
		},
	};
}

function fakeStdin({ isTTY = true } = {}) {
	const rawModes = [];
	return {
		isTTY,
		rawModes,
		setRawMode(mode) {
			rawModes.push(mode);
		},
	};
}

try {
	console.log("\n=== H2: terminal restore on abnormal exit ===\n");

	const mod = await import("../src/tui/restore.mjs");
	const { createTerminalScreen, ENTER_ALT, LEAVE_ALT, HIDE_CURSOR, SHOW_CURSOR, CLEAR } = mod;

	console.log("1. enter() enters the alt screen: alt + hide cursor + clear");
	{
		const stdout = fakeStdout();
		const stdin = fakeStdin();
		const screen = createTerminalScreen({ stdout, stdin });
		screen.enter();
		const joined = stdout.writes.join("");
		check("enters alt screen", joined.includes(ENTER_ALT));
		check("hides the cursor", joined.includes(HIDE_CURSOR));
		check("clears the screen", joined.includes(CLEAR));
	}

	console.log("\n2. restore() shows the cursor, leaves alt screen, restores raw mode");
	{
		const stdout = fakeStdout();
		const stdin = fakeStdin();
		const screen = createTerminalScreen({ stdout, stdin });
		screen.enter();
		const before = stdout.writes.length;
		screen.restore();
		const restored = stdout.writes.slice(before).join("");
		check("shows the cursor", restored.includes(SHOW_CURSOR));
		check("leaves the alt screen", restored.includes(LEAVE_ALT));
		check("cursor-shown precedes alt-leave", restored.indexOf(SHOW_CURSOR) < restored.indexOf(LEAVE_ALT));
		check("raw mode turned off", stdin.rawModes.at(-1) === false);
	}

	console.log("\n3. restore() is idempotent (a second call writes nothing)");
	{
		const stdout = fakeStdout();
		const stdin = fakeStdin();
		const screen = createTerminalScreen({ stdout, stdin });
		screen.enter();
		screen.restore();
		const afterFirst = stdout.writes.length;
		const rawAfterFirst = stdin.rawModes.length;
		screen.restore();
		check("no further stdout writes", stdout.writes.length === afterFirst);
		check("no further raw-mode calls", stdin.rawModes.length === rawAfterFirst);
	}

	console.log("\n4. restore() survives a dead stdout (an abnormal exit)");
	{
		const stdout = { isTTY: true, dead: false, write() { if (this.dead) throw new Error("EPIPE"); } };
		const stdin = fakeStdin();
		const screen = createTerminalScreen({ stdout, stdin });
		screen.enter();
		stdout.dead = true;
		let threw = false;
		try {
			screen.restore();
		} catch {
			threw = true;
		}
		check("restore does not rethrow", !threw);
		check("raw mode still restored after a write failure", stdin.rawModes.at(-1) === false);
	}

	console.log("\n5. non-TTY streams: no escapes, raw mode left alone");
	{
		const stdout = { isTTY: false, writes: [], write(t) { this.writes.push(t); } };
		const stdin = fakeStdin({ isTTY: false });
		const screen = createTerminalScreen({ stdout, stdin });
		screen.enter();
		screen.restore();
		check("no escapes written to a non-TTY stdout", stdout.writes.join("") === "");
		check("no raw-mode call on a non-TTY stdin", stdin.rawModes.length === 0);
	}

	console.log("\n6. ui.mjs wires every abnormal-exit handler to the restore");
	{
		const source = await readFile(join(process.cwd(), "ui.mjs"), "utf8");
		check("handles uncaughtException", source.includes("uncaughtException"));
		check("handles unhandledRejection", source.includes("unhandledRejection"));
		check("handles exit", /process\.on\(\s*["']exit["']/.test(source));
		check("uses the shared restore module", source.includes("restore.mjs"));
	}

	console.log(failures === 0
		? "\nPASS - the terminal is restored on every exit path"
		: `\nFAIL - ${failures} check(s) failed`);
} catch (err) {
	console.error("ERROR:", err);
	failures += 1;
}

process.exit(failures === 0 ? 0 : 1);
