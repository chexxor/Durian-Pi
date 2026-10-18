# Verification #1215 — #1151/#1182 `DURIG_EXPECT_WORKTREE` at 419ced7

*Verifier: qa. Artifact: 419ced7d138b9f4c666eb115d2ac54e851bede62 on `impl-item-1151`
(parent 919e21a, merge-base with main 919e21a). All reruns in throwaway worktrees/clone; the
shared tree was never modified and every probe write landed in throwaway paths.*

## Verdict: FAIL — one must-fix code defect (D1), two small doc/description defects (D2/D3)

## Re-runs that PASSED (independent, at the exact sha)
1. `node --check` on src/config.mjs, src/seattools.mjs, src/confine.mjs, src/broker.mjs, cli.mjs,
   demo/expect-worktree.test.mjs — exit 0 each.
2. `node demo/expect-worktree.test.mjs` — exit 0, 37 checks, PASS line matches the runbook's
   Verify step exactly (runbook re-run included).
3. RED against pre-fix 3f6c884 (demo copied into a throwaway worktree at 3f6c884): the write is
   NOT refused (`{"ok":true}`) and the demo aborts with exit 1 — matches the claim.
4. FULL SUITE at 419ced7 in a clean room (detached worktree + node_modules junction): **116 pass,
   0 fail** — matches the claim. Note: in a worktree NESTED inside another worktree (Windows),
   one check fails (`worktree-lifecycle.test.mjs` "removed worktree no longer listed"); the same
   failure reproduces at pre-fix 919e21a under the identical nested setup and the demo PASSES
   non-nested, so it is an environment artifact of nesting, not a regression of this change.
5. Shape: single commit; touches 9 files (see D3); not on main, not pushed.
6. Code read: config source of truth (a), verifier/coordinator exemptions (b), narrow allowlist
   intent (c), projection via makeSeatEnv → fillRoster capabilities (rig.mjs seats doc is the
   provenance), ONE makeSeatEnv call site (openHarness cli.mjs:350), DENIED_COMMANDS consulted
   before the allowlist, mutation guards on the MUTATING subset of PATH_METHODS + temp creation,
   `DURIG_EXPECT_WORKTREE=1` stamped into the seat's command env (demo section 6), broker
   verdict + ONE bounded notice + re-bind plumbed through drivePass (cli.mjs:1325/runWakeLoop
   cli.mjs:1547).

## D1 — MUST FIX: chained/redirected shell mutations ride through the read-only allowance
src/confine.mjs:358 gates on `!READ_ONLY_COMMAND.test(joined)`, where READ_ONLY_COMMAND (line 89)
is PREFIX-anchored (`^\s*git\s+(?:status|log|diff|show|...)\b|...`) with no end anchor and no
metacharacter guard. Any compound command that merely STARTS with an allowed read runs while the
seat is in the shared checkout. Probe at 419ced7 (expectWorktree=true, throwaway primary clone):

| command (in the SHARED-style root)              | expected   | observed                                   |
|-------------------------------------------------|------------|--------------------------------------------|
| `git status`                                    | allowed    | allowed (exit 0)                           |
| `git switch -c pwned4`                          | refused    | refused (bare form: OK)                    |
| `git status; git switch -c pwned2`              | refused    | RAN — branch `pwned2` created and checked out |
| `git status && git switch -c pwned9`            | refused    | RAN — branch `pwned9` created and checked out |
| `cat rig.json > pwned.txt`                      | refused    | RAN — file landed                          |
| `cat rig.json >> pwned2.txt`                    | refused    | RAN — file landed                          |
| `ls > pwned3.txt`                               | refused    | RAN — file landed                          |
| `git log && echo x > pwned10.txt`               | refused    | RAN — file landed                          |
| `node --check cli.mjs && echo x > pwned7.txt`   | refused    | RAN — file landed                          |
| `echo hi > pwned5.txt` / `node -e write`        | refused    | refused (not prefix-allowed: OK)           |

Two of these are exactly the incident shapes #1186 (a `git switch -c` reaching the shared branch)
and #1196 (a landing straight on the shared tree) — reachable from the seat's own shell while the
seat never leaves the wrong root. This contradicts both the module's own invariant ("everything
not matched is refused while the root is wrong", confine.mjs:87) and the demo's promise
("mutations refused in the shared checkout … `git commit` is REFUSED").

Missing RED-first coverage: the demo's section 1 has NO chained/redirected case. Add to it: the
compound forms above must become REFUSED (exact strings), while bare `git status`, `git diff`,
and `node --check <file>` remain allowed.

Exact fix (confine.mjs exec, keep DENIED_COMMANDS first):
```js
// a shell would reinterpret metacharacters; a compound form must not ride a read prefix
const SHELL_METACHARS = /[;&|`<>$(\n\r]/;
const parts = Array.isArray(command) ? command : [command];
const composable = parts.some((p) => SHELL_METACHARS.test(String(p)));
if (rootRefusal !== null && (composable || !READ_ONLY_COMMAND.test(parts.join(" ")))) {
	return err(new ExecutionError("spawn_error", rootRefusal));
}
```

## D2 — doc: the runbook cites the WRONG commit
docs/runbooks/expect-worktree.md front-matter `evidence: "items #1151/#1182, commit ebbe6e3"`
and the Evidence section name `ebbe6e3` — an abandoned earlier revision of the same commit
(same parent, same subject; the final artifact adds only the runbook + README index). Exact fix:
name `419ced7` (or the sha that actually lands) in both places.

## D3 — description inaccuracies in the queue item (informational, no code change)
- "WHAT CHANGED (7 files)" — the commit touches 9 files: it also relaxes
  demo/seattools.test.mjs's `"env: makeSeatEnv(seatRoster),"` assertion to the prefix
  `"env: makeSeatEnv(seatRoster"` and adds one index line to docs/runbooks/README.md. Both are
  explained (and the relaxation is acceptable — weaker, but still proves the wiring), but the
  item undercounts.
- "base main 3f6c884" — the actual parent/merge-base is 919e21a (a docs commit ON main); main has
  since moved to a7f1286, so expect a rebase/merge at landing.

## Note (rides the landing, per impl's own caveat)
The guard is INERT until the operator restarts `serve`/`run`: `worktreeModeEnabled(CFG)` is read
in openHarness/cmdRun/cmdServe at process start. The runbook documents the symptom and remedy but
does not yet say that a restart (rig reload) is required for `DURIG_WORKTREE_MODE` to take effect.

## See also
- docs/runbooks/expect-worktree.md (the delivered runbook; its Verify step re-run here, exit 0)
