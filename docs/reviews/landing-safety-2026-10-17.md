# Landing safety — keep the shared working tree out of a conflicted merge

*Incident 2026-10-17; raised by the operator; analysis by the delegate.*

## Summary
The 2026-10-17 landing pass (`#1157`) merged verified branches directly into the **shared `main` working
tree** while the rig was live. When `impl-item-714` (#714) conflicted, the tree sat with `.git/MERGE_HEAD`
and `<<<<<<<` markers in `src/checkup.mjs` and `demo/starter.test.mjs`. Because `cli.mjs` statically
imports `src/checkup.mjs`, **every `node cli.mjs` verb failed to load** (`SyntaxError`) — `status`,
`queue`, `run`, and `serve` were all unavailable until impl resolved the merge (~2 minutes). qa was
generating concurrently, so the tree was half-merged for other writers too.

The conflict itself was routine. The harm was that the shared tree was left in an **unresolved state at
all**, for any duration, while the rig was live.

## Evidence
- `.git/MERGE_HEAD` = `ed2b5dc`; `MERGE_MSG` = `merge: land impl-item-714 onto main (#714)`.
- Unmerged paths: `src/checkup.mjs` (markers at ~83–96 and ~330–405), `demo/starter.test.mjs`.
- `node cli.mjs queue --help` → `SyntaxError: Unexpected token '<<'` at `src/checkup.mjs:83`.
- Static import sites of `checkup.mjs`: `cli.mjs:77`, `src/metrics.mjs:22`, `src/seattools.mjs:17`.
- Broker (`pid 13712`) was live throughout; a `genlock.*` slot was held by `qa` during the merge.
- The conflict resolved to a **union** (both branches' rules kept in `checkup.mjs`) — the correct
  resolution was semantic, not ours-or-theirs.

## Why the runbook allowed it
`docs/runbooks/merge.md` stated: *"Git only — this opens no store Harness, so the broker need not be
stopped"*, and required only "one landing at a time." Both are true about the **store**; neither accounts
for the **shared working tree**, which the live rig reads. A conflicted merge is a working-tree state, and
any process that imports a conflicted module dies.

## Ideas
1. **Quiesce the landing window.** A multi-branch landing pass runs with the broker stopped and no
   `genlock.*` held (the `broker-safe-change.md` pattern): stop → land → verify → restart. Drop the
   "broker need not be stopped" claim for landing passes.
2. **Keep `main`'s working tree out of the merge.** Land in a scratch/detached worktree off `main`;
   resolve and run the suite there; advance `main` only when clean. Invariant: `main`'s working tree is
   never in a `MERGE_HEAD` state while the rig is live. (Constraint: `main` is checked out in the shared
   tree, so the scratch worktree must be detached and `main` advanced by a clean fast-forward.)
3. **Reduce blast radius.** Make `checkup` a **dynamic import** in `cli.mjs` so a mid-merge module
   degrades `check` instead of every verb; add a startup guard for `.git/MERGE_HEAD` that gives write
   verbs a legible refusal instead of a raw stack trace.
4. **Guard the operation.** Refuse to start a merge when the tree is dirty or a `genlock.*` is held, plus
   a low-layer in-progress-merge check. Chicken-and-egg: the guard must **not** depend on `checkup`, or a
   conflicted `checkup.mjs` disables the guard too.
5. **Measure before building conflict/diff tools.** 4 conflicts / 15 branches this pass. Feed ROADMAP 100
   (landing health); invest in a hunk-picker or `apply_patch` only if incidence is material. The #714
   resolution needed **synthesis**, so a side-picking chunk tool alone would have been wrong.

## Already actioned by the delegate
- `docs/runbooks/merge.md`: corrected the precondition (read-only diagnosis needs no stop; a landing pass
  needs an exclusive window) and added the conflict rule (never leave the shared tree mid-merge).

## Proposed work (for `pm` to register, `lead` to rule)
- **Landing-window rule** (process + runbook alignment; `pm`): the landing directive carries "stop the
  broker, confirm no genlock, land, verify, restart."
- **Resilient startup + conflict guard** (impl; `lead` rules placement): lazy `checkup` import, a
  `.git/MERGE_HEAD` startup refusal for write verbs, and a pre-flight merge guard.
- **Scratch-worktree landing** (`lead`/impl design call): decide whether to require it or accept the
  stop-the-world window. The window is the cheaper fix; the worktree removes the window's cost to other
  seats.

## Acceptance
- A landing pass never exposes a `MERGE_HEAD`/conflicted working tree to the live rig.
- With a conflicted tracked module, `status`/`queue` still work.
- Conflict incidence is recorded in the landing-health metric (ROADMAP 100).
- `merge.md`'s `Verify` step runs on a real landing and sets `last_verified`.
