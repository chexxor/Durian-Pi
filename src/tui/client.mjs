// src/tui/client.mjs — TUI entrypoint: seat list + transcript + streaming row
// + status bar + footer.
//
// Screen model (lead #201): TuiMainScreen (full-screen session, not
// summon-choose-exit). Level 2 features deferred.
//
// This module is a PURE RENDERING layer: it takes structured data from
// readapi (store) and viewmodel (turns, partial, graph) and produces a
// frame — an array of text lines — for any given terminal width.
//
// Headless: `render(width)` returns `Frame` (lines array).
// On a real terminal, a driver would call render on resize/data/input and
// paint the result to stdout. Keyboard is validated on the operator's real
// Windows terminal; everything here is headless-in-repo.
//
// Contract: `cli.mjs` stays NON-INTERACTIVE (D21). This module is a separate
// entrypoint. log/watch/JSON surface is unchanged.

import { pad, truncate } from "../watchview.mjs";
import { formatDelta, formatArgs, themeToolRoles } from "../chatview.mjs";
import { ANSI } from "../ansi.mjs";

function formatToolName(call) {
	return call?.name ?? "tool";
}

/* ───────── Frame shape ───────── */

/**
 * A rendered TUI frame. Each frame is an array of lines; the caller paints
 * them to the terminal. `border` is a boolean indicating whether a box
 * boundary is drawn around the content (true for the main screen, false
 * for embedded rows).
 */
export class Frame {
	constructor(lines, border = false) {
		this.lines = lines;
		this.border = border;
		this.height = lines.length;
	}
	toString() {
		return this.lines.join("\n");
	}
}

/* ───────── Colour helpers (NO_COLOR / ASCII fallback) ───────── */

function paint(tone, text, color) {
	if (!color) return text;
	const codes = {
		reset: ANSI.reset,
		gray: ANSI.dim,
		red: ANSI.red,
		green: ANSI.green,
		yellow: ANSI.yellow,
		cyan: ANSI.cyan,
		magenta: ANSI.magenta,
		bold: ANSI.bold,
	};
	return `${codes[tone] ?? ""}${text}${codes.reset}`;
}

function stripColors(text) {
	return text.replace(/\x1b\[[0-9;]*m/g, "");
}

/* ───────── Core rendering ───────── */

/**
 * Render the seat list section.
 * Returns { lines, width } where width is the used character width.
 */
function renderSeatList(seats, activityMap, width) {
	if (!seats?.length) {
		return { lines: [paint("gray", "  (no seats yet)", false)], width: Math.max(18, 0) };
	}

	const maxName = Math.max(...seats.map((s) => s.name.length), 4) + 1;
	const maxRole = Math.min(20, Math.max(...seats.map((s) => (s.role ?? "").length), 4) + 1);
	const activityCol = 6 + maxName + maxRole;

	const lines = [];
	for (const seat of seats) {
		const act = activityMap?.[seat.name] ?? { glyph: "○", tone: "gray", state: "idle", focus: "" };
		const name = truncate(seat.name, maxName - 1);
		const role = truncate(seat.role ?? "", maxRole - 1);
		const head = `${paint(act.tone, act.glyph)} ${pad(name, maxName)}${pad(role, maxRole)}`;
		const focus = truncate(act.focus, width - activityCol);
		lines.push(`  ${head}${focus}`);
	}

	return { lines, width: width };
}

/**
 * Render the transcript section (last N turns).
 */
function renderTranscript(turns, collapsed, maxRows, width) {
	if (!turns?.length) {
		return { lines: [paint("gray", "  (no turns yet)", false)], height: 1 };
	}

	// Show last `maxRows` turns, newest first, but reverse order for display
	const recent = turns.slice(-maxRows);
	const lines = [];
	for (const turn of recent) {
		let marker, text;
		switch (turn.kind) {
			case "operator":
				marker = "▶";
				text = truncate(turn.text, width - 8);
				lines.push(`  ${paint("green", marker)} ${paint("bold", text)}`);
				break;
			case "agent":
				marker = "◀";
				text = truncate(turn.text, width - 8);
				lines.push(`  ${paint("cyan", marker)} ${text}`);
				break;
			case "thinking":
				marker = "◇";
				// U5: transcript matches the log (chatview formatChat): labelled
				// ("thinking ›"), and a redacted block reported as the fact it is —
				// "redacted by the provider" — never as a vague "withheld".
				text = turn.redacted && !turn.text
					? "thinking (redacted by the provider)"
					: turn.text
						? truncate(`thinking › ${turn.text.split("\n")[0]}`, width - 8)
						: "[thinking]";
				lines.push(`  ${paint("yellow", marker)} ${paint("dim", text)}`);
				break;
			case "tools":
				marker = "⚙";
				if (turn.call) {
					const callText = formatToolName(turn.call) + " " + formatArgs(turn.call.args || {}, width - 12);
					lines.push(`  ${paint("magenta", marker)} ${callText}`);
				} else if (turn.result) {
					const resText = truncate(extractResultText(turn.result), width - 8);
					lines.push(`  ${paint("gray", marker)} ${resText}`);
				}
				break;
			default:
				lines.push(`  [${turn.kind}]`);
		}
	}

	return { lines, height: lines.length };
}

/**
 * Render the streaming / partial row.
 */
function renderPartial(partial, width, { roles = null } = {}) {
	if (!partial || !partial.hasContent) {
		return { lines: [paint("gray", "  [idle]", false)], height: 1 };
	}

	const lines = [];
	// U4: tool rows carry pi's themed tool roles when a theme+tint are requested
	// (opt-in, same rule as chatview's --tool-bg); fg-only glyphs otherwise. A row's
	// tint comes from the call's status role; success/failure never rides hue alone
	// (the glyph differs: ◧/↻/✓/✗).
	const tintOf = (status, isError) => {
		if (!roles) return "";
		return isError ? roles.toolErrorBg : status === "done" ? roles.toolSuccessBg : roles.toolPendingBg;
	};
	for (const call of partial.toolCalls ?? []) {
		const callStatus = call.status;
		const isError = call.isError === true;
		const glyph = isError ? "✗" : callStatus === "done" ? "✓" : callStatus === "running" ? "↻" : "◧";
		const tone = isError ? "red" : callStatus === "done" ? "green" : callStatus === "running" ? "cyan" : "yellow";
		const tint = tintOf(callStatus, isError);
		const argsText = formatArgs(call.args || {}, Math.max(12, width - 16));
		const row = `  ${paint(tone, glyph)} ${call.name}${argsText ? ` ${paint("gray", argsText)}` : ""}`;
		lines.push(truncate(tint ? `${tint}${row}${ANSI.reset}` : row, width));
		if (call.output) {
			const first = String(call.output).split("\n")[0];
			const outRow = `      ${paint("gray", first)}`;
			lines.push(truncate(roles ? `${roles.toolOutput}${outRow}${ANSI.reset}` : outRow, width));
		}
	}
	if (partial.thinking) {
		// U5: the TUI speaks the log's words (chatview formatPartial): labelled
		// ("thinking ›"), reasoning first, and NEVER hidden because text reached the
		// frame — the log does not hide it either.
		const text = truncate(partial.thinking.split("\n")[0], width - 18);
		lines.push(`  ${paint("yellow", "◇")} ${paint("dim", "thinking ›")} ${text}`);
	} else if (partial.thinkingRedacted) {
		// U5: a redacted live block is reported with the exact phrase the log uses,
		// in both surfaces — the block exists, the body does not.
		lines.push(`  ${paint("yellow", "◇")} ${paint("dim", "thinking (redacted by the provider)")}`);
	}
	if (partial.text) {
		const text = truncate(partial.text, width - 8);
		lines.push(`  ${paint("cyan", "●")} ${text}`);
	}
	if (partial.tools?.length) {
		for (const tool of partial.tools.slice(0, 2)) {
			const line = `    ${paint("magenta", "⚙")} ${tool.name}${tool.callId ? ` (${tool.callId})` : ""}`;
			lines.push(truncate(line, width));
		}
	}

	return { lines, height: lines.length };
}

/**
 * Render the status bar.
 */
function renderStatusBar(health, seats, queueItems, width) {
	const seatCount = seats?.length ?? 0;
	const queueCount = queueItems?.length ?? 0;
	const uptime = health?.uptime != null ? `${Math.round(health.uptime / 60)}m` : "?";

	const parts = [
		paint("bold", `seats: ${seatCount}`),
		paint("bold", `queue: ${queueCount}`),
		paint("bold", `uptime: ${uptime}`),
	];

	if (health?.attention?.length) {
		for (const note of health.attention.slice(0, 3)) {
			const text = truncate(`[${note.kind}]`, width - parts.join("  ").length - 2);
			parts.push(text ? paint("yellow", text) : "");
		}
	}

	const bar = `  ── ${parts.join("  │  ")} `;
	return { lines: [bar], height: 1, width: bar.length };
}

/**
 * Render the footer (help / keybindings).
 */
function renderFooter(width) {
	const hint = " q=quit  r=refresh  ↑↓=navigate  =collapse";
	const truncated = truncate(hint, width - 4);
	const gutter = "└" + "─".repeat(Math.max(0, width - 2 - truncated.length));
	return { lines: [paint("gray", gutter + truncated)], height: 1 };
}

/**
 * Render the main screen frame.
 *
 * @param {Object} params
 * @param {Array} params.seats — from readapi.readSeatList()
 * @param {Array} params.turns — from viewmodel.buildTurns()
 * @param {Object} params.partial — from viewmodel.partialView()
 * @param {Object} params.health — from readapi.readRigHealth()
 * @param {Array} params.queueItems — from readapi.readQueueItems()
 * @param {number} params.width — terminal width (default 100)
 * @param {boolean} params.color — enable colour (default false)
 * @param {string} params.theme — "dark"|"light": pi's tool role tokens (default "dark")
 * @param {boolean} params.toolBg — OPT-IN tool-surface backgrounds (default false; identical
 *   rule to chatview's --tool-bg: a hard-coded tint misreads on unknown backgrounds)
 * @returns {Frame}
 */
export function renderTui({
	seats = [],
	turns = [],
	partial = null,
	partials = null,
	health = {},
	queueItems = [],
	width = 100,
	color = false,
	theme = "dark",
	toolBg = false,
} = {}) {
	const lines = [];

	// Header
	const seatLabel = seats?.length ? `${seats.length} seat${seats.length !== 1 ? "s" : ""}` : "no seats";
	const header = `  durig · ${seatLabel} · TUI`;
	const rule = "  " + "─".repeat(Math.max(0, Math.min(width, 80) - 4));
	lines.push(header);
	lines.push(rule);

	// Seat list (uses ~40% of height for seats)
	const mainHeight = Math.max(10, Math.floor(width * 0.3));
	const seatRows = Math.min(8, Math.max(3, Math.floor(mainHeight * 0.4)));
	const { lines: seatLines } = renderSeatList(seats, null, Math.min(width - 4, 80));
	lines.push(...seatLines);

	// Streaming / partial rows — U2: EVERY actively-generating seat at once, keyed off
	// live generation (`partialView(live).hasContent`), never queue depth. Team-wide:
	// one seat-labelled block per active seat; the legacy single `partial` argument
	// keeps working (unnamed block) so the C3 contract doesn't break.
	const active = Array.isArray(partials)
		? partials
		: partial && partial.hasContent
			? [partial]
			: [];
	if (active.length === 0) {
		const partialRows = renderPartial(partial && partial.hasContent ? partial : null, Math.min(width - 4, 80), {
			roles: color && toolBg ? themeToolRoles(theme) : null,
		});
		if (partialRows.lines.length > 0) {
			lines.push("");
			lines.push(paint("bold", "  ── streaming ──"));
			lines.push(...partialRows.lines);
		}
	} else {
		lines.push("");
		for (const p of active) {
			lines.push(paint("bold", `  ── streaming${p.seat ? `: ${p.seat}` : ""} ──`));
			const row = renderPartial(p, Math.min(width - 4, 80), {
				roles: color && toolBg ? themeToolRoles(theme) : null,
			});
			lines.push(...row.lines);
		}
	}

	// Transcript preview
	const transcriptRows = Math.min(6, Math.max(2, Math.floor(mainHeight * 0.35)));
	const { lines: transLines, height: transHeight } = renderTranscript(
		turns,
		{},
		transcriptRows,
		Math.min(width - 4, 80),
	);
	if (transLines.length > 0) {
		lines.push("");
		lines.push(paint("bold", "  ── transcript ──"));
		lines.push(...transLines);
	}

	// Status bar
	lines.push("");
	lines.push("  " + "─".repeat(Math.max(0, Math.min(width, 80) - 4)));
	const { lines: statusLines } = renderStatusBar(health, seats, queueItems, Math.min(width - 4, 80));
	lines.push(...statusLines);
	lines.push("  " + "─".repeat(Math.max(0, Math.min(width, 80) - 4)));

	// Footer
	const { lines: footerLines } = renderFooter(Math.min(width, 80));
	lines.push(...footerLines);

	const frame = new Frame(lines);
	return frame;
}

/* ───────── Helper: extract tool result text ───────── */

function extractResultText(entry) {
	const content = Array.isArray(entry?.model) ? entry.model : null;
	if (!content) return "";
	const text = content
		.filter((part) => part?.type === "text")
		.map((part) => part.text ?? "")
		.join("");
	return text.trim().slice(0, 80);
}

/* ───────── Format helpers (re-export for tests) ───────── */

export function formatTuiToolName(call) {
	return call?.name ?? "tool";
}

/* ───────── Headless frame test helper ───────── */

export function frameToLines(frame) {
	return frame.lines.map((l) => stripColors(l));
}
