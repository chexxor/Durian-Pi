# Verifier model survey — what can run cross-family on one A4000 (2026-10-27)

Commissioned by the operator: *"get whichever model is high quality and small enough to fit in VRAM and
sufficient as a verifier. Your search criteria and discovered options must include grounded evidence."*
Every size below came from a HuggingFace tree API call made in this session; every benchmark line is quoted
from the vendor's own model card; every hardware number is measured on this box. Scripts are in
`.scratch/verifier-survey*.mjs` (read-only, disposable).

## Why the rig needs this at all

`check` reports `single-model-rig` (fix-now) because all 12 seats resolve to `local/iq3_s`, a
**Qwen3.8-Flash-Next** quant. D48/D119 want an author and its verifier to differ in *family*, because a shared
blind spot is systemic. `src/checkup.mjs` compares resolved model **strings**, which cannot tell a different
family from a different quant of the same one — so this is a documentation ruling, not something a test can
settle (D134).

## Hard constraints, measured on this box (2026-10-27, Linux)

| Constraint | Value | How measured |
|---|---|---|
| Free VRAM on the card the verifier can use | **15,970 MiB** (A4000, 16,376 total) | `nvidia-smi` with both models unloaded |
| The 3090 | **963 MiB free** — fully committed to the primary | `nvidia-smi` |
| System RAM available | **34 GiB** of 94 | `free -g` |
| Dense-model decode when it spills | **2.8–14.5 tok/s** (Flint Q8_0 and Q6_K) | live `/v1/chat/completions` probes |
| Collateral damage when it spills | primary **31–39 → 11.0 tok/s** (Q8_0), 16.6 (Q6_K) | same probes |

**The sizing rule this implies:** weights + KV cache must fit in **one** card. Cross-card or RAM spilling was
not predicted to be slow — it was measured slow, and it also slows the primary, because both then contend for
RAM and PCIe that the primary's expert cache already occupies.

## On the operator's llama.cpp point — correct mechanism, wrong model class for these candidates

The claim: llama.cpp can hold expert layers in RAM while caching hot tensors in VRAM, making oversized models
usable. That mechanism is real, and it is already how the primary runs (`--resident-experts
--expert-cache auto`). Three grounded corrections:

1. **It only exists for MoE models.** Ministral 3, Devstral 2 and Phi-4 all report **no expert fields in
   `config.json` at all** — they are dense, so every token touches every layer and any layer parked in RAM is
   paid for on every token. There is nothing to park.
2. **We already ran the experiment.** Flint *is* MoE (256 routed experts, 6 active, 2.5B active params — the
   most offload-friendly shape imaginable) and LM Studio did exactly this across A4000 + 3090 + RAM. Measured
   result: 2.8–14.5 tok/s decode, primary degraded to 11.0 tok/s. The mechanism works; the outcome on this box
   is still unusable for a tool-driven seat.
3. **The RAM is already spent.** The primary holds ~40 GiB as shared/expert cache. `free -g` shows 34 GiB
   available with both models unloaded — less than a Q8 Flint needs.

Conclusion for this box: **choose a dense model that fits one card**, rather than an MoE that mostly fits.

## Candidates, with the evidence and the arithmetic

KV bytes/token = `full_attention_layers × kv_heads × head_dim × 2 (K,V) × 2 bytes`, computed from each model's
own `config.json`. None of the shortlisted models use sliding attention, so there is no bounded-cache term.

### 1. Devstral Small 2 24B — `mistralai/Devstral-Small-2-24B-Instruct-2512` ⭐ best evidence for the actual job

- `arch=Mistral3ForConditionalGeneration type=mistral3 vocab=131072 layers=40 kv_heads=8 head_dim=128
  ctx=393216` → **KV fp16 163,840 B/token**: 8k = 1.34 GB, 16k = 2.68 GB, 32k = 5.37 GB, 64k = 10.74 GB.
- Vendor's own table: **SWE-bench Verified 68.0%**, SWE-bench Multilingual 55.7%, **Terminal-Bench 2 22.5%**,
  alongside Devstral 2 123B 72.2%, DeepSeek v3.2 73.1%, GLM 4.6 355B 68.0%, Qwen3 Coder Plus 480B 69.6%.
  This is the only candidate whose published benchmark is *the job* — repo-level code changes with tools —
  rather than a math or trivia proxy.
- Tool calling is documented (27 mentions, incl. `--tool-call-parser mistral --enable-auto-tool-choice`).
- Sizes: `lmstudio-community/Devstral-Small-2-24B-Instruct-2512-GGUF` → **Q3_K_L 12.40 GB, Q4_K_M 14.33 GB**.
  `unsloth/…` additionally has UD-Q2_K_XL 9.29, UD-IQ3_XXS 9.41, **UD-Q3_K_XL 11.85**, IQ4_XS 12.78,
  UD-Q4_K_XL 14.51 (Q5_K_S 16.30 and up are over the card).
- **Fit:** UD-Q3_K_XL **11.85 + 16k KV 2.68 = 14.5 GB** → fits 15,970 MiB with ~1.2 GB margin. Q4_K_M
  14.33 + 2.68 = 17.0 GB → over unless context drops to 8k or KV is quantized.
- **Honest caveat:** 68.0% is the vendor's number for the **unquantized** model. A Q3_K_L of it is unmeasured,
  and the benchmark is SWE-bench, not *this* rig's codebase. Neither number transfers automatically.

### 2. Ministral 3 14B Reasoning — `mistralai/Ministral-3-14B-Reasoning-2512` ⭐ already installed here

- Same family/architecture, `layers=40 ctx=262144` → identical KV cost 163,840 B/token.
- Vendor table (their card, head-to-head against Qwen): **Ministral 3 14B** AIME25 0.850 / AIME24 0.898 /
  GPQA Diamond 0.712 / **LiveCodeBench 0.646**, vs **Qwen3-14B (Thinking)** 0.737 / 0.837 / 0.663 / 0.593.
  Also Arena Hard 0.551 vs Qwen3 14B non-thinking 0.427.
- Caveat that must not be skipped: this beats **Qwen3-14B**, not this rig's primary, which is a far larger
  Qwen3.8-Flash-Next. It is a *family* cross-check, not a capability claim about our author seats. It is also
  Mistral's own card.
- Sizes: Q4_K_M 8.24, **Q6_K 11.09** (installed), Q8_0 14.36. **Fit:** Q6_K 11.09 + 16k KV 2.68 = **13.8 GB**,
  comfortable; +32k KV 5.37 = 16.46 GB, over.
- No SWE-bench figure published → agentic coding capability unverified by the vendor.

### 3. gpt-oss-20b — `openai/gpt-oss-20b`: the only fit-friendly MoE, and the weakest evidence

- `arch=GptOssForCausalLM vocab=201088 layers=24 (12 full-attn) kv_heads=8 head_dim=64 ctx=131072
  sliding=128`, MoE `"num_local_experts":32 "num_experts_per_tok":4` — so here the operator's offload idea
  genuinely applies, and KV is tiny: **0.79 GB at 32k**, 1.57 GB at 64k. File: 12.11 GB MXFP4.
- **The model card publishes no numeric benchmark rows at all** (0 found by extraction). Same evidence class as
  Flint: tool use is described, capability is not measured. Not chosen on that basis.

### 4. Phi-4 — disqualified, not on size

- 7.93–15.58 GB, so it fits, and the card publishes real numbers (HumanEval 90.6, MMLU 88.1, GPQA 56.1,
  DROP 90.2). But **`ctx=16384`** — a seat reviewing a multi-file diff plus a queue item plus a runbook
  excerpt overflows the model's whole window — and **tool calling is not documented anywhere on the card**
  (0 mentions). A verifier seat here is a text oracle. Rejected on fitness, not size.

### 5. Flint — re-measured, still not viable here

- Cross-family is real (`FlintForCausalLM`, trained from scratch, own 150,144 vocab, no declared baselines) and
  **tool calling was verified live** (`finish_reason: tool_calls`, valid JSON arguments).
- But: **no published evals anywhere**, and both quants that were tried spill. Q6_K 32.72 GB and Q8_0 42.35 GB
  against a 16,376 MiB card → 2.8–14.5 tok/s and the primary at 11.0–16.6. Keep as a ceiling test, not a seat.

### Also checked and set aside

`lmstudio-community/flint-GGUF` smallest quant is **Q4_K_M 24.17 GB** — over the card. `bartowski` has
IQ2_XXS 12.03 / Q2_K 15.48. Gemma 3 12B QAT is 6.89 GB but its config is license-gated, so architecture and KV
could not be verified. Granite 4.0 / Mistral Small 3.2 24B GGUF repos were not found under the expected names.
Qwen3-Coder quants are excluded by the invariant itself (same family as the primary).

## Recommended order

1. **Free:** the already-installed **Ministral 3 14B Reasoning Q6_K, context 16,384.** This costs no download
   and proves the plumbing end to end: `verifier` provider, seat flip, `single-model-rig` clearing, and the
   seeded-bug calibration harness. Expected ~13.8 GB resident on the A4000.
2. **If verdict quality is the limit:** download **`unsloth/Devstral-Small-2-24B-Instruct-2512-GGUF`
   UD-Q3_K_XL (11.85 GB)**, context 16,384 — the strongest code-agent evidence available at this size.
3. **Set context explicitly.** These models advertise 262k–393k windows; at 64k the KV alone is 10.74 GB, which
   is the whole card. `DURIG_VERIFIER_CONTEXT` must stay at 16k–32k, and LM Studio's context slider must match,
   or the sizing math above is fiction.

## The gate no benchmark can replace

Capability on *this* rig is unverified for every candidate. The calibration is cheap and the ground truth is
already in this repo: paste the two real bugs fixed in `3bff94a` — `linkWorktreeDeps` handing a script path to
`npm` as a command (dependency linking had never worked on any platform), and `waitForProcessDeath` answering
on the first `kill(pid,0)` while ignoring its deadline (a permanent false "still running") — both sat
undetected by every seat and every check for months, and both have known fixes. If a candidate cannot name
them, cross-family verification is not being obtained, whatever `check` reports. Recorded in ROADMAP 189.

## CONTROL RESULT — the primary ran the calibration first, and it split

Run 2026-10-27 against the live primary (`local/iq3_s`, Qwen3.8-Flash-Next IQ3_S) with
`.scratch/calibrate-verifier.mjs`. Same two pre-fix snippets, extracted from git at `3bff94a^`, verbatim.

| Snippet | Did the primary name the real defect? |
|---|---|
| **A** — `linkWorktreeDeps` npm invocation | **YES, exactly.** *"npm treats the first argument as an npm command, not a script path… fails with npm 'unknown command' error, so `linkWorktreeDeps` always reports a failed link step."* |
| **B** — `waitForProcessDeath` POSIX deadline | **NO, and it invented a different one.** It answered that `taskkill` doesn't exist on Linux so descendants are orphaned — adjacent, plausible, and **not the bug** (the bug is that the POSIX path checks liveness once, sleeps 100 ms, and returns while `timeoutMs` is never polled). |

**Why this matters more than a benchmark.** The real defect in B is a *missing loop*, and the model replaced it
with a confident, wrong mechanism. That is the failure mode `single-model-rig` exists to guard against, now
observed rather than assumed — and note the same run caught A cleanly, so this is not "the model is bad", it is
"the model has specific blind spots and cannot be trusted to flag its own." A second family is worth having for
exactly that asymmetry.

**Honest limits on this measurement.** n = 1 prompt per defect, temperature 0.2, one quant of one family, no
repeats, and the snippets were shown out of file context (lines 140–200 and 255–300). It establishes that the
harness discriminates (it separated a hit from a miss on known ground truth) — not how often. Treat it as the
baseline the verifier is measured against, and re-run it on the verifier under the same conditions.

**A harness finding that applies to the rig itself.** The first run used `max_tokens: 900` and the model
returned an **empty answer with `finish_reason: length`** — all 900 completion tokens went to
`reasoning_content`. That is the concrete form of the truncation risk behind per-provider `maxTokens` (D134): a
thinking verifier given too small a budget does not fail loudly, it says nothing. Any seat-facing budget must
cover reasoning **plus** the answer. Re-run at 3000 produced `finish_reason: stop` with a real answer.
