---
runbook: broker-down-or-stalled
symptom: "seats idle with queued work; no `serve` process, or a fresh heartbeat with a stale PASS (dormant); log stops after a storage error or `database is locked`"
writes: true
precondition: "broker-stopped"
last_verified: unverified
verified_by: delegate
evidence: "2026-10-16 (items 54/66/68) + the 2026-10-18 recurrence (docs/incidents/2026-10-18-broker-dormant-stalled.md)"
check_rule: null
---
# Broker down or stalled

## When to use
Seats sit idle with queued/claimed work, `status` shows `idle_with_queued_work` or `admitted_not_started`,
and the broker log stops advancing. Two shapes: **(a)** no `serve` process is running, or one is present
but parked mid-pass; or **(b)** the broker is ALIVE but **dormant** — a fresh heartbeat, no `PASS` for
minutes, no genlock held — while a seat holds queued work. (b) is the general revisity gap: a pass runs
only on a store-commit signal, so after a seat's normal settle the per-seat cooldown suppresses its
re-wake and nothing marks the scheduler dirty again, leaving the seat unwoken until an unrelated commit
or a restart.

## Impact
If you do nothing, queued/claimed work sits idle: seats stay unwoken (`idle_with_queued_work` /
`admitted_not_started`) while the broker log stops advancing, so the queue looks healthy and is dead.
A dormant broker (shape b) is worse because nothing is obviously wrong — a fresh heartbeat and no
genlock hide that no pass will ever fire until an unrelated commit or restart. Blast radius is the
whole queue, but recovery is cheap (resume/restart) once the shape is diagnosed.
## Preconditions
None for diagnosis. The fix writes, so it needs no other writer.

## Diagnose (read-only)
```bash
DURIAN_PI_DB=./selfdev.sqlite node cli.mjs status
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.Name -eq 'node.exe' -and \$_.CommandLine -match 'cli.mjs serve' } | Select-Object ProcessId,CreationDate"
tail -12 selfdev.sqlite.broker.log        # last START? any EXIT? a long ms=? 
cat selfdev.sqlite.broker.json 2>/dev/null  # a live pid, or gone?
cat selfdev.sqlite.genlock.* 2>/dev/null    # a live generation means do NOT kill
tail -8 .spike/serve.err 2>/dev/null
```
- `START` with **no** `EXIT` = the broker died abnormally.
- A live `genlock` slot means a generation is in flight — do not kill the broker.
- `serve.err` ending in `Session failed after a storage error` → go to `store-corruption-recovery.md`.
- `serve.err` with **`Error: database is locked`** (SQLite busy/lock contention) is a SECOND dormant
  signature (2026-10-18T02:37Z recurrence): the broker stays up, fresh heartbeat, but stops passing.
  Concurrent store openers are the suspect class — a test/`serve --max-duration` broker from an item
  worktree must not open the shared selfdev store. Same recovery as case (b): terminate (no genlock),
  `resume`, restart.
- **Alive but dormant** (case b): `START` present, `broker.json` heartbeat fresh, last `PASS` minutes
  old, no `genlock.*`. The broker rests in `signal.wait` with `scheduler.shouldRun()` false.
  **THE DISCRIMINATOR — idle, not wedged:** a FRESH `heartbeatAt` with a FROZEN `lastPassAt` means the
  loop is IDLE, not stuck — and that is why a restart alone cannot help a suppressed seat: the startup
  pass runs the same `placed`-only filter (`src/broker.mjs:829`) and the pending set still suppresses
  it. Restart is NECESSARY-but-INSUFFICIENT for a suppressed seat (it is right for a wedged loop).
  **The one-seat variant:** a SINGLE seat silent while others work is NOT "broker down" — it is a
  per-seat suppression, and no broker-level remedy fixes it. **The remedy TODAY:** stop the broker,
  `resume` (which WITHDRAWS the stranded submission — `resume` must run with the broker STOPPED), then
  restart. **HOW AN OPERATOR NOTICES — an existing surface that works:** `cli.mjs status` already emits
  `admitted_not_started` WITH the submission id and its age (`admittedAt` is read at src/attention.mjs;
  e.g. "submission #N admitted 55s ago, no run started and no slot held"). Do not wait for a new alarm
  — this is the alarm. **Automatic recovery IS coming, and is not here yet:** an admission deadline
  exists (`admissionVerdict` / `ADMISSION_DEADLINE_MS`); once the reconciler consults it, a
  never-started submission is withdrawn without an operator. Until that lands, `resume` is the remedy.
  **Separate clause — the suppression-semantics fix:** a suppression-semantics fix is on a branch with
  its own landing entry and is not on main yet. When it lands it changes how a suppression is READ, not
  the recovery path — `resume` remains the remedy for a never-started submission.
- **`WAKE-RETRY` logged but no `PASS` follows** (2026-10-18 recurrence 8): the dormant-revisit fix
  (`991567d`) re-arms the loop after a `wake-failed` and logs `WAKE-RETRY in=<ms>ms seats=<names>`. If
  that line appears and then **no `PASS`** for minutes (fresh heartbeat, no genlock, idle CPU), the retry
  pass either did not run or hung before its `PASS` line — a hung pass is invisible because `cmdServe`
  does not log `pass-failed` (ROADMAP 78). Same recovery as case (b).
- **`WAKE-RETRY` logged repeatedly at ~0.5 s apart — a HOT LOOP** (2026-10-18): the opposite of case (b);
  the broker SPINS. `WAKE-RETRY in=<ms>ms … pass-threw` lines whose timestamps are far closer together
  than the logged `in=` mean the scheduled backoff is not gating the next pass, and `serve --stop` may not
  be honoured (it was not). Recovery: `taskkill /F /PID <pid>` (only when no `genlock.*` is held), then
  restart — a fresh broker's first pass drains any stranded intents (`INTENT delivered=<n>`). If the
  `pass-threw` RETURNS after that restart (a PERSISTENT cause — the log shows clean passes then freezes),
  the restart is insufficient: read `.spike/serve.err` for the named `wake-failed … <seat> conv <N> …
  Session failed after a storage error`, and repair that conversation with
  `scripts/repair-pi-live.mjs <db> <N>` (`store-corruption-recovery.md`) BEFORE restarting. See
  `docs/incidents/2026-10-18-broker-retry-hotloop.md`.
- **Stopping an unresponsive broker (foreground or detached).** `serve` traps `SIGINT`/`SIGTERM` into a
  graceful stop: it only sets a stop flag, and the loop honours it at a **pass boundary**
  (`src/broker.mjs:1085` and `:1281`), after which it still runs `await harness.waitForIdle()`
  (`:1293`). A pass wedged on a hung wake/generation therefore defeats **Ctrl+C, `SIGTERM`, and
  `serve --stop` alike**, and `serve --stop` can return `stopped:true` while the process lives. Escalate
  to a hard stop (Windows) and clear the stranded run:
  ```bash
  powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'cli.mjs serve' } | Select-Object ProcessId"
  taskkill /F /PID <pid>          # or: Stop-Process -Id <pid> -Force
  DURIAN_PI_DB=./selfdev.sqlite node cli.mjs resume
  ```
  A foreground `serve` in the operator's shell is expected to receive Ctrl+C; if it does not, it is
  wedged, not detached. The bounded graceful stop is owed as `#2237`.

## Do
1. If a **wedged** `serve` process exists and **no** genlock slot is held, terminate it:
   ```bash
   taskkill /F /PID <pid>
   ```
2. With the broker down, clear anything stranded while it was gone:
   ```bash
   DURIAN_PI_DB=./selfdev.sqlite node cli.mjs resume
   ```
3. Restart the broker **without `DURIAN_PI_SEAT_ROOT`** (a seat's own prepared cwd wins; a global root trips
   the F12 guard):
   ```bash
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/serve-noroot.ps1
   ```
   **Also export the local-seat environment when a seat uses the local provider.** `scripts/serve-noroot.ps1`
   sets only `DURIG_DB`, and `DURIG_LOCAL_API_KEY` is not a config key (until `#2114` lands), so a plain
   restart makes `qa`/`devtools` fail `No API key for provider: local`; the local server (PolyStrata,
   `127.0.0.1:8080`) must also be running, or they fail `model_error: Connection error.`
   (`local-provider-down.md`). Export the local env on the launcher:
   ```powershell
   $env:DURIG_LOCAL_BASE_URL='http://127.0.0.1:8080/v1'; $env:DURIG_LOCAL_MODEL='swift-1.5-iq2_xs'; `
   $env:DURIG_LOCAL_CONTEXT='65536'; $env:DURIG_LOCAL_API_KEY='local'; `
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/serve-noroot.ps1
   ```
   (`DURIG_LOCAL_BASE_URL`/`_MODEL`/`_CONTEXT` also live in `durig.config.json`; only the key is env-only.)

## Verify
```bash
tail -8 selfdev.sqlite.broker.log
```
Expect a fresh `START`, `WAKE <seat>`, and `PASS` lines. `status` shows the previously idle seats
generating. (The broker also logs `STRANDED settled=N` / `RECONCILE …` when it heals on start.)

## If it fails
- Won't start, or dies again with a storage error → `store-corruption-recovery.md`.
- Starts but a seat still will not run → `seat-reset.md`.
- A dead broker stays dead: this is the supervision gap, ROADMAP items 61–64 (host daemon).

## Escalate to
`pm` — when the dormant-revisit gap (shape b) recurs, it is the supervision gap ROADMAP 61–64 targets;
`lead` — when a dead broker stays dead after resume (the host-daemon gap).
## Evidence
2026-10-16 (items 54, 66, 68): a broker that died on a storage error stalled `impl`; `resume` cleared 5
stranded submissions, and the restart woke pm/impl/scribe. Item 54 makes a *stoppable* broker honest.
2026-10-16 (dormant case b): pid 16628 was ALIVE with a fresh heartbeat, last `PASS 82` at `21:09:19`,
**no pass for ~9.5 min**, no genlock, while `impl` held 23 queued items (`idle_with_queued_work`). The
dormant-revisit gap is still owed; the diagnostic is the fresh heartbeat + stale `PASS` + no genlock.
2026-10-18 (recurrence, `docs/incidents/2026-10-18-broker-dormant-stalled.md`): the broker stayed
**alive with a fresh heartbeat** while its log froze at `PASS 1` for ~6.5 min; `.spike/serve.err` named
`wake-failed … Session failed after a storage error` for impl (conv 9) and qa (conv 15). Recovery per
this runbook: terminate the wedged pid (no genlock) -> `resume` (1 pm run) -> restart -> `START
pid=15720`, `INTENT delivered=2`, passes resume. Note: a **fresh heartbeat is not a health signal** —
read the last `PASS` line, not `broker.json`.
2026-10-18T02:37Z (recurrence, `docs/incidents/2026-10-18-broker-dormant-stalled.md`): the SAME dormant
shape, pid 28168, log froze at `PASS 176` while fresh-heartbeat and no genlock. `.spike/serve.err` showed
a NEW signature — `Error: database is locked` (devtools/auditor) plus `Session failed after a storage
error` (pm/qa) — proving #1698's pass-survival is INSUFFICIENT (the broker still stopped driving; the
runbook also covers the surviving-pass proof `demo/broker-pass-survival.test.mjs`). Two spooled intents
sat undrained. Recovery per this runbook: `taskkill /F /PID 28168` (no genlock) -> `resume` (3
run-cancelled) -> restart (`START pid=37496`).
2026-10-18T17:12-17:41Z (recurrences 4-6, `docs/incidents/2026-10-18-broker-dormant-stalled.md`): the
same dormant shape recurred three more times (pids `7404`, `3604`, `6124`), each after a per-seat
`wake-failed … Session failed after a storage error`; recurrence 5 removed the long-lived `ui.mjs` store
viewer (the concurrent-opener class), and recurrence 6 showed the fresh heartbeat was **frozen**, not
merely stale (`PASS` frozen ~2.7 min). Recovery each time: stop (cooperative `serve --stop` where the
process still answered) -> `resume` -> restart. **The dormant-revisit gap (prevention item 3) is now
FIXED** by `0c0d4d3` +
`991567d`: a pass that emitted any `wake-failed` schedules a retry with bounded exponential backoff and
logs `WAKE-RETRY in=<ms>ms seats=<names>`, so a transient storage error self-heals instead of parking the
broker (`demo/broker-wake-retry.test.mjs`, 3 scenarios). The scheduling is done AFTER the pass settles,
because `0c0d4d3` alone still parked when the SAME pass threw later (`superviseOnce` hitting the same
storage error) — recurrence 7. Still owed: `pass-failed` is not logged by `cmdServe`, so a swallowed
pass throw is invisible; and `SessionFailed.cause` logging (ROADMAP 78) + a stale-`PASS`+heartbeat
watchdog (ROADMAP 61-64).
2026-10-18T19:06Z (recurrence 8, `docs/incidents/2026-10-18-broker-dormant-stalled.md`): after the host
commit-exhaustion reboot the broker was DOWN (dead pid `16612`, `PASS 6` at `18:51:27Z`); `resume`
cleared 4 stranded submissions (pm `90494`, impl `90497`, scribe `90500`, auditor `90559`); restart with
the local env (per step 3) -> `START pid=10728`, `WAKE pm,impl,scribe,auditor`, `PASS 1..6`. `PASS 6`
emitted `wake-failed` for `qa` conv 15 (`Session failed after a storage error`) and logged
`WAKE-RETRY in=2000ms seats=qa`, but no `PASS` followed for ~3.5 min (fresh heartbeat, no genlock, idle
CPU); terminated (no genlock) and restart -> `START pid=11816`, which ran 30+ passes with `qa` woken and
zero `wake-failed`. `qa`'s three `Connection error.` runs in that window were the local server being down
(`local-provider-down.md`).
2026-10-18T20:27Z (hot loop, `docs/incidents/2026-10-18-broker-retry-hotloop.md`): the broker logged 823
`WAKE-RETRY … pass-threw` lines (each `in=60000ms`) at ~0.5 s spacing, the intent inbox did not drain, and
`serve --stop` returned `stopped:true` while pid `5840` kept spinning. `taskkill /F /PID 5840` (no genlock)
+ restart (`START pid=3296`) drained both spooled intents (`INTENT delivered=2 dead=0 dup=0`) and resumed
passes.
2026-10-18T20:56-21:15Z (hot loop recurrence, `docs/incidents/2026-10-18-broker-retry-hotloop.md`): the
restart alone was INSUFFICIENT. `START pid=5768` (`20:47:55Z`) ran clean to `PASS 90 ms=5056`
(`20:56:54Z`), then re-entered the ~0.5 s `WAKE-RETRY … pass-threw` spin (`1414` lines by `21:15:43Z`)
with a fresh heartbeat. `.spike/serve.err` named `wake-failed … pm conv 3 … Session failed after a
storage error` BOTH before and after the restart — a persistent cause. Recovery: terminate (no genlock),
then `repair-pi-live.mjs ./selfdev.sqlite 3`, then restart.
2026-10-19 (stop-defeat, `#2237`): a foreground `node cli.mjs serve` (pid `4092`) hot-looped on
`supervisor: escalated … seat: devtools, reason: degeneration`; repeated Ctrl+C had no effect and
`serve --stop` had already returned `stopped:true` while the process lived. `Stop-Process -Id 4092 -Force`
stopped it; `resume` cleared 3 stranded runs (scribe/auditor/devtools); the orphaned `genlock.0` (holder
`4092`) was removed. Earlier the same day a wedged broker (pid `4296`) was likewise force-killed. The
bounded-grace fix is routed: `#2237` + `.spike/delegate/intent-2237-bounded-stop.md`.
2026-10-19 (read path exposed by a healthy restart, `docs/incidents/2026-10-19-read-storage-handle.md`):
a broker restarted healthy (pid `17828`) dead-lettered every spooled CLI `read`
(`read: the broker has no storage handle (probeStorage)`), so `ps`/`queue`/`watch`/`ui` all failed.
Cause: `dispatchRead(harness.storage)`, a field pi-durable does not expose. Fix `a70c30d` (thread the
harness's real `Storage`); restart pid `5116`. The CLI had read the store directly (`readLocal`) while
the broker was down — which is why the broken handler stayed hidden until the restart.

2026-10-20 (delegate): **shape (b) recurred, and the obvious explanation was wrong.** pid 4528 was alive with
a fresh heartbeat, **no pass for 51 minutes**, no genlock held, empty `serve.err` — the textbook wedge. The
tempting conclusion was RAM starvation, because the local model (Swift 1.5 IQ2_XS) was holding ~22 GB of
experts on a 32 GB box at 95% load. **The discriminator settled it:** stopping the model dropped the machine
to 23% load / 24 GB free and the broker *still* did not pass, so it was the WEDGE, not starvation. It then
cleared on its own and `passAgeMs` went to single seconds.
**Reusable check, do it before naming a cause:**
```bash
ls -1 <db>.genlock*                       # none held => no pass in flight (not a slow pass)
# stop the heavy local model, wait one pass window, re-read status:
node cli.mjs status                       # passAgeMs resuming => starvation; unchanged => wedge
```
**Do not restart the broker while a 22 GB local model is loaded** — the restart needs ~1 GB of headroom to
fork, and with 96% RAM it fails in ways that look like a store problem. Free the model first, then restart.
