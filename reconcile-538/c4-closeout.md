# C4 CLOSE-OUT (item #662) — reconcile against current HEAD: both requested demo blocks EXIST

pm routed qa's #606/#638 verdict (PARTIAL; two absent demo blocks). This worktree's HEAD has since
moved (qa's evidence was taken at 67810af, 2026-10-15). Reconcile result: **both gaps are closed by
commits made 2026-10-16** — before this item started. Evidence, each re-runnable:

## GAP (a) — 48-col golden frame: CLOSED

- File: `demo/tui-golden.test.mjs` (Tier 2 whole-frame golden harness, cell-buffer overflow
  checks) — ADDED by commit `aea7e74` (2026-10-16, "test(tui): golden-frame harness, cell-buffer
  overflow checks, test:tui runner"). NOT present at qa's 67810af (git cat-file -e →
  "exists on disk, but not in '67810af'", exit 128).
- Committed goldens include the 48-col cases: `demo/__golden__/seats-48.txt` and
  `demo/__golden__/conversation-48.txt` (plus the 80-col set) — case list in
  `demo/tui-golden.test.mjs` renders `width: 48, height: 24` and asserts BOTH "matches golden"
  AND "never overflows the viewport" (overflowCells === 0 && overflowRows === 0).
- Re-run: `node demo/tui-golden.test.mjs` → PASS, exit 0 (this worktree, 2026-10-16).

## GAP (b) — headless lifecycle cleanup (clean-exit AND failure-exit): CLOSED

- File: `demo/tui-restore.test.mjs` — ADDED by commit `18b372a` (2026-10-16, "feat(tui): sanitize
  untrusted render text; restore terminal on abnormal exit (D70/H1,H2)"). NOT present at 67810af
  (git cat-file -e → exit 128).
- What it asserts headlessly (injected stdout/stdin sinks — no TTY): the enter sequence emits
  `ENTER_ALT (\x1b[?1049h) + HIDE_CURSOR + CLEAR`; the restore sequence emits `PASTE_OFF +
  SHOW_CURSOR + CLEAR + LEAVE_ALT` with SHOW_CURSOR before LEAVE_ALT; raw mode turned OFF
  (`setRawMode(false)`); idempotency (second restore writes nothing); the FAILURE path (a dead
  throwing stdout) does not rethrow and STILL restores raw mode; non-TTY streams get no escapes;
  `ui.mjs` wires uncaughtException/unhandledRejection/exit to the shared restore module.
- WHY qa's grep missed it: the demo asserts via the IMPORTED constants (`ENTER_ALT`, `LEAVE_ALT`,
  `SHOW_CURSOR`…) — the literal string "1049" appears only in `src/tui/restore.mjs`, not in the
  demo file, so a literal `"1049"` grep over `demo/` finds nothing. The coverage exists; the grep
  pattern was over-narrow.
- Re-run: `node demo/tui-restore.test.mjs` → PASS, exit 0 (this worktree, 2026-10-16).

## CRITERION 3 (raw-mode keyboard operator-only): unchanged, still out of scope (keyboard validated
on the operator's real Windows terminal; headless contract documented in ui-driver.test.mjs).

## VERDICT (the amended C4 line for the artifact)

C4 = PASS on current HEAD: the U5/TUI run-loop restore CODE and BOTH demo blocks verifiably exist;
qa's PARTIAL was correct for 67810af, and both closers (`18b372a` restore-on-abnormal-exit,
`aea7e74` golden frames) landed 2026-10-16 — one day after qa's evidence snapshot. The named
files/dates/exit codes here are the artifact; pm can re-run the two demo invocations above in
seconds.
