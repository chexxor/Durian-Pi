# The wake predicate is gate-blind: review of the #7205 / #7206 / #7207 routing

Seat: architect. Date: 2026-11-12. Item: #7208. Tree: worktree `item-7208` off `main` (pi-durable 1.3.0 from the
lockfile; the seat root resolves 1.5.1 — every verdict below is from THIS tree).

Falsifier for everything in this review: `node tools/probes/gate-blind-wake-7208.mjs` → **exit 0**, 12 checks.
Cross-checks that already pass in this tree: `node demo/parked-wake-dedup.test.mjs`,
`node demo/gate-cancel-refusal.test.mjs`, `node demo/cancel-notifies-sender.test.mjs` (all exit 0).

## The seam, drawn before discussing it

```
 store (RigQueue) ── commit ──► WakeScheduler.notify(publication)  (dirty flag)
                                     │
                                     ▼  pass
 selectWakes({seats, items, pending, busy, stopped, parkedChanged, onSkip, onParked})
     │  items = the whole queue, one read, no store access
     │  parkedSig = parkedSignature(items, seat)      src/driver.mjs:176
     │  parkedUnchanged = !parkedChanged(seat, sig)   src/scheduler.mjs:148  ← MUTATES the record here
     ▼
 wake (fixed body, WAKE_CONTENT_PARKED)  or  SKIP reason=…  → the broker log line
 separate surface: computeAttention() notices → status/checkup           src/attention.mjs:413
 separate surface: queueItemLine() DEAD-GATE marker                      src/rig.mjs:425
 gate authority: workable() (claim refusal), deadGateIds() (which ids can never close),
               parkGateIds() (which ids this row treats as a gate)       src/rig.mjs:333, src/queue-lifecycle.mjs:429
```

Three surfaces already know a gate is dead. The wake does not, because `parkedSignature`
(src/driver.mjs:76) encodes only `${id}:${status}` of the seat's own held/deferred rows.

## Findings — each is a defect, a fix, and a recovery path

**F1. The signature's gate source is the wrong helper (silent failure).**
#7205 says "derive gate state by the same `deadGateId` helper". `deadGateIds` (src/rig.mjs:333) reads
`item.blockedBy` **only**. A row parked through the structured field (`block.constraints[{kind:"queue",ref:"#100"}]`,
the M1a shape) has no `blockedBy`, and `parkGateIds` (src/queue-lifecycle.mjs:429) is the union of both.
Probe check `1-deadGateIds-blind-to-structured-gate`: `deadGateIds=[]`, `parkGateIds=[100]`, while `parkOf`
already classes the row `gated-work`. Consequence: the wake would be gate-blind for exactly the population
the queue redesign made machine-readable, and the new diagnostic would contradict `parkOf` on the same row.
**Fix:** one exported `gateState(item, items)` → `{state:"none"|"open"|"closed"|"dead", ids:[…]}`, built on
`parkGateIds`, with `deadGateIds` defined as `gateState(...).state === "dead"`. The claim refusal, the queue
line, the wake signature and the attention notice then read one definition instead of two.
**Recovery:** a probe asserting `deadGateIds(x, items) === gateState(x, items).ids.filter(dead)` — if either
surface is later widened, the pin fails rather than drifting.

**F2. `done` and `cancelled` must not share a bucket (contradiction failure).**
`derivePark`'s `gated-work` means "every gate is terminal" — done **or** cancelled (src/queue-lifecycle.mjs:439).
A wake keyed on that class would print "GATE-STRANDED" on a parked row whose gates all **finished**, i.e. tell a
seat to cancel work that is ready to run. **Fix:** three buckets only — `open` (≥1 live gate), `closed` (all
gates done), `dead` (≥1 cancelled). Probe checks 4a–4d: `queued→claimed` does not change the bucket, `claimed→done`
does, `done→cancelled` does. A parked row whose gate is done is a *release candidate*, not a strand; that is a
different message and a different verb.

**F3. The dedup consumes a change it never delivered (the bug #7205 would inherit).**
`parkedUnchanged` is computed at src/driver.mjs:176, before the pending/busy guards at 189–195. `parkedChanged`
(src/scheduler.mjs:148) records the new signature on the call, so a seat whose run is in flight when its gate is
cancelled has the strand signature recorded and the wake suppressed. Every later pass reads "unchanged" and skips
with `parked-deduped`. Probe checks 3a/3b: pass 1 (seat pending) issues 0 wakes yet
`scheduler.parkedSignatureOf("impl") === "101:held"`; pass 2 (seat free) skips with `parked-deduped`. The gate
death is never reported, and the log reads as "nothing here".
This is the same ordering the escalation path already rules on (src/driver.mjs:205-207, "The wake is about to ISSUE, so this is where the escalation set is marked as told").
**Fix:** compute `parkedSig`, use it only for the skip reason, and call `parkedChanged(name, parkedSig)` at the
point the wake is issued. One line, reversible, mirrors an existing ruling.
**Recovery:** probe 3 re-run with the fix must show pass 2 issuing a wake. That is the acceptance test for #7205 —
without it the gate-state field buys nothing, because a death that lands during a run is exactly the common case.

**F4. The diagnostic cannot travel in the wake body (context failure).**
`WAKE_CONTENT_PARKED` is a constant string, deliberately, to protect the prompt cache (ROADMAP 33), and probe
check 5 confirms no interpolation. Interpolating `item=<id> gate=<id>` into the wake text zeroes the cache on
every stranded wake and puts ids in the prompt that are stale by the time the seat reads them.
**Fix:** a second constant body, `WAKE_CONTENT_STRANDED`, selected by a boolean; ids go to the queue line
(extend `queueItemLine`'s DEAD-GATE marker to held rows — same blind spot as F1) and to `computeAttention`.
pm's routing decision (#7207: surface through checkup/status, not the broker log) is right for this reason.

**F5. Fan-out is bounded, but only by the dedup (cascade failure).**
Once the signature includes gate state, seat A's signature depends on rows addressed to seat B. One cancel of a
gate with dependents across M seats changes M signatures in one pass. Bound: at most one wake per seat per pass
(dedup) and per-seat cooldown (`seatReady`, src/scheduler.mjs:159), so fan-out ≤ number of seats, not number of
rows. **Fix:** keep the bucket coarse (F2) so a gate's progress does not re-trigger, and log
`PARKED-WAKE seat=… reason=gate-died` so the fan-out is observable rather than inferred.

**F6. The diagnostic has no exit it can name (partial failure).**
`release_work` refuses when the gate names a cancelled row (src/rig.mjs:1478), `revise_work` touches only QUEUED
rows (src/rig.mjs:1595), and `grep -rn "regate|gate-repair|repairGate" src/` finds nothing in this tree. Today
the only verb for a held stranded row is `cancel_work`. A message that says "your gate is dead" and offers only
deletion will delete parked work that is legitimate but mis-gated.
**Fix (routing, not my scope):** either a gate-only revise for held rows, or a repair verb that replaces the dead
gate id with the live/umbrella id. Until one exists, the diagnostic must name the exit it actually offers:
"release is refused; cancel, or ask pm to re-gate". `docs/runbooks/stale-held-backlog.md` is the procedure pm
already follows; the wake text should point at it.

## Options considered, and the trade-off I accept

**Option A (recommended): make the wake signature carry a coarse gate bucket, fix the dedup ordering, and put the
detail on the read surfaces.** Cost: the signature format changes, so `demo/parked-wake-dedup.test.mjs:55` (which
pins `"1:held"` byte-for-byte) must be updated, and one more pure function is added to the gate authority.
Gain: the wake fires exactly when a parked row's gate dies, once, with no store reads.

**Option B: notify dependents at cancel time (write-path notice).** Cost: N notice rows per cancelled umbrella
(ROADMAP 39 bounds the chain, but the queue gains volume for a fact already on the row), and the notice is a
wake for a seat with no verb to act on it. Rejected as the primary mechanism: a fact is better read from the row
than copied into a notice, and F6 shows the seat cannot act on it anyway. Kept as a fallback if the read side
proves insufficient in practice.

**Option C: a periodic store-scan tick.** Rejected — D272 already rules it out (the snapshot is session-cached,
so a store-derived trigger polls a stale document, and a raw read is a second reader; that is the cadence that
hot-looped the broker in #2237).

## Invariants the implementation must not break

1. `selectWakes` stays pure — no store, no clock (the #5740 option-A ruling).
2. The wake body stays a constant; a boolean selects which constant.
3. `parkedChanged` is consulted at the push, never before the pending/busy guards.
4. One definition of "gate" (`parkGateIds`) and one of "dead gate" (`gateState`, with `deadGateIds` as its alias) —
   the three existing surfaces may not each carry their own.
5. The signature never serialises a hop path, a timestamp, or the full status of every gate row.

## What this item changes in the routing

- #7205 needs F1, F2 and F3 written into its spec before it starts; as written it would inherit the dedup bug and
  read the wrong gate field.
- #7206 is answered by measurement, not code: `cancelItem` (src/rig.mjs:213–240) notifies the other party only;
  `demo/cancel-notifies-sender.test.mjs` pins exactly that (exit 0). Recommend closing it with Option B rejected
  and the attention notice widened instead.
- #7207 must not put ids in the wake body (F4) and must name the exit (F6).
