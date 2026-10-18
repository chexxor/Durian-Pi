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
- **Alive but dormant** (case b): `START` present, `broker.json` heartbeat fresh, last `PASS` minutes
  old, no `genlock.*`. The broker rests in `signal.wait` with `scheduler.shouldRun()` false. A restart
  forces a startup pass (which also drains `.broker.inbox`) and re-wakes queued seats.

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
