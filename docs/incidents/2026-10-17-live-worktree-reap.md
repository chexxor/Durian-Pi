> **D103 rename (2026-10-18):** this record predates the product rebrand `durig` → `durian-pi`; it keeps the old name so the audit trail stays truthful.

---
incident: live-worktree-reap
date: 2026-10-17
severity: sev1
status: resolved
symptom: "a commit lands on main from a seat whose cwd fell back to the shared tree"
runbook: leaked-worktrees
fix: "#1244 (sweep keeps locked/branch-held orphans)"
prevention: "verifier-must-lock rule (#1340); listWorktrees reports the lock honestly"
last_reviewed: 2026-10-17
---

# The worktree sweep reaped a LIVE worktree, and a commit landed on main

*Incident 2026-10-17; detected by impl; analysis recorded in `leaked-worktrees.md`.*

## Summary
The broker's orphan-worktree sweep reaped a **locked, branch-held** worktree that was still in use.
The seat's cwd fell back to the **shared tree**, and a commit landed on `main` (`#1186`, `#1196`). The
sweep's liveness signal was wrong: a locked, in-use worktree was treated as an orphan.

## Timeline
- `#1194` — the sweep reaps a LIVE worktree that was locked and on a branch.
- The seat's cwd falls back to the shared tree; a commit lands on `main` (`#1186`, `#1196`).
- `#1244` — the sweep is reworked to KEEP locked/branch-held orphans and report the reason.

## Impact
Unintended writes to `main` from a seat that believed it was in its own worktree — a shared-tree
integrity failure. Recoverable here, but the class is data-loss-adjacent.

## Root cause
The sweep's reap contract had no live-use signal it trusted. A `locked` worktree (the verifier-must-lock
protocol) was not treated as a keep-reason, and `listWorktrees` did not report the lock honestly (a
spread-order bug had hidden it).

## Detection
Observed commit landing on `main` and the seat's cwd; later hardened into the sweep contract and its
demos.

## Resolution
`#1244` — the sweep reaps a worktree only when ALL hold: it is a durig item worktree on a branch that
resolves a queue id; that item is TERMINAL; the worktree is UNLOCKED; and it is CLEAN. Every other case
is KEPT and reported as `worktree-orphan-kept` with a reason (`live`/`locked`/`not-terminal`/
`branch-unresolved`/`dirty`). The sweep removes the worktree only, **never the branch**.

## Prevention
The verifier-must-lock rule (#1340): lock a verify scratch at creation so it is a keep-reason. Demos
`broker-worktree-sweep` + `worktree-sweep` cover the detached and branch-held cases.

## Evidence
- `docs/runbooks/leaked-worktrees.md` — the `#1194` and `#1244` entries: *"the sweep reaped a LIVE
  worktree that was locked and on a branch — the seat's cwd fell back to the shared tree and a commit
  landed on `main` (`#1186`, `#1196`)"*; the reap contract; `listWorktrees` reporting the lock honestly.
- Queue: `#1194`, `#1244`, `#1340`.

## Links
`docs/runbooks/leaked-worktrees.md` · `docs/runbooks/seat-reset.md` · queue `#1194`, `#1244`, `#1340`
