# Making the team definition cross-platform: what the rig carries, and what oh-my-pi actually does about this

**Delegate-authored, 2026-10-29T20:4xZ.** Box `Alex-Desktop-Win10`, **Linux** (Fedora `7.2.11-200.fc44.x86_64`), node
v24.22.1, store `./selfdev.sqlite`, rig `./rig.selfdev.json`. Operator direction that produced this note: *"work on those
four findings now — we need to find a way to make the team and its definition cross-platform friendly … oh-my-pi claims to
be cross-platform, so we should prioritize our learnings from their project."*

Instrument this note is built on: **`tools/rig-portability-audit.mjs`** (delegate-landed, tracked, read-only, 602 ms).
`node tools/rig-portability-audit.mjs` → **NOT PORTABLE ON THIS HOST — 15 finding(s)**, exit 1. Its `--self-test` proves
the load-bearing mechanism claim rather than asserting it (below). It reuses the product's own functions
(`resolveSeatRoot`, `classifyGitRoot`, `classifyWorktrees`) and reads seat roots through the product's own surface
(`cli.mjs worktree audit`) — no hand-rolled store query, per the `docs/SELFDEV.md` pitfall.

## 1. The four findings, re-measured with the instrument in the tree

1. **The store, not the rig file, decides a seat's root — and 12/12 stored roots are foreign.** `rig.selfdev.json` names
   no `cwd` for any seat (0 declared), yet every seat resolves to a `C:\Users\Alex\…` path from `pi.agent.cwd`.
   `resolveSeatRoot` returns a persisted cwd **unconditionally** (`src/seatroot.mjs:29` — no existence check), and
   `classifyGitRoot` reports that phantom as **`main-worktree`**, so a woken file-capable seat is told it is in the **live
   checkout** while every file tool aims at a path that does not exist. This is the phantom 221 recorded for `pm` on
   2026-10-28; the instrument now shows it is **all twelve seats**, not one.
   **This is a gap in 210 as registered**, not just a repeat of it: 210's rule reads `seats[].cwd` **from the rig file**,
   and the rig file is clean today (`grep` for `C:\`, `/home/`, `D:\`, `127.0.0.1` in `rig.selfdev.json` +
   `durig.config.default.json` → **0 hits**). A `check` rule built exactly to 210's acceptance would report **green while
   12/12 seats are broken**.
2. **A seat's own worktree is unprotectable on this host.** `classifyWorktrees` keeps a tree as `seat-root` only on
   **exact normalized-string equality** (`src/broker.mjs:988-1010`); a stored Windows root can never equal a Linux worktree
   path, so on a moved workspace the `seat-root` keep-reason is **unreachable** — while
   `reconcileOrphanedWorktrees` sweeps at every broker start (`src/broker.mjs:1145-1170`). Proven, not asserted: the
   instrument calls the product's classifier twice — a same-host root yields `keepReason: "seat-root"`, the stored
   foreign root yields `"not-terminal"`. Related to 232 (the `pruneWorktrees` ledger sweep) but a **different mechanism**:
   232 is registrations this host cannot read; this is a keep-guard that silently never fires.
3. **`GRANT 1`'s named remedy does not exist.** `docs/DECISIONS.md:6314` says "`up --root` once per seat"; `cli.mjs help`
   offers `up <rig.json> [--refresh] [--dry-run] [--serve|--no-serve]` — there is **no `--root`**. The mechanism that does
   exist is `seatCwd = seat.cwd ?? spec.cwd ?? CFG.DURIG_SEAT_ROOT` (`cli.mjs:679`, diffed at `:794`, written only when
   defined), i.e. **export `DURIG_SEAT_ROOT`, then `up --refresh`**. That also explains 210/221's `changes: {}`
   measurement: with no `cwd` in the rig file and no `DURIG_SEAT_ROOT`, `seatCwd` is `undefined`, so a refresh **cannot**
   clear or re-point anything. Bulk-refreshing all twelve at one root is also the wrong shape — it collides with per-item
   worktree isolation, which is why 221 ruling A says the persisted root becomes a **workspace-root-relative name**.
4. **A probe timeout is a platform claim, not a model verdict.** The first `tools/broker-serve.mjs --status` printed
   `BLOCK provider-local-completion-failed: local: /chat/completions failed — timeout after 20s`; two re-runs and
   `--dry-run` printed `local: completes (finish=stop, prompt=57 tok, completion=31 tok)`. The seat server is a
   **204,800-token-window** strata holding **51.3 GiB RSS / 40.7 GiB shmem**, so a 20 s probe sits near its ceiling — the
   254 class again. Nothing was wrong with the model.

## 2. The competitor read, oh-my-pi first (the operator's priority)

Pinned clone: **`vendor/eval/oh-my-pi` HEAD `6f3fbc94`, 2026-10-27, MIT** (`docs/VENDOR-PINS.md` row 72). Licence is MIT,
so borrowing *patterns* is clean; nothing here proposes vendoring their code.

**Their cross-platform claim, and what actually stands behind it.** They ship per-target binaries and per-OS CI legs:
`NATIVES_CROSS_TARGETS = natives-darwin-{arm64,x64-baseline} natives-linux-{arm64,musl-arm64,musl-x64-baseline}
natives-win32-{arm64,x64-baseline}` (`.github/workflows/ci.yml:88`), and a `release_smoke` matrix that runs on
`ubuntu-22.04`, `ubuntu-24.04-arm`, musl-in-Alpine, `macos-15-intel`, `macos-15`, **`windows-2025`**, **`windows-11-arm`**
(`ci.yml:905-918`), executing `--version` and **`--smoke-test`** with `HOME`/`XDG_DATA_HOME` pointed at a **throwaway
directory** (`ci.yml:929-935`). Read honestly: the claim is *own the layer + cross-build + smoke the exact published
bytes on each OS* — their **unit/integration legs are Linux** (twelve `runs-on: ubuntu…`). So "cross-platform" there is
not "every test runs everywhere"; it is "the layer that breaks across OSes is ours, and a real invocation is proven on
each OS we ship". That is the version a single-operator, native-host-only rig (D131, no containers) can actually afford.

**The mechanism that makes the claim true — they own the shell.** `crates/pi-shell` is a *"persistent embedded brush
shell"* and `crates/pi-builtins` is *"every builtin the embedded shell installs: a patched fork of brush's POSIX/bash
builtins, plus one module per in-process command-line utility (`cat`, `grep`/`rg`, `sed`, `ls`, `find`, `jq`, `fd`,
`diff`, `ps`, `top`, `kill`, the moreutils set…)"*, with Brush itself vendored at
`crates/vendor/brush-core` + `brush-parser` (`docs/native-crates.md:12,17,28`). A seat's command surface therefore **does
not depend on a host-installed `bash` or `powershell` at all** — the 217 defect (registered tool spawns
`[pwsh, powershell]`, neither exists, every call is `spawn … ENOENT`) is structurally impossible in their design. They
still handle host difference, they just handle it in their own layer: *"on Windows, UTF-8 locale/codepage defaults are
added when absent"*, *"on POSIX, cancelling a non-PTY run sends TERM … allows up to one second … then escalates to KILL;
Windows terminates processes without a catchable TERM signal"* (`docs/bash-tool-runtime.md:178,189`). **Enumerated in the
doc, not hidden in a branch.**

**The path seam — one place, validating, with host aliases inside it.** `ShellPaths::resolve` is documented as *"Resolves
`path` to what the shell would open"*; relative paths join `ShellPaths::cwd`, and *"Windows aliases (`/c/...`, `/tmp`)
become native paths via `brush_core::sys::fs::normalize_shell_path`"* (`crates/pi-builtins/src/host.rs:427-434`);
`absolute()` short-circuits virtual paths **before** host normalization (`:461-468`), and the cwd itself enters at one
point (`context.shell.working_dir()`, `:403`). A sibling `resolve_link` exists for inspect-without-following, with its
reasoning written out (`:439-458`). At the tool boundary: *"A host `cwd` is resolved relative to session cwd
(`resolveToCwd`) and **validated via filesystem `stat`**"* (`docs/bash-tool-runtime.md:84`).

**Where we already agree with them, and where we have drift.** `src/seatroot.mjs` opens with *"This is the ONE definition
of the resolution chain … so those callers cannot drift apart"* — the same instinct. We do not honour it: there are **two
divergent normalizers**, `sameRoot` (`src/seatroot.mjs:36`, which leans on node `resolve` and therefore treats
`C:\Users\…` as **one relative component** on POSIX, producing `…/Durian-Pi/C:\Users\…`) and `classifyWorktrees`'
`norm` (`src/broker.mjs:988`, which does fold backslashes). Two normalizers, two verdicts for the same path — which is
exactly the failure mode their single `resolve` seam is built to prevent.

## 3. Secondary peers (pinned, one line each, ranked by how directly they answer this)

| Peer (pinned) | Mechanism worth taking | Cite |
|---|---|---|
| **hermes-agent** `07f075c2` 2026-09-24, MIT | `_local_host_hints()` injects `Host:` (WSL detected separately), user home, resolved cwd, and a **scratch dir** into the prompt; the Windows comment is *"Windows-local terminal runs bash, not PowerShell — without this the model issues PowerShell syntax"* | `agent/prompt_builder.py:905-932`, `:796-802` |
| hermes-agent | every configured cwd passes `_existing_dir()` (log + **fall through**, never win); cwd is **profile/session-scoped**, not process-global | `agent/runtime_cwd.py:74-97` |
| hermes-agent | per-OS monotonic clock (`QueryUnbiasedInterruptTime` vs `time.monotonic`) and a named per-OS wait ceiling with the verification written in the comment | `agent/sleep_clock.py:38-40`; `agent/deadline.py:55-64` |
| hermes-agent | cross-OS path **comparison** maps `C:\x` → `/c/x` explicitly before matching | `apps/desktop/e2e/core/process-census.ts:173` |
| **claude-code-docs** `58d6da1e` 2026-10-27 | scope-graded settings — user `~/.claude/settings.json` → project `.claude/settings.json` → **host-local `.claude/settings.local.json`, auto-gitignored** — with a **per-key allowlist of which scope may set which key** | `CHANGELOG.md:2919, 3539, 4330` |
| **crewai** `f3d0099d` 2026-10-28, MIT | model resolution by **role key** with a stated precedence ("the role's key wins over the model keys; with neither, declared") | `lib/crewai/src/crewai/agent/core.py:247,534-538` |
| **openhands** `6354932e` 2026-10-28, MIT | the **runtime is a separate object from the agent definition**; precedence is written where it is enforced | `src/routes/agent-settings.tsx:147`; feature-map `F13-agent-profiles.md` |

Relevant standing finding from our own comparison corpus, which this deepens: `docs/ARCH-COMPARISON-agent-fleet.md:31,108`
grades agent-fleet's Windows posture as *partial/unverified*, and `docs/BORROW-FROM-agent-fleet.md:31` records that we
**dropped** OS-level confinement because "no Windows backend; durig's cwd/tool scoping is the Windows answer". After this
read that answer is thin: our scoping stores an unvalidated path and cannot protect a worktree across hosts.

## 4. What a host-portable "team definition" would look like (for `architect`/`impl`/`devtools` to decide — not mine)

The portable unit should be **the team, not the machine**: one definition that travels, with host-specific facts living in
exactly one place, validated at wake, and named to the seat.

1. **One path seam, validate-or-fall-through.** Extend `src/seatroot.mjs` to be the only resolver, used by the sweep too:
   fold separators, map a foreign drive shape to a host shape **only for comparison**, `existsSync` each layer, and let a
   layer that fails fall through **with the reason surfaced to the seat** (hermes `_existing_dir`, oh-my-pi's
   stat-validated cwd). Retire the second normalizer in `src/broker.mjs:988` in favour of the seam.
2. **The persisted root is a *name*, not a path** (221 ruling A): store a workspace-root-relative identity, materialize
   it per host at `up`. Add the read surface 221 asks for, plus the real flag (`up --root`), since the granted remedy
   does not exist (finding 3).
3. **Layer the definition by mutability, with a per-key allowlist** (claude-code): keep `rig.selfdev.json` portable and
   make a `check` rule fail it if any tracked layer names a host-absolute path, a drive letter, or a localhost port; host
   facts stay in `durig.config.json` (already gitignored, already a `CONFIG_KEYS` member for `DURIG_SEAT_ROOT` at
   `src/config.mjs:132`). Provider URLs are already in the right layer — the tracked-layer scan came back clean, so this
   rule is cheap insurance, not a repair.
4. **Tell every seat what host it is on** (hermes `Host:` block): OS + release, whether it is WSL, home, resolved seat
   root **and which shell the shell tool actually starts**, plus the scratch-dir convention. Our store shows the cost of
   not doing this — seat reasoning in entry **#274090**: *"PowerShell is not available? … Maybe the shell is pwsh on
   Linux?"* — a seat improvising its own host model.
5. **Cut the shell dependency, or make it a declared capability** (the oh-my-pi lesson, priced honestly). Two options:
   **(A)** keep a host-registered shell (217) but publish a machine-readable *capability report* (which shell, which
   programs exist) into the seat context and into `check`; **(B)** shrink the seat-facing command surface to a small set of
   node-implemented operations (run the demo suite, a git subset, stat/list) so behaviour is identical per host without a
   shell. (B) is what oh-my-pi gets from a vendored Rust shell + in-process coreutils; we would be buying a much smaller
   version of the same property, and it must not be pretended cheap.
6. **Identity, not string equality, for worktree↔seat-root** (finding 2), and a loud refusal rather than a silent
   non-match when a stored root is of a foreign shape — the sweep should *stop and report* rather than reap.
7. **Per-host oracle smoke** (their `release_smoke`, adapted to one box): one seat turn that runs one real command and
   records the OS in the artifact, run on each host the rig is expected to operate on. That is the cross-platform evidence
   we can afford, and it is what 256's hygiene rehearsal needs anyway.

## 5. What NOT to copy

Their Rust shell and vendored brush fork (a language and licence surface we do not want, and 254/233 show how badly pins
age here); a multi-OS CI matrix (we are single-box, native-host-only per D131); container-based runtime isolation
(OpenHands' runtime abstraction is a fine idea for *them*; it violates D131 for us); and any "cross-platform" claim that
rests on builds-plus-smoke without saying so in the doc — their own workflow text is more honest than most, and we should
match the honesty, not inflate the claim.

## 6. Handoff

Decomposition is `pm`'s; nothing here was claimed, created, or routed by the delegate. Suggested ordering and row shape
are in the ROADMAP registrations this note cites (263-266) and in the spooled intent
(`cross-os-portability-20261029`, request-id in `selfdev.sqlite.broker.inbox/`). Re-check commands:

```bash
node tools/rig-portability-audit.mjs --self-test   # mechanism proof: same-host root → seat-root; foreign root → not seat-root
node tools/rig-portability-audit.mjs               # 15 findings on today's tree, exit 1
DURIG_DB=./selfdev.sqlite node cli.mjs worktree audit   # the same 12 seatRoots, from the product's own surface
git -C vendor/eval/oh-my-pi rev-parse --short HEAD      # 6f3fbc94 — the pin every citation above resolves to
```
