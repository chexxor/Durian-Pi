---
incident: local-provider-empty-key
date: 2026-10-18
severity: sev2
status: mitigated
symptom: "a seat on the local provider fails to run with `No API key for provider: local` after a broker restart"
runbook: null
fix: "#2114"
prevention: "#2114 (placeholder-key fallback) + #2115/#2133 (non-author verify) + the restart-env note in docs/NEXT.md"
last_reviewed: 2026-10-18
---

# The local provider resolves an empty API key, so local seats fail on a broker restart

*Incident 2026-10-18; detected by the delegate switching `devtools` to the local model; analysis by the delegate.*

## Summary
When the selfdev `devtools` seat was switched to the locally-served model (`local/qwen36`, D104), its
first wake after the switch failed with `No API key for provider: local`. The cause is in
`src/providers/local.mjs`: the auth resolver reads `DURIG_LOCAL_API_KEY` and returns `""` when it is
unset, and the provider treats an empty key as missing. Because `DURIG_LOCAL_API_KEY` is neither a config
key nor set by `scripts/serve-noroot.ps1`, **any plain broker restart broke every local seat** until the
variable was exported by hand. Impact: the seats that run only because the paid provider was unfunded
(`devtools`, `qa`) could not run.

## Timeline
- `16:52:52Z` `devtools` transcript: a `pi.assistant` entry with `"provider":"local","model":"qwen36",
  "stopReason":"error"` and `"errorMessage":"No API key for provider: local"`.
- `16:5xZ` delegate reproduces the resolver in isolation: unset env → `{"auth":{"apiKey":""},
  "source":"none"}`; set env → the value wins.
- `16:54Z` broker restarted with `DURIG_LOCAL_API_KEY=local`; `devtools` then replied `local/qwen36`
  (`stopReason:"stop"`).
- `17:0xZ` delegate delivers an operator intent; `pm` registers `#2114` (devtools fix) and `#2115`
  (gated verify).
- `17:1xZ` devtools implements `#2114` **on the local model** (branch `devtools-item-2114`): a
  non-secret placeholder key (`local-placeholder`) when the env var is unset, env value when set. A
  non-author verify was routed.

## Impact
`devtools` (and `qa`, both on the local provider) were un-runnable after any restart that did not export
`DURIG_LOCAL_API_KEY`. No data risk; the durable transcript was intact. The operational cost was that
the only seats able to run without the paid provider were silently broken by a routine restart.

## Root cause
`src/providers/local.mjs` `createLocalProvider` resolves the key as
`(await ctx?.env?.("DURIG_LOCAL_API_KEY")) ?? ""` and hands `""` to pi-ai, which reports it as missing.
Commit `d4bb60e` had replaced the earlier placeholder literal with the env-only lookup to keep secrets
out of source — but the value is a documented **non-secret** placeholder the keyless server accepts, so
the env-only path was stricter than the security posture required and turned a normal restart into an
outage for local seats. `DURIG_LOCAL_API_KEY` is not in `CONFIG_KEYS` (`src/config.mjs`), so it cannot be
supplied from `durig.config.json`; `scripts/serve-noroot.ps1` does not set it either.

## Detection
A failing `devtools` run and the `errorMessage` in its transcript; not a `status` attention (the seat
simply reported `last_run_failed`). The delegate found it while verifying the model switch.

## Resolution
Immediate: restart the broker with `DURIG_LOCAL_API_KEY=local` in its environment (and keep
`DURIG_LOCAL_BASE_URL`/`MODEL`/`CONTEXT`, which the config file supplies). Durable: `#2114` — resolve a
non-secret placeholder when the env var is unset, so no special environment is needed; pending a
non-author verify (`#2115`) and landing.

## Prevention
`#2114` restores the "resolve a constant" behaviour the provider's own comment describes, with the env
still winning when set, plus `demo/local-provider.test.mjs` coverage; `#2115`/`#2133` is the independent
verify. Until it lands, the operational rule (recorded in `docs/NEXT.md`) is that a broker restart must
export `DURIG_LOCAL_API_KEY`, or the local seats break again.

## Evidence
- `DURIG_DB=./selfdev.sqlite node cli.mjs log devtools 8`: a `pi.assistant` entry, `provider: local,
  model: qwen36`, `stopReason: "error"`, `errorMessage: "No API key for provider: local"` (timestamp
  `1792342372070`).
- Reproduced `local.mjs` resolver with an injected context: unset env →
  `{"auth":{"apiKey":""},"source":"none"}`.
- `git log -- src/providers/local.mjs`: `d4bb60e` ("read the local API key from the environment, never a
  literal") and `5e4fb61` (the provider).
- `src/config.mjs` `CONFIG_KEYS` contains `DURIG_LOCAL_BASE_URL`/`_MODEL`/`_CONTEXT` but **not**
  `DURIG_LOCAL_API_KEY`; `scripts/serve-noroot.ps1` sets only `DURIG_DB`.
- Fix branch `devtools-item-2114` (`72efd09` fix, `9ad2df3` test) — `src/providers/local.mjs` returns
  `"local-placeholder"` when unset; queue `#2114`, verify `#2115`/`#2133`.

## Links
`docs/DECISIONS.md` D104 (per-seat local provider) · `docs/NEXT.md` (the LOCAL PROVIDER block) ·
queue `#2114`, `#2115`
