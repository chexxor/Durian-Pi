# Architecture & code review — broker, CLI, UI, supervisor (edge cases + temporal faults)

**Status:** review delivered (architect, 2026-10-19). Item **#2520**. Durable decision: **D112**
(`docs/DECISIONS.md`).
**Scope (in):** `src/broker.mjs`, `cli.mjs`, the UI surface (`ui.mjs`, `src/tui/*.mjs`, `src/watchview.mjs`,
`src/readclient.mjs`, `src/brokerread.mjs`), `src/supervisor.mjs`, and the wake/task seam they sit on
(`src/driver.mjs`, `src/scheduler.mjs`, `src/genlock.mjs`) against the pinned pi-durable scheduler.
**Scope (out):** no implementation (this seat designs/reviews; it does not verify its own design).
**Base revision:** the `architect-item-2520` fork. **The shared tree is live** — another seat changed
`src/broker.mjs` between two of my reads (the `read` op moved from `harness.storage` to a
`readStorage` parameter). Every citation below is re-verified against the fork content with the grep in
each finding; re-run the grep before acting, and treat the line numbers as "as of this review".
**Method:** read the seed incident and the two daemon-harness reviews; read the seams in the tree; read
the vendored pi-durable (`vendor/pi-main/packages/durable/src/{errors.ts,session/session.ts,harness/scheduler.ts}`)
for the failure/lease semantics; ran the relevant demo suite as a baseline (all green — see §Evidence).

---

## 0. Topology and data flow (draw it before judging it)

```
operator / CLI verb ──(write)──▶ broker (cli.mjs serve)  ──owns──▶ Harness ──owns──▶ Storage(conn #1) ──▶ <db>.sqlite
        │                              │  runWakeLoop: drain inbox → inspect → drivePass → supervise
        │                              ├── owns──▶ probeStorage (conn #2, openStore)   ← SECOND opener (F8)
        │                              ├── .broker.json {pid, since, runToken, heartbeatAt}  (liveness only)
        │                              ├── .broker.stop  (ephemeral stop request)
        │                              └── .genlock.<i>  (cross-process generation lease)
        │
        ├─(read)──▶ readclient ──(spool `read` op)──▶ broker.dispatchRead ──▶ readStorage(conn #1)
        └─(read, no broker)──▶ openNodeSqliteStorage ──▶ direct owner
```

Two facts drive most findings: (a) the **process boundary** (operator ↔ broker) is coordinated only by
files (`broker.json`, `.stop`, `.genlock.*`), so *every* claim about "is the broker alive / is this seat
running" is a file-and-pid inference; (b) pi-durable's **failure model is terminal** — one storage error
fails the whole Session until close+reopen — while the broker's loop is written as if failures are
per-pass and retryable.

---

## 1. Ranked findings (headline)

Rank = end-user impact × likelihood × blast radius. Bug-fix/temporal/liveness items precede capability.

---

### F1 — `serve --stop` can report `stopped:true` while the broker is still alive and writing

1. **Symptom.** "I ran `serve --stop`, it said `stopped:true`, I started `up`/`resume`, and the store got
   corrupted / the broker threw `SessionFailed`."
2. **Mechanism.** `runWakeLoop` clears the heartbeat interval at `src/broker.mjs:1321` and then does an
   **unbounded** `await harness.waitForIdle(context)` at `src/broker.mjs:1322` before it writes `EXIT`
   (`:1325`) and returns; `cmdServe`'s `finally` clears `.broker.json` only *after* that returns
   (`cli.mjs:1750-1751`). `brokerAlive` (`src/broker.mjs:1385-1397`) returns **false** when
   `now - heartbeatAt > BROKER_HEARTBEAT_TIMEOUT_MS` (**60 s**, `:1379`). So a drain longer than 60 s makes
   a *live* broker read as dead. `cmdStopBroker` (`cli.mjs:1596-1615`) waits on exactly that predicate and
   then reports `stopped:true` (`:1610`) and calls `clearBrokerState(DB_PATH)` (`:1603`). The operator (or
   `up`) then opens a second writer while the broker still owns conn #1 → the 2026-10-16 double-writer
   corruption class.
3. **Blast radius.** Whole rig / whole store; recovery needs `store-corruption-recovery.md`
   (`repair-pi-live.mjs`). Window = the drain duration minus 60 s.
4. **End-user impact.** Correctness/data-risk, **H** (score 9/10): silent, irreversible, and it defeats
   the one rule the whole design rests on.
5. **Fix.** Two changes, both small: (a) do **not** stop refreshing liveness before the drain — write a
   `stopping:true` field (or keep the interval) until the process actually exits, so "alive" and
   "draining" are distinguishable; (b) make `stopped:true` require the **pid to be gone**
   (`process.kill(pid,0)` → `ESRCH`), not merely a stale heartbeat, and pass the observed pid to
   `clearBrokerState(dbPath, pid)` so a newer broker's state is never deleted. **Invariant restored:** a
   second writer is admitted only after the first has provably exited.
6. **Failing-first test.** A demo that starts a broker whose drain is longer than the heartbeat timeout
   (inject a `BROKER_HEARTBEAT_TIMEOUT_MS` and a `waitForIdle` that sleeps past it), issues
   `serve --stop`, and asserts `stopped:true` is emitted **only after** the pid is gone — RED today.
7. **Confidence.** **proven** (code path) + corroborated by the seed incident's recurrence: "`serve --stop`
   returned `stopped: true` while the process lingered in its F11 drain; `resume` was run in that window".

---

### F2 — A terminal `SessionFailed` is retried forever; the broker has no close+reopen recovery

1. **Symptom.** "The broker logs `PASS-FAILED SessionFailed … cause=Error: database is locked` forever and
   never drives again until I restart it."
2. **Mechanism.** pi-durable's failure model is **terminal**: `vendor/pi-main/packages/durable/src/errors.ts`
   (`SessionFailed`: *"The Session failed, so nothing runs or commits any more … Reopen the Session"*) and
   `session/session.ts` (*"Storage failures are final … Nothing retries … Reopening recovers"*). The first
   storage error fails the Session; every later call throws `SessionFailed`. `runWakeLoop`'s catch
   (`src/broker.mjs:1261-1276`) logs `PASS-FAILED` and the retry block (`:1298-1305`) schedules another pass
   against **the same dead Session**. `src/broker.mjs` never closes/reopens the harness (grep: no
   `harness.close`/reopen). So one transient `SQLITE_BUSY` past the 5 s busy window wedges the broker
   permanently; only a process restart (which reopens the Session) clears it.
3. **Blast radius.** Every seat, indefinitely (until restart). Observed: 04:59:30 → 05:02:32 doubling then
   flat-60 s, cleared only by `START pid=17828`.
4. **End-user impact.** Liveness, **H** (score 9/10): total rig stall with a fresh heartbeat.
5. **Fix.** Classify the failure before retrying. (A, reversible) detect `SessionFailed` (by `error.name`
   or the cause chain) and **tear down + reopen** the harness in-process, then re-drive; keep the bounded
   retry for genuinely per-seat/per-pass errors. (B, later) treat it as terminal and exit non-zero with
   `EXIT reason=session-failed`, for the host to restart (no host exists yet, so A first, B when
   `src/host.mjs` lands). **Trade-off:** A adds a reopen path and must not lose an in-flight run; B needs a
   supervisor that does not exist. **Invariant restored:** every failure class has a defined recovery.
6. **Failing-first test.** A demo with a storage wrapper that throws on the N-th commit: assert the broker
   drives a pass again after the error (RED today — it retries the dead Session forever).
7. **Confidence.** **proven** (code + vendor semantics). The *initial* `database is locked` cause is
   **UNVERIFIED** — see F8 and the appendix A1.

---

### F3 — `reconcileStrandedSubmissions` treats a live-but-not-running task as an owner, so a seat stalls forever

1. **Symptom.** "`status` shows `admitted_not_started`; a seat never wakes while the others run; the only
   fix (`resume`) is refused while the broker is up."
2. **Mechanism.** `src/broker.mjs:564-567` builds `liveConvIds` from **every** `inspection.tasks` entry with
   no state filter; `:571` skips settling a `placed` submission whose conversation is in that set.
   pi-durable's `TaskInspection` carries a **derived** `state.kind`
   (`running | completing | waiting | blocked | ready`; `vendor/pi-main/packages/durable/src/harness/scheduler.ts`
   `#inspectTask`). A `ready`/`waiting`/`blocked` task is itself stalled but marks the conversation owned,
   so `pendingConvIds` (`src/broker.mjs:912`, used by `driveOnce`) suppresses every wake. The notice
   (`src/attention.mjs`, `admitted_not_started`) and `resume` (`cli.mjs` `cmdResume`) both use the **live
   generation slot** as the "advancing" test, so the broker's self-heal disagrees with both. This is the
   seed incident, treated as one instance of "two predicates for the same fact".
3. **Blast radius.** One seat per occurrence; the incident lost `impl` (largest queue share, 159
   non-terminal items) for 80+ min, and re-stranded it on restart.
4. **End-user impact.** Throughput/latency, **H** (score 8/10): silent, permanent, per-seat.
5. **Fix.** Add a pure, exported `isAdvancingTask(task)` = `task?.state?.kind === "running" ||
   task?.state?.kind === "completing"` and use it in the owner scan at `:564-567`; optionally mirror
   `resume`'s "no live slot" guard as a backstop. **Note:** the *derived* `state.kind` is the right field —
   the existing `t.record?.state?.status === "running"` used elsewhere (`src/broker.mjs` pause quiescence,
   `cli.mjs` stop) is a **different** field; consolidate on one predicate. **Invariant restored:** "a
   submission is settled iff no task can still advance it", shared by broker, notice, and `resume`.
6. **Failing-first test.** Extend `demo/broker-strand.test.mjs` (today it only covers the no-live-task
   case): a `placed` submission whose conversation has a **live task with `state.kind ∈ {ready,waiting,blocked}`**
   must be settled and the seat woken in the same pass; a task with `state.kind === "running"` must NOT be
   settled. Unit-test the predicate directly (deterministic even if the live-task fixture is hard).
7. **Confidence.** **proven** (shape verified in both the installed 1.1.0 `types.d.ts` and the vendored
   1.3.0 `scheduler.ts`). The reason conv 9's task was non-running is **UNVERIFIED**.

---

### F4 — One bad conversation aborts the whole pass (blast radius)

1. **Symptom.** "One seat has a corrupt document and the whole rig stops being driven; every seat goes
   idle at once."
2. **Mechanism.** `drivePass` performs unguarded whole-store operations before any per-seat work:
   `harness.documentState(Seats/RigQueue/RigControl)` (`src/broker.mjs:891-895`), `harness.inspect` (`:897`),
   `reconcileStrandedSubmissions` (`:901`), `readStoppedConvIds` (`:912`). Any storage error in one of them
   throws the entire pass (`runWakeLoop` catch, `:1261`), so **no** seat is woken that pass. With F2, a
   terminal error then never recovers.
3. **Blast radius.** All seats (not the one bad conversation); duration = one pass or, with F2, permanent.
4. **End-user impact.** Liveness, **H** (score 8/10): blast radius is the entire fleet from a single
   document.
5. **Fix.** Scope failure to the seat: the per-seat wake path already has `wake-failed`; move the per-seat
   reads (readability probe, per-seat pages) behind it, and treat the truly-global reads as the only
   pass-level throw. **Invariant restored:** a fault in seat X never stops seat Y.
6. **Failing-first test.** A demo with one unreadable `pi.live` conversation and two healthy seats: assert
   the healthy seats are still woken in that pass.
7. **Confidence.** **proven**.

---

### F5 — The F11 drain is unbounded; `serve --stop` cannot stop a wedged broker

1. **Symptom.** "`serve --stop` never returns `stopped:true`; I have to `taskkill` the broker."
2. **Mechanism.** `src/broker.mjs:1322` `await harness.waitForIdle(context)` has **no timeout**;
   `cmdStopBroker` (`cli.mjs:1596-1615`) waits only 60 s and deliberately never force-kills. A run that
   never settles (provider hang) means the broker never exits. ROADMAP `#2420` (bounded-grace stop) is the
   registered fix.
3. **Blast radius.** Whole rig; forces an operator `taskkill`, which is the un-graceful path that strands
   submissions (F1's window).
4. **End-user impact.** Operability/liveness, **H** (score 8/10).
5. **Fix.** Bounded grace: drain deadline → cancel stream/tool → **unconditional** force fallback. The
   fallback must not depend on the wedge it is escaping (the daemon research wording). **Invariant
   restored:** stop is bounded regardless of run state.
6. **Failing-first test.** A demo with a run that never settles: assert `serve --stop` returns within the
   grace bound and the process is gone.
7. **Confidence.** **proven** (unbounded `await`; no timeout).

---

### F6 — Retry backoff has no jitter and no exhaustion budget

1. **Symptom.** "Two brokers retry in lockstep"; "the broker retried at 60 s forever and never told me it
   had given up."
2. **Mechanism.** `src/broker.mjs:1301` `backoff = min(wakeRetryMs * 2 ** (n-1), wakeRetryMaxMs)` —
   deterministic, capped, never terminal. No jitter (independent brokers resynchronize), no budget (a
   persistent throw retries forever with no overload diagnostic). ROADMAP 158.
3. **Blast radius.** One broker (or several); liveness only.
4. **End-user impact.** Liveness, **M** (score 5/10).
5. **Fix.** Add jitter and a retry budget that ends in a terminal, surfaced diagnostic; combine with F2's
   reopen so the budget is only reached for genuinely unrecoverable errors.
6. **Failing-first test.** A persistent throw: assert jittered, budget-bounded retries and then a terminal
   diagnostic.
7. **Confidence.** **proven**.

---

### F7 — Heartbeat freshness is the only liveness signal; a wedged-but-alive broker reads healthy

1. **Symptom.** "`status` says the broker is up, but no seat has been woken in an hour."
2. **Mechanism.** `.broker.json` carries `{pid, since, runToken, heartbeatAt}` only
   (`src/broker.mjs:1415-1416`); `brokerAlive` is heartbeat+pid (`:1385-1397`). A broker stuck in the F2/F6
   60 s retry loop has a fresh heartbeat and a frozen `PASS`, and `status` calls it up. `BROKER-SUPERVISION.md`
   §4 already specifies the liveness/progress split; the code has only the liveness leg.
3. **Blast radius.** Whole rig; detection only.
4. **End-user impact.** Observability, **M** (score 5/10): the failure is silent until a human reads the log.
5. **Fix.** Write a progress leg (last `PASS` timestamp) into `.broker.json`, and have `status`/attention
   report `degraded` when `PASS` is older than stream-timeout + margin. **Invariant restored:** "alive" ≠
   "healthy"; a frozen broker is visible without a socket.
6. **Failing-first test.** A demo that freezes the pass loop and asserts `status` reports `degraded`.
7. **Confidence.** **proven** (no progress field written).

---

### F8 — `probeStorage` is a second pi-durable connection in the broker process

1. **Symptom.** "Intermittent `PASS ms=5051` → `SessionFailed … database is locked` on a busy rig."
2. **Mechanism.** `cmdServe`/`cmdRun` open the harness's storage via `openHarness` **and** a second
   connection via `probeStorage = await openStore()` (`cli.mjs:1653`, `:1377`). The `read` op was correctly
   moved to the harness's own storage (`src/broker.mjs:368-381`, `readStorage ?? probeStorage`), but
   `probeStorage` is still used for `readStoppedConvIds` (`:912`, plain scan), `readSeatRootsFromStorage`
   (`:842-854`, `findDocument` + **`document()` = `BEGIN IMMEDIATE`** — a write lock at broker start), and
   `superviseOnce` (`cli.mjs:1701`). `SqliteStorage.document()` is `BEGIN IMMEDIATE` even for a read
   (`vendor/pi-main/.../storage/sqlite/node.ts:146`), and the two connections have independent in-process
   serial queues, so they contend for the one write lock and can time out the 5 s busy window — the exact
   `PASS ms=5051` → `SessionFailed` shape the `read`-op comment describes.
3. **Blast radius.** Whole broker session (F2 makes it terminal).
4. **End-user impact.** Liveness/correctness, **M** (score 6/10): intermittent, load-dependent.
5. **Fix.** Eliminate `probeStorage`: serve `readStoppedConvIds`, `readSeatRoots`, and `superviseOnce`'s
   scans through `readStorage` (the harness's own `Storage`), as the `read` op already does; keep the
   `dispatchRead(readStorage ?? probeStorage, …)` fallback only for single-handle callers (demos).
   **Invariant restored (D111's own principle):** one owner ⇒ one connection.
6. **Failing-first test.** A demo that runs a `read`-op and a `document()`-based read on two connections
   against one live writer and asserts no `SQLITE_BUSY` past busy_timeout; plus a unit assert that the
   broker holds exactly one storage handle.
7. **Confidence.** **proven** (two `openNodeSqliteStorage` calls; `BEGIN IMMEDIATE` in `document()`). That
   this is the *residual* lock cause is **inferred** — the appendix A1 lists the probes that would confirm.

---

### F9 — `cmdStopBroker` clears broker state without the pid guard

1. **Symptom.** "A freshly started broker's `.broker.json` vanished; a second broker could then start."
2. **Mechanism.** `cli.mjs:1603` calls `clearBrokerState(DB_PATH)` with **no pid**, in the same branch that
   F1's stale-heartbeat false-positive reaches. `broker.mjs`'s own `clearBrokerState(dbPath, pid)`
   (`:1418-1429`) has the guard precisely for this; the stop verb bypasses it.
3. **Blast radius.** Whole rig (enables a second broker = double driver).
4. **End-user impact.** Correctness, **M** (score 6/10).
5. **Fix.** Pass the pid observed when the wait began; refuse to clear a different pid. Pairs with F1's fix.
6. **Failing-first test.** Start a broker, capture the state, simulate a newer broker's state file, run the
   stop path, assert the newer state survives.
7. **Confidence.** **proven**.

---

### F10 — `pause --wait` can hang forever

1. **Symptom.** "`pause --wait` never returns."
2. **Mechanism.** `applyPauseOp`'s wait loop (`src/broker.mjs:342-350`) polls for quiescence with
   `QUIESCE_POLL_MS = 100` and **no deadline**; a run that never settles means `pause --wait` never
   returns.
3. **Blast radius.** The invoking CLI (a broker-upgrade step per `cli.mjs:1522`), which then blocks the
   upgrade.
4. **End-user impact.** Operability, **M** (score 5/10).
5. **Fix.** Bound the wait; return `quiesced:false, waitedMs` (the caller already reports both fields).
6. **Failing-first test.** A demo with a never-settling run asserts `pause --wait` returns within the bound
   with `quiesced:false`.
7. **Confidence.** **proven**.

---

## 2. Systemic themes (one mechanism change can retire several items)

1. **Failure is not scoped — one storage error becomes the whole rig's problem.** F2 (terminal but
   retried), F4 (whole-pass abort), F6 (unbounded retry). *One mechanism:* a failure-scope policy at the
   pass boundary — classify (terminal vs retryable), isolate per seat, and reopen the Session on the
   terminal class. This is the single highest-leverage change; it also removes the reason F1's drain
   window is dangerous (a reopen is cheaper than a restart).
2. **Liveness, progress, and "stopping" are conflated into one heartbeat.** F1, F7, F9. *One mechanism:*
   a small state machine in `.broker.json` (`running | stopping | gone`) plus a `lastPassAt` progress leg.
   Retires the false `stopped:true`, the false "healthy", and the unguarded clear.
3. **The single-writer rule is enforced in prose, not code, at the process boundary.** F1, F8, F9 (and
   F12 in the appendix). *One mechanism:* a verifiable holder identity — `pid + runToken + fresh heartbeat`
   — checked by every entry point, and a stop that confirms exit.
4. **Unbounded waits.** F5, F10, F6. *One mechanism:* every wait has a deadline and a defined action on
   expiry (never "wait longer").

---

## 3. What is already robust (reviewed, found sound — do not churn)

- **Scheduler coalescing/floor/cooldown and the one-shot wake signal** (`src/scheduler.mjs`): a change
  during a pass re-marks dirty, the floor coalesces bursts, and `race()` cleans up its keepalive. Covered by
  `demo/broker-cooldown-revisit.test.mjs` (green).
- **The TUI driver's tick machine** (`src/tui/driver.mjs`): a tick in flight is coalesced (never concurrent
  renders), and every exit path restores the terminal. Covered by `demo/ui-driver.test.mjs`.
- **The intent spool** (`src/broker.mjs` `writeIntent`/`drainIntentInbox`): atomic tmp+rename write, a
  stable `requestId` that makes re-drain idempotent, dead-lettering of an undeliverable intent (never
  retried forever), and `#2321`'s in-place read drain so a `read` poll does not force a pass. Covered by
  `demo/broker-inbox.test.mjs`, `broker-read-nopass.test.mjs`, `broker-intent-wake.test.mjs` (green).
- **The worktree keep-reason rule** (`src/broker.mjs` `classifyWorktrees`): refuse rather than destroy; a
  dirty tree is kept and reported (D60). Covered by `demo/broker-worktree-sweep.test.mjs`.
- **The read seam's *direction*** (D111): when a broker is alive every read goes through the spool;
  direct open only when no broker is alive. The residual is the in-process second connection (F8), not the
  direction.
- **genlock's acquire-by-`O_EXCL` race**, lease renewal (`LEASE_RENEW_MS`), `STALE_MS` set above the
  provider stream timeout, and the EPERM-safe `holderAlive` (`src/genlock.mjs`) — the mutual exclusion is
  the create, not a check-then-act.
- **`brokerAlive`'s recycled-pid hardening** (heartbeat + pid, `:1385-1397`) and the pid-guarded
  `clearBrokerState(dbPath, pid)` — correct where used (F9 is where it is *not* used).

---

## 4. Reusable temporal / edge-case checklist (review artifact)

Run every item against any seam before shipping:

1. **Cancellation** — can the operation be cancelled at every await? who owns the cancel token? is the
   cancel durable (a file) or in-process only?
2. **Stop/restart** — what does the *observer* see while the process is stopping? can a "stopped" verdict
   be issued before the process is gone? is the stop idempotent?
3. **Stale/dead holders** — how is a holder proven alive (pid? token? heartbeat? clock?)? what happens on
   pid reuse? on clock change? is steal-from-live impossible?
4. **Timeouts** — does every wait have a deadline? is there a defined action on expiry (not "wait longer")?
5. **Retries/backoff** — jitter? budget? terminal state? is the retried operation idempotent? is a
   terminal failure being retried?
6. **Ordering/races** — check-then-act anywhere? (prefer `O_EXCL`/unique-index/rename). can two passes/two
   processes interleave on the same fact?
7. **Blast radius** — if this read/write fails, whose work stops? is it scoped to the actor, or global?
8. **Idempotency** — is a re-run safe? is there a ledger (requestId) and a dedup key?
9. **Observability** — is the failure legible without a debugger (a log line with the nested cause, an
   attention kind)? is "alive" distinguishable from "healthy"?
10. **Failure classification** — is this error retryable or terminal? is that distinction encoded, or
    assumed?
11. **Clock/aging** — wall clock or monotonic? what does a backward/forward step do to an age threshold?
12. **Boundary** — who is the single writer? is a second opener possible in-process or cross-process?

---

## 5. Appendix — further findings (ranked below the headline)

- **A1 — the residual `database is locked` cause is UNVERIFIED.** Candidates, in order: (a) a second
  in-process connection (F8); (b) a direct viewer opener when `brokerAlive` briefly reads false (F1/F7);
  (c) an `up`/`send`/`intent.mjs` producer opening a harness while the broker drives (guarded by
  `refuseWhileBrokerDrives`, so a *hole in that guard* would be the bug); (d) a `-shm` open/close race.
  Probe: log the `errcode`/`errstr` at the failure (ROADMAP 159), and record the holder of the write lock
  (`PRAGMA lock_status` is unavailable in `node:sqlite`; instead correlate the failure with any concurrent
  opener). **Do not assert a cause** until this probe runs.
- **A2 — genlock aging uses wall clock** (`src/genlock.mjs` `slotIsStale`: `Date.now() - Date.parse(since)`).
  A backward clock step makes a dead holder look immortal (slots wedge); a forward step steals a live
  holder (cap exceeded). `BROKER-SUPERVISION.md` §4 already flags the clock axis. Fix: pid-liveness
  primary, monotonic/`os.uptime()` age secondary.
- **A3 — `cmdStop` kills a lease pid with no identity token** (`cli.mjs` `cmdStop`: `process.kill(holder.pid, "SIGKILL")`).
  A recycled pid kills an unrelated process. The supervision doc §6 flags pid reuse for `.broker.json`;
  `.genlock.*` has the same gap. Fix: verify a `runToken`/heartbeat before killing, and prefer settling the
  submission over killing.
- **A4 — spool result files have no TTL/GC** (`<db>.broker.inbox.out/`). `readViaBroker` removes its own
  result, but a client that dies mid-poll leaves the file; the `health` view is multi-MB. ROADMAP 160.
  Fix: TTL/GC guarded by in-flight; consider a narrower `health` view.
- **A5 — a UI frame costs 1+N spool round-trips** (`src/tui/readstate.mjs`: one `health` + one `live` per
  seat). Perf item: add a batched `live` view so a frame is one round-trip. (`ui.mjs` `pollMs` 700;
  `readclient` timeout 120 s.)
- **A6 — `probeStorage`'s `document()` at broker start** is the same class as F8 but at startup
  (`src/broker.mjs:842-854`); it races the harness's first commits. Fixed by F8's change.
- **A7 — carried shared-tree dirty files make every new item worktree dirty → un-reapable.** Observed on
  this very item (`item-2520` carries `M docs/incidents/README.md` + untracked files). `createWorktree`
  carries tracked-dirty files (`src/worktree.mjs:134`, ASK F/#506) while `complete_work`'s teardown is
  clean-only (D60), so the worktree leaks on completion
  (`docs/incidents/2026-10-19-worktree-carry-teardown-collision.md`). Fix: do not carry tracked-dirty files,
  or make teardown ignore carried paths.
- **A8 — `drivePass`/`superviseOnce` apply against a snapshot taken once per pass** (`src/broker.mjs:891-895`),
  so a queue/seat change mid-drain is not seen until the next pass. Low impact (idempotent), worth a note.

---

## 6. Disposition

- This document is the review of record; the durable design decision is **D112** (`docs/DECISIONS.md`).
- The ranked findings are handed back to `pm` as **separate queue items** (one per finding, each with the
  7-part block above), bug-fix/temporal/liveness ahead of capability, owners proposed by `pm`.
- Escalation: the failure-scope policy (theme 1 / F2+F4) is an architecture change with a blast radius
  across the broker; if it conflicts with a scheduled item, `lead` rules scope.

## Evidence (commands actually run for this review)

- Baseline demos in the `architect-item-2520` fork (all exit 0):
  `node demo/broker-strand.test.mjs`, `stranded`, `broker-pass-survival`, `broker-hotloop-bound`,
  `broker-wake-retry`, `broker-cooperative-stop`, `supervisor`, `broker-reconcile`, `broker-read`,
  `broker-read-nopass`, `broker-inbox`, `broker-intent-wake`.
- `node --check` on `src/broker.mjs`, `src/supervisor.mjs`, `src/driver.mjs`, `src/scheduler.mjs`,
  `src/genlock.mjs`, `src/readclient.mjs`, `src/brokerread.mjs` (all OK).
- Version probe (in the fork): `pi-durable version resolved: 1.1.0`; `typeof harness.storage: undefined`.
  **Grounding discrepancy:** the reviews/ROADMAP cite pi-durable **1.3.0** (`node.ts:146`) and
  `SessionFailed` is a **1.3.0** construct, but this checkout resolves **1.1.0**, whose session has no
  terminal-failure guard. The live broker log (`selfdev.sqlite.broker.log`) emits `SessionFailed`, so the
  running broker was **not** using this checkout's `node_modules`. Confirm which copy the broker loads
  (the vendored 1.3.0 is a junction under `vendor/pi-main/node_modules/`) before acting on F2/F8; the
  seed finding F3 is version-robust (the `TaskInspection.state.kind` shape is identical in both).
- Incident: `docs/incidents/2026-10-19-stranded-submission-seat-stall.md` (F1/F3/F4 corroboration).
- Vendor semantics: `vendor/pi-main/packages/durable/src/errors.ts`, `session/session.ts`,
  `harness/scheduler.ts` (`#inspectTask`), `storage/sqlite/node.ts` (`BEGIN IMMEDIATE`, `busyTimeoutMs`).
