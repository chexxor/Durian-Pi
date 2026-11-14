# Review #6502 — the gate has four readers and no exit

**Seat:** architect. **Item:** #6502 (pm's decomposition of #6469: #6497 shared validator, #6498 gate state in the queue line, #6499 cancel propagation, #6500 verification).
**Tree measured:** `item-6502` @ `9ae345df`. `src/rig.mjs`, `src/heldgate.mjs`, `src/queue-lifecycle.mjs`, `src/checkup.mjs` are byte-identical between that tip and `main` (`git diff --stat HEAD main -- src/...` shows only `src/driver.mjs` differing), so every line anchor below is valid on main too.
**Probe:** `node tools/probes/gate-predicate-disagreement-6502.mjs` → **exit 1** (5 FAIL lines, 1 PASS). Every number in this review comes from that run or from the cited `path:line`.

## The deeper read

The three rows ask for three features. The system-level defect they will not fix is that **"is this gate closed?" is answered by four predicates that disagree on one word — `cancelled`** — and none of the three rows names the shared one. Adding a validator (#6497), a status render (#6498) and a report (#6499) without a single source adds a fifth and sixth reader of the same question. A gate rule that lives in five places drifts; that is the class, not the symptom.

Topology of the gate seam, as it stands:

| site | what it reads | verdict for a gate naming a **cancelled** row |
|---|---|---|
| `src/rig.mjs:320` `workable()` (claim + wake) | `item.blockedBy` | NOT workable, permanently — `gate-cancelled:#<id>` (`:332`) |
| `src/rig.mjs:312` `deadGateId()` (release guard, used at `:1346`) | `item.blockedBy` | release REFUSED |
| `src/heldgate.mjs:19` `TERMINAL_STATUSES = {"done","cancelled"}` (classifier at `:134-135`) | `facts.statusOf(id)` | CLOSED → class `release-candidate` |
| `src/queue-lifecycle.mjs:310` legacy stage mapping | status | `"closed"` |
| `docs/WORK-ITEM-SCHEMA.md:114` (R5) | prose rule | "must resolve to a terminal `done`; a `cancelled` gate is a `gate-cancelled` finding, not a pass" |

Two of those say "closed", one says "never satisfied", and the schema says a `cancelled` gate is a finding, not a pass. The probe runs both predicates on the same row and prints the disagreement; it is not a reading exercise.

## Finding 1 — the audit instrument advises an action the broker refuses

**Defect.** `classifyHeldRow()` calls a held row with a cancelled gate a `release-candidate` ("every gate it names is done or cancelled; nothing else parks it", `src/heldgate.mjs:196`), while `release_work` refuses exactly that release (`src/rig.mjs:1346-1348`: "its gate names #<id>, which is cancelled"). Measured: same child row → `class=release-candidate`, `deadGateId()=100`, `workable()` after release → `{workable:false, reason:"gate-cancelled:#100"}`.
**Failure mode (contradiction):** pm reads the audit, releases the row, the broker refuses, the row stays parked, and the operator sees two tools disagreeing about the same row. The row is neither released nor reported as un-releasable — it is invisible in the wake path because `selectWakes` uses `workable()` (`src/driver.mjs:86-90`).
**Recovery path (available today, unexercised):** `cancel_work` on the dependent with a reason, which is terminal and notifies the other party (`src/rig.mjs:204-236`).
**Concrete fix:** export ONE predicate — `gateState(item, items) -> [{id, state: "done"|"open"|"cancelled"|"unknown"}]` — and make `heldgate`, the release guard, `workable()` and the queue line call it. A row whose only remaining gate is cancelled gets its own class (`gate-dead`) whose recommended action is repair-or-cancel, never release. Add the class name to `CLASSES` (`src/heldgate.mjs:22`) so the demo pins it.

## Finding 2 — a gate has no exit, so a stranded row is stranded forever

**Defect.** `normalizeBlockedBy` is called in exactly two places (`src/rig.mjs:391` definition, `:778` in `send_work`), and there are **0** sites in `src/rig.mjs` that re-write or clear a stored row's `blockedBy` (probe §2). Ids are assigned monotonically (`src/rig.mjs:442`, `const id = queue.nextId++`), so a gate can only ever name a smaller id. Live mirror: **1,216 non-terminal rows, 194 with a structured gate, 96 of them naming an id the mirror does not list** (terminal or never-existing).
**Failure mode (cascade + loop):** a cancelled parent poisons every dependent; the dependents are permanently unclaimable, never wake anyone, and accumulate in the queue as `queued` rows that neither seats nor the driver can advance.
**Options and the one I accept:**
- (a) treat a cancelled gate as satisfied at read — REJECTED: it makes a dropped prerequisite silently pass, which is precisely what `gate-cancelled` was introduced to prevent (#2673 refinement 3, `docs/WORK-ITEM-SCHEMA.md:114`).
- (b) a gate-EDIT verb (add/remove/re-gate on a queued row), authority limited to the row's two parties — ACCEPTED as the durable fix. It is reversible (a gate can be re-added), it is bounded (only parties), and it is the only shape that lets Finding 1's `gate-dead` class have a legal action.
- (c) auto-cancel the dependents — REJECTED: `cancel_work` is terminal and destroys the intent; a cancelled parent is not evidence the child's work is unwanted.
**Scope note:** (b) is a scope decision, not an implementation detail. It is routed to `lead`, not decided here.

## Finding 3 — #6497's acceptance cannot be built as written

**Defect.** #6497 says `validateGate(blockedBy, items, selfId)` is "called from BOTH `enqueueWork` and `reviseWork`", and its verification row #6500 requires a demo showing the same `[9999]` gate "refused by both paths". Neither named function exists: `src/rig.mjs` defines `enqueueItem` (`:427`); the revise verb is `revise_work` whose parameter list is `itemId, subject, body` — it has no gate parameter (probe §3). There is no gate on the revise path to validate.
**Failure mode (silent):** the impl seat either invents a parameter (scope creep) or writes a test that passes vacuously, and the guarantee "two validators cannot disagree" is recorded as delivered while nothing enforces it.
**Concrete fix:** rewrite the row's acceptance against the real seam: validate at `src/rig.mjs:778` (before the commit, the same ordering as `normalizeBlock`, so a bad gate is a legible refusal and never a half-written item), and assert ONE path plus a store-level scan that reports rows whose gate is unresolvable. If `lead` authorizes gate edits, the validator is called from the edit verb too — that is where "both paths" becomes real.

## Finding 4 — the cycle leg is dead code today

**Defect.** A cycle requires an edge from a higher id to a lower one. Ids are monotonic (`src/rig.mjs:442`), and the live mirror has **0** gates naming an id ≥ their own row id (probe §4). Self-gate is likewise impossible at mint: a new row cannot reference an id that does not exist yet — it is caught as a dangling reference.
**Failure mode (loop, latent):** the cycle check is only reachable once a gate-EDIT verb exists. Shipping it now costs an O(n) walk per enqueue for a condition that cannot occur, and a demo that constructs a cycle would be constructing a store state the public tool surface cannot create.
**Concrete fix:** keep the bounded walk (`steps <= items.length`) but state it as future-proofing for Finding 2's edit verb; the cycle assertion belongs in a demo that builds the graph directly (pure function input), not as a claim about the rig.

## Finding 5 — #6498 must not become a fifth predicate

**Defect.** `queueItemLine(it)` (`src/rig.mjs:365`) receives one row and is called as `filtered.map(queueItemLine)` inside the commit (`:1478`). Rendering `blockedBy=<id>(done)` requires resolving ids; done naively that is a second resolution path, and the precedent is #6186 — the wake predicate and the claim predicate diverged because one of them resolved gates on its own.
**Failure mode (contradiction + context):** a seat reads `blockedBy=#1200(done)` in its queue line, tries to claim, and is refused with `gate-open:#1200(held)`. A display that lies is worse than a display that says nothing.
**Concrete fix:** build ONE status map inside the same commit — `const statusOf = new Map(queue.items.map((it) => [it.id, it.status]))` — pass it to `queueItemLine(it, statusOf)`, and render an unresolvable id as `(unknown)`, never omit it and never default it to `(done)`. The conservative read default (#2673) stays: the line displays, it does not decide.

## Finding 6 — #6499's "propagation" reaches only one party

**Defect.** `cancelItem` notifies a single counterparty (`src/rig.mjs:208-224`): the sender when the recipient cancels and vice versa. Nothing names the dependents. `src/checkup.mjs` contains **0** references to `blockedBy`, so "the `check` rule must report rows gated on terminal ids" has no rule to amend — it is a new rule with no home.
**Failure mode (silent partial):** a parent with five dependents is cancelled; one seat is told, four are not. Those four discover it only when they try to claim, and the driver never wakes them (`src/driver.mjs:86-90`), so the strand is invisible until a seat happens to look.
**Concrete fix, bounded:** in `cancelItem`, collect `queue.items.filter((x) => (x.blockedBy ?? []).includes(item.id))` and put the ids in the notice body — capped (say 20 ids, then "… N more") so a parent with hundreds of dependents cannot produce an unbounded notice. Emit ONE notice, not one per dependent (the notice chain is already bounded by `isNoticeItem`, `src/rig.mjs:256-262`). The check rule gets a named home and a name: `stranded-gate` in `src/checkup.mjs`, reporting per-seat counts of non-terminal rows whose gate is `cancelled` or unresolvable, and never feeding a decision — observation only (the audit-sink rule from D258).

## What I would land first

1. Export `gateState()` and make all four readers call it. Cheapest, reversible, and it removes the class before any new verb is needed.
2. Mint the `gate-dead` class in `heldgate.mjs` (one new class, demo-pinned) so the audit stops advising releases the broker refuses.
3. Mint the `stranded-gate` check rule with a bounded report.
4. Only then the write-time validator (#6497), scoped to the one path that can write a gate.
5. The gate-EDIT verb last, after the `lead` ruling, because it is the only change that makes Finding 2 recoverable.

## Falsifiable gate

The probe exits 0 only when: `gateState` is exported; the classifier no longer labels a cancelled-only gate as `release-candidate`; at least one verb can clear a gate; `revise_work` (or the edit verb) carries a gate; and `checkup.mjs` mentions `blockedBy`. Run it before and after the change and name the exit codes.

## Follow-ups routed

- pm: #6574-series amendment rows for #6497, #6498, #6499 (this review is the input).
- lead: two rulings — (1) does a queued row get a gate-edit verb, and who may use it; (2) is a `cancelled` gate "closed" or "open" in the vocabulary of every instrument? Both are recorded in `docs/DECISIONS.md` as provisional.
