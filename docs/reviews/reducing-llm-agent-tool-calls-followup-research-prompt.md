# Research request — reducing agent round-trips in a durable multi-seat rig (follow-up)

**Ask:** hand this to the operator's research agent. Report to
`docs/reviews/reducing-llm-agent-tool-calls-followup.md`.

This is the **follow-up** to `docs/reviews/reducing-llm-agent-tool-calls.md`. That first pass answered a
generic question well at the survey level but is **not grounded in durig**: it assumes a stateless
request/response agent loop, ignores the durability and audit trail, has no durig mechanism mapping, labels
no evidence classes, and rests two load-bearing caveats on non-controlled blog sources. This request asks
the questions the first pass could not see and asks it to correct the weak claims.

## Context

`durig` (`Pi-OpenDurig`) is a durable, multi-seat LLM agent rig built on **`pi-durable`** — an in-process
library (no server/socket/RPC; `Harness.open()` in the broker process). A **single-writer broker**
(`cli.mjs serve`) owns the store and drives a cross-seat **work queue**; **seats** (LLM personas, each a
long-lived conversation) claim items and act; a **delegate** operates on the human operator's behalf; a
**TUI/CLI** are the read surfaces. Native Windows only; no WSL/Docker.

**The loop the first report did not model.** Each seat turn is a model call; a tool call is one such turn
and its result is appended to context; the next reasoning step is a new turn. The harness persists
**every** turn (messages, tool calls with their outputs) to an append-only store, and `resume()` replays
pending work after a crash. A seat's item ends with a commit in an isolated per-item git worktree and a
completion that must **name the exact checks it ran and their exit codes** (constitution P1 Evidence).

**Hard constraints on any technique:**
- **Durability + auditability.** Every turn is a persisted, inspectable record. A batched operation that
  collapses many turns into one generated program is a single opaque step — there is no per-step
  checkpoint, and crash recovery (`resume()`) cannot resume mid-program.
- **Verification discipline.** The constitution requires a failing-first test and named evidence; a
  verifier re-runs what the author names. Work that bypasses the per-step tool-call trail may be
  cheaper but harder to verify.
- **Grounded, patch-producing work.** Seats read real files and write real diffs; they do not produce
  side-effect-free answers, so a wrong generated program corrupts a worktree.
- **Single writer, one model call at a time in the broker's pass model.** `DURIG_MAX_CONCURRENT_SEATS`
  bounds concurrency; the broker does not parallelize a single seat's tool calls for you.

**What durig already has (build on it, do not re-research it):**
- A **code-execution surface** is available in the pi stack (the seats run under a pi runtime that ships
  a codemode surface — see the pi `docs/codemode.md`). Whether seats under-use it is an internal
  question, not a research one.
- `metrics` already measures, per seat, context tokens, `step-repetition` (repeated tool calls), and
  `malformed-tool-call`; each metric declares a **band and a blind spot** and says "no data" rather than
  guessing. A per-turn **wall-clock** bound is a planned item.
- Two degeneration modes were observed and fixed/worked-around: a tool call emitted **as text**
  (`stopReason:"stop"`, no structured call — detected, D77) and a **prose-only** repetition loop that every
  tool-call-shaped signal missed (D78's detector was reverted for false positives). Reducing model turns
  changes the surface these run on.
- This first report already fed the family: ROADMAP items **27–30** (context pressure, `compact`,
  fresh-conversation) and **92–97** (compaction) cover the *context* side.

## Questions

Frame every answer for the architecture above; say explicitly when a published result does **not** transfer.

1. **Measure first.** In a durable, single-writer rig, what is the right primary metric — model
   **round-trips**, context **tokens**, wall-clock per item, or **cost** (including cached-input vs
   output)? The first report said "optimize tokens and latency, not call count"; give the evidence, and
   say which of these durig's existing `metrics` can actually observe and which would need new
   instrumentation.
2. **Durability cost of batching.** Plan-then-execute and code-as-action collapse many turns into one
   generated artifact. Against a system that persists **every turn** and recovers via `resume()`, what
   breaks (mid-program crash, no per-step checkpoint, opaque failure) and what does the literature say
   about batching *without* losing resumability? Name prior art for a durable plan-step boundary.
3. **Verifiability and audit.** When work moves into a sandboxed program, what happens to a
   failing-first / named-evidence review discipline? Any evidence that code-as-action makes *semantic*
   errors harder to catch than per-step tool calls? (The first report names debuggability but gives no
   source.)
4. **Multi-agent / queue interaction.** durig seats hand off via a queue with dependency links. Does
   per-seat round-trip reduction change handoff/fan-out behaviour, starvation, or the value of
   parallelism? Prior art on round-trip cost in multi-agent (not single-agent) loops — including any
   measurement showing multi-agent coordination *adds* round-trips.
5. **Degeneration interaction.** Does reducing model turns reduce the exposure to tool-call-as-text and
   prose repetition loops, or shift the failure surface (e.g. a long generated program that silently
   loops in the sandbox)? Evidence either way.
6. **When *not* to batch.** Irreversible side-effecting calls, human approval, rate-limited APIs, and
   failing-first checkpoints are named as poor candidates. Give the decision rule and any measurement of
   the overhead of *not* batching (a correct revert to per-step calls).
7. **Correct the first report's weak citations.** (a) Independent, controlled evidence for "longer plans
   correlate with reduced accuracy" — the first report's `[^6]` is a Medium post. (b) The LLMCompiler
   accuracy figure (7–8% vs ~9% seen in secondary sources) and the exact latency multipliers
   (1.80×/3.74×/2.15×) — confirm from the paper. (c) Is the Anthropic "150,000 → 2,000 tokens (98.7%)"
   a benchmark or a single worked example? State which, and find any independent replication.
8. **Concrete recommendation for durig.** Given durability + verification + single-writer, propose the
   smallest useful experiment: which seat behaviour to change, what to measure before/after against the
   existing `metrics`, and the ROADMAP item(s) to raise (registered, not scheduled).

## Deliverable

`docs/reviews/reducing-llm-agent-tool-calls-followup.md`, with:

- A **corrections table** for the first report (claim → verdict → better source or "unverified").
- An answer to each question, each **mapped to a concrete durig mechanism** or explicitly named
  **unverified** / **does not transfer**.
- The **metric recommendation** with the observable/instrumented split.
- A **smallest-experiment proposal** with before/after measurements.
- Proposed **ROADMAP items** for durig (registered, not scheduled).
- Each external claim cites a **URL** and states its **evidence class** (`observed` — controlled
  benchmark / peer-reviewed / primary docs, vs `advertised-elsewhere` — vendor or community claim), and
  maps to a durig mechanism or to the one it could not verify.

## Constraints

- Do not modify code; this is a written report.
- Prefer **primary sources** (papers, vendor docs) over blog posts; if only a blog supports a
  load-bearing claim, say so and mark it `advertised-elsewhere`.
- Baseline docs if you have repo access: `constitution.txt` (P1 Evidence, P2 Scope),
  `docs/reviews/reducing-llm-agent-tool-calls.md` (the first report), `docs/DECISIONS.md`
  (D77/D78), `docs/ROADMAP.md` items 27–30 and 92–97. If you cannot read them, say so.
