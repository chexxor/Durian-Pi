# A promote verb that writes a ref which does not exist, and an authority it cannot enforce (#7148 / build #7147)

Architect review, 2026-11-12. Tree: branch `item-7148`; `@earendil-works/pi-durable` **1.3.0** from this
worktree's lockfile (seat root 1.5.1 - not comparable). Host: Linux, kernel `7.2.15-300.fc45.x86_64`,
Fedora 45, node v24.22.1, git 2.56.0.

Instrument: `node tools/probes/promote-verb-failure-modes-7148.mjs` → **exit 1**. It builds the failure in a
throwaway repo inside the worktree; the real refs are never touched (the scratch dir is removed by the
probe itself).

## Measured before any code is written

| fact | measurement |
|---|---|
| `refs/heads/staging` exists | **false** (`git for-each-ref refs/heads`) |
| a `promote` command exists in cli.mjs | **0 mentions** |
| a seat may run `git update-ref refs/heads/staging <sha>` today | **ALLOWED** (`refusalFor`, src/confine.mjs:903) |
| a seat may run `git update-ref refs/heads/main <sha>` today | **ALLOWED** |
| a seat may run `node scripts/promote.mjs staging main` | **ALLOWED** - the guard sees a string, not an effect |
| diverging staging, `git merge --ff-only staging` | **exit 128** - git refuses |
| diverging staging, naive `git update-ref refs/heads/main staging` | main silently **loses 1 commit** |
| staging a descendant of main | ff succeeds, nothing lost - the only promotable shape |

`docs/WORK-ITEM-MODEL.md` §7 already says: "`staging` is a long-lived branch, created once (`git branch
staging main`) and never hand-edited. Seats may move it; the operator is the only party that moves `main`."
None of that is mechanism today, and the second half of it is not enforceable in this rig.

## F1 - the verb is specified against a ref that does not exist

**Concrete fix:** `promote` refuses when `refs/heads/staging` is absent, and **the landing path creates it** -
staging should be a product of the gate, not a branch someone hand-made. A verb that silently creates
`staging` from `main` on first run is a no-op that reports success, which is the same shape as the
opt-in-suite bug #6090 closed ("an optional gate is a signal; the landing is the decision").

## F2 - direction is the safety property, and it is not ancestry-as-success

Measured: with divergent staging, git refuses the fast-forward (exit 128), but `update-ref` - the tempting
one-line implementation - **silently reverts main** and nothing in the report says so. So the gate is:
1. `git merge-base --is-ancestor main staging` must exit 0 **before** anything is written;
2. if it does not, refuse with the remediation named ("rebase staging onto main, or land the refs"); never
   `--no-ff` a revert into main;
3. print parent count (`git log -1 --format=%p`) so a merge that did not happen is not reported as one.

## F3 - "operator only" is a claim the rig cannot enforce

`src/broker.mjs:482-498` states the rule plainly for control-plane ops: `from` is **producer-stamped** inside
the spool file and all seats share one OS user, so same-user forgeability is a **known residual**
(UNVERIFIED-FOR-PREVENTION) - "the layers narrow it; they do not eliminate it. Never claim otherwise."
Measured here: `node scripts/promote.mjs staging main` and inline `node -e "execSync('git update-ref
refs/heads/main ...')"` are both ALLOWED by the confinement guard.

So the enforceable control is **content, not identity**. The verb must be safe whoever runs it: same gate
as landing, same lock, same evidence. An operator flag is a *signal* worth having (detect-and-layer), but a
demo that proves "the seat cannot promote" cannot be written, and the spec should not promise one.

**Options considered:**
- **(A) identity gate** (env var / operator stamp). Rejected as a boundary; kept as one layer. Trade-off: it
  reads as a wall and is not one.
- **(B) content gate shared with the landing path** (chosen). Reversible, testable, and it does not depend on
  who is holding the terminal.
- **(C) broker-side promote as a control-plane spool op** (the durable direction, D113's shape), gated on the
  unlanded spool work (#3969, #3975 - both held). Its own documented operational facts cut against doing it
  now: a mutating spool intent does not wake a dormant broker, and `broker-serve --start` refuses on a dirty
  live tree. Recommend (B) now, (C) when the seam lands; the predicate stays the same so the migration is
  mechanical.

## F4 - two paths to main must share one predicate

pm gated #7147 on #7143, which is right, and named the risk exactly: "otherwise we create a second, weaker
path to main". The fix has to be structural, not a sequence: the gate is **one exported function** in
`src/landinggate.mjs` (which today composes argv + changedPaths + suite exit and mentions verify/evidence
zero times) that both `land.mjs` and `promote` call, taking the set of parent refs. Two copies of the rule
drift; drift at a landing gate is silent.

Also: promote must take the **same exclusive lock** land.mjs takes (`acquireAllSlotsSync`,
scripts/land.mjs ~1020). A promote without it is the two-delegates-one-tree shape #4432 named.

## F5 - retiring refs in the same call is the risky half

"refs retired in the same call with `branch -d` refusing when not an ancestor" is the correct instinct and
the wrong order. Concrete rules:
- retire **after** main advances, never before; a failed promote with retired refs is lost work;
- retire only refs that are ancestors of the **new** main tip;
- refuse to retire a ref whose worktree is dirty or locked - `tools/branch-census.mjs` already computes
  exactly this (ahead of main / ancestor of main / dirty worktree / has a worktree) and its rule is
  "a ref is deletable only when it is an ancestor of main AND its worktree has no uncommitted tracked
  change AND it is not a seat root or a locked worktree";
- unmerged refs go to `docs/DISPOSITIONS.md` (it exists on this tree) - and the row must be written even
  when nothing is deleted, otherwise the disposition is invisible.

## F6 - printed evidence is not evidence unless it is stored

"prints its evidence" is a screenshot. Per the evidence contract (`src/checkup.mjs:111-118` already has
`verification-without-evidence` and `evidence-tree` rules), the verb must record `{command, exitCode,
artifact}` where the artifact **names the tree** - the new main sha - and write that into the queue as a
row, so a later seat can re-run the check. Suite output capture stays `> out 2>&1; rc=$?`, never piped
(the pipe hides the exit code, `BRANCH-AND-WORKTREE-LIFECYCLE.md` §6.1).

## Failure modes at this seam

| failure | mechanism | recovery |
|---|---|---|
| hard | no `staging` ref exists | refuse, name the missing ref and who creates it (the landing path) |
| silent | `update-ref main staging` reverts main while reporting success | direction gate before any write; measured exit 128 vs a lost commit |
| authority | "operator only" enforced by a stamp | detect-and-layer, content gate as the real control; never claim prevention |
| contradiction | promote and land enforce different rules | one exported predicate, both call it |
| cascade | a promote without the landing lock races a concurrent landing | take the same exclusive lock land.mjs takes |
| partial | refs retired before main advances | retire after; re-run is a no-op ("nothing to promote") |
| loop | re-promoting already-landed refs | ancestor test makes it idempotent |
| context | dry run prints a predicted sha as if it happened | label it predicted; assert `main` unchanged after |

## What I am not deciding
Whether promote is a CLI verb or a spool op is pm's sequencing call (the spool seam is unlanded); whether
`staging` should exist at all is lead's, since §7 of WORK-ITEM-MODEL is marked PROVISIONAL. I changed no
broker, land.mjs or cli.mjs code.
