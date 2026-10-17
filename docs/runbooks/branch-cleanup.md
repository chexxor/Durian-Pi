---
runbook: branch-cleanup
symptom: "so many local git branches; merged branches were never pruned"
writes: false
precondition: "read-only"
last_verified: 2026-10-17
verified_by: delegate
evidence: "2026-10-17: 52 merged/patch-equivalent branches pruned (128→76 refs, main unmoved, 33 unlanded kept)"
check_rule: null
---

# Prune accumulated branches (branch-cleanup)

## When to use
`git branch` has grown large and it is unclear what is safe to remove — typically because pruning is
**manual and guessable, and seats cannot do it**. The symptom a person types: "the branches are piling
up". Run this at a delegate clock-out, or when the `merge.md` "Trust, but verify" audit reports a big
`ahead=0` set.

## Impact
Merged branches are invisible clutter: they slow every `git branch`/worktree operation and hide the
small set that is **unlanded**. Worse, the same mechanism hides the real liability `merge.md` names —
a `done` item whose work is not on `main`. Blast radius is low: branch deletion does not touch the
shared working tree or the store, so the broker may keep driving. Only the `Do` step changes git refs.

## Preconditions
Git-only, read-only with respect to the store; the broker does **not** need stopping. Do **not** remove
or force-remove any worktree as part of a branch prune — a checked-out branch must be released through
`leaked-worktrees.md`, not here. The operator holds push (remote refs); see step 7.

## Diagnose (read-only)
Classify every non-`main` ref as **merged** (`ahead=0`), **held** (checked out in a worktree), or
**unlanded** (`ahead>0`). **The `sed` matters:** `git branch` prefixes a ref with `*` (current) or `+`
(checked out in a **linked worktree**); an unstripped `+` corrupts every downstream loop:
```bash
git branch --merged main | sed -E 's/^[*+ ]+//' | grep -v '^main$' | sort -u > merged.txt
git worktree list --porcelain | awk '/^branch /{sub("refs/heads/","",$2); print $2}' | sort -u > held.txt
comm -23 merged.txt held.txt    # MERGED + free  -> prunable now
comm -12 merged.txt held.txt    # MERGED + held  -> release the worktree first, then prune
```
Unlanded set (keep every one; `+` = patch **not** in `main`, `-` = rebased duplicate already in `main`):
```bash
for b in $(git branch --format='%(refname:short)' | grep -v '^main$'); do
  a=$(git rev-list --count "main..$b")
  [ "$a" -gt 0 ] && echo "$b ahead=$a unique=$(git cherry main "$b" | grep -c '^+')"
done
```
Confirm the two safety facts before touching anything: `main` HEAD sha, and a clean tree
(`git status --short -- .`). Never prune while the tree is mid-merge.

## Do
1. Re-run Diagnose **at this moment** — branch sets are point-in-time (the rig creates refs live).
2. Delete **merged + free** refs. `-d` refuses anything unmerged or still checked out, so it cannot
   lose work:
   ```bash
   git branch -d $(cat merged.txt | comm -23 - held.txt)
   ```
3. **Patch-equivalent duplicates** (a rebased copy already in `main`): confirm `git cherry main <b>`
   prints only `-` lines, then delete with `-D` (the work *is* on `main`; `-d` would refuse a
   non-ancestor):
   ```bash
   git cherry -v main <branch>          # every line must start with '-'
   git branch -D <branch>
   ```
4. **Do not delete** any `ahead>0` branch, and **never** delete a snapshot/archive branch
   (`item-<N>` pre-split snapshots, `selfdev-*`). They sit on old bases and are not work-in-flight
   (see `merge.md` "Never merge a snapshot").
5. A **held** merged branch cannot be pruned until its worktree is released. Release it only per
   `leaked-worktrees.md` (terminal + unlocked + clean; a **locked** worktree is an intentional keep),
   then re-run Diagnose and step 2.
6. `git worktree prune` to drop metadata for worktrees already removed by the sweep.
7. Remote snapshot refs (`origin/selfdev-*`, `origin/item-148`, `origin/pi-rebase`) are the operator's:
   deleting them is a push, and the delegate holds no push grant.

## Verify
```bash
git branch | wc -l            # decreased by exactly the pruned count; not below held+unlanded+1
git log --oneline -1 main     # HEAD sha UNCHANGED from Diagnose
git status --short -- .       # still clean
# for any sha you deleted, prove it was landed BEFORE deleting: git merge-base --is-ancestor <sha> main
```
Every kept branch must still be listed. The 2026-10-17 run: 128 → 76 refs, `main` at `c0534ed`,
tree clean, all 33 unlanded refs intact.

## If it fails
- `git branch -d` says **not fully merged**: it found real unlanded work. **Do not reach for `-D`.**
  Keep the ref and route it via `merge.md` (land or rebase) or to `pm`.
- `git branch -d` says **checked out at <path>**: leave it; release the worktree per
  `leaked-worktrees.md`, not by force.
- You pruned a ref you now need: it is recoverable while reflog holds it — `git branch <name> <sha>`
  (the sha from the delete output), or `git reflog`/`git fsck --lost-found`.

## Escalate to
`pm` — to open a landing pass for the `ahead>0` set (the durable fix for unlanded work). `lead` — when
a held branch cannot be merged cleanly. The operator — to prune remote snapshot refs.

## Evidence
2026-10-17: 52 refs pruned (50 merged `-d` + 2 patch-equivalent `-D`: `impl-item-1256`,
`scribe-item-1532`); 42 merged-but-held and 33 unlanded kept; `main` unmoved. Follow-up owed: the 33
unlanded commits (guard/confine stack `#1151…#1519`, docs `#1232…#1565`) reported to `pm`. Ops note
that produced the `sed`: `git branch --merged main` prints `+ <ref>` for worktree-held refs, which
silently corrupts a `main..$b` loop.
