---
incident: stranded-submission-seat-stall
date: 2026-10-19
severity: sev1
status: open
symptom: "a seat is never woken while other seats run; status shows admitted_not_started (submission placed, no generation slot held)"
runbook: resume-while-broker-runs
fix: null
prevention: null
last_reviewed: 2026-10-19
---

# A seat stalls forever on a `placed` submission whose task is live but not running

*Incident 2026-10-19; detected by the delegate via `status` attention; analysis by the delegate.*

## Summary
`impl` (conversation 9) stopped working at `04:57:43Z` and was never woken again while
`devtools`/`pm`/`scribe`/`auditor` ran. Its newest submission (`#105938`) stayed `placed` across two
broker restarts. The broker's self-heal — `reconcileStrandedSubmissions`, which settles a stranded
submission so its seat can be re-woken — **skipped it because conversation 9 had a live task, even
though that task was not running** (no `genlock` slot, no run process). `selectWakes` then reads the
pending submission as "in flight" and suppresses every wake, so the seat stalls silently and
permanently. Only the external `resume`/`doctor` verb clears it, and `resume` is refused while the
broker drives.

## Timeline
- `04:57:43Z` — `impl` submission `#105938` is admitted (`entry 105937`). `impl`'s last `WAKE` in the
  broker log is `04:26:54Z`; its final transcript entries show it mid-demo on worktree pruning.
- `04:59:30Z`–`05:02:32Z` — broker `WAKE-RETRY … pass-threw` (storage/lock churn of the session).
- `05:03Z` and `06:07:26Z` — broker restarts; neither settles `#105938` (`impl` stays
  `admitted_not_started`). `STRANDED settled=` never appears in the log.
- `06:07Z`–`06:18Z` — the delegate lands two verified branches (broker stopped for the window), and
  then runs the sanctioned `resume` recovery.
- `06:19Z` — `node cli.mjs resume` (broker stopped) settles **6** strands: `impl #105938`; `pm #107554`,
  `#107651`, `#109532`; `devtools #110012`, `#110440`.
- `06:21:42Z` — broker restart wakes `pm` and `impl` (`PASS 1 woke=pm,impl`); the broker then
  wake-fails on `devtools` conv 4930 (`unresolvable path: ["generation","message","content",0]`).
- `06:24Z` — the delegate stops/kills the poisoned broker, repairs conv 4930, restarts (`pid 7984`).
  `pm`/`scribe`/`auditor` are re-driven; `impl` re-strands on the new submission `#110509` (admitted
  `06:21:42Z`) and is still stranded at `06:26Z`.
- `06:26:3xZ` — `devtools`, `pm`, `scribe`, `auditor` streaming; `impl` shows `admitted_not_started`.

## Impact
- One seat (`impl`) silently removed from the fleet for 80+ minutes; it owns the largest share of
  actionable work (31 `queued` + 1 `claimed`; 159 non-terminal items).
- The documented self-heal (`reconcileStrandedSubmissions`, run every pass) does **not** fire, and the
  documented manual remedy (`resume`) is refused while the broker is up — so recovery needs an operator
  stop/unblock cycle, and any broker interruption strands more seats.
- No data loss. The store stayed readable apart from the devtools conv-4930 recurrence below.

## Root cause
`reconcileStrandedSubmissions` builds its "live conversation" set from **every** task in
`inspection.tasks`, without filtering by task state (`src/broker.mjs:563-567`):

```js
const liveConvIds = new Set();
for (const task of inspection?.tasks ?? []) {
  const convId = task?.record?.conversationId;
  if (convId !== undefined) liveConvIds.add(convId);
}
...
if (sub.status !== "placed" || liveConvIds.has(sub.conversationId)) continue;   // :571
```

But the pinned `pi-durable` `harness.inspect()` returns the **live task records with a derived state
kind** — `running`, `completing`, `waiting`, `blocked`, or `ready`
(`node_modules/@earendil-works/pi-durable/dist/harness/harness.js:152-158` ->
`scheduler.js:758-767`). A task that is `live` but not `running` therefore marks its conversation as an
owner, so the `placed` submission is never settled, and `pendingConvIds` (`src/broker.mjs:905-910`)
suppresses every wake for that seat. The seat can never recover on its own.

Contrast the same file at `src/broker.mjs:343-345`, which correctly filters to running tasks
(`t.record?.state?.status === "running"`); the reconciler does not. Contrast `resume` itself
(`cli.mjs:1050-1056`), which treats a submission as stranded whenever the seat holds **no live
generation slot** — the guard the reconciler is missing.

**UNVERIFIED (inferred):** the exact reason conv 9's task was not running (e.g. `blocked` on a
dependency, or `ready` but never scheduled) could not be read, because inspecting task state requires
opening a second harness against a store the broker owns (the second-writer hazard). The skip is
proven by the absence of any `STRANDED settled=` line and the persistence across restarts; the task's
non-running kind is the only remaining skip condition.

**Recurrence (separate but linked) — devtools conv 4930 corruption.** During the 06:24 recovery the
broker `serve --stop` returned `stopped: true` while the process lingered in its F11 drain; `resume`
was run in that window (wrong order — I should have killed the lingering pid first). The broker then
wake-failed on `devtools` conv 4930 with `unresolvable path: ["generation","message","content",0]`,
and the next pass was poisoned (`Session is poisoned by a failed commit after storage admission;
… database is locked`). `scripts/repair-pi-live.mjs ./selfdev.sqlite 4930` retired doc `4931` and a
restart cleared it. This is a recurrence of `2026-10-18-seat-unwakeable-corrupt-doc`; the writer that
leaves the orphaned partial is still not proven, and the second-writer ordering is a candidate.

## Detection
`status` attention kind `admitted_not_started` (`src/attention.mjs:399-428`), which correctly fires on
"admission older than `STRANDED_ADMITTED_MS` AND the seat holds no live generation slot"
(`src/attention.mjs:416-425`). The gap is that the broker does not act on the same condition — the
notice tells the operator a seat is wedged, but the only fix (`resume`) is refused while the broker
runs, and broker restarts do not settle it.

## Resolution
- `DURIG_DB=./selfdev.sqlite node cli.mjs resume` (broker stopped) settled 6 strands — `impl #105938`,
  `pm #107554/#107651/#109532`, `devtools #110012/#110440` — after which `pm` was re-driven.
- `node scripts/repair-pi-live.mjs ./selfdev.sqlite 4930` retired the unreadable devtools `pi.live`
  (`retired:[{id:4931,…}]`, `seq:1148284`); broker restarted `pid 7984`, `PASS` advancing.
- **Service is NOT fully restored:** `impl` re-stranded on `#110509` and remains stalled. The record
  stays `open` until the durable fix lands.

## Prevention
**None landed yet (`prevention: null`).** The proposed durable resolution:

1. **Filter live owners by task state.** In `reconcileStrandedSubmissions` (`src/broker.mjs:563-567`),
   count a conversation as owned only by a task whose derived state is actually advancing — `running`
   or `completing` — not by any live task. Extract a pure, exported predicate
   `isAdvancingTask(task)` so it is unit-testable without a harness.
2. **Mirror `resume`'s guard as a backstop.** A `placed` submission with no advancing task and no live
   generation slot is stranded by definition (`src/attention.mjs:416-425`); settle it
   (`unanswered`/`stranded`) so `selectWakes` re-wakes the seat in the same pass. This makes the
   broker's self-heal match the notice and removes the need for an external `resume`.
3. **Failing-first demo** (`demo/broker-strand.test.mjs` extension or a sibling): a `placed` submission
   whose conversation has a live-but-not-running task must be settled by `reconcileStrandedSubmissions`
   and the seat woken in the same pass; and a submission whose task IS `running` must NOT be settled.
4. **Surface a non-running task's reason.** A live task that is `blocked`/`waiting` and holds a seat
   out of every wake should raise its own attention kind (with the block reason), so the operator sees
   *why*, not just `admitted_not_started`.

### Implementation plan (exact)

**Change 1 — `src/broker.mjs`** (add `isAdvancingTask` next to `reconcileStrandedSubmissions`, and
use it in the owner scan):

```js
/**
 * A task that can still advance its conversation's pending submission. ONLY a task with a live
 * invocation (`running`) or one finishing settlement (`completing`) owns the submission; a
 * `ready`/`waiting`/`blocked` task is itself stalled, and treating it as an owner strands the seat
 * forever (incident 2026-10-19-stranded-submission-seat-stall).
 */
export function isAdvancingTask(task) {
  const kind = task?.state?.kind;
  return kind === "running" || kind === "completing";
}

// in reconcileStrandedSubmissions:
const liveConvIds = new Set();
for (const task of inspection?.tasks ?? []) {
  if (!isAdvancingTask(task)) continue;   // <- the only change to the loop
  const convId = task?.record?.conversationId;
  if (convId !== undefined) liveConvIds.add(convId);
}
```

The settle itself (`:571-585`) and `pendingConvIds` (`:905-910`) are unchanged; once the stale task no
longer blocks settlement, `drivePass` wakes the seat in the same pass, exactly as the ROADMAP-68 path
does for an orphan with no task.

**Change 2 — failing-first demo.** Extend `demo/broker-strand.test.mjs` (do not replace the existing
orphan case):
- Build a conversation with a `placed` submission **and** a live task whose `state.kind` is
  `blocked`/`ready` (create it through the harness; if a live task cannot be fabricated from
  `MemoryStorage`, drive a run and abort it so the record survives in a non-running state).
- Assert `reconcileStrandedSubmissions` now settles it (`unanswered`/`stranded`) and that
  `drivePass` wakes the seat — the same assertions the orphan case uses.
- Unit-test the extracted predicate directly: `isAdvancingTask({state:{kind:"blocked"}}) === false`,
  `{"ready"}`/`{"waiting"}` false, `{"running"}`/`{"completing"}` true. This half is deterministic
  even if the live-task fixture proves hard.

**Verification.**
1. `node demo/broker-strand.test.mjs` — RED before Change 1, GREEN after (the failing-first proof).
2. `node scripts/suite.mjs` in a scratch worktree — no regressions.
3. Landing window per `docs/runbooks/land.md`: broker stopped and verified gone (no `cli.mjs serve`
   process AND `stopped:true`), shared-tree tracked WIP parked (the devtools WIP is already in
   `stash@{0}`), then `node scripts/land.mjs <branch> --suite`.

**Then update this record:** `status: resolved`, `fix: <sha|#item>`, `prevention: <demo path + the
check/demo>`, and bump `last_reviewed`.

## Evidence
- `DURIG_DB=./selfdev.sqlite node cli.mjs status` -> `impl … admitted_not_started: submission #105938
  admitted 4782s ago, no run started and no slot held`; `latestByConv["9"] =
  {status:"placed", entry:105937, id:105938, admittedAt:1792385863150}` (`2026-10-19T04:57:43.150Z`).
- `selfdev.sqlite.broker.log`: `grep "WAKE impl"` -> last `2026-10-19T04:26:54.522Z`; `WAKE devtools`
  continues `05:05:39Z`–`06:04:46Z`. No `STRANDED settled=` line exists after `2026-10-16`.
- `node cli.mjs resume` output (`06:19Z`, broker stopped): `found: 6` with actions
  `impl #105938 run-cancelled`, `pm #107554 run-cancelled`, `pm #107651 abortSubmission:settled`,
  `pm #109532 abortSubmission:settled`, `devtools #110012 run-cancelled`, `devtools #110440 withdrawn`.
- `.spike/serve.err`: repeated
  `{"driver":"wake-failed","seat":"devtools","conversationId":4930,"error":"PathError: unresolvable path: [\"generation\",\"message\",\"content\",0]"}`;
  log `PASS-FAILED … Session is poisoned by a failed commit after storage admission … cause=Error: database is locked`.
- `node scripts/repair-pi-live.mjs ./selfdev.sqlite 4930` ->
  `{"ok":true,"conversationId":4930,"retired":[{"id":4931,"error":"unresolvable path: […]"}],"seq":1148284}`.
- Queue census (`node cli.mjs queue`, 2510 items): `done 1995 / cancelled 277 / held 97 / deferred 92 /
  queued 38 / claimed 11`; non-terminal by assignee `impl 159`, `pm 20`, `devtools 19`, `auditor 16`,
  `lead 7`, `qa 6`, `security 5`, `scribe 4`.
- Code: `src/broker.mjs:563-576`, `:571`, `:343-345`, `:901-910`; `cli.mjs:981-1070` (`cmdResume`),
  `cli.mjs:995` (`refuseWhileBrokerDrives`); `src/attention.mjs:399-428`;
  `node_modules/@earendil-works/pi-durable/dist/harness/harness.js:152-158`;
  `…/harness/scheduler.js:758-767`.
- Store backup taken before repair: `.spike/store-backup-20261019-012422/`.

## Links
- Runbook: `docs/runbooks/resume-while-broker-runs.md`, `docs/runbooks/store-corruption-recovery.md`.
- Related incidents: `2026-10-18-seat-unwakeable-corrupt-doc.md` (recurrence on devtools conv 4930),
  `2026-10-18-broker-retry-hotloop.md`, `2026-10-18-broker-dormant-stalled.md`.
- ROADMAP 37(a)/(b) (stranded-admission notice + `resume` verb), ROADMAP 68 (strand settlement),
  ROADMAP 78 (pass-failure logging).
