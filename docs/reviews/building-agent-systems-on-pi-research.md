
I'm interested in discovering how different project embed Pi behind a service/daemon for building a system around it. My project is to use it as a base for building a team of agents which have supervisor monitoring them for issues and a broker managing their tasks.


-----------------

I'll research this — "Pi" could refer to a few different things, so let me pin down which agent runtime you mean and how projects embed it as a daemon."Pi" here is the terminal AI agent from pi.dev (earendil-works). Let me dig into the actual daemon/embedding patterns projects use.Good — I have the core embedding primitives. Now let me find multi-agent/supervisor patterns and real-world integrations.Let me capture the multi-agent patterns — Pi-to-Pi prompting, OpenClaw's orchestrator model, and a Pi orchestrator project.## First, which "Pi"

You mean **Pi**, the minimal open-source terminal coding agent from earendil-works ([pi.dev](https://pi.dev/)) — the one that powers OpenClaw [^6]. It's deliberately tiny: the shortest system prompt of any comparable agent and only four built-in tools (Read, Write, Edit, Bash), with everything else pushed into extensions, skills, and packages [^6]. That design is *exactly* why it's a good base for a supervisor/broker system — it doesn't impose an orchestration model you'd have to fight.

Pi exposes **four modes**: interactive, print/JSON, RPC, and SDK [^10]. The last two are what you care about.

## The three embedding surfaces

| Surface | Boundary | Control model | Best fit |
| --- | --- | --- | --- |
| **SDK** (`@earendil-works/pi-coding-agent`) | In-process (Node.js/Bun) | Direct TypeScript methods + events | Your daemon *hosting* Pi sessions in one process [^4] |
| **RPC mode** (`pi --mode rpc`) | Child process | JSONL commands/responses/events on stdin/stdout | Language-independent hosts, process isolation, IDEs [^3] |
| **`RpcClient`** (exported) | Child process | Typed TS wrapper over RPC | Subprocess-based TypeScript integration [^3] |

The SDK gives you `createAgentSession()`, where a session owns one conversation, its model, tools, queued messages, compaction state, and extension runtime — all inspectable via `session.messages`, `session.model`, `session.getActiveToolNames()`, etc. [^4]. You subscribe to a streamed event feed before prompting, and `session.dispose()` tears down cleanly [^4].

## How projects actually wrap Pi as a daemon

There are two concrete, readable reference implementations — and they took **opposite** approaches on the SDK-vs-RPC question, which is the most important design decision for you.

### 1. `pi-daemon` (CenterForAgenticAI) — hosts sessions **in-process via the SDK**

Runs headless Pi sessions in **one long-lived local process**; clients connect over a **private Unix socket**. Critically, *"The daemon hosts sessions in-process through the Pi SDK; it does not use `pi --mode rpc`"* [^7].

The patterns worth stealing:

- **Durable history = Pi's append-only session JSONL**, with a *rebuildable SQLite index* on top for session/lease/lifecycle/prompt state, then replayed + live frames streamed to clients [^7].
- **One time-limited driver lease per session, any number of watchers** — this is a supervisor primitive [^7].
- **Durable cursors** resume committed history; a `gap` frame reports lost live-only updates [^7].
- **Sleeping sessions release their in-memory Pi runtime** but keep identity and history [^7].
- Clean package split: a CLI for operators/process supervisors, plus `…/client`, `…/protocol` (with JSON Schema + runtime validators), and `…/testing` exports [^7].
- The daemon itself **declares no Pi extension, tool, command, skill, or handler** — it's a pure host [^7].

⚠️ **The gotcha that matters for a supervisor:** *"Several sessions may be awake in the same Node process. Their extensions can share ES-module state, the current working directory, environment variables, listeners, and timers. Load only extensions you trust to share that process."* [^7] If your agents run untrusted or mutually-hostile work, this pushes you toward process-per-agent isolation instead.

### 2. `pi-agent-daemon` (drbh) — JSON-RPC over a socket, **runs as a service**

Owns the Pi runtime (TypeScript/Deno) and exposes it to SDKs and gateways over **newline-delimited JSON RPC** [^8]. Requests carry an `id`; the server streams events and returns results correlated by that id [^8].

Methods: `configure`, `create_session {system_prompt, tools, model, cwd}`, `prompt {session_id, message}`, `dispose_session`, `auth_status`, `auth_login`/`auth_input`/`auth_cancel` (OAuth flows that run in the background while the connection keeps serving), and `shutdown` [^8]. It emits a **ready frame** carrying daemon, upstream-agent, and protocol versions [^8].

It's explicitly designed to be a **managed service**: it runs under **systemd (user or system) or launchd**, needs no socket activation — just a stable socket path and working directory, and you should pass `--cwd` so default sessions have a predictable workspace [^9]. Default socket paths are `$XDG_RUNTIME_DIR/pi-agent-daemon.sock` (user) and `/run/pi-agent-daemon/pi-agent-daemon.sock` (system), with a `health` subcommand for checks [^9] [^9].

⚠️ The README documents addressing by `session_id` but **does not specify concurrency guarantees** — whether simultaneous prompts within or across sessions are serialized is undocumented [^8]. If your broker dispatches concurrently, verify this yourself.

## The multi-agent layer: where "supervisor" and "broker" come from

This is the part most relevant to your goal, and there are three mature patterns to borrow from.

### The BYOC / durable-orchestration split (the canonical framing)

A team building an enterprise platform on `pi-agent-core` argued the split explicitly: a **control plane** (inference, tool catalogue, orchestration logic, safety fences, command processing) on their side, and a **data plane** in the customer's cloud with *"a durable orchestration layer for scheduling/durability/retries"* and sandboxed microVMs, with `pi-agent-core`'s `Agent` class running *inside* each sandbox [^2]. Their reason for choosing it over LangGraph is the key insight:

> *"because a durable orchestration layer sits above the agent, LangGraph's graph DSL + checkpointing would be duplicated/conflicting work. pi-agent-core is deliberately 'just the agent turn' which is exactly what a durable-orchestration activity wants to be."* [^2]

They also lean on `beforeToolCall`/`afterToolCall` hooks for validation, and context-as-plain-JSON for persistence [^2]. **This is your architecture**: Pi is the worker primitive; you own the broker (dispatch/durability/retries) and supervisor (validation/observability) above it. Note the caveat — this was a *proposed* pattern, not a maintainer-endorsed one, and the only reply raised documentation gaps and session-lane stability concerns rather than endorsing it [^2].

### OpenClaw: one gateway, many isolated agents, with a real broker

OpenClaw runs **multiple agents in a single gateway process and port**, each a fully isolated "brain" with its own workspace, state directory, session store, and optionally its own model/provider [^1]. Its **Workboard** is essentially the task broker you're describing:

- Card lifecycle: `todo → running → review → done`, plus `blocked` [^1]
- Agent-facing tools: `workboard_list`, `_read`, `_create` (parent/child), `_claim`, `_link` (dependency chains), `_heartbeat`, `_runs`, `_dispatch`, `_reassign`, `_promote` [^1]
- A **dispatch cycle**: promote dependency-ready children to `todo` → **block expired claims (stale agents)** → claim next card → start worker → track completion [^1]

That "block expired claims" step plus `workboard_heartbeat` **is a supervisor** [^1]. OpenClaw's ecosystem splits the rest across ClawTeam (circuit breakers in healthy/degraded/open states, retry with exponential backoff, **zombie detection and idle-worker identification**, cost dashboards) and Mission Control (multi-gateway hierarchical orchestration) [^1]. They also describe the simplest possible broker — **file-based messaging** with JSON inboxes, the same pattern Claude Code's Agent Teams use (shared task list + file locking + named mailboxes) [^1] — and MCP-based delegation, where the lead calls another agent's skills as MCP tools over SSH [^1].

### `pi-agent-orchestrator`: the pattern closest to your design

This one is worth studying most closely, because it does *exactly* "turn one Pi session into a visible team of agents" [^4fecbe#651]. It adds an execution layer **inside the Pi host process** — the host keeps the session, tools, and model path, while the orchestrator adds bounded child agents, coordination, isolation, schedules, and a live operator view [^5].

Mapping directly to your two roles:

- **Broker** = the **dispatcher** with `single` / `crew` / `swarm` / `auto` strategies (multi-agent is opt-in; `single` is the default), plus queues and lifecycle ops: spawn, queue, steer, stop, inspect, collect [^5] [^5].
- **Supervisor** = `/agents`, the live operator view showing running *and* queued agents, current task/agent type, resource and performance metrics, schedules and daemon state, with multi-select steering and termination [^5].

Two ideas here are directly reusable for a robust supervisor: **permission inheritance** (*"a child cannot silently regain a tool or scope removed by its parent"*) and **structured handoffs** — machine-readable state passed between agents rather than hidden chat context [^5]. It also supports **worktree isolation** so parallel writers don't collide, persistent cron/interval/one-shot scheduling with daemon visibility, and authenticated **cross-extension RPC** with a strict spawn allowlist and mutation rate limits [^5]. Their stack is deliberately staged: capture (`pi-wishcraft`) → persist (`pi-missions`, durable plan/queue/evidence/recovery) → execute (`pi-agent-orchestrator`) [^5].

Finally, the minimal end of the spectrum: Armin Ronacher's `/control` extension *"lets one Pi agent send prompts to another. It is a simple multi-agent system without complex orchestration"* [^6] — useful as a prototype before you build the real broker.

## Concrete recommendations for your build

1. **Use the SDK, host in-process, isolate by process where it matters.** The SDK is the intended path for a Node/Bun host that wants full API access [^4], and `pi-daemon` proves the in-process model works at scale [^7]. But because extensions share ESM state, cwd, env, listeners and timers across sessions in one process [^7], run **one daemon process per trust domain**, or one per agent if agents are mutually untrusted.

2. **Put durability in your layer, not Pi's.** Persist Pi's append-only session JSONL as the durable transcript and keep a *rebuildable* index (SQLite) for session/lease/lifecycle/prompt state, exactly as `pi-daemon` does [^7]. Your broker owns scheduling, retries, and checkpoints — that's the whole point of the BYOC argument [^2].

3. **Model the supervisor as leases + heartbeats + watchers, not as another agent.** Pi-daemon's "one time-limited driver lease, any number of watchers" [^7] and the Workboard's "block expired claims" dispatch step [^1] are the same primitive. Add ClawTeam-style circuit breakers and zombie detection for agent-level failures [^1].

4. **Model the broker as a card queue with dependency links.** Copy the Workboard card lifecycle and the dispatch tools verbatim — they're a battle-tested shape [^1]. Hand off *structured* state, never chat context [^5].

5. **Watch these correctness traps** (they'll bite a naive broker):
   - A successful `prompt` response means *accepted/queued*, not *done* — check `data.disposition`, and if it's `"handled"` no run started, so don't wait for `agent_settled` [^3].
   - `agent_end` is **not** the end of work — retries, overflow recovery, compaction, and steering can follow. Wait for `agent_settled` when you need to know Pi won't continue [^4] [^3].
   - **Subscribe before prompting**, or you'll miss fast completions [^3].
   - RPC uses **strict JSONL framing split on LF only** — do not use Node's `readline`, which also splits on `U+2028`/`U+2029` (valid inside JSON strings). Stdout is reserved for protocol; logs go to stderr; honor backpressure both ways [^3].
   - `SessionManager` is authoritative for finalized model context; assigning `session.agent.state.messages` will **not** replace persisted context [^4].
   - `pi-agent-daemon`'s concurrency behavior is undocumented — test it before relying on parallel prompts [^8].

**Bottom line:** the field converges on a consistent shape — Pi (or `pi-agent-core`) as a deliberately minimal "just the agent turn" worker, hosted either in-process via the SDK or behind a JSONL-RPC socket, with a **separate durable orchestration layer above it** that owns dispatch/leases/retries. Your broker is that dispatcher + card queue; your supervisor is the lease/heartbeat/watcher + circuit-breaker layer. `pi-agent-orchestrator` is the closest existing blueprint, and `pi-daemon` is the cleanest reference for the hosting layer itself.

**References**

[^1]: [Multi-Agent Workflows | OpenClaw Docs — Community Documentation for the Open-Source AI Agent](https://clawdocs.org/guides/multi-agent) (21%)
[^2]: [Using pi-agent-core as the runtime for a customer-hosted scheduled-agent platform · earendil-works/pi · Discussion #3337 · GitHub](https://github.com/earendil-works/pi/discussions/3337) (16%)
[^3]: [RPC Mode · Documentation · Pi](https://pi.dev/docs/latest/rpc) (13%)
[^4]: [SDK · Documentation · Pi](https://pi.dev/docs/latest/sdk) (10%)
[^5]: [GroepOnline/pi-agent-orchestrator GitHub Repo](https://github.com/GroepOnline/pi-agent-orchestrator) (10%)
[^6]: [Pi: The Minimal Agent Within OpenClaw | Armin Ronacher's Thoughts and Writings](https://lucumr.pocoo.org/2026/1/31/pi/) (9%)
[^7]: [packages/pi-daemon/README.md](https://github.com/CenterForAgenticAI/tools/blob/main/packages/pi-daemon/README.md) (9%)
[^8]: [drbh/pi-agent-daemon GitHub Repo](https://github.com/drbh/pi-agent-daemon) (6%)
[^9]: [docs/services.md](https://github.com/drbh/pi-agent-daemon/blob/main/docs/services.md) (5%)
[^10]: [Pi Agent](https://pi.dev/) (1%)


-----------------

Context your last report didn't have

 You assumed the system embeds Pi, the coding agent (@earendil-works/pi-coding-agent) via its SDK or RPC mode. That is not our system. Our project, durig, sits one layer down and does
 not use pi-coding-agent at all — so several of your recommendations (SDK-vs-RPC, data.disposition, agent_settled, strict JSONL framing) are inapplicable. Please read this before
 answering.

 What durig is
 - A CLI + durable queue that runs a team of LLM seats (pm, impl, qa, lead, advocate, scribe, devtools, auditor, designer) over a shared store.
 - Built directly on @earendil-works/pi-durable v1.3.0 — the durable conversation/task/document harness. Harness.open() is hosted in-process. pi-durable exposes no server/socket/RPC
   surface; it is a library.

 Hard constraints
 - Native Windows only. No WSL, no Docker. systemd/launchd and Unix-domain sockets are unavailable.
 - Single-writer store per database. Exactly one process may own the harness/store. The sanctioned concurrency is one broker (cli.mjs serve) driving N seats. Two drivers = double-wake
   corruption.
 - Each seat is a pi-durable conversation; all are hosted inside the one broker process.
 - Per-item git worktrees isolate concurrent edits; child processes are reaped with Windows Job Objects.

 What we already have — build on it, don't re-research it

 Your last report's ideas mapped onto our existing artifacts:
 - In-process host of N sessions (the pi-daemon shape) → our broker (src/broker.mjs / cmdServe).
 - "One time-limited driver lease, any number of watchers" → src/genlock.mjs (pid + age lease, stale-steal).
 - Supervisor with failure detection → src/supervisor.mjs (failureStreak → escalate).
 - Card queue with claim/deps/dispatch → RigQueue + claim_work/send_work/defer_work.
 - Intended-vs-crash exit distinction → <db>.broker.log writes START pid=… and EXIT pid=… reason=<stop|signal|max-duration|max-passes>; the code comment states "a START with no
   matching EXIT means the broker died abnormally (a kill or a throw)."
 - Process reaping → per-item worktrees + Windows Job Objects.
 - Subscribe-before-first-work (your "subscribe before prompting" analogue) → already done in cmdServe.

 The gap we're solving: nothing supervises the broker process itself. up spawns a detached child (detached:true, unref()) and forgets it. Our last broker died with a START and no EXIT
  (a kill or throw) and stayed down — queued work and spooled operator intents waited indefinitely.

 What we're asking you to research

 A supervisor/daemon around the broker, in two stages:
 - (A) Thin OS-level supervisor (do this first): keep cli.mjs serve alive — restart on crash/hang, honor intended stops, guarantee single-instance. No new socket; scheduling stays in
   the broker.
 - (B) Control-plane daemon (later, security-gated): add an IPC/control socket for remote clients / TUI attach. This opens a trust boundary and, by our own rule, requires a written
   security position before any code.

 Answer A first; carry B as a separate, security-gated question.

 Prioritized questions

 A — Windows-native process supervision (TOP PRIORITY)
 1. With no systemd/launchd and native-Windows-only, compare: Windows Service (winsw, node-windows), Task Scheduler (at-logon vs "run whether user is logged on or not"), NSSM, and a
    self-supervising parent. Criteria: survives logout, reboot, and sleep/Modern Standby; runs a Node child with a fixed cwd + env; captures stdout/stderr to a file; clean shutdown;
    upgrade without an interactive session.
 2. How do established long-running Node apps on Windows (PM2, VS Code server, language servers) actually solve this? Give concrete configs, not just names.
 3. If we later need a control channel, what's the Windows-correct replacement for a Unix socket — named pipes (and their ACL model) vs loopback TCP + token? Threat model for each.

 B — supervising an in-process library host
 4. We host pi-durable's Harness in one Node process (no RPC, no coding agent). Are there references for supervising a stateful, single-writer SQLite worker? How does it differ from
 supervising a stateless worker?
 5. Confirm or refute: multiple supervised processes sharing one pi-durable store is an anti-pattern. If it is ever legitimate, name the exact failure modes.

 C — liveness: hung vs dead
 6. The broker can be alive but wedged (we observed a ~15-minute pass). A pid check cannot catch that. What is the minimal heartbeat for "the pass loop is progressing"? Cover systemd
 WATCHDOG=1, Kubernetes liveness vs readiness/startup probes, and Erlang/OTP supervision. Recommend a concrete heartbeat — note we already log PASS <n> ms=<dur> woke=….

 D — restart vs intended stop
 7. A naive "restart on exit" supervisor would undo an operator's serve --stop. How do systemd (Restart=on-failure, RestartPreventExitStatus), Docker restart policies, and Kubernetes
 CrashLoopBackOff durably encode "do not restart after an intentional stop"? Where should that marker live (exit code / a file / the store) so it survives a reboot?

 E — restart & durability contract
 8. Our harness persists everything and resume()s pending runs on reopen, and we have a hard rule: never close the harness with a live run (abandoning one strands its submission).
 What is the supervisor's correct contract on restart — drain, or trust resume()? Find references for the handoff between a supervisor and a durable task runtime (Temporal/Cadence
 workers, Sidekiq/Celery, Durable Functions).
 9. Conversely, what must the supervisor not duplicate, given the harness owns durability?

 F — failure handling
 10. Restart storms / deterministic crash loops / cost runaway. Backoff, and a "give up and alert" state (ClawTeam's healthy/degraded/open). Should the generator-lease cap feed the
 loop-breaker?
 11. Zombie / stale-claim detection. We have known cases of seats holding stale claims that read "working". Should heartbeat-based reaping belong to the supervisor or the broker?

 G — security & multi-rig
 12. Security-position inputs for a local daemon control channel on Windows: authentication, authorization, audit. Don't design the socket — give us the threat model and the questions
 a security position must answer.
 13. Multi-rig / cross-host. We have a second rig and claims of cross-host reach. How are embedded agent daemons addressed/authenticated across machines (Tailscale, MCP-over-SSH)? Is
 there prior art in OpenRig's "watchdog wake" we should read?

 H — observability contract
 14. Define the SLIs a supervised broker should expose — liveness (pass advancing), readiness (store writable + sole owner), startup (harness opened) — and the shape of a
 health/status surface. Any Pi-ecosystem convention for a daemon's ready/health frame?

 I — testing
 15. How do reference projects test the supervisor itself — crash injection, hang injection, restart storms, single-instance races, resume-after-crash? Name concrete techniques.

 Method — please work this way

 1. Critique our actual design, not a generic Pi host. Read src/broker.mjs, src/genlock.mjs, src/supervisor.mjs, and docs/ROADMAP.md items 52/54/55 if you have repo access; if not,
    ask and we'll paste the relevant parts.
 2. Pre-mortem. Write the incident list for "the daemon caused an outage": double-drive, stranded run, lost spool, split-brain, restart storm, orphaned worktree, stale genlock,
    sleep/clock jump. For each: detect / recover / prevent.
 3. Broaden the source class. Your last report drew only on Pi-ecosystem projects. Add the canon for supervising long-lived, stateful workers: Erlang/OTP supervision trees, systemd,
    Kubernetes probes/restart policy, Temporal/Cadence, Sidekiq/Resque, supervisord, PM2, Windows services.
 4. Inventory the seams. For each durable artifact/boundary — .broker.json, .stop, .broker.inbox, genlock.*, per-item worktrees, pi.*.sqlite — state what the daemon does on crash /
    restart / clean shutdown.
 5. Label each claim's evidence class (observed, documented, advertised-elsewhere, inferred) and cite a URL for external claims.

 What a complete answer looks like

 - A recommended Option A design for Windows — the specific mechanism named and justified, with rejected alternatives and why.
 - The restart / stop contract: when it restarts, when it must not, and how intent is recorded durably.
 - The liveness signal: what the broker emits, what the supervisor checks, thresholds.
 - The pre-mortem table and the seam inventory.
 - A security question list for a future control socket (Option B) — not a design.
 - An explicit "could not verify" section.




-----------------



I'll start by reading your actual repo, then research the Windows-native supervision canon.Good — I have your repo context. Now let me gather the Windows supervision canon, watchdog/heartbeat references, and restart-policy semantics in parallel.Now let me pull the authoritative specifics on service recovery, restart semantics, and probe backoff.Let me fill the last gaps: cross-host addressing, sleep/standby behavior, supervisor testing, and the named-pipe/TCP security specifics.Let me pull the last three references that matter most for your design: OpenRig's daemon/watchdog model, sleep/standby behavior for services, and pi-durable's crash-recovery semantics.# durig broker supervision — Option A, with the canon behind it

## Evidence-class legend

Every claim below is tagged: **[observed]** (I read it in your repo/context), **[documented]** (vendor/official docs I fetched), **[advertised-elsewhere]** (third-party write-up, not the vendor), **[inferred]** (my reasoning from the above).

## Method note — what I actually read

I read the repo landing page, README, and the commit messages visible there [^1][^1][^1][^1]. **I could not read `src/broker.mjs`, `src/genlock.mjs`, `src/supervisor.mjs`, or `docs/ROADMAP.md` items 52/54/55** — they are not exposed on the page I could fetch, so my critique of those files is **[inferred]** from your context doc plus the README. **Please paste those four** and I'll tighten the code-level critique; the design below does not depend on them.

Also: you were right that my previous report assumed the wrong layer. This answer is built on `pi-durable` as an in-process library with no RPC surface [^1], not on `pi-coding-agent`.

---

## 1. Recommended Option A design

**Mechanism: a WinSW-hosted Windows Service, running a tiny supervisor that owns a single broker child, plus a Worker-thread heartbeat inside the broker.** Two layers, each doing only what it can actually see.

```
SCM ──supervises──▶ winsw.exe (service host, Session 0)
                       └─spawns──▶ node src/supervisor.mjs   ← "the supervisor"
                                     └─spawns──▶ node cli.mjs serve   ← the broker (sole store writer)
                                                   └─ Worker thread: heartbeat + wedge self-kill
```

### Why a Windows Service (WinSW), and why not the alternatives

| Option | Survives logout | Survives reboot | Restart on crash | Hang detection | Graceful stop | Upgrade w/o session | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **WinSW service** | ✅ Session 0 [^4] | ✅ auto-start | ✅ `onfailure` [^4] | ✖ (exit only) | ✅ `stoptimeout` [^4] | ✅ replace exe+xml, restart | **Recommended base** |
| Task Scheduler | ✅ "run whether logged on or not" runs non-interactive [^10] | ⚠️ startup trigger unreliable, wake timers dead on Modern Standby [^19] | ✖ weak | ✖ | ⚠️ | ⚠️ needs stored creds | **Rejected** as primary |
| NSSM | ✅ | ✅ | ✅ | ✖ | ✅ | ✅ | **Rejected**: unmaintained since 2017, weak process-tree handling [^11][^20] **[advertised-elsewhere]** |
| node-windows | ✅ | ✅ | ✅ | ✖ | ✅ | ✅ | **Rejected**: it *is* a winsw wrapper with an extra npm layer [^21][^12]; use WinSW directly for full config control |
| Self-supervising detached parent | ✅ | ✖ | ✅ | ✅ | ⚠️ | ⚠️ | **Rejected as the base** — this is the exact shape that failed you (a `START` with no `EXIT` and nothing above it) |

The decisive point: **the SCM restarts on *process exit*, and only on process exit.** It cannot see a broker that is alive but wedged. So the base layer must be a service, and the *hang* case must be handled by the broker killing itself (see §3). This is exactly how systemd does it — the daemon must send `WATCHDOG=1` or systemd kills and restarts it [^2] — except Windows gives you no `sd_notify`, so the daemon must be its own watchdog.

### The WinSW config

```xml
<service>
  <id>durig-broker</id>
  <name>durig broker</name>
  <executable>C:\Program Files\nodejs\node.exe</executable>
  <arguments>"C:\durig\src\supervisor.mjs" --db "C:\durig\rig.sqlite"</arguments>
  <workingdirectory>C:\durig</workingdirectory>
  <env name="DURIG_DB" value="C:\durig\rig.sqlite"/>
  <env name="DURIG_MAX_CONCURRENT_SEATS" value="1"/>

  <stoptimeout>90sec</stoptimeout>                 <!-- cooperative drain window -->
  <onfailure action="restart" delay="5 sec"/>
  <onfailure action="restart" delay="30 sec"/>
  <onfailure action="restart" delay="2 min"/>
  <onfailure action="none"/>                       <!-- give up: no 4th action -->
  <resetfailure>1 hour</resetfailure>

  <logpath>C:\durig\logs</logpath>
  <log mode="roll-by-time"><pattern>yyyyMMdd</pattern></log>

  <serviceaccount>
    <username>.\durigsvc</username>
    <password>…</password>
    <allowservicelogon>true</allowservicelogon>
  </serviceaccount>
</service>
```

Each element is documented: `onfailure` supports `restart`/`reboot`/`none` with a `delay`, and **the last action repeats forever if you run out of entries** — so a terminal `action="none"` is how you encode "give up" [^4]. `resetfailure` is the window in which you consider the service to have run successfully, default 1 day [^4]; the SCM itself counts failures since boot and resets after `dwResetPeriod` [^13]. `stoptimeout` defaults to 15 s and can be raised to give your drain longer [^4]. Use a **dedicated service account** (`.\durigsvc`) rather than LocalSystem — the service does not need high privilege, and `allowservicelogon` grants the "Log on as a service" right automatically [^4].

> **Use a user account, not LocalService/NetworkService**, if the broker needs the same profile-scoped git/node paths and credentials the operator uses. LocalService has no network identity and a different `%USERPROFILE%`, which will silently change worktree and npm paths.

### Why a supervisor *child* under the service

WinSW runs one process. If that process is the broker, then WinSW only ever sees "broker exited" — it cannot distinguish "exited after a cooperative stop" from "was killed," and it cannot kill a *hung* broker. So make the service's process a thin supervisor that:

- acquires single-instance (§ restart contract),
- spawns the broker with a fixed cwd + env [^4][^4],
- watches a heartbeat file (read-only — **never opens the store**),
- kills the broker (`TerminateProcess`) if the heartbeat is stale,
- honors the durable stop marker (does not restart),
- forwards child stdout/stderr to the log,
- applies backoff and give-up.

This supervisor touches no durable state except the heartbeat file and the stop marker, so it does not violate your single-writer rule.

> **If you want to defer the extra process:** run `node cli.mjs serve` directly under WinSW and rely on the broker's Worker-thread watchdog for wedges (§3). That fully fixes the *observed* outage (crash → SCM restart). Add the supervisor child only when you need to kill a broker whose **event loop is blocked** — a Worker thread covers that too, so this is a genuine either/or. My recommendation is the supervisor child because it also cleanly owns the stop/backoff logic in one place, away from the store.

---

## 2. How established long-running Node apps actually do it

- **PM2 on Windows** is not self-sufficient: PM2's own logon-bound process dies on logout, so the established pattern is `pm2-windows-service`/`pm2-installer`, which installs a **Windows service that hosts PM2**, and PM2 then does the app-level `autorestart` + `max_restarts` + `exp_backoff_restart_delay` [^22][^23] **[advertised-elsewhere]**. The lesson is the two-layer split you're already converging on: **service = boot/logout survival; inner supervisor = restart/backoff.**
- **Language servers** (LSP) are the opposite model: the *editor* owns the lifecycle and the server never self-supervises; "intended stop" is a `shutdown` request followed by `exit`. **[inferred]** The transferable idea is the **two-step stop handshake** — a "please stop" command and a "now die" command — which is exactly what `serve --stop` should be.
- **OpenRig** runs a local daemon that holds state in SQLite (WAL mode, migrations, periodic queue sweeps) and is driven over local HTTP with a `/healthz` route [^7]; `rig daemon start` will start it, and **"a daemon that is already running keeps running the code it started with"** — i.e. upgrading requires a restart [^7]. OpenRig's *watchdog* is an **application-level timer** ("the alarm you set for yourself, because a seat cannot wake itself"), and those jobs are persisted in the DB so they survive daemon restarts [^14] — it is **not** a process supervisor, so it is worth reading for your *scheduling* model, not for this problem [^7] **[observed]**.
- **VS Code Server** is a Node service with a URL token and process-level supervision of extension hosts, but I could not verify its Windows supervision specifics — see §7. **[could not verify]**

---

## 3. Restart / stop contract

The canon all encodes "do not restart after an intentional stop" the same way: **exit code + a durable intent marker.**

- systemd: `RestartPreventExitStatus=` suppresses restart regardless of `Restart=`, and a `systemctl stop` is never restarted [^2][^2].
- Docker: a manual `stop` suppresses auto-restart until the container is started again or the daemon restarts; `on-failure` only restarts on non-zero exit [^15][^24].
- supervisord: `autorestart=unexpected` restarts only on exit codes **not** in `exitcodes`; `exitcodes` defaults to `0` [^6].
- Erlang/OTP: a **`transient`** child is restarted only if it terminates *abnormally* (not `normal`/`shutdown`) [^9].

### The exit-code taxonomy (adopt this)

| Cause | Broker exit code | Supervisor action | Durable marker |
| --- | --- | --- | --- |
| `serve --stop` (intended) | **0** | do not restart; stay down | write `<db>.stop` |
| crash / uncaught throw | **1** | restart with backoff | clear nothing |
| wedge (pass stalled) | **2** (distinct) | restart; count toward loop-breaker | log `WEDGE` |
| restart storm give-up | **0** | do not restart; alert | write `<db>.stop` |

Then: WinSW `onfailure` restarts on any **non-zero** exit, and a **clean exit (0)** is not a "failure" to the SCM [^4] **[inferred from documented `onfailure` semantics]**. So intended stop and give-up both exit 0 and the SCM leaves them down; crash and wedge exit non-zero and get restarted.

### Where the intent marker lives (so it survives a reboot)

Put it in **a file next to the store**: `<db>.stop`. This is consistent with your existing seam (`serve --stop` already clears `<db>.broker.json` [^1]) and it is reboot-durable. `serve --start` (and `up`) clear it.

- **`<db>.stop` present** → the supervisor's child spawns, sees the marker, and exits 0 without starting the broker. The service stays "running but idle" (or the supervisor exits 0 and the SCM leaves it stopped).
- **`<db>.stop` absent** → start normally.
- The supervisor must **never** delete `.stop`; only an explicit operator command does.

> **Do not** use the store to hold the intent marker for the *supervisor's* purposes. The supervisor must not open the store (§5). The broker may *also* record "last stop was intended" in the store for `status`, but the supervisor's decision must come from the file.

### Single-instance, precisely

The supervisor must fail closed on a live owner:

1. On start, read `<db>.broker.json` + the genlock. If the recorded pid is **alive**, do not spawn — exit 0 (or wait). If dead, clear and proceed (this is your genlock stale-steal).
2. Only then spawn the broker, which re-acquires the lease before opening the store.
3. A second `serve` already refuses to start and `run` refuses while a broker drives the DB [^1] — the supervisor must not bypass that.

**The subtle failure:** the SCM may restart the broker while the old one is still draining. Require the new broker to observe the old pid dead **and** the lease released before it opens the store, or you get double-drive. Your Job Objects already reap *children*; they do not reap the *old broker*, so the lease is the only guard.

---

## 4. Liveness: hung vs dead

A pid check cannot catch a ~15-minute pass [observed in your context]. The canon splits this exactly as you suspected:

- **systemd**: `WatchdogSec=` — the service must call `WATCHDOG=1` within the interval or it is placed in a failed state, killed (`SIGABRT`), and restarted if `Restart=` allows [^2]. The daemon should ping at **half** the interval [^16][^25] **[documented]**.
- **Kubernetes**: **liveness** probes are explicitly for the "running but unable to make progress / deadlock" case and trigger a restart [^8]; **readiness** says "ready to accept traffic"; **startup** gates the others and runs only at boot [^8].
- **Erlang/OTP**: the supervisor detects *death* (via process links), not hangs; a hang needs a separate watchdog process that pings and kills. **[inferred from OTP model]** [^9].

### The heartbeat, concretely

You already emit `PASS <n> ms=<dur> woke=…` — that is a **progress** signal, not a **liveness** signal, and conflating them is why a 15-minute pass looks like a hang. Emit **two** signals:

| Signal | Written by | Interval | Timeout | Catches |
| --- | --- | --- | --- | --- |
| **Liveness** (event loop turning) | a `setInterval` in the broker | every **20 s** | **60 s** | event-loop blockage / full-process hang |
| **Progress** (pass advancing) | the pass loop at phase boundaries | each model/tool call boundary + every 30 s | **stream-timeout + margin** | stuck await / harness deadlock |

- The **progress** timeout should be derived from `DURIG_STREAM_TIMEOUT_MS` (default 600000 ms = the `openai` SDK's 10-minute request timeout [^1]) plus a margin — because a single legitimate model call can legitimately take up to that long.
- **Who checks:** the *liveness* check must live **outside the blocked thread**. A Worker thread in the broker can do this: if the main thread stops updating the heartbeat, the Worker calls `process.exit(WEDGE)` (a Worker's `process.exit()` terminates the whole process — **[inferred/documented-ish]**; verify in your Node version). This needs no second OS process and no store access. If you prefer belt-and-braces, the supervisor child can also read the heartbeat file and `TerminateProcess` a stale broker.
- **Backoff on wedge restarts:** treat a wedge like a crash for the restart count, but log it distinctly so `status` can show "restarted for wedging N times."

> **Sleep/clock-jump trap:** compute the heartbeat timeout and lease ages with a **monotonic** clock, not wall-clock, or a Modern Standby sleep will make a live broker look dead. On Modern Standby, the **Desktop Activity Moderator** suspends interactive-session threads and **throttles Session 0 services** (suspended most of the time), and timer/elapsed-time behavior drifts [^3][^3]. Handle the guaranteed `PBT_APMRESUMEAUTOMATIC` resume event and **record the sleep gap explicitly as a gap**, not as a failure [^3].

---

## 5. Supervising a stateful, single-writer SQLite worker

**Q4 — how it differs from a stateless worker** **[inferred, grounded in documented SQLite/WAL semantics]**:

| Aspect | Stateless worker | Your stateful single-writer broker |
| --- | --- | --- |
| Restart cost | start fresh | reopen + WAL replay + `resume()` — **not free** |
| Restart safety | idempotent by design | can **duplicate or strand** work (see replay policy) |
| Health = ? | process alive | **store writable AND sole owner** |
| Can the supervisor probe the store? | n/a | **No** — a probe is a second connection and can contend |
| Concurrency | scale out | **must not** scale out — one writer |

So the health surface must be a **file/pid/heartbeat**, never a store query. WAL lets many readers coexist with one writer [^26], and contention surfaces as `SQLITE_BUSY` [^27] — which is exactly why a store-probing supervisor is dangerous.

**Q5 — multiple supervised processes sharing one store is an anti-pattern: confirmed.** Failure modes, named: `SQLITE_BUSY`/lock contention [^27]; double-wake (your D46) [^1]; lost updates if two harnesses drive the same conversation; lease-theft races; and **non-idempotent side effects** if two drivers replay the same unfinished task. The one legitimate case is **multiple *readers*** — your TUI/`watch` is a read-only viewer that never opens the store as a writer [^1] — and that is *not* "sharing the writer role." The rule: **one writer per store, many readers OK, one store per writer.**

---

## 6. Pre-mortem — "the daemon caused an outage"

| Incident | Detect | Recover | Prevent |
| --- | --- | --- | --- |
| **Double-drive** | second start sees live pid in `.broker.json`/genlock | refuse to start (fail closed); operator stops one | atomic lease acquire before opening store; supervisor waits for old pid dead + lease released before respawn |
| **Stranded run** | `START` in broker log with no matching `EXIT`; a task checkpoint with no settlement | reopen + `resume()` re-schedules; the submission is reacquirable [^5] | **never close the harness with a live run**; intended stop = cooperative drain, never `SIGKILL` |
| **Lost spool** | intent files in `<db>.broker.inbox/` with no submission; dead-letter dir grows | re-drain next pass; dead-lettered intents surfaced with reason [^1] | atomic file-per-intent (already); give every intent a `--request-id` so re-drain is idempotent [^1] |
| **Split-brain** | two live leases / two `.broker.json` | staleness + pid-liveness → one side steals | single-writer discipline; **use monotonic age for leases** so a sleeping-but-alive broker isn't robbed |
| **Restart storm / crash loop / cost runaway** | N abnormal `START`s within a window in the broker log | give up: write `.stop`, exit 0, alert | WinSW `onfailure` delays [^4] + `resetfailure` [^4]; Erlang `intensity`/`period` escalation [^9]; k8s exponential backoff capped at 300 s [^8]; supervisord `startretries`→`FATAL` [^6] |
| **Orphaned worktree** | `item-<id>` dirs with no owning run | reap via Job Objects + prune; `complete_work` retires with `force:false` [^1] | startup sweep: reconcile `git worktree list` against the queue |
| **Stale genlock** | lease pid dead, or age > cap | stale-steal | pid-liveness **plus** monotonic age; reconcile leases against the process table at startup |
| **Sleep / clock jump** | inflated `ms=`; heartbeat gaps; monotonic vs wall mismatch | re-anchor timers on `PBT_APMRESUMEAUTOMATIC`; record the gap as a gap [^3] | monotonic clock for all timeouts/ages; never fire a watchdog across a sleep |

**Q10 (generator-lease cap → loop-breaker):** keep them separate but *aware*. The cap is a concurrency limiter; the loop-breaker is a restart-frequency limiter. With `DURIG_MAX_CONCURRENT_SEATS=1` [^1], each restart is more expensive in wall-clock, so a slightly shorter give-up window is defensible. But do not let the cap *be* the breaker — a serialized rig can still crash-loop.

**Q11 (heartbeat-based reaping — supervisor or broker?):** **the broker.** Reaping stale seat claims requires reading/mutating claims, which only the writer may do, and "a seat holding a stale claim that reads working" is application semantics. The supervisor only knows the *broker's* liveness. Your `generation_in_flight` / `generation_stale` already lives in `status`/`watch` [^1] — keep it there and have the broker reap.

---

## 7. Seam inventory

| Artifact / boundary | On crash | On restart | On clean shutdown |
| --- | --- | --- | --- |
| `.broker.json` | stale (pid dead) → next start steals/clears | re-acquired by the new broker before opening store | cleared by `serve --stop` [^1] |
| `<db>.stop` *(new)* | absent → supervisor restarts | read at startup; if present, exit 0 without starting | **written** by `serve --stop`; cleared by `serve --start` |
| `.broker.inbox/` | files remain → re-drained next pass (must be idempotent) | drained at **START** of each pass, before `harness.inspect` [^1] | do **not** delete; leave for next start |
| `genlock.*` | stale lease (dead pid) → steal | reconciled against process table | released |
| per-item worktrees | may be orphaned → startup sweep | reused if item still claimed | retired by `complete_work` `force:false` [^1] |
| `pi.*.sqlite` (store) | WAL replay on reopen; `resume()` re-schedules [^5] | opened once by the sole broker | closed **after drain**; never close with a live run |
| `<db>.broker.log` | last line `START` with no `EXIT` = abnormal | new `START` appended | `EXIT reason=stop` |
| `<db>.broker.heartbeat` *(new)* | stale | rewritten each tick | marked stopped / removed |

**Q8 (drain vs trust `resume()`):** the handoff contract in the canon is: **the supervisor stops the worker gracefully and lets the durable runtime recover; it never force-kills a run in progress.** Temporal does not detect worker crash directly — it relies on timeouts to drive retries, and a new worker **replays** history to resume [^28][^29][^30]. Sidekiq/Celery re-queue on worker death; Durable Functions replays. So: **on intended stop → drain; on crash → trust `resume()` but accept the replay-policy limits.**

Crucially, **`resume()` is not idempotent at the external boundary**: after a crash between an execution intent and its settlement, pi-durable **cannot distinguish "already ran" from "did not run"** and will only auto-replay if the stored policy and current tool declaration both say `safe`; `unsafe` stops auto-replay but does not undo an action [^5][^5]. So any non-idempotent side effect needs an **external operation id + idempotency/reconciliation**, not supervisor cleverness [^5].

**Q9 (what the supervisor must not duplicate):** it must not own durability, retries, scheduling, or resume — the harness owns all of those (`resume()` starts the scheduler; submitting or waiting starts it too [^5]). The supervisor owns exactly: **process liveness, boot/logout survival, backoff, give-up, and the stop handshake.** If it starts re-driving the queue, you get double-work.

---

## 8. Option B — security question list for a control socket (questions only, no design)

**Windows replacement for a Unix socket:** a **named pipe** with an explicit DACL, or **loopback TCP + token**. Facts to weigh:

- A named pipe's **default** security descriptor grants full control to LocalSystem, administrators, and the creator owner, and **read access to Everyone and anonymous** — so the default is far too open; you must set the DACL explicitly [^aa25c6#30].
- To exclude remote users and other terminal-services sessions, use the **logon SID** on the pipe DACL [^aa25c6#54].
- Named pipes are a well-known **local privilege-escalation** vector via **impersonation** and rogue/pipe-name squatting [^31][^32][^17] **[advertised-elsewhere]**. The risk direction matters: a privileged *server* impersonating an untrusted *client*, or an untrusted process squatting the pipe name before your server creates it.
- Loopback TCP is reachable by **any local process**, so identity must come from a token, and tokens can leak; a tight pipe DACL lets the **OS** enforce identity.

**A security position must answer, at minimum:**

1. **Principals:** exactly which identities may connect — same interactive user, other users on the box, administrators, SYSTEM, RDP/other sessions? Cross-session isolation?
2. **Authentication:** pipe DACL vs bearer token vs both; token storage/rotation; how a client proves identity.
3. **Authorization:** which commands each principal may issue; can any client `stop`, inject intents, or read transcripts?
4. **Audit:** is every connection and command logged with the principal SID, timestamp, and outcome?
5. **Replay/idempotency:** can a captured control command be replayed? (Your `--request-id` model already helps [^1].)
6. **DoS:** pipe-name squatting, instance exhaustion, slow-loris on the reader.
7. **Blast radius:** if the channel is compromised, what is the worst case? (Given the operator can already run the CLI, the *incremental* risk is remote/automated access and a broader principal set — state that explicitly.)
8. **Integrity level / UAC:** does the channel cross an integrity boundary?
9. **Upgrade/interop:** does the control channel need to survive broker restart (it should not hold state the store owns)?

---

## 9. Multi-rig / cross-host (Q13)

- **Tailscale SSH** manages authentication/authorization of SSH within a tailnet [^33], and Tailscale's MCP model proxies to a remote MCP server by pointing the proxy at the remote Tailscale address and port, with **identity-based access control** [^34][^35]; Tailscale identity is offered as an alternative to OAuth for internal MCP [^36] **[advertised-elsewhere]**.
- **MCP-over-SSH** is real prior art: an MCP server over stdio tunneled through SSH, exposing remote agent messaging tools [^37] **[advertised-elsewhere]**.
- **OpenRig's "watchdog wake"** is *not* a cross-host process supervisor — it is a per-rig timer job persisted in the DB [^14][^7]; read it for the **scheduling/durability** pattern, not for cross-host addressing. **[observed]**
- **Practical stance for you:** the honest answer for two rigs is **two stores, two brokers** (one per host), with cross-host reach expressed as a *client* to each broker, never as a second writer. Address each host by a tailnet name and authenticate via Tailscale identity or SSH; do not expose a raw loopback port across machines.

---

## 10. Testing the supervisor (Q15)

Your per-guarantee demo suite is the right harness — extend it. Concrete techniques:

| Technique | What it proves |
| --- | --- |
| **Crash injection** — `taskkill /F` the broker at random points | SCM restarts; no double-drive; log shows abnormal `START` |
| **Hang injection** — a `DURIG_FAULT=wedge` env that stalls the pass loop | Worker-thread watchdog fires; exit code = WEDGE; supervisor restarts |
| **Restart-storm injection** — deterministic startup crash | backoff engages; give-up writes `.stop`; `status` alerts |
| **Single-instance race** — launch two brokers simultaneously | exactly one wins (extend your existing race test [^1]) |
| **Resume-after-crash** — kill mid-pass with a live run | `resume()` re-schedules; nothing stranded [^5] |
| **Fake clock / clock-skew** — inject a monotonic clock | backoff and heartbeat survive a simulated sleep; no spurious kill [^3] |
| **Property: START/EXIT invariant** — assert after every test | every `START` has a matching `EXIT` unless abnormal |
| **Chaos/fault-injection vocabulary** — resource/network/process-level faults [^38][^18]; Jepsen-style clock skew and partitions [^39] **[advertised-elsewhere]** |

Because the suite runs against a **faux provider** [^1], you can drive all of the above **offline and deterministically** — which is the whole reason this is testable at all.

---

## 11. SLIs and the health surface (Q14)

| Class | Definition | Signal |
| --- | --- | --- |
| **Startup** | harness opened, extensions installed, lease acquired | one `READY` frame / log line with version + store path |
| **Readiness** | store writable **and** sole owner | heartbeat file carries `{state, owner_pid, store_path}` |
| **Liveness** | event loop turning | heartbeat age < 60 s |
| **Progress** | pass advancing | `PASS <n>` counter advancing within stream-timeout + margin |

Shape: a **versioned ready/health frame** in the heartbeat file plus your existing `status` command. The Pi-ecosystem convention is exactly this — `pi-agent-daemon` emits a ready frame carrying daemon/upstream/protocol versions, and OpenRig exposes `/healthz` [^7]. You have no socket, so a **versioned heartbeat file** is the correct analogue: `{schema, daemon_version, upstream_pin, state, pass, owner_pid, ts_monotonic, ts_wall}`.

---

## 12. Could not verify (explicit)

1. **`src/broker.mjs`, `src/genlock.mjs`, `src/supervisor.mjs`, ROADMAP 52/54/55** — not readable from the page I fetched; paste them and I'll tighten this. **[could not verify]**
2. **Whether SCM restarts a service stopped via an SCM stop request** — I inferred this from the `onfailure`-on-nonzero-exit model [^4] rather than reading the SCM page directly. **[inferred]**
3. **WinSW's current maintenance status** — a third-party post says no release since 2023 [^20] **[advertised-elsewhere]**; check the repo's releases yourself.
4. **`node-windows` internals** — the three-layer winsw description comes from a wiki, not the vendor [^12] **[advertised-elsewhere]**.
5. **VS Code Server Windows supervision specifics** — not verified. **[could not verify]**
6. **Whether `resume()` literally marks running tasks "pending"** — the source I read says only that `resume()` starts the scheduler and that unfinished work is represented by task checkpoints [^5]; your own doc says `TaskScheduler.open()` marks surviving running tasks back to pending. The two are compatible but not identical. **[observed divergence]**
7. **Whether a Worker thread's `process.exit()` reliably terminates the parent process on your Node version** — verify empirically before relying on it for wedge self-kill. **[inferred]**
8. **OpenRig's actual process supervision / single-instance / restart policy** — its architecture doc explicitly does not cover these [^7]. **[could not verify]**

---

### Bottom line

- **Option A = WinSW Windows Service** (Session 0, boot start, `onfailure` backoff, `stoptimeout` drain, dedicated service account) hosting a **thin supervisor child** that owns single-instance, heartbeat-watching, kill-on-wedge, the `.stop` marker, and give-up; the broker adds a **Worker-thread liveness watchdog** so a wedged broker exits non-zero and gets restarted.
- **Stop contract:** intended stop exits **0** and writes `<db>.stop` (reboot-durable); crash/wedge exit **non-zero**; give-up exits 0 and alerts. This is systemd's `RestartPreventExitStatus` + Docker's "manual stop suppresses" + OTP's `transient`, expressed with Windows exit codes.
- **Liveness:** two heartbeats — a 20 s/60 s liveness ping (event-loop health) and a pass-progress counter with a stream-timeout-derived threshold — checked outside the blocked thread, all on a **monotonic** clock.
- **Do not** let the supervisor open the store; **do not** run two writers; **do** trust `resume()` on crash but drain on intended stop, and put idempotency for external side effects in the tools, not the supervisor.

Send me `broker.mjs`, `genlock.mjs`, `supervisor.mjs`, and ROADMAP 52/54/55 and I'll turn §1–§7 into exact diffs.

**References**

[^1]: [GitHub - chexxor/Pi-OpenDurig: An OpenRig-like multi-agent team manager built on Pi-Durable · GitHub](https://github.com/chexxor/Pi-OpenDurig) (18%)
[^2]: [systemd.service](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html) (15%)
[^3]: [Fixing Apps That Stop When Windows Sleeps | KomuraSoft LLC Blog](https://comcomponent.com/en/blog/windows-sleep-modern-standby-long-running-apps/) (14%)
[^4]: [winsw/docs/xml-config-file.md at v3 · winsw/winsw · GitHub](https://github.com/winsw/winsw/blob/v3/docs/xml-config-file.md) (11%)
[^5]: [Pi Harness v2 to Pi Durable: Crash Recovery | AgentsPulse](https://agentspulse.github.io/tutorials/pi-agent-harness-v2-crash-recovery/) (10%)
[^6]: [Configuration File — Supervisor 4.3.0 documentation](https://supervisord.org/configuration.html) (6%)
[^7]: [openrig/ARCHITECTURE.md at main · mvschwarz/openrig · GitHub](https://github.com/mvschwarz/openrig/blob/main/ARCHITECTURE.md) (5%)
[^8]: [Pod Lifecycle | Kubernetes](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/) (4%)
[^9]: [Supervisor Behaviour — Erlang System Documentation v29.1.2](https://www.erlang.org/doc/system/sup_princ.html) (3%)
[^10]: [scheduler tasks with security options “Run whether user is logged on or ...](https://learn.microsoft.com/en-us/answers/questions/5789906/scheduler-tasks-with-security-options-run-whether) (1%)
[^11]: [Servy vs. NSSM vs. WinSW](https://dev.to/aelassas/servy-vs-nssm-vs-winsw-2k46) (1%)
[^12]: [Service Management | coreybutler/node-windows | DeepWiki](https://deepwiki.com/coreybutler/node-windows/2-service-management) (1%)
[^13]: [SERVICE_FAILURE_ACTIONSA (winsvc.h) - Win32 apps](https://learn.microsoft.com/en-us/windows/win32/api/winsvc/ns-winsvc-service_failure_actionsa) (1%)
[^14]: [Workflows and watchdogs — OpenRig](https://openrig.dev/docs/workflows) (1%)
[^15]: [Difference in docker restart policy between on-failure and unless ...](https://stackoverflow.com/questions/61725195/difference-in-docker-restart-policy-between-on-failure-and-unless-stopped) (1%)
[^16]: [Using systemd services of Type=notify with Watchdog in C](https://blog.hackeriet.no/systemd-service-type-notify-and-watchdog-c/) (1%)
[^17]: [Named Pipe Security: Securing Windows IPC From Attacks](https://asumetech.com/2026/08/24/named-pipe-security-securing-windows-ipc-from-attacks/) (1%)
[^18]: [Fault Injection Testing Explained: Build Resilience (2026)](https://totalshiftleft.ai/blog/fault-injection-testing-explained) (1%)
[^19]: [Scheduled wake from DRIPs (Modern Standby)](https://www.tenforums.com/performance-maintenance/132472-scheduled-wake-drips-modern-standby.html) (0%)
[^20]: [WinSW / NSSM / Shawl : creating a service with a dumb ...](https://www.reddit.com/r/sysadmin/comments/1k0g6wx/winsw_nssm_shawl_creating_a_service_with_a_dumb/) (0%)
[^21]: [node-windows](https://www.npmjs.com/package/node-windows) (0%)
[^22]: [nick92/pm2-windows-service](https://www.npmjs.com/package/@nick92/pm2-windows-service?activeTab=readme) (0%)
[^23]: [TIL: Running Node.js Apps as a Windows Service](https://adamtuttle.codes/blog/2019/node-apps-as-windows-services/) (0%)
[^24]: [How to set a container restart policy in Docker](https://www.simplified.guide/docker/container-set-restart-policy) (0%)
[^25]: [systemd for Administrators, Part XV](http://0pointer.de/blog/projects/watchdog.html) (0%)
[^26]: [Write-Ahead Logging](https://www.sqlite.org/wal.html) (0%)
[^27]: [SQLITE_BUSY with concurrent transactions is expected ...](https://github.com/WiseLibs/better-sqlite3/discussions/1198) (0%)
[^28]: [Activity Recovery: Worker behaviour in case of crash](https://community.temporal.io/t/activity-recovery-worker-behaviour-in-case-of-crash/8301) (0%)
[^29]: [Temporal Graceful Worker Shutdown - Keith Tenzer's Blog](https://keithtenzer.com/temporal/Temporal-Graceful-Worker-Shutdown/) (0%)
[^30]: [Temporal Workflow resumability - Community Support](https://community.temporal.io/t/temporal-workflow-resumability/2838) (0%)
[^31]: [Understanding and Exploiting Named Pipes](https://cybersecuritywriteups.com/understanding-and-exploiting-named-pipes-370f5ab652d9) (0%)
[^32]: [Privilege Escalation via Named Pipe Impersonation](https://www.elastic.co/docs/reference/security/prebuilt-rules/rules/windows/privilege_escalation_named_pipe_impersonation) (0%)
[^33]: [Tailscale SSH](https://tailscale.com/docs/features/tailscale-ssh) (0%)
[^34]: [An easy, realistic model for MCP connectivity](https://tailscale.com/blog/model-for-mcp-connectivity-lee-briggs) (0%)
[^35]: [MCP server proxying · Tailscale Docs](https://tailscale.com/docs/aperture/mcp-server) (0%)
[^36]: [Easy, Secure Dynamic Client Registration for MCP & AI ...](https://tailscale.com/blog/dynamic-client-registration-dcr-for-mcp-ai) (0%)
[^37]: [GitHub - asaddodhy/hermes-agentic-setup: Multi-machine Hermes Agent ...](https://github.com/asaddodhy/hermes-agentic-setup) (0%)
[^38]: [Advancing resilience through chaos engineering and fault ...](https://azure.microsoft.com/en-us/blog/advancing-resilience-through-chaos-engineering-and-fault-injection/) (0%)
[^39]: [Distributed Systems Testing Strategies — Chaos, Fault Injection, and ...](https://codelit.io/blog/distributed-systems-testing-strategies) (0%)


-----------------

## durig review of this report (delegate, 2026-10-16)

The delegate re-verified the Option A answer against durig's code, which the report could not read. The
spine is adopted — OS service → thin supervisor → broker, with a heartbeat and a stop/exit contract —
and is recorded as the design of record in **`docs/BROKER-SUPERVISION.md`** with roadmap items **61–67**
and decision **D71**. Corrections and confirmations, per the report's own claims:

**Corrections (verified in code / empirically):**

| Report claim | Finding |
| --- | --- |
| Worker-thread `process.exit()` self-kills a wedged broker | **Wrong.** A Worker's `process.exit()` stops the Worker, not the process (verified by running it); a blocked main thread also cannot receive the Worker's messages. Use the supervisor's `TerminateProcess` (−Job Object) or `process.abort()`. |
| Add a durable `<db>.stop` marker | **Collides.** `<db>.broker.stop` already exists (F35, ephemeral, cleared by the broker). The durable operator intent needs a distinct name — `<db>.broker.stopped`. |
| Service entry `node src/supervisor.mjs` | **Collides.** `src/supervisor.mjs` is already the escalation pass (ROADMAP 42/P3). New name: `src/brokerd.mjs`. |
| `stoptimeout` 90 s | **Strands runs.** A single model call can run to `DURIG_STREAM_TIMEOUT_MS` (verified, default 600000 ms); a 90 s stop force-kills mid-run (F11). Stop window must be ≥ the drain window, or mean "stop scheduling, then drain". |
| "Intended stop exits 0; the SCM skips restart" | Correct, and durig must set it via `process.exitCode` after `out(...)`, never `process.exit()` — the rule `check` already follows (a piped JSON payload must drain). `cmdServe` sets no exit code today. |
| Monotonic clock for timeouts/leases | **Live hazard.** `src/genlock.mjs` ages a lease on the wall clock (`Date.now()`, 60 s `STALE_MS`); a sleep can make a live holder look stale and be stolen (double-drive). |
| (not mentioned) PID reuse | `brokerAlive()` trusts `process.kill(pid, 0)`; a reused Windows pid reads as alive. Needs a creation-time / lock-handle identity check. |
| (not mentioned) Job Object | durig already has `src/job-object.mjs` (`KILL_ON_JOB_CLOSE`); the broker tree should use it rather than a new mechanism. |

**Confirmed implementable (its recommendations that check out):** `DURIG_STREAM_TIMEOUT_MS` exists
(`src/config.mjs`); `generation_in_flight`/`generation_stale` exist (`src/genlock.mjs`); the faux
provider exists (`DURIG_PROVIDER=faux`, `fauxProvider` in `cli.mjs`); `demo/race.test.mjs` exists; and
`check` already uses `process.exitCode` — so the proposed units and chaos tests are buildable offline.

**The seam inventory** (`broker.json`, `.broker.stop`, `.broker.stopped`, `.broker.inbox/`, `genlock.*`,
worktrees, `pi.*.sqlite`, `.broker.log`, `.broker.heartbeat`) lives in `docs/BROKER-SUPERVISION.md` §7,
corrected against the real filenames.

**Round-3 questions for the research agent** (also in the review thread): (1) here are the four files —
turn §1–§7 into diffs; (2) does WinSW kill the service's child *tree* (Job Object), or must we?; (3) does
the SCM truly skip `onfailure` on a clean exit 0 and on an operator stop? (it flagged this as inferred);
(4) WinSW vs Servy vs `node-windows` maintenance status; (5) the service-account recipe for git
credentials and per-worktree `npm ci`; (6) stop semantics vs a 600 s turn; (7) canonical Windows
identity check against PID reuse; (8) `performance.now()` across Modern Standby; (9) is a Windows
Service warranted for a personal rig, or a logon Task?; (10) the uninstall/downgrade path back to an
interactive `cli.mjs serve`.


-----------------


 Follow-up questions for the research agent (round 3)

 Ask these; the first is the one it requested:

 1. Here are broker.mjs, genlock.mjs, supervisor.mjs, ROADMAP 52/54/55 — turn §1–§7 into exact diffs, and answer the seven corrections above.
 2. Does WinSW terminate the service's child tree on stop (does it use a Job Object), or must we? We already have a KILL_ON_JOB_CLOSE job; I want to avoid building it twice.
 3. Does the SCM actually skip onfailure for a clean exit 0 and for an operator service-stop? (you flagged this as inferred).
 4. WinSW maintenance status (you flagged a "no release since 2023" third-party claim) — is WinSW, Servy, or node-windows the current best choice?
 5. Service account recipe: running under .\durigsvc with the user's %USERPROFILE%, git credentials, and per-worktree npm ci — what actually breaks, and how do you configure it so
    DURIG_SEAT_ROOT/worktrees/npm auth still work?
 6. Stop semantics vs long turns: given a single model call can take DURIG_STREAM_TIMEOUT_MS (600 s), what stoptimeout/two-phase stop do you recommend so a stop never strands a run?
 7. PID reuse on Windows: the canonical way to assert "this pid is still the process I recorded" (creation time? exclusive lock file?).
 8. Monotonic clock in Node under Modern Standby: performance.now() vs Date.now() for lease ages and heartbeat timeouts; what does Windows do to performance.now() across sleep?
 9. Is a Windows Service even warranted for a personal rig, or is a logon Task + user-profile process the better default, with the service reserved for an always-on host?
 10. Uninstall/downgrade path: how does an operator get back to running cli.mjs serve interactively without the service fighting them?

 Pitfalls still not on anyone's list

 - SQLite on a network/OneDrive/synced path — unsafe; the service store path must be a local disk (and the installer should refuse otherwise).
 - Boot ordering — the service starts before network/credentials; the first pass will fail provider calls. Use delayed auto-start + let backoff handle it, but say so explicitly.
 - Multiple stores — two services, or one service parameterized per DB; and the install must not assume rig.sqlite.
 - Upgrade under load — how the service picks up a new pinned pi / new code (WinSW runs a fixed exe path): a drain + restart, plus a version handshake (the agent's ready frame).
 - Human visibility — how the operator sees "daemon up/down/degraded" beyond the CLI; the heartbeat file + status needs a defined "is the service alive" line.
 - AV/Defender interaction with service start, worktrees, and npm ci.
 - Session 0 vs the TUI — the daemon has no console; the TUI must be a client (this is a feature: it forces item 52's shape).

Can you access those four files on our open-source GitHub repo?


-----------------


I'll check what's in the attachment first, then verify against the repo.The attachment is the round-2 context doc, not the four files. Let me try to pull them from GitHub directly.Yes — I can read all four files directly from the repo. I fetched them successfully: `src/broker.mjs` (491 lines), `src/genlock.mjs` (222 lines), `src/supervisor.mjs` (181 lines), and `docs/ROADMAP.md` items 52/54/55 [^1] [^2] [^3] [^6]. Now let me research your ten follow-ups.Good material. Let me pull the specifics on WinSW's process-tree handling, the SCM flag semantics, service accounts, and the clock/PID questions.Let me nail down the clock question and the Servy/Task Scheduler specifics.One last pass on the clock semantics and the Servy option.# Yes — I can read all four files

I pulled them straight from `github.com/chexxor/Pi-OpenDurig`:

| File | Lines read |
| --- | --- |
| `src/broker.mjs` | 491 [^1] |
| `src/genlock.mjs` | 222 [^2] |
| `src/supervisor.mjs` | 181 [^3] |
| `docs/ROADMAP.md` items 52/54/55 | present [^6] [^6] [^6] |

That changes several things. `cmdServe`/`cmdUp` are **not** in `broker.mjs` — that file exports `drivePass`, `runWakeLoop`, broker state/logging, stop-request and inbox helpers, but not the CLI commands [^1]. So the detached-spawn code is in `cli.mjs`, which I could **not** read. Diffs that touch `cli.mjs` below are specified **by interface**, not by literal patch. Everything touching `broker.mjs`/`genlock.mjs`/`supervisor.mjs` is exact.

---

## Corrections to my round-2 report (from the real source)

1. **`src/supervisor.mjs` is not a process supervisor at all.** It is the application-level *escalation pass* (ROADMAP 42): `failureStreak`, `planEscalations`, `applyEscalations`, `planResets`, `applyResets` [^3]. It observes seats and parks items on the human via the existing `deferred` representation. My round-2 report treated "supervisor" as the process-supervision layer. **They are different layers and now share a name.** The OS-level supervisor is a *new* file; do not put it in `supervisor.mjs`.
2. **The stop file is `<db>.broker.stop`, not `<db>.stop`.** `stopRequestPath(dbPath)` returns `` `${dbPath}.broker.stop` `` [^1]. My round-2 proposal for a `<db>.stop` marker was based on the context doc, not the code.
3. **`brokerAlive` already handles `EPERM` correctly** — it returns true when the signal is refused for permission [^1]. But **`genlock.mjs`'s `holderAlive` does not**: it `catch`es everything and returns `false`, so a slot held by a process we cannot signal (different integrity level) reads as *dead* and gets stolen [^2]. Inconsistency; fix one to match the other.
4. **`genlock.mjs` computes lease age from wall clock**: `age = Date.now() - Date.parse(holder.since)` [^2]. This is the Modern-Standby hazard, and it is *already in the code*, not hypothetical.
5. **ROADMAP 54 appears already implemented.** `drivePass` scopes the settle-wait to the conversations the pass woke, races it against the caller's `settleSignal`, and `runWakeLoop` keeps the single global `waitForIdle` on loop exit [^1]. That is exactly what item 54 asks for [^6]. Confirm against git history; if it is done, item 54 is not a dependency of your supervisor.
6. **The broker already emits a rich audit log** — `START pid=…`, `WAKE <seat>`, `PASS <n> ms=… woke=…`, `INTENT delivered=… dead=…`, `EXIT pid=… reason=…` [^1]. So the *progress* SLI exists; what's missing is a *liveness* (event-loop) signal and the "is the service alive" line.
7. **ROADMAP 52's first step is explicitly socket-free and in-process** — `viewState().subscribe()` with no new trust boundary, remote `watchEvents()` only after 55 [^6]. This collides with service mode (see pitfall 7).

---

## §1–§7 as exact diffs

### §1 — Option A: the host process

**New file `src/host.mjs`** (name it distinctly from `supervisor.mjs`). Runs under WinSW/Servy/Task; spawns the broker; owns single-instance, wedge-kill, backoff, give-up; **never opens the store**.

```js
// src/host.mjs — OS-level process supervisor for the resident broker.
// Distinct from src/supervisor.mjs (application escalation, ROADMAP 42).
// Opens NO store; touches only: <db>.broker.json, <db>.broker.heartbeat,
// <db>.broker.stop, <db>.broker.down, and the child process.

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync, existsSync, statSync } from "node:fs";
import { readBrokerState, brokerAlive } from "./broker.mjs";

export const hostDownPath      = (db) => `${db}.broker.down`;
export const brokerHeartbeatPath = (db) => `${db}.broker.heartbeat`;

const HEARTBEAT_INTERVAL_MS = 20_000;
const HEARTBEAT_TIMEOUT_MS  = 60_000;
const DRAIN_MS              = 720_000;   // > DURIG_STREAM_TIMEOUT_MS (600 s)
const BACKOFF_MS            = [5_000, 30_000, 120_000];
const GIVE_UP_AFTER         = 5;         // abnormal starts within RESET_MS
const RESET_MS              = 3_600_000;

export function readDown(db)  { return existsSync(hostDownPath(db)); }
export function writeDown(db) { writeFileSync(hostDownPath(db), String(Date.now())); }
export function clearDown(db) { try { unlinkSync(hostDownPath(db)); } catch {} }

/** Broker exit code -> host action. This is the restart contract in code. */
export function decide(exitCode, downMarker) {
  if (downMarker)          return "stay-down";   // operator asked for down
  if (exitCode === 0)      return "stay-down";   // clean, bounded, or give-up
  if (exitCode === 2)      return "restart";     // WEDGE
  return "restart";                              // crash (1) / any other
}

export function heartbeatAgeMs(db) {
  const p = brokerHeartbeatPath(db);
  try { return Date.now() - statSync(p).mtimeMs; } catch { return Infinity; }
}
```

The host's loop, in outline:

```js
async function run(db, { argv, env }) {
  if (readDown(db)) return 0;                       // operator wants it down
  const state = readBrokerState(db);
  if (state && brokerAlive(state)) return 0;        // single-instance: fail closed

  let abnormal = 0, backoffIdx = 0;
  for (;;) {
    const child = spawn(process.execPath, ["cli.mjs", "serve", "--db", db, ...argv],
      { cwd: env.DURIG_CWD, env, stdio: ["ignore", "inherit", "inherit"],
        windowsHide: true, jobObject: /* your existing KILL_ON_JOB_CLOSE job */ });

    const killTimer = setInterval(() => {
      const age = heartbeatAgeMs(db);
      if (age > HEARTBEAT_TIMEOUT_MS) {
        // A gap FAR larger than the check interval is a resume, not a wedge.
        if (age > 5 * HEARTBEAT_INTERVAL_MS) { log(`RESUME gap=${age}ms`); return; }
        log(`WEDGE heartbeat age=${age}ms -> terminating pid=${child.pid}`);
        child.kill("SIGKILL");                       // TerminateProcess on Windows
      }
    }, HEARTBEAT_INTERVAL_MS);

    const code = await new Promise((r) => child.on("exit", (c, s) => r(c ?? (s ? 1 : 0))));
    clearInterval(killTimer);
    if (code !== 0) abnormal++;
    const action = decide(code, readDown(db));
    if (action === "stay-down") return 0;
    if (abnormal >= GIVE_UP_AFTER) { writeDown(db); log(`GIVE_UP after ${abnormal} abnormal starts`); return 0; }
    await sleep(BACKOFF_MS[Math.min(backoffIdx++, BACKOFF_MS.length - 1)]);
  }
}
```

### §2 — host config

WinSW XML (corrected `stoptimeout` — my round-2 "90 sec" was **wrong**, see Q6):

```xml
<service>
  <id>durig-broker</id>
  <executable>C:\Program Files\nodejs\node.exe</executable>
  <arguments>"C:\durig\src\host.mjs" --db "C:\durig\rig.sqlite"</arguments>
  <workingdirectory>C:\durig</workingdirectory>
  <stoptimeout>900sec</stoptimeout>
  <onfailure action="restart" delay="30 sec"/>
  <onfailure action="none"/>
  <resetfailure>1 hour</resetfailure>
  <delayedAutoStart>true</delayedAutoStart>
</service>
```

`onfailure` here is a **backstop for `host.mjs` itself dying** — it is *not* the child-restart mechanism (see Q3).

### §3 — restart / stop contract, exact

Add to `broker.mjs`, next to the existing stop-request helpers [^1]:

```js
export function exitCodeForStopReason(reason) {
  switch (reason) {
    case "stop": case "signal": case "max-duration": case "max-passes": return 0;
    default: return 1;                      // crash / unknown
  }
}
```

In `cli.mjs` (unread — specify by interface):
- `cmdServe`: after `runWakeLoop` returns, `process.exitCode = exitCodeForStopReason(result.stoppedBy)`.
- `cmdStop`: `writeStopRequest(db)` **and** `writeDown(db)`.
- `cmdStart`/`up`: `clearDown(db)`.

Intent marker lives in the **file**, not the store — because the host must not open the store, and `.broker.down` survives reboot. Exit codes:

| Cause | `stoppedBy` | Exit | `.broker.down` | Host action |
| --- | --- | --- | --- | --- |
| `serve --stop` | `stop` | 0 | written | stay down |
| SIGINT/SIGTERM | `signal` | 0 | — | stay down |
| bounded run | `max-duration`/`max-passes` | 0 | — | stay down |
| crash / throw | (no EXIT) | 1 | — | restart |
| wedge | — | 2 | — | restart |
| give-up | — | 0 | written | stay down + alert |

### §4 — liveness signal, exact

Add to `broker.mjs`:

```js
export function writeHeartbeat(dbPath, { state, pass, version, upstreamPin }) {
  if (!dbPath) return;
  writeFileSync(`${dbPath}.broker.heartbeat`, JSON.stringify({
    schema: 1, pid: process.pid, state, pass,
    version, upstreamPin,
    ts_wall: Date.now(), ts_mono: performance.now(),
  }));
}
```

In `runWakeLoop`, add a **main-thread** `setInterval(…, 20_000)` that calls `writeHeartbeat(db, {state:"live", pass: passes, …})` and clears it in the `finally`. Also stamp the version into the existing START line:

```diff
- logBrokerLine(dbPath, `START pid=${process.pid}`);
+ logBrokerLine(dbPath, `START pid=${process.pid} v=${VERSION} pass0`);
```

Two signals, two timeouts:

| Signal | Writer | Interval | Timeout | Catches |
| --- | --- | --- | --- | --- |
| **Liveness** | `setInterval` (event loop) | 20 s | 60 s | event-loop block / full hang |
| **Progress** | existing `PASS <n> ms=… woke=…` [^1] | per pass | `DURIG_STREAM_TIMEOUT_MS` + margin | stuck await / deadlock |

A 600 s model call does **not** block the event loop, so the heartbeat stays fresh — correct: a long call is not a wedge. A blocked loop stops the `setInterval` — correct: that *is* a wedge.

### §5 — stateful single-writer: unchanged

The host opens no store; the health surface is file/pid/heartbeat only. One writer, many readers (your `watch`/`status`). Nothing to diff here beyond keeping the host store-free.

### §6 — pre-mortem: two concrete new diffs

**genlock monotonic fix** (`genlock.mjs`):

```diff
- const age = holder?.since ? Date.now() - Date.parse(holder.since) : Infinity;
- if (!holderAlive(holder) || age > STALE_MS) {
+ const age = holder?.since ? Date.now() - Date.parse(holder.since) : Infinity;
+ const resumeGap = age > 5 * STALE_MS;          // a jump this large is a resume
+ if (!holderAlive(holder) || (age > STALE_MS && !resumeGap)) {
```

and make `holderAlive` match `brokerAlive`'s EPERM handling:

```diff
- } catch {
-   return false;
- }
+ } catch (err) {
+   return err?.code === "EPERM";   // exists but unsignalable == alive
+ }
```

**single-instance race**: the host must confirm the old pid is dead **and** `.broker.json` is stale before spawning (the code above does). The new broker then re-acquires the lease in `cmdServe` before opening the store.

### §7 — seam inventory (corrected names)

| Artifact | On crash | On restart | On clean shutdown |
| --- | --- | --- | --- |
| `<db>.broker.json` `{pid,since}` [^1] | stale pid → stolen | re-acquired before store open | `clearBrokerState(db, pid)` (pid-guarded) |
| `<db>.broker.down` *(new)* | absent → restart | read at start; if present → host exits 0 | **written** by `serve --stop`; cleared by `serve --start` |
| `<db>.broker.stop` [^1] | transient; cleared by broker | — | consumed + `clearStopRequest` |
| `<db>.broker.inbox` [^1] | files remain → re-drained, idempotent via `requestId` | drained at pass start before `inspect` | left for next start |
| `<db>.broker.inbox.error` [^1] | dead-lettered intents | surfaced | unchanged |
| `<db>.genlock.<i>` [^2] | dead pid → steal | reconciled | released iff `holder.pid === process.pid` |
| `<db>.broker.log` [^1] | `START` w/o `EXIT` = abnormal | new `START` | `EXIT reason=stop` |
| `<db>.broker.heartbeat` *(new)* | stale | rewritten each tick | removed/marked stopped |

---

## The ten follow-ups

**2 — Does WinSW kill the child tree, and does it use a Job Object?** No Job Object. WinSW discovers children by enumerating processes, checking start time, and reading the parent PID via `NtQueryInformationProcess`, then recursively terminates descendants [^8] [^8]. Its stop sequence is: check already-exited → send Ctrl+C → close main window → wait for a timeout → force-kill [^8]. Orphaned children are a known issue [^13]. **So: keep your `KILL_ON_JOB_CLOSE` job as the authority** — assign the broker to it in `host.mjs`. Don't rebuild it. Note WinSW's Ctrl+C step is useless for a console-less service child, so its "graceful" path will fall through to force-kill; that is another reason the *real* graceful stop must be your `.broker.stop` + drain, not the SCM stop.

**3 — Does the SCM skip `onfailure` on clean exit 0 and on operator stop?** **Confirmed, and now documented, not inferred.** A service is considered failed only when it terminates *without* reporting `SERVICE_STOPPED` [^9]. The failure-actions flag (default off) means failure actions run "only if the service terminates without reporting a status of `SERVICE_STOPPED`" [^14] [^10]. An operator service-stop *is* a `SERVICE_STOPPED`, so it never triggers recovery. There is a separate "honor exit code" flag if you want non-zero exits to count as failures [^15] — **don't enable it**; keep the distinction in `host.mjs`. Consequence: **SCM failure actions are a backstop for the wrapper crashing, not for the broker exiting.**

**4 — WinSW vs Servy vs node-windows.** WinSW's last stable is **v2.12.0, Jan 28 2023**; 3.x lives on the `v3` branch as pre-releases [^16] [^17]. Community consensus: NSSM unmaintained since 2017, WinSW in "maintenance limbo," no release since 2023 but still working [^18] [^11]. Servy is actively maintained and adds graceful tree kill, Ctrl+C, force-kill, recursive zombie cleanup, built-in health monitoring (heartbeat every 30 s, consecutive-failure threshold), and heartbeat-URL alerting [^7] [^7] [^19] [^20]. ⚠️ That comparison is **vendor-authored** [^7], and Servy has its own stop-timeout bug (double-waiting on the grace period) [^21]. **Recommendation:** you want a *thin* host, so pick the one you'll treat as a dumb service host and **disable its health checks** (they'd duplicate your heartbeat). Servy is the safer long-term bet on maintenance; WinSW is the most "dumb" and most battle-tested in CI. Either is fine — the decision that matters is that restart/health logic stays in `host.mjs`.

**5 — Service account recipe.** Create a non-admin local user, grant "Log on as a service" [^22] [^23] [^24]. **Use a real user account, not LocalService/NetworkService** — the latter has no network identity and a different profile, which silently changes git/npm paths. What actually breaks, and the fix:

| Breaks | Why | Fix |
| --- | --- | --- |
| `%USERPROFILE%` / `%APPDATA%` wrong | service accounts don't get the interactive profile loaded **[inferred]** | set `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA` explicitly in the host env |
| `git` "dubious ownership" | repo owned by a different SID than the service account | `git config --global --add safe.directory <repo>` **in the service account's config** |
| git credential lookup fails | GCM store is per-user / per-session | `GIT_CONFIG_GLOBAL=C:\durig\etc\gitconfig`, `credential.helper=store --file=C:\durig\etc\gitcred`, `GIT_TERMINAL_PROMPT=0` |
| `npm ci` unauthenticated | `.npmrc` in the wrong profile | `NPM_CONFIG_USERCONFIG=C:\durig\etc\npmrc` with the registry token |
| `core.longpaths` / worktree writes | long worktree paths, ACLs | `core.longpaths=true`; ACL the seat root to the service account |
| `DURIG_SEAT_ROOT` | the broker no longer sets it — the `prepare_workspace` tool owns the worktree [^1] | set it in env if the tool reads it; otherwise configure the tool |

**6 — Stop semantics vs long turns.** The broker's stop is **cooperative and settles the pass first**: the `.stop` file is checked between passes and while idle (re-check capped at ~1 s), and the loop then runs `await harness.waitForIdle(context)` before `EXIT` [^1]. So a stop mid-pass waits for the in-flight run — up to `DURIG_STREAM_TIMEOUT_MS` (600 s). Therefore:

- **`stoptimeout` must be > 600 s + margin.** Use **900 s**. My round-2 "90 sec" was wrong and would have force-killed a live run → a stranded run.
- **Two-phase stop:** Phase 1 = operator runs `durig serve --stop` → writes `.broker.stop` **and** `.broker.down` → broker drains → exits 0 → host sees `.down` → stays down. Phase 2 = only if the broker ignores it, `host.mjs` force-kills after `DRAIN_MS`. **Never let the SCM's timeout be what kills a live run.**
- Keep the SCM stop for uninstall/maintenance only.

**7 — PID reuse.** PIDs are aggressively reused on Windows [^25]; the canonical identity check is **process creation time** via `GetProcessTimes` → `FILETIME`, compared with `CompareFileTime` [^12] [^26] [^27]. Node cannot call `GetProcessTimes` directly. Practical, no-native-code answer: **use `pid` + heartbeat freshness as the identity proxy.** A recycled PID will not be refreshing *your* heartbeat file. Store a per-run `runToken` in `.broker.json` and require both a live pid and a heartbeat newer than `HEARTBEAT_TIMEOUT_MS`. That defeats reuse without creation times. (An exclusive lock file is **weak on Windows** — Node's `fs.open` has no share-mode control, so an open fd doesn't block deletion. Don't rely on it.)

**8 — Monotonic clock under Modern Standby.** This is counterintuitive, so read carefully:

- `performance.now()` on Windows is based on `process.hrtime()` → **QPC** [^5]. QPC is **monotonic (never goes backward)** [^4] **and it *includes* time in sleep/standby/hibernate/connected standby** [^4].
- So `performance.now()` **does not exclude sleep** — it counts it. Switching `genlock` from `Date.now()` to `performance.now()` fixes the *clock-set* bug (NTP/DST/manual changes) but **does not fix** the *sleep-inflation* bug.
- `Date.now()` is a real-time clock and can jump both ways [^5].
- A suspend-*excluding* clock exists — `QueryUnbiasedInterruptTime`/`…Precise` [^4] — but **Node does not expose it**; the libuv monotonic-realtime clock (`uv_clock_gettime`) landed but is **still unused in Node** [^5]. The Node issue asking for suspend-adjusted `performance.now()` was **closed stale, unresolved** [^5].

**Recommendation:** use `performance.now()` for all in-process durations/timeouts (strictly better than `Date.now()` — immune to clock changes), but treat sleep as a **discrete event**, not as elapsed time. A gap much larger than the check interval *is* a resume:

```js
const gap = performance.now() - lastCheckMono;
if (gap > 5 * CHECK_INTERVAL_MS) { log(`RESUME gap=${gap}ms`); /* don't kill, don't steal */ }
```

This is clock-agnostic and needs no native code. Apply it in `host.mjs` (don't kill) and in `genlock.mjs` (don't steal). Note also: **`performance.now()`'s origin is per-process**, so it is *not* directly cross-process comparable — for cross-process ages use `os.uptime()` (boot-relative, shared) or wall time, and lean on PID liveness as the primary signal.

**9 — Is a Windows Service warranted?** For a personal rig, often no. The decisive split is: **`host.mjs` is the supervisor either way; the service/task is only the boot trigger.** Recommendation:

- **Default = a logon-triggered Task Scheduler task running `host.mjs`.** You keep the user profile, git creds, npm auth, and GPU/desktop access; the TUI can still run in-session. Costs: dies on logout, needs logon after reboot, "run whether logged on or not" runs **non-interactive** and can break network/mapped-drive access [^28] [^29].
- **Service = opt-in for an always-on host.** Session 0 has no console/desktop; the TUI must be a remote client (see pitfall 7).
- Neither is better for Modern Standby — Session 0 services are throttled/suspended during Modern Standby, and user-session threads are suspended by the Desktop Activity Moderator. Both need the resume handling from Q8.

**10 — Uninstall / downgrade without the service fighting you.** Sequence:

1. `durig serve --stop` → writes `.broker.stop` + `.broker.down`; broker drains and exits 0; host sees `.down` and does **not** restart.
2. Stop the service (`winsw stop` / Servy stop) — now safe, because `.down` means nothing restarts.
3. Uninstall the service (`winsw uninstall` / Servy uninstall) **or** set it to Disabled for a downgrade.
4. Now `node cli.mjs serve` interactively works — the host refuses to spawn when `.broker.json` names a live pid, so there's no double-drive.
5. **Do not forget to `clearDown` on the next `serve --start`/`up`,** or the service will refuse to start later.

**Downgrade** = keep the service *disabled, not uninstalled*, and swap code + restart. Because the pinned upstream (`pi-durable`) and the code are on disk, the "downgrade" is a file swap plus a drain/restart.

---

## The seven pitfalls

1. **SQLite on a network/OneDrive/synced path.** The store must be local disk. The installer should **refuse** a UNC path (`\\`), a non-fixed drive, or a path under `%OneDrive%`/`%Dropbox%`. Check drive type (`fsutil fsinfo drivetype`) and the `OneDrive` env var at install time.
2. **Boot ordering.** The service starts before network/credentials; the first pass fails provider calls. Use **delayed auto-start** (`<delayedAutoStart>true</delayedAutoStart>`) and let backoff handle the rest — and **say so in the docs**, because a `WAKE`/provider error in the log at boot is expected, not a bug.
3. **Multiple stores.** Two services, or one service parameterized per DB. The install must **not** hard-code `rig.sqlite`: derive the service name and `--db` from an argument (`durig install --db <path>`).
4. **Upgrade under load.** WinSW/Servy run a fixed exe path, so a new pinned `pi-durable` or new code is only picked up on restart. Do a **drain + restart** and a **version handshake**: put `version` + `upstreamPin` in the heartbeat/ready frame and in the START line (diffs in §4). `status` should print the running version and refuse to claim health if it differs from the on-disk version.
5. **Human visibility.** Add one line to `status`: `daemon: up pid=<n> since=<iso> pass=<n> hb_age=<ms> v=<ver>`. "Is the service alive" = heartbeat age < 60 s. `degraded` = alive but last `PASS` older than stream-timeout + margin. `down` = `.broker.down` present or heartbeat absent.
6. **AV/Defender.** Defender scanning worktrees, `node_modules`, and the broker exe slows `npm ci` and can lock files mid-write. Add exclusions for the seat root, `node_modules`, the store dir, and the node/host executables. Also expect AV to delay service start — another reason for delayed auto-start.
7. **Session 0 vs the TUI.** A service-hosted broker has no console, so the TUI **cannot** be in-process. That *forces* ROADMAP 52's shape: the in-process `viewState().subscribe()` path [^6] only works in foreground `run`/`serve`; **service mode requires the remote `watchEvents()` path, which is gated on the 55 security position** [^6]. So: **going service-first commits you to writing `security.sec` before the TUI can attach.** If you want the TUI now, run the logon-Task mode (Q9) and keep the in-process subscriber.

---

## Could not verify

1. **`cli.mjs`** — where `cmdServe`/`cmdUp`/`cmdStop` and the detached spawn live. Diffs to it are specified by interface only.
2. **Whether ROADMAP 54 is already merged** — the current `broker.mjs` matches its acceptance description [^1] [^6], but I have no git history.
3. **WinSW `<delayedAutoStart>` element name** — inferred; confirm against the v3 docs.
4. **Whether `child.kill("SIGKILL")` / a Job Object reliably reaps the full broker subtree** on your Windows build — verify empirically.
5. **Servy's stop-timeout behavior** — a vendor issue reports a double-wait [^21]; test before trusting a 900 s drain.
6. **Whether a service user account's profile is loaded by default** — labeled **[inferred]**; the explicit-env recipe is safe either way.
7. **The exact SCM behavior for a WinSW-wrapped child that exits 0** — I confirmed the *flag semantics* [^14] [^10] but not WinSW's internal `SERVICE_STOPPED` reporting in every path. Test by killing the broker and watching whether the service restarts.

**Bottom line:** rename the OS-level supervisor (`host.mjs`) so it stops colliding with the escalation `supervisor.mjs`; make it store-free and let it own single-instance, wedge-kill, backoff, give-up, and `.broker.down`; fix the two real bugs the source revealed (genlock's wall-clock age and its EPERM handling); set `stoptimeout` to 900 s, not 90; and remember that **`performance.now()` counts sleep on Windows** — so detect resume as a gap event rather than trusting any clock.

**References**

[^1]: [src/broker.mjs](https://github.com/chexxor/Pi-OpenDurig/blob/main/src/broker.mjs) (15%)
[^2]: [src/genlock.mjs](https://github.com/chexxor/Pi-OpenDurig/blob/main/src/genlock.mjs) (15%)
[^3]: [src/supervisor.mjs](https://github.com/chexxor/Pi-OpenDurig/blob/main/src/supervisor.mjs) (15%)
[^4]: [Acquiring high-resolution time stamps - Win32 apps | Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/sysinfo/acquiring-high-resolution-time-stamps) (10%)
[^5]: [performance.now() should jump after sleep/suspend/hibernation](https://github.com/nodejs/node/issues/47724) (8%)
[^6]: [Pi-OpenDurig/docs/ROADMAP.md at main · chexxor/Pi-OpenDurig · GitHub](https://github.com/chexxor/Pi-OpenDurig/blob/main/docs/ROADMAP.md) (7%)
[^7]: [Comparison with Alternatives · aelassas/servy Wiki · GitHub](https://github.com/aelassas/servy/wiki/Comparison-with-Alternatives) (5%)
[^8]: [Process Management | winsw/winsw | DeepWiki](https://deepwiki.com/winsw/winsw/2.3-process-management) (4%)
[^9]: [SERVICE_FAILURE_ACTIONSA (winsvc.h) - Win32 apps](https://learn.microsoft.com/en-us/windows/win32/api/winsvc/ns-winsvc-service_failure_actionsa) (2%)
[^10]: [Set up Recovery Actions to Take Place When a Service Fails](https://serverfault.com/questions/72318/set-up-recovery-actions-to-take-place-when-a-service-fails) (2%)
[^11]: [Servy vs. NSSM vs. WinSW - DEV Community](https://dev.to/aelassas/servy-vs-nssm-vs-winsw-2k46) (2%)
[^12]: [GetProcessTimes function (processthreadsapi.h)](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes) (2%)
[^13]: [Error Stopping Service · Issue #1027 · winsw ...](https://github.com/winsw/winsw/issues/1027) (1%)
[^14]: [[MS-SCMR]: SERVICE_FAILURE_ACTIONS_FLAG | Microsoft Learn](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-scmr/9b244e2e-82fc-4c54-8f4f-b19034faa2c4) (1%)
[^15]: [Win32 Service Gotcha: Recovery Actions - Stephen Cleary](https://blog.stephencleary.com/2020/06/servicebase-gotcha-recovery-actions.html) (1%)
[^16]: [Releases · winsw/winsw](https://github.com/winsw/winsw/releases) (1%)
[^17]: [Home - Windows Service Wrapper - winsw.github.io](https://winsw.github.io/v3/) (1%)
[^18]: [WinSW / NSSM / Shawl : creating a service with a dumb ...](https://www.reddit.com/r/sysadmin/comments/1k0g6wx/winsw_nssm_shawl_creating_a_service_with_a_dumb/) (1%)
[^19]: [Health Monitoring & Recovery · aelassas/servy Wiki · GitHub](https://github.com/aelassas/servy/wiki/Health-Monitoring-&-Recovery) (1%)
[^20]: [aelassas/servy: Enterprise-Grade Windows Service Wrapper](https://github.com/aelassas/servy) (1%)
[^21]: [[Robustness] ProcessWrapper.cs — Stop(timeoutMs) uses the ... - GitHub](https://github.com/aelassas/servy/issues/1971) (1%)
[^22]: [Log on as a service - Windows 10 | Microsoft Learn](https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-10/security/threat-protection/security-policy-settings/log-on-as-a-service) (1%)
[^23]: [Run a Windows Service with a Non-Admin User Account](https://poweradm.com/logon-as-windows-service-non-admin-user/) (1%)
[^24]: [Granting ‘Logon as a service’ Rights via GPO or PowerShell](https://theitbros.com/configure-logon-as-a-service/) (1%)
[^25]: [Consider moving away from pid-based process tracking ...](https://issues.chromium.org/issues/371219670) (1%)
[^26]: [Win32API/libraries/kernel32/GetProcessTimes.md at master - GitHub](https://github.com/VFPX/Win32API/blob/master/libraries/kernel32/GetProcessTimes.md) (1%)
[^27]: [How can I reliably check whether one Windows process is the parent of ...](https://stackoverflow.com/questions/6593003/how-can-i-reliably-check-whether-one-windows-process-is-the-parent-of-another-in) (1%)
[^28]: [scheduler tasks with security options “Run whether user is logged on or ...](https://learn.microsoft.com/en-us/answers/questions/5789906/scheduler-tasks-with-security-options-run-whether) (1%)
[^29]: [Task scheduler - does not work with the option 'Run whether user is ...](https://learn.microsoft.com/en-us/answers/questions/2188387/task-scheduler-does-not-work-with-the-option-run-w) (1%)


-----------------

## durig review of this round-3 reply (delegate, 2026-10-16)

The agent read the four files this time (from the pushed repo) and the answer is substantially better.
Adopted into **`docs/BROKER-SUPERVISION.md`** (now v2), roadmap items **61–67**, and **D71**:
`src/host.mjs` replaces the earlier `brokerd.mjs`; `<db>.broker.down` replaces `.broker.stopped`; the
stop/drain window is **900 s**, not 90; the OS default is a **logon Task** with a service opt-in;
`performance.now()` **counts sleep** on Windows, so sleep is a resume-gap event, not a clock fix; PID
identity uses a **`runToken` + fresh heartbeat** because Node cannot call `GetProcessTimes` and an open
fd is not a Windows lock; and the SCM restart semantics are now documented, not inferred.

**Corrections (re-verified against the local tree):**

| Round-3 claim | Finding |
| --- | --- |
| “ROADMAP 54 appears already implemented” | **Wrong.** `drivePass` still `await`s the runs it woke (`await settleSignal.race(wokenIdle)`); the scoped wait is D65, not the wake-and-return item 54 asks for. Item 54 remains pending, and is still the sequencing predecessor for the heartbeat. |
| §4 diff stamps `VERSION` into the START line | **No such constant exists.** It is a new value to add, not an existing one. |
| genlock fix = add a `resumeGap` exemption | **Incomplete.** `src/genlock.mjs` steals a **live** holder at `age > STALE_MS` (60 s) though a slot is held for the whole response (up to 600 s), so the concurrency cap can be exceeded. A gap exemption only rescues >300 s, leaving the 60–300 s window broken; the fix is **lease renewal** (or `STALE_MS` > the stream timeout). Also `readGenerationSlots` uses pid-only staleness, disagreeing with the acquire path. |
| `DURIG_STREAM_TIMEOUT_MS` default 600000 ms | **Nuance.** durig sets no default (`src/config.mjs` only passes it through); 600000 ms is the underlying openai provider's request timeout. Phrase it as “provider stream timeout”. |

**Confirmed by the delegate:** `src/supervisor.mjs` is the escalation pass, not a process supervisor
(new file needed); the stop file is `<db>.broker.stop`; `genlock.holderAlive` swallows `EPERM` while
`brokerAlive` handles it; the genlock age is wall-clock; the broker audit log is already rich
(`START`/`WAKE`/`PASS`/`INTENT`/`EXIT`); item 52's first step is socket-free and in-process; the
`cli.mjs` commands are outside `broker.mjs`.

**Round-4 questions for the research agent:** (1) does `os.uptime()` count Modern-Standby sleep
(boot-relative), i.e. is it usable for cross-process lease ages, or must we fall back to wall + pid?
(2) a concrete **lease-renewal** design (refresh cadence + a safe stale threshold) for `src/genlock.mjs`;
(3) confirm the WinSW `<delayedAutoStart>` element name (it flagged this as inferred); (4) Servy's
stop-timeout double-wait — fixed or still open?; (5) empirically, does `TerminateProcess` / the
`KILL_ON_JOB_CLOSE` job reap the full broker subtree on our Windows build?; (6) confirm whether a
service account's profile is loaded by default (the explicit-env recipe is safe either way).

