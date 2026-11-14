# The zero-build close class: content-probing the 119 "already on main" LANDING rows (#7515)

Date: 2026-11-13. Author: qa (verifier). Read-only throughout: no cancel, no release, no landing, no push.
Tree measured: `refs/heads/main`, tip `5b8e364496f645d6c595b20ff0d4641cc56fcc959` (it moved during the sweep; each
probe ran against the tip at the moment of the probe, which is what a close would see).

## Method (re-runnable)

1. One queue read: `node cli.mjs queue` with `DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite` -> 7,728 rows.
   `node tools/queue-drain-audit.mjs --db ... --json ...` exit 0, 2.9 s: 119 non-terminal LANDING rows whose cited
   sha appears in the main rev-list.
2. For each row: take the cited sha (floor 7, digit-and-letter guard), expand it with `git cat-file --batch-check`,
   confirm it is in `git rev-list refs/heads/main`, then take the files the landing actually brought in:
   `git diff --name-only <sha> <sha-with-caret-1>`. The first-parent form is load-bearing: a landing merge has an
   empty diff against itself, so only the diff against its first parent shows what the row claims to have changed.
3. Content probe per file: `git cat-file -e refs/heads/main:<file>` (exit 0 = the file is there, 128 = it is not),
   then `git show refs/heads/main:<file>` checked against the lines the landing added (lines of at least 25 chars).
   A file whose added lines all vanish was either reverted or rewritten;
   `git log --grep=Revert <sha> refs/heads/main -- <file>` separates the two.
4. Reverse edge: for every non-terminal row, read the structured `blockedBy` array; a row is a live gate if it
   appears in any non-terminal row's `blockedBy`.

Why reachability alone is not enough, measured here: the rev-list says a merge sha is an ancestor of main even when
a later `Revert "merge: land item-XXXX onto main"` removed its content. Three such reverts are on main
(`5537357d` item-6064, `96fa4d17` item-6063, `6db994de` item-6066), and the rows whose landing those reverts undid
are still sitting in the queue as "already on main".

## List 1 - close-safe (content present on main, no live gate): 104 rows

4801 7078 7131 7133 7320 7321 7323 7324 7325 7326 7327 7328 7329 7330 7331 7334 7335 7336 7337 7339 7340 7341 7342
7343 7344 7345 7346 7347 7348 7349 7351 7352 7354 7355 7356 7357 7358 7360 7361 7363 7364 7365 7366 7367 7369 7378
7379 7380 7381 7382 7384 7385 7387 7389 7396 7398 7399 7400 7401 7402 7403 7404 7405 7406 7407 7408 7410 7411 7414
7415 7416 7417 7418 7419 7422 7423 7424 7426 7428 7429 7430 7431 7432 7433 7434 7464 7467 7468 7470 7472 7473 7474
7475 7477 7478 7479 7480 7547 7549 7654 7666 7671 7683 7687

Every file each of these rows touched exists on main and at least one of its added lines is still verbatim there.

## List 2 - reachable on main but NOT content-verified: 14 rows

Two are genuinely not on main - the landing was reverted. Closing these as "landed" would be false.

| row | landing sha | what the probe found |
|---|---|---|
| 7469 | 0bfd61a5 (#6064) | `git cat-file -e refs/heads/main:docs/runbooks/compaction-policy-refused.md` exit 128; `git grep -c "reserve >= maxTokens" refs/heads/main -- docs/FEATURES.md` exit 1; reverted by 5537357d and 96fa4d17, never re-landed |
| 7471 | bcaa6d2b (#6066) | `git grep -c "declaredContextWindow now reads" refs/heads/main -- docs/runbooks/context-over-window.md` exit 1; reverted by 6db994de, never re-landed |

Two name a path that no longer exists because the row MOVED the file. The content is on main, elsewhere:

| row | landing sha | probe |
|---|---|---|
| 7427 | 2bf7856d (#6128) | `git cat-file -e refs/heads/main:docs/evidence/2026-11-08-context-window/compaction-acceptance.mjs` exit 128; the instrument now lives at `tools/compaction-acceptance.mjs` (`git grep -c "resolve(arg" refs/heads/main -- tools/compaction-acceptance.mjs` exit 0) |
| 7476 | 07d5b4e4 (#6131) | the same file: this row's diff IS the deletion of the old path, so an existence probe on the old path must fail by design |

Ten are on main but reworded - the file exists, none of the row's added lines survive verbatim, and no revert
touched it. Closing the row is fine; quoting its text as "the content is there" is not:
7322 (rig.selfdev.json persona instructions), 7338 (docs/NEXT.md, rolling pointer), 7350 (src/seattools.mjs),
7359 (demo/worktree-reuse-deps.test.mjs, rewritten by 96828174), 7362 (src/rig.mjs), 7370
(demo/__golden__/streaming-80.txt), 7392 (docs/NEXT.md), 7421 (docs/FEATURES.md DURIG_DB row, re-pinned later to
config.mjs:117 / cli.mjs:161 / clockin.mjs:468), 7463 (docs/NEXT.md), 7548 (docs/NEXT.md).

## List 3 - unsafe to close: something still waits on it

- 6991 - it is the structured gate of 7031 ("REGISTERED (held, blockedBy 6991): the spool census does not see the
  dead-lette", status queued). Marking 6991 `done` opens 7031's gate; marking it `cancelled` strands 7031 as
  `gate-cancelled`, because nothing in src/ repairs a `blockedBy` chain when a gate goes terminal. Either way this
  row needs a decision, not a bulk close.
- Weak edge, for completeness: 4801 is cited in prose by non-terminal rows 7680 and 7681. Only 7 of the 119 are
  cited in prose at all, and only 6991 appears in a structured blockedBy.

## What the instrument gets wrong, so the next run does not repeat it

`tools/queue-drain-audit.mjs` answers "is this sha an ancestor of main". For a LANDING row that is the wrong
question: a revert leaves the merge sha an ancestor while removing its content. Any bulk close driven off that
number closes rows whose artifact is gone - the 14 in List 2, of which 7469 and 7471 are the real reverts. Pair the
reachability set with the per-file probe above before releasing anything.
