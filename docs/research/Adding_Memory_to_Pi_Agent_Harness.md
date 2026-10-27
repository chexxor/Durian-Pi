# Adding Memory to Pi Agent Harness

*Created: 10/27/2026, 3:05:44 AM*

---

**You**

I want to add a memories component of functionality to my pi agent harness which has no extensions yet. What do you recommend is effective, private, easy to set up/install, and practices good secure practices.

---

**Assistant**

## Short answer

Start with **[pi-memory](https://pi.dev/packages/pi-memory)** (`pi install npm:pi-memory`). It's the best fit for "effective + private + easy + secure" for a harness with no extensions yet: a single-file, zero-dependency, MIT-licensed TypeScript extension that writes plain markdown into `~/.pi/agent/memory/`, needs no daemon, no database, and no network calls, and works immediately after install [^1] [^1].

It's also the de-facto default: ~43.5K downloads/month and the most popular memory extension in the official package directory [^986e0b#11] [^986e0b#27].

---

## How it works (why it fits your criteria)

| Requirement | How pi-memory delivers |
|---|---|
| Effective | Three tiers injected before each turn: open scratchpad (2K chars), today's log (3K), `MEMORY.md` (4K), yesterday's log (3K), capped at 16K total [^1]. Plus six tools: `memory_write`, `memory_read`, `memory_forget`, `memory_restore`, `scratchpad`, `memory_status` [^1], and automatic session handoff on compaction [^1] |
| Private | Everything is local markdown on disk; no service, no account, no telemetry, zero npm dependencies [^986e0b#11] [^986e0b#196] |
| Easy | One command, no config; search is opt-in via `qmd` and auto-configures itself [^1] |
| Secure-ish | Recoverable deletes with a recovery ID, size-capped tool previews, graceful degradation if `qmd` is missing [^1] |

Setup:

```bash
pi install npm:pi-memory@0.4.2     # pin the version, don't float
# optional, later: search (BM25 ~30ms, semantic ~2s, hybrid ~10s)
npm install -g @tobilu/qmd
```

Then in a session, run `memory_status` to confirm paths and state [^1]. If you want Linux-style local-only embeddings, `qmd`'s default model runs locally; the first `qmd embed` downloads the model once [^1].

Two knobs worth setting on day one:

- `PI_MEMORY_DIR` — point it somewhere outside any git repo you push (default `~/.pi/agent/memory`) [^986e0b#208].
- `PI_MEMORY_EXIT_SUMMARY=0` — makes quitting instant and avoids an extra LLM call at shutdown [^986e0b#214].

---

## The alternatives, and when they're better

| Package | Storage / deps | Best for | Why I'd hold off |
|---|---|---|---|
| **[pi-memory](https://pi.dev/packages/pi-memory)** (jayzeng) | Markdown, 0 deps, MIT | Default pick; human-readable, greppable, commit-friendly | Injects up to 16K chars into the system prompt every session — cost + exposure surface |
| **[pi-mem](https://github.com/jo-inc/pi-mem)** (jo-inc/skyfallsin) | Markdown, no embeddings, MIT | Absolute minimum: three tiers, injected every turn, no vector DB at all [^2] | Less search sophistication; pi-memory credits it as inspiration and supersedes it [^986e0b#29] |
| **[pi-agent-memory](https://pi.dev/packages/pi-agent-memory)** | claude-mem worker on `localhost:37777`, SQLite + FTS5 + Chroma, AGPL-3.0 | You already run claude-mem and want cross-engine memory with Claude Code/Cursor/Codex [^3] | Needs a second always-on service; records **every tool call** and AI-compresses sessions, so session content flows to a model [^3]. AGPL, and only ~185 downloads/mo [^18e5bf#13] |
| **[@cortexkit/pi-magic-context](https://www.npmjs.com/package/@cortexkit/pi-magic-context)** | SQLite at `~/.local/share/cortexkit/`, 7 deps, MIT | You want memory *and* context compaction in one engine (historian + "dreamer" consolidation, cross-harness with OpenCode) [^4] | Much larger blast radius: background subagents spawn model calls, 121 versions in rapid flux, requires Pi ≥ 0.74 [^4] [^4] |

Decision rule: **one harness, want simple → pi-memory. Multi-harness → claude-mem adapter or magic-context.** Don't install two memory extensions; they'll both inject into the prompt and fight.

---

## Security practices that actually matter here

The threat model for Pi extensions is blunt: an extension runs **in the Pi process with the same OS permissions**, and can read prompts, tool calls, files, credentials, and session history [^5]. Memory extensions are worse than average because they persist model-written text and re-inject it into the system prompt forever.

1. **Review before install, and pin.** Pi itself warns that packages execute code and influence behavior [^986e0b#21]. Prefer a single-file extension you can read in one sitting (`index.ts`, no build step [^986e0b#262]) over a 7-dependency tree. Install with an exact version: `pi install npm:pi-memory@0.4.2` — versioned npm specs are pinned [^7adf58#54].
2. **Trial without committing.** `pi -e npm:pi-memory` loads it for one invocation without writing to `~/.pi/agent/settings.json` [^6]. Good first-extension hygiene.
3. **Treat memory as "will be sent to your model provider."** Whatever lands in `MEMORY.md` is prepended to the system prompt every session [^1]. So the real privacy boundary isn't disk — it's your inference provider. Instruct the agent explicitly: never memory-write API keys, tokens, `.env` contents, customer data, or internal URLs. This is the single highest-value control.
4. **Memory poisoning is the novel risk.** Memory is model-writable text that becomes system-level context. A malicious README, web page, or tool output can talk the agent into writing an instruction into `MEMORY.md`, and it persists across sessions. Mitigations: read `MEMORY.md` weekly (it's 50 lines, it's markdown), keep the scratchpad short, and don't enable aggressive auto-summarization you won't review.
5. **Lock down file permissions.** `chmod 700 ~/.pi/agent/memory && chmod 600 ~/.pi/agent/memory/*.md`. Plain markdown is a feature — but it's also readable by anything running as you.
6. **Be careful with "forget."** `memory_forget` writes the full deleted payload to `recovery/<id>.json` before deleting [^1]. Great for accidental deletions, wrong for secrets — after forgetting a credential, delete the recovery file too.
7. **Don't grant project trust casually.** Project-scoped packages and `.pi/settings.json` only load after project trust, which is exactly the gate that stops a cloned repo from executing extension code; review declarations before granting [^6].
8. **Keep the scope small.** If you'll only work in one repo, prefer `PI_MEMORY_DIR` per project rather than one global memory that leaks context between clients. And skip cloud embedding providers — either `qmd`'s local model or no semantic search at all.
9. **Back up, but deliberately.** Markdown + git is ideal (`~/.pi/agent/memory` → private repo or restic). Just never a public repo — memory files routinely accumulate paths, hostnames, and business context.

## Suggested rollout

1. `pi -e npm:pi-memory` for a day, confirm recall actually helps.
2. `pi install npm:pi-memory@0.4.2`, set `PI_MEMORY_DIR` and `PI_MEMORY_EXIT_SUMMARY=0`, `chmod` the directory.
3. Add a line to your global `AGENTS.md`: *"Never store secrets, credentials, or customer data in memory. Ask before writing durable facts."*
4. Add `qmd` only once keyword recall feels insufficient — it's the only part that adds a moving piece.
5. Revisit if you later add a second harness (then look at the claude-mem adapter) or want compaction handled by the same engine (then magic-context).

**References**

[^1]: [pi-memory · Packages · Pi](https://pi.dev/packages/pi-memory) (45%)
[^2]: [surprisingly useful plain-md memory for the pi coding agent](https://pradeep.md/2026/02/11/pi-mem.html) (4%)
[^3]: [pi-agent-memory · Packages · Pi](https://pi.dev/packages/pi-agent-memory) (14%)
[^4]: [@cortexkit/pi-magic-context - npm](https://www.npmjs.com/package/@cortexkit/pi-magic-context) (28%)
[^5]: [Extensions · Documentation · Pi](https://pi.dev/docs/latest/extensions) (4%)
[^6]: [Pi Packages · Documentation · Pi](https://pi.dev/docs/latest/packages) (6%)

---

**You**

What does academic research and industry research say on the effectiveness of memory functionality in LLM agent harnesses? And what would be a a more effective alternative, if it's determined less effective than people believe?

---

**Assistant**

I'll dig into the actual research literature here — there's a lot of hype and a growing body of skeptical evidence.## Bottom line

The research does not support the current market story about memory. Across independent 2026 evaluations, dedicated memory systems (Mem0, graph memory, LLM-extracted fact stores) are usually **matched or beaten by plain retrieval over raw history**, and occasionally they make agents worse. What *does* hold up is narrower and less exciting: a raw event log, good retrieval, typed state for facts that change, and provenance-bound writes.

My earlier pi-memory recommendation is still the right *convenience* default, but the literature says you should expect continuity and token savings from it, not accuracy gains — and you should treat its LLM-written `MEMORY.md` as the riskiest part, not the feature.

---

## 1. The headline benchmark numbers are not trustworthy

Before comparing systems, note that this field's evaluation is broken in ways that inflate every score.

| Problem | Finding |
|---|---|
| Answer key errors | An audit of LoCoMo found 99 score-corrupting errors in 1,540 questions (6.4%); a perfect system caps out near 93.6%. Errors include hallucinated facts, wrong date arithmetic, and 24 misattributed speakers — so a system with *accurate* speaker tracking gets penalized [^1] |
| Judge leniency | The same audit fed LoCoMo's gpt-4o-mini judge intentionally wrong but topically adjacent answers; it accepted **62.8%** of them. Vague answers that named the right topic passed two-thirds of the time — which is exactly the failure mode of weak retrieval [^b81d68#23] |
| Ceiling effects | LongMemEval-S uses ~115K tokens per question, which fits inside current context windows. It has largely become a context-management test, not a memory test [^1] |
| Non-reproducibility | Each system uses its own ingestion, prompt, and often different models, then compares scores in a shared table; multiple groups documented failures to reproduce published numbers [^b81d68#25] |
| Ranking instability | Swapping only the embedding model moved accuracy 6.2 points and changed which system *looked better*; a graph system's lead vanished once retrieval budget was equalized [^2] |

This matters because vendor numbers are the ones people quote. Mem0's own material claims 92.5 on LoCoMo and 94.4 on LongMemEval [^3] [^4]. An independent replication with a documented pipeline scored the same framework at **57.69** on LoCoMo [^5]. Those aren't different measurements of the same thing; they're different tasks wearing the same label.

---

## 2. What the independent evidence says about effectiveness

The single cleanest study compared a Mem0-based fact-memory pipeline against simply passing full history to a long-context model, on three memory benchmarks, with a cost model including prompt caching [^5].

| Dataset | Fact-memory system | Long-context GPT-5-mini | Gap |
|---|---|---|---|
| LoCoMo | 57.69% | 92.85% | −35.2 pp |
| LongMemEval | 49.00% | 82.40% | −33.4 pp |
| PersonaMem v2 | 62.48% | 69.75% | −7.3 pp |

The mechanism is straightforward: extraction compressed ~101,600 tokens of conversation into ~2,909 tokens — a 35:1 ratio — and irretrievably lost precise temporal markers, implicit coreferences, and ephemeral updates. In one example the memory held "yoga twice a week" because a later update to three times was never propagated; the long-context baseline answered correctly [^5].

The trade-off is real but economic, not cognitive: memory becomes cheaper than long context after ~10 turns at 100K tokens (26% cheaper at 20 turns), and the break-even drops to ~9 turns at 500K [^5]. The authors are explicit that this characterizes *flat fact extraction*, not all memory architectures [^5].

A synthesis of 3,283 memory papers (2023–Oct 2026) reaches the same place from the other direction:

- **Retrieval choice moves accuracy by ~20 points; write strategy by 3–8.** A better memory backend beats a bigger reader model [^f842f4#353].
- **Six explicit memory systems showed no consistent advantage over retrieval on the raw history** in one controlled comparison [^f842f4#352].
- Mem0 matched cloud RAG on two question types at **50× the cost**; elsewhere plain RAG hit Mem0's accuracy at **8.4× lower total cost of ownership** [^f842f4#356].
- In one controlled test, a careful multi-signal memory retrieval layer turned out to be a BM25 pass-through — removing it entirely did not change accuracy [^f842f4#303].
- Dedicated memory systems did not beat plain in-context learning in a continual-learning benchmark [^f842f4#326].

Two other structural findings are worth internalizing. First, **agents don't ask for memory**: given a store pre-filled with exactly what it needed, one agent made **zero memory calls across 114 turns**, while deterministic cue-triggered injection fired every time [^f842f4#361]. Second, **the harness matters as much as the retrieval method** — the same model scored 93.1% in one harness and 76.7% in another, a shift as large as swapping grep for vector search [^6].

---

## 3. Where memory genuinely earns its keep

Not everything fails. The evidence is strong in specific, unglamorous places:

| Approach | Evidence |
|---|---|
| **Retrieval over raw history** | Strong: matches or beats elaborate systems across multiple independent tests [^f842f4#352] |
| **Lexical/grep retrieval** | Strong on this task distribution: inline grep beat inline vector for *every* harness–model pair tested (e.g. 93.1% vs 83.6%) [^6]. Caveat: LongMemEval answers often license on literal spans, so this may not generalize to paraphrased or code-semantic corpora [^6] |
| **Typed state for changing facts** | Strong: on aggregate questions over a user's history, retrieval-based memory collapsed to 6–43% while typed state reached 99% [^f842f4#354] |
| **Explicit supersession (two time axes)** | Strong: similarity retrieval served the *superseded* value 15–40% of the time when forced to answer; a deterministic supersession rule brought that to ~0% [^f842f4#355] |
| **Harness-delivered, cue-triggered injection** | Medium: fires reliably where agent-initiated recall does not [^f842f4#361] |
| **Admission control / write gates** | Medium: writing only when utility, consistency and evidence pass thresholds cut contamination 67–70% and raised accuracy 6.7–8.4 pp [^f842f4#360] |
| **Explicit long-term memory for GUI agents** | Medium: +21.9 pp in cross-session learning [^f842f4#246] |
| **Lossless context management** | Medium–strong: evicted content recoverable via pointers, 94.8% on LongMemEval-S [^f842f4#363] |

Contested: **knowledge graphs** (Graphiti/cognee at 55–56% vs 77–81% for Mem0/RAG/full context) and **continuous LLM consolidation** (memory utility rose then fell *below* the no-memory baseline) [^2].

---

## 4. Where memory actively hurts

This is the part the industry conversation mostly omits.

- **The Memory Curse:** giving agents more of their own history made cooperation *worse* in 18 of 28 model–game combinations across seven models; replacing history with synthetic cooperative records of the same length restored cooperation, so the content causes the drop [^f842f4#293].
- **Memory-induced tool drift:** stored preferences like "frugal" or "impatient" silently shifted tool-call parameters where irrelevant, raising corrupted parameters to 0.38–0.83 vs 0.05–0.12 with neutral memory, across all eight models — and an audit of 6,062 real tools found the same vulnerability [^f842f4#295].
- **Stale memory overriding truth:** all five memory frameworks did worse than no memory on reasoning traps; an agent trusting stale spatial memory died more than twice as often as one with no memory at all [^f842f4#376].
- **The Memory Trust Gap:** models answered with a stale stored value 0.92–1.00 of the time. Counterintuitively, harm is *capability-gated* — larger models resist simple conflicts but collapse hardest on sophisticated ones. An 8B model dropped to Δ = −1.00 when a stale note was merely dated as newer than the authoritative tool, because better timestamp parsing made it more credulous [^7]. This failure mode is not specific to "memory" — models trusted stale documents and earlier messages just as readily [^75625e#125].
- **Compaction eats safety:** Claude Code's `/compact` on Sonnet 4.6 retained 53% of safety rules after one round and 10% after five [^f842f4#225].

---

## 5. Security: the strongest case against "just add memory"

If you add a memory component, you are adding a persistent, model-writable channel into your system prompt. The measured attack surface:

| Result | Number |
|---|---|
| Cross-session injection success against Claude Code / OpenClaw | 81.7% / 55.5% [^f842f4#164] |
| Sleeper implant success, no defence, frontier models | 85–100%, still firing after 100 ordinary sessions [^f842f4#165] |
| Prompt-level defences | at most 3.2 pp reduction [^f842f4#182] |
| Origin-bound authority at write time | 0% attack success [^f842f4#184] |
| Memory isolation from execution alone | 2.19% [^f842f4#180] |
| End-to-end "forget this" compliance, best of six systems | **1.5%** [^f842f4#365] |

Both known harm mechanisms — authority collapse and provenance laundering — happen during **consolidation**, which is precisely where input filters and tool guards don't look [^2]. This is directly relevant to pi-memory's model-written summaries.

---

## 6. The more effective alternative

Not "no memory" — a different decomposition. The evidence-backed consensus:

**1. Make the raw event log the source of truth.** Append-only session logs, never lossy summaries as the primary store. Schema-typed memory survived a model upgrade essentially losslessly (+0.0004 ± 0.0020); natural-language notes moved +9.91 to −13.28 points, and repairing notes from inside the store failed in all 48 cases, while the saved raw history recovered 34 of 48 [^2].

**2. Spend your effort on retrieval, not on writing.** This is the single largest effect in the literature (20 points vs 3–8). Start with grep/BM25 over raw logs, plus agentic multi-step search. Dense retrieval earns its place only when vocabulary mismatch is the dominant failure — and the ordering is not stable across harnesses or models [^6] [^6].

**3. Have the harness deliver, don't wait for the agent to ask.** Cue-triggered injection and a short experience document outperform agent-initiated recall, which empirically never happens [^f842f4#361].

**4. Keep a small, typed state file for facts that change.** Preferences, versions, ownership, current paths — with explicit `supersedes` links and two timestamps (event time vs. record time). Let the human edit it. Deterministic supersession, not embedding similarity [^2].

**5. Gate writes and bind provenance at write time.** Admission control for contamination; origin binding for security. This is the highest-leverage security control measured, and it's architectural, not a prompt [^f842f4#387].

**6. Prefer lossless compaction.** Evict with pointers back to the original rather than summarizing; keep rules and safety constraints out of any compaction path [^f842f4#363] [^f842f4#386].

**7. If you add procedural memory, do it at subtask granularity and keep the library small.** Task-level skills mostly pushed agents *below* their no-memory baseline; as a skill library grew 5→100, actual-use precision fell from 29.6% to 3.3% [^f842f4#362].

Two useful counterweights: long context is not a free substitute — Chroma tested 18 frontier models and every one degraded as input grew, even on trivially simple tasks, and all models scored better on ~300-token focused prompts than on ~113K-token full prompts [^8] [^8]. So the goal is neither "dump everything in context" nor "compress everything into facts" — it's *select well, then reason*.

---

## 7. What I'd actually do in your pi harness

Concretely, in dependency order — this is roughly the opposite order from how memory products are marketed:

1. **Keep pi's raw session logs and make them greppable.** This alone reproduces most measured memory benefit, and it's the layer those systems compress away. No embedding model, no service.
2. **Add one small hand-curated file** — 40–60 lines of project invariants, commands, gotchas, and "never do X." Not model-written. This is your typed state layer, and it's the part with the strongest evidence behind it.
3. **Add a `supersedes` convention** for anything that changes (API version, deploy target, client preference) rather than letting a summarizer overwrite it.
4. **If you install pi-memory, restrict what it can write.** Turn down or disable auto-write of durable facts; keep the scratchpad and today's log, which is where 90% of the practical value lives. Explicitly forbid it from memorizing credentials, paths, customer data, or instructions found in retrieved content — the last one is the sleeper-poisoning path.
5. **Label recalled memory structurally in the prompt** (`[MEMORY — may be stale]`). Removing such a label universally increased over-trust across model sizes; keeping it is nearly free [^75625e#103].
6. **Never let memory authorize an action.** Read-only influence on reasoning, never a permission grant [^f842f4#387].
7. **Measure it.** Before/after on a dozen real tasks you've already done, against a no-memory baseline. Given ranking instability, your own harness is the only valid benchmark you have.

---

## Caveats on this answer

Most of the strongest evidence here is 2026 preprint work, not replicated peer-reviewed results; the 3,283-paper synthesis was itself assembled by an LLM labeling abstracts, and the author flags that concept detection is keyword-based [^2]. The grep-vs-vector result is explicitly bounded to conversational QA where answers license on literal spans [^6]. And the cost-performance study tested one architecture (flat Mem0 extraction) and says so [^5].

The directional conclusion is nonetheless consistent across independent methods: **the memory *component* is the least valuable part of memory, and the retrieval, delivery, and integrity layers are where the returns are.**

**References**

[^1]: [[D] We audited LoCoMo: 6.4% of the answer key is wrong and the judge accepts up to 63% of intentionally wrong answers](https://www.reddit.com/r/MachineLearning/comments/1s54cvg/d_we_audited_locomo_64_of_the_answer_key_is_wrong/) (10%)
[^2]: [State of AI agent memory 2026: what 3,283 papers show](https://openchamber.dev/blog/agent-memory-research/) (26%)
[^3]: [AI Memory Benchmarks: LoCoMo vs. LongMemEval ...](https://mem0.ai/library/agent-memory/ai-memory-benchmarks-in-2026) (1%)
[^4]: [LoCoMo, LongMemEval & BEAM Benchmarks](https://mem0.ai/research) (1%)
[^5]: [[2603.04814v1] Beyond the Context Window: A Cost-Performance Analysis of Fact-Based Memory vs. Long-Context LLMs for Persistent Agents](https://arxiv.org/html/2603.04814v1) (28%)
[^6]: [[2605.15184v1] Is Grep All You Need? How Agent Harnesses Reshape Agentic Search](https://arxiv.org/html/2605.15184v1) (10%)
[^7]: [The Memory Trust Gap: Capability-Dependent Failures in Persistent-Memory Agents | alphaXiv](https://www.alphaxiv.org/abs/2609.01852) (16%)
[^8]: [Context Rot: How Increasing Input Tokens Impacts LLM Performance | Chroma](https://www.trychroma.com/research/context-rot) (9%)

---

**You**

Can you cite some evidence for the strongest pros and cons you shared?
Also, based on your research, what are some exemplary projects that add the strongest gains to an LLM agent harness? I'd like to reference the implementations of 2-3 projects.

---

**Assistant**

I should verify these sources with real links rather than leave them as opaque markers. Let me pull the actual papers.## Part 1 — The evidence, with sources

Below are the claims I'd actually stand behind, each tied to the paper or analysis it came from.

### The strongest *pros*

| Claim | What was measured | Source |
|---|---|---|
| **Typed state beats retrieval on state that changes** | On aggregate questions over a user's history, retrieval-based memory collapses to 6–43% accuracy while typed state reaches 99%. On supersession/completeness/negation questions, a typed project graph answers 0.98–1.00 vs 6–27% for vector memory | *User as Code* and *Ontology-Grounded Project Memory*, via [^f842f4#354] |
| **Explicit supersession nearly eliminates stale answers** | Forced to answer, similarity retrieval served the *superseded* value 15–40% of the time; a deterministic supersession rule over a two-timestamp log brought it to ~0% (0.95–1.00 on evolving knowledge vs 0.20–0.47 for RAG) | *Temporal Validity in Retrieval Memory*, via [^f842f4#355] |
| **Origin binding at write time is the only defence that fully worked** | Attack success 0% when origin is bound at write; content- or lineage-based judgement could be laundered up to 68% of the time | [^f842f4#366] (Origin-Bound Authority); corroborated by the 94%→11% result from architectural controls vs ≤3.2 pp for prompt filters [^f842f4#182] |
| **Admission control measurably reduces contamination** | Writing only when utility, consistency and evidence pass thresholds: 67–70% less contamination, +6.7 to +8.4 pp accuracy. Five interpretable factors gave 31% lower latency than LLM-decided writes | [^f842f4#114] [^f842f4#360] |
| **Lossless compaction works; summarising compaction doesn't** | Pointer-into-event-log eviction reaches 94.8% on LongMemEval-S. Claude Code's `/compact` on Sonnet 4.6 keeps 53% of safety rules after one round, 10% after five; type-aware compaction keeps 96% | [^f842f4#225] [^f842f4#363] |
| **Schema survives model upgrades; prose notes don't** | Fixed-schema memory moved +0.0004 ± 0.0020 across a model change; natural-language notes moved +9.91 to −13.28 points. Repairing notes from inside the store failed in all 48 cases; the raw history recovered 34 of 48 | [^1] |
| **Selection beats volume at equal cost** | Selective memory completed 12 of 12 trials at the same token cost where no memory completed 0 of 12; full history completed 8 of 12 at twice the cost | [^f842f4#375] |
| **Real, if narrower, wins exist** | 20–65% token savings, 6–26 pp accuracy gains, ~⅓ lower latency across 2026 systems; +21.9 pp cross-session learning for GUI agents | [^f842f4#231] [^f842f4#246] |

### The strongest *cons*

| Claim | What was measured | Source |
|---|---|---|
| **Long context beat a fact-memory system on the memory benchmarks** | Long-context GPT-5-mini was stronger on LongMemEval and LoCoMo; the Mem0-style system was only competitive on PersonaMem-v2. Break-even was ~10 turns at 100K tokens — an economic, not cognitive, win | [^2]; mechanism (35:1 compression losing temporal markers and updates) in [^3] |
| **Memory made agents worse** | More of their own history reduced cooperation in 18 of 28 model–game combinations; synthetic cooperative records of the same length restored it, so *content* causes the drop | [^f842f4#293] (Memory Curse) [^f842f4#376] |
| **Memory corrupts tool calls** | Stored preferences like "frugal" shifted irrelevant tool-call parameters; corrupted parameters rose to 0.38–0.83 vs 0.05–0.12 with neutral memory, across all eight models. 6,062 real tools on 288 MCP servers showed the same | [^f842f4#295] |
| **Models over-trust stale memory at every scale** | Stale value answered 0.92–1.00 of the time; harm is *capability-gated* — larger models collapse hardest once a stale note is made to look current | [^4] [^5] |
| **All five memory frameworks lost to no memory on reasoning traps** | An agent trusting stale spatial memory died more than twice as often as one with no memory | [^f842f4#376] (MemTrapBench, *When Memory Lies*) |
| **Agents don't ask for memory** | Given a store pre-seeded with exactly what it needed, one agent made **zero** memory calls across 114 turns; deterministic cue-triggered injection fired every time | [^f842f4#361] |
| **Poisoning is the dominant failure mode** | 81.7% cross-session attack success on Claude Code, 55.5% on OpenClaw; sleeper implants 85–100% against frontier models and still firing after 100 sessions; isolation alone only gets to 2.19% | [^f842f4#164] [^f842f4#165] [^f842f4#180] |
| **Deletion is unsolved** | No system among six passed more than **1.5%** of forget requests end to end | [^f842f4#365] |
| **The benchmark numbers everyone quotes are unsound** | 99 score-corrupting errors in LoCoMo's 1,540 questions (6.4%); the judge accepted 62.8% of deliberately vague-but-topical wrong answers; LongMemEval-S fits in modern context windows | [^6] [^7] |
| **Rankings flip on irrelevant changes** | Swapping only the embedding model moved accuracy 6.2 pp and changed which system looked better; Graphiti's lead disappeared once the retrieval budget was equalised | [^f842f4#334] |

### One correction to what I told you earlier

I said grep beat vector "for every harness–model pair tested." That's true only for **inline** tool results. Once retrieved content was written to files and read separately, lexical search **lost five of ten** pairings, and the harness itself shifted accuracy as much as the retriever did [^8] [^9]. The honest reading: retrieval channel (inline vs. file) interacts with retrieval method, and the effect is large enough that "grep wins" is not a portable law. This strengthens rather than weakens the "measure it yourself" advice.

---

## Part 2 — Three projects worth reading the source of

I picked these because each one is a *reference implementation of a specific mechanism the evidence rates highly*, not because it wins a leaderboard. Read the architecture; don't adopt the product.

### 1. Graphiti (Zep) — for the bi-temporal data model

**What it is:** an open-source temporal knowledge graph where "episodes" (raw ingested events) are decomposed into entities and edges that carry **two time axes**: when a fact was true in the world, and when the system learned it [^10] [^a2cd34#15]. When a new fact contradicts an old one, the old edge is **invalidated rather than deleted**, and every derived fact keeps provenance back to the source episode [^10].

**Why it's exemplary:** this is the mechanism with the strongest evidence behind it. Similarity retrieval serves superseded values 15–40% of the time; an explicit supersession rule over two timestamps brings that to ~0% [^f842f4#355]. Graphiti is the cleanest open implementation of exactly that, and the "invalidate, don't delete" pattern is what makes history auditable. The atlas's summary is precise: *best idea — fact validity ≠ ingestion time; main risk — graph mistakes have wide impact* [^11].

**What to copy, what to skip:**
- Copy the **data model** — even in SQLite: `valid_from`, `valid_to`, `recorded_at`, `supersedes_id`, `source_event_id`. You get the 0%-stale result without any graph.
- Skip the **graph retrieval** as your default. Knowledge graphs are rated *contested*: Graphiti and cognee reached 55–56% against 77–81% for Mem0, RAG and full context in one comparison, and the lead vanished at equal retrieval budget [^f842f4#357] [^f842f4#334].

### 2. Letta (MemGPT) — for harness-delivered, budgeted, typed state

**What it is:** memory as a first-class part of the running agent rather than a retrieval sidebar — **core** blocks (always in context), **archival** storage, and **conversation** recall as distinct tiers, with the agent editing its own core blocks [^11] [^a2cd34#25].

**Why it's exemplary:** it implements the "typed state" and "harness delivers" findings together, and its block abstraction forces an explicit token budget per block — which is the practical fix for the "memory is wallpaper" problem. Blocks are labelled and bounded, so you can mark them structurally as memory rather than letting them blur into the system prompt.

**Its documented weakness is the important lesson:** *agent-editable core lacks a trust model* [^11]. Given that agent-initiated memory is the failure mode the evidence keeps flagging — zero calls in 114 turns when it mattered, plus consolidation-stage authority collapse [^f842f4#361] [^1] — copy the **tiering and the budgets**, but make the core blocks **human-authored and agent-read-only**. Let the agent propose edits into a pending queue; don't let it write the tier that is always in context.

### 3. Basic Memory — for Markdown-as-source-of-truth with rebuildable indexes

**What it is:** human-editable Markdown notes remain authoritative, while the graph and hybrid-search indexes are **derived and rebuildable** projections of those notes [^11].

**Why it's exemplary:** it is the closest thing in the open-source landscape to the two strongest portability findings. Fixed-schema/raw-first storage survived a model upgrade essentially losslessly (+0.0004 ± 0.0020), while prose notes moved ±10+ points and could not be repaired from inside the store — the raw history recovered 34 of 48 cases [^1]. If your index is disposable and your notes are canonical, a bad index is a rebuild, not a data loss. And human editability is itself a security control: it's how you correct a poisoned or stale record without an LLM in the loop.

**Its documented weakness:** bidirectional sync complexity [^11] — real, and the reason I'd use **one-way** flow (notes → index, never index → notes) in a pi harness.

### Shortlist of mechanisms worth borrowing beyond these three

| If your failure is… | Borrow this pattern | Where it's implemented |
|---|---|---|
| Provenance you can actually follow | Every derived fact cites the raw episode it came from | MemMachine — *"provenance you can actually follow"*, risk: reports deletion before it's true [^11] |
| Small, boring, local, coding-oriented | SQLite + FTS5 with **conflict-surfacing writes** rather than silent overwrite | Engram — topic-key upserts, risk: agent discipline drives quality [^11] |
| Stale facts about a *codebase* | Re-verify a memory when git says the files it describes changed | Magic Context [^11] |
| Deletion that holds | Cryptographic erasure receipts over an append-only log | Lethe — Ed25519 receipt anchored to a Merkle root; risk: never re-checks the hash on write [^11] |
| Memory that shouldn't be believed | Negative memory / tombstones so a rejected value can't return via re-extraction | *Rejected-value tombstone* pattern [^11] |

### The composite design the evidence supports

If I were building this into pi tomorrow, I'd take the **schema** from Graphiti, the **tiering and budgets** from Letta (with human-only core writes), and the **storage model** from Basic Memory — then add Engram's FTS5 conflict surfacing and a tombstone table. That's roughly 400–600 lines with no daemon, no embedding model, and no network calls, and it matches every mechanism rated *strong* in the literature while avoiding both mechanisms rated *contested* (graph retrieval, LLM consolidation).

Two honest caveats: the 3,283-paper synthesis was assembled by an LLM labelling abstracts and its author states the evidence ratings are judgements from abstracts, not full-text review [^1]; and the atlas is a single-maintainer, commit-pinned project that explicitly flags which of its patterns are arguments rather than observations [^11]. Both are directional evidence, not settled science — which is why the last step in any of these designs should be a before/after on a dozen of your own real tasks.

**References**

[^1]: [State of AI agent memory 2026: what 3,283 papers show](https://openchamber.dev/blog/agent-memory-research/) (45%)
[^2]: [Beyond the Context Window: A Cost-Performance Analysis of Fact-Based ...](https://arxiv.org/abs/2603.04814) (6%)
[^3]: [A Cost-Performance Analysis of Fact-Based Memory vs. ...](https://arxiv.org/html/2603.04814v1) (3%)
[^4]: [Capability-Dependent Failures in Persistent-Memory Agents](https://arxiv.org/abs/2609.01852) (6%)
[^5]: [The Memory Trust Gap: Capability-Dependent Failures in Persistent ...](https://arxiv.org/html/2609.01852v1) (2%)
[^6]: [[D] We audited LoCoMo: 6.4% of the answer key is wrong ...](https://www.reddit.com/r/MachineLearning/comments/1s54cvg/d_we_audited_locomo_64_of_the_answer_key_is_wrong/) (1%)
[^7]: [dial481/locomo-audit: Full audit of the LoCoMo benchmark - GitHub](https://github.com/dial481/locomo-audit) (3%)
[^8]: [Is Grep All You Need? How Agent Harnesses Reshape ...](https://arxiv.org/html/2605.15184v1) (3%)
[^9]: [Is grep all you need? Agentic search vs vector retrieval](https://latenteval.ai/research/is-grep-all-you-need) (2%)
[^10]: [getzep/graphiti: Build Real-Time Knowledge Graphs for AI ...](https://github.com/getzep/graphiti) (6%)
[^11]: [Agent Memory Atlas](https://neoneye.github.io/agent-memory-atlas/) (24%)

---

**You**

Is there any core functionality I need to reference from other projects? Those you provided are excellent.
Keep in mind that these projects you are providing for reference must be open source for them to be valuable.

---

**Assistant**

I'll verify licenses and actual repo structure before recommending — the open-source requirement changes which projects are usable.Let me confirm licenses directly and find open-source implementations of the security primitives.## The short version

Yes — but not "core functionality" in the sense of features. The research says the value is in **six primitives**, and each has exactly one open-source implementation worth reading. Copy the *data model and hook placement*, not the products.

Two important findings from verifying licenses:

- **Basic Memory already ships a Pi integration** — `bm install pi`, a real extension at `integrations/pi/extensions/index.ts`, and a documented lifecycle contract. That is the single most directly reusable artifact for your harness [^1].
- **Basic Memory is AGPL-3.0** [^3fc33d#1], not permissive. Everything else below is Apache-2.0 or MIT, which changes what you may copy.

---

## 1. The six primitives, and the file to read for each

| Primitive | Project | License | Read this specifically |
|---|---|---|---|
| **Bi-temporal fact schema** (validity vs. record time, invalidate-don't-delete) | [Graphiti](https://github.com/getzep/graphiti) | Apache-2.0 [^2] | `graphiti_core/edges.py` → `EntityEdge` [^3] |
| **Provenance at the write** (every derived fact cites its source event) | Graphiti | Apache-2.0 | `episodes` field + `Episodic` nodes; README "Everything traces back to episodes" [^4] |
| **Harness-delivered recall + compaction capture** | [Basic Memory](https://github.com/basicmachines-co/basic-memory) | AGPL-3.0 [^3fc33d#1] | `integrations/pi/` — `extensions/index.ts`, `hooks/recall.ts`, `hooks/capture.ts`; `plugins/claude-code/hooks/pre_compact.py` |
| **Tiered, budgeted context blocks** | [Letta](https://github.com/letta-ai/letta-code) | Apache-2.0 [^5]; brand assets carved out [^5] | Memory-blocks abstraction docs [^6]; concept: core / recall / archival tiers [^7] |
| **Lossless-ish condensation** (summarize the early half, leave the recent half intact) | [OpenHands SDK](https://github.com/OpenHands/software-agent-sdk) | MIT [^8] | `openhands-sdk/openhands/sdk/context/condenser/` [^9] |
| **Cheap relevance selection over a codebase** | [Aider](https://github.com/Aider-AI/aider) | Apache-2.0 [^10] | Repo map: tree-sitter tags → PageRank → budgeted map [^11] [^12] |

Plus one **design reference only**, not a dependency: [CaMeL](https://github.com/google-research/camel-prompt-injection) (Apache-2.0 [^13]) for capability/taint-based control flow — it solves 77% of tasks with *provable* security vs. 84% undefended in AgentDojo [^14]. But the repo labels itself a research artifact: "likely contains bugs… might not be fully secure… not a Google product… not planning to provide support" [^15]. Read the design, don't vendor the interpreter.

---

## 2. The one thing to read first: Basic Memory's Pi integration

This is the closest thing to a reference implementation of "memory for *your* harness," and it encodes four research findings at once.

```jsonc
// .pi/basic-memory.json — from their README [^1]
{
  "transport": "cli",
  "project": "main",
  "captureFolder": "pi/sessions",
  "useHookFlow": true,
  "autoRecall": true,      // inject one bounded recall before first turn
  "autoCapture": true      // capture after settled turns AND before compaction
}
```

What to notice, and why each detail matters:

| Their choice | Why it's the right pattern |
|---|---|
| **`autoRecall` injects one bounded recall before the first turn** — the agent doesn't have to ask [^222d12#51] | Agents empirically never call memory tools: zero calls across 114 turns when a store was pre-seeded with exactly what was needed, while deterministic cue-triggered injection fired every time [^f842f4#361] |
| **`autoCapture` fires "after settled turns and before compaction"** [^222d12#52] | Compaction is the point of maximum loss; Claude Code's `/compact` retains 53% of safety rules after one round and 10% after five [^f842f4#225] |
| **Recalled notes are "fenced as reference data, not instructions"** [^222d12#143] | Removing a memory label universally increased over-trust across model sizes; structural fencing is the cheap fix [^75625e#103] |
| **Auto recall is `blocked` without an explicit project mapping + workspace trust** (`BASIC_MEMORY_PI_TRUST_WORKSPACE=1`) [^222d12#70] [^1] | Prevents falling through to an ambient global default — the quiet cross-project leak that makes memory a privacy problem |
| **Captures are "extractive working-thread checkpoints," not LLM summaries** [^222d12#143] | Raw-first storage survived a model upgrade at +0.0004 ± 0.0020; prose notes moved +9.91 to −13.28 points and repairing them from inside the store failed in all 48 cases |
| **`bmCommand` is argv, never a shell** [^222d12#66] | Avoids the obvious command-injection path in a config file that a repo can supply |

**License caution:** the repo root is AGPL-3.0 [^3fc33d#1], and each integration ships its own `LICENSE` file (`integrations/pi/LICENSE` is in the tree [^c5f00c#538]) — read that one before copying. For a personal extension you never distribute, AGPL is not a practical problem. But if you lift `hooks/recall.ts` into a pi-memory package you plan to publish, AGPL's network/distribution clauses follow it. **Reading it for architecture is unambiguously fine; copying code is where you check.**

---

## 3. The schema to copy from Graphiti — six fields, no graph

This is the highest-value thing in the whole answer. `EntityEdge` in `graphiti_core/edges.py` [^3]:

```python
fact: str
fact_embedding: list[float] | None
episodes: list[str]              # provenance: which raw events produced this
expired_at: datetime | None      # when the DB row stopped being current
valid_at: datetime | None        # when the fact became true in the world
invalid_at: datetime | None      # when it stopped being true
reference_time: datetime | None  # timestamp of the source episode
```

Note what the field docstrings encode — they're the actual lesson:

- `valid_at`: *"future-tense plans/promises use the episode reference time rather than the future occurrence date"* [^3]. That one sentence prevents the classic bug where "I'll move to Berlin in June" gets stored as a fact true in June.
- `invalid_at`: *"soft deadlines are not invalid_at"* [^3].
- `expired_at` is separate from `invalid_at` — **system time vs. world time** [^3].

And the behavior: *"When information changes, old facts are invalidated — not deleted. Query what's true now, or what was true at any point in time"* [^4].

Port it into SQLite as-is, skip the graph:

```sql
CREATE TABLE fact (
  id             INTEGER PRIMARY KEY,
  subject        TEXT NOT NULL,
  predicate      TEXT NOT NULL,
  object         TEXT NOT NULL,
  valid_at       TEXT,          -- world time: when this became true
  invalid_at     TEXT,          -- world time: when it stopped being true
  recorded_at    TEXT NOT NULL, -- system time: when we learned it
  expired_at     TEXT,          -- system time: when we stopped believing it
  supersedes_id  INTEGER REFERENCES fact(id),
  source_event   TEXT NOT NULL, -- provenance: raw log line / episode id
  confidence     REAL,
  CHECK (invalid_at IS NULL OR invalid_at >= valid_at)
);
CREATE INDEX fact_current ON fact(subject, predicate) WHERE invalid_at IS NULL;
```

That single `CHECK` plus the partial index gives you the deterministic-supersession result — 0.95–1.00 on evolving knowledge vs. 0.20–0.47 for similarity RAG, and ~0% stale-value retrieval vs. 15–40% [^f842f4#355].

Two operational details from Graphiti worth copying exactly:

- **Disable telemetry.** Graphiti collects anonymous usage stats (OS, Python version, provider/backend choices) via PostHog, opt-out with `GRAPHITI_TELEMETRY_ENABLED=false` [^4]. If you copy code paths, don't copy the telemetry default.
- **Their own reference servers have "no authentication, no authorization, and no prompt-injection protection… intentionally"** [^4]. Don't treat a memory server as a hardened component just because the library is good.

---

## 4. Condensation: what OpenHands actually does

Their condenser lives in `openhands-sdk/openhands/sdk/context/condenser/`, with `LLMSummarizingCondenser` as the default [^9] [^16]. The strategy is the part to copy:

> *"Early context: events are summarized, and summaries are also summarized in future condensations… Recent context: the back half of the context is untouched, so the agent has an easy time continuing the current task."* [^9]

Two properties matter more than the summarizer itself:

1. **Symmetric split** — you never summarize the window you're actively working in. This is why compaction-induced safety loss drops so sharply when the recent half is untouched.
2. **Condensation is an event on the stream** [^17], so it's auditable and you can see *what* was condensed and when. That's the difference between "the agent forgot" and "the agent forgot, here's the record."

MIT license [^8], so this one you can freely adapt.

If you want to go further than OpenHands: evict with **pointers into the raw log** rather than summaries. Pointer-based eviction reached 94.8% on LongMemEval-S, vs. 53%→10% rule retention for summarising compaction [^f842f4#363] [^f842f4#225].

---

## 5. Selection: Aider's repo map

Aider builds a map of the whole repo containing the most important classes and functions with their types and call signatures, extracted via tree-sitter [^11], and ranks symbol importance with PageRank over the reference graph [^18] [^19]. Apache-2.0 [^10].

Why it belongs in a memory design: it's the same problem as retrieval, solved with **zero embeddings and zero network calls** — a static, deterministic, budgeted index of structure. The literature's largest single effect is retrieval choice (~20 points) vs. write strategy (3–8) [^f842f4#353], and this is the cheapest credible retrieval layer for code. It also degrades predictably: you set a token budget and it fills it by rank, so cost is bounded by construction.

The honest caveat: aider's map is tuned for *editing* code, not for recalling past decisions. Use it for "what exists and how it connects," and keep Graphiti's `fact` table for "what we decided and when."

---

## 6. License table — what you may actually copy

| Project | License | Copy code? | Notes |
|---|---|---|---|
| Graphiti | **Apache-2.0** [^2] | Yes, with NOTICE + attribution | Patent grant included; telemetry must be stripped |
| Letta / letta-code | **Apache-2.0** [^5] | Yes | Brand assets (name, logo, wordmark) explicitly **excluded** from the license [^5] — don't reuse naming |
| OpenHands SDK | **MIT** [^8] | Yes, most permissive here | Best candidate for direct adaptation |
| Aider | **Apache-2.0** [^10] | Yes, with attribution | |
| sqlite-memory (sqliteai) | **Apache-2.0** [^20] | Yes | Hybrid vector + FTS5, markdown-aware chunking, local llama.cpp embeddings [^21] — good if you want one file |
| CaMeL | **Apache-2.0** [^13] | Legally yes, practically no | Self-described buggy, unmaintained research artifact [^15] |
| **Basic Memory** | **AGPL-3.0** [^3fc33d#1] | **Careful** | Viral on distribution *and* network use; per-integration `LICENSE` may differ. Read the architecture, write your own code |

---

## 7. What I'd skip in each project

| Skip | Why |
|---|---|
| Graphiti's **graph traversal retrieval** | Contested: Graphiti/cognee at 55–56% vs. 77–81% for Mem0/RAG/full context, and the lead vanished once retrieval budget was equalised [^f842f4#357] [^f842f4#334] |
| Graphiti's **LLM entity/edge extraction pipeline** | That's the 35:1 compression step that lost temporal markers and never propagated updates; also the consolidation stage where poisoning actually lands |
| Letta's **agent-writable core blocks** | Their own documented weakness: "agent-editable core lacks a trust model" [^22]. Keep the tiering, make core human-authored |
| Basic Memory's **bidirectional sync engine** | Documented weakness: sync complexity [^22]. Use one-way: markdown → index, never back |
| OpenHands' **LLM summarizer as the only strategy** | Keep the split, replace the summary with a pointer to the evicted events |

---

## 8. Build order, if you're assembling this yourself

Roughly 400–600 lines, no daemon, no network:

1. **Append-only event log** (pi already has session logs) — source of truth, greppable. ~40 lines.
2. **`fact` table** with the six Graphiti fields + `CHECK` constraint + partial index. ~60 lines.
3. **`tombstone` table** so a rejected value can't return via re-extraction. ~15 lines.
4. **FTS5 index over the raw log**, one-way rebuildable. ~40 lines.
5. **Cue-triggered injection hook** before the first turn: one bounded recall, fenced and labeled `[MEMORY — may be stale]`. ~80 lines. (Model on Basic Memory's `hooks/recall.ts`.)
6. **Pre-compaction capture hook** — write the working thread as an extractive checkpoint, plus a pointer back to the raw range. ~100 lines. (Model on their `pre_compact.py`.)
7. **Human-authored `INVARIANTS.md`** injected verbatim, read-only to the agent. ~0 lines of code, highest measured value.
8. **Origin binding at write**: content from retrieved pages/tool output can only write to a quarantined tier. This is the one security control measured at 0% attack success [^f842f4#184] [^f842f4#366].

If you'd rather not build: `pi install` Basic Memory's integration and set `autoCapture`/`autoRecall` per its README [^1] — it's already pi-native and follows the contract above. Just go in knowing the AGPL and that you're adopting a sync engine you probably don't need.

---

**One caveat on all of this:** the license facts above I verified directly from the LICENSE files. The architecture descriptions are from READMEs, docs, and the file trees of the pinned `main` branches — which means module paths can move. Pin a commit before you copy anything, and re-check `integrations/pi/LICENSE` in Basic Memory rather than assuming the root license applies.

**References**

[^1]: [raw.githubusercontent.com](https://raw.githubusercontent.com/basicmachines-co/basic-memory/main/integrations/pi/README.md) (10%)
[^2]: [raw.githubusercontent.com](https://raw.githubusercontent.com/getzep/graphiti/main/LICENSE) (1%)
[^3]: [raw.githubusercontent.com](https://raw.githubusercontent.com/getzep/graphiti/main/graphiti_core/edges.py) (15%)
[^4]: [getzep/graphiti GitHub Repo](https://github.com/getzep/graphiti) (26%)
[^5]: [raw.githubusercontent.com](https://raw.githubusercontent.com/letta-ai/letta-code/main/LICENSE) (4%)
[^6]: [Memory blocks (core memory) | Letta Docs](https://docs.letta.com/v1-sdk/memory/memory-blocks) (3%)
[^7]: [letta-ai/letta GitHub Repo](https://github.com/letta-ai/letta) (2%)
[^8]: [raw.githubusercontent.com](https://raw.githubusercontent.com/OpenHands/software-agent-sdk/main/LICENSE) (0%)
[^9]: [software-agent-sdk/openhands-sdk/openhands/sdk/context ... - GitHub](https://github.com/OpenHands/software-agent-sdk/tree/main/openhands-sdk/openhands/sdk/context/condenser) (3%)
[^10]: [raw.githubusercontent.com](https://raw.githubusercontent.com/Aider-AI/aider/main/LICENSE.txt) (1%)
[^11]: [Building a better repository map with tree sitter](https://aider.chat/2023/10/22/repomap.html) (4%)
[^12]: [Repository map - aider](https://aider.chat/docs/repomap.html) (3%)
[^13]: [raw.githubusercontent.com](https://raw.githubusercontent.com/google-research/camel-prompt-injection/main/LICENSE) (1%)
[^14]: [[2503.18813] Defeating Prompt Injections by Design](https://arxiv.org/abs/2503.18813) (5%)
[^15]: [GitHub - google-research/camel-prompt-injection: Code for the paper ...](https://github.com/google-research/camel-prompt-injection) (4%)
[^16]: [Context Condenser](https://docs.openhands.dev/sdk/guides/context-condenser) (4%)
[^17]: [Enhanced condenser visibility · Issue #6706 - OpenHands](https://github.com/OpenHands/OpenHands/issues/6706) (1%)
[^18]: [aider-desk/packages/extensions/extensions/tree-sitter-repo-map ... - GitHub](https://github.com/hotovo/aider-desk/tree/main/packages/extensions/extensions/tree-sitter-repo-map/) (4%)
[^19]: [PageRank Repo Map — Automatic Codebase Context ...](https://github.com/NousResearch/hermes-agent/issues/535) (1%)
[^20]: [raw.githubusercontent.com](https://raw.githubusercontent.com/sqliteai/sqlite-memory/main/LICENSE) (1%)
[^21]: [GitHub - sqliteai/sqlite-memory: Markdown based AI agent memory with ...](https://github.com/sqliteai/sqlite-memory) (5%)
[^22]: [Agent Memory Atlas](https://neoneye.github.io/agent-memory-atlas/) (1%)

---

**You**

Any other pitfalls or anti-patterns I should know about before I start?

---

**Assistant**

Let me check the harness-specific and storage-level gotchas rather than repeat general advice.Good timing to ask — most of the failure modes I'd flag are harness-lifecycle traps specific to Pi, not generic memory advice. Here's the list, ordered by how likely each is to bite you in the first week.

---

## The five that will bite you first

### 1. Injecting memory into the system prompt

This is the most expensive mistake available, and it's what almost every memory extension does.

Pi records the initial prompt and tool set in the transcript's first system message, then appends prompt and tool changes before the next model request — and providers that cannot represent the transition receive a **complete transcript checkpoint, which can invalidate the cached prefix** [^20151f#391]. If your memory content changes every turn and you put it in the system prompt, you're invalidating the cache on every request.

The fix is structural: **inject memory as transcript entries, not as prompt text.** Use `pi.sendMessage()` or `appendEntry`-backed content, or the `context` hook which "transforms conversation messages without prompt and tool system messages" and whose state Pi restores afterward [^20151f#317]. Also prefer "changing prompt sections, selected tools, or guidelines so Pi can append a transcript delta" over returning `systemPrompt`, which "replaces the whole prompt for that run while the transcript continues recording the structured sections" [^20151f#309] — that divergence shows up later as a confusing resumed session.

Corollary: a *static* invariants block in the system prompt is fine (it never changes, so the prefix stays cached). A *dynamic* memory block is not.

### 2. Treating `agent_end` as "the run is done"

Retries, recovery, compaction, and queued messages can start another agent run after `agent_end`, so **`agent_end` is not a final-idle signal** [^20151f#235]. A memory extension that writes a checkpoint on `agent_end` will write 2–4 partial checkpoints for one logical task, each with a different source id.

Use `agent_before_settle` when you must append entries or request one final continuation, and `agent_settled` for "notification-only work that should run after Pi has no automatic continuation remaining" [^1]. For durable capture, `session_shutdown` is the honest boundary — but see #4.

### 3. Letting abandoned branches write memory

Pi has a real conversation tree. If you reconstruct memory state "from every file entry," you are ingesting **abandoned branches, which represent alternative histories** — Pi's own guidance is to reconstruct branch-sensitive state from `ctx.sessionManager.getBranch()` during `session_start` [^1].

Concretely: you explore approach A, it fails, you `/tree` back and do B. Both are in the session file. A naive memory indexer stores "we decided on A," and now your memory contains a decision the user explicitly abandoned. This is the highest-frequency source of *wrong* memories in my experience of these systems, and it looks like a model failure when it's an ingestion bug.

### 4. Non-idempotent session shutdown

Session replacement, `/fork`, `/clone`, `/new`, `/resume`, and reload all converge on `session_shutdown` — and Pi tells you explicitly to keep cleanup idempotent "because cancellation, reload, session replacement, and process exit can converge on the same path" [^1].

The `/fork` case is the sneaky one: a forked session carries the parent's transcript, so a capture keyed on "session content" writes the same facts twice with different session ids. Key your upserts on *content-derived ids* (hash of `subject|predicate|object|valid_at`), not on session or entry ids, and dedupe at write.

### 5. Cancelling compaction to be safe

`session_before_compact` can `return { cancel: true }` [^2]. It looks protective. It isn't: if recovery compaction fails **or is cancelled**, Pi "keeps the omission edits, appends no compaction, and schedules no internal retry" [^60e6d5#119]. You've just made the agent forget content *without* a summary, permanently, and the run that triggered it doesn't retry.

Never cancel compaction from a memory extension. If you don't want the default summary, return a custom one instead.

---

## Harness contracts you can silently violate

| Anti-pattern | What actually happens | Correct move |
|---|---|---|
| Spawning a process/socket/watcher in the extension **factory** | Some invocations load extensions without starting a session, so it leaks or never starts [^1] | Start from `session_start`; close in an idempotent `session_shutdown` [^1] |
| Calling `withSession`, tree navigation, or reload from a **lifecycle handler** | Deadlocks the runtime — these are "command-only because calling them from lifecycle handlers can deadlock" [^1] | Only from command handlers |
| Reusing state after `await ctx.reload()` | The old runtime is invalidated; anything session-bound is stale [^20151f#56] [^20151f#235] | Treat reload as a process boundary |
| Doing slow work in a **streaming** event handler | "Handlers are awaited in stream order, so slow handlers delay stream consumption" [^20151f#315] | Never do embedding calls or SQLite writes in `provider_stream_event` |
| A `tool_call` gate that doesn't **fail closed** | A handler failure **blocks** the tool; silently returning `undefined` on error lets it through [^20151f#462] | Return an explicit decision; fail closed by design [^20151f#307] |
| Assuming a sibling tool result exists | Tool calls from one assistant message run in **parallel** [^1] | Don't build "current file" state from adjacent tool events |
| Calling command-only UI from headless modes | Extensions load in interactive, RPC, JSON, and **print** modes; only interactive has full UI [^1] | Guard with `ctx.mode === "tui"` / `ctx.hasUI` |
| Returning giant tool results | Bloats context and the next compaction | "Truncate large model-facing results and tell the model where to read the complete output" [^20151f#343] |
| Custom compaction that omits `details` | Pi "does not automatically carry file lists from extension-generated summaries whose `fromHook` field is `true`" — you lose cumulative read/modified file tracking [^60e6d5#241] | Populate `details.readFiles` / `modifiedFiles` yourself |
| Writing memory during an overflow retry | `willRetry` tells you the aborted turn is retried after compaction [^60e6d5#362]; you'll capture an aborted attempt as truth | Skip capture when `willRetry` is true |

One more: **tools cannot be unregistered** — you can only re-register with `exposure: "hidden"` to withdraw them [^20151f#361]. Design your tool surface once; a memory extension that registers six tools and later hides four leaves a confusing `getAllTools()` result.

---

## Data-model anti-patterns

| Anti-pattern | Why it fails | Do instead |
|---|---|---|
| **One timestamp** | You cannot distinguish "when it was true" from "when we learned it," so you cannot resolve conflicting facts chronologically | Two axes: `valid_at/invalid_at` (world) vs `recorded_at/expired_at` (system), as Graphiti does |
| **UPDATE in place** | Destroys the audit trail and makes "what did we believe last week" unanswerable | Invalidate + insert a new row with `supersedes_id` |
| **Hard DELETE without tombstone** | Re-extraction resurrects deleted facts; deletion is the worst-measured function in the literature (best of six systems: 1.5% end-to-end compliance) | Tombstone table keyed on normalized fact content, checked **before** insert |
| **Summaries as the canonical store** | Natural-language notes moved +9.91 to −13.28 points across a model upgrade and could not be repaired from inside the store; raw history recovered 34 of 48 cases | Raw log canonical, summaries derived and rebuildable |
| **Free-text provenance** ("from the docs") | Unfollowable, so you can never audit or retract | `source_event` = a log line id or episode id |
| **Confidence as a float you never calibrate** | Nobody ever tunes it; it becomes an unfalsifiable authority signal | Use it for *ordering* only, never for gating or trust |
| **No entity resolution** | "user," "the user," the person's name, and `@handle` become four subjects; supersession never fires across them | Small alias table + normalize before insert |
| **Fact granularity too fine** | "yoga twice a week" survives an update to three times because the update was stored as a separate row | Key facts on `(subject, predicate)`, not on full sentences |
| **Unbounded growth, no decay** | Retrieval precision degrades and cost grows monotonically | Explicit `expires_at` for time-bound facts; review queue instead of silent accumulation |

That last one has a measured analogue worth remembering: as a skill library grew from 5 to 100 entries, actual-use precision fell from 29.6% to 3.3%. Memory stores show the same shape. **A memory store you don't prune is a store that stops being retrieved from.**

---

## Retrieval anti-patterns

- **Embeddings first.** The literature's ordering is unstable — swapping the embedding model moved accuracy 6.2 pp and changed which system looked better. Start with FTS5/BM25 over the raw log and add vectors only when you can name the vocabulary-mismatch failure you're fixing.
- **Top-k without a token budget.** Retrieval that can return 40K tokens is a context bomb. Retrieve by budget, not by rank count.
- **Similarity as authority.** The strongest single data-model finding: retrieval served the *superseded* value 15–40% of the time. Similarity finds *related*; only a validity filter finds *current*. Always filter `WHERE invalid_at IS NULL` for "current" queries, and keep a separate "as-of" query path for historical questions.
- **Unlabeled recall.** Removing a memory label increased over-trust across model sizes. Fence it as reference data with a staleness label — it costs three tokens.
- **Retrieving facts but not the events.** When a fact is contested, the agent needs the original transcript. Keep the pointer.
- **No dedupe across the injection boundary.** The same fact retrieved from FTS5 *and* the invariants file *and* the scratchpad is three copies of the same claim, which reads to the model as corroboration.

### FTS5 specifics, since you're likely using it

| Trap | Detail |
|---|---|
| **External-content tables drift** | With a non-empty `content=` option, "it is the responsibility of the user to ensure that an FTS5 external content table" stays in sync with its source [^3] | 
| **`snippet()` silently misbehaves** | `snippet()` fails with `detail=none`, `columnsize=0`, prefix queries, and the trigram tokenizer on external-content tables; contentless tables are unaffected because they report no instances with non-`full` detail [^4] |
| **Tokenizer choice is a schema decision** | You cannot change tokenizer without rebuilding the table. Choose once: `porter unicode61` for prose, `trigram` for identifiers and file paths. |
| **Rebuild is your recovery path** | Keep `INSERT INTO fts(fts) VALUES('rebuild')` in a script from day one, and test it. If the index is disposable, a corrupt index is a rerun. |

---

## Security anti-patterns

Beyond the ones I gave earlier:

- **Memory as an authorization signal.** "The user previously approved deploys" must never satisfy a permission gate. Memory influences reasoning; permissions come from a gate that fails closed.
- **Retrieved content writing to the durable tier.** This is provenance laundering, and it happens at consolidation, where filters don't look. Route anything sourced from a web page, README, tool output, or issue comment to a quarantine tier that is retrieved *labeled* and never promoted without you.
- **Global memory by default.** One `~/.pi/...` memory shared across all clients, repos, and contexts is a leak waiting for a client meeting. Per-project directories, explicit mapping, no ambient fallback.
- **Copying a reference implementation's defaults.** Graphiti ships telemetry on by default (opt out with `GRAPHITI_TELEMETRY_ENABLED=false`), and its reference servers have "no authentication, no authorization, and no prompt-injection protection… intentionally." Don't inherit either.
- **A "forget" that leaves copies.** Recovery files, backups, FTS5 shadow tables, embeddings, and your editor's undo history all retain the text. If you forget a credential, the delete is not the end of the job.
- **Confirmation prompts in shared code paths.** A memory extension that asks "save this?" on shutdown will hang a print-mode run.

---

## Evaluation anti-patterns — the ones that let you ship a broken system happily

1. **Benchmarking on LoCoMo.** 99 score-corrupting errors in 1,540 questions, a judge that accepted 62.8% of vague-but-wrong answers, and a ~93.6% practical ceiling. You will tune to noise.
2. **No baseline.** Without a "no memory" arm and a "full history" arm you cannot tell whether you added capability or just added tokens.
3. **Measuring recall instead of task success.** Retrieval hit-rate can improve while task completion drops — that's exactly the tool-drift and stale-memory pattern.
4. **Counting token savings as a win.** Break-even for fact-memory vs. long context was ~10 turns at 100K tokens. Cheaper and wrong is not cheaper.
5. **Testing with the same model that wrote the memory.** Over-trust in stale memory is *capability-gated* — bigger models resist simple conflicts but collapse hardest on sophisticated ones. Your test model and your write model should not be the same, and you should include a deliberately-stale-fact trap.
6. **No adversarial test.** Two cheap ones: paste an instruction into a file the agent reads, then check whether it lands in your durable tier; and ask "what's the current value of X" after changing X, three different ways.

---

## Process anti-patterns

- **Installing before measuring.** Run `pi -e npm:<pkg>` (loads for one invocation without writing settings) for a day first. Decide with evidence, not vibes.
- **Two memory extensions.** They both inject, both compact, both write — and they'll disagree. Pick one, or own the layer yourself.
- **LLM in the write path on every turn.** Extra latency, extra cost, and it puts consolidation — the exact stage where poisoning lands — on the hot path.
- **No kill switch.** A `PI_MEMORY_DISABLED=1` env check on line one, plus a `/memory off` command. You will need it during an incident, and you won't want to edit TypeScript then.
- **No manual edit path.** Human-editable markdown is a *security control* — it's how you correct a poisoned or stale record without an LLM. If memory is only writable by the model, you have no remediation.
- **Big-bang design.** Ship the invariants file first (zero code, highest measured value), then the log index, then facts. Each step should be independently useful and independently reversible.

---

## A pre-flight checklist

Before you write the first line, confirm you can answer these:

- [ ] Does memory enter as **transcript content** rather than system prompt, so the cached prefix stays stable?
- [ ] Is capture triggered from `agent_before_settle` / `session_shutdown`, never `agent_end`?
- [ ] Is ingestion restricted to `getBranch()`, so abandoned branches can't write?
- [ ] Is every write an **idempotent upsert on a content hash**?
- [ ] Can you answer "what is true now" and "what was true on date X" with two different queries?
- [ ] Is there a `tombstone` table, and is it checked before insert?
- [ ] Does anything originating outside the session write only to a quarantine tier?
- [ ] Can any memory record satisfy a permission check? (It must not.)
- [ ] Does the compaction hook ever return `cancel: true`? (It must not.)
- [ ] Is `details.readFiles` / `modifiedFiles` populated if you replace compaction?
- [ ] Does FTS5 `rebuild` work from a clean clone?
- [ ] Do you have a no-memory and a full-history baseline, plus one stale-fact trap, in your test set?
- [ ] Can you turn the whole thing off with one env var?

If all thirteen hold, the remaining risk is ordinary software risk — which is a much better position than most memory components ship in.

**References**

[^1]: [Extensions · Documentation · Pi](https://pi.dev/docs/latest/extensions) (72%)
[^2]: [Compaction Reference · Documentation · Pi](https://pi.dev/docs/latest/compaction) (1%)
[^3]: [SQLite FTS5 Extension](https://sqlite.org/fts5.html) (19%)
[^4]: [SQLite Bug Forum: FTS5 detail=none/column: snippet () fails with ...](https://sqlite.org/bugs/forumpost/6881501cdbab966b8ed2a2195afe3f0c03236d8d2186201f04a0812759d7cc77?t=c) (7%)

---

