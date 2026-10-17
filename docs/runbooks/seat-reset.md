# Reset a seat (degeneration, loop, or wrong language)

## When to use
A seat loops (repeats itself / emits tool calls as text), stalls, or works and thinks in a language the
team does not use (observed: `impl`, then `qa`, in Chinese).

## Preconditions
A full context reset is a **write verb** and needs the broker stopped. A light steer does not — it goes
through the broker inbox while the broker runs.

## Diagnose (read-only)
```bash
DURIG_DB=./selfdev.sqlite node cli.mjs status
DURIG_DB=./selfdev.sqlite node cli.mjs log <seat> 6
```
A repeating assistant entry with no tool calls, or CJK in the live stream, confirms it.

## Do
**Preferred — steer without stopping (safe while the broker runs):** deliver an operator directive through
the inbox; the broker submits it to the seat on its next pass.
```bash
# write the directive to a file first (never inline — a backtick would be command-substituted)
DURIG_DB=./selfdev.sqlite node intent.mjs <seat> --body-file .spike/delegate/intent-<seat>-english.txt
```

**Full context reset (breaks a degenerative loop):** stop the broker, reset, restart.
```bash
DURIG_DB=./selfdev.sqlite node cli.mjs serve --stop          # proceed only on "stopped": true
DURIG_DB=./selfdev.sqlite node cli.mjs reset <seat> "Re-anchor: work and think in English; continue your claimed item."
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/serve-noroot.ps1
```
`reset` refuses while the seat holds a live generation lease; wait for the run to settle first.

## Verify
The seat's next run is in English and resumes its claimed item (`log <seat>` / `status`). No `adjudicate`
or repeated identical turns.

> **A GUARD reset can be a FALSE POSITIVE.** The broker's supervisor resets on its own. A bad detector
> has reset healthy seats before (2026-10-16: the D78 prose heuristic false-reset `lead`, `advocate`,
> `scribe`, `auditor`, and `impl` — it counted repeated **words/fragments**, which a healthy long
> document has plenty of; reverted in `449e870`). The guard was revived as a NAMED-PATTERN registry
> (item #875), each pattern validated against every seat's real pages with **zero** false positives.
> Before treating an automatic reset as real, read the run it fired on (`log <seat>`): a REAL loop ends
> in a wall of near-identical micro-sentences (`Emit. OK. Go. Now.` / `Completing:`) and stops acting; a
> healthy long document repeats ordinary words while its sentences stay varied. If the detector is the
> cause, fix the detector — see `degeneration-guard.md` — do not just reset again.

## If it fails
- `reset` refuses ("holds a live generation lease") → wait, or `stop <seat>`, then retry.
- The seat keeps drifting: the durable fix is the `P3 Language` constitution rule plus a model that
  follows it; the constitution must be applied (`broker-safe-change.md`).

## Evidence
2026-10-16: `P3 Language` added to `constitution.txt` (`a0ab993`); English directives spooled to `impl`
and `qa`. Root cause of the first miss: the running seats used a **stale** constitution — the rig's
`constitutionInline` shadowed the file (fixed, `806ce7f`).
