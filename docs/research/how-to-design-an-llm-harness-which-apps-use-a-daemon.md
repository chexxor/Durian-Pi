I'll research both your repo and the open-source daemon-based harness landscape.Let me dig into the specific open-source daemon-based architectures.I have strong material. Let me pull the two most code-relevant architecture deep-dives.# Open-Source Daemon-Based LLM Harnesses: How They're Architected

Your repo already sits in a well-defined family. Durian-Pi is a **broker-over-a-durable-store** design: named seats, a cross-seat queue, a resident `serve` broker that owns the store and wakes seats, single-instance-per-database, and generation concurrency controlled by cross-process leases in `src/genlock.mjs` [^3] [^3]. That's one of three recurring daemon topologies in open source. Here's the landscape to benchmark against.

## The Three Daemon Topologies

| Topology | Who uses it | How the daemon works | State substrate |
|---|---|---|---|
| **Client/Server (server owns the loop)** | OpenCode, OpenHands | A long-lived HTTP/WS server is the runtime; every UI (TUI, web, IDE, mobile) is just a client. Daemon = the server process. | Session log on disk; SSE event bus |
| **Explicit OS daemon (managed process)** | Forge Agent | A background process registered under systemd/PM2, sitting between input bridges and the model. | SQLite conversation DB |
| **Tiered supervisor (server ⇄ daemon ⇄ runner ⇄ subprocess)** | Omnigent (Databricks) | Four-tier process topology where the daemon supervises per-conversation harness subprocesses. | Registry of harness adapters + per-conversation state |

Your Durian-Pi broker is closest to a **hybrid of #1 and #3**: a resident supervisor that owns the store and multiplexes work to seats, with a lease layer (`genlock.mjs`) instead of one subprocess per conversation.

---

## Reference Implementations (Read These)

### 1. OpenCode — client/server with a log-as-queue loop
The most directly copyable architecture. Backend runs on **Bun, exposed through a Hono HTTP server**; running `opencode` launches both the JS server *and* a separate Go TUI process [^2]. Key patterns:

- **The message log doubles as the work queue.** Pending sub-agent spawns and compactions are persisted *message parts* the loop dequeues one per iteration — which makes the loop trivially resumable across restarts, because the queue *is* the transcript [^1].
- **Streaming loop:** `streamText` returns a `fullStream` of events (`tool-call`, `tool-result`, `tool-error`, `text-delta`…), and a `process` function updates structured message parts and persists each to disk [^2].
- **Real-time fan-out:** every persisted part emits onto a shared event bus exposed over HTTP as SSE at `/sse` — so the TUI, a mobile app, and a script can all subscribe to the same run [^2].
- **Generated SDK:** the OpenAPI spec is fed to Stainless to auto-generate type-safe clients, so no component hand-rolls HTTP [^2].
- **Snapshotting at `step-start`:** uses Git temp commits to capture working state so a failed step can be restored [^2].
- **Stuck detection routed through permissions:** three byte-identical tool calls raise a `doom_loop` permission ask rather than an automated abort — the *user* decides [^1].

> **For Durian-Pi:** OpenCode's "queue is the transcript" is essentially your RigQueue + audit trail, but collapsed into one substrate. Your broker-owns-store split is cleaner for multi-seat; OpenCode's advantage is that resumability falls out for free.

### 2. OpenHands — event-sourced conversation engine
Since the mid-2026 restructuring, the loop lives in the **software-agent-sdk** repo as an event-sourced engine: a `LocalConversation` drives `Agent.step()`, and **every event is appended to a persistent `EventLog`** (one file per event via a `FileStore`, with `flock`-based locking and secret redaction via a `SecretRegistry`) [^1]. Notables:

- **Conversation state is a tree with a movable head** — replay, fork, and branch navigation are first-class [^1].
- **Action batching with resource locks:** each `step()` makes one LLM call but executes all tool calls as a batch, optionally parallel via a `ParallelToolExecutor` governed by a `tool_concurrency_limit` and a resource-lock manager keyed on each tool's declared resources (files, terminal, browser) — only same-resource calls serialize [^1].
- **Daemon topology:** the primary backend is the **OpenHands Agent Server**; a React frontend ("Agent Canvas") connects to one or more Agent Server instances and switches between them. Optional services include an ingress router and an **Automation Server for scheduled/event-triggered runs** [^5]. The frontend explicitly does *not* execute actions or host credentials [^5].
- The older runtime was a docker-sandboxed OS (bash, browser, IPython) driven over an **event stream architecture** [^6].

> **For Durian-Pi:** OpenHands' **resource-keyed lock manager** is the refinement your `genlock.mjs` lacks. Today you have `DURIAN_PI_MAX_CONCURRENT_SEATS` N cross-process leases [^3]; OpenHands would let two seats run concurrently *unless* they touch the same resource. That maps directly onto your per-seat worktree model.

### 3. Forge Agent — the textbook OS daemon
If you want the canonical "daemon" shape, this is it: a **persistent, always-on background process** that routes messages between platform bridges and LLMs, run under **PM2 or systemd** [^4] [^4].

```
[Telegram] ─WebSocket─┐
[Discord]  ─WebSocket─┤
[Slack]    ─WebSocket─► Gateway Daemon (ws://127.0.0.1:18789)
[CLI]      ─stdin─────┘        ↓
                        Agent Runtime → LLM → Execute skill + respond
```
Component split: `gateway/server.js` (WS gateway), `bridges/*` (cli, telegram, discord), `llm/router.js` + provider adapters, `memory/sqlite.js`, `skills/loader.js` (MCP), `config.js` [^4]. Memory is **SQLite-backed persistent context across sessions** at `./data/memory.db` [^4] [^4].

> **For Durian-Pi:** This is the "separate input bridge from runtime" pattern. Your `intent.mjs` spool + broker is the same idea (bridge writes, broker delivers), but you use a durable store instead of a socket — a stronger choice for crash-safety.

### 4. Pi / Pi-Durable — your upstream (session-tree substrate)
Worth reading as the layer *under* Durian-Pi. Pi's context management triggers at `contextWindow − 16,384` tokens, keeps 20K recent, and merges summaries iteratively rather than re-summarizing [^1]. Its distinctive substrate is an **append-only JSONL session tree** where every entry carries `id`/`parentId` and a movable leaf pointer defines the active branch — `/tree`, `/fork`, `/clone` unify checkpointing, rewind, and alternative exploration [^1]. Pi also gives each of its seven tools a pluggable `Operations` interface (`BashOperations`, `EditOperations`…) as the single remoting seam for SSH/container/micro-VM relocation [^1].

> **For Durian-Pi:** Your extension system installs the Router as a **pi-durable extension** whose modules declare `sections`, `tools`, `hooks`, `tasks`, and `wraps` — running in-process with harness access and the host process's OS permissions [^3]. That's the same pluggable-seam philosophy as Pi's `Operations`, but at a higher level. Note your README flags per-seat tool scoping as *planned* (ROADMAP item 18) — Pi's per-tool Operations seam is a good model for closing that gap [^3].

### 5. Omnigent (Databricks, Apache 2.0) — the tiered supervisor
The most architecturally ambitious reference: a **four-tier process topology — server ⇄ host daemon ⇄ runner ⇄ per-conversation harness subprocess** — whose adapter boundary is deliberately a recursive subset of its own public REST API. Its registry ships 23 canonical harness adapters across five integration modes (`sdk-in-process`, `cli-subprocess`, `acp-subprocess`, `native-tui`, `native-server`), reconciled against a conformance bench (basic turns, tool calling, streaming, interrupts, model override, policy denial) [^1].

> **For Durian-Pi:** This is the "harness as commodity" thesis — if you ever want Durian-Pi to drive *other* harnesses as seats, Omnigent's five integration modes are the taxonomy to design your adapter interface against.

---

## The Canonical Anatomy (the seven subsystems)

Across eleven systems studied in the source-code survey, every harness takes a position on the same **seven subsystems**, plus two cross-cutting surfaces [^1] [^1]:

| Subsystem | Minimal form | Maximal form | Durian-Pi's version |
|---|---|---|---|
| Agent loop | prompt→infer→tool→observe | event-sourced tree | broker + seat wake |
| Tool system | one shell call | 43 typed tools + permission/UI layers | pi-durable extensions |
| Context management | truncate | multi-stage distillation pipeline | compaction over session tree |
| Session substrate | none | append-only tree, fork/resume | pi-durable documents |
| Provider abstraction | one SDK | router + adapters + catalog | `src/seatmodel.mjs`, `deepinfra-models.ts` |
| Orchestration | *deliberate absence* | multi-agent teams | Seats/Edges/RigQueue |
| Interface layer | CLI flags | TUI/IDE/HTTP/SDK | `cli.mjs` (JSON contract) |

Two interface details worth stealing: **Gemini CLI's state-machine Scheduler** walks each tool invocation through deterministic `Validating→Executing→Completed/Errored` phases [^1], and **Hermes' singleton registry** separates registration from exposure — 69 tools self-register, a toolset layer scopes what each platform sees, and a coercion layer repairs schema drift (`"42"→42`) [^1]. Both are directly applicable to your extension `tools` contribution path.

---

## Concrete Design Moves for Your Harness

Mapping the above onto Durian-Pi's current shape:

1. **Keep the broker-owns-store split** — it's your differentiator vs. OpenCode's log-as-queue. One broker per database with `serve --stop` cooperative reaping is a cleaner lifecycle than a socket daemon [^3].
2. **Upgrade `genlock.mjs` toward resource-keyed locks** — model it on OpenHands' resource-lock manager so seats only serialize when they collide on a file/terminal/browser [^1]. Your per-seat worktrees already give you the isolation boundary.
3. **Expose the broker over an HTTP/SSE interface** — OpenCode shows that a single event bus fanning out to `/sse` lets any client (TUI, web, script) drive the same run [^2]. Your `watchview.mjs`/`chatview.mjs` are currently in-process renderers; an SSE tap would make them network clients for free.
4. **Formalize the extension seam as an Operations-style interface** — Pi's per-tool `Operations` interface is the pattern that lets execution relocate (SSH/container/micro-VM) without touching tool definitions [^1]. This also solves your pending per-seat tool scoping [^3].
5. **Add a conformance bench** — Omnigent "tests harnesses like hardware" via probes for basic turns, tool calling, streaming, interrupts, model override, and policy denial [^1]. Your `demo/*.test.mjs` "one runnable proof per guarantee" is already 80% of this; the gap is a *uniform* probe set rather than per-feature tests.

**Highest-leverage reads for your codebase:** OpenCode's `Session.prompt` + `process` stream handling [^2] [^2] for loop/streaming structure; OpenHands' `EventLog`/`FileStore`/`flock` and `ParallelToolExecutor` [^1] for your locking layer; and Pi's JSONL session tree [^1] since that's your upstream substrate.

Would you like me to go deeper on any single reference — e.g., the exact OpenHands event-log file layout and lock protocol, or the OpenCode server/SDK boundary — so you can diff it against your `src/rig.mjs` and `src/genlock.mjs`?

**References**

[^1]: [[2609.00006v1] Harness Engineering: Anatomy, Architecture, and Evolution of Coding Agents -- A Source-Code Study of Eleven Systems](https://arxiv.org/html/2609.00006v1) (36%)
[^2]: [How Coding Agents Actually Work: Inside OpenCode | Moncef Abboud](https://cefboud.com/posts/coding-agents-internals-opencode-deepdive/) (26%)
[^3]: [GitHub - chexxor/Durian-Pi: An OpenRig-like multi-agent team manager built on Pi-Durable · GitHub](https://github.com/chexxor/Durian-Pi) (22%)
[^4]: [GitHub - forge-dev-studio/forge-agent: The open agent runtime — self-hosted AI agent daemon with multi-platform bridges and MCP-compatible plugin system · GitHub](https://github.com/forge-dev-studio/forge-agent) (10%)
[^5]: [OpenHands/docs/architecture.md at main · OpenHands/OpenHands · GitHub](https://github.com/OpenHands/OpenHands/blob/main/docs/architecture.md) (4%)
[^6]: [OpenHands: An Open Platform for - arXiv.org](https://arxiv.org/html/2407.16741v3) (2%)



I'll dig into your storage layer and the specific locking patterns in the reference projects.Let me pull the specific fixes and the storage implementations in the reference projects.Let me get the concrete OpenHands persistence code and locate pi-durable's actual storage implementation.One more targeted pull — the actual storage layer under your app.# Fixing the `database is locked` / `WAKE-RETRY` loop in Durian-Pi

## What the log is actually telling you

Two separate failures are compounding:

1. **`SessionFailed: Session failed after a storage error; close and reopen it cause=Error: database is locked`** — a SQLite `SQLITE_BUSY` raised on a write. SQLite is single-writer; when one connection holds the write lock, another gets `database is locked` immediately unless it is told to wait [^7] [^8].
2. **`WAKE-RETRY in=60000ms seats=- pass-threw`** — your broker's wake handler threw and rescheduled. The timestamps (04:12:16.932 → .432 → .932 → …) are ~500 ms apart while the message claims `in=60000ms`, so the retry loop is *spinning* rather than waiting 60 s. That's a second, independent bug: a fixed-delay retry with no backoff or jitter, retrying a non-idempotent "close and reopen" against the same contended lock [^2].

Your architecture makes this likely by design: state lives in pi-durable documents changed atomically with transcripts [^5], all in one SQLite file (`DURIAN_PI_DB`, default `./rig.sqlite`) [^5] — and you have multiple seats plus a broker that can each open their own connection to that single file.

---

## Reference #1 — pi-durable itself (your substrate: close the gap here first)

This is the layer that actually throws, so fix it at the source. pi-durable's `SqliteStorage` opens native Node via `openNodeSqliteStorage()` using **`node:sqlite`** (not better-sqlite3), and — importantly — *"Multiple SQLite adapters can coordinate operations to safely share a single underlying database instance"* [^3]. Its `SessionImpl` owns the **"single mutation line, transaction scoping, document cache eviction, and committed publication listeners,"** with every atomic commit guaranteeing record writes + task updates + document deltas succeed or roll back together [^3].

**The gap to reference:** pi-durable's documentation specifies *atomicity* but **does not specify WAL mode, `busy_timeout`, a `synchronous` pragma, or connection open/close lifecycle, and does not describe `SQLITE_BUSY` handling/retries** [^3]. That is precisely your missing piece. Reference:

- `packages/durable/src/storage/sqlite/storage.ts` — the `open()` path (where pragmas should be set).
- `packages/durable/src/session/session.ts` — the `SessionImpl` single mutation line (where "close and reopen it" should be centralized, not scattered).
- `packages/durable/docs/spec.md` — the atomic-commit contract your retry must respect.

**Action:** confirm whether `openNodeSqliteStorage()` sets `journal_mode=WAL` and `busy_timeout` on every connection. If not, that alone explains intermittent `database is locked` under multi-seat load.

---

## Reference #2 — OpenHands `EventLog` + `LocalFileStore.lock()` (the architectural fix)

OpenHands solved exactly this class of problem by **not putting the high-churn transcript on the same lock as the document state.** Their `EventLog` is an **append-only, file-backed sequence**: each event is an individual JSON file named `event-{index:05d}-{event_id}.json`, which *"avoid[s] large monolithic file lock contention"* [^1] [^1]. Concurrent appends are serialized by an **exclusive `.eventlog.lock` file with a 30-second timeout**, and each `append()`:

1. acquires the lock,
2. **synchronizes against on-disk state** (to account for other processes' writes),
3. writes the event file atomically, updates indices, releases [^1].

They layer **two locks**: an in-process `FIFOLock` (acquire/release with timeout, batch writes inside a context manager, flush once on exit) *plus* the cross-process file lock [^4]. That's the same two-tier split your broker/seat design needs — but currently your `genlock.mjs` leases are the only tier.

**For Durian-Pi:** your append-only audit trail [^5] is the natural candidate to move off the SQLite write lock and onto OpenHands' per-record-file + `.lock` model. Then only the *documents* contend on SQLite, and your "close and reopen on storage error" stops being triggered by transcript churn. Reference `openhands/sdk/conversation/event_store.py` and `openhands/sdk/io/local.py` (`FileStore.lock()`).

---

## Reference #3 — the canonical SQLite PRAGMA/transaction discipline

Apply these at connection-open time, per connection (these are connection-local except `journal_mode`) [^6] [^2]:

```sql
PRAGMA journal_mode = WAL;      -- persistent; readers don't block the writer
PRAGMA busy_timeout = 5000;     -- per-connection; wait instead of failing instantly
PRAGMA synchronous = NORMAL;    -- (FULL for max durability)
```

Key points from the sources that map directly onto your bug:

| Symptom | Cause | Reference fix |
|---|---|---|
| Immediate `database is locked` | No `busy_timeout` set | Set it on **every** new connection and verify the returned value [^2] |
| Read-then-write transaction fails on upgrade | `BEGIN DEFERRED` upgrades late | Use **`BEGIN IMMEDIATE`** for any known-write unit; take the write reservation up front [^2] [^6] |
| Lock held too long | External work inside a transaction | *"Do not perform network calls, user interaction, file processing, or **model inference** inside a write transaction"* — prepare values before `BEGIN`, commit immediately, roll back on error [^6] |
| Sustained contention | Multiple writer processes | Route writes through **one in-process writer** or a dedicated writer service with a bounded queue [^2] |

> Your seats each doing model inference while holding a write transaction is the single most likely root cause — model calls are exactly the "external wait" the sources warn against [^6]. Serialize writes through the broker (you already own the store there) and never hold the lock across a model call.

Also verify your SQLite version: releases 3.7.0–3.51.2 contain a WAL-reset race under concurrent writer+checkpoint; use **3.51.3+** or a fixed backport [^2]. And note a **long-lived reader can pin the WAL** and stall checkpoints [^6] — watch for `-wal` growth.

---

## Concrete checklist against your files

| Your file / area | Reference to apply |
|---|---|
| pi-durable open path (`storage.ts`) | WAL + `busy_timeout` + `synchronous` on every connection [^6]; SQLite ≥ 3.51.3 [^2] |
| `src/genlock.mjs` (cross-process leases) | Keep — but add the **in-process FIFOLock tier** so intra-process writes serialize before hitting SQLite [^4] |
| Broker write path | `BEGIN IMMEDIATE` for known writes; never hold across a model/tool call [^2] [^6]; funnel all writes through one writer connection [^2] |
| Audit trail / transcripts | Move to OpenHands' per-event-file + `.lock` append-only model to remove churn from the SQLite lock [^1] [^1] |
| `WAKE-RETRY` handler | Replace fixed-delay retry with **bounded deadline + exponential backoff + jitter**, retrying only idempotent work, surfacing a controlled overload error when the budget is exhausted [^2]. Fix the ~500 ms spin vs. reported `in=60000ms` [^2] |

**Highest-leverage order:** (1) add `busy_timeout` + WAL in the pi-durable open path, (2) stop holding write transactions across model inference, (3) split the transcript off the SQLite lock à la OpenHands, (4) fix the retry to back off with jitter. Steps 1–2 likely clear the `SessionFailed` errors; step 4 stops the `WAKE-RETRY` storm from amplifying them.

Want me to go deeper on the exact OpenHands `LocalFileStore.lock()` / `FIFOLock` source so you can port it against your `genlock.mjs`, or pull the pi-durable `storage.ts` `open()` code to see whether the pragmas are already there?

**References**

[^1]: [Event System and Persistence | OpenHands/software-agent-sdk | DeepWiki](https://deepwiki.com/OpenHands/software-agent-sdk/5.5-event-system-and-persistence) (30%)
[^2]: [How to Fix SQLite “Database Is Locked” Errors Under Concurrent Writes](https://oneuptime.com/blog/post/2026-09-08-fix-sqlite-database-is-locked-concurrent-writes/view) (22%)
[^3]: [Durable Storage and Persistence | earendil-works/pi | DeepWiki](https://deepwiki.com/earendil-works/pi/7.4-durable-storage-and-persistence) (14%)
[^4]: [raw.githubusercontent.com](https://raw.githubusercontent.com/OpenHands/software-agent-sdk/main/openhands-sdk/openhands/sdk/conversation/state.py) (11%)
[^5]: [GitHub - chexxor/Durian-Pi: An OpenRig-like multi-agent team manager built on Pi-Durable · GitHub](https://github.com/chexxor/Durian-Pi) (10%)
[^6]: [SQLite “Database Is Locked”: WAL Mode, busy_timeout, and a Reliable Fix | DBA park](https://dbapark.com/sqlite-database-is-locked-wal-fix/) (9%)
[^7]: [SQLite “database is locked”: Causes and Fixes (Tested)](https://sqldocs.org/sqlite-database-is-locked/) (2%)
[^8]: [Fix: SQLITE_BUSY: database is locked](https://www.dbpro.app/learn/sqlite/errors/database-locked) (2%)