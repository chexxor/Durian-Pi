---
runbook: prepare-workspace-etarget
symptom: "prepare_workspace fails: npm ci --prefer-offline ... ETARGET notarget No matching version found for @earendil-works/<pkg>@<pin>"
writes: false
precondition: "read-only"
last_verified: 2026-10-21
verified_by: delegate
evidence: "#2752/#2756 diagnosis 2026-10-19; POST-FIX CHECK re-run 2026-10-21 at main 87b90f2e after the #2969 exact pin + regenerated lock: a throwaway worktree (`git worktree add --detach`) ran `npm ci --prefer-offline` -> exit 0. The root-write fix is landed, so the Check step is no longer pending."
check_rule: null
---

# prepare_workspace fails with npm-ci ETARGET (manifest/lock drift)

## When to use

Every seat's `prepare_workspace` returns `PREPARE_WORKSPACE_ERROR` with, at its core:

```
npm ci --prefer-offline failed in <repo>\item-<id>:
npm error code ETARGET
npm error notarget No matching version found for @earendil-works/<pkg>@<pin>.
```

First seen 2026-10-19 (#2752): `@earendil-works/pi-coding-agent: ^1.3.0` was pinned in the root
`package.json` without regenerating `package-lock.json`, so the harness's design-time `npm ci`
re-resolves the tree and dies inside `pi-coding-agent`'s own exact pin
(`@earendil-works/pi-agent-core@1.3.0`). It blocks EVERY seat's item worktrees, so no code item
can follow the per-item commit flow until it is fixed.

## Impact

- All seats: `PREPARE_WORKSPACE_ERROR` on claim (blocking, not cosmetic); seats fall back to
  writing on their own seat branches, so `prepare_workspace`-based isolation (D48/D49/D53) does
  NOT apply to whatever they do meanwhile.
- The broker's worktree sweep only reaps TERMINAL, clean worktrees, so the failed `item-*`
  directory from a broken prepare attempt stays on disk; it is not corruption, just litter.

## Preconditions

None - the whole procedure is read-only. The broker may keep running; nothing here opens a
writing harness.

## Diagnose (read-only)

Run from any directory; use the ABSOLUTE repo root, never a relative one.

1. Name the exact pin the failing install asked for. The harness prints it; the npm log is the
   precise record (the `want:` line is the SPEC the pick failed on):

```powershell
node -e "const l=require('fs').readFileSync(process.argv[1],'utf8').split('\n'); console.log(l.filter(x=>/placeDep|fetch manifest .*pi-agent|notarget/.test(x)).join('\n'))" "$env:LOCALAPPDATA\npm-cache\_logs\<latest-debug-log>.log"
```

2. Is the manifest/lock in AGREEMENT at the root? (This is the whole answer - `drift: true` is
   the runbook's verdict.)

```powershell
node -e "const fs=require('fs'); const root=process.argv[1];
const pj=JSON.parse(fs.readFileSync(root+'\\package.json','utf8'));
const lock=JSON.parse(fs.readFileSync(root+'\\package-lock.json','utf8'));
const pk=Object.keys(pj.dependencies||{});
for (const name of pk.filter(n=>n.startsWith('@earendil-works/'))) {
  console.log(name, '| manifest:', pj.dependencies[name], '| lock:', !!(lock.packages||{})['node_modules/'+name]);
}" "C:\Users\Alex\dsh-Projects\pi-opendurig"
```

Expected on the 2026-10-19 breakage: `@earendil-works/pi-coding-agent | manifest: ^1.3.0 | lock: false` -
a dependency the lock does not cover; `npm ci` therefore re-resolves it and may hit ANY stale pin
inside that dependency's subtree (`pi-agent-core@1.3.0` was the transitive victim).

3. Is the registry at fault instead? Register the pinned version actually exists:

```powershell
npm view "@earendil-works/pi-agent-core@1.3.0" version dist.integrity
```

`version = '1.3.0'` + an integrity hash proves the registry is fine and the failure is LOCAL
(drift or cache). If `npm view` itself answers 404/no matching version, it is NOT this runbook's
verdict - see If it fails.

4. Fresh-resolution control (proves the subtree resolves when resolution starts clean):

```powershell
$d="$env:TEMP\prepare-etarget-probe-$(Get-Random)"; New-Item -ItemType Directory $d | Out-Null; Set-Location $d
'{"name":"probe","version":"1.0.0"}' | Set-Content package.json
npm install --no-audit --no-fund --prefer-offline "@earendil-works/pi-coding-agent@1.3.0" --package-lock-only
# exit 0 = resolution machinery healthy; the breakage is confined to the drifted root lock
Remove-Item -Recurse -Force $d
```

(Exit 0 was observed twice on 2026-10-19 inside a throwaway directory, alongside a deterministic
`ETARGET` through the prepared worktree - the contrast IS the diagnosis.)

## Do

1. Seat-safe (any seat, no authority needed): file the blocker to `lead` with the four diagnostic
   outputs above (this is exactly what #2752 carried), and - per P2 - until the fix lands, do NOT
   commit item files from the shared tree; use your own seat branch and say so in the completion.
2. Operator-only (root write + git authority; lead's ruling in #2756). Seats must not do this
   themselves:

```powershell
# from an operator shell at the repo root
npm install --package-lock-only        # regenerate the root lock against its manifest
# then, in a THROWAWAY checkout (never the live tree):
git worktree add "$env:TEMP\durig-verify-etarget" HEAD
Set-Location "$env:TEMP\durig-verify-etarget"; npm ci --prefer-offline
# expect: "added N packages" and exit 0
Set-Location $repoRoot; git worktree remove --force "$env:TEMP\durig-verify-etarget"
```

3. STOPGAP if the operator is unavailable (lead's exact ruling, #2756): revert the manifest line
   to match the committed lock to unblock all seats, then re-add the pin WITH a regenerated lock
   in one commit.

## Verify

- Diagnosis verdict (verified 2026-10-19): step 2 prints `drift: true` for the pin's package,
  step 3 shows the registry HAS the version, step 4 exits 0 - the facts together, and ONLY those
  together, are this runbook's verdict.
- Post-fix check (operators, after step 2 of Do): the throwaway `npm ci` exits 0, and a seat's
  next `claim_work` + `prepare_workspace` returns a worktree path instead of
  `PREPARE_WORKSPACE_ERROR`.

## If it fails

- The manifest/lock agreement probe shows `drift: false` while the ETARGET persists: the stale
  npm cache is the suspect, not the lock - re-run with `--expiry` removed (`npm ci` WITHOUT
  `--prefer-offline`) on the throwaway checkout; if THAT passes, the harness's preferred-offline
  pick needs its cache invalidated (`npm cache clean --force --cache <the cache npm uses>` is
  operator territory), and the runbook row in docs/runbooks/README.md gets the new verdict.
- `npm view` cannot find the pinned version either: the pin names a version that was never
  published. Not a lock problem. Route to lead to LOWER the pin to the highest existing version
  (`npm view @earendil-works/<pkg> versions --json`), with a manifest+lock commit, not just a
  manifest edit - a one-sided edit is how this runbook's breakage was made in the first place.

## Escalate to

- `operator`: the actual root write (regenerate/revert) - seats have no root authority; lead's
  ruling in #2756 defines the accepted fixes.
- `lead`: verdict disputes, the recurrence guard (a package.json-vs-package-lock agreement check
  so drift cannot land again - routed in #2756), and lowering the pin if the publish ever
  disappears.
- `pm`: registering the guard as work once the operator's fix confirms.

## Evidence

- #2752 (designer, 2026-10-19): full diagnosis - prepared workspace fails twice with the same
  ETARGET; `npm view` returns the version; fresh-install resolves the same pin chain in a
  throwaway dir; the item checkout carried package.json WITH the pin and package-lock.json
  WITHOUT it.
- #2756 (lead, 2026-10-19): ruling confirming manifest/lock drift as the root cause, the
  operator-only fix and stopgap, and the two prevention routes (this runbook row + the
  agreement guard).
- The diagnose steps of this file ran (exits recorded in #2752) on 2026-10-19; the post-fix
  Check has NOT run yet - the fix awaits the operator, so this runbook is green on diagnosis,
  pending on repair until #2752's outcome is recorded here (update `last_verified` then).
