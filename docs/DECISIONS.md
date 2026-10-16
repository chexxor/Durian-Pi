# durig â€” decision log

Each entry: decision, rationale, alternatives considered, status.
Dates are 2026-10-07 unless noted.

## D1 â€” Build on pi-durable rather than OpenRig/other candidates

**Decision:** develop durig as a rig layer on `@earendil-works/pi-durable`.
**Rationale:** six-way comparison (`../docs/ORCHESTRATION-COMPARISON.md`)
showed OpenRig covers our feature set best but carries a tmux assumption we
already shim at real maintenance cost on Windows; pi-durable gives the
strongest crash-recovery guarantees surveyed (commit-before-display) and its
extension API proved capable of hosting the delegation pattern in spikes.
**Alternatives:** agent-fleet (pi-coupled, Windows unverified), tuios (pane
layer, no topology/queue), hermes-agent (single-operator model, no seat
topology). **Status:** adopted.

## D2 â€” Seats are conversations; registry is a session-scoped doc

**Decision:** a seat = one pi-durable conversation; name/id/role/goal/
capabilities live in the `durig.seats` session document.
**Rationale:** conversations are PD's durable unit with per-conversation
agent config; a doc keeps the roster queryable by any client without owning
storage. **Status:** adopted.

## D3 â€” Queue is a session-scoped document, not tasks

**Decision:** work items live in `durig.queue` doc with statuses
queuedâ†’claimedâ†’done and append-only transitions.
**Rationale:** atomic queue-transcript consistency in one commit; audit trail
survives restarts. PD tasks were considered for queue items but their
ownership model fits subagent lifecycles, not PM-style routed work.
**Status:** adopted.

## D4 â€” Mailbox symmetry: completion enqueues a DONE notice back to sender

**Decision:** `complete_work` writes a DONE item addressed to the original
sender. **Rationale:** both directions flow through one durable queue; no
side-channel notification mechanism needed. **Status:** adopted.

## D5 â€” Org edges are restrictive-by-default

**Decision:** when any edges exist, a sender without a matching link is
forbidden to send. **Rationale:** auditability preference; open-by-default
was implemented first and failed the v2 gate demo (intruder enqueued work),
so semantics were corrected to match the documented intent.
**Status:** adopted (bug found by demo before any real traffic).

## D6 â€” Provider options single-sourced from pi-deepinfra's models.ts

**Decision:** durig imports BASE_URL/PROVIDER_ID/DEEPINFRA_COMPAT/
fallbackModels from `../vendor/pi-deepinfra/models.ts` instead of defining
its own provider constants. **Rationale:** operator direction â€” the same
extension architecture should supply provider options; Node 24 type-strips
the TS module so no build step is needed. A synthesized model entry is added
when DURIG_MODEL is absent from the curated fallback subset.
**Status:** adopted.

## D7 â€” CLI contract: one JSON document per command, exit 0/nonzero

**Decision:** every CLI command prints exactly one parseable JSON doc;
errors as `{ok:false,error}`; `send` waits and returns the reply inline.
**Rationale:** LLM operators need parseable output and no polling loops or
interactive prompts. **Status:** adopted.

## D8 â€” Faux CLI mode exercises plumbing only

**Decision:** `DURIG_PROVIDER=faux` gives one canned reply per send; full
offline orchestration loops live in demo scripts.
**Rationale:** scripted responses drain per process and each CLI call is one
process; per-seat scripting across invocations would require durable script
state we do not want to build for tests. **Limitation documented in code.**
**Status:** adopted.

## D9 â€” Config schema v2 mirrors CrewAI/MetaGPT field names

**Decision:** seat persona fields named role/goal/backstory/constraints/
capabilities (source-verified against crewAI base_agent.py and MetaGPT
roles/role.py); GitHub Agents MD-frontmatter style noted as prose-first and
not interoperable without loss. **Rationale:** mechanical migration from the
closest frameworks; OpenRig converter handles our actual incumbent.
**Status:** adopted.

## D10 â€” Upstream sync practice

**Decision:** keep durig's pi-durable/pi-ai/chord aligned with pi releases;
update + regression-run demos after every `pi update`.
**Practice applied 2026-10-07: 1.0.4 â†’ 1.1.0 with both demos green.**
**Status:** standing practice.

## D11 â€” `durig watch` polls the storage layer, not the session

**Decision:** the `watch` command streams queue changes by polling
`storage.findDocument` + `storage.document(id,"current")` every 750 ms,
not via pi-durable's `DocumentWatch` and not via `documentState`.
**Evidence (2026-10-09):** `CommittedWatch` is fed by in-process
replication only (pi-durable `session/observation.js`), sqlite storage has
no cross-process change notification, and `documentState` on an
already-materialized doc keeps serving the session's stale replicated
value â€” a separate watcher process received the initial snapshot but never
a single cross-process commit (probe reproduced twice). Direct storage
reads bypass both traps; the test proves a second process's enqueue
arrives within one poll interval.
**Trade-off accepted:** up to 750 ms latency and a periodic read, in
exchange for correctness across processes. If pi-durable grows cross-
process notifications, swap the poll loop for a real subscription.
**Status:** adopted.

## D12 â€” Generation slots: cross-process file leases at the provider seam

**Decision:** `DURIG_MAX_CONCURRENT_SEATS=N` caps concurrent GENERATIONS
(not seats-as-objects) by wrapping the provider's `stream`/`streamSimple`
with slot-file leases (`<db>.genlock.<i>`) beside the rig database.
**Why these seams:** durig drives seats from per-invocation CLI processes,
so an in-process semaphore would be theatre; the provider entry points are
the one funnel every seat's generation crosses regardless of driver.
**Visibility without a messaging channel:** the lease file doubles as
operator state â€” `status`/`watch` report `generation_in_flight`
(holder seat + since) vs `generation_stale` (holder pid dead or older
than 60 s, stealable). Waiting-for-the-GPU is thus distinguishable from
stuck, pairing with #4's attention vocabulary.
**Trade-offs accepted:** up to 100 ms acquire-poll latency; stale theft
after 60 s could theoretically double-run a wedged generation (accepted:
a generation wedged 60 s is already failed in practice).
**Status:** adopted.

## D13 â€” Instruction optimization: own meta-prompt, pluggable seam

**Decision:** seat-persona and work-request optimization runs through the
rig's OWN model stack (`src/optimizer.mjs`) with a self-authored
optimization meta-prompt, NOT vendored template text from
linshenkx/prompt-optimizer. That project is AGPL-3.0; copying its template
would make durig AGPL-derived and constrain redistribution. A vendored
checkout for private study lives at `../vendor/prompt-optimizer`; adopting
its exact template later is a one-constant swap at the same seam if the
operator accepts AGPL in that deployment.
**Automation seams:** `up` with `DURIG_OPTIMIZE=on` optimizes each seat's
compiled persona before storing (one model call per seat; raw spec stays
authoritative on disk); `send_work` gains opt-in `optimize:true` which
rewrites the request body before enqueue. Both record provenance
(`instructionsOptimizedVia` on the seat; `optimizedVia` on the queue item)
so machine-written prompts are always distinguishable from human ones.
The optimizer inherits the generation-slot cap (D12) automatically because
it rides the same provider stack.
**Status:** adopted.

## D14 â€” Optimizer effectiveness: preservation guard + blind judge

**Decision:** effectiveness is measured, not assumed. Two instruments:
(1) `analyzePreservation` â€” mechanical check that hard facts (numbers,
quoted names, constraint lines) survive the rewrite; wired INTO
`optimizeInstruction` as an automatic fallback-to-raw safeguard, so a
lossy rewrite never reaches a seat and provenance stays honest.
(2) `src/judge.mjs` â€” blind pairwise judging (randomized A/B assignment,
strict-JSON verdicts) on clarity/completeness/actionability; the judge is
told to penalize additions so "richer" cannot masquerade as "better".
**Benchmark:** `demo/optimizer-eval.mjs` â€” fixed case set, per-case JSON
rows, aggregate VERDICT line. Faux mode proves harness mechanics only;
the real measurement is `DURIG_PROVIDER=deepinfra ... node demo/optimizer-eval.mjs`
(prefer `DURIG_JUDGE_MODEL` different from `DURIG_MODEL` to defeat
self-preference bias).
**Status:** adopted.

## D15 â€” tutor-pi migration: done; instruction optimization rejected by guard

**Decision:** all 13 tutor-pi seats migrated to durig
(`rigs/tutor-pi.rig.json`, generated by the upgraded converter from the real
OpenRig topology: pods, agent_refs, skill content, pod + rig guidance,
culture constitution). Boot verified with DeepInfra; instructions stored
verbatim (7.6k-11.6k chars/seat); edges carried.
**Finding:** DURIG_OPTIMIZE=on with Qwen3-32B rejected 13/13 persona
rewrites across THREE runs (including one with a hardened verbatim-rule
prompt). The losses are real: dropped 80/20 rule, dropped quoted phrases,
and one rewrite INVENTED TAPL citations - the exact cardinal sin the
constitution forbids. Conclusion: compressive optimization is the wrong
tool for dense normative text; these personas are already deliberately
written. The guard did its job; fallback-to-raw kept the rig safe.
**Implications:** keep DURIG_OPTIMIZE off for persona bootstrapping on
Qwen-class models; revisit with a stronger optimizer model or for short
work-request bodies only. Effectiveness benchmark (D14) is the arbiter.
**Status:** adopted.

## D16 â€” Router must be installed at harness open; coordinators get explicit edges (2026-10-09)

**Finding:** `cli.mjs` opened its harness with a bare `createRegistry()`, which holds
only built-in tasks. The Router extension (send_work/claim_work/complete_work/
defer_work/resume_work/peek_queue) was never installed, so NO seat conversation ever
had the durig tools.
Faux demos passed anyway because they install Router themselves and script tool
calls â€” masking the gap. Real models (Qwen3-32B, GLM-5.3-Flash) therefore narrated
work as chat text instead of routing it.

**Decision:**
1. `cli.mjs openHarness` installs `Router` into the registry at open (mirroring
   demo/offline-v2.mjs and demo/online.mjs).
2. The converter (`scripts/from-openrig.mjs`) grants coordinator seats (`pm`,
   `lead`) explicit send edges to every other seat: OpenRig expresses PM routing
   authority implicitly, but durig edges are restrictive-by-default, so a migrated
   org could not route at all without this.
3. Every seat's instructions get a durig work-protocol primer appended at `up`
   time (belt-and-braces with tool visibility; models still need to be told to
   route rather than narrate).

**Evidence:** real-model e2e on GLM-5.3-Flash (scratch db, deleted after): pm
decomposed a feature request into 4 routed queue items (impl spike, impl build,
qa verify, sec consult); impl claimed #1, completed it, DONE notice auto-enqueued
back to pm. Full nine-test suite green after the change.

## D17 â€” Track pi `main` pinned by commit, not the release channel (2026-10-10)

**Finding:** `@earendil-works/pi-durable` ships from the `earendil-works/pi`
monorepo. npm exposes only `latest` (1.1.0) and `legacy-node20` â€” there is no
dev/nightly channel, so `main` is the dev channel. Within one day of the 1.1.0
tag, main was 14 commits ahead, including `feat(durable): nested tool calls,
structured output, callers` (tool.ts +434/âˆ’71) and a rename of
`ToolExecutionResult.content` to `output` that silently empties every durig tool
result on main.

**Decision:** track main, pinned to a specific commit (`pi-main.pin.json`),
built locally by `scripts/sync-pi.mjs` (sparse clone â†’ npm install â†’ build
telemetry/chord/ai/durable). `--link` swaps `node_modules` via
`npm install --no-save`, so `package.json` and a fresh clone stay on releases.
Re-pin deliberately with `--update`; the 12-demo suite is the regression gate.

**Compat:** `src/rig.mjs` returns tool text through `toolText()`, which emits
both `content` and `output`, so the same code is correct on the 1.1.0 release
and on pinned main.

**Evidence:** spike at `C:/tmp/pi-main-spike` + `C:/tmp/main-test`; full build
~40 s (36 s cold, 24 s warm); durig's suite passes 12/12 both on released
packages and on the linked main build (tool.js byte-identical to the built tree).

**Pin moves:** `42a3497d` (2026-10-10) â†’ `ea448f45` (2026-10-11), which carries
"the scheduler no longer visits every live task on each pass",
`TaskRuntime.ownedTasks()`, and one document per nested call. Rebuilt and
relinked; all 18 demos pass on the new pin without a code change, so the move
needed no compat shim. Upstream is re-checked at the start of a session rather
than mid-task: an API rename landing underneath work in progress is the failure
the pin exists to prevent, and moving it deliberately costs one suite run.

**Pin move:** `ea448f45` â†’ `42705224` (2026-10-12), the durable **code mode** tranche
(`pi-durable` now depends on a new workspace package `@earendil-works/pi-codemode`, so
the pin's package set grew from four to five and `sync-pi.mjs` now re-applies
`sparse-checkout` on every sync, not only at init â€” an existing build tree would
otherwise never check the new package out). Rebuilt all five packages; the pinned
sha is upstream tip and **all 38 demos pass on it with no durig code change**.

## D18 â€” Read commands must name the database they used (2026-10-10)

**Finding:** a second terminal that omits `DURIG_DB` silently opens the default
`./rig.sqlite`, which sqlite creates on demand. `ps`, `status` and `watch` all
answered `ok: true` with zero seats and `attention: []`, so a wrong database was
indistinguishable from a healthy quiet rig. This is exactly the operator-reported
"I see nothing" symptom, reproduced from a clean clone.

**Decision:** `ps`, `status`, `watch` and a failed `send` print a stderr note when
the resolved database holds no seats, naming the file and the way out
(`node cli.mjs config`), and they report the resolved `db` path in their JSON.
`up` reports where it wrote.

**Evidence:** `demo/cli.test.mjs` (wrong-database section); reproduced and fixed
during the cold quickstart walkthrough.

## D19 â€” Human views on a terminal, JSON when piped (2026-10-10)

**Finding:** `watch` emitted NDJSON only, which is correct for scripts and opaque
for the operator at a terminal â€” who wants seat, role, current work and the last
thing said.

**Decision:** `watch` and `log` render a human view when stdout is a TTY and keep
NDJSON when it is not; `--json` and `--human` force either form. Precedence mirrors
`send --stream`: an explicit flag wins, otherwise the terminal decides. stdout
stays a single JSON document in JSON mode, so the LLM-operator contract (D7) is
untouched.

**Evidence:** `demo/watchview.test.mjs`, `demo/streamcli.test.mjs`,
`demo/chatlog.test.mjs`; live proof â€” a real-model run shows the panel moving
through `generation_in_flight` to `sent #1` to DONE.

## D20 â€” A transcript renders in TURNS, not entries (2026-10-10)

**Finding:** a tool call and its result are two entries â€” `toolCall` parts live
inside the assistant message, and the result arrives later correlated by
`toolCallId`. Stamping every entry produced four near-identical timestamps in a
row and split one act of work across two rows.

**Decision:** the display unit is a turn: an operator message, an agent message,
or a tool call together with its output. Each turn carries one timestamp and the
elapse delta from the previous turn. Conventions adopted from the twelve-CLI
survey (RESEARCH.md, "Formatting a transcript"): borderless rows, dim metadata, one
accent per role, a narrow fixed gutter, a tree connector for tool output, collapse
with a signposted count (`--full` expands), and success/failure carried by glyph
as well as colour. Tool background tint is opt-in (`--tool-bg`, `--theme`) because
a hard-coded tint misreads on an unknown terminal background.

**Evidence:** `src/chatview.mjs`, `demo/chatlog.test.mjs` (grouping, deltas, day
boundaries, orphaned results, collapse/expand, tint).

## D21 â€” The CLI stays non-interactive; interaction is a separate frontend (2026-10-10)

**Finding:** an operator using `log` as a cockpit asks for click-to-collapse and
click-to-navigate. Collapsing a printed line requires owning the screen (mouse
reporting plus repaint); a line-oriented viewer cannot do it, because the terminal
owns scrollback. And `cli.mjs` carries the JSON contract the seats themselves
drive (D7), so it cannot also be a TUI. The two asks are not equally costly:
"jump to the peer agent" is a data feature (queue items carry `from`/`to`) and
works today, including as an OSC 8 hyperlink; "collapse in place" is a change of
screen model.

**Decision:** keep `cli.mjs` non-interactive as the operator/LLM surface. Extract
a pure view model (turns, collapse state, peer navigation graph) plus one shared
read API, so that any interactive client â€” a TUI or a browser over SSE â€” is a
client over the same store rather than new logic in the CLI. `watch`, `log` and
`status` currently each re-implement seat and health reading; that duplication is
the real refactor signal. Choice of TUI vs web is deferred, not made by accretion.

**Not changed:** storage, schema, the queue protocol, and every JSON contract. This
entry records an architecture direction, not a rewrite.

**Evidence:** the survey's screen-model analysis shows alt-screen plus tmux is the
worst-supported combination in the field, which is precisely what click-to-collapse
would force; `wiremonitor` is a working precedent for the read-only SSE client.

## D22 â€” Seats are not terminals, so no multiplexer is required (2026-10-10)

**Finding:** operator question â€” do we need tmux/tuios/psmux to watch a seat live,
and is each seat a child-process terminal? Verified no: there is no PTY, no
`spawn`, and no per-seat process anywhere in `cli.mjs` or `src/`. A seat is a
conversation row in one SQLite file; one process drives all of them.

**Decision:** terminal multiplexing is at most a presentation choice for arranging
panes; it is not on the path to any required capability. Live viewing is served by
reading the same store from another process, which `watch` and `log --follow`
already do (D11). A multiplexer adds nothing to the data and, for a screen-owning
TUI, actively fights copy-mode and resize.

**Evidence:** grep for `pty|spawn|fork|conpty|terminal` across `cli.mjs` and
`src/*.mjs` returns nothing; `docs/RESEARCH.md`, "Live delivery of seat activity".

## D23 â€” The research gaps are protocol, not architecture (2026-10-10)

**Finding:** reviewed `docs/Patterns_and_Pitfalls_of_LLM_Agents.md` (the MAST
failure taxonomy, Anthropic's production and swarm research, and the practitioner
consensus) against what durig actually implements. Both load-bearing citations
were verified by fetching them: arXiv 2503.13657 and Anthropic's "Patterns and
problems in emerging multiagent systems" (2026-08-13) exist and support the claims
made from them.

Several named failure modes turn out to be **absent by construction rather than
mitigated**: loss of conversation history (conversations are durable rows), silent
shared-state corruption â€” the failure practitioners call under-appreciated most
often â€” (one writer, atomic document revisions, no shared scratchpad; seats enqueue
items instead of mutating shared state), and the coordination substrate the swarm
paper says agents lack (a constitution, restrictive-by-default edges, an
append-only transition trail). Observability, which practitioners call the hard
part, is where durig over-invested.

**Gap:** a grep for `verif|escalat|deadline|retry|budget|veto|reputation` across
`src/*.mjs` and `cli.mjs` returns only the two CLI poll loops. So `complete_work`
is self-declared, with no evidence attached and no verifier step (MAST FC3 â€” the
category the paper's own intervention improved by 15.6%); there are no termination
conditions (FC1, 12.4%); no clarification or deferral path (FC2, 6.8%); and nothing
detects step repetition (FC1, the single most frequent mode at 15.7%). Separately,
all 13 seats in `rigs/tutor-pi.rig.json` resolve to one model while per-seat models
are already supported (D-per-seat), so a model-level bias is systemic rather than
isolated â€” the correlated-failure mode Anthropic's swarm work describes.

**Decision:** no architectural change. The durable single-writer store, the
orchestrator-worker topology, the explicit edge permissions and the audit trail are
the remedies the literature converges on, and they are already the foundation. What
is missing is **protocol**: verification with evidence, termination and attempt
semantics, and a deferral verb. These are additions inside the existing design, and
they are the content of milestone M3 â€” giving seats real tools and giving the rig a
verification loop are the same work item, because a check needs something runnable.
Verifier model diversity is enabled first, as a configuration change, to
de-correlate verification at no build cost.

**Not adopted:** reputation systems, veto/quorum arbitration, and flat peer swarms
(deferred with reasons in ROADMAP.md). Seats get **no polling tool** when they get
real tools: the swarm paper's stampede â€” 2.4 M requests, 117 accepted â€” is exactly
what that produces.

**Evidence:** both citations fetched 2026-10-10; the capability grep; a `node -e`
pass over `rigs/tutor-pi.rig.json` reporting 13 seats and 1 distinct model. Full gap
table in ROADMAP.md, "Gap analysis vs the research".

## D24 â€” The research concerns are measured, not just listed (2026-10-10)

**Finding:** D23's gap table is a snapshot. It cannot answer whether an instance is
drifting worse, or whether a configuration change helped. It is affordable to
answer that here because the store already holds every message, every tool call with
its arguments, and every queue transition â€” so each concern is a **read-only query
over data already persisted**, not a new instrumentation surface.

**Decision:** each named concern gets a measure (`cli.mjs metrics`), and each
measure declares three things in its output rather than in documentation: its
**evidence class** (direct / proxy / config-derived), its **direction** (what a
rising value means), and its **blind spot** â€” because a clean reading can mean the
capability is missing. Verification is the example that matters: it reads "no
independent checks" today precisely because nothing can check, and a measure that
reported an all-clear would be a lie.

**Decision (the review loop):** a configuration change is a hypothesis with a
direction, recorded **before** the change â€” what changed, which measure should
move, and which way â€” and re-measured after. A change whose measure does not move
as predicted is a candidate for reverting. This is D14's preservation guard applied
to configuration instead of instructions. The predicted direction is recorded first
deliberately: without it, any later movement can be rationalised after the fact.

**Decision (honest denominators):** a window over real usage confounds "the rig got
worse" with "the work changed", so passive windows are labelled **confounded** and
a *drill* against a fixed task set is what makes two configurations comparable.
Neither is presented as the other.

**Not adopted:** telemetry or egress of measures (it would also require a
`security.sec` consult before shipping), a new table or write path for the first
cut, and any dashboard. Measurement reads through the same shared read API as
`watch`, `log` and `status` (near-term 8).

**Evidence:** `src/rigstory.mjs` already reads transcripts storage-direct with no
harness (D-view); queue items carry `from`/`to` and transition history
(`src/rig.mjs`); entries carry no `usage` field, checked before claiming a cost
measure could be direct. Table in ROADMAP.md, "Measuring the research concerns".

**Correction 2026-10-11 (F4, `docs/DOGFOOD.md`):** that check was wrong. Stored
assistant entries DO carry `usage` with `input`, `output`, `cacheRead`,
`cacheWrite` and a per-field `cost` breakdown, verified through
`storage.scanEntries` â€” the same path a measure reads, not the `log` view. The
original check must have looked at a different entry kind or predated the field.
Consequence: the cost measure is **direct** class, item 2's token counter is
unblocked, and caveman's claimed savings are verifiable with our own numbers. The
claim is left standing above rather than edited away, because the interesting part
is that a "checked" fact stayed wrong for weeks and ordinary use found it.

**Design:** how these measures reach a human â€” surfacing tiers, scope, notice
lifecycle, and the traps â€” is `docs/METRICS.md`.

## D25 â€” `check` is a linter, and severity says who can fix it (2026-10-11)

**Finding:** D23 lists the research gaps and ROADMAP turns them into work, but
nothing evaluates *a given rig* against them, so a new user cannot tell whether
their configuration has a verifier, whether author and verifier share a model,
or whether a seat can send anything at all. The constitution defect proved the
sharper version: the rig file and the store disagreed, every command reported
`ok`, and 13 seats ran without their team culture. A config auditor had to read
both sides.

**Decision:** `node cli.mjs check <rig.json> [--human]` audits the rig file and
the store in one read each, and reports findings with a **stable rule id**, a
subject, and the exact fix. Severity expresses **who can fix it**, which is the
only distinction that changes what an operator does:

- `error` â€” the rig cannot do its job until the file changes; `check` exits
  nonzero so a script can gate on it.
- `fix-now` â€” a real gap the operator can close; the rig still runs, so it never
  fails a run and never blocks a script.

A rule `check` cannot judge (no declared text to compare, an unreadable store) is
reported **skipped with its reason** â€” never as a pass. Silence that reads as
health is the failure mode this whole feature exists to remove.

Eight rules: `constitution-missing`, `constitution-not-applied`,
`unreachable-seat`, `dangling-edge`, `store-missing-seat`, `stray-seat`,
`no-verifier-seat`, `single-model-rig`.

**Not adopted:**
- A third `code-gated` severity for gaps no rig edit closes (verification
  evidence, a deferral verb, termination semantics). `check` cannot know about
  them without hand-mirroring the tool surface, which is precisely the drift that
  produced the constitution bug. They stay in ROADMAP items 4-6, where they
  change when the code does â€” not in a linter that would report them forever.
- `--fix`. D24 makes a config change a hypothesis whose direction is recorded
  *before* the edit; a fixer would apply changes nobody predicted.
- A composite rig score (Goodhart; `docs/METRICS.md`) and interactive prompts
  (D21 â€” the CLI stays non-interactive).

**Deliberate imprecision, stated in the code.** `no-verifier-seat` is a
heuristic over seat *name and role* text, so it is `fix-now` and prints the
vocabulary it used. Matching on advertised `capabilities` was rejected: tutor-pi's
own implementers advertise `peer-review`, so a capability match would classify
the authors as verifiers and report an all-clear on the exact gap the rule
exists to catch. A false all-clear is the one failure an audit tool must not
have. The stranded-seat rule is likewise broad â€” *any* seat with no outgoing
target â€” rather than the sharper "is a target but cannot reply", because
`complete_work` enqueues its DONE notice without the edge gate, so the sharp form
would miss the D16 coordinator case the rule is named after.

**Evidence:** `demo/check.test.mjs` (the 19th demo) covers every rule, the drift
regression, the capability false-all-clear case, open-vs-restrictive edges,
skipped-with-reason, the render, and the CLI exit codes; 19/19 demos pass. Run
against the live tutor-pi store it found a real, unmasked defect â€” see D26.

**Cleanup alongside it:** the two view modules each carried their own ANSI
palette (chatview had magenta and no yellow, watchview the reverse), now
`src/ansi.mjs`. `truncate` was left duplicated on purpose: the two copies
disagree on the `width <= 1` edge case, so unifying them is a behavior change and
belongs with the view-model extraction (ROADMAP item 7).

## D26 â€” The converter drops OpenRig's rig-level `edges:` list (2026-10-11)

**Finding:** found by `check` on its first real run. `scripts/from-openrig.mjs`
derives send permission from `agent.delegates_to` and each pod's `edges:` block,
but never reads the **rig-level** `edges:` list at the end of `rig.yaml`. That
list carries `escalates_to` (qa, qa2, student, sec, dev â†’ lead), `collaborates_with`
(ux â†’ pedagogue, pm â†’ lead, pm â†’ sec) and `can_observe` entries. The generated
`rigs/tutor-pi.rig.json` gives `ux`, `sec` and `dev` **no outgoing edge at all**,
and qa/qa2/student lose their declared escalation path; `check` reports
`unreachable-seat` for the three. The D16 fix (blanket edges for pm/lead) masked
most of the loss, which is why nothing caught it.

A second defect rides along: pod-level edges use bare names (`from: impl`) while
rig-level edges use qualified ids (`from: build.qa`), so reading the rig-level
list requires normalising `pod.seat` to `seat`.

**Status:** recorded, not yet fixed â€” it is a converter concern (one per change)
and the next item in the roadmap. Evidence: `openrig/rigs/tutor-pi/rig.yaml`
lines 220+ versus the generated spec's edge list; `durig/docs/ROADMAP.md`.

## D27 â€” A `docs` pod, and how its edges were decided (2026-10-11)

**Finding:** nothing in the rig owned documentation, and the drift was already
visible: `openrig/README.md` described "10 Pi seats across 5 pods" for a 13-seat,
8-pod rig, and a committed converter fixture that crashed on contact was cited as
proof by three documents â€” including an acceptance item marked PASS. Documents
decay silently unless somebody's job is to read the artifact.

**Decision:** a ninth pod, `docs`, with one seat â€” `scribe` â€” whose mandate is the
feature inventory and a doc per capability, kept true as it changes. Persona:
`documentation` + `grounding` + `rig-membership` skills, a role guidance file, and
a pod SOP. The load-bearing rules are that it **reads the work rather than asking
for a summary** (its incoming `can_observe` edges are the evidence) and that
**verification is the boundary of what it may claim**: a capability is documented
as working when its proving test passes, otherwise it is marked `unverified`
rather than omitted.

**Edge design â€” one rule instead of seat-by-seat.** A documentation seat is
horizontal by nature, so drawing 17 edges by hand invites both gaps and cruft. The
rule applied:

- **Reads and questions** every seat that ships a *user-visible capability*
  (`impl`, `impl2`, `ux`, `pedagogue`, `dev`) or *verifies* one (`qa`, `qa2`) â€”
  `can_observe` one way, `collaborates_with` back.
- **Takes assignments** from `program.pm` (delivery) and `advise.lead`
  (`delegates_to`), and **escalates** to `advise.lead` when the code and the docs
  disagree.
- **Delegates to nobody.** Documentation is written, not assigned onward.
- **Deliberately not connected** to the seats that produce taught *content*
  (`theorist`, `editor`) or *assurance* (`sec`): those are not capabilities. If
  that changes, the rule above says exactly which list to extend.

The reverse edges are not symmetry for its own sake: the feature's author is who
closes a doc, mirroring the pair-review rule that an item is not done on the
author's word alone â€” here the doc is not done until the author of the code
confirms it.

**Finding while doing it â€” edge kinds flatten.** OpenRig distinguishes
`delegates_to`, `collaborates_with`, `escalates_to` and `can_observe`; the
converter emits all four as one `maySendTo` permission. So in durig "may read
this seat's work" and "may assign this seat work" are the same bit. It is
harmless here â€” durig needed the read permission to carry a question anyway â€” but
it is lossy, and if durig's edge model ever grows a kind, this is the mapping to
revisit.

**Security â€” consult taken 2026-10-11, and it did not pass as scoped.** The scribe
reads other seats' transcripts and republishes into documents, which is an
untrusted-input and exfiltration surface, and the team norms require a
`security.sec` position *before* code for exactly that. The rig daemon was down
(2026-10-06 â†’ 2026-10-11) when this was written, so the consult was recorded as
owed rather than dropped; it has since been taken, and the verdict is **FAIL as
scoped â†’ adopt-with-conditions** (D30). The persona mitigation below is a norm,
not a mechanism. Mitigation already in the
persona: the `documentation` skill forbids copying credentials, tokens or
personal data out of a transcript, on top of the culture's "no secrets in git".

**Also noted (not fixed):** the three older pod fragments carry no `startup:`
block while their `rig.yaml` pods do, so a pod added with `rig expand` is not
delivered its pod SOP and differs from the same pod built by a full rig. The new
`docs-pod.fragment.yaml` includes its startup block; the earlier three should get
theirs.

## D28 â€” Measurement ships, and what a reading refuses to claim (2026-10-11)

**Context:** D24 decided the research concerns are *measured*; `docs/METRICS.md`
designed how. Both ended with open questions, so the design note was rewritten as
a decision brief (options, a recommendation, and the evidence behind each), the
operator agreed to all five, and this records what was built from them.

**Decision (the split between `check` and `metrics`).** `check` is a pre-flight
linter: you run it because you were already about to change something. Metrics are
**ambient** â€” their value is noticing something without having asked. So metrics
join `computeAttention` rather than inventing a surface, and the doc's admission
test decides who may be ambient: actionable, rare when abnormal, and *not already
visible*. `shared-reviewer-model` fails the third test, because it is already a
`check` rule, so it appears in `metrics` only.

**Decision (four measures, not three).** The ruling put the queue scope in the
first cut, and a scope with no measure is not shipped â€” so `queue-ageing` joins
`step-repetition` (direct), `unverified-completions` (proxy) and
`shared-reviewer-model` (config-derived). All three of D24's evidence classes are
exercised, which was the point of the original three.

**Decision (evidence-class naming: D24 wins).** `METRICS.md` called
unverified-completions "code-gated baseline"; D24 names the classes `direct` /
`proxy` / `config-derived`. They are not competing taxonomies â€” "code-gated"
describes where that measure's *baseline* comes from, not a fourth class. The
implementation follows the decision record (`proxy`), and the code-gated fact
survives as the written reason that this proxy can never read clean on a rig whose
seats have no read tool. Recorded because a design note silently redefining a
decision's vocabulary is how the two drift apart.

**Decision (what a reading must refuse to claim).** This is the load-bearing part,
because every alternative produces a false all-clear: no tool calls is `null`, not
"0% repetition"; no completions is `null`, not "0% unverified"; a page that starts
mid-turn drops its leading partial turn rather than calling a completion
unverified because its retrieval fell off the scan edge; no baseline reads
`unknown`, never `ok`; a zero baseline cannot silence movement off zero (k Ã— 0 is
0, so the relative rule would never fire); a config-derived value draws no trend
arrow; and a window that was bounded, or a rig with no new data, says so â€” absence
of activity is not improvement.

**Decision (deferrals, each with its reason, none half-built).** Cross-render
hysteresis needs either stored state or a series derived from the window, and the
threshold values were the ruled deliverable â€” so the values ship and the
statefulness does not. The one-shot deadband a zero baseline needs IS implemented,
because it is derivable in-window. The small tracked change-log is a **new write
path**, so it stays owed to a `security.sec` position (D24, D27); the consequence
is that config-derived measures have no trend, which the renderer enforces rather
than fakes. Acknowledgement stays deferred, as ruled.

**Evidence:** `src/metrics.mjs` (pure), `metrics` in `cli.mjs`, notices through
`computeAttention` with `scope` added alongside `seat`; `demo/metrics.test.mjs` is
the 21st demo. Measured cost of the shared scan: 0.9â€“1.4 ms for 14 seats Ã— 24
entries against `watch`'s 750 ms poll, so the ambient tier adds arithmetic and no
I/O. Live reading is in `docs/MVP.md`, "measure drift instead of listing
concerns".

## D29 â€” One distribution, and extensions chosen by workflow (2026-10-11)

**Question (operator):** should durig ship as two editions (`durig-core` and
`durig` with recommended extensions), or one system with well-considered optional
extras â€” and is the feature set bloated with things only some users want?

**Decision (operator, ruled):** **one distribution, no editions.** Extensions are
chosen one at a time against the workflows we intend to support, and the workflow
frame (`docs/WORKFLOWS.md`, ROADMAP item 21) is what decides "recommended" rather
than taste.

**Why editions are the wrong shape.** An edition is an artifact to build, publish
and forget; a profile is *data*. Two editions means two test surfaces, and our own
evidence is that the untested one rots: a committed converter fixture that crashed
on contact was cited as proof by three documents, including an acceptance item
marked PASS. `durig-core` would have been exactly that path. So: one artifact, one
suite, and `core` / `recommended` / custom as configuration (ROADMAP item 18).

**The cost model, because it decides the balance question.** For durig the burden
of an unused feature is *not* disk and *not* speed â€” the per-seat scan is 0.9â€“1.4
ms. The binding costs are: (a) **prompt tokens on every request**, (b) **which
tools the model sees**, which changes seat behaviour rather than just the bill, and
(c) the test and documentation surface. So the standard is stronger than "not
bloated": **a feature that is off must cost nothing at all** â€” lazy, declared, and
invisible until enabled. That is also why "useful for most users" is the right bar
for a default and "useful for some" is fine for an opt-in, provided it is truly
inert when off.

**Consequence for how extensions are declared.** Each one declares its own cost
(prompt tokens, tools added), its default, and its blind spot â€” the discipline
`check` and `metrics` already follow, because a declaration that travels with the
thing is the only kind that stays true.

**Not decided:** which workflows define "recommended" (blocked on item 21), and
which extensions those are. Caveman is far from the only candidate.

## D30 â€” The security positions that came back (2026-10-11)

**Context:** three items were put to `security.sec` as one consult, because the rig
daemon had been down 2026-10-06 â†’ 2026-10-11 and they had accumulated: the scribe
seat (D27), caveman (ROADMAP item 20), and the measurement change-log debt (D24).
Full position: `docs/reviews/security-sec-deferred-three-items.md`; the row is
`qitem-20261011052207-47265aa238cc43b5`.

**1. Scribe read-all-transcripts grant â€” FAIL as scoped â†’ adopt-with-conditions.**
The decisive reasoning: every seat runs as the **same Windows user** (D-ENV-AUTH),
so "never copy a secret out of a transcript" is a norm, not a control, and the
scribe would read seven seats' transcripts including `devtools.dev`, which handles
credentials. Required before it goes live: a fail-closed secret/PII gate on what
may be republished that a **canary can falsify**, plus an explicit republish
allowlist. Its stated cheaper alternative: drop the `devtools.dev` edge. This is a
scope-vs-security conflict, so it escalated to `advise.lead`
(`qitem-20261011052428-c1e0716d`, urgent, `gate:spec-review`), and **the security
dissent is preserved** if the conditions are skipped. Nothing has been applied to
the live rig, so this gates the first application rather than a rollback. Ordered
as ROADMAP item 1b.

**2. Caveman â€” split verdict, and the split is the useful part.** The **skill**
half (plain prompt text) **passes, conditional on being vendored as text rather
than installed**; it is ordinary persona content otherwise, needing no new
mechanism. The **proxy** half is **rejected as specified**: opt-out-by-default
telemetry is necessary but not sufficient, because the proxy reads raw tool output
(which carries secrets) and rewrites the model's view inside the call path. Its
conditions: the prior spike, a runtime **no-egress canary**, redaction, and role
scoping. So caveman is not one adoption decision but two, with very different
costs â€” which is why item 20 keeps them separate.

**3. The measurement change-log â€” ADOPT-WITH-CONDITIONS, and the debt is retired.**
`security.sec` prefers **git as the append-only record** over a new store write
path, because the write path would *add* a mutable, untrusted attribution surface
while git is already append-only and hash-chained. Its conditions: `metrics` must
report the committed active set and **flag a dirty tree**; git authorship is not
authentication; and D24's prediction record stays. This turns a deferred write path
(D24, D27, item 14) into a read-only reporting task.

**Standing consequence:** measurement may not add telemetry, egress or a write path
without this consult â€” and the answer here was "don't add one, use git", which is
now the precedent to cite rather than re-litigating.

## D31 â€” We dogfood durig on our own work (2026-10-11)

**Decision (operator):** run our own coordination through durig, not only through
OpenRig, so problems surface through use rather than through tests we wrote to look
for them.

**Why it is a decision and not a habit.** It changes where findings come from. The
first session produced six, and one matters more than the rest: a fact D24
recorded as *checked* â€” that entries carry no `usage` field â€” is false, and it had
propagated into ROADMAP's gap table, METRICS.md and item 20's "we cannot verify
caveman's savings". Ordinary use found it in one session; three documents repeating
it did not. That is the argument for dogfooding in one example.

**What it does not change.** It is not a substitute for the suite (D17's regression
gate), and it is not licence to ship rough edges: findings are logged in
`docs/DOGFOOD.md`, then fixed or backlogged like anything else. Seats still have no
file access, so dogfooding is scoped to coordination, queue semantics, attention,
measurement and the human views until item 4 lands.

**Evidence:** `docs/DOGFOOD.md`, findings F1â€“F6. F6 is deliberately positive â€” a
regression marker for the end-to-end path that worked (decompose â†’ route â†’ queue â†’
attention â†’ measure).

## D32 â€” Deferring is reversible, and the human is not a queue (2026-10-11)

**Decision:** a seat that cannot proceed parks the item it holds on a question
rather than guessing or going quiet. Two tools: `defer_work(itemId, question[, to])`
sets `status: deferred` and records the question and the expected answerer;
`resume_work(itemId)` puts it back to `claimed`. Omitting `to` defers to the human
operator and **enqueues nothing**; passing `to` asks a seat and enqueues the
question as real work, gated by the same org edges and capability rules as
`send_work`.

**Why deferring must be reversible.** An item parked with no way back is a silent
death, which is strictly worse than the prose it replaces â€” at least prose can be
read. So `claimed â†” deferred` is a cycle, not a one-way exit, and `complete_work`
still refuses a deferred item (you must resume first) rather than letting a seat
finish work it said it could not do.

**Why the human is not a queue.** There is no seat named `human`, and creating one
would be a lie: the operator does not read the queue, they read `status` and
`watch`. So a human deferral produces an attention notice
(`deferred_awaiting_answer`) and no queue item, and `DEFERRED_TO_HUMAN` is a
distinct value from a seat name so a renderer can say *a person* is the blocker.
This is the concrete form of a rule worth keeping: never let a machine launder a
human decision into seat-to-seat traffic, where it would look answered.

**Why a deferral is treated as a send.** The obvious shortcut â€” route the question
without consulting the edge gate â€” would hand every seat an unlogged channel to
any other seat, which is exactly what restrictive-by-default edges exist to
prevent. It is checked *before* any state changes, so a forbidden question cannot
leave an item half-parked.

**Reported, not inferred.** MAST puts "no reason to defer to humans" at 6.8%.
The notice is the mitigation: a parked item is durable state, so it survives the
run that created it and is visible without anyone asking.

**Evidence:** `demo/defer.test.mjs` (parks, is visible, resumes, asks a seat, is
edge-gated, refuses a foreign item), `demo/watchview.test.mjs` (parked rendering
and the footer count). Falsified by disabling the edge gate and watching it fail.

## D33 â€” What we take from the pi-durable demos, and what we decline (2026-10-11)

**Decision:** the two example projects the Pi Durable post points at were reviewed at
durig's pin (`docs/REVIEW-pi-durable-demos.md`). Adopt: harness settings and
`harness.resume()`; per-conversation extension scoping together with the recursion
hazard; submission `requestId`s; durable task phases with checkpoints and conversation
ownership; structured tool results (`api.details`); render coalescing. Decline, with
reasons: the TUI, a session picker, the in-process view subscription, and prompt
tool-sections generated wholesale.

**The review immediately found a defect in our own code**, which is why it was worth
doing: `defer_work`/`resume_work` shipped in D32 while the `PROTOCOL` primer kept
describing four tools, so no seat in the real CLI was ever told it could defer. The
feature was unreachable outside the test that drove it directly â€” a green suite over a
dead feature. The demo's `prompt.ts` is the reason it was visible: it builds the system
prompt *from the active tool set*, so a tool cannot exist undocumented. durig's
hand-written primer makes that drift inevitable.

**Why the declines matter as much as the adopts.** Most of the demo architecture
assumes one process owns the model runtime, the harness, storage and the UI. durig is
multi-process by decision (D11, D12, D22), so its view subscription is in-process and
cannot replace durig's cross-process poll, and its TUI would need a `pi-coding-agent`
dependency durig deliberately does not have. Recording the declines is what keeps a
future reader from re-litigating them or mistaking a considered no for an oversight.

**Where durig is ahead, stated so the gap list is not read as failures:** cross-process
coordination; org-edge and capability authorization (the demos have no authorization
layer at all); a constitution the store must be checked against; measurement, attention
and a linter; an appended queue audit trail; refusals as first-class output; and
dead-pid lease evidence rather than a 10-second staleness timeout.

**Evidence:** `docs/REVIEW-pi-durable-demos.md` (ideas, gap table, patterns, hazards,
and the "does not transfer" boundary), ROADMAP items 24â€“25 with 24aâ€“24g,
`demo/primer.test.mjs`, and the falsified primer regression.

**Correction (2026-10-11), same day: two of the gap claims in that review were wrong.**
It said durig "has no stream timeout, no retry policy, no compaction config" and
"never calls `harness.resume()`". Checked against the platform: `resolveSettings`
supplies retry/compaction/progress/queue-mode/context-retention defaults; the `openai`
SDK supplies a 600000 ms timeout and 2 retries; and `cli.mjs` **already calls**
`resume()`. The failure mode is worth more than the fix â€” the demo's source was read
carefully while durig's own side was described from memory, which is how a review
manufactures gaps. Only the *knob* was real (`stream` has no default), and
`DURIG_STREAM_TIMEOUT_MS` now reaches `Harness.open`. Corrections are marked in place in
the review rather than edited away, because a silently corrected finding teaches nothing.

## D34 â€” A request id is caller-supplied, and the answer pointer beats the watermark (2026-10-11)

**Decision:** `send` accepts an optional `--request-id`. A duplicate id reuses the
existing submission (the platform's `admitSubmission` returns the existing id when
`submissionByRequest` finds one), so a retry generates nothing and returns the original
reply. The id is **never derived from the prompt text**. When an id is supplied and the
answer already existed before this invocation, the reply is read from the submission's
own answer pointer; otherwise the watermark scan (F7) stays in charge.

**Why the caller supplies it.** An id means "this is the same request as before", and
only the caller knows that. Hashing the text would make two deliberate identical sends
collide into one â€” silent data loss, which is a worse failure than the duplicate it
prevents. The CLI is driven by LLM operators (D21) and `SENDEXIT=124` is a real outcome,
so "retry this same request" is a thing an operator needs to be able to say.

**Why the answer pointer is not a nicety.** The F7 fix resolves a reply by finding the
newest assistant entry *past* a watermark taken before the run, which is what stops a run
that produced nothing from echoing an earlier send's reply. A reused submission inverts
that assumption: its answer was committed *before* this invocation, so the scan finds
nothing and would report `reply: null` for a request that has a reply. With an explicit
id the submission is unambiguous, so its own pointer is authoritative. The two mechanisms
answer different questions and both are needed â€” identity when the caller provides it, a
watermark when they do not.

**Pattern worth noticing:** this is the third bug in the same family â€” F7, this reused-
submission interaction, and the 24a corrections. All three were about *reporting*, or
failing to report, a result that belonged to a different run. The settle/report path is
where durig's subtle defects live, and it deserves the suspicion a shared mutable
watermark naturally attracts.

**Evidence:** `demo/cli.test.mjs` (first use, retry with no second entry and the same
reply, a different id, no id at all, `--request-id` with no value, and no id leakage into
the prompt), falsified by dropping `requestId` from the submission and watching it fail
with `the retry must report that it reused the submission`.

## D35 â€” The workflows are named, so "recommended" is derived (2026-10-11)

**Decision:** `docs/WORKFLOWS.md` names five workflows â€” routed delegation, independent
verification, blocked on a question, intake/decomposition/tracking, human oversight â€” plus
the operator loop for a rig change under measurement. Each states **who**, the trigger,
the **loop that must never break**, what **done** means in observable state, and the
capability it needs. These loops were implicit across the MVP bar, the feature inventory,
the gap table and `RESEARCH.md`; now they are in one place and each can be argued with
individually.

**What it settles.** Two things, and neither was the document's stated purpose.

1. **"Recommended" is mostly rig shape, not extensions.** Every workflow is served by
   the Router â€” one extension â€” so what separates a rig that works from one that does not
   is the seats, their models and their edges, which is precisely what `check` already
   fails a rig for. Item 18's profiles should therefore be a preset rig file plus a seed
   list, not a bundle of extensions a user must reason about, and the first genuine
   opt-in candidate is retrieval (item 4, an operator ruling rather than a default).
2. **D21, D22 and D24 were workflow decisions, not architecture decisions.** The roadmap
   flagged them as taken ad hoc; the workflows give each a reason. D21 is W5 plus the
   operator loop â€” an interactive prompt would be a blocking gate inside W1's
   must-not-break path. D22 is W1â€“W4 â€” a seat is a queue participant, and the unit of
   attention is the rig's state rather than a seat's screen. D24's must-not-break is the
   baseline-before-change rule.

**Why "must-not-break" is the load-bearing field.** A workflow can be slow, awkward or
verbose and still be worth running; these are the failures a person cannot recover from
by noticing. Writing them down also forced an unwelcome one to the surface: **W2 is not
fully supported.** Verification holds today only for artifacts a reviewer can read in a
transcript, because `complete_work` carries a `resultSummary` claim rather than evidence.
That is item 4 (M3), and it is a limit on what the tutor rig can be trusted to do, stated
where the workflow is rather than in a footnote.

**Evidence:** `docs/WORKFLOWS.md` (the workflows and the capability matrix),
`docs/ROADMAP.md` item 21, and the demos each workflow cites.

## D36 â€” A workflow advocate owns the workflow set, and labels its provenance (2026-10-11)

**Decision (operator):** the rig gains a `workflows` pod with one seat, `advocate`
(`openrig/rigs/tutor-pi/agents/advocate`). It advocates for the people who use durig,
owns `durig/docs/WORKFLOWS.md` and its workflow set, questions any durig change for
workflow impact, and collects feedback. Rig: 15 seats / 10 pods, regenerated spec.

**Why a new pod rather than an existing seat.** `design.ux` already exists and might look
like this role, but it owns the *tutor's* learner-facing surface (math legibility,
accessibility, honest states) â€” a different product with different users. `scribe` owns
the feature inventory: what durig *does*. The advocate owns what durig is *for* and who
uses it. Three different documents, one concern each, and the same reasoning D27 used to
give `scribe` its own pod.

**The hard part, and the operator named it:** how does a persona collect feedback from
users of a workflow when it may not have any? The answer is to **label provenance rather
than guess**. Every workflow carries one of three classes, permanently:

- **observed** â€” we ran it (a dogfood session, a demo, an operator report)
- **advertised-elsewhere** â€” a competing platform documents supporting it, which makes it
  a *candidate*: the workflow is real, but nobody here has asked for it
- **inferred** â€” reasoned from our own design, labelled as reasoning

**The first honest scoreboard is uncomfortable, deliberately.** Of the five workflows plus
the operator loop, only one (W4, intake/decomposition/tracking) is `observed` in a **live
multi-seat run**, because seats still cannot do real work (item 4). W1 is observed via a
dogfood finding and the walkthrough, W5 and the operator loop are observed through
everyday use, W3 is observed offline only â€” no live item has been deferred yet â€” and W2
is **inferred**, since its evidence half does not exist. Writing that down is what stops a
plausible workflow list from reading as a satisfied user base.

**Inventing a user is the cardinal sin here.** A fabricated citation misleads a reader; a
fabricated user need *moves design*. So the role doc forbids it explicitly, and the
practical substitute is that feedback has exactly two real sources today â€” the operator's
reports and our own dogfood findings, both already recorded â€” plus roadmap item 26 for
widening the candidate set from competitors' advertised workflows.

**Edges follow one rule**, as D27's did: the advocate reads and questions the seat that
builds durig (`dev`) and the seats whose *work* durig's workflows govern (the build seats,
where delegation and pair review actually run, so their friction is the feedback signal);
it collaborates with `scribe` and `pm` as the adjacent owners; it escalates scope
conflicts to `lead`; and it assigns no work. It deliberately does not observe the content
producers or `sec`.

**Immediate evidence the rig agrees:** `check` against the live store now reports
`store-missing-seat: scribe, advocate` â€” seat drift found by the rule built yesterday,
which is exactly the class of thing that used to be invisible.

**Evidence:** `openrig/rigs/tutor-pi/{rig.yaml,agents/advocate/**,guidance/pod-workflows.md,workflows-pod.fragment.yaml}`,
`durig/rigs/tutor-pi.rig.json` (15 seats / 15 edge groups, 0 converter warnings),
`docs/WORKFLOWS.md`'s ownership section.

## D37 â€” Long context is a measured durability concern, and a fresh session is not a deletion (2026-10-11)

**Decision (operator):** `docs/Managing_Long_Context_Length.md` is taken as the basis for a
new roadmap section (items 27â€“30). Three research findings become durig decisions rather
than notes in a digest:

**1. Context pressure is a measure, not new instrumentation.** A seat is a pi-durable
conversation created at `up` and reused for every `send` (`src/rig.mjs`, the Seats doc), so
its context is durable state that nothing watches. It is measurable with **no new write
path**, because stored assistant entries already carry `usage` (`input`/`output`/`cacheRead`/
`cacheWrite`) and a `cost` breakdown through `storage.scanEntries` â€” the F4 correction that
made the cost measure direct-class. So it extends item 2's token counter and feeds
`computeMetrics`; D24's rule applies unchanged, and a *stored* pressure value would be a new
write path needing a `security.sec` position first.

**2. The trigger is per-model and must be measured, not inherited.** The evidence separates
the *mechanism* (a property of the agent design) from the *threshold* (per model), and
shipped defaults (~90%) sit later than the research recommends (~60â€“70% of the **effective**
window). Two constraints follow, and both are honesty rules rather than preferences: a
percentage-of-window reading taken against an **advertised** window is false precision and
must not be printed as though it measured usable capacity; and where the harness records
nothing, the honest output is a **declared blind spot** rather than an inferred signal â€” the
same rule `metrics` already follows when it refuses to judge what it cannot see.
*Checked against the pinned source rather than assumed:* here it **does** record something.
A `pi.compaction` entry carries `reason âˆˆ {manual, threshold, overflow}`, so a compaction is
observable and attributable rather than a blind spot, and the platform also exposes manual
`Conversation.compact(instructions?, context)`. The unmeasurable part is not the event but
the *effective window*, which is a property of weights and therefore takes a measurement.

**3. A fresh session is a new conversation, never a deletion.** There are two ways to reduce
a seat's context and they are different operations: compaction summarizes in place and
leaves a summary that can be pointed at, while a fresh conversation drops the history
entirely. The platform provides the first â€” `Conversation.compact()`, recorded as a
`pi.compaction` entry with `reason: "manual"` â€” and durig exposes neither (`USAGE` lists
eleven commands; `up --refresh` re-applies the prompt without touching the conversation).
The design's main risk, and the reason a fresh conversation is the *expensive* lever, is
that a seat's conversation **is** its
working memory of the item â€” a naive reset silently loses the task, which is the
literature's summary-induced amnesia and "drops the reasoning, keeps the surface action"
failure modes. Two invariants therefore bind it: what is carried across must be *defined*
(the stored persona, and any item the seat has `claimed`), and the previous conversation is
**retained** â€” transcript destruction is a named failure mode and a transcript is exactly
what `log`/`watch` read (D-view). A fresh session adds a conversation; it never removes one.

**Why it lives in `FEATURES.md`'s durability section and not observability:** the fact being
managed is that a seat's state accumulates, which is a property of the seat. The display is
the delivery, not the concern.

**Honest state, recorded so the advert cannot drift:** compaction is inherited and
**unexposed** rather than chosen and managed â€” the mechanism and its record both exist, and
the verb does not â€” and there is no pressure measure and no fresh-conversation verb. Item 30
is the standing obligation to move `FEATURES.md` section 5's rows from "inherited" to
"managed" as 27â€“28 land, with the proof column pointing at a demo rather than at prose.

**Evidence:** `docs/Managing_Long_Context_Length.md` (the survey), `ROADMAP.md`
("Long-context management", items 27â€“30), `FEATURES.md` section 5 ("Context growth over a
seat's life"), and the F4 correction above (entries carry `usage`). The claims in 27â€“28 about
what the harness records and exposes were read from the pinned source under
`vendor/pi-main/packages/durable/src/` (`entries.ts`, `harness/types.ts`,
`harness/compaction.ts`), not inferred from the research digest.

## D38 â€” Full shell accepted; the guard is durig's to build, not pi's (2026-10-11)

**Decision (operator).** Verbatim: *"If the seats are using pi-warden extension to protect us
from dangerous tool-calls, I can accept a level of risk with using full-shell initially while
codemode with permissions is developed."* Scope answer = **(a) full shell**, with the M3
conditions SC1â€“SC3 still required and codemode-with-permissions as the follow-on mitigation.

**The premise is false, and the record must not rest on it.** durig seats do **not** get pi's
guards. Three mechanisms exist in the operator's pi and none of them reaches a seat:

- `arg-guard.js` is a **pi-coding-agent** extension â€” `pi.on('tool_call', â€¦)`
  (`~/.pi/agent/extensions/arg-guard.js`). durig loads **pi-durable** extensions only; durig's
  own loader says so at `src/extensions.mjs:17`. It also repairs *malformed arguments* rather
  than policing dangerous ones, so it was never the control this decision assumed.
- `guardrails.json` configures `@aliou/pi-guardrails` (path access, a permission gate, patterns
  such as `rm -rf`, `sudo`, `dd of=`, `mkfs.`, `chmod -R 777`). Also pi-coding-agent.
- The harness durig opens passes **no `hooks`** at all (`cli.mjs:241` passes only
  `{models, registry, settings}`), and `HarnessOptions.hooks` exists to carry them
  (`types.ts:356`).

So at the moment of acceptance the risk was backed by **nothing**.

**What the acceptance therefore requires.** A durig-side guard is a precondition, not a
nice-to-have. `ToolHooks.beforeTool` (`types.ts:745-752`) can block or rewrite a call, throws as
blocking, and sees nested calls through `ToolCall.parent` â€” strictly stronger than `arg-guard`.
It must land **with** the tools, never after them.

**Risk accepted, stated so it is bounded.** Full shell for author seats means arbitrary code
execution as this OS user *inside a path-confined worktree*. Residuals accepted knowingly: a
command-string allowlist is unsound under PowerShell (so the allowlist only narrows; the
`ExecutionEnv` is the boundary); a seat may defeat confinement by editing what it runs; and the
shared-identity problem `D-ENV-AUTH` remains.

**Not accepted, and not implied: unconfined filesystem access.** Without SC1 a seat can read
`durig.config.json`, `~/.pi`, and `~/.ssh` â€” credential disclosure, not "a level of risk". SC1 is
therefore treated as **required, not waived**, and the same goes for SC2 (the verifier's
read-only must hold at the filesystem layer, since a shell can write regardless of which tools
it is offered).

**Recorded at the operator's direction and quoting them verbatim.** `security.sec` requires a
non-forgeable operator artifact for a risk acceptance (D-ENV-AUTH); this entry is written by the
operator's assistant on their instruction, which is the strongest artifact this workflow
provides. If it must be genuinely non-forgeable later, re-issue it as an operator-authored
commit.

**Effect on the position:** `security.sec`'s dissent is preserved for the residual shell risk
(`docs/reviews/security-sec-m3-seat-tools.md`); SC1â€“SC3 are **adopted**, not skipped.

## D39 â€” The driver probes seat documents through a raw handle, because a harness session fails closed (2026-10-12)

**Decision:** before waking a candidate seat, `run` probes that seat's `pi.live`
document through a **raw storage handle**, not through the driving harness. A seat
whose document cannot be materialized is reported (exact error and path) and
skipped; the remaining seats are still woken, and the next pass re-probes it.
`driveOnce` also keeps a per-wake guard as a second line of defence.
**Rationale:** pi-durable fails a **whole Session** on its first storage error
("Session failed after a storage error; close and reopen it"). The DOGFOOD F14
corruption (`pi.live` with an empty base and orphaned appends) therefore killed
`run` before any wake was delivered, and catching the `PathError` per wake was not
enough: the bad seat poisoned the session, and every healthy seat after it failed
too. A raw storage read throws the same `PathError` **without failing any
session**, so the unreadable seat can be excluded before the harness opens it.
**Alternatives:** (a) repair the producing op / rewrite the corrupt base on read â€”
rejected: a new write path, and #110 forbids one; (b) catch per wake and reopen
the harness â€” rejected: the bad seat still poisons the session before the healthy
seats are reached, so no work advances; (c) fix the producer inside vendored
`pi-main` â€” out of scope (pinned vendor, synced by `sync-pi.mjs`). **Status:**
adopted. **Evidence:** `demo/driversurvive.test.mjs` reproduces the exact failure
failing-first (`unresolvable path: ["generation","message","content",0]`, exit 1
against the committed driver) and passes after; full `demo/*.test.mjs` loop 40/40.

## D40 â€” The interactive client's data layer is separate from its screen, and a partial is not a turn (2026-10-13)

**Decision:** build the interactive client (M4) on a **pure view model** and a
**single read-only read API**, and keep the in-flight partial out of the
transcript model entirely. Concretely:

- `src/viewmodel.mjs` derives turns, collapse state, and the peer navigation graph
  as pure functions over entry/queue records. The peer graph keeps **direction**
  (`sent` vs `received`), because org edges are directional and collapsing them
  would discard the permission the graph exists to show.
- `src/readapi.mjs` is the one importable reader (`readSeatList`, `readQueueItems`,
  `readRigHealth`, `readLiveState`). It is read-only by construction â€” no harness,
  no write path (D11, D24). Config precedence stays in the CLI, so `readRigHealth`
  takes `cfg` rather than importing it.
- The in-flight partial lives in the conversation's `pi.live` document and is read
  as a value (`partialView`), rendered through its own distinctly-labelled path
  (`formatPartial`), and **never** emitted as an entry. It is uncommitted, may be
  rewritten between polls, and is deleted when the run settles; treating it as a
  turn would let transient text replay as history.

**Rationale:** D21 deferred the screen but named the data it required. Building the
data layer first is what makes the TUI-vs-browser choice a presentation decision
rather than a rewrite, and it improves the existing `log`/`watch` on the way. The
partial rule is the load-bearing safety property: a follower must be able to say
"streaming now" versus "committed", and a crashed driver must leave no half-line
that a later reader mistakes for the reply.

**Alternatives:** (a) render the partial as a normal entry â€” rejected: it would be
indistinguishable from committed history and could be replayed after a crash;
(b) keep the peer graph inside the CLI â€” rejected: any client needs it, and D21's
whole point is one implementation; (c) choose the TUI now â€” deferred: the screen
is still the operator's call (STATUS.md, "Decisions needed", #2).

**Status:** adopted; the screen choice remains open. **Evidence:**
`demo/viewmodel.test.mjs` and `demo/livestream.test.mjs` (the latter falsified by
disabling the partial publication), full `demo/*.test.mjs` loop 49/49.

## D41 â€” A seat may claim a NAMED item, without weakening the held guard (2026-10-13)

**Decision:** `claim_work` takes an optional `itemId`. With no id it keeps the existing
oldest-QUEUED behavior; with an id it claims that specific item only if it is `queued` and
addressed to the caller. The eligibility whitelist is the **same** as the oldest-first path,
so a `held` (non-claimable) item cannot be claimed by id either.

**Rationale:** a queue whose only claim rule is "oldest first" cannot express operator
priority. On 2026-10-13 the PIECE-1 spike (#209) was the operator's explicit START-NOW, but ~20
older queued items sat ahead of it; the work was done via a direct `send` and could **not** be
marked done, because `complete_work` refuses a non-claimed item. `lead` ruled the fix (#214) as
claim-by-id, its own item rather than folded into the `held` state (#90).

**Alternatives:** (a) a priority-mark that reorders the queue â€” rejected: it only *moves* work,
it does not let an already-bypassed item be *recorded*; (b) fold into #90 â€” rejected: one
concern per change, and the `held` state is a different concern; (c) leave oldest-only â€”
rejected: it is the reported defect.

**Status:** adopted. **Evidence:** `demo/rearmclaim.test.mjs` (failing-first: a NAMED newer item
is claimed while an older item stays queued; a `held` item is refused by id), suite 50/50.

## D42 â€” Concurrent store writes on the send path are retried, not dropped (2026-10-13)

**Decision:** `send` wraps its store commit in a retry helper (`src/storewrite.mjs`), so two CLI
processes writing one store cannot silently lose a message to an entry-id collision. A write that
still cannot be delivered becomes a guided error, not the raw `ID n already belongs to entry`.

**Rationale:** running `send pm` and `send impl` concurrently made one exit
`{"ok":false,"error":"ID 10051 already belongs to entry"}` and the message was **never
delivered**. `genlock` serialises generation *slots*, not store writes, so nothing stopped two
processes allocating the same next entry id.

**Alternatives:** (a) a process-wide store lock â€” deferred as the heavier change; retrying the
observed conflict is smaller and sufficient for the reported case; (b) do nothing â€” rejected: a
silent drop is the worst outcome; (c) fix it inside pi-durable â€” out of scope (pinned vendor,
synced by `sync-pi.mjs`).

**Status:** adopted, with a known limit. **Limit:** only the `send` write path is covered;
`up` and `run` are not yet. **Evidence:** `demo/storewrite.test.mjs` (failing-first collision,
then retried/pass).

## D43 â€” `worktree` refuses a dirty source rather than forking a partial tree (2026-10-13)

**Decision:** `node cli.mjs worktree <path>` checks the source tree for uncommitted changes and
REFUSES, naming the offending path, when any exist. A clean source proceeds unchanged.

**Rationale:** an isolated worktree forks from HEAD. The operator's uncommitted direct work
(ROADMAP 7/8: `src/readapi.mjs`, `src/viewmodel.mjs`) was absent from the seat worktree, and a
seat's new `src/readapi.mjs` collided with the live 8.9 KB shared read API (#240). A seat cannot
see â€” and can silently clobber â€” work it never knew existed; failing loud at fork time prevents
it.

**Alternatives:** (a) carry the working tree into the fork â€” deferred: larger, and the shared
`node_modules` junction already makes installs hazardous; (b) warn only â€” rejected: a warning a
run proceeds past is the failure mode being fixed.

**Status:** adopted. **Evidence:** `demo/worktree.test.mjs` (failing-first: a dirty source
produces no silent HEAD-only checkout; a clean source proceeds).

## D44 â€” A corrupt `pi.live` is repaired by RETIRING its incarnation; a viewer must tolerate it (2026-10-14)

**Decision:** when a seat's `pi.live` document cannot be materialized (P5/#110:
`unresolvable path: ["generation","message","content",0]`), the repair is to **retire** the corrupt
incarnation (storage `document.retire`), so `readLiveState` finds no current document and reads it as
idle `{}`; the next run re-creates a clean one. Independently, a **viewer must never let one
unreadable document kill it** â€” `readLiveState` catches, warns once, and returns `{}`.

**Rationale:** `impl`'s conversation was wedged â€” `send` and `reset` both threw, and `stop`+`resume`
did not clear it. A chord root-replace delta `["r", {}]` did **not** reset the materialization base
(the orphaned append is still replayed), so it did not help; only retiring the incarnation removed the
corruption. The viewer rule is the same P5 principle the `run` driver already follows (probe, skip,
report) applied to `log --follow`/`watch`, which crashed on the corrupt seat.

**Alternatives:** (a) root-replace â€” rejected: it appended atop the orphan and still threw; (b) delete
or recreate the conversation â€” rejected: loses history and needs registry surgery; (c) hand-edit SQLite
â€” rejected: outside durig's storage API and the zero-durig-SQL rule.

**Status:** adopted. **Evidence:** `scripts/repair-pi-live.mjs` (run on conversation 9; `watch --once`
silent afterward, `reset impl` succeeded). A first-class `repair` verb is not yet built â€” a candidate
item.

## D45 â€” A resident broker reacts to in-process commits; D11's conclusion, not its evidence, is superseded (2026-10-14)

**Decision:** durig gains a **resident broker** (`serve`; the command name is the
lead's call and the operator overrode the gate to build it directly) that **owns the
harness** and reacts to the store's own **in-process commit stream**
(`Session.subscribeCommits`) instead of an external clock. On a wake-relevant
commit it runs the existing wake decision (`selectWakes`/`driveOnce`) through a
**scheduler** that coalesces changes into one pass and throttles by a global floor
and a per-seat cooldown. This **supersedes D11's conclusion** that only read-side
polling is permissible; it does **not** erase D11's evidence, which still governs
the read-only viewers.
**Why D11's evidence still holds:** SQLite has no cross-process change
notification, and a separate viewer that attached a harness would resume
scheduling and kick the queue it is meant only to observe. A single long-lived
process that *is* the harness has neither problem: the trigger is in-process
because writer and observer are the same process. Read-only viewers (`watch`,
`log`, `events`) keep D11's poll/read-storage rule unchanged.
**Boundary:** the broker adds **no socket and no new trust boundary** â€” the trigger
is an in-process callback and the broker only calls `conv.submit` through the
harness it already owns. Per the #238 gate, a `security.sec` position is required
**before code** only if a socket is added later; none is. The broker is the single
long-lived writer, so the cross-process write races of F24/D42 do not arise inside
it.
**No-wake-storm invariants** (PUSH-ARCHITECTURE Â§3.3, held by `src/scheduler.mjs`):
changes coalesce to one pass; a change during a pass marks the next pass dirty
rather than being lost; a global floor separates pass starts; a per-seat cooldown
stops a repeatedly re-woken stalled claim from hot-looping; the wake text stays
fixed (`WAKE_CONTENT`); an operator-stopped seat is never resurrected; a corrupt
`pi.live` never kills the pass.
**Numbering note:** this is D45. D40â€“D44 already exist on the operator's
integration line (D44 is the `pi.live` repair there), so the broker entry takes
the next free label rather than colliding.
**Status:** adopted (operator-directed). **Evidence:** `demo/scheduler.test.mjs`
proves the pure coalescing/floor/cooldown rules and wires them to a real harness
commit stream; `demo/run.test.mjs`, `demo/driversurvive.test.mjs`,
`demo/stalledclaim.test.mjs`, `demo/supervisor.test.mjs` stay green.

## D46 â€” `up` auto-starts the broker, TTY-gated; at most one per database (2026-10-14)

**Decision:** `up` starts the resident broker (D45) for an **interactive** run â€”
stdout is a TTY, the same rule the human views use (D19) â€” and never for a piped or
scripted one. `--serve` forces it on, `--no-serve` forces it off, and
`DURIG_NO_SERVE=1` is the script-wide opt-out. At most one broker runs per database:
the holder is recorded in `<db>.broker.json` (`{pid, since}`), mirroring the genlock
lease convention, and a second broker refuses to start. `serve --stop` reaps the
holder and clears the state; `run` refuses while a broker drives, because two
drivers double-wake (the driver's in-process guards cannot see another process).
**Why TTY-gated:** auto-start means spawning a detached daemon. Defaulting it on for
piped/scripted `up` would silently leak an orphan broker into test runs and CI, where
nothing reaps it. The interactive terminal is exactly where the operator wants the
queue to keep moving, and it is already how durig decides human-vs-machine output.
**Why a pidfile and not a socket:** the broker must outlive its launcher, and the
operator needs to see and stop it. A pidfile beside the database gives both without a
listening socket, which would be a new trust boundary and a `security` gate; it is the
same no-socket visibility pattern `genlock` uses for generation leases.
**Bug fixed here:** an unbounded `signal.wait(0)` held no ref'd handle, so Node
drained the event loop and a resident `serve` exited immediately (`unsettled
top-level await`). `createWakeSignal` now holds a keepalive interval while it waits,
cleared on signal/timeout â€” without it D45's "resident" claim held only for bounded
runs.
**Boundary:** the child is spawned with this command's `cwd` and `env`, and writes
only `<db>.broker.json` and `<db>.broker.log`. No socket, no egress, no new trust
boundary, so no `security` consult is triggered (consistent with D45).
**Status:** adopted (operator-directed). **Evidence:** `demo/autostart.test.mjs`
(`--no-serve`/piped opt out; `--serve` starts a broker that stays resident; `run` and
a second `serve` fail closed; `up --serve` is idempotent; `serve --stop` reaps it and
clears the state; the log shows no unsettled await); full `demo/*.test.mjs` 50/50.

## D47 â€” `revise_work` and `cancel_work`: the queue can be curated, and `cancelled` is terminal (2026-10-14)

**Decision:** add two Router tools and one terminal status.
- `revise_work(itemId, {subject?, body?})` â€” the item's **sender or holder** may update a
  **queued** (unclaimed) item; a claimed item is being acted on and refuses revision.
- `cancel_work(itemId, reason)` â€” either party may cancel a non-terminal item to a terminal
  `cancelled` status, recording the reason on the item.
- `cancelled` joins `done` as terminal, tested by one helper `isTerminalItem(item)`. Every place
  that used to test `status !== "done"` now uses it: `peek_queue`'s non-terminal view, `watchview`'s
  `routed`, and `supervisor`'s `applyEscalations`. The driver already ignores it (it wakes only
  `queued` items and stalled `claimed` runs).
**Why:** F36 â€” a triage of `selfdev.sqlite` found ~40 of 60 active items stale or mere bookkeeping,
and the queue had no move to cancel a stale item or edit an item's description. The only paths were
"complete it as if done" or let a seat grind it, and the resident broker (D45), waking oldest-first,
does exactly the latter. A queue that cannot be edited accumulates interred work.
**Bounds (why these two parties):** revision is limited to unclaimed work so a run is never changed
under the seat acting on it; cancellation is limited to the two parties so no third seat can
silently drop a routed item. Neither verb generates a notice â€” the transition and `cancelReason`
are the record â€” so cancellation cannot itself spawn queue traffic.
**Status:** adopted. **Evidence:** `demo/curate.test.mjs`; full `demo/*.test.mjs` 51/51.

## D48 â€” Recover the lost worktree, and make shared-tree safety structural (2026-10-14)

**Decision:** three things.
1. **Recover the lost tranche.** The repo split kept the worktree's COMMITTED work and lost its
   UNCOMMITTED work. Branch **`pi-rebase` (commit `3bf61b1`)** held it; each feature is adapted onto
   current `main` as a one-concern item (#307 claim-by-id, #308 worktree dirty-source guard, #309
   `held`+hold/release, #310 store-write retry, #311 event feed, #312 bounded `peek_queue`), plus F34
   (#299). Recover by ADAPTING onto current `main` â€” never by restoring a whole snapshot file.
2. **Shared-tree safety is structural-first.** Per-task git worktrees are the load-bearing isolation;
   the seatguard git-refusal is a NON-LOAD-BEARING backstop; seats get a documented failing-first
   recipe (run the test RED before the fix) so a revert is rarely needed. A regex denylist must never
   be the thing standing between a seat and the operator's uncommitted work.
3. **Per-worktree dependencies stay on npm** (`npm ci --prefer-offline`), not pnpm.
**Why:** the split lost uncommitted work while keeping commits; and the research
(`docs/Shared_Working_Tree_Safety_Research.md`) shows regex denylists miss 69-98.6% of bypasses for
their target operation and prompt-only rules demonstrably fail â€” a seat ran `git stash;` and wiped the
whole tree, and a Codex user watched `git restore` run after repeated "never touch git" instructions.
The earlier `node_modules` JUNCTION is the catastrophic pattern (git followed it and deleted main's
source); Git for Windows here is 2.42.0, below the 2.54.0 that fixed `git worktree remove` following
junctions. Measured: `npm ci --prefer-offline` = 12 s / 111 MB, and a fresh worktree ran the
committed suite 52-53; pnpm exited 1 on ignored build scripts.
**Status:** adopted (operator-confirmed: per-task worktrees; npm chosen after measurement).
**Evidence:** `docs/Shared_Working_Tree_Safety_Research.md`; suite 55/56; the per-worktree measurement.

## D49 â€” Phase 2 of the per-task worktree isolation, and the Job-Object helper (2026-10-14)

**Decision:** #330 Phase 2 landed as six one-concern items (#351â€“#356): worktree-per-task lifecycle
(create-on-claim, remove-on-complete/cancel, `git worktree lock` held while the item runs); a
per-worktree `npm ci --prefer-offline` (a fresh worktree is unusable until installed); git-identity
validation (`--show-toplevel` == the worktree, `--absolute-git-dir` != `--git-common-dir`, `.git` is a
FILE); rebase-before-merge + `rerere`; cleanup only via `git worktree remove`, refusing a dirty tree or
any junction; and Windows process-tree reaping via a Job Object with
`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, removing the worktree only after the tree is confirmed dead.

**Why:** D48 adopted per-task worktrees as the load-bearing shared-tree isolation; the seatguard regex
denylist is only a backstop. Windows has no SIGTERM, so reaping must be a Job Object; cleanup must never
be a recursive delete (stale `.git/worktrees` metadata) and must not follow the junction that Git 2.42
deletes through.

**Implementation note (why the helper is shaped this way):** Node exposes no native Job-Object API, so
`src/job-object.mjs` compiles a small C# P/Invoke wrapper at runtime with PowerShell `Add-Type`.
`JOBOBJECT_EXTENDED_LIMIT_INFORMATION` must be passed at exactly **144 bytes** with the limit flag
`0x2000` at offset 16; any other size yields `STATUS_HEAP_CORRUPTION` (0xC0000374) â€” the cause of the
first two failed attempts. This is a deliberate dependency to review at merge; a native addon is the
alternative if the helper proves too fragile.

**Status:** adopted (operator's pointer; delegate-driven). **Evidence:**
`demo/worktree-lifecycle.test.mjs` (19/19, exit 0), `demo/job-object.test.mjs` (exit 0), qa
verifications #365/#367/#369/#371/#373/#376 (PASS); `docs/Shared_Working_Tree_Safety_Research.md` Â§5.

## D50 â€” Commit authority moves to the developer (2026-10-14)

**Decision:** the seat that accepts a work item commits its OWN work to its item's branch;
the operator no longer integrates or commits it. Push stays operator-only: `git push` is still
refused unless the operator relaunches durig with `DURIG_ALLOW_PUSH=1`, which the delegate may
then use after committing the item work.

**Why:** D43/D48 were built on the assumption that the operator integrates/commits â€” the seat
produces files in its worktree and the operator folds them into the tree (that assumption is
stated outright in `src/confine.mjs`: â€œa seat produces files in its worktree and the operator
integrates themâ€). With per-task git worktrees now the load-bearing isolation (D48/D49), a
seat's commit is confined to its own item's branch, so the manual operator-commit step is a
round-trip that adds no safety. Commit authority therefore moves to the developer: whichever
seat accepts the item commits that item's work and keeps the history legible, preserving the
scoped-addition safety (explicit-path staging only).

**What is unchanged:** publishing (push) still requires operator authorization; the scoped-commit
safety stands â€” a seat stages only the explicit paths it changed (unscoped `git add -A` /
`git add .` remain denied), and destructive git (reset/checkout/restore/revert/clean/stash,
branch delete) remains refused.

**Supersedes:** the â€œoperator integrates/commitsâ€ assumption in **D43** (worktree refuses a
dirty source) and **D48** (recover the lost worktree), insofar as those entries assumed the
operator is the committer. The worktree-isolation guarantees those entries made are unaffected;
only the commit-authority assumption is replaced.

**Status:** adopted (implemented as 1a/1b/1e). **Evidence:** `src/confine.mjs` (the `git push`
denial is conditional on `unless: () => operatorGranted("DURIG_ALLOW_PUSH")`, and
`operatorGranted` reads `process.env[name] === "1"`); `constitution.txt` P2 Authority: â€œcommit
your own item's work and keep the history legible; never push or publish â€” the operator holds
push capability (grantable via DURIG_ALLOW_PUSH=1 to the delegate)â€; per-seat trailer and
`rig.selfdev.json`/`rig.starter.json` `constitutionInline` regenerated byte-for-byte to match
(#386). Docs changed: `docs/DECISIONS.md`. node --check N/A (docs only).

## D51 â€” The five Qwen seats move to `zai-org/GLM-5.3-Flash` (2026-10-15)

**Finding:** the operator asked to replace the Qwen family (`Qwen/Qwen3.6-35B-A3B`) with a cheaper
output-token model, naming a fallback chain: `XiaomiMiMo/MiMo-V2.6-Flash` â†’
`zai-org/GLM-5.3-Flash` â†’ `deepseek-ai/DeepSeek-V4.1-Flash`.

**Decision:** set the five Qwen seats â€” `impl`, `qa`, `advocate`, `auditor`, `designer` â€” to
`zai-org/GLM-5.3-Flash`, and apply with `up --refresh`.

**Why GLM, not MiMo or DeepSeek-V4.1-Flash:** MiMo has a documented past failure and was reverted â€”
it ran `impl` briefly (commit `f7eeb0a`), then `789ead6` returned `impl` to Qwen, and ROADMAP item 42
records "MiMo wandering" â€” so the chain's first branch triggers and MiMo is skipped. GLM's known
drawbacks (it ignores `cache_control`, ROADMAP item 18; a third-party vLLM long-decode report) are not
*worse* than DeepSeek-V4.1-Flash's documented degeneration into tool-call-as-text repetition loops
(commit `8b20832`), so the chain's second branch does not trigger. Model-family diversity for
independent verification is preserved: GLM (Zhipu) differs from the DeepSeek authors (`pm`/`lead`).

**What is unchanged:** the per-seat model is config, not code â€” no tool, schema, or write path changed.
`up --refresh` re-applies model + instructions + cwd; it does **not** write a context reset, so the five
seats run GLM over their prior Qwen history until `reset <seat>` is run (the contamination boundary the
operator may still choose).

**Evidence:** `rig.selfdev.json` (five `"model"` fields) and `node cli.mjs up rig.selfdev.json
--refresh` reporting all nine seats `refreshed`; `node -e "require('./rig.selfdev.json')"` parses and
lists no `Qwen`. No push.

**Status:** adopted.

## D52 â€” PIECE 3 corrected: the broker is a separate resident process that OWNS the session, so the socket path is live (2026-10-15)

**Context (correction, item #411):** the earlier registration of PIECE 3 (#238) carried a flawed
phrasing â€” recorded as "owns the harness in-process" â€” that let D45/D46 conclude "no socket, so no
security consult". #238 was cancelled and re-registered as #411 with the corrected architecture:
the resident broker is a **separate resident process** created via `pi.open`, and it **owns the
session lifecycle** (`waitForEmpty`/`sendMessage`), which is what `docs/PUSH-ARCHITECTURE.md` Â§3.2
always described ("one long-lived process that is the harness" = the session owner, not a second
viewer).

**Corrected rationale (supersedes the boundary paragraphs of D45/D46 where they conflict):** D11's
evidence is respected **because the broker is the session OWNER, not a viewer**. D11 proved SQLite
has no cross-process notification and that a separate *viewer* attaching a harness resumes
scheduling against the queue it observes. Neither objection reaches the session owner: the broker
injects events into a session it itself opened. Read-only viewers (`watch`, `log`, `events`) keep
D11's poll/read-storage rule unchanged, and nothing in this entry widens what they may do.

**Security (the gate that preceded this entry):** because the session owner is now reachable by
other local processes, the socket path is live and a `security` position was required **before
code**; it is recorded at
`docs/reviews/security-sec-broker-socket.md` (loopback-only bind; per-database user-only token
handshake â€” D30's D-ENV-AUTH finding means same-Windows-user is not a control; surface bound to
status/wake/subscribe; explicit non-goal: never general remote access; lifecycle cleanup binds to
the D46 pidfile). S1â€“S7 of that position are the acceptance hooks the implementation must falsify.

**What is NOT decided here:** the socket implementation itself stays gated on this position + a
failing-first demo proving the broker delivers a change to a waiting session it owns (separate
resident process, loopback-only). No socket code has landed; nothing observable changes for the
rig until it does.

**Status:** recorded as a GATE decision (position precedes entry, per the item's gate order). Not
yet implemented.

## D53 â€” Concurrency clarified: three layers, and only the store/harness is single-writer (CLARIFICATION, 2026-10-15)

**Clarification (records the lead's A1 statement; no new decision):** durig's concurrency is three
layers, and exactly one of them is single-writer, so "concurrency" is not what the single-writer rule
forbids. The rule is a **store/harness** rule, not a **files** rule.

- **Files â€” concurrent (intended).** Each seat edits its own per-task worktree; concurrent editing is
  the point, not a hazard, because the work is isolated and merged later (D49, `src/worktree.mjs`).
- **Generation slots â€” capped at N.** `DURIG_MAX_CONCURRENT_SEATS=N` leases N cross-process generation
  slots via `src/genlock.mjs` (D12); N concurrent seats may run, no more.
- **Store/harness â€” ONE writer per DB.** The store and its harness are single-writer: two `send`
  processes collided on an entry id and one message was silently dropped (dogfood F24); the `send`
  path retries (`src/storewrite.mjs`, #310/D42) but `up`/`run` are not covered, and two drivers
  double-wake (D45/D46).

**Sanctioned model:** **one broker (`serve`) owns the store and drives up to N seats, each in its own
worktree**; `run` refuses (and a second `serve` refuses to start) while a broker drives the same DB
(D46). Two drivers on one DB = NO. Genuinely independent drivers use **separate databases**.

**Why recorded:** the single-writer rule was repeatedly mis-read as "files cannot be edited
concurrently". Per-task worktrees make exactly that concurrent and intended; it is the store/harness
that is single-writer. This entry states the model the older decisions already imply so a reader does
not flatten the two.

**Status:** adopted (clarification; the model was already implemented). **Evidence:** `src/worktree.mjs`
+ `demo/worktree-lifecycle.test.mjs` (concurrent per-task worktrees, D49); `src/genlock.mjs` +
`demo/singleflight.test.mjs` (N generation slots, D12); `src/broker.mjs`/`src/storewrite.mjs` +
`demo/autostart.test.mjs` (one broker per DB, second `serve`/`run` refused) and
`demo/storewrite.test.mjs` (send-path store-write retry, #310/D42).


## D54 â€” HELD: a non-claimable queue state with one explicit release transition (2026-10-15)

**Decision:** a held queue state â€” non-claimable (the claim/wake predicates are whitelist-by-status, so a held item is never claimed and never woken for), entered by hold_work, left by exactly ONE explicit sender transition (
elease_work â†’ queued); no auto-release. A stale claimed item that cannot proceed is parked so the driver does not re-wake it, but nothing silently re-queues it.
**Why:** registered-but-not-ready work previously had to masquerade as claimable (a queue row that was claimed but could not progress), which the driver then re-woke repeatedly. held gives a parked item a real, non-terminal, unclaimable state (#86).
**Status:** adopted (recovered with the lost-tranche work, #309/D48). **Evidence:** the held/
elease_work tools and holderOf/status whitelists in src/rig.mjs; the held-not-claimable-by-id guard is D41.

## D55 â€” Coordinator read gap: option B â€” thin-context return keyed by read capability, not role (2026-10-15)

**Decision:** an over-threshold claim result travels per the seat's READ capability, not by role: a seat with NO read tool (pm/lead) gets the full body INLINE (inlineBody: true), because it cannot open a path; a read-capable seat gets the structured head + a path to cwd/.durig/<itemId>.md and reads the body back itself. Over the threshold the return is a DELIBERATE STRUCTURED SELECTION (id + path + the from/to/subject/status head), not a mid-body byte cut. F9 removals are untouched (a coordinator without read tools is not given read tools here).
**Why:** a path a coordinator cannot open is worse than a body â€” found live on #100, where pm deferred rather than guess; the capability-keyed fallback reconciles the thin-context borrow with #124 (lead #144 option B).
**Status:** adopted. **Evidence:** src/rig.mjs 	hinResultText + the claim_work caller passing { inlineBody: !hasReadTool }; demo/thincontext.test.mjs (over-threshold returns the path for a read-capable seat; small claims stay inline; I ran it, exit 0).

## D56 â€” Git state-mutation block at the guard layer (2026-10-15) â€” with a code flag

**Decision (as scoped):** state-mutating git is blocked at the GUARD layer (src/seatguard.mjs beforeTool, the same layer as the push refusal) for all seats; READ-ONLY git (status/log/diff/show/rev-parse) stays allowed, because a seat reverting committed code would silently diverge its worktree.
**CODE FLAG (contradiction â€” recorded rather than asserted blindly):** the decision as supplied listed commit and merge/
ebase among the blocked verbs. The CURRENT code does NOT block those: git commit is ALLOWED by design (D50 moved commit authority to the developer; demo/confine.test.mjs asserts "git commit is allowed"), and merge/
ebase are not in the deny list. What IS actually blocked (verified in src/confine.mjs DENIED_COMMANDS, and by demo/confine.test.mjs/demo/seatguard.test.mjs, both exit 0): 
eset, checkout, 
estore, 
evert, clean, stash, branch -D, unscoped add -A/add ., and push (push exempt only with the operator's DURIG_ALLOW_PUSH=1), plus the -C <path> forms. If merge/
ebase (and reverting commit) are intended to be blocked, that is a NEW change to request â€” it is not current behaviour.
**Status:** adopted for the code-true core (destructive git + push blocked, read-only allowed); the commit/merge/rebase clauses flagged as not code-true and NOT recorded as current behaviour.

## D57 â€” U7 poll-first: the interactive client stays poll-based; Level 2 resident server deferred (2026-10-15)

**Decision:** the interactive client's update path remains POLL-based; Level 2 (a resident server/push path) stays DEFERRED. A <=0.75 s poll meets "immediately" for TURN-based content (a turn is a coarse, slow event; pushing cannot meaningfully beat polling for it). Re-open Level 2 only on a DEMONSTRATED flow-breaking lag in actual use.
**Why:** smallest unblock â€” push adds a socket/trust surface and a resident server for events that arrive at turn granularity, where poll already lands in time.
**Status:** adopted (deferred Level 2). **Evidence:** the 750 ms poll loop in cli.mjs cmdWatch (setTimeout(r, 750)); demo/watch.test.mjs.

## D58 â€” Failure recovery vs diagnosis are TWO concerns: escalation in the supervisor, malformed-tool-call as one cause-class (2026-10-15)

**Decision:** escalation lives in the SUPERVISOR (src/supervisor.mjs planEscalations/applyEscalations), not the driver, surfaced as a 
epeated_failure notice; malformed_tool_call is ONE class defined by CAUSE (harness call-arg validation/parse), surfaced via the metrics count + a bounded notice, preferring a structured error kind. A diagnosis signal ADDS a signal only and never blocks the call.
**Why:** recovery (re-drive a stranded/held item) and diagnosis (why it keeps failing) have different owners and cadence; conflating them had a single mechanism trying to do both (#145).
**Status:** adopted (the supervisor escalation pass is code-true: attention.mjs emits kind: "repeated_failure"/last_run_failed, the supervisor plans and applies them). **Evidence:** src/supervisor.mjs, src/attention.mjs, demo/supervisor.test.mjs, demo/malformedcall.test.mjs.

## D59 â€” P6 quint model as a DECISION entry: formal assurance over the liveness invariant (2026-10-15)

**Decision:** P6 (quint model) is a DECISION entry â€” formal assurance over the already-found liveness invariant: "no non-terminal item is permanently unwoken". One property, stated and (once modelled) checked, POST-#118 (i.e. after the thin-context/claim contract that #118 half-2 established).
**Why:** the invariant is the property all the driver/broker wake rules protect; a formal model makes the assurance explicit and checkable rather than asserted in prose.
**Status:** recorded (decision to pursue the formal model; the invariant is ROADMAP item 42 / P6). Not yet implemented.

## D60 â€” Worktree automation: creation is a backlog item, cleanup stays manual (2026-10-15)

**Decision:** per-task WORKTREE CREATION is a backlog item â€” a --worktree <path|auto> flag with a deterministic path, which must NOT create an F12 cwd/DURIG_SEAT_ROOT mismatch window. WORKTREE CLEANUP stays MANUAL.
**Why:** safety â€” automated removal collides with the F8 junction hazard, MAX_PATH, and uncommitted work in the worktree; manual cleanup is where the operator can see what is being removed (#175, against D48/D49).
**Status:** decision recorded (creation flagged as backlog; cleanup remains manual). Partial automation to date is the #473 broker wake-path worktree (on-claim create / on-complete remove in src/broker.mjs); the standing --worktree CLI backlog item is separate and unchanged.

## D61 â€” TUI screen model: a scrollback/pipes-preserving screen; Level 2 resident server deferred (2026-10-15)

**Decision:** the interactive client's screen model is a MAIN SCREEN that preserves scrollback and pipes â€” it does NOT own an alternate screen (that loses scrollback and pipes, and is the worst-supported combination with tmux, consistent with D21/D22; no multiplexer). Level 2 (a resident server shared by >1 viewer / remote access / 38b) is DEFERRED.
**Why:** the client must not regress the piped/JSON contract or break a terminal multiplexer; the deferred Level 2 is gated on felt sub-poll latency, a second viewer, or a remote-access need that does not exist yet.
**Status:** decision recorded. C3 (src/tui/client.mjs - a headless renderTui/Frame, no storage/harness/driver import, proven by demo/tui-client.test.mjs, exit 0) is built; the U1 driver + ui.mjs entrypoint (#480) are now BUILT too - src/tui/driver.mjs and the root ui.mjs entrypoint exist, proven by demo/ui-driver.test.mjs and demo/tui-conversation.test.mjs - so the earlier "(not built yet)" note is SUPERSEDED. Not pushed.

**Layer-accurate correction (lead ruling #666, 2026-10-16) -- D61's "does NOT own an alternate screen" was over-strong.** It conflated two layers. The accurate statement:
- **Two layers.** (a) The **in-TUI frame rendering** (`renderTui`/`Frame`, headless-only in C3 `src/tui/client.mjs`) is governed by D61 -- it preserves scrollback and pipes at the painting layer. (b) The **entrypoint terminal handoff** (the U1 `ui.mjs` entrypoint) uses the ALT SCREEN -- it declares ``ENTER_ALT "\\x1b[?1049h"`` / ``LEAVE_ALT "\\x1b[?1049l"`` in `src/tui/restore.mjs` (lines 13-14) and wires the terminal via `createTerminalScreen`'s `screen.enter()` on start and a restore-once `screen.restore()` (LEAVE_ALT + cursor + raw-mode off) on EVERY exit path -- not a "driver's onCleanup" argument.
- **Residual, recorded honestly.** While the entrypoint holds the alt screen, scrollback is NOT available DURING the session -- it is restored on EXIT. So "preserves scrollback" is true ACROSS the session boundary and FALSE during it. Not papered over.
- **Direction (ruled).** ACCEPT the alt-screen entrypoint -- it is the conventional, correct handoff for a full-screen TUI (clean restore on exit, no scrollback pollution), and the properties actually required (D21: a separate non-interactive-cli entrypoint; D22: no multiplexer) are PRESERVED. The accurate statement is: "the entrypoint uses the alt screen for a clean handoff; scrollback survives the session boundary (restored on exit), not during the session." RE-OPEN only if scrollback-DURING-session becomes a hard requirement -- then the entrypoint's alt-screen use is itself revisited.
- **Optional note.** The in-TUI screen painting does NOT depend on the alt screen for its scrollback property; the handoff does.

## D62 â€” Doc-acceptance policy: every new capability carries its own doc acceptance (2026-10-15)

**Decision:** every new/changed capability carries DOC ACCEPTANCE in its own item â€” the docs/FEATURES.md row, verified by the item's partner-check (qa) â€” rather than a separate doc chore after the fact. Design/research reports ARE their own docs; decisions go to docs/DECISIONS.md with their WHY.
**Why:** a capability that ships without its provable doc entry is a silent gap; making acceptance part of the item closes it where the work is verified, and matches the scribe's project-level truth role (docs-ownership norm, SELFDEV/WORKFLOWS).
**Status:** adopted (this session's doc-gate items #390/#398/#401/#468â€“#471/#508/#540 follow it). Files: docs/SELFDEV.md, docs/WORKFLOWS.md, docs/FEATURES.md.

## D63 â€” Broker lifecycle is an append-only audit log (2026-10-16)

**Decision:** `<db>.broker.log` records `START pid=<pid>` when the wake loop begins, and
`EXIT pid=<pid> reason=stop|signal|max-duration|max-passes passes=<n>` before it returns.
**Why:** `stoppedBy` reached stdout only, so once the process was gone the log could not answer "why
did the broker stop?" â€” a `serve --stop` was indistinguishable from a crash or a bound. A `START` with
no matching `EXIT` now means an abnormal death (a kill or a throw), because the EXIT line is written
synchronously before the loop returns.
**Status:** adopted; commit `484a571`; proof `demo/broker-log.test.mjs` (RED then GREEN) and
`demo/broker-cooperative-stop.test.mjs` (asserts `reason=stop`).

## D64 â€” Degeneration guard: the broker auto-resets a seat whose run outgrows its bounds (2026-10-16)

**Decision:** the broker's supervise pass assesses each seat's CURRENT run (entries above the last
`pi.user` wake) and, when it outgrows a conservative, operator-tunable bound (tool-turns / context
tokens / step-repetition / malformed tool calls), writes the EXISTING reset boundary via
`conversation.reset`; the next wake re-anchors the seat from its durable instructions.
**Why:** durig MEASURED `step-repetition` and `malformed-tool-call` but nothing ACTED on them, so a seat
could loop for hours (F29; seen live when `impl` degraded to word salad and wrote junk files).
Idempotent (a page already ending in `pi.reset` is skipped); judged per RUN, so an old degenerate run
behind a wake does not reset forever; bounded, not destructive (the transcript is durable). It resets
BETWEEN runs â€” a mid-run cut is a recorded residual gap, not part of this decision.
**Status:** adopted; commit `ae96445`; pure detector `src/degeneration.mjs`
(`demo/degeneration.test.mjs`), action `planResets`/`applyResets` in `src/supervisor.mjs`, wired in
`cli.mjs` `superviseOnce`.

## D65 â€” The broker's pass wait is scoped to the seats it woke, and ends on a commit (2026-10-16)

**Decision:** `drivePass` no longer calls `harness.waitForIdle(context)` (which resolves only when
EVERY ownerless conversation is idle). It waits only on the conversations THIS pass submitted a wake
to, and when the loop supplies its commit signal it races that wait against the next wake-relevant
commit, so a pass ends as soon as a run settles or new work lands. The F11 invariant is preserved by
one global `harness.waitForIdle(context)` drain at `runWakeLoop` exit â€” the single place it belongs â€”
so the harness is never closed with a live run. `createWakeSignal` gains `race(promise)`, which drops
the losing side (a leaked keepalive per pass would accumulate).

**Why:** the global per-pass wait parked the whole loop on the slowest run, so a seat that settled
early was not re-woken for its remaining queued work until the last run finished â€” `status` showed
idle seats with queued work while one run was in flight (observed live: `PASS 5` at 02:26Z, then no
`PASS 6` for ~58 min; a `serve --stop` requested at 02:29Z could not be honoured). The wake-relevant
commit stream (src/scheduler.mjs) already tells the loop exactly when a submission settles or the queue
changes; the pass wait must not ignore it. Measured effect: a cooperative stop under load settles in
~1.8s where the notes recorded multi-minute blocked passes.

**Status:** adopted; commit `b81e171`; proof `demo/broker-liveness.test.mjs` (RED: 1 fast wake in 2s â†’
GREEN: 2nd wake ~27ms in while the other seat still generates), plus `PASS <n> ms=<dur> woke=<a,b>`
per-pass observability in `<db>.broker.log`. Whole `demo/*.test.mjs` suite green (81/81). The
`idle_with_queued_work` notice is unchanged; a distinct "queued work, no live lease, aged" notice is
still a recorded follow-up, not part of this decision.

## D66 â€” The workspace switch is a seat tool, not a process-global broker root (2026-10-16)

**Decision:** a seat prepares its own workspace by calling `prepare_workspace` (a `SeatTools` tool)
after `claim_work` and before any filesystem work. It creates the item's isolated git worktree at
`<root>/item-<id>` and persists THAT conversation's cwd to it with `configure`; `makeSeatEnv` resolves
a seat's own prepared cwd FIRST, falling back to `DURIG_SEAT_ROOT` only when no workspace was
prepared. The broker no longer creates a worktree or sets `DURIG_SEAT_ROOT` in `drivePass`.
`complete_work` retires the workspace with `force:false` (a dirty worktree is refused, never
discarded) and resets the cwd to the shared tree. The constitution instructs every seat to call the
tool before filesystem work.

**Why:** the old wiring created ONE worktree per pass for the FIRST queued seat and applied it
through a process-global variable, so every seat woken in that pass shared one root and the
worktree's life was tied to the pass, not the item claimed. That is not the per-seat isolation
D49/D53 promise; it leaked and nested worktrees (`item-1`, `item-2`), and a seat could be pointed at
a tree it never claimed. A tool call keyed to the claimed item puts the lifecycle where the claim is,
names it in the seat's own context, and makes the switch per-conversation (durable via the persisted
cwd) instead of process-global. Idempotent reuse closes the #506 recursive-carry path. The workspace
root is now gitignored (`/item-*/`).

**Status:** adopted (commit adding this entry); proof `demo/prepare-workspace.test.mjs`
(create â†’ idempotent reuse â†’ per-seat cwd beats `DURIG_SEAT_ROOT` â†’ remove), amended
`demo/seattools.test.mjs`, and the full suite green (82/82). OPEN (operator-raised, delegate-owned):
whether per-seat worktree isolation should be on by default, opt-in, or opt-out â€” a consult to the
`advocate` seat and competitor research are in flight; this decision records the MECHANISM only, not
the default.

## D67 â€” Per-seat workspace isolation: the advocate's default recommendation (2026-10-16, RECOMMENDATION)

**Recommendation (advocate, recorded as SA-13 in docs/SELF-ADMIN.md):** make per-item workspace
isolation the DEFAULT, not advisory â€” conditionally ON by default when the workspace is a git repo;
the file/write/edit/shell tools FAIL CLOSED with a model-readable "call `prepare_workspace(itemId)`
first" until the conversation has a recorded workspace; outside a git repo `prepare_workspace`
succeeds trivially (records the cwd and states isolation is off) so a first-run rig never dead-ends;
an opt-out knob for operators who want direct-to-live editing. Reads may stay open or be gated
(designer's call). Advisory-only is the one answer the advocate rejects.

**Why (advocate's evidence):** `makeSeatEnv` falls through `target.cwd ?? DURIG_SEAT_ROOT ??
fallbackRoot`, so an unprepared seat silently works in the shared tree; prompt-only constraints
demonstrably fail (D48's stash incident, F9, F23), and the denylist misses most bypasses. Default-ON
with a git-repo condition serves both the newcomer (no silent live-tree write) and the solo operator
(review-before-merge becomes `git diff main..item-<branch>`).

**Two conditions before the gate lands (advocate's dissent-with-reason):**
1. **Verifier-artifact path first.** A verifier's worktree forks HEAD, but the author's artifact is on
   the item's branch (D50). Unless `prepare_workspace` for a verification item can base the tree on
   the AUTHOR's item (same object DB, fetch-free), verification re-runs against pre-change HEAD and
   passes without exercising the change â€” the W2 false-pass. This is the one conditional.
2. **No silent fallback.** If `DURIG_SEAT_ROOT` remains a fallback for unprepared seats, it must log
   a one-line stderr note naming the root.

**Status:** recorded as a recommendation, NOT yet adopted or implemented. The mechanism (the
`prepare_workspace` tool, D66) is landed and currently advisory. The fail-closed gate plus the two
conditions is the delegate-owned next item; the operator/lead ratifies the default.

## D68 â€” The broker intent-inbox: deliver intent without stopping the broker (2026-10-16)

**Decision:** a producer spools operator intent as one atomic JSON file in `<db>.broker.inbox/`; the
broker drains the spool at the START of each pass and submits each intent as a real operator input to
its target conversation. An undeliverable intent is dead-lettered to `<db>.broker.inbox.error/` with
its reason, never retried forever. The producer (`intent.mjs`, a separate entrypoint like `ui.mjs`,
D21) never opens the store. Each drain is logged `INTENT delivered=<n> dead=<n>`.

**Why:** the resident broker is the single store writer, so a `send` (which opens its own harness)
required `serve --stop` to deliver intent â€” interrupting in-flight runs (the delegate hit this
consulting the `advocate`). The F35 stop file proved a file side-channel reaches a resident broker
portably; the inbox generalizes it from "stop" to "tell". Draining before `harness.inspect` makes the
new submission visible to the same pass, so the seat is not also submitted a fixed wake.

**Status:** adopted; proof `demo/broker-inbox.test.mjs` (drain delivers + clears; unknown seat and
unreadable file are dead-lettered; `runWakeLoop` drains through `drivePass`; the producer is pinned as
not opening storage). The `cli.mjs send --async` alias is deferred until `cli.mjs` frees â€” it currently
holds #624's in-flight `init` work, and entangling another item into the commit would be wrong.
**Next:** this spool is the write substrate for the interactive TUI (`ui.mjs`): typing to a seat from
the TUI writes an intent instead of opening the store, so the TUI stays a viewer.

## D69 — The interactive client is an alt-screen session with app-owned scrolling (2026-10-16)

**Decision:** the rich conversation view (press Enter on a seat) renders inside the alternate screen
and owns its own scroll window — `↑`/`↓` move a turn window over the focused seat's stream — rather
than relying on terminal scrollback. This settles the interactive client's screen model in favor of
the alt-screen for the RICH view; D61's main-screen / no-app-scroll recommendation is **superseded for
`ui.mjs`**.

**Why:** a focused, scrollable conversation with a persistent header/status/footer and a pinned
streaming tail needs stable spatial ownership that the main screen cannot provide (terminal scrollback
is not a scroll window). The vendored TUI skill says "use the alternate screen for full-screen
sessions", and `ui.mjs` already entered the alt-screen — so this makes code and decision agree instead
of documenting a contradiction (#667).

**Status:** adopted in code; `demo/tui-conversation.test.mjs` (Enter opens the focused view; ↑/↓ scroll;
Esc back; the seat list advertises Enter). **OPEN for the operator/lead:** ratify the supersession of
D61 for the interactive client, or rule main-screen — in which case the rich view is reworked onto
terminal scrollback and the app-side scroll window is dropped.

## D70 — TUI hardening: the render boundary sanitises untrusted text, and every exit path restores the terminal (2026-10-16)

**Decision:** adopt a hardening posture for the interactive surface, in this order: (1) sanitise
untrusted model/tool text at the render boundary — one allowlist (a strict SGR subset plus `\n`/`\t`;
all other C0, ESC, CSI and OSC stripped), applied once on ingest in `src/viewmodel.mjs` and
defensively at the `src/tui/client.mjs` emit, so `ui.mjs`, `chatview` and `streamview` all inherit it;
(2) restore the terminal **synchronously** on `uncaughtException`/`unhandledRejection`/`exit` in
addition to SIGINT/SIGTERM; (3) wrap the frame paint in DECSET 2026 (`\x1b[?2026h … \x1b[?2026l`);
(4) replace `String.length` width math with a grapheme/East-Asian-width-aware helper.

**Why:** the external research in `docs/reviews/tui-streaming-research.md` (which could not read the
tree) was re-verified against the code at `697f376`, and the four gaps are real: raw text reaches the
terminal (`viewmodel` → `client.mjs`; only a test helper strips colour), there is no exception-path
restore (`ui.mjs` handles SIGINT/SIGTERM/try-catch only), there is no synchronized output (`CLEAR` plus
rewrite, `ui.mjs:32,151`), and width is measured in code units (`watchview.mjs:15,22`, `client.mjs`
`wrapText`). OSC 52 clipboard writes and OSC 8 link spoofing are the highest-blast-radius form
(clipboard poisoning detonates on paste), and an abnormal exit left in raw mode / on the alt screen is
exactly when an operator pastes a recovery command — the two compound, so sanitise-and-restore are one
unit of work.

**Status:** ADOPTED (operator-approved 2026-10-16). The four hardening rules are the plan of record as items H1–H5 in `docs/TUI-IMPLEMENTATION-PLAN.md` §C; `pm` registers the queue items — the delegate does not claim or route them. No code changed by the approval itself. Open rulings this depends on: the
prose-measure cap (would reverse `697f376`'s full-width viewport) and whether `ui.mjs` stays read-only
or gains the type-to-seat input line (D68/#624), for which **bracketed paste (DECSET 2004) is a
prerequisite**. Bounded-page finding: `readRigHealth` reads 24 entries per seat (`SCAN_LIMIT`,
`src/rigstory.mjs:12`), so the research's "transcript length is the scaling cliff" is overstated for
the current code — the real limit is that the conversation scroll window is capped to that page.

## D71 — The broker is supervised by a host daemon with a stop/liveness contract (2026-10-16)

**Why.** The broker is the one process that drives the queue. It is spawned detached and forgotten, so
an abnormal death (`START` with no `EXIT`, `src/broker.mjs` lifecycle audit) left queued work and three
spooled operator intents idle indefinitely. pi-durable owns durability and `resume()`; it does not own
supervision. A durability guarantee is not a liveness guarantee.

**Decision (design of record; mechanism open).** Supervision is a host process *around* the broker, in
three layers: an OS trigger for boot/logout survival (a per-user agent by default — Windows Task /
macOS LaunchAgent / `systemd --user`; a system daemon opt-in) →
a thin **host** (`src/host.mjs`) that never opens the store and owns single-instance, backoff, give-up,
heartbeat-watching, kill-on-wedge, and the stop handshake → the broker, still the sole writer. The
contract: (a) an exit-code taxonomy (0 intended stop / 1 crash / 2 wedge / 0 give-up) set via
`process.exitCode`, never `process.exit()`; (b) a durable operator down marker `<db>.broker.down`,
distinct from the ephemeral `<db>.broker.stop` (F35); (c) two heartbeats — liveness (event loop) and
progress (`PASS`) — with the progress threshold from the provider stream timeout, and sleep treated as
a resume-gap event (`performance.now()` counts sleep on Windows, so no clock excludes it); (d) the host
never opens the store. The host must not duplicate retries, scheduling, or resume. **The host is
platform-neutral pure Node** (durig must adapt to macOS and Linux distros): only the trigger file, the
kill-tree primitive (Windows Job Object vs POSIX process group), and the stop signal (POSIX SIGTERM vs
the Windows `.stop` file) are OS-specific. — if it re-drives the queue, that is double-work.

**Rejected / corrected alternatives.** A self-supervising detached parent is the exact shape that
already failed. A Worker-thread `process.exit()` self-kill is invalid: it stops the Worker, not the
process (verified empirically), and a blocked main thread cannot receive the Worker's messages.
Restart-on-exit alone would undo `serve --stop`, hence the exit-code + durable-marker split. A service
stop timeout shorter than `DURIG_STREAM_TIMEOUT_MS` would force-kill a broker mid-run and strand the
submission (F11). Round 3 corrected two more assumptions: a monotonic clock alone does not exclude sleep
(`performance.now()` counts it on Windows), and a resume-gap exemption alone leaves a 60–300 s window in
which a live long generation is still stolen (see below). Windows Service is not the default — a logon
Task keeps the user profile and the in-process TUI; service mode (Session 0) forces item 52's remote,
security-gated path.

**Correctness hazards (round 3, verified in code).** `src/genlock.mjs` age-steals a **live** holder
(`age > STALE_MS` = 60 s) although a slot is held for the whole response, up to the 600 s stream
timeout → the concurrency cap can be exceeded; the fix is lease renewal (or `STALE_MS` > the stream
timeout), not a gap exemption. `genlock.holderAlive` swallows `EPERM` and reports a live unsignalable
holder dead, while `brokerAlive` handles it correctly. `brokerAlive` trusts `process.kill(pid, 0)` and
Windows reuses pids → assert identity with a per-run `runToken` + fresh heartbeat (Node cannot call
`GetProcessTimes`, and an open fd is not a Windows lock).

**Not yet scheduled.** The full shape depends on item 54 (the pass loop must not park) for its heartbeat
to be meaningful — **and item 54 is not done**: `drivePass` still awaits the runs it woke (the scoped
D65 wait), so wake-and-return remains pending. Item 65 is a live single-writer hazard independent of
the host and should land regardless. The OS trigger (logon Task vs Service) remains an operator ruling,
as does item 55 for any control socket.

**Status:** design recorded 2026-10-16 (delegate), refined after the round-3 research reply. Roadmap
items 61–67. No code changed by the record itself. References: `docs/BROKER-SUPERVISION.md`,
`docs/reviews/building-agent-systems-on-pi-research.md`.

## D72 — The daemon supports both modes with a per-user default and a clean switch (2026-10-16, operator ruling)

**Why.** durig will have different users with different use cases. A developer on a laptop wants the rig
to run only while logged in (and the TUI in-process); an unattended host needs the broker to survive
logout and reboot. One mode cannot serve both, and the platform trigger differs across Windows, macOS,
and Linux — so the user-facing surface must hide the mechanism.

**Decision.** Ship both modes. `--user` (per-user agent: Windows Task / macOS LaunchAgent /
`systemd --user`) is the **default**; `--system` (system daemon: Windows Service / macOS LaunchDaemon /
systemd system unit) is opt-in. The end-user surface is `durig daemon install|switch|status|uninstall|
restart|stop|logs`; `durig daemon switch --user|--system` is the clean migration (drain → uninstall the
current trigger → install the target → verify the heartbeat), and the store is preserved. `--user` is
the default because it inherits the user's profile, git/npm credentials, and ACLs and keeps the TUI's
in-process subscriber; the system daemon is for unattended hosts and forces the remote, security-gated
TUI path (items 52/55). No persistent trigger is installed without an explicit command.

**Portability.** Only the trigger file, the kill-tree primitive, and the stop signal are OS-specific;
`src/host.mjs` is pure Node and identical everywhere.

**Routing.** Operator chose **option A — route to the team**: `pm` registers/sequences items 61–64 and
routes to `devtools`/`impl`, **after** the team finishes its current tasks. The delegate does not route
or implement it.

**Status:** operator ruling recorded 2026-10-16 (delegate clock-out). CLI surface in
`docs/BROKER-SUPERVISION.md` §11; roadmap item 64. No code changed.

## D73 - Surface-decision policy: every capability states its surface, at decomposition (2026-10-16)

**Decision.** A capability's operator surface is an explicit, recorded decision, not an
accident: every item that builds or changes a capability states which surface(s) expose it -
`cli` (verb/flag), `tui` (view/action), or `both` (vocabulary = the
FEATURES.md `Surface` column) - with one line of why, and pm does not decompose an
item whose surface decision is absent. The requirement is a STATED and justified placement,
not forced parity: scrolling/alt-screen have no CLI meaning; JSON output has no TUI meaning.

**The decision rule** (state the class, then the surface):
- state change -> `cli` mandatory (D21: cli.mjs is the operator/LLM surface), `tui` optional;
- observation the operator acts on -> `both` (CLI for scripts/grep, TUI for the live cockpit);
- purely interactive affordance (scroll, selection, key nav) -> `tui`-only;
- batch/contract/JSON -> `cli`-only.

**Where it lives.** `docs/WORKFLOWS.md` W4 (the advocate's paragraph), which is the
document pm decomposes against; the same vocabulary in FEATURES.md's `Surface` column.
The call itself is the designer's (SELFDEV.md's role table: CLI/UX, surface and defaults);
workflow-fit challenge is the advocate's; a contested call escalates to lead.

**Why.** The failure this prevents is a capability that is silently missing from one surface.
It was observed in this repo: the designer's UX review of the TUI C3 build found `cli.mjs`
had NO --help surface (docs/STATUS.md, 2026-10-15) - a capability (help) that existed only as
an error fallback and was invisible to first-run users. Mirrors D62's doc-acceptance: a
capability carries its acceptance (docs) AND its surface decision in the same item, verified
by the partner check.

**Evidence classes.** Observed: the missing --help finding; the FEATURES.md
`Surface` column and its current cli/tui rows. Inferred: the four-rule mapping (it is
a policy the operator set, not a measured result).

**Status:** adopted (operator directive, 2026-10-16); W4 text landed same day. No code
changed by the policy; the check-rule enforcement for the surface-decision field is ROADMAP
item 46's second half (registered, not scheduled).

## D74 - No RACI/DACI/RAPID/MOCHA grid: artifact-keyed ownership, machine-checked (2026-10-16)

**Decision.** A full RACI/DACI/RAPID/MOCHA grid is REJECTED. Redundant against what durig
already has: the role table (docs/SELFDEV.md), the docs-ownership norm (docs/WORKFLOWS.md),
the capability matrix (docs/WORKFLOWS.md), and the queue's single claimer. Its
single-Accountable-per-task assumption also CONTRADICTS durig's artifact-keyed ownership:
accountability here attaches to artifacts and the queue already makes exactly one seat the
claimer of an item, so a task-level grid would restate the role table and duplicate what the
queue enforces mechanically.

**What the rejection keeps.** The real gap RACI is criticized for is decision authority -
and durig supplies that where it is enforced: one claimer per item (the queue),
org-edge send rights (the rig file), escalation paths to lead. Three adopted follow-ups carry
the value without a grid: (a) artifact ownership becomes MACHINE-CHECKED (ROADMAP item 46: a
check rule mapping every docs-ownership class to a live owning seat - "a decision-rights row
not enforced by check (or the queue) is prose and goes stale"); (b) the SURFACE decision is
owned per capability (D73); (c) verification re-executes evidence rather than accepting a
claim (ROADMAP item 48). The one compact addition durig KEEPS is an artifact/DECISION-CLASS
table (owner / consulted / enforced by / escalates to) in docs/WORKFLOWS.md - four columns,
not a grid, and the review's own smallest-form recommendation - which is distinct from the
rejected task-level R/A/C/I lettering.

**Alternatives rejected, with evidence classes.** Full RACI/RASCI: redundant +
contradictory (review Part 5.1; observed - read). Full DACI: its Driver/Approver semantics
already hold mechanically in the queue's single claimer (advertised-elsewhere for the
framework's origin - the Intuit attribution is unverified). Full RAPID: its "one Decide" is
exactly the queue's single claimer (advertised-elsewhere - Bain's own doc). MOCHA: not
verified anywhere (review Part 1 table) - rejected as unverifiable.

**Evidence base (all from docs/reviews/Agent_Ownership_Review.md, the research draft).**
Observed: MAST taxonomy (organisational breakdown a named failure category); the
loop-back-authority paired experiment (flat teams produced higher-quality reports than a
manager with send-back power); measured sycophancy/conformity (wrong-peer adoption 29.7%;
disagreement collapse). Inferred: "keep the organisation spec machine-checkable and small"
(MOISE+ transfer). The review is PARTIAL - its governance pass (Part 3) and
coordination-cost numbers (Part 4) were not run - and the no-grid verdict rests on the
passes that did complete; the unfinished passes do not bear on it.

**Pilot's-honesty note.** The compact decision-class table in WORKFLOWS.md is
prose until item 46's check rule lands; its enforced-by column names the rule that will do
the real work, so the prose is a ledger for a machine-checkable claim, not a substitute for
one.

**Status:** adopted (operator directive, ROADMAP item 45; pm registered as selfdev item
#713). The decision-of-record so the question is not re-litigated.

## D75 — Safe writes precede the always-on daemon; the command spool is the mechanism (2026-10-16)

**Decision.** Build broker-safe writes (a hard guard on every write verb, a command spool the broker
applies, and spec/constitution hot-reload) **before** the host daemon (ROADMAP 61–64). The running broker
enforces the single-writer invariant in code, not prose.

**Why.** The daemon makes the broker *always* on, which multiplies the exposure of every second-owner
write. On 2026-10-16 a stray `resume` (and later an `up --refresh` after `serve --stop` returned
`stopped:false`) each ran a second writer while the broker was up; each corrupted a `pi.live` document
and wedged every write verb. Prose preconditions are what failed — twice — so the fix is a code guard.

**Evidence base.** Observed: the two corruptions and their recovery (docs/NEXT.md incident notes;
`docs/runbooks/store-corruption-recovery.md`); the ownership vocabulary and the command-path table in
`docs/COMMANDS-AND-THE-BROKER.md` §1–§7. Advertised-elsewhere: the research report
(`docs/reviews/runbooks-sop-best-practices.md`) that the precondition must be enforced at the tool layer.

**Status:** adopted (delegate), ROADMAP items 69 (guard), 71 (spool), 74 (hot-reload). Not yet
implemented (blocked on `cli.mjs`).

## D76 — Runbooks are maintained, machine-checked artifacts (2026-10-16)

**Decision.** `docs/runbooks/` is a maintained SOP set with a mandatory front-matter block and a skeleton
(`When to use / Impact / Preconditions / Diagnose / Do / Verify / If it fails / Escalate to / Evidence`);
rot is a failing check (`runbook-stale` / `runbook-unverified`), not a prose reminder; and a seat that
introduces or changes an operational procedure adds/updates the runbook as part of the item
(`constitution.txt` **P3 Runbooks**).

**Why.** Scanning/prose conventions do not survive; durig's own runbook conventions already matched
published practice, but nothing enforced them and the pivotal precondition was prose. A runbook is done
only when its `Verify` step has actually run, otherwise it is marked unverified. Agent execution is
structured **prose now**, with an executable runtime deferred behind a per-model capability gate
(weak models were *harmed* by active-frame guidance).

**Evidence base.** `docs/reviews/runbooks-sop-best-practices.md` (research report; template, lifecycle,
agent-execution findings, anti-patterns) and `docs/runbooks/README.md` (the folded conventions). The
report's `advertised-elsewhere` claims cite URLs; the agent-execution result (SOPBench) is the load-
bearing external source.

**Status:** adopted (delegate), ROADMAP items 81–88. The set is largely **unverified** until item 85 runs
the `Diagnose` blocks.

## D77 — A tool call emitted as TEXT is a degenerate run: detect and reset, not translate (2026-10-16)

**Decision.** When an assistant turn ends with `stopReason:"stop"` and no structured tool call, but its
text carries the model's malformed tool block — written with DeepSeek's **DSML special-token
delimiter** (U+FF5C `DSML` U+FF5C), or as the plain nested `<parameter name="TOOL">` /
`<parameter name="ARG">` pair — the current run is **degenerate on the first occurrence**.
`assessRun` counts it (`pseudo-tool-call=N>=1`) and the supervisor resets the seat through the existing
reset boundary, with a handoff that names the fault and says to issue the call through the tool channel.
We do **not** parse-and-execute the text: a translation layer would synthesize a half-parsed
`powershell`/`edit`/`write` call without the model's own validation, and durig has no seam to inject a
synthetic tool call into pi-durable's pipeline.

**Why.** The harness reads the malformed turn as a normal completion (submission `done`, not failed), so
nothing retried and the seat idled mid-item — `impl` did this three times on #700. The existing
`malformed-tool-call` detector matches only the harness's schema-validation rejection; no call was ever
submitted, so it was structurally blind, and the metric stayed 0. **Grounding trap:** the terminal
STRIPS the DSML delimiter, so a screen read of the entry shows a clean `<parameter>` block and hides the
fault; the detector must read the stored bytes, and the rule requires the delimiter (or the plain nested
pair), so prose that merely names the shape does not trip it. A false positive costs one context reset,
never lost work (the transcript is durable).

**Status:** adopted (delegate), commits `f086382` + `c38815f`; verified by `demo/degeneration.test.mjs`
(RED before) and against the real stored entry `35382` (`pseudo-tool-call=1>=1`).
The recurrence is a model/provider format fault (`deepseek-ai/DeepSeek-V4.1-Flash` via deepinfra,
`openai-completions`); the operator keeps that model, so durig remediates rather than swapping it.