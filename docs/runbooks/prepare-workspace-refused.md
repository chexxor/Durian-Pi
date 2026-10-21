---
runbook: prepare-workspace-refused
symptom: "prepare_workspace returned PREPARE_WORKSPACE_ERROR, or refused with 'refusing to create a worktree on branch'"
writes: false
precondition: "read-only"        # the refusal is a read of the tree; the remedies below are the writing part
last_verified: 2026-10-21
verified_by: impl
evidence: "impl-item-3807 (the base-not-honoured refusal); demo/prepare-workspace-create-base.test.mjs"
check_rule: null
---

# prepare_workspace refused

## When to use

`prepare_workspace` came back with `PREPARE_WORKSPACE_ERROR: ...` or a `refusing to ...` message, and
you have no worktree. Six refusals exist; each names its own cause, so read the message first and
match it here.

| The message says | Cause | Where |
|---|---|---|
| `no claimed item #N is yours` | you called it before `claim_work`, or for an item you do not hold | src/seattools.mjs |
| `is a leftover directory, not a registered git worktree` | a plain `item-<id>` directory sits at the path | #2412 |
| `branch <b> is checked out by another worktree` | a LIVE item's branch is held elsewhere; it will not be stolen | #3174 |
| `is a valid worktree on branch <b> (another seat's item branch)` | the reuse PATH holds another seat's working state | #3174 |
| `the branch ALREADY EXISTS at <sha> and you asked to fork from <ref>` | an explicit `base=` cannot be honoured on the create path | #3807 |
| `you asked to fork from <ref>, which does not resolve to a commit here` | the `base=` ref does not exist | #3807 |

`npm ci --prefer-offline ... ETARGET notarget` is a DIFFERENT failure (the dependency install, not a
refusal) and has its own runbook: [prepare-workspace-etarget.md](prepare-workspace-etarget.md).

## Impact

You have no isolated tree, so you cannot do the item's work. The dangerous alternative is to work in
the shared checkout instead: that is another seat's tree, and the constitution forbids it. Never
"fix" a refusal by editing the shared tree, and never re-run the call hoping for a different answer.

The `ALREADY EXISTS` refusal is the one that used to be SILENT. Before #3807 the call succeeded,
left the worktree at the leftover branch's tip instead of the base you asked for, and reported
`Forked from base ref <base> (not HEAD)`. A seat that trusted that message certified a tree it was
not standing on. The refusal exists so the wrong tree cannot be handed out at all.

## Preconditions

Read-only. The remedies below include one writing step (deleting or landing the leftover branch);
that step needs the operator's branch authority, so route it rather than doing it yourself.

## Diagnose (read-only)

Set the repo once, then read the three facts the refusals are about: which branches exist, where
their tips are, and which worktrees hold them.

```bash
REPO=<path to the repo>
BR=<seat>-item-<id>          # the branch prepare_workspace wanted
git -C "$REPO" rev-parse --verify "refs/heads/$BR"          # does the branch exist, and at what sha
git -C "$REPO" rev-parse --verify "<base>^{commit}"          # does the requested base resolve
git -C "$REPO" worktree list                                 # who holds the branch / is the path registered
```

On Windows PowerShell the same three reads:

```powershell
$REPO = "<path to the repo>"; $BR = "<seat>-item-<id>"
git -C $REPO rev-parse --verify "refs/heads/$BR"
git -C $REPO rev-parse --verify "<base>^{commit}"
git -C $REPO worktree list
```

If the two shas differ, the `ALREADY EXISTS` refusal is correct: attaching that branch would give you
the first sha, not the base you asked for.

## Do

1. `no claimed item is yours`: call `claim_work` first, then `prepare_workspace` with no `itemId` (it
   defaults to your most recently claimed item).
2. `leftover directory, not a registered git worktree`: `git -C "$REPO" worktree list` to confirm
   nothing is registered at the path, then remove ONLY that directory and retry. If it is registered,
   use [leaked-worktrees.md](leaked-worktrees.md) instead; do not delete a registered worktree's files.
3. `checked out by another worktree` / `another seat's item branch`: the holder's item must reach a
   TERMINAL status (`done`/`cancelled`) before the branch can be freed, and freeing it is a `switch
   --detach` on the holder (lossless), which the operator runs. Ask with `defer_work`; do not detach
   another seat's tree yourself.
4. `the branch ALREADY EXISTS at <sha>`: you asked for `base=<ref>` and the item branch already sits
   somewhere else. Pick one, deliberately:
   - you do NOT need that base: call `prepare_workspace` again WITHOUT `base`. The existing branch is
     re-attached as it is and reported as `attached-existing` (not `created`).
   - you DO need that base: prepare a DIFFERENT item (a fresh branch is created from the base), or
     have the operator land/delete the leftover branch and retry.
   - never re-point the leftover branch by force: it may carry commits, and rewinding it is refused
     to every seat by design.
5. `which does not resolve to a commit here`: the `base=` value is not a branch, tag or commit in this
   repo. Re-read it (`git -C "$REPO" branch --all`), or drop `base` to accept the branch as it is.

## Verify

The refusal contract is pinned by a demo; run it, and expect exit 0:

```bash
node demo/prepare-workspace-create-base.test.mjs; echo "exit=$?"
```

It asserts the four facts that matter: an unhonourable base is REFUSED with both shas named and
nothing created, a no-base call still re-attaches the leftover branch and reports
`attached-existing`, an explicit base equal to the branch tip is attached and TRUE, and a fresh item
branch is still created from the base (#1456's guarantee).

## If it fails

The demo red means the refusal contract changed: a base is being silently ignored again, or a
leftover branch is being reported as `created`. Stop and route it to impl; do not work around it by
editing in the shared tree. If `prepare_workspace` succeeds but `git -C <worktree> rev-parse HEAD`
disagrees with the base you asked for, that is the same defect from the other side: report it with
both shas, do not proceed.

## Escalate to

impl (the worktree/prepare path). The operator, for anything that needs branch authority: detaching
a holder, landing or deleting a leftover branch.

## Evidence

impl-item-3807. Reproduced on main before the fix: `created: true`, worktree HEAD at the leftover
tip, response line `Forked from base ref <base> (not HEAD)`. Last verified 2026-10-20 by impl.
