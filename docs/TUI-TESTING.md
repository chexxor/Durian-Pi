# durig TUI — testing framework

**Status:** design + first increment. Companion to `docs/TUI-IMPLEMENTATION-PLAN.md` §H7.
**Why this exists:** the current `demo/tui-*.test.mjs` scripts assert substrings and regexes on
`frame.lines`. That catches "is the text there" but not "did a row overflow the viewport by one cell"
or "did the layout shift" — the exact ways a wrapping, width or resize regression ships. This proposes
a small, dependency-free harness with a screen buffer and golden frames, then layers interaction and
(optionally) real-terminal tests on top.

## What the references do (read in `vendor/eval/`)

| Project | Mechanism | What we lift |
|---|---|---|
| ratatui (`TestBackend`, `vendor/eval/ratatui`) | Renders into an in-memory cell buffer; `assert_buffer_lines([...])` compares whole frames; `resize()` changes the buffer shape. | **Tier 2**: a `ScreenBuffer` + golden-line comparison + a resize case. |
| bubbletea (`teatest`, `testdata/*.golden`) | `NewTestModel` with a fixed term size; `Type`/`Send` drive the model; `WaitFor(...)` polls output; `teatest.RequireEqualOutput` compares to a golden file. | **Tier 3**: a driver scenario that feeds keys and waits for a frame condition. |
| Textual (`run_test`/`Pilot`, snapshot tests) | Async pilot drives input against a headless app; screenshot output compared to stored snapshots. | **Tier 3** interaction; snapshot naming. |
| `microsoft/tui-test` | Locators (`getByText`, `getByStyle`, `getByLink`) against a real PTY, `expect`/`wait`, `resize`, `signal`, artifacts. | **Tier 4** PTY end-to-end; locator-style assertions. |
| `microsoft/node-pty` | PTY spawn for real terminal behaviour. | **Tier 4** transport. |

## The four tiers

1. **Tier 1 — pure render (`renderTui` → lines).** No terminal, no driver. Assert frame content and
   invariants (no line exceeds the width; the header/footer are present). This is what we already have;
   the framework adds shared fixtures and structured assertions so tests stop re-declaring dummy data.
2. **Tier 2 — screen buffer + golden frames.** Paint `renderTui` output into an in-memory grid that
   measures in **cells**, records any overflow, and compares the whole frame to a committed golden.
   Catches layout/width/wrap regressions that substring checks miss. `UPDATE_GOLDEN=1` regenerates.
3. **Tier 3 — interaction / state machine.** Drive `createUiDriver` with decoded keys and a
   deterministic tick, capturing each painted frame; assert the sequence (Enter opens the conversation,
   `↑` pauses follow, `G` re-anchors, `Esc` backs out, `q` restores). No timers, no TTY.
4. **Tier 4 — PTY end-to-end (optional, heavier).** Spawn `node ui.mjs` in a real PTY (via
   `node-pty`/`tui-test`), send keys, read the screen, and assert raw-mode/alt-screen/restore behaviour.
   This is the only tier that proves the terminal handoff; it needs a native dependency, so it runs when
   the terminal stack changes, not on every commit.

## Non-negotiables

- **No new runtime dependency for tiers 1–3.** They use `node:assert`-style checks and `node:fs` only.
- **Golden files are committed** under `demo/__golden__/` and reviewed like code; a diff is the review.
- **Deterministic**: fixed fixtures, fixed term sizes, fixed `uptime`, no `Date.now()` in goldens.
- **Hermetic**: the TUI tests never open the store or a harness (D11), so they need no `DURIG_DB` and do
  not contend with a live broker.
- **One entry point**: `npm run test:tui` runs every `demo/tui-*.test.mjs` plus
  `demo/sanitize.test.mjs` and reports a pass/fail count, so regression runs are one command.

## Coverage matrix (feature → tier → test)

| Feature | Tier | Test |
|---|---|---|
| Seat list + selection | 1/2 | `demo/tui-golden.test.mjs`, `demo/tui-client.test.mjs` |
| Conversation view (D69) | 1/2 | `demo/tui-golden.test.mjs`, `demo/tui-conversation.test.mjs` |
| Streaming row / team-wide partials | 1/2 | `demo/tui-golden.test.mjs`, `demo/tui-multipane.test.mjs` |
| Tool blocks / thinking parity | 1/2 | `demo/tui-golden.test.mjs`, `demo/tui-toolblock.test.mjs`, `demo/tui-thinking.test.mjs` |
| 48-column floor | 2 | `demo/tui-golden.test.mjs` (`conversation-48`) |
| Frame never overflows the viewport | 2 | `demo/tui-buffer.test.mjs` |
| Cell-width wrapping | 1/2 | `demo/tui-buffer.test.mjs`, H4 |
| Escape sanitisation | 1 | `demo/sanitize.test.mjs` |
| Keys / navigation / quit | 3 | `demo/ui-driver.test.mjs`, `demo/tui-conversation.test.mjs` |
| Anchored scroll + "N new" (H8) | 2/3 | `demo/tui-anchor.test.mjs` |
| Resize / tiny terminal (H6) | 2/3 | `demo/tui-resize.test.mjs` |
| Alt-screen restore (H2) | 1/4 | `demo/tui-restore.test.mjs`, Tier 4 |
| Sanitise C1/OSC injection | 1 | `demo/sanitize.test.mjs` |

## Definition of done for a TUI change

1. A Tier 1/2 test that fails without the change (failing-first).
2. If the change alters visible layout, the golden diff is in the commit and reviewed.
3. `npm run test:tui` is green, and no existing golden changed without intent.

## Roadmap

- **Now:** Tier 1/2 harness (`demo/tui-harness.mjs`), golden frames incl. the 48-col case, buffer
  overflow test, and the `test:tui` runner.
- **With H4:** replace the buffer's provisional `cellWidth` with `src/textwidth.mjs`; add CJK/emoji
  property tests.
- **With H6:** resize/tiny-terminal tests.
- **With H8:** anchored-scroll tests.
- **With B1:** interaction tests for the input line (paste, editing).
- **Later:** Tier 4 PTY harness behind an opt-in script.
