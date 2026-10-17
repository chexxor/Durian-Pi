---
runbook: compact-a-seat
symptom: "a seat's context is saturated and a full reset would lose durable context"
writes: true
precondition: "broker-stopped"
last_verified: 2026-10-17
verified_by: impl
evidence: "#873 (demo/compact.test.mjs; Verify run 2026-10-17)"
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
`compact` is a **write verb** (it writes a summary entry), so it needs the broker stopped and verified —
the same single-writer rule as `reset` (docs/COMMANDS-AND-THE-BROKER.md §4). It also refuses while the
seat holds a live generation lease.

## Diagnose (read-only)
```bash
DURIG_DB=./selfdev.sqlite node cli.mjs status
DURIG_DB=./selfdev.sqlite node cli.mjs log <seat> 6
```
A very long history with no recent `pi.compaction` entry, and a seat that is still progressing (so a
reset would lose work), is the case this runbook is for.

## Do
1. Stop the broker and confirm it exited (`stopped: true`); `compact` refuses while the broker drives.
   ```bash
   DURIG_DB=./selfdev.sqlite node cli.mjs serve --stop
   ```
2. Compact the seat. The optional trailing text is folded into the summarization prompt; omit it for a
   plain compaction.
   ```bash
   DURIG_DB=./selfdev.sqlite node cli.mjs compact <seat> "fold the early turns into a summary; keep the latest work"
   ```
3. Restart the broker the way it was started.

`compact` refuses a seat holding a live generation lease ("refusing to compact a running seat") — wait
for the run to settle, or `stop <seat>` first.

## Verify
```bash
DURIG_DB=./selfdev.sqlite node cli.mjs log <seat> 6
```
Expect a `"kind": "pi.compaction"` entry among the newest entries, matching the `summaryEntryId` the
`compact` report returned. The verb fails loud when no summary entry was written, so an `ok:true` report
always means a real summary landed.

## If it fails
- `compact` refuses ("holds a live generation lease") → wait for the run to settle, or `stop <seat>`,
  then retry.
- The seat still overflows: a second `compact` folds the newer turns into the existing summary; if the
  context can be dropped entirely, use `reset` (docs/runbooks/seat-reset.md).
- The summarization model errored: the task retries per the retry policy, then fails terminal; the
  transcript is intact — just retry the verb.

## Escalate to
The operator — a compaction that keeps failing points at the model/provider, not at the rig.

## Evidence
2026-10-17, item #873: `demo/compact.test.mjs` (exit 0) proves the live-lease refusal, that a REAL
`pi.compaction` summary entry is placed and reported as `summaryEntryId` (not just a task id), and that
the earliest turn stays in the durable transcript. The Verify above was run the same day against a
scratch DB seeded to saturation: `compact` exited 0 with `"summaryEntryId": 131`, and
`node cli.mjs log stuffed 6` showed the `"kind": "pi.compaction"` entry.
