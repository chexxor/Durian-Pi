// The human view of `watch`. It answers three questions per seat - who is it,
// what are they saying, what are they working on - because that is the reading
// a person does when they open a second terminal. The JSON form remains the
// contract for scripts; this is the same snapshot rendered for eyes (see
// docs/RESEARCH.md for the conventions borrowed from comparable systems).

const ANSI = {
	reset: "\x1b[0m",
	dim: "\x1b[2m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	red: "\x1b[31m",
	cyan: "\x1b[36m",
};

// Collapse whitespace before truncating: model prose arrives with newlines and
// indentation that would otherwise break the one-line-per-seat layout.
export function truncate(text, width) {
	const flat = String(text ?? "")
		.replace(/\s+/g, " ")
		.trim();
	if (flat.length <= width) return flat;
	if (width <= 1) return flat.slice(0, Math.max(width, 0));
	return `${flat.slice(0, width - 1)}…`;
}

export function pad(text, width) {
	const s = String(text ?? "");
	return s.length >= width ? s : s + " ".repeat(width - s.length);
}

// Attention kinds are the vocabulary the rig already uses; the human view only
// maps them to a glyph and a word, never re-derives the state itself.
export function seatActivity(seat, health, highlight) {
	const items = health?.queueItems ?? [];
	const claimed = items.find((it) => it.to === seat.name && it.status === "claimed");
	const queued = items.find((it) => it.to === seat.name && it.status === "queued");
	const routed = items.find((it) => it.from === seat.name && it.status !== "done");
	const notices = (health?.attention ?? []).filter((a) => a.seat === seat.name);
	const failed = notices.find((a) => a.kind === "last_run_failed");
	const generating = notices.find((a) => a.kind === "generation_in_flight");

	let glyph = "○";
	let tone = "dim";
	let state = "idle";
	if (failed) {
		glyph = "✖";
		tone = "red";
		state = "failed";
	} else if (generating) {
		glyph = "●";
		tone = "green";
		state = "generating";
	} else if (claimed) {
		glyph = "●";
		tone = "green";
		state = "working";
	} else if (notices.length) {
		glyph = "!";
		tone = "yellow";
		state = "waiting";
	}

	let focus;
	if (claimed) focus = `working on #${claimed.id} ${claimed.subject}`;
	else if (queued) focus = `has #${queued.id} queued: ${queued.subject}`;
	else if (routed) focus = `sent #${routed.id}: ${routed.subject}`;
	else if (highlight?.toolName) focus = `last action: ${highlight.toolName}`;
	else focus = "no queue activity yet";

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
		const role = truncate(seat.role ?? "", roleCol - 1);
		const head = `${paint(activity.tone, activity.glyph)} ${pad(seat.name, nameCol)}${pad(role, roleCol)}`;
		lines.push(`${head}${truncate(activity.focus, width - focusAt)}`);
		const says = highlights[seat.name]?.says;
		const quote = says ? truncate(says, width - 14) : "(nothing said yet)";
		lines.push(paint("dim", `      ↳ ${quote}`));
	}

	const counts = { queued: 0, claimed: 0, done: 0 };
	for (const item of health.queueItems ?? []) {
		if (counts[item.status] !== undefined) counts[item.status] += 1;
	}
	const attention = (health.attention ?? []).map((a) => `${a.seat} ${a.kind}`);
	lines.push(rule);
	lines.push(
		paint(
			"dim",
			`queue ${counts.queued} queued · ${counts.claimed} claimed · ${counts.done} done` +
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
