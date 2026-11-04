# Commands, the broker, and the daemon — a new maintainer's guide

**Status:** explanatory reference (not a decision). Grounded in `cli.mjs`, `src/broker.mjs`,
`src/driver.mjs`, `src/scheduler.mjs`, `src/storewrite.mjs`, `src/genlock.mjs`, `intent.mjs`, and
`@earendil-works/pi-durable`.
**Audience:** a new maintainer asking "how do I change something, and why does the broker get in the
way?"
**Companions:** `docs/BROKER-ARCHITECTURE.md` (the in-process actor model — why seats aren't fully
independent), `docs/BROKER-SUPERVISION.md` (the process lifecycle/daemon design of record),
`docs/PI-DURABLE-INTEGRATION.md` (durian-pi ↔ pi-durable mapping).

---

## 1. Orientation: a library, a program, and who owns the store

**pi-durable is a library, not a service.** It ships classes — `Harness`, `SqliteStorage`,
conversation and submission objects, tools, providers — that a *program* embeds. There is no daemon and
no listening port, and no owner that outlives the process.

That makes "pi-durable owns the store" a shorthand worth unpacking. Precisely: **the process that
called `Harness.open(storage, …)` owns that storage for as long as its `Harness` is open.** The library
supplies the rule; a running process satisfies it. The rule, verbatim from the library:

> "One process owns a storage at a time; there is no cross-process locking." (`README.md:682`)

So there is **no lock at the database level** — pi-durable simply assumes the embedding application
keeps one owner. durian-pi keeps its side by policy: **the broker is durian-pi's chosen long-lived owner**, and
`<db>.broker.json` plus the `run`/`serve` guards are how durian-pi enforces it. The four nouns to keep
straight:

- **pi-durable** — the library: durable conversations, submissions, tools, providers, `resume()`.
- **durian-pi** — the program: **seats** (personas/roles), the cross-seat **queue** (`RigQueue`) and router
  tools (`claim_work`, `complete_work`, `send_work`, `defer_work`), the **driver** that decides whom to
  wake, the **broker** that drives, and the **observers** (`status`/`watch`/`log`/`ui`).
- **The store** — one SQLite file = one rig (`selfdev.sqlite`; `rig.sqlite` by
  default). Everything durable lives here. `*.sqlite` is gitignored.
- **The three actors** — the **operator/delegate** (intent, rulings), the **seats** (the team), and the
  **broker** (the scheduler/supervisor process).

For the durian-pi-versus-harness division of responsibilities, see the concept map in
`docs/PI-DURABLE-INTEGRATION.md` §2.

## 2. Multiplayer, precisely: one owner, many clients

pi-durable **is** a multiplayer system — but "multiplayer" here means **many clients attached to the
one owner**, not many writers to one file. The library provides the client surface:

- `viewState()` — the conversation's structural view, "updated after every commit" (`README.md:380`);
- `watch()` / `watchEvents()` — attach a live stream mid-run (`README.md:493`);
- busy-conversation semantics — a client can steer a running conversation or queue a follow-up.

There is no multi-writer mode and no cross-process lock; the embedding program must keep a single
owner. durian-pi currently **under-uses** the client surface — its observers read the store directly and
poll (`D11`) instead of attaching to the owner's push stream, which is why the TUI feels single-player
and why "adopt the owner's push stream" is a deferred item (`docs/BROKER-ARCHITECTURE.md`).

The broker is **not** the only part of durian-pi that touches the library, nor the only harness owner:

| Component | How it uses pi-durable |
|---|---|
| `cli.mjs` | the **composition root**: `openHarness()` opens a real `Harness` over the store; `openStore()` opens the storage read-only. No `src/` module opens a harness. |
| verbs `up`, `ps`, `queue`, `resume`, `reset`, `run`, `serve`, `stop`, `send` | each opens a **short-lived `Harness`** — each is a short-lived **owner** |
| verbs `status`, `watch`, `log`, `events`, `metrics`, `check` | open the **storage only** (`openStore`) — true readers |
| `intent.mjs` | opens **neither** — it writes a request file for the broker to drain |
| `src/*.mjs` (rig, seattools, seatguard, confine, readapi, …) | consume pi-durable's types and utilities as pure layers handed a harness/storage; they never open one |
| `demo/*.mjs` (42 files) | construct `Harness.open(new MemoryStorage(), …)` directly for offline tests |

The broker is special only as the **long-lived** owner. Every other verb that opens a harness is a
**second owner** while the broker runs — the root of the conflict the rest of this document explains:

- **One process is the writer.** The broker opens the `Harness` once and holds it for its whole life.
- **Everything else is a producer** that either (a) *reads* the store (safe anytime) or (b) *writes*
  through a path that must not race the owner.

That last point is the whole "why can't I just run a write command?" story.

---

## 3. The layers (who talks to whom)

```
  operator / delegate / scripts / TUI / future daemon CLI
        │
        ├── READS ──► status·watch·log·events·metrics·check·config·ui.mjs
        │                  └─ open the STORAGE read-only (D11); safe anytime
        │   ps·queue ──► read the roster/queue, but open a full Harness (a short-lived owner);
        │                  avoid while the broker runs (§4)
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
| `status`, `watch`, `log`, `events`, `metrics`, `check`, `config`, `ui.mjs` | read | **broker-served** via the `read` spool op when a broker is alive; direct `openStore` only when none is (D111) | **Yes** | D11: viewers never wake seats. The broker owns the pi-durable instance, and `SqliteStorage.document()` takes `BEGIN IMMEDIATE` even for a read, so a second opener steals its write lock — the read is served by the broker instead |
| `ps`, `queue` | read the roster / queue via `openStore` (storage only) | **Yes** | **Yes** | reads only — no harness, no second owner (fixed, ROADMAP 69) |
| `intent.mjs <seat> --body-file …` | spool an input for a seat | **No** (writes a file) | **Yes** | the broker drains `<db>.broker.inbox/` and submits it as operator input (`src/broker.mjs` `drainIntentInbox`) |
| seat tools (`claim_work`, `complete_work`, `send_work`, `defer_work`, …) | queue/transcript writes | inside whatever session drives the run | **Yes** when the broker drives | the tools run inside the seat's run, so the session that started the run is the sole writer for that write |
| `send <seat> …` | submit an input, wait for the run | **Yes** | **Refused** | second owner; `cmdSend` now refuses while a broker is alive (ROADMAP 69) — route via the spool or `serve --stop` |
| `reset <seat>` / `clean` | write a reset boundary | **Yes** | **Refused** | second owner; `cmdReset` now refuses while a broker is alive (ROADMAP 69); the live-lease guard remains for the no-broker case |
| `resume` / `doctor` | settle stranded submissions | **Yes** | **Refused** | second owner doing a compound write (the 2026-10-16 incident); `cmdResume` now refuses while a broker is alive (ROADMAP 69) |
| `stop <seat>` | cross-process halt + settle | **Yes** | **By design, yes** | kills the generation-lease holder pid, then settles; `openHarness({resume:false})` |
| `run [--watch]` | drive to quiescence | **Yes** | **Refused** | explicit guard: refuses if a broker is alive (two schedulers double-wake) |
| `up` | create/refresh seats; maybe start the broker | **Yes** | **Refused** | second writer: a resident broker already drives the store, and `cmdUp` refuses while it is alive (#1589). Exception: `up --dry-run` previews only and writes nothing, so it is **not** refused |
| `serve [--stop]` | the broker itself; `--stop` is the off switch | **Yes** | — | the sole writer/scheduler |
| `durian-pi daemon …` *(planned)* | install the OS trigger → `src/host.mjs` → broker | host never opens the store | yes | supervisor, not scheduler (`BROKER-SUPERVISION.md`) |

Rule of thumb for a maintainer: **if you are adding a verb that mutates state, decide whether it is a
"read", an "inside-the-run" tool, or a "spool it for the broker" request. Do not add a fourth kind.**

---

## 4A. The `queue` argument surface: known flags, accepted no-ops, refusals (#5016)

This table is the **authority on what is unknown**. The source (`cli.mjs` `QUEUE_FLAGS`) and
`demo/queue-compat-args.test.mjs` are the other two views of the same fact; if you change one, change all three,
because an invisible flag set is how a tool ends up refusing a documented form (measured, #5063).

| Flag | Known? | What it does | Which half it narrows |
|---|---|---|---|
| *(no flags)* | known | the WHOLE document — `{ok, command, items}`, every row, bodies included. This is today's byte-for-byte default and a demo pins it unchanged, so anything parsing `queue` today keeps working | nothing: this is the census |
| `--json` | known, **NO-OP** | nothing at all. `out()` has always printed JSON, so the bytes are identical to no flags; it is DOCUMENTED (`session-start-cost.md` Diagnose step 1 + its own `evidence:` line, `SELFDEV.md`, `tools/README.md`, ROADMAP 228) and delegate projections pipe it, so refusing it would be a new break | nothing |
| `--id <id>` (repeatable) | known | one (or a few) rows, body included; an id matching nothing is reported in `missing` and exits 1, because a typo'd id must not look like an empty queue | **payload**, not storage: the queue is ONE document (`RigQueue.value.items`), so the storage read stays whole |
| `--status <state>` (repeatable) | known (#5016) | prints only rows in that state; several values OR together, and it ANDs with `--to` and `--id`. The state is checked against the CLOSED vocabulary — `queued, claimed, deferred, held, done, cancelled` (`QUEUE_STATUSES` in `src/readapi.mjs`, measured off the live store) — so `--status done2` is refused by name instead of answering "no rows" to a typo | **payload** only. `rows`, `counts` and `attention` in the same answer stay the WHOLE store's |
| `--to <seat>` (repeatable) | known (#5016) | prints only rows addressed to that seat | **payload** only, same caveat |
| `--no-body` | known (#5016) | a VIEWER form: the `body` field is dropped and nothing else is. It announces itself — a `projection` header as the FIRST key of the payload and a `note:` line on stderr — because a truncated view that does not label itself becomes the record someone later trusts, and acting on a subject without its body is a registered failure of this rig. The counts and the attention lines are derived over the FULL rows BEFORE the trim, so dropping bodies cannot drop a notice | **payload** only, and never the derivation |
| any other flag (`--zork`, `--fields`, `--ids`) | **refused** | exit 1; a structured `{"ok":false,"error":"queue: unknown argument --zork (known flags: …)"}` on stdout and, on stderr, the offending argument plus every known flag and the usage line. It never prints the document | n/a |
| a bare positional (`queue 5063`) | **refused** | same — there is no positional form to silently accept | n/a |

**A narrowed answer carries the census with it (#5016).** Every non-default `queue` answer includes `rows` (how many
rows the store holds), `counts` (per-state, over all rows) and `attention` (the notices derivable from queue rows —
today `deferred_awaiting_answer`, computed by the same `computeAttention` the `status` surface uses, so the measure
and the notice are one implementation). Kinds that need live generation slots or submission records
(`idle_with_queued_work`, `last_run_failed`, `repeated_failure`, `admitted_not_started`, `malformed_tool_call`) are
**excluded** from this surface rather than approximated — emitting them from a row-only read would be a different
claim from the one `status` makes. Those three keys come from the `queue-census` read view (a few hundred bytes even
when a broker serves it), and the answer also says `narrowed: "payload"` so a small reply never implies a small
read. A partial queue view mistaken for the census is this rig's registered failure; `rows`/`counts`/`attention` are
what make the partiality visible instead of inferred.

**Why the refusals exist.** Before #4986/#5063/#5016, `cmdQueue()` took no arguments at all, so *every* spelling
exited 0 and printed the same ~22 MB document — measured at `e3118fa0`: `queue`, `queue --json`,
`queue --status held`, `queue --to pm --json`, `queue --ids`, `queue --no-body`, `queue --fields id`,
`queue --zork` all exit 0 with byte-identical output. A typo therefore cost the full document and reported
success: that is the fail-open ROADMAP 228 names, and it is also how a wrong `DURIG_DB` came to manufacture a
store (see §4 and `docs/runbooks/session-start-cost.md`).

**The discipline, so this does not rot in either direction:** a flag becomes *known* only when a real call site
uses it or a document names it, and the row that makes it known adds its **accept** line to the compat demo in the
same change. A flag nobody uses stays refused, and the refusal is what proves the accept list is a set rather than
a shrug.

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

**State (ROADMAP 71, item #912 — started).** The spool is no longer message-only: a request file may
carry an `op`, and the broker APPLIES it with its own harness. The closed vocabulary is
`src/broker.mjs` `SPOOL_OPS` — today `message` (the original intent; an absent `op` defaults to it),
`stop` (settle the seat's pending submission to `aborted: <reason>` and abort its run task,
in-process, no pid kill), `reset` (draw the shared reset boundary, `src/reset.mjs`, lifted out of
`cli.mjs` so the CLI and the broker apply the SAME mechanism), and `compact` (summarize the seat's
old context LIVE — pi-durable's `conversation.compact()` runs alongside the conversation, so the
broker applies it with its own harness and the seat's run is not aborted; #1904), `pause`/`unpause`
(ROADMAP 131), `configure` (set a seat's model), and `read` (D111: serve a viewer read from the
broker's OWN `Storage` so no second process opens the database — the client half is
`src/readclient.mjs`, the view set is `src/brokerread.mjs`). An unknown `op` is dead-lettered, never
applied. Each applied request records its outcome at `<db>.broker.inbox.out/<requestId>.json` (the
**result channel**), and that file is also the **idempotency ledger**: a duplicate `requestId` is
recognised on re-drain and applies ONCE. `intent.mjs` is the producer (`--op`, `--reason`, `--handoff`,
`--instructions`); it mints and prints the `requestId`. Remaining for full delivery: queue edits as ops
(they need the queue/Router writers lifted out of `cli.mjs`). Acceptance demos:
`demo/command-spool.test.mjs`, `demo/compact-spool.test.mjs`.

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
| `src/genlock.mjs` | cross-process generation-slot leases (`DURIAN_PI_MAX_CONCURRENT_SEATS`) |
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
- **`ps` / `queue` now read via `openStore`** (fixed, ROADMAP 69): `cmdPs`/`cmdQueue` no longer open a harness, so they cannot race the broker. `send`/`reset`/`resume` REFUSE while a broker is alive (same item).
- **No heartbeat / durable down marker yet** (items 61–62) — a reader cannot distinguish "parked in a
  pass" from "wedged"; `BROKER-SUPERVISION.md` §4.
- **Pass parking** — `drivePass` still awaits the runs it woke, so the `PASS` line can stop advancing
  while a run generates (item 54).
