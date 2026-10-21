# Seat tools (M3) — the scoped design

**Status: REVIEWED — "BLOCK as specified → ADJUST (conditional pass)".** Nothing implemented.
Position: **no standalone review file** — the review verdict ("BLOCK as specified → ADJUST")
and SC1–SC3 are recorded **inline in this document**; the review was planned at
`docs/reviews/security-sec-m3-seat-tools.md` but never written as a file (never committed, verified
`git log --all --diff-filter=A` is empty). (from `qitem-20261011173526-ebcb34a909ab71e8`,
`gate:spec-review`). It escalated to `advise.lead`
(`qitem-20261011173739-402fac1b`) for the scope-vs-security conflict **if** the tools ship
without the conditions below; complying with them means no escalation is needed.

**Operator scope ruling (2026-10-11, D38): option (a) — full shell to author seats**, accepting
the residual shell risk while codemode-with-permissions is developed. SC1–SC3 are **adopted, not
waived**, and D38 records why: the acceptance had assumed pi's `arg-guard`/`guardrails` covered
seats, and they do not (they are pi-coding-agent extensions; durian-pi passes no `hooks` at all).
A durian-pi-side `beforeTool` guard therefore lands **with** the tools, not after them.

**SC1–SC3 implemented and proved (2026-10-11):** `src/confine.mjs` + `demo/confine.test.mjs` (the
27th demo). Every canary is paired with its *unguarded control*, because a denial that also
denies without the boundary proves nothing: the raw environment reads a file outside the root
while the confined one refuses it. Covered: path confinement via `absolutePath` (absolute, `~`,
`..`, and — where the host permits creating a symlink — a link escape), the environment (no
credential-shaped variable reaches a command even when the caller asks for it by name, with
`inheritEnv: true` deliberately requested), the host refusals (`wsl`, `docker`, destructive git),
and the verifier's read-only file API while it can still read and still run a command.

*Writing the test found two real defects in the module's first draft, which is the argument for
canaries rather than a review:* `absolutePath` was delegated **unconfined** — the F2 hole itself,
since every other tool resolves through it — and forcing `inheritEnv: false` without supplying an
allowlisted baseline would have left a seat's command with **no `PATH`** at all.

*One canary reports itself skipped rather than passing quietly:* creating a symlink can need a
privilege this Windows host withholds, and a silently dropped escape check is worse than a
reported one.

**The `beforeTool` guard is implemented and proved too:** `src/seatguard.mjs` +
`demo/seatguard.test.mjs` (the 28th demo). Its first assertion is **structural**, because the
failure that matters for a guard is not a wrong answer but a guard that silently never fires: a
hook registered against a mistyped task name blocks nothing while looking installed. So the test
holds the extension's hook to the real `pi.tool` task and to this module's handler before it
tests any behaviour. It then checks that `wsl`/`docker`/`docker-compose` and the three
destructive git forms are blocked with the policy in the block text; that ordinary work
(`node demo/x.test.mjs`, `git status`, `git diff`, `npm test`, `rg`) is **not** blocked, since a
guard that blocks everything is an outage; that a non-shell tool is not inspected; that a
**nested** call — how a codemode script reaches a tool — is covered; and that the environment
and the guard give the **identical** reason for the same command, so the one shared policy list
cannot drift into a hole.

**Wired (2026-10-11):** `src/seattools.mjs` + `demo/seattools.test.mjs` (the 29th demo).
`openHarness` installs `SeatGuard` next to the Router with the seat tools beside it, supplies
`HarnessOptions.env` from `makeSeatEnv`, and fills the roster from the store; `up` narrows
verifier seats through `scopeVerifierTools`. The test opens by asserting that **cli.mjs contains
those calls**, because a module that is never installed protects nothing while looking finished,
and only then proves behaviour: the tool set is read/write/edit/PowerShell + `prepare_workspace` with **no bash**, an
author can write inside its root, a verifier **cannot** write through the file API whatever tools it was offered (its shell can write — isolation is a convention, SC2 states the three facts), an
**unknown conversation fails closed** rather than open, and an escape is refused even for an
author. A live scratch `up` / `check` / `ps` on a throwaway store confirms the real path still
works with the wiring in place.

**Workspace switch (D66, `prepare_workspace`):** the seat prepares its own item worktree — the
broker no longer sets a process-global `DURIAN_PI_SEAT_ROOT`, and `makeSeatEnv` resolves the seat's own
persisted cwd first, so each conversation is confined to its own tree. Coordinator seats lose
`prepare_workspace` with the rest of `COORDINATOR_REMOVALS`; verifiers keep it so they can work in a
disposable copy. Proof: `demo/prepare-workspace.test.mjs`, amended `demo/seattools.test.mjs`.

*The residual, stated plainly:* a verifier's **shell can still write**, because a shell cannot be
made read-only. Its writes are **not** isolated by a confinement guarantee — the disposable-copy
premise is promised in `confine.mjs`'s docstring but `makeSeatEnv` passes the seat's real root —
they are isolated only by **disposable-scratch policy** (the verify worktree is reaped and audited;
qa/auditor hold because their worktrees happen to be scratch). This is the interim form, recorded
verbatim for any doc that describes verifier capability:

> **Verifier read-only is enforced at the file API and env layers. Shell-write isolation rests on
> disposable-scratch policy (reaped, audited), NOT a confinement guarantee. NO VERIFICATION
> ARGUMENT MAY CITE THE CURRENT STATE AS A GUARANTEE.**

**The worktree exists now, which was the safety gate (2026-10-11):** `src/worktree.mjs`,
`node cli.mjs worktree <path>` and `demo/worktree.test.mjs` (the 30th demo). Before this the
boundary confined seats to *durian-pi's live tree*, because nothing ever set a seat's `cwd` - so an
author seat could overwrite uncommitted operator work while every control looked satisfied. The
verb adds a detached worktree and **bridges `node_modules` with a junction**, without which a
fresh worktree cannot run the demo suite at all (`node_modules` is gitignored, and a directory
symlink on Windows needs elevation a junction does not). `up` now records `seat.cwd ?? spec.cwd`
per conversation, and leaves it alone when neither is declared.

*Proved on the real repository, not only a throwaway one:* the verb resolved the repo to durian-pi's
**parent** project, and in the resulting worktree the demo suite ran, `node_modules` was bridged,
and **`durian-pi.config.json` was absent** - the key is gitignored, so a worktree has no key on disk
and no seat can read one. Removal requires `force: true` explicitly, so the safe default fails
loudly instead of discarding work.

*Two defects the worktree test found, both mine:* `repoRoot` returned git's forward-slash path,
which no caller could compare or join; and the first version asserted that an *unforced* removal
would be refused, when a worktree holding only untracked-but-ignored content is not dirty to git
at all - the removal simply succeeded. The test now dirties a tracked file before asserting.

Conditions, all required before any code lands and each proved by a canary demo:

| Id | Condition |
|---|---|
| **SC1** | A **root-confining `ExecutionEnv`** (`HarnessOptions.env`, `types.ts:551`) decorating `NodeExecutionEnv`, confining *all* filesystem access to the worktree root — `absolutePath`, `openBinaryReader`, `writeFile`, `createTemp*`, and `exec`'s `cwd` — rejecting absolute paths, `..`, and symlink escapes |
| **SC2** | Verifier read-only, stated as three facts (the capability profiles must read these, never an unqualified adjective): **(1) FILE-API REFUSAL — ENFORCED**: deny `writeFile`/mutation via `readOnlyGuard` (demo half 1 proves it); **(2) ENV DISCIPLINE — ENFORCED**: cwd pinned + `inheritEnv:false` (SC3); **(3) SHELL-WRITE ISOLATION — CONVENTION**: a verifier's shell can still write regardless of `write`/`edit` being omitted; its writes are isolated only by disposable-scratch policy (reaped, audited), NOT a confinement guarantee, because `makeSeatEnv` passes the seat's real root, not a minted snapshot |
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
| verifier (`qa`, `qa2`) | `read`, shell | file-API refusal + env discipline ENFORCED; shell-write isolation a CONVENTION (SC2 states the three facts, not "read-only" unqualified) |
| `pm`, `lead` | none | coordination only, as today |

Still worth doing — it shrinks the surface and keeps the author/verifier asymmetry legible — but it
is a **second layer**. The enforcement comes from SC2's file-API and env facts; shell-write isolation
is the convention, not a guarantee.

**SC2 resolved as a snapshot, not a read-only shell (agreed 2026-10-11).** The position asked the
verifier's environment to deny "any `exec` that writes", which is **undecidable for a shell** —
and is why its own strongest option was a separate low-privilege OS account. The intent is that the verifier's
environment is rooted at a **disposable snapshot** of the author's worktree: writes land in the
throwaway copy and are discarded, so the verifier **cannot alter the artifact it is verifying**,
and it can still run the tests, which is its whole job. **That snapshot is NOT yet wired** — `makeSeatEnv` passes the seat's real root, so until C-1 lands, shell-write isolation is a **convention** (disposable-scratch policy, reaped and audited), not a confinement guarantee. Read-only by filesystem semantics rather
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

**H2 — the key is also in a file.** `durian-pi.config.json` is untracked and gitignored, so a worktree
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
2. per-seat tool sets wired via `configure`, with SC2's file-API read-only (three facts, not "read-only" unqualified) for verifiers;
3. the five-canary demo above, falsified against the as-written design first;
4. evidence in `complete_work` (independent), so `qa` re-checks rather than trusts;
5. `rig.selfdev.json` (pm/impl/qa/lead, `qa` on a second model — item 3) and a worktree helper;
6. then route durian-pi its first real backlog item and let W2 become `observed`.
