# Delegate session notes — cross-OS recovery, object surgery, and what cost wall-clock (2026-10-28, Linux)

Session: operator delegate, second half of the 2026-10-28 session on box `Alex-Desktop-Win10` (Fedora 44, `node v24.22.1`,
zone `America/Chicago`). Companion records: **D156**/**D157** (`docs/DECISIONS.md`), ROADMAP **217/232/233/234**
progress rows, `docs/incidents/2026-10-28-cross-os-ledger-pruned-and-untracked-loss.md` (now 159 lines, includes the
recovery recipe), `docs/incidents/evidence-2026-10-24-windows-ledger.txt` (84 lines, the pre-move ledger made durable).
Commits: `6b19f09`, `5968054`, `262c6a5e` — **not pushed**. This file exists so the next session does not re-pay the
investigation cost. It is a delegate note, not a runbook: the runbook half is already in ROADMAP **232**'s `Where:`.

## The one move that mattered: the pre-move volume is a *git* authority, not a backup folder

`/dev/nvme0n1p3` (Windows system volume) is mounted read-write at `/run/media/chexxor/0094126294125A8C`; the pre-move
checkout is `Users/Alex/dsh-Projects/pi-opendurig`. Three commands answered questions that had been treated as
unrecoverable, and all three are cheap:

```bash
# 1. refs: additive, and effectively free — the tips were already local objects, just unreachable
git -C <windows clone> fetch <windows clone> '+refs/heads/*:refs/rescued/*'      # 32 refs, 0.022 s
# 2. objects a fetch CANNOT bring (unreachable objects never cross the protocol): copy the packs only
cp <windows clone>/.git/objects/pack/*.pack .git/objects/pack/ && for p in .git/objects/pack/pack-*.pack; do git index-pack "$p"; done
git fsck --connectivity-only                                                     # 9,301 → 22,362 objects, clean
# 3. the object delta, in one scan, before deciding anything
git -C <a> cat-file --batch-all-objects --batch-check | awk '{print $1}' | sort > a.txt
git -C <b> cat-file --batch-all-objects --batch-check | awk '{print $1}' | sort > b.txt
comm -23 a.txt b.txt | wc -l                                                     # 13,057 objects this clone lacked
```

Measured effect: **2,083 commit objects vs 1,628 reachable from refs** (so 455 commits sit on nothing), and **23 of the 30**
queue-cited shas that resolved nowhere now resolve. The 6 that resolve in neither clone stay gone.

## Pitfalls, each one paid for this session

1. **Copy `*.pack` only.** Copying a pack's `.idx/.rev/.mtimes/multi-pack-index` (or letting `find -mindepth 2 -maxdepth 2
 -type f` sweep `objects/pack/` into a "loose objects" list) breaks every object read with
   `fatal: mmap failed: Permission denied`, and `git cat-file` then returns nothing — which looks like an empty store and
   invites worse surgery. Recovered by deleting the clone and re-cloning. The working checkout survived only because the
   surgery was rehearsed in a disposable clone first.
2. **A disposable clone is the right place for anything that touches `.git`.** `git clone` of this repo is 24 MB and takes
   seconds; a rehearsal clone (`/home/chexxor/Git/Durian-Pi-ops`, 469 MB with a `selfdev.sqlite` copy and a
   `node_modules` symlink) makes object surgery, `--dry-run` preflights and worktree-exercising commands cost nothing and
   risk nothing. That is D156's operating rule, and it is why `git worktree list` stayed at **1 registration** in both
   checkouts for the entire session.
3. **`node -e "…"` inside a double-quoted bash string fails on SQLite quoting** (two failed commands this session). Write a
   throwaway `.scratch/<name>.mjs` instead — it is cheaper in turns and re-runnable.
4. **`timedatectl show -p LocalRTC,NTP,…` prints nothing** — a comma list is not accepted (repeated `-p` works). Bare
   `timedatectl show` + local filtering is the form that returns data; that is what `tools/channel-preflight.mjs` §8 does.
5. **`documents.created_at` is a relative stamp** (`1 … 2,263,478`; epoch-ms in 2026 would be ~1.79e12) and `entries` has no
   wall-clock column at all. Any clock/age check built on those columns silently measures nothing — this is why the rig
   cannot detect a clock step, routed as ROADMAP **234**.
6. **A `git fetch` of refs is not an object recovery.** If a cited sha is unreachable in the source repo, the protocol never
   sends it. Diagnosed with `git -C <src> cat-file -t <sha>` (works) plus `git -C <src> branch -a --contains <sha>` (empty).
7. **`docs/NEXT.md` has two executable readers.** Compressing the `**Blocker:**` paragraph cost a failure:
   `clockin-digest.test.mjs` asserts *"the pointer still links its own archive"*, so the `docs/NEXT-ARCHIVE.md` link must
   survive inside the `## NEXT SESSION` body even when every other word is trimmed. Count lines before editing (the cap is
   199 written lines), and rewrite whole paragraphs at a fixed line count rather than re-wrapping.
8. **Run `node --check` after every edit to a tool that builds template strings.** Two syntax errors this session — one
   from an edit that dropped a closing paren on a `.prepare(\`…\`)` call — were each cheaper to prevent than to trace from a
   stack trace at runtime.
9. **Untracked files are not protected by anything.** After the sweep, `git status --porcelain --untracked-files=all -- demo
 tools src scripts` reported **0** untracked files and every survivor was tracked; conversely **0** Oct-24-era files are
   missing here. That is the cheapest possible blast-radius measurement for a suspected sweep, and it belongs in every
   future incident of this class: `tools/instrument-provenance.mjs` now prints it in 46 ms.

## What cost the wall-clock, and the fix for next time

- **Re-measuring the same store facts one query at a time.** One `node tools/channel-preflight.mjs` (3.33 s) already answers
  broker liveness, queue head, unsettled submissions, seat-root hygiene, provider era, seat capability and clock posture;
  `tools/queue-drain-audit.mjs` (0.93 s) answers the held backlog. Ad-hoc SQL cost more than both combined.
- **Object archaeology without a plan.** The `comm`-over-`--batch-all-objects` pair above is the rawest material and should
  be the *first* probe on any "is it recoverable" question, not the last.
- **Suggested next instrument (delegate-owned, ~30 min):** `tools/cross-clone-audit.mjs` — read-only, takes a second clone
  path and a sha list and prints: object delta, ref delta, which shas resolve where, how many unreachable commits each side
  holds, and the exact `*.pack` copy + `index-pack` command to close the gap. This session improvised all of that across
  ~15 turns; pinned as an instrument it is one 3-second command.
- **Cheapest product-side speedups still open, in the order they pay:** ROADMAP **212** (the worktree-inventory tripwire —
  it turns a sweep from an investigation into a diff), **233** (suite members from `git ls-files` + a pinned member count in
  the digest), **232** (scoped prune with a printed `pruned: N`), **217** (the seat shell — without it every completion is
  self-declared, so all verification cost is currently hidden rather than saved).

## Open threads handed to the next session (none of these are the delegate's to decide)

1. **Anchoring the 455 unreachable commits.** Nothing refs them; a `git gc --prune=now` on either side destroys them for
   good. Needs a grant: `for s in $(cat .scratch/unanchored.txt); do git update-ref "refs/rescued/orphan-$s" "$s"; done`.
2. **217 is the first release** (`tools/broker-serve.mjs --dry-run` refuses on `seat-shell-availability`, in the rehearsal
   clone too), then **232**, then **212/214**, then **233**, then #725/#726/#727 once ROADMAP **231** gives an evaluable
   definition of "the queue drains". The routing fact is spooled to `pm` as `delegate-routing-fact-20261028-2150`
   (`1 pending intent(s)`; lands on the first broker pass) — it is still inert because the broker is down.
3. **The clock fix is host-wide and stays un-delegated** (D157). The project-scoped half is ROADMAP **234**. `LocalRTC=yes`
   with `RTCTimeUSec=Wed 2026-10-28 16:02:43 UTC` against true UTC `20:02:43Z` remains the reading.
4. **Unverified on purpose:** the file-loss mechanism behind the sweep is still a named candidate, not a finding
   (`.scratch/` surviving is unexplained by `git clean -fd`); 233 must not be closed by a restoration that leaves it
   unexplained.
