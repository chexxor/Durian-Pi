# External task-source adapters (PM tools)

Design note from the research report `docs/reviews/llm-agent-project-management-tools.md` (consumed
2026-10-17 per `docs/runbooks/research-request.md`). It answers: should durig let a mature PM tool
(Jira, GitHub Issues, Linear, a kanban board) manage our work items? This note records the accepted
direction and the constraints the report could not see.

## What the research found
The ecosystem has four archetypes: (1) an existing tracker **is** the queue (Miko, Baton, Code Conductor,
Orbi, no_human, Emdash), (2) purpose-built **agent kanban** boards (Agent Board, Vibe Kanban, KaibanJS),
(3) **repo-native task files / git as the board** (Baton's `WORKFLOW.md`, gnap, NEEDLE, gastown), and
(4) **MCP** as the neutral adapter layer (official Atlassian and Linear servers; Agent Board ships its
own). The consensus recommendation: define a thin `TaskSource` seam and make **MCP the first adapter**,
rather than N bespoke REST integrations.

## Accepted direction
1. **`RigQueue` stays the single authority.** The broker is the single writer; an external tool is a
   **source** (ingest work items into the queue) and a **mirror** (export status back), never a second
   writer. Every adapter is therefore **one-way by default**, keyed by an external id, and idempotent
   (re-ingest must not duplicate a row).
2. **A thin `TaskSource` adapter seam**, not a rewrite. `RigQueue`'s existing state machine
   (`queued → claimed → done`, plus `deferred`/`held`, plus terminal `cancelled`; `src/rig.mjs`) is the
   internal contract; the adapter maps to it.
3. **MCP as the preferred protocol** — one client reaches GitHub/Jira/Linear/Agent Board instead of N
   REST integrations. **Local/stdio MCP is the target; remote HTTP is operator-gated** (see constraints).
4. **Two concerns, two adapters:** *task source* (where items come from) vs *board/UI* (where humans
   watch and steer). durig's TUI is already the board; a read-only external view is optional and must add
   no write path.
5. **An explicit state-mapping spec** is required for any adapter: external statuses and durig's columns
   are not 1:1, and the mapping must be idempotent and cycle-safe.

## durig constraints the report could not see
- **Seat network egress is NOT blocked by `src/confine.mjs`.** That file enforces path confinement, a
  stripped env allowlist, and a `SECRET_NAME` refusal, but it contains no network/socket rule — a seat
  shell could open a connection, and no other egress control was found (verified 2026-10-17). What a seat
  genuinely lacks is a network **credential** and a network **tool**. The MCP client still belongs in the
  **operator/broker path**, because that is where the tracker token lives and where the single writer runs;
  a seat must never be given a tracker tool. Remote/HTTP MCP and inbound webhook wake remain
  operator-gated. The egress mechanism is **unverified** (ROADMAP 118).
- **Single writer.** Two writers to one store corrupted it twice; an adapter that both reads *and* writes
  the tracker must not let the tracker write `RigQueue` concurrently. Ingest is a broker-path operation.
- **Native Windows**, no `wsl`/`docker`; a local MCP/board process must be Windows-runnable.
- `pm`/`lead` have no file tools; any adapter status surface must reach them inline.

## Semantics we already satisfy (adopt = nothing to build)
| Established semantic | durig mechanism |
|---|---|
| Atomic claim / lease on pickup | `claim_work` (by-id, refuses wrong owner/state) + `genlock` generation leases |
| One worktree per task | `prepare_workspace` / `src/worktree.mjs` |
| Append-only audit log | the append-only pi-durable store |
| Review gate distinct from done | qa/auditor verification + DONE vs DELIVERED |
| Bounded retry | `resume` / attempt semantics |
| Comments as the reasoning log | the conversation transcript / TUI |

## Design choice vs established practice
Agent Board **enforces** a dependency DAG (moving to `doing` is blocked until dependencies are `done`,
with cycle detection). durig deliberately keeps dependencies **advisory** (the queue-view item); enforcing
them would be a separate ruling. Task chaining (`nextTask`) likewise maps onto deps we already model.

## Rejected / deferred
- **Remote MCP or inbound webhook wake for seats** — a network surface; operator-gated only.
- **Replacing `RigQueue` with an external board** — violates single-writer and loses the broker's
  commit-stream wake.
- **A bespoke web UI first** — the TUI already covers the in-rig read surface.

## Work registered
ROADMAP items **115–122** (`docs/ROADMAP.md`): the `TaskSource` seam + state mapping (115); the local/stdio
MCP adapter, GitHub first (116); the read-only external status view plus an inline status path for
`pm`/`lead` (117); the egress-mechanism verification (118); the fake MCP server + sync-correctness metrics
(119); one-way sync with external-id idempotency and second-writer detection (120); the state-projection
module with advisory dependencies (121); and the Agent Board Windows operability spike (122).

## Follow-up consumed (2026-10-17)
The follow-up (`docs/reviews/llm-agent-project-management-tools-followup.md`) confirmed this direction and
made three corrections, all folded above: (1) the no-egress claim is **not enforced** by `confine.mjs`;
(2) keep dependencies **advisory** — do not port Agent Board's enforced DAG; (3) target **GitHub first** (a
locally runnable stdio MCP server + ETag polling), with remote Linear/Atlassian operator-gated. The
genuinely new work is only external-id idempotency on ingest, one-way sync + second-writer detection, state
projection, and a fake-MCP-server evaluation harness — the rest of the "semantics to borrow" list is
already satisfied by `claim_work`/`genlock`, `prepare_workspace`, the append-only store, the qa/auditor
gate, `resume`, and the transcript.

The integration questions are externally closed. Two things remain open: an internal one — locate what, if
anything, blocks seat egress (ROADMAP 118) — and the **value case** below.

## Value case — open (2026-10-17)
The research answers **how** to integrate an external tracker and **what** the ecosystem does; it does
**not** measure whether an external PM system makes an agent team more efficient, correct, or effective.
None of the sources present outcome evidence, so "should we use one" is a decision for the operator,
informed by measurement (ROADMAP 123), not settled by the reports. Separating the three:
- **Correctness:** a tracker does not improve agent-execution correctness, and a tracker that becomes a
  second writer *threatens* it. durig's correctness comes from the single-writer queue, the verification
  gate, and the worktree boundary. (Follow-up: exactly-once is impossible and the consumer must be
  idempotent; queue → tracker is authoritative, tracker → queue only create-once ingest.)
- **Efficiency:** the gains are human/coordination, not agent throughput — the broker schedules seats and
  never reads the tracker. The integration adds sync cost and rate-limit exposure (GitHub 5k/hr; Linear 3M
  complexity/hr; Jira tiered).
- **Effectiveness:** the real value is alignment and oversight — intake governance, priority, blocked/human
  decisions, and cross-team interop — provided the human process uses it. Trackers have **no first-class
  "awaiting a human decision" state**, so durig's `deferred_awaiting_answer` loses fidelity when mapped.

The honest verdict: an external tracker is primarily a **human/org interface**, not an agent-efficiency
lever; adopt the seam and the read-only view, keep the queue the control plane.

## Other value an external tracker can add
The research surfaced these as the value beyond "the agents read tickets":
- **Intake governance / admission control** — labels/gates (`ai-ready`, `conductor:task`) decide what work
  is allowed in, a human lever on correctness and alignment (survey archetype 1).
- **Human oversight, assignment, and accountability** — a familiar surface where a person assigns,
  watches, and audits, instead of reading transcripts (Emdash: human assigns; Agent Board's
  `clientViewEnabled` read-only view).
- **Cross-team / org interop** — work arrives from where the org already works (GitHub/Linear/Jira) and
  results post back, cutting copy-paste and context switching.
- **A durable, human-readable record that outlives the rig** — issue history, comments, links, and
  provenance independent of the append-only store.
- **Metrics and reporting** — cycle time, throughput, blocked time, and completion rates on the org's
  existing dashboards (Agent Board stats); a possible feed for the landing-health measure (item 100).
- **A human-in-the-loop decision surface** — a ticket is where a person already looks for a blocked item,
  the natural home for a deferral the store cannot express as a tracker state.
- **Traceability** — issue ↔ commit/PR linkage for compliance and bisectability.
- **Onboarding and discoverability** — a board explains what the swarm is doing without the harness.
- **Bulk planning** — epics/sprints/dependencies for humans; note durig keeps dependencies **advisory**.

And the costs to weigh against them: a possible second writer / sync drift, rate limits, token/OAuth
handling, prompt injection from tracker content, vendor coupling (Vibe Kanban is sunsetting), and building
the seam before any benefit is measured.
