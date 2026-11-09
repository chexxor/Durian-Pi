# Research request — context budgets, handoffs, and the enforcement seam for a durable multi-seat rig (follow-up)

**Ask:** hand this to the operator's research agent. Report to `docs/reviews/task-completion-followup-research.md`.
**This is a prompt only — the delegate cannot call the research agent** (`docs/runbooks/research-request.md` Do 2).

**Status of the topic.** The milestone doc `docs/reviews/ensuring-llm-task-completion-research.md` (operator-authored,
2026-11-07) was intake-mapped in `docs/reviews/task-completion-milestone-intake-2026-11-07.md` and its three references
were fetched and quote-checked in `inputs/fetched/MANIFEST.md` §7. Per-family band arithmetic is in the intake §6. That
closes the *grounding* half. The questions below are what the tree **cannot** answer and what a research pass would add.

## Context — the system, in one paragraph

durian-pi runs a **team of LLM seats** on `pi-durable`: one single-writer **broker** drives a durable work queue in SQLite;
each **seat** is a long-lived conversation (persona + constitution) that claims queue items and edits its own git
worktree; a **delegate** operates for the human operator; a TUI/CLI are read surfaces. Two model **families** share one
rig: `local/…` (loopback, priced $0, window 200,000, 7 seats) and `verifier/…` (metered cross-family verifier, window
**24,576**, max completion 6,000, 5 seats) — the cross-family split is a deliberate anti-collusion invariant (D48/D119),
not a cost choice. Compaction is **non-destructive**: it summarizes an old prefix and appends a summary entry; raw entries
stay in the append-only store, only the model `ContextView` shrinks (D105/D107). Two decisions already in force constrain
any answer: **D105** (a fresh `pi.reset` at the cross-item boundary, so context does not carry between items) and **D107**
(intra-item compaction of tool-call history is required, repeatedly, when no clean boundary exists).

## What we measured ourselves, so you do not have to guess our numbers

- The substrate's whole context policy is **two thresholds plus one cut rule**:
  `blocking = contextWindow − reserveTokens`, `background = blocking − backgroundTokens` (0 disables), and
  `selectCut(keepRecentTokens)` which walks back from the tail and cuts at the first entry that is **not** a tool result
  (`pi-durable` at our pin: `durable/src/harness/types.ts:507-512`, `generation.ts:355-358`, `compaction.ts:279`).
  The summarizing call's own maxTokens is `min(floor(0.8 · reserveTokens), model.maxTokens)` (`compaction.ts:148-152`).
- Today those resolve to pi-durable's defaults for **every** family (`16384 / 20000 / 32768`) because of a config-nesting
  defect (ROADMAP 331), so on the 24,576-window verifier the *smallest view a compaction can leave* is
  `keep(20,000) + summary(6,000) = 26,000 > window` — a wall, not a late trigger — and its background threshold is
  **negative (−24,576)**, so a background compaction is eligible on every turn.
- Metered-arm trajectory (`usage.prompt_tokens` from the spend ledger, 841 successful calls): p50 6,460, p90 19,599,
  **max 24,358 = 99.1 % of the window**; 281 up- vs 322 down-transitions > 2 k — a sawtooth, so the charting proposal in
  the milestone doc is measurable with data we already keep. **The free arm records no trajectory at all** (the ledger is
  written at the metered provider seam only).
- What we do **not** have: any measurement of our own **floor** (system prompt + tool schemas + persona) per family; any
  measurement of what our models actually *use* well (as opposed to advertise); any actuator that can stop a seat from
  starting new work near the edge (our notice "accepts, it never decides").

## Questions — answer each, cite every external claim with URL + evidence class

1. **Measuring the effective window, cheaply, per model.** Published methods for profiling *usable* context (MECW-style)
   against a real task rather than a needle-in-haystack benchmark: what sample size, what task shape, what metric
   distinguishes "recall degraded" from "output degraded"? We can afford ≤ 20 paid calls per family (our per-family spend
   trigger is $0.50 total, currently at $0.39). Give a protocol that fits that budget or say it does not fit.
2. **Reserve vs declared output budget.** Is there any published harness rule that ties the context reserve to the model's
   declared max output (e.g. "reserve ≥ maxTokens", or truncation-prevention at the request layer)? What do practitioners
   report happens when compaction fires while a large completion is in flight? We found our own config sets
   `reserveTokens 4096` with `maxTokens 6000` at the same time and want to know whether that is a known bug class.
3. **Compaction summary budgets.** Any published guidance or measurement on how big a compaction summary should be
   relative to the window and to the kept-recent budget (`0.8 × reserve` is our substrate's constant, unchosen). What
   breaks first when the summary budget is too small — instruction drift, lost identifiers, or repeat-work?
4. **Bands as fractions vs absolute tokens, and the "no new work" band.** Find products that enforce a *work-stoppage*
   band (finish-in-flight only) rather than just compacting later: what do they call it, where is it enforced (client,
   server, agent loop), and what refusal do they show the user/model? Name any published evidence that band boundaries
   scale with the window at all — our own source says *"Context rot doesn't hit a clean threshold"*, so if nobody can
   support fraction-of-window bands, say so plainly.
5. **Write-ahead handoff in practice.** Which agent products write their handoff/state file **before** each unit of work
   rather than at the end, and how do they make it idempotent (atomic write, postcondition check, "don't redo this"
   markers)? We want the mechanism, not the essay: file format, when it is written, what validates it, and whether a
   successor is *required* to read it. `state.json` + rendered `NEXT_SESSION.md` + append-only log is the shape we are
   evaluating — where have we seen that go wrong?
6. **Resume testing.** Anyone who tests handoff continuity automatically (give a fresh agent only the handoff doc, assert
   the next N actions, treat a clarifying question as a failure): fixture design, how they avoid the test passing by
   memorizing the repo, how often it runs, what it costs per run.
7. **Trajectory for a provider that returns no `usage`.** How do practitioners get per-turn prompt-token counts from a
   local/self-hosted server (llama.cpp, llama-swap, vLLM, Ollama, TGI) or fall back to a tokenizer estimate — and what is
   the error of a tokenizer estimate against a chat template + tool schemas? We have seven seats on a loopback provider
   that reports `usage` for metered calls only, and a context policy we cannot see is a policy we cannot tune.
8. **Tool-result clearing, client- vs server-side.** Anthropic's server-side `context editing` / `clear_tool_uses` and
   comparable features elsewhere (OpenAI Codex, OpenHands, Aider, Goose, OpenClaw): what is cleared, what must survive
   verbatim (paths, identifiers, test output), and what regressions appeared when clearing dropped a constraint? We have
   an append-only store and a general `ContextEdit omit|replace` primitive, so a **store-side** clear is our shape — what
   does that cost in auditability, and has anyone published the trade?
9. **Iteration architecture of the context policy (D213 — the half of a comparison that decides our own design).** For
   each product you review: how do you change its context/compaction policy and see the effect *fast*? Piece boundaries
   and loop cost; hermetic vs live test planes; how the model is mocked or substituted in tests (a fake model, a recorded
   transcript, a replayed context view); how prompt/policy changes are regression-tested; what bounds a long agent turn;
   how slow tests are quarantined. Numbers in **seconds** wherever a product reports them.

## Deliverable

Write to `docs/reviews/task-completion-followup-research.md`. **Each section as one fenced block with no narration** —
what arrives in chat is what gets committed, and previous arrivals had the agent's narration glued to the title line.
Required sections, in order:

- `## Headline` — the three findings that change what we build, each with its evidence class.
- `## A` … `## I` — answers to questions 1–9, numbered as above. Where the answer is "no published evidence", say that in
  the first line of the section.
- `## Evidence table` — one row per citation: URL, evidence class (`observed` / `advertised-elsewhere` / `community`),
  fetch date, **and a verbatim quote of ≤ 40 words** that carries the claim. **Do not give line ranges into pages you
  fetched** — they do not survive a re-fetch and we have no file channel to your workspace; the quote + URL + your date is
  the portable unit (ROADMAP **243**, D159) and the delegate re-finds every quote in our own copy before anything is
  folded.
- `## What this does NOT answer` — the questions you could not reach.

## Constraints

Written report only; **do not modify code** and do not propose patches. Competing **products** must be named with the
version you read. Prefer primary sources (vendor engineering docs, provider API references, papers, benchmark repos) over
summarizing blogs; if you must use a blog, mark it `community`. Anything you infer about **our** system is
`internal — unverified by me` and must be labelled as such — we verify our own numbers here.

## What we will do with it

Fold accepted answers into `docs/reviews/task-completion-milestone-intake-2026-11-07.md` and its §6 arithmetic, register
proposed backlog items in `docs/ROADMAP.md` as *registered, not scheduled* (or reject each with a reason), add
`docs/COMPETITORS.md` entries for any product reviewed, and re-fetch every cited URL into `inputs/fetched/` with a
manifest row before folding (the quote-presence check happens in our copy, not yours).
