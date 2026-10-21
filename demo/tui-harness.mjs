// demo/tui-harness.mjs — shared fixtures, a screen buffer, and golden helpers for
// the TUI regression tests (docs/TUI-TESTING.md). Not a test: imported by
// demo/tui-*.test.mjs.
//
// Why a buffer and goldens: substring assertions on frame.lines cannot catch a row
// that overflows the viewport by one cell or a layout shift, which is exactly how a
// wrapping/width regression ships. ratatui's TestBackend and bubbletea's golden
// files converge on the same idea (vendor/eval/).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { textWidth } from "../src/textwidth.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const GOLDEN_DIR = join(HERE, "__golden__");

/* ───────── a tiny check runner (one style for the new tests) ───────── */

export function createChecker(label) {
	let failures = 0;
	function check(name, condition, detail = "") {
		if (condition) console.log(`  ok   ${name}`);
		else {
			failures += 1;
			console.log(`  FAIL ${name}${detail ? ` -- ${detail}` : ""}`);
		}
	}
	return {
		check,
		get failures() {
			return failures;
		},
		done() {
			console.log(failures === 0 ? `\nPASS - ${label}` : `\nFAIL - ${failures} check(s) failed`);
			return failures === 0;
		},
	};
}

/* ───────── fixtures ───────── */

export function seat(name, role = "engineer") {
	return { name, role };
}

export function seats() {
	return [
		seat("pm", "program manager"),
		seat("impl", "implementation engineer"),
		seat("qa", "independent verifier"),
		seat("lead", "technical lead"),
	];
}

export function health(extra = {}) {
	return {
		seats: extra.seats ?? seats(),
		queueItems: extra.queueItems ?? [],
		attention: extra.attention ?? [],
		uptime: extra.uptime ?? 3600,
		streaming: extra.streaming ?? {},
	};
}

export function toolResult(name, text, isError = false) {
	return { kind: "pi.tool-result", model: [{ toolName: name, isError, content: [{ type: "text", text }] }] };
}

export const turns = {
	operator: (text) => ({ kind: "operator", ts: 1000, text }),
	agent: (text) => ({ kind: "agent", ts: 1001, text }),
	thinking: (text, redacted = false) => ({ kind: "thinking", ts: 1002, text, redacted }),
	tool: (name, args, { resultText = "", isError = false } = {}) => ({
		kind: "tools",
		ts: 1003,
		call: { name, args },
		result: resultText ? toolResult(name, resultText, isError) : null,
	}),
};

export function fixtureTurns() {
	return [
		turns.operator("Please check the queue."),
		turns.thinking("Read the queue, then claim the oldest item."),
		turns.agent("I will check the queue now."),
		turns.tool("peek_queue", { all: true }, { resultText: "#624 init\n#662 tui close-out" }),
	];
}

export function partial(fields = {}) {
	return {
		attempt: 1,
		text: "checking the queue",
		thinking: null,
		thinkingRedacted: false,
		toolCalls: [],
		tools: [],
		hasContent: true,
		...fields,
	};
}

/* ───────── cell width (H4: the real measurement) ───────── */

// Delegate to src/textwidth.mjs so the buffer measures exactly what the renderers do;
// a second width implementation here would drift from the one under test.
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

export function visibleText(line) {
	return String(line ?? "").replace(ANSI_RE, "");
}

export function cellWidth(text) {
	return textWidth(text);
}

export function displayWidth(line) {
	return textWidth(line);
}

/* ───────── screen buffer ───────── */

export class ScreenBuffer {
	constructor(width, height) {
		this.width = width;
		this.height = height;
		this.rows = [];
		this.overflowCells = 0;
		this.overflowRows = 0;
	}

	/** Paint a frame's lines; record any row wider or taller than the viewport. */
	paint(lines) {
		this.rows = [];
		this.overflowCells = 0;
		this.overflowRows = 0;
		(lines ?? []).forEach((line, i) => {
			const w = displayWidth(line);
			if (w > this.width) this.overflowCells += w - this.width;
			if (i >= this.height) this.overflowRows += 1;
			this.rows.push(line);
		});
		return this;
	}

	resize(width, height) {
		this.width = width;
		this.height = height;
		return this;
	}

	toLines() {
		return this.rows.map((l) => l.replace(/[ ]+$/, ""));
	}

	toString() {
		return this.toLines().join("\n");
	}
}

/* ───────── golden frames ───────── */

export function readGolden(name) {
	const file = join(GOLDEN_DIR, `${name}.txt`);
	if (!existsSync(file)) return null;
	// #3941: strip exactly ONE terminating newline (the writer appends exactly one), not every
	// trailing newline. The old `\n+$` made a frame ending in BLANK ROWS unrepresentable: the
	// expected side lost its trailing blanks while the actual kept them, so a golden could never
	// pin a screen that fills its viewport. A blank row is content here, not a file terminator.
	return readFileSync(file, "utf8").replace(/\r\n/g, "\n").replace(/\n$/, "");
}

/**
 * Compare rendered lines to a committed golden. `UPDATE_GOLDEN=1` writes the golden
 * instead of failing, so a layout change is an explicit, reviewable diff.
 * Returns { ok, updated, missing, file, expected, actual }.
 */
export function compareGolden(actualLines, name, { update = Boolean(process.env.UPDATE_GOLDEN) } = {}) {
	const file = join(GOLDEN_DIR, `${name}.txt`);
	const actual = (Array.isArray(actualLines) ? actualLines : [String(actualLines)]).join("\n");
	if (update) {
		mkdirSync(GOLDEN_DIR, { recursive: true });
		writeFileSync(file, `${actual}\n`);
		return { ok: true, updated: true, missing: false, file, expected: actual, actual };
	}
	const expected = readGolden(name);
	if (expected === null) return { ok: false, updated: false, missing: true, file, expected: "", actual };
	return { ok: expected === actual, updated: false, missing: false, file, expected, actual };
}

/** A compact line-by-line diff for failure output. */
export function goldenDiff(expected, actual) {
	const e = String(expected).split("\n");
	const a = String(actual).split("\n");
	const lines = [];
	for (let i = 0; i < Math.max(e.length, a.length); i++) {
		if (e[i] !== a[i]) lines.push(`  line ${i + 1}:\n    expected: ${JSON.stringify(e[i] ?? null)}\n    actual:   ${JSON.stringify(a[i] ?? null)}`);
	}
	return lines.join("\n");
}
