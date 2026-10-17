# Research request — task-source adapters / PM-tool integration (follow-up)

**Ask:** hand this to the operator's research agent. Report to
`docs/reviews/llm-agent-project-management-tools-followup.md`.

This is the **follow-up** to `docs/reviews/llm-agent-project-management-tools.md`. That survey mapped the
ecosystem's four archetypes and recommended a thin `TaskSource` seam with MCP as the first adapter. This
request asks the questions it left open, grounded in **durig's actual constraints** — the first pass could
not see them.

## Context

`durig` is a durable, multi-seat LLM agent rig built on `pi-durable`. A **single-writer broker** drives a
cross-seat work queue (`RigQueue`); seats claim items and act in isolated git worktrees; a delegate
operates for the human operator; the TUI/CLI are the read surfaces. The queue state machine is
`queued → claimed → done`, plus `claimed ↔ deferred` and `claimed → held → queued`, with terminal
`cancelled` (`src/rig.mjs`). The store is append-only SQLite.

**What the first pass found and we accepted** (recorded in `docs/PM-ADAPTERS.md`, ROADMAP items 115–117):
use a thin `TaskSource` adapter; make MCP the first adapter rather than N REST integrations; keep
`RigQueue` the single authority (adapter is one-way and idempotent); split *task source* from *board/UI*.

**Constraints the first pass could not see (the reason this follow-up matters):**
- **No seat network egress.** Seats run with `inheritEnv:false`, an allowlisted env, and no network
  capability (`src/confine.mjs`). The broker opened **no socket** (D11/D45). We verified that the official
  **Linear and Atlassian MCP servers are remote/HTTP**, so a seat cannot call them directly.
- **Single writer.** Two writers to the store corrupted it twice; a second writer to the queue is the
  hazard that shapes every adapter design.
- **Native Windows**, no `wsl`/`docker`.
- `pm`/`lead` have **no file tools**, so any adapter status surface must reach them inline.

## Questions

Answer each from external evidence where possible. Where a question is about *our* code/behaviour and is
not externally answerable, say so and mark it **internal — unverified** rather than guessing.

**A. MCP on a no-network, single-writer host (keystone)**
1. Which MCP transports can run **local/stdio with no network egress**, and are there mature local MCP
   servers for GitHub / Jira / GitLab / Linear? What is the offline/local path when the vendor server is
   remote?
2. How are MCP servers launched and sandboxed as **child processes on Windows**, and what is the security
   prior art (tool allowlisting, filesystem/network limits)? What is known about **prompt injection via
   MCP tool descriptions/results**?
3. Can an MCP client be driven from a **single-writer** process without the MCP server becoming a second
   writer? What concurrency/idempotency model do MCP clients use?

**B. One-way sync correctness (idempotency and reconciliation)**
4. Prior art on one-way sync/ingest with **external ids**: idempotency keys, upsert/dedupe, and the
   **transactional-outbox** pattern. Exactly-once vs at-least-once when the local queue is authoritative.
5. What happens when the tracker item is **edited, closed, or reopened after ingest**? Established
   reconciliation policies for a one-way mirror, and how to detect a second writer.
6. How do integrations avoid **double-writes** when both the tracker API and the local queue can mutate
   state?

**C. Status / state mapping**
7. Prior art mapping an internal state machine (`queued/claimed/deferred/held/done/cancelled`) onto Jira
   statuses, GitHub labels, or Linear states **idempotently**, including transitions the tracker cannot
   express. Any de-facto schema?
8. How do teams represent **blocked / deferred-awaiting-answer / needs-review** in mainstream trackers?
9. Which direction should be authoritative for state (tracker → queue, or queue → tracker), and the
   evidence for it.

**D. Authentication and secrets**
10. Managing OAuth 2.1 / API tokens for trackers in an agent harness: storage, rotation, least privilege,
    read-only scopes (e.g. Linear's `/readonly`). Prior art on secret handling.
11. Prompt-injection risk from **tracker content** (issue bodies, comments) and established mitigations.

**E. Wake and polling without inbound webhooks**
12. Without an inbound webhook endpoint, what are the efficient, **rate-limit-safe** polling patterns for
    GitHub / Linear / Jira (ETags/conditional requests, cursor/GraphQL, intervals, backoff)? Published
    rate-limit data.
13. Are there push mechanisms that need **no inbound endpoint** (long-poll, SSE from a local client)? Their
    trade-offs versus our broker's local commit-stream wake.

**F. Decomposition and human-in-the-loop**
14. Evidence on **where decomposition should happen**: a human assigns discrete items (Emdash) versus an
    agent decomposes a goal. What is the failure evidence for agent self-decomposition?
15. How do boards surface **humans watching a swarm** — read-only client views, attention/confidence
    signals? What makes an operator trust and verify a machine-driven queue?

**G. Concrete adopt targets**
16. Given **native Windows + no Docker/WSL + no seat network**, which open-source adapter or board should
    durig embed or mirror first? Is Agent Board (`quentintou/agent-board`, HTTP localhost + JSON files +
    MCP) embeddable, and what are its license/operability constraints?
17. Is there a de-facto standard **"task source" schema** (external id, title, body, state, assignee,
    dependencies, comments, audit)?

**H. Evaluation**
18. How should a task-source adapter be tested — replaying a tracker's event stream, a **fake MCP server**,
    and metrics for sync correctness (duplicate rows, lost updates, mapping drift)? Prior art.

## Deliverable

`docs/reviews/llm-agent-project-management-tools-followup.md`, with:

- A per-question answer, each grounded in an external source with a **URL** and an **evidence class**
  (`advertised-elsewhere` vs `observed`), or explicitly marked **unverified / internal**.
- A recommended **adapter architecture** for a no-network, single-writer host (where the MCP client runs,
  which transport, how writes are made safe) — or an explicit statement that the constraint makes the
  approach infeasible.
- A recommended **sync/reconciliation policy** (idempotency key, one-way direction, conflict handling).
- A recommended **state-mapping** convention and which side is authoritative.
- A recommended **first concrete target** and a build/don't-build call against embedding an existing board.
- An **evaluation design** (fake MCP server + sync-correctness metrics).
- Proposed **ROADMAP items** for durig (registered, not scheduled) and any correction to items 115–117.
- An explicit list of anything you **could not verify**.

## Evidence discipline

- Every external claim cites a **URL** and states its class (`advertised-elsewhere` vs `observed`).
- Map every finding either to a concrete durig mechanism (`src/rig.mjs`, `src/confine.mjs`, the broker,
  the store, the TUI) or name it **unverified**.
- Do not restate the first pass's conclusions as settled where this request asks for deeper evidence.

## Constraints

- **Written report only; do not modify code.**
- Baseline to read: `docs/reviews/llm-agent-project-management-tools.md`, `docs/PM-ADAPTERS.md`,
  `docs/ROADMAP.md` items 115–117, `src/rig.mjs` (the queue state machine), `src/confine.mjs` (the
  no-network seat env), and `docs/runbooks/competitor-review.md` (the clone-and-cite method).
- Prefer primary sources (papers, provider docs, first-party engineering blogs) over aggregators; say when
  a claim rests on a community report rather than a controlled result.
