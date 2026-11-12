# Priority and park are two leases on the row; the authority rule is where they differ (#7026)

Architect seam design, 2026-11-12. pm's question: where does priority live so that claim selection
honours it without touching the legacy backlog, and is `hold` delegable to a coordinating seat.
Tree: branch `item-7026`, pi-durable **1.3.0** from this worktree's lockfile (seat root resolves 1.5.1).
I do not design the verb; I design the property and the authority rule. Lead's #7025 decides whether
priority is a row field or a seat lease — this document bounds what either answer implies.

## 1. The topology, as it actually exists

```
policy (config)      seat workStrategy > team > default   → resolveStrategy()      src/workstrategy.mjs:116
data (the row)       item.priority + item.prioritySet{at,by,reason,expiresAt,authority}
                                                     ↓
claim selection      selectNextWork(items, seat, {strategy})  → orderCandidates → effectivePriority(row, now)
                     src/rig.mjs:366, src/workstrategy.mjs:145
park                 item.status = "held"; item.park = parkRecord(queue, item)
                     src/rig.mjs:531 → {class, basis, gateIds, recordedAt}
authority            parties: item.from, item.to
                     coordinator: seatIsCoordinator(seat) = declares no working capability  src/seattools.mjs:292
```

Two facts follow from reading it rather than describing it:

- **Priority is already a row property, not a queue property.** The *policy* (which strategy) is
  configuration; the *priority* is data on the row; the resolution happens at read. The legacy
  population is untouched because an absent field ranks neutral (`NEUTRAL_PRIORITY = "next"`,
  src/workstrategy.mjs:54), and `priority_first` on an unprioritised backlog orders exactly like
  `oldest_first`. The production claim path calls `selectNextWork` with the resolved strategy
  (src/rig.mjs:936); the `selectOldestWorkable` alias (src/rig.mjs:386) is used only by six demos, so
  there is no second owner of the ordering. The seam must not grow a queue-level ordering doc or a
  per-seat priority table: both would be a second source of the same fact.
- **The park is NOT a lease.** `parkRecord` writes `{class, basis, gateIds, recordedAt}` — no author,
  no resolver, no expiry, no review date. Measured in this run: `hold_work` on a clean row produces
  `{"class":"unattributed","basis":"nothing recorded…","gateIds":[],"recordedAt":"2026-11-12T09:33:28Z"}`.
  The author exists only in `transitions`; nothing can filter on it as a field.

## 2. The asymmetry, measured

`node tools/probes/park-authority-asymmetry-7026.mjs` → **exit 1**:

| step | result |
|---|---|
| `pm` (coordinator) `hold_work(#1)` | refused — #1 stayed `queued [queued:pm]` (the `item.to !== me` guard in `hold_work`, src/rig.mjs:1337 in this tree) |
| `impl` `hold_work(#1)` | `held [queued:pm,held:impl]`; `workable(#1)` → `{workable:false, reason:"not-queued:held"}` |
| selection while held | returns **#2**; the held row is not in the skip list at all |
| `pm` `release_work(#1, reason)` | allowed — `queued [ …,held:impl,released:pm]`; selection returns **#1** again |
| `pm` `set_priority(#3, "now", reason, expiresAt)` | allowed (`authority: "sender"`), and `priority_first` selects **#3** |

So the coordinator can already **order** a row it cannot **park**: `set_priority` is delegable to a
coordinating seat (src/rig.mjs:1488) with a mandatory reason and a mandatory expiry capped at 30 days
(`MAX_PRIORITY_LEASE_MS`); `hold_work` is not delegable at all. That is the deadlock pm names, and it
is real in the store: `node cli.mjs queue --json --no-body` at snapshot 2026-11-12T09:3xZ, 7168 rows —
**428 held**, median age since last transition **532.8 h** (~22 days), max 640.4 h; only **13** carry a
structured park record, **163** carry an authored block, and **135** carry a `reviewBy` — **77** of them still in the future, **58** already past. A mechanism with no author, no expiry and 428 instances is not bounded.

## 3. The property design

**Priority** (already right; keep, and pin it):
`{value ∈ {now,next,later}, lease: {by, reason, expiresAt ≤ now+30d}}`, resolved at read into
`{priority, rank, raw, lapsed, invalid}` (src/workstrategy.mjs:148). Three invariants, each falsifiable:
1. rank is never stored as an absolute — it is computed at read;
2. a lease lapses at read (no daemon, no sweep);
3. unknown is not a value. `raw === null` must read as **UNKNOWN** in every metric. Today the rank
   equals `next` — which is exactly today's behaviour, and must stay. The risk is a future severity
   readout printing "medium" for a row nobody ever ranked. Concrete fix: `effectivePriority` returns
   `unknown: raw === null` so a caller cannot confuse "nobody decided" with "someone decided neutral".
   The rendered line already distinguishes them: an absent priority prints nothing (src/rig.mjs:403).

**Park** (the thing to change): a park is a lease with an owner and a horizon:
```
park = {class, basis, gateIds, recordedAt,
        by,            // who parked it — absent today
        resolver,      // who or what clears it — lives in `block`, not in `park`
        reviewBy,      // when to look again
        expiresAt,     // the horizon of the park itself
        delegated}     // true when the parker is not a party
```
Authority rule, per D261's per-field principle:
- **intent fields** (subject/body/tier): the two parties;
- **gates**: whoever mints them;
- **a park**: the parties always; a coordinating seat **only** when all four bounds are present —
  mandatory `reason`, mandatory `resolver`, mandatory `reviewBy`, and the row is `queued` (never
  `claimed`: a coordinator must not interrupt work in flight);
- **release**: delegable today, and it should stay delegable — it restores a state rather than
  restricting one, and 428 parked rows need an un-park path that a coordinator can operate.

**Bounds on the delegated park, each one checkable:**
- a per-seat cap on *active delegated parks* (refuse with the count, not with prose);
- `expiresAt` capped the same way priority is (30 days), so a park cannot outlive the tranche it was
  meant to protect;
- the parked ids are named in the row body and in `park.gateIds`, so the reason is machine-readable.

**What expiry does NOT mean.** Do not auto-revert a held row to queued at read when `expiresAt` passes.
That is a state change with no author — the "accepted and ignored" class this repo keeps paying for.
The expiry makes staleness *countable*: `check`/`heldgate` report `stale-park` rows, the wake bound
(#5927) stops a parked row from waking forever, and an actual release is an authored verb. The
difference is falsifiable: a lapsed priority changes order with no write (safe: order is not a claim);
a lapsed park must not change claimability without a write.

## 4. Failure modes, each with a recovery path

| failure | mechanism | recovery | probe that shows it |
|---|---|---|---|
| deadlock | coordinator sees the whole queue, cannot park; parties park only what they can reach | delegated park under the four bounds | probe exit 1 (section A vs C) |
| unbounded state | 428 parks, median 532.8 h, no expiry field | mandatory `reviewBy`/`expiresAt`; audit counts them | `node cli.mjs queue --json --no-body` + the counts above |
| unattributed | `parkRecord` writes no author | add `by` and `delegated` | probe section B prints the record |
| contradiction | release is delegable, hold is not, on the same row | one authority table for park/release/lease | probe sections A and C on the same id |
| silent reorder | priority set while the recipient's strategy ignores it | `set_priority` already returns which strategy is in force (src/rig.mjs:1520-1522) — keep that honesty check | `demo/workstrategy-claim.test.mjs` |
| loop | parked rows wake a seat forever | wake predicate filters on `workable`; the parked-signature bound (#5927) | `workable` returns `not-queued:held` (probe B) |
| cascade | a delegated park on a row whose gate is dead strands it permanently | release refuses when the gate names a cancelled row (D283: void is a chain property) | `gate-graph-classification-7012.mjs` |
| context | "why is my queue in this order?" unanswerable | the ORDER line (src/rig.mjs:1051) names strategy and source | probe D prints the selection |

## 5. Options and the trade-off I accept

- **(a) Keep `hold` party-only and give the coordinator the lease only.** Cheapest; already built.
  Rejected as the whole answer: a lease changes order, not eligibility — a `later` row is still
  claimable once nothing else is workable, so it cannot express "do not start this".
- **(b) Chosen: delegate the park under mandatory bounds** (reason, resolver, reviewBy, expiry, cap,
  queued-only). Cost: a coordinator gains power over another seat's queue; the mitigation is that every
  bound is a field a refusal can check and an audit can count.
- **(c) Remove release's delegation to make the two symmetric.** Rejected: it repairs the symmetry by
  making 428 parked rows un-releasable by anyone but the party — strictly worse for the drain problem.

Trade-off stated plainly: bounded delegation buys a lever for the seat that can see the whole queue,
at the price of a new authority surface; unbounded delegation would be indistinguishable from the
428-row park population we already have.

## 6. The falsifier

`tools/probes/park-authority-asymmetry-7026.mjs` (exit **1** today). It demonstrates, with exit code,
that: (a) a coordinating seat cannot park another seat's row; (b) a parked row is unclaimable by
oldest-first (`workable` → `not-queued:held`) and selection returns the next row; (c) release restores
it to claimable; (d) the coordinator's lease reorders under `priority_first`; (e) a lapsed lease ranks
identically to an unknown one while the record differs.

It turns **GREEN** when a delegated park is accepted *and* the acceptance test also proves the bounds:
a park without `reason`/`resolver`/`reviewBy` is refused; a delegated park on a `claimed` row is
refused; the cap is reached and refused with the count. Those four assertions are the demo I would
require of the build.

## 7. Not decided here

- Whether priority is a row field or a seat lease: **lead**, #7025. This design survives either: a seat
  lease changes *who orders*, a row field changes *what order results*; both are read by the same
  `effectivePriority`.
- The verb's shape and the build sequencing: **pm**.
- Whether any of the 428 existing parks should be released: scope, **lead**.
