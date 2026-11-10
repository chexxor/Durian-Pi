---
review: the exit path must account for the spool without touching the store
item: #6391
seat: architect
asked_by: pm
date: 2026-11-11
tree reviewed: main (worktree item-6381)
probe: tools/probes/exit-path-final-drain.mjs (now a gate: exit 1, 6 measured failures; it exited 0 while printing FAIL lines)
status: design position; impl builds (#6390)
---

# The gap, measured

`runWakeLoop` computes the remaining grace for the idle wait and then closes:

```
if (stoppedBy === "deadline" || graceExpired()) {
  const remaining = graceMs > 0 && at !== null ? Math.max(0, graceMs - (now() - at)) : 0;
  await settleWithin(h.waitForIdle(context), remaining);
} else { await h.waitForIdle(context); }
...
logBrokerLine(dbPath, `EXIT pid=${process.pid} reason=${stoppedBy ?? "unknown"} passes=${passes}`);
```
(`src/broker.mjs:2201-2212`) - the spool is never visited. Measured with a real bounded broker on a throwaway store: one intent written after the last drain is still in `<db>.broker.inbox` at exit, nothing is dead-lettered, no reason file, no result row, and a second broker run consumes it and produces a result row for a caller that stopped waiting 90 seconds earlier.

The probe asserted five things and printed FAIL lines while exiting 0. I changed it to exit 1 on any failure; a probe that cannot fail is not an acceptance, and this one is the only thing standing between "the exit path is verified" and "nobody ever re-tests the exit path".

# The decision worth keeping, and the one the row leaves unmade

**Do not requeue** - agreed, and the evidence is sound: no spool op carries a `runToken` epoch (it lives only in the broker-state file), and the idempotency guard is a result file that GCs after `INTENT_RESULT_TTL_MS` = 10 minutes (`src/broker.mjs:397`, `:417`). Requeueing on an expiring guard is a double-apply, and the replay arm shows exactly that shape: the next broker applies the stranded intent.

**Unmade decision: what the final drain is allowed to touch.** `drainSpool` calls `await harness.snapshot(Seats, ...)` for every non-read op (`:807-808`) and `applyRequest` runs against the harness handle. At exit that handle is either closing or wedged - and the closed-handle branch *rethrows* (`:866-878`) so the pass reaches a recovery branch. On the exit path there is no pass left to recover: a throw there is an exit that either crashes or hangs past the grace, and the supervisor's kill-on-wedge then leaves the spool half-processed.

So the exit drain must be **filesystem-only**: parse the spool, classify each intent, and refuse everything that cannot be applied with a structured cause (`broker-exiting`, reason = `stoppedBy`). Dead-lettering (`deadLetterIntent`, `:288`) and result writing (`writeIntentResult`, `:384`) are plain file operations; they work with no store. Reads that need the harness must not be attempted at all - they get the same refusal, and the producer learns it in one poll instead of timing out at 120 s.

That is the difference between "drain the spool at exit" and "account for the spool at exit". The invariant is that every intent is *resolved*, not *executed*.

# Failure modes, recovery, check

| failure | class | recovery | check |
|---|---|---|---|
| the final drain calls the harness and it is closed/wedged | hang / cascade | no harness calls on the exit path; refuse-all with a cause | run the probe with the handle closed; exit stays bounded |
| `remaining` is 0 on a deadline exit | hang | a drain that must not wait: refuse immediately, never await | probe with a grace already expired |
| residue replayed by the next broker | double-apply, silent | terminal at exit (dead-letter + verdict) | A3b: intents before stop = dead-lettered + result rows |
| an operator's control op issued seconds before a stop is dropped | contradiction | the exit line reports residue **by op class** (`residue=2 read=1 control=1`) and the refusal names the cause so the operator re-issues | A4 in the probe |
| partial drain: some intents handled, some left | contradiction between the log line and the spool | one pass, count on the same line, before the EXIT line is written | the EXIT line itself carries the count |
| the caller polls and gets nothing | partial | write the refusal into `.broker.inbox.out`, the channel `awaitIntentResult` already reads (`src/broker.mjs:363-390`) - ties to the #6372 finding | A3 |
| the census rule invents its own parse of the exit line | drift | the format is the contract: `EXIT pid=... reason=... passes=N residue=<n> read=<n> control=<n>`; the RM-329 census (#6392) reads it, not a side channel | the probe asserts the field exists |

The trade-off to state out loud: refusing at exit **loses** an operator command that was issued during shutdown. The alternative - applying it - risks a mutating op landing against a store that is closing, which is a partial write with no audit. Loss with a verdict beats a partial apply, because loss is recoverable by re-issuing and a partial apply is not. That is only true if the loss is legible, which is why the op-class count on the exit line is not decoration: it is what makes the decision auditable from one line.

# Options considered

- **(a) drain-and-apply at exit.** Rejected: the drain needs the harness for anything mutating, and the exit is exactly where the handle is unreliable.
- **(b) account for the spool with no store access - refuse-all with verdicts.** The choice. Terminal, filesystem-only, bounded by the grace already computed, and it reuses the producer channel rather than inventing one.
- **(c) requeue with an epoch tag on every spool op.** Rejected at this scope: it is a schema change to every producer, and the TTL-expiring guard makes it unsafe regardless of the tag. It remains available later if the rig ever needs cross-run intent delivery.

Reversibility: (b) can be widened to serve read-only intents later, since it changes only the refusal branch, not the structure of the exit path.
