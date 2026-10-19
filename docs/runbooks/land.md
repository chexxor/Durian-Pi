---
runbook: land
symptom: "a verified branch is not on main; land it without ever leaving the shared tree mid-merge"
writes: false
precondition: "none"          # no store/Harness precondition — the helper is git-only and WAITS for the genlock slots; the tracked tree must be clean (see Preconditions)
last_verified: 2026-10-19
verified_by: delegate
evidence: "node demo/land-helper.test.mjs; 2026-10-19 live landings with the broker UP (lock {slots:4,held:4,reserved:true}), main 4f9e7d6->7b6548e (suite 156 pass/1 fail — the pitui resolution-path failure, #2412) and a second pass 67228b9->3b79159 (17 branches, suite 175 pass/1 fail, inconsistent-tip and conflicting branches correctly SKIPPED); the --suite gate re-proved in a linked scratch at 3b79159 (demo/check.test.mjs exit 0, was exit 1 before impl-item-2679)"
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
   The only failure you should see is `demo/pitui.test.mjs` — but it is NOT environmental: it is a
   resolution-path ASSERTION (the `node_modules/@earendil-works/pi-tui` symlink to `vendor/pi-main`,
   tracked at **#2412**), so the runner lists it under REAL FAILURES and the suite exits 1. Until #2412
   lands, report the exact `pass=N fail=M` and prove a failure is new by comparing with the pre-change
   baseline — never "green except pitui". A REAL NEW failure means `git revert -m 1 <merge>` per
   "If it fails" below.
   **Capture the exit code — never pipe the runner.** `node scripts/suite.mjs | tail -3` reports
   `tail`'s status, not the suite's (2026-10-19: this produced a false "SUITE_EXIT=0" report on a red
   suite):
   ```bash
   node scripts/suite.mjs > /tmp/suite.out 2>&1; rc=$?; tail -2 /tmp/suite.out; echo "exit=$rc"
   ```
   **"Environmental" is the RUNNER's word, and `pitui` is not in it.** `src/suite.mjs` calls a demo
   environmental only when it was killed by a signal, exited with an `ENVIRONMENTAL_ABORT_CODES` code,
   or its stderr matched a commit/memory-starvation pattern. `demo/pitui.test.mjs` is a
   resolution-path ASSERTION, so the runner prints `FAIL`, lists it under REAL FAILURES, and the suite
   exits **1** — while this runbook (and `NEXT.md`) call that failure environmental. Both statements
   are true of different things and no artifact reconciles them, so **report the exact `pass=N fail=M`**
   and prove a failure is new by comparing with the pre-change baseline — never "green except pitui"
   (owning item **#2412**; full account: `docs/BRANCH-AND-WORKTREE-LIFECYCLE.md` §6.2).
   *(`--suite` was skipped for the 2026-10-19 passes while the rule was broken; the helper itself never
   required it, and the post-landing `node scripts/suite.mjs` run is what proved those landings.)*
5. Prune each landed ref (`git branch -d` refuses anything unmerged, so this is lossless):
   ```bash
   git merge-base --is-ancestor <branch> main && git branch -d <branch>
   ```
   Release its worktree first (`leaked-worktrees.md`) — a DIRTY worktree must be relocated, never
   force-removed.

## Preconditions
- **This runbook is the STEPS; `docs/BRANCH-AND-WORKTREE-LIFECYCLE.md` is the MODEL.** The three landing
  gates — *verified* (queue), *tip matches the landing list* (queue prose vs `git rev-parse`), and
  *clean against the CURRENT `main`* (`git merge-tree`) — and which source is authoritative for each,
  are mapped there; read its §5 before deciding a branch is landable.
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
- **A BATCH ABORTS ATOMICALLY ON AN INTRA-BATCH CONFLICT — `main` is NOT advanced.** (2026-10-19, measured.)
  `land.mjs b1 b2 b3` merges into ONE scratch tree, so a later branch can conflict with the **newer**
  state that an earlier branch in the SAME call just created. The report then has a non-empty `merged[]`
  AND `"ok": false` + `"scratch": null`. **`merged[]` lists what merged in the SCRATCH; it does NOT mean
  it landed.** Measured case: `architect-item-2984` and `architect-item-3005` both ADD the same file, so
  `land.mjs 2976 2744 2984 3005 2545 1966` reported `merged: [2976, 2744, 2984]` and stopped on 3005 —
  and `git log main` was **unchanged**. Always confirm with `git log --oneline -1 main` before believing a
  pass; then **re-preflight every remaining branch against the NEW `main`** (`git merge-tree`) and split
  the batch — a branch that was CLEAN before the pass can be CONFLICT after one landing.
- **Two branches that both ADD the same path cannot land in EITHER order** (`add/add`). Do not waste a
  pass trying both orders, and do not reflexively route an author rebase — **check for a strict superset
  first**, because then the resolution is deterministic and no judgement is involved:
  ```bash
  git diff --numstat <branchA>:<path> <branchB>:<path>     # added / deleted / path
  ```
  If `deleted` is 0 and `added` covers B's extra content, B contains A; the only correct resolution is
  B's blob. (2026-10-19: `architect-item-3005` = 2984's 550 lines **+108**, 0 deletions, and `main`'s
  blob after landing 2984 was byte-identical to 2984's — so 3005 was resolved to its own blob in a
  scratch worktree, committed as `<branch>-rebased`, and landed. Record the resolution in the commit
  message; it is regenerable evidence, not a hand merge.)
  If neither side is a superset, that IS a semantic conflict: §Abstain — route the author rebase
  (`resolve-merge-conflict.md` step 4).
- **Refused on tracked modifications:** commit or stash the shared tree's work first (never blindly —
  the tree is shared with other seats; see the constitution), then re-run. When the tracked WIP is
  **another seat's** in-flight edit, do not `git add` it and do not `git checkout`/`restore` it: back the
  diff up to a patch, park it to a **named** stash
  (`git stash push -m "delegate: park <what> for <date> landing window" -- <paths>`), land, and **leave
  the stash for its author to reconcile** — never pop it blind. 2026-10-19: a D109
  non-interactive-git WIP was parked this way (patch `.spike/delegate/D109-shared-tree-wip-20261019.patch`).
- **A full-sha value comes back as `[redacted by durig: ...]`.** The secret redactor classifies a bare
  40-char git SHA as `high-entropy-token`, so `git rev-parse <ref>` / `git merge-tree --write-tree`
  output can be replaced (incident `2026-10-19-git-sha-redacted-as-secret.md`). **Use `--short` ids and
  the `--name-only`/`exit=` form** in every preflight and report; never conclude "the branch has no tip"
  from a redacted line.
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

2026-10-19 (pass #3, delegate, broker UP): **6 landed, `main` `f495091`→`66d0ce9`** — `devtools-item-2976`
@`e4e6244` (R1 row 1: the `prepare_workspace` recurrence fix), `impl-item-2744` @`47dd2ae` (docs-only; the
landable RE-POINTED copy of the architect review with a `## D-<mint>` placeholder — the `@d1fde2d` tip with
the hardcoded D114 was correctly NEVER landed), `architect-item-2984` @`5c50f34`, `architect-item-3005`
(resolved as `<branch>-rebased` `328d838`, the add/add superset — see "If it fails"), `impl-item-2545`
@`1e96d53`, `impl-item-1966` @`9aa2053`. `lock {slots:4, held:4, waitedMs:3944/1415, reserved:true}` — it
waited for the slots with the broker UP; no stop was needed.
**Suite on `main` after the pass: `pass=178 fail=1`** (`node scripts/suite.mjs`, rc=1) — the single failure
is `demo/pitui.test.mjs` (#2412's resolution-path assertion). **The 5 `tui-durable-*` `./codemode` failures
that blocked `--suite` are GONE** (baseline on the previous pass was `pass=172 fail=5`), so `--suite` is
usable again except for `pitui`. **Mechanism (checked, not assumed):** all 8 `demo/tui-durable-*.test.mjs`
exit 0, and `node_modules/@earendil-works/pi-durable` now RESOLVES TO THE VENDORED PIN
(`-> vendor/pi-main/packages/durable`, `exports` includes `./codemode`), so the `ERR_PACKAGE_PATH_NOT_EXPORTED`
cause is absent. That resolution is exactly what the just-landed `devtools-item-2976` now enforces on every
`prepare_workspace` (`sync-pi --link` before/after `npm ci`) — so if these 5 reappear, the thing to check is
**that symlink**, not the demos. **Not landed, with reasons:**
`scribe-item-3035` (tip DRIFT: list pins `f450cdd`, tip is `f1f788f` — re-pin needed), `designer-item-2103`
(DRIFT `a3dff23` vs `e4fd338` + CONFLICT), `devtools-item-2587` (CLEAN+MATCH but its non-author verify
`#3104` is held *on* the landing — the gate is inverted, so it needs a ruling, not a pass),
`impl-item-3017` (CLEAN+MATCH but SUPERSEDED — F12 says M1 must not define `workable`), the M1 pair
`impl-item-3062`/`3056` (landing lists HELD, redesign slice in flight), and every CONFLICT branch
(`git merge-tree --write-tree main <branch>` exits 1 → author non-force rebase + re-verify).

2026-10-19 (pass #4, delegate, broker UP): **4 landed, `main` `abda45b`→`ee651e0`** — `impl-item-2420`
@`8770e4b` (bounded graceful broker stop; fresh non-author verify `#3171` **done**), `devtools-item-2638`
@`e991830` (D109 HARD pin), `impl-item-2797` @`2828ad4` (the 3-doc designer landing + README union) and
`devtools-item-2587` @`de9ac4d` (batched TUI `live` view). `lock {slots:4, held:4, waitedMs:18274,
reserved:true}` — it waited 18s for the slots with the broker UP.
**Prune: refs 95→88, worktrees 201→200, and 10 terminal trees relocated out-of-tree** (see
`branch-cleanup.md`). `main` unmoved by the prune; nothing forced.

### ⚠ THE SUITE CAN GO RED *AND BACK GREEN* WITH NO COMMIT — CHECK THE PIN BEFORE TRUSTING ANY VERDICT

Measured twice on 2026-10-19. After pass #3 the suite was `pass=178 fail=1`; 20 minutes later, with **no
relevant commit landed**, it was `pass=174 fail=5`, all five `demo/tui-durable-*.test.mjs` failing
`ERR_PACKAGE_PATH_NOT_EXPORTED: './codemode'` — then `pass=178 fail=1` again after one command.

**Cause:** `node_modules/@earendil-works/pi-durable` is a **symlink to `vendor/pi-main/packages/durable`**
(the pinned build, which exports `./codemode`). A plain `npm install`/`npm ci` **in the shared tree** replaces
that symlink with the registry build (`pi-durable@1.1.0`), which does not. The trigger both times was a seat
running an install while making a dependency change (#2969's exact-pin edit at 22:47Z; its `package.json` +
`package-lock.json` were dirty at the same timestamp).

**Diagnose it in one line — and do it BEFORE believing a suite verdict:**
```bash
ls -la node_modules/@earendil-works/ | grep -E 'pi-durable|pi-tui'   # '->' = pinned/link, 'd' = CLOBBERED
node -e "const p=require('./node_modules/@earendil-works/pi-durable/package.json');console.log(p.version, Boolean(p.exports['./codemode']))"
#   expected: 1.3.0 true        clobbered: 1.1.0 false
```
**Fix (one command, does not dirty the tree):** `node scripts/sync-pi.mjs --link`.

**Why this matters for a landing:** a red suite here is NOT a regression in the merged result, and reporting
it as one sends the team chasing a phantom. Equally, a GREEN run right after an install proves less than it
looks — it may be measuring the registry set, not the pinned build. `devtools-item-2976` (now on `main`) makes
`prepare_workspace` run `sync-pi --link` around `npm ci` in every WORKTREE, which is why a worktree is safe
and the **shared tree** is the exposed one.
