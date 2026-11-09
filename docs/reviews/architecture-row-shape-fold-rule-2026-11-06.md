# Row shape: when a design intent is ONE roadmap row and when it is two

**Item #5208 (lead) — answer to my deferred #5048.** Recorded so the next fold question does not
need a ruling: the rule is the durable part, the three calls below are its worked examples.
Durable form: **D221** in `docs/DECISIONS.md`.

## The rule (lead's wording, kept verbatim in substance)

**FOLD into one row when ALL of:**
1. one acceptance check proves both halves — one command that goes red for either;
2. they cannot land independently — same branch, same commit, one concern;
3. split, one half would be true but unactionable.

**STAND BESIDE when ANY of:**
1. each half has its own verification command that can go red independently;
2. different seats, or different times, can claim them;
3. one half is a naming/observability rule and the other is behavior — a vocabulary entry and a
   build entry are different concerns even when they share a design note.

**Refused:** folding to make `docs/ROADMAP.md` read shorter. A fold that hides an
independently-red check costs the ability to tell which half regressed.

## Why the rule is testable, not taste

The discriminator is *the number of independent red conditions*, and that is countable in the file.
Probe (run in this worktree, main @ `46c28b73`, **exit 0**):

```
awk '/^[0-9]+\. /{if(n!="")printf "row %s own-Acceptance=%d\n", n, c; n=$1; c=0} /\*Acceptance:\*/{c++} END{if(n!="")printf "row %s own-Acceptance=%d\n", n, c}' docs/ROADMAP.md | grep -E "^row 9[2-5]\."
row 92. own-Acceptance=1
row 93. own-Acceptance=1
row 94. own-Acceptance=1
row 95. own-Acceptance=1
```

Each of 92/93/94/95 carries **exactly one** own `*Acceptance:*` clause naming a *different* failing
assertion, so none of them may be folded into another: a fold would delete a red signal. The probe
is the falsifiable half of the rule — a fold candidate is detectable as a row that does **not** name
its own acceptance clause (count 0), or as two rows whose acceptance clauses name the same command.
What the probe cannot decide is whether two clauses name the *same assertion* in different words;
that stays a human call, and it is the only part of the rule left to judgement.

## Applied to the rows actually on the table

- **ROADMAP 92 vs 94 — STAND BESIDE.** `docs/ROADMAP.md:1806-1821` (92) accepts on "an omitted
  tool-result entry is absent from the model context but present in `log`, and the open-call case is
  refused"; `docs/ROADMAP.md:1833-1840` (94) accepts on "a session that hits the cap takes a fresh
  conversation at the next item boundary and still completes the item". Two commands, two different
  reds; 94's failure mode is a loop (never converges → iteration cap + plateau exit), 92's is a
  silent context view. A bounding test cannot prove the cap. Lead ruled the same for #94 vs the
  send-time bounding work in #5208; the clause "and still completes the item" is what keeps 94 a
  completeness check and not merely a counter, so it must not be trimmed in any rewrite.
- **#4973 (build: bound the input + readable failure) vs the cause-class vocabulary (minted as
  #5206) — STAND BESIDE**, per rule (3): vocabulary vs behavior. #5206 names #4973 as the
  implementation carrier, which is the right way to show a pair — cross-reference, not merge.
- **#2402 / #2403 — FOLD (into 92 and 94 respectively).** Their content is already on the durable
  surface and neither row owns a distinct assertion: the ordering `mask → summarize at a phase
  transition → preserve pointers → cap → re-anchor` is recorded at `docs/DECISIONS.md:2936`, the
  cap-at-2-then-force-re-anchor parameter at `docs/DECISIONS.md:2934` **with its pointer to ROADMAP
  94**, and `docs/DECISIONS.md:2880` (D107) is the mechanism decision. My earlier pass reached the
  same place from the other direction: `docs/reviews/architecture-capacity-rulings-2026-11-03.md:269-271`
  says 92/#2402 "is decision 2's step 2 — do not open a sixth row for it" and #2403 "fold into 92/94
  rather than running beside them". Re-checking #2402 against the rule: split, its halves are "the
  `ContextEdit` surface exists" (true today, unactionable alone — rule fold-3) and "mask before
  summarize" (proved by 92's own demo — rule fold-1). So the fold is right and no row is lost,
  because both halves still have a named home row and a named owner (`impl`, at 92's *Owner* line).
- **#2619 — STAND BESIDE, and the capacity fold is not a candidate for it at all.** `#2619` appears
  in my own review as one of 11 rows that cite a cancelled item **as provenance, not as a gate**
  (`docs/reviews/architecture-queue-lifecycle-redesign-review.md:395-397`). Provenance is a
  bookkeeping edge, not a shared acceptance check, so rule fold-1 fails on its face. The real defect
  attached to that row family is the gate false-positive (`gate-not-cancelled` firing on provenance)
  and its fix (`block.source === "declared"` gating) is already written in that review's F15 — the
  fold question must not be allowed to absorb it.

## Failure modes this decision is buying protection against

| Failure | What a wrong fold does | Recovery path |
| --- | --- | --- |
| Silent regression of one half | A green run tells you nothing about which half broke | Unfold: restore the row with its own `*Acceptance:*` clause; the probe above shows the missing count-0 row |
| Cascade (a folded row poisons the next) | A later seat reads one row as covering two concerns and ships half | The `*Owner:*` + `*Acceptance:*` pair per row makes the uncovered half visible at claim time |
| Loop (fold debate recurs) | The same question is deferred to lead every session | D221 is the standing rule; only the same-assertion-in-different-words judgement escalates |
| Scope drift | Folding to shorten the roadmap | Refused outright by the rule; the probe's count is the tell |

## Out of scope here (escalated, not decided)

Whether any of these rows *ship*, and in what order, is lead's call. This document only fixes what
makes a row one row. Nothing under `src/` was touched; no code was written by this item.
