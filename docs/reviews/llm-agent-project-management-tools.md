> **D103 rename (2026-10-18):** this record predates the product rebrand `durig` → `durian-pi`; it keeps the old name so the audit trail stays truthful.

What tools, processes, or practices are open source projects that implement LLM agent teams using to manage the work the teams are working on? I'm thinking tools like Jira, GitHub issues, or a kanban board that the team might pull work items from.

For context, I am making an LLM agent harness of my own and in my project, https://github.com/chexxor/Pi-OpenDurig, I am developing a custom task management system that currently has no UI, but I'm considering making a plugin/adapter/extension that allows a user of my team harness to use a more mature, dedicated piece of software for project management and task management.


--------

I'll research this — it's a specific question about how real open-source agent-team projects handle work item management.## Short answer

There's no single dominant tool. The ecosystem has settled into **four recurring archetypes**, and most mature projects pick one and adapt it rather than build a bespoke task manager. Notably, almost nobody rolled their own state machine *and* their own UI — the two most common choices are "use GitHub Issues/Linear as the queue" and "use an agent-native kanban board."

---

## Archetype 1 — An existing issue tracker *is* the task queue

This is the most common pattern for autonomous "task runner" agents. The tracker's labels, assignees, and comments do all the work; the agent harness is just a poller + worker.

| Project | Task source | Claim/trigger mechanism |
|---|---|---|
| **Miko** (Apache 2.0) | GitHub Issues & PRs, GitLab MRs, Linear, Slack, Zulip | `@mention` on an issue/PR, or assign the Linear issue to Miko; each task gets its own git worktree and results post back to the originating issue/channel [^1] [^1] |
| **Baton** (`mraza007/baton`, MIT) | GitHub Issues | Poller runs `gh issue list`, dispatcher controls concurrency, reconciler detects stale runs; config lives in a single `WORKFLOW.md` [^2] |
| **Code Conductor** (`ryanmac`, MIT) | GitHub Issues labeled `conductor:task` | Agents claim labeled issues [^2] |
| **Orbi** | GitHub Issues labeled `ai-ready` | Implements in a worktree, a second session reviews the PR against the issue's acceptance criteria, then merges the reviewed head [^3] |
| **no_human** (MIT) | Jira, Linear, monday.com, GitHub/GitLab issues | Ticket → reviewed PR, with a second model told to refute "done" [^3] |
| **Emdash** | Linear, GitHub, Jira, GitLab, Asana, Featurebase, Monday.com, Forgejo, Plain | Human assigns tickets; explicitly *no* agent-to-agent coordination [^2] |
| **Contrabass / cyrus / Frink / sortie / lalph / Machinist** | Linear, GitHub, GitLab, Slack, Jira, Shortcut, ClickUp, or a local board | Issue-driven runs into isolated worktrees; Frink parks blocked agents in a "Work Queue" [^3] |

The classic research-grade version of this is **SWE-agent** and **OpenHands**: the unit of work *is* a GitHub issue, and the harness is a function `issue → patch/PR` [^4] [^5]. OpenHands has since grown a control-center layer that can "automatically decompose GitHub issues into tasks" [^5].

**Takeaway for you:** if you support GitHub Issues + Linear, you cover the majority of real deployments. Note the near-universal conventions: a *label* gates eligibility, *assignment* means claimed, *comments* are the agent's progress log, and *PR* is the deliverable.

---

## Archetype 2 — Purpose-built agent kanban boards

When teams want a UI that understands agents (columns, worktrees, diff review, live terminals), they use a board rather than a tracker.

- **Agent Board** (`quentintou/agent-board`, MIT) is the closest analogue to what you're describing. Six columns (`backlog → todo → doing → review → done → failed`), DAG dependencies enforced on column moves, `requiresReview` quality gates, auto-retry with `maxRetries`, task chaining via `nextTask`, comment threads for agent-to-agent discussion, HMAC-signed webhooks, and a full audit trail in `audit.jsonl`. Storage is **JSON files, no external database**, and it exposes **both REST and a 12-tool MCP server**. Agents pick up work by **heartbeat polling or webhook wake** [^6] [^6] [^6] [^6] [^6].
- **Vibe Kanban** (BloopAI) — kanban issues (To Do / In Progress / Review / Done) with each card spawning a *workspace* that gives an agent a branch, terminal, and dev server; supports 10+ coding agents and PR creation [^7] [^2]. ⚠️ Caveat: Bloop announced a shutdown on 2026-04-10; the project continues open source/community-maintained, but the cloud kanban/issues/projects features were removed and it is now fully local [^2].
- **KaibanJS** — a JavaScript-native framework that maps Kanban semantics (Trello/Jira/ClickUp-style) directly onto agent and task management, with a real-time board [^8] [^9].
- **Agent Kanban** — VS Code Copilot Chat participant storing the board as files: `.agentkanban/board.yaml` (lane definitions + base prompt), `memory.md`, `INSTRUCTION.md`, and per-task `tasks/task_*.md` [^2].
- Also in this family: **automaker** (describe features on a board, agents implement in worktrees), **kandev** (multi-step workflows with a different agent per step behind human gates), **Rove** (kanban cards launch sessions and *agents move the cards*), **Orchestrator.inc** (live kanban with PRs, CI, review), **Podium**, **Pragma**, **openkanban** (terminal kanban), **agent-kanban** (leader–worker board with cryptographic agent identity), **Fusion**, **octomux** [^3] [^3].

---

## Archetype 3 — Repo-native task files / git as the board

Lightweight, no server, diffable and version-controlled — attractive for a harness like yours.

- **Agent Kanban**'s `.agentkanban/` tree above [^2].
- **Baton**'s single `WORKFLOW.md` with YAML front matter + Jinja2 prompt body [^2].
- **gnap** — a "git-native agent protocol" where a shared repo *is* the task board, with no orchestrator process [^3].
- **gastown** — git-backed issue tracking plus a coordinator, health watchdogs, and a Bors-style merge queue, scaling to 20–30 agents [^3].
- **NEEDLE** — a shared *bead* queue in SQLite with **atomic claims**, dispatched to headless CLI agents through an explicit state machine; deliberately no inter-agent channel [^3].
- The broader "shared state files + git worktree per agent" pattern is now standard practice for parallel agent runs generally [^10] [^11].

---

## Archetype 4 — Coordination protocols and MCP as the adapter layer

This is the piece most relevant to your plugin question. Two distinct layers exist:

**(a) MCP servers as the interoperability standard.** Rather than writing a Jira adapter and a Linear adapter and a GitHub adapter, projects increasingly assume a generic MCP client. There are mature MCP servers for the mainstream trackers: an official **Atlassian MCP Server** bridging Jira/Confluence/JSM/Bitbucket with OAuth 2.1 [^12], an official **Linear MCP server** [^13], a community **mcp-linear** for retrieving/creating/updating issues, projects, and teams [^14], plus various Jira+GitHub combined MCP servers [^15]. Agent Board, Vibe Kanban, and others ship their own MCP servers so agents can manipulate cards natively [^6] [^7].

**(b) Agent-to-agent coordination primitives**, for the case where the "board" is really a shared work-claiming protocol: **Concord MCP** (claim work, detect edit collisions, exchange durable messages, transfer ownership, hand off review evidence — without replacing the host harness) [^3], **foremerge** (declare intent/semantic scope before writing; deterministic collision findings; Rust binary over local SQLite with MCP) [^3], **guild** (shared context, memory, task coordination as one Go binary over SQLite) [^3], **swarm-protocol** (claim work, detect file conflicts, heartbeat, hand off over MCP) [^3], and **Cotal** (pub/sub over NATS JetStream with presence and role-addressed anycast) [^3].

Also worth noting: **Microsoft Conductor** (MIT) organizes work as YAML-defined workflows and parallel groups rather than tickets [^2], and **Bernstein** decomposes a goal into a task graph with its own terminal task board [^2]. Meanwhile the framework-level projects — **CrewAI**, **AutoGen**, **MetaGPT** — keep tasks *in code/context* (role-based crews with hierarchical task management) rather than in any external tracker [^16] [^17] [^18]. That's the gap your plugin would fill.

---

## What this means for Pi-OpenDurig

Given you already have a custom task system with no UI, the ecosystem consensus points to a specific architecture:

**1. Define a thin `TaskSource` interface, and make MCP the first adapter — not Jira/GitHub directly.**
Nearly every project above converged on MCP as the neutral boundary, and the tracker vendors now ship official MCP servers (Atlassian, Linear) [^12] [^13]. One MCP client adapter gets you Jira, Linear, GitHub, and every agent-native board for free, instead of N bespoke REST integrations.

**2. Split the concerns into two adapters, because they're genuinely different:**
- *Task source* (where work items come from): Jira / Linear / GitHub Issues / a JSON-file board.
- *Board/UI* (where humans watch and steer): Vibe Kanban, Agent Board, KaibanJS. These are much closer to being *replacements* for your system than adapters to it — Agent Board in particular is a near-drop-in for "custom task system with no UI," and being MIT with JSON-file storage means you can embed or mirror it cheaply [^6] [^6].

**3. Borrow the semantics that keep showing up, because they're load-bearing:**
- **Atomic claim / lease** on pickup (NEEDLE's SQLite atomic claims, Agent Board's per-file async mutex) [^3] [^6]
- **Two wake paths:** heartbeat polling for cheap agents + webhook wake for latency-critical ones [^6]
- **Enforced dependency DAG** with cycle detection, gating the `todo → doing` transition [^6]
- **A review gate distinct from done** (`requiresReview`) [^6]
- **Auto-retry with a bounded `maxRetries`**, logging each attempt as a comment [^6]
- **Task chaining / `nextTask`** so pipelines don't need orchestration code [^6]
- **Append-only audit log** (`audit.jsonl`) and **signed webhooks** (HMAC-SHA256) so external agents can trust wake-ups [^6]
- **One git worktree per task** — effectively universal across both the tracker-driven and board-driven families [^1] [^11]
- **Comments as the agent's reasoning log**, mirroring issue comments [^6]

**4. Map states explicitly and idempotently.** The trickiest part of any tracker adapter is that your columns (`backlog/todo/doing/review/done/failed`) don't line up 1:1 with Jira statuses or GitHub's open/closed + labels. Emdash's approach — human assigns, agent never self-decomposes — is a legitimate simpler contract if you want to ship v1 fast [^2].

**5. Ship a read-only client view early.** Agent Board's `clientViewEnabled` flag hides agent names and internal details behind a read-only dashboard [^6] — a good template for the "humans watching a swarm" problem, and cheaper than building full editing.

If you want a concrete first target: implement an **MCP-based `TaskSource`** plus a **file-backed default board** matching Agent Board's column/retry/dependency semantics. That gives you interop with the mature tools without coupling your harness to any of them — and keeps your current no-UI design viable as the fallback.

**References**

[^1]: [GitHub - mikoagents/miko: Miko is an open-source, self-hosted AI coding agent. It takes tasks from GitHub, GitLab, Linear, Slack and Zulip, works on them in isolated Git worktrees, and sends progress and results back to your team. Bring your own API keys or coding-agent subscriptions — choose Claude Code, Codex, Cursor, Gemini, OpenCode or Grok as the coding engine. · GitHub](https://github.com/mikoagents/miko) (7%)
[^2]: [9 Open-Source Agent Orchestrators for AI Coding (2026) | Augment Code](https://www.augmentcode.com/tools/open-source-agent-orchestrators) (21%)
[^3]: [andyrewlee/awesome-agent-orchestrators GitHub Repo](https://github.com/andyrewlee/awesome-agent-orchestrators) (40%)
[^4]: [GitHub - SWE-agent/SWE-agent: SWE-agent takes a GitHub issue and tries ...](https://github.com/SWE-agent/SWE-agent) (1%)
[^5]: [GitHub - OpenHands/OpenHands: OpenHands: AI-Driven Development](https://github.com/OpenHands/OpenHands) (1%)
[^6]: [GitHub - quentintou/agent-board: Open-source multi-agent task board for OpenClaw. Kanban + DAG dependencies + MCP server + auto-retry + audit trail. Built for autonomous AI agent teams. · GitHub](https://github.com/quentintou/agent-board) (16%)
[^7]: [BloopAI/vibe-kanban: Get 10X more out of Claude Code, ...](https://github.com/BloopAI/vibe-kanban) (4%)
[^8]: [GitHub - kaiban-ai/KaibanJS: KaibanJS is a JavaScript-native framework ...](https://github.com/kaiban-ai/KaibanJS) (1%)
[^9]: [KaibanJS](https://www.kaibanjs.com/) (2%)
[^10]: [GitHub - hyw007726/multi-agent-orchestrator-skill: Run parallel coding ...](https://github.com/hyw007726/multi-agent-orchestrator-skill) (1%)
[^11]: [How to Use Git Worktrees for Parallel AI Agent Execution](https://www.augmentcode.com/guides/git-worktrees-parallel-ai-agent-execution) (0%)
[^12]: [Atlassian MCP Server - GitHub](https://github.com/atlassian/atlassian-mcp-server) (1%)
[^13]: [MCP server – Linear Docs](https://linear.app/docs/mcp) (1%)
[^14]: [GitHub - tacticlaunch/mcp-linear: MCP server that enables AI assistants ...](https://github.com/tacticlaunch/mcp-linear) (1%)
[^15]: [Jira - GitHub MCP Server by TamarEngel | Glama](https://glama.ai/mcp/servers/TamarEngel/jira-github-mcp) (1%)
[^16]: [Building AI Agents with Python: CrewAI and AutoGen](https://dasroot.net/posts/2026/01/building-ai-agents-python-crewai-autogen/) (1%)
[^17]: [Multi-Agent AI Framework for Task Automation](https://crewai.com/multi-agent-ai-framework-for-task-automation) (1%)
[^18]: [Collaboration - CrewAI](https://docs.crewai.com/v1.15.28/en/concepts/collaboration) (0%)