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

import { pad, truncate, seatActivity } from "../watchview.mjs";
import { formatDelta, formatArgs, themeToolRoles } from "../chatview.mjs";
import { extractEntryText } from "../rigstory.mjs";
import { ANSI } from "../ansi.mjs";
import { sanitizeTerminalText } from "../sanitize.mjs";
import { textWidth, sliceToWidth, wrapLines } from "../textwidth.mjs";
import { projectLanding } from "../readapi.mjs";

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

/* ───────── The landing row (ROADMAP 124, designer spec #3307) ───────── */

// The DECLARED LANDING MINIMUM (spec §4): the spec's 44-column TERMINAL floor. This function is
// now handed the terminal width (it used to get width-4, which is why this constant read 40); the
// floor itself is unchanged — below 44 columns the classic roster row is the honest fallback,
// "no broken columns ever".
const LANDING_MIN_WIDTH = 44;
// Fixed prefix of a landing row (spec §1): sel 2 + state 13 + name 9 + queue 9.
const LANDING_FIXED_WIDTH = 33;

/** The brief cap at `width` CONTENT cells: the spec's MEASURED ladder (§4), not a guess. */
// #4233: THE ACTION RUNT BAND — the minimum room (in cells) below which the action token is HIDDEN
// rather than rendered as a fragment. Named and justified rather than left as a bare comparison, the
// same way `ADMISSION_DEADLINE_MS` is.
//
// NINE, NOT FIVE, and the measurement is why: with 5..8 cells of room the longest token
// (`tool complete_w…`, 16 cells) renders as `tool c…` or `tool …` — still a fragment of a word that
// names nothing, which is the exact defect the item reports ("the token renders as `t` / `t…` / `to…` at
// 1..8 cells of room"). At 9 cells it reads `tool comp…`, a recognisable prefix of a known vocabulary.
// So the honest boundary is where the fragment becomes RECOGNISABLE, and 5 was one rung too generous:
// hiding below 5 would have left 5..8 fragmenting, which is the finding half-fixed.
const ACTION_MIN_ROOM = 9;

function briefCap(width) {
	if (width >= 72) return 24; // >= 72 TERMINAL columns (the spec's 76-80 content-cell band)
	if (width >= 47) return 16; // 47-71 TERMINAL columns (the spec's 51-75 content-cell band)
	return 12; // spec 44-50 terminal — the declared minimum rung
}

/**
 * The per-seat queue column (spec §1): `12q` normally, `0q · 1p` when the seat also
 * holds parked work. `q` = queued + claimed, `p` = deferred + held — the broker's live
 * status set, so a parked seat can never read as an idle row.
 */
function queueColumn(row) {
	const q = row.queue.queued + row.queue.claimed;
	const p = row.queue.deferred + row.queue.held;
	return p > 0 ? `${q}q · ${p}p` : `${q}q`;
}

/**
 * The ACTION token (spec §3), read from the SAME per-seat partial the streaming block
 * renders — never a second derivation. `tool <name>` is the only token that carries a
 * fact the state column cannot (WHAT it runs); the state column already says THAT it runs.
 */
function actionToken(partial) {
	if (!partial) return "";
	const calls = partial.toolCalls ?? [];
	if (calls.length > 0) {
		// The newest call that is not done: running first, else pending, else the newest.
		const live =
			calls.find((c) => c.status === "running") ??
			calls.find((c) => c.status !== "done") ??
			calls[calls.length - 1];
		return truncate(`tool ${formatTuiToolName({ name: live?.name ?? "tool" })}`, 16);
	}
	if (partial.text) return "composing";
	if (partial.thinking || partial.thinkingRedacted) return "thinking";
	return "";
}

/**
 * The BRIEF column (spec §2): `<#id> ` plus ONE truncated field, by cells with an
 * ellipsis. The `#id` is NEVER truncated — it is the reference the conversation, the
 * answer op and the queue dumps share. A parked seat's field is the QUESTION (the
 * operator triage fact this screen exists for); a seat holding nothing renders `—`.
 */
function briefColumn(row, cap) {
	const item = row.claimed ?? row.deferred;
	if (!item) return "—";
	const id = `#${item.id} `;
	const source = sanitizeTerminalText(String((row.claimed ? item.subject : item.question ?? item.subject) ?? ""));
	const room = cap - textWidth(id);
	if (room <= 0) return id.trimEnd();
	if (textWidth(source) <= room) return `${id}${source}`;
	return `${id}${sliceToWidth(source, Math.max(0, room - 1))}…`;
}

/**
 * Pad a row to `width` CELLS (#3941). A row narrower than the frame is the blank stripe the
 * operator reported, so every painted row ends at the frame edge. Never truncates: an
 * over-wide row is the floor discipline's problem (it must not happen), not this helper's.
 */
function padToCells(row, width) {
	const w = textWidth(row);
	return w >= width ? row : row + " ".repeat(width - w);
}

/**
 * Pad a FRAME to exactly `width` x `height` cells (#3941): the screen fills the terminal in
 * both dimensions. Rows are padded to the frame width and blank rows are appended so the
 * layout occupies the viewport instead of leaving 23-33 rows empty underneath it.
 *
 * Clipping to `height` is kept (a frame taller than the viewport would scroll and tear), but
 * the budgets above are sized so it does not fire in the seats view.
 */
function fillFrame(lines, width, height) {
	const out = lines.map((l) => padToCells(l, width));
	const blank = " ".repeat(Math.max(0, width));
	while (out.length < height) out.push(blank);
	return out.slice(0, Math.max(0, height));
}

/**
 * Render the seat list section.
 * Returns { lines, width } where width is the used character width.
 */
function renderSeatList(seats, activityMap, width, selectedSeat = null, color = false, landing = null, partialsBySeat = {}, maxRows = 0) {
	if (!seats?.length) {
		return { lines: [paint("gray", "  (no seats yet)", color)], width: Math.max(18, 0) };
	}

	const maxName = Math.max(...seats.map((s) => s.name.length), 4) + 1;
	const maxRole = Math.min(20, Math.max(...seats.map((s) => (s.role ?? "").length), 4) + 1);
	const activityCol = 6 + maxName + maxRole;

	// ONE row template, TWO widths (spec §0): the landing row above the declared minimum,
	// the classic roster row below it. Same source, same glyphs, same selection rules.
	const landingRow = width >= LANDING_MIN_WIDTH && landing !== null;
	// The brief is the flexible cell: never wider than its rung AND never wider than what is
	// actually left. The spec's own arithmetic at the 44-col rung (33 fixed + 12 = 45) does
	// not close inside 44, so the clamp wins — a row that overflows is the one outcome the
	// floor discipline forbids (reported on #3313).
	//
	// #3941: the rung is a MINIMUM, not a ceiling. At wide sizes the brief and the action cell
	// ABSORB the extra columns, so the row fills the terminal instead of stopping around 74
	// cells and leaving everything to its right blank (the reported defect: a byte-identical
	// row at 80, 120 and 160 columns). The floor arithmetic above is unchanged — `cap` can
	// never exceed what is left after the fixed prefix.
	const actionWanted = width >= 47;
	const actionBudget = actionWanted ? Math.min(16, Math.max(0, width - LANDING_FIXED_WIDTH - briefCap(width) - 1)) : 0;
	const cap = landingRow
		? Math.max(1, Math.min(width - LANDING_FIXED_WIDTH - (actionBudget > 0 ? actionBudget + 1 : 0), width - LANDING_FIXED_WIDTH))
		: 0;

	// DEGRADE (spec §6.1): more seats than rows. The roster is bounded by `maxRows` (the
	// frame's own budget); seats beyond it scroll with BOTH-END indicator rows, and the
	// window FOLLOWS THE SELECTION cursor so j/k past the edge enters the window.
	const bounded = maxRows > 0 && seats.length > maxRows;
	let visible = seats;
	let above = 0;
	let below = 0;
	if (bounded) {
		const body = Math.max(1, maxRows - 2);
		const idx = Math.max(0, seats.findIndex((s) => s.name === selectedSeat));
		const start = Math.max(0, Math.min(idx - Math.floor(body / 2), seats.length - body));
		visible = seats.slice(start, start + body);
		above = start;
		below = seats.length - (start + visible.length);
	}

	const lines = [];
	if (above > 0) lines.push(paint("gray", `  ↑ ${above} more seat${above === 1 ? "" : "s"}`, color));
	for (const seat of visible) {
		const act = activityMap?.[seat.name] ?? { glyph: "○", tone: "gray", state: "idle", focus: "" };
		const isSelected = selectedSeat !== null && seat.name === selectedSeat;
		// The selected row is marked with a cursor glyph in place of the leading
		// space, so selection adds no width and every row keeps one 2-cell gutter.
		const cursor = isSelected ? "▸" : " ";
		let row;
		if (landingRow) {
			const entry = landing.get(seat.name);
			// Columns are padded to fixed widths so the action column aligns; the brief is
			// the one flexible cell (spec §1: sel 2 + state 13 + name 9 + queue 9 = 33).
			const sel = isSelected ? "▸ " : "  ";
			const stateCol = `${paint(act.tone, act.glyph, color)} ${pad(act.state, 11)}`;
			const nameCol = pad(truncate(sanitizeTerminalText(seat.name), 9), 9);
			const queueCol = pad(entry ? queueColumn(entry) : "0q", 9);
			const brief = pad(briefColumn(entry ?? { claimed: null, deferred: null }, cap), cap);
			// The ACTION cell is the FIRST to collapse: gone below the 51-col rung (spec §4),
			// and clamped to whatever the row has left so it can never overflow the frame
			// (the spec's 16-cell cap does not close at the bottom of that band either).
			const actionRoom = width - LANDING_FIXED_WIDTH - cap - 1;
			// #4233: the token is HIDDEN below ACTION_MIN_ROOM rather than truncated into a fragment. This is
			// a §3 rule (what the surface shows), NOT a §4 rung: the brief's `cap` is computed from
			// `actionBudget`, not from whether the token came back non-empty, so hiding the token moves NO
			// fixed cell — the row simply ends in padding.
			const token =
				actionWanted && actionRoom >= ACTION_MIN_ROOM ? actionToken(partialsBySeat[seat.name]) : "";
			const action = token === "" ? "" : truncate(token, Math.min(16, actionRoom));
			// #3941: pad the row to the section width so the row reaches the frame edge; a short
			// row is the blank stripe the operator reported.
			row = padToCells(`${sel}${stateCol}${nameCol}${queueCol}${brief}${action ? ` ${action}` : ""}`, width);
		} else {
			const name = truncate(sanitizeTerminalText(seat.name), maxName - 1);
			const role = truncate(sanitizeTerminalText(seat.role ?? ""), maxRole - 1);
			const head = `${paint(act.tone, act.glyph, color)} ${pad(name, maxName)}${pad(role, maxRole)}`;
			const focus = truncate(sanitizeTerminalText(act.focus), width - activityCol);
			// #3941: the fallback row fills the width too - a short row is the same blank stripe.
			row = padToCells(`${cursor} ${head}${focus}`, width);
		}
		// Selection is reverse video + bold (the skill's canonical, most-readable
		// current-row signal — see references/visual-patterns.md), reinforced by the
		// ▸ glyph so it still reads in monochrome / NO_COLOR.
		lines.push(isSelected ? paint("reverse", paint("bold", row, color), color) : row);
	}
	if (below > 0) lines.push(paint("gray", `  ↓ ${below} more seat${below === 1 ? "" : "s"}`, color));

	return { lines, width: width };
}

/**
 * The display lines for one conversation turn. Kept separate from the transcript
 * window so the conversation view can budget by LINES, not turns: a tools or thinking
 * turn renders several lines, and a turn-count budget silently overflows the viewport.
 */
function transcriptTurnLines(turn, width, color) {
	const lines = [];
	// ROADMAP 101 (#4017): prose turns WRAP through the one shared newline-preserving wrapper
	// (`wrapLines`), never through `truncate`'s `\s+` flatten. Two consequences that were bugs
	// before: a multi-paragraph turn keeps its paragraphs (a blank line stays a blank line), and a
	// long line wraps instead of ending in an ellipsis. The glyph rides the first line;
	// continuations hang under the text, and a blank line stays EMPTY rather than becoming
	// trailing spaces.
	const hang = (body, first, rest) => {
		body.forEach((line, i) => {
			if (i === 0) lines.push(first(line));
			else lines.push(line === "" ? "" : rest(line));
		});
	};
	switch (turn.kind) {
		case "operator": {
			// The turn's text is either carried directly (fixtures pass `text`) or, on the
			// real path, lives in the operator ENTRY — buildTurns keeps the entry, not a
			// copy. Reading both is what stops the detail view rendering the operator's
			// messages as blank rows (chatview's log reads the entry the same way).
			const raw = sanitizeTerminalText(turn.text ?? extractEntryText(turn.entries?.[0])?.text ?? "");
			hang(
				wrapLines(raw, Math.max(1, width - 4)),
				(line) => `  ${paint("green", "▶", color)} ${paint("bold", line, color)}`,
				(line) => `    ${paint("bold", line, color)}`,
			);
			break;
		}
		case "agent": {
			const raw = sanitizeTerminalText(turn.text);
			hang(
				wrapLines(raw, Math.max(1, width - 4)),
				(line) => `  ${paint("cyan", "◀", color)} ${line}`,
				(line) => `    ${line}`,
			);
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
			? wrapLines(thinkingText, Math.max(4, width - 18))
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
			? wrapLines(text, Math.max(1, width - 4))
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
 * The HUMAN phrase for an attention kind (#2826 item 2 / F2). The bar used to print the raw
 * enum tag — `[admitted_not_started]` — which is the machine's word, not the operator's. An
 * unmapped kind degrades to its tag with the separators opened out: readable, never raw, and
 * never a silent blank.
 */
const ATTENTION_PHRASES = {
	admitted_not_started: "submission not started",
	deferred_awaiting_answer: "waiting on an answer",
	idle_with_queued_work: "idle with queued work",
	last_run_failed: "last run failed",
	malformed_tool_call: "malformed tool call",
	repeated_failure: "repeated failures",
	pass_failed: "pass failed",
	wake_failed: "wake failed",
	wake_refused_paused: "wake refused (paused)",
	generation_in_flight: "generating",
	secret_detected: "secret-shaped value in the store",
	worktree_orphan_kept: "orphan worktree kept",
	"harness-reopen-failed": "harness reopen failed",
	"harness-reopen-cap-exceeded": "harness reopen cap hit",
	"context-boundary-failed": "context boundary failed",
};

function humanKind(kind) {
	const key = String(kind ?? "");
	const phrase = ATTENTION_PHRASES[key] ?? key.replace(/[-_]+/g, " ").toLowerCase();
	return phrase || "notice";
}

/**
 * Render the status bar.
 *
 * #2826 item 2: the bar speaks in HUMAN phrases with seat attribution and the queue/parked
 * split, and it counts only LIVE work. Before this it printed raw enum tags
 * (`[admitted_not_started]`), attributed nothing, and counted every item ever enqueued —
 * `done` and `cancelled` included — so the number grew as work finished.
 */
function renderStatusBar(health, seats, queueItems, width, color = false) {
	const seatCount = seats?.length ?? 0;
	const uptime = health?.uptime != null ? `${Math.round(health.uptime / 60)}m` : "?";

	// LIVE work only, split the way the landing rows split it: `queue` = queued + claimed (work
	// waiting or in hand), `parked` = deferred + held (work stopped on a question or a gate).
	const live = { queued: 0, claimed: 0, deferred: 0, held: 0 };
	for (const item of queueItems ?? []) {
		if (Object.hasOwn(live, item.status)) live[item.status] += 1;
	}
	const activeCount = live.queued + live.claimed;
	const parkedCount = live.deferred + live.held;

	const parts = [paint("bold", `seats: ${seatCount}`, color)];
	// HIDE-WHEN-ZERO (the #2804 rule the bar keeps, spec #3307 §6.2): a bare `queue: 0` is
	// chrome. When either half is non-zero the split is shown; when both are, they are ONE
	// part so a narrow frame can only drop the pair, never half of it.
	if (activeCount > 0 && parkedCount > 0) parts.push(paint("bold", `queue: ${activeCount} · parked ${parkedCount}`, color));
	else if (activeCount > 0) parts.push(paint("bold", `queue: ${activeCount}`, color));
	else if (parkedCount > 0) parts.push(paint("bold", `parked ${parkedCount}`, color));
	parts.push(paint("bold", `uptime: ${uptime}`, color));

	if (health?.attention?.length) {
		for (const note of health.attention.slice(0, 3)) {
			// Seat attribution: a seat-scoped notice says WHOSE it is. Rig- and queue-scoped
			// notices carry no seat and stay unattributed (the same explicit rule the roster
			// uses, so a rig-wide notice never lands on a seat row).
			const who = note.scope === "seat" && note.seat ? `${note.seat}: ` : "";
			parts.push(paint("yellow", `${who}${humanKind(note.kind)}`, color));
		}
	}

	const bar = `  ── ${parts.join("  │  ")} `;
	// Bound the bar to the row (ROADMAP 124 floor acceptance: nothing overflows). Attention
	// phrases are unbounded strings, so the assembled bar could exceed a narrow frame even
	// though each part was truncated on its own. Degrade by dropping WHOLE parts from the
	// right (the trailing uptime/notes go first, the seat count stays), and only slice
	// mid-part if a single part cannot fit at all.
	// `truncate` is not used here: it collapses the double-space separators the bar is built from.
	let shown = parts;
	const render = (list) => `  ── ${list.join("  │  ")} `;
	// SIGNAL BEFORE CONVENIENCE: when the bar must lose something, it loses the LEAST
	// actionable part first — the uptime clock — and only then the notices, right to left.
	// Dropping strictly from the right (the old rule) killed the NOTICES first because they
	// sit last, so the operator lost "something needs attention" to keep a clock nobody acts
	// on. The seat count and the queue/parked split are never sacrificed here.
	if (textWidth(render(shown)) > width) {
		const dropOrder = [];
		const uptimeIdx = shown.findIndex((part) => String(part).includes("uptime: "));
		if (uptimeIdx >= 0) dropOrder.push(shown[uptimeIdx]);
		for (let i = shown.length - 1; i >= 2; i -= 1) if (i !== uptimeIdx) dropOrder.push(shown[i]);
		for (const victim of dropOrder) {
			if (textWidth(render(shown)) <= width) break;
			shown = shown.filter((part) => part !== victim);
		}
	}
	// DEGRADATION MUST NOT LIE (#2826 item 4): when the split has to give way, collapse it to
	// ONE honest combined total — `queue: 4` — rather than letting the row-cut leave a
	// truncated split (`queue: 2 · par…`) that reads as a smaller number than it is.
	const splitAt = shown.findIndex((part) => typeof part === "string" && part.includes("· parked "));
	if (splitAt >= 0 && textWidth(render(shown)) > width) {
		const collapsed = shown.slice();
		collapsed[splitAt] = paint("bold", `queue: ${activeCount + parkedCount}`, color);
		if (textWidth(render(collapsed)) <= width) shown = collapsed;
	}
	while (shown.length > 1 && textWidth(render(shown)) > width) shown = shown.slice(0, -1);
	const fitted = render(shown);
	const bounded = textWidth(fitted) > width && width > 1 ? `${sliceToWidth(fitted, width - 1)}…` : fitted;
	return { lines: [bounded], height: 1, width: textWidth(bounded) };
}

/**
 * Cut a footer hint to `width` cells from the RIGHT, keeping its internal spacing.
 *
 * `truncate` collapses runs of whitespace, which would silently rewrite the design's
 * double-space separators AND break the conversation hint's budget arithmetic (designer
 * #1115: the hint is exactly 44 cells, and 48 − 4 = 44). So this hint is measured and cut
 * by CELLS, like every other width decision in this module.
 */
function truncateHint(hint, width) {
	const flat = String(hint ?? "").trim();
	if (textWidth(flat) <= width) return flat;
	if (width <= 1) return sliceToWidth(flat, Math.max(width, 0));
	return `${sliceToWidth(flat, width - 1)}…`;
}

/**
 * Render the footer (help / keybindings).
 */
function renderFooter(width, color = false, view = "seats") {
	// Conversation footer hint (designer #1115), EXACTLY this string: 44 cells, so at 48
	// cols all five bindings fit whole (48 − 4 = 44). The order is deliberate — the row is
	// cut from the right, so `q=quit` falls off first (Ctrl+C is always wired), then
	// `i=input`; the navigation keys survive longest. `r` stays bound and functional but is
	// not advertised here (it is a seat-list affordance).
	const hint =
		view === "input"
			? " Enter=send  Esc=cancel "
			: view === "conversation"
				? "Esc=back  ↑↓=scroll  G=tail  i=input  q=quit"
				: " q=quit  r=refresh  ↑↓/jk=seat  Enter=open  i=input ";
	// The seats/input hints are frozen byte-for-byte by the same ruling, so they keep the
	// legacy whitespace-collapsing cut; only the conversation hint is cut by cells.
	const truncated = view === "conversation" ? truncateHint(hint, width - 4) : truncate(hint, width - 4);
	const gutter = "└" + "─".repeat(Math.max(0, width - 2 - textWidth(truncated)));
	return { lines: [paint("gray", gutter + truncated, color)], height: 1 };
}

/**
 * Render the type-to-seat input ROW.
 *
 * It is an OVERLAY affordance, drawn over whichever view is current, and it NAMES the seat
 * the text will be sent to: over a conversation that is the conversation's seat, over the
 * seat list the selected seat (designer #1115). The chip makes the target explicit instead
 * of implied by focus — the two views address different seats, and a mis-send has no recall
 * (the intent inbox is write-only).
 */
function renderInputRow(width, color, inputText, seatName) {
	const chip = seatName ? `─ to ${sanitizeTerminalText(seatName)} ─ ` : "";
	const cursor = "▏";
	const budget = Math.max(0, width - 4 - textWidth(chip) - textWidth(cursor));
	return `  ${paint("bold", "┃", color)} ${paint("dim", chip, color)}${truncate(inputText, budget)}${cursor}`;
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
 * @param {boolean|null} params.exhausted — conversation view only: whether no OLDER entries
 *   exist beyond the loaded set. `false` renders the "load older" invite, `true` renders
 *   "start of conversation"; `null` (default) leaves the top indicator at today's behaviour,
 *   so callers that do not know do not fabricate a state.
 * @param {string} params.view — the view UNDER any input overlay: "seats" (default) or
 *   "conversation". "input" is NOT a view (ROADMAP 99): while typing, pass the underlying
 *   view plus `inputText`, and the input row is drawn OVER it instead of replacing it.
 * @param {string|null} params.inputText — non-null while the type-to-seat overlay is open;
 *   renders the input row (chip naming `selectedSeat`) over the current view and switches
 *   the footer to the send/cancel hint.
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
	inputText = null,
	exhausted = null,
} = {}) {
	const lines = [];
	const w = width;
	const rule = "  " + "─".repeat(Math.max(0, w - 4));
	// ONE snapshot for BOTH views (lead #3320 / spec #3307): the roster row and the
	// conversation header read the same `projectLanding` projection over the same health
	// data, so the two screens cannot disagree about what a seat is doing.
	const snapshot = {
		...health,
		seats: health?.seats?.length ? health.seats : seats,
		queueItems: health?.queueItems ?? queueItems,
		attention: health?.attention ?? [],
	};
	const landing = new Map(projectLanding(snapshot).seats.map((row) => [row.name, row]));

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
		// #3359 / spec #3307 §0: the header names the seat's CURRENT WORK ITEM — id, subject
		// and status — from the same landing projection the roster row reads. There is
		// deliberately NO separate body block: the body IS the seat's own transcript below.
		// A seat holding nothing says so, rather than showing a blank header line.
		const entry = landing.get(seatName);
		const item = entry?.claimed ?? entry?.deferred ?? null;
		const statusWord = entry?.action ?? "idle";
		const itemText = item
			? entry.deferred
				// A parked seat's status IS "parked on <who>", so the status word is not repeated.
				? `#${item.id} ${sanitizeTerminalText(String(item.subject ?? ""))} · parked on ${entry.deferred.deferredTo ?? "an answer"}`
				: `#${item.id} ${sanitizeTerminalText(String(item.subject ?? ""))} · ${statusWord}`
			: `no current item · ${statusWord}`;
		lines.push(`  ${truncate(itemText, Math.max(0, width - 2))}`);
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
		// The input row is part of the fixed chrome while the overlay is open, so it is
		// reserved too — otherwise the row would be appended past `height` and clipped.
		const inputRows = inputText !== null ? 1 : 0;
		const reserve = 3 /*header (seat line + item line)*/ + 2 /*one indicator each side*/ + 5 /*status block + footer*/ + streamingRows + inputRows;
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
		// Top indicator — three honest states (ROADMAP 89; designer contract #952 §2):
		// (a) `↑ N older turns` — hidden-above count WITHIN the loaded set (unchanged);
		// (b) `↑ loaded-max · press ↑ to load older` — at the loaded top while older
		//     entries exist BEYOND it (count OMITTED: a cheap count needs a full scan,
		//     and a fabricated number is the lie D24/D28 forbid);
		// (c) `── start of conversation ──` — at the loaded top and exhausted, so a short
		//     seat says so rather than inviting a page that would find nothing.
		// `exhausted === null` (unknown) keeps only state (a): no state is invented.
		if (above > 0) {
			// Truncate the hint, never the number: the count leads, so a narrow row keeps it.
			lines.push(paint("gray", truncate(`  ↑ ${above} older turn${above === 1 ? "" : "s"}`, Math.max(0, width - 2)), color));
		} else if (exhausted === false) {
			lines.push(paint("gray", truncate("  ↑ loaded-max · press ↑ to load older", Math.max(0, width - 2)), color));
		} else if (exhausted === true) {
			lines.push(paint("gray", truncate("  ── start of conversation ──", Math.max(0, width - 2)), color));
		}
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
		// The input overlay rides ON TOP of the conversation: the transcript above stays put
		// (that is the ROADMAP 99 fix — typing no longer replaces the view), the row names the
		// conversation's seat, and the footer switches to the send/cancel hint.
		if (inputText !== null) lines.push(renderInputRow(width, color, inputText, seatName));
		lines.push(...renderFooter(width, color, inputText !== null ? "input" : "conversation").lines);
		return new Frame(lines);
	}

	// Header
	const seatLabel = seats?.length ? `${seats.length} seat${seats.length !== 1 ? "s" : ""}` : "no seats";
	const header = `durig · ${seatLabel} · TUI`;
	lines.push(`  ${truncate(header, Math.max(0, width - 2))}`);
	lines.push(rule);

	// ── BUDGETS FROM THE TERMINAL'S ROWS (#3941) ──────────────────────────────────
	// The layout used to derive its height from the WIDTH (`Math.max(10, Math.floor(width *
	// 0.3))` plus `Math.min(8, …)`), so a 120x40 or 160x50 terminal got a ~17-row frame and
	// 23-33 blank rows underneath. Height now comes from `height`, the way the conversation
	// view already sizes its transcript: the fixed chrome is reserved, the ROSTER takes what it
	// needs (all seats when they fit), and the transcript preview gets the remainder.
	const footerRows = 1 + (inputText !== null ? 1 : 0);
	const statusRows = 4; // blank + rule + status line + rule
	const fixedChrome = 2 /*header + rule*/ + statusRows + footerRows;

	// The streaming block is measured BEFORE the roster so its rows are part of the budget
	// rather than an afterthought that pushes the frame past the viewport.
	const active = Array.isArray(partials)
		? partials
		: partial && partial.hasContent
			? [partial]
			: [];
	const streamingLines = [];
	if (active.length > 0) {
		// F4/F5 (#2826, designer #2748): NO live partial means NO streaming section at all.
		// The landing row's ACTION cell already answers "is anything running", so a
		// placeholder would be a second, weaker signal for the same fact.
		streamingLines.push("");
		for (const p of active) {
			streamingLines.push(paint("bold", `  ── streaming${p.seat ? `: ${p.seat}` : ""} ──`, color));
			const row = renderPartial(p, width - 4, {
				roles: color && toolBg ? themeToolRoles(theme) : null,
				color,
			});
			streamingLines.push(...row.lines);
		}
	}

	// The roster gets priority up to the number of seats it must paint; the transcript gets
	// what is left, bounded as before. `seatRows` is a CAP that includes the two degrade
	// indicators, so passing `seats.length` means "unbounded - paint them all".
	const transcriptChrome = 3; // blank + "-- transcript --" + at least one line
	const seatBudget = Math.max(3, height - fixedChrome - streamingLines.length - transcriptChrome);
	const seatRows = Math.min(seats.length, seatBudget);
	const transcriptRows = Math.max(
		0,
		Math.min(6, height - fixedChrome - streamingLines.length - Math.min(seats.length, seatBudget) - 2),
	);

	// Seat list
	// ONE derivation for the roster (lead #3320): the state words and glyphs come from
	// `seatActivity` (#2826) and the per-seat queue facts from `projectLanding` (#3308),
	// both over the SAME health snapshot built at the top of this function. No second
	// hand-rolled derivation, so the roster and the status bar cannot disagree about what
	// a seat is doing.
	const activityMap = {};
	for (const seat of seats) activityMap[seat.name] = seatActivity(seat, snapshot);
	const partialsBySeat = {};
	for (const p of active) {
		if (p.seat) partialsBySeat[p.seat] = p;
	}
	const { lines: seatLines } = renderSeatList(seats, activityMap, width, selectedSeat, color, landing, partialsBySeat, seatRows);
	lines.push(...seatLines);

	// Streaming / partial rows — U2: EVERY actively-generating seat at once, keyed off
	// live generation (`partialView(live).hasContent`), never queue depth. Team-wide:
	// one seat-labelled block per active seat; the legacy single `partial` argument
	// keeps working (unnamed block) so the C3 contract doesn't break.
	lines.push(...streamingLines);

	// Transcript preview
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
	// The input row sits with the footer: typing targets the selected seat, so it is
	// part of the seat-list view, not a separate screen.
	if (inputText !== null) {
		lines.push(renderInputRow(width, color, inputText, selectedSeat));
	}
	const { lines: footerLines } = renderFooter(width, color, inputText !== null ? "input" : "seats");
	lines.push(...footerLines);

	// #3941: FILL the viewport. Every row is padded to the frame width and blank rows are
	// appended to the terminal height, so the layout occupies the screen instead of leaving a
	// blank stripe to the right of the content and 20-30 empty rows underneath it.
	return new Frame(fillFrame(lines, width, height));
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
