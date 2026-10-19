---
runbook: land
symptom: "a verified branch is not on main; land it without ever leaving the shared tree mid-merge"
writes: false
precondition: "broker-stopped"
last_verified: 2026-10-17
verified_by: impl
evidence: "node demo/land-helper.test.mjs -> exit 0 (helper scripts/land.mjs; items #1165/#1171, #1383 probe fix, #1399 outside-broker path)"
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
- **A landing pass CANNOT be driven by a broker-hosted seat.** Quiescing requires stopping the broker,
  and stopping the broker ENDS the run of any seat hosted by it — so such a seat cannot stop the broker
  and then land and report. (2026-10-17: the exclusive landing window closed QUIET BUT EMPTY for exactly
  this reason.) The pass must run OUTSIDE the broker — see Do step 0.
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
0. **Quiesce, then drive OUTSIDE the broker.** A broker-hosted seat cannot do this (Preconditions).
   Either stop the broker first (`broker-safe-change.md`) and then drive the pass with a plain
   `node cli.mjs run`/`send` (no broker hosting), or run `scripts/land.mjs` as a **DETACHED** process
   with the broker already stopped and quiescent. Then **hand-verify quiescence** — `"stopped": true`
   is NOT proof of exit: on 2026-10-17 the F11 drain held on a seat's lease and pid 37376 stayed alive
   ~8 minutes after `--stop` returned true (it exited only at `08:32:10`, `EXIT pid=37376 reason=stop
   passes=606`). Confirm BOTH:
   ```bash
   ls -1 <repo>/<db>.genlock*      # NO held slot
   # and NO `cli.mjs serve` process remains
   ```
   The hand-check is required even though **#1383** made the helper's probe resolve the store actually
   in use (it now REFUSES a mis-resolved store instead of passing silently). **Restart the broker
   afterwards.** *Durable fix:* ROADMAP **131** (`pause`/`unpause`, #1388) — pause, let seats settle,
   then land with the broker parked but not driving, so no stop is needed.
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
   - `--db <path>` — the rig store for the genlock pre-flight (default: `DURIAN_PI_DB`, else the store the
     repo is ACTUALLY using — the live broker's `<db>.broker.json`, or the only store with a live
     genlock — and only then `<repo>/rig.sqlite`; #1383).
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
  the tree is shared with other seats; see the constitution), then re-run. When the tracked WIP is
  **another seat's** in-flight edit, do not `git add` it and do not `git checkout`/`restore` it: back the
  diff up to a patch, park it to a **named** stash
  (`git stash push -m "delegate: park <what> for <date> landing window" -- <paths>`), land, and **leave
  the stash for its author to reconcile** — never pop it blind. 2026-10-19: a D109
  non-interactive-git WIP was parked this way (patch `.spike/delegate/D109-shared-tree-wip-20261019.patch`).
- **Refused on a held genlock:** a generation is in flight. Wait for it to settle, or stop the broker
  (`broker-safe-change.md`), then re-run.
- **The pass died when you stopped the broker** (your own run ended): that is the broker-hosted-seat
  trap (Preconditions). Re-drive it outside the broker (Do step 0) — do not re-run it from a seat.
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

2026-10-17 (the empty window, #1399): the exclusive landing window closed QUIET BUT EMPTY — the GO
procedure ran the landing from a seat hosted BY the broker, and stopping the broker to quiesce ended
that seat's run (#1390: impl claimed it 08:22:36, quiesced the broker, and the stop ended its own run).
Do step 0 (the outside-broker path) is the fix; ROADMAP **131** (`pause`/`unpause`, #1388) is the
durable one. Same session: **#1383** made the helper's genlock probe resolve the store in use and REFUSE
a mis-resolved store.
