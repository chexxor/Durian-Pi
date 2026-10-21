// A headless Terminal for pi-tui.
//
// The pi TUI takes a Terminal by injection (createInteractiveTui accepts
// options.terminal), so a fake one lets the whole InteractiveMode boot and run
// without a real TTY. We keep the raw byte stream the renderer writes: that
// stream is the evidence that a frame reached the screen.
//
// Control methods emit the ANSI sequence a real terminal would accept, rather
// than being no-ops, so the captured stream is a faithful transcript. (pi-tui's
// renderers only call write/columns/rows/hideCursor/showCursor; the remaining
// members exist because the Terminal interface requires them.)
const ESC = "\u001b";

export class CapturingTerminal {
	/** Raw bytes the renderer wrote, in order. */
	writes = "";
	started = false;
	columns = 100;
	rows = 30;
	kittyProtocolActive = false;
	title;
	progress = false;
	programStatus;
	#onInput = () => {};
	#onResize = () => {};

	start(onInput, onResize) {
		this.#onInput = onInput;
		this.#onResize = onResize;
		this.started = true;
	}

	stop() {
		this.started = false;
	}

	async drainInput() {}

	write(data) {
		this.writes += data;
	}

	moveBy(lines) {
		if (lines > 0) this.writes += `${ESC}[${lines}B`;
		else if (lines < 0) this.writes += `${ESC}[${-lines}A`;
	}

	hideCursor() {
		this.writes += `${ESC}[?25l`;
	}

	showCursor() {
		this.writes += `${ESC}[?25h`;
	}

	clearLine() {
		this.writes += `${ESC}[2K`;
	}

	clearFromCursor() {
		this.writes += `${ESC}[J`;
	}

	clearScreen() {
		this.writes += `${ESC}[H${ESC}[2J`;
	}

	setTitle(title) {
		this.title = title;
		this.writes += `${ESC}]0;${title}\u0007`;
	}

	setProgress(active) {
		this.progress = active;
	}

	setProgramStatus(status) {
		this.programStatus = status;
	}

	/** Deliver input bytes to the renderer's handler, as a real keyboard would. */
	send(data) {
		this.#onInput(data);
	}

	/** Fire the resize callback after changing columns/rows, as a terminal would. */
	resize(columns, rows) {
		if (columns !== undefined) this.columns = columns;
		if (rows !== undefined) this.rows = rows;
		this.#onResize();
	}

	/** Everything written since the last call, for a per-frame assertion. */
	takeWrite() {
		const taken = this.writes;
		this.writes = "";
		return taken;
	}
}

/**
 * Stop an `InteractiveMode` AT MOST ONCE (#4267).
 *
 * THE DEFECT THIS CLOSES, measured on Windows: calling `mode.stop()` twice passes every logical
 * assertion and then CRASHES IN CLEANUP with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`
 * (libuv src\win\async.c:94) ? the second call touches an async handle that is already closing.
 *
 * WHY A WRAPPER AND NOT ONLY THE DELETION: `try { ? stop() } finally { stop() }` is a NATURAL shape, not
 * a careless one, so the next test will have it too. The guard is a WeakSet because `mode` is a library
 * object we do not own ? nothing is written onto it, and a collected mode takes its entry with it.
 *
 * @returns {boolean} true when this call stopped it, false when it was already stopped.
 */
const stoppedModes = new WeakSet();

export function stopModeOnce(mode) {
	if (!mode || typeof mode.stop !== "function") return false;
	if (stoppedModes.has(mode)) return false;
	stoppedModes.add(mode);
	mode.stop();
	return true;
}
