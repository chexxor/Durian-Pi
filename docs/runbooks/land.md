---
runbook: land
symptom: "a verified branch is not on main; land it without ever leaving the shared tree mid-merge"
writes: false
precondition: "tree-clean"        # the broker may stay UP: the helper publishes a priority reservation and WAITS for the genlock slots at the FF (#1497/#1498)
last_verified: 2026-10-19
verified_by: delegate
evidence: "node demo/land-helper.test.mjs; 2026-10-19 live landings with the broker UP (lock {slots:4,held:4,reserved:true}), main 4f9e7d6->7b6548e (suite 156 pass/1 env fail) and a second pass 67228b9->3b79159 (17 branches, suite 175 pass/1 env fail, inconsistent-tip and conflicting branches correctly SKIPPED); the --suite gate re-proved in a linked scratch at 3b79159 (demo/check.test.mjs exit 0, was exit 1 before impl-item-2679)"
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

## QUICK PATH (verified 2026-10-19) — land with the broker UP, prove on `main`

`scripts/land.mjs` now **waits** for the generation slots instead of refusing while a seat generates
(#1497/#1498), so the common pass does NOT need to stop the broker. The one hard precondition is a
**clean tracked tree** (untracked scratch does not block). Do exactly this and you will not have to
ask "stop or not?" or "why did --suite fail?".

1. Park another seat's tracked WIP, if any, to a NAMED stash and save a patch first
   (never `git checkout`/`restore` it):
   `git diff -- <paths> > <patch>; git stash push -m "delegate: park <what> for <date> landing" -- <paths>`
   Restore it with `git stash pop` when the landing is done.
2. Preflight each candidate read-only — this tells you landed vs conflict WITHOUT a suite run:
   `git merge-tree --write-tree main <branch>` (exit 0 = clean, nonzero = conflict).
3. Land the clean set in ONE call: `node scripts/land.mjs <b1> <b2> ... --db ./selfdev.sqlite`.
   Read the JSON report; `lock.reserved:true` / `lock.waitedMs` show it waited for the slots.
4. **The `--suite` gate works again (FIXED 2026-10-19, `impl-item-2679` on `main`).** The defect was:
   `--suite` runs each demo in the helper's **detached** scratch worktree, and the `shared-tree-on-main`
   check rule (`50f981a`) flagged a detached HEAD — so `demo/check.test.mjs` failed there and the helper
   refused with `STOPPED: demo/check.test.mjs failed`. The rule now **skips a LINKED worktree**
   (`isLinkedWorktree`: per-worktree git dir vs the common git dir) while still firing on the **shared**
   tree off `main`, so a landing scratch no longer trips it. **Prefer `--suite`** — it proves the merged
   result before it becomes `main`:
   ```bash
   node scripts/land.mjs <b1> <b2> ... --db ./selfdev.sqlite --suite
   ```
   Prove it yourself before relying on it: create a scratch INSIDE the repo (the helper puts its own at
   `<repo>/.land-scratch-<pid>`, so `node_modules` resolves upward) and run the rule's demo there:
   ```bash
   git worktree add --detach "$PWD/.gate-check" main
   ( cd .gate-check && node demo/check.test.mjs; echo "exit=$?" )   # exit 0 at 3b79159 (was 1)
   git worktree remove --force "$PWD/.gate-check"; git worktree prune
   ```
   A scratch **outside** the repo fails for an unrelated reason (`ERR_MODULE_NOT_FOUND
   '@earendil-works/...'`) — that is not the rule, so do not read it as a regression. Whatever the helper
   reports, still prove the final result on `main`:
   ```bash
   node scripts/suite.mjs        # 0 green / 1 real failure / 2 environmental
   ```
   The only failure you should see is `demo/pitui.test.mjs` (the `node_modules/@earendil-works/pi-tui`
   symlink — environmental, not a regression). A REAL failure means `git revert -m 1 <merge>` per
   "If it fails" below.
   *(`--suite` was skipped for the 2026-10-19 passes while the rule was broken; the helper itself never
   required it, and the post-landing `node scripts/suite.mjs` run is what proved those landings.)*
5. Prune each landed ref (`git branch -d` refuses anything unmerged, so this is lossless):
   ```bash
   git merge-base --is-ancestor <branch> main && git branch -d <branch>
   ```
   Release its worktree first (`leaked-worktrees.md`) — a DIRTY worktree must be relocated, never
   force-removed.

## Preconditions
- The branch is **verified** (qa/auditor ack) and mergeable — see `merge.md`'s checklist. The helper's
  `--suite` gate proves the MERGED RESULT, but it does NOT prove the branch was verified: check the
  landing list's tip against the branch tip and the gate item's status yourself (`land` is the
  delegate's/operator's action, not the team's).
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
- **slot cap** — `resolveSlotCount(repoRoot)` decides how many generation slots the lander claims, in
  this order: `DURIG_MAX_CONCURRENT_SEATS` (env) > `durig.config.json` / `.durig/config.json`
  (`DEFAULT_CONFIG_PATHS`) > the shipped defaults `durig.config.default.json` / `.durig/config.default.json`
  / `../durig.config.default.json` (`DEFAULTS_CONFIG_PATHS`) > uncapped (`null`). Both path lists come from
  `src/config.mjs`, the same module the broker's `maxSeats()` reads, so the lander and the broker cannot
  drift (#2224/#1498). An UNCAPPED resolution is why a config-less checkout (CI / fresh clone) once
  skipped both the priority reservation and the exclusive slot claim while the broker was capped at the
  shipped default — the hazard #2224(A) closes.

## Do
0. **Quiesce, then drive OUTSIDE the broker.** A broker-hosted seat cannot do this (Preconditions).
    Either stop the broker first (`broker-safe-change.md`) and then drive the pass with a plain
   `node cli.mjs run`/`send` (no broker hosting), or run `scripts/land.mjs` as a **DETACHED** process
   with the broker already stopped and quiescent. **As of 2026-10-19 this stop is OPTIONAL** — the
   helper publishes a priority reservation and waits for the slots, so a plain external caller can
   land with the broker UP (see the QUICK PATH). Stop it only when you want the guarantee that no seat
   generates. If you DO stop it, **hand-verify quiescence** — `"stopped": true`
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

## Landing a SET (a cluster): serial, re-preflighted, per-item gated

When the landing list has a dozen verified entries (2026-10-19: the 13-item bugfix cluster, all touching
`src/broker.mjs`/`cli.mjs`), do **not** hand them all to one helper call and do not trust a single
preflight. Loop, re-preflighting against the **moving** `main` before each one:

```bash
for b in <branches in landing order>; do
  git rev-parse --verify --quiet "$b" >/dev/null || { echo "$b MISSING"; continue; }
  git merge-tree --write-tree main "$b" >/dev/null 2>&1 || { echo "$b CONFLICT (skip)"; continue; }
  node scripts/land.mjs "$b" --db ./selfdev.sqlite > .spike/delegate/land-$b.out 2>&1 \
    && echo "$b LANDED -> $(git rev-parse --short main)" || echo "$b FAILED"
done
```

Three rules that pass proved:
1. **Re-preflight per item, not once for the set.** Branches that were clean against the OLD `main`
   conflict after the first few merge (`src/broker.mjs` is the collision surface). 2026-10-19: 15 of 18
   landed; `impl-item-2574`, `impl-item-2578`, `impl-item-2777` conflicted only because `main` had moved.
   Their landing list said "verified", so a batch call would have refused all 18 and hidden the 15 clean ones.
2. **Never land a branch whose tip does not match its landing list.** Compare
   `git rev-parse <branch>` against the `@<sha>` named in the landing-list item; a mismatch means the
   branch moved after its verify, so the verify no longer covers it (`devtools-item-2261` on 2026-10-19).
3. **Land in the order the item prescribes.** A stack names its order explicitly (`#2420` BEFORE `#2483`;
   `#2483` also carries a rework gate) — read the landing-list body, not just the subject.

Then prove the whole merged result ONCE on `main` (`node scripts/suite.mjs`) and prune per
`branch-cleanup.md` / `leaked-worktrees.md`.

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
