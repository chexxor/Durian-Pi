# The TUI poll is the wrong shape — attach the viewer to pi-durable's change stream (implementation reference)

*Delegate design/research note, 2026-10-19. Audience: the implementing seat (`impl`/`devtools`) and its
verifier. This is analysis + references, not code. It folds into ROADMAP items 52/55 and the durable-TUI
Phase 2 (attach) work — read this together with `docs/reviews/pi-durable-alignment.md` (§2, §8) and
`.spike/durable-tui/HANDOFF.md`; this note exists to give the implementer the exact references and the
measured problem, not to restate those.*

---

## 1. The problem, measured

`node ui.mjs` / `npm run ui` is slow to start and responds in multiple seconds. Measured on
2026-10-19 (host `C:\Users\Alex\dsh-Projects\pi-opendurig`, broker up):

| Measurement | Value |
|---|---|
| Module import (startup) | **748 ms** |
| One broker-routed read (`readData`) | **204–1005 ms** (n≈5) |
| One poll tick (`health` + one `live` read per seat, 11 seats, sequential) | **8318 ms** |
| First frame | import + first tick ≈ **~9 s** |
| Key-press response | up to one whole tick, ~8 s |

**Why:** `src/tui/readstate.mjs` builds the frame by issuing **one `health` read and then one `live`
read per seat, sequentially** (`:41`, and the `for` loop at `:62`). Every one of those is a separate
**broker-spool round-trip** (`src/readclient.mjs` `readData` → `readViaBroker` writes an `op:"read"`
intent and polls the result file; `src/broker.mjs:290-303` `awaitIntentResult`, 200 ms interval). So a
tick is ~12 serialized round-trips. The renderer's draw loop is therefore **contingent on the timing of
an external system** — the broker's idle-loop turn — which is the anti-pattern the operator named.

`#2321` (landed `main d058e0a`) removed the *worst* consequence (a read no longer forces a full wake
pass), but each read is still its own round-trip, so the latency stands.

---

## 2. Why the poll exists (do not naively "fix" it by opening the store)

`src/readclient.mjs:1-11` is explicit: pi-durable allows **ONE owner per process**; the broker is
durian-pi's owner; `SqliteStorage.document()` takes `BEGIN IMMEDIATE` for a read, so a second opener
contends with the broker's write lock and can poison its session (`SessionFailed` — the wedge we have
been fighting). That is why `ui.mjs` is a *client* of the broker through the command spool (D11), and
why `readLocal` is only used when **no** broker is alive. Any fix must keep the UI off the store.

---

## 3. How pi-durable's own apps manage state: **push, not poll**

All under `node_modules/@earendil-works/pi-durable/` (version `1.3.0`). Runnable examples live in
`test/examples/`.

### 3.1 The APIs

- **`root.viewState(context)`** → `AttachedReplicatedState<ConversationView>`, a read-only Chord state
  updated after every commit. Subscribe once; repaint on callback.
  - Source: `src/harness/harness.ts:161`. Types: `src/harness/view.ts` (`ConversationView`,
    `ViewObserver`, `ConversationViews`, `conversationViews(harness)`).
  - README §"Watching a Conversation" (lines ~378-392):
    ```ts
    const view = await root.viewState(context);
    view.subscribe((value) => { render(value); }); // value.entries, value.docs["pi.live"], pi.inbox, pi.usage, pi.agent, pi.provider
    // later: view.dispose();
    ```
- **`root.watch(context)`** → `ConversationWatch`, same view **plus the exact Chord operations of each
  commit**, delivered one callback at a time.
  - Source: `src/harness/harness.ts:165`.
  - README §"Watching a Conversation" (lines ~393-404):
    ```ts
    const watch = await root.watch(context);
    render(watch.value);                    // state at attachment
    watch.start(async (value, ops) => await send(ops)); // "for example to a remote client that applies them"
    // later: await watch.stop();
    ```
  - **Backpressure is built in:** "A slow watch keeps at most 100 undelivered frames. After that, the
    pending frames are replaced by one frame holding the whole newest view… nothing is replayed." This
    is exactly the "slow UI must not queue work" property `ui.mjs` lacks.
- **`watchEvents(harness, root.id, context)`** → an `AgentEvent` stream (not the structural view).
  - Source: `src/harness/events.ts:166`. README ~line 499.
  - The `.spike/durable-tui` adapter bridges this to the coding-agent event vocabulary
    (`src/bridge.mjs`), per `HANDOFF.md` §3/§6.
- **`harness.watchTaskGraph(context)`** (`src/harness/harness.ts:326,327`) and
  **`harness.watchDoc(token, id, context)`** (`src/types.ts:917`, harness `watchDoc`) — the same push
  shape for the task graph and a single document.
- **Partial cadence:** partial answers/tool output commit **at most every 100 ms** by default;
  `settings.progress` (`{ partialIntervalMs, outputIntervalMs }`) tunes it (README ~line 406). This is
  the *right* clock — the model's commit cadence, not a UI poll.

### 3.2 The examples to read

- **`test/examples/05-watches.ts`** — minimal `watchDoc` subscribe/update/stop. Comment: "Slow callbacks
  never overlap; exact committed frames buffer, with a full-value reset after 100."
- **`test/examples/21-late-join.ts`** — **the closest match to our case.** A client attaches while a run
  is underway: "It gets the current state first, the conversation view or the snapshot event, and then
  only what changes after that." Shows both `viewState().subscribe()` (structural) and `watchEvents()`
  mid-run; includes the running tool's partial in `pi.live`.
- **`test/examples/14-chat.ts`**, **`19-json.ts`**, **`test/chat-support.ts`** — snapshot/stream shape.
- README §"Watching a Conversation" and §"Busy Conversations" (`pi.inbox`, `whenBusy`).
- README example index (line ~737+) lists all examples; **21** is labeled "Attaching a view and an event
  stream mid-run."

### 3.3 What our own spike already proved (`.spike/durable-tui/`)

`HANDOFF.md` (read it) is the repo's working precedent:
- Architecture (§3): `Harness ── viewState() ──► transcript/pi.live/pi.inbox/pi.agent/pi.usage` and
  `Harness ── watchEvents() ──► AgentEvent stream ──► DurableEventBridge`. "State comes from durable
  `viewState`; events come from `watchEvents`."
- §6.1 non-obvious fact: **"Chord delivers state before events"** — `ConversationViews.advance()` runs
  every observer's `advance` (state) before every observer's `publication` (events), so `viewState` is
  current before the `watchEvents` batch for the same commit. The adapter relies on this ordering.
- §7 explicitly names our gap: "the 'one surface that does not use a harness call today' is the TUI
  poller (D11)", citing `docs/PI-DURABLE-INTEGRATION.md`.
- §8.1.3 **the process-model decision this note addresses:** "The spike runs harness + TUI in one
  process. durig's TUI must **attach** to the broker-owned store over `viewState`/`watch` (not open
  it), gated by the security position (ROADMAP 55)."
- §8.3 upstream ask and §9 limitation: "Single process; no attach protocol."
- Reusable code to mine: `.spike/durable-tui/src/bridge.mjs` (event translation),
  `src/adapter.mjs` (runtime host / Proxy facades), `README.md` (interface inventory + mapping tables).

---

## 4. The design: the broker is the watch owner; the UI is a delta-applying client

Because pi-durable is one-owner-per-process and the **broker** owns the store, the broker — not the UI
— must hold the subscription. Then the broker serves clients from that live view. Two stages, matching
ROADMAP 52 exactly:

### Stage 1 — in-process subscriber (no socket, no new trust boundary) — ROADMAP **52**
- In the broker process (`cli.mjs cmdServe` → `runWakeLoop`; the broker already opens the Harness via
  `openHarness()`, `cli.mjs:343,367`), attach **once**:
  - `harness.watchTaskGraph(context)` for the task/seat view, and
  - per-conversation `root.viewState(context).subscribe(value => snapshot.set(seat, value))` (or
    `harness.watchDoc` for specific docs), maintained as an in-memory snapshot.
- The broker's existing read dispatch (`src/brokerread.mjs:51 dispatchRead`, views `seats`/`queue`/
  `roots`/`health`/`live`/`entries`/`feed`/`document`/`exhausted`/`older`) is served **from the
  snapshot** instead of re-scanning storage per request. That alone kills the 8 s tick: `readstate.mjs`
  stops costing 12 store scans; each read intent is answered in memory.
- This keeps today's request/response spool (D68) as the transport — **no new trust boundary**, so it
  can land before the security position.

### Stage 2 — remote push/attach — needs ROADMAP **55** first
- The broker fans committed frames/deltas out to the UI over an attach channel (the `watch`/`watchEvents`
  ops the README says are for "a remote client that applies them"), so the UI **renders on push** and
  no longer polls at all. This is the true "draw loop is driven by state change" fix.
- Late join: on attach the client gets the **current** view, then only deltas (example 21).
- Backpressure: reuse durable's own 100-frame collapse; the UI must never queue unbounded frames.
- Fallback: keep the poller exactly as the existing documented fallback (ROADMAP 52 / D11).

### Transport options for Stage 2 (implementer decides with `lead`/`security`)
1. **Named pipe / Unix-domain-style socket** served by the broker, one JSON frame per line, framed by
   Chord ops. Native on Windows is a named pipe (`\\.\pipe\...`).
2. **Append-only frame file the client tails** (e.g. `<db>.broker.frames`) with a sequence cursor —
   avoids a socket/listener and reuses the file-based spool discipline already in place; still needs a
   security position because it is a new read surface.
3. **Spool long-poll** ("changes since seq" result) — least new surface, still request/response, so it
   does not fully invert control; only a stepping stone.
   Recommendation: **Stage 1 first** (immediate, gate-free, big win), then choose 1 vs 2 for Stage 2
   with `security`; do not skip the security position (ROADMAP 55 is a hard gate: "adding a socket
   requires a security position *before code*", D45).

### Safety invariants to preserve
- **Never** open the store from the UI (`SessionFailed` other case). Only the broker is an owner.
- **D40:** a streamed partial is never persisted/rendered as a committed turn; it shows in the streaming
  row only.
- **D21:** `cli.mjs` stays non-interactive; the attach surface is `ui.mjs`/TUI-only.
- **D68:** the intent spool remains the write path (and, after attach, the out-of-process substrate).
- The single-writer/genlock guards must not be weakened; no second store opener, no new write path.

---

## 5. Acceptance criteria (a verifier will re-run these)

1. **Late join / mid-run attach** (mirrors `21-late-join.ts`): attach while a seat is generating; the
   first frame already shows the running partial, then deltas arrive; **no partial becomes a committed
   entry** (D40).
2. **Draw loop is not poll-timed:** with the attach path active, a state change repaints within the
   commit cadence (≤~100 ms) **without** a fixed-interval store read; and a slow UI drops to the newest
   frame (the 100-frame collapse), never queues unbounded frames.
3. **No second store owner:** the UI process opens no sqlite handle; assert no `SessionFailed` on the
   broker while the UI runs (the exact failure this guards against, `src/readclient.mjs:1-11`).
4. **Stage 1 latency:** one `health`+all-`live` tick served from the broker snapshot completes in
   **single-digit ms–low tens of ms**, not ~8 s; measured before/after.
5. **Fallback intact:** with no broker / attach unavailable, the existing poller still works (D11).
6. `node --check` clean; the full `demo/*.test.mjs` loop green; non-author verify (`qa`/`auditor`).

---

## 6. Dependencies, sequencing, open decisions

- **ROADMAP 55 (security position) is a hard prerequisite for Stage 2.** The in-process Stage 1 needs
  none (ROADMAP 52). `docs/runbooks/security-trust-boundary-review.md` is the runbook.
- **Scope decision already ruled:** ROADMAP 52 is "Adopt, gated by 55"; the durable-TUI plan's Phase 2
  (#2097) is the attach phase; Phase 1 (#2096) is the non-default entrypoint on its own store.
- **Open:** transport choice (socket vs frame-file) — decide with `lead`+`security`; whether the UI
  keeps any poll at all in Stage 2; how the snapshot interacts with the broker's existing probe reads
  on the separate connection (the `#1587` part-4 contention residual) — Stage 1 should *reduce* those
  reads, not add.
- **Do not** try to "just parallelize" `readstate.mjs` as the fix; it is a short-term band-aid and still
  leaves reads poll-timed (see §1). It may be a useful interim, but the deliverable is Stage 1 → Stage 2.

---

## 7. References (all verified this session)

**pi-durable (v1.3.0), `node_modules/@earendil-works/pi-durable/`:**
- `README.md` §"Watching a Conversation" (viewState/watch/backpressure, ~378-406); §"Busy
  Conversations"; example index (~737+).
- `src/harness/harness.ts:161` (`viewState`), `:165` (`watch`), `:326-327` (`watchTaskGraph`).
- `src/harness/view.ts` (`ConversationView`, `ViewObserver`, `ConversationViews`, `conversationViews`).
- `src/harness/events.ts:166` (`watchEvents`); `src/harness/live.ts`, `compaction.ts`, `task-graph.ts`.
- `src/types.ts:917-953` (`watchDoc`, commit/tx read rules).
- `test/examples/05-watches.ts`, `test/examples/21-late-join.ts`, `test/examples/14-chat.ts`,
  `test/examples/19-json.ts`, `test/test/chat-support.ts` (as referenced by README).

**Our repo:**
- Problem: `src/tui/readstate.mjs:41,62`; `src/tui/driver.mjs:55-101` (pollMs default 700, tick coalesce);
  `ui.mjs:104-140` (`pollMs: 700`, `makeReadState`).
- Poll plumbing: `src/readclient.mjs` (`readData`/`readViaBroker`/`readLocal`, and the one-owner
  rationale at `:1-11`); `src/broker.mjs:290-303` (`awaitIntentResult`), `:335` (`SPOOL_OPS` includes
  `"read"`), `:172` (`writeIntent`); `src/brokerread.mjs:51` (`dispatchRead` and its views);
  `src/readapi.mjs` (`readSeatList`/`readQueueItems`/`readLiveState`/`readRigHealth`).
- Broker owner path: `cli.mjs:343` (`openHarness`), `:367` (`Harness.open`), `cmdServe`/`runWakeLoop`.
- Design/spike docs: `docs/reviews/pi-durable-alignment.md` (§2, §8); `docs/reviews/durable-tui-merge-plan.md`;
  `docs/reviews/durable-tui-gap-analysis.md`; `docs/reviews/durable-tui-phase1-build-spec.md`;
  `docs/reviews/tui-streaming-research.md` (poll/jank pitfalls, §"Blocking/event-loop hazards", scaling
  cliff at 50 seats/10k turns); `.spike/durable-tui/HANDOFF.md` (§3 architecture, §6.1 state-before-
  events, §7 gap, §8.1.3 attach, §9 limitations).
- Decisions/roadmap: `docs/ROADMAP.md` items **52** (attach; in-process first, gated by 55) and **55**
  (security position before any attach socket); `docs/DECISIONS.md` D11 (viewers read storage, no
  harness), D21, D40, D45 (socket ⇒ security position first), D68 (intent spool);
  `docs/PI-DURABLE-INTEGRATION.md` (names the TUI poller as the one non-harness surface);
  `docs/runbooks/security-trust-boundary-review.md`.
- Related evidence: `docs/incidents/2026-10-19-worktree-carry-teardown-collision.md` (worktree hygiene,
  context only).

**Measured this session (repro commands):**
- Tick: `readData("./selfdev.sqlite","health",…)` then one `readData(…,"live",{conversationId})` per
  seat sequentially → `total tick ms: 8318` (11 seats; `health ms: 656`).
- Single read: 204–1005 ms. Module import: 748 ms.
