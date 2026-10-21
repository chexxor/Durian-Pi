---
runbook: broker-safe-change
symptom: "a model/constitution/reset change must apply without corrupting the store"
writes: true
precondition: "broker-stopped"
last_verified: 2026-10-20
verified_by: delegate
evidence: "2026-10-20 force-stop recovery measured end to end: serve --stop returned stopped:false twice under a held genlock, broker pid 4528 killed, leases cleared after the pid was proved dead, restarted broker pid 13228 advanced passes 63+, stale stop request consumed on the first start (stoppedBy=deadline passes=1) and the second start stayed resident; suite pass=180 fail=1 (pitui). Earlier: constitution reload fa4b22f + starter-inline sync b52133f."
check_rule: null
---

# Apply a spec change safely (model / constitution / reset)

## When to use
You changed a seat's model in `rig.selfdev.json`, edited `constitution.txt`, or need a context reset, and
it must take effect without corrupting the store. If your change edits `constitution.txt`, you must ALSO
regenerate `rig.starter.json`'s `constitutionInline` in the same change and run the three
constitution-mirror demos (`demo/starter.test.mjs`, `demo/commit-model.test.mjs`,
`demo/seat-commit-instructions.test.mjs`) before landing — see [constitution-amendment.md](constitution-amendment.md).

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

## When `serve --stop` will not settle — the FORCE-STOP recovery order (verified 2026-10-20)

`serve --stop` returns `"stopped": false` while a generation lease (`<db>.genlock.*`) is held. Retrying it
is the correct first move; the second retry is often enough because the run settles between passes. If the
operator directs speed over grace, killing is LEGAL — but do it in this order, or you inherit a store that
*looks* fine and a queue that silently stops moving:

```bash
# 1. Kill the broker (and only the broker — never a seat's own worktree)
powershell -NoProfile -Command "Stop-Process -Id <brokerPid> -Force"
# 2. PROVE the pid is gone before touching its bookkeeping
powershell -NoProfile -Command "if (Get-Process -Id <brokerPid> -ErrorAction SilentlyContinue) {'alive'} else {'dead'}"
# 3. Now clear the leases the dead pid still "holds". Only after step 2.
rm -f <db>.genlock.*
# 4. Restart the broker exactly as the operator does
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/serve-noroot.ps1
# 5. Confirm it STAYS up (see the deadline trap below) and that the queue moves again
tail -3 <db>.broker.log          # passes must advance
```

**What the kill leaves behind, measured 2026-10-20:**
- **Stranded leases.** `status` reported it exactly: genlock `held by pid 4528 (impl), which is gone`. A
  dead holder does not block `land.mjs` (it only blocks on an ALIVE pid), but it does confuse every later
  reader, so clear it. Deleting a lease whose holder is gone is lossless; deleting one whose holder LIVES
  is the second-writer corruption this runbook exists to prevent.
- **Stranded submissions.** Two seats were left `admitted_not_started` (`impl` #153640, `auditor`
  #153251). The restarted broker re-drove them; nothing had to be `resume`d by hand. **Check
  `admitted_not_started` after a restart** — if one still reports "no run started and no slot held" once
  passes are advancing, only then does it need attention.
- **A stale STOP REQUEST survives the kill.** The restarted broker read it and exited after ONE pass with
  `"stoppedBy": "deadline"` and `EXIT pid=… reason=deadline passes=1` in the log — this is NOT a crash
  and NOT the wedge. The exit path clears the request, so **start it again**; the second start stays up.
  Read `passes=1` as "it honoured a stale stop", not as "the broker is broken".
- The store itself survived (a backup was taken first: `cp <db> .spike/store-backup-<stamp>.sqlite`).
  **Back up before a force stop** — it is the only cheap insurance against the one outcome that is not
  recoverable by restarting a process.

### Evidence
2026-10-20 (delegate, operator-directed model move): `serve --stop` returned `stopped:false` twice while
`impl` held two leases; broker pid 4528 was killed. Recovery followed the five steps above: leases cleared
after the pid was proved dead, broker restarted as pid 13228, passes advanced (63+), a first start exited
`stoppedBy=deadline` from the stale stop request and the second start stayed resident. Suite afterwards
`pass=180 fail=1` (`pitui`, #2412) — the store was intact.
