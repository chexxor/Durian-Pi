# Dispositions ledger (`docs/DISPOSITIONS.md`)

**Append-only ledger of branch dispositions — decisions, not existence.** A row
records the immutable decision that a branch is `CANCEL` / `SUPERSEDED` / `LAND` /
`KEEP-HELD` / `NOTHING-TO-LAND` / `SUPERSEDED-BY-EVENTS`, never whether the ref still exists. Ref existence is mutable and
deleting a ref is a separate act requiring the author or the operator (rule R-B,
#3270); the decision is not. A disposition that changes gets a **NEW row** citing
the new deciding item id — a row is never edited or deleted.

- **Owner:** scribe owns this file and its structure.
- **Writer:** the **deciding seat** appends its own row in its own item branch —
  do not route every row through scribe (that would serialize the table and
  re-create the ledger-writer queue). **Fallback:** the deciding seat appends its
  own row, **OR names a seat that can and supplies the exact row content**; the row
  cites BOTH the deciding item and the appending item. This fallback exists because
  a deciding seat cannot always write files (lead and pm have queue tools only) —
  without it, a rule whose execution depends on a capability nobody checked fails
  quietly and LOSES ROWS (the same failure shape as the carrier leak, #3412). The
  first row appended under the fallback is impl-item-2777 (#3733): decided by lead,
  written by scribe.
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
though it needed fresh merit. Each kind carries a **revival test** that tells the
next disposer whether to CHECK or to DECIDE:

- **CONDITIONAL DROP** — parked on a question, revived automatically when its
  condition lapses; not a decision, gets NO row until it resolves. *Revival test:*
  has the named condition resolved the other way? **AUTOMATIC** — no new ruling.
- **CANCELLED-ON-MERITS** — IS a decision (the work is not worth doing); needs a
  new decision to revive. *Revival test:* is there a NEW DECISION to want it?
  **JUDGEMENT**.
- **SUPERSEDED-BY-EVENTS** — not defective, not deferred, simply overtaken (a
  stale snapshot, a superseded allocation). *Revival test:* has the WORLD CHANGED
  BACK so the content is current again? **VERIFICATION** — check something, do not
  convene a decision.
- **NOTHING-TO-LAND** — content already on main (by content comparison); the
  branch is not defective and not deferred, it is simply finished elsewhere — the
  SUPERSEDED-BY-EVENTS case where "the events" = the content landed on main. The
  case most likely to be misread as pending. *Revival test:* is it still on main?
  **VERIFICATION**.

`impl-item-1604` is the first case where the first two distinguished an outcome: it
was dropped conditionally (the cancelled #2035 lapsed when #1087/ROADMAP 97 was
restored) and is REINSTATED in scope by lead #3355 — it gets a row only when it
lands or is cancelled on merit, never a row for the conditional drop itself.

A **citation in a landed document** keeps a branch alive ONLY if the branch IS the
cited artifact (same path, clean, docs-only) AND the landed decision RESTS on it
(adjudication — the review's findings were adopted into the landed document). A
branch cannot be made un-cancellable merely by mentioning itself; extra content is
split off rather than riding along.

**One logical point that recurs.** Satisfying an "unless" clause in a rule never
creates an OBLIGATION to land — it only removes one reason to cancel. When the
pinning ground for a branch is gone, the disposition falls back to the default
(is there a named live item that needs the content?); a cancellation derived this
way follows the rule rather than overriding it.

## Columns

| date | branch | sha | disposition | reason | deciding item id |
|------|--------|-----|-------------|--------|------------------|
| `date` | the branch name | the dispositioned tip sha | `CANCEL` / `SUPERSEDED` / `LAND` / `KEEP-HELD` / `NOTHING-TO-LAND` / `SUPERSEDED-BY-EVENTS` | why, including the probe evidence | the item id that decided it (authoritative) |

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
| 2026-10-19 | scribe-item-3207 | c51813f | SUPERSEDED-BY-EVENTS | stale pre-#3234 mint-order snapshot: records "3089 mints D115-D119, 3035 mints D120", an allocation nobody is landing — #3167 landed D113/D114, #3089/#3035 were rebased, #3268 minted D121. PINS NO D-NUMBERS (probe #3411: 1 file, +1/-3, D-number strings descriptive only) — so NOT a #3075 cancellation. The live allocation is recorded in #3343's union entry, and the "scribe-item-3114 @3e7a297 is a DUPLICATE, do NOT land" warning is relocated there, where the mint work lives. Revival: verification only — has the world changed back, i.e. does a future clock-out want a written mint order? Deciding seat: pm | #3411 |
| 2026-10-20 | impl-item-2777 | 2db5545 | SUPERSEDED | branch DIVERGED — NOT an ancestor of main; main carries the fractional context-trip mechanism via #1823 (floor 200k + a fraction of the resolved window + ceiling, src/degeneration.mjs), and the absolute 400k bound the branch proposed is gone. Independently confirmed by qa's post-drift re-verify. Decided by lead (#3394) + qa (#3730); FIRST row appended under the fallback rule — decided by lead, written by scribe (#3733) | #3394 + #3730 |
> **Six durable-TUI branches (measured by qa #3951, recorded by scribe #3958).**
> PROVENANCE, not to be tidied: the content IS on main and IS correct (`git diff
> 595b714 main` over the seven TUI files is EMPTY; the four TUI demos exit 0) —
> but it reached main through 595b714, a bare commit whose message says `docs(NEXT)`
> while touching code; was deleted by 9c3aa02 (also `docs(NEXT)`); and restored by
> revert 798836b. NO LANDING ENTRY EVER PASSED. Content correct, path illegitimate —
> the asymmetry #3700 exists for. REVIVAL TEST (CORRECTED #4018 — the prior scope
> named only `src/tui/` and `src/readapi.mjs`, and 3309's unique content lives in
> `src/textwidth.mjs`, a path the test would have missed): re-open if the branch
> carries ANY content absent from main, ANYWHERE — checked per-file by BLOB
> comparison, not by a path list and not by a diffstat summary. Deletions remain
> irrelevant to revival (a branch that would remove landed lines is superseded no
> matter what it also adds); that half was right. GENERAL LESSON (#4018): BEHIND
> MAIN IS NOT SUPERSEDED — a branch 57 commits behind can carry the only copy of a
> fix; the only way to tell is to ask what it DOES that main does not, never how far
> behind it is, and never what its files are called (3309 was the counterexample; the
> other four were re-probed the same way). NO BRANCH WAS DELETED — they are
> evidence, preserving what the shared index once held, so the ledger's claims stay
> checkable.

| 2026-10-20 | impl-item-3308 | 670b28e | SUPERSEDED | durable-TUI landing-screen data path; MAIN IS STRICTLY NEWER — 750 insertions / 5422 deletions across 52 files (qa #4078, content pinned to main), and main HAS the landing content (projectLanding @ L465 + LANDING_QUEUE_STATUSES in src/readapi.mjs; demo/landing-data + demo/tui-landing exit 0 on main). HISTORY, not tidied: two earlier measurements disagreed because BOTH were of the wrong tree — impl's grep failed silently against a non-main tree, and scribe's #4018 measured scribe-item-4018 @a22ee47 (its own ledger branch, which carried the same content); a correct measurement of the wrong tree is indistinguishable from a first-hand one. COMMAND SHAPE: pin the tree in the command — `git show main:<path> | grep X` / `git grep X main -- <path>` cannot measure the wrong tree; grep on a working directory can. 57 commits behind main; landing entry #3436 CANCELLED. Content correct, path illegitimate — reached main via the 595b714 bare commit, deleted by 9c3aa02, restored by revert 798836b, no landing entry | #3951 + #3958 + #4018 + #4078 + #4144 |
| 2026-10-20 | impl-item-3309 | 5dd93bc | NOT-SUPERSEDED (UNLANDED) | carries the ONLY copy of the newline-preserving wrap fix — probe (#4001): `wrapLines` appears 0 times across main, main's `src/textwidth.mjs` has NO wrap function under any name (only width helpers), and main's `src/tui/client.mjs` `wrapText` still does `.replace(/\s+/g, " ").trim()` which FLATTENS explicit newlines. So the "already landed on main" premise was FALSE (operator's, not scribe's). The demos' greenness is NOT evidence the wrap landed — that inference produced the false premise. Entry #3466 CANCELLED (its gate #3390 satisfied — a satisfied gate says nothing about landed content, #3681). Needs a LANDING PATH, not a disposition | #4001 |
| 2026-10-20 | impl-item-3313 | 2949b13 | SUPERSEDED | would DELETE 119 lines of the landed landing row in src/tui/client.mjs; carried by stack entry #3740, CANCELLED | #3951 + #3958 |
| 2026-10-20 | impl-item-2826 | 5d8c623 | SUPERSEDED | MEASURED (qa #3951): 2957 total deletions across 31 files incl 135 from client.mjs; ADDITIONS ALSO MEASURED (#4018): 34 src lines vs main, small relative to the deletions; strict-subset claim is behavioural — see the corrected revival test | #3951 + #3958 + #4018 |
| 2026-10-20 | impl-item-3437 | 66a19af | SUPERSEDED | MEASURED (qa #3951): 1908 total deletions across 11 files, 0 additions to src/tui/; ADDITIONS ALSO MEASURED (#4018): 12 src lines elsewhere vs main, small relative to the deletions; strict-subset claim is behavioural — see the corrected revival test | #3951 + #3958 + #4018 |
| 2026-10-20 | impl-item-3359 | 0c8a396 | SUPERSEDED | MEASURED (qa #3951): 2801 total deletions across 30 files incl 97 from client.mjs; ADDITIONS ALSO MEASURED (#4018): 24 src lines vs main, small relative to the deletions; strict-subset claim is behavioural — see the corrected revival test | #3951 + #3958 + #4018 |
| 2026-10-21 | devtools-item-2187 | 5a99b14 | CANCEL | D103's GLOBAL rebrand was overtaken: main already accepts `DURIAN_PI_*` where it matters (`tui.mjs` DB/OWN overrides) and the branch would rewrite 327 files from a 2026-10-19 base, reintroducing a global rename D122 explicitly declined ("today no rename"). The env-var idea is not lost: new code uses `DURIAN_PI_TUI_DB`/`DURIAN_PI_TUI_OWN` on main. | D122 |
| 2026-10-21 | impl-item-1151 | 85c5d95 | SUPERSEDED | 2026-10-17 expect-worktree series, 4 days old and predating the current write-target/degraded-cwd guard; deleted under the operator's age rule rather than reintroducing the old mechanism. | campaign |
| 2026-10-21 | impl-item-1225 | 14c09d1 | SUPERSEDED | 2026-10-17 expect-worktree series, 4 days old and predating the current write-target/degraded-cwd guard; deleted under the operator's age rule rather than reintroducing the old mechanism. | campaign |
| 2026-10-21 | impl-item-1249 | 083a935 | SUPERSEDED | 2026-10-17 expect-worktree series, 4 days old and predating the current write-target/degraded-cwd guard; deleted under the operator's age rule rather than reintroducing the old mechanism. | campaign |
| 2026-10-21 | impl-item-1444-fix | fec14b7 | SUPERSEDED | 2026-10-17 expect-worktree series, 4 days old and predating the current write-target/degraded-cwd guard; deleted under the operator's age rule rather than reintroducing the old mechanism. | campaign |
| 2026-10-21 | devtools-item-3342 | 371f6be | SUPERSEDED | `tracked-encoding` is explicitly SUBSUMED by main's `text-integrity` (#4371); main deliberately does not carry `src/trackencoding.mjs`. | campaign |
| 2026-10-21 | devtools-item-2459 | a4714d9 | SUPERSEDED | main's `installWorktreeDeps` implements a newer order for the same #2412 defect (sync/--link around `npm ci`) and names that item in its own comment. | campaign |
| 2026-10-21 | impl-item-1823 | f45f4b4 | SUPERSEDED | main already carries the equivalent commit `78cf39ca` (context pressure: floor AND fraction AND ceiling, #1823). | campaign |
| 2026-10-21 | impl-item-1519 | 706248d | SUPERSEDED | 92% of its added lines are already in main (the security position doc landed); the rest is older wording. | campaign |
| 2026-10-21 | designer-item-3483 | 4b1eb25 | SUPERSEDED | older draft of the landing-screen spec; main's version is newer (283 lines) and the draft competes with it. | campaign |
| 2026-10-21 | scribe-item-1232 | d914362 | SUPERSEDED | 2026-10-17 docs-only branch, 78% of its added lines already in main. | campaign |
| 2026-10-21 | impl-item-1609 | 53fd8c6 | SUPERSEDED | 2026-10-17 rule set that predates main's current checkup architecture (severity classes, auditRig input surface, text-integrity wiring). | campaign |
| 2026-10-21 | impl-item-1727 | bcf1a19 | SUPERSEDED | 2026-10-17 rule set that predates main's current checkup architecture (severity classes, auditRig input surface, text-integrity wiring). | campaign |
| 2026-10-21 | impl-item-2325 | 2e8415e | SUPERSEDED | main's `MID_ITEM_STATUSES = {claimed, deferred, held}` already implements it (#2337). | campaign |
| 2026-10-21 | impl-item-3192 | 1d45af6 | SUPERSEDED | superseded by the landed replacement (#4075 duplicate rule / #3056 M1b mapping). | campaign |
| 2026-10-21 | devtools-item-2182 | ee6e771 | SUPERSEDED | main's `c6a618f3` ('add by provenance to configure spool op (#2182 #2277)') carries the configure spool op. | campaign |
| 2026-10-21 | impl-item-4514 | fa76b97 | SUPERSEDED | main already returns base/requestedBase/baseHonoured and already carries the #4514 test block; the branch would delete 310 lines of newer code. | campaign |
| 2026-10-21 | devtools-item-2801-fix | d6eaaf9 | SUPERSEDED | lockfile reconcile already on main; the runbooks wiring is carried by the newer `devtools-item-4054` re-cut; its test commit replaces main's newer prepare-workspace suite with a smaller copy. | campaign |
| 2026-10-21 | devtools-item-2801 | 280539e | SUPERSEDED | lockfile reconcile already on main; the runbooks wiring is carried by the newer `devtools-item-4054` re-cut; its test commit replaces main's newer prepare-workspace suite with a smaller copy. | campaign |
| 2026-10-21 | designer-item-3945 | c09facb | SUPERSEDED | main's spec carries the newer #4300/#4352 width ladder; 4330's unique §1.1 ruling was landed onto main before deleting, 3945 was the older draft. | campaign |
| 2026-10-21 | designer-item-4330 | 814e86b | SUPERSEDED | main's spec carries the newer #4300/#4352 width ladder; 4330's unique §1.1 ruling was landed onto main before deleting, 3945 was the older draft. | campaign |
| 2026-10-21 | devtools-item-3619 | 4abd8ba | SUPERSEDED-BY-EVENTS | duplicate tip: an identical sha is retained by the canonical branch, so deleting this ref loses no commit. | campaign |
| 2026-10-21 | impl-item-1261 | 85c5d95 | SUPERSEDED-BY-EVENTS | duplicate tip: an identical sha is retained by the canonical branch, so deleting this ref loses no commit. | campaign |
| 2026-10-21 | qa-item-2792 | 67d885d | SUPERSEDED-BY-EVENTS | duplicate tip: an identical sha is retained by the canonical branch, so deleting this ref loses no commit. | campaign |
| 2026-10-21 | qa-item-3222 | 1d45af6 | SUPERSEDED-BY-EVENTS | duplicate tip: an identical sha is retained by the canonical branch, so deleting this ref loses no commit. | campaign |
| 2026-10-21 | qa-item-3871 | 1d45af6 | SUPERSEDED-BY-EVENTS | duplicate tip: an identical sha is retained by the canonical branch, so deleting this ref loses no commit. | campaign |
| 2026-10-21 | item-9003 | c219ffb | SUPERSEDED-BY-EVENTS | duplicate tip: an identical sha is retained by the canonical branch, so deleting this ref loses no commit. | campaign |
| 2026-10-21 | devtools-item-2412 | 7933858 | CANCEL | cancelled item (operator ruling); branch deleted so the cancelled work is not reintroduced. | campaign |
| 2026-10-21 | impl-item-1587 | a4129e9 | CANCEL | cancelled item (operator ruling); branch deleted so the cancelled work is not reintroduced. | campaign |
| 2026-10-21 | devtools-item-2188 | 742d3c6 | SUPERSEDED | every commit is already in main by patch-id (`git cherry` shows no `+`), so the ref held no unique work. | campaign |
| 2026-10-21 | devtools-item-3238 | 7284834 | SUPERSEDED | every commit is already in main by patch-id (`git cherry` shows no `+`), so the ref held no unique work. | campaign |
| 2026-10-21 | devtools-item-3652 | be40620 | SUPERSEDED | every commit is already in main by patch-id (`git cherry` shows no `+`), so the ref held no unique work. | campaign |
| 2026-10-21 | devtools-item-4494 | 919315a | SUPERSEDED | every commit is already in main by patch-id (`git cherry` shows no `+`), so the ref held no unique work. | campaign |
| 2026-10-21 | devtools-item-4519 | 8a85397 | SUPERSEDED | every commit is already in main by patch-id (`git cherry` shows no `+`), so the ref held no unique work. | campaign |
| 2026-10-21 | devtools-item-4521 | b633818 | SUPERSEDED | every commit is already in main by patch-id (`git cherry` shows no `+`), so the ref held no unique work. | campaign |

| 2026-10-21 | temp-1558 | 1ad13259 | NOTHING-TO-LAND | a stale pre-split snapshot, not work-in-flight: main carries the same subject (`feat(test): partition the demo suite by functional area (#1558)`) and `git diff main..temp-1558` REMOVES ~41k lines (it predates the tree main has). Patch-id differs only because of the old base, so the sanctioned `worktree prune-branch` REFUSES; the ref is KEPT and the decision is recorded so it is not re-litigated. | delegate |
| 2026-10-21 | temp-1558-r | 7309a5e0 | NOTHING-TO-LAND | a stale pre-split snapshot, not work-in-flight: main carries the same subject (`feat(test): partition the demo suite by functional area (#1558)`) and `git diff main..temp-1558-r` REMOVES ~41k lines (it predates the tree main has). Patch-id differs only because of the old base, so the sanctioned `worktree prune-branch` REFUSES; the ref is KEPT and the decision is recorded so it is not re-litigated. | delegate |
| 2026-10-21 | temp-1558-rebase | e3442442 | NOTHING-TO-LAND | a stale pre-split snapshot, not work-in-flight: main carries the same subject (`feat(test): partition the demo suite by functional area (#1558)`) and `git diff main..temp-1558-rebase` REMOVES ~41k lines (it predates the tree main has). Patch-id differs only because of the old base, so the sanctioned `worktree prune-branch` REFUSES; the ref is KEPT and the decision is recorded so it is not re-litigated. | delegate |
| 2026-10-21 | temp-1754 | 6736cd13 | NOTHING-TO-LAND | a stale pre-split snapshot, not work-in-flight: main carries the same subject (`fix(sync-pi): report the RESOLVED buildDir, not the worktree-local pat`) and `git diff main..temp-1754` REMOVES ~41k lines (it predates the tree main has). Patch-id differs only because of the old base, so the sanctioned `worktree prune-branch` REFUSES; the ref is KEPT and the decision is recorded so it is not re-litigated. | delegate |
| 2026-10-21 | temp-1754-rebase | 1ee42106 | NOTHING-TO-LAND | a stale pre-split snapshot, not work-in-flight: main carries the same subject (`fix(sync-pi): report the RESOLVED buildDir, not the worktree-local pat`) and `git diff main..temp-1754-rebase` REMOVES ~41k lines (it predates the tree main has). Patch-id differs only because of the old base, so the sanctioned `worktree prune-branch` REFUSES; the ref is KEPT and the decision is recorded so it is not re-litigated. | delegate |
| 2026-10-21 | temp-2073 | caab64ee | NOTHING-TO-LAND | a stale pre-split snapshot, not work-in-flight: main carries the same subject (`fix(spool): refuse a MID-FLIGHT compact legibly instead of mis-reporti`) and `git diff main..temp-2073` REMOVES ~41k lines (it predates the tree main has). Patch-id differs only because of the old base, so the sanctioned `worktree prune-branch` REFUSES; the ref is KEPT and the decision is recorded so it is not re-litigated. | delegate |
| 2026-10-21 | temp-2073-rebase | e5d4930c | NOTHING-TO-LAND | a stale pre-split snapshot, not work-in-flight: main carries the same subject (`fix(spool): refuse a MID-FLIGHT compact legibly instead of mis-reporti`) and `git diff main..temp-2073-rebase` REMOVES ~41k lines (it predates the tree main has). Patch-id differs only because of the old base, so the sanctioned `worktree prune-branch` REFUSES; the ref is KEPT and the decision is recorded so it is not re-litigated. | delegate |
| 2026-10-21 | selfdev-borrow | 8e760ccf | NOTHING-TO-LAND | a stale pre-split snapshot, not work-in-flight: main carries the same subject (`wip(durig): selfdev-borrow working-tree snapshot before the opendurig `) and `git diff main..selfdev-borrow` REMOVES ~41k lines (it predates the tree main has). Patch-id differs only because of the old base, so the sanctioned `worktree prune-branch` REFUSES; the ref is KEPT and the decision is recorded so it is not re-litigated. | delegate |
| 2026-10-21 | wip/shared-index-20261020 | 5c8b34eb | NOTHING-TO-LAND | a stale pre-split snapshot, not work-in-flight: main carries the same subject (`wip: archive shared-index 2026-10-20 (pre-cleanup)`) and `git diff main..wip/shared-index-20261020` REMOVES ~41k lines (it predates the tree main has). Patch-id differs only because of the old base, so the sanctioned `worktree prune-branch` REFUSES; the ref is KEPT and the decision is recorded so it is not re-litigated. | delegate |
| 2026-11-03 | item-4898 | 9beb1ae3 | SUPERSEDED | **patch-equivalent, NOT an ancestor** — measured in the appending tree: `git merge-base --is-ancestor 9beb1ae3f3b10cf1f4da6f5f40cd536fc80d5df0 main` exit **1**, while the landed carrier `8fa8f3a2` (item-4931) is exit **0**; `git grep -c DURIG_COMPACTION_ main -- src/config.mjs` = **24** (`DURIG_COMPACTION_ENABLED/_RESERVE_TOKENS/_KEEP_RECENT_TOKENS/_BACKGROUND_TOKENS/_MODEL_OVERRIDES`, src/config.mjs:140-144,361-423), so **#4887's premise is closed on CONTENT** — the compaction policy IS configurable, and that build must not be re-filed. The ref went by the sanctioned verb (`cli.mjs worktree prune-branch item-4898`, `patchEquivalent: 1`) and is absent from `git for-each-ref refs/heads` in this run. Recovery: `git branch item-4898 9beb1ae3f3b10cf1f4da6f5f40cd536fc80d5df0`. Appended under the file's fallback rule (no verifier seat reachable this night): content supplied by the delegate at `main 93ae0145`, written by **devtools-item-4997 (#5027)**; every number above was re-measured here, and the ancestor exit is stated as measured rather than copied. | #4887 + #4898 + #4931 |
| 2026-11-03 | wip/seat-prompt-files | 04e3ba6b | SUPERSEDED-BY-EVENTS | intent LANDED as the re-cut `item-4966` (row #4966 `done`, "operator ruled LAND IT"), an ancestor of main — but the ref is **NOT** patch-equivalent: `git cherry main wip/seat-prompt-files` prints exactly one `+` (in the appending seat's run the sha prints `[redacted by durig: secret-shaped value]` — a guard artifact, recorded rather than worked around; the delegate measured `04e3ba6b` at `main 93ae0145`). **The ref is KEPT and nothing was deleted**, which is the right disposition for a `+`: an unmerged tip whose intent arrived by another route is a RECORD of the route not taken, not residue. Appended under the fallback rule: content supplied by the delegate, written by **devtools-item-4997 (#5027)**. | #4966 + #5004 |
| 2026-11-05 | item-5094 | e173f397 | KEEP-HELD | **Not landed, not residue: its content is not on main, and the automatic sweep is not content-gated.** Measured in the appending tree (devtools-item-5175), against `main` as checked out here: `git rev-parse refs/heads/item-5094` = `e173f397` (exit 0); `git merge-base --is-ancestor e173f397 main` exit **1** (true, but non-diagnostic either way - #4035 is the mirror case); CONTENT probe (the sanctioned per-file method, not ancestry): `git diff --name-status main...refs/heads/item-5094` returns 2 paths - `scripts/sync-pi.mjs` and `demo/syncpi.test.mjs`, +538/-24 - and **both** differ from main by blob identity (`git rev-parse main:PATH` vs `git rev-parse refs/heads/item-5094:PATH` -> DIFF for each), corroborated on surface: `git grep -c -E` over the alternation refs-tags / refuse / drift on `scripts/sync-pi.mjs` counts **7** matching lines on main against **21** on the branch, and main's `pi-main.pin.json` still keys `branch` + `sha` with no tag field, so main does NOT carry the tag-pinning, unknown-ref-refusal, or drift-as-finding surface. Ahead 2 / behind 47 - behind-ness cited as irrelevant, per the 3309 lesson. **MECHANISM CORRECTION to the "sole copy" framing (lead #5161 point 4):** `reconcileOrphanedWorktrees` in src/broker.mjs removes "the WORKTREE only - never the branch, so the ref and its commits survive" (read in-tree, not recalled), `.git/refs/heads/item-5094` exists as a loose ref equal to e173f397, and `git -C ../item-5094 status --porcelain` printed **0** lines - so a TERMINAL+UNLOCKED+CLEAN reap would have cost the working tree, not the only copy of the commits. The act that can actually lose this content is separate BRANCH cleanup, and this row is what gates it (`docs/runbooks/branch-cleanup.md`, Diagnose step 0). **Protective act taken:** `git worktree lock .../item-5094 --reason "park marker (#5161/#5175): not content-present on main; landing entry routed to pm as #5173 - do not reap until landed/dispositioned"` exit **0** - the seat guard does NOT refuse a protective, non-destructive lock, and the audit's keep-reason for this tree is now `locked`, not `reapable`. **The author seat, which #5175 could not name:** `devtools`, proven from landed docs - docs/DECISIONS.md records the seat-to-root probe showing "devtools -> item-5094", and docs/NEXT-ARCHIVE.md records "#5094 claimed -> devtools" with its worktree cleanup FAILING ("refusing to remove worktree .../item-5094: junction/symlink detected at undefined/anthropic-ai-sdk"), which is the leak cause. Author-owns-own-rebase (#3271) therefore puts the rebase-then-land of this entry on **devtools**, not on impl's landing pass. Nothing deleted, nothing pruned: ref AND worktree both KEPT. Appended under this file's fallback rule - decided by lead (#5161, queue tools only), written by the author seat at **devtools-item-5175 (#5175)**; every number above was re-measured by the writer. | #5161 + #5173 + #5175 |
| 2026-11-08 | item-5398 | 6d5c126d | NOTHING-TO-LAND | **Content is already on main by blob identity, and the premise that #5737 superseded it is FALSE — #5398 landed as its own cherry-picks.** Measured in the appending tree (devtools-item-5786) against `main`: `git rev-parse item-5398:scripts/clockin.mjs` and `git rev-parse main:scripts/clockin.mjs` return the SAME blob (`12bc7e2f…`); identical for `demo/clockin-digest.test.mjs` (`ad41a636…`) and `tools/README.md` (`8d214fc4…`), each confirmed by `git diff item-5398 main -- <path>` printing **0 lines**. Ancestry is the misleading signal: `git merge-base --is-ancestor item-5398 main` exit **1** — the work arrived as cherry-picks `ac44d23d` (code) + `ea081129`/`94b827a9` (docs), not as a merge of this branch. `git merge-tree --write-tree main item-5398` exit **1**, CONFLICT in exactly two files — `docs/NEXT.md` and `docs/runbooks/session-start-cost.md` — and in both the branch carries an OLDER copy of text main already has: NEXT.md still holds the N7 pointer where main carries N12; the digest section is §27 on the branch and §28 on main (§27 is now the provider-preflight section). No branch-only line survives in either file. **Attribution corrected:** `git log -S budgetVerdict --oneline main` names `ac44d23d` ("…make the byte budget a gate (exit 1) — #5398") as the commit that put the gate on main; `item-5737`'s tip `ef0db786` touches ONE file, `docs/NEXT.md` (+8/−4) — docs-only, no budget delivered. The gate is live on main: `node demo/clockin-digest.test.mjs` exit **0** in a detached scratch at main with the repo's `node_modules` linked, and that demo asserts **exit 1** when the digest exceeds the 20,000 B budget. **Revival test (VERIFICATION):** re-run the blob comparison — while main's `scripts/clockin.mjs` blob equals the branch's, there is nothing to re-cut. Ref KEPT, nothing deleted (rule R-B, #3270): the row is the decision, not the cleanup. Appended by the author seat (devtools) per this file's writer rule. | #5786 |
| 2026-11-09 | item-5094 | 5593bc03 | CLOSED (ref removed, content proven on `main`) | The #5094 lock's own release condition was met and the ref was removed with the sanctioned verb, not a hand `-D`. Measured in the appending tree at `main dd217b88`: `git cherry main item-5094` prints exactly two `-` (`91c4f054`, `e173f397`), `rev-list --count main..item-5094` = 3, and `git worktree list` names no holder, so `cli.mjs worktree prune-branch item-5094` returned `ok:true` and printed the recovery command `git branch item-5094 5593bc0391251a72c5f6b09cd4bfd4f246ec6970`. **Trap this row records:** the tip `5593bc03` is a merge commit (`Merge: e173f397 fca496a9`) and `git cherry` compares patch-ids of NON-merge commits only, so the verb's guard is blind to a merge's own content. Closed by inspection, not by assumption: `git show --stat 5593bc03` shows the merge brought in `main` as of `fca496a9` and nothing else, and both non-merge parents are patch-present on `main`. Appended by the delegate under this file's fallback rule; the deciding items are #5161/#5173 and the operator's 2026-11-09 "finish landing and cleaning up" instruction. | #5173 + this pass |
| 2026-11-09 | verify-5180 | 4f31be9a | NOTHING-TO-LAND (snapshot) — ref KEPT | A verify-tree snapshot, not work-in-flight: its only commit ahead of `main` is `Merge branch 'item-5111' into verify-5180`, so **both** instruments refuse it and neither is wrong — `git cherry main verify-5180` prints nothing (cherry reads patch-ids of non-merge commits, so a merge-only-ahead branch is invisible to it), `cli.mjs worktree prune-branch verify-5180` refuses with "already an ANCESTOR of main (git cherry prints nothing)" and `git branch -d verify-5180` refuses with "not fully merged". The branch carries 189 files vs `main` (+578/−18,347) and the +578 is verify scratch (`verify-4961.md`, `verify-1940-inflight-compact.mjs`) that `main` does not and should not have; the verified artifact itself, `demo/worktree-removal-junction-message.test.mjs`, IS on `main` (`git show main:demo/worktree-removal-junction-message.test.mjs` exit 0). `merge.md`: never merge a snapshot. Ref KEPT (rule R-B); the clean scratch worktree `../resolve-verify-5180` was released, which deregisters nothing because the ref holds the commits. Row #5180 is still `deferred` — closing it is its owner's queue act. | #5180 + this pass |
| 2026-11-08 | item-4966 | 605ebf07 | LAND (already landed) — entry #4993 closes, the gate re-run names the tree | **The branch cannot be re-run because the ref is gone; the re-run had to be on the MERGED tree, and the reds there are the instrument and the host, not the branch.** Measured by devtools on 2026-11-08: `git rev-parse item-4966` → `unknown revision` (pruned), while `git log --merges --grep 4966 main` returns merge `986a9e37` with TWO parents `3fde09e3` (main-before) and `605ebf07` (tip) — a real merge, so the work is on main. Re-run in a detached scratch at `986a9e37` with the repo's `node_modules` linked: `node tools/what-to-test.mjs --base=3fde09e3 --json` derives **136 tests** (the tool exits **1** on its byte scan while still emitting the JSON — a count from it must be read with its exit code, not instead of it), and the full gate `node scripts/test.mjs --all --jobs 8` → **238/242, exit 1**. Each red read from its own output: `demo/clockin-digest.test.mjs` exit 1 — `Error: Command failed: git rev-list --count main..(no branch)` (git lists a detached HEAD as the literal ref `(no branch)`), and **the #4985 fix is not in that tree**: `git merge-base --is-ancestor c4db1fd9 986a9e37` exit **1**. `demo/deepinfra-catalog.test.mjs` exit 1 — seat "qa" names `verifier/mistralai/ministral-3-14b-reasoning`, not in the fallback catalog: host config. `demo/local-model-pointer.test.mjs` exit 1 — seat "pm" points at `local/iq3_s` with no `local` provider configured: host config. **New finding:** `demo/broker-stop-audit.test.mjs` was red in the `--jobs 8` batch but **exit 0 standalone** — the parallel runner makes it flaky, so "239/242" and "238/242" are not the same measurement. On current main the same gate in a scratch with deps linked → **265/265, exit 0**; all three historical reds are gone. **Revival test (VERIFICATION):** run `node scripts/test.mjs --all --jobs 8` in a scratch at main and expect exit 0; if a demo is red there, re-run it standalone before blaming a branch. Ref not deleted by this row — the ref is already gone (rule R-B, #3270). Appended by the deciding seat (devtools) per this file's writer rule. | #5801 |
| 2026-11-07 | item-5216 | 0060bd99 | NOTHING-TO-LAND | **Already landed: its content is on `main`, so the ref carried nothing further — and the "expect TWO commits on this branch" expectation is stale.** Content probe (the #3337/#3272 convention: per-file CONTENT, not branch reachability), measured in `scribe`'s item-5501 worktree against `main` @ `23d68f60`: `git merge-base --is-ancestor 0060bd99 refs/heads/main` exits **0** (fast path, non-decisive alone), and the content sits where the register row says it does — `docs/reviews/base-agent-product-topology-followup-research.md` on `main` carries the pin footnote `[^P3]` at **:19, :81, :127, :165** and the "superseded by [^P3]" labels at **:128, :149**; the two vendor-docs paths ROADMAP **318(a)** names resolve ONLY inside the file's own diff block at **:184, :193-194**, where they are named in order to record that they appear nowhere as citations — `git grep -n "documentation/ai-agent/recipes\|docs/goose/recipes/index" refs/heads/main` returns nothing else — which is why 318 closed on CONTENT (`docs/ROADMAP.md` row 318). **The ref no longer exists:** `git rev-parse refs/heads/item-5216` → fatal "unknown revision" (measured here), so do not re-derive this branch from a ref; its second commit was ruled **stacked on this content, not branched off `main`** (`lead` #5359) and rides `item-5353`, the row below. Appended under this file's fallback rule — decided by `lead` (#5359, queue tools only) and registered by `pm` (#5501), written by the author seat (`scribe`), every number above re-measured by the writer. | #5359 + #5501 |
| 2026-11-07 | item-5353 | b03f5b8a | LAND | **The unlanded half of the pair: ROUTED, NOT LANDED.** One commit ahead of `main` ("docs(reviews): drop the stray opening fence so the study's tables render", #5353): `git rev-list --count refs/heads/main..refs/heads/item-5353` → **1**. Probed by CONTENT, not reachability: `git show refs/heads/main:docs/reviews/base-agent-product-topology-followup-research.md \| sed -n '1p'` still prints the stray opening fence (three backticks + `markdown`) at line 1, and `git diff refs/heads/main...refs/heads/item-5353` → **1 file, 2 deletions** — that line and its closing fence — so **every table in that study still renders as a code block on `main`** as of 2026-11-07. Clean to land, measured: `git merge-tree --write-tree refs/heads/main refs/heads/item-5353` exits **0** (its base `c43ec1fa` is 2 commits behind `main` and nobody touched the file since). **GATE: #5502** (`qa`, non-author verify of the cited file+line CONTENT at the pinned `goose · 775b3958` clone, registered `docs/COMPETITORS.md:380`); a green `node tools/review-cite-check.mjs` on `main` is NOT sufficient and cannot substitute — run inside an item worktree it prints `clones: 0 under vendor/eval`, every vendor-path cite reads "not tracked at HEAD, no clone holds it (probed 0 clones on disk)", exit **1** (measured in this worktree 2026-11-07), because the clones are gitignored there. Stacks on the row above by construction (both touch one file), so it lands AFTER #5216's content — which is already on `main`, so it needs no rebase to merge. | #5359 + #5501 + #5502 |
> **NOTE (the two worked examples of content-not-ancestry):** `security-item-1475`
> because ancestry said "not on main" while content said "already there", and
> `architect-item-3005` because patch-id said "unique" while the blob was identical.
> Both are recorded so the next reader sees the mechanism, not just the verdict.

> **NOTE (2026-10-21, bulk `-d` of merged refs; delegate, operator-directed):** **132** landed item refs
> were deleted with `git branch -d` — the verb that refuses anything unmerged or checked out — against
> `main` = `4002b23c`; **0 refusals**. Every deleted tip was proved an ancestor of `main` with
> `git merge-base --is-ancestor` before deletion (raw list: `.spike/merged-ref-prune-2026-10-21.tsv`,
> gitignored), so nothing was lost; the commits are in `main`'s history. Refs went **169 → 42**:
> `main`, the 3 stack branches, 5 branches held by live worktrees, 2 snapshots (`item-148`,
> `item-9002`), 9 pre-split `temp-*`/`wip/*`/`selfdev-borrow` refs (the NOTHING-TO-LAND rows above),
> and **22 `archived/*`** refs — 9 of them minted this pass so that worktree HEADs which were on **no
> ref** survived their tree's removal.

> **NOTE (2026-10-21, archive reclaim; delegate, operator-directed):** **42 registered worktrees** were
> reclaimed — 32 dirty terminal `item-*` trees (27 in `../pi-opendurig.worktrees/`, 5 in the repo root),
> 5 `rel-item-*` trees, the 4 clean `%TEMP%` scratches, and the root `item-2209-run`. Each tree's
> residue was **exported before removal** — `worktree.patch` (`git diff --binary HEAD`) plus every
> untracked file, each copy sha256-verified — to
> `../pi-opendurig.worktrees/_exports/2026-10-21/<name>/` with a `manifest.json` (37 manifests; the 4 clean
> scratches and `item-2209-run` held no residue). Worktree HEADs not contained by any ref got
> `archived/<name>` refs FIRST. Two removals were REFUSED by Windows ("Directory not empty": a reserved
> `nul` entry); their residue was already exported and the residue-only directories were then removed
> through the extended-length path form. Worktrees went **52 → 10**: 5 held/live, `item-723` (locked),
> and 4 `%TEMP%` scratch trees kept by rule (dirty or locked).

> **NOTE (2026-10-21, third pass: redundancy-proved refs, last trees, and recovery bundles; delegate,
> operator-directed):** 5 more refs went, each by the sanctioned route and each proved redundant first.
> `worktree prune-branch` removed `archived/item-2154`, `archived/rel-item-673`, `archived/rel-item-700`,
> `archived/rel-item-860` (every commit patch-equivalent to `main`); `git branch -d` removed
> `archived/rel-item-746` (already an ancestor). 4 more trees were exported and removed (`item-723`,
> `%TEMP%/642-restore`, `%TEMP%/rb-1469d`, `%TEMP%/wt-null-…`), all merged into `main`, residue exported
> under `_exports/2026-10-21/`. Refs **42 → 37**, worktrees **10 → 6** (the floor: `main` + the 5 live
> held worktrees).

> **NOTE (2026-10-21, recovery bundles for every unmerged ref; delegate, operator-directed):** all **31**
> refs that are not in `main` (17 `archived/*`, 9 pre-split `temp-*`/`wip/*`/`selfdev-borrow`, the 3 stack
> branches, the 2 snapshots) were captured as `git bundle create <bundle> <ref> ^main` in
> `../pi-opendurig.worktrees/_exports/refs-2026-10-21/<ref>/` plus `git format-patch main..<ref>` under
> `patches/` (855 KB total, `index.json` lists sha/unique-commit count/verification status). Every bundle
> passed `git bundle verify`, and a restore was actually performed — `git fetch <bundle>
> refs/heads/<ref>:refs/heads/<tmp>` reproduced the identical sha in this repo and in a fresh
> `git clone --no-checkout` of it. The bundles are BASIS bundles (`^main`): they restore into a clone whose
> `main` contains `4002b23c`. So a ref may now be deleted without losing its commits — but deleting a ref
> whose unique commits nobody has read is an **author/operator act** (rule R-B), not a delegate one; the 26
> non-stack, non-snapshot refs therefore stay until that grant.

> **NOTE (2026-10-21, what is left and why it is a floor rather than debt):** 37 refs = `main`, 3 stack
> branches (unmerged work waiting on runbook dates), 2 snapshots (`item-148`, `item-9002` — `merge.md`:
> never merge or delete), 5 branches held by **live `held` items** (team must resolve them; a delegate does
> not complete seat work), 17 `archived/*` + 9 pre-split refs (bundle-backed, awaiting the R-B grant).
> 6 worktrees = `main` + the 5 held ones. `.git` after the deletions: 62 MB → 57 MB (`git gc`).

> **NOTE (2026-10-21, operator grant exercised: the 26 bundle-backed refs are gone; delegate,
> operator-directed):** with every one of these verified as a `git bundle` beforehand, **26** refs were
> deleted — the 17 `archived/*` HEAD-preservation refs (16 `item-*` + `qa-verify-419`, plus `rel-item-705`)
> and the 9 pre-split `temp-*`/`wip/*`/`selfdev-borrow` refs that the NOTHING-TO-LAND rows above already
> decided. `git bundle verify` was re-run per ref immediately before `git branch -D`; the deletion list with
> full shas is `.spike/ref-delete-2026-10-21.tsv` (gitignored). **The deletion was proved reversible AFTER
> the fact**: `git fetch archived__item-1261.bundle refs/heads/archived/item-1261:<tmp>` restored the
> identical sha `85c5d95f`. Restore any of them with:
> `git fetch ../pi-opendurig.worktrees/_exports/refs-2026-10-21/<ref>/<ref>.bundle refs/heads/<ref>:refs/heads/<name>`
> (basis bundles: the clone must contain `main` at/after `4002b23c`). Refs **37 → 11**.

> **NOTE (2026-10-21, the 5 remaining branches are a QUEUE fact, not a branch fact; delegate):** the 5
> left are `impl-item-1274`, `advocate-item-2630`, `impl-item-2788`, `qa-item-2993`, `scribe-item-4148` —
> every one is **`ahead=0` against `main`** (their commits landed during the campaign) yet their items are
> still `held` in the store, each gated on other work (#1274 gated on #1; #2630 backlog-held; #2788 BUILD
> 1/2; #2993 gated on #2992; #4148 constitution amendment). So `git branch -d` refuses them (checked out)
> and `leaked-worktrees.md` forbids unlocking a non-terminal item's tree. **The campaign merged these
> branches without updating the queue rows** — the item state, not the ref, is what pins them. Their
> residue is exported in `_exports/held-2026-10-21/<name>/` (sha256-verified), so closing the items is a
> queue verb away, and the trees can then be reaped and the refs `-d`'d at zero cost. A delegate must not
> write queue status: marking these `done` would assert acceptance that the gate has not granted.

> **NOTE (2026-10-21, archive consolidation; delegate, operator-directed):** the archive
> `../pi-opendurig.worktrees/` held **29 directories containing nothing but an undeletable Windows `nul`
> entry** (0 bytes each — the residue of earlier relocate/removal passes, not registered worktrees, no
> `.git`); they were removed through the extended-length path form. It now holds only the **record**:
> `_exports/` (all exported residue + the 31 ref bundles + the 5 held-tree manifests) and
> `stray-archive-20261021-104326/` (the 8 stray root directories preserved earlier by
> `scripts/reclaim-root-leftovers.ps1`). Nothing in the archive is a worktree, so `git worktree list` shows
> only `main` and the 5 held trees.
| 2026-11-09 | item-5770 | 8bb88da8 | LAND (landed) — **GATE BYPASSED, NOT PASSED** | **What landed:** merge `6d4af0e4` ("merge: land item-5770 onto main", parents `6cdb476c` + tip `8bb88da8`, "#5770: bounded gate-aware park census (queue --held --with-gates --limit)") — 5 files, +307/−4: `cli.mjs`, `demo/queue-held-gates.test.mjs`, `demo/test-areas.json`, `docs/COMMANDS-AND-THE-BROKER.md`, `src/queue-lifecycle.mjs` (path read from `git show --stat 6d4af0e4`). **What did NOT happen:** the advertised `--suite` regression gate never ran for this landing. devtools' report (#5832, still `queued` to pm at the time of this row) measured the gate red on `demo/commit-discipline-personas.test.mjs` in the land scratch with `ERR_MODULE_NOT_FOUND: @earendil-works/pi-durable`, main was NOT advanced by the suite step, and the landing proceeded **only after the merged tree was checked by hand**. That is the whole point of the row: the gate is the instrument that verifies, and here it did not run, so this entry must NOT be read as "verified". **Root cause of the false red is #5980** — the land scratch has no `node_modules`, so the gate reds on an environment defect, not on the branch (same shape as #5793). **Re-check by the writer (names the tree it ran in):** in the `item-5981` worktree where `git rev-parse HEAD` == `refs/heads/main` == `09a94b4c`, `git rev-parse HEAD:demo/commit-discipline-personas.test.mjs` and `git rev-parse main:demo/commit-discipline-personas.test.mjs` return the SAME blob `8549c6c2`, and `node demo/commit-discipline-personas.test.mjs` printed `PASS — the tool cannot re-inline a split persona, is idempotent, and is seat-keyed` with **exit 0** (14 `ok` assertions). That green says the demo is green **on main**, and it says nothing about whether the gate ran at land time — those are separate claims and only the first is shown here. **Revival test (VERIFICATION):** none — the content is on `main`; what this row gates is the next landing pass, which must not treat a `--suite` red in a scratch without `node_modules` as a branch verdict. Ref KEPT, nothing deleted (rule R-B, #3270). Appended by `scribe` under this file's writer-fallback rule: decided/registered by `pm` (#5981, queue tools only), sourced from devtools' measured report (#5832), every number above re-measured by the writer. | #5981 + #5832 |
| 2026-11-09 | scribe-item-4144 | 2ca4c84 | NOTHING-TO-LAND (landed) — ref gone, content on `main` | **Measured in the `item-5981` worktree against `main` @ `09a94b4c`:** `git merge-base --is-ancestor 2ca4c84 main` exits **0** — the tip is literally in main's history, not merely patch-equivalent — and `git rev-parse scribe-item-4144` is fatal "unknown revision", so there is no branch left to land. Every assertion in landing entry #4151 reads on `git show main:docs/DISPOSITIONS.md`: the 3308 row carries the independently reproduced **750 insertions / 5422 deletions across 52 files** figure with the wrong-tree history note and the tree-pinned command shape (`git show main:src/readapi.mjs | grep projectLanding`); the 3309 row is **NOT-SUPERSEDED (UNLANDED)**; the revival test is the corrected "ANY content absent from main, ANYWHERE — checked per-file by BLOB comparison, not by a path list"; the five deciding items #3951/#3958/#4018/#4078/#4144 are listed; the `595b714` → `9c3aa02` → `798836b` provenance and #3436 CANCELLED are kept. Encoding guard: `head -c 3 docs/DISPOSITIONS.md | od -c` prints `#   D` — no BOM. **Why a row instead of a fourth reissue** (pm's own finding, stated in #4151): this entry ran #3577 → #4003 → #4038 → #4151, each cancelled for a real correction; the ledger is live on main, so further corrections belong on main. **Revival test (VERIFICATION):** a sweep that finds ledger text absent from `main` is looking at NEW content, not at this entry. Nothing deleted (rule R-B, #3270); the ref is already gone. Appended by `scribe` per this file's writer rule. | #4151 + this pass |
| 2026-11-10 | `C:\Users\Alex\dsh-Projects\pi-opendurig` and `C:` — repo-root **paths**, not refs (the third at ruling time was `C:\Users\Alex\dsh-Projects\pi-opendurig\item-4789`) | **no sha — there is no ref and no tracked file.** `.gitignore`'s `.durig/` matches at any depth. Pin: line **12** in the ruling-time tree `3860e5d1` (read that blob with `git show 3860e5d1:.gitignore` and count — `.durig/` is the 12th line) and line **16** on main `e50cf5b6` — four lines were inserted above it since, so the line number drifts while the pattern does not; cite `.durig/`, never the line number. | **KEEP-HELD — do NOT sweep in this window** | **Ruled by lead, #4864 item 5: record a disposition instead of deleting.** WHAT THEY ARE: repo-root directories named for another OS's absolute path, each holding `.durig/queue-*.md` written by a broker wake into a phantom persisted seat cwd. PROVEN, not assumed: name diff of `.spike/pre-wake-root.txt` (67 lines, 1,021 B, mtime 2026-10-29 23:23) against the post-wake listing → exactly **3** new entries, zero tracked changes, zero losses; residue preserved by **moving** to `.spike/evidence-phantom-roots-20261029/` (gitignored at `.gitignore:25`). WHY NOT REMOVED: a deletion is admissible only when the guard governing the path says it is safe. At ruling time the seat-root keep-guard (`src/broker.mjs:1065-1066` — `norm(p)` = backslashes→slashes, strip trailing `/`, lowercase — tested by `roots.has(key)` at `src/broker.mjs:1088`) matched the **12** stored roots to the registered worktrees **zero times**: loose. Hand-deleting under a loose guard is how a real worktree loses its contents, invisibly, because `git status` cannot see these paths. PREREQUISITE FOR ANY FUTURE SWEEP, in order: (1) 232's normalized-equality guard on main (#4850 → its re-mint) in force; (2) a **DRY listing** — names, byte counts, newest mtime — and deletion only on a **second pass**. Never a batch. THE DRY LISTING, measured 2026-11-10 in the `item-4878` worktree at main `e50cf5b6`: **6 files, 200,074 bytes**, newest mtime 2026-10-29 23:40; largest first — `…pi-opendurig/.durig/queue-all.md` 68,725 B · `…pi-opendurig\item-4789/.durig/queue-all.md` 68,371 B · `…item-4789/.durig/queue-impl.md` 40,312 B · `…pi-opendurig/.durig/queue-scribe.md` 12,086 B · `C:/Users/Alex/dsh-Projects/pi-opendurig/item-2801/.durig/queue-devtools.md` 9,648 B · `…pi-opendurig/.durig/queue-security.md` 932 B. THE CAUSE IS CLOSED: the seat root is now `/home/chexxor/Git/durian-dev/seatroot` — `seatroot/linux` tip `1872d35f`, and `git merge-base --is-ancestor 3860e5d1 seatroot/linux` exits 0, so `3860e5d1` is an ancestor of it, not its tip — and the tool's own predicate (`tools/broker-serve.mjs:371`: `/^[A-Za-z]:/` or contains `\` or `dsh-Projects`) returns **0** entries over the repo root on this host. No NEW phantom directory can be written here; the residue is cosmetic-with-a-disposition, not a defect. **Revival test (VERIFICATION, not judgement):** if that scan ever reports more than 0, name-diff against `.spike/pre-wake-root.txt` before touching anything (#4864's falsifiable test) — and a changed decision gets a **new row**, never an edit of this one. Nothing deleted (rule R-B, #3270). Appended by `scribe` under #4878; the decision is lead's (#4864). | #4864 item 5 (decided) + #4878 (appended) |
