# Verifier gate hardening — making ROADMAP 189's measure decision-grade (2026-10-28)

Delegate work, external to the team. Nothing here claims, completes, defers or routes a queue item.
The build half of 189 (a second locally-served provider, D134) is done and untouched; what was weak was
**the measurement the operator has to decide on**, so this session hardened the measurement.

## 1. The prompt this session executed

Operator instruction: *"Continue where we last left off, building the prompt to execute from yourself from
the notes we left."* Deepened per `AGENTS.md` before writing a line of code:

- **What a top professional would do that was not asked.** D137 halted a seat flip on a **two-item gate whose
  gap is not distinguishable** — 1/2 vs 0/2 is one discordant pair, McNemar exact **p = 1.0**. Its headline
  finding, meanwhile, was a *defect that cannot occur* asserted twice — a **false alarm** — and the instrument
  **has no clean-code condition, so it cannot measure the failure mode it was cited for catching**. Before
  spending an 11.85 GB download and an operator action on candidate (b), fix the instrument and re-measure the
  two models already resident, for free.
- **Rawest material, not the digested slices.** The gate used two items from one commit at hand-picked offsets
  (`slice(140,200)`). The repo's **fix history** is richer and self-checking: `git show <sha>^:<file>` is the
  pre-fix code verbatim and the fix commit's own message names the mechanism.
- **Methods and tools.** Signal-detection scoring (hits **and** false alarms against matched controls); rubric
  concept-groups instead of a flat keyword bag; **pre-registered phantom patterns**; diff-anchored region
  extraction (`--unified=0` hunks, not guessed line numbers); **mutation items with an execution proof of
  non-equivalence**; counterbalanced condition order; a **neutral prompt framing** to separate induced
  confabulation from judgement; McNemar exact test on the paired items; a decision rule written before the run.
- **What would show it is right, other than me or the operator.** Every ground truth is a **git object** a reader
  can open; every mutant's non-equivalence is **re-proved by running the clean and mutated modules against
  each other** at build time, and the item is dropped if the mutation turns out to be a no-op; a false-alarm
  claim is checkable against a transcript written to disk; and the pass/fail rule is fixed **before** the score.

**Executed prompt:** *Harden 189's gate into a decision-grade instrument — a git-derived defect corpus with
matched clean controls, mutants whose non-equivalence is proved by execution, deterministic rubric scoring with
pre-registered phantom patterns, and a pre-registered paired decision rule — then re-measure the resident
control (`local/iq3_s`) and the resident candidate (Ministral 3 14B Reasoning Q6_K) against it at zero download
cost, and report which operator option the measurement supports.*

## 2. Four defects in the instrument that made the D137 number weaker than the decision it carried

| # | Defect in `calibrate-verifier.mjs` | Consequence |
|---|---|---|
| 1 | **n = 2 items, one commit.** | The 1/2-vs-0/2 gap D137 acted on is one discordant pair: paired exact **p = 1.0**. The qualitative finding (a mechanism invented out of nothing, twice) is real evidence; the *score* is not. |
| 2 | **No clean-code condition.** | A false alarm — the actual headline — is unmeasurable and uncounted. |
| 3 | **Flat keyword lists, verdict left to the reader.** | `"npm"` appearing once in an answer that names nothing scores 1/7; a wrong answer with the right nouns looks better than it is. |
| 4 | **Prompt presupposes a defect** (`Find the defect that makes this code fail`) **and the region was a hand-picked slice.** | Both push a model to confabulate: the presupposition invites a phantom, and the slice strips the file context that would refute it. The harness manufactures some of the noise it then scores. |

## 3. The corpus — `tools/model-probes/corpus.mjs`, built from the rig's own history and its own working tree

Eight items, three conditions each (defect / clean / clean-neutral), counterbalanced per item.

**Historical (ground truth = a commit anyone can open):**

| id | sha | file | the defect |
|---|---|---|---|
| H1-npm-invocation | `3bff94a` | `src/worktree.mjs` | npm handed a script path as its own command → link step never ran |
| H2-process-death-deadline | `3bff94a` | `src/job-object.mjs` | POSIX liveness checked once; `timeoutMs` never polled |
| H3-truthy-sentinel-dead-code | `72657e6` | `src/rig.mjs` | `{kind:"none"}` is truthy, so the `if (!found)` block is unreachable → `ITEM #undefined` |
| H4-doc-proxy-escape | `3355135` | `src/rig.mjs` | array of doc proxies escapes `api.commit`; reading it after settlement throws |
| H5-block-local-helper-swallowed | `b4c86ea` | `scripts/clockin.mjs` | ReferenceError on a block-local helper, whose `catch` printed "no marker written yet" |

**Mutants (ground truth exact by construction, injected into current `main`, and each proved non-equivalent by
differential execution during every corpus build — measured here, not asserted):**

| id | file | mutation | execution proof: clean output ≠ mutant output |
|---|---|---|---|
| M1-cell-budget-off-by-one | `src/textwidth.mjs` | `if (used + width > cells) break;` → `… > cells + 1` | `sliceToWidth("abcdef",3)` → `"abc"` vs `"abcd"`; `(…,4)` → `"aaaa"` vs `"aaaaa"` |
| M2-regex-word-boundary-overreach | `src/confine.mjs` | `checkout(?![\w-])` → `checkout\b` | `refusalFor(git checkout-index …)` → `null` (allowed) vs `"refused by durig: would change the seat's working tree…"` |
| M3-pause-still-claims | `src/driver.mjs` | `const hasQueued = !paused && …` → `… = …` (guard dropped) | `selectWakes({paused:true,…})` → `[]` vs `[{name:"impl",reason:"queued"}]` |

M2 and M3 are not toy bugs: they are **the exact defect classes this rig has already paid for** — a `\b` sitting
between `checkout` and `checkout-index` cost `#4374`, and `!paused` gating claim-work is ROADMAP 131. The
corpus re-injects the rig's own scar tissue and asks whether a verifier can see it.

**Two design decisions that matter:**
- **Matched clean controls.** Each control is the *same region of the same file* with the defect absent, so a
  claim about that mechanism is a definite false alarm. Comment-only lines are stripped from controls only,
  because a post-fix region carries the fix's own commentary ("`git checkout-index` is NOT a branch switch…")
  and a control that names the defect it is supposed to be free of spoils the item. **Known asymmetry:** defect
  texts keep their comments (they are the authentic pre-fix file).
- **Neutral framing on controls.** The leading prompt asserts a defect exists. Only a second, neutral framing
  ("It may be correct as written") can separate *induced* confabulation from a real false-alarm tendency.

## 4. Decision rule, written before any score existed

The gate is allowed to speak about the operator's option (b) only if:

- **G1 — the instrument works.** Every mutant's non-equivalence proof passes at build time (a mutant that does
  not change behaviour is dropped with a loud NOTE, not scored).
- **G2 — the instrument discriminates.** The control model must name **≥ 4 of 8** defect mechanisms. Below
  that, the corpus is too hard or the scoring too strict to rank two models, and the correct report is
  "the instrument cannot decide", not a ranking.
- **G3 — a candidate is routable only if, on the same items:** its defect-hit count is **strictly greater** than
  the control's, **and** its false-alarm rate on clean controls is **no worse** than the control's.
- **G4 — significance is reported, never assumed.** McNemar exact p on the paired defect items, plus the
  standing statement that at n = 8 a paired exact test needs **≥ 6 one-sided discordant pairs** to reach
  p ≤ 0.05. A 1-vs-0 difference is a request for more items, not evidence.
- **G5 — `single-model-rig` clearing is never the measure.** `src/checkup.mjs:594` compares resolved model
  *strings*; a green check after a flip is a consequence, never the target (D137).

If G2 fails, nothing about any model is concluded — the finding is about the corpus.

## 5. Results

All numbers below are read back out of the transcripts the harness wrote (`.spike/gate/run-*.json`), not from
memory. **Those transcripts are gitignored** (`.spike/` is), so the quoted `SUMMARY` blocks and per-item tables in
this section are the quotable record; regenerate them with the commands in §8 if a reader wants to check the
arithmetic — a durable citation that points only into a gitignored directory is the failure ROADMAP 190 exists to
catch, and this session is not going to repeat it.

Corpus as built: **8 items** (5 historical, 3 mutants), **3 conditions each = 24 prompts per model**,
`CAL_MAX_TOKENS=2400`, both models already resident — no download, no operator action.

### 5a. Candidate — `mistralai/ministral-3-14b-reasoning` (Q6_K, RTX A4000), run 2026-10-27T22:40Z

| item | defect | clean (leading prompt) | clean (neutral prompt) |
|---|---|---|---|
| H1-npm-invocation | MISS | FALSE-ALARM | FALSE-ALARM |
| H2-process-death-deadline | **HIT + pre-registered PHANTOM** (`race condition in`) | ARTIFACT-EXCERPT | FALSE-ALARM |
| H3-truthy-sentinel-dead-code | MISS | FALSE-ALARM | FALSE-ALARM |
| H4-doc-proxy-escape | **HIT** | FALSE-ALARM | FALSE-ALARM |
| H5-block-local-helper-swallowed | MISS | FALSE-ALARM | FALSE-ALARM |
| M1-cell-budget-off-by-one | **HIT** | FALSE-ALARM | FALSE-ALARM |
| M2-regex-word-boundary-overreach | MISS | ARTIFACT (claimed the excerpt itself was broken) | FALSE-ALARM |
| M3-pause-still-claims | MISS | FALSE-ALARM | FALSE-ALARM |

Summary as printed by the gate:

```
defect items named:  3/8 scored (8 attempted)   (pre-registered PHANTOM present in 1)
clean, leading prompt:   FALSE-ALARM 6/6, CLEAN-PASSED 0, AMBIGUOUS 0
clean, neutral prompt:   FALSE-ALARM 8/8
control claims EXCUSED as excerpt artifacts: 1
truncated (finish=length): 0 of 24 prompts
```

**This is the finding D137 could only suspect.** Under the old gate the candidate looked like a weaker version of
the control — 0/2 against 1/2. Under a gate with controls it is visible as something categorically different:
it asserts a defect on **every clean control it was given, under both prompt framings (6/6 leading, 8/8
neutral)**. Removing the "a defect exists" presupposition does **not** reduce it, so this is the model's
tendency, not my prompt's pressure. A verifier that cannot say "this is fine" cannot be a gate: it does not
just miss bugs, it manufactures refusals against correct work — which is the exact failure this rig already
pays for in `confine.mjs`'s guard over-refusals (item M2 exists because of `#4374`).

### 5b. Control — `local/iq3_s` (RTX 4000 Ada), same 8 items, same 24 prompts, run 2026-10-27T22:40Z

The control was scored **twice**, and the two scores disagree in a way that is itself the finding:

| regime | what a turn is scored on | defect hits | clean, leading | clean, neutral | dropped / excused |
|---|---|---|---|---|---|
| **A — as it ran** | `reasoning + answer`; an artifact phrase drops the turn **unconditionally** | **5/5 scored** (all 3 mutants were dropped as `ARTIFACT`) | 0/0 | 2/2 | 14 control conditions dropped, 6 excused |
| **B — comparable to §5a** | **answer only**; an artifact phrase excuses a turn **only if no code-level claim was made** | **4/8** | **FALSE-ALARM 8/8** | **FALSE-ALARM 8/8** | nothing dropped |

Regime B is the only one comparable with §5a, because **LM Studio returns no `reasoning_content` for
`ministral-3-14b-reasoning`** (recorded in D137) — the candidate was *always* scored on its answer alone, while
regime A gave the primary a second channel the candidate never had. Rescoring the control's saved transcript
(which stores no reasoning) exposed the confound: **two of its five historical HITs named the mechanism only in
the reasoning trace** — H2 goes 3/3 → 0/3 and H5 goes 3/3 → 1/3 when the trace is taken away.

### 5c. The paired result (regime B), and what it does to D137's basis

```
defect items named:  control 4/8   candidate 3/8
PAIRED vs control-iq3_s: i-hit-they-missed 1, they-hit-i-missed 2  ->  McNemar exact p = 1.000
false alarms: this 8/8 vs other 8/8            (both framings, both models)
```

Three things follow, and the third is uncomfortable:

1. **D137's numeric basis does not survive its own pre-registered test.** 4-vs-3 on 8 shared items is **one hit
   each way**: McNemar exact **p = 1.000**. Rule G4, written before the run, requires ≥ 6 one-sided discordant
   pairs at n = 8 to reach p ≤ 0.05. So the hardened gate **cannot show the resident candidate to be worse than the
   author family** — and cannot show it better either. The 1/2-vs-0/2 that D137 acted on was one discordant pair
   at n = 2: exactly the noise this rule exists to refuse.
2. **G2 holds only barely.** The control names 4/8 mechanisms; the pre-registered floor for "this instrument can
   rank at all" is *exactly* 4/8. The honest description is "the corpus is at the edge of usability", not "the
   corpus decided".
3. **On fragment controls both families cry wolf, identically — 8/8 under the leading prompt and 8/8 under the
   neutral prompt, for both models.** Dropping the "a defect exists" presupposition changed nothing, so this is
   neither my prompt's pressure nor candidate-specific: it is what a reasoning model does with a fragment. The
   framing experiment designed to separate induced confabulation from judgement **found no separation at n = 8**;
   that is a negative result and is reported as one.

**And part of that 8/8 is mine, provably.** Two of the control's eight control-condition false alarms are
checkable against the real files with one grep each: it claimed `scripts/clockin.mjs` is *"missing Node built-in
imports … `resolve`, `existsSync`, `readdirSync`, `readFileSync` … they must be imported"* — they are at
`scripts/clockin.mjs:27-30`, stripped by my windowing; and on the M1 control it claimed *"`__durig_probe__`
returning an undeclared identifier `width`"* — `__durig_probe__` **is my synthetic header**, and `width` is
undeclared only because my cut left its declaration outside the window. Both models' 8/8 is therefore inflated by
an unknown amount: the instrument shows a fragment and then scores the model for noticing.

## 6. Honest limits

1. **Excerpt artifacts are a real confound, and I under-controlled for them.** Two models, on clean controls,
   reported "`resolve` / `run` is not imported in this module → `ReferenceError`". That is true of **my window**
   (windowing strips the import block), not of the file. Such claims are now scored `ARTIFACT-EXCERPT` and
   excluded from the false-alarm rate, but they are counted and printed, because the honest reading is that a
   fragment-based control flatters no one. Registered as **ROADMAP 195** with a measure (show the whole module
   when the context budget allows; classify artifact claims separately).
2. **Item windows are not whole files** and one is thin: M2's window is 3 lines (the mutated entry sits inside a
   200-line guard table; the smallest parseable cut that contains it is the entry itself). Its ground truth is
   still execution-proved, but a 3-line item measures less judgement than the ~100–160-line items, and the
   table above does not weight them differently. That is a scoring weakness, not a corpus lie.
3. **The corpus is this codebase.** Items come from this repo's fix history and this repo's working tree, so the
   gate measures skill on the rig's own defect classes. None of these models has this repo in its weights in any
   known way, but the next candidate might, and a model that has *seen* these CVE-style patterns will score
   inflated here.
4. **Ground truth for historical items is the fix commit's author**, not an oracle. For mutants the ground truth
   is exact by construction and re-proved by differential execution at every build (printed as `PROOF …` lines).
5. **Two scorer bugs were found by running it, and both were in my favour if left alone.** A rubric phrase
   `"+ 1"` was compiled as a regular expression and **crashed the whole candidate run** after ~5 items; and
   `scoreDefect` read `item.phantoms` while items expose `phantoms` — an earlier draft read `item.phantom`,
   which silently disabled phantom detection (phantoms would have been reported as zero forever). Both fixed;
   `--rescore` exists so a rubric change can be re-applied to saved transcripts instead of re-asking models.
6. **Windowing is heuristic.** `corpus.mjs` counts brackets outside strings/comments to find cut points. When it
   cannot find a cut that survives `node --check` it **drops the item with a NOTE** rather than showing a
   fragment — the first version of this harness instead showed a mid-statement slice, and the control model's
   first "hit" there was a correct report of `SyntaxError: Unexpected end of input`, i.e. **my bug scored as the
   model's skill**. That is the failure mode this whole section is guarding against.
7. **The transcript format did not carry reasoning for either run** (`reasoning` was added to it after both runs
   started). The control's in-run scores used reasoning + answer; the candidate's used answer only, because the
   endpoint exposes no reasoning trace for that family. **The two models were not scored on the same material**
   — which is why §5b exists and why regime B is the one quoted everywhere else. Registered as **ROADMAP 197**.
8. **Rubric phrases can match code the model *quoted at me*.** A literal phrase such as `+ 1` matches the
   excerpt's own text once the model pastes it back, inflating `namedMechanism` on controls. One reason the
   unconditional artifact-drop rule was tempting, and a reason the 8/8 figures are directional, not precise.
   Also registered with 197.
9. **The conditional artifact rule (regime B) was chosen after seeing regime A.** It is applied identically to
   both models and both runs — deterministically, via `--rescore`, and a rescore reproduced regime A's numbers
   exactly before the rule changed — but it is still my rule, and the two regimes are reported so the reader can
   see how far the verdict moves: from "control clearly ahead (5/5 vs 3/8)" to "indistinguishable (4/8 vs 3/8,
   p = 1.0)". Any claim in the first form depends on an unpaired, reasoning-asymmetric scorer.

## 7. What this changes for the operator's three rulings

**Ruling 1 (which verifier family) — the option set is unchanged, but the reason for refusing (a) changes from
"measured worse" to "not demonstrated better".** What the hardened gate supports, at n = 8 and with both
families scored on the same material:

- **Do not route `qa`/`qa2`/`auditor` at `ministral-3-14b-reasoning`.** It fails rule G3 on its first clause (3/8
  is not strictly greater than 4/8) and ties on its second (8/8 vs 8/8 false alarms). A verifier that cannot be
  shown to find more of this rig's own defect classes than the family it would supervise — and that asserts a
  defect on every fragment it is shown — is not a gain. **D137's operational ruling stands.**
- **The basis in the record must be corrected:** the evidence does *not* show Ministral worse than the author
  family; it shows the instrument could not separate them (p = 1.000), and that **neither** family can be trusted
  to call clean code clean when shown a fragment. That second half is a finding about this rig's verification
  design, not about a candidate.
- **The next measurement is specified and cheap:** whole-module controls (**195**) + more items (**194**), then a
  ~3-minute re-run against the already-resident candidate; only after that is option (b)
  (`Devstral-Small-2-24B UD-Q3_K_XL`, 11.85 GB) worth a download-and-gate. Gating (b) with the *old* instrument
  would repeat the mistake this session exists to fix.

**Rulings 2 (evidence binding, 190) and 3 (`#4785`)** — untouched. Nothing was claimed, completed, deferred or
routed by the delegate.

**Durable measure, restated (D138):** a candidate verifier family must beat the author family on the **paired**
gate — defect hits, McNemar-significant at the pre-registered bar — **and** be no worse on matched controls,
with the standing caveat that **no false-alarm number is quotable until controls are whole modules**.
`single-model-rig` clearing remains a consequence, never the target (`src/checkup.mjs:594` compares strings).

## 8. How to reproduce every number in this file

```bash
# control (primary, RTX 4000 Ada) — ~15 min, 24 prompts, thinking model
CAL_SPIKE=.spike/gate/ctl CAL_MAX_TOKENS=2400 \
  node tools/model-probes/gate.mjs http://127.0.0.1:47831/v1 iq3_s control-iq3_s \
  --out .spike/gate/run-control-iq3_s.json

# candidate (A4000) — ~3 min, 24 prompts
CAL_SPIKE=.spike/gate/cand CAL_MAX_TOKENS=2400 \
  node tools/model-probes/gate.mjs http://127.0.0.1:1234/v1 mistralai/ministral-3-14b-reasoning \
  candidate-ministral-q6k --out .spike/gate/run-candidate-ministral.json

# re-score both with the CURRENT scorer (no prompts spent) and get the paired McNemar
CAL_SPIKE=.spike/gate/ctl node tools/model-probes/gate.mjs http://127.0.0.1:47831/v1 iq3_s control-iq3_s \
  --rescore .spike/gate/run-control-iq3_s.json --out .spike/gate/rescore-control
CAL_SPIKE=.spike/gate/cand node tools/model-probes/gate.mjs http://127.0.0.1:1234/v1 mistralai/ministral-3-14b-reasoning \
  candidate-ministral-q6k --rescore .spike/gate/run-candidate-ministral.json \
  --compare .spike/gate/rescore-control.rescored.json --out .spike/gate/rescore-candidate
```

The corpus rebuilds itself from `git` and the working tree on every invocation, re-proves each mutant by
execution, and prints the `PROOF …` lines quoted in §3 — so a reader on another clone of this repo gets the same
8 items, and gets a loud `NOTE` plus a missing item rather than a silently different corpus if a file moved.

## 9. Whole-module feasibility at the verifier's context ceiling — measured 2026-10-28T00:30Z

ROADMAP 195 says a control should be shown as the **whole module** "whenever the context budget allows it
(which for the A4000 verifier means ≤ ~12k tokens), so the module must fit — say so, and fail loudly when it does
not". Before deciding what is even possible, the budget was measured rather than assumed.

**What the gate actually sent** (read out of both transcripts, 24 prompts each):

| model | max prompt tokens | median |
|---|---|---|
| candidate `ministral-3-14b-reasoning` | **2,942** | 941 |
| control `local/iq3_s` | **2,961** | 1,018 |

**What each corpus file would cost whole** (`wc -c` / 4 — code tokenises *worse* than 4 chars/token, so treat
these as lower bounds), against the verifier's declared **13,273** context and its measured **HTTP 400 above
~12k** (D137):

| file | items | ≈ tokens | whole-module today? |
|---|---|---|---|
| `src/textwidth.mjs` | M1 | 2,491 | yes |
| `src/job-object.mjs` | H2 | 3,229 | yes |
| `src/driver.mjs` | M3 | 3,514 | yes |
| `scripts/clockin.mjs` | H5 | 3,866 | yes |
| `src/confine.mjs` | M2 | 8,401 | borderline — likely over once tokenised; must be *probed*, not assumed |
| `src/rig.mjs` | H3, H4 | 17,133 | **no** |
| `src/worktree.mjs` | H1 | 17,633 | **no** |

So the de-artifacting experiment is runnable **now** for 4 of 8 items, with `confine.mjs` decided by a live
400-not-400 probe, and **H1/H3/H4 structurally excluded** at this context. Raising the verifier's context (q8_0 KV
halves the KV cost per token) is an operator action on an LM Studio instance the delegate does not touch.

**One artifact disappears by construction:** the `__durig_probe__` header exists only because a fragment needed a
wrapper to parse. Show `src/textwidth.mjs` whole and there is no synthetic function, no `width` declared outside
the window, and therefore no scaffold for the model to (correctly) complain about — which is precisely the claim
this session had to excuse by hand.

## 10. Whole-module controls (195), measured 2026-10-28T00:40–01:05Z — the false alarms survive, and the defect axis does not replicate

The question §9 set up was single and checkable: **is the `FALSE-ALARM 8/8` of §5c a property of the two model
families, or of my windowing?** The branch was pre-registered in `docs/NEXT.md` before this session started — if
the false alarms survive whole modules, the finding is about **how a verifier seat is fed**, and it goes to the PM
as a queue item rather than being fixed by the delegate. **They survive.**

**What was built** (delegate's apparatus, `tools/model-probes/`): `--whole-module` feeds the **entire module** —
for a `hist` item the whole pre-fix file and the whole post-fix file, for a mutant the whole mutated file and the
whole `main` file — and prints a loud `SKIP <item>: whole module ≈N tok > budget` for anything that does not fit,
instead of quietly falling back to a window. `--plan` prints the fit decision for every item **before a single
prompt is spent**. `--probe` sends the whole module at `max_tokens: 1` so fit is decided **400-or-not, not by
assumption** (195's own word). `--material answer|answer+reasoning` makes the scoring material a declared,
printed, identical-for-both-models setting (197's measure, first half). `corpus.mjs` gained `wholeTexts()` and
`estimateTokens()`. `gate-side-by-side.mjs` is new and tracked, because four transcripts compared by hand in a
chat is exactly how a denominator error hides.

**The token estimator is calibrated on paid-for data, not guessed.** Reading the recorded `usage.prompt_tokens`
of the 2026-10-27 transcripts against the exact text each turn sent: **0.2588–0.3244 tok/char** for
`ministral-3-14b-reasoning`, **0.2604–0.3609** for `local/iq3_s`. So `estimateTokens` uses **2.7 chars/token
(0.370 tok/char)** — deliberately above the worst measured ratio, so a module it calls too big was never close.
Live whole-module costs measured this session (candidate endpoint, `max_tokens: 1` probe + the real runs):

| item | module | whole-module chars (defect → clean) | est (2.7 c/tok) | **measured prompt tok** | in the 12,500-est-token arm? |
|---|---|---:|---:|---:|---|
| M1 | `src/textwidth.mjs` | 9,960 → 5,628 | 3,689 | **2,961** | yes |
| H2 | `src/job-object.mjs` | 12,166 → 10,051 | 4,506 | **3,923** | yes |
| M3 | `src/driver.mjs` | 14,023 → 4,561 | 5,194 | **3,741** | yes |
| H5 | `scripts/clockin.mjs` | 13,822 → 11,039 | 5,120 | **4,465** | yes |
| M2 | `src/confine.mjs` | 33,535 → 14,961 | 12,421 | **9,618** | yes — accepted on the live probe, 400-not-400, not assumed |
| H3 | `src/rig.mjs` | 57,993 → 33,872 | 21,479 | (not attempted) | **SKIP** |
| H4 | `src/rig.mjs` | 58,380 → 33,956 | 21,623 | (not attempted) | **SKIP** |
| H1 | `src/worktree.mjs` | 69,702 → 31,097 | 25,816 | (not attempted) | **SKIP** |

`§9`'s `wc -c / 4` lower bounds were **too pessimistic for `confine.mjs`** (it predicted "borderline — likely
over"; it fits with ~1k tokens of headroom inside the declared 13,273 after reserving 2,400 for the answer) and
**too optimistic per-item** for everything else. So the whole-module arm is **5 items, not 4**; three items remain
structurally excluded until the operator raises the verifier's context (q8_0 KV halves the KV cost per token;
LM Studio owns that instance and the delegate did not touch it).

**Side by side — same corpus, same scorer, same `answer`-only material for both models, `temperature 0.2`,
`CAL_MAX_TOKENS=2400`, both models already resident, zero download:**

| arm | defect mechanisms named | false alarms, leading | false alarms, neutral | excerpt-artifact excuses |
|---|---|---|---|---|
| control `local/iq3_s`, fragments | **4/8** | 8/8 | 8/8 | 4 turns made absent-binding claims |
| control `local/iq3_s`, **whole modules** | **2/5** | **5/5** | 4/5 (1 AMBIGUOUS) | **0** — there is no excerpt to blame |
| candidate `ministral-3-14b-reasoning`, fragments | **3/8** | 8/8 | 8/8 | 3 turns made absent-binding claims |
| candidate `ministral-3-14b-reasoning`, **whole modules** | **3/5** | **5/5** | **5/5** | **0** |

1. **The excerpt artifact was real, and it is not what was making the models cry wolf.** In fragment mode the
   control made an absent-binding claim in **4** clean-control turns and the candidate in **3** — and whole-module
   mode produced **zero** such turns for either family, which is the direct proof that those claims were about my
   window (the import block is on the page in whole mode). Removing the confound moved the false-alarm rate by
   **exactly one cell out of fifteen per model** (control neutral 5/5 → 4/5, one cell reclassified AMBIGUOUS):
   paired McNemar on the shared 5 items gives **0/0 discordant for both families on the leading prompt, p = 1.000**.
   **So the standing caveat in D138 — "no false-alarm number is quotable until controls are whole modules" — is
   discharged, and the number it was protecting is the same number.** A model that is shown a *whole, correct,
   import-carrying module of its own repository's language* and told "is there a defect here? it may be correct as
   written" still asserts a defect, **5 times out of 5, both families, both framings.**
2. **That is now a verification-design finding, not an instrument artifact.** It survives the one treatment that
   could have explained it away. It goes to the PM (drafted ask quoted in `docs/NEXT.md`), because the thing to
   change is how a verifier seat is prompted and **when a refusal is admissible**, which is the team's design call,
   not the delegate's fix.
3. **The defect axis does not replicate, and this is the sharper result.** Two independent fragment runs of the
   **same model, same corpus, same scorer, same scoring material** (`run-candidate-ministral.json` vs
   `run-candidate-fragment-fresh.json`, rescoring both identically): the aggregate reproduced exactly — **3/8 both
   times** — but **4 of 8 defect cells flipped**: `H4 HIT→MISS`, `M1 HIT→MISS`, `M2 MISS→HIT`, `M3 MISS→HIT`
   (2/2 discordant, p = 1.000). The **false-alarm axis replicated perfectly** (8/8 in both runs, both framings).
   The between-model gap the gate has been used to rank on (4/8 vs 3/8, 4/3 discordant) is therefore **no larger
   than one model's own run-to-run movement on the same items.** The 4-vs-3 is not weak evidence of a difference;
   on this corpus it is indistinguishable from the instrument's own noise floor. Registered as **ROADMAP 198**.
4. **What this does to the routing question.** On the whole-module arm the candidate is *nominally* ahead
   (3/5 vs 2/5) — the sign of §5c, reversed — with **1 discordant pair, p = 1.000**, and the control naming only
   **2 of 5** means rule **G2** ("the control must name ≥ 4/8, else the instrument cannot rank") is not met *in
   that arm either*. So: **no family ranking is available from either arm**, and **no seat is flipped; the
   operator's D137 ruling stands unchanged.** If the gate is ever to rank families it needs **replication
   (majority-of-k, and the replication rate printed)** and **more items** — not another prompt against the same
   eight.

**Reproduce §10.**

```bash
# the fit decision, free
CAL_SPIKE=.spike/gate/cand node tools/model-probes/gate.mjs http://127.0.0.1:1234/v1 \
  mistralai/ministral-3-14b-reasoning plan --whole-module --budget 12500 --material answer --plan
# control, whole modules (15 prompts) and candidate, whole modules (15 prompts)
CAL_SPIKE=.spike/gate/ctl  CAL_MAX_TOKENS=2400 node tools/model-probes/gate.mjs http://127.0.0.1:47831/v1 \
  iq3_s control-iq3-whole        --whole-module --budget 12500 --probe --material answer --out .spike/gate/run-control-whole.json
CAL_SPIKE=.spike/gate/cand CAL_MAX_TOKENS=2400 node tools/model-probes/gate.mjs http://127.0.0.1:1234/v1 \
  mistralai/ministral-3-14b-reasoning candidate-ministral-whole \
  --whole-module --budget 12500 --probe --material answer --out .spike/gate/run-candidate-whole.json
# the four-cell comparison and the paired tests (transcripts are gitignored; this section is the record)
PAIRS='[["control: fragment vs whole",0,1],["candidate: fragment vs whole",2,3],["WHOLE arm: control vs candidate",1,3],["FRAGMENT arm: control vs candidate",0,2]]' \
  node tools/model-probes/gate-side-by-side.mjs --pairs .spike/gate/ctl-frag.rescored.json .spike/gate/run-control-whole.json \
    .spike/gate/run-candidate-fragment-fresh.json .spike/gate/run-candidate-whole.json
```

**Limits of §10, stated before anyone re-quotes it.** n = 5 per whole-module arm, and 3 of the 8 items can never
be shown whole at this verifier context, so the arm is biased toward **small modules** — `rig.mjs` and
`worktree.mjs`, this rig's two biggest and most defect-bearing files, are excluded by the operator's context
setting, not by the corpus. Single replicate per condition at `temperature 0.2` — which §10.3 shows is not nothing.
Scoring material is `answer` only for both models, so the control is scored on less than it produced (its endpoint
does emit a reasoning trace; LM Studio emits none for the candidate) — that asymmetry is 197 and is *not* fixed by
this section, only made visible and declared. `AMBIGUOUS` is reported, not folded into either rate.

**And one asymmetry this session found in its own pair, registered as ROADMAP 199.** `corpus.mjs` documents that
**defect texts keep their comments and clean controls have comment-led lines stripped** (a post-fix region carries
the fix's own commentary, which would spoil the control). At fragment scale that cost a few lines. At whole-module
scale it is most of the file: the byte counts in the table above move **−17% to −67%** between the two conditions
of the *same* item (`src/driver.mjs` 14,023 → 4,561; it is genuinely 137 comment-led lines of 254), so the "matched
pair" a whole-module item shows is **not byte-matched** — the defect version is a documented file and the clean
version is the same file with its documentation removed. Both sides still pass `node --check` (stripping did not
break a single one of the 16 whole-module texts), so this is a **design confound, not a corruption**, and its effect
on the verdicts is **unmeasured**: it is a candidate explanation for the control's whole-module hits falling 4/8 →
2/5 and must be settled by stripping both sides identically (or neither) and re-running, not argued.

## 11. Replication (198) and symmetric pairs (199), measured 2026-10-28T01:45–02:35Z — the defect axis collapses when you look at it twice; the false-alarm axis does not

**What landed in the instrument first.** `gate.mjs --replicate k` runs the whole matrix k times, rotating which
condition is answered first across passes (counterbalanced within a pass, rotated between them, so a replicate
cannot carry an order effect), and scores the **majority-of-k cell**: a cell counts only if a strict majority of
passes agree, else it is `UNSTABLE` and named. It prints per-cell verdicts, the **unanimous-cell rate per axis**,
the spread across replicates, and the **G2 floor under both the majority pass and the worst replicate** — because
"a floor met in one draw" is the thing G2 was supposed to guarantee. `--pair-comments strip-both|keep-both|
strip-clean-only` (199) makes the comment treatment of a pair a declared setting, and `--plan` now prints a
**matched-pair accounting** table per item. Transcripts are rewritten **after every item** (a k=3 whole-module arm
is ~45 prompts and 20–45 min of the operator's GPU; losing one to an interrupted session is not acceptable) and
carry `pairPolicy`, `reps`, `cells`, `majority` and `complete`. `gate-side-by-side.mjs` prints **which row scored
each cell** ("majority row", "cell table agreement 2/3", or "single-pass"), because a comparison that quietly takes
a replicate run's *last* row is 198's defect wearing a new hat — that sourcing bug was found and fixed while
writing this section, and it had already moved one comparison I nearly quoted.

**A bug worth recording, because it is the kind that silently deletes evidence.** My first comment stripper was a
line regex. It also matches lines **inside multi-line template literals**, and in `src/worktree.mjs` and
`src/rig.mjs` three such lines (`* remove` is NOT a substitute…`, `// --show-toplevel` returns…`,
`* "queued"` alone…`) carry the backtick that **closes** the template — so stripping them unbalances the module,
it stops parsing, and under a *symmetric* policy the guard drops the item. Measured: 2 lines in `worktree.mjs`, 1
in `rig.mjs`. (`#` is deliberately not treated as a comment: in a `.mjs` a leading `#` is a class-private field.)
`corpus.mjs` now uses `commentLedMask()`, a small state machine over block comments, templates and `${}`. And a
policy that breaks a text **downgrades the item symmetrically** to `keep-both` with a loud NOTE — symmetry
outranks the policy, and neither side may be silently smaller than the other.

### 11.1 What the pairs actually weigh (199) — no prompts spent

| item | file | raw bytes defect → clean | delta | what `strip-both` leaves shown | comment share defect/clean | clean-side comment lines carrying this item's own rubric words |
|---|---|---|---|---|---|---|
| M1-cell-budget-off-by-one | `src/textwidth.mjs` | 9,960 → 9,956 | **−4 B (0.0%)** | 5,632 / 5,628 | 43.5% / 43.5% | 35 |
| M2-regex-word-boundary-overreach | `src/confine.mjs` | 33,535 → 33,542 | **+7 B (0.0%)** | 19,273 / 19,280 | 42.5% / 42.5% | 51 |
| M3-pause-still-claims | `src/driver.mjs` | 14,023 → 14,034 | **+11 B (0.1%)** | 4,550 / 4,561 | 67.6% / 67.5% | 38 |
| H3-truthy-sentinel-dead-code | `src/rig.mjs` | 57,993 → 58,380 | +387 B (0.7%) | 56,073 / 56,460 | 3.3% / 3.3% | 1 |
| H1-npm-invocation | `src/worktree.mjs` | 69,702 → 70,344 | +642 B (0.9%) | 59,437 / 60,079 | 14.7% / 14.6% | 41 |
| H4-doc-proxy-escape | `src/rig.mjs` | 58,380 → 58,980 | +600 B (1.0%) | 56,460 / 57,060 | 3.3% / 3.3% | 1 |
| H2-process-death-deadline | `src/job-object.mjs` | 12,166 → 12,905 | +739 B (6.1%) | 11,057 / 11,796 | 9.1% / 8.6% | 1 |
| H5-block-local-helper-swallowed | `scripts/clockin.mjs` | 13,822 → 15,442 | +1,620 B (11.7%) | 11,190 / 12,810 | 19.0% / 17.0% | 0 |

**A "matched pair" now differs by the fix or the mutation and a handful of bytes** — §10's −17.7%…−68.8% clean-side
shrinkage is gone. The costs are also printed rather than argued: stripping leaves **32.4%** of `driver.mjs`
(67.6% of it is comments) and 57.5% of `confine.mjs`, and it is cheap in prompt terms — measured prompt tokens per
whole-module turn fall from 9,804 → 6,080 (`confine`, control), 3,775 → 1,446 (`driver`, control), 9,618 → 5,873
and 3,741 → 1,356 (candidate). It does **not** unlock the three excluded items: `rig.mjs` estimates 20,768/20,912
and `worktree.mjs` 22,014 tokens against a 12,500 budget, so the whole-module arm is still **5 of 8 items**.
The `keep-both` column is the reason the default is symmetric-stripped: the *clean* side of a post-fix file carries
the fix's own commentary — 41 such lines at H1 (e.g. `// nothing was giving them one - so before this they worked
in durig's LIVE tree`), 51 at M2, 38 at M3, 35 at M1 — and the item's rubric vocabulary in a control is a leak.
That count is a **proxy** (it matches the item's rubric/phantom phrases, incidental matches included), so it is
printed per item on every `--plan` rather than argued here.

### 11.2 What the pair treatment did to verdicts (same family, same mode, same scorer, `answer` material)

| arm | §10 (asymmetric pair, k = 1) | this section (symmetric pair, majority of 3) | flips | McNemar exact |
|---|---|---|---|---|
| control, fragment | 4/8 named | **4/8** | 2 (`H4 HIT→MISS`, `M2 MISS→HIT`) | 1/1, p = 1.000 |
| candidate, fragment | 3/8 named | **0/8** | 3 (`H2`, `M2`, `M3`) | 3/0, p = 0.250 |
| control, whole module | 2/5 named | **1/5** | 1 (`M2`) | 1/0, p = 1.000 |
| candidate, whole module | 3/5 named | **1/5** | 2 (`M1`, `M2`) | 2/0, p = 0.500 |

The pair treatment moves **cells**, never the false-alarm rate (0/0 discordant in all four comparisons, p = 1.000).
The aggregate movements on the defect axis are **not separable from replicate noise** (§11.3 shows one family
spanning 2/8–5/8 on the *same* settings), and none of them reaches significance at n = 5 or n = 8.

### 11.3 Replication measured (198) — four arms × three passes

| arm (symmetric pairs, `answer`, k = 3) | defect named, pass 1 / 2 / 3 | majority-of-3 | unanimous defect cells | unanimous control cells |
|---|---|---|---|---|
| control `local/iq3_s`, fragment | **2/8, 4/8, 5/8** | **4/8** | 5/8 | 16/16 |
| candidate `ministral-3-14b-reasoning`, fragment | **0/8, 0/8, 2/8** | **0/8** | 6/8 | 16/16 |
| control `local/iq3_s`, whole module | **2/5, 1/5, 1/5** | **1/5** | 2/5 | 9/10 (one cell `FALSE-ALARM×2 + AMBIGUOUS`) |
| candidate `ministral-3-14b-reasoning`, whole module | **3/5, 1/5, 1/5** | **1/5** | 3/5 | 10/10 |

Paired on the majority cells: **fragment arm control 4/8 vs candidate 0/8, discordant 4/0, exact p = 0.125**;
**whole-module arm 1/5 vs 1/5, discordant 1/1, p = 1.000**. G2's floor is not replicate-stable: the control's
fragment majority pass **4/8 MET** while its **worst replicate 2/8 NOT MET**, and in the whole-module arm the
control names **1/5** against a floor of 4 — so that arm has **no calibration floor at all**.

**11.4 The false-alarm axis, pooled and replicated: 78/78 and 77/78.** Across all four arms × three passes × both
families, control turns that asserted a defect on clean code: **78 of 78** under the leading prompt and **77 of 78**
under the neutral prompt (the exception scored `AMBIGUOUS`, not `CLEAN-PASSED`). Not one clean control in 156 turns
was called clean. Whole modules, matched pairs, three replicates, declared `answer`-only scoring — §10's number
survives every control this session could build, and the artifact counts move the way 195 said they would
(6 absent-binding turns in the fragment arm, 0 in the whole-module arm).

**11.5 What this settles about the routing question, and what it does not.** Under a symmetric corpus and k ≥ 3 the
gate **cannot rank these two families**: the whole-module arm ties at 1/5 (p = 1.000) and the fragment arm's
4/8-vs-0/8 gap does not reach significance (p = 0.125) with 3 of 8 control cells unstable. D137's ruling — do not
route `qa`/`qa2`/`auditor` at the candidate — stands unaltered, and its *direction* is now a little better
supported (every arm's majority favors the control family on defect-naming), while its *magnitude* remains
unproven. Nothing changed about the candidate's false-alarm behaviour: it is 5/5 or 8/8 in every cell of every pass,
which is a property of the task, not of the family — still the item for the PM, not a reason to pick a model.

**11.6 Limits, stated before anyone re-quotes §11.** Majority-of-3 over 5–8 items is fragile: a cell flips when two
of three passes disagree, and **6 of 26 defect cells were not unanimous**. `answer`-only scoring (197 declared, not
resolved); `temperature 0.2`, not 0; the whole-module arm still excludes `H1`/`H3`/`H4`, so it remains biased to
small modules; the corpus is **8 items with 3 execution-proved mutants**, and **n is now the binding constraint on
every claim in this section** — that is ROADMAP **200**, and it makes 194 ("more items") the highest-value corpus
work. Cost, for budget honesty: 156 model turns (4 arms × 3 passes × ~13 turns), measured ≈ 26 s/turn for the
control on comment-free fragments, ≈ 55 s/turn on whole modules, ≈ 15–20 s/turn for the candidate — about 90
minutes of the operator's GPU across the two already-resident servers, **no download, no server restarted, no seat
touched**. Transcripts: `.spike/gate/k3-{ctl,cand}-{frag,whole}.json`; reproduce with the commands in §11.7.

### 11.7 How to reproduce §11 exactly (native Linux, both servers already resident)

```bash
# 199's accounting, free — and the leak that `keep-both` would put into a control:
node tools/model-probes/gate.mjs <base> <model> plan --whole-module --budget 12500 --material answer --plan
# the four arms (drop --replicate 3 to see the NOTE 198 line that labels a single pass a sample):
CAL_SPIKE=.spike/gate/ctl  CAL_MAX_TOKENS=2400 node tools/model-probes/gate.mjs http://127.0.0.1:47831/v1 iq3_s \
  ctl-frag-k3  --material answer --replicate 3 --out .spike/gate/k3-ctl-frag.json
CAL_SPIKE=.spike/gate/ctl  CAL_MAX_TOKENS=2400 node tools/model-probes/gate.mjs http://127.0.0.1:47831/v1 iq3_s \
  ctl-whole-k3 --whole-module --budget 12500 --probe --material answer --replicate 3 --out .spike/gate/k3-ctl-whole.json
CAL_SPIKE=.spike/gate/cand CAL_MAX_TOKENS=2400 node tools/model-probes/gate.mjs http://127.0.0.1:1234/v1 \
  mistralai/ministral-3-14b-reasoning cand-frag-k3  --material answer --replicate 3 --out .spike/gate/k3-cand-frag.json
CAL_SPIKE=.spike/gate/cand CAL_MAX_TOKENS=2400 node tools/model-probes/gate.mjs http://127.0.0.1:1234/v1 \
  mistralai/ministral-3-14b-reasoning cand-whole-k3 --whole-module --budget 12500 --probe --material answer \
  --replicate 3 --out .spike/gate/k3-cand-whole.json
# then the paired tests, which report which row scored each cell:
PAIRS='[["FRAGMENT: control vs candidate",0,1],["WHOLE: control vs candidate",2,3]]' \
  node tools/model-probes/gate-side-by-side.mjs --pairs .spike/gate/k3-ctl-frag.json .spike/gate/k3-cand-frag.json \
  .spike/gate/k3-ctl-whole.json .spike/gate/k3-cand-whole.json
```
