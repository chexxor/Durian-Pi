# durian-pi — NEXT (current pointer)

> **Older sessions moved VERBATIM to [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md)** — original order, no edits.
> This file is the live pointer plus the current session: everything from the `2026-10-25T01:52Z` session back
> lives in the archive. The cut is proven by concatenation (see `docs/DECISIONS.md` D126, D129).

## NEXT SESSION (2026-10-26T22:15Z — THE STORE IS READABLE ON THE PINNED PI BUILD; WHAT REMAINS IS SIX LINUX DEFECTS AND THE OPERATOR'S PROVIDER RULING)

**Current item:** two things, both measured below. (1) The **six Linux-only demo failures** — they gate every
"suite green" claim on this box, they reproduce with no rig and no provider, and they are seat-sized work the
delegate does not do. (2) The **provider ruling**, carried forward from the archived 2026-10-25 block; it is an
operator decision, and this box has *no* working provider (402 for all 8 seats, no key, local endpoint down).

**Measured this session (Linux workspace `/home/chexxor/Git/Durian-Pi`; nothing here is remembered):**

- **The store crossed from the Windows NVMe and is intact** (method + why: `docs/DECISIONS.md` D128). 437,829,632 B,
  sha256 identical on both sides, `PRAGMA integrity_check` = ok, source had no `-wal`/`-shm`/`-journal`.
- **The queue re-measure reproduces the archived 2026-10-25 pointer exactly**: `## QUEUE 4818 rows
  {"done":3748,"cancelled":777,"held":274,"deferred":19}`, `attention: 21`, `seats: 12`, and the same deferred ids
  #4354 · #4813 · #4814 · #4816 · #4817/#4818. So this store **is** the one that session measured.
- **The schema-v2 blocker was never a version problem — it was an UN-LINKED PIN.** `node scripts/sync-pi.mjs
  --sync --link` builds the pinned commit `2ec55d80…` (labelled **1.3.0**) whose durable migrations carry
  `{version: 2, statements: sleepingStatus}` — precisely what the Windows `node_modules` had. `node cli.mjs ps`
  went from `cannot open … schema version 2 is newer than supported version 1` to **12 seats**. The link is live
  now: `node_modules/@earendil-works/* → vendor/pi-main/packages/*`. Revert is `npm install`; link again with the
  same `--sync --link`.
- **Published 1.4.0 is NOT a drop-in — measured A/B on `main` @`d5c93cd`, 235 demos:** pinned build **229/235
  (273.6 s)**, published 1.3.0 **229/235 (271.0 s)**, published **1.4.0 198/235 (242.3 s)** with `TypeError:
  change.definition.checkpointWhen is not a function` in 8 demos. A 1.4.0 migration is real seat work; do not buy
  store-readability with it, and never lower `durable_schema.version` by hand.
- **`.scratch/` is not ignored, but `.spike/` is.** `.gitignore:20-21` ignores `.spike/`; the comment at `:22`
   promises "operational exhaust … captured logs" and then lists `.impl.log`, `.*.out`, `pm-*.err` — never
   `.scratch/`. Every suite run here writes `.scratch/test/*.out`, so `git status` goes noisy for the next seat,
   and `check-ignore .scratch/test/all-pinned.out` exits 1. Same on `main`, so it is not a Linux artifact.
- **The suite runner writes no marker**: `scripts/test.mjs` produces no `.spike/delegate/suite-marker.json`, so the
  digest's `last suite:` always reads "no marker written yet" and every "suite green" claim lives in prose. This
  session wrote the marker by hand for its own run.

**The six Linux defects** (identical under 1.3.0 and the pinned build, so **not** a pi-version artifact; logs
`.scratch/test/all-pi130-baseline.out`, `.scratch/test/all-pinned.out`):

1. `verify-scratch-per-tree` — `symlinkSync(…, "junction")` makes a **file** symlink on Linux, and the ignore rule
   `node_modules/` is directory-only, so `git status --porcelain` returns `?? node_modules` where `""` is expected
   (`demo/verify-scratch-per-tree.test.mjs:50`, assertion text names the Windows shape).
2. `confine` — same junction shape; canary "the junction was removed" fails.
3. `write-targets` — 23 mismatches, all literal `C:/seat/…` expectations resolving under cwd
   (`/home/chexxor/Git/Durian-Pi/C:/seat/out.txt`).
4. `worktree-deps-link` — invokes `npm <abs-path>/sync-pi.mjs --link`; npm on Linux answers `Unknown command`, so
   the "vendor not built" reason never reaches the caller (5 checks).
5. `job-object` — "process is dead after natural completion" / "POSIX process dies naturally".
6. `worktree-prune-branch` — the fixture's `git cherry-pick` fails; exporting `GIT_AUTHOR_*`/`GIT_COMMITTER_*` does
   **not** fix it, so it is behaviour, not missing identity.

**History, and what it still owes:** the superseded `2026-10-25T01:52Z` block is verbatim in
`docs/NEXT-ARCHIVE.md`; it holds the two provider paths (A fund DeepInfra, B point seats at a local endpoint, with
the cross-family-verifier caveat) and the per-branch landing list. Both still stand; this session only changed
which machine can read them.

**Queue id:** #4354 · #4813 · #4814 · #4816 · #4817/#4818 (all 19 `deferred` rows are listed by the digest, not by
this file) · the landing stack #4083/#4064/#4054 and `item-4745…4790` exist as **branches in the Windows tree
only** — this clone has 10 refs and 1 worktree, so `## GIT` here reads `unmerged=0` and must not be read as "no
landing debt".

**Exact next commands:**

1. `DURIG_DB=./selfdev.sqlite node scripts/clockin.mjs > .spike/clockin.txt` — one call, ~2 s, ~10 KB. The env var
   is **`DURIG_DB`**, not the `DURIAN_PI_DB` that `AGENTS.md` step 4 and `SELFDEV.md` §Running it print; the
   documented spelling silently audits an empty `./rig.sqlite`.
2. `node demo/next-pointer.test.mjs` — if it fails, the pointer drifted (or this file passed 200 lines).
3. `node demo/verify-scratch-per-tree.test.mjs` — reproduces defect 1 in under 5 s with no rig; that is the shortest
   hand-off to a seat.
4. `node scripts/sync-pi.mjs` — if `"linked": null`, the store is unreadable again: `node scripts/sync-pi.mjs
   --sync --link` (takes ~2 min; builds `vendor/pi-main` from the pin).
5. Operator ruling on the provider, then `DURIG_DB=./selfdev.sqlite node cli.mjs serve` to bring a broker up **here**
   (none exists: `selfdev.sqlite.broker.json` absent) and `node intent.mjs pm --body-file <file>` to relay answers.

**Blocker:** **no working provider on this box** — all 8 running seats report `last_run_failed: model_error: 402 …
positive balance`, `DEEPINFRA_API_KEY` is unset, and the local endpoint is `DOWN (fetch failed)` (Strata ran on the
Windows side). No seat can run, so the 19 `deferred` rows cannot be worked even though the queue is now readable.
Secondary: **229/235, not 235/235** — the six Linux defects above make any green-suite claim false here. Not a
blocker: the store is intact and readable, `main` @`d5c93cd`, tree clean apart from this session's docs commit and
a pre-existing uncommitted dependency relaxation (`pi-coding-agent` `1.3.0`→`^1.3.0`, `pnpm-lock.yaml` /
`pnpm-workspace.yaml` untracked — not this delegate's, not landed).
