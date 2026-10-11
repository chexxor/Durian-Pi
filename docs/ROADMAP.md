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
| Cost (~15x tokens) | tokens per completed item | entries | **direct** — corrected 2026-10-11: entries DO carry `usage` (input/output/cacheRead/cacheWrite) and a `cost` breakdown; the provider seam is not needed (F4, `docs/DOGFOOD.md`) |
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
   **✅ done (2026-10-11)** — eight rules with stable ids (six when this landed;
   `store-missing-seat` and `stray-seat` came with 10a), severity by *who can fix
   it* (`error` exits nonzero, `fix-now` never does), and any rule it cannot judge
   reported as skipped-with-reason rather than a pass (D25). Built as a pure
   module plus a CLI wrapper; `demo/check.test.mjs` is the 19th demo. The
   `constitution-not-applied` rule is the regression it was built from.
   *Found by it:* the converter never reads OpenRig's rig-level `edges:` list
   (D26), so `ux`, `sec` and `dev` cannot initiate a send and qa/qa2/student lose
   their declared escalation path.
   **✅ done (2026-10-11), both halves.** The rules were the first; the starter is
   the second: `rig.starter.json` is that spec — four generic seats
   (`pm`, `impl`, `qa`, `lead`), an inline constitution so the file is
   self-contained, a verifier seat on a second model family, and an outgoing edge
   for every seat. `demo/starter.test.mjs` is the 23rd demo, and it does not stop
   at asserting a clean report: "0 findings" is also what `check` prints when every
   rule is skipped, so the test breaks a copy of the starter five ways and requires
   each rule to fire — the second model removed, a seat left stranded, an edge to a
   nonexistent seat, the verifier renamed, and a store created but never `up`-ed.
   Named `rig.starter.json` rather than a second template so there is one obvious
   place to start; the delivery half of this goal — proven with a demo on Windows,
   recorded in `docs/MVP.md` — is still owed (item 22 covers publishing).
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
1b. **The scribe's security conditions, before it is applied anywhere.** The
   position is in (2026-10-11, `docs/reviews/security-sec-deferred-three-items.md`)
   and it is a **FAIL as scoped**: the persona's prose prohibition is not a
   control, because every seat runs as the same Windows user (D-ENV-AUTH) — so
   "never copy a secret out of a transcript" is a norm, not a mechanism, and the
   scribe would read seven seats' transcripts including `devtools.dev`, which
   handles credentials. Required before it goes live: a fail-closed secret/PII
   gate on what may be republished that a **canary can falsify**, plus an explicit
   republish allowlist. Cheaper alternative it offers: drop the `devtools.dev`
   observation edge. This is a scope-vs-security conflict, so `security.sec`
   escalated it to `advise.lead` (`qitem-20261011052428-c1e0716d`, urgent,
   `gate:spec-review`), and its dissent is preserved if the conditions are
   skipped. Nothing here is applied to the live rig, so this gates the *first*
   application rather than rolling anything back.
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
   → *Caveman (20) forward-note:* the drill is also the only instrument that could
   verify caveman's own claims. **Correction 2026-10-11 (F4):** a token counter is
   now known to be possible and direct-class, because entries DO carry `usage` and
   a `cost` breakdown — so build it to feed `computeMetrics` as another evidence
   source rather than printing its own report, or caveman can never be judged by
   the same loop as everything else.
3. **Verifier model diversity.** All 15 seats resolve to one model while per-seat
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
   → *Caveman (20) forward-note:* this item adds the read tools whose output a
   compressor would rewrite, so keep tool results flowing through **one seam**
   (`toolText()` in `src/rig.mjs` is already that seam) instead of letting each
   tool format its own output — a proxy cannot be inserted later if there are
   twenty places to insert it. It is also where role scoping becomes real: not
   every seat gets corpus access, which is the same axis caveman needs.
   → *Grounded 2026-10-11:* this is much cheaper than this item assumed. Pi Durable
   ships the tools as an extension — `registry.install(CodingTools)` gives read,
   write, edit and bash — plus a Node execution environment
   (`@earendil-works/pi-durable/env/node`, passed to `Harness.open` as `env`). So
   "seats can read and run things" is two lines of wiring, not a subsystem. What
   stays hard is what the item is really about: the **scope ruling** — bash on the
   operator's machine is arbitrary code execution, which is exactly why loop #5 is
   open and why a `security.sec` position comes first — and the **evidence** half,
   `complete_work` carrying something a verifier can re-check.
   → *From the demos (24c):* `ExecutionEnvs` in `harness-setup.ts` is this wiring in
   ten lines — `NodeExecutionEnv` keyed by cwd, handed to the harness as `env`, with an
   explicit `cleanup()` somebody has to call. Still the scope ruling that gates it, not
   the code.
   **✅ the tools half landed (2026-10-11); the evidence half is what remains.** Conditions
   SC1–SC3 are implemented and proved (`src/confine.mjs`, `demo/confine.test.mjs`): a
   root-confining `ExecutionEnv` covering bash AND the file tools, `inheritEnv` forced false with
   an allowlist, and a verifier's read-only file API. `src/seatguard.mjs` adds the `beforeTool`
   guard — the control D38's risk acceptance had assumed existed — including a `git push` refusal
   whose only exemption is a grant the operator sets in durig's own environment, which a seat
   cannot forge. `src/seattools.mjs` installs read/write/edit/PowerShell per seat (no bash:
   native-Windows bash is an undeclared Git Bash dependency) and removes write/edit from verifier
   seats; `openHarness` supplies the confining environment and the roster, and `up` scopes the
   verifiers. `src/worktree.mjs` + `node cli.mjs worktree` gives an item its own checkout, which is
   what stops seats editing the live tree.
   **Still open — the evidence half:** `complete_work` carries a `resultSummary` string, which is a
   claim, not evidence. Until it carries something a reviewer can **re-run**, a verifier checks a
   sentence and W2 stays `inferred`. That is the next thing, and it is a protocol change rather
   than a capability grant, so no security position gates it (see `docs/SEAT-TOOLS.md` for what is
   built and `docs/CODEMODE.md` for what lands on top).
5. **A deferral verb.** Today a seat that needs a decision can only emit prose.
   Add a way to raise a question that blocks the item and hands it to the seat or
   human who can answer — the "reason to defer to humans" the swarm paper leaves
   open, and the mechanism our own pair-review and Ledger norms currently assume.
   **✅ done (2026-10-11).** Two tools, because one would have been a trap:
   `defer_work(itemId, question[, to])` parks a claimed item (`status: deferred`,
   recording the question and who is expected to answer) and `resume_work(itemId)`
   takes it back. Deferring without a resume path would turn "I need an answer"
   into "this item is silently dead", which is worse than the prose it replaces.
   The two destinations are genuinely different, so they are different code paths:
   omitting `to` defers to the **human operator** and enqueues nothing, because
   the operator's channel is `status`/`watch` attention, not the queue (a machine
   must not launder a human decision into seat-to-seat traffic); passing `to` asks
   a seat and **enqueues the question as real work**, which is also why it goes
   through `assertSendAllowed` — a deferral is a send, and a seat must not use it
   to reach a seat its org edges forbid. The visible half is
   `deferred_awaiting_answer` on the attention channel, which is the actual gap:
   before this, a blocked seat's reason was prose, and prose appears nowhere an
   operator looks. `demo/defer.test.mjs` is the 25th demo; it drives the real
   Router tools on a harness with scripted faux responses, so the tool wrappers,
   the commit boundaries and the edge gate are all exercised rather than
   re-implemented. Falsified before being trusted: with the edge gate disabled by
   hand it fails with "a seat with no edge cannot use a deferral to reach a seat it
   may not send to". *Found while building it:* the watch footer counted only
   queued/claimed/done, so a parked item appeared in none of its totals and the
   footer read "0 queued, 0 claimed, 0 done" while work sat parked — an idle-looking
   rig holding unfinished business. Counted now (and only when non-zero, so the
   footer is unchanged for rigs that never defer).
6. **Termination and attempt semantics.** No deadline, no attempt cap, no
   repetition detection: the two most common MAST design failures (step repetition
   15.7%, unaware of termination 12.4%) are both unaddressed. Subsumes the
   block/park/wake-after semantics raised against Core_Ideas layer 7.
   → *From the demos (24a, 24e), corrected:* the review first claimed this was platform
   support durig "switches off". It is not: `resolveSettings` and the `openai` SDK
   already supply retry, compaction and timeout defaults, and durig already calls
   `harness.resume()`. What was genuinely missing was the ability to *tune* the stream
   timeout (now `DURIG_STREAM_TIMEOUT_MS`). The real platform contribution to this item
   is `defineTask` **phases with checkpoints** (vacation.ts), which is what makes a
   multi-step task resumable at all — and `resume()` only becomes load-bearing once
   durig has tasks for the scheduler to pick up.
7. **Extract the view model and peer navigation graph (D21).** Pure functions:
   turns, collapse state, and "which seat sent to / received from this seat",
   derivable from queue items' `from`/`to` and the Router tools. Unblocks both
   interactive asks without committing to a screen model.
   → *From the demos (24f, 24g):* the platform already exposes most of this shape —
   `Conversation.viewState()` is a reactive structural view including the built-in
   documents, and `harness.taskGraph()` is a live graph of what waits on what and
   which conversations a task owns. Both are in-process, so neither replaces the
   cross-process read (D11); the question this item should answer is how much of the
   view model durig can *take* from `viewState()` rather than derive by hand. Also:
   `api.details({ conversationId })` is how a tool result points at the conversation
   that produced it, which is the peer-navigation half.
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
    **✅ done (2026-10-11), and widened deliberately.** `stray-seat` ships, plus
    `store-missing-seat` for the mirror direction, because checking the live rig
    showed BOTH at once: the store held a stray `worker` **and** was missing
    `scribe`, which the spec declares. Reporting one direction would have reported
    half a real problem while looking complete. They get different severities
    because they are different failures: a declared-but-absent seat cannot receive
    work at all (a send fails with `unknown seat`) and the fix is `up`, so it is an
    `error` like an unapplied constitution; a stray seat still has a working
    address, and `up` never removes one, so it is `fix-now`. This also makes
    `check` a wrong-database detector: pointing it at a rig file that is not the
    store's reports every seat as missing. The finding names the seats and the
    exact command, and is honest that clearing a stray is a store rebuild, not a
    spec edit — there is no removal command yet. Both are asserted in
    `demo/check.test.mjs`, including that they are SKIPPED (not passed) when the
    store cannot be read, and the whole test was falsified by disabling the rule
    and watching it fail.
10b. **Dogfood durig for our own work.** Agreed by the operator 2026-10-11: run our
    own coordination through durig so the obvious problems surface through ordinary
    use rather than through a test written to look for them. The first session
    routed a real backlog item `pm` → `worker` and found six things, including a
    **wrong documented fact** (F4: entries do carry `usage`), and the running log is
    `docs/DOGFOOD.md`. Seats have six tools and no file access, so dogfood
    coordination now and expect grounded content work to stay blocked on item 4.
    Findings F1–F3 are small fixes worth taking early, precisely because use found
    them and the suite did not.
10c. **Test temp-dir cleanup actually runs.** Twelve demos call `process.exit(0)`
    from inside the `try` whose `finally` removes their temp dir, so the `finally`
    never runs and each test leaves a directory and a SQLite file behind. Harmless
    today because they live in the OS temp dir — which is exactly why it went
    unnoticed. Found while writing `demo/extensions.test.mjs`, which is now the one
    test that does clean up. Fix: move the pass message and the exit to AFTER the
    try/finally, in each of the twelve. Mechanical, and the proof is that a full
    suite run leaves the temp dir unchanged.
    **✅ done (2026-10-11).** Eleven files (the twelfth, `extensions`, was already
    fixed when it was written), with only the `process.exit(0)` moved so the success
    output is unchanged and a thrown assertion still propagates; the rewrite refused
    to touch any file without exactly one matching site. Proof is the measurement,
    not the edit: `$TMPDIR/durig-*` went from 545 to 547 across a full suite run,
    and after the two remaining causes were fixed, a run left it at 548 → 548.
    **The fix uncovered a second, real defect.** Once the `finally` actually ran,
    `constitution`'s cleanup failed with `EPERM` — its `readConstitution()` helper
    opened SQLite storage and never closed it, and on Windows an open handle keeps
    the `-wal`/`-shm` files locked so the directory cannot be removed. The exit bug
    had been hiding it. Both are fixed and the handle-closing reason is written in
    the helper. Note the asymmetry worth remembering: the `finally` printed
    `CLEANUP WARNING` to stderr while the test still printed `PASS`, so a runner
    that greps stdout calls a leak a success — which is why the check here is a
    temp-dir count rather than an exit code.

## Mid-term

11. **Pods design decision** — OpenRig parity question deferred twice:
    namespace-scoped queues vs a flat queue with pod tags. Needs an operator ruling
    before implementation (the converter currently drops pods with a warning).
12. **Workflow task type** — SOP-style phases enqueueing queue items and waiting on
    DONE notices, built on PD's durable task graph (Core_Ideas layer 7).
    → *From the demos (24e):* `vacation.ts` is a working two-phase `defineTask` — each
    phase returns `{ status: "running", checkpoint: { phase, … } }` so the intermediate
    result survives a crash between steps, and the task's `abort` writes a terminal
    outcome rather than leaving it dangling. Read it before designing this.
13. **Seat handover on context exhaustion** — PD has compaction; the OpenRig
    handover-packet flow does not exist yet.
14. **Measurement history** — persisting scorecard snapshots per config revision so
    the before/after comparison in the review loop is a lookup rather than a
    re-run. Deliberately not in the first cut: it adds a write path, which is why
    it waits until passive windows have proven useful.
    **Status 2026-10-11: the write path is no longer the plan** — see 19, where
    `security.sec` prefers git as the append-only record and retires the debt.
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

**Ruled 2026-10-11 (operator): one distribution, no editions** — chosen extension
by extension against the workflows we intend to support (21). The argument that
produced the ruling is below, and it is also the shape the work should take rather
than two artifacts. Still open: which workflows define "recommended", and whether
the measure layer can make an extension's effect visible (19 — now answered as
"possible, and git is the change log").

**The cost model first, because it decides the whole question.** For durig the
burden of an unused feature is *not* disk and *not* speed: the per-seat scan
measures 0.9–1.4 ms, so runtime cost is negligible. The binding costs are (a)
prompt tokens on every request, (b) **which tools the model sees**, which changes
seat behaviour rather than just its bill, and (c) the test and documentation
surface. A feature that is off must therefore cost nothing — not "little".

18. **An extension registry with named profiles — not two editions.** Two
   distributions means two test surfaces, and our own evidence says the untested
   one rots: a committed converter fixture that crashed on contact was cited as
   proof by three documents, one of them an acceptance item marked PASS. A profile
   is *data* (`{"profile":"recommended"}` or an explicit enable list); an edition
   is an artifact to build, publish, and forget. So: one artifact, one suite, and
   `core` / `recommended` / custom as configuration. Each extension declares its
   own cost (prompt tokens, tools added), its default, and its **blind spot** — the
   same discipline `check` and `metrics` already follow, since a declaration that
   travels with the thing is the only kind that stays true. Open question for the
   operator: which workflows define "recommended" (see 21).
   → *From the demos (24c):* the selection idiom is `configure(tx, convId,
   { extensions: [Ext] })` to restrict and `{ extensions: { remove: [Ext] } }` to
   exclude — and the hazard is real: a child conversation inherits its parent's agent,
   so a recursive tool must be removed explicitly or subagents recurse (`subagent.ts`
   says so in a comment).
   → *Caveman (20) forward-note:* caveman is the registry's first real test case
   and it arrives on **both axes at once** — a prompt-section extension (its skill)
   and a provider/model-call wrapper (its proxy). The registry must therefore
   support both, and must be able to enable one **per seat role**, or its first
   user forces a redesign. Build the seam so a wrapper can be inserted between
   provider and harness the way `wrapProviderWithSlots` already is.
   → *Grounded 2026-10-11 (Pi Durable's own account of extensions):* the registry
   durig installs `Router` into **is** the extension mechanism, so the model this
   item proposes already exists. Two things it gets for free: a conversation
   "selects which extensions and tools it uses, and stores only their names", so
   per-seat-role selection is `configure(tx, convId, { tools: { remove: [...] } })`
   rather than a new concept; and installing under an existing name **replaces it in
   one step**, which is both the live-reload story and how a version gets pinned.
   So the missing piece is only the **loader** (23) — each extension still declares
   its cost, default and blind spot as this item says.
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
   **Verified 2026-10-11: adopt-with-conditions, and the debt is retired.**
   `security.sec` prefers git over a store write path, because the write path would
   *add* a mutable, untrusted attribution surface while git is already append-only
   and hash-chained. Its conditions: `metrics` must report the committed active set
   and **flag a dirty tree**; git authorship is not authentication; and D24's
   prediction record stays. Full position:
   `docs/reviews/security-sec-deferred-three-items.md`.
   **✅ done (2026-10-11).** `src/provenance.mjs` reads the revision, the dirty
   flag and the active set; `metrics` reports them in its JSON contract and as one
   line above the table. Conditions met: the committed active set is reported
   (builtin `durig.router` first, then the declared `DURIG_EXTENSIONS` paths —
   paths, not names, because loading a module executes it and a read-only query
   must not run code to describe what it would have run), and a dirty tree is
   flagged with why it matters rather than printed as a bare hash. Two things the
   implementation had to get right that the position did not anticipate: the status
   must be scoped to `-- .`, because durig normally sits inside a larger repository
   and an unscoped check reported 92 changed paths where durig's own subtree had 0
   (a flag that is always true is worse than no flag); and "no repository" reads as
   `unknown` rather than `clean`, which is the difference between evidence and its
   absence. `demo/provenance.test.mjs` is the 24th demo and proves the dirty flag
   moves by `git init`-ing a throwaway repo rather than asserting a stub.
20. **Caveman as an optional extension — spike first.** `juliusbrussee/caveman`
   is two things: a **skill** (output voice, ~1,160 prompt tokens/request, ~3% 
   median output saving on top of "be concise", much more for `/ultracave`) and a
   **proxy** (compressing what the agent *reads*: logs, CSV, YAML, JSON, test
   output; vendor-reported 33.2% session input-token reduction). Three things to
   settle before any of it ships: (i) **the shape it has to arrive in** — caveman
   ships as a pi coding-agent plugin, and durig hosts neither that plugin form nor
   the `pi` CLI (see 23), so its two halves must be re-expressed on native seams:
   the *skill* is a prompt `section` and the *proxy* is a `wrapTool` decorating tool
   results. Both are ordinary pi-durable concepts, so "does it even apply to us" is
   answered — what remains is the spike confirming the seams carry it, not a
   question of whether a plugin loads. (ii) **Telemetry is on by default** (`caveman telemetry off`,
   `DO_NOT_TRACK=1`), which is network egress, so a `security.sec` position comes
   **before** adoption under our own norms. (iii) **Scope it by seat role**: terse
   is fine for seat-to-seat coordination and wrong for a textbook tutor's
   student-facing explanation — the same seat-role axis `check`'s verifier rule
   already reasons about. **Correction 2026-10-11:** the savings ARE verifiable —
   entries carry `usage` and a `cost` breakdown (F4, `docs/DOGFOOD.md`), so a
   token/cost measure is direct class and caveman can be judged by the same loop
   as everything else once that measure exists.
   **Security position in (2026-10-11).** Split verdict, and the split is the point:
   the **skill half PASSES, conditional on being vendored as prompt text rather
   than installed** — it is ordinary persona content otherwise. The **proxy half is
   REJECTED as specified**; opt-out-by-default telemetry is necessary but not
   sufficient, because it reads raw tool output (which carries secrets) and rewrites
   the model's view inside the call path. Its conditions: the prior spike, a
   runtime **no-egress canary**, redaction, and role scoping. So the skill half is
   cheap and the proxy half is not, and the spike must answer the security
   conditions as well as the integration question. Full position:
   `docs/reviews/security-sec-deferred-three-items.md`.
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
   **✅ done (2026-10-11).** `docs/WORKFLOWS.md` names five workflows (routed
   delegation; independent verification; blocked on a question; intake/
   decomposition/tracking; human oversight) plus the operator loop for a rig change
   under measurement, each with who/trigger/**must-not-break**/done/capability. Two
   results worth the document on their own:
   (i) **"recommended" is mostly rig shape, not extensions.** Every workflow is
   served by the seed tools — one extension — so what varies between a rig that
   works and one that does not is the seats, their models and their edges, which is
   exactly what `check` already fails a rig for. Item 18's profiles should therefore
   be a preset rig file plus a seed list (core / recommended / opt-in / off), not a
   bundle of extensions the user must reason about. The first genuine "opt-in"
   candidate is retrieval, and that is an operator ruling, not a default.
   (ii) **D21, D22 and D24 now have workflow reasons** rather than being ad hoc: D21
   is W5 plus the operator loop (an interactive prompt would be a blocking gate in
   W1's must-not-break path), D22 is W1–W4 (a seat is a queue participant, and the
   unit of attention is the rig's state, not a seat's screen), and D24's
   must-not-break is the baseline-before-change rule.
   It also states a limit plainly rather than burying it: **W2 is not fully
   supported.** Verification holds today only for artifacts a reviewer can read in a
   transcript, because `complete_work` carries a claim (`resultSummary`) and not
   evidence — item 4 (M3). Naming the loop is what makes that limit visible.

23. **Load extensions from config — the "support pi extensions" item.** Small,
    now that 18 is grounded. `durig.config.json` (and the rig spec) gains an
    `extensions` list of module paths; `openHarness` imports each and installs it
    into the registry it already builds for `Router`. A pi-durable extension is a
    plain module exporting `defineExtension({name, sections, tools, hooks, tasks,
    wraps})`, and Node 24 type-strips TypeScript, so there is no build step and no
    new runtime dependency. Per-seat selection rides `configure`'s tool add/remove
    rather than a new concept.

    **Deliberately not the same thing as a pi *coding-agent* extension.** Those
    target the interactive agent — slash commands, a TUI, project-trust prompts —
    and durig neither depends on `pi-coding-agent` nor has such a surface (D21
    keeps the CLI non-interactive). So the loader loads *this* kind, and a
    coding-agent plugin is not portable to it. That distinction is the fact behind
    item 20's split verdict, and getting it wrong is how someone spends a week
    trying to load caveman's plugin as-is.
    **✅ done (2026-10-11).** `src/extensions.mjs` loads module paths from
    `DURIG_EXTENSIONS`, `openHarness` installs them on top of Router, and `up`
    reports the names. `demo/extensions.test.mjs` is the 22nd demo, and it proves
    the part that matters: a configured extension's section reaches a seat's
    `pi.system` entry — with a control asserting the section is absent when it is
    *not* installed, so the assertion cannot pass for an unrelated reason. Six ways
    an extension can be wrong each fail loudly with the path named (absent file,
    no usable export, non-object export, no `name`, nothing declared, throws on
    import), plus two sharing a name — which pi-durable would otherwise resolve by
    silently replacing the first with the second. No auto-discovery, deliberately:
    an extension runs in-process with the harness API, so listing a path is trusting
    it.

31. **Port pi-warden's action guard and done-check into durig seats.** Vendored to
    `durig/vendor/pi-warden/` (v1.4.0, MIT) — **untracked**, per the root `.gitignore`'s
    `vendor/` convention for reproducible upstreams; the tracked record is
    `durig/docs/PROVENANCE-pi-warden.md`. **Port source, not a dependency: nothing imports it
    yet, so it protects nothing yet.** It cannot be a
    dependency: it peer-depends on `@earendil-works/pi-coding-agent` and binds that host's
    ExtensionAPI (`pi.on` across **17 events** + 3 `registerTool`s), while durig installs
    pi-durable extensions (`defineExtension`/`hook`/`ToolHooks`). Only `extension.js` and
    `load.js` touch the host; the other 60 modules are host-agnostic policy logic.
    *Two halves fit durig directly:* **action-guard** (`evaluateAction`) — the control that
    makes "full shell" defensible before codemode-with-permissions exists (D38) — and
    **done-check** (`needsDoneCheck`, `evaluateDone`, `projectCheckCommand`), which is
    precisely the W2 gap: `complete_work` carrying a claim with no evidence.
    *Measured cost, not estimated:* a reachability pass shows **no judge-free subset** —
    rooting at `redact`+`shell-writes`+`tools`+`holds` still reaches `guard` → `conscience` →
    `backend` → `pi-typesafe` (19 modules, 495 KB, one external dep), and the action-guard
    path alone is 18 modules / 482 KB. The **adapter is the work**, and durig's hooks are
    stronger than what pi-warden binds to: `beforeTool` blocks *or rewrites*, first block
    wins, and `ToolCall.parent` exposes nested calls (so it would cover codemode scripts too).
    *Gates before it is trusted:* (a) the judge is **network egress with a third-party
    credential** (`pi-typesafe` → typesafe.ai), so it ships **disabled** until a `security.sec`
    position, and even then it is a **deny-only tripwire, never the boundary** — SC1–SC3 stay
    the boundary, because pi-warden's own field numbers describe steering a *cooperative*
    agent; (b) a **timeboxed spike** mapping the 17 host events onto pi-durable hooks, because
    a wrong mapping silently weakens the guard — the events with no 1:1 analogue
    (`message_update`, `turn_end`, `agent_settled`, `input`) are where that risk sits; (c) it
    lands **with** the tools, never after them (D38).
    *Proof:* a demo that fails against the unguarded design (a dangerous call goes through)
    and passes with the guard.

32. **Codemode with JavaScript for seats — planned, gated on the boundary.** The operator decided
    to develop it and asked that the plan review the runtime library and cooperate with it;
    the plan is `docs/CODEMODE.md`, and this item is the roadmap half.
    *The library review is an acceptance criterion, not a step skipped later.* Checking the
    operator's review against source found four things to correct, two of which are must-sets:
    `CodemodeSandboxOptions.memoryLimitBytes` defaults to **no limit beyond wasm32's 4 GiB** (the
    familiar 256 MB is a *pi-tool* choice, not a library default), and `timeoutMs` defaults to
    **300 000 ms** (`runtime/host.js:5,302`) rather than being unset. Also: the sandbox is a
    `node:worker_threads` **thread in the same process** (`host.js:1,147`), so language isolation
    is not process isolation; and the operator's `runScript` sketch targets
    `quickjs-emscripten`, while pi's library is `quickjs-wasi` with `CodemodeSandbox` — we build
    on the latter. Verified as stated: no Node APIs/fs/net/timers, output capped at 16 MB /
    100 000 items, store at 256 KB / 1 MB, and `CodemodeExecuteOptions` carries an `AbortSignal`.
    *How it cooperates with the boundary:* minted per-script capabilities replace the ambient
    `tools`/`ALL_TOOLS` surface, and every executor delegates to the confined `ExecutionEnv`
    (SC1) — so path confinement is enforced twice and **SC1–SC3 land first**. `proc.exec`, if
    exposed, is a narrowing layer and never the boundary (F4's finding, the same reason a
    PowerShell allowlist is unsound). **No network capability is minted in the first cut**, so no
    egress is added.
    *Gate:* a `security.sec` position (new dependency, new execution surface, its own audit sink).
    *Proof:* a demo where one escape is denied by the grant predicate and another independently by
    the environment, so neither layer is load-bearing alone.

33. **Prompt-cache effectiveness — are durig's seats actually getting cache hits?** Raised by the
    operator with `docs/Prompt_Caching_Research.md` and DeepInfra's
    [prompt cache retention](https://docs.deepinfra.com/chat/prompt-cache-retention). Cost is a
    standing measure (item 20's neighbourhood) and cache is the largest single lever on it, so
    the question is not "can we cache" but "are we, and how much".
    *The seam already exists and durig exposes none of it.* `ConversationStreamOptions.cacheRetention`
    is a real field (`durable/src/harness/types.ts:461`), and pi-ai's OpenAI-compatible provider —
    the path durig's DeepInfra traffic takes — already resolves it and can send prompt-cache
    fields and session-affinity headers (`ai/src/api/openai-completions.ts:294-363, 763-781`).
    durig deliberately exposes only one harness setting today (`stream`, per 24a), so this is the
    same shape of work as `DURIG_STREAM_TIMEOUT_MS`: decide whether a second knob is justified,
    and why.
    *What DeepInfra actually requires* (cited, from the retention doc): `prompt_cache_key` with
    every request — **a stable identifier for the context, "for example a session or agent id"**,
    which is exactly what a durig seat is — plus `prompt_cache_options{mode:"explicit",
    ttl:"5m"|"1h"}` to open the window, and an optional `prompt_cache_breakpoint` marking where
    the reusable prefix ends. Reads bill at **0.2×** input on Nemotron-3-Ultra, writes at **1.25×**
    (5m) or **2.0×** (1h); reuse without a `ttl` does **not** extend the deadline; after expiry it
    falls back to standard pricing rather than silently charging.
    *Two traps that could make this a no-op, and both are checkable before building:*
    (a) **granularity** — the retained portion is rounded **down** to a whole cacheable increment,
    and "a breakpoint shorter than one increment retains nothing" (8,192 tokens on
    Nemotron-3-Ultra). A seat's reusable prefix is constitution + persona + primer + tool
    declarations, which may sit *under* one increment — in which case retention would retain
    nothing and only the write premium would be paid; (b) **model support is narrow** — only
    `nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B` and `moonshotai/Kimi-K2.7-Code` today, and neither
    is durig's default model, so on `zai-org/GLM-5.3-Flash` the parameter is **ignored** and billed
    as standard input. Ordinary best-effort caching still applies there.
    *Measure from data already persisted, no new instrumentation.* Assistant entries already carry
    `usage` including `cacheRead`/`cacheWrite` (F4), which is precisely DeepInfra's
    `usage.prompt_tokens_details.{cached_tokens,cache_write_tokens}` — so a hit-rate measure is
    direct class, feeding `computeMetrics` like every other measure (D24).
    *Prompt stability is a lever durig controls, and this is the non-obvious half.* The
    constitution is read **per request** so one edit re-arms every seat — and, unnoticed until
    now, invalidates **every seat's cached prefix at once**. `up --refresh` and the optimizer
    rewrite prompts by design. The long-context research names this failure directly: a
    cache-hostile rebuild silently zeroes the prefix-cache hit rate. So a measure and the
    rebuild paths have to be looked at together.
    *Deliverable:* a timeboxed spike establishing **what our provider path actually emits**
    (pi-ai's retention shapes are Anthropic/OpenAI-shaped while DeepInfra's `prompt_cache_options`
    is provider-specific, so a mapping gap is likely and must not be assumed away); a stable
    per-seat key; a measured hit rate on the real models; and an explicit decision on both traps,
    including whether a model swap is warranted to make retention reachable at all.

34. **Platform-independent paths — a canonical form, and never persisting a host path.** Raised by
    the operator with `docs/Pi_Platform_Independent_Filepaths.md`, which is the right analysis and
    whose central claim holds: one canonical form, one ingress function, one egress function, and
    — the part that matters most for pi-durable — **never persist a host-absolute path in durable
    state**, because a checkpoint written on one platform must replay on another.
    *What I checked against our runtime, rather than accepting the doc's premises:*
    - **A Git-Bash-style path is silently mis-resolved.** `resolve('/c/Users/x')` is
      `C:\c\Users\x` on this host, so the MSYS form the doc recommends as canonical is **not**
      something our `ExecutionEnv` speaks. The saving grace is that containment then **fails
      closed**: that path resolves outside the worktree root and is refused, so the failure is a
      confusing refusal rather than a wrong file. That is the right direction to fail, and the
      test that proves it should be written before the form is ever adopted.
    - **Containment is already case-insensitive here** — `relative('C:\\Work', 'c:\\work\\a.ts')`
      is `a.ts`, not `..` — which is what identity on Windows requires. `confine.mjs` gets this
      right by using `relative` rather than a string prefix.
    - **Forward slashes and UNC already work** for native paths (`C:/x` → `C:\x`;
      `//server/share` → `\\server\\share`), so the practical gap is the *MSYS* form, not slashes.
    - **We DO persist a host-absolute path.** `AgentState.cwd` holds one, and `up` now writes
      `seat.cwd ?? spec.cwd` into it, so the doc's warning applies to code shipped the same day.
      A store carried to another machine resolves a root that does not exist; the failure is
      confined rather than escaped, but it is wrong and silent. The fix is the doc's: keep the
      absolute root as **configuration** and persist a **root token plus a relative path**.
    - **`MAX_PATH` is a live risk for worktrees**, since `C:/tmp/durig-dev/<item>` plus a
      `node_modules` tree is deep by construction, and the doc's `toNamespacedPath` is the known
      answer.
    *Shape, when it is done:* `toCanonical`/`toHost` as the only platform-aware pair in the tree,
    canonical at every tool boundary, canonicalization at the `ExecutionEnv` boundary, and
    property tests for idempotence plus a cross-platform resume test — a path resolution is an
    effect whose inputs must replay to the same decision.
    *Review trigger, so this is not only read once:* re-open when (a) a store is moved between
    machines or a remote/containerised execution environment is used, (b) a second platform runs
    the suite, or (c) the worktree path depth starts hitting `MAX_PATH`. Until then the current
    posture is **fail-closed, not correct**: we are protected from a wrong file, not from a
    confusing refusal.

## Sharing publicly

22. **Publish durig as its own repository — no releases yet.** The operator wants
    the work and the intentions visible, partly so the pi-durable team can see what
    people are building on it, and so improvements can arrive from others later.
    Shape: `git subtree split --prefix=durig` keeps the history built here (the
    decision log, the 21 demos) instead of starting fresh, and the code is already
    nearly self-contained — `@earendil-works/pi-durable` and `pi-ai` are **public on
    npm** (1.1.0, MIT). **The coupling is already cut:** the two imports of
    `../vendor/pi-deepinfra/models.ts` are now `src/providers/deepinfra-models.ts`,
    vendored with provenance — the tree shares no path with its former parent.
    Done before pushing: vendor the catalogue, re-run the secret scan (clean — no
    keys, no absolute local paths in the published tree).
    Still to decide: a licence (the platform is MIT) and a README written for a
    stranger. No release, no npm publish, no tag — a
    readable `main` plus the docs. **Requires the operator's authorization to
    push**, and a GitHub remote added alongside the existing LAN Gitea one.

## Prior art — the pi-durable example projects (reviewed 2026-10-11)

24. **Adopt what the pi-durable demos show, and record what they don't.** The Pi
    Durable post points at two examples (`experimental/durable`, `experimental/vacation`
    in the pi repo at durig's pin). Their sources had **never** been read; the review is
    `docs/REVIEW-pi-durable-demos.md` and it found one shipped defect immediately (item
    25). The demos turn out to be *one* project — the vacation planner shares
    `main.ts` and `tui.ts` with the coding agent at identical blob shas — so the
    transferable surface is `runtime.ts` and `vacation.ts`. Six independently takeable
    pieces, each naming the file that shows it:
    24a. **The harness settings knob — mostly a correction, one real fix.**
    **✅ done (2026-10-11), and it shrank on inspection.** The review claimed durig
    "has no stream timeout, no retry policy, no compaction config and no steering or
    follow-up mode" and "never calls `harness.resume()`". Both were **wrong**, and
    wrong the same way: the demo's side was read while durig's side was described from
    memory. Checked against the platform: `resolveSettings` merges retry (3 attempts,
    2 s base, 60 s agent delay), compaction, progress, `toolExecution`, both queue modes
    and `contextRetentionMs` over built-in defaults, so durig already had all of them;
    the provider path is the `openai` SDK, whose defaults are `maxRetries: 2` and a
    600000 ms total request timeout, so it could not hang forever either; and durig
    **already calls** `harness.resume()` in `openHarness`, with viewers excluded so a
    passive `watch` cannot kick the queue it observes.
    The one real gap was a **knob**: `stream` is the single field with no default
    (`{ ...settings?.stream }` → `{}`), so durig could not raise the timeout for the
    slow single-model rig that `DURIG_MAX_CONCURRENT_SEATS=1` exists to support, nor
    lower it to fail fast instead of waiting out ten minutes on a stalled endpoint.
    `DURIG_STREAM_TIMEOUT_MS` now reaches `Harness.open`, rejects a bad value loudly
    rather than silently taking the default, and is **unset by default** so the platform
    timeout stands rather than a number durig invented. `resume()` needs nothing until
    durig has durable tasks — it enables the scheduler, and durig has none to resume —
    so the remaining half belongs to 24e.
    *The lesson, recorded because it is the reusable part:* a review that reads one side
    carefully and the other from memory produces confident, wrong gap claims, and a
    wrong gap is worse than no gap. Corrections are marked in place in
    `docs/REVIEW-pi-durable-demos.md` rather than quietly edited away.
    24b. **Spike the HTTP dispatcher.** `configureHarnessHttp` exists because "without
    it, some provider streams break off". durig configures none. This is listed as a
    **possible** live defect, not a confirmed one — it needs an hour to rule in or out,
    and it would present as an occasional truncated stream that looks like a provider
    fault.
    24c. **Per-conversation extension scoping, using the demo's idiom — including its
    hazard.** `configure(tx, child, { extensions: [Search] })` for a restricted child
    and `{ extensions: { remove: [Subagent] } }` to stop recursion; a child inherits
    everything its parent had unless it is removed explicitly (`vacation.ts`,
    `subagent.ts`). This is item 18's mechanism demonstrated, and `ExecutionEnvs`
    (`harness-setup.ts`) is item 4's wiring in ten lines including the disposal nobody
    remembers. Both still gated on loop #5 and a `security.sec` position.
    24d. **Give submissions a request identity.** `requestId` makes a rerun after a
    crash find and reuse the same submission rather than sending twice
    (`vacation.ts`).
    **✅ done (2026-10-11).** `send --request-id <id>`; a duplicate id returns the
    existing submission, so a retry generates nothing and returns the original reply
    (`reused: true` in the JSON). The id is **never derived from the text** — two
    deliberate identical sends are two requests, and collapsing them would be a silent
    data-loss bug — so it is opt-in and the caller supplies it. Uncovering it also
    exposed an interaction worth recording: the reply is resolved by scanning for the
    newest assistant entry past a pre-run watermark (the F7 fix), and a **reused**
    submission's answer was committed *before* that watermark, so the scan would find
    nothing and report `reply: null` for a request that plainly has a reply. With an id
    the submission's own answer pointer is authoritative instead; without one the
    watermark scan stays as it was. `demo/cli.test.mjs` covers first-use, retry
    (no second entry, same reply), a different id, no id, `--request-id` with no value,
    and that the id never reaches the prompt. Falsified by dropping `requestId` from the
    submission and watching it fail.
    24e. **Durable task phases with checkpoints, and conversation ownership.**
    `defineTask` with `phases` returning `{ status: "running", checkpoint: { phase, … } }
    survives a crash between its steps, and `ownership` makes aborting a parent abort
    what it owns (`vacation.ts`). durig's queue items carry a transition trail but no
    phases and no ownership, so aborting a seat does not stop what it started. This is
    the substance of item 12 and the other half of item 6.
    24f. **Structured tool results and progress: `api.details()` and `api.output()`.**
    A tool can hand the view a `{ conversationId }` to link to, and can emit progress
    so a slow call does not look hung (`subagent.ts`, `vacation.ts`). durig's tools
    return one final string; `context.abortSignal` support transfers outright and long
    operations should honour it.
    24g. **Coalesce renders per burst.** Commit listeners plus a `setImmediate` guard
    render once per burst of real change (`runtime.ts`). The subscription itself is
    in-process only and cannot replace durig's cross-process poll (D11) — but the
    coalescing can: durig redraws on a timer whether or not anything changed.
    *Deliberately not taken:* the TUI (no `pi-coding-agent` dependency, and D21/D22
    keep durig non-interactive), a session picker (a rig already *is* a database), and
    the view subscription. Recorded in the review so a gap is never confused with a
    declined feature.
25. **Derive the protocol primer from the registry.** `prompt.ts` builds pi's system
    prompt from `input.agent.tools`, so a tool cannot exist without being documented.
    durig's `PROTOCOL` primer is hand-written text beside the registry, and the drift
    was realised: `defer_work`/`resume_work` shipped in item 5 while the primer kept
    describing four tools, so no seat in the real CLI was ever told it could defer.
    **Fixed immediately** (both lines added, and `demo/primer.test.mjs` holds the prose
    to the registry in both directions, falsified by deleting a line). This item is the
    structural half: generate the list from the tool objects. Tradeoff to settle when
    it starts — the primer carries argument signatures and routing advice that a tool's
    `description` does not, so the honest options are generating bullets plus keeping
    the advice, or extracting signatures from the parameters schema. The cheap half is
    already doing the work; this removes the class rather than the instance.

## Workflow research

26. **Survey what competing platforms advertise as supported workflows.**
    Raised by the operator when the `workflows.advocate` seat was created, and it is the
    right way to widen the set: `docs/WORKFLOWS.md`'s five workflows were derived from
    what *we* run, which keeps them honest but also narrow. Candidate sources are the
    agent-orchestration frameworks, durable-workflow engines and multi-agent product
    suites that publish an opinion about the workflows they serve — crew/role pipelines,
    graph-and-state machines, supervisor/worker hierarchies, human-in-the-loop approval
    gates, scheduled and event-triggered runs, long-running background jobs with retries
    and compensation, and durable task queues.
    **The output is candidates, not users.** Every workflow found this way arrives
    labelled `advertised-elsewhere` and only graduates to `observed` when somebody here
    runs it, because a list grown from a competitor's feature page is a list of
    hypotheses. The deliverable is therefore: a short survey naming each platform and
    the workflow it claims (with the URL, per the web-research rule), a diff against our
    five, and — for each candidate worth keeping — the must-not-break loop and the
    capability it would need. Anything that survives goes into `WORKFLOWS.md` under its
    class, and anything that needs work becomes a roadmap item rather than a wish.
    Cost note: this is paid web research, so it is timeboxed and cited rather than
    open-ended browsing.

## Long-context management (raised 2026-10-11)

Raised by the operator with `docs/Managing_Long_Context_Length.md`, which surveys the
evidence: accuracy degrades as input grows *well before* the window fills ("context rot"),
the usable window is a fraction of the advertised one, the trigger should come from each
model's *measured* effective length (~60–70% of it) rather than being inherited, and the
cheapest first lever is masking stale tool output, not summarizing.

What makes this ours rather than general: **a seat is a pi-durable conversation**
(`src/rig.mjs`, the Seats doc) created once at `up` and reused for every `send`, so a seat's
context accumulates across the whole project, and nothing in durig observes or controls that
growth. Compaction is the platform's automatic behaviour, inherited rather than chosen (24a
found `stream` is the only `HarnessSettings` field with no default), and there is no way to
start a seat a fresh conversation. Item 13 names the exhausted handover; 27–29 are its three
missing halves, and 30 is the honest advert.

27. **Make context pressure visible, per seat and per model.** Today a seat's context only
    ever grows, and the first signal an operator gets is a seat behaving worse. The measure:
    tokens consumed against the seat's model window, per seat, read from assistant entries'
    `usage` (`input`/`output`/`cacheRead`/`cacheWrite`) through `storage.scanEntries` — the
    same storage-direct path `metrics` already reads, and the F4 correction that made the
    cost measure direct-class. It extends item 2's token counter and must **feed
    `computeMetrics` as an evidence source** rather than printing its own report, or the
    long-context question cannot be judged by the same loop as everything else.
    *Resolved by reading the pinned source rather than assuming:* compaction **is**
    observable. A `pi.compaction` entry is written into the stream carrying
    `reason ∈ {manual, threshold, overflow}` (`vendor/pi-main/packages/durable/src/entries.ts`,
    `harness/types.ts`), so the measure can report compactions per seat and can separate an
    operator's compaction from one the platform triggered. The genuinely unknown part is not
    in source at all: a model's *effective* window is a property of weights, so it takes a
    measurement — which is what item 2's drill and the per-model profiling in
    `Managing_Long_Context_Length.md` are for.
    *Communicate* by riding the existing attention channel in `status`/`watch` (D28), with
    the measure's declared direction and blind spot, counted only when it has moved. The
    wording must not claim precision the instrument lacks: a percentage-of-window display
    that is really a token sum against an *advertised* (not effective) window is false
    precision, and the research is explicit that advertised ≠ usable.
    *Constraint:* this adds no table, no write path and no egress — it reads fields already
    persisted. If an implementation ever wants to *store* a pressure value, that is a new
    write path and needs a `security.sec` position first.
    *Acceptance:* a demo proving the measure over a fixture transcript, and the notice
    appearing in `status`/`watch`.

28. **A context-reduction surface: the `compact` verb the platform already has, and the
    fresh conversation it does not.** The research's strongest and least intuitive finding is
    that compaction helps *even when the window never fills* — stale exploration impairs
    reasoning regardless of length — and that the best moment is a **phase transition**, not
    mid-reasoning. A durig team working item after item needs that lever.
    *Two levers, and they are not the same operation:* **compaction** summarizes in place and
    leaves a summary that can be pointed at; a **fresh conversation** drops the history
    entirely and leaves nothing to point at. The platform already provides the first —
    `Conversation.compact(instructions?, context)` (`harness/types.ts`), recorded as a
    `pi.compaction` entry with `reason: "manual"` — and durig exposes neither: `USAGE` lists
    eleven commands, none of which compacts or resets a conversation, and `up --refresh`
    re-applies the stored prompt *without* touching it.
    *28a, the cheap half — expose compaction.* The mechanism exists, so this is exposure and
    honesty rather than invention: a verb, a record of who asked, and the `reason` field
    distinguishing an operator's compaction from the platform's threshold or overflow. The
    entry is already the audit trail, so this half adds no new storage concept.
    *28b, the expensive half — a fresh conversation.* A verb that gives a seat a **new
    conversation** while keeping the registry entry (name, role, capabilities): it rewrites
    one mapping, in one storage transaction, and must not let a seat's name and conversation
    id disagree (`src/rig.mjs`'s stated invariant, and what `check`'s `store-missing-seat`/
    `stray-seat` rules police).
    *The risk that decides 28b's design:* a seat's conversation **is** its working memory of
    the item. A naive reset silently loses the task — the literature's "summary-induced
    amnesia" and "drops the reasoning, keeps the surface action" failure modes. So what is
    carried across must be defined: the stored persona re-applied at open, and the open item
    the seat had `claimed` re-surfaced, so a seat cannot end up holding a claim it can no
    longer remember. *Acceptance:* a demo where a seat takes a fresh session and still
    completes the item it had claimed.
    *Never delete the old conversation.* Audit-trail destruction is a named failure mode, and
    a transcript is exactly what `log` and `watch` read (D-view). A fresh session **adds** a
    conversation; it never removes one, and the seats doc records the change.
    *Ordering:* 28a before 28b, because a compaction leaves a summary behind and a fresh
    conversation is a discontinuity the operator should be told about — so the cheaper,
    auditable lever should exist first and set the vocabulary.

29. **Make taking a fresh session a team practice, not a judgement call.** A verb nobody
    knows when to call is a verb that gets called at the wrong moment, which the evidence
    says is worse than not calling it. Owned by `workflows.advocate` with `docs.scribe`:
    `docs/WORKFLOWS.md` gains the ritual — *when* compacting is enough and when a seat should
    start fresh (at an item boundary, after the current item is closed, never
    mid-investigation), *who* decides (the `pm` at intake, the same place it assigns work),
    and *what the operator sees*. Its
    evidence class starts `inferred` and graduates to `observed` only when we run it (the
    advocate's rule, D36) — a practice written down is not a practice that works.
    *Acceptance:* the workflow is in `WORKFLOWS.md` with its class; if it proves out, the
    starter rig's intake step encodes it so a new rig does not have to reinvent it.
30. **Advertise the honest state of context management, then keep the advert true.** The
    operator asked that `docs/FEATURES.md` advertise responsible context management. Today
    the honest version is short: compaction is the platform's automatic behaviour and durig
    **deliberately does not override it** (24a: one `HarnessSettings` field exposed, and the
    reason), and a retry carrying `--request-id` reuses the existing submission so it does
    not add a duplicate turn to a seat's context (24d) — but there is **no pressure measure
    and no fresh-session verb**, and the advert must say so. `FEATURES.md` section 5 carries
    that table now, under "Context growth over a seat's life", with the gap named and the
    blind spot declared; this item is the standing
    obligation to move a row from "inherited" to "managed" as 27–28 land, and to keep the
    proof column pointing at the demo that proves it rather than at this paragraph. A feature
    list that describes the roadmap as though it were shipped is the same defect as a
    citation that points at nothing.

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
  evaluated against Core_Ideas.md; rationales in DECISIONS.md.
