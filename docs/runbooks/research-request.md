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
Read-only. The agent needs the question, the constraints, and the deliverable path.

## Diagnose (read-only)
Check whether it has already been asked/answered: search `docs/reviews/` for the topic, and
`docs/DECISIONS.md` for a ruling.

## Do
1. Write the prompt to `docs/reviews/<topic>-research-prompt.md`, in this shape (see the worked example
   `runbooks-research-prompt.md`):
   - **Context** — what the system is, the two audiences, and why the question arises.
   - **Questions** — numbered, specific, each answerable.
   - **Deliverable** — the exact report path and its required sections.
   - **Evidence discipline** — every external claim cites a URL and states its class
     (`advertised-elsewhere` vs `observed`); every finding maps to a mechanism or is named unverified.
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
4. `git add` the report and every folded doc, explicit paths, one concern per commit.

## Verify
The report exists under `docs/reviews/`, every external claim carries a URL + evidence class, and each
finding is mapped to a durig mechanism or explicitly listed as unverified. Every proposed item is either
registered in `docs/ROADMAP.md` or explicitly rejected with a reason. The informing doc links to the
report, and a competitor review has a `docs/COMPETITORS.md` entry.

## If it fails
If the report leaves a question open, do not guess — extend the prompt or defer the decision with
`defer_work`.

## Escalate to
operator — routing the prompt to the research agent.

## Evidence
Worked example: `docs/reviews/runbooks-research-prompt.md` → `docs/reviews/runbooks-sop-best-practices.md`
(2026-10-16), whose recommendations became ROADMAP items 81–88 and the conventions in this directory.
