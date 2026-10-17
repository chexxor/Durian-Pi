---
incident: <slug>                      # filename stem after the date; stable id, matched by `check`
date: YYYY-MM-DD
severity: sev1                        # sev1 = rig unusable / data risk | sev2 = a capability broken | sev3 = degraded
status: open                          # open | mitigated | resolved
symptom: "<the words a person would type>"   # mirror the runbook symptom it maps to
runbook: <runbook-stem|null>          # the procedure that covers/was produced by this incident
fix: <"#NNN"|"<sha>"|null>            # the landed fix (item or commit), or null while open
prevention: "<#NNN|check-rule|test|runbook|null>"   # the DURABLE change so it cannot recur
last_reviewed: YYYY-MM-DD             # bumped when the record is re-reviewed (not rewritten)
---

# <one-line title of what broke>

*Incident YYYY-MM-DD; detected by <who/how>; analysis by <who>.*

## Summary
<2–4 sentences: what happened, the impact, and the one-line root cause.>

## Timeline
- `HH:MMZ` <event>
- `HH:MMZ` <event>

## Impact
<blast radius: who/what was blocked, for how long; any data risk.>

## Root cause
<the mechanism, named — not only the symptom. Mark UNVERIFIED explicitly if it is not proven.>

## Detection
<how it was noticed — a `status` attention, a failing demo, a log line, a human. The durable
detection (a check rule / attention kind) is better than "someone noticed".>

## Resolution
<what was done to restore service.>

## Prevention
<the durable change: a runbook update, a `check` rule, a demo, a ROADMAP item. `prevention: null` means
none yet — say so plainly rather than claiming a lesson.>

## Evidence
<every external claim cites a command, store entry id, commit, or file:line. This section is the proof,
not a summary.>

## Links
<runbook, ROADMAP item, queue items, related incidents.>
