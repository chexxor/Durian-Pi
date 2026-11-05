# Research prompt — process/store topology of multi-agent coding teams, and the base/extension product split

Authored by: delegate, 2026-11-05 (Linux Fedora 45 7.2.15-300.fc45.x86_64 node v24.22.1).
Routed by: **operator** — the research agent is off-host and has no write access to this repo
(`docs/runbooks/research-request.md`, Preconditions). Hand it the file; ask for **text to copy**, never commits.

## Why this question, and what it unblocks

The operator ruled (2026-11-05) that durian-pi ships as **two minimum products**:

1. a **minimum coding agent** built on `pi-durable` that works well with **no durian-pi extensions at all**, and
2. **durian-pi** itself — a **team of specialized agents** (lead/impl/qa/…) cooperating on top of that base.

and that **every customization must live on the extension plane, not inside the base**. Open question the operator
explicitly declined to guess at: **does the team share one instance of the base agent, or does each team member run
its own instance with its own SQLite database?** That is a prior-art question, not a code question, so it goes to
research before design (the standing research-before-design ruling, `docs/DECISIONS.md` D210).

What we already know about **our own** rig, measured 2026-11-05, so you can compare against a real system rather
than an abstraction:

- One **broker** process supervises N seats (`tools/broker-serve.mjs`, `docs/BROKER-ARCHITECTURE.md`); today N = 12.
- One **SQLite store per rig** (`./selfdev.sqlite`), plus per-rig side files (`selfdev.sqlite.broker.log`, the
  `.broker.inbox/` spool). A second store (`rig.sqlite`, `session.sqlite`) exists for other rigs, not per seat.
- Each **seat is a separate OS process** with its own worktree (`DURIG_SEAT_ROOT`, `DURIG_MAX_CONCURRENT_SEATS`) and
  its own conversation history **inside the shared store**.
- The extension mechanism already exists and is explicit — `DURIG_EXTENSIONS` is a comma-separated list of paths
  (`src/config.mjs:117`, `src/extensions.mjs:57`), with **no auto-discovery** because "which code runs in here" is an
  operator decision (`src/extensions.mjs` TRUST BOUNDARY). A **pi-durable extension** and a **pi-coding-agent
  extension** are different planes and cannot load into each other (`src/extensions.mjs`, header).
- Today only **5 of 59** `src/*.mjs` files register a `defineExtension`, but the queue-tool surface is already on the
  extension plane (`durig.router` carries `send_work`/`claim_work`/`complete_work`; `durig.seat-tools` carries
  `prepare_workspace`/`seat_root`). The store, seat loop, broker and landing path are built-in.

## Questions — answer each, numbered, from published sources

1. **Process topology.** For shipped multi-agent coding systems (not frameworks): does one long-lived process host
   all agents, or one process per agent? Name the systems and cite the mechanism (supervisor, worker pool, IPC).
   Which choice do the ones with **crash recovery** make, and what does recovery look like after the supervisor dies?
2. **Store topology.** Do teams like these share **one durable store** (one file/DB per team, per-project, or
   per-workspace) or **one store per agent**, or a **hub store plus per-agent scratch**? For any per-agent-store
   design, how is a shared work queue and shared audit trail kept consistent — what breaks, and what did they add to
   fix it (locking, a coordinator, event log, CRDT, sync step)?
3. **The two-seam split.** Which projects ship a **minimum single-user coding agent** plus an **optional
   multi-agent/team layer above it as an add-on** (extension, plugin, pack, marketplace)? What is *in* the minimum
   product, and what is the smallest set of add-ons that turns it into a team? Where is the boundary drawn, in their
   own words?
4. **Base/extension policy in practice.** Which projects have an explicit rule that **customization must not be
   built into the base** — extension APIs, plugin manifests, capability negotiation, deprecation policy? What did that
   rule **cost** them (versioning pain, capability gaps, "core needs a hook that does not exist" complaints), and what
   did it **buy**? Include projects where the rule failed or was reversed, and why.
5. **Identity and state per agent.** In systems where multiple agents share a machine, is **memory/context**
   (conversation history, scratch, embeddings) per-agent, per-role, per-task or per-workspace? Cite the mechanism.
   What do they do about **two agents editing the same workspace** — locks, branches, worktrees, leases, queues?
6. **What the failure modes were.** For each topology above, list the documented failure modes with citations:
   store corruption/lock contention, split-brain, orphaned sub-agents, runaway spend, "who owns this branch" races,
   upgrade skew between a base and its add-ons.
7. **Naming.** What naming conventions do these families use for *base product* vs *team/supervision layer*
   (e.g. `-core`, `-base`, `-runtime`, `-hub`, `-fleet`, `-swarm`, `-orchestrator`)? Five real examples with the
   project's own words, so a name we choose is not invented from taste.

## Deliverable

Write to `docs/reviews/base-agent-product-topology-research.md` (we commit it; you only send text). Required
sections, **each as one fenced block with no narration glued to the title line**:

- `## TL;DR` — five sentences max, decision-relevant.
- `## Topology comparison table` — one row per system: process model | store model | base vs team boundary |
  crash-recovery story | citation.
- `## Findings per question` — numbered to match above.
- `## What this implies for durian-pi` — each finding mapped to **our** mechanism (named file/tool/row) or explicitly
  marked **unmapped**.
- `## Proposed backlog items` — each with owner and acceptance; we register them in `docs/ROADMAP.md` as
  *registered, not scheduled*, or reject them in writing.

## Evidence discipline (non-negotiable — this is what killed a prior round)

- Every external claim: **URL + evidence class** (`advertised-elsewhere` vs `observed-in-source`).
- **Do not cite line ranges into pages you fetched into your own workspace.** There is no file channel between you and
  this repo. The portable unit is a **verbatim quote of ≤ 40 words + URL + your fetch date**. A line range is accepted
  only *beside* such a quote (`docs/runbooks/research-request.md`, Do 1; ROADMAP **243**).
- Assert a cited repo path exists before citing it: `git log --all --diff-filter=A -- <path>` must be non-empty on the
  upstream project, or say the path is from a fetched copy and give the fetch date. A wrong pointer reads as verified
  (same runbook, "Check the pointers themselves, twice"; D159 addendum).
- Prefer primary sources: the project's own repo, docs, changelog, issues. A blog post about a competitor is
  `advertised-elsewhere`, not `observed`.

## Constraints

Written report only. **Do not modify code, do not open PRs, do not assume access to this repo.** Version-pinned:
state the version/date of every system you describe — an "as of" date per row in the comparison table
(`docs/runbooks/pi-pin-update.md` is our habit; a competitor claim without a date rots into a false doc).

## Follow-up

Expect a round 2. Whatever stays open goes into
`docs/reviews/base-agent-product-topology-followup-research-prompt.md` before the topic is closed.

## Prior art already in this repo — read before answering, and do not repeat it

`docs/COMPETITORS.md`, `docs/ARCH-COMPARISON-pi-multi-agent.md`, `docs/ARCH-COMPARISON-agent-fleet.md`,
`docs/ARCH-COMPARISON-agency-agents.md`, `docs/BORROW-FROM-agent-fleet.md`,
`docs/reviews/building-agent-systems-on-pi-research.md`,
`docs/research/how-to-design-an-llm-harness-which-apps-use-a-daemon.md`,
`docs/research/daemon-harness-architecture-followup.md`, `docs/reviews/architecture-broker-review.md`.
If one of these already answers a question above, say which and cite it instead of re-answering — and say what it does
**not** cover, because none of them was asked the base-vs-team product question.
