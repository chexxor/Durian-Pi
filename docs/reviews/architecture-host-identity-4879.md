# Host identity for a seat: derived at one seam, never declared per seat

*Architecture review of the design half of ROADMAP 217, split out by lead's ruling (#4864 item 3) as queue row #4879. Tree: `item-4879` @ `e01e9256` (fork of main `f192f543`), dependency set `@earendil-works/pi-durable` 1.3.0 as resolved by this worktree's lockfile. Every number below came from a command in this tree, not from memory.*

## The question as it arrived

"No seat definition names its host OS or which shell its shell tool starts. What would that field mean, who writes it, what happens when it disagrees with the store, how would 263's resolver and 264's surfacing consume it, and is it needed at all once availability-based selection exists?"

The last clause is the only one that matters, and the answer is measured: **it is not needed, and adding it is the failure it is meant to prevent.** What is needed is one seam that *derives* host identity and a rule that every consumer reads that seam instead of re-deriving it.

## Measured, in this tree

1. **A seat definition carries no host or shell key.** `rig.selfdev.json`: 12 seats, field union `name, role, goal, constraints, capabilities, model, thinkingLevel, instructionsFile` — no `hostOs`, no `shell`, no `platform`. (`node tools/probes/host-identity-4879.mjs`, first block.)
2. **Selection already answers the question without a field.** `shellPlan()` (`src/shellregistry.mjs:200`) on this box reports `platform=linux name=bash startedBy=/usr/bin/bash degraded=false`, with `powershell` in the `tried` list as `offered:false` (RM-306 withhold) — so `offeredShellNames()` is `bash` and `withheldShellNames()` is `powershell`, decided by the host the process is on, not by anything a seat declares.
3. **A declared host, if it fed selection, reproduces 217.** `shellPlan({platform:"win32"})` — i.e. what a rig-declared `hostOs: "win32"` would mean on this Linux box — returns `name=powershell startedBy=null degraded=true`. That is the exact shape of the 22 `spawn … ENOENT` results `tools/channel-preflight.mjs` §7 counts. `src/shellregistry.mjs:51-56` already records this as the deliberately-excluded edge: no `hostOs`, no per-seat `shell`, no per-seat override.
4. **The seat knows its tool but not its host.** The seat-facing sentence is emitted from the same plan (`cli.mjs:623` joins `compilePersona(seat), shellToolLine(), PROTOCOL`), and `shellToolLine()` (`src/shellregistry.mjs:270`) prints: *"Run the oracle through the shell tool registered on THIS host: the `bash` tool (resolved to /usr/bin/bash). No `powershell` tool is registered on this host …"*. It names the tool and the program; it does **not** name the OS, and `shellPlan`'s `platform` field — carried "IN the verdict" per #4977 — is never printed to the seat. 264's acceptance ("a seat asked what host it is on, and what its shell tool runs, answers from context") is half met: shell yes, host no.
5. **The resolver does not qualify the host at all.** `resolveSeatRoot` (`src/seatroot.mjs:28`) returns `{root, source}` for a persisted cwd with no existence check and no shape test. Feeding it the Windows-era value `C:\Users\Alex\Durian-Pi` on this POSIX box returns it verbatim, and `classifyGitRoot` (`src/seatroot.mjs:49`) then walks up from a path that does not exist and reports `linked-worktree` — a phantom root classified as a real tree. 263's acceptance names the seat, path, shape and OS; nothing in the chain names a shape or an OS.
6. **Three normalizers answer "is this the same tree" three different ways.** `sameRoot` (`src/seatroot.mjs:36`): `resolve()` + lowercase — folds `C:\Users\Alex\x` into one relative component. `classifyWorktrees`' `norm` (`src/broker.mjs:1094`): backslash fold + lowercase, no drive mapping. `hostNormalize` (`tools/rig-portability-audit.mjs:53`): separator fold, case fold **and** the POSIX↔drive mapping — and the audit then feeds its own normalized roots into the product classifier (`tools/rig-portability-audit.mjs:135`). The instrument knows the mapping 263 says the resolver should own, and it is the only one that does. 263's own "Do not:" is "add a third normalizer in the fix" — there already is one, outside the product.
7. **The rig's live state.** `node tools/rig-portability-audit.mjs --db /home/chexxor/Git/Durian-Pi/selfdev.sqlite --rig /home/chexxor/Git/Durian-Pi/rig.selfdev.json` → **exit 1, 1 finding** (`seat-host-unaware`, ROADMAP 217), 12 seat roots read, 70 worktrees, 0 rig-file declared cwds, plus the note *"NO ./durig.config.json: a moved workspace has no host config at all"*. The row's premise cited 2 findings at main `3860e5d1`; the store-carried roots half is no longer red here, so the only remaining 217 finding on this tree is the naming one.

## The contract, drawn before the discussion

Three layers, and each has exactly one kind of value that may live in it:

| Layer | File | What may live there | Who writes it |
|---|---|---|---|
| Rig definition (tracked, portable) | `rig.selfdev.json` | seat identity: name, role, goal, capabilities, model | operator |
| Host-local config (gitignored) | `durig.config.json` | values that are true *of this machine*: paths, provider endpoints, an optional host-class expectation | operator |
| Live process | `process.platform`, PATH, the filesystem | every fact used to *decide* | nobody; it is observed |

Host identity is a property of the **process**, not of the **seat**. A seat is a role that survives a host move; the host is the machine the broker is running on. Putting a host field in layer 1 makes a portable artifact host-coupled — which is 265's defect inverted, and it is the layer the audit already flags when it finds a drive letter in a tracked file.

So the seam is: **one derived object, produced once per process, read by every consumer.**

```
live host (platform, PATH, filesystem)
        │
        ▼
  hostIdentity = { platform, wsl?, shell{name, programs, startedBy, degraded}, seatRoot{root, source, kind, shape}, hostClass }
        │
        ├──► tool registration      (src/shellregistry.mjs selectSeatShell)   — ALREADY does this
        ├──► guard refusal          (src/seatguard.mjs:22,186,425-430)         — ALREADY reads the plan
        ├──► seat prompt            (cli.mjs:623 shellToolLine)               — reads the shell, NOT the host  ← gap
        ├──► path resolution        (src/seatroot.mjs resolveSeatRoot)        — reads no host at all          ← gap
        ├──► worktree keep-guard    (src/broker.mjs:1094 norm)                — its own normalizer            ← gap
        └──► instruments            (rig-portability-audit, channel-preflight, doctor)  — their own mapping    ← gap
```

An instrument may *read* vendor text; it must not *gate* on it (#4977). The same rule applies inward: an instrument may report a host fact; it must not be the only place that computes it.

## Options considered

**(a) Add `hostOs` and/or `shell` to the seat definition (the literal 217 second finding).** Rejected. It creates a second source of truth about a fact the process can observe directly, in the layer that must stay portable. The concrete harm is measured above: a declared value that feeds selection produces a degraded registration — a registered tool with no startable program — which is the 217 incident, recreated by the field designed to prevent it. It also fails at the wrong time: the declaration is wrong *before* the host moves, and correct *after*, which is exactly backwards for a prevention mechanism.

**(b) Derive host identity at one seam; allow an operator-declared host class only as an expectation, in the host-local layer, never gating.** Chosen. `shellPlan()` is already that seam for the shell half; extend it (or a sibling `hostIdentity()` in `src/seatroot.mjs` / `src/shellregistry.mjs`) so the resolver, the prompt, the guard and the instruments all read the same object. An operator declaration is useful for exactly one thing: asserting "this deployment is a Linux host class", which is what RM-306's `offeredOn(host)` already uses. It may label a divergence; it may not decide selection.

**(c) Do nothing beyond the shell selection.** Rejected. 264's context half is unaddressed and the seat improvises: the store entry #274090 recorded a seat reasoning *"PowerShell is not available? … Maybe the shell is pwsh on Linux?"*. A seat that cannot name its host writes commands for the wrong host, and its completions become unverifiable — `tools/channel-preflight.mjs` §7 says the consequence directly: with no startable shell, a seat "cannot satisfy the constitution's oracle, and every completion it reports is self-declared".

**The trade-off I accept for (b):** the seat's host facts are always as current as the process, and never as authoritative as an operator's intent. If a host-local declaration ever becomes load-bearing for policy, the drift is visible rather than enforced. I accept un-enforced drift over enforced staleness, because a stale gate stalls every pass and no seat can fix it — the same reasoning `docs/DECISIONS.md:3977` records for model drift: **labeled, not gated**.

## Failure modes, each with a recovery path

| Mode | What happens | Recovery |
|---|---|---|
| **Silent** — declared host disagrees with live host | nothing notices, until a spawn fails | the derived identity is printed with the declaration alongside it; divergence is a labeled audit finding, never a gate (D at `docs/DECISIONS.md:3977` point 5) |
| **Contradiction** — two normalizers disagree on "same tree" | the keep-guard cannot fire on a moved host (266), and the audit disagrees with the product | one normalizer, owned by `src/seatroot.mjs`, imported by `src/broker.mjs` and the instruments; probe assertion: the three-way check in `tools/probes/host-identity-4879.mjs` goes green only when one remains |
| **Cascade** — a declared host feeds selection | the seat's shell tool has no startable program; every completion is self-declared | selection never reads declarations (measured: `shellPlan({platform:"win32"})` on this box is `degraded:true`); the registration still names the tool and reports `degraded`, and `src/seatguard.mjs:425-430` refuses a withheld name with the host reason rather than pi's generic "not available" |
| **Loop** — drift becomes a pass gate | every pass stalls while the operator is away; a seat cannot legitimately fix it | drift is a standing line, not a gate (ruled); falsifiable: no pass path may abort on a host-mismatch finding |
| **Context** — the seat does not know its host | it improvises shell syntax and paths (store entry #274090) | the prompt block names platform, the registered shell, where it resolved, and the seat root's kind — from the same plan that registered the tool, so the prompt cannot disagree with the guard (`demo/seat-shell-wording.test.mjs` already pins that join) |
| **Partial** — resolver returns a stored root it never validated | a phantom root is classified as a real tree and the seat writes to nothing | `resolveSeatRoot` returns `{root, source, kind, shape, reason}`; a foreign-shaped value is refused and named, never silently joined; the sweep calls the resolver rather than re-deriving (266's acceptance is that the two agree *because they call each other*) |
| **Hard** — nothing startable on the host | the seat has no shell verb | `shellPlan` degrades to the platform-preferred tool rather than to empty, deliberately (never `undefined`), so the failure is a named spawn error the guard can explain, not a missing verb |

## What this row should NOT produce

- No `hostOs` / `shell` column on a seat definition. That is the rejected edge and it stays rejected.
- No hand-editing `rig.selfdev.json` to smuggle host facts into the portable layer (264's blind spot names it explicitly).
- No fourth normalizer. Consolidating to one is a single change, not a per-surface patch.

## The falsifiable probe

`tools/probes/host-identity-4879.mjs` runs the product's own functions — `shellPlan`, `shellToolLine`, `resolveSeatRoot`, `classifyGitRoot`, `sameRoot` — and the rig file. Run: `node tools/probes/host-identity-4879.mjs` → **exit 1** on this tree, with three named owed items:

1. the seat-facing line does not name the host class (`shellToolLine()` prints tool and path, not `platform`);
2. the resolver does not name a shape or an OS for a stored root (`resolveSeatRoot` returns `C:\Users\Alex\Durian-Pi` verbatim; `classifyGitRoot` then calls it `linked-worktree`);
3. three normalizers exist where 263 requires one, and the drive↔POSIX mapping lives in the instrument instead of the resolver.

The acceptance criterion for the work, then, is not "the field exists". It is **this probe going green**: one normalizer, one derived identity, and every consumer — prompt, resolver, guard, sweep, instrument — reading it.

## Ownership of what follows (routing, not deciding)

- The resolver's shape and validation is **impl's**, under 263 (`docs/ROADMAP.md:5348`).
- The prompt block naming platform/WSL/root is **devtools'**, under 264 (`docs/ROADMAP.md:5373`); `demo/seat-shell-wording.test.mjs` already pins the join at `cli.mjs:623`, so extending `shellToolLine()` inherits that guard.
- Whether the operator-declared host class is worth a `durig.config.json` key at all is a **scope** call for `lead`; the mechanism exists (`offeredOn`) and today there is no `durig.config.json` on this rig at all, so the layer is empty rather than unused.

Durable decision recorded as ADR **D265 (provisional)** in `docs/DECISIONS.md`.
