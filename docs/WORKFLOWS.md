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
something we already run or already built - a demo, a rig we operate, or a norm the team
actually follows - rather than invented for this document. Where a workflow is not
supported yet, it says so and names the item that would.

**Owner:** the `workflows.advocate` seat (the previous rig's advocate agent). It
owns this document and the workflow set, questions durig changes for workflow impact, and
labels every workflow with the evidence class described under "Who owns this". It is
deliberately not the product's user-facing UX seat - that one owns the
product surface, this one owns durig's workflows - and it differs from the docs seat
(`scribe`) by owning the *workflow set* rather than the feature inventory.

## How to read a workflow

- **must-not-break** is the honest centre. A workflow can be slow, awkward or verbose and
  still work; these are the failures that are not recoverable by a person noticing.
- **done** is stated in terms of observable state, because "the seat said it finished" is
  the thing durig exists to stop trusting.
- **capability** is what has to exist for the loop to hold, which is the input to
  "recommended" at the end.

---

## Driving model

**Sanctioned concurrency model:** durig has **one** broker (the single writer) owning the
store/harness and driving N seats up to the slot cap (`DURIG_MAX_CONCURRENT_SEATS`, D12:
it caps concurrent GENERATIONS, not seats-as-objects), each seat in its own worktree.
The single-writer scope is the **store + harness** (not files): a seat's worktree provides
file isolation; the store provides coordination isolation. Multiple `run`/`send`
invocations against the same database are **not sanctioned** - they double-wake seats and
corrupt the queue driver's state (D46). Independent drivers use **separate databases**.

**Must not break:** this clarifies W5's must-not-break loop (a viewer must never drive work) by
extending it to *all* write-side commands: only one driver may be active per database at a time.
The broker enforces this via a pidfile (`<db>.broker.json`) and `run` refuses when a broker
drives (D46). No workflow loop is weakened - the single-driver model is what makes W1's DONE
notice delivery, W2's artifact consistency, and W4's item-at-a-time tracking sound.

---

## W1 - Routed delegation

**Who:** any seat with an edge to another seat.
**Trigger:** work arrives that belongs to a different seat.

**Loop:** `send_work` puts a queue item in the recipient's queue to the recipient
`claim_work`s it to `complete_work` marks it done to **the platform enqueues a DONE notice
back to the sender**.

**Must not break:** the DONE notice reaching the sender. The sender learns its work
finished *only* through that notice; if it is lost, the work silently vanishes from the
sender's point of view and the delegation becomes a black hole. Second-order: the item
must be claimable by exactly one seat (a double-claim assigns one item twice).

**Done:** item `status: "done"` **and** a DONE item in the sender's queue.

**Capability:** the Router tools, installed at harness open (D16 - the bug was that they
were not). Org edges decide who may send to whom, and an unpermitted send fails loudly.

**Evidence:** `demo/offline.mjs`, `demo/offline-v2.mjs` (edge + capability gate),
`demo/race.test.mjs` (one winner), `demo/durability`-level restart proof in
`demo/persistence.test.mjs`. Dogfood finding F6 recorded this whole loop working
end-to-end (`docs/DOGFOOD.md`).

---

## W2 - Independent verification (author to reviewer)

**Who:** an author seat and a verifier seat that is not the author.
**Trigger:** a draft, claim or deliverable exists.

**Loop:** the **author sends the concrete artifact** to the reviewer to the reviewer
checks it **against the evidence** rather than against the author's description to the
reviewer either acks or sends back the exact defect to the author fixes it to the
originator closes the item.

**Must not break:** (a) the reviewer receives the *artifact*, not a summary of it -
a summary cannot be checked; (b) closure does not happen on the author's word alone -
silence is not a sign-off. This is exactly the team norm the previous rig already
encodes for its 2-member pods, and the reason `check` has a `no-verifier-seat` rule and a
`single-model-rig` rule.

**Two relationship shapes, one loop - and the operator asked which a "verifier" is.** W2 is the
same loop whether the reviewer is a *peer* or a *verifier*; what differs is the relationship, and
it changes what the reviewer needs:

| | Peer review | Verification |
|---|---|---|
| Relationship | symmetric - same craft, two seats in a pod reviewing each other's work | asymmetric - a seat whose role *is* checking |
| Covers | reasoning, notation, convention, whether the argument holds | that the claim is **reproducible** |
| Needs | the artifact itself, and the craft to judge it | a **different model family** (a shared model shares the blind spot) and **evidence it can re-run** |
| Example here | `theorist` to `editor` | `impl` to `qa` |

So "the verifier runs the tests" is right for the verification shape: re-running the oracle on a
snapshot is exactly what makes verification independent rather than a second opinion. A peer
reviewer may also run them, but that is not what makes the review a control. Both shapes are
served by the same tool need - **an artifact the reviewer can reproduce** - which is why the
snapshot in `docs/SEAT-TOOLS.md` (the verifier's environment is rooted at a disposable copy, so
it can execute freely without altering what it verifies) serves both rather than being verifier-
specific machinery.

**Done:** an explicit reviewer ack, or a flagged defect with the fix, recorded where the
item can be read.

**Capability:** a verifier seat (name/role matching the verifier vocabulary) on a
**different model family** from the authors it checks; and - this is the part that is not
built - **evidence a reviewer can re-check**. `complete_work` currently carries a
`resultSummary` string, which is a claim, not evidence (ROADMAP item 4). **This half is not
gated on the M3 security ruling**: evidence is a protocol change, not a capability grant - it
gives a seat no new power, only something checkable to report, so it can land before the tools
do. The tools are the gated half, and they carry conditions SC1-SC3 (`docs/SEAT-TOOLS.md`).
Until evidence lands, W2 holds only for work whose artifact is *text the reviewer can read in
the transcript*.

**Evidence:** `demo/check.test.mjs` (the verifier rule, including that a capability named
`peer-review` on an author does NOT count), `demo/defer.test.mjs` (a question round-trip
between seats), team norms' pair-review contract, D27's edge rule.

---

## W3 - Blocked on a question

**Who:** a seat holding an item, plus whoever can answer (another seat, or the human).
**Trigger:** the seat cannot proceed without a decision it is not entitled to make.

**Loop:** `defer_work(itemId, question[, to])` parks the item to the question goes to a
seat as real enqueued work, or to the human (nothing enqueued, because the operator's
channel is `status`/`watch`) to an answer arrives to `resume_work(itemId)` puts the item
back in the seat's hands to `complete_work`.

**Must not break:** (a) the park is **reversible** - an item parked with no way back is a
silent death, strictly worse than the prose it replaces; (b) the park is **visible** - a
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

## W4 - Intake, decomposition and tracking

**Who:** a coordinator seat (PM), and the operator who brought the request.
**Trigger:** a new request, from a person or from another seat.

**Loop:** intake to decompose into **one-concern** items with a proving test and an
acceptance to route each to the seat that should hold it to track to a terminal state to
report.

**Must not break:** every request becomes a tracked item. Work started outside the queue
cannot be seen, measured, aged or closed, so the failure is not "a task was lost" but
"the system's picture of its own work is wrong". Second: an item that must stop is
**closed with a reason** (blocked/handed-off/cancelled) rather than left to age silently.

**Done:** the request's items are all in a terminal state, and the operator has been told
which.

**Capability:** `send_work` and `peek_queue`; a coordinator with explicit outgoing edges
(D16 - coordinators need recipients or they cannot route anything); per-seat
`capabilities` so a route can require one. **Not built:** a blocking/deferral state for a
whole *workflow* (as opposed to one item), which is item 12, and any attempt/deadline
semantics, which is item 6.

**Surface decision (required at decomposition, mirrors D62's doc-acceptance):** every
capability an item builds or changes states which surface(s) expose it - `cli`
(verb/flag), `tui` (view/action), or `both` - with one line of why; pm does not
decompose an item whose surface decision is absent. The requirement is that the choice is
STATED and justified, NOT that both surfaces exist (forced parity is wrong). The decision
rule:

- state change -> `cli` mandatory (D21: cli.mjs is the operator/LLM surface), `tui` optional
- observation the operator acts on -> `both` (CLI for scripts/grep, TUI for the live cockpit)
- purely interactive affordance (scroll, selection, key nav) -> `tui`-only
- batch/contract/JSON -> `cli`-only

The vocabulary is the FEATURES.md `Surface` column (cli/tui/both). This is the decision
that keeps a feature from being ACCIDENTALLY missing from one surface.

**Evidence:** `docs/DOGFOOD.md` (the first dogfood session routed a real backlog item
`pm` to `worker` through the queue), `docs/QUICKSTART.md` Steps 4-6 (the same loop as a
walkthrough), team norms' "every new request becomes a queue item registered by the PM".

---

## W5 - Human oversight and intervention

**Who:** the human operator. Nobody else: this workflow exists so a person can see and
act without becoming a seat.

**Trigger:** "is anything stuck?", or a suspicion that a rig is doing the wrong thing.

**Loop:** `status` / `watch` show per-seat health and attention notices to the operator
follows one with `log <seat>` or `queue` to either steering the seat with `send`, or
changing the rig file and re-applying with `up`.

**Must not break:** **a viewer must never drive work.** Opening a harness resumes task
scheduling, so a passive `watch` that opened one would kick the very queue it is
observing. That is why the read commands open storage directly and `openHarness` excludes
viewers from `resume()` (D11). Second: an empty dashboard must never look like a healthy
quiet rig - wrong database, no seats, and idle-with-work are all visibly different states.

**Done:** the operator can name what is stuck, who holds it, and what they are waiting on.

**Capability:** the read commands, the attention vocabulary, and the wrong-database
guardrail (D18). **Not built:** any intervention that is not "send a message" or "edit
the file" - specifically no per-task abort or veto from the operator surface.

**Evidence:** `demo/watch.test.mjs`, `demo/watchview.test.mjs`, `demo/blocked.test.mjs`
(the two notice kinds), `demo/cli.test.mjs` (the wrong-database guardrail), D11, D18, D22.

---
## W6 - Landing and merge review

**Who:** the author seat lands its own branch after verification; `qa`/`auditor` verified it (W2); `pm`
routes a landing pass when several are outstanding. A user-facing change has designer/advocate sign-off.
**Trigger:** an item is `done` and its work is committed on an `<seat>-item-<id>` branch.

**Loop:** the author lands with `git merge --no-ff <sha>` so the sha becomes an **ancestor** of `main`,
runs the covering demo on the merged result, removes the item's clean worktree, and deletes the branch
with `git branch -d`. A branch that cannot merge cleanly goes back through W2 for a rebase - never force.

**The gate is a checklist the agent applies, not an auto-gate** (operator preference, 2026-10-17): a
**universal** gate (item id + one concern + explicit paths; independent review of the artifact;
`node --check`; the covering demo passes with failing-first evidence; clean merge; no push; never merge a
snapshot/archive branch), plus the **type block** that matches the change - **bugfix** (failing-first
repro + named root cause), **feature** (closed spec, right-layer tests, docs, rollback, serialization),
**research/spike** (report under `docs/reviews/` with a URL + evidence class per claim; findings mapped or
marked unverified; ROADMAP items raised), **docs-only** (links resolve, no code). The full checklist and
the exact landing procedure are in [`docs/runbooks/merge.md`](runbooks/merge.md).

**Must not break:** (a) `main` advances **serialized** - one landing at a time; (b) the landed sha is an
**ancestor** of `main`, or the worktree-prune criterion fails; (c) the artifact is **verified before it
lands** (W2), not after; (d) a branch is never merged while its worktree holds uncommitted edits.

**Verify later - do not over-automate:** there is deliberately **no `land` verb and no broker hook** -
landing is trusted to the agent, and the delegate runs the read-only branch audit (the Diagnose block in
`merge.md`) periodically. The measurement that makes the audit worth running - unlanded-verified count and
time-to-land - is ROADMAP item 100.

**Evidence:** `docs/BRANCH-AUDIT-2026-10-14.md`; `docs/runbooks/merge.md`; the 2026-10-17 audit (18
fully-merged branches deleted, 15 verified-but-unlanded flagged).

## The operator loop: a rig change under measurement

**Who:** operator or lead. **Trigger:** someone wants to change the rig - a model, a
seat, an extension, the constitution.

**Loop:** `check` first (it is a linter: is the rig structurally sound?) to write the
**predicted direction** for the measure the change is meant to move to make the change to
`metrics` afterwards, which now also reports the revision and whether the tree was dirty.

**Must not break:** the baseline is taken **before** the change. A measure that arrives
afterwards can only rationalise, and D24 accepts this as the cost of the loop being worth
anything at all. Second: a reading whose revision is dirty or absent is reported as such,
because an unattributable movement is not evidence.

**Done:** the operator can state the change, the measure, the direction predicted, and
whether it moved - or say `unknown`, which is a legitimate outcome.

**Capability:** `check` (eight rules), `metrics` (four measures), config provenance
(`DURIG_STREAM_TIMEOUT_MS` and friends), and a drill - **which does not exist** (item 2's
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
| Router tools (`send`/`claim`/`complete`) | W1, W2, W3, W4 | **seed** - installed at harness open (D16) |
| Deferral tools (`defer`/`resume`) | W3 | **seed** - D32 |
| `peek_queue` | W4, W5 | seed |
| Org edges + capability tags | W1, W3, W4 | rig file; `check` catches missing edges |
| Verifier seat, distinct model family | W2 | rig file; `check`'s `no-verifier-seat` + `single-model-rig` |
| Constitution | all | rig file; `check` catches declared-but-not-applied |
| Read commands + attention vocabulary | W5, operator loop | seed - D11, D18 |
| `check` + `metrics` + provenance | operator loop | seed - D24, D25, D28 |
| **Evidence in `complete_work`** | W2 | **absent** - a protocol change, NOT gated on loop #5 (SC1-SC3 gate the tools, not this) |
| **Retrieval / corpus tools** | W2 | **absent** - item 4 (M3) |
| **A drill task set** | operator loop | **absent** - item 2's other half |
| Attempt/deadline semantics | W4 | **absent** - item 6 |
| Whole-workflow phases | W4 | **absent** - item 12 |
## Who owns this, and where the workflow set comes from

The `workflows.advocate` seat owns this document. Its hardest job is one the operator
named when the seat was created: **how do you collect feedback from the users of a
workflow when you may not have any?** The answer is not to guess. It is to label where
each workflow came from, permanently, and grow the honest set deliberately.

Three admissible classes:

- **observed** - we ran it. A dogfood session, a demo, an operator report. This is the
  only class that means "somebody here actually uses this".
- **advertised-elsewhere** - another platform documents supporting it. That makes it a
  **candidate**: it says the workflow is real and worth considering, not that anyone here
  wants it.
- **inferred** - reasoned from our own design, and labelled as reasoning.

Today, honestly:

| Workflow | Class | Why |
|---|---|---|
| W1 routed delegation | **observed** | dogfood finding F6 ran the full loop; QUICKSTART steps 4-6 |
| W2 independent verification | **inferred** + advertised-elsewhere | the team norm and the pair-review contract, but **not yet observed under durig** - and its evidence half does not exist (item 4) |
| W3 blocked on a question | **observed (offline only)** | `demo/defer.test.mjs` drives the real tools; no live run has deferred an item yet |
| W4 intake / decomposition / tracking | **observed** | the first dogfood session routed a real backlog item `pm` to `worker` through the queue |
| W5 human oversight | **observed** | the operator reads `status`/`watch`/`log` against the live store routinely |
| Operator loop (rig change) | **observed** | run on the live rig, e.g. the `DURIG_STREAM_TIMEOUT_MS` change |

That table is the honest scoreboard, and it is uncomfortable in the right way: **only one
workflow is observed in a live multi-seat run**, because seats still cannot do real work
(item 4). It also means "collect feedback" has a concrete meaning today - the operator's
reports and our own dogfood findings, both already recorded - rather than a survey nobody
can run.

**Widening the set.** The operator's suggestion, and a good one: derive candidate
workflows from **what competing platforms advertise supporting** (agent-orchestration
frameworks, durable-workflow engines, multi-agent product suites). Each candidate arrives
labelled `advertised-elsewhere` and graduates to `observed` only when somebody here runs
it. That is roadmap item 26, and it is the right order - observed first, candidates
second - because a workflow list that grows from a competitor's feature page is a list of
hypotheses, not of users.

## Deriving "recommended" (the point of this document)

The first thing the matrix shows is that **"recommended" for durig is mostly rig shape,
not extensions.** Every workflow is served by the seed tools; what actually varies between
a rig that works and one that does not is which seats exist, which model each runs, and
which edges join them - and `check` already has rules for exactly those. So item 18's
profiles should default to:

- **core** - the Router. Not optional: no workflow exists without it, and it is one
extension, so "off" is not a state a working rig has.
- **recommended** - a *rig shape*, applied as configuration: a verifier seat that is not
an author, on a different model family; a constitution; an outgoing edge on every seat.
These are the three things `check` can already fail a rig for, so shipping them as
"recommended" means shipping the configuration that passes the linter.
- **opt-in, workflow-specific** - currently **nothing**. The first real candidate is
retrieval for W2's evidence half, and that is an operator scope ruling (item 4), not a
default anyone should inherit.
- **not recommended by default** - terse-voice extensions (caveman's skill). It helps
seat-to-seat coordination and is actively wrong for a product's user-facing
explanation, which is the role-scoping axis item 20 already identified. Under D29's
cost rule ("off must cost nothing at all") it must therefore be off, and switchable per
seat role rather than rig-wide.

This is the derivation item 18 was missing. It also predicts the shape of item 18's work:
a *profile* is a preset rig file plus a seed list, not a bundle of extensions.

## What this settles, and what it does not

**Settles - three decisions re-read as workflow decisions.** The roadmap noted D21, D22
and D24 were taken ad hoc; with the workflows named, each has a reason:

- **D21 (non-interactive CLI)** is W5 and the operator loop. The operator is a person or
an LLM driving commands, and the loop must not break when nobody is watching. An
interactive prompt would be a blocking gate in W1's must-not-break path.
- **D22 (seats are not terminals)** is W1-W4. A seat is a queue participant; making each
seat a terminal would make the *seat* the unit of attention, when W5's must-not-break is
the rig's state, not any one seat's screen.
- **D24 (measurement, not a list)** is the operator loop, whose must-not-break is the
baseline-before-change rule.

**Does not settle:** the drill's task set (a content decision), which extensions ship in
"recommended" (item 18's own work), whether seats get real tools (the operator ruling,
loop #5), and the pods question (item 11).

**Known gap in this document:** W2 is written as the intended workflow and is **not fully
supported** - the evidence half is missing. Naming the loop lets us see that the
verification workflow holds today only for artifacts a reviewer can read in a transcript,
and that is a real limit on what the product rig can be trusted to do.

## Docs ownership

**Norm:** the seat with the most knowledge about a topic writes its docs; the scribe audits,
edits, and delegates for docs other seats own. Concrete mapping:

| Doc category | Author | Scribe role |
|---|---|---|
| Source code, tools, harness, `src/` | `impl` / `devtools` | audit + edit |
| Rig files, seat roles, edges | `pm` / `lead` | audit + edit |
| Verification results, test coverage | `qa` / `auditor` | audit + edit |
| Feature / status / README surfaces | `scribe` | write + maintain |
| Workflows, decisions, recommendations | `advocate` | — (owner) |

**Must not break:** none. This norm is an *organizational* rule about who writes docs - it
does not participate in any W1-W5 loop's must-not-break path. The closest touchpoint is W4
(intake/decomposition): when pm decomposes a doc item, it routes to the knowledge seat, and
the scribe may follow up with an audit/edge-fix. The scribe's send edges to `pm`, `impl`, and
`advocate` (`rig.selfdev.json` edges lines 194-199) give it the reach to delegate audit tasks
back to the authors it reviews. No loop is weakened or removed by this norm - it exists to
prevent stale docs, which is a W5 concern (operator trust in the surface).

**Capability:** `read` + `edit` tools (for `impl`, `devtools`, `scribe`), send edges for
delegation, `peek_queue` for tracking doc items to completion.
## Decision rights (compact, decision-class keyed - NOT a task grid)

A full RACI/DACI/RAPID/MOCHA grid is REJECTED as redundant (D74) - redundant against this
document's role table, docs-ownership norm and capability matrix, and the queue's single
claimer, whose single-Accountable-per-task assumption this team's artifact-keyed ownership
contradicts. What durig keeps is the DECISION-AUTHORITY layer those frameworks exist to
supply, recorded at decision-class granularity with the enforcement named so it cannot go
stale unnoticed. Keyed to decision/artifact CLASS, never per task:

| Decision class | Owner | Consulted | Enforced by | Escalates to |
|---|---|---|---|---|
| Surface decision (cli/tui/both) | `designer` | `advocate`, `scribe` | W4 decomposition gate (pm does not decompose without it); FEATURES.md `Surface` column (D73) | `lead` |
| Decomposition + priority | `pm` | `lead` | the queue itself (every request = tracked item; single claimer) | `lead` |
| Scope ruling | `lead` | `pm` | the decision record (DECISIONS.md carries the WHY); safety wins explicitly | operator |
| Docs truth | `scribe` | `owning seat` | D62 doc-acceptance (FEATURES row verified by partner-check) | `pm` |
| Workflow fit | `advocate` | `designer`, (raising) lead/operator | partner-check on adoption; WORKFLOWS.md ownership | `lead` |
| Verification verdict | `qa` (peer: `auditor`) | author seat | different-model-family `check` rule; W2 re-execute-evidence (item 48) | `lead` |

This is the research review's smallest form (four columns, not R/A/C/I lettering -
docs/reviews/Agent_Ownership_Review.md Part 5). Honesty note (D74): the enforced-by column
names what does the real work TODAY (queue mechanics, the edge gate, D62's partner-check,
the model-family rule) and what is named-but-not-yet-built (the surface-decision and
artifact-ownership check rules are ROADMAP item 46, registered, not scheduled); until then
this table is a ledger for machine-checkable claims, not a substitute for them.