// The human view of `watch`. It answers three questions per seat - who is it,
// what are they saying, what are they working on - because that is the reading
// a person does when they open a second terminal. The JSON form remains the
// contract for scripts; this is the same snapshot rendered for eyes (see
// docs/RESEARCH.md for the conventions borrowed from comparable systems).

import { ANSI } from "./ansi.mjs";
import { sanitizeTerminalText } from "./sanitize.mjs";
import { textWidth, sliceToWidth } from "./textwidth.mjs";
import { deriveSeatAction } from "./viewmodel.mjs";

// Collapse whitespace before truncating: model prose arrives with newlines and
// indentation that would otherwise break the one-line-per-seat layout.
// #4591: HOISTED TO MODULE SCOPE AND EXPORTED. THE MAP IS THE SET — a demo that iterates a LITERAL copy of
// these names decays back to "the painted glyphs are covered by nothing" one state at a time, because a new
// state added here would not appear in the copy. Anything that wants to enumerate the presentation reads THIS.

export const PRESENTATION = {
	failed: { glyph: "✖", tone: "red" },
	generating: { glyph: "●", tone: "green" },
	working: { glyph: "●", tone: "green" },
	// After `working`: a seat that is also working on something else should
	// read as working, not as parked. The order is enforced in the derivation.
	parked: { glyph: "◌", tone: "yellow" },
	waiting: { glyph: "!", tone: "yellow" },
	// #4449: `queued` ? claimable work, nothing claimed/generating/failed. GLYPH U+25C9 ("\u25C9"),
	// DIM. NOT a half-filled shape: a partial fill reads as PROGRESS THE SEAT HAS NOT MADE. Not
	// green (working's tone) and not yellow (this fact is calm ? the count is already on the same
	// row, so no alarm inflation). Sits BELOW `waiting` in the derivation's precedence.
	queued: { glyph: "\u25C9", tone: "dim" },
	idle: { glyph: "○", tone: "dim" },
};

export function truncate(text, width) {
	const flat = String(text ?? "")
		.replace(/\s+/g, " ")
		.trim();
	// Measure and cut in terminal CELLS: a CJK/emoji string is not `flat.length` wide.
	if (textWidth(flat) <= width) return flat;
	if (width <= 1) return sliceToWidth(flat, Math.max(width, 0));
	return `${sliceToWidth(flat, width - 1)}…`;
}

export function pad(text, width) {
	const s = String(text ?? "");
	const w = textWidth(s);
	return w >= width ? s : s + " ".repeat(width - w);
}

// Attention kinds are the vocabulary the rig already uses; the human view only
// maps them to a glyph and a word, never re-derives the state itself. The STATE and
// the focus string come from `deriveSeatAction` in the shared view model (#2826 /
// ROADMAP 124), so the landing screen and this row cannot disagree about what a seat
// is doing; this function adds only the presentation (glyph + tone).
export function seatActivity(seat, health, highlight) {
	const { state, focus } = deriveSeatAction(seat, health, highlight);

	const { glyph, tone } = PRESENTATION[state] ?? PRESENTATION.idle;

	return { glyph, tone, state, focus };
}

// A snapshot is rendered whole rather than patched, so a redraw can never show
// a half-updated rig; the caller decides whether to clear the screen or append.
export function formatSnapshot({ db, health, highlights = {}, seq = 1, width = 100, color = false, at = null }) {
	const paint = (tone, text) => (color ? `${ANSI[tone] ?? ""}${text}${ANSI.reset}` : text);
	const seats = health?.seats ?? [];
	const stamp = at ?? new Date().toTimeString().slice(0, 8);
	const header = `durig · ${seats.length} seat${seats.length === 1 ? "" : "s"} · db ${db} · watch #${seq} · ${stamp}`;
	const rule = "─".repeat(Math.min(width, Math.max(header.length, 60)));
	const lines = [header, rule];

	if (!seats.length) {
		// Same guardrail as stderr elsewhere, in the form a watcher will see:
		// an empty dashboard must never look like a healthy quiet rig.
		lines.push(
			"No seats in this database.",
			"If you meant a different rig, set DURIG_DB or create durig.config.json.",
			"Check with: node cli.mjs config",
			"",
			rule,
		);
		return lines.join("\n");
	}

	const nameCol = Math.min(14, Math.max(...seats.map((s) => s.name.length)) + 2);
	// One role is longer than the cap ("implementation engineer"), so the
	// column reserves a separator space rather than letting the padding vanish
	// and run the role into the activity text.
	const roleCol = Math.min(24, Math.max(...seats.map((s) => (s.role ?? "").length)) + 2);
	const focusAt = 6 + nameCol + roleCol;

	for (const seat of seats) {
		const activity = seatActivity(seat, health, highlights[seat.name]);
		const role = truncate(sanitizeTerminalText(seat.role ?? ""), roleCol - 1);
		const head = `${paint(activity.tone, activity.glyph)} ${pad(seat.name, nameCol)}${pad(role, roleCol)}`;
		lines.push(`${head}${truncate(activity.focus, width - focusAt)}`);
		const says = highlights[seat.name]?.says;
		// The in-flight partial is shown on its own line, never merged into the "says"
		// quote: that quote is committed history, and this text may be rewritten or
		// withdrawn by the next poll (ROADMAP 40c).
		const stream = health.streaming?.[seat.name];
		if (stream) {
			const live = sanitizeTerminalText(stream.text || stream.thinking || stream.tools.map((t) => t.name).join(", ") || "…");
			lines.push(paint("cyan", `      ⟳ streaming: ${truncate(live, width - 20)}`));
		}
		const quote = says ? truncate(sanitizeTerminalText(says), width - 14) : "(nothing said yet)";
		lines.push(paint("dim", `      ↳ ${quote}`));
	}

	// A parked item is counted, not just listed in the notice line: a deferred item
	// that appears in none of these totals makes the footer read "0 queued, 0
	// claimed, 0 done" while work sits parked, which looks like an idle rig.
	// Shown only when non-zero so the footer stays stable for rigs that never defer.
	const counts = { queued: 0, claimed: 0, deferred: 0, done: 0 };
	for (const item of health.queueItems ?? []) {
		if (counts[item.status] !== undefined) counts[item.status] += 1;
	}
	const attention = (health.attention ?? []).map((a) => `${a.seat ?? a.scope} ${a.kind}`);
	lines.push(rule);
	lines.push(
		paint(
			"dim",
			`queue ${counts.queued} queued · ${counts.claimed} claimed · ${counts.done} done` +
				(counts.deferred > 0 ? ` · ${counts.deferred} deferred` : "") +
				`  |  attention: ${attention.length ? attention.join(", ") : "none"}`,
		),
	);
	return lines.join("\n");
}

// `clear` is reserved for an interactive terminal: wiping the screen is right
// for a live dashboard and wrong for a pipe, where the appended snapshots are
// the scrollback a person actually reads.
export function createWatchScreen({ write, color = false, clear = false } = {}) {
	const sink = write ?? ((text) => process.stdout.write(text));
	return {
		render(text) {
			sink(clear ? `\x1b[H\x1b[2J${text}\n` : `${text}\n`);
		},
		note(text) {
			sink(`${text}\n`);
		},
	};
}
