# Incident — the item worktrees, item branches and `.spike` scratch vanished from the Linux workspace

**Date:** 2026-10-26 (one Linux delegate session). **Status: open — needs the operator.**
**Severity:** unmerged work may be unrecoverable on this machine; the rig's own scratch history is gone.

## What was measured, twice, in one session

At the start of the session (and as recorded in the `2026-10-26T22:15Z` pointer block):

```
git worktree list            → 13 entries (main + 12 `worktrees/item-<id>`)
git branch --list 'item-*'   → 12 branches (1454 2801 3454 3471 3544 3617 3676 3763 3910 4514 4635 4785)
root of the checkout         → two extra directories, `item-3311` and `item-4785`
ls .spike | wc -l            → 436
```

Later in the same session, after only the commands listed below:

```
git worktree list            → 1 (main only)          [.spike/ps.json]
git branch                   → main only
worktrees/                   → No such file or directory
item-3311 / item-4785        → No such file or directory
ls .spike | wc -l            → 16
```

`.spike` entries created **earlier in this same session** (`clockin.txt`, `queue-summary.txt`,
`status.json`, `seatguard.test.mjs`, `package.json.linux.json`, `item-worktrees-626.txt`,
`stray-worktrees.txt`) are gone; entries created after the event survive. So the sweep is bracketed
in time, not inferred.

## What is recoverable and what is not

- `git fsck --unreachable` → **0 unreachable commits.** The commits the swept branches pointed at are
  not in this clone's object store at all: `git cat-file -t` fails for `500969f42` (item-4785's seatguard
  set-matching fix, cited in the pointer as **not merged**), `9f624ff4`, `8990303` (item-2801), `dd258`,
  `371f6be`. (`ca7c19c`, `037629dd5`, `c304976`, `b8fdcc729` do exist — those landed.)
- `git branch -r` → only `origin/item-148`; GitHub does not hold the swept branches.
- Of the 12 swept branches, 11 correspond to terminal queue rows (`done`/`cancelled`). **`#3454` is still
  `held`** and its branch/worktree is gone.
- `src/seatguard.mjs` on `main` has no set-matching/`counted` reason object → item-4785's fix is **not on
  main**, consistent with the pointer's "not merged" note, and its commit is not in this clone.

So: on this machine the branch-local work of at least #3454 and #4785 is **not reachable**, and the only
known copies are on the Windows rig (`C:\Users\Alex\dsh-Projects\pi-opendurig`, still named as the seat
`cwd` inside `selfdev.sqlite`) and in the pre-sweep `.spike` artifacts.

## The commands run inside the window

```
node scripts/sync-pi.mjs --sync --link        # rsync vendor/pi-main + link the pin (pnpm install first
                                              # deletes the 9 existing symlinks — observed live)
node cli.mjs up rig.selfdev.json --refresh --dry-run   # read-only; showed ONLY model + cwd changes
node cli.mjs up rig.selfdev.json --refresh             # WRITING verb
node cli.mjs check rig.selfdev.json
node cli.mjs send scribe --body-file …                 # the DEPRECATED second-owner writing harness
node cli.mjs queue / status / ps                       # reads
```

## Most probable mechanism (hypothesis, not observed in code)

`AGENTS.md` states the rule the harness implements: *"Use `git worktree list --porcelain` (not `find`,
which reads stale submodule metadata) and clean up leftover scratch before `up`."* A workspace copied
from another machine carries `worktrees/item-*/.git` pointer files whose target gitdir does not exist
here, so **`git worktree list` does not list them** — they are indistinguishable from leftover scratch.
Under that rule, `up`'s cleanup removing them (and `.spike`) is *documented behaviour meeting an
imported workspace*, which is why nothing looked wrong at the time. I did not watch the deleting code
run, and the `--refresh --dry-run` immediately before the writing `up` reported no removals — which is
why this was not caught before it happened. Treat the mechanism as unconfirmed; the *state change* is
measured above.

## What this exposes as a defect (independent of who caused it)

1. A destructive verb (`up`, and `send`'s second-owner harness) can delete directories, refs and scratch
   **with no audit record and no dry-run preview of the removals**. This is exactly gap #6 of
   `docs/reviews/zero-trust-zero-agent-research.md` — "nothing queryable: which seat was refused, under
   what rule, when" — reached from the destructive side: the rig destroyed artifacts and left no row.
2. `up --refresh --dry-run` claims to be read-only and "names the resets before they happen", but it did
   **not** name the removals it was about to make. A preview that omits the destructive part is worse than
   none, because it buys confidence.
3. The workspace crossed machines with worktrees whose registrations do not resolve, and nothing in the
   clock-in ritual detects that. `scripts/clockin.mjs` reports `worktrees: 13` from the *store* and never
   compares it to `git worktree list`.
4. My own pointer discipline failed too: the `2026-10-26T22:15Z` block was overwritten rather than cut
   verbatim to `docs/NEXT-ARCHIVE.md`. It is now **restored verbatim** (77 lines, sha256 `1b9bf18572c8`,
   appended at the archive tail and asserted by an endswith check). The reason nobody caught it:
   `demo/next-pointer.test.mjs` checks the archive exists, is non-empty, begins with a block, and carries
   old log headings — it never asserts that **every block header ever written to `NEXT.md` still appears
   in the archive**. That is a cheap missing oracle.


## Recovery paths, measured later in the same session

| Path | Result |
|---|---|
| The Windows workspace still on this machine | **absent** — `/mnt/c`, `/c`, `/media` contain nothing matching; `findmnt` lists no `9p`/`drvfs`/`cifs`/`ntfs3` mount; the only sibling of the checkout is `ladybird` |
| `origin` | fetched cleanly; **does not contain them**. Only one `item-*` branch is remote (`origin/item-148`) |
| Dangling objects / reflog | **none** — `git fsck --unreachable` reports 0 unreachable commits and `git cat-file -t` fails for every cited sha, so the objects were pruned, not merely unreferenced |
| The vendored pi tree (`vendor/pi-main/.git`) | the cited shas are not pi commits either — so this is not a mislabelled-upstream artifact |
| The store's own transcript | **the only remaining copy.** 137,368 entries, and pi-durable stores tool results verbatim (entry 52 alone holds a 51 KB `read` result). File contents as they were when a seat read or wrote them are therefore recoverable in principle. That is seat work under an item, not something the delegate should reconstruct by hand. |

And the sweep is smaller than the migration gap it exposed. Scanning every sha-shaped citation in the queue:
**178 distinct shas cited, 90 of them (50.6%) resolve nowhere** — not here, not in `vendor/pi-main/.git`, not
on `origin`. They sit on **240 terminal rows** (`done` 196, `cancelled` 44) and on **14 non-terminal rows**
(#3452 #3506 #3603 #3726 #3743 #3832 #3842 #4378 #4791 #4794 #4799 #4801 …) whose verification evidence a
seat picking them up cannot re-check. The store crossed machines; **the git history did not.** That is now a
runbook (`docs/runbooks/workspace-move.md`, `last_verified: 2026-10-26`) and a check-rule proposal (ROADMAP
**190**), because a rig whose discipline is "re-run what you did" currently cannot re-run half of it.

## What the operator must decide

- Whether to recover the lost branches from the Windows rig (`C:\Users\Alex\dsh-Projects\pi-opendurig`) —
  if #4785's seatguard fix and #3454's branch still exist there, fetch them before anything else ages out.
- Whether a Linux workspace copied from another machine should be treated as **not yet a working rig**:
  no writing verb until `git worktree list`, `git branch`, and `.spike` are inventoried into `.spike/`
  and diffed after each writing verb.
