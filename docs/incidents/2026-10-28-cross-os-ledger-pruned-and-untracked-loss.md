# 2026-10-28 — the first pass on this host pruned the cross-OS worktree ledger, and five never-committed instruments vanished from `demo/`/`tools/`/`src/`

*Host:* `Alex-Desktop-Win10`, Linux (Fedora `7.2.11-200.fc44.x86_64`), btrfs `/home` subvolume, `timedatectl show` →
`NTP=yes NTPSynchronized=yes` **`LocalRTC=yes`**. *Repo:* `/home/chexxor/Git/Durian-Pi`, `main`, HEAD `1b737f2`
(`2026-10-28 14:30 -0500`). *Delegate session.* **No source file and no queue transition was changed by this
session**, and nothing here is inferred: each claim names the command that shows it.

## What is measurable right now

| # | Fact | How to re-check it |
| --- | --- | --- |
| 1 | The `git worktree` ledger for this repo holds **one** entry (the main checkout). Earlier in the same session it held **36**, of which **20** were `C:\Users\Alex\dsh-Projects\…` paths (the workspace-move evidence `docs/runbooks/workspace-move.md` Step 1 tells you to inventory and protect) and 2 were `.spike/wt/one`, `.spike/wt/two`. | `git worktree list` · `ls .git/worktrees` (empty) · `ls .spike/wt` (no such directory) · `.spike/delegate/worktree-inventory-after-1715.txt` holds the single-worktree ledger; the 36-entry ledger is in this session's `tools/worktree-cleanup.mjs --dry-run` output, and the instrument itself is now gone |
| 2 | Five instruments that this session read or ran **are absent from disk and absent from git**: `tools/worktree-cleanup.mjs`, `src/worktree-cleanup.mjs`, `demo/worktree-cleanup.test.mjs`, `demo/broker-serve.test.mjs`, `demo/clock-skew.test.mjs`. Also gone: `demo/broker-clock-step.test.mjs`, `demo/verify-sweep-cleanup.test.mjs`, `demo/verify-sweep-adversarial.test.mjs`. | `for f in tools/worktree-cleanup.mjs src/worktree-cleanup.mjs demo/worktree-cleanup.test.mjs demo/broker-serve.test.mjs demo/clock-skew.test.mjs demo/broker-clock-step.test.mjs demo/verify-sweep-cleanup.test.mjs demo/verify-sweep-adversarial.test.mjs; do [ -e "$f" ] && echo PRESENT || echo MISSING; done` |
| 3 | **None of them was ever committed**: `git log --all --diff-filter=A --name-only -- <those paths>` prints nothing, so `git status` cannot show their loss (it reports only `M tools/broker-serve.mjs`, `M tools/channel-preflight.mjs`, `?? .scratch/`) and history cannot restore them. | the commands above · `git status --short -- .` |
| 4 | `docs/ROADMAP.md` rows **212** and **213** credit `src/worktree-cleanup.mjs` / `tools/worktree-cleanup.mjs` as landed, and `docs/runbooks/workspace-move.md` tells the next session to run `node tools/worktree-cleanup.mjs --dry-run` **before `up`**. That command now fails with `MODULE_NOT_FOUND`. | `node tools/worktree-cleanup.mjs --dry-run` |
| 5 | `docs/ROADMAP.md` rows for 210–231 are intact (row 217 at line 3822 of 4184). No tracked file was lost. | `wc -l docs/ROADMAP.md` · `grep -n '^\*\*217\.' docs/ROADMAP.md` |

## The ledger half has a mechanism, and it is in the product

`pruneWorktrees(repoPath)` (`src/worktree.mjs:649`) runs `git -C <repo> worktree prune`, which deletes every
registration whose directory cannot be read. It is called **unconditionally** from:

- `src/broker.mjs:1167` — at the end of the broker's worktree sweep, with the comment *"Prune once at the end so the
  sweep self-heals those, **whether or not it removed anything this pass**"*;
- `src/worktree.mjs:667` (`removeWorktree`) and `src/worktree.mjs:1326` (`deleteWorktree` path, *"prune must run
  against the common dir's parent"*).

On a workspace that **moved between operating systems**, every registration from the other OS points at a path this
host cannot read (`C:\Users\Alex\…`). So the first sweep, or any single worktree removal, erases the whole cross-OS
ledger — which is precisely the set `docs/runbooks/workspace-move.md` Step 1 says to inventory **because it is the
evidence**, and the set ROADMAP 212 treats as non-removable. This session removed no worktrees; it ran
`tools/worktree-cleanup.mjs --dry-run` twice (which prints `removes nothing — a removal under --dry-run is impossible
by construction`) and a batch of the product's own demo suite from the main checkout, including
`demo/seat-root.test.mjs`, `demo/delivered-change-e2e.test.mjs` and `demo/broker-worktree-sweep.test.mjs`, all of
which create and remove real worktrees in this repo through `src/worktree.mjs` — i.e. they hit `removeWorktree` →
`pruneWorktrees(REPO)`.

## The file-loss half is **not** explained, and that is the finding

The missing files are exactly the **untracked** ones: `demo/` now shows **247** `ls -la` lines, and `git status`
cannot report a single one of the losses. No `git clean` exists anywhere in `src/`, `tools/` or `demo/` (checked: only
`src/confine.mjs:262` and `src/seatguard.mjs:91` name `git clean` as a *refusal target*). There is **no tracked
baseline** of `demo/`'s untracked contents in this repo, so the loss cannot be quantified against a committed count —
which is itself part of the finding (ROADMAP 214's commit boundary, and the reason "the suite has N members" claims in
`docs/ROADMAP.md` cannot be re-checked after the fact).

What *is* in the repo is the same event recorded twice before. `docs/incidents/2026-10-26-worktree-and-scratch-sweep.md:20-30`
shows `git worktree list → 1 (main only)`, `git branch → main only`, `ls .spike | wc -l → 16`, and states: *
"`.spike` entries created **earlier in this same session** … are gone; entries created after the event survive. So the
sweep is bracketed in time, not inferred."* That is this session's signature exactly — the ledger back to 1, and a
session-written `.spike/delegate/worktree-inventory-before.txt` (307 lines, recorded by `wc -l` when it was written)
absent afterwards while older `.spike/delegate/*` files survive. So this is the **third recorded occurrence** of one
sweep class on this rig, and the earlier two did not produce a mechanism either.

## Why this gates the standing priority

`docs/NEXT.md` ranks "keep the delivery channel resident" second. A resident channel on this host means a **broker
pass running in this checkout**: seats inherit the launching command's cwd (D107, no seat-root default) and
`rig.selfdev.json` names no `cwd` for `pm`, so a pass would (a) prune the cross-OS ledger on its first sweep
(`src/broker.mjs:1167`), and (b) wake seats that cannot run a shell at all (ROADMAP 217: `pwsh`/`powershell` both
unspawnable here — `tools/broker-serve.mjs --dry-run` now blocks on `seat-shell-availability`). A seat that cannot run
`git status` or `git diff` cannot observe, report, or recover from a clobber either. So 212, 214, 217 and the new 232
are preconditions, not cleanups.

## One host fact that needs the operator

`timedatectl show` reports **`LocalRTC=yes`** on a box that also boots Windows — the classic source of hour-scale
clock steps — and this session's wall clock is internally inconsistent: a `channel-preflight` run this session wrote
`"at": "2026-10-28T20:50:30Z"` (= 15:50 CDT) while a later `date -Is` in the same session printed
`2026-10-28T15:07:48-05:00`. Elapsed-time rules in the rig are `Date.now()` arithmetic — e.g. the broker's bounded
graceful stop, `const graceMs = …` / `graceExpired() { … now() - at >= graceMs }` at `src/broker.mjs:1579-1593`, whose
deadline is measured from *when the stop was requested* (`src/broker.mjs:1576-1578`) — plus claim `expires at`, the
broker's cooldown/liveness bookkeeping, and every "age" line in `clockin-digest`/`channel-preflight`. A step of tens of
minutes makes those numbers lie in both directions. `demo/broker-clock-step.test.mjs`, named in ROADMAP 210's signal
list, is among the lost files, so the product's own regression for this is gone too.

## Asks (all operator/pm-owned; this session decided none of them)

1. **232** to the head with this file as the acceptance evidence: `pruneWorktrees` must refuse (or require an explicit
   grant) when the registrations it would clear belong to another OS/hostname, and a sweep that changes the **main**
   checkout's ledger must fail a test unless that checkout is the one it owns.
2. **233**: no roadmap row may credit an instrument that is not in `git ls-files`; the five files above are gone and
   nothing in the repo could show it. This is ROADMAP 214's commit boundary with a new consequence attached: an
   uncommitted instrument cannot be *credited*, *diffed*, or *recovered*.
3. Re-run the workspace-move inventory protocol (`docs/runbooks/workspace-move.md` Step 1) before any `up`/`worktree`
   verb, and treat `git worktree list` output as evidence, not litter.
4. Do not start the channel from this checkout on this host until 212 + 214 + 217 + 232 land.

## What the second session (2026-10-28T21:5xZ) could and could not recover, measured

The other NVMe volume is the **Windows system volume** and is readable from Linux: `/dev/nvme0n1p3` mounted at
`/run/media/chexxor/0094126294125A8C` (`nvme1n1p3` holds Linux `/` and `/home`). Under it:
`Users/Alex/dsh-Projects/pi-opendurig` (the pre-move checkout, last Windows write **2026-10-24 22:08**),
`pi-opendurig.land`, `pi-opendurig.worktrees` (the `stray-archive-20261021-104326` tree) and `tmp/durig-split-rehearsal/`.

**1. The sweep destroyed nothing that was in git — the loss set is exactly the untracked files.** Comparing the Windows
tree (Oct-24 era) against this checkout, **zero** files present there are absent here: `demo` 242 → 245, `tools` 1 → 12,
`src` 56 → 57, `scripts` 17 → 17, `cli.mjs` 1 → 1. And after the event `git status --porcelain --untracked-files=all --
demo tools src scripts` reports **0 untracked files**: every survivor of the sweep is tracked, every loss was not. That is
the sharpest statement of the blast radius available, and it also says the sweep was never a `rm -rf demo/` — an
Oct-24-era file would then be missing, and none is. (`.scratch/` surviving is still the one fact `git clean -fd` at the
repo root does **not** explain, so the mechanism stays a named candidate, not a finding.)

**2. The pre-move refs are restorable at effectively zero cost.** `git fetch <windows clone> '+refs/heads/*:refs/rescued/*'`
created **32 refs in 0.022 s** and transferred essentially nothing: all 32 branch *tips* were already objects in this
clone — they were **unreachable**, not missing (`git merge-base --is-ancestor 9f624ff4 HEAD` → false). Re-check:
`git for-each-ref refs/rescued | wc -l`.

**3. The unreachable pre-move history is in the Windows object store, and a fetch will not bring it.** Windows store:
**21,756 objects** across **3 packs** + `multi-pack-index` (19 MB total) against this checkout's **9,285** — **13,057
objects this clone lacks**. Copying only the three `*.pack` files into `objects/pack/` and running `git index-pack` on each
raised the disposable clone to **22,335 objects**, `git fsck --connectivity-only` **clean** (dangling trees only), and
surfaced **2,081 commit objects of which only 1,614 are reachable from refs — 467 commits exist only as unreachable
objects**. Effect on the queue's evidence: of the 30 shas recorded unresolvable in
`.spike/delegate/held-sha-unresolvable.json`, **23 resolve after the pack copy** and **6 resolve in neither clone**
(`cfb4457`, `eb7e69c1e`, `5d8c6237a`, `e8fdab6`, `c04cfac`, `0c6fd7665`). A normal `git fetch` recovers **none** of them,
because the protocol never sends unreachable objects.

**4. Pitfall, learned the hard way in a throwaway clone:** copying the pack *auxiliary* files (`.idx`, `.rev`, `.mtimes`,
`multi-pack-index`) corrupts reads — every object read then fails with `fatal: mmap failed: Permission denied` and
`git cat-file` returns nothing. Copy `*.pack` only, then `git index-pack <pack>`. That mistake cost one rebuilt clone;
the working checkout was unaffected (`git fsck --connectivity-only` clean there, 9,285 objects).

**5. What the drive does not give back.** The eight instruments (§file-loss) are absent from the Windows tree
(`ls "$W/demo" | grep -Ei "clock-skew|clock-step|verify-sweep|broker-serve|worktree-cleanup"` → nothing; that tree is
Oct-24-era and they are Oct-25..28 Linux artifacts), from NTFS `$Recycle.Bin` (bounded `find -maxdepth 2 -iname
'*test.mjs'` → nothing), from all **137,427** store entries (**0** mention any of the eight paths — delegate tool calls
are not in the rig's store at all), and from all **2,081** recovered commit objects (`git log --stdin --diff-filter=A
--name-only` over every commit object, reachable or not, matches only `tools/broker-serve.mjs`, `tools/channel-preflight.mjs`,
`demo/next-pointer.test.mjs`, `demo/clockin-digest.test.mjs` — the last two are this project's own tracked history, and the
first two appear only as adds in commits that are already in this checkout's lineage). No snapshot tooling is visible to a
normal user: `/.snapshots`, `/home/.snapshots`, `/.snapshot` absent; no `snapper`; `btrfs subvolume list /home` →
`Operation not permitted`.

**6. The rehearsal path exists and is safe.** `/home/chexxor/Git/Durian-Pi-ops` = `git clone` of the working checkout +
`cp selfdev.sqlite` + `node_modules` symlink + `.env.rehearsal` (`DURIG_DB`, `DURIG_CONFIG`, `DURIG_SEAT_ROOT`). From
there `node tools/broker-serve.mjs --dry-run` evaluates the whole preflight and refuses on exactly one block,
`seat-shell-availability` (ROADMAP 217), and **both** checkouts' `git worktree list` stayed at 1 row. Note the F12
seat-root guard: a global `DURIG_SEAT_ROOT` with a *local* store/config is refused by `src/config.mjs`, so a rehearsal
either copies the store to a global root or leaves `DURIG_SEAT_ROOT` unset (per-item worktrees) — the latter was used.

## Recovery applied to the working checkout (granted, 2026-10-28T22:0xZ), and the clock item's boundary

`cp <windows clone>/.git/objects/pack/*.pack .git/objects/pack/` then `git index-pack` on each: objects **9,301 → 22,351**,
`git fsck --connectivity-only` clean (dangling only), ledger unchanged at **1 registration**. **23 of the 30** recorded
unresolvable shas now resolve **here**; 6 resolve in neither clone. Commit objects **2,083** vs **1,628** reachable from
refs, so **455 commits are anchored by nothing** — perishable until someone mints refs for them (not done: a repo-shape
change beyond the grant). Re-check:
`git cat-file --batch-all-objects --batch-check | wc -l; git rev-list --all --count; git cat-file --batch-all-objects
--batch-check | awk '$2=="commit"' | wc -l`.

**Clock boundary (D157).** `timedatectl show` (bare; `show -p A,B,C` prints nothing — a comma list is not accepted) on
2026-10-28T22:02:43 local: `LocalRTC=yes`, `NTP=yes`, `NTPSynchronized=yes`, `RTCTimeUSec=Wed 2026-10-28 16:02:43 UTC` —
the RTC holds local time, **5 h** behind true UTC. `set-local-rtc 0` would change the **whole OS** (and Windows' display at
the next boot), so the operator withheld it; the project-scoped half is ROADMAP **234**, and the delegate-side detector is
`tools/channel-preflight.mjs` §8 (raises `NOTE host-clock-step-risk`). Measured while writing it: `documents.created_at`
is a **relative** stamp (`1 … 2,263,478`), not epoch-ms, and `entries` has no wall-clock column — the rig has no way to
observe a step from its own store, and `demo/broker-clock-step.test.mjs` (row 210's regression) is among the files lost
above.
