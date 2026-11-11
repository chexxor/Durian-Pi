---
name: branch-and-worktree-lifecycle
description: Use when a rig has accumulated item branches and worktrees, when you must decide whether a branch is safe to delete, when a completed item's branch is still open, or when a session is asked to "clean up branches". Gives the census, the verdict rule, and the prune sequence without guessing from `git branch --list`.
---

# Branch and worktree lifecycle on a live rig

**Trigger:** `git branch --list | wc -l` is large, `git worktree list` is large, or a queue item is
`done` while its branch is still open.

## 1. Census first — never prune from a list

```bash
timeout 180 node tools/branch-census.mjs                      # ~25-35 s; prints the tally and the plan
timeout 180 node tools/branch-census.mjs --json > .spike/census.json
timeout 180 node tools/branch-census.mjs --plan               # every prune command, not the first 12
timeout 180 node tools/branch-census.mjs --md > docs/evidence/<date>-branch-census/census.md
```

It joins four sources the rig already owns — `cli.mjs worktree audit --json` (seat roots, locks,
dirty trees), `cli.mjs queue --json --no-body` (the item's status), per-ref git facts (`ahead`,
ancestor-of-main, `merge-tree` clean/conflict, and whether the branch's net content is already in
`main`), and **`docs/DISPOSITIONS.md`** (the ruling ledger). Prints a tally plus an executable plan.

**Use `git for-each-ref`, not `git branch --list`, when you count refs yourself**: `branch --list`
prefixes the current branch with `*`, so a naive `split(" ")[0]` invents a ref named `*` and loses
`main` (measured 2026-11-11: 78 refs, 76 parsed).

**Measured** 2026-11-11 at `e01e9256` (Linux, Fedora Linux 45, kernel `7.2.15-300.fc45.x86_64`, node
v24.22.1, git 2.56.0): 77 refs / 69 worktrees → 43 clean-unmerged-terminal, 10 seat roots, 7 dirty,
7 conflicting, 9 ruled-kept by the ledger, 1 locked, 1 no-queue-row.

## 2. The verdict rule (what the tool encodes)

A ref is **deletable** only when all of these hold, checked at the moment of deletion:

0. **`docs/DISPOSITIONS.md` has no KEEP row for it.** A reverted merge is an ancestor of `main`, so
   `git branch -d` happily deletes a ref the ledger says to keep — measured 2026-11-11, when a pass
   `-d`'d `item-6063/6064/6066` whose ledger row says "do not prune them: the content is not live and
   the refs are the input to the re-cut". Ancestor status gates the ref; the ledger gates the act.
   (Recovery if you do: the delete output prints the sha, `git branch <name> <sha>` restores it
   exactly; `git reflog` also holds it.)
1. `git merge-base --is-ancestor <ref> main` → exit 0 (the work is on `main`), and
2. the worktree has no uncommitted tracked change, and
3. it is not a seat root, not locked, and not the branch a `claimed`/`queued`/`held` item is working on.

**Two different locks.** `git worktree remove` refuses a *git-locked* worktree with `fatal: cannot
remove a locked working tree` (exit 128) — that lock is `git worktree lock`, and `cli.mjs worktree
audit`'s `locked` field is the **rig's run lock**, a different thing. `git worktree unlock <path>` is
the non-destructive release; use it only when the item is terminal, never `--force`.

A ref that is **not** an ancestor of `main` is never deleted by a cleanup pass. It is either
landable (a seat lands it through the gate) or conflicting (the author re-cuts it). Both are the
team's call — see `docs/runbooks/branch-cleanup.md` and `docs/DISPOSITIONS.md`.

**Why the audit alone is not enough:** `worktree audit` calls a tree "reapable" from its own
class rules; at the census above 43 "reapable" trees held refs that were *not* on `main`. Removing
them loses the work; keeping them leaves the residue. The ancestor test is the discriminator, and the
merge-tree comparison to `main`'s tree answers the second question — *does this branch add anything at
all?* (2026-11-11: **0** of the 43 were redundant, so every one carries content `main` does not have).

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
