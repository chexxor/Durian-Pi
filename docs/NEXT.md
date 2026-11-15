**Last update:** 2026-11-15 (delegate, queue-backlog tranche — the pointer is the carrier commit for this window; every EARLIER shipped commit in this range is a row below, **in commit order**, enforced by `node tools/pointer-sha-coverage.mjs --base 8b5a19e1` (1.3 s, exit 0/1), not by eye). Nothing pushed — the push grant is the operator's.

**Milestone this window worked** — **making the queue backlog manageable and measurable (D315, ROADMAP 376-380, goal mwh73rd1-izyq72)**: protocol notices stopped being claimable work and are acknowledged mechanically, the view names work / notice / registration / awaiting-operator instead of one number, the mint path has a fan-out budget (duplicate + burst 100 + lineage), ROADMAP registrations are parked and ruled, and "the backlog is growing" is now a `check` rule that FAILS — and the finding now **QUOTES** the fleet ledger's own burn-rate sentence, so the gate and `node tools/backlog-burn.mjs` cannot spell "GROWING" differently (`src/fleetledger.mjs` is the ONE derivation, pitfalls 390/391). The bulk retire **RAN this window in a bounded broker lease**: live rows **1656 → 1200**, notices **461 → 5** (the 5
`claimed` notices left alone per `census.skippedClaimed`); the 171 registrations are **census-only** — `src/queueops.mjs:427`
returns `{changes: []}` for `registrations`, so moving a ledger copy into `docs/ROADMAP.md` is a docs task for a seat,
not a queue verb.
Every commit in `8b5a19e1..HEAD`, oldest first:

| sha | shipped |
|---|---|
| `e9a96b6f` | branch/worktree retire pass: `branch-prune` gains `--retire-merged`/`--retire-unmerged`/`--active-within`/`--bundle-dir`/`--quarantine`/`--unlock-locked`, 46 refs and 12 trees retired (refs 99+`main` → 53+`main`, worktrees 40 → 28), 0 forced, 0 failures |
| `965ab7c5` | **ROADMAP 371** — `claim_work`'s `itemId` door calls the SAME `workable()` predicate `selectNextWork` uses: a named claim on an open/cancelled/held gate is refused with the hop named, an id naming no row is `UNKNOWN_ITEM`, a named claim never claims a different row; `demo/by-id-claim-gate.test.mjs` 12 red checks → 0 in 0.31 s, pinned in the rig area |
| `0ecd56e8` | DISPOSITIONS: re-attempt rows for `item-7232-recut` / `item-3570-recut` / `item-3747-recut-r2` at `965ab7c5`, each with the verbatim lander refusal |
| `e1c66bfc` | **ROADMAP 368** — `assertSendAllowed` refuses a malformed Edges link (no `maySendTo`) instead of throwing a `TypeError`; `edgeProblems()` is the ONE predicate the write side (`cli.mjs up`) and the gate share; `cli.mjs up` validates edges BEFORE any write; `demo/edge-fail-closed.test.mjs` 24 checks, 0.78 s |
| `796ac233` | **ROADMAP 373** — the audit prints `lockedTrees` (17) and `lockedKept` (0) both named plus a lockNote; `auditSummary()` in `src/broker.mjs` is the single derivation; `branch-census` carries both; `docs/runbooks/branch-cleanup.md` step 5 corrected in place |
| `fc4e3730` | **ROADMAP 374 residual** — `branch-prune --retire-ruled` reads `docs/DISPOSITIONS.md` verdicts (last row wins, specificity-matched) instead of a typed regex; bundle-verify guard unchanged; `demo/branch-prune.test.mjs` §15 |
| `2dfce088` | **ROADMAP 375** — `selectWakes` takes a named `now`; the human-defer-lease demo drives a fixture clock and pins the seam (same row, two clocks, two verdicts) — the suite was red on a calendar, not a defect |
| `1f1a881c` | **ROADMAP 375** — the restart-limit crash fixture dies AT the observation, not one await after it: 10 standalone runs 2 red → 10 runs 0 red (14 s wall); full suite 361/361 in 192.3 s |
| `be71da98` | **docs close-out** — ROADMAP 371/368/373/374 amended in place with measured costs + new row 375; SELFDEV pitfalls 374-377; a DISPOSITIONS row for `item-7232-recut` showing `--retire-ruled` planning it and the bundle guard refusing to delete it without `--bundle-dir` |
| `3a8bce52` | docs(NEXT): the pointer back inside the 200-line cap — 61 earlier-tranche rows moved VERBATIM to `docs/NEXT-ARCHIVE.md`, the stale 25/25/3 and 358/358 tallies replaced with the measured state, `doc-integrity-guard` exit 0 |
| `054da8d3` | docs(NEXT): the pointer paragraphs restored in full (Blocker, decisions owed, known red, archive link) and the duplicated broker-window paragraph dropped — 102 lines, cap 200 |
| `80a87fca` | docs(NEXT): the `3a8bce52` row |
| `230ee8dd` | docs(NEXT): the `054da8d3` row, so the audit closes on its carrier |
| `7b417971` | docs(NEXT): the `80a87fca` row — the audit names every range commit except its own carrier |
| `0e46df03` | docs(NEXT): rows for the two pointer-fix commits (`230ee8dd`, `80a87fca`) |
| `352b5fcb` | docs(NEXT): the pointer-fix rows in commit order (`80a87fca` before `230ee8dd`) — the audit reported an ordering defect |
| `7cb34194` | docs(NEXT): rows for `7b417971`, `0e46df03`, `352b5fcb` — `pointer-sha-coverage --base 8b5a19e1` exits **0** (158 range commits, 80 covered by landing-merge rows, 0 holes) |
| `93e0044a` | docs: close the pointer chain (NEXT rows for `7b417971`/`0e46df03`/`352b5fcb` + measured costs) and add the pitfall-356 addendum |
| `8bd56720` | **ROADMAP 376-380 / D315** — the queue-backlog tranche: notices refuse `workable()` and are acknowledged by the driver for the whole roster (no seat turn, row retained); the watch footer names work/notice/registration/awaiting-you; `mintGate` (duplicate + BURST 100/window + LINEAGE under pressure) at the single mint path; registrations mint HELD and `registration-as-work` rules a claimable one; `queue-pressure` is a `check` rule that FAILS (band + growth floor = one fleet band) sharing ONE derivation with `tools/queue-pressure.mjs`; 7 pre-existing demos corrected; 30 rules, `docs/WORKFLOWS.md:293` 29 → 30 |
| `9eedeb3a` | docs(NEXT): the pointer names `93e0044a` and `8bd56720` in commit order so `tools/pointer-sha-coverage.mjs --base 8b5a19e1` exits 0 (it was that commit's exempt carrier) |
| `b08d1aa9` | docs close-out (resumed window): NEXT.md's suite tally corrected to artifact PROVENANCE — the cited `363/363 in 192.0 s` matched NO artifact; the green run is `suite-final-c.out` **363/363 in 219.3 s at tree `8bd56720`**, the earlier `362/363 in 199.3 s` and `360/363 in 191.4 s` at tree `93e0044a` are not a tally — plus provider 401 evidence re-probed and SELFDEV pitfalls 384-385 |
| `5a739a94` | docs(NEXT): the pointer names `9eedeb3a` in commit order — the audit reported one hole there (`tools/pointer-sha-coverage.mjs --base 8b5a19e1` at this commit → `1 hole: b08d1aa9`, exit **1**); it is exit 0 only from the commit that names `b08d1aa9` and this one |
| `fd5e3316` | docs(NEXT): the pointer names `b08d1aa9` and `5a739a94` in commit order — closes the audit's last hole; `tools/pointer-sha-coverage.mjs --base 8b5a19e1` → exit **0** (162 range commits, 84 covered, 0 holes), and `timeout 540 node scripts/test.mjs --all --jobs 4` at this tree → **363/363 in 224.0 s** |
| `fa1c1dda` | docs(NEXT): name `fd5e3316` in commit order so `pointer-sha-coverage --base 8b5a19e1` stays exit 0 (this commit is its exempt carrier). The **store-side sweep** this pointer records is NOT a commit: pm's verb drained the spooled `acknowledge-notices` intent through the broker (`INTENT delivered=1 dead=0 dup=0`), retiring 456 notice ROWS in `selfdev.sqlite` |
| `1fd8134a` | docs close-out: **the sweep RAN** — NEXT.md rewritten to the post-sweep state (live 1656 → 1200, notices 461 → 5), SELFDEV pitfalls 386-388 (keys out of tree, a lease mutates the store, `check` without the rig file changes the band denominator), D315 addendum, ROADMAP 376/379/380 amended in place |
| `6fff4560` | docs(NEXT): restore the literal `**Blocker:**` label that `demo/next-pointer.test.mjs` pins (`/^\*\*Blocker:\*\*/m`, pitfall 389) and name `1fd8134a` in commit order; full suite then measured green **at this tree** — 363/363 in 196.1 s |
| `cc4769ec` | docs(NEXT): the suite tally corrected to the GREEN full run **at `6fff4560`** (363/363 in 196.1 s, artifact PROVENANCE `tree=6fff4560`) — that commit's exempt carrier |
| `8e39f105` | **the census answers the RATE question per DAY (task-1's literal wording)** — `src/queueclass.mjs` `burnRate` returns `perDay {minted, closed, netOpen}` and `tools/queue-pressure.mjs` prints it: ONE derivation, both surfaces; the census line reads `mint 1916 (1153 work, 763 notice) vs close 1197 (770 work, 427 notice) -> net +719 (273.71/d minted, 171/d closed, 102.71/d net): GROWING` (1.82 s); `demo/queue-pressure.test.mjs` 8.0 s PASS, `--area rig` 98/98 in 25.2 s, `--area check` 18/18 in 35.8 s |
| `0b9e4e5e` | **the `queue-pressure` finding now QUOTES the fleet ledger's own verdict (task-7's literal clause)** — `src/fleetledger.mjs` is the ONE derivation of `rows closed / open rows / GROWING` over the JSONL `tools/broker-keepalive.mjs:272` appends: `tools/backlog-burn.mjs` prints `v.verdictLine`, `src/checkup.mjs` quotes it verbatim with its window plus the stale-window caveat, and `demo/queue-pressure.test.mjs` pushes the SAME fixture text through both and asserts the sentences are EQUAL (the #5047 pair-of-spellings defect in prose form); `auditRig` stays fs-free — `cli.mjs`'s `check` verb does the bounded read (newest 4 MiB, truncation reported) and hands it as data; full suite 363/363 in 193.7 s exit 0 |
| `28fa2c5f` | docs close-out: NEXT.md gains the rows that closed the coverage hole (`cc4769ec`, `8e39f105`, `0b9e4e5e`) so `tools/pointer-sha-coverage.mjs --base 8b5a19e1` exits **0** (170 range commits, 0 holes — this commit is its exempt carrier); ROADMAP 380 amended with the quote clause, SELFDEV pitfalls 390/391, D315 addendum 3; full suite re-measured **363/363 in 201.6 s exit 0** at this tree (`.spike/suite-final-28fa2c5f.out`, PROVENANCE `tree=28fa2c5f`) |

**Broker windows.** A window is a LEASE leased from OUTSIDE: `--max-duration` is checked only at the top of the
broker loop (`src/broker.mjs:2058`), so a pass in flight starves it. Open a window as `nohup timeout --signal=TERM
--kill-after=60 <N> node cli.mjs serve --max-duration 3600 &`, then `node cli.mjs resume` before closing. Liveness
is the last ` PASS ` line (pitfall 304), never the pid. **The broker was DOWN for this window** —
`node tools/broker-serve.mjs --status` says so; the fleet's paused/unpaused state must be re-read, not assumed.

**Host for every number here** (measured with the measurement): **Linux**, Fedora Linux 45 (Forty Five), kernel
`7.2.15-300.fc45.x86_64`, node **v24.22.1**, git 2.56.0 — probe: `uname -s && uname -r && (. /etc/os-release &&
echo "$PRETTY_NAME") && node -v && git --version`.

## NEXT SESSION

**Current item:** the **queue-backlog tranche is shipped, gated, AND the sweep has run** — all eight goal tasks are
contract-satisfied (D315; ROADMAP **376** notices-are-not-work, **377** the census split, **378** the mint fan-out budget,
**379** registrations → ledger + `registration-as-work`, **380** the `queue-pressure` gate, `tools/queue-pressure.mjs` and the `src/fleetledger.mjs` seam that makes the finding QUOTE the tool's verdict,
task-4's broker-window re-measure below). `cli.mjs check rig.selfdev.json --json` now exits **1** with **2 errors**:
**`queue-pressure`** (1024 open work vs a band of 120, over by 904, net +718/7 d) and **`pool-dead-gate`** (#7660 queued
in the POOL, requires docs, no seat advertises it), plus **`registration-as-work`** at `fix-now` on **16** ids:
#6700 #6759 #6879 #6906 #6913 #6992 #7014 #7031 #7039 #7051 #7258 #7282 #7311 #7645 #7703 #7739 (was 17 — the broker
window claimed one, which is exactly what the rule exists to catch). **That is the queue the next session acts on.**

**Run these first** (measured on this box 2026-11-15; re-measure rather than trust):

```bash
cd /home/chexxor/Git/Durian-Pi
DURIG_DB=./selfdev.sqlite node tools/queue-pressure.mjs   # 2.1 s, exit 1 — the census, the per-DAY rate, the band verdict, and the plan pm runs
node tools/backlog-burn.mjs                              # 0.05 s, exit 0 — the fleet LEDGER's verdict, the sentence `check` now QUOTES (pitfall 390)
node demo/notice-not-work.test.mjs                        # 0.45 s, exit 0 — notices are not work, the mint gate, the ack plan
node demo/queue-pressure.test.mjs                         # 12.1 s, exit 0 — the gate: inside PASS / out FAIL / growing FAIL / floor
node scripts/test.mjs --area check                        # 37.5 s, 18/18 — the new rule plus doc-count-drift and starter
node scripts/test.mjs --area rig                          # 25.5 s, 98/98
node cli.mjs check rig.selfdev.json --json                # 9 s, exit 1 — 2 errors: queue-pressure + pool-dead-gate; 30 rules
set -a; . "$HOME/.config/durig/env"; set +a               # keys live OUT OF TREE (mode 0600); the rig never sources them
node tools/broker-serve.mjs --status                      # 24 s SOURCED — providers COMPLETE; 0 blocks; broker down
timeout 560 node scripts/test.mjs --all --jobs 4          # see the Suite tally line below
```

**The sweep pm RAN this window** (the delegate spools, the broker's harness writes the transitions — no seat turn is spent;
the store delta was live 1656 → 1200 rows, notices 461 → 5):

```bash
node intent.mjs queue --op queue --action acknowledge-notices --from delegate --apply --confirm   # 456 notices → done with an `acknowledged` transition
node intent.mjs queue --op queue --action registrations                                          # census ONLY (src/queueops.mjs:427 returns changes: [])
```

**IT RAN — and the earlier "the operator must fund the provider" reading was WRONG.** The credentials are already on
this box in `~/.config/durig/env` (mode 0600, dated 2026-11-08, names `DURIG_LOCAL_API_KEY` + `DURIG_VERIFIER_API_KEY`);
the rig never sources it, so an **unsourced** preflight printed 401s and the sweep looked blocked. Sourced (`set -a; . "$HOME/.config/durig/env"; set +a`,
a step in `docs/runbooks/broker-down-or-stalled.md`), the preflight reports **0 blocks**: `local: completes (finish=stop,
prompt=57 tok, completion=29 tok)` and `verifier: answers, advertises 178 model(s)` + `completes (59 in / 48 out)`.
The window then ran: spool `node intent.mjs queue --op queue --action acknowledge-notices --from delegate --apply --confirm`
(0.14 s, `requestId f4cdad9d…`), open the lease `nohup timeout --signal=TERM --kill-after=60 380 node cli.mjs serve --max-duration 300 &`,
confirm liveness on the last ` PASS ` line (`PASS 192 ms=20`), `node cli.mjs resume` before closing. **Never print the key values.**
A broker lease is not free of side effects: it also minted one item branch + one worktree (branches 54 → 55, worktrees 28 → 29)
and left one `[read]` intent pending after `resume` — run the branch/worktree census after any lease (`tools/branch-census.mjs`).

**Suite tally:** 363 members; the GREEN full run is **363/363 in 219.3 s, exit 0** at tree `8bd56720` —
`timeout 560 node scripts/test.mjs --all --jobs 4` (2026-11-15, `.spike/suite-final-c.out`, PROVENANCE line
`tree=8bd56720 … pi-durable=1.5.1`). Slowest there: `demo/runbook-diagnose.test.mjs` 104.5 s. Areas re-measured in
the resumed window: `check` **18/18 in 35.4 s**, two new-rule demos green in it. Do **not** cite the two earlier
full runs at HEAD `93e0044a` as a tally: `.spike/suite-final-20261115.out` was **362/363 in 199.3 s** (the one red
= `demo/restart-limit-behaviour.test.mjs` charging 4 restarts for 5 landed crashes under `--jobs 4` — pitfall 352/377,
a load flake, green standalone and green in every later run) and `.spike/suite-final-20261115b.out` was **360/363 in
191.4 s** (`check`, `doc-count-drift`, `starter` red because the working tree carried the new 30-rule `checkup.mjs`
and the new demos while HEAD/docs still claimed 29 rules and the doc close-out had not landed). A full suite is the
only gate on a doc-count claim; run the file ALONE before calling a suite red a defect. **Re-verified at the final tree
of this window:** `timeout 540 node scripts/test.mjs --all --jobs 4` at `fd5e3316` → **363/363 in 224.0 s, exit 0**
(`.spike/suite-final-fd5e3316.out`, PROVENANCE `tree=fd5e3316`) — the docs close-outs move no test member, so the
member count stays 363 while the wall clock drifts 199 → 219 → 224 s with store load and `--jobs 4`. **Green at the tree
this pointer ships on:** `timeout 520 node scripts/test.mjs --all --jobs 4` at `6fff4560` → **363/363 in 196.1 s, exit 0,
0 `FAILED` lines** (`.spike/suite-final-6fff4560.out`, PROVENANCE `tree=6fff4560`) — that is the full-suite gate the
completion auditor should read, taken after the sweep and after every doc close-out. **Re-verified with the `fleetledger` seam in the tree:** `timeout 520 node scripts/test.mjs --all --jobs 4` at HEAD `8e39f105` (the working tree carried `src/fleetledger.mjs` + the `checkup`/`cli`/`backlog-burn`/demo edits) → **363/363 in 193.7 s, exit 0** (`.spike/suite-quote-all.out`, PROVENANCE `tree=8e39f105`) — the member count stays 363 because no test member was added, only assertions inside existing demos.

**State the team is in:** the tranche is **landed in the shared tree** (`main` = this pointer's own commit, over `0b9e4e5e` (the `fleetledger` seam) over `8e39f105`, `cc4769ec`, `6fff4560` and the six docs close-outs
`b08d1aa9`, `5a739a94`, `fd5e3316`, `fa1c1dda`, `1fd8134a`, `6fff4560` over `8bd56720`, whose 28 explicit paths carry the
tranche; the seam commit `0b9e4e5e` carries 5 explicit paths — `src/fleetledger.mjs`, `src/checkup.mjs`, `cli.mjs`, `tools/backlog-burn.mjs`, `demo/queue-pressure.test.mjs`; nothing pushed) and **the sweep is DONE in the store**: notices 461 → 5 (only the 5 `claimed` remain, deliberately),
171 registrations still parked (`held` 135 / `queued` 16 / `deferred` 17 / `claimed` 3) and 1024 open work rows still out of band. Row owners: none claimed by the delegate — queue transitions are pm's verbs (AGENTS.md).

**Blocker:** none for the sweep — it ran (pitfall 386: the credentials were already on-box in `~/.config/durig/env`, the rig never sources them, and an **unsourced** preflight is what made it look blocked). The residual is a **TRUE band failure**, not an outage: `node tools/backlog-burn.mjs` (0.049 s, exit 0) reads the fleet LEDGER whose newest snapshot is dated **2026-11-13T22:13:03.207Z** and prints `390 rows closed, +166 open rows in the window -> backlog GROWING` over a 2,258-min window, while the store-wide rate is **+719 over 7 d** — the `queue-pressure` finding now prints BOTH, the ledger one inside quotes with its window and `newest snapshot 2,116 min before this measurement: the ledger stops being appended while the broker is down` (pitfall 390: the gap is an outage of the LEDGER, not of the fleet). Re-measure with `DURIG_DB=./selfdev.sqlite node tools/queue-pressure.mjs` (2.2 s, exit 1) rather than quote either; pitfall 383.

**Operator decisions owed.** (a) The three numbers: burst 100, band 10/seat, window 7 d — knobs in `src/config.mjs`
(`DURIG_MINT_BURST_CAP` / `DURIG_BAND_PER_SEAT` / `DURIG_PRESSURE_WINDOW_DAYS`), not a code change; with 1024 open work
rows the gate is loud by design, and the LINEAGE rule would have refused ~38 % of live parentless work rows until the
fleet is back inside the band. (b) Whether the 16 `queued` registrations should be HELD or written into `docs/ROADMAP.md`
pass-by-pass — the queue has no verb for it (`registrations` is census-only), so it is a seat/docs task, and pm owns routing.
(c) Whether a STOPPED-but-rostered seat's queued notices may be acknowledged (paused is excluded, stopped is not).
(d) The broker lease this window woke the fleet for 5 minutes and let pm route — that wake was the delegate driving the
operator's ratified goal; a longer or unbounded lease is the operator's grant to hold.

**The rate question, in 2.2 s:** `docs/runbooks/session-start-cost.md` §29 — census (`tools/queue-pressure.mjs`, per-DAY rate) then ledger (`tools/backlog-burn.mjs`), and `cli.mjs check` prints both, the ledger one inside quotes with its window and the staleness caveat.

**Known red:** `node demo/offline.mjs` exits 1 (`ASSERT FAIL: the fresh context should be short, got 7 messages`) —
recorded, not touched by this tranche.

Full history of this pointer, verbatim: [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md)


