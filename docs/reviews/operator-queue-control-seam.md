# Operator and delegate control over the team's queue — a seam proposal

**Status:** proposal, not a decision. Written by the delegate 2026-11-12T17:4xZ at the operator's request
("the operator and its delegate need more control over the work the team is doing, and we need the ability
to re-prioritize the team's work"). It routes **nowhere** until `pm` routes it; the delegate claims nothing.

**Measured on:** Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1,
git 2.56.0, `main` = `4833b25e`, queue 7,339 rows.

## 1. The operator's risk is not hypothetical — it is happening in this session

The operator's stated worry was "it puts the team's queue state in an inconsistent state, but the team
should be able to heal from it". **The team cannot heal it today, and the inconsistency already exists.**

Three facts, each from a command run in this session:

1. **A cancelled gate strands its dependents permanently and silently.** `workable()` returns
   `{ workable: false, reason: "gate-cancelled:#<id>" }` when a `blockedBy` target is cancelled
   (`src/rig.mjs:339`) — and cancelled is terminal, so the dependent can never become workable. Nothing in
   `src/` repairs a `blockedBy` chain when a gate goes terminal (`grep -rn blockedBy src/*.mjs | grep -i
   'repair\|heal\|reconcile\|clear'` → no hits). The only trace is a `SKIP <seat> reason=queued-gated:gate-cancelled:#N`
   line in the broker log.
2. **151 such rows already exist.** `node tools/queue-drain-audit.mjs` (7,316 rows, 2.5 s) reports
   `orphan candidates (all cited gates terminal): 151` — 151 non-terminal rows that can never be claimed.
3. **Today's client currently has two casualties.** `pm` has cancelled **50 of the 140** zero-build rows.
   Two live rows are now permanently stranded by that: **#3503** (scribe, held) and **#5885** (pm, held),
   both `blockedBy=[3377]`, and #3377 is one of the cancelled 140.

So the order of work matters more than the feature: **an operator-facing cancel verb added before the
stranding rule is a foot-gun that converts "control" into "permanent silent parking".**

## 2. What is already in place (start from this, invent nothing)

- `prioritySet` is already a **lease** with `reason`, `expiresAt` (≤ 30 days) and an **`authority`** field —
  the mechanism already distinguishes who set it. `set_priority` is a seat tool (`src/rig.mjs:1441`) that
  validates and normalizes through `src/workstrategy.mjs:196`.
- Claim order is already a declared policy: `priority_first` sorts `now < next < later`, ties by id
  (`src/workstrategy.mjs`), and it **says in its reply** whether the recipient actually works that way.
- `transitions[]` already records `by`, `event`, `at`, `reason` per row — the audit trail exists.
- The wake path already *names* every suppression: `SKIP <seat> reason=queued-gated:gate-open|gate-cancelled|requires`
  (#6189). Legibility is solved; repair is not.
- The CLI is the delegate plane and today it has **no queue-mutating verb at all** (`set_priority` appears
  in `cli.mjs` only inside the seat instruction text, `cli.mjs:615-617`).

## 3. The recommendation: a scoped, leased DIRECTIVE, not a fan-out of flags

Bulk-writing `now` onto ~300 rows is the trap this repo already paid for once today: a copied value that
goes stale the moment a new row is minted (pitfall 294 — a guard asserting a recorded census while the live
value is over budget; the digest guard was green against 5,773 rows while the live queue was 7,282).

So the primitive should be a **directive**: one row saying *"for seats X and tags/refs Y, claim order is
`now`, because Z, until T"*, evaluated at claim time by the same `orderCandidates` that already exists.

| | fan-out (set 300 rows to `now`) | scoped directive (recommended) |
|---|---|---|
| new rows minted after the call | miss the priority; invisibly demoted | covered, because the predicate is live |
| audit trail | 300 transitions, no single statement of intent | one row: who, what, why, until when |
| reverting | 300 more writes, or wait for leases to lapse | delete/expire one row |
| preempting a seat's plan | invisible to the team | visible as a directive the seat can cite |
| failure mode | stale order nobody can explain | expired lease, named |

## 4. The seam, concretely

**4a. `cli.mjs priority` / `cancel` / `release` — operator-plane verbs (delegate plane, D212).**
They write through the broker (single writer, unchanged) and record
`authority: "operator" | "delegate (operator-authorised)"` and `by:` accordingly. **Propose by default,
apply on `--apply`:** with no flag the verb prints exactly the rows it would touch and the transitions it
would append; with `--apply` it performs them. That is the answer to "more control" without "surprise
inconsistency" — the operator sees the diff before it is real.

**4b. The healing rule — this must land BEFORE 4a, or 4a multiplies the damage.**
A gate that reaches a **terminal** state must not silently strand its dependents. Two acceptable shapes, one
must be chosen by `lead` (it is a semantics ruling, the same class as #7269):

- **(i) repair-by-ruling:** a cancelled gate is treated as *satisfied* for dependents — "the prerequisite was
  abandoned, so the successor is unblocked" — with the transition recorded on the dependent. This is
  `workable()`'s ambiguity rule applied to a terminal gate (it already treats an *unknown* gate id as
  workable, `src/rig.mjs:336-337`, on the "conservative default" that an ambiguous gate must not park work).
- **(ii) surface-and-stop:** the dependent is moved to `held` with a named reason and raised as an
  **attention notice** ("#3503 is gated on terminal #3377"), never silently claimable.

Either way it needs a **demo** (`demo/terminal-gate-heals.test.mjs`: cancel the gate, assert the dependent's
fate is either claimable or explicitly noticed, and never `queued-gated` forever) and a **`cli.mjs check`
rule** so the existing 151 cannot hide again.

**4c. The 151 orphans are a check rule, not a tool tip.** `tools/queue-drain-audit.mjs` prints them and
nothing consumes that line — the same "instrument with no reader" defect as `process-leak-scan --strict`
(#7271). Wire the census into `cli.mjs check` and into `status` attention.

**4d. What must NOT change.** The broker stays the single writer; the delegate still does not claim,
complete, or land; a priority set by the operator is a **lease with an expiry**, so urgency cannot become a
permanent park (`src/workstrategy.mjs` — the lease rule exists for exactly this reason).

## 5. How anyone would know it works, without trusting the author

- `node demo/terminal-gate-heals.test.mjs` — a cancelled gate never leaves a dependent in limbo.
- `node demo/cli-priority-propose-apply.test.mjs` — no `--apply`, no transition written; `--apply`, exactly
  the printed transitions appended, `authority` = the caller's.
- `node cli.mjs check` fails when a non-terminal row is gated on a terminal row (the 151 today).
- On the live rig: cancel a gate whose dependent is queued, then `cli.mjs status` names it and the next pass's
  `SKIP` line does not say `gate-cancelled` for it.
- The operator's own acceptance: one command, a printed diff, the claim order visibly changes in the next
  pass, and the orphan census stays 0.

## 6. The three rows this should become (pm routes; the delegate does not)

1. **`lead` — ruling:** terminal-gate semantics for dependents (repair-by-ruling vs surface-and-stop), with
   the `workable()` ambiguity precedent as the argument. Blocks 42.
2. **`impl` — heal:** whichever ruling lands, implemented in `workable()`/the cancel path + demo. Include
   the two live casualties #3503 and #5885 as the regression fixture.
3. **`devtools` — seam:** `cli.mjs priority|cancel|release` with propose/apply, `authority` attribution, and
   the scoped-directive form from §3; plus the orphan census wired into `cli.mjs check`.

Item 3's scope is the one the operator should ratify, because it decides **how much authority the delegate
holds** — propose-only (default here), or propose-and-apply. That is not a technical choice.
