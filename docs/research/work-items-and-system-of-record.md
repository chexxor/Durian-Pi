# Work-items ↔ tasks, and where the system of record lives

**Audience:** a maintainer deciding how durig should relate its queue to an external
project-tracking board (Jira / Linear / GitHub Issues / a Kanban). This is the **#539**
adjudication report: it answers four questions about how queue-driven agentic systems model
work-items vs tasks, whether they keep an external or built-in system of record, the
trade-offs, and durig's recommendation.

**Evidence discipline:** every claim about **durig** names the file/line or the demo and its
exit code, so it can be re-run. Claims about **external systems** are prior-art from general
knowledge; per the research-request runbook's discipline they are marked
`evidence: advertised-elsewhere (not verified in this tree)` — nothing here was fetched from a
live Jira/Linear/GitHub source, so those rows must be read as informed prior art, not
verified fact.

---

## The short answer

- In durig, **the queue item IS the task.** There is no separate "work-item that spawns
  tasks": a routed item (`subject` + `body`) addressed to a seat is the unit of work, and its
  append-only `transitions` array is the ticket's audit trail. Mapping lives **inside the
  item**, not in a separate registry.
- durig uses a **built-in system of record**: the `durig.queue` pi-durable session document in
  the store. There is no Jira/Linear/GitHub mirror. The only external-facing surface is a
  **read-only** seam (`src/readapi.mjs`).
- The recommendation (lead's adjudication, adopted from this report): **keep the built-in
  queue as the single source of truth**, and offer a **read-only export seam** as the *only*
  external interop — no write-back, no two-way sync. Justification and follow-on work below.

---

## Q1. Is a queue item the task, or a work-item that spawns tasks?

### durig (verified — the model that matters here)

From `src/rig.mjs`:

- `RigQueue` is a pi-durable doc — `kind: "durig.queue"`, `scope: "session"`, initial
  `{ nextId: 1, items: [] }` (`src/rig.mjs:85-90`).
- Each item is a single flat record: `{ id, from, to, subject, body, optimizedVia, notice,
  status, transitions: [{at,event,by}] }` (`src/rig.mjs:187-202`, the `enqueueItem` shape).
- Status flow: `queued → claimed → done`, plus `claimed <-> deferred` and
  `claimed → held → queued` (`src/rig.mjs:76-79`). Terminals are `done` and `cancelled`
  (`isTerminalItem`, `src/rig.mjs:164-166`).
- Transitions are **appended**, never mutated in place — the item carries its own audit trail
  (`src/rig.mjs:88-89`, "Transitions are appended (audit trail), never mutated in place").

So in durig there is **no two-level hierarchy**: one queue item = one routed unit of work =
one ticket. A single concern maps to one item and one item to one concern (the P2 scope rule
"one concern per change" is orthogonal — that governs *commits*, not the queue model). The
protocol's own completion acknowledgement ("DONE #\<id>: \<subject>") is also an item with a
`notice` flag rather than a separate task type (`src/rig.mjs:149-155`).

**Proof it holds** (demos, both exit 0):
- `node demo/coordinator-queue.test.mjs` — proves the queue is a doc whose items carry
  `id/from/to/subject/status` and that a done item is excluded from the non-terminal view.
- `node demo/peekqueue.test.mjs` — proves the read view and the over-threshold item
  body-deferral contract.

**Mapping:** because the item is both the work unit and its own ticket, "where the mapping
lives" is trivially inside the item. durig needs no work-item→task join table.

### Comparable queue-driven systems (prior art — not verified in this tree)

| System | Work-item vs task | Mapping location | Evidence |
|---|---|---|---|
| GitHub Issues | Issue is the work item; sub-issues (2023+) add one level of hierarchy; checklists are ad hoc, not first-class tasks | Internal to the issue | advertised-elsewhere, unverified here |
| Linear | Issue is the unit; it can **spawn** sub-issues and a `blocked by` graph; teams often model milestones→issues→sub-issues | Internal to the issue + project cycle | advertised-elsewhere, unverified here |
| Jira (software) | Epic → Story/Task → Sub-task is a **first-class three-level hierarchy**; work is decomposed into child issues | Issue-link types (`is child of`, `blocks`) in the issue itself | advertised-elsewhere, unverified here |
| Kanban boards (Trello etc.) | Card is the unit; lists = stages; no real parent/child task model | On the card | advertised-elsewhere, unverified here |

The pattern across all of them is the opposite end of the spectrum from durig: external
systems tend to be **hierarchical** (an epic/story decomposes into children), whereas durig is
**flat** (one item = one unit of work). Hierarchies give traceability of a large effort into
many small tickets; flatness gives atomic one-item routing and a trivial lifecycle. durig's
purpose-built flat queue (D3) deliberately chose the flat side.

---

## Q2. External system of record, or built-in? What is the integration seam?

### durig (verified)

Built-in. The queue, the roster, and all durable state live in one pi-durable store
(`<db>.sqlite` default) — see `docs/SEAT-LIFECYCLE.md` §"Where things live". There is **no**
connector to Jira/Linear/GitHub and no mirror/sync code in the tree (grep of `src/` and
`cli.mjs` for `mirror`/`sync`/`Jira`/`Linear` returns only unrelated hits: `sync-pi.mjs`
updates the *vendor* pi-durable pin, not a tracker).

**The integration seam is `src/readapi.mjs`.** It is described there as "The one shared read
API over a rig's store (D21, ROADMAP item 8)" and is *"Read-only by construction: nothing here
opens a harness or writes storage"* (`src/readapi.mjs:1-22`). In particular:

- `readQueueItems(storage)` returns the queue's items as plain JS — "newest-current
  document" (`src/readapi.mjs:39-48`).
- `readRigHealth(storage, dbPath, slots, …)` returns "seats, queue, the peer navigation
  graph, metrics, and the attention notices" in one bounded scan (`src/readapi.mjs:61-80`).

So durig already has a single, read-only, scriptable seam a future exporter could consume
without ever becoming a writer. That is the natural integration point for a read-only export.

### External systems (prior art)

| System | SoR location | Integration seam | Evidence |
|---|---|---|---|
| GitHub Issues | GitHub-hosted; repo issues are the SoR | REST/GraphQL API; used as single source of truth by most tooling; two-way sync is unusual and drift-prone | advertised-elsewhere, unverified here |
| Jira | Atlassian cloud/server | REST API; nearly always treated as **the** SoR that other tools mirror into | advertised-elsewhere, unverified here |
| Linear | Linear cloud | GraphQL API; teams sync linear→Slack/boards one-way, or treat it as SoR | advertised-elsewhere, unverified here |

The dominant industry practice is: **the tracker is the source of truth, and internal tools
mirror into it** (one-way push). Two-way sync is the rare, most failure-prone pattern because
status and identity can drift in both directions.

---

## Q3. Trade-offs

### External SoR (Jira / Linear / GitHub)

**For** — interop with the team's existing boards; a familiar review surface for humans; an
audited, org-wide history product-managers already read; integration with Slack/CI tooling.

**Against** — durig's queue is **session-scoped and append-only-transitioned** (D3), so an
external board is a second, out-of-band copy that can diverge. It adds a dependency
(credentials, network, API surface) to a tool whose whole point is to be runnable and
verifiable offline. Writing the queue's audit trail into a foreign schema loses durig's
append-only guarantees. Two-way sync reintroduces exactly the identity/status drift durig's
single-store design (D2/D3) eliminates.

### Built-in (durig's current design)

**For** — zero-dependency; one source of truth (the store) that the driver, seats, `status`,
`watch`, `check`, and `metrics` all read through `readapi.mjs`; no sync drift by construction;
the audit trail (`transitions`) is durable and survives restarts (D3 rationale: "audit trail
survives restarts").

**Against** — no org-standard board a PM outside durig can look at; no Jira/Linear ecosystem;
a human reviewing progress must use durig's own `status`/`watch`/`peek_queue` rather than a
familiar Kanban.

---

## Q4. Recommendation for durig (lead's adjudication, adopted)

**Keep the built-in queue as the single source of truth; add a read-only export seam as the
only external interop.** No write-back, no two-way sync.

**Justification.** All of durig's writers and readers agree on one store (`src/readapi.mjs`
is read-only by construction, D21/ROADMAP 8), and the audit guarantees live in durig's
append-only item transitions (D3) — both properties an external board cannot preserve. An
export-only seam preserves zero-drift inside durig (nothing external can mutate the queue)
while giving a human outside durig a standard, scriptable board view. It is the "observer, not
controller" posture: durig remains the source of truth; the external board is a derived view,
rebuilt on demand from `readQueueItems`.

This is consistent with D3's standing decision — D3 already chose the flat, session-scoped,
append-only queue over a richer external task model and noted PD's own `task` ownership model
was considered and rejected for "PM-style routed work". This recommendation ratifies that D3
stance for the external-integration question rather than reversing it.

**Follow-on work** (registered, not scheduled — sequencing is pm's, not this report's):
1. **An `export` command** that dumps the queue's non-terminal AND terminal items to JSON
   (via `readQueueItems`/`readRigHealth`) — the concrete seam, provable by a demo.
2. **A documented one-way mirror** folder/script that turns that JSON into a static GitHub
   Issues/Kanban-style view, so the "familiar board" benefit is available without write access
   into durig.
3. **Explicitly out of scope / not built:** any write-back connector that mutates durig's
   `durig.queue` doc from an external tool. If the team later finds it unavoidable, it must be
   a *separate* decision (a new DECISIONS entry) — it changes the source-of-truth guarantee,
   not just adds a view.

**Not verified / open:** the trade-off numbers (how many external issue hierarchies a real
durig workload needs, and whether a static export satisfies the team). No live external
tracker was read for this report (all external rows are `advertised-elsewhere, unverified`), so
the decision to adopt an external SoR — if ever reconsidered — should start from a fresh,
grounded research request per `docs/runbooks/research-request.md` that actually fetches the
target's API/schema.

---

## Evidence table

| Claim | Where | What proves it |
|---|---|---|
| Queue is a pi-durable session doc `{nextId, items}` | `src/rig.mjs:85-90` | `RigQueue = defineDoc({kind:"durig.queue", scope:"session", initial:…})` |
| Item shape `{id,from,to,subject,body,optimizedVia,notice,status,transitions}` | `src/rig.mjs:187-202` | the `enqueueItem` push |
| Status flow + append-only transitions | `src/rig.mjs:76-89` | the transition comment + push shape |
| Terminals are `done`/`cancelled` | `src/rig.mjs:164-166` | `isTerminalItem` |
| Item = single routed unit (no task hierarchy) | `src/rig.mjs` (whole doc) | no second-level task table exists |
| Queue + roster + state live in the store | `docs/SEAT-LIFECYCLE.md` §"Where things live" | the location table |
| Read-only integrated seam exists | `src/readapi.mjs:1-22, 39-48, 61-80` | `readQueueItems`/`readRigHealth`, "read-only by construction" |
| No tracker mirror/sync in the tree | grep of `src/` + `cli.mjs` | only `sync-pi.mjs` (vendor pin) matches |
| The flat queue was a deliberate ruling | `docs/DECISIONS.md` **D3** | D3 "(queue is a session-scoped document, not tasks)" |
| Demo: queue items carry id/from/to/subject/status; done excluded | `demo/coordinator-queue.test.mjs` | runs green — exit 0 (run: `node demo/coordinator-queue.test.mjs`) |
| Demo: queue read view + item body-deferral | `demo/peekqueue.test.mjs` | runs green — exit 0 (run: `node demo/peekqueue.test.mjs`) |
| External-tracker claims | this file, Q1/Q2 tables | `advertised-elsewhere` — NOT verified in this tree |

**Verify yourself:** `node demo/coordinator-queue.test.mjs` and
`node demo/peekqueue.test.mjs` — each exit 0 on success; cross-read
`docs/DECISIONS.md` D3 and `docs/SEAT-LIFECYCLE.md` §"Where things live".
