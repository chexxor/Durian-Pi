---
runbook: per-row-marker
symptom: "how do I know whether a held landing row's work actually landed on main, and what marker do I probe for"
writes: false
precondition: "read-only"
last_verified: 2026-10-21
verified_by: scribe
evidence: "2026-10-21 audit of 40 held landing rows against main (the marker had to be tightened TWICE); caret case: a row asked for an EXACT pin `1.3.0`, main carries `^1.3.0` (package.json) — a row-specific marker read the caret as the same intent in a different form and closed it correctly; `registry` appears on main for unrelated reasons (127 files) — the bare-identifier false positive"
check_rule: null
---

# Choose a per-row marker to probe main (per-row-marker)

## When to use
You are auditing held landing rows against `main` and must decide whether each row's work actually
landed. The decision turns on the marker you probe for: pick the wrong one and you either close a row whose
work is missing (a landing that never happened) or call a landed change absent.

## Impact
**BARE IDENTIFIERS give FALSE POSITIVES** — the expensive error: `registry`, `positional` appear on `main`
for unrelated reasons (measured: `registry` in 127 files), so a row reads as "landed" when its change is
absent, and the queue then reports a landing that never happened. **WHOLE ADDED LINES give FALSE
NEGATIVES** — a fix reimplemented in a different form has none of its original lines, so a genuinely-present
change reads as absent. Both errors come from trusting what the diff happened to contain instead of what
the row said it would do.

## Preconditions
read-only. You probe `main` with `git grep` / `git show`; you never modify `main` or the rows while
choosing the marker.

## Diagnose (read-only)
Probe a candidate marker against `main`:
```bash
git grep -n "<candidate-marker>" main -- <path-or-glob>
```
Empty result is NOT proof of absence by itself — it may be a marker shaped wrong for how the work landed
(see Do, the caret case).

## Do
1. **USE A ROW-SPECIFIC MARKER CHOSEN FROM THE ROW'S OWN DESCRIPTION**, not from what the diff happened to
   contain: `^1.3.0` for a pin row, `readIntentFiles` for a broker row, `P2 Cleanup` for a constitution
   row. THE MARKER COMES FROM WHAT THE ROW SAID IT WOULD DO.
2. **THE CARET CASE (why a row-specific marker beats an added-lines probe):** a row asked for an EXACT pin
   `1.3.0`; `main` carries `^1.3.0`. THE PIN LANDED, AS A CARET. A generic added-lines probe saw no match
   and would have called the row unlanded; a row-specific marker reads the caret as the same intent in a
   different form and closes it correctly.
3. **GRADE YOUR CERTAINTY, IN TWO NAMED LEVELS:** a row checked by a ROW-SPECIFIC marker is **SOLID**; a
   row checked only by "the new file is absent" is **"genuinely absent by new-file evidence"**, not by
   marker. Name the grade so a reader knows which closes are supported and which are inferences — a single
   confidence level would make both look alike.
4. **DO NOT BULK-CLOSE.** A row closed because it is old is how unlanded work stays unlanded while the
   queue looks clean — the audit that produced this note found FORTY of SIXTY-TWO rows in exactly that
   condition.

## Verify
The caret case, reproduced: probe `main` for the pin row's intent and see it present in a different form:
```bash
git show main:package.json | Select-String "1\.3\.0"     # expect ^1.3.0 — the pin landed as a caret
```

## If it fails
Your marker was ambiguous (too generic → false positive, or too specific → false negative). Pick a MORE
row-specific marker from the row's own description and re-probe; if the row describes a capability that a
reimplementation could satisfy in any form, prefer the row-specific intent over any single added line.

## Escalate to
the owner of the audit's dispositions — this runbook decides HOW to choose a marker, not WHETHER a row is
closed; a row's disposition (landed / unlanded / re-routed) belongs to the seat that owns the audit.

## Evidence
2026-10-21 audit of 40 held landing rows against `main`: the marker was tightened twice (bare identifiers →
whole added lines → row-specific), the caret case (`^1.3.0` on main for a row that asked for `1.3.0`)
showed the row-specific marker closing correctly where an added-lines probe would not, and `registry`'s 127
files on main demonstrated the false-positive direction. last_verified 2026-10-21 (scribe).
