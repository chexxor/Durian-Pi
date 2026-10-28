# durian-pi — NEXT (current pointer)

> Older sessions moved VERBATIM to [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md) — original order, no edits.
> This file is the live pointer plus the current session: everything from the `2026-10-28T01:35Z` session back
> lives in the archive. The cut is proven by concatenation (byte-identical tail of the archive, 12,929 B for the
> block moved this session) and by `git log -p docs/NEXT.md` — see `docs/DECISIONS.md` D126, D129, D138, D139, D140.

## NEXT SESSION (2026-10-28T03:05Z — CLOCK-OUT: 198 + 199 RAN — THE GATE CANNOT RANK THESE FAMILIES, AND THE FALSE ALARMS ARE NOW 78/78 POOLED)

> Archive: older sessions live VERBATIM in `docs/NEXT-ARCHIVE.md` (the digest quotes this block, so the
> link has to be inside it — `demo/clockin-digest.test.mjs` checks that it is).
>
> **Label honesty:** these labels mark *sessions*, not a timeline — do not infer order or recency from them.

**Current item:** ROADMAP **189** (cross-family verification). **198** (replication) and **199** (symmetric matched
pairs) are **measured and their instrument fixes landed**; **200** is **registered, not scheduled**: the gate's
binding constraint is now corpus size, and G2's calibration floor is not replicate-stable. Provider built and
resident (D134), **no seat flipped** (D137 — D138/D139/D140 did not reopen it). Already registered: 190–199,
memory/security 161–184. **The delegate claimed, completed, deferred and routed nothing.**

**The measurement (D140; full record `docs/reviews/verifier-gate-hardening-2026-10-28.md` §11).** Four arms —
control `local/iq3_s` and candidate `mistralai/ministral-3-14b-reasoning`, fragment and whole-module — at **k = 3**
with **symmetric pairs**, `answer`-only scoring, `CAL_MAX_TOKENS=2400`, temp 0.2, 156 model turns, ~90 min GPU on the
two already-resident servers, **no download, no restart**:

| arm (symmetric, k = 3) | defect named, pass 1/2/3 | majority-of-3 | unanimous defect cells |
|---|---|---|---|
| control, fragment | 2/8, 4/8, 5/8 | **4/8** | 5/8 |
| candidate, fragment | 0/8, 0/8, 2/8 | **0/8** | 6/8 |
| control, whole module (5 items) | 2/5, 1/5, 1/5 | **1/5** | 2/5 |
| candidate, whole module (5 items) | 3/5, 1/5, 1/5 | **1/5** | 3/5 |

Paired on majority cells: fragment **4/8 vs 0/8, discordant 4/0, exact p = 0.125**; whole-module **1/5 vs 1/5, 1/1,
p = 1.000**. G2's floor (control names ≥ 4 of 8) is **MET in the majority pass, MISSED in the worst replicate (2/8)**.
False alarms, pooled over all four arms × three passes: **78/78** leading-prompt and **77/78** neutral-prompt control
turns asserted a defect on clean code — **no clean control in 156 turns was called clean**. The one axis with signal
is a property of the *task*, not of the family: that ask is the PM's (draft under "Blocker" below, unchanged since
D139, still **not sent**).

**Matched pairs, measured (199).** Pairs now differ by the fix/mutation and **0.0–11.7%** of bytes (`M1` −4 B,
`M2` +7 B, `M3` +11 B, `H2` +739 B, `H5` +1,620 B) instead of §10's −17%…−67%. Symmetry costs bytes the models could
use — `strip-both` leaves 32.4% of `driver.mjs` (67.6% comments) — and measured prompt tokens fall accordingly
(`confine` 9,804 → 6,080 control, `driver` 3,775 → 1,446). It does **not** unlock the three excluded items:
`worktree.mjs` 22,014 est. tok and `rig.mjs` 20,768/20,912 against the 12,500 budget. `keep-both` would leak the fix's
own commentary into the **clean** side — **41 / 51 / 38 / 35** comment lines carrying each item's rubric vocabulary at
H1 / M2 / M3 / M1 — which is why `strip-both` is the default and why the count prints on every `--plan`.

**Two bugs this session found in its own tooling** (both fixed, both cheap to re-trip): (1) a **line-regex** comment
stripper also matches lines *inside multi-line template literals*, and in `src/worktree.mjs`/`src/rig.mjs` three of
them carry the template's **closing backtick** — the module stops parsing and a symmetric policy drops the item;
`corpus.mjs` now uses `commentLedMask()` (block comments, templates, `${}`) and **downgrades a pair symmetrically**
to `keep-both` with a loud NOTE. (2) `gate-side-by-side.mjs` was pairing against **the last replicate** of a
multi-replicate transcript instead of its scored cells; transcripts now persist `majority` rows and the comparison
prints **which row scored each cell** ("majority row" / "cell table agreement 2/3" / "single-pass").

**Baseline, re-measured this session on native Linux** (`Linux Alex-Desktop-Win10 7.2.11-200.fc44.x86_64`):
`DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json` → **`pass: true`, 0 errors, 62 findings**
(`single-model-rig` 1, `verification-without-evidence` 1, `evidence-tree` 1, `citation-unresolvable` 5,
`duplicate-item` 54), `single-model-rig` **still present** — honest red, not an unfinished step. Suite:
**238/238** (marker `.spike/delegate/suite-marker.json`; re-run at the commit you measure — during this session one
full-suite pass showed `demo/broker-stop-audit.test.mjs` FAIL **while two gate runs were hammering the box**, and it
passes alone: contention, not a regression — re-run before quoting). Broker **down**
(`{"state":"down","reason":"no broker state"}`); attention `deferred_awaiting_answer` on pm/impl/lead/devtools/qa2
(#4813 #4354 #4816 #4817 #4814 waiting on human).

**Machine state, measured at clock-out — nothing restarted or reconfigured.** `nvidia-smi`: A4000 13,452 MiB used /
2,577 free; 3090 23,885 used / 271 free (**it got tighter during the k = 3 arms — check before starting anything
else on that GPU**). Verifier = LM Studio `llama-server` on `http://127.0.0.1:1234/v1`
(`mistralai/ministral-3-14b-reasoning`; catalog also lists `recursivesi/flint`). Control = Strata
`http://127.0.0.1:47831/v1`, model id `iq3_s`, label "Qwen3.8-Flash-Next IQ3_S", `"gpus":[1]`. `durig.config.json`
(gitignored) still points the verifier env at Ministral; `rig.selfdev.json` (tracked) still carries `local/iq3_s`
for all 12 seats.

**Blocker:** three operator rulings, none a build — and ruling 1 has changed shape. (1) **Which verifier family.**
The gate can no longer answer this: with matched pairs and k = 3 the two resident families are **indistinguishable**
(1/5 vs 1/5 whole; 4/8 vs 0/8 fragment at p = 0.125, below the pre-registered bar for n = 8). So the remaining cheap
measurement is **more items (194)**, and the family choice now rests on **cost, throughput, context headroom,
availability** — not on a capability score. The Devstral download (option b) would produce exactly the single-pass
number this instrument cannot resolve; Flint (c) still does not fit; a remote family (d) is unaffected by the gate.
(2) **Evidence binding (190)** — durable records cite store-native `entries.id`, not machine-local git objects?
(3) **`#4785` was marked `done` with no artifact anywhere**; a "completion without an artifact" detector is still
unregistered and is your call. **The verifier-design ask drafted in D139 is still unsent** — `intent.mjs` spoofs
operator input and the broker is down, so it stays in `docs/DECISIONS.md`/D139 until you send it or grant it.

**Next thing, in the delegate's own apparatus.** **194 — more items** is now the highest-value corpus work (200 says
why: at n = 8 the largest gap the corpus can produce is 4/0 discordant, p = 0.125, and the pre-registered bar is ≥ 6).
Shape: mine more `git show <fix>^:<file>` historical pairs plus mutants with execution proofs, keep every pair
symmetric (`strip-both`), and expect the whole-module arm to shrink as items get bigger — so 194 should be planned
**together with** the operator's verifier context choice (raising `n_ctx` on the LM Studio instance, or moving the
verifier to a bigger-context family, is what would let `worktree.mjs`/`rig.mjs` be shown whole at all). Second
priority: the **scorer-side spoiling check** 199 actually asked for (detect a control that restates the defect it is
supposed to be free of, mark the item spoiled) instead of deleting text.

**Exact next command** (baseline, then the free pair/fit tables, then the arm that must reproduce):

```bash
DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json
node scripts/test.mjs
CAL_SPIKE=.spike/gate/cand node tools/model-probes/gate.mjs http://127.0.0.1:1234/v1 \
  mistralai/ministral-3-14b-reasoning plan --whole-module --budget 12500 --material answer --plan
CAL_SPIKE=.spike/gate/cand CAL_MAX_TOKENS=2400 node tools/model-probes/gate.mjs http://127.0.0.1:1234/v1 \
  mistralai/ministral-3-14b-reasoning cand-frag-k3 --material answer --replicate 3 \
  --out .spike/gate/k3-cand-frag.json
```

Expected: **`pass: true`, 0 errors, 62 findings, `single-model-rig` present**; **238/238 in ~41 s**; the plan table
printing **8 items, 5 whole + 3 loud `SKIP … whole module ≈N tok > budget 12500`** and a
**MATCHED-PAIR ACCOUNTING** table whose deltas are 0.0–11.7%; then a `REPLICATION (ROADMAP 198)` block whose
fragment-arm candidate majority should land near **0/8 named (spread 0/8, 0/8, 2/8)** with **16/16 unanimous control
cells** — per 198, a one-cell deviation there is **expected noise, not a regression**; chase it only if the SKIP set
changes, the pair deltas move above ~12%, or an axis stops being unanimous on controls.

**Do not:** route `qa`/`qa2`/`auditor` at `ministral-3-14b-reasoning` (D137 stands); **quote any §9/§10 defect count
without the caveat that it was one pass on an asymmetric pair** (§11 supersedes it: same instrument, symmetric pairs,
k = 3 → control fragment 4/8, candidate fragment 0/8, whole 1/5 vs 1/5); treat a defect count as a measurement at
all — the control fragment arm spans **2/8–5/8** across identical passes and G2's floor **moves with the draw**;
download Devstral to settle the family question (it cannot be settled at n = 8); compare a k = 1 transcript to a
k = 3 one without reading which row scored each cell; treat the whole-module arm as a test on large files (`H1`/`H3`/
`H4` are excluded by the operator's 12,500-token setting); run the k = 3 arms without checking free VRAM first
(3090 at **271 MiB** free at clock-out); run `up`/`send`/`run`/`complete` before re-taking the worktree/branch/`.spike`
inventory into `.spike/` and diffing it after (`AGENTS.md` clock-in step 7, `docs/runbooks/workspace-move.md`); run
`git add -A`; use `DURIAN_PI_DB` for the CLI (it is `DURIG_DB`); measure suite throughput with a serial hand-loop
(D135) or compute throughput from a non-streaming call (D136); restart or reconfigure the operator's LM Studio /
Strata instances unasked; revert the dependency relaxation (the operator's call); or start broker work on this
workspace — the store is intact but its git history is only partially here (`git cat-file -t 78991031` fails).

**Still in the tree, not the delegate's, not landed:** `@earendil-works/pi-coding-agent` `1.3.0` → `^1.3.0`,
`package-lock.json`/`package.json` modified, `.scratch/`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` untracked, and
`AGENTS.md` modified by an earlier actor. The delegate touched none of it and committed only its own item's paths
(`tools/model-probes/`, the 2026-10-28 review, `docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/NEXT.md`,
`docs/NEXT-ARCHIVE.md`). Transcripts are gitignored under `.spike/gate/` (`k3-{ctl,cand}-{frag,whole}.json`), so the
tables in §11 are the durable record.
