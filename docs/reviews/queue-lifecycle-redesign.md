# Queue lifecycle redesign — make a stuck item impossible, not just visible

**Status:** delegate proposal for `lead` and the operator to rule on. **Not a queue item and not a
decision** — it is the design of record for the incident
[`incidents/2026-10-19-held-rows-orphaned-by-cleared-gates.md`](../incidents/2026-10-19-held-rows-orphaned-by-cleared-gates.md).

**Author:** delegate (operator-directed), 2026-10-19.
**Companions:** [`WORK-ITEM-LIFECYCLE.md`](../WORK-ITEM-LIFECYCLE.md) (the model as it is today) ·
[`WORK-ITEM-SCHEMA.md`](../WORK-ITEM-SCHEMA.md) (identity/naming; this proposal adds the fields it
already anticipates in §4/R5 and §11).

---

## 0. TL;DR

The queue can orphan work because **a parked item is not required to name a machine-readable reason it is
parked, nor who or what clears it, nor a date by which someone must look again.** The fix is not more
attention on `held`; it is to make the *park* a structured object with a resolver and a trigger.

Three moves:

1. **Split `status` into two axes**: `stage` (`open`/`active`/`closed`) and a nullable `block`
   (`{reason, resolver, payload, since, reviewBy}`). `held`/`deferred` stop being statuses and become
   `block.reason` values; a block cannot exist without a resolver.
2. **Give every block a trigger.** `dependency` blocks are re-evaluated whenever any item closes and
   **auto-open** the item when all gates are closed; a gate that is `cancelled` raises a finding instead.
   Non-automatic blocks (`operator`/`schedule`/`resource`/`manual`) carry a `reviewBy` and a watchdog.
3. **New attention kinds** (`gate-cleared-unreleased`, `parked-review-due`, `orphan-no-progress`,
   `gate-cancelled`) so a stale park is visible in `status`/`watch` without a human asking, and a `check`
   rule enforces the invariant.

The migration is additive and lazy: legacy `held`/`deferred` rows are read through a mapping and
backfilled only when re-touched (WORK-ITEM-SCHEMA §7's own policy).

---

## 1. The invariant this must make impossible

> **Every non-terminal item is exactly one of:**
> **(a) `open` and claimable** (no block), or
> **(b) `active`** (claimed, block-free, with a live owner), or
> **(c) blocked, with a `block` that names a `resolver` and — when the resolver is not an automatic
> gate set — a `reviewBy` date.**
>
> **No item may be non-terminal and have neither an owner nor a resolver.** "I do not know why this is
> parked" must be an unrepresentable state, not a query result.

The current model violates this in one direction: `held` requires neither a resolver nor a date, and the
gate that justifies it is prose. That is the whole defect.

## 2. Two orthogonal axes

| Axis | Values | Meaning |
|---|---|---|
| `stage` | `open` · `active` · `closed` | where the item is in the workflow |
| `block` | `null` · `{…}` (§3) | why it is not progressing — only meaningful while not `closed` |
| `outcome` | `done` · `cancelled` | set iff `stage: closed` (terminal, WORK-ITEM-SCHEMA §2) |

The four legacy non-terminal statuses map exactly onto `(stage, block)` pairs, so nothing is lost and the
views stay familiar:

| Legacy status | New shape | Claimable? | Wakes? |
|---|---|---|---|
| `queued` | `stage: open`, `block: null` | yes | yes |
| `held` | `stage: open`, `block: {reason: schedule\|operator\|resource\|manual\|dependency}` | no | no |
| `claimed` | `stage: active`, `block: null` | n/a | (already running) |
| `deferred` | `stage: active`, `block: {reason: question, payload:{deferredTo, question}}` | n/a | answer wakes the target (§3) |

This is deliberately **not** more statuses. It is the same states with the *reason* and the *resolver*
promoted from prose to data.

## 3. The block model

```js
block: {
  reason:  "dependency" | "question" | "operator" | "schedule" | "resource" | "manual",
  resolver: "automatic" | "operator" | "<seat>" | "#<itemId>",   // who/what clears it
  payload: { blockedBy?: number[], deferredTo?: "human"|string, question?: string, note?: string },
  since:   "<ISO>",          // when the block was set (audit; already in transitions too)
  reviewBy:"<ISO>|null",      // mandatory unless reason === "dependency" or "question"
}
```

| `reason` | Resolver | Trigger | Auto-clears? |
|---|---|---|---|
| `dependency` | `"automatic"` (the `blockedBy` gate set) | any item reaching `closed` | **yes** — when every gate is `done` |
| `question` | `"human"` or a seat | the answer arrives | answered via the existing deferral/answer flow |
| `operator` | `"operator"` | the operator rules/acts | no — `reviewBy` reminder only |
| `schedule` | `"pm"` | `pm`/operator schedules the work | no — `reviewBy` reminder only |
| `resource` | a seat or `"pm"` | the resource becomes available | no — `reviewBy` reminder only |
| `manual` | a named seat | that seat re-examines it | no — `reviewBy` reminder only |

Two rules make the field honest:

- **`resolver` is mandatory.** A block without one is a schema error (`item-block-resolver`, §7).
- **`reviewBy` is mandatory unless the block self-clears.** A `dependency`/`question` block has an
  external trigger; every other reason is a human decision with a deadline. `reviewBy` is what forces the
  "waiting on the operator" class (currently invisible) to re-surface on a clock.

`blockedBy` (WORK-ITEM-SCHEMA R5) is the payload of a `dependency` block, not a parallel field. Prose
gates (`GATED on #1234`) become this field during lazy backfill — the schema already measured that 325
prose gates decay and only 69 are resolvable.

## 4. Triggers and propagation

### 4.1 Gate completion is an event

On **every** transition to `stage: closed` (done or cancelled) of item `X`, the broker evaluates the
non-terminal set (small — ~180 rows today) for items whose `block.payload.blockedBy` contains `X`, and
for each:

- all gates `done` → **auto-open**: clear the `block` (`stage` stays/becomes `open`), append a
  `released-by-gate` transition, and let `selectWakes` wake the owner on the next pass;
- any gate `cancelled` → **do not unblock**; emit `gate-cancelled` (a cancelled gate is not a satisfied
  one — WORK-ITEM-SCHEMA §8 already says this; nothing implements it today);
- otherwise → leave blocked.

Scanning the non-terminal set per close (rather than maintaining a reverse index) is an explicit choice:
the set is tiny, and a maintained index is a second source of truth that can go stale — the exact class
of bug this redesign exists to remove.

### 4.2 The watchdog

A periodic pass (the broker already ticks; no new timer) computes, read-only, the attention kinds in §5.
This is performed by the **read** side, so it never mutates the queue and cannot itself strand anything.

### 4.3 Auto-open is scoped to `dependency` only

No other reason auto-clears. `operator`/`schedule`/`resource`/`manual` are *human intent* to stay parked;
the watchdog reminds, it does not override. This is what makes the redesign safe: the only automatic
release is the one whose justification is mechanically unambiguous (a gate the author named reached
`done`).

## 5. Attention kinds (the visibility half)

Add to `src/attention.mjs` (all derived read-only, in the existing `{scope, seat, kind, detail}` shape):

| Kind | Fires when | Severity |
|---|---|---|
| `gate-cleared-unreleased` | a `dependency` block's gates are all `done` but the item is still blocked after a grace pass | error |
| `gate-cancelled` | a `dependency` block cites an item that is `cancelled` | fix-now |
| `parked-review-due` | a non-self-clearing block whose `reviewBy` has passed | warn |
| `orphan-no-progress` | a non-terminal item with no transition in N days and no live owner/claim | warn |

`deferred_awaiting_answer` remains, now derived from `block.reason: question` + `deferredTo` (its existing
human-vs-seat sharpening, `src/attention.mjs:359-366`, is preserved).

`status` gains a headline count, e.g. `N item(s) waiting on you` (the architect's `waiting` derivation,
D114, `#2788`), plus `queue --blocked` to list blocked non-terminal rows with their reason and resolver.

## 6. Queue vs roadmap — stop parking intent in the work queue

A large share of today's `held` rows are **roadmap registrations**, not paused tasks
(`ROADMAP 63 (owner: impl)`, `BACKLOG (TRIGGER-GATED, DO NOT START)`, …). WORK-ITEM-SCHEMA §11 already
declares the split: the **roadmap is the intent ledger**, the **queue is the work ledger** (R9).

The redesign acts on that: a durable "we should do this someday" lives on the roadmap with
`status: proposed|accepted|held` (schema RM-R1) and `blockedBy` (RM-R4). Only when it becomes *actionable
now* is a queue item minted, linked by `roadmap: ["RM-<n>"]` (R10) and closed back with
`deliveredBy` (R11). The queue then carries a small number of genuinely-blocked rows instead of 153 parks,
and "held" in the queue means "recently blocked", which is a state a watchdog can police.

## 7. Enforcement (what makes it true rather than documented)

| Rule (in `src/checkup.mjs`) | Severity | Fails when |
|---|---|---|
| `item-block-resolver` | error | a non-terminal item has a `block` with no/unknown `resolver` |
| `blockedBy-resolves` | error | a gate id does not exist (already in WORK-ITEM-SCHEMA §8) |
| `gate-not-cancelled` | fix-now | `blockedBy` cites a `cancelled` item (alias of `gate-cancelled`) |
| `item-park-reviewby` | fix-now | a non-self-clearing block has no `reviewBy`, or is past it |
| `gate-cleared-unreleased` | error | gates all `done`, item still blocked (the durable catch) |

The last row is the one that would have caught this incident: the durable-TUI render-rule rows named
`#2788` in prose and stayed `held` after `#2788`'s own prerequisites closed. With `blockedBy` + the
`gate-cleared-unreleased` rule, that state cannot persist silently — and with §4.1 it cannot persist at
all.

## 8. Changes per seam

| File | Change |
|---|---|
| `src/rig.mjs` | `send_work({held})` → `send_work({block})` (typed); `hold_work` requires a block + `reviewBy`; `release_work` clears the block; `defer_work`/`resume_work` read/write `block.reason: question`; `cancel_work` unchanged but participates in §4.1's propagation |
| `src/driver.mjs` | `selectWakes` reads `stage`/`block` (claimable = `open` + block-free; stalled claim = `active`); §4.1 evaluation on close |
| `src/attention.mjs` | the four new kinds (§5) |
| `src/checkup.mjs` | the five rules (§7) |
| `cli.mjs` `queue`/`status` projections | show `stage`, `block.reason`, `block.resolver`, `reviewBy`; add `queue --blocked` |
| `WORK-ITEM-SCHEMA.md` | add the `block` field to §2 and reference it from R4/R5 |
| `WORK-ITEM-LIFECYCLE.md` | rewrite §2–§6 against the new axes (this proposal is the design; the topic doc is the model) |

## 9. Migration (additive, lazy — no big-bang)

1. **Write-only.** New items use `stage`/`block`; a new park must carry a resolver. `held:true` becomes a
   deprecated alias for `block: {reason: "schedule", resolver: "pm", reviewBy: <default>}`.
2. **Read both.** Tooling maps legacy statuses → `(stage, block)`:
   `held` → `block: {reason: "manual", resolver: "pm", reviewBy: <now + grace>}` (conservative: a legacy
   park is treated as a human decision until re-touched), `deferred` → `question`.
3. **Backfill lazily.** When a held row is released/re-touched, convert its prose gate to `blockedBy` and
   pick the right `reason`. Never a bulk rewrite (schema §9).
4. **Then enforce.** Switch on §7 with the legacy exemption in force, exactly as schema §9 step 4.
5. **First pass produces value immediately.** The audit in `WORK-ITEM-LIFECYCLE.md` §7 already names ~51
   held rows whose cited gates are terminal; under the new model those become `gate-cleared-unreleased`
   and auto-open.

## 10. Rejected alternatives (and why)

- **Just add a `parked-review-due` attention to today's `held`.** Helps visibility but leaves the reason
  and the gate in prose, so `blocked` vs `backlog` vs `window` stay indistinguishable and the resolver is
  still unknown. It treats the symptom.
- **Add more statuses (`blocked`, `waiting-operator`, `backlog`).** Multiplying states does not supply a
  resolver or a date; `blocked` still must say blocked-on-what. The two-axis model carries the same
  information without a status explosion, and keeps the four familiar non-terminal states as views.
- **A background unsticker that releases anything whose prose cites a `done` item.** Dangerous false
  positives: an operator window or a roadmap gate that incidentally cites a terminal item would be
  released. The redesign only auto-opens a *declared* `dependency` whose *declared* gates are all `done`.
- **A maintained reverse index of dependents.** Extra state that can drift; the non-terminal set is small
  enough to scan per close (§4.1).

## 11. Open questions for `lead` / the operator

1. **Grace before `gate-cleared-unreleased` fires** — one pass (immediate) or a short grace (e.g. one
   hour) so a legitimate in-flight release is not double-reported? *Recommendation: one pass.*
2. **Default `reviewBy` per reason** — e.g. `schedule` 7 d, `resource` 3 d, `operator` 3 d, `manual` 1 d?
3. **Does the roadmap ledger adopt the same `block` shape** (schema RM-R1/RM-R4), or keep a lighter
   `status: held` + `blockedBy`? *Recommendation: the same shape, so one mental model.*
4. **Who action `parked-review-due`** — `pm` (routing) with the delegate verifying, per the runbook?
5. **Ordering vs the bug-fix-first rule** — this is a capability/lifecycle change; does it sequence after
   the standing reliability cluster (`#2420`/`#2483`), or does the incident's severity (work silently
   lost) promote it? *Recommendation: promote the `check` rules and attention kinds (read-only, small),
   which are safe alongside bug-fix work; defer the `rig.mjs`/`driver.mjs` axis change behind the cluster.*

## 12. References

- Incident: `docs/incidents/2026-10-19-held-rows-orphaned-by-cleared-gates.md`
- Model today: `docs/WORK-ITEM-LIFECYCLE.md`
- Schema: `docs/WORK-ITEM-SCHEMA.md` §1, §4/R5, §7, §8, §9, §11
- Code: `src/rig.mjs`, `src/driver.mjs`, `src/attention.mjs`, `src/checkup.mjs`, `cli.mjs`
- Decision: D114 (`waiting` derivation), D111 (broker-served reads)
- Queue: `#2626`, `#2630`, `#2733`, `#2788`, `#2789`, `#2797`, `#2804`, `#2826`
