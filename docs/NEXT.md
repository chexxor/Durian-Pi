# NEXT.md — current state and next actions

**Last update:** 2026-11-10T23:5xZ (delegate session **N27** — the **Ctrl-C + read-bound pass**: every CLI verb
now answers or fails fast, and Ctrl-C ends the verb with exit **130**. Commits `41000315`, `c32557cb`, `fd09f919`
and `f897ea8a` on `main`; suite **294/294** (`--jobs 4`, 126.7 s). Refs and worktrees: **count it live, do not trust
any number here** — the fleet mints refs while you measure (**43 refs / 35 worktrees** at 23:5xZ, up from 26/18 an
hour earlier). Nothing was pushed; the delegate claimed, completed or deferred no row.)

**Milestone this window worked** — **no 120 s silence, and Ctrl-C actually stops the verb (ROADMAP **314**,
row **#6160**, decision **D262**)**. Baseline `e06626af` vs `main`, same 139,264 B store, same forged wedge:
`watch --once --json` went from **120,547 ms / exit 1** (signal ignored for 119 s) to **1,518 ms / exit 130, 15 ms
after the signal** — table in `docs/evidence/2026-11-10-cli-signals/ctrl-c-and-read-bounds.md`. Still open under it:
the pinned-pi thread (D255 → D256, ROADMAP 353–357: pin `v1.5.1`, `pi-schema` first, the symbol migration, the
`commitstream`/`livewatch` seams) with the three policy calls **#6171/#6172/#6173**, the item-5301 rework
(**#6174**), the superseded WIP disposition (**#6178**), and the auto-clean ceiling (D249, ROADMAP **311** / **344**).

**Host for every number below**, measured with the measurement: **Linux**, Fedora Linux 45 (Forty Five), kernel
`7.2.15-300.fc45.x86_64`, node **v24.22.1**, `git version 2.56.0` — probe:
`uname -s && uname -r && (. /etc/os-release && echo "$PRETTY_NAME") && node -v && git --version`.

## NEXT SESSION

**Current item:** the **branch-cleanup pass** (`docs/runbooks/branch-cleanup.md`). Its git half is **closed**: refs
**82 → 26**, worktrees **75 → 18**, `main` green. What is left is fleet work, not git work — the **item-5301 re-cut
(#6174)**, the uncommitted `sync-pi --no-repair` work stranded in the `item-6057` worktree (**#6060**), the four
dirty trees named below, and the three pin-policy rows (**#6171/#6172/#6173**).

**Milestone this window worked** — **landing the accumulated branches and pruning them (the branch-cleanup pass)**,
with the pin move (D255 → D256, ROADMAP 353–357) as the frame it operated in.

**Run these first, in this order** (every number below was measured on this box; re-measure rather than trust it):

```bash
cd /home/chexxor/Git/Durian-Pi
node scripts/suite.mjs --jobs 8                                        # 294 demos; one can redden on contention
DURIG_DB=./selfdev.sqlite node cli.mjs worktree audit --json          # 1.1 s — seat-root 10, live 4, reapable 17, dirty 4
DURIG_DB=./selfdev.sqlite node cli.mjs queue --status claimed --json --no-body   # 4 claimed rows; `rows: 6423` is the CENSUS, the payload is the filtered items
git branch --list; git worktree list | wc -l                          # COUNT IT LIVE: 43 refs / 35 worktrees at 23:5xZ
node scripts/sync-pi.mjs --check                                     # pin dd30101cf tag v1.5.1, drift true
```

**Blocker:** the broker is **DOWN, not wedged** — it exited at `2026-11-10T18:48:19Z` (`EXIT pid=3566266
reason=max-duration passes=328`), there is no `selfdev.sqlite.broker.json` and no `genlock` slot, so every read now
takes `readLocal` and answers fast: `node cli.mjs status --json` → `ok:true` in **2.46 s**, `cli.mjs worktree audit`
in **1.15 s**. **Restarting it wakes 12 seats and spends model money — the operator's call.** If restarted:
`node tools/broker-serve.mjs --dry-run`, then `set -a; . "$HOME/.config/durig/env"; set +a; DURIG_DB=./selfdev.sqlite node tools/broker-serve.mjs --start --yes-pm-wakes --max-duration 1800`. The spool is now empty (0 pending);
61 dead-letters are read and explained in `docs/evidence/2026-11-10-cli-signals/ctrl-c-and-read-bounds.md` §G.

**What the cleanup left** (measured 23:5xZ, `cli.mjs worktree audit --json`, 1.1 s) — 35 worktrees, **0 locked**:
10 seat roots, **4 live** rows (`item-1158` claimed, `item-3087` claimed dirty 2, `item-5912` held, `item-6177`
claimed dirty 3), **17 reapable**, and **4 dirty orphans** whose items are `done`: `item-6057`
(2 tracked edits — a `sync-pi --no-repair` flag and its demo, **not on `main`**: `grep -c "no-repair" scripts/sync-pi.mjs`
→ 0, while `git merge-base --is-ancestor refs/heads/item-6057 refs/heads/main` exits 0, i.e. the branch is merged and
the work is not), `item-6290` (23 untracked solo-run logs, 45 KB), `item-6317` (3 logs), `item-6328` (1 log). Every
residue is exported to `.spike/worktree-residue/` (gitignored, 148 KB) before anything is touched. A dirty orphan is
refused on purpose: a seat commits it, or the operator rules it discarded.

**The recipe that made this fast (re-run it, it is idempotent):**

```bash
DURIG_DB=./selfdev.sqlite node cli.mjs worktree audit --json > .spike/wt.json
node -e 'const j=JSON.parse(require("fs").readFileSync(".spike/wt.json","utf8"));
 for(const w of j.worktrees) if(w.keepReason==="reapable") console.log(w.worktree)' | while read -r p; do git worktree remove "$p"; done   # 75 s for 57 trees, never --force
git worktree prune
```

**Goal in flight (implementation complete, record closed):** "every CLI verb answers or fails fast against a team
that is running or stopped, no 120 s silence, and Ctrl-C actually terminates the running command." All six legs are
on `main`: the signal seam (`src/signals.mjs`, `src/cli-seam.mjs`), bounded reads (`src/readclient.mjs`), the
read-only shim (`src/readonlystore.mjs`), the out-of-band read drain in `runWakeLoop`, and the demos that pin them.
Measured live at 23:3xZ with the broker resident and degraded: `status` 4.071 s, `queue --json --no-body` 2.525 s,
`watch --once --human` 2.452 s, `ps` 0.960 s, `log pm 5` 1.934 s, `status --local --json` 3.344 s — all exit 0; a
resident `watch --follow` interrupted at 3 s exits **130 in 52 ms**. **One regression was found and closed:** the new
1 s read-drain timer shifted the wake loop by a fraction of a millisecond and
`demo/cooldown-skip-line.test.mjs` went 4/12 red (bisected: 0/12 with `readDrainMs = 0`); it is now driven by an
injected virtual clock and runs 0/15 red in **0.193 s** — pitfall **255**, §F of
`docs/evidence/2026-11-10-cli-signals/ctrl-c-and-read-bounds.md`. Open edges stated there: the first ~270 ms of a
run is still node's default disposition; the force-exit timer cannot fire while a synchronous read blocks the loop
(~2.5 s measured); `tui.mjs` signal behaviour is unmapped; `gcIntentResults` is per-pass, not per read drain — the
architect's exit-drain row **#6391/#6390** (branch `item-6381`, merges clean).

**Operator decision owed, not a git one:** `.spike/` is **13 GB** of gitignored scratch — 4.2 GB `fix-20261101`,
1.1 GB `fix-20261031`, 1.1 GB `backups`, 814 MB `delegate`, plus four store backups (435 MB, 419 MB, 419 MB, and
`.spike/backups/20261110T0551Z/selfdev.sqlite`). Deleting a store backup is the operator's call; the fix-* scratch
dirs are prior landing passes and can be pruned once their content is confirmed on `main`. Also note **`docs/NEXT.md`
is at 199 of the 200 counted lines** (`demo/next-pointer.test.mjs` enforces the cap): before appending anything, move
a section verbatim to `docs/NEXT-ARCHIVE.md`.

**Open decisions the operator owns:** (a) **item-6063/6064/6066** — the compaction-gate trio was reverted. Either
re-cut it against the 1.5.1 pin and current `main`, or accept the guard and set
`DURIG_COMPACTION_RESERVE_TOKENS=8192`, `DURIG_COMPACTION_KEEP_RECENT=9288`, `DURIG_COMPACTION_BACKGROUND=8192` in
the gitignored `durig.config.json` (the config write is operator-owned — `docs/runbooks/compaction-policy-refused.md`)
and fix `demo/compaction-coherence.test.mjs:77`, which asserts the pin has no `modelOverrides` reader while
`vendor/pi-main/packages/durable/dist/harness/agent.js:145` reads it. (b) **`item-3570`** and **`item-5301`** need a
seat re-cut, not a delegate merge (evidence in `docs/DISPOSITIONS.md` §Pass 2026-11-10). (c) Landing #3570 makes
**D261** false — it says there is no post-mint gate write path; `revise_work` would create one.

**State at clock-out:** refs **43**, worktrees **35** (`git branch --format='%(refname:short)' | wc -l`,
`git worktree list | wc -l`) — the fleet minted 17 refs after the cleanup pass, so count it live. Queue census
6,423 rows — 4,365 done, 901 cancelled, 542 deferred, 435 held, 176 queued, 4 claimed. Store backup unchanged:
`.spike/backups/20261110T0551Z/selfdev.sqlite` (617,492,480 bytes, sha256 `0996cd61…`, `cmp` exit 0).

**Hazards the next session must not mistake for green:** (1) **`item-5301` and `item-5301-resolved` are not
landable** — re-measured 23:5xZ, `git merge-tree --write-tree main item-5301-resolved` exits non-zero with
`CONFLICT (content): Merge conflict in cli.mjs` (the signal seam moved `cli.mjs` after the branch was cut), and the
branch's own demo was red in the prior window (`git show item-5301-resolved:demo/worktree-reap.test.mjs` asserts
`dry.counts`/`dry.candidates`/`dry.refusedSoleCarrier` while `reapWorktrees` returns a bare array → TypeError, exit
1; not re-run here). (2) **`item-3570` is not landable as-is** — its demo needs the 1.5.1 `documentState`→`snapshot`
migration AND asserts a refusal message (`blockedBy.0: must be integer`) that is absent from the installed pi-durable
1.5.1 (grep exit 1). (3) **`item-6063/6064/6066` are ancestors of `main` with reverted content** — `git branch -d`
would succeed; do not prune them, they are input to the re-cut. Full per-ref merge disposition (43 refs, clean vs
conflicting, named files) is in `docs/evidence/2026-11-10-cli-signals/ctrl-c-and-read-bounds.md` §H.

## The pinned-pi thread — v1.5.1 LANDED (ROADMAP 353–357)

Pin: tag `v1.5.1` = `dd30101cfc5b0609411dd80b6f93adbc14db14cf`; `pi-schema` **first** in the pin's `packages`
(chord fails `TS2307` otherwise); 10 built packages all 1.5.1. `--check` reports `policyGap: null` and
`drift: true / behind 14` against upstream tip `b2aabe029…` — **a tag pin can never satisfy `drift: false`, so the
contract's `drift: false` is mis-specified** (register the fix; do not chase it). The live store still reads
`durable_schema = [{singleton:1,version:2}]`: the move **migrated nothing**.

Migration, in our source (no upstream patching): `Type` → `pi-schema` builders (closed by default — `src/rig.mjs`'s
`Type.Object({}, {additionalProperties: true})` sites need `{ open: true }`); `documentState` → `snapshot`, which
returns the **value**, not a wrapper; `watchEvents` → `src/livewatch.mjs` `watchLive()`; `subscribeCommits` →
`src/commitstream.mjs` `followCommits()` over `Session.observeCommits`; `Storage.commit(batches, receive, ctx)`;
and `checkpointWhen: () => false` on the 6 rig docs, **provisional** (ROADMAP 355, rows #6171–#6173). Both seams are
documented as approximations: turn boundaries come from the generation attempt, not a turn record; tool results are
synthesised from committed `pi.tool-result` entries, not streamed.

**Stop rule that still applies:** `--unlink` is NOT a rollback — the live store is schema v2 and released pi-durable
≤ 1.3.0 cannot open it. Procedure: `docs/runbooks/pi-pin-update.md`; pitfalls **227–236**.

## Exact next command

```bash
cd /home/chexxor/Git/Durian-Pi
node demo/cli-sigint-exits.test.mjs                   # the Ctrl-C proof: 130 within ~130 ms of the signal (4.97 s)
node demo/cooldown-skip-line.test.mjs                 # 0.193 s — the demo the read-drain timer broke; run it 10x, not once
node scripts/test.mjs --all --jobs 4                  # 294/294 in 126.7 s
node demo/next-pointer.test.mjs                       # the pointer cap: NEXT.md must stay <= 200 counted lines
node tools/broker-serve.mjs --status                  # broker state; the 61 dead-letters are explained in the evidence doc §G
DURIG_DB=./selfdev.sqlite node cli.mjs status         # must answer in under 10 s, or name the cause and remedy
```

## Current item (priority order)

1. **Close the three pin-policy rows** (ROADMAP 355): `checkpointWhen` per rig doc (**#6171**, architect),
   `persistWithinMs` 1,000 ms + `watchDoc()` or 0 + transaction load (**#6172**, lead), `restartLimit = 3` at the
   single `openHarness()` seam in `cli.mjs` pinned by a demo (**#6173**, impl).
2. **Re-cut `item-5301`** (**#6174**) — four defects, measured on the merged tree, listed in
   `docs/reviews/pi-1.5.1-delta-review-2026-11-10.md` §8 and pitfall **232**. Do not land until all four close.
3. **Close the install gap** (ROADMAP **352**, rows **#6125/#6127**): nothing at session start runs
   `tools/compaction-guard-install.mjs --check`, so a fresh clone or worktree starts unguarded with no signal.
4. **Resolve the four DIRTY worktrees — the merged refs are gone; this is the residue.** `cli.mjs worktree audit`
   reports `dirty 4`: `item-6057` (2 tracked edits — `scripts/sync-pi.mjs` + `demo/syncpi.test.mjs` adding a
   `--no-repair` flag, **#6060 work that is NOT on `main`** even though `item-6057`'s tip is an ancestor of `main`),
   `item-6290` (23 untracked solo-run logs), `item-6317` (3), `item-6328` (1). All residue is exported to
   `.spike/worktree-residue/` (gitignored, 148 KB). A dirty orphan is refused on purpose — a seat commits it or the
   operator rules it discarded (`docs/runbooks/leaked-worktrees.md` §Do 2). `verify-5180`, `item-5301`,
   `item-5301-resolved`, `item-3570`, `wip/seat-prompt-files` and the reverted `item-6063/6064/6066` stay by ruling
   (ROADMAP 344, `docs/DISPOSITIONS.md` rows) — none of them is held by a worktree any more, so the *only* thing
   keeping them is the ledger.
5. **Promote the pin probes out of `.spike/`** (**#6176**): `.spike/pin-update/migrate-symbols.mjs` and
   `.spike/pin-update/signature-classify.mjs` are the instruments that made this window fast; an unpromoted probe
   is lost (ROADMAP 312).
6. **Broker alive-but-dead** (**#6160**): heartbeat advances, pass clock freezes, every broker-routed read times
   out. The bound is now health-derived (120 s advancing / 10 s degraded, `src/readclient.mjs:40`, `:43`) and reads
   drain on the heartbeat cadence — the follow-up is the exit-path spool accounting, rows **#6391/#6390**.
7. **Ratify or revise M5's eight acceptance criteria** (operator) — `docs/MILESTONES.md` §M5, gate baseline
   **3 PASS, 1 PARTIAL, 4 FAIL** (`docs/evidence/2026-11-09-milestone-m5/gate.mjs`, 1.6 s).

## State the team is in

Fleet awake: 12 seats (11 on `local2/qwen3.8-flash-next-q2_0`, auditor on `verifier/openai/gpt-oss-120b`). Queue
census **6,423 rows** measured 2026-11-10T19:0xZ with no broker resident: 4,365 done, 901 cancelled, 542 deferred,
435 held, 176 queued, 4 claimed. pm minted **#6171–#6178** from the delegate intent (`requestId b0488417-b203-4df7-83dd-077406980a9f`,
`delivered: true`); other seats minted their own rows this window (#6163–#6170). **The delegate asserted no row.**
Six branches landed (`item-1779`, `item-2915`, `item-3041`, `item-6067`, `item-6082`, `item-6121` + the
`item-6082-mig` fork); two are deliberately not landed and are named with reasons above.

**Blocker (operator grants only):** the verifier leg is armed but `DURIG_VERIFIER_API_KEY` spend is capped, and
`local2` is a shared LAN box — `broker-serve --dry-run` BLOCKed once on `provider-local2-completion-failed: timeout
after 20s` while a direct curl answered in **1.6 s**. Retry the preflight rather than reconfiguring.

**Unverified:** (1) live TUI streaming is coarser at the new pin because it rides `pi.live`'s throttled partial
commits — plausible, not measured; the probe that would close it is a `latency-budget` run comparing entry cadence
before/after. (2) Whether any rig doc actually needs checkpoints (the `() => false` provisional) is undecided by
design. (3) `item-5301-resolved` exists as a fork with only the syntax fix; it was **not** landed, so its reap verb
is not on `main`.

**Cost:** spend ledger unchanged — **$0.00** this window (every call went to the loopback provider priced 0/0).
Wall clock: the full suite is **47.8 s** (was 61.8 s at the old pin); a merged-tree gate per branch is ~47 s;
`rig-portability-audit` 1,084 ms when the store is readable; the broker preflight ~4 s. **Speed-up worth adopting:** gate every candidate
branch with `node --check cli.mjs` + `git merge-tree --write-tree` before spending a 47 s suite (pitfall **232**),
and never run three full suites concurrently — contention produced two false reds this window (pitfall **235**).

**Traps this window** — `docs/SELFDEV.md` **249–254** (a SIGINT handler that only sets a flag is not a stop —
measure it; an interrupted verb exiting 0 reads as success; `stoppableSleep` must not `unref`; a read-only shim
must implement both vendor orders; the Ctrl-C bound is only as good as the event loop; a red at `--jobs 8` that is
green standalone is the box, not the code). Prior windows: **245–248**, **241–244**, **232–240**.

Full history of this pointer, verbatim: [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md)
