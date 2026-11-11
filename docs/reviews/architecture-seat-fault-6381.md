---
review: clause 4 of workable() - a fault that is recorded somewhere is not a fault the machine consults
item: #6381
seat: architect
asked_by: pm
date: 2026-11-11
tree reviewed: main (worktree item-6381)
probe: tools/probes/fault-signal-states.mjs (exit 1 today; three measured gaps)
status: design position; impl builds (#6380)
---

# What exists and what does not

The rig already *knows* a cap tripped: `spend_cap_exceeded` is a named cause class (`src/causes.mjs:19`), the supervisor parks the item and names the money record (`src/supervisor.mjs:102`), and the ledger is `<db>.spend.jsonl` (`docs/DECISIONS.md:8102`, D-5015.5 at `:8528`). What does not exist is a **seat-scoped marker that a claimability predicate can read**. `workable`'s signature is `workable(item, seat, { items = [], capabilities = [] } = {})` (`src/rig.mjs:303`) - there is no `fault` parameter, so a caller passing one is destructured away in silence. Measured: six different fault situations produce **one** verdict, `workable=true reason=null`.

That silence is the mechanism, and it is worth stating plainly: the argument was being passed and ignored, which reads as "the predicate is not consulting the fault" when the truth is "the predicate has no channel for it". Naming the parameter is not ceremony; it is the difference between a gap and a mystery.

# The contract clause 4 must have

**Receives:** a seat fault record `{cause, at, resolver, reviewBy}` and the current time. **Produces:** a verdict plus a reason that identifies the state (`fault-active:<cause>`, `fault-expired:<cause>`, `fault-unreadable`, or nothing). **NOT responsible for:** deciding what the cap is, applying it, retrying anything, or clearing the marker. Those belong to the supervisor and the operator.

Two properties the spec does not state and the probe now requires:

1. **The read is total.** Four states - absent, active, expired, unreadable - must be distinguishable. A reader who cannot tell them apart cannot decide, and a rig that cannot decide cannot clear the fault.
2. **A fault cannot be permanent by omission.** A marker with no `reviewBy` and no `resolver` is a gate pointing at nothing, the same starvation shape as a gate on a cancelled id. The write path must require a resolver and a review date, exactly as `block` requires them for a park (`send_work`'s contract: reason + mandatory resolver + reviewBy). Consistency here is not aesthetic: the rig already has a record type that refuses to park without a resolver, so a second record type that can block forever without one is an inconsistency the operator will be trapped by.

# The failure mode the routed row does not name: two doors, one predicate

`selectOldestWorkable` (`src/rig.mjs:331-341`) is the claim door and it calls `workable`. The wake door does not:

```
const hasQueued = !paused && (items ?? []).some((it) => it.to === name && it.status === "queued");
```
(`src/driver.mjs:119`) - a raw status scan. No capability check, no gate check, no fault.

So clause 4 as specified - "gates claim and wake" - will gate claim and not wake unless the wake path is changed. The consequence is exactly the spend the fault exists to prevent: a faulted seat is woken, runs a turn, and then `claim_work` refuses it. Measured and asserted by the probe; it is also the reason the existing parked-wake machinery (`WAKE_CONTENT_PARKED`, `src/driver.mjs:54-55`) had to be invented - the wake body and the verb disagree, and the seat learns that the prompt lies.

Where clause 4 must **not** gate: `complete_work`, `defer_work`, `hold_work`, `release_work`, `resume_work`, and the stalled-claim branch of the wake. A seat under a spend fault must be able to finish, park or release what it already holds. Gating those turns a cap into a deadlock: the rows the fault is meant to clear stay claimed and never settle.

# Options for where the marker lives

- **(a) On the Seat doc.** Seat-scoped, broker-owned, read in the same commit as the queue, and the wake loop already reads seats. One source of truth. Cost: the seat record carries a state that is not identity or capability.
- **(b) A sidecar file beside the store**, like `.broker.audit.log`. Cheapest to write. Cost: a second truth outside the broker's read seam, and the rig's rule is that reads go through the broker - a file a seat can read but not trust is the same class as a gate whose reference is never resolved.
- **(c) Derive it from park records** - the seat's most recent `spend_cap_exceeded` park. No new field. Cost: expiry semantics inferred from per-item records, and "the seat is faulted" becomes a reconstruction rather than a fact.

I take **(a)**. (c) is tempting and fails on expiry; (b) breaks the read seam.

# Failure modes, recovery, check

| failure | class | recovery | falsifiable check |
|---|---|---|---|
| fault argument silently dropped | silent | named parameter in the signature | probe asserts the signature names it |
| wake uses a different predicate than claim | cascade (spend the fault is meant to stop) | compute per-seat claimability once per pass and use it in both paths | probe asserts `src/driver.mjs` calls the predicate |
| marker with no reviewBy | loop / starvation | require resolver and reviewBy at write; refusal names who clears it | probe case: no reviewBy → not workable, reason names the resolver |
| unreadable marker read as "no fault" | silent fail-open | treat as UNKNOWN: workable **with a diagnostic**, never silently clean | probe case; the diagnostic line must reach `check`/attention |
| expired marker read as active | contradiction | total read state; expired → workable, reason `fault-expired`, record retained | probe case; "delete evidence" and "disable it" are different operations and the rig should do the second |
| fault and pause both gate and the reason is ambiguous | contradiction | the reason string names the controlling cause; the check rule reports both separately | read one verdict line and see which cause it attributes |
| faulted seat never woken, so nothing reviews it | loop | the stalled-claim wake still fires; expiry is time-based and the operator is the resolver | a faulted seat with a claimed row is still woken for that row |
| gate resolution is O(items) per candidate in the wake loop | performance, bounded | pass a `statusById` map into `workable` instead of `items.find` per gate (`src/rig.mjs:310-311`) | measure before and after on the live row count |

The fail-open decision deserves the trade-off stated out loud: a **budget cap is not a security boundary**. A malformed marker file must not stall the rig - the recovery path is a diagnostic that reaches the operator, not a halt. If the marker were a security control, the correct default would be fail-closed. It is not, so it fails open and reports.

# Acceptance the build must satisfy

1. `node tools/probes/fault-signal-states.mjs` exits 0 (it exits 1 today with three measured gaps).
2. At least four distinct verdicts across absent / active / expired / unreadable.
3. `src/driver.mjs` and `src/rig.mjs` share the predicate; the wake reason for a faulted seat is legible (`fault-active:<cause>`) and no wake is submitted for it.
4. `complete`, `defer`, `hold`, `release`, `resume` are unaffected by the marker - assert this with a demo, because "must not gate" is a property that a later refactor can silently violate.
5. The marker is replaced, not appended, and an expired marker stays in the record inert.
