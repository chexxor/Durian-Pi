# durig — roadmap

Ordered by operator value; each item names its motivating finding.
State as of **2026-10-11**: items 0, 1, 1a are done and item 2's measures and
surface are built (its *drill* is not — see 2 below); the docs pod (`scribe`) was
added to the rig on top of 1a. Work continues at item 2's drill, then item 3.
`docs/STATUS.md` is the handoff record; `docs/DECISIONS.md` holds the reasoning,
and D23 records how this roadmap was re-ordered by the research. Gap-table
handlings name their item rather than numbering it: the numbers had already gone
stale once when item 0 and 1 were added.

**Status 2026-10-13 (delegate session):** the **event-driven / Pi-integration** work (item 38
self-driving queue; item 40 resident server) advanced. **PIECE 1** wake spike (#209) and **PIECE 2**
durable read-only event feed (#210 — now `src/eventfeed.mjs` + `events --since/--follow`) are DONE
and qa-verified. **PIECE 3** (resident broker) was **GATED** (#238) on a D-entry that supersedes D11
(plus a security position only if a socket opens); it is **now DONE** (`serve`, D45; `up` auto-start,
D46; no socket, so no security position). The **ordering gap** — priority not expressible,
and a completed-but-bypassed item could not be marked done — was ruled **claim-by-id** and fixed
(#239, D41). Also done: `worktree` refuses a dirty source (#255, D43 — the fork-from-HEAD hazard);
send-path **store-write contention** retry (#257, D42); usability fixes #259–#262 (help/exit
contract, `queue` filters+summary, `ps`/`status` seat `root`+`model`, attention human/seat split);
worktree pin corrected to `7d75a0e` (#219). Open items from this session: `docs/DOGFOOD.md`
F18–F29 and `docs/NEXT.md`.

**Status 2026-10-14 (delegate session):** `peek_queue` now returns a bounded inline view
(counts + first 20 + footer) — verified, artifact #293. A corrupt `pi.live` was repaired by
**retiring** the corrupt incarnation (`scripts/repair-pi-live.mjs`); the viewer (`readLiveState`)
now tolerates an unreadable `pi.live`. The load‑bearing finding — **item 38 was unbuilt at the
time**: the queue was inert until a write‑side `run`/`send` is invoked, so `devtools` idled despite
queued work. **The auto‑wake has since landed** — see the next block.

**Status 2026-10-14 (later — the resident broker landed):** the **auto‑wake is DONE**. `serve`
(`src/broker.mjs` + `src/scheduler.mjs`, D45) reacts to the store's in-process commit stream with no
external clock; `up` auto-starts it on a TTY (`--no-serve`/`DURIG_NO_SERVE=1` opt out) and at most
one runs per database (D46). It was observed **auto-waking `devtools`** (its stalled #192) against
`selfdev.sqlite` with no manual `run`/`send` — the #238 goal. No socket opened, so no `security`
position was triggered. `#238` is closed. Demos `broker`/`scheduler`/`autostart` exit 0.

**Backlog — top, resolve next (2026-10-14, broker follow-ups):** two findings from the broker's
first live run remain open (detail in `docs/DOGFOOD.md`):
- **F34 — broker-driven generations carry no seat in the genlock lease**
  (`{"pid":…,"seat":null}`), so `status`/`watch` show a generation in flight with no seat name.
  Fix: attribute the lease to the driven seat.
- **F35 — `serve --stop` on Windows terminates mid-generation** (no `SIGTERM` delivery), which can
  strand the in-flight run. Fix: a cooperative, pass-settling stop on every platform.
- **F36 — the queue cannot be curated** is **FIXED** by D47 (`cancel_work`/`revise_work`, terminal
  `cancelled`); the *triage* of the ~40 stale items it exposed (`docs/QUEUE-TRIAGE-2026-10-14.md`)
  is still owed.

**Status 2026-10-14 (delegate session — lost-tranche recovery):** the repo split kept the worktree's
COMMITTED work and lost its UNCOMMITTED work; the snapshot branch **`pi-rebase` (commit `3bf61b1`)**
held it, and it was adapted onto current `main` as one-concern items: **#307** claim-by-id,
**#308** worktree dirty-source guard, **#309** `held` + hold/release, **#310** store-write retry
(`src/storewrite.mjs`), **#311** event feed (`src/eventfeed.mjs` + `events`), **#312** bounded
`peek_queue`. **F34 (#299) is FIXED** (the genlock lease now names the driven seat). Suite 55/56.

**Backlog (2026-10-14):**
- **#327 (safety, in progress)** — the seatguard git-refusal regexes end in `(\s|$)`, so `git stash;`
  (and `commit;`/`reset;`/`-C . stash`) evade the guard; `git stash;` wiped the working tree once.
  Fix the anchors and add failing-first demo cases.
- **#328 (logged, do not start)** — the `starter.test.mjs` CRLF/LF drift (`core.autocrlf=true`, no
  `.gitattributes`); normalize endings or add `.gitattributes`. Same family as **#291**.
- **#300 (F35)** — the cooperative broker stop (Windows `serve --stop`).
- **qa** — #313/#315/#317/#319/#321/#323/#325 await independent verification.

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
   Confirmed by reading storage: the live store held the 411-byte generic
   `constitution.txt`, not the rig's team culture, so all 13 seats ran without
   the rig's own grounding rule while appearing correctly configured. Fixed in
   `cmdUp`, with `demo/constitution.test.mjs` covering inline, file, absent and
   both-set specs, shown to fail against the old behaviour before it passed.
   *Applied 2026-10-11:* `DURIG_DB=<live store> node cli.mjs up
   the generated rig spec, after backing the store up to
   `C:/tmp/<live store>.bak-2026-10-11`; the stored text is now byte-identical to
   the spec's `constitutionInline` (1094 bytes, the rig's team culture).
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
   **✅ done (2026-10-13, direct).** `src/viewmodel.mjs` holds the pure model:
   `buildTurns`/`extractToolCalls`/`extractThinking` (moved from `chatview.mjs`,
   which re-exports them so callers keep one import path), `turnCollapse` (collapse
   state as a value, pinned to the renderer by `demo/viewmodel.test.mjs`), and
   `peerGraph`/`peerTargets` over the queue's `from`/`to` with direction kept
   (org edges are directional). Surfaced additively as `peerGraph` in
   `status`/`watch` JSON via the shared read API, so a client can switch to a peer
   without re-deriving the graph. New demo 48/48 green; shown failing first
   (`ERR_MODULE_NOT_FOUND`) against the pre-change tree.
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
   **✅ done (2026-10-13, direct).** `src/readapi.mjs` is the one read-only seam:
   `readSeatList`, `readQueueItems`, and `readRigHealth` (moved out of `cli.mjs`, so
   it is now importable by any client without running the CLI). `readRigHealth`
   builds on the first two, and `cmdLog`/`cmdCheck` use `readSeatList` instead of
   their own seat-document reads. `cfg` is passed in because config precedence is
   the CLI's job. Behavior-preserving: the 48-demo suite is green and `status`,
   `watch --once`, `log`, `metrics`, `check` all run against the live store.
9. **Repeat-call tolerant tools** — a second `claim_work` in one invocation errors
   with `Cannot use a settled overlay` (RESEARCH.md R2). Tools should return
   current state on repeat calls; models retry naturally.
10. **`log --follow` consistency** — it prints the backfill as one block and each
    later entry on its own, so column alignment and turn grouping differ between
    them. Small, self-contained.
10a. **A `stray-seat` rule in `check`.** The store can hold a seat the spec does not
    declare: the live store carries a `worker` left over from an
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
89. **TUI: load a seat's full chat transcript when opening its detail view (operator request, 2026-10-16) (DELIVERED `ed1ce0c`).**
    Today the conversation pane only carries the most recently **streaming** entries: the store read is a
    bounded 24-entry page (`SCAN_LIMIT`) and the scroll window cannot reach past that page
    (`docs/TUI-IMPLEMENTATION-PLAN.md` §G4, which leaves the "load older than the page" affordance open).
    Opening a seat's details must **load its chat log** — backfill the durable transcript for that seat,
    paged as needed, then continue following new entries live — instead of showing only the latest stream.
    *Grounded:* `src/readapi.mjs` / `src/rigstory.mjs` (`SCAN_LIMIT`), the TUI plan §G4.
    *Owner:* route via `pm` (impl for the transcript read path; designer for the detail-view surface).
    *Acceptance:* opening a seat's detail view renders that seat's prior turns from the durable transcript
    (paged, never only the live tail), then follows new entries live; a golden/demo proves the backfill is
    present, shown FAILING against the current stream-only behaviour before it passes.
90. **App-level syntax formatter (`format` verb) for seats and pre-commit use (DELIVERED `d0fa7ad`).** An explicit command a
    seat can run over the files it changed — after edits, before `git add`/commit — so style is
    consistent and whitespace/EOL churn stops leaking into diffs. **Value:** the tree is genuinely mixed
    (`cli.mjs`, `src/broker.mjs`, `src/scheduler.mjs`, `src/checkup.mjs`, `src/driver.mjs` are
    2-space-indented; most of `src/*` is tab-indented) and EOL drift is a live width (F32: an LF
    `oldText` never matches a CRLF `rig.mjs`; #328 CRLF/LF). A fixed format makes agent edits
    deterministic and diffs reviewable. **Cost:** the repo has **zero devDependencies** and "no build, no
    lint", so a formatter is a toolchain/dependency decision (devtools) *and* a one-time whole-tree
    normalize that must be stop-the-world — it collides with the dirty shared tree and in-flight work.
    **Design (recommended):** an explicit verb `node cli.mjs format [--check] [-- <paths>]` (JSON
    contract, explicit paths, `--check` exits non-zero) — NOT an automatic on-write formatter (formatting
    between a seat's read and its edit makes the exact-match `oldText` stale) and NOT a global git hook
    (a hook rewrites files outside the staged set, violating explicit-paths-only). Run `format` before
    committing an item; run `format --check` as a gate beside `node --check` in the demo loop.
    **Sequence:** AFTER the #885 `cli.mjs` gate and when the tree is quiet (the normalize is large).
    *Cross-refs:* #328, #291, F32. *Owner:* devtools (tool choice + pin) with impl (the verb).
    *Acceptance:* `format` normalizes a given file; `format --check` fails on an unformatted file and
    passes on a formatted one (shown FAILING first); the tool choice and pin are recorded; no auto-hook.

98. **TUI: show a seat's context consumption in its conversation view (operator request, 2026-10-17).**
    When the operator opens a specific seat's conversation, show how much of the seat's context budget
    it is consuming. The operator's preferred shape is the pi harness's — e.g. `$6.016 31.4%/1.0M`
    (cost so far · percent of the window · window size) — offered as an opinion, to be confirmed with
    the **designer** and **user advocate** (the operator asked for both).
    *This is the read-surface half of item 27* (context pressure) and must reuse its measure rather than
    invent a second one. *The load-bearing design question:* what is "the maximum recommended context"?
    A percentage against the **advertised** window is the false precision item 27 already warns about
    (our two flagships advertise 1M while the vendor's own operating point is ~300K; item 97 measures
    the effective window). So the denominator must be the recommended/effective window (item 27/97), or
    the display must label the advertised window explicitly — a **designer + advocate call**.
    *Also to decide:* tokens counted (newest turn's `usage` input+cacheRead+output; note `Usage.reasoning`
    is a subset of output), the refresh cadence, the 48-column floor, colour/NO_COLOR, and whether cost
    is shown (`$6.016`) or only the percent. *Owner:* designer (surface) + impl (data via item 27's
    measure) + advocate (does the number change a decision — the "is it actionable" test).
    *Acceptance:* a seat's conversation view shows the consumption and window; a golden frame pins it at
    80×24; the denominator is the recommended window or is labelled advertised.

99. **BUG (TUI): the conversation view has no `i` input affordance, and entering it drops the
    conversation (operator report, 2026-10-17).** *Symptom:* in a seat's conversation view the footer
    does not offer `i`, and pressing `i` leaves the conversation while typing, so the operator cannot
    tell they can message the seat from there. *Root cause (verified in `src/tui/client.mjs`, `ui.mjs`):*
    `renderTui` dispatches on `view`; the conversation branch is `view === "conversation"`, but `i` sets
    `ui.mode = "input"` → `view === "input"` → the conversation branch is skipped and the **seat list**
    renders with the input row appended. `renderFooter`'s conversation hint omits `i=input` (the seats
    hint has it), and `exitInput` always returns to `"seats"`.
    *Fix direction:* treat input as an **overlay** on the current view — remember the prior mode and
    render the conversation with the input row, add `i=input` to the conversation footer, and return to
    the conversation on submit/cancel. Confirm the footer/hint wording with the **designer**.
    *Owner:* impl (TUI) + designer. *Acceptance:* from a conversation, `i` shows the input row over the
    SAME conversation; Enter sends via `writeIntent` and returns to the conversation; Esc cancels back
    to it; the footer advertises `i`; a driver/golden test proves the conversation is not replaced.

101. **BUG (TUI): the conversation view collapses newlines when a seat's loaded transcript is streamed
    to the viewport (operator report, 2026-10-17).** *Symptom:* opening a seat's conversation and
    rendering its durable transcript (item 89's backfill) flattens every turn onto one truncated row, so
    the author's line breaks and paragraph structure are lost before they reach the viewport.
    *Root cause (verified in `src/tui/client.mjs` `transcriptTurnLines`):* the `operator`/`agent` branches
    render through `truncate(...)` (imported from `src/watchview.mjs`), whose
    `String(text).replace(/\s+/g, " ").trim()` collapses **every** whitespace run — `\n`, blank lines,
    and indentation alike — before the row is cut with an ellipsis. The live partial path
    (`renderPartial({ wrap: true })` → `wrapText`) flattens `\s+` the same way first, so the stream loses
    newlines too. *Reproduced:* a three-line agent turn (`Line one\nLine two\n\nLine four stays
    separate`) renders as the single row `◀ Line one Line two Line four stays separate`.
    *Fix direction:* split the turn body on explicit newlines first, then wrap each line to the viewport
    width, preserving blank lines — do NOT collapse `\s+`; the committed transcript and the live partial
    must share ONE newline-preserving wrap, so history and stream read the same.
    *Open call (designer):* the continuation gutter/blocks for a multi-line turn, and how a blank line
    reads in the conversation view. *Owner:* impl (TUI) + designer (surface). *Acceptance:* a seat's
    loaded transcript renders a multi-line turn as multiple viewport rows with its paragraph breaks
    intact (a golden/test pins a three-line + blank-line turn); a line longer than the viewport still
    wraps rather than truncating; the live partial uses the same rule.

124. **TUI: show the work item the selected seat is actively working on (operator request, 2026-10-17).**
    When the operator selects a seat (in the seat list and in that seat's conversation view), show the
    details of the queue item the seat currently holds: `id`, `subject`, `body`, `status`, `from`/`to`,
    and time-in-state. Today the TUI shows seat activity and the transcript but not the item the seat is
    working on, so the operator must cross-reference `queue`/`status` by id. *Grounded in:* the `RigQueue`
    document (`src/rig.mjs`), the read API (`src/readapi.mjs`), the TUI client (`src/tui/client.mjs`).
    *Open call (designer):* where the block lives (header vs status area), its length cap, and the 48-col
    floor. *Owner:* impl (TUI) + designer (surface). *Acceptance:* selecting a seat shows the claimed
    item's id, subject, body, and status; a golden frame pins it at 80×24; no new write path.

125. **Keep seat worktrees out of the project root (operator request, 2026-10-17).** `prepare_workspace`
    creates each item's worktree at `<root>/item-<id>` (gitignored), so a long-lived rig accumulates
    dozens of `item-*` directories a human must scroll past. Move the worktree root to a single ignored
    location (a sibling `<root>.worktrees/`, or one hidden dir inside the repo), and have the broker
    sweep terminal orphans there. Also fix **why they accumulate:** `carryVisibleState` copies the shared
    tree's dirty state into every new worktree, so most are born dirty and the clean-only sweep never
    removes them; a worktree should not inherit another item's in-flight changes. *Owner:* impl + lead.
    *Acceptance:* the project root has no `item-*` after a run; the worktree location is documented; the
    sweep covers it; a fresh worktree starts clean when the shared tree is clean.

**Sequencing (pm, 2026-10-17):** both behind the operator priority train (#1066) — pm did NOT pull
them forward, and the impl items are HELD until pm releases.
- **98** (feature: a seat's context consumption in the conversation view — the READ-SURFACE half of
  item 27; MUST reuse item 27's measure, not a second) — owners: designer #1106 (design call:
  denominator = recommended/effective window vs advertised 1M, tokens, cadence, 48-col floor,
  colour/NO_COLOR, cost), advocate #1107 (user call), impl #1108 (implementation, GATED on those
  rulings and items 27/97). The designer/advocate items are ADVISORY and may run now.
- **99** (bug: the `i` input affordance drops the conversation; fix = treat input as an OVERLAY on
  the current view) — owners: impl #1109 (fix, GATED), designer #1110 (footer/hint wording, advisory).

100. **Measure landing health — unlanded verified branches and time-to-land (operator request,
    2026-10-17).** The branch backlog (2026-10-17: 15 verified-but-unlanded branches) is invisible today:
    the store says an item is `done` while `main` does not contain it. We choose to **trust the agent to
    land** (no auto-gate) and **verify later** with a measurement the delegate can read — this item is that
    measurement, not an automation. A read-only measure over git + the store: count `<seat>-item-*`
    branches whose tip is **not an ancestor of `main`** while their item is `done` (the "unlanded-verified"
    count) and the age of the oldest (time-to-land). Reuse the existing read-only git audit (the Diagnose
    block in `docs/runbooks/merge.md`, or a `scripts/branch-audit.mjs`) — **no new write path, no broker
    hook, no auto-merge**. *Value test:* if the count stays near 0 without prompting, the measure earns its
    place; if it regularly exceeds a threshold, the landing step (W6) wants a different trigger, not more
    process. *Owner:* impl (measure) with the delegate (audit), riding item 2's metrics pattern.
    *Acceptance:* the metric appears in `metrics`/`status` and the delegate's clock-out audit reads it; no
    automation is added.

## Landing, merge & edit tooling (raised 2026-10-17)

From `docs/reviews/llm-prompting-for-git-merging.md` + `-followup.md` and the Aider competitor review
(`docs/reviews/aider-review.md`). All **registered, not scheduled** — `pm` sequences them. The runbook
half is already done this session (`docs/runbooks/resolve-merge-conflict.md`, and the `merge-tree`
pre-flight in `merge.md`); these are the code and measurement items.

102. **Edit-format measurement harness for our models (DeepSeek-V4.1-Flash / GLM-5.3-Flash).** No
     controlled edit-format benchmark covers these families (Diff-XYZ covers GPT/Claude/Gemini/Qwen), so
     the default format is unmeasured. Replay ~150–300 real repo edits, hold context fixed, vary only the
     format (unified diff / relaxed diff / anchored search-replace / native `edit`), and report Apply-EM,
     parse-failure, and wrong-region rates per model. Rides item 90's `format` verb so the EOL policy is
     fixed once. *Owner:* impl. *Acceptance:* a demo/script reports per-model apply-rate; the seat edit
     guidance names the chosen format.
103. **Object-store landing-train workflow.** `git merge-tree --stdin --write-tree` → resolve blobs →
     `git commit-tree` → `git update-ref`, so the shared tree never enters `MERGE_HEAD` (the direct fix
     for the 2026-10-17 incident). *Owner:* impl (delegate/operator path). *Acceptance:* a read-only
     pre-flight plus a documented object-store resolution; no shared-tree conflict markers.
104. **Conflict-graph ordering for landing trains.** Build the pairwise conflict graph from
     `merge-tree --stdin` and order the train to minimise overlap (GitHub's remove-and-reform analogue).
     *Owner:* impl. *Acceptance:* an order is produced for a real train and the clean-first sequence is
     shown.
105. **Per-hunk conflict resolver.** `{Left, Right, Base, Both}` + a free-form escape hatch (the #714
     case needed synthesis), keyed by chunk hash, with abstention → `defer_work` carrying the
     base/ours/theirs payload **inline** (coordinators cannot read files). *Owner:* impl. *Acceptance:* a
     demo resolves a real conflict; an ambiguous hunk produces a self-contained deferral.
106. **Deterministic parse gate with revert-on-error.** On every edit/merge: no leftover `<<<<<<<`,
     `node --check` on changed `.mjs`, no duplicate declarations, plus the item's demo (Aider's
     auto-lint/test loop). Revert and explain on failure. *Owner:* impl. *Acceptance:* the gate refuses a
     deliberately conflicted `checkup.mjs` (failing-first).
107. **`carryVisibleState` is conflict-aware.** Refuse (or warn) when a carried dirty path is unmerged
     (`UU`), so a worktree created mid-merge does not inherit conflict markers (`src/worktree.mjs`).
     *Owner:* impl. *Acceptance:* a demo creates a worktree over a `UU` file and shows the refusal.
108. **Chosen-side resolution without `git checkout`.** The seat guard denies `git checkout`; implement
     side selection as read+write of the stage blobs (`git show :1: :2: :3:`), or move it to the
     operator path. *Owner:* impl. *Acceptance:* a seat resolves a conflict without a denied command.
109. **Untrusted-conflict-content envelope.** Treat base/ours/theirs as data, not instructions; keep the
     byte-stable persona prefix authoritative; require snippet-only output. *Owner:* impl + lead.
     *Acceptance:* a resolved-payload test with injected prose in a conflict produces no instruction
     following.
110. **Conflict-replay eval harness.** Replay our own past conflicts as 20-line-context 3-way hunks;
     report Exact / Normalized / Conflict / Different / Invalid-Markdown; reuse but calibrate
     `src/judge.mjs` (structural validity deterministic, 100% gate). *Owner:* qa + impl. *Acceptance:* the
     harness runs on historical conflicts and reports the five categories.
111. **Lazy `checkup` import + `MERGE_HEAD` startup guard.** A mid-merge `checkup.mjs` currently makes
     every `node cli.mjs` verb a `SyntaxError`; make `checkup` dynamic and add a startup guard that does
     **not** import `checkup`. *Owner:* impl. *Acceptance:* with a conflicted `checkup.mjs`, `status` /
     `queue` still run (failing-first).
112. **Per-model edit-format selection + high-level-diff guidance.** Adopt Aider's per-model format knob
     and its "high-level diffs" instruction (30–50% fewer errors); adopt its bounded flexible patching
     (normalize/sub-hunk) but **not** the similarity fallback; always return the applied diff. *Owner:*
     impl. *Acceptance:* format is selectable per model and the guidance is in the seat prompt.
113. **Repository-map context selection for seats.** Rank the repo's symbols by a dependency graph within
     a token budget (Aider's repo map) as a prompt section, instead of navigation-only. *Owner:* impl +
     lead (design). *Acceptance:* a measured context/token reduction with no coverage loss.
114. **Prompt-cache ordering + keepalive.** Cache the constitution/persona first, then read-only context,
     then the repo map, then editable files (Aider's order); consider a keepalive ping for long-lived
     seats. *Owner:* impl. *Acceptance:* a measured cache-hit improvement on a long seat.

## External task-source adapters (raised 2026-10-17)

From `docs/reviews/llm-agent-project-management-tools.md`; accepted direction in `docs/PM-ADAPTERS.md`.
**Operator direction (2026-10-17): an external PM adapter is deferred** — no one interfaces an external PM
system soon and its value is unproven. Only the **task interface + storage format** (115) is elevated; the
external-only items below are **PARKED** until an external PM is prioritized (then `pm` sequences them).
`RigQueue` stays the single authority; adapters are one-way and idempotent.

115. **ELEVATED — task interface + storage format (internal + external boundary).** Define ONE stable task
     contract (`TaskSource` shape: `list`/`get`/`add`/`claim`/`transition`/`subscribe`) and a versioned
     `Task` storage schema, used by the internal queue and, when prioritized, by an external adapter, so
     adding one causes minimal churn. The external PM's purpose is **human authoring/organization** (PM →
     queue intake, queue → PM status), so the schema carries the human-owned fields (`priority`/`labels`/
     `collection`/`assignee`) as optional data and separates intake from status export, even while no
     adapter exists. Preserves: internal queue is authority, `subscribe` is the only wake, advisory
     dependencies, exported functions declare their return type (JSDoc `@returns`). Proposal in
     `docs/PM-ADAPTERS.md`. *Owner:* lead (design) + impl. *Acceptance:* the internal read/write path goes
     through the interface; a fake in-memory `TaskSource` passes the same contract tests; the schema is
     documented, versioned, and round-trips the human-owned fields with an explicit intake-vs-status split
     and a readiness gate; claim selection honors an explicit `priority`/`rank` so human ordering survives
     ingest; a human `assignee` is distinct from the seat `to`.
116. **PARKED — local/stdio MCP client adapter as the first `TaskSource`.** One MCP client reaches multiple
     trackers instead of N REST integrations. The client runs in the operator/broker path (where the
     tracker token lives); **start with GitHub**, which has a locally runnable stdio server plus
     ETag/conditional polling. Remote/HTTP Linear and Atlassian are operator-gated. A seat never receives
     a tracker tool or credential. *Owner:* impl + lead. *Acceptance:* the adapter reaches a local stdio
     MCP server; the tracker credential never reaches a seat.
117. **PARKED (follows the adapter) — read-only external status view + inline coordinator status.** A read-only surface for humans
     watching the swarm (the report's `clientViewEnabled` analogue), riding the existing read API/TUI with
     no mutation path, **plus** a self-contained inline status a coordinator seat (`pm`/`lead`, which has
     no file tools) can read. *Owner:* designer + impl. *Acceptance:* a read-only view renders queue/seat
     status; no write verb is added; `pm`/`lead` receive the status inline.
118. **PARKED — verify the seat-egress mechanism.** `src/confine.mjs` enforces paths, env, and command blocks but
     has **no network/socket rule** (verified 2026-10-17), and no other egress control was found.
     Determine what, if anything, blocks seat egress (host config, or nothing) and state it truthfully in
     `docs/PM-ADAPTERS.md`. *Blocks item 116.* *Owner:* delegate + lead. *Acceptance:* a documented,
     tested statement of whether a seat shell can reach the network.
119. **PARKED — fake MCP server + sync-correctness metrics.** A local stdio MCP server that replays a recorded
     tracker event stream and injects faults (429 / 304 / edited / reopened); metrics computed read-only
     from the store: duplicate rows, lost updates, mapping drift, reconcile divergences. *Owner:* impl +
     qa. *Acceptance:* a demo drives the adapter against the fake server and reports zero duplicates and
     zero lost updates.
120. **PARKED — one-way sync + external-id ingest + second-writer detection.** Ingest create-once keyed on
     `(tracker, external_id)` (never derived from content) with a `requestId`-style idempotency key; record
     the tracker's `updatedAt` at ingest and raise a second-writer alert on uncaused divergence; terminal
     queue states are immutable from the tracker side. *Owner:* impl. *Acceptance:* re-ingest is a no-op;
     an external edit to a terminal item raises a notice and does not resurrect it.
121. **PARKED — state-projection module (queue → tracker).** Compute the tracker's expected label/status from the
     queue on every sync so a re-sync is a no-op; record transitions the tracker cannot express
     (`claimed ↔ deferred`) as labels, not statuses. **Keep dependencies advisory** — do not port Agent
     Board's enforced DAG. *Owner:* impl. *Acceptance:* a demo shows an idempotent projection and an
     advisory-dependency item still claimable with unmet deps.
122. **PARKED — Agent Board Windows operability spike.** Test whether `quentintou/agent-board` (MIT, JSON files,
     localhost REST + MCP) runs on native Windows and is usable as a **read-only mirror candidate**; do
     not embed it. (Vibe Kanban is sunsetting and is not a candidate.) *Owner:* devtools + impl.
     *Acceptance:* a documented Windows run/no-run result; no dependency added.
123. **DEFERRED (follows the adapter) — value case for an external tracker (decision + measurement).** The PM-tools research establishes
     feasibility and practice, not benefit. Define what "efficiency / correctness / effectiveness" means
     at the human-facing layer, then measure before adopting a tracker beyond an optional source/mirror:
     intake latency, priority alignment, time-to-human-decision, duplicate work, blocked time. *Owner:*
     lead + delegate (decision), qa (measurement). *Acceptance:* a documented value case with measured (or
     explicitly unmeasured) criteria; the tracker stays optional.

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
   is fine for seat-to-seat coordination and wrong for a product's
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
    *Gate checklist:* (1) a `security.sec` position — an EXTERNAL consult, OPERATOR-routed; the
    delegate's security round (`docs/reviews/security-codemode-review.md`: falsifiable controls
    E1–E14 + the read-only T0 first cut) is recorded against this item, and gate 1 stays OPEN until
    `security.sec` returns; on return, fold the ratified controls into `docs/CODEMODE.md`, record a
    `D`-entry, and close gate 1. (2) the boundary SC1–SC3 land first. (3) the library review's four
    corrections stand as acceptance criteria. (4) **128** (a mid-run sandbox bound) and **129** (the
    codemode audit sink) are folded in here as gate items, NOT standalone starts — 129 is a
    P1-Evidence prerequisite (without it a codemode execution is one opaque line) and 128 bounds a
    single long call that D64 cannot see until the run settles.
    *Batchability rule:* batch a step only if it is idempotent / side-effect-free, has NO
    human-approval gate, consumes NO blind rate limit, and is NOT the failing-first checkpoint;
    commit / push / approval stay PER-STEP.
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

35. **A skill loader — inject the skills a seat or a task actually needs.** Today skills are
    inlined into instruction text at `up`: `scripts/from-openrig.mjs` reads
    `agents/shared/skills/<name>/SKILL.md`, records `seat.skills` names, and appends a
    `## Skill: …` block — and the converter says why in one line: *"durig has no separate skill
    loader yet"*. So every seat carries every skill its profile names, for the whole run, whether
    or not the work needs it.
    *The mechanism already exists.* pi-durable's `PromptSection` renders *"in order before each
    request"* and an extension can contribute sections (`Extension.sections`, `wrapSection`), so a
    loader is an extension plus a selection rule rather than new plumbing. `AgentState.instructions`
    is already per conversation, so a seat-scoped choice is expressible today.
    *Selection is the design problem, not injection.* To weigh: declared per seat in the rig
    (static, cheap, no surprise), selected at routing time from the item (dynamic, needs an
    auditable rule), or both — the rig declaring what may be selected and routing choosing among
    it. Whichever wins, **"load everything" must not be the fallback**: a skill nobody applies is
    prompt weight on every turn.
    *The tension to design against, and it is not small:* item 33 established that the prompt
    prefix must be **byte-stable** for prefix caching, and a per-request section that changes
    silently zeroes the cache hit rate. So a skill section has to be stable **per item or per
    seat**, never per request — the selection is made once and held.
    *Proof:* a demo where two seats in one rig carry different skills, and a seat whose work does
    not match a skill does not carry it.
36. **Tell the operator when a rig should have skills — as a `check` rule, not a measure.** The
    question "should durig nudge the user to write a skill?" has a cheap and principled answer,
    and the precedent fixes its shape: `shared-reviewer-model` is a config-derived property that
    is deliberately a **`check` rule**, and it is **kept out of the metric notices precisely
    because it is already visible as a rule**. Skill coverage is the same kind of thing — a
    property of a rig file, not a quantity that moves — so a measure would be a config value
    dressed as a measurement, against D24's "measures are measured, not listed".
    *Deliverable:* a rule with a stable id (e.g. `no-skills-declared`) that fires when a rig
    declares **specialised seats and no skills**, at `fix-now` severity: a rig whose seats have real
    capabilities but no written procedure is the same smell as one with no verifier. Its fix text
    should name the mechanism — where a skill lives, how a seat declares one — so the guidance
    arrives *with the finding* rather than in a document the operator has to go and find.
    *Guard against the failure mode:* it must not fire on the minimal or starter rig, or on seats
    that only route work. A rule that nags every new rig teaches the operator to ignore findings,
    which costs more than the skill it is asking for.

37. **A run that never starts must not look idle.** This is F11, and it is the worst SHAPE rather
    than a bad outcome: a `send` killed mid-run leaves a submission admitted but unscheduled, and
    nothing in the platform says so - `status` reported no attention, `queue` was empty, and the rig
    read as idle-healthy while a request sat unprocessed. That is the failure this project treats as
    cardinal everywhere else (the empty-rig guardrail, the empty-transcript note): an empty surface
    must never be indistinguishable from a healthy one.
    *(a) Detect it, from data already persisted.* A submission admitted more than N seconds ago with
    no attempt started is a derived fact, so it can be an attention notice carrying the `scope` and
    declared blind spot every other notice carries - no new write path (D24), same channel as
    `idle_with_queued_work` and `deferred_awaiting_answer`. As with `check`'s findings, the notice
    must name the fix rather than only the symptom.
    *(b) Give the operator a deliberate way to advance it.* Viewers do not schedule **by design** -
    a passive `watch` must not kick the queue it is observing - so the escape hatch has to be an
    explicit verb (`resume` or `doctor`) that opens the harness, re-arms scheduling and reports what
    it found. Today the only route is to repeat the send with the same request id, which works
    (D34's idempotency doubles as the resume mechanism) but is a trick rather than a command.
    *(c) Make it terminal, which is item 6's real answer.* A submission that never ran, or a run that
    never settles, should reach a legible terminal state - abandoned, with a reason - instead of
    resting invisibly. Item 6 was written about deadlines and attempt caps; F11 shows it also needs
    an **admission** deadline.
    *Proof:* a demo that admits a submission without scheduling it, asserts the notice appears, and
    asserts the verb clears it - falsifiable by disabling the notice.
    **Status 2026-10-11:** (a) detected — `admitted_not_started` was added to
    `src/attention.mjs` (age from the admitted entry's timestamp, beyond a
    threshold, with no live generation slot) with `demo/stranded.test.mjs`
    (positive + two negative controls + an end-to-end `status` check), pending
    qa verification. (b) the `resume`/`doctor` verb is still queued. **The F11
    remedy as written is false:** re-sending with the same `--request-id` does NOT
    re-arm a stranded submission — pi-durable's `admitSubmission` returns the
    existing submission for a known id *without scheduling it*, so `submission.wait()`
    hangs (reproduced). Recovery today means `harness.abortSubmission(id)` then a
    fresh send; the verb must do that deliberately.
    **Refined 2026-10-11 (observed live):** `abortSubmission` returns `already_placed`
    for a submission whose run already STARTED (status `placed`) — it withdraws only
    `queued` inputs. When an aborted `send` left impl's submission #1122 `placed`
    with its process dead, the verb could not clear it that way. So 37(b) must also
    handle the placed case: cancel the run via `harness.abortTask`/
    `conversation.abort()` (or re-drive it under a live harness), not just abort
    queued submissions. The live rig surfaced the state correctly throughout
    (`admitted_not_started` for #1122, `generation_stale` for the dead lease), so
    37(a) did its job; the gap is only in the recovery verb.

38. **Self-driving queue: wake the seat when work is enqueued, instead of an external clock**
    (raised by the operator 2026-10-11). Today **only `send` ever starts a run** — `conv.submit`
    appears exactly once in the whole tree, in `cmdSend`. `send_work` and `complete_work` write
    queue rows but wake nobody, and viewers deliberately do not schedule (D11), so a chain
    (`pm → impl → qa → pm`) dies after the first hop and an external actor is the clock. The
    operator's ask: let a seat be woken by its own queue rather than by something outside the rig.
    *Honest constraint:* an LLM cannot be woken by a database change on its own — delivering a
    notification needs a running process. But that process does not have to be external: **the act
    of enqueuing can be the wake.**
    *(a) Wake-on-enqueue — preferred, smallest.* `send_work`/`complete_work`/`defer_work` also
    `conversation.submit()` a short, stable "you have queued work" input to the recipient inside the
    same commit, so the recipient's run starts as part of the durable chain. This keeps D11 (viewers
    still never schedule), inherits the genlock concurrency cap, and lets pi-durable's inbox queue
    the input when the recipient is already busy. Constraints: (i) it must be edge-gated like any
    send, so a seat cannot wake a seat it may not reach; (ii) it must not wake anyone for a notice
    once 39 lands; (iii) item 33 — the wake input mutates the conversation prefix, so it must be
    byte-stable per wake and not per request or it zeroes the cache; (iv) bound the recursion.
    *(b) A resident `durig run` process — the platform-native model, not a fallback.* One long-lived
    process holding a harness with `resume()`, scanning the queue and driving recipients (this is
    also the only place item 6's deadlines and retries can live). pi-durable's "Multiplayer" post
    reports this as its intended shape, not a workaround: *"everything a UI needs is committed
    state, so any number of clients can attach to any conversation in the harness"*, the initial view
    already carries *"the answer being streamed"*, and *"`thread.watch()` delivers the exact
    operations of every commit, small enough to send over a socket."* So the resident process is a
    **server** (item 40(a)); the clock is the harness itself, and clients are subscribers rather than
    storage pollers.
    *Proof:* a demo where one `send` to `pm` causes `pm` to route, `impl` to run and complete, and
    `pm` to receive the DONE — with no second external send; falsifiable by disabling the wake.
    *Dependency:* 39 must land first, or wake-on-enqueue turns a single item into an unbounded wake
    storm across the DONE ack chain.

39. **A DONE notice must not generate a DONE notice.** Found by reading the live selfdev queue
    (2026-10-11): `complete_work` always enqueues `DONE #<id>` back to `item.from`, *including when
    the completed item is itself a DONE notice*. The queue grew `#3 = DONE #1`, `#5 = DONE #3:
    DONE #1`, `#9 = DONE #5: DONE #3: DONE #1 …` — an unbounded acknowledgement chain that burns a
    seat turn per hop and grows the subject without bound. It is a protocol defect, not seat
    misbehaviour: every seat did exactly what the tool tells it to. Fix: mark notice items at
    enqueue (`isNotice: true`) rather than string-matching the subject, and have `complete_work`
    suppress the notification for a notice; or make notices non-claimable (cleared by `status` or a
    verb instead of by `claim_work`). *Proof:* a demo that completes a DONE notice and asserts no
    new item is enqueued; falsifiable by reverting the suppression.

40. **Live token streaming into a follower window** (raised by the operator 2026-10-11). `log <seat>
    --follow` reads **committed** storage entries, and an assistant turn is committed as one entry
    only when the run settles — so a reader watching a seat sees the reply appear whole at the end,
    never as it arrives. The partial `text_delta`/`thinking_delta` events do exist and are rendered
    live, but only inside the process driving the generation: `send --stream` writes them to stderr
    through `createLiveRenderer`/`wrapProviderWithLiveView` (`src/streamview.mjs`). A separate
    `--follow` window therefore cannot see them. **Corrected 2026-10-11:** the claim that nothing
    publishes partial output cross-process was wrong — the in-flight message is persisted in the
    `pi.live` document (see (c)). Options, in order of preference:
    *(a) A resident harness server with `viewState()`/`watch()` clients — platform-native.* This is
    what the "Multiplayer" post describes: one process owns the harness, a client calls
    `thread.viewState(context)` for *"the transcript, the answer being streamed, running tools and
    their output, queued messages, the agent, and usage"*, then `thread.watch()` (compact commit ops,
    socket-friendly) or `watchEvents()` (friendlier, more bytes) for changes; a late/reconnecting
    client simply starts from the current view. It is the same resident process as item 38(b),
    which is why 38 and 40 are one architectural decision: build the server once and both the queue
    driver and live streaming fall out. durig's `log --follow`/`watch` become clients instead of
    storage pollers.
    *(b) Publish progress to a sidecar.* The driving process writes deltas to an ephemeral artifact
    beside the store (like `genlock`'s slot files) that `log --follow` tails. Cheap and local, but it
    is a new write path and a new artifact to bound and clean up, and it must not be replayed as
    history.
    *(c) Read the persisted in-flight message — now the cheapest, and already available.* pi-durable
    **commits** the in-flight assistant message to the `pi.live` document during the run
    (`docs.pi.live.generation.message`; `PARTIAL_PATH` in `harness/events.ts`), and
    `ConversationViews.#build` hydrates its initial view from storage
    (`conversationDocumentOnLine`). So a viewer that already reads storage can poll the `pi.live`
    document for the seat's conversation and render the partial answer as it grows — **no new write
    path** (D24), no harness, D11 intact. This answers the operator's "the examples stream, why
    can't we": they can because their **viewer is the driver** (in-process commit subscription,
    `watchEvents`/`CommittedWatch`), and `send --stream` already does the same in-process; the
    follower process simply never read the `pi.live` document it already has access to. Prefer this
    over (a)/(b); (a) becomes an optimisation (no poll latency) rather than the enabling step.
    *D11 tension — revisit its conclusion, not its evidence.* D11 established that sqlite has no
    cross-process change notification and concluded that durig's viewers must read storage directly
    and never attach a harness. The **evidence** holds; the **conclusion** was too strong. The
    platform's answer is one resident writer/server whose clients subscribe — which keeps the
    single-writer discipline intact while making streaming and multiplayer possible. A viewer opening
    a harness was the thing to avoid; a single long-lived writer that *is* the harness is the thing
    to build. Record that when 38(b) lands.
    *Constraints that decide the shape:* partial output is **not** committed state, so it must never
    masquerade as an entry or be replayed as history (the single-writer discipline, D24); a follower
    must visibly distinguish "streaming now" from "committed"; and a crashed driver must leave no
    half-line that a later reader mistakes for the reply.
    *Proof:* a demo where a follower process receives partial assistant text **before** the run
    settles, and the settled entry then supersedes it — falsifiable by disabling the publication.
    **✅ done (c) (2026-10-13, direct).** `readLiveState` (shared read API) reads the
    conversation-scoped `pi.live` document; `partialView` turns `generation.message`
    into a plain value and is deliberately NOT a turn (no entry id, dropped at run
    end) so it can never replay as history. `formatPartial` renders it with a `◌` /
    `streaming… (not yet committed)` marker a committed turn never uses. `log
    --follow` shows it in a TTY live region and, in JSON, emits a `partial` object
    with no `entries` key; `watch` gains a per-seat `streaming` field and a
    `⟳ streaming:` row (D24: no new write path, D11: read-only). `demo/livestream.test.mjs`
    is demo 49: a follower sees the partial before settle, then a real `send`
    commits and the partial is withdrawn; falsified by disabling the publication
    (follower then times out). Full suite 49/49.

41. **Emergency stop: cancel a seat's run and halt its loop** (raised by the operator 2026-10-11).
    While operating, the operator needs a way to STOP an agent in an emergency — when it has entered
    a degenerate loop (dogfood F9/F5: a coordinator that investigates instead of routing; a model
    that emits tool calls as text and burns turns) or is behaving harmfully. Today there is no such
    verb: the only ways to stop a run are to kill the driving `send` process (which leaves an
    admitted-but-unscheduled submission — F11) or to kill a pid read off the generation lease, both
    crude and neither recording why.
    *The platform has the primitive.* `harness.abortSubmission(id)`, `harness.abortTask(id)` and
    `conversation.abort()` exist; what is missing is a durable, deliberate operator surface and the
    guarantee that it actually halts a process that will not cooperate.
    *Design constraints that decide the shape:*
    (i) **It must not depend on the agent cooperating.** A seat in a degenerate loop must be stopped
    by the harness/CLI, not by asking it to stop in prose — so the stop is enforced by the driver
    that holds the generation lease, not by a message into the conversation.
    (ii) **It must reach a run in another process.** The driver may be a separate invocation, so the
    stop travels through durable state (a control document the driver checks between turns) or
    through the lease (signal/kill the holder pid); a stop that only works in-process is useless.
    (iii) **Fail closed and legible.** The halted item/submission reaches a terminal state with a
    recorded reason (`aborted: operator stop`), surfaced on the attention channel — not left as a
    silent strand.
    (iv) **It must not destroy durable work.** Halting stops the loop; the queue item, the transcript
    and the task checkpoints stay recoverable (resume is item 37(b)'s verb), so an emergency stop is
    not the same as losing the task.
    (v) **Idempotent and bounded.** Stopping an already-stopped seat is a no-op, and one command
    halts one seat without touching others (or a `--all` for the whole rig, explicit).
    *Shape:* `node cli.mjs stop <seat> [reason]` (and later a rig-wide `stop --all`), which aborts the
    in-flight submission/task, releases the generation lease, and records the reason.
    *Proof:* a demo that starts a run, stops it mid-flight, asserts the run reaches a terminal
    `aborted` state with the reason, that the lease is released, and that the item is recoverable —
    falsifiable by disabling the stop hook.

42. **A supervisor: derive stalled work and decide to step in — and decide whether it is still
    needed.** Raised by the operator 2026-10-11 after observing that liveness currently depends on
    every seat *cooperating*: nothing observes a seat that has stopped and acts. Our own run is the
    evidence — a policy-compliant team still stalled (F9 pm investigating instead of routing; the
    DONE-of-DONE loop; F11's stranded submission; a model emitting tool calls as text; MiMo
    wandering). In none of those did a member neglect its policy; the **substrate** failed to notice
    or act. What pushed the operator to choose the DONE fix (39) was `queue-ageing`/`admitted_not_
    started`/`idle_with_queued_work` — derived state, not diligence.
    *The shape, if built.* One always-on observer (the resident harness of 38(b), or a loop beside
    it) that reads the attention notices already derived from durable state
    (`idle_with_queued_work`, `queue-ageing`, `admitted_not_started`, `deferred_awaiting_answer`,
    `last_run_failed`, `generation_stale`, `step-repetition`) and *acts*: wake the seat (the 38
    driver), escalate to PM or the human (the 37 `defer_work` channel), or reassign/close. It is
    **push, not pull**: PM gets a notice only when there is something to act on — PM must not hold a
    polling tool (item 4 excluded polling; it invites stampedes and correlated checks). Prior art:
    OpenRig's parked/stuck sweep (its F8) and wake timers (F9).
    *The evaluation gate, which is the point of recording it now.* 37 (37a notice, 37b verb), 38
    (self-driving queue) and 39 (no DONE loop) already remove the main stall classes, and 6 adds
    deadlines/terminal states. So do **not** build a separate supervisor until dogfooding with those
    landed shows residual stalls the driver + notices cannot handle. The item exists so that
    question is asked on evidence, not assumed either way: keep a running list of stalls observed
    after 37/38/39 are live, and if the driver + attention channel cover them, **close this item as
    unnecessary** (recording why); if a class remains that only a cross-seat observer can catch,
    build the narrow supervisor for exactly that class.
    *Proof (if built):* a demo where a seat is left stalled by durable state and the supervisor,
    without any human action, either wakes it or raises an escalation within a bounded time —
    falsifiable by disabling the supervisor.

43. **Degenerate-loop mitigation for DeepSeek seats — reasoning effort + structural termination.**
    Observed 2026-10-11: on a long agentic turn, `impl` (DeepSeek-V4.1-Flash) emitted a "OK. Let me
    call write." repetition *hundreds* of times and never called the tool, then dumped the tool
    call as text — the same class as the earlier `<parameter name=...>` leak. `thinkingFormat:
    "deepseek"` (item 38 notes) fixed the *simple* tool-call-as-text case but not this one.
    *Ruled out — do not retry:* request-level sampling penalties. `temperature: 0.3` + penalties
    were tried and reverted: a repetition loop is a low-entropy rut, so lowering temperature makes
    it stickier, and DeepSeek's own docs say thinking mode ignores `temperature`/
    `frequency_penalty`/`presence_penalty` while clamping `top_p` up to 0.95; `repetition_penalty`
    is not in DeepInfra's documented set. (Recorded here so the next session does not re-propose
    it — see the 2026-10-11 review of that patch.)
    *Candidate levers, best first:*
    (a) **Expose reasoning effort.** DeepInfra's V4.1-Flash doc lists `reasoning_effort` as an
    integer 1–100, but durig exposes no reasoning-effort control at all, so the model always runs
    with thinking `disabled` (our compat sends `thinking: {type:"disabled"}`). If the "let me do
    it" monologue is thinking that has nowhere to go but content, routing it to
    `reasoning_content` is the fix. Wire a per-seat/per-rig reasoning effort into the model or
    settings and measure `step-repetition`.
    (b) **Structural termination, not statistics.** A deliberate per-run `maxTokens` cap and the
    `terminate: true` tool-result lever bound a runaway turn where sampling cannot; this is the
    same seam as item 6 (deadlines / attempt caps).
    (c) **Verify the reasoning-content path.** Dump the outgoing payload on a *second* tool-call
    turn and confirm `reasoning_content` carries real thinking rather than `""` — the leading
    hypothesis is reasoning-history contamination, and it is cheap to check before building (a).
    (d) **Fallback:** substitute the worker model for long tasks (Qwen3.6 stayed on task where
    V4.1-Flash looped) or shrink items; record which, so it is a decision and not a habit.
    *Predicted direction, written before the change (item 2's loop):* (a)/(c) should move
    `step-repetition` down; (b) should make "unaware of termination" measurable as a bound rather
    than a hope.
    *Proof:* reproduce the loop deterministically (a scripted fixture), then show the chosen lever
    prevents it — falsifiable by disabling the lever.
    **Wall-clock bound (#874 `7013294`) + named-pattern degenerate-text registry (#875 `50bc585`)
    delivered; reasoning-effort lever (a) still open.**

44. **A `reset`/`clean` verb for a seat whose context has degenerated.** Found 2026-10-11 while
    pushing `impl` through item 37(b): after the model emitted a 16 KB "OK. Let me call write."
    repetition (item 43), **every** subsequent turn degenerated the same way — including on
    DeepSeek-V4-Flash-0731, which had completed an earlier item cleanly. That proved the cause was
    **context contamination** (the model self-conditioning on its own degenerate turn in history),
    not the model. `conversation.reset(handoff)` in pi-durable fixes it: it writes a `pi.reset`
    boundary so prior turns leave the context without deleting the durable transcript, and 37(b)
    then completed in one clean run. durig has **no verb** for this — it had to be done with a
    one-off script (the same one-off that recovered the stranded submission, which is 37(b)'s job).
    *Shape:* `node cli.mjs reset <seat> [handoff]` that calls `conversation.reset()`, reports the
    entry id it wrote, and refuses (or warns) when the seat holds a live generation lease. Related
    to 41 (emergency stop): 41 halts a runaway run, this clears the poisoned history after it.
    *Proof:* a demo where a seat's transcript contains a degenerate turn, `reset` is run, and a
    subsequent turn demonstrably excludes the prior turns (assert the reset boundary is the
    context head) — falsifiable by disabling the reset.

152. **A simple core plus an opt-in extension layer (IDEA TO EXPLORE LATER — NOT SCHEDULED).**
    Recorded 2026-10-17 at the operator's request, as an idea to explore later — explicitly *not*
    scheduled, and *not* sequenced ahead of the critical path (`#1610` MAIN-RED, the crash-proofing
    cluster). *Numbering:* the operator first proposed 132 (taken — the API-key-management item),
    then 151; 151 is also taken (`competitor-review-covered`, below), so this entry takes the next
    free number. When it is eventually picked up, route the interface/seam *design* to lead (an
    architecture-level doc, plus a numbering decision).
    *Why it is not a new mechanism.* The extension seam already exists: pi-durable's
    `defineExtension({ name, sections, tools, hooks, tasks, wraps })` is installed by `src/rig.mjs`
    (`Router`, ~line 271), `src/seatguard.mjs` (`SeatGuard`) and `src/seattools.mjs` (`SeatTools`),
    and the loader exists (`src/extensions.mjs`; ROADMAP 23, done). The gap: the seam accepts only
    *harness-level* contributions, from *external module paths*. durig's own features cannot
    register a CLI verb or be lazily loaded — `cli.mjs` (~2.7k lines, ~25 verbs) statically imports
    its feature modules (37 top-level imports; only `checkup` is lazy), so every verb pays the load
    cost for every feature and "off" is not a real state (violates D29's cost rule).
    *Proposed shape (record only).*
    (1) Freeze the core to the ASK E "NOT candidates" (`docs/reviews/ask-e-extension-seam.md` §2):
    the store seam (`src/rig.mjs`), the single-writer wake family (broker/driver/scheduler/genlock),
    the trust boundary (`confine.mjs`/`seatguard.mjs`), the CLI dispatcher + JSON contract (D21),
    config, and the extension loader (~8 modules).
    (2) Widen the seam by one axis: an extension declares CLI verbs (a `commands` field), loaded
    lazily per verb; `cli.mjs` becomes a dispatcher over a registry; an un-enabled extension's verb
    does not exist and says "not enabled (enable it with ...)", distinct from "unknown command".
    Extraction candidates (ASK E §1): `src/worktree.mjs`; the TUI (`src/tui/client.mjs`,
    `src/tui/driver.mjs`, the view kit); `src/checkup.mjs`; then a second wave:
    metrics/provenance/attention, format, optimizer/judge, degeneration/secretdetect.
    (3) Opt-in surface, in order of user contact: Profile (data, not an edition — D29; "recommended
    is mostly rig shape", D35); an enable list (bundled extensions by *name*; third-party by
    explicit *path* — no auto-discovery, `src/extensions.mjs`); per-seat/per-role scoping via the
    existing `configure(tx, convId, { extensions })` seam surfaced in the rig spec (e.g. terse-voice
    stays off for user-facing roles, ROADMAP 20); `DURIG_EXTENSIONS` stays as the ad-hoc escape
    hatch; `config`/`up`/`metrics` keep reporting the resolved/active set (provenance, ROADMAP 19).
    (4) Off costs nothing (D29): lazy import; tools/sections enter the registry only when enabled —
    no prompt tokens, no tools the model sees, no test/doc load.
    (5) Easier to test: a defined extension contract lets each component be exercised in isolation
    against a stub core instead of only through the whole CLI (today a feature's test surface is
    entangled with `cli.mjs`, D21) — the *same direction* as the open "test-suite partitioning by
    functional area" work (`docs/NEXT.md`); link them rather than duplicating.
    (6) A better-defined interface so a different implementation can plug in. State it honestly: a
    user may swap only in the *extension* layer (view kit, worktree strategy, formatter, retrieval,
    TUI, ambient measures). The core is deliberately *not* pluggable — ASK E's binding constraints
    (i)–(iv) forbid a plugin writing the store, a second writer path, git state-mutation authority,
    or splitting the single writer. Any change requiring a second writer or a different store is
    out of scope by construction.
    *Constraints recorded with the item:* ASK E (i)–(iv); D29 (one distribution, no
    `durig-core`/`durig` editions; profiles are data; off costs nothing); D21 (CLI stays
    non-interactive, one JSON document per command). *Prerequisite:* the command spool
    (#912 / ROADMAP 71) is what makes extension writes safe.
    *Grounding (verified present):* `docs/reviews/ask-e-extension-seam.md`; `docs/DECISIONS.md`
    D29, D35; `docs/ROADMAP.md` items 18, 19, 20, 23, 71 and this section; `src/extensions.mjs`;
    `src/rig.mjs` (`Router`); `src/seatguard.mjs`; `src/seattools.mjs`; #538 (the work-item *view*
    as the first extension case, done — the general seam remains unregistered); `docs/WORKFLOWS.md`
    "Deriving 'recommended'". *Action now:* docs-only — this ROADMAP entry plus the two
    cross-links; no implementation, no design now.

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

59. **A public documentation site — GitHub Pages, for newcomers, users, and maintainers.** The repo is
    becoming public (item 22) and its docs are substantive but organized for *us*: `STATUS`/`NEXT`/
    `DECISIONS`/`ROADMAP` are internal working surfaces. Three audiences need three shapes — a
    **landing page** for someone first hearing about durig (what it is, why it exists, a 60-second
    example), **end-user pages** for operating a rig (install, quickstart, the CLI verbs, the TUI,
    configuring a rig, troubleshooting), and **maintainer pages** for changing it (the broker and
    architecture, `docs/PI-DURABLE-INTEGRATION.md`, how to build on pi-durable, the decisions record,
    how to contribute). Static site on **GitHub Pages** (the operator's host choice); the **framework
    is an open decision** — evaluate on: content is already Markdown; no server; a native-Windows
    build; minimal dependencies; reproducible/pinned builds; and how cleanly it projects pages from
    `docs/` **without duplicating** them (the internal docs stay the source of truth, D62).
    *Owner:* `scribe` (project-level surfaces: FEATURES/STATUS/README) · *Consulted:* `designer`
    (information architecture + landing page), `devtools` (build/deploy to Pages), `advocate`
    (workflow fit), operator (framework choice).
    *Depends:* item 22 (the public repo); the surface-decision rule (where the site sits relative to
    the CLI and TUI).
    *Acceptance:* a static site that builds on native Windows and deploys to GitHub Pages; a landing
    page, at least one end-user task page, and a maintainer page; internal links resolve; the build is
    reproducible from the repo with no un-committed generated content.
    *Open decision:* the framework (e.g. Astro Starlight, MkDocs Material, Docusaurus, VitePress, or a
    plain Markdown renderer) — a small evaluation, not a commitment.

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

## Borrowed from agent-fleet (raised 2026-10-12)

Prior art: `docs/ARCH-COMPARISON-agent-fleet.md` (layer map + adopt-or-build),
`docs/BORROW-FROM-agent-fleet.md` (inventory → filter), `docs/COMPETITORS.md`,
and `docs/SELF-ADMIN.md` (the improvement register). Six mechanisms, ranked;
each is `advertised-elsewhere` evidence, grounded per claim in the agent-fleet
clone. Deliberately **not** numbered into the 0–44 sequence, to avoid the
collision the team hit when it invented `#45`.

- **RANK 1 — thin-context return contract.** A claim's result returns a PATH past
  a threshold, not an inline body. **✅ done (2026-10-12)** (`src/rig.mjs`
  `thinResultText`, `demo/thincontext.test.mjs`; qa-verified, suite 39/39).
- **RANK 2 — ratcheting task tier.** The PM task tier latches per task; raising it
  needs a stated reason (agent-fleet's 13-minute/47-hour post-mortem).
- **RANK 3 — Verification Contract result shape.** `complete_work` carries an
  orthogonal execution/changes/verification/acceptance result bound to revision,
  command, exit status and evidence, so a completion cannot read as a pass.
- **RANK 4 — ordered context-pressure guard.** warn → preserve-and-settle → one
  compaction; the *ordering* is the invariant. Feeds items 27/28. **Amendment (2026-10-17):**
  the guard must own the trigger and set the platform's automatic threshold *above* its own,
  because the platform default cannot know a model's effective window or see the
  degenerate/dirty-worktree state (follow-up research; item 27).
- **RANK 5 — drift watchdog.** deterministic-first in-flight observation that can
  terminate as `drift_stop`. Feeds items 42/43.
- **RANK 6 — independent runtime axes** (work mode × roster × peer topology).

**Root causes found while doing RANK 1** (see `docs/DOGFOOD.md` F13): (a) the queue
has no non-claimable **held/registered** state, so "registered, do not start" is
expressed as `queued` and gets claimed; (b) the stalled-claim re-wake carries a
queued-oriented message, so a seat holding claimed work self-reports "no work"
and idles. Registered as selfdev backlog #86/#87; (a) is being built as #90.

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

**Follow-up research landed 2026-10-17** (`docs/reviews/context-compaction-followup.md`,
commissioned via `docs/reviews/context-compaction-followup-research-prompt.md`). Its headline
changes the trigger question: durig's curated catalog sets `contextWindow: 1_048_576` for
DeepSeek-V4.1-Flash and GLM-5.3-Flash (`src/providers/deepinfra-models.ts:156,166`), so the
inherited auto-compaction threshold (`contextWindow − reserveTokens`) is ~1.03M tokens — while
the report finds Z.AI's own GLM-5.3-Flash evaluation caps at **300K** (`advertised-elsewhere`)
and the best DeepSeek-V4 practitioner data puts the precision-preserving band at **150–250K**
(`community`). The inherited default is therefore ~3–4× past the operating point, i.e.
automatic compaction effectively never fires before quality collapses. Items **92–97** below
are the report's proposed work; items 27, 28, 30b and RANK 4 carry dated amendments. Two
internals the report flagged **unverified** were then checked and resolved: masking is
**already available** as `ContextEdit { target, action: "omit" | "replace" }`
(`pi-durable/dist/types.d.ts:262`; item 92 is exposure, not invention), and `Usage.reasoning`
is a **subset of `output`** (billed as output; inclusion in the *input* window remains
provider-side and unmeasured). Items 92–97 are **registered in this backlog, not scheduled** —
`pm` sequences them.

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
    *Amendment (2026-10-17, follow-up research).* The threshold basis is now concrete and
    wrong-by-default: `contextWindow − reserveTokens` against a 1M configured window puts the
    trigger at ~1.03M tokens, ~3–4× past the vendor's own operating point (GLM-5.3-Flash
    evaluated to 300K; DeepSeek-V4 precision band 150–250K). The measure must report pressure
    against a **measured effective** window, not the advertised one, and the ordered guard
    (RANK 4 / #62) should be the authority that sets the platform threshold *above* its own
    trigger. Item 97 is the probe/replay harness that measures the effective window.

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
    *Amendment (2026-10-17, follow-up research).* 28a must be **blocked** on two states the
    platform cannot see: a **degenerate stop reason** (a summary can reach a normal stop yet be
    a stub or miss its required sections — reuse pi's structured-section validation) and a
    **dirty item worktree** (a summary can lose which files were touched — Factory's
    artifact-tracking finding; gate on the claimed item's worktree being clean, which the
    single-writer broker already knows). The summary must be a fixed structured schema with a
    token floor and **pinned constraints** (item 93), and the cheapest layer — per-entry masking
    via `ContextEdit` (item 92) — must run *before* summarization. Also: pi-durable places a
    conversation-owned summary through a **write submission**, so 28a must reconcile with the
    stale-submission/stranded logic (`reconcileStrandedSubmissions`, items 66/68) — a summary
    submission must not read as an in-flight task and suppress a wake. [internal check owed]
    **28a delivered by #873 (`cc19f5b`); 28b (fresh conversation) still open.**

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

30b. **Start a fresh conversation automatically when the cache is cold, or at a task boundary.**
    Raised by the operator. The idea: when a seat's thread will not be reused for the next
    task — or when the last request to it is older than the provider's prompt-cache TTL — its
    context is a cost with no cache benefit, so a fresh conversation (28b) is at least as
    cheap and usually cheaper than carrying it forward.
    *The premise, corrected with sources.* The common **default** cache TTL is **5–10 minutes**
    of inactivity, not one hour. Anthropic's default is 5 min (1 h is an optional tier, ~2×
    write cost); OpenAI is automatic ~5–10 min, hard-capped near 1 h; **DeepInfra — our
    provider — is explicitly 5 min or 1 h** (`cache_retention` / `prompt_cache_options`), and
    durig requests neither today (`docs/Prompt_Caching_Research.md`; item 33). So "1 hour" is
    the *maximum/optional* window, not the default, and the threshold must be
    **provider-aware**, keyed to the retention we actually request — otherwise the heuristic
    fires on the wrong clock (5 min vs 1 h is a 12× difference in idle tolerance).
    *The unanswerable part, named honestly.* We cannot know whether a context will be useful
    for the next task. Two observable proxies, in order of confidence:
    1. **Idle time** — the gap since the seat's last request, read from the queue's transition
       timestamps (`RigQueue`), so it is a read, not new instrumentation. Past the cache TTL
       the cache is cold, so the context's only remaining effect is a long prompt prefilled
       at full price; a fresh conversation then strictly dominates.
    2. **A task boundary** — the previous item is `done` and the next item addressed to the
       seat is a *different* task. `reset` (item 44) exists; this makes it automatic.
    *Configuration, defaulting to the most affordable option.* Because usefulness is
    unanswerable, this is a knob with an affordable default — fresh when idle exceeds the
    provider's **shorter** retention window (DeepInfra 5 min), and **never mid-item**: a
    `claimed` item must survive the transition or the seat loses the task (28b's carry-across
    rule; the F13 `#90` HELD-state work is what makes a held item distinguishable from a
    claimed one, so a held item may be dropped but a claimed one may not).
    *Naming the config (operator note): the two cache choices trade **response speed
    against token cost**, and the knob must be named for the outcome, not the mechanism.*
    A long retention (DeepInfra 1 h) keeps the prefix warm so the next request prefills
    cheaply *and fast* — **speed-optimized** — at a higher write premium (1.25×→2.0× input).
    A short window (5 min) or a fresh thread past the cold point is **cost-optimized** — no
    write premium and no carrying a cold context — at the cost of a full prefill (a slower
    first token) *if* the context is reused after all. So the setting should express the
    outcome (e.g. a policy of `latency | cost`, defaulting to `cost` = the affordable
    option) with the retention and idle-threshold derived from it, rather than exposing raw
    TTLs the user can mismatch. The default stays `cost`; `latency` is the deliberate
    override.
    *Ordering:* depends on 28b (the fresh-conversation verb) and 33 (the retention we pick —
    the threshold must match it). The advocate owns the practice (29); this item is the
    automatic trigger, and `designer` owns whether the default is legible to a user.
    *Acceptance:* a demo where a seat idle beyond the threshold takes a fresh conversation on
    its next item and still completes that item, and a seat idle under the threshold does
    not; the previous conversation is never deleted (28b).
    *Amendment (2026-10-17, follow-up research).* State the cache-cold/task-boundary trigger as
    the **default**, not an option: OpenAI documents that summarization/compaction "can change
    the prefix and reset cache reuse" (`advertised-elsewhere`), so compaction is a deliberate
    cache-invalidation event and belongs at boundaries.

92. **The masking layer already exists — expose per-entry tool-result and thinking-block
    clearing.** The follow-up research's cheapest-first ordering is `mask → summarise → fresh
    session`, and its first layer is **already in the platform**: an entry can carry
    `edits: [{ target, action: "omit" | "replace", messages? }]`
    (`pi-durable/dist/types.d.ts:262`), which overrides an earlier visible entry's contribution
    to the model context without touching the store. So this is exposure, not invention — a
    durig surface that omits completed tool-result entries (and, where the provider permits,
    replaces thinking blocks) before any summary runs.
    *Invariants (hard):* never omit a tool result whose call is still open — OpenAI's API
    requires every tool call to have a result; clear only completed pairs and never the most
    recent keep window; the store keeps the raw entry, so masking is a reversible view.
    *Domain caveat:* masking's advantage is strongest for verbose tool output; today's seats
    mostly exchange succinct queue traffic, so this matters most once file tools land (item 4) —
    but building it now makes the ordering available.
    *Owner:* impl. *Acceptance:* a demo proving an omitted tool-result entry is absent from the
    model context but present in `log`, and the open-call case is refused.

93. **Constraint pinning — keep the standing rules verbatim outside any summary.** The
    follow-up research's sharpest safety finding (Governance Decay) is that compaction's worst
    loss is *silent constraint loss*, not recall loss, and that re-injecting the standing policy
    verbatim restored compliance. durig already has a byte-stable per-seat prefix (persona +
    constitution); this item makes it **explicitly outside the compactable range** and
    re-asserted after every compaction and fresh session, then validates it with a
    constraint-survival probe. Pairs with item 27's measure and item 97's harness.
    *Owner:* impl (mechanism), qa (probe). *Acceptance:* a probe showing the constitution's
    `P1/P2/P3` rules survive a compaction and a fresh-session handoff.

94. **Cap compaction count per session, then force a fresh session.** Repeated compaction
    compounds error (the research's chain finding: constraint violation rising across rounds). A
    long-lived durig seat can compact many times in one session (the report plans for 10+ in
    four hours). Cap the count and, past the cap, prefer the fresh-session lever (28b) with a
    pointer-carrying handoff. *Owner:* impl; *depends on:* 27 (observability), 28b.
    *Acceptance:* a session that hits the cap takes a fresh conversation at the next item
    boundary and still completes the item.

95. **Compaction-Eviction hardening — the summarizer treats in-context content as untrusted.**
    The research's Eviction-Attack finding: in-context content (a tool result, a queue body) can
    steer the summarizer to delete a constraint. The summary path must never treat task/tool
    content as summarizer instructions, and secrets/PII must be scrubbed **at ingestion** (before
    an entry enters the store) so the summarizer never sees them — extending the no-secrets
    guard (#700). *Owner:* impl; *depends on:* 92/93. *Acceptance:* a demo where adversarial
    content in a tool result cannot alter the summary's structured sections or drop a pinned
    constraint.

96. **Verifier and retry context isolation (fork vs isolate).** Fresh context is a correctness
    property: the follow-up research confirms the deepagents rule — worker = fork, verifier =
    isolated, researcher = isolated — and that a verifier must not inherit the author's
    compaction summary, or the review is anchored. durig already runs `qa` as a separate
    conversation on a different model family (and has a `no-verifier-seat` check); this item
    extends `check` to assert the verifier is **not forked from / primed with the author's
    summary**, and defines the retry rule: a re-wake of a failed attempt **isolates with a
    structured failure handoff** (what was tried, why it failed, what is committed) rather than
    forking the failed reasoning. *Owner:* lead (rule), qa/advocate (practice), impl (check).
    *Acceptance:* a `check` rule that fails a verifier whose context descends from the author's
    summary, and a demo of an isolated retry.

97. **A compaction evaluation harness — probes + replay against the append-only store.** None
    of the above is provable without a measurement. The report's design: reconstruct the
    `ContextView` from the append-only store, swap in the compacted artifact, and fire
    recall/artifact/continuation/decision probes graded by the existing blind judge
    (`src/judge.mjs`), with artifact-tracking as the most sensitive metric. This is also how the
    per-model **effective window** (item 27) gets measured: probe at a few lengths against the
    live endpoint. *Owner:* qa (harness), impl (plumbing). *Acceptance:* the harness reports a
    compacted-vs-full delta on a real past item, and item 27 consumes its effective-window
    number instead of the advertised one.

**Sequencing (pm, 2026-10-17, on the operator's behalf):** these six are ORDERED, all behind the
operator priority train (#1066) — none ahead of #1040/#1036/#977/#1055/#975/#976/#964/#965/#966/#873.
1. **97** — qa — compaction evaluation harness (probes + replay) + per-model effective-window
   measurement. MEASURE-FIRST: the window measurement is a prerequisite for item 27 and #62/RANK 4
   (the configured `contextWindow` 1_048_576 inherits a ~1.03M threshold that never fires).
2. **92** — impl — expose masking via the existing `ContextEdit` (omit/replace); gates 28a's
   "masking before summarization".
3. **95** — impl — eviction hardening: untrusted in-context content + secret scrub at ingestion
   (extends #700).
4. **93** — impl — constraint pinning (constitution verbatim outside any summary + survival probe);
   depends on 92.
5. **94** — impl — compaction-count cap + forced fresh session past the cap.
6. **96** — impl — verifier/retry context isolation (fork vs isolate).
Queue items: #1087 (97), #1088 (92), #1089 (95), #1090 (93), #1091 (94), #1092 (96). D84's
unverified list stays OPEN.

## Deadlock and liveness prevention (raised 2026-10-12)

**What we observed.** Live selfdev runs deadlocked in ways the design did not stop:
`#37→#44→#45→#49→#50` — a seat deferred a shape question it could resolve, and the
ruling circle took many turns; `#55`/`#79`/`#100` sat `deferred` indefinitely with no
deadline; and the `run` driver **exited/died while `claimed` and `deferred` work
existed**, so the stall was invisible until a human looked. None of these was a seat
failing its policy — the **substrate** did not notice or act, which is the class
durig's own attention channel already detects but nothing consumes.

**What the research says (this is D23's list, not a new one).** D23 reviewed
`docs/Patterns_and_Pitfalls_of_LLM_Agents.md` and the two load-bearing citations,
**MAST (arXiv 2503.13657)** and **Anthropic's "Patterns and problems in emerging
multiagent systems"**: the convergent remedies (durable single-writer store,
orchestrator-worker, explicit edges, audit trail) are already durig's foundation, and
what is missing is **protocol** — *verification with evidence, termination/attempt
semantics, and a deferral verb*. Our deadlocks landed exactly on the named categories:
**FC1 termination** (a park with no deadline), **FC2 inter-agent misalignment** (a
clarification loop), and **observability without an actor** (attention fired; nothing
acted).

**Prevention, in priority order** (each is a discrete item; none is started by this
paragraph):

- **P1 — Termination semantics for a defer (item 6).** Every `defer_work` carries a
  **deadline** and an escalation target; a park past its deadline is surfaced *to an
  actor*, not merely noticed. This is the single biggest cause and the research named
  it first.
- **P2 — Make deferring exceptional and reasoned.** A defer needs a stated reason, and
  "I could decide this myself" is not one (mirrors the ratcheting tier, 30b/`#60`).
- **P3 — A narrow supervisor that acts (item 42).** Consume the notices durig already
  derives (`deferred_awaiting_answer`, `idle_with_queued_work`, `admitted_not_started`,
  `stalled-after-claim`) and re-wake, escalate, or reassign — push, not a new polling
  tool. This is the first piece to build, and it is what converts observability into
  liveness.
- **P4 — Deadlock detection.** A wait-for graph over `deferred-to` edges, so A→B→A is
  caught. Nothing detects a cycle today.
- **P5 — Driver liveness.** The `run` driver must refuse to exit while non-terminal
  `claimed`/`deferred` work exists (distinguish *quiescent* from *stalled*), and a
  driver that has died must be noticed; both bit us this cycle.

- **P6 — Model the protocol in Quint (candidate, not started).** The queue item
  lifecycle (`queued`/`claimed`/`deferred`/`done`/HELD) crossed with the
  generation lease/genlock and the wake/admission sub-states
  (`admitted`/`placed`/in-flight/`settled`) is a concurrent state machine, and the
  failures we keep finding empirically are liveness/safety violations of it: an
  item `admitted_not_started`, a `generation_stale` slot, a claimed item never
  re-woken. Quint (a TLA+ successor: executable specs, a simulator, a model
  checker, and model-based tests) is built for exactly that class — its production
  use-cases are consensus/BFT protocols, DB transactions and access control. A spec
  of the **protocol core** would let us model-check "no non-terminal item is ever
  permanently unwoken" instead of discovering it live. **Not a substitute** for the
  data-layer work: the `pi.live` missing-base corruption (DOGFOOD F14) is a
  data-modelling bug, not a protocol one, and a protocol model would not catch it.

**Evidence class:** P1–P3 are `advertised-elsewhere` (D23's citations); P4–P6 are
`observed` (this cycle's runs). Managed by the advocate's rule (D36).

## New-session onboarding for seats (raised 2026-10-12)

**What raised it.** A delegate of the operator — an agent external to the team, not a seat — sat in
the operator's chair for the first time and burned ~20 discovery calls before it could name the
next item. Its post-mortem, and a second agent's read of it against the wider literature, are
`docs/Agent_Onboarding_Research.md`. The finding turns inward: a durig **seat** that begins a new
session (created at `up`, resumed by 37(b), reset by 44, or moved to a fresh conversation by 28b)
has no deterministic way to learn what it was doing, what the team is doing now, or what "done"
meant. Every mechanism we have moves *state* across a boundary — 28b re-surfaces a claimed item,
44 writes a reset boundary, 35 injects skills — but none **orients** the session that wakes on the
other side, so a fresh conversation starts amnesiac and re-derives.

**The pattern the research converged on.** The agent is amnesiac; the filesystem is not. The
recurring answer is an always-on entry context, a clock-in/clock-out ritual, a bounded handoff
artifact, and the done-condition written down before work starts — over a plain filesystem, not a
memory engine, because durig is already SQLite + files and the gap is a read/index layer over what
we have. The delegate half of this is `docs/SELFDEV.md` + `docs/NEXT.md`; the items below are the
seat half.

O1. **A seat boot contract: the clock-in routine, stated once and run on every new session.**
    A created, resumed, or reset conversation must orient before it acts: read its claimed item(s)
    and the rig handoff (O2), then state a short plan naming the item and the oracle. Today the
    state is carried (13, 28b, 44) but the orientation is not — F13's "idle with claimed work" is
    exactly what an unoriented session looks like.
    *Mechanism:* a shared primer section contributed by 35's loader, plus a first-turn contract on
    a created/resumed/reset conversation. No new tool, and no polling (item 4 keeps polling out).
    *Acceptance:* a demo where a freshly created seat is handed a claimed item and its first turn
    names the item and the oracle with no human prompt, and a control where a seat with no claimed
    work does not invent one.

O2. **A rig handoff the seats are *pushed* at, never poll.** The roadmap↔queue priority split is the
    same root cause the delegate hit: `ROADMAP.md` says "ordered by operator value" while the live
    next step sits inside a queue subject. A seat needs the pointer on the push channel — the primer
    at boot and an attention notice at runtime (D28 / P3) — because item 4 forbids a polling tool.
    *Evidence:* the delegate post-mortem; P3's "observability without an actor"; item 4.
    *Mechanism:* a bounded, committed handoff (the delegate's `NEXT.md`, or a per-rig equivalent)
    named in the primer, plus an attention notice when it disagrees with the queue.
    *Acceptance:* a demo where a new seat's primer names the current priority and its source file,
    and the notice fires when the file and the queue disagree.

O3. **Intake writes the done-condition, and the session that resumes re-reads it.** A priority that
    is not a done-condition drifts; the research's highest-leverage move for a long run is explicit,
    testable completion criteria in an external file, so the agent cannot quietly redefine *done*
    mid-run. The selfdev items already carry acceptance — the shape exists, it is just not a rule.
    *Mechanism:* a `check` rule that a routed item carries a testable done-condition, and
    `complete_work` requiring the completion to name the acceptance it met.
    *Acceptance:* a demo where an item with no done-condition is flagged, and a completion naming an
    unmet criterion is refused.

O4. **A seat's root and oracle are derived from configuration, never hand-copied into the persona.**
    `rig.selfdev.json` inlines the same operating paragraph in all nine seats because "durig has no
    skill loader yet" (35). Changing the oracle or the root is a nine-place edit and a drift is
    invisible — the exact class 34 warns about for host paths.
    *Mechanism:* 35's loader supplies the operating section from one source; a `check` rule fires
    when a persona hardcodes a host path or an oracle that belongs in configuration.
    *Acceptance:* a demo where one rig change updates every seat's boot text, and the check rule
    fires on an inlined host path.

**Evidence class:** O1–O4 are `advertised-elsewhere` (the research doc's citations) for the pattern
and `observed` for the delegate miss and F13. Managed by the advocate's rule (D36).

## Agent ownership and accountability (from the research review, 2026-10-16)

Source: `docs/reviews/Agent_Ownership_Review.md` (partial — its governance and coordination-cost
passes are unfinished). Its verdict: do **not** adopt RACI/DACI/RAPID/MOCHA; keep the existing
artifact-keyed ownership and make it **machine-checked**; keep the surface-decision field; and make
verification **re-execute evidence** rather than accept a claim. Registered here, **not scheduled**;
`pm` sequences them.

45. **Record the "no RACI" decision, so it is not re-litigated.** The research found full RACI
    redundant against the existing role table + docs-ownership norm + capability matrix + the queue's
    single claimer, and its single-accountable-per-task assumption contradicts durig's artifact-keyed
    accountability. RACI's real gap is *decision authority*, which DACI/RAPID address and the queue
    already supplies.
    *Owner:* `advocate` (decision record) · *Output:* a `docs/DECISIONS.md` entry with the why.
    *Acceptance:* the entry names the alternatives rejected and the evidence class.

46. **Make artifact ownership checkable — a `check` rule, not a prose grid (DELIVERED `ed2b5dc`).** The load-bearing
    finding: a decision-rights row not enforced by `check` (or the queue) is prose and goes stale. Add
    a `check` rule that every artifact class in the docs-ownership norm maps to a live owning seat,
    and (D62) every capability has a FEATURES row.
    *Owner:* `impl` (author) · *Consulted:* `advocate`, `devtools` · *Where:* `src/checkup.mjs`.
    *Acceptance:* failing-first demo — a rig naming a non-existent owner seat fails `check`; the
    current rig passes.

47. **Surface decision (in flight).** A capability states CLI/TUI/both — the research confirms this is
    the one genuinely missing decision class. Routed 2026-10-16 to `advocate` (`WORKFLOWS.md` W4) and
    `scribe` (`FEATURES.md` `Surface` column).

48. **Verification must re-execute evidence, not accept a claim.** The strongest evidence-backed
    finding: reviewer/peer agents measurably agree (sycophancy/conformity — measured wrong-peer
    adoption ~29.7%, disagreement collapse), so a verifier that only reads the author's summary is the
    collapse setup. This strengthens item 4 (real seat tools + verification evidence) and W2's
    evidence protocol.
    *Owner:* `impl` (author) · *Consulted:* `qa`/`auditor` · *Evidence:* `Agent_Ownership_Review.md` §2.4.
    *Acceptance:* a verifier item fails when it only acks a claim and passes when it re-runs the artifact.
    **Evidence surface delivered by #715 (`50240f9`); re-execute enforcement still open (#851).**

49. **Finish the research's unfinished passes.** The review explicitly did not verify the governance
    pass (NIST AI RMF, ISO/IEC 42001, EU AI Act Art. 14, multi-agent "accountability gap") or the
    coordination-cost/scaling numbers; social-loafing and handoff-routing under explicit accountability
    remain open.
    *Owner:* operator's research agent · *Output:* the remaining sections of
    `docs/reviews/Agent_Ownership_Review.md`, same source labels.

50. **Ownership questions the review could not settle (record, decide later).** (a) verification when
    the verifier shares the author's *evidence*-level blind spot, not just the model; (b) who owns a
    decision when the queue and the docs disagree (the rule is "trust the queue", but no owner is
    named); (c) at 20–50 seats the bottleneck is the single-writer store, not the ownership matrix;
    (d) the highest-harm un-named failure is a confident wrong verification propagating as trusted
    `done` state, poisoning the durable record.
    *Owner:* `lead` (scope ruling) · *Trigger:* before the next ownership change.
## pi-durable alignment: what to adopt, keep, and replace (research landed 2026-10-16)

Source: `docs/reviews/pi-durable-alignment.md` — the completed gap analysis (framework pinned at
`earendil-works/pi@4954d760` / `pi-durable` 1.3.0; durig read from `main` on 2026-10-16). The stable,
maintainer- and upstream-facing summary is `docs/PI-DURABLE-INTEGRATION.md`. One-line
verdict: durig reimplements **client state delivery** (the TUI poller) and **busy-conversation input**
(await-and-hold), and correctly keeps the rest. Registered here, **not scheduled**; `pm` sequences them.
**Read the review's §9 first** — it states its bounds (some files and the blog were not read; durig is
not pinned).

51. **DONE — Research: is durig using pi-durable as intended?** Report:
    `docs/reviews/pi-durable-alignment.md` (gap table, decision table, failure catalogue, borrow/avoid,
    and an explicit "could not verify" list). Items 52–58 are its output.

52. **Attach the TUI as a state-backed client (was: Level 2).** **Adopt, gated by 55.** Replace the
    700 ms storage poll with a subscription behind the existing `readapi` seam — an **in-process**
    `viewState().subscribe()` first (no socket, no new trust boundary), with `watchEvents()` (remote,
    snapshot + deltas, late-join) only after 55. Keep the poller as the documented fallback (D11's
    evidence is not erased). Evidence: `21-late-join.ts`, spec `viewState`/`watch`; review §2, §8.
    *Owner:* `lead` (D11 ruling) → `impl` · *Acceptance:* a late-join test — attach mid-run, the
    snapshot shows the running tool's partial, later deltas arrive, and no partial becomes an entry (D40).

53. **Adopt the reviewer-as-a-conversation pattern (config-only).** `28-reviewer.ts`: a verifier
    conversation with its own (different) model, `tools:[read]`, its own checkout, and an `onYield`
    review loop. Evidence: review §1 row 8, §8; pairs with the sycophancy finding
    (`docs/reviews/Agent_Ownership_Review.md` §2.4).
    *Owner:* `impl` · *Consulted:* `qa`/`auditor` · *Acceptance:* a demo verifier that cannot edit and
    loops on findings, driven by the harness — not by the queue re-waking.

54. **Wake-and-return in `drivePass` (replace the in-tick await) (DELIVERED `58cbac2`).** **The review's rank-1 change
    (highest value, lowest cost).** Stop awaiting the runs a pass woke inside the tick; let the commit
    subscription drive the next pass; keep the **one** global `waitForIdle` on loop exit (F11). This is
    what parked the loop ~15 minutes behind a degenerate `qa` run and held a spooled intent. Evidence:
    review §1 row 2b, §5 F1/F2; `docs/BROKER-ARCHITECTURE.md`.
    *Owner:* delegate/`impl` (broker process) · *Acceptance:* failing-first — with a slow seat running,
    a spooled intent is delivered and another seat re-woken without waiting for the slow run; no wake is
    lost (the "dirty, not lost" invariant).

55. **A `security.sec` position BEFORE any attach socket.** **The review's #1 overlooked harm.** D45
    committed that adding a socket requires a security position *before code*; a remote TUI client is
    that socket. The in-process subscriber in 52 needs none; the remote path in 52 does.
    *Owner:* security position (`advocate`/`lead` with the operator) · *Trigger:* before remote attach.
    *Acceptance:* a written position naming the boundary, the auth/trust model, and the fallback if the
    broker dies.

56. **`whenBusy:"steer"` for operator text, and the spool's post-attach role.** **Adopt + decide.** A
    drained intent should submit with `whenBusy:"steer"` so it joins a busy run instead of queueing
    behind it; keep the spool as the **out-of-process** substrate (no broker ⇒ no owner ⇒ no harness).
    The review flags two unasked things: what the spool is *for* after attach, and that the operator's
    text then has two records (`pi.inbox` and durig's queue) — a divergence risk. Evidence: review
    §2.5, §7.5–7.6.
    *Owner:* `impl` + `lead` · *Acceptance:* an operator message reaches a busy seat within the run; a
    decision entry records the spool's remaining job.

57. **Per-conversation agent for seat config.** **Adopt.** Write model/thinking/extensions/tools/`cwd`
    on the conversation (it survives restart) and keep only role/goal/capabilities in durig's `Seats`
    doc. Evidence: `28-reviewer.ts`, spec; review §1 row 4, §5 F7.
    *Owner:* `impl` · *Acceptance:* reopen a store and assert the agent config survives; org metadata
    stays in `Seats`.

58. **Investigate: task checkpoints + the reset/degeneration guard.** The harness has task
    `phases`/checkpoints/`abort`/recovery (`running`→`pending`) and compaction policy; durig has a reset
    guard, `stop` files, and a broker audit log. Map durig's guard cases onto the harness primitives
    **before** writing code. Evidence: review §1 rows 8–9, §4 rank 6.
    *Owner:* `lead` + `impl` · *Acceptance:* a written mapping; prototype one custom task and measure
    the `migrate` maintenance tax.

**Kept — do not replace (recorded so it is not re-litigated):** durig's `RigQueue` (a shared,
cross-conversation work log with `from`/`to`, a status machine, provenance and an audit trail — the
harness `pi.inbox` is per-conversation ordered input, a different object); **org edges / capability
gates** (the spec says ownership is not access control); **`genlock` / `DURIG_MAX_CONCURRENT_SEATS`** (a
cost/provider bound; the harness imposes none); the **per-item worktree lifecycle** (adopt the harness
`cwd` *mechanism*, keep durig's create/remove policy); and the **operator surface, `cli.mjs` JSON
contract, docs gates and rig files** (no harness equivalent).

## Zero trust to zero agent — narrow seat permissions (research requested 2026-10-16)

**The question.** durig grants a seat its reach with coarse, role-level capabilities and
restrictive-by-default `edges`; a seat's tool surface and filesystem `cwd` are broader than any
single work item needs. Research how teams assign **narrow, per-seat / per-item least privilege**
to LLM agent members — a "zero trust to zero agent" posture — and which of those mechanisms durig
should adopt, keep, or reject. The operator's framing: today's permissions are assigned to the
*member*; the research asks how to narrow them toward the *task*.

60. **Research: narrow per-seat / per-item least-privilege permissions (owner: operator's research agent).**
    **What to investigate.** (a) Agent permission models — object-capability / capability-based
    security, RBAC/ABAC for agents, per-conversation tool scoping (the harness already sets
    `tools:[read]` on a reviewer conversation, item 53, and writes agent config per conversation,
    item 57), filesystem sandboxing and `cwd` confinement, and network-egress control. (b) "Zero
    trust between agents": authenticated per-agent identity, no implicit trust from co-residency or
    role, and the failure modes trust-by-topology creates. (c) The harm class — prompt injection →
    tool abuse, and delegation broadening a grant — as described in the practitioner literature.
    (d) The cost side: how narrow grants multiply configuration/maintenance, and where durig's
    artifact-keyed ownership (`docs/reviews/Agent_Ownership_Review.md`) already supplies the
    accountability half.
    **durig baseline the review must measure against.** restrictive-by-default org `edges` (`check`
    reports `unreachable-seat`); the capability matrix; per-seat `cwd` (dogfood F12) and the per-item
    worktree lifecycle (D49); the seat-tool allowlist (`docs/SEAT-TOOLS.md`); and `security.sec`
    positions gating new execution surfaces (D24/D27, item 55). The gap: none of these is a **narrow
    per-item grant** — reach is set per seat, not per work item, and there is no deny-by-default
    tool/network boundary for a single claim.
    *Owner:* operator's research agent · *Consulted:* `lead`, `advocate`, `qa`.
    *Output:* `docs/reviews/zero-trust-zero-agent.md` in the shape of the existing research reviews —
    a gap table (mechanism → what durig has → what is missing → adopt/keep/reject), a decision table
    with the why, a failure catalogue, and an explicit "could not verify" list — plus proposed
    backlog items, **registered not scheduled**.
    *Depends:* item 55 (the `security.sec` position) before anything that opens a new trust boundary
    or execution surface.
    *Acceptance:* the report cites each external claim with a URL (the web-research rule), maps every
    finding to a concrete durig mechanism or names the one it could not verify, and states its
    evidence class.
    **Evidence class:** externally-cited (`advertised-elsewhere`) for the permission models;
    `observed` for the durig baseline.

## Broker supervision and a service host (design recorded 2026-10-16)

Source: **`docs/BROKER-SUPERVISION.md`** (design of record), itself grounded in
`docs/reviews/building-agent-systems-on-pi-research.md` and re-verified against the code. The observed
failure: a broker `START` with no matching `EXIT` (`src/broker.mjs` lifecycle audit) left the queue and
three spooled operator intents idle indefinitely, because nothing supervises the broker process.
Registered here, **not scheduled**; `pm` sequences them. **Sequencing: after item 54** (a heartbeat can
only be trusted once the pass loop no longer parks on the slowest run). Item **65 is independent** and
should not wait. **Correction (delegate, round 3):** the research agent read the scoped settle-wait in
`drivePass` (D65) and concluded item 54 was implemented; it is **not** — `drivePass` still
`await`s the runs it woke (`await settleSignal.race(wokenIdle)`), so wake-and-return is still pending.
**Resolved (impl, #890):** that correction is now STALE. Item 54 LANDED as `58cbac2`
("wake-and-return in the resident pass; drain once on loop exit"). `drivePass` carries a `waitForWakes`
boundary (default true for the one-shot `run`); the resident broker passes `false`, returns without
awaiting the runs it woke, and drains the ordinary scope ONCE on loop exit (F11) — the
`settleSignal.race(wokenIdle)` await no longer exists in `src/broker.mjs`. Failing-first proof:
`demo/broker-wake-return.test.mjs` (exit 0 — `drivePass` returns while a 4s run is in flight, and a
spooled intent is delivered ~200ms in while it generates). The item-54 gate for 61–63 is satisfied.

61. **Exit-code taxonomy + a durable operator down marker.** Give `serve` distinct exit codes
    (0 intended stop / 1 crash / 2 wedge / 0 give-up) via `process.exitCode` (never `process.exit()` —
    it truncates the piped JSON payload, the rule `check` already follows), and add `<db>.broker.down`
    as a **durable** down marker that survives a reboot. This is distinct from the existing ephemeral
    `<db>.broker.stop` request file (F35), which the broker clears on exit; do not give two files the
    same semantics. Add the two-phase stop: `serve --stop` writes both files, the broker drains and
    exits 0, the host sees `.down` and stays down; only the host force-kills after the drain window.
    *Owner:* `impl` · *Where:* `cli.mjs` `cmdServe`/`cmdStop`/`cmdUp`, `src/broker.mjs`.
    *Acceptance:* a demo asserting each stop cause yields its code and marker; `serve --stop` is not
    restarted; `up`/`serve --start` clears the durable marker.

62. **Liveness + progress heartbeats.** Write a heartbeat file the host can read without opening the
    store: a liveness tick (~20 s / 60 s timeout) proving the event loop turns, and the existing
    `PASS <n>` as progress with the threshold from the provider stream timeout (`DURIG_STREAM_TIMEOUT_MS`;
    600000 ms for the openai provider when unset). Carry `version` + upstream pin so `status` can refuse
    to claim health when the running version differs from disk. **`performance.now()` counts sleep on
    Windows** (QPC includes standby; Node exposes no suspend-excluding clock), so a monotonic clock does
    not exclude sleep — detect resume as a large gap event (do not kill, do not steal), and use
    `os.uptime()`/wall time for cross-process ages.
    *Owner:* `impl` · *Where:* `src/broker.mjs` `runWakeLoop`.
    *Acceptance:* a demo that blocks the loop and shows the liveness file going stale while `PASS`
    stalls; a fake-clock test showing a resume gap does not trigger a kill.

63. **Thin host supervisor (`src/host.mjs`).** A host process that owns single-instance, backoff,
    give-up, reading the heartbeat, killing a wedged broker, and honoring the durable down marker. It
    **never opens the store** (pid + heartbeat + lease files only), so it cannot break single-writer.
    Named `src/host.mjs` (not `brokerd`), distinct from `src/supervisor.mjs`, the escalation pass
    (ROADMAP 42/P3). It places the broker in the existing `KILL_ON_JOB_CLOSE` Job Object so a kill reaps
    the tree.
    *Owner:* `impl` · *Consulted:* `lead`.
    *Acceptance:* chaos demo — crash, hang, and stop-request each produce the right host action; the host
    never opens the store.

64. **OS trigger adapters (portable host, per-platform install).** Keep `src/host.mjs` pure Node and
    generate the boot/login trigger per platform: a **per-user agent by default** (Windows Task, macOS
    LaunchAgent, `systemd --user`), a **system daemon opt-in** for an always-on host (Windows Service,
    LaunchDaemon, systemd system unit). The end-user surface is `durig daemon install [--user|--system]`
    (with `--print`), `durig daemon switch --user|--system` for a clean migration, and `durig daemon status`
    — see the CLI table in `docs/BROKER-SUPERVISION.md` §11. `install` emits the unit/plist/service config
    and the per-platform kill-tree primitive (Windows Job Object vs POSIX process group). Either way:
    delayed auto-start, log rotation, a stop/drain window **≥ 900 s** (> the 600 s stream timeout +
    margin), restart-on-nonzero with backoff, and a store path parameter (`selfdev.sqlite`) that refuses a network/synced filesystem on every OS. System-daemon mode removes
    the console, so the TUI must be a remote client (item 52's `watchEvents()` path, gated on item 55);
    the per-user agent keeps it in-process. The account/identity recipe is in `docs/BROKER-SUPERVISION.md`
    §10.
    *Owner:* `devtools` · *Consulted:* `operator`, `impl`.
    *Acceptance:* install/uninstall on Windows **and** macOS **and** a Linux distro; survives login (and
    boot in daemon mode); a documented way back to an interactive `cli.mjs serve` with the host not
    fighting it.

65. **Correctness hardening: the genlock lease and broker identity (DELIVERED `6fae68d`, `559f967`).**
    (a) A held lease renews its `since` every 20 s (atomic temp+rename), and `STALE_MS` is raised to
    660 s — longer than the 600 s provider stream timeout — so a legitimate long generation is not
    age-stolen; `slotIsStale` is the one predicate both the acquire path and the operator view use.
    (b) `holderAlive` treats every error except ESRCH as alive, so an EPERM (live, unsignalable) holder
    is not stolen. (c) `.broker.json` carries a `runToken` and a `heartbeatAt` the broker refreshes
    every 20 s; `brokerAlive` rejects a state whose heartbeat is older than 60 s, so a reused Windows
    pid is not read as the broker. *Owner:* delegate · *Where:* `src/genlock.mjs`, `src/broker.mjs`.
    *Proof:* `demo/genlock-hardening.test.mjs` (RED before the fix).

66. **Idempotent intent drain + stale-lease reconciliation (DELIVERED `47507f1`).** Every inbox intent
    now carries a `requestId` (`writeIntent` mints one), so re-draining the spool after a crash between
    submit and unlink is a no-op submission — the harness dedupes a submission by (conversation,
    requestId). At broker start the broker reconciles dead `genlock.*` leases once, removing only a pid
    the OS reports as non-existent (ESRCH) and keeping an EPERM holder, and logs `RECONCILE leases=N`.
    *Owner:* delegate · *Where:* `src/broker.mjs`, `src/genlock.mjs` · *Proof:*
    `demo/broker-reconcile.test.mjs` (RED before the fix).
    The orphaned-worktree sweep is split to item **73** — `removeClaimedWorktree` force-removes a dirty
    worktree, so it is unsafe to automate before that is fixed.

67. **Host chaos suite.** Crash injection (`taskkill /F`), hang injection (`DURIG_FAULT=wedge`),
    restart-storm injection, a single-instance race, and resume-after-crash — all offline against the
    faux provider — plus a property asserting the `START`/`EXIT` invariant after every test.
    *Owner:* `qa` (author) with `impl` · *Where:* `demo/`.
    *Acceptance:* the suite fails against today's unsupervised broker and passes against the design.

**Cross-links:** item **55** still gates any control socket (Option B / item **52**); item **52** gains a
note that an attached client is a *client* of the host, never a second writer — and that **system-daemon
mode (no console) forces the remote gated path** while the **per-user agent** keeps the in-process
subscriber. **Portability is a first-class requirement** (Windows, macOS, Linux distros): only the
trigger file, the kill-tree primitive, and the stop signal are OS-specific; `src/host.mjs` is identical
everywhere (`docs/BROKER-SUPERVISION.md` §2 portability boundary).

91. **Multiple durig instances on one machine (operator request, 2026-10-16).** Support more than one
    durig installation / rig on a single computer, and make the OS-level host/daemon namespace-safe
    across them. Today the supervision design assumes "one host per store" (§8) and `durig daemon ...
    [--db <path>]`, but nothing defines an **instance identity** for the OS artifacts: two instances
    would collide on the trigger name (Windows Task, launchd label, systemd unit), the Job
    Object / process-group name, the log path, and the future control socket/pipe — and the host's
    "single-instance" lock must be **per instance**, not global. Consequences to pin down: (a) the
    instance key (resolve the store to an absolute path; a slug/hash of it, or an explicit
    `--instance <name>`); (b) keep every marker store-scoped (already true: `<db>.broker.json` /
    `.down` / `.stop` / `.inbox`) and key the host's single-instance lock and OS trigger the same way;
    (c) the wrong-rig trap — a bare `durig` must not discover the wrong instance's
    `durig.config.json`/store (#491, D18); (d) version coexistence — two installations on different
    pinned pi/versions must not fight over one trigger; (e) two instances must never drive one store
    (single-writer already forbids it — the second is *refused*, not silently second-written).
    **Sequence** with the daemon items 61–64 (this parameterizes them); socket naming waits on item 55.
    **Doc:** grow `docs/BROKER-SUPERVISION.md` §8 ("Multiple stores") into an instance-identity section.
    *Owner:* devtools (OS trigger/namespace) + impl (markers/lock); consulted lead. *Acceptance:* a
    design naming the instance key and every OS artifact it scopes; two instances install and run side
    by side on one host without colliding (proved with `--print` on the generated trigger plus a
    hermetic test for the per-instance lock and marker scoping).

## Safe writes while the broker owns the store (raised 2026-10-16, after the crash)

Source: the 2026-10-16 incident — a concurrent `resume` against the live broker crashed it and corrupted
two `pi.live` run-control documents, and the F12 guard's single-session read then wedged **every**
write verb. Analysis and the command-path map: `docs/COMMANDS-AND-THE-BROKER.md`.
**Why this precedes items 61–64:** the host daemon makes the broker *always* on, which multiplies the
exposure of every second-owner write; safe writes are a precondition for a trustworthy always-on broker.
Sequence **68 → 69 → 70 → 71**, then the daemon **61–64** (item **72** rides the daemon).
**Item 68 is the live blocker** — qa and lead are stalled today.

68. **Settle stranded submissions (liveness).** A finished run can leave its submission `placed` while
    its task is already `terminal`; `resume` reports `run-cancelled` but does not settle it, and
    `selectWakes` then skips the conversation forever (`admitted_not_started`). On broker start and in
    `resume`, settle any `queued`/`placed` submission whose run task is terminal.
    *Owner:* delegate (fixes the driver — same rationale as item 54/D65) · *Where:* `src/broker.mjs`,
    `cli.mjs` `cmdResume`. *Acceptance:* a demo that forces terminal-task + placed-submission and shows
    the seat is re-woken after start/`resume`.

69. **Refuse or route writes while the broker drives (DELIVERED `c2fa6ee`).** `resume`/`doctor`, `reset`, `send`, and
    `ps`/`queue` (which open a full harness just to read) must not become a second owner while a broker
    is alive: refuse with a clear message naming the spool, or route through it; `ps`/`queue` read via
    `openStore` like `status`. *Owner:* impl · *Where:* `cli.mjs`.
    *Acceptance:* a demo asserting each verb with a live broker; no second-owner write path remains.
    *Cross-refs (lead #807; = item 83 in the runbook set):* the single-writer precondition is enforced in
    CODE, not a runbook sentence — PROSE is what failed twice on 2026-10-16. Cites lead's **#716 Q2**
    (verified artifact / code wins over prose when docs and code disagree) and **#397 Q4** (`done` /
    enforcement must be VERIFIED, not asserted — carry the check run + exit code, re-openable).

70. **Read-boundary hardening (DELIVERED `07ae6a6`).** One unreadable `pi.live` must not kill a command's whole pi-durable
    session: the F12 guard and the broker open path tolerate an unreadable document (skip + report, as
    `src/readapi.mjs` does), and startup reconciles the spool/leases/worktrees (folds item 66).
    *Owner:* impl · *Where:* `cli.mjs` `openHarness`, `src/broker.mjs`.
    *Acceptance:* a demo with a corrupt `pi.live` where `serve`/`run`/`send` still start and report it.
    **Resolved (impl, #911):** item 70 is DELIVERED as `07ae6a6`. Most of the behaviour pre-dates the
    item, and this register must not read as if #911 built all of it. Pre-existing (cited): `run`/`serve`
    start and report the corrupt seat (`driver:"wake-failed"` + the unresolvable path, `failedSeats:["bad"]`)
    and exit 0 (`driveOnce` P5/#110); `ps`/`queue`/`status` read through (`openStore`, D44); the F12
    guard is not tripped by a `pi.live` corruption (`conv.agent()` reads the separate `pi.agent` doc);
    and startup reconciles leases + orphaned worktrees (`reconcileBrokerStartup`) and drains the spool
    per pass. THE GAP #911 actually closed: `send <bad>` exited 1 with a bare `unresolvable path`,
    naming neither the seat nor the repair — `cmdSend` now catches `unresolvable path` on the
    submit/wait path and fails legibly, naming the SEAT, the unreadable `pi.live`, and the repair
    (D44 retire / `scripts/repair-pi-live.mjs`); other errors rethrow. Acceptance demo:
    `demo/readboundary-corrupt-live.test.mjs`.

71. **Command spool — writes as requests the broker applies (the mailbox).** Generalise the intent
    inbox from "deliver a message" to "apply an operation": `send`, `reset`, `stop`, and queue edits
    become request files with a `requestId` (idempotent re-drain) and a result channel, so the CLI/TUI/
    daemon stay *clients* of the owner (pi-durable's multiplayer model) instead of opening a second
    harness. *Owner:* devtools, delegate consulting · *Where:* `src/broker.mjs` + producers.
    *Acceptance:* a demo running a mutating request end-to-end while the broker drives; a duplicate
    `requestId` applies once.

72. **Broker start provenance + lifecycle observability.** `START pid=<n> source=up|serve|daemon` (plus
    version/pin), so a reader can tell how the broker was launched; folds into items 61–62.
    *Owner:* impl · *Where:* `src/broker.mjs`, `cli.mjs` `cmdServe`/`cmdUp`.
    *Acceptance:* the log names the origin for `up`-started and `serve`-started brokers.

131. **`pause` / `unpause` — drain to quiescence before a broker upgrade.** Registered 2026-10-17
    (operator intent; **pm assigned 130, but 130 is TAKEN** by the "longer plans hurt accuracy" relabel,
    so this registers as **131**). Today the only ways to get a quiet rig are `serve --stop`, which
    INTERRUPTS in-flight runs and whose `stopped:true` is not proof the process exited (the F11 drain can
    hang; `docs/runbooks/broker-safe-change.md`), and the operator-declared "exclusive window"
    (`docs/runbooks/merge.md`), a PROSE state enforced only by convention — the reason ROADMAP 69 and
    `docs/COMMANDS-AND-THE-BROKER.md` exist is that prose enforcement failed twice on 2026-10-16. A
    first-class `pause` is the missing drain-to-quiescence primitive: refuse NEW claims/wakes, let
    claimed items FINISH, and the store is then quiescent so a broker upgrade (`up --refresh`, restart,
    `serve --stop`) proceeds without stranding a run. `unpause` clears it.
    *Acceptance:*
    1. a persisted, broker-visible RIG-LEVEL `paused` state that `selectWakes` / `claim_work` honour —
       while paused a seat is NOT woken to claim a NEW item (a per-seat override is OUT OF SCOPE, its own
       item if the team later decides it needs one);
    2. in-flight work SETTLES: a run already generating, or an item already `claimed`, COMPLETES — pause
       gates TAKING new work, never FINISHING current work, and must not kill a run;
    3. legible + reversible: a `pause` verb and an `unpause` verb, `status` reports the paused state, and
       a wake refused during pause is LEGIBLE, never silent;
    4. not a second store writer: the pause/unpause producer follows the mailbox / command-spool
       discipline (ROADMAP 71, `intent.mjs` style) or it is just another `serve --stop`;
    5. verifiable quiescence: `pause --wait` returns only once EVERY seat has settled, and `status`
       reports the paused state — the point is to KNOW it is safe to upgrade before touching the broker.
    *Owner:* impl · *Where:* `src/broker.mjs` (`selectWakes`), `cli.mjs` (`pause`/`unpause`), the store (one
    persisted flag). *Sequencing:* with **68 → 69 → 70 → 71**, then the daemon **61–64** — pause needs 71's
    producer discipline (AC4) before it is more than a kill.
    *Relationship (do not duplicate):* distinct from `serve --stop` (kills) and from the exclusive window
    (prose only); adjacent to **69** (refuse/route writes while the broker drives), **71** (command
    spool — the producer side this needs), **74** (hot-reload, which could remove the stop entirely), the
    daemon **61–64**, and **91** (multi-instance / instance identity, for a per-instance pause).
    *Constraints:* no new store/schema beyond what a persisted paused flag requires.

**Cross-links:** items **54** (wake-and-return), **65** (genlock), **66** (idempotent drain + leases),
and **73** (worktree sweep) are delivered; items **55** (a security position before a socket) and
**69–71** (broker-safe writes) remain open.

## Pitfalls from the broker hardening (raised 2026-10-16)

Source: the 2026-10-16 hardening session — five clean-path items landed (54, 65, 66, 68, 73) and **two
separate incidents were caused by a second writer running while a broker was alive** (a stray `resume`,
then an `up --refresh` after `serve --stop` returned `stopped:false`). These items close the
recurrences; `pm` sequences them against 61–71.

74. **Constitution/spec reconciliation without a stop (hot-reload).** The broker reads the rig spec and
    `constitution.txt` and applies a changed model/prompt/constitution on its next pass (or on an mtime
    change), so a doc or model edit no longer needs stop + `up --refresh`. This is the durable-plan
    core behind items 66/71 and the reason the P3 Language rule sat unapplied. *Owner:* delegate/devtools
    · *Where:* `src/broker.mjs`, `cli.mjs`. *Acceptance:* edit the constitution, and a running broker
    applies it with no stop; a live seat's run is not cut.
75. **Unify and validate the constitution source.** `constitutionInline` shadowed `constitution.txt`, so
    edits to the file silently did not apply (found 2026-10-16). One source of truth, and `up`/`check`
    warn when both are present or when an inline copy differs from the file. *Owner:* impl · *Where:*
    `cli.mjs` `cmdUp`, `src/checkup.mjs`. *Acceptance:* a rig with a stale inline copy is flagged, not
    silently preferred.
76. **Worktree audit + leak resolution.** `item-635/636/638` leaked with uncommitted work, so the item-73
    sweep correctly refuses them and they keep polluting the tree. Add an operator surface (a `worktree`
    audit / `status` notice) that lists each `item-*` worktree with its queue status and uncommitted
    count, and diagnose why cleanup was skipped. *Owner:* impl · *Where:* `src/worktree.mjs`, `cli.mjs`.
    *Acceptance:* the leaked worktrees are visible and resolvable (commit or force-remove) without
    guessing.
77. **Reap stale viewer processes.** `log --follow`/`watch` accumulate across sessions (11 found
    2026-10-16, up to two days old), holding the store and muddying `ps`. The broker/`up` reaps viewers
    older than their originating session, or `status` names them. *Owner:* impl · *Where:* `cli.mjs`,
    `src/broker.mjs`. *Acceptance:* stale viewers are reaped or reported; no silent accumulation.
78. **Broker crash forensics + survive a conversation storage error.** The broker died on `Session failed
    after a storage error; close and reopen it` with no `EXIT` and no cause logged, stalling the queue
    (impl). Make the broker log the `cause` chain, skip the poisoned conversation for the pass instead
    of dying, and surface it as attention. *Owner:* impl · *Where:* `cli.mjs` `cmdServe`, `src/broker.mjs`.
    *Acceptance:* a corrupt conversation degrades to a notice; the broker keeps driving.
79. **Wrong-rig guard for the configured store path.** `durig.config.json` set `DURIG_DB` to another
    project's store, so a bare command reads the wrong rig. Warn
    (or refuse) when the configured store is outside the seat root / differs from a repo-local DB.
    *Owner:* designer/impl · *Where:* `cli.mjs` entrypoint, `src/config.mjs`, `src/checkup.mjs`.
    *Acceptance:* the wrong-rig case is named, not silently obeyed.
80. **Doc-seat worktree conformance.** The stale constitution meant `scribe`/`advocate`/`designer` never
    called `prepare_workspace`, so doc-only items completed with work left uncommitted in the shared
    tree (found 2026-10-16). After the constitution refresh, assert doc seats prepare a worktree and
    commit there, and that a completion with no commit says so. *Owner:* pm/impl · *Where:* the seat
    prompts, `src/seattools.mjs`. *Acceptance:* a doc item's artifact is a commit on its branch, or the
    completion names the absence.

**Cross-links:** item **69** absorbs the hard guard for `up`/`resume`/`reset`/`send` and the
`serve --stop` exit confirmation; item **70** the read-boundary tolerance; item **71** the command spool
that makes 74/80 broker-applied.

## Runbooks as maintained artifacts (from the research report, 2026-10-16)

Source: `docs/reviews/runbooks-sop-best-practices.md`. Verdict: durig's runbook conventions already match
published practice; what is missing is **machinery** — nothing enforces them or detects rot, and the
single-writer precondition is prose, which failed twice on 2026-10-16. `pm` sequences these.

81. **`runbook-stale` / `runbook-unverified` check rules.** `runbook-stale` is an `error` when
    `last_verified` is old AND a file the runbook names changed since; `runbook-unverified` is `fix-now`
    when `Verify` has never run. Turns rot into a failing test. *Owner:* impl · *Where:*
    `src/checkup.mjs`, `docs/runbooks/*`. *Acceptance:* a stale and an unverified runbook each produce
    the right severity.
82. **Mandatory runbook front-matter + `_template.md`.** Enforce the header block (owner, writes,
    precondition, last_verified, evidence) so a seat, a human, or a `check` rule reads the same fields.
    *Owner:* impl/scribe · *Where:* `docs/runbooks/`, `src/checkup.mjs`. *Acceptance:* a runbook missing
    front-matter is a `check` finding.
83. **Hard write guard on all write verbs.** The single most important recommendation; the precondition
    must be code, not a sentence. This **is** item **69** — do not duplicate; land it. *Acceptance:* see
    item 69.
84. **`--dry-run` for `up --refresh` / `reset` (DELIVERED `dfff51a`).** Print the diff (which constitution doc / seat model
    would change) before writing, so a blind write becomes reviewable. *Owner:* impl · *Where:*
    `cli.mjs`. *Acceptance:* `up --refresh --dry-run` names the seats and fields it would change and
    writes nothing.
85. **Executable `Diagnose` blocks in CI.** Run each runbook's read-only `Diagnose` block in a hermetic
    test; assert it exits 0 and prints parseable output — the read-only half never rots. *Owner:* qa
    · *Where:* `demo/`. *Acceptance:* a broken `Diagnose` command fails the suite.
86. **Runbook verification in the `check` provenance line.** Report "runbooks verified against rev X"
    alongside the existing revision/dirty-tree/extensions. *Owner:* impl · *Where:* `src/checkup.mjs`.
    *Acceptance:* a reading names the verification basis or says it cannot.
87. **Agent-executable runbook runtime (research, gated).** Compile-then-page lifted refusal to 100% but
    **harmed weak models** (59:237); a per-model discipline check must gate it. Register as research, not
    a v1 feature. *Owner:* operator's research agent / delegate · *Where:* `docs/`. *Acceptance:* a
    report naming the capability gate and the per-model check.
88. **`daemon-not-running.md` runbook (DELIVERED).** Pre-writes the operator surface for items 61–64
    (`docs/runbooks/daemon-not-running.md`), marked unverified until the daemon exists. *Owner:*
    delegate · *Proof:* the file plus `docs/BROKER-SUPERVISION.md` §11.

**Cross-links:** item **69** is the research's top recommendation; item **87** depends on a future
capability gate; item **81/82** reuse the `check` rule machinery (item 46's artifact-keyed ownership).

73. **Orphaned-worktree sweep (DELIVERED `243f175`).** `removeClaimedWorktree` now refuses a worktree
    holding uncommitted work unless the caller passes `force` — the D60 refusal its seat-completion
    caller already assumed, and a fix to a latent data-loss bug (the fallback is `rm -rf`). The
    regenerated `node_modules` tree is not counted as work, so legitimate cleanup still runs. At broker
    start the broker removes `item-<id>` worktrees whose queue item is no longer live, keeps live items'
    worktrees, and refuses + reports dirty orphans. *Owner:* delegate · *Where:* `src/worktree.mjs`,
    `src/broker.mjs` · *Proof:* `demo/broker-worktree-sweep.test.mjs` (RED before the fix).

## Reducing agent round-trips (from the research follow-up, 2026-10-17)

Source: `docs/reviews/reducing-llm-agent-tool-calls-followup.md` (follow-up to
`docs/reviews/reducing-llm-agent-tool-calls.md`). Verdict: plan-then-execute / code-as-action
collapses **model round-trips** with peer-reviewed support (LLMCompiler 1.80–3.74× latency, 3.37–6.73×
cost, up to ~9% accuracy; ReWOO 64% tokens), but for durig it must (a) **preserve resumability** by
checkpointing plan nodes, and (b) expect the degeneration surface to **shift** to an opaque in-sandbox
loop the current detectors cannot see mid-run. The primary metric is **cost with the cache split**, not
call count. `pm` sequences these.

126. **Round-trip / turns-per-item measure feeding `computeMetrics`.** Count assistant entries above a
    wake boundary (read-only; a new *measure*, not a new write path, so D24 permits it) and report it
    with a declared blind spot ("no data" when a seat has too few turns — most seats are at zero entries
    today). *Owner:* impl · *Where:* `src/metrics.mjs`, `docs/METRICS.md`. *Acceptance:* `metrics`
    reports turns-per-item per seat with a band + blind spot and says "no data" rather than guessing on a
    sparse seat.
127. **Checkpointed plan-step execution (the durability-preserving form of batching).** Adopt a DAG
    planner, but bind each node to a pi-durable `defineTask` phase with a checkpoint so `resume()`
    replays completed nodes and re-runs only the in-flight one — never a single monolithic program.
    *Owner:* impl/lead · *Where:* `src/`, `docs/`. *Acceptance:* a crash mid-plan replays completed nodes
    from checkpoints and re-runs only the interrupted node (a faux-provider demo proves it).
128. **A mid-run sandbox bound.** Extend D64's detector to see one long-running sandbox call: require
    `memoryLimitBytes` and a deliberate `timeoutMs` on every codemode sandbox construction (the library
    defaults are unlimited / 300 s), and surface `result.calls` duration in the completion evidence.
    *Owner:* impl · *Where:* `src/`, `docs/CODEMODE.md`. *Acceptance:* a sandbox call that outlives its
    bound is detected before the run settles, or the residual gap is named.
    *Folded into item 32's gate checklist (ROADMAP 32) — not a standalone start.*
129. **Narrow the codemode audit gap (a P1-Evidence prerequisite).** `result.calls` records
    `{name, status, durationMs}` only — no arguments, no output — so a verifier cannot re-run what the
    author names; the broker audit sink must be the effect record **before** codemode lands, as an
    acceptance criterion for P1 Evidence to survive. *Owner:* impl · *Where:* `src/`, `docs/CODEMODE.md`.
    *Acceptance:* a codemode execution's arguments and effect are recoverable from the audit sink.
    *Folded into item 32's gate checklist (ROADMAP 32) — not a standalone start.*
130. **Relabel the "longer plans hurt accuracy" claim (correction C1) — DELIVERED.** The first report's
    supporting source is a blog and no controlled dose-response study exists — downgraded to
    "over-planning is a plausible risk, not a measured result" and the claim + reference now carry the
    `advertised-elsewhere` evidence class. *Owner:* delegate · *Where:*
    `docs/reviews/reducing-llm-agent-tool-calls.md`. *Proof:* point 3 and reference `[^6]` carry the
    class and cite the C1 correction in `docs/reviews/reducing-llm-agent-tool-calls-followup.md` §1.

**Cross-links:** item 127 is the prerequisite that makes 126's before/after honest; item 128 is the
surface D64 was built for but cannot yet see; item 129 gates any codemode rollout; the metric
recommendation (cost with the cache split) already lives in `docs/METRICS.md`.

## Agent security & self-healing — from the Microsoft Agent Governance Toolkit review (2026-10-17)

Source: `docs/reviews/agent-governance-toolkit-review.md` (clone `vendor/eval/agent-governance-toolkit`,
HEAD `cfb44576`, MIT). Verdict: AGT is the best available reference for **action-layer governance and
agent SRE**; adopt its fail-closed posture, structured denial, monotone risk ratchet, circuit breaker,
incident lifecycle, and chaos/rogue-detection signal design; adapt its executable-runbook fields into the
existing 81–88 machinery; **reject** its identity/mesh/ring/compliance stack as wrong-layer for a
single-operator local rig. `pm` sequences these. Registered **not scheduled**. *(133–144.)*

133. **Fail closed at a single seat-action decision point.** Give every seat action that can write or
    execute one policy-decision seam whose *evaluation failure* is defined to **deny** (never silently
    allow), with no fail-open configuration flag — the AGT ADR-0013 invariant
    (`docs/adr/0013-fail-closed-on-policy-evaluation-errors.md`). durig's guards (`src/seatguard.mjs`,
    `src/confine.mjs`) refuse individually but nothing names deny-on-error as the contract. *Owner:*
    impl/lead · *Where:* `src/seatguard.mjs`, `src/confine.mjs`, `docs/SEAT-TOOLS.md`. *Acceptance:* an
    error inside decision evaluation denies the action and records the error; a passing check proves the
    rules ran, not that evaluation was skipped. *Consulted:* `security`.
134. **Structured refusal shape.** A refusal carries `rule_id`, `action`/tool, source, policy/config
    version, and timestamp, per AGT's `GovernanceError` (`docs/ERROR_HANDLING.md`). Today a durig refusal
    is a string. *Owner:* impl · *Where:* `src/seatguard.mjs`, `src/confine.mjs`, event records.
    *Acceptance:* a refused command names the rule that refused it and the refusal is machine-readable.
135. **Monotone risk/context ratchet for the guard.** The degeneration/context guard reads a
    **grow-only** accumulated state (a raised signal is never lowered by a later quiet turn), and any
    inherited restriction survives delegation — the AGT `ContextEnvelope` max-lattice + grow-only
    restriction design (`docs/security/context-accumulation-governance.md`,
    `.../policies/context_envelope.py`). This realises D95's "context pressure is a seat-level signal that
    persists" and extends the #1766–#1769 guard core rather than replacing it. *Owner:* impl/lead ·
    *Where:* `src/degeneration.mjs`, `src/attention.mjs`. *Acceptance:* a demo where one high-pressure
    turn followed by quiet turns still trips (the ratchet does not reset), and a delegated sub-run cannot
    drop the parent's flag.
136. **Threat-model boundary taxonomy.** Adopt AGT's four named trust boundaries (human→agent,
    agent→agent, agent→tool, agent→platform) analysed STRIDE-style (`docs/security/threat-model.md`) as a
    fixed checklist in durig's security review runbook, which today has the method but no taxonomy.
    *Owner:* `security` · *Where:* `docs/runbooks/security-trust-boundary-review.md`. *Acceptance:* the
    runbook lists the four boundaries with a durig-specific example each.
137. **Per-seat circuit breaker with an explicit manual close.** After N consecutive failed runs, put the
    seat in an observable **OPEN** state that refuses new wakes with work, until an explicit `reset`
    closes it — the AGT SRE circuit breaker (`docs/specs/AGENT-SRE-GOVERNANCE-1.0.md` §6,
    `.../cascade/circuit_breaker.py`). This is the actuator `src/supervisor.mjs` lacks (it escalates but
    keeps re-waking), and the same fail-fast shape applies to any external sink delivery
    (`docs/adr/0020-circuit-breaker-for-event-sink-delivery.md`). *Owner:* impl · *Acceptance:* a demo
    where 3 consecutive failures open the breaker, a new wake is refused, and only `reset` closes it.
138. **Approval gate as a step state, not prose.** A sensitive action that needs the operator can be
    recorded as `requires_approval` (a pending state with a named approver) rather than an `intent`
    sentence — AGT `require_approval` (`README.md`, `docs/tutorials/38-approval-workflows.md`). *Owner:*
    impl/designer · *Where:* `src/seatguard.mjs`, `cli.mjs`. *Acceptance:* a gated action cannot execute
    until an operator approval names it, and the approval is recorded.
139. **Structured incident lifecycle for `docs/incidents/` + `attention`.** Give the incident class a
    forward-only state (`DETECTED→ACKNOWLEDGED→INVESTIGATING→MITIGATING→RESOLVED`), typed signals with a
    severity hint, and **dedup (600 s) + correlation (300 s) windows** so a repeated condition does not
    re-surface as a fresh notice — AGT `IncidentDetector` (`docs/specs/AGENT-SRE-GOVERNANCE-1.0.md` §14,
    `.../incidents/detector.py`). *Owner:* impl/scribe · *Where:* `src/attention.mjs`, `docs/incidents/`.
    *Acceptance:* identical notices within the window produce one incident; the incident state is
    forward-only. *Signal source:* the existing `attention` notices.
140. **Runbook steps gain rollback + approval fields.** Add `rollback_action`, `requires_approval`, and
    machine `trigger_conditions` as first-class step fields to the runbook schema — AGT
    `.../incidents/runbooks/*.yaml` + `runbook_executor.py`. This **extends ROADMAP 81–88/87** (the gated
    executable runtime); it does not compete with it, and it stays gated on item 87's per-model capability
    check. *Owner:* delegate/impl · *Where:* `docs/runbooks/`, `src/checkup.mjs`. *Acceptance:* a runbook
    step can name its rollback and approval requirement and the executor honours them, or the gap is
    named.
141. **Behavioural chaos faults + abort conditions + a resilience score.** Extend the ROADMAP 67 host
    chaos suite with **agent-behaviour** faults — injected degeneration, a contradictory directive, a
    deadlock — plus safety abort conditions and a pass/fail resilience score, not just a process exit code
    (AGT `AGENT-SRE-GOVERNANCE-1.0.md` §7). *Owner:* qa (author) with impl · *Where:* `demo/`.
    *Acceptance:* the suite injects a degeneration and a stall offline, aborts on a safety condition, and
    reports a score against a baseline.
142. **Add entropy + a frequency z-score to the degeneration detector.** `src/degeneration.mjs` counts
    repeats and tool-turns (the *repetitive* pole) but is blind to the *chaotic* pole — many distinct
    damaging calls. Add an action-entropy bound and a tool-call-frequency z-score over a sliding window,
    the AGT rogue-detector signals (`docs/tutorials/05-agent-reliability.md`,
    `.../anomaly/rogue_detector.py`). *Owner:* impl/qa · *Where:* `src/degeneration.mjs`,
    `src/attention.mjs`. *Acceptance:* a seat emitting chaotic (high-entropy) calls is flagged, not only a
    seat repeating one call.
143. **Seat lifecycle: orphan detection + credential rotation.** Report a seat that is silent past a
    threshold and owns no live work (an *orphan*), and provide a rotation path for the provider API key —
    AGT's LifecycleManager / OrphanDetector (`docs/tutorials/30-agent-lifecycle.md`,
    `.../lifecycle/orphan_detector.py`). durig has `docs/SEAT-LIFECYCLE.md` and a broker heartbeat but no
    orphan report. *Owner:* `security`/impl · *Where:* `src/checkup.mjs`, `docs/SEAT-LIFECYCLE.md`.
    *Acceptance:* `check` reports an orphaned seat and a rotation command exists for the DeepInfra key
    (never printing the key).
144. **Advisory→blocking graduation gate for the degeneration guard.** Turn "zero false positives before
    enabling" into a dated checklist with a rollback to advisory mode and a 48 h deny-rate watch — AGT
    `docs/operations/advisory-to-blocking-graduation.md`. *Owner:* delegate/`security` · *Where:*
    `docs/runbooks/degeneration-guard.md`, `docs/DECISIONS.md`. *Acceptance:* the guard has a documented,
    reversible graduation with the false-positive evidence attached; #1766's enable decision cites it.

**Cross-links:** item **135** extends the #1766–#1769 guard core (do not duplicate); **137** is the
actuator for the ROADMAP 42 supervisor and the crash-proofing cluster (ROADMAP 78); **140** extends
ROADMAP 87 (gated executor), not a rival; **141** extends ROADMAP 67; **137/141** share the fail-fast
breaker shape from AGT ADR-0020. **Rejected** (not registered): Ed25519/DID mesh, execution rings, trust
scoring, the multi-language SDKs, and the compliance mappings — see the review's "Where it does not fit".

## OWASP ASI Top 10 and policy-as-code — from the AGT review addendum (2026-10-17)

Source: `docs/reviews/agent-governance-toolkit-review.md` §Addendum. Correction to the review's first
pass, which rejected "compliance mappings" without reading them: the **OWASP Top 10 for Agentic
Applications 2026 (ASI01–ASI10)** is a directly applicable external checklist, and its policy packs and
static-review rules are concrete. The enterprise certification mappings (SOC2 / EU AI Act / NIST /
ISO) stay out of scope. `pm` sequences these. Registered **not scheduled**. *(145–150.)*

145. **OWASP ASI Top 10 self-assessment for durig.** Map durig's controls onto ASI01–ASI10 with an
    honest coverage rating and a named gap per risk — the AGT table is the shape
    (`docs/compliance/owasp-agentic-top10-architecture.md`; its own intro must be carried: it is a
    "self-assessment mapping, NOT a validated certification"). The mapping above already flags ASI04
    (supply chain), ASI06 (memory/context poisoning vs saturation), ASI08 (no breaker/budget), and ASI09
    (approvals not action-bound). *Owner:* `security` · *Where:* `docs/security/`, re-run on trigger per
    the runbook maintenance policy. *Acceptance:* a dated mapping with a per-risk durig control and gap,
    re-run when a new execution surface or the landing path changes.
146. **Security-lint `check` rules mapped to OWASP ASI.** Adopt the shape of AGT's 14 static review rules
    over agent code — `unguarded-tool-execution`, `no-tool-allowlist`, `missing-audit-logging`,
    `missing-pii-redaction`, `unsafe-deserialization`, `unbounded-collection`, `missing-circuit-breaker`,
    `ssrf-vulnerable-url`, `stub-security-implementation`, and the rest — as `check` rules over
    seat-authored code, each finding labelled by ASI risk
    (`.../copilot-governance/src/reviewer.ts`; severity→exit behaviour from `docs/security/scanning.md`:
    critical/high block, medium/low warn). *Owner:* impl/`security` · *Where:* `src/checkup.mjs`.
    *Acceptance:* a diff introducing an unguarded tool call or an unbounded collection is a `check`
    finding that names its ASI risk.
147. **Per-item deny-by-default action budget.** Every work item carries an explicit `max_tool_calls`,
    `max_tokens`, and a confidence floor, with **deny-all as the default** — the AGT policy-pack posture
    (`docs/compliance/owasp-asi-policy-mapping.md` "Default Posture by Pack"; rules
    `asi08-session-tool-call-limit`, `asi06-context-budget-limit`). durig has only the degeneration
    guard's high-water marks. *Owner:* impl/lead · *Where:* `src/rig.mjs`/seat spec, `src/degeneration.mjs`.
    *Acceptance:* an item exceeding its tool/token budget is halted before the run settles, with the
    budget named as the cause (extends the #1766 halt core).
148. **Output screening for credentials and PII.** durig redacts **tool results** only
    (`src/secretredact.mjs` is the `afterTool` hook, wired in `src/seatguard.mjs:20`); assistant output
    is not screened. Extend screening to model output and add a PII class — AGT calls output
    sanitization and sensitive-data protection its widest gap
    (`docs/compliance/owasp-llm-top10-mapping.md`; rules `asi03-block-credentials-in-output`,
    `asi06-block-pii-ssn`). *Owner:* `security`/impl · *Where:* `src/secretredact.mjs`,
    `src/seatguard.mjs`, `docs/runbooks/tool-result-redacted.md`. *Acceptance:* a credential or PII
    string emitted in assistant output is redacted or refused, with the redaction recorded.
149. **Reversibility-aware approval for irreversible operations.** Classify an action
    `FULLY_REVERSIBLE`/`PARTIALLY`/`IRREVERSIBLE`/`UNKNOWN` and require extra operator approval plus a
    compensation plan for the irreversible — AGT `ReversibilityLevel` / `_REVERSIBILITY_MAP`
    (`agent-governance-python/agent-os/src/agent_os/reversibility.py`); approval bound to the action
    digest, expiring, replay-rejected (`docs/adr/0030-action-bound-approval-protocol.md`). durig's
    branch deletion, force-landing, and broker stop are the candidates. *Owner:* impl/lead · *Where:*
    `src/seatguard.mjs`, `cli.mjs`, `docs/runbooks/`. *Acceptance:* an irreversible verb requires an
    approval naming its action digest, and the approval expires. *Extends:* item 138.
150. **Supply-chain hygiene for vendored code.** Produce a dependency inventory / vulnerability scan for
    the vendored trees (`vendor/pi-main`, `vendor/eval/*`, `vendor/pi-warden`) and a provenance note per
    vendored project — the ASI04 gap (`docs/compliance/owasp-agentic-top10-architecture.md` ASI04).
    Pinning + `scripts/sync-pi.mjs` provenance already exist; the scan does not. *Owner:* devtools/`security`
    · *Where:* `scripts/`, `docs/PROVENANCE-pi-warden.md`. *Acceptance:* `check` (or a script) reports the
    vendored inventory and a vulnerability scan, and names any un-inventoried tree.

**Cross-links:** item **146** extends the `check` rule machinery (ROADMAP 46/81/82); **147** extends the
#1766 halt core and the D95 context bound; **148** extends the secretredact/commit-gate work
(#1317); **149** hardens ROADMAP 138; **150** closes the ASI04 row of ROADMAP 145. **Left out** (not
registered, with reasons in the addendum): Ed25519/DID mesh, trust scoring, multi-tenant/K8s isolation,
enterprise certification mappings, disclosure/post-market processes, and SBOM signing.

## Runbook machinery — competitor-review coverage (2026-10-17)

Source: `docs/runbooks/competitor-review.md` "Machinery (proposed)", added while tightening that runbook
after the OWASP miss. `pm` sequences. Registered **not scheduled**.

151. **`competitor-review-covered` check rule.** Fail when a `docs/reviews/<name>-review.md` whose
    `vendor/eval/<name>` clone exists has no `docs/COMPETITORS.md` entry, or when a review's pinned HEAD
    differs from its clone's HEAD. Key on the clone's existence so non-competitor reviews
    (`security-codemode-review.md`) are not flagged, and do **not** require a review for every
    `vendor/eval/` clone (that directory also holds dependency/TUI evals). *Owner:* impl · *Where:*
    `src/checkup.mjs`. *Acceptance:* a missing `COMPETITORS.md` entry, or a stale pin, is a `check`
    finding. *Cross-links:* the runbook-machinery family ROADMAP 81/82.

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
