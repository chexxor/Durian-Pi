# durig — NEXT (current pointer)

**This file is the live pointer, not history.** `docs/STATUS.md` is the history;
`docs/ROADMAP.md` is the ordered backlog; `docs/SELFDEV.md` is the runbook. Update this file at the
end of every session and keep it to one screen.

_Last refreshed: 2026-10-12, delegate-onboarding pass._

## Current priority

**Queue item #110 — P5: the `run` driver must survive an unresolvable path.** It is labelled **TOP
BLOCKER** in the selfdev queue and explicitly **supersedes #105 (P3)**.

- **Why it is first:** the driver crashes with
  `{"ok":false,"error":"unresolvable path: [\"generation\",\"message\",\"content\",0]"}` and exits
  before its window. While it dies, nothing else can progress — no claimed work is re-woken, and
  #105's supervisor would sit on a dead driver. Roadmap: *"Deadlock and liveness prevention"* **P5**.
- **What "done" is:** a demo, **from the driver path** (not a synthetic chord call), that reproduces
  the failure failing-first and then shows the driver surviving and continuing its passes.
  `node --check` clean on every changed file; full `demo/*.test.mjs` loop exit 0. Send the concrete
  artifact to `qa` before completing. Full text: selfdev queue item **#110**.

## Then

- **#108 / #105 — P3:** escalate a `deferred_awaiting_answer` item to the human, one pass inside
  `run --watch`, bounded and idempotent. Lead's ruling is **#107**; its full text is at
  `<seat-root>/.durig/107.md`.

## Known non-terminal queue state (`selfdev.sqlite`)

| id | status | from→to | what |
|---|---|---|---|
| #110 | queued | pm→impl | P5 driver survival — **current priority** |
| #108 | queued | pm→impl | P3 escalate `deferred_awaiting_answer` (unblocked by #107) |
| #60–#63 | claimed | pm→impl | agent-fleet borrow RANK 2–5 |
| #90 | claimed | pm→impl | non-claimable `held` queue state |
| #101 | claimed | pm→impl | #60 shape ruled + explicit order |

The claimed items are **not necessarily live** — an un-woken claim is exactly the damage #110
causes, so treat them as suspect until the driver survives a pass.

## Registered backlog (pending routing)

Roadmap *"New-session onboarding for seats"* gained **O1–O4** (seat boot contract; a pushed rig
handoff; intake writes the done-condition; root/oracle derived, not inlined) on 2026-10-12. They are
registered on the roadmap but **not yet in this queue** — `pm` should route them once the driver
survives (#110). Do not start them ahead of #110.

## Open operator decision

**Which worktree?** The seats last rooted in `.worktrees/selfdev-borrow/durig` (stale HEAD relative
to the main tree, with uncommitted WIP). Decide whether to continue there or branch a fresh worktree
from current HEAD before the next run. See `docs/SELFDEV.md` for the exact commands.
