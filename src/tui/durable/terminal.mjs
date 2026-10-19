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
