> **D103 rename (2026-10-18):** this record predates the product rebrand `durig` → `durian-pi`; it keeps the old name so the audit trail stays truthful.

---
incident: seat-root-fallback-commit
date: 2026-10-17
severity: sev1
status: mitigated
symptom: "a commit reached main and the shared tree moved to an item branch, with no landing pass"
runbook: leaked-worktrees
fix: "50f981a"
prevention: "prepare_workspace refuses a non-worktree cwd (50f981a, demo/prepare-workspace.test.mjs); check rule shared-tree-on-main (demo/shared-tree-on-main.test.mjs); constitution P3 self-check; still owed: #1151 DURIG_EXPECT_WORKTREE wrong-root guard"
last_reviewed: 2026-10-19
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

## Recurrence 2026-10-19 — `devtools` #2412: cwd set to a directory that is NOT a git worktree

*Detected by the operator asking why the shared tree was on a non-`main` branch; analysed and recovered
by the delegate.*

**Landed fix (`50f981a`, 2026-10-19).** The root cause is closed at the source: `prepareSeatWorkspace`
(`src/worktree.mjs`) now calls `validateWorktreeIdentity` on an existing `item-<id>` path BEFORE any git
mutation and fails closed if it is not a registered worktree, so it can no longer run
`git checkout -B` against the shared repo. Defence in depth also landed: the `check` rule
`shared-tree-on-main` (`src/checkup.mjs` + `readSharedTreeBranch` in `src/featuredocs.mjs`) fails the run
when the shared tree is off `main` (or detached), and `constitution.txt` P3 Safety now tells every seat
to confirm `git rev-parse --show-toplevel` equals its seat root before any mutating git command.
Demos: `demo/prepare-workspace.test.mjs` (leftover refusal) and `demo/shared-tree-on-main.test.mjs`.
**Still live:** other paths can still fall a seat's cwd back to the shared tree (F12); the `#1151`
`DURIG_EXPECT_WORKTREE` wrong-root guard remains the outstanding mutation-point control.

**Same class, new trigger.** The `devtools` seat's persisted root was
`C:\Users\Alex\dsh-Projects\pi-opendurig\item-2412`, but **`item-2412` was not a registered git
worktree** — it was a plain subdirectory of the shared tree holding only a stray `nul` file. Because it
lives inside the main worktree and has no `.git`, every git/file operation run from that cwd resolved to
the **shared repository**. So `devtools`, believing it worked in `item-2412`:

- switched the shared tree to its item branch —
  `5032158 HEAD@{2026-10-19 01:42:52 -0500}: checkout: moving from main to devtools-item-2412`
  (`06:42:52Z`, immediately after `WAKE devtools` at `06:42:31Z`); and
- edited shared-tree files directly: `pi-main.pin.json`, `scripts/sync-pi.mjs`, `src/worktree.mjs`
  (mtime `06:34–06:43Z`) plus untracked `demo/worktree-prune.test.mjs`.

Unlike the 2026-10-17 occurrence, **no commit reached `main`**: `main` and `devtools-item-2412` both
stood at `5032158`, and `main` was an ancestor of the shared tree's HEAD, so nothing was lost. The harm
was the shared tree being off-`main` and under direct seat edits — the landing/merge basis was broken.

**Why the plain dir existed:** `prepare_workspace` for `#2412` did not leave a registered worktree at
`item-2412` (the provisioning path is the known-broken `#1754` / `#2336`), yet the seat cwd was still
recorded as `item-2412`. The seat itself noticed (its transcript reasons *"item-2412 directory is just a
subdirectory within the main worktree"*) but had no guard to stop it.

**Resolution (delegate, operator-directed).**
1. Snapshotted the WIP (`.spike/delegate/seat-root-recovery-2412/devtools-wip-2412.patch` +
   `worktree-prune.test.mjs`) and parked it to `stash@{0}` (named, for `devtools`).
2. Moved the plain `item-2412` dir aside to
   `.spike/delegate/seat-root-recovery-2412/item-2412-plain-backup` (preserved, never deleted).
3. `git switch main` — shared tree restored to `main`, clean of tracked mods.
4. `git worktree add item-2412 devtools-item-2412`; re-applied the WIP inside the new worktree.
5. `devtools`' root (`…\item-2412`) now resolves to a real worktree (`git -C item-2412 rev-parse
   --show-toplevel` -> the worktree); `worktree audit` marks it `seat-root`.

**Added prevention (extends the list above):**
5. **`prepare_workspace` must refuse a seat cwd that is not a registered worktree** — verify
   `git rev-parse --show-toplevel` from the candidate path equals that path before recording it. This is
   the direct, mechanical control for the "plain dir inside the shared tree" trigger.
6. Keep the standing `check` rule (#3): shared tree must be on `main`.

**Evidence.** `git branch --show-current` -> `devtools-item-2412`; `git worktree list | grep item-2412`
-> none (before the fix); `worktree audit` `seatRoots` -> `devtools = …\item-2412`; `ls item-2412` ->
only `nul`, no `.git`; `git -C item-2412 rev-parse --show-toplevel` -> shared repo; reflog
`checkout: moving from main to devtools-item-2412` @ `01:42:52 -0500`; `git diff --stat` of the shared
tree -> `pi-main.pin.json | 20 ++`, `scripts/sync-pi.mjs | 2`, `src/worktree.mjs | 40 ++`.

## Links
`docs/incidents/2026-10-17-live-worktree-reap.md` · `docs/runbooks/leaked-worktrees.md` · queue `#1151`, `#1581`
