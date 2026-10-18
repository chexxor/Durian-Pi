---
runbook: compact-a-seat
symptom: "a seat's context is saturated and a full reset would lose durable context"
writes: true
precondition: "none"
last_verified: 2026-10-18
verified_by: devtools
evidence: "#1904 (demo/compact-spool.test.mjs — broker applies op:compact live) + #873 (demo/compact.test.mjs)"
check_rule: null
---

# Compact a seat (summarize the old context without losing it)

## When to use
A seat's model context is saturated — turns are slow and every turn re-reads a bloated history — and a
full `reset` would throw away context the seat still needs. `compact` summarizes the OLDER turns into a
summary entry and keeps the rest.

## Impact
If you do nothing: the seat keeps re-reading a bloated context (slower, costlier turns) or you reach for
`reset` and lose durable context. Blast radius: one seat's model CONTEXT — the durable transcript is
never deleted (a compaction writes a summary entry; it is not a deletion).

## Preconditions
None with respect to the broker: with a broker alive, `compact` ROUTES through the command spool
(#1904 / ROADMAP 71) — the broker applies it with its OWN harness (single writer + scheduler), so the
rig keeps running and an in-flight generation on the target seat is not killed. With NO broker, the
same command opens its own harness (the direct path) and refuses a seat holding a live generation lease
(the external-writer guard).

## Diagnose (read-only)
```bash
DURIG_DB=./selfdev.sqlite node cli.mjs status
DURIG_DB=./selfdev.sqlite node cli.mjs log <seat> 6
```
A very long history with no recent `pi.compaction` entry, and a seat that is still progressing (so a
reset would lose work), is the case this runbook is for.

## Do
1. With a broker running, just run the verb — it is routed through the spool and applied LIVE by the
   broker; the report carries `viaSpool: true`, the `requestId`, and the `summaryEntryId`. The optional
   trailing text is folded into the summarization prompt; omit it for a plain compaction.
   ```bash
   DURIG_DB=./selfdev.sqlite node cli.mjs compact <seat> "fold the early turns into a summary; keep the latest work"
   ```
   The producer form is equivalent (and needs no CLI):
   ```bash
   DURIG_DB=./selfdev.sqlite node intent.mjs <seat> --op compact --instructions "fold the early turns"
   ```
2. With NO broker running, the same command opens its own harness (the direct path) and refuses a seat
   holding a live generation lease — wait for the run to settle, or `stop <seat>` first.

## Verify
```bash
DURIG_DB=./selfdev.sqlite node cli.mjs log <seat> 6
```
Expect a `"kind": "pi.compaction"` entry among the newest entries, matching the `summaryEntryId` the
`compact` report returned. The verb fails loud when no summary entry was written, so an `ok:true` report
always means a real summary landed.

## If it fails
- `compact via the spool (broker pid …): <reason>` → the broker DEAD-LETTERED the request with that
  reason (e.g. `unknown seat`, or `compact: no pi.compaction entry was written`). Read the reason, fix
  it, retry — a routed compaction is never a silent no-op.
- No broker, and it refuses "holds a live generation lease" → wait for the run to settle, or
  `stop <seat>`, then retry.
- The seat still overflows: a second `compact` folds the newer turns into the existing summary; if the
  context can be dropped entirely, use `reset` (docs/runbooks/seat-reset.md).
- The summarization model errored: the task retries per the retry policy, then fails terminal; the
  transcript is intact — just retry the verb.

## Escalate to
The operator — a compaction that keeps failing points at the model/provider, not at the rig.

## Evidence
#1904 (2026-10-18): `demo/compact-spool.test.mjs` (exit 0) proves the BROKER applies `op:compact` with
its own harness through the spool — a REAL `pi.compaction` summary entry lands and is reported as
`summaryEntryId`, a duplicate `requestId` applies once, and the seat is not aborted.
#873 (2026-10-17): `demo/compact.test.mjs` (exit 0) proves the live-lease refusal, that a REAL summary
entry is placed and reported as `summaryEntryId` (not just a task id), and that the earliest turn stays
in the durable transcript.
