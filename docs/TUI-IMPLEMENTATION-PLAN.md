# durig TUI app — implementation plan

**Status:** plan of record. The hardening items in §C are **operator-approved** (2026-10-16) and
recorded as the D70 recommendation; the remaining gaps in §D carry open rulings.
**Home of the design rationale:** `docs/UI-TUI-INITIAL-THINKING.md` (incl. Appendix A) and
`docs/DECISIONS.md` D57/D61/D68/D69/D70.
**Evidence base:** `docs/reviews/tui-streaming-research.md` — an external TUI best-practice survey,
re-verified against this tree (see its §"Repo-grounded verification and adjustments").

## How to read this

- One item = **one concern**, with a **failing-first** test and an explicit acceptance.
- The **delegate records this plan**; `pm` decomposes/registers the queue ids; `impl` builds and
  `qa`/`auditor` verify (three-actor model — a plan item is not a queue claim). Where a queue id is
  known it is named; items without one are candidates for `pm` to register.
- "Where" is grounded in the tree at `697f376`; line numbers will drift, symbol names should not.
- Native Windows only. No push/publish without the operator's grant.

## Priority order (2026-10-16)

Ranked by user value × readiness, grounded in the plan and the live non-terminal queue. Section
letters name the item; the order is the recommendation, not a pm ruling.

| # | Item | Why now | Status / queue |
|---|---|---|---|
| 1 | **B1 type-to-seat input** | The stated current item; the write substrate (D68) is ready and the screen model is settled (D69) | Unregistered → `pm`; must land with **H5** |
| 2 | **B2 TUI close-out** | Already queued; the 48-col golden half now exists (H7), lifecycle cleanup remains | `#662` queued to impl |
| 3 | **H4 cell-width (`src/textwidth.mjs`)** | The harness's provisional `cellWidth` is the seam; CJK/emoji layout is wrong without it | Not built |
| 4 | **H3 DECSET 2026 sync output** | Small, isolated, kills frame tearing; Windows Terminal supports it | Not built |
| 5 | **H6 resize / too-small** | A drag-resize or tiny pane can currently render stale/torn | Not built |
| 6 | **H8 anchored scroll + "N new"** | Reading a live stream jumps when new turns arrive | Not built |
| 7 | **H7 Tier 3/4 tests** | Tier 1/2 landed; interaction + optional PTY remain | Partly landed |
| 8 | **§D rulings G1–G4** | Blocked on operator/lead, not on work | Open |

**Done already:** H1 sanitise, H2 restore, H7 Tier 1/2 (commits `18b372a`, `aea7e74`).

---

## A. Landed (context)

| Piece | What | Where | Proof |
|---|---|---|---|
| Read seam | `readapi` + `viewmodel` (pure; no harness in a viewer, D11/D24) | `src/readapi.mjs`, `src/viewmodel.mjs` | `demo/readapi.test.mjs`, `demo/viewmodel.test.mjs` |
| C3 renderer | Pure headless `renderTui`/`Frame` | `src/tui/client.mjs` | `demo/tui-client.test.mjs` |
| U1 driver | Raw mode + key handling + poll loop; terminal work injected | `src/tui/driver.mjs`, `ui.mjs` | `demo/ui-driver.test.mjs` |
| U2–U5 | team-wide streaming, in-place tool blocks, thinking parity, roles | `src/tui/client.mjs` | `demo/tui-multipane.test.mjs`, `demo/tui-toolblock.test.mjs`, `demo/tui-thinking.test.mjs`, `demo/tui-roles.test.mjs` |
| Rich conversation view (D69) | Enter opens the focused seat; `↑↓` scroll; `Esc` back; `G`/`End` to the tail; line-budgeted, wrapped, full-width | `src/tui/client.mjs`, `ui.mjs` | `demo/tui-conversation.test.mjs` |
| Intent-inbox write substrate (D68) | `writeIntent` spools; the broker drains — the TUI stays a viewer | `intent.mjs`, `src/broker.mjs` | `demo/broker-inbox.test.mjs` |

---

## B. In flight

### B1 — Type-to-seat input line (delegate-owned; UNREGISTERED — candidate for pm)
**Goal:** an input line that sends text straight to the selected seat via `writeIntent` (D68), so the
TUI never opens the store.
**Queue id:** none. An earlier draft cited `#624`, but that is the `init` meta-defaults item (now
`done`); no non-terminal queue row names type-to-seat, so `pm` must register it (the delegate does not
route queue items).
**Prerequisite added by this plan (D70 §5):** **bracketed paste (DECSET 2004)** must land with the
input line, not after it — see §C-H5. Raw-mode line editing without bracketed paste can execute a
multi-line paste.
**Where:** `ui.mjs` (mode + key wiring), `src/tui/driver.mjs` (edit keys), a new input module.
**Screen model:** settled for `ui.mjs` by D69 pending operator/lead ratification.
**Test:** `demo/tui-input.test.mjs` (failing-first): a typed line produces exactly one intent file; a
`q` in the text is not a quit; a bracketed paste containing newlines is one line, not N submits.

### B2 — TUI close-out (#662)
**Goal:** 48-column golden frame + terminal lifecycle cleanup.
**Where:** `demo/tui-conversation.test.mjs`, `ui.mjs`.
**Note:** overlaps the restore work in §C-H2 — sequence H2 before or with B2.

---

## C. Agreed hardening (operator-approved 2026-10-16; D70) — NEW

Ordered by user harm. H1 and H2 are one unit of work: injection plants the payload, a failed restore
delivers the paste.

### H1 — Sanitise untrusted text at every human render boundary (SECURITY, highest harm)
**Goal:** model/tool text can never emit a terminal control sequence the app did not choose.
**Why:** raw text reaches the terminal today — `src/viewmodel.mjs buildTurns` → `src/tui/client.mjs`;
`src/chatview.mjs:255` (the `log`/`log --follow` path); `src/watchview.mjs` streaming/quotes. OSC 52
(clipboard write) and OSC 8 (hyperlink spoof) are the real blast radius; the clipboard is poisoned
silently and detonates when the operator pastes.
**Design:** one pure helper `sanitizeTerminalText(text)` in a new `src/sanitize.mjs`:
- allow only a **strict SGR subset** (`\x1b[0m`,`1m`,`2m`,`7m`,`30–37m`,`39m`) plus `\n` and `\t`;
- strip every other C0 control, and all ESC/CSI/OSC/DCS sequences (including their payloads);
- never strip plain text or the allowed SGR — content is preserved, only control is removed.
Apply it at the point text enters a rendered line: `client.mjs` (`transcriptTurnLines`,
`renderPartial`), `chatview.mjs` (`formatChat`/`formatPartial`), `watchview.mjs` (`formatSnapshot`
streaming/quote). Defence in depth: also apply once on ingest in `viewmodel` is optional, but the
render boundaries are the correctness requirement because `log`/`watch` do not pass through the
viewmodel.
**Where:** `src/sanitize.mjs` (new), `src/tui/client.mjs`, `src/chatview.mjs`, `src/watchview.mjs`.
**Test (failing-first):** `demo/sanitize.test.mjs` — a turn whose text contains `\x1b]52;c;…\x07`,
`\x1b]8;;https://evil\x07link`, `\x1b]0;spoofed\x07`, and a raw `\x1b[2J` renders with **no ESC**
other than the app's own allowlisted SGR; the same assertions through `chatview` and `watchview`;
negative control: an allowed `\x1b[1m` bold survives.
**Acceptance:** `frameToLines` of an injected fixture contains the literal text and no unexpected ESC;
existing TUI/chat/watch demos stay green.
**Status:** LANDED (uncommitted, 2026-10-16) — `src/sanitize.mjs`, wired into `client.mjs`,
`chatview.mjs`, `watchview.mjs`; `demo/sanitize.test.mjs`. 8-bit C1 introducers and the 0x9C
terminator are handled too (from `chalk/ansi-regex`).
**Ruling needed:** none — the operator approved sanitise-by-default.

### H2 — Terminal restore on every abnormal path (ROBUSTNESS)
**Goal:** an uncaught error, rejected promise, or `process.exit` never leaves raw mode, a hidden
cursor, or the alt screen behind.
**Why:** `ui.mjs` registers only `SIGINT`/`SIGTERM` + a top-level `try/catch`;
`uncaughtException`/`unhandledRejection`/`exit` appear nowhere in `src/`, `ui.mjs` or `cli.mjs`. The
current `quit()` is **async** (`await driver.cleanup(); await storage.close()`), so it cannot be
depended on from an exception handler — the restore itself must be **synchronous and idempotent**.
**Design:** move the sequence constants + restore into a small `src/tui/restore.mjs` that accepts an
injected writer, and register `process.on("uncaughtException")`, `process.on("unhandledRejection")`
and `process.on("exit")` to a synchronous `restore()`, all idempotent (guarded by a `restored` flag).
Restore order: SGR reset → show cursor → leave alt screen → `setRawMode(false)`.
**Where:** `src/tui/restore.mjs` (new), `ui.mjs`.
**Test (failing-first):** `demo/tui-restore.test.mjs` — with a fake stdout/stdin, the restore emits
the sequences in the documented order, is idempotent (second call writes nothing), and survives an
injected `stdout.write` throw; plus an integration assertion that `ui.mjs` registers the three
handlers (static check on the source, or a stubbed child).
**Acceptance:** restore runs on exit/exception; no double restore; suite green.
**Status:** LANDED (uncommitted, 2026-10-16) — `src/tui/restore.mjs` + `demo/tui-restore.test.mjs`;
`ui.mjs` registers `uncaughtException`/`unhandledRejection`/`exit` and uses the shared module.
**Ruling needed:** none.

### H3 — Synchronized output (DECSET 2026) around each paint
**Goal:** the terminal never shows a half-written frame (kills tearing from `CLEAR` + rewrite).
**Why:** `ui.mjs` `paintScreen` writes `\x1b[H\x1b[2J` then rows with no atomic wrap.
**Design (from `vendor/eval/bubbletea` + `vendor/eval/vt-extensions`):** query support with DECRQM
`CSI ? 2026 $ p` and wrap the frame in `\x1b[?2026h … \x1b[?2026l` only when the reply is
`CSI ? 2026 ; 1 $ y` (`;2$y` reset / `;0$y` unrecognised = unsupported). Bubbletea gates the query on
the environment (skip SSH sessions; Windows Terminal is known-good via `WT_SESSION`); `vt-extensions`
lists Windows Terminal as supporting 2026. Emitting the pair unconditionally is also safe (unsupported
terminals ignore it), so the probe is an optimisation with a working fallback — keep an env/config
disable. Consider also querying mode 2027 (Unicode core), which makes a supporting terminal measure
width in graphemes and pairs with H4.
**Where:** `ui.mjs` `paintScreen`.
**Test (failing-first):** `demo/tui-sync-output.test.mjs` — paint output begins with `\x1b[?2026h` and
ends with `\x1b[?2026l` around the frame; with sync disabled, neither appears; the frame content is
unchanged.
**Acceptance:** frames are atomic on supporting terminals; content identical.
**Status:** LANDED (2026-10-16) — `src/tui/sync.mjs` (state + DECRQM consume) and
`src/tui/paint.mjs` (`composeFrame`), wired into `ui.mjs` `paintScreen`; `demo/tui-sync-output.test.mjs`.
**Ruling needed:** none.

### H4 — Grapheme/East-Asian-width-correct measurement
**Goal:** CJK, emoji, ZWJ sequences, and combining marks wrap/truncate by **cells**, not code units.
**Why:** `src/watchview.mjs truncate`/`pad` use `String.length`; `src/tui/client.mjs wrapText` uses
`flat.length`/`word.length`. A wide glyph overflows a cell; a combining mark over-counts.
**Design (port `vendor/eval/string-width`, MIT — do not reinvent):** a `src/textwidth.mjs` that
follows string-width's cluster rules, because `EAW(first codepoint)` alone is wrong for cases we ship:
1. skip non-printing clusters (Default_Ignorable, Control, Format, pure Nonspacing/Enclosing Mark,
   lone Surrogate), so a combining-only cluster is width 0;
2. RGI emoji clusters (`\p{RGI_Emoji}`) are width 2;
3. minimally-qualified emoji (ZWJ with ≥2 `Extended_Pictographic`, or a keycap) are width 2;
4. Hangul L+V(+T) jamo collapse to one width-2 syllable; unmatched jamo stay additive;
5. otherwise EAW of the cluster's first visible scalar, plus trailing Spacing_Mark and
   Halfwidth/Fullwidth Forms inside the cluster;
6. `ambiguousIsNarrow = true` (matches our target terminals), an ASCII fast path, and a length guard
   on pathological clusters (string-width caps its emoji checks at 50 chars, because a repeated
   property-class regex can overflow V8's regex stack).
Use built-in `Intl.Segmenter` for grapheme boundaries and `get-east-asian-width` for the table; add the
latter as a **direct** dependency (today it is transitive via pi-tui). Route `watchview.truncate`/`pad`
and `client.wrapText` through it, and add a `sliceToWidth` that never splits a cluster. If the terminal
answers mode 2027 (see H3) the platform clusters for us, but measurement must still be right where it
does not. **Test vectors:** lift the tricky cases from `vendor/eval/string-width/test.js` (family ZWJ,
keycap, flag, Hangul jamo, ambiguous) rather than inventing our own.
**Where:** `src/textwidth.mjs` (new), `src/watchview.mjs`, `src/tui/client.mjs`, `package.json`.
**Test (failing-first):** `demo/textwidth.test.mjs` — a CJK string, an emoji ZWJ family, a combining
accent, and an ambiguous-width char each measure by cells; `sliceToWidth` never splits a grapheme;
`watchview.truncate` stops on a cell boundary.
**Acceptance:** wrapped rows never exceed the frame width in cells; seat-list columns align.
**Ruling needed:** none for the mechanism. (See §D-G1 for the separate *measure cap*.)
**Status:** LANDED (2026-10-16) — `src/textwidth.mjs` + `demo/textwidth.test.mjs`;
`watchview.truncate`/`pad`, `chatview.truncate` and `client.wrapText` routed through it; the buffer
harness measures with the same function; `get-east-asian-width` is a direct dependency;
`npm run test:tui` 13/13.

### H5 — Bracketed paste (DECSET 2004) for the input line
**Goal:** a paste is delivered as one bounded payload, never as keystrokes.
**Why:** without it a multi-line paste can submit on the embedded newline; the payload must also be
treated as data, and the paste markers themselves stripped so a crafted paste cannot forge an
end-marker.
**Design (from `vendor/eval/bubbletea`):** model the paste as STATE (bubbletea's
`PasteStartMsg`/`PasteEndMsg`/`PasteMsg`): enable `\x1b[?2004h` while the input line is active
(disable on exit in the H2 restore); the start marker switches the input into "pasting" mode, only a
genuine end marker closes it, and the payload between is one literal string. A forged end marker
inside the payload must not close early, which is why the markers are stripped from the payload rather
than matched naively. Same `sanitizeTerminalText` from H1 governs what the payload may contain when
echoed.
**Where:** `src/tui/driver.mjs` `decodeKeys`, `ui.mjs` (mode setup), the input module from B1.
**Test (failing-first):** `demo/tui-input.test.mjs` (shared with B1) — a paste with `\n` is one line;
a payload containing a forged `\x1b[201~` does not terminate early; 2004 is enabled with the input
line and disabled on exit.
**Acceptance:** pastes are inert data; no paste-triggered submit.
**Ruling needed:** none; **it lands with B1** (this is the D70 condition).

### H6 — Resize and unknown/too-small size
**Goal:** a drag-resize never renders a torn or stale frame, and a tiny pane degrades instead of
throwing.
**Why:** `process.stdout.on("resize")` can fire ~100 ms late and can report a half-updated size;
Windows has no SIGWINCH (bubbletea's `signals_windows.go` is an explicit no-op), so the event is the
only signal, and `process.stdout.columns` is `undefined` when not a TTY.
**Design:** debounce the resize event; re-read `columns`/`rows` at paint time (never trust the event
payload); guard non-TTY; define a minimum size with a one-line "terminal too small" frame; exercise it
through the buffer harness (H7).
**Where:** `ui.mjs` (`getSize`/resize handler), `src/tui/client.mjs` (minimum-size layout).
**Test (failing-first):** `demo/tui-resize.test.mjs` — render at 20×5 and 1×1 without throwing; a
resize to a larger width repaints at the new width; a half-updated/undefined size falls back to the
last good size.
**Acceptance:** no frame exceeds the current size; no throw on a tiny or unknown size.
**Ruling needed:** none.

### H7 — Headless buffer harness + PTY end-to-end tests
**Goal:** wrapping, width and frame-shape regressions are caught by a buffer comparison, and real
terminal behaviour (raw mode, resize, alt-screen restore) is exercised once.
**Why:** our demos assert lines but do not model a screen buffer, so a cell-width bug or a row that
overflows the viewport can pass. Oracles: ratatui's `TestBackend`
(`assert_buffer`/`assert_buffer_lines`/`resize`) and bubbletea's `teatest` golden files; for the real
terminal, `microsoft/node-pty` and `microsoft/tui-test`.
**Design:** a tiny in-repo `ScreenBuffer` (rows×cols cells, write/clear/resize, `toString`) that
`renderTui`'s lines are painted into, plus golden-line fixtures and a resize case. PTY end-to-end is a
separate, heavier tier run when the terminal stack changes. **Framework design: `docs/TUI-TESTING.md`.**
**Where:** `demo/tui-harness.mjs` (fixtures + `ScreenBuffer` + golden helpers, test-only),
`demo/tui-golden.test.mjs`, `demo/tui-buffer.test.mjs`, `demo/tui-suite.mjs` (`npm run test:tui`).
**Test (failing-first):** the buffer for a known frame equals the golden; a wide glyph occupies two
cells; `resize` changes the buffer shape.
**Status:** Tier 1/2 LANDED (uncommitted, 2026-10-16) — 8 golden frames (incl. 48-col), buffer
overflow checks, `npm run test:tui` green 11/11. The harness immediately found and fixed a real bug:
the conversation header was not truncated and overflowed 48 columns by 7 cells. Tiers 3/4 and the
`textwidth` hand-off (H4) remain.
**Acceptance:** width/wrap regressions fail a buffer comparison, not just a substring check.
**Ruling needed:** whether the PTY tier (Tier 4) is worth its native dependency (operator call).

### H8 — Anchored scroll with an "N new" affordance
**Goal:** when the operator has scrolled up, new turns do not move the viewport; the app shows how
many are below and a key returns to the tail.
**Why:** the current view keeps a `scroll` counter and prints `↑/↓ N newer turns`, which is close but
does not freeze the viewport when new turns arrive at the bottom — a window-slicing bug class the
exemplars avoid with explicit anchoring (Textual's `anchor`; the standard chat pattern is "stick to
bottom until the user scrolls up, then do not move").
**Design:** track `anchored` (true = follow the tail). Append new content only while anchored; when
not anchored, increment `newCount` and print it without changing the first visible turn. `G`/`End`
re-anchors and clears the count.
**Where:** `ui.mjs` (`scroll`/`anchored` state), `src/tui/client.mjs` (`renderTranscript`).
**Test (failing-first):** `demo/tui-anchor.test.mjs` — while scrolled up, adding a turn leaves the
first visible line unchanged and increments "N new"; `G` returns to the tail and clears the count.
**Acceptance:** scrolling never jumps on new content.
**Ruling needed:** none.

---

## D. Remaining gaps and open rulings

| # | Gap | Evidence / recommendation | Ruling owner |
|---|---|---|---|
| G1 | **Prose measure cap.** The conversation wraps prose to the full terminal width. Web-typography sources suggest ~80–100 cols for reading comfort, but this is *inferred* (not a TUI study) and would **reverse** `697f376`'s deliberate full-width viewport. | Recommend: cap the *prose* measure and left-align, keep structural chrome (borders, status, tool output) full-width — **only if** the operator prefers reading comfort over width. Do not silently revert. | operator/lead |
| G2 | **Alt-screen receipts.** No search, transcript copy/export, or plain fallback. This is the named cost of D69 and still the strongest argument to revisit it. | Recommend a plain `--no-tui` linear stream (cheap, also the accessibility path) + in-app `/` search + a transcript dump on demand. | operator/lead |
| G3 | **D69/D61 supersession.** D69 adopts the alt screen for the rich view and supersedes D61 *for `ui.mjs`*; the ratification is still open. | If B1 (input box) lands, the alt screen's pinned-input justification applies and D69 stands. If `ui.mjs` stays read-only, inline is defensible. **Decide B1's read-only question first; the screen model follows.** | operator/lead |
| G4 | **Scaling facts (recorded, not work).** The store read is a bounded **24-entry page per seat** (`SCAN_LIMIT`), so transcript length is not the cliff the research assumed; the real limit is that the conversation scroll window cannot reach past that page. `ui.mjs` also declares `@earendil-works/pi-tui` but imports it nowhere. | Informational: use or drop the unused dep; decide whether a "load older than the page" affordance is wanted. | delegate/operator |

---

## E. Reference material

Whether to clone anything is the operator's call; the recommendation is to **add small MIT packages
as direct dependencies rather than clone whole projects** (provenance stays clean, and the repo
already vendors `pi-tui` and its `get-east-asian-width` dep). Candidates, by item:

| Item | Reference, if we want code to read rather than write | Licence |
|---|---|---|
| H1 sanitise | `sindresorhus/strip-ansi`, `chalk/ansi-regex` (the escape-matching regexes only) | MIT |
| H4 width | `sindresorhus/string-width` (grapheme + EAW), plus the already-present `get-east-asian-width` | MIT |
| H3 sync output | the DECSET-2026 spec gist (contour-terminal/vt-extensions) and the vendored `@earendil-works/pi-tui` `dist/tui-main-screen.js` (already in `node_modules`) | MIT / spec |
| H5 bracketed paste | `charmbracelet/bubbletea` (mode enable/disable + payload handling) | MIT |
| H2 restore | `ratatui`/`textual` teardown ordering for reference only | MIT |
| H4/H5 tests | `microsoft/node-pty` or `microsoft/tui-test` for Windows PTY end-to-end (heavy; only if golden frames prove insufficient) | MIT |

None is required to start: H1–H4 are implementable against the standard library plus one small dep,
and `get-east-asian-width` is already installed.

### Locally cloned references

All of the above are cloned locally under **`vendor/eval/`** (gitignored — never imported, never
built, never committed). Shallow clones (`--depth 1`) pinned at the SHAs below; re-clone to refresh.

| Local path | Upstream | SHA at clone (2026-10-16) |
|---|---|---|
| `vendor/eval/string-width` | `sindresorhus/string-width` | `ffa1de3894af` |
| `vendor/eval/strip-ansi` | `chalk/strip-ansi` | `622cca7b5dd4` |
| `vendor/eval/ansi-regex` | `chalk/ansi-regex` | `f923667b5ea0` |
| `vendor/eval/get-east-asian-width` | `sindresorhus/get-east-asian-width` | `a1b1c31d2347` |
| `vendor/eval/vt-extensions` | `contour-terminal/vt-extensions` (DECSET 2026 spec) | `05050a11e793` |
| `vendor/eval/bubbletea` | `charmbracelet/bubbletea` | `f9df43c4f2c0` |
| `vendor/eval/node-pty` | `microsoft/node-pty` | `d182c6079fc3` |
| `vendor/eval/tui-test` | `microsoft/tui-test` | `05b8eeccbbc8` |
| `vendor/eval/ratatui` | `ratatui/ratatui` | `d1ef782b48dd` |
| `vendor/eval/textual` | `Textualize/textual` | `5e5b7ef58b8c` |

---

## F. Reference review findings (2026-10-16)

Read after cloning, to compare our design with the field's. Each row names what it changed.

| Reference | Finding | Where it lands |
|---|---|---|
| `chalk/ansi-regex` | Handles **8-bit C1 introducers** (`\u009B` CSI, `\u009D` OSC) and the terminator set BEL / ESC-`\` / **`\u009C`**; an OSC payload stops at the first terminator, so an unterminated OSC cannot rescan the input. | **H1** — C1 and 0x9C now handled; abort-on-ESC refinement in. |
| `sindresorhus/string-width` | A real width algorithm: zero-width cluster skipping, RGI emoji, unqualified keycap/ZWJ, Hangul jamo collapse, trailing spacing marks, `ambiguousIsNarrow`, ASCII fast path, pathological-cluster guard. | **H4** — port, not reinvent. |
| `sindresorhus/get-east-asian-width` | Data-generated table (`lookup-data.js`) with an `ambiguousAsWide` opt-in. | **H4** — direct dependency. |
| `contour-terminal/vt-extensions` | DECRQM probe `CSI ? 2026 $ p`; reply `;0$y` unsupported, `;1$y` set, `;2$y` reset; no consensus timeout; **Windows Terminal supports 2026**. | **H3** — probe + env gate. |
| `charmbracelet/bubbletea` | Queries mode 2026 **and 2027** at startup, gates on environment (skip SSH; `WT_SESSION` known-good), wraps updates atomically, models paste as `PasteStart`/`PasteEnd`/`PasteMsg`; Windows resize is an explicit no-op (no SIGWINCH). | **H3, H5, H6**. |
| `ratatui/ratatui` | `TestBackend` compares a real cell buffer (`assert_buffer_lines`) and supports `resize`. | **H7**. |
| `Textualize/textual` | `anchor` scroll semantics; `get_auto_scroll_regions` for drag auto-scroll. | **H8** (anchor), **G2** (selection auto-scroll). |
| `microsoft/node-pty`, `microsoft/tui-test` | PTY end-to-end harness for real terminal behaviour. | **H7** (optional tier). |

Net: the review upgraded H3/H4/H5, fixed a real bypass in H1, and added H6/H7/H8 to the backlog.
