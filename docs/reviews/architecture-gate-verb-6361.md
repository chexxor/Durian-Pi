---
review: the gate_work verb - authority, exit, and the ordering it inherits
item: #6361
seat: architect
asked_by: pm
date: 2026-11-11
tree reviewed: main (this worktree, branch item-6361)
probe: tools/probes/gate-write-surface.mjs  (exit 0)
status: design position given; the AUTHORITY field is unresolved and must not land until lead rules (#6360)
---

# What `gate_work` actually is

`blockedBy`, `requires`, `tier` and `block` are written once, in the mint path: `normalizeBlockedBy`
is called at exactly two places in `src/rig.mjs` - its definition at `:368` and its single call site
inside `send_work` at `:755`. The probe confirms the consequence with zero exceptions: **no verb in
the tool surface re-writes or clears a row's gate field.** The verbs that exist are `send_work,
claim_work, complete_work, defer_work, resume_work, hold_work, release_work, revise_work,
cancel_work, peek_queue`. So a constraint discovered after minting has nowhere to go except the
subject, and `workable()` (`src/rig.mjs:303-319`) reads only `status`, `requires` and `blockedBy` -
never subject or body. The gate then exists in a sentence and not in the machine.

**Measured on the live rig** (mirror read-only, store not opened): 1,178 non-terminal rows, 178 with
a structured gate, **249 whose subject carries gate words ("GATED", "awaits", "before", "sequenced",
"prerequisite") and no field**. Prose is not the exception; it is the majority form. That is the
evidence for the verb - and the reason the verb alone fixes nothing: it writes new gates correctly,
it does not convert the 249.

# The contract the verb must have

**Receives:** an item id, a list of gate ids, and a reason. **Produces:** the stored gate and the
digest of the row as stored, plus a transition record naming who added which ids. **NOT
responsible for:** deciding who is the coordinator; that is a ruling, not a computation (see the
authority section). Also not responsible for converting prose gates - that is a reporting rule, not a
write verb.

Reuse the pattern already in the source rather than inventing one: `applyRevise` (#3435) returns a
status, the fields it wrote, and a digest of the STORED body so the caller verifies instead of
trusting. `gate_work` should return the same shape; a verb that says "gated" without returning the
stored value is unverifiable by construction.

# Failure modes, each with a recovery and a check

1. **Authority is undefined, so the first implementation defines it.** The row says "a seat
   recordable on the row as its coordinator" and explicitly refuses to infer it from role or the org
   graph. As written that is not a predicate: it cannot be evaluated. *Recovery:* lead's ruling
   (#6360) must be expressible as a function over stored fields. *Check:* a probe where a seat that
   is neither party nor recorded calls `gate_work` and is denied with a reason naming the field it
   consulted. If the denial's reason is not derivable from the rule text, the rule is not a rule.
2. **Additive-only, with no exit - a wrong gate is permanent.** Nothing clears `blockedBy` today
   (probe: 0 removal sites), and the verb is specified as additive. A gate added in error blocks its
   dependents forever; the only remedy left is `cancel_work`, which destroys the work. *Recovery:*
   pair the verb with a removal path of *narrower* authority - the seat recorded in the transition
   that added the ids, or the operator. *Check:* add a gate, remove it, assert `workable` flips and
   the transitions list holds both the add and the remove.
3. **Cycles can now be born after minting.** My review of #6357 rested on the claim that cycles can
   only be created at enqueue, because `blockedBy` is immutable; `revise_work` touches only subject
   and body (`src/rig.mjs:1296-1339`). This verb falsifies that precondition. *Recovery:* the same
   validator runs over the *combined* set on every write, and a cycle formed by two successive adds
   is refused at the second add. *Check:* `gate_work(A,[B])` then `gate_work(B,[A])` must fail on
   the second call, not leave two rows mutually blocked.
4. **Ordering: state before authority, or the report is false.** `release_work` checks terminality
   first (`src/rig.mjs:1269-1275`, the #5778 ruling: a closed row is not parked, and an authority
   refusal about it makes a coordinator report finished work as parked). The probe measures the
   current state of the others: `revise_work`, `cancel_work` and `hold_work` all check authority
   **before** status - already routed as #6362. If `gate_work` inherits the wrong order, a seat told
   "not yours to gate" about a `done` row will report that row as live and gated. *Recovery:*
   terminality, then status, then authority, in that order, in every constraint verb. *Check:* call
   `gate_work` on a `done` row from a seat with no standing and assert the answer mentions `done`.
5. **`queued`-only leaves the parked half ungated.** 435 of the live rows are `held`. A gate
   discovered while a row is parked cannot be recorded, so it goes to prose - the exact decay this
   verb is meant to end. Gating a held row is harmless: `workable` refuses a non-queued row anyway
   (`src/rig.mjs:305`), so the gate simply takes effect when the row is released. *Recovery:* accept
   `queued` or `held`; refuse `claimed`, `deferred` and terminal. *Check:* gate a held row, release
   it, assert claim is blocked until the parent is `done`.
6. **Additive semantics must be idempotent.** Re-adding an id already in the gate must report
   no-change with the stored digest, not append a duplicate. *Check:* the probe's two identical adds
   return equal digests and a gate of length 1.
7. **The 249 prose rows stay prose.** The verb does not retrofit. *Recovery:* a check rule that
   reports rows whose subject carries gate language and whose `blockedBy` is empty, so they are
   converted one at a time; never a bulk rewrite (each conversion changes which work is claimable).
   *Check:* the rule's output count moves when one row is converted, and does not change when an
   unrelated row is touched.

# Options, and the trade-off I accept

- **A. The narrow verb as specified** (constraint fields only, additive, queued-only, transitions,
  stored digest), *plus* an ungate path with narrower authority and the shared validator. Widening is
  reversible later; the surface is small enough to audit.
- **B. A general constraint-edit verb** covering `tier`, `requires`, `block` and `blockedBy`. One
  verb, fewer seams, but it hands one seat the ability to rewrite another seat's whole constraint set
  - a larger authority surface than the problem needs, and the authority question (#6360) is not
  answered yet.
- **C. No verb: re-mint.** Cancel and resend with the gate. Keeps immutability and needs no new
  authority, but it loses the id, breaks the chain every other row cites, and creates the duplicate
  rows this rig already has too many of. Irreversible in exactly the way A is not.

I accept **A**. C is the only option that cannot be walked back, and B buys authority before the
question of who deserves it has been answered.

# The one thing that must not be skipped

**`#6359` carries its own sequencing constraint in prose.** The mirror line reads
`#6359 queued from=pm to=impl ... blockedBy=6356`. The requirement "until the authority ruling is
answered, #6359 should not land" is stated in the body; `#6360` is not in its `blockedBy`. So the row
that introduces the gate verb is gated on validation and not on the authority ruling - the prose-gate
failure this row exists to fix, live, in the row itself. The fix is one field: `blockedBy=[6356,6360]`.

# Decision to record once lead rules

Status: proposed, blocked on #6360. Context: constraints have no post-mint write path; giving one
requires naming who may write. Decision: `gate_work` writes constraint fields only; it validates with
the single exported gate validator; it checks state before authority; it accepts `queued` and `held`;
it is additive, and a paired removal path exists with narrower authority; every add and remove is a
transition naming the seat and the ids. Consequences: late gates stop becoming prose; cycles become
possible post-mint and must be refused at write; the 249 prose rows remain until a reporting rule
converts them. Reversibility: the verb can be narrowed or removed without touching stored rows, since
gates can be removed by the paired path.
