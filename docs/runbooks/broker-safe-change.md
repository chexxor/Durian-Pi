---
runbook: broker-safe-change
symptom: "a model/constitution/reset change must apply without corrupting the store"
writes: true
precondition: "broker-stopped"
last_verified: 2026-10-17
verified_by: delegate
evidence: "constitution reload fa4b22f + starter-inline sync b52133f; Verify run 2026-10-17"
check_rule: null
---

# Apply a spec change safely (model / constitution / reset)

## When to use
You changed a seat's model in `rig.selfdev.json`, edited `constitution.txt`, or need a context reset, and
it must take effect without corrupting the store.

## Preconditions
`up --refresh` and `reset` are **write verbs** — they open their own `Harness`. They must not run while
the broker is up. `stop` the broker first and **confirm it exited**.
**A broker-hosted seat cannot stop the broker it lives in and keep working** — the stop ends its own run
(the F11 drain below; 2026-10-17: the exclusive landing window closed QUIET BUT EMPTY for exactly this
reason). To quiesce for a LANDING pass, run the pass outside the broker (`land.md` Do step 0).

## Diagnose (read-only)
```bash
cat selfdev.sqlite.broker.json 2>/dev/null     # is a broker recorded?
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.Name -eq 'node.exe' -and \$_.CommandLine -match 'cli.mjs serve' } | Select-Object ProcessId"
# Review what the change would do — READ-ONLY, needs no broker stop (ROADMAP 84):
DURIAN_PI_DB=./selfdev.sqlite node cli.mjs up rig.selfdev.json --refresh --dry-run
```
`--dry-run` names the seats and fields it would change (`model`, `instructions`, `cwd`,
`thinkingLevel`), the seats it would create, the seats whose context the model change would reset, and
whether the constitution or the edges would change — and writes **nothing**. Review it here, before
stopping the broker, so the write you are about to make is the one you have already read.

## Do
1. Stop the broker and **read the result**:
   ```bash
   DURIAN_PI_DB=./selfdev.sqlite node cli.mjs serve --stop
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
3. **If the change edited `constitution.txt`, sync the starter's inline copy — it does not update
   itself.** `rig.starter.json` carries `constitutionInline`, and `demo/starter.test.mjs` (plus
   `demo/commit-model.test.mjs` and `demo/seat-commit-instructions.test.mjs`) assert it equals
   `constitution.txt`, EOL-insensitively. `[judgement]` Regenerate that one field to the new text — set
   `constitutionInline` to the exact contents of `constitution.txt`, change nothing else. Do **not** run
   `scripts/apply-commit-discipline.mjs`: it is a one-shot 2026 amendment that also overwrites
   `P2 Authority`, so running it now would revert later edits.
4. Apply the change:
   ```bash
   DURIAN_PI_DB=./selfdev.sqlite node cli.mjs up rig.selfdev.json --refresh
   ```
   The JSON reports `refreshed`, and for a model change `modelMismatch` / `modelReset`.
5. Restart:
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
- **A `constitution.txt` change reached the starter.** If the change edited `constitution.txt`:
  ```bash
  node demo/starter.test.mjs   # exit 0 — the inline equals constitution.txt (EOL-insensitive)
  ```
  The same drift is asserted by `demo/commit-model.test.mjs` and `demo/seat-commit-instructions.test.mjs`;
  all three must exit 0 before the change is called applied.

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
2026-10-17: the P3 Runbooks rewrite (`fa4b22f`) changed `constitution.txt` but not `rig.starter.json`'s
inline copy, so `demo/starter.test.mjs` and the two commit-instruction demos failed the drift assertion —
and the change had been committed without the suite being run. Confirmed against `fa4b22f~1` (0
differing lines before, 1 after) that the edit caused it, then synced (`b52133f`), suite 115/0. **Syncing
the starter inline and running `demo/starter.test.mjs` is part of any constitution edit, not a separate
task.**
