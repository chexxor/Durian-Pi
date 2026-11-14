**Last update:** 2026-11-14 (delegate, landing-integrity tranche). Every shipped commit in this window is a ROW
below, **in commit order** — enforced by `node tools/pointer-sha-coverage.mjs --base 8b5a19e1` (0.4 s, exit 0/1),
not by eye. The ONE exempt commit is the one carrying this file. Rows for the earlier part of the milestone are
VERBATIM in [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md). Nothing pushed — the push grant is the operator's.

**Milestone this window worked** — **closing the landing-integrity gap (ROADMAP 371, 368, 373, the 374 residual,
and 375)** — the third tranche of the branch catch-up that closes the self-merge milestone (D265, landing rule
D314): the by-id `claim_work` gate now refuses what the gate rule forbids, a malformed org edge refuses instead
of throwing, the worktree audit prints both lock numbers named, `branch-prune` takes its allowlist from the
ledger rather than a typed regex, and the suite gate no longer goes red on a calendar. Refs **99 + `main` → 53 + `main`**, worktrees **40 → 28**: 46 refs deleted and 12 trees
released with **0 `--force`, 0 `-D`, 0 failures**, `main` unmoved, nothing pushed. Each delete was gated live on
`git merge-base --is-ancestor <ref> refs/heads/main` exit 0, or — for the 26 `landing-20261114-*` chain snapshots the
operator ruled dead — on a thin bundle that `git bundle verify` accepted first (26 bundles, 26 verified,
3,196,997 bytes, `.spike/quarantine-20261114/bundles/`). Catch-up tally, **re-measured after the retire pass at
`18e378d2`**: `node tools/self-merge-sla.mjs --json --strict` (2.6 s, exit 0) counts **53 refs besides `main` — 25
landed, 25 conflicted, 3 gate-refused, stale 0, ledger coverage 28/28, `gate_refused_proven: 3`,
`gate_refused_unproven: []`**. The census returns **prune plan (0), unaccounted refs (0), needs-a-landing-decision
(0)** in 4.0 s. `node tools/merge-containment-proof.mjs --branch refs/heads/main --refs <all 36, comma-separated>` exits **1** with `refs: 36, refs_with_loss: 23` (2.0 s) — exit 1 is the correct verdict for a set that still has unlanded content; only an all-ancestor subset exits 0. Every ref whose `git merge-tree` exits 0 has been run through `scripts/land.mjs --changed-suite` at this HEAD; the verbatim refusals are in `docs/DISPOSITIONS.md` and `docs/evidence/2026-11-14-landing-attempts/verdicts.md`. **Conflicted-set census at `47e221cf`** (`node tools/conflict-hunk-shape.mjs --brief --json`, 3.4 s): 49 conflicted refs = **21 semantic, 19 mechanical, 9 wording-only**; replaying the 27 rule-shaped ones with `node tools/ref-recut.mjs --refs <27>` (14.1 s, exit 1) gives **3 clean** (all three already in `main` — `item-6373-recut-r2`, `item-6664-recut`, and the `landing-20261114-c3` replay whose tree is byte-identical to `main`'s) and **24 needing a human**; no conflicted ref can be merged by rule into content `main` does not already have. *(That census predates the
retire pass: the 26 `landing-20261114-*` entries it counted are now deleted, and the SLA at `18e378d2` reports 25
conflicted + 3 gate-refused = 28 non-ancestor refs.)* Suite at this HEAD: `node scripts/test.mjs --all --jobs 4` → **358/358 in 192.1 s**.
Every commit in `8b5a19e1..HEAD`, oldest first:

| sha | shipped |
|---|---|
| `d29cdd7b` | merge: land landing-20261114-c11 onto main |
| `f764023e` | doc-integrity-guard (#6335): the env-name exempti... |
| `b90395a8` | restart-limit-seam demo: derive the settings spre... |
| `e5fd5e34` | scripts/land.mjs: resolve suite entries by their ... |
| `6e054eb9` | demo/runbook-diagnose: derive the 'CI cannot exec... |
| `560eccac` | demo/runbook-diagnose: the derived 'CI cannot exe... |
| `945cd805` | merge: land landing-20261114-b2b onto main |
| `026ab5f6` | docs(DECISIONS): disambiguate the four colliding ... |
| `c2008de7` | feat(tools): the re-cut instruments — ref-recut (... |
| `4b52ecc8` | tools(ref-recut, conflict-blocks): --refresh re-c... |
| `2e06ff55` | merge: land item-6343-recut onto main |
| `f9cce597` | merge: land item-6374-recut onto main |
| `1870e4be` | merge: land item-6435-recut onto main |
| `155ad010` | merge: land item-6664-recut onto main |
| `1751a3c2` | merge: land item-7090-recut onto main |
| `9ddf8c4c` | absorb refs/heads/item-5002: its added lines are ... |
| `42983b07` | absorb refs/heads/item-6177: its added lines are ... |
| `c600a2a9` | absorb refs/heads/item-6268: its added lines are ... |
| `199ebd70` | absorb refs/heads/item-6314: its added lines are ... |
| `b055d6a4` | absorb refs/heads/item-6326: its added lines are ... |
| `1f90d7e8` | absorb refs/heads/item-6336: its added lines are ... |
| `25a082f9` | absorb refs/heads/item-6562: its added lines are ... |
| `9a7ac64b` | absorb refs/heads/item-6643: its added lines are ... |
| `a9b0d007` | absorb refs/heads/item-7158: its added lines are ... |
| `af86fefe` | docs+tools: close the branch catch-up — absorb-re... |
| `1872bc25` | docs(NEXT): the conflict pass is closed out — 19 ... |
| `4ad4c38e` | docs(NEXT): add the five commit rows this window ... |
| `dba822b1` | docs(NEXT): register the nine absorption commits ... |
| `5a18d70f` | docs(NEXT): register the remaining commit rows fo... |
| `c8cf55ab` | feat(self-merge): seats land their own item workt... |
| `a67d4cf8` | self-merge SLA: relative fixture dates in the dem... |
| `83a3b8ed` | self-merge: the seat verb proven end to end, the D314 ruling, the pointer re-cut |
| `219cb687` | skill(driving-durian-pi): name the seat self-merge verbs and their measured cost |
| `1a31a79a` | docs(DECISIONS): close the D271/D272 duplicate-heading collision — 299 entries, 0 collisions |
| `f5dc28be` | instruments: four instrument-side failures fixed on contact (depplane rig seam, branch-census exit-code handling, restart-limit fixture, channel-preflight config) |
| `df256ae0` | docs(SELFDEV): pitfalls 349-354 — a non-zero audit exit is a verdict, a rig is not a config, a demo must not assert the live rig's exit code |
| `5b1daea5` | docs(NEXT): register the instrument-repair commit row — `pointer-sha-coverage --base 8b5a19e1` exits 0 |
| `ea857be9` | demo(restart-limit-behaviour): a 40-deep scripted-response stack — one response per crash drained on retries, so the streak never reached the limit; suite 357/357 |
| `c608e5b4` | fix(land.mjs): the gate's environment carries the landing repo's armed extensions; report `gateRig{extensions,source}` — pinned in `demo/land-helper.test.mjs` §10 (8.6 s), pitfall 355 |
| `07e0e76f` | merge: land `item-1` onto main — the FIRST seat self-landing its own item (`land_my_item`, derived gate 26/357, containment 0 loss) |
| `c7f2a4d5` | docs(ROADMAP): rows 368 (`assertSendAllowed` TypeError on an Edges link with no `maySendTo`) and 369 (the bare-scratch gate, shipped in `c608e5b4`) |
| `3deb580d` | docs(NEXT): the live seat-landing proof, the gate-rig trap, and this window's rows (pointer churn squashed) |
| `10ca88ee` | docs(SELFDEV) pitfall 356 + docs(NEXT) row in order — the commit that carried this file at the time, now named because it is no longer HEAD |
| `b968b166` | docs: the D314 live seat-landing addendum, SELFDEV pitfall 357 (the local provider now needs a credential), the final suite tally, and the `wip/seat-prompt-files` KEEP-HELD correction |
| `aa5c4284` | tools(pointer-sha-coverage): read `docs/NEXT-ARCHIVE.md` so a range past the pointer cut closes (ROADMAP 370, pitfall 358), pinned by the tool's own test |
| `90dd5ff2` | merge: land `item-7448-recut` onto main — derived gate green, containment 0 lost lines |
| `04b92e94` | merge: land `item-6344-recut` onto main — derived gate 47/358 green |
| `211075e9` | absorb `refs/heads/item-6343` — 182 added lines already verbatim in main, 0 lost, tree unchanged |
| `78eb0c01` | absorb `refs/heads/item-6435` — 46 added lines, 0 lost, tree unchanged |
| `a804f250` | absorb `refs/heads/item-7090` — 41 added lines, 0 lost, tree unchanged |
| `9c5eaf05` | recut `item-6373` onto main with conflict blocks unioned by rule (R1–R6) — the branch later lands as `item-6373-recut-r2` |
| `a707a047` | docs(catch-up): DISPOSITIONS "Landing attempts" with the verbatim gate refusals; ROADMAP 371 (by-id claim gate); SELFDEV pitfall 359 (a containment-proof exit code describes the SET, not a verdict); NEXT tally corrected |
| `469ed339` | rule-merge `item-6373-recut` onto main — rerere resolution, `tools/recut-resolve.mjs` 0 files needing a human, containment proof 0 lost lines |
| `a9bc766f` | merge: land `item-6373-recut-r2` onto main — derived gate 48/358 green; `item-6373` and `item-6373-recut` are both ancestors now |
| `9de0bcc3` | tools(self-merge-sla): `gate-refused` / `scratch-chain` verdicts + `ledger_coverage`/`undocumented` + `--strict`, pinned by `demo/self-merge-sla.test.mjs` §5; `docs/evidence/2026-11-14-landing-attempts/verdicts.md` holds the verbatim refusals |
| `d9928edb` | docs+config close-out: the NEXT tally at `a9bc766f` (141/195 landed, 5 gate-refused, coverage 54/54) plus the `item-6373` rule-merge rows; `durig.config.example.json` arms `extensions/self-merge.mjs` as the team default (the base ships none) |
| `9e3e2588` | instruments: a `gate-refused` verdict must quote the lander's exit code (`attempt_logged`, `gate_refused_proven`, `--strict`), pinned by `demo/self-merge-sla.test.mjs` §5; `demo/checkup-citation.test.mjs` fixture made deterministic — suite **358/358 in 200.6 s**, SELFDEV pitfalls 360-361 |
| `47e221cf` | docs(catch-up): name the `9e3e2588` and `d9928edb` commits so the pointer audit closes; `verdicts.md` re-measured (5 rule-mergeable refs, all gate-refused, `item-3747-recut-r2` attempted); SELFDEV pitfall 362 (a reaped scratch dir blocks a landing before the gate runs) |
| `a23961dc` | docs(catch-up): the conflicted-set census at `47e221cf` (49 = 21 semantic / 19 mechanical / 9 wording-only; 27 rule-shaped re-cuts → 3 clean, 24 need a human), the 24 zero-commit recut aliases named, SELFDEV pitfall 363, and the `47e221cf` pointer row |
| `969b9774` | the prune carrier as pushed: `tools/branch-prune.mjs` + `demo/branch-prune.test.mjs`, the branch-and-worktree skill, the runbook step 0a, the R-B addendum — refs 219 → 99, worktrees 155 → 94, `main` unmoved, nothing forced, nothing pushed by the delegate |
| `18e378d2` | docs+tools: correct the worktree-audit `locked` count (20 git-locked trees vs the audit's keep-reason bucket of 3), re-verify `tools/process-leak-scan.mjs`, register ROADMAP 373, and name the worktree floor 155 → 94 → 40 |
| `e9a96b6f` | branch/worktree retire pass: `branch-prune` gains `--retire-merged`/`--retire-unmerged`/`--active-within`/`--bundle-dir`/`--quarantine`/`--unlock-locked`, 46 refs and 12 trees retired (refs 99+`main` → 53+`main`, worktrees 40 → 28), 0 forced, 0 failures |
| `965ab7c5` | **ROADMAP 371** — `claim_work`'s `itemId` door calls the SAME `workable()` predicate `selectNextWork` uses: a named claim on an open/cancelled/held gate is refused with the hop named, an id naming no row is `UNKNOWN_ITEM`, a named claim never claims a different row; `demo/by-id-claim-gate.test.mjs` 12 red checks → 0 in 0.31 s, pinned in the rig area |
| `0ecd56e8` | DISPOSITIONS: re-attempt rows for `item-7232-recut` / `item-3570-recut` / `item-3747-recut-r2` at `965ab7c5`, each with the verbatim lander refusal |
| `e1c66bfc` | **ROADMAP 368** — `assertSendAllowed` refuses a malformed Edges link (no `maySendTo`) instead of throwing a `TypeError`; `edgeProblems()` is the ONE predicate the write side (`cli.mjs up`) and the gate share; `cli.mjs up` validates edges BEFORE any write; `demo/edge-fail-closed.test.mjs` 24 checks, 0.78 s |
| `796ac233` | **ROADMAP 373** — the audit prints `lockedTrees` (17) and `lockedKept` (0) both named plus a lockNote; `auditSummary()` in `src/broker.mjs` is the single derivation; `branch-census` carries both; `docs/runbooks/branch-cleanup.md` step 5 corrected in place |
| `fc4e3730` | **ROADMAP 374 residual** — `branch-prune --retire-ruled` reads `docs/DISPOSITIONS.md` verdicts (last row wins, specificity-matched) instead of a typed regex; bundle-verify guard unchanged; `demo/branch-prune.test.mjs` §15 |
| `2dfce088` | **ROADMAP 375** — `selectWakes` takes a named `now`; the human-defer-lease demo drives a fixture clock and pins the seam (same row, two clocks, two verdicts) — the suite was red on a calendar, not a defect |
| `1f1a881c` | **ROADMAP 375** — the restart-limit crash fixture dies AT the observation, not one await after it: 10 standalone runs 2 red → 10 runs 0 red (14 s wall); full suite 361/361 in 192.3 s |

**Broker windows.** A window is a LEASE leased from OUTSIDE: `--max-duration` is checked only at the top of the
broker loop (`src/broker.mjs:2058`), so a pass in flight starves it. Open a window as `nohup timeout --signal=TERM
--kill-after=60 <N> node cli.mjs serve --max-duration 3600 &`, then `node cli.mjs resume` before closing. Liveness
is the last ` PASS ` line (pitfall 304), never the pid. **The broker was DOWN for this window** —
`node tools/broker-serve.mjs --status` says so; the fleet's paused/unpaused state must be re-read, not assumed.

**Host for every number here** (measured with the measurement): **Linux**, Fedora Linux 45 (Forty Five), kernel
`7.2.15-300.fc45.x86_64`, node **v24.22.1**, git 2.56.0 — probe: `uname -s && uname -r && (. /etc/os-release &&
echo "$PRETTY_NAME") && node -v && git --version`.

## NEXT SESSION

**Current item:** the seat **self-merge seam is shipped and gated** (D314). `extensions/self-merge.mjs` gives a
seat `landing_health` + `land_my_item`, and `cli.mjs check` runs `ready-ref-stale` (severity `error` → exit 1).
Armed in the gitignored `durig.config.json`: `DURIG_EXTENSIONS: "extensions/continuity.mjs, extensions/self-merge.mjs"`.
Run `docs/runbooks/land.md` §"Seat self-merge (the default)" for the commands and their measured costs.

**State after the 2026-11-14 landing-integrity pass** (goal `mwgw93nx-jg40zf`, tip `1f1a881c` at measurement, `main`
moved only by the four shipped commits, nothing pushed): **53 refs + `main`, 28 worktrees** (99 + `main` / 40 at
the window start; 155 before the earlier prune). Prune plan **0**, unaccounted refs **0**, needs-a-landing-decision
**0**, audit `total 28, clean true, reapable 0, lockedTrees 17, lockedKept 0` in 2.0 s. What is left is the floor,
not clutter: **28** refs still are not ancestors of `main` — **26 conflicted** and **2 gate-refused** — and each
needs a seat re-cut, not a delete (R-B #3270); **4** are held by **uncommitted tracked work in their own tree**
(`item-6057`, `item-6375`, `item-6377`, `item-7188`); **21** are structural (seat roots, live queue rows, and
`seatroot/linux`, whose tree lives outside this repo). The 28 worktrees are 9 seat roots, 12 live item trees, 17
git-locked (only 0 of them kept *because* of the lock), 4 dirty, 3 non-item (`durian-dev/seatroot`,
`.spike/ins-6101` — the re-cut pass with its conflict markers still uncommitted — and `item-7290/.scratch-7290`).
No git verb can release any of them without losing someone's work. **Read the audit's entries, not its counts:**
17 trees carry a git lock while `counts.locked` is the *keep-reason bucket*, because `classifyWorktrees` classifies
each tree once, `live → locked → not-terminal → dirty → reapable` (`src/broker.mjs:1356-1360`) — pitfall 368, now
printed as two named numbers (ROADMAP 373). **ROADMAP 371 is implemented**, so the by-id claim gate is no longer
the blocker: `item-7232-recut` is dispositioned **NOTHING-TO-LAND** (its demo blob is byte-identical to `main`'s,
`4d4010564e9bf5bfeee8fde770e09f26c89d44ee`), and `item-3570-recut` and `item-3747-recut-r2` are **KEEP-HELD** with
the verbatim refusals in `docs/DISPOSITIONS.md` — 3570 needs `blockedBy` on the `revise_work` schema plus an area
mapping; 3747 needs a human re-cut (its R5-BOTH merge put two `check` rule counts, 28 and 24, into
`docs/WORKFLOWS.md` and `doc-count-drift` fires).

**Run these first** (measured on this box; re-measure rather than trust):

```bash
cd /home/chexxor/Git/Durian-Pi
DURIG_DB=./selfdev.sqlite node tools/self-merge-sla.mjs --json --strict # 4.6 s, 53 refs — 25 landed, 26 conflicted,
                                                                      # 2 gate-refused (both proven), stale 0, coverage 28/28, exit 0
node tools/branch-census.mjs --db ./selfdev.sqlite                      # 4.0 s, exit 0 — 53 refs / 28 worktrees, prune plan 0
node cli.mjs worktree audit --json                                      # 2.0 s — lockedTrees 17, lockedKept 0, counts.locked named
node tools/branch-prune.mjs --retire-ruled --dry-run --db ./selfdev.sqlite
                                                                      # 1.3 s, exit 1 — reads 250 ledger rows / 251 refs ruled, plans
                                                                      # 1 (item-7232-recut, NOTHING-TO-LAND), skips it: no --bundle-dir.
                                                                      # Give it --bundle-dir .spike/quarantine-<date>/bundles to delete it
node tools/branch-prune.mjs --dry-run --db ./selfdev.sqlite             # 9.2 s, exit 0, planned 0 — the census + the safe delete loop
node tools/branch-prune.mjs --reap-worktrees --dry-run                  # 1.9 s, exit 0 — 0 trees the audit calls reapable
node tools/branch-prune.mjs --retire-merged --retire-unmerged '^landing-<yyyymmdd>' \
  --bundle-dir .spike/quarantine-<date>/bundles --quarantine .spike/quarantine-<date> --unlock-locked --dry-run
                                                                      # 4.4 s — the retire verb; the executed pass took 26.0 s, 46 refs,
                                                                      # 12 trees, 0 forced, 0 failures, exit 0
node tools/process-leak-scan.mjs --strict                                # 1.9 s, exit 0 today — 0 orphans (15 found, 594 MB on 2026-11-14); add --kill
node demo/branch-prune.test.mjs                                         # 0.68 s — the prune gate, on a git fixture, §15 covers --retire-ruled
node demo/by-id-claim-gate.test.mjs                                     # 0.31 s — ROADMAP 371, the by-id claim door, 0 failed checks
node demo/edge-fail-closed.test.mjs                                     # 0.78 s — ROADMAP 368, a malformed org edge refuses, never throws
node demo/human-defer-lease.test.mjs                                    # 0.13 s — ROADMAP 375, the wake census reads the caller's clock
node cli.mjs check rig.selfdev.json --json                              # 14.3 s — MUST name the rig; ready-ref-stale is a row
node demo/self-merge-seat.test.mjs                                      # 0.94 s — the seat verb, end to end, no model
timeout 120 node scripts/test.mjs --area worktree                       # 9.9 s, 28/28
timeout 320 node scripts/test.mjs --area docs                           # 82.0 s, 8/8 (runbook-diagnose is 82.0 s of it)
timeout 320 node scripts/test.mjs --all --jobs 4                        # ~214 s
node tools/pointer-sha-coverage.mjs --base 8b5a19e1                     # 0.4 s — exit 1 if this file skips a shipped sha;
                                                                      # it now also reads docs/NEXT-ARCHIVE.md (ROADMAP 370):
node tools/pointer-sha-coverage.mjs --base 03bdbf4d                     # 0.4 s — exit 0, 379 commits, 43+140 rows
```

**Suite tally:** `node scripts/test.mjs --all --jobs 4` → **361/361 in 192.3 s, exit 0** at `1f1a881c` (host below).
The two reds that preceded it were both instrument defects, not fleet defects, and both are now closed
(ROADMAP **375**): `demo/human-defer-lease.test.mjs` went red because `selectWakes` read the **wall** clock while
the fixture asserted a named one — red 2 days after shipping with no code change, exit 1 in 0.145 s; and
`demo/restart-limit-behaviour.test.mjs` failed **2 of 10 standalone runs** (it planted 5 crashes, charged 4, and
asserted a limit on a run that had already settled) because the simulated host died one await after the
observation. After the fixes: human-defer-lease exit 0 in 0.126 s; restart-limit **10 runs, 0 red, 14 s wall**.
Standing rule: classify a suite red by running the file alone **10 times** before believing it
(`for i in $(seq 10); do node demo/<file>.test.mjs || echo red; done`, ~15 s for this file). Slowest this run:
`runbook-diagnose` 87.1 s, `starter` 27.4 s, `clockin-digest` 23.6 s, `cli` 16.8 s, `broker-wakepath` 16.8 s —
`runbook-diagnose` alone is 45 % of the suite's wall clock; a bounded subset of it is the next thing worth
measuring. Host: Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0.
Areas instead of the whole suite: `--area rig` **97/97 in 27.6 s** (one red before the clock fix, 0 after),
`--area worktree` **28/28 in 8.8 s**, `--area docs` **8/8 in 87.8 s**.

**The gate-rig trap now fixed (pitfall 355).** The gate runs in a detached scratch worktree, and
`durig.config.json` is gitignored, so the scratch armed ZERO extensions: `cli.mjs check rig.selfdev.json --json`
lists 29 rules in the root and 28 in a fresh worktree (`ready-ref-stale` missing). That refused a seat's
`land_my_item` twice on a docs-only, merge-clean branch. `scripts/land.mjs` now passes the landing repo's
`DURIG_EXTENSIONS` to every gate child and reports `gateRig: {extensions, source}`.

**Blocker:** three things, in order. (1) **Live fleet proof DONE on a scratch rig, not on the production fleet.**
The two-seat proof rig (`.spike/fleet-proof/rig.proof.json`, store `.spike/fleet-proof/proof.sqlite`, seats on
`local/qwen3.8-flash-next-q2_0`, declared $0) landed its own item in ~40 s of wall clock (broker wake 13:46:26Z →
merge `07e0e76f` 13:47:08Z). The production 12-seat fleet is still NOT woken: the broker is down and `--start`
refuses without the operator's `--yes-pm-wakes` grant. (1b) **Every seat run needs the local model credential in
the broker's environment**: `127.0.0.1:8080` now answers 401 to the rig's loopback placeholder; start with
`node --env-file="$HOME/.config/durig/env" cli.mjs serve` (`docs/runbooks/local-provider-down.md` Do 0). A broker
started without it wakes seats that die in ~3 ms with `provider_auth`. (2) **17 refs still need a seat's semantic judgement** (rows in `docs/DISPOSITIONS.md`, verbatim hunk in
`docs/evidence/2026-11-14-recut-residue/`). After the retire pass the arithmetic is smaller and clean: **28** refs
are not ancestors of `main` — **26 conflicted**, **2 gate-refused**, ledger coverage **28/28**, `stale: 0`, both
refusals proven (`gate_refused_unproven: []`). The
26 `landing-20261114-*` chain snapshots that inflated that count are gone (bundled first, see the retire-pass row
in `docs/DISPOSITIONS.md`). `wip/seat-prompt-files` now carries a dated **KEEP-HELD** row in `docs/DISPOSITIONS.md`
(2026-11-14): the merge is provably lossy (`merge-containment-proof` exit 1 — 41 lines of `cli.mjs` and 6 of
`prompts/impl.md` vanish), so the ref is kept; the next move is the author folding the two wordings into one commit,
then `node tools/chain-resolve.mjs --branch <landing> --refs wip/seat-prompt-files`. (3) **`cli.mjs check` on this rig exits 1** — re-measured at `1f1a881c` (14.3 s): 198 findings, severity counts
`{fix-now: 197, error: 1}`; the one `error` is `pool-dead-gate` #7660. `store-missing-seat` is declared in
`src/checkup.mjs:76` but does not fire as an error today, and the claim that this makes `demo/depplane.test.mjs`
red is **now false** — it passes (`node demo/depplane.test.mjs` → `PASS depplane: 0 failing assertion(s)`, exit 0).
(4) `item-3570`'s recut is blocked by a real defect: the harness rejects `revise_work` with
`blockedBy: unknown field` although `src/rig.mjs` lists it (probe `node .spike/probe-3570.mjs`, path verified with
`test -e`).

**Three things not to re-derive:** (a) an R5 union of two evolutionary versions of the *same* statement is a
regression, not a merge — always land with `--changed-suite` (pitfall 347); (b) a demo with absolute dates is a
time bomb — build fixtures relative to `Date.now()` (pitfall 348); (c) "can any branch be cleaned up?" is a 9 s
question — `node tools/branch-prune.mjs --dry-run --db ./selfdev.sqlite` — not a hand-loop over `git branch -d`
(pitfall 364); and a ref that only *conflicts* with `main` is never in that plan (pitfall 370). (d) **a suite red
is a hypothesis until the file has run 10 times alone** — two of this window's three "flakes" were fixture bugs
(ROADMAP 375, pitfalls 376-377), not fleet bugs, and each cost a turn to bisect.

**Operator decisions owed.** (a) Grant (or refuse) waking the fleet for the live seat proof. (b) `item-6373`
vendor pin 1.3.0 → 1.5.1 is a grant decision. (c) Whether the rig mints a *union-import* rule rather than a
side-picking rule for the seven wording-only refs. (d) Pool options in
`docs/reviews/2026-11-13-capability-ownership-ruling.md`.

**Known red:** `node demo/offline.mjs` exits 1 (`ASSERT FAIL: the fresh context should be short, got 7 messages`)
— recorded, not touched. `demo/depplane.test.mjs` red for the rig-state reason above.

Full history of this pointer, verbatim: [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md)
