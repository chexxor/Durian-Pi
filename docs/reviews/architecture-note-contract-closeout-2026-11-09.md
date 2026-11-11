# The note contract is ONE contract, with two layers and one owner — D240 close-out

**Status:** ruling (architect, 2026-11-09), carried by queue item **#6121** (re-issue of #5940). This is
decision text, not code. Line numbers are from the tree I read: branch `item-6121`.

**The conflict, stated before it is resolved.** Two source rows describe the same mechanism from
different angles and disagree about where the note lives and who writes it:

- the **#4645 lineage** (recorded at `docs/DECISIONS.md:2967-2978`): notes group into one file per topic,
  `docs/notes/<topic>.md`, shared across seats, with a curator and "one writer per file", and the worktree
  problem is named explicitly — "a notes file in the main tree is *invisible* in that worktree and a note
  written inside a worktree dies with it".
- the **#5549 lineage** (D130/R2, then D240 at `docs/DECISIONS.md:10489-10495`): the source of truth is a
  store document, `defineDoc({kind: "durig.notes", scope: "conversation", history: "rewindable", fork: "asOf"})`,
  with a mirror file under `DURIG_NOTES_DIR` (default `<rig root>/.durig/notes/`) for gates and humans.

Read literally they are two answers to one question, and the rig has implemented both without naming which
is authoritative. That is how #6114 and #6116 end up building two contracts.

## 1. Ruling: two objects, not two contracts

**There are two different things, and they must not be conflated.**

| Object | Owner | Storage | Who may write it | Who reads it |
|---|---|---|---|---|
| **Continuity state** — one seat's note about the item it is working on | the extension plane: `extensions/continuity.mjs` | the `durig.notes` store doc (conversation-scoped, rewindable, fork `asOf`) | the seat, through `write_note` only | the seat (`read_note`, `continue_from_note`), the compaction hook, and gates via the mirror |
| **Base knowledge** — a topic's settled facts, with provenance and `staleIf` anchors | the curator/human pass, in the repo | repo-committed `docs/notes/<topic>.md` (or the topic-doc layer `check` already verifies) | the curator pass, not a seat mid-turn | every seat, as a static pointer |

Decided, not described:
- **The note contract is owned by the extension plane.** `src/seattools.mjs` and `src/rig.mjs` must NOT
  define their own note document or their own note tool. If a base verb ever needs to write a note, it
  calls the extension's doc + mirror helper, or D212 applies and the missing seam is grown in the base.
- **The mirror is a rendering, never a source.** `extensions/continuity.mjs:213` (`mirrorNote`) never
  throws; a failed mirror is reported, not fatal (`:349-350`). Any gate that reads the mirror must treat
  "mirror absent, doc present" as *present*, not as missing.
- **A seat does not write topic notes inside a turn.** The #4645 rule "one writer per file" survives as
  "seats write to their own conversation doc; topic files are written by the curator pass". This is the
  exact hazard the worktree incident (`docs/incidents/2026-10-26-worktree-and-scratch-sweep.md`) records.

**What this decides for #6114 and #6116.** They may implement different halves of the same contract
(wake/compaction/reset mirror vs. the read/recovery verb), but neither may introduce a *third* location
or a second writer for the same object. If either defines its own note doc, path, or writer, that is a
refusal condition, not a design detail — sequence it behind the owner above. Lowering a row's scope here
is deliberate: the mirror-at-boundary work (#5935 lineage) is legitimate because it renders the same doc;
it is not a new contract.

## 2. What compaction reads, and what it falls back to

Read at `extensions/continuity.mjs:396-417`:

1. it reads the conversation's `durig.notes` doc (`tx.doc(ContinuityNotes, runtime.conversationId)`);
2. if that is empty it seeds from the queue (`seededGoal`) — the claimed/queued item for that seat;
3. the summary is the rendered note (or the seed), plus a digest of the cut messages, plus the line
   "The durable transcript was not deleted: the cut turns are still readable in the store";
4. it never reads the mirror file and never reads `docs/notes/`.

So the fallback chain is: **own note → queue seed → digest of what was cut**. There is no model call in
that path, which is the point of D240: `beforeCompact` returns `{summary}` and the summariser request is
never constructed (`dist/harness/compaction.js:82-88` → `place()` at `:374`). It never returns
`{decline: true}` — ROADMAP 176 forbids a competing summariser, and declining returns the seat to the
same wall later.

Failure modes here, each with its recovery:
- **Silent** — an empty note renders an empty seed and compaction looks fine while the seat lost its
  thread. *Recovery:* the summary text names the absence ("No continuity note was written for this
  conversation before the boundary"), which is assertable in a demo.
- **Contradiction** — a gate reads the mirror and the doc and gets different answers. *Recovery:* doc is
  truth; mirror is a rendering; a gate must report which it read.
- **Cascade** — a stale mirror poisons a landing gate. *Recovery:* mirror write is reported, never
  assumed, and gates fall back to the doc.
- **Loop** — compaction keeps firing because the window is full of unrelated queue items. *Recovery:*
  D240's own diagnosis (the wall is not the window) plus the digest line; the note cannot fix a window
  holding a hundred tasks, and no design should claim it can.

## 3. Is "the mechanism is proven" enough to close D240? **No — and the distinction is the deliverable**

Three evidence classes, and only the first is closed:

1. **Mechanism proof (offline):** `node demo/continuity-note.test.mjs` — I ran it in this worktree,
   **exit 0**; it asserts the note survives the boundary, reaches the provider request on a plain reset,
   is request-only (no extra transcript entry), and is *not* injected when the seat has its own context
  back. That proves the contract works.
2. **Demo-store fleet:** `docs/evidence/2026-11-08-context-window/milestone-check-2026-11-09-notes-armed.txt`
   shows note documents present, 11 transcript mentions of `write_note`, and three seats with resume text
   (`worker`, `stuffed`, `handoff`) — mechanism armed in a synthetic rig.
3. **Live fleet:** the numbers in the intake are the open half — 6 note documents, 32 `write_note`
   mentions, 35 `read_note` declarations, **10 of 12 seats with no resume text**, and `docs/MILESTONES.md:107`
   records row 9 as "**armed, never exercised**".

**Ruling.** D240 closes on the mechanism only. **The milestone does not close until the per-seat round
trip is observed live.** Define "proven" for the close-out, in one sentence a gate can check:

> A seat is proven to have continuity when, in a real conversation: it wrote a note (`rev ≥ 1`), a
> boundary occurred (compaction, reset, or `continue_from_note`), and the note's text was present in the
> provider request at that boundary — and the seat continued the same item afterwards.

Everything else — mentions of the tool name, the section appearing in a prompt, a mirror file existing —
is armament, not proof. `docs/SELFDEV.md:3758` already states the rule: only the transcript-level
evidence counts. The gate must keep separating *mechanism failure* from *operational blocker* (a seat
that never reached a boundary, or a provider grant that never came); `docs/MILESTONES.md:104` records
that separation as the check's job.

**What is NOT required to close it:** per-seat live evidence from seats that have no live item is not a
failure, it is a non-observation. Only seats with a claimed item and a crossed boundary are in scope.

## 4. Falsifiable probes for the close-out

1. Two writers test: assert that a seat's note write lands in `durig.notes` and that no code path writes
   to `docs/notes/` from a seat tool. If a second writer exists, the contract is split and this row is
   not closed.
2. Mirror-absent test: doc present, mirror deleted → `read_note` still returns the note, and the gate
   reports "present (mirror missing)", not "missing".
3. No-note fallback test: no note, a queued item → the compaction summary contains the queue seed, not a
   blank; with neither, it contains the explicit absence line.
4. Live round-trip test (the milestone): per seat with a claimed item, assert `note.rev ≥ 1` before a
   boundary and the note text in the request at that boundary. Report seats with no boundary as
   "not observed", never as "proven" or "broken".

## 5. Verify (actually run)

```
node demo/continuity-note.test.mjs                      -> exit 0  (mechanism proven)
grep -n "beforeCompact" extensions/continuity.mjs       -> :396    (the hook, reads the doc, never the mirror)
grep -n "mirrorNote" extensions/continuity.mjs          -> :213, :349, :380, :416
sed -n 2967,2978p docs/DECISIONS.md                      -> the #4645 topic-file rule, quoted above
sed -n 10489,10495p docs/DECISIONS.md                    -> the #5549/D240 store-doc rule, quoted above
```

**Re-verified against the merged tree 2026-11-10 (item #6114, worktree forked from `main`, dependencySet
built-pin at the `v1.5.1` pin).** All three conditions hold; the line citations above have drifted and the
positions on the merged tree are: the doc `defineDoc({ kind: "durig.notes", scope: "conversation",
history: "rewindable", fork: "asOf" })` at `extensions/continuity.mjs:43-51`; `mirrorNote` defined at `:214`
and called at `:350`, `:381`, `:417`; `beforeCompact` at `:397`, reading the seat's own doc at `:405`, falling
back to the queue seed at `:411`, then the cut-message digest at `:418`. `node demo/continuity-note.test.mjs`
-> exit 0. There is no second note doc, path or writer in the base: `src/rig.mjs` defines only `Seats`,
`Edges`, `Constitution`, `RigControl` and `RigQueue`, and the only `note` field in the queue schema
(`src/rig.mjs:720`) is free text on a park `constraints` entry, not a continuity doc. `docs/notes/` does not
exist in the tree, so the probe in section 4 that looks for a second writer to it is satisfied vacuously -
it cannot be falsified until a topic file is actually created there.

The live-fleet counts (6 / 32 / 35 / 10-of-12) are as reported by `pm` in the intake and are consistent
with `docs/MILESTONES.md:107`; they were not re-derived against the live store from this worktree, and
this ruling does not depend on them — it depends on which evidence class counts.
