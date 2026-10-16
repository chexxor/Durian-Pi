# Broker down or stalled

## When to use
Seats sit idle with queued/claimed work, `status` shows `idle_with_queued_work` or `admitted_not_started`,
and the broker log stops advancing. Either no `serve` process is running, or one is present but parked.

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
