---
runbook: seat-reset
symptom: "a seat loops, stalls, emits a tool call as text, or answers in the wrong language"
writes: true
precondition: "broker-stopped"   # a full reset is a write verb; a steer is not (see Do)
last_verified: 2026-10-16
verified_by: impl
evidence: "items 806/#700; commits f086382+c38815f (D77 detect), 7d62929 (auto re-drive), a0ab993 (P3 Language)"
check_rule: null
---

# Reset a seat (degeneration, loop, wrong language, or a tool call emitted as text)

## When to use
A seat loops (repeats itself), stalls, works and thinks in a language the team does not use (observed:
`impl`, then `qa`, in Chinese), **or** ends a turn having written its tool call into the message TEXT
(`<parameter name="write">…` / a DSML-delimited block) so no tool actually ran — the run settles "done"
while the seat did nothing. The last two are detected automatically (see Do).

## Impact
A degenerate run burns tokens and fills the rig with junk; the text-form tool call additionally leaves
the item silently unfinished (the harness reads the turn as a normal completion, so nothing retries).

## Preconditions
A full context reset is a **write verb** and needs the broker stopped. A light steer does not — it goes
through the broker inbox while the broker runs.

## Diagnose (read-only)
```bash
DURIG_DB=./selfdev.sqlite node cli.mjs status
DURIG_DB=./selfdev.sqlite node cli.mjs log <seat> 6
```
A repeating assistant entry with no tool calls, or CJK in the live stream, confirms a loop / wrong
language. For the text-form tool call, **read the stored entry, not a screen capture**: the terminal
STRIPS the DSML delimiter, so a screen read shows a clean `<parameter>` block and HIDES the fault
(D77).

## Do
**Preferred — steer without stopping (safe while the broker runs):** deliver an operator directive through
the inbox; the broker submits it to the seat on its next pass.
```bash
# write the directive to a file first (never inline — a backtick would be command-substituted)
DURIG_DB=./selfdev.sqlite node intent.mjs <seat> --body-file .spike/delegate/intent-<seat>-english.txt
```

**Detected degeneration is reset for you (no manual step).** The degeneration guard (`src/degeneration.mjs`
`assessRun`) trips a run on identical repeats, harness malformed calls, a runaway tool-turn count, an
over-large prompt, **and a tool call emitted as text** (`pseudo-tool-call=N>=1`, D77); the supervisor
resets the seat with a handoff naming the fault, and **a reset now clears that seat's cooldown and
forces a pass so it is re-driven at once** (`clearSeatCooldown` + `markDirty`, commit `7d62929`). So the
generic stall after a reset is fixed; you do not need to spool a nudge to re-wake a *reset* seat.

**Full context reset (breaks a degenerative loop that did not trip the guard):** stop the broker, reset,
restart.
```bash
DURIG_DB=./selfdev.sqlite node cli.mjs serve --stop          # proceed only on "stopped": true
DURIG_DB=./selfdev.sqlite node cli.mjs reset <seat> "Re-anchor: work and think in English; continue your claimed item."
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/serve-noroot.ps1
```
`reset` refuses while the seat holds a live generation lease; wait for the run to settle first.

## Verify
The seat's next run is in English and resumes its claimed item (`log <seat>` / `status`). For the
detector half, run its test:
```bash
node demo/degeneration.test.mjs    # expect: "PASS — degeneration detector verified", exit 0
```
and for the re-drive half:
```bash
node demo/scheduler.test.mjs       # expect: "SCHEDULER TEST PASS", exit 0
```
No `adjudicate` or repeated identical turns.

## If it fails
- `reset` refuses ("holds a live generation lease") → wait, or `stop <seat>`, then retry.
- The seat keeps drifting: the durable fix is the `P3 Language` constitution rule plus a model that
  follows it; the constitution must be applied (`broker-safe-change.md`).
- A text-form tool call recurs but the detector did not trip: confirm the delimiter is present in the
  stored bytes (the terminal hides it) and file it against `src/attention.mjs` `countPseudoToolCalls`
  (D77) — do not hand-translate the block, which would execute an unvalidated call.

## Escalate to
`impl` — a degenerate run the guard missed, or a reset that did not re-drive, is a code defect; cite
`demo/degeneration.test.mjs` / `demo/scheduler.test.mjs`.

## Evidence
2026-10-16: `P3 Language` added to `constitution.txt` (`a0ab993`). D77 — a tool call emitted as TEXT is
degenerate on first sight: detect (`f086382` + `c38815f`) and reset, never translate; auto re-drive of a
reset seat (`7d62929`). Verified against the real stored entry `35382` (`pseudo-tool-call=1>=1`) and by
the two demos above (both exit 0, `item-806`, 2026-10-16). Root cause of the first language miss: the
running seats used a **stale** constitution (rig `constitutionInline` shadowed the file; fixed, `806ce7f`).
