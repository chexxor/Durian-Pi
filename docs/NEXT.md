# durig — NEXT (current pointer)

**This file is the live pointer, not history.** `docs/STATUS.md` is the history;
`docs/ROADMAP.md` is the ordered backlog; `docs/SELFDEV.md` is the runbook. Update this file at the
end of every session and keep it to one screen.

_Last refreshed: 2026-10-12, after #145 (both halves) (operator's assistant)._

## Where main is

**`main` is `ef244f70` and green: `demo/*.test.mjs` 47/47, `node --check` clean.** Recent commits:
- `1639a3be` #110 driver survival; `a07816df` its failing-first control.
- `b040bc1a` `peek_queue` scoped + thinned.
- `90caa998`/`d66737dc` selfdev #117 (`thinkingLevel`), #118 half 1 (`claim_work`'s legal move),
  #118 half 2 (structured thin header).
- `6da82fff` #144 B (coordinator inline), #146 (block state-mutating git), #147 (bounded run).
- `ee35b693` **#145(i)** — `src/supervisor.mjs`: a narrow ESCALATION supervisor + `repeated_failure`
  notice. Parks a persistently-failing seat's item, and a question on an unanswering seat past 15
  min, on the **human** via the existing defer channel. Idempotent; a pass inside `run --watch`.
- `ef244f70` **#145(ii)** — `malformed_tool_call` classified by CAUSE (the harness's
  `invalid_arguments` marker, not a domain error) and surfaced per-seat + as an ambient measure.

Nothing is pushed — the operator pushes at end of day.

## Still open

- **#148 — item-43 family (DeepSeek reasoning).** `thinkingLevel` is wired (#117) but DeepInfra's
  `reasoning_effort` is an integer 1–100 and the model map only carries `{off:"none"}`, so a level
  today sends an undefined string. Needs item 43(a)'s effort mapping **and** a `step-repetition`
  measurement before a level is chosen.
- **#149 — verify `peek_queue`.** Self-verified (`demo/peekqueue.test.mjs`); independent `qa`
  verification not run.

## Known trap (do not repeat)

**`.worktrees/selfdev-110` is DIRTY and diverged**, and it predates #144 B — so `lead`, running
from it, still has no read tool and cannot open `.durig/<id>.md` (it said so while ruling). A team
run must start from a **fresh worktree from `main`** (`docs/SELFDEV.md`); #146 then blocks the git
mutation that caused the divergence.

## Operational flag (from `lead`)

`lead`'s sends to `pm` are backing up (#150–#153 queued) and **#131 is `deferred` from lead to
pm**. If `pm` is not claiming them, rulings are not reaching registration. Worth eyes before the
next team run.

## Lesson (unchanged)

Driving the team is expensive and non-converging in this environment; the operator's agent
implementing directly on `main`, one demo per change, was the faster verifiable path for these
protocol fixes.
