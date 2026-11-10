# NEXT.md — current state and next actions

**Last update:** 2026-11-10T06:45Z (delegate session **N24** — the **pinned-pi thread**: pi-durable **v1.5.1** was
moved, gated, measured (**93 PASS / 187 FAIL**), shim-probed (**184 / 94 + 2 TIMEOUT**, 127.5 s) and **reverted**; the
rig is green on the validated pin at **278/280 in 59.7 s**. The **fleet is stopped** — the broker was stopped for the
pin work and left stopped on purpose. N23's fleet findings stand: the silence was a broker with **no `DURIG_*` env**
(401 on every generation, 171 rows escalated as `repeated_failure`); **12 natural seat compactions, 0 truncated, 14
note-backed**; the 100/0 acceptance ran clean on a snapshot copy (exit 0, **27.9 s**) with a control reproducing
**10** truncations; **8 of 12 seats** still have no note because they hold no claimed work, and ROADMAP **352** (the
install gap) is unlanded — both are team routing decisions the delegate cannot make. **M5** gate unchanged: 3 PASS,
1 PARTIAL, 4 FAIL. Nothing was claimed in the queue by the delegate.

**Milestone this window worked** — **ensuring LLM task completion (D226 / D240, first tranche ROADMAP 331)**.
The harness plane is closed (ROADMAP 351, D252, runbook `docs/runbooks/harness-compaction-guard.md`, pitfalls
211–216). This window closed the **seat plane's mechanism** too: the continuity extension is armed, real seats write
and read notes, and every natural compaction since arming took the note path with **zero** truncations. What is NOT
closed is coverage (10/12 seats have no note — they have no claimed work) and the install gap (ROADMAP 352, rows
**#6036/#6037** `deferred` to human). The team's rows **#5931–#5942** are still unclaimed; the delegate asserted nothing.

**Host for every number below**, measured with the measurement: **Linux**, Fedora Linux 45 (Forty Five), kernel
`7.2.15-300.fc45.x86_64`, node **v24.22.1**, `git version 2.56.0` — probe:
`uname -s && uname -r && (. /etc/os-release && echo "$PRETTY_NAME") && node -v && git --version`.

## NEXT SESSION

**Milestone this window worked** — **ensuring LLM task completion (D240, ROADMAP 331)**; this pass got the fleet
running (the 401 root cause), exercised the seat plane on real seats, and measured the 100/0 acceptance on a store
snapshot. The *other* open thread is the auto-clean ceiling (D249, ROADMAP **311** cut 2 / **344**), still spooled,
not delivered.

**Current item:** N18's mechanism is proven, its coverage is not. `node
docs/evidence/2026-11-08-context-window/milestone-check.mjs --db ./selfdev.sqlite` → **exit 0**, `PASS (mechanism)`,
**5 operational blockers**: 219 lifetime truncated summaries, 209 run-cap refusals, 212 truncations on seats with no
cap refusals, **8 of 12 seats have no continuity note** (they hold no claimed work to note), impl claimed 1 item and
completed none. Live evidence since arming (2026-11-09T23:47:45Z): **12 compactions, 0 truncated, 14 note-backed**.
The 100/0 number is a **driven measurement on a snapshot copy**, not 100 natural fleet compactions — say that, do not
round it. `node docs/evidence/2026-11-08-context-window/compaction-acceptance.mjs --target 100 --mode armed` → exit 0
in **27.9 s**: 100 compaction tasks, 0 truncated, 102 faux provider calls = 100 growth turns + **2 summariser
requests**, 65 summary markers (48 note-backed); control `--target 12 --mode control --stopReason length` → exit 0,
**10 truncated** (the counter is not vacuous). The instrument is now **tracked** — it was in gitignored `.spike/`
(rows #6128/#6131 still ask devtools to promote it into `tools/`). **Next milestone M5** is ready: 171 → 172 → 173 → 175 → 176
(`docs/reviews/milestone-m5-solidified-2026-11-09.md`), gate re-runnable in 1.6 s, four criteria open (C1, C3, C4, C6).
The broker is pid **1999470** (started 04:42:52Z, `--max-duration 3600`, exits ~05:42:52Z, spool 0 pending, pass 1
woke 9 seats); it had to be restarted twice today because it wedged with `PASS-FAILED Error: SqliteStorage is closed`
→ `HARNESS-REOPEN-CAP-EXCEEDED attempts=4` (alive, fresh heartbeat, frozen `lastPassAt`; every broker-routed read
timed out while a direct read-only open answered). `kill -INT <pid>` → `cli.mjs resume` → restart cleared it. The
team's rows **#5931–#5942** (N18) are still `deferred` to human by the supervisor; ROADMAP 352 was **cancelled and
re-issued as #6125/#6127** (pm → devtools, queued, #6127 blockedBy #6125). The delegate asserted nothing and sent pm
intents `fef4cf53-996d-450b-863e-26f8549dbd47` and `209af9be-7873-4a1c-a64b-6c46b4339e9b` (coverage + re-drive).
`node docs/evidence/2026-11-09-milestone-m5/gate.mjs --db ./selfdev.sqlite` (1.6 s, no model, no broker — expect
`3 PASS, 1 PARTIAL, 4 FAIL`) then
`node docs/evidence/2026-11-08-context-window/milestone-check.mjs --db ./selfdev.sqlite` (3.7 s, expect `PASS
(mechanism)` exit 0 with 5 blockers; a `FAIL` now means code, not configuration). The install gap is per tree: `cd
item-<id> && node tools/compaction-guard-install.mjs --check` exits **1 (NOT INSTALLED)** while main reports UP TO
DATE (measured 11/11 seat worktrees at 04:33Z). Then the harness-plane guard chain:
`node tools/compaction-guard-install.mjs --check && node tools/compaction-guard-test.mjs && node tools/compaction-guard-e2e.mjs && COMPACT_GUARD_E2E_MODE=auto node tools/compaction-guard-e2e.mjs`
(expect `UP TO DATE ... (+ .pi/extensions/compaction-guard-core.mjs)`, `ALL PASS` 28 checks in ~0.5 s, then
`ALL PASS` manual mode 3–5 s, then `ALL PASS` auto mode **50–86 s** — measured 52 s and 86 s on this box on the same
commit; the spread is local-server input throughput, not the guard. Both use the local model, no money).
Then `node scripts/clockin.mjs`, then `node tools/broker-serve.mjs --status`, then
`DURIG_DB=./selfdev.sqlite node cli.mjs worktree audit` (measured 2026-11-10T03:2xZ: `total: 11`, `reapable: 1`
(item-6067, row #6067 still open), `dirty: 0`), then
`node cli.mjs status` once a broker is healthy.

**State:** refs **14**, worktrees **11**, `main` tip — read it with `git rev-parse --short main` (a pinned sha here
goes stale by its own commits; this window ended at `e2584110`). Broker pid is in `selfdev.sqlite.broker.json`
(one run at 02:54:22Z with `--max-duration 3600`, so it self-exits ~03:54Z — restart it rather than assume it is
there). Continuity evidence still stands:
`docs/evidence/2026-11-08-context-window/milestone-check-2026-11-09-live.txt` and the M5 gate baseline
`docs/evidence/2026-11-09-milestone-m5/gate-baseline-2026-11-09.txt` (**3 PASS, 1 PARTIAL, 4 FAIL** — that is M5's
honest baseline, not a bug).

**Blocker:** the broker is **up and healthy** now — the fleet's silence was a broker process with **no `DURIG_*`
environment at all** (401 on every generation), not a routing failure. Remaining blockers are operator-side: no
verifier credential is armed by choice (`DURIG_VERIFIER_API_KEY=` empty → the auditor leg reports `no_model`) and the
spend cap refuses `google/gemini-3.1-pro` ($14 exposure against a $4 store cap). Spool is drained (0 pending); **118**
dead-letters remain in `selfdev.sqlite.broker.inbox.error` (59 of them `apply failed: SqliteStorage is closed`).
**Trap worth knowing:** `node tools/compaction-guard-install.mjs --check` exits **0** in the repo root and **1** in a
seat worktree (`item-6057`, `NOT INSTALLED`) — the guard covers the delegate session, not seat worktrees. That is the
ROADMAP 352 gap, and it is measurable with that one command.

**Unverified:** the seat plane's own compaction is untested here; the exact failing turn of the operator's session
cannot be recovered from the transcript (failure events are not persisted). The threshold path is now exercised end-to-end and the unguarded failure was reproduced verbatim — see below.

**Cheap probe that proves the guard is in place:** `node tools/compaction-guard-install.mjs --check` → exit 0, and
in a live session `/compaction-guard` prints caps and `fired=`.

## The pinned-pi thread — v1.5.1 staged, NOT landed (ROADMAP 353–357)

**What the last window did with the operator's "update pi-durable to v1.5.1" directive:** it ran the move, gated
it, measured it, and **reverted it**. The rig is on the validated pin `2ec55d80` (pi-durable **1.3.0** built from
it), suite **278/280 in 59.7 s**. At tag `v1.5.1` (`dd30101c`, 729 commits ahead of the pin) the suite is
**93 PASS / 187 FAIL**; with a 4-line `Type`→`typebox` shim, **184 PASS / 94 FAIL + 2 TIMEOUT, 127.5 s**. The
evidence and the itemised migration are `docs/reviews/pi-1.5.1-delta-review-2026-11-10.md`; the procedure is
`docs/runbooks/pi-pin-update.md`.

**The rule that stopped the landing:** a pin bump that leaves `documentState` (117 hits / 49 files),
`subscribeCommits` (9 files), `viewState`, `watchEvents`, pi-ai's `Type` and the now-required `checkpointWhen`
(0 occurrences in our tree, 5 rig docs) un-migrated is a half-done change. **Do not move the pin before ROADMAP
353 lands**, and never treat `sync-pi --unlink` as a rollback — the live store is schema v2 and released pi-durable
≤ 1.3.0 cannot open it. Backup: `.spike/backups/20261110T0551Z/selfdev.sqlite` (617,492,480 bytes, sha256
`0996cd61…`, `cmp` exit 0).

**Broker state:** deliberately **stopped** for the pin work — wedged pid 1999470 ended with `kill -INT`
(`EXIT reason=deadline`), the stranded genlock was removed, `cli.mjs resume` exits 0 with 2 `run-cancelled
submissions`. Restart: `DURIG_LOCAL_API_KEY=… node tools/broker-serve.mjs`.

## Exact next command

```bash
cd /home/chexxor/Git/Durian-Pi
node scripts/sync-pi.mjs --check        # pin identity + the #5093 tag-pin policy gap; read-only, ~1 s
node demo/next-pointer.test.mjs         # the pointer cap — red until NEXT.md is under 200 counted lines
node demo/clockin-digest.test.mjs       # the other cap: the clock-in digest budget
node scripts/test.mjs --all --jobs 8    # the baseline a pin move must beat: 278/280
node tools/compaction-guard-install.mjs --check   # exit 0 = the guard is installed and current
node tools/broker-serve.mjs --status    # the broker is stopped by design this window
```

## Current item (priority order)

1. **Move the pin when ROADMAP 353 lands** (353–357 registered 2026-11-10): the symbol migration is a seat job —
   `pi-schema` first in the pin's `packages`, `documentState` → `watchDoc()` in 49 files, `subscribeCommits`
   semantics, the 5 rig docs' required `checkpointWhen`, and the 36 unclassified assertion failures. Evidence:
   `docs/reviews/pi-1.5.1-delta-review-2026-11-10.md`.
2. **Close the install gap** (registered as **ROADMAP 352**, unclaimed): nothing at session start runs
   `tools/compaction-guard-install.mjs`, so a fresh clone, a new worktree or another machine starts **unguarded with
   no signal** (`.pi/` is gitignored by design, `.gitignore:15`). Fix shape: `scripts/clockin.mjs` prints a `guard:`
   line from `install --check` (<100 ms, no model/key/network), and a `demo/compaction-guard-gate.test.mjs` wrapper
   puts the 28-check gate inside the area suite (discovery scans only `demo/*.test.mjs`, `src/testareas.mjs:31-38`, so
   today the pre-landing gate never runs it). A seat job, not a delegate job.
3. **Get a provider that registers a model** (operator grant) — the extension is armed
   (`durig.config.json`, `cli.mjs config`), so the remaining step is a live seat run: `DURIG_LOCAL_API_KEY` unset →
   **401** on 127.0.0.1:8080. Until then N18's acceptance cannot be measured, and the gate will keep reporting
   "armed but never exercised" as a blocker (pitfall **219**). Procedure: **`docs/runbooks/continuation-notes.md`**.
4. **Decide how a landing closes its row** (D249) — spooled as `delegate-20261109-auto-clean`, undrained while the
   broker is down.
5. **Re-cut `item-5301`** (the `worktree reap` verb, ROADMAP 311 cut 2) — a seat job.
6. **#5785** — code on `main`, row `deferred`; a zero-build close for its owner.
7. **Ratify or revise M5's eight acceptance criteria** (operator) — `docs/MILESTONES.md` §M5,
   `docs/reviews/milestone-m5-solidified-2026-11-09.md` §4; gate baseline **3 PASS, 1 PARTIAL, 4 FAIL**.

**Promotion candidates** (gitignored `.spike/`, broker-down safe, no spend beyond the local model):
`.spike/probe-extension-discovery.mjs` (prints the extension set the harness actually loads — the only instrument
that answers "which extension wins a `session_before_*` event?"), `.spike/probe-compaction-composition.mjs`
(compaction with both project extensions loaded), `.spike/probe-auto-compaction-path.mjs` (drives the harness's own
threshold compaction with project compaction settings overridden), `.spike/control-unguarded-compaction.mjs` (the
negative control: pi's default path on the same span, **5–15 min** because the request carries no output cap).
The auto-path and control logic are already folded into the tracked
`tools/compaction-guard-e2e.mjs` (`COMPACT_GUARD_E2E_MODE=auto`); promoting the other two keeps the discovery and
composition reads available after `.spike/` is cleared. Promotion is a row from `lead` (#5617 is the precedent) —
the broker is down, so it could not be routed this window.

## State the team is in

The fleet is stopped with the broker. Queue: 6,021 rows, `done 4154 / cancelled 873 / held 461 / deferred 383 /
claimed 12 / queued 138`. Landed-but-non-terminal rows: **#5221, #5226, #5387, #5501, #5829** — their owners close
them. Rows **#5931–#5942** unclaimed. The delegate asserted no row.

**Blocker (operator grants only):** no provider registers a model on this box (`DURIG_LOCAL_API_KEY` unset → 401 on
127.0.0.1:8080; `DURIG_VERIFIER_API_KEY` unset → 402 balance), and the spend cap refuses `google/gemini-3.1-pro`
($14 exposure against a $4 store cap). 10 intents are spooled in `selfdev.sqlite.broker.inbox/`, **118** dead-letters
in `selfdev.sqlite.broker.inbox.error/`.

**Unverified:** (1) the exact turn the operator's session failed on is not recoverable from the transcript
(compaction failure events are not persisted); the mechanism is established from the shipped harness code, the
provider probe and the reproduced threshold-path failure above. (2) Whether a seat's pi-durable compaction can
fail the same way — its own cap is smaller, and nothing here tested it.

**Cost:** the spend ledger is unchanged at **2,030 lines / $0.92401 cumulative** (last row 2026-11-09T05:22:59Z);
every call this pass went to the local loopback server, which the ledger does not meter, so **$0.00** was spent.
Wall clock: the gate is **0.46 s**, the manual e2e **3.25 s**, the auto (threshold) e2e **85.5 s** — that last one is
the only expensive instrument on this thread and it is a once-per-session witness, not a loop (SELFDEV **218**).

**Traps this window** — `docs/SELFDEV.md` **219–220** (a store-based gate cannot tell "broken" from "armed and never
run" — prove the mechanism on the mocked plane before blaming it; `cli.mjs config` reporting a setting is not proof it
is in effect: check the registry install, then the `pi.agent` selection, then a real request in the transcript). Also
**211–218** (the failure is a request-shape bug; a one-character typo in a
safety net is invisible to `node --check`; last-non-null wins on `session_before_*`; `thinking_budget: 0` is
ignored on this server; the harness plane and the seat plane are different compaction code; an e2e seeded under
`keepRecentTokens` (20000) fails as "session too small", not as a guard failure; an extension whose core module
does not resolve simply does not load, and nothing says the guard is off; the auto-mode e2e is a 50–86 s witness, not
a fast loop, and a doc that pins a second-count goes stale the same day). Earlier blocks:
191–210, 186–190, 173–185. Grep for the symptom; the file is ~50,000 tokens.

Full history of this pointer, verbatim: [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md).
