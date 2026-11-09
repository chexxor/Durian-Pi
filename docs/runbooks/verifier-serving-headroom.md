---
runbook: verifier-serving-headroom
symptom: "a seat or verifier turn settles `unanswered` with reason `model_error`; a verifier turn dies at `stopReason=length` mid-review; a provider answers a tiny probe but refuses a real request; a seat's turn fails in ~30 ms with ZERO tokens generated; you are about to spend GPU capacity on a model slot"
writes: false
precondition: "read-only"
last_verified: 2026-11-05
verified_by: scribe (Linux, no box label per D205; seat root, item-4967 worktree at main `fca4e980`)
evidence: "Step 0 and Step 0b queries and the two-user-turn probe RUN on 2026-11-05 against `selfdev.sqlite` (read-only, `node:sqlite`) and `http://127.0.0.1:8080/v1` — submission 275488/277348/277352 read `Compaction failed: Summarization hit the token limit; the summary is incomplete`, 276042 reads the Jinja alternation 500, two consecutive `user` turns on the seat model returned HTTP 200 (`prompt_tokens: 88`). The 2026-10-30 GPU/LM Studio measurements (Step 2-4) are HISTORICAL, re-label below: 8192→16384→24576 on `mistralai/ministral-3-14b-reasoning`; the same 9,627-token probe HTTP 400 → HTTP 200; a 21,135-token completion in 19.1 s; `tools/seat-turn-shape.mjs` + `demo/seat-turn-shape.test.mjs`; D174"
check_rule: null
---

# Serving capacity: read the CAUSE first, then the size, and only then the shape

## When to use

A seat or verifier-family seat (`qa`, `qa2`, `advocate`, `auditor`, `designer`) wakes and then dies — or never wakes.
Three different failures wear the same face (`unanswered` + `model_error`), and the order below costs seconds, not
sessions:

1. **A compaction casualty** — the summarizer call itself ran out of room. This is the common one, and it is what
   killed the pm/impl/lead seats in the session that stalled. Read Step 0.
2. **A strict-template refusal on the VERIFIER engine** — HTTP 500 in ~30 ms with **zero** tokens generated, and the
   error text names conversation **shape**. Raising context does not help here; this is the only case where a shape
   read explains anything.
3. **Capacity on the verifier slot** — the request is accepted and then truncated at `stopReason=length`. That is
   capacity, and the arithmetic is in Step 3-5.

**The trap that cost four sessions, stated correctly:** the visible error mentioned context, so every session raised
context — and at least one session concluded the opposite trap, that the alternation refusal explained the dead seats.
Both were wrong for the seat model. The alternation refusal is real, but the engine that raises it is a strict-Jinja
**verifier** engine, not this rig's local seat model (measured below), and the three seats that actually died died in
**compaction**. **Read the `detail` field first.**

## Step 0 — read the cause: the `detail` field of the submission record

`status` (`unanswered`) and `reason` (`model_error`) are symptoms. The field that names the cause is **`detail`**, and
it lives **inside the `record` JSON column, not in a column of its own** — the `submissions` columns are
`id, conversation_id, request_id, status, record` (measured 2026-11-05 with
`select name from pragma_table_info('submissions')`). There is **no `sqlite3` CLI on this box**; `node:sqlite` is the
reader (`better-sqlite3` is ABSENT in this rig). Always pass an **absolute** store path: the opener CREATES a file on
read. Read-only open, so it cannot schedule anything:

```bash
node -e '
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("/home/chexxor/Git/Durian-Pi/selfdev.sqlite", { readOnly: true });
for (const r of db.prepare(
  "select id, status, json_extract(record, $pr) as reason, json_extract(record, $pd) as cause" +
  " from submissions where conversation_id = $c and status = $s order by id desc limit 2",
).all({ pr: "$.reason", pd: "$.detail", c: 9, s: "unanswered" }))
  console.log(r.id, r.status, r.reason, "|", String(r.cause ?? "").replace(/\s+/g, " ").slice(0, 140));
' ; echo "exit=$?"      # c: = the seat's conversation id — that is the ONE value to change
```

Register the query, not a paraphrase. `detail` is absent on many rows (a `reset`/`no_model` submission returned
`cause = ""` when this ran), which is itself a signal: only provider-side failures carry it.

What the measured reads say (2026-11-05, same store, ids are the citation):

| submission | conversation | `reason` | `detail` (verbatim, wrapped) |
| --- | --- | --- | --- |
| 275488 | 3 | `model_error` | `Compaction failed: Summarization hit the token limit; the summary is incomplete` |
| 277348 | 9 | `model_error` | same string |
| 277352 | 21 | `model_error` | same string |
| 276042 | 4936 (request `d181-auditor-4927b`) | `model_error` | `Engine protocol predict request returned 500: … Jinja Exception: After the optional system message, conversation roles must alternate user and assistant roles except for tool calls and results.` |

Three of the four are **compaction casualties**. Lead attributed 275488 / 277348 / 277352 to the pm, impl and lead
seats; the ids are the citation, the attribution is lead's.

**Why no instrument shows you this:** `computeAttention` emits `last_run_failed` with
`detail = "<reason>: <cause>"` (`src/attention.mjs:317-321` and `:462-468`), but its cause is `summarizeError` of the
latest provider-error **entry** (`src/readapi.mjs:405-412`) — and **no entry in conversations 3, 9 or 21 carries the
compaction text as an `errorMessage`** (measured: 0 rows match `"errorMessage":"Compaction failed%` in each). So
`check`/`status` reads bare `model_error` for exactly these deaths, and the verbatim cause is only in the submission
record. A missing cause in the notice is **not** evidence there was no cause.

## Step 0b — the compaction arithmetic that kills a seat

`Compaction failed: Summarization hit the token limit; the summary is incomplete` is raised by vendored pi-durable at
`vendor/pi-main/packages/durable/src/harness/compaction.ts:363` (`summaryFailure`) when the **summarizer request
itself** ends `stopReason === "length"`. The numbers for the seat model, measured 2026-11-05:

| quantity | value | where it comes from |
| --- | --- | --- |
| declared window | `DURIG_LOCAL_CONTEXT = 200000` | `durig.config.json:5` (identical in the live checkout and the seat root) |
| serving cap | `n_ctx = 204800` | `GET http://127.0.0.1:8080/v1/models` for `qwen3.8-flash-next-iq3_s` |
| summary output budget | `floor(0.8 × reserveTokens)` = **16,384** | `compaction.ts:149-152`, with `DURIG_COMPACTION_MODEL_OVERRIDES = {"local/qwen3.8-flash-next-iq3_s":{"reserveTokens":20480}}` |
| summarizer INPUT | the whole range `select` chose, i.e. near the whole context | `compaction.ts:163-166` |

So a seat carrying ≳188k input has ~16.8k of room left under 204,800 while the summary is asking for 16,384 — the
summary cannot finish, the string above is raised, and the run settles `unanswered`. **Any seat approaching its
declared ceiling dies this way**, and raising the declared window moves the cliff, it does not remove it:
`docs/DECISIONS.md:2933` sets mask-at-80 % / summarize-at-90 % of the **measured effective** window, not of nominal
`DURIG_LOCAL_CONTEXT`, and `src/attention.mjs:450-456` says that when no `DURIG_COMPACTION_*` value is set the gate is
pi-durable's default, which durig does not read (measured: only `DURIG_COMPACTION_MODEL_OVERRIDES` is set here).

**Unverified / not yet built:** what is missing is a cap that makes the summarizer request fit and a readable failure
when it does not. That is a separate, separately-owned change (architect ruling, then an implementation seat;
lead-registered). Lead's brief for this row also recorded a stopgap — `DURIG_LOCAL_CONTEXT` lowered to 160000 — as in
force; measured 2026-11-05 **both** configs read `200000`, so that stopgap is not in force at this tree. Do not record
a stopgap as the fix, and do not record one as in force without re-reading the config.

## Step 0c — the two engines are different machines; name them before you read anything

| identity | what it is today (measured 2026-11-05) | how to confirm |
| --- | --- | --- |
| **the seat model** | `DURIG_LOCAL_BASE_URL = http://127.0.0.1:8080/v1`, model `qwen3.8-flash-next-iq3_s`, `n_ctx 204800` | `curl -s http://127.0.0.1:8080/v1/models` |
| **the verifier engine** | `DURIG_VERIFIER_BASE_URL = https://api.deepinfra.com/v1/openai`, model `openai/gpt-oss-120b`, `DURIG_VERIFIER_CONTEXT 24576` | `grep -nE "DURIG_(LOCAL\|VERIFIER)_(BASE_URL\|MODEL\|CONTEXT)" durig.config.json` (check the live checkout **and** the seat root — if the two disagree, one lies) |

Conflating them is what produced the wrong rule. Measured 2026-11-05 against the **seat** model: a request carrying
TWO consecutive `user` turns returned **HTTP 200** (`prompt_tokens: 88`, `completion_tokens: 4`), so a strict
alternating template does **not** gate this model. Submission 276042's 500 came from a strict-Jinja engine on the
**verifier** path — with one honest limit: that record carries no `provider`/`model` field
(`json_extract(record,'$.provider')` is NULL for 276042, measured), and the string `Engine protocol predict request`
appears nowhere in this tree's `src/` or `vendor/pi-main/`, so the engine identity in that case is inferred from the
error text, not read from the record. Say so when you cite it.

**Decision rule.** If a seat's consumed value is over **0.9 of its declared window**, classify it as a COMPACTION
casualty and go to `detail`; only reach for a shape explanation when `detail` names alternation/protocol **and** the
engine named in it is the verifier.

## Step 1 — shape, a SECONDARY check: read Step 0 first, and never use this to explain a compaction casualty

```bash
node tools/seat-turn-shape.mjs                    # every seat; add --seat qa, --json, --strict, --explain qa
```

It reads the replay window the NEXT provider call is built from, through durian-pi's own mirror of pi-durable's
replay (`replayView`, `isHeadMarker` in `src/compacteval.mjs`) over `storage.scanEntries` — the same primitive
`cli.mjs log` uses, so it cannot measure a second interpretation. It writes nothing and opens no harness, so it
cannot resume scheduling (D11). Read the header for the predicate's blind spot. What to look for:

- **`alternation: N parity break(s)`** → a strict alternating template refuses this turn before any window is
  reached. **FINDING, not verdict**: this rig's local model (`iq3_s`) accepts these shapes, which is exactly how the
  residue went unnoticed for four sessions. The predicate is the template's own, not a guess — the counted projection
  is **every `user` plus every `assistant` that carries NO tool calls**, and that projection must alternate from
  index 0 as `user, assistant, user, …`. So **a tool-calling assistant does not satisfy the alternation**, and a
  resume after a tool-calling turn puts the next `send` in the wrong slot. Measured on 2026-10-30 across 12 seats:
  **6 windows already carry a parity break** — that counts the PREDICATE, not refusals. An earlier arm of this row
  read "11 of 12 seats would be refused on the next `send`", and that inference was **wrong**: the predicate predicts
  what a strict alternating template does, and this rig's seat model is not one (measured 2026-11-05: two consecutive
  `user` turns → HTTP 200, `prompt_tokens: 88`). Use a parity break to ask *which engine served the request*, never
  to explain a dead seat.
- **`next send: AT RISK`** → the risk is a refusal **only on an engine with a strict alternating template** (the
  verifier class, Step 0c); on this rig's seat model it is not a prediction of refusal. Where a refusal does happen,
  **do not retry it**: the round trip costs minutes, returns `model_error` with no reply, and **appends another user
  entry**, so the residue grows monotonically. One seat measured 184 user turns, 193
  errored assistant turns, and **1** assistant turn carrying any text; after one more attempt at an ample window it
  had picked up 4 more errored turns. This is the single most expensive trap in the rig: each attempt looks like a
  retry and is actually a deposit.
- **`empty-content assistants with no tool calls: N`** → what a `stopReason=length` or an errored turn leaves
  behind. It counts as an assistant in the projection (so it can satisfy alternation) and is reported separately
  because some templates refuse it anyway.
- **`counted projection`** is printed on purpose: it is short, and reading it is how you tell a real structural
  problem from an artifact of a long history.
- **`head marker pi.reset@…`** → a reset **hides** the residue from the window. It does not remove it, and it is
  why a reset appeared to "fix" the alternation.

The residue is mostly **migration/provider** detritus, not this rig's doing: 180 of one seat's errors read
`402: You need positive balance to do inference` — the verifier used to be a paid cloud provider, those turns were
never answered, and the store came over in the Windows→Linux move without the answers (see `workspace-move.md`).

## Step 2 — know which card you are spending (HISTORICAL: measured 2026-10-30, when the verifier was a LOCAL LM Studio slot)

The verifier is a **hosted** endpoint at the time of writing (Step 0c), so the GPU table below does not describe the
present configuration. It is kept because the KV arithmetic in Step 3 is what you need the moment the verifier is
hosted locally again, and because it was recorded backwards once — re-measure before acting on it.

```bash
nvidia-smi --query-gpu=index,name,memory.used,memory.total --format=csv,noheader
ps -eo pid,args | grep -E "llama-server|strata" | grep -v grep
```

Measured on this box, 2026-10-30:

| card | what lives there | measured |
| --- | --- | --- |
| **GPU0 — RTX A4000, 16,376 MiB** | the **LM Studio verifier** model | 13,914 MiB at ctx 16384; 15,202 MiB at ctx 24576 |
| **GPU1 — RTX 3090, 24,576 MiB** | the **local** model, and it is **not LM Studio**: `strata --serve --pack …/iq3_s … --max-context 204800 --kv int8` (`/v1/models` reports `"gpus":[1]`) | ~22.8 GiB |

**Any plan that spends "the free space on GPU1" is spending the local seats' model.** Unloading the verifier
dropped GPU0 from 12,648 MiB to 59 MiB — that is how you confirm which card a model owns, and it is the only
confirmation that counts.

## Step 3 — cost the window before you load it

Read the KV geometry out of the model file itself (`.spike/gguf-arch.mjs` in this rig's scratch is the reader;
**LM Studio's GGUF stores each KV value's type as a 4-byte field** — a 1-byte reader desyncs by 3 bytes and
reports nonsense):

```
bytes/token = n_layers × n_kv_heads × (head_dim_K + head_dim_V) × bytes_per_element
Ministral-3-14B-Reasoning Q6_K: 40 × 8 × (128 + 128) × 2 B (f16 KV) = 160 KiB/token
```

| ctx × parallel | KV pool | fits GPU0? |
| --- | --- | --- |
| 8192 × 4 (what LM Studio defaulted to) | 5.00 GiB | yes, and it looked "bigger" than it was useful |
| 16384 × 1 | **2.50 GiB** | yes — the raise *shrank* the pool |
| 24576 × 1 | 3.60 GiB | yes, at 15,202/16,376 MiB measured |
| 16384 × 4 | 10.00 GiB | no |

Then ask the vendor's own guardrail before spending it — it never loads, so it is free:

```bash
HOME=<dir containing .lmstudio> lms load <model> -c 24576 --parallel 1 --gpu max --estimate-only
```

LM Studio's estimate is usable but **runs ~0.35 GiB low** against what actually loaded (it said 14.39 GiB at 24576;
measured 15,202 MiB ≈ 14.85 GiB). Budget against the measured number, and keep ≥1 GiB of card free.

## Step 4 — change it through the vendor's own tool, then verify three ways

LM Studio's app REST surface on `:1234` exposes only `GET /api/v0/models` on this build — `POST`, `PATCH`, `PUT` and
`DELETE` on `/api/v0/models/<id>` all answer `Unexpected endpoint or method`, and no other route updates a slot. Use
the CLI that ships in the package (`<.lmstudio>/bin/lms`); if the host's `$HOME` has no `.lmstudio` (flatpak installs),
point `HOME` at a directory containing a symlink to the real one.

```bash
lms unload --all            # or: lms unload <model>
lms load mistralai/ministral-3-14b-reasoning -c 24576 --parallel 1 --gpu max -y
```

Capture the pre-change server command line first (`ps -eo pid,args` → save to `.spike/<session>/`), so the slot is
restorable. Verify with **three independent instruments**, never the CLI's success line alone:

```bash
curl -s http://127.0.0.1:1234/api/v0/models | grep -o '"loaded_context_length":[0-9]*'   # 1. the API
ps -eo args | tr '\0' ' ' | grep -o -- "--ctx-size [0-9]*"                                # 2. the real server
# 3. a request at the size that actually failed — not a 26-token probe:
node -e 'fetch("http://127.0.0.1:1234/v1/chat/completions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({model:"mistralai/ministral-3-14b-reasoning",messages:[{role:"user",content:"x ".repeat(21000)+"Reply OK"}],max_tokens:8})}).then(r=>r.json()).then(t=>console.log(t.usage, t.choices?.[0]?.finish_reason))'
```

**A 26-token probe is not evidence a provider is healthy.** And then pin the rig's declared window, in both places
(gitignored host config in the live checkout **and** the seat root, or the two disagree and one lies):

```bash
grep -n DURIG_VERIFIER_CONTEXT durig.config.json /home/chexxor/Git/durian-dev/seatroot/durig.config.json
```

**LM Studio forgets.** An app relaunch restored the slot to `--ctx-size 8192 --parallel 4` once this session; after
any LM Studio restart, re-run the three-way check before trusting a seat's failure as its own.

## Step 5 — size the brief to the window (this is where wall-clock goes)

Measured costs on this box: a verifier completion at **21,135 input tokens = 19.1 s**; a local-model seat turn on a
**162k-token context = 12–15 minutes**. Therefore:

- **One brief per seat per session, batched.** Every `send` is a round trip and every round trip is the number above.
  One batched findings brief to `pm` minted **8 queue rows in a single round trip**; the same content sent as three
  briefs would have cost three turns and left two of them unread.
- **Name the claims, cap the files, demand the verdict before the reading.** A "review all five files" brief
  overflowed at `in=14184` and the seat never stated a verdict. A scoped brief ("read only these two files; state
  PROCEED / REFUSE / NOT-FINISHED / OUT-OF-SCOPE-NEEDS-RUNTIME-PROOF before you run out of room") fits.
- **Cap the READING, not just the claims — and put the cliff in the brief.** A correctly scoped two-file brief still
  died on 2026-10-30 because one of the files is 26,532 chars: reading it whole pushed the request to `input=20,109`,
  which tripped a threshold compaction (`compact-a-seat.md`), and the next turn returned `output=1,
  stopReason=length` empty. So name the byte and line size of every file you point a seat at, and bound the read
  ("489 lines — do NOT read it whole; read the import block and the region where the set is defined"). A seat told
  *what* to read but not *how much* will read the big one and lose the turn.
- **Never re-send the same brief.** A failed `send` already appended a user turn; a second one compounds it and the
  seat gets further from admissible, not closer (Step 1).
- `parallel 1` means verifier-family seats **serialize** on one slot. If several wake at once they queue; that is a
  throughput ceiling, not a hang. Confirm with `ps` before reaching for a restart.

## What this is NOT

Raising the window does not repair the shape defect, and does not make a seat's review trustworthy — per pm's
ruling, a turn cut at `length` is **NOT-FINISHED, never a verdict**, and the oracle requirement attaches to
**claims, not seats**. Raising capacity is the **operator's spend**: measure the headroom, report it, and do not
spend it again unasked. Minting the row that fixes the shape is **pm's** verb; implementing it is a seat's.

## Verify

Run from the **live checkout** (`/home/chexxor/Git/Durian-Pi`) — `durig.config.json` and `selfdev.sqlite` are
host files and do NOT resolve inside an item worktree, so a grep or a store read there silently finds nothing:

```bash
node demo/seat-turn-shape.test.mjs                     # exit 0 = the predicate Step 1 describes still holds
# then run the Step 0 fenced block VERBATIM (change only `c:` to a seat's conversation id) — expect exit 0 and rows
node -e 'const c=require("./durig.config.json");for(const k of Object.keys(c))if(/DURIG_(LOCAL|VERIFIER)_(BASE_URL|MODEL|CONTEXT)/.test(k))console.log(k,"=",c[k])'
curl -s -m 5 http://127.0.0.1:8080/v1/models | head -c 200      # the seat model's real n_ctx
```

Last run 2026-11-05 (scribe, item-4967 worktree fast-forwarded to main `fca4e980`): the Step 0 recipe ran **verbatim
out of this file** — exit **0**, conversations 9 and 21 each printed two rows (`reset`, `no_model`, `detail` absent on
those); `demo/seat-turn-shape.test.mjs` exit **0** with an `ENVIRONMENTAL` skip for the live-store leg (no store
resolves in a worktree; pass `DURIG_DB=<absolute path>` to exercise it); the two-consecutive-`user`-turn probe against
`http://127.0.0.1:8080/v1/chat/completions` returned HTTP 200 with `prompt_tokens: 88`; and the four submission ids
in Step 0 read the causes quoted there.

## Related

`hygiene-and-dead-model-pointers.md` (a model swap that leaves seats pointing at nothing),
`context-over-window.md` (the `context_over_window` notice: a turn that moved more tokens than the seat's window),
`compact-a-seat.md` (why a `compact` can complete and write nothing — same family, same provider),
`local-provider-down.md`, `degeneration-guard.md`, `workspace-move.md` (provider/OS migration residue),
`cross-clone-object-recovery.md` (before anything runs `git gc` near `refs/rescued`).
