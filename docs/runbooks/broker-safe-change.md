# Apply a spec change safely (model / constitution / reset)

## When to use
You changed a seat's model in `rig.selfdev.json`, edited `constitution.txt`, or need a context reset, and
it must take effect without corrupting the store.

## Preconditions
`up --refresh` and `reset` are **write verbs** — they open their own `Harness`. They must not run while
the broker is up. `stop` the broker first and **confirm it exited**.

## Diagnose (read-only)
```bash
cat selfdev.sqlite.broker.json 2>/dev/null     # is a broker recorded?
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.Name -eq 'node.exe' -and \$_.CommandLine -match 'cli.mjs serve' } | Select-Object ProcessId"
```

## Do
1. Stop the broker and **read the result**:
   ```bash
   DURIG_DB=./selfdev.sqlite node cli.mjs serve --stop
   ```
   Proceed **only** on `"stopped": true`. On `"stopped": false` the pass did not settle inside the
   window: wait and run it again until it is `true`, or (if no genlock slot is held) terminate the pid.
   **Never proceed on `false`** — that is the second-writer corruption.
   **`"stopped": true` is NOT proof the process is gone.** Observed twice: the CLI clears
   `broker.json` and reports success while the broker is still alive in its final F11 drain. The stop
   is honoured AFTER the pass in flight settles, so do not call `--stop` while a `genlock.*` is held
   (you would wait on, or strand, that run).
2. Confirm no `serve` process remains (the check in Diagnose) AND `broker.json` is gone. If the pid is
   still alive after the drain and NO genlock is held (all runs settled), terminate it:
   `taskkill /F /PID <pid>`. Never terminate while a genlock slot exists.
3. Apply the change:
   ```bash
   DURIG_DB=./selfdev.sqlite node cli.mjs up rig.selfdev.json --refresh
   ```
   The JSON reports `refreshed`, and for a model change `modelMismatch` / `modelReset`.
4. Restart:
   ```bash
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/serve-noroot.ps1
   ```

## Verify
- `up` JSON: the seat is in `refreshed`, and a model change appears in `modelReset`.
- The constitution is what the broker sees (it is a session document, not the file):
  ```bash
  node scripts/read-constitution.mjs   # prints whether prepare_workspace / P3 Language are present
  ```
- The broker log shows a fresh `START` and `WAKE` lines.

## If it fails
- `up` or the next write dies with `Session failed after a storage error` → `store-corruption-recovery.md`
  (this is exactly what proceeding on `stopped:false` causes).
- The change is not visible: confirm the single constitution source is `constitution.txt` in
  `rig.selfdev.json` (an `constitutionInline` field silently wins — ROADMAP item 75).

## Evidence
2026-10-16: a first refresh applied `prepare_workspace` but not `P3 Language` because `rig.selfdev.json`
carried a shadowing `constitutionInline` (fixed, commit `806ce7f`); a second attempt ran `up --refresh`
after `serve --stop` returned `stopped:false` and corrupted `impl`'s `pi.live` (recovered). ROADMAP items
69 (hard guard) and 74 (hot-reload) remove the stop from this procedure entirely.
2026-10-16 (again): `serve --stop` returned `"stopped": true` for pid 35812/30596 while each process
remained alive in the F11 drain; the pid had to be force-killed once all runs had settled. Confirm the
process, not the flag.
