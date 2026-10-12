# durig — NEXT (current pointer)

**This file is the live pointer, not history.** `docs/STATUS.md` is the history;
`docs/ROADMAP.md` is the ordered backlog; `docs/SELFDEV.md` is the runbook. Update this file at the
end of every session and keep it to one screen.

_Last refreshed: 2026-10-12, after the #145(i) escalation supervisor (operator's assistant)._

## Where main is

**`main` is `ee35b693` and green: `demo/*.test.mjs` 46/46, `node --check` clean.** Recent commits:
- `1639a3be` #110 driver survival; `a07816df` its failing-first control.
- `b040bc1a` `peek_queue` scoped + thinned.
- `90caa998`/`d66737dc` selfdev #117 (`thinkingLevel`), #118 half 1 (`claim_work`'s legal move),
  #118 half 2 (structured thin header).
- `6da82fff` #144 B (coordinator inline), #146 (block state-mutating git), #147 (bounded run).
- `ee35b693` **#145(i)**: `src/supervisor.mjs` — a narrow ESCALATION supervisor + a
  `repeated_failure` notice class. It parks a persistently-failing seat's item, and a question
  parked on an unanswering seat past 15 min, on the **human**, through the existing defer channel
  (`status:"deferred"`, `deferredTo:"human"`). Pure `planEscalations` + `applyEscalations`;
  idempotent; runs as a pass inside `run --watch`; `run` reports `escalated`.
  Proof: `demo/supervisor.test.mjs`.

Nothing is pushed — the operator pushes at end of day.

## Still open

- **#145(ii) — malformed-tool-call classification.** Scoping done; the concrete case is in the
  transcript: entry **#6980** shows `Validation failed for tool "edit": edits.0: must be object.
  Received arguments: {"edits": "[{...}]"}` — the model passed `edits` as a **JSON-encoded string**.
  That case IS handled (the validation error is returned to the model, which retried), so the
  "falls through unhandled" framing is only partly right. The open question is a **decision**, not
  a patch: should a malformed call be a distinct signal (a notice/metric class) rather than
  indistinguishably a tool error? Recommend deciding before coding.
- **#148 — item-43 family (DeepSeek reasoning).** `thinkingLevel` is wired (#117) but DeepInfra's
  `reasoning_effort` is an integer 1–100 and the model map only carries `{off:"none"}`, so a level
  today sends an undefined string. Needs item 43(a)'s effort mapping **and** a `step-repetition`
  measurement before a level is chosen.
- **#149 — verify `peek_queue`.** Self-verified (`demo/peekqueue.test.mjs`); independent `qa`
  verification not run.

## Known trap (do not repeat)

**`.worktrees/selfdev-110` is DIRTY and diverged.** `main` is the truth. A team run must start from
a **fresh worktree from `main`** (`docs/SELFDEV.md`); #146 now blocks the git mutation that caused
the divergence.

## Lesson (unchanged)

Driving the team is expensive and non-converging in this environment; the operator's agent
implementing directly on `main`, one demo per change, was the faster verifiable path for these
protocol fixes.
