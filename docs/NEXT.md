# NEXT.md — current state and next actions

**Last update:** 2026-11-11T23:5xZ (delegate session **N32** — the **census close-out + the work-item model**:
`main` = **`6d36ab0f`**, suite **300/300** in **122.9 s** (`--all --jobs 4`, exit 0, unpiped), refs **84** and
worktrees **75** (count live — the fleet mints them; 77→81 refs in ten minutes this session), **1 ref pruned**
(`item-6809`, provably merged), **51 OPEN rows** appended to `docs/DISPOSITIONS.md`, and `docs/WORK-ITEM-MODEL.md`
written. A **parked** broker (pid **2876055**, heartbeat 9 s fresh, `lastPassAt` frozen **48,370 s**) was reaped with
`kill -TERM` and the fleet restarted (pid **1948745**, `PASS 1..6` in 60 s). Nothing was pushed; the delegate claimed,
completed or deferred no row. **Count refs/worktrees live** — the fleet mints them while you measure.)

**Milestone this window worked** — **a work-item lifecycle the team can run itself**: seats land their own verified
branch into `staging`, the operator promotes `staging` → `main` in one verb, branchless items never spawn a worktree
(`docs/WORK-ITEM-MODEL.md`, rows **#6924–#6927** minted by `pm`). The pin move (D255 → D256, ROADMAP 353–357) is the
frame it operates in. Prior window's milestone — **no 120 s silence, and Ctrl-C actually stops the verb**
(ROADMAP **314**, row **#6160**, decision **D262**) — baseline `e06626af` vs `main`, same 139,264 B store, same forged wedge:
`watch --once --json` went from **120,547 ms / exit 1** (signal ignored for 119 s) to **1,518 ms / exit 130, 15 ms
after the signal** — table in `docs/evidence/2026-11-10-cli-signals/ctrl-c-and-read-bounds.md`. Still open under it:
the pinned-pi thread (D255 → D256, ROADMAP 353–357: pin `v1.5.1`, `pi-schema` first, the symbol migration, the
`commitstream`/`livewatch` seams) with the three policy calls **#6171/#6172/#6173**, the item-5301 rework
(**#6174**), the superseded WIP disposition (**#6178**), and the auto-clean ceiling (D249, ROADMAP **311** / **344**).

**Host for every number below**, measured with the measurement: **Linux**, Fedora Linux 45 (Forty Five), kernel
`7.2.15-300.fc45.x86_64`, node **v24.22.1**, `git version 2.56.0` — probe:
`uname -s && uname -r && (. /etc/os-release && echo "$PRETTY_NAME") && node -v && git --version`.

## NEXT SESSION

**Current item:** the **work-item lifecycle MVP**. `pm` cut the intent into four rows: **#6924** impl — make
`demo/offline.mjs` green (the mocked plane is the prerequisite for everything else); **#6925** lead — does the
PROVISIONAL taxonomy block the `staging` verb, and who routes the research prompt; **#6926** architect — where the
seams are (mode decision, gate composition, the promote-to-main writer); **#6927** qa — inventory the 51 OPEN
disposition rows. The branch-cleanup pass's **git half is closed** (`main` green); what is left is fleet work — the
**item-5301 re-cut (#6174)**, the uncommitted `sync-pi --no-repair` work stranded in the `item-6057` worktree
(**#6060**), the dirty trees named below, and the three pin-policy rows (**#6171/#6172/#6173**).

**Milestone this window worked** — the **work-item lifecycle** (above), with the branch-census pass as its
residue-cleanup tranche.

**Blocker:** two, both operator-grant, neither a git one. (1) The **external research** on branch taxonomy is written
(`docs/reviews/branch-lifecycle-research-prompt.md`); the research agent is off-host with no repo access, so **routing
that prompt is an operator action**, and `docs/WORK-ITEM-MODEL.md` §4/§5 stay PROVISIONAL until it lands. (2) The
verifier leg: `DURIG_VERIFIER_API_KEY` spend is capped and `local2` is a shared LAN box whose 20 s preflight probe
false-blocks (measured 42.8 s cold / 27.2 s warm for a 64-token call).

**Run these first, in this order** (every number below was measured on this box; re-measure rather than trust it):

```bash
cd /home/chexxor/Git/Durian-Pi
node scripts/suite.mjs --jobs 8                                        # 299 tests on disk; one can redden on contention
node tools/stranded-inbox.mjs selfdev.sqlite                           # 1 s — is the broker PARKED? hbAgeS vs progressAgeS
DURIG_DB=./selfdev.sqlite node cli.mjs worktree audit --json           # 1.1 s — total 82: seat-root 10, non-item 4, live 2, reapable 60, dirty 5, locked 1
DURIG_DB=./selfdev.sqlite node cli.mjs queue --status claimed --json --no-body   # the payload is the filtered rows; `rows:` is the CENSUS
git branch --list | wc -l; git worktree list | wc -l; node scripts/sync-pi.mjs --check   # COUNT LIVE: 84 refs / 75 worktrees at 6d36ab0f
```

**Broker status:** resident pid **1948745** (`--no-probe --max-duration 3600 --yes-pm-wakes`, started 23:53:47Z).
**The bound is not a hard bound, and it is now measured, not hypothesised**: a broker whose wake loop broke at
`--max-duration` sets `stoppedBy = "max-duration"` (`src/broker.mjs:1855-1857`) with **no stop request**, so
`graceExpired()` is false and the drain takes the **unbounded** `await h.waitForIdle(context)` (`:2218`; the bounded
leg `:2216 settleWithin(...)` fires only on `deadline`). pid 2876055 sat in that state for **13 h 26 m** while its
heartbeat stayed fresh and the read pump kept answering — `node tools/stranded-inbox.mjs selfdev.sqlite` is the
one-line discriminator (`hbAgeS` / `progressAgeS` / `DRAIN-STRANDED`). Account: `docs/incidents/2026-11-11-parked-broker-strands-a-mutating-intent.md`.
The force timer (`cli.mjs:2247`) arms only in `onSignal`, so `serve --stop` is invisible to a parked broker — four this
window (pids 2066240, 2201485, 2390935, 2658110) lingered 34 min – 1 h 32 m past their bound until `kill -TERM <pid>` fired the fallback (`EXIT reason=deadline passes=-`). Preflight **blocks falsely** on local2: the 20 s probe at `tools/broker-serve.mjs:304` vs a measured **42.8 s cold / 27.2 s warm** 64-token completion — use `--no-probe` (0 blocking) and verify seats generate. Restart recipe: `set -a; . "$HOME/.config/durig/env"; set +a; DURIG_DB=./selfdev.sqlite node tools/broker-serve.mjs --start --no-probe --yes-pm-wakes --max-duration 3600`. Dead-letters in the spool are read and explained in `docs/evidence/2026-11-10-cli-signals/ctrl-c-and-read-bounds.md` §G.

**What the residue is now** (`cli.mjs worktree audit --json`, 1.1 s, re-measured at `6d36ab0f`): **82 entries** —
seat-root 10, non-item 4, locked 1, **live 2**, **reapable 60**, dirty 5. `git worktree list | wc -l` counts 75
(the audit counts the shared repo too). 60 reapable trees is the residue the lifecycle is meant to stop producing;
row **#6927** is the inventory of the 51 OPEN `docs/DISPOSITIONS.md` rows behind it. Reap recipe (idempotent, never
`--force`): `cli.mjs worktree audit --json > .spike/wt.json`, then remove every entry whose `keepReason` is
`reapable`, then `git worktree prune`.

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

**State at clock-out** (measured live, re-count before trusting): refs **84**, worktrees **75**, `main` `6d36ab0f`, queue
census **6,927 rows** — the fleet minted **#6924–#6927** from the delegate's lifecycle intent within two minutes of the
broker restart.

**Hazards the next session must not mistake for green** (all re-measured 00:4xZ against `main` `14ae744a`):
(1) **`item-5301` / `item-5301-resolved` are not landable by a delegate** — `cli.mjs` conflicts, and the branch's own
`demo/worktree-reap.test.mjs` is **red on the merged tree** (run in a scratch: `dry.candidates` is undefined —
`reapWorktrees` returns `reaped/counts/refusedSoleCarrier`, not `candidates`; exit 1). (2) **`item-6101`** conflicts in
`cli.mjs`, `src/rig.mjs` and `demo/test-areas.json`: its hold/release code collides with the now-landed #6112/#6150 —
semantic, needs the author's re-cut. (3) **`item-6330`** conflicts in `demo/runbook-diagnose.test.mjs` by *removing*
entries from the skip list main added — a union would undo landed work. (4) **`item-3570`** and **`item-6162`** conflict
in `docs/runbooks/stale-held-backlog.md`; `item-6162` also in `src/rig.mjs`. (5) `wip/seat-prompt-files` is dispositioned
SUPERSEDED (#6178). Full disposition: evidence doc §H.

## The pinned-pi thread — v1.5.1 LANDED (ROADMAP 353–357)

Pin tag `v1.5.1` = `dd30101cfc5b0609411dd80b6f93adbc14db14cf`; `pi-schema` **first** in the pin's `packages` (the chord
fails `TS2307` otherwise); 10 built packages all 1.5.1. `--check` reports `policyGap: null` and `drift: true / behind 14`
against upstream tip `b2aabe029…` — **a tag pin can never satisfy `drift: false`**, so the contract is mis-specified
(register the fix, do not chase it). The live store still reads `durable_schema = [{singleton:1,version:2}]`: the move
**migrated nothing**. The full landed detail — the symbol migration, the `livewatch`/`commitstream` seams and the
provisional `checkpointWhen` — is VERBATIM in [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md), section "The pinned-pi thread".

**Stop rule that still applies:** `--unlink` is NOT a rollback — the live store is schema v2 and released pi-durable
≤ 1.3.0 cannot open it. Procedure: `docs/runbooks/pi-pin-update.md`; pitfalls **227–236**.

## Exact next command

```bash
cd /home/chexxor/Git/Durian-Pi
node demo/cli-sigint-exits.test.mjs                   # the Ctrl-C proof: 130 within ~130 ms of the signal (4.97 s)
node demo/cooldown-skip-line.test.mjs                 # 0.193 s — the demo the read-drain timer broke; run it 10x, not once
node scripts/test.mjs --all --jobs 4                  # 299/299 in 115.0 s at `14ae744a`
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
5. **Promote the probes out of `.spike/`** (**#6176**): `.spike/pin-update/migrate-symbols.mjs`,
   `.spike/pin-update/signature-classify.mjs` (ROADMAP 312), plus the landing-pass probes `.spike/union-resolve.mjs`
   (union-merge where both sides are tail appends — how 6402 landed), `.spike/merge-broker-import.mjs`,
   `.spike/wedge-after.mjs` (forged frozen broker), `.spike/row-status.mjs` — an unpromoted probe is lost.
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

**Blocker (operator grants only):** verifier-leg spend cap + the `local2` shared-box preflight false-block (see the pointer's `**Blocker:**` line). Retry `--dry-run` rather than reconfiguring.

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
