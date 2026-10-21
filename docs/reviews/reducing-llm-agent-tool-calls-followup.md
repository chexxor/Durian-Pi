> **D103 rename (2026-10-18):** this record predates the product rebrand `durig` → `durian-pi`; it keeps the old name so the audit trail stays truthful.

I'll work through this research brief properly — first checking what repo access I have, then researching the open questions against primary sources.I have the repo README. Now let me pull the baseline docs the brief names — constitution (P1/P2), METRICS, ROADMAP, DECISIONS (D77/D78), and CODEMODE.I now have the repo grounding (note: the published `DECISIONS.md` ends at **D70** — D77/D78 are not in the public tree, which I'll flag). Now the external literature. Let me verify the load-bearing claims the brief asks me to correct.Now let me verify the specific numbers the brief asks me to correct, and probe the debuggability/semantic-error and multi-agent round-trip questions.One final research pass on the two claims I still need to adjudicate: the "longer plans hurt" evidence and code-as-action debuggability.I've hit the research budget, so here is the completed report. Two access notes first, because they change what I can claim.

---

# Reducing LLM agent tool calls — follow-up (grounded in `durig`)

**Deliverable target:** `docs/reviews/reducing-llm-agent-tool-calls-followup.md` (workspace is read-only here, so the full text is below for you to commit).

## 0. Access and honesty statement (read this first)

The brief asks me to correct a prior report and build on repo docs. Three of the named baselines could **not** be read, and I will not invent their contents:

| Named baseline | Status | Consequence |
|---|---|---|
| `docs/reviews/reducing-llm-agent-tool-calls.md` (the first report) | **Not in the public tree.** `docs/reviews/` holds 11 files, none of them this one. | I cannot audit its `[^6]` citation directly; I re-derive the corrections from the claim *text* the brief quotes and from primary sources. |
| `docs/DECISIONS.md` D77/D78 | **Not in the public tree.** The published file ends at **D70** (`D70 — TUI hardening`, line 1700). The ROADMAP already references `D84`, so the operator's working copy is ahead of `main`. | I answer Q5 from the brief's own description of D77/D78 and from `CODEMODE.md`/D64, not from the D-entries themselves. |
| `docs/CODEMODE.md`, `docs/METRICS.md`, `docs/ROADMAP.md`, `constitution.txt`, `docs/DECISIONS.md` (D1–D70) | **Read** | These carry the mechanism mappings. |

Every external claim below carries a **URL** and an **evidence class**: `observed` (controlled benchmark / peer-reviewed / primary vendor docs) vs `advertised-elsewhere` (vendor or community claim).

---

## 1. Corrections table for the first report

| # | Claim as the first report made it | Verdict | Better source / evidence class |
|---|---|---|---|
| C1 | "Longer plans correlate with reduced accuracy" — supported by `[^6]`, a Medium post | **Unverified as stated.** No controlled study shows a causal dose-response "longer plan → lower accuracy." The closest primary evidence is that LLM planners produce **unnecessarily long, suboptimal** plans (Aghzal et al. 2024, PPNL) and that performance **degrades in long-horizon** settings — but those are about *plan quality/horizon*, not a measured "plan length hurts accuracy" curve. | `observed` for Aghzal et al., [arxiv.org/html/2310.03249](https://arxiv.org/html/2310.03249) [^12]; `observed` for the survey framing, PlanGenLLMs [arxiv.org/pdf/2502.11221](https://arxiv.org/pdf/2502.11221) [^13]; `observed`, "performance can degrade significantly" in long-horizon planning, [arxiv.org/pdf/2502.12435](https://arxiv.org/pdf/2502.12435) [^14]. The Medium post is `advertised-elsewhere` ([^15]). **Recommend: downgrade the claim to "over-planning is a plausible risk, not a measured result," or drop it.** |
| C2 | LLMCompiler accuracy "7–8% vs ~9% seen in secondary sources" | **Partly right, poorly framed.** The paper's headline is **"up to ~9% accuracy improvement"**; the ~9% is the **LLaMA-2 70B / ParallelQA** number. Per-benchmark deltas **vs original ReAct** range from **+0.29 pp to +8.55 pp**. The "7–8%" the first report cites is closest to Movie Recommendation LLaMA (**+7.80 pp**), but presenting 7–8% as *the* figure is a misread of a spread. | `observed` (ICML 2024). [arxiv.org/abs/2312.04511](https://arxiv.org/abs/2312.04511) [^1], [^1]. |
| C3 | Latency multipliers "1.80×/3.74×/2.15×" | **Confirmed — but only for GPT, and the comparison base matters.** Exact Table 1 values: HotpotQA **1.80×** (GPT) / 1.40× (LLaMA); Movie Rec **3.74×** (GPT) / 2.82× (LLaMA); ParallelQA **2.15×** (GPT-4-turbo) / 2.27× (LLaMA). For HotpotQA and Movie Rec the speedup is against **ReAct†** (ReAct plus anti-looping/anti-early-stopping prompting), **not** vanilla ReAct — because vanilla ReAct latency was "unpredictable." | `observed`. [^1], [^1]. |
| C4 | Cost reduction "4.65× on ParallelQA" | **Confirmed**, and understated: GPT cost reductions are HotpotQA **3.37×**, Movie Rec **6.73×**, ParallelQA **4.65×**. The paper's own explanation is directly on-point for this project: it "stems from LLMCompiler's reduced frequency of LLM invocations," and OpenAI parallel function calling needs **three** LLM calls where LLMCompiler needs **one**. | `observed`. [^1], [^1]. |
| C5 | Anthropic "150,000 → 2,000 tokens (98.7%)" | **Single worked example, not a benchmark.** The post presents the figure for its **Google Drive → Salesforce** example and gives **no** benchmark setup, task suite, or methodology. It cites Cloudflare's "Code Mode" post as "similar findings" but **no independent replication with a stated method** is given. | `advertised-elsewhere`. [anthropic.com/engineering/code-execution-with-mcp](https://www.anthropic.com/engineering/code-execution-with-mcp) [^6], [^6]. |
| C6 | "ReWOO ~64% average token reduction" | **Confirmed.** Averaging six public benchmarks: **64% token reduction with a +4.4% absolute accuracy gain**; 5× token efficiency and +4% accuracy on HotpotQA. | `observed` (ICLR 2024 submission). [arxiv.org/html/2305.18323v1](https://arxiv.org/html/2305.18323v1) [^9]; secondary confirmation [^16]. |
| C7 | "ReAct redundantly re-issues calls and stops early" | **Confirmed in the primary source**, with a number: ~20% of examples showed repetitive function calls with ReAct on the LLaMA-2 ParallelQA run. | `observed`. [^1]. |
| C8 | "LLMCompiler has minimal Planner failures" | **Confirmed, with the exact basis:** Planner errors were **3 instances total** in the evaluation, **8% of LLMCompiler's failures** (Executor 64%, final-output 28%) — *not* 8% of all examples. | `observed`. [^1]. |
| C9 | Anthropic "multi-agent ~15× tokens" | **Confirmed** as the vendor's own internal figure: "agents typically use about **4× more tokens** than chat interactions, and multi-agent systems use about **15× more tokens** than chats." | `advertised-elsewhere` (vendor's own internal data). [anthropic.com/engineering/multi-agent-research-system](https://www.anthropic.com/engineering/multi-agent-research-system) [^17]. |

---

## 2. Q1 — Measure first: which primary metric, and what can `metrics` actually see

**The evidence points at tokens and cost, not call count — but the reason matters, and it is not the reason the first report gave.**

Cost is what the plan-then-execute literature actually reports, and it is driven by *model invocations*: LLMCompiler's 4.65×/6.73× cost reduction is explicitly attributed to "reduced frequency of LLM invocations" [^1]. Anthropic's own multi-agent accounting is in **tokens** (4× chat, 15× multi-agent) [^17]. So the honest primary metric is **cost (with cached-input separated from output)**, because it is the quantity the literature moves and because it decomposes into the levers you can actually pull.

But call count is not useless — it is a **proxy for context tokens**, and the mechanism is the one the first report named: each tool call costs a full model turn whose intermediate result re-enters context. LLMCompiler's per-benchmark token tables make this concrete: HotpotQA input tokens drop **2900 → 1300**, Movie Rec **20000 → 2800** [^1].

**The observable / instrumented split against durig's existing `metrics`:**

| Metric | Observable from the store today? | Evidence class | durig mechanism / gap |
|---|---|---|---|
| **Cost** (cached-input vs output) | **Yes** — assistant entries carry `usage` (`input`/`output`/`cacheRead`/`cacheWrite`) and a per-field `cost` breakdown (the F4 correction) | **direct** | Extends item 2's token counter and item 33 (prompt-cache). *Already measured as a class; not yet a shipped measure.* |
| **Context tokens** | **Yes** — same `usage` fields via `storage.scanEntries` | **direct** | **ROADMAP item 27** (context pressure) — "extends item 2's token counter and must feed `computeMetrics`" [^2]. |
| **Model round-trips** (turns per item) | **Derivable, not measured.** A round-trip is one assistant entry; counting entries above a wake boundary is a read-only query | **direct** (derivable) | **No measure ships.** This is a *new measure*, not a new write path — so D24 permits it [^3]. |
| **Wall-clock per item** | **Partly.** Entry and queue-transition timestamps exist; the broker already logs `PASS <n> ms=<dur>` per pass (D65) | **direct** for per-pass; per-**turn** bound is *planned* | Per-turn wall-clock bound is a planned item; item 98 reuses item 27's measure [^2]. |

**Which of the four shipped measures is closest?** `step-repetition` is the only one already aimed at this failure surface, and it is `direct` [^4]. But its **blind spot is decisive here**: 13 of 14 seats in the live store have **zero entries**, so every seat-scoped rate is unmeasurable today — "Small N per seat is the current state, not a hypothetical" [^4]. **Any before/after comparison on a per-seat round-trip measure will read "no data" until a seat has real turns.**

**Recommendation:** primary metric = **cost per completed item, with `cacheRead`/`cacheWrite` separated**; secondary = **context tokens**; round-trips as a diagnostic, not a target. This is exactly what `docs/METRICS.md` already warns against violating: "no composite score, no gating a change on a single number" [^4].

---

## 3. Q2 — Durability cost of batching, and prior art for a durable plan-step boundary

**What breaks.** durig persists **every** turn and recovers via `resume()`. A generated program is one commit and **one opaque step**: there is no per-step checkpoint, and `resume()` cannot resume mid-program. This is not hypothetical — it is the same gap `CODEMODE.md` already names: without the broker audit sink, "a codemode execution is one opaque line in `log`" [^5].

**Prior art for a durable plan-step boundary — and it maps cleanly onto LLMCompiler's DAG:**

- **The durable-execution "step" primitive.** AWS's Durable Execution SDK defines a step as a unit that "checkpoints the result… On replay, the SDK returns the checkpointed result rather than re-running the code inside the step" — and "wrapping non-deterministic code in steps is the primary way you ensure… durable" behaviour [docs.aws.amazon.com/durable-execution/sdk-reference/operations/step](https://docs.aws.amazon.com/durable-execution/sdk-reference/operations/step/) [^18]. **`observed`** (primary vendor docs).
- **Temporal's model:** "Durable Execution ensures that work transparently resumes in a new process," replaying event history to reconstruct state [temporal.io/blog/what-is-durable-execution](https://temporal.io/blog/what-is-durable-execution) [^19]; DBOS, Cloudflare Workflows, and AWS Lambda Durable Functions (Dec 2025) are the same family [^10]. **`observed`**.
- **durig already has the exact primitive in its own stack.** pi-durable's `defineTask` **phases with checkpoints** return `{ status: "running", checkpoint: { phase, … } }` so "the intermediate result survives a crash between steps" — and the ROADMAP already flags this as "what makes a multi-step task resumable at all" [^2], [^2]. **`observed`** (pinned source + roadmap).

**The synthesis:** batching is compatible with resumability **iff the plan DAG's nodes are the durable step boundary**. LLMCompiler already emits a dependency graph with placeholder variables resolved at execution time [^1]. So the durable version is: planner emits a DAG → **each node is a `defineTask` phase that checkpoints** → a crash mid-execution replays completed nodes from their checkpoints and re-runs only the in-flight node. A single monolithic generated program forgoes this; a **checkpointed plan-step graph does not.** This is the single most important design consequence for durig, and it is why "generate one program" should be "generate a DAG whose nodes are checkpointed steps."

---

## 4. Q3 — Verifiability and audit: what happens to failing-first / named-evidence

**durig's discipline is specific.** P1 Evidence: "a claim about durig is checked by RUNNING the demo suite; name the check and its exit code" [^99c0b2#5]. A completion "must name the exact checks it ran and their exit codes" (brief; consistent with P1). Work is commit-scoped in a per-item worktree with explicit paths only [^99c0b2#8].

**What moves when work enters a sandbox.** The **nested result never enters the transcript** — `result.calls` records `{name, status, durationMs}` only, "**no arguments and no output**" [^5]. So a verifier re-running "what the author names" can no longer see the *arguments* the author used, and the per-step trail that the named-evidence rule assumes is exactly what the sandbox elides. durig's own mitigation is that the **broker's audit sink is "the script's real effect record, and it is a requirement, not a nicety"** [^5].

**Is there evidence that code-as-action makes *semantic* errors harder to catch than per-step calls?** **No controlled study found.** I found only: (a) the general observation that multi-step agent failures are hard to localize and that tracing must "trace every step instead of guessing where it broke" [^20], [^21]; and (b) research tooling built *because* of that difficulty (AgentDebugX's "Detect, Attribute, Recover, Rerun" loop [arxiv.org/abs/2607.18754](https://arxiv.org/abs/2607.18754) [^22]; TraceCoder [^23]). **Verdict: `unverified`** — the debuggability cost is a plausible, mechanism-level claim (and durig's CODEMODE audit gap is direct evidence of the *shape* of the loss), but there is no controlled comparison of semantic-error catch rate for code-as-action vs per-step calls. The first report's debuggability caveat should be kept but labelled `inferred`, not cited.

---

## 5. Q4 — Multi-agent / queue interaction

**Does per-seat round-trip reduction change handoff, fan-out, starvation, or the value of parallelism?** Two independent results say yes, and both cut against naive batching in a multi-seat rig:

1. **Coordination overhead is a measurable tax that grows with agents and rounds.** "Towards a Science of Scaling Agent Systems" formalizes architectures by `k`=max iterations, `n`=agents, `r`=orchestrator rounds, `d`=debate rounds, `p`=peer communication rounds, `m`=avg peer requests/round, and finds **"coordination overhead becomes a net cost when baseline performance is already high"** and that multi-agent systems **fragment the per-agent token budget, leaving insufficient capacity for complex tool orchestration** [arxiv.org/html/2512.08296v3](https://arxiv.org/html/2512.08296v3) [^24], [^25]; Google's own summary [research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work](https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/) [^11]. **`observed`** (study) / `advertised-elsewhere` (blog).
2. **Capable models can outgrow collaboration.** Kim et al., *Nature Machine Intelligence* 2026: "Capable language models can outgrow the benefits of collaboration" [nature.com/articles/s42256-026-01268-y](https://www.nature.com/articles/s42256-026-01268-y) [^26]. **`observed`** (peer-reviewed).

**Prior art that multi-agent coordination *adds* round-trips:** Anthropic's 15× token figure [^17] is the canonical one, and the scaling study's "communication overhead counts inter-agent message exchanges" makes the round-trip accounting explicit [^11]. Secondary syntheses put multi-agent at **2–5× more per success** due to communication overhead [^27] (`advertised-elsewhere`).

**Mapping to durig:** this is not a per-seat concern at all — it is the **queue**. durig's own deadlock analysis already models the failure ("a wait-for graph over `deferred-to` edges, so A→B→A is caught; nothing detects a cycle today" — P4) [^2]. **A seat that batches its round-trips does not reduce handoff count** (handoffs are queue items, not turns) — so round-trip reduction is largely orthogonal to fan-out/starvation, and **the value of parallelism (`DURIG_MAX_CONCURRENT_SEATS`) is unchanged** [^7]. What *does* change: a batching seat produces fewer, larger, **less observable** turns, which is exactly the signal the attention channel (`idle_with_queued_work`, `queue-ageing`) relies on. **Recommend: treat multi-agent round-trip cost as a queue property, measured by `queue-ageing` (already `direct` [^4]), not as a per-seat batching decision.**

---

## 6. Q5 — Degeneration interaction (D77/D78)

**Could not read D77/D78** (published `DECISIONS.md` ends at D70). From the brief's description and the docs I *could* read, the honest answer is **the failure surface shifts rather than shrinks.**

- **What reducing turns removes:** the brief's D77 (tool call emitted **as text**, `stopReason:"stop"`) is a per-turn parsing failure — fewer turns means fewer chances to emit it. The D78 prose-repetition loop is likewise per-turn.
- **What it adds:** a **long generated program that silently loops in the sandbox**. And durig's planned sandbox defaults are the hazard: `memoryLimitBytes` defaults to **no limit beyond wasm32's 4 GiB**, and `timeoutMs` defaults to **300,000 ms** — so an omitted setting means an unbounded VM running up to **five minutes** [^5]. The script's own `@options.timeout_ms` is unset; the sandbox's is not [^5]. A loop that would have shown up as `step-repetition` across many observable turns becomes **one opaque call that reports only `{name,status,durationMs}`** [^5].
- **What already exists to catch it:** D64's broker auto-resets a seat "whose run outgrows its bounds (**tool-turns / context tokens / step-repetition / malformed tool calls**)" — but note the bounds are computed over **entries above the last wake**, and D64 explicitly resets "BETWEEN runs — a mid-run cut is a recorded residual gap" [^3]. **A single long in-sandbox program is invisible to all four bounds until the run settles.**

**Verdict:** reducing model turns reduces exposure to tool-call-as-text and prose repetition, **and** shifts the surface to a sandbox-loop failure that durig's current detectors cannot see mid-run. Evidence: `observed` for durig's own mechanisms [^5], [^3]; `unverified` for any published measurement of the shift (none found).

---

## 7. Q6 — When *not* to batch, and the overhead of not batching

**Decision rule (batch iff all four hold):**

1. **The call is idempotent and side-effect-free or safely repeatable.** Irreversible side-effecting calls (a `git commit`, a `git push` — the latter already operator-gated in `confine.mjs`) must stay per-step. durig's worktree commit is the canonical non-batchable step [^99c0b2#8].
2. **No human approval sits in the path.** D32's human deferral deliberately enqueues **nothing** and surfaces on the attention channel — "never let a machine launder a human decision into seat-to-seat traffic" [^3]. A batch that swallows an approval gate violates this.
3. **No rate limit is being consumed blind.** (No durig mechanism today; a genuine gap.)
4. **The step carries a checkpoint you would want on replay** — i.e., it is a failing-first boundary. If the failing-first test is a distinct step, batching past it destroys the evidence trail P1 requires [^99c0b2#5].

**Overhead of *not* batching (the correct revert to per-step calls).** This is precisely the cost the literature quantifies, so "not batching" is not free: LLMCompiler's own numbers are the price of per-step ReAct — **1.80×–3.74× latency** and **3.37×–6.73× cost** [^1]. So the overhead of the per-step fallback is **real and large**, which is why the recommendation is *not* "revert to per-step" but "**batch the determinable bulk, checkpoint the plan nodes, keep the irreversible/approval/failing-first steps per-step.**"

---

## 8. Q8 — Concrete recommendation for durig (smallest useful experiment)

**Seat behaviour to change:** one author seat (`impl`) on a bounded, single-file item, switching from N sequential tool turns to a **plan-then-execute** flow — a short DAG, each node a checkpointed step (per §3), with file reads/writes pushed into the codemode sandbox. **Do not** start with a monolithic generated program.

**Measure before/after against the existing `metrics`:**

| Metric | Before | After | Predicted direction (record BEFORE the change — D24's rule [^3]) |
|---|---|---|---|
| `step-repetition` (direct) | baseline | — | ↓ (fewer turns) |
| Context tokens (`usage` sum, item 27) | baseline | — | ↓ |
| Cost per item, `cacheRead`/`cacheWrite` split | baseline | — | ↓ on output; **watch `cacheWrite`** (item 33's trap) |
| `queue-ageing` (direct) | baseline | — | ≈ (handoff count unchanged) |
| Wall-clock per item (broker `PASS ms=`) | baseline | — | ↓ |

**The confound you must state:** `metrics` has **no drill yet** — "item 3's before/after comparison is confounded by construction" [^2]. So run the experiment against the **faux provider** (a fixed task set) or accept the reading is `confounded`. And with 13/14 seats at zero entries [^4], verify the seat actually has ≥N turns before trusting any rate.

**Proposed ROADMAP items (registered, not scheduled):**

1. **A round-trip / turns-per-item measure feeding `computeMetrics`.** Read-only over entries above a wake boundary; no new write path (D24). Ships with a declared blind spot ("no data" on a seat with too few turns).
2. **Checkpointed plan-step execution.** Adopt LLMCompiler-style DAG planning but bind each node to a pi-durable `defineTask` phase with a checkpoint [^2], [^18], so `resume()` can replay completed nodes. This is the durability-preserving form of batching.
3. **A mid-run sandbox bound.** Extend D64's detector to see a single long-running sandbox call — require `memoryLimitBytes` and a deliberate `timeoutMs` on every `CodemodeSandbox` construction, and surface `result.calls` duration in the completion evidence [^5], [^5].
4. **Narrow the codemode audit gap.** `result.calls` records no arguments/output [^5]; the broker audit sink must be the effect record before codemode lands (already a stated requirement [^5]) — make it an acceptance criterion for P1 Evidence to survive.
5. **Correct `ROADMAP`'s "longer plans hurt" line** if it appears (C1) — downgrade to "plausible risk, not measured."

---

## 9. Bottom line

The architecture the brief describes is sound and the measured gains are real: plan-then-execute collapses **model round-trips** with peer-reviewed support (LLMCompiler 1.80–3.74× latency, 3.37–6.73× cost, up to ~9% accuracy [^1]; ReWOO 64% tokens [^f56123]; CodeAct up to +20% success [^8]). But for **durig specifically** three things change the answer: (1) the Anthropic 98.7% figure is a **single worked example, not a benchmark** [^6]; (2) **batching must preserve resumability by checkpointing plan nodes** — the prior art (AWS/Temporal "step", pi-durable `defineTask` phases) is exactly durig's existing primitive [^18], [^2]; and (3) reducing turns **shifts** the degeneration surface to an opaque in-sandbox loop that durig's current detectors cannot see mid-run [^5], [^3]. The right primary metric is **cost with cache split**, not call count — and the "longer plans hurt accuracy" caveat the first report leaned on is **unverified** and should be relabelled.

**References**

[^1]: [[2312.04511] An LLM Compiler for Parallel Function Calling](https://arxiv.org/abs/2312.04511) (25%)
[^2]: [raw.githubusercontent.com](https://raw.githubusercontent.com/chexxor/Pi-OpenDurig/main/docs/ROADMAP.md) (16%)
[^3]: [raw.githubusercontent.com](https://raw.githubusercontent.com/chexxor/Pi-OpenDurig/main/docs/DECISIONS.md) (15%)
[^4]: [raw.githubusercontent.com](https://raw.githubusercontent.com/chexxor/Pi-OpenDurig/main/docs/METRICS.md) (8%)
[^5]: [raw.githubusercontent.com](https://raw.githubusercontent.com/chexxor/Pi-OpenDurig/main/docs/CODEMODE.md) (6%)
[^6]: [Code execution with MCP: building more efficient AI agents \ Anthropic](https://www.anthropic.com/engineering/code-execution-with-mcp) (4%)
[^7]: [chexxor/Pi-OpenDurig GitHub Repo](https://github.com/chexxor/Pi-OpenDurig) (3%)
[^8]: [Executable Code Actions Elicit Better LLM Agents](https://arxiv.org/abs/2402.01030) (3%)
[^9]: [ReWOO: Decoupling Reasoning from Observations for ...](https://arxiv.org/html/2305.18323v1) (2%)
[^10]: [Durable Execution for AI Agent Runtimes: Checkpointing ...](https://zylos.ai/research/2026-04-24-durable-execution-agent-runtimes/) (2%)
[^11]: [Towards a science of scaling agent systems](https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/) (2%)
[^12]: [Can Large Language Models be Good Path Planners? A Benchmark and ...](https://arxiv.org/html/2310.03249) (1%)
[^13]: [PlanGenLLMs: A Modern Survey of LLM Planning Capabilities](https://arxiv.org/pdf/2502.11221) (1%)
[^14]: [A Survey on Large Language Models for Automated Planning](https://arxiv.org/pdf/2502.12435) (1%)
[^15]: [When Longer Agent Plans Make Models Worse](https://medium.com/@duckweave/when-longer-agent-plans-make-models-worse-750bcc6ec68e) (1%)
[^16]: [ReWOO: Decoupling Reasoning from Observations for ...](https://www.alphaxiv.org/abs/2305.18323) (1%)
[^17]: [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) (1%)
[^18]: [Step - AWS Durable Execution SDK Developer Guide](https://docs.aws.amazon.com/durable-execution/sdk-reference/operations/step/) (1%)
[^19]: [The definitive guide to Durable Execution](https://temporal.io/blog/what-is-durable-execution) (1%)
[^20]: [how to trace and debug AI agents in production - Braintrust](https://www.braintrust.dev/articles/agent-tracing-debug-ai-agents-production) (1%)
[^21]: [How to Trace LLM Agents and Find Failures](https://www.traceloop.com/blog/from-black-box-to-clear-picture-how-to-trace-llm-agents-and-find-failures) (1%)
[^22]: [[2607.18754] AgentDebugX: An Open-Source Toolkit for Failure ...](https://arxiv.org/abs/2607.18754) (1%)
[^23]: [TraceCoder: A Trace-Driven Multi-Agent Framework for ...](https://arxiv.org/html/2602.06875v1) (1%)
[^24]: [Towards a Science of Scaling Agent Systems](https://arxiv.org/html/2512.08296v3) (1%)
[^25]: [Towards a Science of Scaling Agent Systems - arXiv.org](https://arxiv.org/html/2512.08296v1) (1%)
[^26]: [Capable language models can outgrow the benefits of collaboration - Nature](https://www.nature.com/articles/s42256-026-01268-y) (1%)
[^27]: [Towards a Science of Scaling Agent Systems](https://www.linkedin.com/pulse/towards-science-scaling-agent-systems-comprehensive-analysis-gupta-utg1c) (0%)