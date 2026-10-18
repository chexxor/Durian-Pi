---
runbook: leaked-worktrees
symptom: "stray or dirty item-* worktrees; a merged item-branch that cannot be pruned"
writes: false
precondition: "read-only"
last_verified: 2026-10-18
verified_by: delegate
evidence: "2026-10-18: reclaimed 17 merged item-branches pinned by pure-scratch verify worktrees (157->122 worktrees, 109->93 refs, main unmoved, nothing forced)"
check_rule: null
---

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
Since **#1194** a **locked** orphan is KEPT. Since **#1244** a **branch-held** orphan (every durig
item worktree is on its item branch, #859) is reaped **only when its item is TERMINAL, the worktree is
UNLOCKED and it is CLEAN** — every other case is KEPT and reported. Terminal-ness is necessary, never
sufficient.

## Do
1. At start the broker sweeps orphans and logs `RECONCILE leases=… worktrees=…`. The **#1244 sweep
   contract** — a worktree is reaped only when **ALL** of these hold:
   - it is a durig item worktree (dir `item-<id>`) whose **branch encodes a queue item**
     (`impl-item-<N>`/`item-<N>`); a branch that does not resolve an id is KEPT;
   - that item is **TERMINAL** (done/cancelled; an id not in the store is KEPT);
   - the worktree is **UNLOCKED**; and
   - it is **CLEAN** (the clean-only guard inside `removeClaimedWorktree`).
   Every other case is KEPT and reported as `worktree-orphan-kept` with its reason (`live`, `locked`,
   `not-terminal`, `branch-unresolved`, `dirty`, `missing`) — never silently discarded. The sweep
   removes the **worktree only, never the branch**: the ref and its commits survive, so a reaped
   worktree is recoverable by re-running `prepare_workspace` for that item. A clean branch-held orphan
   whose item is NOT terminal therefore still needs a manual step: `git worktree unlock item-<id>`,
   then let the next start sweep it, or relocate it (step 4).
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

5. **RESIDUAL RISK — a TERMINAL item's worktree can still be IN USE** (a verifier checking a completed
   artifact, or a post-done fix). The **`locked`** check is the *only* guard against reaping it, so the
   **verifier-must-lock rule** is the protocol: **lock the verify scratch at creation**
   (`git worktree lock <wt>`), and unlock only if scratch removal requires it. A LOCKED worktree is a
   keep-reason, so locking is the verified-safe way to park mid-verify work. (2026-10-17: qa locked all
   seven parked verify scratches; two had already been reaped, but their branch refs survived, so a
   re-run was still possible.)

> **A SECOND reaping path — `complete_work`'s teardown (#1243/#1254/#1260).** The sweep is not the only
> way a worktree disappears: `complete_work` tears down the seat's worktree and flips the seat's cwd
> back to the **shared tree**. That root flip was first misattributed to the sweep; it is a separate
> path (it reaped `item-1179`). The same defence applies — LOCK a worktree you are still using, and the
> branch ref survives regardless.

> **Item branches (#859).** `prepare_workspace` now creates each item worktree ON its
> `<seat>-item-<id>` branch, so a seat's commits land on a branch, not a detached HEAD. A worktree
> made before this change may still be detached: re-run `prepare_workspace` for that item and it
> re-attaches the branch at the current HEAD, preserving any commits already made there. Do not
> hand-roll a branch — the tool owns it.

### Reclaiming a merged item-branch pinned by a verify worktree

A merged item (its branch `ahead=0`) whose worktree is still checked out cannot be pruned until that
worktree is released. Many are qa verify trees: the item worktree is dirty **only** with untracked
`verify-*`/`wt-*` scratch, and each `verify-*` is itself a nested detached worktree. Reclaim them
**only** when nothing can be lost:

1. Qualify each candidate — ALL must hold:
   - the branch is merged: `git rev-list --count main..<b>` is 0;
   - the worktree has **no tracked modifications**: `git -C <wt> status --porcelain` shows only `??` lines;
   - every untracked entry matches `verify-*`/`wt-*`/`.verify*` — a real artifact (a probe script, a
     `position-*.md`, a store file) disqualifies it;
   - **every nested worktree is CLEAN**: `git -C <nested> status --porcelain` is empty. A nested tree
     holding even one untracked probe is uncommitted work — keep the whole candidate.
2. Remove the nested trees first, then the parent:
   `git worktree unlock <nested>; git worktree remove <nested>` … then `git worktree unlock <wt>;
   git worktree remove <wt>`, then `git branch -d <branch>`.
3. `git worktree prune`; then re-run the `branch-cleanup.md` Diagnose.

**Never `--force`.** A parent or nested tree that still holds files makes `git worktree remove` refuse —
that refusal is the safety net; keep the worktree and the branch. `-d` (never `-D`) refuses an unmerged
branch. A **locked** worktree is an intentional keep; unlock one only when its item is done AND its
content qualifies above. This is a mechanical, read-only-to-the-store git operation; the broker may keep
driving.

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
it). Because every item worktree is branch-based, the #1194 sweep reaped only detached/unlocked orphans
— **superseded by #1244, below.**

2026-10-17 (#1244): the sweep is a real backstop again — it reaps a **TERMINAL, UNLOCKED, CLEAN**
branch-held orphan and KEEPS everything else, reporting `worktree-orphan-kept` with `live` / `locked` /
`not-terminal` / `branch-unresolved` / `dirty`. It removes the worktree, **never the branch**. Demos
`broker-worktree-sweep` + `worktree-sweep` cover both the detached and the branch-held cases. The
verifier-must-lock protocol (step 5) was adopted by qa and discharged as #1340.

2026-10-18 (Option A reclaim): **17 merged item-branches reclaimed** (16 batch + 1 pilot) pinned by qa
verify trees whose only content was untracked `verify-*`/`wt-*` scratch and whose nested trees were all
clean; 157→122 worktrees, 109→93 refs, `main` unmoved, nothing forced. **18 candidates were KEPT**
because a nested tree held uncommitted work (probe scripts such as `qa-probes-verdict.mjs`) — the
clean-nested gate is what distinguishes reclaimable scratch from real verification work.

2026-10-18 (locked-terminal follow-up): a reclaim pass over the **58 locked terminal-item worktrees
reclaimed 0** — every one is dirty (11 tracked-only, 8 tracked+untracked, 39 untracked-only), so the
clean gate refuses all. **The blocker is uncommitted content, not the lock.** The lock is a lifecycle
token taken at `createWorktree` (`src/worktree.mjs:385`) and released by the teardown path (`:502`), so a
lingering lock on a terminal item means teardown did not run — informative, but it never justifies
`--force` or `git clean` on a dirty tree. Permanent fix routed to `pm` as operator priority (ROADMAP 76
audit surface + `complete_work` teardown + qa verify-scratch cleanup).
