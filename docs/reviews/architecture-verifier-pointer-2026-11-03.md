# The `verifier/` pointer: what to serve, what to declare, and how to bound a review (#5025)

**Status:** a decision with numbers. It builds nothing and edits **no** config file — capacity is the
operator's ruling (`docs/reviews/architecture-capacity-rulings-2026-11-03.md` carries that request).
**Every number below was measured in this session**, on this box, 2026-11-03, unless it is attributed to a
dated document. Axes are named: **MiB**, **tokens**, **bytes/token**, **USD**.

---

## 1. The state of the pointer, measured

| fact | value | how it was read (this session) |
| --- | --- | --- |
| Listener on `:47831` (the seats' server) | LISTEN, `MainThread` pid 4078 | `ss -ltnp` |
| Listener on `:1234` (the verifier's declared endpoint) | **none** | `ss -ltnp` shows only `:47831` |
| `curl http://127.0.0.1:1234/v1/models` | `http=000`, **curl exit 7** (connection refused) | `curl -s -m 5 -o … -w "%{http_code}"` |
| `curl http://127.0.0.1:47831/v1/models` | `200`, `id: iq3_s`, `label: Qwen3.8-Flash-Next IQ3_S`, `"gpus":[0,1]` | same |
| GPU0 RTX A4000 | **14,906 / 16,376 MiB** (free 1,470) | `nvidia-smi --query-gpu=…` |
| GPU1 RTX 3090 | **22,758 / 24,576 MiB** (free 1,818) | same (D196 read 22,848 a day earlier; both are the same story) |
| `node tools/model-probes/probe-preflight.mjs` | `GO`, but: `GPU0 … 91 % full`, `GPU1 … 92 % full`, "largest resident process is strata at 51.1 GiB RSS (41.2 GiB of it shmem) — that is what the OOM killer will pick" | exit 0 |
| The seat engine's own capacity | `strata --serve --pack …/iq3_s … **--max-context 204800** --kv int8 --resident-experts --kv-resident 32768 **--vram-reserve-mib 1536** --batch 2` | `ps -eo pid,args` |
| Declared verifier provider (gitignored `durig.config.json` in **my seat root**) | `DURIG_VERIFIER_BASE_URL: http://127.0.0.1:1234/v1`, `_MODEL: mistralai/ministral-3-14b-reasoning`, `_CONTEXT: 24576`, `_MAX_TOKENS: 3000` | read-only read of that file |
| Seat pointers (tracked) | **five** seats name `verifier/mistralai/ministral-3-14b-reasoning` — `rig.selfdev.json:50,65,95,139,153`; seven name `local/iq3_s` | `grep -n '"model"'` |

**Three lies, each with its measurement.**

1. **It names a model no provider serves.** The endpoint is not merely unhealthy, it does not exist on this box
   (curl exit 7). And when `:1234` *was* live, that very model was **rejected on capability**: it "answers 24/24
   cells … **0/16 clean controls**: commits `VERDICT: DEFECT` every time and invents the mechanism"
   (`docs/runbooks/verifier-model-server.md`, candidate table, measured 2026-10-29).
2. **It declares 24,576 tokens against a measured review need of 55,538 (p50, `qa`).** The distribution
   (`verifier-model-server.md`, 60,503 assistant turns): `qa` p50 55,538 / p95 251,311 / max 356,355;
   `advocate` p50 108,435; `designer` p50 66,258; `auditor` p95 329,252; `qa2` p95 48,640; **37,348 turns
   already exceed 32,768 tokens**. A 24,576 window with the documented verifier-class
   `reserveTokens 4096` (`src/config.mjs:366-367`) blocks at **20,480 tokens** — compaction is not a risk, it
   is the normal case, and D196 measured what a failed compaction does: `unanswered / model_error`, **zero
   tokens generated**, and one extra `pi.user` entry per attempt.
3. **It sets `MAX_TOKENS 3000` against reasoning-tagged candidates.** `docs/DECISIONS.md` D193(3) reproduced
   `finish_reason=length` with **empty content** at `max_tokens=24`, and the runbook's arm table shows
   `answerChars=0` at `max_tokens` 1,200 **and** 4,000 with 17,554 reasoning chars on a corpus-like prompt. A
   verifier whose verdict is truncated mid-thought is worse than no verifier (D137).

There is also a fourth, smaller failure mode that must be named because it hides all three: the pointer guard
is two-sided on purpose (`demo/local-model-pointer.test.mjs:70`) — if `DURIG_VERIFIER_BASE_URL` is **unset**,
`resolveSeatModel` (`src/seatmodel.mjs:19`) treats the whole `"verifier/x"` string as a model id under the
**default** provider, so a rig written to be cross-family runs single-family and still reads healthy. Today the
key is **set to a dead socket**, which fails differently: the provider registers, the seats resolve, and the
failure happens at the wire. Either way `check` does not currently see the pointer's *content* as a defect.

---

## 2. (a) What should be served, on which GPU, at what `--max-context`?

**Honest answer: nothing fits, so verification stays on the local seat (same-family, `check` red and labelled)
or moves to the metered provider under #5015's cap. It does not move onto a card.** The arithmetic:

**The card is not 91 % full by accident — the "free" MiB is strata's own reserve.** The seat engine is launched
with `--vram-reserve-mib 1536` and lives on **both** cards (`"gpus":[0,1]`, 51.1 GiB RSS, 41.2 GiB shmem). The
measured free space is 1,470 MiB (GPU0) and 1,818 MiB (GPU1). So the free figures are ~ the engine's declared
reserve, not spare room. The runbook states the operational consequence and I confirmed the inputs:
"Any plan that spends 'the free space on GPU1' is spending the local seats' model"
(`verifier-serving-headroom.md` §2).

**Weights, before any KV:** the smallest credible cross-family candidate in the survey is `gpt-oss-20b` at
**~13 GB** (MXFP4) and `mistral-small-3.x-24b` at ~14 GB (Q4)
(`verifier-model-server.md`, "Candidate verifier models" — vendor footprints, explicitly *not* measured on this
box). Against 1,818 MiB, that is not close. And `probe-preflight.mjs` already refuses a load that would leave
< 1 GiB on the target card (its floor, §"Probe memory discipline"), so this is a preflight REFUSE, not a judgement
call.

**KV alone, even for a deliberately tiny review:** the geometry method from
`verifier-serving-headroom.md` §3 (`bytes/token = n_layers × n_kv_heads × (dK+dV) × bytes/element`; measured
160 KiB/token for Ministral-3-14B Q6_K) gives, in **bytes**:

| window (tokens) | KV pool at 160 KiB/token | vs free on GPU1 (1,818 MiB) |
| --- | --- | --- |
| 24,576 (today's declaration) | **3,840 MiB (3.75 GiB)** — the runbook's measured row for this window was 3.60 GiB, so the method's constant is per-model geometry; same order | **2.1× over** |
| 55,538 (`qa`'s p50 review need) | **8,678 MiB (8.47 GiB)** | 4.8× over |
| 131,072 (the metered rows' published window) | **20,480 MiB (20.0 GiB)** | 11.3× over |

So **bounding the review to its measured need does not make a local verifier fit** — the KV of the need itself
is **8.5 GiB**. Bounding still matters (§4), but for wall-clock, money and compaction-churn, not for fitting a
card.

**What I therefore recommend, in order:**

1. **Do not load anything.** No GPU slot exists for a second engine without evicting the seat engine, which
   stops all twelve seats. That is the operator's trade, and the operator has already ruled the other way —
   "I prefer to use DeepInfra for verifiers rather than halt the system" (D193).
2. **Verification runs metered** (`verifier/` pointed at DeepInfra) **only after** #5015's cap/ledger lands,
   because a re-point before the cap is a metered provider with an invented `$0` cost row
   (`docs/reviews/architecture-spend-cap-2026-11-03.md` §2, probes P1–P3, P9 all RED today).
3. **Meanwhile, park the five `verifier/…` seats and leave `single-model-rig` red.** They are dead-on-arrival;
   waking them buys a `pi.user` entry and an errored assistant turn each time (the runbook's most expensive
   trap). A red `check` that names the cause beats a green one produced by pointing verifier seats at the
   author model.
4. **Rejected: "serve a small model on GPU0 at a tiny window".** It fails the weights test, not the KV test, and
   it would put both engines on one card whose measured occupancy is already 91 % — the same configuration
   under which the kernel executed `strata-host` in the 2026-10-29 OOM incident.

---

## 3. (b) What the declared window should be once verification is served

On the metered path the declared window is **not** a GPU property; it is (i) the provider row's published
`context_length`, and (ii) a **money statement**, because the declared window is what the compaction trigger and
the per-call projection are computed against. **Read this before using the table:** these rows come from the live
catalog. The `deepinfra` provider path reads only the **16-row curated fallback**
(`src/providers/deepinfra-models.ts:147`, via `cli.mjs:327`; `fetchDeepInfraModels()` is not wired into
`buildModels`), so **none of these ids resolve on that path today**. On the `verifier/` path the geometry comes
from the operator's `DURIG_VERIFIER_CONTEXT` / `DURIG_VERIFIER_MAX_TOKENS` declarations and cost is **forced to
zero** (`src/providers/local.mjs:159`) — which is exactly why the window here is a declaration rather than a
published number, and why D-5015.3 has to land before a re-point is honest. Measured from a dated catalog snapshot
(`.spike/5015/catalog-2026-11-03.json`, HTTP 200, public endpoint, no key):

| row | published `context_length` (tokens) | published `max_tokens` | $/Mtok in–out | worst single call (USD) |
| --- | --- | --- | --- | --- |
| `openai/gpt-oss-20b` | **131,072** | 131,072 | 0.030 / 0.14 | $0.0223 |
| `openai/gpt-oss-120b` | **131,072** | 131,072 | 0.037 / 0.17 | $0.0271 |
| `mistralai/Mistral-Small-3.2-24B-Instruct-2506` | 128,000 | 128,000 | 0.075 / 0.20 | $0.0352 |
| `deepseek-ai/DeepSeek-V4-Flash-0731` | 1,048,576 | 1,048,576 | 0.06 / 0.18 | $0.2517 |
| `zai-org/GLM-5.3-Flash` (shipped default) | 1,048,576 | 1,048,576 | 0.15 / 0.50 | $0.6816 |

**Decision (binding once the operator picks a row):**

- `DURIG_VERIFIER_CONTEXT` = **the row's published `context_length`, capped at 131,072**. Declare 131,072 for a
  `gpt-oss`-class row. **Never declare 1,048,576**: at the shipped default's price that makes one maximal prompt
  worth **$0.157**, i.e. **3.9 % of the operator's $4 pool in a single call**, and it moves the compaction
  trigger out to a point nothing can reach. A declared window is a budget statement, and this rig's pool is
  finite and dated.
- `DURIG_VERIFIER_MAX_TOKENS` = **8192**, never 3000. Grounding: D193(3)'s reproduced truncation, the runbook's
  `answerChars=0` arms, and `local.mjs:72-76`'s own measured failure mode ("truncated MID-THOUGHT … a confident
  half-verdict — the worst possible failure for a seat whose job is to say 'no'"). Note 8192 is also what
  D136 raised it to once already, and what made D199's compaction succeed on the seat side.
- The declared pair must be self-consistent: `prompt + maxTokens ≤ context`. The runbook records the rig having
  declared `DURIG_VERIFIER_CONTEXT 65536` against an 8,192-token server with `MAX_TOKENS 8192` — "a request that
  cannot be served" — and names the missing control as ROADMAP 259. That class is what a `check` rule should
  catch, not a human reviewer.
- **`DURIG_VERIFIER_API_KEY` is the variable the provider reads** (`src/providers/local.mjs:88`, and `:145-147`
  falls back to the literal `"local-placeholder"`, which against a metered host is a 401 that reads as a model
  failure). Setting only `DEEPINFRA_API_KEY` — which is what `cli.mjs config` advertises as `set` — does not
  make the verifier pay. This is #5015 D-5015.4, recorded there so it is fixed once.

**Sizing against the review need, stated honestly:** 131,072 covers `qa`'s p50 (55,538), `qa2`'s p95 (48,640)
and `designer`'s p50 (66,258) with headroom; it does **not** cover `qa`'s p95 (251,311), `advocate`'s p50
(108,435 → marginal) or `auditor`'s p95 (329,252). Therefore the window decision and the bounding policy in §4
are one decision, not two. Anyone who declares a window without the bounding policy has declared a compaction
schedule.

---

## 4. (c) How a verifier review gets bounded to fit its window

Bounded in **tokens**, proved by a **count**, and legible when it fails. Five controls, cheapest first; four of
them exist as measured practice in the runbooks and need no download and no money
(`verifier-model-server.md`, "Three levers that need no download and no money"; `verifier-serving-headroom.md` §5):

1. **Answer-first contract** in the brief: `VERDICT: DEFECT|CLEAN` as line one, ≤3 lines of mechanism,
   justification last. A truncated tail then still scores. (Measured caveat in the same runbook: an answer-first
   contract turns a defect-prior model into a decisively wrong verdict 16/16 times on clean controls — so it
   ships **with** clean-control calibration, never instead of it.)
2. **Forced-choice scoring** (`--force-verdict`): the verifier becomes a ~50-token classifier, which makes a
   k=3 pass over the corpus minutes instead of an hour. This is the single biggest wall-clock lever, and it is a
   *token* lever, so it also cuts metered cost.
3. **Bound the READING, name the byte and line size of every file in the brief, and put the cliff in the brief**
   ("489 lines — do NOT read it whole"). A correctly scoped two-file brief still died because one file was
   26,532 chars (`verifier-serving-headroom.md` §5). Cap the files, demand the verdict before the reading.
4. **The context-fraction guard** (ROADMAP 208) as an *edit-quality* control: the rig has published seats at
   **1.224** and **1.093** of their window (D150), i.e. over the window the provider will answer at all (the
   server returns **HTTP 400 at 207,219 prompt tokens**, measured, `docs/ROADMAP.md` ≈line 3312). This is a
   token-axis guard; it is not a money guard and must not be reported as one.
5. **A verdict is only a verdict if it completed.** A turn cut at `length` is **NOT-FINISHED**, never a finding
   (pm's ruling, `verifier-serving-headroom.md` "What this is NOT"), and every re-send of a failed brief adds a
   `pi.user` entry and moves the seat further from admissible (D196). So bounding is also *retry policy*:
   pre-flight the shape with `tools/seat-turn-shape.mjs` (1.1 s, read-only) before any `send`.

Prefix stability (from #5015 §4): if the brief is rebuilt with a different head each turn, the vendor's cache
price buys nothing — and for `gpt-oss-20b`/`-120b`/`Mistral-Small` the vendor publishes **no** cache price at all
(measured: no `cache_read_tokens` key). Quote cached runway only where the snapshot shows a cache price.

---

## 5. Sequencing, and the gate that must not be skipped

1. **#5015 cap/ledger lands** (its acceptance probe exits 0). Until then a re-point is an unbounded metered
   provider with a `$0` cost row.
2. **Re-point the provider** in the gitignored host config (`DURIG_VERIFIER_BASE_URL`, `_MODEL`, `_CONTEXT`,
   `_MAX_TOKENS`, and `DURIG_VERIFIER_API_KEY` **in the environment**) — the operator's capacity grant, not
   mine. Then close the loop with the two-sided pointer test: `node demo/local-model-pointer.test.mjs`,
   `node demo/second-local-provider.test.mjs`, `DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json`.
3. **Gate before flipping** — D137's standing rule, restated in the runbook as "Gate before flipping, always":
   one `gate.mjs --replicate 3 --pair-comments strip-both` arm at `CAL_MAX_TOKENS=8000`, under
   `DURIG_SPEND_CAP_RUN_USD=0.10`. D193's arm history says why the *clean* half of that verdict is only
   meaningful now that #5027's negation-aware scorer is landed (`84edff3c`), and D193(6)/(8) says a single
   clean-side number cannot promote a model. **Model choice is not this document's call**: the tables above
   price rows and name each row's exposure; they do not elect a verifier.
4. **Only then** wake the five `verifier/…` seats, one batched brief each, pre-flighted for shape.

## 6. What the pointer should look like while all this is pending

Not "unset" (that silently folds verifier seats into the default provider — the two-sided guard above) and not
"pointed at a dead socket" (today's state: registered provider, guaranteed wire failure, an errored assistant
turn per attempt). The least-lying pending state is **the seats parked with a named cause, the config left
untouched, and the red recorded** — which is what this row asks `pm`/`lead` to hold, and it is why
`docs/reviews/architecture-capacity-rulings-2026-11-03.md` exists.
