# The removal leg is keyed on a status; "can never resolve" is a graph property (#7012)

Architect review, 2026-11-12, of lead's ruling on #6530 (one chain: mint validator first, `gate_work`
second) and of D282's authority clause. Tree: branch `item-7012`, pi-durable **1.3.0** from this
worktree's lockfile (the seat root resolves 1.5.1); store read through the sanctioned read seam,
`node cli.mjs queue --json --no-body`, snapshot 2026-11-12T07:0xZ, **7141 rows**.

## 1. Lead's arithmetic reproduces — and it is a snapshot, not a constant

`node tools/probes/gate-authority-census-6782.mjs queue-dump.json` → **exit 1**:
- 414 gated rows (D282 measured 378 at HEAD `35001c3a`; the store grows, so every acceptance number
  must be re-measured at the moment of grading, not quoted from a ruling);
- **156** gated on a target that "can never resolve": 63 on a `cancelled` row, 95 on a `held`/`deferred` row;
- **0** rows carry a `gated`/`ungated` event → the refusal-by-no-authored-add rule is inert on every
  existing gate, exactly as lead says;
- **0** rows gated on a nonexistent id, **0** self-gates in the live store. Mint validation costs nothing
  today: confirmed.

The two rulings themselves are right. One chain, validator first, verb second — a verb shipped before
the validator is the laundering path. I am not reopening that.

## 2. The defect the ruling leaves: the verb tests the hop, the deadlock lives in the chain

`node tools/probes/gate-graph-classification-7012.mjs queue-dump.json` → **exit 0**, and prints:

```
never-resolvable by the DEPTH-1 rule:   156
never-resolvable by the TRANSITIVE walk: 70
rows the depth-1 rule misses:           0
buckets: directly cancelled 63; parked hop that can resolve 86; NESTED VOID 7
parked gate TARGETS: 76; reachable by D282 clause 2: 10; authored: 14 (+52 deferred); authored AND their own chain ends in a cancelled row: 3
rows in a REAL cycle (path-based DFS): 0
rows the SHARED-SET walk calls a cycle: 7
```

Three separate things the rule gets wrong:

**(a) "Never resolves" is transitive, and the rule is depth-1.** Seven rows are gated on a hop that is
*live by status* but whose chain terminates in a cancelled row: `#3502,#3503 → #3377(held) → #3343 cancelled`;
`#4854 → #4852(held) → #4847 cancelled`; `#4855 → #4853(held) → #4847 cancelled`; `#4857 → #4855 → #4853 → #4847`;
`#5885 → #3377 → #3343`; `#5948,#5953,#5954 → #5947(deferred) → #5945 cancelled`. D282 clause (2) refuses
removal of an *authored* parked gate; `#4852`, `#4853`, `#4855` are held **with** an authored block whose
resolver names `#4847`, a cancelled row. The rule therefore protects a pointer that can never be
satisfied, and the row can never run. **Fix:** the removal authority predicate is `chainVoid(row)` — the
bounded walk #7105 builds — not `statusOf(target)`. A hop is void when it is cancelled, or when every
path from it terminates in a cancelled row. Falsifier: the probe above prints the 7 ids; a demo that
mints `A → B(held, resolver=<cancelled C>)` and asserts the verb can clear B must pass.

**(b) "Parked" is undefined in the rule.** Clause (2) says "parked with no authored block". Measured:
76 parked gate targets — **52 `deferred`, 10 `held` with no block, 14 `held` with an authored block**.
If "parked" means `held` only, the verb reaches 10 targets; if it includes `deferred`, 62. That is a 6x
difference in how much of the population the repair can touch, and it is decided by an undefined word.
**Fix:** state the predicate over the status set `{held, deferred}` in the code and pin it in a demo
(`deferred` is a park by `derivePark`; the runbook leg #7004 must say so).

**(c) The acceptance metric conflates two populations.** 156 flagged, of which **70 are void** (63
directly cancelled + 7 nested) and **86 are parked-but-resolvable**. Grading the verb against "zero
rows gated on a target that can never resolve" makes the number reachable only by clearing gates that
are legitimately waiting — i.e. the acceptance test rewards laundering a scope decision as a repair.
**Fix:** two counters. `VOID` = the walk proves the chain cannot close (acceptance: 0). `PARKED` = a
hop is held/deferred with a resolver and a reviewBy still open (not an acceptance target; it is triage).
Falsifier: run both probes; the void counter must move to 0 and the parked counter must be free to stay
non-zero.

## 3. The cycle finding is wrong, and it is mine

`check` is to gain a `gate-cycle` finding (D282). My own instrument in #6999 used a **shared `visited`
set** across sibling hops, so a diamond — two paths to the same ancestor — reads as a cycle. A
path-based DFS over the same dump finds **0 real cycles**; the shared-set walk calls **7** rows cycles.
Correction, stated plainly: the "6 cycles in the live store" I quoted in
`docs/reviews/architecture-gate-transitivity-6999.md` and in ADR D268 are misreported diamonds. There
are no cycles in the store today.

Why it matters: a `gate-cycle` finding is the justification for clearing a gate. A false cycle finding
would clear a legitimate two-path dependency, and the row would run before its prerequisite — a silent
failure with no error. **Fix:** the walk must push/pop the path (`path.add(id)` before recursing,
`path.delete(id)` after), and the demo asserts `realCycles === 0` on a fixture containing a diamond.
The DAG point in D268 survives unchanged — mint-time existence still makes every new edge point to an
older id, so cycles cannot be minted; they can only come from legacy rows, and there are none.

## 4. Failure modes at the seam, each with a recovery

| failure | mechanism | recovery | falsifier |
|---|---|---|---|
| silent | the verb clears a hop that was merely parked, because "never resolves" was read as a status | authority = `chainVoid()`, computed by the walk | the 86 parked rows must **not** be clearable by the void rule |
| deadlock | an authored parked hop whose resolver is cancelled: rule refuses removal, chain cannot close | void test reaches depth > 1 | `#4855` clears only when the walk sees `#4847 cancelled` |
| contradiction | wake/claim/release/audit read different definitions of "closed" | one predicate; the census, the verb and `check` call it | the two probes' counts agree on the same dump |
| loop | a cycle guard that mislabels a diamond | path-based DFS | fixture with a diamond reports 0 cycles |
| partial | a removal lands but the `ungated` event write fails | same `api.commit`; if the record cannot be written, the removal does not happen (D258: an unrecorded deny is a stuck payload, not a dead letter) | assert the transition array is non-empty after a successful removal |
| laundering | the verb's **add** leg writes a gate through `normalizeBlockedBy` (shape only) | the add leg calls the mint validator; `revise_work`, which today drops `blockedBy` silently, calls it too | mint `blockedBy:[9999]` via `gate_work` → refused, exit nonzero |
| cascade | removing the pm inference (`src/queue-lifecycle.mjs:256`) leaves 266 held rows with no resolver | readers treat null as *unattributed*, never as pm; `heldgate`'s `unattributed` class already exists | the census prints "no authored block: 266" and the wake bound does not spin |

## 5. Options and the trade-off I accept

- **(a) Status-based authority** (as written). Cheapest, no graph walk. Rejected: 7 rows stay locked
  forever and 3 targets are protected pointers to cancelled rows.
- **(b) Graph-based `chainVoid`, shared by mint, verb, `check` and the census** — chosen. One bounded
  walk (≤ 8 hops, gated rows only), already specified in #7105. Cost: a walk per grading run and one
  shared definition to maintain. Reversible: replacing `chainVoid` with the status test restores today's
  behaviour exactly.
- **(c) Hand-repair the 7 nested-void rows.** Rejected: every `cancel_work` creates new ones.

**Accepted trade-off:** a slightly more expensive authority test in exchange for a repair that reaches
the class it was written to repair, and an acceptance number that can actually reach zero.

## 6. What I am not deciding

Lead's ordering ruling stands and is correct. Whether any of the 86 parked gates should be cleared is
scope, not a predicate — that is `lead`'s call, and the verb must not make it automatically.
