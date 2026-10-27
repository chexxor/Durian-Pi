I can't write to `docs/reviews/` — the workspace is read-only for me — so here is the report in full, formatted for you to drop in as `docs/reviews/memory-followup-review.md`. Citations are inline with an evidence class in your vocabulary. Where I could not verify something, it says `unverified` rather than being folded into advice.

---

# Memory follow-up review

**Scope:** the eight questions left open by `docs/research/Adding_Memory_to_Pi_Agent_Harness.md`, for a 12-seat `pi-durable` rig with one shared store, push delivery, and cached-prefix-dominated inference cost. Written 2026-10-27. No code or docs other than this report were modified.

**Verification note (applies to every GitHub citation):** the repo pages below were read at `main` on 2026-10-27. Where a commit SHA was visible on the page I record it; where it was not, the citation is unpinned and should be re-pinned before anyone copies code. I did not clone or run any of these projects.

---

## 0. Verdict

The literature answers five of the eight questions well enough to act on, and answers three only partially. The load-bearing new findings are: **(a)** the multi-agent "one shared store" failure mode is formally named and has been *measured on a live service*, and the measured defects were exactly the ones that will bite this rig — scope enforced on the search path but not on the direct-read path, and a near-duplicate gate that silently eats the contradictory writes a supersession detector exists to resolve [^1]; **(b)** the bi-temporal result *does* transfer to software facts — on 130 mined SWE-bench transitions, deterministic supersession reached 0.91–0.99 accuracy where RAG reached 0.57–0.62 and served the superseded value 36–38% of the time when forced [^2] — but only on the ~18% of real fixes that reduce to a clean atomic value change [^abbe24#103], so item 165 must be sized for extraction coverage, not for the mechanism; **(c)** prompt-cache economics are measured on the cost/latency side only and the accuracy side of "inject at boundaries" is **not** measured anywhere I could find, so the "boundaries keep the prefix stable" rule is well-supported engineering arithmetic but an untested claim about accuracy; **(d)** the 5→100 skill collapse is superseded by a proper scaling law with per-model slopes, and for GLM-class models the 80%-routing threshold is **N ≈ 6–7 skills** [^3] — that kills any large flat skill library on the cheap seats; **(e)** "delete the record" is provably not forgetting in a stateful agent: memory deletion left leakage *exactly* where it was without deletion (any-leak 0.86/1.00/0.97 across three suites), and only checkpoint-and-replay reaches counterfactual equivalence, at a cost of T−τ+1 replayed transitions [^4]. That last one interacts badly with an immutable transcript and should reshape item 165 from "erasure" to "access-control forgetting plus a receipt".

---

## 1. Multi-agent memory: is one shared store a known failure mode?

**Yes, and it is the best-measured question of the eight.**

The closest work is a live-service measurement of a governed multi-agent memory service, with its own reproducible harness, published traces, and — unusually — its unflattering results kept in [^1]. It formalises four failure modes: **unauthorized leakage, stale propagation, contradiction persistence, provenance collapse** [^1], and reports each against a running REST service at N=200 per experiment.

| Finding | Measurement | Class | Source |
|---|---|---|---|
| Scope enforcement was **asymmetric across read paths** | Semantic search leaked 72/164 cross-fleet probes (0.439, 95% CI 0.365–0.516) while missing 4/28 entitled ones (0.143); direct GET-by-id *ignored* the resolved agent identity entirely, so a trust-1 agent read a cross-fleet row (HTTP 200 where the trust ladder requires deny) | `direct` | [^1] |
| The gap was a handler defect, not a credential-model artifact | Gateway resolved `agent_id` via `/whoami`; `get_memory` checked only the tenant predicate and discarded the identity | `direct` | [^1] |
| Remediation held | After fix, 96 GET-by-id probes: trust-1 cross-fleet 0/36 denied (404), trust-2 36/36 admitted, same-fleet 12/12 | `direct` | [^1] |
| **Dedup starves contradiction detection** | Conditional on both writes being admitted, supersession was correct **90/90**, stale-read rate 0/200 — but overall detection was only 98/200 because **206 of 400 writes were rejected 409 by a synchronous near-duplicate gate before the asynchronous contradiction detector ran** | `direct` | [^1] |
| Provenance chains reconstruct | 50/50 depth-4 chains complete, writer identity 1.000, p50 291 ms/hop | `direct` | [^1] |
| Intra-fleet propagation fine, cross-fleet zero | 117/120 sibling visibility (0.975); 0/80 cross-fleet leaks; the 3 misses were top-k ranking, not propagation | `direct` | [^1] |
| Write→visible ≈ one search round-trip | p50 0.83 s, max 1.97 s under strong mode, measured by tight per-fact polling | `direct` | [^1] |

Two of those deserve to be design rules here.

**Rule 1: a resolved identity is not an enforced identity.** The service's own authors note the handler "discharged only the tenant projection" of the scope predicate [^1]. For this rig, "one constitution and one store shared by all seats" is not itself the hazard — the hazard is that scope must be re-evaluated on *every* read path, including the by-id fetch that a wake primer or a claim message uses to pull a specific row. A single un-filtered `get-by-id` makes every scope column decorative.

**Rule 2: never let near-duplicate suppression sit upstream of contradiction resolution.** This is the most transferable finding in the paper. A contradiction phrased naturally ("X is A" then "X is B") *is* near-identical text, so the writes the detector exists to resolve are precisely the ones most likely to be rejected at the dedup gate [^1]. If the rig has any "don't store a fact we already have" guard — very likely, given a shared store and 12 writers — it will suppress corrections at a rate higher than it suppresses true duplicates, and the symptom will look like seats disagreeing forever.

Corroborating and adjacent work:

| Source | Claim | Class |
|---|---|---|
| MemIR, [arXiv:2605.25869](https://ar5iv.labs.arxiv.org/html/2605.25869) [^5] | Flat, unstructured storage induces **provenance-role collapse** — agents make source-monitoring errors about who said what. Directly relevant: a store that flattens twelve seats into one undifferentiated text pool loses the role that makes a fact trustworthy | `advertised-elsewhere` |
| Collaborative Memory, [arXiv:2505.18279](https://arxiv.org/abs/2505.18279) [^6] | Asymmetric, time-evolving access control encoded as bipartite graphs over users/agents/resources | `advertised-elsewhere` (code availability **`unverified`** — I did not locate a repository) |
| Mnemos, [github.com/Sohamp2809/mnemos](https://github.com/Sohamp2809/mnemos), MIT [^7] | Typed conflict resolution at ingestion (`supersede` / `replace` / `coexist`); 12.0% vs 7.0% dense-RAG ceiling on MemoryAgentBench multi-hop conflict. **But** its own README reports over-deletion: single-hop 32K context 65% vs naive 80%, 64K 55% vs 76%, because similar-but-unrelated facts about different entities trip the similarity threshold | `advertised-elsewhere` (self-run, 5 commits, last 2026-03-18, no paper) |

**Is role-scoped retrieval evaluated?** Not for *accuracy*. I found leakage and recall measurements [^1] and access-control frameworks [^6], but **no published evaluation of "retrieve only facts this seat may believe" as an accuracy intervention**. Treat that as `unverified`. The security half is measured; the quality half is not.

**What this changes:** the shared store is defensible, but only with (i) scope predicate re-checked on every read path, (ii) writer identity and role carried on every row and surfaced in the injected text, and (iii) dedup and supersession as *separate* stages with supersession first when a structured triple is present.

---

## 2. Does bi-temporal / supersession transfer to software-engineering agents?

**Yes, and this is the strongest single result in the follow-up. The scope is narrower than the headline.**

From 707 real GitHub issues (SWE-bench Lite + Verified) the authors extracted **130 clean atomic state transitions** (18.4%) — a fix that changes one identifiable value from pre-fix to post-fix form — and rendered each *marker-free*, so the only currency signal is order [^2] [^2].

| Metric (130 paired scenarios) | naive RAG | advanced RAG (+ reranker) | deterministic supersession |
|---|---|---|---|
| Accuracy, abstention allowed | 0.569 | 0.585 | **0.908** |
| Accuracy, forced to answer | 0.615 | 0.592 | **0.985** |
| Stale-fact-error, allowed | 0.262 | 0.262 | **0.023** |
| Stale-fact-error, forced | 0.361 | 0.377 | **≈0.00** |
| Conditional fabrication, forced | 0.654 | 0.651 | **0.341** |
| Active facts | 260 | 260 | 135 (48% compression) |
| Mean retrieval latency | 2.16 s | 18.1 s | 2.13 s |

`direct` — [^2]

Three things matter more than the headline:

1. **The reranker does not help.** A learned reranker served stale *slightly more* (0.377), because reranking reorders chunks but has no temporal signal [^2]. This closes a path a reasonable designer would otherwise take. Cosine similarity plus better ranking is not a substitute for validity intervals.
2. **The concrete examples are exactly this rig's fact types.** The appendix shows `The function that handles login in api/auth.py` → renamed; `The API base path for the project is /api/v1` → `/api/v2`; `The fastapi version pinned in requirements.txt is 0.95.2` → `0.110.0` [^2]. API versions and deploy targets are in-distribution. "Which branch is authoritative" is arguably in-distribution as a single-valued predicate, **but** its supersession source is a human decision rather than a diff — `unverified` for that case. File ownership is single-valued and should transfer, `unverified`.
3. **A real bug in the paper's own product is the best lesson.** Value comparison lowercased and stripped punctuation, so `Status('Good')` → `Status['GOOD']` and `/API` → `/api` were read as *duplicates*, the stale value survived, and the change was silently dropped [^2]. In a rig where a seat writes `/API/v2` and another writes `/api/v2`, this bug is guaranteed. Value comparison must be whitespace-collapsed but case- and punctuation-**sensitive**.

**The honest limit:** only ~18% of real fixes are clean atomic transitions; the rest are multi-file refactors, logic changes, or several values at once [^abbe24#103] [^2]. The paper is explicit that it measures "the mechanism, given clean extraction, on real data" [^2]. Sample is 130, single 7B model (Qwen2.5-Coder-7B), author is a vendor (MemStrata.dev / Called It Inc.), draft v1, not peer-reviewed.

**What this changes:** item 165 should be split. The **mechanism** is validated and cheap (2.13 s, RAG-latency, 48% compression). The **extraction coverage** is the open problem and the real cost: an LLM patch-reader that emits a single atomic change or declines, plus a deterministic guard (both values atomic, ≤40 chars / ≤4 tokens, differ, no recency words) [^2]. Size the item as "extraction pipeline + coverage measurement", not "supersession rule".

---

## 3. Delivery timing and prompt-cache interaction — measured?

**Half measured, half not. This is the weakest evidence base of the eight, and the part that is missing is the part you need.**

What *is* measured, on 500 agent sessions with 10,000-token system prompts across three providers and four models [^8]:

| Result | Value | Class |
|---|---|---|
| Cost reduction from caching | 41–80% | `direct` |
| TTFT improvement | 6–31% | `direct` |
| Differences **between** cache strategies, cost | typically within 2–4 pp — the system prompt drives almost all of it | `direct` |
| Naive full-context caching can *increase* latency | GPT-4o TTFT −8.8%; Gemini 2.5 Pro "exclude tool results" −2.9% | `direct` |
| Cost savings scale with prompt size | 10–45% at 500 tokens → 54–89% at 50k tokens | `direct` |
| Savings vs tool-call count | stable within ~10 pp | `direct` |
| Minimum cacheable prefix | 1,024 tokens (OpenAI, Anthropic); 4,096 (Google) | `direct` |

And one finding that cuts straight at compaction: *"Techniques such as summarizing or pruning old tool calls break cached representations, making tool call caching counterproductive"* [^8].

**What is not measured:** there is **no** study I could find comparing (a) per-request dynamic injection, (b) boundary-triggered injection (session start / claim / compaction), and (c) static-instruction-only, reporting **both** task accuracy and provider-side cache hit rate. The caching paper reports cost and TTFT only — no task accuracy [^8].

So the honest state of the claim:

| Claim | Status |
|---|---|
| Dynamic content in the system prompt destroys prefix reuse | `direct` — it is the mechanism the paper's no-cache baseline simulates with a UUID [^8] |
| Putting dynamic content at the *end* of the system prompt preserves most of the cacheable prefix | `direct`, as guidance, evidenced by the system-prompt-only strategy [^8] [^8] |
| Boundary-triggered injection *costs accuracy* relative to per-request injection | **`unverified`** — no measurement located |
| Boundary-triggered injection *saves money* | Arithmetically yes at these price ratios; the run-level measurement is `unverified` for this specific comparison |
| `AIza`-style "cache hit rate below 60% signals dynamic data leaking into the prefix" | `community` — practitioner guidance, [digitalapplied.com](https://www.digitalapplied.com/blog/prompt-caching-2026-cut-llm-costs-engineering-guide), not peer-reviewed |

For the seats specifically: cached input is priced at a steep discount (one third-party survey reports 0.032× base on DeepSeek and $0.1955 vs $1.19 per 1M on GLM-5.3) — `community`, [morphllm.com](https://www.morphllm.com/prompt-caching), pricing changes and must be re-read from the provider. If those ratios hold, a per-request dynamic preamble that shifts the prefix costs roughly 30× the cached rate for every token after the divergence point, which is a strong economic argument for boundary injection *regardless* of the accuracy question.

**What this changes:** the sequencing decision is defensible, but the justification must be stated as **cost + cache-hit**, and the accuracy side must be treated as an open question to be measured, not a settled tradeoff. Also: keep tool definitions byte-stable per seat. A dynamic tool set invalidates the prefix just as surely as dynamic text [^8], and this rig's tool surface is exactly the kind of thing that drifts.

---

## 4. Origin-bound write gates that are actually implemented

**Short answer: the permissively-licensed implementations are thinner than the papers suggest, and the strongest one is a notebook.**

| Project | What it actually is | Licence | Class | Verdict |
|---|---|---|---|---|
| **Fides** — [github.com/microsoft/fides](https://github.com/microsoft/fides) [^9] | "This repository contains a Jupyter notebook to accompany the academic paper." 5 commits, 124 stars, README is a tutorial wrapper around `Tutorial.ipynb` [^9] [^9] | **MIT** (stated on repo page) [^148f2d#186] | `observed` | **Permissively licensed, but not a maintained library.** Read it for the label-propagation design; do not treat it as a dependency |
| FIDES as product middleware | Microsoft Learn documents FIDES as information-flow-control middleware for Agent Framework agents, "enforces policies before sensitive tools run" | proprietary/product | `advertised-elsewhere`, [learn.microsoft.com](https://learn.microsoft.com/en-us/agent-framework/agents/security) | A real integration exists, but not as source you can copy |
| **CaMeL** — google-research/camel-prompt-injection | Apache-2.0; self-described research artifact, "likely contains bugs… might not be fully secure… not a Google product… not planning to provide support" | Apache-2.0 | `observed` | Design reference only |
| **Mnemos** [^7] | Conflict resolution at ingestion, per-agent `read`/`write` flags on `Agent(...)`, provenance log. But its "access control" is a boolean per agent, not a provenance-derived authority judgement | **MIT** | `observed` | Closest thing to copyable *shape*; enforcement point is `remember()`, which is the right place |
| **Lethe** [^10] | No write-time authority model; purge is the interesting primitive | **MIT** | `observed` | Not an answer to this question |

**What none of them give you:** a maintained, permissively-licensed component that (i) binds authority to provenance at write time and (ii) enforces a quarantine tier for retrieved-content-derived writes. Fides has the *schema* (confidentiality + integrity labels on values, deterministic sink gating) in notebook form; Mnemos has the *enforcement point* (ingestion) but not provenance-derived authority.

**What to copy, concretely** — the shape that satisfies the requirement without any dependency:

1. Every write carries `writer_seat`, `writer_role`, `source_kind` (`seat_authored` | `tool_output` | `retrieved_doc` | `external_message`), and `source_ref` (a transcript row id).
2. A deterministic gate at the single write entry point: `source_kind ∈ {tool_output, retrieved_doc, external_message}` ⇒ force `tier = 'quarantine'`, never negotiable by the caller.
3. Retirement reads only `tier = 'durable'`. Quarantine rows are retrievable **labeled**, and promotion requires a human action recorded as its own event.
4. Scope predicate evaluated in the one function that returns rows, not in callers. Re-check on by-id fetch.

That is ~40 lines and it is the only security control in this literature measured at 0% attack success under the origin-binding variant.

---

## 5. Verifiable forgetting across derived stores

**This question has a much better answer than the "1.5%" figure I gave you earlier — and the answer is worse news.**

First, a correction: I cannot re-verify the "best system 1.5% end-to-end compliance" figure from this round's sources. Demote it to `unverified`. The replacement is stronger and traceable.

### 5a. Deletion is provably not forgetting

A 2026 paper formalises **execution-state unlearning**: after a forget request the agent must behave as if it had never observed the target, and proves that exact unlearning requires at least **T−τ+1 recomputed transitions** (τ = the target's injection step) [^4].

| Method | any-leak (LME / ToolSandbox / AgentDojo) | Leak@probes | Behavioural extraction |
|---|---|---|---|
| B0 no-forget | 0.86 / 1.00 / 0.97 | 1.00 | 1.00 (acts on revoked preference 100%) |
| **B1 memory-delete** (what deployed stacks do) | **0.86 / 1.00 / 0.97 — identical to B0, p=1.0** | — | 1.00 |
| B2 forget-instruction | 0.38 / 0.72 / 0.00 | **1.00 on all three suites** — suppressed, still resident | 1.00 |
| B3 source-redaction | 0.84 / 0.94 / 0.39 — summary re-emits it in paraphrase | 0.73 / 0.80 / 0.97 | **0.80 still acts on it while emitting the string zero times** |
| B8 IFC only (FIDES-style) | leaks at the B0 rate through free text (0.92–1.00) | — | — |
| B4 descendant closure, no replay | 0.00 | 0.00 | but over-deletes (CAD 0.23) |
| B7 selective replay | 0.00 | 0.00 | 0.00 — matches full reset, 133 vs 1235 tokens (9.3× fewer) |

`direct` — [^4] [^4]

Four results are design-relevant:

- **Deleting the record changes nothing.** B1 equals B0 in every cell [^4].
- **String metrics certify precisely the methods that fail.** Source redaction leaves the agent acting on a revoked preference in 80% of episodes while emitting the forbidden string zero times [^4].
- **Span-only excision is unsafe**: it still leaks in up to 93% of episodes, and its counterfactual-action distance (0.47) is *worse* than no forgetting at all (0.38), because deleting mid-context positions corrupts state the model then misreads [^4].
- **IFC does not clean resident state.** An information-flow-control-only baseline leaks at the no-forget rate; adding replay drops it to zero — "state cleanup and flow control are orthogonal" [^4].

**Consequence for this rig, stated plainly:** the raw transcript is durable and immutable, so any fact a seat has ever read is permanently present in the substrate. Exact forgetting is therefore only achievable by replaying from a checkpoint before the injection, at T−τ+1 cost. If the rig cannot pay that, then "forgetting" must be honestly renamed **access-control forgetting**: tombstone + exclusion from every read path + no re-derivation from the tainted range. That is a legitimate goal. It is not erasure, and a receipt that says otherwise is misleading.

### 5b. What a receipt can and cannot prove

Lethe ([github.com/deeplethe/lethe](https://github.com/deeplethe/lethe), **MIT**, 86 commits, last commit `b6053b7` 2026-06-16, v1.0.0-alpha, 14 tests) [^10] implements the receipt primitive: every signed purge returns an **Ed25519-signed receipt anchored to a Merkle root over the event log**, so tampering with any past event makes the receipt fail verification [^10]. It also adds `AUTOINCREMENT` to `memory.rowid` specifically so SQLite cannot reuse a purged row's id and let a later write impersonate the erased one [^9ad190#47].

What that proves: **the log is intact and the purge is recorded at a point in an append-only history.** What it does not prove: that no copy survives in a summary, a KV cache, a backup, or a seat's context. Do not let it be sold internally as erasure.

### 5c. The better evaluation you asked for

Lethe ships **ForgetEval** (arXiv:2606.15903), which is the evaluation beyond the 1.5% figure [^10]:

| Suite | Lethe | LangMem/LangGraph | Mem0 | MemPalace |
|---|---|---|---|---|
| 1,000-case template (5 families) | 99.3% | 99.5% | 88.8% | 0% |
| 385-case **adversarial** (10 categories) | 63.4% | 62.9% | **68.3%** | 0% |

`advertised-elsewhere` (vendor-authored, but it publishes competitor numbers including where it loses) — [^10]

The honest reading: **the template suite is saturated** (deterministic stores with adaptive eviction all clear 99%), so anyone quoting ~99% forgetting accuracy is quoting a test that no longer discriminates. The adversarial suite is the discriminative one, and three deterministic systems cluster in a 63–68% band with overlapping Wilson intervals — i.e. **no winner**. The +28 pp lift to 91.7% comes from an LLM hook at mutation time, not from the store [^10]. And identifiers are the weak spot: Lethe scores 0% on cross-lingual identifiers because the purge path is deliberately pure BM25 [^9ad190#48] [^10]. For this rig, whose identifiers are file paths and branch names, a **lexical** purge path is the right choice and 0% on cross-lingual is irrelevant.

Other claimed work I could only verify at abstract level: ForgetAgent ([IJRASET](https://www.ijraset.com/research-paper/forgetagent-verifiable-deletion-in-multi-layer-memory-architectures-for-llm-agents) [^11]) claims a formal framework and reference implementation — **`unverified`** as to licence and repo; "Do Agents Truly Forget?" lifecycle benchmark ([OpenReview](https://openreview.net/forum?id=LeWrK9dkR6) [^12]) and [arXiv:2610.17659](https://arxiv.org/html/2610.17659v1) [^13] exist — `advertised-elsewhere`, methodology not read.

**What this changes:** item 165 should be re-scoped to **access-control forgetting with a tamper-evident receipt**, plus an explicit written statement that exact erasure requires replay and is out of scope unless the rig is willing to pay T−τ+1. Adopt Lethe's `lexical=True` purge idea (deleting `alice@acme.io` is a lexical lookup, not a semantic one) and its one-way-purge rowid invariant, both of which are ~10 lines in SQLite.

---

## 6. Procedural memory sizing — at what library size does selection stop working?

**The 5→100 collapse figure is superseded. There is now a fitted law, with per-model slopes, and the numbers for the cheap seats are brutal.**

Across 15 frontier LLMs, 1,141 real software-agent skills, and >3M routing decisions: single-step routing accuracy follows **Acc(N) = a − b·ln N**, with R² > 0.97 for every model [^3] [^3]. Roughly, **each doubling of the library costs ≈3 percentage points** [^3].

| Model (relevant to this rig) | decay slope *b* | **N\* at 80% accuracy** |
|---|---|---|
| GPT-4o-mini | 0.065 | 4 |
| **GLM-5** | 0.062 | **6** |
| **GLM-4.7** | 0.060 | **7** |
| Doubao Seed 2.0 Pro | 0.055 | 11 |
| Kimi K2.6 / K2.5 | 0.053 / 0.052 | 14 / 15 |
| GPT-5-mini | 0.049 | 23 |
| Qwen3-235B | 0.049 | 25 |
| **DeepSeek-V4 Pro** | 0.046 | **36** |
| Claude Sonnet 4.6 | 0.044 | 50 |
| Claude Opus 4.6 | 0.041 | 96 |
| GPT-5.4 | 0.031 | 1,246 |

`direct` — [^3]

Gemma was not tested, so treat its N\* as `unverified`; by slope it will sit near or below the GLM row.

Three control results make this credible rather than an artefact:

- **It is not just context length.** Holding the candidate-token budget fixed at ~5,176 tokens and varying only the number of selectable skills: 60.5% at N=10 → 49.5% at N=150 [^3].
- **It is not generic difficulty.** The task pool is held fixed; only distractors are added, domain-stratified [^3].
- **Lexical retrieval wins at scale.** At N=200, BM25 scored **78.0%** against GPT-5.4-mini's **60.7%** — the LLM router is better at small N and worse at large N, because it is vulnerable to capture by broad "black-hole" skills that lexical matching cannot see [^3] (dense BGE: 80.0%).

And the fix is library-side, not model-side: boundary rewriting (+12.8 pp) plus abstract-skill removal (+4.9 pp) took held-out routing from 71.3% → 91.7% and hijack 22.4% → 4.1%, with the router, task set, prompt template, and parser all held fixed [^3]. Pushing descriptions apart for danger-zone pairs (cosine 0.55–0.75) gave +18.4% [^3].

Supporting work, abstract-level only: *More Skills, Worse Agents? Skill Shadowing* ([arXiv:2605.24050](https://arxiv.org/pdf/2605.24050) [^14]) and SPEM ([arXiv:2610.26995](https://arxiv.org/html/2610.26995v1) [^15]) — `advertised-elsewhere`.

**What this changes:** for a GLM/DeepSeek-class seat, an LLM-routed flat skill library above roughly **6–8 skills** is already below 80% routing accuracy, and above ~36 for DeepSeek-V4 Pro. The `N≈150` the authors use as a realistic deployment size would be catastrophic on these models. Either (i) keep the exposed set tiny and rewrite boundaries, or (ii) drop LLM routing for lexical retrieval plus a top-k gate, which is both cheaper and, at large N, more accurate. This should kill any plan to let the skill library grow past single digits per seat.

Caveat: single-vendor paper (Evolvent AI), not peer-reviewed; plain-text flat-library protocol; N\* extrapolated from a log fit within N ∈ {10…500}; the authors flag that retrieval-gated or hierarchical exposure may change the slope [^3] [^3].

---

## 7. A defensible internal A/B methodology

**No published worked example from a coding-agent shop exists.** I looked; this is `unverified` as an absence. What does exist is a set of transferable methodological controls, three of which are strong enough to adopt wholesale.

| Control | What it is | Why it matters here | Class / source |
|---|---|---|---|
| **Measured false-positive floor per probe** | Run every audit probe against the clean reference state; drop any probe that fires there. The unlearning study used this to *exclude an LLM judge* with a 0.34 floor | This is the direct antidote to the 62.8%-lenient-judge problem: instead of arguing about judge quality, you measure and discard probes the judge gets wrong on a known-clean input | `direct` — [^4] |
| **Paired, cached scenarios** | Build the scenario set once, cache it, run every arm from the same cache so arms are paired on identical instances; verify bit-for-bit reproduction of one arm | Removes scenario-construction variance, which is the dominant confound when extraction is LLM-driven | `direct` — [^2] [^2] |
| **Paired bootstrap over shared instances** | n=500 common instances, B=10,000, report CI + two-sided p. Their table shows why: several apparent win/loss deltas were non-significant | Prevents shipping a −2.0 pp "regression" that is p=0.21 | `direct` — [^16] [^16] |
| Pairwise significance | McNemar (binary) / Wilcoxon (continuous), paired throughout | Appropriate for per-task replay | `direct` — [^4] |
| Report the abstention and forced regimes separately | Forced-to-answer exposes stale commitment that abstention hides (0.262 allowed vs 0.361 forced) | Seats rarely abstain — they commit. The forced regime is the realistic one | `direct` — [^2] |
| Metric ladder, not a single score | Primary = answer-level stale-fact-error; then accuracy; then fabrication; then mechanism diagnostic | A mechanism diagnostic (supersession correctness) can be 0.985 while the outcome metric is what matters | `direct` — [^2] |

**A concrete design for this rig**, assembled from those controls:

1. **Replay substrate:** the immutable transcript rows are a genuine asset here — pick 40–60 already-completed tasks per arm, replayable deterministically.
2. **Four arms, paired:** (A) no memory, (B) full history in context, (C) the memory design under test, (D) memory with the write gate disabled. (D) is the one people omit and it is how you find out whether the gate is doing anything.
3. **Two trap sets:** a **stale-fact** set (change a value mid-task three different ways — inline edit, tool output, another seat's message) and a **poisoning** set (a retrieved file or tool output containing an instruction; check whether it reaches the durable tier).
4. **Judging:** prefer substring/exact-match and behavioural probes over an LLM judge. If a judge is unavoidable, measure its false-positive floor on the clean arm and drop probes below that floor.
5. **Statistics:** paired McNemar/Wilcoxon, report CIs, and pre-register the primary metric before running.
6. **Report cost and cache-hit rate alongside accuracy** — otherwise you cannot tell a memory win from a token win.
7. **Report evidence class per row**, as this document does, so a later reader can tell a measurement from a README claim.

---

## 8. Cheaper-first context levers: masking vs summarization in coding agents

**Your sequencing is right, with one qualification the headline hides.**

The Complexity Trap benchmarks exactly this on SWE-bench Verified, five model configurations, in SWE-agent, with an OpenHands generality probe [^16]:

| Model | Strategy | Solve rate | Cost/instance |
|---|---|---|---|
| Qwen3-Coder 480B | Raw | 53.4% | $1.29 |
| | **Observation masking** | **54.8% (+2.6%)** | **$0.61 (−52.7%)** |
| | LLM-summary | 53.8% (+0.7%) | $0.64 (−50.4%) |
| Gemini 2.5 Flash | Raw | 32.8% | $0.41 |
| | Observation masking | 35.6% (+8.5%) | $0.18 (−56.1%) |
| | LLM-summary | 36.0% (+9.8%) | $0.24 (−41.5%) |
| Qwen3-32B | Raw | 17.0% | $1.12 |
| | Observation masking | 15.0% (−11.8%, p=0.21) | $0.55 (−50.9%) |
| Gemini 2.5 Flash (thinking) | Raw | 40.4% | $0.56 |
| | Observation masking | 36.4% (−9.9%, **p=0.04**) | $0.24 (−57.1%) |
| | LLM-summary | 31.4% (−22.3%, p<0.0001) | $0.25 (−55.4%) |

`direct` — [^16] [^16]

**The qualification:** masking is cheaper than summarization and ≥ it on solve rate in 4 of 5 configurations, but it is not uniformly safe *against the raw agent* — one config showed a significant solve-rate loss (Gemini 2.5 Flash thinking, −4.0 pp, p=0.04) and another a non-significant one (Qwen3-32B, −2.0 pp, p=0.21). So "masking is free" is `unverified` and in one measured case false. It is *cheaper than summarizing*, which is the claim your sequencing needs.

Four mechanisms are worth carrying over:

- **Observations dominate.** ~84% of an average SWE-agent turn is environment observation tokens [^16] — so targeting observations is where the leverage is, and it justifies masking over summarization on cost grounds alone.
- **Summaries cause trajectory elongation.** LLM-Summary produced 15% longer mean trajectories than masking on Gemini Flash (52 vs 44 turns), hypothesised to mask failure signals that would otherwise prompt earlier termination [^16]. In a long-lived seat this is a compounding cost, not a one-off.
- **Summary calls are cache-hostile.** Summary generation is up to 7.2% of instance cost, and "each requires processing a unique sequence of turns, limiting cache reuse" [^16]. This is the direct bridge to §3.
- **The mask window is scaffold-specific.** Reusing SWE-agent's M=10 on OpenHands "degrades drastically" until retuned [^16]. Each seat type will need its own M, and that is a per-seat tuning parameter, not a global constant.
- **The hybrid is the best measured point:** masking during accumulation, summary as a last resort at N=43 — 7% cheaper than masking alone, 11% cheaper than summary alone, **and +2.6 pp solve rate** [^16].

**One thing I will not claim:** that pointer-preserving masking beats placeholder masking. The 94.8% LongMemEval-S figure I cited earlier came from the atlas and I could not re-verify it this round — mark it `unverified`. The argument for pointers here is architectural (the transcript is durable, so re-fetch is nearly free) rather than measured.

**What this changes:** items 92–97 and the compaction work should indeed land before any memory write path. Sequence: observation masking with a tuned window → pointer-preserving variant of the same → hybrid (summary only for very long trajectories) → memory. Do not start with summarization; it is the more expensive and, on these numbers, no more accurate option.

---

## 9. What this changes in `docs/ROADMAP.md` items 161–169

I do not have the contents of items 161–169, so I cannot name them individually without inventing them. Mapping by question instead; each line should be applied to whichever item covers that topic, and any item whose scope conflicts with the right-hand column should be revised or closed.

| Item topic (map by content) | Change | Strength |
|---|---|---|
| Shared-store governance | **Add**, don't replace: scope predicate re-checked on **every** read path including by-id; writer identity + role stored and surfaced. Do not treat "one store" as the hazard — treat "one read path that skips the predicate" as the hazard [^1] | `direct` |
| Dedup vs supersession | **Split into two stages**, supersession first when a structured triple is present. A 409-on-near-duplicate gate silently destroys 51% of the corrections a detector would otherwise resolve [^1] | `direct` |
| Bi-temporal facts (item 165) | **Split.** Mechanism: ship it — validated on real GitHub history at RAG latency with 48% compression [^2]. Extraction: separate item with its own coverage metric (~18% of real fixes are clean atomic transitions) [^abbe24#103] | `direct` |
| Value comparison | **Add a hard requirement**: case- and punctuation-sensitive, whitespace-collapsed. The paper's own product shipped the bug that `/API` → `/api` is a duplicate and the stale value survives [^2] | `direct` |
| Boundary injection / cache | **Restate the justification as cost + cache-hit only.** The accuracy half is `unverified`; do not claim boundary injection is accuracy-neutral | `unverified` on accuracy |
| Tool-definition stability | **Add**: tool definitions must be byte-stable per seat; a dynamic tool set invalidates the prefix as effectively as dynamic text [^8] | `direct` |
| Origin-bound writes / quarantine | **Do not adopt a dependency.** Fides is MIT but is a tutorial notebook [^9]; CaMeL is an unmaintained research artifact. Implement the four-field provenance + deterministic quarantine gate (~40 lines) | `observed` |
| Verifiable forgetting (item 165 if merged) | **Re-scope from "erasure" to "access-control forgetting + tamper-evident receipt."** Deletion is a behavioural no-op (B1 = B0, p=1.0) [^4]; exact erasure requires T−τ+1 replay [^4]. State the limit in writing | `direct` |
| Forget-receipt evaluation | If you cite a forgetting score, cite the **385-case adversarial** number, never the saturated 1,000-case template one [^10] | `advertised-elsewhere` |
| Skill/procedural memory sizing | **Cap the exposed surface at ~6–10 skills per GLM-class seat** (N\* = 6–7 at 80% routing) [^3]; or switch to lexical retrieval + top-k gate, which beat LLM routing at N=200 (78.0% vs 60.7%) [^3] | `direct` |
| Skill-library maintenance | **Add** boundary rewriting + abstract-skill removal as a library-side intervention: +20.4 pp accuracy and −18.3 pp hijack with the router held fixed [^3] | `direct` |
| Compaction / context items 92–97 | **Confirm the sequencing.** Masking first, summaries last-resort, hybrid best measured point [^16]. Note masking is not uniformly accuracy-safe vs raw (−4.0 pp, p=0.04 in one config) | `direct` |
| Evaluation methodology | **Add** the false-positive-floor rule, paired cached scenarios, and paired bootstrap — before any of the above ships [^4] [^2] [^16] | `direct` |

**Two items I would actively kill**, if they exist in that range: any plan that (i) treats deletion of a memory row as satisfying a forgetting requirement, or (ii) grows a flat LLM-routed skill library on the cheap seats. Both are measured dead ends.

---

## 10. Open questions

1. **Does boundary-triggered injection cost accuracy?** No measurement exists. This is the single most decision-relevant gap, and it is measurable inside a week on the replay substrate: three arms, same tasks, report solve rate *and* provider-reported cache-hit tokens.
2. **Does role-scoped retrieval improve accuracy, not just security?** Nobody has measured "retrieve only what this seat may believe" as a quality intervention. There is a plausible negative: filtering by role may remove exactly the cross-role context that lets a worker anticipate a verifier's objection.
3. **What is the extraction coverage rate for this codebase's own change types?** The 18.4% figure is for SWE-bench fixes. A monorepo with feature work, config changes, and dependency bumps will have a different rate, and that number — not the 0.91 accuracy — determines whether item 165 pays.
4. **Does the supersession result hold when the authoritative source is a human decision rather than a diff?** "Which branch is authoritative" and "who owns this file" have no patch to mine. `unverified`.
5. **What is the right quarantine promotion path?** Every framework has a tier; none measures how often a human actually reviews the queue. A quarantine nobody reads is a slower version of no quarantine.
6. **Does forgetting replay compose with a 12-seat shared store?** The T−τ+1 bound is for a single session. With twelve readers, the divergence set is the union of every seat's post-τ suffix. Cost may be structurally prohibitive, which would settle item 165 as access-control-only by arithmetic rather than by choice.
7. **How does masking interact with per-seat model heterogeneity?** The window size is scaffold-specific and was tuned per model config [^16]; twelve seats on three model families may need three windows and a documented rule for which seat gets which.
8. **Do the skill-library slopes hold for *seats* rather than single-turn routers?** The law is fitted on single-step plain-text routing. A seat with a warm, task-specific context may sit on a different curve.
9. **What is the false-positive floor of whatever judge this rig ends up using?** Unmeasured until someone measures it, and everything downstream of an unmeasured judge is unfalsifiable.

---

### Provenance of this document

Claims are marked `direct` where the cited source reports a measurement it performed, `advertised-elsewhere` where the claim is a vendor's or paper's own summary I did not independently check, `observed` where I read a repo page or licence text, and `unverified` where I could not locate a source, a licence, or a measurement. GitHub citations are at `main` as of 2026-10-27; commit SHAs are given where the page exposed them (Lethe `b6053b7`, 2026-06-16; Mnemos `ed73265`, 2026-03-18) and are absent for Fides, so re-pin before copying anything. Three claims carried over from the previous round — the 1.5% end-to-end forget compliance, the 94.8% pointer-eviction result, and the 3,283-paper synthesis — I could not re-verify in this round and have marked accordingly rather than repeat them as fact.

**References**

[^1]: [[2606.24535] Governed Shared Memory for Multi-Agent LLM Systems](https://arxiv.org/abs/2606.24535) (17%)
[^2]: [[2608.20685] Temporal Validity on Real Software Histories: Eliminating Stale-Fact Errors in Code-Assistant Memory over GitHub Fixes](https://arxiv.org/abs/2608.20685) (12%)
[^3]: [[2605.16508] The Scaling Laws of Skills in LLM Agent Systems](https://arxiv.org/abs/2605.16508) (16%)
[^4]: [[2609.04875] Forgetting Without Restarting: Execution-State Unlearning for Stateful LLM Agents](https://arxiv.org/abs/2609.04875) (16%)
[^5]: [[2605.25869] Mitigating Provenance-Role Collapse in Long-Term Agents ...](https://ar5iv.labs.arxiv.org/html/2605.25869) (1%)
[^6]: [Collaborative Memory: Multi-User Memory Sharing in LLM Agents with ...](https://openreview.net/forum?id=pJUQ5YA98Z) (0%)
[^7]: [GitHub - Sohamp2809/mnemos: Open-source memory layer for multi-agent LLM systems. Typed conflict resolution ensures agents share accurate, up-to-date knowledge stale facts are detected and resolved at ingestion, not left for the LLM to guess. · GitHub](https://github.com/Sohamp2809/mnemos) (0%)
[^8]: [[2601.06007v2] Don't Break the Cache: An Evaluation of Prompt Caching for Long-Horizon Agentic Tasks](https://arxiv.org/html/2601.06007v2) (7%)
[^9]: [GitHub - microsoft/fides: Flow Integrity Deterministic Enforcement System. Mechanisms for securing AI agents with information-flow control. · GitHub](https://github.com/microsoft/fides) (1%)
[^10]: [GitHub - deeplethe/lethe: The best-benchmarked open-source AI memory system and the first AI memory built to forget. · GitHub](https://github.com/deeplethe/lethe) (7%)
[^11]: [ForgetAgent: Verifiable Deletion in Multi-Layer Memory Architectures ...](https://www.ijraset.com/research-paper/forgetagent-verifiable-deletion-in-multi-layer-memory-architectures-for-llm-agents) (1%)
[^12]: [Do Agents Truly Forget? A Lifecycle Benchmark and ...](https://openreview.net/forum?id=LeWrK9dkR6) (0%)
[^13]: [Can Agents Truly Forget? Explore Machine Unlearning for ...](https://arxiv.org/html/2610.17659v1) (0%)
[^14]: [More Skills, Worse Agents? Skill Shadowing Degrades Performance When ...](https://arxiv.org/pdf/2605.24050) (0%)
[^15]: [Structure-Aware Procedural Memory for Efficient Skill Use ...](https://arxiv.org/html/2610.26995v1) (0%)
[^16]: [[2508.21433] The Complexity Trap: Simple Observation Masking Is as Efficient as LLM Summarization for Agent Context Management](https://arxiv.org/abs/2508.21433) (21%)


https://github.com/chexxor/Durian-Pi
Here is my project. Please update your response accordingly.


I'll read your repo first, then revise the report against what you've actually built.## What changes now that I've read the repo

Six things in my earlier report were wrong or moot for *this* project, and three things are cheaper than I assumed because pi-durable already ships them.

**Wrong/moot:**

1. Everything I said about `pi install`, `pi-memory`, `pi.sendMessage`, `session_start`/`agent_settled`, `getBranch()`, and prompt-cache invalidation via system-prompt edits was advice for the **pi coding-agent** harness. Durian-pi seats are `pi-durable` conversations with a different extension API (`defineExtension({name, sections, tools, hooks, tasks, wraps})`), no interactive surface, and coding-agent extensions cannot load here [^1]. Scrap that whole layer.
2. My §3 conclusion reverses in your favour — see §3 below.
3. My SQLite `fact` table should be a `defineDoc` document, not a table — see §2.
4. My "add a human-authored INVARIANTS.md" item is already built: `constitution.txt`/`constitutionInline` is injected into every seat's system prompt [^1] [^802424#264]. That was the zero-code highest-value item, and you shipped it.
5. My A/B methodology section should reuse `metrics`/`check` rather than invent a parallel rig — you already carry bands, baselines, evidence class, and blind spots, plus the active extension set per reading [^1].
6. "One shared store is a hazard" needs sharpening: in your harness the units are seats-as-conversations over one durable store [^1], so the failure mode is *cross-seat read paths*, not the store.

**Cheaper, because the harness already has it:**

| Primitive I recommended | Already in pi-durable |
|---|---|
| Raw log canonical, nothing deleted | "The older messages always stay in storage" [^2] |
| Typed state | `defineDoc` — typed JSON committed atomically with the transcript, `history: "rewindable"`, `fork: "asOf"` [^2] |
| Pointer-preserving recall | `reset(note)` + a `search_history` tool, demonstrated in the docs in ~20 lines [^2] |
| Harness-delivered recall | `sections` are async functions re-rendered before every request, and can read documents [^2] [^2] |
| Per-seat tool scoping | Conversations store extension/tool names; `configure({tools:{remove:[...]}})` [^2] [^53a64e#339] |

So the memory work is smaller than item 165 implies, and the risk is more concentrated than the plan assumes.

---

# Memory follow-up review (rev. 2, for durian-pi)

**Target:** durian-pi @ `b4c86ea` (main, 2026-10-25) [^802424#29]. Harness: `@earendil-works/pi-durable`. Evidence classes use `docs/METRICS.md` vocabulary (`direct` / `proxy` / `config-derived`), plus `advertised-elsewhere`, `community`, `observed`, `unverified`.

---

## 0. Verdict

The research answer to your eight questions is unchanged. What changes is the **engineering**: pi-durable already provides four of the six primitives I previously told you to build, and provides them in a form that solves problems a hand-rolled SQLite store would have had — `fork: "asOf"` documents give you branch-correct state for free, and "nothing is deleted" means the pointer-preserving recall path is already blessed rather than something you must invent. The remaining work is therefore narrow: **one fact document, one recall section, one search tool, one write gate, and per-seat scoping.** The largest genuine risk is not the schema — it is that a `sections` function is re-rendered before *every* request [^2] while your seats' caching is prefix-based on DeepInfra [^3], so a dynamic memory section is a cache miss from token zero unless the harness takes its mid-conversation-delta path, which DeepInfra may not support. That single interaction can dominate your inference bill and must be measured before anything else is built.

---

## 1. Multi-agent memory: one shared store across 12 seats

**Unchanged from rev. 1, with the enforcement point relocated.**

The relevant published measurement is still the governed multi-agent memory service: scope enforced on the semantic search path (72/164 leaks) but **ignored entirely on direct GET-by-id** — the gateway resolved `agent_id` and the read handler discarded it. And still the single most transferable result: a synchronous near-duplicate gate rejected **206 of 400** writes with 409 *before* the asynchronous contradiction detector ran, so supersession scored 90/90 when it got to run, but only fired on 98/200 instances.

Mapped onto durian-pi:

| Rule | Where it lands in your tree |
|---|---|
| Scope must be re-checked on **every** read path, including by-id | Your memory reads will be tool-invoked *and* section-rendered. The `sections` function [^2] is the second read path and the one nobody thinks to filter. A section that renders a shared fact doc must filter by `seat` inside the section, not in the tool |
| Never let near-duplicate suppression precede contradiction resolution | **Your `intent` path is already correct and is the counter-example**: dedupe is by `request-id`, and the README states an id is never derived from the text "because two deliberate identical intents are two requests" [^1]. Do not import that pattern into memory as content-hash dedupe. A fact write path keyed on content hash will eat exactly the correction you need |
| Writer identity and role on every row, surfaced in injected text | Add `seat`, `role`, `capabilities` to the fact document. `rig.json` already declares all three [^802424#264] |
| Contamination is cross-seat, not cross-store | The measured sleeper-implant rate (85–100% against frontier models, still firing after 100 sessions) [^f842f4#165] matters more here than in a single-agent harness: one poisoned fact is read by 11 other seats with 11 different roles |

**New, and specific to your topology:** role-scoped retrieval has no published accuracy evaluation — I found leakage measurements and access-control frameworks but nothing evaluating "retrieve only what this seat may believe" as a *quality* intervention. Treat as `unverified`. Security half measured, quality half not.

**Cheap win the harness hands you:** per-seat tool scoping is one `configure()` call [^53a64e#339], and durian-pi currently leaves everything installed active for every seat [^1]. So "only the pm sees the queue-overview tool; only verifiers see the audit tool" is available today, without a new concept, and it is the cleanest available mitigation for cross-seat contamination — a seat cannot read what it cannot call.

---

## 2. Bi-temporal / supersession on software facts

**Unchanged conclusion, but build it as a `defineDoc`, not a SQLite table.**

The transfer result stands: 130 mined atomic state transitions from real SWE-bench fixes, marker-free, deterministic supersession at 0.908 (abstention allowed) / 0.985 (forced) vs RAG at 0.569/0.615; stale-error 0.023/≈0.00 vs 0.262/0.361; 48% compression at RAG-equal latency; and a learned reranker **made stale-fact error worse** (0.377). Only ~18.4% of real fixes are clean atomic transitions [^abbe24#103]. And the cautionary bug: their own product's value comparison lowercased and stripped punctuation, so `/API` → `/api` read as a duplicate and the stale value survived — guaranteed to bite a rig where a seat writes `/API/v2` and another `/api/v2`.

Why a document changes the design:

```ts
// not SQLite: a pi-durable document, committed with the transcript
const Facts = defineDoc<{ items: Fact[] }>({
  kind: "durian.facts",
  version: 1,
  history: "rewindable",   // audit trail for free
  fork: "asOf",            // a fork sees the facts its parent had at the fork entry
  initial: () => ({ items: [] }),
});
```

`history: "rewindable"` and `fork: "asOf"` [^2] give you two things a hand-rolled table gives you only after work: an audit trail, and **branch-correct facts**. That directly retires the "abandoned branch writes memory" hazard I raised in the previous round — a forked conversation starts from `asOf`, not from current. Keep the Graphiti field set (`valid_at` / `invalid_at` / `recorded_at` / `expired_at` / `supersedes_id` / `source_event`) inside `Fact`, because the *semantics* are what produced the 0% stale result; the storage substrate is incidental.

Two collisions to guard:

- **Value comparison** must be whitespace-collapsed but case- and punctuation-sensitive.
- **`source_event` must be a transcript entry id**, and `commit` gives you the atomicity to write fact + provenance together [^2]. Do not let the fact and its provenance be two commits.

**Sizing:** the mechanism is validated and cheap (2.13 s, 48% compression); the extraction pipeline is the open cost, and its coverage (~18%) is the number that decides whether item 165 pays [^abbe24#103]. Size it as "extractor + coverage measurement", not "supersession rule".

---

## 3. Delivery timing and prompt cache — **this section reverses**

This is the biggest change from rev. 1, and it's in your favour on mechanism, against you on provider.

pi-durable rebuilds the system prompt from the conversation's sections **before every request**, records what changed **in the transcript at the position where it changed**, and — "on models that support system prompt and tool changes in the middle of a conversation, only the change is sent, so the prompt cache stays valid" [^2].

So the premise behind "inject only at boundaries to protect the cached prefix" does not bind the way it does in a naive harness. The harness has a designed mechanism for dynamic prompt content.

The catch is the provider. Your seats run on DeepInfra [^802424#267], whose caching is **prefix-based, automatic and best-effort**: it reuses the KV cache "when the beginning of your prompt is identical" [^3]. A re-sent system prompt is therefore a miss from token zero — the whole point of the cache. Whether pi-durable takes the mid-conversation-delta path for DeepInfra's OpenAI-compatible endpoint is **not stated in the write-up** — the qualifier is "on models that support" [^2], and I could not verify that DeepInfra does. Mark `unverified`.

That gives three concrete consequences:

| Consequence | Action |
|---|---|
| A `sections` function returning changing text is a **full-prefix cache miss per request** if the delta path isn't taken | **Gate item: measure it before writing any memory section.** One seat, one draft, log prompt-token cost with a static section vs a section whose text changes every turn. That is a single afternoon and it decides the architecture |
| Static sections are free; dynamic ones may be your entire bill | Keep the constitution and skill sections static (they already are). Put changing content where it costs nothing: **in the transcript**, via a tool result or a committed entry, not in a section |
| Idle gaps destroy best-effort cache | DeepInfra offers **explicit retention for 5 minutes or 1 hour** [^4] [^5]. With push delivery and a broker that wakes seats on queue changes [^1], your seats idle between wakes — exactly the workload retention exists for. This is plausibly a larger cost lever than anything in the memory design, and it is one request parameter |

Also from the caching literature, still applicable: savings scale with prompt size (10–45% at 500 tokens → 54–89% at 50k), and techniques that *summarise or prune old tool calls break cached representations*. That last one now has a pi-durable-specific reading: **your compaction rewrites the transcript** [^2], and the summary lands at the next turn boundary — so compaction is itself a cache event, whether or not you add memory.

**Revised justification for your sequencing:** "boundaries keep the prefix stable" is now *cost-supported by mechanism* but *provider-unverified*; and "boundary injection costs accuracy" remains **`unverified`** — no study measures it.

---

## 4. Origin-bound write gates

**Unchanged: no maintained permissive implementation exists. But your harness gives you a better enforcement point than any of them.**

Fides is MIT but is a tutorial notebook ("This repository contains a Jupyter notebook to accompany the academic paper"); CaMeL self-describes as buggy and unsupported; Mnemos (MIT) enforces at ingestion but with per-agent booleans, not provenance-derived authority.

What you have instead is stronger: **`beforeTool` throws block the call** [^2] — fail-closed is the default — and hooks can "rewrite a request before it goes to the model, block or rewrite a tool call, replace a result" [^2].

Design, in your idioms:

1. Propose-write tool, not write tool. Seats call `remember({subject, predicate, object, valid_from, source_entry})`.
2. The gate is a `beforeTool` hook on the memory tool, keyed on `source_kind` (`seat_authored` | `tool_output` | `retrieved_doc` | `external_message`) — force `tier = "quarantine"` for the last three, non-negotiably.
3. Quarantine never renders in a `sections` block; it is only reachable by an explicit read tool that labels it.
4. Promotion to durable requires an out-of-band human action recorded as its own commit — never a model decision.

**The pi-durable-specific trap:** a hook "can run again after a crash, so a hook that makes a decision stores it in a memo: a small value stored with the task, where the first write wins" [^2]. A memory-write hook without `api.memo` will duplicate on checkpoint replay, and a `replay: "safe"` annotation on a *write* tool will duplicate by design — `replay` is for reads only [^53a64e#315]. Every memory write path needs both: `memo` for decisions, no `replay: "safe"`.

---

## 5. Verifiable forgetting

**Unchanged and now sharper — and it collides with pi-durable's best property.**

The behavioural result stands: memory deletion is a no-op — deletion left leakage exactly where it was (0.86/1.00/0.97 across three suites, identical to no-forget, p=1.0) while string metrics certified the failing methods as clean, including one method that still acted on a revoked preference in 80% of episodes while emitting the forbidden string zero times. Exact unlearning requires replaying from before the injection, at T−τ+1 cost.

The collision: "the older messages always stay in storage" [^2] is exactly the property you want for recall and exactly the property that makes per-fact erasure impossible. Combined with `history: "rewindable"` documents, a forgotten fact remains reconstructable from document history.

So the honest scope for item 165 is **access-control forgetting with a tamper-evident receipt**:

- tombstone checked before insert and before render, in both read paths (tool *and* section);
- exclusion from every derived store: sections, FTS, any cached digest — note your clockin digest already caps itself at 20,000 bytes and pointer-only extraction [^802424#67], which is the right instinct: summaries should carry pointers, not fact text, so forgetting a fact doesn't require chasing a paraphrase;
- a receipt, in Lethe's shape (MIT): Ed25519 over a Merkle root of the append-only log, plus `AUTOINCREMENT` so a purged row id cannot be reused [^9ad190#47];
- a written statement that exact erasure is out of scope.

Do not quote the 1.5% figure — I could not re-verify it and demoted it. Use Lethe's adversarial suite instead: 63.4% / 62.9% / **68.3%** across three deterministic systems, overlapping intervals, no winner, with the +28 pp lift coming from an LLM hook rather than the store; template suite saturated at ~99% and therefore non-discriminating. And note the 0% cross-lingual identifiers score is *irrelevant* to you, because your identifiers are file paths and branch names — a lexical purge path is the correct choice [^9ad190#48].

---

## 6. Procedural memory sizing — **you have a live instance of the failure mode**

The 5→100 figure is superseded by a fitted law across 15 models: Acc(N) = a − b·ln N, R² > 0.97, ≈3 pp lost per doubling. For your seat models: **GLM-5 N\* = 6** and **GLM-4.7 N\* = 7** at 80% routing accuracy; DeepSeek-V4 Pro = 36; Gemma untested so `unverified`, but by slope at or below the GLM row. Lexical retrieval wins at scale (BM25 78.0% vs GPT-5.4-mini 60.7% at N=200), and the library-side fix — boundary rewriting + abstract-skill removal — moved held-out routing 71.3% → 91.7% with the router held fixed.

**You already hit the mechanism, in your own repo.** Commit `02f1a36` records two skills both named `durig` — one driving the rig, one delegating to it — and the commit message names the cause exactly: "a skill is loaded BY NAME, so the collision made the loaded skill ambiguous" [^802424#43]. That is skill shadowing, observed in production, before any scaling law was consulted. The fix — rename to `driving-durian-pi` / `delegating-to-durian-pi`, single canonical root, plus `demo/skill-names.test.mjs` asserting no name is claimed twice across both roots [^802424#43] — is precisely the boundary-rewrite intervention, and the test is the enforcement.

So: you are at two skills against an N\* of 6–7 for GLM-class seats. **The budget is real, small, and already tested.** Two additions worth making:

- extend `skill-names.test.mjs` from name-uniqueness to **description separation** for near-duplicate pairs (the +18.4% intervention for danger-zone pairs at cosine 0.55–0.75);
- record skill count per seat as a `metrics` measure, since it is a `config-derived` value you already know how to carry with a band and a blind spot [^1].

Caveat: single-vendor paper, not peer-reviewed, plain-text routing, N\* extrapolated from a log fit.

---

## 7. A/B methodology — reuse what you built

Rev. 1's methodology stands, but it should attach to `metrics` and `check` rather than a parallel harness. Three of your existing properties make the study cheaper than most shops can manage:

| Your existing asset | Why it matters for the A/B |
|---|---|
| Durable, immutable transcripts that survive restarts [^2] | The replay substrate is free and deterministic — no fixture construction |
| Readings record revision, dirty-tree state, and **active extension set** (`active: durig.router, ./extensions/timing.ts`) [^1] | Arm identity is already provenance-stamped; you cannot accidentally compare a reading taken with a different extension set |
| `metrics` carries band + baseline + evidence class + **blind spot**, and reports `no baseline yet` rather than guessing [^1] | The honesty discipline the methodology needs is already a code convention, not a hope |
| `shared-reviewer-model` and `single-model-rig` checks [^1] [^802424#236] | Partly answers my "don't test with the model that wrote the memory" — extend it to "author seat and verifier seat must not share the memory-writing model" |

Still to add, from the literature: a **measured false-positive floor** per probe against the clean arm, so a lenient judge is discarded rather than argued about; **paired cached scenarios** verified bit-for-bit reproducible; **paired bootstrap / McNemar** with CIs; and reporting the **forced-to-answer** regime separately from abstention (0.262 → 0.361 stale error), because seats commit rather than abstain.

Arms: (A) no memory, (B) full history in context, (C) memory, (D) memory with the write gate disabled. (D) is the one people skip, and with `DURIAN_PI_MAX_CONCURRENT_SEATS` shipping as 1 for serialization [^802424#63], (D) is also cheap to run.

---

## 8. Cheaper-first levers: masking vs summarization

**Sequencing confirmed, with one correction and one free win.**

Numbers unchanged: observation masking is ~50% cheaper with ≥ solve rate in 4 of 5 configs; LLM-summary caused 15% longer trajectories; summary calls are cache-hostile; the hybrid (mask, summarize as last resort at N=43) was best at +2.6 pp and 7% cheaper than masking alone. And masking is not uniformly safe: one config lost 4.0 pp at p=0.04.

Three pi-durable specifics:

1. **Your compaction already is the "keep everything" half.** Background compaction summarizes older messages while the conversation continues, the summary lands at the next turn boundary, the conversation waits only when the next request wouldn't fit, and older messages stay in storage [^2]. That is materially better than the tools the masking literature measured. The gap is not compaction — it is **whether a seat can get back to what was compacted**.
2. **The recall path already exists in the docs.** `reset()`/`handoff` plus a `search_history` tool that scans entries — with the explicit note that because nothing is deleted, a tool can still search everything before the handoff [^2]. Implementing that (~20 lines, `replay: "safe"`) converts your compaction from lossy to pointer-preserving at near-zero risk, and it is the single highest-value item in this whole review relative to effort.
3. **Do not add a second compaction mechanism.** pi-durable's compaction is a task with hooks that can write the summary themselves [^2]; a competing summarizer in an extension would double-write summaries and fight the boundary placement.

Correction to rev. 1: I claimed pointer-preserving masking is measured better than placeholder masking at 94.8% on LongMemEval-S. I could not re-verify that figure and demote it to `unverified`. The argument for pointers here is architectural — nothing is deleted, so re-fetch is nearly free [^2] — not measured.

---

## 9. What this changes in `docs/ROADMAP.md` 161–169

I don't have the item texts, so this maps by topic; apply each to whichever item covers it.

| Topic | Change | Strength |
|---|---|---|
| **Any item that assumed a pi coding-agent extension, `pi-memory`, or a new SQLite store** | **Kill or rescope.** Seats are pi-durable conversations; coding-agent extensions cannot load here [^1]. No external memory package applies | `observed` |
| **New gate item, ahead of everything: cache measurement** | One seat, static section vs per-turn-changing section, log prompt tokens and cost on DeepInfra. Decides whether dynamic `sections` memory is viable at all. Prefix caching is prefix-exact [^3]; whether pi-durable sends a delta on these providers is `unverified` [^2] | `unverified` → measure |
| **Cost lever, cheap, possibly large** | Evaluate DeepInfra prompt-cache retention (5 min / 1 hr) given idle gaps between broker wakes [^4] [^5] [^1] | `advertised-elsewhere` |
| **Raw log / search-back** | **Build `search_history` now** — docs give the pattern, ~20 lines, `replay: "safe"`, converts compaction from lossy to pointer-preserving [^2] | `advertised-elsewhere` (mechanism documented, not benchmarked) |
| **Typed facts (165)** | **Split.** Facts as a `defineDoc` with `history: "rewindable"` + `fork: "asOf"` [^2], not a SQLite table. Mechanism validated on real repo history; extraction coverage (~18%) is a separate item with its own metric [^abbe24#103] | `direct` |
| **Value comparison** | Hard requirement: whitespace-collapsed, case- and punctuation-sensitive | `direct` |
| **Supersession vs dedupe** | Two stages, supersession first on structured triples. Do not introduce content-hash dedupe; your `request-id` dedupe is the correct precedent and must not be generalised to facts [^1] | `direct` |
| **Origin-bound writes** | Implement as a `beforeTool` gate on a propose-write tool; `beforeTool` throws fail closed [^2]. No dependency | `observed` |
| **Write-path idempotency** | **New, harness-specific:** every memory-write hook needs `api.memo` first-write-wins, and no `replay: "safe"` on writes — hooks re-run after a crash [^2] [^53a64e#315] | `observed` |
| **Per-seat scoping (ROADMAP 18)** | **Promote ahead of memory.** The harness already stores extension and tool names per conversation [^2] [^53a64e#339]; durian-pi installs everything for every seat [^1]. Role-scoped tool exposure is the cleanest contamination mitigation available and it is one `configure()` call | `observed` |
| **Forgetting (165, if merged)** | Rescope to access-control forgetting + receipt. Deletion is behaviourally a no-op; `history: "rewindable"` and "nothing is deleted" [^2] make per-fact erasure impossible by construction — say so in writing | `direct` |
| **Skill budget** | Cap at 6–10 per GLM-class seat; extend `demo/skill-names.test.mjs` [^802424#43] from uniqueness to description separation | `direct` |
| **Context items 92–97** | Confirm sequencing; add "do not add a second compaction mechanism" [^2] | `direct` |
| **Evaluation** | Attach to `metrics`/`check`; add false-positive-floor, paired scenarios, paired bootstrap | `direct` |

**Two items to kill if they exist:** any plan treating a memory-row delete as satisfying forgetting, and any plan to grow a flat LLM-routed skill library past single digits on the cheap seats.

---

## 10. Revised pre-flight checklist

Replaces the pi-coding-agent checklist entirely:

- [ ] Cache gate measured: static vs dynamic section, prompt-token and cost delta, on the actual seat models
- [ ] Dynamic memory content goes into the **transcript**, not a `sections` function — unless the gate says sections are free
- [ ] Facts are a `defineDoc` with `history: "rewindable"` and `fork: "asOf"` — not a new table
- [ ] Both read paths filtered: the read tool **and** any section that renders facts
- [ ] `seat`, `role`, `source_kind`, `source_entry` on every fact
- [ ] No content-hash dedupe upstream of supersession
- [ ] Write hooks use `api.memo`; no `replay: "safe"` on any write
- [ ] Quarantine tier enforced in `beforeTool`, promotion human-only
- [ ] `search_history` exists and is `replay: "safe"`, before any fact document is added
- [ ] `configure({tools:{remove}})` used so a seat cannot call memory tools it shouldn't
- [ ] Skill count per seat recorded as a `metrics` measure with a band and a blind spot
- [ ] Forgetting documented as access-control + receipt, with the replay limit stated
- [ ] Arms A–D replayable from the durable transcripts, with the active extension set stamped per reading

---

## 11. Open questions

1. **Does pi-durable send a mid-conversation prompt delta on DeepInfra?** The whole cache economics of dynamic sections hinges on this, and it is one experiment.
2. **How much does cache retention change the bill?** With push delivery and broker-driven idling, best-effort prefix caching may be mostly cold; explicit 1-hour retention could dominate every memory-design decision.
3. **Does role-scoped retrieval help or hurt accuracy?** Unmeasured anywhere; plausible negative (filtering may remove context a worker needs to anticipate a verifier's objection).
4. **What is *your* atomic-transition rate?** 18.4% is SWE-bench fixes; a monorepo with feature work and dependency bumps will differ, and that number decides item 165.
5. **Does `configure({tools:{remove}})` survive a fork and a restart cleanly?** Conversations store names, not code [^2], which suggests yes — but the rig currently installs globally, so this is untested locally.
6. **Do document history and tombstone semantics compose?** `history: "rewindable"` means a rewind could restore a forgotten fact; that interaction is unexamined.
7. **What is the false-positive floor of whatever judge you use?** Unmeasured, and everything downstream of an unmeasured judge is unfalsifiable.

---

**Provenance.** Repo facts read at `main` @ `b4c86ea` (2026-10-25) [^1]. Harness behaviour read from the Pi Durable write-up (published 2026-10-01), which is documentation, not source — `observed` at the doc level, and API details may have moved since; re-check against `packages/durable` at your pinned commit [^1]. DeepInfra caching from provider docs [^3] [^4]. Research claims carry the markers from the previous round, with the three demoted items (1.5% forget compliance, 94.8% pointer eviction, 3,283-paper synthesis) stated as `unverified` rather than reused.

I can't write the file: the workspace is read-only for me, so `docs/reviews/memory-followup-review.md` needs to be created from the text above.

**References**

[^1]: [GitHub - chexxor/Durian-Pi: An OpenRig-like multi-agent team manager built on Pi-Durable · GitHub](https://github.com/chexxor/Durian-Pi) (44%)
[^2]: [Pi Durable | Earendil](https://earendil.com/posts/pi-durable/) (46%)
[^3]: [Prompt Caching](https://docs.deepinfra.com/chat/prompt-caching) (3%)
[^4]: [Prompt Cache Retention - DeepInfra](https://docs.deepinfra.com/chat/prompt-cache-retention) (4%)
[^5]: [Introducing Prompt Cache Retention: Keep Your Context ...](https://deepinfra.com/blog/prompt-cache-retention) (3%)