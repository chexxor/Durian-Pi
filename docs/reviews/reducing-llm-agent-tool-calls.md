When using an LLM agent that is long lived and doing lots of tool-calls, is it possible to ask it to reduce the number of toolcalls as few as possible by doing lots of planning up-front to consider all edge-cases that might produce more tool calls, then generate a program to run that will accomplish the goal, and successfully avoid multiple toolcalls?


----------


I'll ground this in the actual research literature on agent architectures before answering.Let me pull the primary sources and the counterarguments.## Short answer

Yes — this is one of the most actively pursued directions in agent design, and there are real systems and measurements behind it. But there's an important reframing: what you can reliably collapse is the **number of model round-trips** (LLM → tool → LLM → tool…), not necessarily the number of underlying tool invocations. Those are different budgets, and conflating them is the main source of disappointment with this approach.

## The distinction that matters

In a classic ReAct loop, every tool call costs a full model turn: the model emits a call, the result is injected into context, the model reasons again. The expensive part isn't the call itself — it's that every intermediate result must pass *through the model* [^2]. A two-hour sales meeting transcript can add ~50,000 tokens of round-tripping, and large documents can blow the context window entirely [^2].

Two ways to attack this:

| Approach | What it collapses | Does it reduce actual tool calls? |
|---|---|---|
| **Plan-then-execute** (ReWOO, LLMCompiler) | Model turns: one planner call emits the whole DAG, then a non-LLM fetcher/executor runs it [^1] | No — same calls, but issued in parallel from a single LLM call [^1] |
| **Code-as-action** (CodeAct, code execution with MCP) | Both model turns *and* apparent tool calls: loops, conditionals, filtering and joins happen inside the sandbox [^2] | Yes at the model boundary — the calls become ordinary function calls inside one program |
| **Hybrid** (plan → generate program → replan on failure) | Most of both | Yes, with escape hatches |

## The measured results

These aren't hypotheticals — the numbers are substantial:

- **LLMCompiler** plans the entire dependency graph up front with placeholder variables (`$1`, `$2`) substituted at execution time, then executes independent tasks concurrently [^1]. It reports 1.80×/3.74×/2.15× latency speedups over ReAct† on HotpotQA, Movie Recommendation, and ParallelQA, and **4.65× cost reduction** on ParallelQA — driven explicitly by "reduced frequency of LLM invocations" [^1]. Crucially, the paper notes OpenAI's parallel function calling only plans *immediately* parallelizable tasks, needing three separate LLM calls where LLMCompiler needs one [^1].
- **Code execution with MCP** reports token usage dropping from **150,000 to 2,000 tokens (98.7%)** for a large-toolset workflow, because the agent discovers tools by listing a filesystem and reading only the definitions it needs [^2][^2]. A 10,000-row spreadsheet becomes five rows in context instead of 10,000 [^2].
- **ReWOO**'s Plan-Work-Solve decoupling reports ~64% average token reduction by deferring observation [^4].

There's also a genuine accuracy argument, not just a cost one: ReAct's failure modes include redundantly re-issuing prior calls and *premature early stopping* on incomplete intermediate results — and planning ahead mitigates both, worth up to 7–8% accuracy [^1].

## Where "plan everything up front" breaks down

This is the part the marketing tends to skip, and it's why the answer is "yes, but not purely."

1. **You cannot plan around information you don't yet have.** The static-plan approach assumes the execution flow is determinable at the start. LLMCompiler's own authors flag dynamic replanning as necessary precisely "for problems whose execution flow cannot be determined statically in the beginning" [^1]. Real tools fail, return unexpected schemas, and hit rate limits — a benchmark on dynamic replanning and anomaly recovery finds agents generally lack robust anomaly awareness [^5].

2. **Plan errors get amplified.** A single mistaken assumption in the up-front plan now corrupts an entire generated program, rather than being caught at step 3. Interleaved execution gives you natural checkpoints; a monolithic program does not. The upside is that LLMCompiler reports "minimal Planner failures" in its own failure analysis [^1] — but that's on benchmark tasks with clean tool interfaces.

3. **Over-planning *may* hurt — but this is unverified, not measured.** The claim that "longer plans correlate with reduced accuracy and slower decisions" rests on one **blog** post, `advertised-elsewhere` [^6]; no controlled dose-response study was found (see `docs/reviews/reducing-llm-agent-tool-calls-followup.md` §1, correction **C1**). Treat over-planning as a plausible risk, not a result. The nearest *observed* evidence is about plan **quality and horizon** — LLM planners produce unnecessarily long, suboptimal plans, and long-horizon performance degrades — not about plan **length** lowering accuracy.

4. **Security and operational overhead are real.** Running agent-generated code demands sandboxing, resource limits, and monitoring — costs that direct tool calls avoid. Anthropic explicitly says the benefits "should be weighed against these implementation costs" [^2].

5. **Some things shouldn't be batched.** Human-in-the-loop approvals, irreversible side-effecting calls, and rate-limited APIs are the wrong candidates for fire-and-forget program execution.

6. **Debuggability.** When a 200-line generated program fails on line 140, you've traded a clean observation history for a stack trace, and re-establishing state may itself cost many round-trips.

## What actually works in practice

The pattern that consistently wins is **plan up front, but keep a replanning loop** — not plan-once-and-hope:

- **Emit a DAG, not a script, first.** Let the planner identify tasks and dependencies with placeholders, then let a non-LLM executor resolve and parallelize them [^1][^1]. This alone removes most round-trips.
- **Push per-call work into code.** Filtering, joins, pagination loops, retry-with-backoff, and conditional branching all belong in the sandbox, not in model turns [^2]. This is also better for time-to-first-token, since the sandbox evaluates the `if` rather than waiting on the model [^2].
- **Expose tools as a searchable filesystem API, not a giant tool list.** Progressive disclosure via `./servers/` navigation or a `search_tools` tool with a detail-level parameter is what produced the 98.7% reduction [^2][^2].
- **Budget for the unknowns.** Treat the up-front plan as covering the *known* work, and explicitly reserve a replanning trigger for tool failure, schema mismatch, or anomalous results [^3][^5].
- **Optimize tokens and latency, not call count.** "As few tool calls as possible" is a proxy metric. A single call returning 50,000 tokens into context is far worse than fifty calls that each return five rows. The real objectives are context tokens, wall-clock latency, and dollars — and the plan-then-execute literature reports those directly (4.65× cost reduction, 1.8–3.7× latency) [^1][^1].

## Bottom line

Your instinct is correct and the architecture you're describing is essentially the **plan-execute-decoupling + code-as-action** hybrid, with published systems (ReWOO, LLMCompiler, CodeAct, code execution with MCP) and strong measured gains. The refinement I'd push back on is the phrase "consider all edge cases up front." Comprehensive up-front edge-case enumeration is exactly the capability LLMs are weakest at, and it's where these systems fail. The robust version plans the *determinable* structure up front to eliminate round-trips, generates code for the bulk of the work, and retains a deliberate replanning path for the cases the plan couldn't foresee [^1][^3].

**References**

[^1]: [[2312.04511] An LLM Compiler for Parallel Function Calling](https://arxiv.org/abs/2312.04511) (59%)
[^2]: [Code execution with MCP: building more efficient AI agents \ Anthropic](https://www.anthropic.com/engineering/code-execution-with-mcp) (34%)
[^3]: [Replanning When Agent Execution Fails: Dynamic Plan Revision](https://agentixforce.ai/blog/replanning-when-agent-execution-fails) (3%)
[^4]: [ReWOO: Decoupling Reasoning from Observations for ...](https://www.alphaxiv.org/abs/2305.18323) (1%)
[^5]: [[2606.05806] When Tools Fail: Benchmarking Dynamic Replanning and ...](https://arxiv.org/abs/2606.05806) (1%)
[^6]: [When Longer Agent Plans Make Models Worse](https://medium.com/@duckweave/when-longer-agent-plans-make-models-worse-750bcc6ec68e) (1%) — **`advertised-elsewhere`** (blog, not a controlled study; see correction C1)