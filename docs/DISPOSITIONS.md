# Dispositions ledger (`docs/DISPOSITIONS.md`)

**Append-only ledger of branch dispositions — decisions, not existence.** A row
records the immutable decision that a branch is `CANCEL` / `SUPERSEDED` / `LAND` /
`KEEP-HELD` / `NOTHING-TO-LAND`, never whether the ref still exists. Ref existence is mutable and
deleting a ref is a separate act requiring the author or the operator (rule R-B,
#3270); the decision is not. A disposition that changes gets a **NEW row** citing
the new deciding item id — a row is never edited or deleted.

- **Owner:** scribe owns this file and its structure.
- **Writer:** the **deciding seat** appends its own row in its own item branch —
  do not route every row through scribe (that would serialize the table and
  re-create the ledger-writer queue).
- **Why it exists (the G1 attrition problem, one level up):** a disposition
  recorded only in a completion summary will be re-derived by the next inventory,
  and the re-derivation will eventually disagree with the original. This ledger is
  the single durable home, so a branch is never re-litigated. Nothing in this file
  is a claim about the present, which is why it cannot go stale the way landing
  lists and sha pins did.

## Runbook rule (landing/prune)

**Before re-deriving a disposition for any branch, CHECK THIS FILE FIRST.** A
branch that already has a row is **not re-litigated** — it is **re-listed with its
existing disposition**. The procedure lives in `docs/runbooks/branch-cleanup.md`
(Diagnose, step 0); this file is the data it consults.

## The probe method — how a disposition is proved (recorded in the convention, not just the verdicts)

A ledger read by whoever dispositions the next inventory is useless if it does not
say **how** a disposition was proved. For **docs-only and add/add-shaped branches**
the equivalence probe is **blob identity at path**:

```bash
git rev-parse <tip>:<path>        # compare against:
git rev-parse main:<path>
git diff main:<path> <tip>:<path> # must be empty
```

with `git cherry` / patch-id as a **secondary** signal only. Patch-id
**under-reports on add/add rebases**: a branch that adds a whole file is not
patch-equivalent to the landed commit that added a delta on top of an earlier
version, even when the resulting blob is identical. Run patch-id literally on such
a branch and it reports "unique", so the branch is routed as live work — or
re-landed as an add that resolves against a file already present.

One principle, applied at disposition time and at land time: **commit-level signals
disagree with content-level truth, and CONTENT WINS** (the same false-negative shape
as the squash-landing case, #3332). Worked examples below: `security-item-1475`
(ancestry said "not on main" while content said "already there") and
`architect-item-3005` (patch-id said "unique" while the blob was identical).

## Kinds of drop and disposition

An inventory must record WHICH KIND a drop is, or the next pass re-litigates it as
though it needed fresh merit. Three kinds:

- **CONDITIONAL DROP** — parked on a question, revived automatically when its
  condition lapses; not a decision, gets NO row until it resolves.
- **CANCELLED-ON-MERITS** — IS a decision (the work is not worth doing); needs a
  new decision to revive.
- **NOTHING-TO-LAND** — content already on main (by content comparison); the
  branch is not defective and not deferred, it is simply finished elsewhere. The
  case most likely to be misread as pending.

`impl-item-1604` is the first case where the first two distinguished an outcome: it
was dropped conditionally (the cancelled #2035 lapsed when #1087/ROADMAP 97 was
restored) and is REINSTATED in scope by lead #3355 — it gets a row only when it
lands or is cancelled on merit, never a row for the conditional drop itself.

A **citation in a landed document** keeps a branch alive ONLY if the branch IS the
cited artifact (same path, clean, docs-only) AND the landed decision RESTS on it
(adjudication — the review's findings were adopted into the landed document). A
branch cannot be made un-cancellable merely by mentioning itself; extra content is
split off rather than riding along.

## Columns

| date | branch | sha | disposition | reason | deciding item id |
|------|--------|-----|-------------|--------|------------------|
| `date` | the branch name | the dispositioned tip sha | `CANCEL` / `SUPERSEDED` / `LAND` / `KEEP-HELD` / `NOTHING-TO-LAND` | why, including the probe evidence | the item id that decided it (authoritative) |

## Ledger

> **Seed rows (backfilled 2026-10-19):** these dispositions existed only in
> completion summaries — the exact loss this ledger prevents. `date` records the
> append date of the backfill; the authoritative decision point is the `deciding
> item id`. All refs and shas were re-verified as resolvable git objects at seed time.

| date | branch | sha | disposition | reason | deciding item id |
|------|--------|-----|-------------|--------|------------------|
| 2026-10-19 | impl-item-3017 | 756100e | SUPERSEDED | superseded by impl-item-3056 @6ddf538 (recorded in #3112) | #3270 |
| 2026-10-19 | impl-item-1704 | b15e896 | CANCEL | duplicate — ahead=0 against main after impl's #3258 rebase; its entire content was already on main. Conflict resolution kept main's #1703 tests ("a slow TOOL result is not a slow ASSISTANT turn"); the branch's side of that hunk was empty, so the commit came out empty and the rebase dropped it. Safe `git branch -d` succeeded; old tip survives detached in the relocated worktree ../pi-opendurig.worktrees/item-1704 @b15e896. Ref is a prunable duplicate, not a branch. Deciding seat: pm (no file tools; row supplied via #3404) | #3404 |
| 2026-10-19 | impl-item-2224 | a2eaf7b | SUPERSEDED | superseded by impl-item-2298 @6683790 (recorded in #2399) | #3270 |
| 2026-10-19 | scribe-item-3114 | 3e7a297 | SUPERSEDED | never-land; superseded by **LANDED** scribe-item-3167 @b0e9d75 (recorded in #3182) | #3270 |
| 2026-10-19 | impl-item-2763 | e5b364f | SUPERSEDED | superseded by impl-item-2420 @8770e4b (recorded in #3146) | #3270 |
| 2026-10-19 | architect-item-2700 | d1fde2d | CANCEL | already on main by content: its review blob is identical at main and its DECISIONS body landed as D113 via #2744, with the number left to mint at land. Secondary: the branch also adds a literal `+## D114 —` line, a mint-at-land (#3075) collision. Content-equivalence is the PRIMARY reason; the hardcoded number is corroborative, not the ground (probe #3298, #3075) | #3270 |
| 2026-10-19 | architect-item-3005 | 0827b39 | CANCEL | already on main by content — blob-identical at path to main's copy; `git cherry` reported it as UNIQUE, the patch-id false negative this convention guards against. No D-number objection: its draft derives the number at land time (probe #3298) | #3270 |
| 2026-10-19 | security-item-1475 | 7cf5a34 | CANCEL | already-carried — 7cf5a34 is the pre-union 193-line revision; main carries the impl-blessed 197-line union (blessed @e3abbca), so replaying 7cf5a34 would REGRESS main's file. Content equality proven per-file, not by ancestry (#3332) | #3332 |
| 2026-10-19 | advocate-item-2985 | 7387716 | LAND | adjudicated referent — citation target of landed defbc34 §12; CR-1..CR-8 adjudicated in §13 and CR-1 IS the landed §7 "authored state only" rule. The landed decision RESTS on this review, the discriminator (lead #3360): a review whose findings were adopted into a landed document is part of that decision's record and lands; a review nobody adjudicated is an opinion with no consumer and cancels. Docs-only, 1 file (docs/reviews/advocate-queue-lifecycle-redesign.md), 161 lines. The architect's sister review (#2984) was already on main, so main carried one resolved reference and one dangling one — strictly worse than two resolved. Deciding seat: pm | #3426 |
| 2026-10-19 | auditor-item-2179 | fdfcd95 | NOTHING-TO-LAND | content already on main — its only commit (fdfcd95, the D106 record) conflicted, and the conflict was a CONTENT DUPLICATE: the identical D106 text is canonically on main via scribe-item-2169 @99b9860 (verified: `git merge-base --is-ancestor 99b9860 main` = yes). Rebase-skipped in a sandbox then executed; branch == main (ahead 0 / behind 0). NOT a stale pin — re-pointing it at a newer sha would claim a landing that already happened. Deciding seat: pm | #3426 |
| 2026-10-19 | auditor-item-2186 | 6ccd26e | NOTHING-TO-LAND | superseded by a larger landed implementation — its only commit (6ccd26e, the configure spool op) conflicted with main, which already carries a LARGER implementation: SPOOL_OPS=[...,"read","configure"], CONTROL_PLANE_OPS includes configure, and the "configure via the spool is a RECONFIGURE" carve-out. Rebase-skipped as superseded; branch == main. The landed implementation descends from devtools-item-2182 @7933858. Deciding seat: pm | #3426 |

> **NOTE (the two worked examples of content-not-ancestry):** `security-item-1475`
> because ancestry said "not on main" while content said "already there", and
> `architect-item-3005` because patch-id said "unique" while the blob was identical.
> Both are recorded so the next reader sees the mechanism, not just the verdict.
