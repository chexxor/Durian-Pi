# The WAKE log line is the only post-mortem surface for the parked-wake fix — and it names nothing

**Status:** review + durable decision (architect, 2026-11-09). Carried by queue item **#5908**;
the fix it reviews is **#5741** (the wake-reason work, `WAKE_CONTENT_PARKED`, already on `main`).
This document is the **observability half** of that change. It is not a new feature: it is the
probe that makes the existing one falsifiable.

**Subject of review:** the seam between `selectWakes` (which decides *why* a seat is woken) and
`logBrokerLine` (which records *that* a seat was woken).

---

## 1. The defect, stated at the code

The reason is computed, used, and then thrown away at the log seam.

- `src/driver.mjs:127` — `wakes.push({ name, conversationId: convId, reason: hasQueued ? "queued" :
  hasStalledClaim ? "stalled-claim" : "parked" })`. Three states, one field.
- `src/driver.mjs:242` — the reason chooses the wake **body**:
  `content: wake.reason === "stalled-claim" ? WAKE_CONTENT_STALLED : wake.reason === "parked" ? WAKE_CONTENT_PARKED : WAKE_CONTENT`.
  This is the part #4557/#4607 fixed: the body now matches the verb the seat will actually reach for.
- `src/driver.mjs:246` — `onWoke?.(wake.name, wake.conversationId)`. **`wake.reason` is in scope and
  is not passed.**
- `src/broker.mjs:1795-1798` — `onWoke: (name) => { scheduler.recordWakes([name], now()); logBrokerLine(dbPath, \`WAKE ${name}\`) }`.
  The emitted line is `WAKE <seat>` and nothing else.

The asymmetry is the tell. Suppressions **are** explained (`src/broker.mjs:1344-1348`):

```
SKIP <seat> reason=<reason>[ conv=<id>][ age=<ms>]
```

Wakes are not. So the log answers "why did this seat *not* get a wake?" but not "why *did* it?".
A seat woken because its only rows are parked is logged identically to a seat woken because it has
claimable work: `WAKE architect` either way.

Measured on the live log, cited in D239 (`docs/DECISIONS.md`, 2026-11-08): **174 parked wakes vs 72
claimable wakes** — the parked case is the *majority* of wakes. If it is the majority, it is the one
the operator is most likely to need to read, and it is precisely the one the log cannot distinguish.

Two checks exist and neither covers this:

- `demo/wake-reason.test.mjs` asserts the reason at the **driver** layer (pure). Run on 2026-11-09
  from this worktree: `node demo/wake-reason.test.mjs` → **exit 0**, "PASS — four states, four
  distinct outcomes, and the reason travels with the wake". It proves the reason exists in the
  return value. It says nothing about the log.
- `demo/broker-wakepath.test.mjs:103,107` asserts only `WAKE \S+` and `WAKE impl`. Run on 2026-11-09:
  **exit 0**. Its regex would match a `WAKE impl reason=parked` line unchanged, so it cannot fail
  if the reason is dropped.

That is the definition of an unfalsifiable fix: the corrective behaviour has no assertion that can
go red when the correction is removed.

## 2. Failure modes, each with its recovery path

1. **Silent — the parked-wake storm is invisible.** A seat whose rows are all held/deferred is woken
   every cooldown for hours. The log shows `WAKE <seat>` lines that look like work.
   *Recovery:* the reason field, plus the PASS census (§3). A line that says `reason=parked` is
   countable, so the storm becomes a metric rather than a rumour.
2. **Cascade — a wake that advances nothing reads as progress.** `onWoke` starts the seat cooldown
   (`src/scheduler.mjs:153`), and a completed pass resets the reopen budget (`src/broker.mjs:1805`
   `reopenAttempts = 0`) and prints `PASS n ms=… woke=<names>` (`src/broker.mjs:1809-1810`). A broker
   looping on parked rows therefore looks healthy on every liveness surface the supervisor reads.
   *Recovery:* the PASS line carries the reason per seat (`woke=impl:queued,qa:parked`), so
   "passes advanced" and "work happened" are separable from the same line.
3. **Contradiction — two vocabularies for one fact.** `selectWakes` says `parked`; `workable()`
   (`src/rig.mjs:295-310`) says `not-queued:held`, `gate-open:#N`, `gate-cancelled:#N`, `requires:X`.
   A seat that asks "why can't I claim #4879?" gets a claim-side reason the wake log never emits, so
   the two surfaces cannot be joined in one grep.
   *Recovery:* one vocabulary. The wake reason should be the `workable()` code for the queued branch
   and a named code for the parked/stalled branches. That is **#2712**'s job (wake selection using
   the same predicate claim uses); §4 scopes this change so it does not pre-empt it.
4. **Loop — parked wakes never converge.** Nothing in the wake releases the parked row, so the cycle
   is bounded only by the cooldown.
   *Recovery:* per-reason counting on the PASS line gives a threshold; an attention rule can fire
   when `parked` wakes dominate a window. Detection is impossible before the reason exists.
5. **Context/secret leak — the temptation to put the item id or body in the line.** The log is read
   by `check`/doctor surfaces. Bodies belong in the store, not the log.
   *Recovery:* the reason field carries status codes only; item ids are permitted (an integer),
   bodies are not.
6. **Consumer break — a regex elsewhere keys on `WAKE <seat>` at end of line.** Grepping the repo,
   `WAKE` appears in the log assertions of `demo/broker-wakepath.test.mjs` and `docs/incidents/2026-10-19-stranded-submission-seat-stall.md:181`
   (`grep "WAKE impl"`), neither of which anchors at end-of-line.
   *Recovery:* append the field (`WAKE impl reason=queued`) rather than restructure the line; run
   `node scripts/test.mjs --suite` before landing and report the diff, not a claim.

## 3. Decision (ADR)

**Status:** proposed — minted as `D-<mint>` at landing, in issue order, per the numbering rule
(`docs/DECISIONS.md` + lead #3075: a branch never hardcodes a D-number).

**Context:** the wake-reason work (#4557, #4607, #5741) fixed what a seat is *told*. Nothing fixed
what an operator can *see*. A fix whose effect appears only inside a conversation transcript is not
observable: the broker log is the durable post-mortem surface (D46), and the WAKE line on it is
reason-free.

**Decision.** Three changes, one concern each:

1. **Thread the reason across the seam.**
   `src/driver.mjs:246` → `onWoke?.(wake.name, wake.conversationId, wake.reason);`
   `src/broker.mjs:1795` → `onWoke: (name, conversationId, reason) => { … }` and
   `logBrokerLine(dbPath, \`WAKE ${name} reason=${reason ?? "unknown"}\`)`.
   `reason ?? "unknown"` is deliberate: an untagged wake must degrade to **unknown**, not to empty
   (the "degrade to unknown, not empty" rule, `docs/DECISIONS.md` D239/#4058).
2. **Make the PASS line a reason census.** `woke=` becomes `woke=<seat>:<reason>[,<seat>:<reason>…]`.
   Same line, same order, no new line, so the existing "WAKE before PASS in log order" assertion is
   untouched.
3. **One assertion per guarantee, in the demo that already owns the seam.** In
   `demo/broker-wakepath.test.mjs`, next to the existing `WAKE impl` check:
   - `check("WAKE line names its reason", /WAKE \S+ reason=(queued|stalled-claim|parked)/.test(log))`
   - a parked-only fixture asserting `reason=parked` on the WAKE line **and** that the submitted body
     is `WAKE_CONTENT_PARKED` — the reason and the body must be asserted **together**, because the
     pair is the contract; either alone can drift.

**Options considered and the trade-off accepted.**

- **(A) Thread the reason through `onWoke`** (chosen). Two lines change, the log format is
  append-only, every existing consumer still matches, and the guarantee is falsifiable by a demo that
  already runs. Reversible: delete one field and the shape reverts.
- **(B) Emit a second diagnostic line** (`WAKE-DIAG seat=… reason=…`). Richer and keeps `WAKE`
  byte-identical for old greps. Rejected: it doubles the line count on the busiest log verb, splits
  one fact across two lines, and a seat can be woken by line 1 while line 2 is lost to a write
  failure — the exact partial-failure shape the log must not create.
- **(C) Put the reason only on the PASS line.** Rejected: per-seat attribution is lost, so the
  question "which seat was woken for a lie?" cannot be answered, which is the whole point.

**Consequences.**
- The parked-wake class becomes countable, so #2712 (wake selection using `workable`) has an
  instrument to prove itself against; without this, that fix is also unfalsifiable.
- The wake-retry and cooldown machinery gain a legible distinction between "a pass woke seats" and
  "a pass advanced work", which is the discriminator the supervisor and the `admitted_not_started`
  attention row both need.
- The reason vocabulary is temporarily doubled (wake codes vs `workable()` codes) until #2712
  lands; the ADR records that as a debt, not as a design.
- Nothing here changes a wake body, so ROADMAP 33's prompt-cache invariant is untouched: bodies stay
  constant per reason.

## 4. What this must NOT become

- Not a body change: the wake text stays a fixed constant per reason.
- Not an item-body dump into the log.
- Not a re-decision of wake *selection*; that is #2712's, gated on #2673.
- Not a new check rule in `src/checkup.mjs` in this change; a storm threshold is a follow-up and
  belongs with the attention-rule cluster, not with this seam.

## 5. Verify

Run, from a clean base, and report exit codes:

```
node --check src/driver.mjs src/broker.mjs
node demo/wake-reason.test.mjs          # reason still travels at the driver layer
node demo/broker-wakepath.test.mjs      # now asserts WAKE ... reason=<code>
node scripts/test.mjs --suite           # no consumer of WAKE lines broke
```

Falsification, stated so it can be checked by someone else: **delete the `reason=` append at
`src/broker.mjs:1798` and `demo/broker-wakepath.test.mjs` must go red.** If it stays green, the
guarantee is not pinned and this change is not done.
