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
