# Delegate notes — 2026-10-29 (part 3): the verifier's "endless thinking" is mostly a **host configuration fault**, ministral measured and rejected, and I OOM-killed the seats' server

Host: `Alex-Desktop-Win10`, Linux (Fedora), Node v24.22.1, two GPUs (GPU0 RTX A4000 16,376 MiB, GPU1 RTX 3090 24,576 MiB),
94 GiB RAM, **8 GiB zram swap**. Every number below names the model **variant** and the measured decode, per ROADMAP 255
acceptance (5).

## 1. What I broke first: my probe arms contributed to an OOM that killed the seats' server

I ran several probe arms back-to-back against a **65,536-context** flint Q4_K_M instance (≈19 GiB resident on GPU1) while
`strata-host` held ≈12.6 GiB on GPU0, and I ran `buildCorpus()` (which spawns a parse-check per candidate window) alongside
them. The kernel OOM-terminated `…/Strata-0.2.6-linux-x86_64.appimage@…` — i.e. **the seats' model server**, not my probe.
Swap was already 7/8 GiB used before I started and stayed at **8 GiB / 8 GiB, 0 free**; that is the box's real ceiling and I
did not measure it between arms. The operator restarted Strata (new PIDs, engine `0.1.50-linux-x86_64-cuda-cuda13`,
12,626 MiB on GPU0) and swapped the verifier model. **Rule I now hold to, and which belongs in the runbook:** before every
probe arm print `free -g` available + `swapon --show` + `nvidia-smi --query-gpu=memory.used,memory.total`; abort if
available < 10 GiB or swap is >50 % used; one arm at a time; never run a corpus build concurrently with a generation arm;
and keep **at most one** large-context engine resident.

## 2. The finding that re-frames the whole verifier problem: LM Studio injects an *unbounded* thinking instruction when the caller omits a system message

`llama-server` is launched with `--jinja --chat-template-file /home/chexxor/.lmstudio/.internal/temp/lmstudio-chat-template-*/chat-template.jinja`
(the flatpak path is `/home/chexxor/.var/app/ai.lmstudio.lm-studio/.lmstudio/.internal/temp/…` — the cmdline lies, as already
noted in this runbook). Line 1–2 of that template:

> `{#- Default system message if no system prompt is passed. -}`
> `# HOW YOU SHOULD THINK AND ANSWER — First draft your thinking process (inner monologue) **until you arrive at a response** …
> Your thinking process must follow the template below: `[THINK]` Your thoughts or/and draft … **Be as casual and as long as you
> want** until you are confident to generate the response … `[/THINK]` Here, provide a self-contained response.`

Line 9 is `{%- if messages[0]['role'] == 'system' %}`, so it applies **only when the request carries no system message**. Matched
pair on `mistralai/ministral-3-14b-reasoning` **Q6_K**, same 1-line task, `temperature 0`:

| arm | max_tokens | wall | finish | completion | `content` | `reasoning` |
|---|---|---|---|---|---|---|
| A — no system message (host default fires) | 400 | 12.2 s | `length` | 400 | **0 ch** | 1,644 ch |
| B — system: *"Answer directly. Keep any internal reasoning under 80 words. State your verdict first…"* | 400 | **1.9 s** | `stop` | **62** | **283 ch** | 0 ch |
| C — same system message | 1,200 | 1.8 s | `stop` | **62** | 283 ch | 0 ch |
| D — **no** system message, budget 600, **body retained**: `.spike/gate/ministral-probe.json` | 600 | — | `length` | 600 (`reasoning_tokens` **599**) | **0 ch** | 2,404 ch |

Arm D is the one whose body is on disk, so the finding is re-checkable rather than session-bound; its reasoning text says
*"typing out all 200 numbers manually would be tedious, but since this is a thought process simulation, I'll represent it as
such"* — the model spends the whole budget on the monologue and then abstains, which is the same shape as flint's truncated
cells. B's answer was correct (*"Verdict: No runtime defect on Linux… syntactically correct…"*). **C proves the budget was irrelevant**
— it stopped at 62 tokens both times. So the thing I had been calling "the model thinks too much" is, for requests without a
system message, **this host instructing the model to think without bound**. Four request-level levers do nothing about it:
`chat_template_kwargs {thinking:false}`, top-level `thinking:false`, `reasoning_effort:low`, and
`chat_template_kwargs {reasoning_enabled:false}` — all four returned `content=0ch` at 400 tokens.

`gate.mjs` **does** send a system message (`"You are reviewing a module for defects."`), so the 2026-10-29 flint numbers are not
explained by this; but the same unbounded-thinking shape is what a *future* one-shot verifier helper would trip over, and the
gate's own system message bounds nothing. **Register:** every durig-side completion call must carry a system message, and a
probe should assert that it did.

## 3. Correcting my own conclusion from part 1/2 of today: `flint`'s "4/4 false alarms" was mostly our instrument

Three of the four clean-side FALSE-ALARMs in the completed flint Q4 run are **true statements about the excerpt the window
showed**. Verified against the real files:

- H1 clean claimed `readFileSync`/`join`/`existsSync` were not imported → they are, at `src/worktree.mjs:11,13` (`git show 3bff94a:src/worktree.mjs`).
- H2 clean-neutral claimed `isWindows` is undefined → declared at `src/job-object.mjs:30`.
- H5 clean-neutral claimed `resolve`/`existsSync`/`readdirSync`/`readFileSync`/`execFileSync` are not imported → all at `scripts/clockin.mjs:27-29` (`git show b4c86ea:scripts/clockin.mjs`).

`corpus.mjs:250` already says *"a fragment control manufactures its own false alarms: windowing strips the import block and the
sibling declarations"*, and `gate.mjs` excuses an artifact turn **only when the model makes no code-level claim at all** — so a
true claim about my excerpt was scored as a judgement failure. The fourth alarm (M2 clean-neutral, 787 tokens) said
**"No — there's no defect that would make this code fail at runtime on Linux"** and was still counted FALSE-ALARM because it
volunteered a wrong *semantic* aside. So the honest restatement of yesterday's headline: **flint's real defect side is
1 HIT / 1 scorable, its clean side has at most 1 genuine judgement failure, and the dominant failure is non-termination.**

## 4. What the non-termination actually looks like: a runaway loop, not deep thought

`.spike/gate/repetition-audit.mjs` (free — re-reads the transcript artifact):

| group | n | mean 4-gram repetition | example duplicate evidence |
|---|---|---|---|
| cells that answered | 5 | **0.13** | `dupLines=0/31`, `dupLines=0/42`, max completion 5,275 |
| cells that hit the ceiling | 19 | **0.27** | `34x "Maybe the defect is that the regex is missing the g flag"`, `314 duplicate sentences`, `72x "```"`, `168/402 duplicate lines` |

All five answered cells finished in **787–5,275 tokens**; all nineteen truncated cells stopped at exactly 6,000. A sample
mid-reasoning passage is the model arguing with itself about whether `arr[0]?.slice` is legal JavaScript — task-irrelevant
syntax uncertainty. **This is why "just raise the budget" is the wrong lever**: past ~5k tokens you are buying more of the same
loop. The probe family has no repetition detector, even though the rig has one for seats (`src/degeneration.mjs`).

## 5. Ministral Q6_K, measured properly, and rejected — it answers, and it commits wrongly every time

Operator loaded `mistralai/ministral-3-14b-reasoning` **Q6_K** (`--ctx-size 8192 --parallel 4 --n-gpu-layers 999999
--flash-attn on --jinja`), 23.0/24.5 GiB on GPU1. Decode **31.6 tok/s** (600 tok / 19.0 s). I corrected
`durig.config.json`, which was pointing at `recursivesi/flint` (now unloaded — any request would have made LM Studio
re-offload a 24 GiB model onto a nearly-full card) and claimed `CONTEXT 65536` against a server offering **8192**, with
`MAX_TOKENS 8192` (an unsatisfiable request: prompt + 8,192 output > 8,192 total). Now: model `mistralai/ministral-3-14b-reasoning`,
context `8192`, max tokens `3000`.

Gate arm (spike copy: fragment + **declaration header** + answer-first contract), `CAL_MAX_TOKENS=3000`, k=1:

- **24/24 cells answered.** `finish=stop`, 137–464 completion tokens, **4.5–15.7 s** per cell. **Zero truncations.**
- **Committed verdict (line 1 of the contract): defect prompts 8/8 correct; clean controls 0/16.** It said `VERDICT: DEFECT`
  for every single control.
- Mechanism credit as scored by the runner: **HIT 2, MISS 6** of 8.
- Control: reversed the contract's option order (`VERDICT: CLEAN or VERDICT: DEFECT`) → still DEFECT on every control
  (clean 0/8 wrong-vs-right, defect 4/4 right). So the prior is real, **not** a wording artifact. (That arm recorded 12 cells;
  the runner's own NOTE 198 also prints at k=1: *"every verdict below is a SAMPLE — use --replicate 3 before any number here
  informs a routing decision."*)
- The alarms are **confabulation, not excerpt artifacts**: `process.kill(pid,0)` supposedly fails for kernel threads and
  zombies; `new Date().toISOString()` supposedly emits non-UTC strings "if the clock is unsynced" (it cannot — it always ends
  with `Z`). The declaration header had already restored the imports, so this is the model, matching D137's 2026-10-27
  observation of invented, confident, wrong mechanisms.

**Consequence, stated for routing:** an answer-first contract is *not* a free win. For a model with a defect prior it converts
hedging into a **decisive wrong verdict 16/16 times**, which is worse than vague hedging — it would deny or claim-block nearly
every clean completion. So the acceptance in 258 must be gated: a candidate's verdicts are usable only after it passes a small
set of clean controls, and the contract arm must be run **with** those controls, not instead of them.

## 6. The two candidates are failures in opposite directions

| | flint Q4_K_M | ministral-3-14b-reasoning Q6_K |
|---|---|---|
| answers within budget | **5/24** (19 truncated) | **24/24** (max 464 tokens) |
| clean-control judgement | ≥3 of 4 alarms were excerpt artifacts; real failures ≤1 | **0/16 correct** (16/16 committed DEFECT) |
| defect prompts | 1 scorable cell = HIT with the correct mechanism | HIT 2/8 |
| failure mode | non-terminating reasoning (repetition 0.27 vs 0.13) | calibrated the wrong way: always finds a defect, invents the mechanism |
| decode | 42.2 tok/s isolated; 21.8–48.9 in-run | 31.6 tok/s |

Neither satisfies ROADMAP 253 today. The cheap remaining local lever is a **re-run of flint under corrected conditions** —
bounded system message in the gate's own `SYSTEM` constant (never varied so far), declaration header or whole-module feeding
(whole modules here are **1,686–22,014 est. tokens**, so `--whole-module` needs ctx ≥ 24k with `--parallel 1`; my earlier
statement that H4 was "58,380 est. tokens" was a misread of the pair-accounting **chars** column), and artifact-aware scoring.

## 7. Executed from the operator's grants, and what is still owed

**GRANT 3 executed and verified**: minted `refs/rescued/orphan-<sha>` for all **452** unreachable commits; `refs/rescued`
32 → **484**; `git fsck --unreachable | grep -c '^unreachable commit'` now **0**. Sample resolutions:
`orphan-0030993f5abe` "merge: land devtools-item-4436 onto main", `orphan-009320f1f5df` "C-1 work-item read surface",
`orphan-0102f3c23b1c` "seatguard: refuse silent write corruption (#673)". Nothing deleted; every ref is one `update-ref -d`
from removal. **GRANT 5** partially executed (ministral measured; Q4_K_M decision overtaken by the operator's unload).
Still owed by the operator: **which verifier** now that both local candidates are measured and rejected — remote cross-family
key (the only thing satisfying 253 today), or fund the corrected flint re-run, or accept `single-model-rig` staying red.
Still owed by the team: 217, 232, 233, 254, 257, 258, 259.

## 7. The config lesson I paid for: a model swap touches TWO surfaces, and only a test catches the gap

I corrected `durig.config.json` and reported the verifier as switched. That was wrong: `rig.selfdev.json` still named
`verifier/recursivesi/flint` on all five verifier seats, so the next verifier request would have named a model with **no loaded
instance** — and `cli.mjs check` did **not** see the disagreement (`single-model-rig` passed, because it is an exact-string test
between providers, not a consistency test between the two surfaces). `demo/local-model-pointer.test.mjs` is the instrument that
does see it, and it was **RED** until both surfaces agreed. Evidence, in order:

```
node demo/local-model-pointer.test.mjs
  AssertionError: seat "qa" points at verifier/recursivesi/flint, but the "verifier" provider exposes only
  "mistralai/ministral-3-14b-reasoning" — the rig file and the machine config disagree
# after the five `"model"` strings in rig.selfdev.json were repointed:
  LOCAL MODEL POINTER PASS (providers=local=iq3_s, verifier=mistralai/ministral-3-14b-reasoning, pinned seats=12)
  SECOND-LOCAL-PROVIDER TEST PASS
```

The resolution rule is in `src/seatmodel.mjs:19` (first `/`, and only if the leading segment is a registered provider), which is
why `verifier/mistralai/ministral-3-14b-reasoning` is a legal seat string even though the model id has its own slash. **Shortcut
for the next session:** after *any* model change, run the pointer test before believing the switch happened — it costs seconds and
it is the only instrument in the tree that compares the two surfaces.

**What is still not safe:** `DURIG_VERIFIER_CONTEXT 8192` is honest about the served window, but real verifier prompts measured
in this store run p50 **55,538** (`qa`) / **108,435** (`advocate`) tokens. So this configuration can run *probes*; it cannot run
the *seat*. Starting the team on it would put every verifier item into a conversation the server refuses or truncates. **208** is
the item that fixes that; until then a started team needs the verifier seats off, or the window raised.
