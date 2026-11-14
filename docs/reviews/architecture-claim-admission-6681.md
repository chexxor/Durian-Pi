# Review: the claim seam has two rules, and one of them is a bypass (#6681 / #6526)

**Question.** pm amended #6526 to make the claim seam one admission rule with eight acceptance cases, and to make the refusal name the remedy verb. Is the seam one rule today, and is the refusal design compatible with the strings the rig already depends on?

**Run.** `node tools/probes/claim-admission-6681.mjs` → exit 1, fifteen open gaps, real harness, real `claim_work`, faux turns, branch `item-6679`, HEAD `35001c3a`, pi-durable 1.3.0 from the lockfile.

## Measured

**1. The by-id path never calls the predicate.** `src/rig.mjs:851-860` filters on `it.to === me && it.status === "queued"` and admits the row. Its own comment says the whitelist is "IDENTICAL to the oldest path". Run against real rows addressed to a seat with capabilities `["implement"]`:

| row | predicate (`workable`) | what `claim_work({itemId})` does |
|---|---|---|
| #2, queued, gate #3 open | refuses `gate-open:#3(queued)` | **CLAIMED** |
| #4, queued, `requires: design` | refuses `requires:design` | **CLAIMED** |
| #9, queued, gate #10 cancelled | refuses `gate-cancelled:#10` | **CLAIMED** |
| #11, queued, gate id 12 does not exist | workable (conservative default, D271) | CLAIMED — agrees |

The wake layer already uses one predicate: `src/driver.mjs:130-137` computes `workable(it, name, …)` for every candidate wake. So the rig has *three* rules for one seam — wake selection, oldest claim, by-id claim — and two of them agree. The fix is not new machinery; it is deleting the third rule.

**2. Five situations, one string.** `claim_work({itemId: 5})` (held), `{itemId: 6}` (deferred), `{itemId: 7}` (done), `{itemId: 8}` (another seat's row), `{itemId: 999}` (does not exist) all return exactly `NO_QUEUED_WORK`. Same defect as the `claim_work` finding in D275: the reader learns nothing about the row it named.

**3. The skip report counts but does not explain.** For a seat with one held row and one queued row whose gate is open, the oldest path returns:
`NO_QUEUED_WORK — but NOT an empty queue: #20 is addressed to you and is now `held` (and 1 more row(s) addressed to you). It is parked awaiting release; a row you hold is not a claim offer.`
The gated row is counted, not named. A seat reading "1 more row addressed to you" has no reason to think it is blocked, and the next thing it can do is ask for scope.

**4. The goldens pm names are real, and they constrain the wording.** `demo/race.test.mjs:84` asserts exact equality with `NO_QUEUED_WORK` (or a `STALLED_CLAIM #` prefix); `demo/rearmclaim.test.mjs:132` asserts exact equality for a seat with nothing queued and nothing held; `demo/defer.test.mjs:228` asserts a substring; `src/driver.mjs:33-36` documents `NO_QUEUED_WORK` as the wake-path signal. So "keep it as a prefix with detail appended" works for the *no-work* path only if the bare string is reserved for the genuinely-empty case. Appending detail to the same string for a named-row miss breaks two equality goldens — and weakening them to substrings removes the guarantee the wake contract depends on.

**5. No standing check sees gate integrity at all.** `grep -n blockedBy src/checkup.mjs` returns nothing. Today the only place a gate is evaluated is at wake selection and at oldest-claim; a row claimed by id is outside both, and no rule reports it.

## The defect, named

**Claim by id converts a gated row into a claimed row, and a claimed row is invisible to every predicate that looks at `queued`.** That is the cascade: the row leaves the wake layer's view, leaves the oldest path's view, and no check reports an open gate on it. A seat then holds work the rig never admitted, and the reason is unrecoverable except by reading the queue by hand. pm's amendment names the symptom (the by-id branch skips `workable()`); the severity is that the skip is *permanent*, not transient.

## The contract

**One predicate, two questions, one call site each** (consistent with D275 and D274):
```
claim_work(itemId):
  admitRow(item, me, "claim_work")   // existence -> terminality -> authority -> applicability
  verdict = workable(item, me, {items, capabilities})   // gate + capability
  if verdict not workable: refuse with class + remedy, never mutate status
```
The refusal text is *generated from the verdict reason*, not from a hand-written list — a list is the thing that drifts.

**Token taxonomy, chosen so the load-bearing string stays exact:**
- `NO_QUEUED_WORK` — bare, only when the seat has no rows at all. This is the wake-path signal (`src/driver.mjs:33-36`) and the exact-equality golden. It must not gain suffixes.
- `NO_QUEUED_WORK — but NOT an empty queue: …` — the oldest path already emits this; extend it to name **each** passed-over row and its reason (`gate-open:#3`, `requires:design`, `held`), not just the oldest plus a count.
- `NOT_CLAIMABLE #<id> — <class>: <remedy>` — for a named row. Classes: `unknown-id`, `terminal`, `parked`, `deferred`, `claimed-by-you`, `addressed-to-<seat>`, `gate-open:#n`, `gate-cancelled:#n`, `requires:<capability>`.
- Remedy per class: parked → `release_work` (by a party, or a coordinating seat carrying a reason, D258); deferred → `resume_work`; claimed-by-you → `complete_work`/`defer_work`; gate open → nothing the claimant can do, so name the gate id and the sender; terminal → nothing; unknown id → `peek_queue`.

**Acceptance, corrected.** pm's eight cases are the right shape but incomplete in two ways. Add: (a) a row whose gate names a **cancelled** row (the predicate already distinguishes `gate-cancelled` from `gate-open`; D271/D274); (b) a row whose gate id does not exist — the conservative default says workable, so the by-id path and the oldest path must *agree* that it is claimable. The invariant worth asserting is not "eight refusals" but **both paths return the same verdict for the same row**. A case list without that invariant is satisfied by two divergent rules that happen to refuse in eight of the tested situations.

## Failure modes and recovery

| mode | what happens | recovery |
|---|---|---|
| silent bypass | a gated or capability-mismatched row is claimed by id | one predicate on both paths; probe asserts agreement row by row |
| cascade | a claimed gated row is no longer `queued`, so no predicate or wake sees it | refuse at claim; add a `claimed-row-with-open-gate` check finding (does not exist today) |
| contradiction | the wake says "call claim_work" and the verb refuses for a reason the wake text never mentioned | wake and claim share `workable` (already true); the refusal must name the remedy so the seat acts instead of escalating |
| loop | seat claims, cannot advance, re-claims | the refusal names the remedy verb, and the class is a token the seat can branch on |
| golden drift | adding detail to `NO_QUEUED_WORK` breaks exact-equality assertions | reserve the bare string for the empty-queue case; new assertions test the class token, not the sentence |
| vocabulary drift | `requires: "impliment"` matches a typo'd capability and nothing else | capability strings validated against one closed vocabulary at config load (D276); admission and provisioning read the same set |
| observability | gate integrity is checked nowhere (`grep blockedBy src/checkup.mjs`: no rules) | the gate rules from #6497/#6512 (dangling, cancelled, cycle) plus the claimed-row finding, wired into `check` |

## Options and the trade-off

- **(a) Add `workable()` to the by-id branch, keep the current text.** Cheapest; the seat still gets `NO_QUEUED_WORK` for five different situations. Rejected: it closes the bypass and leaves the legibility defect that generated the rows in the first place.
- **(b) One predicate plus the token taxonomy above.** Chosen. Cost: the refusal strings change, so goldens move in the same commit, and the by-id path becomes *stricter* — rows a seat can claim today become refusals. Accepted, because the only rows that stop being claimable are ones the rig already declared not workable.
- **(c) Treat by-id as an operator escape hatch that deliberately bypasses gates.** This is the scope question pm sent to lead. Architecturally it is coherent only if the bypass is *recorded*: the row would need a marker saying "claimed outside admission by X", or the wake/claim contract becomes unfalsifiable. My recommendation: if lead wants an escape hatch, it belongs to the operator's verbs (`cli.mjs`), not to a seat's tool, and it must leave a recorded trace. That is lead's call, not mine.

## What the probe asserts when the seam is closed

`tools/probes/claim-admission-6681.mjs` compares, for every row addressed to the seat, the predicate's verdict against the verb's action, and fails if they disagree in either direction — including the case where the predicate says workable and the verb refuses. It also asserts that each named-row refusal contains the id and a remedy verb. It goes GREEN only when both paths use one rule and every refusal is actionable.
