---
review: the queue verbs disagree about the same row - the ordering is the defect, not the wording
item: #6363
seat: architect
asked_by: pm
date: 2026-11-11
tree reviewed: main (worktree item-6363)
probe: tools/probes/verb-ordering.mjs  (exit 1 today - RED by design; exit 0 when the fix lands)
status: design position and acceptance gate; impl builds (#6362)
---

# The class, measured

Same row, same status, three different answers. From the source, in the order the checks appear:

| verb | line | what the first refusal says | order |
|---|---|---|---|
| `release_work` | `:1275` terminal, `:1277` authority | "already done (terminal)" | state first (the #5778 fix) |
| `complete_work` | `:995` | `"not claimed by you (status=X)"` - authority and status in one condition | safe |
| `defer_work` | `:1111` authority, `:1113` status | "addressed to impl, not you" | authority first |
| `resume_work` | `:1200` authority, `:1202` status | "addressed to impl, not you" | authority first |
| `hold_work` | `:1233` authority, `:1241` status | "addressed to impl, not you" | authority first, **no terminality check** |
| `revise_work` | `:1314` authority, `:1318` status | "not yours to revise" | authority first, **no terminality check** |
| `cancel_work` | `:1362` authority, `:1364` terminal | "not yours to cancel" | authority first |

`defer_work` and `resume_work` are in the same class and were not in the routed scope: a `done` row
addressed to another seat is refused as a matter of ownership, which reads as live work.

The probe asserts this from the source and exits **1** today. It is the recurrence gate: it goes to 0
when every verb checks existence, then terminality, then authority, and back to 1 if a future verb
reorders them. A fix that patches two verbs and leaves the class unguarded will fail this check,
which is the point - #5778 fixed one verb and the class survived.

# Why the order is the fix, not the wording

A refusal is a claim about the world. `workable()` (`src/rig.mjs:303-319`) is the predicate that
decides what a seat wakes for; the refusals are what coordinators read when they decide whether to
escalate. If a closed row is refused on the grounds of *who owns it*, the reader infers open work.
That is the same shape as the "96% parked" milestone misread that #5778 recorded.

# Failure modes, each with a recovery and a check

1. **Silent misreport (the one at hand).** A terminal row refused on authority reads as open work;
   the coordinator escalates something already closed. *Recovery:* terminality before authority in
   every verb. *Check:* the probe, exit 0.
2. **Recurrence.** Fixing `revise_work` and `cancel_work` in one commit while `hold_work` keeps the
   same order leaves the class open. *Recovery:* the probe in the demo set, not a one-off test.
   *Check:* `node tools/probes/verb-ordering.mjs` runs against whatever tree it is in.
3. **Over-generalised helper.** The tempting durable fix is one shared guard for all four verbs. It
   works for existence, terminality and authority, and breaks on status: `release` requires `held`,
   `revise` requires `queued`, `hold` accepts `claimed` or `queued`, `cancel` accepts anything
   non-terminal. A guard that hardcodes one status rule blocks legitimate verbs - a partial failure
   that looks like a success because the guard "passed". *Recovery:* share ordering and terminality
   only; leave the status rule in the verb. *Check:* a demo that asserts each verb's own admissible
   status still admits it (release on a held row succeeds, revise on a queued row succeeds).
4. **Wording that is right and still misleading.** "already done" tells a coordinator nothing about
   what to do. *Recovery:* the refusal names the status and states there is nothing to do. *Check:*
   the demo asserts the string contains the status word, not just that it differs from the old one.
5. **Information exposure from reordering.** Reporting terminality to a non-party reveals the row
   exists and is closed. Trade-off: nothing is lost, because `peek_queue` with `all=true` already
   enumerates every non-terminal row and its status to every seat, and `queueItemLine` prints status.
   Terminal rows are excluded from that listing, which is exactly why an accurate refusal is the only
   way a seat learns a row is closed. So the ordering is safe, and it is also the only truthful path.
6. **`claim_work` by id: a closed row is reported as an empty queue.** The by-id path filters
   `it.id === args.itemId && it.to === me && it.status === "queued"` (`:821`); when nothing matches, it
   falls to `if (!found) return toolText("NO_QUEUED_WORK")` (`:931-933`). A seat told to claim a row that
   is held, deferred, claimed elsewhere or terminal is told it has no queued work. #4713 fixed the
   *oldest* path for exactly this (the `kind: "none"` branch names the status, `:916-929`); the by-id
   path never got the same treatment. *Recovery:* the by-id miss must name the id and its status, or
   say "no such row". *Check:* the probe reports this line; a demo claiming a cancelled id must not
   return the bare string.

# Options and the trade-off

- **A. Patch the order in the three verbs** (what #6362 does). Minimal, one file, immediate. Does not
  prevent the class reappearing in a new verb.
- **B. Shared guard + the probe.** The order becomes structural; the probe keeps it structural. Slightly
  more surface; the risk is failure mode 3.
- **C. Behaviour-only demo.** Asserts the three refusal strings today, proves nothing about tomorrow:
  a later verb can reintroduce the order and the demo still passes.

I take **B**, with the boundary stated: the guard covers existence, terminality and authority; the
admissible status stays per verb. A is acceptable as the first commit if B is scheduled as the second;
A alone leaves the recurrence open, and recurrence is why this row exists.

# Scope boundary, stated before the fact

`hold_work`, `defer_work` and `resume_work` have the identical defect in the identical file, so they
belong in the same commit: the concern is one rule, "establish the row's state before refusing on
ownership". They do **not** belong with `hold_work`'s authority *scope* problem - it is recipient-only
while `release_work` and `cancel_work` are party-wide (routed separately as #6364). Two different
concerns: the order of checks versus who may act. Fixing both in one commit makes the diff unreadable
and the acceptance ambiguous.

# Acceptance, sharpened

pm's three cases (terminal, claimed, non-party) plus:
- the refusal string for a terminal row must name the status;
- `node tools/probes/verb-ordering.mjs` must exit 0 - that is the gate that survives this fix;
- the probe must be shown RED (exit 1, output above) against the pre-change tree before it is GREEN,
  so the fix is demonstrated to have changed something rather than asserted;
- the scope the probe reports is five verbs (`defer`, `resume`, `hold`, `revise`, `cancel`), not two.
  If #6362 fixes only `revise` and `cancel` the gate stays red, which is the correct outcome: the row
  describes a class and the class is what must close.
