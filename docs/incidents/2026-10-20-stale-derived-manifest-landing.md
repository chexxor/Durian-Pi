---
incident: stale-derived-manifest-landing
date: 2026-10-20
severity: sev2
status: resolved
symptom: "a branch lands green in the helper's scratch, then its OWN new guard fails on main because the set it enumerates grew after the branch was written"
runbook: land
fix: "0976cc4"
prevention: "land.md pre-land rule (run the branch's own new/changed demos against CURRENT main before landing) + regenerate derived manifests at landing; #3238 rework"
last_reviewed: 2026-10-20
---

# A landed guard fails on `main` because its derived manifest was a snapshot

*Incident 2026-10-20; detected by the delegate's post-landing full suite; analysis by the delegate.*

## Summary

`devtools-item-1558` (test-suite partitioning, tip `17cd7a2`) was landed onto `main`. It adds a guard,
`demo/test-areas.test.mjs`, that asserts every `demo/*.test.mjs` on disk is mapped to an area in
`demo/test-areas.json`. That manifest was written against the demo set of its own branch date. By
2026-10-20 the suite had **57** demos the manifest did not know about, so the branch's own guard turned
`main` red immediately after landing. The merge was reverted (`0976cc4`); the branch ref was kept for
rework.

The gate that should have caught it did not, for a second, independent reason: `scripts/land.mjs
--suite` stops at the **first** failing demo, and the known-red `demo/pitui.test.mjs` (#2412) sorts
before `test-areas`, so the run never reached the new guard.

## Timeline

- `~00:50Z` — landing pass preflights `devtools-item-1558` with `git merge-tree --write-tree main
  devtools-item-1558` → exit 0 (clean). The suite-level test was not run at the tip.
- `~00:55Z` — `node scripts/land.mjs scribe-item-3167 impl-item-3062 devtools-item-2412
  devtools-item-1558 --suite` stops on `command-spool` (a separate defect); `main` unchanged.
- `~01:00Z` — the same set without the broken 2412 is retried with `--suite`; it runs 89 demos and
  stops at `pitui` (known red). `main` unchanged.
- `~01:02Z` — the three are landed **without** `--suite`: `main` `9882632` → `abb9c54`.
- `~01:12Z` — `node scripts/suite.mjs` on `main`: `pass=179 fail=2` — `pitui` plus the new
  `test-areas`.
- `~01:14Z` — `node demo/test-areas.test.mjs` fails with 57 “on disk but not mapped to any area”
  entries. `git revert -m 1 --no-edit abb9c54` → `0976cc4`; suite returns to `pass=179 fail=1`
  (`pitui` only).
- `~01:20Z` — `pm` registers rework `#3238` (regenerate the manifest against current `demo/`, re-run
  the test, re-land). The ref stays at `17cd7a2`.

## Impact

- `main` was red for a new reason for ~12 minutes; a later landing pass would have inherited a red gate
  that was not `pitui`, which is exactly the ambiguity the suite classifier exists to prevent.
- The revert is a merge-plus-revert pair in history; no work was lost (the branch and its commits
  remain, and `#3238` owns the fix).
- No store or worktree data risk: the landing helper never touched the shared tree mid-merge.

## Root cause

Two mechanisms compounded:

1. **A derived artifact was committed as a snapshot.** `demo/test-areas.json` enumerates the current
   `demo/` directory. A branch that adds such a guard is green on its own fork and red on any `main`
   that gained a demo since — the guard is not wrong, but the artifact must be regenerated at land
   time, or derived at test time.
2. **The landing suite gate ran one branch's tests in a first-failure loop.** `--suite` stops at the
   first non-zero demo. Because `pitui` is a known-red assertion and sorts before `test-areas`, the
   helper could not see the new failure even when it did run. The post-landing full suite was the only
   complete check.

## Detection

`node scripts/suite.mjs` after the landing printed `pass=179 fail=2` and named both failures. The
runner's classification kept this legible: `test-areas` was a REAL failure, not environmental.

## Resolution

`git revert -m 1 --no-edit abb9c54` restored `main` to `pass=179 fail=1` (`pitui`). The branch ref is
kept at `17cd7a2`; `#3238` (claimed by `devtools`) regenerates the manifest and re-lands.

## Prevention

- **`land.md` pre-land rule (new):** before landing a branch that adds or changes a test over a
  growing set, run that branch's own new/changed demos against **current** `main` — not only
  `git merge-tree` (which proves textual cleanliness, not semantic currency).
- **Derive, don't snapshot:** a manifest that enumerates `demo/` should be generated at test time (or
  regenerated in the landing pass) rather than committed as a list that rots. `#3238` is the immediate
  rework; the durable form belongs with the test-areas design.
- **`land.md` note (new):** the helper's `--suite` is a first-failure loop, so while `pitui` is
  known-red it never reaches later tests. When `--suite` cannot be used, land without it and run the
  **full** suite on `main`; that is what caught this.
- Follow-up candidate: make `scripts/land.mjs --suite` call the pooled `scripts/suite.mjs` and report
  every failure instead of stopping at the first (not done here; recorded in `NEXT.md`).

## Evidence

- `git log --oneline -3 main` before the revert: `abb9c54 merge: land devtools-item-1558 onto main`,
  `a55535e merge: land impl-item-3062 onto main`, `35f8ae6 merge: land scribe-item-3167 onto main`.
- `node scripts/suite.mjs` on `abb9c54`: `SUITE FAILED: pass=179 environmental=0 fail=2 — REAL
  FAILURES: pitui.test.mjs, test-areas.test.mjs`.
- `node demo/test-areas.test.mjs` at `abb9c54`: `AssertionError … manifest does not cover the suite`
  listing 57 demos, first `demo/blockedby-field.test.mjs`, last
  `demo/worktree-scratch.test.mjs`; exit 1.
- `git revert -m 1 --no-edit abb9c54` → `0976cc4`; `node scripts/suite.mjs` →
  `pass=179 environmental=0 fail=1 — pitui.test.mjs`.
- Landing attempts: `.spike/delegate/model-1017/land1.json` (stopped on `command-spool`),
  `land2.json` (stopped on `pitui`, 89 demos), `land3.json` (landed 3).
- `pm` rework item `#3238`; corrected landing list `#3243`/`#3247` withdraws `1558 @17cd7a2`.

## Links

- Runbook: [land](../runbooks/land.md)
- Related: `#2412` (the `pitui` resolution-path assertion), `#3238` (rework), `#3239` (the sibling
  `configure`/gate landing stop), `docs/BRANCH-AND-WORKTREE-LIFECYCLE.md`.
