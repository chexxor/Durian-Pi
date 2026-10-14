# Branch audit — 2026-10-14 (operator's delegate)

**Purpose.** Decide which of the seven pre-split snapshot branches are in use, what each
contains, which backlog items they relate to, and which still hold work that must be finished
and applied to `main`. Written so the remaining action can be taken later without re-deriving it.

**Method.** Read-only `git` only: `branch -a -vv`, `worktree list`, `ls-tree`, `cat-file`,
`diff <branch>^..<branch>`, `grep <ref>`, and `comm` over `ls-tree` output. Nothing was checked
out, reset, restored, or merged. The one deletion performed is recorded below.

**UPDATE (same session, executed):** the recommended action was carried out. The lost
`demo/pitui.test.mjs` was created as queue item **#339** (routed by `pm` to `impl`, sequenced above
TUI C1 #333), landed by impl, and verified by the delegate (`node demo/pitui.test.mjs` → exit 0;
full suite 56/57, only the pre-existing `starter.test.mjs` failure). The local `pi-rebase` branch was
then **deleted** (origin retains it as backup until the working tree is committed). No tracked content
from `pi-rebase` remains absent from the tree.

## Repo state

- `HEAD` / `main` = **`b27955b`** "docs(durig): session truth-up and shared-tree safety research".
  This is where the recovered tranche (#307–#312) was committed after it was recovered onto the
  working tree.
- `origin/main` = **`762d95f`** — local `main` is ahead and **unpushed** (operator holds push).
- **Only `main` has a working tree** (`git worktree list` → one entry). None of the snapshot
  branches is checked out; they are safety snapshots taken at the opendurig split
  (`2026-10-14 02:07–02:08`, message `wip(durig): … working-tree snapshot before the opendurig
  split`). Every one is also present under `origin/`.

> **Never `git merge` these branches.** Each sits on an old base and is 15–57 commits behind
> `main`, so a merge would revert main's newer files. Almost all of the recovered content was
> later adapted onto `main` by hand. Treat the branches as read-only archives; recover file-by-file.

## Inventory and disposition

| Branch (tip) | Own change (tip commit) | Related item(s) | Status vs `main` | Action |
|---|---|---|---|---|
| `selfdev-f12` (`5ea01c8`) | F12 seat-root fail-closed guard (`openHarness({enforceSeatRoot})`, `normalizePath`) + `demo/seatroot.test.mjs` | F12 / #261 family | **Fully integrated** (`enforceSeatRoot` in `main:cli.mjs`; demo blob identical) | **Local branch deleted** |
| `selfdev-item10` (`11f91e1`) | `admitted_not_started` strand notice, `resume`/`reset`/`stop`, `src/config.mjs`, `src/attention.mjs` | 37/37a/37b, #110 | **Fully integrated** (all five new demos blob-identical to `main`; `src/config.mjs` identical; notice present) | **Local branch deleted** |
| `selfdev-stall` (`5eebd7b`) | Stalled-claim re-wake in `selectWakes`/`driveOnce` + `demo/stalledclaim.test.mjs` | F29 / #275 | **Fully integrated** (`hasStalledClaim`/`stoppedConvIds` in `main:src/driver.mjs`; demo identical) | **Local branch deleted** |
| `selfdev-110` (`a9fa491`) | *Reverts* `peek_queue` from bounded to unbounded | #110 area | **Superseded regression** — `main` has the bounded #312 version + `thinResultText` | **Local branch deleted** |
| `item-148` (`05f1990`) | `src/modelswitch.mjs` (model-change → context reset, #148/#154) **and** #43(a) integer `reasoning_effort` map + `demo/reasoningeffort.test.mjs` | #148, #154, #43(a) | **Not integrated** — `main` has neither file, and `THINKING_LEVEL_MAP` in `main` is still `{ off: "none" }` | **KEEP — operator has PAUSED #148** (#180); needs a ruling |
| `selfdev-borrow` (`8e760cc`) | Ratcheting task tier (`RATCHET_TIERS`, raise-guard in `send_work`) + `demo/ratchet.test.mjs` | #60–#63 (agent-fleet RANK 2–5) | **Not integrated** (the thin-context half *was* adapted into `main`; ratchet was not) | **KEEP — deferred backlog #60; unfinished WIP** |
| `pi-rebase` (`3bf61b1`) | The recovered tranche **+** `demo/pitui.test.mjs` | #307–#312, TUI | **Fully recovered** — the lost proof landed via **#339 (DONE)** and verifies green | **Local branch deleted** (origin retains) |

Deletion performed (origin retains every branch, so this is recoverable):
`git branch -D selfdev-f12 selfdev-item10 selfdev-stall selfdev-110 pi-rebase`.

## The one dangling artifact: `demo/pitui.test.mjs`

- It is the failing-first **proof for #192 (TUI-1 dep)**, which is already `done` (pm→devtools):
  the dependency `@earendil-works/pi-tui@^1.1.0` and its lockfile entry **are on `main`**
  (commit `789ead6`), but the proof file was lost in the split. `main` has no
  `demo/pitui.test.mjs` even though `@earendil-works/pi-tui` is declared and installed.
- The branch copy is preserved even locally now:
  blob **`36d974174cc85e9bc18b956872ce07b34fa8daaa`** on `pi-rebase`
  (`git show pi-rebase:demo/pitui.test.mjs`). A scratch copy is at
  `.spike/delegate/pitui.test.mjs`.
- It is self-contained: imports only `node:assert` and `@earendil-works/pi-tui`, no relative
  imports and no wiring into any UI.
- **Verified green against current `main`** (delegate ran it): `node .spike/delegate/pitui.test.mjs`
  → `PITUI TEST PASS`, **exit 0**.

**With that one file landed, `pi-rebase` holds zero tracked content absent from `main`** (its
remaining unique files are all under `.spike/`, which is scratch and gitignored in the working
tree), so the branch becomes deletable.

## Recommended action (documented, not yet executed)

Recover the lost proof onto the tree, have it independently verified, then delete `pi-rebase`.

- **Concern:** one — recover the lost #192 proof artifact.
- **Owner:** a file-capable seat. Recommend **`impl`** (owns the TUI tranche; file-capable);
  partner-check **`qa`**. Alternative owner `devtools` (it owned #192). Do **not** route to a
  coordinator (`pm`/`lead` cannot read files — #156).
- **Priority:** place **ahead of TUI C1 (#333)**. It is a prerequisite of the TUI story and is
  **gate-independent** (it does not wait on lead #201, unlike C1–C3), so it can run now.
- **Route via `pm`** (the team's routing owner). Ready-to-send body: `.durig/pitui-recovery.md`.

Exact land + verify (what the seat/verifier should run):

```bash
git show pi-rebase:demo/pitui.test.mjs > demo/pitui.test.mjs
node --check demo/pitui.test.mjs        # expect exit 0
node demo/pitui.test.mjs                # expect exit 0, "PITUI TEST PASS"
```

BASELINE for the full suite is **55/56** — `demo/starter.test.mjs` fails on pre-existing LF/CRLF
drift (#328/#291 family), unchanged by this artifact.

### Later: send the intent

```bash
DURIG_SEAT_ROOT=C:/Users/Alex/dsh-Projects/pi-opendurig DURIG_DB=./selfdev.sqlite \
  node cli.mjs send pm --body-file .durig/pitui-recovery.md
```

(One write process at a time; `send` blocks until the generation settles — background it or use
`run --max-duration`.)

## Open questions / risks

1. **`item-148` needs your ruling.** It bundles two concerns: the #148/#154 model-change reset
   and the #43(a) reasoning-effort map. `main` demonstrably still carries the pre-fix
   `THINKING_LEVEL_MAP = { off: "none" }`, so #43(a) is genuinely missing. But #180 explicitly
   paused #148 ("keep its worktree untouched"), so this must not be applied until you say so.
2. **`selfdev-borrow` ratchet** is unfinished WIP for deferred #60. Do not apply until that item
   starts; when it does, prefer implementing it fresh against current `main` rather than merging
   the old snapshot.
3. **Deleting local branches does not delete origin copies**; `origin/selfdev-*` and
   `origin/pi-rebase` remain. If you also want the origin branches pruned, that is a push-side
   action you hold, not the delegate.
4. **`demo/pitui.test.mjs` is not committed by this audit** — it is only extracted to `.spike/`
   scratch pending the action above.
