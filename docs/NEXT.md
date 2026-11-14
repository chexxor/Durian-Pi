**Last update:** 2026-11-14T01:0xZ (delegate). Every shipped commit in this milestone is a ROW in the table below,
**in commit order** — enforced mechanically, not by eye: `node tools/pointer-sha-coverage.mjs --base 03bdbf4d`
(0.2 s, exit 0/1) names every commit in `base..HEAD` that has no row. The ONE exempt commit is the one carrying this
file, because a file cannot name the commit that contains it; `git log -1 --format=%h -- docs/NEXT.md` names it.
The session that edits this file adds the previous carrier as a row — the tool fails (exit 1) if it does not.
Ahead of `origin/main`, **nothing pushed** — the push grant is the operator's.

**Milestone this window worked** — **N19 "The Pool" (D275), made USABLE and PROVEN ALIVE.** Every commit in the
range `03bdbf4d..HEAD`, oldest first (the four that earlier cuts of this pointer SKIPPED are marked ← new):

| sha | shipped |
|---|---|
| `851c3e9c` | ← new: the `broker-down-or-stalled` runbook, in the code's own verdict words (#4786) |
| `655c44e2` | `revise_work` takes `requires` (normalised, one `revised` transition, two refusals) |
| `1782b495` | pool doctrine in the shared `constitution.txt`; `peek_queue`/`WAKE_CONTENT`/`queueItemLine` aligned |
| `4ed6b8d0` | `tools/pool-migrate.mjs` — read-only proposal instrument |
| `517dc58d` | window seam: `up --refresh` records `usableWindow` for all 12 seats (gate armed) |
| `36f57a36` | pool-migrate: read the roster through the seats DOCUMENT view (an AMEND of `01ff4c91`, off `main`) |
| `657d8c60` | ← new: merge of the `win/item-4786` landing onto `main` |
| `99250682` | spec §13, FEATURES, D275 addenda (f)–(k), pitfalls, pointer rewrite |
| `78bc0364` | live `check rig.selfdev.json` finding on #7660 + pitfall 324 |
| `1c0c5920` | gate proven on the roster; `pool-gated:<n> #<id>(<reason>)` |
| `2bfb9e43` | frozen-broker note |
| `f6177f21` | authority narrowed to the contract, gate number 115023, §13.3b reconciliation |
| `02105352` | demo prints the refusal + reads the LIVE roster; broker windows; live decline line |
| `c4b0ea7e` | `tools/pool-gate-live-probe.mjs` + test (refusal from a byte-copy of the live store) |
| `d37bd216` | the gate-proof demo's header: 117891 → 115023 |
| `5363e377` | pointer sha table names every object, no "this commit" |
| `ac6b7a8a` | lifecycle field table gives `requires` its own row; live census |
| `4f9e87d9` | the LIVE scheduler refuses #7700 by name for every seat |
| `8abc961e` | flake recorded (restart-limit under --jobs 4) |
| `35ff79f2` | broker windows 4-5, blocker (1) TRIGGERED, rate window closed at 22:13Z |
| `7008d11d` | pointer re-cut to fit the clockin digest budget (115 lines) |
| `446c4084` | the gate FIRED live: #7700 refused by architect and pm; spec/D275 corrected |
| `06de1bba` | deleted the sentences that still DENIED the live firing (spec §13.4, D275 (m)) |
| `18c7a3b8` | pool census re-read (5 pooled / 3 open; #7722 minted organically) |
| `3fb50030` | pause/unpause evidence + refresh timing; pointer arithmetic (104 = 85+19) and shas |
| `5b8e3644` | ← new: the pointer's HEAD-row fix (a sha table that cannot name itself) |
| `0de543ae` | ← new: unpause the fleet, fix the `priority-directive-scope` time bomb, record the pause sequence |
| `11290f1e` | windows/pointer record: the green `--jobs 2` suite run and the two concurrency flakes |
| `280d6ad3` | unpause verified by behaviour (#7722 claimed 6 min after it), fresh census, suite re-run |
| *(this commit)* | the table above, the lease procedure, and the `--jobs 4` seconds — exempt: it carries this file |

The two ordering defects this table had (and the tool now catches) were `36f57a36` listed before `517dc58d` and
`7008d11d` before `35ff79f2`.

Read `docs/POOL-QUEUE-SPEC.md` **§13, §13.3b, §13.4** (code's own strings; the number reconciliation; the live evidence)
and `docs/reviews/2026-11-13-capability-ownership-ruling.md` (FIVE decisions).

**Broker windows this session — the commanded bound, the OUTER lease, and what actually happened.** A window is a
LEASE, and it is now leased from outside as well as inside (see the defect below):
| pid | `--max-duration` | outer lease | START → EXIT | actual | verdict / cause |
|---|---|---|---|---|---|
| 98022 | 3600 s | none | 17:32:55.451Z → 19:11:54.118Z | 5,939 s | **OVERRAN** by 2,339 s (replaced a 05:57:09Z deadline exit) |
| 311912 | 3600 s (keepalive) | none | 19:11:56.490Z → 20:42:10.249Z | 5,414 s | **OVERRAN** by 1,814 s — STRANDED (no pass 2,350 s, 1 intent) |
| 540123 | 1800 s | none | 20:42:21.399Z → 21:32:41.503Z | 3,020 s | **OVERRAN** by 1,220 s; `serve --stop` refused → `kill -TERM` |
| 774849 | 1800 s | none | 21:34:01.725Z → 22:13:24.335Z | 2,363 s | **OVERRAN** by 563 s; exited `reason=deadline` after the TERM |
| 899525 | **NOT recorded** (keepalive spawned it; the tool passes `--max-duration` but wrote no bound into its ledger, and this store keeps no tick for that window — the 3,600 s is the tool's DEFAULT, so it is INFERRED, not recorded) | none | 22:13:26.113Z → 00:10:24.944Z | 6,418 s | **OVERRAN**; exited `reason=max-duration passes=335` |
| 1574499 | 1800 s | none | 00:22:11.251Z → 00:57:58.038Z | **2,146.8 s** | **OVERRAN** by 346.8 s and PARKED: last pass 00:49:21 frozen 8 min while `READ-DRAIN` kept serving; ended by `kill -TERM`, `EXIT reason=deadline` **5 s** later |
| 1799704 | 600 s | `timeout --signal=TERM --kill-after=30 120` | 00:58:04.244Z → 01:00:09.236Z | **125.0 s** | **WITHIN the lease** — 120 s + a 5 s exit path; `STOP-REQUESTED source=signal` → `EXIT reason=deadline passes=-` |
| 1806797 | 3600 s | `timeout --signal=TERM --kill-after=60 1800` | 01:01:21.405Z → open | — | leased from outside; `PASS 1 ms=1064 woke=pm,impl,qa,lead,advocate,scribe,devtools,auditor,security,qa2,architect` |

**The defect, in code and in a measurement (this is why the earlier record's "bounded" claim was false).**
`--max-duration` is checked at the TOP of the broker loop (`src/broker.mjs:2058`), so a pass in flight — or a pass that
never settles — defers the deadline indefinitely: that is why six consecutive windows "commanded" 1,800–3,600 s ran
2,146–6,418 s. The measurement that separates the two mechanisms is pid 1574499: its bound was 00:52:11Z, its last
pass froze at 00:49:21, `READ-DRAIN served=1` lines kept arriving, and **SIGTERM at 00:57:53Z produced
`EXIT pid=1574499 reason=deadline passes=-` at 00:57:58.038Z — 5 s**. So the exit path is prompt; only the *deadline
check* is starved. It is a base defect, recorded as such, and the delegate did not "fix" it in `src/broker.mjs`
(out of this goal's IN list) — instead the PROCEDURE now leases the wall clock from outside:

```bash
set -a; . "$HOME/.config/durig/env"; set +a
DURIG_DB=./selfdev.sqlite nohup timeout --signal=TERM --kill-after=60 1800 \
  node cli.mjs serve --max-duration 3600 > .spike/window-leased.out 2>&1 &
# close a leased window, ALWAYS, in this order:
node cli.mjs resume                      # re-arms submissions the TERM cut (measured: 4 placed, run-cancelled)
```

The window that opens at `01:01:21.405Z` uses exactly that line, so the rig cannot park on a pass again; the next
start also reclaims the dead pid's slot leases (`src/broker.mjs:1481`; measured `generation_stale` 4 → **0** after the
`01:01:21Z` start). Liveness is still the last ` PASS ` line (pitfall 304): read
`grep ' PASS ' selfdev.sqlite.broker.log | tail -1` and `cat selfdev.sqlite.broker.json` BEFORE acting.

**The fleet is UNPAUSED and was seen to DRIVE** (this was the one objection the 8th audit raised that had to be
closed, so the evidence is spelled out). The audit read `paused:true, pausedAt:23:50:48.611Z, pausedBy:operator` and
was right: `23:46:33.518Z pause`, `23:49:41.162Z unpause`, `23:50:48.607Z pause`, nothing after — a second pause landed
11 s after the unpause. Closed at **`00:19:28Z`** by `node cli.mjs unpause`; verified by a **broker** `status --json`
read (not `--local`, whose second-connection staleness is pitfall 326): `control {paused:false, pausedAt:null,
pausedBy:null}`. `paused:false` alone is a claim, so here is the behavioural proof: **`#7722` was minted by
`architect` at `23:31:40.751Z` — INSIDE the pause — sat unclaimed for the whole pause, and carries
`pool-claimed by=advocate` at `2026-11-14T00:25:35.756Z`**, a live pool claim 6 minutes after the unpause and none
before it (`node .spike/pool-rows.mjs ./selfdev.sqlite`, 1.2 s). A paused fleet cannot produce that transition.

**Host for every number below**, measured with the measurement: **Linux**, Fedora Linux 45 (Forty Five), kernel
`7.2.15-300.fc45.x86_64`, node **v24.22.1**, `git version 2.56.0` — probe:
`uname -s && uname -r && (. /etc/os-release && echo "$PRETTY_NAME") && node -v && git --version`.

## NEXT SESSION

**Current item:** **the N19 pool is CLOSED — usable, alive, and the gate has fired on a LIVE seat.** `pm` minted
**#7700** (`pool:true, tier:"project"`, `21:20:16.789Z`); the live scheduler refuses it by name for every seat
(`SKIP auditor reason=pool-gated:2 #7660(requires:docs),#7700(too-big:project(120000 tokens > 70% of the 12288-token
usable window))`, 113 lines by 21:47Z); and **two real seats claimed it by id and were REFUSED** — `size-refused` on
the row `by=architect` `22:04:21.104Z` and `by=pm` `22:44:08.942Z`, reason
`too-big:project(120000 tokens > 70% of the 164320-token usable window)`. Their live transcript carries the whole
string, verbatim: `CLAIM_REFUSED: #7700 is in the POOL but you cannot claim it (too-big:project(120000 tokens > 70% of
the 164320-token usable window)). It was sent by pm. … Split it: send_work the pieces …, then close #7700 with
complete_work(itemId: 7700, closedAs: "split", children: [...]) - a row nobody can finish is a sizing problem, not a
queue problem.` Census: **`sizeRefused: 1`**. Corroborated by `demo/pool-gate-live-roster.test.mjs` (live roster) and
`tools/pool-gate-live-probe.mjs` (byte-copy of the live store: impl and auditor each refused with `Split it: …`).

**State the pool is in** (`node .spike/pool-rows.mjs ./selfdev.sqlite`, 1.2 s, read-only — re-read it, the team keeps
minting): at `00:31Z` `pool {rows:5, pooled:5, open:2, claimed:3, ownerOfRecord:3, sizeRefused:1,
seatsWithoutWindow:[]}`. Open: **#7660** (`small`, `requires:"docs"`, no seat advertises it) and **#7700**
(`project`, refused twice, still open) — the pool is down to two unclaimable rows *by design*, which is the state the
gate is supposed to produce. Claimed: **#7667**
(`pool-claimed by=advocate` 18:35:43.701Z, `done` 21:28:24.564Z), **#7669** (`pool-claimed by=security`
18:36:48.521Z, `done` 21:14:32.765Z) and **#7722** (`pool-claimed by=advocate` `00:25:35.756Z`, in flight — minted by
`architect` at 23:31:40.751Z, organic use, not asked for by this goal). #7667 and #7669 both name
`docs/DECISIONS.md`, which `ownership` gives to `advocate` ALONE, so security's claim is the milestone's cross-owner
probe on a live row. `requires` carries no live annotation: **9 of 885 queued rows** have one and **0** rows have a
`revised` transition with `requiresFrom/To` — every one was minted with it by `send_work` (the baseline's 7 was a
smaller census). Seats: 11 × 164320, auditor 12288; gate limits 115023 / 8601, so **only `project` can be refused**.
Precisely as the audit put it: **`tierTokens {trivial:3400, small:6100, feature:6200, project:120000}` is ONE
roster-level table** read by `seatSizeBudget(seatsDoc, seatEntry)`; **`usableWindow` is the per-seat field** (11 ×
164320, auditor 12288), and no seat carries its own `tierTokens` entry.

**One scope deviation, stated rather than buried:** the window seam landed in **`src/config.mjs`**
(`usableContextBudget` falls back to `declaredLocalWindow(...)`), which is NOT in the objective's IN list — the goal
named `src/rig.mjs`, `src/driver.mjs`/`src/readapi.mjs`, `prompts/*.md`, `peek_queue`, `tools/pool-migrate.mjs`, demos
and docs. It was needed because `up --refresh` wrote `usableWindow: null` for all 12 seats and the gate cannot be armed
without it; it is a SEAM (D212), not a feature, and its only consumer is the size gate. It is recorded here as a
`src/config.mjs`, not an `src/rig.mjs`, change — earlier prose in this session said "not in config", which was wrong.

**Backlog rate** (`node tools/backlog-burn.mjs --hours 4`): baseline (1,281 min) done **+8.5/h**, queued **+15.3/h**;
effect window 19:11:35Z → 22:13:03Z (181 min, contains #7667/#7669 closing) done **+5.3/h**, queued **+4.6/h**. Both
GROWING — **no causal claim**: closes and intake both fell while the fleet landed and `main` moved.

**Run these first** (measured on this box; re-measure rather than trust):

```bash
cd /home/chexxor/Git/Durian-Pi
grep ' PASS ' selfdev.sqlite.broker.log | tail -1; cat selfdev.sqlite.broker.json   # liveness is the last PASS line
node .spike/pool-rows.mjs ./selfdev.sqlite                                  # 0.8 s — every pool row + transitions
node tools/pool-migrate.mjs --dry-run --db ./selfdev.sqlite --limit 5       # 1.7-10 s — read-only denominator, balance line
node tools/pool-gate-live-probe.mjs --db ./selfdev.sqlite                   # 7-19 s — the gate refusing the LIVE roster's seats
node cli.mjs check rig.selfdev.json                                         # ~20 s — MUST name the rig: bare `check` audits ./rig.json
node tools/pointer-sha-coverage.mjs --base 03bdbf4d                         # 0.2 s — exit 1 if this file skips a shipped sha
node scripts/test.mjs --all --jobs 4                                        # 138.8-140.1 s — 337/337 at 280d6ad3 (auditor's run and mine)
node scripts/test.mjs --all --jobs 2                                        # 245-258 s — 337/337 (the lower-jobs re-run)
```

**Blocker:** (1) **TRIGGERED, per the objective's blocker rule** — the dry-run shows the capability-clean tranche would
make rows claimable by seats the `ownership` map does not cover: **104 of 164 proposed pool rows name a non-owner
claimant** (src-tools-harness 85 + workflow-docs 19 = 104 at `23:5xZ`; the tool re-read at `00:2xZ` says 105 of 165 —
**re-run it, the team keeps minting**; list `.spike/pool-ownership-gaps.txt`).
Consequence: **no migration applied** — the tool stays a proposal; decisions 1–2 are the operator's. (2) Nothing
build-side waits: #7660 needs its author (`lead`) or `pm` to clear `requires:"docs"` (`check` reports
`pool-dead-gate`); the FIVE rulings below are owed.

**The full suite, both ways, with the seconds (the objective asks for `--all`, and the audit asked for the numbers):**
`node scripts/test.mjs --all --jobs 4` at `280d6ad3` is **337/337 in 140.1 s** (log
`.spike/suite-jobs4-2026-11-14T00-52Z.out`); the independent auditor's own run of the same command at the same sha is
**337/337 in 138.8 s**. `--jobs 2` at `11290f1e` is **337/337 in 245.1 s** (log
`.spike/suite-2026-11-14T00-42Z.out`), and at `0de543ae` **337/337 in 257.8 s**. The two `--jobs 4` concurrency flakes
that forced the earlier `--jobs 2` framing (`demo/restart-limit-behaviour.test.mjs`,
`demo/compaction-guard-gate.test.mjs`) did NOT recur in two consecutive `--jobs 4` runs; each was green standalone twice.
Re-run a named test alone before chasing it.

**Known red, and one that WAS red:** `node demo/offline.mjs` exits **1** —
`ASSERT FAIL: the fresh context should be short, got 7 messages` (pm's #6924) — recorded, not touched.
`demo/priority-directive-scope.test.mjs` went red at `23:59Z` because its fixture hardcoded
`expiresAt: "2026-11-13T23:59:00Z"`; the path correctly refused a past expiry and the demo crashed on the null result.
**Fixed** (time-relative fixture): the suite is reproducible again, and the lesson is pitfall 327.

**Operator decisions owed** (options/pros/cons in `docs/reviews/2026-11-13-capability-ownership-ruling.md`): (5) who may
annotate `requires` — author-or-`pm` as shipped, all coordinators, or a named `lead` exception; (1) is `ownership`
advisory (recommended, plus a `check` for disjoint owner/claimant pairs) or enforced at claim; (2) `devtools` vs `code`
(split the `src-tools-harness` artifact class); (3) should `send_work` refuse an unadvertised `requires` (#7660 is the
case; recommended: no, warn + red `check` + author repair); (4) should a pool claim notify its author (recommended:
annotate the author's `peek_queue`, no notice row).

**Exact next command for the MIGRATION goal** (a later, separately gated goal; the tool has NO write path by design):

```bash
node tools/pool-migrate.mjs --dry-run --db ./selfdev.sqlite --json .spike/pool-migrate-live.json --limit 5   # re-measure first
node tools/pool-migrate.mjs --dry-run --db ./selfdev.sqlite --seat devtools --limit 10                       # the clean tranche, by id
```
Its first WRITE is not a tool run: once decisions 1–2 are ruled, `pm` annotates chosen rows with
`revise_work({itemId, requires})` (author or `pm`), one `revised` transition each.

**Traps this window** — `docs/SELFDEV.md` **318–325** (the `seats` LIST vs DOCUMENT roster trap; `usableWindow: null`
from `up`; "armed" ≠ "fired"; an unclaimable pool row; a count is not a trace; `check` auditing `./rig.json`).

Full history of this pointer, verbatim: [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md)
