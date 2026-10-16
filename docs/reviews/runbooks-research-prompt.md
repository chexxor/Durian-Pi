# Research request — runbooks / SOPs for an LLM-operated agent rig

**Ask:** hand this to the operator's research agent. Report to `docs/reviews/runbooks-sop-best-practices.md`.

## Context

`durig` is a durable, multi-seat agent rig built on pi-durable. A **single-writer broker** drives a
cross-seat work queue; **seats** (LLM personas) claim items and act; a **delegate** operates on the
human operator's behalf; a **TUI/CLI** are the read surfaces. Two audiences must be able to run an
operating procedure: the **human operator/delegate**, and an **LLM seat**, which reads a document and
executes it through tools.

We have been writing one-off recovery notes for incidents (a crashed broker, a corrupt store document, a
degenerate seat, leaked git worktrees) and want a **maintainable runbook/SOP set** instead. What we have
so far is `docs/runbooks/` (a convention plus five runbooks); its conventions are our own and we do not
know the established best practice.

## Questions

1. **Template and structure.** What sections make an operational runbook effective (trigger, preconditions,
   diagnosis, steps, verification, rollback, ownership, last-verified)? What is the evidence for each?
2. **Lifecycle and maintenance.** How should runbooks be versioned, reviewed, and *re-validated* so they
   do not rot? Who owns them; how is "last verified" recorded and enforced? Prior art: SRE runbooks,
   Google's "runbooks" chapter, PagerDuty response playbooks, Diátaxis, NIST/ISO procedures, "Runbook
   Automation".
3. **Human vs agent execution.** What changes when the reader/executor is an LLM agent rather than a human?
   Should steps be machine-readable (structured commands with preconditions and expected output) so an
   agent can execute them, or plain prose? What are the failure modes of an agent mis-reading a procedure
   (e.g., skipping a precondition, running a destructive step without a stop)?
4. **Guardrails.** How should a runbook express *hard preconditions* (e.g., "the single writer must be
   stopped and verified") so an executor cannot proceed on a false signal? Patterns for confirmation,
   dry-run, rollback, and idempotent steps.
5. **Organization and discoverability.** Naming, index, symptom-first vs system-first, retrieval by an
   agent, and how a runbook links to the design docs it must not duplicate.
6. **Anti-patterns.** What makes runbooks fail (too long, stale, duplicated with design docs, untested
   steps, prose pseudo-commands, hidden state)?
7. **Testing runbooks.** Ways to verify a runbook as an artifact (tabletop, a check rule, a script that
   runs the read-only diagnosis, chaos/fault injection) and the cost/benefit.
8. **Concrete recommendation for durig.** Given the single-writer broker and the delegate/seats split,
   propose the directory layout, the template, and a maintenance policy we can adopt, and name the ROADMAP
   items we should raise.

## Deliverable

`docs/reviews/runbooks-sop-best-practices.md`, with:

- A recommended **template** and **directory/organization**, justified and cited.
- A **maintenance policy** (review cadence, verification recording, ownership).
- The **agent-executable** considerations and guardrail patterns.
- An explicit **anti-pattern list**.
- Proposed **ROADMAP items** for durig (registered, not scheduled).
- Each external claim cites a **URL**; state the **evidence class** (`advertised-elsewhere` vs `observed`),
  and map every finding either to a concrete durig mechanism or to the one you could **not** verify.

## Constraints

- Do not modify code; this is a written report.
- The durig baseline is `docs/runbooks/`, `docs/BROKER-SUPERVISION.md`,
  `docs/COMMANDS-AND-THE-BROKER.md`, and `docs/NEXT.md` (the 2026-10-16 incident notes).
