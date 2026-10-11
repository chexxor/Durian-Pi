# Target workflows (ROADMAP item 21)

**Why this document exists.** The MVP bar, the feature inventory, the research gap table
and `RESEARCH.md`'s topology notes each carried a piece of the answer to "what is durig
for", and nothing carried all of it. The consequence was concrete: "recommended
extensions" (item 18) and the build order were decided without a frame, and three
decisions we *did* make deliberately (D21 non-interactive CLI, D22 seats are not
terminals, D24 measurement) were recorded as architecture decisions rather than the
workflow decisions they actually were.

This names the workflows, then derives "recommended" from them instead of taste.

**Method.** Each workflow below is written as: **who** is in it, the **trigger**, the
**loop that must never break** (the one whose failure loses work or ships something
wrong), what **done** means, and the **capability** it needs. Every one is grounded in
something we already run or already built — a demo, a rig we operate, or a norm the team
actually follows — rather than invented for this document. Where a workflow is not
supported yet, it says so and names the item that would.

**Owner:** the `workflows.advocate` seat (`openrig/rigs/tutor-pi/agents/advocate`). It
owns this document and the workflow set, questions durig changes for workflow impact, and
labels every workflow with the evidence class described under "Who owns this". It is
deliberately not the tutor's learner-facing UX seat (`design.ux`) — that one owns the
tutor's surface, this one owns durig's workflows — and it differs from the docs seat
(`scribe`) by owning the *workflow set* rather than the feature inventory.

## How to read a workflow

- **must-not-break** is the honest centre. A workflow can be slow, awkward or verbose and
  still work; these are the failures that are not recoverable by a person noticing.
- **done** is stated in terms of observable state, because "the seat said it finished" is
  the thing durig exists to stop trusting.
- **capability** is what has to exist for the loop to hold, which is the input to
  "recommended" at the end.

---

## W1 — Routed delegation

**Who:** any seat with an edge to another seat.
**Trigger:** work arrives that belongs to a different seat.

**Loop:** `send_work` puts a queue item in the recipient's queue → the recipient
`claim_work`s it → `complete_work` marks it done → **the platform enqueues a DONE notice
back to the sender**.

**Must not break:** the DONE notice reaching the sender. The sender learns its work
finished *only* through that notice; if it is lost, the work silently vanishes from the
sender's point of view and the delegation becomes a black hole. Second-order: the item
must be claimable by exactly one seat (a double-claim assigns one item twice).

**Done:** item `status: "done"` **and** a DONE item in the sender's queue.

**Capability:** the Router tools, installed at harness open (D16 — the bug was that they
were not). Org edges decide who may send to whom, and an unpermitted send fails loudly.

**Evidence:** `demo/offline.mjs`, `demo/offline-v2.mjs` (edge + capability gate),
`demo/race.test.mjs` (one winner), `demo/durability`-level restart proof in
`demo/persistence.test.mjs`. Dogfood finding F6 recorded this whole loop working
end-to-end (`docs/DOGFOOD.md`).

---

## W2 — Independent verification (author → reviewer)

**Who:** an author seat and a verifier seat that is not the author.
**Trigger:** a draft, claim or deliverable exists.

**Loop:** the **author sends the concrete artifact** to the reviewer → the reviewer
checks it **against the evidence** rather than against the author's description → the
reviewer either acks or sends back the exact defect → the author fixes it → the
originator closes the item.

**Must not break:** (a) the reviewer receives the *artifact*, not a summary of it —
a summary cannot be checked; (b) closure does not happen on the author's word alone —
silence is not a sign-off. This is exactly the team norm the tutor-pi rig already
encodes for its 2-member pods, and the reason `check` has a `no-verifier-seat` rule and a
`single-model-rig` rule.

**Done:** an explicit reviewer ack, or a flagged defect with the fix, recorded where the
item can be read.

**Capability:** a verifier seat (name/role matching the verifier vocabulary) on a
**different model family** from the authors it checks; and — this is the part that is not
built — **evidence a reviewer can re-check**. `complete_work` currently carries a
`resultSummary` string, which is a claim, not evidence (ROADMAP item 4). **This half is not
gated on the M3 security ruling**: evidence is a protocol change, not a capability grant — it
gives a seat no new power, only something checkable to report, so it can land before the tools
do. The tools are the gated half, and they carry conditions SC1–SC3 (`docs/SEAT-TOOLS.md`).
Until evidence lands, W2 holds only for work whose artifact is *text the reviewer can read in
the transcript*.

**Evidence:** `demo/check.test.mjs` (the verifier rule, including that a capability named
`peer-review` on an author does NOT count), `demo/defer.test.mjs` (a question round-trip
between seats), team norms' pair-review contract, D27's edge rule.

---

## W3 — Blocked on a question

**Who:** a seat holding an item, plus whoever can answer (another seat, or the human).
**Trigger:** the seat cannot proceed without a decision it is not entitled to make.

**Loop:** `defer_work(itemId, question[, to])` parks the item → the question goes to a
seat as real enqueued work, or to the human (nothing enqueued, because the operator's
channel is `status`/`watch`) → an answer arrives → `resume_work(itemId)` puts the item
back in the seat's hands → `complete_work`.

**Must not break:** (a) the park is **reversible** — an item parked with no way back is a
silent death, strictly worse than the prose it replaces; (b) the park is **visible** — a
blocked seat's reason must appear where an operator looks, or "I need a decision" becomes
"nothing is happening"; (c) asking a seat is a **send**, so the org-edge gate applies and
a deferral must not become an unlogged channel to any seat.

**Done:** the item completes, or is re-deferred with a sharper question.

**Capability:** the deferral tools (D32), and the attention channel that renders
`deferred_awaiting_answer`.

**Evidence:** `demo/defer.test.mjs` (parks, is visible, resumes, asks a seat, is
edge-gated, refuses a foreign item), `demo/watchview.test.mjs` (parked row + footer
count). This is also the mechanism our own pair-review and Compromise-Ledger norms assume
without having had a way to express it.

---

## W4 — Intake, decomposition and tracking

**Who:** a coordinator seat (PM), and the operator who brought the request.
**Trigger:** a new request, from a person or from another seat.

**Loop:** intake → decompose into **one-concern** items with a proving test and an
acceptance → route each to the seat that should hold it → track to a terminal state →
report.

**Must not break:** every request becomes a tracked item. Work started outside the queue
cannot be seen, measured, aged or closed, so the failure is not "a task was lost" but
"the system's picture of its own work is wrong". Second: an item that must stop is
**closed with a reason** (blocked/handed-off/cancelled) rather than left to age silently.

**Done:** the request's items are all in a terminal state, and the operator has been told
which.

**Capability:** `send_work` and `peek_queue`; a coordinator with explicit outgoing edges
(D16 — coordinators need recipients or they cannot route anything); per-seat
`capabilities` so a route can require one. **Not built:** a blocking/deferral state for a
whole *workflow* (as opposed to one item), which is item 12, and any attempt/deadline
semantics, which is item 6.

**Evidence:** `docs/DOGFOOD.md` (the first dogfood session routed a real backlog item
`pm` → `worker` through the queue), `docs/QUICKSTART.md` Steps 4–6 (the same loop as a
walkthrough), team norms' "every new request becomes a queue item registered by the PM".

---

## W5 — Human oversight and intervention

**Who:** the human operator. Nobody else: this workflow exists so a person can see and
act without becoming a seat.

**Trigger:** "is anything stuck?", or a suspicion that a rig is doing the wrong thing.

**Loop:** `status` / `watch` show per-seat health and attention notices → the operator
follows one with `log <seat>` or `queue` → either steering the seat with `send`, or
changing the rig file and re-applying with `up`.

**Must not break:** **a viewer must never drive work.** Opening a harness resumes task
scheduling, so a passive `watch` that opened one would kick the very queue it is
observing. That is why the read commands open storage directly and `openHarness` excludes
viewers from `resume()` (D11). Second: an empty dashboard must never look like a healthy
quiet rig — wrong database, no seats, and idle-with-work are all visibly different states.

**Done:** the operator can name what is stuck, who holds it, and what they are waiting on.

**Capability:** the read commands, the attention vocabulary, and the wrong-database
guardrail (D18). **Not built:** any intervention that is not "send a message" or "edit
the file" — specifically no per-task abort or veto from the operator surface.

**Evidence:** `demo/watch.test.mjs`, `demo/watchview.test.mjs`, `demo/blocked.test.mjs`
(the two notice kinds), `demo/cli.test.mjs` (the wrong-database guardrail), D11, D18, D22.

---

## The operator loop: a rig change under measurement

**Who:** operator or lead. **Trigger:** someone wants to change the rig — a model, a
seat, an extension, the constitution.

**Loop:** `check` first (it is a linter: is the rig structurally sound?) → write the
**predicted direction** for the measure the change is meant to move → make the change →
`metrics` afterwards, which now also reports the revision and whether the tree was dirty.

**Must not break:** the baseline is taken **before** the change. A measure that arrives
afterwards can only rationalise, and D24 accepts this as the cost of the loop being worth
anything at all. Second: a reading whose revision is dirty or absent is reported as such,
because an unattributable movement is not evidence.

**Done:** the operator can state the change, the measure, the direction predicted, and
whether it moved — or say `unknown`, which is a legitimate outcome.

**Capability:** `check` (eight rules), `metrics` (four measures), config provenance
(`DURIG_STREAM_TIMEOUT_MS` and friends), and a drill — **which does not exist** (item 2's
other half). Without the drill a passive window is *confounded*: it cannot separate "the
rig got worse" from "the work changed". So today this loop is honest but only
correlational, and that limitation belongs in the workflow rather than in a footnote.

**Evidence:** `docs/METRICS.md`, `demo/check.test.mjs`, `demo/metrics.test.mjs`,
`demo/provenance.test.mjs`, D24, D25, D28.

---

## The capability matrix

Status is today's, not the wish:

| Capability | Serves | Status |
|---|---|---|
| Router tools (`send`/`claim`/`complete`) | W1, W2, W3, W4 | **seed** — installed at harness open (D16) |
| Deferral tools (`defer`/`resume`) | W3 | **seed** — D32 |
| `peek_queue` | W4, W5 | seed |
| Org edges + capability tags | W1, W3, W4 | rig file; `check` catches missing edges |
| Verifier seat, distinct model family | W2 | rig file; `check`'s `no-verifier-seat` + `single-model-rig` |
| Constitution | all | rig file; `check` catches declared-but-not-applied |
| Read commands + attention vocabulary | W5, operator loop | seed — D11, D18 |
| `check` + `metrics` + provenance | operator loop | seed — D24, D25, D28 |
| **Evidence in `complete_work`** | W2 | **absent** — a protocol change, NOT gated on loop #5 (SC1–SC3 gate the tools, not this) |
| **Retrieval / corpus tools** | W2 | **absent** — item 4 (M3) |
| **A drill task set** | operator loop | **absent** — item 2's other half |
| Attempt/deadline semantics | W4 | **absent** — item 6 |
| Whole-workflow phases | W4 | **absent** — item 12 |

## Who owns this, and where the workflow set comes from

The `workflows.advocate` seat owns this document. Its hardest job is one the operator
named when the seat was created: **how do you collect feedback from the users of a
workflow when you may not have any?** The answer is not to guess. It is to label where
each workflow came from, permanently, and grow the honest set deliberately.

Three admissible classes:

- **observed** — we ran it. A dogfood session, a demo, an operator report. This is the
  only class that means "somebody here actually uses this".
- **advertised-elsewhere** — another platform documents supporting it. That makes it a
  **candidate**: it says the workflow is real and worth considering, not that anyone here
  wants it.
- **inferred** — reasoned from our own design, and labelled as reasoning.

Today, honestly:

| Workflow | Class | Why |
|---|---|---|
| W1 routed delegation | **observed** | dogfood finding F6 ran the full loop; QUICKSTART steps 4–6 |
| W2 independent verification | **inferred** + advertised-elsewhere | the team norm and the pair-review contract, but **not yet observed under durig** — and its evidence half does not exist (item 4) |
| W3 blocked on a question | **observed (offline only)** | `demo/defer.test.mjs` drives the real tools; no live run has deferred an item yet |
| W4 intake / decomposition / tracking | **observed** | the first dogfood session routed a real backlog item `pm` → `worker` |
| W5 human oversight | **observed** | the operator reads `status`/`watch`/`log` against the live store routinely |
| Operator loop (rig change) | **observed** | run on the live rig, e.g. the `DURIG_STREAM_TIMEOUT_MS` change |

That table is the honest scoreboard, and it is uncomfortable in the right way: **only one
workflow is observed in a live multi-seat run**, because seats still cannot do real work
(item 4). It also means "collect feedback" has a concrete meaning today — the operator's
reports and our own dogfood findings, both already recorded — rather than a survey nobody
can run.

**Widening the set.** The operator's suggestion, and a good one: derive candidate
workflows from **what competing platforms advertise supporting** (agent-orchestration
frameworks, durable-workflow engines, multi-agent product suites). Each candidate arrives
labelled `advertised-elsewhere` and graduates to `observed` only when somebody here runs
it. That is roadmap item 26, and it is the right order — observed first, candidates
second — because a workflow list that grows from a competitor's feature page is a list of
hypotheses, not of users.

## Deriving "recommended" (the point of this document)

The first thing the matrix shows is that **"recommended" for durig is mostly rig shape,
not extensions.** Every workflow is served by the seed tools; what actually varies between
a rig that works and one that does not is which seats exist, which model each runs, and
which edges join them — and `check` already has rules for exactly those. So item 18's
profiles should default to:

- **core** — the Router. Not optional: no workflow exists without it, and it is one
extension, so "off" is not a state a working rig has.
- **recommended** — a *rig shape*, applied as configuration: a verifier seat that is not
  an author, on a different model family; a constitution; an outgoing edge on every seat.
  These are the three things `check` can already fail a rig for, so shipping them as
  "recommended" means shipping the configuration that passes the linter.
- **opt-in, workflow-specific** — currently **nothing**. The first real candidate is
  retrieval for W2's evidence half, and that is an operator scope ruling (item 4), not a
  default anyone should inherit.
- **not recommended by default** — terse-voice extensions (caveman's skill). It helps
  seat-to-seat coordination and is actively wrong for a tutor's student-facing
  explanation, which is the role-scoping axis item 20 already identified. Under D29's
  cost rule ("off must cost nothing at all") it must therefore be off, and switchable per
  seat role rather than rig-wide.

This is the derivation item 18 was missing. It also predicts the shape of item 18's work:
a *profile* is a preset rig file plus a seed list, not a bundle of extensions.

## What this settles, and what it does not

**Settles — three decisions re-read as workflow decisions.** The roadmap noted D21, D22
and D24 were taken ad hoc; with the workflows named, each has a reason:

- **D21 (non-interactive CLI)** is W5 and the operator loop. The operator is a person or
  an LLM driving commands, and the loop must not break when nobody is watching. An
  interactive prompt would be a blocking gate in W1's must-not-break path.
- **D22 (seats are not terminals)** is W1–W4. A seat is a queue participant; making each
  seat a terminal would make the *seat* the unit of attention, when W5's must-not-break is
  the rig's state, not any one seat's screen.
- **D24 (measurement, not a list)** is the operator loop, whose must-not-break is the
  baseline-before-change rule.

**Does not settle:** the drill's task set (a content decision), which extensions ship in
"recommended" (item 18's own work), whether seats get real tools (the operator ruling,
loop #5), and the pods question (item 11).

**Known gap in this document:** W2 is written as the intended workflow and is **not fully
supported** — the evidence half is missing. Naming the loop lets us see that the
verification workflow holds today only for artifacts a reviewer can read in a transcript,
and that is a real limit on what the tutor rig can be trusted to do.
