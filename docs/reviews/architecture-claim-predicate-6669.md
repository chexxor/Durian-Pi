# Review: `claim_work` answers two different questions (architect ruling, #6669 / #6667)

**Question.** Lead ruled (#6669) that `claim_work(itemId)` identifies *which* row and must apply the
**same workable predicate** as the oldest-first path. I was asked to review that ruling. Reviewing it
meant answering the question the ruling assumes: what does the predicate actually reject today, and what
does a refusal look like to the seat that receives it?

**Measured** — `node tools/probes/claim-by-id-predicate-6669.mjs`, exit **1** (the bypass is live). The
probe opens a real harness, registers seat `impl` with no capabilities, seeds seven rows, and drives the
real `claim_work` tool through faux model turns, then reads back both the queue row and the exact string
the tool returned to the seat:

| row | what `workable()` says (measured) | what the by-id claim did | what the seat was told |
|---|---|---|---|
| #4 gated on #1 (queued) | `{"workable":false,"reason":"gate-open:#1(queued)"}` | **claimed** | `ITEM #4 ... status=claimed` |
| #2 requires `design`, seat has none | `{"workable":false,"reason":"requires:design"}` | **claimed** | `ITEM #2 ... status=claimed` |
| #5 gated on #6, which is `cancelled` | `{"workable":false,"reason":"gate-cancelled:#6"}` | **claimed** | `ITEM #5 ... status=claimed` |
| #7 held | — | refused | `NO_QUEUED_WORK` |
| #999 does not exist | — | refused | `NO_QUEUED_WORK` |
| #3 ungated control | `{"workable":true,"reason":null}` | claimed | `ITEM #3 ... status=claimed` |

So the two paths are not merely "identical except for selection": the by-id path **drops two of the three
checks** the oldest path applies — `requires` and every `blockedBy` gate. `src/rig.mjs:854-858` is
`it.id === itemId && it.to === me && it.status === "queued"`; `src/rig.mjs:881` is
`selectOldestWorkable` → `workable()` (`src/rig.mjs:320-335`). The comment at `src/rig.mjs:846-851` says
the whitelist is "IDENTICAL to the oldest path". It is a subset.

## The defect, stated exactly

Gates and capability requirements are enforced at **selection** and not at **designation**. A seat that
names a row is exempt from the rules that decide whether that row should be worked. There is no escape
hatch documented, and the seat cannot tell the difference: the bypass looks exactly like a normal claim.

The second defect is legibility. `src/rig.mjs:966`:

```
if (!found) return toolText("NO_QUEUED_WORK");
```

is the same string for "nothing is addressed to me", "that row is held", "that row is not yours", and "that
id does not exist". Measured above: both refusals returned `NO_QUEUED_WORK`. #3663 already established that
`held` must be named in claim refusals; the by-id path never reaches the naming code, because it never
produces a refusal to name — it either claims or says `NO_QUEUED_WORK`.

## Failure modes at the seam, each with the recovery path

1. **Silent out-of-order work.** A gated row is claimed before its prerequisite; the change lands against a
   base that does not contain it. *Recovery today:* none — the claim is indistinguishable from a legitimate
   one. *Fix:* the by-id path runs `workable()` and refuses with the reason code it already produces
   (`gate-open:#1(queued)`, `requires:design`, `gate-cancelled:#6`). Falsified by probe assertion A/B/C.
2. **Ambiguous refusal → human escalation.** A seat that gets `NO_QUEUED_WORK` when it *can see* a row
   addressed to it in `status` will either spin or escalate to the operator. *Fix:* per-cause strings,
   each carrying the action the seat can take ("ask pm to release it", "the row is claimed by you — advance
   it with complete_work"). Assertions E/F.
3. **Predicate divergence.** Claimability is computed in four places: `claim_work` by id (`src/rig.mjs:855`),
   `claim_work` oldest (`src/rig.mjs:881`), `selectWakes` (`src/driver.mjs:130-136`, which already calls
   `workable()` per #6189 so wake and verb cannot disagree), and `release_work`'s dead-gate check
   (`src/rig.mjs:1346-1347`, which uses `deadGateId` - the cancelled-gate subset only, and which also does not
   see a dangling gate id). Each patch lands in one and not the others. *Fix:* every path calls the single
   exported `workable()`, and one probe asserts both claim paths route through it - that is what makes
   "identical predicate" a checked property instead of a comment. The wake leg is already correct; the by-id
   branch is the sole outlier, which is why the fix is small and why the drift survived review.
4. **Ownership lives in the callers, not the predicate.** `workable(item, seat, ...)` (`src/rig.mjs:320`) takes
   `seat` and never reads it: `selectOldestWorkable` filters `candidate.to !== seat` before calling it
   (`src/rig.mjs:349-351`), and the by-id branch filters inside its `find` (`src/rig.mjs:855`). Two shapes for
   one rule is where the next divergence will come from. *Fix:* make ownership part of the verdict
   (`item.to !== seat` → `not-addressed-to:<seat>`) and keep the callers' filters as fast paths. An unused
   parameter in a predicate is a smell worth closing while the path is being rewritten, not a later cleanup.
5. **Override pressure.** Once the bypass is closed, someone will need to start a gated row anyway. If the
   answer is a code escape, the gate is decorative. *Fix:* override is a queue action - release, re-point or
   cancel the gate - visible and attributable (#6552). No seat-side flag.
6. **Dangling gate reference.** `src/rig.mjs:329` treats a gate id that names no row as satisfied, while the
   mint-time rule (D271, #6664) refuses to author such a gate. Census: 0 of 211 gated rows name a
   non-existent id, so today this is unexercised; it is not harmless, because a `blockedBy: [42]` where 42
   never existed means the author meant "blocked on something" and the code says "not blocked".
   *Decision below.*
7. **Refusal text bloat.** A refusal that dumps the whole gate list costs context on every wake. Bound it:
   row id, one reason code, one action.

## Options considered

**Option A — keep two predicates, add the missing checks to the by-id path.** Smallest diff. Rejected: it
leaves the duplication that caused the drift, and the comment at `src/rig.mjs:846-851` still asserts identity.
The bug class is "two places that must agree"; shrinking the diff does not remove the class.

**Option B — call `workable()` inside the by-id branch.** Better, but if the by-id path keeps its own status
whitelist around it, the two still disagree about *held* and *foreign* rows, and `workable()` does not check
ownership at all (finding 4), so the whitelist would have to stay.

**Option C (recommended) — one function, one call site.** The by-id branch computes the row and then
`return workableOrRefusal(row, me, queueView)`; the oldest path is the same function over the sorted list.
There is then no second predicate to drift. Reversible: if a future need arises to claim a non-workable row,
it is expressed as a queue mutation, not a tool argument.

**On dangling gate ids:** strict-at-claim / report-at-wake. A wake is a hint and can afford softness
(D271's read-time rule); a claim is the last line before work starts, so it should refuse and name the
cause: `gate-dangling:#42 — no such row; ask pm to re-point or remove the gate`. The cost of refusing is
zero today (0 rows in that state) and the cost of not refusing is the same out-of-order work as mode 1.
Trade-off accepted: a typo'd gate id strands a row visibly (the seat says so) instead of letting it run
unblocked invisibly.

## Acceptance criterion for #6667 (the exhaustive matrix)

The probe covers six states. A change is complete only when this matrix is asserted, because the bug class
is "one path forgot a column":

| status | gates | capability | expected |
|---|---|---|---|
| queued | none | ok | claim |
| queued | one open | ok | refuse `gate-open:#n(status)` |
| queued | all done | ok | claim |
| queued | one cancelled | ok | refuse `gate-cancelled:#n` |
| queued | one dangling | ok | refuse `gate-dangling:#n` |
| queued | none | missing | refuse `requires:<cap>` |
| held / deferred / claimed / done / cancelled | any | any | refuse, naming the status |
| addressed to another seat | any | any | refuse, naming it |

**Probe:** `node tools/probes/claim-by-id-predicate-6669.mjs` — exit 1 while the bypass exists, exit 0 after
#6667 lands. That is the falsifiable check; the review is not the check.
