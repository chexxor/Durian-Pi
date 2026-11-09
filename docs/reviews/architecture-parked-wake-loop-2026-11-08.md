# Architecture review — the parked-wake loop (a seat with nothing claimable wakes itself forever)

**Status:** review delivered (architect, 2026-11-08). Item **#5740** (from **#5729**). Durable decision: `D-<mint>`
in `docs/DECISIONS.md`, minted at land time (#3075 — no number is hardcoded in a branch).
**Scope (in):** the wake seam only — `src/driver.mjs` `selectWakes`/`driveOnce`, `src/scheduler.mjs`
`WakeScheduler`/`isWakeRelevantCommit`, and the `SERVE_SEAT_COOLDOWN_MS` wiring in `cli.mjs`.
**Scope (out):** implementation (#5741), verification (#5745), and the doc-truth leg (#5743). This seat designs
and reviews; it does not verify its own design.
**Base revision:** fork `item-5740`, tip `f1be5157`. Line numbers are as of that fork — re-grep before acting.
**Dependency set of the run:** this worktree resolves `@earendil-works/pi-durable` 1.3.0 from the lockfile and has
**no linked `vendor/pi-main`** (prepare_workspace reported the link failed). Every measurement below is from that
tree, not from the seat root; do not compare it with a seat-root suite run.

---

## 0. Topology first

```
commit on durig.queue / durig.seats / any submission  ──▶  scheduler.notify()  ──▶  dirty
                                                              (isWakeRelevantCommit, scheduler.mjs:44)
dirty + floor(500 ms) + not inFlight  ──▶  beginPass  ──▶  driveOnce
                                             │
                                             ├── selectWakes  (driver.mjs:92 hasQueued,
                                             │                :96 hasStalledClaim,
                                             │                :107 hasParked  ← the branch in question)
                                             ├── seatFilter = scheduler.seatFilter(now)   (cooldown: 30 s)
                                             │     dropped candidate → onSuppressed → cooldownRevisitAt = now + 30 s
                                             └── conv.submit(WAKE_CONTENT_PARKED)  ← a SUBMISSION, hence wake-relevant
                                                    └── the pass ends; the loop sleeps in signal.wait()
                                                        until cooldownRevisitAt fires → markDirty → PASS again
```

The load-bearing fact: **the wake itself is the trigger for the next wake.** No external commit is required. The
log proves it — the passes that do not wake are exactly the cooldown-suppressed revisits scheduled by the
suppressed candidate, thirty seconds apart.

## 1. Measured, not inferred

Three runs, same CLI, `DURIG_PROVIDER=faux` (no model call, no key), one rig from `.spike/wake-probe/rig.json`,
counts taken from `<db>.broker.log`. All three exited 0.

| Rig state | Command | `WAKE parkseat` count | Wake timestamps |
|---|---|---|---|
| 1 held row, 0 queued | `node cli.mjs serve --max-duration 120` | **4** | +0 s, +30 s, +60 s, +90 s (`EXIT ... reason=max-duration passes=8`) |
| 2 held rows, 0 queued | `node cli.mjs serve --max-duration 60` | **2** | +0 s, +30 s |
| no queue rows at all | `node cli.mjs serve --max-duration 60` | **0** | — |

Readings that follow from the table:

1. The cadence is exactly `SERVE_SEAT_COOLDOWN_MS = 30_000` (`cli.mjs:2688`, wired at `cli.mjs:2024` as
   `seatCooldownMs`). The cooldown bounds the **rate**; nothing bounds the **count**.
2. The wake is **per seat, not per row** — two parked rows produced the same two wakes as one. Whatever dedup key
   is chosen must therefore be per-seat, and must be a *set signature*, not a row id.
3. The zero-parked baseline is 0, so the parked branch is the whole cause, not an unrelated timer.
4. Between each wake there is a pass with `woke=-` (`PASS 2 ms=1 woke=-`) — that is the wake's own submission
   dirtying the scheduler, then the candidate being suppressed by cooldown, then `cooldownRevisitAt` forcing the
   next pass. Self-sustaining.

**Fleet scale, from the live log** (`grep -c 'WAKE ' /home/chexxor/Git/Durian-Pi/selfdev.sqlite.broker.log` →
**4,455** lines; window `2026-11-08T18:*`–`19:10` per seat): `auditor` **24**, `security` 7, `pm` 3, `lead` 3,
`architect` 1, `qa` 1, `scribe` 1, `impl` 1, `devtools` 1. One seat waking 24 times in an hour while holding
nothing claimable is the probe's 30 s cadence multiplied by real seats. The `stalled-claim` branch does not show
the same shape because the seat's own activity keeps a submission in flight; the parked branch does, because the
wake is the only activity.

**The fleet cannot currently count this.** `src/broker.mjs:1798` logs `WAKE ${name}` with no reason, so the
parked-vs-work split pm quotes (**174 parked vs 72 work** wakes since entry 400000) is recoverable only by reading
conversation bodies. That is a defect in its own right: no acceptance probe for this fix can be a log grep until
the line carries the branch. **Fold into #5741:** log `WAKE <seat> reason=<queued|stalled-claim|parked>` and a
`PARKED-WAKE seat=<n> reason=<set-changed|deduped>` suppression line.

**The wake body names a tool no seat has — verified against the registry, not from the incident report.** Seat
tools are defined in `src/rig.mjs` at lines 632, 768, 932, 1064, 1163, 1190, 1223, 1250, 1300, 1327: `send_work`,
`claim_work`, `complete_work`, `defer_work`, `resume_work`, `hold_work`, `release_work`, `revise_work`,
`cancel_work`, `peek_queue`. There is no `status`. So `src/driver.mjs:54`'s "Check `status` for which rows are
parked" is not executable by a seat, and the comment above it ("the seat learns which rows from `status`") is
wrong for the same reason.

The earlier "~5 in 120 s" figure in #5729 was a derivation from the cooldown, not a measurement. The measured
number is **4 in 120 s**, and it should be quoted as such wherever the defect is cited.

## 2. Failure modes, each with a recovery path

| # | Mode | What happens | Recovery path |
|---|---|---|---|
| 1 | **Loop** (never converges) | wake → submission commit → dirty → pass → cooldown → wake. A parked seat generates a full turn every 30 s for the lifetime of the broker. | Dedup the parked wake by the seat's parked `(itemId,status)` set; a set that has not changed produces no wake. Bounded by construction: the set only changes on park/release/claim/cancel. |
| 2 | **Cascade** (cost and capacity) | each parked wake is a real seat turn. With the shipped `DURIG_MAX_CONCURRENT_SEATS: 1` default it contends for the single generation slot, so parked noise delays real work; on a metered provider it also spends money. | Same dedup. Additionally: log the suppression so a human can see the seat is being held back rather than being idle (`PARKED-WAKE seat=<n> reason=<set-changed\|deduped>`). |
| 3 | **Silent** (invisible suppression) | today nothing records *why* a parked seat is not woken; `SKIP` is emitted only for `no-work`, `pending`, `busy`. A reviewer cannot distinguish "suppressed by cooldown" from "not woken at all". | The dedup must emit its own line, and the reason must be one of two named values, so the log answers the question without inference. |
| 4 | **Contradiction** (doc vs code) | `docs/WORK-ITEM-LIFECYCLE.md` §4 states "`held` and `deferred` are not wake conditions" and cites a two-condition `selectWakes`; the code has three. §6 says held rows are "not surfaced". A seat that trusts the doc behaves wrongly. | Leg #5743: describe shipped behaviour, and state the check that was run when `last_verified` is bumped (currently 2026-10-19, before #4607 landed). |
| 5 | **Instruction the seat cannot execute** | `WAKE_CONTENT_PARKED` tells the seat to "Check `status`". `status` is a CLI verb, not a seat tool; and the cwd guard refuses shell from a degraded seat cwd (no claimed item → no worktree) — observed directly this session. The only read surface a parked seat actually has is `peek_queue`. | Rewrite the body to name `peek_queue` (and `all: true` for the team view). A wake instruction must be executable by the seat receiving it. |
| 6 | **Partial** (the dedup could swallow a real signal) | if the parked signature is unchanged, no wake fires — so a parked row whose gate cleared but nobody released is still invisible. | Accept it, and name it: releasing a row moves it to `queued`, which *is* a wake condition, so the release path still wakes. The residual — "parked but gate cleared, never released" — is an attention-kind problem, not a wake problem, and is the B option below. Do not solve it inside the dedup. |
| 7 | **Restart** (dedup state loss) | a broker restart or a `SessionFailed` reopen forgets the dedup state and wakes once more. | Acceptable and desirable: one informational wake per broker lifetime per unchanged set is not a defect. Put the state on the `WakeScheduler` instance (created once in `cmdServe` and passed to `runWakeLoop`) rather than in the loop scope, so a harness reopen does not lose it. |

## 3. The ruling: option A, and what it gives up

**Decision.** The wake contract for a seat whose only non-terminal rows are parked is: **wake once per change of
the parked set**. `selectWakes` keeps `hasParked`, but the broker supplies the seat's last-known parked
signature (the sorted set of `(itemId, status)` for that seat's `held`/`deferred` rows); the parked branch fires
only when that signature differs. The signature lives on `WakeScheduler`, not in `selectWakes`, which stays pure
and demo-able.

**What it gives up, stated plainly.** The seat may hold stale knowledge: it will not be re-told that it is parked
if nothing changed. That is the right loss, because the wake carries no new information in that case — the seat
already knows its parked set, and `peek_queue` is one call away. The alternative loss (an unbounded stream of
identical wakes) costs turns, money, and the generation slot, and it teaches the seat that a wake can mean
nothing, which erodes every later wake.

**Options considered.**

- **(A) Dedup by parked-set signature** — chosen. Bounded, local to one predicate plus one field, reversible, and
  it keeps the informative wake #4607 introduced.
- **(B) Drop the parked wake; surface parked state as an attention kind** — fewer turns, but `src/attention.mjs`
  has no kind for a park (WORK-ITEM-LIFECYCLE §5 names that gap explicitly), so the state becomes invisible rather
  than merely less noisy. Rejected for now; it is the right follow-up if the operator wants parked rows surfaced
  in `status`, and it is a different concern.
- **(C) A wake that does not trigger a run** — the cleanest semantics, and unavailable: a submitted user entry
  drives a task in pi-durable. Adding a non-running input is an upstream change to the pinned package, not a
  durig change. Rejected as out of reach.

**Why the signature cannot go in the wake body.** ROADMAP 33: the wake is committed as a user entry, so a body
that varied per item zeroes the prompt cache. That is why #4607 used fixed strings. The dedup key therefore belongs
in the *selection*, never in the text.

## 4. The second ruling: what the parked wake should say

`WAKE_CONTENT_PARKED` (`src/driver.mjs:54`) currently reads: "Your queue holds parked rows awaiting release —
there is nothing claimable for you. Check `status` for which rows are parked; do not call `claim_work` expecting
work."

The clause "Check `status`" is not executable by a seat. Replace it with the tool the seat actually has:

> "Your queue holds parked rows awaiting release — there is nothing claimable for you. Read them with
> `peek_queue` (pass `all: true` for the team view); do not call `claim_work` expecting work."

It stays a fixed string, so the prompt-cache property is preserved. The release transition (`held → queued`)
produces its own wake with the ordinary queued body, so the seat is not left guessing when a park becomes work.

## 5. The falsifiable probe (acceptance, not prose)

Pure, harness-free assertion on `selectWakes` (it is pure, so a demo can prove the rule without a model):

- parked set unchanged, signature already recorded → **no** wake for that seat;
- one row added or released → **one** wake;
- a `queued` row alongside parked rows → the queued wake still fires (the dedup must not touch `hasQueued`).

Integration assertion, the one that decides whether the loop is closed:

```bash
DURIG_PROVIDER=faux DURIG_DB=<probe-db> node cli.mjs serve --max-duration 120   # exit 0
grep -c 'WAKE <seat>' <probe-db>.broker.log
```

Today: **4** (measured, §1). Under the fix: **1**. The red-first demo required by #5741 must assert both
directions — unchanged set → 1 wake, changed set → still wakes — because a suppression-only assertion is vacuous.

## 6. Boundary: what this ruling does NOT decide

The loop is closed by dedup alone, so nothing here requires redefining wake-relevance. But `isWakeRelevantCommit`
(`src/scheduler.mjs:44`) counts **any** submission change as wake-relevant, which is why the broker runs passes on
its own wakes. Making submission commits non-wake-relevant would be a change to wake semantics and to the
general revisit gap — that is a **lead** ruling, not a design detail, and it is deliberately not decided here. If
dedup turns out insufficient and the semantics must change, route it to lead before implementing.

**Relationship to #5438** (still held, gated on #2712): that registration argued wake selection should use the
same `workable` predicate claim uses. This ruling is the minimal cut that does not wait for that axis — parked rows
are by definition not workable, so the defect is not that they wake at all but that they wake *repeatedly with no
change*. If #2712's axis lands, the dedup becomes the floor it needs; if it never lands, the loop is still closed
here.

## 7. Suite evidence for this change

Docs-only diff, so the derived guard ladder (`node tools/what-to-test.mjs --base=main --run`, exit 0) selected 6
tests — `degeneration-duration`, `git-guard-census`, `queue-lifecycle-m1`, `queue-lifecycle-m1a`,
`seat-instruction-encoding`, `skill-admission-gate` — all PASS.

Full suite in this fork (`node scripts/test.mjs --all`): **260/261 in 58.3 s, exit 1**. The one red is
`demo/clockin-digest.test.mjs`: the clock-in digest is 20,848 B against its 20,000 B budget, and 15,828 B of it is
the `## POINTER` section of `docs/NEXT.md` at this fork base (193 lines). `renderDigest` reads NEXT.md, SELFDEV.md,
rig status, git debt and runbooks — not `docs/DECISIONS.md` or `docs/reviews/` — so this item cannot be the cause.
Measured check: the same test in a detached scratch worktree at `main` (`a7fc5758`) **passes, exit 0**; main's
`docs/NEXT.md` is 114 lines with a 7,499 B pointer. The red is a fork-base state, not a landed regression.

## 8. What this seat did not do

- Did not verify the fix; the probe above was run in this worktree with `faux` and a throwaway store
  (`.spike/wake-probe/`), which is not the seat-root dependency set.
- Did not implement anything; #5741 owns the code cut, #5745 verifies it.
- Did not measure the real fleet. The 4-wakes-per-120 s number is from a synthetic single-seat rig, not from
  `selfdev.sqlite.broker.log`; counting the fleet's parked wakes is a read the operator or pm can do with
  `grep -c 'WAKE <seat>'` against that log.
