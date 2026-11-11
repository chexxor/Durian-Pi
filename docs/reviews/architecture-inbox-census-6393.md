---
review: the inbox census must be a rule with an input contract, not a tool someone might run
item: #6393
seat: architect
asked_by: pm
date: 2026-11-11
tree reviewed: main (worktree item-6393)
probe: tools/probes/inbox-census-rule.mjs (exit 1, 5 measured failures)
status: design position; devtools builds (#6392)
---

# The shape of the fix

`auditRig` (`src/checkup.mjs:433`) already takes its evidence as resolved parameters — `citations`, `sharedTreeBranch`, `sharedTreeLinked`, `contextBySeat` — and never opens a store itself. That is the right seam, and it is the reason the census should be **a parameter, not a computation inside the rule**:

```
auditRig({ ..., inboxCensus: { inboxCount, errorCount, resultCount, stuckSink, oldestAgeS, lastPassAt, brokerResident, exitResidue } })
```

The CLI walks `<db>.broker.inbox`, `<db>.broker.inbox.error`, `<db>.broker.inbox.out` and the broker-state/log files, and hands auditRig the counts. `check` then reports a finding through the existing helper `add(id, subject, detail, fix)` (`src/checkup.mjs:436-437`), which pushes `{id, severity, subject, detail, fix}` with severity from `SEVERITY_OF` — so the census gets the same severity treatment as every other rule and the probe can find it by `id`.

Measured today: `auditRig({ rig, spec, inboxCensus: {inboxCount: 9, oldestAgeS: 22731, resultCount: 0} })` returns **zero findings** — the parameter is accepted and ignored. That is the same defect class as `workable()` destructuring away its fourth argument (#6381): an input that arrives and is never consulted looks like a checked thing that is not checked.

# The decision table the rule needs

| spool state | verdict | remedy |
|---|---|---|
| fresh broker, empty spool, `lastPassAt` null | no finding | — |
| resident broker, intents seconds old, a pass just ran | no finding | — |
| intents older than the pass interval with no result row and no dead-letter | finding: stranded count + oldest age | `docs/runbooks/intent-stuck-in-inbox.md` |
| `.broker.inbox.error` exists as a **file**, not a directory | separate finding: the sink is unusable | fix the path; the count is a symptom, the sink is the cause |
| residue matching the `EXIT` line's `residue=` field | attributed to the exit, not to a stalled drain | the exit drain (#6390) |

The age test, not the count, is what makes the rule trustworthy. A spool is *supposed* to hold intents between passes; a rule that fires on any non-empty directory cries on normal operation, and a crying rule is muted, which is worse than no rule.

# Failure modes, recovery, check

1. **The rule never runs** (this is the current state). Recovery: it is a `check` rule, so it runs on every `cli.mjs check`. Check: assertion A of the probe.
2. **False positive on a fresh start or an in-flight intent.** Recovery: the decision table above; both directions are asserted (B and E).
3. **The census reads the broker's counters instead of the files.** The counters are the numbers under suspicion; a diagnostic that trusts them is diagnosing its own source. Recovery: counts come from `readdirSync` of the spool directories. Check: assertion C passes a census that says 4 files while `brokerCounters.stranded` says 0, and requires the finding to report 4.
4. **The census opens the store and is starved by the very condition it is reporting** — a broker wedged on the store is exactly when you want the census. Recovery: filesystem only, no store handle; the same off-store-input pattern as `sharedTreeBranch` and `citations`.
5. **Sink-unusable conflated with residue.** If `.broker.inbox.error` is a file, dead-lettering is impossible and the payload stays in the inbox; reporting "9 stranded" sends the operator to the wrong runbook. Recovery: two findings with two remedies. Check: assertion D.
6. **Unbounded I/O in `check`.** The census must count, not read payload contents; a spool with thousands of files should not make `check` slow or blow context. Recovery: `readdirSync` + `statSync` only; report counts and the oldest age.
7. **The census contradicts the exit line.** #6390 puts `residue=<n>` on the EXIT line; if the census computes its own number from a different moment, `check` and the log disagree and nobody knows which to trust. Recovery: the census reads the EXIT line and attributes exit residue separately; the format is the contract, stated in the #6391 review.
8. **A demo asserts the tool exists.** That proves nothing about whether anyone invokes it — the same error as the six regex demos reading `ui.mjs` while nothing executes it (#6376). Recovery: the probe asserts the rule *counts*, and the demo asserts the same through `cli.mjs check`.

# Options and the trade-off

- **(a) compute the census inside `auditRig` from a `dbPath`.** Rejected: it couples a diagnostic to store access and re-creates the starvation problem.
- **(b) CLI computes it from the filesystem and passes it as a parameter.** Chosen. Matches the existing rule-input pattern, keeps the diagnostic off-store, and makes the rule testable with a synthetic census — which is how this probe works without a live rig.
- **(c) have the broker self-report stranded counts in its state file.** Rejected: self-reporting is the thing that failed. Independence is the point of a census.

Reversible: the parameter can later carry more classes (read vs control, by-op counts) without changing the seam.
