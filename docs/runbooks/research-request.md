---
runbook: research-request
symptom: "a decision needs external evidence (prior art, best practice, a library's behaviour) we cannot get from the tree"
writes: false
precondition: "read-only"
last_verified: unverified
verified_by: delegate
evidence: "docs/reviews/runbooks-research-prompt.md (the worked example)"
check_rule: null
---

# Commission and consume external research

## When to use
A decision needs evidence outside the repo — published best practice, prior art, a competitor, or a
library/API behaviour — and guessing would be a claim we cannot ground. The operator has a research
agent for exactly this (`docs/SELFDEV.md` "Research escalations"); the delegate crafts the request.

## Impact
Without it, the team either guesses (ungrounded) or stalls on a question it cannot answer from the code.

## Preconditions
Read-only. The agent needs the question, the constraints, and the deliverable path. **The research agent is not on this
machine and has no write access to this repo (operator, 2026-10-28)** — so it cannot land anything: every artifact it
produces reaches us through the operator, and the **delegate** is the landing path (`Do` 5). Write a prompt that asks the
agent for *content to copy*, never for commits or repo writes.

## Diagnose (read-only)
Check whether it has already been asked/answered: search `docs/reviews/` for the topic, and
`docs/DECISIONS.md` for a ruling.

## Do
1. Write the prompt to `docs/reviews/<topic>-research-prompt.md`, in this shape (see the worked example
   `runbooks-research-prompt.md`):
   - **Context** — what the system is, the two audiences, and why the question arises.
   - **Questions** — numbered, specific, each answerable.
   - **Deliverable** — the exact report path and its required sections, **plus the copy-paste shape**: ask for each section
     as one fenced block with no narration, because what arrives in chat is what gets committed, and round 2's arrival had
     the agent's own narration glued to the title line (`docs/reviews/harness-tools-skills-public-harnesses-research.md`,
     first line, committed verbatim as `318838f5`).
   - **Evidence discipline** — every external claim cites a URL and states its class
     (`advertised-elsewhere` vs `observed`); every finding maps to a mechanism or is named unverified. **A line range into a
     page the agent fetched is not portable**: with no file channel, the portable unit is a **verbatim quote of ≤ 40 words
     + URL + the agent's own fetch date**, which the delegate can re-find in a freshly fetched copy. Ask for the quote, and
     accept a line range only beside it (ROADMAP **243**).
   - **Constraints** — e.g. "written report only; do not modify code".
2. Hand it to the operator to route to the research agent (the delegate cannot call it directly).
3. When the report lands, **take the actions it names**:
   - Fold accepted recommendations into the owning doc (e.g. `docs/runbooks/README.md`).
   - **Register the proposed ROADMAP items in `docs/ROADMAP.md`** (`registered, not scheduled`) — this is
     required, not optional. A report that changes what we build must reach the backlog: append each
     accepted item with its owner and acceptance, and let `pm` sequence it. Reject an item explicitly
     with the reason rather than leaving it only in the report.
   - Cross-link the report from the doc it informs.
   - Record any **design choice vs established practice** distinction the report flags.
   - For a **competitor/vendor review**, also add or update its `docs/COMPETITORS.md` entry — see
     `competitor-review.md`.
4. **Write the follow-up prompt.** A report almost always leaves questions open. Before closing the topic,
   write `docs/reviews/<topic>-followup-research-prompt.md` naming the unresolved questions — the areas we
   did not consider, and the details we cannot apply without more evidence — and hand it to the operator
   to route (the delegate cannot call the research agent). If the topic is genuinely closed, say so in the
   consumption note instead of writing an empty prompt.
5. `git add` the report and every folded doc, explicit paths, one concern per commit — **the delegate commits on the
   agent's behalf**, since the agent cannot. Before committing, re-fetch every cited URL into `inputs/fetched/` and
   generate `inputs/fetched/MANIFEST.md` (`sha256`, HTTP status, the page's own `last-modified`); then check that each
   quote the agent supplied is present in *our* copy. A quote we cannot find is recorded as `unverified` **in the folded
   docs**, while the agent's report body stays verbatim — we correct the record, not their artifact.

## Verify
The report exists under `docs/reviews/`, every external claim carries a URL + evidence class, and each
finding is mapped to a durian-pi mechanism or explicitly listed as unverified. Every proposed item is either
registered in `docs/ROADMAP.md` or explicitly rejected with a reason. The informing doc links to the
report, and a competitor review has a `docs/COMPETITORS.md` entry. Unresolved questions have a follow-up
prompt (`<topic>-followup-research-prompt.md`) or the topic is explicitly declared closed.
**Citation integrity is measured, not assumed:** count in-body markers against defined ones (a `grep -o` check, not a
judgement) and HTTP-check every URL in the evidence table. Dangling anchors and dead URLs are a finding to register
(ROADMAP **243**), not a style complaint — round 2 measured **64 distinct markers, 14 defined, 50 dangling, 3 URLs 404**.

## If it fails
- **The report leaves a question open** — do not guess; extend the prompt or defer the decision with `defer_work`.
- **Citations do not resolve** (dangling anchors, dead URLs, a corpus that stayed in the agent's workspace). Do **not**
  fold the report as if it were checkable and do **not** downgrade its conclusions on that basis alone: re-fetch the cited
  URLs into `inputs/fetched/`, generate `inputs/fetched/MANIFEST.md`, confirm or refute each load-bearing number against
  our own copy, record the gap in a dated consumption note, and register it (**243**). What killed round 2's checkability
  was an *input* nobody could open — the same failure class as ROADMAP **233**, one layer up.
- **The agent cannot deliver files** (it is off-host and has no repo write access — the normal case). Ask it for
  **quoted text**, not artifacts: ≤ 40-word verbatim quotes + URL + its fetch date per load-bearing claim. The delegate
  then fetches, manifests, and searches for the quote in its own copy; a quote that cannot be found is `unverified` in the
  folded docs. Never write a prompt that tells the agent to `git add`, commit, or create repo paths — it will report
  success into a void.
- **Arrival is chat text with narration glued to the body** (round 2). Commit the artifact **verbatim** first so it is
  attributable and durable, then put the delegate's corrections in a dated consumption note *above* the body; correct the
  record, never the agent's text.

## Escalate to
operator — routing the prompt to the research agent.

## Evidence
Worked example: `docs/reviews/runbooks-research-prompt.md` → `docs/reviews/runbooks-sop-best-practices.md`
(2026-10-16), whose recommendations became ROADMAP items 81–88 and the conventions in this directory.
**Failure worked example (2026-10-28):** `docs/reviews/harness-tools-skills-followup-research-prompt.md` →
`docs/reviews/harness-tools-skills-public-harnesses-research.md`, which arrived with 50 unresolvable citation anchors and
3 dead URLs because the prompt asked for line ranges into pages the agent fetched into **its own** workspace — a channel
that does not exist. Round 3 (`docs/reviews/harness-tools-skills-followup-2-research-prompt.md`) asks for quotes instead,
and `inputs/fetched/README.md` records who fetches (the delegate) and why.
