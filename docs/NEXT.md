**Last update:** 2026-11-14 (delegate). Every shipped commit in this window is a ROW below, **in commit order** —
enforced by `node tools/pointer-sha-coverage.mjs --base 8b5a19e1` (0.3-0.6 s, exit 0/1), not by eye. The ONE exempt
commit is the one carrying this file (the restart-limit fixture fix ships in it). Rows for the earlier part of the milestone are VERBATIM in
[docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md). Nothing pushed — the push grant is the operator's.

**Milestone this window worked** — **making self-merging the team default (the work-item lifecycle, D265; the
landing rule now D314)**, on top of the branch catch-up it closed: 36 conflicted refs dispositioned, no ref deleted,
nothing pushed — and the seat-landing mechanism **proved on a live fleet**: seat `impl` ran `land_my_item` on its
own branch and advanced local main (`item-1` `0470697b` → merge `07e0e76f`, derived gate 26/357, containment
`refs_with_loss: 0`, `git merge-base --is-ancestor` exit 0). Catch-up tally, **re-measured after the 2026-11-14 prune at HEAD `a23961dc`**: `node tools/self-merge-sla.mjs --json --strict` (7.6 s, exit 0) counts **99 refs besides `main` — 45 landed, 49 conflicted, 5 gate-refused, stale 0, ledger coverage 54/54, `gate_refused_proven: 5` / `gate_refused_unproven: []`**. (Before the prune the same command at `9e3e2588` said 195 refs — 141 landed; the difference is 120 refs that were provably ancestors of `main`, removed by `tools/branch-prune.mjs`; refs 219 → 99, worktrees 155 → 94 (branch prune) → **40** (the reap pass + 32 released `.spike` scratch trees),
`main` unmoved, nothing forced, nothing pushed.) The census now returns **prune plan (0), unaccounted refs (0), needs-a-landing-decision (0)** in 7.7 s. `node tools/merge-containment-proof.mjs --branch refs/heads/main --refs <all 36, comma-separated>` exits **1** with `refs: 36, refs_with_loss: 23` (2.0 s) — exit 1 is the correct verdict for a set that still has unlanded content; only an all-ancestor subset exits 0. Every ref whose `git merge-tree` exits 0 has been run through `scripts/land.mjs --changed-suite` at this HEAD; the verbatim refusals are in `docs/DISPOSITIONS.md` and `docs/evidence/2026-11-14-landing-attempts/verdicts.md`. **Conflicted-set census at `47e221cf`** (`node tools/conflict-hunk-shape.mjs --brief --json`, 3.4 s): 49 conflicted refs = **21 semantic, 19 mechanical, 9 wording-only**; replaying the 27 rule-shaped ones with `node tools/ref-recut.mjs --refs <27>` (14.1 s, exit 1) gives **3 clean** (all three already in `main` — `item-6373-recut-r2`, `item-6664-recut`, and the `landing-20261114-c3` replay whose tree is byte-identical to `main`'s) and **24 needing a human**; no conflicted ref can be merged by rule into content `main` does not already have. Suite at this HEAD: `node scripts/test.mjs --all --jobs 4` → **358/358 in 192.1 s**.
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

**State after the 2026-11-14 prune pass** (commit `7fbb8b72`, `main` unmoved by the prune itself, nothing pushed):
**99 refs + `main`, 40 worktrees** (155 at window start); prune plan **0**, unaccounted refs **0**, needs-a-landing-decision
**0**, audit `reapable: 0`. What is
left is not clutter — the census's 99 kept refs are **35 conflicted**, **22 ruled KEEP in `docs/DISPOSITIONS.md`**,
**25 dirty with uncommitted tracked work**, **8 seat roots**, **6 attached to a live queue row**, **3 terminal items
locked mid-run** (the 26 `landing-20261114-*` chain snapshots are inside the conflicted/ruled sets; none is an
ancestor of `main`).
The 40 remaining worktrees are the floor: 9 seat roots, 12 live item trees, 3 locked, 13 dirty, 3 non-item
(`durian-dev/seatroot`, `.spike/ins-6101` — the re-cut pass with its conflict markers still uncommitted — and
`item-7290/.scratch-7290`). No git verb can release any of them without losing someone's work. **Read the audit's
entries, not its counts:** `git worktree list | grep -c locked` = **20** trees carry a git lock (all 20 have an empty
reason file), and the audit's per-entry `locked` sees all 20 — its `locked: 3` is the *keep-reason bucket* (terminal
items deadlocked behind a lock), because `classifyWorktrees` classifies each tree once, `live → locked → not-terminal
→ dirty → reapable` (`src/broker.mjs:1356-1360`). The 5 `gate-refused` refs
(`item-7232-recut`, `landing-20261114-b3a`, `landing-20261114-c2`, `item-3747-recut`, `item-3570-recut`) are held by
one missing implementation — **ROADMAP 371**, the by-id `claim_work` gate in `src/rig.mjs` — not by a merge conflict.

**Run these first** (measured on this box; re-measure rather than trust):

```bash
cd /home/chexxor/Git/Durian-Pi
DURIG_DB=./selfdev.sqlite node tools/self-merge-sla.mjs --json --strict # 7.6 s, 99 refs — 45 landed, 49 conflicted,
                                                                      # 5 gate-refused (all proven), stale 0, exit 0 (HEAD 6e091445)
node tools/branch-census.mjs --db ./selfdev.sqlite                      # 7.7 s, exit 0 — 99 refs / 40 worktrees, prune plan 0
node tools/branch-prune.mjs --dry-run --db ./selfdev.sqlite             # 8.4 s, exit 0 — the census + the safe delete loop
node tools/branch-prune.mjs --reap-worktrees --dry-run                  # 1.4 s, exit 0 — the trees the audit calls reapable
node tools/process-leak-scan.mjs --strict                                # 1.0 s, exit 1 if orphans exist — reparented
                                                                      # test runners + fixture brokers (15 found, 594 MB, 2026-11-14); add --kill
node demo/branch-prune.test.mjs                                         # 0.21 s — the prune gate, on a git fixture
node cli.mjs check rig.selfdev.json --json                              # 14.3 s — MUST name the rig; ready-ref-stale is a row
node demo/self-merge-seat.test.mjs                                      # 0.94 s — the seat verb, end to end, no model
timeout 120 node scripts/test.mjs --area worktree                       # 8.6 s, 28/28
timeout 320 node scripts/test.mjs --all --jobs 4                        # ~214 s
node tools/pointer-sha-coverage.mjs --base 8b5a19e1                     # 0.4 s — exit 1 if this file skips a shipped sha;
                                                                      # it now also reads docs/NEXT-ARCHIVE.md (ROADMAP 370):
node tools/pointer-sha-coverage.mjs --base 03bdbf4d                     # 0.4 s — exit 0, 379 commits, 43+140 rows
```

**Suite tally:** `node scripts/test.mjs --all --jobs 4` → **359/359 in 192.3 s** at `a23961dc`, and **358/359 in
192.4 s** at this window's tip (the commit carrying this file) — the one red was `demo/restart-limit-behaviour.test.mjs`, which **passes
in isolation** (`node demo/restart-limit-behaviour.test.mjs`, exit 0, 0.6 s) and **passes in its own area**
(`--area rig` 95/95 in 25.2 s, `--jobs 4`). Treat it as a contention flake under a 359-test parallel run, not a
regression: re-measure it in its area before believing a full-suite red for it. Slowest: `runbook-diagnose` 92.7 s, `starter` 51.9 s,
`check-pool-gate` 21.0 s, `clockin-digest` 20.0 s, `broker-wakepath` 16.3 s. Host: Linux, Fedora Linux 45
(Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0. Areas instead of the whole suite:
`--area worktree` **28/28 in 8.6 s**, `--area check` 16/16 in 73.4 s, `--area toolchain` 41/41 in 36.0 s. The one red at the previous HEAD,
`demo/restart-limit-behaviour.test.mjs`, is fixed (one scripted response per crash is not enough — a restart
consumes another, so the run settled `done` and the streak never reached the limit).

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
`docs/evidence/2026-11-14-recut-residue/`); **49** refs report `conflicted` in the SLA census after the prune —
that is wider than the 35 the census calls conflicted because it includes the 26 `landing-20261114-*` scratch-chain
refs (none an ancestor of `main`) and refs never in the census. `wip/seat-prompt-files` now carries a dated **KEEP-HELD** row in `docs/DISPOSITIONS.md`
(2026-11-14): the merge is provably lossy (`merge-containment-proof` exit 1 — 41 lines of `cli.mjs` and 6 of
`prompts/impl.md` vanish), so the ref is kept; the next move is the author folding the two wordings into one commit,
then `node tools/chain-resolve.mjs --branch <landing> --refs wip/seat-prompt-files`. (3) **`cli.mjs check` on this rig exits 1 for two pre-existing error findings**
(`store-missing-seat`, `pool-dead-gate` #7660) — that is why `demo/depplane.test.mjs` is red at this HEAD; it is
not the new rule. (4) `item-3570`'s recut is blocked by a real defect: the harness rejects `revise_work` with
`blockedBy: unknown field` although `src/rig.mjs` lists it (probe `node .spike/probe-3570.mjs`).

**Three things not to re-derive:** (a) an R5 union of two evolutionary versions of the *same* statement is a
regression, not a merge — always land with `--changed-suite` (pitfall 347); (b) a demo with absolute dates is a
time bomb — build fixtures relative to `Date.now()` (pitfall 348); (c) "can any branch be cleaned up?" is an 8 s
question — `node tools/branch-prune.mjs --dry-run --db ./selfdev.sqlite` — not a hand-loop over `git branch -d`
(pitfall 364).

**Operator decisions owed.** (a) Grant (or refuse) waking the fleet for the live seat proof. (b) `item-6373`
vendor pin 1.3.0 → 1.5.1 is a grant decision. (c) Whether the rig mints a *union-import* rule rather than a
side-picking rule for the seven wording-only refs. (d) Pool options in
`docs/reviews/2026-11-13-capability-ownership-ruling.md`.

**Known red:** `node demo/offline.mjs` exits 1 (`ASSERT FAIL: the fresh context should be short, got 7 messages`)
— recorded, not touched. `demo/depplane.test.mjs` red for the rig-state reason above.

Full history of this pointer, verbatim: [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md)
