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
import { sanitizeTerminalText } from "../sanitize.mjs";
import { textWidth, sliceToWidth, firstCluster } from "../textwidth.mjs";

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
		reverse: ANSI.reverse,
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
function renderSeatList(seats, activityMap, width, selectedSeat = null, color = false) {
	if (!seats?.length) {
		return { lines: [paint("gray", "  (no seats yet)", color)], width: Math.max(18, 0) };
	}

	const maxName = Math.max(...seats.map((s) => s.name.length), 4) + 1;
	const maxRole = Math.min(20, Math.max(...seats.map((s) => (s.role ?? "").length), 4) + 1);
	const activityCol = 6 + maxName + maxRole;

	const lines = [];
	for (const seat of seats) {
		const act = activityMap?.[seat.name] ?? { glyph: "○", tone: "gray", state: "idle", focus: "" };
		const name = truncate(sanitizeTerminalText(seat.name), maxName - 1);
		const role = truncate(sanitizeTerminalText(seat.role ?? ""), maxRole - 1);
		const head = `${paint(act.tone, act.glyph, color)} ${pad(name, maxName)}${pad(role, maxRole)}`;
		const focus = truncate(sanitizeTerminalText(act.focus), width - activityCol);
		// The selected row is marked with a cursor glyph in place of the leading
		// space, so selection adds no width and every row keeps one 2-cell gutter.
		const isSelected = selectedSeat !== null && seat.name === selectedSeat;
		const cursor = isSelected ? "▸" : " ";
		const row = `${cursor} ${head}${focus}`;
		// Selection is reverse video + bold (the skill's canonical, most-readable
		// current-row signal — see references/visual-patterns.md), reinforced by the
		// ▸ glyph so it still reads in monochrome / NO_COLOR.
		lines.push(isSelected ? paint("reverse", paint("bold", row, color), color) : row);
	}

	return { lines, width: width };
}

/**
 * Wrap prose to `width` cells instead of truncating it. The conversation view is a
 * reading surface for a live stream: a single long assistant line must be readable
 * across the viewport, not cut off with an ellipsis (the skill's "truncate, do not
 * wrap" rule is for tables; a conversation is prose).
 */
function wrapText(text, width) {
	const flat = String(text ?? "").replace(/\s+/g, " ").trim();
	const w = Math.max(1, width);
	if (textWidth(flat) <= w) return [flat];
	const out = [];
	let line = "";
	for (const word of flat.split(" ")) {
		if (textWidth(word) > w) {
			// Hard-split a token longer than the line (a URL or id) so it cannot
			// silently overflow the frame. Cut by cells, never through a grapheme.
			if (line !== "") {
				out.push(line);
				line = "";
			}
			let rest = word;
			while (textWidth(rest) > w) {
				const chunk = sliceToWidth(rest, w) || firstCluster(rest);
				out.push(chunk);
				rest = rest.slice(chunk.length);
			}
			line = rest;
			continue;
		}
		if (line === "") line = word;
		else if (textWidth(`${line} ${word}`) <= w) line += ` ${word}`;
		else {
			out.push(line);
			line = word;
		}
	}
	if (line !== "") out.push(line);
	return out.length > 0 ? out : [""];
}

/**
 * The display lines for one conversation turn. Kept separate from the transcript
 * window so the conversation view can budget by LINES, not turns: a tools or thinking
 * turn renders several lines, and a turn-count budget silently overflows the viewport.
 */
function transcriptTurnLines(turn, width, color) {
	const lines = [];
	switch (turn.kind) {
		case "operator": {
			const text = truncate(sanitizeTerminalText(turn.text), width - 8);
			lines.push(`  ${paint("green", "▶", color)} ${paint("bold", text, color)}`);
			break;
		}
		case "agent": {
			const text = truncate(sanitizeTerminalText(turn.text), width - 8);
			lines.push(`  ${paint("cyan", "◀", color)} ${text}`);
			break;
		}
		case "thinking": {
			// U5: transcript matches the log (chatview formatChat): labelled
			// ("thinking ›"), and a redacted block reported as the fact it is —
			// "redacted by the provider" — never as a vague "withheld".
			const thinkingText = sanitizeTerminalText(turn.text);
			const text = turn.redacted && !thinkingText
				? "thinking (redacted by the provider)"
				: thinkingText
					? truncate(`thinking › ${thinkingText.split("\n")[0]}`, width - 8)
					: "[thinking]";
			lines.push(`  ${paint("yellow", "◇", color)} ${paint("dim", text, color)}`);
			break;
		}
		case "tools":
			if (turn.call) {
				const callText = sanitizeTerminalText(formatToolName(turn.call) + " " + formatArgs(turn.call.args || {}, width - 12));
				lines.push(`  ${paint("magenta", "⚙", color)} ${callText}`);
			} else if (turn.result) {
				const resText = truncate(sanitizeTerminalText(extractResultText(turn.result)), width - 8);
				lines.push(`  ${paint("gray", "⚙", color)} ${resText}`);
			}
			break;
		default:
			lines.push(`  [${turn.kind}]`);
	}
	return lines;
}

/**
 * Render a window of turns. `maxLines > 0` bounds the result by DISPLAY LINES — the
 * conversation view's fit guarantee: turns accumulate newest-first and the ones that
 * do not fit are reported as hidden above. `maxLines === 0` keeps the turn-bounded
 * behavior the seats view uses.
 */
function renderTranscript(turns, collapsed, maxRows, width, color = false, scroll = 0, maxLines = 0) {
	if (!turns?.length) {
		return { lines: [paint("gray", "  (no turns yet)", color)], height: 1, above: 0, below: 0 };
	}

	// `scroll` counts turns back from the newest, so ↑ (scroll+1) reveals older turns
	// and ↓ (scroll-1) returns to the live tail. Clamped: a negative or oversized
	// scroll must never slice past either end.
	const end = Math.max(0, turns.length - Math.max(0, scroll));
	const start = Math.max(0, end - maxRows);
	const window = turns.slice(start, end);
	const lines = [];
	let dropped = 0;
	if (maxLines > 0) {
		const buckets = window.map((turn) => transcriptTurnLines(turn, width, color));
		let used = 0;
		for (let i = buckets.length - 1; i >= 0; i--) {
			if (used + buckets[i].length > maxLines && lines.length > 0) {
				dropped = i + 1;
				break;
			}
			lines.unshift(...buckets[i]);
			used += buckets[i].length;
		}
	} else {
		for (const turn of window) lines.push(...transcriptTurnLines(turn, width, color));
	}
	const above = start + dropped; // turns hidden above the window (older or trimmed for fit)
	const below = Math.max(0, turns.length - end); // turns hidden below (newer)
	return { lines, height: lines.length, above, below };
}

/**
 * Render the streaming / partial row.
 */
function renderPartial(partial, width, { roles = null, color = false, wrap = false } = {}) {
	if (!partial || !partial.hasContent) {
		return { lines: [paint("gray", "  [idle]", color)], height: 1 };
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
		const argsText = sanitizeTerminalText(formatArgs(call.args || {}, Math.max(12, width - 16)));
		const nameText = sanitizeTerminalText(call.name ?? "tool");
		const row = `  ${paint(tone, glyph, color)} ${nameText}${argsText ? ` ${paint("gray", argsText, color)}` : ""}`;
		lines.push(truncate(tint ? `${tint}${row}${ANSI.reset}` : row, width));
		if (call.output) {
			const first = sanitizeTerminalText(String(call.output).split("\n")[0]);
			const outRow = `      ${paint("gray", first, color)}`;
			lines.push(truncate(roles ? `${roles.toolOutput}${outRow}${ANSI.reset}` : outRow, width));
		}
	}
	if (partial.thinking) {
		// U5: the TUI speaks the log's words (chatview formatPartial): labelled
		// ("thinking ›"), reasoning first, and NEVER hidden because text reached the
		// frame — the log does not hide it either. `wrap` is the conversation view:
		// reasoning is prose and must stay readable across the viewport.
		const label = `${paint("yellow", "◇", color)} ${paint("dim", "thinking ›", color)} `;
		const thinkingText = sanitizeTerminalText(partial.thinking);
		const body = wrap
			? wrapText(thinkingText, Math.max(4, width - 18))
			: [truncate(thinkingText.split("\n")[0], width - 18)];
		body.forEach((line, i) => lines.push(i === 0 ? `  ${label}${line}` : `             ${line}`));
	} else if (partial.thinkingRedacted) {
		// U5: a redacted live block is reported with the exact phrase the log uses,
		// in both surfaces — the block exists, the body does not.
		lines.push(`  ${paint("yellow", "◇", color)} ${paint("dim", "thinking (redacted by the provider)", color)}`);
	}
	if (partial.text) {
		const text = sanitizeTerminalText(partial.text);
		const body = wrap
			? wrapText(text, Math.max(4, width - 8))
			: [truncate(text, width - 8)];
		body.forEach((line, i) => lines.push(`  ${i === 0 ? paint("cyan", "●", color) : " "} ${line}`));
	}
	if (partial.tools?.length) {
		for (const tool of partial.tools.slice(0, 2)) {
			const line = `    ${paint("magenta", "⚙", color)} ${sanitizeTerminalText(tool.name)}${tool.callId ? ` (${sanitizeTerminalText(tool.callId)})` : ""}`;
			lines.push(truncate(line, width));
		}
	}

	return { lines, height: lines.length };
}

/**
 * Render the status bar.
 */
function renderStatusBar(health, seats, queueItems, width, color = false) {
	const seatCount = seats?.length ?? 0;
	const queueCount = queueItems?.length ?? 0;
	const uptime = health?.uptime != null ? `${Math.round(health.uptime / 60)}m` : "?";

	const parts = [
		paint("bold", `seats: ${seatCount}`, color),
		paint("bold", `queue: ${queueCount}`, color),
		paint("bold", `uptime: ${uptime}`, color),
	];

	if (health?.attention?.length) {
		for (const note of health.attention.slice(0, 3)) {
			const text = truncate(`[${note.kind}]`, width - parts.join("  ").length - 2);
			parts.push(text ? paint("yellow", text, color) : "");
		}
	}

	const bar = `  ── ${parts.join("  │  ")} `;
	return { lines: [bar], height: 1, width: bar.length };
}

/**
 * Render the footer (help / keybindings).
 */
function renderFooter(width, color = false, view = "seats") {
	const hint =
		view === "conversation"
			? " Esc=back  ↑↓=scroll  G=tail  q=quit "
			: " q=quit  r=refresh  ↑↓/jk=seat  Enter=open ";
	const truncated = truncate(hint, width - 4);
	const gutter = "└" + "─".repeat(Math.max(0, width - 2 - truncated.length));
	return { lines: [paint("gray", gutter + truncated, color)], height: 1 };
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
	height = 24,
	color = false,
	theme = "dark",
	toolBg = false,
	selectedSeat = null,
	view = "seats",
	scroll = 0,
} = {}) {
	const lines = [];
	const w = width;
	const rule = "  " + "─".repeat(Math.max(0, w - 4));

	// Conversation view (Enter on a seat): ONE seat's full stream, so the team-wide
	// seat list and other seats' partials are deliberately absent — the operator
	// asked for this seat's conversation, not the dashboard.
	if (view === "conversation") {
		const seatName = selectedSeat ?? health?.seats?.[0]?.name ?? null;
		const seat = seats.find((s) => s.name === seatName);
		// The header names the focused seat, so its length depends on the seat's role;
		// truncate it like every other row rather than letting a long role overflow a
		// narrow terminal (found by the 48-column golden buffer test). Keep the gutter
		// outside the truncation so the indent matches the rules below.
		lines.push(`  ${truncate(`durig · ${sanitizeTerminalText(seatName ?? "?")}${seat?.role ? ` · ${sanitizeTerminalText(seat.role)}` : ""} · conversation`, Math.max(0, width - 2))}`);
		lines.push(rule);

		// The FOCUSED seat's partial, not whichever seat streams first: a conversation
		// about impl must never show pm's stream.
		const focusedPartial =
			(Array.isArray(partials) ? partials.find((p) => p.seat === seatName) : null) ??
			(partial && partial.hasContent && (partial.seat === undefined || partial.seat === seatName) ? partial : null);
		const streaming = focusedPartial
			? renderPartial(focusedPartial, width - 4, {
					roles: color && toolBg ? themeToolRoles(theme) : null,
					color,
					wrap: true,
				})
			: { lines: [] };
		// Reserve the fixed chrome AND the streaming block, then bound the transcript by
		// DISPLAY LINES: a tools/thinking turn renders several lines, so a turn-count
		// budget overflowed the viewport and pushed the live tail off-screen.
		const streamingRows = streaming.lines.length > 0 ? streaming.lines.length + 2 : 0;
		const reserve = 2 /*header*/ + 2 /*one indicator each side*/ + 5 /*status block + footer*/ + streamingRows;
		const transcriptBudget = Math.max(4, height - reserve);
		const { lines: transLines, above, below } = renderTranscript(
			turns,
			{},
			500, // the line budget bounds this window; maxRows only caps how far we scan
			width - 4,
			color,
			scroll,
			transcriptBudget,
		);
		if (above > 0) lines.push(paint("gray", `  ↑ ${above} older turn${above === 1 ? "" : "s"}`, color));
		lines.push(...(transLines.length > 0 ? transLines : [paint("gray", "  (no turns yet)", color)]));
		if (below > 0) lines.push(paint("gray", `  ↓ ${below} newer turn${below === 1 ? "" : "s"} (↓ to the live tail)`, color));
		if (focusedPartial) {
			lines.push("");
			lines.push(paint("bold", "  ── streaming ──", color));
			lines.push(...streaming.lines);
		}

		lines.push("");
		lines.push(rule);
		const { lines: statusLines } = renderStatusBar(health, seats, queueItems, width - 4, color);
		lines.push(...statusLines);
		lines.push(rule);
		lines.push(...renderFooter(width, color, "conversation").lines);
		return new Frame(lines);
	}

	// Header
	const seatLabel = seats?.length ? `${seats.length} seat${seats.length !== 1 ? "s" : ""}` : "no seats";
	const header = `durig · ${seatLabel} · TUI`;
	lines.push(`  ${truncate(header, Math.max(0, width - 2))}`);
	lines.push(rule);

	// Seat list (uses ~40% of height for seats)
	const mainHeight = Math.max(10, Math.floor(width * 0.3));
	const seatRows = Math.min(8, Math.max(3, Math.floor(mainHeight * 0.4)));
	const { lines: seatLines } = renderSeatList(seats, null, width - 4, selectedSeat, color);
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
		const partialRows = renderPartial(partial && partial.hasContent ? partial : null, width - 4, {
			roles: color && toolBg ? themeToolRoles(theme) : null,
			color,
		});
		if (partialRows.lines.length > 0) {
			lines.push("");
			lines.push(paint("bold", "  ── streaming ──", color));
			lines.push(...partialRows.lines);
		}
	} else {
		lines.push("");
		for (const p of active) {
			lines.push(paint("bold", `  ── streaming${p.seat ? `: ${p.seat}` : ""} ──`, color));
			const row = renderPartial(p, width - 4, {
				roles: color && toolBg ? themeToolRoles(theme) : null,
				color,
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
		width - 4,
		color,
	);
	if (transLines.length > 0) {
		lines.push("");
		lines.push(paint("bold", "  ── transcript ──", color));
		lines.push(...transLines);
	}

	// Status bar
	lines.push("");
	lines.push(rule);
	const { lines: statusLines } = renderStatusBar(health, seats, queueItems, width - 4, color);
	lines.push(...statusLines);
	lines.push(rule);

	// Footer
	const { lines: footerLines } = renderFooter(width, color);
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
