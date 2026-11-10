---
review: gate-reference-validation
item: #6357
seat: architect
asked_by: pm
date: 2026-11-10
tree reviewed: main @ 41000315 (verified identical to this worktree's base e06626af for
           src/rig.mjs, src/checkup.mjs, src/readapi.mjs — `git diff e06626af 41000315 --stat` on those
           paths is empty); probe run in worktree item-6310
status: review-before-ship — the build is routed as #6356 to impl; this is the contract it must satisfy
---

# A gate that is never resolved is a comment, not a gate

## 1. What is actually there, measured

- `normalizeBlockedBy` (`src/rig.mjs:368-393`) validates **shape only**: an array of positive integers,
  duplicates collapsed, prose rejected. It never asks whether the id exists.
- `workable` (`src/rig.mjs:303-319`) reads the gate: `const target = items.find((it) => it.id === id); if (!target) continue;`
  — the conservative default from #2673 ("missing or ambiguous means WORKABLE") applied to a
  **reference that is not merely ambiguous but wrong**.
- `validateGate` exists nowhere on main: `grep -rn "validateGate" src demo docs tools extensions` → 0 hits. The
  item-3570 branch's validator is unlanded, so today the enqueue path has no reference check at all.
- `src/checkup.mjs` has **zero** rules that read `blockedBy`.

Probe: `node tools/probes/gate-reference-validation.mjs` → **exit 0**, output:

```
  MEASURED  [9999] -> workable=true, reason=null. A gate on a NON-EXISTENT id is silently satisfied.
  MEASURED  [11] -> gate-cancelled:#11; selectOldestWorkable skips it: [{"id":12,"reason":"gate-cancelled:#11"}]
  MEASURED  self-gate -> gate-open:#13(queued), forever
  MEASURED  cycle: gate-open:#15(queued) / gate-open:#14(queued) — nothing reports it AS a cycle
  MEASURED  gate on a held parent -> gate-open:#16(held)
  PASS  normalizeBlockedBy rejects 5/5 malformed shapes — it accepts [9999], [self], and a cycle
  PASS  src/rig.mjs contains NO gate reference validator
  PASS  src/checkup.mjs has 0 rule(s) reading blockedBy
  the missing validator, run on the cases above:
    #10 [9999] -> REJECT: dangling:#9999
    #12 [11]   -> REJECT: gate on a cancelled parent:#11
    #13 [13]   -> REJECT: self-gate, cycle back to this item
    #14 [15]   -> REJECT: cycle back to this item
    #15 [14]   -> REJECT: cycle back to this item
    #17 [16]   -> ok            (a held parent is a legitimate gate: it can be released)
RESULT: 0 measured finding(s)
```

And the live rig, read off the mirror file (no store opened): `queue-all.md` lists **1,178 non-terminal
rows, 178 of which carry a gate**, and **93 of those gates reference an id the listing does not contain**.
Zero cycles. The 93 are not necessarily typos — the mirror omits terminal rows, so a satisfied gate
(`done` parent) and a dead gate (typo) render identically. That is the second half of the defect: the
seat can see the gate but not its state.

## 2. The seam and the contract

```
 send_work / revise_work ──▶ normalizeBlockedBy (shape)  ──▶ stored as an array field
                                   │
                                   └── MISSING: reference validity — does the id exist?
                                            is it terminal? is it self? does it close a cycle?
 workable() ──▶ reads the field, defaults unknown to WORKABLE
 queueItemLine() (rig.mjs:348) ──▶ renders "blockedBy=1,2" with NO status, so the reader cannot
                                   distinguish satisfied from dead
```

An item's input contract for a gate is currently "a list of positive integers". It should be: **a list of
ids that exist in this store, none of them the item itself, none already cancelled, and none forming a
cycle back to the item.** Existence is decidable at the moment of write — the gate is written inside the
same transaction that has the queue doc. Deferring that decision to read time is what makes the typo
silent.

**Why the conservative default in `workable` is not the bug.** #2673's ruling — absent or ambiguous means
workable — is correct for *missing signal*. A gate pointing at an id that never existed is not a missing
signal; it is a malformed reference. Validate at write, keep the default at read. Those are different
seams and conflating them is how a typo becomes a green.

**Why enqueue-time validation is sufficient:** `blockedBy` is set on the enqueue path and `revise_work`
touches only subject and body, so a gate cannot gain a new reference later. Cycles can therefore only be
born at enqueue. **This is a load-bearing assumption**: the moment anything is allowed to mutate
`blockedBy`, the same validator must run on that mutation, and the demo must assert it.

## 3. Failure modes, each with a recovery and a falsifiable check

| Mode | What happens today | Recovery | Check that falsifies it |
|---|---|---|---|
| **Silent** | `blockedBy:[9999]` → workable, work starts that should have waited | reject at enqueue, name the id | probe case 1 |
| **Cascade** | a parent is cancelled after the child is enqueued → child blocked forever, no exit | on cancel, report or un-gate dependents; the child's reason must name the resolver | probe case 2 plus a demo: enqueue child gated on parent, cancel parent, assert the child is either workable or reported |
| **Loop** | two rows gated on each other: both unworkable, no named cause | bounded walk at enqueue (`steps <= items.length`) rejects the cycle before either row is stored | probe cases 4 and 8 |
| **Contradiction** | the revise-path validator and the enqueue validator disagree | one exported validator, both paths call it; a demo asserting identical verdicts for the same gate written two ways | a gate `[9999]` must be refused by both paths |
| **Partial** | the gate is stored but its state is unreadable to the seat | render `blockedBy=<id>(<status>)` in the queue line | the mirror line for a satisfied gate must show `(done)` |
| **Context** | a gate on a `held` parent reads `gate-open:#16(held)` with no pointer to who releases it | reason must carry the park's resolver (`block.resolver`) | assert the reason string names the resolver |
| **Unbounded** | a validator that walks the whole 6,021-row queue per enqueue | bound the walk to the gate chain, not the store; the probe's walk is O(gate + chain) | time the enqueue at 5,000 rows; the assertion is that it is not O(store) per write |

## 4. Options and the trade-off I accept

- **(a) Reject at enqueue.** Cost: a seat cannot reference an item it plans to create later, and gates on
  ROADMAP rows (`RM-329`) must not be squeezed into `blockedBy` — roadmap ids are not queue ids; the
  structured `block.constraints` with `kind: "roadmap"` is where those belong. Accepted: an unresolvable
  gate is not a gate.
- **(b) Report only, via a check rule.** Cheap, catches the pre-existing 93 references, but the work is
  already stranded by the time it is reported. Keep as the observability layer, not the gate.
- **(c) Silently drop unresolvable ids.** Rejected: that rewrites the sender's intent without consent and
  produces exactly the "gate that looks present but isn't" class this row is about.

## 5. What the impl row (#6356) should carry, concretely

1. One exported `validateGate(blockedBy, items, selfId)` in `src/rig.mjs` next to `normalizeBlockedBy`;
   `enqueueWork` and `reviseWork` both call it. Reject: dangling id, self-gate, cancelled parent, cycle.
   Error text names the offending id and the reason — the same structured-cause pattern as
   `assertStoreReadable` (`src/readclient.mjs:74-79`).
2. Keep `workable`'s conservative default for genuinely absent data; do not make it decide reference
   validity.
3. Render the gate with its state in `queueItemLine` (`rig.mjs:348`): `blockedBy=2823(done),2572(queued)`.
   Without this, the 93 references above stay uninterpretable.
4. On `cancel_work` of a parent, emit the dependents' state to the notice — a cancelled gate is a dead
   lock, and the child seat must see it rather than silently never waking.
5. A check rule that **reports** (never decides): rows gated on terminal ids, rows whose gate chain
   exceeds a bound, rows in cycles. Reporting is how a heuristic becomes recoverable; deciding is how it
   becomes an unauthorised block.
6. Demo acceptance, red before green: `[9999]` refused at enqueue; a self-gate refused; a two-row cycle
   refused; a gate on a `done` parent accepted; a gate on a `held` parent accepted and its reason naming
   the resolver; the queue line rendering the parent's status.

## 6. Evidence

- `node tools/probes/gate-reference-validation.mjs` → exit 0; output quoted above; `node --check` on the
  probe → exit 0.
- Live-store read, no store opened: `node -e` parse of `/home/chexxor/Git/Durian-Pi/.durig/queue-all.md`
  → 1,178 non-terminal rows, 178 gated, 93 gate references not present in that listing, 0 cycles.
- `grep -rn "validateGate" src demo docs tools extensions` → 0 hits (exit 1, no matches).
- Code read at main `41000315`: `src/rig.mjs:303-319` (workable), `:331-340` (selectOldestWorkable),
  `:348` (queueItemLine), `:368-393` (normalizeBlockedBy); `src/readapi.mjs:218,224,228,282,301` (terminal
  rows are retained in the doc, views are bounded — so ids stay resolvable).
- Caveat: this worktree resolves `@earendil-works/pi-durable` 1.3.0 from the lockfile (`sync-pi --link`
  failed) while the seat root resolves 1.5.1. The gate probe touches only `src/rig.mjs` functions, so the
  dependency set does not affect these findings.
