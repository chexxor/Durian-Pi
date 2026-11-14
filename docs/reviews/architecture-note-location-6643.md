# Ruling #6643 — strike the `docs/notes/` location; the layer it meant already exists, and the probe that "checks" it cannot fail

**Seat:** architect. **Asked by:** pm, on impl's finding (#6643).
**Measured in:** `item-6643` (fork of `item-6634` @ `e90fc174`). Probe: `node tools/probes/note-location-6643.mjs` → **exit 1, 5 findings**. Mechanism demo: `node demo/continuity-note.test.mjs` → **exit 0** ("CONTINUITY PASS").

## Decision

**(b), with the intent kept and the location replaced.** `docs/notes/<topic>.md` is struck as a location. Do not create it: the knowledge it was meant to hold is already held by directories that exist and are checked. impl was right not to invent one.

Three things were conflated in D108's "topic files, and cross-seat access — YES" paragraph:

| the claim | what is actually true | evidence |
|---|---|---|
| topic notes live at `docs/notes/<topic>.md` | nothing writes or reads there; the directory does not exist | `ls docs/notes` fails; grep for `docs/notes` in `extensions/continuity.mjs`, `src/rig.mjs`, `src/confine.mjs`, `cli.mjs` → **0 hits** |
| "no seat tool writes to `docs/notes/`" (§4 probe 1) | true in every possible world, therefore unfalsifiable | the writer is absent **and** the directory is absent |
| notes must live where every seat resolves, regardless of worktree | the mirror default is `resolve(process.cwd(), ".durig", "notes")` — cwd-relative, not absolute | `extensions/continuity.mjs:75`; no config file sets `DURIG_NOTES_DIR`; `notesDir()` from a worktree cwd returns `.../item-6643/.durig/notes` |

What the layer really is, in the order a seat meets it:

1. **Seat-mutable state** — the store doc `durig.notes` is the source of truth; `write_note` mirrors it to `DURIG_NOTES_DIR` (`extensions/continuity.mjs:214` `mirrorNote`, called at `:350`, `:381`, `:417`). Pin verified by `demo/continuity-note.test.mjs` §2, which asserts the mirror file exists at the configured dir.
2. **Durable cross-seat knowledge** — the repo docs layer that exists and is read every day: `docs/DECISIONS.md` (ADRs), `docs/runbooks/` (operating procedures, symptom index in its README), `docs/reviews/` (analysis), `docs/incidents/` (symptom evidence), `docs/evidence/`.
3. **Topic grouping** — D108 wanted "load a whole topic at once and grep across topics". That is already delivered by the ADR headings plus the runbook symptom index; a second directory of topic files duplicates it and adds a writer nobody owns.

## Why the vacuous probe is the real defect

The §4 row reads as a closed gate. A check that cannot fail reports PASS forever, so the section's other three probes inherit its apparent credibility. That is the same drift class D269/#6634 and #6502 named: **a rule stated in prose that no run can contradict.**

Measured scope of the class, in the same pass: of the ten `docs/<dir>/` literals asserted across `docs/DECISIONS.md` and the closeout review, **three** name directories that do not exist — `docs/notes/` (6 assertions), `docs/specs/` (1), `docs/tools/` (1). The fix is not to hand-create one directory; it is a check rule: *every path literal asserted in a doc must resolve, and every asserted "no X exists" claim must name the thing that would make it false.*

## Failure modes, each with a recovery

- **Silent** — a vacuous check reports PASS; recovery: the existence probe above (exit 1 while the claim stands, exit 0 when every asserted literal resolves).
- **Cascade** — a seat's note mirror written inside its item worktree is reaped with the branch, and the next seat reads nothing; recovery: pin `DURIG_NOTES_DIR` to an absolute path in `durig.config.json` (the key is already registered, `src/config.mjs:165`) and assert the resolved path does not contain `item-<n>`.
- **Contradiction** — D108's prose vs `extensions/continuity.mjs`; recovery: the correction is written into D108 itself (done, `docs/DECISIONS.md`).
- **Context** — a seat told to read a nonexistent file burns tool calls and concludes the mechanism is broken; recovery: pointers in docs must name real files, and the runbook README is the index.
- **Partial** — the "curator purge" half of D108 has no owner; that is an operator grant decision and is out of scope here; it stays in D108 as an open duty, not a closed one.
- **Loop** — none: nothing retries against the missing directory.

## The probes that replace the vacuous one (all runnable)

1. **Literal resolution** — `node tools/probes/note-location-6643.mjs` section A: every `docs/<dir>/` literal in the docs must exist. Fails today; passes when the claim is struck or the directory is created with an owner.
2. **Worktree independence** — same probe, section C: `notesDir()` must not resolve inside an `item-<n>` directory. This is D108's own worktree-isolation constraint turned into a check.
3. **Mechanism** — `node demo/continuity-note.test.mjs` (exit 0): write→mirror→read→compaction→handoff, with zero model calls for the compaction.

## Citation drift

impl's numbers are correct and are recorded: `mirrorNote` at `extensions/continuity.mjs:214` (not 213), the tool definitions at `:256`/`:277` (not 255/276), `beforeCompact` at `:397` (not 396) — the shift came from commit `d3dd1300`, the v1.5.1 symbol migration. Any ruling that cites line numbers must be re-derived after a migration, or it becomes a claim the reader cannot re-check without re-deriving it.
