---
incident: broker-crash
date: 2026-10-17
severity: sev1
status: open
symptom: "seats idle with queued work; no serve process; the broker log stops"
runbook: broker-down-or-stalled
fix: null
prevention: "ROADMAP 61-64 (host daemon/supervision); log SessionFailed.cause on wake-failed"
last_reviewed: 2026-10-17
---

# The broker dies abnormally and nothing restarts it

*Incident 2026-10-17; detected by the delegate; analysis by the delegate.*

## Summary
The resident broker died abnormally **three times** on 2026-10-17 — `START` with **no** matching `EXIT`
in `selfdev.sqlite.broker.log` — and, because no supervisor exists, it stayed down: no seat was driven
and queued/claimed work waited indefinitely. On the third occurrence a recovery restart **also died**
(~6 s in, on the same storage error), so the crash is not a one-off. The mechanism is partly
understood; the specific failure is **UNVERIFIED** (the nested error `.cause` is still not logged).

## Timeline
- `17:13:46Z` `START pid=34756`.
- `~17:29Z` pid 34756 dies on `SessionFailed` (`wake-failed` qa/lead); store backed up to
  `.spike/store-backup-20261017-123250`; restarted.
- `17:33:00Z` `START pid=19720`.
- `18:11:39Z` last `PASS 201 …` under pid 19720; then silence.
- Later: no `serve` process, no `broker.json`, no `genlock.*`; `security`'s claim stranded.
- `19:12:44Z` `START pid=36488` (recovery).
- `19:32:35Z` last `PASS 93 ms=5056 …` under pid 36488; then silence — no `EXIT` (third abnormal death).
- `19:49:04Z` the delegate handover committed `docs/NEXT.md` claiming the broker was UP (it was not).
- `19:51Z` recovery: `resume` cleared 3 stranded submissions (impl #67700, security #67887, security
  #68025); restart `START pid=14692` **died ~6 s later** on `Session failed after a storage error` —
  a crash loop.
- `19:53:33Z` second restart `START pid=37388` held and advanced (`WAKE impl`, `PASS 1-3`, 4 genlocks).

## Impact
No scheduler = no progress. `security` #1581 (claimed 17:48:29Z) never completed; `pm`/`impl`/`qa`
showed `idle_with_queued_work`. A dead broker stays dead until a human restarts it.

## Root cause
**UNVERIFIED.** The abnormal-death *signature* is verified (`START` with no `EXIT`). The handover named
a candidate class — a per-conversation storage error during a wake (every store open takes
`BEGIN IMMEDIATE` + DDL via migrations) — but the nested `.cause` is not logged, so the specific cause
cannot be named from the evidence.

## Detection
`status` attention `idle_with_queued_work` plus the absence of a `cli.mjs serve` process, plus
`broker.log` ending in `START` with no `EXIT`. There is no durable automatic detection (no supervisor).

## Resolution
Open. Manual restart per `docs/runbooks/broker-down-or-stalled.md`; `resume` clears stranded
submissions. No durable supervision yet.

## Prevention
ROADMAP 61–64 (host daemon: process liveness, boot/logout survival, backoff, stop handshake); log
`SessionFailed.cause` on `wake-failed`; a broker watchdog/auto-restart. See
`docs/BROKER-SUPERVISION.md`.

## Evidence
- `selfdev.sqlite.broker.log`: `START pid=34756` (17:13:46), `START pid=19720` (17:33:00) — no `EXIT`
  after either; last line `PASS 201 … ms=5047 woke=-` at `18:11:39`.
- `docs/NEXT.md` handover: `~17:29Z` `SessionFailed`; mechanism VERIFIED in code, specific cause
  UNVERIFIED; store backup `.spike/store-backup-20261017-123250`.
- Stranded inbox error: `selfdev.sqlite.broker.inbox.error/*.reason` = `unknown seat: ghost`.
- Quiescence probe: no `cli.mjs serve` process, no `broker.json`, no `genlock.*`.
- `selfdev.sqlite.broker.log`: `START pid=36488` (19:12:44) — no `EXIT`; last line `PASS 93 ms=5056`
  (19:32:35). Recovery: `START pid=14692` (19:51:13) then silence (fatal); `START pid=37388`
  (19:53:33) advancing.
- `.spike/serve.out` (failed restart) = `{"ok":false,"error":"Session failed after a storage error;
  close and reopen it"}`; `.spike/serve.err` shows `wake-failed` for impl (conv 9), qa (conv 15),
  security (conv 55605).
- `log impl` / `log security` read clean and `status` prints no `unreadable pi.live` — so this is a
  storage/lock error, NOT the corrupt-document case in `store-corruption-recovery.md`.
- Aggravator observed: 8 stale `log --follow`/`watch` viewer processes (started Oct 16-17) hold the store
  open; every store open runs migration DDL (`BEGIN IMMEDIATE`).

## Links
`docs/runbooks/broker-down-or-stalled.md` · `docs/BROKER-SUPERVISION.md` ·
`docs/incidents/2026-10-17-live-worktree-reap.md`
