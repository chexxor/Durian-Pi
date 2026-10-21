> **D103 rename (2026-10-18):** this record predates the product rebrand `durig` → `durian-pi`; it keeps the old name so the audit trail stays truthful.

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

## 7. Operator-run procedure (refreshed 2026-10-21; script: `scripts/rename-workspace.ps1`)

> §1–§6 are kept as the 2026-10-18 record. Since then: the GitHub repo is already `Durian-Pi.git`
> (so §3 step 5 is done), the product was renamed `durig` → `durian-pi` (D103), and the worktree count
> dropped from 140 to 53. This section supersedes the numbers and steps.

### 7.1 What still carries the absolute path (measured 2026-10-21)

| Carrier | Now | After the move |
|---|---|---|
| `git worktree list` | 53 entries / 52 admin dirs in `.git/worktrees` (32 in `../pi-opendurig.worktrees`, 14 under the root, 6 in `%TEMP%`), 11 `locked` | needs `git worktree repair` |
| `../pi-opendurig.worktrees` (3.3 GB), `../pi-opendurig.land` | exist | move with the rename |
| `rig.selfdev.json` | 1 live pointer (`.../pi-opendurig/item-2801`) | rewrite |
| `selfdev.sqlite` | ~22k `entries` + 1.4k `document_revisions` rows, 1 **running** `pi.tool` task (#196379, `item-4326`) | historical rows stay; the stale task/locks must be cleared first |
| `~/.pi/agent/trust.json` | key `C:\Users\Alex\dsh-Projects\pi-opendurig` | re-key (else re-trust prompt) |
| `~/.pi/agent/sessions/--C--…-pi-opendurig--/` | `pi --continue` history | rename the dir |
| `~/.pi/agent/pi-warden/prefs/f84fcca40514.json` | key = `sha256(full cwd)`; this project's standing lessons/holds | rename to `sha256(new cwd)` |
| tracked text | 17 files (`git grep -l pi-opendurig`) | live pointers rewritten by scribe; historical records annotated, not erased |

### 7.2 Preconditions (all must hold; the script checks each)

1. **Nothing holds the tree**: no pi session, no `node ui.mjs`/`npm run ui`, no broker, no seat, no
   `cli.mjs` `serve|run|send|log --follow|watch`. This is what blocks a rename *from inside* an agent
   session — Windows refuses to rename a directory that is any process's cwd.
2. Broker stopped and its bookkeeping settled: `.broker.json` pid dead, no `.genlock.*`.
3. Main worktree committed (or the operator accepts the dirty list). Never discard work.
4. Operator window declared; script run from a plain terminal whose cwd is `C:\Users\Alex\dsh-Projects`
   (the parent), **not** inside the repo.

### 7.3 Run

```powershell
# inspect: prints preflight, blockers, and the full plan; changes nothing
powershell -NoProfile -File C:\Users\Alex\dsh-Projects\pi-opendurig\scripts\rename-workspace.ps1

# execute (operator window only)
powershell -NoProfile -File C:\Users\Alex\dsh-Projects\pi-opendurig\scripts\rename-workspace.ps1 -Execute
```

Flags: `-ParentDir` / `-OldName` / `-NewName` (defaults are this workspace), `-AllowDirty`,
`-IgnoreLocks`, `-IgnoreProcesses` (false-positive override — do not use to paper over a live holder),
`-SkipBackup`, `-PiAgentDir` (non-standard pi installs).

What it does, in order: preflight → backup (`durian-pi.pre-rename-<ts>/`: store + wal/shm, broker json,
`rig.selfdev.json`, worktree inventory, HEAD, status) → archive stale broker marker/genlocks/inbox dirs →
move the three directories → `git worktree repair <all worktree paths>` (mapped to new locations) →
verify `git worktree list` is clean → rewrite `rig.selfdev.json` → rename session dir + warden prefs,
re-key `trust.json` → run `node cli.mjs status` → list tracked files that still say the old name.

Deliberately **not** done by the script: no doc rewriting, no `git worktree prune`, no ref deletion, no
`git push`, no commit, no merge into a seat worktree. Doc edits are the scribe/operator call
(live pointers vs historical records).

### 7.4 Rollback

Move the three directories back (`durian-pi*` → `pi-opendurig*`), then re-run the script with the names
swapped (`-OldName durian-pi -NewName pi-opendurig`): it repairs links, re-keys pi state back, and does
not re-copy the backup. The backup dir is the store snapshot from before the move.

### 7.5 Verification gates after the rename

```
git worktree list                 # no "(error)", no stale path, count unchanged (53)
git status --short -- .           # same dirt as before the move, nothing lost
DURIG_DB=./selfdev.sqlite node cli.mjs status
node scripts/suite.mjs            # 205 demos; measured 2026-10-21: pass=201 fail=4
npm run test:tui                  # 36/36 files
```

`npm run demo` (`demo/offline.mjs`) is a two-seat smoke demo, not the suite. The four suite
failures measured on 2026-10-21 (`broker-one-connection`, `cli-broker-refuse`, `pitui`,
`seat-instruction-encoding`) are the pre-existing set named in `docs/NEXT.md`, unrelated to a rename;
re-run the gates after the move and compare against that set, not against zero.

### 7.6 Test evidence for the script (2026-10-21, throwaway repos in `%TEMP%`)

Reproducible harness: `node .spike/rename-workspace-e2e.mjs` (gitignored) builds a throwaway repo whose
worktrees sit in all three positions, seeds fake pi state, runs the script with `-Execute`, then asserts
24 invariants and cleans up. Measured 2026-10-21: **24/24 assertions pass**.
It also validated: directory + sibling move; 3 worktrees
(inside root, inside sibling, external in `%TEMP%`) re-linked — admin `gitdir` files and the external
worktree's `.git` file both repointed, `git worktree list` clean; `rig.selfdev.json` rewritten for both
`C:/` and `C:\` spellings with **no BOM and no line-ending change**; session dir renamed; warden prefs
renamed (`sha256` keys confirmed); `trust.json` re-keyed; resume path (old dir already gone) repairs
instead of blocking; a dirty tree is refused without `-AllowDirty`. Not sandbox-tested: the real
broker/inbox archiving (paths and guards reviewed, no broker state in a throwaway repo).
