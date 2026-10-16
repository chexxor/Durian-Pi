# Store corruption recovery (`pi.live` unreadable)

## When to use
A write verb fails with `Session failed after a storage error; close and reopen it`, or `status`/`log`
prints `unreadable pi.live for conversation N (unresolvable path: ["generation","message","content",0])`.
`serve`/`run`/`send` all die because one bad document poisons the pi-durable session.

## Preconditions
The broker is **stopped and verified** (see `broker-safe-change.md` step 1–2). No live generation.

## Diagnose (read-only)
The error names the conversation (`unreadable pi.live for conversation <N>`). `status`/`log` prints it
once and keeps rendering the other seats; the store otherwise opens.

## Do
1. Stop the broker and confirm it exited (runbook `broker-safe-change.md` step 1–2).
2. **Back up the store** before any write; the `-shm` copy fails while a process still holds it, which is
   itself a signal the broker is not stopped:
   ```bash
   ts=$(date +%Y%m%d-%H%M%S); mkdir -p ".spike/store-backup-$ts"
   cp selfdev.sqlite selfdev.sqlite-wal selfdev.sqlite-shm ".spike/store-backup-$ts/"
   ```
3. Retire the corrupt document for the conversation named in the error:
   ```bash
   node scripts/repair-pi-live.mjs ./selfdev.sqlite <conversationId>
   ```
   It retires the unreadable `pi.live` incarnation through the storage API; `readLiveState` then reads it
   as idle and the next run recreates a clean one.
4. Restart the broker (`broker-down-or-stalled.md` step 3).

## Verify
The error is gone and `serve`/`run`/`send` open normally; the seat that owned the conversation runs again.

## If it fails
Restore the backup and escalate:
```bash
cp ".spike/store-backup-<ts>/selfdev.sqlite" ./selfdev.sqlite
```
The mechanism (a mid-stream `generation` reset orphaning later appends) is understood; the writer that
emits it is not proven. ROADMAP item 78 makes the broker survive this per-conversation instead of dying.

## Evidence
2026-10-16: docs 16 (qa) and 22 (lead) from a second-writer crash, and doc 12105 (impl) from an
`up --refresh` run on a broker that had not stopped. Backups: `store-backup-20261016-121820`,
`store-backup-20261016-143336`.
