# NEXT — current priority and exact next command

**Last updated:** 2026-10-28T19:35Z, delegate session (channel-start pre-flight). Linux box `Alex-Desktop-Win10` (Fedora
`7.2.11-200.fc44.x86_64`), `node v24.22.1`, box zone `America/Chicago` (CDT = UTC−5; every timestamp here is **Z**).
Read me first — do not re-derive the priority from the ~4,200-line roadmap. History: **`docs/NEXT-ARCHIVE.md`**. This
file is a **pointer, capped at 200 lines** by `demo/next-pointer.test.mjs`, which also requires the `## NEXT SESSION`
block below to carry a current item, a queue id, a `node cli.mjs` command and a `**Blocker:**` line — **rewrite it in
place, do not restyle it.** Its two executable readers are `demo/next-pointer.test.mjs` and
`demo/clockin-digest.test.mjs` (the digest reads only this section, so **the `NEXT-ARCHIVE.md` link must stay inside the
pointer body**). After editing this file: `node demo/next-pointer.test.mjs && node demo/clockin-digest.test.mjs`.

## NEXT SESSION

**Current item:** **get claimable work to the head of the queue, then keep the delivery channel resident.** The channel
is still the largest measured wall-clock lever, but this session measured that **it is not the only thing gating it**:
`queued=0` and `claimed=0` of 4,821 rows, all **296 non-terminal rows parked** (277 `held`, 19 `deferred`), and the last
`done` transition anywhere is **2026-10-22T17:29:11.923Z — 6.1 days stale**. A broker started now wakes 9 seats onto
*parked rows only* (`selectWakes`/`hasParked`, `src/driver.mjs:108`) and lands nothing.
**Queue ids:** **#725** (impl, ROADMAP 63 — `src/host.mjs` portable host supervisor), **#726** (devtools, ROADMAP 64 —
`durig daemon` CLI + trigger adapters), **#727** (qa, ROADMAP 67 — host chaos suite): all three `held`, and all three
sit in the drain audit's **orphan-candidate** list (#662/#710 both `done`) while an **operator prose clause — "and the
queue drains" — has no definition anywhere in the tree** (ROADMAP **231**). New rows this session: **229** (the
submission age that the SKIP trace and the admission deadline both read but nothing writes), **230** (no surface answers
"what happens if I start the channel"), **231** (the above).
**Next command (delegate, read-only — run in this order, ~3 s total):**

```bash
node tools/channel-preflight.mjs --db ./selfdev.sqlite --rig ./rig.selfdev.json   # 2.0 s: the four links, incl. the product's own wake verdicts
DURIG_DB=./selfdev.sqlite DURIG_CONFIG=./rig.selfdev.json node cli.mjs queue --json \
  | jq -r '.items[] | select(.status=="queued" or .status=="claimed") | [.id,.status,(.to//"-")] | @tsv' | wc -l   # the head of the queue: 0 today
```

**Blocker:** three **operator** one-liners, all quoted in §OPERATOR OWES: (1) the ROADMAP 221 seat-root ruling, (2)
permission to start the broker **on Linux** (a writing verb — it creates worktrees and Pi agent state here for the first
time), (3) the definition of **"the queue drains"**, without which `pm` cannot release #725/#726/#727 and the top lever
stays unpulled whatever the broker does. **History:** `docs/NEXT-ARCHIVE.md` — older sessions live there verbatim; this
file stays a pointer.

### Read-only baseline — run this before anything else (all verified working, Linux, 2026-10-28T19:2xZ)

```bash
cd /home/chexxor/Git/Durian-Pi
git worktree list --porcelain | tee .spike/worktree-inventory-$(date +%Y-%m-%d).txt   # 1 entry (main); 0 seat worktrees
node tools/channel-preflight.mjs --db ./selfdev.sqlite --rig ./rig.selfdev.json      # 2.0 s — NEW: channel + queue head + unsettled submissions
node tools/broker-serve.mjs --status      # down pid=1771484, 0 spool, 10/10 providers complete (2.8 s)
node tools/queue-drain-audit.mjs --db ./selfdev.sqlite   # 0.93 s: 91 non-terminal LANDING rows, 71 fully on main, ids printed
node tools/latency-budget.mjs --db ./selfdev.sqlite      # 3.0 s: the two wall-clock currencies
node scripts/clockin.mjs                                 # 2.6 s
```

## Rig state, measured 2026-10-28T19:2xZ (Linux) — re-read, do not trust

**Store** `./selfdev.sqlite` (438,329,344 B): 274,068 records, 30,944 submissions, 12 seats. **Queue census**
`node cli.mjs queue --json | jq -r '.items[].status' | sort | uniq -c` → **4,821 = 3,748 done / 777 cancelled / 277 held
/ 19 deferred**, i.e. **0 claimable**. Per-seat parked (held/deferred, oldest-parked): impl 164/13 280.8 h · scribe
44/0 290.0 h · devtools 33/2 290.3 h · qa 21/0 290.2 h · security 6/0 260.1 h · lead 4/1 252.0 h · pm 3/2 225.6 h ·
auditor 2/0 239.2 h · qa2 0/1 145.7 h · advocate/designer/architect 0/0 `no-work`.
**Unsettled submissions:** 9 `placed` + 2 `queued` (all 2.3 h) → `advancingConvIds()` counts **9 of 12 seats as
ADVANCING** right now; after pass 1's `reconcileStrandedSubmissions` all nine read **WAKE**. The 2 `queued` rows sit at
the head of **pm's** conversation and can never be aged out (never placed → no admitted entry to join).
**Worktrees:** 1 (this checkout, `main`); **no seat worktrees**; `/home/chexxor/Git/Durian-Pi-worktrees/` absent; local
branches 2 (`main`, `wip/seat-prompt-files`). **Pi seat-agent state is host-local and absent here**, so a seat worktree
here is **created, not migrated** — the first `up`/`worktree`/`run`/`send` is the writing verb
`docs/runbooks/workspace-move.md` gates. `D:\` survives only as the source clone's remote path (`/mnt/d/Git/Durian-Pi`) —
never write there. A `cli.mjs watch` viewer from an earlier session is still running (pid 154207, ~40 h) — a viewer never
wakes a seat (D11); reported, not killed, because it is not this session's.

## OPERATOR OWES (three one-liners; the team is blocked behind them)

1. **ROADMAP 221 — the seat-root ruling** (D152 §6 + D153 addendum). On the **Windows host** the seats' persisted agent
   cwd resolves to a `D:\Git\Durian-Pi-worktrees\<seat>`-shaped value and `up` reports `source: persisted seat cwd` even
   after `up --root /home/...`. There is **no `seatRoot` field in `rig.selfdev.json`** (verified: top-level keys are
   `_readme, constitution, edges, ownership, seats`; seats carry no `cwd`) and none in `status` output, so the residue
   lives in Pi agent state that **no CLI prints**. Proposed ruling **A**: *the persisted per-seat root becomes the
   workspace-root-relative name; `up --root` once per seat is sufficient; no migration code.* Why it is not inert on
   Linux: measured `classifyGitRoot("D:\Git\Durian-Pi-worktrees\engineer")` **on Linux** prints **`main-worktree`** — a
   stale Windows root mis-classifies as the LIVE tree (the F21 failure `src/seatroot.mjs` exists to prevent). This
   session also found the shape live in the store's own state: the last streamed `pm` buffer quotes a seat root of
   `/home/chexxor/Git/Durian-Pi/C:\Users\Alex\dsh-Projects\pi-opendurig` (a repo-root join with a foreign absolute path);
   **no such directory exists at the repo root now** and the string is absent from the store's records.
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

## Then, in this order (measured ranking — `docs/reviews/wallclock-budget-2026-10-28.md` §6, ruling D153, amended by D154)

1. **#725 / #726 / #727 (channel resident) + the head of the queue.** History prices the channel: `run`-invoked days
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
5. **ROADMAP 228 — project the big reads; `queue` has no filters.** `status` = 22,748,093 B, `queue --json` =
   21,178,646 B, and `cmdQueue` (`cli.mjs:1018-1021`) **takes no arguments** — unknown flags fail open.
6. **ROADMAP 229 — the admission age that nothing writes.** 45/45 retained `SKIP … reason=pending` lines carry no
   ` age=`; `admissionVerdict` has one hit in `src/` (its definition). See §Evidence below.
7. **ROADMAP 230 — the channel-start surface.** `tools/channel-preflight.mjs` is the delegate half; the product half is
   two attention kinds + a bounded `channel` block in `status`.
8. **ROADMAP 231 — make hold reasons evaluable** (the "queue drains" clause above).
9. **ROADMAP 208 — hold context, don't chase model quality.** 94.0% cache hit; 23,053 prompts > 150,000 tokens, max
   1,009,360 against a declared 200,000 window.

## Do not "fix" these on the strength of the docs

**An orphan-candidate verdict is not a release recommendation** — #725/#726/#727 have every cited gate `done` and are
*correctly* held by an operator clause; read the body (`stale-held-backlog.md` §Do). **A `WAKE` in the preflight's
"after pass-1 reconcile" column is a prediction about reconcile**, not a delivered wake. **`queued` is not `claimable`**
in the queue sense: the queue's claimable state is `queued` *items*, and submission rows are a different table — mixing
them is how this session nearly mis-wrote 229. **`admissionVerdict` being inert means aged `queued` rows are never
withdrawn** — do not "recover" them by hand with a second writing Harness. `DURIG_MAX_CONCURRENT_SEATS` is unset in
`durig.config.json`, `"1"` in `durig.config.default.json`, and the observed profile is **not** single-flight (max 11 in
flight) — read `src/config.mjs loadConfig` first (D153 §4). The 5-minute degeneration bound is a *turn* guard on a
different quantity, and the 5-minute **admission** deadline is a different 5 minutes again. A `--dry-run` names no
removals (resets model+cwd only) — not a safety check. Model speed is **12.7%** of machine time. `tools/` is untested by
design except where a demo is named.

## Evidence for the D154 claims (re-runnable)

`node tools/channel-preflight.mjs --db ./selfdev.sqlite` (§1–§6 of `docs/reviews/channel-start-preflight-2026-10-28.md`);
`grep -c "age=" selfdev.sqlite.broker.log` → **0** against **45** `SKIP … reason=pending` lines in the 80 retained lines;
`grep -rn "admissionVerdict(" src/` → **1** (the definition, `src/broker.mjs:879`);
`jq -r '.items[].status' < .spike/delegate/queue-audit-2026-10-28.json | sort | uniq -c`.

## CLOCK-OUT (2026-10-28T19:35Z, delegate — channel-start pre-flight session)

**Done and verified.** New instrument **`tools/channel-preflight.mjs`** (**2.0 s**, read-only, imports
`advancingConvIds`/`admissionVerdict`/`selectWakes` so its verdicts are the product's own — 215 ms of import, no drift);
review **`docs/reviews/channel-start-preflight-2026-10-28.md`**; ruling **D154**; rows **ROADMAP 229/230/231**;
`tools/queue-drain-audit.mjs` now prints `heldLandingIds`/`orphanIds`/`gateProseIds` and its heading corrected to
**non-terminal (`held`+`deferred`) LANDING rows** (the old "held LANDING" label double-counted `#4805`, which is both an
on-main landing and an awaiting-human deferral); `tools/README.md` rows + the top-level tool count 8 → **10**; the pm
release brief prepared at `.spike/delegate/pm-release-brief-2026-10-28.md` (**not spooled**).
**The session's headline is a correction, not a build:** the top lever's blocker was recorded as "the operator has not
started the broker"; measured, the chain is four links and the binding one is **an empty claimable head (0 rows, 6.1
days)** plus **an unevaluable operator clause holding the top three rows**. The reassuring half: **a restart
self-heals** — pass 1's `reconcileStrandedSubmissions` settles the 9 `placed` orphans and all 9 suppressed seats read
`WAKE` afterwards.
**One claim I nearly shipped and corrected in public:** my first instrument aged submissions from
`record.admittedAt ?? record.createdAt`, printed `age n/a`, and I was about to write "the product has no admission
timestamp". It does — **derived at `src/readapi.mjs:269-284`, never persisted**. Re-reading the producer turned a wrong
claim into 229. Rule: **an `n/a` in your own output is a claim about your instrument until you have read the producer.**
**Unverified deliberately:** no channel start, no `up`/`worktree`/`run`/`send`/`resume`/`doctor` — **no writing verb on
this workspace**; no queue row claimed/released/cancelled/deferred/routed; no intent spooled; no push. The 2 `queued`
submissions at the head of pm's conversation are reported, not withdrawn.
**Pitfalls recorded** (so the next session does not pay twice): `tools/README.md` — print ids not just counts; the
`held`+`deferred` label truth; import the product's decision function instead of re-deriving it. This file's
§DO-NOT-FIX — orphan ≠ releasable; `WAKE-after-reconcile` is a prediction; queue **items** and **submissions** are
different tables. `node --check` on a new tool costs 0.02 s and found the two real syntax faults this session before
they cost a run.
