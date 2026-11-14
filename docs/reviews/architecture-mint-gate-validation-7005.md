# The mint seam: reference validation, and the invariant it buys for free (#7005)

Reviewed by architect, 2026-11-12. Trigger: pm's re-cut of ruling #6758 into legs #7001-#7004.
Tree: branch `item-7005`, `@earendil-works/pi-durable` **1.3.0** from this worktree's lockfile (the seat
root resolves 1.5.1 — do not compare verdicts across the two).

## 1. What the seam does today, read from the code

`normalizeBlockedBy` (src/rig.mjs:434-451) checks **shape only**: an array of positive integers, deduped.
Nothing asks whether the id exists, whether it is this row's own id, or whether it is already terminal.
The read side then decides claimability conservatively (src/rig.mjs:320-335): an unknown id is skipped
and the row is workable.

Measured, not assumed — `node tools/probes/mint-gate-validation-7005.mjs` (exit 1, four gaps):

| minted shape | accepted? | stored | read verdict |
|---|---|---|---|
| `blockedBy:[9999]`, no such row | **yes** | `[9999]` | `workable=true, reason=null` |
| `blockedBy:[2]`, row #2 `cancelled` | **yes** | `[2]` | `workable=false, gate-cancelled:#2` |
| `blockedBy:[5]` on the row that becomes #5 (self-gate) | **yes** | `[5]` | `workable=false, gate-open:#5(queued)` |
| forward reference to a row minted later | **yes** | `[99999]` | `workable=true` |

The self-gate is the sharpest of these: a row gated on itself is **permanently unclaimable**, never
wakes, and `deadGateId` (src/rig.mjs:312) returns null for it — so the release path treats it as a
release-candidate while the claim path can never claim it. That is a locked row in the store, and it
is reachable: a seat can name the id it is about to get.

The bounded-view trap pm carried forward is real and pinned: `--with-gates` is capped
(cli.mjs:1414, `GATE_VIEW_CAP` from src/queue-lifecycle.mjs). A validator that read a projection would
refuse ids beyond the cap. Validation must read `tx.doc(RigQueue).items` — the same doc the mint
writes.

## 2. The invariant #7001 buys for free, and it is the reason to accept it

If a gate id must exist **at the instant of mint**, then every accepted edge points to an **older** id
(ids are monotonic: `queue.nextId++`, src/rig.mjs:455-458). A cycle needs A→B and B→A with both
existing; the later mint can only reference the earlier row. So **mint-time existence validation makes
the gate graph of every new row a DAG**, and the transitive walk in #7105 provably terminates for new
rows without a cycle guard.

Consequence for the two workstreams: the `visited` set and `MAX_DEPTH` in #7105 are **not** protection
for new rows — they are protection for the legacy rows minted before validation (pm's figure: ~6,718; my own count of rows carrying a structured gate today: 405). My #6999
census (`node tools/probes/nested-gate-census-6999.mjs`, exit 0) found **6 cycles** in the live store;
under the rule those cannot be reproduced. That is the boundary the runbook (#7004) must state: strict
at mint, conservative at read, and the cycle guard is for legacy data.

Attribution of the legacy count: the **6,718** figure is pm's, quoting #3747 in #7005's body — I did not
reproduce it. What I measured myself on the live store (`nested-gate-census-6999.mjs`, exit 0, 7101 rows):
**405** rows carry a structured gate, **61** have a directly cancelled hop, **155** are open at depth 1,
**15** are permanently uncloseable and **6** of those are cycles. The cycle count is the number that the
DAG invariant makes impossible going forward.

## 3. Failure modes at the seam, each with a recovery and a falsifier

| # | failure | why it happens | recovery | falsifier |
|---|---|---|---|---|
| 1 | **silent** — a dangling id reads as "no gate" | the read default skips unknown ids | mint refuses it, so the population cannot grow; the read default stays for legacy rows only | probe assertion "dangling accepted" flips from 1 to 0 |
| 2 | **hard** — a gate id is not in the doc | decomposition mints the dependent before the gate | the refusal names the id and the remedy ("mint the gate row first"); nothing lands partially | mint dependent-then-gate, assert refusal and that neither row exists |
| 3 | **partial** — a batch is half-minted | each `send_work` is its own commit (src/rig.mjs:825), so leg 3 refusing leaves legs 1-2 landed and 4-N never attempted | the decomposer counts minted ids against the plan; the runbook makes that a step | count rows before/after a 4-leg decomposition with one bad gate |
| 4 | **contradiction** — release says "all gates terminal", claim says "cancelled hop" | `heldgate.mjs:105-107` counts `cancelled` as closed; `workable` treats it as positive unworkability | both call the same walk; the audit line names the hop | a held row gated only on a cancelled row must classify as dead-gate, not release-candidate |
| 5 | **false refusal** — a valid queue gate rejected because prose mentions the same number | #7002's discriminator keys on the row's **text** naming `ROADMAP <n>` | see §4: discriminate by existence, not prose | mint a row whose body says "ROADMAP 363" with `blockedBy:[<a real queue id>]` → must be accepted |
| 6 | **cascade** — a row minted against a live gate that is cancelled later | impossible to prevent at mint | report, never decide: `cancel_work` lists the dependents it strands (#7106, gated on #7105) | the stranded count in the census equals the reported list |
| 7 | **loop** — the walk never converges | legacy rows can form cycles | visited set + `MAX_DEPTH`, reason `gate-cycle:#<id>` | probe assertion 3 in `workability-transitivity-6999.mjs` |

## 4. The exact defect in leg #7002, and the fix

As written, #7002 refuses "a row whose own text names ROADMAP <n>/RM-<n> while `blockedBy` contains n".
That is a **prose** test applied to a **reference**. A row that legitimately gates on queue row 363 and
happily mentions "ROADMAP 363" in its body would be refused — a false negative, which starves real work
and looks exactly like an empty queue.

Concrete fix: the discriminator is **existence**, not wording.
- `blockedBy:[n]` where n is a queue row → accept, whatever the prose says.
- `blockedBy:[n]` where n is not a queue row → refuse, and if the row's text names `ROADMAP n`/`RM-n`,
  say so in the refusal: "gate #n names no queue row; a ROADMAP reference belongs in
  `block.constraints[{kind:'roadmap', ref:n}]`, not in `blockedBy`."
That keeps the id space unambiguous (bare integer = queue id) without inventing the typed
`{kind, ref}` gate the architect already rejected — and the refusal is targeted rather than blanket.

Falsifiable both ways: (a) prose mentions RM-363 + real queue gate → accepted; (b) `blockedBy:[363]`
with no row 363 → refused with the roadmap-aware message.

## 5. The leg that is missing

None of #7001-#7004 pins the **mint order contract**: gates exist before dependents. Legs #7001 and
#7003 change the write path; the batch-ordering failure mode (#3 above) lands on `pm` and every seat
that decomposes. It belongs in the runbook leg #7004 as an explicit step, with the counting check.

## 6. Options considered, and the trade-off accepted

- **(a) Validate existence + non-cancelled + non-self at mint** (chosen). One line of the write path,
  kills the class for new rows, and buys the DAG invariant. Cost: out-of-order batches get a refusal.
- **(b) Allow forward references inside the same transaction.** Rejected: it reopens dangling refs
  whenever the transaction aborts after the dependent lands in a later commit, and it makes the DAG
  invariant unprovable. The ordering rule is cheaper to document than the invariant is to re-establish.
- **(c) No mint validation; repair at read.** Rejected: every wake walks the graph of 6,718 legacy rows
  instead of making new ones impossible.
- **(d) Typed `{kind, ref}` gates.** Rejected earlier and recorded (#7002 notes it) so it is not
  re-litigated.

**Accepted trade-off:** strictness at mint (legible refusals, batch ordering discipline) in exchange for
a bounded read (depth 1 for claimability, bounded walk for stranding) and a graph that cannot cycle for
new rows. Reversible: relaxing the mint check restores today's behaviour exactly, and the legacy
population is untouched either way.

## 7. Not decided here

The cancelled-TWIN question (#3863, still held) and the disposition of the rows already gated on
cancelled ids (lead #6656) are scope calls, not predicate calls. This review bounds only the mint seam.
