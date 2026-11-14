**Last update:** 2026-11-14T03:3xZ (delegate). Every shipped commit in this milestone is a ROW below, **in commit order** —
enforced by `node tools/pointer-sha-coverage.mjs --base 03bdbf4d` (0.2 s, exit 0/1), not by eye. The ONE exempt commit
is the one carrying this file (a file cannot name its container; `git log -1 --format=%h -- docs/NEXT.md` names it),
and the session that edits this file adds the previous carrier as a row or the tool fails. Nothing pushed — the push grant is the operator's.

**Milestone this window worked** — **the unlanded-ref residue (the work-item lifecycle, D265; ROADMAP 347 "Milestone
closure is prose") — a gated landing pass: 20 of the 21 refs the census said needed landing are now on `main`.** Every
commit in the range `03bdbf4d..HEAD`, oldest first (the four that earlier cuts of this pointer SKIPPED are marked ← new):

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
| `8f4a63ce` | the sha table becomes a TOOL-checked claim (`tools/pointer-sha-coverage.mjs` + test); the window lease; the bound recorded per window and the lease measurement |
| `313c525b` | the suite table with its seconds, the pointer cut back under the 200-line cap, pitfalls 328–329 |
| `54fa9649` | the pointer records the re-leased window `1903310`, the one open at clock-out |
| `ab96bf0b` | `docs/DISPOSITIONS.md`: 20 LANDED rows with ancestry+content evidence, `item-6959` KEEP-HELD with the gate refusal quoted; no ref deleted (rule R-B #3270) |
| `16166492` | pitfalls 330–333 + the `tools/landing-batch-plan.mjs` addendum (a plan is HEAD-scoped; `merge-tree`'s exit code is the verdict) |
| *(this commit)* | the landing-pass pointer rewrite — exempt: it carries this file |

The two ordering defects this table had (the tool now catches both) were `36f57a36` before `517dc58d` and `7008d11d` before `35ff79f2`.

Read `docs/POOL-QUEUE-SPEC.md` **§13, §13.3b, §13.4** (code's own strings; the reconciliation; the live evidence) and `docs/reviews/2026-11-13-capability-ownership-ruling.md` (FIVE decisions).

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
| 1806797 | 3600 s | `timeout … 1800` | 01:01:21.405Z → 01:15:46.004Z | 864.6 s | ended by the operator's own TERM to re-lease (it was inside its lease); `PASS 1 ms=1064 woke=pm,impl,qa,lead,advocate,scribe,devtools,auditor,security,qa2,architect` — the fleet woke |
| 1903310 | 7200 s | `timeout … 3600` | 01:15:55.288Z → open (ends ~02:15:55Z) | — | the window open at clock-out; `resume` ran first (exit 0) so the TERM cut no submission loose |

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

The window open at clock-out is `1903310` (`01:15:55.288Z`, outer lease 3,600 s). Each window is opened inside
`timeout --signal=TERM`, so the wall clock is bounded by the command that opened it.
Liveness is the last ` PASS ` line (pitfall 304): `grep ' PASS ' selfdev.sqlite.broker.log | tail -1` plus `cat selfdev.sqlite.broker.json`, BEFORE acting.

**The fleet is UNPAUSED and was seen to DRIVE** (the 8th audit's one hard objection, so the evidence is spelled out).
The audit read `paused:true, pausedAt:23:50:48.611Z` and was right: `23:46:33.518Z pause`, `23:49:41.162Z unpause`,
`23:50:48.607Z pause`, nothing after — a second pause landed 11 s after the unpause. Closed at **`00:19:28Z`** by
`node cli.mjs unpause`, verified on a **broker** `status --json` read (never `--local`; pitfall 326): `control
{paused:false, pausedAt:null}`. `paused:false` is a claim; the behaviour is that **`#7722`, minted by `architect` at
`23:31:40.751Z` INSIDE the pause, sat unclaimed all pause and carries `pool-claimed by=advocate`
`2026-11-14T00:25:35.756Z`** (`node .spike/pool-rows.mjs ./selfdev.sqlite`, 1.2 s). A paused fleet cannot do that.
And it is still driving now: the `01:01:21Z` window's `PASS 1 … woke=` names all eleven non-auditor seats.

**Host for every number below**, measured with the measurement: **Linux**, Fedora Linux 45 (Forty Five), kernel
`7.2.15-300.fc45.x86_64`, node **v24.22.1**, `git version 2.56.0` — probe:
`uname -s && uname -r && (. /etc/os-release && echo "$PRETTY_NAME") && node -v && git --version`.

## NEXT SESSION

**Current item:** **the landing pass is CLOSED: `main` `03bdbf4d` → `82a3c51d` → `16166492`, 20 refs landed, 1 held.**
Each landed ref is proven two ways: `git merge-base --is-ancestor <ref> main` exit **0** and every `+` line of its
branch-vs-base diff present on main (probe `.spike/landing-content-probe.mjs`, ~40 s: 1,087 lines for bin 1, 68 for
the chain, 0 missing). Full suite at `82a3c51d`: `node scripts/test.mjs --all --jobs 4` → **341/341 in 136.8 s**
(Linux Fedora 45, kernel `7.2.15-300.fc45.x86_64`, node v24.22.1). One ref did NOT land: `item-6959` adds
`demo/noop-wake-census.test.mjs` with no `demo/test-areas.json` row, so the derived gate refused it
(`demo/compaction-acceptance-gate.test.mjs:117`) — routed to `pm`, ref kept.

**Older current item, still true:** **the N19 pool is CLOSED — usable, alive, and the gate has fired on a LIVE seat.** `pm` minted
**#7700** (`pool:true, tier:"project"`, `21:20:16.789Z`); the live scheduler refuses it by name for every seat
(`SKIP auditor reason=pool-gated:2 #7660(requires:docs),#7700(too-big:project(120000 tokens > 70% of the 12288-token
usable window))`, 113 lines by 21:47Z); and **two real seats claimed it by id and were REFUSED** — `size-refused` on
the row `by=architect` `22:04:21.104Z` and `by=pm` `22:44:08.942Z`, reason
`too-big:project(120000 tokens > 70% of the 164320-token usable window)`, with the whole `CLAIM_REFUSED: … Split it:
…` instruction in their transcript. Census: **`sizeRefused: 1`**; corroborated by
`demo/pool-gate-live-roster.test.mjs` and `tools/pool-gate-live-probe.mjs` (byte-copy of the live store).

**State the pool is in** (`node .spike/pool-rows.mjs ./selfdev.sqlite`, 1.2 s, read-only — re-read it, the team keeps
minting): at `00:31Z` `pool {rows:5, pooled:5, open:2, claimed:3, ownerOfRecord:3, sizeRefused:1}`. Open: **#7660**
(`small`, `requires:"docs"`, no seat advertises it) and **#7700** (`project`, refused twice) — two unclaimable rows
*by design*, which is the state the gate is supposed to produce. Claimed: **#7667** (advocate, `done` 21:28:24.564Z),
**#7669** (security, `done` 21:14:32.765Z) and **#7722** (advocate, `00:25:35.756Z`, in flight, minted by `architect`
23:31:40.751Z — organic use, not asked for by this goal). #7667/#7669 both name `docs/DECISIONS.md`, which `ownership`
gives to `advocate` ALONE, so security's claim is the milestone's cross-owner probe on a live row. `requires` carries
no live annotation: **9 of 885 queued rows** have one and **0** rows a `revised` transition with `requiresFrom/To` —
all minted by `send_work` (the baseline's 7 was a smaller census). Seats: 11 × 164320, auditor 12288; gate limits
115023 / 8601, so **only `project` can be refused**. As the audit put it: **`tierTokens {3400,6100,6200,120000}` is ONE
roster-level table** read by `seatSizeBudget(seatsDoc, seatEntry)`; **`usableWindow` is the per-seat field**.

**One scope deviation, stated rather than buried:** the window seam landed in **`src/config.mjs`**
(`usableContextBudget` falls back to `declaredLocalWindow(...)`), NOT in the objective's IN list (which named
`src/rig.mjs`, `src/driver.mjs`/`src/readapi.mjs`, `prompts/*.md`, `peek_queue`, `tools/pool-migrate.mjs`, demos, docs).
It was needed because `up --refresh` wrote `usableWindow: null` for all 12 seats and the gate cannot be armed without
it; it is a SEAM (D212), not a feature, and its only consumer is the size gate. Earlier prose in this session said
"not in config" — that was wrong, and this is the correction.

**Backlog rate** (`node tools/backlog-burn.mjs --hours 4`): baseline (1,281 min) done **+8.5/h**, queued **+15.3/h**;
effect window 19:11:35Z → 22:13:03Z (181 min, contains #7667/#7669 closing) done **+5.3/h**, queued **+4.6/h**. Both
GROWING — **no causal claim**: closes and intake both fell while the fleet landed and `main` moved.

**Run these first** (measured on this box; re-measure rather than trust):

```bash
cd /home/chexxor/Git/Durian-Pi
timeout 200 node tools/branch-census.mjs --json > .spike/census.json          # ~35 s — the residue after the pass
timeout 120 node tools/landing-batch-plan.mjs --max 12                        # ~13 s — RE-RUN after every bin (pitfall 330)
node cli.mjs worktree audit --json                                            # ~1 s — 157 worktrees still open
node scripts/test.mjs --all --jobs 4                                          # 136.8 s — 341/341 at 82a3c51d
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

**The full suite, both ways, with the seconds (the objective asks for `--all`, and the audit asked for the numbers).**
The suite is **338 tests** since this window added `tools/pointer-sha-coverage-test.mjs`:

| sha | command | result | log |
|---|---|---|---|
| `82a3c51d` | `--all --jobs 4` | **341/341 in 136.8 s** | `.spike/suite-final-jobs4.out` |
| `280d6ad3` | `--all --jobs 4` | **337/337 in 140.1 s** | `.spike/suite-jobs4-2026-11-14T00-52Z.out` |
| `8f4a63ce` | `--all --jobs 4` | **337/338 in 142.9 s** — `demo/restart-limit-behaviour.test.mjs` failed 2 checks, PASS when run alone twice | `.spike/suite-jobs4-8f4a63ce.out` |
| `8f4a63ce` | `--all --jobs 2` | **338/338 in 253.9 s** | `.spike/suite-jobs2-8f4a63ce.out` |

The flake is REAL and it is `--jobs 4`-only and intermittent: it did not appear in two earlier `--jobs 4` runs at
`280d6ad3` and did appear once at `8f4a63ce`, whose diff is a tool plus a test and touches nothing the test exercises.
The reproducible green at HEAD is `--jobs 2`. **338/338 in 253.9 s** is the number to quote at `8f4a63ce`; a
`--jobs 4` number is 337 or 338 depending on contention, and a red line there is not a defect in the change.
Re-run the named test alone before chasing it.

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

**Traps this window** — `docs/SELFDEV.md` **330–333** (a landing plan is valid only against the HEAD it was computed
on; `git merge-tree` prints a tree oid on line 1 even when it CONFLICTS — the exit code is the verdict; a hand-resolved
merge that drops the trailing newline is refused by the text-integrity gate; a branch adding a demo without an area
mapping is not landable and only the gate catches it). Older: **318–329** (the `seats` LIST vs DOCUMENT roster trap; `usableWindow: null`
from `up`; "armed" ≠ "fired"; an unclaimable pool row; a count is not a trace; `check` auditing `./rig.json`; a
`--local` control read staleness; a hardcoded future date in a fixture; **328** `--max-duration` bounds the loop, not
the wall clock, so lease every window from outside; **329** a hand-written sha table skips a sha — run
`tools/pointer-sha-coverage.mjs` instead of trusting the eyes).

Full history of this pointer, verbatim: [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md)
