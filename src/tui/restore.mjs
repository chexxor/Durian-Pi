// src/tui/restore.mjs — terminal ownership for the interactive entrypoint, kept
// out of ui.mjs so the restore ORDER and its idempotency can be tested without a
// TTY. An abnormal exit (uncaught throw, rejected promise) must leave the operator's
// shell usable: raw mode off, cursor visible, and off the alternate screen. A
// stranded alt-screen with a hidden cursor is what pushes an operator to paste a
// recovery command, so this is the other half of the sanitise work (D70): one plants
// the payload, the other delivers it.
//
// Restore is deliberately SYNCHRONOUS: it runs from `process.on("exit")`, where no
// async work can be awaited, and from an exception handler that must not depend on
// the (async) quit path completing.

export const ENTER_ALT = "\x1b[?1049h";
export const LEAVE_ALT = "\x1b[?1049l";
export const HIDE_CURSOR = "\x1b[?25l";
export const SHOW_CURSOR = "\x1b[?25h";
export const CLEAR = "\x1b[H\x1b[2J";

/**
 * Own the terminal's alt screen, cursor and raw mode.
 *
 * @param {object} io
 * @param {NodeJS.WriteStream} io.stdout — escape sink; a non-TTY is left untouched.
 * @param {NodeJS.ReadStream} io.stdin — raw-mode owner; a non-TTY is left untouched.
 */
export function createTerminalScreen({ stdout, stdin } = {}) {
	let altActive = false;
	let restored = false;

	function enter() {
		if (!stdout?.isTTY) return;
		stdout.write(ENTER_ALT + HIDE_CURSOR + CLEAR);
		altActive = true;
	}

	// Restore returns the failures instead of logging them, because on an abnormal
	// exit stderr itself may be the thing that is gone. Callers that still have a
	// reporter (see ui.mjs's fatal handler) surface them; the raw-mode restore below
	// is attempted regardless, so one failed write cannot strand the terminal.
	function restore() {
		const errors = [];
		// Latch FIRST: a second call (e.g. SIGINT then `exit`) must be a no-op, and a
		// throw from a dying stdout must not skip the raw-mode restore below.
		if (restored) return { restored: false, errors };
		restored = true;
		if (altActive && typeof stdout?.write === "function") {
			try {
				// Cursor before alt-leave: the reset writes to the screen we are about
				// to leave, and the shell prompt must not inherit a hidden cursor.
				stdout.write(SHOW_CURSOR + CLEAR + LEAVE_ALT);
			} catch (err) {
				errors.push(err);
			}
			altActive = false;
		}
		if (stdin?.isTTY && typeof stdin.setRawMode === "function") {
			try {
				stdin.setRawMode(false);
			} catch (err) {
				errors.push(err);
			}
		}
		return { restored: true, errors };
	}

	return { enter, restore };
}
