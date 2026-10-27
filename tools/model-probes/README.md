# model-probes — read-only probes that produced the numbers in `docs/reviews/verifier-model-survey-2026-10-27.md`

They live here rather than in `.scratch/` because that survey cites them, and an untracked script behind a
durable citation is the same failure ROADMAP 190 exists to catch: a pointer that resolves nowhere.

Nothing here mutates anything. They read GGUF headers, query HuggingFace, and call a running OpenAI-compatible
endpoint. They do **not** start, stop, or reconfigure a server.

| Script | What it establishes |
| --- | --- |
| `gguf-census.mjs` | Per-class byte attribution of a GGUF (routed experts vs everything else) — the arithmetic that decided which Flint quants can exist on this box. `node gguf-census.mjs <file.gguf>` |
| `gguf-tok.mjs` | Whether a GGUF ships a chat template and whether that template handles tools. `node gguf-tok.mjs <file.gguf>` |
| `gguf-dump.mjs`, `gguf-step.mjs` | The parser-debug steps that found the GGUF KV value type is a `u32`, not a `u8` |
| `verifier-survey{,2,3,4,5}.mjs`, `devstral-nums.mjs` | HF tree sizes, `config.json` architecture/KV math, and vendor benchmark rows quoted in the survey |
| `throughput.mjs` | prefill (`max_tokens: 1`, unique text) and decode (streamed chunks) — the corrected method from **D136**. `node throughput.mjs` |
| `stream-probe.mjs` | The first streaming attempt; kept because it is where the usage-less-stream and prefix-cache artifacts showed up |
| `calibrate-verifier.mjs` | The seeded-bug capability gate: feeds two real pre-fix defects from `3bff94a` and prints what the model says. `node calibrate-verifier.mjs <baseUrl> <model-id> [label]` |
