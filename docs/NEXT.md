# durig — NEXT (current pointer)

**This file is the live pointer, not history.** `docs/STATUS.md` is the history;
`docs/ROADMAP.md` is the ordered backlog; `docs/SELFDEV.md` is the runbook. Update this file at the
end of every session and keep it to one screen.

_Last refreshed: 2026-10-12, after implementing #144 B / #146 / #147 (operator's assistant)._

## Where main is

**`main` is `6da82fff` and green: `demo/*.test.mjs` 45/45, `node --check` clean.** Recent commits:
- `1639a3be` #110 driver survival; `a07816df` its failing-first control.
- `b040bc1a` `peek_queue` scoped + thinned.
- `90caa998` / `d66737dc` selfdev #117 (per-seat `thinkingLevel`), #118 half 1 (`claim_work`'s legal
  move), #118 half 2 (structured thin header).
- `e1b4f22e` NEXT pointer; **`6da82fff` #144 B + #146 + #147** (this session):
  - **#144 B** — a seat with NO read tool gets an over-threshold tool result **inline**; a seat
    that can read gets the structured head + path. Predicate is capability (`seatHasReadTool` in
    `src/seattools.mjs`), wired through `thinResultText`, `claim_work`, `peek_queue`.
    `demo/structuredhead.test.mjs` proves both sides.
  - **#146** — state-mutating git is blocked at the guard (`src/confine.mjs`): commit/reset/
    checkout/restore/revert/clean/stash/branch -D; read-only git still runs.
    `demo/confine.test.mjs`.
  - **#147** — `run --max-duration <s>` bounds the run, SIGINT/SIGTERM lets the pass settle, and
    `run` reports `stoppedBy`; a stopped run does not strand submissions. `demo/cli.test.mjs`.

Nothing is pushed — the operator pushes at end of day.

## Still open (and why they are NOT small)

- **#145 — failure recovery vs diagnosis.** `lead` split it: escalation lives in the **supervisor**,
  malformed-tool-call classification is separate. **There is no supervisor component on `main`** —
  only the driver's re-wake and the `status`/`watch` notices. Escalation-on-repeated-failure needs
  that host (or a decision to put it elsewhere) plus a `repeated_failure` notice class. Not started.
- **#148 — item-43 family (DeepSeek reasoning/termination).** `thinkingLevel` is now wired
  (`cli.mjs` passes `seat.thinkingLevel` through `configure`), but DeepInfra's `reasoning_effort` is
  an integer 1–100 and the model map only carries `{off:"none"}`, so setting a level today sends a
  string the provider does not define. Needs item 43(a)'s effort mapping **and** a `step-repetition`
  measurement before a level is chosen. Not started.
- **#149 — verify `peek_queue`.** Self-verified: `demo/peekqueue.test.mjs` (scoping + `all` +
  over-threshold deferral). Independent `qa` verification not run.

## Known trap (do not repeat)

**`.worktrees/selfdev-110` is DIRTY and diverged** (a seat reverted `src/rig.mjs`; now blocked by
#146). `main` is correct. Before the next team run, point seats at a **fresh worktree from `main`**
(`docs/SELFDEV.md`).

## Lesson from this session

`npm`-style "drive the team" runs are **expensive and non-converging** here: `run` hit a 3000 s cap
twice (now boundable with #147), the worktree diverged, and the model did not always take the wake's
legal move. The operator's agent implementing directly on `main` (with a demo per change) was the
faster, verifiable path for these protocol fixes; the team remains right for larger, decomposable
work.
