# Commands, the broker, and the daemon — a new maintainer's guide

**Status:** explanatory reference (not a decision). Grounded in `cli.mjs`, `src/broker.mjs`,
`src/driver.mjs`, `src/scheduler.mjs`, `src/storewrite.mjs`, `src/genlock.mjs`, `intent.mjs`, and
`@earendil-works/pi-durable`.
**Audience:** a new maintainer asking "how do I change something, and why does the broker get in the
way?"
**Companions:** `docs/BROKER-ARCHITECTURE.md` (the in-process actor model — why seats aren't fully
independent), `docs/BROKER-SUPERVISION.md` (the process lifecycle/daemon design of record),
`docs/PI-DURABLE-INTEGRATION.md` (durig ↔ pi-durable mapping).

---

## 1. Orientation: the four nouns

- **pi-durable** — the runtime library. It owns *durability*: a `Harness` over a SQLite store, each
  conversation a durable transcript, each input a `submission` that runs to a settled `done`/`unanswered`
  state, plus tools, providers, usage, and `resume()` on reopen. durig is a layer on top; when in doubt,
  the answer is usually "pi-durable owns that". (See `PI-DURABLE-INTEGRATION.md`.)
- **durig** — the rig: **seats** (personas/roles), the cross-seat **queue** (`RigQueue`) and router
  tools (`claim_work`, `complete_work`, `send_work`, `defer_work`), the **driver** that decides whom to
  wake, the **broker** that drives, and the **observers** (`status`/`watch`/`log`/`ui`).
- **The store** — one SQLite file = one rig (`selfdev.sqlite`, `tutor-pi.sqlite`; also `rig.sqlite` by
  default). Everything durable lives here. `*.sqlite` is gitignored.
- **The three actors** — the **operator/delegate** (intent, rulings), the **seats** (the team), and the
  **broker** (the scheduler/supervisor process). Keeping them straight is most of the onboarding.

---

## 2. The rule that explains everything: one owner, many clients

pi-durable's storage contract is **"one process owns a storage at a time; other clients attach to that
process."** durig implements that owner as the **broker** (`cli.mjs serve`). Consequences:

- **One process is the writer.** The broker opens the `Harness` once and holds it for its whole life.
- **Many client surfaces attach or read.** pi-durable's own clients are `viewState().subscribe()` and
  `watchEvents()`; durig's observers currently **read the store directly and poll** instead (D11).
- **Everything else is a producer** that either (a) *reads* the store (safe anytime) or (b) *writes*
  through a path that must not race the owner.

That last point is the whole "why can't I just run a write command?" story.

---

## 3. The layers (who talks to whom)

```
  operator / delegate / scripts / TUI / future daemon CLI
        │
        ├── READS ──► status·watch·log·events·ps·queue·metrics·check·config·ui.mjs
        │                  └─ read the SQLite store directly (D11); safe anytime
        │
        └── WRITES ─┬─► CLI write verbs: send · reset · resume/doctor · stop · up · run · serve
                    │        └─ open their OWN Harness (a second owner) ── then write
                    │
                    └─► intent.mjs ──► <db>.broker.inbox/  (a FILE; no Harness)
                                             │
                                             ▼
                              ┌─────────────────────────────────┐
                              │  the broker (cli.mjs serve)     │
                              │  the SOLE writer + scheduler    │
                              │  drivePass → driveOnce → wakes  │
                              │  drains the inbox each pass     │
                              └─────────────────────────────────┘
                                             │  one Harness
                                             ▼
                                    pi-durable + SQLite (WAL)

  FUTURE:  OS trigger (Task/launchd/systemd) ─► src/host.mjs (supervisor) ─► the broker
```

The key split: **reads are cheap and always allowed; writes either open a competing owner (risky) or
are spooled for the owner to apply (safe).**

---

## 4. Every command path, in one table

| Path | Effect | Opens the store? | Safe while the broker runs? | Why |
|---|---|---|---|---|
| `status`, `watch`, `log`, `events`, `metrics`, `check`, `config`, `ui.mjs` | read | storage read-only (`openStore`) | **Yes** | D11: viewers never wake seats; they read the storage layer directly |
| `ps`, `queue` | read the roster / queue, **but open a full harness** (`openHarness`, `resume: true`) | **Yes** | **Avoid while the broker runs** | they are short-lived *owners*, not viewers; they should read via `openStore` like `status` does (latent defect, §10) |
| `intent.mjs <seat> --body-file …` | spool an input for a seat | **No** (writes a file) | **Yes** | the broker drains `<db>.broker.inbox/` and submits it as operator input (`src/broker.mjs` `drainIntentInbox`) |
| seat tools (`claim_work`, `complete_work`, `send_work`, `defer_work`, …) | queue/transcript writes | inside whatever session drives the run | **Yes** when the broker drives | the tools run inside the seat's run, so the session that started the run is the sole writer for that write |
| `send <seat> …` | submit an input, wait for the run | **Yes** | **Risky — avoid** | second owner; `withStoreWriteRetry` covers only the entry-id race, and `up`/`run` are explicitly not covered (`cli.mjs` `cmdSend`) |
| `reset <seat>` / `clean` | write a reset boundary | **Yes** | **Risky** | second owner; live-lease guard only, no broker guard |
| `resume` / `doctor` | settle stranded submissions | **Yes** | **No — crashes the broker** | second owner doing a compound write; this is the 2026-10-16 incident |
| `stop <seat>` | cross-process halt + settle | **Yes** | **By design, yes** | kills the generation-lease holder pid, then settles; `openHarness({resume:false})` |
| `run [--watch]` | drive to quiescence | **Yes** | **Refused** | explicit guard: refuses if a broker is alive (two schedulers double-wake) |
| `up` | create/refresh seats; maybe start the broker | **Yes** | depends | interactive TTY auto-starts the broker; `--no-serve`/`DURIG_NO_SERVE=1` opt out |
| `serve [--stop]` | the broker itself; `--stop` is the off switch | **Yes** | — | the sole writer/scheduler |
| `durig daemon …` *(planned)* | install the OS trigger → `src/host.mjs` → broker | host never opens the store | yes | supervisor, not scheduler (`BROKER-SUPERVISION.md`) |

Rule of thumb for a maintainer: **if you are adding a verb that mutates state, decide whether it is a
"read", an "inside-the-run" tool, or a "spool it for the broker" request. Do not add a fourth kind.**

---

## 5. Why writes need care — the two constraints

### 5.1 The entry-id race (mechanical)
The store is SQLite in **WAL** mode with `BEGIN IMMEDIATE` transactions, so the *database* is happy with
many readers + one writer. The problem is **client-side id allocation**: `SqliteStorage` caches
`durable_metadata.next_id` at open and mints ids with `idFromNumber(this.nextId++)`. Two processes that
open before either writes mint the **same** next id; the loser's commit fails
`ID n already belongs to entry`, and pi-durable poisons that session. `src/storewrite.mjs` recognises
exactly that error and reopens+retries — but retry can only fix a *simple* race, not a compound write
(the 2026-10-16 `resume`-vs-broker interleaving is the counter-example: it left a mid-stream
`generation` reset that orphaned later appends, wedging the store).

### 5.2 One scheduler (semantic)
The broker is not just a lock — it decides **when to wake which seat** from the store's in-process commit
stream. A second writer that submits wakes is a second scheduler → double-wake (D45/D46). Even if writes
were mechanically safe, you'd still want a single scheduling authority.

### 5.3 What this means in practice
- **Reads:** do them whenever you like.
- **Writes while the broker runs:** only via the inbox (add new request types there) or the one verb
  designed for it (`stop`). Everything else either assumes the broker is stopped or accepts the race.
- **The crash signature to remember:** a `START` with no matching `EXIT` is an abnormal death; a session
  that fails with `Session failed after a storage error; close and reopen it` usually means a storage
  read threw and poisoned the pi-durable session.

---

## 6. Where the daemon fits

Today the broker is a **detached child that nothing restarts**; `up` auto-starts it only for an
interactive terminal, and it dies on a crash/reboot. The **daemon** (`BROKER-SUPERVISION.md`) adds two
layers above it:

- **Layer 0 — OS trigger** (Windows Task, macOS LaunchAgent, `systemd --user` by default; a system
  service is the opt-in). It starts `src/host.mjs` and observes only process exit.
- **Layer 1 — the host (`src/host.mjs`)** — pure Node, **never opens the store**. It owns
  single-instance, backoff, give-up, heartbeat-watching, kill-on-wedge, and the durable
  `<db>.broker.down` marker.
- **Layer 2 — the broker** — unchanged: the sole writer and scheduler.

The important line for a maintainer: **the daemon is a supervisor, never a scheduler or a writer.**
If it ever re-drove the queue, we'd have double-work. This is why "always running" raises the stakes on
the command-path question: once the broker never stops, the CLI can no longer assume it can take over.

---

## 7. The mailbox: how commands *should* reach a running broker

The intent inbox is the seed of the answer. It is a **file spool** — `<db>.broker.inbox/` — holding
one JSON request per file:

```json
{ "to": "pm", "from": "operator", "content": "…", "requestId": "…", "createdAt": "…" }
```

`intent.mjs` writes it without opening the store. The broker drains it at the **start of every pass**
(`drainIntentInbox`) and submits each as a real operator input to the target seat; undeliverable
requests are dead-lettered to `<db>.broker.inbox/error/`, never retried forever.

The proposed generalisation (roadmap candidate): turn this from "deliver a *message*" into "apply an
*operation*" — a **command spool** for `send`, `reset`, `stop`, and queue edits, each with a
`requestId` (idempotent re-drain; item 66) and a **result channel** so the caller can await the outcome.
Then the CLI, the TUI, scripts, and the daemon are all **producers**, and the broker is the single
**actor**. That yields:
- reads anytime (already true),
- writes anytime (enqueue),
- exactly one scheduler and one writer.

Trade-off to accept: writes become **asynchronous** (you get a `requestId` and await a result), which is
the correct shape for a daemon anyway. This is the direction `BROKER-ARCHITECTURE.md` calls
"one owner, many clients" — adopt the broker's push/request surface instead of opening a second owner.

---

## 8. Invariants a maintainer must preserve

1. **One writer per store.** Only the broker opens a writing `Harness` while it runs.
2. **One scheduler.** Never `run`/`up --serve` against a store whose broker is alive.
3. **Viewers never wake seats** (D11).
4. **The daemon never opens the store** and never becomes a second writer.
5. **`START` without `EXIT` is abnormal** — the log is the lifecycle ledger.
6. **A failed storage read poisons the pi-durable session** (`SessionFailed`) — tolerate expected
   corruption at the read boundary (as `readapi.mjs` does for `pi.live`) rather than letting one bad
   document kill a whole command.

---

## 9. Code map (where to look)

| File / entry | Role |
|---|---|
| `cli.mjs` | all verbs: `cmdUp`/`cmdServe`/`cmdRun`/`cmdSend`/`cmdStop`/`cmdResume`/`cmdReset`; the F12 seat-root guard; the top-level JSON contract; the **composition root** that opens the harness (`openHarness`) and the storage (`openStore`) — no `src/` module opens a harness |
| `src/broker.mjs` | `drivePass`, `runWakeLoop`, `logBrokerLine`, broker state/log, the intent inbox (`writeIntent`/`drainIntentInbox`) |
| `src/driver.mjs` | `selectWakes` / `driveOnce` — *whom* to wake |
| `src/scheduler.mjs` | *when* a pass may run (floor, cooldown, coalescing) |
| `src/genlock.mjs` | cross-process generation-slot leases (`DURIG_MAX_CONCURRENT_SEATS`) |
| `src/storewrite.mjs` | the entry-id-conflict retry (`withStoreWriteRetry`) |
| `src/supervisor.mjs` | the in-process escalation pass (distinct from the host daemon) |
| `src/rig.mjs` | `Seats`, `RigQueue`, `Router`, personas |
| `intent.mjs` | the inbox producer (no store access) |
| `ui.mjs` | the interactive TUI (reads; a future client of the owner) |
| `src/host.mjs` *(planned)* | the portable supervisor; never opens the store |

---

## 10. Known gaps (for the next maintainer)

- **Broker start provenance is not logged.** The `START` line is `START pid=<n>`; nothing records
  whether the broker came from an interactive `up`, a direct `serve`, or (later) the daemon. A small
  change would thread an origin through `cmdServe` → `runWakeLoop` and emit e.g.
  `START pid=<n> source=up|serve|daemon`. (Touch `cli.mjs`/`src/broker.mjs`: a team item, and `cli.mjs`
  is often in flight.)
- **The command spool** (§7) does not exist yet for non-message writes.
- **`ps` / `queue` open a full harness just to read.** `cmdPs`/`cmdQueue` call `openHarness()` (default `resume: true`), so they are short-lived *owners* and can race the broker; `status`/`watch`/`log`/`events` read via `openStore` (storage only). The fix is to route `ps`/`queue` through `openStore` too — a small, isolated change.
- **No heartbeat / durable down marker yet** (items 61–62) — a reader cannot distinguish "parked in a
  pass" from "wedged"; `BROKER-SUPERVISION.md` §4.
- **Pass parking** — `drivePass` still awaits the runs it woke, so the `PASS` line can stop advancing
  while a run generates (item 54).
