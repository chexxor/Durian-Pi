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

---

# Addendum — operator ratified propose-and-apply (2026-11-12T17:5xZ)

The operator's ruling: **the delegate holds propose-and-apply authority.** What follows is the concrete
change list that ruling implies, split into *access to the team* and *ways to set priority*. Everything here
is a recommendation to be routed; the delegate routes nothing.

## 7. Access to the team: there is no working operator verb today, and that is the biggest defect

Measured on `main` `ae647935`:

- `cli.mjs send` **refuses whenever a resident broker drives the store** (`refuseWhileBrokerDrives("send")`,
  `cli.mjs:2554`) and is deprecated on purpose (ROADMAP 92 / #1585) because it opens a full writing harness =
  a second owner. Its documented staging is *"deprecate → thin alias over the spool → remove"*. **Step 1
  shipped; step 2 did not.**
- `cli.mjs reset` refuses while the broker drives too (`cli.mjs:1599`) — yet the spool supports `--op reset`.
- The channel that *does* work in resident mode is `node intent.mjs <seat> --body-file <file>`, a tracked
  repo-root script that **`cli.mjs --help` never mentions**.

So every operator verb that mutates the team refuses in the only mode the team runs in, and the one working
channel is undocumented in the CLI. That is what "more access" should mean before anything else.

**Recommendation A — one seam: `cli.mjs steer` (finish ROADMAP 92 step 2).**
A spool-backed verb carrying every operation the broker already knows how to apply:
`message | pause | unpause | reset | compact | stop | priority | cancel | release | preempt | directive`.
- Reuse `intent.mjs`'s wire format — do not build a second spool. `cli.mjs steer` becomes the documented
  front door; `intent.mjs` stays as the script form and is named in `--help`.
- Prints the `requestId` and the result path, `--wait` blocks for the answer (what `send --stream` did).
- Attribution on every application: `by: "operator" | "delegate"`, `authority: "operator" | "delegate (operator-authorised)"`.
- One seam means one audit path: `cli.mjs events --since <seq>` shows every operator/delegate mutation, in
  order, with the row it touched. That is the "control" that survives being asleep — not the verb.

## 8. Ways to set priority: four mechanisms, each with one job

| mechanism | when | shape |
|---|---|---|
| **directive** (`priority` scope) | a *policy*: "landing is the priority" | one leased row: seats/tags/ref-match → `now`, `reason`, `expiresAt`; evaluated at claim time by `orderCandidates` |
| **priority —id…** | a computed shortlist (the delegate has measured 6 specific rows) | bulk by explicit id, leased, propose/apply |
| **priority —id X** | one row ahead of its siblings | single id; `set_priority`'s existing validation |
| **preempt —id X** | take work back from a seat that is running it | stop/release the claim cleanly → `queued`, then re-prioritise. **Never** `cancel` a claimed row: that races a live turn and is a modelled inconsistent state |

Two rules that make this set sufficient rather than sprawling:
- **No fan-out of flags.** A directive covers rows minted after it; a bulk `now` does not, and that staleness
  is pitfall 294 repeated in the queue.
- **`blockedBy` edits are NOT a delegate power.** Structural links change the team's decomposition; that stays
  `pm`, and it needs the healing ruling (row A) before anyone edits a chain by hand.

## 9. Authority matrix — ratified, and the part that must NOT scale

| power | operator | delegate | pm | seat |
|---|---|---|---|---|
| read (status/queue/log/events/metrics) | yes | yes | yes | yes |
| message a seat | yes | yes | yes | yes |
| order (`priority`, `directive`) | yes | **yes, propose-and-apply** | yes | own queue |
| eligibility (`cancel`, `release`, `held`) | yes | **yes, propose-and-apply + stranding guard** | yes | own rows |
| preempt a running claim | yes | **yes, via clean stop** | yes | — |
| structure (`blockedBy`, minting rows = routing) | yes | **propose only** | yes | no |
| completion (`complete_work`) | via a seat | **no** | via a seat | yes |
| landing (`scripts/land.mjs`) | no (it is a seat's gated work) | **no** | routes it | yes, gated |
| push | **yes, sole** | no | no | no |

Why routing stays proposed-only even with propose-and-apply: minting rows *is* decomposition. A delegate that
mints rows makes pm's plan a transcription of the delegate's plan, and pm can no longer be held to a
decomposition it did not make. Apply on *order* and *eligibility*; propose on *structure*.

## 10. Safety invariants that must not scale with authority

1. **Append-only.** A mutation appends a compensating transition; nothing rewrites history. `undo` is the
   inverse transition (`cli.mjs revert <transitionSeq>`), not a document edit. This is what makes
   propose-and-apply safe to use in the dark: every action has a named inverse.
2. **Blast radius is printed.** `--apply` touching more than 20 rows prints the census delta it expects and
   requires `--yes`. Under 20 it just prints the diff and applies.
3. **Claimed rows refuse** unless `--stop-seat` is given, which stops the seat first and releases the claim —
   never a silent race with a live turn.
4. **Leases always expire.** No permanent priority (`set_priority` already requires `expiresAt`, ≤ 30 days).
   A directive with no expiry is refused.
5. **Every delegate apply is announced twice**: a notice row to the affected seat(s) in their own queue
   language (so the team can cite *why* its order changed), and an entry the operator's closure report
   enumerates from the ledger. An overnight delegate must be auditable in the morning in one read.
6. **`cli.mjs check` fails** when a non-terminal row is gated on a terminal row — the reader the 151 existing
   orphans never had.

## 11. Order of work (unchanged by the ratification, and it matters)

1. **Row A/B first — the healing rule.** Applying eligibility changes before it multiplies orphans: today's
   cancellations already stranded #3503 and #5885 on cancelled #3377.
2. Then **`cli.mjs steer`** (§7) and the four priority mechanisms (§8), in one row each or one row together —
   `devtools`'s call inside its own scope.
3. Then `cli.mjs check` for terminal-gated rows, so the 151 are visible from the day the verbs ship.

## 12. Acceptance — how anyone knows it works without trusting the author

- `node demo/terminal-gate-heals.test.mjs` — a cancelled gate never leaves a dependent in limbo (#3503/#5885
  as fixtures).
- `node demo/steer-propose-apply.test.mjs` — no `--apply` → zero transitions appended; `--apply` → exactly the
  printed transitions, `by`/`authority` correct, inverse transition reachable.
- `node demo/priority-directive-scope.test.mjs` — a directive applies to a row minted AFTER it, which a
  fan-out would have missed. This is the test that justifies the directive form.
- `node cli.mjs check` red on a terminal-gated fixture, green after healing.
- Live probe: cancel a gate whose dependent is queued, then `status` names it and no `SKIP` line says
  `gate-cancelled` for it on the next pass.

---

# Status 2026-11-12T17:5xZ — IMPLEMENTED and USED (`35eee1a7`)

The operator directed: *"implement that now. Do this yourself, without routing the work through the team."*
What shipped, and what was measured after it shipped:

| § | what | state |
|---|---|---|
| §4b healing rule | not a reinterpretation of `workable()` — the lead-ratified #2677 definition ("terminal != done") stands. A cancelled gate is repaired by an EXPLICIT `gate-released` transition | **shipped** (`src/queueops.mjs`) |
| §4c census | `strandedGates` + `check` rule 24 `stranded-gate` (fix-now, so findings never make `check` exit 1) | **shipped**, and the live census went **20 → 0** |
| §7 access | `intent.mjs --op queue …` is the resident-mode control plane today. The `cli.mjs steer` verb of §7 is NOT built: the spool op is the seam it would front, and a CLI verb that cannot write while a broker drives would be a second writer | **partial — deliberately** |
| §8 priority | `--action priority` with a reason + expiry (≤30 d), propose by default | **shipped and used**: 33 landing rows → `now`, lease to 2026-11-13T23:59Z |
| §8 cancel | `--action cancel`, refuses a claimed row, NAMES the dependents it would strand | **shipped** (not yet used on the live rig) |
| §9 authority | `QUEUE_CONTROL_OPS` admits `from=operator` and `from=delegate`; `DELEGATE` is a separate identity; pause/configure stay operator-only | **shipped** |
| §10 invariants | append-only transitions with `by`/`authority`; propose/apply one path; blast radius >20 needs `--confirm`; leases always expire; claimed rows refuse | **shipped** |
| §8 directive (scoped) | one leased statement on the control doc (`RigControl.directive`), evaluated at CLAIM time by `orderCandidates` — so rows minted after it are covered, and NO row carries a copied flag | **shipped** (`demo/priority-directive-scope.test.mjs`): a fan-out puts the post-directive row LAST, the directive puts it first |

Live evidence, every number from a command run on this host (Linux, Fedora Linux 45 (Forty Five), kernel
`7.2.15-300.fc45.x86_64`, node v24.22.1):

- `--action stranded` → `census.count = 20`, including **#3503** (scribe) and **#5885** (pm) gated on
  cancelled **#3377**.
- `--action repair-gates` without `--apply` → `proposed: 20, applied: 0`, store untouched.
- `--action repair-gates --apply --confirm` → `applied: 20`, first transition
  `{"event":"gate-released","by":"delegate","authority":"delegate (operator-authorised)","gate":["3274"] …}`.
- `--action stranded` again → `census.count = 0`; #3503/#5885 now `blockedBy=[]` with a `gate-released`
  transition.
- `--action priority --apply --confirm` on the 33 landing rows → `applied: 33`; `priority=now` count in the
  live queue 8 → **41**.

**What is still the team's work and was not done here:** minting rows (routing), the 10 per-bin landing
rows, landing a branch, and pushing. The delegate's authority is order and eligibility, and that is exactly
what it exercised.
