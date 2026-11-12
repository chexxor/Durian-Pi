# The stranded-gate plan is sequenced correctly and has one leg missing (#7123)

Architect review of pm's decomposition of #6659 (rows #7118-#7122), 2026-11-12.
Tree: branch `item-7123`; `@earendil-works/pi-durable` **1.3.0** from this worktree's lockfile (seat root
resolves 1.5.1 - a run here is not comparable with one there). Host: Linux, kernel
`7.2.15-300.fc45.x86_64`, Fedora 45, node v24.22.1.

Instruments, with exit codes:
- `node tools/probes/stranded-gate-cascade-7123.mjs` → **exit 1**
- `node tools/probes/gate-predicate-computability-7038.mjs` → **exit 1** (mint accepts a dangling, a self- and a cancelled reference)
- live census: `node cli.mjs queue --json --no-body` (7221 rows, 2026-11-12T11:3xZ)

## What the plan gets right

- **The report goes last.** `release_work` already refuses to un-park a row whose gate names a cancelled
  row (`src/rig.mjs:1413-1415`, the `deadGateId` check - pm's row pinned it at `:1346`, which is the
  tool description, not the check). A held stranded row cannot even be surfaced as claimable, so a report
  with no repair verb is a permanent red line. #7120 gated on `[7118, 6530]` is the right shape.
- **Notification first.** `cancelItem` (src/rig.mjs:211-243) notifies exactly one seat - the cancelled
  row's *other* party. Measured: cancelling a `lead -> impl` row produced "item #1 cancelled: superseded
  (notified impl as notice #3)" while the dependent row (`pm -> qa`, `blockedBy:[1]`) got nothing. That is
  how the stranded set accumulated, so fixing it first is correct.

## The numbers pm quoted are stale; the falsifier is the probe, not the count

pm's row quotes 23 stranded and 14 stranded held rows from a 2026-11-11T13:32:14Z snapshot. Measured now:
**19** non-terminal rows gated on a CANCELLED id - **11 held, 8 deferred, 0 queued**. 0 of them also name
an absent id. Use the probe output as the acceptance, not a number carried across days.

## F1 - notification does not repair, and the repair verb is not in the verification gate

After #7118 lands, the dependent's gate still names a cancelled id, and `workable` (src/rig.mjs:326-341)
returns `gate-cancelled:#<id>` - a *positive* non-workability, not ambiguity (probe line:
`{"workable":false,"reason":"gate-cancelled:#1"}`). Being told is not being unblocked.

**#7121's acceptance is "the census count rising then falling" but its gate is `[7118, 7119, 7120]` - it
does not wait on #6530, the repair verb.** QA cannot make the count fall with mint-refusal and
notification alone; the only lever is `cancel_work` on the dependent, which orphans every id naming it -
the class #6656 swept. **Concrete fix:** add `6530` to #7121's `blockedBy`, or change the acceptance to
"the count does not rise" and make the fall a separate, gated item.

## F2 - standing exists; knowledge does not

Who may clear a void reference? Under the authority rule (D285) authority binds to **the row being
edited**, so the dependent's own parties always have standing. Measured in the probe: dependent parties
`pm, qa`; cancelled parent parties `lead, impl` - **disjoint**. So "notify the other party" structurally
cannot reach the seat whose work is stranded. Standing is not the gap; information is.

**Concrete fix:** `cancelItem` must write the stranded ids where a seat can read them - an ATTENTION
entry and a structured field on the dependent row (e.g. `strandedBy: {target, at, by}`) - not only a
notice row. Notice rows are claimable work (see D287, `docs/reviews/architecture-notice-as-work-7082.md`):
the store already holds **2671** of them, 135 still queued, and pm's queue is 66 acks against 44 tasks.
Minting one notice per stranded dependent multiplies the ceremony cost of the fix.

## F3 - the void-reference decision is not actually made by the plan

Three options, and the plan picks (b) by omission:

- **(a) Treat a cancelled prerequisite as satisfied.** Rejected by a ratified pin:
  `demo/workable-claim.test.mjs` asserts "a gate on a CANCELLED item is NOT workable (terminal != done)",
  exit 0 today. Changing it would make gates silently inert.
- **(b) Chosen: leave the reference, report it, and let a party clear it via #6530.** Consistent with
  D285 ("a void reference is a broken pointer; clearing it is a repair, not a scope decision"). Cost:
  19 rows stay unworkable until someone acts, so the report must be *severe* and attributable, not a
  footnote. Recovery path: ATTENTION kind + repair verb + the event that records `prior`.
- **(c) Auto-void the reference at cancel time, written as an `ungated` event naming the canceller.**
  Removes the stranding immediately, but it edits another row's gate without that row's parties acting -
  a silent state change of exactly the kind this repo keeps paying for. I do not recommend it as the
  default; if lead wants it, the bound is: only the dead id is removed, the prior value is recorded, the
  dependent's parties are notified, and a gate whose remaining ids are live is left otherwise intact.

I would take (b) with F2's structured discoverability, and revisit (c) only if the 19 rows do not drain
within a week of #6530 landing - that is a measurable trigger, not a feeling.

## F4 - #7119's scope is incomplete: self-gates and cycles are not refused

pm's row covers "absent or terminal id" and "bare non-integer refs", and correctly excludes qualified
`RM-<n>` constraints. Measured, mint today also accepts **a reference to the row itself** and a
**two-node cycle** (`tools/probes/gate-predicate-computability-7038.mjs`, exit 1), and
`docs/runbooks/attach-a-gate.md` already says "a cycle starves both rows with no exit". A mint rule that
refuses a cancelled id but accepts a self-reference is inconsistent: both are provably unsatisfiable.
**Concrete fix:** #7119's falsifier is three mints - `[9999]`, `[self]`, `[A,B] where B gates on A` -
each expected to be refused with the reason named. Today all three are accepted.

## Failure modes at this seam

| failure | mechanism | recovery |
|---|---|---|
| cascade | cancelling a gated parent strands dependents with no exit | report (F1) + repair verb (#6530), counted by the census probe |
| silent | a stranded gate reads as an ordinary `blockedBy` in the queue line | ATTENTION entry with a named kind, not prose |
| contradiction | #7121's acceptance needs a fall; its gate does not include the verb that can cause it | add #6530 to #7121's `blockedBy` |
| loop | each stranded notification mints a claimable ack row (2671 already) | record the event, do not mint work |
| partial | mint refuses cancelled ids but accepts self/cycles | extend #7119's scope and its falsifier |
| authority | auto-void edits another row's gate | refused by default; if adopted, bound by event + notification |

## What I am not deciding

The disposition of the 19 stranded rows (cancel vs re-point) is lead's (#6656 is closed, D271
provisional). Sequencing of #7118-#7122 is pm's. I did not touch the broker or the queue.
