# durig — decision log

Each entry: decision, rationale, alternatives considered, status.
Dates are 2026-10-07 unless noted.

## D1 — Build on pi-durable rather than OpenRig/other candidates

**Decision:** develop durig as a rig layer on `@earendil-works/pi-durable`.
**Rationale:** six-way comparison (`../docs/ORCHESTRATION-COMPARISON.md`)
showed OpenRig covers our feature set best but carries a tmux assumption we
already shim at real maintenance cost on Windows; pi-durable gives the
strongest crash-recovery guarantees surveyed (commit-before-display) and its
extension API proved capable of hosting the delegation pattern in spikes.
**Alternatives:** agent-fleet (pi-coupled, Windows unverified), tuios (pane
layer, no topology/queue), hermes-agent (single-operator model, no seat
topology). **Status:** adopted.

## D2 — Seats are conversations; registry is a session-scoped doc

**Decision:** a seat = one pi-durable conversation; name/id/role/goal/
capabilities live in the `durig.seats` session document.
**Rationale:** conversations are PD's durable unit with per-conversation
agent config; a doc keeps the roster queryable by any client without owning
storage. **Status:** adopted.

## D3 — Queue is a session-scoped document, not tasks

**Decision:** work items live in `durig.queue` doc with statuses
queued→claimed→done and append-only transitions.
**Rationale:** atomic queue-transcript consistency in one commit; audit trail
survives restarts. PD tasks were considered for queue items but their
ownership model fits subagent lifecycles, not PM-style routed work.
**Status:** adopted.

## D4 — Mailbox symmetry: completion enqueues a DONE notice back to sender

**Decision:** `complete_work` writes a DONE item addressed to the original
sender. **Rationale:** both directions flow through one durable queue; no
side-channel notification mechanism needed. **Status:** adopted.

## D5 — Org edges are restrictive-by-default

**Decision:** when any edges exist, a sender without a matching link is
forbidden to send. **Rationale:** auditability preference; open-by-default
was implemented first and failed the v2 gate demo (intruder enqueued work),
so semantics were corrected to match the documented intent.
**Status:** adopted (bug found by demo before any real traffic).

## D6 — Provider options single-sourced from pi-deepinfra's models.ts

**Decision:** durig imports BASE_URL/PROVIDER_ID/DEEPINFRA_COMPAT/
fallbackModels from `../vendor/pi-deepinfra/models.ts` instead of defining
its own provider constants. **Rationale:** operator direction — the same
extension architecture should supply provider options; Node 24 type-strips
the TS module so no build step is needed. A synthesized model entry is added
when DURIG_MODEL is absent from the curated fallback subset.
**Status:** adopted.

## D7 — CLI contract: one JSON document per command, exit 0/nonzero

**Decision:** every CLI command prints exactly one parseable JSON doc;
errors as `{ok:false,error}`; `send` waits and returns the reply inline.
**Rationale:** LLM operators need parseable output and no polling loops or
interactive prompts. **Status:** adopted.

## D8 — Faux CLI mode exercises plumbing only

**Decision:** `DURIG_PROVIDER=faux` gives one canned reply per send; full
offline orchestration loops live in demo scripts.
**Rationale:** scripted responses drain per process and each CLI call is one
process; per-seat scripting across invocations would require durable script
state we do not want to build for tests. **Limitation documented in code.**
**Status:** adopted.

## D9 — Config schema v2 mirrors CrewAI/MetaGPT field names

**Decision:** seat persona fields named role/goal/backstory/constraints/
capabilities (source-verified against crewAI base_agent.py and MetaGPT
roles/role.py); GitHub Agents MD-frontmatter style noted as prose-first and
not interoperable without loss. **Rationale:** mechanical migration from the
closest frameworks; OpenRig converter handles our actual incumbent.
**Status:** adopted.

## D10 — Upstream sync practice

**Decision:** keep durig's pi-durable/pi-ai/chord aligned with pi releases;
update + regression-run demos after every `pi update`.
**Practice applied 2026-10-07: 1.0.4 → 1.1.0 with both demos green.**
**Status:** standing practice.

## D11 — `durig watch` polls the storage layer, not the session

**Decision:** the `watch` command streams queue changes by polling
`storage.findDocument` + `storage.document(id,"current")` every 750 ms,
not via pi-durable's `DocumentWatch` and not via `documentState`.
**Evidence (2026-10-09):** `CommittedWatch` is fed by in-process
replication only (pi-durable `session/observation.js`), sqlite storage has
no cross-process change notification, and `documentState` on an
already-materialized doc keeps serving the session's stale replicated
value — a separate watcher process received the initial snapshot but never
a single cross-process commit (probe reproduced twice). Direct storage
reads bypass both traps; the test proves a second process's enqueue
arrives within one poll interval.
**Trade-off accepted:** up to 750 ms latency and a periodic read, in
exchange for correctness across processes. If pi-durable grows cross-
process notifications, swap the poll loop for a real subscription.
**Status:** adopted.

## D12 — Generation slots: cross-process file leases at the provider seam

**Decision:** `DURIG_MAX_CONCURRENT_SEATS=N` caps concurrent GENERATIONS
(not seats-as-objects) by wrapping the provider's `stream`/`streamSimple`
with slot-file leases (`<db>.genlock.<i>`) beside the rig database.
**Why these seams:** durig drives seats from per-invocation CLI processes,
so an in-process semaphore would be theatre; the provider entry points are
the one funnel every seat's generation crosses regardless of driver.
**Visibility without a messaging channel:** the lease file doubles as
operator state — `status`/`watch` report `generation_in_flight`
(holder seat + since) vs `generation_stale` (holder pid dead or older
than 60 s, stealable). Waiting-for-the-GPU is thus distinguishable from
stuck, pairing with #4's attention vocabulary.
**Trade-offs accepted:** up to 100 ms acquire-poll latency; stale theft
after 60 s could theoretically double-run a wedged generation (accepted:
a generation wedged 60 s is already failed in practice).
**Status:** adopted.

## D13 — Instruction optimization: own meta-prompt, pluggable seam

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

## D14 — Optimizer effectiveness: preservation guard + blind judge

**Decision:** effectiveness is measured, not assumed. Two instruments:
(1) `analyzePreservation` — mechanical check that hard facts (numbers,
quoted names, constraint lines) survive the rewrite; wired INTO
`optimizeInstruction` as an automatic fallback-to-raw safeguard, so a
lossy rewrite never reaches a seat and provenance stays honest.
(2) `src/judge.mjs` — blind pairwise judging (randomized A/B assignment,
strict-JSON verdicts) on clarity/completeness/actionability; the judge is
told to penalize additions so "richer" cannot masquerade as "better".
**Benchmark:** `demo/optimizer-eval.mjs` — fixed case set, per-case JSON
rows, aggregate VERDICT line. Faux mode proves harness mechanics only;
the real measurement is `DURIG_PROVIDER=deepinfra ... node demo/optimizer-eval.mjs`
(prefer `DURIG_JUDGE_MODEL` different from `DURIG_MODEL` to defeat
self-preference bias).
**Status:** adopted.

## D15 — tutor-pi migration: done; instruction optimization rejected by guard

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

## D16 — Router must be installed at harness open; coordinators get explicit edges (2026-10-09)

**Finding:** `cli.mjs` opened its harness with a bare `createRegistry()`, which holds
only built-in tasks. The Router extension (send_work/claim_work/complete_work/
defer_work/resume_work/peek_queue) was never installed, so NO seat conversation ever
had the durig tools.
Faux demos passed anyway because they install Router themselves and script tool
calls — masking the gap. Real models (Qwen3-32B, GLM-5.3-Flash) therefore narrated
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

## D17 — Track pi `main` pinned by commit, not the release channel (2026-10-10)

**Finding:** `@earendil-works/pi-durable` ships from the `earendil-works/pi`
monorepo. npm exposes only `latest` (1.1.0) and `legacy-node20` — there is no
dev/nightly channel, so `main` is the dev channel. Within one day of the 1.1.0
tag, main was 14 commits ahead, including `feat(durable): nested tool calls,
structured output, callers` (tool.ts +434/−71) and a rename of
`ToolExecutionResult.content` to `output` that silently empties every durig tool
result on main.

**Decision:** track main, pinned to a specific commit (`pi-main.pin.json`),
built locally by `scripts/sync-pi.mjs` (sparse clone → npm install → build
telemetry/chord/ai/durable). `--link` swaps `node_modules` via
`npm install --no-save`, so `package.json` and a fresh clone stay on releases.
Re-pin deliberately with `--update`; the 12-demo suite is the regression gate.

**Compat:** `src/rig.mjs` returns tool text through `toolText()`, which emits
both `content` and `output`, so the same code is correct on the 1.1.0 release
and on pinned main.

**Evidence:** spike at `C:/tmp/pi-main-spike` + `C:/tmp/main-test`; full build
~40 s (36 s cold, 24 s warm); durig's suite passes 12/12 both on released
packages and on the linked main build (tool.js byte-identical to the built tree).

**Pin moves:** `42a3497d` (2026-10-10) → `ea448f45` (2026-10-11), which carries
"the scheduler no longer visits every live task on each pass",
`TaskRuntime.ownedTasks()`, and one document per nested call. Rebuilt and
relinked; all 18 demos pass on the new pin without a code change, so the move
needed no compat shim. Upstream is re-checked at the start of a session rather
than mid-task: an API rename landing underneath work in progress is the failure
the pin exists to prevent, and moving it deliberately costs one suite run.

## D18 — Read commands must name the database they used (2026-10-10)

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

## D19 — Human views on a terminal, JSON when piped (2026-10-10)

**Finding:** `watch` emitted NDJSON only, which is correct for scripts and opaque
for the operator at a terminal — who wants seat, role, current work and the last
thing said.

**Decision:** `watch` and `log` render a human view when stdout is a TTY and keep
NDJSON when it is not; `--json` and `--human` force either form. Precedence mirrors
`send --stream`: an explicit flag wins, otherwise the terminal decides. stdout
stays a single JSON document in JSON mode, so the LLM-operator contract (D7) is
untouched.

**Evidence:** `demo/watchview.test.mjs`, `demo/streamcli.test.mjs`,
`demo/chatlog.test.mjs`; live proof — a real-model run shows the panel moving
through `generation_in_flight` to `sent #1` to DONE.

## D20 — A transcript renders in TURNS, not entries (2026-10-10)

**Finding:** a tool call and its result are two entries — `toolCall` parts live
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

## D21 — The CLI stays non-interactive; interaction is a separate frontend (2026-10-10)

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
read API, so that any interactive client — a TUI or a browser over SSE — is a
client over the same store rather than new logic in the CLI. `watch`, `log` and
`status` currently each re-implement seat and health reading; that duplication is
the real refactor signal. Choice of TUI vs web is deferred, not made by accretion.

**Not changed:** storage, schema, the queue protocol, and every JSON contract. This
entry records an architecture direction, not a rewrite.

**Evidence:** the survey's screen-model analysis shows alt-screen plus tmux is the
worst-supported combination in the field, which is precisely what click-to-collapse
would force; `wiremonitor` is a working precedent for the read-only SSE client.

## D22 — Seats are not terminals, so no multiplexer is required (2026-10-10)

**Finding:** operator question — do we need tmux/tuios/psmux to watch a seat live,
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

## D23 — The research gaps are protocol, not architecture (2026-10-10)

**Finding:** reviewed `docs/Patterns_and_Pitfalls_of_LLM_Agents.txt` (the MAST
failure taxonomy, Anthropic's production and swarm research, and the practitioner
consensus) against what durig actually implements. Both load-bearing citations
were verified by fetching them: arXiv 2503.13657 and Anthropic's "Patterns and
problems in emerging multiagent systems" (2026-08-13) exist and support the claims
made from them.

Several named failure modes turn out to be **absent by construction rather than
mitigated**: loss of conversation history (conversations are durable rows), silent
shared-state corruption — the failure practitioners call under-appreciated most
often — (one writer, atomic document revisions, no shared scratchpad; seats enqueue
items instead of mutating shared state), and the coordination substrate the swarm
paper says agents lack (a constitution, restrictive-by-default edges, an
append-only transition trail). Observability, which practitioners call the hard
part, is where durig over-invested.

**Gap:** a grep for `verif|escalat|deadline|retry|budget|veto|reputation` across
`src/*.mjs` and `cli.mjs` returns only the two CLI poll loops. So `complete_work`
is self-declared, with no evidence attached and no verifier step (MAST FC3 — the
category the paper's own intervention improved by 15.6%); there are no termination
conditions (FC1, 12.4%); no clarification or deferral path (FC2, 6.8%); and nothing
detects step repetition (FC1, the single most frequent mode at 15.7%). Separately,
all 13 seats in `rigs/tutor-pi.rig.json` resolve to one model while per-seat models
are already supported (D-per-seat), so a model-level bias is systemic rather than
isolated — the correlated-failure mode Anthropic's swarm work describes.

**Decision:** no architectural change. The durable single-writer store, the
orchestrator-worker topology, the explicit edge permissions and the audit trail are
the remedies the literature converges on, and they are already the foundation. What
is missing is **protocol**: verification with evidence, termination and attempt
semantics, and a deferral verb. These are additions inside the existing design, and
they are the content of milestone M3 — giving seats real tools and giving the rig a
verification loop are the same work item, because a check needs something runnable.
Verifier model diversity is enabled first, as a configuration change, to
de-correlate verification at no build cost.

**Not adopted:** reputation systems, veto/quorum arbitration, and flat peer swarms
(deferred with reasons in ROADMAP.md). Seats get **no polling tool** when they get
real tools: the swarm paper's stampede — 2.4 M requests, 117 accepted — is exactly
what that produces.

**Evidence:** both citations fetched 2026-10-10; the capability grep; a `node -e`
pass over `rigs/tutor-pi.rig.json` reporting 13 seats and 1 distinct model. Full gap
table in ROADMAP.md, "Gap analysis vs the research".

## D24 — The research concerns are measured, not just listed (2026-10-10)

**Finding:** D23's gap table is a snapshot. It cannot answer whether an instance is
drifting worse, or whether a configuration change helped. It is affordable to
answer that here because the store already holds every message, every tool call with
its arguments, and every queue transition — so each concern is a **read-only query
over data already persisted**, not a new instrumentation surface.

**Decision:** each named concern gets a measure (`cli.mjs metrics`), and each
measure declares three things in its output rather than in documentation: its
**evidence class** (direct / proxy / config-derived), its **direction** (what a
rising value means), and its **blind spot** — because a clean reading can mean the
capability is missing. Verification is the example that matters: it reads "no
independent checks" today precisely because nothing can check, and a measure that
reported an all-clear would be a lie.

**Decision (the review loop):** a configuration change is a hypothesis with a
direction, recorded **before** the change — what changed, which measure should
move, and which way — and re-measured after. A change whose measure does not move
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
`storage.scanEntries` — the same path a measure reads, not the `log` view. The
original check must have looked at a different entry kind or predated the field.
Consequence: the cost measure is **direct** class, item 2's token counter is
unblocked, and caveman's claimed savings are verifiable with our own numbers. The
claim is left standing above rather than edited away, because the interesting part
is that a "checked" fact stayed wrong for weeks and ordinary use found it.

**Design:** how these measures reach a human — surfacing tiers, scope, notice
lifecycle, and the traps — is `docs/METRICS.md`.

## D25 — `check` is a linter, and severity says who can fix it (2026-10-11)

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

- `error` — the rig cannot do its job until the file changes; `check` exits
  nonzero so a script can gate on it.
- `fix-now` — a real gap the operator can close; the rig still runs, so it never
  fails a run and never blocks a script.

A rule `check` cannot judge (no declared text to compare, an unreadable store) is
reported **skipped with its reason** — never as a pass. Silence that reads as
health is the failure mode this whole feature exists to remove.

Eight rules: `constitution-missing`, `constitution-not-applied`,
`unreachable-seat`, `dangling-edge`, `store-missing-seat`, `stray-seat`,
`no-verifier-seat`, `single-model-rig`.

**Not adopted:**
- A third `code-gated` severity for gaps no rig edit closes (verification
  evidence, a deferral verb, termination semantics). `check` cannot know about
  them without hand-mirroring the tool surface, which is precisely the drift that
  produced the constitution bug. They stay in ROADMAP items 4-6, where they
  change when the code does — not in a linter that would report them forever.
- `--fix`. D24 makes a config change a hypothesis whose direction is recorded
  *before* the edit; a fixer would apply changes nobody predicted.
- A composite rig score (Goodhart; `docs/METRICS.md`) and interactive prompts
  (D21 — the CLI stays non-interactive).

**Deliberate imprecision, stated in the code.** `no-verifier-seat` is a
heuristic over seat *name and role* text, so it is `fix-now` and prints the
vocabulary it used. Matching on advertised `capabilities` was rejected: tutor-pi's
own implementers advertise `peer-review`, so a capability match would classify
the authors as verifiers and report an all-clear on the exact gap the rule
exists to catch. A false all-clear is the one failure an audit tool must not
have. The stranded-seat rule is likewise broad — *any* seat with no outgoing
target — rather than the sharper "is a target but cannot reply", because
`complete_work` enqueues its DONE notice without the edge gate, so the sharp form
would miss the D16 coordinator case the rule is named after.

**Evidence:** `demo/check.test.mjs` (the 19th demo) covers every rule, the drift
regression, the capability false-all-clear case, open-vs-restrictive edges,
skipped-with-reason, the render, and the CLI exit codes; 19/19 demos pass. Run
against the live tutor-pi store it found a real, unmasked defect — see D26.

**Cleanup alongside it:** the two view modules each carried their own ANSI
palette (chatview had magenta and no yellow, watchview the reverse), now
`src/ansi.mjs`. `truncate` was left duplicated on purpose: the two copies
disagree on the `width <= 1` edge case, so unifying them is a behavior change and
belongs with the view-model extraction (ROADMAP item 7).

## D26 — The converter drops OpenRig's rig-level `edges:` list (2026-10-11)

**Finding:** found by `check` on its first real run. `scripts/from-openrig.mjs`
derives send permission from `agent.delegates_to` and each pod's `edges:` block,
but never reads the **rig-level** `edges:` list at the end of `rig.yaml`. That
list carries `escalates_to` (qa, qa2, student, sec, dev → lead), `collaborates_with`
(ux → pedagogue, pm → lead, pm → sec) and `can_observe` entries. The generated
`rigs/tutor-pi.rig.json` gives `ux`, `sec` and `dev` **no outgoing edge at all**,
and qa/qa2/student lose their declared escalation path; `check` reports
`unreachable-seat` for the three. The D16 fix (blanket edges for pm/lead) masked
most of the loss, which is why nothing caught it.

A second defect rides along: pod-level edges use bare names (`from: impl`) while
rig-level edges use qualified ids (`from: build.qa`), so reading the rig-level
list requires normalising `pod.seat` to `seat`.

**Status:** recorded, not yet fixed — it is a converter concern (one per change)
and the next item in the roadmap. Evidence: `openrig/rigs/tutor-pi/rig.yaml`
lines 220+ versus the generated spec's edge list; `durig/docs/ROADMAP.md`.

## D27 — A `docs` pod, and how its edges were decided (2026-10-11)

**Finding:** nothing in the rig owned documentation, and the drift was already
visible: `openrig/README.md` described "10 Pi seats across 5 pods" for a 13-seat,
8-pod rig, and a committed converter fixture that crashed on contact was cited as
proof by three documents — including an acceptance item marked PASS. Documents
decay silently unless somebody's job is to read the artifact.

**Decision:** a ninth pod, `docs`, with one seat — `scribe` — whose mandate is the
feature inventory and a doc per capability, kept true as it changes. Persona:
`documentation` + `grounding` + `rig-membership` skills, a role guidance file, and
a pod SOP. The load-bearing rules are that it **reads the work rather than asking
for a summary** (its incoming `can_observe` edges are the evidence) and that
**verification is the boundary of what it may claim**: a capability is documented
as working when its proving test passes, otherwise it is marked `unverified`
rather than omitted.

**Edge design — one rule instead of seat-by-seat.** A documentation seat is
horizontal by nature, so drawing 17 edges by hand invites both gaps and cruft. The
rule applied:

- **Reads and questions** every seat that ships a *user-visible capability*
  (`impl`, `impl2`, `ux`, `pedagogue`, `dev`) or *verifies* one (`qa`, `qa2`) —
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
author's word alone — here the doc is not done until the author of the code
confirms it.

**Finding while doing it — edge kinds flatten.** OpenRig distinguishes
`delegates_to`, `collaborates_with`, `escalates_to` and `can_observe`; the
converter emits all four as one `maySendTo` permission. So in durig "may read
this seat's work" and "may assign this seat work" are the same bit. It is
harmless here — durig needed the read permission to carry a question anyway — but
it is lossy, and if durig's edge model ever grows a kind, this is the mapping to
revisit.

**Security — consult taken 2026-10-11, and it did not pass as scoped.** The scribe
reads other seats' transcripts and republishes into documents, which is an
untrusted-input and exfiltration surface, and the team norms require a
`security.sec` position *before* code for exactly that. The rig daemon was down
(2026-10-06 → 2026-10-11) when this was written, so the consult was recorded as
owed rather than dropped; it has since been taken, and the verdict is **FAIL as
scoped → adopt-with-conditions** (D30). The persona mitigation below is a norm,
not a mechanism. Mitigation already in the
persona: the `documentation` skill forbids copying credentials, tokens or
personal data out of a transcript, on top of the culture's "no secrets in git".

**Also noted (not fixed):** the three older pod fragments carry no `startup:`
block while their `rig.yaml` pods do, so a pod added with `rig expand` is not
delivered its pod SOP and differs from the same pod built by a full rig. The new
`docs-pod.fragment.yaml` includes its startup block; the earlier three should get
theirs.

## D28 — Measurement ships, and what a reading refuses to claim (2026-10-11)

**Context:** D24 decided the research concerns are *measured*; `docs/METRICS.md`
designed how. Both ended with open questions, so the design note was rewritten as
a decision brief (options, a recommendation, and the evidence behind each), the
operator agreed to all five, and this records what was built from them.

**Decision (the split between `check` and `metrics`).** `check` is a pre-flight
linter: you run it because you were already about to change something. Metrics are
**ambient** — their value is noticing something without having asked. So metrics
join `computeAttention` rather than inventing a surface, and the doc's admission
test decides who may be ambient: actionable, rare when abnormal, and *not already
visible*. `shared-reviewer-model` fails the third test, because it is already a
`check` rule, so it appears in `metrics` only.

**Decision (four measures, not three).** The ruling put the queue scope in the
first cut, and a scope with no measure is not shipped — so `queue-ageing` joins
`step-repetition` (direct), `unverified-completions` (proxy) and
`shared-reviewer-model` (config-derived). All three of D24's evidence classes are
exercised, which was the point of the original three.

**Decision (evidence-class naming: D24 wins).** `METRICS.md` called
unverified-completions "code-gated baseline"; D24 names the classes `direct` /
`proxy` / `config-derived`. They are not competing taxonomies — "code-gated"
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
`unknown`, never `ok`; a zero baseline cannot silence movement off zero (k × 0 is
0, so the relative rule would never fire); a config-derived value draws no trend
arrow; and a window that was bounded, or a rig with no new data, says so — absence
of activity is not improvement.

**Decision (deferrals, each with its reason, none half-built).** Cross-render
hysteresis needs either stored state or a series derived from the window, and the
threshold values were the ruled deliverable — so the values ship and the
statefulness does not. The one-shot deadband a zero baseline needs IS implemented,
because it is derivable in-window. The small tracked change-log is a **new write
path**, so it stays owed to a `security.sec` position (D24, D27); the consequence
is that config-derived measures have no trend, which the renderer enforces rather
than fakes. Acknowledgement stays deferred, as ruled.

**Evidence:** `src/metrics.mjs` (pure), `metrics` in `cli.mjs`, notices through
`computeAttention` with `scope` added alongside `seat`; `demo/metrics.test.mjs` is
the 21st demo. Measured cost of the shared scan: 0.9–1.4 ms for 14 seats × 24
entries against `watch`'s 750 ms poll, so the ambient tier adds arithmetic and no
I/O. Live reading is in `docs/MVP.md`, "measure drift instead of listing
concerns".

## D29 — One distribution, and extensions chosen by workflow (2026-10-11)

**Question (operator):** should durig ship as two editions (`durig-core` and
`durig` with recommended extensions), or one system with well-considered optional
extras — and is the feature set bloated with things only some users want?

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
of an unused feature is *not* disk and *not* speed — the per-seat scan is 0.9–1.4
ms. The binding costs are: (a) **prompt tokens on every request**, (b) **which
tools the model sees**, which changes seat behaviour rather than just the bill, and
(c) the test and documentation surface. So the standard is stronger than "not
bloated": **a feature that is off must cost nothing at all** — lazy, declared, and
invisible until enabled. That is also why "useful for most users" is the right bar
for a default and "useful for some" is fine for an opt-in, provided it is truly
inert when off.

**Consequence for how extensions are declared.** Each one declares its own cost
(prompt tokens, tools added), its default, and its blind spot — the discipline
`check` and `metrics` already follow, because a declaration that travels with the
thing is the only kind that stays true.

**Not decided:** which workflows define "recommended" (blocked on item 21), and
which extensions those are. Caveman is far from the only candidate.

## D30 — The security positions that came back (2026-10-11)

**Context:** three items were put to `security.sec` as one consult, because the rig
daemon had been down 2026-10-06 → 2026-10-11 and they had accumulated: the scribe
seat (D27), caveman (ROADMAP item 20), and the measurement change-log debt (D24).
Full position: `docs/reviews/security-sec-deferred-three-items.md`; the row is
`qitem-20261011052207-47265aa238cc43b5`.

**1. Scribe read-all-transcripts grant — FAIL as scoped → adopt-with-conditions.**
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

**2. Caveman — split verdict, and the split is the useful part.** The **skill**
half (plain prompt text) **passes, conditional on being vendored as text rather
than installed**; it is ordinary persona content otherwise, needing no new
mechanism. The **proxy** half is **rejected as specified**: opt-out-by-default
telemetry is necessary but not sufficient, because the proxy reads raw tool output
(which carries secrets) and rewrites the model's view inside the call path. Its
conditions: the prior spike, a runtime **no-egress canary**, redaction, and role
scoping. So caveman is not one adoption decision but two, with very different
costs — which is why item 20 keeps them separate.

**3. The measurement change-log — ADOPT-WITH-CONDITIONS, and the debt is retired.**
`security.sec` prefers **git as the append-only record** over a new store write
path, because the write path would *add* a mutable, untrusted attribution surface
while git is already append-only and hash-chained. Its conditions: `metrics` must
report the committed active set and **flag a dirty tree**; git authorship is not
authentication; and D24's prediction record stays. This turns a deferred write path
(D24, D27, item 14) into a read-only reporting task.

**Standing consequence:** measurement may not add telemetry, egress or a write path
without this consult — and the answer here was "don't add one, use git", which is
now the precedent to cite rather than re-litigating.

## D31 — We dogfood durig on our own work (2026-10-11)

**Decision (operator):** run our own coordination through durig, not only through
OpenRig, so problems surface through use rather than through tests we wrote to look
for them.

**Why it is a decision and not a habit.** It changes where findings come from. The
first session produced six, and one matters more than the rest: a fact D24
recorded as *checked* — that entries carry no `usage` field — is false, and it had
propagated into ROADMAP's gap table, METRICS.md and item 20's "we cannot verify
caveman's savings". Ordinary use found it in one session; three documents repeating
it did not. That is the argument for dogfooding in one example.

**What it does not change.** It is not a substitute for the suite (D17's regression
gate), and it is not licence to ship rough edges: findings are logged in
`docs/DOGFOOD.md`, then fixed or backlogged like anything else. Seats still have no
file access, so dogfooding is scoped to coordination, queue semantics, attention,
measurement and the human views until item 4 lands.

**Evidence:** `docs/DOGFOOD.md`, findings F1–F6. F6 is deliberately positive — a
regression marker for the end-to-end path that worked (decompose → route → queue →
attention → measure).

## D32 — Deferring is reversible, and the human is not a queue (2026-10-11)

**Decision:** a seat that cannot proceed parks the item it holds on a question
rather than guessing or going quiet. Two tools: `defer_work(itemId, question[, to])`
sets `status: deferred` and records the question and the expected answerer;
`resume_work(itemId)` puts it back to `claimed`. Omitting `to` defers to the human
operator and **enqueues nothing**; passing `to` asks a seat and enqueues the
question as real work, gated by the same org edges and capability rules as
`send_work`.

**Why deferring must be reversible.** An item parked with no way back is a silent
death, which is strictly worse than the prose it replaces — at least prose can be
read. So `claimed ↔ deferred` is a cycle, not a one-way exit, and `complete_work`
still refuses a deferred item (you must resume first) rather than letting a seat
finish work it said it could not do.

**Why the human is not a queue.** There is no seat named `human`, and creating one
would be a lie: the operator does not read the queue, they read `status` and
`watch`. So a human deferral produces an attention notice
(`deferred_awaiting_answer`) and no queue item, and `DEFERRED_TO_HUMAN` is a
distinct value from a seat name so a renderer can say *a person* is the blocker.
This is the concrete form of a rule worth keeping: never let a machine launder a
human decision into seat-to-seat traffic, where it would look answered.

**Why a deferral is treated as a send.** The obvious shortcut — route the question
without consulting the edge gate — would hand every seat an unlogged channel to
any other seat, which is exactly what restrictive-by-default edges exist to
prevent. It is checked *before* any state changes, so a forbidden question cannot
leave an item half-parked.

**Reported, not inferred.** MAST puts "no reason to defer to humans" at 6.8%.
The notice is the mitigation: a parked item is durable state, so it survives the
run that created it and is visible without anyone asking.

**Evidence:** `demo/defer.test.mjs` (parks, is visible, resumes, asks a seat, is
edge-gated, refuses a foreign item), `demo/watchview.test.mjs` (parked rendering
and the footer count). Falsified by disabling the edge gate and watching it fail.

## D33 — What we take from the pi-durable demos, and what we decline (2026-10-11)

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
feature was unreachable outside the test that drove it directly — a green suite over a
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
and the "does not transfer" boundary), ROADMAP items 24–25 with 24a–24g,
`demo/primer.test.mjs`, and the falsified primer regression.

**Correction (2026-10-11), same day: two of the gap claims in that review were wrong.**
It said durig "has no stream timeout, no retry policy, no compaction config" and
"never calls `harness.resume()`". Checked against the platform: `resolveSettings`
supplies retry/compaction/progress/queue-mode/context-retention defaults; the `openai`
SDK supplies a 600000 ms timeout and 2 retries; and `cli.mjs` **already calls**
`resume()`. The failure mode is worth more than the fix — the demo's source was read
carefully while durig's own side was described from memory, which is how a review
manufactures gaps. Only the *knob* was real (`stream` has no default), and
`DURIG_STREAM_TIMEOUT_MS` now reaches `Harness.open`. Corrections are marked in place in
the review rather than edited away, because a silently corrected finding teaches nothing.

## D34 — A request id is caller-supplied, and the answer pointer beats the watermark (2026-10-11)

**Decision:** `send` accepts an optional `--request-id`. A duplicate id reuses the
existing submission (the platform's `admitSubmission` returns the existing id when
`submissionByRequest` finds one), so a retry generates nothing and returns the original
reply. The id is **never derived from the prompt text**. When an id is supplied and the
answer already existed before this invocation, the reply is read from the submission's
own answer pointer; otherwise the watermark scan (F7) stays in charge.

**Why the caller supplies it.** An id means "this is the same request as before", and
only the caller knows that. Hashing the text would make two deliberate identical sends
collide into one — silent data loss, which is a worse failure than the duplicate it
prevents. The CLI is driven by LLM operators (D21) and `SENDEXIT=124` is a real outcome,
so "retry this same request" is a thing an operator needs to be able to say.

**Why the answer pointer is not a nicety.** The F7 fix resolves a reply by finding the
newest assistant entry *past* a watermark taken before the run, which is what stops a run
that produced nothing from echoing an earlier send's reply. A reused submission inverts
that assumption: its answer was committed *before* this invocation, so the scan finds
nothing and would report `reply: null` for a request that has a reply. With an explicit
id the submission is unambiguous, so its own pointer is authoritative. The two mechanisms
answer different questions and both are needed — identity when the caller provides it, a
watermark when they do not.

**Pattern worth noticing:** this is the third bug in the same family — F7, this reused-
submission interaction, and the 24a corrections. All three were about *reporting*, or
failing to report, a result that belonged to a different run. The settle/report path is
where durig's subtle defects live, and it deserves the suspicion a shared mutable
watermark naturally attracts.

**Evidence:** `demo/cli.test.mjs` (first use, retry with no second entry and the same
reply, a different id, no id at all, `--request-id` with no value, and no id leakage into
the prompt), falsified by dropping `requestId` from the submission and watching it fail
with `the retry must report that it reused the submission`.

## D35 — The workflows are named, so "recommended" is derived (2026-10-11)

**Decision:** `docs/WORKFLOWS.md` names five workflows — routed delegation, independent
verification, blocked on a question, intake/decomposition/tracking, human oversight — plus
the operator loop for a rig change under measurement. Each states **who**, the trigger,
the **loop that must never break**, what **done** means in observable state, and the
capability it needs. These loops were implicit across the MVP bar, the feature inventory,
the gap table and `RESEARCH.md`; now they are in one place and each can be argued with
individually.

**What it settles.** Two things, and neither was the document's stated purpose.

1. **"Recommended" is mostly rig shape, not extensions.** Every workflow is served by
   the Router — one extension — so what separates a rig that works from one that does not
   is the seats, their models and their edges, which is precisely what `check` already
   fails a rig for. Item 18's profiles should therefore be a preset rig file plus a seed
   list, not a bundle of extensions a user must reason about, and the first genuine
   opt-in candidate is retrieval (item 4, an operator ruling rather than a default).
2. **D21, D22 and D24 were workflow decisions, not architecture decisions.** The roadmap
   flagged them as taken ad hoc; the workflows give each a reason. D21 is W5 plus the
   operator loop — an interactive prompt would be a blocking gate inside W1's
   must-not-break path. D22 is W1–W4 — a seat is a queue participant, and the unit of
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

## D36 — A workflow advocate owns the workflow set, and labels its provenance (2026-10-11)

**Decision (operator):** the rig gains a `workflows` pod with one seat, `advocate`
(`openrig/rigs/tutor-pi/agents/advocate`). It advocates for the people who use durig,
owns `durig/docs/WORKFLOWS.md` and its workflow set, questions any durig change for
workflow impact, and collects feedback. Rig: 15 seats / 10 pods, regenerated spec.

**Why a new pod rather than an existing seat.** `design.ux` already exists and might look
like this role, but it owns the *tutor's* learner-facing surface (math legibility,
accessibility, honest states) — a different product with different users. `scribe` owns
the feature inventory: what durig *does*. The advocate owns what durig is *for* and who
uses it. Three different documents, one concern each, and the same reasoning D27 used to
give `scribe` its own pod.

**The hard part, and the operator named it:** how does a persona collect feedback from
users of a workflow when it may not have any? The answer is to **label provenance rather
than guess**. Every workflow carries one of three classes, permanently:

- **observed** — we ran it (a dogfood session, a demo, an operator report)
- **advertised-elsewhere** — a competing platform documents supporting it, which makes it
  a *candidate*: the workflow is real, but nobody here has asked for it
- **inferred** — reasoned from our own design, labelled as reasoning

**The first honest scoreboard is uncomfortable, deliberately.** Of the five workflows plus
the operator loop, only one (W4, intake/decomposition/tracking) is `observed` in a **live
multi-seat run**, because seats still cannot do real work (item 4). W1 is observed via a
dogfood finding and the walkthrough, W5 and the operator loop are observed through
everyday use, W3 is observed offline only — no live item has been deferred yet — and W2
is **inferred**, since its evidence half does not exist. Writing that down is what stops a
plausible workflow list from reading as a satisfied user base.

**Inventing a user is the cardinal sin here.** A fabricated citation misleads a reader; a
fabricated user need *moves design*. So the role doc forbids it explicitly, and the
practical substitute is that feedback has exactly two real sources today — the operator's
reports and our own dogfood findings, both already recorded — plus roadmap item 26 for
widening the candidate set from competitors' advertised workflows.

**Edges follow one rule**, as D27's did: the advocate reads and questions the seat that
builds durig (`dev`) and the seats whose *work* durig's workflows govern (the build seats,
where delegation and pair review actually run, so their friction is the feedback signal);
it collaborates with `scribe` and `pm` as the adjacent owners; it escalates scope
conflicts to `lead`; and it assigns no work. It deliberately does not observe the content
producers or `sec`.

**Immediate evidence the rig agrees:** `check` against the live store now reports
`store-missing-seat: scribe, advocate` — seat drift found by the rule built yesterday,
which is exactly the class of thing that used to be invisible.

**Evidence:** `openrig/rigs/tutor-pi/{rig.yaml,agents/advocate/**,guidance/pod-workflows.md,workflows-pod.fragment.yaml}`,
`durig/rigs/tutor-pi.rig.json` (15 seats / 15 edge groups, 0 converter warnings),
`docs/WORKFLOWS.md`'s ownership section.
