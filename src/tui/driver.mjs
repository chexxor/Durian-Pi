// src/tui/driver.mjs — U1: the `durig ui` DRIVER that owns raw mode + key handling
// + the poll loop and paints renderTui frames.
//
// ONE concern (U1): the interactive driver. The screen/rendering stays in
// src/tui/client.mjs (pure, headless); the data reads come from readapi/viewmodel
// through an injected `readState` (viewer read-only, no harness — D11: poll);
// cli.mjs stays non-interactive (D21) and ui.mjs is the separate entrypoint.
//
// Contracts held here:
// - Poll, not freelock: paint on input/data/resize only (never an unconditional
//   render loop); a tick that is still running is skipped, never queued/executed
//   concurrently; a failed read is caught and surfaced INSIDE the next frame.
// - Every exit path restores the terminal: raw mode off, cursor visible, alt-screen
//   buffer left (the entrypoint installs the enter/leave sequences via onCleanup).
// - Keys: q / ESC / Ctrl+C → onExit("quit"); r → one immediate tick (refresh).
//   Any other key is ignored (nothing to type: the TUI is read-only, D40/D11).
// - Width is measured in terminal CELLS (stdout.columns/rows via injected getSize);
//   the client truncates per-cell, so CJK/emoji wide rows degrade by truncation, not
//   by wrapping mid-cell.
//
// Headless: NO terminal work happens inside this module — everything terminal-owned
// (raw mode, sequences, stdin wiring) is injected, so the suite exercises the
// tick/key/cleanup state machine without a TTY. Keyboard feelings are validated on
// the operator's real Windows terminal (Windows Terminal / psmux), never Git Bash.

import { renderTui, frameToLines } from "./client.mjs";

const DEFAULT_POLL_MS = 700; // D11: poll ≤ 750 ms so a fan feels live, not busy.

const ERR_FRAME_MAX = 120;

/* ───────── createUiDriver ───────── */

/**
 * Build the read-only TUI driver.
 *
 * @param {object} io
 * @param {() => {width:number, height:number}} io.getSize — current terminal cells.
 * @param {() => Promise<{seats, turns, partial, health, queueItems}>} io.readState —
 *   read-only store read (readapi/viewmodel). Must resolve; throws are handled.
 * @param {(payload: {lines: string[], width: number, kind: "frame"|"error"}) => void} io.paint —
 *   repaint the screen with the given lines (entrypoint writes the buffer).
 * @param {(reason: "quit") => void} [io.onExit] — invoked once per quit request.
 * @param {(delta: -1|1) => void} [io.onNavigate] — up/down request; the ENTRYPOINT owns the
 *   selected seat (it also owns readState), so the driver stays a pure key/tick machine.
 * @param {() => void} [io.onEnter] — Enter request (open the selected seat's conversation).
 * @param {() => void} [io.onTail] — jump-to-live-tail request (re-enable auto-follow).
 * @param {(() => void)|null} [io.onBack] — Esc request. When provided, ESC is "back" (the
 *   entrypoint decides whether that leaves a view or quits); when absent, ESC quits, so a
 *   caller that does not implement modes keeps the original behavior.
 * @param {number} [io.pollMs] — poll interval (default 700).
 * @param {boolean} [io.color] — pass-through to renderTui (NO_COLOR respected by caller).
 */
export function createUiDriver({ getSize, readState, paint, onExit = () => {}, onNavigate = () => {}, onEnter = () => {}, onTail = () => {}, onBack = null, onInput = () => {}, pollMs = DEFAULT_POLL_MS, color = false }) {
	let timer = null;
	let running = false; // a tick is in flight
	let stopped = false; // cleanup happened
	let tickScheduled = false; // a follow-up tick is queued because one was in flight

	async function tick(now = Date.now()) {
		if (stopped) return;
		if (running) {
			// Coalesce: one follow-up tick after the in-flight one completes, never
			// concurrent renders (never block/double-paint the render thread).
			tickScheduled = true;
			return;
		}
		running = true;
		try {
			const state = await readState();
			if (stopped) return;
			const { width, height } = getSize();
			const frame = renderTui({ ...state, width, height, color: Boolean(color) });
			paint({ kind: "frame", lines: frame.lines, width });
		} catch (err) {
			// A failed poll must not kill the session: report inside the frame area on
			// stderr-handoff (the entrypoint routes errors to stderr) and keep polling;
			// transient storage races self-heal on the next tick (same rule as `watch`).
			if (!stopped) {
				paint({
					kind: "error",
					lines: [`  (poll failed: ${String(err?.message ?? err).slice(0, ERR_FRAME_MAX)})`],
					width: getSize().width,
				});
			}
		} finally {
			running = false;
			if (tickScheduled && !stopped) {
				tickScheduled = false;
				setImmediate(() => {
					if (!stopped) void tick();
				});
			}
		}
	}

	function schedulePoll() {
		timer = setTimeout(() => {
			timer = null;
			void tick();
			if (!stopped) schedulePoll();
		}, pollMs);
	}

	/** Stop the poll loop and report the quit once. */
	function requestQuit() {
		if (!stopped) stopped = true;
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		onExit("quit");
	}

	/** Map one decoded key to driver behaviour. Returns true when handled. */
	function handleKey(key) {
		if (stopped) return false;
		if (key === "q" || key === "\x03") {
			requestQuit();
			return true;
		}
		if (key === "\x1b") {
			// Enter/back is the entrypoint's call: in the seat list ESC quits, in the
			// conversation view it returns to the list. A driver with no onBack keeps
			// the original ESC=quit behavior.
			if (onBack) {
				onBack();
				return true;
			}
			requestQuit();
			return true;
		}
		if (key === "r") {
			void tick();
			return true;
		}
		if (key === "up" || key === "down") {
			onNavigate(key === "up" ? -1 : 1);
			return true;
		}
		if (key === "enter") {
			onEnter();
			return true;
		}
		if (key === "tail") {
			onTail();
			return true;
		}
		if (key === "input") {
			onInput();
			return true;
		}
		return false; // read-only TUI: unknown keys are consumed silently
	}

	function start() {
		if (stopped) return;
		if (timer) return; // already started
		void tick(); // first paint immediately
		schedulePoll();
	}

	async function cleanup() {
		stopped = true;
		tickScheduled = false;
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
	}

	return { start, tick, handleKey, cleanup };
}

/* ───────── decode stdin chunks ───────── */

/** Decode a raw-mode stdin chunk into key tokens.
 *
 * Arrow keys are CSI sequences (`ESC [ A/B/C/D`) and must be consumed WHOLE: the
 * naive per-character decode saw the leading ESC as "quit", so pressing an arrow
 * exited the TUI. A bare ESC (nothing following) is still quit. `j`/`k` are
 * aliases for down/up; the rest is ignored (read-only surface). */
export function decodeKeys(chunk) {
	const s = String(chunk);
	const keys = [];
	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		if (ch === "\x1b") {
			if (s[i + 1] === "[") {
				const code = s[i + 2];
				if (code === "A") keys.push("up");
				else if (code === "B") keys.push("down");
				else if (code === "F") keys.push("tail"); // End key
				i += 2; // consume the CSI sequence so its bytes are never re-read
				continue;
			}
			keys.push("\x1b");
			continue;
		}
		if (ch === "\x03") keys.push("\x03");
		else if (ch === "q") keys.push("q");
		else if (ch === "r") keys.push("r");
		else if (ch === "j") keys.push("down");
		else if (ch === "k") keys.push("up");
		else if (ch === "G") keys.push("tail");
		else if (ch === "i") keys.push("input");
		else if (ch === "\r" || ch === "\n") keys.push("enter");
	}
	return keys;
}

// frameToLines re-exported so demos/tests can assert frame text identically to the C3 suite.
export { frameToLines };
