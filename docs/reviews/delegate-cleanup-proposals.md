# Delegate cleanup proposals — what this campaign cost, and what would make it cheaper

**Author:** delegate (operator-directed), 2026-10-21. **Status:** proposals, not decisions. `pm` routes;
this file recommends only. **Scope:** the branch/worktree/ledger campaign that took `main` from
`671b50a` to `a54f0c9`-lineage `a84ecbc2`…`05535d21`, deleted 169 refs down to 11 and 52 worktrees down
to 6.

Every number below was measured in this session. Where an item already exists in the held backlog it is
named, so `pm` promotes rather than mints a duplicate.

---

## The short version

The delegate's job here was git surgery that is **90% bookkeeping and 10% irreversibility**. The
bookkeeping was re-implemented from runbook prose three times (inventory → export+verify → bundle+restore
→ delete-after-proof), and the irreversibility was held together by care rather than by a guard. Two of
the proposals below close a real data-loss path; one removes a recurring 4500-line tax on every session;
one stops a health verdict from crying wolf. Those four are worth doing now.

Measured end state of the campaign (evidence for every proposal):

| Measure | Before | After |
|---|---|---|
| Refs | 169 | **11** |
| Worktrees | 52 | **6** |
| `.git` | 62 MB | 58 MB |
| Registered worktrees reclaimed | — | **46** |
| Dirty trees whose residue was exported + sha256-verified | — | **37** |
| Worktree HEADs that were on **no ref** | — | **9** (all preserved by hand) |
| Refs deleted after a verified `git bundle` | — | **26** |
| Deleted refs restore-proved *after* deletion | — | 1 of 26 (mechanism proven) |
| Empty `nul`-only archive directories removed | — | **29** |
| `docs/NEXT.md` | — | **4506 lines** |
| `docs/DISPOSITIONS.md` NOTE blocks added by hand | — | **8** |

---

## Immediate (recommended to land next)

**STATUS 2026-10-22:** I2 (orphaned-HEAD guard) and I3 (`idle` verdict) were registered by `pm` as
**#4745** and **#4746** (I1 as **#4747**, docs split); the branch-naming follow-up N2 is **#4751**
(routed to lead). N1 (item-only branch names) is LANDED, see `docs/NEXT.md`.

### I1 — Split `docs/NEXT.md` into a pointer and an archive

**Symptom (measured).** `docs/NEXT.md` is **4506 lines**. `docs/NEXT.md` is the file the agent entry
point tells every session to read *first*. The pointer test (`demo/next-pointer.test.mjs`) only enforces
that the current block precedes the history, so the file is allowed to grow without bound, and it has.

**Why it matters.** The last three sessions each re-derived state from a different stratum of that file,
and stale claims survived *inside* it because no one reaches line 3800. The cost is paid once per session
by every future maintainer, human or delegate. It is also the reason `docs/NEXT.md` contradicted itself
about the ref count, worktree count, and which runbooks were stale until this campaign corrected it.

**Change.** `docs/NEXT.md` keeps: the current pointer block, the current item + queue ids, the exact next
commands, the blocker, and the last two sessions. Everything older moves **verbatim** to
`docs/NEXT-ARCHIVE.md`. The pointer test gains one assertion: the archive exists and the live file links
it. No content is edited, only relocated, so the archive stays a faithful record.

**Acceptance.** `wc -l docs/NEXT.md` is under ~400; the archive contains every relocated block in order;
`demo/next-pointer.test.mjs` passes with the archive assertion; `git log --follow` on the archive shows
the split commit and nothing else.

**Size.** Small (one docs commit + one test edit). **Risk.** Low; mechanical.

### I2 — `removeClaimedWorktree` must not orphan a detached HEAD

**Symptom (measured).** Of 32 dirty terminal `item-*` trees reclaimed, **9 had a HEAD contained by no
ref** — `item-1225`, `item-1249`, `item-1261`, `item-1823`, `item-2224`, `item-2412`, `item-2777`,
`item-2792`, `item-2801`. They survived only because the delegate read `leaked-worktrees.md`, minted
`archived/<name>` refs by hand, and only then removed the trees. `removeClaimedWorktree`
(`src/worktree.mjs`) refuses **dirty** trees and **junction/symlink** trees — correctly — but a **clean**
worktree whose HEAD is on no ref is removed silently, and after `gc` the only copy of those commits is
gone.

**Why it matters.** This is the one irreversible failure in the whole cleanup ladder, and the runbook
documents it only in prose ("check whether the tree's HEAD survives in a REF, because deleting a worktree
deregisters its HEAD"). Prose is not a guard. A seat's worktree made before item branches (#859) is
detached by construction, so the population at risk is exactly the older worktrees a cleanup pass targets.

**Change.** Before removal, resolve `git -C <wt> rev-parse HEAD` and test containment
(`git for-each-ref --contains <sha> --count=1`). If empty: **refuse** (default) with a message that
prints the one-line remedy (`git update-ref refs/heads/archived/<basename> <sha>`), or, with an explicit
`preserve: true` option, mint that ref first and then remove. Refusal must be reported like the dirty
refusal is (`{ removed: false, refused: "head-unreferenced", sha }`), never swallowed.

**Acceptance.** A demo that (a) creates a worktree, detaches it at a commit no ref contains, (b) calls the
removal path, (c) asserts refusal + the sha in the result, (d) calls again with `preserve: true` and
asserts a new `archived/*` ref containing that sha. The demo must fail against today's behaviour. The
sweep's keep-reason gains `head-unreferenced` so `worktree audit` shows it.

**Size.** Small-to-medium (one guard + one demo + audit reason). **Risk.** Low; refusal-only by default.

### I3 — `brokerHealth` needs an `idle` verdict

**Symptom (measured).** `selfdev.sqlite.broker.json` at clock-out: `pid 18628`, `heartbeatAt` **4 s**
old, `lastPassAt` **13 h** old. `node cli.mjs status` reported:

```
"broker": { "state": "degraded", "reason": "no pass within the progress timeout", "passAgeMs": 47126... }
```

…on a rig with **zero `queued`/`claimed` work** (4744 rows: 3691 done, 765 cancelled, 286 `held`, 2
`deferred`). A pass runs on a **store-commit signal**, so a quiet store produces no passes; the broker is
idle, not wedged. `brokerHealth` (`src/broker.mjs`) measures only LIVENESS and PROGRESS and has no branch
that asks "is there anything to wake?" — while `broker-down-or-stalled.md` already states the
discriminator: *"a FRESH `heartbeatAt` with a FROZEN `lastPassAt` means the loop is IDLE, not stuck"*.

**Why it matters.** A verdict that fires on every quiet rig trains its reader to ignore it, and then a
genuine wedge — the case the check exists for (#2581/F7) — looks identical. It also puts a false
`degraded` in front of every future delegate at clock-out, which is how this campaign's own review
started.

**Change.** Pass the wakeable-work signal into the health computation (e.g.
`brokerHealth(state, { wakeable: n })`, or a `status`-level downgrade when `wakeable === 0`): if progress
is stale **and** nothing is wakeable, return `state: "idle"` with `reason: "no wakeable work"`. Keep
`degraded` for stale progress **with** wakeable work queued. Preserve the existing shape (`pid`,
`hbAgeMs`, `passAgeMs`, `progressTimeoutMs`) so callers and demos do not break; add `wakeable` to the
result.

**Acceptance.** A demo over `brokerHealth` with three cases — fresh pass → `up`; stale pass + wakeable 0
→ `idle`; stale pass + wakeable 3 → `degraded` — and one `cli.mjs status` demo (or an assertion on the
existing status demo) showing an idle rig does not emit `pass-failed`. The runbook
`broker-down-or-stalled.md` gains one line pointing at the new verdict.

**Size.** Small (one function + demo). **Risk.** Low; additive state, no behaviour change to waking.

---

## Next tier (documented, not scheduled)

### N1 — `worktree reclaim`: the archive retention ladder as code

**Symptom.** 46 worktrees were reclaimed with **four throwaway scripts written in this session**
(inventory; export + sha256 verify; bundle + restore proof; delete-after-proof). Every step exists in
`leaked-worktrees.md` as prose, and the ladder ("merged+clean → remove; merged+dirty → export patch +
untracked, then remove; unmerged → ensure a ref/bundle first") was re-derived by hand. Two removals were
refused by Windows (`Directory not empty`, a reserved `nul` entry) and 29 archive directories were
`nul`-only shells that needed the `\\?\` path form.

**Change.** `node cli.mjs worktree reclaim [--dry-run] [--archive <dir>]` implementing that ladder
tier-for-tier, writing a per-tree `manifest.json` (head, status, patch bytes, untracked files with
sha256), verifying every copy before removal, refusing on mismatch, handling `nul`/junction via the
extended-length path, and printing one line per tree. `--dry-run` prints the plan and touches nothing.

**Acceptance.** A demo builds a merged+dirty tree with an untracked file and a nested `nul`, runs
`--dry-run` (nothing changes), runs it for real, and asserts: manifest exists, sha256 matches, tree gone,
`git worktree list` clean, and a second run is a no-op. The archive dir keeps the residue.

**Size.** Medium. **Risk.** Medium — mitigated by `--dry-run` and per-tree refusal semantics.

### N2 — Bundle capture and `--explain` for ref deletion

**Symptom.** 9 pre-split refs (`temp-*`, `wip/*`, `selfdev-borrow`) hold `+` commits by patch-id although
`main` carries every subject, because a stale base changes the patch-id. The sanctioned
`worktree prune-branch` therefore **refuses** them, and a delegate has to re-derive *why* and then
hand-build bundles. Deleting the 26 redundant refs required `git bundle create <f> <ref> ^main` per ref,
`git bundle verify`, a restore test **in-repo and in a fresh clone**, and a documented restore command.

**Change.** `worktree prune-branch --bundle-dir <dir>` writes a verified basis bundle + `format-patch`
before deleting, and `--explain` reports the discriminating evidence (patch-id verdict, content verdict,
which files differ from `main`) instead of a bare refusal. Add a documented archive convention and a
restore recipe in the output. **Partly exists:** #3607 (prune-branch + a non-author verify for a ref
deleter) — this proposal adds the bundle/explain half.

**Size.** Small-to-medium. **Risk.** Low.

### N3 — `demo/dispositions.test.mjs`

**Symptom.** There is **no automated coverage of `docs/DISPOSITIONS.md`**: `grep -rl DISPOSITIONS demo/
scripts/ src/` returns nothing, and `node demo/dispositions.test.mjs` fails with `MODULE_NOT_FOUND`. This
session appended **8** NOTE blocks and 9 table rows by hand, with column and vocabulary checks done
manually.

**Change.** A demo asserting: every table row has 6 columns; `disposition` is one of the ledger's
vocabulary; every `sha` resolves in the repo **or** is recorded as archived (with its bundle path);
append-only (no row disappears versus `git show HEAD~1:docs/DISPOSITIONS.md`); and `(date, branch)` is
unique. Plus one NOTE-block format rule so a note cannot silently become a table row.

**Size.** Small. **Risk.** Low; test-only.

### N4 — Held item whose branch already landed

**Symptom.** My campaign merged 5 branches whose queue items are **still `held`**
(`impl-item-1274`, `advocate-item-2630`, `impl-item-2788`, `qa-item-2993`, `scribe-item-4148` — all
`ahead=0`). Nothing in `status` or `worktree audit` distinguishes "landed, needs closing" from
"never started": both read `held`. A maintainer cannot triage 286 held rows without that distinction.
**Partly exists:** #3747 (check rule for a non-terminal item whose `blockedBy` names a cancelled id) —
adjacent, not the same. This is the "held **and** branch is an ancestor of `main`" rule.

**Size.** Small (rule + attention notice). **Risk.** Low.

### N5 — Runbook verification feasibility class

**Symptom.** Four runbooks (`compact-a-seat`, `broker-safe-change`, `resume-while-broker-runs`,
`store-corruption-recovery`) cannot be re-verified without a live broker/provider cycle or a real
incident, which is what blocks the runbook-wiring stack (`devtools-item-4054 → 4064 → 4083`) from
landing: switching the rules on makes `check` report **true** findings. I verified the
sandbox-executable halves by hand (temp store `up --no-serve`, `serve --max-duration`, a corrupted copy
for the loud failure) and left `last_verified` **unchanged** because half of each runbook stayed unproven.

**Change.** Declare a `verification: sandbox | broker-window | incident` class in front matter; the
`runbook-stale` rule maps an unverifiable-without-a-window runbook to **advisory**, not `error`. Add
`runbooks verify --sandbox` that executes a runbook's `Diagnose`/`Verify` shell blocks against
`DURIG_DB=%TEMP%/…`. Together these let the stack land honestly instead of on a demotion.

**Size.** Medium. **Risk.** Medium (it changes what `check` reports — needs a lead ruling).

### N6 — Make the fast suite the gate; classify Windows teardown aborts

**Symptom.** `npm run test` is ~8 min serial; `node scripts/suite.mjs` is ~2.5 min parallel. Two Windows
teardown aborts appeared this session **after** the test printed PASS — one `exit 3221226505`
(`0xC0000409`, `STATUS_STACK_BUFFER_OVERRUN`), one `Assertion failed: !(handle->flags &
UV_HANDLE_CLOSING), src\win\async.c` — and both files pass standalone. **Already registered:** #3464 (a
demo whose teardown fails exits 0), #3795 (the failure ledger), #3761 (`land.mjs` has no per-test
timeout).

**Change.** Have `scripts/test.mjs` classify a post-PASS abort in teardown as `environmental` (name the
signal, retry once, and record it in the failure ledger) rather than a red demo; document `suite.mjs` as
the default local gate and keep serial `npm run test` for release.

**Size.** Small. **Risk.** Low, provided the classification requires an explicit PASS line.

### N7 — Commit the reference bundles into the repo

**Symptom.** All 31 formerly-unmerged refs are preserved as **855 KB** of verified basis bundles under
`../pi-opendurig.worktrees/_exports/refs-2026-10-21/` — outside version control. If that sibling
directory is ever deleted (it is not a repo), the record goes with it.

**Change.** A `docs/archive/bundles/<date>/` directory (or a single tarball) committed with an
`index.json` (ref, sha, unique-commit count, verify result) and the restore recipe. 855 KB is small
enough to be worth the guarantee, and then the *refs* can be deleted without a second thought.

**Size.** Small. **Risk.** Low.

---

## What this campaign learned about the delegate role

1. **The runbooks are right; they are just prose.** Every risky step I took had a runbook paragraph that
   said the same thing, and every deviation I nearly made was caught by reading it (the terse-vs-porcelain
   lock parse, the "measure a temp tree, not the suite's cwd" trap). The gap is not knowledge, it is
   **executable form**: four of the proposals are "turn a paragraph into a verb or a guard".
2. **`-d`/`--force` are the wrong axis for safety.** `git branch -d` refused nothing in 132 deletions and
   `git worktree remove` refused the two trees that needed it — the git verbs were safer than the scripts
   around them. What actually lost safety was **prose reasoning at scale**: 46 trees × 3 decisions.
3. **A ledger without a test is a diary.** `DISPOSITIONS.md` proved essential for not re-litigating
   (9 `NOTHING-TO-LAND` rows saved a re-derivation), and it is completely unguarded (N3).
4. **State files rot in the direction of their length.** `NEXT.md` at 4506 lines is the single largest
   source of re-derivation in this project, and it is the file the entry point names first (I1).
