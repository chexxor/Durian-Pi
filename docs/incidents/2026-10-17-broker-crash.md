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
The resident broker died abnormally twice on 2026-10-17 — `START` with **no** matching `EXIT` in
`selfdev.sqlite.broker.log` — and, because no supervisor exists, it stayed down: no seat was driven and
queued/claimed work waited indefinitely. The mechanism is partly understood; the specific failure is
**UNVERIFIED**.

## Timeline
- `17:13:46Z` `START pid=34756`.
- `~17:29Z` pid 34756 dies on `SessionFailed` (`wake-failed` qa/lead); store backed up to
  `.spike/store-backup-20261017-123250`; restarted.
- `17:33:00Z` `START pid=19720`.
- `18:11:39Z` last `PASS 201 …` under pid 19720; then silence.
- Later: no `serve` process, no `broker.json`, no `genlock.*`; `security`'s claim stranded.

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

## Links
`docs/runbooks/broker-down-or-stalled.md` · `docs/BROKER-SUPERVISION.md` ·
`docs/incidents/2026-10-17-live-worktree-reap.md`
