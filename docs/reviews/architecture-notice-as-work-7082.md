# A protocol ack is minted as a claimable row, so seats spend turns on ceremony (#7082)

Architect review, 2026-11-12. Item #7082 was cancelled by pm as superseded (#7080, #7081 carry the
specifics), but claiming it surfaced a seam I own: the ack row I claimed was itself the work.

Tree: branch `item-7082`; `@earendil-works/pi-durable` **1.3.0** from this worktree's lockfile (the seat
root resolves 1.5.1 - a run here is not comparable with a run there). Host: Linux, kernel
`7.2.15-300.fc45.x86_64`, Fedora 45, node v24.22.1.

Instruments, with exit codes:
- `node tools/probes/notice-as-work-7082.mjs` → **exit 1**
- `node demo/notices.test.mjs` → **exit 0** (the pin quoted below is the ratified contract)

## The topology

```
complete_work / cancel_work
   └─ enqueueItem(..., notice: true) → a NEW row addressed to the other party, status "queued"
wake predicate   src/driver.mjs:135-137  → queuedVerdicts.some(workable)
claim predicate  src/rig.mjs:326-341     → status === "queued" && gate satisfied; `notice` is never read
```

The store already knows an ack is not work: `notice: true` is set at enqueue (the ack is minted by
`enqueueItem(..., notice: true)` at src/rig.mjs:224-232 and stored at src/rig.mjs:499) and
`complete_work` suppresses an ack-of-an-ack so the loop terminates (demo/notices.test.mjs:10-11, :131).
But no predicate anywhere consults the flag.

## Measured

Probe (two rows, one ack minted before one real task, seat `impl`):
- the ack: `notice=true status=queued`; `workable(ack, "impl")` → **`{workable: true, reason: null}`**;
- `selectNextWork` for impl picks **the ack** (#1) ahead of the real task (#2) because it is older;
- live store (7221 rows): **2671 notice rows**, **135 still `queued`**, and the per-seat split -
  `pm: 44 work / 66 acks`, `impl: 214/39`, `devtools: 94/15`, `architect: 1/7`. Two-thirds of pm's
  claimable queue is acknowledgements. By status: 2217 done, 173 cancelled, 136 deferred, 8 held,
  135 queued, 2 claimed - i.e. **2217 claims and completions were spent on rows that carried no work**.

## Failure modes, each with a recovery path

| failure | mechanism | recovery |
|---|---|---|
| loop | every completion mints a row; the loop is only broken at the second level (an ack of an ack is suppressed) | terminal at mint: an ack has nothing to do |
| silent | `queued: 546` and any drain-rate metric count 135 acks as open work; throughput counts ack claims | define "open" as workable-and-not-a-notice, or make acks terminal |
| cascade | an old ack sits ahead of new work in an oldest-first queue, so a seat claims ceremony before the task | rank acks below work in `orderCandidates` (src/workstrategy.mjs:145) |
| contradiction | `docs/WORK-ITEM-SCHEMA.md` R6 says a notice must never be answered with another notice - the rig knows acks are not work, then treats them as work | one rule in one place; the predicate reads the flag it already sets |
| context | a seat's queue view is dominated by acks, so "what is left to do" is unreadable | the queue line already distinguishes; make the count honest |

## Options and the trade-off

**A. Don't mint ack rows at all** - record the ack as a transition on the completed row and show it in
the recipient's queue view derived from the chain. Cheapest in row count; rejected: it removes the
recipient's durable record of *why* the other party stopped, which is the whole point of the notice.

**B. Chosen: mint the ack terminal.** `notice: true` rows are created `done`, with a `notified`
transition. An ack records an event that already happened; there is no action left to take. It is
unclaimable (claim requires `queued`, src/rig.mjs:899), never wakes, and never counts as open.
**Cost, stated plainly:** this contradicts a ratified pin - `demo/notices.test.mjs:125`, "pm can claim
its own DONE notice". That pin encodes ceremony, not a guarantee a user depends on, but changing it is
**lead's scope call**, not mine. A one-time reconciliation of the 135 open acks is also needed; that is
scope too.

**C. Reversible interim, no pin change:** keep acks claimable but (i) rank them behind real work in
`orderCandidates`, and (ii) make the wake predicate ignore a queue that contains only acks
(`workable` → `notice-not-work` for the *selection* path, while claim-by-id still honours the demo pin).
Cost: acks stay `queued` forever, so "open" must be redefined as *workable and not a notice*, otherwise
the metric still lies. I would take C only if B is refused.

I prefer B: it is the smaller invariant ("a notice is a record, not a task") and it removes the failure
class instead of ranking around it. Both are reversible; B is the one that stops the ceremony.

## The falsifier

`tools/probes/notice-as-work-7082.mjs` exits **1** today. It goes **0** only when:
1. `workable(ack, seat)` is false with reason `notice-not-work` (or the ack is never `queued`);
2. with an ack and a real task queued, selection returns the real task;
3. the census reports **0** acks in `queued`/`claimed` status.
The probe prints the live per-seat split, so the number it asserts is the number the acceptance claims.

## Not decided here

Whether acks are minted terminal (B) or merely de-ranked (C) - **lead** rules scope; **pm** sequences the
row; the build is `devtools`'s. I did not touch the queue or the broker.
