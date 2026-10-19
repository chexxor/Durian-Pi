# Architecture review — queue-lifecycle redesign (two-axis `stage` × `block`)

**Status:** review delivered (architect, 2026-10-19). Item **#2984**. Reviews the proposal
[`docs/reviews/queue-lifecycle-redesign.md`](queue-lifecycle-redesign.md) (delegate, on `main` @
`6875bc8`) against the incident
[`docs/incidents/2026-10-19-held-rows-orphaned-by-cleared-gates.md`](../incidents/2026-10-19-held-rows-orphaned-by-cleared-gates.md).
**Reviewer's boundary:** design and review only — I did not implement, register build items, or edit the
proposal. `lead` rules scope; `qa`/`auditor` verify implementation.
**Base revision:** `architect-item-2984`, forked from `main` @ `6875bc8`. The shared tree is **live**
(the store moved under me during this review: 2,987 → 2,988 items, held 160, claimed 18 → 16). Every
citation is re-checkable with the probe in the finding; line numbers are "as of this review".

---

## 0. Verdict

**The mechanism is the right one; the specification has four blocking defects and eleven further change
requests.** The two-axis model (`stage` × `block`) is correct in direction: it is the only one of the four
options in §10 that promotes the *reason* and the *resolver* from prose to data, and it is the only one
that makes the incident's root cause (a park with no queryable reason) fixable rather than merely
visible. The rejected alternatives are correctly rejected.

What is **not** yet true is the claim in §1 that the orphan state becomes *unrepresentable*. As specified
it is representable in at least four ways — most importantly on the very item the incident names as a live
instance (`#2630`), which under §4.1 as written still has no trigger, no `reviewBy`, and no attention kind
(F4). The auto-release half of the design (§4.1) is also the half that can start work the operator marked
"DO NOT START" (F2, F3).

| # | Severity | One-line |
|---|---|---|
| F1 | **BLOCKER** | The §1 invariant is not a partition, and §2's own mapping contradicts it |
| F2 | **BLOCKER** | §9 steps 3+5 re-implement the prose-scanning unsticker that §10 rejects (59 measured rows, mostly "DO NOT START") |
| F3 | **BLOCKER** | `reason` is single-valued but live parks are compound (window **and** dependency) → auto-open can release operator-window work |
| F4 | **BLOCKER** | A `dependency` block has no `reviewBy` and no "gate itself stuck" kind → `#2630`, the cited live instance, stays invisible |
| F5 | MAJOR | `blockedBy` cannot express a roadmap gate; a `dependency` on `RM-<n>` has no trigger |
| F6 | MAJOR | §8's seam table misses ~30 status-literal sites in 11 files, including `src/broker.mjs` |
| F7 | MAJOR | §8 puts §4.1 propagation in `src/driver.mjs`, which has no store write path |
| F8 | MAJOR | §8 omits that `defer_work`'s QUESTION enqueue *is* the wake trigger; dropping it re-creates the incident |
| F9 | MAJOR | The new attention kinds are queue-scoped but `computeAttention` is seat-scoped |
| F10 | MAJOR | The default legacy `reviewBy` fires `parked-review-due` on ~160 rows in the first watchdog pass |
| F11 | MAJOR | D114 (the `waiting` derivation §5 folds in) does not exist in `DECISIONS.md` |
| F12 | MAJOR | #2673's lead-ratified `workable` predicate is the same seam — two predicates would violate R8 |
| F13 | MINOR | "The non-terminal set is tiny (~180)" understates the real unit of work: a 10.4 MB single document |
| F14 | MINOR | §9 step 1 vs step 2 give two different mappings for the same legacy `held` status |
| F15 | MINOR | §7's `gate-not-cancelled` false-positives on the re-registration rows that cite a cancelled original |
| F16 | MINOR | No observability for the one irreversible action the design adds (auto-open → wake) |
| F17 | MINOR | `claim_work`'s stalled-claim reveal and `peek_queue` must exclude blocked items |

---

## 1. Measured baseline (this is what the design must cover)

All numbers below are from a **broker-served** read (D111): `DURIG_DB=./selfdev.sqlite node cli.mjs queue`
— never a second opener. The snapshot is 10,412,547 bytes.

| Fact | Value | Source |
|---|---|---|
| Items / non-terminal | 2,988 / **188** | §Probes P1 |
| `held` / `claimed` / `deferred` / `queued` | **160** / 16 / 10 / 2 | P1 |
| Held age | median **15.9 h**, p90 61.5 h, max 75.7 h, **49 > 24 h** | P1 |
| Held by seat | impl 115, devtools 14, scribe 10, qa 8, security 5, lead 4, auditor 2, advocate 1, pm 1 | P1 |
| Held rows **with no gate prose at all** | **60** | P1 |
| Held rows gated only by a roadmap id (no queue id) | **9** | P1 |
| Held rows citing ≥1 **non-terminal** queue item | **37** | P1 |
| Held rows whose cited queue gates are **all terminal** (orphan candidates) | **59** | P1 |
| Held by subject class | landing-list **41**, backlog 36, other 28, do-not-start **20**, registered 16, verify 10, roadmap-registration 7, rebase 1, operator-window 1 | P2 |
| Fields present on the store | `id from to subject body optimizedVia status transitions resultSummary question deferredTo notice evidence cancelReason heldReason tier` — **no `blockedBy`, no `kind`, no `roadmap`, no `requires`, no `block`** on any of 2,988 items | P2 |

Three of these decide several findings:

1. **The dominant held shape is not a queue dependency.** 41 landing-list + 36 backlog + 20 do-not-start
   + 16 registered + 7 roadmap-registration = **120 of 160** are window/backlog/registration parks;
   `dependency`-on-a-queue-item is a minority. The redesign's §4.1 leverage targets the minority, and
   §9's default mapping targets the majority with a clock (F10).
2. **`blockedBy` (R5), `kind` (R3) and `roadmap` (R10) are not implemented at all** — zero of 2,988
   items carry them. §9's "read both" is therefore not a compatibility mapping over an existing field;
   it is the first introduction of the field, over the whole store. That makes F2 (what the backfill
   infers) the whole ballgame.
3. **The queue is ONE document.** `tx.doc(RigQueue)` (`src/rig.mjs:202`) materialises all 2,988 items
   including `transitions`; the broker pass already pays this at `src/broker.mjs:1052`. "The non-terminal
   set is small" is true of the *filter*, not of the *scan* (F13).

---

## 2. Findings

### F1 — BLOCKER — the §1 invariant is not a partition, and §2's own mapping contradicts it

1. **Defect.** §1 states the invariant as a three-way partition: (a) `open` and claimable, (b) `active`
   and **block-free**, (c) blocked with a resolver. §2's mapping table then produces `deferred` as
   `stage: active` **with** a `block` — a shape §1(b) forbids and §1(c) does not describe. The invariant
   and the mapping cannot both be right.
2. **Second gap in the same sentence.** `active` is defined as "claimed, block-free, **with a live
   owner**". That is false for a live population: `applyEscalations` writes `item.status = "deferred"` on
   an item that was `queued` and never claimed (`src/supervisor.mjs:114`, planned at
   `src/supervisor.mjs:72` over `claimed || queued`). Such an item is non-terminal, blocked, and has no
   owner. Measured: 10 items are `deferred` today, 9 of them escalated to the human (`deferredTo:
   "human"`).
3. **Third gap.** `open` + `block: null` does **not** imply claimable: claimability is per-seat (the
   `requires` capability test). The item does not record `requires` at all — it is used only at send time
   (`src/rig.mjs:393`) and is absent from the store schema (P2). So §1(a)'s "open and claimable" is a
   statement about a *seat*, not about an item.
4. **Fix (concrete).** Split the invariant into two, and let neither mention "claimable":
   - **Well-formedness (item-level, checkable):** every non-terminal item is
     `(stage === "open" && block === null)` ∨ `(stage ∈ {open, active} && block !== null &&
     block.resolver != null && (SELF_CLEARING.has(block.reason) || block.reviewBy != null))`.
     Note this admits `active` + `block` (deferred, and the supervisor's escalation), which is the point.
   - **Claimability (seat-level, a function):** `workable(item, seat)` — see F12. `open`+`block:null` is
     *necessary*, not sufficient.
5. **Probe.** P6 (below): assert the well-formedness predicate over all non-terminal items; it must fail
   on today's store if run against a naive `active ⇒ block-free` reading, and must pass after the change.

---

### F2 — BLOCKER — §9 steps 3+5 re-implement the prose-scanning unsticker that §10 rejects

1. **Defect.** §10 rejects "a background unsticker that releases anything whose prose cites a `done`
   item" as *dangerous false positives*, because "an operator window or a roadmap gate that incidentally
   cites a terminal item would be released". §9 step 3 then does exactly that: "convert its **prose gate**
   to `blockedBy` and **pick the right reason**", and §9 step 5 promises the ~51 orphan candidates "become
   `gate-cleared-unreleased` and **auto-open**". For those rows to auto-open they must first have been
   assigned `reason: dependency` with a prose-derived `blockedBy` — which is the rejected mechanism.
2. **Evidence (measured).** 59 held rows match "prose gate + every cited queue id terminal" (P1). Their
   subject classes show they are *not* dependencies (P2): 41 landing-list, 36 backlog, 20
   `DO NOT START`/`TRIGGER-GATED`, 16 registered, 7 roadmap-registration. Examples straight from the
   candidate list: `#994` ("ROADMAP 90 NORMALIZE (TRIGGER-GATED — DO NOT START) … awaits OPERATOR-declared
   quiet window", cited gates `#989 #987 #938 #944 #328` all terminal), `#740` ("BACKLOG (TRIGGER-GATED,
   DO NOT START) … fire when the ownership-change trigger fires"), `#1522` ("REGISTERED (backlog —
   TRIGGER-GATED, do not start)"). Auto-opening these starts work the operator explicitly parked.
3. **Fix (concrete).** Make the *source* of a block a first-class, checkable field and gate the one
   automatic action on it:
   - `block.source: "declared" | "legacy"`. Only `declared` may be `reason: dependency`.
   - A re-touched legacy row keeps §9 step 2's conservative mapping (a non-dependency reason with a
     `resolver` and a `reviewBy`); the backfill may **record** a prose gate into `block.note` (prose,
     never `blockedBy`) so the operator can promote it by hand.
   - Auto-open (§4.1) requires `block.source === "declared" && block.reason === "dependency"`.
   - Add a check rule `dependency-must-be-declared` (error) so a `dependency` block with a legacy
     provenance cannot be written.
4. **Probe.** P3 prints the 59 candidates with their classes; the rule above must leave all 59 blocked.
   A demo (`demo/queue-lifecycle-backfill.test.mjs`) asserts that a legacy `held` row with a prose gate on
   a terminal item is **not** auto-opened by a propagation pass.

---

### F3 — BLOCKER — `reason` is single-valued but live parks are compound

1. **Defect.** `block.reason` is one enum value. The live population contains parks with two independent
   constraints: a queue dependency **and** an operator/scheduling window. If such a row is labelled
   `dependency` (so it auto-opens), the auto-open fires when the *queue* gate closes while the operator
   window is still closed — an unsafe release. If it is labelled `operator`/`schedule`, the queue gate is
   invisible and the row never auto-opens — the original orphan, one level up.
2. **Evidence.** 111 of 160 held rows mention operator/window/quiet (P1); 41 are `LANDING LIST` rows whose
   real gate is an operator-declared landing window (P2). `#2826` names two gates in its own subject:
   "HELD — gated on #2788; **floor gate now cleared**". `#2797` is a landing entry whose blockers are a
   window **and** a branch-tip/conflict condition (its own `deferred` question lists 4 separate blockers).
   `#2630` names two gates (`#2797` landing-list, `#2806` held).
3. **Fix (concrete).** Either (a) `block.constraints: [{kind:"queue"|"roadmap"|"window"|"operator",
   ref}]` with auto-open iff *every* constraint is a queue gate that is `done`; or (b) the cheaper
   variant: keep `reason` single-valued but make `reviewBy` **mandatory whenever a second constraint
   exists**, and auto-open only a `dependency` whose block carries no other constraint (encoded as
   `block.also: null`). Option (a) is more faithful; option (b) is reversible and smaller. Prefer (a) if
   the roadmap ledger (§11) adopts the same shape, since RM-R4 already wants a blocker *list*.
4. **Probe.** A demo with a row blocked by `[#100 (done), window:open]` asserts it is **not** auto-opened;
   the same row with the window cleared is.

---

### F4 — BLOCKER — a `dependency` block has no `reviewBy` and no "gate stuck" kind, so `#2630` stays invisible

1. **Defect.** §3 makes `reviewBy` mandatory *except* for `dependency` and `question`. §5's
   `gate-cleared-unreleased` fires only when gates are all `done`. Therefore: a `dependency` block whose
   gate is itself **non-terminal and not progressing** has (i) no `reviewBy`, (ii) no attention kind,
   (iii) no check rule. The dependent is invisible exactly as today — the state is *not* unrepresentable;
   it has only moved one level up the chain.
2. **Evidence.** 37 held rows cite at least one non-terminal queue item (P1). The live instance the
   incident names: `#2630` is `held`, with `heldReason` naming **`#2797` (landing-list, now `deferred` to
   pm)** and **`#2806` (held)** as its gates — both non-terminal, neither closing by its own event soon.
   Under §4.1, `#2630` would be `block: {reason: dependency, blockedBy: [#2797, #2806]}`: no `reviewBy`,
   no `gate-cleared-unreleased` (gates not `done`), no `gate-cancelled` (not cancelled). Nothing fires.
   The proposal's own "strongest argument for §4.1" is therefore *not* fixed by §4.1 as written.
3. **Fix (concrete).** Give `dependency` a `reviewBy` too (it is the only block reason that can wait
   forever on a chain), **and** add a fifth attention kind `gate-stalled`: a `dependency` block with at
   least one `blockedBy` target that has been non-terminal beyond a threshold (reuse the `N` days of
   `orphan-no-progress`). The two are complementary: `reviewBy` catches a slow human, `gate-stalled`
   catches a stuck machine gate.
4. **Probe.** P3 lists the 37 chained rows; a demo asserts `gate-stalled` fires for a dependent whose gate
   is `held`/`deferred` past the threshold, and does **not** fire for one whose gate is `claimed` and
   advancing.

---

### F5 — MAJOR — `blockedBy` cannot express a roadmap gate, and a `dependency` on `RM-<n>` has no trigger

1. **Defect.** §3 types `payload.blockedBy?: number[]` — queue ids only. The live store has held rows
   gated on a roadmap entry and nothing else: **9** rows (P1), e.g. `#1786` ("REGISTERED (ROADMAP 143,
   AGT review) — HELD BACKLOG"), `#1228` ("ROADMAP 127 … GATED on ROADMAP 115"), `#2482` ("ROADMAP 157
   … GATED"). WORK-ITEM-SCHEMA §11.5 **RM-R4** already says an entry's blockers are "ids (queue or RM)" —
   so the two ledgers would use incompatible id spaces in the same field name.
2. **Second defect.** §4.1's trigger is "any item reaching `closed`". A roadmap entry has no `closed`
   event in the queue store. So a `dependency` block whose gate is `RM-<n>` is, by construction, a park
   with no trigger — i.e. an orphan — unless it is reclassified as a non-self-clearing reason with a
   `reviewBy`.
3. **Fix (concrete).** `blockedBy` accepts a tagged id: `"#1234"` | `"RM-157"` (or
   `[{kind:"queue"|"roadmap", id}]`). Define `SELF_CLEARING = {reason:"dependency", allGatesAreQueue}`:
   a `dependency` whose target set contains any `RM` id is **not** self-clearing and must carry a
   `reviewBy` (or be `reason: "roadmap-gate"`). The §7 check rule `blockedBy-resolves` must then resolve
   two namespaces, and `gate-cancelled`/`gate-cleared-unreleased` must ignore `RM` targets (no queue
   status exists to test).
4. **Probe.** P1's roadmap-gated count (9); a demo asserting an `RM`-gated `dependency` without a
   `reviewBy` is rejected by the schema rule.

---

### F6 — MAJOR — §8's seam table is incomplete: ~30 status-literal sites in 11 files

1. **Defect.** §8 lists `rig.mjs`, `driver.mjs`, `attention.mjs`, `checkup.mjs`, `cli.mjs`, and two docs.
   Measured, the status literals `"queued"|"claimed"|"held"|"deferred"` appear in **11 source files**:

   | File:line | Site | What it means under the new axes |
   |---|---|---|
   | `src/broker.mjs:97` | `MID_ITEM_STATUSES = new Set(["claimed","deferred","held"])` | "the seat holds a mid-item" → `stage==="active" \|\| block!==null` |
   | `src/broker.mjs:123` | oldest `queued` item = the item this wake will claim | must be the **shared `workable`** predicate (F12) |
   | `src/broker.mjs:972` | `LIVE_STATUSES = ["queued","claimed","deferred","held"]` | "non-terminal" for worktree reconciliation → `!isTerminal` |
   | `src/supervisor.mjs:72,84,114` | plans over `claimed\|queued`; **writes** `status="deferred"` | a **second writer** of status; must emit a well-formed `block` |
   | `src/watchview.mjs:33,34,38` | `claimed`/`queued`/`deferred` find | TUI projection |
   | `src/eventfeed.mjs:58,66,70` | `case "queued"/"claimed"/"deferred"` | event rendering |
   | `src/metrics.mjs:263` | `queue-ageing` counts `queued` | metric definition |
   | `src/seattools.mjs:85` | `to===me && status==="claimed"` | tool scoping |
   | `cli.mjs:2419` | `LIVE = ["queued","claimed","deferred","held"]` | CLI projection |
   | `src/attention.mjs:352,359` | `queued`/`deferred` filters | → `stage==="open" && !block` / `block.reason === "question"` |

2. **Risk.** A missed site is a silent mis-render or a silent mis-decision (the `metrics.mjs` one would
   keep counting an empty set forever; the `supervisor.mjs:114` one would write a status the new
   invariant rejects).
3. **Fix (concrete).** Add all of the above to §8. Centralise the mapping in ONE exported pair —
   `effectiveStage(item)` / `effectiveBlock(item)` (legacy `held`/`deferred` mapped here, nowhere else) —
   plus ONE `workable(item, seat)`. Then add an enforcement probe: a check rule (or a unit demo) that
   fails when `status === "held"` / `status === "deferred"` appears outside the mapping module.
4. **Probe.** P5 (the grep) — it must return only the mapping module after the change.

---

### F7 — MAJOR — §8 puts §4.1 propagation in `src/driver.mjs`, which has no store write path

1. **Defect.** §8's row is: `src/driver.mjs | selectWakes reads stage/block …; §4.1 evaluation on
   close`. But `driver.mjs` is a pure module over plain data: `selectWakes` is a pure function of
   `{seats, items, …}` (`src/driver.mjs:38-72`) and `driveOnce` submits *wakes to conversations*, not
   queue writes (`src/driver.mjs:138-183`). Giving it a `RigQueue` mutation would create a store write
   path outside the broker's single connection (D111/D112), or force the propagation to re-read the
   document.
2. **Where it must go.** The natural atomic site is the commit that *closes* the item — `complete_work`
   (`src/rig.mjs:545-585`) and `cancel_work` (`src/rig.mjs:856-877`) already run inside `api.commit`, and
   the whole queue document is already loaded in that transaction. The propagation is then atomic with
   the close: no window in which the gate is closed and the dependent is still blocked. The broker pass
   is the **recovery backstop**, not the primary: `drivePass` already loads the queue
   (`src/broker.mjs:1052`) and already writes in-pass (`reconcileStrandedSubmissions`,
   `src/broker.mjs:1061`, settling at `:704`).
3. **Fix (concrete).** Specify two layers: (i) **primary** — an in-transaction
   `releaseDependents(tx, closedId, at)` called from `complete_work`/`cancel_work` (and from
   `supervisor.mjs`'s escalation, which also closes nothing but must keep the invariant); (ii)
   **backstop** — a broker-pass sweep that re-evaluates any `dependency` block whose gates are all
   `done`, for the crash case. Idempotent: skip an item whose `block === null`; never change `to`; never
   re-wake an `active` item.
4. **Probe.** A demo that closes a gate and asserts the dependent is `open`+block-free **in the same
   commit** (i.e. an observer reading between the two commits never sees gate-closed/dependent-blocked),
   plus a crash-injection demo asserting the backstop sweep releases it on the next pass.

---

### F8 — MAJOR — §8 omits that `defer_work`'s QUESTION enqueue *is* the wake trigger

1. **Defect.** §8 says only that `defer_work`/`resume_work` "read/write `block.reason: question`". But
   the reason a seat-deferral is *not* stuck today is the side effect: `defer_work` enqueues a `QUESTION
   #<id>: …` item to the target seat (`src/rig.mjs:703-710`), and the driver wakes for that `queued`
   item. If the implementation treats the `block` as the whole mechanism and drops the QUESTION enqueue,
   the target is never woken and the seat-deferral path becomes the incident's shape.
2. **Second defect (a benefit the design should claim).** Today `resume_work` sets `status = "claimed"`
   (`src/rig.mjs:736`) even for an item the supervisor escalated from `queued` (never claimed) — a small
   lie that exists only to make the driver re-wake. Under `stage`+`block`, `defer_work` should leave
   `stage` **unchanged** and `resume_work` should simply clear the block; an `open` item then wakes via
   `hasQueued`, and the lie disappears. State this explicitly, or an implementer will reproduce it.
3. **Fix (concrete).** Keep the QUESTION enqueue; document that `block` is *metadata* and the QUESTION
   item is the *trigger*. Specify `defer_work`: set `block`, do **not** change `stage`; `resume_work`:
   clear `block` (restore nothing else).
4. **Probe.** `node demo/defer.test.mjs` must stay green, plus a new assertion that the QUESTION item is
   still enqueued when the park is expressed as a block.

---

### F9 — MAJOR — the new attention kinds are queue-scoped, but `computeAttention` is seat-scoped

1. **Defect.** §5 says the four kinds are "in the existing `{scope, seat, kind, detail}` shape". But
   `computeAttention` iterates **seats** and pushes only `scope:"seat"` notices
   (`src/attention.mjs:343-418`); its own contract notes that rig/queue-scoped notices exist with a null
   seat and that a per-seat renderer must exclude them **explicitly** (`src/attention.mjs:320-342`). The
   queue-scoped notices in the codebase live in `metrics.mjs` (`scope:"queue"`, `src/metrics.mjs:109`).
   `gate-cleared-unreleased` has no seat — it is about an item.
2. **Risk.** Smuggling a queue-scoped kind into the seat loop either requires a fabricated seat (mis-attributing
   the notice to a seat row) or makes the renderer drop it.
3. **Fix (concrete).** Add a separate pure `computeQueueAttention(queueItems, {nowMs})` returning
   `scope:"queue"` notices, merged by `readRigHealth` alongside `computeAttention`
   (`src/readapi.mjs:409`). Keep the seat loop's scope filter intact.
4. **Probe.** `node demo/blocked.test.mjs` (green today, P4) plus a new assertion that a
   `gate-cleared-unreleased` notice carries `scope:"queue"` and `seat:null`.

---

### F10 — MAJOR — the default legacy `reviewBy` fires `parked-review-due` on ~160 rows at once

1. **Defect.** §9 step 2 maps every legacy `held` row to `block: {reason: "manual", resolver: "pm",
   reviewBy: <now + grace>}`. Measured, that is **160 rows** (P1), 60 of which have no gate at all (P2).
   On the first watchdog pass after `grace`, all 160 emit `parked-review-due` — a wave that trains the
   operator to ignore the kind, which is the failure mode the redesign exists to prevent.
2. **Fix (concrete).** Two changes: (i) add a **`backlog`** reason (non-self-clearing, resolver `pm`,
   `reviewBy: null`) for the registration shape — the six reasons in §3 do not cover the dominant
   population (F2's class table); (ii) do **not** start enforcement (§9 step 4) until the §6 roadmap
   migration has shrunk the queue population, or set the legacy `reviewBy` far enough out that the first
   pass is bounded. Cap the number of `parked-review-due` notices reported per pass and report a total.
3. **Probe.** P1/P2 counts; a demo asserting a legacy backlog row does **not** produce
   `parked-review-due`.

---

### F11 — MAJOR — D114 does not exist

1. **Defect.** §5 and §12 cite "D114 (`waiting` derivation)" as a decision, and §5 folds the `waiting`
   headline into the redesign. `docs/DECISIONS.md`'s newest entry is **D112** (`docs/DECISIONS.md:3010`);
   a landing note reserves D113 for an unlanded scribe item ("D113 is taken (spool-op authorization,
   scribe-item-2219)", `docs/DECISIONS.md:3086`). `D114` appears **only** in the proposal and in `#2788`'s
   subject. There is no landed decision behind the `waiting` derivation.
2. **Risk.** The review cannot treat D114 as ratified context (the proposal leans on it in §5 and §11
   Q5); and a cross-cutting read-surface decision with no ADR is exactly what my role exists to catch.
3. **Fix (concrete).** Land the `waiting` derivation as an ADR (Status/Context/Decision/Consequences,
   ≥2 options) with the `block` model as its **source of truth**, so `status`'s headline, `queue
   --blocked` and `#2788`/`#2804` are ONE derivation, not three. Derive the next free D-number at land
   time (the file says not to hard-code it). See §4 (proposed ADR) — I drafted the decision text but did
   **not** land it, because the proposal is unruled and the number is not mine to mint.
4. **Probe.** P7: a grep for `D114` in `docs/DECISIONS.md` returns nothing.

---

### F12 — MAJOR — #2673's lead-ratified `workable` predicate is the same seam

1. **Defect.** `#2673` (deferred, "SEQUENCE AFTER THE BUGFIX CLUSTER"; lead-ratified definition at
   `#2677`) defines `workable(item, seat) := status==queued AND (requires empty OR seat advertises
   requires) AND every recorded gate resolves to DONE AND not fault-blocked`. The redesign's
   claimability rule is the same predicate over the new axes. Two predicates in two modules would
   violate R8 ("one fact, one place") and drift — the class this redesign exists to remove.
2. **Second defect in #2673's own definition.** Its `requires` clause cannot be evaluated from the item:
   `requires` is **not persisted** (P2 — absent on all 2,988 items; used only at send time,
   `src/rig.mjs:393`). Clause 4 (fault markers) is likewise conditional on a field that does not exist.
   So `workable` as ratified is not yet implementable as written, and the redesign must not assume it is.
3. **Fix (concrete).** The redesign owns ONE `workable(item, seat)` over `(stage, block)` + `requires`;
   `#2673` becomes its implementation (or is absorbed). Because `#2673` is lead-ratified, this is a
   **scope question, not mine to decide** — route it to `lead` with both definitions side by side. Do not
   let the two land independently.
4. **Probe.** P5's grep plus a demo that the `claim_work` selection, the wake predicate and the
   `broker.mjs:123` context-boundary item all call the *same* function.

---

### F13 — MINOR — "the non-terminal set is tiny (~180)" understates the real unit

1. **Defect.** §4.1 justifies the per-close scan with "the set is tiny (~180 rows today)". The *filter
   result* is small (188 measured), but the queue is a **single document**: `tx.doc(RigQueue)`
   (`src/rig.mjs:202`) materialises all 2,988 items with their `transitions`; the broker-served snapshot
   is **10.4 MB** (P1). You cannot scan the non-terminal set without materialising the document.
2. **Why it still doesn't change the decision.** A maintained reverse index would be a **second**
   document plus a second write per close — precisely the drift class the redesign exists to remove. So
   §4.1's *conclusion* is right; only its reason is wrong. Correct the reason, and note that doing the
   propagation **in the closing commit** (F7) adds no extra materialisation at all (the doc is already
   loaded), which is a second argument for F7.
3. **Fix.** Reword §4.1; record the single-document cost model in `WORK-ITEM-LIFECYCLE.md` as the real
   scaling limit (the scan is not the limit; the one-document queue is).

---

### F14 — MINOR — §9 step 1 and step 2 give two mappings for the same legacy status

1. **Defect.** §9 step 1: `held:true` becomes "a deprecated alias for `block: {reason: "schedule",
   resolver: "pm", reviewBy: <default>}`". §9 step 2: a legacy `held` row reads as `{reason: "manual",
   resolver: "pm", reviewBy: <now + grace>}`. A row created with `held:true` today and read tomorrow maps
   to `manual`, not `schedule` — the same status means two different things depending on the path.
2. **Fix.** One mapping. `held:true` must produce exactly the legacy mapping (`manual`/`backlog` per F10)
   so there is one answer for one stored status; the alias is then purely a write-side convenience.
3. **Probe.** A demo that writes `held:true` and asserts the read-back block equals the legacy-mapped
   block.

---

### F15 — MINOR — §7's `gate-not-cancelled` false-positives on the re-registration rows

1. **Defect.** §7 adds `gate-not-cancelled` (fix-now) when "`blockedBy` cites a `cancelled` item". The
   live store has a family of rows that cite a cancelled item **as provenance, not as a gate**: `#2618`
   "re-registration of cancelled #61", `#2619` (#62), `#2620` (#63), `#2621` (#164), `#2622` (#1108),
   `#2623` (#2041), `#2624` (#2055), `#2625` (#2066), `#2626` (#2097), `#2627` (#1929), `#2628` (#1930)
   — 11 rows, all in the measured orphan-candidate list (P3). Under a prose-derived `blockedBy` they all
   fire `gate-cancelled`/`gate-not-cancelled`.
2. **Fix.** Fire only for a **declared** `dependency` block (`block.source === "declared"`, F2) whose
   `blockedBy` target is `cancelled`. Never infer a gate from prose (which is also F2's fix).
3. **Probe.** P3 lists the 11 re-registration rows; the rule must not fire on them.

---

### F16 — MINOR — no observability for the one irreversible action the design adds

1. **Defect.** §4.1 auto-open is the only new action that changes state without a human, and it causes a
   **wake** (real model work, real cost). The broker logs its other autonomous writes
   (`STRANDED settled=N` `src/broker.mjs:1063`; `WAKE <seat>` `:1408`; `CONTEXT-BOUNDARY …` `:1092`), but
   §4.1 specifies no log line.
2. **Fix.** Emit `AUTOOPEN released=<n> items=#…` once per pass, and put the gate ids into the proposed
   `released-by-gate` transition (§4.1) so a released item's *why* is recoverable after the fact. An
   irreversible action must be checkpointed or idempotent; auto-open is idempotent (skip a cleared
   block) **and** should be logged.
3. **Probe.** A demo asserting the broker log line appears with the item ids when a gate closes.

---

### F17 — MINOR — `claim_work`'s stalled-claim reveal and `peek_queue` must exclude blocked items

1. **Defect.** `claim_work`'s stalled-claim path reveals "my OLDEST `claimed` item"
   (`src/rig.mjs:502-511`) — under the new model an `active` item may carry a `question` block, and
   handing a seat an item it is waiting on is wrong. `peek_queue`'s non-terminal filter
   (`src/rig.mjs:904`) must likewise distinguish "non-terminal" from "claimable".
2. **Fix.** The stalled reveal requires `stage==="active" && block===null`. `peek_queue` keeps returning
   blocked items (that is useful) but must project `stage`/`block` so a reader can tell them apart.
3. **Probe.** A demo: a seat with an `active`+`question` item and no queued work gets `NO_QUEUED_WORK`,
   not the blocked item.

---

## 3. Answers to the seven review questions

1. **Invariant anchor — right anchor, wrong statement.** The anchor (a park must name its resolver) is
   right; §1 as written is not a partition and §2's mapping contradicts it (F1). Fix: separate
   item-level well-formedness from per-seat claimability.
2. **Two axes vs the §10 alternatives — two axes is right; its own failure mode is that the block becomes
   the single point of truth and is therefore a single point of *error*.** A wrong `blockedBy` auto-opens
   wrongly (F2, F3); a missing `reviewBy` on a `dependency` hides a stuck chain (F4); a `reason` that
   cannot express a compound park silently drops one constraint (F3). The rejected alternatives are
   correctly rejected (more statuses add no resolver; a separate ledger drifts; a prose scanner is unsafe
   — and F2 shows the backfill re-introducing the third).
3. **Auto-open scoped to `dependency` — correct in principle, insufficient as specified.** (a) Two gates
   closing in one pass: fine, and idempotent **if** auto-open skips an already-cleared block — specify it.
   (b) A gate closing while the dependent is concurrently claimed: impossible while a blocked item is
   unclaimable, and the write serialises on the broker's single connection; but the model must state that
   auto-open never changes `to` and never touches an `active` item. (c) A gate closing while the
   dependent has a *second* constraint is the unsafe case (F3). (d) Scanning per close is **adequate**;
   a reverse index is not required and would be worse (F13) — but the reason is the single-document
   queue, not "the set is small". (e) A `dependency` on a roadmap gate has no trigger at all (F5).
4. **Block vocabulary — does not partition cleanly.** The six reasons do not cover the measured
   population: 60 gate-less rows, 41 landing-list rows, and 16 registered/7 roadmap-registration rows
   have no honest home (`manual` is a lie for a backlog registration and, with a `reviewBy`, a recurring
   alarm — F10). Add `backlog` (and, if F5 is adopted, `roadmap-gate`). And yes: **`blockedBy` must accept
   `RM` ids** — RM-R4 already says so on the roadmap side, and 9 held rows are roadmap-gated (F5).
5. **Overlap with #2673 and D114.** #2673 is the *same seam*, lead-ratified, and its predicate is not
   implementable as written because `requires`/fault markers are not persisted (F12) — the redesign must
   own one `workable`, and because lead ratified #2673 this is a **scope escalation to lead**, not a
   decision for the delegate or for me. D114 does not exist (F11), so §5's `waiting` derivation has no
   ADR and must be landed (or the citation dropped) with the block model as its source. `#2788`/`#2804`
   (both held) should be re-scoped onto that single derivation rather than the redesign inventing a
   second.
6. **Enforcement seams — `checkup.mjs` is the right place for the rules; the attention kinds are
   read-only-safe but seat-scoped-shaped.** `auditRig` is a pure function over plain data that already
   takes `queueItems` (`src/checkup.mjs:301`, `:595`), and `check` is a read verb — adding five rules
   there is correct and cannot write. But note the asymmetry: **the check rule is a regression test for
   the invariant, not a watchdog** — it fires only when someone runs `check`; the *watchdog* is the
   attention kind, which `status`/`watch` derive read-only (D111-safe). Say which is which in §7. The
   kinds themselves need a queue-scope home (F9).
7. **Schema migration — the hazard is the backfill, not the volume.** 2,988 legacy items are not the
   problem (lazy migration is right); the problem is that `blockedBy`/`kind`/`roadmap` have **never
   existed** (0/2,988 — P2), so §9's "read both" is a first introduction, and steps 3+5 re-introduce the
   rejected prose scanner (F2), step 1 vs 2 disagree (F14), and the default `reviewBy` fires on ~160 rows
   at once (F10). Fix the *source* field (F2), make the mapping single-valued (F14), and sequence
   enforcement after the population is classified (F10).

---

## 4. Proposed ADR (draft — lands only on `lead`'s ruling; number derived at land time)

> **D-? — A park is a typed `block` with a resolver and a trigger; the queue has two axes
> (`stage` × `block`).**
> **Status.** Proposed (architect, item #2984). Not landed: the underlying proposal is unruled, and the
> next free D-number must be derived from `docs/DECISIONS.md` at land time (D113 is reserved by an
> unlanded scribe item).
> **Context.** `held` is a park that must name no reason, no resolver, and no review date; its gate is
> prose. Measured: 160 `held` rows, median age 15.9 h, 60 with no gate at all, 59 whose cited gates are
> all terminal; the incident's live instance (`#2630`) is invisible (F4). The schema's own `blockedBy`
> field (R5) is unimplemented on all 2,988 items.
> **Decision.** Adopt the two-axis model with the five corrections above (F1–F5): (1) well-formedness
> stated over `(stage, block)`, claimability a separate per-seat `workable(item, seat)`; (2)
> `block.source: declared|legacy`, and only a `declared` `dependency` auto-opens; (3) a `block` may carry
> more than one constraint, and auto-open requires *every* constraint satisfied; (4) every `dependency`
> carries a `reviewBy`, and a `gate-stalled` kind covers a stuck chain; (5) `blockedBy` resolves two
> namespaces (`#<n>` and `RM-<n>`) and an `RM` gate is never self-clearing. One exported
> `effectiveStage`/`effectiveBlock` mapping, one `workable`, propagation in the closing commit with a
> broker-pass backstop.
> **Consequences.** (+) The orphan state becomes unrepresentable *and* checkable; one predicate for
> claimability; the read surface (`status`, `queue --blocked`, `waiting`) is one derivation. (−) A new
> field on 2,988 legacy rows (lazy), a new invariant to enforce, and ~11 files to re-point at the
> mapping. (−) Risk: a wrong `block` now has behavioural consequences (auto-open), so the declaration
> path must be the only path that can create a `dependency`.
> **Options considered.** (A) the two-axis model with the corrections above; (B) more statuses
> (`blocked`/`waiting-operator`/`backlog`) — rejected: multiplies states without supplying a resolver;
> (C) a separate blocked-ledger document — rejected: a second source of truth that drifts (the class the
> redesign removes); (D) a prose-scanning unsticker — rejected: false positives on window/roadmap parks
> (F2's 59 rows are the proof). A and B are the two genuine contenders; A wins because the *reason* and
> the *resolver* are data either way, and A keeps the four familiar states as views.

---

## 5. Probes (falsifiable; `P*` = I ran it, with the result)

| Probe | Command | Result |
|---|---|---|
| **P1** ✅ | `DURIG_DB=./selfdev.sqlite node cli.mjs queue` → histogram / age / class counts (broker-served, D111) | 2,988 items; 188 non-terminal; held 160 (median 15.9 h, 49 >24 h); 60 gate-less; 9 roadmap-gated; 37 chained; 59 orphan candidates; snapshot 10,412,547 B |
| **P2** ✅ | field-presence over the same snapshot | `blockedBy`/`kind`/`roadmap`/`requires`/`block` present on **0** items; `heldReason` on 96 |
| **P3** ✅ | held rows whose cited queue gates are all terminal, with subject class | 59 rows; classes: landing-list 41 / backlog 36 / do-not-start 20 / registered 16 / other 28 … |
| **P4** ✅ | `node demo/held-item.test.mjs` and `node demo/blocked.test.mjs` | exit 0 / exit 0 (baseline the change must keep green) |
| **P5** | `Select-String -Path src/*.mjs,cli.mjs -Pattern '"held"\|"deferred"\|"queued"\|"claimed"'` | **today**: 30 sites / 11 files (F6). **Target**: only the mapping module |
| **P6** | new `demo/queue-lifecycle-invariant.test.mjs`: assert the §3 well-formedness predicate over every non-terminal item in a fixture store | RED at HEAD (naive `active ⇒ block-free`), GREEN after |
| **P7** ✅ | `Select-String -Path docs/DECISIONS.md -Pattern 'D114'` | no match (F11) |
| **P8** | new demo: a gate closes; an observer reading the store **between** the close and the next pass never sees gate-closed + dependent-blocked | proves F7's atomicity |

---

## 6. Disposition

- This document is the review of record. It is **not** a decision: the proposal is `lead`'s and the
  operator's to rule on, and §4 above is a draft ADR, deliberately unlanded (F11).
- **Escalate to `lead`** (scope, not mine to decide): F12 (#2673's lead-ratified `workable` vs the
  redesign's claimability — one predicate or two) and §11 Q5 of the proposal (ordering vs the standing
  reliability cluster).
- **Hand to `pm`** for routing to the delegate (proposal owner): F1–F5 are blockers to fix *in the
  proposal* before it is implemented; F6–F17 are change requests.
- Recommended sequencing, consistent with the proposal's own §11 Q5: land the **read-only** half first
  (`check` rules + queue-scope attention kinds, F9), because it cannot strand anything; hold the
  `rig.mjs`/`driver.mjs` axis change behind the bug-fix cluster; and make F2's `block.source` gate part
  of the axis change, not an afterthought.

## 7. Limits (what I did not review)

- I did not verify the proposal's `~51` orphan figure as an independent number; my heuristic (which also
  reads `heldReason`) yields 59. The gap is the haystack and the gate regex, and the doc itself warns the
  candidate list contains false positives — which is F2's point.
- I did not read `docs/BROKER-ARCHITECTURE.md` / `docs/BROKER-SUPERVISION.md` in full for this review;
  the broker claims above come from `src/broker.mjs` directly.
- I did not run the full demo suite (only the two demos that exercise the current held/attention
  behaviour, P4). No implementation exists yet, so there is nothing else to run.
- Line numbers are as of `main` @ `6875bc8`; the shared tree is live, so re-run the probe before acting.

---

## 8. Closure — v2 disposition (item #3005)

The proposal owner adjudicated all 17 findings in
[`queue-lifecycle-redesign.md`](queue-lifecycle-redesign.md) **v2** (`defbc34` on `main`), §13. Method:
I read v2 §1–§13 and checked each disposition against the **v2 text**, not the §13 table (a disposition
row that names a section which does not actually contain the change is a finding in its own right — see
R3).

**Confirmed fixed (13): F2–F16.** Each landed in the named place and reads correctly:

| Finding | Landed in v2 | Confirmed because |
|---|---|---|
| F2 | §3 `block.source`, §9.3 | only a `declared` `dependency` auto-opens; prose → `block.note`, never `blockedBy`; §9.5 corrected to visibility |
| F3 | §3 `constraints[]`, §4.1 | auto-open requires **every** constraint to be a done queue gate |
| F4 | §3 `dependency.reviewBy`, §5 `gate-stalled` | `#2630` now gets a clock **and** a kind |
| F5 | §3 two namespaces, `roadmap-gate` | `RM-<n>` is not self-clearing |
| F6 | §8 full 11-file table + mapping pair + lint | matches my measured site list |
| F7 | §4.1 closing commit + pass backstop | `driver.mjs` explicitly keeps no write path |
| F8 | §4.1 | QUESTION enqueue stays; `block` is metadata; `stage` unchanged |
| F9 | §5 `computeQueueAttention` merged in `readRigHealth` | no queue notice in the seat loop |
| F10 | §3 `backlog` (no clock), §9.2 far-out, §5 cap | the 60 gate-less rows get no clock |
| F11 | §11.7 | citation withdrawn; ADR to be landed or dropped |
| F12 | §11.6 | escalated to `lead` |
| F13 | §9 cost note | the unit is the 10.4 MB document |
| F14 | §9.1/§9.2 | one mapping for one stored status |
| F15 | §7 | `gate-not-cancelled` on a declared `dependency` only |
| F16 | §4.1 | `AUTOOPEN` log + `released-by-gate` |

**Not fully incorporated — 4 residuals.** Each is small and lives in the normative statement or the
legacy mapping; none is structural, and none reopens the mechanism.

#### R1 — BLOCKER — (W) as written excludes `active` + `block: null`, i.e. the normal claimed item

v2 §1: *"Every non-terminal item is `(stage === "open" && block === null)` **or** `block !== null` …"*.
A `claimed` item is `stage: active, block: null` (v2 §2's own mapping table). It satisfies **neither**
disjunct: the first demands `stage === "open"`, the second demands `block !== null`. So the invariant
fails on the most common non-terminal shape, and any check derived from it fails on every claimed item.
v1's `(b) active` case was dropped in the rewrite.

**Fix.** Restate (W) as a disjunction over `block`, with `stage !== "closed"` implied by "non-terminal":
`block === null` **or** (`block !== null` ∧ `block.resolver != null` ∧ (exempt(`block.reason`) ∨
`block.reviewBy != null`)). `active` + `block: null` then satisfies it, as does `open` + `block: null`.

#### R2 — MAJOR — `SELF_CLEARING` is undefined, and §1 disagrees with §3/§7 about `question`

v2 §1 exempts a block from `reviewBy` when "its reason is self-clearing"; §3's table marks `question`'s
`reviewBy` as **n/a**; §7's `item-park-reviewby` exempts "self-clearing/`backlog`". `SELF_CLEARING` is
never defined, so §1 (which would require a `reviewBy` on a `question` block unless `question` is
self-clearing) and §3/§7 disagree. The answer flow is external, not automatic, so `question` is not
"self-clearing" in the strict sense — yet it must not carry a clock.

**Fix.** Define the exemption set **once** and use it in §1, §3 and §7:
`REVIEWBY_EXEMPT = new Set(["dependency", "question", "backlog"])` (equivalently `SELF_CLEARING =
{"dependency","question"}` ∪ `backlog`). State that `question` is exempt because its trigger is the
QUESTION enqueue (§4.1), not a clock.

#### R3 — MAJOR — F17's disposition cites §8, but §8 does not contain the change

§13's F17 row says **A** — "§8 (`seattools`, `peek_queue` projections)". §8's `src/rig.mjs` row names
the eight tools, the QUESTION enqueue and `releaseDependents`; it does **not** name `claim_work`'s
stalled-claim reveal (`src/rig.mjs:502-511`) or `peek_queue` (`src/rig.mjs:904`). The only §8 row
resembling it is `src/seattools.mjs:85` → `stage==="active"`, which is a different site. So F17 is
dispositioned as accepted but is not actually incorporated.

**Fix.** Add to §8's `src/rig.mjs` row: (a) `claim_work`'s stalled-claim reveal requires
`stage==="active" && block===null` (never hand a seat an item it is waiting on); (b) `peek_queue`
projects `stage`/`block` and must still **list** blocked items (it is an oversight view, not a claim
path).

#### R4 — MAJOR — §2's `deferred` → stage mapping is not derivable from the stored transitions

§2 says a `deferred` row's stage is "unchanged (`active` if the holder deferred; `open` if the supervisor
escalated an unclaimed row)". But `applyEscalations` (`src/supervisor.mjs:114`) writes `status="deferred"`
with a transition `{event:"deferred", by:"supervisor"}` (`:119-120`) and records **neither** the prior
status **nor** whether the item was claimed. `planEscalations` escalates items that were `claimed` **or**
`queued` (`src/supervisor.mjs:72`), so the `by:"supervisor"` marker alone cannot decide the stage: a
supervisor escalation of a **claimed** item must map to `active` (the holder still owns it and will
`resume_work`), of a **queued** item to `open`. `effectiveStage(item)` therefore has no correct input, and
F1's fix is not testable until this is specified.

**Fix.** Have `applyEscalations` record the stage it escalated from (`fromStage: "open"|"active"`,
known from `item.status` before the write) and have `effectiveStage` read it; or, equivalently, derive it
from the transition log (last `deferred` preceded by a `claimed` event by `item.to` → `active`, else
`open`). The first is cheaper and unambiguous — prefer it. Add the supervisor row's `fromStage` write to
§8.

**Minor observations (no disagreement, for the record).**

1. **A compound park is now `operator`/`schedule` with a queue constraint**, so its cleared queue gate
   emits **no** `gate-cleared-unreleased` (§5 defines that kind for a declared `dependency` only). That is
   correct — the window is the binding constraint and `parked-review-due` is its trigger — but state it in
   §5, or a reader will look for the gate kind and not find it.
2. **The §7 rule id `blockedBy-resolves` now resolves `constraints[].ref`**; the id is a stable API, so
   keep it, but note in §7 that `blockedBy` is no longer a field name.
3. **`orphan-no-progress` is redefined to `block === null`** (§5) — an unblocked item going stale. For a
   `queued` item that overlaps `idle_with_queued_work` (seat scope). Keep both (queue scope catches a
   blocked-free stale item whose seat is gone); note the overlap so a reader does not dedup them.
4. **(W) is forward-only** (authored state, §1 + §7): the 2,988 legacy rows are policed by attention, not
   by `check`. Accepted — it is what keeps a red `check` from stopping landings (advocate CR-1) — but it
   means the invariant is *not* yet true of the store; say so in §1 so the claim is not read as a
   present-tense property.

**Verdict.** v2 is sound. R1–R4 must be folded in before implementation (all four are one-line
normative/mapping corrections), and F12/F11 remain `lead`'s calls. No other disagreement; my F2/F3/F4
concerns — the ones that could have made the design unsafe — are correctly fixed.
