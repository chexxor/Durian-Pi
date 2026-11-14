**Last update:** 2026-11-14 (delegate). Every shipped commit in this window is a ROW below, **in commit order** —
enforced by `node tools/pointer-sha-coverage.mjs --base 8b5a19e1` (0.3-0.6 s, exit 0/1), not by eye. The ONE exempt
commit is the one carrying this file. Rows for the earlier part of the milestone are VERBATIM in
[docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md). Nothing pushed — the push grant is the operator's.

**Milestone this window worked** — **making self-merging the team default (the work-item lifecycle, D265; the
landing rule now D314)**, on top of the branch catch-up it closed: 36 conflicted refs dispositioned, 28 refs made
ancestors of `main` (5 landed through `scripts/land.mjs`, 9 absorbed, 19 proven ancestors), no ref deleted, nothing
pushed. Every commit in `8b5a19e1..HEAD`, oldest first:

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

**Run these first** (measured on this box; re-measure rather than trust):

```bash
cd /home/chexxor/Git/Durian-Pi
DURIG_DB=./selfdev.sqlite node tools/self-merge-sla.mjs --json          # 9.2 s, 197 refs — who is ready, who is stale
node cli.mjs check rig.selfdev.json --json                              # 14.3 s — MUST name the rig; ready-ref-stale is a row
node demo/self-merge-seat.test.mjs                                      # 0.94 s — the seat verb, end to end, no model
timeout 120 node scripts/test.mjs --area worktree                       # 8.9 s, 26/26
timeout 320 node scripts/test.mjs --all --jobs 4                        # ~214 s
node tools/pointer-sha-coverage.mjs --base 8b5a19e1                     # 0.3 s — exit 1 if this file skips a shipped sha
```

**Blocker:** three things, in order. (1) **No live fleet proof yet**: no real seat conversation has run
`land_my_item` on the running rig — the broker is down and waking the fleet is a capacity grant the operator
holds. (2) **17 refs still need a seat's semantic judgement** (rows in `docs/DISPOSITIONS.md`, verbatim hunk in
`docs/evidence/2026-11-14-recut-residue/`); 52 refs report `conflicted` in the SLA census. `wip/seat-prompt-files`
has no DISPOSITIONS row yet. (3) **`cli.mjs check` on this rig exits 1 for two pre-existing error findings**
(`store-missing-seat`, `pool-dead-gate` #7660) — that is why `demo/depplane.test.mjs` is red at this HEAD; it is
not the new rule. (4) `item-3570`'s recut is blocked by a real defect: the harness rejects `revise_work` with
`blockedBy: unknown field` although `src/rig.mjs` lists it (probe `node .spike/probe-3570.mjs`).

**Two things not to re-derive:** (a) an R5 union of two evolutionary versions of the *same* statement is a
regression, not a merge — always land with `--changed-suite` (pitfall 347); (b) a demo with absolute dates is a
time bomb — build fixtures relative to `Date.now()` (pitfall 348).

**Operator decisions owed.** (a) Grant (or refuse) waking the fleet for the live seat proof. (b) `item-6373`
vendor pin 1.3.0 → 1.5.1 is a grant decision. (c) Whether the rig mints a *union-import* rule rather than a
side-picking rule for the seven wording-only refs. (d) Pool options in
`docs/reviews/2026-11-13-capability-ownership-ruling.md`.

**Known red:** `node demo/offline.mjs` exits 1 (`ASSERT FAIL: the fresh context should be short, got 7 messages`)
— recorded, not touched. `demo/depplane.test.mjs` red for the rig-state reason above.

Full history of this pointer, verbatim: [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md)
