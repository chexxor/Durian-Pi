# NEXT — current priority and exact next command

**Last updated:** 2026-10-28T19:55Z, delegate session. Linux box `Alex-Desktop-Win10` (Fedora
`7.2.11-200.fc44.x86_64`), `node v24.22.1`. Read me first — do not re-derive the priority from the ~4,100-line
roadmap. History: **`docs/NEXT-ARCHIVE.md`**. This file is a **pointer, capped at 200 lines** by
`demo/next-pointer.test.mjs`, which also requires the `## NEXT SESSION` block below to carry a current item, a queue id,
a `node cli.mjs` command and a `**Blocker:**` line — **rewrite it in place, do not restyle it** (this session broke that
demo by restyling; see the clock-out log).

## NEXT SESSION

**Current item:** **keep the delivery channel resident** — the single largest measured wall-clock lever on this rig.
**Queue ids:** **#725** (impl, ROADMAP 63 — `src/host.mjs` portable host supervisor: single-instance, backoff,
kill-on-wedge, honors the down marker), **#726** (devtools, ROADMAP 64 — `durig daemon` CLI + per-platform trigger
adapters), **#727** (qa, ROADMAP 67 — host chaos suite). All three are **`held`** and none is started.
**Next command (delegate, read-only):**
`DURIG_DB=./selfdev.sqlite DURIG_CONFIG=./rig.selfdev.json DURIG_SEAT_ROOT=/home/chexxor/Git/Durian-Pi-worktrees node cli.mjs watch --to engineer --json --interval 2000`
(then the baseline block below).
**Blocker:** two **operator** one-liners, both quoted in §OPERATOR OWES: (1) the ROADMAP 221 seat-root ruling, (2)
permission to start the broker **on Linux**, which is a writing verb that creates worktrees and Pi agent state here for
the first time. Until (2) is granted, the queue stays parked and the top term in the budget stays unpulled.
**History:** `docs/NEXT-ARCHIVE.md` — older sessions live there verbatim; this file stays a pointer.

### Read-only baseline — run this before anything else (all verified working, Linux, 2026-10-28)

```bash
cd /home/chexxor/Git/Durian-Pi
git worktree list --porcelain | tee .spike/worktree-inventory-$(date +%Y-%m-%d).txt  # 1 entry (main); 0 seat worktrees
node -e 'import("./src/seatroot.mjs").then(m=>console.log(m.describeSeatRoot({persistedCwd:undefined,env:process.env})))'
   # source: process cwd UNLESS DURIG_SEAT_ROOT is exported in this same shell — export it or a seat resolves to main
node tools/broker-serve.mjs --status      # STOPPED, 0 STRANDED, 0 RECONCILE, 10/10 providers complete (3.4 s)
node tools/latency-budget.mjs --db ./selfdev.sqlite           # 3.0 s, read-only: the two wall-clock currencies
node tools/queue-drain-audit.mjs                              # 1.0 s: which held rows are already closable
node scripts/clockin.mjs                                      # 2.7 s, 4.1 KB (not 14.6 KB — earlier note was wrong)
```

## Rig state, measured 2026-10-28 (Linux) — re-read, do not trust

**Store** `./selfdev.sqlite`: 274,068 records, 30,944 submissions, 12 seats. **Queue census**
(`node cli.mjs queue --json | jq -r '.items[].status' | sort | uniq -c`): **4,821 items = 3,748 `done` / 777
`cancelled` / 277 `held` / 19 `deferred`** → **296 non-terminal** (impl 177, scribe 44, devtools 35, qa 21, security 6,
pm 5, lead 5, auditor 2, qa2 1). `clockin` reports **attention: 13**, `broker: DOWN lastPassAt=2026-10-28T17:09:58Z`,
and **19 `deferred` rows waiting on the operator** (#4354, #4378, #4789, #4791, #4794, #4796, #4797, #4799, #4801, #4802,
#4804, #4805, #4812, #4813, #4814, #4815, #4816, #4817, #4818) — impl holds 13 of them.
**Worktrees:** `git worktree list --porcelain` = **1 entry** (this checkout, branch `main`); **no seat worktrees**
(`/home/chexxor/Git/Durian-Pi-worktrees/` absent, no `.git/worktrees/`, no `selfdev.worktrees.json`); local branches: 2
(`main`, `wip/seat-prompt-files`); `git worktree prune -n` silent. **Pi seat-agent state is host-local and absent here**
(no `*selfdev*` under `~/.pi/agent`), so the seat's *persisted cwd* — first link in `src/seatroot.mjs`'s chain — does not
exist on this box. **A seat worktree here is created, not migrated**: the first `up`/`worktree`/`run`/`send` is the
writing verb `docs/runbooks/workspace-move.md` gates. `D:\` survives only as the source clone's remote path
(`/mnt/d/Git/Durian-Pi`) — never write there.

## OPERATOR OWES (two one-liners; the team is blocked behind them)

1. **ROADMAP 221 — the seat-root ruling** (D152 §6 + D153 addendum). On the **Windows host** the seats' persisted agent
   cwd resolves to a `D:\Git\Durian-Pi-worktrees\<seat>`-shaped value and `up` reports `source: persisted seat cwd` even
   after `up --root /home/...`: the persisted value (written by `prepare_workspace` via `configure`) wins over `--root`,
   `DURIG_SEAT_ROOT` **and** the rig file. There is **no `seatRoot` field in `rig.selfdev.json`** (it declares no host
   path on purpose — its own `_readme`, ROADMAP 34) and none in `status` output, so the residue lives in Pi agent state.
   Proposed ruling **A**: *the persisted per-seat root becomes the workspace-root-relative name; `up --root` once per seat
   is sufficient; no migration code.* Then B (`--reconcile`) and C (store rewrite) are the team's. Why it is not inert on
   Linux: measured `classifyGitRoot("D:\Git\Durian-Pi-worktrees\engineer")` **on Linux** prints
   **`main-worktree` ("the main checkout")** — a stale Windows root mis-classifies as the LIVE tree, the exact F21
   failure `src/seatroot.mjs` exists to prevent.
2. **Permission to start the channel on Linux** (the #1 lever; the delegate will not take it):

```bash
cd /home/chexxor/Git/Durian-Pi && export DURIG_DB=./selfdev.sqlite DURIG_CONFIG=./rig.selfdev.json \
  DURIG_SEAT_ROOT=/home/chexxor/Git/Durian-Pi-worktrees
node tools/broker-serve.mjs --status   # confirm STOPPED / 0 STRANDED first; commit any dirty tracked file first
node tools/broker-serve.mjs            # read the first lines: what it found, what it reconciled
git worktree list --porcelain > .spike/worktree-inventory-after.txt   # diff against 2026-10-28 baseline
```

## Then, in this order (measured ranking — `docs/reviews/wallclock-budget-2026-10-28.md` §6, ruling D153)

1. **#725 / #726 / #727 (channel resident).** History prices it: `run`-invoked days 2026-10-13→15 waited
   **101.8–114.3 min** per claim and landed 47–132 items/day; resident-broker days 10-17→21 waited **2.6–5.4 min** and
   landed **314–741**/day. And **219.6 h of the 404.8 h store span (54.3%) had no generation in flight**; last `done`
   transition **2026-10-22T17:29:11Z**.
2. **ROADMAP 225 — decompose a running generation's wall-clock.** The **0.23% of generations ≥10 min hold 156.8 h
   (39.0%)** of machine busy time while their conversations committed **1–3 events** in their own windows (worst:
   `gen #268436`, seat `qa2`, 1,212 min, 3 events, ended `402`). Today no surface says what those hours were.
3. **ROADMAP 226 — stop waking seats onto a dead provider.** **14,630 generations (24.4%) ended in an error, 59.2 h
   (14.7% of busy time)**; **14,377** are one unfunded account's `402 "You need positive balance"`. `attention`
   `last_run_failed` is per-seat and most-recent-only, so a 14,377-run burst is invisible as a burst.
4. **ROADMAP 227 — make held-backlog drainability a product finding.** 277 `held` rows idle a median **213.5 h**
   (max 289.8 h), 19 `deferred` a median **145.2 h**; `tools/queue-drain-audit.mjs` measures **71 of the 277 already
   fully on main** (26% zero-build closable) — known today only because a delegate re-runs a script. Releasing stays
   **`pm`'s** verb; the rule only reports.
5. **ROADMAP 228 — project the big reads; `queue` has no filters at all.** `status` = **22,748,093 B**,
   `queue --json` = **21,178,646 B**, and `cmdQueue` (`cli.mjs:1018-1021`) **takes no arguments**, so `--status`/`--to`
   are accepted and ignored: **unknown flags fail open**. Delegate recipe meanwhile:
   `node cli.mjs queue --json | jq -r '.items[] | select(.status=="held" or .status=="deferred") | [.id,.status,(.to//"-"),(.subject//""|.[0:60])] | @tsv'`
   → 296 rows in **75 KB**.
6. **ROADMAP 208 — hold context, don't chase model quality.** 60,503 assistant turns: **94.0% cache hit**
   (576,678,609 fresh in / 9,071,180,595 `cacheRead`); **23,053 prompts > 150,000 tokens, max 1,009,360** against a
   declared 200,000 window; compaction **15.9 h** over 1,459 runs. Cold-prefill exposure at this box's 438–1,946 tok/s
   is **82–366 h** — the rig is one eviction policy away from being unable to start.

## Do not "fix" these on the strength of the docs

`DURIG_MAX_CONCURRENT_SEATS` is unset in `durig.config.json`, `"1"` in `durig.config.default.json`, and the observed
profile is **not** single-flight (max 11 in flight; 81 h at 1, 45 h at 2) — read `src/config.mjs loadConfig` first
(D153 §4). The 5-minute degeneration bound is a *turn* guard on a different quantity. A `--dry-run` names no removals
(resets model+cwd only) — it is not a safety check. Model speed is **12.7%** of machine time, so a faster model is not a
wall-clock intervention. `tools/` is untested by design except where a demo is named; `tools/latency-budget.mjs` needs a
demo only if its `--json` becomes a contract `verify` consumes.

## CLOCK-OUT (2026-10-28, delegate — wall-clock measurement session)

**Done and verified.** The whole-rig wall-clock budget in two currencies — `docs/reviews/wallclock-budget-2026-10-28.md`,
instrument `tools/latency-budget.mjs` (**2.9–3.0 s, read-only**: store opened `readOnly:true`, `status` is a viewer,
D11), ruling **D153**, new rows **ROADMAP 225–228**, `tools/README.md` row + three habits (index before probe;
`node --check` before running a new tool — 0.02 s, saved ~6 min; project big reads, never dump). Suite at last full run:
**238/238 in 41.1 s, exit 0**. Commits `48eb6a6` `8f8052c` `3dd0156` `41a846b` `b793a02`.
**Two claims I corrected in public (DECISIONS D153 correction + this file):** (a) "`queue --to engineer` → 96 open rows
/ 3,755 non-terminal" had been copied across sessions; the verb ignores all arguments and the true census is **296
non-terminal** — and the instrument printed `nonterm: 296` from its first run while prose said otherwise, which is the
argument for re-measuring instead of re-reading; (b) "13 registered worktrees, no `D:\`" was clock-in's store-derived
*persisted* seat roots, not registered trees — this clone has **1 worktree, 0 seat worktrees**.
**Pitfall for the next editor of this file:** the pointer has **two executable readers** — `demo/next-pointer.test.mjs`
(requires the first `## NEXT SESSION` before any `## CLOCK-OUT`; `**Current item:**`; a `#NNN` id; a command containing
`node cli.mjs`; its own `**Blocker:**` line; ≤200 lines) and `demo/clockin-digest.test.mjs` (digests only that section,
so **the `NEXT-ARCHIVE.md` link must be inside the pointer body**). Restyling NEXT.md without them turns the suite red —
it went red twice on my rewrite and is green after this cut. After editing this file run:
`node demo/next-pointer.test.mjs && node demo/clockin-digest.test.mjs` (~1 s each).
**Unverified deliberately:** no seat woken beyond read-only identity probes; no write verb on this host (broker down by
choice since 2026-10-28T05:35Z, 0 STRANDED); no queue row claimed/completed/deferred/released; no push. The review's
ranking is falsifiable and the test is written into D153: re-measure after one resident-broker day and compare
(`node tools/latency-budget.mjs --db ./selfdev.sqlite --json > .spike/latency-$(date +%F).json`, 11.9 KB).
**Notes taken** (pitfalls + speed-ups): `tools/README.md` (index-before-probe, `--check`, project-big-reads, `jq`
recipe); this file's §DO-NOT-FIX; `.scratch/` is untracked and **not** gitignored while `.gitignore:21` ignores
`.spike/` — one line for devtools to pick one scratch-root rule. `clockin` also printed a NOTE worth keeping: **no CLI
command prints a seat's persisted cwd** (`ps`/`status` omit it), so a cleared rig-file field is not evidence the seat
root is right — read a seat's own `seat_root` tool result, or `cli.mjs send <seat> seat_root`; that is exactly what
221 asks for.
