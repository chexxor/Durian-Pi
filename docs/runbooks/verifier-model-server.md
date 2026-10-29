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
a declared output budget the rig cannot receive. That mismatch is **ROADMAP 255**.

And the reasoning budget is not a knob on this model. `GET /api/v1/models` reports flint
`capabilities.reasoning: {allowed_options: ["on"], default: "on"}` — **there is no API switch to turn reasoning
off** — and two attempts to route around it changed nothing, both at `max_tokens: 1200` on a *20-line* file with
an explicit "answer in under 120 words" instruction (`.spike/gate/reasoning-lever-arms.out`, 2026-10-29):

| Arm | Result |
|---|---|
| baseline | 82.0 s, `finish=length`, completion **1200**, **answer 0 chars**, reasoning 3,814 chars |
| `chat_template_kwargs {thinking:false}` | accepted, ignored: 82.5 s, `finish=length`, **answer 0 chars**, reasoning 4,160 chars |
| `thinking:false` (top level) | 80.6 s, `finish=length`, **answer 0 chars**, reasoning 4,016 chars |
| `max_tokens 4000` (separate probe) | 372.0 s, `finish=length`, completion **4000**, **answer 0 chars**, reasoning **17,554 chars** |

**Read that before concluding `TRUNCATED-EMPTY` is a knob-tuning problem.** A model that never reaches its answer
inside the budget this hardware can deliver is not a verifier, however good its reasoning would be; the lever is
**decode speed** (a smaller quantization that fits the GPU, or a different model), not a bigger `max_tokens`.
`max_context_length` is not the constraint either: flint will load at 262,144 on paper and cannot be served there.

## The numbers that decide the window (measured 2026-10-29, this box)

| Fact | Value | How it was read |
|---|---|---|
| Verifier seats, per the product's own `seatsAreVerifier` (`src/verifierrole.mjs`) | **5**: `qa`, `qa2`, `auditor`, `advocate`, `designer` | called the real predicate on `rig.selfdev.json` — `docs/SELFDEV.md` names only 3, which is stale: `advocate`/`designer` match on "review" in their **role** text |
| A verifier seat's prompt size | `qa` p50 **55,538** / p95 251,311 / max 356,355 · `auditor` p95 329,252 · `advocate` p50 **108,435** · `designer` p50 **66,258** · `qa2` p95 48,640 | `input + cacheRead` over **60,503** `pi.assistant` turns joined to seat via `cli.mjs status` conversationIds; **37,348** of them exceed 32,768 |
| ministral before this run | loaded at **8,192** while `DURIG_VERIFIER_CONTEXT` declared **13,273** | `GET /api/v1/models` vs `durig.config.json` — the rig was declaring a window the server never gave, and the model scored **0/2** on the seeded-bug gate (`D137`) |
| flint | `recursivesi/flint`, 40B, arch `flint`, Q6_K **32.72 GB**, `max_context_length` 262,144; loads at 65,536 in **18.3 s**; decode **9.8–10.75 tok/s** (4,000 tokens in 372.0 s is the cleanest measurement); COLD prefill ~**212 tok/s** (6,016 tok in 28.4 s); WARM TTFT **0.23 s** at 6,016 tok (prefix cache). Only **Q6_K and Q8_0** are on disk here — `~/.var/app/ai.lmstudio.lm-studio/.lmstudio/models/lmstudio-community/flint-GGUF/` — and Q6_K does **not** fit the 24 GB 3090 whole, which is why decode is ~10 tok/s | `GET /api/v1/models`, a completion, and `tools/model-probes/cold-prefill.mjs` (its prefill/decode columns print `?` against LM Studio — it reads `timings`, which this server does not return — so the usable columns are TTFT and the machine line) |
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
