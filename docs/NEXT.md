# durian-pi — NEXT (current pointer)

> Older sessions moved VERBATIM to [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md) — original order, no edits.
> This file is the live pointer plus the current session: everything from the `2026-10-27T22:05Z` session back
> lives in the archive. The cut is proven by concatenation (see `docs/DECISIONS.md` D126, D129).

## NEXT SESSION (2026-10-27T21:55Z — CLOCK-OUT: THE VERIFIER RAN ITS CAPABILITY GATE AND FAILED IT 0/2, SO THE SEAT FLIP IS NOW AN OPERATOR MODEL CHOICE, NOT AN LM STUDIO SETTING)

> Archive: older sessions live VERBATIM in `docs/NEXT-ARCHIVE.md` (the digest quotes this block, so the
> link has to be inside it — `demo/clockin-digest.test.mjs` checks that it is).
>
> **Label honesty:** this box's clock is synchronised (`timedatectl` → 21:55Z at this writing) and the block cut
> below is labelled `22:05Z`, ten minutes ahead of the commit that preceded it (`3078ba0`, 21:42Z). These labels
> mark *sessions*, not a timeline — do not infer order or recency from them.

**Current item:** ROADMAP **189** (cross-family verification) — built, loaded, **gated, and the gate says stop.**
The provider half is done (D134); a cross-family verifier is resident on the A4000 and calls tools correctly; it
now **scores 0/2 on the seeded-bug calibration against the author family's 1/2 on the same prompts in the same
session (D137)**. So **no seat is flipped**, and `check` still reports `single-model-rig` (fix-now) — now as an
*honest red* rather than an unfinished step. **No queue item is claimed by the delegate** (it never claims,
completes, defers or routes). Built earlier and unchanged: 190 (detection half), 193, the second local provider
(D134), concurrent test runs (D135). Registered and not started: 191, 192, memory/security 161–184.

**The baseline in the cut block is true — re-measured this session, all three matched expectations exactly:**
`node scripts/test.mjs` → **238/238 passed in 41.5s**; `DURIG_DB=./selfdev.sqlite node cli.mjs check
rig.selfdev.json` → **`pass: true`, 0 errors, 62 fix-now**, of which `single-model-rig` 1, `citation-unresolvable`
5 (**4 live rows** — #3506 `eb7e69c1e`, #3603 `5d8c6237a`, #3743 and #4378 both `0c6fd7665` — **plus** the
308-row terminal baseline under "queue (history)"), `duplicate-item` 54, `verification-without-evidence` 1,
`evidence-tree` 1 (#2175, #2213). Broker: **down** (`status.broker = {"state":"down","reason":"no broker state"}`).
Queue: 4,818 rows — 3,748 done, 777 cancelled, **274 held**, **19 deferred** (attention: pm #4813, impl #4354,
lead #4816, devtools #4817, qa2 #4814).

**The measurement that changed the plan (D137).** `tools/model-probes/calibrate-verifier.mjs` fed the two real
pre-fix defects (`3bff94a^`, verbatim from git) to the loaded verifier **twice**, and to the primary once as a
same-session control. Same prompt, temperature 0.2, `CAL_MAX_TOKENS=3000`.

| Model | A — `linkWorktreeDeps` npm invocation | B — `waitForProcessDeath` POSIX deadline | Score |
|---|---|---|---|
| control: primary `local/iq3_s` (the author family) | **named it** ("npm treats the script path as an npm command and fails") | **no** — invented "`taskkill` is missing on Linux" | **1/2** |
| `mistralai/ministral-3-14b-reasoning` Q6_K, run 1 | **no** — 0/7 keywords | **no** — invented an "uninitialized `resolved` / `pidPromise` race" | **0/2** |
| same, run 2 | **no** — 0/7 keywords, same phantom | **no** — 2/8 keywords, same phantom | **0/2** |

On A it claimed non-string `stdout`/`stderr` would make `.join("\n")` throw — **that defect cannot occur**
(measured here: `[null, undefined, "a"].join("\n") === "\n\na"`, `[Buffer.from("x"), "a"].join("\n") === "x\na"`),
so its prescribed `String(...)` wrapper changes nothing — and it never mentioned the resolver, argument order, or
npm's command dispatch. Both runs ended `finish_reason: stop` with 203–292 completion tokens, so this is **not**
D134's truncation failure; it answered, confidently, wrong, twice. Full record:
`docs/reviews/verifier-model-survey-2026-10-27.md` § "THE GATE RAN AGAINST THE VERIFIER".

**Why that is decisive and `check` is not:** `single-model-rig` compares **resolved model strings**
(`src/checkup.mjs:594`). Routing `qa`/`qa2`/`auditor` at a model that scores *below* the family it supervises
would turn that finding green while making verification worse — the same "green check lying about a property" trap
189 already names for a same-family quant. **189's written measure ("`check` no longer reports
`single-model-rig`") is therefore insufficient as written; the measure is the gate.**

**Machine state, measured at 21:53Z — supersedes 189's "the split cannot hold" paragraph.** The primary (Strata
`0.1.50-linux-x86_64-cuda-cuda13`, pid 493568) now holds **20,856 MiB on the 3090 alone** (814 MiB free there);
the verifier (LM Studio's `llama.cpp … cuda12-avx2-2.65.1/llama-server`, pid 649504, `Ministral-3-14B-Reasoning-2512-Q6_K`)
holds **13,388 MiB of the A4000** (2,577 MiB free). **The split the operator asked for is already running**; the
missing piece is a verifier that passes the gate, not free VRAM.

**Config of record, corrected — the paragraph in the cut block was stale.** `durig.config.json` (gitignored) today
carries `DURIG_DB=./selfdev.sqlite`, `DURIG_LOCAL_BASE_URL=http://127.0.0.1:47831/v1`, `DURIG_LOCAL_MODEL=iq3_s`,
`DURIG_LOCAL_CONTEXT=200000`, `DURIG_VERIFIER_BASE_URL=http://127.0.0.1:1234/v1`,
**`DURIG_VERIFIER_MODEL=mistralai/ministral-3-14b-reasoning`**, **`DURIG_VERIFIER_CONTEXT=13273`**,
`DURIG_VERIFIER_MAX_TOKENS=32768` — i.e. the verifier env already points at the model that just failed, **not** at
`recursivesi/flint`/`65536`. `rig.selfdev.json` (tracked) still carries `local/iq3_s` for all 12 seats.

**Blocker:** three operator rulings, none of them a build — and the first is now a **model choice**, not an
LM Studio setting:

1. **Which verifier family, given the free candidate is measured out.** Options on this box:
   **(a)** *Ministral 3 14B Q6_K* — operationally perfect (fits, tools work, ~33 tok/s decode), **0/2 on the gate;
   not routed (D137)**. **(b)** *`unsloth/Devstral-Small-2-24B-Instruct-2512-GGUF` UD-Q3_K_XL, 11.85 GB* — the
   survey's best code-agent evidence at this size; **unmeasured**, so it is a download-then-gate decision (the gate
   costs two prompts, ~15 s once loaded). **(c)** *Flint* — does not fit (31.05 GB / 40.21 GB of routed-expert
   weights for Q6_K / Q8_0 against 34 GiB free RAM; GGUF census = arithmetic) and PolyStrata, not LM Studio, is its
   engine. **(d)** the alternative 189 itself lists: keep the author seats on `local/iq3_s` and put a verifier seat
   back on a **remote** family — needs `DEEPINFRA_API_KEY` and balance. If the context ceiling still bites
   (13,273 tokens, HTTP 400 above ~12k; KV 163,840 B/token fp16, `--cache-type-k/v f16` in the running
   `llama-server`), **q8_0 KV halves it**; LM Studio owns that instance — **never touch it unasked.**
2. **Evidence binding** — durable records cite store-native ids (`entries.id`) rather than machine-local git
   objects? Decides how memory 165/167 and substrate 170 are written. **190.**
3. **`#4785` was marked `done` with no artifact anywhere** — commit `500969f42` never existed on the Windows rig
   either; `win/item-4785` points at plain main. A detector for "a completion without an artifact" is a design
   question, not a repair. Still not registered as an item.

**Queue work awaiting the operator, not the delegate:** the 4 stale citations above are one-line amendments to the
landing commits (`eb7e69c1e`→`ce79c354`, `0c6fd7665`→`0c6fd76e465`; `5d8c6237a` is context in a row held on
#2788), and the gate-cleared orphans plus the parked questions are answered in
`docs/reviews/parked-questions-2026-10-26.md`. Both are `pm` transitions; the delegate has spooled nothing and the
broker is down.

**Still in the tree, not the delegate's, not landed** (first recorded by the 2026-10-26 Linux session — still
true, now measured): `@earendil-works/pi-coding-agent` **`1.3.0` → `^1.3.0`**, which silently reverses the
deliberate exact pin of `e5e9e79` (#2969); `package-lock.json` rewritten, and the **only semantic change in it is
that one spec line** — the other 1,578 lines are EOL (the HEAD blob holds **1,578 CR bytes**, the working copy
**0**), and `.gitattributes` deliberately does **not** set `eol=lf` repo-wide (D83), so any Linux
`npm`/`pnpm` install re-creates the churn; `pnpm-lock.yaml` + `pnpm-workspace.yaml` untracked since 2026-10-26
20:42. `node_modules` is npm-shaped with `vendor/pi-main` symlinks and resolves pi **1.3.0**, so the 238/238 above
**was** measured against the pinned build. The delegate touched none of it — reverting a dependency decision is
the operator's call. Separately: `.scratch/` is untracked but **not** gitignored (only `.spike/` is), so it reads
as noise; this session graduated the probes to **`tools/model-probes/`** (tracked, `README.md` included) because a
durable survey cited scripts that no clone would contain — ROADMAP 190's own failure mode.

**Exact next command** (the gate, then what 189 still reports):

```bash
node scripts/test.mjs
DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json
```

Expected: **238/238 in ~41 s**; **`pass: true`, 0 errors, 62 fix-now, `single-model-rig` still present** — it
clears only after a candidate beats the control on
`node tools/model-probes/calibrate-verifier.mjs <baseUrl> <model-id> [label]` (control = primary `iq3_s` = 1/2;
run it as a control *before* believing anything a candidate says).

**Do not:** route `qa`/`qa2`/`auditor` at `ministral-3-14b-reasoning` (0/2 on the gate, D137); treat a
`single-model-rig` clearing as evidence of cross-family verification (`src/checkup.mjs:594` compares strings);
run `up`/`send`/`run`/`complete` before re-taking the worktree/branch/`.spike` inventory into `.spike/` and diffing
it after (`AGENTS.md` clock-in step 7, `docs/runbooks/workspace-move.md`); run `git add -A`; use `DURIAN_PI_DB` for
the CLI (it is `DURIG_DB`); measure the suite with a serial hand-loop; route any seat at Flint at Q6_K/Q8_0;
compute throughput from a non-streaming call (D136); restart or reconfigure the operator's LM Studio / Strata
instances unasked; revert the dependency relaxation (it predates this session and is the operator's call); or start
broker work on this workspace — the store is intact but its git history is only partially here
(`git cat-file -t 78991031` fails; the docs' own baseline sha is not an object in this clone).
