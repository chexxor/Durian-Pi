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
| `gate.mjs` | Runs the corpus against one endpoint in **three conditions per item** — `defect`, a matched `clean` control, and `clean-neutral` (a prompt that does not presuppose a defect) — counterbalanced per item. Scores rubric mechanism-groups, pre-registered phantom patterns and **false alarms on controls**; reports McNemar exact p on the paired items; drops corpus artifacts from the ranking. `node gate.mjs <baseUrl> <model-id> [label] [--compare <run.json>]`; transcripts land in `.spike/gate/run-*.json` so the scorer is auditable. |
| `corpus.mjs` | The corpus, built at run time and never retyped: historical defects from `git show <fix>^:<file>` (hunk-anchored) plus **mutants injected into current `main`, whose non-equivalence is proved by executing the clean and mutated modules against each other** — an equivalent mutant is dropped with a loud NOTE. Every window is repaired to a statement boundary and verified with `node --check`, so a region that cannot parse excludes its item instead of handing the model a `SyntaxError` to "find". |
| `calibrate-verifier.mjs` | **SUPERSEDED by `gate.mjs`, kept because `docs/DECISIONS.md` D137 cites the numbers it produced** (an untracked script behind a durable citation is the failure ROADMAP 190 exists to catch). Two items from one commit, no clean control, flat keyword lists — what that cannot measure is `docs/reviews/verifier-gate-hardening-2026-10-28.md` §2. `node calibrate-verifier.mjs <baseUrl> <model-id> [label]` |
