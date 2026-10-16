// src/tui/paint.mjs — compose one full-screen frame into the bytes written to
// stdout. Kept pure (no process/timers) so the height clip and the sync-output
// wrapper are testable without a TTY.

export const CLEAR = "\x1b[H\x1b[2J";

/**
 * Home+clear, then the frame's rows, clipped to the terminal height.
 *
 * @param {string[]} lines — the frame rows from renderTui.
 * @param {object} [opts]
 * @param {number} [opts.height] — terminal rows; extra rows are dropped (a frame
 *   taller than the viewport would scroll, tearing the layout).
 * @param {{wrap: (s: string) => string}} [opts.sync] — a src/tui/sync.mjs state;
 *   when supplied and enabled, the whole frame is wrapped in DECSET 2026 so the
 *   terminal draws it atomically.
 */
export function composeFrame(lines, { height, sync } = {}) {
	const rows = Array.isArray(lines) ? lines : [];
	const h = Number.isFinite(height) ? height : rows.length;
	let out = CLEAR;
	for (let i = 0; i < Math.min(rows.length, h); i++) {
		out += `${i > 0 ? "\r\n" : ""}${rows[i]}`;
	}
	return sync ? sync.wrap(out) : out;
}
