> **D103 rename (2026-10-18):** this record predates the product rebrand `durig` → `durian-pi`; it keeps the old name so the audit trail stays truthful.

# SECURITY POSITION — confine wrong-root refusal contract (D1)

**Status: position by the `security` seat, item #1445, 2026-10-17. Ratifies/corrects impl's fix
sketch (`#1440`/D1, from qa's VERIFY #1215 FAIL — #1265) for `src/confine.mjs`'s degraded
(wrong-root) exec path. Per-item artifact; no standing security-doc set (lead #1297). Not a
verification — qa verifies impl's fix; this seat positions.

**Revised (#1475, 2026-10-17).** Impl's D1 fix has LANDED (#1444; branch impl-item-1444-fix,
delivered as #1473) and FALSIFIED C3's shell assumption — the confine exec shell is POSIX, not
PowerShell-family (probes recorded in C3). C3 is rewritten as a falsified-by-probe record;
C1's PS-array rationale is marked moot; C5 rules `rev-parse`/`describe`/`merge-base` arg-ruled
rather than bare-only. qa re-falsifies impl's landed code as #1472.

**Rebased (#2316, 2026-10-19) onto main over impl-item-1519's fold of ruling #1505:** the fold's metachar-table row, caret/percent posture and routing split are carried in this text; superseded is only C3's then-open shell question (resolved by the falsified-probe record below); the D103 rename note is restored verbatim.

**Grounding (read this session at `419ced7:src/confine.mjs`):** the allowance comment L83–87 (the
module calls READ_ONLY_COMMAND "a NARROWING convenience, never the boundary" and states the
invariant: "everything not matched is refused while the root is wrong"); the regex L89
(`/^\s*(?:git\s+(?:status|log|diff|show|rev-parse|describe|merge-base|ls-files)\b|(?:ls|dir|pwd|cat|type)\b|node\s+--check\b)/i`);
`confinedEnv(..., expectWorktree)` L209; `rootRefusal = expectWorktree ? primaryCheckoutRefusal(...)` L215
(`.git` is a DIRECTORY = shared checkout = refuse), fail-open `catch { return null }` on its own hiccup L122–124;
exec wiring L350–360: `DENIED_COMMANDS` first → `rootRefusal !== null && !READ_ONLY_COMMAND.test(...)`
→ run with `cwd = confinedRoot`, `inheritEnv: false`, allowlisted env, `DURIG_EXPECT_WORKTREE=1` projected.
qa's D1 probes compound and redirected forms (`git status; git switch -c pwned2`,
`git status && git switch -c pwned9`, `git log && echo x > pwned10.txt`, `cat rig.json > pwned.txt`,
`ls > pwned3.txt`, `node --check cli.mjs && echo x > pwned7.txt`) — all RAN in the shared
checkout. CORRECTION (#1475): qa ran them in qa's PowerShell TOOL surface — which is NOT the
confine exec shell; the exec shell is POSIX (C3). The refusal is string-level, so the witnesses
stand under either shell: `;`, `&&`, `|`, `>` and digit/`*`-prefixed redirects are
composition/redirect metachars in PowerShell AND in POSIX sh. (The alias reading `ls`/`cat`/
`type` was a PowerShell reading; under POSIX `ls` is real, `type` is a builtin reporter, and
`cat`/`type` are removed by C2 anyway.)

## Scope

The boundary: one check between a seat's command string and a process spawn. The degraded state is
`rootRefusal !== null` — the seat's tools point at the SHARED checkout (the #1186/#1196 shape:
binding missing → root fell back silently). The failure is cross-seat by construction: the shared
tree carries other seats' uncommitted work, and `.git` there is the repo's whole ref namespace
(every seat's item branch). D-ENV-AUTH stands: same Windows user, no OS layer — the app-layer
check IS the control, so its grammar must be complete or it is decoration.

## Threat model — what the degraded check must own

| Channel (each with a D1/qa-observed or structural witness) | Must refuse while rootRefusal, because |
|---|---|
| Composition: `; & && \|\| \| $ ( )` backtick `\n \r` | they turn one spec-read string into a second, unconfined command (the pwned2/pwned9/pwned10 witnesses). |
| Redirect: `> >> <` incl. digit-prefixed `2>` / `*>&1` | the file-write layer: `ls > pwned3.txt`, `cat rig.json > pwned.txt` wrote unconfined files. Character-class catches digit-prefixed and merged forms because `>` itself matches. |
| Parse-mode escapes: quotes `"` `'` (hide metachars from the scan in PowerShell AND POSIX sh); PS here-strings/arrays `@` (PS-only — MOOT for the POSIX exec shell, kept at zero FP cost, see C3); cmd var-expansion/escapes `^ %` + stop-parse `--%` (cmd-family defense-in-depth only, see C3) | they hide a metachar from/affect any string-level scan (the class refuses the HIDING form too — quoting is not needed by any allowed bare verb, so the FP cost is zero in degraded mode). |
| Read-array globs: `* ? [ ]` in arguments | a degraded read runs against the SHARED tree; a glob argument (PS `Get-Content *`, POSIX `ls *`) sweeps other seats' files; filenames-only for `ls` shapes, content for removed verbs below. |
| Config-exec inside accepted verbs | **the sketch's structural miss:** `git -c core.fsmonitor=<path> status` and `git diff --ext-diff` EXECUTE configured helpers while matching the read prefix argument-for-argument; `=`/`:`-bearing git args must be refused (or via the option grammar below). |
| Arg paths in allowed verbs | any argument token that is absolute, UNC (`\\`), drive-leading (`C:` contains `:` anyway), `..`-containing, or separator-carrying points OUTSIDE the tree even for a "read" (`git show <rev>:<path>` reads ANY ref's tree — other seats' item branches, stashes). |

## Corrections to impl's sketch

### C1 — metachar class: RATIFIED as the necessary layer, EXTENDED per table
From `/[;&|`<>$(\n\r]/` to `/[;&|`<>$(\)\n\r^%*?\[\]"'@]/` plus a literal `--%` check.
Every element's reason is in the table above; `[`/`]` added for POSIX glob classes (PS-array-rationale moot under the POSIX shell, C3);
`^`/`%` defend the cmd-FAMILY parse fallback only — C3 records the identified exec shell is
POSIX; they stay as defense-in-depth at zero FP cost, not as a PowerShell-family assumption.

### C2 — the allowed read-only set while degraded: SHRUNK — removals are load-bearing
- **`cat` and `type`: REMOVE entirely from the degraded set.** They cannot diagnose a wrong root
  (root diagnosis is `git status`, bare `ls`, `pwd` — and the refusal's own remedy:
  `prepare_workspace`) and they are the arbitrary-content channel:
  every argument — even single-segment — reads the SHARED tree, whose working files ARE other
  seats' uncommitted work. There is no argument rule that repairs reading the wrong tree.
- **`git show`: bare only.** `git show <rev>` and `git show <rev>:<path>` read arbitrary refs —
  including other seats' private item branches — from the shared `.git`. Bare `git show` (HEAD's
  commit) stays: it is pure diagnosis.
- **`git diff` / `git log` / `ls-files`: bare or a fixed small display option list** (`--oneline`,
  `-s`, `--stat`, `--name-only`, `--name-status`, `-n`); any other/unknown token → refuse.
  This is what closes `--ext-diff` and `-c core.fsmonitor=…` structurally (C1's char class alone
  would not: those tokens are alphanumeric-and-dash).
- **`ls` / `dir`: bare only** (or with the same fixed option list); `pwd` bare (it is a no-op
  reporter in either shell).
- **`node --check <file>`: stays, under the arg rule** — the file token must be single-segment
  relative: `^[A-Za-z0-9_.][A-Za-z0-9_.\-]{0,63}$` on every non-flag token, and no token contains
  `..` (no leading `-`). `--check` is parse-only; syntax errors quote the offending line of the
  checked file, which is a tree-state read the same allowance already accepts for bare `diff`.

### C3 — the exec shell, positively identified by falsified probes: POSIX
This position originally read the degrade-path exec shell as PowerShell-family, inferred from
qa's D1 probe surface. FALSIFIED by impl's landing probes (`#1444`, delivered `#1473`):
pi-durable's `dist/env/node.js` resolves the exec shell as Git Bash / `/bin/bash` / `sh -c` —
POSIX (`sh -c <string>`). Probe record (run by impl; re-run is qa's, `#1472`): `echo (1+1)` →
exit 2 and `Write-Output x` → exit 127. Under PowerShell-family the first would print `2`
(exit 0) and the second would print `x` (exit 0); what they actually returned are a POSIX
subshell parse error and a POSIX command-not-found — the shell is POSIX. The check must NOT be
tuned to one shell: the metachar class is string-level and refuses the composition/redirect/
hiding FORMS wherever they are parsed (POSIX today; the fallbacks below stay covered).

**`^`/`%` ruling: KEEP (impl already adopted C3(ii)) — cmd-family defense-in-depth, zero FP cost.**
They are cmd escapes / var-expansion — not PowerShell-family metachars and not POSIX metachars;
under the identified POSIX shell they defend nothing at this path TODAY. They stay because
(a) shell resolution is env-dependent (Git Bash missing → a ComSpec/cmd fallback is the plausible
failure mode) and (b) no allowed degraded verb token legitimately contains either, so the cost is
zero — refused-but-never-legit beats unlisted-legit exposure. The literal `--%` check and the
`@` element carry the same status (`--%` is cmd stop-parse; `@`'s PS-array rationale is MOOT
under POSIX — both kept at zero FP cost). The record, here and in code comments, must NOT imply
a PowerShell-family exec shell. The method lesson stands: an unstated shell assumption is
exactly the "non-existing gate cited as if it held" defect — hence this falsified-by-probe
record instead of a silent edit.

### C4 — ordering, and no prose rot
The degraded grammar runs: standing `DENIED_COMMANDS` → degraded metachar+`--%` test → degraded
arg/option grammar → `READ_ONLY_COMMAND` allowlist. And the L83–87 comment must be updated WITH
the fix ("everything not matched OR composed is refused") — the
2026-10-16 lesson was prose guards rotting against enforced reality; comment + demo probes land
in the same commit.

### C5 — RULING: `rev-parse` / `describe` / `merge-base` keep the ARG RULE — bare-only REJECTED
Impl asked whether the three ref-resolver verbs should join `git show`'s bare-only rule or keep
C2's arg rule (`#1475`). RULING: **the arg rule — bare-only is wrong for these three.**
- **Why positively:** all three are pure resolvers — their output is refs/sha1s/names (metadata,
  content-free). The reason C2 keeps `git show` bare-only — it prints argument-chosen OBJECT
  CONTENT from any ref — does not apply: a resolver cannot print content.
- **Why negatively:** bare-only `merge-base` would delete a check other items REQUIRE:
  `git merge-base --is-ancestor <base> <tip>` is the ancestry oracle behind the planned
  "blocked-on-base" attention rule (`#1468`) and the landing-pass per-tip verification practice
  (`#1443`, variant authorization `#1429`). Refusing args there is a functional regression of a
  security-relevant check for no security gain.
- **Conditions (falsifiable; fold into the option grammar):** non-flag ref tokens: leading char
  must be `[A-Za-z0-9_]` — no leading `~` (POSIX tilde-expansion at token start can expand to an
  account HOME, absolute and outside the tree; must be excluded at the string level), no leading
  `-` (options go through the fixed list), no leading `.`/`{`/`@`; mid-token class
  `[A-Za-z0-9._@{}~-]` (covers `HEAD~1`, `HEAD@{1}`, dotted tags; `{}` mid-token only — brace
  expansion is a non-POSIX bash feature, absent from POSIX-mode `sh -c`); and no token contains
  `..`, `/`, `\`, `:`, `=` (the config-exec and arg-path rows stay binding for these verbs).
  Leading-`-` OPTION tokens are governed by C2's fixed-list mechanism — any token not on the
  verb's fixed option list is refused (this kills `--git-dir`, `--parseopt`, and
  `-c <k>=<v>`-style carriers for these verbs). The fixed lists must include what legitimate
  diagnosis needs — `merge-base --is-ancestor` at minimum — and nothing free-form;
  `describe --dirty` must NOT be listed (it reads the shared worktree's dirty state).
- **Falsification probes (guard verdicts are the object; git's own exit code after the guard is
  irrelevant):** ALLOWED — `git rev-parse HEAD`; `git merge-base --is-ancestor <ref> <ref>`;
  `git describe v1.0.0` / bare `git describe`. REFUSED — `git rev-parse --git-dir ../elsewhere`;
  `git rev-parse --git-dir=../elsewhere`; `git -c core.fsmonitor=anything rev-parse HEAD`;
  `git describe ../../x`; `git merge-base HEAD ../..`; `git rev-parse ~<user>`; `git show-ref`;
  `git for-each-ref` (branch-name enumeration of other seats' items is not an allowed read and
  must stay absent from the allowlist).

## Non-goals
- NOT the healthy-root exec path: when `rootRefusal === null`, the full harness tool boundary
  governs; this contract is degraded-mode only.
- NOT OS-level confinement (D-ENV-AUTH): same user throughout; the degraded grammar is the
  app-layer control, full stop.
- NOT the file-tool write path or the git state-mutation guard (`#1266`/`#1312` lineage) — those
  are separate layers; the degraded grammar's redirect refusal composes with them: never a
  single layer.

## Gates for the impl follow-up (offline, falsifiable)
1. **G-1 (class):** the corrected element set lands; every D1 witness probe is REFUSED
   (`;`, `&&`, `>` forms) plus the additions: `git status 2> f`, `'' | %{ git switch -c x }`,
   `` "`& git switch" `` (backtick-adjacent), `git status --% & x`, quoted-hiding form.
2. **G-2 (removals):** while rootRefusal, `cat x`/`type x` REFUSED; `git show HEAD:src/f.mjs`
   REFUSED; `git diff -- ../outside` REFUSED; bare `git status` / `git diff` / `git show` /
   `node --check cli.mjs` / `ls` / `pwd` ALLOWED.
3. **G-3 (write-nothing invariant):** for every allowed degraded form, a tree snapshot before and
   after shows zero mutations — a bare verb must not be a write.
4. **G-4 (grammar for git options):** `-c`-with-`=` args and `--ext-diff` are refused as
   unknown-option tokens while degraded (the grammar is the control, not vibes).
5. **G-5 (comment):** L83–87 invariant text updated in the same commit as the code fix.
6. **G-6 (ref-arg verbs, C5):** `git merge-base --is-ancestor <ref> <ref>` with single-segment
   ref-shaped tokens is ALLOWED; any leading-`-` token outside the verb's fixed option list, any
   token containing `..`, `/`, `\`, `:`, `=` or a leading `~`/`@`/`{`/`.`, and the enumeration
   verbs `git show-ref` / `git for-each-ref`, are REFUSED.

## Residual risk (named)
- Split/concat exfiltration across TWO degraded commands (`git status` then, after root
  correction, assembled writes) is a SEQUENCE the single-command check cannot see — the audit of
  sequences is the completion/review surface, not this contract (hand-off recorded; ties into
  #1403's accepted-residual stance).
- A read-shaped git invocation remains an information channel (tree state, current diffs) BY
  DESIGN (#1151 "allow reads") — that is the deliberate remaining surface, documented here as
  accepted, severity LOW.
- The degraded state itself is incident-shaped and rare; the grammar's FP cost is bounded to that
  state only.

## Routing
Impl's D1 fix is LANDED (#1444; delivered #1473, branch impl-item-1444-fix). qa re-falsifies with
the same probes, plus the additions, per #1472 — including G-6/C5. This seat does not verify. If
impl's implementation changes the class or the allowed set's shape beyond C1/C2/C5, a one-item
follow-up position re-records it.

## Citations
- D1 finding + sketch: impl #1440; qa falsification lineage: VERIFY #1215 FAIL (#1265),
  #1312/#1313 refinement lineage for the standing guard stack.
- The degraded-state incidents: #1186 (live worktree reaped → cwd fell back), #1196 (commit on
  main); the primaryCheckoutRefusal read allowance contract: #1151.
- Method/probes shape: docs/runbooks/security-trust-boundary-review.md (#1322); layered posture:
  ROADMAP 32's two-layer proof; never-a-single-layer rule.
- This revision (#1475): impl's shell probes (delivered #1473, branch impl-item-1444-fix
  @5842327); the bare-only-vs-arg-rule request (impl, via pm #1475); `merge-base`'s required
  uses: #1468 (blocked-on-base), #1443/#1429 (per-tip ancestry verification).
