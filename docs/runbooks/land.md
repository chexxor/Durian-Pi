---
runbook: land
symptom: "a verified branch is not on main; land it without ever leaving the shared tree mid-merge"
writes: false
precondition: "none"
last_verified: 2026-10-17
verified_by: impl
evidence: "node demo/land-helper.test.mjs -> exit 0 (helper scripts/land.mjs; items #1165/#1171)"
check_rule: null
---

# Land a branch with the helper (`scripts/land.mjs`)

## When to use
A verified branch (`<seat>-item-<id>`, or any branch) must go onto `main`, and you want the landing to
be **structurally incapable** of leaving the shared working tree mid-merge. This is the tool form of
the landing half of W2. `merge.md` holds the manual `git merge` steps and the review checklist; the
helper is the safe default and the **enforcement chokepoint** — the runbook and `check` are advisory,
the helper is what actually refuses a bad landing.

## Impact
A landing that merges into the shared tree while the rig drives is the 2026-10-17 incident: one
conflicted branch left `.git/MERGE_HEAD` and `<<<<<<<` markers in `src/checkup.mjs`, and every
`node cli.mjs` verb died. The helper removes the class of harm — the merges happen in a **scratch
detached worktree**, and `main` advances only by a **clean fast-forward**. The shared tree is never
mid-merge, whatever a branch does.

## Preconditions
- The branch is **verified** (qa/auditor ack) and mergeable — see `merge.md`'s checklist.
- The helper enforces the two hard preconditions itself (below); nothing else must be true first. A
  landing pass still wants a **quiesced window** (`merge.md` Preconditions): the helper refuses while a
  generation is in flight, but stop the broker (`broker-safe-change.md`) if you want no seat generating.
- Never land a snapshot/archive branch (`merge.md` universal gate).

## Diagnose (read-only)
```bash
git -C <repo> status --porcelain                 # tracked changes block a landing; '??' untracked do NOT
git -C <repo> merge-base --is-ancestor <branch> main && echo ALREADY-LANDED
git -C <repo> rev-list --count main..<branch>    # 0 once landed
```
The helper's pre-flight, in code (the enforcement chokepoint):
- **Tracked modifications only** block. An untracked file cannot be clobbered by a fast-forward, and the
  shared tree normally carries other seats' untracked notes — refusing on those would make the guard
  useless rather than safe.
- **`MERGE_HEAD`** present (the tree is already mid-merge) blocks — the landing must not add to it.
- **genlock**: it probes `<db>.genlock.*` beside the store with `node:fs` only (no provider stack). A slot
  whose JSON names an **ALIVE** pid blocks (signal `0`; only `ESRCH` means gone — `EPERM` means alive but
  unsignalable). A partial/unreadable slot is **not** evidence of a live run and does not block.

## Do
1. Confirm the branch and sha, and that the shared tree has no tracked changes:
   ```bash
   git -C <repo> log --oneline -1 <branch>
   git -C <repo> status --porcelain
   ```
2. Land with the helper (its JSON report is always printed):
   ```bash
   node scripts/land.mjs <branch> [<branch>...] [--repo <repo>] [--db <path>] [--suite] [--keep]
   ```
   - `--repo <dir>` — the shared repository root (default: the repo containing cwd).
   - `--db <path>` — the rig store for the genlock pre-flight (default: `DURIG_DB`, else `<repo>/rig.sqlite`).
   - `--suite` — run every `demo/*.test.mjs` **in the scratch worktree** and refuse to advance `main` if
     any fails (exit 0 = pass). This is the strongest landing gate: prove the merged result before it
     becomes `main`.
   - `--keep` — keep the scratch worktree on failure, so a conflict can be resolved **there**.
   - `--json` — accepted for symmetry; the report is JSON either way.
3. Read the report. **Exit 0** = `main` advanced (or already contained every branch). **Nonzero** =
   refused or stopped, with the reason in `report.error`.
4. **Conflict** — the merge stops **in the scratch**; the shared tree was never touched and is not
   mid-merge. By default the scratch is removed; re-run with `--keep` to get a real scratch path in the
   report, resolve it per `resolve-merge-conflict.md`, then re-run the landing.
5. After a clean land, remove the item's worktree if it is clean (`merge.md` Do step 5). The helper
   never forces and never leaves a scratch or a mid-merge shared tree behind.

## Verify
```bash
node demo/land-helper.test.mjs   # exit 0 — proves the helper's behaviour these steps rely on
```
After a real landing, confirm the branch is an **ancestor** of `main` (the worktree-prune criterion):
```bash
git -C <repo> merge-base --is-ancestor <branch> main && echo LANDED
```

## If it fails
- **Refused on tracked modifications:** commit or stash the shared tree's work first (never blindly —
  the tree is shared with other seats; see the constitution), then re-run.
- **Refused on a held genlock:** a generation is in flight. Wait for it to settle, or stop the broker
  (`broker-safe-change.md`), then re-run.
- **Stopped on a conflict:** re-run with `--keep` and resolve in the named scratch
  (`resolve-merge-conflict.md`). Do **not** merge into the shared tree by hand — that is the incident.
- **`--suite` failure:** a demo is red in the scratch; `main` was **not** advanced. Fix the branch and
  re-land.
- **`cannot fast-forward main`:** something advanced `main` while the scratch merge ran (the helper
  re-checks the tree before the FF). Re-run; the scratch result was clean.
- A demo red on the merged result after the fact: `git revert -m 1 <merge>` and report the exact failure
  to the author; do not fix forward on `main`.

## Escalate to
`pm` — to route a landing pass or open a landing item when the unlanded set grows; `lead` — when a
branch cannot merge cleanly.

## Evidence
Helper landed for items #1165/#1171 (`scripts/land.mjs` + `demo/land-helper.test.mjs`). Verify step
`node demo/land-helper.test.mjs` ran **2026-10-17** -> exit 0 (scratch-worktree landing, the tracked-dirty
/ `MERGE_HEAD` / live-genlock refusals, the conflict-in-scratch path with `--keep`, and `--suite`).
