---
runbook: tracked-files-missing-on-disk
symptom: "`git status` shows tracked DELETIONS nobody made — a whole directory (e.g. scripts/) is empty on disk while the index and HEAD still hold the files"
writes: false                       # the Diagnose and the restore are git-only; the store is untouched
precondition: "none"                # broker may stay UP: no Harness is opened
last_verified: 2026-10-19
verified_by: delegate
evidence: "2026-10-19: 9 tracked files in scripts/ were present in index+HEAD but absent on disk; restored via `git ls-files scripts/ | xargs git checkout-index -f` and proved byte-identical to their blobs; land.mjs + suite.mjs both `node --check` clean"
check_rule: null
---

# Tracked files missing on disk (a whole directory emptied)

## When to use
`git status --short` reports **tracked deletions** that no branch, stash, or seat claim explains — most
often a whole directory (2026-10-19: all nine files in `scripts/`). The tell is the asymmetry:

- the working tree is empty,
- the **index** still lists the files,
- **`HEAD`** still holds their blobs,
- and no commit anywhere deletes them.

That combination means **nothing was ever lost** — the content exists twice (index and `HEAD`). This is
a *re-materialise* problem, not a recovery problem.

## Impact
Whatever imports those files fails to parse, so the tools built on them look broken and the team stalls
(2026-10-19: `scripts/land.mjs` and `scripts/suite.mjs` could not parse, which blocked **every** landing
and the demo suite; the pass stopped rather than guess). It reads like corruption but is pure absence.

## Preconditions
None for the Diagnose or the restore: this is git-only, opens no `Harness`, and never touches the store,
so the broker may keep running. Do **not** reach for `git restore .`, `git checkout -- .`,
`git reset --hard`, or `git clean -fd` — those would discard *other* seats' uncommitted work in the same
shared tree, which is a far larger loss than the one being fixed.

## Diagnose (read-only)
Prove the three-part asymmetry **before** restoring — this is what makes the restore lossless:
```bash
git status --short -- <dir>                 # ' D <path>' lines (deleted in worktree, not staged)
git ls-files <dir>                          # the INDEX still lists them
git ls-tree HEAD <dir>                      # HEAD still holds their blobs
git log --all --diff-filter=D --oneline -- <dir>   # EMPTY => no branch/commit ever deleted them
ls -la <dir>                                # the directory is empty on disk
```
An empty `log --diff-filter=D` is the licence to restore: if a commit *did* delete the files, that
deletion was deliberate and you must not undo it — go read that commit instead.

## Do
1. **Re-materialise from the index**, which is the copy git trusts:
   ```bash
   git ls-files <dir> | tr '\n' '\0' | xargs -0 git checkout-index -f --
   ```
   **`git checkout-index -f -- <dir>` DOES NOT RECURSE a directory** — it fails with
   `<dir> is not in the cache`. It takes FILES, so feed it the `git ls-files` list (or name each path).
2. Clear any stale index stat entries:
   ```bash
   git status --short -- <dir>
   ```
   If a restored file still shows ` M` **and** `git diff -- <path>` is empty, the index's cached
   `stat` is stale, not the content. Confirm, then refresh just those paths:
   ```bash
   git hash-object <path>                    # must equal the index blob sha from `git ls-files -s`
   git add -- <path>                         # then `git diff --cached --stat` MUST be empty
   ```
   An empty staged diff is the proof it is a refresh, not a content change. Never `git add` a whole
   directory here — you would stage other seats' work.

## Verify
```bash
# 1. content is byte-identical to the blobs, ignoring EOL normalisation (core.autocrlf may be true)
git ls-files --eol <dir>                    # 'i/lf  w/crlf' is NORMAL on a CRLF checkout
# 2. the tools that were blocked now parse
node --check <the script that was missing>
# 3. the tree is clean apart from pre-existing untracked scratch
git status --short -- .
```
2026-10-19: all 9 restored files were identical to their blobs after CRLF normalisation,
`node --check scripts/land.mjs` and `scripts/suite.mjs` both exit 0, and `git status` showed only the
pre-existing untracked `.durig-verify-2336/` and `temp-*` dirs.

## If it fails
- **`git checkout-index` says "is not in the cache":** you passed a directory. Pass the file list.
- **`git diff -- <path>` is NOT empty after the restore:** the index and `HEAD` disagree, so the index
  holds a staged change that was never committed. Stop — this is now a real content question about
  someone's staged work; escalate instead of continuing.
- **A file will not restore at all:** check `git ls-files --stage` for a conflicted (non-zero) stage,
  which means the index is mid-merge.
- **`git log --all --diff-filter=D` was NOT empty:** the deletion was committed on purpose. Do not
  restore; read the deleting commit and route the question to `pm`.


## Seat-side variant: the seat's OWN item worktree (2026-10-21)

The shared-tree case stays operator-side (the section below). qa measured twice now: at fe52a41 (before
the 4374 fix) and at 910fac7 (after it):

- git checkout-index -f -a  -> REFUSED, "would change the seat's working tree or HEAD - to test without your change, run the test RED BEFORE the fix, or use a throwaway detached worktree / temp copy (never revert the shared tree)"
- git checkout-index --help  -> REFUSED with the SAME text (a read-only no-op), so the match keys on the command shape, not semantics - re-measured AFTER commit 61d076a (devtools-item-4374: path-aware decision + boundary) landed: the --help CASE SURVIVES (nothing to resolve)
- git restore -- <path>  -> REFUSED with a DIFFERENT text ("would discard uncommitted work") on a CLEAN tree at BOTH tips (`git status --porcelain` 0 lines before each probe): the semantic matcher still refuses the CLASS rather than checking the tree
- git checkout-index -f -- <onefile>  -> REFUSED, same worktree-CHANGE text, at 910fac7: even the targeted one-file materialisation (the exact runbook shape) is unreachable seatside after 4374
- controls, BOTH tips: git help checkout-index, git ls-files, git status, git diff all pass

Net: the runbook verb above is UNREACHABLE seat-side, before AND after 4374; the fix closed OTHER
matchings (the unrelated-words class), not these. The seat CAN still restore its own worktree:

1. Read the blob: spawn `git cat-file blob HEAD:<path>` and capture the RAW BYTES (no shell redirect:
   measured at fe52a41, writing the blob through a redirect leaves the file dirty forever under
   core.autocrlf=true, because the redirect emits the LF blob and the worktree expects CRLF).
2. Smudge by hand: normalize CRLF to LF, then emit every LF as CRLF, and write the file.
3. Same for a DELETED file: write its smudged blob bytes.
4. `git status --porcelain` MUST be empty - on qa's runs it was, for one modified and one deleted
   tracked file (fe52a41 measurement: qa-item-4308 commit b59afd3).

Run this ONLY inside the seat's own worktree, never on the shared tree, and only after the asymmetry
diagnosis above proves nothing was deleted on purpose.

## Escalate to
`pm` — to route the restore (and a broker restart, if the running broker predates a landed fix) when a
seat is blocked by it; the operator — if the deletion turns out to be committed, i.e. a deliberate
change nobody explained. Seats cannot do the restore themselves while the **active-seat guard** is in
force: the act belongs to the operator or the delegate.

## Evidence
2026-10-19 (delegate, operator-directed land+prune pass): the shared tree reported **9 tracked deletions
in `scripts/`** with the directory empty on disk, blocking every landing (the helper and the demo suite
could not parse). Both the index (`git ls-files -s scripts/` → 9) and `HEAD` (`git ls-tree HEAD scripts/`
→ 9) were intact, and `git log --all --diff-filter=D -- scripts/` returned nothing — so the loss was
unexplained but the restore was lossless. `git checkout-index -f -- scripts/` **failed** (`scripts/ is
not in the cache`); the file-list form restored all nine. Two files carried a stale ` M` with an empty
`git diff`; `git hash-object` matched the index shas and `git add --` (2 explicit paths) produced an
empty staged diff. `node --check` passed on `land.mjs` + `suite.mjs`, and the landing pass then ran:
`main` `67228b9` → `3b79159`. Recorded as the first gate of that pass in `docs/NEXT.md` (#2889/#2890).
