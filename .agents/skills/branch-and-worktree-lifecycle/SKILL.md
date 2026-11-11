---
name: branch-and-worktree-lifecycle
description: Use when a rig has accumulated item branches and worktrees, when you must decide whether a branch is safe to delete, when a completed item's branch is still open, or when a session is asked to "clean up branches". Gives the census, the verdict rule, and the prune sequence without guessing from `git branch --list`.
---

# Branch and worktree lifecycle on a live rig

**Trigger:** `git branch --list | wc -l` is large, `git worktree list` is large, or a queue item is
`done` while its branch is still open.

## 1. Census first — never prune from a list

```bash
timeout 180 node tools/branch-census.mjs                      # ~20 s at 101 refs / 92 worktrees
timeout 180 node tools/branch-census.mjs --json > .spike/census.json
timeout 180 node tools/branch-census.mjs --plan               # every prune command, not the first 12
```

It joins three sources the rig already owns — `cli.mjs worktree audit --json` (seat roots, locks,
dirty trees), `cli.mjs queue --json --no-body` (the item's status), and per-ref git facts (`ahead`,
ancestor-of-main, `merge-tree` clean/conflict) — and prints a tally plus an executable plan.

**Measured** 2026-11-11 at `35001c3a` (Linux, Fedora Linux 45, kernel `7.2.15-300.fc45.x86_64`, node
v24.22.1, git 2.56.0): 101 refs, 92 worktrees → 27 merged-and-clean, 43 clean/unmerged/terminal,
11 seat roots, 7 dirty, 2 conflicting, 1 locked, 1 detached scratch.

## 2. The verdict rule (what the tool encodes)

A ref is **deletable** only when all of these hold, checked at the moment of deletion:

1. `git merge-base --is-ancestor <ref> main` → exit 0 (the work is on `main`), and
2. the worktree has no uncommitted tracked change, and
3. it is not a seat root, not locked, and not the branch a `claimed`/`queued`/`held` item is working on.

A ref that is **not** an ancestor of `main` is never deleted by a cleanup pass. It is either
landable (a seat lands it through the gate) or conflicting (the author re-cuts it). Both are the
team's call — see `docs/runbooks/branch-cleanup.md` and `docs/DISPOSITIONS.md`.

**Why the audit alone is not enough:** `worktree audit` calls a tree "reapable" from its own
class rules; at the census above 43 "reapable" trees held refs that were *not* on `main`. Removing
them loses the work; keeping them leaves the residue. The ancestor test is the discriminator.

## 3. Prune

```bash
git worktree remove <path>        # never --force
git branch -d <ref>               # never -D; -d refuses an unmerged ref, which is the point
git worktree prune
```

Then prove it, in the same call, with the two counts:

```bash
git branch --list | wc -l; git worktree list | wc -l
```

**Refs are live during a pass.** Seats mint refs and commits while you measure, so re-run the census
immediately before the prune and re-check the ancestor test at the moment of deletion (pitfall 267).

## 4. If a `done` item still has an open branch

That is a lifecycle gap, not a cleanup problem: the item closed without its branch landing. Route it
to `pm` (delegate route: `node intent.mjs pm --body-file .spike/<topic>.md`), never close it yourself.
