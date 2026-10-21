# Queue lifecycle redesign — make a stuck item impossible, not just visible

**Status:** **ACCEPTED — design of record.** The operator accepted **v2** on 2026-10-19 and ruled that this
redesign **leads capability work** (defect fixes and the prerequisites it depends on are not capability
work and land first). v2 (2026-10-19) incorporates the independent reviews by `architect` (#2984,
`docs/reviews/architecture-queue-lifecycle-redesign-review.md`, 4 blockers + 13 CRs) and `advocate`
(#2985, `docs/reviews/advocate-queue-lifecycle-redesign.md`, 8 CRs); the disposition of every finding is
in §13. Two scope questions remain for `lead` (F12, F11 — §11). Where v1 and this document disagree, this
document wins.

**Author:** delegate (operator-directed), 2026-10-19.
**Companions:** [`WORK-ITEM-LIFECYCLE.md`](../WORK-ITEM-LIFECYCLE.md) (the model today) ·
[`WORK-ITEM-SCHEMA.md`](../WORK-ITEM-SCHEMA.md) (identity/naming; this proposal adds the fields it
anticipates in §4/R5 and §11) · the incident
[`incidents/2026-10-19-held-rows-orphaned-by-cleared-gates.md`](../incidents/2026-10-19-held-rows-orphaned-by-cleared-gates.md).

---

## 0. TL;DR

The queue can orphan work because **a parked item is not required to name a machine-readable reason it is
parked, nor who or what clears it, nor a date by which someone must look again.** The fix is to make the
park a structured object with a resolver and a trigger.

1. **Two axes** — `stage` (`open`/`active`/`closed`) and a nullable `block`. `held`/`deferred` stop being
   statuses and become `block` shapes; a block cannot exist without a resolver.
2. **Blocks are typed, sourced, and multi-constraint.** `block.source: declared|legacy`; a block may carry
   several `constraints`; the one automatic action (auto-open) fires **only** for a *declared*
   `dependency` whose **every** constraint is a completed queue gate. Legacy prose gates are never
   auto-promoted (see §4.1, §9).
3. **Every block has a trigger**, including a stuck gate: `gate-cleared-unreleased` and `gate-stalled`
   attention kinds (queue-scoped), plus `parked-review-due` and `orphan-no-progress`.
4. **`check` rules enforce well-formedness on *authored* blocks only** — never on the read-mapping of
   legacy rows, so enforcement can never turn `check` red across the unmigrated store and stop landings.

The migration is additive and lazy. The read-only half (rules + queue-scope attention) can ship first;
the `rig.mjs`/`driver.mjs` axis change is sequenced behind the standing reliability cluster.

---

## 1. The invariant this must make impossible

> **(W) Well-formedness (item-level, checkable, on authored state).** Every non-terminal item is
> `(stage === "open" && block === null)` **or** `block !== null` with a non-null `resolver` and, unless
> its reason is self-clearing, a non-null `reviewBy`.
>
> **(C) Claimability is separate and per-seat.** `workable(item, seat)` — never an item property.

**Honesty clause (advocate CR-8, architect F1).** The schema can make a *missing* resolver
unrepresentable; it cannot make a *wrong* resolver unrepresentable. A badly named gate stays a judgment —
that is what `gate-stalled` / `parked-review-due` and the operator's read surface are for. `check` is a
shape-guard, not a mind-reader.

**Why (W) is not the v1 partition (architect F1).** v1 said `active` is "block-free, with a live owner".
That is false for two live populations: a holder that defers its own claimed item (`stage: active` +
`block.question`), and a supervisor escalation of a **never-claimed** `queued` item
(`src/supervisor.mjs:114` writes `status:"deferred"` on a `queued` row). So (W) admits `active` + `block`,
and an escalated-but-unclaimed item is `open` + `block`. Claimability is no longer asserted in the
invariant because it depends on the seat (`requires`, used at `src/rig.mjs:393`, is not persisted — F1).

## 2. Two orthogonal axes

| Axis | Values | Meaning |
|---|---|---|
| `stage` | `open` · `active` · `closed` | where the item is in the workflow |
| `block` | `null` · `{…}` (§3) | why it is not progressing — only while not `closed` |
| `outcome` | `done` · `cancelled` | set iff `stage: closed` (terminal, WORK-ITEM-SCHEMA §2) |

Legacy view mapping — the four familiar states survive as **views**, and `deferred` no longer forces a
stage:

| Legacy status | New shape | Claimable? | Wakes? |
|---|---|---|---|
| `queued` | `stage: open`, `block: null` | yes (if `workable`) | yes |
| `held` | `stage: open`, `block: {…}` | no | no |
| `claimed` | `stage: active`, `block: null` | n/a | (running) |
| `deferred` | **stage unchanged** (`active` if the holder deferred; `open` if the supervisor escalated an unclaimed row), `block: {reason:"question", …}` | no | answer wakes the target via the QUESTION enqueue (§4.1) |

`claimable` = `workable(item, seat)`, a function of `stage`, `block`, and the seat's capabilities — not
a field.

## 3. The block model

```js
block: {
  source:  "declared" | "legacy",     // only "declared" may be reason:"dependency"
  reason:  "dependency" | "question" | "operator" | "schedule"
         | "resource" | "manual" | "backlog" | "roadmap-gate",
  resolver: "automatic" | "operator" | "<seat>" | "#<id>" | "RM-<n>",   // mandatory
  constraints: [ { kind:"queue", ref:"#1234" }
               | { kind:"roadmap", ref:"RM-157" }
               | { kind:"window", note:"operator quiet window" } ],       // 0..n
  payload: { deferredTo?: "human"|string, question?: string, note?: string },
  since:    "<ISO>",
  reviewBy: "<ISO>|null",
}
```

| `reason` | Resolver | Constraints | Auto-clears? | `reviewBy` |
|---|---|---|---|---|
| `dependency` | `"automatic"` | ≥1, **all `kind:"queue"`** | **yes** — when every queue constraint is `done` | required (default 7 d) |
| `question` | `"human"` or a seat | — | answer via the existing deferral/answer flow | n/a |
| `operator` | `"operator"` | window/decision | no | required (default 3 d) |
| `schedule` | a seat / `"pm"` | — | no | required (default 14 d) |
| `resource` | a seat / `"pm"` | — | no | required (default 3 d) |
| `manual` | a named seat | — | no | required (default 7 d) |
| `backlog` | `"pm"` | — | no | **null** — the registration shape, no clock (F10) |
| `roadmap-gate` | `"RM-<n>"` | ≥1 `kind:"roadmap"` | no (no close event in the queue) | required (default 7 d) |

Two rules make the field honest:

- **`resolver` is mandatory** (rule `item-block-resolver`).
- **`reviewBy` is mandatory unless the block self-clears or is `backlog`.** The `backlog` reason exists
  precisely because the six v1 reasons did not cover the dominant population (architect F10, advocate
  CR-2): measured, 60 of 160 held rows have **no gate at all**, and mapping them to a near-term clock is
  the alarm firehose.

**`source` gates the one automatic action (architect F2).** v1's §9 proposed deriving `blockedBy` from
prose. That is the exact prose-scanning unsticker v1 §10 rejected, and the measured candidate list proves
the danger: of the 59 held rows whose cited queue gates are all terminal, the classes are
landing-list 41 / backlog 36 / do-not-start 20 / registered 16 — mostly the operator's "DO NOT START".
**Only a `source:"declared"` `dependency` may auto-open; legacy rows are never promoted to a dependency
by inference** (a prose gate may be recorded as `block.note` for a human, never as `blockedBy`).

**`blockedBy` accepts two namespaces (architect F5).** `#<queue id>` and `RM-<roadmap id>`
(WORK-ITEM-SCHEMA RM-R4 already says "queue or RM"). A `dependency` whose constraint set is not all queue
gates is **not** self-clearing and must use `roadmap-gate` (or carry a `reviewBy`).

## 4. Triggers and propagation

### 4.1 Gate completion is an event — in the closing commit, with a pass backstop

Primary site: **the commit that closes the item** — `complete_work` (`src/rig.mjs:545-585`) and
`cancel_work` (`:856-877`) already run inside `api.commit` with the whole queue document loaded, so an
in-transaction `releaseDependents(tx, closedId, at)` makes the close and the dependent's release atomic
(architect F7). `driver.mjs` has **no** store write path (`selectWakes` is pure; `driveOnce` submits
wakes) and must not gain one (D111/D112). Backstop: a broker-pass sweep re-evaluates any `dependency`
whose queue gates are all `done`, for the crash case; the pass already loads the queue
(`src/broker.mjs:1052`) and already writes in-pass.

On a close of `X`, for each `declared` `dependency` whose constraints include `X`:

- **every constraint `kind:"queue"` is `done`** → **auto-open**: clear the block, append a
  `released-by-gate` transition carrying the gate ids, and let `selectWakes` wake the owner next pass;
- any queue constraint `cancelled` → **do not unblock**; emit `gate-cancelled`;
- otherwise → leave blocked.

Safety (architect F3, F13): auto-open is **idempotent** (skip `block === null`), **never changes `to`**,
**never touches an `active`** item, and requires **every** constraint satisfied — so a row blocked by a
queue gate **and** an operator window stays blocked when the queue gate closes. It is logged
(`AUTOOPEN released=<n> items=#…`, architect F16) because it is the one irreversible action the design
adds.

**The QUESTION enqueue stays (architect F8).** A seat deferral is not stuck today because `defer_work`
enqueues a `QUESTION #<id>: …` item to the target seat (`src/rig.mjs:703-710`) and the driver wakes for
it. `block` is **metadata**; the QUESTION item is the **trigger**. `defer_work` sets the block and leaves
`stage` unchanged; `resume_work` clears the block (and no longer needs the small lie of setting
`status:"claimed"` on a never-claimed escalated row, `:736`).

### 4.2 The watchdog

A read-only pass computes the attention kinds (§5) from persisted state. It never mutates the queue.

## 5. Attention kinds (queue-scoped)

`computeAttention` is **seat-scoped** (`src/attention.mjs:343-418`); queue-scoped notices live in
`metrics.mjs` (`scope:"queue"`, `src/metrics.mjs:109`). So add a pure `computeQueueAttention(queueItems,
{nowMs})` returning `scope:"queue"`, `seat:null` notices, merged by `readRigHealth`
(`src/readapi.mjs:409`) — do **not** smuggle an item notice into the seat loop (architect F9).

| Kind | Fires when | Scope |
|---|---|---|
| `gate-cleared-unreleased` | a `declared` `dependency`'s queue constraints are all `done`, still blocked | queue |
| `gate-stalled` | a `declared` `dependency` with a gate non-terminal beyond the `orphan` threshold | queue |
| `gate-cancelled` | a `declared` `dependency` cites a `cancelled` queue item | queue |
| `parked-review-due` | a non-`backlog`, non-`question` block past `reviewBy` | queue |
| `orphan-no-progress` | a non-terminal item with `block === null` and no transition in N days (the unrepresentable stray; a migration-aid alarm over legacy rows) | queue |
| `deferred_awaiting_answer` | `block.reason === "question"` (existing, re-pointed from `status==="deferred"`) | seat |

`gate-stalled` + the mandatory `dependency.reviewBy` together close architect F4 — the incident's own
live instance (`#2630`, gated on the non-terminal `#2797`/`#2806`) gets both a clock and a kind, instead
of falling between `gate-cleared-unreleased` (needs all gates `done`) and `gate-cancelled`.

**Noise control (advocate CR-2, architect F10):** the notices are a state snapshot (as all existing
kinds are), so the fix is the *population and the defaults*, not dedup: `backlog` carries no clock; the
legacy default `reviewBy` is far enough out that the first pass is bounded; the surface **aggregates and
caps** (`parked-review-due: 12 (of 160)`), and the default is echoed in `detail` so a human calibrates by
reading. If a future surface turns these into a notification *stream*, dedup per `reviewBy` epoch (one
fire, re-armed on bump) applies.

`status` gains the headline `N item(s) waiting on you` and `queue --blocked` lists blocked rows with
`reason`/`resolver`/`reviewBy` — **one derivation** (§5's derivation is the single source; D114's
`waiting` view is folded in, see §11/F11).

## 6. Queue vs roadmap — move intent, but only when the ledger can receive it

A large share of `held` rows are **roadmap registrations**, not paused tasks. WORK-ITEM-SCHEMA §11 already
declares the split (R9): the roadmap is the intent ledger, the queue the work ledger. The redesign acts on
it — but **introduces the `backlog` reason and keeps the `send_work({held:true})` alias until the roadmap
ledger has a write surface** (advocate CR-3). Today `send_work({held:true})` (`src/rig.mjs:338-349, 418`)
and `hold_work` are the rig's **only** registration verbs, and parking a "do not start" registration is a
live cross-seat habit. §6 names schema-side intent (RM-R1) but no write path; deprecating first would leave
seats with nothing that does the job. Order: land the ledger write surface → observe one registration
through it → then deprecate per-seat, keeping the alias (§9).

## 7. Enforcement (authored state only; `check` is a regression test, not the watchdog)

| Rule (`src/checkup.mjs`) | Severity | Fails when |
|---|---|---|
| `item-block-resolver` | error | an **authored** non-terminal item has a block with no/unknown `resolver` |
| `item-park-reviewby` | fix-now | an authored block is not self-clearing/`backlog` and has no `reviewBy` |
| `dependency-must-be-declared` | error | a `dependency` block with `source:"legacy"`, or whose constraints are not all queue gates and lacks `reviewBy` |
| `blockedBy-resolves` | error | a **declared** gate id is missing or (queue) `cancelled`; resolves both `#` and `RM` namespaces |
| `gate-not-cancelled` | fix-now | a declared `dependency` cites a `cancelled` queue item (never inferred from prose — architect F15) |
| `gate-cleared-unreleased` | error | a declared `dependency`'s queue gates are all `done`, still blocked |

**The critical sequencing rule (advocate CR-1 / architect F2).** These rules fire **only on blocks an
author actually wrote** (the `block` field present), never on the §9 read-mapping of legacy rows. A red
`check` blocks every landing (`land.md --suite` runs `check`; the `shared-tree-on-main` incident is the
precedent). Legacy rows feed attention/watch only. Absence of `block` is the legacy exemption — no new
flag.

## 8. Changes per seam (measured: ~30 status literals in 11 files — architect F6)

Centralise the mapping in **one** exported pair `effectiveStage(item)` / `effectiveBlock(item)` (legacy
mapping lives here, nowhere else) and **one** `workable(item, seat)` (architect F12); add a lint/check
that fails when `"held"`/`"deferred"` appear outside the mapping module.

| File:line | Site | Under the new axes |
|---|---|---|
| `src/rig.mjs` | `send_work`/`claim_work`/`complete_work`/`defer_work`/`resume_work`/`hold_work`/`release_work`/`cancel_work` | typed `block`; `defer_work` keeps the QUESTION enqueue; `complete_work`/`cancel_work` call `releaseDependents` (§4.1) |
| `src/broker.mjs:97` | `MID_ITEM_STATUSES = ["claimed","deferred","held"]` | `stage==="active" \|\| block!==null` |
| `src/broker.mjs:123` | oldest `queued` = the next claim | the shared `workable` |
| `src/broker.mjs:972` | `LIVE_STATUSES = […]` | `!isTerminalItem(item)` |
| `src/broker.mjs:1061` | in-pass write site | the §4.1 backstop sweep |
| `src/supervisor.mjs:72,84,114` | plans over `claimed\|queued`; **writes `status="deferred"`** | a second writer of state — must emit a well-formed `block` (architect F6) |
| `src/driver.mjs:38-72` | `selectWakes` | reads `stage`/`block`; **no** write path (§4.1) |
| `src/attention.mjs:352,359` | `queued`/`deferred` filters | `stage==="open" && !block` / `block.reason==="question"` |
| `src/metrics.mjs:263` | `queue-ageing` counts `queued` | via `workable`/`stage` |
| `src/watchview.mjs:33,34,38` | TUI projection | mapping pair |
| `src/eventfeed.mjs:58,66,70` | event rendering | mapping pair |
| `src/seattools.mjs:85` | `to===me && status==="claimed"` | `stage==="active"` |
| `cli.mjs:2419` | `LIVE = […]` | `!isTerminal`; projections show `stage`/`block`; add `queue --blocked` |
| `src/readapi.mjs:409` | health merge | merge `computeQueueAttention` (§5) |

## 9. Migration (additive, lazy — no big-bang)

1. **Write-only.** New items use `stage`/`block`; a new park names a resolver. `send_work({held:true})` is
   a **deprecated alias for the legacy mapping** (one mapping — architect F14) and stays until §6's write
   surface exists.
2. **Read both.** One mapping for one stored status: legacy `held` → `block:{source:"legacy",
   reason:"backlog"|"manual", resolver:"pm"|<item.to>, reviewBy:null|far-out}`; legacy `deferred` →
   `block:{reason:"question", payload:{deferredTo,question}}`, **stage unchanged**.
3. **Backfill lazily, by a human, never by script.** When a row is re-touched, convert its *prose* gate
   into a `block.note` (prose) — **never** into `blockedBy` (architect F2). A human may promote a note to a
   declared constraint. A `dependency` may only be written by the declaration path.
4. **Enforcement on authored state only** (§7), after the population is classified.
5. **First pass delivers visibility, not auto-open.** The ~51–59 orphan candidates become
   `gate-cleared-unreleased`/`stale` *attention*, and the human promotes the real dependencies; only then
   do those auto-open. (v1 wrongly promised these would auto-open — architect F2.)

**Cost note (architect F13):** the unit is **one queue document** (`tx.doc(RigQueue)`,
`src/rig.mjs:202`; snapshot 10.4 MB), not "the ~180-row filter". The propagation-in-the-closing-commit
design (§4.1) adds **no** extra materialisation, which is a second argument for it.

## 10. Rejected alternatives (and why)

- **Add a `parked-review-due` attention to today's `held`.** Leaves reason/gate in prose and the resolver
  unknown; treats the symptom.
- **Add more statuses (`blocked`, `waiting-operator`, `backlog`).** Multiplies states without supplying a
  resolver; the two-axis model carries the same information and keeps the four states as views.
- **A background unsticker that releases anything whose prose cites a `done` item.** Proven unsafe by the
  measured 59 candidates (mostly landing-list/backlog/do-not-start) — and v1's §9 re-introduced it; now
  forbidden by `block.source` (§3).
- **A maintained reverse index of dependents.** A second source of truth that drifts; and the closing
  commit already has the document, so no index is needed (§4.1).

## 11. Open questions for `lead` / the operator (updated)

1. **Grace before `gate-cleared-unreleased` fires** — one pass. *(unchanged)*
2. **Default `reviewBy`** — **adopted from the advocate's reviewed defaults:** `operator` 3 d, `schedule`
   14 d, `resource` 3 d, `manual` 7 d, `dependency`/`roadmap-gate` 7 d, `backlog` none, `question` n/a.
   (v1's `manual` 1 d is withdrawn — it floors the median-16 h population into immediate nag.)
3. **Same `block` shape on the roadmap ledger** (RM-R1/RM-R4)? *Recommendation: yes; one mental model.*
4. **Who actions `parked-review-due` / `gate-stalled`** — `pm` (routing), delegate verifies? *(unchanged)*
5. **Sequencing** — ship read-only (check rules + queue-scope attention) first, fence the
   `rig.mjs`/`driver.mjs` axis change behind the reliability cluster (`#2420`/`#2483`). *(unchanged)*
6. **Escalation to `lead` (architect F12):** `#2673`'s lead-ratified `workable(item,seat)` is the **same
   seam** as this design's claimability, and its `requires`/fault clause is not implementable because
   `requires` is not persisted. **One predicate or two** — the redesign should own one `workable` and
   `#2673` become its implementation, or the two must not land independently. Scope call for `lead`.
7. **D114 (architect F11):** there is no landed decision behind the `waiting` derivation
   (`docs/DECISIONS.md` tops at D112; D113 is reserved by an unlanded scribe item). Either land the
   architect's draft ADR (`architecture-queue-lifecycle-redesign-review.md` §4) with the `block` model as
   its source, or this proposal stops citing it. **v1's D114 citation is withdrawn.**

## 12. References

- Incident: `docs/incidents/2026-10-19-held-rows-orphaned-by-cleared-gates.md`
- Model today: `docs/WORK-ITEM-LIFECYCLE.md`
- Reviews of this proposal: `docs/reviews/architecture-queue-lifecycle-redesign-review.md` (#2984) ·
  `docs/reviews/advocate-queue-lifecycle-redesign.md` (#2985, branch `advocate-item-2985`)
- Schema: `docs/WORK-ITEM-SCHEMA.md` §1, §4/R5, §7, §8, §9, §11
- Code: `src/rig.mjs`, `src/driver.mjs`, `src/broker.mjs`, `src/supervisor.mjs`, `src/attention.mjs`,
  `src/metrics.mjs`, `src/watchview.mjs`, `src/eventfeed.mjs`, `src/seattools.mjs`, `src/checkup.mjs`,
  `cli.mjs`
- Queue: `#2626`, `#2630`, `#2673`, `#2733`, `#2788`, `#2789`, `#2797`, `#2804`, `#2826`, `#2984`, `#2985`

## 13. Review response (proposal owner, 2026-10-19)

Every finding from both reviews is dispositioned. **A** = accepted and incorporated above; **A\*** =
accepted with the stated refinement; **D** = declined with reason. No finding is silently dropped.

### Architect review (#2984)

| Finding | Disp. | Where / why |
|---|---|---|
| F1 invariant not a partition; §2 mapping contradicts it | **A** | §1 rewritten as item-level well-formedness + separate `workable`; §2 mapping `deferred` = stage-unchanged |
| F2 §9 re-implements the prose unsticker; 59 mostly do-not-start rows | **A** | §3 `block.source`; §9.3 never promotes prose to `blockedBy`; only declared dependency auto-opens |
| F3 `reason` is single-valued but parks are compound | **A** | §3 `block.constraints[]`; §4.1 auto-open iff **every** constraint is a done queue gate |
| F4 `dependency` has no `reviewBy`/no stuck-gate kind; `#2630` invisible | **A** | §3 `dependency.reviewBy` (7 d) + §5 `gate-stalled` |
| F5 `blockedBy` must accept RM ids; RM gate never self-clears | **A** | §3 two namespaces + `roadmap-gate` reason |
| F6 ~30 status literals in 11 files; §8 incomplete | **A** | §8 full table + one mapping pair + lint |
| F7 propagation cannot live in `driver.mjs` | **A** | §4.1 in the closing commit + pass backstop |
| F8 `defer_work`'s QUESTION enqueue is the wake trigger | **A** | §4.1 "the block is metadata, the QUESTION item is the trigger" |
| F9 kinds are queue-scoped but `computeAttention` is seat-scoped | **A** | §5 `computeQueueAttention`, merged in `readRigHealth` |
| F10 default legacy `reviewBy` fires on ~160 rows | **A** | §3 `backlog` reason; §9.2 far-out default; §5 aggregation/cap |
| F11 D114 does not exist | **A** | §11.7 — citation withdrawn; ADR to be landed or dropped |
| F12 #2673 `workable` is the same seam | **A** | §11.6 — escalated to `lead` as a scope call |
| F13 "tiny set" understates a 10.4 MB document | **A** | §9 cost note |
| F14 §9.1 vs §9.2 two mappings for `held` | **A** | §9.1/§9.2 one mapping |
| F15 `gate-not-cancelled` false-positives on re-registration rows | **A** | §7 — declared dependency only |
| F16 no observability for auto-open | **A** | §4.1 `AUTOOPEN` log + `released-by-gate` transition |
| F17 stalled reveal / `peek_queue` must handle blocked `active` | **A** | §8 (`seattools`, `peek_queue` projections) |

### Advocate review (#2985)

| Finding | Disp. | Where / why |
|---|---|---|
| CR-1 rules must judge persisted blocks only, or `check` stops every landing | **A** | §7 — rules fire on authored blocks only; legacy exemption = absent `block` |
| CR-2 `parked-review-due` firehose over ~100 rows | **A\*** | §3 `backlog` (no clock) + §5 aggregation/cap + §11.2 revised defaults. **Refinement:** the kinds are a *state snapshot*, not an event stream — per-pass recomputation is the existing contract, so dedup matters only if a future surface streams notifications; the population/defaults are the real fix |
| CR-3 do not deprecate `send_work({held:true})` before the ledger write surface | **A** | §6 — alias stays; ledger write surface first |
| CR-4 one `waiting` derivation; re-point attention/watch/TUI | **A** | §5 one derivation; §8 re-points |
| CR-5 `manual` resolver vs §9.2 `manual/pm` | **A** | §9.2 — legacy registration → `backlog`/`pm`, legacy manual → `resolver:<item.to>` |
| CR-6 gates that are not item-closes | **A** | §3 `window`/`roadmap` constraints + `roadmap-gate`; §4.1 only queue constraints auto-open |
| CR-7 wire the runbook `check_rule` at land time | **A** | §8 — build step |
| CR-8 honesty clause | **A** | §1 honesty clause |

### What I am keeping from the reviews as confirmations
The invariant's direction; two axes (not more statuses); `dependency`-only auto-open; rejection of the
reverse index and the prose unsticker; the roadmap/queue split (with CR-3's ordering); and the split
sequencing (read-only first). The reviews found real defects in v1 — F1, F2, F3, F4, F7, F8, F9, F11,
CR-1, CR-3, CR-6 are substantive design corrections, not polish.
