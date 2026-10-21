---
incident: worktree-carry-teardown-collision
date: 2026-10-19
severity: sev2
status: open
symptom: "a seat calls complete_work and its item worktree leaks, still dirty, still on its item branch"
runbook: leaked-worktrees
fix: null
prevention: "queued defect routed to pm (delegate intent, worktree-carry collision); needs a demo proving a completed item's worktree is torn down (or reported, not silently leaked) while the shared tree is dirty"
last_reviewed: 2026-10-19
---

# CARRY seeds every item worktree with the shared tree's dirty state, so `complete_work`'s clean-only teardown can never remove one while the shared tree is dirty

*Incident 2026-10-19; detected by the operator ("I just watched impl call complete_work without
cleaning up the workspace"); analysis by the delegate.*

## Summary
The operator watched `impl` call `complete_work` and leave its workspace behind. The completion was
real and its own commit was on the branch, but the worktree could not be torn down: it was **born
dirty**. `createWorktree` (ASK F / #506) deliberately *carries* the source tree's visible dirty state
into every new worktree, and the shared tree is tracked-dirty; `complete_work`'s teardown refuses a
dirty tree by design (D60). The two designs collide: **while the shared tree carries any tracked-dirty
file, every item worktree starts dirty and no `complete_work` can clean it**, so each completed item
leaks its worktree and pins its branch. This is the mechanism behind the branch/worktree sprawl the
selfdev rig keeps mopping up, and it is aggravated by the #2095 pin breaking `npm ci` on `main`.

## Timeline
- `01:39:43.056Z` — `impl` calls `complete_work` for **#2231** (entry `100614`, tool call
  `chatcmpl-tool-83c1f278ae73616a`), evidence `impl-item-2231 @166d51f`; result `ok` at
  `01:39:51.475Z` (entry `100616`).
- The same run had earlier completed **#2224** (`impl-item-2224 @a2eaf7b`).
- `01:40:23Z` — the broker log records the refusals (`selfdev.sqlite.broker.log` /
  `.spike/serve.err`): `worktree: refusing to remove …\item-2224: 4 uncommitted path(s)` and
  `…\item-2231: 5 uncommitted path(s)`.
- Later passes log the same shape for other seats: `item-2305` (qa, 4), `item-2315` (auditor, 4),
  `item-2340` (qa, 13).
- `01:40Z+` — the broker's idle loop is also hot-looping (`INTENT delivered=1` + a `PASS` roughly every
  0.5 s; the separate #2237/#2321 watch-pass defect), so the leaked worktrees are not being swept.

## Impact
Every completed item in this window leaks a registered worktree that stays on its `…-item-<id>`
branch, pinning the ref and duplicating the shared tree's WIP into the project root. Five leaked trees
were observed in this window (`item-2224`, `item-2231`, `item-2305`, `item-2315`, `item-2340`),
including two already-merged qa/auditor trees at `main` (`d04f9af`) that hold only carried foreign WIP.
No data loss (the refusal is the safety net, and `impl-item-2224`/`impl-item-2231` are `ahead=1`, so
their real work is preserved on the branch), but the leak is the root stock of the branch/worktree rot
the rig keeps reclaiming by hand.

## Root cause
**VERIFIED as a mechanism collision, by code + on-disk state:**

1. `src/worktree.mjs:119` — `createWorktree`'s comment records the decision: "F23's refusal is
   superseded by CARRY: fork HEAD, then carry the visible state in"; `:134` runs
   `carryVisibleState({ source, target })`; `carryVisibleState` is defined at `:195` and copies every
   dirty path (tracked edit / staged add / untracked file) into the fork.
2. The shared tree **is** tracked-dirty: `M src/broker.mjs`, `M demo/command-spool.test.mjs`
   (the parked devtools `configure` WIP) plus `M docs/NEXT.md`,
   `M docs/runbooks/leaked-worktrees.md` (delegate edits). CARRY therefore seeds every new item
   worktree with these four paths.
3. `src/worktree.mjs:494` (LEAK SOURCE A / #1881) and `:541-546` — teardown refuses a dirty tree
   (`console.warn("worktree: refusing to remove …: N uncommitted path(s)")`). That refusal is correct
   (D60: never destroy uncommitted work) but it is unconditional, so the carried foreign WIP blocks the
   removal of a tree whose own work IS committed.

The seat could in principle remove only the carried-foreign paths before `complete_work` (they are
duplicates of files that still live in the shared tree), but nothing tells it to, and no code
distinguishes "carried foreign WIP" from "the seat's own uncommitted work." `impl`'s own completion
note reports the carry as an environment fact, not a cleanup step.

**Aggravator (separate, VERIFIED):** `prepare_workspace` could not provision the fork because `npm ci`
fails on `main` — `ETARGET @earendil-works/pi-agent-core@1.3.0` (the #2095 pin) — so `impl` had to
junction `node_modules` to the live install. The junction is a second reason the tree is special; it is
not what makes it dirty, but it is what made the fork non-standard in the first place.

## Detection
Human only. There is no `status`/attention kind for "a completed item's worktree survived teardown";
the leak is visible only in `.spike/serve.err` (the refusal warning) and `git worktree list` /
`node cli.mjs worktree audit` (the tree lingering as `dirty`). A durable detection would be an attention
kind keyed on a terminal item whose worktree is still registered.

## Resolution
None yet; nothing was removed. Per `docs/runbooks/leaked-worktrees.md`, a dirty orphan is refused on
purpose and must be resolved explicitly — commit its work or take an operator decision — and the leaked
trees carry foreign WIP whose originals live in the shared tree. The delegate did **not** `--force`,
`git clean`, or `git restore` any of them.

## Prevention
- Queued defect routed to `pm` (delegate intent): either distinguish carried-foreign paths at teardown
  (so a completed item's worktree can be torn down rather than leaked), or make CARRY opt-out /
  carry-only-untracked, or surface the leak as an attention kind. Whatever shape `pm`/`lead` rule, the
  acceptance is a failing-first demo: a seat with a committed item on a dirty shared tree reaches a
  torn-down worktree (or an explicit, surfaced refusal) instead of a silent leak.
- This is a sharpened instance of the already-routed `worktree-rot-prevention-2026-10-19-1` intent;
  route together, not as a competing item.
- `docs/runbooks/leaked-worktrees.md` already carries the CARRY/teardown facts; add an Evidence line
  pointing here.

## Evidence
- Operator report: "I just watched impl call complete_work without cleaning up the workspace."
- `impl` transcript (`node cli.mjs log impl 60`): entry `100614` assistant tool call `complete_work`
  `{itemId:2231, evidence:{artifact:"impl-item-2231 @166d51f"}}` at `2026-10-19T01:39:43.056Z`; entry
  `100616` result `"ok"` at `01:39:51.475Z`. The `resultSummary` reads: "The worktree-carry also copied
  the shared tree's uncommitted WIP (docs/NEXT.md, docs/runbooks/leaked-worktrees.md,
  demo/command-spool.test.mjs, src/broker.mjs) — none of it committed."
- `.spike/serve.err` lines 8, 11, 12, 13, 25:
  `1/ 8: worktree: refusing to remove …\item-2224: 4 uncommitted path(s)`
  `1/11: …\item-2340: 13 uncommitted path(s)`
  `1/12: …\item-2315: 4 uncommitted path(s)`
  `1/13: …\item-2231: 5 uncommitted path(s)`
  `1/25: …\item-2305: 4 uncommitted path(s)`
- On-disk (`git -C item-<id> status --porcelain`):
  - `item-2224` branch `impl-item-2224` @ `a2eaf7b` (ahead 1): `M demo/command-spool.test.mjs`,
    `M src/broker.mjs`, `?? .durig-test-wt-1792344128583/`, `?? selfdev.sqlite.broker.inbox.out/`.
  - `item-2231` branch `impl-item-2231` @ `166d51f` (ahead 1): `M demo/command-spool.test.mjs`,
    `M docs/NEXT.md`, `M docs/runbooks/leaked-worktrees.md`, `M src/broker.mjs`,
    `?? selfdev.sqlite.broker.inbox.out/`.
  - `item-2305` @ `d04f9af` (= `main`), `item-2315` @ `d04f9af` (= `main`), `item-2340` @ `52acc86`.
- Shared tree dirty set (`git status --porcelain -- src/broker.mjs demo/command-spool.test.mjs
  docs/NEXT.md docs/runbooks/leaked-worktrees.md`) = exactly the carried paths above.
- Code: `src/worktree.mjs:119` (CARRY rationale), `:134` (carry call), `:195`
  (`carryVisibleState`), `:494` (LEAK SOURCE A), `:541-546` (clean-only refusal warning).
- Aggravator: `npm ci` on `main` fails `ETARGET @earendil-works/pi-agent-core@1.3.0` (#2095 pin),
  recorded in `impl`'s #2231 and #2224 completions ("node_modules junction to the live install").

## Links
`docs/runbooks/leaked-worktrees.md` · incident `2026-10-17-live-worktree-reap.md` (same root, the
`locked` guard) · intent `worktree-rot-prevention-2026-10-19-1` · queue items `#2224`, `#2231`,
`#2305`, `#2315`, `#2340` · the #2095 pin (`@earendil-works/pi-agent-core@1.3.0`) · ROADMAP 76.

## 2026-10-19 (second pass) — the CARRY residue is now the STANDING cost of every prune
Re-measured at the land+prune pass, after `impl-item-2360` (`carry: false` on the seat path) had already
landed: the leak it prevents is still fully present in the EXISTING worktrees, because the fix only
changes worktrees created afterwards. Concretely, of 22 merged refs at Diagnose:
- **9 merged terminal worktrees were dirty and unlocked** (`designer-item-2629`, `scribe-item-2683`,
  `qa-item-2701/2720/2728/2737/2766/2772`, `scribe-item-2910`) — every one refused by the clean-only
  removal guard, so all 9 had to be **relocated** out-of-tree rather than removed.
- 4 more landed during the same pass and were likewise relocated (`impl-item-1705`, `impl-item-2600`,
  `impl-item-2602`, `impl-item-2643` — 2, 9, 9 and 9 dirty paths respectively).
- The two genuinely `reapable` trees (`auditor-item-2632`, clean; `auditor-item-2757`, clean) were the
  exception, not the rule.

**Consequence for a maintainer:** `worktree audit` reporting `reapable: 0` is the NORMAL post-CARRY
state, not a sign that nothing can be pruned. The relocation path in
`docs/BRANCH-AND-WORKTREE-LIFECYCLE.md` §4.3 is the standard path; 13 refs were freed in that pass with
**nothing forced** and every file preserved. The fix for the class remains the `carry: false` seat path
(landed) plus a teardown that tolerates already-carried trees (still `fix: null` above — unchanged).
