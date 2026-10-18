# Project rename: `pi-opendurig` → `durian-pi` (operator request)

**Status:** blocked on an operator-declared quiesced window; **not executed**. Delegate analysis, 2026-10-18.
**Request:** the operator asked that the project name change from `pi-opendurig` to `durian-pi`.

## 1. What actually carries the name

| Thing | Current | Notes |
|---|---|---|
| **Product name** | `durig` | `README.md` title, `package.json` `name`, nearly every doc. **Do not change** — the request names `pi-opendurig`, not `durig`. |
| **GitHub repository** | `https://github.com/chexxor/Pi-OpenDurig.git` | `git remote -v`. Renamed via GitHub settings (operator). |
| **Local directory** | `C:/Users/Alex/dsh-Projects/pi-opendurig` | `git rev-parse --show-toplevel`. |
| **Sibling archive dirs** | `../pi-opendurig.worktrees` (6.3 GB), `../pi-opendurig.land` | On disk next to the repo. |
| **Tracked path references** | 17 lines in 8 files | §4. |

## 2. Why this cannot be done inside a live agent session

The evidence is the blocker, not caution:

- **140 registered worktrees** (`git worktree list`): **62 under the repo root** (`item-*`), **78 elsewhere**
  (mostly `%TEMP%`, which point at the repo by absolute path).
- **139 admin dirs** in `.git/worktrees`, each with an absolute `gitdir` path.
- **Two sibling directories** named after the old repo, one of them 6.3 GB and itself registered as
  worktrees.
- **Live processes with the repo as cwd**: the `durig ui` viewer (`npm run ui` / `node ui.mjs`,
  observed pids 1020/2228) and this delegate session. On Windows a directory cannot be renamed while
  any process holds it as cwd.
- **Renaming the string in docs without moving the directory/archive would make the docs false**:
  `docs/DECISIONS.md`, `docs/NEXT.md`, and `docs/runbooks/leaked-worktrees.md` point at the real
  on-disk `../pi-opendurig.worktrees/`.

A partial rename is therefore worse than none. The rename is one atomic operation, run **from outside**
the repository.

## 3. Safe procedure (execute in a declared window; owner `devtools`, verifier delegate/`qa`)

**Preconditions**
1. Broker down and rig paused (no `selfdev.sqlite.broker.json`, no `.genlock.*`).
2. **No** process has the repo as cwd: `cli.mjs serve|run|send|log --follow|watch`, `npm run ui`,
   `node ui.mjs`, and any seat/agent shell. There must be no agent harness inside the tree (run this
   from a plain terminal whose cwd is the parent, `C:/Users/Alex/dsh-Projects`).
3. Tracked work committed (never discard uncommitted work). Back up the store: copy `selfdev.sqlite`
   plus `-wal`/`-shm` to a timestamped backup.
4. Confirm the GitHub repo rename is done (or do it after step 6 and before step 7).

**Commands** (from `C:/Users/Alex/dsh-Projects`)
1. `mv pi-opendurig durian-pi` (or `Move-Item`, with the terminal cwd outside the tree).
2. `mv pi-opendurig.worktrees durian-pi.worktrees` and `mv pi-opendurig.land durian-pi.land`.
3. From the new root: `git worktree repair` (repairs linked worktrees after the main tree moved), then
   repair the moved linked worktrees explicitly from the main tree:
   `git worktree repair <new-path>…` for each external worktree that moved. **Then**
   `git worktree list` must list every worktree without `(error)` / stale entries.
4. Prune dead registrations cautiously: `git worktree prune` **only** after step 3 resolves, and never
   `--force` a dirty or registered worktree.
5. `git remote set-url origin https://github.com/chexxor/durian-pi.git` (after the GitHub rename).
6. Update the tracked references (§4).
7. Verify: `git status` clean; `node cli.mjs status` reads the store; `npm run test:tui` green; full
   `demo/*.test.mjs` green; `npm run ui` boots.

**Do not**: rename while any process owns the tree; `-D` a ref; force a dirty worktree; delete a
snapshot (`item-148`, `selfdev-borrow`); run the sequence while the broker drives.

## 4. Tracked references to update (17 lines, 8 files)

```
demo/fixtures/degenerate-text/positive/impl-emit-loop-36408.txt   (1)
demo/secrets.test.mjs                                             (1)
docs/BRANCH-AUDIT-2026-10-14.md                                   (1)
docs/DECISIONS.md                                                 (1)
docs/NEXT.md                                                      (7)
docs/incidents/2026-10-18-broker-dormant-stalled.md               (1)
docs/runbooks/leaked-worktrees.md                                 (2)
reconcile-538/README.md                                           (3)
```

**Decision needed — historical records.** The rename touches *historical* documents
(`BRANCH-AUDIT-2026-10-14.md`, `docs/incidents/…`, the older part of `DECISIONS.md`, `reconcile-538/`)
that describe events at the old path. Recommended treatment: **rewrite live pointers** (`NEXT.md`,
`runbooks/`, `demo/`, `reconcile-538/`) and **annotate, not erase, historical records** (append
"*named `pi-opendurig` until the 2026-10-18 rename*") so the audit trail stays truthful. The
delegate should not decide this alone — it is an operator/scribe call.

## 5. What stays the same

- The product name `durig`, the CLI (`cli.mjs`), the store (`selfdev.sqlite`) and its documents.
- `package.json` `name` stays `durig` unless the operator separately wants the npm/package identity
  changed (not requested here).
- No push/publish: the remote URL change is local; the GitHub rename is the operator's action.

## 6. Delegate position

The rename is **not executed** because the preconditions in §3 cannot hold while this agent session
(and `durig ui`) own the tree. A spooled intent asks `pm` to register the housekeeping item and route
it to `devtools`; the delegate will verify the post-rename invariants once the operator declares the
window.
