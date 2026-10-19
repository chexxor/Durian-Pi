> **D103 rename (2026-10-18):** this record predates the product rebrand `durig` → `durian-pi`; it keeps the old name so the audit trail stays truthful.

---
incident: seat-root-fallback-commit
date: 2026-10-17
severity: sev1
status: open
symptom: "a commit reached main and the shared tree moved to an item branch, with no landing pass"
runbook: leaked-worktrees
fix: null
prevention: "land the #1151 DURIG_EXPECT_WORKTREE wrong-root guard; require an item worktree for every writer seat; a check rule for shared-tree-on-main"
last_reviewed: 2026-10-17
---

# A seat's cwd fell back to the shared tree: its commit reached `main`, and the shared tree switched branch

*Incident 2026-10-17; detected by the delegate from the git reflog; analysis by the delegate.*

## Summary
While the broker was restarted to recover `security`, the `security` seat ran with its cwd on the
**shared working tree** rather than an item worktree. It committed its `#1581` artifact **directly to
`main`** (`1b21d30`), then checked the shared tree out to branch `security-item-1581`; a later delegate
docs commit (`bec594e`) therefore landed on that branch instead of `main`. Same class as
`2026-10-17-live-worktree-reap`.

## Timeline
- `19:12:44Z` broker restarts (pid 36488); seats woken.
- `security` runs; its git cwd is the **shared tree**.
- `HEAD@{2}` `commit 1b21d30` — `security` commits its `#1581` artifact **on `main`**.
- `HEAD@{1}` `checkout: moving from main to security-item-1581` — the shared tree switches to the item branch.
- `HEAD@{0}` `commit bec594e` — a delegate `docs(next)` commit lands on the branch, not `main`.

## Impact
- An **unverified, landing-gate-bypassing** change reached `main`.
- The **shared working tree sat on a feature branch**, so any seat writing "live" wrote to that branch.
- A delegate commit was stranded off `main`.

## Root cause
`security`'s **seat root was the shared tree**, not an item worktree — exactly the root-fallback defect
the `#1151` `DURIG_EXPECT_WORKTREE` / wrong-root guard exists to refuse, and that guard is **itself
unlanded** (in the 33-branch set). With no wrong-root refusal, `git commit` from the shared tree wrote
to whichever branch happened to be checked out.

## Detection
Git reflog (`git reflog` showed commit-then-checkout) plus `git branch --contains`. There is no
automated detection; `status` did not flag it.

## Resolution
Restored the shared tree to `main`; fast-forwarded `main` to include the delegate commit (`bec594e`);
treated `1b21d30` as an unverified landing for post-hoc review. Done 2026-10-17.

## Prevention
1. **Land the `#1151` wrong-root guard** (`DURIG_EXPECT_WORKTREE`): refuse a mutation from the shared
   checkout — the exact control for this class.
2. Require a prepared **item worktree** for every writer seat before it is woken (`prepare_workspace`),
   and fail closed when a seat that must write resolves its root to the shared tree.
3. A **`check` rule**: the shared working tree must be on `main` (or explicitly declared) — flag otherwise.
4. Keep the `#1244` sweep contract (never reap a locked/branch-held LIVE worktree).

## Evidence
- `git reflog`: `HEAD@{2} commit 1b21d30`; `HEAD@{1} checkout: moving from main to security-item-1581`;
  `HEAD@{0} commit bec594e`.
- `git branch --contains`: `main` contains `2c49158` and `1b21d30`; `security-item-1581` adds `bec594e`.
- `git show --stat 1b21d30`: `docs/reviews/security-shell-root-parity.md` (105 insertions) — no code.

## Links
`docs/incidents/2026-10-17-live-worktree-reap.md` · `docs/runbooks/leaked-worktrees.md` · queue `#1151`, `#1581`
