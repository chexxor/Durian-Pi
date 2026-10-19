# Branch and worktree lifecycle — landing, pruning, and what is authoritative

**Topic doc.** Maintainers of the durian-pi rig read this before a landing or pruning pass. It is the
single map of *which* refs and worktrees exist, *how* each is created and retired, and — the part that
costs the most time — **where the authoritative answer lives** for every question the pass asks.

Sibling docs: `SEAT-LIFECYCLE.md` (a seat's life), `BROKER-ARCHITECTURE.md` (the writer), and the
procedures in `docs/runbooks/` (`land`, `branch-cleanup`, `leaked-worktrees`). This doc is the *model*;
the runbooks are the *steps*. It exists because the steps alone repeatedly sent a maintainer to three
places to answer one question.

| | |
|---|---|
| `last_verified` | 2026-10-19 |
| `verified_by` | delegate |
| `evidence` | a full land+prune pass: `main` `67228b9`→`3b79159` (17 branches), refs 111→83, worktrees 206→204, nothing forced; suite `pass=175 fail=1` (pitui) |

## How to re-verify this document (run these; they are the periodic check)

Every factual claim below has a command. A verification pass runs this block and compares the results
with the tables. If a command's output contradicts a claim, the **claim** is wrong — fix the doc, do not
"fix" the rig.

```bash
# 1. the pair in use — the store and the rig MUST match (see §1)
ls -1 *.sqlite *.json | grep -E 'sqlite$|^rig.*json$'
git -C . rev-parse --short HEAD

# 2. ref/worktree census (§3)
git branch | wc -l
git worktree list | wc -l

# 3. classification agreement: merged-but-free should be EMPTY after a prune (§4)
git branch --merged main | sed -E 's/^[*+ ]+//' | grep -v '^main$' | sort -u > /tmp/m.txt
git worktree list --porcelain | awk '/^branch /{sub("refs/heads/","",$2); print $2}' | sort -u > /tmp/h.txt
comm -23 /tmp/m.txt /tmp/h.txt          # expect empty

# 4. the lock flag, read the TERSE way only (§4.2)
git worktree list | grep -c ' locked$'

# 5. the merge gate the helper uses (§5)
git merge-tree --write-tree main <branch> >/dev/null; echo "0=clean 1=conflict → $?"

# 6. suite verdict — capture the code, never pipe it (§6.1)
node scripts/suite.mjs > /tmp/suite.out 2>&1; echo "exit=$?"; tail -2 /tmp/suite.out

# 7. the runbook-verification rules this doc depends on (§7) — currently all `skipped`
DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json \
  | grep -E 'runbook-(stale|unverified|front-matter)'
```

## 1. The pair: one store, one rig, named explicitly

The rig drives **one store**. The pair for this workspace is `selfdev.sqlite` + `rig.selfdev.json`. The
repo also contains `rig.json`, and **`cli.mjs check` defaults to `rig.json`**, not to the rig in use.

That default silently mismatches the store with the wrong rig and invents findings. Measured
2026-10-19: `check` with the default reported 5 seat-shape failures (`store-missing-seat`, `stray-seat`,
`no-verifier-seat`, `single-model-rig`, `seat-without-capabilities`) that describe **`rig.json` vs
`selfdev.sqlite`** — a pairing nobody runs. With `rig.selfdev.json` the same store reported 2 findings.

**Rule: always pass the rig explicitly.** `DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json`.
A `check` verdict without an explicit rig is not evidence about this rig.

## 2. The artifacts and who owns teardown

| Artifact | Created by | Retired by | Owner |
|---|---|---|---|
| item worktree `item-<id>` | `prepare_workspace` (on branch `<seat>-item-<id>`, #859) | `complete_work` teardown, the broker sweep, or a maintainer's prune | durian-pi |
| item branch `<seat>-item-<id>` | same | `git branch -d` **only when merged** | durian-pi |
| verify scratch `.verify-*`/`verify*`/`wt-*` | a verifier | `worktree scratch clean` | durian-pi |
| seat root (a seat's `cwd`) | `up --refresh` | never by a prune — it is IN USE | the rig |
| shared tree | the repo | never | the operator |

Provenance decides ownership: durian-pi reaps only what durian-pi created (`leaked-worktrees.md`,
rules 1–3). A worktree that is any seat's persisted `pi.agent.cwd` classifies as `seat-root` and is
never reaped, whatever its item's status.

**Standing condition to expect:** every seat root may equal the **shared tree** (`seat-root: 1`). The
`worktree audit` output therefore shows one seat-root and does not tell you which seat is where — read
`audit.seatRoots` for the per-seat list. This is the F12 fallback, not a bug in the prune.

## 3. Lifecycle in one line per stage

1. **Create** — seat path is a clean HEAD checkout (`carry: false`, #2360). A *dirty* worktree is
   therefore either CARRY residue from before that fix, or the seat's own uncommitted work. You cannot
   tell which from status alone; `git log <branch> -1` plus the item's status is the best helper, and
   "keep" is the safe answer when unsure.
2. **Land** — merged onto `main` by `scripts/land.mjs`, never by hand in the shared tree (§5).
3. **Prune** — the ref is deletable **only** when `git merge-base --is-ancestor <branch> main`. The
   worktree is released first; a dirty worktree is relocated, never forced (§4.3).

## 4. Classification: the recipes and their traps

### 4.1 merged / held / unlanded
`merged` = `git branch --merged main`; `held` = checked out by some worktree; `unlanded` = `ahead>0`.
The `sed -E 's/^[*+ ]+//'` is mandatory — `git branch` prefixes the current ref with `*` and a
worktree-held ref with `+`, and a stray `+` corrupts every downstream `main..$b` loop.

### 4.2 Lock state — read the TERSE output only
`git worktree list --porcelain` emits `locked` as its own line **after** the `branch` line, so a naive
"the next worktree's key" association attributes it to the following tree. Measured 2026-10-19: that
parse reported **all 22** merged worktrees as LOCKED, including unlocked ones. The terse form annotates
unambiguously — `<path> <sha> [<branch>] locked`:

```bash
git worktree list | grep ' locked$'          # the locked set
git worktree list | grep -E "\[$b\]( locked)?$"   # one branch's line + its lock flag
```
A **locked** worktree whose item is live is an intentional keep. A locked worktree whose item is
**terminal** is a teardown that did not run — informative, but still not a licence to force it.

### 4.3 Three prune paths, and when each applies
| Worktree state | Path | Lossless? |
|---|---|---|
| clean + unlocked + terminal | `git worktree remove` → `git branch -d` | yes (nothing to lose) |
| clean + **locked** + terminal | `unlock` → `remove` → `-d` | yes |
| **dirty** + merged + unlocked | **relocate** out-of-tree → `switch --detach` → `-d` | yes — every file preserved |
| dirty + **unlanded** | **nothing** — the ref holds the only copy | not applicable |
| locked + live item | nothing | not applicable |

Relocate is the *common* path, not the exception: most merged item worktrees carry CARRY residue, so the
clean-only removal guard refuses them and `worktree audit` reports `reapable: 0`. Copyable loop and the
archive location (`../pi-opendurig.worktrees/`) are in `leaked-worktrees.md`.

### 4.4 Classification is POINT-IN-TIME — re-run it mid-pass
Refs and worktree registrations change while you work: the rig creates refs live, and **landing a branch
can make an unrelated ref merged**. Measured 2026-10-19: `auditor-item-2757` was recorded `ahead=4` at
Diagnose and became an ancestor of `main` when `impl-item-1705` (same tip `349d5d3`) landed — so a ref
that was unprunable at the start of the pass was safely `-d`'d at the end of the same pass.

Never delete from a remembered count. The gate is always the live question:
`git merge-base --is-ancestor <branch> main && git branch -d <branch>`.

## 5. Landing: three gates, and only one of them is in git

A branch is landable only when **all three** hold. They live in three different places, which is why
landing passes stall:

| Gate | Authoritative source | Command |
|---|---|---|
| **Verified** (non-author ack of *this* tip) | the queue: the VERIFY item's `status == done`, and the landing-list item's `@<sha>` | `node cli.mjs queue` → item status |
| **Tip matches the landing list** | the landing-list item's subject/body `@<sha>` vs the branch tip | `git rev-parse <branch>` |
| **Clean against the CURRENT `main`** | git | `git merge-tree --write-tree main <branch>` |

Landing list items are **free text** written by `pm`, in a queue whose entries are 10 MB of prose. They
are the only record that a branch was verified, but they are not machine-checked, and their `GATED on
#NNNN` clauses must be resolved by looking up each cited item's status. Treat them as evidence to be
checked, never as a verdict.

Traps, all measured:
- **Tip drift** — a branch may move after its verify (`devtools-item-2261` in the 2026-10-19 pass). The
  verify no longer covers the new tip. Do not land it.
- **Serial, not batch** — branches touching `src/broker.mjs`/`cli.mjs` are clean against the *old* `main`
  and conflict after the first few merges. In one 18-branch set, 15 landed and 3 conflicted *only*
  because `main` had moved; a single batch call would have refused all 18 and hidden the 15 clean ones.
- **Stack order is prescribed** — a landing list names it (`#2420` BEFORE `#2483`). Read the body.
- **The helper never requires `--suite`** — it proves the merged result, not the verification. Prove the
  result on `main` afterwards either way.

## 6. Proving the result — two traps that both cost a wrong report

### 6.1 Capture the exit code; never pipe the runner
`node scripts/suite.mjs | tail -3` reports the exit status of **`tail`**, not of the suite. This produced
a "SUITE_EXIT=0" report on a red suite during the 2026-10-19 pass. Always:
```bash
node scripts/suite.mjs > /tmp/suite.out 2>&1; rc=$?; tail -2 /tmp/suite.out; echo "exit=$rc"
```

### 6.2 "Environmental" is a RUNNER classification, and `pitui` is NOT in it
`src/suite.mjs` classifies a demo `environmental` only when it was killed by a signal, exited with an
`ENVIRONMENTAL_ABORT_CODES` code, or its stderr matched a commit/memory-starvation pattern. Everything
else is a **real failure**.

`demo/pitui.test.mjs` fails an assertion about where `pi-tui` resolves
(`vendor/pi-main/packages/tui/dist/index.js`, via the `node_modules/@earendil-works/pi-tui` symlink,
#2412). The runner therefore prints `FAIL` and lists it under **REAL FAILURES**, and the suite exits
**1** — while `land.md` and `NEXT.md` describe that same failure as "environmental, not a regression".

**Both are true but they are not the same claim, and no artifact reconciles them.** The repo's standing
baseline for a land+prune pass on 2026-10-19 is `pass=175 fail=1` with that one failure; whether that
counts as green depends on accepting the symlink as environmental, which is a judgement, not a fact the
tooling asserts. Record the exact numbers (`pass=N fail=M`) in every report rather than "suite green",
and confirm a *new* failure is new by comparing against the pre-change baseline.

## 7. What is NOT authoritative

- **`docs/NEXT.md`** — a pointer, refreshed by hand. It has been wrong about the pass state more than
  once (it recorded a stopped pass as the plan after the work was done). Trust the queue + git.
- **A runbook's prose about tool state** — `land.md` documented `--suite` as broken for ~10 hours after
  the fix landed. Re-prove with the command before believing the prose.
- **`git status --short` alone for "clean"** — untracked scratch does not block a landing; only tracked
  changes do. `git status --porcelain | grep -v '^??'` is the tracked-only view.
- **`worktree audit` counts alone** — `reapable: 0` does not mean "nothing to prune"; it means nothing
  is reapable *by the automatic path*. The relocation path in §4.3 is not counted there.

## 8. Known gaps in the machinery (routed, not fixed here)

1. **The runbook-verification rules never run.** `runbook-stale`, `runbook-unverified` and
   `runbook-front-matter` exist in `src/checkup.mjs` and are reported by `check` as
   `skipped — no runbook data was supplied`: `cli.mjs` does not pass a `runbooks` collection into
   `auditRig`. So the periodic verification this document's §"How to re-verify" depends on is **manual
   only** today. This is the gap to close for automated topic-doc verification.
2. **`auditRig`'s runbook rules expect TYPED front-matter** (booleans for `writes`), while the files
   store YAML text (`writes: false`). Feeding a naive YAML parse to `runbookFrontMatterProblems` reports
   `writes: must be true or false` for **all 26** runbooks, including every pre-existing one — a false
   positive a verifier must know about before it "fixes" anything.
3. **`leaked-worktrees.md` had no `## Impact` / `## Escalate to`** — a skeleton gap the unfed rule above
   would have caught. Both sections are now present (2026-10-19). The related `land.md`
   `precondition: tree-clean` value was also outside the allowed vocabulary
   (`broker-stopped | read-only | none`) and is now `none` with the clean-tree requirement kept in the
   `Preconditions` prose, because the helper opens no store — it is git-only and waits for the genlock
   slots.

## Evidence
2026-10-19 (delegate, operator-directed land+prune pass): the pass that produced this document
restored an emptied `scripts/` directory (`tracked-files-missing-on-disk.md`), landed 17 verified
branches (`main` `67228b9`→`3b79159`, suite `pass=175 fail=1`), pruned 13 refs (refs 111→83, worktrees
206→204) — 12 by `-d`, 4 by relocation, 1 by the follower rule in §4.4 — with **nothing forced** and no
`ahead>0` ref deleted. The traps in §4.2, §5, §6.1 and §6.2 were each hit and corrected during that pass.
