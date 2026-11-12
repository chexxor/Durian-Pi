---
runbook: false-green-shell-prover
symptom: "a check reported exit 0 but the report cannot say what it proved; two reports of the same check disagree (one 0, one 1); a demo's PASS line tallies provider prefixes and never names which model each provider served"
writes: false
precondition: "read-only"
last_verified: 2026-11-11
verified_by: devtools
evidence: "#5702 (docs row for #4976); every command below was run in the item-5702 worktree at f1be5157 — §Verify has the outputs. Second mechanism ($1-empty xargs loop) measured 2026-11-10 in the item-6073 worktree at f192f543 — §Verify-2 has the outputs. Third mechanism (prefix-counting assertion) measured 2026-11-11 in the item-6322 worktree, dependencySet built-pin: the OLD predicate returned true on a roster where all 12 seats serve one model (counts local=11, verifier=1), and the fixed demo exits 1 on that roster and 0 on the real one — §Verify-3 has the outputs."
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

## Second mechanism: the xargs loop that ran `node ""` and called it a pass
Same class, different mechanism, and this one launders a whole suite. Measured 2026-11-10 in the
`item-6073` worktree at `f192f543`.

```bash
ls demo/*.test.mjs | xargs -P 12 -n 1 sh -c 'f="$1"; if node "$f" > out 2>&1; then echo "PASS $f"; else echo "FAIL $f"; fi'
```

`xargs` appends the item to the command line, so for `sh -c 'script' item` the item lands in **`$0`**, not
`$1`. `$f` is therefore empty, `node ""` exits **0**, and every line prints `PASS ` with **no filename**.
A 282-file suite reports 282 passes while running nothing.

Measured, in the same worktree:

```bash
ls demo/mergeguard.test.mjs | xargs -n 1 sh -c 'echo "A0=[$0] A1=[$1]"'   # A0=[demo/mergeguard.test.mjs] A1=[]
ls demo/mergeguard.test.mjs | xargs -n 1 sh -c 'echo "A0=[$0] A1=[$1]"' _ # A0=[_] A1=[demo/mergeguard.test.mjs]
node ""; echo "exit=$?"                                                   # exit=0  ← the vacuous green
```

The tell is the **empty name after PASS**. If a suite line says `PASS ` with nothing after it, the loop
ran no file. Read the count only when each line names a file.

Two safe shapes:
1. **Use the rig's own runner** — it exists for exactly this job and classifies environment-blocked
   demos separately from real failures:
   ```bash
   node scripts/test.mjs > /tmp/suite.out 2>&1; rc=$?; tail -3 /tmp/suite.out; echo "exit=$rc"
   ```
   (0 = all pass; 1 = at least one failed; 2 = usage error. `scripts/suite.mjs` is the variant that
   separates a resource abort from a regression.)
2. **A plain loop**, no quoting trap:
   ```bash
   for f in demo/*.test.mjs; do node "$f" > /tmp/$(basename "$f").out 2>&1 || echo "FAIL $f"; done
   ```

## Verify-2 (this step ran; observed output below)

```bash
ls demo/land-helper.test.mjs demo/mergeguard.test.mjs \
  | xargs -n 1 sh -c 'f="$1"; if node "$f" > scratch/x.out 2>&1; then echo "PASS $f"; else echo "FAIL $f"; fi'
# observed: `PASS ` and `PASS ` — two lines, no filenames: nothing ran
ls demo/land-helper.test.mjs | xargs -n 1 sh -c 'echo "A0=[$0] A1=[$1]"'
# observed: A0=[demo/land-helper.test.mjs] A1=[]
node demo/land-helper.test.mjs > scratch/d.out 2>&1; echo "real=$?"
# observed: real=0
node scripts/test.mjs > scratch/all.out 2>&1; rc=$?; tail -2 scratch/all.out; echo "exit=$rc"
# observed 2026-11-10 in the item-6073 worktree (pi-durable 1.3.0, vendor link step FAILED):
#   261/282 passed in 129.6s ... exit=1
```

## Third mechanism: the assertion that counts prefixes instead of naming what it exercised (#6322)

`demo/deepinfra-catalog.test.mjs` guards that every seat's model resolves. Seats whose provider prefix is a
locally-served one are exempt — `isLocalProviderId` answers for `local`, `verifier` and `local2` together
(`src/providers/local.mjs`, `LOCAL_PROVIDER_IDS`). The old non-vacuity assertion counted provider **prefixes**:
`byProvider["verifier"] >= 1 && byProvider["local"] >= 1`. Two prefixes appearing is not two families. Measured
2026-11-11 in the `item-6322` worktree against the one-family fixture roster below: the old predicate returned
**true** with counts `local=11, verifier=1` even though every seat, under both prefixes, names the *same*
served model `qwen3.8-flash-next-q2_0`. One blind spot, wearing two names, reported as a verdict.

The fix names the exercise instead of tallying it: the guard reports every `provider -> served model` pair with
the seats that produced it, and asserts two orthogonal things — at least two registered provider ids exercised,
and at least two distinct served model ids. A roster can now go red on the family condition while still passing
the prefix condition, which is exactly the case the old assertion could not see.

The honest limit, printed in the demo itself: distinct model **ids** are the strongest thing a rig *file* can
prove. Whether two ids are distinct blind-spot **families** is the documentation ruling (`src/providers/local.mjs`,
"WHAT THIS DOES NOT PROVE"); no test here claims it.

## Verify-3 (this step ran; observed output below)

```bash
node demo/deepinfra-catalog.test.mjs; echo "exit=$?"                                          # GREEN, real roster
DURIG_RIG=demo/fixtures/rig-one-family.json node demo/deepinfra-catalog.test.mjs; echo "exit=$?"  # RED, one family
```

Observed 2026-11-11 in worktree `item-6322` (`dependencySet: "built-pin"` after `sync-pi --sync --link`), node v24.22.1:

```text
exit=0  … exemption exercised as local -> qwen3.8-flash-next-q2_0 (11 seat(s): pm, impl, qa, qa2, lead, advocate,
        scribe, devtools, designer, security, architect); verifier -> openai/gpt-oss-120b (1 seat(s): auditor)
        = 2 provider id(s) over 2 served model(s)
exit=1  AssertionError: the exempt providers all resolve to the SAME served model (qwen3.8-flash-next-q2_0)
        — two prefixes, one family, one blind spot: green but exercising nothing.
```

The fixture (`demo/fixtures/rig-one-family.json`) is the settled roster with `auditor` re-pointed from
`verifier/openai/gpt-oss-120b` to `verifier/qwen3.8-flash-next-q2_0`. It is an **input**, not a change to the
roster: the live rig is untouched.

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
