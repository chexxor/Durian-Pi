I'll research this thoroughly across academic literature, vendor guidance, and open-weights model specifics.# Managing Long Agent Sessions: What the Research Says

## The foundational finding: "context rot"

Everything about when to compact flows from one empirical result. Model accuracy degrades as input length grows **even on trivial tasks, and well before the window is full**. Chroma's 2025 study of 18 frontier models (GPT-4.1, Claude 4, Gemini 2.5, Qwen3, etc.) found every one degraded with length, including 30%+ accuracy drops when the answer sat mid-document and a measurable loss from length alone [^1][^2]. This builds on the classic "lost in the middle" result (Liu et al.), which measured 20+ percentage-point drops on multi-document QA when the relevant document sat in the middle of a long context [^3]. Anthropic formalizes it: "as the number of tokens in the context window increases, the model's ability to accurately recall information from that context decreases" [^4].

Two consequences matter for your question:

1. **Advertised context ≠ usable context.** RULER found that while all tested models claimed 32K+, only about half could effectively handle 32K [^5]. NoLiMa (which removes literal lexical overlap between needle and haystack) found 11 of 13 models dropped below 50% of their short-context baseline at 32K, and one synthesis reported most models had an "effective length" of ~2,000 tokens or less, with degradation showing up in the 2K–8K range [^6][^7]. NoLiMa defines *effective length* as the longest context where the model keeps ≥85% of its base score [^8] — the same 85%-style threshold RULER uses [^9].
2. **The practical usable window is a fraction of the nominal one.** A 2026 synthesis of RULER/MRCR/NoLiMa found frontier models reliably use only ~50–65% of their advertised window for multi-hop work, with a 30–60 point accuracy gap past 200K tokens [^10][^11].

## When should a new context be generated vs. compacted?

The literature distinguishes **context selection** (keep a subset, e.g. observation masking / eviction) from **context generation** (rewrite into a summary). The *Context Compaction Theory* paper (2026) gives the cleanest formal framing [^12]:

- **Generation is strictly more powerful than selection.** Summarization can reorder, compress, and emit new tokens; selection can only drop. It proves generation is equivalent to one-way communication complexity, and exhibits a case where generation needs *n* bits while any zero-error selection needs *n·log₂n* bits [^12][^12].
- **The optimum is a budget, not a time.** The formal result is: the *minimum context budget* to answer a future query workload at a target error equals the communication complexity of that workload. So "when to compact" is really "how small can my retained state be, given what I might be asked later" [^12].
- **It models a single compaction invocation as the base case**, and notes repeated compaction can only discard more — a session of many compactions is never better than its best single one [^12].

**Trigger timing — the empirical consensus is "proactive, ~50–70% fill," not "panic, 90%+."** A 2026 production-pattern review argues for compacting at roughly **60–70% of the model's *effective* (not nominal) window**, because at 90%+ the summarizer itself is operating in the rotted regime and produces worse summaries precisely when you need them [^3][^3]. The rationale: degradation onset is reported around 50–70% fill in multiple 2026 syntheses, and some 200K-window models degrade measurably by ~50K tokens [^3]. One research variant (*Self-Compacting Language Model Agents*) triggers at **30% of the max window**, citing a Liu et al. (2025) suggestion [^13].

**Staged trigger, cheapest lever first** is the other strong recommendation:
1. Clear/mask stale, re-fetchable tool results first (keep a one-line record of each call) — no LLM call needed.
2. Re-check utilization; masking often buys enough headroom.
3. Only then summarize the evicted middle.

JetBrains' *The Complexity Trap* (2025) is the key evidence here: on SWE-bench Verified with SWE-agent, simple **observation masking matched LLM summarization's solve rate across five model settings while costing less**, and their hybrid cut cost ~52% vs. baseline while *improving* solve rate ~2.6% [^14][^15][^16]. Summarization also had a measurable failure: up to **15% longer trajectories** because the agent lost its stop signal [^3].

**What to keep verbatim (keep-zones):** the system prompt and tool schemas (byte-identical, also to preserve prefix-cache hits), the task statement and acceptance criteria, and roughly the **last 5–7 turns** in full. Rebuild as: verbatim head → summary block → recent turns → tool schemas [^3][^3].

**Known failure modes to design against:** summary-induced amnesia loops (agent re-tries ruled-out approaches), lost stop signals, destroying exact identifiers, compounding summary drift (summaries-of-summaries), audit-trail destruction, and cache-hostile rebuilds that silently zero your prefix-cache hit rate [^3].

## Does it depend on the model? Yes — and how to discover your model's numbers

**Yes, strongly, and you should not inherit a default.** The pattern review is explicit: set the trigger from the model's *effective* window "measured on the actual task mix," because it depends on the model, tool-output shapes, and how much of the window one turn consumes [^3][^3]. A useful nuance: the *compaction mechanism* (e.g., Codex's summarization) is largely model-independent and "a property of the agent design," but the *trigger threshold* is per-model — Codex itself maintains a **per-model token threshold** below the window [^12].

**How to measure it for your model** — you have three practical routes, all cheap to run yourself:

| Method | What it gives you | Notes |
|---|---|---|
| Run RULER on your model | Effective length (longest length scoring ≥85.6) [^9] | NVIDIA's repo is open; 13 tasks × 6 lengths [^5] |
| Run NoLiMa | Effective length = longest ctx keeping ≥85% of base score [^8] | Harder than NIAH; removes lexical overlap [^6] |
| Build your own NIAH + task harness | Your *real* effective window | Advertised figure is just `max_position_embeddings`; "a model will happily accept 200,000 tokens and answer using only the last 3,000" [^17] |

Then **A/B your trigger threshold on your real task mix**: run the same workload at several thresholds and plot completion rate vs. cost; set the trigger from that measurement, not folklore [^3]. Keep a **compaction ledger** (tokens before/after, what was cleared vs. summarized) so post-compaction failures trace to specific information loss [^3].

**Newer research direction:** let the model decide. *AutoCompact* (2026) trains agents to compact proactively and reports it helps even when the full history fits in-window [^18]; *Self-Compacting LM Agents* shows a decision-based version matching or beating a fixed threshold at a fraction of the token cost [^13]. *ACON* optimizes compression for long-horizon agents [^19], and *Parallel Context Compaction* tackles the fact that synchronous summarization is lossy and stalls inference for tens of seconds [^20].

## Research vs. industry/popular configuration

| System | Trigger / config | Notes |
|---|---|---|
| **Research default** | ~50–70% of *effective* window; cheapest-lever-first; last 5–7 turns verbatim [^3] | Tuned from your own ledger [^3] |
| **Anthropic (concept)** | Compaction as the "first lever"; summarize near limit, reinitiate new window [^4] | Also: subagents, tool-result clearing, memory tool [^21] |
| **Claude Code** | Auto-compact, default ~90% of window; env vars for percentage or token window (100K–1M) [^22][^23] | Community reports range ~77%–95% by version; docs don't fix a percentage [^3] |
| **OpenAI Codex** | Per-model token threshold below the window; summarization is model-independent [^12] | Warns "multiple compactions can cause the model to be less accurate" [^12] |
| **Letta / MemGPT** | Evict only a portion (~70%), recursive summarization [^24] | Filesystem storage beat specialized memory tools on LoCoMo (74.0%) [^25] |
| **LangChain Deep Agents** | Offloading, summarization, filesystem abstraction [^26] | Keeps head+tail tokens of tool outputs, offloads full output [^27] |
| **Pydantic AI / MS Agent Framework** | Composable `CompactionStrategy` chain at token threshold [^28][^29] | Service-managed context skips compaction [^29] |

**The gap:** the research consensus leans *earlier* (60–70% of effective window) than several shipped defaults (Claude Code ~90%). The pattern review calls the 95% panic zone actively harmful because the summarizer runs on already-rotted context and may itself overflow [^3]. Also note prompt-caching interaction: rewriting the head (system prompt) silently destroys prefix-cache economics, which is why keep-zones should be byte-stable [^3][^3].

## Open-weights models from China and Europe — what changes

The **architectural** long-context technique affects how much of the window you can trust:

- **Qwen (Alibaba):** Qwen2.5-1M extends to 1M tokens using **Dual Chunk Attention (DCA)**, which remaps relative positions to avoid untrained large RoPE distances; Qwen3 inherits DCA [^30][^31][^32]. DCA is a *length-extrapolation* trick — good for reaching 1M, but extrapolation ≠ accuracy, so measure effective length yourself. Note DCA isn't supported by all runtimes (e.g., early MLX), so serving stack matters [^33].
- **DeepSeek:** V3 handles 128K via a two-stage extension (32K → 128K) and reports robust NIAH across the window [^34]. V3.2-Exp claims better efficiency on long sequences with no substantial degradation vs. V3.1 [^35].
- **Kimi (Moonshot):** K2 uses a 128K window, truncating longer input [^36]; K2.5 offers ~256K [^37].
- **GLM (Zhipu):** 128K on 4.7; community notes good attention retention to max length but capped window [^38].
- **Mistral (Europe):** Mistral Large 4 (Oct 2026) is a 1T-parameter open-weight MoE with a **1M-token window**, trained on ~3,800 Grace Blackwell GPUs in EU datacenters [^39][^40][^41]. A reviewer warns long-context recall "should also be tested on your own data rather than assumed from the maximum window size" [^41].
- **EuroLLM / Teuken (Europe):** EuroLLM-22B explicitly increased max context to cover long-context benchmarks [^42]; Teuken-7B targets all 24 EU languages with a custom tokenizer [^43]. These are multilingual-focused, so effective length on English-heavy agent traces may differ from vendor claims.

**Practical implication for a mixed fleet:** because your trigger is per-model, you need per-model effective-window numbers. Run RULER + NoLiMa once per model, then set each model's compaction trigger to ~60–70% of *its measured* effective length, not of its advertised window [^3][^9][^8]. Cheaper open-weights models often have narrower effective windows relative to their advertised size, so they'll compact sooner; frontier models can carry more. Keep the mechanism (staged: mask → summarize) shared, and only the threshold per-model — that matches Codex's own design [^12].

## Bottom line

- **Don't wait for the window to fill.** Compact proactively around 60–70% of each model's *effective* window; degradation starts well before that [^1][^3].
- **Stage it:** mask/clear stale tool results first (best cost/benefit, no LLM call), summarize only if needed [^14][^16].
- **Generate > select** formally, but masking is cheaper in practice and often equal [^12][^15].
- **Keep a byte-stable verbatim head + recent tail; summarize the middle against a schema** [^3][^3].
- **Yes, it's model-dependent** — measure each model's effective length (RULER/NoLiMa/your own NIAH) and A/B the threshold on your real tasks, logging every compaction [^17][^3].
- **Industry defaults skew later (~90%) than the research recommends (~60–70%)** — control the threshold yourself rather than inheriting a moving default [^3].

If you tell me which specific open-weights models and serving stack you're using, I can pull their exact advertised windows and any published long-context evaluations to seed your per-model threshold table.

**References**

[^1]: [Context Rot: How Increasing Input Tokens Impacts LLM ...](https://www.trychroma.com/research/context-rot) (1%)
[^2]: [Context Rot: Evaluating LLM Performance Degradation ...](https://www.zenml.io/llmops-database/context-rot-evaluating-llm-performance-degradation-with-increasing-input-tokens) (3%)
[^3]: [Context Compaction Pattern for Long-Running Agents (2026)](https://www.agentnative.dev/patterns/context-compaction-pattern-for-long-running-agents) (13%)
[^4]: [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) (3%)
[^5]: [NVIDIA/RULER: This repo contains the source code for ...](https://github.com/NVIDIA/RULER) (2%)
[^6]: [NoLiMa: Long-Context Evaluation Beyond Literal Matching](https://arxiv.org/html/2502.05167v1) (3%)
[^7]: [Context Rot: Why LLMs Degrade Over Long Contexts (2026)](https://www.lyzr.ai/blog/context-rot/) (1%)
[^8]: [NoLiMa: Long-Context Evaluation Beyond Literal Matching](https://github.com/adobe-research/NoLiMa) (4%)
[^9]: [RULER (benchmark) | AI Wiki](https://aiwiki.ai/wiki/ruler_benchmark) (2%)
[^10]: [LLM Context Windows 2026: Real Accuracy Past 200K Tokens](https://ofox.ai/blog/long-context-llm-benchmarks-200k-tokens-2026/) (2%)
[^11]: [Long-Context LLM Benchmarks 2026: Accuracy Past 200K Tokens](https://genai.club/blog/long-context-llm-benchmarks-2026-accuracy-past-200k-tokens) (2%)
[^12]: [[2608.01326v1] Context Compaction Theory](https://arxiv.org/html/2608.01326v1) (15%)
[^13]: [Self-Compacting Language Model Agents](https://arxiv.org/pdf/2606.23525) (1%)
[^14]: [Simple Observation Masking Is as Efficient as LLM ...](https://arxiv.org/html/2508.21433v3) (1%)
[^15]: [The Complexity Trap: Simple Observation Masking Is as Efficient as...](https://arxiv.org/pdf/2508.21433) (1%)
[^16]: [Cutting Through the Noise: Smarter Context Management for...](https://blog.jetbrains.com/research/2025/12/efficient-context-management/) (3%)
[^17]: [Effective Context Length vs Advertised Context... - DEV Community](https://dev.to/multigrid/effective-context-length-vs-advertised-context-length-1ne7) (2%)
[^18]: [AutoCompact: Learning When to CompactContext in Long-Horizon...](https://arxiv.org/html/2610.02163v1) (2%)
[^19]: [ACON: Optimizing Context Compression for Long-horizon LLM Agents](https://arxiv.org/abs/2510.00615) (2%)
[^20]: [Parallel Context Compaction for Long-Horizon LLM Agent Serving](https://arxiv.org/abs/2605.23296) (2%)
[^21]: [Context engineering: memory, compaction, and tool clearing](https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools) (4%)
[^22]: [How to Configure Claude Code Auto-Compact Settings with Environment ...](https://docs.bswen.com/blog/2026-03-21-claude-code-auto-compact-settings/) (2%)
[^23]: [claude-code-best-practice/best-practice/claude-settings.md at main...](https://github.com/shanraisshan/claude-code-best-practice/blob/main/best-practice/claude-settings.md) (1%)
[^24]: [Agent Memory: How to Build Agents That Learn and ...](https://www.letta.com/blog/agent-memory/) (3%)
[^25]: [Benchmarking AI Agent Memory: Is a Filesystem All You ...](https://www.letta.com/blog/benchmarking-ai-agent-memory/) (1%)
[^26]: [Context Management for Deep Agents](https://www.langchain.com/blog/context-management-for-deepagents) (1%)
[^27]: [The Anatomy of an Agent Harness](https://www.langchain.com/blog/the-anatomy-of-an-agent-harness) (2%)
[^28]: [Compaction | Pydantic Docs](https://pydantic.dev/docs/ai/harness/compaction/) (3%)
[^29]: [Compaction](https://learn.microsoft.com/en-us/agent-framework/concepts/agents/conversations/compaction) (0%)
[^30]: [Qwen2.5-1M: Deploy Your Own Qwen with Context Length ...](https://qwenlm.github.io/blog/qwen2.5-1m/) (1%)
[^31]: [Qwen2.5-1M Technical Report](https://arxiv.org/pdf/2501.15383) (2%)
[^32]: [[2501.15383] Qwen2.5-1M Technical Report - arXiv.org](https://arxiv.org/abs/2501.15383) (1%)
[^33]: [Deploy your own Qwen with context length up to 1M tokens](https://news.ycombinator.com/item?id=42831769) (1%)
[^34]: [DeepSeek-V3 Technical Report - arXiv.org](https://arxiv.org/html/2412.19437v1) (2%)
[^35]: [DeepSeek-V3.2: Pushing the Frontier of Open Large Language Models](https://arxiv.org/pdf/2512.02556) (2%)
[^36]: [Kimi K2: Open Agentic Intelligence](https://arxiv.org/html/2507.20534v2) (1%)
[^37]: [DeepSeek V3 vs Kimi K2.5: AI Benchmark Comparison... | BenchLM.ai](https://benchlm.ai/compare/deepseek-v3-vs-kimi-k2-5) (1%)
[^38]: [GLM-4.7 vs DeepSeek V3.2 vs Kimi K2 Thinking ...](https://www.reddit.com/r/LocalLLaMA/comments/1qnhj9j/glm47_vs_deepseek_v32_vs_kimi_k2_thinking_vs/) (1%)
[^39]: [Introducing Mistral Large 4 | Mistral](https://mistral.ai/news/mistral-large-4/) (2%)
[^40]: [Mistral Large 4: The Trillion-Parameter Open-Weight... | Flowtivity](https://flowtivity.ai/blog/mistral-large-4-open-weight-frontier-deep-dive/) (2%)
[^41]: [Mistral Large 4: Specs, Benchmarks, Pricing & Use Cases](https://www.edenai.co/post/mistral-large-4-specs-benchmarks-pricing-use-cases) (2%)
[^42]: [EuroLLM-22B: Technical Report](https://arxiv.org/html/2602.05879v1) (1%)
[^43]: [Teuken-7B-Base & Teuken-7B-Instruct: Towards European LLMs](https://arxiv.org/html/2410.03730) (2%)



I'll research the concrete measurement tooling and harness-level instrumentation you'd need, since you're building this yourself.Good leads. Let me pull the concrete methodology sources and search a couple more angles.Let me pull the multi-agent optimization framework and the benchmark implementation details.You now have a concrete instrument to build. Here's the measurement-and-optimization methodology, organized as a pipeline you can implement in your harness.

## 1. Frame the target correctly: you're measuring MECW, not MCW

The thing you must measure per model is the **Maximum Effective Context Window (MECW)** — "the maximum token count, for a given problem type, before the model performance begins to degrade in a measurable fashion" [^1]. This is explicitly **not** the advertised window (MCW); the MECW "shifts based on the problem type," and in one large study most models had severe degradation by ~1,000 tokens, with the gap from the claimed window reaching >99% [^1][^1]. So a single number per model is wrong — you need a **curve per (model × task-shape)**.

Two axes matter, and they're independent:

| Axis | What it captures | Failure signature |
|---|---|---|
| **Length** | Raw token count | *Rightward fade* — accuracy decays as filler grows, even at fixed needle depth (context rot) [^2] |
| **Position/depth** | Where the evidence sits | *Middle dip* — U-shaped curve, worst at ~50% depth [^2] |
| **Task shape** | Retrieval vs. multi-hop vs. aggregation | Multi-hop breaks far earlier than single-fact retrieval [^2] |

## 2. Step 1 — Offline per-model profiling (run once per model, re-run on version changes)

### 2a. Start with the off-the-shelf synthetic suites

**RULER** is the strongest default. It generates synthetic examples with configurable sequence length and task complexity across 4 categories / 13 tasks: retrieval (NIAH variants), multi-hop variable tracking, aggregation (common/frequent word extraction), and QA (SQuAD/HotpotQA) [^3][^3]. To add your model you configure its path, template type, and framework (`hf`/`vllm`/`trtllm`/`openai`/`gemini`) in `config_models.sh`, add a chat template if needed, then `bash run.sh YOUR_MODEL_NAME synthetic` [^3]. It supports OpenAI and Gemini endpoints natively as well as local HF/vLLM models, which matters for your mixed fleet [^3].

The key output is **effective length**: the tested sequence length where the model's performance stays above a fixed qualitative threshold — RULER uses Llama-2-7B's 4K score of **85.6%** as the cutoff [^3][^3]. Their headline finding: "while all models claim context size of 32k tokens or greater, only half of them can effectively handle sequence length of 32K" by that threshold [^3].

**NoLiMa** is the harder complement. It removes the literal lexical overlap between needle and question, forcing latent association. It defines effective length as "the longest context where a model maintains at least **85% of its base score**," where the base score is accuracy at short contexts (250/500/1K tokens) [^4]. This matters because a model can pass vanilla NIAH by string-matching and still fail NoLiMa — so run **both**, and if they disagree, trust the harder one for compaction decisions.

### 2b. Build your own NIAH harness (this is the instrument you own)

The off-the-shelf suites give you a comparable number; your own harness gives you *your task's* number. The method is small and stable since Kamradt's 2023 test [^2]:

1. **Plant a needle** — one short distinctive fact — at a controlled depth (10%, 50%, 90%) [^2].
2. **Ask the model to retrieve it**, haystack as context [^2].
3. **Sweep length × depth**, score each cell pass/fail [^2].
4. **Render a heatmap** [^2].

Load-bearing implementation details the article calls out:

- **Depth control in tokens, not sentences.** Tokenize the filler, cut at target length, splice the needle at the requested token fraction — because attention dilutes per token [^2].
- **Assert the needle is present exactly once after splicing.** "A needle that got truncated by your token budget invalidates the cell silently — this is the most common bug in DIY harnesses" [^2].
- **Greedy decoding (`do_sample=False`)** so you measure the model, not the dice; short `max_new_tokens` because prefill dominates cost [^2].
- **Binary scoring against the exact string** — "No LLM judge, no partial credit — binary scoring is what makes the heatmap honest" [^2].
- **Multiple trials per cell** in production (the demo grid is one trial/cell; Kamradt's original averaged) [^2].
- **Boring, uniform filler** so the model can't pattern-match instead of retrieve [^2].

The heatmap gives you three diagnosable signals: the **rightward fade** (context rot), the **middle dip** (lost-in-the-middle), and the **cliff** — "a sharp vertical boundary where everything past some length fails regardless of depth. That is your model's *effective* context for this task shape — write it down, because it is almost certainly smaller than the number on the model card" [^2].

### 2c. For real task-shapes, use the MECW method

For anything beyond retrieval, the MECW study's method is directly reusable: concatenate increasing numbers of real data points, formulate a question over them, **randomize order**, require JSON-formatted answers for easy scoring, then bucket token counts (5,000-token buckets for NIAH; **100-token buckets** for other question types) and average correctness per bucket [^1]. Crucially, they validated the token↔accuracy relationship with a **p-value per (question × model)** before trusting a curve, collecting >66k rows [^1]. Do the same: don't fit a degradation curve from a handful of points.

## 3. Step 2 — Profile the task shapes you actually run

Because MECW is task-shape-specific, your profile should be a matrix. The multi-agent practitioner study is instructive: it ran 2,420 trials across 11 model configurations, 20 blocks per condition, and found that **position effects are smaller than composition effects and are model-dependent** [^5][^5]. At short windows (~2–3K tokens) the signal/noise *ratio* mattered more than position; the lost-in-the-middle effect only emerged at larger prompt sizes [^5]. That's a concrete reason to measure at *your* typical window size, not at 128K.

Their counterintuitive measured result you should test for yourself: for relevance-style tasks, a context of **100% signal is not optimal** — a ~50:50 signal-to-same-domain-noise mix raised relevance accuracy by +0.077 (95% CI [+0.056, +0.098], d=0.49, p<.001) versus pure signal, across all 11 configurations [^5]. So "compress to only the relevant stuff" can *hurt*; test it.

**Per-model profile table to maintain** (one row per model, updated per version):

| Field | How you get it | Use |
|---|---|---|
| Claimed window (MCW) | Model card | Reference only |
| Effective length (retrieval) | RULER + NoLiMa | Baseline compaction ceiling |
| Effective length (your task shape) | Your NIAH / MECW harness | The number that sets the trigger |
| Degradation curve (acc vs. tokens) | Bucketed sweep, p-validated | Pick trigger at knee, not cliff |
| Position sensitivity | Depth sweep | Whether to reorder/place evidence |
| Signal/noise optimum | Ratio sweep | Whether to include same-domain noise |
| Latency & $/1K prefill tokens | Timed runs | Cost side of the trade-off |

## 4. Step 3 — Instrument production (the part most harnesses skip)

Offline benchmarks give priors; your production telemetry gives ground truth. The multi-agent study's telemetry spec is a good template — it logs `pipeline.run.start`, `pipeline.stage.start/end` with `elapsed_ms`, and critically `pipeline.llm.call` with `{runId, model, input_tokens_est, output_tokens_est}`, plus `pipeline.cache.hit`, `pipeline.fallback`, and `pipeline.run.end` [^5]. Recommended additions: actual `prompt_tokens`/`completion_tokens` from provider usage, per-stage latency, cache-key hash, **`model_family`** (to compare cost/quality across your heterogeneous fleet), and `fallback_count` [^5].

Layer a **compaction ledger** on top: for every compaction, record tokens before/after, what was masked vs. summarized, and the task outcome. That's what lets you attribute a post-compaction failure to a specific information loss rather than guessing.

## 5. Step 4 — Optimize the threshold by A/B, not by inheritance

The mechanism and the threshold are separable: **compaction mechanism is largely model-independent (a property of the agent design), but the trigger threshold is per-model.** Codex itself keeps a per-model token threshold below the window for exactly this reason [^f37b27#346-357]. So:

1. Fix one mechanism (staged: mask stale tool outputs → re-check → summarize only if needed).
2. Sweep the trigger threshold across candidate values (e.g., 40/50/60/70/80% of each model's *measured* effective length).
3. Score each arm on **task pass rate vs. inference cost** simultaneously, and pick the knee.
4. Re-run whenever you change model version, tool-output shapes, or the average tokens one turn consumes.

**What the A/B should compare, per the evidence:**

- **Fixed threshold vs. full history** — AutoCompact beats full-history on SWE-bench Verified *at every inference-cost budget*, even in a 256K window where no trajectory ever hits the forced-compaction threshold [^6]. This is the single most important finding for you: **compaction helps even when you never run out of context**, because stale exploration impairs reasoning regardless of length [^6].
- **Fixed threshold vs. adaptive/learned timing** — at an identical forced 16K threshold, the adaptive model still wins, "supporting the intuition that compaction timing should depend on the current task state rather than context length alone" [^6].
- **Where to compact** — the best point is a *phase transition* ("after localizing the issue and before beginning the edit"), preserving "original task + recent turns + summary" [^6]. A fixed threshold can fire mid-reasoning, when context "may be harder to summarize" [^6].

## 6. Multi-agent / team specifics

This is where per-model optimization pays off most, because errors compound.

- **Cascading failures are multiplicative.** "A 3-agent system with 70% success per agent results in a system with a 34.3% success rate" [^1]. Large windows *worsen* this because they degrade per-agent accuracy; the paper explicitly warns that agentic systems relying on large context windows "will see cascading failures" [^1]. So your per-model MECW sets each agent's budget, and you should model system-level success as the product of per-agent success — then spend budget on the agents with the steepest degradation.
- **Route by content type before calling the model.** When source types differ in signal density, routing separately (meetings vs. email vs. chat) raised relevance accuracy ~+0.16 in one exploratory analysis, because it changes the signal distribution *before* the model sees the prompt [^5]. This is a quality lever, not just a token-saving one.
- **Compress inter-agent handoffs.** Replacing prose status messages with schema-contracted machine messages cut wrapper tokens ~40–60% (estimate) [^5]. Combined patterns gave a compound ~60–70% token reduction in one production case study [^5].
- **Give each agent a declared budget and enforce it at the state level.** ContextBudget treats compression as a sequential decision made *before* loading each observation, conditioned on remaining headroom and the pending observation's size — reserving capacity for the incoming observation rather than reacting after overflow [^7]. It uses three regimes: full history under high budget, selective aggregation under moderate, full aggregation under severe [^7]. You can implement the *rule-based* version of this today (no RL needed): set per-agent trigger = fraction of that agent's MECW, and make the decision relative to the *next* observation's token length.
- **Trained versions are the frontier.** AutoCompact reaches 44.3% (SFT) → 58.5% (RL) proactive compaction, with 99.8% of summaries retaining task/workspace state [^6]. Notably, its weakness is *when* not *what*: "many summaries are generated only after the agent has begun testing… more reliable at what to preserve than when to compact" [^6]. And a taxonomy paper warns harness-triggered compaction can silently "drop the reasoning or constraint" while keeping the surface action [^8], and the trend is toward **agent-controlled compression** (a tool the agent calls between subtasks) to avoid interrupting in-flight reasoning [^9].

## 7. The concrete recipe

| Phase | Action | Cadence |
|---|---|---|
| Onboard a model | Run RULER + NoLiMa → effective length (85% thresholds) [^3][^4] | Once per model/version |
| Profile task shapes | Your NIAH + MECW harness, bucketed, p-validated [^2][^1] | Once + on task-mix change |
| Set initial trigger | ~60–70% of *measured* effective length, per model [^10] | Derived, not inherited |
| Deploy | Staged mechanism (mask → summarize), telemetry + compaction ledger [^5] | Continuous |
| Optimize | A/B threshold on pass-rate vs. cost; test full-history and adaptive arms [^6] | Per release |
| Team-level | Per-agent budgets from each model's MECW; model cascade product [^1]; route by type [^5] | Per topology change |

**The one number to internalize:** a model will accept its full advertised window and degrade long before filling it — "a model will happily accept 200,000 tokens and answer using only the last 3,000" [^7c50f8]. Your harness's job is to find where *your* model's usable window ends for *your* task shapes, and set the compaction trigger below that cliff — per model, because "your heatmap measures *your* model on *your* task — which is exactly why running it beats citing a paper" [^2].

If you tell me your serving stack (vLLM, TensorRT-LLM, MLX, hosted APIs) and the model list, I can map each to the exact RULER template/framework config and flag which ones need `max_position_embeddings` bumped or a custom chat template before the harness will run.

**References**

[^1]: [[2509.21361] Context Is What You Need: The Maximum Effective Context Window for Real World Limits of LLMs](https://arxiv.org/pdf/2509.21361) (0%)
[^2]: [Your 32K context window is a marketing number: measure what your model actually remembers — AI Frontier Post](https://aifrontierpost.com/articles/measure-effective-context-needle-test/) (18%)
[^3]: [NVIDIA/RULER GitHub Repo](https://github.com/NVIDIA/RULER) (14%)
[^4]: [NoLiMa: Long-Context Evaluation Beyond Literal Matching](https://github.com/adobe-research/NoLiMa) (2%)
[^5]: [[2608.17188] Token Optimization and Context Window Management in Multi-Agent AI Workflows](https://arxiv.org/pdf/2608.17188) (34%)
[^6]: [AutoCompact: Learning When to Compact Context in Long-Horizon Coding Agents](https://autocompact.github.io/) (20%)
[^7]: [[2604.01664v1] ContextBudget: Budget-Aware Context Management for Long-Horizon Search Agents](https://arxiv.org/html/2604.01664v1) (8%)
[^8]: [Model or Harness? An Interaction-Centric Taxonomy ...](https://arxiv.org/html/2607.28802v1) (0%)
[^9]: [ai-boost/awesome-harness-engineering: Awesome list for AI agent...](https://github.com/ai-boost/awesome-harness-engineering) (1%)
[^10]: [Context Compaction Pattern for Long-Running Agents (2026)](https://www.agentnative.dev/patterns/context-compaction-pattern-for-long-running-agents) (1%)