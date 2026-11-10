# NEXT.md — current state and next actions

**Last update:** 2026-11-10T08:2xZ (delegate session **N25** — the **pinned-pi thread landed**: pi-durable
**v1.5.1** is on the pin, the mechanical symbol migration is committed, the suite is **282/282 in 47.8 s**, and
**six of the eight open branches are merged**. The fleet is **awake** and pm has minted the policy rows the
delegate deliberately did not decide. The worktree/ref inventory is down from 20 worktrees / 27 refs to **16 worktrees, 21 refs**
(13 refs held by live seat roots or locks). Nothing was pushed; the delegate claimed, completed or deferred no row.)

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

**Milestone this window worked** — **landing the pinned pi (D256, ROADMAP 353)**; the seat-plane policy calls are
now rows, not prose.

**Current item (#6171):** the rig is green at the new pin and the team has work in flight. Read the four rows pm minted
from the delegate intent (**#6171** `checkpointWhen`, **#6172** `persistWithinMs`, **#6173** `restartLimit`,
**#6174** the item-5301 rework), then run the gate the pin move must keep passing:

```bash
cd /home/chexxor/Git/Durian-Pi
node scripts/test.mjs --all --jobs 8            # must read 282/282; baseline at the old pin was 280/280 in 61.8 s
node scripts/sync-pi.mjs --check                # ref "v1.5.1", refType "tag", policyGap null, drift true (a tag pin always drifts)
node cli.mjs queue --id 6171 --id 6172 --id 6173 --id 6174   # the three policy rows + the item-5301 rework
node tools/broker-serve.mjs --status            # broker pid is in ./selfdev.sqlite.broker.json
node tools/rig-portability-audit.mjs            # 1 finding: seat-host-unaware (ROADMAP 217)
git worktree list | wc -l; git branch --format='%(refname:short)' | wc -l   # 16 and 21 as of this window
```

**State:** `main` tip read it with `git rev-parse --short main` (this window ended at `e50cf5b6`; a pinned sha here
goes stale by its own commits). refs **21**, worktrees **16**. Broker pid **2585214** (`--max-duration 1800`, started
08:04:34Z, self-exits ~08:34Z) — healthy at clock-out (`heartbeat 3s ago, last pass 3s ago`); **restart it rather than
assume it is there**; it wedged once this window with
`PASS-FAILED Error: SqliteStorage is closed` → `HARNESS-REOPEN-CAP-EXCEEDED attempts=4` and was cleared with
`kill -INT <pid>` → `cli.mjs resume` → restart. Store backup unchanged: `.spike/backups/20261110T0551Z/selfdev.sqlite`
(617,492,480 bytes, sha256 `0996cd61…`, `cmp` exit 0).

**Blocker:** none blocking a landing. Two live hazards the next session must not mistake for green: (1)
**`item-5301` is not landable** — `node --check` on its `cli.mjs` exits 1 on the branch tip, and its merged tree reads
279/283 (see pitfall **232**); (2) **`item-6057`'s worktree carries 88 lines of uncommitted tracked work on a `done`
row** (`demo/syncpi.test.mjs`, `scripts/sync-pi.mjs`) — relocate it, never delete it (ROADMAP 330).

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
4. **Prune the held refs** — 13 refs stay because their worktrees are locked or are live seat roots
   (impl=1158, qa=6088, advocate=durian-dev/seatroot, scribe=4102, devtools=6082, auditor=5604, designer=5995,
   architect=6121). `verify-5180` stays by ruling (ROADMAP 344, no `git branch -D`). Sequence per
   `docs/runbooks/branch-cleanup.md` / `leaked-worktrees.md`.
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
`rig-portability-audit` 1,084 ms; the broker preflight ~4 s. **Speed-up worth adopting:** gate every candidate
branch with `node --check cli.mjs` + `git merge-tree --write-tree` before spending a 47 s suite (pitfall **232**),
and never run three full suites concurrently — contention produced two false reds this window (pitfall **235**).

**Traps this window** — `docs/SELFDEV.md` **232–236** (a branch can fail to compile and still merge; `Storage.commit`
silently refuses a version-mismatched delta; `snapshot()` returns the value not a wrapper; contention reds are not
regressions; refs cannot be pruned while a live seat root holds them). Earlier: 227–231 (shallow clone depth, the
`pi-schema` build order, `--update <tag>` exists, the shim is diagnostic not a migration, the two doc-cap tests).
Grep for the symptom; the file is ~50,000 tokens.

Full history of this pointer, verbatim: [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md)
