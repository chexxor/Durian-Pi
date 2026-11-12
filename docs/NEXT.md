# NEXT.md — current state and next actions

**Last update:** 2026-11-12T06:5xZ (delegate session **N35** — the **work-strategy change implemented by hand**, the one
thing the operator paused the lifecycle goal for: claim order is now a declared policy per team and per seat (**D266**),
with a leased `priority` and a `ps`/`status` readout naming its source). `main` = N35 (code commit **`69d4d2cc`**), suite **303/303** in
**117.0 s** (`--jobs 4`, exit 0), refs **101** / worktrees **91** at 06:2xZ (live: 95/85 at 05:0xZ → 101/91 an hour later).
**The lifecycle goal is PAUSED** — nothing resumed, and the delegate minted/claimed/completed/deferred no row. D266's choices were RATIFIED at this close (see its **Status**). The broker was recycled and **one live claim was observed on the new code BEFORE pushing** (the accepted 1B condition): pid **3387492** (START 06:50:20Z) logged `#6215` by impl, `#7018` by qa, `#7097` by lead at 06:52:46Z and `#6549` by scribe at 06:53:25Z. The four commits are **PUSHED** (`origin/main` = `792aa059`). Two read-surface gaps went to `pm` as ONE `message` intent (`INTENT delivered=1`); `pm` minted **#7113** (devtools) for GAP 1 — the human priority readout on `queue` — and GAP 2's row had not appeared at 06:56Z.

**Milestone this window worked** — **a work-item lifecycle the team can run itself** (the goal the operator PAUSED):
seats land their own verified branch into `staging`, the operator promotes `staging` → `main` in one verb, branchless
items never spawn a worktree (`docs/WORK-ITEM-MODEL.md`, rows **#6924–#6927** minted by `pm`). The session's own work
was the tranche pulled out of that goal before the pause: the claim-order policy, D266. The pin move (D255 → D256, ROADMAP 353–357) is the
frame it operates in. Prior window's milestone — **no 120 s silence, and Ctrl-C actually stops the verb**
(ROADMAP **314**, row **#6160**, decision **D262**) — baseline `e06626af` vs `main`, same 139,264 B store, same forged wedge:
`watch --once --json` went from **120,547 ms / exit 1** (signal ignored for 119 s) to **1,518 ms / exit 130, 15 ms
after the signal** — table in `docs/evidence/2026-11-10-cli-signals/ctrl-c-and-read-bounds.md`. Still open under it:
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

**Milestone this window worked** — the **work-item lifecycle** above (paused mid-way); its residue-cleanup tranche, the branch census, is where N34 stopped. This session added D266 only and left every lifecycle row as the pause found them.

**Research status (changed this session):** round 1 landed — the delegate ran it itself (`node`+`curl`, this host)
into **`docs/reviews/branch-lifecycle-llm-agent-teams.md`**, with every quote re-fetched into `inputs/fetched/` and
sha256/HTTP/last-modified recorded in `inputs/fetched/MANIFEST-branch-lifecycle.md` (14/14 quotes substring-checked
against our copies). It **rewrote** `docs/WORK-ITEM-MODEL.md` §5 (shared `feature-<slug>` branches are contradicted
by prior art → ordered decomposition with hard bounds) and added §6.1 (staging as a queue) and §8's ownership
marker (`git worktree lock --reason rig:<item>`). Registered **ROADMAP 358–362**; 362 is an explicit rejection with
a reason. **Still an operator action:** routing the off-host prompt (and the round-2 prompt
`docs/reviews/branch-lifecycle-followup-research-prompt.md`) to the research agent — GitHub merge-queue internals,
Trunk/Mergify, Devin/Copilot/Sweep/Orbi/Miko/Baton/Code Conductor/Sourcegraph and every product's iteration loop
stay unverified. D265 records the decision.

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
node tools/branch-census.mjs --plan                                    # exit 0 — WITHOUT --plan the landing list is CAPPED at 15 of 41 (tools/branch-census.mjs:262)
node tools/stranded-inbox.mjs selfdev.sqlite                           # 1 s — is the broker PARKED? hbAgeS vs progressAgeS; then COUNT LIVE: git branch --list | wc -l; git worktree list | wc -l
node scripts/test.mjs --all --jobs 4                                 # 303/303 in 117.0 s at the N35 tip, exit 0
DURIG_DB=./selfdev.sqlite node cli.mjs ps                             # 1.8 s — roster + claim ORDER (workStrategy: team/seat/default, with its source)
node demo/offline.mjs                                                  # exit 1 — the mocked plane is still red
```

**Broker status:** resident pid **2997720** (`--no-probe --max-duration 3600 --yes-pm-wakes`, started 05:17:5xZ;
`INTENT delivered=1 dead=0 dup=0` at 05:18:19Z, `PASS 3 ms=64`). Read `selfdev.sqlite.broker.json` for the pid — the
pid is the identity, not `pgrep`.
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
is at 199 of the 200 counted lines** (`demo/next-pointer.test.mjs` enforces the cap): before appending anything, move
a section verbatim to `docs/NEXT-ARCHIVE.md`.

**Open decisions the operator owns:** (a) **item-6063/6064/6066** — the compaction-gate trio was reverted. Either
re-cut it against the 1.5.1 pin and current `main`, or accept the guard and set
`DURIG_COMPACTION_RESERVE_TOKENS=8192`, `DURIG_COMPACTION_KEEP_RECENT=9288`, `DURIG_COMPACTION_BACKGROUND=8192` in
the gitignored `durig.config.json` (the config write is operator-owned — `docs/runbooks/compaction-policy-refused.md`)
and fix `demo/compaction-coherence.test.mjs:77`, which asserts the pin has no `modelOverrides` reader while
`vendor/pi-main/packages/durable/dist/harness/agent.js:145` reads it. (b) **`item-3570`** and **`item-5301`** need a
seat re-cut, not a delegate merge (evidence in `docs/DISPOSITIONS.md` §Pass 2026-11-10). (c) Landing #3570 makes
**D261** false — it says there is no post-mint gate write path; `revise_work` would create one.

**State at clock-out** (measured live, re-count before trusting): refs **101**, worktrees **91**, `main` = `origin/main` = **`792aa059`** (pushed), queue census **7,101 rows** (4,711 done / 933 cancelled / 427 held / 524 deferred / 11 claimed / 495 queued). Broker pid **3387492** runs THIS code (`START` 06:50:20Z, `PASS 3` onward), so `status --json --no-notes` answers in **2.3 s** with `workStrategy` from the health payload — the extra round-trip the old broker forced is gone.

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
node scripts/test.mjs --all --jobs 4                  # 299/299 in 115.0 s at `14ae744a`
node demo/next-pointer.test.mjs                       # the pointer cap: NEXT.md must stay <= 200 counted lines
node tools/broker-serve.mjs --status                  # broker state; the 61 dead-letters are explained in the evidence doc §G
DURIG_DB=./selfdev.sqlite node cli.mjs status         # must answer in under 10 s, or name the cause and remedy
```

## Current item (priority order)

1. **Land the 41 refs** (operator directive 2026-11-12): three pairwise-clean batches, commands in
   `.spike/landing-batch-plan.json`; each pass is `node scripts/land.mjs <refs> --suite`. Pairwise-clean is NOT a
   proof a 28-way merge composes — a pass must drop the member that conflicts and re-gate.
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

Fleet awake: 12 seats (11 on `local2/qwen3.8-flash-next-q2_0`, auditor on `verifier/openai/gpt-oss-120b`). Queue
census **6,423 rows** measured 2026-11-10T19:0xZ with no broker resident: 4,365 done, 901 cancelled, 542 deferred,
435 held, 176 queued, 4 claimed. pm minted **#6171–#6178** from the delegate intent (`requestId b0488417-b203-4df7-83dd-077406980a9f`,
`delivered: true`); other seats minted their own rows this window (#6163–#6170). **The delegate asserted no row.**
Six branches landed (`item-1779`, `item-2915`, `item-3041`, `item-6067`, `item-6082`, `item-6121` + the
`item-6082-mig` fork); two are deliberately not landed and are named with reasons above.

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
