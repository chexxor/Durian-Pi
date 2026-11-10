# NEXT.md — current state and next actions

**Last update:** 2026-11-10T18:3xZ (delegate session **N26** — the **branch-landing pass**: **68 of 82 refs are now
ancestors of `main`**, 8 merged+free refs pruned, the three compaction-gate landings **reverted** because they took
the whole CLI down, and `main` is proven **289/289 green in 117.7 s** (`.spike/suite-final.out`). refs **82**, worktrees
**75** (measured at clock-out with `git branch --format='%(refname:short)' | wc -l` and `git worktree list | wc -l`);
**count it live, do not trust this number** — the fleet mints refs while you measure. Nothing was pushed; the
delegate claimed, completed or deferred no row.)

**Milestone this window worked** — **landing the pinned pi (D255 → D256, ROADMAP 353–357)**. D255 staged the move;
this window executed it: pin → tag `v1.5.1`, `pi-schema` first in `packages`, the symbol migration in our source,
the two seams (`src/commitstream.mjs`, `src/livewatch.mjs`), the per-demo attribution in
`docs/reviews/pi-1.5.1-delta-review-2026-11-10.md` §8, and the landing pass. What is **not** closed: the three
policy calls (rows **#6171/#6172/#6173**), the item-5301 rework (**#6174**), the superseded WIP disposition
(**#6178**), and the 13 held worktrees. The other open thread, the auto-clean ceiling (D249, ROADMAP **311** cut 2 /
**344**), is still spooled and now has a named defect row, **#6174**.

**Host for every number below**, measured with the measurement: **Linux**, Fedora Linux 45 (Forty Five), kernel
`7.2.15-300.fc45.x86_64`, node **v24.22.1**, `git version 2.56.0` — probe:
`uname -s && uname -r && (. /etc/os-release && echo "$PRETTY_NAME") && node -v && git --version`.

## NEXT SESSION

**Milestone this window worked** — **landing the accumulated branches and pruning them (the branch-cleanup pass, `docs/runbooks/branch-cleanup.md`)**, with the pin move (D256) still the frame it operates in.

**Run these first, in this order:**

```bash
cd /home/chexxor/Git/Durian-Pi
node scripts/suite.mjs --jobs 8                  # last measured 289/289 green, 117.7 s, exit 0 (.spike/suite-final.out)
node scripts/sync-pi.mjs --check                 # pin dd30101cf tag v1.5.1, drift true, 44 behind; package.json says ^1.3.0
git worktree list | wc -l; git branch --format='%(refname:short)' | wc -l   # 75 and 82 measured 2026-11-10T18:3xZ
bash .spike/diagnose.sh                          # the read-only branch/worktree census probe (gitignored; promote it)
git branch --list                                # the refs still NOT landable: item-3570, item-5301, item-5301-resolved,
                                               # verify-5180, wip/seat-prompt-files, and the reverted item-6063/6064/6066
```

**Open decisions the operator owns:** (a) **item-6063/6064/6066** — the compaction-gate trio was reverted. Either
re-cut it against the 1.5.1 pin and current `main`, or accept the guard and set
`DURIG_COMPACTION_RESERVE_TOKENS=8192`, `DURIG_COMPACTION_KEEP_RECENT=9288`, `DURIG_COMPACTION_BACKGROUND=8192` in
the gitignored `durig.config.json` (the config write is operator-owned — `docs/runbooks/compaction-policy-refused.md`)
and fix `demo/compaction-coherence.test.mjs:77`, which asserts the pin has no `modelOverrides` reader while
`vendor/pi-main/packages/durable/dist/harness/agent.js:145` reads it. (b) **`item-3570`** and **`item-5301`** need a
seat re-cut, not a delegate merge (evidence in `docs/DISPOSITIONS.md` §Pass 2026-11-10). (c) Landing #3570 makes
**D261** false — it says there is no post-mint gate write path; `revise_work` would create one.

**Blocker:** the broker is **wedged** — pid **3566266** (`cli.mjs serve --max-duration 1800`, running 2 h 42 m at
clock-out) holds `selfdev.sqlite.genlock.0`, and every broker-routed read answers `ok:false "read health: timed out
awaiting the broker's result"` (exit 1). `node cli.mjs status --json` measured exactly that. **Do not kill it while a
genlock slot is held** (`docs/runbooks/broker-down-or-stalled.md`); the recovery sequence and the item-5301
not-landable note both live in that runbook. Until it answers, no verb can read item terminality, so the 74
merged-but-held worktrees stay exactly where they are — that is the documented ceiling, a `pm` disposition act.

**State:** `main` tip — read it with `git rev-parse --short main` (this window ended at `9ec3d1b0`; a pinned sha here
goes stale by its own commits). refs **82**, worktrees **75** (measured at clock-out with `git worktree list | wc -l` and
`git branch --format='%(refname:short)' | wc -l`); 68 refs are provably ancestors of `main` (`git merge-base
--is-ancestor <ref> main` exit 0), 74 of them are still pinned by a worktree, and 67 of those trees are CLEAN. Broker pid **3566266** is **alive past its bound** and holds `selfdev.sqlite.genlock.0`, so a generation is in flight and **do not kill it**. Consequence: every broker-routed read (`cli.mjs status/queue/…`) answers `ok:false "read health: timed out awaiting the broker's result"`. When it exits, restart
with `node tools/broker-serve.mjs --start --yes-pm-wakes --max-duration 1800` after `--dry-run` acks. This broker
wedged once this window with `PASS-FAILED Error: SqliteStorage is closed` → `HARNESS-REOPEN-CAP-EXCEEDED attempts=4`
and was cleared with `kill -INT <pid>` → `cli.mjs resume` → restart (pitfall **237**). Store backup unchanged: `.spike/backups/20261110T0551Z/selfdev.sqlite`
(617,492,480 bytes, sha256 `0996cd61…`, `cmp` exit 0).

**Hazards the next session must not mistake for green:** (1) **`item-5301` and `item-5301-resolved` are not
landable** — the resolved branch merges clean but its own demo is red (`demo/worktree-reap.test.mjs:114` asserts
`dry.candidates/.refusedSoleCarrier/.kept/.counts`; `reapWorktrees` returns a bare array → `TypeError: Cannot read
properties of undefined (reading 'map')`, exit 1). (2) **`item-3570` is not landable as-is** — its demo needs the
1.5.1 `documentState`→`snapshot` migration AND asserts a refusal message (`blockedBy.0: must be integer`) that does
not exist in the installed pi-durable 1.5.1 (`grep -rn 'must be integer' node_modules/@earendil-works/pi-durable/dist/`
exit 1). (3) **`item-6063/6064/6066` are ancestors of `main` but their content is reverted** — `git branch -d` would
succeed on them; do not prune them, they are the input to the re-cut.

## The pinned-pi thread — v1.5.1 LANDED (ROADMAP 353–357)

Pin: tag `v1.5.1` = `dd30101cfc5b0609411dd80b6f93adbc14db14cf`; `pi-schema` **first** in the pin's `packages`
(chord fails `TS2307` otherwise); 10 built packages all 1.5.1. `--check` reports `policyGap: null` and
`drift: true / behind 14` against upstream tip `b2aabe029…` — **a tag pin can never satisfy `drift: false`, so the
contract's `drift: false` is mis-specified** (register the fix; do not chase it). The live store still reads
`durable_schema = [{singleton:1,version:2}]`: the move **migrated nothing**.

Migration, in our source (no upstream patching): `Type` → `pi-schema` builders (closed by default — `src/rig.mjs`'s
`Type.Object({}, {additionalProperties: true})` sites need `{ open: true }`); `documentState` → `snapshot`, which
returns the **value**, not a wrapper; `watchEvents` → `src/livewatch.mjs` `watchLive()`; `subscribeCommits` →
`src/commitstream.mjs` `followCommits()` over `Session.observeCommits`; `Storage.commit(batches, receive, ctx)`;
and `checkpointWhen: () => false` on the 6 rig docs, **provisional** (ROADMAP 355, rows #6171–#6173). Both seams are
documented as approximations: turn boundaries come from the generation attempt, not a turn record; tool results are
synthesised from committed `pi.tool-result` entries, not streamed.

**Stop rule that still applies:** `--unlink` is NOT a rollback — the live store is schema v2 and released pi-durable
≤ 1.3.0 cannot open it. Procedure: `docs/runbooks/pi-pin-update.md`; pitfalls **227–236**.

## Exact next command

```bash
cd /home/chexxor/Git/Durian-Pi
node scripts/test.mjs --all --jobs 8                  # 282/282 expected; exit 0
node demo/next-pointer.test.mjs                       # red until NEXT.md is under 200 counted lines
node tools/broker-serve.mjs --dry-run                 # "A start would be allowed" with ~/.config/durig/env sourced
set -a; . "$HOME/.config/durig/env"; set +a; DURIG_DB=./selfdev.sqlite node tools/broker-serve.mjs --start --yes-pm-wakes --max-duration 1800
node cli.mjs status
```

## Current item (priority order)

1. **Close the three pin-policy rows** (ROADMAP 355): `checkpointWhen` per rig doc (**#6171**, architect),
   `persistWithinMs` 1,000 ms + `watchDoc()` or 0 + transaction load (**#6172**, lead), `restartLimit = 3` at the
   single `openHarness()` seam in `cli.mjs` pinned by a demo (**#6173**, impl).
2. **Re-cut `item-5301`** (**#6174**) — four defects, measured on the merged tree, listed in
   `docs/reviews/pi-1.5.1-delta-review-2026-11-10.md` §8 and pitfall **232**. Do not land until all four close.
3. **Close the install gap** (ROADMAP **352**, rows **#6125/#6127**): nothing at session start runs
   `tools/compaction-guard-install.mjs --check`, so a fresh clone or worktree starts unguarded with no signal.
4. **Prune the held refs — the git side is now exhausted.** This pass deleted the only merged+free ref, `item-6082-mig`
   (tip `6b21e36b`, proved an ancestor of `main` with `git merge-base --is-ancestor` before `-d`). Every remaining merged
   ref is held by a worktree: seat roots (impl=1158, qa=6088, advocate=durian-dev/seatroot, scribe=4102, devtools=6082,
   auditor=5604, designer=5995, architect=6121) and in-flight rows (6014, 6057, 6086, 6088, 6089, 6171, 6188, 816,
   3087, 4878, 5912, 3570); `verify-5180`, `item-5301` and `wip/seat-prompt-files` are unlanded and stay by ruling
   (ROADMAP 344, `docs/DISPOSITIONS.md` rows). Releasing them needs row terminality, which lives in the store — and the
   store reads dark right now (pitfall **237**). Sequence per `docs/runbooks/branch-cleanup.md` / `leaked-worktrees.md`.
5. **Promote the pin probes out of `.spike/`** (**#6176**): `.spike/pin-update/migrate-symbols.mjs` and
   `.spike/pin-update/signature-classify.mjs` are the instruments that made this window fast; an unpromoted probe
   is lost (ROADMAP 312).
6. **Broker alive-but-dead** (**#6160**): heartbeat advances, pass clock freezes, every broker-routed read times out
   while a direct read-only open answers. Observed twice this window; recovery is `kill -INT` → `resume` → restart.
7. **Ratify or revise M5's eight acceptance criteria** (operator) — `docs/MILESTONES.md` §M5, gate baseline
   **3 PASS, 1 PARTIAL, 4 FAIL** (`docs/evidence/2026-11-09-milestone-m5/gate.mjs`, 1.6 s).

## State the team is in

Fleet awake: 12 seats (11 on `local2/qwen3.8-flash-next-q2_0`, auditor on `verifier/openai/gpt-oss-120b`). Queue
6,178 rows. pm minted **#6171–#6178** from the delegate intent (`requestId b0488417-b203-4df7-83dd-077406980a9f`,
`delivered: true`); other seats minted their own rows this window (#6163–#6170). **The delegate asserted no row.**
Six branches landed (`item-1779`, `item-2915`, `item-3041`, `item-6067`, `item-6082`, `item-6121` + the
`item-6082-mig` fork); two are deliberately not landed and are named with reasons above.

**Blocker (operator grants only):** the verifier leg is armed but `DURIG_VERIFIER_API_KEY` spend is capped, and
`local2` is a shared LAN box — `broker-serve --dry-run` BLOCKed once on `provider-local2-completion-failed: timeout
after 20s` while a direct curl answered in **1.6 s**. Retry the preflight rather than reconfiguring.

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

**Traps this window** — `docs/SELFDEV.md` **232–236** (a branch can fail to compile and still merge; `Storage.commit`
silently refuses a version-mismatched delta; `snapshot()` returns the value not a wrapper; contention reds are not
regressions; refs cannot be pruned while a live seat root holds them). Earlier: 227–231 (shallow clone depth, the
`pi-schema` build order, `--update <tag>` exists, the shim is diagnostic not a migration, the two doc-cap tests).
Grep for the symptom; the file is ~50,000 tokens.

Full history of this pointer, verbatim: [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md)
