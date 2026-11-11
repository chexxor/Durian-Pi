# Ruling: what a gate means, state by state, and who may change it (#6730, and the conflict lead flagged in #6782)

**Question.** From the #6502 review, lead asked two things: does a queued row get a gate-EDIT verb, and is a gate naming a cancelled row "closed" or "open"? They are one question: the answer to the second is only defensible if you also answer the first.

**Run.** `node tools/probes/gate-state-semantics-6730.mjs` → exit 1, four unresolved states, branch `item-6730`, HEAD `35001c3a`, pi-durable 1.3.0 from the lockfile. The companion measurement is `tools/probes/gate-dead-end-6707.mjs` (branch `item-6707`, exit 1), which runs the same state through the real verbs.

## Measured: one row, ten gate situations, as `workable()` answers them (src/rig.mjs:320-333)

| the gate names | verdict | reason emitted |
|---|---|---|
| a `done` row | workable | — |
| a `cancelled` row | refused | `gate-cancelled:#2` |
| a `queued` row | refused | `gate-open:#2(queued)` |
| a `held` row | refused | `gate-open:#2(held)` |
| a `claimed` row | refused | `gate-open:#2(claimed)` |
| a `deferred` row | refused | `gate-open:#2(deferred)` |
| an id that does not exist | **workable** | — (conservative default, D271) |
| itself | refused | `gate-open:#1(queued)` |
| a row that gates back on it | refused | `gate-open:#2(queued)` |
| no gate | workable | — |

Three things fall out of that table.

**1. A cancelled gate is, in behaviour, OPEN — and its own documentation says the opposite.** `deadGateId`'s docstring at `src/rig.mjs:304-309` reads: *"a CANCELLED prerequisite is a DROPPED prerequisite, not an unmet one"*. Two lines below, `workable()` returns `{workable: false, reason: "gate-cancelled:#2"}`. "Dropped, not unmet" is the language of closed; the predicate is the language of open. Both are cited as authority elsewhere (#6112, #3747). Two seats reading the same file can plan opposite moves. That is a contradiction, not a nuance, and it is the thing #6782 is really about.

**2. Self-gates and cycles are not detected, only refused as ordinary waiting.** A row gated on itself and two rows gating each other both read `gate-open` — indistinguishable from a legitimate wait. `normalizeBlockedBy` (src/rig.mjs:391) validates shape (positive integers) and nothing else: measured, it never looks at the referenced rows. So the rig cannot tell "I am waiting for real work" from "I am waiting forever".

**3. There is no repair path.** `grep` for assignments to `item.blockedBy` outside `enqueueItem`: **0**. There is no `gate_work` verb. Measured end to end (item-6707 probe): a held row whose gate was cancelled is refused by `revise_work`, `release_work`, `hold_work` and `claim_work`; the only verb that changes its state is `cancel_work`. The rig currently destroys work to fix bookkeeping.

## Ruling 1 — cancelled means OPEN, and that answer is only legitimate with a repair verb

A gate says "this work waits on that work". If the referenced row is cancelled, the wait can never end. Treating it as closed would make the row claimable while its premise is gone — the silent-wrong-output class, where the seat does the work the rig no longer means it to do. Blocking is the conservative and correct reading; **blocking without a way to unblock is the dead end**, so the two rulings must land together.

The sentence must be fixed to match the behaviour: *"a CANCELLED prerequisite is dropped, and a dropped prerequisite is unmet: the row is not workable until the gate is removed."* One sentence, one verdict.

**Options considered.** (a) cancelled = closed (proceed) — rejected: it makes an incoherent row claimable with no trace. (b) cancelled = open plus a repair verb — chosen. (c) cancelled = open, recovery terminal (cancel the row) — rejected on measurement: it is what the rig does today, and it loses the work. Trade-off accepted: more rows sit refused, and each refusal must say what to do about it.

## Ruling 2 — yes, `gate_work`, with the removal leg split by kind

```
gate_work(itemId, add?: [ids], remove?: [ids])
  rows only in `queued` status (D261 clause 1 for intent fields is unchanged)
  validated inside the commit, over the combined graph: ids exist, no self-gate, no cycle
```

Authority, per field, exactly as D261 framed it:
- **add** — parties, plus mint-scoped reach limited to one hop (`referenceOk`, D276).
- **remove a DEAD gate** (target cancelled or nonexistent) — any party. This is repair, not loosening: the constraint is already unsatisfiable, and the actor is restoring coherence, not rewriting another seat's contract. Recorded as `{by, reason, at}` on the row and notified to the author the way cancellation is (#3470).
- **remove a LIVE gate** — the minting seat, or a scope ruling from lead. D261's clause 3 stands for this case.

That is the amendment #6782 asks for: D261 said "a future `gate_work` is additive-only for a non-minting party; removing a gate is a scope ruling, not a verb". Read literally, that leaves the measured dead end as the only recovery. The distinction that survives is between *loosening a live contract* (scope, lead) and *clearing a constraint that can never be satisfied* (repair, a verb).

## Failure modes at this seam, with the recovery path

| mode | what happens today | recovery |
|---|---|---|
| stranded | a parked row with a dead gate cannot be released, revised or claimed; only cancellation works | dead-gate removal by a party, recorded, in the same commit that validates the graph |
| contradiction | the docstring and the predicate disagree about what "cancelled" means | one sentence in `deadGateId`, asserted by `gate-state-semantics-6730.mjs` |
| loop | self-gates and cycles read as ordinary waiting | mint-time validation rejects self-reference and cycles; refusal names the cycle |
| laundering | the removal verb doubles as an "attach any id" verb | add is bounded by standing and depth 1 (D276/D279); the verb and the bound land together |
| invisible | `check` has no rule touching `blockedBy` (measured: 0) | `gate-dangling`, `gate-cancelled`, `gate-cycle` findings, with age so a stranded row is noticed before a seat trips on it |
| wake blindness | the wake predicate sees a parked row's `id:status` only, so a stranded gate never wakes anyone (registered in #6817) | wake selection uses the same `workable` verdict as claim, and the wake text carries the reason |
| refusal illegibility | "gate-cancelled:#2" tells the seat nothing actionable | the refusal names the dead id, the party who may clear it, and the verb |

## Falsifiable probes

- `tools/probes/gate-state-semantics-6730.mjs` (this branch): asserts the ten-state table, the docstring/predicate agreement, and that a validator and a removal path exist. GREEN only when all three hold.
- `tools/probes/gate-dead-end-6707.mjs` (branch item-6707): produces the stranded state through the real verbs and goes GREEN only when a party can clear the dead gate without cancelling the row.

## What is not mine to decide

Whether `gate_work` ships in the #6530 tranche or as a follow-up is lead's scope call. The constraint I will hold: **the removal leg and the standing bound are one change**; shipping either alone creates a larger authority than the one it replaces.
