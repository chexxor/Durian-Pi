> **D103 rename (2026-10-18):** this record predates the product rebrand `durig` → `durian-pi`; it keeps the old name so the audit trail stays truthful.

# Ruling #1505 — `git rev-parse HEAD@{1}` against the C1 metachar class: KEEP REFUSED

Item: #1505 (security), asked by pm; inputs: impl #1503 / branch `impl-item-1444-fix` @ fec14b7,
ratified position `docs/reviews/security-confine-refusal-position.md` @ 7cf5a34 (branch
`security-item-1445`, item #1475), qa re-falsification #1502 in flight.

## The edge, restated with the controlling text

- **C4 ordering** (position 7cf5a34, "C4"): `DENIED_COMMANDS` → **degraded metachar test** →
  degraded arg/option grammar → `READ_ONLY_COMMAND` allowlist. The metachar test runs on the WHOLE
  command string BEFORE any token rule is consulted.
- **C1 class** (7cf5a34 "C1"): `/[;&|`<>$(\)\n\r^%*?\[\]"'@]/` plus literal `--%`. `@` is in the class.
- **C5 token rule** (7cf5a34 "C5"): non-flag ref tokens are `^[A-Za-z0-9_][A-Za-z0-9._@{}~-]{0,63}$` —
  leading char may NOT be `@`, but the MID-token class admits `@{}`, and its own prose says it
  "covers `HEAD~1`, `HEAD@{1}`, dotted tags".

So `git rev-parse HEAD@{1}` passes the C5 token rule yet never reaches it: C1's whole-string test
veto first. impl kept it refused at fec14b7 (fail-closed) and encoded
`REFUSED: git rev-parse HEAD@{1}` as an explicit demo probe.

## Finding (documentation consistency — severity LOW)

**Claim:** the ratified position contradicts the implemented+probed behavior in two places; the
CODE is safe (fails closed).

- **(a)** Position "C5" promises the mid-token class "covers … `HEAD@{1}`". Under C4's ordering that
  coverage is dead-letter: no token containing `@` ever reaches the token rule.
- **(b)** Position "C3(ii)"/metachar table records `@` as "kept at zero FP cost". False: `HEAD@{1}`
  is a legitimate SHAPED degraded read the class refuses — that is a nonzero, accepted FP cost.

**Exploit path:** none in execution today — the guard refuses the command. The exposure is the
record: an auditor (or a later seat widening the guard) reading C5's "covers `HEAD@{1}`" can treat
its admission as ALREADY-ratified intent and land it as a doc-conformance change, bypassing the
scrutiny a C1 change deserves — the same failure class the position itself names: an unstated
assumption is "the 'non-existing gate cited as if it held' defect".

**Concrete fix (fold at landing, no code change):**
1. In C5 prose, drop `HEAD@{1}` from the "covers" list or mark it "nominally matched, vetoed by C1 —
   see ruling #1505".
2. Record `@`'s status as "armor + accepted nonzero FP (victim: reflog tokens), NOT zero FP cost",
   same table row treatment as `^`/`%`.
3. Add the REFUSED probe `git rev-parse HEAD@{1}` to the position's falsification list
   (impl already encoded it in demo G-6 at fec14b7).

## Ruling

**KEEP REFUSED. C1 is NOT amended.** fec14b7's handling is ratified as-is.

1. **Fail-closed doctrine, already verified.** The refusal is demo-enforced; the oracle is green at
   the branch tip (evidence below).
2. **No in-charter need demonstrated.** Degraded mode's charter is root diagnosis plus the ancestry
   oracle (`merge-base --is-ancestor`, plain refs/SHAs). No item currently flows through degraded
   mode requires reflog reads. (#1494 dangling-ref work may benefit — that is #1465/#1494's scope,
   not adjudicated here.)
3. **Parse armor, not conservatism.** New probes (this ruling, re-runnable evidence below):
   - `bash -c "echo a@{b}"` → literal `a@{b}`, exit 0 — inert under the resolved POSIX exec shell.
   - `powershell -NoProfile -Command "Write-Output a@{b}"` → **exit 0 with TWO output lines**
     (`a@` newline `b`): a single argument containing mid-token `@{...}` is RESTRUCTURED at
     PowerShell parse time instead of staying one literal token. Whether a leading-dash payload can
     ride that restructuring is UNVERIFIED — which is exactly why the FORM stays refused: the guard
     must refuse parse-structure forms wherever they are parsed (C3's method), and PowerShell is the
     plausible fallback family when Git Bash is absent (env-dependent resolution, per position C3).
   - `powershell -NoProfile -Command "Write-Output @{b}"` → ParserError, exit 1 (token-start form).

   Net: `@` earns its seat in C1 as armor against argument restructuring on the fallback family —
   the `^`/`%` argument's SIBLING, but with a demonstrated mechanism. Dropping `@` would trade a
   demonstrated fallback-parse risk for a diagnosis convenience nothing currently needs.

## The follow-up worth queueing (for pm — do NOT start now)

Trigger-gated on a CONCRETE degraded-demand for reflog forms (candidate trigger: the #1494/#1465
dangling-ref family). If it fires, the narrow fix is a C1 TOKEN exception, not a class change:
- Exempt only a token that FULLY matches a reflog form (e.g. `^(?:[A-Za-z0-9_~-]+)?@\{[A-Za-z0-9~-]+\}$`),
  and only for `rev-parse` (resolver, content-free output) — never drop `@` from the class, never
  admit `@` outside a fully-matching token.
- New demo probes both directions (ALLOWED `git rev-parse HEAD@{1}`; REFUSED malformed
  `HEAD@{1`, `HEAD@{1}}, {`, and a compose attempt), plus a PS-fallback parse probe if the
  PowerShell family ever becomes reachable, and fresh qa falsification.
- NOT NOW: landing pass #1448 is live and #1502 falsifies fec14b7 — amending C1 mid-pass churns a
  verified tip for no demonstrated need.

## Evidence (re-runnable; run 2026-10-17, security seat, item-1505 worktree)

| Command | Exit | Notes |
| --- | --- | --- |
| `git worktree add --detach <seat-root>/item-1505-gw fec14b7` then `node demo/confine-degraded.test.mjs` there | **0** | PASS — includes G-6 `REFUSED: git rev-parse HEAD@{1}` and C3 shell probes; throwaway worktree unlocked and removed after |
| `bash -c "echo a@{b}"` | 0 | literal `a@{b}` — mid-token `@` inert under POSIX/Git Bash |
| `powershell -NoProfile -Command "Write-Output a@{b}"` | 0 | TWO output lines (`a@` / `b`) — mid-token `@{...}` restructures the argument on the PS family |
| `powershell -NoProfile -Command "Write-Output @{b}"` | 1 | ParserError: Missing '=' in hash literal — token-start form refused by nature |

## Non-goals

- NOT a ruling on #1494/#1465 scope (shared `.durig` read path).
- NOT a re-opening of C5's arg-rule ruling (#1475) — the resolver verbs stay arg-ruled.
- NOT the healthy-root path — degraded mode only, per the position's own Non-goals.

Routing: ruling to impl (fold the three corrections at landing; no code change); follow-up
registration draft to pm (trigger-gated, above); qa continues #1502 against fec14b7 unchanged.
