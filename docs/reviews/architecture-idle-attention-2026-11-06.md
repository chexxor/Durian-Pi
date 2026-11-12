# ARCHITECTURE DESIGN NOTE — a seat's attention states, what each one pays, and why idle must never reset context

Item **#5211** (from `lead`, ROADMAP **313**). Docs-only: this note changes **no number and no knob**
(lead's constraint; the operator's ordering ruling is recorded at `docs/DECISIONS.md:9594` — *backoff
before capacity*). It is the policy that makes 314/316/317 buildable. Durable decision: **D222** in
`docs/DECISIONS.md`. Operator-facing copy of the table belongs in `docs/SELFDEV.md` (ROADMAP 313's own
wording, `docs/ROADMAP.md:6104`) and is routed as a separate small item, not folded into this note —
per **D221**, the policy note and the runbook surface have different acceptance checks.

## 0. Why this is a design problem and not a tuning problem

Measured, one bounded pass (pid 438500, 01:04:48→01:33Z 2026-11-06, `docs/ROADMAP.md:6022-6042`):
`pi.reset **1,406**` against `pi.user 366` / `pi.assistant 331`; broker stderr escalations
`scribe:degeneration 592`, `devtools:degeneration 481`, `pm:degeneration 458`; `passes=1245
escalated=1394`; idle cost **~$0.17/h** of verifier-arm spend (249 calls, $0.08565 in that window);
**53 calls returned ≤5 completion tokens**. And `lead` took **31 resets** in the same window, so a
ruling delivered to `lead` was wiped from the only seat able to act on it before it acted.

The ratio that makes this architecture, not tuning: **1,406 resets against 331 assistant turns** — the
rig resets a seat's context ~4x more often than it lets the seat say anything. A seat therefore has no
stable state to be in: it is either generating or being reset. The rig has sensors for many conditions
and actuators for two (reset, defer-to-human), and no named state between them. Every capacity knob
multiplies that storm, which is exactly why the operator gated the whole capacity family on this row.

## 1. THE STATE TABLE — the deliverable

Each row: how the state is *entered today* (with the file:line that owns it), what the rig does on the
seat's behalf, who is woken, what is counted, and what the state costs. States the rig cannot currently
distinguish are named anyway, because the table is the contract the code should converge on.

| # | State | Entered when (owner of the transition) | What the rig does | Who is woken | What is counted | Wall-clock cost | Counted context cost |
|---|---|---|---|---|---|---|---|
| S1 | **working** — a run is in flight | a submission is admitted and a harness starts a run; `src/inflight.mjs:1-35` is the only seam that sees it before it settles | watches the live event stream (`watchEvents`), bounds the turn | nobody else | `turnDurationMs`, streamed tokens, pattern matches (`matchTextPatterns` at `src/inflight.mjs:85`) | unbounded until the in-flight bound trips | grows with every turn; the seat's own window is the only ceiling |
| S2 | **settled-and-empty (idle)** — nothing claimable, nothing parked | the driver finds no claimable item and sends the no-work text (`src/driver.mjs:55`), reporting `SKIP reason=no-work` (`src/driver.mjs:143`) | **nothing today** — and that is the finding; it should hold the seat asleep until the queue changes | nobody (correctly); but the pass re-wakes it next pass | pass count (`passes=`, `src/broker.mjs:2224`; the `escalated` diagnostics at `:2035`) | one full wake + provider call **per pass**, forever | a fresh prompt **every wake** (system + persona + tools + queue payload) paid for a turn whose answer is "nothing to do" |
| S3 | **queued-unseen** — work addressed to a sleeping seat | `send_work` commits a queue row; `idle_with_queued_work` fires only when the last run settled and nothing is in flight (`src/attention.mjs:7-9`, emitter `:532`) | a pass wakes the seat | the seat | notice count | one pass interval | a normal turn |
| S4 | **admitted-not-started** — input committed, no run ever began | the harness was killed mid-flight; notice at `src/attention.mjs:15-18`, emitter `:521`, threshold `STRANDED_ADMITTED_MS = 30_000` (`src/attention.mjs:41`) | reports; **acts on nothing** | the operator, via `status` | age of the admitted entry | the queue stalls for as long as nobody restarts the harness | none yet (no tokens burned) — this state is cheap and that is why it hides |
| S5 | **parked by the seat (held)** — seat cannot proceed, no question for anyone | `hold_work` → item `status:"held"`, unclaimable until `release_work` | excludes it from the claim slot; the driver's no-work text names parked rows (`src/driver.mjs:55`) | nobody until release | held-item count | until release (correct) | a wake that re-derives "still parked" each pass — S2's cost with S5's cause |
| S6 | **waiting-on-gate** (`blockedBy` unmet) | the item declares `blockedBy:[ids]`; the broker treats a non-advancing task as owning nothing (`src/broker.mjs:934`, `advancingConvIds` at `:944`) | skips it | nobody while gated | skipped-item count | until the gate closes | today: the same wake-as-if-there-was-work cost as S2 |
| S7 | **deferred-awaiting-answer** — parked on a question | `defer_work`; notice at `src/attention.mjs:12-14`, emitter `:400`; escalated to the human after `DEFERRED_TO_SEAT_MS = 15 min` (`src/supervisor.mjs:21`, planned at `:70`, written at `:129`) | parks the item on the human through the existing defer representation | the operator | deferral age | ≤15 min before a human is woken (correct) | one notice + one defer write |
| S8 | **wedged (stalled turn)** — one turn produced no progress | the post-settlement bound `turn-duration-ms>=maxTurnDurationMs` (`src/degeneration.mjs:225`) or the live bound (`src/inflight.mjs:89-90`) | **reset** with a stall-worded handoff (`src/supervisor.mjs:203-210`, applied `:237`) | the seat itself, re-anchored | `pi.reset` record; `:degeneration` stderr line | the bound (300 s today) | **the whole context is discarded** — legitimate here, catastrophic if misattributed |
| S9 | **degenerate (looping)** — repetition, pseudo-tool-call, language drift, prose wall | `src/degeneration.mjs:203-226` (per-run causes), patterns at `src/attention.mjs:268-287` | reset with a cause-specific handoff (`src/supervisor.mjs:185`, branches `:193-233`) | the seat | same as S8 | immediate | full context loss |
| S10 | **failed-run streak** | `REPEATED_FAILURE_STREAK = 3` (`src/attention.mjs:48`), escalated at `src/supervisor.mjs:70-122` | parks the seat's oldest non-terminal item on the human; a spend-cap stop escalates on the **first** run | the operator | streak | 3 runs (deliberate for model faults; 1 for spend, correctly) | 3 failed runs of prompt exposure |
| S11 | **operator-paused** | `pause` in the spool (`src/broker.mjs:561`; the op set is at `:486`) | nothing runs | nobody | — | indefinitely | none |

**Two things this table exposes that prose about "the idle storm" does not.**
1. **S2, S5 and S6 are the same cost profile and are today billed identically.** A seat with nothing to
   do, a seat holding a parked row, and a seat whose gate is unmet all pay a wake, a prompt, and a turn.
   396 durable records carry the driver's no-work text in one 30-minute pass (`docs/ROADMAP.md:6026`),
   i.e. the rig *answered* "nothing to do" ~400 times with money.
2. **No row in the table names S2→S8 as an edge, but the measured pass crossed it ~1,400 times.** The
   only actuator available is `applyResets` (`src/supervisor.mjs:185`), selected purely by
   `assessment.degenerate` (`planResets`, `src/supervisor.mjs:164-177`). The guard has no notion of *why* a seat is
   quiet, so idleness and wedging reach the same actuator. That single collapsed edge is the storm.

## 2. THE GUARANTEE: IDLE MUST NEVER RESET CONTEXT

Stated as an invariant with an owner and a falsifiable check, because an invariant without a check is a
wish (the review checklist's "every guarantee needs a probe"):

> **INV-1.** A `pi.reset` entry may exist only if a *named per-run cause* is attached to it and that
> cause is one of S8/S9. An idle seat (S2/S5/S6) produces **zero** reset records.

Today INV-1 is unprovable in three places. Each is a defect with an exact fix and a probe:

- **Defect 1 — the reset record carries no reason.** All 1,406 reset entries group as **one blank
  string** (`docs/SELFDEV.md:2241`, `docs/ROADMAP.md:6028`), so a reader cannot tell a guard reset from
  a model-change reset — while `applyResets` *does* build a cause-named handoff
  (`src/supervisor.mjs:193-233`) and `resetSeatContext` only writes a `pi.reset` user message when the
  handoff is non-blank (`src/reset.mjs:60`). Either the handoff is not landing in the field readers
  group by, or the guard's plans fire with empty `detail` (`planResets` sets
  `detail: assessment.reasons.join(", ")`, `src/supervisor.mjs:173`). Both readings are bad and the
  distinction is cheap: **stamp the reason on the reset record itself, not only in the handoff prose.**
  *Probe:* group `pi.reset` entry texts in the store and require zero blanks —
  `node tools/store-inspect.mjs`/`scanEntries` filtered to `kind === "pi.reset"`, expecting
  `blanks === 0`. This is D159's rule ("state the mechanism you counted") applied to the rig's own act.
- **Defect 2 — a field that claims a protection nobody consumes.** `assessRun` computes
  `justReset` (`src/degeneration.mjs:131-135`, returned `:231`) and its comment says that ignoring the
  reset boundary made "the guard re-fire every pass: 20+ consecutive `pi.reset` entries with no
  intervening turn (#1704)". But **`justReset` has no consumer outside `degeneration.mjs`** — probe:
  `grep -rn justReset src/ tools/ --include=*.mjs | grep -v '^src/degeneration.mjs'` → **no output**.
  So the code has the *shape* of the #1704 fix (run bounded at the reset) without the *act* (suppress a
  re-fire for a run that is only a reset boundary plus a no-work turn). *Fix:* make the guard's
  re-fire suppression explicit and tested — no reset planned when the run's only entries are the
  boundary and the no-work text; `justReset` becomes load-bearing or is deleted, so the field never
  again reads as a guard that is not there.
- **Defect 3 — the live-lease guard silently disables itself.** `resetSeatContext` refuses to reset a
  seat holding a live generation lease **only when a finite cap is configured**: `seatsWithLiveSlot`
  returns an empty set when `maxSeats` is `Infinity` (`src/reset.mjs:27-30`, consulted at `:54-55`), and `maxSeatsFromEnv`
  yields `Infinity` when `DURIG_MAX_CONCURRENT_SEATS` is unset (`src/reset.mjs:20-25`) — measured
  `durig.config.json=undefined` (`docs/ROADMAP.md:6029-6030`). With the cap unset, **a reset can be
  drawn under a seat that is mid-generation**, which is the one case the comment at
  `src/reset.mjs:11-12` says must never happen. *Fix:* make the lease guard unconditional — read the
  slots independently of the cap; the cap sizes the pool, it must not size the safety check. *Probe:* a
  test that leaves `DURIG_MAX_CONCURRENT_SEATS` unset, starts a generation, calls `resetSeatContext`,
  and requires `{refused:true, reason:"live-generation-lease"}`.
- **Consequence in the loop, named precisely.** `src/broker.mjs:2034-2047` takes the guard's plans,
  logs them as `escalated`, then **clears the seat's cooldown and marks the scheduler dirty** so the
  seat is re-driven in the same resident process — correct for S8/S9, an accelerant for S2: reset →
  cooldown cleared → immediate re-wake → still nothing to do → trip again. The recovery verb is what
  feeds the storm, because the broker cannot tell which state it is recovering from.

## 3. THE STALL BOUND — what a reset *means*, per state

The bound is one cause across the rig by design: `DEGEN_DEFAULTS.maxTurnDurationMs` is reused by the
post-settlement guard (`src/degeneration.mjs:225`) and the mid-run trigger (`src/inflight.mjs:22`, the
bound wired at `:47`, tripped at `:89-90`). What differs by state must be the **recovery path**, not the number.

| State | What a reset means | Recovery path (bounded, then human) |
|---|---|---|
| S1 working | nothing — a reset is refused while a lease is live (today only when the cap is set: Defect 3) | let the in-flight bound trip first; never act under a live generation |
| S2 idle | **a bug, always.** Idleness is not a fault, so no actuator may fire on it | make the empty-queue answer a `SKIP` (already computed at `src/driver.mjs:143`), stop waking until the queue changes; no reset, no escalation |
| S3 queued-unseen | nothing | a pass wakes it; if it does not start, the S4 notice is the signal |
| S4 admitted-not-started | nothing — a reset cannot un-kill a harness | report; restart the harness (operator); re-admission is idempotent because the input is already committed |
| S5 parked / S6 gated | **a bug** — parked work is expected, not degenerate | a release or a gate-closure event wakes; until then, hold without waking |
| S7 deferred | nothing — the answer arrives, or `DEFERRED_TO_SEAT_MS` wakes the human (`src/supervisor.mjs:21`) | answer → `resume_work`; else the human decides |
| S8 wedged | **legitimate** — this is what the bound is for; the handoff must name the time and say "act, then report" (`src/supervisor.mjs:203-210`) | bounded: re-claim the held item, short turns; if a seat resets N times per item with the same cause, escalate to the human as a diagnosis gap, do not reset a (N+1)th time |
| S9 degenerate | legitimate; the handoff must restate the rule, not just the fault (`src/supervisor.mjs:193-233`) | same as S8 plus the cause-specific re-anchor |
| S10 failed streak | never — the actuator is defer-to-human, not reset (`src/supervisor.mjs:70-122`) | already bounded at 3; spend-capped runs escalate at 1 |
| S11 paused | never | operator resumes |

**The one sentence the operator should be able to rely on:** a reset is a recovery for a *turn that
would not stop*, never for a *seat that had nothing to do*. If a reset record exists whose run contains
the no-work text and no named cause, that is an attention bug by definition (INV-1), and it must be
reported as one rather than being counted as capacity.

## 4. Failure modes at the seams, each with a recovery path

| Class | Failure | Recovery path | Falsifiable probe |
|---|---|---|---|
| Loop | S2 → guard → reset → cooldown cleared (`src/broker.mjs:2044-2046`) → re-wake → S2. Never converges. | `SKIP` on empty queue; wake on queue-change only; per-item reset budget that escalates instead of re-resetting | the 313 acceptance re-run: bounded pass on `queued 0`, `escalations ≤ seat count`, **zero `pi.reset`** |
| Silent | the reset reason is blank, so the storm is invisible to the reader (Defect 1) | stamp the cause on the record | reset-text grouping query, expect `blanks = 0` |
| Cascade | 31 resets to `lead` erased an operator ruling; the team reports "nothing to claim" after being told what to do | a ruling is durable state the seat must re-read, not context it must retain: the intent is already in the queue as a row; the guarantee is that a reset never *strands* a row a seat holds | re-issue the #300 pass and check that the seat's next action follows the ruling row |
| Contradiction | guard says degenerate, driver says no-work — two parts disagree about one seat | one owner for the answer: the driver's `SKIP` wins on an empty queue; the guard may only fire on a named per-run cause inside an *advancing* task (`src/broker.mjs:944`) | a fixture with both conditions asserting `SKIP` and `resets === 0` |
| Partial | a guard field (`justReset`) reads as a protection with no consumer | delete it or make it load-bearing, with a test | the grep above returning no output is the current state; after the fix it must name a call site |
| Hard | reset attempted under a live generation when the cap is unset | unconditional lease guard (Defect 3) | test with the env var unset expecting refusal |
| Context | the guarantee that idle keeps context is fine; the real context risk is that a **legitimate** reset discards a ruling delivered as prose | rulings ride as queue rows, never as chat; handoffs re-anchor to "the queue", which they already do | cite check: every handoff string must name the queue as the source of truth |
| Observation | escalation counts are reported; reset counts are not | the pass report must print `resets=` next to `escalated=` (ROADMAP 300's pricing half, promote `pass-report.mjs`) | a pass line containing `resets=0` |

## 5. Options considered (lead's ruling bounds the number, not the shape)

- **A. Idle state as a first-class scheduler state: wake-on-delta, not wake-on-pass.** The driver already
  computes the discriminator (`SKIP reason=no-work`, `src/driver.mjs:143`) and the scheduler already has
  cooldowns and `markDirty` (`src/scheduler.mjs:159` and `:91`; the reset path clears a cooldown at
  `src/broker.mjs:2044-2046`), so this is a policy change, not a new sensor.
  Cost: a queue row written while every seat sleeps must wake exactly one seat — the wake path must stay
  event-driven (D23/D24: push, not pull), and a missed wake is a stall, so it needs the S4 notice as its
  backstop. *This is the shape I would build on.*
- **B. Backoff timer only (wake less often).** Cheapest, reversible, no new state; but it keeps paying a
  full prompt per wake, keeps the reset path reachable from idleness, and re-tunes itself every time
  capacity changes — which is the exact coupling the operator's ordering ruling exists to break. Accept
  B only as an interim while A is built, and never with the guard able to fire on an empty queue.
- **C. Raise the turn bound / relax the guard so it trips less.** Rejected: it treats a symptom of the
  wrong edge and weakens the real S8/S9 protection. It also cannot fix a blank reason record.
- **Chosen: A, with INV-1 as its acceptance invariant.** Reversible (the wake-on-delta change is one
  policy in the driver/scheduler seam), and it makes 314/316/317 well-specified: each becomes "act on
  state X" rather than "tune the global timer".

## 6. VERIFY — how this note is re-checkable

Every notice/handling relied on is cited `path:line` above. **A line anchor is a claim about a tree, not
about the repo.** This note was first verified on branch `item-5211` (forked from `926a7754`, with
`main` already at `0bce3ed5` and D221-D223 taken, so this item's decision entry is **D224**). That ref
no longer exists — `git rev-parse item-5211` exits **128** — and the anchors have moved since. They were
re-measured on **`9ae345df`** on 2026-11-11; a reader re-checking should re-run the greps below rather
than trust the number. **note: `vendor/pi-main` is not built in an item worktree, so this note ran no
demo suite and claims no suite verdict**.

Commands run in this worktree at `9ae345df`, with what they printed (the base-tree value in parentheses):
- `grep -n "export function planEscalations\|export function planResets\|export async function applyResets\|await conv.reset" src/supervisor.mjs` → `70, 164, 185, 237` (base: `63, 153, 174, 226`)
- `grep -rn "turn-duration-ms" src/` → `src/degeneration.mjs:226`, `src/inflight.mjs:90` (one bound, two detectors; inflight was `:88`)
- `grep -rn justReset src/ tools/ --include=*.mjs | grep -v '^src/degeneration.mjs'` → **no output** (Defect 2 still holds at this sha)
- `grep -n "idle_with_queued_work\|admitted_not_started\|deferred_awaiting_answer" src/attention.mjs` → `7, 12, 15` (header) and `400, 521, 532` (emitters; base: `507`, `391`)
- `node --check src/attention.mjs src/supervisor.mjs src/degeneration.mjs src/inflight.mjs src/reset.mjs src/broker.mjs src/driver.mjs src/scheduler.mjs` → **exit 0** (each file checked separately, rc 0). This item touched **no** `.mjs` file, so it stays clean by construction.
- Citation re-grep (every `path:line` in this note was re-read, not written from memory): `grep -n "DEFERRED_TO_SEAT_MS =" src/supervisor.mjs` → `21` (unchanged); `grep -n "reasons.join" src/supervisor.mjs` → `173` (base `162`); `grep -n "per-turn wall-clock bound" src/supervisor.mjs` → `205` (base `194`); `grep -n resetHandoff src/reset.mjs` → `60, 62, 70, 74`; `grep -n "maxSeatsFromEnv\|seatsWithLiveSlot" src/reset.mjs` → `20, 27, 54`; `grep -n "nothing claimable\|no-work" src/driver.mjs` → `55, 143` (base `55, 111`); `grep -n escalated src/broker.mjs` → `2035` (base `1824`); `grep -n "backoff before capacity" docs/DECISIONS.md` → `9594`; `grep -n "^| 313 |" docs/ROADMAP.md` → `6104`.
- `node tools/review-cite-check.mjs docs/reviews/architecture-idle-attention-2026-11-06.md` → `pathCites 54 54/0`, `sizeChecks 0/0`, **exit 0**. Read the limit: that tool checks that a cited **path** resolves in the tree, not that its **line number** is still the right line — which is exactly what drifted here, and why the greps above are the durable part of this note.
- **Not run, and therefore not claimed:** no demo-suite run. This worktree has no built `vendor/pi-main`, so a suite verdict here would not be comparable with the seat root's. INV-1's probes above are SPECIFIED acceptance checks for the 313/314/316 build items (`#5215` impl 314, `#5218` held for 316) — they are the design's acceptance criteria, not measurements I took. The measured numbers in §1 are quoted from ROADMAP 300's bounded pass, cited to `docs/ROADMAP.md:6022-6042` and `docs/SELFDEV.md:2234-2241`.
