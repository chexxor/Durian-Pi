# durig — NEXT (current pointer)

**This file is the live pointer, not history.** `docs/STATUS.md` is the history;
`docs/ROADMAP.md` is the ordered backlog; `docs/SELFDEV.md` is the runbook. Update this file at the
end of every session and keep it to one screen.

_Last refreshed: 2026-10-12, #110 driver-survival fix (operator's assistant)._

## Current priority

**Queue item #110 — P5: the `run` driver must survive an unresolvable path.** The fix is
**implemented and self-verified** (see evidence below), but the queue row is still `queued`:
the assistant did the work directly because the driver was the blocker; **independent `qa`
verification and `pm` closure are still owed.**

- **What was wrong:** a corrupt `pi.live` document (DOGFOOD F14) made `run --watch` throw
  `unresolvable path: ["generation","message","content",0]` on its first pass. Every claimed
  item (#60–#63, #90, #101) was stranded. A pi-durable Session fails **closed** on its first
  storage error, so guarding one wake was not enough — the bad seat poisoned every later wake.
- **The fix:** `src/driver.mjs` `driveOnce` now probes each candidate seat's `pi.live` through a
  **raw storage handle** (`probeSeatReadability`) and skips the unreadable seat before the
  harness opens it; `cli.mjs` `cmdRun` supplies the handle and reports skipped seats in
  `failedSeats` plus a stderr `wake-failed` line. A per-wake guard remains. Rationale: D39.
- **Evidence (re-run these):**
  - `node demo/driversurvive.test.mjs` → exit 0 (with the fix).
  - Failing-first: the same demo against the committed driver → exit 1,
    `PathError: unresolvable path: ["generation","message","content",0]`.
  - `node --check` clean on `cli.mjs`, `src/driver.mjs`, `demo/driversurvive.test.mjs`.
  - full `demo/*.test.mjs` loop → 40/40 exit 0.
- **Still owed:** `qa` re-runs the named checks independently; `pm` closes #110. Do **not**
  re-implement it — the fix is in the tree.

## Then

- **#108 / #105 — P3:** escalate a `deferred_awaiting_answer` item to the human, one pass inside
  `run --watch`, bounded and idempotent. Lead's ruling is **#107**; its full text is at
  `<seat-root>/.durig/107.md`. Unblocked now that the driver survives.

## Known non-terminal queue state (`selfdev.sqlite`)

| id | status | from→to | what |
|---|---|---|---|
| #110 | queued (fixed in tree) | pm→impl | P5 driver survival — **verify + close** |
| #108 | queued | pm→impl | P3 escalate `deferred_awaiting_answer` |
| #60–#63 | claimed | pm→impl | agent-fleet borrow RANK 2–5 |
| #90 | claimed | pm→impl | non-claimable `held` queue state |
| #101 | claimed | pm→impl | #60 shape ruled + explicit order |

The claimed items were stranded by #110. With the driver fixed they should be re-woken on the next
`run`; verify rather than assume.

## Registered backlog (pending routing)

Roadmap *"New-session onboarding for seats"* gained **O1–O4** on 2026-10-12, registered but not yet
in the queue. `pm` should route them after #110 is closed.

## Open operator decision

**Which worktree, and whether the #110 fix is committed.** The assistant committed the fix locally
on `main` (no push). The seats previously rooted in `.worktrees/selfdev-borrow/durig` (stale HEAD,
uncommitted WIP). Decide whether the next team run continues there or branches a fresh worktree
from current HEAD. See `docs/SELFDEV.md`.
