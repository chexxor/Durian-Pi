# Seat tools (M3) — the scoped design

**Status: REVIEWED — "BLOCK as specified → ADJUST (conditional pass)".** Nothing implemented.
Position: `docs/reviews/security-sec-m3-seat-tools.md` (from
`qitem-20261011173526-ebcb34a909ab71e8`, `gate:spec-review`). It escalated to `advise.lead`
(`qitem-20261011173739-402fac1b`) for the scope-vs-security conflict **if** the tools ship
without the conditions below; complying with them means no escalation is needed.

**Operator scope ruling (2026-10-11, D38): option (a) — full shell to author seats**, accepting
the residual shell risk while codemode-with-permissions is developed. SC1–SC3 are **adopted, not
waived**, and D38 records why: the acceptance had assumed pi's `arg-guard`/`guardrails` covered
seats, and they do not (they are pi-coding-agent extensions; durig passes no `hooks` at all).
A durig-side `beforeTool` guard therefore lands **with** the tools, not after them.

Conditions, all required before any code lands and each proved by a canary demo:

| Id | Condition |
|---|---|
| **SC1** | A **root-confining `ExecutionEnv`** (`HarnessOptions.env`, `types.ts:551`) decorating `NodeExecutionEnv`, confining *all* filesystem access to the worktree root — `absolutePath`, `openBinaryReader`, `writeFile`, `createTemp*`, and `exec`'s `cwd` — rejecting absolute paths, `..`, and symlink escapes |
| **SC2** | The verifier's **read-only is enforced at the filesystem layer** (deny `writeFile`/mutation), because its shell can write regardless of `write`/`edit` being omitted |
| **SC3** | **`inheritEnv` forced false at the env layer** (not merely set in `prepare`), plus host non-negotiables (`wsl`, `docker`, destructive git) refused **structurally in `exec`**, never by string match |

## Revision note — what the review falsified in the first draft

This document previously argued that a per-item worktree plus per-seat tool sets were the
boundary. **The review showed both claims were wrong**, and the record matters more than the
tidiness of the original text:

- **The worktree was not a boundary at all (F2, decisive).** `read`, `write` and `edit` accept
  **absolute paths by design** (`read.ts:35`, `write.ts:10`, `edit.ts:28`), resolve through
  `resolveToolPath → env.absolutePath` (`path-utils.ts:13-15`), and `NodeExecutionEnv.absolutePath`
  is `resolvePath(this.cwd, path)` **with no confinement** (`env/node.ts:644`). An absolute path
  simply wins. My claim that "allowlist by `cwd`, and the worktree layout means they are not there
  to read" was **not a control** — and the file tools do not pass through `prepare` at all, which
  is bash-only.
- **"A verifier that structurally cannot fix instead of verify" was false as built (F3).** The
  verifier was granted a shell. PowerShell `Set-Content`/`Out-File`/redirection writes any file the
  OS user can write; omitting the `write`/`edit` **tools** does not remove the write **capability**
  — `modelTools` narrows what the model is *offered* (`types.ts:398-403`), it does not sandbox the
  shell. The property has to hold one layer down.
- **`prepare` was load-bearing and should not have been.** It sees one `BashExecution`
  (`bash.ts:33-36`) — bash only, and a check on a **command string**, which PowerShell defeats
  (aliases, `-EncodedCommand`, `Invoke-Expression`, piped subcommands).

The verdict on direction was favourable — per-seat tool sets, a worktree, `prepare`, evidence in
`complete_work`, PowerShell over an undeclared Git Bash — and `write`/`edit` was **not** the
objection. The objection was that **the confinement was prose, not a boundary**.

## The corrected design

### SC1 is the spine, because it is the only seam that covers every tool

One confining `ExecutionEnv` covers `bash` **and** `read`/`write`/`edit`; a `prepare` guard covers
bash alone (F2). Everything below is narrowing *on top of* SC1 — never instead of it.

### Tool sets are narrowing, not the boundary

| Seat role | Tools | Note |
|---|---|---|
| author (`impl`, `impl2`) | `read`, `write`, `edit`, shell | within the confined root |
| verifier (`qa`, `qa2`) | `read`, shell | read-only enforced by **SC2**, not by tool omission |
| `pm`, `lead` | none | coordination only, as today |

Still worth doing — it shrinks the surface and keeps the author/verifier asymmetry legible — but it
is a **second layer**. The guarantee comes from SC2.

**SC2 resolved as a snapshot, not a read-only shell (agreed 2026-10-11).** The position asked the
verifier's environment to deny "any `exec` that writes", which is **undecidable for a shell** —
and is why its own strongest option was a separate low-privilege OS account. Instead the verifier's
environment is rooted at a **disposable snapshot** of the author's worktree: writes land in the
throwaway copy and are discarded, so the verifier **cannot alter the artifact it is verifying**,
and it can still run the tests, which is its whole job. Read-only by filesystem semantics rather
than by OS identity, and implementable in `confine.mjs` alone. The stronger option — a distinct OS
account or an AppContainer/job-object sandbox — remains an operator call if the snapshot is judged
insufficient.

### `prepare` is the second layer

Good for the env allowlist and a legible refusal. Never the control (F4).

### Shell is PowerShell, not bash

WSL/Docker are host NOs, and native-Windows `bash` means an undeclared Git Bash dependency.
`createPowerShellTool()` tries `pwsh` then `powershell`. F4's warning applies: a PowerShell
allowlist is **not disqualifying** *only because* the boundary is the execution environment.

### The worktree — what it is now for

It remains the per-item workspace and the review/merge boundary (`git diff` per item, seats never
commit, push, or publish). It is **no longer** claimed as a confinement; that is SC1's job. A
distinct low-privilege OS user is **not strictly required once SC1 holds**, but `security.sec`
recommends it as the strongest option and as the only fix for the shared-identity problem
`D-ENV-AUTH` records.

### Evidence in `complete_work`

Independent of this consult and unblocked by it — a protocol change, not a capability grant. The
position adds one acceptance canary: **evidence must contain no key material**.

## Hazards

**H1 — `inheritEnv` defaults to `true`** (`bash.ts:76` → `:102`; `env/node.ts:264`, with
`getShellEnv(..., inheritEnv = true)` spreading `process.env` at `:266`). **CONFIRMED** by the
review: a naive install hands `DEEPINFRA_API_KEY` to every command a seat runs. Fixed at the env
layer by **SC3**, not by `prepare` alone.

**H2 — the key is also in a file.** `durig.config.json` is untracked and gitignored, so a worktree
contains no config — but per **F2** that was never the protection; SC1 is.

**H3 — our guard does not cover seats.** `arg-guard.js` protects our harness, not a seat's shell
process tree; hence SC3 requires structural refusal in `exec`.

**H4 — `defer_work` is the exit for a blocked seat.** A refused command should be parkable on a
question rather than guessed at; name it in the tool descriptions.

## codemode — planned separately: see `docs/CODEMODE.md`

The operator decided (2026-10-11) to develop **codemode with JavaScript** for seats, and asked
for the plan to review the runtime library and cooperate with it. That plan is
`docs/CODEMODE.md`; this section keeps only what the boundary depends on.

**The security verdict stands.** A QuickJS sandbox does **not** add filesystem confinement for
the tools it hosts — they are host-provided and keep their reach — so the sandbox does not
deliver the property the "preferred front door" idea rested on, and there is **no permission
model** to configure (the surface is exactly the registered tool list). Its one genuine net gain
is that a nested result never enters the transcript (spec §8.3–8.4), which reduces
model-visible untrusted input — and that gain only exists **after SC1 does**.

**What that means for the boundary:** codemode is a *narrower front door*, not a replacement for
confinement. It holds only if the capability set minted per script is narrower than the shell,
and the executors delegate to the confined `ExecutionEnv` (SC1) either way. So SC1–SC3 land
**first**, and codemode's script tools are built on top of them.

**The decision-model reviewer** stays a **deny-only tripwire**, never the control — a
probabilistic filter in the enforcement path is not a control (D-ENV-AUTH; the scribe ruling).
Its usable shape: narrow-never-widen at `ToolHooks.beforeTool` (`types.ts:745-752`, which sees
nested calls via `ToolCall.parent` and where "the first `block` wins"), fail-closed, and
falsifiable by a canary.

## Acceptance — the demo that proves the conditions

Must fail against the design as first written and pass with SC1–SC3:

1. **env canary** — a seat command echoes its environment; `DEEPINFRA_API_KEY` is absent.
2. **path escape** — a seat reads an absolute path outside the worktree, and a symlink to one →
   refused legibly; the same read inside the worktree succeeds.
3. **verifier write** — a verifier's shell write → refused; an author's identical command → allowed.
4. **host policy** — `wsl`/`docker`/`git reset` from a seat → refused structurally, legibly, and
   parkable via `defer_work` (H4).
5. **no secret in evidence** — `complete_work` evidence carries no key material.

## What would change this answer

- A **sandboxed `ExecutionEnv` that roots the process too** (distinct low-privilege OS account, or a
  job-object/AppContainer sandbox) satisfies SC1/SC2 more strongly than a decorator; prefer it if the
  operator is willing.
- Proof the pi runtime already confines tool paths to `cwd` would retire F2 (it does **not** at
  `ea448f45`) — re-check on any pin move.
- **A scope decision to grant no shell at all** (read/write/edit only) would drop F1/F4/F5 and make
  the boundary far easier to hold. That is a legitimate scope answer and the cheapest path.

## What ships after the conditions

1. the confining `ExecutionEnv` (SC1) + env/structural refusals (SC3);
2. per-seat tool sets wired via `configure`, with SC2's filesystem-level read-only for verifiers;
3. the five-canary demo above, falsified against the as-written design first;
4. evidence in `complete_work` (independent), so `qa` re-checks rather than trusts;
5. `rig.selfdev.json` (pm/impl/qa/lead, `qa` on a second model — item 3) and a worktree helper;
6. then route durig its first real backlog item and let W2 become `observed`.
