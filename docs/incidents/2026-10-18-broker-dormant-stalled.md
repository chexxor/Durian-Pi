---
incident: broker-dormant-stalled
date: 2026-10-18
severity: sev1
status: mitigated
symptom: "the team has stopped working; the broker process is alive but its log stops"
runbook: broker-down-or-stalled
fix: "0c0d4d3, 991567d, 6e27ac2"
prevention: "991567d/0c0d4d3/6e27ac2 (dormant-revisit retry: wake-failed, same-pass throw, AND whole-pass throw) + ROADMAP 78 (log pass-failed cause; a hung/absent retry pass is invisible) + ROADMAP 61-64 (watchdog) + #2126"
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

---

## Recurrence — 2026-10-18T17:30Z (fifth, same day; pid 3604)

**Appended, not rewritten** (per `docs/incidents/README.md`). Same dormant shape, ~18 min after the
fourth recovery; this time the wake failure landed on **pm** and the recovery removed the long-lived
UI viewer named as the item-5 aggravator.

### What happened
- Broker pid `3604` (the recurrence-4 recovery, START `17:12:14Z`) ran clean for ~12 min, then a spooled
  operator intent (the D105 local-per-item-context policy) triggered a pass at `17:24:59Z`:
  `PASS 40 ms=5049` (the same ~5 s signature) with `wake-failed … Session failed after a storage error`
  for **pm (conv 3)** in `.spike/serve.err`; the intent sat **undrained** and no `PASS` followed for ~5 min.
  `broker.json`'s heartbeat was again frozen; no `genlock.*` was held.
- The long-lived `node ui.mjs` (**pid 9756**, started ~09:36Z) was still attached to the shared store —
  the concurrent-opener whose class recurrence 3 named.

### Resolution (2026-10-18, delegate, per `broker-down-or-stalled.md`)
`MSYS_NO_PATHCONV=1 taskkill /F /PID 3604` and `/PID 9756` (the UI viewer — **removed this time**, since
it is the documented lock-contention class and the stall recurred despite leaving it); removed the stale
`broker.json`; backup **`.spike/store-backup-20261018-123023`**; `node cli.mjs resume` (`found: 2` — lead
sub `89013`, auditor sub `89027`, both `run-cancelled`); restart with the local env → `START pid=6124`
(`17:30:28Z`); `INTENT delivered=1`; `WAKE lead`/`WAKE auditor`; `PASS 1 ms=30 woke=lead,auditor`; no new
`wake-failed`. The stranded D105 intent was then delivered to `pm`, which registered + routed it
(**#2123** impl enforcement, **#2124** scribe docs, **#2125** auditor gated verify).

### Prevention
Unchanged (items 1–5). This recurrence is evidence that item 5's viewer class is the live aggravator:
the broker stalled **only** while `ui.mjs` was attached, and stalls did not reoccur after it was removed
in the ~same interval — suggestive, not proof. The durable fixes owed remain: log
`SessionFailed.cause` on `wake-failed` (ROADMAP 78), a watchdog keyed on stale `PASS`+heartbeat
(ROADMAP 61–64), and the dormant-revisit gap (a failed wake must re-arm the scheduler).

### Evidence (recurrence 5)
- `selfdev.sqlite.broker.log`: `…17:24:59.421Z PASS 40 ms=5049 woke=-` then `17:30:28.078Z START pid=6124`.
- `.spike/serve.err`: `{"driver":"wake-failed","seat":"pm","conversationId":3,"error":"SessionFailed:
  Session failed after a storage error; close and reopen it"}`.
- `Get-CimInstance Win32_Process` at diagnosis: one `cli.mjs serve` (3604) **plus** `npm run ui` (14256) /
  `ui.mjs` (9756).
- Recovery: `resume` → `{"found":2,"actions":[lead 89013 run-cancelled, auditor 89027 run-cancelled]}`;
  intent out file `selfdev.sqlite.broker.inbox.out/opr-20261018-local-per-item-context.json`
  (`delivered:true`, `17:30:31.208Z`).
- Backup: `.spike/store-backup-20261018-123023`.

---

## Recurrence — 2026-10-18T17:38Z (sixth, same day; pid 6124) — and the dormant-revisit FIX

**Appended, not rewritten** (per `docs/incidents/README.md`). This recurrence occurred while the fix for
its own root cause was being written, and is the last one expected to go dormant: the fix below landed
and the live broker now runs it.

### What happened
- Broker pid `6124` (the recurrence-5 recovery) hit `wake-failed … Session failed after a storage error`
  for **auditor (conv 4936)** at `17:38:44Z` (`PASS 61 ms=5042`), then made **no further pass for
  ~2.7 min while `broker.json` stayed fresh** and no `genlock` was held — the same dormant shape once more.

### The fix (operator directive "Please fix the broker")
Root cause (prevention item 3, confirmed): a per-seat `wake-failed` left the candidate un-actioned and
nothing re-armed the loop, so the broker slept with the seat undriven. `src/broker.mjs` `runWakeLoop`
now, after any pass that emitted `wake-failed`, schedules a retry pass with bounded exponential backoff
(`wakeRetryMs` 2 s, doubling per consecutive failing pass, cap `wakeRetryMaxMs` 60 s; the counter resets
on a pass with no failure) and logs `WAKE-RETRY in=<ms>ms seats=<names>`. `wakeRetryMs <= 0` disables
the retry. Commit **`0c0d4d3`**; demo **`demo/broker-wake-retry.test.mjs`**.

### Resolution
With no genlock, the dormant broker cooperated with `cli.mjs serve --stop` (`stopped:true`);
`node cli.mjs resume` cleared 3 stranded submissions (impl `89098`, scribe `89101`, pm `89481`); restart
with the local env → **`START pid=12944`** (`17:41:30Z`), `WAKE impl`/`WAKE scribe`/`WAKE auditor`, no new
`wake-failed`. Independent verify routed to auditor.

### Prevention — status of the prior list
1. Log `SessionFailed.cause` — still owed (pi-durable drops the nested cause; ROADMAP 78).
2. Watchdog keyed on stale `PASS`+heartbeat — still owed (ROADMAP 61–64).
3. **Dormant-revisit gap — ADDRESSED for per-seat wake failures by `0c0d4d3`.** A transient storage error
   now gets a retry pass instead of going dormant; a persistent one retries at the 60 s cap and stays
   legible (`WAKE-RETRY`), rather than freezing the broker.
4. Second driver/opener of the shared store — still owed.
5. Long-lived store viewers — the recurrence-5 recovery removed `ui.mjs`; recurrence 6 happened without
   it, so item 5 is not the sole aggravator.

### Evidence (recurrence 6)
- `selfdev.sqlite.broker.log`: `…17:38:44.724Z PASS 61 ms=5042 woke=-`, then no line until
  `17:41:30.976Z START pid=12944`.
- `.spike/serve.err`: `wake-failed … auditor conv 4936 … Session failed after a storage error`.
- `serve --stop` → `{"stopped":true,"pid":6124}`; `resume` → `{"found":3,…}`; restart pid `12944`.
- Fix + demo: commit `0c0d4d3`; `node demo/broker-wake-retry.test.mjs` exit 0.

---

## Recurrence — 2026-10-18T17:57Z (seventh) — the first fix had a GAP

**Appended, not rewritten** (per `docs/incidents/README.md`). This recurrence is the interesting one: it
recurred **on the fixed broker** (pid `12944`, the `0c0d4d3` recovery), which exposed a hole in that fix.

### What happened
- `17:57:16Z` broker pid `12944`: `wake-failed … pm conv 3 … Session failed after a storage error`
  (`PASS 29 ms=5042`), then **no `WAKE-RETRY` line and no further `PASS` for ~36 min** while
  `broker.json` stayed fresh.

### Root cause of the gap
`0c0d4d3` scheduled the retry **inside the pass `try`, after `await supervise()`**. When
`superviseOnce` hit the same storage error and threw, control jumped to `catch`, so the retry block —
and the cooldown-revisit computation — never ran. The failure was invisible because `cmdServe`'s
`onDiagnostic` logs only `wake-failed` and `escalated` to stderr, **not `pass-failed`**, so the throw
left no trace. Net effect: a `wake-failed` followed by a later throw in the SAME pass still parked the
broker.

### Resolution
Commit **`991567d`** moves the post-pass scheduling (cooldown revisit + failed-wake retry) **after the
`finally`**, so it runs whether the pass completed or threw. `demo/broker-wake-retry.test.mjs` gained a
third scenario ("retry enabled + the pass later throws") that fails on `0c0d4d3` and passes on
`991567d`. Recovery: cooperative `serve --stop` (pid `12944`) -> `resume` (2 run-cancelled: impl
`89511`, scribe `89514`) -> restart with the amended fix -> **`START pid=14436`** (`18:38:20Z`),
`PASS 1 woke=pm,impl,scribe`, no new `wake-failed`.

### Prevention (updated)
- `991567d` (this fix) + `0c0d4d3`; `demo/broker-wake-retry.test.mjs` covers both the plain and the
  throw-in-the-same-pass shapes.
- **New detection gap, owed:** `cmdServe` does not log `pass-failed` (or its nested cause) to stderr, so
  a swallowed pass throw is invisible. Fold into ROADMAP 78 (log `SessionFailed.cause` on failure).
- Still owed: a watchdog keyed on stale `PASS`+heartbeat (ROADMAP 61-64).

### Evidence (recurrence 7)
- `selfdev.sqlite.broker.log`: `…17:57:16.844Z PASS 29 ms=5042 woke=-`, then no line until
  `18:38:20.496Z START pid=14436`; zero `WAKE-RETRY` lines for pid `12944`.
- `.spike/serve.err` (mtime `17:57:16Z`): the single `wake-failed` for pm conv 3; **no `pass-failed`**
  (cmdServe does not emit it).
- `git show -s --format=%cI 0c0d4d3` = `2026-10-18T12:40:57-05:00` (17:40:57Z) — the fix WAS on disk when
  pid `12944` started (`START 17:41:30Z`), so this was a code gap, not a stale process.
- `cli.mjs` `cmdServe` onDiagnostic handles only `wake-failed` and `escalated`.
- Fix + demo: commit `991567d`; `node demo/broker-wake-retry.test.mjs` exit 0 (3 scenarios).

---

## Recurrence — 2026-10-18T19:07Z (eighth) — the retry was scheduled but no pass followed

**Appended, not rewritten** (per `docs/incidents/README.md`). This one differs from recurrence 7: the
`WAKE-RETRY` line WAS emitted (so the `991567d` post-`finally` scheduling ran), yet no retry pass was
observed. It also records the first recovery on a host whose commit charge has been restored.

### What happened
- The host commit-exhaustion reboot landed (page file now fixed 32 GB, ~55 GB free commit). The broker
  was DOWN (dead pid `16612`, last `PASS 6` at `18:51:27Z`).
- Recovery: `resume` cleared 4 stranded submissions (pm `90494`, impl `90497`, scribe `90500`, auditor
  `90559`); restart with the local env (PolyStrata down) -> `START pid=10728` (`19:06:13Z`), `WAKE
  pm,impl,scribe,auditor`, `PASS 1..6`.
- `PASS 6` at `19:07:07Z` (`ms=5034`) emitted `wake-failed` for **qa conv 15** (`Session failed after a
  storage error`) and logged `WAKE-RETRY in=2000ms seats=qa`. No `PASS` followed for ~3.5 min: heartbeat
  stayed fresh (`19:07:57Z`, `19:08:57Z`), no `genlock.*`, broker CPU idle (2.7 s total). Terminated
  (`taskkill /F`) and restarted -> `START pid=11816` (`19:10:52Z`), which ran 30+ passes, woke
  `impl/qa/scribe/auditor/pm`, and logged **zero** `wake-failed`.

### Open question / root cause
**UNVERIFIED.** Two shapes fit and cannot be told apart from outside: (a) the retry pass never ran (the
scheduled deadline did not produce a pass); or (b) the retry pass ran but **hung before its `PASS` line**
(e.g. inside `drivePass`/`supervise`), which is invisible because `PASS` is logged only after the pass
work and `cmdServe` does not log `pass-failed`. During this window the local inference server (PolyStrata)
was also down, so a `qa` retry reaching for it is a candidate for (b). This is a **new detection/hardening
gap**: the retry re-arms the scheduler but does not guarantee an observable subsequent pass, and a hung
pass looks exactly like dormancy.

### Prevention (updated)
- `991567d` + `0c0d4d3` remain the fix for the scheduler dormancy.
- **New, owed:** make a retry pass's start observable — log the pass attempt *before* the work, so a hung
  retry is distinguishable from a retry that never ran. Fold into ROADMAP 78 (log `pass-failed` + the
  nested `SessionFailed.cause`).
- **Watchdog** (ROADMAP 61-64) would catch this regardless of shape: stale `PASS` + fresh heartbeat means
  "terminate and restart", never "trust the heartbeat".
- The local-server dependency is documented in `docs/runbooks/local-provider-down.md`.

### Recurrence 8 reproduced live — root cause found and fixed (2026-10-18T19:29Z)
The shape recurred twice more on the recovered broker and was pinned (the earlier "open question" above is
superseded):
- pid `11816`: `PASS 33` at `19:16:30Z` (`ms=5047`, `wake-failed` **pm conv 3**) + `WAKE-RETRY in=2000ms
  seats=pm`, then no `PASS` for ~4 min (fresh heartbeat, no genlock, low CPU).
- pid `3416`: `PASS 7` at `19:22:58Z` (`ms=5056`, `wake-failed` **lead**) + `WAKE-RETRY in=2000ms
  seats=lead`, then no `PASS`.

**Root cause.** The retry re-armed only when a pass emitted a per-seat `wake-failed`. The retry pass can
instead throw in a **store read that runs before any seat wake** — `documentState` / `inspect` /
`reconcileStrandedSubmissions` / `readStoppedConvIds` in `drivePass`, which are NOT wrapped by `onError` —
so the pass threw with `failedThisPass` empty and the post-`finally` retry (keyed only on
`failedThisPass`) never ran. `991567d` fixed the "wake-failed then a later throw in the SAME pass" case,
not a throw with no wake-failed at all.

**Fix `6e27ac2`.** `runWakeLoop` records `passThrew` per pass and schedules the retry (same bounded
backoff) when `failedThisPass.size > 0` **OR** the pass threw; a throw-only retry logs
`WAKE-RETRY in=… seats=- pass-threw`. `demo/broker-wake-retry.test.mjs` gained the scenario "the retry
pass throws in a store read (no wake-failed)": RED on the prior code (`passes=1`, seat never woken),
GREEN now (`passes=2`, seat woken, `liveScans=2`); full `demo/*.test.mjs` **143/143**. Independent verify
to be routed (the delegate authored this code).

### Prevention (updated)
- `991567d` + `0c0d4d3` + `6e27ac2` now cover the three shapes: wake-failed, wake-failed-then-same-pass
  throw, and whole-pass throw.
- **Still owed:** log the pass attempt BEFORE the work (or `pass-failed` + `SessionFailed.cause`,
  ROADMAP 78), so a truly hung pass is distinguishable from a retry that never ran.
- **Watchdog** (ROADMAP 61-64) would catch any residual shape: stale `PASS` + fresh heartbeat means
  "terminate and restart", never "trust the heartbeat".
- The local-server dependency is documented in `docs/runbooks/local-provider-down.md`.

### Evidence (recurrence 8)
- `selfdev.sqlite.broker.log`: `START pid=10728` `19:06:13Z` .. `PASS 6 ms=5034 woke=-` `19:07:07Z` +
  `WAKE-RETRY in=2000ms seats=qa`, then no line until `START pid=11816` `19:10:52Z`.
- `.spike/serve.err`: `{"driver":"wake-failed","seat":"qa","conversationId":15,"error":"SessionFailed:
  Session failed after a storage error; close and reopen it"}` (this file is truncated on each restart, so
  the line must be captured before the next launch).
- `broker.json`: heartbeat `19:07:57Z` and `19:08:57Z` while the log had no pass since `19:07:07Z`.
- PID `10728` CPU 2.7 s total and no `genlock.*` at diagnosis.
- Recovery: `resume` -> `found=4` (pm/impl/scribe/auditor `run-cancelled`), then `found=3` (impl
  `90581`, scribe `90584`, auditor `90587`); restart pid `11816` reached `PASS 32` by `19:14:01Z` with
  zero `wake-failed`.
- Related: `docs/incidents/2026-10-18-host-resource-exhaustion.md` (why the broker died),
  `docs/runbooks/local-provider-down.md` (the PolyStrata dependency).
- Live reproductions: pid `11816` `PASS 33 ms=5047` + `WAKE-RETRY seats=pm` (no `PASS` for ~4 min); pid
  `3416` `PASS 7 ms=5056` + `WAKE-RETRY seats=lead` (no `PASS`). Both frozen heartbeats, no `genlock.*`.
- Fix `6e27ac2`; RED->GREEN captured before/after in `demo/broker-wake-retry.test.mjs` (new scenario
  `passes=1`, `submissions=0`, `liveScans=1` -> `passes=2`, `submissions>=1`, `liveScans=2`); full suite
  143/143; restart pid `16368` (`19:29:58Z`) with no false dormancy.
