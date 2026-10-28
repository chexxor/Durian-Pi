# model-probes — read-only probes that produced the numbers in `docs/reviews/verifier-model-survey-2026-10-27.md`

They live here rather than in `.scratch/` because that survey cites them, and an untracked script behind a
durable citation is the same failure ROADMAP 190 exists to catch: a pointer that resolves nowhere.

Nothing here mutates the rig. They read GGUF headers, query HuggingFace, and call a running OpenAI-compatible
endpoint. They do **not** start, stop, or reconfigure a server. `gate.mjs`/`corpus.mjs` write only under
`.spike/gate/` — mutant module copies, extracted review regions, and run transcripts. Source files are never
touched: a mutant is a *copy* of a module with one substitution, imported only to be diffed against the original.

| Script | What it establishes |
| --- | --- |
| `gguf-census.mjs` | Per-class byte attribution of a GGUF (routed experts vs everything else) — the arithmetic that decided which Flint quants can exist on this box. `node gguf-census.mjs <file.gguf>` |
| `gguf-tok.mjs` | Whether a GGUF ships a chat template and whether that template handles tools. `node gguf-tok.mjs <file.gguf>` |
| `gguf-dump.mjs`, `gguf-step.mjs` | The parser-debug steps that found the GGUF KV value type is a `u32`, not a `u8` |
| `verifier-survey{,2,3,4,5}.mjs`, `devstral-nums.mjs` | HF tree sizes, `config.json` architecture/KV math, and vendor benchmark rows quoted in the survey |
| `throughput.mjs` | prefill (`max_tokens: 1`, unique text) and decode (streamed chunks) — the corrected method from **D136**. `node throughput.mjs` |
| `stream-probe.mjs` | The first streaming attempt; kept because it is where the usage-less-stream and prefix-cache artifacts showed up |
| `gate.mjs` | Runs the corpus against one endpoint in **three conditions per item** — `defect`, a matched `clean` control, and `clean-neutral` (a prompt that does not presuppose a defect) — counterbalanced per item. Scores rubric mechanism-groups, pre-registered phantom patterns and **false alarms on controls**; reports McNemar exact p on the paired items; drops corpus artifacts from the ranking. Flags: `--compare <run.json>` (paired side-by-side, intersected on shared items), `--rescore <run.json>` (re-score a saved transcript, no prompts), `--whole-module` (feed the ENTIRE file; see **195** below), `--budget <estTokens>`, `--probe` (accept the whole module only if the endpoint answers 200 for it), `--material answer\|answer+reasoning` (**197**: what a turn is scored on, declared and printed), `--plan` (print the fit table, spend nothing). `node gate.mjs <baseUrl> <model-id> [label] [flags]`; transcripts land in `.spike/gate/run-*.json` so the scorer is auditable. |
| `gate.mjs --whole-module` | **ROADMAP 195.** Feeds the entire module instead of a window around the hunk — for a historical item the whole pre-fix and whole post-fix file, for a mutant the whole mutated and whole clean file — and prints `SKIP <item>: whole module ≈N tok > budget` rather than quietly falling back to a fragment. Absent-binding claims (`not imported`, `ReferenceError`, `__durig_probe__`) are **excused in fragment mode and counted in whole-module mode**, which is how the confound and its size are both measured. Result: `docs/reviews/verifier-gate-hardening-2026-10-28.md` §10 — the false alarms survive whole modules. |
| `gate-side-by-side.mjs` | Compares saved transcripts cell-by-cell (per item × condition) and runs paired exact McNemar **on the items both runs actually showed**, so a whole-module arm and a fragment arm can be compared without comparing different denominators. `PAIRS='[["name",0,1]]' node gate-side-by-side.mjs --pairs <run.json> …` |
| `corpus.mjs` | The corpus, built at run time and never retyped: historical defects from `git show <fix>^:<file>` (hunk-anchored) plus **mutants injected into current `main`, whose non-equivalence is proved by executing the clean and mutated modules against each other** — an equivalent mutant is dropped with a loud NOTE. Every window is repaired to a statement boundary and verified with `node --check`, so a region that cannot parse excludes its item instead of handing the model a `SyntaxError` to "find". Also exports `estimateTokens()` — **calibrated, not assumed**: 2.7 chars/token, above the worst measured 0.2588–0.3609 tok/char read out of recorded `usage.prompt_tokens` (measured against the live servers: 2,961 / 3,923 / 3,741 / 4,465 / 9,618 prompt tokens for the five whole-module items). |

**Two standing weaknesses of the gate, both measured, both open.** A single run does not replicate: the same model,
corpus and scorer flipped **4 of 8** defect cells between runs while reproducing the aggregate exactly (**ROADMAP
198**). And a whole-module "matched pair" is not byte-matched, because the clean side is comment-stripped and the
defect side is not — −17% to −67% of the bytes (**ROADMAP 199**). Quote §10 of the review with both caveats.
| `calibrate-verifier.mjs` | **SUPERSEDED by `gate.mjs`, kept because `docs/DECISIONS.md` D137 cites the numbers it produced** (an untracked script behind a durable citation is the failure ROADMAP 190 exists to catch). Two items from one commit, no clean control, flat keyword lists — what that cannot measure is `docs/reviews/verifier-gate-hardening-2026-10-28.md` §2. `node calibrate-verifier.mjs <baseUrl> <model-id> [label]` |
