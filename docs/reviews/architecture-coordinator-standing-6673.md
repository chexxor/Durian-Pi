# Review: where coordinator standing comes from, and how deep a gate reference may reach (#6673, ruling #6672)

**Question.** lead ruled two things: (1) `seatIsCoordinator({capabilities: ["design"]}) === true` is a drift — an unrecognised capability string became an implicit grant of authority; (2) a gate reference should be bounded at one level. Both are the same question in different clothing: **is a seat's authority over a row derived from data the rig recorded, or from a string nobody validated?**

**Run.** `node tools/probes/coordinator-standing-6673.mjs` → exit 1, six open gaps, real harness, real tools, faux turns, worktree HEAD `35001c3a`, pi-durable 1.3.0 from the lockfile. The live store (`../selfdev.sqlite`) was opened read-only only to look at declarations; the census below is `rig.selfdev.json` as shipped, snapshot taken at the same moment.

## What was measured

**A. The classification.** `src/seattools.mjs:262, 292`:

| declared capabilities | `seatIsCoordinator` | working tools removed |
|---|---|---|
| `["design"]` | true | 5 |
| `["review"]` | false | 0 |
| `["route","plan"]` | true | 5 |
| `[]` | true | 5 |

**B. The census, counted as lead asked.** 12 seats declared; 5 findings:
- `pm` (`route,plan`) and `lead` (`decide,adjudicate`) — nothing recognised as working → coordinator. **Intended.**
- `advocate` (`advocate`), `security` (`security`), `architect` (`design`) — one declared string carries no standing; the seat's classification hangs on the other string.

Severity by counting, then: **no seat is mis-classified by accident today.** The exposure is one deletion away — drop `review` from `architect` and that seat silently becomes a coordinator: it loses `read`, `write`, `edit`, `bash`, `prepare_workspace` and gains release authority over rows it has no part in.

**C. The authority that classification grants, through the verb.** `src/rig.mjs:1315-1323` computes `isParty` from `item.to`/`item.from` and `coordinating` from capability absence, then allows release if either is true. Measured:
- `designer` with `["design"]`, not a party: *"item #1 released back to queued by designer (coordinator release: un-parking it)."*
- `impl` with `["implement"]`, not a party: *"item #4 is addressed to other-seat (from pm); only the sender, the recipient, or a coordinating seat may release it."*

Same seat class, same row, one string difference. The grant arrives by parsing.

**D. The depth bound does not exist.** `gateStanding` is not exported from `src/rig.mjs`; no code computes hops. The only gate-write surface today is mint (`src/rig.mjs:778` normalises `blockedBy`, `:783` calls `assertSendAllowed`). Measured: `designer` mints a row `blockedBy: [1]` where row 1 is pm's and designer is neither party nor resolver — `queued item #20 for impl`. Accepted.

**E. A related hole in the same vocabulary.** `assertSendAllowed` (`src/rig.mjs:73-91`) checks the recipient's caps contain the `requires` string, but nothing checks that the string belongs to a known vocabulary. A typo (`impliment`) on both sides matches, and `checkup.mjs` has no rule for it — `grep -n requires src/checkup.mjs` returns nothing.

## The defect, named exactly

One predicate answers two unrelated questions:

1. **Provisioning** — does this seat need file and shell tools to do its work? (`COORDINATOR_REMOVALS`, `src/seattools.mjs:267`)
2. **Authority** — may this seat act on a row it did not mint? (`src/rig.mjs:1317-1322`)

`seatIsCoordinator` answers both from the same fact: "no capability in `WORKING_CAPABILITIES`". So a *vocabulary* question becomes an *authority* grant. That is the drift lead named, and it is not fixable by adding strings to the list: the list is the wrong instrument for question 2.

## The contract to implement

```
standing(seat, item)      = item.from === seat || item.to === seat || item.block?.resolver === seat
referenceOk(seat, target, items) =
      target exists in items
      && !isTerminalCancelled(target)          // gate-dangling, D271
      && ( standing(target)
           || ∃ row r in items, within ONE hop of target's gate chain, with r.from === seat )
      // else refuse, at write time, inside the commit, over the combined graph
```

Three clauses, each falsifiable:
- **Party or resolver only.** Mint-scoped authority is `from` (D258 point 3, #3470). `block.resolver` counts because that seat is the one who must clear the park.
- **One hop.** Standing on a row extends to the rows its gate chain names within one link. Depth 2 is refused — asserted, not assumed.
- **Validated vocabulary at config load.** Two sets from one source: `DECLARABLE_CAPABILITIES` (strings a seat may declare, used for `requires` matching) and `WORKING_CAPABILITIES` (the subset implying tool access). An undeclared string is refused at load and reported by `check`, not silently reclassified at runtime.

**On `design` specifically.** lead asked whether the architect seat genuinely performs design work that must be claimable. It does, and the evidence is this branch: design output here is a committed artifact (`docs/reviews/architecture-verb-admission-order-6671.md`, `docs/DECISIONS.md` D275, `tools/probes/verb-admit-order-6671.mjs` — commits `eed27f44`, `dca045b3`). A design deliverable is a file, so the seat needs `write`/`edit`. Recorded reason for `WORKING_CAPABILITIES`: *design deliverables are commits.* `route`, `plan`, `decide`, `adjudicate`, `advocate`, `security` stay declarable but not working — they describe coordination and judgement, not file work. That distinction is the whole design: provisioning is a tool question, authority is a data question, and the vocabulary is validated before either is asked.

## Failure modes at the seam, each with a recovery path

| mode | what happens | recovery |
|---|---|---|
| silent | capability registration fails; the seat is classified coordinator and loses its tools while gaining release authority | refuse unknown strings at load; `check` reports seats whose capabilities are all non-working (today: pm, lead — expected, so the report is a diff, not noise) |
| laundering | A mints a row gated on B's row; A now controls whether B's work is workable | `referenceOk` at mint and at `gate_work`; refusal names the target id, the seat's standing, and the legal alternative (mint the row carrying the gate, or ask a party) |
| cascade | a chain A→B→C→D makes a seat's work depend on rows nobody referenced legitimately | depth cap of 1 at write; chains only grow through parties |
| cycle | `blockedBy` loops; nothing is ever workable | `validateGate` (#6512) rejects self-reference and cycles; `check` rule `gate-cycle` (#6497) |
| contradiction | `release_work` refuses a gate naming a cancelled row while `claim_work`'s conservative default passes a dangling id — the same id reads as "blocked" for one verb and "workable" for another | one `gateOpen` predicate, called at every write (D274); `gate-dangling` and `gate-cancelled` are separate finding classes (D271) |
| refusal legibility | a refusal that says "not allowed" sends the seat to escalate rather than act | every refusal carries id, reason, remedy — the same shape as D275's admission order |
| stranded park | a held row whose gate is dead has no non-terminal repair if only parties may act | keep the coordinator release carve-out, but it must be a **recorded lever**, not a derived classification. Reversibility is the test that justifies it: release is undoable (the sender can re-hold), cancel and revise are not (D258 point 1) |
| authority drift back in | someone implements `gateStanding` reading `seatIsCoordinator` | the probe asserts the predicate's inputs: a seat that is not a party and not a resolver is refused regardless of its capabilities. It goes green only when that is true |

## Options and the trade-off accepted

- **(a) Keep derivation, add a check finding.** Cheapest; the drift survives because `check` reports rather than prevents. Rejected — `check` findings do not stop a write.
- **(b) Validate the vocabulary at load, derive provisioning from it, derive authority only from stored fields, and make the coordinator release carve-out an explicit recorded lever.** Chosen. Cost: one config field and a closed set to maintain; friction when a genuinely new capability appears — which is the point, because a capability no one can match is meaningless anyway. Reversible: the sets are data, and the predicate can be reverted to the old one in one edit if it proves too strict.
- **(c) Remove the coordinator release carve-out entirely.** Rejected on measurement: D258 point 2 and #3747/#6665 show a parked row with a dead gate has no non-terminal repair for its parties. A row nobody can un-park is a stranded row.

Trade-off stated out loud: this makes some writes that today succeed fail. The accepted cost is a few more refusals and a slightly larger config; the gain is that authority can no longer arrive by spelling.

## What the probe asserts

`tools/probes/coordinator-standing-6673.mjs` is RED now and GREEN when `gateStanding` lands: it imports the predicate if it exists and asserts four cases — party allowed, non-party non-resolver refused, one hop allowed, depth 2 refused — plus that the mint path refuses a reference the sender has no standing on. It does not assert prose; it asserts behaviour.

## Open items, routed

- `gateStanding` is impl's to mint (#6672), the probe is architect's to pin (#6673), the verification leg is advocate's.
- Whether `check` should refuse at load or report is a scope question for **lead**; my recommendation is refuse, because a report that does not stop a write is not a control.
- `requires-unsatisfiable` as a check rule is not in scope here; it belongs with the vocabulary work.
