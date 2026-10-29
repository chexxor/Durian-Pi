# Control the model server behind a provider (LM Studio at `:1234`)

**Status:** delegate-written, partially verified. Verified: every endpoint, schema and number below was
executed on **Linux (Fedora, box `Alex-Desktop-Win10`, node v24.22.1) on 2026-10-29**, against LM Studio's
v1 REST API at `http://127.0.0.1:1234`. Unverified: anything about a different LM Studio version, and the
capability verdict for `recursivesi/flint` (the gate run was still in flight at clock-out — see
`docs/reviews/delegate-notes-2026-10-29-flint-verifier.md`).

**Use this when:** a seat's model is not what `rig.selfdev.json` claims it is; a served model answers
`Failed to load model` although the server lists it as loaded; you must change which model a provider serves,
change its context window, or free room for a second model; or `check` reports `single-model-rig` as `fix-now`.

**Writes?** It writes to the **model server**, never to the store — no broker stop is needed, and no seat is
disturbed if the broker is down. But it *does* take a model away from any seat already running on it: do this
while the broker is down or with the affected seats idle, and never in the middle of a `gate.mjs` run.

## Do it in this order

1. **Read the truth, not the config.** `GET /api/v1/models` — per model: `publisher`, `key`, `quantization`,
   `size_bytes`, `max_context_length`, and `loaded_instances[]` with the **live** `config` (`context_length`,
   `parallel`, `flash_attention`, `offload_kv_cache_to_gpu`, `num_experts`). The OpenAI-compatible
   `GET /v1/models` lists ids only and shows **no** context — it cannot answer "what window does this seat get".
   Endpoints that do **not** exist on this build (each returned `Unexpected endpoint or method`): `GET
   /api/v1/system`, `GET /api/v1/loading`, `GET /api/v1/models/<key>/load`, `GET /api/v1/models/download/status`,
   `GET /mcp`. The whole surface is: `POST /api/v1/chat`, `GET /api/v1/models`, `POST /api/v1/models/load`,
   `POST /api/v1/models/unload`, `POST /api/v1/models/download`.
2. **Prove servability — a listed instance is not a working model.** Measured 2026-10-29: flint showed
   `loaded_instances: 1` at `context_length: 262144` while **every** inference call returned HTTP 400
   `Failed to load model "recursivesi/flint"`. The listing is a registration, not a health check. The only proof
   is a completion:
   `curl -s $B/v1/chat/completions -d '{"model":"<key>","messages":[…],"max_tokens":400}'`
   and **give a reasoning model room**: the same call at `max_tokens: 8` returned `finish_reason: stop` with
   **empty `content`**, and at 400 it used **250 of 279 tokens on reasoning**. An empty answer from a reasoning
   model at a small budget is a budget artifact, not a dead model (`docs/SELFDEV.md`, "judge a model by its
   OUTPUT SHAPE").
3. **Change the window with `load`, whose keys are FLAT.** `POST /api/v1/models/load` with
   `{"model":"<publisher/key>","context_length":65536,"flash_attention":true,"offload_kv_cache_to_gpu":true,
   "eval_batch_size":2048,"echo_load_config":true}`. Nesting them under `load_params` is rejected:
   `Unrecognized key(s) in object: 'load_params'`. Only these keys are documented for load: `model`,
   `context_length`, `eval_batch_size`, `flash_attention`, `num_experts`, `offload_kv_cache_to_gpu`,
   `echo_load_config`.
   `POST /api/v1/models/unload` takes **`instance_id`**, not `model` — sending `model` gives
   `Missing required field 'instance_id'`. The `instance_id` is the `loaded_instances[].id` from Step 1.
4. **Expect the transport to lie, and verify anyway.** Both `unload` calls returned `HTTP 000` to curl
   (no response) while the action **landed** — confirmed by re-listing models. Never conclude failure from an
   empty response, and never blind-retry: re-`GET /api/v1/models` and check `loaded_instances`.
5. **Close the loop into the rig.** The value in `context_length` is what the rig must *declare*:
   `durig.config.json` (gitignored, machine-scoped) `DURIG_VERIFIER_CONTEXT` **must equal it**. Then the seat
   strings in `rig.selfdev.json` must be `verifier/<DURIG_VERIFIER_MODEL>` — `demo/local-model-pointer.test.mjs`
   pins every locally-pointed seat to the model the provider actually exposes, and its guard is two-sided on
   purpose: if `DURIG_VERIFIER_BASE_URL` is unset, `resolveSeatModel` (`src/seatmodel.mjs:16-21`) treats the
   whole `"verifier/x"` string as a model id under the **default** provider, so a rig written to be cross-family
   runs single-family and still reads healthy. Re-run `node demo/local-model-pointer.test.mjs`,
   `node demo/second-local-provider.test.mjs`, and `DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json`
   (expect `single-model-rig` to clear and `verification-without-evidence` to stay red — 435 rows today).
6. **Never flip a verifier without the gate.** `docs/reviews/verifier-model-survey-2026-10-27.md`: **"Gate
   before flipping, always."** `D137`: a verifier that fails the seeded-bug gate is *worse* than no verifier,
   because `check`'s `single-model-rig` is only a **string comparison** and clearing it would be a green lie.
   Run `node tools/model-probes/gate.mjs http://127.0.0.1:1234/v1 <model-id> <label> --plan` first (spends
   nothing, prints the matched-pair accounting), then the real arm with `--replicate 3 --pair-comments
   strip-both`. Cost measured 2026-10-29 on flint: **~2 minutes per cell** (reasoning-heavy decode), i.e.
   ~1.5–2 h for the 54-cell k=3 matrix — budget it.
7. **Before you blame the box for `REQUEST FAILED fetch failed`, check the transport.** `gate.mjs:96` (and every
   other probe in `tools/model-probes/`) calls **non-streaming** `fetch`, and llama-server sends the response
   *headers* only when generation finishes — so Node's global-fetch default `headersTimeout` of **300 s** kills
   any generation longer than five minutes, and `gate.mjs:426` prints only `e.message`, which is the useless
   `fetch failed`. Measured 2026-10-29 (Linux, node v24.22.1, `.spike/gate/timeout-hypothesis.out`), same request
   body both times: **global fetch** → `300.8s`, `TypeError: fetch failed`, cause
   **`HeadersTimeoutError` [`UND_ERR_HEADERS_TIMEOUT`]**; **`node:http` with `req.setTimeout(0)`** → **200 in
   372.0 s**. A 300-second ceiling therefore *looks exactly like* an out-of-RAM box, and last session's pointer
   blamed swap. Work out which one you have: reproduce the call printing `err.cause`, and compute
   `output_budget_tokens ÷ measured_decode_tok_s` — if that exceeds 300 s, the ceiling, not memory, got your run.
   The product fix (stream, or a dispatcher timeout, and print `err.cause`) is **ROADMAP 254**.

## The arithmetic that decides whether a local model can be a verifier at all

Two ceilings, and the rig's is **shorter** than the instrument's. The provider path is the `openai` SDK with a
**600,000 ms** total request timeout (`src/config.mjs:330-344`, `DURIG_STREAM_TIMEOUT_MS` is `null` = platform
default) plus **2 SDK-level retries**. So on this box a generation longer than **10 minutes fails as a provider
error three times in a row**, and `DURIG_VERIFIER_MAX_TOKENS 8192` at the measured **10.75 tok/s** is **762 s** —
a declared output budget the rig cannot receive. That mismatch is **ROADMAP 255**. **Both figures in that paragraph are
variant-specific, and the variant changed later the same day — read the variant-activation section below before quoting
them:** at Q4_K_M's measured **42.21 tok/s** the same 8,192-token budget is a **194 s** generation, i.e. comfortably
inside both ceilings. The defect (**a declared budget with no measured decode speed behind it**) is unchanged; its
severity is what moved.

And the reasoning budget is not a knob on this model. `GET /api/v1/models` reports flint
`capabilities.reasoning: {allowed_options: ["on"], default: "on"}` — **there is no API switch to turn reasoning
off** — and two attempts to route around it changed nothing, both at `max_tokens: 1200` on a *20-line* file with
an explicit "answer in under 120 words" instruction (`.spike/gate/reasoning-lever-arms.out`, 2026-10-29):

| Arm | Result |
|---|---|
| baseline | 82.0 s, `finish=length`, completion **1200**, **answer 0 chars**, reasoning 3,814 chars |
| `chat_template_kwargs {thinking:false}` | accepted, ignored: 82.5 s, `finish=length`, **answer 0 chars**, reasoning 4,160 chars |
| `thinking:false` (top level) | 80.6 s, `finish=length`, **answer 0 chars**, reasoning 4,016 chars |
| `max_tokens 4000` (separate probe, **Q6_K**) | 372.0 s, `finish=length`, completion **4000**, **answer 0 chars**, reasoning **17,554 chars** |

**Read that before concluding `TRUNCATED-EMPTY` is a knob-tuning problem.** A model that never reaches its answer
inside the budget this hardware can deliver is not a verifier, however good its reasoning would be; the lever is
**decode speed** (a smaller quantization that fits the GPU, or a different model), not a bigger `max_tokens`.
`max_context_length` is not the constraint either: flint will load at 262,144 on paper and cannot be served there.

**And the reasoning preamble scales with prompt difficulty — which is why a smoke test on this model proves nothing.** The
same model, same server, two prompts: `"Reply with exactly: READY"` at `max_tokens:20` → **empty answer, all 20 tokens
consumed as reasoning**; the same request at `max_tokens:300` → **`"READY"`, `finish=stop`, 24 completion tokens, 89
reasoning chars**. A trivial prompt clears its preamble in ~30 tokens, so it looks healthy at any sane budget; the class
of prompt a verifier exists for (a file with a seeded defect) reasoned for **17,554 chars without answering**. So
**measure the reasoning preamble at corpus-like prompts**, never at a hello-world, before concluding a verifier is
feasible at some `max_tokens`.

## Activating a downloaded quantization (variant) without the GUI — measured 2026-10-29; it changed every deadline in this runbook

**Symptom: the download succeeded, the variant is in the catalog, and nothing you can call can start it.** After
`POST /api/v1/models/download`, `GET /api/v1/models` listed `recursivesi/flint` with **three** variants (`@q6_k`,
`@q8_0`, `@q4_k_m`), but selection is not exposed: REST `load` rejects `variant`, `quantization` and `selected_variant`
with `Unrecognized key(s)` (its body is `additionalProperties:false`), `lms load --help` has **no quantization flag**, and
`lms load "recursivesi/flint@q4_k_m"` → **`Model not found`**. The upstream wording that mentions `selected_variant`
describes the **GUI's** request body, not the REST server's.

**What works from a shell (reversible, one rename each, nothing deleted):** unload the live instance, move the *other*
variants' `.gguf` files out of the scanned models tree, then `load` — with one variant on disk the catalog collapses and
the plain load body starts it.

```bash
# 0. which .gguf is actually live — the API never says; the process line does:
ps -eo args | grep llama-server | grep -o '\-\-model .*gguf'
# 1. unload BY instance_id (see trap 1), then confirm it is gone
curl -s -X POST http://127.0.0.1:1234/api/v1/models/unload -H 'content-type: application/json' \
  -d '{"instance_id":"recursivesi/flint"}'
# 2. set the other variants aside — same filesystem ⇒ instant rename; restore = mv back
mkdir -p ~/.var/app/ai.lmstudio.lm-studio/.lmstudio/set-aside-flint-q6-q8
mv ~/.var/app/ai.lmstudio.lm-studio/.lmstudio/models/lmstudio-community/flint-GGUF/flint-Q6_K.gguf \
   ~/.var/app/ai.lmstudio.lm-studio/.lmstudio/models/lmstudio-community/flint-GGUF/flint-Q8_0.gguf \
   ~/.var/app/ai.lmstudio.lm-studio/.lmstudio/set-aside-flint-q6-q8/
# 3. load as usual, then re-run step 0 to VERIFY the file the server opened
curl -s -X POST http://127.0.0.1:1234/api/v1/models/load -H 'content-type: application/json' \
  -d '{"model":"recursivesi/flint","context_length":65536,"flash_attention":true,"offload_kv_cache_to_gpu":true}'
```

Measured on this box: catalog 3 variants → **`recursivesi/flint@q4_k_m` only**; `load` returned
`{instance_id, load_time_seconds, status}`; `ps` confirmed `--model …/flint-gguf/flint-Q4_K_M.gguf`; **decode
10.75 → 42.21 tok/s** (1,500 tokens in 35.5 s). At 42 tok/s the probes' 300 s transport ceiling binds at **~12,600**
output tokens and the rig's 600 s request deadline at **~25,200**, so `DURIG_VERIFIER_MAX_TOKENS: 8192` is a **194 s**
generation instead of 762 s, and a k=1 gate run moves from ~3 h to ~45 min. **Ask before doing it on a rig you do not
own**: it changes what every other seat's verifier model *is*, even though the model key does not change.

**Traps, all hit on 2026-10-29.** (1) **`unload` requires `instance_id` when an instance is live** — `{"model": …}`
returns `missing_required_parameter`; the same shape appeared to "work" earlier only because nothing was loaded and the
call 404'd. (2) **`loaded_instances[].id` is not stable** — it read `llamaserv.cppyyvz2t8` and later
`recursivesi/flint`; re-read it immediately before an `unload`. (3) **Moving a live instance's file out from under it
does not kill it** (the handle stays open), so it looks like the unload happened when it did not — unload first. (4)
**Verify the variant by the `--model` path, never by the model key**: the key is identical across variants, which is
exactly how a "we upgraded the verifier" claim can be false. (5) **Two path identities for the same tree** — the scanned
catalog is `~/.var/app/ai.lmstudio.lm-studio/.lmstudio/models/…` while the server's command line prints
`~/.lmstudio/models/…`, and `~/.lmstudio` does not exist as a host directory here. (6) **This box has two GPUs** —
`nvidia-smi` reports a **16,376 MiB** card and the **24,576 MiB** 3090 — so any "it fits in VRAM" claim must name which
card; Q4_K_M's ~22.5 GiB of weights nearly fill the 3090 alone.

**The capability finding does not travel with the speed win — that is the trap for whoever picks up the verifier.** Q4
answers when the prompt is simple (`"Count from 1 to 900"` at `max_tokens:1500` → 1,715 **answer** chars + 1,968
reasoning chars; `"Reply with exactly: READY"` at 300 tokens → `"READY"`, `finish=stop`, 24 tokens, 89 reasoning chars),
but on **corpus-like** prompts it still spends the whole budget reasoning: all four reasoning-lever arms at
`max_tokens:1200` returned **`answerChars=0`** on Q4 too (3,491–4,236 reasoning chars in 24.7–25.7 s), and the first cell
of the seeded-bug gate — `H1-npm-invocation`, **defect** side — came back **`TRUNCATED-EMPTY` at 6,000 tokens / 161.8 s**
while its **clean control on the same file answered at 1,889 tokens / 42.6 s**. The model reasons hardest precisely where
the verifier is being asked to find something, so a hello-world smoke test that clears the budget says nothing about gate
feasibility. Speed removed the **transport and deadline** blockers (254, 255); it has not yet produced a verifier that
finishes an answer on the prompts that matter.

## What the first **completed** gate run on this model measured — read the denominators before the rate

`CAL_MAX_TOKENS=6000`, fragment feeding, `--pair-comments strip-both`, `--replicate 1`, Q4_K_M, 24 prompts, ~50 min wall
clock (`.spike/gate/flint-q4-k1-out6k.log`; transcript `.spike/gate/flint-q4-k1-out6k.json`, 548,811 B). The
instrument's own SUMMARY, quoted rather than paraphrased:

```text
control turns claiming an absent binding (import/undefined/ReferenceError): 3 — excused where no code-level claim was made (ROADMAP 195)
defect items named:  1/1 scored (8 attempted)   (pre-registered PHANTOM present in 1)
control conditions dropped as corpus bugs: 12
clean, leading prompt:   FALSE-ALARM 1/1, CLEAN-PASSED 0, AMBIGUOUS 0
clean, neutral prompt:   FALSE-ALARM 3/3
control claims EXCUSED as excerpt artifacts (ROADMAP 195, not counted as judgement failures): 0
truncated (finish=length): 19 of 24 prompts
```

**The reading, in order of how much it should change a decision.** (1) **19 of 24 prompts never reached
`finish=stop`**, so the run is mostly *absence of evidence*; the flattering denominator (`1/1 scored`) and the honest one
(`8 attempted`) sit four lines apart, and the shape of the line invites a reader to take the first — that is
**ROADMAP 257**, and it matters because **253** would put this line in the path of `done`. (2) **Every control that
answered was a false alarm** (leading 1/1, neutral 3/3): when the model does finish, it **over-claims on clean code**.
(3) The one scorable defect cell was a real hit — `H2-process-death-deadline`, `HIT+PHANTOM groups=3/3 need=2`
(108.1 s, 2,697 tokens) — the first HIT this model has ever recorded here, which is why the answer is *not* "flint is
blind" but "flint cannot deliver a judgement inside the budget, and what it delivers when it can is miscalibrated".
(4) **Two of the control false alarms are at least partly the instrument's fault, and the instrument half-knows it**: both
claimed *missing `node:fs`/`node:path` imports* on a file whose import block **the fragment window had cut off** — a
correct inference about the excerpt and a wrong claim about the file. **195**'s excuser saw the class
(`control turns claiming an absent binding … : 3`) but excused **0**, because it excuses only when the turn makes *no*
code-level claim. Before counting a control false alarm against a model, check whether the claim concerns material the
run **did not feed**; and the clean control for that confound is `--whole-module` (the items that fit are 1,686–7,139 est.
tokens), not a bigger `max_tokens`.
(5) **Effective decode in-run was 21.8–48.9 tok/s (p50 35, n=24)** — a 2.2× spread inside one run, versus 42.21 in an
isolated micro-benchmark. **Budget off the low end of a spread measured while the run is happening**, and note the
neighbour: `nvidia-smi --query-compute-apps` shows `strata-host` PID 2289527 holding **14,632 MiB on GPU0 (RTX A4000) at
100 % utilisation** while `llama-server` PID 2426431 holds 19,102 MiB on GPU1 (RTX 3090).

**So: is this model a cross-family verifier? On this evidence, no — and the evidence is now re-runnable rather than
absent.** The cheapest decisive next experiment is **not** another 6,000-token fragment run: it is a **`--whole-module`
k=1 run over the items that fit (M1 2,086 / M3 1,686 / M2 7,139 / H2 4,096 / H5 4,145 est. tokens) at an output budget Q4
can deliver inside 300 s (~10,000 tokens at 34 tok/s)** — it removes the excerpt confound, targets the three
proof-backed mutants, and costs ~30 min. If the false-alarm-on-controls pattern survives that, change models rather than
budgets (**D137**'s cross-family constraint is the operator's to relax, not a delegate's).

## The host can hand the model an UNBOUNDED thinking instruction — check the request, not the model (measured 2026-10-29)

**Symptom:** every completion ends `finish=length` with an **empty `content`** and a large `reasoning` field, at any
`max_tokens`, and no reasoning toggle helps (`chat_template_kwargs {thinking:false}`, top-level `thinking:false`,
`reasoning_effort:low`, `chat_template_kwargs {reasoning_enabled:false}` — all four measured, all ignored).

**Cause, read off the disk:** `llama-server` runs with `--jinja --chat-template-file …/lmstudio-chat-template-*/chat-template.jinja`
(real path under `/home/chexxor/.var/app/ai.lmstudio.lm-studio/.lmstudio/.internal/temp/…`; the cmdline prints the
`~/.lmstudio/…` form). That template's first lines set a **default system message used only when the request carries no system
message** (`{%- if messages[0]['role'] == 'system' %}`), and its text is:

> `First draft your thinking process (inner monologue) until you arrive at a response … [THINK] … Be as casual and as long as you want until you are confident to generate the response … [/THINK] Here, provide a self-contained response.`

**Matched pair** — `ministral-3-14b-reasoning` **Q6_K**, one-line task, `temperature 0`: no system message → 400/400 tokens,
`finish=length`, `content=0ch`, `reasoning=1,644ch`; **with** a system message saying *"Answer directly. Keep any internal
reasoning under 80 words. State your verdict first…"* → **1.9 s, `finish=stop`, 62 tokens, `content=283ch`, `reasoning=0ch`**,
verdict correct. Raising that arm's budget to 1,200 changed **nothing** (still 62 tokens) — the budget was never the lever.
`gate.mjs` does send a system message, so gate numbers are unaffected; **any new one-shot verifier/probe call site must send one
too**, and a probe should assert that it did.

**Retained artifact for the same failure mode**, so the claim survives the session: `.spike/gate/ministral-probe.json` — the
counting task, **no** system message, `max_tokens 600` → `finish=length`, completion **600** of which
`usage.completion_tokens_details.reasoning_tokens = 599`, `content` **0 chars**, `reasoning_content` **2,404 chars** — and the
reasoning text says out loud *"typing out all 200 numbers manually would be tedious, but since this is a thought process
simulation, I'll represent it as such"*. That is the same shape as flint's truncated cells: **the model spends the whole budget
on the monologue and then abstains**. The 400-token arm in the matched pair was run in-session and its body was not retained; to
reproduce, send the same one-line task twice with `temperature 0` and add a `"system"` message as `messages[0]` on the second
call, and **keep both bodies this time**.

**Serving facts to record with any model here** (the API model key never tells you any of this — read
`ps -eo args | grep '[l]lama-server'`): ministral-3-14b-reasoning is served as **Q6_K**, `--ctx-size 8192`, `--parallel 4`,
`--n-gpu-layers 999999`, `--flash-attn on`, **23.0/24.5 GiB on GPU1**, decode **31.6 tok/s**. A rig config declaring
`DURIG_VERIFIER_CONTEXT 65536` against an 8,192-token server while `MAX_TOKENS 8192` is asking for an impossible request
(prompt + 8,192 output > 8,192 total) — nothing in `check` catches that class today (ROADMAP 259).

## Probe discipline on this box — my own arms helped OOM-kill the seats' server (2026-10-29, incident)

Swap stood at **8 GiB of 8 GiB zram used, 0 free** before I started, and I ran repeated arms against a **65,536-context** flint
Q4_K_M (≈19 GiB resident on GPU1) with `strata-host` holding ≈12.6 GiB on GPU0, plus `buildCorpus()` (a parse-check subprocess
per candidate window) alongside. The kernel terminated the **Strata** service — i.e. the **seats'** model server. Before each
arm: print `free -g` available, `swapon --show`, `nvidia-smi --query-gpu=memory.used,memory.total`; stop if available
< 10 GiB or swap > 50 % used; **one arm at a time**; never a corpus build concurrently with a generation arm; keep **one**
large-context engine resident. `buildCorpus()` alone exceeds 200 s here, so a re-scoring instrument that rebuilds the corpus per
invocation looks "hung" before it looks wrong.

## Switching which model the rig uses — TWO config surfaces and one oracle (measured 2026-10-29)

A model swap is not one edit. These two must agree, or the rig sends a request the server will not serve:

| surface | tracked? | what it names |
|---|---|---|
| `durig.config.json` → `DURIG_VERIFIER_BASE_URL` / `_MODEL` / `_CONTEXT` / `_MAX_TOKENS` | **no** (gitignored) | the provider: endpoint, default model id, declared window, declared output ceiling |
| `rig.selfdev.json` → each seat's `"model": "<provider>/<modelId>"` | **yes** | the per-seat pointer — **five** seats carry `verifier/…` |

`src/seatmodel.mjs:19` splits at the **first** `/`, and only when that leading segment names a registered provider, so a model id
that itself contains a slash is fine: `verifier/mistralai/ministral-3-14b-reasoning` → provider `verifier`, model
`mistralai/ministral-3-14b-reasoning`. **Editing only the first surface is the trap I fell into:** on 2026-10-29 the config said
ministral while all five verifier seats still said `verifier/recursivesi/flint`, and `check` did not notice — `single-model-rig`
**passed**. The oracle is the pointer test, which was RED until both surfaces agreed:

```bash
node demo/local-model-pointer.test.mjs      # seat pointer vs what the provider exposes — run after ANY model change
node demo/second-local-provider.test.mjs    # the two-provider wiring
DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json | head -40   # single-model-rig, no-verifier-seat
curl -s http://127.0.0.1:1234/v1/models | python3 -c 'import sys,json;[print(m["id"]) for m in json.load(sys.stdin)["data"]]'   # ids the server will accept
```

**Why the disagreement is dangerous rather than merely wrong:** a seat request naming a model with **no loaded instance** cannot be
served as intended, and what the host does next was **not tested here** — either it errors, or it loads the model, and a `flint`
load onto a card already holding 23.0 of 24.5 GiB is the second branch. Do not discover which one on a live conversation.

## What one RTX 3090 does and does not buy you as a verifier (2026-10-29, measured on this box)

**Topology, from the config and the process table, not from memory:** the **seats** are served by `strata-host` on
`DURIG_LOCAL_BASE_URL http://127.0.0.1:47831/v1`, model **`Qwen3.8-Flash-Next IQ3_S`** (label from its own `/v1/models`),
held on **GPU0 = RTX A4000 16,376 MiB, 14,632 MiB resident**. The **verifier** is LM Studio `:1234` on
**GPU1 = RTX 3090 24,576 MiB**, where `llama-server` holds **19,102 MiB** for flint Q4_K_M. So the 3090 is already
**effectively dedicated to the verifier** — capacity is *not* the blocker, and any claim that "the verifier is slow because
the box is full" should be checked against those two numbers.

**What the card buys:** decode (**10.75 → 42.21 tok/s** by changing quantization), and headroom for a bigger/wider model or
a longer window. **What it does not buy:** an answer from a model that will not stop reasoning — at **6,000** output tokens
**19 of 24** prompts still ended `finish=length`, and 42 tok/s means 10,000 tokens costs **~4 min per call**, so a k=3
run over 8 items ≈ **2.5 h** of pure generation for a verifier that may still not finish.

**Candidate verifier models (a download grant is required for anything not already on disk; LM Studio currently holds only
flint `@q4_k_m`, `ministral-3-14b-reasoning` @q6_k/@q8_0, and `text-embedding-nomic-embed-text-v1.5`):**

| Candidate | Approx. on-disk size | Family vs the seats' `Qwen3.8-Flash-Next` (**D137**) | Reasoning control | Fit on one 3090 |
|---|---|---|---|---|
| `gpt-oss-20b` | ~13 GB (MXFP4) | **different family** ✓ | thinking is optional per request | comfortable — leaves room for a long window |
| `mistral-small-3.x-24b` | ~14 GB (Q4) | **different family** ✓ | non-reasoning by default | comfortable |
| `gemma-3-27b` | ~17 GB (Q4) | **different family** ✓ | thinking optional | fits at ~32k ctx |
| `qwen3-30b-a3b` / `qwen3-coder-30b-a3b` | ~18 GB (Q4) | **same family as the seats — a D137 violation** | best-in-class toggle | fits, and is the fastest option — **which is exactly why it is the trap** |
| flint **Q8_0** (already on disk, set aside) | 42.35 GB | ✓ | none (same problem as Q4) | **does not fit** — restore only if the operator wants Q6/Q8 back |
| `ministral-3-14b-reasoning @q6_k` — **measured 2026-10-29, rejected** | ~12.7 GB loaded | ✓ different family | answers **24/24** cells, 137–464 tokens, 4.5–15.7 s, **31.6 tok/s** | **0/16 clean controls**: commits `VERDICT: DEFECT` every time and invents the mechanism; reversing the contract's option order did not change it |

Sizes above are the vendor's usual quantization footprints, **not** measured on this box — verify with
`POST /api/v1/models/download` + `ls -la` before believing them, and note that `download` needs a **HuggingFace URL**, not a
model key. **Every candidate gets the k=1 gate run (~30 min) before adoption, and the run record must name the variant and
the measured decode (255 acceptance (5)) — plus a clean-control calibration check BEFORE its verdicts are ever routed on:
measured 2026-10-29, an answer-first contract turns a defect-prior model into a decisively wrong verdict 16/16 times, which is
worse than the vague hedging it replaced.**

**Three levers that need no download and no money — try these first (all are ROADMAP 258):** an **answer-first contract**
(`VERDICT: DEFECT|CLEAN` as line one, ≤3 lines of mechanism, justification last) so a truncated tail still scores;
**forced-choice scoring** (`--force-verdict`), which turns the verifier into a ~50-token classifier and makes **k=3 over the
whole corpus a minutes-long experiment** instead of a 50-minute one; and **running `llama-server` directly** instead of
through LM Studio, where `--chat-template`, `--reasoning-parser`, `--grammar` and `--temp 0` are reachable (the backend
binary is already on disk at `…/.lmstudio/extensions/backends/llama.cpp-linux-x86_64-nvidia-cuda12-avx2-2.65.1/llama-server`,
which is what proved the live `.gguf` in the section above). Also free: **cut the verifier's own window** —
`65,536 @ parallel 4` spends gigabytes of KV on the 3090; `32,768 @ parallel 1` returns it to weights, which is where decode
speed comes from.

## The numbers that decide the window (measured 2026-10-29, this box)

| Fact | Value | How it was read |
|---|---|---|
| Verifier seats, per the product's own `seatsAreVerifier` (`src/verifierrole.mjs`) | **5**: `qa`, `qa2`, `auditor`, `advocate`, `designer` | called the real predicate on `rig.selfdev.json` — `docs/SELFDEV.md` names only 3, which is stale: `advocate`/`designer` match on "review" in their **role** text |
| A verifier seat's prompt size | `qa` p50 **55,538** / p95 251,311 / max 356,355 · `auditor` p95 329,252 · `advocate` p50 **108,435** · `designer` p50 **66,258** · `qa2` p95 48,640 | `input + cacheRead` over **60,503** `pi.assistant` turns joined to seat via `cli.mjs status` conversationIds; **37,348** of them exceed 32,768 |
| ministral before this run | loaded at **8,192** while `DURIG_VERIFIER_CONTEXT` declared **13,273** | `GET /api/v1/models` vs `durig.config.json` — the rig was declaring a window the server never gave, and the model scored **0/2** on the seeded-bug gate (`D137`) |
| flint | `recursivesi/flint`, 40B, arch `flint`, `max_context_length` 262,144. Three variants on disk: **Q6_K 32.72 GB** — does **not** fit the 24 GB 3090 whole, which is why its decode is **9.8–10.75 tok/s** (4,000 tok in 372.0 s is the cleanest Q6 measurement); **Q8_0 42.35 GB**; **Q4_K_M 24.17 GB** — loads at 65,536 and decodes **42.21 tok/s** (1,500 tok in 35.5 s). Q6 loads at 65,536 in **18.3 s**; COLD prefill ~**212 tok/s** on Q6 (6,016 tok in 28.4 s); WARM TTFT **0.23 s** at 6,016 tok (prefix cache). Tree: `~/.var/app/ai.lmstudio.lm-studio/.lmstudio/models/lmstudio-community/` — `flint-GGUF/` (Q6/Q8) and `flint-gguf/` (Q4_K_M); **the Q6/Q8 files are set aside** at `…/.lmstudio/set-aside-flint-q6-q8/` since 2026-10-29T02:4xZ so `load` picks Q4 — restore is one `mv` | `GET /api/v1/models`, completions, `ps -eo args \| grep llama-server` (the only surface that prints **which `.gguf` is live**), and `tools/model-probes/cold-prefill.mjs` (its prefill/decode columns print `?` against LM Studio — it reads `timings`, which this server does not return — so the usable columns are TTFT and the machine line) |
| Unloading ministral | freed **~12.7 GB** on the 3090 (22,315 → 9,635 MiB); flint's engine process holds **26.4 GB RSS** | `nvidia-smi`, `ps --sort=-rss`, before/after the unload |
| The box, during all of it | 94 GB RAM, 26–27 GB available, **swap 7/7 GB full**, `strata-host` (the primary `iq3_s` provider) **51.3 GB RSS** | `free -g`, `ps` — the same "slow model vs out-of-RAM box look identical" warning `cold-prefill.mjs` prints |

**What that arithmetic means.** A context below ~55k guarantees compaction for `qa` and `advocate`; 65,536 is a
**floor**, not a comfort, and the durable fix is the prompt-size work (**ROADMAP 208**, the context-fraction
guard), not a bigger window. `DURIG_VERIFIER_MAX_TOKENS` was **32768** for a provider whose declared window was
13,273 — an output budget larger than the whole window; it is now **8192**, which leaves 57,344 tokens of prompt
room inside 65,536 and still clears the measured reasoning cost with room to spare (D136's reason for raising it
at all was the `finish_reason: length` + empty-answer truncation at 128–256 tokens; if that reappears, raise it
again and record it, don't guess).

## Downloading a quantization (measured 2026-10-29, and note the two gotchas)

`POST /api/v1/models/download` needs a **HuggingFace URL**, not a model key:
`{"model":"https://huggingface.co/lmstudio-community/flint-gguf"}` → `{"job_id":"job_…","status":"downloading",
"total_size_bytes":24166841184}`. Passing `lmstudio-community/flint-GGUF` returns
`Downloading community models as artifacts is not supported. Please use the HuggingFace model URL instead.` The
second gotcha: the **repo name's case differs from the local directory** (`flint-gguf` on the hub, `flint-GGUF` on
disk), and the download lands under the *lower-case* directory, so a `find` for the old path misses the arriving
file — it is written as `.lmstudio/models/…/flint-gguf/downloading_<file>.gguf.part`, and `GET /api/v1/models`
lists the model only once the rename finishes. `POST /api/v1/models/download/status` does **not** exist on this
build; poll the file, or `GET /api/v1/models` and check `loaded_instances`/the model appears.

## Do not

…call a model dead from `GET /api/v1/models` disagreement alone (the zombie above is the opposite failure: it
*looks* loaded); …trust an `HTTP 000`; …flip seats before the gate (`D137`); …edit `rig.selfdev.json` seat
**instruction** text by hand (operator-owned file — the model field is yours to change on the operator's
direction, the instructions are not); …do a JSON round-trip of `rig.selfdev.json` (it rewrites the whole file
and mojibake's the em-dashes in the seat instructions — patch the byte ranges, and check `git diff --stat` says
5 lines, not 374); …assume ministral is worthless because it is idle today (its decode is **~33 tok/s**, ~3×
flint — it lost on capability and on its 8,192 window, not on speed).

## Probe memory discipline — read this before you spend a prompt, and again when the desktop blames you

**Symptom:** the OS says *"The background service `run-p2756020-i2781901.scope` has been terminated by the Linux kernel
because the system is low on memory"* — or a seat goes silent mid-run, or `cli.mjs status` shows seats stuck.

**Do not assume this is an incident.** Two shapes look identical from the desktop and mean opposite things:

| unit name in the message | what it is | what to do |
|---|---|---|
| `run-<digits>-<digits>.scope` | a **capped arm we started** with `capped-run.mjs`; the cap did its job | nothing — report "the cap fired, the servers lived", with the peak line |
| `app-…appimage@…service`, or a `llama-server` / `strata` unit | a **model server died** | incident: §"the server was killed under memory pressure" below |

Prove which one it is before saying anything:

```bash
ps -eo pid,rss,etime,comm | grep -E 'strata|llama-server' | grep -v grep     # both alive? ELAPSED pre-dates the event?
journalctl --user -b --since "-30 min" --no-pager | grep -iE 'oom|memory peak' | tail   # which unit, what peak
journalctl -b --no-pager | grep -i "invoked oom-killer" | tail                        # host-level kill? who was the victim?
```

**What the host-level kill looked like on 2026-10-29 (the reason this section exists):**

```
kernel: esbuild invoked oom-killer: ... oom_score_adj=200 ...
kernel: Out of memory: Killed process 2289527 (strata-host) total-vm:132182136kB,
        anon-rss:53969596kB, file-rss:65056kB, shmem-rss:2016944kB, oom_score_adj:200
```

The victim was the **seats' server**; the allocating process was `esbuild`, a toolchain process. The kernel chooses the
**largest** process, so on this box an unbounded probe is a random number generator for which server dies.

**The footprint nobody printed** (measure it yourself, it changes with the pack):

```
pack IQ3_S = two GGUFs, 52 GB + 27 GB on disk          strata-host: 50.3 GiB RSS, of which 40.7 GiB is Pss_Shmem
GPU0 (A4000) 12,648 / 16,376 MiB   ← only ~12.6 GiB of that working set is on the card
GPU1 (3090)  23,019 / 24,576 MiB   ← the verifier instance; 94 % full, no room for a second engine
MemAvailable 25.5 GiB of 94.2      Swap: zram ONLY, 8 GiB total, ~78 % already used
```

So: **the seat server is a host-RAM hog, and the ceiling we hit first is zram, not RAM.** A verifier that "only needs
8 GiB" is not free — it is 8 GiB out of a headroom that was already 25 GiB with swap half-gone.

**The discipline, as instruments (this is the fix, not a suggestion):**

```bash
node tools/model-probes/probe-preflight.mjs          # GO / REFUSE + the numbers; exit 1 means do not start an arm
node tools/model-probes/capped-run.mjs --node-mem-max 6G -- <your probe command...>
```

`probe-preflight.mjs` prints MemAvailable, swap %, per-GPU free MiB, each resident server's RSS **and its shmem**, the
`--ctx-size`/`--parallel`/`--resident-experts` it was started with, and the rig's declared verifier ctx vs max-tokens.
It refuses at the floor named in **260** (< 10 GiB available, > 50 % swap, < 1 GiB free on the GPU a load would need).
`capped-run.mjs` runs the arm in its own scope and afterwards prints the scope's peak and whether the cap fired.

**Two measured facts about the cap, because the naive version is a placebo:**

1. **`MemorySwapMax` must be `0`.** With `MemoryMax=300M MemorySwapMax=1G`, a 600 MiB page-touched job **survived** —
   `MemoryMax` caps RAM only and the extra allowance is the box's swap, which is the scarce resource. Same job with
   `MemorySwapMax=0`: *"the CAP fired — the arm was killed inside its own scope"*, and afterwards `strata-host` was still
   resident at 52,739,964 kB and `llama-server` at 3,926,924 kB. That is the outcome you are buying.
2. **Allocating is not residing.** `Buffer.alloc` is zero-filled lazily, so 400 × 1 MiB of untouched buffers passed a
   300 MB cap untouched. Test a cap with `b.fill(1)` (or you will certify a guard that never fires).

**If preflight says REFUSE and you need the arm to run, the levers, cheapest first:**

- stop the verifier instance, or shrink its window (`--ctx-size 16384 --parallel 1` instead of a big parallel multi-slot);
- shrink the **seat** server's host-RAM appetite — `--max-context 131072` instead of 204800, drop `--resident-experts`,
  lower `--kv-resident` — **this changes seat output quality, so it is the operator's trade, not yours**;
- add real swap on disk (e.g. a 32 GB swap file) so a transient spike is absorbed instead of a server being executed;
- run only one generation arm at a time, and never a corpus build or `npm test` from the main checkout alongside one.

**Say which OS you measured on.** These numbers are Linux/Fedora on `Alex-Desktop-Win10`; `swappiness`, `min_free_kbytes`
and the semantics of a killed process differ on Windows, and `src/seatguard.mjs:122` registers both `bash` and
`powershell` for that reason.

### Who the OOM killer will actually pick, and the one knob that is ours to turn

Measured on this box, 2026-10-29 (`Linux/Fedora`):

```
cat /proc/2686804/oom_score_adj   # strata-host  -> 200
cat /proc/2687793/oom_score_adj   # llama-server -> 200
cat /proc/$$/oom_score_adj        # this shell, and every probe arm -> 200
```

Everything important runs at the **same** score, so the killer falls back to **size** — and on this box size means the seat
server. Two consequences, one we can act on and one we cannot:

- **Ours (unprivileged):** make the arm the cheaper victim. Raising a score is allowed to the owning user, and
  `capped-run.mjs` now does it inside the scope — the bootstrap writes its own `/proc/self/oom_score_adj` to **700** and
  execs the arm, which inherits it. Verified: inside the scope, `arm oom_score_adj = 700`. The naive `choom -p $$` form
  does not survive quoting (`choom: invalid PID argument: '$'`) — use the `/proc/self` write.
- **Not ours (needs `CAP_SYS_RESOURCE`):** protecting the servers. `choom -n -1000 -p <pid>` fails with
  *"failed to set score adjust value: Permission denied"*, and `systemd-run --user -p OOMScoreAdjust=-1000` fails with
  *"Unknown assignment"* (that key is not a scope property). If the operator wants the servers unkillable-by-accident, the
  way is to launch them from a context that can set it — e.g. a system-level unit with `OOMScoreAdjust=-1000`, or
  `sudo choom -n -1000 -p <pid>` after start — and `oom_score_adj_min` is what pins it once set. Ask; do not improvise a
  privileged change.

**And the swap is not the model servers.** Summing `VmSwap` across the processes visible to the user account accounts for
**5.74 GiB of the 6.2 GiB** in zram, while `strata-host` held **5,880 kB** and `llama-server` a few kB. The long-lived
desktop processes hold it: `librewolf` 355 MiB, `kwin_wayland` 349 MiB, `DiscoverNotifie` 274 MiB, `sunshine` 243 MiB,
`pi` 204 MiB, `Isolated Web Co` 199 MiB — several started **Oct 26**, i.e. three days of accumulation. So "close a few
long-lived desktop apps" is a real lever with numbers behind it, and it is the cheapest way to get the box back under the
pre-flight floor. Check it yourself:

```bash
grep -s VmSwap /proc/[0-9]*/status | awk -F'[:\t ]+' '$3>0{print $3, $1}' | sort -rn | head   # who is in swap
```
