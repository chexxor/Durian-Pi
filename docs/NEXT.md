# durig — NEXT (current pointer)

**This file is the live pointer, not history.** `docs/STATUS.md` is history; `docs/ROADMAP.md` is the
backlog; `docs/SELFDEV.md` is the runbook. Update at the end of every session.

_Last refreshed: 2026-10-16 (delegate session, paused — TUI hardening H1–H4 done, H7 Tier 1/2, B1/H5 type-to-seat + bracketed paste; broker park diagnosed; pi-durable alignment review landed and folded into the roadmap as items 51–58; doc-site item 59 queued; broker-supervision design recorded — `docs/BROKER-SUPERVISION.md`, roadmap items 61–67, D71). Next agent: read **NEXT SESSION**; the later sections are historical._

> **Operator working agreement (2026-10-15): do not poll or wait on background seat runs.** Dispatch
> the `send`/`run` detached, note the pid and its `.spike/delegate/*.out` file, then hand back. The
> operator notifies you when a run completes. Do not loop `sleep`/`tasklist` to watch it.

## NEXT SESSION — START HERE

**Current item (next session): ROADMAP item 54 — `drivePass` wake-and-return** (the pi-durable
alignment review's rank-1 change; delegate-owned broker work). Stop awaiting the runs a pass woke
inside the tick; let the commit subscription drive the next pass; keep the **one** global `waitForIdle`
on loop exit (F11). Alternatives if the operator picks otherwise: **H6 resize** then **H8 anchored
scroll** (TUI plan §C), or **ROADMAP item 52** (attach the TUI as a state-backed client) — 52 is
**gated on item 55** (a `security.sec` position before any attach socket). The standing priority list
is `docs/TUI-IMPLEMENTATION-PLAN.md` §"Priority order".

**Queue work running alongside:** **#662** (TUI C4 close-out — 48-col golden + lifecycle cleanup,
queued to `impl`) and **#710** (the `src/tui/driver.mjs` comment fix, queued to `impl`). ROADMAP item
54's own queue id is pending `pm` registration of the 51–58 batch.

**Landed this session (2026-10-16, delegate):** H3 DECSET 2026 synchronized output (`40f454b`); H4
grapheme-cell width, `src/textwidth.mjs` (`09e6d8d`); the TUI testing framework — shared fixtures + a
cell `ScreenBuffer` + 8 golden frames incl. the 48-col floor, `demo/tui-suite.mjs` (`aea7e74`;
`npm run test:tui` now **14/14**); B1+H5 — the type-to-seat input line (`i`, Enter → `writeIntent`,
Esc/Ctrl+C) with bracketed paste (`9af85d0`); and docs — `docs/BROKER-ARCHITECTURE.md`,
`docs/PI-DURABLE-INTEGRATION.md`, the two research reports, and the roadmap backlog items **45–59**.
The test harness immediately found a real bug (the conversation header overflowed 48 columns) — fixed
and frozen in a golden.

**Broker (diagnosed):** the resident broker (pid 34440) was parked ~15 minutes on a degenerate `qa` run
(`PASS 185` → `PASS 186`); `PASS 186` then delivered the `advocate`+`scribe` intents
(`INTENT delivered=2 dead=0`). Two `pm` intents are **spooled, not yet delivered** (registration for
the ownership items 45–50 and the doc-site item 59). The diagnosis and the fix are item 54.

**Open rulings:** the security position (55); the D11/Level-2 ruling for the TUI attach (52); and TUI
plan §D-G1–G4 (prose-measure cap, alt-screen receipts, D69/D61 supersession). `pm` registers/sequences
backlog 52–59 — the delegate does not route queue items.

**Blockers / owed:** (a) the `docs/DECISIONS.md` alignment entry is **owed** but editing it is blocked
because `DECISIONS.md` is dirty with **another item's** edit (the D61 citation correction) and staging
the file would carry that work — leave it to that item's owner. (b) The working tree holds other items'
files (`cli.mjs`, `docs/DECISIONS.md`, `docs/FEATURES.md`, `docs/STATUS.md`, `demo/init.test.mjs`) —
**do not discard**.

**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status`; run the hermetic TUI
regression with `npm run test:tui`. If the broker is stopped, restart it with
`DURIG_DB=./selfdev.sqlite node cli.mjs serve` once no writer is in flight.

**State at this refresh (2026-10-16, delegate session, paused):** store is single-writer; the broker is
the owner; `vendor/eval/` (reference clones) and `vendor/pi-main/` are gitignored.

**.

**Test flakiness under a live broker — finding + mitigations (2026-10-16):** running
`demo/*.test.mjs` while the broker drives gave **71/78**; re-running the 8 failures individually gave
**7 pass** (flaky) + `config.test.mjs` (a legit #621 failing-first RED). Grounded causes and fixes:
- **Inherited repo config**: demos spawn `cli.mjs` with `{...process.env}` and so pick up the local
  `durig.config.json` (`DURIG_MAX_CONCURRENT_SEATS: 4`, a real provider/model, and — the worst part —
  `DURIG_DB: C:/Users/Alex/dsh-Projects/tapl-decompile/durig/tutor-pi.sqlite`, a DIFFERENT project's
  store, so a demo that forgets to override `DURIG_DB` reads the wrong database — this is the live
  `no seats in …tutor-pi.sqlite` error seen in impl's log). Fix: a hermetic test env (temp `DURIG_DB`,
  `DURIG_MAX_CONCURRENT_SEATS=1`, `DURIG_PROVIDER=faux`, and do not read the repo config).
- **Live working tree**: tests `copyFileSync("rig.starter.json", …)` and read other tracked files a seat
  is mid-editing. Fix: read fixtures from HEAD (`git show HEAD:<path>`) or run the suite from a frozen
  worktree.
- **Fixed-timeout waits**: several demos `setTimeout(…, 5–10s)`; under CPU load the wait fires early.
  Fix: poll-until-condition with a generous deadline.
- **Resource contention**: concurrent `serve`/sqlite/temp-dir churn. Fix: run the suite **with the broker
  stopped** (or in a per-task worktree) via a single `npm test` runner that isolates the env and retries
  a timeout-flake once.

Known blockers: none for the delegate work. The shared tree is dirty with #623's in-flight `cli.mjs`
and a seat's `docs/STATUS.md` edit — **DO NOT discard**; stage explicit paths only. The resident
broker is **stopped** (it exited `reason=stop` after the delegate session); restart it with
`DURIG_DB=./selfdev.sqlite node cli.mjs serve` once no `send`/`run` writer is in flight (the advocate
consult is one). **Docs landed:** D63/D64 (`0ecf9cf`), D65 (`b81e171`), D66 (this session).

_Historical (superseded): the #480-era notes below were written for the 2026-10-15 handoff._

**Future work (candidate items — not yet queued):**
- **TUI app implementation plan** — the operator-approved plan of record is
  `docs/TUI-IMPLEMENTATION-PLAN.md`. Its §C hardening items H1–H5 (sanitise untrusted text at every
  render boundary; synchronous restore on abnormal exit; DECSET 2026; grapheme/EAW-correct width;
  bracketed paste with the input line) carry the D70 posture and await `pm` registration. §D holds the
  open rulings (prose-measure cap, alt-screen receipts/search/copy/plain, D69/D61 supersession).
  Recorded facts: `ui.mjs` declares `pi-tui` but imports it nowhere, and the conversation scroll
  window is capped to the 24-entry page (`SCAN_LIMIT`).
- **TUI hardening (D70, operator-approved — folded into the plan above):** sanitise untrusted text at
  the render boundary; synchronous restore on `uncaughtException`/`unhandledRejection`/`exit`;
  DECSET 2026 around `paintScreen`; grapheme/EAW-correct width. Bracketed paste (DECSET 2004) is
  required by the type-to-seat input line, not optional polish.
- **Agent ownership (from `docs/reviews/Agent_Ownership_Review.md`)** — action items 45–50 in
  `docs/ROADMAP.md` §“Agent ownership and accountability”. Verdict: no RACI/DACI/RAPID/MOCHA; keep
  artifact-keyed ownership but make it `check`-enforced (item 46, `src/checkup.mjs`); record the
  no-RACI decision (item 45, advocate); verification must **re-execute evidence** (item 48); finish the
  review's governance/cost passes (item 49). Surface decision (item 47) is already routed to
  advocate/scribe. Awaiting `pm` sequencing.
- **pi-durable alignment (research landed; items 51–58)** — `docs/reviews/pi-durable-alignment.md` is
  complete and its verdict is folded into `docs/ROADMAP.md` §“pi-durable alignment”. durig reimplements
  exactly two things the harness already provides: **client state** (the TUI poller → item 52, adopt,
  gated by the socket security position in item 55) and **busy-input** (`whenBusy:"steer"` → item 56).
  The rank-1 change is **wake-and-return in `drivePass`** (item 54). The review's explicit keep-list is
  recorded. **How-we-build doc for maintainers and upstream: `docs/PI-DURABLE-INTEGRATION.md`.**
  Awaiting `pm` sequencing.
- **Public doc site (item 59)** — `scribe` builds a GitHub Pages static site with a landing page,
  end-user pages, and maintainer pages, projecting from `docs/` (no duplication); the framework is an
  open decision. Depends on item 22 (the public repo). Awaiting `pm` sequencing.
- **Zero trust to zero agent (research requested 2026-10-16; ROADMAP item 60)** — narrow,
  per-seat / per-item least-privilege permissions for durig's seats. Owner: operator's research agent;
  report at `docs/reviews/zero-trust-zero-agent.md`; depends on item 55 (a `security.sec` position)
  before any new trust boundary. An operator intent to `pm` to register/sequence item 60 is **spooled
  in `selfdev.sqlite.broker.inbox/`** (pending the next broker pass), alongside the two earlier pm
  intents.
- **Broker supervision / host daemon (design recorded 2026-10-16; refined after round 3; ROADMAP items
  61–67; D71)** — `docs/BROKER-SUPERVISION.md` is the design of record: a logon Task (default) or
  Windows Service (opt-in) hosting a thin **`src/host.mjs`** (never opens the store) that supervises the
  sole-writer broker — exit-code taxonomy, a durable `<db>.broker.down` marker distinct from the existing
  `.broker.stop`, liveness/progress heartbeats (sleep is a resume-gap, not a clock), and the Job Object.
  Sequenced **after item 54** — and **item 54 is NOT done** (the scoped D65 wait still awaits the woken
  runs; wake-and-return is pending). Item **65** is a live single-writer hazard (genlock age-steals a
  live long generation, swallows `EPERM`, trusts reused pids) and should land regardless. Logon Task vs
  Windows Service is an operator ruling. Registered, not scheduled — awaiting `pm` sequencing.
- **Broker intent-inbox** — deliver intent to a seat WITHOUT stopping the broker (a file the broker
drains each pass, sibling to `.broker.stop`). Today `cmdSend` has no broker guard, so routing needs a
`serve --stop`, which interrupts in-flight work.
- **Reset at WORK-ITEM boundaries only** (deferred mitigation 3): clear a seat's context when it
finishes a work item — explicitly NOT finer item boundaries yet.
- **Mid-run cut** (optional): the degeneration guard resets BETWEEN runs; a provider-level turn cap
would cut a single runaway run mid-flight. (Bounded runs are mitigated; this is the residual gap.)
- **Worktree leak + recursion (NEW, observed 2026-10-16):** the broker's per-task worktrees
  (`item-1/`, `item-2/` in the repo root) are **not gitignored** and **not cleaned up**, so they
  pollute `git status`; and because the #506 fix “forks the visible state”, each new worktree
  **copies the existing untracked worktrees** (`item-2` nests a full `item-1/`) — recursive growth.
  Needs a lifecycle fix (ignore the worktree root + clean up on completion).
- **`docs/DECISIONS.md` entries** — LANDED (`0ecf9cf`): D63 (broker audit) + D64 (degeneration guard),
  plus the seat's stranded D54–D62. Remaining: fix D62's text corruption (`headless \tenderTui/Frame`).

## LANDED — broker liveness: re-wake per seat, not after the slowest run (delegate-owned; D65)

**Status: DONE.** `src/broker.mjs` `drivePass` waits only on the conversations a pass woke, races
that against the loop's commit signal, and `runWakeLoop` drains globally once on exit (F11);
`createWakeSignal` gained `race(promise)`; `PASS <n> ms=<dur> woke=<a,b>` is logged. Proof:
`demo/broker-liveness.test.mjs` (RED: 1 fast wake in 2 s → GREEN: 2nd wake ~27 ms in while the other
seat still generates). Commit `b81e171`. The narrative plan below is kept as the record of WHY.

**Why delegate-owned:** the fix is to the process that DRIVES the queue (the broker). A routed item
would sit behind the very broker it is meant to fix, so it must be done in the delegate seat directly
(code + tests + commit), then handed to the operator. The operator explicitly preferred this over the
durig team for that reason.

### Symptom (observed 2026-10-16, pid 17424)
`<db>.broker.log`: `PASS 5` at `02:26:13`, its wakes fired, then **no `PASS 6` for 40+ min** (still
none at `03:10`). Measured pass intervals for this broker: 20.5, 20.3, 4.5, 27 min. Meanwhile `status`
showed **pm idle with 9 queued DONE-notices** and **qa idle with 2 queued artifacts**
(`idle_with_queued_work`), and a generation was live (genlock `scribe` since `03:10:05`). So seats with
queued work sat idle while a run was in flight.

### Root cause — what is VERIFIED vs INFERRED
**Verified (code + vendored contract):**
- `src/broker.mjs:146` (`drivePass`) calls `await harness.waitForIdle(context)` — the HARNESS method.
- Its contract (`node_modules/@earendil-works/pi-durable/dist/harness/types.d.ts:668-669`):
  > `Harness.waitForIdle` — “Resolve when the ordinary ownership scope of **every** ownerless
  > conversation has no live non-background task.”

  (A per-conversation wait exists too: `Conversation.waitForIdle`, line 87.)
- Therefore every pass blocks until **all** ownerless conversations are idle. And `src/scheduler.mjs`
  treats a submission settling as wake-relevant (“a submission settling … is exactly when a stalled
  claim becomes wakeable again”) — so the loop cannot act on that per-submission intent while parked in
  the global wait.
- **Code path (the decisive one):** `src/broker.mjs:258-274` does `await drivePass(...)` and THEN
  `passes++; logBrokerLine(dbPath, \`PASS ${passes}\`)`. So `PASS` is written **only after `drivePass`
  returns**, and `drivePass` returns **only after line 146's `harness.waitForIdle` resolves**, which is
  only when **every** ownerless conversation is idle. Consequence (a code-path FACT, not an inference):
  **no pass boundary — and therefore no next wake of ANY seat — until every in-flight run settles**; a
  seat that finished early is not re-woken until the slowest run finishes.

**UNVERIFIED (relative contribution):** how much of the 20–44-min pass time is this wait versus the
pass TAIL (`worktreeClaimed` cleanup, `supervise`). There is **no per-pass duration instrumentation**
(`grep -n 'Date.now() - |durationMs' src/broker.mjs` → none), so the split cannot be isolated without
adding it (the Observability step below) or a controlled experiment — and a controlled experiment is
blocked by the single-writer rule plus the running broker. **The mechanism is code-verified; only the
proportion is not.**

### The tool that exists to fix it
`Scheduler.waitForIdle(conversationId | undefined, context)` and `Conversation.waitForIdle(context)`
wait for **one** conversation (`harness/scheduler.d.ts:86`, `harness/types.d.ts:669`). The loop can
wait per-WOKEN-seat and re-wake others as they settle.

### The fix (chosen direction)
1. In `drivePass`, replace the single global `await harness.waitForIdle(context)` with a wait that
   settles when every conversation **this pass woke** is idle (track the woken conversation ids; wait
   on those only — do NOT wait on conversations this pass did not wake). A settle that the commit
   subscription raises should be able to end the wait early so the next pass starts promptly.
2. Preserve the F11 invariant that actually matters: **never close the harness with a live run**
   (keep it open while ANY run is in flight), rather than “wait for global idle”.
3. Leave the scheduler floor (`minIntervalMs = 500`) and per-seat cooldown
   (`SERVE_SEAT_COOLDOWN_MS = 30_000`) as-is; optionally lower the cooldown once passes are short.
4. Keep the per-pass `supervise`, but it must not gate the wake path.

### Observability (part of the fix)
- Log each pass with its DURATION and the seats it woke: `PASS <n> ms=<dur> woke=<a,b,c>`.
- Add a liveness notice/measure: “seat has queued work and **no live generation lease** for > N s” —
distinct from the existing `idle_with_queued_work`, which cannot tell “waiting for the pass” from
“wedged”. Surface in `status` and as a `check` rule.

### Tests (failing-first)
- **New `demo/broker-liveness.test.mjs`:** two seats; make one run long (faux provider with a delay /
  multi-turn script), give the other queued work; assert the second seat's wake appears in the broker
  log within a bound (≈5 s) **while the first is still running**. RED against the current
  global-`waitForIdle` broker; GREEN after the fix.
- Keep `broker.test.mjs`, `broker-max-duration`, `broker-cooperative-stop`, `broker-wakepath`,
  `broker-log`, `autostart` green; `node --check` clean; whole `demo/*.test.mjs` suite green.

### Acceptance
- A long run on one seat does NOT delay waking another seat with queued work (proven by the demo).
- Pass duration ≈ the pass's own work, not the longest run.
- Never closes the harness with a live run (no stranded submissions).
- `stop` / `serve --stop` / `--max-duration` semantics unchanged.

### Constraints / gotchas
- **Restart the broker to test the fix** — editing source does not affect the running process.
- Single-writer: only one `serve`/`run`/`send` at a time on `./selfdev.sqlite`.
- The tree may hold in-flight seat work (#623 etc.) — **stage explicit paths only**, never `git add -A`.
- Native Windows only; never push/publish.
- Related, lower priority: the **broker intent-inbox** (below) would let a delegate deliver intent
  without a `serve --stop`; and the worktree-leak defect (below) shares the same pass lifecycle.

**Earlier this session: `pi-rebase` recovery (C) re-verified COMPLETE — no action taken.**
Evidence: `git diff --diff-filter=A main origin/pi-rebase -- . ':(exclude).spike'` is empty (no
tracked file on the snapshot is absent from `main`); `demo/pitui.test.mjs` is present on `main`;
the local branch is already deleted; `docs/BRANCH-AUDIT-2026-10-14.md` records the recovery as
executed. Do NOT re-apply the snapshot (D48: adapt onto `main`, never restore a whole snapshot).

**Then (next queued item): #480 (U1) — build the `durig ui` driver (queue id #480; TOP PRIORITY; UNBLOCKED).**
The rest of the interactive-client series is **#481–#487 (U2–U7)**. U1 is the missing piece between
`src/tui/client.mjs` (a headless renderer) and the operator: a separate entrypoint that owns raw mode
+ key handling + the poll loop and paints `renderTui` frames (`cli.mjs` stays non-interactive, D21;
read-only, D11/D40).

Exact next command (drive the selfdev team; the seat root is the live tree):

`DURIG_SEAT_ROOT=C:/Users/Alex/dsh-Projects/pi-opendurig DURIG_DB=./selfdev.sqlite node cli.mjs send impl --body-file <body>`

and have impl `claim_work({ itemId: 480 })` FIRST — a plain `run` makes impl take its oldest queued row
(impl has ~36). Bounded alternative: `DURIG_SEAT_ROOT=C:/Users/Alex/dsh-Projects/pi-opendurig DURIG_DB=./selfdev.sqlite node cli.mjs run --max-duration 300`.

Known blocker: the store is **single-writer** — never run two `send`/`run`/`serve` at once. No
genlock/broker is held at handoff.

**Session state (2026-10-15 delegate handoff — do not re-derive):**
- **#473 (worktree lifecycle wiring) DONE and qa-VERIFIED.** qa's #477 verdict = PASS (68/68,
  `node --check` clean). qa's caveats: the demo does NOT exercise the live `drivePass` claim path
  (reviewed only), and 5 pre-existing silent-return catches remain (`src/broker.mjs:317,375`;
  `src/worktree.mjs:104,216,394`).
- **Model swap (D51):** the five former Qwen seats (`impl`, `qa`, `advocate`, `auditor`, `designer`)
  now run `zai-org/GLM-5.3-Flash`; `rig.selfdev.json` edited + `up --refresh` applied. No context reset
  was written — the operator may `reset <seat>` the five.
- **TUI re-prioritized** by pm into **#480–#487 (U1–U7)**: U1 driver, U2 team-wide multi-pane of
  actively-generating seats (live generation state, NOT queue depth), U3 in-place tool-call block,
  U4 pi-style tool bg/fg, U5 thinking parity, U6 re-open the bogus C4 verification, U7 poll-first vs
  Level 2 to lead/operator. pm also cleared the #188/#193 deferrals (#487).
- **Lower priority, NOT registered** (operator deferred): `watch`/`seatActivity` shows green "working"
  for ANY `claimed` row, so impl's **6 stale claims (#287, #289, #290, #291, #294, #335)** read as active.
  Two-part fix: resolve those rows (impl completes/cancels; pm cancels its five; #287 is lead's), and
  make green require a live lease/in-flight submission.

Then, in order:
1. **#473** — wire worktrees into claim/completion: on claim, create the item's worktree+branch and
   point the working seat's cwd/`DURIG_SEAT_ROOT` at it; on completion, commit ONLY the item's files
   on its branch, release the lock, `git worktree remove`. **#474 is GATED on #473** — do NOT put
   "commit before finishing" into any seat's instructions until the wiring is proven, or seats will
   commit from the shared tree and stage each other's work. #475 documents the model.
2. **GROOM THE QUEUE** — it is churning: **135 non-terminal** (impl 65, pm 44, qa 15). Most are
   `DONE`-report rows pm must process and artifacts qa must verify. `peek_queue(all=true)` is now
   uncapped (#433), so pm can enumerate; use `cancel_work` (D47) for stale/duplicate rows.
3. **qa verification backlog** — #391/#393/#395/#449 (commit policy), #456/#458/#460/#462/#464/#466
   (broker + help + coordinator), #451 (TUI C3). qa's own DONE reports back to impl (#410–#448) also
   need settling.
4. **TUI** — C3 (#404) built, C4 (#405) reported "done but blocked" by qa; the corrected C4
   verification is owed. Designer UX follow-ups #437 (C6, done via #428), #439 (C7 defaults),
   #440 (C8 error messages), #442 (C9 rig auto-discovery), #444 (C10 meta-defaults). Advocate #407.
5. **#400** broker wake-path verification; **#402** #148 half-2 seam (cmdUp --refresh); **#415**
   verify the concurrency statement against code.
6. **Docs gate items #390/#398/#401/#468–#471** — much of this was written by the delegate this
   session (FEATURES/STATUS/SELFDEV), but the items are still open; have scribe verify and close them
   rather than redo the work. `scribe` is `last_run_failed` (wedged on #468) — `reset scribe` first.

## What landed this session (all LOCAL — unpushed; operator holds push)

`main` is at the handoff commit; the six code/doc commits through **`ddd9c49`** are now on
**`origin/main`** (pushed externally — NOT by the delegate), and only the handoff commit is local.
Tree clean, suite **68/68**.

| Commit | Content |
|---|---|
| `80ac4d5` | **#330 Phase 2** — per-task worktree lifecycle + Windows Job-Object reaping |
| `5b21763` | **#384–#386/D50** — developer commit authority; commits scoped to the item |
| `5ecddd1` | **#428–#433** — broker bounds/cooperative-stop/log/concurrent attribution; `--help`; uncapped `peek_queue` |
| `e28a653` | **TUI C3** client (`src/tui/client.mjs`) + read-layer proofs |
| `82a89f2` | **docs** truth-up (FEATURES/STATUS/DECISIONS/SELFDEV/WORKFLOWS/SELF-ADMIN/NEXT) |
| `ddd9c49` | **fix(test)** — broker demos no longer swallow cleanup errors |

Note: `git grep -n "claimWorktree" -- cli.mjs src/` returns only `src/worktree.mjs` — the wiring is
the whole point of #473.

## Pitfalls that slowed this session down (read before driving)

- **`run`/`serve --max-duration` is now a real bound (#429), but it was not** — a `--max-duration 300`
  broker ran >15 min. If you see that again, it is the defect, not your invocation.
- **`stop <seat>` aborts the run but leaves the `send` parent process alive.** `resume` finds nothing.
  After a `stop`, check for a lingering `node cli.mjs send ...` and `taskkill /F /PID` it. (Recorded
  lesson.)
- **A forced kill leaves a STALE genlock slot** (`.genlock.N`, dead pid) and the next driver may warn
  `held by pid <dead>` / `pid undefined` and stall. Check `selfdev.sqlite.genlock.*`; remove the ones
  whose pid is dead (they are lock files with no work).
- **A stop can also leave `cli.mjs serve --help`-style stray processes.** `Get-CimInstance Win32_Process`
  filtered on `cli.mjs (send|run|serve)` is the fast check.
- **Seats thrash on hard native-interop work** (the P2-6 Job Object cost ~2 h across two abort/reset
  cycles). Give a bounded instruction; if the seat ignores it, `stop` + `reset <seat> <handoff>` and
  re-scope — do not let it run.
- **The broker/driver order is oldest-first per seat.** New priority items sit behind a 60-item
  backlog, so `claim_work({itemId})` via a direct `send <seat> --body-file` is the way to prioritize;
  grooming is the structural fix.
- **Two writers, precisely.** One *store/harness* writer per DB (two `run`/`send` drivers race on the
  entry id, F24; `run`/`up` are not retried). Concurrency is `serve` + `DURIG_MAX_CONCURRENT_SEATS`.
  Per-task worktrees will make concurrent *editing* safe once #473 lands.
- **Full suite > 120 s** so a single tool call times out; loop `demo/*.test.mjs` per file with a long
  timeout, or background it. Baseline is now **68/68** (the old `starter.test.mjs` CRLF failure is FIXED).
- **`edit` needs exact indentation and line endings.** The demo tests use 2-space indent; `src/rig.mjs`
  and others are CRLF. When a match misses, run `sed -n 'A,Bp' file | cat -A` before retrying.
- **Empty `catch {}` violates "errors are not swallowed"** and the warden flags it. Reporting it
  surfaced two real bugs in the broker demos (a scoped `broker` ReferenceError and `require` in ESM).
- **Seats clean up badly:** scratch appeared as `docs/WORKFLOWS.md.tmp`, `test.log`, and
  `undefined.broker.log`. The last one is a real bug: `src/broker.mjs` `brokerLogPath(dbPath)`
  returns `` `${dbPath}.broker.log` ``, so a falsy `dbPath` writes `undefined.broker.log` (it
  regenerates on a suite run). Guard against a falsy `dbPath` (no-op or throw). `git status` before
  every commit.
- **qa sometimes marks an item done while reporting it blocked** (#336/C4). Check the result text.

## Workspace state for the next agent

- **No writer is running on `./selfdev.sqlite`** except the detached `send advocate` consult
  (`.spike/delegate/advocate-consult.*`) — do **not** start a second `serve`/`run`/`send` until it
  exits, then restart the broker with `DURIG_DB=./selfdev.sqlite node cli.mjs serve`. Two drivers on
  one store double-wake (D45/D46).
- **The tree is DIRTY with #621's in-flight work** (`cli.mjs`, `src/config.mjs`, `demo/config.test.mjs`,
  `durig.config.default.json`) — **DO NOT discard**; it belongs to the claimed item. `item-1/`,`item-2/`
  are leaked worktrees (see the NEXT SESSION note).
- **Backups under `.spike/delegate/`**: `recovery-WIP.patch`, `storewrite-WIP.mjs`,
  `p2-6-scratch/` (the Job-Object attempts), `scratch-backup/` (the removed scratch), and the
  intent bodies used this session. `.spike/` is gitignored.
- **Env**: run with `DURIG_DB=./selfdev.sqlite` and `DURIG_SEAT_ROOT=C:/Users/Alex/dsh-Projects/pi-opendurig`.
  `durig.config.json` sets `DURIG_MAX_CONCURRENT_SEATS=4` (local, gitignored) for concurrency testing.
- **Native Windows only** — never `wsl`, `docker`, `docker-compose`.

## Traps (standing — do not repeat)

- **NEVER run `git stash`/`reset`/`checkout`/`restore`/`clean` from a seat** — not with a trailing
  `;`/`&&`/`|`. The guard catches the anchored forms (#329) but the denylist is only a backstop.
- **Only a write-side process wakes seats** (`send`/`run`/`serve`); viewers never do (D11).
- **Coordinators (pm/lead) cannot read/write files** (#156) — route file tasks to a file-capable seat;
  `peek_queue(all=true)` now mitigates the enumeration half.
- **A seat can wander or degenerate** (F29) — `reset <seat> <handoff>` then re-drive.

## Where main is

`main` = **`6cfe481`** (this handoff commit); **`origin/main` = `c3a2671`** — `main` is **ahead by 30
commits**, all local (the operator holds push). Do not assume anything is pushed.
Untracked/ignored: `.spike/`, `pi-warden.md`, `vendor/`, and `item-1/`+`item-2/` (leaked worktrees —
currently NOT ignored, which is the defect).
