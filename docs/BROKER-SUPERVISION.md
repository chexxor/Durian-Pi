# Broker supervision and the daemon host — design of record

**Status:** design recorded (2026-10-16, delegate), grounded in the external research at
`docs/reviews/building-agent-systems-on-pi-research.md` and **re-verified against durig's code** at
every round (the research agent read the tree from round 3 on). **Registered, not scheduled:** roadmap
items 61–67; `pm` sequences them. The host mechanism **logon Task vs Windows Service** is still an open
operator question (§10).
**Scope:** how the process that owns the store (`cli.mjs serve`) is kept alive and healthy on a host
that can reboot, sleep, and kill processes — the "daemon" around durig.
**Companion:** `docs/BROKER-ARCHITECTURE.md` (the in-process event loop / actor model). This document
covers the **process lifecycle** layer that the actor-model doc leaves out.

## 1. Why this exists (the observed failure)

`up` spawns the broker as a detached child (`detached: true, unref()`) and forgets it. Nothing restarts
it. On 2026-10-16 the broker was born as `START pid=33116`, ran through `PASS 186`, and the log then
ends — **a `START` with no matching `EXIT`**, which the lifecycle-audit code itself defines as an
abnormal death, "a kill or a throw" (`src/broker.mjs:285`). It stayed down: queued work and three
spooled operator intents waited indefinitely. The gap is not durability — pi-durable owns that
(`harness.resume()` resumes unfinished runs on reopen) — it is **supervision**. A stopped broker stays
stopped until a human runs `up`/`serve` again.

## 2. The design: three layers, each seeing only what it can

```
SCM / Task Scheduler ──▶ Windows host (boot/logon trigger)
                           └─spawns──▶ src/host.mjs   (thin daemon supervisor; never opens the store)
                                         └─spawns in a Job Object──▶ cli.mjs serve   (the sole writer)
```

- **Layer 0 — the OS trigger.** A logon Task (default) or a Windows Service (opt-in, always-on host)
  gives boot/logout survival and restart-on-crash. Critically, the OS trigger only observes *process
  exit*; it cannot see a process that is alive but wedged. So a hang detector must live below it (§4).
- **Layer 1 — the thin daemon (`src/host.mjs`).** Owns single-instance, backoff, give-up, reading the
  heartbeat, killing a wedged broker, and honoring the durable down marker. It never opens the store —
  health is pid + heartbeat + lease files only — so it cannot break single-writer.
- **Layer 2 — the broker (`cli.mjs serve`).** Unchanged as the sole writer; adds the exit-code taxonomy
  (§3) and the heartbeat writer (§4).

**Naming (verified).** `src/supervisor.mjs` already exists and is the *escalation pass* (ROADMAP 42/P3:
`failureStreak` → park on the human), so the OS-level supervisor takes a distinct name. **`src/host.mjs`
is the name of record** (the round-3 agent proposed `host.mjs`; an earlier draft called it `brokerd.mjs`,
which reads like "the broker itself"). The down marker is `<db>.broker.down` (an earlier draft said
`.broker.stopped`).

**Why a host *child* under the OS trigger, not the broker directly.** WinSW/Servy run one process and
see only its exit; a host child can additionally kill a hung broker, apply backoff, and own the stop
logic in one place away from the store.

## 3. Restart / stop contract

The canon (systemd `RestartPreventExitStatus`, Docker's manual-stop suppression, supervisord
`autorestart=unexpected`, OTP `transient`) all encode "do not restart after an intentional stop" the
same way: **exit code + a durable intent marker.** Adopt it. The host maps exit code → action
(`decide(exitCode, downMarker)`):

| Cause | `stoppedBy` / state | Exit | `<db>.broker.down` | Host action |
| --- | --- | --- | --- | --- |
| `serve --stop` (intended) | `stop` | 0 | written | stay down |
| SIGINT/SIGTERM | `signal` | 0 | — | stay down |
| bounded run | `max-duration` / `max-passes` | 0 | — | stay down |
| crash / uncaught throw | (no `EXIT`) | 1 | — | restart (backoff) |
| wedge (pass stalled) | `WEDGE` | 2 | — | restart; count toward the loop-breaker |
| give-up | — | 0 | written | stay down + alert |

`onfailure`-style OS restart acts on **non-zero** exit, so intended stop and give-up (both 0) stay down,
while crash and wedge restart. (The research confirmed the SCM skips failure actions on a clean
`SERVICE_STOPPED`, and that an operator service-stop is one — so the OS trigger is a backstop for the
*host* dying, not the child-restart mechanism.)

**durig-specific: set the code, do not `process.exit()`.** `cli.mjs` already follows this rule for
`check` — *"Set the code rather than exiting: a piped JSON payload may still be draining, and
process.exit would truncate it mid-write."* `cmdServe` currently sets **no** exit code; the taxonomy is
`process.exitCode = exitCodeForStopReason(result.stoppedBy)` after `out(...)`.

**Stop window must exceed the drain window.** A generation holds a slot for the **whole response**
(`src/genlock.mjs` `wrapProviderWithSlots`) and a single model call can run to the provider SDK's
request timeout (`DURIG_STREAM_TIMEOUT_MS`; 600000 ms for the openai provider when unset). The host's
drain window is therefore **900 s** (> 600 s + margin); the OS trigger's own stop timeout must also be
≥ that, or it force-kills a broker mid-run and strands the submission (F11). The **real** graceful stop
is `serve --stop` → `.broker.stop` + `.broker.down` → broker drains and exits 0; the OS stop is for
uninstall/maintenance only.

## 4. Liveness: hung vs dead

A pid check cannot catch a wedged broker (a ~15-minute pass was observed). Emit **two** signals:

| Signal | Written by | Interval | Timeout | Catches |
| --- | --- | --- | --- | --- |
| **Liveness** (event loop turning) | a main-thread `setInterval` in the broker | ~20 s | ~60 s | event-loop blockage / full-process hang |
| **Progress** (pass advancing) | the existing `PASS <n> ms=… woke=…` log | per pass | stream timeout + margin | stuck await / harness deadlock |

A 600 s model call does **not** block the event loop, so the liveness file stays fresh — correct, a long
call is not a wedge. A blocked loop stops the `setInterval` — correct, that *is* a wedge. The existing
`PASS` line is a **progress** signal, not a liveness signal; conflating them is why a long pass looks
like a hang.

**Who kills a wedged broker.** The host child reads the heartbeat file; a stale **liveness** file means
the main thread is blocked, so it terminates the broker (SIGKILL / the Job Object). A Worker thread
inside the broker is **not** a reliable self-kill: it was verified that a Worker's `process.exit()`
stops the Worker, not the process; a blocked main thread also cannot receive the Worker's messages. If a
self-kill is ever wanted it must be `process.abort()`, not `process.exit()`.

**Clock: `performance.now()` counts sleep on Windows.** QPC (which backs `performance.now()`) is
monotonic but **includes** Modern Standby/hibernate time; Node exposes no suspend-excluding clock (the
`uv_clock_gettime` API is unused; the Node issue asking for suspend-adjusted `performance.now()` was
closed unresolved). So a monotonic clock is strictly better than `Date.now()` against *clock changes*,
but it does **not** exclude *sleep*. Treat sleep as a **discrete resume event**: a gap much larger than
the check interval is a resume, not a wedge — do not kill, do not steal. Cross-process ages cannot use
`performance.now()` (its origin is per-process); use `os.uptime()` (boot-relative, shared) or wall time
and lean on pid liveness as the primary signal.

## 5. Durable markers — do not collide

durig **already has a stop-request file** (F35): `stopRequestPath()` → **`<db>.broker.stop`**
(`src/broker.mjs`), written by `serve --stop`, polled by the broker between passes, and **cleared by the
broker on exit**. That is an *ephemeral* "stop now" signal.

The host needs a **durable operator intent** that survives exit and reboot. Ship it as
**`<db>.broker.down`**, distinct from `.broker.stop`. Only an explicit operator command
(`up`/`serve --start`) clears it; the host must never delete it.

| Marker | Lifetime | Written by | Cleared by |
| --- | --- | --- | --- |
| `<db>.broker.stop` (exists) | ephemeral, polled | `serve --stop` | the broker on exit |
| `<db>.broker.down` (new) | durable | `serve --stop`, give-up | `up` / `serve --start` |

## 6. Correctness hardening (worth doing even without a daemon)

Three latent single-writer hazards, all verified in code:

- **genlock age-steals a *live* holder.** `src/genlock.mjs` holds a slot for the whole response but
  steals when `age > STALE_MS` (**60 s**), computed from `Date.now()`. A generation that legitimately
  runs 60–600 s can therefore be stolen by another process → the concurrency cap is exceeded
  (double generation). The real fix is **lease renewal** (refresh `since` while the generation is alive)
  or a stale threshold **greater than** the stream timeout — not merely a resume-gap exemption, which
  leaves the 60–300 s window broken. The operator view (`readGenerationSlots`, pid-only stale) and the
  acquire path also disagree on what "stale" means; make them agree.
- **genlock `holderAlive` swallows EPERM.** It `catch`es everything and returns `false`, so a slot held
  by a process we cannot signal (different integrity level) reads as dead and is stolen. `brokerAlive()`
  in `src/broker.mjs` handles this correctly (returns true on `EPERM`); make them match.
- **PID reuse.** `brokerAlive()` is `process.kill(pid, 0)`. On Windows pids are reused aggressively; a
  stale `<db>.broker.json` can name a reused pid and read as alive. Node cannot call `GetProcessTimes`,
  and an open fd is not a lock on Windows, so the practical identity proxy is **pid + a per-run
  `runToken` in `.broker.json` + a fresh heartbeat** — a recycled pid will not be refreshing *our*
  heartbeat. Do not rely on creation times or exclusive opens.

The existing Windows Job Object primitive (`src/job-object.mjs`,
`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) must cover the **broker** process tree, so a host kill or a
service stop reaps everything (WinSW itself only enumerates and terminates descendants; it uses no job
object — keep ours as the authority).

## 7. Seam inventory — what the host does to each artifact

| Artifact / boundary | On crash | On restart | On clean shutdown |
| --- | --- | --- | --- |
| `<db>.broker.json` `{pid, since, runToken}` | stale (pid/runToken mismatch) → steal/clear | re-acquired by the new broker before it opens the store | cleared (pid-guarded) |
| `<db>.broker.stop` (F35) | absent | ignored (ephemeral) | consumed + cleared by the broker |
| `<db>.broker.down` (new) | present ⇒ host stays down | read before spawn; if present, do not start | **written** on intended stop / give-up |
| `<db>.broker.inbox/` | files remain → re-drained next pass | drained at pass START; must be idempotent (`requestId`) | left for next start |
| `<db>.broker.inbox.error/` | dead-lettered intents surfaced | unchanged | unchanged |
| `<db>.genlock.<i>` | dead/stale → steal (see §6) | reconciled against the process table | released iff `holder.pid === process.pid` |
| per-item worktrees (`item-*`) | may be orphaned → startup sweep | reused if the item is still claimed | retired by `complete_work` |
| `pi.*.sqlite` (store) | WAL replay on reopen; `resume()` re-schedules | opened once by the sole broker | closed **after drain**; never with a live run |
| `<db>.broker.log` | last line `START` with no `EXIT` = abnormal | new `START` (+ version) appended | `EXIT reason=stop` |
| `<db>.broker.heartbeat` (new) | stale | rewritten each tick | marked stopped / removed |

## 8. Pitfalls to design in, not discover

- **Store path must be local disk.** SQLite on a UNC path, a non-fixed drive, or under
  OneDrive/Dropbox is unsafe; the installer should **refuse** it (`fsutil fsinfo drivetype`, the
  `OneDrive` env var).
- **Boot ordering.** The trigger starts before network/credentials; the first pass will fail provider
  calls. Use delayed auto-start and let backoff handle it — and document that a boot `WAKE`/provider
  error is expected, not a bug.
- **Multiple stores.** `selfdev.sqlite` and `tutor-pi.sqlite` ⇒ one host per store, parameterized
  (`durig install --db <path>`), never hard-coded `rig.sqlite`.
- **Upgrade under load.** The trigger runs a fixed exe path; a new pinned pi or new code is picked up
  only on restart. Do a drain + restart, and put `version` + upstream pin in the heartbeat and the
  `START` line; `status` refuses to claim health if the running version differs from disk.
- **Human visibility.** One `status` line: `daemon: up pid=<n> pass=<n> hb_age=<ms> v=<ver>`.
  up = heartbeat age < 60 s; degraded = alive but last `PASS` older than stream-timeout + margin;
  down = `.broker.down` present or heartbeat absent.
- **AV/Defender.** Exclude the seat root, `node_modules`, the store dir, and the node/host executables;
  expect AV to delay service start (another reason for delayed auto-start).
- **Session 0 vs the TUI.** A service-hosted broker has no console, so the TUI cannot be in-process:
  service mode *forces* the remote `watchEvents()` path of ROADMAP item 52, which is **gated on item
  55** (the `security.sec` position). Going service-first commits us to writing `security.sec` before
  the TUI can attach. The logon-Task mode keeps the in-process subscriber.

## 9. Option B — control socket / TUI attach (gated)

Any socket (a remote TUI client, item 52) opens a trust boundary and, by D45, requires a written
`security.sec` position **before code** (roadmap item 55). The in-process subscriber path needs no
socket. On Windows the replacement for a Unix socket is a **named pipe with an explicit DACL** (the
default grants read to Everyone) or **loopback TCP + a token**; the named-pipe default ACL,
impersonation/squatting vectors, and logon-SID scoping are recorded in the research report §8.

## 10. Open questions (operator / research)

1. **Logon Task vs Windows Service.** The round-3 recommendation: **default to a logon-triggered Task**
   running `src/host.mjs` (keeps the user profile, git/npm auth, desktop access; the TUI can stay
   in-session), and treat a service as **opt-in for an always-on host** (Session 0 has no console).
   **Operator ruling needed.** Neither helps Modern Standby — both need the resume handling of §4.
2. **Service account recipe.** A service account changes `%USERPROFILE%`/`%APPDATA%`, git credentials,
   and per-worktree `npm ci`. The safe recipe is explicit env (`HOME`/`USERPROFILE`/`APPDATA`/
   `LOCALAPPDATA`), `safe.directory`, `GIT_CONFIG_GLOBAL` + a store credential file, and
   `NPM_CONFIG_USERCONFIG`; verify it end-to-end before relying on a service.
3. **WinSW vs Servy.** WinSW's last stable is 2023 (maintenance limbo, still works); Servy is actively
   maintained and adds tree-kill/health, but its stop-timeout has a reported double-wait bug. Either is
   fine **because the restart/health logic stays in `src/host.mjs`**; the OS wrapper is a dumb trigger.
4. **Version handshake details** (what `status` refuses to claim when the on-disk version differs).
5. **Uninstall / downgrade path** back to an interactive `cli.mjs serve` without the host fighting it.

## Why (the decision rationale)

Durability and supervision are different jobs. pi-durable owns durability and `resume()`; the host owns
exactly: **process liveness, boot/logout survival, backoff, give-up, and the stop handshake.** It must
not own retries, scheduling, or resume — if it starts re-driving the queue, we get double-work. This is
the BYOC split from the research report: Pi is the worker primitive; durig owns the broker above it; and
the supervisor is a *host*, not a second scheduler.
