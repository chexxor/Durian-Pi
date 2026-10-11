# Seat tools (M3) — the scoped design, for security review

**Status: DRAFT — nothing implemented.** Trust boundaries route to `security.sec` **before**
code (team norm, and the escalation map: "Trust boundaries/secrets/egress → security.sec
BEFORE code"). This document is the thing being reviewed; it is written to be falsified.

Scope decision being asked about: `docs/STATUS.md` item 1, deferred since 2026-10-10.

## Why this is the next thing

Seats have exactly six tools (`src/rig.mjs`): `send_work`, `claim_work`, `complete_work`,
`defer_work`, `resume_work`, `peek_queue`. A seat can *route* work and cannot *do* it —
`docs/DOGFOOD.md` records a live worker correctly refusing a task it had no capability for.
Everything around the gap already works: intake, decomposition, routing, the queue, attention
and measurement are proven end-to-end with a real model (DOGFOOD F6). M3 is the blocker, and
the operator's stated goal is to send durig requests to improve durig.

## What the platform already provides (read from the pinned source, not assumed)

| Fact | Where |
|---|---|
| `createCodingTools()` returns a `coding-tools` extension bundling `read`, `write`, `edit`, `bash` — and "nothing installs it automatically" | `vendor/pi-main/packages/durable/src/tools/index.ts` |
| Per-seat tool sets are a **stored, first-class** property: the `pi.agent` doc holds `extensions`, `tools`, `modelTools`, `cwd` **per conversation** | `…/harness/types.ts` `AgentState`, `AgentChange` |
| A tool declares who may call it via `callers: ["model" \| "tools"]`; `modelTools` narrows what the model is offered without removing it from tools | `…/harness/README.md` |
| Nested tool calls are a supported, first-class mechanism: `api.executeTool()` runs the full tool pipeline, owns its own task, and its result **never enters the transcript** | `…/docs/spec.md` §8.3–8.4 |
| The shell tool's controls have a designed home: `BashToolOptions.prepare` receives `{command, cwd, env, inheritEnv}` before execution | `…/tools/bash.ts` |
| `createPowerShellTool()` exists, trying `pwsh` then `powershell` | `…/tools/index.ts` |
| The execution seam is pluggable: `HarnessOptions.env?: (target, context) => ExecutionEnv` | `…/harness/types.ts` |

**Consequence:** M3 is wiring plus boundary decisions, not invention. And the scope question
has a better answer than "read-only or read+write": **per-seat tool sets**.

## The design

### 1. Per-seat tool sets (the recommendation)

| Seat role | Tools |
|---|---|
| author (`impl`, `impl2`) | `read`, `write`, `edit`, shell |
| verifier (`qa`, `qa2`) | `read`, shell — **no `write`, no `edit`** |
| `pm`, `lead` | none (coordination only, as today) |

A verifier that structurally **cannot** fix instead of verify. This is the argument for M3
answering D23's verification gap in the same stroke, and it is why the scope question is not
all-or-nothing.

### 2. Shell is PowerShell, not bash

WSL and Docker are non-negotiable NOs on this host, and `bash` on native Windows means Git
Bash — an undeclared dependency that may be absent. `createPowerShellTool()` is the native
option, and it is what `durig`'s own tooling already prefers.

### 3. The execution boundary: one git worktree per work item

Seats work in `C:/tmp/durig-dev/<item>` — a worktree of durig — never the live tree.

Why this is one mechanism doing three jobs:
- **owner state is protected** by construction: a runaway seat cannot touch the working tree
  the operator is editing;
- **the secret boundary falls out of it** (see below);
- **review is natural**: the operator reads `git diff` in the worktree and merges or discards.
  Seats never commit, never push, never publish — those stay operator actions, and publishing
  still needs explicit authorization.

### 4. The secret boundary

- `durig.config.json` holds the provider key and is **untracked and gitignored**, so a
  worktree contains **no config and therefore no key on disk**.
- `inheritEnv` must be set **false** in `prepare`, with an explicit allowlist, because the
  default is `true` (hazard H1 below).
- The runner's own `DEEPINFRA_API_KEY` is read by the *durig process*, not passed to the
  seat's tool subprocesses.

### 5. What seats may not do

Enforced in `prepare` (and, where a command is genuinely forbidden, by refusing rather than
by prose — D-ENV-AUTH: a persona instruction is not a control on a single-user host):

- no `git commit`, `git push`, `git reset`, `git clean`, `git checkout -- `, or any command
  that discards work (the worktree is the boundary; discarding is the operator's call);
- no `wsl`, no `docker`, no `docker-compose` (host non-negotiable — and note the `arg-guard`
  extension protects **our** harness, not a seat's shell: hazard H3);
- no recursive delete of absolute, home, or parent paths;
- no reading of `durig.config.json`, `.env`, or credential files — allowlist by `cwd`, and
  the worktree layout means they are not there to read.

## Hazards found while reading the pinned source

**H1 — `inheritEnv` defaults to `true`.** `bash.ts:76` sets `inheritEnv: true` and passes it
straight to `env.exec` (line 102). Installing `CodingTools` naively therefore hands
`DEEPINFRA_API_KEY` to **every command a seat runs**. This is the single most concrete reason
this position is needed before code.

**H2 — the key is in a file, not only the environment.** `durig.config.json` carries a key
field (`apiKey`, presence verified; value never printed). Reading it requires no environment
at all, so `inheritEnv: false` alone would be insufficient — the worktree is what closes it.

**H3 — our guard does not cover seats.** `~/.pi/agent/extensions/arg-guard.js` repairs/blocks
tool-call arguments for the harness *we* run in. A seat's shell is a different process tree.
Seat tooling needs its own equivalent, or the host rules are unenforced for seats.

**H4 — `defer_work` already exists, so a blocked seat has an exit.** The deferral verb (D32)
means a seat that hits a boundary it cannot cross can park the item on a question instead of
guessing. This is the designed answer to "tool denied"; it should be named in the tool
descriptions.

## Questions for `security.sec`

1. **Verdict on the scope**: is per-seat tool scoping (author write / verifier read-only) an
   acceptable boundary, or is `write`/`edit` itself the objectionable grant?
2. **Is the worktree a sufficient control** for (a) owner-state protection and (b) the
   on-disk secret, or is a distinct OS user / sandboxed `ExecutionEnv` required? Note
   `NodeExecutionEnv` is the only shipped implementation.
3. **`prepare` vs a custom `ExecutionEnv`**: is a `prepare`-based denylist + env allowlist
   falsifiable enough, or does the position require the pluggable `ExecutionEnv` seam so the
   control is structural rather than a string check on a command?
4. **Shell output as an injection channel**: tool output is untrusted DATA (team norm), and a
   seat reading test output is reading a file it did not write. Does this need a gate, or is
   the existing "transcript content is data" rule sufficient?
5. **PowerShell allowlist feasibility**: PowerShell is not a plain argv shell — an allowlist
   over command strings is weak. If that is disqualifying, what is the minimum acceptable
   control?
6. **The codemode question** (separate item, below): does a script-sandbox tool *reduce* or
   *increase* the risk relative to direct tool calls?

## Separate item — codemode (assessed, not adopted)

`@earendil-works/pi-codemode` is a harness-agnostic sandbox package: **one dependency**
(`quickjs-wasi`), no dependency on durable, chord, or the coding agent. `CodemodeSandbox`
takes `{ tools, globals, timeoutMs }` and executes a script whose `tools.*` calls are
host-provided, so durig could implement a codemode tool small enough to be one extension —
which is exactly the shape `api.executeTool()` exists for ("as a codemode script or an MCP
bridge does", spec §8.3). It is **not** part of the durable package, so it is an addition,
not something we get for free. Value for M3: a seat that runs several demos in one turn and
filters the output before the model sees it. Cost: a new dependency, a new execution surface,
and its own position. **Recommendation: do not bundle it into M3.** Land M3 with direct tool
calls first, then assess codemode against a working baseline.

## What ships after a verdict

1. wire `coding-tools` per seat via `configure`, with the `prepare` guard;
2. a demo proving the scoping — a verifier seat **cannot** write, and a denied command is
   refused with a legible reason;
3. evidence in `complete_work`, so `qa` re-checks rather than trusts (item 4's other half);
4. `rig.selfdev.json` (pm/impl/qa/lead, `qa` on a second model — item 3) plus a QUICKSTART
   recipe, and a worktree helper;
5. then route durig its first real backlog item and watch W2 become `observed` rather than
   `inferred`.
