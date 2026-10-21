---
incident: terminal-worktree-mistaken-for-lost-work
date: 2026-10-19
severity: sev3
status: open
symptom: "a seat asks about 'its' worktree as though it still exists — `cannot change to item-<id>` — and treats the reaped tree as lost work it must rebuild"
runbook: leaked-worktrees
fix: null
prevention: "seat-facing rule in docs/WORK-ITEM-LIFECYCLE.md (worktree ephemeral / branch durable + the re-attach recipe); `worktree audit` names the relocation target"
last_reviewed: 2026-10-19
---

# A seat treats a reaped item worktree as lost work

*Incident 2026-10-19; surfaced by the operator: "the scribe is asking about a worktree that no longer
exists, but they expect it to exist". Analysis by the delegate against the live store and tree.*

## Summary

`scribe` finished item **`#3035`** (its DECISIONS.md design-of-record entry, branch
`scribe-item-3035 @ f450cdd`), then wanted to **amend** that branch — its landing note asserts "D113 is
reserved", which the newer lead rule `#3075` contradicts ("D113 NOT reserved"). It went looking for the
worktree it had used, `item-3035`, and found nothing:

> "Earlier the worktree item-3035 did NOT exist ("cannot change to item-3035"). So the #3035 worktree is
> gone (terminal/reaped). To amend, I'd need to recreate it."

Its probe returned empty:
`git worktree list --porcelain | Select-String 'item-3035'` → *nothing*.

**Nothing was lost, and nothing was wrong with the prune.** The item is terminal, so `complete_work` /
the broker sweep retired its worktree — that is the designed lifecycle (`BRANCH-AND-WORKTREE-LIFECYCLE.md`
§2: the worktree is created by `prepare_workspace` and retired by teardown; the **branch** is retired only
when merged). Verified this session: **no `item-3035` worktree exists**, `scribe-item-3035` still exists at
`f450cdd`, it is **not** an ancestor of `main`, and `git merge-tree main scribe-item-3035` is **CLEAN** —
the artifact survived intact and is landable.

The defect is not the reaping. It is that **a seat has no way to know that the reaping is normal, or how
to get back to its own branch**, so it spends turns rediscovering it and considers rebuilding an artifact
that is already safe. The knowledge exists — `docs/runbooks/leaked-worktrees.md` says *"the branch ref
survives regardless"* and gives `git worktree add <path> <seat>-item-<id>` to re-attach — but that runbook
is **delegate-facing**, and a seat reads `docs/WORK-ITEM-LIFECYCLE.md`, which says nothing about it.

Compounding factor: `scribe`'s persisted cwd is the **shared tree**, not a worktree (confirmed in
`worktree audit` → `seatRoots`: `scribe.cwd = C:\Users\Alex\dsh-Projects\pi-opendurig`). So `cd item-3035`
failing is also a symptom of the standing F12 fallback — 9 of 11 seats are rooted in the shared tree — and
a seat in that state has **no item worktree at all**, which makes "where is my worktree?" a live question
every time rather than a rare one.

## Timeline

- `21:51:22Z` — `scribe` completes `#3035` (`scribe-item-3035 @ f450cdd`, entry uses a `D###` placeholder).
- `21:51:36Z` — `scribe` claims the coordination item `#3047` (serialize `#3011`/`#3035`, non-colliding
  D-numbers) and begins the D113 pre-check.
- During `#3047` — it reads `#3075` ("D113 NOT reserved") against its own `#3035` note ("D113 is reserved")
  and decides the note should be corrected.
- It probes for `item-3035`; the probe returns empty; it concludes the worktree is gone and that amending
  "would mean recreating it".
- `22:00:45Z` — `#3099` (its `#3035` DONE notice) is recorded by `pm`.

## Impact

- **No data loss.** The branch is intact and clean against `main`; nothing needed rebuilding.
- **Wasted seat turns** on a question whose answer is "expected, and here is where your work actually
  lives". For a seat on a small local model this is an expensive detour — `scribe` burned reasoning on
  whether to re-create a worktree instead of on the coordination task (`#3047`) it was actually claimed for.
- **A near-miss on correctness**: the conclusion "amend the completed branch" would have rewritten the tip
  of a landed-soon branch (`f450cdd` → something else), invalidating any landing pin and forcing a re-verify
  — for a note that is **advisory only** (the D-number is minted at land time, so the note cannot be
  "wrong" in a way that matters).
- **A process read**: a seat cannot distinguish "my worktree was retired because my item is done" from
  "my worktree was reaped out from under me while my item is live" — two states with opposite correct
  responses (`BRANCH-AND-WORKTREE-LIFECYCLE.md` §2 calls the second case a *keep*, never a force).

## Root cause

**Three gaps, in order of leverage:**

1. **No seat-facing statement of the lifecycle.** `WORK-ITEM-LIFECYCLE.md` tells a seat what happens to
   *queue rows*; it says nothing about the *worktree*. The lifecycle facts live only in the delegate
   runbooks (`leaked-worktrees.md`) and the model doc (`BRANCH-AND-WORKTREE-LIFECYCLE.md`), which no seat
   opens. So every seat re-derives "is my tree supposed to still be here?" on its own.
2. **No re-attach recipe at the seat's level.** There is no documented (and no CLI) way for a seat to say
   "give me a tree on the branch I already own". `cli.mjs worktree <path>` creates a worktree but the
   re-attach path (`git worktree add <path> <seat>-item-<id>`) is written only inside an incident-recovery
   procedure, so it reads as a recovery hack rather than a normal operation.
3. **The F12 seat-root fallback masks the distinction.** A seat rooted in the shared tree never had an
   `item-<id>` worktree to begin with, so "the worktree is gone" and "the worktree never existed for me"
   present identically. Until the seat root is per-item (the standing `#1151` / F12 work), this question
   recurs by construction.

## Detection

**Not detected by the rig — surfaced by the operator reading a seat's log.** There is no attention kind
for "a seat is looking for a worktree that the lifecycle legitimately retired", and there is no signal in
`worktree audit` that says *"`item-3035` was retired on completion; its branch is `scribe-item-3035 @
f450cdd`, relocated to `../pi-opendurig.worktrees/` / removed"*. The seat's only instrument was
`git worktree list | grep`, which reports absence without saying whether absence is expected.

## Resolution

**No repair needed** — verified read-only this session:

```bash
git worktree list | grep -i 3035                      # (empty) — no item-3035 worktree, by design
git rev-parse --short scribe-item-3035                # f450cdd — the branch survived
git merge-base --is-ancestor scribe-item-3035 main    # exit 1 — correctly unlanded
git merge-tree --write-tree main scribe-item-3035     # exit 0 — CLEAN, landable
```

**And no amendment should happen.** The `#3035` landing note's "D113 is reserved" claim is **advisory**;
`#3011`'s own body says *derive the next free number at land time; do NOT hardcode*, and R1b's pre-check is
performed by the **serialized pass** (`#3089`), not by a retroactive branch edit. Correcting the note
belongs in that pass, where `DECISIONS.md` is already the one file being written. Amending a completed
branch to fix advisory prose is strictly worse: it rewrites a tip for no semantic gain.

**Ruling issued to the seat** (via `pm`, `operator-...-worktree-question-2026-10-19-1`):
1. A reaped item worktree is **normal** for a terminal item; the **branch is the durable artifact**.
2. Do **not** amend a completed branch for advisory prose; fold corrections into the pass that owns the file.
3. If a seat genuinely must touch its own completed branch, re-attach — never rebuild:
   `git worktree add ../<name> <seat>-item-<id>` (the branch re-attaches at its existing tip; no commits lost).

## Prevention

- **`docs/WORK-ITEM-LIFECYCLE.md`** — new seat-facing section: *"Your worktree is ephemeral; your branch
  is the artifact"* — the three states (retired-on-done / reaped-while-live = a keep, never force /
  never-created = F12 seat root), plus the re-attach recipe and the **do-not-amend-a-completed-branch** rule.
- **`docs/runbooks/leaked-worktrees.md`** — `## Evidence` entry pointing here, so the delegate runbook
  records that a seat hit this class.
- **`worktree audit` (proposed, `prevention` above)** — report retirement, not just existence: for a
  worktree path that no longer resolves but whose `<seat>-item-<id>` branch exists, emit
  `retired: true, branch: <ref>, tip: <short>`. That converts "the tree is absent" into "the tree was
  retired and your branch is at `f450cdd`" — the sentence the seat needed.
- **The F12 seat root (`#1151`)** is the structural fix: a seat with its own per-item tree never asks this
  question in the ambiguous form.

## Evidence

- `scribe` log (`node cli.mjs log scribe 12`), the two quotes above; the empty probe
  `git worktree list --porcelain | Select-String 'item-3035'`.
- `worktree audit` (`node cli.mjs worktree audit`): no `item-3035` entry; `seatRoots` shows
  `{"name":"scribe","cwd":"C:\\Users\\Alex\\dsh-Projects\\pi-opendurig"}` — i.e. the shared tree.
- Git facts re-verified by the delegate at `main = 8e4f987`: `scribe-item-3035` = `f450cdd`, not an
  ancestor of `main`, `merge-tree` **CLEAN**.
- `docs/BRANCH-AND-WORKTREE-LIFECYCLE.md` §2 (teardown ownership), §3 (the three stages).
- `docs/runbooks/leaked-worktrees.md` — *"the branch ref survives regardless"* + the re-attach recipe that
  lives only there.

## Links

- `docs/WORK-ITEM-LIFECYCLE.md` (the seat-facing rule added by this incident)
- `docs/BRANCH-AND-WORKTREE-LIFECYCLE.md` (the model)
- `docs/runbooks/leaked-worktrees.md` (the delegate procedure)
- Queue: `#3035`, `#3047`, `#3089`, `#3075`
- Related: `docs/incidents/2026-10-17-seat-root-fallback-commit.md` (the F12 root that makes the question
  ambiguous)

## RECURRENCE — same day, the SUB-CASE the fix missed (`impl` on `designer-item-2103`)

*Appended 2026-10-19 per convention 6 (append, never rewrite the original analysis).*

Within the hour, `impl` reported the same question in a harder form:

> "`designer-item-2103` is already checked out in the worktree `item-2103` — so I cannot check it out /
> rebase it in place from my worktree."

**This is the same class, but the §8a rule did not unblock it — and it should not have.** Measured state:
`item-2103` was a worktree at `e4fd338 [designer-item-2103]`, **locked**, holding item `#2103` which is
**`cancelled`** (terminal); the branch is **unmerged and CONFLICTs** with `main` (it needs the R2 rebase +
the `runbooks/README.md` union). So:

1. The seat was not confused about the lifecycle — it correctly identified that a worktree holds the
   branch. **Git refuses to check out or rebase a branch that is checked out in another worktree**, and
   that refusal is the truth, not a misunderstanding.
2. **§8a's advice ("re-attach, never rebuild") is for reaching your OWN branch — it does not free a branch
   someone else's tree holds.** Escalating, as §8a says, turned into a stall: `impl` → `pm` → a landing
   list that no pass could satisfy.
3. **The incident's `worktree audit` "report retirement" proposal (queue `#3123`) would NOT have fixed
   this either** — it is a reporting improvement about a *retired* tree, while this obstruction is a
   *live, locked* tree. The two were conflated in the first write-up; they are separate gaps.

**The actual unblock (lossless, used here): DETACH the holding worktree instead of removing it.**

```bash
git worktree list | grep -E "\[<branch>\]"     # confirm which tree holds it
git -C <path> switch --detach                  # frees the BRANCH; every file stays where it is
git branch | grep <branch>                     # no leading '+' => no longer checked out anywhere
```

This is strictly better than `worktree remove` for this case: `remove` refuses on untracked files (this
tree held `probe.txt` + `selfdev.sqlite.broker.inbox.out/`), and it also destroys scratch a seat may still
want. `switch --detach` frees the branch and preserves the tree, the untracked files and the lock. Verified
after the detach: worktree still at `e4fd338` as `(detached HEAD)`, `probe.txt` and the inbox dir intact,
and `designer-item-2103` free for `impl`'s rebase.

**Why the prune pass left it:** `item-2103` was in the `locked` bucket, so `branch-cleanup.md` step 5 says
KEEP — correct for reclaiming disk, wrong for *unblocking a landing*, because a locked worktree over a
terminal item's unlanded branch is a deadlock-shaped pair: the branch cannot be rebased (held), and the
worktree will not be reaped (locked), and nothing in `attention` fires on it.

**Prevention (this is the part that needs a queue item, not a doc):** a `check`/attention rule —
**"locked worktree over a TERMINAL item whose branch is UNMERGED"** → surface it, because it is a landing
blocker that presents as healthy. Until then: at the start of every landing pass, run
`git worktree list` and cross-reference the LOCKED set against the queue's terminal items, then detach any
terminal-item tree that holds an unmerged branch.

## ROOT CAUSE IN CODE (found 2026-10-20, after both write-ups — this is the part that needs a fix)

Neither the original analysis nor the RECURRENCE above named the mechanism. Reading `src/worktree.mjs`
after the operator asked "could we update `prepare_workspace` to do that?" found it:

```js
// src/worktree.mjs:566-568 — the PATH is keyed by ITEM, the BRANCH by SEAT
const worktreePath = join(worktreeRoot, `item-${itemId}`);
const branch = seatName ? `${seatName}-${itemLabel}` : itemLabel;

// :602 → :278 — on REUSE, whenever the branch differs, unconditionally:
await run("git", ["-C", wtNorm, "checkout", "-B", branch]);
```

**Two consequences, both silent:**

1. **A second seat preparing the same item STEALS the first seat's worktree.** `item-<id>` already exists
   (designer's, on `designer-item-<id>`); the caller computes `impl-item-<id>`; `current !== branch`; so
   `checkout -B` runs **inside designer's tree**, moving its working tree onto another branch. The `#2412`
   guard (`validateWorktreeIdentity`) does not catch this: that guard rejects a leftover DIRECTORY that is
   not a worktree, while this is a perfectly valid worktree belonging to someone else.
2. **Nothing ever asks who holds the BRANCH that is needed.** So a seat asked to rebase an existing item
   branch gets git's `already checked out in item-<id>` and has **no in-product move** — which is precisely
   how `impl` was blocked on `designer-item-2103`, and why the workaround was to re-cut the content on a new
   branch (`impl-item-2797 @2828ad4`) rather than rebase the original.

**Registered as `#3174`** (holder resolution + three refusals + a failing-first demo) with **`#3175`** for
`lead`, because the deeper fix — path keyed by item vs branch keyed by seat means **two seats can never work
one item** — is a WORKTREE NAMING change (D110 territory) and must not be decided by the implementer.

**Sequence note for whoever reads this:** the delegate unblocked the live case by hand
(`git -C item-2103 switch --detach`). That hand step is the tell: when a human has to run git to make a
seat's landing work, the seam belongs in the tool — which is exactly what `#3174` asks for.
