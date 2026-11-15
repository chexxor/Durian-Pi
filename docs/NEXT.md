**Last update:** 2026-11-15 (delegate, queue-backlog tranche — the pointer is the carrier commit for this window; every EARLIER shipped commit in this range is a row below, **in commit order**, enforced by `node tools/pointer-sha-coverage.mjs --base 8b5a19e1` (1.3 s, exit 0/1), not by eye). Nothing pushed — the push grant is the operator's.

**Milestone this window worked** — **making the queue backlog manageable and measurable (D315, ROADMAP 376-380, goal mwh73rd1-izyq72)**: protocol notices stopped being claimable work and are acknowledged mechanically, the view names work / notice / registration / awaiting-operator instead of one number, the mint path has a fan-out budget (duplicate + burst 100 + lineage), ROADMAP registrations are parked and ruled, and "the backlog is growing" is now a `check` rule that FAILS. The bulk retire of the 461 notices and 171 registrations is **pm's verb and has not run** — the broker is down and both providers refuse inference.
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

**Broker windows.** A window is a LEASE leased from OUTSIDE: `--max-duration` is checked only at the top of the
broker loop (`src/broker.mjs:2058`), so a pass in flight starves it. Open a window as `nohup timeout --signal=TERM
--kill-after=60 <N> node cli.mjs serve --max-duration 3600 &`, then `node cli.mjs resume` before closing. Liveness
is the last ` PASS ` line (pitfall 304), never the pid. **The broker was DOWN for this window** —
`node tools/broker-serve.mjs --status` says so; the fleet's paused/unpaused state must be re-read, not assumed.

**Host for every number here** (measured with the measurement): **Linux**, Fedora Linux 45 (Forty Five), kernel
`7.2.15-300.fc45.x86_64`, node **v24.22.1**, git 2.56.0 — probe: `uname -s && uname -r && (. /etc/os-release &&
echo "$PRETTY_NAME") && node -v && git --version`.

## NEXT SESSION

**Current item:** the **queue-backlog tranche is shipped and gated** (D315; ROADMAP **376** notices-are-not-work,
**377** the census split, **378** the mint fan-out budget, **379** registrations → ledger + `registration-as-work`,
**380** the `queue-pressure` gate and `tools/queue-pressure.mjs`). Goal `mwh73rd1-izyq72`, tasks 1,2,3,5,6,7,8 in;
**task-4 (the bulk retire executed by pm) is the outstanding one** — the plan is printed, the transition is not.
`cli.mjs check` now exits **1** with two named findings: `queue-pressure` (severity `error`) and `registration-as-work`
(17 ids: #3503, #6700, #6759, #6879, #6906, #6913, #6992, #7014, #7031, #7039, #7051, #7258, #7282, #7311, #7645,
#7703, #7739) — that is the queue id the next session acts on.

**Run these first** (measured on this box 2026-11-15; re-measure rather than trust):

```bash
cd /home/chexxor/Git/Durian-Pi
DURIG_DB=./selfdev.sqlite node tools/queue-pressure.mjs   # 2.2 s, exit 1 — the census, the band verdict, and the plan pm runs
node demo/notice-not-work.test.mjs                        # 0.45 s, exit 0 — notices are not work, the mint gate, the ack plan
node demo/queue-pressure.test.mjs                         # 12.1 s, exit 0 — the gate: inside PASS / out FAIL / growing FAIL / floor
node scripts/test.mjs --area check                        # 37.5 s, 18/18 — the new rule plus doc-count-drift and starter
node scripts/test.mjs --area rig                          # 25.5 s, 98/98
node cli.mjs check rig.selfdev.json --json                # 14 s, exit 1 — queue-pressure + registration-as-work now in the 30 rules
node tools/broker-serve.mjs --status                      # 3 s — broker DOWN; provider-local/verifier REFUSE inference (401)
timeout 560 node scripts/test.mjs --all --jobs 4          # see the Suite tally line below
```

**The sweep pm must run** (the delegate composes it, the broker applies it — `intent.mjs` spools a request file,
the broker's own harness writes the transitions, no seat turn is spent):

```bash
node intent.mjs queue --op queue --action acknowledge-notices --from delegate --apply --confirm   # 461 notices → done with an `acknowledged` transition
node intent.mjs queue --op queue --action registrations                                          # census only: the 171 ledger copies sitting in the queue
```

It CANNOT run yet: `node tools/broker-serve.mjs --status` → `broker: down (no broker state)` and BLOCKs
`provider-local-refuses-inference` (127.0.0.1:8080 answers 401 to the loopback placeholder) plus
`provider-verifier-no-key`. A read drain serves only read-only intents, so an `--apply` intent needs a pass.
**Waking the fleet and funding the provider are the operator's grants** — do not start the broker on a provider
that only lists models (`docs/runbooks/broker-down-or-stalled.md`, `docs/runbooks/local-provider-down.md`).

**Suite tally:** 363 members; the last full run before this window's close-out was **363/363 in 192.0 s, exit 0**
(`timeout 560 node scripts/test.mjs --all --jobs 4`, 2026-11-15; the one red in the run before it was
`demo/restart-limit-behaviour.test.mjs` charging 4 restarts for 5 landed crashes under `--jobs 4` — pitfall 352/377,
a load flake, green standalone and green on the next full run; classify a suite red by running the file ALONE first).
Slowest: `demo/runbook-diagnose.test.mjs` 91.2 s. Areas: `check` 18/18 37.5 s, `rig` 98/98 25.5 s, `broker` 83/83 39.8 s,
`readapi` 7/7 7.0 s.

**State the team is in:** the tranche is **landed in the shared tree** (committed on `main`, one commit, 24 paths,
nothing pushed) and **in flight for pm**: 461 queued/live notices and 171 registrations are classified and planned
but un-transitioned; 5 notices are `claimed` and are deliberately left alone (`census.skippedClaimed`). Row owners:
none claimed by the delegate — queue transitions are pm's verbs (AGENTS.md).

**Blocker:** the sweep (task-4) needs a broker window and a provider that answers completions; both credentials are
the operator's. Second, `tools/backlog-burn.mjs` reads the fleet LEDGER whose last snapshot is dated **2026-11-13**,
so its rate (+166 over 2,258 min) is stale while the broker is down — the store-wide rate is +722 over 7 d (pitfall 383).

**Operator decisions owed.** (a) The three numbers: burst 100, band 10/seat, window 7 d — knobs in `src/config.mjs`
(`DURIG_MINT_BURST_CAP` / `DURIG_BAND_PER_SEAT` / `DURIG_PRESSURE_WINDOW_DAYS`), not a code change; the LINEAGE rule
would have refused ~38 % of live parentless work rows (451 of 1,195 name no parent) until the fleet is back inside the
band. (b) Grant the provider credentials / the fleet wake so pm can run the sweep. (c) Whether a STOPPED-but-rostered
seat's queued notices may be acknowledged (paused is excluded, stopped is not).

**Known red:** `node demo/offline.mjs` exits 1 (`ASSERT FAIL: the fresh context should be short, got 7 messages`) —
recorded, not touched by this tranche.

Full history of this pointer, verbatim: [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md)


