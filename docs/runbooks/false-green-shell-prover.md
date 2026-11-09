---
runbook: false-green-shell-prover
symptom: "a check reported exit 0 but the report cannot say what it proved; two reports of the same check disagree (one 0, one 1)"
writes: false
precondition: "read-only"
last_verified: 2026-11-08
verified_by: scribe
evidence: "#5702 (docs row for #4976); every command below was run in the item-5702 worktree at f1be5157 — §Verify has the outputs"
check_rule: null
---

# The `$?`-clobbered prover: a green that proved nothing

## When to use
- you ran a landing gate, a merge probe or a demo test, wrote down `exit=0`, and cannot point at which
  command produced that 0;
- the same check is reported as `1` in one place and `0` in another;
- you are writing a `Verify` block for a doc, runbook or commit message and want it to be re-runnable by
  someone else.

## Impact
A vacuous green is worse than a red: a stale branch gets landed, a conflicting merge gets pre-flighted
as clean, or a report says "suite green" for a suite that failed. The number is real; it just belongs to
a different command. This is the sibling of the **pipe** trap recorded in
[../BRANCH-AND-WORKTREE-LIFECYCLE.md](../BRANCH-AND-WORKTREE-LIFECYCLE.md) §6.1 — same class, different
mechanism. §6.1: `$?` after a pipe is the exit of `tail`. Here: `$?` after **any intervening command** is
the exit of that command.

## The failure shape
`$?` is the exit status of the **last command the shell ran**, not of the command under proof. Anything
between the prover and the read — `tail`, `grep`, `ls`, `git log`, a second `echo` — overwrites it.

```bash
git merge-base --is-ancestor main item-4967    # the prover: 1 = STALE base
git log -1 --oneline                           # intervening: 0 — clobbers $?
echo "gate exit=$?"                            # prints 0 → read as "base is current"
```

Measured 2026-11-08 in the `item-5702` worktree at `f1be5157`: the gate's real exit was **1** (main is
not an ancestor of `item-4967`), and the block above printed `gate exit=0`.

## Diagnose (read-only)
Run the prover **alone** and read the code off it directly; then compare with the report you have:

```bash
git merge-base --is-ancestor main item-4967; echo "real=$?"     # 1 — the truth
```
If `real` disagrees with the number in your report, the report's number came from something else.

## Do — the two shapes that are safe
1. **Capture before doing anything else** (the pattern the rig's own runbooks use, e.g. `land.md`):
   ```bash
   git merge-base --is-ancestor main item-4967; rc=$?
   git log -1 --oneline; echo "gate exit=$rc"                   # 1 — actual verdict
   ```
2. **Assert in-line**, so there is no intervening command at all:
   ```bash
   git merge-base --is-ancestor main item-4967 && echo "GREEN: main is in the branch" || echo "RED: stale base"
   ```
3. **Suite-shaped provers**: redirect to a file, capture the code, *then* read the file — never pipe the
   runner:
   ```bash
   node scripts/suite.mjs > /tmp/suite.out 2>&1; rc=$?; tail -2 /tmp/suite.out; echo "exit=$rc"
   ```
   Record `pass=N fail=M` from the file, not "green" (see §6.2 of the topic doc on what `fail=1` means).

## Verify (this step ran; expected output below)
Self-contained — no branch or fixture needed:

```bash
test -e /no-such-prover-file; echo "real=$?"
test -e /no-such-prover-file; ls docs/runbooks; echo "clobbered=$?"
test -e /no-such-prover-file; rc=$?; ls docs/runbooks; echo "captured=$rc"
```

Expected, and what was observed on 2026-11-08 (node v24.22.1, bash):

```
real=1
clobbered=0        ← the vacuous green: the failed test reported as a pass
captured=1         ← the same proof, correctly reported
```

The `git merge-base` instance gave the same split: `real=1`, `clobbered=0`, `captured=1`, and the
in-line assert printed `RED: stale base (exit 1)`.

## If it fails
If both shapes print the same code, the prover itself did not fail (or the ref/path you named does not
exist — a `128` from git means an invalid ref, not a gate verdict). Re-run the prover alone before
concluding anything.

## Escalate to
`lead` if an artifact was already landed, merged or reported on the strength of a green this runbook
shows was vacuous; re-run the gate with pattern 1 and re-file the verdict.

## Evidence
Queue item **#5702**, minting the docs row for **#4976** (the `$?`-clobber prover pitfall named in
`docs/DECISIONS.md` D236/§7). Commands above executed in worktree `item-5702` at `f1be5157`, 2026-11-08.
Cross-references: `docs/BRANCH-AND-WORKTREE-LIFECYCLE.md` §6.1 (pipe variant), `docs/SELFDEV.md` pitfall
126 (the numbered entry).
