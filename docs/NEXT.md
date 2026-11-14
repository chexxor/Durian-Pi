**Last update:** 2026-11-14 (delegate, landing-integrity tranche). Every shipped commit in this window is a ROW
below, **in commit order** — enforced by `node tools/pointer-sha-coverage.mjs --base 8b5a19e1` (0.4 s, exit 0/1),
not by eye. The ONE exempt commit is the one carrying this file. Rows for the earlier part of the milestone are
VERBATIM in [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md). Nothing pushed — the push grant is the operator's.

**Milestone this window worked** — **closing the landing-integrity gap (ROADMAP 371, 368, 373, the 374 residual, 375)** — the third tranche of the branch catch-up that closes the self-merge milestone (D265, landing rule D314). Four gates now hold: the by-id `claim_work` door consults the gate rule, a malformed org edge refuses instead of throwing, the worktree audit prints both lock numbers named, and `branch-prune` takes its allowlist from the ledger instead of a typed regex. Two suite-gate defects found on the way (ROADMAP 375) are closed: the wake census now reads the clock the caller supplies, and the crash fixture dies at the instant it observes a running task.
Earlier tranches of this milestone — the prune carrier, the 46-ref/12-tree retire pass (refs 99+`main` → 53+`main`, worktrees 40 → 28, 0 forced), the conflicted-set census and the absorption rows — are VERBATIM in docs/NEXT-ARCHIVE.md, and `node tools/pointer-sha-coverage.mjs --base 8b5a19e1` (0.4 s) reads both files, so no shipped sha is un-named.
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
| `80a87fca` | docs(NEXT): the `3a8bce52` row, so the pointer audit closes on the carrier |

**Broker windows.** A window is a LEASE leased from OUTSIDE: `--max-duration` is checked only at the top of the
broker loop (`src/broker.mjs:2058`), so a pass in flight starves it. Open a window as `nohup timeout --signal=TERM
--kill-after=60 <N> node cli.mjs serve --max-duration 3600 &`, then `node cli.mjs resume` before closing. Liveness
is the last ` PASS ` line (pitfall 304), never the pid. **The broker was DOWN for this window** —
`node tools/broker-serve.mjs --status` says so; the fleet's paused/unpaused state must be re-read, not assumed.

**Host for every number here** (measured with the measurement): **Linux**, Fedora Linux 45 (Forty Five), kernel
`7.2.15-300.fc45.x86_64`, node **v24.22.1**, git 2.56.0 — probe: `uname -s && uname -r && (. /etc/os-release &&
echo "$PRETTY_NAME") && node -v && git --version`.

## NEXT SESSION

**Current item:** the seat **self-merge seam is shipped and gated** (D314), and the **landing-integrity tranche is
closed** (ROADMAP 371, 368, 373, the 374 residual, 375). `extensions/self-merge.mjs` gives a seat `landing_health`
+ `land_my_item`; `cli.mjs check` runs `ready-ref-stale` (severity `error`). Armed in the gitignored
`durig.config.json`: `DURIG_EXTENSIONS: "extensions/continuity.mjs, extensions/self-merge.mjs"`. Commands and their
measured costs: `docs/runbooks/land.md` §"Seat self-merge (the default)".

**State** (measured at this tip; nothing pushed — the push grant is the operator's): **53 refs + `main`, 28
worktrees**; audit `total 28, clean, reapable 0, lockedTrees 17, lockedKept 0` (2.0 s). **28** refs are not
ancestors of `main`: **26 conflicted**, **2 gate-refused** (both proven, `gate_refused_unproven: []`), ledger
coverage **28/28**, `stale: 0`. `item-7232-recut` is **NOTHING-TO-LAND** — its demo blob
`4d4010564e9bf5bfeee8fde770e09f26c89d44ee` is byte-identical to `main`'s; `item-3570-recut` and `item-3747-recut-r2`
are **KEEP-HELD** with the verbatim refusals in `docs/DISPOSITIONS.md` (3570 needs `blockedBy` on the `revise_work`
schema plus an area mapping; 3747 needs a human re-cut — its R5-BOTH merge put `check` counts 28 and 24 into
`docs/WORKFLOWS.md` and `doc-count-drift` fires). 4 refs hold uncommitted tracked work (`item-6057`, `item-6375`,
`item-6377`, `item-7188`); 21 are structural. No git verb releases any of them without losing work. Pitfall 368 in
one line: `lockedTrees` (17) and `counts.locked` (0) answer different questions — read the audit's entries
(ROADMAP 373).

**Run these first** (measured on this box; re-measure rather than trust):

```bash
cd /home/chexxor/Git/Durian-Pi
DURIG_DB=./selfdev.sqlite node tools/self-merge-sla.mjs --json --strict    # 4.6 s, exit 0 — 25 landed / 26 conflicted / 2 gate-refused
node tools/branch-census.mjs --db ./selfdev.sqlite                          # 4.0 s, exit 0 — 53 refs / 28 worktrees, plan 0
node cli.mjs worktree audit --json                                          # 2.0 s — lockedTrees 17, lockedKept 0, both named
node tools/branch-prune.mjs --retire-ruled --dry-run --db ./selfdev.sqlite  # 1.3 s, exit 1 — plans item-7232-recut, skips it: no --bundle-dir
node demo/by-id-claim-gate.test.mjs                                         # 0.31 s — ROADMAP 371, the by-id claim door
node demo/edge-fail-closed.test.mjs                                         # 0.78 s — ROADMAP 368, a bad org edge refuses, never throws
node demo/branch-prune.test.mjs                                             # 0.68 s — §15 pins --retire-ruled
node tools/pointer-sha-coverage.mjs --base 8b5a19e1                         # 0.4 s — exit 1 if this file skips a shipped sha
timeout 320 node scripts/test.mjs --all --jobs 4                            # 192 s, 361/361
node cli.mjs check rig.selfdev.json --json                                  # 14.3 s, exit 1 — one error finding: pool-dead-gate #7660
```

**Suite tally:** **361/361 in 192.3 s, exit 0**. The two reds before it were instrument defects, not fleet defects,
and both are closed (ROADMAP **375**): `demo/human-defer-lease.test.mjs` read the wall clock while the fixture
asserted a named one (red two days after shipping, exit 1 in 0.145 s), and
`demo/restart-limit-behaviour.test.mjs` charged 4 restarts for 5 landed crashes because the simulated host died one
await after the observation — **2 of 10 standalone runs** red, 0 of 10 after the fix (14 s wall). Rule: a suite red
is a hypothesis until the file has run 10 times alone (~15 s). Slowest: `runbook-diagnose` 87.1 s = 45 % of the
suite. Areas: `--area rig` **97/97 in 27.6 s**, `--area worktree` **28/28 in 8.8 s**, `--area docs` **8/8 in 87.8 s**.
Host for every number: Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0.
**Blocker:** four things, in order. (1) **The production 12-seat fleet is not woken** — the broker is down and
`--start` refuses without the operator's `--yes-pm-wakes` grant. The seat self-merge was proven end to end on a
two-seat scratch rig (`.spike/fleet-proof/`, seats on `local/qwen3.8-flash-next-q2_0`, declared $0): wake to merge in
~40 s. (1b) **Every seat run needs the local model credential in the broker environment** — `127.0.0.1:8080` answers
401 to the loopback placeholder; start with `node --env-file="$HOME/.config/durig/env" cli.mjs serve`
(`docs/runbooks/local-provider-down.md` Do 0). (2) **17 refs still need a seat's semantic judgement** — rows in
`docs/DISPOSITIONS.md`, verbatim hunks in `docs/evidence/2026-11-14-recut-residue/`. (3) `cli.mjs check` exits 1 on
one `error` finding, `pool-dead-gate` #7660 (198 findings, `{fix-now: 197, error: 1}`, 14.3 s); the older claim that
this makes `demo/depplane.test.mjs` red is **false** — it passes, exit 0. (4) `item-3570`'s recut is blocked by a
real defect: the harness rejects `revise_work` with `blockedBy: unknown field` although `src/rig.mjs` lists it
(probe `node .spike/probe-3570.mjs`).

**Not to re-derive.** (a) An R5 union of two evolutionary versions of the *same* statement is a regression — always
land with `--changed-suite` (pitfall 347). (b) A fixture with absolute dates is a time bomb (pitfall 348; ROADMAP
375 is that trap arriving twice in one window). (c) "Can any branch be cleaned up?" is a 9 s
`node tools/branch-prune.mjs --dry-run --db ./selfdev.sqlite`, not a hand-loop (pitfall 364), and a ref that only
*conflicts* with `main` is never in that plan (pitfall 370).

**Operator decisions owed.** (a) Grant or refuse waking the fleet for the live seat proof. (b) `item-6373` vendor pin
1.3.0 → 1.5.1 is a grant decision. (c) Whether to retire `item-7232-recut` for real:
`node tools/branch-prune.mjs --retire-ruled --bundle-dir .spike/quarantine-<date>/bundles` — bundle-verified,
`git update-ref -d`, never `-D`. (d) Pool options in `docs/reviews/2026-11-13-capability-ownership-ruling.md`.

**Known red:** `node demo/offline.mjs` exits 1 (`ASSERT FAIL: the fresh context should be short, got 7 messages`) —
recorded, not touched.

Full history of this pointer, verbatim: [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md)

