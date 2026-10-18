# Broker down or stalled

## When to use
Seats sit idle with queued/claimed work, `status` shows `idle_with_queued_work` or `admitted_not_started`,
and the broker log stops advancing. Two shapes: **(a)** no `serve` process is running, or one is present
but parked mid-pass; or **(b)** the broker is ALIVE but **dormant** — a fresh heartbeat, no `PASS` for
minutes, no genlock held — while a seat holds queued work. (b) is the general revisity gap: a pass runs
only on a store-commit signal, so after a seat's normal settle the per-seat cooldown suppresses its
re-wake and nothing marks the scheduler dirty again, leaving the seat unwoken until an unrelated commit
or a restart.

## Preconditions
None for diagnosis. The fix writes, so it needs no other writer.

## Diagnose (read-only)
```bash
DURIG_DB=./selfdev.sqlite node cli.mjs status
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
  old, no `genlock.*`. The broker rests in `signal.wait` with `scheduler.shouldRun()` false. A restart
  forces a startup pass (which also drains `.broker.inbox`) and re-wakes queued seats.
- **`WAKE-RETRY` logged but no `PASS` follows** (2026-10-18 recurrence 8): the dormant-revisit fix
  (`991567d`) re-arms the loop after a `wake-failed` and logs `WAKE-RETRY in=<ms>ms seats=<names>`. If
  that line appears and then **no `PASS`** for minutes (fresh heartbeat, no genlock, idle CPU), the retry
  pass either did not run or hung before its `PASS` line — a hung pass is invisible because `cmdServe`
  does not log `pass-failed` (ROADMAP 78). Same recovery as case (b).
- **`WAKE-RETRY` logged repeatedly at ~0.5 s apart — a HOT LOOP** (2026-10-18): the opposite of case (b);
  the broker SPINS. `WAKE-RETRY in=<ms>ms … pass-threw` lines whose timestamps are far closer together
  than the logged `in=` mean the scheduled backoff is not gating the next pass, and `serve --stop` may not
  be honoured (it was not). Recovery: `taskkill /F /PID <pid>` (only when no `genlock.*` is held), then
  restart — a fresh broker's first pass drains any stranded intents (`INTENT delivered=<n>`). See
  `docs/incidents/2026-10-18-broker-retry-hotloop.md`.

## Do
1. If a **wedged** `serve` process exists and **no** genlock slot is held, terminate it:
   ```bash
   taskkill /F /PID <pid>
   ```
2. With the broker down, clear anything stranded while it was gone:
   ```bash
   DURIG_DB=./selfdev.sqlite node cli.mjs resume
   ```
3. Restart the broker **without `DURIG_SEAT_ROOT`** (a seat's own prepared cwd wins; a global root trips
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
   $env:DURIG_LOCAL_BASE_URL='http://127.0.0.1:8080/v1'; $env:DURIG_LOCAL_MODEL='qwen36'; `
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
