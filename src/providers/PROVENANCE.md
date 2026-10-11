# Vendored: pi-deepinfra's model catalogue

`deepinfra-models.ts` and `LICENSE.pi-deepinfra` are copies of files from
**pi-deepinfra v0.1.3**, by puetsua, MIT licensed.

| | |
|---|---|
| Source | https://github.com/puetsua/pi-deepinfra |
| Upstream files | `models.ts`, `LICENSE` |
| Vendored | 2026-10-11 |
| Local changes | an 11-line header comment prepended; line endings normalised CRLF → LF |
| Everything else | **unmodified** — the body is byte-identical to upstream, verified by diff |

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

There is no automatic sync. If upstream changes, re-copy `models.ts` and re-run
the diff. A stale copy is not fatal: the model named by `DURIG_MODEL` is added to
the catalogue at runtime whether or not the fallback lists it (see the
"synthesized entry for the requested model" comment in `cli.mjs`), so the cost of
drift is an ageing fallback list, not a broken provider.
