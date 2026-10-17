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
Since **#1194** the sweep also KEEPS an orphan that is **locked** or has a **branch checked out** — and
every durig item worktree is on its item branch (#859) — so a clean orphan on a branch is *not* swept
automatically.

## Do
1. At start the broker sweeps only a **dead, detached, unlocked** orphan and logs
   `RECONCILE leases=… worktrees=…`. Since **#1194** it KEEPS — reporting `worktree-orphan-kept` — any
   orphan that is **locked** or has a **branch checked out** (a live seat's workspace; #859). A clean
   orphan still on a branch therefore needs a manual step: `git worktree unlock item-<id>`, then let the
   next start sweep it, or relocate it (step 4).
2. A **dirty** orphan is refused on purpose (never destroyed). Resolve it explicitly:
   ```bash
   git -C item-<id> status --short          # see what is at risk
   #   commit the work on its branch, OR discard it deliberately (operator decision)
   ```
   Then let the next broker start sweep it, or remove it by hand with `git worktree remove item-<id>`
   once clean.
3. Do not force-remove a dirty worktree while a seat may own it: check the queue item's status first.
4. **Tidy without discarding:** a terminal orphan can be relocated out of the project root instead of
   removed — `git worktree unlock <wt>` then `git worktree move <wt> <archive-dir>/<wt>` — which preserves
   every uncommitted file and every branch. The delegate used `../pi-opendurig.worktrees/` (2026-10-17:
   28 terminal worktrees + 2 verification scratch moved; 5 live/held worktrees left in place).

> **Item branches (#859).** `prepare_workspace` now creates each item worktree ON its
> `<seat>-item-<id>` branch, so a seat's commits land on a branch, not a detached HEAD. A worktree
> made before this change may still be detached: re-run `prepare_workspace` for that item and it
> re-attaches the branch at the current HEAD, preserving any commits already made there. Do not
> hand-roll a branch — the tool owns it.

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

2026-10-17 (#1194): the sweep reaped a LIVE worktree that was locked and on a branch — the seat's cwd
fell back to the shared tree and a commit landed on `main` (#1186, #1196). It now KEEPS a locked or
branch-checked-out orphan (`listWorktrees` also reports the lock honestly; a spread-order bug had hidden
it). Because every item worktree is branch-based, the sweep now reaps only detached/unlocked orphans.
