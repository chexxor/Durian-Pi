---
runbook: leaked-worktrees
symptom: "stray or dirty item-* worktrees; a merged item-branch that cannot be pruned"
writes: false
precondition: "read-only"
last_verified: 2026-10-19
verified_by: delegate
evidence: "2026-10-18: reclaimed 17 merged item-branches pinned by pure-scratch verify worktrees (157->122 worktrees, 109->93 refs, main unmoved, nothing forced). 2026-10-19: 27 dirty merged worktrees RELOCATED to ../pi-opendurig.worktrees/ (untracked+tracked residue preserved) after switch --detach + branch -d, plus 4 clean+locked+terminal worktrees removed (1390/1531/1585/1108), refs 108->73, main unmoved, nothing forced. 2026-10-19 (second pass): 9 merged+dirty+unlocked terminal trees relocated (2629/2683/2701/2720/2728/2737/2766/2772/2910) + 2 reapable removed (2632 merged, 2757 unmerged-so-ref-kept) + 4 landed-but-dirty trees relocated (1705/2600/2602/2643); worktrees 206->204, refs 111->83, nothing forced"
check_rule: null
---

# Leaked or dirty `item-*` worktrees

## When to use
`git status` or `git worktree list` shows stray `item-<id>` worktrees, or `serve.err` logs
`worktree: refusing to remove … N uncommitted path(s)`.

## Impact
Leaked worktrees are not just clutter: a dirty orphan pins its **item branch**, so the merged ref can
never be pruned and `git branch`/worktree operations slow down while hiding the small set of genuinely
unlanded work. The dirty files also exist **nowhere else** (the item's own commit is on the branch, but
the residue is not), so a careless `--force` or `git clean` is real data loss. Blast radius of the
git-only reclaim below is low — it touches no store — so the broker may keep driving.

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
### Retention for the relocated archive (`../pi-opendurig.worktrees/`)

Relocating a dirty tree is **not a disposition** — it is a deferral, and nothing in this runbook ever
reclaims the archive. Measured 2026-10-20: **179 registered worktrees, 179 carrying changes, 1,562 changed
paths** (145 with their HEAD already MERGED into `main`, 34 UNMERGED), occupying ~20 GB. So the honest
answer to "do these stay forever?" is: they do, unless someone applies the rule below.

**The rule:** an archived tree is kept only while it holds something the repo cannot reproduce from a ref.
That gives three tiers, and every removal goes through `git worktree remove` (never `Remove-Item` — these are
REGISTERED worktrees and a hand-delete leaves 179 stale entries in `.git/worktrees/`).

1. **Merged + clean** → remove outright (`git worktree remove <wt>`), then `git worktree prune`.
2. **Merged + dirty** (the bulk: 145 trees today) → the branch content is already on `main`; the only value
   is the uncommitted residue. Export it losslessly, then remove:
   ```bash
   git -C <wt> diff --binary > <archive>/<name>.patch
   git -C <wt> status --porcelain | awk '$1=="??"{print $2}'   # copy these: they are NOT in the patch
   git worktree remove --force <wt>
   ```
3. **Unmerged** (34 today) → the commits live on branch refs, so the refs preserve them; the tree itself is
   only needed while someone may resume the work. Export the same two artifacts and remove, OR keep the tree
   and record why in the item. Never keep one silently.

**Resolve each tree's ITEM STATUS from the store before deciding** (operator's suggestion, 2026-10-20):
the directory name carries the id (`item-<id>` or `<seat>-item-<id>`), so one `queue` read classifies the
whole archive. Measured on the 179 trees: **179/179 map to a TERMINAL item** (done/cancelled), **0 live** --
which is what makes a bulk pass defensible at all. A live (queued/claimed/deferred/held) item is the one
case that keeps a tree unconditionally, and an id that is not in the store at all means someone must look
before anything is deleted.

**And check whether the tree's HEAD survives in a REF, because deleting a worktree deregisters its HEAD.**
For the 34 unmerged trees here, **13 hold commits contained by NO ref** (`item-1704`, `item-2103`,
`item-2154`, `item-2179`, `item-2182`, `item-2186`, `item-2515`, `item-2578`, `rel-item-673`, `700`, `705`,
`746`, `860`) -- removing those trees would eventually let `gc` collect real work. Preserve them first:
`git update-ref refs/heads/archived/<name> <sha>` (or `git bundle create`), THEN export the diff and remove.

So the full decision is a three-question ladder, in this order:
1. **Item live?** -> keep the tree (and say why in the item).
2. **Item terminal?** -> export the uncommitted residue (`diff --binary` patch + copied untracked files).
3. **HEAD not in any ref?** -> `git update-ref` an `archived/*` ref (or bundle) first. Then
   `git worktree remove --force` and `git worktree prune`.

**Never** hand-delete the whole directory: it is a registered-worktree set, and untracked files in it are
invisible to a patch. **Do** sequence any bulk pass after heavy installs/builds — it is hundreds of `git`
invocations and will fight a model pack build for the disk.

4. **Tidy without discarding:** a terminal orphan can be relocated out of the project root instead of
   removed — `git worktree unlock <wt>` then `git worktree move <wt> <archive-dir>/<wt>` — which preserves
   every uncommitted file and every branch. The delegate used `../durian-pi.worktrees/` (2026-10-17:
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

### A `%TEMP%/verify*` scratch that will not remove (junction `node_modules`)

Verify scratch under `%TEMP%` often has a `node_modules` that is a Windows **junction/symlink**. The
removal guard refuses any worktree containing a junction/symlink (Git 2.42 deletes THROUGH a junction
and can destroy the target), so those trees leak and re-print on each broker start:
`worktree: unlock of <path> did not apply: … is not locked`. That warning is **benign** — the tree was
simply not locked. Reclaim one junction-first, clean-only:
```bash
 git -C <wt> status --porcelain           # MUST be empty (never force)
 cmd /c rmdir "<wt>\node_modules"          # removes the LINK only — never `rm -rf` a junction
 git worktree unlock <wt>                   # ignore "not locked"
 git worktree remove <wt>
 git worktree prune
```
2026-10-19: five registered `%TEMP%/verify*` trees (e.g. `verify1102-210800`, dated Oct 16) were found
un-reapable for exactly this junction reason.

### A seat's cwd is a plain directory, not a worktree (the shared tree switched branch)

Symptom: `git worktree list` shows the **shared tree** on an item branch (e.g. `devtools-item-2412`),
the shared tree's `git status` carries the seat's edits, and `worktree audit` reports a seat root that
`git worktree list` has **no entry for** (so `git -C <that path> rev-parse --show-toplevel` resolves to
the shared repo). The seat's git and file commands are therefore hitting the shared tree, and the old
`prepare_workspace` reuse path switched the shared tree's branch (2026-10-19 devtools #2412). Recover
WITHOUT discarding the seat's work:

1. Snapshot the shared-tree WIP to `.spike/`: patch (`git diff > <patch>`) and copy any untracked files.
2. Park the tracked WIP: `git stash push -u -m "delegate: park <seat> WIP for seat-root recovery" -- <paths>`.
3. `git switch main` on the shared tree (same SHA as the branch, so this is a clean ref switch).
4. Move the leftover plain dir aside (never delete blind), then create a REAL worktree at the SAME path
   the seat's cwd already names: `git worktree add <path> <seat>-item-<id>`.
5. Re-apply the parked WIP inside the new worktree (`git -C <path> apply <patch>` plus the untracked
   files). The seat's persisted cwd is unchanged, so it now resolves to the real worktree.
6. `node cli.mjs worktree audit` must show the seat root and that worktree as `seat-root`.

Prevention now in place: `prepare_workspace` refuses a leftover non-worktree (`50f981a`); the `check`
rule `shared-tree-on-main` flags the state; `constitution.txt` P3 Safety tells the seat to run the
`rev-parse --show-toplevel` self-check first. Full record:
`docs/incidents/2026-10-17-seat-root-fallback-commit.md`.

## If it fails
If a worktree will not remove (Windows file locks), close any process with it open and retry; the fallback
is `git worktree remove --force` **only after** its work is committed or knowingly discarded.

### The lock flag reads WRONG from `--porcelain`
`git worktree list --porcelain` emits `locked` as its own line **after** the `branch` line, so a naive
"next worktree's key" association attributes it to the FOLLOWING tree. Measured 2026-10-19: that parse
reported **all 22** merged worktrees as LOCKED, including unlocked ones — wrong in the safe direction
here, but the same mistake in the other direction would relocate a live seat root. Read the **terse**
form, which annotates the flag on the same line (`<path> <sha> [<branch>] locked`):
```bash
git worktree list | grep ' locked$'                  # the locked set
git worktree list | grep -E "\[$b\]( locked)?\$"     # one branch's line plus its lock flag
```

### A landing can make an UNRELATED ref prunable mid-pass
Ref classification is point-in-time. Landing `impl-item-1705` (tip `349d5d3`) made
`auditor-item-2757` — recorded `ahead=4` at Diagnose, same tip — an ancestor of `main`, so a ref that was
unprunable at the start of the pass was safely `-d`'d at the end. Re-run the merged/held classification
after each landing batch, and always gate on the live `git merge-base --is-ancestor <branch> main` rather
than a remembered `ahead` count.

## Escalate to
`pm` — to open a landing pass for the `ahead>0` set, or an item for a leak source (CARRY, verify scratch,
seat-root fallback) that keeps producing orphans; `lead` — when a branch cannot merge cleanly; the
operator — for any worktree whose content must be **discarded** (never a delegate or seat decision),
and for the lock-state ambiguity that would relocate a live seat root. Model of the whole lifecycle:
`docs/BRANCH-AND-WORKTREE-LIFECYCLE.md`.

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
`git worktree move` to `../durian-pi.worktrees/` preserved every file (spot-verified md5), then
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

2026-10-19 (CARRY/teardown collision): `createWorktree` CARRIES the shared tree's tracked-dirty files
into every new item fork (`src/worktree.mjs:134`, ASK F/#506), while `complete_work`'s teardown is
clean-only (D60) — so while the shared tree is dirty, a completed item's worktree can NEVER be removed
and leaks on every completion. Observed on `item-2231` (`impl-item-2231 @166d51f`, 5 paths) and
`item-2224` (`a2eaf7b`, 4), plus `item-2305`/`item-2315`/`item-2340`. Full record +
`src/worktree.mjs:119/134/195/494/541-546` citations: `docs/incidents/2026-10-19-worktree-carry-teardown-collision.md`;
defect routed to `pm` (intent `worktree-carry-collision-2026-10-19-1`).

2026-10-19 (junction-blocked scratch): five registered `%TEMP%/verify*` verify-scratch trees were found
un-reapable because their `node_modules` is a Windows junction/symlink, which the removal guard refuses
(Git 2.42 deletes through a junction). Their repeated
`worktree: unlock of <path> did not apply: … is not locked` line on broker start is benign (already
unlocked). The safe junction-first reclaim is now documented above.

2026-10-19 (delegate, operator-directed land+prune pass — the CURRENT recipe to copy): most merged
item worktrees are DIRTY with the shared tree's CARRY residue (`src/worktree.mjs:134`) plus generated
scratch, so the clean-only removal guard refuses all of them and `worktree audit` reports
`reapable: 0`. Do NOT force them and do NOT `git clean`. The working recipe is the **relocate-out-of-tree**
path (step 4 above), per the 2026-10-18 operator ruling:
```bash
AR=../pi-opendurig.worktrees        # the existing archive; 86 trees already there
for b in <merged-branch>; do
  wt=<its worktree path>
  git worktree move "$wt" "$AR/$(basename "$wt")"
  git -C "$AR/$(basename "$wt")" switch --detach     # frees the branch
  git merge-base --is-ancestor "$b" main && git branch -d "$b"
done
git worktree prune
```
This preserves every file (tracked and untracked) and removes the merged ref. Only touch worktrees
whose branch is MERGED (`git branch --merged main`) and that are UNLOCKED — a locked/live worktree is
an intentional keep (a claimed item or a seat root). Result: 27 relocated in one batch, refs 108->73,
`main` unmoved, nothing forced. The 4 refs that needed no relocation were clean+locked+terminal
(`impl-item-1390`, `scribe-item-1531`, `impl-item-1585`, `impl-item-1108`): `git worktree unlock` ->
`git worktree remove` -> `git branch -d`.

**Two rules that must be applied per TREE, not per branch list (2026-10-19, second pass):**1. **Re-check the LOCK state from `git worktree list`'s TERSE output**, where it is annotated as a
trailing ` locked`. A `--porcelain` parse is easy to get wrong: the `locked` line follows the `branch`
line, so a naive "the next worktree's lock" association marks the wrong tree (it reported all 22 merged
worktrees as LOCKED, including ones that were unlocked). Reading the terse line (`<path> <sha> [<branch>]
locked`) is unambiguous. Getting this wrong in the SAFE direction wastes a pass; in the unsafe
direction it would relocate a live seat root.
2. **Relocating a tree does not always free only its own ref — check for followers.** Landing
`impl-item-1705` (tip `349d5d3`) made `auditor-item-2757` (same tip, `ahead=4` at the start of the pass)
an ANCESTOR of `main`, so its ref became prunable mid-pass. Re-run the `merged`/`held` classification
AFTER each landing batch; a ref recorded as unmerged at Diagnose time can be safely `-d`'d later in the
same pass (`git merge-base --is-ancestor` is the gate, never a remembered count).

2026-10-19 (seat-side): `scribe` finished `#3035` (branch `scribe-item-3035 @ f450cdd`, tree retired on
completion), then went looking for `item-3035` to amend an ADVISORY landing note, concluded "the worktree
is gone … to amend I'd need to recreate it", and nearly rewrote a completed branch's tip for no semantic
gain. Nothing was lost — the branch was intact and CLEAN against `main`. The gap was **audience**: this
runbook (delegate-facing) already says the branch survives and gives the re-attach recipe, but seats read
`WORK-ITEM-LIFECYCLE.md`, which did not. Fixed there (**§8a**: worktree ephemeral / branch durable, the
three states, the re-attach recipe, and the never-amend-a-completed-branch rule). Record:
`docs/incidents/2026-10-19-terminal-worktree-mistaken-for-lost-work.md`. **If a seat asks "where is my
worktree?", point it at §8a rather than re-explaining** — and check whether the item was merely
terminal (normal) or live (a keep, never a force).
