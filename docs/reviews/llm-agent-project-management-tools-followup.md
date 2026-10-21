> **D103 rename (2026-10-18):** this record predates the product rebrand `durig` → `durian-pi`; it keeps the old name so the audit trail stays truthful.

I'll ground this in your actual repo first, then research the open questions.The file tree capture didn't include the specific files. Let me pull them directly.Now I have the repo constraints. Let me gather the external evidence for the open questions.I have enough to deliver the report. One note before it: your workspace here is read-only, so I can't write `docs/reviews/llm-agent-project-management-tools-followup.md` — the full content is below for you to drop in.

Also two honesty flags up front, because they change the architecture answer:
- **Items 115–117 and `docs/PM-ADAPTERS.md` were not in what I could read.** `ROADMAP.md` is 2,188 lines and I read ~2,000; the first-pass review file and `PM-ADAPTERS.md` are not in the repo tree capture at all. Anything I say about your accepted decisions is taken from your request text, not from your files. **Internal — unverified.**
- **`confine.mjs` does not appear to enforce network egress.** What I *observed* there is path confinement (`isInside`/`relative`, symlink canonicalisation), a forced `inheritEnv:false` with an env allowlist, a `SECRET_NAME` regex, and a denied-command list (wsl, docker, destructive git). There is **no socket/firewall block** in that file [^1] [^1] [^1]. No proxy/credential vars reach a seat, but a seat's PowerShell could still open a TCP connection unless something *else* blocks it. **Internal — unverified; verify before designing around "seats have no egress."**

---

# durig — task-source adapters / PM-tool integration (follow-up report)

## A. MCP on a no-network, single-writer host

**A1 — Local/stdio transports, and the offline path.** MCP defines exactly two standard transports: **stdio** (JSON-RPC over stdin/stdout, client launches the server as a subprocess) and **Streamable HTTP** (server is an independent process serving multiple clients over one HTTP endpoint with optional SSE) [^2] [^3] [^4]. Clients "SHOULD support stdio whenever possible" [^2]. *Class: advertised-elsewhere (spec).*

Mature **local/stdio** servers exist for **GitHub** (official `github/github-mcp-server`, a Go binary run locally over stdio, with a remote-hosted option too) [^5] [^6], and **GitLab** (official server [^7]; a local **GitLab Orbit** server that "supports stdio transport" [^8]; and the community `zereight/gitlab-mcp` exposing "stdio, SSE, and Streamable HTTP" [^9]).

The vendor servers for your two hardest targets are **remote-only**:
- **Atlassian**: "Official **remote** MCP server for Atlassian… securely connect Jira, Confluence, JSM, Bitbucket… using OAuth 2.1" [^10]; the client is pointed at Atlassian's hosted endpoint [^11].
- **Linear**: "Linear's MCP server follows the authenticated **remote** MCP spec, so the server is **centrally hosted and managed**" [^12]; "there's nothing to install" [^13].

**Offline/local path when the vendor server is remote:** there is no vendor-blessed local Jira/Linear server. The realistic options are (a) a **local stdio MCP server that wraps the tracker's REST/GraphQL API** (community servers follow this shape — e.g. `zereight/gitlab-mcp` and various Jira servers run as `npx` stdio processes) [^9] — but that process *still needs network egress*, so it must run where egress exists; or (b) a **file-based mirror** (export the tracker to JSON/SQLite) and point a local server at the mirror. The design consequence is decisive and is the keystone of the whole report: **the MCP client and any local stdio server belong in the broker/host process, not in a seat.** *Class: advertised-elsewhere.*

**A2 — Launching/sandboxing MCP servers as Windows child processes; injection.** The stdio model is literally "the client launches the MCP server as a subprocess" [^4]. The MCP spec's own security guidance is unusually blunt and maps almost one-to-one onto what `confine.mjs` already does:
- Clients supporting one-click local config **MUST** show the **exact command, untruncated**, identify it as code execution, and require explicit approval; they **SHOULD** highlight dangerous patterns (`sudo`, `rm -rf`, network ops, fs access outside expected dirs), **warn that MCP servers run with the same privileges as the client**, **execute in a sandbox with minimal default privileges**, and **launch with restricted filesystem and network access** [^14].
- For **stdio specifically**: proxy services **SHOULD** sandbox/containerise spawned processes, restrict filesystem access, **log all stdio usage**, and require extra authorization for dangerous commands [^14].

That "**same privileges as the client**" warning is the load-bearing fact for you: a stdio MCP server inherits the broker's identity, so if the broker can read the tracker token, so can the server — which is exactly why the env allowlist in `confine.mjs` (which refuses secret-shaped names, `SECRET_NAME`) is the right instinct and why the MCP client should not be *inside* the confined seat env [^1].

**Windows-specific prior art is thin and mostly community bug reports, not controlled results** — say so in the report. Examples: a Codex Desktop Windows stdio MCP server not receiving a user-level env var [^15]; a hardening issue enumerating Windows stdio hazards — **argv shape, async ENOENT, timeout+kill, stderr redaction, process-tree disposal** [^16]. These are `observed` by their authors, `advertised-elsewhere` for you.

**Prompt injection via tool descriptions/results** is a named class: *tool poisoning* is a subset of **indirect prompt injection / cross-domain prompt injection (XPIA)**, where malicious instructions are embedded in external content the agent reads [^17]; it is surveyed at protocol level in [^18]. Notably, the MCP spec security page I read covers confused deputy, **token passthrough**, and **state-handle hijacking** — and the fetch explicitly found **no focused prompt-injection/tool-poisoning guidance on that page** [^14] [^14]. So the protocol standard does *not* solve injection for you; it is a content-trust problem. *Class: advertised-elsewhere + observed (absence).*

**A3 — Driving MCP from a single-writer process.** MCP is **stateless with no protocol-level sessions**; servers that need cross-request state mint an explicit handle passed back as an ordinary tool argument [^14]. That is the key: the *protocol* imposes no second writer. A single client process can serialise all JSON-RPC calls and own all state. The server is not a writer to **durig's store** — it is a client of the *tracker*. So the concurrency model is: **one MCP client, in the single writer, issuing serialised calls; the tracker is the only external state; nothing else writes durig's store.** The real "second writer" hazard is not MCP at all — it is whether anything *else* (a webhook receiver, a second client, a cron) mutates the tracker and expects to drive the queue. Keep the direction one-way and that hazard disappears (see B).

## B. One-way sync correctness

**B4 — Prior art.** The canonical patterns are the **transactional outbox** (avoid the dual-write problem by writing state + intent in one local transaction, then relaying) and the **idempotent receiver** [^19] [^20] [^21]. The strongest, most quotable fact: **exactly-once delivery is impossible; the consumer must be idempotent** [^20]. Stripe's implementation is the reference for idempotency keys on mutating endpoints via an `Idempotency-Key` header, to make retries safe [^22] [^23]. **You already have this primitive**: `send --request-id` reuses an existing submission so a retry generates nothing (ROADMAP item 24d) [^24]. *Class: advertised-elsewhere.*

For a **one-way ingest with external ids**, the shape is: store the tracker's id as a **unique external key**; upsert on that key; treat re-ingest as a no-op; never derive the id from mutable content (your own 24d lesson — "the id is never derived from the text"). **At-least-once + idempotent consumer** is the correct and only honest guarantee when the local queue is authoritative.

**B5 — Item edited/closed/reopened after ingest; reconciliation; detecting a second writer.** A one-way **mirror** must decide, per state, whether the tracker is allowed to move an item *backwards*. The defensible policy: **terminal is terminal** (once durig's queue is `done`/`cancelled`, a tracker edit does not resurrect it; it raises an attention notice instead), and **only non-terminal, non-claimed** items accept inbound state changes. Detecting a second writer: compare the tracker's `updatedAt`/version against the value recorded at ingest; a divergence you did not cause is a second writer. (This is standard optimistic-concurrency, not a durig-specific claim — *advertised-elsewhere*.) Your broker's `audit.jsonl`-style append-only trail is the right place to record "what we wrote" so a divergence is attributable.

**B6 — Avoiding double-writes.** The dual-write problem is precisely the failure the outbox pattern exists to remove [^19]. For durig the clean rule is: **the queue is the sole authority for state; the tracker is a projection.** The adapter *writes to the tracker* only as a mirror of queue transitions (queue → tracker), and *reads from the tracker* only to *create new* items (tracker → queue, ingest once). No state is written to both as an authority.

## C. Status / state mapping

**C7 — Mapping your six states onto trackers, idempotently.** There is **no de-facto cross-vendor task-state schema** (see G17). The practical mapping:

| durig | GitHub (labels) | Jira (status) | Linear (state) |
|---|---|---|---|
| `queued` | `agent:queued` | To Do | Todo |
| `claimed` | `agent:claimed` + assignee | In Progress | In Progress |
| `deferred` | `agent:blocked` | Blocked | Blocked |
| `held` | `agent:held` | To Do + flag | Todo + label |
| `done` | `agent:done` (close issue) | Done | Done |
| `cancelled` | close as not-planned | Won't Do | Canceled |

The **idempotency trick** is the same in all three: make the *target state a function of a label/field you own*, and compute "what should the tracker show" from the queue every time, rather than issuing transitions. Then a repeated sync is a no-op. Transitions the tracker cannot express (`claimed ↔ deferred` is a *cycle* in your machine; Jira statuses are usually a DAG) are recorded **only** in the queue and surfaced as a **label**, not a status. *Class: advertised-elsewhere (vendor state models) + inference.*

**C8 — Blocked / deferred-awaiting-answer / needs-review.** Mainstream trackers express these as **labels/flags and link types**, not native states: Jira has "Blocked" flags and issue links; GitHub uses labels and `blocked-by`; Linear uses its "Blocked" state plus relations. The honest statement is that **none of them has a first-class "awaiting a human decision" state** — which is exactly durig's `deferred_awaiting_answer`, and why you surface it on your own attention channel rather than trying to encode it in the tracker. *Class: advertised-elsewhere.*

**C9 — Which direction is authoritative.** **Queue → tracker**, for a structural reason, not a preference: durig's single-writer discipline means the store cannot accept a second writer, and the queue carries the audit trail and the transition history the tracker lacks. A tracker→queue *authority* would make the tracker a second writer to task state. The only tracker→queue flow permitted is **item creation** (ingest), which is a one-way, idempotent, create-once operation. Evidence class: this follows from your own observed constraints [^1] [^24] plus the dual-write problem [^19]; the *general* principle is advertised-elsewhere, the application to durig is inference.

## D. Authentication and secrets

**D10 — OAuth 2.1 / tokens, storage, rotation, least privilege, read-only.** Linear ships a **dedicated read-only endpoint** — connect to `https://mcp.linear.app/mcp/readonly`, which "only ever exposes read tools" [^12] [^25] — and a read OAuth scope [^25]. Atlassian uses **OAuth 2.1 as primary** auth, with **API-token** auth for non-interactive/machine-to-machine scenarios [^11] [^26] [^27]. GitHub's server supports PAT/OAuth and can be scoped [^5]. The spec's own rule: **MCP servers MUST NOT accept tokens not explicitly issued for them**, and must not pass tokens through (token passthrough / confused-deputy) [^14] [^14].

For storage/rotation, the honest prior art is thin and mostly "use the platform's secret store / short-lived tokens"; the durig-specific control you *already* have is `confine.mjs`'s `SECRET_NAME` refusal, which stops credential-shaped env names reaching a seat even if a caller asks for them by name [^1]. Note the two-record divergence risk your own roadmap already flags for operator text (item 56, ROADMAP) — the same applies to a token that lives in the broker *and* gets mirrored into tracker state. **Internal — partly unverified.**

**D11 — Prompt injection from tracker content.** Issue bodies and comments are *external content* and are the textbook **indirect prompt injection / XPIA** vector [^17] [^18]. Mitigation is architectural, and it is the same principle that already governs `defer_work`: **never let ingested tracker content become an instruction.** In durig terms: an ingested item becomes a **queue item body** (data), it is read by a seat that already has a byte-stable constitution, and the seat has **no tool that acts on tracker content directly** — the MCP client is in the broker, so a seat can never call the tracker. That isolation is a *stronger* mitigation than any prompt filter, and it falls out of your no-seat-egress constraint for free.

## E. Wake and polling without inbound webhooks

**E12 — Rate-limit-safe polling (published data).**

| Tracker | Published limit | Conditional/cheap path |
|---|---|---|
| GitHub REST | 5,000 req/hr authenticated (well-established) | **Conditional requests with ETag**; a **304 does not count** against the primary limit [^28] [^29]; store ETags and reuse [^30] |
| Linear GraphQL | **3,000,000 complexity points/hr** for API-key auth [^31] | cursor pagination; complexity-based metering |
| Jira Cloud | points-based, tiered: e.g. **150,000 base + 30/user/hr**, per-tenant cap **500,000/hr**, plus a **separate per-second burst** limiter [^32] [^33] | conditional requests + jql `updated` cursors |

*Class: advertised-elsewhere (vendor docs).* The efficient pattern for all three is the same: **conditional GETs keyed on a stored ETag/updated-cursor, poll on a slow interval, and back off on 429** — never a per-seat poll (which your roadmap already forbids, item 4, "no polling tool" [^24]).

**E13 — Push without an inbound endpoint.** SSE and long-polling both let a *client* receive server-push over an **outbound** connection with **no inbound endpoint on your side** [^34] [^35]. That is genuinely available to the broker (which has egress) and *not* to seats. The trade-off versus your broker's **local commit-stream wake** (D45/D46, no socket) is: SSE/long-poll trades a persistent outbound connection for lower latency; your commit-stream wake is strictly local, has no rate limit, and cannot leak — so **keep the local commit-stream as the primary wake and treat tracker push as an optional accelerator inside the broker.** *Class: advertised-elsewhere + your observed broker design.*

## F. Decomposition and human-in-the-loop

**F14 — Where decomposition should happen.** Your own gap table already records the accepted answer: **orchestrator-worker (`pm` decomposes, workers claim), not a flat swarm**, "matches the strongest takeaway" [^24]. The external side: task decomposition into subtasks is a studied problem — a formal complexity framework reduces tasks to CSP/3-SAT and decomposes to minimise subtask complexity [^36] [^37], and practitioner guidance stresses that **good decompositions have independent subtasks** [^38] [^39]. The failure evidence for *agent* self-decomposition specifically is weaker and more anecdotal than the framing suggests; the strongest thing you can cite is your own MAST-derived table (FC1 termination, FC2 misalignment) [^24]. **Recommendation: human/PM assigns discrete items; agents do not self-decompose a goal.** Mark the "failure evidence" as **advertised-elsewhere / mixed**.

**F15 — Boards surfacing humans watching a swarm.** The recurring pattern is a **read-only client view**: Agent Board ships a `clientViewEnabled` read-only dashboard that "hides agent names and internal details" [^40]. Beyond boards, the field is moving toward **trace contracts** that make every model call, tool call, handoff, guardrail, and evaluator step inspectable, rather than vendor dashboards [^41] [^42]. For durig, the trust-and-verify answer is already partly built: `watch`/`log`/`status` + the attention channel with declared direction and blind spot [^24]. The gap is a **read-only aggregate view** (the "swarm" pane), which is precisely the `clientViewEnabled` idea. *Class: advertised-elsewhere.*

## G. Concrete adopt targets

**G16 — First target given native Windows + no Docker/WSL + no seat network.** Agent Board (`quentintou/agent-board`) is the closest fit and is **embeddable in principle**:

| Property | Finding | Cite |
|---|---|---|
| License | **MIT** | [^40] |
| Storage | **JSON files, atomic writes, no external DB**; per-file async mutex | [^40] |
| Interface | **REST on `http://localhost:3456/api`** + **MCP server (12 tools)** | [^40] [^40] |
| Columns | `backlog → todo → doing → review → done → failed` | [^40] |
| Dependencies | **DAG, cycle detection, `doing` gated on deps `done`** | [^40] |
| Audit | append-only `audit.jsonl` | [^40] |
| **Windows support** | **Not specified in the README** | [^40] |
| **Embedding** | **Not specified in the README** | [^40] |

**Windows support is unverified** and is the one thing to test before committing. **Vibe Kanban is sunsetting** — Bloop announced shutdown on 2026-04-10; it continues open source/community-maintained but its cloud kanban/issues features were removed [^43] [^44]. So **do not make Vibe Kanban the first target.**

**Build/don't-build call:** **Do not embed a board first.** Build a thin `TaskSource` adapter with **MCP as the boundary**, run the MCP client **in the broker**, and keep Agent Board as a *candidate mirror*, not a dependency — its JSON-file + localhost-REST shape means you can mirror to it later without coupling. Embedding an unverified-on-Windows board before your own seam exists inverts the risk.

**G17 — De-facto task-source schema.** There is **no single standard**. The convergent field set across Agent Board's REST/MCP [^40] [^40], GitHub, Linear, and Jira is: **external id, title, body, state, assignee, dependencies/blockers, comments, audit/timestamps**. Define *that* as your `TaskSource` interface and treat every tracker as a projection.

## H. Evaluation

**H18 — How to test a task-source adapter.** The accepted prior art is a **fake/mock MCP server** for testing tool handlers and the client, rather than hitting the real service [^45] [^46]; and **MCP Inspector** as the first-line connection/behaviour check, then evals in CI [^47]. Combined with durig's existing **offline faux provider** discipline (your whole suite runs offline), the design is:
1. **Fake MCP server** (stdio) that replays a recorded tracker event stream and can be told to return 429/304/edited/reopened.
2. **Sync-correctness metrics** — duplicate rows (must be 0), lost updates (must be 0), mapping drift (label≠queue state), and reconcile-divergence count. These read from the append-only store, so they add **no new write path** (D24 discipline).

---

## Recommended architecture (no-network, single-writer host)

```
tracker (GitHub/Linear/Jira)  ⇄  [ MCP client + local stdio server ]   ← in the BROKER/HOST (has egress)
                                        │  one-way, idempotent
                                        ▼
                                   RigQueue (sole authority, single writer, append-only)
                                        │  commit-stream wake (no socket)
                                        ▼
                                     seats (no egress, confined env)
```

- **Where the MCP client runs:** the broker/host process — the only process with egress and the single writer [^24]. Seats never call MCP.
- **Which transport:** **stdio** for anything local (GitHub, GitLab) [^5] [^8]; for **remote-only Linear/Atlassian** [^12] [^10], either point the broker's MCP client at the remote endpoint, or run a **local stdio server that wraps the vendor REST/GraphQL API** — both require the broker to have egress, neither requires a seat to.
- **How writes are made safe:** queue is authority; adapter is **one-way**; tracker mutations are a *projection* of queue transitions; ingest is create-once keyed on external id; idempotency via `requestId`-style keys [^24]; the MCP client serialises calls (MCP is stateless [^14]), so the server is never a second writer to durig's store.
- **Feasibility verdict:** the constraint does **not** make the approach infeasible — it *relocates* the MCP client out of the seat and into the broker. The only thing it forbids is a seat holding a tracker tool.

## Recommended sync/reconciliation policy

- **Idempotency key:** `(tracker, external_id)` unique; upsert; never derive from content.
- **Direction:** **queue → tracker** is authoritative; **tracker → queue** only for create-once ingest.
- **Conflict handling:** tracker `updatedAt`/version recorded at ingest; a divergence you did not cause = **second-writer alert**. Terminal queue states are immutable from the tracker side; an inbound change to a terminal item raises a notice, it does not resurrect it.
- **Guarantee:** **at-least-once + idempotent consumer** — exactly-once is impossible [^20].

## Recommended state mapping & authority

Use the table in C7; labels (GitHub) / flags (Jira) / a single owned field (Linear) as the *projection*, and **compute the tracker's expected state from the queue every time** so re-sync is a no-op. **Queue is authoritative** (C9).

## First concrete target + build/don't-build

**Build:** `TaskSource` interface + a **fake MCP server** + a **stdio MCP client in the broker**, targeting **GitHub first** (local stdio server, ETag polling [^5] [^28]) because it has the strongest local path and the cheapest conditional polling. **Don't build/embed** a board first; **don't** pick Vibe Kanban (sunsetting [^43]). Treat **Agent Board** as the mirror candidate, pending a **Windows operability test** [^40].

## Evaluation design

Fake MCP server (stdio, replay + fault injection: 429/304/edited/reopened) [^45] [^46]; MCP Inspector for the first connection check [^47]; sync-correctness metrics (duplicate rows, lost updates, mapping drift, reconcile divergences) computed read-only from the store.

## Proposed ROADMAP items (registered, not scheduled)

1. **Verify the no-egress claim.** Determine whether seat egress is blocked by `confine.mjs` or by host config — I could not find a socket block in that file [^1]. *Blocks everything downstream.*
2. **`TaskSource` interface + fake MCP server** (stdio; fault injection).
3. **MCP client in the broker**, GitHub stdio first, ETag polling.
4. **One-way sync + external-id ingest** with `requestId`-style idempotency; second-writer detection via recorded `updatedAt`.
5. **State-projection module** (queue → labels/status) with no-op re-sync.
6. **Read-only aggregate "swarm" view** (the `clientViewEnabled` idea) [^40].
7. **Agent Board Windows operability spike** (unverified) before any mirror.

**Correction to 115–117:** I could not read them (**internal — unverified**), so I cannot correct them. If 115–117 already say "MCP first adapter, queue authoritative," nothing above contradicts them — but add the relocation finding (client in the broker, not the seat) and the egress-verification item.

## Could not verify

- **Items 115–117, `docs/PM-ADAPTERS.md`, and the first-pass review** — not read (file tail / absent from tree capture). **Internal — unverified.**
- **Whether seat egress is actually blocked, and by what** — no network block observed in `confine.mjs`. **Internal — unverified.**
- **Agent Board on Windows, and whether it is embeddable** — README specifies neither [^40]. **Unverified.**
- **Failure evidence for *agent* self-decomposition** — the external literature covers decomposition generally, not agent-self-decomposition failure specifically. **Advertised-elsewhere / weak.**
- **Community Windows stdio-MCP reports** [^15] [^16] are author-observed, not controlled results.
- **No de-facto cross-vendor task schema** — inferred from the absence of one across the vendor docs I read, not proven by a negative source.

**References**

[^1]: [raw.githubusercontent.com](https://raw.githubusercontent.com/chexxor/Pi-OpenDurig/main/src/confine.mjs) (14%)
[^2]: [Transports - Model Context Protocol](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports) (1%)
[^3]: [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) (0%)
[^4]: [MCP Transport Mechanisms: STDIO vs Streamable HTTP](https://builder.aws.com/content/35A0IphCeLvYzly9Sw40G1dVNzc/mcp-transport-mechanisms-stdio-vs-streamable-http) (0%)
[^5]: [GitHub MCP Server Installation Guides](https://github.com/github/github-mcp-server/blob/main/docs/installation-guides/README.md) (0%)
[^6]: [Setting up the GitHub MCP Server](https://docs.github.com/en/copilot/how-tos/copilot-in-your-ide/customize-copilot/extend-copilot-with-tools-and-context/set-up-the-github-mcp-server) (1%)
[^7]: [GitLab MCP server](https://docs.gitlab.com/user/model_context_protocol/mcp_server/) (1%)
[^8]: [GitLab Orbit Local MCP server](https://docs.gitlab.com/orbit/local/access/mcp/) (1%)
[^9]: [zereight/gitlab-mcp: MCP server for GitLab: 100+ tools for ...](https://github.com/zereight/gitlab-mcp) (1%)
[^10]: [Official remote MCP server for Atlassian. Securely connect ...](https://github.com/atlassian/atlassian-mcp-server) (1%)
[^11]: [Understand Atlassian MCP server](https://support.atlassian.com/security-and-access-policies/docs/understand-atlassian-mcp-server/) (0%)
[^12]: [MCP server – Linear Docs](https://linear.app/docs/mcp) (1%)
[^13]: [Linear MCP Server: Tools, Setup, and the SSE Retirement](https://www.usecarly.com/blog/linear-mcp/) (1%)
[^14]: [Security Best Practices - Model Context Protocol](https://modelcontextprotocol.io/specification/2026-07-28/basic/security_best_practices) (18%)
[^15]: [Windows Codex Desktop stdio MCP child process does not ...](https://github.com/openai/codex/issues/24362) (0%)
[^16]: [Harden session stdio MCP launch and lifecycle on Windows](https://github.com/stefandevo/glm-acp-agent/issues/92) (1%)
[^17]: [Protecting against indirect prompt injection attacks in MCP](https://developer.microsoft.com/blog/protecting-against-indirect-injection-attacks-mcp/) (1%)
[^18]: [From Prompt Injections to Protocol Exploits: Threats in LLM ...](https://arxiv.org/html/2506.23260v1) (0%)
[^19]: [Transactional outbox pattern - AWS Prescriptive Guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html) (1%)
[^20]: [Pattern: Transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html) (0%)
[^21]: [Transactional Outbox- Idempotent Receiver Pattern](https://medium.com/@subodh.shetty87/designing-reliable-distributed-systems-transactional-outbox-idempotent-receiver-pattern-99ed6a0bdcb2) (0%)
[^22]: [Idempotent requests | Stripe API Reference](https://docs.stripe.com/api/idempotent_requests) (1%)
[^23]: [Designing robust and predictable APIs with idempotency](https://stripe.com/blog/idempotency) (1%)
[^24]: [raw.githubusercontent.com](https://raw.githubusercontent.com/chexxor/Pi-OpenDurig/main/docs/ROADMAP.md) (23%)
[^25]: [Linear MCP Server Permissions & Controls, Explained](https://agenticcontrolplane.com/mcp-controls/linear) (1%)
[^26]: [Configure OAuth 2.1 | Atlassian AI Gateway | Atlassian Support](https://support.atlassian.com/atlassian-ai-gateway/docs/configure-oauth-2-1/) (1%)
[^27]: [Authentication and authorization | Atlassian AI Gateway](https://support.atlassian.com/atlassian-ai-gateway/docs/authentication-and-authorization/) (0%)
[^28]: [Best practices for using the REST API](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api) (0%)
[^29]: [Best practices for using the REST API - GitHub Docs](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api?apiVersion=2022-11-28) (1%)
[^30]: [Best practices for handling rate limits when using the REST ...](https://github.com/orgs/community/discussions/156480) (0%)
[^31]: [Rate limiting – Linear Developers](https://linear.app/developers/rate-limiting) (1%)
[^32]: [Rate limiting - Jira Cloud platform](https://developer.atlassian.com/cloud/jira/platform/rate-limiting/) (2%)
[^33]: [Action Required: Update your Apps to comply with Jira Cloud Burst API ...](https://community.developer.atlassian.com/t/action-required-update-your-apps-to-comply-with-jira-cloud-burst-api-rate-limits/97202) (1%)
[^34]: [Polling vs. Long Polling vs. SSE vs. WebSockets vs. Webhooks](https://thecodinggopher.substack.com/p/polling-vs-long-polling-vs-sse-vs) (1%)
[^35]: [Real-Time Notifications Architecture: WebSockets, SSE, and Polling Compared](https://www.suprsend.com/post/real-time-notifications-architecture) (0%)
[^36]: [An Approach for Systematic Decomposition of Complex LLM Tasks](https://arxiv.org/html/2510.07772v1) (1%)
[^37]: [An approach for systematic decomposition of complex llm tasks](https://arxiv.org/pdf/2510.07772) (1%)
[^38]: [How to Create Task Decomposition](https://oneuptime.com/blog/post/2026-01-30-task-decomposition/view) (0%)
[^39]: [How task decomposition and smaller LLMs can make AI ...](https://www.amazon.science/blog/how-task-decomposition-and-smaller-llms-can-make-ai-more-affordable) (0%)
[^40]: [GitHub - quentintou/agent-board: Open-source multi-agent task board for OpenClaw. Kanban + DAG dependencies + MCP server + auto-retry + audit trail. Built for autonomous AI agent teams. · GitHub](https://github.com/quentintou/agent-board) (9%)
[^41]: [Agent Observability Is Escaping the Dashboard](https://swarmsignal.net/agent-observability-is-escaping-the-dashboard/) (1%)
[^42]: [Top 8 AI Agent Observability Platforms for 2026](https://www.confident-ai.com/knowledge-base/compare/best-ai-agent-observability-tools-2026) (0%)
[^43]: [BloopAI/vibe-kanban: Get 10X more out of Claude Code, ...](https://github.com/BloopAI/vibe-kanban) (1%)
[^44]: [9 Open-Source Agent Orchestrators for AI Coding (2026)](https://www.augmentcode.com/tools/open-source-agent-orchestrators) (0%)
[^45]: [Improve tool harness testing with fake MCP server · Issue #8](https://github.com/eddmann/obsidian-mcp/issues/8) (0%)
[^46]: [Mock MCP Servers — Free Public MCP Server URLs for Testing](https://mcpplaygroundonline.com/mock-mcp-servers) (1%)
[^47]: [How to Test MCP Servers Effectively: A Step-by-Step Guide](https://mcpplaygroundonline.com/blog/how-to-test-mcp-servers-step-by-step) (0%)


-------------

Here is the PM Adapters doc: https://github.com/chexxor/Pi-OpenDurig/blob/main/docs/PM-ADAPTERS.md


-------------

I'll read the actual doc now.The attachment is actually the research-request doc (I have that). Now let me fetch the real `PM-ADAPTERS.md` from the URL.Got it — this is the real `docs/PM-ADAPTERS.md` (the attachment was actually the research-request doc). Reading it changes three things in my prior report and **verifies** what I previously had to mark unverified. Here's the delta, not a re-run.

## What the doc verifies (my prior flags clear)

- **Items 115–117 are now confirmed, not unverified.** Content: the `TaskSource` seam + state mapping (115); the local/stdio MCP adapter (116); and a read-only external status view (117) [^1]. My prior "I could not read them" flag is resolved.
- **The accepted architecture matches what I recommended** — `RigQueue` sole authority, one-way/idempotent adapter keyed by external id, MCP as the neutral protocol, task-source split from board/UI [^1]. No contradiction there.

## Three corrections to my prior report

**1. My "enforced dependency DAG" recommendation is wrong for durig — withdraw it.**
I listed Agent Board's cycle-detected, dependency-gated `todo → doing` transition as a "load-bearing semantic to borrow" [^356858#104-119]. The doc explicitly rules the other way: Agent Board *enforces* the DAG, while **durig deliberately keeps dependencies advisory**, and enforcing them "would be a separate ruling" [^1]. So the adapter must **preserve advisory dependencies and not block a transition on unmet deps.** Do not port Agent Board's enforcement.

**2. My transport lean was too permissive — the doc gates it harder than I did.**
I leaned toward "point the broker's MCP client at the remote Linear/Atlassian endpoints" [^e75585] [^d50737]. The doc's position is stricter: **"Local/stdio MCP is the target; remote HTTP is operator-gated"** [^1], and "Remote MCP or inbound webhook wake for seats" is explicitly rejected/deferred [^1]. That *strengthens* my "GitHub first" call — the official GitHub server is a locally-runnable stdio binary [^e0d17d], so it's the only mainstream tracker that satisfies the doc's target without an operator gate. Linear/Jira fall to the operator-gated tier by the doc's own ruling, not by my inference.

**3. My "semantics to borrow" list is mostly already satisfied — only four items are actually new.**
The doc's table [^1] maps atomic claim/lease → `claim_work` + `genlock`, one-worktree-per-task → `prepare_workspace`, append-only audit → the pi-durable store, review gate → qa/auditor DONE-vs-DELIVERED, bounded retry → `resume`, comments-as-log → the transcript. So my prior list of load-bearing semantics was largely redundant with existing durig mechanisms. The genuinely **new** work is only:
- external-id idempotency on ingest,
- one-way sync + second-writer detection,
- state projection (queue → labels/status),
- the fake-MCP-server evaluation harness.

Everything else on my list was "adopt = nothing to build."

## The one flag that survives — and it now matters more

The doc cites **`src/confine.mjs`** as the source of "no network capability" for seats [^1]. My reading of that file found path confinement, `inheritEnv:false` + env allowlist, a `SECRET_NAME` refusal, and a denied-command list — **but no socket/firewall block** [^f8e6f0#94-127] [^f8e6f0#146-184] [^f8e6f0#297-313]. So the doc asserts a property the cited file doesn't visibly enforce. Either the egress block lives elsewhere (host config, or simply "seats never get a network tool"), or the citation is imprecise. This is the keystone: the whole "MCP client must live in the broker" design rests on it. **Still internal — unverified.** Confirm the mechanism before item 116 lands.

Also note the doc adds a constraint my report under-weighted: **`pm`/`lead` have no file tools, so any adapter status surface must reach them inline** [^3bb926#41]. That's separate from the human-facing read-only view — the inline status path is a real adapter requirement, not just a UI nicety.

## Revised proposal

**Architecture (unchanged, now doc-aligned):** MCP client in the **broker**, stdio transport, queue authoritative, one-way idempotent adapter. The doc's own target wording supersedes my "broker may hit remote endpoints" framing.

**Revised ROADMAP items (registered, not scheduled):**

1. **Verify the no-egress mechanism** — locate what actually blocks seat egress, since `confine.mjs` doesn't visibly do it [^f8e6f0]. *Blocks 116.*
2. **`TaskSource` seam + state-mapping spec** (= doc 115) [^1].
3. **Fake MCP server** (stdio; fault injection: 429 / 304 / edited / reopened) [^98d15f] [^278529].
4. **Local/stdio MCP client in the broker, GitHub first** (= doc 116) [^1] [^e0d17d].
5. **One-way sync + external-id ingest** with `requestId`-style idempotency [^6c3124#1231-1247]; second-writer detection via recorded `updatedAt`.
6. **State-projection module** (queue → labels/status), **advisory deps preserved — no DAG enforcement** (per [^1]).
7. **Read-only external status view** (= doc 117) [^1], **plus an inline status path for `pm`/`lead`** [^3bb926#41].
8. **Agent Board Windows operability spike** — demoted to a *read-only mirror candidate* consistent with 117, not a dependency. Its enforced-DAG and localhost-REST+JSON shape make it a poor embed but a plausible read-only projection; Windows support remains unspecified [^356858].

**Build/don't-build:** unchanged — build the seam and the fake MCP server first; don't embed a board; don't pick Vibe Kanban (sunsetting [^18cced]). The doc's rejection of "replacing `RigQueue` with an external board" and of "a bespoke web UI first" [^1] is consistent with that.

**Correction to 115–117:** they stand as written; the only amendment is to **strike DAG enforcement** from any mapping work and to add the **inline-status-for-`pm`/`lead`** requirement alongside 117.

**References**

[^1]: [docs/PM-ADAPTERS.md](https://github.com/chexxor/Pi-OpenDurig/blob/main/docs/PM-ADAPTERS.md) (100%)