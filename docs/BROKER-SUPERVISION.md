# Broker supervision and the daemon host — design of record

**Status:** design recorded (2026-10-16, delegate), grounded in the external research at
`docs/reviews/building-agent-systems-on-pi-research.md` and **re-verified against durian-pi's code** at
every round (the research agent read the tree from round 3 on). **Registered, not scheduled:** roadmap
items 61–67; `pm` sequences them. The host mechanism **logon Task vs Windows Service** is still an open
operator question (§10) — and, since durian-pi must adapt to macOS and Linux, the real axis is
**per-user agent vs system daemon** across platforms.
**Scope:** how the process that owns the store (`cli.mjs serve`) is kept alive and healthy on a host
that can reboot, sleep, and kill processes — the "daemon" around durian-pi.
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
OS trigger (Task · launchd · systemd) ──▶ src/host.mjs  (PORTABLE supervisor, pure Node)
                                          └─spawns (behind a kill-tree boundary)──▶ cli.mjs serve
```

- **Layer 0 — the OS trigger (per platform, thin).** A "run at login as the user" agent by default
  (Windows Task, macOS LaunchAgent, `systemd --user`), or a system daemon for an always-on host
  (Windows Service, macOS LaunchDaemon, systemd system unit). It gives boot/logout survival and
  restart-on-crash, and observes **process exit only** — so a hang detector must live below it (§4).
  The trigger is a generated unit/plist/service config that starts `src/host.mjs` and nothing else.
- **Layer 1 — the portable host (`src/host.mjs`).** Pure Node, no OS API. Owns single-instance, backoff,
  give-up, heartbeat-watching, kill-on-wedge, and the durable down marker. It never opens the store, so
  it cannot break single-writer.
- **Layer 2 — the broker (`cli.mjs serve`).** Unchanged as the sole writer; adds the exit-code taxonomy
  (§3) and the heartbeat writer (§4).

**Portability boundary (the requirement: durian-pi must adapt to macOS and Linux distros).** Only three
things are OS-specific, and each sits behind a small adapter so the host is byte-identical everywhere:
(1) the **boot/login trigger** — a generated unit/plist/service file, not code; (2) the **kill-tree
primitive** — Windows Job Object vs POSIX process group (`detached` + `kill(-pid)`); (3) the **stop
signal** — POSIX `SIGTERM` vs the Windows `.stop` file (F35; already needed). Everything else is
already portable: the markers are DB-relative files, exit codes are Node's, path handling is Node's, and
**the resume-gap heartbeat is clock-agnostic** (§4) because `performance.now()`'s suspend behavior
differs per platform. The design does **not** depend on WinSW/Servy/launchd/systemd — those are just the
per-OS trigger adapters.

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

**durian-pi-specific: set the code, do not `process.exit()`.** `cli.mjs` already follows this rule for
`check` — *"Set the code rather than exiting: a piped JSON payload may still be draining, and
process.exit would truncate it mid-write."* `cmdServe` currently sets **no** exit code; the taxonomy is
`process.exitCode = exitCodeForStopReason(result.stoppedBy)` after `out(...)`.

**Stop window must exceed the drain window.** A generation holds a slot for the **whole response**
(`src/genlock.mjs` `wrapProviderWithSlots`) and a single model call can run to the provider SDK's
request timeout (`DURIAN_PI_STREAM_TIMEOUT_MS`; 600000 ms for the openai provider when unset). The host's
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

durian-pi **already has a stop-request file** (F35): `stopRequestPath()` → **`<db>.broker.stop`**
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
- **Multiple stores.** separate stores ⇒ one host per store, parameterized
  (`durian-pi install --db <path>`), never hard-coded `rig.sqlite`. Every OS artifact the host installs is
  keyed by the store — see **Instance identity** below.
- **Upgrade under load.** The trigger runs a fixed exe path; a new pinned pi or new code is picked up
  only on restart. Do a drain + restart, and put `version` + upstream pin in the heartbeat and the
  `START` line; `status` refuses to claim health if the running version differs from disk.
- **Human visibility.** One `status` line: `daemon: up pid=<n> pass=<n> hb_age=<ms> v=<ver>`.
  up = heartbeat age < 60 s; degraded = alive but last `PASS` older than stream-timeout + margin;
  down = `.broker.down` present or heartbeat absent.
- **AV/Defender.** Exclude the seat root, `node_modules`, the store dir, and the node/host executables;
  expect AV to delay service start (another reason for delayed auto-start).
- **Kill the whole tree, portably.** On POSIX, spawn the broker `detached` and kill its process group
  (`kill(-pid)`); on Windows use the `KILL_ON_JOB_CLOSE` Job Object. `child.kill()` alone leaves
  grandchildren on every platform. Abstract this as the host's one kill primitive.
- **Clocks differ per platform.** `performance.now()` excludes suspend on some platforms (Linux
  `CLOCK_MONOTONIC`) and includes it on others (Windows QPC), so never assume — the resume-gap rule is
  the portable one.
- **"Local disk" is per-filesystem.** SQLite locking is unsafe on network/synced filesystems
  (SMB/NFS/OneDrive/Dropbox) on every OS; the install check must be per-platform (drive type on Windows,
  `statfs`/mount type on POSIX, the `OneDrive`/`Dropbox` env vars).
- **Session 0 vs the TUI.** A service-hosted broker has no console, so the TUI cannot be in-process:
  service mode *forces* the remote `watchEvents()` path of ROADMAP item 52, which is **gated on item
  55** (the `security.sec` position). Going service-first commits us to writing `security.sec` before
  the TUI can attach. The logon-Task mode keeps the in-process subscriber.

### Instance identity — one store ⇔ one driver ⇔ one instance key

**Invariant (state this first):** *one store ⇔ one driver ⇔ one instance key.* Every OS-level artifact
the host installs is scoped by ONE key derived from the store, so two durian-pi instances on one machine
never share a name. Without it, two instances collide on the trigger name, the kill primitive's Job
Object / process-group name, the log path, and (later) the control socket — and a host's
"single-instance" lock would be global instead of per store.

**The key — contract owned by impl (ROADMAP 91 / #940).** The instance key is DERIVED from the store's
**canonicalized absolute path** — realpath, case-fold, and 8.3-name normalization on Windows (the trap:
`C:\DB\RIG.sqlite`, `c:\db\rig.sqlite` and `C:\DB\RIG~1.SQL` are ONE store). `--instance <name>` is a
**human label only**; it never replaces the derived key. The derivation exists in `src/instance.mjs`
(`canonicalStorePath` / `instanceKey` / `hostLockPath`; #940), proven by `demo/instance-key.test.mjs`
(including the canonicalization trap), so the host adapters consume it rather than inventing a second
key:

- **Input:** the store's absolute path, exactly as `--db`/config resolution yields it.
- **Output:** a stable token safe in a Task/label/unit/Job-Object/log/socket name (e.g. a short hex
digest of the canonicalized path).
- **Properties:** same canonical store ⇒ same token on every platform; different stores ⇒ different
tokens. Filesystem- and case-insensitive-safe.

**Every OS artifact keyed by that one key (one key everywhere).**

| Artifact | Keyed name (illustrative) | Notes |
|---|---|---|
| OS trigger | Windows Task `durian-pi-<key>`; launchd label `com.durian-pi.<key>`; systemd `durian-pi-<key>.service` | item 64 adapters |
| Kill primitive | Job Object / process-group name `durian-pi-<key>` | `KILL_ON_JOB_CLOSE` (Windows) / `kill(-pid)` (POSIX) |
| Log path | `<logdir>/durian-pi-<key>.log` | `daemon logs` tails it |
| Single-instance lock | `<db>.host.lock` (store-scoped) | PER INSTANCE, not global |
| Control socket/pipe (future) | `\\.\pipe\durian-pi-<key>` / a per-key socket | naming **waits on item 55** |
| Markers (already store-scoped) | `<db>.broker.json` / `.down` / `.stop` / `.inbox` | keep store-scoped; the lock keys the same way |

**Rules.**

- **One store, one driver.** A second driver on the SAME store is **REFUSED** with a message naming the
  running instance — never silently second-written (the single-writer rule; the 2026-10-16 corruption).
- **Different stores coexist.** Two stores ⇒ two distinct keys ⇒ two triggers, logs, and locks; they
  install and run side by side.
- **Version coexistence.** Two installations on different pinned pi versions must NOT fight over one
  trigger: the key is store-derived, so different stores never collide, and a re-pin/upgrade of ONE
  instance restarts only its own trigger (items 64/72).
- **Wrong-rig trap.** A bare `durian-pi` must not discover another instance's `durian-pi.config.json`/store
  (#491, D18): the resolved store (hence the key) comes from explicit `--db`/config discovery, never a
  global default.
- **No control socket yet.** Naming any socket/pipe key waits on item 55 (the `security.sec` position).

**Acceptance (host chain).** Two instances install and run side by side on one host without colliding —
made visible and testable by `--print` on the generated trigger (emit without applying), PLUS a hermetic
test for the per-instance lock and marker scoping. (The `--print`/lock/marker proof is gated on items
61–64; this section is the design they are built against.)

## 9. Option B — control socket / TUI attach (gated)

Any socket (a remote TUI client, item 52) opens a trust boundary and, by D45, requires a written
`security.sec` position **before code** (roadmap item 55). The in-process subscriber path needs no
socket. On Windows the replacement for a Unix socket is a **named pipe with an explicit DACL** (the
default grants read to Everyone) or **loopback TCP + a token**; the named-pipe default ACL,
impersonation/squatting vectors, and logon-SID scoping are recorded in the research report §8.

## 10. Open questions (operator / research)

1. **Per-user agent vs system daemon (a cross-platform axis, not a Windows one).** Default to a
   **per-user agent** that runs at login as the user — Windows Task, macOS LaunchAgent, `systemd --user`
   — because it inherits the user's profile, git/npm credentials, and file ACLs, and lets the TUI stay
   in-process. Its cost: it stops at logout and needs a login after reboot. A **system daemon** is the
   opt-in for an always-on host that must run unattended; on Windows it is Session 0 (no console).
   Neither escapes Modern Standby/sleep (§4). **Operator ruling needed**, and it is per machine, not per
   OS — the host is the same either way.

   | | per-user agent (default) | system daemon (opt-in) |
   | --- | --- | --- |
   | Windows | logon Task | Windows Service (Session 0) |
   | macOS | LaunchAgent | LaunchDaemon |
   | Linux | `systemd --user` (or distro equivalent) | systemd system unit (or OpenRC/runit/supervisord) |

2. **Account / identity (per platform).** Prefer running as the invoking user on every OS. A dedicated
   account is needed only for a system daemon; then the explicit-env recipe (`HOME`/`USERPROFILE`/
   `APPDATA`/`LOCALAPPDATA`, git `safe.directory` + credential store, `NPM_CONFIG_USERCONFIG`) must be
   verified end to end. POSIX expresses it as the unit's `User=`; Windows as "Log on as a service".
3. **Windows trigger adapter.** WinSW's last stable is 2023 (maintenance limbo, still works); Servy is
   actively maintained and adds tree-kill/health, but its stop-timeout has a reported double-wait bug.
   Either is fine **because the restart/health logic stays in `src/host.mjs`**; the OS wrapper is a dumb
   trigger. The macOS/Linux adapters (launchd plist, systemd unit) are generated the same way.
4. **Version handshake details** (what `status` refuses to claim when the on-disk version differs).
5. **Uninstall / downgrade path** back to an interactive `cli.mjs serve` without the host fighting it.

## 11. CLI surface — one command, two modes, clean switch

`durian-pi daemon <subcommand>` is the single end-user surface; the platform adapter picks the mechanism,
so the user never names schtasks/launchctl/systemctl.

| Command | Meaning |
| --- | --- |
| `durian-pi daemon install [--user|--system] [--db <path>] [--print]` | Install the OS trigger. **`--user` is the default** (starts at login, runs as you). `--print` emits the generated unit/plist/task without applying it (the cross-platform testable path). |
| `durian-pi daemon switch --user|--system` | Migrate cleanly: drain the broker, uninstall the current trigger, install the target, start it, verify the heartbeat. The store is preserved. |
| `durian-pi daemon uninstall [--user|--system]` | Remove the trigger (default: whichever is installed); leaves the store. |
| `durian-pi daemon status` | Mode, platform mechanism, state, heartbeat age, and the switch hint. |
| `durian-pi daemon restart` / `stop` | Operator controls (`stop` writes `<db>.broker.down`). |
| `durian-pi daemon logs [-f]` | Tail the host/broker log. |

**Mode names for end users:** `--user` = per-user agent (Windows Task, macOS LaunchAgent, `systemd
--user`) — "starts when you log in, runs as you". `--system` = system daemon (Windows Service, macOS
LaunchDaemon, systemd system unit) — "starts at boot, runs without a login".

**Discoverability.** `durian-pi up` and the first `serve` print a one-line hint when no daemon is installed:
*"the broker stops when you log out — keep the team running with `durian-pi daemon install` (user) or
`durian-pi daemon install --system` (always-on)."* `durian-pi daemon status` always names the other mode and the
`switch` command; `durian-pi --help` lists `daemon`.

**Rules.** `install` never silently picks `--system` — the user mode is the explicit default. `switch`
is the only migration path and is idempotent (installing the mode already installed is a no-op message),
and it is the one place that stops the running host first. No persistent OS trigger is ever installed
without an explicit command (never on first `run`).

## Why (the decision rationale)

Durability and supervision are different jobs. pi-durable owns durability and `resume()`; the host owns
exactly: **process liveness, boot/logout survival, backoff, give-up, and the stop handshake.** It must
not own retries, scheduling, or resume — if it starts re-driving the queue, we get double-work. This is
the BYOC split from the research report: Pi is the worker primitive; durian-pi owns the broker above it; and
the supervisor is a *host*, not a second scheduler.
