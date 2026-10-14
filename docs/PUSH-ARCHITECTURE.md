# Event-driven durig and Pi-harness integration — initial thinking and design

**Status:** initial thinking + design overview — input for `pm` (decomposition), `lead` (scope + D-entry
ruling), `security` (if a socket is added), `advocate`/`designer` (workflow + surface). Not a decision.
**Author:** operator's delegate session.
**Date:** 2026-10-13.
**Next work item:** §6 — a timeboxed spike on the Pi-side wake (piece 1).
**Companion doc:** `docs/UI-TUI-INITIAL-THINKING.md` (the interactive client, a separate concern).

---

## 1. Motivation

`durig run` is a **clock**: it loops `driveOnce` (`src/driver.mjs`) until the queue is quiescent, and it
must be re-invoked by an external actor. The operator's position: this is backwards. durig should be
**interactive/push-based** — it should wake seats when work is enqueued, not depend on an external cron.
That is exactly **ROADMAP 38** (*"Self-driving queue: wake the seat when work is enqueued, instead of an
external clock"*), and its architectural half is **ROADMAP 40(a)/38(b)** (*"one long-lived writer that
**is** the harness"*). The operator also wants durig to work with an LLM harness like **Pi**, i.e. the
operator's own agent session should be woken by durig events rather than polling.

The load-bearing constraint: **LLM harnesses are turn-based.** A tool call returns at completion, so a
model cannot consume a continuous stream inside a turn. Push into a model therefore means **event
injection that starts a new turn**, not a blocking "next event" tool. This document designs for that.

---

## 2. What Pi exposes (grounded; read the docs before implementation)

Pi is already installed at `@earendil-works/pi-coding-agent@1.1.0`. Four integration surfaces, from the
Pi docs (`docs/rpc.md`, `docs/json.md`, `docs/extensions.md`, `docs/mcp.md`, `docs/sdk.md`):

| Surface | What it is | Pub-sub fit |
|---|---|---|
| **RPC mode** (`pi --mode rpc --no-session`) | long-lived subprocess; JSONL commands in, session events out | **The push/event interface.** Commands: `prompt`, `steer`, `follow_up`, `abort`, `bash`, `get_state`, `set_model`, session ops. Events: `agent_start`/`turn_start`/`message_start`, `message_update` (`text_delta`/`thinking_delta`/`toolcall_*`), `tool_execution_start/update/end`, `turn_end`, `agent_end`, `agent_settled`. |
| **Extensions** | TypeScript modules in-process; `pi.on(...)` lifecycle hooks; **`pi.sendUserMessage()`/`pi.sendMessage()`** inject a message | **The in-process wake.** Register a long-lived watcher from `session_start`; on an event, inject a message to open a turn. `agent_before_settle` is the last actionable boundary. |
| **SDK** | in-process Node/Bun embedding | Same as RPC without a process boundary. |
| **MCP** | Pi is an MCP **client** (consumes tools/resources) | Tool path only — **not** a wake path. Server notifications drive progress/timeouts, not model turns. |

Facts that shape the design:

- RPC framing is strict JSONL; **read stdout continuously** (a stalled reader stalls Pi); stdout is
  protocol-only, diagnostics on stderr.
- A `prompt` response means *accepted*, not *completed*; wait for `agent_settled` for "no more
  automatic work." `disposition: "handled"` means no run started.
- Extension resources start from `session_start`, **never** the factory; release from an idempotent
  `session_shutdown`.

---

## 3. Architecture overview

Three pieces; each is independently useful and the third depends on the first two.

```
                    ┌───────────────────────────────────────────────┐
                    │  durig  (single writer)                       │
   enqueue/claim/   │  owns: harness + store + queue                │
   complete/…  ────▶│                                               │
                    │   store ──▶ change trigger ──▶ wake policy    │
                    │                    │               │          │
                    │                    ▼               ▼          │
                    │            durable event feed    driver wakes │
                    │            (append-only, cursor)  (per seat)  │
                    └────────────────────┬──────────────────────────┘
                                         │  events (NDJSON / RPC)
                    ┌────────────────────┴──────────────────────────┐
                    │  subscribers                                   │
                    │   · Pi extension   → pi.sendMessage (wake me)  │
                    │   · Pi RPC client  → prompt/follow_up          │
                    │   · TUI / browser  → render                    │
                    └────────────────────────────────────────────────┘
```

### 3.1 Durable event feed (read-only, additive)

A single machine-readable stream of durig events with a **cursor**, so a late or reconnecting
subscriber resumes rather than replaying history. durig already emits NDJSON (`watch` piped;
`log --follow --json`); this is a first-class, stable-schema version of that. Proposed shape — one
JSON object per line:

```json
{"seq":12481,"ts":"2026-10-13T05:50:00.000Z","kind":"queue.enqueued","itemId":196,"to":"impl","from":"pm","subject":"…"}
{"seq":12482,"ts":"…","kind":"queue.claimed","itemId":196,"seat":"impl"}
{"seq":12483,"ts":"…","kind":"queue.done","itemId":196,"closure":"no-follow-on"}
{"seq":12484,"ts":"…","kind":"turn.streaming","seat":"impl","partial":{…}}   // NOT a turn (D40)
{"seq":12485,"ts":"…","kind":"generation.settled","seat":"impl","outcome":"done"}
```

- `seq` is the resume cursor and is monotonic over the queue transition log plus entry ids.
- `turn.streaming` is explicitly **uncommitted** and carries no entry id — a subscriber must render it
  as "streaming now", never as history (D40).
- Read-only by construction: no harness, no write path (D11, D24).

### 3.2 Resident broker (the architecture decision)

`durig serve` one long-lived process that **is** the harness (ROADMAP 38b/40a); the command name is
the `lead`'s call. It:
- observes queue transitions via the harness's **in-process** commit subscription — the cross-process
  gap in D11 only exists because readers are separate processes; a broker that owns the harness does
  not have it;
- runs the wake policy (3.3) and calls `conv.submit(...)` for the seats to wake;
- publishes the feed (3.1) to subscribers;
- survives restart without replaying a partial as history (the D40 rule generalizes).

**This revisits D11's conclusion, not its evidence.** D11's evidence (SQLite has no cross-process
notify; a separate viewer attaching a harness resumes scheduling) still holds. Its conclusion — "viewers
must read storage directly and never attach a harness" — was too strong: a single long-lived writer that
*is* the harness is the thing to build. That requires an explicit **D-entry** with the dissent, ruled by
`lead`. If the broker exposes a local socket/pipe, that is a trust boundary and needs a `security`
position before code (the security-consult rule).

### 3.3 Wake policy (what wakes whom)

Reuses `selectWakes` (`src/driver.mjs`) as the decision function; the broker changes only *when* it is
evaluated (on a real change, not a timer). Invariants to keep:

- **No wake storms.** Dedupe by `(itemId, transition)`; back off per seat; never wake a seat already
  advancing (the existing `pendingConvIds`/`busySeats` guards).
- **Stable wake text.** The wake is committed as a user entry, so it stays a fixed string
  (`WAKE_CONTENT`) — a varying body changes the conversation prefix and zeroes the prompt cache
  (ROADMAP 33). The seat learns *which* item from `claim_work`.
- **An operator stop is never resurrected** (existing `stoppedConvIds` rule).
- **A corrupt `pi.live` never kills the pass** (the P5/#110 guard already in `driveOnce`).

### 3.4 Subscribers

- **Pi extension** (piece 1): at `session_start`, open the feed; on a relevant event, call
  `pi.sendUserMessage(...)`/`sendMessage(...)` with a fixed, cache-safe string naming the event. This is
  the wake that makes the operator's Pi session react without polling. Must not fire mid-turn without
  queueing as a follow-up, and must dedupe.
- **Pi RPC client** (piece 4, alternative): drive a running Pi session with `prompt`/`follow_up` and
  consume its event stream for the feed's `turn.streaming`. `RpcClient` exists; this is integration.

---

## 4. Work breakdown and relative effort

Relative to **1× = the cheapest useful piece** (about a day). Sizes are the team's S/M/L.

| # | Piece | Relative | Touches / risk |
|---|---|---|---|
| 1 | **Pi extension subscriber** (watch the feed, `pi.sendMessage` wake) | **S · 1×** | No durig change; TS extension + a wake string. Spike-able in a day. |
| 2 | **Durable event feed** (`events --follow`, cursor) | **S–M · 1–2×** | Read-only, additive; reuses `src/readapi.mjs`. Work = event taxonomy + cursor. |
| 3 | **Resident broker** (`serve`, push + wake on change) | **M–L · 3–4×** | Reuses `src/driver.mjs`; new: resident lifecycle, change trigger, fan-out, restart. **Needs a D-entry + `lead` ruling**; `security` if a socket. |
| 4 | **Pi RPC bridge** (durig drives a Pi session) | **M · 2–3×** | New dep on `pi-coding-agent`; JSONL client + event mapping. |
| 5 | **durig MCP server** (queue tools/resources) | **M · 2×** | Additive; tool path only, not a wake. |
| 6 | **Pi as the seat runtime** (replace pi-durable) | **L–XL · 8–12×** | Rewrites seat env, `seattools.mjs`/`confine.mjs`, transcripts, queue protocol, genlock. Deferred. |

**Composition:** piece 1 alone is a valid, zero-risk first proof. The roadmap item is **2 + 3 + 1**
(optionally 4), deliverable in increments. Piece 6 waits unless the seat runtime itself is to change.

---

## 5. Unknowns to spike (each ≤1 day)

1. Does a background `pi.sendMessage()` from a `session_start` watcher reliably open a turn without
   deadlocking? (piece 1's spike answers this.)
2. Is the in-process commit subscription a sufficient change trigger, or is a sidecar needed? (D11.)
3. Injected-wake prompt-cache stability — fixed string per event class (ROADMAP 33).
4. The local socket/pipe trust boundary if the broker serves remote subscribers (`security`).

---

## 6. Next work item (the spike — start a new session here)

**Goal:** prove the wake path end-to-end, with **no durig product change**.

**Deliverable:** a small, checked, timeboxed spike (under `spikes/` or a scratch dir, never product
code) containing:
- a Pi extension that, from `session_start`, watches a durig change source and calls
  `pi.sendMessage(...)` on a matching event; and
- the durig-side trigger it watches — the existing `durig watch --once --json` poll, or `log --follow
  --json`, is sufficient for the spike.

**Proving test (falsifiable both directions):** drive a durig event (e.g. `send pm` creating a queue
item) and observe the Pi session receive an injected message and start a turn; disable the watcher and
the session receives nothing.

**Timebox:** 1 day. **Evidence:** a short note (what was run, the raw events, the injected turn), plus
the known limits found.

**Out of scope for the spike:** the broker, the feed's durable cursor, any socket, any product code.

---

## 7. Gated items (after the spike)

- **Piece 2 (feed)** — follows the spike; read-only, register with a proving test (start a subscriber,
  enqueue an item, assert the event arrives and a reconnect resumes from `seq`).
- **Piece 3 (broker)** — **gate: a `lead` ruling + a recorded D-entry** (it revisits D11's conclusion).
  Consequence in the ruling: a `security` position if the broker opens a socket. This is the item that
  retires `run`-as-a-clock.
- **Piece 4 (RPC bridge)** — only if driving an existing Pi session (rather than the extension) proves
  preferable.

---

## 8. Future improvement plans

- **MCP server** (piece 5): expose `claim_work`/`complete_work`/queue resources so any MCP client can
  read and route durig work. Complements the feed; does not replace the wake.
- **Pi as the seat runtime** (piece 6): only if the decision is that seats should be full Pi sessions.
- **Browser/multi-viewer client**: the feed (piece 2) is the enabling layer for the TUI client in
  `docs/UI-TUI-INITIAL-THINKING.md`; a browser would then be "just another subscriber."
- **Self-driving loop end-state:** `durig serve` runs resident; `run` becomes a client of it or is
  retired; the queue advances with no external clock.

---

## 9. References

- durig: `src/driver.mjs` (`selectWakes`, `driveOnce`, `WAKE_CONTENT`), `src/readapi.mjs`,
  `src/viewmodel.mjs` (`buildTurns`, `partialView`), `cli.mjs` (`cmdRun`, `cmdWatch`, `cmdLog`),
  `src/genlock.mjs`.
- decisions: D11 (watch polls storage), D21 (CLI stays non-interactive), D24 (measures read-only),
  D40 (a partial is not a turn); ROADMAP 33 (prompt-cache stability), 38 (self-driving queue),
  40 (live streaming / resident server).
- Pi docs: `pi-coding-agent/docs/rpc.md`, `json.md`, `extensions.md`, `mcp.md`, `sdk.md`.
