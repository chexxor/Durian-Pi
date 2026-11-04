# Vendored: pi-deepinfra's model catalogue

`deepinfra-models.ts` and `LICENSE.pi-deepinfra` are copies of files from
**pi-deepinfra v0.1.3**, by puetsua, MIT licensed.

| | |
|---|---|
| Source | https://github.com/puetsua/pi-deepinfra |
| Upstream files | `models.ts`, `LICENSE` |
| Vendored | 2026-10-11 |
| Location | `src/providers/vendor/pi-deepinfra/deepinfra-models.ts` — moved 2026-11-04 by #5047, see "Why the path moved"; the move changed no byte of the copy |
| Local changes | an 11-line header comment prepended; line endings normalised CRLF → LF; **plus rows added by hand for models this rig names** (`DeepSeek-V4.1-Flash`, `DeepSeek-V4.1-Flash-1017`, `gemma-4-31B-it`, `MiMo-V2.6-Flash`, `Qwen3.6-35B-A3B`, `DeepSeek-V4-Flash-0731`), each with the date it was read off the live catalog in a comment. Recording that honestly is the point: a hand-maintained table whose currency is asserted by a comment is an undated claim, and that is what the P6b guard now refuses. |
| Everything else | **unmodified** — byte-identical to upstream apart from the rows named above, verified by diff |

## Why the path moved (#5047, 2026-11-04)

`src/providers/deepinfra-models.ts` is now **durig's** module: the validation layer that decides which
catalogue rows may be registered at all (priced, and not able to spend more than the store cap in one call).
The upstream copy sits untouched at `src/providers/vendor/pi-deepinfra/deepinfra-models.ts`. The move is what
lets both things be true at once: the vendored bytes stay vendored (a future upstream re-copy is still a
straight file replacement), and the guard sits at the path every consumer already imports, so it cannot be
bypassed by importing the other table. The policy's numbers live in `src/providers/deepinfra-prices.json`,
stamped `fetchedAt`.

## Why it is vendored rather than depended on

durig needs the DeepInfra **provider options** — provider id, base URL, the
OpenAI-compatibility flags, and the fallback model list — defined in exactly one
place. pi-deepinfra already defines them and is what feeds the pi extension, so
copying from it keeps durig's behaviour in step with the extension instead of
inventing a second list that can drift.

It cannot simply be a dependency, for two reasons:

1. pi-deepinfra ships as a **pi extension** (`pi.extensions: ["./index.ts"]`), not
   as a library durig can import for one small catalogue.
2. durig imports the catalogue as **TypeScript source** that Node 24 type-strips
   at runtime. Reading the source is deliberate: there is no build step and no
   compiled artefact to keep in sync.

## Keeping it current

There is no automatic sync. If upstream changes, re-copy `models.ts` into
`src/providers/vendor/pi-deepinfra/` and re-run the diff. Drift is no longer merely an ageing list: a curated
row that is unpriced, whose price moved >25 % from the dated source, or whose declared geometry can spend more
than the store cap in ONE call is REFUSED at registration and reported (`catalogRefusals()`), and the acceptance
probe `tools/model-probes/spend-cap-acceptance.mjs --snapshot <catalog.json>` (**P6b**) fails. Refresh the
source: `curl -s https://api.deepinfra.com/v1/openai/models` (public — no key, no inference), then update
`src/providers/deepinfra-prices.json` and its `fetchedAt`.
