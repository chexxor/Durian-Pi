# durian-pi on pi-durable — how we build on the harness

**Purpose.** A durable account of how durian-pi uses `@earendil-works/pi-durable`, for three audiences:
future maintainers of durian-pi (what is the harness's job vs. ours), the operator (where the seams are),
and **pi-durable's own maintainers** (which of their mechanisms we depend on, and what we add around
them). The investigative version with evidence and line-level citations is
`docs/reviews/pi-durable-alignment.md`; this is the stable summary.

**Pin.** durian-pi validates against `earendil-works/pi@4954d760` (`@earendil-works/pi-durable` 1.3.0),
recorded in `pi-main.pin.json` and built/linked by `scripts/sync-pi.mjs`. pi-durable moves fast and
renames APIs between releases; the pin is the contract, not `main`.

## 1. The split, in one paragraph

**The harness owns durable agent state; durian-pi owns the team and the operator.** A *seat* is a
pi-durable conversation with an agent (model, tools, `cwd`); the *transcript*, the *partial* (`pi.live`),
and *documents* are committed by the harness atomically. durian-pi adds the things the harness has no notion
of: a **shared cross-conversation work queue** with provenance and permissions, a **broker** that wakes
seats and supervises them, **per-item worktrees**, a **cross-process generation bound**, and the
**operator surface** (a JSON CLI and a TUI). Nothing durian-pi persists bypasses the harness: durian-pi writes
one storage opener's worth of documents and entries and runs no SQL of its own.

A clarification that prevents a common confusion: pi-durable is a **library**, not a service. It
supplies the rule that one process owns a storage at a time; the process that calls `Harness.open` is
the owner. durian-pi designates the broker as that long-lived owner — see
`docs/COMMANDS-AND-THE-BROKER.md` §§1–2 for the full ownership and multiplayer picture.

## 2. Concept map — who owns what

| durian-pi concept | pi-durable concept | Owner | Where |
|---|---|---|---|
| Seat | conversation + per-conversation agent | harness (agent config: adopting) | `src/rig.mjs` `Seats`, `src/seatmodel.mjs` |
| Seat transcript | conversation entries | harness | `src/rigstory.mjs`, `src/readapi.mjs` |
| Streaming text / tool output | `pi.live` (committed throttled partial) | harness | `src/viewmodel.mjs` `partialView` |
| Work queue (`RigQueue`) | a dynamic document + durian-pi's own status machine | **durian-pi** | `src/rig.mjs` |
| Org edges / capability tags | nothing (ownership is *not* access control) | **durian-pi** | `src/rig.mjs` `Edges` |
| Constitution | a system-prompt section | harness renders it; durian-pi supplies it | `src/rig.mjs` |
| Wake loop / broker | none (the harness runs conversations, not a queue) | **durian-pi** | `src/broker.mjs`, `src/driver.mjs`, `src/scheduler.mjs` |
| Generation bound | none (the harness imposes no seat limit) | **durian-pi** | `src/genlock.mjs`, `DURIAN_PI_MAX_CONCURRENT_SEATS` |
| Per-item worktree | per-conversation `cwd` / execution env | mechanism harness, lifecycle durian-pi | `src/worktree.mjs` |
| Operator, CLI contract, docs gates | nothing | **durian-pi** | `cli.mjs`, `docs/` |

## 3. The harness surface durian-pi uses

Imports (one storage opener; no direct SQL):

- `Harness`, `configure`, `defineDoc`, `defineExtension`, `defineTool`, `section`, `hook`, `ToolTask`,
  `AssistantEntry`, `AgentDoc` from `@earendil-works/pi-durable` (`src/rig.mjs`, `cli.mjs`).
- `openNodeSqliteStorage` from `@earendil-works/pi-durable/storage/sqlite/node` (the one opener).
- `NodeExecutionEnv`, and `ExecutionError`/`FileError`/`err`/`ok` from `/env/node` and `/env`
  (`src/seatguard.mjs`).
- `BACKGROUND_CONTEXT` from `@earendil-works/chord/context` (every call takes a context).

Calls durian-pi makes:

| Surface | durian-pi use |
|---|---|
| `Harness.open(storage, { models, registry, env }, ctx)` | the broker and every non-viewer entrypoint (`cli.mjs` `openHarness`) |
| `harness.documentState(Doc, …)` | read `Seats`, `Edges`, `Constitution`, `RigQueue` |
| `harness.commit(tx => …)` + `configure(tx, convId, { model, tools, cwd })` | atomic doc+entry writes; seat agent config |
| `harness.conversation(id)` / `root` / `createConversation` | seat and reviewer conversations |
| `conv.submit({ type: "input", content, requestId })` | wake a seat; operator intent; exactly-once retries |
| `conv.waitForIdle` / `harness.waitForIdle` | the pass wait and the F11 drain on loop exit |
| `conv.entries` / `harness.inspect()` | read a seat's history; see pending submissions |
| `conv.reset(handoff)` | the reset/degeneration boundary (D64) |
| `harness.abortSubmission` / `harness.abortTask` / `conv.abort` | cooperative stop (F35), `serve --stop` |
| `harness.subscribeCommits(publication)` | **the broker's completion-event stream** — the reason the loop is event-driven, not a poll (D45) |
| `defineDoc` | durian-pi's dynamic documents on the harness's document engine |

The TUI is the one surface that does **not** use a harness call today: it reads storage directly and
polls (D11). Section 6 says why that is changing.

## 4. What durian-pi adds on top, and why

- **Router tools** (`send_work`, `claim_work`, `complete_work`, `defer_work`, `resume_work`) are a
  **pi-durable extension** installed into the registry (`src/rig.mjs`), so a seat's queue moves are
  ordinary tool calls — no side channel.
- **The work queue** is a dynamic document with `from`/`to`, a status machine
  (`queued → claimed → done`, plus `deferred`/`held`), transitions, and provenance. The harness's
  `pi.inbox` is per-conversation ordered input; it cannot carry a cross-conversation work log.
- **Org edges and capability tags** gate who may send to whom. The harness deliberately has no access
  control (the spec: ownership is not a capability).
- **The broker** (`serve`) is the single storage owner and the team's scheduler/supervisor. The harness
  runs conversations; it does not decide *which* seat to wake for which queued item. That is durian-pi's
  `selectWakes`/`drivePass`/`runWakeLoop`, driven by the commit subscription.
- **Per-item worktrees** isolate filesystem work so two seats cannot clobber each other; the harness
  supplies the `cwd` mechanism, durian-pi owns create/remove policy.
- **Cross-process generation slots** (`genlock`) bound paid provider streams — a cost bound the harness
  does not impose.
- **The operator surface**: `cli.mjs` is a non-interactive JSON contract (D21); `ui.mjs` is the live TUI;
  docs gates and the rig file are durian-pi's.

## 5. Where the harness is the source of truth (do not reimplement)

- **The partial is not a turn.** `pi.live` is committed throttled state; durian-pi's D40 rule (render the
  in-flight partial in its own labelled row, never persist it as an entry) already matches.
- **One storage owner; many clients.** This is the harness's rule (the README: "One process owns a
  storage at a time; there is no cross-process locking"). durian-pi's broker-holder file enforces it; the
  failure when two owners share a store is the F24 collision (`ID n already belongs to entry`).
- **Agent config belongs on the conversation**, because the harness commits it atomically and restores
  it on reopen (example `28-reviewer.ts`). durian-pi stores role/goal/capabilities in its own `Seats` doc
  and is moving model/tools/`cwd` onto the conversation (roadmap 57).
- **Task checkpoints, abort, and recovery** exist; durian-pi's reset/degeneration guard should map onto them
  rather than grow a parallel lifecycle (roadmap 58, investigate).

## 6. Known gaps and planned alignment

The alignment review's verdict: durian-pi reimplements exactly **two** harness-provided mechanisms — client
state delivery (the TUI poller) and busy-conversation input (await-and-hold) — and correctly keeps the
rest. The backlog is `docs/ROADMAP.md` §"pi-durable alignment" (items 51–58):

- **52** — attach the TUI as a state-backed client (`viewState().subscribe()` in-process first, then
  `watchEvents()`), replacing the 700 ms poll; keep the poller as fallback.
- **54** — `drivePass` **wake-and-return**: stop awaiting woken runs inside the tick; let the commit
  subscription drive the next pass; keep one global `waitForIdle` on exit.
- **55** — a `security.sec` position **before** any attach socket (D45's own gate).
- **56** — `whenBusy: "steer"` for operator text; decide the spool's remaining job.
- **57** — per-conversation agent for seat config.
- **58** — investigate task checkpoints and map the reset/degeneration guard.

Open questions we have not settled: whether the pin should be a release rather than a sha; what the
intent spool is *for* once the TUI attaches; and the operator's text having two records (`pi.inbox` plus
durian-pi's queue).

## 7. Notes for pi-durable maintainers

**What would break durian-pi if it changed** (all at the pin): the `Harness`/conversation method shapes
listed in §3; `defineDoc` and the dynamic-document read/commit shape; the `subscribeCommits`
publication shape (the broker's scheduler classifies it); the `pi.live` document shape (`src/viewmodel.mjs`
reads generation/message/tool slots); the submission record shape from `harness.inspect` and
`scanSubmissions`; `configure` field names; `conv.reset` semantics.

**How we track you:** `pi-main.pin.json` records the validated commit and `scripts/sync-pi.mjs` builds
and links it. We build from source because renames land on `main` quickly; a released version with a
dist-tag would let us stop pinning a sha (an open question for us and, if it matters to you, for you).

**What we would value upstream** (framed as feedback, not asks): a first-class way for a separate
process to *attach* to the owning harness's view without hand-rolling a socket (we are gating our TUI
client work on a security position because of this); and, if the shared cross-conversation work-queue
pattern recurs across applications, a documented primitive or recipe for it — we built `RigQueue` on
`defineDoc`, and it is the largest thing we maintain outside your model.

## 8. References

- `docs/reviews/pi-durable-alignment.md` — the evidence-bearing gap analysis (pinned framework; durian-pi
  read from `main` on 2026-10-16; its §9 lists what was not verified).
- `docs/BROKER-ARCHITECTURE.md` — the broker as an actor system.
- `docs/ROADMAP.md` §"pi-durable alignment" — items 51–58.
- `docs/REVIEW-pi-durable-demos.md` — what the two pi-durable example projects show.
- Upstream: the pi-durable post `https://earendil.com/posts/pi-durable/`; the spec and examples at the
  pinned commit, `packages/durable/docs/spec.md` and `packages/durable/test/examples/`.
