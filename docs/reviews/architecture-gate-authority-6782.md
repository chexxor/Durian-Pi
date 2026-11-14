# Review: amending D261 so a gate can be repaired (#6782, lead's ruling on #6776)

**Question lead put to me.** My #6638 predicate assumes a post-mint gate verb that D261 forbids. Either amend D261 or make recovery terminal. Lead ruled (b), amend. I reviewed the amendment against the store rather than the argument.

**Run.** `node tools/probes/gate-authority-census-6782.mjs <dump>` → exit 1, two gaps. The dump comes from the sanctioned read seam, not a second opener:
`DURIG_DB=selfdev.sqlite node cli.mjs queue --no-body > queue-dump.json`. Supporting instruments, all run at HEAD `35001c3a`: `node tools/probes/gate-write-surface.mjs` (exit 0), `node tools/probes/gate-reference-validation.mjs` (exit 0).

## What the store actually contains

| measured | number |
|---|---|
| rows | 6,876 (4,624 done, 924 cancelled, 430 held, 524 deferred, 367 queued, 7 claimed) |
| rows with a structured gate | 378 |
| gated on a **cancelled** row (dead gate, no repair verb exists) | **63** |
| gated on a row that is **held or deferred** (live, but no seat can complete it) | **95** |
| gated on a nonexistent id | 0 |
| self-gated or in a two-row cycle | 0 |
| rows carrying a `gated`/`ungated` event | **0** |
| held rows with no authored block | 267 of 430 |
| held rows where `legacyBlock` invents resolver "pm" and pm is not a party | 25 |

`src/queue-lifecycle.mjs:256` literally reads `resolver: claimed ? item.to : "pm"`, and `effectiveBlock()` (`:320`) falls back to it when nothing is authored. Lead's point 1 is correct and it is not a style preference: standing derived from that field is standing the record cannot show.

## The amendment is right, and it has one hole that makes it inert

Lead's bound: authority to edit belongs to the row being edited (`from`, `to`, authored resolver); added ids must be resolvable (live or done), never terminal-cancelled, never the row itself; a party may clear a terminal-cancelled id; removing a **live** id with no recorded add is **refused**.

The hole is the interaction of the last clause with the number in the table: **zero** rows carry a gated/ungated event. So on every existing gate, removal of a live id is refused. The verb ships, and on the current corpus it can only clear cancelled gates — 63 rows. The other 95 are gated on rows that are held or deferred, which no seat can complete; those stay stranded, and the only remaining lever is `cancel_work` on the dependent. That is exactly the terminal recovery lead rejected, re-entering through the exception.

**Fix, stated as a rule the probe can check.** A party may remove a gate id when one of two conditions holds, and the refusal names which one failed:
1. the target is terminal-cancelled — a broken pointer;
2. the target is parked **and** carries no authored block — there is no contract to loosen, because none was recorded, and the park is past its `reviewBy` (or has none, which is itself the finding).

Removal of a live, authored gate stays a scope ruling for lead. Every removal writes `{event: "ungated", by, id, reason, at}` on the row and notifies the author, the way cancellation does. We do not need the *add* event to make the *removal* auditable; refusing removal because the add is unrecorded protects an authorship we cannot prove and strands the row.

## Failure modes at this seam, each with its recovery

| mode | what happens | recovery |
|---|---|---|
| cascade | cancelling a gate row strands 63 dependents with no exit | dead-gate removal by a party, recorded, notified |
| silent drop | a gate written as prose is invisible to `workable()` (274 rows in the mirror carry gate words and no field) | `workable()` reads only status/requires/blockedBy — pinned by `gate-write-surface.mjs`; mint validation rejects prose ids |
| contradiction | `effectiveBlock()` infers a resolver the record does not contain | standing predicate reads `item.block` only; the probe asserts the inference line is gone |
| loop | self-gates and cycles are accepted at mint and read as ordinary waiting (`gate-reference-validation.mjs`, exit 0) | reject self-reference and cycles at the add path, not only at mint |
| invisible | `checkup.mjs` has **0** rules reading `blockedBy` (measured) | rules for `gate-dangling`, `gate-cancelled`, `gate-cycle`, `gate-stalled` with age |
| wake blindness | a parked row's wake signature is `id:status` only, so a stranded gate never wakes anyone (#6817) | wake selection uses the same `workable` verdict as claim |
| authority drift | a coordinator's standing derived from capability absence | standing comes from `from`, `to`, authored resolver; the probe checks the pm-inference line is gone |

## The decision, in one sentence

Mint stays the default; the edit verb is the recovery path; **a recovery path that cannot be used on 95 of the 158 stuck gates is not a recovery path**, so the removal leg must cover parked-with-no-authored-block targets, not only cancelled ones.

## Falsifier

`tools/probes/gate-authority-census-6782.mjs` reports RED now, and goes GREEN only when:
- a `gate_work` verb exists in `src/rig.mjs`;
- the rig writes an `ungated` event;
- `legacyBlock` no longer invents `resolver: "pm"`.

It also prints the class counts (63 dead-gate rows, 95 parked-gate rows), so the acceptance is "zero rows gated on a target that can never resolve", not "the verb exists".

**Not mine to decide:** sequencing of the verb relative to the mint-time validator (#6512) — that is lead's scope call. The constraint I hold: the validator and the removal leg land together, otherwise the verb can add gates that mint would have refused.
