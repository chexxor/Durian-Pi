# durig — research log

Primary comparative research lives in `../../docs/ORCHESTRATION-COMPARISON.md`
(feature matrix F1–F12 across OpenRig, agent-fleet+pi-durable, tuios,
hermes-agent; augmented-stack variants V1/V2; spike execution log). This file
records durig-specific findings made while building it.

## Spike findings (offline, faux provider)

- **S1 — delegation round-trip works on PD substrate.** Parent conversation's
  model emits a tool call; the tool creates a task-owned child conversation
  via `tx.createConversation({ownership:{kind:"task",taskId:api.taskId}})`
  (the recipe pi-durable's README documents); child answers; result returns.
  Proven in `../demo/offline.mjs` with assertions.
- **S2 — scripted responses drain in global call order** across
  conversations sharing one provider. Encoded as a documented constraint in
  demo headers; bit us once (child consumed the parent's scripted frame).
- **S3 — persisted-storage runs need `harness.resume()`** after open to
  re-arm task scheduling (pi-durable blog restart recipe). Without it, CLI
  sends sat unanswered with no transcript entry.
- **S4 — agent model must be set via `configure(tx,id,…)`** after
  conversation creation; inline agent options at creation did not resolve.
- **S5 — Model entries must carry provider+baseUrl explicitly**, else
  streams fail with `Unknown provider: undefined`.
- **S6 — pi-ai exports the openai-completions implementation at
  `@earendil-works/pi-ai/api/openai-completions`**, not as a top-level named
  export (despite README examples suggesting otherwise).

## Real-model findings (DeepInfra, Qwen/Qwen3-32B)

- **R1 — durable error surfacing enables self-correction.** The model first
  routed to a nonexistent seat; the tool's model-readable error let it
  recover and route correctly within the same run.
- **R2 — repeat-call edge:** a second `claim_work` in one invocation hit
  `Cannot use a settled overlay` (PD doc-overlay restriction). Model
  recovered; logged as robustness work: tools should return current state on
  repeat calls instead of erroring.

## Framework config-schema survey (source-verified)

| Framework | Format | Fields verified in source |
|---|---|---|
| CrewAI | Python ctor / YAML | `role`, `goal`, `backstory`, `tools`, `allow_delegation` (crewAI/lib/crewai/src/crewai/agents/agent_builder/base_agent.py) |
| MetaGPT | Python Role class | `name`, `profile`, `goal`, `constraints` composed into prompt prefix (metagpt/roles/role.py) |
| GitHub Agents | Markdown + YAML frontmatter | `name`, `description`, `tools` (aliases + mcp-servers); prompt = file body (docs.github.com custom-agents-configuration) |
| OpenRig | rig.yaml | agents with role/skills/model/guidance/delegates_to; pods grouping |

Conclusion informing D9: durig v2 adopts CrewAI/MetaGPT field names for the
persona layer so migration from either is mechanical; OpenRig gets a dedicated
converter (`../scripts/from-openrig.mjs`) since that is our incumbent.

## Core_Ideas.txt layer mapping

Six layers from the operator's research digest map to durig as:
identity/persona → rig.json persona fields + compilePersona;
skills/capabilities → PD per-conversation tools + capability tags;
role/org position → Seats doc + Edges doc; culture → Constitution doc +
section injection; collaboration rules → queue semantics + edge gate;
topology/workflow → flat seats now, PD task graph reserved for SOP workflows.
Explicitly deferred: constitutional-evolution search, Big-Five injection,
FIPA-ACL performatives, Contract-Net auctions, dynamic persona generation,
blackboard architecture (rationales in DECISIONS.md and session notes).

## Fleet-state presentation: how comparable systems show "who is doing what"

Surveyed before making `watch` human-readable, because the layout decision is
about operator reading habits, not about durig's internals.

| System | Per-agent unit | What it shows | Source |
|---|---|---|---|
| AgentsRoom | one card per agent in a grid | name, role label, status (active/idle/done/error), live terminal preview; "one column per state", blocked agents first | agentsroom.dev/multi-agent-dashboard (vendor page) |
| OpenRig TUI | attention feed item | kind (`action`/`update`), summary, recipient, `unblocks`, scope, timestamp, and per-source availability ("some sources unavailable or partial") | `vendor/openrig-thomas/packages/tui/src/attention/attention-model.ts` (`attentionLines`) |
| AgentsRoom local API | versioned JSON on 127.0.0.1 | explicitly exists so a tmux line or personal TUI can poll it every second | same vendor page (Local status API) |

Conventions adopted for `watch` (all verifiable in `src/watchview.mjs`):

1. **Per-seat row, stable column order**: identity (name + role) left, activity
   right. Both neighbours above do this; it is what makes a fleet scannable.
2. **Status as a glyph plus a word**, derived only from state durig already
   computes (`computeAttention`, slot notices) — the view never re-derives
   health, so it cannot disagree with `status`.
3. **The verb matches who holds the work**: `working on` / `has … queued` /
   `sent …`. An early draft rendered every non-done item as "awaiting", which
   read as false for the seat that had just routed it.
4. **Say what the seat said.** Both neighbours surface live output rather than a
   status word alone; the transcript entry text is the closest analogue we have
   without resuming the harness.
5. **Never show a quiet-looking empty rig.** OpenRig marks an incomplete feed
   explicitly; durig prints "No seats in this database" with the way out,
   matching the stderr guardrail added for the same failure mode.
6. **Keep the machine contract machine-readable.** AgentsRoom exposes JSON
   purely so external observers can consume it; durig keeps NDJSON as the
   default whenever stdout is not a terminal, with `--json`/`--human` to force.

Findings that changed the implementation (both measured, not assumed):

- Transcript text is reachable from **storage alone** via
  `storage.scanEntries({conversationId, order:"descending"}, …)`, so a watcher
  can show what a seat said without opening a harness — which matters because
  opening one resumes scheduling (D11).
- A "submission" records a submitted **input**, so it does not move when
  assistant turns are appended. Observed live: entries grew 2 → 5 while the
  newest submission id stayed at 19. Caching seat summaries against that signal
  pinned the first empty reading forever; the cache was removed.

## Live delivery of seat activity: can we (and should we) push instead of poll?

Context: a viewer wants a seat's conversation as it is generated. Durig has no
terminal per seat — a seat is a conversation row in one SQLite file — so the
question is only how a *second process* learns that new entries landed.

**SQLite provides no cross-process notification.** The official position: "If you
need cross process notification, you will either have to implement this yourself
or poll pragma user_version" (sqlite.org forum, post 2a3c3c9d97); `update_hook`
and `preupdate_hook` fire only inside the process doing the write
(sqlite.org/c3ref/update_hook.html). So `watch` and `log --follow` poll, which is
the honest mechanism, not a shortcut.

Options surveyed for replacing that poll, none adopted yet:

| Tool | Mechanism | Note |
|---|---|---|
| `PRAGMA data_version` | per-connection token that changes when another connection commits | cheapest correct poll; no dependency |
| Honker (russellromney/honker) | SQLite extension + bindings giving Postgres NOTIFY/LISTEN, durable pub/sub and queues; internally a `data_version` read every 1 ms | no daemon/broker, but needs a loadable extension and shipped binaries; **Windows support unverified** |
| tailite | reads the WAL from outside, emits every committed insert/update/delete with before/after as JSON Lines | Rust binary, WAL-mode only, app unchanged |
| sqlite-change-stream | same idea in Go, JSON events on stdout | small |
| wiremonitor | reads a local SQLite DB read-only and streams new rows to a browser over **SSE** | closest end-to-end precedent for a remote viewer |
| Datasette | instant read-only JSON/HTTP API over any SQLite file | covers "query the latest state", not push |
| Litestream | continuous replication to object storage | durability/backup, not a live client feed |

For presentation beyond a terminal, **SSE** is the right primitive (one-way,
auto-reconnecting); WebSocket only if the viewer must also write back. For a
richer TUI, the maintained Node options are Ink and OpenTUI (Zig-backed, used by
the OpenCode coding agent), with Bubble Tea (Go), Ratatui (Rust) and Textual
(Python) elsewhere.

Also considered from our own stack: pi's **RPC mode** (`pi --mode rpc`) runs pi
as a long-lived subprocess speaking JSONL commands in and a full session event
stream out, with `--resume` plus a session picker for history. That is a
ready-made subscribe-to-the-thread channel — but it applies to *pi CLI sessions*,
not to durig's in-process pi-durable conversations. It becomes relevant only if
a seat were re-implemented as a pi subprocess, which is a separate architecture
decision, not a viewer feature.

## Formatting a transcript: what the agent TUIs converged on

Surveyed before restyling `log`, using the twelve-CLI comparison at
github.com/LukasParke/tui-patterns (point-in-time 2026-08-28, primary evidence per
tool) plus pi's own theme vocabulary.

**The load-bearing divide is scrollback vs alternate screen.** Of twelve tools:
4 hybrid, 4 alternate-screen, 2 line-based REPL, 1 inline. Alternate screen solves
flicker but "amputates the terminal" — native scrollback, search and select-to-copy
all break, and the complaint threads are the loudest in the dataset. The field's
open problem is that *nobody has both*. Durig sits deliberately at the REPL end:
`log` writes to stdout and leaves scrollback, pipes and log files alone. That choice
is why the format is line-oriented rather than a repaint.

Conventions adopted (each traceable in `src/chatview.mjs`):

| Pattern | Evidence | How durig does it |
|---|---|---|
| Transcript is borderless | borderless in all 12 tools; Cursor removed its diff boxes | no boxes; one glyph and a narrow gutter |
| Dim is the workhorse | Claude Code "dim-heavy", Codex builds hierarchy from bold/dim/indent | clocks, deltas, connectors and tool results are dim; the seat's words are uncoloured |
| Tree connector under a one-line header | `⎿` (Claude Code), `└` (Codex/Copilot), `↳` (Droid/OpenCode) | `⚙ name(args) ✓` header, `⎿` continuations |
| Truncate with a pointer, never silently | every tool caps output *and* names the escape hatch | `⎿ (N more lines — --full to expand)` |
| Never encode success in hue alone | Codex bans blue/yellow/white; Copilot ships a colourblind mode | `✓`/`✗` differ in glyph, not just colour |
| Tool backgrounds are a theme token | pi: `toolPendingBg`, `toolSuccessBg`, `toolErrorBg` | opt-in `--tool-bg` with `--theme dark\|light`, because a hard-coded tint misreads on an unknown background |
| Collapsible tool output is wanted | Claude Code CLI ships fully expanded and has open requests for collapse (#51233, #32555) | collapsed to one line by default, `--full` expands |

**Turn grouping.** The unit is a turn, not an entry: an operator message, an agent
message, or a tool call *with its output*. A call and its result are one act of work
that the raw log splits across two entries (`toolCall` parts live inside the
assistant message; the result arrives later, correlated by `toolCallId`), so they
share one timestamp. Measured on a real transcript: stamping every entry put four
near-identical `01:31:15` rows in a row.

Not adopted, with reasons: alternate screen (breaks scrollback and tmux, and tmux
defeats every rendering strategy in the dataset), spinners and shimmer (a REPL has
nothing to repaint), and hard-coded brand palettes (Crush's light-mode issue has
been open since July 2025).
