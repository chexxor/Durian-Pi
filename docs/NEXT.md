**Last update:** 2026-11-14T03:3xZ (delegate). Every shipped commit in this milestone is a ROW below, **in commit order** —
enforced by `node tools/pointer-sha-coverage.mjs --base 03bdbf4d` (0.2 s, exit 0/1), not by eye. The ONE exempt commit
is the one carrying this file (a file cannot name its container; `git log -1 --format=%h -- docs/NEXT.md` names it),
and the session that edits this file adds the previous carrier as a row or the tool fails. Nothing pushed — the push grant is the operator's.

**Milestone this window worked** — **the unlanded-ref residue (the work-item lifecycle, D265; ROADMAP 347 "Milestone
closure is prose") — a gated landing pass: 20 of the 21 refs the census said needed landing are now on `main`.** Every
commit in the range `03bdbf4d..HEAD`, oldest first (the four that earlier cuts of this pointer SKIPPED are marked ← new):

| sha | shipped |
|---|---|
| `851c3e9c` | docs(runbook): broker-down-or-stalled.md - the he… |
| `8c0de873` | #5065: runbook row - a thin item worktree CAN run… |
| `d34b15d1` | feat(tools): landing-closure probe (#4378) — a ro… |
| `a15a5a48` | docs(dispositions): ledger row superseding #5611'… |
| `6c8b0320` | #7601: re-anchor the stale G11 line pin in the sa… |
| `5140de6e` | docs(roadmap+dispositions): #5501 — RM-318 closes… |
| `d04f124d` | docs(spec,#7615): make the landing spec's numbers… |
| `e375f724` | docs(dispositions): #7353 - register scribe-item-… |
| `655c44e2` | N19 pool row 3: revise_work can annotate `require… |
| `1782b495` | N19 pool doctrine: one paragraph in the shared co… |
| `4ed6b8d0` | N19 pool tranche 1: read-only pool-migrate propos… |
| `517dc58d` | N19 row 5 seam: usableContextBudget falls back to… |
| `bfa0472e` | #5347 landing preflight: refuse on dirt the landi… |
| `9780b0bf` | #5347 runbook (docs/runbooks/land.md): the pre-fl… |
| `c91b3550` | docs(dispositions): #7371 - register scribe-item-… |
| `3c9e6337` | docs(runbook): #7371 - land.md's remaining H2->H4… |
| `36f57a36` | pool-migrate: read the roster through the seats D… |
| `69a63baf` | docs(dispositions): #7372 - register scribe-item-… |
| `657d8c60` | merge: land win/item-4786 onto main |
| `c0f4709a` | #5459 runbook: the landing gate trips over the sp… |
| `a6d2b6e7` | docs(decisions): #7373 - D122 mint status recorde… |
| `06b5d2ec` | docs(dispositions): #7373 - register scribe-item-… |
| `99250682` | N19 pool: record what shipped and was measured, a… |
| `78bc0364` | pool: the live check finding on #7660, and the tr… |
| `55d2fba1` | docs(runbook): #7374 - land.md's lock figures are… |
| `dea8f63f` | docs(dispositions): #7374 - register scribe-item-… |
| `1c0c5920` | pool: the gate is proven on the real roster, and … |
| `2bfb9e43` | NEXT: the resident broker predates the skip-line … |
| `f6177f21` | pool: narrow the annotation authority back to the… |
| `02105352` | pool: print the refusal, record the LIVE roster r… |
| `784bc2a9` | docs(runbook): #7375 - land.md's KEEP-ALL-SECTION… |
| `a5fff83c` | docs(dispositions): #7375 - register scribe-item-… |
| `c4b0ea7e` | pool: the gate refusing a project row from a byte… |
| `d37bd216` | pool-gate-live-roster: the header still carried t… |
| `5363e377` | NEXT: the sha table now names c4b0ea7e and d37bd2… |
| `9caf9638` | #5819 runbook worktree-unlinked-deps: the pi-sche… |
| `3f3de023` | #5819 runbook land.md: a landing proof is a tripl… |
| `ac6b7a8a` | pool: the lifecycle doc stops contradicting the v… |
| `2e5e8f18` | feat(landing): one queue split rule for the row s… |
| `4f9e87d9` | pool: the LIVE scheduler now refuses #7700 by nam… |
| `8abc961e` | NEXT: record the one 336/337 flake (restart-limit… |
| `44da626c` | docs(test-areas): map demo/tui-queue-split.test.m… |
| `35ff79f2` | NEXT: the broker record is five windows with the … |
| `7008d11d` | NEXT: re-cut to 115 lines / 8.8 KB — the clockin … |
| `1f6605db` | docs(dispositions): #7376 - register scribe-item-… |
| `446c4084` | pool: the gate FIRED on two live seats — #7700 re… |
| `06de1bba` | pool: delete the sentences that denied the live f… |
| `a8bd182b` | docs(runbook): #7377 - date the race/lock measure… |
| `28004fd0` | docs(dispositions): #7377 - register scribe-item-… |
| `18c7a3b8` | NEXT: pool census re-read (5 pooled / 3 open; arc… |
| `8135b68c` | docs(reviews, #5854): re-measure #4922's addendum… |
| `f52b05e0` | fix(genlock, #5020): the lander's live-holder pro… |
| `88ec4aeb` | docs(runbooks, #5020): land.md states what the la… |
| `3fb50030` | pool: record the pause/unpause evidence and when … |
| `5b8e3644` | NEXT: the sha table ends with a HEAD row so the p… |
| `a3e8f7d4` | docs(reviews) #7515: content probe of the 119 alr… |
| `0e6445f4` | docs(runbooks) #7515: stale-held-backlog gains ru… |
| `0de543ae` | pool: unpause the fleet, fix the time-bomb demo, … |
| `11290f1e` | NEXT: record the live window 1574499, the green -… |
| `280d6ad3` | pointer: the fleet is unpaused and seen to drive … |
| `8f4a63ce` | pointer: every shipped sha is a row, in commit or… |
| `313c525b` | pointer+pitfalls: the suite numbers at HEAD, the … |
| `54fa9649` | pointer: the re-leased window 1903310 is the one … |
| `6f478c69` | merge: land item-4378 onto main |
| `fb056834` | merge: land item-4812 onto main |
| `847bb984` | merge: land item-5020 onto main |
| `fafb14f9` | merge: land item-5065 onto main |
| `1069cc89` | merge: land item-5347 onto main |
| `8b803244` | merge: land item-5459 onto main |
| `c7942ed8` | merge: land item-5501 onto main |
| `dd7615a0` | merge: land item-5825 onto main |
| `f0beb3d5` | merge: land item-7515 onto main |
| `bc90acb9` | merge: land item-7601 onto main |
| `33cee497` | merge: land item-7615 onto main |
| `a0caa286` | merge: land item-5819 (append-only ledger conflic… |
| `1977e058` | merge: land item-6002 (append-only ledger conflic… |
| `70ae5124` | merge: land item-7371 (append-only ledger conflic… |
| `03e3fe9d` | merge: land item-7372 (append-only ledger conflic… |
| `d1e78382` | merge: land item-7373 (append-only ledger conflic… |
| `81b77238` | merge: land item-7374 (append-only ledger conflic… |
| `007cca82` | merge: land item-7375 (append-only ledger conflic… |
| `9e9dab59` | merge: land item-7376 (append-only ledger conflic… |
| `45ef4633` | merge: land item-7377 (append-only ledger conflic… |
| `94f21a75` | merge-correction: place the #5819 runbook additio… |
| `8d3f3dad` | merge-correction: restore the trailing newline th… |
| `82a3c51d` | merge: land landing-20261114 onto main |
| `ab96bf0b` | docs(dispositions): landing pass 2026-11-14 — 20 … |
| `16166492` | docs+tools: landing-pass pitfalls 330-333 and the… |
| `dd47ef89` | the pointer rewrite: the landing pass, 20 refs landed, item-6959 held, suite 341/341 |
| *(this commit)* | the landing-pass pointer rewrite — exempt: it carries this file |


Read `docs/POOL-QUEUE-SPEC.md` **§13, §13.3b, §13.4** (code's own strings; the reconciliation; the live evidence) and `docs/reviews/2026-11-13-capability-ownership-ruling.md` (FIVE decisions).

**Broker windows this pass.** A window is a LEASE and must be leased from OUTSIDE: `--max-duration` is checked only
at the top of the broker loop (`src/broker.mjs:2058`), so a pass in flight starves the deadline — six consecutive
windows "commanded" 1,800–3,600 s actually ran **2,146–6,418 s** (measured pid 1574499: bound 00:52:11Z, last pass
froze 00:49:21, SIGTERM 00:57:53Z → `EXIT reason=deadline` 5 s later; the exit path is prompt, only the deadline
check is starved). Procedure now: `nohup timeout --signal=TERM --kill-after=60 1800 node cli.mjs serve --max-duration 3600 …`,
and close a leased window with `node cli.mjs resume` FIRST. The window open at clock-out was `1903310`
(01:15:55.288Z, outer lease 3,600 s). Liveness is the last ` PASS ` line (pitfall 304), never the pid or heartbeat.

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
