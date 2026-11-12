# One predicate, five readers — review of the #6497/#6498/#6499 amendments (#6953)

Read as a review of pm's amendments, not a restatement. Every path:line below was read in this tree;
nothing in this note is a claim about a command I did not run.

**Tree:** branch `item-6953`, which resolves `@earendil-works/pi-durable 1.3.0` from the lockfile (the
`sync-pi --link` step failed in this worktree), node v24.22.1, Linux. The seat root resolves 1.5.1, so any
suite number quoted here is from the 1.3.0 set — do not compare it to a seat-root run.

## What checked out (all verified by reading the cited lines)

| pm's claim | Evidence in this tree |
|---|---|
| There is no `enqueueWork`; the verb is `enqueueItem` | `src/rig.mjs:427` |
| The revise path carries no gate, so a second validation path would be built on assumption | `revise_work` at `src/rig.mjs:1373-1420`: no `blockedBy` handling anywhere in that block |
| The one seam to validate at is before the commit, ordered like `normalizeBlock` | `const gate = normalizeBlockedBy(args.blockedBy);` at `src/rig.mjs:778`, immediately followed by `normalizeBlock` and then `api.commit` |
| `queueItemLine` renders the gate unresolved | `src/rig.mjs:365`, called as `filtered.map(queueItemLine)` at `:1478`; the render is `blockedBy=1,2` with no lookup (`:367`) |
| `cancelItem` notifies only the counterparty | the notify branch speaks of `other` only; no dependents are collected |
| The `stranded-gate` check rule does not exist yet | `grep -c blockedBy src/checkup.mjs` → **0** |
| The cycle leg cannot fire today | `const id = queue.nextId++;` at `src/rig.mjs:442` — ids are monotonic, so no gate can name an id ≥ its own row |
| `workable()` is one of the readers, and `gateState` is not yet exported | `src/rig.mjs:320`; grep for `gateState` returns nothing |

## The defect the amendment still leaves open: one predicate, three different answers about a dangling id

There are already **two** independent gate resolvers, not five readers of one:

- `deadGateId` (`src/rig.mjs:313`) classifies a target as dead and is used by the **release guard**
  (`src/rig.mjs:1346`), which *refuses* to un-park a row whose gate is cancelled.
- `workable` (`src/rig.mjs:327`) walks the same `blockedBy` list and, for a target that does not exist,
  fails **open**: the comment at `:329` says "Ambiguous (no such item in the queue): the conservative
  default says workable."
- `queueItemLine` (`:367`) resolves nothing at all — it prints the ids.
- `heldgate` has its own view (`src/heldgate.mjs:200` `gateView(item).blockedBy`).

So `gateState(item, items)` is not just a shared helper; it must return a **state per gate**, and each
reader must declare its policy on that state in the same commit. Without that, "one predicate" hides the
real disagreement: the same row is *claimable* at claim time, *refused* at release, *silent* in the queue
line, and *unclassified* in heldgate. That is the contradiction #6186 and #6817 already reported — the wake
predicate and the claim predicate disagree because one resolves gates and the other does not.

**Concrete shape for #6951 (the prerequisite mint):**

| state | meaning | claim policy | release policy | queue line | `stranded-gate` rule |
|---|---|---|---|---|---|
| `closed` | target `done` | workable | allow | omit gate | no finding |
| `open` | target queued/held/deferred | not workable, reason `gate-open:#id` | refuse | show ids | no finding (it is waiting legitimately) |
| `cancelled` | target cancelled | not workable, `gate-cancelled:#id` | refuse | show ids **plus** "gate cancelled" | finding |
| `dangling` | id names no row | decide once, fail-open is acceptable for claim | refuse | render `(unknown)`, never `(done)` | finding |

The falsifier pm proposed — remove the shared predicate from one reader and show the probe go red — is
right, and it needs one more case: a forged row whose gate names an id that does not exist must produce
`(unknown)` in the line **and** the same decision from claim and release. Today it cannot, because those
two readers do not share a function.

## Failure modes at this seam, with the recovery path

1. **Contradiction** (above): claim says workable, release says no, line says nothing. *Recovery:* single
   predicate, per-reader policy table, one demo asserting all four states.
2. **Silent** — `queueItemLine` printing an unresolved id reads as normal. *Recovery:* render `(unknown)`;
   defaulting to `(done)` is the lie this whole class produces.
3. **Cascade** — a cancelled parent strands dependents whose wake never fires, because the wake signature
   does not see the gate. *Recovery:* `cancelItem` collects dependents, puts their ids in one notice, caps
   at 20 plus "…N more" (#6499's shape), and the wake predicate uses the same `workable` predicate claim
   uses.
4. **Loop** — a stranded row that wakes forever. *Recovery:* the bounded walk stays as future-proofing only;
   cycle detection belongs in a constructed-graph demo, since a monotonic-id store cannot produce one
   (`src/rig.mjs:442`), and an assertion that cannot fire is not a test.

## Re-verify

```bash
grep -n "function deadGateId\|export function workable\|gateState" src/rig.mjs   # gateState: no hits yet
grep -n "normalizeBlockedBy" src/rig.mjs                                          # 778 is the one seam
grep -c "blockedBy" src/checkup.mjs                                               # 0: the rule does not exist
grep -n "queue.nextId" src/rig.mjs                                               # 442: monotonic ids
node tools/probes/<the 9ae345df probe>                                            # RED at that tip - I did not run it
```
