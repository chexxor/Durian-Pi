# Ruling: the 13 ADR number collisions (#6561) — dedupe, suffix, and the mint rule that stops it

**Tree:** branch `item-6561`, HEAD `580c1343`. **Instrument:** `node tools/probes/adr-number-collisions.mjs` (exit 1) — extended in this item to classify each collision mechanically and print the citation census. Numbers below are that probe's output, not my memory.

Measured: 267 `## D<n>` headings, 13 numbers used more than once, **6 byte-identical duplicate entries**, **8 distinct decisions sharing a number**.

## 1. The identical D115–D120 block: duplicate, not two records

**Measured:** bodies at lines 3313/3703, 3366/3756, 3417/3807, 3432/3822, 3454/3844, 3471/3861 compare byte-identical (`diff` on the two ranges: 0 lines).

**Ruling:** delete the **later** copy. Canonical = the first in file order.

Why the first: the number was minted at the earlier land, and every citation written before the collision refers to that mint. Deleting the later copy changes no meaning — the text is identical — so no citation rewrite is required for these six. The probe prints the census so the pass can confirm it: bare `D115` is cited 3 times outside DECISIONS.md, `D116` 0, `D117` 0, `D118` 1, `D119` 24, `D120` 3. All of them still resolve.

**What the canonical entry gains:** one line, `Merged: the duplicate copy of this entry (landed twice) was removed 2026-11-11.` Without it, a future reader cannot tell whether the second copy was deleted or never existed — that is the difference between a record and a guess.

## 2. The genuinely different pairs (D91, D111–D114, D258, D259): suffix, never renumber

**Ruling:** the later entry becomes `<num>b` (`c` for a third collision) in file order; the first keeps the bare number.

Confirmed `D258a/D258b`? **No — use `D258` and `D258b`, not `D258a`.** Reason: a suffix on only one entry means a bare `D258` citation is *silently* resolved to whichever entry survived the convention; giving both letters destroys every existing citation. Keeping the first bare and the second suffixed makes the resolution deterministic and provable: bare means first-in-file, and the probe can assert it.

The pair's canonical entry gains a pointer line so the second stays reachable: `Also D258b — a different decision that shared this number until 2026-11-11.`

Measured citation load, so the pass is sized rather than guessed: `D111` 36, `D112` 11, `D113` 27, `D114` 32, `D119` 24 outside DECISIONS.md; `D258` 2, `D259` 2. Each bare citation must be read in context once: if it meant the second decision, it is rewritten to the suffixed number. That is the only judgement the pass cannot automate.

**Do not renumber** either entry. Renumbering a decision that other documents cite breaks the audit trail; a suffix is additive and reversible.

## 3. D91 is a special case: same decision, two wordings

`D91` has three entries. Two of them (lines 2294, 2296) share provenance — "lead #1297, recorded by scribe #1301", one of them "revised by lead #1316" — so they are ONE decision recorded twice, not two decisions.

**Ruling:** the entry whose provenance names the revision is canonical; the earlier wording is folded into it as a line ("earlier wording of the same ruling #1297 superseded by #1316"), not deleted, because the superseded wording is the audit trail. The third entry (line 2330, "a standing `security` seat") is a distinct decision and becomes `D91b`.

**Mechanical test the probe can apply:** two colliding entries that name the same ruling item id(s) are the same decision. Entries sharing no provenance are distinct. That is a rule, not a per-entry opinion.

## 4. The mint rule that prevents recurrence

Collisions happen because a branch hardcodes a provisional number and two branches land with the same one — the same hazard lead already ruled in #3075 ("D-numbers are minted at land time, never hardcoded in a branch"). The fix is the enforcement, not the reminder:

- at land, the number is `max(existing D<n> in the merged tree) + 1`, computed on the merged tree, not the branch;
- the probe runs as a `check` rule (`adr-number-unique`, error severity) so a collision cannot be merged silently;
- a colliding later land is **suffixed**, never renumbered, and the entry records the rename.

## Failure modes and recovery

| Class | Failure | Recovery |
|---|---|---|
| Silent | a bare citation resolves to the wrong decision | deterministic rule (first-in-file = canonical) + one pointer line per pair |
| Contradiction | two rules carry the same authority number | probe as an error-severity check rule blocks the merge |
| Cascade | a minted number collides and poisons later ADRs | mint from the merged tree, not the branch |
| Loop | renumber ping-pong as entries are re-landed | suffix only; a bare number is never renumbered |
| Partial | citation rewritten to the wrong entry | the pass prints the census; each bare citation is read in context and the probe re-counts after |

## Falsifiable acceptance for the rename pass

`node tools/probes/adr-number-collisions.mjs` exits **0**, and `grep -c '^## D' docs/DECISIONS.md` equals the number of unique numbers. Before the pass it exits 1 with the classification above; that is the baseline the pass must move.
