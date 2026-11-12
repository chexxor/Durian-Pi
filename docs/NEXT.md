**Last update:** 2026-11-12T18:0xZ (delegate session **N38 cont.** — operator away; directives: **finish the backlog, land every branch, clean up**, then **ratified delegate propose-and-apply** and **"implement that now, yourself, without routing"**). `main` = **`d5dfa83c`** (28 local commits, unpushed). **Still zero seat landings**: refs **147**, worktrees **137**, every `main` commit this window is a delegate commit. Fleet alive: broker pid **1696735** (keepalive pid **1518138**, bounded `--until 2026-11-13T06:00:00Z`), 0 failed generations.

**THE QUEUE-CONTROL SEAM SHIPPED AND WAS USED ON THE LIVE RIG (operator-ratified, delegate-authored).** `src/queueops.mjs` (pure census + plans), spool op `queue` applied by the single writer, `intent.mjs --op queue --action repair-gates|priority|cancel|stranded`, and `check` rule **24 `stranded-gate`** (`35eee1a7`; 310/310 suite, 119.3 s). The defect it fixes was measured, not assumed: `workable()` treats a CANCELLED prerequisite as positive non-workability (lead-ratified #2677), so the dependent can never be claimed and nothing repaired the chain — 151 such rows existed, and the zero-build close had just stranded **#3503/#5885** behind cancelled #3377. Live use (all applied, all attributed `delegate (operator-authorised)`): **census 20 → 0** after a 20-row `repair-gates` apply (`5f42ca87`), 33 landing rows promoted to `now` with a lease to 2026-11-13T23:59Z (`81bfc34c`), taking `priority=now` from 8 to **41**; and a scoped leased **DIRECTIVE** on the control doc (`b31a566c`, surfaced by `c7ff4aab`): `{priority:now, subjectContains:"LANDING", expiresAt:2026-11-13T23:59Z}`, so rows minted after it are still covered — a fan-out puts the newcomer last, the directive puts it first (`demo/priority-directive-scope.test.mjs`). Propose is the default; nothing is written without `--apply`; the broker must RESTART to load a new spool op or projection (pitfall 295). Keepalive fixed the same pass: a transient `START REFUSED: live-tree-dirty` killed the loop at 18:04Z and took the fleet down — refusals are now DEFERRED (`f7ed214f`, pitfall 297).

**Operator rulings (relayed to pm; the delegate routed nothing):** landing is the priority, in the order (a) close the 140 zero-build rows → (b) split #7278 into per-bin rows → (c) land while main is green → (d) prune → (e) 33 conflicting refs by author re-cut → (f) #7273 delta gate; the delegate holds **propose-and-apply** on order and eligibility, **propose-only on structure**; healing before verbs (shipped together, healing first in `src/queueops.mjs`). pm has cancelled **50+/140** and has not yet minted the 10 per-bin rows (bins sent as text 17:03Z — pm has no shell; 17:05Z plan: **10 bins, 72 refs, 137 commits ahead**). **NEW (operator decision 18:5xZ, `d5dfa83c`): a coordinator MEASURES.** `run_readonly` — named read-only entrypoints (landing-plan, drain-audit, branch-census, queue, status, fleet, stranded, `test --area`, read-only `git`), 25 s bound, BLOCKED on timeout, no shell, `scripts/land.mjs` unreachable; a coordinator keeps `read` and still holds no write/edit/shell, and `seatIsCoordinator` (⇒ `release` authority) is unchanged. Verified registered on pm's live tool set (`toolsAdded` includes `run_readonly`); the smoke-test call is still pending — **UNVERIFIED end-to-end**. **Still the operator's call:** 28 commits await the push grant; #7278 is still `queued/now`. **The lifecycle goal is PAUSED** — do not resume it.

**Milestone this window worked** — **a work-item lifecycle the team can run itself** (the goal the operator PAUSED):
seats land their own verified branch into `staging`, the operator promotes `staging` → `main` in one verb, branchless
items never spawn a worktree (`docs/WORK-ITEM-MODEL.md`, rows **#6924–#6927** minted by `pm`). The session's own work
was the tranche pulled out of that goal before the pause: the claim-order policy, D266. The pin move (D255 → D256, ROADMAP 353–357) is the
frame it operates in. Prior window (D262, ROADMAP 314, row #6160) is archived. Still open under it:
the pinned-pi thread (D255 → D256, ROADMAP 353–357: pin `v1.5.1`, `pi-schema` first, the symbol migration, the
`commitstream`/`livewatch` seams) with the three policy calls **#6171/#6172/#6173**, the item-5301 rework
(**#6174**), the superseded WIP disposition (**#6178**), and the auto-clean ceiling (D249, ROADMAP **311** / **344**).

**Host for every number below**, measured with the measurement: **Linux**, Fedora Linux 45 (Forty Five), kernel
`7.2.15-300.fc45.x86_64`, node **v24.22.1**, `git version 2.56.0` — probe:
`uname -s && uname -r && (. /etc/os-release && echo "$PRETTY_NAME") && node -v && git --version`.

## NEXT SESSION

**Current item:** the **paused lifecycle goal on the landing pass** (operator directive 2026-11-12: "Prioritize landing
the branches in the project and cleaning them up"). It does NOT resume until the operator runs `/goal-resume`; the one
change that was pulled out of it landed at `69d4d2cc` (D266, work strategy — `src/workstrategy.mjs`, the `set_priority`
tool, `up` validation/persistence, `ps`/`status` readout); read that before touching claim ordering. Separately, `pm`
routed the paused goal as the work-item lifecycle MVP: **#6924** impl — make
`demo/offline.mjs` green; **#6926** architect — the seams, now minted by pm as **#7055** (confine must deny seats the
blessed refs), **#7056** (bind the gate to the verifier's tip), **#7057** (the promote verb, staging → main),
**#7058** (mint the execution mode on the row). The delegate's landing intent (delivered 05:18:19Z,
`INTENT delivered=1`) carries the 41-ref triage and the three batch commands below.

**Milestone this window worked** — **landing the branch residue (operator directive 2026-11-12, rows #7124/#7126/#7128)**, inside the paused work-item-lifecycle goal. N36 drove the fleet (intent delivered to `pm` 08:01:57Z, `INTENT delivered=1`), kept the broker driving with a new instrument, and measured the gap: **the fleet mints ~4 refs/hour and has landed zero in 3 h**. This session committed no team row and closed no queue item.

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
```

**Broker status:** resident pid **56117** (re-armed **11:48Z**). The fleet went **unattended** at
11:37Z: the old keepalive loop (pids 3912747/3912749) exited 1 after two consecutive `START REFUSED:
broker-degraded` re-arms (11:22Z, 11:37Z) and broker 3912450 died. **Cause:** a loop that breaks at
`--max-duration` never reads the `serve --stop` flag, so the pid lingers and the next `--start` refuses. Fixed in
place in `tools/broker-keepalive.mjs` (**`9655e761`**): stop → poll `brokerProcessAlive(pid)` → SIGTERM only a pid the
state file names **and** whose cmdline matches `cli.mjs serve` → wait ≤20 s → start; pinned by
`demo/broker-keepalive-stop-guard.test.mjs`. Detached loop pid **56057** (`--until 2026-11-13T06:00:00Z`, log
`.spike/keepalive.log`). Read `selfdev.sqlite.broker.json` for the pid — the pid is the identity, not `pgrep`.
**The bound is not a hard bound, and it is now measured, not hypothesised**: a broker whose wake loop broke at
`--max-duration` sets `stoppedBy = "max-duration"` (`src/broker.mjs:1855-1857`) with **no stop request**, so
`graceExpired()` is false and the drain takes the **unbounded** `await h.waitForIdle(context)` (`:2218`; the bounded
leg `:2216 settleWithin(...)` fires only on `deadline`). pid 2876055 sat in that state for **13 h 26 m** while its
heartbeat stayed fresh and the read pump kept answering — `node tools/stranded-inbox.mjs selfdev.sqlite` is the
one-line discriminator (`hbAgeS` / `progressAgeS` / `DRAIN-STRANDED`). Account: `docs/incidents/2026-11-11-parked-broker-strands-a-mutating-intent.md`.
The force timer (`cli.mjs:2247`) arms only in `onSignal`, so `serve --stop` is invisible to a parked broker — four this
window (pids 2066240, 2201485, 2390935, 2658110) lingered 34 min – 1 h 32 m past their bound until `kill -TERM <pid>` fired the fallback (`EXIT reason=deadline passes=-`). Preflight **blocks falsely** on local2: the 20 s probe at `tools/broker-serve.mjs:304` vs a measured **42.8 s cold / 27.2 s warm** 64-token completion — use `--no-probe` (0 blocking) and verify seats generate. Restart recipe: `set -a; . "$HOME/.config/durig/env"; set +a; DURIG_DB=./selfdev.sqlite node tools/broker-serve.mjs --start --no-probe --yes-pm-wakes --max-duration 3600`. Dead-letters in the spool are read and explained in `docs/evidence/2026-11-10-cli-signals/ctrl-c-and-read-bounds.md` §G.

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
