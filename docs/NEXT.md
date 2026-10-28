# durian-pi — NEXT (current pointer)

> Older sessions moved VERBATIM to [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md) — original order, no edits.
> This file is the live pointer plus the current session: everything from the `2026-10-27T23:20Z` session back
> lives in the archive. The cut is proven by concatenation (byte-identical tail of the archive, 12,781 B) and by
> `git log -p docs/NEXT.md` — see `docs/DECISIONS.md` D126, D129, D138, D139.

## NEXT SESSION (2026-10-28T01:35Z — CLOCK-OUT: 195 ANSWERED IT — THE FALSE ALARMS ARE NOT MY WINDOWING, AND THE DEFECT AXIS DOES NOT REPLICATE)

> Archive: older sessions live VERBATIM in `docs/NEXT-ARCHIVE.md` (the digest quotes this block, so the
> link has to be inside it — `demo/clockin-digest.test.mjs` checks that it is).
>
> **Label honesty:** these labels mark *sessions*, not a timeline — do not infer order or recency from them. This
> block is cut at `01:35Z`; the block below it in the archive was labelled `23:20Z`.

**Current item:** ROADMAP **189** (cross-family verification). Provider built and resident (D134), **no seat
flipped** (D137 — neither D138 nor D139 reopened it). **195 (whole-module controls) ran to completion this session and its
answer is in: the false-alarm finding is not an artifact of my windowing.** Two new items are **registered, not
scheduled**: **198** (a gate verdict does not replicate — same model, same corpus, same scorer flipped 4 of 8 defect
cells) and **199** (a whole-module "matched pair" is not byte-matched: the clean side is comment-stripped, −17% to
−67% of the bytes). Already registered: 190, 191, 192, 193, 194, 196, 197, memory/security 161–184. **The delegate
claimed, completed, deferred and routed nothing.**

**The baseline, re-measured at 00:40Z on Linux** (`Linux Alex-Desktop-Win10 7.2.11-200.fc44.x86_64`, GNU/Linux —
name the OS in every measurement): `node scripts/test.mjs` → **238/238 passed in 41.5s**;
`DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json` → **`pass: true`, 0 errors, 62 findings**
(`single-model-rig` 1, `verification-without-evidence` 1, `evidence-tree` 1, `citation-unresolvable` 5,
`duplicate-item` 54) and `single-model-rig` **still present** — honest red, not an unfinished step;
`… node cli.mjs status` → broker **down** (`{"state":"down","reason":"no broker state"}`), attention
`deferred_awaiting_answer` on pm/impl/lead/devtools/qa2 (#4813 #4354 #4816 #4817 #4814 waiting on human).

**The measurement that moved the record (D138 → D139).** Same corpus (8 items, 3 execution-proved mutants), same
scorer, `--material answer` for **both** families, `CAL_MAX_TOKENS=2400`, `temperature 0.2`, both models already
resident, **zero download, zero operator action**:

| arm | defect mechanisms named | false alarms, leading | false alarms, neutral | absent-binding claims (the excerpt artifact) |
|---|---|---|---|---|
| control `local/iq3_s` — fragments | **4/8** | 8/8 | 8/8 | 4 turns |
| control `local/iq3_s` — **whole modules** | **2/5** | **5/5** | 4/5 (1 AMBIGUOUS) | **0** |
| candidate `ministral-3-14b-reasoning` — fragments | **3/8** | 8/8 | 8/8 | 3 turns |
| candidate `ministral-3-14b-reasoning` — **whole modules** | **3/5** | **5/5** | **5/5** | **0** |

Paired exact McNemar on the **5 items both whole-module arms showed** (`gate-side-by-side.mjs` intersects, because a
whole-module arm has a smaller denominator *by design*): fragment → whole movement is **0/0 discordant on the
leading-prompt false-alarm axis for both families, p = 1.000**; control-vs-candidate in the whole arm is **1
discordant pair, p = 1.000**. Full tables: `docs/reviews/verifier-gate-hardening-2026-10-28.md` §10.

**Three things follow, and they are separable.** (1) **The excerpt artifact was real and is not what was making the
models cry wolf.** Whole modules produced **zero** absent-binding turns (fragments produced 4 and 3) — direct proof
those claims were about my window — yet the false-alarm rate moved by **one cell in fifteen per model**. D138's
standing caveat ("no false-alarm number is quotable until controls are whole modules") is **discharged, and the
number it was protecting is unchanged**: shown a whole, correct, import-carrying module and asked "is there a defect
here? it may be correct as written", **both families assert a defect 5 times out of 5.** (2) **That makes it a
verification-design finding, not a candidate finding** — how a verifier seat is fed and when a refusal is admissible.
It goes **to the PM as a queue item**; the delegate does not fix it. (3) **The defect axis does not replicate, so it
cannot carry a ranking.** Two runs of the same model on the same 8 items with the same scorer reproduced **3/8 twice**
while flipping **4 of 8 per-item verdicts** (`H4 HIT→MISS`, `M1 HIT→MISS`, `M2 MISS→HIT`, `M3 MISS→HIT`;
2/2 discordant, p = 1.000), and the
false-alarm axis replicated perfectly. The between-family gap that D137/D138 were asked to rank on (4/8 vs 3/8,
4/3 discordant) is **the same size as one model's movement against itself.**

**Fit was measured, not assumed.** The estimator is calibrated on recorded `usage.prompt_tokens` — **0.2588–0.3244
tok/char** (`ministral`), **0.2604–0.3609** (`iq3_s`) — so `estimateTokens` uses 2.7 chars/token, deliberately
pessimistic. Live whole-module cost, measured: **`src/confine.mjs` = 9,554 tok at the probe / 9,618 in-run for the
candidate, 9,741 / 9,804 for the control — ACCEPTED** (400-not-400, which is what 195 asked for; §9's `wc -c/4`
arithmetic had guessed "likely over" and was wrong). `src/textwidth.mjs` 2,961 · `src/driver.mjs` 3,741 ·
`src/job-object.mjs` 3,923 · `scripts/clockin.mjs` 4,465. **H1/H3/H4 stay structurally excluded**: `src/rig.mjs`
57,993 chars ≈ 21.5k est tok, `src/worktree.mjs` 69,702 ≈ 25.8k, against the verifier's declared 13,273. Raising
that (q8_0 KV halves the per-token KV cost) is an operator action on the LM Studio instance the delegate did not
touch — and note the whole-module arm is therefore **biased to small modules**, excluding this rig's two biggest and
most defect-bearing files.

**Instrument landed this session** (delegate's apparatus, `tools/model-probes/`, nothing in `src/`): `gate.mjs`
gained `--whole-module`, `--budget`, `--probe`, `--plan`, `--material answer|answer+reasoning`, mode-aware artifact
handling, and a `--compare` that prints a per-item side-by-side and pairs **only on items both runs showed**;
`corpus.mjs` gained `wholeTexts()` + `estimateTokens()`; **`gate-side-by-side.mjs` is new and tracked**. All 16
whole-module texts pass `node --check`.

**Machine state, measured 01:10Z — nothing restarted or reconfigured.** `nvidia-smi`: **RTX A4000 13,452 MiB used /
2,577 free**, **RTX 3090 23,107 MiB used / 1,048 free**. Verifier = LM Studio's `llama-server` on
`http://127.0.0.1:1234/v1`, model `mistralai/ministral-3-14b-reasoning` (the catalog also lists
`recursivesi/flint`). Control = Strata `http://127.0.0.1:47831/v1`, model id `iq3_s`, `"label":"Qwen3.8-Flash-Next
IQ3_S"`, `"gpus":[1]`. `durig.config.json` (gitignored) still points the verifier env at Ministral;
`rig.selfdev.json` (tracked) still carries `local/iq3_s` for all 12 seats.

**Blocker:** three operator rulings, none a build, and the new one is a routing/wording call, not a measurement:

1. **Which verifier family (ruling 1).** Unchanged in direction: **(a)** Ministral 14B Q6_K — operationally perfect,
   **not routed (D137)**; **(b)** `unsloth/Devstral-Small-2-24B-Instruct-2512-GGUF` UD-Q3_K_XL, 11.85 GB,
   unmeasured — **and now known to be a wasted download until 198 lands**, because a single-pass gate number is not
   rankable; **(c)** Flint — does not fit (D137/D138 arithmetic); **(d)** keep author seats on `local/iq3_s` and put a
   verifier seat on a **remote** family (`DEEPINFRA_API_KEY` + balance). The cheap measurement that makes the choice
   real is **198 (replication) + 199 (symmetric pairs) + more items (194)** against the two already-resident models —
   no download for any of it.
2. **Evidence binding (190)** — durable records cite store-native `entries.id`, not machine-local git objects?
   Decides how memory 165/167 and substrate 170 are written.
3. **`#4785` was marked `done` with no artifact anywhere** (`500969f42` never existed on the Windows rig either). A
   detector for "a completion without an artifact" is a design question, still unregistered.

**Drafted ask, ready for the operator to send (the delegate does not speak as the operator, and `intent.mjs` spoofs
operator input, so it was NOT spooled — broker is down and this is the operator's to grant).** Put to `pm` as a
BUILD/DESIGN item for `qa` + `lead` (+ `devtools` for the apparatus):

> Both resident verifier families — `local/iq3_s` (author family) and `ministral-3-14b-reasoning` (candidate) —
> assert a defect on **every** clean control they were shown, **whole modules included** (5/5 leading, 4/5 and 5/5
> neutral, n = 5), and this replicated across independent runs. Evidence:
> `docs/reviews/verifier-gate-hardening-2026-10-28.md` §10, `docs/DECISIONS.md` D139. Decompose the question:
> **under what contract is a verifier seat allowed to abstain, and how is it fed?** Minimum shape: a verifier
> prompt that admits "no defect found" as a first-class answer and records it, a rule for what a *refusal* costs the
> loop (confine-style over-refusal already costs us real work — see item M2/`#4374`), and a measurable bar for
> false-alarm rate that a verifier seat must clear before it gates a merge. Do not solve it by making the corpus
> easier.

**Next thing, in the delegate's own apparatus (do not pre-decide the PM's design answer).** **198 first**: make
`gate.mjs` run **k ≥ 3 replicates per condition**, print the **per-cell replication rate**, and score the
**majority-of-k** cell — until that exists, every defect-axis number in this repo is a sample and inadmissible for
routing. **Then 199**: strip comments symmetrically (or not at all) for whole-module pairs and print each pair's
**byte delta** with the comment share broken out, then re-report the §10 table under the symmetric rule. **Then
194's "more items"** — 8 items is too few for any paired test, and 3 of the 8 can never be shown whole at this
context. **Only after those** is option (b) worth a download.

**Exact next command** (baseline, then the free fit table, then the arm that must reproduce):

```bash
DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json
node scripts/test.mjs
CAL_SPIKE=.spike/gate/cand node tools/model-probes/gate.mjs http://127.0.0.1:1234/v1 \
  mistralai/ministral-3-14b-reasoning plan --whole-module --budget 12500 --material answer --plan
CAL_SPIKE=.spike/gate/cand CAL_MAX_TOKENS=2400 node tools/model-probes/gate.mjs http://127.0.0.1:1234/v1 \
  mistralai/ministral-3-14b-reasoning candidate-ministral-whole \
  --whole-module --budget 12500 --probe --material answer --out .spike/gate/run-candidate-whole.json
```

Expected: **`pass: true`, 0 errors, 62 findings, `single-model-rig` present**; **238/238 in ~41 s**; the plan table
printing **5 items whole + 3 loud `SKIP …whole module ≈N tok > budget 12500`**; then `CORPUS: 8 items`, three
`PROOF …` lines, 15 verdicts, and a `SUMMARY` whose whole-module arm should land near **3/5 named, 5/5 false alarms
(leading)** — this session's single run was 3/5, and per **198** a one-cell deviation there is **expected noise, not
a regression**: chase it only if the aggregate moves by more than 2 cells or the SKIP set changes.

**Do not:** route `qa`/`qa2`/`auditor` at `ministral-3-14b-reasoning` (D137 stands; 198 removes the defect-axis
basis for any rival claim too); **quote a defect-hit count as if it were a measurement** — 4/8 vs 3/8 is inside one
model's own run-to-run movement (**198**); download Devstral before 198 (another single-pass number would be
unrankable again); treat the whole-module arm as ranking (the control naming **2/5** fails rule **G2** in that arm);
re-quote §9's `wc -c/4` fit table (§10 measured it — `src/confine.mjs` **fits**); treat a `single-model-rig` clearing
as cross-family verification (`src/checkup.mjs:594` compares strings); run `up`/`send`/`run`/`complete` before
re-taking the worktree/branch/`.spike` inventory into `.spike/` and diffing it after (`AGENTS.md` clock-in step 7,
`docs/runbooks/workspace-move.md`); run `git add -A`; use `DURIAN_PI_DB` for the CLI (it is `DURIG_DB`); measure the
suite with a serial hand-loop (D135); compute throughput from a non-streaming call (D136); restart or reconfigure the
operator's LM Studio / Strata instances unasked; revert the dependency relaxation (the operator's call); or start
broker work on this workspace — the store is intact but its git history is only partially here
(`git cat-file -t 78991031` fails; the docs' own baseline sha is not an object in this clone).

**Still in the tree, not the delegate's, not landed:** `@earendil-works/pi-coding-agent` `1.3.0` → `^1.3.0`,
`package-lock.json`/`package.json` modified, `.scratch/`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` untracked. The
delegate touched none of it and committed only its own item's paths (`tools/model-probes/`,
`docs/reviews/verifier-gate-hardening-2026-10-28.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/NEXT.md`,
`docs/NEXT-ARCHIVE.md`). Transcripts live in gitignored `.spike/gate/`, so the quoted tables in §10 are the record.
