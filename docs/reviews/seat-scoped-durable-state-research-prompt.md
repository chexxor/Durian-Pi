# Research request — per-agent durable state: one store, or one database per agent?

**Ask:** hand this to the operator's research agent (it is off-host and has **no write access to this repo**, so ask it for
*content to copy*, never commits or file writes). Report to `docs/reviews/seat-scoped-durable-state-research.md`.

**Why this question, now (measured, this rig, Linux host `label-withheld-per-D205`, 2026-10-30T06:4xZ).** The operator asked
whether durian-pi should be re-architected so each seat is its own pi-durable instance with its own database. The delegate
answered from the tree and the operator accepted the recommendation *not* to split, on condition the question is researched
properly rather than left as chat opinion. Two measured facts motivate the question and two constrain the answer:

- Today a seat's **worktree root is not durable**: `complete_work` resets a seat's persisted cwd to `process.cwd()` of
  whichever process served the wake, and in one session that moved 2 of 12 seats back onto the live main checkout while the
  other 10 stayed on an operator-approved isolated worktree. A rig-wide guard then refused the operator's only working
  channel because of one seat's drift. The store carries **host-local facts** (a cwd, a shell name) with no host column, and
  those facts survived a machine moving from Windows to Linux, so 12 seats were pointed at paths that do not exist.
- The **queue is the product**, not a transport. Rulings this session were cross-row reasoning over 4,881 rows joined to a
  268-item roadmap and to 531 git ref tips (2,140 reachable commits). Gate authority is already party-scoped and already
  brittle inside ONE store: the adjudicating lead was refused `release_work` on the row it wanted to release ("only the
  sender or recipient may release it"), and a coordinator's `resume_work` was refused on rows addressed to another seat.
  Each seat is **already** its own pi-durable conversation (`tx.createConversation` per seat at `cli.mjs:699-706`) with its
  own context, compaction ledger and transcript; what is shared is the file and the queue.

## Context

`durian-pi` is a durable, multi-seat agent rig built on **pi-durable**. A single-writer **broker** drives a cross-seat work
queue; **seats** are LLM personas with named roles, capabilities, and tool profiles that claim items and act in git
worktrees; a **delegate** (an external agent, not a seat) operates on the human operator's behalf; CLI/TUI are the read
surfaces. Two audiences must be able to reason about the answer: the **human operator + delegate**, and an **LLM seat**
that reads a document and executes it through tools.

## Questions

1. **Where does the industry put coordination state in multi-agent systems?** Survey shipped systems, not blog posts:
   LangGraph checkpointers/threads, Letta (formerly MemGPT) and mem0, AutoGen / Semantic Kernel state, OpenAI Agents SDK
   sessions, Claude Code subagents, Temporal / Cadence workflow history, event-sourced command sides, Erlang/OTP and actor
   runtimes, ChatOps/ticket systems as agent back-ends (Jira, Linear, GitHub Issues + agents). For each: is coordination
   state **one shared store** or **per-agent storage**, and what exactly is per-agent?
2. **What breaks when the work queue, leases, and dependency gates are partitioned per agent?** Name the concrete failure
   modes of distributed gate authority and distributed claim/lease semantics (two agents claiming one item, a gate whose
   owner is in a different database, cross-database hold/release, cross-database transactions, and the absence of a single
   "what is the current state" query). Which of these are solved by an established mechanism, and what is that mechanism?
3. **When IS per-agent durable state the established choice, and what invariant is preserved in exchange?** Actor-model
   per-actor state + a single message log; event-sourcing aggregates with one event stream each; capability/handle passing;
   multi-tenant sharding. State the invariant each design protects (single log, single owner per aggregate, exactly-once
   effects, etc.) and what it costs in cross-aggregate queries.
4. **Embedded-store scaling evidence.** What does published/observed evidence say about SQLite WAL (single-writer,
   many-reader), the practical limits of one database file with many conversations/threads, and the measured trade-off
   between *many tables in one file* and *many files* (attach vs separate handles, backup/vacuum/checkpoint behaviour,
   corruption blast radius)? Give the numbers with their source and platform.
5. **Host-local facts: configuration or state?** How do established systems represent facts like "which host runs this
   worker", "which shell/toolchain exists there", "where is its working tree"? Look for scheduler/placement patterns
   (Kubernetes node selectors/taints and tolerations, Borg/Mesos constraints, Temporal task queues/worker slots, CI runner
   labels, VS Code dev-container / remote-SSH host pinning) and for the general split between **capability registry**
   (discovered, per host) and **identity/state** (portable). Is there a named pattern for "portable identity, per-host
   placement"? What are the documented failure modes of storing resolved host paths as durable state?
6. **Blast-radius isolation.** For a misbehaving or runaway agent, where do practitioners put the bulkhead — the process,
   the transaction, the queue partition, or the database? Cite circuit-breaker/bulkhead practice and any agent-specific
   evidence (a seat spamming output, a seat writing files it should not, a harness restart destroying in-flight intents).
7. **Per-agent context growth.** Does splitting *storage* buy anything that splitting *conversations* does not? Compare
   published approaches to long-lived agent memory (compaction, summarization ledgers, retrieval over immutable transcripts,
   block-based memory) and say which isolation axis each one actually needs.
8. **Concrete recommendation for durian-pi.** Given: one queue as the coordination primitive, already-separate
   conversations per seat, per-item git worktrees as the file-isolation primitive, a dual-host rig (Linux + Windows), and a
   party-scoped gate/lease model that is brittle inside one store — propose the **cheapest decomposition consistent with
   prior art**, name what you would NOT split and why, and list the ROADMAP items you would raise (registered, not
   scheduled). Where prior art contradicts the delegate's recommendation, say so plainly and cite it.

## Deliverable

`docs/reviews/seat-scoped-durable-state-research.md`, with these sections, **each supplied as ONE fenced block with no
narration glued to the title line** (what arrives in chat is what gets committed verbatim):

- `## Findings` — one row per system surveyed: system, where coordination state lives, what is per-agent, what is shared.
- `## What partitioning the queue costs` — named failure modes + the established mechanism that addresses each, or
  `no established mechanism found`.
- `## When per-agent storage is right` — the invariant preserved, and the price paid.
- `## Store-scaling numbers` — measured figures with source + platform + version.
- `## Host-local facts: registry vs state` — the named pattern(s), and the documented failure modes of storing resolved
  host paths as durable state.
- `## Bulkhead placement` — process / transaction / queue / database, with citations.
- `## Recommendation for durian-pi` — the cheapest decomposition, what not to split, and proposed ROADMAP items.

**Evidence discipline (this is the part that failed in a previous round).** The research agent has no file channel into
this repo, so a line range into a page it fetched is **not portable**. For every load-bearing external claim supply a
**verbatim quote of ≤ 40 words + the URL + the agent's own fetch date**; a line range is acceptable only *beside* such a
quote. State each claim's class: `advertised-elsewhere` (vendor/docs claim) vs `observed` (measured/reproduced with a
method stated). Map every finding either to a named durian-pi mechanism (queue row, claim lease, `blockedBy` gate, worktree,
seat cwd, broker wake set) or explicitly to **unverified**. Do not cite a repository path in this project as evidence — the
delegate will verify paths with `git log --all --diff-filter=A -- <path>`.

## Constraints

- **Written report only. Do not modify code, do not commit, do not create paths in this repo** — the agent has no write
  access and will report success into a void.
- This rig's baseline for reading: `docs/SELFDEV.md`, `docs/DECISIONS.md` (D45, D60, D85, D92, D101, D102, D118, D148,
  D149, D150, D161, D163, D172), `docs/runbooks/store-bloat.md`, `docs/runbooks/corrupt-recovery.md`,
  `docs/runbooks/workspace-move.md`. Quote from them if useful; do not paraphrase them as findings.
- Prefer primary sources (design docs, source, benchmarks, talks by the implementers) over secondary commentary, and name
  the version/date of anything whose behaviour may have changed.
