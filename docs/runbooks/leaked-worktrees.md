---
runbook: leaked-worktrees
symptom: "stray or dirty item-* worktrees; a merged item-branch that cannot be pruned"
writes: false
precondition: "read-only"
last_verified: 2026-10-18
verified_by: delegate
evidence: "2026-10-18: reclaimed 17 merged item-branches pinned by pure-scratch verify worktrees (157->122 worktrees, 109->93 refs, main unmoved, nothing forced). 2026-10-18 (delegate): 34 more scratch-only merged worktrees released by MOVING the generated scratch to .spike/delegate/quarantine (untracked files block git worktree remove), refs 137->84, worktrees 167->130, nothing forced"
check_rule: null
---

# Leaked or dirty `item-*` worktrees

## When to use
`git status` or `git worktree list` shows stray `item-<id>` worktrees, or `serve.err` logs
`worktree: refusing to remove … N uncommitted path(s)`.

## Preconditions
Read-only to inspect. Removing a worktree is a git operation; never discard work you did not create.

## Ownership, ignore, and prune — three rules from the vendored skills

Grounded in the vendored `superpowers` worktree skills
(`vendor/eval/superpowers/skills/using-git-worktrees/SKILL.md`,
`vendor/eval/superpowers/skills/finishing-a-development-branch/SKILL.md`, and
`vendor/eval/superpowers/docs/superpowers/specs/2026-04-06-worktree-rototill-design.md`). These three
rules stop the class this runbook mops up; adopt them at creation/teardown, not per-cleanup:

1. **Provenance decides ownership** — whoever *creates* a worktree owns its cleanup. durian-pi owns the
   trees it creates (`item-<id>`, and `.verify-*`/`verify*`/`wt-*` scratch); anything else is left alone.
   Reap only what durian-pi created; the keep-reasons in `worktree audit` are the per-tree form of this
   rule.
2. **Ignore the worktree/scratch path BEFORE creating it** — the vendored skill runs
   `git check-ignore -q <dir>` and commits a `.gitignore` entry first, because an unignored worktree
   directory leaks the whole tree into `git status`. A durian-pi worktree whose generated scratch shows
   as `??` in the shared tree (`selfdev.sqlite.broker.inbox.out/`, `.durig-test-wt-*`, `verify-*`) is
   this rule violated; the fix is at creation/teardown, not per-cleanup.
3. **Prune after every removal** — run `git worktree prune` after any `git worktree remove`/sweep. A
   directory deleted out-of-band (or by a harness/viewer) leaves a stale registration that keeps
   listing and can confuse the audit; pruning is "one line, prevents silent rot"
   (`finishing-a-development-branch` Step 6). The 2026-10-19 pass found and cleared **25** such stale
   registrations.

Two more shape the `Do` steps: cleanup runs for **merge/discard only**, never for "keep" or an open PR
(the vendored Bug #940 fix); and a refused removal (`contains modified or untracked files`) means the
tree holds files that exist nowhere else — name them and ask, never `--force`.

## Diagnose (read-only)
```bash
node cli.mjs worktree audit              # every worktree: item status, uncommitted count, lock, keep-reason
git worktree list
DURIAN_PI_DB=./selfdev.sqlite node cli.mjs queue   # which item ids are still live?
```
`worktree audit` (ROADMAP 76 / #1881) is the visibility surface: it lists every registered worktree
with the **queue status** of its item, its **uncommitted path count**, its **lock state**, its
**kind** (`item` / `verify-scratch` / `non-item`), and the sweep's **keep-reason** (`live` /
`locked` / `not-terminal` / `branch-unresolved` / `dirty` / `reapable` / `seat-root`). It writes
nothing. A tree that is some seat's persisted `pi.agent`.cwd is `seat-root` (IN USE).
A worktree whose item is terminal is an **orphan**. An orphan with uncommitted work is **dirty**.
Since **#1194** a **locked** orphan is KEPT. Since **#1244** a **branch-held** orphan (every durian-pi
item worktree is on its item branch, #859) is reaped **only when its item is TERMINAL, the worktree is
UNLOCKED and it is CLEAN** — every other case is KEPT and reported. Terminal-ness is necessary, never
sufficient.

## Do
0. **A verify's scratch is torn down when the verify COMPLETES** (ROADMAP 76 leak source B
   prevention, #1907). The verifier runs:
   ```bash
   node cli.mjs worktree scratch clean
   ```
   which UNLOCKS and REMOVES every registered verify-scratch worktree (`.verify-*` / `verify*` /
   `wt-*`). A DIRTY scratch is REFUSED and reported — never `--force`, never `git clean`. This is the
   explicit counterpart to the automatic sweep, which only reaps UNLOCKED scratch; a verifier that
   locks its scratch while working (step 5) unlocks it here on completion. One tree at a time:
   `removeVerifyScratch({ worktree })` from `src/broker.mjs`.
1. At start the broker sweeps orphans and logs `RECONCILE leases=… worktrees=…`. The **#1244 sweep
   contract** — a worktree is reaped only when **ALL** of these hold:
   - it is a durian-pi item worktree (dir `item-<id>`) whose **branch encodes a queue item**
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

2026-10-18 (#1881, ROADMAP 76): the audit surface shipped — `node cli.mjs worktree audit` and the
shared `auditWorktrees`/`classifyWorktrees` rule (the sweep and the audit now agree). LEAK SOURCE A is
fixed: `complete_work`'s teardown now RELEASES the lock on a refused (dirty) removal, so a terminal item
no longer hides behind a lock — the tree is reported `dirty` by the audit and the sweep reaps it as soon
as it is clean. The sweep ALSO honours `seat-root` (a worktree that is a live seat's cwd is never reaped).
Demo `worktree-audit` covers the classification, the dirty-kept-with-correct-count rule, and the
lock-release-on-refusal fix. LEAK SOURCES B (qa verify scratch) and C (stray `M rig.selfdev.json`) are
now VISIBLE in the audit (as `non-item` and as an uncommitted count); preventing them is a follow-up.

2026-10-18 (archive-out-of-tree, operator ruling): 41 merged item-branches pinned by worktrees **dirty
with real content** (tracked mods, probe scripts, nested verify trees) were **archived, not discarded** —
`git worktree move` to `../pi-opendurig.worktrees/` preserved every file (spot-verified md5), then
`git switch --detach` freed the branch (working tree untouched) and `git branch -d` removed the merged
ref. 41 dirs left the project root; `main` unmoved; nothing forced. The archived worktrees stay
registered at the archive path (~6.3 GB) and are recoverable. This is the resolution for the class the
"Reclaiming a merged item-branch" section must KEEP (dirty/real content): relocate rather than discard.
2026-10-18 (#1891, leak source B): qa verify scratch (`.verify-*` / `verify*` / `wt-*`) is now a
distinct audit **kind** (`verify-scratch`) and the sweep RECLAIMS the **unlocked + clean** ones (the
verifier-must-lock protocol protects an in-use scratch; a dirty one is kept). Ordinary `non-item`
worktrees are never reaped. Demo `worktree-scratch` covers the classification and the reclaim/keep
split.

2026-10-18 (#1907, leak source B PREVENTION): the explicit teardown a verifier runs when its VERIFY
completes — `node cli.mjs worktree scratch clean` (or `cleanVerifyScratch({repoPath})` /
`removeVerifyScratch({worktree})` in src/broker.mjs). It UNLOCKS+REMOVES every verify-scratch tree;
a DIRTY one is refused and its work preserved (never --force/clean). Demo `verify-scratch-cleanup`
covers it. qa-side adoption is the remaining half (the mechanism is provided; the verifier must call
it on completion).
