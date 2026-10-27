# The five parked questions — measured state and recommended operator replies

Written 2026-10-26 by the delegate. These are the six `deferred` rows the pointer calls "five parked
questions" (`#4817` and `#4818` are the same request to the same seat). Every status and number below is
from a command run in this session against `selfdev.sqlite` (`.spike/delegate/queue-audit.json`, 4,818
rows) and this checkout; nothing here is asserted from memory. The delegate does not transition rows —
each **recommended reply** is written so `pm` can act on it once the operator approves.

---

## 1. `#4354` — the TUI name rung and the intersection fixture (`pm → impl`, gated on `#4352`)

**Context.** A row label collided with its count field. Lead's ruling: the parked column is *at capacity*
(`4q · 175p` fills nine cells exactly on `impl`), so the name rung goes 9 → 10 and the separator moves
after the name. The item's real content is one fixture: a nine-cell name **carrying** `4q · 175p`-shaped
content, because either factor alone passes and the defect survives.

**Measured now.** The gate is **cleared**: `#4352` (designer's §4 re-derivation, `pm → designer`) is `done`.
It is one of 15 held/deferred rows whose every `blockedBy` gate is terminal (the orphan-candidate class the
`stale-held-backlog` runbook describes).

**The complication nobody has measured yet.** This item's area is exactly where the OS change bites. On
Linux, `demo/tui-layout.test.mjs` fails at "the 62-col golden truncates rowName at 8 columns, not 9" — and
that golden was anchored against seat paths of the form `C:/Users/Alex/...`. Re-anchoring goldens for a
nine-cell name **in a tree whose fixture paths are Windows paths** would pin a contract to a machine.

**Recommended reply to `impl`.**
> Release it: `#4352` is done, so the derivation exists — pull the numbers from that row, do not re-derive.
> Build the intersection fixture as written; that single fixture is the deliverable.
> One added condition: name the tree every golden is anchored in (`git rev-parse HEAD` + the fixture path
> used), because the operating system just changed and the 62-column golden already disagrees between the
> two systems. A golden that only passes on Windows paths is a defect, not a pass.

---

## 2. `#4813` — the owed notice assertion on `brokerHealth` (`impl → pm`)

**Context.** `#4746` gave `brokerHealth` an `idle` verdict. `pm` then asked `impl` for two things: prove
the verdict's condition is **necessary**, and assert that an **idle rig does not emit the `pass-failed`
notice** — with an explicit instruction to *stop and report* if the notice recomputes its own condition.

**Measured now** (both sites, this session): `cli.mjs:2590` is the only `brokerHealth` consumer in `cli.mjs`,
and the notice is produced at `src/broker.mjs:1855` (`onDiagnostic({ kind: "pass-failed", … })`, log line
`:1861`) from inside the wake loop. So the notice is a **third thing**: it is not derived from the verdict,
and the verdict is not derived from it. `impl` was right to stop, and right that an idle rig cannot emit
that notice — there is no failing pass to emit it from.

**Recommended reply to `pm`.**
> Accept the stop as the answer; do **not** ask for the demo assertion. A test that "an idle rig emits no
> `pass-failed`" would pass because the mechanism does not exist, which is the anti-oracle this rig keeps
> paying for. Close `#4813` as answered, and carry the finding, not the test — see `#4816`.

---

## 3. `#4814` — whose `docs/NEXT.md` line count is right (`pm → qa2`)

**Context.** Scribe measured 157 lines / split at 156 / concatenation 4,370 of 4,370; qa2 measured 186
lines / split at 186. The row's own hypothesis was that two different trees explain both differences.

**Measured now.** The hypothesis is right, and the row is answerable without further seat work: in this
checkout `docs/NEXT.md` is 137 lines at `HEAD` and `docs/NEXT-ARCHIVE.md` is 4,823; the 4,370 figure
belongs to the pre-split blob in history, not to any live file. Both seats were correct about the tree
they were standing in — which is the lesson, not the number.

**And a defect this session produced, in the same file.** While moving the pointer I overwrote the
`2026-10-26T22:15Z` block instead of cutting it verbatim to the archive. It is restored verbatim (77 lines,
sha256 `1b9bf18572c8`, endswith-verified). The reason it went unnoticed: `demo/next-pointer.test.mjs`
asserts the archive exists, is non-empty, begins with a block, and carries old log headings — it never
asserts that **every `## NEXT SESSION` header ever written to `NEXT.md` still appears in the archive**.

**Recommended reply to `pm`.**
> Close `#4814` with the two-sha answer rather than another re-measurement: the numbers came from
> different trees and both were valid there. Adopt the rule explicitly — every count names its
> `git rev-parse HEAD` and the path it measured, and a count without a sha is not a measurement.
> Then mint one cheap item: make `demo/next-pointer.test.mjs` assert header continuity between history
> and the archive, so a dropped block fails a suite instead of being discovered by a human two sessions
> later.

---

## 4. `#4816` — the ruling's shape is not built (`pm → lead`)

**Context.** The genuine design question. `brokerHealth` reports liveness; `pass-failed` reports a throwing
pass; they are unconnected, so (1) a degraded broker raises no notice, and (2) a broker whose passes are
**throwing** still reads `up`, because a failing pass keeps `lastPassAt` fresh. Those are the two states a
human most needs to tell apart.

**Measured now.** Consistent with the report: one consumer in `cli.mjs:2590`, one producer in
`src/broker.mjs:1855`. My own read of a stopped rig corroborates the inertness — `status` printed
`broker.state: "down"` and `attention: 21` with no notice of any kind; the verdict is a JSON field.

**Recommended reply to `lead` (the ruling I recommend you give).**
> Yes: `brokerHealth` takes the pass outcome as an **input**, and one verdict reaches a human. Concretely —
> three distinguishable states, not two: `up` (a pass completed since the last check), `stalled` (heartbeat
> fresh, no pass attempted, work non-empty), and `failing` (a pass attempted and threw). `lastPassAt` must
> be split into `lastPassOkAt` and `lastPassAttemptAt`; a failing pass updates the attempt stamp only.
> Do not build a second notice path, and do not connect the two mechanisms by sharing state: make the
> diagnostic an argument to the verdict.
> And record every verdict transition in the durable decision log proposed as ROADMAP **170** — this row is
> the clearest existing proof that a verdict which reaches nobody and leaves no row is not a control. That
> is the substrate question the operator just commissioned (`docs/reviews/zero-trust-zero-agent-research.md`),
> so sequence this behind 170 rather than inventing a bespoke notice now.

---

## 5. `#4817` and `#4818` — re-measure the landing gate (`pm → devtools`, duplicated pair)

**Context.** Every landing was refused on stray worktree directories (`#4656`: ten, nine carrying content).
impl corrected its own count — filtering root directories by **name** (`item-\d+`) counts live registered
worktrees too, so the honest set must be computed **by registration**, against `git worktree list`.

**Measured now.** On this box the gate is *vacated, not resolved*: `git worktree list` returns exactly one
entry (main); there are no unregistered `item-*` directories; `main` is 435 commits past `910fac7`. But
that is only because the twelve item worktrees, the twelve `item-*` branches and the two stray root
directories **are gone** — see `docs/incidents/2026-10-26-worktree-and-scratch-sweep.md`. Nine of them
carried content per `#4656`, and at least `#4785` (`500969f42`, the seatguard set-matching fix) and `#3454`
(still `held`) are not reachable here.

**Recommended reply to `pm`.**
> Do not treat "zero strays" as a green light: the count fell because the artifacts were swept, not
> because they landed. Resolve the incident first (recover the branches from the Windows rig if they are
> still there). Then re-issue this measurement with the registration-set method, and add the invariant
> that caught the original error as a check: **the store's `worktrees` count and `git worktree list` must
> agree**, and clock-in must report the disagreement rather than printing the store's number alone.
> And cancel `#4818` as a duplicate of `#4817` (identical subject, identical body, same recipient) — that
> is the duplicate-subject heuristic firing in real data.

---

## The audit these rows came from (runbook: `docs/runbooks/stale-held-backlog.md`)

Read-only, via the broker-served `queue` read and an offline dump — no second writing harness:

- 4,818 rows; status histogram: `done` 4,002, `held` 274, `queued` 143, `cancelled` 168, `claimed` 27,
  `deferred` 19, `parked` 3.
- Of the 274 `held`, **22 carry `blockedBy`**, and **15 of those have every gate terminal** — the
  orphan-candidate class: `#3350 #3377 #3419 #3430 #3452 #3456 #3460 #3518 #3535 #3552 #3607 #3663 #3726
  #4339 #4661`. All 15 cite a landing entry, a verify, or a re-derive as their gate, and in every case that
  gate row is `done`.
- The held load is concentrated: `impl` 162, `scribe` 43, `devtools` 33, `qa` 21, `security` 6, `lead` 4,
  `pm` 3, `auditor` 2.

**Recommended reply to `pm` on the audit itself.**
> Work the 15 as a batch, not one at a time: for each, read the body, confirm the hold reason, then
> `release_work` (gate cleared and still worth doing) or `cancel_work` (no longer worth doing) — and where
> a row is genuinely still blocked, record `blockedBy` so it is queryable instead of prose. Deliver the
> batch to `pm` as one intent with the per-row ids, gates and recommended transitions, which is what the
> runbook prescribes.


---

## A. The fifteen held rows whose every gate is terminal (routing table, same audit)

| row | to | gate | recommended |
|---|---|---|---|
| #3350 | qa | #3349 done | release — verify the docs-only landing |
| #3377 | impl | #3343 done | release — landing list, mint order settled |
| #3419 | impl | #3394 done | release — re-derive |
| #3430 | qa | #3428 done | release — narrow verify |
| #3452 | impl | #3274 done | **hold** — its cited evidence sha is unresolvable on this box (section C) |
| #3456 | impl | #3455 done | release — landing list |
| #3460 | impl | #3222 done | release — HEAD of the bug-fix cluster |
| #3518 | impl | #3481 done | release — landing list |
| #3535 | impl | #3448 done | release — landing list |
| #3552 | impl | #3551 done | release — landing list |
| #3607 | impl | #3606 done | release — the ref-deleter needs the non-author verify |
| #3663 | impl | #3660 done | release — landing list |
| #3726 | scribe | #3724 done | **hold** — also in section C |
| #4339 | impl | #4293 done | release — watchdog + durable-down marker (ROADMAP 61/62) |
| #4661 | qa | #4656 done | release, then re-measure the landing gate per the incident doc |

Spooled to `pm` as operator-authorized intent `audit-15-orphans-and-5-parked` (file
`selfdev.sqlite.broker.inbox/0001793077486541-253486-tcdytl.json`). **Spooled is not delivered**: the broker is
down, so nothing has been read or transitioned. Delivery is confirmed by
`selfdev.sqlite.broker.inbox.out/audit-15-orphans-and-5-parked.json` once the broker runs.

## C. Fourteen non-terminal rows carry evidence nobody can re-check here

90 of 178 distinct commit shas cited across the queue resolve nowhere — not this clone, not
`vendor/pi-main/.git`, not `origin` after a clean `git fetch`. The non-terminal subset (the actionable one):
**#3452 #3506 #3603 #3726 #3743 #3832 #3842 #4378 #4791 #4794 #4799 #4801** (plus two in the dump: 7 `held`,
7 `deferred`). Before releasing any of them, either the history arrives from the machine the store came from, or
the verifier must be told the cited commit is unavailable and must re-derive the evidence from `main`. The
alternative is what already happened to **#4785**: marked `done`, its commit `500969f42` unmerged, and now not
an object anywhere reachable.
