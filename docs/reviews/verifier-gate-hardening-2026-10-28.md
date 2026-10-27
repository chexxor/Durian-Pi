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
