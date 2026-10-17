# Research request — context compaction for a durable multi-agent rig (follow-up)

**Ask:** hand this to the operator's research agent. Report to
`docs/reviews/context-compaction-followup.md`.

This is the **follow-up** to `docs/reviews/chat-session-compaction-best-practices.md`. That first pass
was strong but partly re-derived our own `docs/Managing_Long_Context_Length.md`; this request asks the
questions it left open, plus the durig-specific interactions it could not see.

## Context

`durig` (`Pi-OpenDurig`) is a durable, multi-seat LLM agent rig built on `pi-durable`. A
**single-writer broker** drives a cross-seat **work queue**; **seats** (LLM personas, each a long-lived
conversation) claim items and act in isolated git worktrees; a **delegate** operates on the human
operator's behalf; a **TUI/CLI** are the read surfaces. The **store** (SQLite via pi-durable) is
append-only and is already our external memory; the constitution + seat persona is a byte-stable
per-agent prefix.

**What we already believe and have planned.** `docs/Managing_Long_Context_Length.md` (landed) argues for
per-model **MECW** (maximum *effective* context window) profiling and an A/B-optimised threshold, not an
inherited default. ROADMAP items **27–30** plan: make context pressure visible per seat/model (27), expose
a `compact` verb (28a), add a fresh-conversation lever (28b), and start a fresh conversation at a cache-cold
or task boundary (30b); item **13** is the exhausted-context handover; RANK 4 (#62) is the ordered
context-pressure guard (warn → preserve-and-settle → one compaction).

**What the harness (pi-durable) actually does** — verified in our vendored tree, 2026-10-17:
- **Compaction is non-destructive**: it selects an old prefix, summarizes it, and appends a *summary
  entry* whose `head` is the first kept entry. Raw entries remain in the append-only store; only the
  model `ContextView` shrinks.
- Automatic policy default: `{ enabled: true, reserveTokens: 16384, keepRecentTokens: 20000,
  backgroundTokens: 32768 }`. Reasons: `manual | threshold | overflow`. A blocking (generation-owned)
  compaction runs inline; a conversation-owned one is `background` unless manual, and places its summary
  through a **write submission** at the next boundary.
- Exposed primitives: `Conversation.compact(instructions)`, `Conversation.reset(handoff)`,
  `Conversation.fork(at, options)`. durig exposes none of these yet; `reset` is the only context-reducing
  surface.

**Grounded facts that make some questions urgent (verified in our tree, 2026-10-17):**
- `cli.mjs:320` inherits pi-durable's default `CompactionPolicy` deliberately.
- `src/providers/deepinfra-models.ts:156,166` sets **`contextWindow: 1_048_576`** for
  `deepseek-ai/DeepSeek-V4.1-Flash` and `zai-org/GLM-5.3-Flash`. With the default reserve, the automatic
  threshold is ~1.03M tokens — effectively unreachable, while the first research says quality degrades
  long before.
- `rig.selfdev.json` sets `thinkingLevel: "high"` on 5 DeepSeek seats (D80), and pi-ai stores thinking
  blocks with a replayable `thinkingSignature`.
- Coordinator seats (`pm`, `lead`) have **no file tools** (gap B1 / #156), so a fresh coordinator session
  cannot re-read the store or docs on its own.

## Questions

Answer each from external evidence where possible; where a question is about *our* code/behaviour and is
not externally answerable, say so explicitly and mark it **internal — unverified** rather than guessing.

**A. Trigger and measurement (keystone — determines whether ROADMAP 28a/28b are even reachable)**
1. What does the literature/practice say about how *late* auto-compaction can fire before quality
   degrades, per model family — specifically for **DeepSeek-V4/GLM-class Chinese open-weights** models?
   Do the first pass's sources (Chroma's 18-model study, *Context Compaction Theory*) cover these, and
   what MECW-style numbers exist?
2. Given a nominal 1M-token window, what do practitioners actually treat as the effective working budget,
   and how do they discover it cheaply? (We have an MECW recipe; is there a lower-cost accepted method?)
3. Is there evidence that a *provider-advertised* 1M window is not actually served (or degrades sharply),
   for DeepSeek/GLM on DeepInfra-class hosts? **internal cross-check:** is our 1M `contextWindow` real?

**B. Reasoning / thinking tokens and prompt cache (durig-specific; the first pass is silent)**
4. Do **reasoning/thinking tokens** count toward the effective window, and do providers expect reasoning
   to be **replayed** in later turns? What is the recommended handling of `reasoning_content` /
   thinking blocks for DeepSeek and GLM specifically (keep, drop, or summarize)?
5. Should the **summarizer** run at a low/zero thinking level and/or on a cheaper model than the seat?
   Evidence on summary quality vs summarizer capability/cost.
6. How does **compaction interact with prompt caching**? What is the measured cost of invalidating a
   byte-stable prefix, and is "compact only at cache-cold/task boundaries" established practice?

**C. Safety with our guards and lifecycle**
7. **Degeneration:** the Complexity Trap found summaries can act as a reinforcing signal and remove the
   agent's stop condition. Is there evidence on compaction *re-triggering or masking* a repetition loop,
   and should compaction be blocked for an already-degenerate agent?
8. **Uncommitted work:** compaction mid-task can lose artifact tracking (Factory's finding). Is it
   established practice to **forbid compaction while an item has uncommitted work**, i.e. only at
   task/work-item boundaries? What do coding agents do?
9. **Concurrency / serving:** does a background/threshold compaction consume a scarce generation slot?
   What is the recommended scheduling so compaction never starves or deadlocks a live run (especially on
   a single local GPU with one concurrency slot)?
10. **Compaction as a write submission:** pi-durable places a conversation-owned summary through a write
    submission at the next boundary. Is there prior art on the hazards of a *summary-submission* racing a
    normal task/submission (reading as "in flight", being reconciled as stranded)? **internal** to verify
    in our broker.

**D. What survives / verifier independence**
11. Prior art on the **verifier-independence** rule (a verifier must not inherit the author's summary).
    How is it enforced in multi-agent harnesses? What is the evidence that inheriting anchors the review?
12. **Fork vs isolate** context modes: LangChain's `deepagents` rule (worker=fork, verifier/researcher=
    isolated) — is there broader evidence or counter-evidence? What are the measured costs of forking?
13. Should a **retry / re-wake of a failed attempt** inherit or isolate the failed context? Evidence.
14. **Structured handoff**: is the `Goal / Approach / Current Status / Next Steps / Key Files` shape
    (or a variant) an established, machine-parseable schema? Recommended field set and length bounds for
    handoffs between agents/sessions.

**E. Our store advantage (may dissolve the first pass's biggest worry)**
15. "External memory is the only layer that survives a boundary" — prior art on **re-deriving state from
    an append-only durable store** instead of a summary ("context offloading", external memory). What are
    the failure modes when the store is authoritative and the model context is a *view*?
16. Is summarise-in-place (head marker, raw entries retained) an accepted pattern, and is there guidance
    on when to prefer it over a fresh session?

**F. Cheapest layer and evaluation**
17. **Masking / tool-result clearing**: what are the standard implementations and exact rules (what is
    cleared; invariants such as never clearing a tool result whose call is still open; interaction with
    errors/resolved items)? Is per-entry clearing a known primitive in pi-durable-style harnesses?
    **internal** to confirm what pi-durable exposes (`ContextView.contributions` mentions "after edits
    and excluded stop reasons").
18. **Evaluation**: the standard probe set for compaction (recall / artifact / continuation / decision),
    grading method, and how to build a **replay** harness from an append-only transcript store. What are
    sensible alert thresholds, and is artifact-tracking the most sensitive metric in practice?
19. **Repeated-compaction error accumulation**: published evidence on how many chained compactions before
    quality collapses, and mitigations (compaction-count caps, forced fresh session, hierarchical
    summaries).
20. **Cost budgeting**: does the "15× tokens for multi-agent" figure hold for a broker-driven queue of
    long-lived seats? Recommended per-seat/session compaction budgets and observability fields.
21. **Secrets/PII**: guidance on redacting credentials/PII before summarizing, and whether a compaction
    summary is a known leak vector.
22. **Coordinator/no-tool agents**: how do systems whose agents *cannot read files* provide durable memory
    (injected state, tool access, or a boot contract)? This is our B1/#156 gap.

## Deliverable

`docs/reviews/context-compaction-followup.md`, with:

- A per-question answer, each grounded in an external source with a **URL** and an **evidence class**
  (`advertised-elsewhere` vs `observed`), or explicitly marked **unverified / internal**.
- A recommended **threshold policy** (effective-window basis, model-specific), and whether the platform
  default should be overridden or the guard (#62) should be authoritative.
- A recommended **cheapest-first ordering** (mask → summarize → fresh session) and whether the masking
  layer is available to us.
- A recommended **verifier/re-wake isolation** policy and the fork-vs-isolate rule for our roles.
- A recommended **evaluation design** (probes + replay from the append-only store) and acceptance tests
  for the `compact` verb and the fresh-conversation lever.
- Proposed **ROADMAP items** for durig (registered, not scheduled) and any correction to items 27–30.
- An explicit list of anything you **could not verify**.

## Evidence discipline

- Every external claim cites a **URL** and states its class (`advertised-elsewhere` vs `observed`).
- Map every finding either to a concrete durig mechanism (`src/broker.mjs`, `cli.mjs`, the store, the
  broker loop) or name it **unverified**.
- Do not present the first pass's conclusions as settled where this request asks for deeper evidence.

## Constraints

- **Written report only; do not modify code.**
- Baseline to read: `docs/reviews/chat-session-compaction-best-practices.md`,
  `docs/Managing_Long_Context_Length.md`, `docs/ROADMAP.md` items 13, 27–30 and RANK 4 (#62),
  `docs/BROKER-SUPERVISION.md`, and the vendored pi-durable `compaction.d.ts` / `types.d.ts`.
- Prefer primary sources (papers, provider docs, first-party engineering blogs) over aggregators; say when
  a claim rests on a community report rather than a controlled result.
