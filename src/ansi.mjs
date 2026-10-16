// The one ANSI palette the human views share.
//
// watchview and chatview each carried their own copy, which is how a palette
// drifts: chatview had magenta and no yellow, watchview the reverse. The union
// lives here so a new view picks up the same escapes instead of a third copy.
// `truncate` is deliberately NOT shared: the two copies disagree on the
// width<=1 edge case, so unifying them would be a behavior change, not a
// cleanup, and belongs with the view model extraction (ROADMAP item 7).
export const ANSI = {
	reset: "\x1b[0m",
	dim: "\x1b[2m",
	bold: "\x1b[1m",
	// Reverse video is the canonical "current selection" signal (the TUI design
	// skill's visual-patterns): it works back to VT100 and survives every theme.
	reverse: "\x1b[7m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	red: "\x1b[31m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m",
};
