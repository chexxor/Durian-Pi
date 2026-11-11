# Review: #6532 — coordinator standing as a recorded field (lead's ruling (b), narrowed)

**Tree:** branch `item-6531`, HEAD `1e39179a`. **Read as:** design review of a durable authority decision. Nothing implemented.

**Falsifiable gate:** `node tools/probes/coordinator-standing-surface.mjs` -> **exit 1 (RED, 5 unresolved items)** at this HEAD. It is the baseline the #6530 acceptance demo must move.

## Where lead's ruling is right

(b) over (a) is correct, and for the reason the ruling gives: a guard that cannot point at a stored value cannot falsify its own refusal. Today every coordinator grant is derived (`"coordinatedBy"` appears nowhere in `src/rig.mjs`), and the only non-party grant in the file is `release_work` (`src/rig.mjs:1332`), which decides standing from `seatIsCoordinator(...)` computed at call time. Additive-only authority is indeed the reversible half: adding a gate can only make work harder to start.

## Defect 1 — a recorded field without a re-validation is a snapshot that never expires

**Evidence.** Probe section 3: `seatIsCoordinator(pm, []) = true`, `seatIsCoordinator(pm, ["implement"]) = false`. Standing flips the instant a seat declares a working capability.

**Failure mode.** Silent contradiction: the row records `coordinatedBy=pm` from mint, pm later declares `implement`, and pm keeps gate authority on a row it is no longer coordinating. Two truths about one seat.
**Fix.** The check must be a conjunction, and the refusal must name which half failed:
`item.coordinatedBy === me && seatIsCoordinator(seats[me])` → "you are not this row's recorded coordinator" vs "you now hold a working capability, so standing lapses". Standing that lapses is recoverable (the seat can drop the capability); standing that never lapses is not.

## Defect 2 — the capability vocabulary is a closed four-entry list, and everything outside it counts as "does no work"

**Evidence.** `src/seattools.mjs:262`: `WORKING_CAPABILITIES = ["implement","code","verify","review"]`. Measured: `seatIsCoordinator({capabilities:["design"]}) = true` — my own seat's `design` capability is not in the list.

**Failure mode.** Cascade + silent: any seat whose capabilities are spelled outside the vocabulary (design, architecture, test, docs) is classified as a coordinator and, once standing is recorded, gets gate authority. That is a boundary decided by a string list nobody declared.
**Fix.** Either extend the vocabulary deliberately and record the decision, or make unknown capability strings a `check` finding (`seat-capability-unrecognised`) rather than an implicit coordinator. A seat should not gain authority because of a typo.

## Defect 3 — "additive only" is reversible only if a removal path exists, and there is none

**Evidence.** Probe section 4: **0** sites in `src/rig.mjs` clear `blockedBy`. Combined with `deadGateId` (`src/rig.mjs:313`) and `release_work`'s refusal to release a row whose gate names a cancelled item, a coordinator that adds a gate can strand a row permanently.

**Failure mode.** Loop and cascade: additive authority without an undo is a one-way door, which contradicts the ruling's own justification for delegability ("release is reversible, so it is delegable; cancel, revise and tier are not").
**Fix.** Condition 2 must read: authority over the gate field means **add and remove the edges that same actor added**, with each edge recorded (`gateEvents: [{by, id, at}]`). Removal is not a loosening of another seat's contract — it is the undo of the coordinator's own addition. This is the same requirement D265 already states; #6530 and #6508 must not ship separately without it.

## Defect 4 — condition 3's "gate chain names a row it minted" is unbounded as written

**Failure mode.** Authority grows with the graph: mint one row, and as the queue's gate graph grows, the set of rows transitively connected to it eventually covers the queue. That is the global veto the ruling was trying to prevent, arriving through a definition that sounds bounded.
**Fix.** State the depth. `coordinatedBy === me` OR `blockedBy` contains an id whose `from === me` — depth 1, computed inside the commit. Depth is a number you can test; "the chain" is not. The acceptance demo for #6530 should include the depth-2 row and assert it is REFUSED.

## Defect 5 — mint-time fields need a rule for forwarding

A coordinator that forwards a row mints it (`from === me`), so `coordinatedBy = from` is derivable. But a coordinator gating a row minted by impl is only in scope under condition 3. Nail the semantics before coding: `coordinatedBy` is set at creation to `from` when `seatIsCoordinator(from)`, never mutated afterwards, and never inferred from forwarding history. If no case exists where the coordinator is not the sender, the field is unnecessary and the ruling should stop at the predicate — a field that only duplicates `from` is a second source of truth.

## Failure taxonomy

| Class | Here | Recovery |
|---|---|---|
| Silent | standing derived, nothing to point at | recorded field; refusal names the value checked |
| Contradiction | recorded standing vs live capability | conjunction; refusal names which half failed |
| Cascade | unknown capability string ⇒ coordinator | check finding for unrecognised capabilities |
| Loop | gate added, never removable | per-edge add/remove recorded by actor |
| Partial | "chain" unbounded | explicit depth, tested at depth 2 |

## Options and the trade-off accepted

(a) No coordinator standing: cheapest, leaves sequencing stuck in prose (#3570's hole). (b) Recorded, bounded, additive-and-undoable standing: costs one field, one conjunction, one depth rule. Accepted: (b) with the four corrections — without the re-validation, the vocabulary rule, the removal path and the explicit depth, (b) is (a) with extra steps and a new authority nobody can audit.
