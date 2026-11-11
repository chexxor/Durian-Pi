# Branch and worktree census — 2026-11-11 (delegate pass)

**Reproduce:** `timeout 240 node tools/branch-census.mjs --md` (read-only; ~25-35 s on this box).
Host measured with the measurement: Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`,
node v24.22.1, `git version 2.56.0`.

**Before / after this pass** (each count is a command I ran, not a remembered number):

| measure | before | after | command |
|---|---:|---:|---|
| refs excluding `main` | 78 | 77 | `git for-each-ref --format='%(refname:short)' refs/heads \| wc -l` |
| registered worktrees | 70 | 69 | `git worktree list \| wc -l` |
| refs pruned | — | 1 (`item-6809`) | `git merge-base --is-ancestor item-6809 main` exit 0, then `git worktree remove` + `git branch -d` |

**One mistake this pass caught and reversed.** The first plan pruned `item-6063`, `item-6064`,
`item-6066` — three refs whose ledger row says in bold *"do not prune them: the content is not live and
the refs are the input to the re-cut."* `git branch -d` **succeeds** on a reverted merge, because the
merge commit is in history even though the content is not on `main`. All three refs were restored to
the exact shas the delete output printed (`6fb7b30b`, `0bfd61a5`, `bcaa6d2b`) and verified:
`git merge-base --is-ancestor item-6063 main` → exit 0, `git rev-parse item-6063` → `6fb7b30b`. Nothing
was lost; the reflog also still holds them.

**The fix is in the instrument, not the discipline.** `tools/branch-census.mjs` now reads
`docs/DISPOSITIONS.md` and refuses to plan a deletion for any ref with a KEEP / REVERTED row — 9 refs
were protected by that check on the re-run. An ancestor check gates the *ref*; the ledger gates the
*act*.

**What the census says about the lifecycle.** Of 77 refs, 43 are clean, unmerged, and attached to items
whose status is already `done`/`cancelled`/`deferred`, and none of them is redundant with `main`
(`git merge-tree main <ref>` returns a tree different from `main`'s for every one). That is the defect
the work-item lifecycle is meant to remove: an item closes, its branch stays. A prune pass cannot fix it
— deleting them destroys unlanded work — so they are listed as **OPEN** in the ledger, and the landing
verb (task-4) is what makes them disappear.

**Coverage proof, run at `aa1771e5`.** `timeout 240 node tools/branch-census.mjs` prints
`unaccounted refs (0) — not on main, not a seat root, no ledger row`. Before the rows were appended it
printed 2 (`item-6344`, `item-6369`, both minted by the fleet *during* the pass). At the pass boundary
the 77-ref picture was: 45 clean-unmerged-terminal (all **OPEN** in the ledger), 10 seat roots,
7 dirty trees, 7 refs conflicting with `main`, 9 refs protected by an existing ledger ruling,
1 locked, 1 merged-and-removed.

**Counts are point-in-time.** Between two runs of the same command the fleet minted refs 77 → 80 and
worktrees 69 → 74. Any prune plan must be regenerated in the same breath as it is executed.

**Suite at this HEAD:** `node scripts/test.mjs --all --jobs 4` → **300/300 passed in 119.8 s**, exit 0
(`.spike/suite-task1.out`).
