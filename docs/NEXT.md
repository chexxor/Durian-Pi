# durig — NEXT (current pointer)

**This file is the live pointer, not history.** `docs/STATUS.md` is the history;
`docs/ROADMAP.md` is the ordered backlog; `docs/SELFDEV.md` is the runbook. Update this file at the
end of every session and keep it to one screen.

_Last refreshed: 2026-10-12, after the #117/#118 run and integration (operator's assistant)._

## Where main is

**`main` is `d66737dc` and green: `demo/*.test.mjs` 45/45, `node --check` clean.** It contains:
- `1639a3be` — #110 fix (driver probes a seat's `pi.live` through a raw handle; survives F14).
- `a07816df` — #110 failing-first control, committed and self-contained.
- `b040bc1a` — `peek_queue` scoped to the seat (+ `all:true`) and routed through `thinResultText`.
- `90caa998` + `d66737dc` — the selfdev team's #117/#118 work, merged in:
  - #117 per-seat `thinkingLevel` reaches the harness AgentState (`demo/thinkinglevel.test.mjs`);
  - #118 half 1 `claim_work` returns the oldest claimed-by-me item (`demo/rearmclaim.test.mjs`);
  - #118 half 2 structured thin header, not a mid-body byte cut (`demo/structuredhead.test.mjs`).

**#110 is CLOSED by operator ruling** (#113 settled closed). Nothing is pushed — the operator pushes
at end of day.

## Current priority (routed, waiting on implementation)

`lead` has ruled the critical path; these are the next work items:

- **#144 — coordinator read gap. `lead` ruled B:** inline the body for a seat that has NO read tool;
  F9's `COORDINATOR_REMOVALS` (`src/seattools.mjs:52`) stay. Reconciles with #124(b): a seat that can
  dereference gets path + structured header, a seat that cannot gets the body inline — a capability
  predicate, not a role-name fork. This is what unblocks `pm`'s own #131/#134 deferrals.
- **#146 — block state-mutating git at the guard layer** (`commit`/`push`/`reset`/`checkout <path>`/
  `restore`/`revert`/`clean`/`stash`/`branch -D`), keep read-only git. Failing-first acceptance.
- **#145 — split into two:** escalation-on-repeated-failure lives in the **supervisor, not the
  driver** (+ a `repeated_failure` notice class); malformed-tool-call classification is separate.
- **#147** bounded `run` with graceful shutdown; **#148** item-43 family (wake has a legal move but
  the model runs `git status` instead of claiming); **#149** verify `peek_queue`.

## Known trap (do not repeat)

**The worktree `.worktrees/selfdev-110` is DIRTY and is NOT the source of truth.** Its
`src/rig.mjs` was reverted by a seat and lost the `peek_queue` scoping. `main` is correct. Before the
next team run, point seats at a **fresh worktree from `main`** (the runbook in `docs/SELFDEV.md`),
or re-sync that file deliberately — do not run the team against the diverged tree.

## Unexpected events this session (registered, #146–#149)

1. A seat mutated git state in its worktree (reverted committed code) — #146.
2. `run` to quiescence is unbounded in wall-clock: it hit a 3000 s cap **twice**; each kill stranded
   submissions (`admitted_not_started`) and left a stale generation lease (`generation_stale`), both
   cleared with `node cli.mjs doctor` — #147.
3. The stalled-claim badgering persisted after the fix because the model did not call `claim_work` —
   #148.
4. `qa` twice failed to reproduce #110's negative control (wrong git path, then a bad substitution);
   the committed fixture (`demo/driversurvive-pre.test.mjs`) removes that dependency.

## Open operator decision

- **Push** the local `main` (`d66737dc`) at end of day — the operator holds that grant.
- **Next team run:** start from a fresh worktree off `main`; expect `run` to be long (see #147).
