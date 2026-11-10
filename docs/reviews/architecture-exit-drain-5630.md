---
review: exit-path-final-drain
item: #5630
seat: architect
asked_by: pm
date: 2026-11-10
tree reviewed: main @ f192f543 (read via `git show main:<path>`); probe run in worktree item-5630
status: review-before-ship — the RM-329 1/3 BUILD has not landed, so this is a verdict on the design
        against the code as it is, not on shipped code
---

# The exit path never visits the spool: RM-329 1/3 reviewed against current main

## 0. Prerequisite, measured — and the correction to this row's own premise

The row says "run `git merge-base --is-ancestor b66cce92 main` FIRST; if it fails, that is the finding".
Per my own amendment (#5681), **ancestry is the wrong test**: the spec commit's *content* is what matters,
and a landing that squashes or rebases breaks ancestry while the content is on main. Measured by file
presence instead:

```
git ls-tree -r main --name-only | grep -i 329
  docs/reviews/architecture-329-3of3-broker-state-truthfulness-2026-11-07.md
  docs/reviews/architecture-shutdown-strand-329.md
```

**The spec is on main.** So the prerequisite passes and the review may proceed.

And the thing this row expected to review does **not** exist on main:

```
git ls-tree -r main --name-only | grep -i "shutdown-strand|strand"
  demo/broker-strand.test.mjs        # ROADMAP 68 — stranded SUBMISSIONS, a different fault
  demo/stranded.test.mjs             # ROADMAP 37a — admitted-not-started attention
  tools/stranded-inbox.mjs           # the census, present
git show main:demo/broker-shutdown-strand.test.mjs   # no such file
git show main:src/broker.mjs | grep -n deadLetterIntent
  288 (definition), 775, 791, 812, 844, 857 — all inside drainIntentInbox. Never on the exit path.
```

`drainIntentInbox` is called from exactly two places on main — **1322** (start of a pass) and **1809**
(the idle read-only branch). Both are inside the loop. The exit sequence is
`waitForIdle` (`2092-2097`) → `clearInterval(heartbeat)` (2099) → `EXIT` log (2102) → return (2103).
**F1 from #5275 is still open on main.** Branches `item-5534`, `item-5540`, `item-5548` do not exist in
the ref set (587 refs enumerated), so no tip was ever produced for this review. Verdict: review the
design, pin the acceptance with a probe, and route the build — do not certify code that is not there.

## 1. The defect, measured today

Probe: `node tools/probes/exit-path-final-drain.mjs` → **exit 0, 5 measured failures**. It runs a real
bounded broker on a throwaway store, writes one intent *after* the last drain, requests the cooperative
stop, and reads the spool as it is left at exit:

```
  timeline: intents in inbox before stop = 1; exit line: 2026-11-10T14:53:11.478Z EXIT pid=3356620 reason=stop passes=1
  at exit: inbox=1 dead-lettered=0 reason files=0 result rows=0
  replay arm: after a second broker, inbox=0 dead-lettered=0 result rows=1
  FAIL  A1 inbox is empty at exit ...
  FAIL  A2 residue carries an error file
  FAIL  A2 the dead-letter names the EXIT cause in its .reason
  FAIL  A3 the caller got a verdict it can read (result row or dead-letter)
  FAIL  A3b residue is terminal at exit (the next run does not replay it)
```

The same fault on the live rig, right now, read-only:

```
node tools/stranded-inbox.mjs /home/chexxor/Git/Durian-Pi/selfdev.sqlite   # exit 0
  SUMMARY inbox=9 shutdownStranded=0 drainStranded=9 resultFiles=0 hbAgeS=5 progressAgeS=22731
```

A broker whose heartbeat is **5 s old** and whose last PASS is **22,731 s old** is "alive" for routing
purposes and dark for work: nine spooled reads (`op=read view=queue|queue-census`, ages 3,437–22,078 s)
sit undrained, and **zero** result rows exist. That is shape (b) and (c) of 329 at the same time, on the
production store, today.

## 2. The seam, drawn

```
 cli.mjs / readclient ──writeIntent──▶ <db>.broker.inbox/  (a FILE; no store opened)
                                        │
              drainIntentInbox ─────────┤  called ONLY at pass start (:1322) and the idle branch (:1809)
                                        │
                                        ├─▶ apply + result row in .inbox.out, then unlink
                                        ├─▶ dead-letter to .inbox.error/<id>.error.json + .reason
                                        └─▶ NOTHING after the last `break`  ← the unswept window
 next broker run ──readIntentFiles replays every pending file──▶ applies it ─▶ result row for a
                                                              caller that already rmSync'd its slot
                                                              (src/readclient.mjs:49)
```

Input contract of the exit path today: it receives the stop reason and the grace; it produces an `EXIT`
log line and a cleared broker-state file. It is **not** responsible for the spool — and that is the gap,
because the spool's only other sweep happens before the last break.

## 3. The four acceptance checks, adjudicated

**(1) Fail-do-not-requeue.** Correct as a rule, wrong as written. The row says "requeue only for ops
carrying the existing `runToken` epoch tag". There is **no such tag on a spool op**: `runToken` lives in
the broker-state file only (`src/broker.mjs:2318`), and every `writeIntent` call site
(`src/readclient.mjs:37`, `cli.mjs:1586`, `cli.mjs:1960`) stamps `{op, view, from, requestId, createdAt}`
and nothing else. **Concrete fix:** do not invent an epoch tag. The drain already has an idempotency
guard — `if (readIntentResult(dbPath, requestId)) { unlink; duplicates += 1; continue; }`
(`src/broker.mjs:785-789`). Dead-letter at exit, unconditionally. Requeue is the option that must be
justified, not the default, because the guard's proof **expires**: `INTENT_RESULT_TTL_MS = 10 * 60_000`
(`src/broker.mjs:393`) GCs the result rows, so a replayed intent older than 10 minutes is applied a
second time. My probe's replay arm shows the mechanism plainly: the stranded intent was consumed by the
next broker and produced exactly one result row — harmless for a read, and for an enqueue it would be a
second delivery once the ledger has aged out.

**(2) The final drain must be bounded by remaining grace.** Not measurable today because there is no
final drain. The bound has to be *inherited*, not re-derived: the exit path already computes
`remaining = graceMs > 0 && at !== null ? Math.max(0, graceMs - (now() - at)) : 0` (`:2094`) for the
idle wait. The drain must use the same `remaining`, and a drain that cannot finish inside it must
dead-letter the rest rather than hang. **Concrete falsifiable test:** set `DURIG_STOP_GRACE_MS=1`, put
10 intents in the inbox, assert the process exits within grace+margin and that every intent is either
delivered or dead-lettered — never left.

**(3) The demo's asserted quantities.** The row is right that the assertion must be a **RESIDUE COUNT,
not a file count**, and right about the channel: `deadLetterIntent` (`:288`) already writes the
`<id>.error.json` + `.reason` pair that `readIntentError` (`:335`) and `awaitIntentResult` (`:363`) poll,
so the producer sees the cause through the channel it already reads. No new side channel is needed — and
adding one would be the failure, because the two would disagree.

**(4) The census baseline.** Recorded baseline was `inbox=7 / drainStranded=7`. Measured now:
`inbox=9 / drainStranded=9`. The tool exists and exits 0; nothing in the conformance layer runs it —
`grep -n "inbox" src/checkup.mjs` finds no rule. A census nobody calls is observability that exists only
for whoever remembers the command.

## 4. Failure modes, each with a recovery path

| Mode | Mechanism at this seam | Recovery | Falsified by |
|---|---|---|---|
| **Silent** | intent written after the last drain; no dead-letter, no result, no diagnostic | dead-letter at exit naming `reason=<stoppedBy>` | probe line `A2 … no .reason file` |
| **Loop** | an unbounded exit drain waits on a wedged pass; the exit path becomes the wedge it fixes | bound the drain by `remaining` from `:2094`; dead-letter the remainder | `DURIG_STOP_GRACE_MS=1` with 10 intents; exit must be bounded |
| **Cascade** | result-row GC (`TTL 10 min`) erases the idempotency proof, so a replayed mutating op applies twice | fail-closed: dead-letter, never requeue | probe replay arm; a build that requeues must assert the guard survives GC |
| **Contradiction** | the log says `EXIT reason=stop` while the spool still holds work | the same exit must emit both: the EXIT line and a residue count, e.g. `EXIT … residue=N` | assert the EXIT line carries a residue count |
| **Partial** | drain runs but storage is already closed → `apply failed: SqliteStorage is closed` (shape (a), already dead-lettered) | the drain must run **before** the handle closes | assert order in the exit sequence |
| **Unbounded** | 25 MB audit log, no rotation (measured on this rig) | a bounded reader + cap | `ls -l <db>.broker.*` |
| **Context** | nothing reads the census, so a stranded population never reaches a seat or the operator | a `check` rule calling `tools/stranded-inbox.mjs`'s classifier | the rule must exist and be counted in `cli.mjs check` |
| **Wrong-question** | routing decides on LIVENESS while work decides on PROGRESS | one `brokerHealth` predicate feeding both (`#5631`'s scope) | `progressAgeS=22731` with `hbAgeS=5` is the signature the rule must catch |

## 5. Options and the trade-off I accept

- **(a) Dead-letter everything at exit.** Simple, terminal, legible; costs the work — an operator message
  spooled during shutdown is refused rather than performed. Accepted, because refusal with a named cause
  is recoverable by a human, and silent replay is not.
- **(b) Requeue with an epoch tag.** Preserves the work, requires a field that does not exist, and its
  safety depends on a ledger that expires in 10 minutes. Rejected.
- **(c) Have the client refuse to write once a stop is pending.** Closes the window from the producer
  side, but `writeIntent` is file-based and the stop flag can flip between the check and the write — a
  race in the very layer that is supposed to be the gate. Keep as a **layer**, not the fix.

**Decision to mint at landing (per #3077, D-numbers are minted at land time, never hardcoded in a
branch):** the broker's exit path is responsible for the spool it owns. One final drain, bounded by the
grace already computed, residue dead-lettered with the exit reason, and **never** requeued. The invariant
is: at process exit, `<db>.broker.inbox/` is empty.

## 6. What must be built (routed, not done here)

1. In `runWakeLoop`, before `clearInterval(heartbeat)` and before the harness closes:
   `await drainIntentInbox(h, probeStorage, { dbPath, context, onDiagnostic, readStorage })` bounded by
   the `remaining` grace already computed at `:2094`; anything left after the bound is dead-lettered with
   `broker exited (reason=<stoppedBy>)`.
2. Emit the residue count on the EXIT line so the exit is auditable from one place.
3. `demo/broker-shutdown-strand.test.mjs` asserting: inbox-empty-at-exit, the `.error.json`/`.reason`
   pair naming the exit cause, a **residue count** not a file count, and that the cause reaches
   `awaitIntentResult` through `readIntentError`. RED without the fix — the probe above is the baseline.
4. Wire the stranded-inbox census into `check` as a rule, so the population is visible without
   remembering a command.

## 7. Evidence

- `node tools/probes/exit-path-final-drain.mjs` → exit 0; 6 assertions, 5 failures; output quoted; scratch
  dirs removed by the probe.
- `node tools/stranded-inbox.mjs /home/chexxor/Git/Durian-Pi/selfdev.sqlite` → exit 0; `inbox=9
  drainStranded=9 resultFiles=0 hbAgeS=5 progressAgeS=22731`.
- Code read from main @ f192f543: `src/broker.mjs:761` (drain), `:288` (dead-letter), `:785-789`
  (idempotency guard), `:393` (result TTL), `:2092-2103` (exit sequence), `:1322`/`:1809` (the only two
  drain call sites), `:2318` (runToken lives in broker state, not in intents).
- Dependency caveat for this worktree: the `sync-pi --link` step failed, so this tree resolves
  `@earendil-works/pi-durable 1.3.0` from the lockfile while the seat root resolves **1.5.1**. A suite
  result here is not comparable with one from the seat root; the probe's findings are about the spool
  files and the broker loop, not about pi-durable internals.
