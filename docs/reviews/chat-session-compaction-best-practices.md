I am making a harness that manages a team of llm agents, named opendurig: https://github.com/chexxor/Pi-OpenDurig

What does academic research and industry best practices say is best practices for chat session compaction vs starting a new session?


------------------


I'll research both the academic literature and current industry practice on this, and take a quick look at your repo for context.Good — your repo already has a `docs/Managing_Long_Context_Length.md` on this. Let me pull that plus the key primary sources.Strong material. Let me get the key empirical studies behind the masking-vs-summarization claim and the serving-side latency angle.One more pass on the industry practice side, especially for multi-agent teams.Your repo already has the research digested in `docs/Managing_Long_Context_Length.md` [^1], and the literature I pulled agrees with it — so here's the consolidated picture, plus what it means specifically for durig's architecture.

## The short version

"Compaction vs. new session" is the wrong first question. The literature converges on a **four-layer stack**, applied cheapest-first, and only the last two involve an LLM call at all:

| Layer | Scope | Cost | Reversible? |
|---|---|---|---|
| Structural cleanup (dedupe re-reads, purge resolved errors, canonicalize) | Sub-transcript, deterministic | Zero model calls | Yes |
| Tool-result clearing / observation masking | Sub-transcript, surgical | Zero model calls | Yes (re-fetch) |
| Compaction (summarize) | Whole transcript | One blocking LLM call | No |
| New session + external memory | Cross-session | Re-priming cost | N/A (memory is the state) |

The single most important finding: **neither compaction nor clearing helps you at a session boundary, because the window starts empty** — memory is the only layer that survives a new session [^2]. That reframes the decision as "what do I persist?" rather than "how do I shrink?"

## What the research actually shows

**Don't compact because you're full — compact because you're degrading.** Chroma's 2025 study of 18 frontier models found every one degrades with input length, well before the window fills [^3], and frontier models reliably use only ~50–65% of their advertised window for multi-hop work [^1]. The formal treatment (*Context Compaction Theory*, 2026) puts it cleanly: the minimum sufficient context budget is the one-way communication complexity of the future query workload — meaning **there is no theorem-derived universal threshold**, and a 95% trigger is an operational convention, not an optimum [^4][^4].

**Generation beats selection in theory, but not in practice.** The theory proves summarization is strictly more expressive than eviction (a case needing *n* bits of summary vs. *n·log₂n* bits of selection) [^4]. Yet JetBrains' *Complexity Trap* (SWE-bench Verified, SWE-agent) found simple observation masking matched LLM summarization's solve rate across five model settings while costing less, and their hybrid cut cost ~52% while *improving* solve rate 2.6 points. Summarization's failure mode was real: up to 15% longer trajectories, because summaries act as a reinforcing signal and the agent loses its stop condition [^5][^5][^5]. Their conclusion is blunt: treat LLM summarization as a **last resort, deferred as long as possible** [^5]. Caveat they state themselves: the study is SWE-domain, where verbose tool output naturally favors masking [^5].

**Summaries lose exactly what agents need.** Factory's benchmark of 36,611 production messages found all three production compressors (Factory, Anthropic, OpenAI) scored only **2.19–2.45 out of 5 on artifact tracking** — knowing which files were touched. Structured, anchored-iterative summaries beat freeform regeneration, and compression ratio was the *wrong metric*: OpenAI's 99.3% compression scored 0.35 points lower in quality, and lost details get re-fetched at higher total cost [^6][^6]. The theory paper's endpoint experiment is the sharpest illustration: compacting 15,000 URLs into a ~14-kilobit summary produced error rates of 0.505–0.555 — **statistically indistinguishable from random guessing** — versus 0.02 with the full context retained [^4].

**Repeated compaction can only lose more.** Each compaction runs on the output of the last and discards further; a single invocation is the *favorable* base case, and error accumulation across chains is an explicitly open problem [^4][^4]. OpenAI Codex warns users directly that repeated compaction degrades quality [^4]. Plan for 10+ compactions in any session over four hours [^7].

**Trigger earlier than shipped defaults.** Research consensus is ~60–70% of the *effective* (not nominal) window, because at 90%+ the summarizer is itself operating on rotted context and writes worse summaries precisely when you need them [^1]. Anthropic's engineering guidance agrees on the mechanism and on keeping architectural decisions, unresolved bugs, and the most recent files, while discarding redundant tool output [^8]. Practitioner guidance in the coding-agent space goes further, treating 40–60% as the optimal band, 60–80% as danger, and 80%+ as requiring compaction [^9]. Note that shipped defaults skew later: Claude Code's is ~90% of window (community reports 77–95% by version) and the server-side trigger defaults to 150K tokens [^1][^7].

**Compaction has a serving cost, not just a quality cost.** Synchronous compaction can consume up to 62% of end-to-end wall time at low thresholds, and the proposed fix is asynchronous/background compaction during tool-call waits — when the GPU is idle anyway [^10][^10]. Block size, not prompt wording, is what actually controls how much survives [^10].

## The multi-agent angle (most relevant to durig)

This is where the answer changes shape. Anthropic's own numbers: subagents each own a context window and return only a condensed distilled summary, which is how multi-agent systems scale past a single window — at roughly 4× chat token cost for agents and **15× for multi-agent systems** [^11]. So in a team harness, **the session boundary *is* the isolation primitive**, not a fallback.

LangChain's `deepagents` exposes exactly this as a first-class knob — `"isolated"` vs `"fork"` context modes — with a rule of thumb worth stealing outright [^12]:

| Subagent role | Mode | Why |
|---|---|---|
| **Worker** (continue diagnosed work) | `fork` | Isolation forces it to rediscover evidence the supervisor already has |
| **Verifier** (independently evaluate) | `isolated` | Inheriting the author's reasoning anchors the review — you want it unanchored |
| **Researcher** (answer a bounded question) | `isolated` | Keeps context focused; forking duplicates history across parallel researchers |

That verifier point matters for durig specifically: you already ship a `no-verifier-seat` check rule and a verifier on a second model family. A verifier that inherits the author's compaction summary is a compromised verifier. Fresh context is a correctness property, not just a cost optimization.

Also worth adopting: the structured handoff format (`## Goal / ## Approach / ## Current Status / ## Next Steps / ## Key Files`), which keeps subagent returns at ~50–200 lines instead of 5,000+ raw [^9].

## What I'd do in durig

Given your architecture — durable store, append-only audit trail, queue, constitution injected per seat, and `docs/Managing_Long_Context_Length.md` already landed as the basis of ROADMAP 27–30 — the store is your external memory, which is the layer the research says should be the source of truth anyway [^7]. That points to a clear bias:

1. **Default to a fresh conversation per work item, not a long-lived seat conversation.** The store holds durable state with full fidelity; a summary is a lossy single point of failure. This matches the "open a new chat per task" practice and the theory result that repeated compaction only discards more [^7][^4].
2. **Make the fresh session cheap.** Your seat persona + constitution is a byte-stable prefix, so re-priming a new session is prompt-cache friendly — and byte-stability is the single highest-ROI caching change anyway [^7]. Since D66 already persists per-conversation cwd and the queue carries the item, the handoff payload is small.
3. **Stage it cheapest-first inside a long seat conversation:** dedupe/purge deterministically, then clear stale tool results, and only then summarize [^13][^5]. Redis's framing is the crispest: raw → reversible → lossy, never the reverse [^13].
4. **Trigger at ~60–70% of each model's *effective* window, not nominal.** This is genuinely model-dependent, and durig's `DURIG_MAX_CONCURRENT_SEATS=1` local-model mode is the case where it bites hardest — a 24GB-GPU Qwen has a far smaller effective window than its advertised one. Measure it per seat model rather than inheriting a default [^1].
5. **Use structured templates, not freeform summaries**, with mandatory sections (files modified with full paths, decisions, next steps) that the compressor must fill or explicitly mark empty [^7][^6].
6. **Compact asynchronously during tool waits.** For a resident broker waking seats per pass, this is a natural fit — you already have idle windows while a seat waits on a tool or an external API [^10].
7. **Evaluate with probes, not ROUGE.** Four probe types (recall, artifact, continuation, decision) graded by an LLM judge; alert on artifact-tracking regressions, the metric most sensitive to real failures [^6][^7]. You already have a blind pairwise judge (`src/judge.mjs`) and `demo/optimizer-eval.mjs` — that's most of the harness.
8. **Log every compaction event** with session token, timestamp, threshold, and pre/post token counts, and monitor summary quality as a rolling metric across the session lifetime [^7].

One honest note: the *Complexity Trap* result that masking beats summarization is domain-specific to verbose SE tool output [^5]. durig seats today mostly exchange queue/coordination traffic, which is *succinct* — precisely the regime where masking's advantage is weakest and summarization of dialogue is the right fit [^2]. If roadmap item 4 lands bash/read/write tools on seats, that flips, and the masking-first ordering becomes much stronger. Worth revisiting the threshold policy at that point rather than baking it in now.

**References**

[^1]: [raw.githubusercontent.com](https://raw.githubusercontent.com/chexxor/Pi-OpenDurig/main/docs/Managing_Long_Context_Length.md) (14%)
[^2]: [Context engineering: memory, compaction, and tool clearing | Claude Cookbook](https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools) (5%)
[^3]: [Context Rot: How Increasing Input Tokens Impacts LLM ...](https://www.trychroma.com/research/context-rot) (1%)
[^4]: [[2608.01326v1] Context Compaction Theory](https://arxiv.org/html/2608.01326v1) (16%)
[^5]: [[2508.21433] The Complexity Trap: Simple Observation Masking Is as Efficient as LLM Summarization for Agent Context Management](https://arxiv.org/abs/2508.21433) (13%)
[^6]: [Evaluating Context Compression for AI Agents | Factory](https://factory.ai/news/evaluating-compression) (18%)
[^7]: [Agent Context Compaction for Long-Running Sessions: Techniques and Tradeoffs | Zylos Research](https://zylos.ai/research/2026-04-21-agent-context-compaction-long-running-sessions/) (13%)
[^8]: [Effective context engineering for AI agents \ Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) (4%)
[^9]: [Sub-Agents and Context Isolation | humanlayer/advanced-context-engineering-for-coding-agents | DeepWiki](https://deepwiki.com/humanlayer/advanced-context-engineering-for-coding-agents/4.3-sub-agents-and-context-isolation) (5%)
[^10]: [[2605.23296] Parallel Context Compaction for Long-Horizon LLM Agent Serving](https://arxiv.org/abs/2605.23296) (5%)
[^11]: [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) (1%)
[^12]: [Organizing Context in a Multi-Agent Harness](https://www.langchain.com/blog/organizing-context-in-a-multi-agent-harness) (4%)
[^13]: [Context Compaction for AI Agents: A Complete Guide](https://redis.io/blog/context-compaction/) (2%)


------------------



