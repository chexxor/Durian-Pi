> **D103 rename (2026-10-18):** this record predates the product rebrand `durig` → `durian-pi`; it keeps the old name so the audit trail stays truthful.

# Security position — F22: the spawned shell inherits the seat-root boundary (confine/seatguard parity)

Item: #1581 (security), from pm START (operator batch 3, 2026-10-17); implements the position for
#254 (F22, "file tools confined to seat root but the spawned shell is not"). Companion RED probe
script (committed at `item-1581/f22-red-probes.mjs` on the same branch; targets of its probes are
scratch dirs under my seat root, cleaned up after the run).

## Scope

The **`exec` seam of `src/confine.mjs`** — the one seam through which every shell a seat can
reach actually runs:

- the seat-facing `powershell` tool flows through it: `node_modules/@earendil-works/pi-durable/dist/tools/bash.js:51`
  (`runCommand` → `env.exec(...)`), invoked with the argv array
  `[pwsh|powershell, -NoProfile, -NonInteractive, -ExecutionPolicy, Bypass, -Command, script]`;
- string commands (degraded-path probes; any direct `env.exec` string call) run through the
  resolved POSIX shell (`env/node.js:589`: "A string runs through the shell; an argv array runs
  its program directly, without shell parsing"), per C3 of the ratified
  `docs/reviews/security-confine-refusal-position.md` @7cf5a34.

One concern: **exec must obey the same `within()` predicate the file tools obey** (#1465's
boundary name: worktree = read+write; `readOnlyRoots` (default shared `.durig`) = read-only).
Everything else is narrowing on top or explicitly out of scope below.

## Threat model (what the shell can do today that the file tools cannot)

Attacker: a seat conversation (compromised, degenerate, or simply mistaken). Same Windows user
(D-ENV-AUTH), so fs barriers are policy, not partitions. All rows verified RED today via
`f22-red-probes.mjs` (exit evidence summarized in Gates).

| Threat (RED today) | Control (proposed) | Falsification probe |
|---|---|---|
| A — read outside the roots (`type ..\probe-outside\canary.txt`) | **C-R1 reach check**: every whitespace/quote-stripped token that RESOLVES via `base.absolutePath` is matched against `within(path, mutating=false)`; out-of-bounds → refuse | probe A must turn REFUSED; paired control: `type src\inside.txt` stays permitted |
| B — write outside (Set-Content anywhere) | same as C-R1 with `mutating=true` semantics: a token that resolves inside a `readOnlyRoot` or outside the worktree and the command carries a WRITE-OPERATOR form → refuse | probe B must turn REFUSED; paired control: `Set-Content .\scratch.txt` inside root stays permitted |
| C — **forge the shared queue**: write into `.durig` (spoofs item bodies the next seat reads) | **C-R2 write-legibility at the read-only root**: the `#1458` scratch rule / `#1465` read-only exemption must hold AT THE SHELL TOO: reads of `readOnlyRoots` pass; any write-form targeting them refuses | probe C must turn REFUSED; probe D must stay SUCCEEDED |
| E — reach hidden behind a variable (`$p='..'; type $p\...`) | **C-R3 fail-closed forms**: a token only PATH-FORM-shaped (absolute `X:\`, `\\`, `~`, leading `/`, `..` segment) that cannot be positively resolved through `base.absolutePath` is refused; expansion-pure tokens keep the command's OTHER tokens checked | probe E must turn REFUSED; `git commit -m "fix ../ paths"` must NOT be newly refused (quoting still stays) |
| re-parse intents (`Invoke-Expression`, `iex`, `-EncodedCommand`, internal backtick forms) | **C-R4 exact-token refusals** (precision-first, substring-safe): the exact tokens `-EncodedCommand`, `Invoke-Expression`, `iex` (at the COMMAND position or as a token) refuse | seatguard's existing guards style: canary both ways (`iex` refuses; a word containing `mix` must not) |
| gate text leaking what a refused command WOULD have read | **C-R6 no-value echo**: the refusal contains the token/path and policy only — never file contents | refusal message grep: no marker string |
| the guard silently never fires (seatguard's own structural lesson) | **C-R5 one policy**: `confine.reachRefusal(command, { root, readOnlyRoots })` is EXPORTED and consulted (a) in `confinedEnv.exec` before `base.exec`, (b) in `seatguard.beforeTool` next to `refusalFor` — two call sites, one implementation | structural canary: mismatch of the two call sites must be a visible test failure |

## Honest limits (named, not hidden)

- The reach check sees the command STRING, so it is unsound in the same way the whole string
  layer is; C3's method still applies: refuse the FORMS wherever they parse (both parse contexts
  above), and keep each control minimal: (i) reach on RESOLVABLE tokens is substantial; (ii) escaping paths via PowerShell-full-expression forms that don't
  RESOLVE (dense variableaths, `-EncodedCommand`, subexpressions) are refused by C-R4/fail-closed
  forms; (iii) what slips BOTH is the residual risk row — the deeper fix is the
  **job object/AppContainer sandbox** the M3 position already named as the strongest option
  (`docs/SEAT-TOOLS.md` "What would change this answer"); `src/job-object.mjs` is process-tree
  reaping (KILL_ON_JOB_CLOSE), NOT path containment — do not promote it in the threat model.
- The write-OPERATOR heuristic (what makes mutating=true) is a NAMED token set
  (redirections `>`, `>>`; cmdlets Set-Content/Add-Content/Out-File/New-Item/Copy-Item/Move-Item/
  Remove-Item and their short aliases sc/ac/ni/cp/mi/rm/del/rd/ri) — deliberately
  PRECISION-FIRST like the commit-time secret gate (#1317): a missed write-form is a residual
  risk row, not a widening.
- `.durig` reads stay shell-reachable (probe D) — that is #1465's POINT; the invariant is
  reads-yes / writes-never for anything outside the worktree.

## Gates (must hold before any code lands)

1. RED evidence on file (this branch's `f22-red-probes.mjs` run): A/B/C/E SUCCEEDED, D SUCCEEDED,
   B and C landed files — the gap is real; C is the queue-spoof (worst).
2. GREEN canaries land in `demo/confine.test.mjs` following the house pattern (paired unguarded
   control for every refusal; a skipped-symlink case reports itself, never silently).  RED FIRST:
   the canaries must fail against the CURRENT `confine.mjs` and pass with the gate.
3. `node demo/confine.test.mjs` and the full demo suite stay green after; `npm test` suite is
   untouched by the position aside from the new canaries.
4. No refusal path prints a file VALUE; no probe touches a real secret (decoy content only).
5. `seatguard.mjs` gains the SAME gate on `powershell`/`bash` calls via the exported shared
   function, keeping "one policy list" true in the direction that matters (the guard cannot be
   narrower or wider than the env by accident).
6. Route adoption to pm; the sole code-side owner for the gate is `impl` after a `security.sec`
   re-read of this position; qa falsifies.

## Non-goals

- NOT an OS sandbox (AppContainer, distinct OS user) — the operator decision that M3 named
  strongest; unchanged.
- NOT the coordinator/no-tools surface (COORDINATOR_REMOVALS) — unchanged.
- NOT codemode minted-capability scoping (its own positions; T0-T2 held separately).
- NOT the degraded VERB/arg grammar's shape (C5) — C-R1 composes BELOW it (wrong-root refuses
  first, then the reach gate; both fail closed).

## Citations

- `src/confine.mjs` — `confinedEnv`/`authorEnv`/`verifierEnv`, `PATH_METHODS`, `within()` (#1465),
  `refusalFor` policy list, `operatorGranted` (D-ENV-AUTH).
- `src/seattools.mjs:126` (`shell: createPowerShellTool()`), `makeSeatEnv` (fail-closed
  non-roster→verifier env; `readOnlyRoots` thread-through per #1465).
- `src/seatguard.mjs` — `SHELL_TOOLS` {bash, powershell}, `refusalFor` sharing, commit-time secret
  gate (#1317/G-B fail-open record + standing fail-CLOSED generalization), afterTool redaction.
- `node_modules/@earendil-works/pi-durable/dist/tools/bash.js:51,118-131` — the powershell tool's
  exec seam and argv construction.
- `node_modules/@earendil-works/pi-durable/dist/env/node.js:589-605` — string-through-shell vs
  argv-direct; `spawn` (line 115) and the taskkill tree-kill path.
- `docs/SEAT-TOOLS.md` SC1-SC3; `docs/reviews/security-confine-refusal-position.md` @7cf5a34
  (C1/C3/C4/C5); `#1465` (254b26e + 9090728 junction follow-up); `#1458` scratch rule; `#1317`,
  `#1315`'s position family (commit gate fail-open record).

## What this position changes in the M3 chain

Nothing ratified is widened. C1's metachar class keeps exactly its C3 ruling (armor +
accepted nonzero FP); the degraded grammar keeps its permit set; the reach gate ADDS the
boundary exec lacked so far — the same rule the file tools already enforce — at the SAME seam,
so "the boundary is the execution environment" becomes TRUE for the shell too.
