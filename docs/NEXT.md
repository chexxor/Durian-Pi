**Last update:** 2026-11-13T06:3xZ (delegate). `main` = `3f68a8a3`, 11 local commits since `792445d5`, **0 pushed** — a 150-commit push landed at 21:17:02Z from OUTSIDE this session; confirm it was the operator's before treating the push grant as exercised. **Landing is DONE:** `refsNeedingLanding: 1` (`item-6959`, author-blocked), refs 105, worktrees 95. The fleet died 21:17Z, cause fixed (`575a67e8`, D274) — `docs/incidents/2026-11-12-broker-terminal-stop.md` has the death, the recovery, the push and the 5.6 h leak.

**N19 "The Pool" (D275) is SHIPPED, rows 0-8, on `main`** (`a4502733` calibrate → `3f68a8a3` docs): `requires` is a capability SET, `pool: true` mints a row with no recipient, a claimant becomes owner-of-record, a row whose tier estimate exceeds 70 % of the claimer's usable window is refused with a split instruction, `complete_work({split:[…]})` closes a row into children, `status --json`/`queue --human` report the pool census, and `check` fails (exit 1) on pool work nobody can do. Read `docs/POOL-QUEUE-SPEC.md` §12 for the shipped wording. **What is NOT yet measured:** `pool.rows = 0` on this rig — the 12 seats predate the gate and carry no `usableWindow` until the next `up`, and no seat has pooled a row.

**431 rows are parked on the absent operator and lead holds the rubric** (no clock; lead 167 / pm 147; 7 class rulings, not 431 asks) — `.spike/lead-decide-431.md`, delivered 21:29:22Z; still 431 at 21:38Z.


**Operator rulings (relayed to pm; the delegate routed nothing):** landing is the priority, in the order (a) close the 140 zero-build rows → (b) split #7278 into per-bin rows → (c) land while main is green → (d) prune → (e) 33 conflicting refs by author re-cut → (f) #7273 delta gate; the delegate holds **propose-and-apply** on order and eligibility, **propose-only on structure**; healing before verbs (shipped together, healing first in `src/queueops.mjs`). pm has cancelled **50+/140** and has not yet minted the 10 per-bin rows (bins sent as text 17:03Z — pm has no shell; 17:05Z plan: **10 bins, 72 refs, 137 commits ahead**). **NEW (operator decision 18:5xZ, `d5dfa83c`): a coordinator MEASURES.** `run_readonly` — named read-only entrypoints (landing-plan, drain-audit, branch-census, queue, status, fleet, stranded, `test --area`, read-only `git`), 25 s bound, BLOCKED on timeout, no shell, `scripts/land.mjs` unreachable; a coordinator keeps `read` and still holds no write/edit/shell, and `seatIsCoordinator` (⇒ `release` authority) is unchanged. Verified registered on pm's live tool set (`toolsAdded` includes `run_readonly`); the smoke call **PASSED end-to-end** at 19:2xZ — pm's own turn called `run_readonly(name="git", args=["log","--parents","--oneline","-8"])` and got `RUN_READONLY git exit=0` with the history. **pm EXECUTED step (b) at 19:1xZ:** #7278 CANCELLED (superseded), **10 LAND BIN rows minted** (7439–7455: bins 1–4 `now`, 5–10 `next`, each with its verbatim `scripts/land.mjs` command and a report contract) plus **#7457 PRUNE PASS**. Caught in the same pass: the bins are titled "LAND BIN n", which the directive's scope did NOT match, so the rows just prioritised would have sorted behind unrelated `now` work — re-applied with the `LAND BIN` token (`applied 1, matchedNow 343`; claim order `[7439, 7443, chore]`, pitfall 299). **THE STALL IS DECISION DEBT, MEASURED (20:1xZ):** `done` 4,806→4,841 (+35 in 4 h, 1,227 generations, 0 failed) — the team is NOT idle — but **493 rows carried `deferredTo:"human"`** (median age 5 days, oldest 23; 32% of non-terminal) and **84 of them were landing work**. New `release` action (`c502b44a`) un-parked **62 landing rows** (deferredTo cleared, transition `released` with `from:human`); deferred 493→431, queued 789. Remaining: **431 human-parked rows**. **D273 SHIPPED (`66dc1ba6`, `00107a6c`): a park on the operator is a 5-day LEASE** — `defer_work` to human refuses without `resumeBy`, `escalations()` counts lapsed AND legacy no-clock rows (431 today, oldest #4796 at 21.1 d), `selectWakes` wakes **lead** with reason `escalation` once per changed set (verified armed: `SKIP lead reason=pending` — it fires when lead's turn settles), and `check` rule 25 reports the census. 314/314 suite. **LANDED, OPERATOR-GRANTED (21:0xZ): 43 refs across FIVE gated merges** — bin1 12, bin2 12, halfA 6, halfB 5, bin4 8 — each proven by `git merge-base --is-ancestor <ref> main` (exit 0, every ref) and a TWO-PARENT merge on main (HEAD `d35bbe1a` parents=84dac3d5 1343b397). Full gate in every scratch; then **54 refs/worktrees pruned** with the census plan (`worktree remove` + `branch -d`, no force) → refs **156 → 103**, worktrees 147 → **94**. Post-land suite on main: **325/325 in 138.4 s**. TWO REFS ARE BLOCKED and need an AUTHOR re-cut, both mechanical: **item-6959** adds `demo/noop-wake-census.test.mjs` without mapping it in `demo/test-areas.json` (the gate's own partition assertion refuses it), and **item-7232** conflicts on `demo/test-areas.json` (a shared-file list union). One locked worktree (item-5604) needs `git worktree unlock` before it can be pruned. **LANDING TRUTH (20:4xZ, now superseded):** refs **156**, worktrees **147**, and the census verdict for most is `prune: clean, unmerged, item terminal (needs a landing entry first)` — the branches are CONFLICT-FREE and their items are `done`; what is missing is the landing entry, not the content. pm minted the 10 bins; impl has not claimed one. **Still the operator's call:** 148 commits await the push grant (43 landings + the delegate's own work). **The lifecycle goal is PAUSED** — do not resume it.

**Host for every number below**, measured with the measurement: **Linux**, Fedora Linux 45 (Forty Five), kernel
`7.2.15-300.fc45.x86_64`, node **v24.22.1**, `git version 2.56.0` — probe:
`uname -s && uname -r && (. /etc/os-release && echo "$PRETTY_NAME") && node -v && git --version`.

## NEXT SESSION

**Milestone this window worked** — **N19 "The Pool" (D275), rows 0-8 all landed** (`a4502733`, `b454d1ea`, `4b4ac11a`, `a28fe142`, `6eac7919`, `f4cb2c32`, `785f214e`, `6567a568`, `3f68a8a3`): `requires` is a capability SET (AND), a pool row has no recipient until claimed, the size gate refuses a row bigger than 70 % of the claimer's usable window with a split instruction, splits close the parent as `closedAs:"split"`, and the census + two `check` rules make the pool legible. Built by this delegate directly (not through the team), per the operator's instruction.

**Liveness:** the last ` PASS ` line, not the pid or the heartbeat (pitfall 304).

**Current item:** the **paused lifecycle goal on the landing pass** (operator directive 2026-11-12: "Prioritize landing
the branches in the project and cleaning them up"). It does NOT resume until the operator runs `/goal-resume`; the one
change that was pulled out of it landed at `69d4d2cc` (D266, work strategy — `src/workstrategy.mjs`, the `set_priority`
tool, `up` validation/persistence, `ps`/`status` readout); read that before touching claim ordering. Separately, `pm`
routed the paused goal as the work-item lifecycle MVP: **#6924** impl — make
`demo/offline.mjs` green; **#6926** architect — the seams, now minted by pm as **#7055** (confine must deny seats the
blessed refs), **#7056** (bind the gate to the verifier's tip), **#7057** (the promote verb, staging → main),
**#7058** (mint the execution mode on the row). The delegate's landing intent (delivered 05:18:19Z,
`INTENT delivered=1`) carries the 41-ref triage and the three batch commands below.


**Research status:** all three off-host reports landed (`docs/reviews/branch-lifecycle-research.md`,
`branch-lifecycle-followup-research.md`, `branch-lifecycle-llm-agent-teams-research.md`); the round-1 findings
rewrote `docs/WORK-ITEM-MODEL.md` §5/§6.1/§8 and are registered as ROADMAP 358–362 (362 is an explicit rejection).
**Still an operator action:** routing the round-2 prompt `docs/reviews/branch-lifecycle-followup-research-prompt.md`
to the research agent. D265 records the decision.

**Blocker:** three, and the first one is a PAUSE (not a defect): the lifecycle goal waits on `/goal-resume`. (1) **Research is no longer the blocker** — all three off-host reports
landed (`docs/reviews/branch-lifecycle-research.md` 324 lines, `branch-lifecycle-followup-research.md` 139,
`branch-lifecycle-llm-agent-teams-research.md` 35, committed at `ed84f0b4`); **ROADMAP 367** is now an operator ruling
(prefix taxonomy enforced in `src/confine.mjs` vs 362's rejection of a naming linter) and the **bounded per-seat hold
pass** the operator approved has no mechanism row yet. (2) `node demo/offline.mjs` is **exit 1** and `git rev-parse
staging` is **exit 128** — no `staging` branch exists, so "seat lands into staging" cannot be demonstrated yet.
(3) The verifier leg: `DURIG_VERIFIER_API_KEY` spend is capped and `local2` is a shared LAN box whose 20 s preflight
probe false-blocks (measured 42.8 s cold / 27.2 s warm for a 64-token call).

**Run these first, in this order** (every number below was measured on this box; re-measure rather than trust it):

```bash
cd /home/chexxor/Git/Durian-Pi
node tools/landing-batch-plan.mjs --max 12                             # 12.5 s, exit 0 — the 6 verified chains and the exact `scripts/land.mjs` command for each
node tools/branch-census.mjs --plan                                    # exit 0 — WITHOUT --plan the landing list is CAPPED at 15 of 41 (tools/branch-census.mjs:262)
node tools/stranded-inbox.mjs selfdev.sqlite                           # 1 s — is the broker PARKED? hbAgeS vs progressAgeS; then COUNT LIVE: git branch --list | wc -l; git worktree list | wc -l
node tools/backlog-burn.mjs --hours 4                                # 0.03 s, exit 0 — the backlog RATE from the keepalive ledger (no store open)
node tools/process-leak-scan.mjs                                     # 0.04-0.54 s — orphaned test runners + the fixture brokers they spawn; --kill reaps them (docs/runbooks/process-leak-reap.md)
DURIG_DB=./selfdev.sqlite node cli.mjs ps                             # 1.8 s — roster + claim ORDER (workStrategy: team/seat/default, with its source)
node demo/offline.mjs                                                  # exit 1 — the mocked plane is still red
node demo/pool-address.test.mjs                                        # 0.3 s, exit 0 — pool address, claim, owner-of-record, split
node demo/check-pool-gate.test.mjs                                     # 2.5 s, exit 0 — `check` exits 1 on a pool row nobody can claim
DURIG_DB=./selfdev.sqlite node cli.mjs status --json | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.stringify(JSON.parse(s).pool)))'  # 18.4 s — the live pool census
```

**Broker status (measured 2026-11-13T06:3xZ):** NO broker resident - `selfdev.sqlite.broker.json` does not exist,
`node tools/stranded-inbox.mjs selfdev.sqlite` (1 s, exit 0) reports `inbox=0 drainStranded=0 lastExit=2026-11-13T05:57:09Z EXIT pid=3453151 reason=deadline passes=-`.
Restart: `set -a; . "$HOME/.config/durig/env"; set +a; DURIG_DB=./selfdev.sqlite node tools/broker-serve.mjs --start --no-probe --yes-pm-wakes --max-duration 3600` - the 20 s preflight probe false-blocks on local2 (42.8 s cold / 27.2 s warm for a 64-token call). The parked-broker mechanics are in `docs/incidents/2026-11-11-parked-broker-strands-a-mutating-intent.md`.

**What the residue is now** (`cli.mjs worktree audit --json`, re-measured 05:2xZ at `ed84f0b4`): **88 entries** —
seat-root 10, non-item 2, locked 1, **live 3**, **reapable 67**, dirty 5. `git worktree list | wc -l` counts 88
(the audit counts the shared repo too). 60 reapable trees is the residue the lifecycle is meant to stop producing;
row **#6927** is the inventory of the 51 OPEN `docs/DISPOSITIONS.md` rows behind it. Reap recipe (idempotent, never
`--force`): `cli.mjs worktree audit --json > .spike/wt.json`, then remove every entry whose `keepReason` is
`reapable`, then `git worktree prune`.

**Operator decision owed, not a git one:** `.spike/` is **13 GB** of gitignored scratch — 4.2 GB `fix-20261101`,
1.1 GB `fix-20261031`, 1.1 GB `backups`, 814 MB `delegate`, plus four store backups (435 MB, 419 MB, 419 MB, and
`.spike/backups/20261110T0551Z/selfdev.sqlite`). Deleting a store backup is the operator's call; the fix-* scratch
dirs are prior landing passes and can be pruned once their content is confirmed on `main`. Also note **`docs/NEXT.md`
is at 198 of the 200-line cap** (`demo/next-pointer.test.mjs` enforces it on the whole file): before appending, move
a section verbatim to `docs/NEXT-ARCHIVE.md`.

**Open decisions the operator owns:** (a) **item-6063/6064/6066** — the compaction-gate trio was reverted. Either
re-cut it against the 1.5.1 pin and current `main`, or accept the guard and set
`DURIG_COMPACTION_RESERVE_TOKENS=8192`, `DURIG_COMPACTION_KEEP_RECENT=9288`, `DURIG_COMPACTION_BACKGROUND=8192` in
the gitignored `durig.config.json` (the config write is operator-owned — `docs/runbooks/compaction-policy-refused.md`)
and fix `demo/compaction-coherence.test.mjs:77`, which asserts the pin has no `modelOverrides` reader while
`vendor/pi-main/packages/durable/dist/harness/agent.js:145` reads it. (b) **`item-3570`** and **`item-5301`** need a
seat re-cut, not a delegate merge (evidence in `docs/DISPOSITIONS.md` §Pass 2026-11-10). (c) Landing #3570 makes
**D261** false — it says there is no post-mint gate write path; `revise_work` would create one.

**State at clock-out** (measured live 15:3xZ, re-count before trusting): refs **136** / worktrees **126**; census (**~10 s**):
**63** refs need a landing entry, **33** conflict with main, **12** uncommitted; `landing-batch-plan` places **64** refs, 0
unlandable, **119 commits ahead**. `main` = **`4b549e34`** locally, **15 ahead of `origin/main` — NOT pushed** (operator grant).
Queue census **7,282 rows**: 4,792 done / 939 cancelled / 424 held / 524 deferred / 592 queued / 11 claimed; the landing rows
**#7124 `done`, #7126/#7128 `cancelled`**, sweep **#7278 `queued` (priority `now`)** — no branch has landed.

**Hazards the next session must not mistake for green** (all re-measured 00:4xZ against `main` `14ae744a`):
(1) **`item-5301` / `item-5301-resolved` are not landable by a delegate** — `cli.mjs` conflicts, and the branch's own
`demo/worktree-reap.test.mjs` is **red on the merged tree** (run in a scratch: `dry.candidates` is undefined —
`reapWorktrees` returns `reaped/counts/refusedSoleCarrier`, not `candidates`; exit 1). (2) **`item-6101`** conflicts in
`cli.mjs`, `src/rig.mjs` and `demo/test-areas.json`: its hold/release code collides with the now-landed #6112/#6150 —
semantic, needs the author's re-cut. (3) **`item-6330`** conflicts in `demo/runbook-diagnose.test.mjs` by *removing*
entries from the skip list main added — a union would undo landed work. (4) **`item-3570`** and **`item-6162`** conflict
in `docs/runbooks/stale-held-backlog.md`; `item-6162` also in `src/rig.mjs`. (5) `wip/seat-prompt-files` is dispositioned
SUPERSEDED (#6178). Full disposition: evidence doc §H.

## The pinned-pi thread — v1.5.1 LANDED (ROADMAP 353–357)

Pin tag `v1.5.1` = `dd30101cfc5b0609411dd80b6f93adbc14db14cf`; `pi-schema` **first** in the pin's `packages` (the chord
fails `TS2307` otherwise); 10 built packages all 1.5.1. `--check` reports `policyGap: null` and `drift: true / behind 14`
against upstream tip `b2aabe029…` — **a tag pin can never satisfy `drift: false`**, so the contract is mis-specified
(register the fix, do not chase it). The live store still reads `durable_schema = [{singleton:1,version:2}]`: the move
**migrated nothing**. The full landed detail — the symbol migration, the `livewatch`/`commitstream` seams and the
provisional `checkpointWhen` — is VERBATIM in [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md), section "The pinned-pi thread".

**Stop rule that still applies:** `--unlink` is NOT a rollback — the live store is schema v2 and released pi-durable
≤ 1.3.0 cannot open it. Procedure: `docs/runbooks/pi-pin-update.md`; pitfalls **227–236**.

## Exact next command

```bash
cd /home/chexxor/Git/Durian-Pi
node demo/cli-sigint-exits.test.mjs                   # the Ctrl-C proof: 130 within ~130 ms of the signal (4.97 s)
node demo/cooldown-skip-line.test.mjs                 # 0.193 s — the demo the read-drain timer broke; run it 10x, not once
node scripts/test.mjs --all --jobs 4                  # 308/308 in 123.9 s at `4b549e34` (measured 15:3xZ) — main is GREEN, so the gate can be satisfied now
node demo/next-pointer.test.mjs                       # the pointer cap: NEXT.md must stay <= 200 counted lines
node tools/broker-serve.mjs --status                  # broker state; the 61 dead-letters are explained in the evidence doc §G
DURIG_DB=./selfdev.sqlite node cli.mjs status         # must answer in under 10 s, or name the cause and remedy
```

## Current item (priority order)

1. **Land the 64 refs the plan places** (operator directive 2026-11-12): pm's ungated sweep **#7278**, bins from
   `node tools/landing-batch-plan.mjs --max 12`, each pass `node scripts/land.mjs <refs> --suite` (**≈124 s per bin** —
   8 bins ≈ 17 min of suite time). `main` is **green** at `4b549e34` (308/308, 123.9 s), so the absolute gate is satisfiable
   NOW; the delta gate (#7273) is not a prerequisite. Pairwise-clean is NOT a proof a 12-way merge composes — a pass must
   drop the member that conflicts and re-gate.
2. **Re-cut `item-5301`** (**#6174**) — four defects, measured on the merged tree, listed in
   `docs/reviews/pi-1.5.1-delta-review-2026-11-10.md` §8 and pitfall **232**. Do not land until all four close.
3. **Close the install gap** (ROADMAP **352**, rows **#6125/#6127**): nothing at session start runs
   `tools/compaction-guard-install.mjs --check`, so a fresh clone or worktree starts unguarded with no signal.
4. **Resolve the four DIRTY worktrees — the merged refs are gone; this is the residue.** `cli.mjs worktree audit`
   reports `dirty 4`: `item-6057` (2 tracked edits — `scripts/sync-pi.mjs` + `demo/syncpi.test.mjs` adding a
   `--no-repair` flag, **#6060 work that is NOT on `main`** even though `item-6057`'s tip is an ancestor of `main`),
   `item-6290` (23 untracked solo-run logs), `item-6317` (3), `item-6328` (1). All residue is exported to
   `.spike/worktree-residue/` (gitignored, 148 KB). A dirty orphan is refused on purpose — a seat commits it or the
   operator rules it discarded (`docs/runbooks/leaked-worktrees.md` §Do 2). `verify-5180`, `item-5301`,
   `item-5301-resolved`, `item-3570`, `wip/seat-prompt-files` and the reverted `item-6063/6064/6066` stay by ruling
   (ROADMAP 344, `docs/DISPOSITIONS.md` rows) — none of them is held by a worktree any more, so the *only* thing
   keeping them is the ledger.
5. **Promote the probes out of `.spike/`** (**#6176**): `.spike/pin-update/migrate-symbols.mjs`,
   `.spike/pin-update/signature-classify.mjs` (ROADMAP 312), plus the landing-pass probes `.spike/union-resolve.mjs`
   (union-merge where both sides are tail appends — how 6402 landed), `.spike/merge-broker-import.mjs`,
   `.spike/wedge-after.mjs` (forged frozen broker), `.spike/row-status.mjs` — an unpromoted probe is lost.
6. **Broker alive-but-dead** (**#6160**): heartbeat advances, pass clock freezes, every broker-routed read times
   out. The bound is now health-derived (120 s advancing / 10 s degraded, `src/readclient.mjs:40`, `:43`) and reads
   drain on the heartbeat cadence — the follow-up is the exit-path spool accounting, rows **#6391/#6390**.
7. **Ratify or revise M5's eight acceptance criteria** (operator) — `docs/MILESTONES.md` §M5, gate baseline
   **3 PASS, 1 PARTIAL, 4 FAIL** (`docs/evidence/2026-11-09-milestone-m5/gate.mjs`, 1.6 s).

## State the team is in

Fleet awake: 12 seats (11 on `local2/qwen3.8-flash-next-q2_0`, auditor on `verifier/openai/gpt-oss-120b`);
`tools/fleet-health.mjs` (**0.2 s**): 1,539 generations in the last 6 h, 1,533 completed, 0 failed, 6 in flight.
Queue census **7,222 rows** (12:2xZ): 4,765 done / 936 cancelled / 424 held / 524 deferred / 13 claimed / 560 queued.
**Zero seat landings this window** — every `main` commit is a delegate commit; **#7124 claimed**, #7126/#7128 still
queued. **The delegate asserted no row.**

**Blocker (operator grants only):** verifier-leg spend cap + the `local2` shared-box preflight false-block (see the pointer's `**Blocker:**` line). Retry `--dry-run` rather than reconfiguring.

**Unverified:** (1) live TUI streaming is coarser at the new pin because it rides `pi.live`'s throttled partial
commits — plausible, not measured; the probe that would close it is a `latency-budget` run comparing entry cadence
before/after. (2) Whether any rig doc actually needs checkpoints (the `() => false` provisional) is undecided by
design. (3) `item-5301-resolved` exists as a fork with only the syntax fix; it was **not** landed, so its reap verb
is not on `main`.

**Cost:** spend ledger unchanged — **$0.00** this window (every call went to the loopback provider priced 0/0).
Wall clock: the full suite is **47.8 s** (was 61.8 s at the old pin); a merged-tree gate per branch is ~47 s;
`rig-portability-audit` 1,084 ms when the store is readable; the broker preflight ~4 s. **Speed-up worth adopting:** gate every candidate
branch with `node --check cli.mjs` + `git merge-tree --write-tree` before spending a 47 s suite (pitfall **232**),
and never run three full suites concurrently — contention produced two false reds this window (pitfall **235**).

**Traps this window** — `docs/SELFDEV.md` **249–254** (a SIGINT handler that only sets a flag is not a stop —
measure it; an interrupted verb exiting 0 reads as success; `stoppableSleep` must not `unref`; a read-only shim
must implement both vendor orders; the Ctrl-C bound is only as good as the event loop; a red at `--jobs 8` that is
green standalone is the box, not the code). Prior windows: **245–248**, **241–244**, **232–240**.

Full history of this pointer, verbatim: [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md)
