# Checkpoint policy per rig doc — the ruling for ROADMAP 355 A (queue item #6171)

**Seat:** architect. **Date:** 2026-11-10. **Scope:** the six `defineDoc` calls in `src/rig.mjs` and
`extensions/continuity.mjs`. This row is a ruling; `impl` implements it under its own row.

**Measurements are in this tree, and they name the tree and the dependency set.**
Probe: `docs/evidence/2026-11-10-checkpoint-policy/probe.mjs`, outputs in
`measurements.txt` (5,000 items / 3,000 verbs), `measurements-10k.txt` (5,000 items / 10,000 verbs),
`measurements-small.txt` (12 items / 200 verbs). Dependency: `@earendil-works/pi-durable` **1.3.0** as
resolved by `package.json` + `package-lock.json` in this worktree (`node -e 'console.log(require("./node_modules/@earendil-works/pi-durable/package.json").version)'` → `1.3.0`, exit 0). Branch `item-6171`.
The live store's size delta (the baseline `617,492,480 bytes` named in ROADMAP 355) is **not** measured
here: opening the live store from a second handle is exactly what the read-seam rule forbids, so that
number belongs to the `impl` row.

## 1. What the predicate actually does (read in the shipped dependency, not inferred)

- `dist/session/transaction.js:596-599` (1.3.0): `const info = { deltasSinceBase: change.loaded.deltasSinceBase }; if (change.definition?.checkpointWhen?.(prepared.value, prepared.ops, info)) plan.content = { ...content, content: { version, kind: "base", value: prepared.value } };`
  — the predicate sees the **candidate (new) value**, the **ops** of this change, and the **chain length before this change**. Returning `true` makes this change a full base instead of a delta.
- `dist/storage/sqlite/storage.js:426-450`: reading a doc is one SELECT for the nearest base, one SELECT for the tail, then `apply()` per revision — so **read cost is linear in deltas since the last base**, and it returns `deltasSinceBase`.
- `dist/storage/sqlite/storage.js:652,655` and `dist/storage/memory.js:710-712`: for a **current-only** record (`scope.kind !== "conversation"`, i.e. every rig session doc), writing a base **deletes the prior revisions**. A checkpoint on a session doc is a DELETE + INSERT, not an append. For conversation-scoped docs (`durig.notes`, `history: "rewindable"`, `fork: "asOf"`), revisions are retained, so a base is an ADD.
- At the pin the predicate is optional-chained — absent means "never checkpoint", silently. At `v1.5.1` it is called unconditionally (`docs/reviews/pi-1.5.1-delta-review-2026-11-10.md:104`, `session/transaction.ts:1058`), which is why 3 demos failed with `change.definition.checkpointWhen is not a function` at the moved pin. **A doc with no predicate is a latent throw, not a no-op.**

Upstream's own policy (read from the shipped package's source maps):
`ProviderDoc` and `UsageDoc` → `() => true` (tiny docs); `InboxDoc` → `(value) => value.items.length === 0`
(checkpoint at the semantically settled state); `LiveDoc` → a semantic predicate ("nothing is running") with
the explicit comment *"Do not add a delta-count bound; the tool output benchmark checks this rule"*. So
upstream distinguishes **small docs (always checkpoint)** from **hot docs (checkpoint at a settled moment)**.

## 2. The premise in the intake, tested

The intake says: key the predicate on "the transitions a reader ACTS ON — claim, complete, defer, hold, release".
For `RigQueue` that set is **every mutation the doc ever receives**. Applied literally it is `() => true`, and
that is measurably the worst policy: 10,000 verbs on a 5,000-row queue cost **30,703 ms** versus **608 ms**
with no checkpoints — a 50× write-time cost, because every verb serialises a ~2 MB value.

So the correct key for a big, hot doc is not the verb class. It is **cadence plus a hard bound**: checkpoint when
the chain has grown enough that replaying it costs more than writing the base. The verb-class idea is still
right for the docs where the transitions are rare and the value is small.

## 3. The ruling, per doc

| Doc | Scope / size | Who reads it, and how often | Predicate | Why |
|---|---|---|---|---|
| `RigQueue` (`src/rig.mjs:110`) | session singleton, 5,077 rows, ~2.0 MB value | `watch` polls a read every ~750 ms (`src/broker.mjs:214,1799`); two snapshots per broker pass (`src/broker.mjs:1258,1339`); every CLI/seat queue read | `info.deltasSinceBase >= 200` | Cadence, not verb class. Measured at 10,000 verbs: read 5.38 ms vs 12.29 ms never-checkpointed, at the cost of 21 base writes (+148 ms total). Bound 50 costs 1,101 ms for the same read (5.16 ms) — 46% more write time for no measured gain. |
| `Seats` (`src/rig.mjs:25`) | session singleton, 12 entries | wake selection, capability gate on every `send_work`, claim checks | `() => true` | Transitions are rare and are exactly the ones a reader acts on; the value is tiny. Small-doc probe: 200 writes cost 36.6 ms with a base each time vs 42.3 ms with none. |
| `Edges` (`src/rig.mjs:37`) | session singleton, a list of links | the send gate on every `send_work` | `() => true` | Same shape as Seats; a stale edge set silently changes who may send, so the read must be the current value, cheaply. |
| `Constitution` (`src/rig.mjs:46`) | session singleton, one text blob | injected into every seat prompt | `() => true` | Changed rarely, read constantly. Base cost is one blob. |
| `RigControl` (`src/rig.mjs:60`) | session singleton, 4 fields | the driver every pass (`pause` gates wake and claim) | `() => true` | The only transitions are pause/unpause; a wrong read here is a fleet-wide decision. |
| `ContinuityNotes` (`extensions/continuity.mjs:63`) | **conversation-scoped**, `history: "rewindable"`, `fork: "asOf"`, ~1 KB | `read_note`, wake, compaction (`beforeCompact`), reset | `info.deltasSinceBase >= 20` | History is retained here, so a base is an ADD, not a replacement: the bound bounds *both* replay depth and history growth. 20 keeps a note's chain small while a note is short-lived; upstream's analogue (`InboxDoc`) uses semantic emptiness, which is the wrong key for a note — a note is never empty once written. |

**Do all six need a checkpoint? Yes.** The question is never "checkpoint or not" — `() => false` is not a
neutral default, it is a decision to make every read linear in the doc's lifetime, and at `v1.5.1` a missing
predicate throws outright.

## 4. Continuity-read vs decision-gating — the distinction the intake asked for

A doc **read for continuity** (notes) is read to reconstruct state after a boundary. A wrong-by-a-few-revisions
read is recoverable: the seat re-reads. Its cost is bounded replay.

A doc that **gates a decision** (queue → landing readiness via `LANDING_QUEUE_STATUSES` in `src/readapi.mjs:673`;
control → whether a seat is woken; seats → whether a claim is allowed) is read at the moment an irreversible
action is taken. For those, the checkpoint policy is a **correctness property**: if the read is expensive, the
caller is tempted to cache it, and a cached decision is a decision made on yesterday's state. Every doc in the
second class gets `() => true` or a tight bound, and the bound is what makes the read *predictable* rather
than merely *usually fast*.

## 5. Failure modes, each with its recovery and its probe

1. **Silent — unbounded chain.** `() => false` never errors; reads just get slower as the store ages (9.3 ms at 2,625 deltas, 12.3 ms at 4,375). *Recovery:* the cadence bound. *Probe:* after N commits where N > bound, assert `storage.document(id,"current").deltasSinceBase <= bound` (the probe prints exactly this).
2. **Cascade — write pressure on the single-writer seam.** A base write on a session doc is a DELETE plus an INSERT (`storage.js:652,655`); a per-verb base on a 2 MB doc is 50× the commit time (30.7 s vs 0.6 s for 10,000 verbs). *Recovery:* cadence, capped so at most one base per 200 verbs; *probe:* `verbsMsTotal` in the probe must stay within 2× the never-checkpointed baseline.
3. **Contradiction — pin semantics differ.** At 1.3.0 a missing predicate is silently skipped; at 1.5.1 it throws. *Recovery:* a `check` rule (ROADMAP 355 acceptance already asks for it) that reports any rig doc with no `checkpointWhen`, so the rig does not discover the difference mid-pass at the pin move. *Probe:* a fixture doc without the predicate fails the rule.
4. **Partial — a predicate that scans the value.** An O(n) predicate per commit turns a cheap guard into O(n × verbs). *Recovery:* the contract below says predicates use `info`, not a scan. *Probe:* keep the predicate to a comparison on `info.deltasSinceBase`.
5. **Loop — none by construction** (the predicate runs once per commit), *unless* the bound is 0 or the predicate is `() => true` on a hot doc, which is the quadratic case in 2. *Probe:* the bound assertion in 1 fails loudly if the bound is mis-set.
6. **Context — history loss mistaken for a bug.** A checkpoint on a session doc discards prior revisions; anyone expecting to read an old queue state from a session doc is reading a doc that never had history to begin with (`isCurrentOnly`, `storage.js:57`). *Recovery:* state it in the doc comment and in this ADR; the audit trail lives in each item's `transitions` array, not in doc revisions. *Probe:* assert `deltasSinceBase === 0` immediately after a checkpointed commit for a session doc.

## 6. The contract the `impl` row must satisfy

A checkpoint predicate:
- **receives**: the candidate value after the change, the ops of the change, and `{ deltasSinceBase }` — the chain length *before* this change;
- **must be**: pure, total, O(1) over `info`, no I/O, no throwing (a throw poisons the transaction, not just the doc);
- **must not**: be keyed on a condition that can never become true (a semantic rule without a bound is a bound-less rule);
- **returns**: true ⇒ this change is stored as a base; for session docs the prior revisions are deleted.

Acceptance for the build row (all falsifiable, no model spend):
1. `node docs/evidence/2026-11-10-checkpoint-policy/probe.mjs` exits 0 and prints, for the queue policy, `deltasSinceBase <= 200` and a read median under the never-checkpointed baseline.
2. A `check` rule that fails when a rig doc has no `checkpointWhen`, and reports any rig session doc whose `deltasSinceBase` exceeds its declared bound.
3. The broker-liveness demos named in ROADMAP 355 (`broker`, `broker-liveness`, `broker-intent-wake`, `broker-wake-return`, `broker-cooldown-revisit`, `scheduler`) pass with the policy in place.
4. Store-size delta measured against the backup baseline (`617,492,480 bytes`, sha256 `0996cd61…`) on a live store — this is `impl`'s, because it needs the live store.

## 7. What this does not decide

It does not decide `settings.progress.persistWithinMs` or `settings.restartLimit` (ROADMAP 355 items 1 and 3);
those are separate rulings and are not folded here. If the pin move to `v1.5.1` lands before this row's build
row, the missing predicates throw — so the **minimum viable move** is to give every rig doc a predicate
immediately, and the tuning (bound values) can follow.

## 8. Addendum (2026-11-10, item #6310): the acceptance could not fail, so the probe now asserts

The intake carried acceptance as "`node docs/evidence/2026-11-10-checkpoint-policy/probe.mjs` exits 0 and
prints … `deltasSinceBase <= 200`". A printout is not a check: the probe exited 0 for every policy,
including a bound so high it never fires. **Recovery:** the probe now carries the gate — bound holds, a
base is actually written, the read median beats the never baseline, write cost stays inside the slack, and
the verb-class policy is shown to be worse — and exits 1 on any violation.

Run in this worktree (`item-6310`, `@earendil-works/pi-durable` **1.3.0** per the lockfile), each exit code
named:

```
node docs/evidence/2026-11-10-checkpoint-policy/probe.mjs                      # exit 0
  never   () => false    bases=0    deltas=2625  readMedian=9.8   ms writeTotal=381.5  ms
  every verb (semantic)  bases=2625 deltas=0     readMedian=5.17  ms writeTotal=19431.4 ms
  bound 50               bases=51   deltas=24    readMedian=5.16  ms writeTotal=650.7  ms
  bound 200              bases=13   deltas=12    readMedian=5.23  ms writeTotal=440.6  ms
  bound 1000             bases=2    deltas=623   readMedian=6.09  ms writeTotal=296.5  ms
  semantic + bound 200   bases=13   deltas=12    readMedian=5.01  ms writeTotal=416.1  ms
  RESULT: PASS

PROBE_ITEMS=1000 PROBE_VERBS=100 node …/probe.mjs                               # exit 1
  - never-checkpointed chain should exceed the bound 200, measured 88
  - bound 200: no base was written, so the bound is not doing anything

PROBE_ITEMS=1000 PROBE_VERBS=1000 CHECKPOINT_BOUND=5 node …/probe.mjs            # exit 1
  - bound 5 write cost 358.1 ms exceeds 2x the never baseline 126.8 ms
```

**The principle the second failure makes explicit:** the bound is a function of the **value size**, not a
universal number. At 1,000 rows a bound of 5 costs 2.8× the never-checkpoint baseline, because every base
serialises the whole document; at 5,000 rows (~2 MB) bound 200 costs 1.15× for a 47% faster read. So the
rule for a rig doc is: `() => true` only where the value is small enough that a base is cheaper than the
replay it prevents; a numeric bound where it is not; and the gate must assert **both** legs — a bound that
never fires is as wrong as a bound that fires every verb.

**Also verified, not inferred:** all six `defineDoc` calls carry a predicate today — `src/rig.mjs:23,35,44,60,110`
and `extensions/continuity.mjs:43`, all `() => false` and labelled provisional. So the latent-throw class
(failure mode 3) is already closed at the seam; what is missing is the `check` rule that keeps it closed,
which is the `impl` row (#6306), and this gate, which is the probe it can point at.
