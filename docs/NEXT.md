## NEXT SESSION (2026-11-02T09:30Z — D190 addendum, Linux: the operator directed **"attempt to fix the substrate"**; dispatched, and the measured answer is *yes, that is a problem* — the gate blocks it)

**Current item:** the substrate order, ahead of the broker. Reason, measured: `tools/what-to-test.mjs --no-scan
--paths=src/rig.mjs,rig.selfdev.json,src/providers/deepinfra-models.ts` derives **93 guards**, and that set contains
**three red demos** — `demo/broker-serve-shell-availability.test.mjs` (#4995), `demo/deepinfra-catalog.test.mjs`
(**unregistered**, §0a), `demo/local-model-pointer.test.mjs` (#4996). With `main` red-at-HEAD, **the team cannot land its own
substrate fixes**, so #4995 + the catalog guard + #4997 (no known-red baseline) are keystones, not comfort rows. Second
item: the operator's **DeepInfra backup verifier** (§7) — cheap in dollars (~$0.003–$0.005 per verify turn) and currently
unsafe in the substrate.
**Next command:** `node cli.mjs log lead 12` — read the turn answering
`.spike/delegate-20261102/lead-substrate-order-and-correction.md` (sent 09:25Z, out at
`.spike/delegate-20261102/send-lead-substrate.out`): it asks `lead` to correct #4982's body, mint ONE catalog-guard row,
release #5007, and close pm's #5008 question with the wake-gate measurement.
**Blocker:** three red-at-HEAD demos sit inside the derived landing gate for exactly the paths this work must touch; and a
paid verifier needs `DEEPINFRA_API_KEY` in the **environment** (never in `durig.config.json` — `src/config.mjs:31,106`
documents a key that once leaked there) plus a spend cap and cost ledger **that do not exist in the code** (§7).

### 0a. A claim the delegate got wrong, and where it spread — read this before reusing tonight's red set

`demo/deepinfra-catalog.test.mjs` is **not** red because `DEEPINFRA_API_KEY` is unset. Measured, keyless:
`AssertionError … seat "qa" names verifier/mistralai/ministral-3-14b-reasoning, which is not in the fallback catalog — it
would resolve to no_model` at `demo/deepinfra-catalog.test.mjs:82`. Its `resolvable()` helper exempts the `local/` provider
prefix ("a separately registered provider, not this catalog") but has **no exemption for `verifier/`**, so the guard is red
for any value and therefore protects nothing — the silencer shape the rig's acceptance rules forbid. It has been red since
the verifier pointer moved (D166, 2026-10-29). The wrong cause travelled into **`lead`'s #4982 body** and into the
delegate's `docs/NEXT.md` + `.spike/delegate/suite-marker.json`, because the delegate repeated `lead`'s finding instead of
running the demo. The suite's two failures are actually **three findings**: #4995, this one, and #4996 (which only fires
non-hermetically).


Older sessions live verbatim in `docs/NEXT-ARCHIVE.md` (this pointer's 2026-11-02T02:10Z predecessor was cut there at the
tail, byte-identical, proof in this file's own cut note).

## 1. What moved this session (all verified, none pushed)

- **`main` moved twice**: `e2f85719` → `4c0d4810` (merge of `item-4985`, `parents = e2f85719 d8c92bb2`) → **`c80bd7f0`**
  (merge of `item-4931`, `parents = 4c0d4810 8fa8f3a2`). Both merges have TWO parents, so they landed something
  (`docs/runbooks/land.md`: a parent count is structure, a subject is a description).
- **Proof, both halves** (land.md's rule — ancestry AND content): `git merge-base --is-ancestor d8c92bb2 main` exit 0 and
  `… 8fa8f3a2 main` exit 0; content check `git show main:src/config.mjs | grep -c DURIG_COMPACTION` = **24** (the five keys
  at `:140-144`) where the same grep was **empty before the merge**.
- **Full gate after both landings:** `node scripts/test.mjs --all --jobs 8` → **total 245, passed 243**, failed =
  `[demo/broker-serve-shell-availability.test.mjs, demo/deepinfra-catalog.test.mjs]` — byte-identical to the pre-landing
  baseline this session took at `e2f85719` (53.4 s then, 50.1 s after). **No regression.**
- **`origin/main` is at `e2f85719`; `main` is 8 ahead.** Still no push grant — the operator pushed once (the 94-ahead
  figure the old pointer quoted is closed) and these two merges have not been offered.
- **`item-4898` was deliberately NOT landed** — it is superseded, not unlanded: `item-4931`'s subject is "re-cut of the
  compaction build (#4887/#4898) onto current main, unchanged in substance" and both touch the same three files
  (`cli.mjs`, `demo/config.test.mjs`, `src/config.mjs`). Same for `wip/seat-prompt-files +1` (its re-cut `#4966` is in main).
  Closing both is `pm`'s verb; the delegate recommends against landing either.

## 2. Three landing-gate traps, measured so the next session does not re-derive them

1. **Land `item-4985`-class fixes BEFORE anything gated on them.** The first `--changed-suite` attempt STOPPED with
   `demo/clockin-digest.test.mjs` failing in the **detached** landing scratch:
   `Error: Command failed: git rev-list --count main..(no branch)` (`demo/clockin-digest.test.mjs:215`) — the #4985 defect.
   Landing `item-4985` first cleared it; its own gate run was 10/10 green in a detached scratch.
2. **`demo/local-model-pointer.test.mjs` is non-hermetic** (`:40` needs the gitignored `durig.config.json`). Proven A/B in a
   throwaway detached worktree at `4c0d4810` (`cli.mjs worktree /home/chexxor/Git/durian-dev/scratch-4931`, removed after —
   worktree count back to 14): no config → the exact red the lander reported; same worktree with `DURIG_LOCAL_BASE_URL`
   `/_MODEL` + `DURIG_VERIFIER_BASE_URL` `/_MODEL` exported → `LOCAL MODEL POINTER PASS (… pinned seats=12)`. So **export the
   four provider vars in the shell that runs the lander**, or `--changed-suite` will refuse clean landings.
3. **The gate has no known-red baseline, so nothing can pass it on this rig** — `main` itself is red at HEAD (2 of 245).
   `item-4931` was landed ungated with the note `land.mjs` prints, then regression-checked by a full suite on `main`
   compared to a hand-taken baseline. Minted this session (row 3 of the lead brief) as the missing feature.
4. **`cli.mjs queue --help` prints the whole queue** — 22,000,119 B for 4,994 rows, 1.1 s. That is `#4986` (still open). Use
   `node scripts/clockin.mjs` (5.5 s) or one `queue --json` redirect plus `.spike/delegate-20261102/rows.mjs <file>
   [nonterminal|grep <re>]` — that probe is in gitignored `.spike/`, so promote it to `tools/` or it is lost (233).

## 3. The verifier ruling (D190) — do not load a verifier model

Measured, Linux, 08:00Z: `nvidia-smi --query-compute-apps` → strata pid 345372 holds **14,770 MiB on the A4000 AND 20,712
MiB on the 3090** (`/v1/models` says `gpus:[0,1]`, `--max-context 204800`, 48 GiB RSS, 41.2 GiB shmem). Free VRAM is
1,472 + 1,574 MiB. **LM Studio has no process at all.** So loading ministral = evicting the author engine, for the model at
0/16 clean controls (D137). The operator's ruling, recorded in D190: keep the verifier provider dark, and run verify legs
the way `#4956`/`#4962` already did — **independent by seat/transcript/execution, and say so in the report** — never claim
model independence without first running `tools/model-probes/gate.mjs <baseUrl> <id> <label>`.

## 4. Measured state at 08:10Z — moved VERBATIM to docs/NEXT-ARCHIVE.md (a pointer holds pointers, not counts)

- Queue histogram, per-seat claimable spread, drain-audit counts and the spooled intents as of 08:10Z are **in the archive —
  and stale by design**. Re-run the instruments instead: `node scripts/clockin.mjs` (5.5 s) and
  `node tools/queue-drain-audit.mjs` (1.5 s) are cheaper than trusting a remembered count.
- Rows that carry the findings so the prose can go: **#4998** (`cli.mjs config` prints no `DURIG_LOCAL_*`/`DURIG_VERIFIER_*`
  key), **#4999** (`scripts/clockin.mjs` probes a hardcoded `:8080`), **#5000** (`src/attention.mjs:435` orders a re-arm
  that does not exist), **#4992** (`tools/channel-preflight.mjs:234` still prints "NO SHELL CAN START HERE" — queued to
  impl, do NOT re-mint).
- Local engine **UP and completing**; `cli.mjs config` says `DURIG_MAX_CONCURRENT_SEATS = "1"` while strata now serves
  concurrency **2** → start with `DURIG_MAX_CONCURRENT_SEATS=2` so seats queue in durig, not inside the model.
- **Re-measure strata every session, 0.2 s:** `nvidia-smi --query-gpu=index,name,memory.used,memory.total --format=csv` then
  `nvidia-smi --query-compute-apps=pid,gpu_name,used_memory --format=csv`. It decides whether a second model can load at
  all, and it has flipped twice in three days.

## 5. THE HAND-BACK — one ruling, three options, all measured (the delegate decided none of them)

`lead` settled `done` and minted **#4995–#5004** (the six from this session's brief, plus `#5001` a cleanup guard that
interpolated an unresolved junction root, `#5002` docs citing a non-existent `cli.mjs land` verb, and the two `pm` rows).
`pm` then settled `done` and touched **#4805 #4815 #4813 #4785 #4897 #4900 #4989 #4826**, minted **#5005 #5006 #5007 #5010
#5011**, asked **#5008 #5009** of `lead`, and **deferred #5003/#5004 back to `lead`** — because it holds no verb that parks a
`queued` row addressed to qa/qa2/auditor: `hold_work(#4974)` → "addressed to qa, not you", `release_work(#4993)` → "only the
sender or recipient may release it", `resume_work(#4799)` → "addressed to impl, not you", and `cancel_work` is terminal. That
gap is registered as **#5007**.

Measured consequence, and it is the finding of the hand-back: **parking the rows would not have cleared the start.**
`tools/broker-serve.mjs:411-412` refuses `--start` on any `block` finding, and `--dry-run` right now prints
`A start would be refused: provider-DURIG_VERIFIER_-unreachable, provider-verifier-completion-failed`. There is no
provider-liveness gate in the wake path (`grep -n "reachable|preflight|ECONNREFUSED" src/broker.mjs src/driver.mjs` → only
`src/broker.mjs:1473`, which classifies such errors AFTER a failed generation), so the broker would happily wake those seats
into `Connection error.` — the instrument's BLOCK is a pre-flight judgement, not a wake gate.

The operator's three options, with their prices:
1. **Give the verifier slot a live provider on the existing engine** — point `DURIG_VERIFIER_BASE_URL/_MODEL` at strata
   `http://127.0.0.1:47831/v1` `iq3_s`. Cheapest and it un-gates everything, BUT it makes the rig single-family, and
   `demo/local-model-pointer.test.mjs` will (correctly) go red until the rig file's five `verifier/…` model strings change
   with it. D137 is then satisfied only if every verify report says **independent by seat/transcript/execution, not by
   model** — the wording `#4956`/`#4962` already used. Do not do this quietly; it is a product decision, not a config tweak.
2. **Bypass the instrument** — `node cli.mjs serve --max-duration 1800` directly instead of `broker-serve --start`. Starts
   tonight, costs six fast `Connection error.` failures plus the rows they deposit, and deliberately steps over a gate that
   is correct in this instance.
3. **Leave the broker down and fix the substrate first** — release `#5007` to impl (the missing non-terminal park/re-route
   verb) and `#4995` (the only `main` red that is ours), and keep delivering by bounded `send`s. Slowest, and it is the only
   option that makes the next provider outage non-disabling.

## 6. Still open, re-read before acting

`#4970` HALF B (the config-drift lever: `DURIG_LOCAL_CONTEXT` 160000 in this checkout vs 200000 in the seat root —
operator-owned, still present) · **12 `deferred` rows parked on the operator** (`#4354`, `#4814`, `#4817`, plus 9 LANDING
entries) · the host clock: `LocalRTC=yes` on a dual-boot box while every broker gate is `Date.now()` arithmetic
(ROADMAP 234; `timedatectl set-local-rtc 0` is host-wide, so the operator's call) · `#4987`, `#4986`, `#4992`, `#4978`,
`#4979` (open instrument defects) · `#4966`, `#4977`, `#4985`, `#4931` are **done and landed — do not re-do them**.

## 7. The DeepInfra backup verifier — what the instruments say before anyone spends (operator asked; delegate measured, chose nothing)

Rawest material, fetched keyless this session: `curl -s https://api.deepinfra.com/v1/models` → `http=200`, **173 models**,
saved at `.spike/delegate-20261102/deepinfra-models.json` (the operator's docs page is the same list, prettier). Prices
below are that file's `metadata.pricing` (`$ per Mtok in/out`), and the per-turn column uses **this rig's own** verifier
prompt shape — p50 **55,538** / max **108,435** input tokens, cited from commit `ecdeb70f`, × 3,000 output
(`DURIG_VERIFIER_MAX_TOKENS`):

| candidate | $in / $out | ctx | cost per verify turn (p50) | in the curated catalog `buildModels` reads? |
| --- | --- | --- | --- | --- |
| `meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo` | 0.02 / 0.04 | 131,072 | **$0.0012** | no |
| `openai/gpt-oss-20b` (reasoning) | 0.03 / 0.14 | 131,072 | $0.0021 | no |
| **`openai/gpt-oss-120b`** (reasoning) | 0.037 / 0.17 | 131,072 | **$0.0026** | **no** |
| **`google/gemma-3-4b-it`** | 0.05 / 0.10 | 131,072 | $0.0031 | **no** |
| **`mistralai/Mistral-Small-3.2-24B-Instruct-2506`** | 0.075 / 0.20 | 128,000 | **$0.0048** | **YES — the only one of the four** |
| **`google/gemma-4-26B-A4B-it`** (reasoning) | 0.07 / 0.34 | 262,144 | $0.0049 | **no** |
| `deepseek-ai/DeepSeek-V4-Flash-0731` (reasoning, `prompt_cache`) | live 0.060 / 0.18 | 1,048,576 | $0.0039 | yes, at **0.09/0.18** — a stale price |

**"Lowest price" is the wrong lever here, and the arithmetic is the reason.** The whole credible band is **$0.0012–$0.0049 per
turn** — a 30-turn verify evening is **$0.04 to $0.15**. The gap between the cheapest 8B model and a 120B reasoning model is
**a third of a cent per turn**. Spending the gate's real cost (a `gate.mjs` run with clean controls, k≥3) is orders of
magnitude more expensive than the model choice, so qualify first and price-tie-break second.

Three hard filters the rig imposes, all measured, none of them price:
1. **ctx ≥ 128k.** Verifier prompts run p50 55.5k / max 108.4k. `DURIG_VERIFIER_CONTEXT` is declared **24,576** — below the
   p50, the impossible pair D166 registered as **259**, still unfixed. Any DeepInfra row must set ctx honestly or the swap
   just moves the failure.
2. **Tool calling.** `rig.selfdev.json` gives the five verifier seats **no `tools` restriction**, so a verify leg runs the seat
   loop with tools; the live catalog's `tags` do not state function-calling support for any candidate. Must be probed per
   model, not assumed from the spec sheet.
3. **A bounded system message.** D166 measured that requests without one inherit the host's "be as long as you want"
   instruction and die at `finish=length`. That is host-side for LM Studio; a remote provider needs the same bounding
   asserted, or the p50 becomes the budget instead of the prompt.

And the substrate gap that decides the ordering: `src/providers/deepinfra-models.ts` `fallbackModels()` (16 entries) is what
`buildModels` reads, and `fetchDeepInfraModels` (line 130) is imported nowhere — the test header says so. So three of the
operator's four candidates resolve to **`no_model` before a request is made**, which is the 2026-10-19 outage class. Also
**`mistralai/ministral-3-14b-reasoning` is not in the live DeepInfra catalog at all** — so §0a's fix must not "fix" the guard
by adding it. Finally: **there is no spend cap and no cost ledger anywhere** (`grep -nE "SPEND|BUDGET|CAP_" src/config.mjs` →
nothing; `grep -rn MAX_SPEND_USD src/*.mjs cli.mjs` → nothing; no `src/costsheet.mjs`) while `docs/SELFDEV.md` §0 asserts
"hard caps and the cost recorded". Write the cap before pointing five seats at a metered API.

**What the delegate needs from the operator to go further:** (a) `DEEPINFRA_API_KEY` in the *environment*, never in
`durig.config.json` (`src/config.mjs:31,106` records a key that leaked there once); (b) a ruling that amends D137's model
clause — a remote verifier is a *different engine*, which is a genuine independence gain over the single-family local rig,
but only if reports keep saying which independence they actually got; (c) whether to pay for the qualification run
(`node tools/model-probes/gate.mjs https://api.deepinfra.com/v1/openai <model> <label> --replicate 3 --plan` first, spend
nothing, then the paid arm). Recommended shortlist for that run: `gpt-oss-120b` (reasoning, cheapest reasoning-capable),
`Mistral-Small-3.2-24B` (zero substrate change), `DeepSeek-V4-Flash-0731` (1M ctx + prompt cache, and at 55k re-sent prefix
the cache may beat headline price — D147 measured 8,757 cached tokens in 96 ms warm).

## Standing constraints

- **Do not claim, complete, defer, or route queue rows yourself.** Routing and decomposition belong to `lead`/`pm`.
- **No push without the operator's grant** — `main` is **6** ahead of `origin/main` (`e2f85719`).
- **Native host only** (Linux here; D131). **`DURIG_DB` for the CLI**, never `DURIAN_PI_DB` (D103).
- **`test -f "$PWD/durig.config.json"` before any write verb** (absent in every worktree; precedence env → `./durig.config.json`
  in the waker's cwd, `src/config.mjs:7`), and **never run `doctor`/`resume` while a seat is running** (D187).
- **`inputs/fetched/` must stay clean or the lander refuses**: `scripts/land.mjs` counts **untracked** paths as dirty. One
  uncited, unmanifested fetch (`strata-batching.md`, sha256 `d1f7d558…`) was moved to `.spike/inputs/` this session to let
  the landings run — re-file it properly (manifest row + URL) or delete it, do not leave it in `inputs/fetched/`.
