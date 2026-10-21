---
runbook: resolve-merge-conflict
symptom: "a git merge or landing pass stopped with conflict markers; git status shows UU paths"
writes: false
precondition: "broker-stopped"
last_verified: unverified
verified_by: delegate
evidence: "docs/reviews/llm-prompting-for-git-merging.md; 2026-10-17 landing-safety incident"
check_rule: null
---

# Resolve a merge conflict without stranding the shared tree

## When to use
A `git merge` (or a landing pass) stopped with `CONFLICT`, `git status` shows `UU`/`AA` paths, or tracked
files carry `<<<<<<<` markers.

## Impact
An unresolved shared tree breaks `cli.mjs` for the whole rig: `cli.mjs` statically imports
`src/checkup.mjs` (and `src/metrics.mjs`/`src/seattools.mjs` import it too), so a conflict there makes
**every** `node cli.mjs` verb a `SyntaxError`. This is the 2026-10-17 landing-safety incident
(`docs/incidents/2026-10-17-landing-safety.md`).

## Preconditions
- **Resolve in a scratch/detached worktree, not the shared tree.** The `Diagnose` and pre-flight commands
  below are read-only and safe while the broker drives; a resolution that edits the **shared** tree is not.
- If the conflict is already in the shared tree: **stop the broker and confirm no `genlock.*` is held**
  (`broker-safe-change.md`) before resolving, or `git merge --abort` and redo it in a scratch worktree.
- **Never create a seat worktree while the shared tree is mid-merge:** `carryVisibleState`
  (`src/worktree.mjs`) copies every dirty path it finds, and a `UU` (unmerged) file is carried with its
  `<<<<<<<` markers — the conflict propagates into the new worktree.
- The branch is verified (W2); do not resolve away a semantic conflict just to make the merge complete.

## Diagnose (read-only)
```bash
git status --short
git diff --name-only --diff-filter=U          # the conflicted paths
git config --get merge.conflictStyle           # diff3/zdiff3 exposes the BASE in markers
git rerere status                              # only if rerere is enabled
```
**Pre-flight a branch before touching the tree** (git 2.55, verified 2026-10-17): this merges into a
tree object, never the working tree.
```bash
git merge-tree --write-tree --name-only main <branch>; echo "exit=$?"
```
`exit=0` → clean merge; `exit=1` → the named paths conflict. Use it to sort a landing train: land clean
branches first, schedule conflicts for a quiesced window.

## Do
1. **Resolve in a scratch worktree** off the merge base; keep `main`'s working tree untouched:
   ```bash
   git worktree add --detach ../resolve-<item> main
   ```
2. **Deterministic first — but never `git checkout`.** durian-pi's seat guard (`src/confine.mjs`
   `DENIED_COMMANDS`) refuses `git checkout`, `switch`, `reset`, `restore`, `clean`, `stash`, `revert`,
   `branch -D`, `add -A`/`add .` and `push` in a seat shell. Each refusal NAMES the verb it fired on —
   and the guard refuses the WHOLE command on the FIRST matching rule, so a refusal on a COMPOUND
   command says nothing about its other verbs: **test a verb ALONE before concluding it is blocked.**
   **`git rebase` is NOT refused** — there is no rebase rule in the deny list. Measured 2026-10-20: a
   compound `checkout -b …; rebase main` was refused naming only `checkout`, which led a seat to condemn
   the whole verb class and put "rebase is refused" into an operating note (#3379, retracted).
   `git rebase main` alone exits 0 in a seat worktree.
   **So an author rebase needs no throwaway worktree for PERMISSION.** Rebasing the branch your worktree
   already has checked out is just `git rebase main`. The throwaway worktree is still needed for a
   DIFFERENT reason: `git rebase <upstream> <branch>` is allowed but CHECKS THAT BRANCH OUT in your
   worktree, moving your HEAD off your item branch. If you must do that, do it in a throwaway linked
   worktree and publish with `git update-ref refs/heads/<branch>-rebased <sha>` — the artifact is the
   published ref, not a commit from your item worktree.
   Choose a side by reading the stage blobs and writing the chosen content:
   ```bash
   git show :2:<path>    # ours (current branch)
   git show :3:<path>    # theirs (incoming)
   git show :1:<path>    # base (common ancestor)
   ```
   Write the chosen content with the `write` tool, not a shell redirect, so the write guard still sees it.
   `git rerere` may replay a recorded resolution; read `git rerere diff` before trusting it — rerere
   matches by content (not path) and can silently apply a stale resolution.
3. **Get the three-sided view** for semantic conflicts (feed the model base + ours + theirs with ~20 lines
   of context). Reconstruct the sides with the `git show :1: :2: :3:` commands above; if you can set it
   **before** the merge, `git config merge.conflictStyle zdiff3` embeds the base in the markers (a
   repo-level choice — record it if changed).
4. **Resolve one hunk at a time** with the `edit` tool. Keep **both** sides when the change is additive
   (the `#714` conflict was a union). If the intent is ambiguous, **abstain** — leave the conflict and
   `defer_work` rather than guess.
5. **Stage explicit paths only:** `git add <path>` — never `git add -A` or `.`.
6. **Whole-file coherence:** re-read the resolved file, run `node --check <changed>.mjs`, and run the
   item's demo before completing the merge — per-hunk correctness does not guarantee a consistent file.
7. Complete the merge in the scratch worktree, then advance `main` only when clean (see `merge.md`).

## Verify
```bash
git status --short            # no UU/AA paths, no .git/MERGE_HEAD
git grep -n '^<<<<<<<'        # no output
node --check <changed>.mjs    # clean
node <the item's demo>        # exit 0
```

## If it fails
- Cannot resolve: **`git merge --abort` first** — an unresolved shared tree breaks `cli.mjs` for the whole
  rig. Then report the branch and conflicting paths; send it back for a rebase (W2). Never force.
- A hunk is genuinely ambiguous: abstain and `defer_work`; do not guess a merge.

## Escalate to
`lead` — a conflict needing a semantic/scope decision; `pm` — to route the branch back or open a landing
pass.

## Evidence
Grounded in `docs/reviews/llm-prompting-for-git-merging.md` and
`docs/reviews/llm-prompting-for-git-merging-followup.md` (deterministic-first cascade; per-hunk
resolution with explicit abstention; 3-way base/ours/theirs context; guard-denied `git checkout`) and the
2026-10-17 landing-safety incident. `git merge-tree --write-tree` pre-flight verified locally on git
2.55.0.windows.5 (2026-10-17). `last_verified: unverified` until the Verify step runs on a real conflict.
