# durig — NEXT (current pointer)

**This file is the live pointer, not history.** `docs/STATUS.md` is the history;
`docs/ROADMAP.md` is the ordered backlog; `docs/SELFDEV.md` is the runbook. Update this file at the
end of every session and keep it to one screen.

_Last refreshed: 2026-10-13, after the impl model swap and the #148 start (operator's delegate)._

## Where main is

**`main` is `a076b816`** — `chore(selfdev): impl seat runs XiaomiMiMo/MiMo-V2.6-Flash` on top of
`e678d125`/`ef244f70` (the #145 pair; `demo/*.test.mjs` green 47/47, `node --check` clean).
Nothing is pushed — the operator pushes at end of day.

## Current priority — **#148 (+ #154 amendment) IN PROGRESS on impl**

- **Operator order:** start #148 (item-43 "model/reasoning wiring"); #154 is folded in, not split.
  pm registered **#170** ("#148 START NOW") and the "do NOT start now" sequencing is superseded.
- **impl now runs `XiaomiMiMo/MiMo-V2.6-Flash`** (was `deepseek-ai/DeepSeek-V4-Flash-0731`; commit
  `a076b816` + `up --refresh`). Context reset + handoff written per the #154 decision (switch
  reported, claimed items #60–#63/#90/#101/#110/#139 carried). Runtime-verified: agent-config
  revision and generation entries both serve MiMo — verify at the generation record, not the config.
- **Seat root `C:/tmp/durig-dev/148/durig`** — fresh worktree from `main`. NOT
  `.worktrees/selfdev-110` (dirty, diverged, not source of truth).
- In flight (uncommitted, worktree): `durig/demo/reasoningeffort.test.mjs` (new, failing-first),
  `durig/src/modelswitch.mjs` (new, the model-change reset/report), `durig/cli.mjs`,
  `durig/src/providers/deepinfra-models.ts`. `node --check` + demo-loop runs already visible.
- **Next command:**
  `cd durig && DURIG_SEAT_ROOT=C:/tmp/durig-dev/148/durig DURIG_DB=./selfdev.sqlite node cli.mjs run --max-duration 300`
  — repeat until impl completes; `node cli.mjs resume` after any killed run; then verify
  claim → complete → artifact to `qa`. Open: **#149** (independent `peek_queue` verify, do not re-implement).

## Blockers / traps (do not repeat)

- **A `send`/`run` killed by the harness tool cap strands the seat mid-generation** (pi.live left
  in flight; slots leak). Recover with `node cli.mjs resume`, then drive SHORT `run --max-duration`
  chunks under the tool cap. A stale `selfdev.sqlite.genlock.<i>` (dead pid) is stolen by the next
  acquire — do not hand-edit it.
- **impl has not yet formally claimed #148/#154** (queue still `queued`) — the very wake/claim gap
  is #148's B5 half. #170 tells it to claim.
- impl on MiMo miscalled `powerShell` (case) and tried to move uncommitted work out of the tree;
  the seatguard refused (correct). Keep changes in the seat root; send the artifact to `qa`.

## Operational flag (updated)

`lead`→`pm` backlog **drained 2026-10-13**: #150–#153 and #131 registered as **#156** (B1 inline
bodies), **#164–#166**, **#171–#175**. pm's B1 readability gap stays until #156 lands (it could not
read lead's #131 text at all).

## Lesson (unchanged)

Driving the team is expensive and non-converging in this environment; the operator's agent
implementing directly on `main`, one demo per change, was the faster verifiable path for these
protocol fixes.