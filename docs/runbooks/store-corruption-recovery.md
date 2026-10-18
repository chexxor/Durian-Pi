---
runbook: store-corruption-recovery
symptom: "a write verb fails with `Session failed after a storage error`, or `status` prints `unreadable pi.live for conversation N`, or the broker repeats `wake-failed … unresolvable path` and a seat is never woken"
writes: true
precondition: "broker-stopped"
last_verified: 2026-10-18
verified_by: delegate
evidence: "2026-10-18 impl conv 9 doc 12105 (alive-broker `[\"tools\",0]` shape); docs 16/22 from 2026-10-16"
check_rule: null
---

# Store corruption recovery (`pi.live` unreadable)

## When to use
A write verb fails with `Session failed after a storage error; close and reopen it`, or `status`/`log`
prints `unreadable pi.live for conversation N (unresolvable path: [...])`. `serve`/`run`/`send` all die
because one bad document poisons the pi-durable session.

**Second shape — the broker stays alive and one seat is never woken.** The unresolvable path is not
always `["generation","message","content",0]`; a **mid-run abort** can instead leave a partial whose
`tools` array is unreachable (`["tools",0]`, observed on impl conv 9, 2026-10-18). Then `.spike/serve.err`
repeats `{"driver":"wake-failed","seat":"<seat>","conversationId":N,"error":"PathError:
unresolvable path: [...]"}` while the broker's `PASS` keeps advancing and other seats run; `status`'s
stderr names it once and the seat shows `last_run_failed: aborted`. The broker does **not** die — do not
go to `broker-down-or-stalled.md` for this shape.

## Preconditions
The broker is **stopped and verified** (see `broker-safe-change.md` step 1–2). No live generation.

## Diagnose (read-only)
The error names the conversation (`unreadable pi.live for conversation <N>`). `status`/`log` prints it
once on **stderr** and keeps rendering the other seats; the store otherwise opens. When the broker is
alive, read `.spike/serve.err` — repeated `PathError: unresolvable path: [...]` for one conversation is
the seat-level signature. Confirm no `genlock.*` is held before the write.

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
For the alive-broker shape, verify all three:
```bash
tail -6 selfdev.sqlite.broker.log          # expect `WAKE <seat>` and `PASS n woke=<seat>`
tail -4 .spike/serve.err 2>/dev/null      # no new `wake-failed`
DURIG_DB=./selfdev.sqlite node cli.mjs status >/dev/null   # stderr: no `unreadable pi.live`
```

## If it fails
Restore the backup and escalate:
```bash
cp ".spike/store-backup-<ts>/selfdev.sqlite" ./selfdev.sqlite
```
The mechanism (a mid-stream `generation` reset or abort orphaning later appends) is understood; the
writer that emits it is **not proven**. A 2026-10-18 recurrence on impl conv 9 (doc `12105`) followed a
`resume`/broker-stop cycle that aborted an in-flight run (`last_run_failed: aborted`) — the current
candidate, still UNVERIFIED. ROADMAP item 78 makes the broker survive this per-conversation instead of
logging `wake-failed`.

## Evidence
2026-10-16: docs 16 (qa) and 22 (lead) from a second-writer crash, and doc 12105 (impl) from an
`up --refresh` run on a broker that had not stopped. Backups: `store-backup-20261016-121820`,
`store-backup-20261016-143336`.
2026-10-18 (recurrence, `docs/incidents/2026-10-18-seat-unwakeable-corrupt-doc.md`): **doc 12105 again**
for impl conv 9, now in the alive-broker `["tools",0]` shape. `repair-pi-live.mjs ./selfdev.sqlite 9`
retired it (`retired:[{id:12105,...}]`, `seq:847092`); the broker then logged `WAKE impl` /
`PASS 16 woke=impl`. Backup: `store-backup-20261017-204831`.
2026-10-18 (recurrence, `docs/incidents/2026-10-18-broker-retry-hotloop.md`): `pm` conv **3** — the
broker wedged on `wake-failed … pm conv 3 … Session failed after a storage error` and a plain
terminate+restart did NOT clear it (clean passes, then a re-spin). `node scripts/repair-pi-live.mjs
./selfdev.sqlite 3` is the prerequisite before the restart. This is the first `pm` recurrence; prior
ones were `impl` conv 9 / `qa` conv 15 / `lead` conv 22.
