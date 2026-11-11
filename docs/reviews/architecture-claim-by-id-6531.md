# Review: #6531 - `claim_work` by id reports a held, deferred or closed row as `NO_QUEUED_WORK`

**Tree:** branch `item-6531`, HEAD `9ae345df` (pi-durable 1.3.0 lockfile resolution). **Read as:** review of the routed row #6526 and its acceptance. Nothing implemented here.

**Falsifiable gate:** `node tools/probes/claim-by-id-gate-bypass.mjs` -> **exit 1 (RED, 3 divergences)** at this HEAD.

## The routing is right about the symptom, and it stops one seam short

The by-id path is real and legible-poor: `src/rig.mjs` `claim_work` does
`queue.items.find((it) => it.id === args.itemId && it.to === me && it.status === "queued")`, `if (!named) return null;`, and the caller returns the bare `NO_QUEUED_WORK`. Naming the id and its status is the correct fix, and "reporting only, nothing becomes more claimable" is the right scope.

Two defects in the row as written:

**1. The acceptance count does not match the enumeration.** The body lists five statuses (held, deferred, claimed-elsewhere, done, cancelled) and then says acceptance is "the four cases asserted in a demo". Six assertions are needed: five statuses plus the genuinely-absent id. A row whose acceptance set is smaller than its scope ships an unverified class.

**2. `NO_QUEUED_WORK` is load-bearing text.** Three demos assert it exactly:
- `demo/race.test.mjs:84` - `r.text === "NO_QUEUED_WORK" || r.text.startsWith("STALLED_CLAIM #")`
- `demo/rearmclaim.test.mjs:132` - asserts equality for "no held claim, nothing queued"
- `demo/defer.test.mjs:228` - substring match
and `src/driver.mjs:36` documents it as the wake-path signal a seat sees when its item is claimed rather than queued.
**Fix:** keep `NO_QUEUED_WORK` as a stable **prefix** and append the detail - the oldest-claim path already does exactly this (`src/rig.mjs:958`: `NO_QUEUED_WORK — but NOT an empty queue: #<id> is addressed to you and is now \`<status>\``). Row #6526 must name the three goldens and require them to stay green; otherwise the change lands red or a consumer that matches the literal stops matching.

## The defect the routing does not reach: the two claim paths use two different predicates

Measured by `tools/probes/claim-by-id-gate-bypass.mjs`:

```
by-id path length 503 chars; contains "workable"? false; "blockedBy"? false; "requires"? false
by-id admission filter: queue.items.find((it) => it.id === args.itemId && it.to === me && it.status === "queued")
workable(5002) = {"workable":false,"reason":"gate-open:#5001(queued)}; by-id filter admits 5002 = true
workable(5003) with capabilities [] = {"workable":false,"reason":"requires:design"}; by-id admits it
```

The comment above the by-id branch claims "The status whitelist is IDENTICAL to the oldest path". It is not: the oldest path runs `selectOldestWorkable` -> `workable()`, which checks status, `requires` against the seat's advertised capabilities, and every `blockedBy` gate. The by-id path checks status and address only.

**Failure modes, each with a recovery:**
- **Silent cascade** - a seat names the id of a row whose prerequisite is still open, claims it, and does work before the prerequisite lands. Recovery: the combined-set gate validator (D265) prevents creating bad graphs, but it cannot save a claim path that never reads the gate.
- **Contradiction** - the store says the row is not workable and the verb says it is claimable. Two truths about one row. Recovery: one predicate, one verdict.
- **Loop** - a seat pointed at a held row gets a refusal that names nothing, so it retries or reports "queue empty" (this is the #5778-class misread). Recovery: the refusal names status, owner, and the remedy verb.
- **Capability drift** - a row `requires: design` is claimed by a seat that does not advertise `design`, so the `requires` field is advisory in one path and binding in the other.

**Concrete fix (one change, not two):** route both paths through the same predicate.

```
const verdict = workable(named, me, { items: queue.items, capabilities });
if (!named)  return "no such row #<id>"
if (!verdict.workable) return `NO_QUEUED_WORK - #${named.id} is ${named.status} (${verdict.reason}); <remedy>`
```

The remedy text must name the verb that can change the state: `release_work` for a held row (and who may release it: sender, recipient, or a coordinating seat), `resume_work` for a deferred row, nothing for a terminal one. A refusal that names the state but not the action is legible and still inert.

**Trade-off, said out loud:** binding the by-id path to `workable()` makes `claim_work({itemId})` refuse rows it currently admits. Option (a) - leave the bypass, fix only the message - is cheaper and keeps behaviour stable, but it leaves a documented predicate that the verb does not honour, which is the same shape as the schema rule `blockedBy-resolves` that no code implements. Option (b) - one predicate - is the reversible one: a refusal can be retried once the gate closes, a wrongly-started item cannot be un-started. **Choose (b)**, and make #6526's acceptance assert the gate case explicitly.

## What this changes for the tranche

- #6526 should carry BOTH the legibility fix and the predicate unification; they are one concern (the claim seam's admission rule), not two.
- #6529 (qa2) must assert: held, deferred, claimed-elsewhere, done, cancelled, absent id, **gated row**, **capability mismatch** - eight cases, each with the tree named.
- If the operator decides the bypass is intentional (a seat should be able to force a claim), that is a scope ruling for `lead`, and the comment in the code must be corrected either way. Not decided here.
