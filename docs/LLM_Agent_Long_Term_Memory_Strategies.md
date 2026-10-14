What does the science and industry research say about best practices for configuring LLM agents and agent teams for long-term memory management for a project and user preferences?
I found this today: https://github.com/zennthic/elefant
I believe there's lots of other projects and research on the topic, but I think you can find and cross reference them better than me.
For context, I am building an agent harness for a team of agents.

I'll research this thoroughly — starting with the repo you found, then cross-referencing against the research literature and other major projects.Good — now let me dig into the primary sources: the surveys, the multi-agent memory architecture papers, and the production frameworks.Now the preference-specific research and the framework tradeoffs.A couple more targeted pulls: the multi-agent memory survey and practical harness/instruction-file conventions.One final pull on the practical harness conventions, then I'll synthesize.## Short answer

There's no single "correct" configuration, but the research and the mature production frameworks have converged on a fairly consistent set of patterns. The most important finding for someone building a **team** of agents is this: **memory is not a database you bolt on — it's a layered system with an explicit write/consolidate/retrieve/forget lifecycle, and for multi-agent systems the hard part is not storage, it's consistency and access control.**

The repo you found (Elefant) is actually a good example of one legitimate design point in that space — a **shared, human-and-agent "second brain"** — but it's one of several architectures, and it deliberately punts on some of the things research says matter most for agent teams.

---

## 1. Where Elefant sits

Elefant is a self-hosted shared wiki + memory + work board behind one MCP endpoint, so multiple assistants (Claude, ChatGPT, Cursor, Codex, Open WebUI) share one knowledge base [^5]. Its memory model is a **two-tier capture/compact pipeline**: agents write cheap `memory_capture` events, a background compactor clusters them and scores them on recurrence, source diversity, and recency, promoting survivors into durable embedded memory; `memory_add` writes directly to durable memory when a fact must be preserved exactly [^5]. Storage is Postgres (memory + board + git index, with a `tenant_id` on every row), Qdrant (vectors), MinIO (wiki/attachments), and an embedder service [^5].

That capture→compact→promote design maps directly onto what the literature recommends (a probationary buffer before long-term promotion — see §3), and the human/AI folder split (`AI/` default) plus tenant isolation are sensible governance defaults [^5] [^5]. Where it's thin relative to the research: it's fundamentally a **shared-pool** design, and it doesn't advertise explicit per-agent access control, conflict resolution, or a formal consistency model — the exact gaps the multi-agent literature flags as the frontier (§5).

---

## 2. The consensus architecture: write → manage → read, over layered memory

The most useful recent synthesis is the 2026 survey *Memory for Autonomous LLM Agents* (arXiv 2603.07670). Its central framing: **memory is a task-relevant belief state maintained under storage/compute budgets, not an append-only log.** The "write" operation ($U$) must summarize, deduplicate, score priority, resolve contradictions, and delete — and because writing and reading form a feedback loop, **one bad write can pollute the store for many steps downstream** [^13].

The canonical loop most frameworks implement is **read-before-reasoning, write-after-acting** [^9]:

1. Receive input → 2. Load working memory + query long-term store → 3. Reason/plan → 4. Act (tools/sub-agents) → 5. Observe → 6. Extract facts, update working memory, summarize older context → 7. Loop/terminate.

**Memory types.** The near-universal taxonomy (from cognitive science) is:

| Type | What it holds | Primary use in your harness |
|---|---|---|
| **Working** | Current context window | Active task state |
| **Episodic** | Concrete events, turns, tool calls | Audit trail; raw evidence |
| **Semantic** | Generalized facts/preferences | **User preferences**, project facts |
| **Procedural** | Reusable skills/verified patterns | **Project conventions, verified code patterns** [^13] |

Two domain-specific findings that map exactly onto your use case: **software-engineering agents lean heavily on procedural memory** (verified code patterns, architecture decisions) and **personal assistants depend most on semantic memory** (user preferences/profiles) [^13]. Since you're building both a project harness *and* user-preference management, you effectively need both stores, tuned differently.

**The "context engineering" complement.** LangChain frames the same problem as managing the context window like RAM, with four operations: **write** (scratchpads/persistent files), **select** (retrieve only what's relevant), **compress** (summarize/prune), and **isolate** (split across subagents/state fields) [^10]. Failure modes to design against: context poisoning, distraction, confusion, and clash [^10].

---

## 3. Project memory best practices

- **Preserve durable structure, not raw logs.** Project agents need architecture decisions, bug histories, style preferences, and a library of verified solutions — and retrieval must scale to relevant *codebase portions*, not just conversation [^13]. MetaGPT's approach — standardized persistent documents (PRDs, design specs, modules) — is cited as a working pattern [^13].
- **Probationary "hot" buffer before promotion.** New memories should sit in a hot buffer and be promoted to long-term only after passing quality checks: re-verification, deduplication, importance scoring [^13]. (This is essentially Elefant's capture→compact design.)
- **Instruction files as procedural memory.** The AGENTS.md / CLAUDE.md convention is the practical embodiment of project memory: a file loaded at session start that carries *the commands, conventions, and boundaries an agent can't infer from code* [^6]. Key rules from the 2026 guidance:
  - Keep it **under ~200 lines** — longer files consume more context and *reduce adherence* [^6].
  - Include only what changes a decision: purpose, layout, exact build/test/lint commands, code rules, architecture boundaries, hazards, workflow [^6].
  - **Generate the descriptive parts** (layout, hotspots) from the repo; **hand-write only intent** ("never call the payments API outside billing") [^6].
  - Don't let it rot — a stale path "actively misleads, and the agent trusts it" [^6].
  - Use **progressive disclosure / nesting**: root file for the repo, path-scoped rules that load only when working on matching files [^6].
  - Worth knowing: there's recent pushback that bloated AGENTS.md files can *reduce* success rates, reinforcing the "keep it minimal" advice [^15].
- **A static file orients; an index answers follow-ups.** Static instructions can't say who owns a file or what breaks if it changes — pair them with a queryable index (MCP tools like "get_context", "get_risk") and a session-start hook [^6].

---

## 4. User-preference memory best practices

This is the area where naive systems fail most, and the research is quite specific:

- **Preferences are semantic memory — store them with provenance and time.** Record the source and timestamp, **prefer newer records**, **distinguish user statements from agent inference**, detect conflicts, and provide retention/auditable deletion across every tier (including vector index and backups) [^13].
- **Track *evolving* preferences with two timescales.** The PAMU paper (arXiv 2510.09720) models preferences across dimensions (tone, length, emotion, information density, formality), combining a **sliding window** (reacts to recent change) with an **exponential moving average** (tracks long-run trend); the *divergence* between the two is the change signal that triggers adaptation [^7] [^7]. Reported effect: style consistency ~92–94% vs ~35–37% without it, preference detection ~95–97% vs ~45–48% [^7].
- **Keep an explicit user profile separate from the memory stream.** A 2025 framework study found a **dynamic profile** (facts, preferences, interests, communication style) as a structured JSON object, incrementally updated by an LLM, measurably improved retrieval and correctness — removing it cost up to ~5.6% retrieval accuracy [^3] [^3]. Its architecture is worth copying: **Coordinator → Operator (tool selection) → Self-Validator (sufficiency/consistency/specificity check) → Response Generator** [^3].
- **Two big caveats from that study:** the **cold-start problem** (personalization is weak until there's history — hence a lightweight onboarding step) and the gap between *functional* and *perceived* personalization (users complained about long, generic answers and failures on ambiguous follow-ups) [^3] [^3].
- **The honest failure mode to expect:** on preference questions, systems retrieve the right evidence ~90% of the time but answer correctly only ~57% of the time — i.e., **retrieval is nearly solved; synthesis over retrieved preferences is not** [^1].

---

## 5. Multi-agent / team memory — the part that actually matters for you

The 2026 position paper *Multi-Agent Memory from a Computer Architecture Perspective* (arXiv 2603.10062) is the most directly useful source for an agent team. Key points:

- **Shared vs distributed.** A shared pool makes reuse easy but needs *coherence* — without coordination, agents overwrite each other, read stale data, or act on inconsistent versions. Fully distributed improves isolation/scalability but risks divergence. **Real systems sit in between: local working memory plus selectively shared artifacts** [^8].
- **Three-layer hierarchy** (mirroring hardware): **I/O → cache → memory**. Performance is an *end-to-end data-movement problem* — if relevant info is stuck in the wrong layer, reasoning degrades. "Caching is not optional" [^8].
- **Two protocol gaps it identifies as unsolved:**
  1. **Agent cache-sharing protocol** — letting one agent's cached results/artifacts be reused by another (MCP connectivity is *necessary but not sufficient*) [^8].
  2. **Agent memory access protocol** — who may read whose long-term memory, read-only vs read-write, and at what granularity (document / chunk / key-value record / trace segment) [^8].
- **Make versioning, visibility, and conflict-resolution rules explicit** so agents agree on what to read and when writes take effect [^8].

A 2026 industry synthesis converges on the same answer: **scoped/hierarchical sharing is the consensus** — global (team-wide) + group/role (task-scoped) + private (agent-specific). CrewAI, MemOS, and the Collaborative Memory research independently arrived at variations of this [^2] [^2]. It lays out the tradeoffs plainly:

| Pattern | Works when | Breaks when |
|---|---|---|
| **Shared** | 2–5 agents, pipeline/sequential | Noise amplification, contamination (one hallucination pollutes everyone), security violations [^2] |
| **Isolated** | Security-sensitive, disjoint domains | Duplication, coordination overhead, divergence [^2] |
| **Hierarchical** | Most real deployments | Requires scoping discipline [^2] |

**Conflict resolution** is described as "primitive" and still evolving. Options, roughly in order of sophistication: last-write-wins (silently discards data), orchestrator-mediated serialization (bottleneck), reducer functions (deterministic, good for structured state), **LLM-assisted consolidation** (handles semantic conflicts like "deadline is Friday" vs "moved to Monday" but non-deterministic), and event sourcing (full audit trail, expensive) [^2].

**Security is the biggest gap.** Most frameworks have no built-in ACL on memory. The threat model: cross-agent data leakage, memory poisoning, provenance loss, privilege escalation [^2]. Minimum viable pattern is **namespace isolation** (every op carries a scope ID); mature patterns add **provenance tracking** (immutable who/when/source/authority metadata), **write policies** (allowlist/anonymize/review gates), and **zero-trust access** verified per query [^2].

The Springer survey confirms this is a *distinct* frontier: memory in LLM multi-agent systems "is not a trivial extension of single-agent memory," with new challenges in **synchronization, access control, scalability, alignment, and safety** [^12]. Microsoft's reference architecture names the same concerns — **synchronization, ownership, privacy, data consistency** — as the unique hard problems of multi-agent STM/LTM [^14].

---

## 6. Storage & retrieval

- **Hybrid retrieval is the recommended default** — combine full-text/term search with dense vector retrieval; build both in from the start rather than bolting one on [^9]. This echoes the code-retrieval finding that embeddings alone become unreliable at scale and should be combined with grep/file search, graph retrieval, and reranking [^19a502#158].
- **Multi-signal scoring beats pure cosine similarity** — blend recency (exponential decay), relevance, and importance [^13]. Production systems extend this further (AutoMem uses a nine-component score; Mem0/Zep add entity/graph layers) [^1].
- **Multi-granularity indexing** — the sweet spot is adaptive resolution, not fixed chunk size [^13].
- **Storage backend decision tree** (from the industry synthesis): prototyping → files/Markdown with namespaced dirs; single-framework → framework default; multi-framework/production → **PostgreSQL + pgvector** (ACID + semantic search + row-level security); enterprise/compliance → dedicated layer with encryption, audit logging, tenant isolation [^2] [^2]. The "polyglot persistence" anti-pattern (separate vector + graph + relational + file stores) is consolidating toward unified platforms [^2].

---

## 7. What the framework comparison actually tells you

Two counterintuitive findings worth internalizing:

- **A plain filesystem is surprisingly strong.** Letta showed that simply giving an agent filesystem tools (`grep`, `search_files`, `open`) over a conversation file scored **74.0% on LoCoMo** — *above* Mem0's reported 68.5% graph variant [^11]. The explanation: agents are post-trained on filesystem tools, so *simpler tools the model already knows beat specialized memory tools*, and iterative self-querying beats single-hop retrieval [^11]. **Implication for your harness: invest in whether your agent knows *when and how* to retrieve, not just in the retrieval backend.**
- **The leaderboard is unreliable.** A December 2025 audit found **6.4% of LoCoMo's answer key is wrong and the LLM judge accepts up to 63% of deliberately wrong answers** — the error bar swallows the differences between systems [^1]. Scores swing several points just from swapping the judge/answer model [^1]. So don't pick an architecture from a headline percentage; **pick by failure mode** (vector-only vs graph+vector; append-everything vs distilled; managed vs self-host; framework-locked vs MCP-portable) [^1] [^1].

| System | Architecture bet | Best for |
|---|---|---|
| **Mem0** | Vector-first + entity linking | Fast semantic recall, broadest adoption [^1] |
| **Zep/Graphiti** | Bi-temporal knowledge graph | When time & fact-validity matter ("what did I believe last March") [^1] |
| **Letta (MemGPT)** | OS-style agent-managed paging | Agents that curate their own memory [^1] |
| **A-MEM** | Zettelkasten: atomic linked notes + evolution | Multi-hop reasoning (2× on that category) [^4] |
| **LangMem** | Native to LangGraph | Teams already on LangGraph [^1] |

A-MEM is worth studying for project memory: each interaction becomes a **structured atomic note** (content + timestamp + LLM keywords/tags/contextual description), embedding similarity proposes a top-k neighborhood, an **LLM judges which links are meaningful** (not a fixed threshold), and **new notes can *revise* existing notes** ("memory evolution") — ablated versions without linking/evolution degrade sharply [^4] [^4] [^4]. Caveat: gains plateau and eventually decline as top-k grows, and organization quality depends on the underlying LLM [^4] [^4].

---

## 8. Evaluation — measure decisions, not just retrieval

Precision@k tells you if the right doc was retrieved; it says nothing about whether the agent *used* it correctly [^13]. The survey proposes a four-layer stack you can lift directly into your harness's eval suite [^13]:

1. **Task effectiveness** — success rate, factual correctness, plan completion
2. **Memory quality** — retrieval precision/recall, contradiction rate, staleness distribution
3. **Efficiency** — latency per op, prompt tokens for memory, retrieval calls/step, storage growth
4. **Governance** — privacy leakage, deletion compliance, access-scope violations

And **ablate write policy, retrieval strategy, and compression independently** to attribute gains [^13]. Benchmarks to know: **LoCoMo** (long conversational memory), **LongMemEval** (knowledge updates, multi-session, temporal, preferences — the most diagnostic for your use case), **MemBench**, **MemoryAgentBench** (incl. selective forgetting), **MemoryArena** (memory-dependent agent tasks) [^13] [^1]. Also worth noting: **recall@5** cleanly separates *finding* memory from *using* it [^1].

---

## 9. Concrete recommendations for your harness

**Architecture**
1. Use the **read-before-reasoning / write-after-acting** loop, with an explicit management step (summarize, dedup, score, resolve contradictions, delete) — never a bare append log [^9] [^13].
2. Implement **three-tier memory**: global (project facts, architecture decisions, conventions) + role/group (task-scoped) + private (agent working state) [^2].
3. Add a **probationary hot buffer** with promotion checks before anything enters durable memory; support a direct-write path for must-keep facts [^13] [^5].
4. Separate **project memory** (procedural + semantic: conventions, decisions, verified patterns) from **user-preference memory** (semantic profile with provenance + timestamps), and keep the preference profile as a **structured, incrementally-updated object** [^13] [^3].
5. Treat instruction files (AGENTS.md-style) as the *procedural-memory* layer: minimal, intent-only, nested/scoped, regenerated when it describes code [^6] [^6].

**Retrieval & storage**
6. **Hybrid retrieval** (full-text + vector) from day one; **multi-signal ranking** (recency + relevance + importance); **multi-granularity** records [^9] [^13].
7. Prefer **Postgres + pgvector** (or MongoDB Atlas) as the unified backend unless you have a specific reason for a separate vector DB [^2].
8. Don't over-engineer the retrieval tool — agents are excellent with **simple, well-known tools** (filesystem/grep) and *when/how to retrieve* matters more than the backend [^11].

**Multi-agent specifics (the highest-leverage part)**
9. **Design an explicit memory-access protocol**: permissions, read-only vs read-write, and access granularity per agent role [^8].
10. **Choose a conflict-resolution strategy deliberately** — reducers for structured state, LLM-assisted consolidation for semantic conflicts, event sourcing if you need auditability [^2].
11. **Enforce namespace isolation at minimum; add provenance tracking and write policies** — most frameworks leave this to you, and it's the biggest production gap [^2].
12. Make **versioning and visibility rules explicit** so agents know what state they may read and when writes take effect [^8].

**Preference memory specifically**
13. Track preferences with **dual timescales (sliding window + EMA)** and trigger adaptation when the recent estimate diverges from the long-run trend [^7] [^7].
14. Store **source attribution (user statement > agent inference) and timestamps**, prefer newer records, detect conflicts [^13].
15. Add a **lightweight onboarding step** to fight cold start [^3], and invest in **synthesis over retrieved preferences** — that's where accuracy collapses (~90% retrieval vs ~57% answer accuracy on preference questions) [^1].

**Process**
16. Build **observability + eval from the start** (trace token usage, test whether a memory change helps or hurts) and iterate [^10].
17. Don't trust headline benchmark numbers — **audit your own eval set** and pick by failure mode [^1] [^1].
18. Start with the **simple pattern (context + external retrieval store), instrument it, and only graduate to tiered/learned memory when your own data justifies the cost** [^13].

---

### One caution on the whole field
The most honest summary of the state of the art is that **storing and retrieving are largely solved engineering problems, but selective *forgetting* and multi-agent *consistency* remain open research problems** [^9] [^8]. Until those mature, you'll need **explicit retention/consolidation policies and explicit consistency rules** rather than assuming the memory layer manages itself [^9]. Elefant gives you a working reference for the shared-pool half of this; the per-agent access control, conflict resolution, and consistency model are the parts you'll most likely need to design yourself.

**References**

[^1]: [Agent Memory in 2026: An Honest Comparison of Mem0, Zep, Letta, and the Rest | AutoMem](https://automem.ai/blog/agent-memory-in-2026-an-honest-comparison-of-mem0-zep-letta-and-the-rest) (18%)
[^2]: [AI Agent Memory Architectures for Multi-Agent Systems | Zylos Research](https://zylos.ai/research/2026-03-09-multi-agent-memory-architectures-shared-isolated-hierarchical/) (18%)
[^3]: [[2510.07925v1] Enabling Personalized Long-term Interactions in LLM-based Agents through Persistent Memory and User Profiles](https://arxiv.org/html/2510.07925v1) (16%)
[^4]: [[2502.12110] A-MEM: Agentic Memory for LLM Agents](https://arxiv.org/pdf/2502.12110) (11%)
[^5]: [zennthic/elefant GitHub Repo](https://github.com/zennthic/elefant) (5%)
[^6]: [CLAUDE.md and AGENTS.md: A Complete Guide (2026)](https://repowise.dev/blog/guides/claude-md-agents-md-guide) (5%)
[^7]: [[2510.09720v1] Preference-Aware Memory Update for Long-Term LLM Agents](https://arxiv.org/html/2510.09720v1) (5%)
[^8]: [[2603.10062v1] Multi-Agent Memory from a Computer Architecture Perspective: Visions and Challenges Ahead](https://arxiv.org/html/2603.10062v1) (5%)
[^9]: [Long-Term Memory Architectures for AI Agents](https://redis.io/blog/long-term-memory-architectures-ai-agents/) (4%)
[^10]: [Context Engineering](https://www.langchain.com/blog/context-engineering-for-agents) (4%)
[^11]: [Benchmarking AI Agent Memory: Is a Filesystem All You Need? | Letta](https://www.letta.com/blog/benchmarking-ai-agent-memory/) (4%)
[^12]: [Memory in LLM-Based Multi-agent Systems: Mechanisms, Challenges, and Collective Intelligence | Springer Nature Link](https://link.springer.com/chapter/10.1007/978-981-92-1468-6_10) (2%)
[^13]: [[2603.07670] Memory for Autonomous LLM Agents:Mechanisms, Evaluation, and Emerging Frontiers](https://arxiv.org/pdf/2603.07670) (1%)
[^14]: [Memory - Multi-agent Reference Architecture](https://microsoft.github.io/multi-agent-reference-architecture/docs/memory/Memory.html) (1%)
[^15]: [AGENTS.md files reduce coding agent success rates](https://www.reddit.com/r/ClaudeAI/comments/1r7mvja/new_research_agentsmd_files_reduce_coding_agent/) (0%)


Are there existing open source projects that have implements and/or designs of this part that I can reference?

"the per-agent access control, conflict resolution, and consistency model are the parts you'll most likely need to design yourself."


I'll research the specific open-source projects that tackle these three hard problems.Excellent leads — MemClaw, Collaborative Memory, memX, and mnemos look directly on-point. Let me dig into these plus find more.Strong set of leads. Let me examine the actual implementations — memX, mnemos, LatticeMind, and the field comparison.One more round to cover the remaining implementation-focused projects.Yes — quite a few, and they split cleanly across your three problems. Below I've grouped the **open-source implementations** (things you can actually read/clone) separately from **design papers** (blueprints without released code), and flagged maturity honestly. I've marked each with what it actually solves.

## Quick map: project → problem solved

| Project | OSS? | Access control | Conflict resolution | Consistency | Best reference value |
|---|---|---|---|---|---|
| **ArgusFleet** (+ MemClaw) | Harness: yes; MemClaw: no (production svc) | ✅ 4-tier scopes, policy-filtered retrieval | ✅ `supersedes_id` temporal supersession | ✅ measured write-time consistency | The most rigorous, *measured* design [^1] |
| **Collaborative Memory** | Paper only (code "will release") | ✅ bipartite user-agent-resource graphs | ❌ not addressed | partial | Best formal ACL model [^3] |
| **memX** | ✅ MIT-ish, Redis+FastAPI | ✅ API-key scopes (glob patterns) | ⚠️ last-write-wins | ✅ pub/sub notifications | Simplest working ACL layer [^10] |
| **mnemos** | ✅ MIT | ✅ per-agent (unspecified model) | ✅ **typed** resolution (3 strategies) | ✅ event bus | Best conflict *taxonomy* [^9] |
| **Statewave** | ✅ Apache-2.0 | ⚠️ subject-scoped | ✅ deterministic claim-key supersession | ✅ deterministic compile | Cleanest conflict *engine* [^6] |
| **LatticeMind** | Paper (impl described) | ⚠️ routing keys | ✅ status state machine + symbolic checker | ✅ central orchestrator | Best *status model* for memory items [^7] |
| **hivememory** | ✅ MIT | ❌ none | ✅ detection only (no adjudication) | ✅ provenance DAG | Cascading invalidation [^11] |
| **memledger** | ✅ Apache-2.0 | ✅ namespace gating | ✅ conflict detector | ✅ weakest-link confidence | Provenance/confidence gating [^12] |
| **MemOS** | ✅ (MemTensor/MemOS) | ✅ MemGovernance | ⚠️ version rollback | ✅ versioning + freezing | Full lifecycle/versioning OS [^8] |
| **Microsoft Agent Governance Toolkit** | ✅ MIT | ✅ runtime security | — | — | Runtime governance layer [^13] |

---

## 1. Per-agent access control

**The formal model to copy — Collaborative Memory** (arXiv 2505.18279). This is the cleanest *design* for per-agent ACL. It encodes permissions as **two time-evolving bipartite graphs**: user→agent ($G_{UA}$) and agent→resource ($G_{AR}$). A fragment is retrievable only if its contributing agents are within the requesting user's permitted agent set *and* its creation resources are within the serving agent's permitted resources [^3] [^3]. It maintains **two tiers** (private vs. shared), each fragment carrying **immutable provenance** (contributing agents, resources, timestamps), and applies **granular read policies** (filter/transform at read) and **write policies** (redact/anonymize at write) — tunable per-user, per-agent, or per-time [^3] [^3]. Caveat: the paper does **not** address conflict resolution, and its code is only *promised*, not released [^3] [^3].

**The most rigorously measured implementation — MemClaw + ArgusFleet.** MemClaw defines **four memory scopes**: `agent-local`, `team-shared`, `tenant-global`, `restricted` [^1]. Its key formalization is the **scope-soundness invariant** ($Inv\text{-}Scope$): no agent receives a memory its identity isn't entitled to [^1]. Critically, they found a *real* violation — the GET-by-id path initially evaluated only the tenant projection of scope, leaking fleet/agent-scoped rows — then remediated it (cross-fleet reads now denied with 404) [^1]. Retrieval is explicitly **not** semantic ranking alone; it's candidate generation → **policy filtering** → temporal resolution → provenance enrichment → ranked delivery [^1]. The **evaluation harness ArgusFleet is open source** (github.com/caura-ai/argusfleet) and wire-compatible with any implementation; MemClaw itself is a hosted service, not OSS [^1].

**Simplest deployable pattern — memX** (github.com/MehulG/memX). FastAPI + Redis with API-key auth resolved from Supabase or a local `config/acl.json` mapping keys to **glob-style read/write patterns** (e.g. `"agent_key": ["agent:*"]`), plus JSON-schema validation and WebSocket pub/sub [^10] [^10]. Keys are auto-namespaced with the first 8 chars of the user ID [^10]. It's a good "minimum viable ACL" reference, though its conflict handling is only last-write-wins.

**The pragmatic production pattern — per-agent namespaces** (from the amd/gaia issue #676, based on ~8 weeks / ~28 agents in production). The invariant they landed on: **read any agent's memory; write only to your own namespace** [^4]. Two hard-won lessons directly relevant to you:
- **Enforce at the storage layer, not in Python.** Their first pass stamped `agent_id` in Python and one agent silently wrote to the wrong namespace for a day. Fix: bind `agent_id` as a **session variable on the DB connection** and reject mismatched writes via a trigger [^4].
- Add a **`visibility` column** on shared tables (`'all'`, `'agent_list:...'`, `'owner_only'`) so agents don't see each other's raw history [^4].
- For multi-user setups, make the namespace **`agent_id + user_id`** or User 1's learnings bleed into User 2's responses [^4].

**Lifecycle/versioning governance — MemOS** (github.com/MemTensor/MemOS). Its `MemCube` unifies content + metadata, with **governance attributes** including access permissions, TTL/decay, priority, sensitivity tags, and **access logging** [^8]. `MemGovernance` enforces permissions + audit trails; `MemLifecycle` models memory as a **state machine with version rollback and freezing** for temporal consistency [^8]. It also exposes a **Provenance API / Update API / LogQuery API** [^8]. This is the closest thing to a full "memory OS" with governance built in [^14] [^15].

**Also worth noting:** Microsoft released an open-source **Agent Governance Toolkit** (MIT) for runtime agent security [^13], and the **AgentKernel** paper describes a trust-native agent OS where even shared memory keeps **independent access audit trails per agent** [^16].

---

## 2. Conflict resolution

This is the area with the most actual OSS implementations.

**Best taxonomy to borrow — mnemos** (github.com/Sohamp2809/mnemos, MIT). It **classifies every contradiction before resolving it** [^9]:

| Conflict type | Strategy | Example |
|---|---|---|
| `PREFERENCE_EVOLUTION` | **Supersede** (archive history) | "Prefers Vue" replaces "Prefers React" |
| `FACTUAL_CORRECTION` | **Replace** (delete old) | "Deadline Apr 30" removes "Mar 15" |
| `CONTEXT_DEPENDENT` | **Coexist** (both scoped) | "Python at work" + "JS personal" |

Its detection pipeline: embed → cosine similarity vs. active semantic memories (threshold 0.55) → topic/entity verification → contradiction evidence (negation/antonyms) → classify → resolve [^9]. Architecture is a shared **Memory Hub** with per-agent access control, conflict engine, decay engine, immutable provenance log, and an event bus [^9]. Note the README labels access control "per-agent" but doesn't specify the permission model or consistency guarantees — so treat the conflict engine as the reference, not the ACL.

**Cleanest deterministic engine — Statewave** (github.com/smaramwbc/statewave-multi-agent-memory, Apache-2.0). Its loop is **Ingest → Compile → Use**: agents append immutable content-hashed **episodes**; a heuristic compiler extracts **typed memories** and runs conflict detection [^6] [^6]. Resolution rule: two memories with the **same single-valued claim key for the same entity** → newer supersedes older *regardless of wording*; unkeyed memories fall back to **Jaccard ≥ 0.6** word overlap [^6]. The loser isn't deleted — it stays with `status: superseded` and a `valid_to` timestamp, retaining `source_episode_ids` [^6]. Compile is **idempotent and deterministic** ("same query, same bytes"), no GPU or vector DB [^6]. This is probably the most directly reusable design for your harness.

**Best memory-item status model — LatticeMind** (arXiv 2608.08236). Each item is $(k, c, \rho, \tau, \eta)$ — key, content, evidence metadata, timestamp, **status** — where status ∈ {`PROPOSED`, `CONFIRMED`, `CONTESTED`, `SUPERSEDED`}, with `SUPERSEDED` terminal and transitions applied **centrally by the orchestrator** [^7] [^7]. Update logic: a **symbolic checker** cheaply catches mechanical violations (dependency cycles via NetworkX SCC scan, resource/time-interval collisions via regex), then the **reconciler** handles only unresolved semantic conflicts [^7] [^7]. It routes by claim type: for software-state claims it compares **evidence strength → recency → LLM tie-break only if needed** [^7] [^7]. Crucially it distinguishes **credibility conflicts** (evidence-weighted supersession) from **coordination conflicts** (keep both candidates visible, re-plan — never delete) [^7]. Implementation artifacts are described as released but no repo URL is given in the paper [^7].

**Provenance-based invalidation — hivememory** (github.com/ridxm/hivememory, MIT). Stores **reasoning artifacts** (claim, evidence, confidence, producer, dependencies); artifact-ID dependencies form a **DAG** enabling cascading invalidation ("which agent's work did this build on?") [^11]. Conflict detection is two-stage: FAISS retrieves similar claims → confidence divergence flags a candidate → optional LLM confirms a true contradiction [^11]. Important limitation: it **detects** conflicts but the page describes **no adjudication/resolution process and no access control** [^11].

**Also:** MemClaw implements **temporal supersession** — newer row links via `supersedes_id`, older flips to `outdated` (measured 90/90 when both writes admitted), with a post-commit asynchronous contradiction detector [^1]. And Graphiti/Zep's **bi-temporal model** (tracking both when an event happened and when it was learned) is the strongest general approach to correcting stale memories without losing history [^17].

---

## 3. Consistency model

**The key architectural insight — where the cost is paid.** MemClaw measured this precisely: under `write_mode = strong`, enrichment is **synchronous**, so the **write-to-visible window is effectively zero** (p50 ≈ 0.83 s, essentially one search round-trip) — the consistency cost is paid in **write latency**, not a post-write visibility tail [^1] [^1]. But that cost is **load-dependent**: write-latency p99 reached **~19 s** under sustained contention vs. p50 ≈ 1.8 s [^1]. Their methodological warning is worth heeding: a naive "seed then drain" probe reports a window that's really just harness scheduling [^1]. **The design choice — enrich on the write path vs. the read path — is first-order.**

**Deterministic by construction — Statewave.** Because compile is a pure function of the append-only episode log, "same query, same bytes" — consistency falls out of determinism rather than a coordination protocol [^6].

**Pub/sub propagation — memX and mnemos.** memX uses Redis last-write-wins with timestamps plus WebSocket pub/sub so subscribers see updates [^10]. mnemos uses an event bus broadcasting changes to all agents, so "when the user updates a preference with one agent, all agents see the change immediately" [^9]. Both are **eventual-consistency** designs — fine for coordination, weaker than MemClaw's write-time guarantee.

**Append-only + signed facts — the gaia production pattern.** Their recommendation: a **`shared_facts`** table that's *immutable, append-only, signed by `writer_agent_id`*, for "X is true as of time T" facts — "append-only makes conflict resolution trivial" [^4]. They also separate **durable per-agent memory from live coordination state**, because the failure-prone data is "what is true right now" (active owner, task status, stale markers) — that layer wants **TTL/provenance and explicit overwrite semantics**, while durable memory wants append/recovery semantics [^4]. If you merge the two, "cross-agent visibility slowly becomes cross-agent drift" [^4].

**Authorization-time semantics — the deeper consistency problem.** The *Authorization Propagation* paper (arXiv 2605.05440) frames the hardest part: maintaining authorization invariants as agents delegate and synthesize. Its recommendations, which map directly to a harness [^5]:
- **R3: evaluate authorization at every data-retrieval boundary**, not once at workflow start — and the analysis argues **strongly against initiation-time evaluation** for machine-speed agents (TTL-based revocation produces unauthorized ops scaling as $O(v \cdot \text{TTL})$; execution-count-based Release Consistency bounds violations independent of agent velocity, a ~120× reduction) [^5] [^5].
- **R2: delegation must be explicit, bounded, and auditable** — no implicit authority inheritance through shared credentials [^5].
- **ReBAC is the closest existing model** (graph relationship tuples express delegation/membership/hierarchy) but needs extension: agents aren't first-class subjects, delegation is static not workflow-scoped, and there's no aggregation constraint [^5].
- **R7: recovery must be traceable through the synthesis graph** — when a violation is found, identify all downstream results derived from it [^5].

---

## How the field frames the tradeoff (for your design doc)

The Mem0 production-patterns writeup gives the cleanest decision triangle — **latency vs. consistency vs. cost** [^2]:

| Dimension | Centralized | Distributed | Hybrid |
|---|---|---|---|
| Structure | One shared store | Private per-agent | Private + shared tiers |
| Consistency | Strong, single source of truth | Eventual, sync challenges | Configurable per use case |
| Best for | <5 agents | Large scale, privacy-sensitive | Production workflows |

Most real systems land on **hybrid**, with memory scoping across **user / session / agent / application levels** [^2]. Mem0 implements this via four scope IDs (`user_id`, `agent_id`, `run_id`, `app_id`), which is a concrete scheme you can copy [^2]. Its sharpest warnings for you: **don't treat scoping as an afterthought** (retrofitting after a leak is far worse), **don't let write access default to "yes"** everywhere, and **fix the write path before patching the read path** — "when two agents wrote conflicting facts and nothing ever reconciled them," more query filtering won't help [^2].

---

## My recommendation for what to actually study

If I were building your harness, I'd read these in this order:

1. **Statewave** — the single best *conflict engine* to copy (deterministic, typed, `valid_to` history, no vector DB) [^6].
2. **mnemos** — for the **conflict taxonomy** and the Memory-Hub + event-bus architecture [^9] [^9].
3. **ArgusFleet** — the only open **evaluation harness** that tests scope enforcement, propagation, contradiction, and provenance as *architectural primitives*, with reproducible traces [^1].
4. **Collaborative Memory** — the **ACL model** (bipartite time-varying graphs) to adapt, even without released code [^3].
5. **LatticeMind** — the **item status state machine** and the credibility-vs-coordination split for your write rules [^7] [^7].
6. **MemOS** — if you want a **versioning/governance** blueprint (MemCube, rollback, freezing, audit) [^8].
7. **The gaia issue #676** — the most practical, battle-tested **namespace + storage-layer enforcement** guidance [^4] [^4].
8. **Authorization Propagation** — the theory for **access-time evaluation** and workflow-scoped authorization traces [^5] [^5].

**Honest gap assessment:** access control has real, deployable OSS (memX, mnemos, memledger, MemOS, the gaia pattern) and a strong formal model (Collaborative Memory). Conflict resolution has several working engines but **no consensus algorithm** — you'll pick per memory type. **Consistency is the least solved** in open source: only MemClaw has measured write-time guarantees, and it's not OSS; the rest rely on eventual consistency via event buses/pub-sub. So the pieces exist, but **composing a per-agent ACL + conflict engine + a consistency model that doesn't drift** is still genuinely your integration problem — the research confirms no single project does all three well.

One caveat on sourcing: several of these (LatticeMind, MemClaw, Collaborative Memory, Authorization Propagation) are recent papers, and I couldn't independently confirm every claimed repo URL from the papers themselves — verify the repos exist before depending on them.

**References**

[^1]: [[2606.24535v1] Governed Shared Memory for Multi-Agent LLM Systems](https://arxiv.org/html/2606.24535v1) (21%)
[^2]: [Multi-Agent Memory Systems: 3 Production Patterns](https://mem0.ai/library/agent-memory/multi-agent-memory-systems) (14%)
[^3]: [[2505.18279] Collaborative Memory: Multi-User Memory Sharing in LLM Agents with Dynamic Access Control](https://arxiv.org/abs/2505.18279) (10%)
[^4]: [Shared memory database with per-agent namespaces for multi-agent architecture](https://github.com/amd/gaia/issues/676) (10%)
[^5]: [[2605.05440v1] Authorization Propagation in Multi-Agent AI Systems: Identity Governance as Infrastructure](https://arxiv.org/html/2605.05440v1) (10%)
[^6]: [smaramwbc/statewave-multi-agent-memory GitHub Repo](https://github.com/smaramwbc/statewave-multi-agent-memory) (7%)
[^7]: [[2608.08236] LatticeMind: A Conflict-Aware Memory Primitive for Multi-Agent Systems](https://arxiv.org/html/2608.08236) (7%)
[^8]: [[2505.22101v1] MemOS: An Operating System for Memory-Augmented Generation (MAG) in Large Language Models](https://arxiv.org/html/2505.22101v1) (7%)
[^9]: [Sohamp2809/mnemos GitHub Repo](https://github.com/Sohamp2809/mnemos) (6%)
[^10]: [MehulG/memX GitHub Repo](https://github.com/MehulG/memX) (3%)
[^11]: [hivememory — shared reasoning memory for multi-agent systems](https://ridxm.github.io/hivememory/) (2%)
[^12]: [memledger — Open-source trust layer for multi-agent AI | memledger](https://memledger.com/) (1%)
[^13]: [Introducing the Agent Governance Toolkit: Open-source runtime security ...](https://opensource.microsoft.com/blog/2026/04/02/introducing-the-agent-governance-toolkit-open-source-runtime-security-for-ai-agents/) (1%)
[^14]: [MemTensor/MemOS: Self-evolving memory OS for LLM & ...](https://github.com/MemTensor/MemOS) (1%)
[^15]: [MemOS: A Memory OS for AI System - arXiv.org](https://arxiv.org/pdf/2507.03724) (1%)
[^16]: [AgentKernel The Trust-Native Agentic Operating System A ...](https://arxiv.org/html/2609.29647v1) (0%)
[^17]: [The State of Agent Memory in 2026 — 10 Projects Compared | Mneme](https://mnem.dev/research/state-of-agent-memory-2026) (0%)