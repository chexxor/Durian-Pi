---
review: fault-signal-schema
item: #6227
seat: architect
asked_by: pm
date: 2026-11-10
tree: item-6185 @ eb956c2a
status: ruling issued; implementation routed, gated on this row
---

# The fault signal clause 4 of `workable()` needs — schema ruling

## The gap, in the predicate's own words

`workable(item, seat, { items = [], capabilities = [] })` (`src/rig.mjs:303`) implements three of its
four clauses. Its own docstring says the fourth is unimplemented and *why*: "no such field exists, and
D24 forbids inventing a schema or write path for it."

Measured, not asserted — `node tools/probes/fault-signal-states.mjs` (exit 0):

```
  no fault recorded                expect: clean                    got: workable=true reason=null
  fault on the ITEM              expect: distinct from clean      got: workable=true reason=null
  fault on the SEAT argument   expect: distinct from clean      got: workable=true reason=null
  fault ACTIVE, reviewBy future expect: NOT workable             got: workable=true reason=null
  fault EXPIRED, reviewBy past  expect: workable, flagged expired got: workable=true reason=null
  fault present but UNREADABLE  expect: UNKNOWN, never 'no fault' got: workable=true reason=null
  undeclared option passed to the predicate  got: workable=true, no error, no effect

DISTINCT VERDICTS: 1 of 6
```

Two facts come out of that, and they decide the schema:

1. **There is no channel.** Every fault-shaped input is ignored, including an undeclared key in the
   third argument — it is destructured away with no error and no effect. So "add a fault field" is not
   enough; the parameter has to be *named*, or a caller passing one gets silence.
2. **Today the rig's only durable expression of a fault is a park on the item.** `src/supervisor.mjs:75-92`
   computes the fault each pass from `failureStreakByConv` and `errorByConv` — transcript-derived,
   recomputed, never persisted — and then parks the seat's oldest item on the human. The streak is
   observation time; the fault happened at run-settle time. Between those two, nothing exists that
   `workable()` could read.

That is why the gap has been parked since #2673: implementing clause 4 would have meant inventing the
field, and the field is the hard part.

## Ruling

### 1. The marker lives on the SEAT, not the item

A provider or seat fault is a property of the **actor**. The predicate already receives the seat, and
`Seats` already holds per-seat state (`src/rig.mjs:27` — `name -> {conversationId, role, goal,
capabilities}`).

Per-item marking is rejected on measurement, not taste: the live store has **2,961 queue items and 12
seats** (`node cli.mjs config`). One provider outage would have to write ~3k rows and then *unwrite*
them, and an item's fault would outlive the fault that caused it. Item-scoped faults are
#3747/#3863's starvation pattern in a new costume.

**Field:** `Seats.seats[name].fault`. One marker per seat, replaced, not appended.

### 2. Shape — validated on the write path, mirroring the park shape

`normalizeBlock` (`src/queue-lifecycle.mjs:146`) already solved the exact problem this field has: a
park that is prose is unqueryable, and a park without a resolver never clears. Reuse that discipline:

```
fault = {
  cause:     <name>,            // from src/causes.mjs — an allow-list, never free prose
  scope:     "provider" | "seat" | "rig",
  at:        <ISO>,            // FAULT TIME: the run that raised it, not the pass that noticed
  by:        <raiser>,         // "provider-seam" | "run-settle" — provenance, mandatory
  evidence:  <pointer>,        // submission id / ledger line a human can follow
  resolver:  <who clears it>,  // mandatory, same rule as a park's resolver
  reviewBy:  <ISO>,            // mandatory; absent means the per-cause default
}
```

Validation is part of the schema, not a later check: a marker missing `cause`, `by`, `resolver` or
`reviewBy` is **refused at write**, the way `normalizeBlock` refuses a `block` with no resolver. A
fault with no expiry is permanent starvation, so expiry cannot be optional.

Per-cause `reviewBy` defaults: spend cap → none auto-clears, the resolver is the operator (D193:
raising the cap is only the operator's decision); provider transport failure → 24 h; seat-level
degeneration → until the next successful run.

### 3. Only the raiser writes it, at fault time

The code that RAISES the cause writes the marker, in the same commit that settles the failing
submission: `src/providers/spend.mjs` for `SPEND_CAUSE`, the run-settle path for `model_error`.
`src/causes.mjs` already states the doctrine this follows — "A cause is named by the code that RAISES
it and acted on by code far away" — and the codebase already holds the corresponding limit: "a cheap
signal may ACCEPT but never DECIDE (#3271/#3575)" (`src/causes.mjs:53`).

**Readers, never writers:** `src/attention.mjs`, `src/checkup.mjs`, `cli.mjs`, and any seat tool. The
supervisor may *consume* the marker; it must stop deriving the fault from the transcript to decide.

### 4. The read is four states, and the predicate names which one

`readFault(seatDoc, nowMs)` → `{ state: "none" | "active" | "expired" | "unknown", fault?, why? }`.

`workable()` gains a named `fault` parameter carrying that resolved state:

| state | verdict |
|---|---|
| `none` | `{ workable: true, reason: null }` |
| `active` | `{ workable: false, reason: "fault:<cause>" }` |
| `expired` | `{ workable: true, reason: null, caveats: ["fault-expired:<cause>"] }` |
| `unknown` (a marker exists but cannot be resolved) | `{ workable: true, reason: null, caveats: ["fault-unknown"] }` |

The invariant "reason is non-null only when the item is not workable" is preserved, which is what makes
this additive rather than a rewrite of every caller.

**UNKNOWN is not "no fault", and it does not block.** This is the ruling's sharpest edge, and it is
deliberate: #2673's load-bearing refinement is that a *missing or ambiguous signal means workable*,
because a false negative starves invisibly while a false positive is legible. Turning clause 4 into a
fail-closed gate would reintroduce exactly the invisible starvation #2673 removed — a broken read
would make every seat look empty. So the claim proceeds, but the state is **named**: the predicate says
`fault-unknown`, the claim response prints it, and `check` counts it. Fail-open on the action, never
fail-silent on the state.

### 5. Clause 4 gates claim and wake identically, and nothing else

`selectOldestWorkable` (`src/rig.mjs:331`) and the broker's wake selection must use the same predicate;
`src/queue-lifecycle.mjs:348` already assigns ownership of claimability there ("who may claim an item
is #2673's `workable`, and it lives there"). If wake and claim disagree, a faulted seat is woken, burns
a turn, and receives a legible refusal — the wake/claim disagreement is already a registered defect
(#6186/#6187), and clause 4 must not add a second copy of the rule.

Clause 4 does **not** gate `complete_work`, `defer_work`, `hold_work`, `release_work` or `resume_work`.
A seat mid-run must be able to finish; blocking those orphans claimed items, which is the #6224 class
of bug.

## Failure modes, each with a recovery path

| Mode | Mechanism here | Recovery | Falsifiable by |
|---|---|---|---|
| **Permanent starvation** | a marker with no expiry never clears (#3747/#3863 in new clothes) | `reviewBy` mandatory on write; expiry evaluated at read; expired markers reported, not deleted | the probe's `expired` row must read `workable=true, caveats=[fault-expired]` |
| **Loop** | faulted seat is never woken → no run → no evidence of recovery → fault never clears | expiry guarantees re-entry; the wake selector must wake a seat whose `reviewBy` has passed | a seat with an expired fault must appear in the wake set |
| **Cascade** | one provider outage marks every seat → fleet-wide claim block that reads like an empty queue | `scope` distinguishes provider from seat; each skip is reported with its reason; the operator's pause/resume actuator is the existing halt path | `cli.mjs status` must show 12 distinct fault causes, not a silent no-work |
| **Contradiction** | supervisor parks an item on a fault while the seat record says no fault | one field, one writer; the supervisor reads instead of deriving | assert the supervisor's escalation cause equals the marker's `cause` |
| **Silent** | unknown read reported as "no fault" | the four-state read; `fault-unknown` caveat | the probe's `unreadable` row must NOT read as clean |
| **Partial** | marker written, clearing run never happens (seat stopped) | `reviewBy` expiry plus the explicit `resolver` | an expired marker is inert at read |
| **Misreport** | a retryable transport blip raises a fault and blocks claims for 24 h | only non-retryable stops raise a marker; retryable blips stay notices | the allow-list rejects an unclassified cause |
| **Context** | 2,961 items × a fault read per claim | the marker is one object per seat, resolved once per claim pass, passed by value — no per-item scan | `workable()` stays a pure function (the demo suite pins this) |

## Options considered

- **(a) `fault` on the item.** Cheapest to write, impossible to clear: ~3k writes per outage, per-item
  expiry, and a fault that outlives its cause. Rejected.
- **(b) derive it at claim time from the transcript.** Rejected for three reasons: D24 forbids
  inventing a signal that is not persisted; the predicate is pure and provable today, and a transcript
  read per claim makes it neither; and "observation time" is precisely the wrong moment — the streak
  resets and the evidence vanishes with no provenance.
- **(c) one seat-scoped persisted marker, written by the raiser** — **chosen.**

**Trade-off, stated:** (c) puts a write on the provider seam, the rig's hottest path; a bug there
blocks claims fleet-wide. Accepted because the decision is reversible in both directions — clause 4's
conservative default means the gate can be switched off without touching the data, and the marker's
existence is independently auditable. (a) is cheaper to write but hard to reverse once 3k rows carry a
stale fault.

## What is NOT ruled here

This document is the schema ruling. It does not implement the field, and it does not decide *which*
causes qualify — that is the implementation row's job, gated on this one. It also does not decide
whether a faulted seat should be woken to re-test recovery beyond the expiry rule; if that is wanted,
it is a scope question for `lead`.

## Next row (routed to `pm`, gated on #6227)

Implement clause 4 against this contract. Acceptance: `node tools/probes/fault-signal-states.mjs`
reports **4 distinct verdicts, not 1**, and `demo/workable-claim.test.mjs` keeps clauses 1-3 green.
