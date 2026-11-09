I can't write into your tree from here, so the report body is below, section by section, in the shape you specified. Everything about durian-pi itself is marked `internal — unverified by me`; I did not read your pin, your §6, or your ledger.

```
## Headline

1. The reserve defect you found is a named, reproduced bug class upstream, and upstream declined to fix it: pi #8651 reports the fixed `reserveTokens 16384` producing a negative budget on small windows, and it was closed "not planned". Your 4096/6000 is the same class at a milder magnitude. Consequence: the invariant has to be enforced in durian-pi's config layer, because there is no upstream fix coming. [community — GitHub issue, primary artifact]
2. The best-documented long-horizon harness does NOT write its handoff before each unit. Anthropic's initializer/coding-agent harness writes `claude-progress.txt` at session end, commits to git per feature, and carries machine-checkable state in a JSON feature list whose only legal edit is a `passes` boolean — JSON was chosen explicitly because the model is less likely to overwrite it than Markdown. The transferable finding is the format and the validation, not the timing. [observed — vendor engineering doc]
3. No product I could find enforces a work-stoppage band as a fraction of the window, and no vendor publishes evidence that band boundaries scale with the window. What exists instead is an iteration/turn budget followed by a tool-stripped closing call (Hermes), and error-triggered recovery (Claude Code's reactive compaction after `prompt_too_long`). Anthropic states the degradation is "a performance gradient rather than a hard cliff". [observed — vendor doc + third-party source analysis]
```

```
## A — Measuring the effective window, cheaply, per model

No published protocol fits ≤20 paid calls per family for a degradation curve, and the reason is statistical, not financial. MECW-style work (Paulsen's Maximum Effective Context Window, defined as the length at which task accuracy falls below an acceptable threshold) and benchmarks like RULER and NoLiMa all estimate a curve across several lengths with multiple samples per length. At n≈6 per condition, a 95% interval on a proportion is roughly ±40 points; you cannot place a threshold, you can only detect a grossly misplaced one.

What 20 calls CAN do — and this is the version I would run. Three conditions on one task shape: floor-only, floor+8k, floor+16k, with 6/6/8 samples. Plant three verbatim identifiers (a function name, a path, a numeric constant) at 10%, 50% and 95% depth in filler, none of them derivable from repo state. Score two things per call, not one: (a) does the required artifact validate mechanically, (b) are the identifiers reproduced exactly. Recall failure with a valid artifact is context rot; an invalid artifact with identifiers intact is capacity or truncation. That two-axis score is the part most public evals omit, and it is the only way to separate "recall degraded" from "output degraded" without a long curve.

Honest limits: this detects "the window is much smaller than advertised", not "the effective window is X". For a 24,576-window family you already have the cheaper signal — your own ledger's p50/p90/max trajectory. Label the whole of this section `internal — unverified by me` where it touches your numbers.

The one primary measurement you are missing is the floor: one call with an empty message list, read `usage.prompt_tokens`. Do that before any of the above, per family. It converts every later budget question from a fraction of a declared window into arithmetic over a known constant.
```

```
## B — Reserve vs declared output budget

Yes, this is a known bug class, and the arithmetic is published in the issue trackers rather than in vendor docs. The workable rule people converge on is `usable = window − max(reserve, max_output)`; a reserve smaller than the declared completion budget is not a reserve, because the completion lands after the prompt is sized. Your `reserveTokens 4096` with `maxTokens 6000` under-reserves by 1,904 tokens on every turn where a maximal completion is requested — and the failure is silent until exactly the turn you cannot afford it.

The upstream case is worse and better documented: pi #8651 shows a fixed 16,384 reserve against an 8,192 window producing `contextTokens > contextWindow - reserve` on essentially every turn, i.e. compaction that fires constantly and a summarization request that itself overflows. The reporter's proposed guard — clamp the effective reserve to a fraction of the window — is the shape I would copy; note the issue was closed without action, so the guard has to live on your side.

On "compaction fires while a large completion is in flight": the documented practitioner answer is that systems do not prevent it, they recover from it. Anthropic's SDK compaction, when it triggers with a tool use pending, removes the tool use block and lets the model re-issue the call after resuming. Claude Code escalates the output cap up to three times per turn when a response hits the limit, and runs reactive compaction after a `prompt_too_long` error. Treat the request-layer truncation guard and the compaction trigger as two separate mechanisms that both need to exist.

The invariant worth writing down explicitly, for a 24,576 window: `keep_recent + summary_max + max_tokens + turn_growth ≤ window`. With your current verifier defaults (keep 20,000 + summary 6,000) the left side is already 26,000 before any output — a wall, not a late trigger, exactly as your intake says. `internal — unverified by me`.
```

```
## C — Compaction summary budgets

No published guidance ties the summary budget to the window as a fraction. What is published is an observed output: Anthropic's compaction example returns a conversation from ~100k tokens to roughly 2–3k of structured summary — 2–3% of the window, and it does not scale with window size. On a 24,576 window that same absolute size is 8–12%. Your `min(0.8 × reserve, model.maxTokens)` constant is therefore not a published number at any scale; it is a substrate choice, and at reserve 4096 it resolves to ~3,277 tokens, which is in the same absolute range as Anthropic's 2–3k by coincidence rather than by design.

What breaks first, in the order the mechanism predicts: (1) identifiers and paths — anything that cannot be re-derived from repo state, because the summarizer has no reason to know they are load-bearing; (2) instruction drift, because a summary is model prose re-entering as context rather than as system prompt; (3) repeat work, because "tried X, it failed because Y" is exactly the content a summarizer judges superfluous.

Two findings that change the design rather than the constant: Anthropic's advice is to tune the prompt for recall first and precision second, and Claude Code's summary step is a blocking inference stall that is non-deterministic — retained content fluctuates across runs on identical inputs. If the summary is non-deterministic, nothing load-bearing may exist only inside it. Identifiers belong in the store or the state file, and the summary should be allowed to lose them because it is not the last copy.
```

```
## D — Bands as fractions vs absolute tokens, and the "no new work" band

No published product enforces a token-band work-stoppage rule, and no vendor publishes evidence that band boundaries scale with the window. Say it plainly in the intake: the band is your design choice, not a borrowed result.

What exists and is adjacent:
- Iteration budgets with a closing call. Hermes gates its loop on an iteration count and a separate budget, and on exhaustion makes a single tool-stripped summary call so the agent can deliver a closing message rather than terminate mid-thought. That is the closest published thing to a wrap-up band, and it is counted in iterations, not tokens.
- Turn limits and error-triggered recovery. Claude Code has `maxTurns`, reactive compaction after `prompt_too_long`, and a five-shaper pipeline that runs before every call so that the expensive summary is attempted only after four cheaper reductions have failed.
- Pre-compaction prompting. OpenClaw reminds the agent to save notes to memory files before compaction — a warning, not a refusal, which is the same "accepts, never decides" shape you already have and have correctly identified as insufficient.

Why fractions are the wrong axis for you specifically: two families with windows 200,000 and 24,576 differ by 8× in window but far less in floor, and their `maxTokens` is fixed at 6,000 rather than proportional. A 10% band is 20,000 tokens on one seat and 2,458 on another — the second is below the completion budget. Bands should be absolute, per family, computed as `floor + max_tokens + k`, and re-derived whenever the floor moves.

Enforcement point: your actuator gap ("the notice accepts, it never decides") is answerable without touching the model. Refuse at claim time — the broker declines to dequeue a new item for a seat whose last measured view exceeds the band, and the queue reports the refusal as a seat state. That makes "no new work" a broker decision with an audit row, not a sentence in context that the model may ignore. `internal — unverified by me`.
```

```
## E — Write-ahead handoff in practice

No product I could read writes its handoff before each unit of work. The best-documented one writes at the end of the session and gets idempotency from two other mechanisms, which is the finding worth folding.

Anthropic's long-horizon harness: an initializer session writes `init.sh`, `claude-progress.txt`, and an initial git commit; each later session reads the progress file and the git log, runs a basic end-to-end check before starting anything new, works on exactly one feature, then ends with a commit and a progress update. The state that survives is a JSON feature list of 200+ items, each with a `passes` boolean, and the model is instructed to change only that field. The stated reason for JSON over Markdown is that the model is less likely to overwrite it. The stated reason for the whole apparatus is a specific failure: running out of context mid-implementation, "leaving the next session to start with a feature half-implemented and undocumented", after which "the agent would then have to guess at what had happened".

Mechanism, concretely: file format JSON (machine-checkable, overwrite-resistant); written at end of session plus every commit; validated by git history and by re-running the startup test; successor required to read it as step 2 of a fixed ritual. Idempotency comes from the commit boundary and the boolean, not from a postcondition clause in prose.

Where your shape (`state.json` + rendered `NEXT_SESSION.md` + append-only log) goes wrong: the rendered file is a second writable representation of the same truth. If the model can edit both, they drift and the successor cannot tell which is authoritative. Make the rendered doc derived and write-protected, keep `state.json` as the only writable surface, and let the log be append-only. This is consistent with your D105/D107 non-destructive design; the divergence to avoid is between *two mutable* state surfaces, not between store and view.
```

```
## F — Resume testing

No published suite tests handoff-doc continuity the way you describe — fresh agent, doc only, assert next N actions, clarifying question is a failure. The nearest published artifact is a 2026 study, "Resume Means Resume", which tests checkpoint-and-resume behaviour of workflow frameworks against their stated semantics; it is a conformance test for resume, not for handoff documents.

Design that fits your constraints, with the anti-memorization fix that matters:
- Fixture: repo at commit N, plus the doc, nothing else. Assert the agent's first three tool calls fall in an allowed set (a set, not a sequence — ordering is not the property under test).
- Anti-memorization, two mechanisms. First, mutate the repo between writing and resuming: rename one file the doc names, flip one test's expected value. An agent that memorised the repo's current shape now fails; an agent that read the doc adapts. Second, ensure at least one fact in "Next action" is derivable only from the doc and not from the repo (a decision, a dead end, a "don't redo this" marker).
- Cost: one generation at the floor plus the doc. On the 24,576 family that is bounded and cheap; run per-commit in CI, not per-session.
- Frequency: on every change to the handoff template or to the compaction policy, and nightly otherwise. A pass that only ever runs manually stops being a test.

Treat a clarifying question as a failing assertion, as you proposed — that is the whole point of the fixture.
```

```
## G — Trajectory for a provider that returns no usage

Two routes, both real. Server-side: vLLM returns per-request timing metrics in API responses and exposes request-level Prometheus histograms; llama.cpp's `/metrics` is off by default and enables with `--metrics`, returning Prometheus text with counters that accumulate in-process and reset on restart — so per-request deltas require diffing consecutive scrapes, and a restart is a discontinuity you must mark.

Client-side fallback: tokenize the `ContextView` yourself with the server's tokenizer, and calibrate at two anchor points. The general lesson from Claude Code's implementation is more important than either route: its context-size counter reads the `usage` field of the most recent assistant message, and a snip shaper that frees tokens is *invisible* to that counter unless its savings are plumbed through explicitly — the source has a dedicated field for exactly this. If your store-side `ContextEdit omit|replace` shrinks the view without recomputing the counter, both thresholds are computed from a number that no longer describes the request.

The error of a tokenizer estimate against a chat template plus tool schemas: no published measurement found. Do not quote one. Measure your own error once per family by comparing your estimate to the one number the metered arm does return, and record it as a per-family constant with a date. `internal — unverified by me`.
```

```
## H — Tool-result clearing, client- vs server-side

Anthropic's implementation is the clean statement of the split you are evaluating: clearing happens server-side before the prompt reaches the model, and the client keeps the full unmodified history and does not sync it. Cleared results are replaced with placeholder text that says something was removed; the tool *call* survives by default (`clear_tool_inputs` defaults to false), so paths, commands and arguments — the identifiers a successor needs — stay verbatim while the bulk output goes. Configuration is trigger / keep-N / `clear_at_least` / `exclude_tools`, with `clear_at_least` existing solely to justify breaking the prompt cache.

What must survive verbatim, therefore: the call record (tool name, path, command, arguments), and any result the model is required to quote. What may go: bulk file contents, search dumps, verbose test output, anything re-fetchable by re-running the call.

The auditability trade, which is your actual question: Anthropic's answer is that the divergence is *reported*, not hidden — the response carries `applied_edits` with `cleared_tool_uses` and `cleared_input_tokens` per strategy. That is the pattern to copy for a store-side clear: the omit must emit an audit entry in the same commit as the view change, so "what the model saw" is reconstructable per turn. Your append-only store makes this cheap and is the reason a store-side clear is the right shape for you.

Known regressions: cache invalidation on every clear (irrelevant on loopback, relevant on the metered arm), and the interaction with server-side tools where cache-read accounting makes thresholds fire early. Anthropic's documented mitigation is to use the token-counting endpoint rather than the usage fields for sizing.
```

```
## I — Iteration architecture of the context policy

Claude Code: five shapers run in fixed order before every model call — per-result budget reduction, snip, microcompact, read-time context collapse, and auto-compact last — with auto-compact firing only when the earlier four did not bring the view under the pressure threshold. Because each shaper is a function over the message array returning `{messages, tokensFreed, boundary}`, the policy is testable hermetically; the failure the paper documents is exactly the accounting seam: shapers that free tokens without plumbing `tokensFreed` into the counter. Recovery is separate: reactive compaction after `prompt_too_long`, attempted at most once per turn.

Hermes: iteration cap plus iteration budget, with a closing call on exhaustion.

Seconds: no product reviewed publishes a per-test or per-iteration wall time, so I cannot give you the numbers §9 asks for. Say "not reported" in the intake rather than estimating.

Cheapest architecture for you, given `selectCut` is a pure function: hermetic plane with fixture entry arrays asserting the cut point and the resulting view size; a replay plane that feeds recorded `ContextView`s from the store through the policy and asserts the shaper's `tokensFreed` equals the measured delta; and one live plane call per family, tagged as costly and quarantined from the default test run. The replay plane is the piece most products lack and the one that would have caught the snip counter bug.
```

```
## Evidence table

| # | URL | Class | Fetched | Verbatim quote (≤40 words) |
|---|---|---|---|---|
| 1 | https://platform.claude.com/docs/en/build-with-claude/context-editing | observed | 2026-11-07 | "Context editing is applied server-side before the prompt reaches Claude. Your client application maintains the full, unmodified conversation history." |
| 2 | https://platform.claude.com/docs/en/build-with-claude/context-editing | observed | 2026-11-07 | "The API replaces each cleared result with placeholder text indicating to Claude that it was removed." |
| 3 | https://platform.claude.com/docs/en/build-with-claude/context-editing | observed | 2026-11-07 | "Use the token counting endpoint to get accurate context length." |
| 4 | https://platform.claude.com/docs/en/build-with-claude/context-editing | observed | 2026-11-07 | "When the SDK triggers compaction while a tool use response is pending, it removes the tool use block from the message history before generating the summary." |
| 5 | https://platform.claude.com/docs/en/build-with-claude/context-editing | observed | 2026-11-07 | "After compaction (back to ~2–3k tokens)" |
| 6 | https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents | observed | 2026-11-07 | "Context, therefore, must be treated as a finite resource with diminishing marginal returns." |
| 7 | https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents | observed | 2026-11-07 | "These factors create a performance gradient rather than a hard cliff" |
| 8 | https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents | observed | 2026-11-07 | "The agent can then continue with this compressed context plus the five most recently accessed files." |
| 9 | https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents | observed | 2026-11-07 | "Start by maximizing recall to ensure your compaction prompt captures every relevant piece of information from the trace, then iterate to improve precision" |
| 10 | https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents | observed | 2026-11-07 | "Each subagent might explore extensively, using tens of thousands of tokens or more, but returns only a condensed, distilled summary" |
| 11 | https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents | observed | 2026-11-07 | "we landed on using JSON for this, as the model is less likely to inappropriately change or overwrite JSON files compared to Markdown files" |
| 12 | https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents | observed | 2026-11-07 | "ask the model to commit its progress to git with descriptive commit messages and to write summaries of its progress in a progress file" |
| 13 | https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents | observed | 2026-11-07 | "leaving the next session to start with a feature half-implemented and undocumented" |
| 14 | https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents | observed | 2026-11-07 | "The agent would then have to guess at what had happened, and spend substantial time trying to get the basic app working again." |
| 15 | https://github.com/earendil-works/pi/issues/8651 | community | 2026-11-07 | "It is not scaled against the model's actual context window, so on small local models it can exceed the whole usable budget." |
| 16 | https://github.com/earendil-works/pi/issues/8651 | community | 2026-11-07 | "shouldCompact fires when contextTokens > contextWindow - reserve, and branch summarization uses tokenBudget = contextWindow - reserve." |
| 17 | https://arxiv.org/html/2604.14228v3 | observed | 2026-11-07 | "Auto-compact fires only when the context still exceeds the pressure threshold after all four previous shapers have run." |
| 18 | https://arxiv.org/html/2604.14228v3 | observed | 2026-11-07 | "a single tool-stripped summary call lets the agent deliver a closing message rather than terminate mid-thought" |
| 19 | https://arxiv.org/html/2604.14228v3 | observed | 2026-11-07 | "the summarization step is a blocking inference stall, and it is non-deterministic, with the retained content fluctuating across runs on identical inputs" |
| 20 | https://arxiv.org/html/2604.14228v3 | observed | 2026-11-07 | "the main token counter derives context size from the usage field on the most recent assistant message" |
| 21 | https://arxiv.org/html/2604.14228v3 | observed | 2026-11-07 | "After a prompt-too-long or oversized-media error, the loop can attempt reactive compaction and retry the request if recovery succeeds." |
| 22 | https://arxiv.org/html/2604.14228v3 | observed | 2026-11-07 | "Before compaction, OpenClaw automatically reminds the agent to save important notes to memory files, preventing context loss." |
| 23 | https://docs.vllm.ai/en/latest/features/per_request_metrics/ | observed | 2026-11-07 | "vLLM can return per-request timing metrics directly in API responses." |
| 24 | https://www.simplified.guide/llama-cpp/server-enable-metrics | community | 2026-11-07 | "The metrics endpoint is disabled by default and turns on when llama-server starts with --metrics." |
| 25 | https://github.com/tontinton/maki/issues/301 | community | 2026-11-07 | "Reserve response headroom, not just a spare buffer: usable = window - max(output, reserve)" |
| 26 | https://www.researchgate.net/publication/400858436_Context_Is_What_You_Need_The_Maximum_Effective_Context_Window_for_Real_World_Limits_of_LLMs | community | 2026-11-07 | "the context length at which model task accuracy degrades below an acceptable threshold" |
```

```
## What this does NOT answer

- A protocol for placing the effective window with ≤20 calls. It does not exist in the literature I found, and 20 calls cannot place a threshold. §A gives a hypothesis test instead, and says so.
- Any vendor statement on reserve-vs-max-output as a rule. The arithmetic exists in issue trackers only; both citations are `community`. Treat §B's invariant as derived, not published.
- Any published fraction for compaction summary size, and any measurement of what breaks first. §C's ordering is inferred from the mechanism plus Anthropic's warning about losing "subtle but critical context"; the ordering itself is unmeasured.
- Any product with a token-band work-stoppage rule, and any evidence bands scale with the window. §D's broker-refusal design is mine, `internal — unverified by me`.
- Any product that writes a handoff before each work unit. If one exists, I did not find it; §E reports only the end-of-session harness.
- Any published automated resume test for handoff docs. "Resume Means Resume" tests frameworks against their own resume semantics, not documents against successors.
- Any measured tokenizer-estimate error against a chat template plus tool schemas. §G recommends measuring your own; do not import a number.
- Any wall-clock seconds for policy iteration. No product reviewed reports them, so §I's numbers-in-seconds requirement is unmet by construction.
- Anything about your tree: I did not read `docs/reviews/task-completion-milestone-intake-2026-11-07.md` §6, `ROADMAP` 331/243, the pin, or the spend ledger. Every claim about your arithmetic is labelled and needs your verification before it is folded.
- Version pinning for two of the three products: I read Claude Code via the arXiv analysis of v2.1.88 and pi via issue text at v0.84.2, not the products' own docs at a version I selected.
---

## Delegate fold note (added 2026-11-07T05:4xZ — NOT part of the report body, which stays verbatim)

The report arrived as text in this file with no fetched corpus (the research agent is not on this machine and has no write
access here — `inputs/fetched/README.md`). Verification, in the shape `inputs/fetched/README.md` requires:

- **Fetched by the delegate at 2026-11-07T05:15:39Z–05:15:43Z**: 8 of the 9 cited URLs returned HTTP 200; the ninth,
  the ResearchGate MECW publication, returned **403** (host refused). Pins (bytes + sha256 + fetch time) and the per-quote
  verdicts are in `inputs/fetched/MANIFEST.md` §8; the copies ship in `inputs/fetched/`.
- **25 of the report's 26 verbatim quotes were located in our copies** by exact substring search after entity
  normalization (`.spike/delegate-20261107/quote-check-followup.mjs`). Quote 26 — the MECW definition — is recorded
  **`unverified`**: the only quote we cannot fetch is also the one whose paper we could not open.
- `node tools/review-cite-check.mjs --gate` now reports one more finding, at this file's evidence-table row for the
  ResearchGate URL: `MANIFEST records HTTP 403 for this URL … a dead URL in an evidence table reads as evidence
  (ROADMAP 243)`. **It is deliberately left unsuppressed.** The gate is right: that row is a citation a reader cannot open.
  Treat every claim in §A that leans on MECW as resting on the report's word, not on a checked source.
- Two corrections when folding (detail in `docs/reviews/task-completion-milestone-intake-2026-11-07.md` §8.3):
  `min(floor(0.8 × 4096), 6000)` = **3,276** (not ~3,277); and `clear_tool_inputs` is in the **context-editing doc**, not in
  the arXiv analysis the report cited for it.
- The one claim that touches our arithmetic and needed our own measurement — the "floor" — is now measured for both families
  (intake §8.2): 53 / 55 prompt_tokens at the empty turn, **358–1,248** with real seat instruction files, which **refutes the
  milestone's "often 5–15k" prompt floor on this rig**, with the caveat that tool schemas are excluded from that number.
