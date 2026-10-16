// src/tui/sync.mjs — DECSET 2026 (synchronized output): the terminal buffers
// everything between BSU and ESU and repaints once, so a full clear+rewrite never
// shows a half-written frame. Windows Terminal supports it, per
// vendor/eval/vt-extensions/synchronized-output.md.
//
// Emitting the pair unconditionally is safe — a terminal that does not implement
// 2026 ignores it — so the wrapper defaults ON for a TTY. The DECRQM probe is only an
// optimisation that turns it OFF when the terminal explicitly says it cannot; if no
// reply ever arrives, the wrapper stays on, which is the working fallback.

export const SYNC_START = "\x1b[?2026h";
export const SYNC_END = "\x1b[?2026l";
export const SYNC_QUERY = "\x1b[?2026$p";

// DECRPM reply: CSI ? 2026 ; Ps $ y. Ps 0 = not recognised, 1 = set, 2 = reset,
// 3 = permanently set, 4 = permanently reset. Only 0 and 4 mean "cannot do it".
const DECRPM_2026 = /\x1b\[\?2026;(\d+)\$y/g;

export function createSyncState({ isTTY = false, env = {} } = {}) {
	let enabled = Boolean(isTTY) && env.DURIG_TUI_NO_SYNC !== "1";
	return {
		get enabled() {
			return enabled;
		},
		wrap(text) {
			return enabled ? `${SYNC_START}${text}${SYNC_END}` : text;
		},
		// The probe's reply arrives on stdin and would otherwise be read as stray
		// keys, so consume() removes it AND honors it in one pass. A missing reply
		// never disables the wrapper (an unsupporting terminal simply ignores BSU/ESU).
		consume(chunk) {
			return String(chunk ?? "").replace(DECRPM_2026, (_match, ps) => {
				if (ps === "0" || ps === "4") enabled = false;
				return "";
			});
		},
	};
}
