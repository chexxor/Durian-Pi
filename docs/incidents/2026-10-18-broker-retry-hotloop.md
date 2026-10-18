---
incident: broker-retry-hotloop
date: 2026-10-18
severity: sev1
status: open
symptom: "the broker stays alive but spins: `WAKE-RETRY … pass-threw` every ~0.5s, the intent inbox never drains, and `serve --stop` does not stop it"
runbook: broker-down-or-stalled
fix: null
prevention: "queued defect (delegate intent f27a8772) to bound the inbox-driven re-trigger and honour .stop on the throwing path + ROADMAP 78 (log pass-failed); AND when the throwing seat's document is corrupt, `store-corruption-recovery.md` (`repair-pi-live.mjs`) is a PREREQUISITE — a plain terminate+restart does NOT clear a persistent throw (recurrence 2026-10-18T20:56Z)"
last_reviewed: 2026-10-18
---

# The broker hot-loops on a persistent pass throw, so spooled intents never drain and `serve --stop` is defeated

*Incident 2026-10-18; detected by the delegate while routing D107; analysis by the delegate.*

## Summary
After the recurrence-8 retry fix (`6e27ac2`) kept the broker alive through a persistent storage error, a
different failure shape appeared: the broker **hot-looped** — a `WAKE-RETRY … pass-threw` line roughly
every 0.5 s while each line still claimed `in=60000ms` — so the scheduled backoff did not gate the next
pass. The throw happened before the spooled intents could be drained, so the intent inbox stayed
non-empty, each loop turn re-marked the scheduler dirty, and another failing pass started — the
self-sustaining loop the Root cause section names.
`node cli.mjs serve --stop` returned `stopped:true` and cleared `broker.json`, yet the process kept
spinning. Recovery was `taskkill /F` + restart; the fresh broker drained both pending intents on its
first pass.

## Timeline
- `20:02:08Z` `PASS 124 ms=5048` + `WAKE-RETRY in=2000ms seats=qa pass-threw` — the persistent storage
  error begins; `.spike/serve.err` names `wake-failed … qa conv 15 … Session failed after a storage error`.
- `20:05Z` broker restarted (pid `5840`) on the recurrence-8 fix; passes advance cleanly at first.
- `20:26–20:28Z` the loop is at full spin — `WAKE-RETRY in=60000ms seats=- pass-threw` every ~0.5 s
  (`20:27:17.584`, `18.084`, `19.584`, `20.084`), **823** such lines over the window.
- `20:27:20Z` two spooled intents (D107 `37e9a77b`, reliability `17fef81f`) sit undrained in
  `selfdev.sqlite.broker.inbox/` (2 files).
- `20:27:4xZ` `serve --stop` → `stopped:true`, `broker.json` cleared, but pid `5840` keeps looping.
- `20:27:56Z` `taskkill /F /PID 5840` (no genlock held); restart → `START pid=3296` (`20:28:02Z`);
  first pass `INTENT delivered=2 dead=0 dup=0`; `PASS 1..17` advance; inbox empty.

## Impact
The team was effectively stalled for ~25 min (the broker burned passes without driving seats or draining
intents) and **two operator-policy intents** (D107 and the local-model reliability findings) were blocked
until the restart. No data loss; the store opened cleanly after restart and `repair-pi-live` later found
no corruption.

## Root cause
**UNVERIFIED.** The working hypothesis — to be confirmed by the queued defect `f27a8772` — is the
inbox-driven re-trigger: the idle branch marks the scheduler dirty whenever the intent inbox is
non-empty (`if (dbPath && readIntentFiles(dbPath).length > 0) { scheduler.markDirty(); continue; }`). A
pass that throws **before** `drainIntentInbox` completes leaves the intent files in place, so every
subsequent loop turn re-marks dirty and runs another failing pass, bypassing `cooldownRevisitAt`/backoff.
The post-pass `.stop` check then never gets a quiet turn, which is why `serve --stop` was ineffective.
The underlying per-conversation storage error is the same still-UNVERIFIED class as the dormant-stall
incident.

## Detection
Human/tooling only: the delegate read the broker log while checking intent delivery. There is no
`status`/`check` attention for "passes advancing but throwing" or for a hot loop; `pass-failed` is not
logged by `cmdServe` (ROADMAP 78), so the throwing pass is visible only through the `WAKE-RETRY` lines.

## Resolution
Terminated the spinning broker (`taskkill /F`, no genlock), then restarted with the local env
(`scripts/serve-noroot.ps1`). The fresh broker's first pass drained both pending intents
(`INTENT delivered=2`) and passes resumed.

## Prevention
- Queued defect (delegate intent `f27a8772`, to `pm`): bound the inbox-driven re-trigger so it cannot mark
  dirty faster than the backoff while consecutive passes throw, and honour a `.stop` request on the
  throwing path. `fix: null` until that lands.
- ROADMAP 78 (log `pass-failed` + the nested `SessionFailed.cause`) makes a throwing pass legible; still
  owed.
- Runbook `broker-down-or-stalled.md` gained a hot-loop Diagnose entry + this Evidence line.

## Evidence
- `selfdev.sqlite.broker.log`: `20:02:08.217Z WAKE-RETRY in=2000ms seats=qa pass-threw`; `823`
  `pass-threw` lines; tail `20:27:17.584`→`20:27:20.084` at ~0.5 s spacing, each `in=60000ms`.
- `.spike/serve.err`: `wake-failed … qa conv 15 … Session failed after a storage error`, plus repeated
  `supervisor … reason:"degeneration"` (scribe/auditor/pm).
- `serve --stop` → `{"stopped":true,"pid":5840}` and `broker.json` absent, while pid `5840` kept logging
  `pass-threw`; resolved by `taskkill /F /PID 5840`.
- Restart: `START pid=3296` → `INTENT delivered=2 dead=0 dup=0`; `selfdev.sqlite.broker.inbox/` empty.
- Fix under test: `6e27ac2` (`src/broker.mjs` retry on `failedThisPass.size > 0 || passThrew`);
  `demo/broker-wake-retry.test.mjs` covers wake-failed, same-pass-throw, and store-read-throw — but NOT a
  persistent throw with a pending intent, which is this shape.
- Defect intent `f27a8772` (`.spike/delegate/intent-defect-retry-hotloop.md`).

## Recurrence — 2026-10-18T20:56Z→21:15Z: a PERSISTENT throw defeats the restart remedy

**What is new.** The original hot loop was cured by terminate + restart because its trigger was
transient. This recurrence proves the remedy is INSUFFICIENT when the throwing cause is PERSISTENT.
Broker pid `5768` was started (a fresh run after the previous `taskkill`) at `20:47:55Z` and ran clean
passes for ~9 min (`PASS 61..90`), then froze on `PASS 90 ms=5056` @`20:56:54Z` and never passed again.
It emitted the bounded `WAKE-RETRY` schedule, then reverted to the unbounded ~0.5 s spin:
`21:15:52.776`, `53.276`, `53.776`, … (`1414` `WAKE-RETRY` lines by `21:15:43Z`). The restart cannot
clear a corrupt `pm` conv-3 document, so each retry pass throws on the same read and re-marks the
scheduler dirty — the same Root cause as above, now with a non-transient trigger.

**Consequence for the runbook (now recorded there):** whenever the throwing seat's document is corrupt,
`store-corruption-recovery.md` (`scripts/repair-pi-live.mjs <db> <conversationId>`) is a PREREQUISITE of
the hot-loop recovery, not an alternative to it. A bare terminate+restart loops again.

**Evidence (recurrence).**
- `selfdev.sqlite.broker.log`: `START pid=5768` @`20:47:55.929Z`; clean `PASS 61..90`; last
  `PASS 90 ms=5056` @`20:56:54.743Z`; then `WAKE-RETRY … pass-threw`, ~0.5 s apart from ~`21:15:2xZ`;
  `1414` `WAKE-RETRY` lines total.
- `.spike/serve.err`: `wake-failed … pm conv 3 … Session failed after a storage error` — the SAME text
  before and after the `20:47:55Z` restart, i.e. the restart did not clear the trigger.
- `broker.json` heartbeat stayed fresh while `PASS` was frozen — a fresh heartbeat is NOT health.

## Links
`docs/runbooks/broker-down-or-stalled.md` · `docs/incidents/2026-10-18-broker-dormant-stalled.md`
(recurrence 8, the fix this follows from) · `docs/incidents/2026-10-18-host-resource-exhaustion.md` ·
queue defect `f27a8772` (pending registration) · ROADMAP 78, 61–64.
