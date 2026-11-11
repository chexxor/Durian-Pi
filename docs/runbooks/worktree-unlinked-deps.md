---
runbook: worktree-unlinked-deps
symptom: "prepare_workspace says DEPENDENCY NOT LINKED, or a fresh worktree's suite fails demos that pass in the seat root (measured shape 2026-11-10: 261/282 with 21 reds in the broker/cli/tui-durable families and `TypeError: listener is not a function` at pi-durable 1.3.0 `session.js:575`), or the same demo file gives different results in the item worktree and the seat root while BOTH report the same pi-durable version, or a verb refuses the store with `Durable SQLite schema version 2 is newer than supported version 1`"
writes: false
precondition: "read-only"
last_verified: 2026-11-11
verified_by: devtools
evidence: "#6314 (2026-11-11, native Windows host, node v24.22.1), ONE named tree (`item-6314`) with only the dependency graph changed: unlinked (lockfile pi-durable **1.3.0**) -> a write-mode open of the live store REFUSED with `Durable SQLite schema version 2 is newer than supported version 1`, exit 1; after `node scripts/sync-pi.mjs --sync --link` (27 s, `dependencySet: "built-pin"`, **1.5.1**) the same store opened, exit 0. The refusal is PATH-dependent: `node tools/held-gate-audit.mjs --db <copy> --limit 3` exited **0** in the same unlinked tree (`rows=6838 held=430`) because it reads through `src/readonlystore.mjs` (`node:sqlite` readOnly, no migration), which never reads `durable_schema`. Pinned by `node demo/store-open-refusal.test.mjs` exit 0, both branches walked against the vendor's own refusal. #3821 - the link step's failure is recorded and reported instead of console.warned; demo/worktree-deps-link.test.mjs. #5217 (2026-11-06, Linux, node v24.22.1): all three states walked in one worktree - UNBUILT (built-dist exit 1, symlink exit 1) -> `sync-pi --sync` (exit 0, 9 packages built) -> `--link` (exit 0, symlink exit 0 pointing at vendor/pi-main/packages/durable). Version stayed **1.3.0 in every state and in every tree** while the artifact changed: sha256 of `node_modules/@earendil-works/pi-durable/dist/index.js` = `4cee4286b156…` (linked, built from the pin) vs `467d9cf6b27c…` (lockfile) in two other worktrees. `node demo/worktree-deps-link.test.mjs` exit 0 in the linked tree."
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

The missing build tree is the usual cause: `--link` has nothing to point at, so it exits 1 with
`nothing built yet; run --sync before --link`, and provisioning continues on the lockfile by design.

## The schema-version refusal is PATH-dependent, not tree-dependent (#6314)

Measured 2026-11-11 in worktree `item-6314`, the only variable being the dependency graph:

| state | what ran | result |
|---|---|---|
| unlinked, lockfile pi-durable **1.3.0** | a write-mode open of the store | `Durable SQLite schema version 2 is newer than supported version 1`, **exit 1** |
| the same tree after `node scripts/sync-pi.mjs --sync --link` (27 s, `dependencySet: "built-pin"`, **1.5.1**) | the same open of the same store | opens, **exit 0** |
| unlinked | `node tools/held-gate-audit.mjs --db <copy> --limit 3` | **exit 0**, `rows=6838 held=430` |

The third row is how a refusal gets reported and then "fails to reproduce": the audit tool reads through
`src/readonlystore.mjs` (`node:sqlite`, `readOnly: true`, no migration), which never reads the
`durable_schema` row at all. The vendor's predicate is in `applySqliteMigrationsForSchema`: it throws when
`durable_schema.version` exceeds the last migration the installed package carries. 1.3.0 declares
`[{version: 1}]`; the pinned 1.5.1 declares `[{version: 1}, {version: 2}]`, where 2 rebuilds the `tasks`
table to admit the `sleeping` status. A read-only shim can therefore serve a store the installed package
could not open - and a number from it is a number about a graph the reader has not named.

Since #6314 the refusal names the graph it came from and the remedy. Real output from an unlinked tree:

```text
cannot open .spike/ahead-store.sqlite: Durable SQLite schema version 9 is newer than supported version 1.
The store is not corrupt: it is ahead of the pi this tree can read. This tree resolves
@earendil-works/pi-durable 1.3.0 from the LOCKFILE, not the pinned build v1.5.1 - the store is readable
only from the pinned graph. Fix the graph, not the store: node scripts/sync-pi.mjs --sync --link in
<worktree>. Do NOT lower durable_schema.version by hand (docs/DECISIONS.md D128), and note that
sync-pi --unlink is not a rollback - it restores a released package that cannot open a schema-v2 store.
```

A linked tree is told the opposite truth - `This tree IS on the pinned build (v1.5.1) ... the pin has to
move, per docs/runbooks/pi-pin-update.md` - because syncing there would not help.

These sites still open the store raw and print the vendor text with no graph: `scripts/read-constitution.mjs`,
`scripts/compact-eval.mjs`, `tools/compaction-acceptance.mjs`, `tools/probes/checkpoint-bound-size-leg.mjs`,
`src/tui/durable/enter.mjs`.

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

The refusal's provenance is pinned by a demo that walks BOTH branches against the vendor's own refusal
(a fixture store at `durable_schema` version 9, which no installed pi can open): a lockfile-released tree
is told to fix the graph, a built-pin tree is told the pin has to move, and an unrelated open failure is
left alone. Verified 2026-11-11 in `item-6314`:

```bash
node demo/store-open-refusal.test.mjs; echo "exit=$?"   # expect 0 and a PASS line
```

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
