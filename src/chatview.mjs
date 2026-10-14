// Rendering a seat's conversation for a human. Same storage-only constraint as
// `watch`: a transcript viewer must never open a harness, because opening one
// resumes scheduling in a process whose job is only to look (D11).
//
// The unit of display is a TURN, not an entry: one operator message, one agent
// message, or one tool call together with its output. A call and its result are
// one act of work, so they share one timestamp and one row group; stamping every
// entry would bury the timeline in noise. The shape follows what the coding-agent
// TUIs have converged on (survey in docs/RESEARCH.md, "Formatting a transcript"):
// borderless rows, dim metadata, one accent per role, a narrow fixed gutter, and
// tool output collapsed to one line under a tree connector rather than dumped.

import { extractEntryText } from "./rigstory.mjs";
import { buildTurns, turnCollapse } from "./viewmodel.mjs";
import { ANSI } from "./ansi.mjs";

// Re-exported so callers keep one import path for the view model; the
// implementation lives in src/viewmodel.mjs (D21, ROADMAP item 7).
export { buildTurns, extractThinking, extractToolCalls } from "./viewmodel.mjs";

// A background tint reads wrong on an unknown terminal background, which is why
// hard-coding one is the field's clearest cautionary tale; it is therefore opt-in
// and themed, never automatic.
const TOOL_BG = { dark: "\x1b[48;5;236m", light: "\x1b[48;5;253m" };

const TIME_COL = 8;
const DELTA_COL = 7;
const MARKER_COL = 2;
const CONTENT_GAP = 3;

export function truncate(text, width) {
	const flat = String(text ?? "").replace(/\s+/g, " ").trim();
	if (width <= 0) return "";
	if (flat.length <= width) return flat;
	return width === 1 ? "…" : `${flat.slice(0, width - 1)}…`;
}

// Elapsed time between turns, in the units a person actually reads: seconds
// under a minute, minutes under an hour, then hours, then days. Sub-second gaps
// are dropped rather than rounded up: tool bursts are milliseconds apart and
// "+1s" on every row is noise.
export function formatDelta(ms) {
	if (!Number.isFinite(ms) || ms < 0) return "";
	const s = Math.floor(ms / 1000);
	if (s < 1) return "";
	if (s < 60) return `+${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return s % 60 === 0 ? `+${m}m` : `+${m}m${String(s % 60).padStart(2, "0")}s`;
	const h = Math.floor(m / 60);
	if (h < 24) return m % 60 === 0 ? `+${h}h` : `+${h}h${String(m % 60).padStart(2, "0")}m`;
	const d = Math.floor(h / 24);
	return h % 24 === 0 ? `+${d}d` : `+${d}d${String(h % 24).padStart(2, "0")}h`;
}

// Compact call arguments. Scalars read inline; anything structured is elided,
// because a tool header is a signpost, not a place to dump a JSON payload.
export function formatArgs(args, width = 48) {
	if (!args || typeof args !== "object" || Array.isArray(args)) return "";
	const keys = Object.keys(args).filter((k) => args[k] !== null && args[k] !== undefined);
	const parts = [];
	for (const key of keys.slice(0, 2)) {
		const value = args[key];
		if (typeof value === "string") parts.push(`${key}=${truncate(value, 32)}`);
		else if (typeof value === "number" || typeof value === "boolean") parts.push(`${key}=${value}`);
		else parts.push(`${key}=…`);
	}
	if (keys.length > 2) parts.push("…");
	return truncate(parts.join(", "), width);
}

// The whole call for --full: every key, nothing elided. Newlines inside a
// string become \n escapes so one call still renders as one command shape; the
// text itself is never cut, because a command the operator cannot see whole
// cannot be re-run when it misbehaves.
export function formatArgsFull(args) {
	if (!args || typeof args !== "object" || Array.isArray(args)) return "";
	const keys = Object.keys(args).filter((k) => args[k] !== null && args[k] !== undefined);
	return keys
		.map((k) => {
			const value = args[k];
			const shown = typeof value === "string" ? value.replace(/\r?\n/g, "\\n") : JSON.stringify(value);
			return `${k}=${shown}`;
		})
		.join(", ");
}

// Runs of identical non-blank lines are one fact with a multiplier: a runaway
// command prints the same line thousands of times (a stuck loop, a retry
// storm), and rendering each copy buries the two lines that matter while
// carrying no information the count does not. Blank lines are spacing, not
// data, so they never collapse.
function collapseRuns(lines) {
	const runs = [];
	for (const line of lines) {
		const last = runs[runs.length - 1];
		if (last && line !== "" && last.text === line) last.repeats += 1;
		else runs.push({ text: line, repeats: 1 });
	}
	return runs;
}

function repeatMarker(repeats) {
	const n = repeats - 1;
	return `×${n} more identical line${n === 1 ? "" : "s"}`;
}

function clockOf(ms) {
	if (!Number.isFinite(ms)) return "";
	const d = new Date(ms);
	const pad = (n) => String(n).padStart(2, "0");
	return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function dayOf(ms) {
	const d = new Date(ms);
	const pad = (n) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatChat(entries, options = {}) {
	const {
		seat = "seat",
		color = false,
		width = 100,
		full = false,
		toolBg = false,
		theme = "dark",
		time = true,
	} = options;
	const paint = (tone, text) => (color && tone ? `${ANSI[tone] ?? ""}${text}${ANSI.reset}` : text);
	const bg = color && toolBg ? TOOL_BG[theme] ?? TOOL_BG.dark : "";
	const tint = (text) => (bg ? `${bg}${text}${ANSI.reset}` : text);

	const turns = buildTurns(entries);
	if (!turns.length) return "";

	// Only message turns own a label column; tool turns are marked by their glyph
	// and name, so padding them into the same column would just add ragged space.
	const labelWidth = Math.min(
		12,
		Math.max(
			...turns.filter((t) => t.kind === "operator" || t.kind === "agent").map((t) => (t.kind === "operator" ? 3 : seat.length)),
			1,
		),
	);
	const timeWidth = time ? TIME_COL + 2 + DELTA_COL + 2 : 0;
	const gutter = " ".repeat(timeWidth + MARKER_COL + labelWidth + CONTENT_GAP);
	const bodyWidth = Math.max(20, width - gutter.length);
	const lines = [];

	let previous = null;
	let previousDay = null;
	for (const turn of turns) {
		if (time && turn.ts !== null && previousDay !== null && dayOf(turn.ts) !== previousDay) {
			// A day boundary is the one time change a reader must not miss, so it gets
			// its own rule rather than a delta that would read as "hours ago".
			lines.push(paint("dim", `── ${dayOf(turn.ts)} ──`));
		}
		if (turn.ts !== null) previousDay = dayOf(turn.ts);

		let head = "";
		if (time) {
			const clock = turn.ts === null ? "" : clockOf(turn.ts);
			const delta = turn.ts === null || previous === null ? "" : formatDelta(turn.ts - previous);
			head = `${paint("dim", clock.padEnd(TIME_COL))}  ${paint("dim", delta.padStart(DELTA_COL))}  `;
		}
		if (turn.ts !== null) previous = turn.ts;

		if (turn.kind === "thinking") {
			// Its own row, dim, before the seat speaks: merging it into the seat's
			// prose would attribute the reasoning as something the seat said. The
			// collapse rule matches tool results - legible default, nothing lost
			// under --full.
			if (turn.redacted && !turn.text) {
				lines.push(`${head}${paint("dim", "⋯")} ${paint("dim", "thinking (redacted by the provider)")}`);
				continue;
			}
			const first = turn.text.split("\n")[0];
			const { lines: rest } = turnCollapse(turn, { full });
			lines.push(`${head}${paint("dim", "⋯")} ${paint("dim", "thinking ›")} ${paint("dim", first)}`);
			if (!full && rest.length) {
				lines.push(paint("dim", `${gutter}⎿ (${rest.length} more line${rest.length === 1 ? "" : "s"} — --full to expand)`));
			} else if (full) {
				for (const extra of collapseRuns(rest)) {
					lines.push(paint("dim", `${gutter}${extra.text}`));
					if (extra.repeats > 1) lines.push(paint("dim", `${gutter}${repeatMarker(extra.repeats)}`));
				}
			}
			continue;
		}

		if (turn.kind === "tools") {
			const message = turn.result?.model?.[0];
			const failed = message?.isError === true;
			const name = turn.call?.name ?? message?.toolName ?? "tool";
			const args = full ? formatArgsFull(turn.call?.args) : formatArgs(turn.call?.args);
			const mark = failed ? paint("red", "✗") : paint("green", "✓");
			const label = paint(failed ? "red" : "green", `${name}(${args})`);
			const output = (extractEntryText(turn.result)?.text ?? "").replace(/\s+$/, "");
			// One line only, then the remainder is summarized below: flattening the
			// whole result into the header would defeat the point of collapsing it.
			const preview = output.split("\n")[0];
			const { lines: rest } = turnCollapse(turn, { full });
			// --full shows the preview line verbatim too; the terminal wraps what
			// exceeds the width. Capping here is what hid the command's output tail.
			const shown = full ? preview.trim() : truncate(preview, bodyWidth);
			lines.push(tint(`${head}${paint("dim", "⚙")} ${label} ${mark}${shown ? ` ${shown}` : ""}`));
			// Truncation is always signposted: a silently capped result reads as data
			// loss, and the reader needs to know the escape hatch exists.
			if (!full && rest.length) {
				lines.push(paint("dim", `${gutter}⎿ (${rest.length} more line${rest.length === 1 ? "" : "s"} — --full to expand)`));
			} else if (full) {
				for (const extra of collapseRuns(rest)) {
					lines.push(tint(`${gutter}${paint("dim", "⎿ ")}${paint("dim", extra.text)}`));
					if (extra.repeats > 1) lines.push(paint("dim", `${gutter}⎿ ${repeatMarker(extra.repeats)}`));
				}
			}
			continue;
		}

		const label = turn.kind === "operator" ? "you" : seat;
		const tone = turn.kind === "operator" ? "cyan" : "magenta";
		const text = turn.kind === "operator" ? extractEntryText(turn.entries[0])?.text ?? "" : turn.text;
		const [first, ...rest] = String(text).replace(/\s+$/, "").split("\n");
		lines.push(
			`${head}${paint(tone, "▌")} ${paint(tone, label.padEnd(labelWidth))} ${paint("dim", "›")} ${first}`,
		);
		for (const line of rest) lines.push(`${gutter}${line}`);
	}
	return lines.join("\n");
}

// Single-entry convenience used by unit tests: the same rendering with the clock
// gutter omitted, since one turn has nothing to be elapsed from.
export function formatChatEntry(entry, options = {}) {
	const text = formatChat([entry], { ...options, time: false });
	return text ? text.split("\n") : null;
}

// A follower's window on work that has NOT committed (ROADMAP 40c). It renders
// through a marker and wording a committed turn never uses (◌ / "streaming…"),
// because the two are different facts: a committed turn is history, while this is
// a snapshot the next poll may rewrite or withdraw. Nothing here is stamped or
// grouped with committed turns, so a crashed driver's last partial cannot read as
// the reply - it stays labelled uncommitted until it either settles into an entry
// or disappears.
export function formatPartial(partial, { seat = "seat", color = false } = {}) {
	if (!partial || !partial.hasContent) return "";
	const paint = (tone, text) => (color && tone ? `${ANSI[tone] ?? ""}${text}${ANSI.reset}` : text);
	const lines = [
		`${paint("cyan", "◌")} ${paint("magenta", seat)} ${paint("dim", "streaming… (not yet committed)")}`,
	];
	if (partial.thinking.trim()) {
		const [first, ...rest] = partial.thinking.trim().split("\n");
		lines.push(paint("dim", `  ⋯ thinking › ${first}`));
		// Thinking is a travelogue, not the answer, so it stays dim and indented and
		// is never trimmed to a count: it is already bounded by the poll, not a turn.
		for (const line of rest) lines.push(paint("dim", `    ${line}`));
	}
	const body = String(partial.text ?? "").replace(/\s+$/, "");
	if (body) for (const line of body.split("\n")) lines.push(`  ${line}`);
	for (const tool of partial.tools) lines.push(`${paint("dim", "  ⚙ running:")} ${paint("yellow", tool.name)}`);
	return lines.join("\n");
}
