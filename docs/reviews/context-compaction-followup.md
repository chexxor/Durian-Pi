

I'll work through this systematically. Let me start with the model-specific and measurement questions.I've hit the research budget, so here is the consolidated report. Note on method: I could not read the baseline docs in your repo (only the brief you attached was available to me), and I did not independently re-open your vendored `pi-durable` tree — so every statement about your own code is carried forward from your brief and marked **internal — unverified by me** where it matters. Everything else is externally sourced with a URL and an evidence class.

---

# Context Compaction Follow-Up: External Evidence

`docs/reviews/context-compaction-followup.md` (draft)

**Evidence classes used:** `observed` = controlled measurement / benchmark / first-party production number; `advertised-elsewhere` = vendor documentation or marketing claim; `community` = unverified practitioner report; `internal — unverified` = about durig/pi-durable, not confirmable from external evidence.

---

## Headline

The single most consequential finding for durig is that your two flagship seat models advertise 1,048,576-token windows [^54][^4], while **the vendor's own evaluation of GLM-5.3-Flash is conducted at a maximum context length of 300,000 tokens "using a context management strategy"** [^55][^10], and the best available DeepSeek-V4 practitioner data puts the precision-preserving band at **150–250K** with degradation past ~256–300K [^5][^5][^5]. Your inherited automatic threshold of ~1.03M tokens is therefore not merely late — it is roughly **3–4× beyond the vendor's own operating point**. This makes ROADMAP 28a/28b not just reachable but necessary.

---

## A. Trigger and measurement

**A1 — How late can auto-compaction fire, per model family (DeepSeek-V4 / GLM-class)?**

- **Vendor signal (strongest):** Z.AI's GLM-5.3-Flash and GLM-5.3 model cards state the evaluation "is conducted with a maximum context length of 300,000 tokens, using a context management strategy" [^55][^56][^10]. The advertised window is 1M with 128K max output [^4]. This is `advertised-elsewhere` evidence that the vendor itself does not evaluate at the ceiling, and that a context-management strategy is assumed.
- **DeepSeek-V4 (community, but specific):** a widely-upvoted practitioner breakdown reports 150–250K tokens optimal for coding (full retention, sub-2s latency, minimal precision loss); past 300K "precision quality degrades"; past 520K outputs "shift to architectural summaries that skip implementation details" [^5][^5]. Evidence class: `community` (self-reported, not a controlled benchmark).
- **Model-specific controlled evidence exists — but for governance, not recall:** the *Governance Decay* paper (arXiv 2606.22528, 7 models, 1,323 episodes) explicitly names **DeepSeek-V4 (up to 59% constraint violation after one compaction)** and **GLM-5.1 (0% under passive compaction, but 22% under fixed injection and 40% under bulk adversarial content)** [^1][^512-528]. So DeepSeek-V4 and GLM *are* covered by a controlled study — just not one measuring retrieval fidelity. Evidence class: `observed`.
- **Coverage gap:** I could **not verify** that Chroma's 18-model study or *Context Compaction Theory* specifically include DeepSeek-V4.1-Flash or GLM-5.3-Flash. **unverified.**

**A2 — Practical effective budget on a nominal 1M window, and cheap discovery**

- Practitioner framing on 1M-capable models generally: a coding-focused analysis reports only a couple of models actually use the full 1M, with a large spread on MRCR v2 / NIAH-2 / Graphwalks [^11]; a Claude Code analysis argues the usable zone sits far below the ceiling and that `/compact` "piles lossy sediment" [^12]; another report found effective windows of ~100–2,500 tokens under adversarial stress [^57]. Evidence class: `community`/`observed` mixed.
- The established *definition* to borrow is Paulsen's **MECW** — the context length at which accuracy drops below an acceptable threshold, which "shifts based on the problem type" [^7][^13]. Evidence class: `observed`.
- **Cheaper discovery method than a full MECW sweep:** probe-based, task-shaped retrieval tests at a handful of lengths rather than a full perplexity/accuracy grid. CompactBench's method — deterministically generate adversarial conversations from templates, compact, then ask targeted probing questions — is directly reusable and cheap [^14][^15]. I did **not** find an accepted, cheaper *standardized* method than MECW; the honest answer is "probe at 3–5 lengths on your own task mix," not "look up a table." **Partly unverified.**

**A3 — Is an advertised 1M window actually served? Internal cross-check**

- **External:** DeepInfra advertises 1,048,576 tokens for `DeepSeek-V4.1-Flash`, trained with sparse attention at 64K and extended to 1M at 34T tokens [^16][^54]. Third-party trackers repeat the 1M figure [^17][^58]. GLM-5.3-Flash's 1M is stated by Z.AI directly [^4] and echoed by OpenRouter [^59] and Bedrock [^18]. These are all `advertised-elsewhere`.
- **External counter-signal:** the "context window lie" analysis finds a ~60-point gap between best and worst "1M-capable" models on long-context coding benchmarks [^11]; and the practitioner report above shows *technical* 1M function but a much lower precision ceiling [^5]. So "advertised ≠ served at quality" is well-supported; "not served at all" is **not** established for these two models.
- **Internal:** whether durig's `contextWindow: 1_048_576` (deepinfra-models.ts:156,166) matches actual served behaviour is **internal — unverified**. Recommended: a probe run at 200K/400K/600K/900K against the live endpoint before trusting any threshold derived from it.

---

## B. Reasoning / thinking tokens and prompt cache

**B4 — Do reasoning tokens count, and must they be replayed?**

This is the sharpest, most actionable finding in the whole brief, and the DeepSeek answer is unambiguous:

- **DeepSeek, request carries `tools`:** the `reasoning_content` of *all* previous turns **must** be passed back and **is concatenated into context**; omitting it returns a **400 error** — "even for turns where the model did not perform a tool call" [^3][^3].
- **DeepSeek, request does *not* carry `tools`:** prior reasoning need not be replayed; if included it is **ignored and not concatenated** [^3].
- **Implication for durig:** your D80 `thinkingLevel: "high"` seats that *do* have tools will accumulate thinking blocks in the live context on every turn, and pi-ai's replayable `thinkingSignature` is a *requirement* here, not an optimization. Whether `reasoning_content` counts toward the token budget is **not stated in the DeepSeek docs** — **unverified**, and it must be measured (count returned reasoning tokens per turn).
- **GLM:** `thinking.type` **only supports `enabled`; thinking cannot be disabled** on GLM-5.3-Flash, and Z.AI recommends `thinking.clear_thinking: false` [^4][^4]. So on GLM you cannot switch thinking off to shrink context — you can only manage it. Evidence class: `advertised-elsewhere`.
- **Recommended handling:** *keep* for DeepSeek when tools are in play (mandatory), and treat thinking blocks as a first-class compaction target via Anthropic's "thinking block clearing" primitive (keep-threshold based) [^19][^20]. Do **not** hand-summarize thinking blocks — the DeepSeek contract requires verbatim replay for tool turns [^3].

**B5 — Should the summarizer run cheaper / at low thinking?**

- **Direct support for cheaper summarizer:** Letta documents a "use a cheaper/faster model for summarization" compaction setting [^21]; an agent-harness issue proposes both a cache-sharing summarization request *and* a `compaction.model` option for a cheaper summarizer [^22]. Evidence class: `advertised-elsewhere`.
- **But summarizer budget/capability matters enormously:** *Governance Decay* found tightening the summary budget from 300→15 words dropped constraint survival from 88%→23% and raised violation 7%→28% [^1]. So the lever is *summary budget and pinning*, not raw model tier.
- **Recommended:** a cheaper model is acceptable **only** with (a) a fixed structured schema, (b) an explicit token floor for the summary, and (c) constraint pinning (below). Do not run the summarizer at `thinkingLevel: high` — it is a deterministic-extraction task, and Anthropic's own guidance is to instruct the summarizer not to call tools [^23].

**B6 — Compaction vs prompt caching; is "cache-cold boundary" established?**

- **OpenAI states directly:** "Summarization, compaction, or context truncation can change the prefix and reset cache reuse" [^24]. Evidence class: `advertised-elsewhere`.
- **Measured value of the cache lever:** a peer-reviewed-style evaluation of prompt caching for long-horizon agents found **41–80% API cost reduction and 13–31% TTFT improvement**, and — critically — that *strategic* block control (dynamic content at the end, excluding dynamic tool results) beats naive full-context caching, which "can paradoxically increase latency" [^25]. Evidence class: `observed`.
- **Provider cache economics:** DeepSeek cache-read at ~0.032× base [^26]; GLM-5.3 cached $0.1955 vs $1.19 per 1M [^26]. Evidence class: `advertised-elsewhere`.
- **Design confirmation from a harness:** deepagents' forked subagents "respect prompt caching by design" because they share the supervisor's prefix [^2]; and the practice guidance is explicit that "aggressive token-surgery that changes cached prefixes often destroys the very lever you were trying to exploit" [^27]. Evidence class: `observed` (production case: 7%→74% hit rate from one reordering, −59% cost) [^28].
- **Verdict:** "compact only at cache-cold / task boundaries" is **consistent with established practice**, though I did not find it stated as a named doctrine. It is strongly implied by the cache-invalidation mechanics and the byte-stable-prefix guidance.

---

## C. Safety with your guards and lifecycle

**C7 — Compaction re-triggering/masking a repetition loop; block for degenerate agents?**

- **Yes, evidence exists, and some of it is in your own upstream repo.** `earendil-works/pi` issue #8652 (durig builds on pi) reports that a compaction summary can reach a *normal* stop reason and still be unusable — a stub, or prose missing the required structured sections — and proposes **rejecting degenerate stop-reason compaction** [^29]. There is also a filed "infinite compaction / continuation loop" bug where the agent "repeatedly generates" instead of continuing the task [^60]. Evidence class: `observed` (issue report).
- **Mechanism:** Pydantic's compaction docs note degenerate generations are low-entropy repetition so a head/tail slice loses little, and that "summarizing summaries decays over successive compactions" [^61]. Evidence class: `advertised-elsewhere`.
- **Complexity Trap (first pass)** established that summaries can act as a reinforcing signal and remove the stop condition.
- **Recommendation:** **block compaction for an agent whose last N turns are degenerate** (repetition/low-entropy), and reuse pi's `stopReason === "length"` + structured-section validation as the acceptance gate for any summary. Do not let a summary become the new anchor for a looping agent — prefer a fresh session with an explicit handoff instead.

**C8 — Forbid compaction while an item has uncommitted work?**

- **Direction of evidence is clear, controlled proof is not.** Multiple harnesses treat the *task/work-item boundary* as the compaction point rather than an arbitrary counter: "Coding agents compact context when a counter trips, not at a safe stopping point" [^62]; "compaction preserves continuity, but whatever was wrong in the session … is summarised along with everything else and carried forward. A context reset starts a fresh agent and gives it a structured handoff" [^30]; OpenAI Codex users report compaction "loses operational continuity in long Codex tasks" [^31]; and *Handoff Debt* (arXiv 2606.02875) quantifies "the rediscovery cost imposed when a predecessor's work is opaque or incomplete" [^32]. Evidence class: `observed`/`community` mixed.
- **Verdict:** "forbid compaction while an item has uncommitted work" is a **sound synthesis of established practice**, but I did **not** find a controlled study proving it. Mark the *specific invariant* as practice-synthesis, not measured fact. For durig this maps cleanly onto the broker: gate compaction on the claimed item's worktree being clean, which your single-writer broker already knows.

**C9 — Does background compaction consume a scarce generation slot?**

- **Honest answer: no controlled study found on compaction specifically.** Adjacent evidence: GPU starvation in multi-tenant serving is real and is driven by long reasoning prompts holding slots [^63]; vLLM has documented engine deadlocks under concurrent load [^64]. Evidence class: `community`/`observed` (infra, not compaction).
- **Best available guidance remains the first-pass serving paper:** synchronous compaction can consume a large fraction of wall time at low thresholds, and the fix is asynchronous compaction during tool-call waits. For durig's `DURIG_MAX_CONCURRENT_SEATS=1` local mode, the safe rule is: **never let a compaction request preempt or queue ahead of a live seat's next turn** — schedule it only in an idle window (tool wait / between passes), and treat compaction as lower priority than task generation. This scheduling policy is my **synthesis**, not a cited result. **Partly unverified.**

**C10 — Summary-submission racing a normal submission**

- **internal — unverified.** No external prior art specific to a "summary-submission at the next boundary" mechanism was found. The risk you name (a summary reading as "in flight", or being reconciled as stranded) is a broker-invariant question, answerable only in `src/broker.mjs`. I recommend modelling the summary submission as a distinct submission *kind* with its own reconciliation rule rather than reusing the task-submission path.

---

## D. What survives / verifier independence

**D11 — Verifier-independence rule**

- **Enforced in practice:** deepagents' verifier guidance is explicit — "inheriting the supervisor's reasoning can be counterproductive. The verifier should evaluate the work itself rather than being anchored by the supervisor's diagnosis or expectations," so verifiers run `isolated` [^2]. A separate write-up states the pattern plainly: "Using the same model to write and verify code preserves biases. The verifier pattern uses a separate agent with no shared context" [^65]. Evidence class: `advertised-elsewhere`.
- **Evidence that inheriting anchors:** anchoring bias in LLM agents is demonstrated — agents "rigidly adhere" to prior framing [^66]; and the independence assumption behind multi-agent verification "breaks down when solver and judge share training data, RLHF preferences" [^67]. **Nuance:** much of the strongest anchoring evidence is about *judge prior scores* (arXiv 2608.25869), which is adjacent, not identical, to *summary inheritance* [^8]. Evidence class: `observed`.
- **Verdict for durig:** your `no-verifier-seat` check rule + second-model-family verifier is **well-supported**, and you should add: a verifier must **not** inherit the author's compaction summary. Fresh context is a correctness property.

**D12 — Fork vs isolate: broader evidence / costs**

- **Rule of thumb (deepagents):** worker = `fork` (isolation forces rediscovery of evidence the supervisor already has); verifier = `isolated` (avoid anchoring); researcher = `isolated` (keep focused; forking duplicates history across parallel researchers) [^2][^2][^2]. Default is `isolated` in code [^68]. Evidence class: `advertised-elsewhere`.
- **Costs of forking:** the fork duplicates the supervisor's history; the counter-argument is cache reuse [^2]. Concrete cost anchors: Anthropic subagents "use tens of thousands of tokens … (often 1,000-2,000 tokens)" returned [^69]; a widely-cited Claude Code figure is ~20,000 tokens per subagent preamble before it does any work [^70]. Evidence class: `community`/`observed`.
- **Counter-evidence:** I did **not** find a controlled head-to-head showing fork beats isolate on task outcome. The rule rests on mechanism + one vendor's practice. **Partly unverified.**

**D13 — Should a retry/re-wake inherit or isolate the failed context?**

- **No controlled study found.** The convergent inference from *Handoff Debt* [^32] and the anchoring findings [^66][^67] is: **isolate for evaluation, fork for continuation.** For a retry, the safest pattern is **isolate + structured handoff of the failure** (what was tried, why it failed, what state is committed), not a full fork of the failed reasoning — a fork risks re-anchoring on the failure. Mark as **inference, unverified.**

**D14 — Structured handoff schema**

- **The shape is established.** Variants: a fixed-schema "session recap" that preserves "goal-state, not text-density" [^71]; an "Agent Handoff Capsule" capturing "objectives, decisions, failures, and next actions" [^33]; a session-handoff template skill [^72][^34]; and a human-facing pattern that asks the agent to "restate the original goal, summarize the work already done, point to the important files, and describe the current state" [^73]. deepagents' in-context summary is described as "session intent, artifacts created, and next steps" [^6]. Evidence class: `advertised-elsewhere`.
- **Recommended field set (union, machine-parseable):** `Goal`, `Approach`, `Current Status`, `Next Steps`, `Key Files` (full paths), plus `Decisions`, `Open Questions/Uncertainty`, `Acceptance`. **Length bounds:** target the subagent-return norm of ~50–200 lines / 1,000–2,000 tokens [^69], with a hard token floor (do not let the summarizer collapse below ~200–300 words, per the 88%→23% survival cliff) [^1].

---

## E. Your store advantage

**E15 — Re-deriving state from an append-only store instead of a summary**

- **Prior art exists and is favorable:** "context offloading" treats the filesystem/durable store as the only deterministically queryable, grep-able, auditable layer [^35][^36]; the Karpathy RAM-vs-disk framing (context = RAM, external store = disk) is standard [^74]; Anthropic measured **39% eval lift and 84% token reduction** from memory + context editing [^36]. Evidence class: `observed`/`advertised-elsewhere`.
- **Counter-voice (important):** the *Active Context Compression* paper argues that pure "Append-Only" mode "ensures failure for complex, open-ended exploration" — so an append-only store does not remove the need for active management; it changes *where* management happens [^37]. Evidence class: `observed`.
- **Failure modes when store is authoritative and context is a view:** (a) **governance decay** — the model's *view* drops standing constraints that still exist in the store, which is exactly the *Governance Decay* result [^1]; (b) **stale-view drift** — the model acts on a compacted view that no longer matches committed state; (c) **rediscovery cost** when the view lacks a pointer to the authoritative record (*Handoff Debt*) [^32]. Mitigation: every summary must carry **pointers** (item IDs, file paths, store keys) into the authoritative store, never restate facts without a pointer.

**E16 — Is summarise-in-place (head marker, raw retained) accepted?**

- **Yes.** Anthropic ships server-side compaction that "replaces the older turns … with a summary that Claude writes on the server," keeping the active context small [^38]; Microsoft's Agent Framework exposes compaction as a pluggable strategy [^39]; and the "compaction vs context reset" literature frames summarise-in-place as one of two legitimate branches, chosen by "what your handoff artifacts can carry" [^40]. Evidence class: `advertised-elsewhere`.
- **When to prefer a fresh session:** when the handoff artifact can carry the state (your store can), and when the session has accumulated a *wrong belief* — because compaction "carries it forward" [^30]. Given durig's authoritative store, the bias should be toward **fresh session + pointers**, with summarise-in-place as the in-session layer.

---

## F. Cheapest layer and evaluation

**F17 — Masking / tool-result clearing: implementations and rules**

- **Anthropic context editing (beta, `context-management-2025-06-27`)** supports **tool result clearing** and **thinking block clearing**, with options: default keep the 3 most recent tool use/result pairs, `clear_at_least`, `exclude_tools`, `clear_tool_inputs` (default false) [^19][^20]. The design keeps "the record that the call happened" while dropping the payload [^41]. Evidence class: `advertised-elsewhere`.
- **Rules observed in the wild:** observation masking replaces each processed tool output with a one-line summary [^75]; a hermes-agent proposal masks older turns but **keeps the agent's own reasoning and actions intact, masking only environment observations** [^42].
- **Invariant (hard API constraint):** OpenAI's API "requires that each tool_call must have a corresponding tool_result message" [^43]. Therefore **never clear a tool result whose call is still open** — clear only completed pairs, and never the most recent keep-window.
- **Internal:** whether pi-durable's `ContextView.contributions` already exposes per-entry clearing ("after edits and excluded stop reasons") is **internal — unverified**. If it does, the masking layer is available to you for free; if not, it is a new primitive.

**F18 — Evaluation design: probe set, grading, replay, thresholds**

- **Probe set is standardized:** recall / artifact / continuation / decision, graded by an LLM judge [^44][^76]. Evidence class: `observed`.
- **Replay harness:** CompactBench's method — generate adversarial conversations from versioned templates, replace the original context with the compacted artifact, then ask targeted questions that probe what survived [^14][^15]; it also scores multi-cycle drift and hierarchical/ledger strategies [^45]. Your append-only store makes this trivial to build (replay = re-issue probes against a reconstructed `ContextView`). Evidence class: `observed`.
- **Artifact tracking is the most sensitive metric in practice** — Factory's finding (first pass: 2.19–2.45/5 on artifact tracking). Supporting: *CompInt* finds current compactors retain only **17%** of injected side-constraints on average and "most perform worse than running the same task without compaction" [^46]; ARC (arXiv 2607.25066) targets exactly this recoverability gap [^47]. Evidence class: `observed`.
- **Alert thresholds:** no published standard; recommend alerting on any artifact-tracking regression below the uncompacted baseline, and on the constraint-survival rate (see F19). **Partly unverified** for specific numeric thresholds.

**F19 — Repeated-compaction error accumulation**

- **Strong, model-specific numbers:** *Governance Decay* measured violation rising **0%→78% across R=0→4 rounds** of repeated compaction [^1]; and it found **hierarchical summarization performed *worse* (36% violation) than head_tail (0%)**, with LLM-summarize at 26% and recency-truncate worst at 38% [^1]. Evidence class: `observed`.
- **Theory:** the first-pass *Context Compaction Theory* holds a single compaction is the favorable base case and error accumulation across chains is open.
- **Mitigations with evidence:** **Constraint Pinning** — re-inject the standing policy — restored violation to 0% for ≈47 pinned tokens (<0.5% of a production-scale compaction context) [^1]. Pydantic notes "summarizing summaries decays" [^61]. Recommended for durig: **cap compaction count per session**, then **force a fresh session**, and pin the constitution + seat invariants verbatim outside the summary.

**F20 — Cost budgeting: does 15× hold for a broker-driven queue of long-lived seats?**

- **Source number:** Anthropic — "agents typically use about 4× more tokens than chat interactions, and multi-agent systems use about 15× more" [^48]; token usage alone explained **80% of performance variance** on BrowseComp [^49]. Evidence class: `observed`.
- **For your architecture:** the 15× figure is for **parallel fan-out with fresh subagent contexts** [^50]. A broker-driven queue of **long-lived seats** is closer to the **4× agent** multiplier, because seats persist and share a cached prefix rather than respawning per task [^48][^28]. **This is my inference** — no study covers your exact topology. Recommended observability fields per seat: `context_tokens`, `effective_window`, `threshold`, `compaction_count`, `summary_tokens`, `cache_hit_rate`, `artifact_probe_score`. **Partly unverified.**

**F21 — Secrets/PII before summarizing; is a summary a leak vector?**

- **Established rule:** redact **before any model call**, using layered detection (regex + checksum, then NER, reserve local LLM for edge cases) and **reversible placeholders**, with redaction in a gateway that keeps raw identifiers out of provider logs entirely [^9][^51][^77]. Evidence class: `advertised-elsewhere`.
- **Is compaction a leak vector?** Indirectly, **yes** — the *Compaction-Eviction Attack* shows an adversary who "supplies nothing but in-context data" can bias the summarizer to delete a constraint [^1]. A summarizer that ingests raw tool output is therefore a place where secrets can be *moved into a long-lived, cached artifact* and out of your redaction boundary. **Recommendation:** redact at ingestion (before the entry ever enters the store), so the summarizer never sees unredacted secrets.

**F22 — Coordinator/no-tool agents (B1 / #156)**

- **Prior art:** memory-primed agent spawning injects "relevant slices of accumulated memory at initialization time" (PrimeAgentOrchestrator, arXiv 2608.20342) [^52]; an "agent memory contract" exposes a small wake→work→handoff toolset over a large store [^53]; Anthropic's own guidance is to give subagents tools/memory rather than rely on inherited context [^69]. Evidence class: `observed`/`advertised-elsewhere`.
- **Verdict:** a coordinator that cannot read the store is a **single point of lossy failure** — it can only act on its summary, which is exactly the *Governance Decay* failure surface [^1]. Two fixes, either is defensible: (a) **inject state at boot** via a boot contract (broker assembles a fresh, structured state digest for `pm`/`lead` each wake), or (b) **grant read-only store/doc access**. No controlled study compares the two; **synthesis, unverified.**

---

## Recommended policies for durig

### 1. Threshold policy

- **Override the inherited default.** Do not inherit `{ reserveTokens: 16384, keepRecentTokens: 20000 }` against a 1M window (auto threshold ~1.03M, effectively unreachable) — it is 3–4× past the vendor's own operating point for GLM-5.3-Flash (300K eval cap) [^55][^10] and past the DeepSeek-V4 precision band (150–250K) [^5].
- **Basis:** trigger at **~60–70% of each model's *measured* MECW**, not nominal window. For a first cut on your two flagships, that lands around **180–250K tokens**, and you should probe to refine it (A2/A3).
- **Authority:** make the **ordered guard (#62) authoritative** over the platform default, because the platform default cannot know the per-model MECW and cannot see the degenerate/committed-work state. The guard should own warn → preserve-and-settle → one compaction, and the platform's automatic threshold should be set *above* the guard's trigger so it never fires first.

### 2. Cheapest-first ordering

`mask (tool-result + thinking-block clearing, deterministic) → summarise (structured schema, pinned constraints) → fresh session (pointers into the store)`

- The **masking layer is available to you in principle** — Anthropic exposes it as a first-class beta primitive with exactly the rules you'd want (keep 3 recent pairs, `exclude_tools`, never clear an open call) [^19][^20][^43]. Whether pi-durable surfaces it per-entry is **internal — unverified** (F17). If it does not, this is the highest-ROI new primitive to add, because it is zero-model-call and reversible.
- **Domain caveat (from first pass):** masking's advantage is strongest for verbose tool output. Your seats today mostly exchange succinct queue/coordination traffic — the regime where summarization of dialogue is competitive. Revisit this ordering when ROADMAP item 4 lands file tools.

### 3. Verifier / re-wake isolation

| Role | Mode | Rationale |
|---|---|---|
| Worker continuing diagnosed work | `fork` | Avoid rediscovering evidence the supervisor holds [^2] |
| Verifier | `isolated` **and no inherited summary** | Inheriting anchors the review [^2][^65] |
| Researcher (bounded question) | `isolated` | Focused; forking duplicates history across parallel researchers [^2] |
| Retry / re-wake of failed attempt | `isolated` + failure handoff | Avoid re-anchoring on failed reasoning (**inference**) [^32] |

### 4. Evaluation design

- **Probes:** recall / artifact / continuation / decision, LLM-judge graded [^44][^76].
- **Replay:** reconstruct `ContextView` from the append-only store, swap in the compacted artifact, fire probes [^14][^15].
- **Most sensitive metric:** artifact tracking [^46]; also track constraint/side-constraint survival [^1][^46].
- **Acceptance tests for the `compact` verb:** (i) summary passes structured-section validation, else rejected (reuse pi's degenerate-summary gate [^29]); (ii) constraint-survival rate ≥ threshold (pin the constitution); (iii) artifact-tracking ≥ uncompacted baseline; (iv) compaction count cap enforced; (v) no compaction while item worktree is dirty.
- **Acceptance tests for the fresh-conversation lever:** (i) handoff carries pointers into the store for every fact; (ii) re-primed session is byte-stable (cache-friendly); (iii) verifier spawned fresh inherits no author summary.

### 5. Proposed ROADMAP items (registered, not scheduled)

- **New — Masking layer:** expose per-entry tool-result + thinking-block clearing (deterministic, zero model calls), with the "never clear an open call / keep N recent pairs" invariants. Gate on confirming what `ContextView.contributions` exposes.
- **New — Constraint pinning:** re-inject the constitution + seat invariants verbatim outside any summary; validate with a constraint-survival probe. This is the single highest-leverage defence against Governance Decay [^1].
- **New — Compaction-count cap + forced fresh session** per session lifetime [^1].
- **New — Compaction-Eviction hardening:** treat in-context content as untrusted for the summarizer; never let task/tool content issue summarizer instructions [^1].
- **Correction to item 27–30:** the `compact` verb (28a) should be **blocked** on degenerate stop reasons and on dirty worktrees; item 30b's "cache-cold or task boundary" should be stated as the *default*, not an option.
- **Correction to RANK 4 (#62):** the guard should own the trigger and set the platform threshold above itself (above).

---

## Explicitly unverified

1. Whether Chroma's 18-model study or *Context Compaction Theory* cover DeepSeek-V4.1-Flash / GLM-5.3-Flash specifically.
2. Whether `reasoning_content` is counted in token usage/billing by DeepSeek (docs are silent) [^3].
3. Whether durig's `contextWindow: 1_048_576` matches actual served behaviour on DeepInfra.
4. What pi-durable's `ContextView.contributions` exposes for per-entry clearing.
5. Whether a summary-submission racing a task submission is a real hazard in `src/broker.mjs` (C10) — no external prior art found.
6. Any controlled study that background compaction specifically starves a single-GPU generation slot (C9).
7. Any controlled head-to-head showing fork beats isolate on task outcome (D12), or fork-vs-isolate for retries (D13).
8. Whether the 15× multi-agent figure holds for a broker queue of long-lived seats (F20) — my 4×-like inference is unproven.
9. Numeric alert thresholds for the probe suite (F18).

---

## Corrections to the first pass

- The first pass treated "compact at 90% / 150K tokens" as a shipped-default fact worth noting. **Sharpen it:** for your two flagships the shipped default is ~1.03M, i.e. ~3–4× past the *vendor's own* operating point [^55][^10][^5]. This is not a tuning detail — it means automatic compaction will effectively never fire before quality collapses.
- The first pass's "masking beats summarization" conclusion needs the domain caveat above and the new *Governance Decay* counterweight: **summarization's worst failure is not recall loss but silent constraint loss** [^1], which masking does not fix and pinning does.

If you'd like, I can turn this into the full `docs/reviews/context-compaction-followup.md` file with the exact section headings and a per-question evidence table — but I'd need you to paste or upload the baseline docs (`Managing_Long_Context_Length.md`, `ROADMAP.md`, `BROKER-SUPERVISION.md`, the vendored `compaction.d.ts`/`types.d.ts`) so I can map every finding to the real symbols rather than to your brief's summary of them.

**References**

[^1]: [[2606.22528v2] Governance Decay: How Context Compaction Silently Erases Safety Constraints in Long-Horizon LLM Agents](https://arxiv.org/html/2606.22528v2) (15%)
[^2]: [Organizing Context in a Multi-Agent Harness](https://www.langchain.com/blog/organizing-context-in-a-multi-agent-harness) (11%)
[^3]: [Thinking Mode | DeepSeek API Docs](https://api-docs.deepseek.com/guides/thinking_mode/) (8%)
[^4]: [GLM-5.3-Flash/FlashX - Overview - Z.AI DEVELOPER DOCUMENT](https://docs.z.ai/guides/vlm/glm-5.3-flash) (5%)
[^5]: [Deepseek V4's 1M context window: the breaking point](https://www.reddit.com/r/LocalLLaMA/comments/1tfhl0q/deepseek_v4s_1m_context_window_the_breaking_point/) (3%)
[^6]: [Context Management for Deep Agents](https://www.langchain.com/blog/context-management-for-deepagents) (3%)
[^7]: [The Maximum Effective Context Window for Real World ...](https://arxiv.org/pdf/2509.21361) (2%)
[^8]: [Anchoring Bias in LLM-as-a-Judge Systems: Prior Scores Compromise ...](https://arxiv.org/pdf/2608.25869v1) (2%)
[^9]: [Developers: Stop 80% of PII Before Any LLM Call | MLflow](https://mlflow.org/articles/pii-redaction-llm/) (2%)
[^10]: [zai-org/GLM-5.3-Flash](https://huggingface.co/zai-org/GLM-5.3-Flash) (1%)
[^11]: [The Context Window Lie: How Well AI Models Actually Use 1M Tokens in ...](https://codingfleet.com/blog/context-window-lie-how-well-ai-models-use-1m-tokens-2026/) (1%)
[^12]: [Your 1M-Token Context Window Is a Lie After 120K](https://dotzlaw.com/insights/claude-code-14-context-lifecycle/) (1%)
[^13]: [Context Is What You Need: The Maximum Effective Context Window for Real ...](https://www.oajaiml.com/archive/context-is-what-you-need-the-maximum-effective-context-window-for-real-world-limits-of-llms) (1%)
[^14]: [CompactBench](https://compactbench.github.io/compactbench/) (1%)
[^15]: [GitHub - compactbench/compactbench: Open benchmark for LLM context ...](https://github.com/compactbench/compactbench) (1%)
[^16]: [DeepSeek V4.1 Flash API - Demo](https://deepinfra.com/deepseek-ai/DeepSeek-V4.1-Flash) (1%)
[^17]: [DeepSeek V4.1 Flash Context Window — 1.0M tokens | Context Window](https://contextwindows.dev/models/deepseek-v4-1-flash) (1%)
[^18]: [GLM 5.3 - Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-zai-glm-5-3.html) (1%)
[^19]: [Context editing - Claude Platform Docs](https://platform.claude.com/docs/en/build-with-claude/context-editing) (1%)
[^20]: [3.4 Context Editing (Clearing Tool Results) · CCA-F D5](https://basantchoudhary.github.io/ClaudeCertifiedArchitect/CCA-F/D5-Context-Management/subtopics/3-4-context-editing.html) (1%)
[^21]: [Compaction (summarization) | Letta Docs](https://docs.letta.com/v1-sdk/messages/compaction) (1%)
[^22]: [feat (compaction): cache-friendly summary requests and ... - GitHub](https://github.com/matthewyjiang/rho/issues/1277) (1%)
[^23]: [Compaction on demand - Claude Platform Docs](https://platform.claude.com/docs/en/build-with-claude/compaction-on-demand) (1%)
[^24]: [Prompt caching | OpenAI API](https://developers.openai.com/api/docs/guides/prompt-caching) (1%)
[^25]: [An Evaluation of Prompt Caching for Long-Horizon Agentic ...](https://arxiv.org/html/2601.06007v2) (1%)
[^26]: [Prompt Caching: How It Works, Provider Pricing, Cache-Aware Routing (2026)](https://www.morphllm.com/prompt-caching) (1%)
[^27]: [Prompt Caching Playbook for Agentic LLMs — Costs & Latency](https://dev.to/nainikmehta/prompt-caching-playbook-for-agentic-llms-costs-latency-40nl) (1%)
[^28]: [Prompt Caching in Practice: From 7% to 74% Hit Rate ... - DigitalOcean](https://www.digitalocean.com/community/conceptual-articles/prompt-caching-in-practice-hit-rate) (1%)
[^29]: [fix(coding-agent): reject degenerate stop-reason compaction ... - GitHub](https://github.com/earendil-works/pi/issues/8652) (1%)
[^30]: [agentic-engineering-wiki/wiki/context/compaction-vs-context-reset.md at ...](https://github.com/xchewtoyx/agentic-engineering-wiki/blob/main/wiki/context/compaction-vs-context-reset.md) (1%)
[^31]: [Context compaction loses operational continuity in long Codex tasks ...](https://github.com/openai/codex/issues/29356) (1%)
[^32]: [Handoff Debt: The Rediscovery Cost When Coding Agents Take Over ...](https://arxiv.org/html/2606.02875v1) (1%)
[^33]: [GitHub - woclaw/agent-handoff-capsule: Structured handoff files for AI ...](https://github.com/woclaw/agent-handoff-capsule) (1%)
[^34]: [agent-toolkit/skills/session-handoff/references/handoff-template.md at ...](https://github.com/softaworks/agent-toolkit/blob/main/skills/session-handoff/references/handoff-template.md) (1%)
[^35]: [Context Offloading - ASDLC.io](https://asdlc.io/practices/context-offloading/) (1%)
[^36]: [Context Offloading Pattern for Agents (2026) | Agent Native](https://www.agentnative.dev/patterns/context-offloading-pattern-for-agents) (1%)
[^37]: [Active Context Compression: Autonomous Memory Management in LLM Agents](https://arxiv.org/html/2601.07190v1) (1%)
[^38]: [Compaction overview - Claude Platform Docs](https://platform.claude.com/docs/en/build-with-claude/compaction) (1%)
[^39]: [Compaction | Microsoft Learn](https://learn.microsoft.com/en-us/agent-framework/concepts/agents/conversations/compaction) (1%)
[^40]: [Context: compaction, resets, and anxiety · Everything Agents](https://everythingagents.org/topics/agent-harnesses/04-context-management) (1%)
[^41]: [Context engineering: memory, compaction, and tool clearing](https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools) (1%)
[^42]: [[Feature]: Observation masking for older turns: reduce ... - GitHub](https://github.com/NousResearch/hermes-agent/issues/2046) (1%)
[^43]: [Tool_calls with optional tool_results - Feedback - OpenAI Developer ...](https://community.openai.com/t/tool-calls-with-optional-tool-results/947922) (1%)
[^44]: [Agent Context Compaction for Long-Running Sessions: Techniques and ...](https://zylos.ai/research/2026-04-21-agent-context-compaction-long-running-sessions/) (1%)
[^45]: [FAQ - CompactBench](https://compactbench.github.io/compactbench/faq/) (1%)
[^46]: [Lost in Compaction: Evaluating Side-Constraint Loss under Context ...](https://arxiv.org/html/2608.11242v1) (1%)
[^47]: [[2607.25066] Addressable Recall Compaction for Long Context-Window ...](https://arxiv.org/abs/2607.25066) (1%)
[^48]: [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) (1%)
[^49]: [How we built our multi-agent research system - beri.net](https://www.beri.net/learning/anthropic-multi-agent-research-system) (1%)
[^50]: [Anthropic just published their production multi-agent architecture. 90. ...](https://infomly.com/2026/06/15/anthropic-just-published-their-production-multi-agent-architecture-902-faster-15x-token-burn-this-is-the-blueprint) (1%)
[^51]: [How to Redact PII and Secrets from LLM Prompts | Flare Redact](https://flare-collection.github.io/flare-redact/guides/llm-prompt-redaction/) (1%)
[^52]: [PrimeAgentOrchestrator: Memory-Primed Agent Spawning for Personal AI ...](https://arxiv.org/pdf/2608.20342) (1%)
[^53]: [engram/docs/AGENT_MEMORY_CONTRACT.md at master - GitHub](https://github.com/staticroostermedia-arch/engram/blob/master/docs/AGENT_MEMORY_CONTRACT.md) (1%)
[^54]: [Blog | Fast & Reliable AI Inference](https://deepinfra.com/blog/page/2) (0%)
[^55]: [GLM-5.3-Flash: Frontier Intelligence, Flash Cost](https://z.ai/blog/glm-5.3-flash) (0%)
[^56]: [GLM-5.3: Frontier Coding with Emergent Cyber Capabilities](https://z.ai/blog/glm-5.3) (0%)
[^57]: [Your Context Window Is Lying to You — And It's Costing You](https://hexaware.com/blogs/your-context-window-is-lying-to-you-and-its-costing-you/) (0%)
[^58]: [DeepInfra Inc. deepseek-v4.1-flash API Pricing & Cost](https://www.requesty.ai/models/deepinfra/deepseek-v4.1-flash) (0%)
[^59]: [GLM 5.3 Flash - API Pricing & Benchmarks](https://openrouter.ai/z-ai/glm-5.3-flash) (0%)
[^60]: [[Bug]: Infinite compaction / continuation loop prevents ...](https://github.com/code-yeongyu/oh-my-openagent/issues/2736) (0%)
[^61]: [Compaction | Pydantic Docs](https://pydantic.dev/docs/ai/harness/compaction/) (0%)
[^62]: [Context Compaction Is a Decision, Not a Threshold](https://blakecrosley.com/blog/agent-context-compaction) (0%)
[^63]: [GPU Starvation: How One Tenant's Reasoning Prompt ...](https://tianpan.co/blog/2026/04/23/gpu-starvation-reasoning-prompts-multi-tenant) (0%)
[^64]: [V1 engine core deadlocks under concurrent load (fp8 ...](https://github.com/vllm-project/vllm/issues/37729) (0%)
[^65]: [What Is the Verifier Pattern in Multi-Agent Systems? How ...](https://www.mindstudio.ai/blog/verifier-pattern-multi-agent-systems-independent-review) (0%)
[^66]: [Mitigating Anchoring Bias in LLM-Based Agents for Energy ...](https://arxiv.org/html/2606.18272v2) (0%)
[^67]: [How Multi-Agent Self-Verification Actually Works (And Why ...](https://pub.towardsai.net/how-multi-agent-self-verification-actually-works-and-why-it-changes-everything-for-production-ai-71923df63d01) (0%)
[^68]: [subagents.py](https://github.com/langchain-ai/deepagents/blob/main/libs/deepagents/deepagents/middleware/subagents.py) (0%)
[^69]: [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) (0%)
[^70]: [Claude Code Subagent Token Cost: The Preamble Never Stops](https://ranjankumar.in/claude-code-subagent-token-cost) (0%)
[^71]: [Session Recap: Goal-Shaped Handoff at Context Boundaries](https://agentpatterns.ai/patterns/agent-design/session-recap/) (0%)
[^72]: [agent-toolkit/skills/session-handoff/README.md at main](https://github.com/softaworks/agent-toolkit/blob/main/skills/session-handoff/README.md) (0%)
[^73]: [Agent Handoffs and the Human Bottleneck - Werner Robitza](https://slhck.info/software/2026/07/10/agent-handoffs-and-human-bottleneck.html) (0%)
[^74]: [Context Engineering | adongwanai/AgentGuide | DeepWiki](https://deepwiki.com/adongwanai/AgentGuide/4.1-context-engineering) (0%)
[^75]: [Observation Masking: Filter Tool Outputs from Context](https://agentpatterns.ai/context-engineering/observation-masking/) (0%)
[^76]: [Maximising Transparency in Context Compaction Improves ...](https://arxiv.org/html/2610.20116v1) (0%)
[^77]: [Redact PII Before Sending to an LLM (Chat, RAG, Agents)](https://philterd.ai/blog/redact-pii-before-sending-to-an-llm/) (0%)