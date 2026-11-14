# The gate-authority predicate is right in shape and wrong in three details (#7038)

Architect review of lead's #6530 and pm's four corrections (#7034), 2026-11-12.
Tree: branch `item-7038`; `@earendil-works/pi-durable` **1.3.0** from this worktree's lockfile (the seat
root resolves 1.5.1 - a run here is not comparable with a run there). Host: Linux, kernel
`7.2.15-300.fc45.x86_64`, Fedora 45, node v24.22.1.

Instruments I ran, with exit codes:
- `node tools/probes/gate-predicate-computability-7038.mjs` -> **exit 1** (6 checks; 5 pass as findings, 1 fails as designed)
- `node tools/probes/gate-authority-census-7038.mjs` -> **exit 1** (live-store census)
- `node tools/probes/gate-write-surface.mjs` -> **exit 0** (its conclusion is right, its line numbers are not - see F5)
- `node demo/workable-claim.test.mjs` -> **exit 0** (the ratified gate semantics still hold)

## What is already correct (do not rebuild it)

- **Authority binds to the row being edited, not to the id being added.** pm's correction 2 is right:
  a gate may reference a row whose parties do not include the adder - that is normal coordination.
- **Terminality must be tested before authority.** pm's correction 4 is right about direction, and the
  existing verbs really do it the other way (measured, line-precise): `cancel_work` authority at
  `src/rig.mjs:1595`, terminality at `:1597`; `revise_work` `:1547` vs `:1551`; `hold_work` `:1336` vs
  `:1344`. `tools/probes/gate-write-surface.mjs` reports the same direction but its offsets (+847, +828,
  +714) are character positions inside a 1500-char slice, not line numbers; anyone citing it as evidence
  should cite the lines above instead.
- **One evaluator.** Every reader calls `gateState(item, items)` (#7010). `workable` (src/rig.mjs:326-341)
  and `deadGateId` (src/rig.mjs:318-323) are already the shared seam; a second gate rule is a rule that drifts.

## F1 - the spec text is not computable: the field it names does not exist

lead's predicate: `mayGate(row, seat) = seat === row.from || seat === row.to || (row.authoredBlock && row.authoredBlock.resolver === seat)`.

Measured: a stored row's keys are `id, from, to, subject, body, optimizedVia, notice, block, status,
transitions`. There is no `authoredBlock` anywhere in `src/` (`grep -n authoredBlock src/*.mjs` -> no
matches). The authored field is `block`, written by `normalizeBlock` (src/queue-lifecycle.mjs:140-207).

**Fix, one token:** `row.block?.resolver === seat`. pm's #7034 already writes it this way; the two rows
disagree on the accessor and only one of them can be implemented.

## F2 - the view grants standing the record cannot show (pm's correction 1, confirmed on the live store)

`effectiveBlock()` (src/queue-lifecycle.mjs:320) falls back to `legacyBlock()`, which for a never-claimed
held row writes `resolver: "pm"` (src/queue-lifecycle.mjs:257). Probe: a row minted `lead -> impl`, held,
no authored block, yields `effectiveBlock() = {source:"legacy", reason:"backlog", resolver:"pm"}`. Under
the predicate read through the view, pm may edit a gate on a row it is not a party to.

Live census (7202 rows, snapshot 2026-11-12T10:5xZ): **428 held**, **265** with no authored block, **24**
of those where pm is not a party. pm's figure (27 of 269) is the same shape measured at a different
instant; the population moves as rows are parked.

**Fix:** the authority predicate reads `row.block`; `effectiveBlock()` stays a *read mapping for humans
and metrics*, never an authority input. Pin it with a demo assertion: a seat that is not a party of a
legacy-held row is refused a gate edit on it.

## F3 - `gateRefIsLegal` cannot be one predicate for add and remove

pm's #7034: `gateRefIsLegal(row, id, items) = id !== row.id && resolve(id, items) !== null`.
lead's #6530: "ids added must be resolvable - never terminal-cancelled, never the row itself".

These are not the same rule. A reference to a **cancelled** row must be *removable* (it is a broken
pointer - repair, and the only exit for the rows stranded on it) and must not be *addable* (it is a dead
hop the mint already refuses to intend). One predicate that admits cancelled ids lets the verb mint the
very condition the census is trying to eliminate.

**Fix - two predicates:**
```
gateAddIsLegal(row, id, items)   = id !== row.id
                                  && resolve(id, items) !== null          // must exist
                                  && status(resolve) !== "cancelled"      // never a dead hop
                                  && !createsCycle(row, id, items)        // two-node and longer
gateRemoveIsLegal(row, id, items)= (row.blockedBy ?? []).includes(id)    // any recorded id, terminal included
```
`createsCycle` is not optional: a cycle of two rows reads as two open gates and is never named, so a verb
that can add references can create one.

## F4 - the hole is at mint today, not only at the verb

`normalizeBlockedBy` (src/rig.mjs:434-451) checks shape only - positive integers, deduplicated. Nothing
at mint checks that the id exists, is not the row itself, is not terminal, or does not close a cycle.
Probe: mint accepted `blockedBy:[9999]` (target absent), a self-gate, and a gate on a row already
cancelled - all without error.

Live store: **0** dangling, **0** self-gates, **0** two-node cycles, but **19** non-terminal rows gated on
a cancelled id, and **89** gated on a held/deferred target. So the mint hole is latent (nobody has used
it) and the stranding is already real. That ordering matters for the build: **the validator must ship in
the same chain as the verb, first** - lead's #6530 §1 rules exactly this, and it is the right call,
because the verb without the validator is the laundering path the standing bound exists to prevent.

## F5 - a dangling reference is silently unconstraining

`workable` (src/rig.mjs:335-337): `if (!target) continue;` - "a MISSING or AMBIGUOUS signal means WORKABLE"
(refinement 3, src/rig.mjs:300-305). Measured: a row minted with `blockedBy:[9999]` reports
`{workable: true, reason: null}` while the queue line prints `blockedBy=9999`. A gate that reads as a
gate and constrains nothing is the silent class: the seat claims work it was supposed to wait for.

**Fix, keeping the conservative default:** the default stays (a false negative starves a workable row,
and the refusal is legible), but mint refuses the ids that would exercise it. The default is a safety
net, not a licence to mint garbage. Falsifier: mint refuses `[9999]`, `[self]`, `[cancelled]` and a
cycle-creating id with a named refusal; the claim path still treats an unknown id as workable.

## F6 - the two comments 20 lines apart disagree about what a cancelled gate means

- src/rig.mjs:296-298: "`gate-cancelled:#<id>` - a recorded prerequisite was CANCELLED: the prerequisite
  was DROPPED, so the item may be stale. 'terminal' != 'done', and this is a **POSITIVE** non-workability."
- src/rig.mjs:313-317 (`deadGateId` header): "a CANCELLED prerequisite is a **DROPPED** prerequisite, not
  an unmet one".

The code says positive non-workability (src/rig.mjs:337 returns `false`), and the 19 stranded rows prove
it. The prose in `deadGateId` is wrong, and a reader who trusts it will build the opposite rule.

**Fix:** `docs/WORK-ITEM-SCHEMA.md` R5 already carries the rule ("each entry must resolve to a terminal
`done` (a `cancelled` gate is a `gate-cancelled` finding, not a pass)") - what is missing is the repair
clause. Add to R5: "a row left gated on a reference that can never resolve is repaired by *removing* the
reference, not by cancelling the dependent"; and align the `deadGateId` header to R5 rather than restating
the opposite.

## F7 - there is no removal path, so repair is impossible today

`grep` for removal sites in `src/rig.mjs`: **0**. The only exit for a stranded row is `cancel_work` on
the dependent, which orphans every `blockedBy` naming it - the class #6656 swept. And **0 of 7202 rows**
carry a `gated`/`ungated` event (transition events present: queued, claimed, done, deferred, resumed,
cancelled, revised, held, released, priority), so removal is not derivable from the record for any row.

**Fix (pm's #7033, correct as scoped):** write `{event:"gated"|"ungated", by, ids, reason, at}` at the
change; for rows predating the event, the fallback authority is the parties of the row being edited.
Do not extend the fallback to the target's parties - that grants a stranger standing on someone else's
dependency, and the audit trail would show a name with no relationship to the row.

## Failure taxonomy for the seam

| failure | mechanism | recovery |
|---|---|---|
| silent | dangling id reads as satisfied (`workable: true`) | mint refuses it; the conservative read stays as a net |
| contradiction | #6530 and #7034 state different add rules; two comments state opposite meanings for `gate-cancelled` | two predicates; one canonical sentence in the schema doc |
| cascade | a verb added before the validator launders dead gates | validator ships first, in the same chain |
| partial | removal without an event leaves the row unauthored | the `ungated` event is written in the same commit |
| loop | a cycle reads as two open gates forever | `createsCycle` refusal at mint and at add |
| hard | a party tries to remove a gate on a terminal row | allowed - repair; refusal messages name the missing bound |
| context | "why is this row unclaimable?" | the skip code `gate-cancelled:#<id>` plus the census tool |

## Options and the trade-off

- **A. Validator only, no edit verb.** Closes F3/F4/F5 at mint, leaves 19 stranded rows with no exit.
  Rejected: it makes repair impossible and pushes seats to cancel dependents.
- **B. Verb first, validator later.** Rejected: the verb becomes the path that mints what mint refuses.
- **C. Chosen: one chain, validator first, two predicates, events at the change.** Cost: 19 rows need a
  repair pass and every reader must use the shared `gateState`. Reversible: the predicates are additive
  and no existing row is rewritten by them.

## The acceptance I would require

Six assertions with exit codes, run on the MERGED tree and named with its sha:
1. a party may add a live, non-self, non-cyclic gate; a non-party is refused, naming which half it lacks;
2. mint refuses `[9999]`, `[self]`, `[cancelled]`, and an id that closes a cycle;
3. a legacy row with no event is gate-editable by its parties (not by a stranger, not by pm via the view);
4. removing a cancelled reference succeeds and writes `ungated` with `by` and `prior`;
5. removing a live reference with no recorded add is refused, not invented;
6. revert the removal line and show exit 1.

Then the census tool goes green only when **zero non-terminal rows are gated on a reference that can
never resolve** - currently 19.
