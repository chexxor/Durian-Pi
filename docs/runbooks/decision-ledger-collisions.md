---
runbook: decision-ledger-collisions
symptom: "the decisions ledger reports green while two entries share one number; a heading reads `## D###` or `## D-<mint>`; the same ruling appears twice in DECISIONS.md; a `docs/DECISIONS.md:<line>` pointer lands on an entry that is not the one it names"
writes: false
precondition: "read-only"
last_verified: 2026-11-11
verified_by: scribe
evidence: "items #6352/#6353, branch item-6352 tip 53eea388, measured 2026-11-11: colliding heading numbers 13 -> 0; placeholder headings 8 -> 0 (the D(###|-) grep exits 1); doc-integrity-guard exit 0 before and after; review-cite-check exit 1 with 23 failing of 174 findings before and the identical 23 after; DECISIONS.md line count 11781 before and after; line-pins into the file = 51"
check_rule: null
---

# The decisions ledger is green and still has two decisions sharing a number

## When to use

`docs/DECISIONS.md` reads as the record of what was ruled, and a check says it is fine, but:

- one number heads two entries (measured 2026-11-11 on `main`: **D91 three times, D114-D120 twice each, D111 shared by two different rulings**);
- a heading still carries the template token `## D###`, or is keyed to an item instead of a number (`## D-<mint>`, `## D-5015`, `## D-5025`);
- a ruling's body appears twice, byte-identical, under two headings (the D115-D120 block at 3703-3861 duplicates 3313-3471);
- a `docs/DECISIONS.md:<line>` reference points at the wrong entry.

## Impact

A shared number makes a citation ambiguous: `D114` in one file means the CARRY clean-head ruling and in another the waiting-view ruling, and nothing in the rig can tell you which. A placeholder heading gives an entry no address, so it cannot be cited at all. The failure mode is not that the ledger is wrong - it is that **the check measuring it is blind to it**: `doc-integrity-guard` exits 0 on the same tree where the collision count is 13, because its `DUPLICATE_ENTRY` rule compares headings, not numbers. A green guard over an ambiguous ledger is a false green of the same shape as a check that verifies logic but not installation.

## Diagnose (read-only)

```bash
grep -oE "^## D[0-9]+" docs/DECISIONS.md | sort | uniq -c | awk '$1>1'
grep -nE "^## D(###|-)" docs/DECISIONS.md
node tools/doc-integrity-guard.mjs
node tools/review-cite-check.mjs docs/DECISIONS.md
git grep -o "DECISIONS.md:[0-9]*" -- docs README.md | wc -l
```

Read the first as the collision list (empty = none). The second exits 1 when no placeholder heading remains; any match is an unnumbered entry. The third exits 0 **even with collisions** - that is the blind spot, not a clean bill. The fourth's 23 `HARD PATH NEVER EXISTED` findings are the registered `docs/ROADMAP.md` **244** phantom-cite set, present on main's untouched copy, so they are baseline, not new damage. The fifth counts the line-pins any deletion moves.

## Do

1. **Pick the canonical entry per number from the ledger's own cross-references, not from line order.** `git grep -n "D114" docs/DECISIONS.md` - the entry the rest of the file cites by name ("(D114 / #2788)") is the one that keeps the number.
2. **Count citations outside the file before moving anything.** `git grep -c "D111" -- docs README.md`. On 2026-11-11 every colliding number (D91, D111-D114, D115-D120, D258, D259) had **zero** outside citations, which is what made renumbering safe. If the count is not zero, do not renumber: the renumber turns every citation into a dangling one.
3. **Mint, do not delete, a placeholder.** Assign the next FREE number in issue order at the moment the entry lands, and say so in the heading: `— number minted at land time by #<item>; this entry landed with a D### placeholder`. Land time is when the file is known, so the derived value is real; an unlanded draft cannot know it.
4. **Mark a duplicate copy, do not delete it.** Write `## DUPLICATE COPY OF D115 (the record is line 3313) — <title>` so the copy is non-citable and the canonical entry is named. Deleting the copy moves all 51 line-pins in this file's blast radius; that is a separate landing which re-pins them in the same commit.
5. **Re-measure, then report before and after**, including the exit codes: the collision count, the placeholder grep's exit code, the guard's verdict.

## Verify

```bash
grep -oE "^## D[0-9]+" docs/DECISIONS.md | sort | uniq -c | awk '$1>1' | wc -l
grep -cE "^## D(###|-)" docs/DECISIONS.md
node tools/doc-integrity-guard.mjs
wc -l docs/DECISIONS.md
```

Expected: the first prints `0`; the second prints `0` and exits 1; the guard exits 0; the line count is unchanged if you only renumbered and marked. Ran 2026-11-11 in the `item-6352` worktree: `0`, `0` (exit 1), exit 0, `11781`.

## If it fails

- **The collision count did not drop**: two entries still share a number - check whether you renumbered the canonical entry instead of the interloper.
- **A downstream pointer now lands on the wrong entry**: the pin and the file must move together; re-run `git grep -o "DECISIONS.md:[0-9]*" -- docs README.md` and re-derive each line from the entry it names.
- **You deleted duplicate bodies and cannot re-pin**: restore the lines and mark instead; line-neutral marking is the reversible half.

## Escalate to

**devtools** when the guard itself cannot see the defect - `node tools/doc-integrity-guard.mjs` exits 0 on collisions because `DUPLICATE_ENTRY` compares headings only (measured 2026-11-11). The contract change that closes it is `docs/ROADMAP.md` **#6344**.

## Evidence

Item **#6352** (this pass), branch `item-6352`, tip `53eea388`: 24 heading lines changed, 13 collisions and 8 placeholders cleared, guard exit 0, review-cite-check unchanged at 23 failing of 174, line count 11781 before and after. Item **#6353** carries qa's baseline measurement from `#6257`. The deletion-plus-re-pin follow-up is registered as **#6868**.
