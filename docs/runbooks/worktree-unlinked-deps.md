---
runbook: worktree-unlinked-deps
symptom: "prepare_workspace says DEPENDENCY NOT LINKED, or a fresh worktree's suite fails demos that pass in the seat root (measured shape 2026-11-10: 261/282 with 21 reds in the broker/cli/tui-durable families and `TypeError: listener is not a function` at pi-durable 1.3.0 `session.js:575`), or the same demo file gives different results in the item worktree and the seat root while BOTH report the same pi-durable version"
writes: false
precondition: "read-only"
last_verified: 2026-11-11
verified_by: devtools
evidence: "#6196/#6202 (2026-11-11): `node scripts/sync-pi.mjs --report` in the item-6196 worktree printed `PROVENANCE tree=35001c3a … dependencySet=lockfile-released` with a FALLBACK line before `--sync --link` (exit 0), and `dependencySet=built-pin pi-durable=1.5.1` with a DRIFT summary after it (exit 1, the lockfile still declares 1.3.0); `node demo/suite-provenance.test.mjs` exit 0; `node scripts/test.mjs --all --jobs 6` 301/301 exit 0 in the linked tree. #3821 - the link step's failure is now recorded and reported instead of console.warned; demo/worktree-deps-link.test.mjs. #5217 (2026-11-06, Linux, node v24.22.1): all three states walked in one worktree - UNBUILT (built-dist exit 1, symlink exit 1) -> `sync-pi --sync` (exit 0, 9 packages built) -> `--link` (exit 0, symlink exit 0 pointing at vendor/pi-main/packages/durable). Version stayed **1.3.0 in every state and in every tree** while the artifact changed: sha256 of `node_modules/@earendil-works/pi-durable/dist/index.js` = `4cee4286b156…` (linked, built from the pin) vs `467d9cf6b27c…` (lockfile) in two other worktrees. `node demo/worktree-deps-link.test.mjs` exit 0 in the linked tree."
check_rule: null
---

# A worktree provisioned with UNLINKED dependencies

## When to use

Either of these:

- `prepare_workspace` returned a result containing `DEPENDENCY NOT LINKED in this worktree: the
  sync-pi --link step FAILED (...)`. The rest of the result is normal: the worktree exists and your
  tools point at it.
- You did not see that line, but a suite run in a fresh worktree fails demos that pass in the seat
  root (typically the five `tui-durable-*` demos), and nothing you changed explains it.

## Impact

Your worktree resolves the `@earendil-works/pi-durable` version pinned in `package-lock.json`
instead of the built `vendor/pi-main` tree the seat root links to. The two dependency sets are not
the same, so **a suite verdict from this tree is not comparable with the seat root's** - not "slightly
worse", but a different measurement. If you report a red set without saying which tree and which
dependency set produced it, nobody can use your verdict.

Work itself is not blocked: the worktree runs, and code that does not touch pi-durable behaves
identically.

**What the artefact actually looks like, measured 2026-11-10** (item worktree `item-6089` at main tip
`e3685a8f`, state A - `vendor/pi-main` absent, `node_modules/@earendil-works/pi-durable` a real directory
resolving the lockfile's released **1.3.0**, while the seat root resolves the built **1.5.1**):
`node scripts/test.mjs` -> **261/282 passed, exit 1**, 21 reds all in the broker/cli/tui-durable families,
`demo/broker.test.mjs` killed at the 120 s per-test timeout. The signature is nameable, not mysterious:
`src/broker.mjs:2097 runWakeLoop` calls into the released 1.3.0 `dist/session/session.js:575 #publish`, which
answers `TypeError: listener is not a function`, surfacing as `SessionFailed: Session failed after a storage
error; close and reopen it`. Demos that do not take the broker wake path pass in the SAME tree
(`demo/clockin-digest.test.mjs` exit 0 in 28.5 s; `demo/provenance.test.mjs` and `demo/seat-turn-shape.test.mjs`
both exit 0). So a red set of that shape is a graph artefact - and the citation must say so: quote
`dependencySet` from `node scripts/sync-pi.mjs` (#5400) next to the count.

## Preconditions

Read-only. Nothing here needs the broker stopped.

## Diagnose (read-only)

The state is on the provisioning record, not in a log line. If you still have the `prepare_workspace`
result, read it. Otherwise probe the two trees directly. There are **three states, not two, and the
version string distinguishes none of them**:

| state | `test -L <tree>/node_modules/@earendil-works/pi-durable` | `test -e <tree>/vendor/pi-main/packages/durable/dist/index.js` | what a demo in that tree measures |
|---|---|---|---|
| A **UNLINKED** (lockfile) | exit 1 (a real directory) | exit 1 (nothing built) | the released npm package |
| B **BUILT, NOT LINKED** | exit 1 | **exit 0** | still the released package - building is not linking |
| C **LINKED** (the par tree) | **exit 0**, target `…/vendor/pi-main/packages/durable` | exit 0 | the pinned commit durig is validated against |

```bash
for T in <item-worktree> <seat-root>; do
  test -L "$T/node_modules/@earendil-works/pi-durable"; echo "$T linked=$?"
  readlink -f "$T/node_modules/@earendil-works/pi-durable"
  test -e "$T/vendor/pi-main/packages/durable/dist/index.js"; echo "$T built=$?"
  sha256sum "$T/node_modules/@earendil-works/pi-durable/dist/index.js" | cut -c1-16   # artifact identity
done
```

**Healthy (state C) prints `linked=0` with a target under `vendor/pi-main/packages/durable`, `built=0`,
and a hash that MATCHES the other tree's.** Any `linked=1` means that tree measures the lockfile graph.

**THE TRAP (#5217): do NOT diagnose by version.** Measured 2026-11-06: `package.json` reports **1.3.0 in
both graphs** - the npm release and the pinned build carry the same version number while their
`dist/index.js` differ byte-for-byte (`4cee4286b156…` linked vs `467d9cf6b27c…` lockfile). "Same version"
is NOT parity; compare **link state and artifact hash**. A version-only diagnose passes silently on the
broken tree, which is exactly the failure mode this entry exists to stop.

**`sync-pi`'s own report DOES tell you the state (#5400, fixed 2026-11-07).** It used to print
`"buildTree": null, "built": [], "linked": null` even in a fully built AND linked tree, because those
fields were ACTION OUTPUTS - filled only when `--sync`/`--update`/`--link` was requested - so `built: []`
was not evidence of "unbuilt" and the file probe below was the only detector. They are now MEASUREMENTS
read back from disk on every path, and the default (drift-only) command answers the question on its own:

```bash
node scripts/sync-pi.mjs      # buildTree = the HEAD sha it is at, buildTreeAtPin, built = the pin
                              # packages that HAVE dist/index.js, linked = [{name,target,spec}] for the
                              # node_modules entries that RESOLVE into vendor/pi-main, dependencySet
exit 0
```

Measured in one worktree, same tree both ways: the pre-fix script printed `buildTree: null, built: [],
linked: null` (exit 0); the fixed one printed `buildTree` = the pinned sha with `buildTreeAtPin: true`,
`built: 9`, `linked: 9` naming `…/vendor/pi-main/packages/<dir>` for each, `dependencySet: "built-pin"`
(exit 0). After `--sync` alone in an unlinked tree: `built: 9`, `linked: 0`, `dependencySet:
"lockfile-released"`.

`dependencySet` is the field to quote in a verdict: a green in a `built-pin` tree and a green in a
`lockfile-released` tree measure DIFFERENT graphs and are not comparable. What the report does NOT give
you is artifact IDENTITY - two graphs can carry the same version and different bytes - so the `sha256sum`
probe above stays the check for "is this the same build"; only the link/built probes moved into the report.

### The suite header says it out loud now (#6196/#6202, measured 2026-11-11)

You no longer have to ask. Every `node scripts/test.mjs` run opens with ONE line from the single emitter
in `src/provenance.mjs` (`dependencyProvenance()` / `formatDependencyProvenance()`), and `scripts/land.mjs`
prints the same line for the scratch it measured:

```bash
node scripts/test.mjs --area readapi
# PROVENANCE tree=<sha> branch=<name> node=v24.22.1 host=linux … pi-durable=1.3.0 dependencySet=lockfile-released pin=main@dd30101cfc5b
# FALLBACK: this tree is NOT running the pinned pi (main@dd30101cfc5b). … run --sync --link before treating
#           this result as a verdict about main - it is a conditional observation about THIS tree.
```

Three facts are deliberately kept apart, because conflating them was the defect:

- **the PIN** - the commit this rig is validated against (`pi-main.pin.json`);
- **the DECLARED set** - what `package-lock.json` says will be installed (1.3.0 here);
- **the RESOLVED set** - what `node_modules` actually points at, and *through what path* (`via=built-pin`
  or `via=lockfile`).

`FALLBACK` means the link failed or was never run: the tree is measuring the released graph. It is LOUD,
not silent, and it is not drift. `DRIFT` means resolved differs from declared; a linked tree legitimately
has that (1.5.1 from the pin build against a lockfile still declaring 1.3.0), so the header prints ONE
summary line rather than one per package, and the per-package table is `node scripts/sync-pi.mjs --report`
(read-only; exit 1 when any package drifts). `mixed` is the state to worry about: some pin packages point
at the build, the rest at the lockfile.

This is additive: nothing refuses a landing on drift yet (that is #6205, held pending the baseline count
of unlinked worktrees), so a FALLBACK line is a fact to cite, not a gate that stops you.


The missing build tree is the usual cause: `--link` has nothing to point at, so it exits 1 with
`nothing built yet; run --sync before --link`, and provisioning continues on the lockfile by design.

## Do

1. If you need parity with the seat root (a verifier measuring the landing, or any suite verdict you
   will report), build the pinned tree in YOUR worktree, then re-prepare:

   ```bash
   node scripts/sync-pi.mjs --sync
   ```

   Then call `prepare_workspace` again for the same item. A reused worktree is only re-checked when
   its `node_modules` is missing, so to force a re-link delete `node_modules` in the worktree first
   (`node scripts/sync-pi.mjs --link` on its own is the direct form).

2. If you do NOT need parity, do nothing - and say so in your result: "suite run in the worktree,
   pi-durable from the lockfile, not the seat root". A stated dependency set is a usable verdict; an
   unstated one is not.

3. **RULE - detect BEFORE you cite, and name the tree in the citation.** No demo verdict is meaningful
   without the tree it ran in and the graph that tree resolves: write it as
   `node demo/<name>.test.mjs -> exit N in <worktree>, pi-durable <linked-at-pin | lockfile 1.3.0>`.
   Run the `linked=`/`built=` probe before quoting a green or a red, and treat `linked=1` as
   "this verdict cannot be compared with the seat root or with trunk". When you must compare two runs,
   compare them in the SAME state (C vs C), or state the state delta as part of the result.

4. Do not treat the delta as noise. Measured 2026-10-20: the same commit reported 3 red in the seat
   root and 7 after a worktree-local `npm ci`. Two of those were REAL content defects, one was an
   environment guard and five were dependency-version artefacts. A pass that calls the whole delta
   "environmental" will also excuse the real ones.

## Verify

The diagnose above ran on 2026-11-06 and DID distinguish the states (it must be able to fail): in a fresh
item worktree `linked=1 / built=1` (state A), after `node scripts/sync-pi.mjs --sync` (exit 0) `linked=1 /
built=0` (state B), and after `node scripts/sync-pi.mjs --link` (exit 0) `linked=0` with target
`<worktree>/vendor/pi-main/packages/durable` (state C). The artifact hash moved `467d9cf6b27c… ->
4cee4286b156…` while `package.json` kept saying `1.3.0`, which is the measurement that kills the
version-compare diagnose.

The behaviour is pinned by a demo that provisions a fresh worktree with no `vendor/pi-main` and
asserts the outcome is an explicit UNLINKED state, not a warning:

```bash
node demo/worktree-deps-link.test.mjs; echo "exit=$?"
```

Expect `exit=0` and a `PASS` line. If it is red, a failed link has gone back to being silent - stop
and route it to impl.

And the header itself is pinned (#6196/#6202):

```bash
node demo/suite-provenance.test.mjs; echo "exit=$?"   # header format, LOUD fallback, drift, built-pin
node scripts/sync-pi.mjs --report | head -2; echo "exit=${PIPESTATUS[0]}"
```

Ran 2026-11-11 in `item-6196`: the demo exits 0 in 3.7s (5 assertions, all ok); `--report` exits 1 in a
linked tree because the lockfile still declares 1.3.0 against the pin's 1.5.1 - the summary line names
the packages, and the same tree before `--sync --link` printed `dependencySet=lockfile-released` with the
FALLBACK line and exited 0.

## If it fails

If `sync-pi --sync` itself fails, the cause is upstream of this runbook: it fetches and builds the
pinned pi commit, so it needs network and a working `npm`. Report the JSON it prints (`{"ok":false,
"error":...}`) rather than retrying blindly. If `npm ci` is what fails, that is a different runbook:
[prepare-workspace-etarget.md](prepare-workspace-etarget.md).

## Escalate to

impl (the provisioning path). The operator, if the pinned build cannot be produced on this host.

## Evidence

impl-item-3821. Before the fix, on main: two `console.warn` lines reading only `Command failed:` (the
step's JSON on stdout was dropped, so even the warning had no cause) and an install record with no
dependency field at all. Last verified 2026-10-20 by impl.
