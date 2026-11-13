---
runbook: store-baseline-comparison
symptom: "how big is the store, how far is it from the backup, and why do two `sha256sum` values of 'the store' disagree"
writes: false
precondition: "read-only"
last_verified: 2026-11-13
verified_by: scribe
evidence: "items #6430 (2026-11-11 pass) and #6375 (2026-11-13 pass, worktree item-7274); every number below was printed by the commands in this runbook"
check_rule: null
---

# Comparing the store to a baseline without opening it

## When to use

- Someone asks "has the store grown back to the backup?" or "is this backup still usable as a restore point?"
- Two seats (or two runs of the same command) report different hashes for `selfdev.sqlite`.
- You are about to decide whether a restore is needed, and the only evidence you have is a file size.
- You want a number you can put in a report, and the report needs to be true a day later.

## Impact

Two independent traps, both measured on this rig on 2026-11-11.

**1. Opening the database is a write-risk, not a read.** `sqlite3`, a Python `sqlite3` connection, or any
`Harness`-opening verb while the broker is resident is a **second writer** against a live broker. That is the
mechanism behind the `Session failed after a storage error` / `database is locked` family in
[`store-corruption-recovery.md`](store-corruption-recovery.md), and it is the defect registered as **#6387**,
"the broker locks against its own second store connection" (status `queued`, addressed to `impl` - **not fixed
as of this writing**, so the prohibition is current, not historical). Plain shell tools - `stat`, `ls`, `wc`,
`sha256sum`, `cmp` - open no sqlite connection at all, so they cannot contend with the broker. They are the
safe instrument for size and content comparison, and they are what this runbook uses.

**2. The main file is not the store.** In WAL mode the uncheckpointed transactions live in `<db>-wal`; the
`-shm` file is the shared-memory index for it. Measured at one instant on 2026-11-11:

| file | bytes | mtime (epoch) |
|---|---|---|
| `selfdev.sqlite` (main) | 706,138,112 | 1794432231 |
| `selfdev.sqlite-wal` | 4,214,792 | 1794432324 |
| `selfdev.sqlite-shm` | 32,768 | 1794432319 |

The WAL was touched 93 seconds **after** the main file. So `sha256sum selfdev.sqlite` is a hash of the
checkpointed part only, and comparing it against a backup that was copied as a main file alone is not a
like-for-like comparison - on this rig the gap at that instant was the 4.2 MB of WAL. **Rule: any store hash
you report must state which files it covered.** "The store sha is `2a371cd8f2df`" is meaningless; "main-file
sha, WAL excluded, measured 2026-11-11T21:2xZ" is a fact another seat can re-check.

And the number moves: qa's snapshot on the same rig read main = 646,389,760 B, sha prefix `4d0d50e5fedee530`,
WAL 4,198,312 B. Mine, later the same day, read main = 706,138,112 B, prefix `2a371cd8f2df`. Both are correct
at their instants. A store sha is a timestamp, not an identity.

## Preconditions

- None. This procedure reads nothing but the file's bytes and metadata. **Do not** stop the broker to run it.
- Name the store by path, not by habit. `cli.mjs` and `intent.mjs` read `DURIG_DB`; a bare `cli.mjs` defaults
  to `rig.json`/`rig.sqlite` (see the note in the README on #5911). The shell tools take an explicit path.

## Diagnose (read-only)

```bash
stat -c '%s %Y %n' ./selfdev.sqlite ./selfdev.sqlite-wal ./selfdev.sqlite-shm
```

`stat` is in the harness's read-only allowlist (`src/runbookdiagnose.mjs`, `READ_ONLY_SHELL_TOOLS`), so this line
runs inside a seat turn. `sha256sum` and `cmp` are **not** in that allowlist: the diagnose runner reports them
as a gap rather than executing them. An operator at a shell can run them; a seat cannot.

```bash
sha256sum ./selfdev.sqlite | cut -c1-12
cmp -b .spike/backups/20261110T0551Z/selfdev.sqlite ./selfdev.sqlite
```

`cmp -b` exits **0** if the files are byte-identical and **1** on the first difference, printing the byte offset
and line - it stops at the first mismatch, so it costs nothing on a 700 MB pair.

**Print the prefix, not the whole hash.** A 40-hex sha in a tool result is caught by the redactor as a
secret-shaped value: the harness replaced my `sha256sum ... | cut -c1-40` output with
`[redacted by durig: secret-shaped value (unconfirmed-object)]`, while the 12-character prefix came through
untouched. So compute the comparison in-shell (`cmp`, or `$(sha256sum x) == $(sha256sum y)`) and report a
prefix. See [`tool-result-redacted.md`](tool-result-redacted.md).

## Do

1. **Record the pair with its instant.** Sizes alone:
   `stat -c '%s %Y %n' <backup> ./selfdev.sqlite ./selfdev.sqlite-wal ./selfdev.sqlite-shm` - the `%Y` epoch is
   the file's last write, and it is what tells you the WAL is newer than the main file.
2. **Decide which comparison you actually want.**
   - *Has anything been written since the backup?* `cmp -b` answers it in one byte.
   - *How much has it grown?* subtract the two main-file sizes, then say whether the WAL was in scope.
   - *Is the backup a usable restore point?* Size does not answer this. A backup copied as a main file alone
     is missing whatever the WAL held at copy time; check the backup directory's contents
     (`ls -l .spike/backups/<stamp>/`) - if only `selfdev.sqlite` is there, the copy is a checkpointed
     snapshot, not the whole store.
3. **For logical content (rows, counts), never open the store in a turn.** Use the broker-served reads:
   `DURIG_DB=./selfdev.sqlite node cli.mjs queue` prints `counts` without a second Harness (D111). If the
   broker cannot answer, the sanctioned opener is `openReadOnlyStore` in `src/readonlystore.mjs` - `node:sqlite`
   with `readOnly: true`, "opens no harness, claims no ownership and issues no write" - which
   `src/readclient.mjs` falls back to. It is pinned against the vendor read path by
   `demo/readonly-store-parity.test.mjs`; run it and it reports
   `READONLY-PARITY PASS (15 views identical between pi-durable and node:sqlite readOnly; seats=2)` (exit 0).

## Is a cited backup a rollback point? (the contract)

A file under `.spike/backups/` is a **restore point only for the instant it was copied**. Nothing in the rig
marks it as current, and nothing keeps it current. Three rules, each of them checkable:

1. **Validity is measured, never asserted.** A backup is a rollback point only if it was taken after the last
   schema-relevant change to the store. The check is the same three numbers, every time, against the live
   store: size, `sha256` prefix, and mtime - and the **delta** between them. A non-zero delta means the backup
   is not the store, and restoring it loses everything written since. Size alone never answers this; a backup
   copied without `-wal` is a checkpointed snapshot, not the store (see `Do` step 2).
2. **Before schema or pin work, take a fresh snapshot and record it in the work item.** Copy all three files
   (`selfdev.sqlite`, `-wal`, `-shm`) - the ladder in
   [`store-corruption-recovery.md`](store-corruption-recovery.md) lines 51-52 shows the command - and write the
   **timestamp, byte size and digest prefix into the queue item body**, not into prose elsewhere. A number in a
   paragraph has no clock and no owner; a number in the row is re-checkable by whoever does the restore.
3. **`cmp` exiting 1 at byte 28 is normal, not corruption.** Byte 28 sits inside the JSON document header of the
   store, so it is the first place two generations of the same store can disagree. Divergence there says "this
   is a different generation of the same store"; it does not say "the store is damaged". Use
   [`store-corruption-recovery.md`](store-corruption-recovery.md) for actual damage.

**Why the wording matters, measured.** qa's 2026-11-11 pass found the named backup **16.8 MB behind** the live
store (`617,492,480` vs `634,318,848`, `cmp` diverging at byte 28). Re-measured by scribe on 2026-11-13 in
worktree `item-7274`, the same backup is **155,041,792 bytes behind** the live store. Both numbers were true at
their instants - which is exactly the point: the validity check must be run, not quoted from the last run.

| file | bytes | mtime (epoch) | sha256 prefix |
|---|---|---|---|
| `.spike/backups/20261110T0551Z/selfdev.sqlite` | 617,492,480 | 1794289915 | `0996cd61bef1` |
| `selfdev.sqlite` (live main) | 772,534,272 | 1794535156 | `a293284b1446` |
| `selfdev.sqlite-wal` | 4,255,992 | 1794535159 | - |

Main-file delta: **+155,041,792 bytes (+25.1%)**. The backup directory contains **only** `selfdev.sqlite` - no
`-wal`, no `-shm` - so it is a main-file snapshot of a WAL-mode store, and even at its own instant it was not
the whole store.

**Verdict for this rig, as of 2026-11-13:** `.spike/backups/20261110T0551Z/selfdev.sqlite` is a **baseline for
measuring growth**, not a rollback point. Anyone asked to restore the team queue from it would be restoring a
store two days and 155 MB older than the one in use. It is the operator's call to delete or refresh it; this
runbook measures drift, it does not decide.

## Verify

Run these and compare against the recorded output. The 2026-11-11 pass ran in worktree `item-6430`; the
2026-11-13 pass ran in worktree `item-7274`. Exit codes are part of the expectation.

```bash
stat -c '%s %Y %n' .spike/backups/20261110T0551Z/selfdev.sqlite ./selfdev.sqlite ./selfdev.sqlite-wal ./selfdev.sqlite-shm
sha256sum .spike/backups/20261110T0551Z/selfdev.sqlite | cut -c1-12
sha256sum ./selfdev.sqlite | cut -c1-12
sha256sum ./selfdev.sqlite-wal | cut -c1-12
cmp -b .spike/backups/20261110T0551Z/selfdev.sqlite ./selfdev.sqlite
```

Observed (exit 0 for the first four, exit 1 for `cmp`):

```
617492480 1794289915 .spike/backups/20261110T0551Z/selfdev.sqlite
706138112 1794432231 ./selfdev.sqlite
4214792  1794432324 ./selfdev.sqlite-wal
32768    1794432319 ./selfdev.sqlite-shm
0996cd61bef1
2a371cd8f2df
700d645f98b8
... differ: byte 28, line 1 is 113 K 173 {
```

Delta main-file: **+88,645,632 bytes (+14.36%)** over the ~19 hours between the backup's mtime and the read.

Re-run 2026-11-13 in worktree `item-7274` (exit 0 for the four `stat`/`sha256sum` lines, exit 1 for `cmp`):

```
617492480 1794289915 .spike/backups/20261110T0551Z/selfdev.sqlite
772534272 1794535156 ./selfdev.sqlite
4255992   1794535159 ./selfdev.sqlite-wal
0996cd61bef1
a293284b1446
... differ: byte 28, line 1 is 113 K 371 M-y
```

Delta main-file: **+155,041,792 bytes (+25.1%)** over the two days between the backup and the read. The backup
is not a restore point; the comparison itself is the reason the rule in the section above exists.

## If it fails

- **`stat` cannot find `-wal` or `-shm`** - the store has checkpointed and no connection holds the WAL; at that
  instant the main file *is* the store. The caveat is not violated, but re-check before reporting, because the
  files reappear as soon as a broker pass writes.
- **`cmp` exits 0 but a queue read disagrees with the backup** - the difference is in the WAL, not the main
  file. Re-run the three `stat` lines; if `-wal` is non-zero, the comparison you ran was main-file only.
- **A write verb now fails with `database is locked` or `Session failed after a storage error`** - you (or
  another seat) opened the store in a writing mode. Stop, and follow
  [`store-corruption-recovery.md`](store-corruption-recovery.md); the underlying second-connection defect is
  #6387.

## Escalate to

- **impl** for #6387 (the broker's own second-connection lock) - this procedure works around it, it does not
  fix it.
- **operator** when a restore is being considered: this runbook measures drift; it cannot tell you whether a
  given backup is a valid restore point. That is `store-corruption-recovery.md` and `pi-pin-update.md`
  ("A backup is the only rollback - `sync-pi --unlink` cannot open our schema-v2 store").

## Evidence

Items **#6430** and **#6375**. The 2026-11-11 measurements were printed in worktree `item-6430` (branch
`item-6430` off main `35001c3a`); the 2026-11-13 re-measurement (the table and the 155 MB delta above) was
printed in worktree `item-7274` off main `9611c45d`. Both passes read-only, broker left running. The read-only opener claim is pinned by
`demo/readonly-store-parity.test.mjs` (exit 0). The redaction behaviour was observed in this session's own tool
output. Note that `sha256sum` and `cmp` are outside the harness's read-only allowlist, so the Verify step is an
operator's shell step, not a seat turn.
