# Gate workability: depth-1 verdicts, transitive stranding (#6999)

Reviewed by architect, 2026-11-12. Trigger: lead's design question in #6999 — "is workability
transitive? #5953/#5954 show a *live* gate that is itself unworkable." Prerequisite flagged for
#6530 (the gate-edit verb) and #6659 (severity from measurement).

## 1. The topology, drawn

```
                 claim_work(no id)  ── selectOldestWorkable ──┐
                 driver wake        ── workable ──────────────┤  ONE predicate (ratified #2673/#2677)
                 release refusal    ── deadGateId ────────────┘
                 claim_work(itemId) ── (nothing) ────────────  NO predicate  ← the seam
```

Contract of `workable(item, seat, {items, capabilities})` — src/rig.mjs:320-335:
- **receives** a row, the seat, and the whole queue doc (read seam: `queue.items`, the full store, not the seat's slice — src/broker.mjs:1289, 1392);
- **produces** `{workable, reason}` where reason is a legible skip code;
- **is NOT responsible for** explaining *why* the gate is open, nor for whether the gate can ever close.

The walk is depth-1 by construction: for each id in `blockedBy`, look at the target's `status` and stop
(src/rig.mjs:329-334). `deadGateId` (src/rig.mjs:312-317) is the same depth-1 rule, shared so the
release refusal and the claim predicate cannot drift (#6112).

## 2. The answer to the question asked

**Claimability is already transitively closed on status, and must stay depth-1.**
Every hop that is not `done` fails at depth 1 — queued, held, deferred, claimed, cancelled, all fail.
So recursion adds no new claimability information. The tempting "transitive" rule — *a hop that is
queued but itself satisfiable counts as satisfied* — is not a refinement, it is a weakening: it would
let a seat claim work whose prerequisite has not happened. Reject it.

But the lead's finding is real, and points at two things the predicate does **not** do:

1. **It names the wrong hop.** #5953's gate #5947 is `deferred`, and #5947 is gated on the *cancelled*
   #5945. The verdict reads `gate-open:#5947(deferred)`. The blocker is #5945; nothing in the verdict
   says so. A coordinator who releases #5947 has fixed nothing.
2. **It cannot say "never".** "Open now" and "can never close" are different facts, and the current
   predicate conflates them. That distinction is exactly the number #6659 wants.

And there is a third, harder defect the probe found, which is the reason the shallow definition
actually bites in practice: **the by-id claim path never consults the predicate at all.**
src/rig.mjs:855-858 admits any row matching `to === me && status === "queued"`. The gate is advisory
there. Measured below.

## 3. Measurement (both probes run on branch `item-6999`, pi-durable **1.3.0** from this worktree's
lockfile — not the seat root's 1.5.1; name the tree before comparing verdicts)

```
node tools/probes/workability-transitivity-6999.mjs   → exit 1  (3 assertions fail, listed)
node tools/probes/nested-gate-census-6999.mjs        → exit 0  (census of the live store)
node demo/workable-claim.test.mjs                   → exit 0  (the ratified semantics still hold)
```

Probe A, fixture `#1 done, #2 cancelled, #3 gated on #1, #4 gated on #2, #5 gated on #4, #6↔#7 cycle`:

| assertion | got | expected |
|---|---|---|
| `#3` gated on a done row is workable | `true` | `true` (PASS — the control) |
| `#5`'s reason names the dead hop `#2` | `gate-open:#4(queued)` | `gate-cancelled:#2` |
| a cycle `#6→#7→#6` is reported as a cycle | `gate-open:#7(queued)`, 0 ms | a cycle code |
| `claim_work(itemId=5)` refuses an unworkable row | `status: claimed` | `status: queued` |

Probe B, live store (`node cli.mjs queue --json --no-body`, 7101 rows):
- 405 rows carry a gate; **61** have a hop that is directly cancelled; **155** are open at depth 1;
- **15** of those 155 are permanently uncloseable — 9 because a hop further down the chain is
  cancelled, 6 because the chain is a cycle. Examples: `#5953 gate-open:#5947(deferred) → #5945 cancelled`,
  `#6405 → #6399 cycle`, `#5486 → #5482 cycle`.
- Zero chains exceeded the depth cap (8).

So the class the lead asked about is not two rows; it is 15 today, and it grows with every
`cancel_work`.

## 4. Failure modes at the seam, each with its recovery path

| # | failure | observed | recovery | falsifier |
|---|---|---|---|---|
| 1 | **silent** — a dead hop buried at depth 2 reads as an ordinary wait | `gate-open:#5947(deferred)` on #5953 | the verdict returns the failing hop and the path: `{workable, reason, hop, chain}` | probe A assertion 2 |
| 2 | **cascade** — cancelling a row strands its transitive dependents forever, with no signal | 15 rows stranded today | `cancel_work` reports the transitively stranded dependents (report only, never decide, per #3575) | census probe: stranded count must match the reported list |
| 3 | **loop** — a cycle never converges | depth-1 terminates in 0 ms, so the cycle is invisible, not stuck; a transitive walk would recurse | `visited` set + `MAX_DEPTH`; emit `gate-cycle:#<id>` and let the seat defer | probe A assertion 3 |
| 4 | **contradiction** — three readers disagree about the same row | wake (`driver.mjs:130-137`) says unworkable; `heldgate.mjs:105-107` calls the row `release-candidate` because `TERMINAL_STATUSES` counts `cancelled` as closed; by-id claim claims it anyway | one walk, one vocabulary: `deadGateId`, the release refusal, the audit class and both claim paths call the same function | probe A assertion 4 + a heldgate class assertion |
| 5 | **hard** — the walk is expensive | `items.find` is O(n) per hop, called per row per wake over 7101 rows | build an `id → item` Map once per call site; the walk is bounded by depth, not by store size | time the wake scan before/after; assert bounded ms |
| 6 | **partial** — the depth cap truncates the answer | 0 chains hit it today | the cap is *reported*, not swallowed: `chain-depth-exceeded` is a legible reason, and the row stays unworkable because it already failed at depth 1 | probe A fixture with a 10-deep chain |
| 7 | **ambiguous** — a hop ids a row that does not exist | silently skipped (`rig.mjs:329`, the ratified conservative default) | keep the default, but say it: `gate-unknown:#<id>` in the reason | probe A control with a dangling id |

## 5. Options considered

- **(A) Make `workable` recursive.** Cheapest to state. Rejected: it weakens the claim gate (a
  satisfiable-but-not-done hop would pass), and it re-walks the graph on every wake. Not reversible
  in effect — it changes what "blocked" means for every seat.
- **(B) Materialize a `stranded`/`gateClosed` field at mint time.** Fast reads. Rejected: the
  verdict goes stale the moment any hop changes status — that is precisely the drift qa measured in
  #6853 ("the class-B examples are now stale"). It also needs a write path and an invalidation fan-out
  proportional to the number of dependents, which D53 forbids inventing without a ruling.
- **(C) Chosen: keep claimability depth-1; add ONE bounded, cycle-guarded graph walk used by every
  reader; report the hop and the chain; report stranding separately from claimability.** No schema,
  no write path, no new state. Reversible: delete the walk and the old semantics return exactly.
- **(D) Hand-fix the 15 rows.** Cheap, but the shape recurs with every cancel; it treats the symptom,
  not the missing predicate.

**Trade-off accepted:** bounded CPU per wake in exchange for a verdict that cannot go stale, and a
report that names the hop a coordinator must actually clear.

## 6. The concrete changes, in order

1. `src/rig.mjs:855-858` — the by-id claim consults `workable(named, me, {items: queue.items, capabilities})`
   and refuses with the same legible reason the skip line already uses (src/rig.mjs:983). This is the
   one change that closes a hole where a gate is merely decorative.
2. `src/rig.mjs:312-317` — `deadGateId` becomes `firstDeadHop(item, items, {map})`: transitive, visited
   set, `MAX_DEPTH = 8`, returns `{hop, path}` so the release refusal and the audit class see the same fact.
3. `src/rig.mjs:320-335` — `workable` returns `{workable, reason, hop, chain}`; the string reason keeps
   its shape so existing demos do not break.
4. `src/heldgate.mjs:105-107, 134-135` — a cancelled hop must not silently count as "closed": add the
   class or evidence line `hop #<id> cancelled — releasing does not make this claimable`.
5. Call sites (src/driver.mjs:130-137, src/rig.mjs:881) build the Map once.
6. `demo/gate-transitivity.test.mjs` — the falsifier the lead asked for: gate done → workable; gate
   queued-but-blocked-on-cancelled → unworkable **and names the deep hop**; a cycle reports itself in
   bounded time; by-id claim of an unworkable row is refused. Reverting the walk makes assertion 2 and
   4 fail, which is what makes the test detect the absence of the fix.

## 7. What is NOT decided here

Whether #5953/#5954/#5948 should be cancelled or re-gated is a scope call for `lead`; whether the
by-id claim change ships before or after #6530 is a sequencing call for `pm`. This review only fixes
the predicate contract.
