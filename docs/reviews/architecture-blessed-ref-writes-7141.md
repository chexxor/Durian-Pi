# Refusing blessed-ref writes: name the target, not the verb, and pair it with a tripwire (#7141 / build #7140)

Architect review, 2026-11-12. Tree: branch `item-7123`; `@earendil-works/pi-durable` **1.3.0** from this
worktree's lockfile (seat root resolves 1.5.1 - a number from there is not comparable). Host: Linux, kernel
`7.2.15-300.fc45.x86_64`, Fedora 45, node v24.22.1, git 2.56.0.

Instrument: `node tools/probes/blessed-ref-writer-surface-7141.mjs` → **exit 1**.

## Measured surface (not assumed)

Direct commands a seat can run through `refusalFor` (src/confine.mjs:903, exported at :1181), with the
worktree as cwd:

| command | verdict today |
|---|---|
| `git update-ref refs/heads/main <sha>` | **ALLOWED** |
| `git update-ref refs/heads/staging <sha>` | **ALLOWED** |
| `git branch -f main item-7141` | **ALLOWED** |
| `git branch -f staging item-7141` | **ALLOWED** |
| `git merge --ff-only main` | **ALLOWED** |
| `git worktree add .worktrees/extra main` | **ALLOWED** |
| `git commit -m ...` | ALLOWED (writes the seat's own HEAD) |
| `git symbolic-ref HEAD refs/heads/main` | REFUSED |
| `git reset --hard main` | REFUSED |
| `git push origin main` | REFUSED |

8 of 11 direct commands allowed. And the guard sees a **string**, not an effect:
- `node scripts/land.mjs item-7141 --suite` → ALLOWED (it is the sanctioned landing path; its git calls are child processes the guard never inspects).
- `node -e "execSync('git update-ref refs/heads/main <sha>')"` → **ALLOWED**. Any script is the same hole.

Why the worktree boundary does not save you: from inside an item worktree, `git rev-parse --git-common-dir`
returns `/home/chexxor/Git/Durian-Pi/.git` - one ref namespace for every seat. I wrote a ref from my own
worktree to prove it and cleaned up: `git update-ref refs/probe/7141 HEAD` →
`refs/probe/7141 3aa294d2...`, then `git update-ref -d refs/probe/7141` (no refs left). A seat's ref write
is repo-wide, not worktree-local.

Two facts the build spec does not have:
- **`refs/heads/staging` does not exist** in this repo today: `git for-each-ref` shows `refs/heads/main`,
  `refs/remotes/origin/main`, `refs/remotes/win/main`, `refs/rescued/main`. A demo that asserts the staging
  ref exists will fail; the rule must be a **name** rule and must refuse whether or not the ref is there.
- `git merge --ff-only main` inside a seat worktree does **not** move main - it advances the seat branch.
  The same string in the shared checkout does. So the danger is "which ref is *written*", not "which verb
  is used" or "which name appears".

## The design ruling: scope by written target, not by verb

pm's spec says "refuse a ref-writing verb targeting `refs/heads/main` or `refs/heads/staging`" - that is
the right shape. But the acceptance "assert the allowed count is 0" is ambiguous, and read literally it
breaks procedures. `src/confine.mjs:469-470` keeps `update-ref` open because runbooks prescribe it:
`docs/runbooks/cross-clone-object-recovery.md:113` (`refs/rescued/*`),
`docs/runbooks/leaked-worktrees.md:173` (`archived/*` anchor),
`docs/runbooks/resolve-merge-conflict.md:67` (publishing a `-rebased` ref). Refusing those sends the seat
around the guard, which is the failure mode #4367 names.

**Concrete acceptance for #7140**, three assertions, each falsifiable:
1. refused: `git update-ref refs/heads/main <sha>`, `git update-ref refs/heads/staging <sha>`,
   `git branch -f main <ref>`, `git symbolic-ref HEAD refs/heads/main`,
   `git worktree add <path> main` - the refusal text must **name the ref** and say who may write it.
2. still allowed: `git update-ref refs/rescued/main HEAD`, `git update-ref refs/heads/item-7141 HEAD`,
   `git diff main`, `git merge-base --is-ancestor <ref> main`, `node scripts/land.mjs <branch> --suite`.
   A guard that refuses reads or the sanctioned landing stops the rig.
3. the reason names the recovery: "the operator lands refs; a seat's branch is promoted by
   `scripts/land.mjs` with operator approval" - a refusal that does not say what to do instead is how a
   seat improvises.

## Failure modes at this seam, each with a recovery path

| failure | mechanism | recovery |
|---|---|---|
| **bypass (silent)** | the guard inspects the command string; `node -e`, any script, or a checked-in tool can write the ref | detection, not prevention: snapshot blessed-ref shas at generation start, compare at lease release; on drift, refuse the seat's next write, print an ATTENTION line with before/after sha and the seat |
| **cascade** | a poisoned `main` becomes the base of every later worktree: `prepare_workspace` forks from HEAD by default | the tripwire's revert is a supervisor-owned `update-ref` back to the snapshotted sha, recorded in the audit line; `tools/branch-census.mjs` then shows which branches are ahead of a wrong main |
| **false refusal** | a bare name `main` is also a file, a tag, or a read argument | judge only writing verbs, and only in a ref position; reads stay open; demo asserts both sides |
| **rig stalls** | the sanctioned landing path is refused because it writes refs by design | exemption is by *target*, not by *script*: land.mjs's writes are to blessed refs too, so the exemption is "the delegate/operator context", not "the string is a node command" |
| **partial guard reads as progress** | a guard that catches `update-ref` but not `branch -f` | the demo asserts the *count of blessed-target write commands allowed* is 0, not "fewer than before" - pm's shape, made target-scoped |
| **authority drift** | a seat auto-voids or auto-restores a blessed ref "to fix" the drift | only the supervisor and `scripts/land.mjs` write blessed refs; the guard refuses seats the same rule that protects the exemption |

## Options considered, and the trade-off I am accepting

- **(A) Remove `update-ref` and `branch` from `GIT_WRITING_CLAIMED`.** Cheapest. Rejected: it breaks the
  three runbook procedures above and, per #4367, a guard that blocks a documented procedure is a guard
  seats route around.
- **(B) Target-scoped refusal of blessed refs (recommended).** Catches the direct surface; cheap; leaves
  the runbook namespace intact. It is not a wall - see the bypass row.
- **(C) Structural isolation: give each seat its own clone with no blessed refs.** Strongest prevention,
  rejected: it severs the shared object namespace that lets an item branch reference another item's commit
  and it contradicts D265 (branch = temporary isolation, staging = a queue with a human promotion gate).
  Revisit only if the tripwire keeps firing.
- **(D) Tripwire detection as the complement (recommended alongside B).** Prevention against arbitrary
  code is impossible in a shared namespace, so the honest control is: make drift visible, attributable and
  reversible.

**Accepted trade-off:** a seat with arbitrary code can still move a blessed ref *locally*; what the rig
guarantees is that this is detected, named, and reversible, and that nothing reaches `origin` without the
operator's grant (`DURIG_ALLOW_PUSH`, currently not set).

## What I did not decide
Whether `staging` should exist as a ref at all, and the sequencing of #7140 within the tranche - pm's.
I touched no broker code and no queue item other than routing this review.
