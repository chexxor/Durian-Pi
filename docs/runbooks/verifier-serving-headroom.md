---
runbook: verifier-serving-headroom
symptom: "a verifier turn dies at `stopReason=length` mid-review, or a provider answers a tiny probe but refuses a real request, or a seat's turn fails in ~30 ms with ZERO tokens generated, or you are about to spend GPU capacity on a model slot"
writes: false
precondition: "read-only"
last_verified: 2026-10-30
verified_by: delegate (Linux, box Alex-Desktop-Win10)
evidence: "measured 2026-10-30: 8192→16384→24576 on `mistralai/ministral-3-14b-reasoning`; the same 9,627-token probe HTTP 400 → HTTP 200; a 21,135-token completion in 19.1 s; `tools/seat-turn-shape.mjs` + `demo/seat-turn-shape.test.mjs`; D174"
check_rule: null
---

# Serving capacity for the verifier: cost it before you spend it, and check the SHAPE before the size

## When to use

A verifier-family seat (`qa`, `qa2`, `advocate`, `auditor`, `designer`) wakes and then dies — or never wakes.
Two different failures wear the same face, and the order below costs seconds, not sessions:

1. **The request is refused before the window is reached** — HTTP 500 in ~30 ms with **zero** tokens generated.
   This is the conversation **shape**, not its size. Do not raise context for this; nothing you raise will help.
2. **The request is accepted and then truncated** — `stopReason=length`, a seat reads two files and stops.
   That is capacity, and the arithmetic is below.

**The trap that cost four sessions:** the visible error mentioned context, so every session raised context. The
actual refusal was `Jinja Exception: After the optional system message, conversation roles must alternate user and
assistant roles except for tool calls and results.` (D174). **Check shape first.**

## Step 1 — shape, in two seconds, read-only

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
  **6 windows already carry a parity break, and 11 of 12 seats would be refused on the next `send`** — including the
  healthy-looking local ones.
- **`next send: AT RISK`** → do **not** send. The round trip costs minutes, returns `model_error` with no reply,
  and **appends another user entry**, so the poison grows monotonically. One seat measured 184 user turns, 193
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

## Step 2 — know which card you are spending (this was recorded backwards once)

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
- **Never re-send the same brief.** A failed `send` already appended a user turn; a second one compounds it and the
  seat gets further from admissible, not closer (Step 1).
- `parallel 1` means verifier-family seats **serialize** on one slot. If several wake at once they queue; that is a
  throughput ceiling, not a hang. Confirm with `ps` before reaching for a restart.

## What this is NOT

Raising the window does not repair the shape defect, and does not make a seat's review trustworthy — per pm's
ruling, a turn cut at `length` is **NOT-FINISHED, never a verdict**, and the oracle requirement attaches to
**claims, not seats**. Raising capacity is the **operator's spend**: measure the headroom, report it, and do not
spend it again unasked. Minting the row that fixes the shape is **pm's** verb; implementing it is a seat's.

## Related

`hygiene-and-dead-model-pointers.md` (a model swap that leaves seats pointing at nothing),
`compact-a-seat.md` (why a `compact` can complete and write nothing — same family, same provider),
`local-provider-down.md`, `degeneration-guard.md`, `workspace-move.md` (provider/OS migration residue),
`cross-clone-object-recovery.md` (before anything runs `git gc` near `refs/rescued`).
