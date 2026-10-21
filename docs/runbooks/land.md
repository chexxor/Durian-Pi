---
runbook: land
symptom: "a verified branch is not on main (possibly stacked on an unlanded base - name it); land it without ever leaving the shared tree mid-merge"
writes: false
precondition: "none"          # no store/Harness precondition — the helper is git-only and WAITS for the genlock slots; the tracked tree must be clean (see Preconditions)
last_verified: 2026-10-19
verified_by: delegate
evidence: "node demo/land-helper.test.mjs; 2026-10-19 live landings with the broker UP (lock {slots:4,held:4,reserved:true}), main 4f9e7d6->7b6548e (suite 156 pass/1 fail — the pitui resolution-path failure, #2412) and a second pass 67228b9->3b79159 (17 branches, suite 175 pass/1 fail, inconsistent-tip and conflicting branches correctly SKIPPED); the --suite gate re-proved in a linked scratch at 3b79159 (demo/check.test.mjs exit 0, was exit 1 before impl-item-2679)"
check_rule: null
---

# Land a branch with the helper (`scripts/land.mjs`)

**Operating notes — the guard, measured (source: #4222; read before editing this runbook)**

**1. TEST VERBS SEPARATELY — a compound command's refusal names only the FIRST matching rule.** Measured: a
command containing both `git rebase main` and `git switch main` was refused naming only `switch`, so it said
nothing about rebase. CONSEQUENCE: any earlier measurement of this guard using compound commands is
UNRELIABLE. Run ONE VERB PER CALL — a guard tested with compound commands is a guard tested by rule order.

**2. The corrected throwaway justification — the hazard is the FORM, not the verb.** `src/confine.mjs:181-218`
denies reset, checkout, switch, restore, revert, clean, stash, `branch -D`, `add -A/.`, push and the `-C`
forms — THERE IS NO REBASE RULE. What moves HEAD is the TWO-POSITIONAL form (`git rebase <upstream> <branch>`)
and `--onto <new> <old> <branch>`, both of which CHECK `<branch>` OUT; the ONE-ARGUMENT form rebases the
current branch and leaves HEAD on it. So rebasing a DIFFERENT branch moves HEAD off your item branch — that is
the hazard — and the plain rebase of your own branch needs no throwaway.

**3. Do not write "rebase is allowed" flatly.** Write: "rebase YOUR OWN branch is allowed; rebasing ANOTHER
branch checks it out and moves HEAD off your item branch — the hazard the checkout denial exists to prevent."

`switch` needs no line — #3272's body already enumerates it inside the deny list quoted from `src/confine.mjs`
(the same list the guard's rule reads; two sources agree). #3272's OPERATING NOTES should gain a
cross-reference to this block when that item fires.

**Operating notes — landing completion + the dirty tree (read before closing a landing entry)**

**A landing entry may NOT close on `ok:true`.** The tool's success flag is not the assertion —
`scripts/land.mjs` has returned `ok:true, merged:[…]` WHILE MERGING INTO AN ITEM WORKTREE, leaving `main`
untouched and creating a store there. A landing entry's completion must carry:
- `git merge-base --is-ancestor <sha> main` → **exit 0**, and
- ideally the CONTENT check — `main` carries what the branch was for — because ancestry passes even when
a conflict dropped the block (for Fix A: `LANDING_MIN_WIDTH` read in the TERMINAL unit, not the old
`width−4` unit; the old unit IS the defect and the ancestry check cannot see it).
(The `repo`-field reading is RETIRED — `scripts/land.mjs` on main enforces `sharedRoot` itself (`f168339`),
so the guard refuses a non-root repo: the report's `repo` field is MOOT rather than wrong. WHEN A MECHANISM
REPLACES A DISCIPLINE, RETIRE THE DISCIPLINE EXPLICITLY — a precaution kept past its cause teaches the next
reader the tool is still untrustworthy, and then they do not trust the NEXT tool either.)
This is a rule for the seat that ACCEPTS the completion as much as the one that writes it — #3990 and
#4163 both closed while their branches were unlanded.

**A MERGE HAS TWO PARENTS; A DOCS COMMIT HAS ONE — the parent-count test settles whether a commit LANDED
anything.** `git log -1 --format=%p <sha>`: TWO PARENTS → a merge, so something was landed; ONE PARENT → not
a merge, so nothing was landed by it, whatever its subject says. A report said "the TUI landings landed as
`9e8710e`" when `9e8710e` has a SINGLE parent (`e6b8f33`) and its subject "docs(NEXT): three TUI branches
landed and proven" merely RECORDED the landings — the landings were three separate merges `a022635`,
`aabcacd`, `e79dd2f` (two parents each). This is the same defect as `ok:true` with the flag swapped: a
commit subject standing in for a fact. THE PAIR IS WHAT MAKES IT USEFUL: `--is-ancestor <branch-sha> main`
says the WORK is on main; `%p` on the commit you THINK landed it says whether that commit is the thing that
put it there. A SUBJECT IS A DESCRIPTION; A PARENT COUNT IS A STRUCTURE. GENERAL FORM: **WHEN A COMMIT
MESSAGE AND THE COMMIT'S STRUCTURE DISAGREE, THE STRUCTURE IS THE FACT** — the message is written by whoever
made the commit, at the moment they believed something; the parent list is what the object IS. It compounds
the stale-list problem rather than being separate: a list of outstanding landings was FOUR OF SIX stale, and
one of the four was marked landed by a commit that had landed nothing — both errors come from the same habit,
trusting a report about a landing instead of asking git what happened.

**When a landing reports success and `main` is unmoved: STOP AND REPORT. Never hand-restore the tree.**
The tree being dirty is a REPORTABLE STATE, not a problem to solve with a text tool. The cost of the
missing assertion was the chain that followed (04:21Z): `main` unmoved → a seat restored the shared tree
BY HAND → a PowerShell text round-trip → eight tracked files flattened to single lines → `src/chatview.mjs`
failed to import → `watch`, `queue` and `status` DOWN ~11 minutes. THE TOOL LYING IS WHAT CREATED THE
PRESSURE TO HAND-FIX, and the hand-fix is what broke the tree. Never `>` / `Get-Content` / `Set-Content` a
source file — use the `edit` tool or `cmd /c "git show <ref> > file"`; the encoding guard and detector
are routed separately and give this rule teeth.

**`git status --porcelain` IMMEDIATELY BEFORE the landing is BEST-EFFORT, not a guarantee — the LOCK is
the serialisation.** The status check is a RACE, not a guard: measured `dirt=1`, then clean SECONDS later
(the dirt was transient, written by another delegate mid-landing), with `main` moving twice underneath
(`c7b6d30 → 9682817 → da01550`) under fresh landings from another seat. "CHECK STATUS, THEN LAND" HAS A
WINDOW, and the window is however long it takes to type the landing command. **THE LOCK IS WHAT ACTUALLY
MAKES IT SAFE; THE STATUS CHECK ONLY AVOIDS THE WORST CASE** — measured `waitedMs: 301749, liveHolders: 4`
(five minutes waiting behind four live holders, another delegate landing concurrently): that IS the guard
working, and it is why a concurrent lander is not a catastrophe. The status check CANNOT catch a write that
lands between the check and the command; it catches the worst case — a tree left dirty for minutes by a
seat that abandoned work. An earlier measurement is still evidence about the past, not a precondition
(#4271 blocked by ten dirty files, #4163 the same, the 04:21Z flattening acted on a STALE picture; every
measurement was TRUE WHEN TAKEN and false by the time it mattered), so take it AT THE MOMENT OF USE — but
the lock, not the check, is what protects you. Same insight as the retired operator-confirmation gate
(#4431): a human confirmation and a status snapshot are both SNAPSHOTS, and A SNAPSHOT CANNOT SUBSTITUTE FOR
A SERIALISER — IT CAN ONLY AVOID THE OBVIOUS CASE.

**AND IF IT IS DIRTY: STOP AND REPORT.** Do not clean it, do not stash it, do not restore it — the dirty tree
may be a colleague's edit in flight, and this session has one incident that began with a seat deciding a
dirty tree was its problem to solve.

**WHY THE TEMPTATION IS STRONG HERE:** a landing takes minutes and the tree can change in seconds, so the
window between "I checked" and "I landed" is exactly where the failures live.

**DIRTY IS NOT THE SAME AS ABANDONED.** Two tracked files (`docs/SELFDEV.md`, `rig.selfdev.json`) went dirty
between two measurements and were clean again later — the resolution was NOT cleanup, it was that a
legitimate config edit COMPLETED. An `M` in `git status` can be a colleague's work in progress, in which
case the correct action is to WAIT rather than to dispose.

**The re-measure is the discipline that PAID — promote it; retire by CAUSE, not by age.** Every merge-tree
figure in every entry was stale (main moved `fe52a41 → 9e8710e → 7ffc7b9 → d8bc976 → 671b50a` across one
pass), and on one entry the central claim — "all three `--is-ancestor` exit 1 today" — was FALSE by the time
it was claimed: three landings that did not need doing. THE MEASUREMENT IS WHAT CAUGHT IT: **A STALE PREMISE
COSTS MORE THAN A MISREAD FLAG** — a misread flag produces a wrong report; a stale premise produces wrong
WORK. The `repo` field guarded against a TOOL THAT LIED, and that tool is FIXED; the re-measure guards
against a WORLD THAT MOVES, and it never stops moving. One cause could be removed; the other cannot.

**The landing LOCK serialises landings — there is no operator-confirmation gate.** The protection against
two delegates in one tree is the mechanical landing lock, not a human confirmation. Measured:
`{ slots: 4, held: 4, waitedMs: 160062, liveHolders: 3 }` — a landing WAITED 160 seconds for a slot behind
three live holders. Two delegates cannot merge into one tree simultaneously, because the tool will not let
them. So: (1) DO NOT hold a landing for an operator to confirm no other delegate is landing — that is an
ordering request, and lead's principle applies: DEPENDENCIES ARE ENFORCEABLE AND ORDERING REQUESTS ARE NOT.
The lock is enforceable; a confirmation is not. When a gate duplicates a mechanism, the mechanism wins and
the gate goes. (2) The precondition is the tree RE-MEASURED IMMEDIATELY BEFORE (see above). (3) REPORT THE
LOCK'S WAIT AND HOLDERS IN THE LANDING REPORT — a 160-second wait behind three holders is a fact about the
rig's throughput nobody had, and it explains "interrupted" tool calls: they were likely waiting for a slot,
not crashing. A SEAT THAT THINKS ITS TOOL CRASHED RETRIES; A SEAT THAT KNOWS IT QUEUED WAITS. (4) IF THE
LOCK IS UNAVAILABLE OR UNREADABLE, THAT IS WHEN TO STOP AND ASK — a missing serialiser is the actual hazard
the confirmation gate was standing in for.

**And the disclosure habit: report a judgement call WITH its reversal.** When a seat acts on the lock and
without the un-obtainable confirmation, it says so: "IF THAT WAS THE WRONG CALL, THE CORRECTIVE IS ONE
`git revert` OF `d8bc976` AND I WOULD RATHER SAY WHAT I DID THAN HAVE IT INFERRED." A seat that reports a
judgement call with its reversal is not bypassing a gate — it is telling you the gate's cost.

**CONDITIONAL, NOT A STEP: KEEP ALL SECTIONS in `demo/land-helper.test.mjs` WHEN #4011 AND #4142 BOTH
LAND.** The "KEEP ALL SECTIONS" instruction was prepared and NOT needed — #4311 landed against a main where
neither `5d9140f` nor `51a866b` had landed first, so `merge-tree` returned zero conflicts and the file had
no markers in it. It fires only when #4011 AND #4142 both land: then that file WILL conflict and ALL SECTIONS
MUST BE KEPT, because section 2d (the linked-worktree / shared-root refusal, #4247) sits beside 2b/2c and
the fixture sections and they assert different things. A resolution recorded as a step gets applied where it
is not needed; recorded as a condition, it fires when it should.

**A STALE BRANCH CAN RE-INTRODUCE A CLEANUP.** When a landing is refused for a fault the author did not
create, check whether the file is CLEAN on `main` and DIRTY on the branch — that is not a pre-existing wart
being carried forward, it is a REGRESSION being applied backwards. Measured: `land.mjs impl-item-4286` was
REFUSED — "1 file(s) fail TEXT INTEGRITY — docs/runbooks/README.md", fault `bom`. THE BOM WAS ON THE BRANCH
AND NOT ON MAIN: main's README had already been cleaned by an earlier landing (`6b2c213` stripped it); the
refused branch descended from the PRE-STRIP version. THE LANDING WOULD HAVE RE-INTRODUCED A BOM MAIN HAD
ALREADY BEEN CLEANED OF — the gate caught a regression, not a pre-existing wart. A BRANCH IS MEASURED
AGAINST CURRENT MAIN, NOT AGAINST THE MAIN IT WAS CUT FROM, and a cleanup since its fork is a change it can
silently undo. THE REMEDY IS A FORK THAT STRIPS THE BYTES (as `impl-item-4561` did: content otherwise
byte-identical, landed as `a1bb95d`), NEVER a resolution that takes the branch's version.

**A REFUSAL IS A QUESTION ABOUT THE WHOLE BRANCH, NOT JUST THE NAMED FILE.** The fix pattern for any gate
refusal is to FORK rather than resolve: a new branch from the old one with exactly the offending bytes
removed and nothing else touched, then scan the OTHER changed files to confirm none carries the same fault
(impl-item-4561 checked the other four). Checking the siblings is what makes the fork safe rather than
lucky. AND the gate's case is now closed by evidence rather than argument: the text-integrity gate has
caught (1) a first-offence BOM in a tracked file and (2) a REGRESSION re-introducing a cleaned BOM — both
the author's own work, both would have reached main without it, neither visible in any demo. A CHECK THAT
HAS REFUSED ITS OWN AUTHOR TWICE IS A CHECK NOBODY CAN CALL THEATRE.

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

## Stacked (unlanded) base — every entry NAMES its base

A **stacked entry** is a branch whose **base is unlanded** — it builds on work that is verified but not
yet on `main`, so it cannot be merged onto `main` on its own. Stacking is inherent to a landing
backlog: branches queue while new work builds on them.

**Rule:** EVERY stacked landing entry **names its base** and **states how that base becomes reachable**
— the exact branch/commit (`git -C <repo> log --oneline -1 <base>`) and the mechanism that lands it
first: an earlier entry in this same pass (list it), a named already-verified branch, or the
**base-ref capability (#1456)** once it lands. A stacked entry is never offered to the helper as if it
were based on `main`.

Why it matters (2026-10-17): until #1456 lands, a seat CANNOT be provisioned at an unlanded tip —
`prepare_workspace` and the `worktree` verb never pass `ref` — so an unlanded base is both an ordering
constraint for the pass and a provisioning blocker for new work (impl's #1444/#1454). See
`SEAT-LIFECYCLE.md` §3 "Stacked (unlanded) base".

**Durable fix:** the base-ref capability (**#1456**, PRIORITY per the operator) makes stacking *work* by
letting a worktree be created at an unlanded tip. `pause` (ROADMAP 131) and smaller, more frequent
landings reduce how often it arises, but only #1456 removes the blocker.
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
   **`merge-tree` proves textual cleanliness, NOT currency.** If the branch adds or changes a test over a
   GROWING set (a manifest, a count, an enumerated list), run that branch's own new/changed demo against
   the CURRENT `main` before landing — 2026-10-20: `devtools-item-1558` was merge-tree CLEAN but its new
   `demo/test-areas.test.mjs` failed on `main` because 57 newer demos were not in its committed manifest
   (incident `2026-10-20-stale-derived-manifest-landing.md`). A derived artifact must be regenerated at
   land time, not trusted from the branch's fork point.
   **AND THE CHECK ITSELF MUST RUN ON THE MERGED TREE, not on the branch tip** — the other half of the same
   rule, and the one that makes a careful verify look wrong. 2026-10-20, `devtools-item-3341` @`92f8a7a`:
   verified **PASS** on the branch (its own `demo/` set is fully mapped, and the verifier proved the rule can
   FIRE by planting an unmapped demo and getting exit 1), and it **FAILED** the same sha merged into a
   scratch at current `main`. **Both verdicts were correct — they measured different trees.** Measured
   directly: the branch carries 183 demos and a manifest generated against exactly those 183; `main` carries
   188 (the branch also ADDS `demo/test-areas.json`, so `main` has no manifest to check against); the merge
   yields 189 files against a 183-row manifest, leaving **six unmapped** — `landing-data`, `next-pointer`,
   `tui-conversation-header`, `tui-landing`, `tui-status-bar`, `workable-claim`. So a green generated-artifact
   check on the branch is **not evidence about the merge**, however carefully it was run: the branch is
   internally consistent AND stale relative to `main` at the same moment, because the merge CHANGES the
   source set the artifact was derived from.
   Practical form for a landing entry: merge into a scratch worktree at current `main`, then run the
   generator's check THERE. And do not blame the verify — a verifier who ran it on the branch followed the
   rule as written; the rule was under-specified about WHICH TREE, which is why this line exists.
   To count it yourself on any candidate: `git ls-tree -r --name-only <ref> -- demo | grep '\.test\.mjs$'`
   for both refs, and compare against the manifest rows the branch would land.
3. Land the clean set in ONE call: `node scripts/land.mjs <b1> <b2> ... --db ./selfdev.sqlite`.
   Read the JSON report; `lock.reserved:true` / `lock.waitedMs` show it waited for the slots.
4. **The `--suite` gate works again (FIXED 2026-10-19, `impl-item-2679` on `main`).** The defect was:
   `--suite` runs each demo in the helper's **detached** scratch worktree, and the `shared-tree-on-main`
   check rule (`50f981a`) flagged a detached HEAD — so `demo/check.test.mjs` failed there and the helper
   refused with `STOPPED: demo/check.test.mjs failed`. The rule now **skips a LINKED worktree**
   (`isLinkedWorktree`: per-worktree git dir vs the common git dir) while still firing on the **shared**
   tree off `main`, so a landing scratch no longer trips it. **Prefer `--suite`** — it proves the merged
   result before it becomes `main`. **But `--suite` is a FIRST-FAILURE loop:** it stops at the first
   non-zero demo, so while `pitui` (#2412) is known-red it never reaches the tests that sort after it
   (2026-10-20: it stopped at 89 demos and never ran `test-areas`, which was the real new failure). When
   `--suite` cannot be used, land WITHOUT it and run the FULL `node scripts/suite.mjs` on `main` — that is
   the complete check, not a spot check:
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
   node scripts/suite.mjs --jobs 8   # same verdict; 8 demos in parallel (~60s vs ~10min)
   ```
   The pool is safe because every demo is a separate process and the runner gives each one a
   private `TMP`/`TEMP`/`TMPDIR`; a demo that only passes when run alone is NOT hermetic and its
   failure under the pool is a real defect to fix in that demo, not in the runner. `--jobs` accepts
   1..32 (or `DURIG_SUITE_JOBS`); the default is 8. At 16 a loaded box can hit the resource-abort
   class (`0xC0000409`), which the runner still reports as ENVIRONMENTAL rather than green.
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

   **THIS FALLBACK HAS AN EXPIRY, AND IT IS NOT "WHEN `main` IS GREEN".** "Green" is unreachable (the
   real content defects had no owner) and ambiguous (`pitui` is arguably CORRECT to fail against the
   vendored junction). Delete this fallback when `main`'s red set is **EMPTY IN THE SEAT-ROOT DEPENDENCY
   ENVIRONMENT** — i.e. the real content defects are fixed, and `pitui` is either fixed or the vendored
   link is DECLARED INTENDED by whoever owns that call. An unreachable expiry is a workaround that never
   expires: the next lander reads "remove when green", sees red forever, and concludes the fallback IS the
   permanent procedure — which is the habit the condition exists to prevent.
   **Every `--suite`-less proof must STATE THE DEPENDENCY SET IT RAN IN.** A proof from a worktree-local
   `npm ci` and a proof from the seat root are not comparable, and the output does not distinguish them
   (see the fresh-worktree note below). **And do NOT read "red on N" as environmental:** at the time of
   writing the same commit reported 3 red in the seat root and 7 after a worktree-local `npm ci` — two of
   those were REAL content defects, one was an environment guard and five were dependency-version
   artefacts. A landing pass that treats the delta as noise will treat the real ones as noise too.
#### ⚠ WHEN `main` IS ALREADY RED: land WITHOUT `--suite`, then prove on `main` — AND DELETE THIS SECTION WHEN IT CLEARS

**The workaround, while `main` carries known-red demos:** land with `node scripts/land.mjs <b1> … --db
./selfdev.sqlite` and **no `--suite`**, then prove the result on `main` in a clean DETACHED worktree.

**Why:** `--suite` exists to prove the MERGED result *before* `main` moves. When `main` is already
failing, that proof cannot distinguish the landing's own breakage from the pre-existing redness — it
stops on the first red demo and tells you nothing about your branch. A first-failure loop over an
already-red tree is not a weaker check, it is a misleading one.

**THE EXPIRY IS A CONDITION, NOT A DATE — delete this whole section when:**
```bash
git worktree add --detach "$PWD/.main-check" main
( cd .main-check && node scripts/suite.mjs --jobs 8 ); echo "exit=$?"
git worktree remove --force "$PWD/.main-check"; git worktree prune
#   delete this section when that reports exit=0 (pass=all, fail=0)
#   — except for a known, separately-registered red such as pitui (#2412), which is exempt by name
#   The verdict depends on TWO things, so name BOTH (see "NAME THE TREE" below):
#     the TREE — main's content. The shared tree carries seats' in-flight work and is not main.
#     the DEPENDENCY SET — a worktree-local `npm ci` resolves the LOCKFILE, and the five
#       `tui-durable-*` demos then fail as an INSTALL ARTEFACT that is not part of main's red set (#3766).
#   delete this section when main's red set is EMPTY in the SEAT-ROOT dependency environment:
#     exit=0 (pass=all, fail=0), OR every remaining red is an artefact you have ATTRIBUTED above,
#     OR it is `pitui` with the vendored-link failure DECLARED INTENDED by whoever owns that call.
#     `pitui` is not exempt by name alone: an unrecorded exemption is how an expiry becomes permanent.
```
A date rots; this can be checked. **A workaround that outlives its cause becomes a habit**, and the next
lander cannot tell whether the two-step is required or merely traditional — which is how a temporary
measure becomes permanent.

**DO NOT RECORD THE CURRENT FAILURE LIST AS IF IT WERE DURABLE.** On 2026-10-20 the delegate measured 7
red at `main` @`557ceb3` (broker-one-connection, landing-data, pitui, seat-instruction-encoding,
tui-conversation-header, tui-landing, tui-status-bar); a few hours later, in a fresh worktree, four of
those PASSED because their `src` had landed and a different five (`tui-durable-*`) failed for an
unrelated dependency reason. The list has a shelf life of hours. **Re-measure before you plan around
it** — the workaround is durable, the list is not.

**AND NAME THE TREE WHEN YOU ANSWER "is `main` green?"** A suite run in the SHARED tree measures
something else entirely: the shared tree carries seats' in-flight work (100+ dirty paths is normal),
so it is neither `main` nor a candidate. A clean detached worktree is the only tree that answers the
question. State which tree a verdict came from, or the verdict is not usable by anyone else — the same
rule as the generated-artifact check above.

5. Prune each landed ref (`git branch -d` refuses anything unmerged, so this is lossless):   ```bash
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
git -C <repo> status --porcelain                 # MUST be EMPTY — tracked AND untracked block (#3988)
git -C <repo> merge-base --is-ancestor <branch> main && echo ALREADY-LANDED
git -C <repo> rev-list --count main..<branch>    # 0 once landed
```
**AND PORCELAIN IS NOT THE WHOLE PRE-FLIGHT — CHECK THE STRAY WORKTREES TOO.** The stray check reads the
repo root's DIRECTORY LIST and compares it to `git worktree list`, so it fires on directories `git status`
NEVER MENTIONS: `/item-*/` is in `.gitignore`, so a stray `item-<id>/` leaves porcelain EMPTY and still
blocks. Measured 2026-10-20 at main 910fac7: porcelain **0 lines** and the landing **REFUSED for 10 stray
`item-*/` directories**. A lander who checks porcelain alone will report a clean branch as landable and be
wrong every time:
```bash
git -C <repo> worktree list --porcelain | grep '^worktree '   # the REGISTERED set
ls -d <repo>/item-* 2>/dev/null                               # any name NOT in that set is STRAY
The helper's pre-flight, in code (the enforcement chokepoint):
- **Tracked AND untracked modifications block (#3988).** The rule was tracked-only until an UNTRACKED
  `src/tui/durable/attach.mjs` written by a live seat would have passed it — a check that looks for the
  dirt it expects misses the dirt that happens. A suite run in `.` measures the SHARED TREE, not main, so
  a non-empty `git status --porcelain` refuses and the refusal NAMES every dirty path.
- **STRAY WORKTREE DIRECTORIES at the repo root block (#4139).** A write to a REAPED worktree path
  recreates `item-<id>/` inside the repo; `/item-*/` is ignored, so porcelain never shows it. The test is
  REGISTRATION, not the name: a root child matching `item-<n>`/`verify*`/`.verify-*`/`wt-*`/
  `.durig-test-wt-*`/`.land-scratch-*` that is NOT in `git worktree list --porcelain` is STRAY. A LIVE
  worktree is legitimately `item-<id>/` at the root and must NOT be flagged. **REMEMBER: this one is NOT
  porcelain, so an empty `git status` does not clear it.**
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
   git -C <repo> status --porcelain        # must be EMPTY (tracked AND untracked, #3988)
   git -C <repo> worktree list --porcelain # and NO stray item-*/ dir outside this list (#4139)
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

### What a check or a DEFAULT can and cannot tell you — the unknown-default principle

Three primitives in this codebase answer "what if we do not know?" **differently, and all three are
right.** The instinct to make them agree is the wrong one in every direction, so the rule is written
here with the cost that decides each case:

| Primitive | Unknown resolves to | Why — what a FALSE answer costs |
|---|---|---|
| liveness (`brokerAlive` / `pidAlive`, `impl-item-3398`) | **ALIVE** | a false DEAD admits a **SECOND WRITER**, which is the store-corruption class |
| `workable` (#2673) | **WORKABLE** | a false unworkable **STARVES WORK INVISIBLY**; a false workable only hands a seat an item it can hold or defer |
| `listWorktrees` (#3605) | **THROW**, for a deciding caller | a false EMPTY authorises an **IRREVERSIBLE DELETE** |

**The rule: the default follows the COST of being wrong, not a house style.** "Be consistent with the
other one" gives the wrong answer in two of these three cases, and it is the instinct a reviewer will
have — three different answers to one question look like an inconsistency rather than three considered
choices. State the cost per primitive and the direction becomes checkable instead of conventional.

**Same shape for a probe: record WHAT IT PROVES, not only its result.** A hazard record that said "port
8080 closed" silently became an all-clear when the port opened for an unrelated listener (`#3736` — the
decisive question was whether the listener serves the model the rig names, and a port probe can never
answer it). A `--suite` run on the branch tip proves nothing about the merge (`#3638`). A satisfied
`blockedBy` proves nothing about whether the content landed (`#3681`). When a check's meaning is not
written beside its result, a changed result reads as a cleared hazard.

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

## Closing the entry: LANDED vs ROUTED (say which)

A landing entry's `complete_work` marks the ENTRY processed — it does NOT mean the artifact arrived.
`done` is one word for two different facts, so the `resultSummary` must say which one happened:

- **`LANDED at <sha>`** — the sha is on `main`. Verify before you write it:
  `git merge-base --is-ancestor <sha> main` (exit 0).
- **`ROUTED to <seat> as <id>, NOT YET LANDED`** — you preflighted and handed the landing to another
  seat (the delegate lands; the author does not self-land), so the artifact is still absent from `main`.

**WHY IT MATTERS.** A seat holding a gate on this entry reads `done` as "the fix is on `main`" and may
build against it. `#4022` is the live instance: worked correctly and ROUTED to `impl` as `#4068`, yet
`done` read as landed while `5e4dd4d` was not an ancestor of `main` and the lock still resolved `1.1.0`.
The status field can only say one thing; the result text is where the distinction has to live. When you
are the LANDER (not the router), the same rule applies from the other side: complete the entry only
after the merge, with `LANDED at <sha>` naming the new `main` tip.

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
- **A branch's own NEW guard fails on `main` after landing** (e.g. a committed manifest that enumerates a
  growing set): `git revert -m 1 <merge>` (do NOT fix forward on `main` — the artifact is the author's),
  KEEP the branch ref because its content is now reverted rather than live, and route the rework to the
  author via `pm` to regenerate the artifact against current `main`. 2026-10-20: `devtools-item-1558` →
  revert `0976cc4`, rework `#3238`, ref kept at `17cd7a2`.
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
`prepare_workspace` run `sync-pi --link` around `npm ci` in every WORKTREE — **but that does NOT make a fresh
worktree safe** (measured 2026-10-20, see the next note): `vendor/pi-main` is not present in a fresh worktree,
so the link fails with `nothing built yet; run --sync before --link` and `prepare_workspace` only
`console.warn`s and continues. The worktree then sits on the lock's `pi-durable@1.1.0`, so BOTH the shared
tree and a fresh worktree are exposed, for different reasons.

### ⚠ A FRESH WORKTREE'S SUITE IS NOT MAIN'S SUITE — `npm ci` measures the LOCK, not `main`

Measured 2026-10-20 on the same commit (`main` `11e87a0`), 188 demos:

| Tree / dependency state | Red |
|---|---|
| seat root, `pi-durable@1.3.0` (the vendored link) | **3** — `broker-one-connection`, `pitui`, `seat-instruction-encoding` |
| fresh item worktree after `prepare_workspace`'s `npm ci` | **7** — `broker-one-connection`, `seat-instruction-encoding`, and the five `tui-durable-*` (`boot`, `-compaction`, `-compaction-tui`, `-persistence`, `-tools`) |
| detached worktree at `main` with the seat root's deps | **3** — identical to the seat root |

**The two sets are NOT nested — read the names, not the counts.** `pitui` is red in the seat root and GREEN in
a fresh worktree: it asserts that `pi-tui` does NOT resolve into `vendor/pi-main/packages/tui`, which is true
there precisely because the link is missing. So 3 + 5 ≠ 7, and a verifier who assumes "main's set plus
extras" will hunt for `pitui` in the wrong list.

**So `main`'s real baseline is 3 red.** The five `tui-durable-*` are an INSTALL ARTEFACT: `package-lock.json`
pins `@earendil-works/pi-durable` `1.1.0`, whose `exports` map has no `./codemode`, while
`src/tui/durable/adapter.mjs` imports it — hence `ERR_PACKAGE_PATH_NOT_EXPORTED`. The pinned link that fixes
this cannot be recreated in a fresh worktree, because `vendor/pi-main` is not there (see the note above).

**What a verifier must do about it:**
- Do NOT discount them silently. NAME them as the artefact, state that `main`'s baseline is 3 red, and say
  which tree and dependency state your run measured — otherwise the next reader cannot tell "known artefact"
  from "I decided this was fine".
- The reverse direction is just as real: an AUTHOR in the shared tree sees GREEN where the verifier sees RED,
  so "it passes for me" is not evidence about the verifier's tree.
- Check the pin before believing either verdict (the one-line command is in the note above).

The fix — bump the lock so `npm ci` reproduces the pinned set, plus a demo asserting the export map — is its
own held item (`#3712`) and needs a landing slot. Until it lands, every verifier pays this.

**The general form: a suite verdict must NAME THE TREE AND ITS DEPENDENCY STATE.** "The suite passes" is not
a claim until it says where — the shared tree measures seats' in-flight work, a fresh worktree measures the
lock rather than `main`, and a branch-tip run measures neither the merge nor `main` (`#3638`).

2026-10-20 (pass #5, delegate, broker UP): **2 landed, 1 landed-then-reverted, 1 stopped by its own
test, `main` `9882632`→`4d96ae9`.** `scribe-item-3167` @`b0e9d75` (D113/D114) → `35f8ae6`;
`impl-item-3062` @`eb3b337` (M1a) → `a55535e`. `devtools-item-1558` @`17cd7a2` landed (`abb9c54`) and
was **REVERTED** (`0976cc4`) — its own `test-areas` guard failed on the current demo set; rework `#3238`,
ref kept. `devtools-item-2412` @`7933858` was **STOPPED by `command-spool`** in the scratch: `main` now
carries the operator-only control-plane gate (#1966/#2219 D113) and this branch predates it; rework
`#3239`. `--suite` was unusable (stopped at `pitui` after 89 demos), so the three were landed without it
and proved with the full suite on `main` — the only way this pass could see the `test-areas` failure.
**Suite on `main` after the revert: `pass=179 fail=1`** (`pitui`, #2412). Prune: refs 97→93, worktrees
203, `reapable: 0`, nothing forced (see `branch-cleanup.md`). The suite runner is now pooled — default 8
demos at once, ~64s vs ~10min — so the post-landing proof is cheap enough to always run.

2026-10-20 — **THE UNKNOWN-DEFAULT PRINCIPLE ADDED** (item #3744, part of the #3272 landing-note
series): the liveness / `workable` / `listWorktrees` defaults, the cost rule that decides each direction,
and the probe-meaning line, in a subsection of `## Verify` so the #3638 (check the MERGED tree) and
#3656 (the no-`--suite` workaround with a checkable expiry) additions can sit beside it. The runbook's
own Verify step was re-run with this change: `node demo/land-helper.test.mjs` → exit 0.

2026-10-20 — **THE FRESH-WORKTREE SUITE NOTE ADDED, and it CORRECTS the earlier claim above** (item #3766,
same #3272 series). Measured on one commit, `main` `11e87a0`: seat root 3 red, fresh item worktree 7 red
(the same 3 plus the five `tui-durable-*`), detached worktree at `main` with the seat root's deps 3 red.
Root cause of the difference, checked rather than assumed: `prepare_workspace` DOES run `sync-pi --link`
around `npm ci` (`src/worktree.mjs` lines 155-188), but in a fresh worktree that command fails with
`{"ok": false, "error": "nothing built yet; run --sync before --link"}` because `vendor/pi-main` is not
present there, and the caller only `console.warn`s and continues — so the worktree stays on the lock's
`pi-durable@1.1.0`. The suite was re-run in this worktree with that state and returned exactly the 7 red
named in the new note; `node demo/land-helper.test.mjs` → exit 0.

2026-10-20 — **THE `--suite`-LESS FALLBACK NOW HAS A REACHABLE EXPIRY** (item #3775, same #3272
series): "remove when `main` is green" was unreachable (the real defects had no owner) and ambiguous
(`pitui` is arguably correct to fail against the vendored junction), so it is restated as "red set EMPTY
in the SEAT-ROOT dependency environment", with the requirement that every `--suite`-less proof STATE the
dependency set it ran in. The runbook's own Verify step was re-run: `node demo/land-helper.test.mjs` →
exit 0.
2026-10-20 (pass #6, delegate, broker UP): **5 landed, 1 landed-then-reverted, `main` `351b03a`→`13e60bc`
(+ revert `cc96c0c`).** Kept: `designer-item-3307` @`24b7fc9` (the landing-screen spec #3313/#3359 build
against), `advocate-item-2985` @`7387716` (closes the proposal v2's dangling §12 reference),
`impl-item-2616` @`e8ce2a0` (FEATURES rows), `impl-item-2578` @`2bb0427` (cli.mjs comment re-anchor + the
new `demo/broker-one-connection.test.mjs`). Refs pruned 4 (126 remain).
**REVERTED: `auditor-item-2154` @`fac647c` (merge `a65feee` → revert `cc96c0c`).** The branch renames
`durig`→`durian-pi` and `DURIG_ALLOW_PUSH`→`DURIAN_PI_ALLOW_PUSH` in `constitution.txt` **without
regenerating the `rig.starter.json` `constitutionInline` mirror** (#976). The drift guard fires in
**three** demos — `starter`, `commit-model`, `seat-commit-instructions` — so a single red demo is not the
whole finding. **Rule (now general): a branch touching `constitution.txt` MUST carry the regenerated
`rig.starter.json` in the SAME commit, and its landing entry's preflight must run `demo/starter.test.mjs`,
because `merge-tree` is structurally blind to a derived-mirror invariant.** This is the same trap recorded
for the #2841 scribe rebase set; the ref is kept at `fac647c` (content reverted, not live), rework is with
`auditor` at #3428.
**Suite after the revert: `pass=180 environmental=0 fail=1`** (`pitui`, #2412) — verified with
`node scripts/suite.mjs` unpiped so the exit code is real (baseline `pass=179 fail=1`; the +1 is the new
`broker-one-connection` demo). Pin checked BEFORE the verdict:
`node_modules/@earendil-works/pi-durable -> vendor/pi-main/packages/durable` (intact).
**Not landed, with reasons:** `architect-item-2730-rebased` (entry #3377 gated on the #3343 mint order),
`devtools-item-2969` (dep-file change needing an `npm ci` lockfile preflight; its verify #3205 is held ON
the landing — inverted gate), `impl-item-3056` (M1b HELD by ruling #3112), `devtools-item-2188` (#3256
cleared-to-land was superseded by #3260's rebase pass — ownership ambiguous), and the CONFLICT set
(`impl-item-3017`, `impl-item-3192`, `impl-item-2483`, `architect-item-2730`, `devtools-item-2073`,
`scribe-item-2143`).
