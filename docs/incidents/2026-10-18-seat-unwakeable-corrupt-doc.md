---
incident: seat-unwakeable-corrupt-doc
date: 2026-10-18
severity: sev2
status: resolved
symptom: "a seat is never woken; serve.err repeats wake-failed PathError: unresolvable path; status prints unreadable pi.live for conversation N"
runbook: store-corruption-recovery
fix: "scripts/repair-pi-live.mjs"
prevention: "runbook store-corruption-recovery updated (alive-broker shape + [\"tools\",0] variant); ROADMAP 78 (broker survives a per-conversation error)"
last_reviewed: 2026-10-18
---

# impl's `pi.live` goes unreadable and the broker can never wake it

*Incident 2026-10-18; detected by the delegate (broker `wake-failed` on impl); analysis by the delegate.*

## Summary
`impl`'s conversation 9 held a corrupt `pi.live` incarnation (doc `12105`) whose materialization threw
`unresolvable path: ["tools",0]`. Every wake of `impl` therefore failed: the broker logged
`wake-failed … PathError` **12×** while staying alive and PASS-advancing, so `impl` — the team's only
implementation seat — was **never driven** and its queue aged. Unlike the classic store-corruption
shape, the broker did **not** die; this was a single un-wakeable seat. The corrupt document was retired
with `repair-pi-live.mjs`, after which the broker logged `WAKE impl` / `PASS 16 woke=impl` and `impl`
resumed work.

## Timeline
- `~01:33Z` a `resume`/broker-stop cycle during the QA recovery cancelled an in-flight `impl`
  submission (`run-cancelled`); `impl`'s transcript then shows `last_run_failed: aborted` with two
  `[error] Tool powershell was aborted` results (`#79854`–`#79860`).
- `01:43:05Z` broker restarted as pid `17564` (QA recovery). From this point `.spike/serve.err` fills
  with repeated `wake-failed` for `impl` conv 9.
- `01:43–01:44Z` `serve.err`: **12×** `{"driver":"wake-failed","seat":"impl","conversationId":9,
  "error":"PathError: unresolvable path: [\"tools\",0]"}`; once
  `{"seat":"pm","conversationId":3,"error":"SessionFailed: Session failed after a storage error"}`.
- Diagnosis: `status` stderr → `unreadable pi.live for conversation 9 (unresolvable path: ["tools",0]);
  reading it as no in-flight partial`; `attention` → `impl last_run_failed: aborted`.
- `01:48Z` recovery (this session): `serve --stop` (pid `17564`, confirmed gone) → backup
  `.spike/store-backup-20261017-204831` → `node scripts/repair-pi-live.mjs ./selfdev.sqlite 9`.
- `01:48Z` restart → pid `28168`; `01:49:10Z` log shows `WAKE impl` / `PASS 16 ms=4 woke=impl`; `status`
  stderr clean; `impl` prepared `item-1881` and announced `#1894`.

## Impact
The **sole implementation seat was down** for the duration — no `impl` item could progress (its queue of
new and deferred items sat). QA, pm and the other seats were unaffected, and the broker stayed alive, so
the loss was one seat's liveness (and the downstream work waiting on it), not the whole rig. No data was
lost: retiring `pi.live` drops only the unreadable **in-flight partial**, not the durable transcript.

## Root cause
A **mid-run abort** left an orphaned append in `impl` conv 9's `pi.live`, so materialization throws
`unresolvable path: ["tools",0]` (the F14 shape — a base plus an append that cannot be resolved). With
the document unreadable, `readLiveState` fails on every wake, so the broker logs `wake-failed` and never
drives the seat. The **writer that emitted the orphan is UNVERIFIED**; the candidate is the
`resume`/broker-stop `run-cancelled` (or the harness abort of the in-flight `powershell` tool) around
`01:33Z`. Note the same doc id `12105` was retired once before (2026-10-16), so this is a **recurrence**.

## Detection
Mixed. The broker's `PASS` kept advancing and its heartbeat stayed fresh, so **neither was a health
signal** — the seat-level signal was repeated `wake-failed … PathError` in `.spike/serve.err` plus the
`status` stderr `unreadable pi.live for conversation 9` and the `last_run_failed: aborted` attention. A
human/delegate read those; nothing auto-flagged "broker alive, one seat un-wakeable."

## Resolution
Per `docs/runbooks/store-corruption-recovery.md`: stop the broker and confirm the process exited
(`stopped:true` was not trusted on its own); back up the store; `node scripts/repair-pi-live.mjs
./selfdev.sqlite 9` → `{"ok":true,"conversationId":9,"retired":[{"id":12105,"error":"unresolvable path:
[\"tools\",0]"}],"seq":847092}`; restart the broker (`scripts/serve-noroot.ps1`, pid `28168`). The next
run recreated a clean `pi.live`.

## Prevention
- **Runbook updated** (`store-corruption-recovery.md`): names the alive-broker shape, the
  `["tools",0]` path variant, the mid-run-abort cause, and a three-way Verify (broker log `WAKE`,
  `serve.err` clean, `status` stderr clean), plus mandatory front-matter.
- **Durable code fix owed:** ROADMAP 78 (survive the per-conversation error and name the nested cause)
  covers the broker; the writer that emits the orphaned append (the `#110` family) still needs proving —
  until then this can recur.
- `repair-pi-live.mjs` is idempotent (retires only documents that actually fail to read).

## Evidence
- `DURIG_DB=./selfdev.sqlite node cli.mjs status` stderr (2026-10-18):
  `unreadable pi.live for conversation 9 (unresolvable path: ["tools",0]); reading it as no in-flight partial`.
- `.spike/serve.err` (2026-10-18): **12×** `{"ok":false,"command":"serve","driver":"wake-failed",
  "seat":"impl","conversationId":9,"error":"PathError: unresolvable path: [\"tools\",0]"}` and 1×
  `{"seat":"pm","conversationId":3,"error":"SessionFailed: Session failed after a storage error; close and reopen it"}`.
- `DURIG_DB=./selfdev.sqlite node cli.mjs log impl 4`: `#79854`–`#79860`, ending in two
  `[error] Tool powershell was aborted` tool results; `status` attention `impl last_run_failed: aborted`.
- Repair: `node scripts/repair-pi-live.mjs ./selfdev.sqlite 9` →
  `{"ok":true,"conversationId":9,"retired":[{"id":12105,"error":"unresolvable path: [\"tools\",0]"}],"seq":847092}`.
- Recovery log: `2026-10-18T01:49:10.238Z WAKE impl` / `2026-10-18T01:49:10.238Z PASS 16 ms=4 woke=impl`;
  `status` stderr then only `note: 1 measure(s) out of band`; `impl` prepared `item-1881` and queued
  `#1894` (`RE #1841 — verify tip 22ae784; full suite 132/0`).
- Prior same-doc repair: runbook `store-corruption-recovery.md` Evidence (2026-10-16, doc `12105`).
- Backups: `.spike/store-backup-20261017-204831` (this incident).

## Links
`docs/runbooks/store-corruption-recovery.md` · `docs/incidents/2026-10-18-broker-dormant-stalled.md`
(same wake-failed class, dormant shape) · `docs/incidents/2026-10-17-broker-crash.md` · ROADMAP 78 ·
dogfood F14 / `#110`
