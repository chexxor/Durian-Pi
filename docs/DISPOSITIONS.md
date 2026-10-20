# Dispositions ledger (`docs/DISPOSITIONS.md`)

**Append-only ledger of branch dispositions — decisions, not existence.** A row
records the immutable decision that a branch is `CANCEL` / `SUPERSEDED` / `LAND` /
`KEEP-HELD`, never whether the ref still exists. Ref existence is mutable and
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

## Columns

| date | branch | sha | disposition | reason | deciding item id |
|------|--------|-----|-------------|--------|------------------|
| `date` | the branch name | the dispositioned tip sha | `CANCEL` / `SUPERSEDED` / `LAND` / `KEEP-HELD` | why, including the probe evidence | the item id that decided it (authoritative) |

## Ledger

> **Seed rows (backfilled 2026-10-19):** these dispositions existed only in
> completion summaries — the exact loss this ledger prevents. `date` records the
> append date of the backfill; the authoritative decision point is the `deciding
> item id`. All refs and shas were re-verified as resolvable git objects at seed time.

| date | branch | sha | disposition | reason | deciding item id |
|------|--------|-----|-------------|--------|------------------|
| 2026-10-19 | impl-item-3017 | 756100e | SUPERSEDED | superseded by impl-item-3056 @6ddf538 (recorded in #3112) | #3270 |
| 2026-10-19 | impl-item-2224 | a2eaf7b | SUPERSEDED | superseded by impl-item-2298 @6683790 (recorded in #2399) | #3270 |
| 2026-10-19 | scribe-item-3114 | 3e7a297 | SUPERSEDED | never-land; superseded by **LANDED** scribe-item-3167 @b0e9d75 (recorded in #3182) | #3270 |
| 2026-10-19 | impl-item-2763 | e5b364f | SUPERSEDED | superseded by impl-item-2420 @8770e4b (recorded in #3146) | #3270 |
| 2026-10-19 | architect-item-2700 | d1fde2d | CANCEL | already on main by content: its review blob is identical at main and its DECISIONS body landed as D113 via #2744, with the number left to mint at land. Secondary: the branch also adds a literal `+## D114 —` line, a mint-at-land (#3075) collision. Content-equivalence is the PRIMARY reason; the hardcoded number is corroborative, not the ground (probe #3298, #3075) | #3270 |
| 2026-10-19 | architect-item-3005 | 0827b39 | CANCEL | already on main by content — blob-identical at path to main's copy; `git cherry` reported it as UNIQUE, the patch-id false negative this convention guards against. No D-number objection: its draft derives the number at land time (probe #3298) | #3270 |
| 2026-10-19 | security-item-1475 | 7cf5a34 | CANCEL | already-carried — 7cf5a34 is the pre-union 193-line revision; main carries the impl-blessed 197-line union (blessed @e3abbca), so replaying 7cf5a34 would REGRESS main's file. Content equality proven per-file, not by ancestry (#3332) | #3332 |

> **NOTE (the two worked examples of content-not-ancestry):** `security-item-1475`
> because ancestry said "not on main" while content said "already there", and
> `architect-item-3005` because patch-id said "unique" while the blob was identical.
> Both are recorded so the next reader sees the mechanism, not just the verdict.
