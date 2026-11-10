---
review: revise-authority-boundary
item: #6225
seat: architect
asked_by: pm
date: 2026-11-10
tree: item-6185 @ f192f543
status: ruled; the build is routed, not implemented here
---

# Who may change a routed row — the boundary, and the verb that does not exist

## 1. What was asked, and what the ask is really about

pm's row: *the coordinator has routing authority but not edit authority* — may the coordinator
amend the body of a QUEUED row it routed, before it is claimed, and never after?

Read as a script, that is a permission question. Read as an intent, it is a **schema** question.
pm's actual constraint was "batch the minting, gate at creation" — a *gate*. A gate is enforceable
only where the claim predicate can see it. `workable()` reads `item.blockedBy`
(`src/rig.mjs:310`); it never reads a sentence. So widening body-editing answers the first
question and leaves the second completely untouched: the constraint would still be prose, and
prose gates are the thing this rig has already measured decaying
(`docs/WORK-ITEM-SCHEMA.md` R5; `demo/queue-held-gates.test.mjs` exists because a seat cannot
tell *why* a row is parked).

The ruling below therefore answers two things: **(a)** who may touch which field of a row, and
**(b)** where a constraint must be written for it to be a constraint at all.

## 2. Topology: a row has four kinds of content; only two have an authority rule

| Content | Fields | Write path | Authority rule | Measured |
|---|---|---|---|---|
| **Intent** | `subject`, `body` | `revise_work` (pre-claim) | `from` **or** `to` | refused for a third seat, `src/rig.mjs:1291`; refused once claimed, `:1297` |
| **Constraint** | `blockedBy`, `requires`, `tier`, `block` | `enqueueItem` **only** (`src/rig.mjs:441`, called at `:737`) | the minting seat, at mint | no other assignment exists in `src/rig.mjs` — grep: `blockedBy` is assigned only in `enqueueItem`, read in `workable` (`:310`) and `renderQueueLine` (`:350`) |
| **Disposition** | `status`, `transitions` | claim / hold / release / defer / resume / complete / cancel | per-transition (see `docs/WORK-ITEM-LIFECYCLE.md` §2) | `hold` = recipient only (`:1212`); `release` = either party (`:1257`); `cancel` = either party (`:1339`) |
| **Outcome** | `resultSummary`, `evidence`, `question`, `cancelReason` | written by whoever made the move | the actor | — |

The load-bearing asymmetry is row 2: **constraints are mint-only.** There is no post-mint write
path for a gate, for anyone — not for the sender, not for the recipient, not for the coordinator.
That is the gap pm hit, and it is not a permissions gap. It is a missing verb.

## 3. Measurements

All six from one run, `node tools/probes/revise-authority-boundary.mjs` → **exit 0**, 2026-11-10,
in the isolated worktree `item-6185` @ `f192f543` (faux provider, `MemoryStorage` — no live store
opened, no key, no broker process). The four existing contracts re-run green in the same tree:
`demo/curate.test.mjs` exit 0, `demo/revise-work-contract.test.mjs` exit 0,
`demo/queue-held-gates.test.mjs` exit 0, `demo/cancel-notifies-sender.test.mjs` exit 0.

| # | Probe | Result |
|---|---|---|
| 1 | pm (coordinator, not a party) `revise_work` on a row it routed | `item #1 is not yours to revise (from=lead to=devtools)` |
| 1 | lead and devtools (the parties) | both succeed, with the stored digest reported (`#3435` contract) |
| 2 | the **sender** `revise_work` with `blockedBy: [3]` | `Validation failed for tool "revise_work": blockedBy: schema is false; root: must not have additional properties` |
| 3 | did the legitimate half of that call land? | **No.** The stored body is still the previous one — the whole call is dropped, gate *and* body edit |
| 4 | `revise_work` on a `done` row | `item #2 is not yours to revise (from=lead to=devtools)` — an *authority* refusal for a *closed* row |
| 4 | `cancel_work` on a `done` row | `item #2 is not yours to cancel (from=lead to=devtools)` — same |
| 4 | `release_work` on a `done` row | correct: `already done (terminal); there is nothing to release` (`#5778` fix) |
| 5 | pm `hold_work` on a QUEUED row **it minted** | refused: `item #3 is addressed to devtools, not you` |
| 5 | pm `cancel_work` on that same row | succeeds |
| 6 | `workable()` on `blockedBy: [9999]` (no such item) | `{workable: true}` — a dangling gate is **inert** (`src/rig.mjs:312`) |

## 4. The ruling

### R1 — Intent stays with the two parties. Do not widen it.

`revise_work` remains `from` **or** `to`, `queued` only. "The coordinator" is not a field on a row;
`from` and `to` are. An authority the guard cannot derive from the record is an authority it cannot
enforce, and any seat that asserts it is indistinguishable from a spoof — which is exactly why
`src/rig.mjs:1291` refuses a third party. pm's proposed limit (pre-claim only, never after) is
correct *as a boundary*, but it is already the implemented boundary; widening the actor set does
not follow from it.

### R2 — A constraint written in a body is not a constraint.

If a seat knows a row must wait, that belongs in `blockedBy`. It is the only gate the claim
predicate reads. Bodies are for rationale, acceptance and evidence; they are never load-bearing
for claimability, and a seat that writes a gate into a body has, by the rig's own definition,
written nothing.

### R3 — The coordinator's authority is exercised at **mint**, not by editing after it.

If you hold the gate, mint the row that carries it: `send_work(to, subject, body, blockedBy=[…])`,
or mint the gate row yourself and have the party mint the work behind it. This is why
`#6213` worked — pm minted its own held row with `blockedBy=6211` — and why the constraint on
`#6218` vanished: lead minted that row, so pm had no legal way to attach the gate.

### R4 — The missing verb, and its exact shape (build, not ruling).

`gate_work(itemId, {blockedBy?, requires?, reason}, )`:

- **authority**: the two parties, plus a seat **recorded on the row as its coordinator**. Recorded,
  not inferred from role or from the org graph. Today no such field exists, so no such authority
  can exist; adding it is the precondition, and it is a schema decision that belongs to `lead`.
- **scope**: constraint fields only. Never `subject`, never `body`. Intent and gates are different
  authorities; conflating them is what made this dispute possible.
- **timing**: `queued` only. A claimed row is being executed; changing its gate under the runner
  diverges the run from the contract.
- **direction**: additive tightening only for a non-minting party — **you may add a gate, you may
  not remove one.** Removing a gate loosens a contract someone else authored; that is a scope
  decision, and scope is `lead`'s. Additive-only is the reversible half of the authority, and it
  is the half the coordinator actually needs.
- **validation, before authority**: every id in `blockedBy` must exist and be non-terminal at write
  time; a self-gate and a cycle must be refused. Ship this **first**. Granting gate-writing
  authority over an unvalidated gate field makes a well-meaning coordinator capable of permanent
  starvation — a worse failure than a lost constraint.
- **legibility**: the call returns the stored digest of the gate it wrote (the `#3435` pattern), so
  the caller can verify the write landed rather than trusting the sentence.

### R5 — Park authority is asymmetric today, and that is a defect.

`hold_work` is recipient-only (`src/rig.mjs:1212`); `release_work` and `cancel_work` are
party-wide (`:1257`, `:1339`). Measured: pm can release and cancel a row it minted but **cannot
park it**. So the only lever a minting seat has when it realises its own row is premature is
`cancel_work` — terminal, id-destroying, and it severs any `blockedBy` that pointed at the row.
**Fix:** accept `from` as well as `to` in `hold_work` for a `queued` row. Parking is strictly less
destructive than cancelling, so it should never be the harder one to do legally.

### R6 — `revise_work` and `cancel_work` check authority before terminality. Same bug class as #5778.

Measured: `revise_work` and `cancel_work` on a `done` row answer "not yours to revise/cancel".
`release_work` was fixed for exactly this (`#5778`, `src/rig.mjs:1254`) and now answers
"already done (terminal)". The other two verbs were not folded into that fix. A coordinator
reading "not yours" reports a closed row as somebody else's open work — which is precisely the
misread that made a milestone chain read as "96% parked".
**Fix:** move `isTerminalItem(item)` above the party check in both verbs, before claiming either.

## 5. Failure modes, each with a recovery path

| Mode | What happens | Recovery path | Falsifiable by |
|---|---|---|---|
| **Silent** — a gate the coordinator cannot write becomes prose | the constraint exists in nobody's predicate; work runs ungated | R3 + R4; refusal text names the remedy, not just the denial | probe Q2/Q3 above |
| **Partial** — a call carrying both a body edit and an unsupported field is dropped whole | the legitimate edit is lost with the invalid one, and the error is a schema message, not a contract message | R4's named refusal; the `#3435` digest return so the caller can check | probe Q3: stored body unchanged after the refused call |
| **Cascade** — a gate added to a row whose gate points at a cancelled id | `gate-cancelled:#id` starves the dependent forever, no exit | `docs/runbooks/stale-held-backlog.md`; check rule reporting gates on terminal ids (`#6215`) | probe Q6 shape |
| **Loop** — a gate cycle (`A→B→A`) | both rows are unworkable forever; the seat sees `SKIPPED … gate-open` but nothing resolves it | cycle check at gate write + a `check` rule listing cycles | mint A↔B gated on each other, assert refusal |
| **Contradiction** — two seats write gates on the same row | last write wins, invisible | every gate write appends a `transitions` entry with `by`, `reason` and the exact ids | read `transitions` after two competing writes |
| **Authority creep** — a non-party loosens a gate it never authored | the contract the doer agreed to is relaxed by a third seat | R4's additive-only rule; removal is `lead`'s call | assert a non-party `blockedBy: []` write is refused |
| **Misread terminal** — authority checked before terminality | a closed row is reported as someone's open work | R6 | probe Q4 |

## 6. Options considered, and the trade-off accepted

**(a) Widen `revise_work` to the routing seat.** Rejected. "Routing" is not a recorded relation —
the row carries `from` and `to` and nothing else — so the guard would have to infer authority from
role or the org graph. Unenforceable, and it puts a contract's text under a third writer with no
accountability for the outcome.

**(b) Status quo: gates are mint-only and late constraints go in prose.** Rejected. It is already
measured to fail — 42 held rows in the demo fixture have *no* recorded gate at all
(`demo/queue-held-gates.test.mjs`), and pm's constraint on `#6218` is the live specimen.

**(c) Keep intent party-scoped; add a narrow, validated, additive gate verb; make coordinator
standing a recorded field; fix the asymmetry and the refusal order.** Chosen.
**Trade-off named out loud:** one extra hop per constraint (a coordinator that discovers a gate
must make a separate, validated call rather than editing prose in passing), in exchange for the
constraint being machine-readable, audited, and reversible. The hop is cheap; the prose gate is not,
because it is invisible to `workable()` and therefore unenforceable in exactly the cases where
enforcement matters. This is the reversible decision: the verb can be removed without touching the
contract boundary, whereas widening body-editing cannot be cleanly unwound once seats depend on it.

## 7. What is NOT decided here

Whether `pm` specifically holds coordinator standing is a scope ruling for `lead`. The
architectural requirement is only that any such standing be **recorded on the row** before any verb
can enforce it. Until then, R3 is the operating rule: mint the gated row, or ask a party to.

## 8. Evidence

- Probe: `tools/probes/revise-authority-boundary.mjs` — exit 0, output quoted in §3.
- Demos re-run in the same tree: `curate`, `revise-work-contract`, `queue-held-gates`,
  `cancel-notifies-sender` — all exit 0.
- Code read: `src/rig.mjs:295-317` (`workable` and its documented clause-4 gap), `:355-380`
  (`normalizeBlockedBy` — shape only, no existence or cycle check), `:404-447` (`enqueueItem` as
  the sole constraint write path), `:1204-1232` (`hold_work`), `:1244-1268` (`release_work`, the
  `#5778` ordering), `:1283-1300` (`revise_work`), `:1334-1347` (`cancel_work`).
