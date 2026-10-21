> **D103 rename (2026-10-18):** this record predates the product rebrand `durig` → `durian-pi`; it keeps the old name so the audit trail stays truthful.

# Vendored: pi-warden (port source, not a dependency)

`dist/`, `LICENSE` and `package.json` are copies of files from **pi-warden v1.4.0**,
MIT licensed.

| | |
|---|---|
| Source | https://github.com/DevMortimer/pi-warden (published as `pi-warden@1.4.0` on npm) |
| Upstream files | `dist/` (62 `.js` + 62 `.d.ts`), `LICENSE`, `package.json` |
| Vendored | 2026-10-11 |
| Local changes | **none** — byte-identical to the installed package |
| Everything else | `extensions/`, `examples/`, `README.md`, `CHANGELOG.md` were **not** copied |

**Where the bytes live, and why they are not in git.** The tree is at
`durig/vendor/pi-warden/`, which is **untracked**: the repository root's `.gitignore:28`
declares `vendor/` for "vendored upstreams (shallow clones)", and pi-warden is reproducible
from npm by version, so committing 1.9 MB of foreign code buys nothing that
`pi-warden@1.4.0` does not already give. This note is therefore tracked at
`durig/docs/PROVENANCE-pi-warden.md` rather than beside the files it describes — the pin is
the durable part, and the bytes are recoverable from it.

When the port lands, it follows the **`src/providers/` convention**: the modules actually
used are **copied into durig's own source** with a header comment and their own provenance
row, not imported from `vendor/`. A fresh clone must never depend on an untracked tree.

## Read this first: this gives seats no protection by itself

**Nothing in durig imports anything under `vendor/pi-warden/`.** It is vendored as *source
to port from*, pinned so the port cannot drift under us. The protections described below
arrive when the port lands, not now. Saying otherwise would be the same class of error as a
citation pointing at nothing.

## Why it is vendored rather than depended on

1. **It cannot be installed.** `package.json` peer-depends on
   `@earendil-works/pi-coding-agent >=0.85.1 <1` and binds through that host's ExtensionAPI —
   `pi.on(event, handler)` and `pi.registerTool(...)` — across **17 host events**
   (`session_start`, `before_agent_start`, `message_start/update/end`, `agent_start`,
   `tool_call`, `tool_execution_end`, `tool_result`, `turn_end`, `agent_end`,
   `agent_settled`, `input`, `session_compact`, `session_before_compact`) plus 3 tools.
   durig installs **pi-durable** extensions (`defineExtension` / `hook` / `ToolHooks`), which
   `DURIG_EXTENSIONS` loads — a different API. Only `dist/extension.js` and `dist/load.js`
   import the host; the other 60 modules are host-agnostic policy logic.
2. **Its judge is network egress with a third-party credential.** The single external
   dependency is `pi-typesafe` (`createTypeSafe`, `ask`, `ensureApiKey` → typesafe.ai). That
   is a mandatory security consult trigger, and a *probabilistic filter in the enforcement
   path*, so it can only ever be a deny-only tripwire — never the boundary. It is **not**
   vendored, and the port must run with the judge disabled until a position says otherwise.
3. **Pinning protects the port.** A port written against a moving dependency is unreviewable.
   The vendored bytes are the exact source the port is written and reviewed against.

## What the port costs (measured, not estimated)

A reachability pass over `dist/` settles how much is reusable:

- **No judge-free subset exists.** Rooting at `redact` + `shell-writes` + `tools` + `holds`
  still reaches `guard` → `conscience` → `backend` → `pi-typesafe`: **19 modules, 495 KB, one
  external dep**. So a partial vendor would not have removed the judge problem, which is why
  the whole `dist/` is here rather than a slice.
- The action-guard path alone is 18 modules / 482 KB.
- durig's hooks are **stronger** than what pi-warden binds to: `ToolHooks.beforeTool` can
  block *or rewrite* a call, the first `block` wins, a throw blocks, and `ToolCall.parent`
  exposes **nested** calls — so an adapted action guard would also cover a codemode script's
  calls.
- The porting risk is the events with no 1:1 analogue (`message_update`, `turn_end`,
  `agent_settled`, `input`). A wrong mapping silently weakens the guard, so the adapter wants
  a spike before it is trusted.

## Why this is in scope at all

Two halves fit durig directly:

- **`action-guard.js` / `guard.js`** (`evaluateAction`) — hold or refuse a risky tool call.
  This is the control that makes "full shell" defensible before codemode-with-permissions
  exists (D38).
- **`done.js`** (`needsDoneCheck`, `evaluateDone`, `projectCheckCommand`) — catches a
  completion with no check run. That is precisely durig's W2 gap: `complete_work` carrying a
  claim with no evidence.

## Keeping it current

Re-vendor only deliberately, by version, and re-record the table above:

```bash
# from the installed package
cp -r "<npm-root>/pi-warden/dist" durig/vendor/pi-warden/dist
cp "<npm-root>/pi-warden/LICENSE" "<npm-root>/pi-warden/package.json" durig/vendor/pi-warden/
```

Upstream drift matters only where the port copied a module; if the port has diverged from
these bytes, re-check the divergence before re-vendoring rather than overwriting it.
