# Review: the `gate_work` decomposition (#6473 -> #6508-#6516)

**Reviewer:** architect, item #6517. **Tree:** branch `item-6517`, HEAD `560db92e` (pi-durable 1.3.0 lockfile resolution).
**Read as:** a review of the *routing*, not an implementation. Nothing in the decomposition has been built yet: `grep -rn "gate_work" src/` returns only two probe files. Every finding below is measured against the predicate the verb will inherit.

**Falsifiable gate for the whole review:** `node tools/probes/gate-verb-decomposition-gaps.mjs` -> **exit 1 (RED, 8 gaps)** at HEAD `560db92e`. It turns GREEN only when the build rows close the named gaps. That probe is the acceptance instrument for this review.

---

## What the routing gets right

- It correctly identifies that `blockedBy` is written **only at creation** (probes `gate-write-surface.mjs`: 0 removal sites) so an additive verb is genuinely new capability, not a wrapper.
- It correctly spots the authority-before-state ordering in `hold_work` / `revise_work` / `cancel_work`, with `release_work` as the reference implementation.
- It correctly refuses to bulk-rewrite the 249 prose-gated rows (#6513) - that is the reversible choice.

## Defect 1 - the cycle check is pair-shaped; the predicate cannot escape a ring

**Evidence.** `tools/probes/gate-verb-decomposition-gaps.mjs` section D, run at HEAD:

```
A<->B->C->A: gate-open:#711(queued), gate-open:#712(queued), gate-open:#710(queued)
```

All three rows are permanently unworkable. `#6512`'s stated check is `gate_work(A,[B])` then `gate_work(B,[A])` fails - a 2-cycle. The predicate (`src/rig.mjs:319-331`) reads each gate independently; it has no notion of a ring, so it cannot tell a wait from a deadlock.

**Failure mode:** cascade + loop. Three rows starve; each seat sees "wait on #711" while #711 says "wait on #712". No seat can report the stall because no seat can see the ring.
**Fix.** The validator in #6512 must compute reachability over the **combined graph** (existing `blockedBy` for every row + the proposed edge) inside the same `api.commit` transaction, and refuse any write that makes a row reach itself. It must run on **both** write paths: `send_work` (`src/rig.mjs:778`, where gates are created) and `gate_work`. A validator only on the new verb leaves the creation path free to mint the cycle.
**Probe.** Add to the same file: self-gate refused, 3-cycle refused, and - the part usually missed - **a refused write leaves the row byte-identical** (no partial mutation before the refusal).

## Defect 2 - the verb's exit path is the only exit, and #6508 under-specifies it

**Evidence.** Section B/C of the probe: 0 sites in `src/rig.mjs` clear `blockedBy`; a held row whose gate names a cancelled row has `deadGateId = 701`, and `release_work` (`src/rig.mjs:1345`) refuses to release it. Its only remaining verb is `cancel_work`, which is **terminal and party-scoped**.

**Failure mode.** Silent permanent starvation with no recovery. A cancelled prerequisite is a dropped prerequisite, but the predicate reads it as an unmet gate (`gate-cancelled:#<id>`), so the row is neither claimable nor releasable and nobody is told to remove the gate.
**Fix.** #6508 must state the removal authority as a closed set: the seat recorded in the add transition, the row's `from`/`to`, or the operator - and it must record `gateRemovedBy` in `transitions` exactly as the add does. It must also cover the cancelled-parent case: **removal is the recovery path for a dead gate**, so the verb is not optional for that class. Then implement the schema rule (Defect 7) so the stranded row is at least visible.
**Probe.** Same file, section C, asserts the two-exit situation; it flips GREEN when a removal site exists.

## Defect 3 - strict-at-write vs lenient-at-read is never decided, and the lenient default is a hole

**Evidence.** `normalizeBlockedBy` (`src/rig.mjs:391-404`) checks shape only. `gate-silent-drop.mjs` measures that a `revise_work` call carrying `blockedBy` is rejected by the tool schema and the gate never lands. `gate-reference-validation.mjs` measures that a gate on a non-existent id is **silently treated as satisfied** (`workable=true, reason=null`) - a typo un-gates work.

**Failure mode.** Silent: the actor believes a gate exists.
**Fix.** Decide the two-tier rule explicitly: **refuse at write, stay conservative at read.** `gate_work` and `send_work` reject ids that do not exist, self-referential ids, and cycles; `workable()` keeps its conservative default so legacy rows do not retroactively starve. Options considered: (a) enforce at read - cheap, but starves 249+ legacy rows on a rule they never agreed to, and leaves the bad write invisible; (b) enforce at write, observe at read - a refused call is legible and retryable, a starved row is not. **(b) is the reversible choice and is the decision.**

## Defect 4 - the invariant is one, the rows are two

**Evidence.** `tools/probes/verb-ordering.mjs` exit 1: `defer_work`, `resume_work`, `hold_work`, `revise_work`, `cancel_work` all decide authority before state. `release_work` is the reference (`src/rig.mjs:1318` terminal check before `:1337` authority check).
**Failure mode.** Contradiction: two rows writing the same rule twice in two branches, drifting. A coordinator reading "item #N is addressed to impl, not you" for a **done** row reports it as parked - that is exactly the misread that made a chain read "96% parked" (recorded in the `release_work` comment, #5778).
**Fix.** One shared helper (`admitRow(item, me, verbName)`) minted in #6510 and called by the four verbs in #6511. One commit, four assertions. Routing two rows at the same concern invites two different helpers.

## Defect 5 - gating a held row does not say what happens to the wake

**Evidence.** #6509 accepts `queued` or `held`. `heldgate.mjs:200` reads the gate for wake decisions; but the wake-observability gap (#5438, #5927 - architect woken 3x with zero claimable rows) is still open, and parked rows with no bound have no wake limit.
**Failure mode.** Loop: a row is released, is gate-blocked, wakes the seat, the seat has nothing to claim, and it is woken again.
**Fix.** #6509 must assert wake suppression with the **same predicate claim uses** (`workable`), not a status literal, and must state what happens when a gate is added to a held row: it stays held, and its `block.reviewBy` should be set when the parent is itself parked.

## Defect 6 - the verification row cannot cover what it does not gate

**Evidence.** pm's body: "#6516 -> advocate, gated on all six build rows, six assertions" while the list contains **seven** rows: #6508, #6509, #6510, #6511, #6512, #6513, #6515.
**Fix.** #6516's `blockedBy` must name all seven, and the six assertions must be enumerated per row. Unverified-by-construction rows are how a tranche goes green while one verb ships broken.

## Defect 7 - the schema already promises a check rule that does not exist

**Evidence.** `docs/WORK-ITEM-SCHEMA.md:188` declares `blockedBy-resolves` (error): "a gate that names a non-existent id, or a `cancelled` gate." `grep -n "blockedBy" src/checkup.mjs` returns **nothing**.
**Failure mode.** Contradiction between declared contract and code: a seat reads the schema, trusts the rule, and gets no finding for 9 stranded intents (the `auditRig` inbox-census gap measured in #6393 is the same shape).
**Fix.** Implement `blockedBy-resolves` in the same tranche as the verb, as **observability, not enforcement** - it reports stranded gates; it does not silently rewrite them. If it is not implemented, delete the rule from the schema.

## Defect 8 - the routing cites line numbers that are already stale

**Evidence.** #6511 cites `revise_work (:828)`, `cancel_work (:847)`, `hold_work (:714)` and the reference `release_work (:1269-1275)`. At HEAD `560db92e` the actual sites are `src/rig.mjs:1391/1395`, `:1439/1441`, `:1268/1276`, and `:1318/1337`.
**Fix.** Cite the verb name and the invariant, never a line number (pitfall 262: land merges drift every cited line). This is cheap and it is the difference between a buildable row and one that misleads.

---

## Failure taxonomy for the seam

| Class | Here | Recovery path |
|---|---|---|
| Silent | typo / non-existent gate id = un-gated work | refuse at write; `blockedBy-resolves` check rule reports legacy rows |
| Cascade | a cycle poisons every row in the ring | combined-graph validator before the commit is allowed |
| Loop | held + gated row wakes a seat forever | wake selection uses `workable`; parked rows carry `reviewBy` |
| Partial | a refused write that still mutated the row | validate before assignment; probe asserts byte-identity after refusal |
| Contradiction | schema declares a rule the code does not implement | implement or delete; never leave both |
| Hard | unknown id, missing store row | conservative default at read, strict at write |

## Decision

Written to `docs/DECISIONS.md` as **D265** (provisional; mint at land - `DECISIONS.md` currently collides at D258 and D259, so re-check the number before minting).
