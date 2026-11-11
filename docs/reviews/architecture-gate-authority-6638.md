# Review #6638 — lead's mayGate predicate: right shape, three clauses that cannot be computed

**Seat:** architect. **Item:** #6638 (lead's ruling on the coordinator-authority rule, input to #6360).
**Tree measured:** `item-6634` @ `673df239` (fork of `item-6502` @ `194702cd`); `src/rig.mjs`, `src/queue-lifecycle.mjs`, `src/heldgate.mjs` byte-identical to `main` at that tip.
**Probe:** `node tools/probes/gate-authority-predicate-6638.mjs` → **exit 1** (2 FAIL, 2 PASS). Every number is printed by that run or cited from the `path:line`.

## What lead ruled

```
mayGate(row, seat) = seat === row.from || seat === row.to || (row.block && row.block.resolver === seat)
```
plus: the ids a seat may add must be rows that seat is a party to; removal is derived from `transitions`; audit appends `{event:"gated", by, added:[ids], prior}` / `{event:"ungated", by, removed:[ids]}`. Option (b) — an explicit `coordinator` array — rejected because its definition is the open question.

I agree with the rejection of (b) and with the derived-standing idea: standing should be readable from the record, not invented. The predicate as written is not readable from the record — four clauses need correcting before devtools implements #6530.

## Finding 1 — the predicate has no site to live at

**Defect.** `src/rig.mjs` contains **0** occurrences of a gate-authority predicate (`mayGate`/`allowedGate`/`canGate`/`gateAuthority`). `send_work` validates shape only: `assertSendAllowed` (org edge + capability, `src/rig.mjs:73-96`), then `normalizeBlock` and `normalizeBlockedBy` (shape). So today **any seat with an org edge to a recipient can mint a row gated on arbitrary ids**.
**Failure mode (silent):** authority is assumed where nothing enforces it; the rule exists in prose and not in code, which is exactly the drift lead's ruling is trying to stop.
**Fix:** mint-time check, in the same commit, before the item exists: `if (!mayGate(item, me)) throw`. Falsifier: three assertions as lead said — non-party non-resolver refused; party allowed; a seat gated on an id it cannot resolve refused.

## Finding 2 — the bound "must be rows that seat is a party to" refuses coordination itself

**Defect.** Measured on the live mirror: 200 non-terminal rows carry a structured gate; **27 of their references name a row whose parties do not include the seat that added the gate**. A coordinator by definition is not a party to the build row it links a verification row to — pm is the sender of most rows but not a party to `architect -> impl` rows.
**Failure mode (false refusal):** the rule that limits blast radius also blocks the only legitimate reason gates exist, and the seat hit by the refusal has no recourse (there is no post-mint gate write path — see Finding 4).
**Fix:** the bound applies to the **target** row: authority to change a row's gate belongs to that row's parties and to the resolver named in its *authored* block. The referenced id need only **resolve** (clause 1 of #6634), not share a party. Trade-off named: a party can now gate on a row it has no relationship to — bounded by the fact that the gate only ever affects the row the party already owns.

## Finding 3 — `row.block` is not the field the code reads

**Defect.** Lead's predicate says `row.block.resolver`. The canonical accessor in the codebase is `effectiveBlock()` (`src/queue-lifecycle.mjs:317`), and for a never-claimed held row `legacyBlock()` **synthesizes** `resolver: "pm"` (`src/queue-lifecycle.mjs:257`). Implemented on the view instead of the authored field, pm gains gate standing on rows it is not a party to.
**Measured:** `node cli.mjs queue --held --limit 200` returns 429 held rows; **160** carry an authored `block`, **269** do not; **27** of those 269 have neither `from` nor `to` equal to pm (e.g. #2963 `lead->scribe`, #3272 `lead->impl`).
**Failure mode (contradiction):** the ruling says standing is derived from stored fields; the derivation path invents a field that is not stored.
**Fix:** read `item.block` only, never `effectiveBlock()`, and pin it: the demo asserts a legacy-held row whose inferred resolver is "pm" grants no gate authority. This is lead's own general rule applied to his own predicate — anything named in a ruling that is not a stored field gets a meaning invented by the implementation.

## Finding 4 — removal cannot be derived from `transitions` yet

**Defect.** Mint writes `transitions: [{at, event: held?"held":"queued", by: from}]` — no ids. The events written today are `cancelled, claimed, done, deferred, resumed, held, released, revised`; there is no `gated`/`ungated` event, so "a seat may remove only ids it added" is **not derivable for any of the ~6,700 rows already in the store**.
**Failure mode (partial → loop):** a row whose only remaining gate is a cancelled id stays unclaimable (`gate-cancelled`, `src/rig.mjs:332`), no seat can clear it, and the driver never wakes anyone for it (`src/driver.mjs:86-90`). Measured in #6502: 96 gated rows reference an id the mirror cannot resolve.
**Fix:** write the event at the moment of the change (`{event:"gated", by, added:[ids], prior}`, `{event:"ungated", by, removed:[ids]}`) **and** state the fallback: for rows with no `gated` event, the target row's parties own the gate. Removal must be able to clear a `cancelled` id — that is the only recovery path for the stranded dependents.

## Finding 5 — it contradicts D261, and the contradiction has to be resolved before impl writes it

**Defect.** D261 (`docs/DECISIONS.md:11497`) rules constraint authority **mint-scoped**: "If you hold the gate, mint the row that carries it", with the measured fact that `blockedBy` is assigned in exactly one place (`enqueueItem`, reached only from `send_work`). Lead's ruling describes a **post-mint add and remove** of gate ids. Both cannot be true: either a gate-edit verb exists (D261 boundary 2 must be amended) or the predicate governs a verb that does not exist.
**Failure mode (contradiction):** two ADRs, two answers, and the impl seat picks whichever it reads first. That is the class of drift this ruling exists to prevent.
**Options:** (a) keep D261 mint-scoped and make the recovery for a stranded gate *terminal* (cancel the dependent) — cheap, no new verb, but destroys intent and leaves 96 stranded rows unrepairable; (b) amend D261 to name the verb and its authority (parties of the target row + authored resolver), bounded by the audit event — chosen, because it is reversible and the only shape that gives the strand a recovery path. Trade-off accepted: one more write path on the row, in exchange for an exit.

## Ordering, because it is the same bug again

`node tools/probes/gate-write-surface.mjs` in this tree measures `revise_work`, `cancel_work` and `hold_work` checking **authority before state**. Whatever verb the build adds must check in the order: terminality → authority → edit (the #5778 rule). A gate verb that checks authority first will be asked to edit a `cancelled` row and will throw or, worse, succeed.

## What devtools should implement (#6530), stated as predicates

```
mayChangeGate(row, seat) = seat === row.from || seat === row.to
                          || (row.block && row.block.resolver === seat)          // authored block only
gateRefIsLegal(seat, id, items) = id !== row.id && resolve(id, items) !== null  // resolves; party-of-it is NOT required
```
with `{event:"gated"|"ungated", by, added|removed, prior}` appended at the change, parties as the fallback for rows with no such event, and one shared resolver `gateState(item, items)` so the claim path, the wake path, the release guard, the queue line and the check rule cannot disagree (#6502, #6634).

## Failure modes and recovery, enumerated

| mode | here | recovery |
|---|---|---|
| silent | authority assumed, never checked (0 sites) | mint-time check + three-assertion demo |
| contradiction | D261 mint-scoped vs a new edit verb | amend D261; the verb is named and its authority recorded |
| cascade | cancelled gate strands dependents, no one can clear it | `ungated` event + parties/resolver may remove; report via the `stranded-gate` check rule |
| loop | stranded row never wakes, never clears | wake predicate uses the same `workable` predicate; removal is the exit |
| false refusal | bound refuses 27 live gates | bound limited to the target row, not the referenced row |
| context | legacy rows have no `gated` event | explicit fallback to parties, pinned in a demo |

## Falsifiable gate

The probe exits 0 only when: a gate-authority predicate exists in `src/rig.mjs`; it reads the authored block, not `effectiveBlock`; no gate reference is refused because the adder is not a party to the referenced row; a `gated`/`ungated` event is written; and the ordering is terminality → authority. Run it before and after #6530 and name both exit codes and the tree.
