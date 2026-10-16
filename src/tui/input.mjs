// src/tui/input.mjs — the type-to-seat input line and its bracketed-paste handling.
//
// Pure: no TTY, no store, no timers, so the line-editing and paste state machine is
// testable headlessly. The entrypoint owns the mode; while input is active it routes
// raw bytes HERE instead of to the key decoder, which is what makes a typed `q` a
// literal character and not a quit.
//
// Bracketed paste (DECSET 2004) arrives as ESC[200~ <payload> ESC[201~. The payload is
// literal data: a newline inside it must not submit, and control bytes must not reach
// the intent. Markers can be split across reads, so an incomplete marker is buffered
// rather than misread as text.

export const PASTE_START = "\x1b[200~";
export const PASTE_END = "\x1b[201~";

function isPrefixOf(text, marker) {
	// A marker prefix shorter than the marker means "wait for the rest"; equal length
	// is a complete marker and is handled before this check.
	return text.length < marker.length && marker.startsWith(text);
}

export function createInputLine() {
	let buffer = "";
	let pasting = false;
	let pending = ""; // an escape sequence split across reads

	function insertText(text) {
		buffer += String(text ?? "");
	}
	function backspace() {
		buffer = buffer.slice(0, -1);
	}

	/**
	 * Parse one raw stdin chunk. Returns `{ submitted, cancelled }`; the current text
	 * is read from `value`. Everything that is not Enter/Esc/backspace is literal.
	 */
	function feed(chunk) {
		const s = pending + String(chunk ?? "");
		pending = "";
		let i = 0;
		while (i < s.length) {
			const code = s.charCodeAt(i);

			if (code === 0x1b) {
				const rest = s.slice(i);
				if (s.startsWith(PASTE_START, i)) {
					pasting = true;
					i += PASTE_START.length;
					continue;
				}
				if (s.startsWith(PASTE_END, i)) {
					pasting = false;
					i += PASTE_END.length;
					continue;
				}
				if (rest === "\x1b") {
					// A lone ESC is the Escape key. (A paste marker split exactly at the ESC is
					// rare; treating it as Escape avoids a byte stuck pending forever.)
					if (pasting) {
						i += 1;
						continue;
					}
					return { submitted: false, cancelled: true };
				}
				if (isPrefixOf(rest, PASTE_START) || isPrefixOf(rest, PASTE_END)) {
					pending = rest;
					break;
				}
				if (pasting) {
					// A control sequence inside the payload is DATA, not a key; only the end
					// marker closes the paste, so drop the ESC and keep scanning.
					i += 1;
					continue;
				}
				if (rest.startsWith("\x1b[") || rest.startsWith("\x1bO")) {
					// A CSI/SS3 key (arrows, etc.): consume to its final byte and ignore
					// it — the input line has no arrow-key editing yet, and ignoring is
					// safer than inserting the sequence's bytes as text.
					let j = i + 2;
					while (j < s.length && /[0-9;?<>=]/.test(s[j])) j++;
					if (j >= s.length) {
						pending = rest;
						break;
					}
					i = j + 1;
					continue;
				}
				// Any other ESC is a bare Escape press -> cancel.
				return { submitted: false, cancelled: true };
			}

			if (pasting) {
				if (code === 0x0a || code === 0x0d) {
					insertText(" "); // a paste is one line
					i += 1;
					continue;
				}
				if (code >= 0x20 && code !== 0x7f) insertText(s[i]);
				i += 1;
				continue;
			}

			if (code === 0x0d || code === 0x0a) return { submitted: true, cancelled: false };
			if (code === 0x7f || code === 0x08) {
				backspace();
				i += 1;
				continue;
			}
			if (code === 0x03) return { submitted: false, cancelled: true };
			if (code >= 0x20 && code !== 0x7f) insertText(s[i]);
			i += 1;
		}
		return { submitted: false, cancelled: false };
	}

	return {
		get value() {
			return buffer;
		},
		get pasting() {
			return pasting;
		},
		set value(v) {
			buffer = String(v ?? "");
		},
		clear() {
			buffer = "";
			pending = "";
			pasting = false;
		},
		backspace,
		insertText,
		feed,
	};
}
