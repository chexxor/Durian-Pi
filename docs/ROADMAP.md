# durig — roadmap

Ordered by operator value; each item names its motivating finding.
State as of **2026-10-11**: items 0, 1, 1a are done and item 2's measures and
surface are built (its *drill* is not — see 2 below); the docs pod (`scribe`) was
added to the rig on top of 1a. Work continues at item 2's drill, then item 3.
`docs/STATUS.md` is the handoff record; `docs/DECISIONS.md` holds the reasoning,
and D23 records how this roadmap was re-ordered by the research. Gap-table
handlings name their item rather than numbering it: the numbers had already gone
stale once when item 0 and 1 were added.

## Milestones

- **M1 — Rig runs and routes. ✅ done.** Queue semantics, org edges, Router at
  harness open, seat prompts, real-model e2e (D3, D4, D5, D16).
- **M2 — Operator can see the rig. ✅ done.** `watch`/`log` human views, live
  stream on `send`, turn-grouped transcripts with timestamps, wrong-database
  guardrail (D18, D19, D20).
- **M3 — Seats can do work, and the rig verifies it. ⏳ next.** Two things that
  are one work item (D23): seats hold only the four queue tools, so they cannot
  read a corpus or run a check; and `complete_work` is self-declared, with no
  evidence attached and no verifier step. A verification the rig cannot run is a
  promise, not a check.
- **M4 — Interactive client over the same store.** Deferred by decision (D21),
  not by accident. Blocked on choosing TUI vs browser, which needs an operator
  ruling.

## Gap analysis vs the research (2026-10-10)

Failure modes named by the MAST taxonomy, Anthropic's production and swarm
research, and the practitioner consensus, against what durig implements today.
Sources and reasoning: D23.

| Failure mode (source) | durig today | Handling |
|---|---|---|
| Silent shared-state corruption (practitioners: most underrated) | impossible — one writer, atomic document revisions, no shared scratchpad | nothing to do |
| Loss of conversation history (MAST FC1) | impossible — conversations are durable rows | nothing to do |
| Orchestration topology | orchestrator-worker (`pm` decomposes, workers claim), not a flat swarm | matches the strongest takeaway |
| Agents lack social technology (Anthropic swarm) | thin substrate exists: constitution, restrictive-by-default edges, append-only transitions | extend, not build |
| No / incomplete verification (MAST FC3) | `complete_work` self-declared; no evidence, no verifier step | real seat tools + verification evidence (M3) |
| Step repetition (FC1, 15.7% — most frequent) | undetected | termination and attempt semantics |
| Unaware of termination conditions (FC1, 12.4%) | no deadline, no attempt cap | termination and attempt semantics |
| Fail to ask for clarification (FC2, 6.8%) | no verb that blocks on a decision; a seat in doubt writes prose | a deferral verb |
| Information withholding (FC2) | role prompt only — a seat cannot retrieve the corpus | real seat tools (M3) |
| Correlated failure / low variance (Anthropic swarm) | 14 seats, 1 distinct model, 1 constitution | verifier model diversity |
| Resource stampede (Anthropic swarm) | agents hold no polling tool | keep it that way — real seat tools (M3) |
| Collusion / sabotage (Anthropic swarm) | cooperative by construction; no adversarial objective, no shared market | monitor only |
| Cost, ~15x tokens (Anthropic production) | cheap model by default; offline faux provider for tests | keep — a reason not to default to frontier models |
| Observability (practitioners: "state, coordination, failure isolation, observability") | strong: `watch`, `log`, turn-grouped transcripts, per-seat highlights | nothing to do |
| Reputation / veto rights (practitioners) | edges only; no veto, no quorum, no arbitration | deferred |
| A reason to defer to humans (Anthropic: open problem) | none | human approval gate hook, promoted |

## Measuring the research concerns

A gap table says where a rig stands once. The question worth answering is whether
an instance is getting **worse over time**, and whether a configuration change
helped or hurt. That is affordable here for a structural reason: the store already
records the whole interaction — every message, every tool call with its arguments,
every queue transition, every completion — so the concerns are **derived, not
instrumented**. A measure is a read-only query over data we already persist: no new
write path (the single-writer discipline holds), no telemetry, no network.

Proposed: `node cli.mjs metrics [--json] [--window <since>]`, one line per concern,
each labelling its evidence class.

| Concern | Measure | Source | Evidence class |
|---|---|---|---|
| No / incomplete verification (FC3) | share of completions followed by no independent check | queue transitions + per-item actors | direct — and it reads 1.0 *unverified* today, which is the baseline, not a bug |
| Step repetition (FC1) | repeat runs of an identical tool call (name + args) within one conversation | entries | direct |
| Unaware of termination (FC1) | items claimed and never completed, with age; re-claims per item | queue transitions + timestamps | direct |
| Fail to ask for clarification (FC2) | work items addressed to a seat that drew no reply | entries + queue | proxy — question intent is not machine-readable |
| Information withholding (FC2) | completions whose claimer made no retrieval call | entries | direct, and reads 1.0 today because no retrieval tool exists |
| Correlated failure (swarm) | distinct models per seat; author and reviewer sharing one | rig spec + seats doc | config-derived, not a rate |
| Resource stampede (swarm) | tool calls per minute per seat, and the peak | entries | direct |
| Cost (~15x tokens) | tokens per completed item | entries | proxy — entries carry no usage field, so turns / tool calls / prompt size today; exact tokens need the provider seam the live view and generation slots already tap |
| Deferral to humans | escalations raised, and time until answered | queue | direct, reads 0 until the deferral verb lands |
| Collusion / sabotage | — | — | not applicable: no adversarial objective, no scarce shared resource |
| Observability | — | `watch`, `log` | already the strength; a check, not a rate |

**Two honest limits, which the command must print rather than hide.**

1. *A clean measure can mean the capability is missing.* Verification has no
   independent checks today because nothing can check — a measure that reported an
   all-clear would be a lie. Every measure therefore declares its **direction and
   its blind spot**, and none may be read as a pass.
2. *Rates need denominators.* A window over real usage confounds "the rig got
   worse" with "the work changed". Passive windows are cheap and are labelled
   **confounded**; a *drill* — a fixed task set replayed against the rig — is what
   makes two configurations comparable, and D14's blind judge benchmark is the
   existing harness in spirit. A drill needs the faux provider or a small real
   budget.

**The review loop (the point of measuring).** A configuration change is a
hypothesis with a *direction*, recorded **before** the change: what changed, which
measure should move, and which way. Then re-measure. A change whose measure does
not move as predicted is a candidate for reverting — D14's preservation guard,
applied to configuration instead of instructions. Without the predicted direction
written down first, any later movement can be rationalised after the fact.

**Not doing:** no telemetry or egress of measures (which would require a
`security.sec` consult before it ships), no new tables, no measure that needs a new
write path, no dashboards. `metrics` and the `check` audit share the read API with
`watch`/`log`/`status` (near-term 8) — one reader, several views.

Where these measures reach a human, and the traps that make them useless if
gotten wrong — surfacing tiers, scope, notice lifecycle — is `docs/METRICS.md`.

## Near-term

0. **Fix the dropped constitution. ✅ done.** `scripts/from-openrig.mjs` emits
   `constitutionInline`, but `cmdUp` read only `spec.constitution`, a file path —
   so the field was dead and a converted rig's constitution never landed.
   Confirmed by reading storage: `tutor-pi.sqlite` held the 411-byte generic
   `constitution.txt`, not the tutor-pi team culture, so all 13 seats ran without
   the rig's own grounding rule while appearing correctly configured. Fixed in
   `cmdUp`, with `demo/constitution.test.mjs` covering inline, file, absent and
   both-set specs, shown to fail against the old behaviour before it passed.
   *Applied 2026-10-11:* `DURIG_DB=./tutor-pi.sqlite node cli.mjs up
   rigs/tutor-pi.rig.json`, after backing the store up to
   `C:/tmp/tutor-pi.sqlite.bak-2026-10-11`; the stored text is now byte-identical to
   the spec's `constitutionInline` (1094 bytes, `# tutor-pi team culture`).
   *Open design question it exposed:* a rig constitution **replaces** the generic
   default rather than augmenting it, so those seats no longer carry the generic
   P1/P2/P3 priority framing. The team culture restates all four rules, so nothing
   load-bearing was lost here — but a rig culture that did *not* restate them would
   silently drop durig's own norms, and nothing today would say so. A candidate
   `check` rule.
1. **`check` — audit a rig against the research gaps, and a hardened starter.**
   Non-interactive (D21): JSON when piped, human on a TTY. Reports per concern —
   independent verifier seat present; author and reviewer on different models;
   constitution states deferral and attempt discipline; every seat can reach the
   seats it must work with (the D16 bug class); a constitution is present at all
   (catches 0); no seat holds a polling tool. Each finding carries a severity and
   the exact fix. Paired with a starter rig whose defaults are the hardened ones.
   **✅ done (2026-10-11)** — six rules with stable ids, severity by *who can fix
   it* (`error` exits nonzero, `fix-now` never does), and any rule it cannot judge
   reported as skipped-with-reason rather than a pass (D25). Built as a pure
   module plus a CLI wrapper; `demo/check.test.mjs` is the 19th demo. The
   `constitution-not-applied` rule is the regression it was built from.
   *Found by it:* the converter never reads OpenRig's rig-level `edges:` list
   (D26), so `ux`, `sec` and `dev` cannot initiate a send and qa/qa2/student lose
   their declared escalation path.
   *Still open:* the hardened starter rig — the rules exist, but nothing yet hands
   a new user a spec that passes them.
1a. **Fix the converter's dropped rig-level edges (D26).** `scripts/from-openrig.mjs`
   derives edges from `agent.delegates_to` and each pod's `edges:` block only, so
   the rig-level list (`escalates_to`, `collaborates_with`, `can_observe`) never
   reaches the spec. Read it and normalise qualified ids (`build.qa`) to seat
   names (`qa`), then re-run the converter so `check` reports a clean rig. One
   concern, one test: the demo suite gains a converter case asserting the
   rig-level edges land.
   **✅ done (2026-10-11)** — rig-level edges are read, `pod.member` ids are
   resolved (and a stale prefix is caught rather than resolving to the bare
   name), unresolvable endpoints warn instead of vanishing, and warnings now
   print on stderr even when the spec goes to stdout. `demo/converter.test.mjs`
   is the 20th demo. Regenerating restored every lost permission: `check`
   reports no `unreachable-seat`, and the only finding left is
   `single-model-rig` (item 3). The stale `test-fixture-rig.yaml` — which
   crashed the converter while three docs cited it as proof — is deleted.
   *Added on top:* the `docs` pod with the `scribe` seat (D27).
2. **The measurement scorecard, and the surface that makes it used.** Two halves of
   one item: the measures themselves (`metrics`, the declared direction and blind
   spot per measure, and a drill task set so two configurations are comparable), and
   the UX that makes them ambient rather than dead code — notices riding the
   existing attention channel in `status`/`watch`, seat-scoped or rig-scoped as the
   measure declares. Design settled in `docs/METRICS.md`, including the open
   questions to answer when work starts. It must land **before** the changes it is
   meant to judge — item 3 and the M3 work — because D24's loop takes the baseline
   *before* the change, and a measure that arrives after it can only rationalise.
   `docs/METRICS.md`'s first cut already includes `shared-reviewer-model`, the
   measure item 3 turns on.
   **✅ done (2026-10-11): the measures and the surface.** `src/metrics.mjs` is the
   pure scorecard; `metrics [rig.json] [--window N|all]` is the deliberate view;
   notices ride the existing attention channel in `status`/`watch` with `scope`
   added alongside `seat`, and only when a measure has moved. Four measures, so the
   queue scope the ruling added is real rather than declared. `demo/metrics.test.mjs`
   is the 21st demo, and most of it asserts what a reading *refuses* to claim
   (D28). One scan shared with the watch highlights: 0.9–1.4 ms for 14 seats × 24
   entries against a 750 ms poll.
   **Still open: the drill.** The item's other half is a fixed task set that makes
   two configurations comparable — D24 labels a passive window **confounded**,
   because it cannot separate "the rig got worse" from "the work changed". Until
   the drill exists, `metrics` is honest but only correlational, and item 3's
   before/after comparison is confounded by construction. Deliberately not
   skipped: it needs a task set hard enough to move the measures, which is a
   content decision, not a code one.
3. **Verifier model diversity.** All 14 seats resolve to one model while per-seat
   models are already supported (`resolveSeatModel`), so a bias is systemic rather
   than isolated (Anthropic swarm). Give the verifier roles (`qa`, `qa2`) a
   different model family from the authors they check. Configuration-only, and the
   first change item 2 should judge: write the predicted direction for
   `shared-reviewer-model` down **before** the edit, then re-measure.
4. **Real seat tools plus verification evidence (M3, and the largest item).** A
   live worker seat reported "no codebase visible … no file system access, no code
   execution" and correctly refused to claim a finished deliverable — the
   constitution working on top of a missing capability. Needs an operator ruling
   on scope: read-only corpus access first, or file edits plus a test runner.
   Whichever is chosen, `complete_work` should carry evidence a verifier can
   re-check, which is what turns MAST FC3 from a norm into a mechanism. Seats must
   get **no polling tool** in the process.
5. **A deferral verb.** Today a seat that needs a decision can only emit prose.
   Add a way to raise a question that blocks the item and hands it to the seat or
   human who can answer — the "reason to defer to humans" the swarm paper leaves
   open, and the mechanism our own pair-review and Ledger norms currently assume.
6. **Termination and attempt semantics.** No deadline, no attempt cap, no
   repetition detection: the two most common MAST design failures (step repetition
   15.7%, unaware of termination 12.4%) are both unaddressed. Subsumes the
   block/park/wake-after semantics raised against Core_Ideas layer 7.
7. **Extract the view model and peer navigation graph (D21).** Pure functions:
   turns, collapse state, and "which seat sent to / received from this seat",
   derivable from queue items' `from`/`to` and the Router tools. Unblocks both
   interactive asks without committing to a screen model.
8. **One shared read API.** `watch`, `log`, `status`, `check` and `metrics` each
   re-implement seat, health and queue reading today; that duplication is the real
   refactor smell, ahead of any formatting concern. It now has five consumers, so
   the seam is forced rather than speculative.
9. **Repeat-call tolerant tools** — a second `claim_work` in one invocation errors
   with `Cannot use a settled overlay` (RESEARCH.md R2). Tools should return
   current state on repeat calls; models retry naturally.
10. **`log --follow` consistency** — it prints the backfill as one block and each
    later entry on its own, so column alignment and turn grouping differ between
    them. Small, self-contained.
10a. **A `stray-seat` rule in `check`.** The store can hold a seat the spec does not
    declare: the live `tutor-pi.sqlite` carries a `worker` left over from an
    earlier `up` of `rig.v2.json`, and `up` only ever adds or refreshes, so it
    stays and nothing says so. `check` already reads both sides in one pass, which
    is exactly this class of disagreement, so the rule is a fit rather than a new
    mechanism. The finding must name the seat and be honest that clearing it is a
    store rebuild or an explicit removal, not a spec edit. Found while measuring
    the metrics cost; requested by the operator.

## Mid-term

11. **Pods design decision** — OpenRig parity question deferred twice:
    namespace-scoped queues vs a flat queue with pod tags. Needs an operator ruling
    before implementation (the converter currently drops pods with a warning).
12. **Workflow task type** — SOP-style phases enqueueing queue items and waiting on
    DONE notices, built on PD's durable task graph (Core_Ideas layer 7).
13. **Seat handover on context exhaustion** — PD has compaction; the OpenRig
    handover-packet flow does not exist yet.
14. **Measurement history** — persisting scorecard snapshots per config revision so
    the before/after comparison in the review loop is a lookup rather than a
    re-run. Deliberately not in the first cut: it adds a write path, which is why
    it waits until passive windows have proven useful.
15. **Drill harness** — the fixed task set plus faux-provider replay, if the
    benchmark half of 3 turns out to need more than a script.
16. **Human approval gate hook** — PD hooks can block tool calls pending an
    operator decision. Promoted by D23: the swarm paper names deferral to humans as
    an open problem, and this is the mechanism that answers it.
17. **Interactive client (M4)** — only after (7) and (8). If chosen, prefer
    `@earendil-works/pi-tui` (already a dependency of `pi-coding-agent@1.1.0`, so
    it is in-stack) over adopting a new framework; the browser/SSE client is the
    cheaper option if the interaction set stays small.

## Extensibility and distribution

From the operator: should durig ship as two editions (`durig-core` and `durig`),
or as one system with well-considered optional extras — and does the measure layer
make an extension's effect visible? The answers below are the argument, not yet a
ruling.

**The cost model first, because it decides the whole question.** For durig the
burden of an unused feature is *not* disk and *not* speed: the per-seat scan
measures 0.9–1.4 ms, so runtime cost is negligible. The binding costs are (a)
prompt tokens on every request, (b) **which tools the model sees**, which changes
seat behaviour rather than just its bill, and (c) the test and documentation
surface. A feature that is off must therefore cost nothing — not "little".

18. **An extension registry with named profiles — not two editions.** Two
distributions means two test surfaces, and our own evidence says the untested one
rots: a committed converter fixture that crashed on contact was cited as proof by
three documents, one of them an acceptance item marked PASS. A profile is *data*
(`{"profile":"recommended"}` or an explicit enable list); an edition is an
artifact to build, publish, and forget. So: one artifact, one suite, and `core` /
`recommended` / custom as configuration. Each extension declares its own cost
(prompt tokens, tools added), its default, and its **blind spot** — the same
discipline `check` and `metrics` already follow, since a declaration that travels
with the thing is the only kind that stays true. Open question for the operator:
which workflows define "recommended" (see 21).
19. **Extension provenance, so a measure can be attributed to a change.** Today the
   answer is **no**: entries carry a model and a timestamp and nothing about which
   extensions were active, so `metrics` can see that `step-repetition` moved but
   not that an extension was enabled when it did. The seam already exists — D24's
   review loop records a prediction before a config change and re-measures after.
   Cheapest correct version: a rig is driven by a committed spec, so **git is
   already the append-only change log**, and `metrics` only needs to report the
   active set for the reader to line the two up. That may remove the need for the
   deferred write-path change-log entirely, which would also retire the
   `security.sec` debt D24 and D27 carry. Verify before believing it.
20. **Caveman as an optional extension — spike first.** `juliusbrussee/caveman`
   is two things: a **skill** (output voice, ~1,160 prompt tokens/request, ~3% 
   median output saving on top of "be concise", much more for `/ultracave`) and a
   **proxy** (compressing what the agent *reads*: logs, CSV, YAML, JSON, test
   output; vendor-reported 33.2% session input-token reduction). Three things to
   settle before any of it ships: (i) **it may not apply to us** — durig does not
   run the `pi` CLI, it drives pi-durable in-process, so `caveman pi` cannot wrap
   it and only the middleware path could; that is exactly a timeboxed spike, not
   an assumption. (ii) **Telemetry is on by default** (`caveman telemetry off`,
   `DO_NOT_TRACK=1`), which is network egress, so a `security.sec` position comes
   **before** adoption under our own norms. (iii) **Scope it by seat role**: terse
   is fine for seat-to-seat coordination and wrong for a textbook tutor's
   student-facing explanation — the same seat-role axis `check`'s verifier rule
   already reasons about. And we cannot yet verify the savings ourselves: there is
   no token or cost measure, because entries carry no `usage` field (D24 evidence).
21. **Target workflows, written down.** Honest answer to "have we considered
   that": **partially, and never in one place.** The MVP bar, the feature
   inventory, the gap table and `RESEARCH.md`'s topology notes each carry a piece,
   but nothing names the workflows we intend to support and their must-work loops.
   Consequence: "recommended extensions" (18) and build order are decided without
   that frame, and D21 (non-interactive CLI), D22 (no per-seat terminal) and D24
   (measurement) are workflow decisions taken ad hoc. Deliverable: `docs/
   WORKFLOWS.md` naming 3–5 workflows — who, trigger, the loop that must never
   break, what "done" means, which capability it needs — after which
   "recommended" is derivable instead of taste.

## Explicitly deferred (with reasons)

- **Reputation, veto and quorum arbitration** — the practitioner fix for
  "verbose non-decisions", but durig's seats have no adversarial objective and no
  competing claims over scarce resources, so the mechanism would police a failure
  mode the rig cannot currently produce (D23). Revisit if seats are ever given
  conflicting objectives.
- **Flat peer swarms** — the topology the evidence is most consistent about
  avoiding; durably wrong for this rig, not merely deferred.
- Textual interaction in `cli.mjs` itself — would break the JSON contract the
  seats drive (D21).
- Alternate-screen TUI with in-place collapsing — forces mouse reporting and full
  repaint, losing scrollback and pipes, and is the worst-supported combination
  with tmux (RESEARCH.md, "Formatting a transcript").
- Terminal multiplexing as a dependency — no per-seat terminal exists to attach to
  (D22).
- Real push instead of polling — SQLite has no cross-process notification; Honker
  and tailite are catalogued in RESEARCH.md but Windows support is unverified.
- Constitutional-evolution search, Big-Five trait injection, FIPA-ACL performatives,
  Contract-Net auctions, dynamic persona generation, blackboard architecture —
  evaluated against Core_Ideas.txt; rationales in DECISIONS.md.
