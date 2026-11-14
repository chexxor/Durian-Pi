# Is `proven` proven? — source attribution in the note census (#6668)

Date: 2026-11-11. Reviewer: architect. Question from pm: *does a verdict of `proven` require the carried summary to name its source, or is the current inference the contract?* impl's own caveat is the trigger: the inference holds "only because `extensions/continuity.mjs` seeds only when the seat has no written note".

Probe: `node tools/probes/note-source-attribution-6668.mjs` (exit 1), run against the live store `/home/chexxor/Git/Durian-Pi/selfdev.sqlite`, read-only. Snapshot timestamp: 2026-11-11, this worktree.

## 1. The ruling

**The inference is not the contract, and it must not be made the contract.** `proven` has to mean *a boundary carried the seat's own note*, and that fact has to be produced at the seam, not inferred from the shape of the text.

Two things are true at the same time, and the census currently conflates them:

- **Measured today, the inference survives.** All 8 seats the census calls `proven` have at least one boundary whose summary names its write time (`— last written <ISO>`): conv-3 4/5, conv-9 10/10, conv-15 11/14, conv-21 3/3, conv-4918 1/1, conv-4924 4/10, conv-4930 13/14, conv-107595 7/11.
- **Measured today, the count is inflated.** Of the 83 note-carried compactions, **30 are queue seeds**, not seat notes — 36% of the number the headline reports as "note". And 1,893 of 1,976 compactions went to the summariser: the mechanism is engaged at 4.2% of boundaries fleet-wide.

So the verdict is accidentally correct and structurally unsound. Enforcing attribution today reclassifies nobody (8 → 8); it only stops the fleet total from lying. That is the cheapest honesty fix available, which is why it should be taken now rather than argued about.

## 2. Why the marker cannot carry the claim

`src/notecensus.mjs:35-38` classifies a compaction as `note` if the record contains the literal `CONTINUITY NOTE`. Both sources render through the same function:

- the seat's note: `renderNote(note)` where `updatedAt` was set by `write_note` (`extensions/continuity.mjs:344`) → header `CONTINUITY NOTE for item #N (seat: x) — last written <ISO>`;
- the queue seed: `seededGoal(tx, conversationId)` (`extensions/continuity.mjs:197-203`) returns `{seat, itemId, goal}` with **no** `updatedAt` → header `CONTINUITY NOTE for item #N (seat: x)`.

Pin from the probe (both pure, both pass): the seed render carries the marker and no write time; the self render carries the write time. That is the *only* attribution the store holds, and it is a side effect of a header string.

The pure-shape falsifier, in the probe: two rows with identical boundary facts —

```
{ compactions: 1, compactionVia: {note: 1}, noteToolsOffered: 5, noteWritten: true }  -> proven  ("1 of 1 compactions carried a note this seat wrote")
{ compactions: 1, compactionVia: {note: 1}, noteToolsOffered: 5, noteWritten: false } -> seeded  ("covered by a seed ... not by a note the seat wrote")
```

The sole difference is a whole-history boolean (`noteWritten = deltas > 0 || base_has_content`, `src/notecensus.mjs:134`). A seat that wrote its note *after* the seed-carried boundary and never compacted again is `proven` on a seed. The census already admits this uncertainty for `claimed-only` ("this census cannot tell whether the compactions predate the first write") and does not apply the same admission to `proven`.

## 3. Failure modes, each with a recovery

1. **Silent — false proven.** A seat is declared carried, nothing enforces it, milestone rows read the number as evidence. *Recovery:* require ≥1 self-attributed boundary in `classifySeat`; print the attributed/seed split in the headline.
2. **Fragile — the check depends on wording.** `last written` is prose in `renderNote`; change the header and the attribution silently flips. *Recovery:* stamp the source explicitly at the seam so the classifier reads a field, not a sentence.
3. **Contradiction — two classifiers.** `docs/evidence/2026-11-08-context-window/milestone-check.mjs` counts compaction sources for its own claim while `src/notecensus.mjs` classifies them. *Recovery:* one predicate, `classifySeat`, is the only place a verdict is formed; the milestone reads it.
4. **Partial — coverage read as existence.** conv-15 is `proven` with 14 of 575 boundaries note-carried; conv-4930 14 of 853. Existence is not coverage. *Recovery:* verdict stays existential, but every row prints `n/m boundaries` and the fleet line prints the attributed share.
5. **Stale — proven for an old boundary.** `latestCompactionVia` already exists and today agrees (all 8 proven have latest = note), but nothing requires agreement. *Recovery:* report `proven (last boundary: note)` versus `proven (last boundary: summariser)` — a seat that fell off the path is a regression, not a success.
6. **Cost.** No new scan: the split is one more `LIKE` in the single pass over `entries` already described in `src/notecensus.mjs:88-104`.

## 4. Options considered

- **(a) Keep the inference, document that it is conditional.** Rejected: a documented guess is still a guess, and this number is read by other rows as evidence.
- **(b) Derive attribution from timestamps** (compare the note's first write with the compaction's time). Rejected after measurement: `document_revisions` has no time column — the columns are `document_id, seq, kind, version, content` — and entry ids and revision seqs are different sequences, so the ordering has to be reconstructed. Fragile, and it re-implements what the seam already knows.
- **(c) Stamp the source at the seam, classify on the stamp.** Chosen. One line in `renderNote`, one extra bucket in the census, a demo assertion. Reversible: if the stamp is later folded into a structured field, the classifier only needs the field.

**Trade-off accepted:** summaries get a few longer characters and any golden that asserts the header shape must be updated; in exchange the word `proven` means what a reader assumes it means.

## 5. The exact change, and the check that proves it

1. `extensions/continuity.mjs:118-126` — `renderNote(note, source)`, header `CONTINUITY NOTE (source: seat note, last written <ISO>)` vs `CONTINUITY NOTE (source: queue seed, item #N)`. The seam at `extensions/continuity.mjs:405-415` already knows which one it used; it currently throws that knowledge away.
2. `src/notecensus.mjs` — split `via_note` into `viaNoteSelf` / `viaNoteSeed`; `classifySeat` returns `proven` only when `viaNoteSelf >= 1`, otherwise `seeded` with an owner and a why that names the timing uncertainty.
3. `demo/note-census.test.mjs` — the missing case: compact once with no note (seed carried), then `write_note`, then assert the verdict is **not** `proven` and that the row reports 1 seed / 0 self. The demo today has the `seeded` case (line 223) and the clean `proven` case (line 224) but not the shape that breaks the claim.
4. `docs/SELFDEV.md` and `docs/runbooks/continuation-notes.md` — the fleet line must state the snapshot time and the attributed share; the store is live and drifts (pm's quoted 7 proven / 1,957 compactions vs this snapshot's 8 / 1,976 is the same measurement at a different moment, not a disagreement).

Falsifiable now: the probe exits 1 with `FAIL ... the only difference from seeded is a history boolean`. After the change it exits 0, and the demo case in (3) is green.
