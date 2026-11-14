# Ruling: the ADR rename pass — canonical first, dedupe by sentence, suffix by position, mint at land (#6731)

**Question.** pm asked for the rules before the rename pass runs: canonical-first, dedupe 6, suffix 8, mint from the merged tree.

**Run.** `node tools/probes/adr-canonical-order-6731.mjs` → exit 1, on `docs/DECISIONS.md` at HEAD `35001c3a` (branch `item-6731`, pi-durable 1.3.0 from the lockfile). Prior instrument: `tools/probes/adr-number-collisions.mjs` (exit 1).

## What the file actually is (measured)

- **260 headings** matched by the probe's `## D<n>(x)? — ` pattern; 13 numbers are shared by more than one entry.
- **6 are verbatim restatements**: D115 (3703 vs 3313), D116 (3756 vs 3366), D117 (3807 vs 3417), D118 (3822 vs 3432), D119 (3844 vs 3454), D120 (3861 vs 3471). pm's "dedupe 6" is exactly right.
- **7 numbers carry genuinely different decisions**: D91 (three: 2294, 2296, 2330), D111, D112, D113, D114, D258, D259. That is 14 headings needing a suffix, not 8. If the plan says 8, it is counting numbers-with-collisions rather than headings-to-rename, and it drops D91's third entry. Get the number from the probe, not from the plan: rerun it after the pass and require zero shared numbers.
- **1 heading already carries a suffix letter**, so the convention exists but is unenforced.
- **1 provisional heading** (D264, "minted at land by the delegate landing pass") names its item — the provenance pattern I want to make mandatory.

## The four rules

**1. Canonical = first in file order.** Within a shared number, the entry at the lowest line number is canonical; everything after it is either a pointer or a suffixed decision. Not earliest date: provisional branch entries often carry no date, and a date comparison is unparseable prose. Position is mechanical and re-checkable by the probe.

**2. Dedupe only on an identical decision sentence.** The probe keys on the text before the first parenthetical attribution. Equal → it is the same decision recorded twice (six cases, all scribe double-records). Different → it is a different decision, and renaming it away is rewriting history.

**3. Never delete a heading; convert it.** A restated entry becomes a stub in place:
`## D115 — (same decision as the entry at line 3313; recorded twice by the scribe pass, item #3031)`
Reason: `grep -o "\bD115\b" docs/README.md docs/*.md` finds citations, and deleting the heading makes every citation a dangling reference. The stub keeps the citation resolvable and shows why there were two. Consequence to accept: the file keeps 276 headings; the rename pass is about meaning, not about shrinking.

**4. Suffix by position, and refuse bare citations to a suffixed number.** `D111a` (line 2816), `D111b` (line 3127), ordered by line. Any reference to a suffixed number must carry the letter. The probe already counts bare citations; the check must fail on them. Today the file has zero bare citations to shared numbers *inside* DECISIONS.md, but `grep -oE "\bD[0-9]{2,3}\b" docs/*.md docs/runbooks/*.md | sort -u | wc -l` → **872 distinct D-number tokens** across the corpus (143 of them appearing in a `docs/DECISIONS.md` path), and 13 numbers inside DECISIONS.md itself are shared. The checker has to run over those files too, or the rename pass silently breaks the corpus.

**5. Numbers mint at land, not on the branch.** A branch may not choose a number. It writes `## D<placeholder> — (provisional; re-mint at land from the MERGED tree) … item #NNNN`, and the landing pass assigns the next free number computed on the merged file. My own entries on unlanded branches prove the risk: D275 (`item-6671`), D279 (`item-6707`), D280 (`item-6730`) are all placeholders that will collide if two branches land in the wrong order. The rule that makes this safe: the provisional heading must name its item id, so the re-mint is traceable, and the entry records "was D280 on branch item-6730".

## Failure modes, and the recovery for each

| mode | what it looks like | recovery |
|---|---|---|
| silent breakage of citations | renaming D115→D115a leaves `see D115` pointing nowhere | stub headings + a checker that refuses bare citations to suffixed numbers, run over docs/*.md |
| history rewrite | the pass deletes a duplicate and nobody knows it existed | stubs record both item ids; nothing is removed |
| collision at land | two branches both write "D280" | numbers assigned only on the merged tree; probe asserts zero shared numbers after every land |
| suffix drift | a later entry reuses a letter | uniqueness asserted by the probe, not by convention |
| untraceable provisional | a placeholder heading with no item id | the probe flags provisional headings lacking `item #<id>` |

## Falsifiable check

`tools/probes/adr-canonical-order-6731.mjs` is RED now and goes GREEN only when: no number is shared, every restatement is a stub rather than a deleted heading, every suffixed number has its letters, and every provisional heading names its item. Add it to the `check` verb's rule set so a land cannot pass with a shared number.

## What I did not decide

Which seat runs the pass, and whether it lands before the gate-verb tranche, is pm's routing call. The one sequencing constraint: run the rename pass before any new ADR is written, otherwise the pass has to re-run.
