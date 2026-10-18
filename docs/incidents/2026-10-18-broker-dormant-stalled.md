---
incident: broker-dormant-stalled
date: 2026-10-18
severity: sev1
status: mitigated
symptom: "the team has stopped working; the broker process is alive but its log stops"
runbook: broker-down-or-stalled
fix: null
prevention: "ROADMAP 78 (log SessionFailed.cause on wake-failed + a broker watchdog/auto-restart) and the dormant-revisit gap"
last_reviewed: 2026-10-18
---

# The broker stays alive but stops driving after a wake storage error

*Incident 2026-10-18; detected by the operator ("is the broker down?"); analysis by the delegate.*

## Summary
The resident broker (pid `24744`) was **UP** — fresh heartbeat, one `cli.mjs serve` process, no
`genlock.*` — yet it **stopped making passes** for ~6.5 minutes: its log's last line was `PASS 1`,
written at startup, and no seat was ever woken. `.spike/serve.err` (mtime = that pass) shows the cause
signature: `wake-failed … Session failed after a storage error; close and reopen it` for **impl**
(conv 9) and **qa** (conv 15). With no seat driven, the whole team sat `idle_with_queued_work`. Service
was restored by terminating the stalled process, `resume`, and restarting (pid `15720`). The specific
storage failure is **UNVERIFIED** (the nested `.cause` is still not surfaced).

## Timeline
- `01:10:59Z` restart → `START pid=24744`; `INTENT delivered=1 dead=0 dup=0`; `PASS 1 ms=5066 woke=-`.
- `01:11:04Z` last line written to `selfdev.sqlite.broker.log` (`PASS`); `.spike/serve.err` written with
  the two `wake-failed` storage errors. Then **silence** — no further pass, no seat woken.
- `~01:17Z` operator notices the team is not working; diagnosis (below) shows the process alive
  (heartbeat `01:17:19Z`) but the log frozen 6.5 min.
- `01:18Z` recovery: terminate pid `24744` (no genlock); `resume` → `found: 1` (`pm:run-cancelled`);
  restart → `START pid=15720` (`01:18:09Z`); `INTENT delivered=2 dead=0 dup=0`; `WAKE qa`;
  `PASS 1 ms=37 woke=qa`; passes advance and 2 genlocks appear.

## Impact
The **entire team was unproductive** for ~6.5 min: no seat woken, queued work ageing, and **two spooled
operator intents sat undrained** (the pause priority `#1841` and the worktree-audit registration) until
the restart. No data risk; nothing was corrupted (see Evidence).

## Root cause
**UNVERIFIED.** The verified *signature* is: a per-conversation storage error on wake (`wake-failed`,
impl conv 9 / qa conv 15) at the startup pass, after which the broker made no further pass. The
`broker.json` heartbeat nevertheless stayed **fresh**, so this is the **dormant** shape in
`broker-down-or-stalled.md` (case b), not the abnormal-death shape in
`docs/incidents/2026-10-17-broker-crash.md`. The nested `SessionFailed.cause` is still not logged, so
the specific cause cannot be named from the evidence. Candidate class (as in the broker-crash record):
every store open takes `BEGIN IMMEDIATE` + migration DDL, so a concurrent opener can produce a
transient storage error.

## Detection
A **human** noticed ("the team is not working / is the broker down?"). Not durable: the heartbeat was
fresh, so "fresh heartbeat" is **not** proof of health — the signal is the last `PASS` line in
`selfdev.sqlite.broker.log`. A `status` `idle_with_queued_work` / `queue-ageing` notice would also
have shown it, but nothing auto-flagged a fresh-heartbeat-but-no-pass broker.

## Resolution
Per `docs/runbooks/broker-down-or-stalled.md`: the process was alive but wedged/dormant with **no
genlock held**, so it was terminated (`Stop-Process -Id 24744 -Force`); stale `broker.json`/`genlock.*`
were cleared; `node cli.mjs resume` cleared 1 stranded submission; the broker was restarted
(`scripts/serve-noroot.ps1`, pid `15720`), which drained the two spooled intents and resumed passes.

## Prevention
`prevention: null` would be honest for code — no landed fix stops this yet. The durable changes owed
(ROADMAP 78, `docs/BROKER-SUPERVISION.md`):
1. **Log `SessionFailed.cause` on `wake-failed`** so the specific storage error is named, not guessed.
2. **Survive/attribute the per-conversation storage error** — `#1698` (broker survives a pass storage
   error) is landed but the broker still went dormant, so it is insufficient; re-open it with this
   evidence.
3. **A broker watchdog/auto-restart** (ROADMAP 61–64) — a fresh heartbeat with no `PASS` should trigger
   a supervised restart.
4. **The dormant-revisit gap** (`broker-down-or-stalled.md` case b): a pass runs only on a
   store-commit signal, so after a failed wake nothing re-arms the loop.

## Evidence
- `cat selfdev.sqlite.broker.json` at diagnosis: `{"pid":24744,...,"heartbeatAt":1792286239494}`
  (`01:17:19Z`) — heartbeat **fresh**; but `selfdev.sqlite.broker.log`'s last line was
  `2026-10-18T01:11:04.551Z PASS 1 ms=5066 woke=-` — **6.5 min earlier**.
- `Get-CimInstance Win32_Process … cli.mjs serve` at diagnosis → exactly one process, `24744`; `ls
  selfdev.sqlite.genlock.*` → **none** (no run in flight, so terminating was safe).
- `.spike/serve.err` (mtime `01:11:04Z`): `{"ok":false,"command":"serve","driver":"wake-failed",
  "seat":"impl","conversationId":9,"error":"SessionFailed: Session failed after a storage error; close
  and reopen it"}` and the identical object for `"seat":"qa","conversationId":15`; preceded by
  worktree-sweep refusals (`refusing to remove item-1673`, `unlock of item-1754 did not apply`).
- Recovery: `serve --stop`-equivalent was not used — `Stop-Process -Id 24744 -Force` (runbook: no
  genlock); `node cli.mjs resume` → `{"found":1,"actions":[{"seat":"pm","action":"run-cancelled"}]}`.
- Recovery log: `2026-10-18T01:18:09.147Z START pid=15720`; `INTENT delivered=2 dead=0 dup=0`;
  `WAKE qa`; `PASS 1 ms=37 woke=qa`; subsequent `PASS 2..6` and 2 live `genlock.*`.
- `status` read clean throughout; no `unreadable pi.live` — so this is a storage/lock error, **not**
  the corrupt-document case in `store-corruption-recovery.md`.

## Links
`docs/runbooks/broker-down-or-stalled.md` · `docs/incidents/2026-10-17-broker-crash.md` (same class) ·
`docs/BROKER-SUPERVISION.md` · ROADMAP 61–64 and 78 · queue `#1698`

---

## Recurrence — 2026-10-18T02:37Z (same day, pid 28168)

**Appended, not rewritten** (per `docs/incidents/README.md`). This is the same dormant shape, but with a
**new error signature** and a second observer (the operator). It confirms the incident is **not** fixed.

### What happened
- Broker pid `28168` (START `01:48:36Z`) stayed **alive** with a fresh `broker.json`, but its log's
  last line was `PASS 176 ms=5049` at **02:37:27Z** — then no `PASS` for ~4 minutes while work was
  queued and **no `genlock.*` was held**.
- The operator noticed first ("it looks like the auditor is stuck on an output" / "is the broker
  down?"). The auditor was in fact mid-verification; the stall meant it was never re-woken.
- **Two spooled operator intents sat undrained** in `<db>.broker.inbox` (the Gemma-4 catalog
  prerequisite and the `#1903`→auditor move) until the restart — same signature as `#1841`/worktree in
  the first occurrence.

### New evidence (why the first fix is insufficient)
`.spike/serve.err` at the stall shows a **different nested error than the first occurrence**:
```
{"ok":false,"command":"serve","driver":"wake-failed","seat":"devtools","conversationId":4930,"error":"Error: database is locked"}
{"ok":false,"command":"serve","driver":"wake-failed","seat":"auditor","conversationId":4936,"error":"Error: database is locked"}
{"ok":false,"command":"serve","driver":"wake-failed","seat":"pm","conversationId":3,"error":"SessionFailed: Session failed after a storage error; close and reopen it"}
{"ok":false,"command":"serve","driver":"wake-failed","seat":"qa","conversationId":15,"error":"SessionFailed: Session failed after a storage error; close and reopen it"}
```
`database is locked` (SQLite busy/lock contention) is a **new** cause class on top of the first
occurrence's `Session failed after a storage error`. Context: **transient `cli.mjs serve --max-duration`
test brokers were observed running from an `item-1931` worktree** at the same time (see Evidence).
Whether those opened the selfdev store or only their own scratch DB is **UNVERIFIED**, but concurrent
store openers are exactly the class that produces `database is locked` (the store open takes
`BEGIN IMMEDIATE` + migration DDL).

### Resolution (2026-10-18, delegate, per `broker-down-or-stalled.md`)
`MSYS_NO_PATHCONV=1 taskkill /F /PID 28168` (no genlock held → safe) → `node cli.mjs resume`
(`found: 3`; impl/auditor/devtools `run-cancelled`) → `scripts/serve-noroot.ps1` → `START pid=37496`
(02:41:57Z); on restart the two undrained intents were delivered and passes resumed (PASS 176 → PASS 56
on the new process). qa recovered and generated; auditor resumed verification.

### Prevention (unchanged, now with a second occurrence)
1. **Log `SessionFailed.cause` AND the `database is locked` variant** on `wake-failed`.
2. **A broker watchdog/auto-restart** (ROADMAP 61–64) — fresh heartbeat + stale `PASS` must trigger a
   supervised restart.
3. **The dormant-revisit gap** — a failed wake does not re-arm the scheduler. This is the durable fix.
4. **Investigate concurrent store openers** — a `serve`/`run`/test broker from an item worktree must
   not open the shared selfdev store (wrong-`DURIG_DB` / relative-path resolution).

### Evidence (recurrence)
- `selfdev.sqlite.broker.log` last line at diagnosis: `2026-10-18T02:37:27.401Z PASS 176 ms=5049 woke=-`;
  next lines after restart: `...02:41:57Z START pid=37496`.
- `selfdev.sqlite.broker.json` at diagnosis: `{"pid":28168,...,"heartbeatAt":1792291036831}` — fresh.
- `ls selfdev.sqlite.genlock.*` → **none** (safe to terminate).
- `.spike/serve.err` tail: the four `wake-failed` objects above; plus worktree-sweep refusals
  (`refusing to remove item-1841/item-1894/...`).
- `Get-CimInstance Win32_Process` → `cli.mjs serve --max-duration 3` and `... --max-duration 5` running
  from `C:\Users\Alex\dsh-Projects\pi-opendurig\item-1931\cli.mjs` (transient).
- `node cli.mjs resume` → `{"found":3,"actions":[impl 81006, auditor 81147, devtools 81215 all run-cancelled]}`.

---

## Recurrence — 2026-10-18T03:59Z (third, same day; pid 26228)

**Appended, not rewritten** (per `docs/incidents/README.md`). Third occurrence; the repaired broker
stalled again within ~3 minutes of starting. This recurrence NAMES a concrete aggravator observed
directly: **stale long-lived `cli.mjs log … --follow` / `cli.mjs watch` viewers holding the shared
store open**.

### What happened
- The delegate landed 5 verified branches via `scripts/land.mjs --suite` in an exclusive window
  (broker stopped ~03:56Z, hand-verified quiescent, suite 138/0, `main` `95e7c0c`->`b3710f3`), then
  restarted the broker: `START pid 26228` at `03:56:16Z`.
- Subsequent log lines: `...03:59:05Z WAKE lead`, `PASS 23`, `PASS 24 ms=5065` at `03:59:10Z` — then
  **no further `PASS` for ~21 min** while `broker.json` stayed fresh and **no `genlock.*` was held**.
- `.spike/serve.err` tail showed the `database is locked` variant again, this time for **auditor**
  (conv 4936) and **security** (conv 55605), i.e. the same wake-failed storage-error class.
- The delegate's own spooled intent (`intent-branch-sprawl`, the branch-sprawl analysis) sat undrained
  until the recovery restart — the same "spooled intents stranded" signature as the prior two.

### Root cause (aggravator VERIFIED this time)
`Get-CimInstance Win32_Process` showed **10 stale `node cli.mjs log <seat> --follow --full` viewers and
one `node cli.mjs watch`**, with `CreationDate` from `2026-10-16 13:11` through `2026-10-17 23:12`
(5–15 h old) — long-lived store openers. Read commands run open-time migrations against the broker's
write lock; these viewers are exactly the lock-contention class named by the 2026-10-17 broker-crash
record and `broker-down-or-stalled.md`. The specific `database is locked` cause is consistent with
them; whether one of them (or a transient test broker) was the exact lock holder is not isolated.

### Resolution
Per `broker-down-or-stalled.md`: with no genlock held, terminate the wedged pid `26228`; **terminate
the 10 stale log viewers + `watch`** (pids `26348 34956 37512 24280 17412 35560 19356 37992 3876 5016`);
`node cli.mjs resume` (`found: 4`, four `run-cancelled`); restart -> `START pid=30808`
(`04:20:52Z`). That process then stalled at `PASS 2` too, so a second cycle removed the wedged pid
`30808`, `resume` (found 4) and restarted -> **`START pid=7220`**, after which `PASS 1..6` advanced with
4 live genlocks and the previously stranded intent was delivered (`INTENT delivered=1 dead=0 dup=0`
`04:20:56Z`, inbox drained).

### Prevention (adds item 5 to the list above)
1. Log `SessionFailed.cause` and the `database is locked` variant on `wake-failed`.
2. A broker watchdog/auto-restart (ROADMAP 61–64) keyed on fresh-heartbeat + stale-`PASS`.
3. The dormant-revisit gap — a failed wake must re-arm the scheduler.
4. Forbid a `serve`/`run`/test broker or a read command from opening the shared store from an item
   worktree (wrong/relative `DURIG_DB`).
5. **Do not leave long-lived `log --follow` / `watch` viewers attached to the shared store while the
   broker drives** — they are a documented lock-contention source. These accumulated over ~30 h; a
   housekeeping sweep (or an `--attach` proxy that does not open the store) is owed.

### Evidence (recurrence 3)
- `selfdev.sqlite.broker.log` at diagnosis: last line `2026-10-18T03:59:10.305Z PASS 24 ms=5065 woke=-`.
- `selfdev.sqlite.broker.json`: `{"pid":26228,...,"heartbeatAt":1792297190336}` — fresh at diagnosis.
- `ls selfdev.sqlite.genlock.*` -> none (safe to terminate).
- `.spike/serve.err` tail: `wake-failed ... auditor/conv 4936 ... Error: database is locked` (+ the
  `SessionFailed` wrapper), and `security/conv 55605`.
- `Get-CimInstance Win32_Process … cli.mjs log … / cli.mjs watch` -> 11 processes, CreationDate
  `2026-10-16 13:11` .. `2026-10-17 23:12` (listed in Resolution).
- Recovery log: `START pid=7220`, `PASS 1 ms=47 woke=pm,impl,lead,auditor,security`, `PASS 2..6`, 4
  genlocks; `INTENT delivered=1 dead=0 dup=0`.

---

## Recurrence — 2026-10-18T17:12Z (fourth, same day; pid 7404)

**Appended, not rewritten** (per `docs/incidents/README.md`). Same dormant shape and the same two
seats as the 02:37Z recurrence, but with the **heartbeat itself frozen** (not merely stale-`PASS`).

### What happened
- Broker pid `7404` (START `16:54:02Z`) successfully woke `devtools` for a spooled check at `17:01:43Z`,
  then queued work (pm `send_work` → `#2114` devtools / `#2115` auditor) arrived at `17:07:36Z`.
- `17:08:04Z` the pass **failed to wake both seats**; after that the log froze at `PASS 10 ms=5048` and a
  later spooled `stop` intent sat **undrained**. `broker.json`'s `heartbeatAt` stopped advancing too
  (`17:10:05Z` grid), i.e. the process was **wedged**, unlike the prior fresh-heartbeat occurrences.
- `.spike/serve.err`: `wake-failed … Session failed after a storage error; close and reopen it` for
  **devtools (conv 4930)** and **auditor (conv 4936)** — the same pair and wrapper as 02:37Z (which
  additionally showed `database is locked`). No `genlock.*` was held.

### Resolution (2026-10-18, delegate, per `broker-down-or-stalled.md`)
`MSYS_NO_PATHCONV=1 taskkill /F /PID 7404` (no genlock → safe) → removed the stale `broker.json` →
store backup `.spike/store-backup-20261018-121156` → `node cli.mjs resume` (`found: 1`, pm
`run-cancelled`, sub `88623`) → restart with the **local provider env set**
(`DURIG_LOCAL_API_KEY=local`; config file supplies base/model/context) → `START pid=3604` (`17:12:14Z`);
`INTENT delivered=1`; `WAKE devtools` / `WAKE auditor` / `PASS 1 ms=15 woke=devtools,auditor`; no new
`wake-failed`; `idle_with_queued_work` cleared. The local-provider restart key was required because
`scripts/serve-noroot.ps1` sets only `DURIG_DB` (defect fixed on the local model as queue `#2114`).

### Prevention (unchanged; item 5 now has a live example)
1. Log `SessionFailed.cause` / the `database is locked` variant on `wake-failed` (ROADMAP 78).
2. A broker watchdog/auto-restart keyed on stale `PASS` **and** stale heartbeat (ROADMAP 61–64).
3. The dormant-revisit gap — a failed wake must re-arm the scheduler.
4. Forbid a second driver/opener of the shared store.
5. **A long-lived `node ui.mjs` (pid 17340, started ~09:36Z) holds the shared store** — a live example
   of the concurrent-opener class (item 5). It was **left running** (operator's TUI, not proven to be
   the holder); terminate it before a deeper recovery if this recurs.

### Evidence (recurrence 4)
- `selfdev.sqlite.broker.log` at diagnosis: last line `2026-10-18T17:08:04.592Z PASS 10 ms=5048 woke=-`;
  a later spooled intent was never drained until the restart.
- `selfdev.sqlite.broker.json` at diagnosis: `{"pid":7404,…,"heartbeatAt":1792343405144}` — **frozen**
  (`17:10:05Z`) while the wall clock read `17:11:48Z`.
- `ls selfdev.sqlite.genlock.*` → none (safe to terminate); exactly one `cli.mjs serve` process.
- `.spike/serve.err`: the two `wake-failed` objects above.
- Recovery log: `START pid=3604`; `INTENT delivered=1 dead=0 dup=0`; `WAKE devtools`; `WAKE auditor`;
  `PASS 1 ms=15 woke=devtools,auditor`; `PASS 2..16` clean.
- Verification that `devtools` then ran on the local model: `cli.mjs log devtools` shows
  `pi.assistant` entries with `provider: local, model: qwen36` (`stopReason: toolUse`) implementing
  `#2114`.
- Backup: `.spike/store-backup-20261018-121156`.
