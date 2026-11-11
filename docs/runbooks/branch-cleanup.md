---
runbook: branch-cleanup
symptom: "so many local git branches; merged branches were never pruned"
writes: false
precondition: "read-only"
last_verified: 2026-11-10
verified_by: scribe
evidence: "2026-10-19 reclaim pass (see the row below); 2026-10-21 pass: 11 merged refs were pinned by worktrees — 1 clean+locked+terminal was reaped with the ancestor proof (`devtools-item-4463` @0e29ce72), 7 dirty and 4 held/locked were KEPT; refs 165→164, `main` unchanged, tree clean. Step 0e minting pre-flight: both probes run on `main` 2026-11-09, exit 0 each (11 duplicate `## D` numbers, 5 un-minted placeholders). Fold rule added 2026-11-10 (#6111), verified in `item-6111` off `main f192f543`: `grep -c 'RELAYS a ruling' docs/runbooks/branch-cleanup.md` → 2; `grep -c 'duplicate a recorded ruling' docs/runbooks/delegate-doc-hygiene.md` → 1; `git grep -niE 'relays|relay a ruling' -- docs/DECISIONS.md` → no matches, exit 1; `node tools/review-cite-check.mjs docs/runbooks/branch-cleanup.md` → 0 failing, exit 0. #6149 (2026-11-10, `main` f192f543): the Verify probe below was run on the re-cut `dd2583b` — `git merge-base --is-ancestor dd2583b main` exit 1, `git cherry -v main dd2583b` exit 0 printing `+ dd2583b12…`, per-file blob comparison against the landed re-cut `bc51ba5b` exit 0 with 4 of 5 files BLOB-IDENTICAL, `node demo/compacteval.test.mjs` exit 0, `node demo/worktree-prune-branch.test.mjs` exit 0. ; the 2026-11-10 release pass (refs 82→26, worktrees 75→18, 57 removals exit 0, no --force) is recorded in the Evidence section below; env-name corrected to DURIG_DB (#5911, 2026-11-10, tree f192f543 - the CLI reads DURIG_DB: cli.mjs:155; only scripts/clockin.mjs:379 takes DURIAN_PI_DB)"
check_rule: null
---

# Prune accumulated branches (branch-cleanup)

## When to use
`git branch` has grown large and it is unclear what is safe to remove — typically because pruning is
**manual and guessable, and seats cannot do it**. The symptom a person types: "the branches are piling
up". Run this at a delegate clock-out, or when the `merge.md` "Trust, but verify" audit reports a big
`ahead=0` set.

## Impact
Merged branches are invisible clutter: they slow every `git branch`/worktree operation and hide the
small set that is **unlanded**. Worse, the same mechanism hides the real liability `merge.md` names —
a `done` item whose work is not on `main`. Blast radius is low: branch deletion does not touch the
shared working tree or the store, so the broker may keep driving. Only the `Do` step changes git refs.

## Preconditions
Git-only, read-only with respect to the store; the broker does **not** need stopping. Do **not** remove
or force-remove any worktree as part of a branch prune — a checked-out branch must be released through
`leaked-worktrees.md`, not here. The operator holds push (remote refs); see step 7.

The **model** behind these steps (artifact ownership, the three prune paths, and which source is
authoritative for each question) is `docs/BRANCH-AND-WORKTREE-LIFECYCLE.md`; this runbook is the
procedure.

## Diagnose (read-only)

**Step 0a — run the census, not a `git branch` loop.** `timeout 240 node tools/branch-census.mjs --plan`
(`tools/branch-census.mjs`) joins `worktree audit`, the queue, per-ref git facts and **this ledger**, then
prints the tally and the exact prune commands. Measured 2026-11-11 at `e01e9256` (Linux, Fedora Linux 45,
kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0): 77 refs / 69 worktrees in ~25-35 s, plan = 1.
It encodes two things a hand-rolled loop gets wrong: (i) it **will not plan a delete for a ref with a KEEP
row in `docs/DISPOSITIONS.md`** — a reverted merge is an ancestor of `main`, so `git branch -d` deletes a
ref the ledger says to keep (a delegate pass did exactly this to `item-6063/6064/6066` on 2026-11-11 and
reversed it with `git branch <name> <sha>`); (ii) it distinguishes "merged" from "content already in
`main`" by comparing `git merge-tree --write-tree main <ref>` against `main`'s tree, so a branch that adds
nothing net is separable from one that carries unlanded work.

**Step 0 — the ledger first.** Before re-deriving a disposition for ANY branch,
check `docs/DISPOSITIONS.md` FIRST: a branch that already has a row there is
**not re-litigated** — it is **re-listed with its existing disposition**
(`CANCEL` / `SUPERSEDED` / `LAND` / `KEEP-HELD`). The ledger records decisions, not
ref existence, so a missing ref is not a missing row and a present ref is not a
re-derivation. New dispositions are **appended** to the ledger by the deciding
seat in the same pass (a new row with the new deciding item id) — never an edit to
an old row. The probe method for proving a disposition is in the ledger's
convention: blob identity at path, patch-id secondary, **content wins**.

**Step 0b — a SEMANTIC conflict is NOT a "pending rebase" (ZOMBIE ITEM).** A rebase
item whose conflict is semantic is not a rebase item. A rebase is a mechanical
operation that PRESERVES intent; when the conflict spans a safety surface across
hundreds of commits, a "rebase" is a re-implementation wearing a rebase's clothes
— it resolves by picking one wording per hunk, which is guessing exactly where
guessing is most dangerous. Such an item must be **RECLASSIFIED** as a
re-implementation (fresh work against current `main`, with a current-code verify)
or **CANCELLED** with the ref left intact. It must **NEVER** be left as "pending
rebase": a pending rebase looks like queued work that will eventually happen, so
nobody ever makes a decision about it, and it re-appears in every inventory
forever. Name that state for what it is — a **ZOMBIE ITEM** — and treat finding one
as a defect in the inventory rather than as backlog. *Worked example:* the
guard/carry stack (`impl-item-1151`, `impl-item-1261`, `impl-item-1225`,
`impl-item-1249`, `impl-item-1444-fix`) — measured 341–566 commits behind,
conflicting across `src/broker.mjs`, `src/confine.mjs`, `src/seattools.mjs`,
`src/config.mjs` and `cli.mjs`. Claims cancelled, refs intact per R-B, intent
re-filed where it still matters (lead ruling #3383).

**Step 0c — identical tips are ONE claim (a duplicate PAIR, not two items).** When
two branch refs resolve to the SAME tip, keep ONE claim — the lower item id, i.e.
the original — and cancel the other citing the shared tip. Never rebase, verify or
land both: two claims on one tip will eventually produce two landing entries for
the same content, and the second one lands a duplicate. *Worked example:*
`impl-item-1151` and `impl-item-1261` both resolve to tip `85c5d95f6`.

**Step 0e — DECISIONS-number pre-flight before anything appends a `D` entry.** A branch
that adds a `## D<number>` heading must be checked against `main` **before** it lands,
because the number is minted at land time, not in the branch (#3075): a branch that hardcodes a
number collides with whatever gets minted first. Two read-only probes, both on `main`:

```bash
git show main:docs/DECISIONS.md | grep -oE '^## D[0-9]+' | sort | uniq -d   # every number used twice
git show main:docs/DECISIONS.md | grep -nE '^## (D###|D-<mint>)'           # every un-minted placeholder
```

Both ran on 2026-11-09, exit 0 each: the first printed `## D91` and `## D111`–`## D120` (**11
collisions**), the second printed **5** placeholder headings. If either prints anything, the landing
pass must mint the collisions in issue order **before** the new entry is appended — an append on top
of a collision leaves every later `D111` citation ambiguous, and the ambiguity is invisible until two
seats cite different entries for the same number.

**Step 0e carries the fold rule too: never mint an entry that RELAYS a ruling the record already
holds.** Before appending a `## D` heading, ask whether the decision already lives somewhere retrievable —
a runbook, a review, a `docs/ROADMAP.md` row. If it does, annotate that place instead of creating a second
entry. Measured in `item-6111` off `main f192f543` (2026-11-10): `git grep -niE "relays|relay a ruling" --
docs/DECISIONS.md` returns **no matches, exit 1** — the prohibition was nowhere in the file it governs. What
is retrievable: `docs/runbooks/delegate-doc-hygiene.md` § "A number in a roadmap or spec row must say INTENDED
or RESOLVED, and name the tree it was measured on" ("minting a DECISIONS entry to relay it would duplicate a
recorded ruling") and `docs/NEXT-ARCHIVE.md` ("the scribe should fold rather than mint a second entry").
**Why the source is the text and not the id:** the ruling is **#5568**, a DONE queue row, and a done row has no
read path (#3486) — an id-only citation is a dead pin, the same class as the dangling citation in #4169 and the
dead dependency path in #6077. The rule runs from this runbook; the id is provenance.

The pre-mint check:

```bash
git grep -niE '<a phrase from the ruling itself>' -- docs/DECISIONS.md docs/runbooks docs/reviews docs/ROADMAP.md
# hit  -> fold the annotation into the hit, do not mint;  no hit -> mint
```

**Step 0d — a rebase is safe ONLY where a demo can catch the error it
introduces.** Before attempting a rebase, ask what would FAIL if the resolution
were wrong. If a demo or check would catch it, rebase. If the honest answer is
"nothing would catch it", the conflict is a design decision wearing a rebase's
clothes — reclassify it as a re-implementation or cancel it (Step 0b). This is
the discriminator that makes "semantic vs mechanical" actionable: it names what
to check, not just that the conflict is hard. *Why 2578 was rebasable:* its
`cli.mjs` hunk needed RE-ANCHORING rather than "keep main" — main's #2572
refactor had moved `openStore()` into an `openHandles` closure — and the branch's
own demo caught the author's naive keep-main attempt ("the open at cli.mjs:1699
documents the P5/#110 exception above it"); a demo existed that could see the
wrong answer, so the rebase was safe to attempt. *Why the guard/carry stack was
not:* there is NO demo that can catch a wrong wording across `src/broker.mjs`,
`src/confine.mjs`, `src/seattools.mjs`, `src/config.mjs` and `cli.mjs` — the
conflicts are semantic, and resolving them means picking one wording per hunk
with nothing to tell you which is right. Same for the provider-field pair, where
the field's in-effect value is unsettled so no test can adjudicate.

**Cross-reference — merge-tree cannot see a derived-mirror invariant.** A branch
can be textually clean and semantically stale (`constitution.txt` ↔
`rig.starter.json` cost a land+revert, `a65feee`/`cc96c0c`); that shape is
tracked as #3443 in the landing runbook.

Classify every non-`main` ref as **merged** (`ahead=0`), **held** (checked out in a worktree), or
**unlanded** (`ahead>0`). **The `sed` matters:** `git branch` prefixes a ref with `*` (current) or `+`
(checked out in a **linked worktree**); an unstripped `+` corrupts every downstream loop:
```bash
git branch --merged main | sed -E 's/^[*+ ]+//' | grep -v '^main$' | sort -u > merged.txt
git worktree list --porcelain | awk '/^branch /{sub("refs/heads/","",$2); print $2}' | sort -u > held.txt
comm -23 merged.txt held.txt    # MERGED + free  -> prunable now
comm -12 merged.txt held.txt    # MERGED + held  -> release the worktree first, then prune
```
Unlanded set (keep every one; `+` = patch **not** in `main`, `-` = rebased duplicate already in `main`):
```bash
for b in $(git branch --format='%(refname:short)' | grep -v '^main$'); do
  a=$(git rev-list --count "main..$b")
  [ "$a" -gt 0 ] && echo "$b ahead=$a unique=$(git cherry main "$b" | grep -c '^+')"
done
```
Confirm the two safety facts before touching anything: `main` HEAD sha, and a clean tree
(`git status --short -- .`). Never prune while the tree is mid-merge.

## Do
1. Re-run Diagnose **at this moment** — branch sets are point-in-time (the rig creates refs live).
   **Re-run it again after each landing batch, not only once at the start.** Landing one branch can make
   an unrelated ref merged: on 2026-10-19 landing `impl-item-1705` (tip `349d5d3`) turned
   `auditor-item-2757` (same tip, `ahead=4` at Diagnose) into an ancestor of `main`, so a ref recorded as
   unprunable at the start was safely `-d`'d at the end of the same pass. The gate is always the live
   question, never a remembered `ahead` count:
   `git merge-base --is-ancestor <branch> main && git branch -d <branch>`.
   **Read the lock flag from `git worktree list`'s TERSE output** (`<path> <sha> [<branch>] locked`), not
   from `--porcelain`: there `locked` is its own line AFTER `branch`, so a naive parse attributes it to
   the following tree (2026-10-19: it reported all 22 merged worktrees as locked).
2. Delete **merged + free** refs. `-d` refuses anything unmerged or still checked out, so it cannot
   lose work:
   ```bash
   git branch -d $(cat merged.txt | comm -23 - held.txt)
   ```
3. **Patch-equivalent duplicates** (a rebased copy already in `main`): the work *is* on `main`, so
   `-d` refuses it (the tip is not an ancestor). **A seat cannot run `git branch -D`** — the seat
   guard refuses it (`src/confine.mjs` `branchForceDelete`, #1211). Use the sanctioned verb (#3491):
   it removes the ref ONLY when every commit is patch-equivalent to `main` AND no worktree holds it,
   and it prints the recovery command:
   ```bash
   DURIG_DB=./selfdev.sqlite node cli.mjs worktree prune-branch <branch>
   ```
   Refusals are loud (`ok:false`, exit 1) and name the reason: an unlanded `+` commit, a worktree
   holding the ref, or an already-ancestor ref (that one needs `git branch -d`, which is allowed and
   cannot lose work). An empty `git cherry` is NOT "all `-`" — never read it that way.
   The operator, or a shell outside the seat guard, may still do it by hand:
   ```bash
   git cherry -v main <branch>          # every line must start with '-'
   git branch -D <branch>
   ```
4. **Do not delete** any `ahead>0` branch, and **never** delete a snapshot/archive branch
   (`item-<N>` pre-split snapshots, `selfdev-*`). They sit on old bases and are not work-in-flight
   (see `merge.md` "Never merge a snapshot").
5. A **held** merged branch cannot be pruned until its worktree is released, per `leaked-worktrees.md`.
   Three cases: **(a) clean + unlocked + terminal** → `git worktree remove <wt>` then `git branch -d`;
   **(b) clean but `locked`** → `git worktree unlock <wt>` → remove → `-d`, only when the item is
   terminal (otherwise the lock means "in use" — keep it). **Which lock?** `git worktree remove` refuses a
   *git*-locked tree with `fatal: cannot remove a locked working tree` (exit 128); `cli.mjs worktree audit`'
   s `locked` field is the **rig's run lock**, a different lock — measured 2026-11-11, `item-5912` is
   git-locked while the audit reports it unlocked. **(c) dirty** → keep. `leaked-worktrees.md`
   § "Reclaiming a merged item-branch pinned by a verify worktree" covers the qa `verify-*` tree case.
   **When (c) is dirty and the branch IS merged, the operator-approved resolution is to RELOCATE the
   worktree out-of-tree** (`git worktree move` to `../pi-opendurig.worktrees/`, then `switch --detach`,
   then `-d`) — it preserves every file and frees the ref; the full copyable loop and counts are in
   `leaked-worktrees.md` (2026-10-19). Most durian-pi item worktrees are dirty with CARRY residue, so
   this is the COMMON path, not the exception. Then re-run Diagnose and step 2.
6. `git worktree prune` to drop metadata for worktrees already removed by the sweep.
7. **After any composed merge, gate on the FULL suite, not the derived one.** A conflict resolved by taking
   one side can silently delete a capability `main` already shipped. On 2026-11-09 the `item-5226` composition
   dropped `LOCAL2_ENV_PREFIX` from `LOCAL_ENV_PREFIXES` (`src/providers/local.mjs`); the 46-test changed-suite
   passed and the 278-test suite caught it (`demo/local2-provider-prefix.test.mjs`). `node scripts/suite.mjs
   --jobs 8` is 60 s — cheap relative to one wrong landing.
7. Remote snapshot refs (`origin/selfdev-*`, `origin/item-148`, `origin/pi-rebase`) are the operator's:
   deleting them is a push, and the delegate holds no push grant.

## Verify
```bash
git branch | wc -l            # decreased by exactly the pruned count; not below held+unlanded+1
git log --oneline -1 main     # HEAD sha UNCHANGED from Diagnose
git status --short -- .       # still clean
```

**Proving a sha you deleted was landed: ancestry is the FAST PATH, never the verdict (#3337, decided at
#3724).** A rebase or re-cut lands the SAME content as a NEW object, so `--is-ancestor` returns **1** for a
commit whose content is demonstrably on `main`. Two steps, in this order:

```bash
# 1. PER-FILE BLOB IDENTITY (the verdict — docs/DISPOSITIONS.md §"The probe method").
#    Compare against `main`, and against the sha of the landed re-cut if one is known.
git show --name-only --format='' <sha> | while read -r f; do
  a=$(git rev-parse <sha>:"$f"); b=$(git rev-parse main:"$f")
  if [ "$a" = "$b" ]; then echo "BLOB-IDENTICAL  $f"; else echo "DIFFERS  $f  ($(git diff <sha> main -- "$f" | wc -l) diff lines)"; fi
done
# 2. RUN THE DEMO that sha shipped, on the MERGED tree — the capability exists and passes.
node demo/<the test that sha shipped>
```

A `DIFFERS` line is **not** a dropped commit: it says "look at WHY". Read the diff — if it is `main`'s own
later edits to the same path, the content landed and then moved on. `git cherry` is not the verdict either:
it compares **patch-ids**, i.e. diffs, not results, so an add/add re-cut with different surrounding hunks
reports `+` (unique) even when every resulting blob is byte-identical.

**Worked re-cut case, measured 2026-11-10 in `item-6149` off `main f192f543`** — qa's compacteval tip `dd2583b`:

| probe | result |
|---|---|
| `git merge-base --is-ancestor dd2583b main` | **exit 1** — ancestry says "not landed" |
| `git cherry -v main dd2583b` | **exit 0**, prints `+ dd2583b12…` — patch-id says UNIQUE (same 5 files, patches 1474 vs 1416 diff lines) |
| `git rev-parse dd2583b:<file>` vs `git rev-parse bc51ba5b:<file>` | **identical** for `src/compacteval.mjs` (`8757e860`), `demo/compacteval.test.mjs` (`64399270`), `scripts/compact-eval.mjs` (`d8a6cca1`), `docs/runbooks/compaction-eval.md` (`780d181b`) |
| vs current `main` | the same blobs differ by 10/10/37/29 diff lines — main's later edits, including the UTF-8 BOM stripped by #1604 (`git diff dd2583b main -- src/compacteval.mjs` = 1 changed line) |
| `node demo/compacteval.test.mjs` on the merged tree | **exit 0** |

Verdict: **LANDED** (SUPERSEDED as a ref), decided at #3724 and recorded in git at `20597f99`. No ledger row
is owed — step 0: "a missing ref is not a missing row", and no `refs/heads` ref carries it.

**Landed ≠ deletable.** `git branch -d` accepts only ancestors, and the sanctioned seat verb
`cli.mjs worktree prune-branch` (#3491) is **patch-id** gated — `src/worktree.mjs:710` requires `git cherry`
to print at least one line and every line to start with `-` — so it REFUSES exactly the `dd2583b` shape even
though four of its five blobs are identical. Proving content landed tells you the branch carries nothing;
it does not license a delete. Leave the ref (rule R-B, #3270). The gate itself is proved by
`node demo/worktree-prune-branch.test.mjs` (exit 0 here).
**The ledger rule (runs every pass, not only a prune):** every branch whose
disposition is already recorded in `docs/DISPOSITIONS.md` is **re-listed from the
ledger, never re-derived**:
```bash
grep -E 'architect-item-3005|security-item-1475' docs/DISPOSITIONS.md  # both rows present (CANCEL)
git diff --exit-code docs/DISPOSITIONS.md                              # append-only: a row added this pass, none edited
```
**The minting pre-flight (Step 0e) is present and runnable:**
```bash
grep -c 'Step 0e — DECISIONS-number pre-flight' docs/runbooks/branch-cleanup.md   # >= 1
git show main:docs/DECISIONS.md | grep -oE '^## D[0-9]+' | sort | uniq -d          # exit 0 while collisions exist
```
**The fold rule is readable without a queue read (Step 0e, #6111):**
```bash
grep -n 'RELAYS a ruling' docs/runbooks/branch-cleanup.md                          # >= 1 — the rule is in the doc, not only in a closed row
git grep -n 'duplicate a recorded ruling' docs/runbooks/delegate-doc-hygiene.md    # exit 0 — the retrievable source it names
```

**The three disposition rules (Step 0b / Step 0c / Step 0d) are present:**
```bash
grep -c 'Step 0b — a SEMANTIC conflict is NOT a "pending rebase"' docs/runbooks/branch-cleanup.md  # >= 1
grep -c 'Step 0c — identical tips are ONE claim' docs/runbooks/branch-cleanup.md                     # >= 1
grep -c 'Step 0d — a rebase is safe ONLY where a demo can catch the error' docs/runbooks/branch-cleanup.md # >= 1
```
Every kept branch must still be listed. The 2026-10-17 run: 128 → 76 refs, `main` at `c0534ed`,
tree clean, all 33 unlanded refs intact.

## If it fails
- `git branch -d` says **not fully merged**: it found real unlanded work. **Do not reach for `-D`.**
  Keep the ref and route it via `merge.md` (land or rebase) or to `pm`.
- `git branch -d` says **checked out at <path>**: leave it; release the worktree per
  `leaked-worktrees.md`, not by force.
- You pruned a ref you now need: it is recoverable while reflog holds it — `git branch <name> <sha>`
  (the sha from the delete output), or `git reflog`/`git fsck --lost-found`.

## Escalate to
`pm` — to open a landing pass for the `ahead>0` set (the durable fix for unlanded work). `lead` — when
a held branch cannot be merged cleanly. The operator — to prune remote snapshot refs.

## The ceiling: a merged branch is not a closed item (measured 2026-11-09)
`cli.mjs worktree audit`'s `reapable: 0` was **correct** for three consecutive passes. The sweep contract is
TERMINAL + UNLOCKED + CLEAN, and `src/broker.mjs:1117` classifies a tree as `live` whenever its item row is
`queued|claimed|deferred|held`. On 2026-11-09 **49** item trees had branches that were provably ancestors of
`main` (`git merge-base --is-ancestor` exit 0 for each) while their rows stayed non-terminal — 35 `deferred`,
11 `held`, 3 `claimed`. Git had nothing left to do; the pin was queue state. **No git verb can close that gap**
— the fix is a landing act that also dispositions the row, which is why this belongs to the release role
(`pm`), not to the sweep.

The consuming verb exists but is **not landable**: `item-5301` (ROADMAP 311 cut 2, tip `39f8c92c`, 1 ahead of
`main`) carries `cmdWorktreeReap` + `reapWorktrees` + `demo/worktree-reap.test.mjs`. Two reproduced defects:
`cli.mjs` does not parse (backticks around `reapable` inside the `usages:` template literal → `SyntaxError:
Unexpected identifier 'reapable'`), and once the backticks are removed the demo fails at
`demo/worktree-reap.test.mjs:114` because `reapWorktrees` returns only the array of removed item ids while the
demo asserts `dry.candidates` / `dry.refusedSoleCarrier` / `dry.kept` / `dry.counts.reapable`. Reproduce:
`git worktree add --detach .spike/probe item-5301 && ln -s $(pwd)/node_modules .spike/probe/node_modules && cd .spike/probe && node cli.mjs worktree reap --dry-run`.
The ref is KEPT (`git branch -d` refuses it, correctly). It is a **re-cut job for a seat**, not a delegate merge.

2026-11-09 (delegate re-check session N19, broker DOWN, read-only): the git side is **stable, not unfinished**.
`git worktree list | wc -l` → **9**, `git branch --format='%(refname:short)' | wc -l` → **12**, `cli.mjs worktree audit`
→ `total: 9`, `reapable: 0`, `dirty: 0` for item trees, all `seat-root`. A per-ref census
(`.spike/delegate/branch-landing-census.mjs <db>`, read-only, ~1 s) reports patches ahead of `main` per ref: only
`item-5301` (**1**) and `wip/seat-prompt-files` (**1**, ledger: SUPERSEDED-BY-EVENTS); every other ref prints **0**.
Four refs are ancestors of `main` while their rows are non-terminal — `#5604 claimed`, `#5829 claimed`, `#5834
claimed`, `#5912 held` — which is the ceiling, not a cleanup job. Two trees are dirty with seat scratch
(`item-5829`: 4 probe files; `durian-dev/seatroot`: 7), and scratch belongs to its owner: removing it is a seat act,
not a delegate act. **Nothing was merged, pruned, unlocked or deleted in this pass.** The only landable item is
`item-5301`, and it is not landable until its author seat fixes the `usages:` template literal and the
`reapWorktrees` return shape.

## Evidence
2026-11-09 (delegate land+reap pass, broker DOWN, operator-directed): **58 worktrees → 9**, **60 refs → 12**,
`main` `6787bd24` → `ea12fe04`, **zero `--force`**. Six branches landed (`item-5387`, `item-5501`, `item-5829`,
`item-5226`, `item-5221` + the composition fix `ea12fe04`); 49 trees removed, 48 refs `-d`'d, each proved an
ancestor of `main` first; every tree's residue captured to `.spike/delegate/cleanup-20261109/quarantine/`
(52 files, 2 non-empty diffs) before removal. Suite on `main`: **278/278** in 60 s. What remains is explained:
**9** worktrees = `main` + `durian-dev/seatroot` + the seven live seat roots (`item-5604 auditor, 5801 devtools,
5829 impl, 5834 qa, 5912 scribe, 5965 architect, 5976 security`), and **12** refs = those seven + `main`,
`seatroot/linux`, `verify-5180` (ledger row: NOTHING-TO-LAND), `wip/seat-prompt-files` (SUPERSEDED-BY-EVENTS,
author re-cut) and `item-5301` (the unlandable reap verb above).

2026-10-18 (delegate, operator-directed): a full sweep pruned **51 merged refs** — 17 free `-d` plus
**34 worktree-held refs whose ONLY content was generated scratch** (untracked `verify-*`/`.verify*`,
`.tmp-merged.txt`/`.tmp-held.txt`, `selfdev.sqlite.broker.inbox.out/`, `suite-batch*.txt`) with every
nested verify tree clean. Because `git worktree remove` refuses on ANY untracked file, the scratch was
**moved to `.spike/delegate/quarantine/<branch>/`** (preserved, not deleted), the lock released, then the
worktree removed and the ref `-d`'d. A separate **landing pass** landed 5 verified branches
(`devtools-item-1904`, `scribe-item-1968/1969/1970/1971`) via `scripts/land.mjs --suite` (suite 138/0,
`main` `95e7c0c`->`b3710f3`) and pruned them. Net: refs **137->84**, worktrees **167->130**, `main`
advanced once by a clean FF, tracked tree clean, **nothing forced**. ~46 merged refs remain held by
dirty/real-content worktrees (see leaked-worktrees.md); 36 unlanded carry real work.

2026-10-17: 52 refs pruned (50 merged `-d` + 2 patch-equivalent `-D`: `impl-item-1256`,
`scribe-item-1532`); 42 merged-but-held and 33 unlanded kept; `main` unmoved. Follow-up owed: the 33
unlanded commits (guard/confine stack `#1151…#1519`, docs `#1232…#1565`) reported to `pm`. Ops note
that produced the `sed`: `git branch --merged main` prints `+ <ref>` for worktree-held refs, which
silently corrupts a `main..$b` loop.

2026-10-19 (prune pass #3, delegate, broker UP, right after 6 landings): refs **94 → 89**, worktrees
**210 → 208**, `main` unmoved by the prune, nothing forced. **`worktree audit` reported `reapable: 0`** and
that was the CORRECT answer, not a failed pass:
- **5 merged+free refs `-d`'d** (`devtools-item-2976`, `impl-item-2744`, `architect-item-2984`,
  `architect-item-3005-rebased`, `impl-item-2545`) immediately after their landings, then the diagnostic
  sweep freed 4 more (`devtools-item-3036/3038/3082`, `scribe-item-3047` — all with tips ON `main`
  already, i.e. branches that never carried a commit of their own).
- **8 merged refs stayed HELD by `locked` worktrees** (`advocate-item-2104/2630`, `devtools-item-2559/2638/2969`,
  `impl-item-1274/2744/2788`) — every one a live item or a lock, so step 5(b)'s "only when the item is
  terminal" applies: **one** was terminal + clean (`impl-item-2744`, item cancelled) and was reclaimed
  `unlock → remove → -d`; the rest were kept.
- **`item-2104` REFUSED removal** — one untracked `selfdev.sqlite.broker.inbox.out/` left inside the
  worktree. That refusal is the safety net (`never --force`); it was re-locked and reported. **New known
  artifact:** a `*.broker.inbox.out/` (or `*.genlock.*`) INSIDE a worktree means the seat ran CLI commands
  from that cwd — it is a store artifact, not authored work, but its presence still makes `remove` refuse,
  so the reclaim for that tree needs an explicit decision rather than a force.
- **A big worktree COUNT is not evidence of a leak:** 163 of 208 are the already-relocated
  `../pi-opendurig.worktrees/*` trees (registered worktrees that live outside the repo, counted as
  `kind: non-item`). They are preserved, deliberately, and re-print on every audit. Judge the pass by
  `merged+free`, `dirty`, `locked` and `live` — not by the total.
- **Seat roots drift back to the shared tree after a pass.** `audit.seatRoots` showed **all 11 seats**
  rooted at the shared tree at the end of this pass (the same audit earlier in the session had `impl` on
  `item-2744` and `devtools` on `item-2595`). `complete_work` teardown and the sweep flip a seat's cwd
  back — this is the F12 fallback re-asserting, not a prune bug. **Re-read `seatRoots` at the START of a
  pass** and re-point any seat you are about to depend on; do not assume yesterday's roots.

2026-10-19 (prune pass #4, delegate, broker UP, after 4 landings): refs **95 → 88**, worktrees **201 → 200**,
`main` unmoved by the prune, nothing forced.
- **6 merged+free refs `-d`'d** (`devtools-item-2587`, `devtools-item-2969`, `impl-item-2420`,
  `impl-item-2797`, `impl-item-3164`, `scribe-item-3121`).
- **2 merged-but-held refs freed by RELOCATION** (the dirty-but-merged path, § "relocate out-of-tree"):
  `advocate-item-2104` (item **cancelled**, clean tracked, but holding an untracked
  `selfdev.sqlite.broker.inbox.out/` — so `worktree remove` would have REFUSED) and `devtools-item-2638`
  (item **done**, unlocked, dirty with **`scripts/land.mjs`** + `package-lock.json` — real WIP, preserved
  byte-for-byte). Both moved to `../pi-opendurig.worktrees/`, detached, then `-d`.
- **8 more TERMINAL item trees relocated out of the project root** (`item-1225/1249/1261/1704/1769/1823/1469/2103`);
  project root item dirs **20 → 12**, and every tree's `git status` entry count was verified **identical
  before and after** the move (1:1, including one with **269** entries) — that equality is the lossless proof,
  so record it, do not assume it.
- **Kept (live):** `item-723`/`1274`/`2630`/`2788` (`held`), `2559` (`deferred`), `2993` (`queued`), plus the
  `item-2188/*` nested rebase scratch (relocate nested-first or not at all) — and `item-2103`, which stays
  **detached** on purpose (it held `designer-item-2103`; detaching is how the branch was freed for a rebase).
- **A `git cherry` `+` is not proof a branch is unique.** `architect-item-3005 @0827b39` shows `+` (its patch
  ID differs from the landed `architect-item-3005-rebased`) yet `git diff main:<path> 3005:<path>` is **empty**
  — same content, different patch shape. Compare the TREES before concluding "unlanded"; do not delete on a
  `-D` hunch and do not re-land a duplicate.

2026-10-20 (prune pass #5, delegate, broker UP, after 2 landings + 1 revert): refs **97 → 93**, worktrees
**203 → 203**, `main` unmoved by the prune, nothing forced.
- **4 merged refs `-d`'d**: `qa-item-3104`, `qa-item-3198` (both tips already on `main`), then
  `impl-item-3062` and `scribe-item-3167` after their landings.
- **`devtools-item-1558` KEPT on purpose at `17cd7a2`** even though it is now an ancestor of `main`: it
  was landed and then reverted (`0976cc4`), so its content is NOT live and the ref is the author's input
  to rework `#3238`. `git branch -d` would have succeeded because the merge commit is in history; deleting
  it would hide the pending work. Treat "reverted merge" as a KEEP reason, not as merged.
- **Merged-but-held refs stayed**: `advocate-item-2630` (held), `devtools-item-2559` (deferred),
  `impl-item-1274` (held), `impl-item-2788` (held), `qa-item-2993` (claimed), `qa-item-3216` (verify in
  progress) — every one is held by a LOCKED/live tree, so step 5(b) applies: keep.
- **`worktree scratch clean` REFUSED 2 dirty scratches** (`%TEMP%/wt-2199`, `./wt-2073`, 1 and 4 paths).
  That is the clean-only guard working; the owner must finish or clean them, never `--force`. `reapable: 0`
  was the correct answer: 162 non-item trees are the archived `../pi-opendurig.worktrees/` set, 6 live item
  trees are locked, 33 dirty item trees are already archived, 4 seat-root trees are in use.

2026-11-10 (delegate, operator directive "land the dozens of branches and clean them up", **Linux Fedora 45**, kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0, `main` `8c86c8e2` → `f2ee1c88`): **refs 82 → 26, worktrees 75 → 18, zero `--force`.** The ceiling named above is closed by measurement, not by a ruling: once the broker exited on its own bound, `node cli.mjs worktree audit --json` answered in **1.15 s** and reported `total 75, seat-root 10, live 4, reapable 57, dirty 4, locked 0`. The release is a two-line loop, and it needs no broker, no store write and no model:

```bash
DURIG_DB=./selfdev.sqlite node cli.mjs worktree audit --json > .spike/wt.json
node -e 'const j=JSON.parse(require("fs").readFileSync(".spike/wt.json","utf8"));
 for(const w of j.worktrees) if(w.keepReason==="reapable") console.log(w.worktree)' | while read -r p; do git worktree remove "$p"; done
git worktree prune
```

57 removals, every one exit 0; wall clock **75 s** (user 1.05 s, sys 47.3 s). Then 56 refs `-d`'d, each gated on a **live** `git merge-base --is-ancestor <ref> main` exit 0 plus a check that no worktree still holds it — never `-D`. `git branch -d` is refused while a worktree holds the ref, which is why the order matters: release the trees first, prune the refs second. What is left is not clutter: 4 live rows (`#1158, #3087, #5912, #6177`), 4 dirty orphans whose residue was exported to `.spike/worktree-residue/` before anything was touched, 10 seat roots, and 8 ruled-kept refs. **One trap this pass proved:** `item-6057`'s tip is an ancestor of `main` while its worktree holds 88 uncommitted insertions (`sync-pi --no-repair`) that are nowhere in `main` — ancestor status gates the ref, never the residue.
