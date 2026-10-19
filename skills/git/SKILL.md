---
name: git
description: Execute git operations non-interactively. Use for commits, merges, rebases, amends, and any git command in agent or automation contexts. Do not use for interactive workflows, editor configuration, or GUI tools.
---

# Git — Non-Interactive Practice Layer

This skill carries the exact commands and constraints from D109 (non-interactive agent git).
It is the durable practice layer; the environment fix is D109's seat/broker/serve-noroot surface.

## Environment prerequisites

The following variables **must** be set before any git command runs. They are enforced at the
`NodeExecutionEnv` level in `makeSeatEnv` (D109) and must not be overridden per-command.

| Variable | Value | Purpose |
|---|---|---|
| `GIT_EDITOR` | `:` | Prevents `git rebase -i`, `git commit --amend`, and other operations that invoke an editor |
| `GIT_SEQUENCE_EDITOR` | `:` | Same as above, specifically for rebase todo lists |
| `GIT_TERMINAL_PROMPT` | `0` | Disables credential prompts and interactive auth |
| `GIT_MERGE_AUTOEDIT` | `no` | Prevents merge conflict resolution from opening an editor |
| `GIT_PAGER` | `cat` | Suppresses interactive pagers in `git log`, `git show`, etc. |
| `PAGER` | `cat` | Fallback pager suppression |

A bare `git commit` without `-m` or `-F` is a **defect** — it will hang waiting for an editor
that must never appear.

## Exact commands

### Commits

```
git add <paths>
git commit -m "conventional: brief description"
```

Use `-F <file>` when the message is long or structured. Never omit `-m` or `-F`.

### Amend

```
git add <paths>
git commit --amend --no-edit
```

The `--no-edit` flag preserves the existing message without invoking an editor.

### Merges

```
git merge --no-edit <branch>
```

The `--no-edit` flag suppresses the merge commit message editor. Resolve conflicts manually
with `git add <resolved-paths>` before committing if `--no-edit` is not used.

### Rebases

```
git rebase --no-edit <branch>
```

The `--no-edit` flag suppresses the rebase. For interactive rebase, use `GIT_SEQUENCE_EDITOR=:`
to auto-accept the todo list.

### Status and diff

```
git status --porcelain
git diff --cached
git diff
```

Use `--porcelain` for machine-parseable status output.

## Defect rules

1. **No bare `git commit`** — always supply `-m` or `-F`.
2. **No `git rebase -i`** — use `--no-edit` or `GIT_SEQUENCE_EDITOR=:`.
3. **No `git merge --no-ff` without `--no-edit`** — the merge message editor will hang.
4. **No `git config --global`** — configuration belongs in the repository or environment, not globally.
5. **No credential prompts** — `GIT_TERMINAL_PROMPT=0` must be set; use token-based auth.

## Verification

After any git operation, verify the result:

```
git status --porcelain   # should show expected state only
git log --oneline -3     # confirm the commit landed
```

If `git status` shows unexpected changes, the operation did not complete as intended.
