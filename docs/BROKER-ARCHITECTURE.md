# durig broker architecture — actors, mailboxes, and one event loop

**Status:** explanatory reference (not a decision). Grounded in `src/broker.mjs`, `src/scheduler.mjs`,
`src/driver.mjs`, `src/genlock.mjs`, `src/rig.mjs`, and `cli.mjs` `cmdServe`.
**Audience:** anyone asking "why can't the seats just run independently, like async tasks?"

## The model in one paragraph

The broker **is** the event loop, and a seat run **is** the async task. The broker is a single process
that owns the harness (the LLM runtime) and the store; it wakes seats when there is work, reacts to the
store's in-process commit stream, and supervises. Each seat is an actor with a **durable mailbox** (its
conversation transcript) and a **durable claim** (the queue item it holds). Seats communicate only by
messages submitted to conversations; they share no in-memory state, only the durable store. So durig is
not "an event loop that can't handle concurrency" — it is an actor system whose concurrency is bounded
by resources and whose actors are expensive and stateful.

## Mapping durig onto actor-model vocabulary

| durig concept | Actor-model term | Where |
|---|---|---|
| Seat | actor (a process/object with identity and state) | `src/rig.mjs` `Seats` |
| Conversation transcript | durable mailbox | conversation `submit()` |
| Wake | a message delivered to that mailbox | `src/driver.mjs` `selectWakes`/`driveOnce` |
| The queue (a dynamic document) | shared work log / message bus | `src/rig.mjs` `RigQueue` |
| The broker (`serve`) | scheduler **and** supervisor | `src/broker.mjs` `runWakeLoop` |
| Commit subscription | completion-event stream | `harness.subscribeCommits` (`cli.mjs`) |
| `drivePass` | one scheduler tick | `src/broker.mjs` `drivePass` |
| genlock slot | bounded execution-slot pool | `src/genlock.mjs` |
| Per-item worktree | per-actor filesystem isolation | `src/worktree.mjs` |

## The comparison table

| Aspect | Node event loop | Erlang process | Smalltalk object | durig seat (in the broker) |
|---|---|---|---|---|
| **Unit of concurrency** | async task / continuation | process (lightweight, preemptively scheduled) | object invocation | a seat **run** (generation + tool turns) |
| **Communication** | callbacks/promises (in-process) | **asynchronous messages to a mailbox** (copied, isolated heaps) | **synchronous** message send (method call) | input entries submitted to a conversation |
| **Mailbox** | none | yes — `receive` with pattern matching | none (the caller blocks on the send) | yes — the durable transcript |
| **Serialization** | one callback at a time | one process handles one message at a time | the object handles one call at a time | one run per seat at a time; a pass per broker |
| **Scheduler** | libuv, cooperative at I/O | the BEAM, preemptive, millions of processes | the VM's call stack | `runWakeLoop` + commit subscription |
| **Preemption** | none (cooperative) | yes (reductions) | none (synchronous) | **none** — a run cannot be preempted mid-generation |
| **State lifetime** | ephemeral (lost on crash) | ephemeral (lost on crash; supervisors restart) | ephemeral unless persisted | **durable** — conversation, claim, worktree |
| **Shared state** | in-process variables | none (isolation is the rule) | object graph (shared by reference) | one **storage-owning harness**; other clients attach; the queue is a shared log |
| **Isolation** | not applicable | memory isolation per process | objects share the heap | separate conversations + per-item worktrees; one OS process |
| **Cost per unit** | microseconds | microseconds | nanoseconds | **seconds–minutes and real money** |
| **Concurrency bound** | thousands | millions | one thread | `DURIG_MAX_CONCURRENT_SEATS` (generation slots) |
| **Failure model** | task throws, loop continues | "let it crash" + supervisor trees | exception unwinds the caller | supervisor pass; degeneration reset **between** runs |
| **When a unit misbehaves** | bounded; never blocks the loop | preempted or killed by its supervisor | throws | can run unbounded (degeneration) and, today, park a pass |

## Why the "independent async routines" intuition mostly holds

- **One event loop already exists.** `cmdServe` opens the harness once and subscribes to its commit
  stream: `harness.subscribeCommits((publication) => { scheduler.notify(publication); if
  (scheduler.dirty) signal.raise(); })`. A commit is the "I/O completion"; the loop rests on
  `signal.wait` and runs a pass when work is due.
- **Runs are concurrent.** A pass can wake several seats (`PASS ... woke=pm,impl`), and the generation
  slots (`genlock`) let up to `DURIG_MAX_CONCURRENT_SEATS` generate at once.
- **Runs are serialized only at the commit boundary** — a short, ordered write to the store — not for
  their whole duration.

## The three real constraints (why "fully independent" is not free)

1. **One storage-owning harness — pi-durable's rule, not durig's.** The README says "One process owns a
   storage at a time; there is no cross-process locking", and the spec says old and new harnesses must
   never own the same Session concurrently. durig's `<db>.broker.json` holder implements that rule; the
   F24 collision (`ID n already belongs to entry`) is what happens when two harness owners share one
   store. This bounds **owners**, not seats: many conversations run concurrently *inside* the one owner.
2. **Expensive, resource-bounded actors.** A run holds a generation slot and a paid provider stream;
   `DURIG_MAX_CONCURRENT_SEATS` is *durig's* cost/GPU/provider bound. pi-durable's "Many conversations
   at once" imposes no such limit — you could run far more seats if they were free.
3. **Non-deterministic, unbounded runs.** A seat can degenerate (the observed `qa` loop) and keep
   generating. Nothing preempts it, so a supervisor cannot act mid-run; the guard resets *between* runs.

## Multiplayer, correctly understood

The pi-durable post's "Multiplayer" is **not** many writers to one file — it is **many clients attached
 to one owning harness**:

> "everything a UI needs is committed state, so any number of clients can attach to any conversation in
> the harness… Any client can steer a running conversation or queue a follow-up." — the blog

 and the same post, on storage: "One process owns a storage at a time, and other clients attach to that
 process." So the two are the same design at two layers: **one owner, many clients.**

- pi-durable's client surface is `viewState().subscribe()` (push, updated after every commit),
  `watch()`/`watchEvents()` (remote, over a socket), and busy-conversation semantics
  (`whenBusy: "steer" | "follow-up" | "reject"`).
- durig's viewers (`ui.mjs`, `watch`, `log --follow`) **do not attach** to the owner; they read storage
  directly and poll (D11). That is why the TUI feels non-multiplayer and why a spooled intent can wait
  behind a run. Adopting the owner's push stream for the TUI is the deferred "Level 2 resident server",
  and it is the same pub-sub you asked about — it already exists upstream; durig just is not a client.

## One known scheduler bug, and the fix

`drivePass` wakes its seats and then **awaits** them:

```
const wokenIdle = Promise.all([...wokenConvIds].map(id => conv.waitForIdle(context)));
if (settleSignal) await settleSignal.race(wokenIdle);
```

A good event loop does not await a task inside its tick; it reacts to the task's completion event. Here,
when the woken run is the only activity and produces no wake-relevant commit, the pass **parks** and
the whole loop stalls — observed as a 15-minute gap (`PASS 185` → `PASS 186`) while a single `qa` run
generated. The fix is the pub-sub direction: have `drivePass` wake and return, let the commit
subscription drive the next pass, and keep the one global `waitForIdle` drain only on loop exit (F11).
See `docs/TUI-IMPLEMENTATION-PLAN.md` for the surface work; the broker fix is tracked separately.

## What is genuinely unlike Erlang

- **No preemption.** Erlang can time-slice a process at any reduction; durig cannot cut a generation
  mid-stream (provider-level) — that is the recorded "mid-run cut" gap.
- **No heap isolation.** Seats run in one OS process; isolation is organizational (conversations,
  worktrees), not enforced by the runtime.
- **Durable mailboxes.** An Erlang mailbox dies with the process; a durig conversation *is* the durable
  record, which is why a seat can be reset and re-anchored without losing history.
- **No crash-only design.** Erlang's "let it crash" restarts a fresh process; durig must preserve the
  conversation and the claimed item across a reset.

## Glossary

- **Pass** — one scheduler tick: drain intent, inspect, select wakes, submit, supervise.
- **Wake** — a submitted input that tells a seat to act.
- **Slot / genlock** — a cross-process lease that bounds concurrent generations.
- **Intent inbox** — a file spool (`<db>.broker.inbox/`) the broker drains at the start of a pass, so
  operator intent reaches a seat while the broker drives.
- **Worktree** — a per-item checkout so two seats can edit files without clobbering each other.
