# Leaked or dirty `item-*` worktrees

## When to use
`git status` or `git worktree list` shows stray `item-<id>` worktrees, or `serve.err` logs
`worktree: refusing to remove … N uncommitted path(s)`.

## Preconditions
Read-only to inspect. Removing a worktree is a git operation; never discard work you did not create.

## Diagnose (read-only)
```bash
git worktree list
DURIG_DB=./selfdev.sqlite node cli.mjs queue   # which item ids are still live?
```
A worktree whose item is terminal is an **orphan**. An orphan with uncommitted work is **dirty**.

## Do
1. The broker sweeps **clean orphans** automatically at start and logs
   `RECONCILE leases=… worktrees=…`; clean orphans need no manual step.
2. A **dirty** orphan is refused on purpose (never destroyed). Resolve it explicitly:
   ```bash
   git -C item-<id> status --short          # see what is at risk
   #   commit the work on its branch, OR discard it deliberately (operator decision)
   ```
   Then let the next broker start sweep it, or remove it by hand with `git worktree remove item-<id>`
   once clean.
3. Do not force-remove a dirty worktree while a seat may own it: check the queue item's status first.

## Verify
`git worktree list` no longer lists the resolved worktree; `git status` is quiet for `item-*`.

## If it fails
If a worktree will not remove (Windows file locks), close any process with it open and retry; the fallback
is `git worktree remove --force` **only after** its work is committed or knowingly discarded.

## Evidence
2026-10-16 (item 73): `removeClaimedWorktree` used to fall through to `rm -rf` on a dirty tree — a latent
data-loss path; it now refuses without `force` (D60). The leaked `item-635/636/638` hold uncommitted work
and are correctly refused; they need their owner to commit or the operator to resolve. ROADMAP item 76
adds the audit surface.
