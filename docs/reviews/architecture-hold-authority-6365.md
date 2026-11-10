---
review: parking is a party action - the authority model behind the hold_work widening
item: #6365
seat: architect
asked_by: pm
date: 2026-11-11
tree reviewed: main (worktree item-6365)
probe: tools/probes/authority-symmetry.mjs  (exit 1 today: exactly one verb contradicts the model)
status: design position; impl builds (#6364)
---

# The model the rig already has, measured

Two kinds of authority, and they are not the same thing:

- **holder-scoped** - the seat executing the work: `claim_work`, `complete_work`, `defer_work`, `resume_work`.
- **party-scoped** - either side of the row: `revise_work` (`:1314`), `release_work` (`:1277`), `cancel_work` (`:1362`).

The rule that separates them: **a verb that changes a row's status without anyone acting on the work is a party action; a verb that advances the work a seat is doing is a holder action.** The probe classifies every verb against that rule and finds exactly one exception: `hold_work` is address-scoped (`src/rig.mjs:1233`) while `release_work` and `cancel_work` are party-wide. So the minting seat can release a row and can cancel a row, but cannot park one.

That asymmetry is not a missing convenience; it is a hazard by the review checklist. `cancel` is irreversible - terminal, severs every `blockedBy` citing the id, and destroys the row's history. `hold` is reversible - the harness reaps it, the wake stops, and `release` restores it. The rig currently makes the **irreversible** action the only available one and the reversible one impossible. A system where the destructive lever is the legal one produces destroyed rows; pm's own `#6348` cancel-and-remint in the same session is the measured instance.

# What the widening must say, and where the spec is silent

pm's boundary - "widen to the sender, not to anyone" - is right but incomplete. The missing piece is the **status rule**:

- the **holder** may park a row that is `claimed` or `queued` (that is what #5724 established);
- the **sender** may park only a row that is `queued`.

Without the second half, a minting seat can park a row another seat is actively running: the row says `held`, the run continues in its worktree, and the two disagree. The state the store reports and the action in progress would then be in contradiction - the same class as the ordering defect in #6363, just one verb over. *Check:* a demo asserting that a sender's `hold_work` on a `claimed` row is refused, with the refusal naming the status.

# Failure modes, each with a recovery and a check

1. **Widening without the status rule** (contradiction). Recovery: sender = queued only. Check: the demo above.
2. **Comment and code disagreeing** (`src/rig.mjs:1240`: "the seam is widened only for the recipient's own queued row"). A comment describing a boundary the code no longer enforces is a defect in its own right, because the reader acts on the description rather than the code - which is exactly how the #4574 "wrong and load-bearing" premise survived. Recovery: amend the comment in the same commit as the change, not in a follow-up. Check: the sentence names both parties and the status rule.
3. **Ordering drift in the same function.** The widening touches `hold_work`, which also has the #6362/#6363 ordering defect (`:1233` authority before any state check; no terminality check at all). Two rows, one function. Recovery: land the ordering fix first, then the widening, so the second diff reads against the corrected order. Check: `tools/probes/verb-ordering.mjs` must be GREEN before #6364's diff is merged.
4. **Wake noise from someone else's park.** Parking a row changes the recipient's parked set, which fires the parked wake (`src/driver.mjs:54-55`, deduped by the parked signature at `:105-108`). That is correct and bounded - the seat learns the row is parked rather than polling - but it means a seat can now be woken by another seat's decision. Recovery: none needed; the dedup already bounds it. Check: the parked signature for the recipient changes when the sender parks, and an identical second park does not re-wake.
5. **Two owners in the record.** `parkRecord` (`:465-474`) stores class, basis and gate ids but no actor; the `transitions` entry (`:1247-1251`, `event: "held"`, `by: me`) stores who did it. Adding a second "who parked this" field would create two sources that can disagree. Recovery: the transition is the record of who parked; do not add a field. Check: a demo asserting the last transition names the parking seat.
6. **Scope creep from the principle.** Once "party" is the authority for status changes, it is tempting to make `defer_work` party-wide. It must not be: deferring is a holder asking a question, not a row-state control. Say it in the acceptance so the implementation does not generalise past the rule.

# Options and the trade-off

- **(a) Widen `hold_work` to the party** (pm's route). Reuses the authority relation the other status verbs already use, so the model stays one rule. Reversible: the verb can be narrowed again.
- **(b) Park at mint** - `send_work` accepts `held: true`. No post-mint authority at all, and it composes with the parked-registration pattern already in use. But it requires foresight at mint time, and the whole point of this row is the *late* discovery that a row is premature. It also runs into the same "no post-mint write path" family as `gate_work` (#6361).
- **(c) A dedicated `park_work` verb** with a resolver field - more expressive, a new surface, and it splits hold/release into three verbs where two already exist.

Take **(a)**. (b) leaves the actual case unhandled; (c) adds a verb before the authority model is settled. The trade-off I am accepting is a slightly larger authority surface on one verb in exchange for a single, predictable rule across all of them.

# Acceptance, sharpened

- `hold_work` accepts either party for a `queued` row; the holder additionally for a `claimed` row; a third seat is still refused.
- Terminality before authority, per #6363 - `tools/probes/verb-ordering.mjs` GREEN.
- The comment at `:1240` is amended in the same commit.
- `tools/probes/authority-symmetry.mjs` exits 0: every status-changing verb is party-scoped and every work-advancing verb is holder-scoped. That probe is the durable part; the demo proves this commit, the probe protects the model.
