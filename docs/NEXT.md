# durian-pi — NEXT (current pointer)

> Older sessions moved VERBATIM to [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md) — original order, no edits.
> This file is the live pointer plus the current session: everything from the `2026-10-27T21:55Z` session back
> lives in the archive. The cut is proven by concatenation (see `docs/DECISIONS.md` D126, D129, D138).

## NEXT SESSION (2026-10-27T23:20Z — CLOCK-OUT: THE CAPABILITY GATE WAS REBUILT, AND THE NUMBER D137 ROUTED ON DID NOT SURVIVE IT — THE RULING STANDS, THE BASIS DOES NOT)

> Archive: older sessions live VERBATIM in `docs/NEXT-ARCHIVE.md` (the digest quotes this block, so the
> link has to be inside it — `demo/clockin-digest.test.mjs` checks that it is).
>
> **Label honesty:** these labels mark *sessions*, not a timeline — do not infer order or recency from them. This
> block is cut at `23:20Z`; the block below it in the archive was labelled `21:55Z`.

**Current item:** ROADMAP **189** (cross-family verification) — provider built and resident (D134), **no seat
flipped** (D137), and the *measurement* that item turns on is now rebuilt: **`tools/model-probes/corpus.mjs`** (8
defect items — 5 lifted from `git show <fix>^:<file>`, 3 mutants whose non-equivalence is re-proved by differential
execution on every build) and **`tools/model-probes/gate.mjs`** (3 conditions per item: defect / matched clean /
neutral-prompted clean, rubric mechanism-groups, pre-registered phantom patterns, McNemar exact, `--rescore` so a
scorer change never costs another 24 prompts). `calibrate-verifier.mjs` is **superseded**, kept only because D137
cites its numbers. Registered this session, not scheduled: **194** (the gate is 189's measure), **195** (fragment
controls manufacture their own false alarms), **196** (an unconditional artifact drop discards correct answers),
**197** (a reasoning trace for one model and none for the other is not a comparison). Already registered: 190,
191, 192, 193, memory/security 161–184. **The delegate claimed, completed, deferred and routed nothing.**

**The baseline, re-measured at 22:58Z — all three matched the archived expectations:** `node scripts/test.mjs` →
**238/238 passed in 41.0s**; `DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json` → **`pass: true`, 0
errors, 62 fix-now**, `single-model-rig` **still present** (honest red, not an unfinished step); `… node cli.mjs
status` → broker **down** (`{"state":"down","reason":"no broker state"}`), attention pm/impl/lead/devtools/qa2.

**The measurement that moved the record (D138).** 8 items × 3 conditions = 24 prompts per model, both models
already resident, `CAL_MAX_TOKENS=2400`, **zero download and zero operator action**. Scored on the *same material*
for both (answer only — LM Studio returns no `reasoning_content` for the candidate, D137):

| | control `local/iq3_s` | candidate `ministral-3-14b-reasoning` Q6_K |
|---|---|---|
| defect mechanisms named | **4/8** | **3/8** |
| clean controls, leading prompt | FALSE-ALARM **8/8** | FALSE-ALARM **8/8** |
| clean controls, neutral prompt | FALSE-ALARM **8/8** | FALSE-ALARM **8/8** |

**Paired (McNemar exact, on the 8 shared items): 1 hit each way → p = 1.000.** Full record and per-item tables:
`docs/reviews/verifier-gate-hardening-2026-10-28.md` §5; decision: `docs/DECISIONS.md` **D138**. Transcripts are
under gitignored `.spike/gate/`, so the quoted `SUMMARY` blocks in §5 are the quotable record and §8 of that file
reproduces them.

**What that means, precisely.** (1) D137's `1/2 vs 0/2` was **one discordant pair at n = 2**; the bar this session
pre-registered before any score existed (**≥ 6 one-sided discordant pairs at n = 8**) is not met in *either*
direction, so the gate **cannot separate these two families** — that is the headline, and it is a negative result.
(2) The candidate still fails rule **G3** (3/8 is not strictly greater than 4/8; it ties on false alarms), so
**still no seat is flipped and the operator's D137 ruling is not reopened** — only its stated basis is corrected
from "measured worse" to "not demonstrated better". (3) The stronger finding is about **this rig**: on *fragment*
controls **both** families asserted a defect on every item, under both prompt framings, and at least two of the
control's eight are **provably my windowing** — it called `scripts/clockin.mjs` "missing Node built-in imports"
while `scripts/clockin.mjs:27-30` holds exactly those imports, and it reported a defect in `__durig_probe__`, which
is *my synthetic function header*. "A verifier that cries wolf" is therefore not attributable to option (a) alone;
it is what happens when you ask a reasoning model for a bug in a fragment. That is a **feed-the-verifier** design
finding, not a model finding.

**Three instrument bugs found mid-run, each of which moved the answer** (recorded so nobody re-derives them):
a rubric phrase `"+ 1"` compiled as a **regex crashed the candidate run** at item 5; `scoreDefect` read
`item.phantom` while items expose `phantoms`, silently disabling phantom detection; and the unconditional artifact
rule **discarded the control's correct naming of the injected off-by-one** ("`sliceToWidth` has an off-by-one
(`cells + 1`)") and collapsed its clean denominators to `0/0`. Both scoring regimes are reported in §5b — regime A
said "control clearly ahead (5/5 vs 3/8)", regime B says "indistinguishable (p = 1.000)". The second is the one
that is fair to both models.

**Machine state, measured 22:58Z — unchanged from the archived block.** Primary (Strata
`0.1.50-linux-x86_64-cuda-cuda13`, pid 493568) holds **20,856 MiB on the 3090 alone**; the verifier (LM Studio's
`llama-server`, pid 649504, `Ministral-3-14B-Reasoning-2512-Q6_K`) holds **13,388 MiB of the A4000** (2,577 MiB
free). `durig.config.json` (gitignored) still points the verifier env at `mistralai/ministral-3-14b-reasoning`
(context 13,273; HTTP 400 above ~12k tokens; q8_0 KV would halve that), and `rig.selfdev.json` (tracked) still
carries `local/iq3_s` for all 12 seats. **Nothing was restarted or reconfigured.**

**Blocker:** three operator rulings, none of them a build, none of them changed by this session except the *reasoning*
behind the first:

1. **Which verifier family.** **(a)** Ministral 3 14B Q6_K — operationally perfect, **not routed (D137)**; this
   session's honest status is *not demonstrated better, not demonstrated worse* (p = 1.000). **(b)**
   `unsloth/Devstral-Small-2-24B-Instruct-2512-GGUF` UD-Q3_K_XL, **11.85 GB** — the survey's best code-agent
   evidence at this size, **unmeasured**; gate it with **`gate.mjs`, not `calibrate-verifier.mjs`**. **(c)** Flint —
   does not fit (31.05 GB / 40.21 GB routed-expert weights vs 34 GiB free RAM; GGUF census = arithmetic) and
   PolyStrata, not LM Studio, is its engine. **(d)** the 189 alternative: keep author seats on `local/iq3_s`, put a
   verifier seat back on a **remote** family (`DEEPINFRA_API_KEY` + balance). The cheap measurement that would make
   this choice real is **195 (whole-module controls) + more items (194)**, then a ~3-minute re-run against the
   already-resident candidate — no download needed to try that first.
2. **Evidence binding (190)** — durable records cite store-native `entries.id`, not machine-local git objects?
   Decides how memory 165/167 and substrate 170 are written.
3. **`#4785` was marked `done` with no artifact anywhere** (`500969f42` never existed on the Windows rig either).
   A detector for "a completion without an artifact" is a design question, still unregistered.

**Queue work awaiting the operator, not the delegate:** the 4 stale citations (one-line amendments to the landing
commits `eb7e69c1e`→`ce79c354`, `0c6fd7665`→`0c6fd76e465`; `5d8c6237a` is context held on #2788) and the answered
parked questions in `docs/reviews/parked-questions-2026-10-26.md`. Both are `pm` transitions; the broker is down and
the delegate has spooled nothing.

**Still in the tree, not the delegate's, not landed:** `@earendil-works/pi-coding-agent` `1.3.0` → `^1.3.0`
(silently reverses the deliberate exact pin of `e5e9e79`, #2969), `package-lock.json` rewritten with that one
semantic line among 1,578 EOL-only lines (`.gitattributes` deliberately sets no repo-wide `eol=lf`, D83), and
`pnpm-lock.yaml` + `pnpm-workspace.yaml` untracked since 2026-10-26 20:42. `node_modules` resolves pi **1.3.0**, so
the 238/238 above was measured against the pinned build. The delegate touched none of it. `.scratch/` is untracked
but **not** gitignored (only `.spike/` is); the model probes are tracked under `tools/model-probes/` with a
`README.md`, because a durable survey that cites scripts no clone contains is ROADMAP 190's own failure mode.

**Exact next command** (baseline, then the rebuilt gate against the resident candidate):

```bash
DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json
node scripts/test.mjs
CAL_SPIKE=.spike/gate/cand CAL_MAX_TOKENS=2400 \
  node tools/model-probes/gate.mjs http://127.0.0.1:1234/v1 mistralai/ministral-3-14b-reasoning \
  candidate-ministral-q6k --out .spike/gate/run-candidate-ministral.json
```

Expected: **`pass: true`, 0 errors, 62 fix-now, `single-model-rig` present**; **238/238 in ~41 s**; then the gate
prints `CORPUS: 8 items`, three `PROOF …` lines (clean output ≠ mutant output), 24 verdicts in ~3 min, and a
`SUMMARY` whose defect-named line should reproduce **3/8** unless the corpus changed — if it does not reproduce,
the corpus moved under the scorer and that is the first thing to chase.

**Do not:** route `qa`/`qa2`/`auditor` at `ministral-3-14b-reasoning` (G3 fails, D137 stands); quote an **8/8
false-alarm rate as decision-grade before 195 lands** — fragment controls inflate it for both families, provably
(`scripts/clockin.mjs:27-30`); rank families with `calibrate-verifier.mjs` (n = 2, no controls, superseded by
D138); trust any number from "regime A" (unpaired, reasoning-asymmetric, `docs/reviews/…-gate-hardening-…md` §5b);
treat a `single-model-rig` clearing as cross-family verification (`src/checkup.mjs:594` compares strings); run
`up`/`send`/`run`/`complete` before re-taking the worktree/branch/`.spike` inventory into `.spike/` and diffing it
after (`AGENTS.md` clock-in step 7, `docs/runbooks/workspace-move.md`); run `git add -A`; use `DURIAN_PI_DB` for the
CLI (it is `DURIG_DB`); measure the suite with a serial hand-loop (D135); compute throughput from a non-streaming
call (D136); restart or reconfigure the operator's LM Studio / Strata instances unasked; revert the dependency
relaxation (the operator's call); or start broker work on this workspace — the store is intact but its git history
is only partially here (`git cat-file -t 78991031` fails; the docs' own baseline sha is not an object in this clone).
