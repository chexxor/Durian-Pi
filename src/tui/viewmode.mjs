// src/tui/viewmode.mjs — the TUI's view state: the seat list, the conversation, and the
// INPUT OVERLAY that sits ON TOP of whichever one is current.
//
// Why this is its own module (ROADMAP 99 / bug): `i` used to be a THIRD view. Pressing
// `i` set the mode to "input", the renderer dispatched on `view === "conversation"`, and
// the conversation was replaced by the seat list with an input row appended — typing over
// a conversation DROPPED it, and Esc/submit always returned to the seat list. Input is an
// OVERLAY, not a view: entering it REMEMBERS the view underneath, and closing it RESTORES
// that view, so a submit/cancel over a conversation lands back in that conversation.
//
// Pure and headless — no TTY, no store, no timers — so the transitions are testable
// without a terminal. The entrypoint (ui.mjs) owns the instance; the driver stays a pure
// key/tick machine.

export const VIEW_SEATS = "seats";
export const VIEW_CONVERSATION = "conversation";
export const MODE_INPUT = "input";

/**
 * Build the view/overlay state machine.
 *
 * @param {string} [initial] starting view; only VIEW_CONVERSATION is honoured, anything
 *   else falls back to VIEW_SEATS (an unknown view must not become a silent third mode).
 */
export function createViewMode(initial = VIEW_SEATS) {
	let view = initial === VIEW_CONVERSATION ? VIEW_CONVERSATION : VIEW_SEATS;
	let inputting = false; // the input overlay is open over `view`
	let returnTo = VIEW_SEATS; // the view the overlay was opened over

	return {
		/** The view the renderer draws UNDER the overlay: VIEW_SEATS | VIEW_CONVERSATION. */
		get view() {
			return view;
		},
		/** True while the input overlay is open. */
		get inputting() {
			return inputting;
		},
		/** The full mode: MODE_INPUT while the overlay is open, else the view. */
		get mode() {
			return inputting ? MODE_INPUT : view;
		},
		/** Enter on the seat list: open the focused seat's conversation. Returns the view. */
		openConversation() {
			view = VIEW_CONVERSATION;
			return view;
		},
		/** Esc in the conversation: return to the seat list. Returns the view. */
		closeConversation() {
			view = VIEW_SEATS;
			return view;
		},
		/**
		 * Open the input overlay over the CURRENT view. Returns false when it is already
		 * open, so a double `i` cannot clobber the remembered view (which would send the
		 * operator back to the seat list after typing over a conversation).
		 */
		enterInput() {
			if (inputting) return false;
			returnTo = view;
			inputting = true;
			return true;
		},
		/**
		 * Close the overlay and RESTORE the view it was opened over. Returns that view.
		 * A no-op (returns the current view) when the overlay is not open.
		 */
		exitInput() {
			if (!inputting) return view;
			inputting = false;
			view = returnTo;
			returnTo = VIEW_SEATS;
			return view;
		},
	};
}
