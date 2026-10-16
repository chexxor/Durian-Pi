# Broker supervision and the daemon host — design of record

**Status:** design recorded (2026-10-16, delegate), grounded in the external research at
`docs/reviews/building-agent-systems-on-pi-research.md` and **re-verified against durig's code** (the
research agent could not read the tree). **Registered, not scheduled:** roadmap items 61–67; `pm`
sequences them. The mechanism choice **Windows Service vs logon Task** is still an open operator
question (§8).
**Scope:** how the process that owns the store (`cli.mjs serve`) is kept alive and healthy on a host
that can reboot, sleep, and kill processes — the "daemon" around durig.
**Companion:** `docs/BROKER-ARCHITECTURE.md` (the in-process event loop / actor model). This document
covers the **process lifecycle** layer that the actor-model doc deliberately leaves out.

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
SCM ──supervises──▶ Windows service (Session 0, one per store)
                      └─spawns──▶ src/brokerd.mjs   (thin daemon supervisor; never opens the store)
                                    └─spawns in a Job Object──▶ cli.mjs serve   (the sole writer)
```

- **Layer 0 — the OS service.** Gives boot/logout survival and restart-on-exit with delays. Critically,
  the SCM only observes *process exit*; it cannot see a process that is alive but wedged. That is why a
  hang detector must live below it (§4).
- **Layer 1 — the thin daemon (`src/brokerd.mjs`).** Owns single-instance, backoff, give-up, reading
  the heartbeat, killing a wedged broker, and honoring the durable stop marker. It never opens the
  store — health is pid + heartbeat + lease files only — so it cannot break single-writer.
- **Layer 2 — the broker (`cli.mjs serve`).** Unchanged as the sole writer; adds the exit-code taxonomy
  (§3) and the heartbeat writer (§4).

**Name note (verified):** `src/supervisor.mjs` already exists and is the *escalation pass* (ROADMAP
42/P3: `failureStreak` → park on the human). The daemon supervisor therefore takes a different name —
`src/brokerd.mjs` — to avoid colliding with a real module.

**Why a supervisor *child* under the service, not the broker directly under the SCM.** WinSW runs one
process and sees only its exit; a supervisor child can additionally kill a hung broker, apply backoff,
and own the stop logic in one place away from the store. If we ever want to defer the extra process,
the broker's own heartbeat-writer plus the SCM restart covers the *crash* case — but not the *hang*
case cleanly.

## 3. Restart / stop contract

The canon (systemd `RestartPreventExitStatus`, Docker's manual-stop suppression, supervisord
`autorestart=unexpected`, OTP `transient`) all encode "do not restart after an intentional stop" the
same way: **exit code + a durable intent marker.** Adopt it:

| Cause | Broker exit code | Supervisor action | Durable marker |
| --- | --- | --- | --- |
| `serve --stop` (intended) | **0** | do not restart; stay down | write `<db>.broker.stopped` |
| crash / uncaught throw | **1** | restart with backoff | — |
| wedge (pass stalled) | **2** (distinct) | restart; count toward the loop-breaker | log `WEDGE` |
| restart-storm give-up | **0** | do not restart; alert | write `<db>.broker.stopped` |

`onfailure`-style restart acts on **non-zero** exit, so intended stop and give-up (both 0) stay down,
while crash and wedge are restarted.

**durig-specific: set the code, do not `process.exit()`.** `cli.mjs` already follows this rule for
`check` — *"Set the code rather than exiting: a piped JSON payload may still be draining, and
process.exit would truncate it mid-write."* `cmdServe` currently sets **no** exit code; the taxonomy is
`process.exitCode = …` after `out(...)`.

**Stop window must exceed the drain window.** A single legitimate model call can run up to
`DURIG_STREAM_TIMEOUT_MS` (verified: `src/config.mjs`, default 600000 ms). A service stop timeout
shorter than that force-kills the broker mid-run and strands the submission — the F11 class. The stop
window must be ≥ the stream timeout + margin, or the stop must mean "stop scheduling new work, then
drain to idle."

## 4. Liveness: hung vs dead

A pid check cannot catch a wedged broker (a ~15-minute pass was observed). Emit **two** signals, on a
**monotonic** clock:

| Signal | Written by | Interval | Timeout | Catches |
| --- | --- | --- | --- | --- |
| **Liveness** (event loop turning) | the broker's main thread | ~20 s | ~60 s | event-loop blockage / full-process hang |
| **Progress** (pass advancing) | the pass loop at phase boundaries | per call boundary + ~30 s | `DURIG_STREAM_TIMEOUT_MS` + margin | stuck await / harness deadlock |

`PASS <n> ms=<dur> woke=…` is already logged — it is a **progress** signal, not a liveness signal, and
conflating them is why a long pass looks like a hang.

**Who kills a wedged broker.** The supervisor child reads the heartbeat file; a stale **liveness** file
means the main thread is blocked, so it `TerminateProcess`es the broker (or terminates the Job Object).
A Worker thread inside the broker is **not** a reliable self-kill: it was verified that a Worker's
`process.exit()` stops the Worker, not the process (the research report claimed otherwise and flagged
itself); a blocked main thread also cannot receive the Worker's messages. If a self-kill is ever wanted,
it must be `process.abort()`, not `process.exit()`.

**Modern Standby / clock-jump trap.** Modern Standby suspends interactive-session threads and throttles
Session 0 services; a live-but-sleeping broker must not look dead. Use a monotonic clock for all
heartbeat and lease ages, re-anchor on resume, and record a sleep gap as a **gap**, not a failure.

## 5. Durable markers — do not collide

durig **already has a stop-request file** (F35): `stopRequestPath()` → **`<db>.broker.stop`**
(`src/broker.mjs`), written by `serve --stop`, polled by the broker between passes, and **cleared by
the broker on exit**. That is an *ephemeral* "stop now" signal.

The daemon needs a **durable operator intent** that survives exit and reboot. Ship it under a
**distinct name** — `<db>.broker.stopped` — not `<db>.stop`. Only an explicit operator command
(`up`/`serve --start`) clears it; the supervisor must never delete it.

| Marker | Lifetime | Written by | Cleared by |
| --- | --- | --- | --- |
| `<db>.broker.stop` (exists) | ephemeral, polled | `serve --stop` | the broker on exit |
| `<db>.broker.stopped` (new) | durable | `serve --stop`, give-up | `up` / `serve --start` |

## 6. Correctness hardening (worth doing even without a daemon)

Two latent single-writer hazards, both verified in code:

- **Wall-clock lease age.** `src/genlock.mjs` computes staleness as
  `Date.now() - Date.parse(holder.since) > STALE_MS` (60 s wall clock). A Modern Standby sleep makes a
  live-but-sleeping holder look stale → steal → **double-drive**. Move lease ages to a monotonic clock.
- **PID reuse.** `brokerAlive()` is `process.kill(pid, 0)` (`src/broker.mjs`). On Windows a stale
  `<db>.broker.json` can name a **reused** pid and read as "alive", so the broker refuses to start (or
  the daemon thinks it is up). Assert identity with a process creation-time check or an exclusive lock
  handle, not pid liveness alone.

The existing Windows Job Object primitive (`src/job-object.mjs`,
`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) must also cover the **broker** process tree, so a service stop or
a daemon kill reaps everything.

## 7. Seam inventory — what the daemon does to each artifact

| Artifact / boundary | On crash | On restart | On clean shutdown |
| --- | --- | --- | --- |
| `<db>.broker.json` | stale (pid/creation mismatch) → steal/clear | re-acquired by the new broker before it opens the store | cleared |
| `<db>.broker.stop` (F35) | absent | ignored (ephemeral) | cleared by the broker |
| `<db>.broker.stopped` (new) | present ⇒ daemon stays down | read before spawn; if present, do not start | **written** on intended stop / give-up |
| `<db>.broker.inbox/` | files remain → re-drained next pass | drained at pass START; must be idempotent (`requestId`) | left for next start |
| `genlock.*` | stale lease → steal | reconciled against the process table | released |
| per-item worktrees (`item-*`) | may be orphaned → startup sweep | reused if the item is still claimed | retired by `complete_work` |
| `pi.*.sqlite` (store) | WAL replay on reopen; `resume()` re-schedules | opened once by the sole broker | closed **after drain**; never with a live run |
| `<db>.broker.log` | last line `START` with no `EXIT` = abnormal | new `START` appended | `EXIT reason=stop` |
| `<db>.broker.heartbeat` (new) | stale | rewritten each tick | marked stopped / removed |

## 8. Open questions (operator / research)

1. **Windows Service vs logon Task.** A service (WinSW) is right for an always-on host; a logon Task +
   user-profile process may be the better default for a personal rig. **Operator ruling needed.**
2. **Service account recipe.** Running under a dedicated account changes `%USERPROFILE%`, git
   credentials, and per-worktree `npm ci` paths; the setup that keeps seats working is unresolved.
3. **WinSW vs Servy vs `node-windows`** — maintenance status is unverified (a third-party claim says no
   release since 2023).
4. **Per-store services.** We have `selfdev.sqlite` and `tutor-pi.sqlite`; one service per store, with
   the DB path a service parameter and the install refusing network/OneDrive store paths.
5. **Boot ordering.** The service starts before network/credentials; the first pass will fail provider
   calls. Delayed auto-start + backoff, stated explicitly.
6. **Upgrade under load.** WinSW runs a fixed exe path; how a new pinned pi / new code is picked up
   (drain + restart + a version handshake) is not yet designed.
7. **Human visibility.** How the operator sees "daemon up / down / degraded" beyond the CLI.

## 9. Option B — control socket / TUI attach (gated)

Any socket (a remote TUI client, item 52) opens a trust boundary and, by D45, requires a written
`security.sec` position **before code** (roadmap item 55). The in-process subscriber path needs no
socket. If Option B is pursued on Windows, the replacement for a Unix socket is a **named pipe with an
explicit DACL** (the default grants read to Everyone) or **loopback TCP + a token**; the named-pipe
default ACL, impersonation/squatting vectors, and the logon-SID scoping are all recorded in the research
report §8.

## Why (the decision rationale)

Durability and supervision are different jobs. pi-durable owns durability and `resume()`; the daemon
owns exactly: **process liveness, boot/logout survival, backoff, give-up, and the stop handshake.** It
must not own retries, scheduling, or resume — if it starts re-driving the queue, we get double-work.
This is the BYOC split from the research report (§"durable-orchestration"): Pi is the worker primitive;
durig owns the broker above it; and the supervisor is a *host*, not a second scheduler.
