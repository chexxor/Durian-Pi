# Operator decision request — what `ownership` means, and whether a capability set can route outside it

**Prepared by**: the delegate (not a seat). **Date**: 2026-11-13. **Status**: OPEN — four decisions, none of
which the delegate may take.
**Host for every number**: Linux / Fedora Linux 45 (Forty Five) / kernel `7.2.15-300.fc45.x86_64` /
node v24.22.1 / git 2.56.0. HEAD `517dc58d` + the pool-instrument commit `01ff4c91`.

**Why you are being asked.** The N19 pool (D275, `docs/POOL-QUEUE-SPEC.md`) is shipped, armed and alive: rows
#7667 and #7669 were minted `pool: true` by `lead` and claimed by `advocate` and **`security`**. The second claim
is the milestone's falsification probe passing — a seat the `ownership` map does not cover took the work. Doing
that a hundred times over the backlog is where the contradiction lives, and only you can rule on it.

## The facts, measured (not argued)

1. `rig.selfdev.json` `ownership` names **7 artifact classes** → owner seats:
   `src-tools-harness: [impl, devtools]`, `rig-roles-edges: [pm, lead]`, `verification: [qa, auditor, qa2]`,
   `feature-docs: [scribe]`, `workflow-docs: [advocate]`, `security-positions: [security]`,
   `architecture: [architect]`.
2. The same file's seat `capabilities` are `pm [route,plan]`, `impl [implement,code]`, `qa [verify,review]`,
   `lead [decide,adjudicate]`, `advocate [review,advocate]`, `scribe [implement]`, `devtools [implement]`,
   `auditor [verify]`, `designer [review]`, `security [security,review]`, `qa2 [verify,review]`,
   `architect [design,review]`.
3. **The contradiction**: `ownership` says `src-tools-harness` belongs to `impl` **and** `devtools`, but
   `devtools` advertises only `implement` while `impl` advertises `implement,code`. Measured this run: **399 of
   the 856 queued rows are addressed to `impl`**, and under the classifier's proposal rule (an unannotated row
   needs its addressee's own set, `implement,code`) **all 399 are claimable by `impl` alone**, because `code` is
   `impl`-only. Only 8 of the 856 rows carry an explicit `requires`. So pooling that tranche hands `devtools` (a
   declared co-owner of that artifact class) rows it cannot claim. **`ownership` and `capabilities` describe two
   different org charts**, and nothing reconciles them.
4. `node tools/pool-migrate.mjs --dry-run --db ./selfdev.sqlite` (read-only, 1.7 s; classifies all 853 queued
   rows): **165 migratable**, 274 single-owner, 85 blocked, 15 untiered-or-oversized, 313 notice, 1
   already-pooled, balance OK. Of the migratable rows, **107 name a claimant the `ownership` map does not cover
   for the artifact the row names** — `src-tools-harness` 88, `workflow-docs` 19 (34 further rows name no path,
   so no check is possible). By non-owner claimant: `scribe` 87, `impl`+`devtools` together 13, `impl`+`scribe`
   6, `qa2` 1. Full list by row id: `.spike/pool-ownership-gaps.txt`.
5. The live rig already behaves per fact 4: **#7669** names `docs/DECISIONS.md` (`workflow-docs` → `advocate`
   alone) and was claimed by **`security`**.

## Decision 1 — what `ownership` is FOR

- **(a) Advisory, and `capabilities` governs.** The pool already works this way: any seat advertising the
  `requires` set may claim, and `ownership` is a human-facing disposition that never refuses a claim.
  *Pro*: no new mechanism, matches the shipped live behaviour, and the 107 gap rows become legal work instead of
  a violation. *Con*: the `ownership` block then has no enforcement at all, so "devtools owns
  src-tools-harness" is documentation that can drift silently — the class of defect `check` exists to catch.
- **(b) Authoritative, enforced at claim.** A claim outside `ownership` is refused with the same shape as a
  capability refusal.
  *Pro*: ownership means something; the 399-row `impl` tranche stays with its owner. *Con*: it would have
  REFUSED #7669 (a real, useful claim by a capable seat), and it needs a path-width → artifact-class mapping at
  claim time that does not exist today (the classifier infers classes from a regex over the row text — a
  proposal, not a rule).
- **(c) Advisory, plus a red `check` when a row's owner set and its claimable set are disjoint.**
  *Pro*: keeps the pool permissive, makes the contradiction visible on every `check` instead of at the moment
  work stalls. *Con*: one more check rule to keep honest, and it fires on 107 rows today, so `check` would be red
  until the roster is reconciled — a red that everyone learns to ignore is worse than no rule.

**Recommendation: (c), then reconcile the roster.** Ownership already reads as a disposition, not a lock, in
every doc that mentions it; the pool's whole point is that capability is the predicate. But leaving a
contradiction unmeasured is how it survives — a check that names the disjoint pairs, plus a one-time roster
reconciliation (Decision 2), converts 107 silent surprises into a list you can work through.

## Decision 2 — `devtools` and `code`

- **(a) Grant `code` to `devtools`.** *Pro*: makes the `ownership` line true and unblocks its half of the
  `src-tools-harness` tranche (88 gap rows). *Con*: `code` is currently the ONE capability that distinguishes
  `impl` from every other seat; widening it deletes that distinction rig-wide, and per D275 addendum (7) `pm` may
  assign capabilities — so this is the operator saying whether that distinction is real.
- **(b) Remove `devtools` from `src-tools-harness`.** *Pro*: the roster then says what the capabilities say, with
  no vocabulary change. *Con*: `devtools` is the seat that builds and audits the rig's own instruments; declaring
  it a non-owner of the harness is likely false about the work.
- **(c) Split the artifact class** (`src-tools-harness` → e.g. `src` / `tools`+`harness`), giving `impl` the
  `src` half and `devtools` the `tools/`+`harness` half. *Pro*: the `ownership` block is the thing that is
  imprecise — a class that spans both seats' real work will always look contradictory; splitting it is the
  smallest honest change and needs no capability grant. *Con*: needs a classifier that can tell the two classes
  apart from a row's text, which is the same inference problem the pool-migrate tool refuses to make a rule.

**Recommendation: (c) plus (a).** The class is genuinely two artifacts, and `tools/` work needs `code` by
definition. If you want ONE change only, take (c) — it is reversible, needs no new capability, and removes most
of the 88 `src-tools-harness` gap rows on its own.

## Decision 3 — should `send_work` refuse a `requires` set no seat advertises?

Measured live: **row #7660** sits OPEN in the pool with `requires: "docs"`. No seat advertises `docs`, so it is
unclaimable by all 12 and every broker pass logs `pool-gated:1` for the seats it blocks. `revise_work` refuses to
CREATE that state (it names the roster in the refusal); `send_work` still can.

- **(a) Refuse at send (`SEND_WORK_REFUSED` with the roster).** *Pro*: the pool cannot contain dead work; one
  shared rule with `revise_work`. *Con*: a sender may legitimately mint work for a capability the roster will
  gain next `up` (the vocabulary is `pm`-assignable), and the refusal now blocks a legal routing decision.
- **(b) Warn and allow, and let `check` stay red (`pool-dead-gate`).** *Pro*: preserves the sender's intent;
  the red check already exists and names the row. *Con*: #7660 is what that looks like on a live rig — a row that
  is neither work nor reclaimable, and a `pool-gated` line on every pass.
- **(c) Leave `send_work` alone and give the AUTHOR a way to repair (#7660-style) rows.** The author can already
  `revise_work` its own row to clear or fix `requires`; the gap is that nobody is told. *Pro*: no new refusal;
  fixes the actual failure (silence). *Con*: relies on a seat noticing the census.

**Recommendation: (b) + (c), and if #7660 is still open when you read this, have its author clear `requires`.**
A refusal at send would be the rig making a routing judgement for the sender; the honest fix is that the dead row
is visible (it is) and repairable by the seat that made it.

## Decision 4 — a pool claim does not notify the row's `from`

`claim_work` on a pool row writes `to` = claimant plus a `pool-claimed` transition, and **does not message the
author**. The doctrine paragraph says so explicitly. That is why the census (`queue --json`, `status --json`) is
the only way to see a claim happen.

- **(a) Keep it silent (status quo).** *Pro*: no notice chain (ROADMAP 39), no wake storm, the census is the
  single source. *Con*: an author who minted a row and went back to other work has no signal that it moved; if
  the claimant stalls, nobody is prompted to look.
- **(b) Send the author a notice on claim.** *Pro*: the author learns the row is live. *Con*: 313 of the queued
  rows are already notices; adding one per pool claim is the notice chain the pool was meant to avoid, and it
  wakes a seat for information it did not ask for.
- **(c) Record the claim in the author's NEXT reply only** (no notice row): e.g. `peek_queue` for the author
  annotates rows it authored that are now claimed. *Pro*: zero queue cost, zero wake cost, information arrives
  when the author is already looking. *Con*: still needs a reader discipline; a change to `peek_queue` output.

**Recommendation: (c).** It is the only option that adds signal without adding a row or a wake, and it is a
read-side change (no new status literal, no new notice class).

## What only you can do

1. The `ownership` ruling (Decision 1) and any capability grant or class split (Decision 2) — the roster is
   read-only to this goal, and D275 addendum (7) makes capability assignment a *team* power with a store
   transition per grant, so even `pm` may do it only if you want the vocabulary to move.
2. The `send_work` refusal question (Decision 3): it changes what a sender may do, which is authority.
3. Push. Nothing in this goal was pushed; `main` is ahead of `origin/main` and the operator holds that grant.

## What the delegate deliberately did NOT do

- Did not convert a single backlog row to a pool row (the 165 migratable rows are a proposal).
- Did not pool or claim a row: the live rows were minted by `lead` and claimed by `advocate` and `security`.
- Did not touch `rig.selfdev.json`'s `capabilities`, `edges` or `ownership` (`git diff` on that file is empty
  outside the size fields `up --refresh` wrote).
- Did not edit `docs/DISPOSITIONS.md`, and did not resume the paused lifecycle goal.
