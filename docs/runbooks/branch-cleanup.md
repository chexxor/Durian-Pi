---
runbook: branch-cleanup
symptom: "so many local git branches; merged branches were never pruned"
writes: false
precondition: "read-only"
last_verified: 2026-10-19
verified_by: delegate
evidence: "2026-10-17: 52 merged/patch-equivalent branches pruned (128->76 refs, main unmoved, 33 unlanded kept). 2026-10-18: 20 merged refs pruned through the worktree-release/reclaim paths alone (1 free-merged; 2 terminal clean+locked releases; 17 verify-tree reclaims in leaked-worktrees.md), main unmoved, nothing forced. 2026-10-18 (delegate, operator-directed): 51 merged refs pruned in one pass (17 free + 34 worktree-held whose only content was generated scratch moved to .spike/delegate/quarantine), then 5 verified branches landed + pruned; refs 137->84, worktrees 167->130, main 95e7c0c->b3710f3, suite 138/0, nothing forced. 2026-10-19: 9 verified branches landed (main 4f9e7d6->7b6548e, suite 156 pass/1 env fail) + refs 108->73 pruned (27 dirty merged worktrees RELOCATED to ../pi-opendurig.worktrees/, 4 clean+locked+terminal removed), main unmoved by the prune, nothing forced. 2026-10-19 (second pass): 17 verified branches landed (main 67228b9->3b79159, suite 175 pass/1 env fail) then pruned (12 free -d + 4 relocated + 1 unmerged-then-merged bonus); refs 111->83, worktrees 206->204, 11 locked merged refs KEPT, nothing forced"
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

The **model** behind these steps (artifact ownership, the three prune paths, and which source is
authoritative for each question) is `docs/BRANCH-AND-WORKTREE-LIFECYCLE.md`; this runbook is the
procedure.

## Diagnose (read-only)
**Step 0 — the ledger first.** Before re-deriving a disposition for ANY branch,
check `docs/DISPOSITIONS.md` FIRST: a branch that already has a row there is
**not re-litigated** — it is **re-listed with its existing disposition**
(`CANCEL` / `SUPERSEDED` / `LAND` / `KEEP-HELD`). The ledger records decisions, not
ref existence, so a missing ref is not a missing row and a present ref is not a
re-derivation. New dispositions are **appended** to the ledger by the deciding
seat in the same pass (a new row with the new deciding item id) — never an edit to
an old row. The probe method for proving a disposition is in the ledger's
convention: blob identity at path, patch-id secondary, **content wins**.

**Step 0b — a SEMANTIC conflict is NOT a "pending rebase" (ZOMBIE ITEM).** A rebase
item whose conflict is semantic is not a rebase item. A rebase is a mechanical
operation that PRESERVES intent; when the conflict spans a safety surface across
hundreds of commits, a "rebase" is a re-implementation wearing a rebase's clothes
— it resolves by picking one wording per hunk, which is guessing exactly where
guessing is most dangerous. Such an item must be **RECLASSIFIED** as a
re-implementation (fresh work against current `main`, with a current-code verify)
or **CANCELLED** with the ref left intact. It must **NEVER** be left as "pending
rebase": a pending rebase looks like queued work that will eventually happen, so
nobody ever makes a decision about it, and it re-appears in every inventory
forever. Name that state for what it is — a **ZOMBIE ITEM** — and treat finding one
as a defect in the inventory rather than as backlog. *Worked example:* the
guard/carry stack (`impl-item-1151`, `impl-item-1261`, `impl-item-1225`,
`impl-item-1249`, `impl-item-1444-fix`) — measured 341–566 commits behind,
conflicting across `src/broker.mjs`, `src/confine.mjs`, `src/seattools.mjs`,
`src/config.mjs` and `cli.mjs`. Claims cancelled, refs intact per R-B, intent
re-filed where it still matters (lead ruling #3383).

**Step 0c — identical tips are ONE claim (a duplicate PAIR, not two items).** When
two branch refs resolve to the SAME tip, keep ONE claim — the lower item id, i.e.
the original — and cancel the other citing the shared tip. Never rebase, verify or
land both: two claims on one tip will eventually produce two landing entries for
the same content, and the second one lands a duplicate. *Worked example:*
`impl-item-1151` and `impl-item-1261` both resolve to tip `85c5d95f6`.

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
   **Re-run it again after each landing batch, not only once at the start.** Landing one branch can make
   an unrelated ref merged: on 2026-10-19 landing `impl-item-1705` (tip `349d5d3`) turned
   `auditor-item-2757` (same tip, `ahead=4` at Diagnose) into an ancestor of `main`, so a ref recorded as
   unprunable at the start was safely `-d`'d at the end of the same pass. The gate is always the live
   question, never a remembered `ahead` count:
   `git merge-base --is-ancestor <branch> main && git branch -d <branch>`.
   **Read the lock flag from `git worktree list`'s TERSE output** (`<path> <sha> [<branch>] locked`), not
   from `--porcelain`: there `locked` is its own line AFTER `branch`, so a naive parse attributes it to
   the following tree (2026-10-19: it reported all 22 merged worktrees as locked).
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
5. A **held** merged branch cannot be pruned until its worktree is released, per `leaked-worktrees.md`.
   Three cases: **(a) clean + unlocked + terminal** → `git worktree remove <wt>` then `git branch -d`;
   **(b) clean but `locked`** → `git worktree unlock <wt>` → remove → `-d`, only when the item is
   terminal (otherwise the lock means "in use" — keep it); **(c) dirty** → keep. `leaked-worktrees.md`
   § "Reclaiming a merged item-branch pinned by a verify worktree" covers the qa `verify-*` tree case.
   **When (c) is dirty and the branch IS merged, the operator-approved resolution is to RELOCATE the
   worktree out-of-tree** (`git worktree move` to `../pi-opendurig.worktrees/`, then `switch --detach`,
   then `-d`) — it preserves every file and frees the ref; the full copyable loop and counts are in
   `leaked-worktrees.md` (2026-10-19). Most durian-pi item worktrees are dirty with CARRY residue, so
   this is the COMMON path, not the exception. Then re-run Diagnose and step 2.
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
**The ledger rule (runs every pass, not only a prune):** every branch whose
disposition is already recorded in `docs/DISPOSITIONS.md` is **re-listed from the
ledger, never re-derived**:
```bash
grep -E 'architect-item-3005|security-item-1475' docs/DISPOSITIONS.md  # both rows present (CANCEL)
git diff --exit-code docs/DISPOSITIONS.md                              # append-only: a row added this pass, none edited
```
**The two disposition rules (Step 0b / Step 0c) are present:**
```bash
grep -c 'Step 0b — a SEMANTIC conflict is NOT a "pending rebase"' docs/runbooks/branch-cleanup.md  # >= 1
grep -c 'Step 0c — identical tips are ONE claim' docs/runbooks/branch-cleanup.md                     # >= 1
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
2026-10-18 (delegate, operator-directed): a full sweep pruned **51 merged refs** — 17 free `-d` plus
**34 worktree-held refs whose ONLY content was generated scratch** (untracked `verify-*`/`.verify*`,
`.tmp-merged.txt`/`.tmp-held.txt`, `selfdev.sqlite.broker.inbox.out/`, `suite-batch*.txt`) with every
nested verify tree clean. Because `git worktree remove` refuses on ANY untracked file, the scratch was
**moved to `.spike/delegate/quarantine/<branch>/`** (preserved, not deleted), the lock released, then the
worktree removed and the ref `-d`'d. A separate **landing pass** landed 5 verified branches
(`devtools-item-1904`, `scribe-item-1968/1969/1970/1971`) via `scripts/land.mjs --suite` (suite 138/0,
`main` `95e7c0c`->`b3710f3`) and pruned them. Net: refs **137->84**, worktrees **167->130**, `main`
advanced once by a clean FF, tracked tree clean, **nothing forced**. ~46 merged refs remain held by
dirty/real-content worktrees (see leaked-worktrees.md); 36 unlanded carry real work.

2026-10-17: 52 refs pruned (50 merged `-d` + 2 patch-equivalent `-D`: `impl-item-1256`,
`scribe-item-1532`); 42 merged-but-held and 33 unlanded kept; `main` unmoved. Follow-up owed: the 33
unlanded commits (guard/confine stack `#1151…#1519`, docs `#1232…#1565`) reported to `pm`. Ops note
that produced the `sed`: `git branch --merged main` prints `+ <ref>` for worktree-held refs, which
silently corrupts a `main..$b` loop.

2026-10-19 (prune pass #3, delegate, broker UP, right after 6 landings): refs **94 → 89**, worktrees
**210 → 208**, `main` unmoved by the prune, nothing forced. **`worktree audit` reported `reapable: 0`** and
that was the CORRECT answer, not a failed pass:
- **5 merged+free refs `-d`'d** (`devtools-item-2976`, `impl-item-2744`, `architect-item-2984`,
  `architect-item-3005-rebased`, `impl-item-2545`) immediately after their landings, then the diagnostic
  sweep freed 4 more (`devtools-item-3036/3038/3082`, `scribe-item-3047` — all with tips ON `main`
  already, i.e. branches that never carried a commit of their own).
- **8 merged refs stayed HELD by `locked` worktrees** (`advocate-item-2104/2630`, `devtools-item-2559/2638/2969`,
  `impl-item-1274/2744/2788`) — every one a live item or a lock, so step 5(b)'s "only when the item is
  terminal" applies: **one** was terminal + clean (`impl-item-2744`, item cancelled) and was reclaimed
  `unlock → remove → -d`; the rest were kept.
- **`item-2104` REFUSED removal** — one untracked `selfdev.sqlite.broker.inbox.out/` left inside the
  worktree. That refusal is the safety net (`never --force`); it was re-locked and reported. **New known
  artifact:** a `*.broker.inbox.out/` (or `*.genlock.*`) INSIDE a worktree means the seat ran CLI commands
  from that cwd — it is a store artifact, not authored work, but its presence still makes `remove` refuse,
  so the reclaim for that tree needs an explicit decision rather than a force.
- **A big worktree COUNT is not evidence of a leak:** 163 of 208 are the already-relocated
  `../pi-opendurig.worktrees/*` trees (registered worktrees that live outside the repo, counted as
  `kind: non-item`). They are preserved, deliberately, and re-print on every audit. Judge the pass by
  `merged+free`, `dirty`, `locked` and `live` — not by the total.
- **Seat roots drift back to the shared tree after a pass.** `audit.seatRoots` showed **all 11 seats**
  rooted at the shared tree at the end of this pass (the same audit earlier in the session had `impl` on
  `item-2744` and `devtools` on `item-2595`). `complete_work` teardown and the sweep flip a seat's cwd
  back — this is the F12 fallback re-asserting, not a prune bug. **Re-read `seatRoots` at the START of a
  pass** and re-point any seat you are about to depend on; do not assume yesterday's roots.

2026-10-19 (prune pass #4, delegate, broker UP, after 4 landings): refs **95 → 88**, worktrees **201 → 200**,
`main` unmoved by the prune, nothing forced.
- **6 merged+free refs `-d`'d** (`devtools-item-2587`, `devtools-item-2969`, `impl-item-2420`,
  `impl-item-2797`, `impl-item-3164`, `scribe-item-3121`).
- **2 merged-but-held refs freed by RELOCATION** (the dirty-but-merged path, § "relocate out-of-tree"):
  `advocate-item-2104` (item **cancelled**, clean tracked, but holding an untracked
  `selfdev.sqlite.broker.inbox.out/` — so `worktree remove` would have REFUSED) and `devtools-item-2638`
  (item **done**, unlocked, dirty with **`scripts/land.mjs`** + `package-lock.json` — real WIP, preserved
  byte-for-byte). Both moved to `../pi-opendurig.worktrees/`, detached, then `-d`.
- **8 more TERMINAL item trees relocated out of the project root** (`item-1225/1249/1261/1704/1769/1823/1469/2103`);
  project root item dirs **20 → 12**, and every tree's `git status` entry count was verified **identical
  before and after** the move (1:1, including one with **269** entries) — that equality is the lossless proof,
  so record it, do not assume it.
- **Kept (live):** `item-723`/`1274`/`2630`/`2788` (`held`), `2559` (`deferred`), `2993` (`queued`), plus the
  `item-2188/*` nested rebase scratch (relocate nested-first or not at all) — and `item-2103`, which stays
  **detached** on purpose (it held `designer-item-2103`; detaching is how the branch was freed for a rebase).
- **A `git cherry` `+` is not proof a branch is unique.** `architect-item-3005 @0827b39` shows `+` (its patch
  ID differs from the landed `architect-item-3005-rebased`) yet `git diff main:<path> 3005:<path>` is **empty**
  — same content, different patch shape. Compare the TREES before concluding "unlanded"; do not delete on a
  `-D` hunch and do not re-land a duplicate.

2026-10-20 (prune pass #5, delegate, broker UP, after 2 landings + 1 revert): refs **97 → 93**, worktrees
**203 → 203**, `main` unmoved by the prune, nothing forced.
- **4 merged refs `-d`'d**: `qa-item-3104`, `qa-item-3198` (both tips already on `main`), then
  `impl-item-3062` and `scribe-item-3167` after their landings.
- **`devtools-item-1558` KEPT on purpose at `17cd7a2`** even though it is now an ancestor of `main`: it
  was landed and then reverted (`0976cc4`), so its content is NOT live and the ref is the author's input
  to rework `#3238`. `git branch -d` would have succeeded because the merge commit is in history; deleting
  it would hide the pending work. Treat "reverted merge" as a KEEP reason, not as merged.
- **Merged-but-held refs stayed**: `advocate-item-2630` (held), `devtools-item-2559` (deferred),
  `impl-item-1274` (held), `impl-item-2788` (held), `qa-item-2993` (claimed), `qa-item-3216` (verify in
  progress) — every one is held by a LOCKED/live tree, so step 5(b) applies: keep.
- **`worktree scratch clean` REFUSED 2 dirty scratches** (`%TEMP%/wt-2199`, `./wt-2073`, 1 and 4 paths).
  That is the clean-only guard working; the owner must finish or clean them, never `--force`. `reapable: 0`
  was the correct answer: 162 non-item trees are the archived `../pi-opendurig.worktrees/` set, 6 live item
  trees are locked, 33 dirty item trees are already archived, 4 seat-root trees are in use.
