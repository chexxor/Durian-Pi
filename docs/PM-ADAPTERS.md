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
- **No seat network egress.** Seats run with `inheritEnv:false`, an allowlisted env, and no network
  capability (`src/confine.mjs`); the broker opened no socket (D11/D45). The **official Atlassian and
  Linear MCP servers are remote/HTTP** (verified 2026-10-17), so a seat must not call them directly.
  The MCP client belongs in the **operator/broker path** (which may have network), or must be a
  **stdio/local** server. Inbound webhook wake implies a listening endpoint and is operator-gated.
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
ROADMAP items **115–117** (`docs/ROADMAP.md`): the `TaskSource` seam + state mapping; the local/stdio MCP
adapter; and a read-only external status view.
