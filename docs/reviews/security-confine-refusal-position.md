# SECURITY POSITION — confine wrong-root refusal contract (D1)

**Status: position by the `security` seat, item #1445, 2026-10-17. Ratifies/corrects impl's fix
sketch (`#1440`/D1, from qa's VERIFY #1215 FAIL — #1265) for `src/confine.mjs`'s degraded
(wrong-root) exec path. Per-item artifact; no standing security-doc set (lead #1297). Not a
verification — qa verifies impl's fix; this seat positions.

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
checkout, so the harness shell interprets PowerShell-family statements (`;`, `&&`, aliases
`ls`/`cat`/`type`, `|`, redirects inherit digit/`*` forms).

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
| Parse-mode escapes: quotes `"` `'`, PS here-strings/arrays `@`, PS stop-parse `--%`, cmd escapes/var-expansion `^ %` | they hide a metachar from/affect any string-level scan (the class refuses the HIDING form too — quoting is not needed by any allowed bare verb, so the FP cost is zero in degraded mode). |
| Read-array globs: `* ? [ ]` in arguments | a degraded read runs against the SHARED tree; `Get-Content *` arrays across other seats' files; filenames-only for `ls` shapes, content for removed verbs below. |
| Config-exec inside accepted verbs | **the sketch's structural miss:** `git -c core.fsmonitor=<path> status` and `git diff --ext-diff` EXECUTE configured helpers while matching the read prefix argument-for-argument; `=`/`:`-bearing git args must be refused (or via the option grammar below). |
| Arg paths in allowed verbs | any argument token that is absolute, UNC (`\\`), drive-leading (`C:` contains `:` anyway), `..`-containing, or separator-carrying points OUTSIDE the tree even for a "read" (`git show <rev>:<path>` reads ANY ref's tree — other seats' item branches, stashes). |

## Corrections to impl's sketch

### C1 — metachar class: RATIFIED as the necessary layer, EXTENDED per table
From `/[;&|`<>$(\n\r]/` to `/[;&|`<>$(\)\n\r^%*?\[\]"'@]/` plus a literal `--%` check.
Every element's reason is in the table above; `[`/`]` added for glob classes and PS array
syntax; `^`/`%` defend the cmd-family parse (documented as assumption-with-probe, C3).

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

### C3 — state the shell assumption and falsify it
The probes prove the exec shell is PowerShell-family; the `^`/`%` elements defend cmd-family
parses that may or may not be reachable. Either (i) delete `^`/`%` with a recorded probe proving
`ComSpec`-cmd cannot be reached through this exec path, or (ii) keep them (cost: nothing legit
matches). Do NOT leave the assumption unstated — an unstated shell assumption is exactly the
"non-existing gate cited as if it held" defect my method names (unverified surfaces named
unverified).

### C4 — ordering, and no prose rot
The degraded grammar runs: standing `DENIED_COMMANDS` → degraded metachar+`--%` test → degraded
arg/option grammar → `READ_ONLY_COMMAND` allowlist. And the L83–87 comment must be updated WITH
the fix ("everything not matched OR composed is refused") — the
2026-10-16 lesson was prose guards rotting against enforced reality; comment + demo probes land
in the same commit.

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
Impl implements the grammar + class per G-1..G-5 (routed by pm); qa re-falsifies with the same
probes plus the additions. This seat does not verify. If impl's implementation changes the class
or the allowed set's shape beyond C1/C2, a one-item follow-up position re-records it.

## Citations
- D1 finding + sketch: impl #1440; qa falsification lineage: VERIFY #1215 FAIL (#1265),
  #1312/#1313 refinement lineage for the standing guard stack.
- The degraded-state incidents: #1186 (live worktree reaped → cwd fell back), #1196 (commit on
  main); the primaryCheckoutRefusal read allowance contract: #1151.
- Method/probes shape: docs/runbooks/security-trust-boundary-review.md (#1322); layered posture:
  ROADMAP 32's two-layer proof; never-a-single-layer rule.
