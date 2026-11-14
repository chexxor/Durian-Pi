# Review: the four conditions #6530 left open, and the one that is written wrong (#6707)

**Question.** pm routed four conditions from the coordinator-standing ruling to lead (#6706) because #6530 is not pm's to revise (measured refusal: *"item #6530 is not yours to revise (from=lead to=devtools)"* — that refusal is itself the D275 authority rule working correctly). Are the four conditions right, and what is the concrete shape each one must take?

**Run.** `node tools/probes/gate-dead-end-6707.mjs` → exit 1, three unrecoverable states, branch `item-6707`, HEAD `35001c3a`, pi-durable 1.3.0 from the lockfile. The conditions' individual claims are checked against the code and the running rig.

## Each condition, checked

**1. "Re-validate at the verb, not just record at mint."** Correct in intent, wrong as written. The proposed predicate is `item.coordinatedBy === me && seatIsCoordinator(seats[me])`. Measured:
- `grep -n coordinatedBy src/rig.mjs src/*.mjs` → **no hits**. The field pm's predicate reads does not exist anywhere in the rig, so "record at mint" is not implemented and the check would silently evaluate `undefined === me` for everyone.
- The flip is real: `seatIsCoordinator({capabilities: []}) === true`, `seatIsCoordinator({capabilities: ["design"]}) === true`, `seatIsCoordinator({capabilities: ["implement"]}) === false` (`src/seattools.mjs:292`). Standing changes when a seat's capability list changes — which is the drift D276 rules out.
- **Fix.** Authority is read off the row, never off the actor's classification: `standing(me, item) = item.from === me || item.to === me || item.block?.resolver === me`, plus a *recorded* lever for the one delegable verb (release). Re-validation at the verb means re-running the row's own gate predicate (`gateOpen`) at the moment of the write, and the refusal must say which step of admission failed — existence, terminality, authority, applicability, gate — not "which half". Naming the step is what makes the refusal actionable; naming "the half" leaves the seat to guess.

**2. "The vocabulary is load-bearing."** Verified: `WORKING_CAPABILITIES = ["implement","code","verify","review"]` at `src/seattools.mjs:262`, and one predicate (`seatIsCoordinator`) answers *both* "does this seat need file tools" and "may this seat act on a row it did not mint". Census measured in #6673: 12 seats declared, 0 capability-less, 2 coordinators by design (`pm: route,plan`, `lead: decide,adjudicate`), 3 seats carrying a string that confers nothing (`advocate`, `security`, `design`). So nothing is mis-classified today and the exposure is one deletion away. Fix: two sets from one source — `DECLARABLE_CAPABILITIES` (what a seat may declare, used for `requires` matching) and `WORKING_CAPABILITIES` (the subset implying tools) — and an undeclared string is a config error caught at load, not a silent reclassification at runtime. `design` joins the working set with the recorded reason "design deliverables are commits".

**3. "Additive only is reversible only if a removal path exists."** Verified, and it is worse than a missing feature — it is a dead end. The probe puts a held row #1 gated on #2, cancels #2, and then tries every verb a party has:

| attempt | result |
|---|---|
| `pm.revise_work(#1, body=…)` | *"item #1 is not queued (status=held); only unclaimed work can be revised"* |
| `pm.release_work(#1, reason=…)` | *"item #1 not released: its gate names #2, which is cancelled"* |
| `pm.hold_work(#1)` | *"item #1 is addressed to impl, not you"* |
| `impl.claim_work({itemId: 1})` | `NO_QUEUED_WORK` |
| `impl.release_work(#1, …)` | refused, same gate rule |
| `pm.revise_work(#1, …, blockedBy: [])` | schema rejects the argument: *"blockedBy: schema is false … must not have additional properties"* |
| `pm.cancel_work(#1, reason=…)` | **works** — the row is cancelled |

`grep -n blockedBy src/rig.mjs` shows writes only at mint (`:464`) and reads everywhere else: **0 removal sites**, and `check` has **0 rules** mentioning `blockedBy`. So a parked row whose gate dies has exactly one repair: end the row. That is the failure mode the design must answer — the bookkeeping error destroys the work.

**Fix.** `gate_work(itemId, add?: [ids], remove?: [ids])`, party-scoped (D258 authority), recording `{by, reason, at}` on the row, notifying the author the way cancellation does (#3470), and validated inside the commit against the combined graph: no self-gate, no cycle, no id that does not exist, no reference the caller has no standing on (the #6673 bound). Sequencing is not optional: **removal without the standing rule is the laundering path**. A verb that can attach any id, from any party, with no depth bound, is a bigger authority than the one it replaces. #6508 (removal) and #6672 (standing predicate) are one contract and must land together.

**4. "Bound the standing with a number, depth 1, not a phrase."** Agreed, and the number has to be in the predicate, not the prose. Pinned in D276:
```
standing(seat, item)  = item.from === seat || item.to === seat || item.block?.resolver === seat
referenceOk(seat, target, items) =
    target exists && !cancelled(target)
    && ( standing(target) || ∃ row r within ONE hop of target's gate chain with r.from === seat )
```
The probe in #6673 imports `gateStanding` if it exists and asserts four cases — party allowed, non-party non-resolver refused, one hop allowed, depth 2 refused — so the bound is falsifiable the day it is written. Two additions the phrase does not carry: the bound applies to **removal** as well as addition, and the refusal must name the offending hop, otherwise a seat that is refused cannot tell which link to fix.

## The conflict pm pointed at (#6690)

Lead's ruling and the landed release authority (#6112) disagree about whether a non-party may un-park a row. Measured in #6673: a seat declaring only `["design"]` released a held row it neither sent nor received — *"released back to queued by designer (coordinator release: un-parking it)"* — while a seat declaring `["implement"]` was refused on the same kind of row.

The resolution is not to remove the carve-out. It is to stop deriving it from a classification that answers a different question. The justification that survives is **reversibility**: release is undoable by the sender, cancel and revise are not, so release is the one verb that can be delegated. Delegated power should be *granted*, not inferred from an absent string. Concrete: seats declare levers in config (`levers: ["release"]` for pm and lead), `check` reports any seat whose capability set implies coordinator status without a declared lever, and `seatIsCoordinator` keeps exactly one job — tool provisioning. Falsifiable: the #6673 probe asserts a non-party non-resolver with only unrecognised capabilities is refused, and it is RED today.

## Failure modes and recovery for this seam

| mode | what happens | recovery |
|---|---|---|
| dead-end | a parked row's gate is cancelled; no verb can clear it | `gate_work` with `remove`; until then, cancellation is the only exit — which is the loss this review is about |
| laundering | the removal verb also allows attaching any id, from any party | depth-1 standing bound lands in the same commit as the verb |
| invisible | nothing reports a row parked on a dead gate | a `gate-dangling` / `gate-cancelled` check rule; `check` currently has zero rules touching `blockedBy` |
| authority drift | the re-validation check reads `seatIsCoordinator`, so a spelling accident grants standing | authority read from stored row fields; vocabulary validated at load |
| unfixable refusal | a refusal says "not allowed" with no remedy | every refusal names the failed step and the verb that fixes it |
| re-park gap | a released row cannot be re-parked by its sender (`hold_work` is recipient-only; measured *"item #1 is addressed to impl, not you"*) | `gate_work`/`hold_work` authority must be reconciled with mint-scoped authority (D258 point 3, registered in #5662) |

## What I am not deciding

Whether the gate-removal verb ships in #6530's tranche or as a follow-up is a scope call for lead; the architectural constraint is only that **standing and removal land together**. Whether an undeclared capability string is refused at load or merely reported is also lead's, and I recommend refused: a report that does not stop a write is not a control.
