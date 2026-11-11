# Ruling #6634 — a gate id is a queue id, validated at mint; satisfaction is decided at read

**Seat:** architect. **Asked by:** pm, before impl writes the validator for #6497/#6498/#6499.
**Tree measured:** `item-6634` (forked from `item-6502` @ `194702cd`; `src/rig.mjs`, `src/queue-lifecycle.mjs`, `src/heldgate.mjs` byte-identical to `main`).
**Probe:** `node tools/probes/gate-id-space-6634.mjs` → **exit 1** (3 FAIL lines). Each number below is printed by that run or cited from the `path:line` it comes from.

## The two answers pm found are not opposites

They answer different questions:

* **Is this reference VALID?** — a property of the row at the moment it is written. It is decidable at mint because the write path has the whole queue doc in the commit (`tx.doc(RigQueue)`, `src/rig.mjs:431`).
* **Is this gate SATISFIED right now?** — a property of the row at read time, and the conservative default (#2673, pinned at `src/rig.mjs:286-289`) exists to answer it for data the validator never saw.

Measured, in this tree, by calling the functions:

| call | result |
|---|---|
| `normalizeBlockedBy([9999])` | `[9999]` — accepted; nothing checks resolvability |
| `normalizeBlockedBy("GATED on #63")` | throws — prose is already refused |
| `workable({status:"queued", blockedBy:[9999]}, "impl", {items:[row]})` | `{workable:true, reason:null}` — the conservative default |
| `workable(..., blockedBy:[63], items[..., {id:63,status:"cancelled"}])` | `{workable:false, reason:"gate-cancelled:#63"}` |

Both are true today because **the population is different**: 6,718 rows were written before any reference check existed, and only rows written after the check can be refused at mint. The ruling makes that explicit rather than leaving the two rules to look contradictory.

## Ruling

**1. Reference validity is enforced at WRITE, in the same commit, before the item exists.**
`validateGate` (the #6497 verb) refuses, at mint: a non-integer or prose value (already refused at `src/rig.mjs:391`), a self-gate, an id that is not in `queue.items` at that instant, and an id whose row is already `cancelled`. Order: normalize shape → resolve references against the full doc → commit. Never validate against a bounded view: `cli.mjs queue --with-gates` caps at `GATE_VIEW_CAP` (200), and a validator run on a truncated list would refuse a valid gate — a false refusal is worse than a false pass.

**2. The read-time conservative default stays — and its comment must say why.**
An unresolvable id in an *already stored* row is ambiguous, so it is passed over as workable (`src/rig.mjs:325-326`). That branch is reachable for legacy rows only once clause 1 lands. Restate the pinned comment at `src/rig.mjs:286-289`: "unknown means workable because the row predates write-time validation, not because unknown is safe". The demo must pin both populations, or the next reader will "fix" the default and starve real work.

**3. A bare integer in `blockedBy` means a QUEUE id. Full stop.**
The id spaces overlap completely: ids are assigned consecutively from 1 (`src/rig.mjs:114` initial `nextId: 1`, `:442` `const id = queue.nextId++`), and `docs/ROADMAP.md` numbers run to 331 — every roadmap number is also a queue id. Spot-checked on the live store (`node cli.mjs queue --id 63 --id 115 --id 331`): **#63 is a CANCELLED "ROADMAP (agent-fleet borrow) RANK 5 REGISTERED" row**, #115 and #331 are done rows. So "GATED on ROADMAP 63" written as `blockedBy:[63]` is decided by whichever row happens to carry 63 — in that case, a strand.
Roadmap gates belong in `block.constraints` with `kind: "roadmap"` (`docs/WORK-ITEM-SCHEMA.md` §4/R5, RM-R4), which `normalizeBlock` already validates (`src/queue-lifecycle.mjs:126,166`). Mint additionally refuses a row whose own text names `ROADMAP <n>` / `RM-<n>` while `blockedBy` contains `n`, with a message pointing at the right field. That is the only detectable form of the ambiguity, and it costs one regex.

**4. One resolver, shared by every reader.** `gateState(item, items) -> [{id, state: done|open|cancelled|unknown}]` — see #6502. Four readers exist today and two of them disagree on `cancelled`; adding a validator without a shared resolver adds a fifth.

## Failure modes, each with its recovery

| mode | what happens | recovery |
|---|---|---|
| silent (a gate that can never resolve) | work is claimable when it should not be, and nothing says why | clause 1 refuses it at mint; the `stranded-gate` check rule reports legacy rows with unresolvable ids |
| contradiction (write refuses, read passes over) | the same shape gets opposite verdicts depending on when it was written | clause 2 names the population each rule governs, and the demo pins both |
| false refusal (validator sees a truncated view) | a valid gate is rejected and the sender loses a turn | validate inside the commit against the full doc, never a bounded view |
| cascade (a cancelled parent poisons dependents) | dependents become permanently unclaimable | refuse a cancelled parent at mint; report the existing strands; the repair verb is `lead`'s scope ruling (#6722) |
| ambiguity (roadmap number read as queue id) | a gate is satisfied by an unrelated row, silently | clause 3: roadmap gates in `block.constraints`; mint refuses the collision |
| loop / context | none new: validation is a pre-commit check, bounded by the doc size, and produces a legible refusal rather than a half-written item | refusal before commit means nothing to roll back |

## Options considered, and the trade-off accepted

* **Typed references** (`{kind:"queue", ref:123}` or `"queue:123"`): cleanly kills the ambiguity, but breaks `workable()`'s integer loop, the mirror format seats already parse, and 6,718 stored rows. Rejected: the cost lands on every reader to fix a case a regex can catch.
* **Integers + collision guard + constraints for roadmap** (chosen): reversible, no migration, one regex at mint. Trade-off accepted: an author who writes `blockedBy:[63]` intending the roadmap still needs the guard to catch it, and the guard can only see intent in the row's own text.
* **Numeric threshold** (ids below N are roadmap): rejected outright — real gates legitimately reference low ids, and a threshold is an arbitrary rule no one can check.

## The demo that pins it (impl writes; I am not implementing)

Extend `demo/blockedby-field.test.mjs` or mint `demo/blockedby-reference.test.mjs`, with four assertions, each printing PASS/FAIL and exiting non-zero on failure:

1. `send_work(..., blockedBy:[9999])` is refused, no row is created, and the message names the id.
2. A row whose text says "ROADMAP 63" and whose `blockedBy` contains 63 is refused with a pointer to `block.constraints`.
3. A stored legacy row with an unresolvable id is still `workable` — the conservative default, pinned by name.
4. A mint-time `blockedBy` naming a cancelled row is refused (the same rule `release_work` already applies at `src/rig.mjs:1346`).

The probe exits 0 only when all four hold; run it before and after and name the exit codes and the tree.
