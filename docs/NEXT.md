# NEXT — current priority and exact next command

**Last updated:** 2026-10-28T20:1xZ, delegate session (seat capability + a sweep that destroyed evidence). Linux box
`Alex-Desktop-Win10` (Fedora `7.2.11-200.fc44.x86_64`), `node v24.22.1`, box zone `America/Chicago` (CDT = UTC−5; every
timestamp here is **Z**, and note the host's own clock is suspect — see §INCIDENT). Read me first — do not re-derive the
priority from the ~4,300-line roadmap. History: **`docs/NEXT-ARCHIVE.md`**. This file is a **pointer, capped at 200
lines** by `demo/next-pointer.test.mjs`, which also requires the `## NEXT SESSION` block below to carry a current item,
a queue id, a `node cli.mjs` command and a `**Blocker:**` line — **rewrite it in place, do not restyle it.** Its two
executable readers are `demo/next-pointer.test.mjs` and `demo/clockin-digest.test.mjs` (the digest reads only this
section, so **the `NEXT-ARCHIVE.md` link must stay inside the pointer body**). After editing this file:
`node demo/next-pointer.test.mjs && node demo/clockin-digest.test.mjs`.

## NEXT SESSION

**Current item:** **get claimable work to the head of the queue, then keep the delivery channel resident** — but the
second half is now **blocked on this host by measurement, not by grant**: a seat woken here has **no shell that can
start** (ROADMAP **217**), and the product's own worktree sweep **prunes the `git worktree` ledger**, which on this
moved workspace erases the cross-OS evidence the runbooks call protected (new ROADMAP **232**,
`docs/incidents/2026-10-28-cross-os-ledger-pruned-and-untracked-loss.md`). The channel is still the largest measured
wall-clock lever: `queued=0` and `claimed=0` of 4,821 rows, all **296 non-terminal rows parked** (277 `held`, 19
`deferred`), and the last `done` transition anywhere is **2026-10-22T17:29:11.923Z — 6.1 days stale**. A broker started
now wakes 9 seats onto *parked rows only* (`selectWakes`/`hasParked`, `src/driver.mjs:108`), and every one of them would
fail its first shell call (`spawn powershell ENOENT`, already firing inside the last broker pass).
**Queue ids:** **#725** (impl, ROADMAP 63 — `src/host.mjs` portable host supervisor), **#726** (devtools, ROADMAP 64 —
`durig daemon` CLI + trigger adapters), **#727** (qa, ROADMAP 67 — host chaos suite): all three `held`, all three in the
drain audit's **orphan-candidate** list (#662/#710 both `done`) while an **operator prose clause — "and the queue drains"
— has no definition anywhere in the tree** (ROADMAP **231**). New rows this session: **232** (the sweep prunes the
ledger ahead of any plan), **233** (instruments credited as landed were never committed and are now gone); **217** and
**226** gained landed delegate halves.
**Next command (delegate, read-only — run in this order, ~4 s total):**

```bash
node tools/channel-preflight.mjs --db ./selfdev.sqlite --rig ./rig.selfdev.json   # 3.3 s: four links + §7 seat capability (217) + provider-era attribution (226)
node tools/broker-serve.mjs --dry-run    # 2.9 s and it now REFUSES: `seat-shell-availability` + `live-tree-dirty`
DURIG_DB=./selfdev.sqlite DURIG_CONFIG=./rig.selfdev.json node cli.mjs queue --json \
  | jq -r '.items[] | select(.status=="queued" or .status=="claimed") | [.id,.status,(.to//"-")] | @tsv' | wc -l   # the head of the queue: 0 today
```

**Blocker:** five **operator** items, all in §OPERATOR OWES: (1) the ROADMAP 221 seat-root ruling, (2) permission to
start the broker **on Linux** — which this session now recommends **withholding** until 212/214/217/232 land, (3) the
definition of **"the queue drains"**, (4) a grant on what may prune/remove registrations in this checkout's ledger, and
(5) the **commit-or-discard decision** on the untracked instruments (ROADMAP 233 — five files this session ran are gone
and `git status` cannot show it). **History:** `docs/NEXT-ARCHIVE.md` — older sessions live there verbatim; this file
stays a pointer.

### Read-only baseline — run this before anything else (all verified working, Linux, 2026-10-28T20:1xZ)

```bash
cd /home/chexxor/Git/Durian-Pi
git worktree list --porcelain | tee .spike/worktree-inventory-$(date +%Y-%m-%d)-after.txt   # 1 entry (main) — it was 36 at the start of the last session; see §INCIDENT
node tools/channel-preflight.mjs --db ./selfdev.sqlite --rig ./rig.selfdev.json      # 3.3 s — §1–§7, incl. seat capability (217) and provider-era attribution (226)
node tools/broker-serve.mjs --status      # 2.8 s; now also raises `seat-shell-availability` (217)
node tools/queue-drain-audit.mjs --db ./selfdev.sqlite   # 0.93 s: 91 non-terminal LANDING rows, 71 fully on main, ids printed
node tools/latency-budget.mjs --db ./selfdev.sqlite      # 3.0 s: the two wall-clock currencies
node scripts/clockin.mjs                                 # 2.6 s
node tools/worktree-cleanup.mjs --dry-run                # FAILS: MODULE_NOT_FOUND — the instrument is gone and was never committed (ROADMAP 233)
```

## Rig state, re-measured 2026-10-28T20:1xZ (Linux) — re-read, do not trust

**Store** `./selfdev.sqlite` (438,329,344 B): `entries` **137,427 rows, max id 274,114**, 12 seats. **Queue census**
`node cli.mjs queue --json | jq -r '.items[].status' | sort | uniq -c` → **4,821 = 3,748 done / 777 cancelled / 277 held
/ 19 deferred**, i.e. **0 claimable**. Per-seat parked (held/deferred, oldest-parked): impl 164/13 280.8 h · scribe
44/0 290.0 h · devtools 33/2 290.3 h · qa 21/0 290.2 h · security 6/0 260.1 h · lead 4/1 252.0 h · pm 3/2 225.6 h ·
auditor 2/0 239.2 h · qa2 0/1 145.7 h · advocate/designer/architect 0/0 `no-work`.
**Providers (era-attributed, ROADMAP 226/229):** over the last 30 submission rows the attempts split
`local/iq3_s=14, deepinfra/…=8, unattributed=8` and **every failure in the window belongs to the `deepinfra` era — the
current `local/iq3_s` era has none.** Do not chase the `402`s in the recent rows; they are history (the 14,377 `402`
generations predate the 2026-10-27T04:55Z move to local).
**Seat capability (ROADMAP 217):** seat tools are `read write edit powershell prepare_workspace seat_root`; `pwsh` and
`powershell` are **both absent on this host** (`bash` is at `/usr/bin/bash` and is not registered); the store shows
`"toolName":"bash" -> 0`, `"toolName":"powershell" -> 20,340`, `spawn powershell ENOENT -> 3`, `spawn pwsh ENOENT -> 1`,
newest `entry #274074 2026-10-28T17:09:07.533Z conv 4930 = devtools isError=true`.
**Unsettled submissions:** 9 `placed` + 2 `queued` → `advancingConvIds()` counts **9 of 12 seats as ADVANCING**; after
pass 1's `reconcileStrandedSubmissions` all nine read **WAKE**. The 2 `queued` rows sit at the head of **pm's**
conversation and can never be aged out (never placed → no admitted entry to join).
**Worktrees:** **1 (this checkout, `main`)** — and `.git/worktrees` is **empty**; at the start of the previous session
the same command listed **36**, including 20 `C:\Users\Alex\…` paths. **No seat worktrees** exist here, and `/home/chexxor/Git/Durian-Pi-worktrees/`
is absent; local branches 2 (`main`, `wip/seat-prompt-files`). **Pi seat-agent state is host-local and absent here**, so a
seat worktree here is **created, not migrated** — the first `up`/`worktree`/`run`/`send` is the writing verb
`docs/runbooks/workspace-move.md` gates. `D:\` survives only as the source clone's remote path (`/mnt/d/Git/Durian-Pi`) —
never write there.

## INCIDENT (read before any `up`/`worktree`/`run`, and before trusting a "suite is green" claim)

`docs/incidents/2026-10-28-cross-os-ledger-pruned-and-untracked-loss.md`. Measured in one delegate session that ran **no
writing verb on the workspace**: the ledger went **36 → 1**; and `tools/worktree-cleanup.mjs`, `src/worktree-cleanup.mjs`
plus six `demo/` members — `worktree-cleanup`, `broker-serve`, `clock-skew`, `broker-clock-step`, `verify-sweep-cleanup`,
`verify-sweep-adversarial` (all `.test.mjs`) — were read or run earlier in that session and are now **absent from disk and from `git ls-files`** (never committed →
`git status` shows no deletion, nothing to restore). Mechanism for the ledger half is named in the product
(`src/broker.mjs:1167` → `pruneWorktrees`, `src/worktree.mjs:649`); the file-loss half is **unexplained**, and the same
end state is recorded twice before (`docs/incidents/2026-10-26-worktree-and-scratch-sweep.md:20-30`). The host clock is
also suspect: `timedatectl show` → **`LocalRTC=yes`** on a dual-boot box, and a file written this session carries
`2026-10-28T20:50:30Z` while a later `date -Is` printed `2026-10-28T15:07:48-05:00`.

## OPERATOR OWES (five items; the team is blocked behind them)

1. **ROADMAP 221 — the seat-root ruling** (D152 §6 + D153 addendum). Seats' persisted agent cwd resolves to a
   `D:\Git\Durian-Pi-worktrees\<seat>`-shaped value on the Windows host, and `up` reports `source: persisted seat cwd`
   even after `up --root …`. There is **no `seatRoot` field in `rig.selfdev.json`** (seats carry no `cwd`) and none in
   `status`, so the residue lives in Pi agent state **no CLI prints**. Proposed ruling **A**: *the persisted per-seat root
   becomes the workspace-root-relative name; `up --root` once per seat is sufficient; no migration code.* Not inert on
   Linux: `classifyGitRoot("D:\Git\Durian-Pi-worktrees\engineer")` **on Linux** prints **`main-worktree`** — a stale
   Windows root mis-classifies as the LIVE tree (the F21 failure `src/seatroot.mjs` exists to prevent).
2. **Permission to start the channel on Linux** (the delegate will not take it):

```bash
cd /home/chexxor/Git/Durian-Pi && export DURIG_DB=./selfdev.sqlite DURIG_CONFIG=./rig.selfdev.json \
  DURIG_SEAT_ROOT=/home/chexxor/Git/Durian-Pi-worktrees
node tools/channel-preflight.mjs --db ./selfdev.sqlite   # 2.0 s — read §1/§3/§6 first: DURIG_SEAT_ROOT is a BLOCK until exported
node tools/broker-serve.mjs --status                     # confirm down / 0 spool / providers completing
git worktree list --porcelain > .spike/worktree-inventory-after.txt   # diff against the 2026-10-28 baseline
```

3. **The definition of "the queue drains"** in the operator clause inside `#725`/`#726`/`#727` bodies
   (`SEQUENCING CONSTRAINT (operator): do NOT start the daemon-host work before #662/#710 are done and the queue drains;
   not ahead of TUI`). #662/#710 cleared 2026-10-17; the clause has no threshold, predicate or surface, so the three
   top-ranked rows have been `held` for 12 days. **`pm` cannot clear it and neither can the delegate** — it is your
   sentence, and 231 is the product half.
4. **A grant on ledger surgery** (ROADMAP **232**). Today `pruneWorktrees` runs unconditionally from the broker sweep
   and after every removal, and on a moved workspace that deletes the registrations this rig's own runbooks call
   evidence. Until it is scoped, the safe operator stance on this host is: **no `up`, no `worktree`, no channel start**
   from the main checkout, and re-inventory (`git worktree list --porcelain > .spike/…`) before and after any writing
   verb.
5. **Commit-or-discard for untracked instruments** (ROADMAP **233**, the cost of **214**). Eight files this session read
   or ran are gone and unrecordable; several ROADMAP rows credit them as landed. Either the team re-creates them (labelled
   as re-created, not restored) or the rows that cite them get amended — that is a scope call for you, not for a seat.

## Then, in this order (measured ranking — `docs/reviews/wallclock-budget-2026-10-28.md` §6, ruling D153, amended by D154)

1. **#725 / #726 / #727 (channel resident) + the head of the queue** — **but land #217 + #232 + #233 first on this
   host** (all three measured this session): a seat here has **no spawnable shell** (217; the delegate half is landed —
   `--dry-run` now refuses on `seat-shell-availability`), the broker sweep **prunes the cross-OS ledger** (232;
   `src/broker.mjs:1167` → `pruneWorktrees`, measured **36 → 1** registrations inside one session), and eight
   instruments are **gone and unrecordable** (233). Only the ledger grant and the commit decision need you; the rest is
   cheaper to land than the channel it unblocks. History prices the channel: `run`-invoked days
   2026-10-13→15 waited **101.8–114.3 min** per claim and landed 47–132 items/day; resident-broker days 10-17→21 waited
   **2.6–5.4 min** and landed **314–741**/day. But 296 of 296 non-terminal rows are parked, so the release comes first:
   `tools/queue-drain-audit.mjs` says **71 of 91 non-terminal LANDING rows are already fully on main** (26% of held,
   zero-build closable) and names **69 orphan candidates** + **12 `manual` gate-prose rows** — the ids are printed now.
   Delegate brief prepared, **not spooled**: `.spike/delegate/pm-release-brief-2026-10-28.md`; spool with
   `node intent.mjs pm --body-file .spike/delegate/pm-release-brief-2026-10-28.md --request-id release-brief-2026-10-28`
   (safe while the broker is down — it only queues; **it is gated on (1) and (2) above**, because the first released row
   creates this host's first seat worktree).
2. **ROADMAP 225 — decompose a running generation's wall-clock.** **0.23% of generations ≥10 min hold 156.8 h (39.0%)**
   of machine busy time on 1–3 committed events. Related today from the other side: **9 `pi.generation` rows are persisted
   `running` while no process can own them**, and `isAdvancingTask` reads pi-durable's derived `state.kind`, which is not
   persisted — so "is anything running?" is not answerable from the store.
3. **ROADMAP 226 — stop waking seats onto a dead provider.** 14,630 generations (24.4%) ended in an error, 59.2 h;
   **14,377** are one unfunded account's `402`. Measured at small scale: **6 of the last 30 submissions settled
   `unanswered`** (5× `402 "You need positive balance"`, 1× `Provider is not configured: deepinfra`).
4. **ROADMAP 227 — held-backlog drainability as a product finding.** 277 `held` idle a median **213.5 h**; the release
   rule only reports. Releasing stays **`pm`'s** verb.
5. **The rest are measured in the rows themselves, not here:** **228** (big reads, `queue` has no filters —
   `status` 22.7 MB, `queue --json` 21.2 MB, `cmdQueue` `cli.mjs:1018-1021` takes no arguments), **229** (admission age
   never persisted), **230** (the product half of the channel-start surface), **231** (make hold reasons evaluable),
   **208** (94.0% cache hit; 23,053 prompts > 150,000 tokens, max 1,009,360 against a declared 200,000 window).

## Do not "fix" these on the strength of the docs

**An orphan-candidate verdict is not a release recommendation** — #725/#726/#727 have every cited gate `done` and are
*correctly* held by an operator clause; read the body (`stale-held-backlog.md` §Do). **A swept worktree ledger is not
"self-healing"** — on a moved workspace `git worktree prune` deletes evidence, and it runs unconditionally
(`src/broker.mjs:1167`); if `git worktree list` shrinks across your session, stop and write it down. **A suite that runs
"green" after files vanished is not green** — `scripts/suite.mjs:36` enumerates with `readdirSync(demoDir)`, so a deleted
member is a silent shrink, not a failure (233). **A `402` in a recent submission row is not current provider state** —
attribute it by joining to the first assistant entry after the admitted one (§Rig state, ROADMAP 226/229). **A `WAKE` in the preflight's
"after pass-1 reconcile" column is a prediction about reconcile**, not a delivered wake. **`queued` is not `claimable`**
in the queue sense: the queue's claimable state is `queued` *items*, and submission rows are a different table — mixing
them is how this session nearly mis-wrote 229. **`admissionVerdict` being inert means aged `queued` rows are never
withdrawn** — do not "recover" them by hand with a second writing Harness. `DURIG_MAX_CONCURRENT_SEATS` is unset in
`durig.config.json`, `"1"` in `durig.config.default.json`, and the observed profile is **not** single-flight (max 11 in
flight) — read `src/config.mjs loadConfig` first (D153 §4). The 5-minute degeneration bound is a *turn* guard on a
different quantity, and the 5-minute **admission** deadline is a different 5 minutes again. A `--dry-run` names no
removals (resets model+cwd only) — not a safety check. Model speed is **12.7%** of machine time. `tools/` is untested by
design except where a demo is named.

## CLOCK-OUT (2026-10-28T20:2xZ, delegate — seat capability, provider-era attribution, and a sweep caught in the act)

**Done, committed not pushed (scoped paths).** `tools/channel-preflight.mjs` §7 *seat capability* (imports
`src/seattools.mjs` instead of re-deriving the tool set; reads the pinned fallback programs from
`vendor/pi-main/packages/durable/src/tools/bash.ts`; probes PATH; counts the store's shell evidence) and §5
*provider-era attribution* (join to the **first assistant entry after the admitted one** — the admitted entry carries no
`model[0]`, which is 229); `tools/broker-serve.mjs` raises **`seat-shell-availability` as a `block`**, so `--dry-run` and
`--status` refuse rather than start seats with no shell (217's acceptance half); rows **232/233** + progress on
**217/226**; `docs/incidents/2026-10-28-cross-os-ledger-pruned-and-untracked-loss.md`.
**Re-measured cost on this box:** preflight **2.0 → 3.3 s** — the store evidence is ONE `entries` scan holding all six
`LIKE` patterns (~0.9 s; six separate scans cost ~1.9 s); `--dry-run` 2.93 s, `--status` 2.75 s.
**Nearly-shipped error, corrected in public:** the recent `402` rows are **`deepinfra` history** — attributed, the live
`local/iq3_s` era has **zero** failures. And the wake is the wrong celebration: a seat here cannot run
`node demo/<name>.test.mjs`, so its completions are self-declared; `spawn powershell ENOENT` fired **inside the last
broker pass** (entry #274074).
**Unverified deliberately:** no channel start, no `up`/`worktree`/`run`/`send`, no queue transition, no intent spooled,
no push. The sweep's file-loss half has **no mechanism** yet, and `demo/broker-serve.test.mjs` — which 217's acceptance
asks you to extend — is among the lost files, so the suite's member list cannot be reproduced from git (233).
**Pitfalls, so the next session does not pay twice:** (1) `sum(record like '%…%')` over `entries` is ~0.2 s per pattern —
build ONE query with aliased aggregates; (2) a submission's `entry` is the admitted **input** entry, and a PATH probe must
be `sh -c 'command -v "$1"' _ prog` (`sh -c 'command -v' prog` probes nothing); (3) an untracked instrument is an
**uncreditable** one (`git ls-files` membership is part of "landed"; `scripts/suite.mjs:36` never reports a shrink).
