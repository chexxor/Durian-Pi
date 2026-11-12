# Continuity probes: which can fail, which cannot — measured by breaking the mechanism (2026-11-12)

**Status:** verification report (qa, #7202). Method, not opinion: a probe is proof only if it can go red.
For each probe I ran it at baseline, then ran it again with the mechanism it claims to guard removed, and
recorded the exit code. A probe that exits 0 with its subject disabled is reporting a state, not testing one.

D240's definition, quoted exactly from `docs/reviews/architecture-note-contract-closeout-2026-11-09.md:101`:

> A seat is proven to have continuity when, in a real conversation: it wrote a note (`rev ≥ 1`), a boundary
> occurred (compaction, reset, or `continue_from_note`), and the note's text was present in the provider
> request at that boundary — and the seat continued the same item afterwards.

Everything else — mentions of the tool name, the section appearing in a prompt, a mirror file existing —
is armament, not proof.

## The mutations (all on `main` HEAD `99e74c7e`, built-pin plane, pi-durable 1.5.1, `node_modules` linked to `vendor/pi-main`)

| id | what was removed | command | exit | what failed |
|---|---|---|---|---|
| A | the compaction hook's `return { summary }` (the note stops short-circuiting the summariser) | `node demo/continuity-note.test.mjs` | **1** | 6 checks: "a pi.compaction entry was placed", "the summary body is the seat's note", "ZERO model calls … callCount before=22 after=23", "the cut turns are out of the model context" |
| A | same | `node demo/note-census.test.mjs` | **1** | 6 checks incl. "fact 3: the compaction used the NOTE, not the summariser" and "the seat that wrote a note and was compacted on it is PROVEN" |
| A | same | `node demo/compaction-acceptance-gate.test.mjs` | **1** | the armed tranche no longer short-circuits |
| C | the `visible.length > FRESH_VISIBLE_MESSAGES` guard in `beforeRequest` | `node demo/continuity-note.test.mjs` | **1** | "the note is not injected once the seat has its own context back" |
| F | `mirrorNote` body made a no-op (all three call sites) | `node demo/continuity-note.test.mjs` | **1** | "the mirror file exists at DURIG_NOTES_DIR", then the demo aborts on `ENOENT` |
| F | same | `node demo/note-census.test.mjs` | 0 | never reads the mirror — not a mirror probe |
| E | the explicit absence line, `rendered \|\| "No continuity note was written for this conversation before the boundary."` → `rendered` | `node demo/continuity-note.test.mjs`, `node demo/note-census.test.mjs` | **0, 0** | nothing. The recovery claim is asserted nowhere. |

Baseline, same tree: `continuity-note` exit 0, `note-census` exit 0; the full suite at `99e74c7e` is
308 passed, exit 0 (`node scripts/test.mjs --all --jobs 4`).

## Verdict per probe, in the vocabulary the item asked for

| # | probe (§4 of the close-out) | verdict | why |
|---|---|---|---|
| 1 | "no code path writes to `docs/notes/` from a seat tool" | **VACUOUS** | `ls docs/notes` → "No such file or directory"; `grep -rn "docs/notes" --include="*.mjs" --include="*.json" .` → 0 hits. There is no probe. The assertion is true only because the object it guards does not exist; nothing in the suite would notice if a writer appeared. |
| 2 | mirror deleted, doc present → `read_note` still returns the note and the gate says "present (mirror missing)" | **NOT-RUN** | No demo deletes the mirror. `continuity-note` checks the mirror exists (line 174) and that `read_note` reports its path (187), never the doc-beats-mirror case. Mutation F proves the mirror half is falsifiable; the *fallback* half is untested. |
| 3a | no note, a queued item → the summary carries the queue seed | **FALSIFIED-AND-PASSING** | `note-census` lines 216-223 ("the seed path costs zero model calls too", "the note doc exists but was never written", "the verdict is SEEDED, not PROVEN") all go red under mutation A. |
| 3b | neither note nor seed → the summary contains the explicit absence line | **NOT-RUN** | Mutation E removes the line and both demos exit 0. The claim in §2 of the close-out ("Recovery: the summary text names the absence, which is assertable in a demo") is not asserted by any demo. |
| 4 | live round trip per seat: note written, boundary, note text in the provider request, seat continued the **same item** | **NOT-RUN as defined** | The census covers three of the four conditions and never the fourth. `grep -rn "itemId" src/notecensus.mjs` shows one use (`noteStateIsEmpty`); `classifySeat` reads `noteWritten`, `compactions`, `compactionVia`, `noteToolsOffered`, `latestCompactionVia` — no request inspection, no continuation check. `handoffCalls` is collected and then unused by the verdict. |

## The labelling defect, stated as a defect

`src/notecensus.mjs:243-247` returns `verdict: "proven"` when a note was written and at least one
compaction carried it. That is D240's conditions 1 and 2 plus an inference from the summary text; it is
not "the note's text was present in the provider request at that boundary" and it is not "the seat
continued the same item afterwards". Live today (`DURIG_DB=selfdev.sqlite node cli.mjs status --json`,
exit 0): `{"seats":12,"notes":10,"noteDocs":12,"readNoteCalls":56,"noteToolsOffered":186,"compactions":2025,"note":132,"digest":0,"summariser":1893,"verdicts":{"proven":8,"seeded":2,"not-observed":1,"claimed-only":1}}`.
Eight seats are labelled PROVEN on evidence weaker than the definition the review itself quotes. The
`why` strings are honest; the verdict word is not.

Two numbers in that census read as measurements but are structurally fixed:

- `digest 0` of 2,025. `compactionSource` returns "note" before "digest", and the summary always carries
  the digest line, so the digest bucket can only fire when there is neither a note nor a seed —
  `seededGoal` finds a queue item for every seat on this rig, so the bucket is unreachable here. A
  permanent zero is not a finding.
- `132 of 2,025` note-path. Those 2,025 compactions are cumulative over the store's life, most of it
  before the extension was armed; the row's real question is "is this seat on the note path *now*",
  which is what `latestCompactionVia` answers, and it is the only column in the census that does.

`docs/MILESTONES.md:107` still quotes the 2026-11-10 census (4/12 notes, 12 of 1,905). Current: 10/12
notes, 132 of 2,025. The row's distinction — mechanism proof versus live round trip — survives; the
numbers behind it are two days old.

## What to do, in order

1. Make probe 1 non-vacuous: a demo that *attempts* a seat-side write to `docs/notes/<topic>.md` and
   asserts it is not performed (or asserts the rig refuses it). `grep` for a directory that does not
   exist is not a test.
2. Add probe 2 as written: delete the mirror file after a `write_note`, call `read_note`, assert the note
   text returns and the reported mirror status is "missing", not "absent note".
3. Assert the absence line. Mutation E shows the branch is live code with no witness.
4. Rename the census verdict, or grow it. Either add the two missing conditions (request inspection and
   same-item continuation via `handoffCalls` + the note's `itemId`), or change `proven` to
   `mechanism-carried` and reserve "proven" for a seat that meets all four. One of these must happen
   before row 9 can be read as closed.
5. Follow `demo/compaction-acceptance-gate.test.mjs` as the model. It seeds real history so a zero means
   something, runs a negative control that *must* go red (`c.truncated > 0`, "the instrument cannot count
   a non-zero, so the armed 0 proves nothing"), and checks the counter is not a constant. Those are the
   three parts the note probes are missing.
