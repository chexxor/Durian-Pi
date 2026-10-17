---
runbook: merge
symptom: "a branch holds real work that is not on main; or you are about to land one"
writes: false
precondition: "none"
last_verified: unverified
verified_by: delegate
evidence: "branch audit 2026-10-17: 18 merged branches deleted, 15 verified-but-unlanded flagged"
check_rule: null
---

# Land a branch onto main (merge review)

## When to use
A seat has completed an item whose work sits on an `<seat>-item-<id>` branch, or you are auditing why
verified work is not on `main`. This is the **landing half** of W2: verification (W2) says the artifact is
reproducible; landing puts it on `main`. The agent makes the landing call — there is no auto-gate
(operator preference, 2026-10-17); the audit below verifies it later.

## Impact
Unlanded work is invisible value and an audit liability: the store says an item is `done` while `main`
does not contain it, other seats build on a stale `main`, and the branch rots (conflicts grow). The
inverse is worse — landing unverified or un-scoped work is the shared-tree corruption class. Blast
radius: a bad merge touches every seat's base tree.

## Preconditions
- **Read-only diagnosis needs no broker stop; a landing pass does.** `Diagnose` below is git-only and
  safe while the rig drives, but a merge changes the **shared working tree** — and the live rig reads it.
  A conflicted merge leaves `.git/MERGE_HEAD` and `<<<<<<<` markers in tracked files; because `cli.mjs`
  statically imports `src/checkup.mjs`, a conflict there makes **every** `node cli.mjs` verb fail to load
  (`SyntaxError`). So a landing pass runs in an **exclusive window**: stop the broker
  (`broker-safe-change.md`) and confirm **no `genlock.*` is held** before the first merge; restart it
  after the pass verifies. This is the 2026-10-17 landing-safety incident (see
  `docs/reviews/landing-safety-2026-10-17.md`).
- **Serialized:** one landing at a time; never merge while another commit/merge to `main` is in flight or
  another seat is generating.
- The branch's worktree is **not mid-edit**: a linked worktree (`item-<id>`) must be clean, or removed,
  never merged while a seat holds uncommitted edits on it.
- The branch is **verified** (qa/auditor ack) and **mergeable** (clean merge into current `main`).

## Diagnose (read-only)
```bash
git branch --format='%(refname:short)' | grep -v '^main$'
for b in $(git branch --format='%(refname:short)' | grep -v '^main$'); do
  echo "$b ahead=$(git rev-list --count "main..$b")"; done
git worktree list --porcelain | grep -A1 '^worktree'
```
`ahead=0` means the branch is already in `main` (safe to delete with `git branch -d`). `ahead>0` means
unique work — confirm with `git cherry -v main <branch>`: a `+` line is a commit **not** in `main` (keep the
branch); a `-` line is a patch-equivalent commit already in `main` (rebased duplicate).

**Pre-flight each branch WITHOUT touching the working tree** (git 2.55; verified 2026-10-17). This merges
into a tree object only, so it is safe to run while the broker drives, and it is how a landing pass knows
its conflict set before the first `git merge`:
```bash
for b in <the branches>; do echo "$b:"; git merge-tree --write-tree --name-only main "$b"; echo "exit=$?"; done
```
`exit=0` is a clean merge; `exit=1` prints the conflicted paths. `git merge-tree --stdin --write-tree`
computes the conflict set for a whole train in one invocation. Land clean branches first and reserve
conflicts for a quiesced resolution.

## The merge checklist — the gate
Apply the **universal gate** to every branch, then the one **type block** that matches the change. A
branch that fails a row is not ready: send it back through W2; do not merge it "and fix later".

### Universal — every branch
- [ ] Commit message names the item id (`#N`); **one concern**; explicit paths only.
- [ ] **Independent review of the artifact** (W2): a reviewer other than the author re-ran the named
      checks — a peer for craft, a verifier on a **different model family** for reproducibility. Surface
      changes have designer/advocate sign-off.
- [ ] `node --check` passes on every changed `.mjs`.
- [ ] The covering demo passes, and the **failing-first evidence** is named (for code).
- [ ] Merges cleanly into current `main`, or a named conflict-resolution plan exists. A landing pass
      with conflicts must never leave the shared tree mid-merge (see Do step 2).
- [ ] No push/publish (the operator holds push).
- [ ] **Never merge a snapshot/archive branch** (`item-148`, `selfdev-*`; `BRANCH-AUDIT-2026-10-14.md` —
      they sit on old bases and would revert `main`).

### Bugfix
- [ ] A failing-first repro exists (red before, green after), or a named reason one cannot.
- [ ] The **root cause** is named, not only the symptom.
- [ ] No new write path/schema, unless declared in the item.
- [ ] Blast radius stated (what could still be broken).

### Feature
- [ ] Spec/design closed (designer + advocate when user-facing).
- [ ] Tests at the right layer (unit; golden/floor for a TUI, with the floor case explicit).
- [ ] **`FEATURES.md` row updated, OR the item states an explicit "no feature surface" note.** A
      `README`/runbook mention alone does **not** satisfy this row (D62 doc-acceptance). A feature
      that lands with neither is exactly the drift this gate exists to catch (2026-10-17 docs-drift
      finding: `format`, `--dry-run`, instance key, TUI backfill, ROADMAP 69, the `check` rules).
- [ ] Blast radius + rollback stated.
- [ ] Serialization respected (e.g. one `cli.mjs` writer).

### Research / spike
- [ ] Report under `docs/reviews/`; **every external claim cites a URL + evidence class**.
- [ ] Every finding mapped to a mechanism, or explicitly listed **unverified**.
- [ ] Proposed ROADMAP items raised (**registered, not scheduled**).
- [ ] Any code is marked throwaway, or split out under its own bugfix/feature gate.

### Docs-only
- [ ] Cross-links resolve; no stale claims.
- [ ] `check` still passes (run it if the docs affect check).
- [ ] No code touched.

## Do
1. Confirm the branch and its sha: `git log --oneline -1 <branch>`.
2. **Pre-flight the branch** (no working tree) and stop before merging if it conflicts:
   ```bash
   git merge-tree --write-tree --name-only main <branch>; echo "exit=$?"
   ```
   A conflicted branch is resolved per `resolve-merge-conflict.md` in a scratch worktree — never left
   mid-merge in the shared tree.
3. Land it so the sha becomes an **ancestor** of `main` (the worktree-prune criterion):
   ```bash
   git merge --no-ff <sha> -m "merge: land <branch> onto main (#<item>)"
   ```
   Resolve conflicts in the merge commit; never force, never rebase `main`. **Never leave the shared tree
   mid-merge**: resolve to completion in the same operation, or `git merge --abort` immediately if you
   cannot. For a multi-branch pass where any branch conflicts, prefer landing in a scratch/detached
   worktree off `main` and advancing `main` only once the result is clean.
4. Run the item's covering demo on the merged result.
5. Remove the item's worktree if it is clean: `git worktree remove <path>` then `git worktree prune`.

## Verify
```bash
git merge-base --is-ancestor <sha> main && echo LANDED
git rev-list --count main..<branch>    # 0 once landed
node <the item's demo>                 # exit 0
```
Then delete the branch: `git branch -d <branch>` (safe — `-d` refuses anything unmerged).

## If it fails
- A conflict you cannot resolve cleanly: **`git merge --abort` before anything else** — an unresolved
  shared tree breaks `cli.mjs` for the whole rig (`.git/MERGE_HEAD` in a statically-imported module makes
  every verb a `SyntaxError`). Then **stop and report**; send the branch back for a rebase (W2) and name
  the conflict. Never force.
- `git branch -d <branch>` is refused by the seatguard (`refused by durig: would delete a branch`): the
  landing is still complete (the sha is an ancestor of `main`); leave the merged branch in place and
  report it — branch deletion is guard-blocked for author seats, so the operator (or a non-author seat)
  must prune the merged branch.
- A demo is red on the merged result: `git revert -m 1 <merge>` and report the exact failure to the
  author; do not "fix forward" on `main`.
- Unlanded work is piling up: run the Diagnose block, and open one landing pass (see Escalate to).

## Trust, but verify — the periodic audit (read-only)
Landing is an agent responsibility, not an auto-gate. Verify later by running the Diagnose block
periodically (delegate clock-out, or a `check` pass) and reporting the `ahead>0` set. The measurement
that makes this worth doing — **unlanded-verified count and time-to-land** — is ROADMAP item 100.

### Docs-drift audit (read-only)

The same clock-out sweep catches a feature that landed without its doc (D62). For each `feat` commit
since the last audit, print whether the same commit touched `FEATURES.md`/`ROADMAP.md`:

```bash
for c in $(git log --since="<last audit>" --pretty=%H --grep='^feat'); do
  printf '%s  ->  %s\n' "$(git log -1 --pretty='%h %s' $c)" \
    "$(git show --name-only --pretty=format: $c | grep -E 'docs/(FEATURES|ROADMAP)\.md' | tr '\n' ' ')"
done
```

A `feat` commit with no `docs/FEATURES.md` touch (and no explicit "no feature surface" note in its item)
is drift: **report it and route it to `pm`; do not patch the docs by hand.** This is a read-only net —
the durable fix is a `check` rule (ROADMAP item 46's FEATURES-row half / D62), so drop this block once
that rule exists (2026-10-17 docs-drift finding).

## Escalate to
`pm` — to route a landing pass or open a landing item when the `ahead>0` set grows; `lead` — when a
branch cannot merge cleanly.

## Evidence
2026-10-17 branch audit: 18 fully-merged local branches deleted; 15 verified-but-unlanded branches
flagged. The runbook is **unverified** until its Verify step runs on a real landing.
