# Failing-First Verification — Safe Procedure (Windows / Node)

> **When to read:** When a seat wants to prove a test fails without its fix but has already
> edited the code, and is about to run a git command that reverts files in the shared tree.
> 
> **Why this exists:** A seat ran `git stash;` to do failing-first and wiped the shared working
> tree — sweeping up other seats' and the operator's uncommitted work (RD #257). The guard regex
> ended in `(\s|$)` and the trailing `;` bypassed the match. This doc gives the seat a safe path
> so it is redirected, not dead-ended.

## TOP RULE (always in effect)

Never run a command that reverts, removes, or redirects git operations outside your OWN
worktree. Your worktree is the only tree you may modify. The main checkout holds other seats'
and the operator's uncommitted work.

## FORBIDDEN, ALWAYS (no exceptions, no workarounds)

- `git stash` (any form)
- `git reset --hard`
- `git restore` / `git checkout -- <path>`
- `git clean -fd`
- `git apply -R` of a diff you produced
- Any git command aimed at another directory: `git -C <other>`, `--git-dir`, `GIT_DIR`,
  `GIT_WORK_TREE`, `cd <other> && git`
- Any junction/symlink from your worktree into the main repo's `node_modules`
- Deleting a worktree with `rm -rf` / `Remove-Item -Recurse` (use `git worktree remove`)

## DO FAILING-FIRST VERIFICATION IN THIS ORDER

### METHOD 1 — Order of operations (default, no revert needed)

This is the standard red-green-TDD loop and requires no git state changes.

1. Write the new test. Do not edit the code under test yet.
2. Run the test on the current tree.
3. Confirm it **FAILS** for the expected reason.
4. Only now make the code change, and re-run to confirm it passes.

If the test fails on step 3, you are done — you have proven the fix is needed.

### METHOD 2 — Throwaway detached worktree

Only use this if you have **already edited the code** and must prove the test would have
failed before your change.

```powershell
# scratch dir OUTSIDE the repo; keep the path SHORT (MAX_PATH limit on Windows)
$scratch = "C:\wt\verify-" + [guid]::NewGuid().ToString('N').Substring(0,8)

# fresh checkout at HEAD; shares .git objects, not working files
git worktree add --detach "$scratch" HEAD

# give the scratch checkout its own deps (never junction into main)
Push-Location $scratch
npm ci --prefer-offline            # or: pnpm install --frozen-lockfile
Pop-Location

# copy ONLY the new/updated test file(s) in
Copy-Item -Force .\tests\test_<name>.js "$scratch\tests\test_<name>.js"

# run the suite in the scratch checkout
Push-Location $scratch
<your test command>                 # NON-ZERO exit = test fails without the fix
Pop-Location

# cleanup: unlink any link first, then remove
git worktree remove --force "$scratch"
git worktree prune
```

### METHOD 3 — Throwaway clone

If worktree setup fails, fall back to cloning.

```powershell
git clone --no-hardlinks . "$scratch"
Push-Location $scratch
npm ci --prefer-offline
<your test command>
Pop-Location
Remove-Item -Recurse -Force $scratch
```

## VERIFY BEFORE METHOD 2

Before any git command in Method 2, confirm you are in YOUR worktree:

```powershell
git rev-parse --show-toplevel          # must equal your worktree path
git rev-parse --absolute-git-dir       # must differ from --git-common-dir
```

If any of these look wrong, or you cannot verify them, **STOP and report the block** instead
of working around it.

## IF YOU ARE BLOCKED

If you think you need one of the forbidden commands, **STOP and report the block** instead
of working around it. The guard is a backstop, not the seatbelt — structural isolation
(worktrees, discussed in Roadmap item 34) is the real protection; the guard refuses
unresolvable commands.
