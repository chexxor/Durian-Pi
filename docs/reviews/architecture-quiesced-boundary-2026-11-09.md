# The quiesced boundary is a base seam, not a seat action — and it does not exist yet

**Status:** design review + durable decision (architect, 2026-11-09). Carried by queue item **#6027**
(PART B of the release-role work; PART A, the inventory/plan, is **#6024**). This document names the
missing seam and what is already present. It proposes nothing that a seat can do to main.

**Subject of review:** how a landing pass gets a *settled store* without a broker-hosted seat killing
its own host. Every line number below is from the tree this review was written in (branch `item-6027`,
base `09a94b4c`).

---

## 1. The topology, drawn before the argument

Three distinct authorities, three different seams. Today two of them are fused and the third is
missing:

```
  PART A  inventory/plan        seat-ownable, continuous      queue + landing list      EXISTS
  PART B  quiesce boundary      BROKER-owned state machine    ???                       MISSING
  PART C  the merge act         operator/delegate authority   scripts/land.mjs + push   EXISTS
```

The constraint that makes PART B necessary is stated in the runbook, not inferred:
`docs/runbooks/land.md:427-431` — "A landing pass CANNOT be driven by a broker-hosted seat. Quiescing
requires stopping the broker, and stopping the broker ENDS the run of any seat hosted by it", with the
2026-10-17 case where the exclusive landing window closed *quiet but empty* for exactly that reason.
`docs/runbooks/merge.md:22-27` gives the hazard that the boundary must remove: a merge touches the
shared working tree, the live rig reads that tree, and because `cli.mjs` statically imports
`src/checkup.mjs`, a conflicted merge there makes **every** `node cli.mjs` verb fail to load.

So the requirement is not "stop the broker". It is "**make the broker itself stop writing while
staying answerable**".

## 2. What already exists (measured, cited)

| Seam | Where | What it actually guarantees | What it does NOT guarantee |
|---|---|---|---|
| rig-level pause (ROADMAP 131) | `src/broker.mjs:1343` reads `controlDoc.value.paused`; `src/driver.mjs:119` (`const hasQueued = !paused && …`) | no seat is **woken to take new work**; the refusal is legible (`onPaused` → `wake-refused-paused`, `src/broker.mjs:1441`) | **the pass loop keeps running**: passes still drain the spool, still apply supervisor resets (`src/broker.mjs:152` `harness.commit`), still write broker state (`src/broker.mjs:1737`, `:1914`) |
| `pause --wait` | `src/broker.mjs:563-586` | returns `{paused, quiesced, waitedMs}`; bounded (`pauseWaitMs`, `src/broker.mjs:605-608`; `demo/pause-wait-bound.test.mjs` exit 0: "a never-settling run returns quiesced:false within the bound") | "quiesced" here means **no in-flight seat run**. It says nothing about passes or writes. |
| control-plane gate | `src/broker.mjs:482` `CONTROL_PLANE_OPS = {"pause","unpause","configure"}` — operator-only (lead #1952/#2215, security #2223) | a seat may not issue a rig-level control op through the spool | it cannot stop *passes*, because pause does not stop passes |
| generation lock | `scripts/land.mjs:25-26` — the lander claims ALL N generation slots and releases on every exit path; `src/genlockreserve.mjs` shared with the broker's in-process gate | no **generation** can start during the landing | the broker is still running passes and writing to the store |
| stop path | `src/broker.mjs:1755` (`STOP-REQUESTED source=signal`), `:2102` `EXIT pid= … reason=` | the process terminates, with a receipt | it kills the requesting seat, and it makes every broker-routed read dark (ROADMAP 303/329) |
| read seam | `src/readclient.mjs:22` `brokerAliveFor`, called at `:110` | routes reads to the broker when a heartbeat exists | it decides on **liveness**, not progress — the RM-329 2/3 defect, still open on `main` |

So the rig has a *pause*, a *generation lock*, and a *stop*. It has no **quiesced state**.

## 3. The missing seam, stated as a contract

**`quiesce` — a broker-owned, authority-gated, resumable state in which the pass loop is parked and the
store write seam is provably idle, while reads remain served.**

Input contract:
- Issued only through the spool as a control-plane op (inherits `CONTROL_PLANE_OPS`), never by a seat
  targeting its own host.
- Carries `requestedBy`, `reason`, and an optional bound (`wait`), reusing the bounded-wait machinery
  already proven by `demo/pause-wait-bound.test.mjs`.

State machine: `running → quiescing (drain in-flight runs, bounded) → quiesced → releasing → running`.
Every transition emits a log line (`QUIESCE state=… seats=… inbox=… slots=…`) so the boundary is
observable from the log, not inferred.

Output contract — while `quiesced`:
1. **No passes.** The loop parks; no `PASS` line is emitted.
2. **No wakes.** Already true under pause, but it must be asserted *together* with (1), not assumed.
3. **No store writes.** No supervisor apply, no queue notice, no `writeBrokerState` mutation of
   `lastPassAt`.
4. **Nothing stranded.** The spool inbox is drained or dead-lettered with a named reason before the
   boundary closes — this is RM-329 1/3, and it is a precondition of the boundary, not a sibling.
5. **Reads stay answerable.** `status`/`queue` must not go dark; a quiesced broker is `degraded`, not
   `down`, which is exactly the RM-329 2/3 predicate (`brokerHealth` at `src/broker.mjs:2239`
   computes `up | degraded | down` from liveness + progress; nothing consumes it on the read path —
   `src/readclient.mjs:22` `brokerAliveFor`, called at `:110`).
6. **A marker, readable without the broker.** `<db>.quiesced.json` — `{requestedBy, at, state,
   seatsInFlight, genlockSlots, inboxCount}` — written to disk, so a lander or a check rule can prove
   the boundary from a **file**, not from a broker-routed read. (Same principle as RM-329 3/3: the
   finding must come from the marker file, because the verbs that would report the state are the verbs
   that hang in that state.)

Not responsible for: the merge itself, branch selection, verification, or `git push`. Those stay in
PART C under operator/delegate authority (`land.md:429`: "land is the delegate's/operator's action, not
the team's"), and D113 already makes control-plane spool ops operator-only.

Recovery paths, one per failure mode:
- **Hard failure (a run never settles):** the bounded wait returns `quiesced: false` (proven) → the
  request is *refused with a named cause*, never silently entered, and the operator is told to use
  `broker-safe-change.md`.
- **Partial (inbox not drained):** the boundary does not close; entries are dead-lettered with
  `reason=<stoppedBy>`-style naming rather than stranded.
- **Contradiction (two authorities):** one predicate, one module — the pattern already used by
  `src/genlockreserve.mjs`, which the broker and `scripts/land.mjs` share precisely so the two do not
  disagree about the lock.
- **Crash mid-quiesce (marker exists, pid dead):** reconcile on start — treat an orphan marker as
  **not** quiesced, log `QUIESCE-ORPHAN pid=<dead>`, and require an explicit request. A stale "no
  writes" claim is more dangerous than a missed one.
- **Loop (the boundary never releases):** release is idempotent and cheap; re-requesting a quiesce
  returns the current state, so the recurring landing pass described in `docs/DECISIONS.md:7404`
  (every pass re-establishes seat roots and re-validates pointers) does not need a new halt each time.
- **Silent wrong-state:** the marker plus the log line is the eval; a demo asserting "no PASS lines
  after QUIESCE" is what makes the claim falsifiable.

The vocabulary already exists and that is the tell: `QUIESCE` appears in the code only as a **per-seat**
precondition (`src/broker.mjs:710`, refusing a mid-flight `compact` and naming the remedy "QUIESCE the
seat first"). There is no rig-level state of that name. `brokerProcessAlive` (`src/broker.mjs:2295`)
is consumed only by `tools/broker-serve.mjs:514`. The word is there; the boundary is not.

## 4. Decision (ADR)

**Status:** proposed — minted as `D-<mint>` at landing, in issue order (lead #3075: a branch never
hardcodes a D-number).

**Context:** a seat cannot stop its own host, so the landing pass runs outside the broker. Running
outside the broker today means either stopping it (which makes every broker-routed read dark — the
303/329 family) or relying on the genlock pre-flight (which locks generations but not passes). Neither
is a boundary.

**Decision.** Add a broker-owned `quiesce`/`unquiesce` state, gated by the control-plane authority,
with a disk marker and a log line; keep the merge act outside any seat. Keep PART A (inventory),
PART B (boundary) and PART C (merge act) as three separate seams with three separate authorities.

**Options considered.**
- **(A) Broker-side quiesced boundary** (chosen). Costs: one state machine, one marker file, one
  predicate shared with `land.mjs`. Reversible: delete the op and behaviour reverts to pause. It
  preserves read availability, which the alternatives do not.
- **(B) Stop the broker externally** (the current runbook). Simple and proven; rejected as the
  *standing* answer because it makes every broker-routed read dark, requires an operator in the loop
  each time, and cannot be driven by the seat doing the work — the exact failure the runbook records.
- **(C) Claim all N genlock slots** (already implemented, `scripts/land.mjs:25-26`). Keep it as the
  **fast-path guard**, not the boundary: it locks generations, not passes, and a broker can still write
  to the store with no generation in flight. The trade-off accepted: (A) is more machinery for a
  guarantee (C) cannot make.

**Consequences.**
- The landing pass becomes re-enterable: quiesce → merge → release, with the seat never touching the
  broker's process.
- It hard-depends on RM-329 1/3 (exit drain, nothing stranded) and 2/3 (routing on progress, not
  heartbeat), because a boundary that leaves reads dark is a boundary nobody can check.
- The observable half is the same shape as #5918: a state change with no log line is unfalsifiable.
- Authority is unchanged: seats still cannot stop the broker, cannot advance main, and cannot issue
  control-plane ops.

## 5. Falsifiable probes (each must be able to fail)

1. **No passes under quiesce.** Run a broker, issue quiesce, read the log: assert no `PASS` line after
   the `QUIESCE` line. Delete the loop-park and the demo goes red.
2. **No wakes and no writes together.** Assert the RigQueue doc's bytes/revision are unchanged across a
   quiesced window while a queued item exists. This is the assertion that separates pause from quiesce:
   under *pause* it fails (passes still write), under *quiesce* it passes.
3. **Nothing stranded.** Put a read op in the inbox at the moment of quiesce; assert it is answered or
   dead-lettered with a reason — never left in `<db>.broker.inbox/`.
4. **Reads stay served.** `cli.mjs status` against a quiesced broker returns in well under the 120 s
   `timeoutMs` (`src/readclient.mjs:35`) and reports `degraded`, not `down`.
5. **Orphan marker reconciled.** Kill the broker while quiesced; on restart assert `QUIESCE-ORPHAN` and
   a return to running.
6. **Authority.** A forged `from=<seat>` quiesce request is refused by the same gate as pause
   (`src/broker.mjs:482`), per the detect-and-layer position (security #2223).

## 6. Verify (commands run for this review, from the item worktree)

```
node demo/pause.test.mjs          -> exit 0  ("pause gates new work, never kills in-flight work")
node demo/pause-wait-bound.test.mjs -> exit 0 ("a never-settling run returns quiesced:false within the bound")
node --check src/broker.mjs       -> exit 0
grep -n "hasQueued = !paused" src/driver.mjs     -> :119 only — pause gates wakes, not passes
grep -n "harness.commit" src/broker.mjs          -> 152, 564, 645, 681 — writes occur inside a pass
```

The claims above are about those lines and those runs; probes 1-6 are not yet implemented — they are
the acceptance criteria for the build, and they are what makes this a seam rather than a slogan.
