> **D103 rename (2026-10-18):** this record predates the product rebrand `durig` → `durian-pi`; it keeps the old name so the audit trail stays truthful.

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

## D15 — previous-rig migration: done; instruction optimization rejected by guard

**Decision:** all 13 previous-rig seats migrated to durig
(the generated rig spec, produced by the upgraded converter from the real
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

**Pin move:** `ea448f45` → `42705224` (2026-10-12), the durable **code mode** tranche
(`pi-durable` now depends on a new workspace package `@earendil-works/pi-codemode`, so
the pin's package set grew from four to five and `sync-pi.mjs` now re-applies
`sparse-checkout` on every sync, not only at init — an existing build tree would
otherwise never check the new package out). Rebuilt all five packages; the pinned
sha is upstream tip and **all 38 demos pass on it with no durig code change**.

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

**Finding:** reviewed `docs/Patterns_and_Pitfalls_of_LLM_Agents.md` (the MAST
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
all 13 seats in the generated rig spec resolve to one model while per-seat models
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
pass over the generated rig spec reporting 13 seats and 1 distinct model. Full gap
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
vocabulary it used. Matching on advertised `capabilities` was rejected: the rig's
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
against the live store it found a real, unmasked defect — see D26.

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
the generated rig spec gives `ux`, `sec` and `dev` **no outgoing edge at all**,
and qa/qa2/student lose their declared escalation path; `check` reports
`unreachable-seat` for the three. The D16 fix (blanket edges for pm/lead) masked
most of the loss, which is why nothing caught it.

A second defect rides along: pod-level edges use bare names (`from: impl`) while
rig-level edges use qualified ids (`from: build.qa`), so reading the rig-level
list requires normalising `pod.seat` to `seat`.

**Status:** recorded, not yet fixed — it is a converter concern (one per change)
and the next item in the roadmap. Evidence: the previous rig's `rig.yaml`
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
That is item 4 (M3), and it is a limit on what the product rig can be trusted to do, stated
where the workflow is rather than in a footnote.

**Evidence:** `docs/WORKFLOWS.md` (the workflows and the capability matrix),
`docs/ROADMAP.md` item 21, and the demos each workflow cites.

## D36 — A workflow advocate owns the workflow set, and labels its provenance (2026-10-11)

**Decision (operator):** the rig gains a `workflows` pod with one seat, `advocate`
(the previous rig's advocate agent). It advocates for the people who use durig,
owns `durig/docs/WORKFLOWS.md` and its workflow set, questions any durig change for
workflow impact, and collects feedback. Rig: 15 seats / 10 pods, regenerated spec.

**Why a new pod rather than an existing seat.** `design.ux` already exists and might look
like this role, but it owns the *product's* learner-facing surface (math legibility,
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

**Evidence:** the previous rig's `{rig.yaml,agents/advocate/**,guidance/pod-workflows.md,workflows-pod.fragment.yaml}`,
the generated `durig` rig spec (15 seats / 15 edge groups, 0 converter warnings),
`docs/WORKFLOWS.md`'s ownership section.

## D37 — Long context is a measured durability concern, and a fresh session is not a deletion (2026-10-11)

**Decision (operator):** `docs/Managing_Long_Context_Length.md` is taken as the basis for a
new roadmap section (items 27–30). Three research findings become durig decisions rather
than notes in a digest:

**1. Context pressure is a measure, not new instrumentation.** A seat is a pi-durable
conversation created at `up` and reused for every `send` (`src/rig.mjs`, the Seats doc), so
its context is durable state that nothing watches. It is measurable with **no new write
path**, because stored assistant entries already carry `usage` (`input`/`output`/`cacheRead`/
`cacheWrite`) and a `cost` breakdown through `storage.scanEntries` — the F4 correction that
made the cost measure direct-class. So it extends item 2's token counter and feeds
`computeMetrics`; D24's rule applies unchanged, and a *stored* pressure value would be a new
write path needing a `security.sec` position first.

**2. The trigger is per-model and must be measured, not inherited.** The evidence separates
the *mechanism* (a property of the agent design) from the *threshold* (per model), and
shipped defaults (~90%) sit later than the research recommends (~60–70% of the **effective**
window). Two constraints follow, and both are honesty rules rather than preferences: a
percentage-of-window reading taken against an **advertised** window is false precision and
must not be printed as though it measured usable capacity; and where the harness records
nothing, the honest output is a **declared blind spot** rather than an inferred signal — the
same rule `metrics` already follows when it refuses to judge what it cannot see.
*Checked against the pinned source rather than assumed:* here it **does** record something.
A `pi.compaction` entry carries `reason ∈ {manual, threshold, overflow}`, so a compaction is
observable and attributable rather than a blind spot, and the platform also exposes manual
`Conversation.compact(instructions?, context)`. The unmeasurable part is not the event but
the *effective window*, which is a property of weights and therefore takes a measurement.

**3. A fresh session is a new conversation, never a deletion.** There are two ways to reduce
a seat's context and they are different operations: compaction summarizes in place and
leaves a summary that can be pointed at, while a fresh conversation drops the history
entirely. The platform provides the first — `Conversation.compact()`, recorded as a
`pi.compaction` entry with `reason: "manual"` — and durig exposes neither (`USAGE` lists
eleven commands; `up --refresh` re-applies the prompt without touching the conversation).
The design's main risk, and the reason a fresh conversation is the *expensive* lever, is
that a seat's conversation **is** its
working memory of the item — a naive reset silently loses the task, which is the
literature's summary-induced amnesia and "drops the reasoning, keeps the surface action"
failure modes. Two invariants therefore bind it: what is carried across must be *defined*
(the stored persona, and any item the seat has `claimed`), and the previous conversation is
**retained** — transcript destruction is a named failure mode and a transcript is exactly
what `log`/`watch` read (D-view). A fresh session adds a conversation; it never removes one.

**Why it lives in `FEATURES.md`'s durability section and not observability:** the fact being
managed is that a seat's state accumulates, which is a property of the seat. The display is
the delivery, not the concern.

**Honest state, recorded so the advert cannot drift:** compaction is inherited and
**unexposed** rather than chosen and managed — the mechanism and its record both exist, and
the verb does not — and there is no pressure measure and no fresh-conversation verb. Item 30
is the standing obligation to move `FEATURES.md` section 5's rows from "inherited" to
"managed" as 27–28 land, with the proof column pointing at a demo rather than at prose.

**Evidence:** `docs/Managing_Long_Context_Length.md` (the survey), `ROADMAP.md`
("Long-context management", items 27–30), `FEATURES.md` section 5 ("Context growth over a
seat's life"), and the F4 correction above (entries carry `usage`). The claims in 27–28 about
what the harness records and exposes were read from the pinned source under
`vendor/pi-main/packages/durable/src/` (`entries.ts`, `harness/types.ts`,
`harness/compaction.ts`), not inferred from the research digest.

## D38 — Full shell accepted; the guard is durig's to build, not pi's (2026-10-11)

**Decision (operator).** Verbatim: *"If the seats are using pi-warden extension to protect us
from dangerous tool-calls, I can accept a level of risk with using full-shell initially while
codemode with permissions is developed."* Scope answer = **(a) full shell**, with the M3
conditions SC1–SC3 still required and codemode-with-permissions as the follow-on mitigation.

**The premise is false, and the record must not rest on it.** durig seats do **not** get pi's
guards. Three mechanisms exist in the operator's pi and none of them reaches a seat:

- `arg-guard.js` is a **pi-coding-agent** extension — `pi.on('tool_call', …)`
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
blocking, and sees nested calls through `ToolCall.parent` — strictly stronger than `arg-guard`.
It must land **with** the tools, never after them.

**Risk accepted, stated so it is bounded.** Full shell for author seats means arbitrary code
execution as this OS user *inside a path-confined worktree*. Residuals accepted knowingly: a
command-string allowlist is unsound under PowerShell (so the allowlist only narrows; the
`ExecutionEnv` is the boundary); a seat may defeat confinement by editing what it runs; and the
shared-identity problem `D-ENV-AUTH` remains.

**Not accepted, and not implied: unconfined filesystem access.** Without SC1 a seat can read
`durig.config.json`, `~/.pi`, and `~/.ssh` — credential disclosure, not "a level of risk". SC1 is
therefore treated as **required, not waived**, and the same goes for SC2 (the verifier's
read-only must hold at the filesystem layer, since a shell can write regardless of which tools
it is offered).

**Recorded at the operator's direction and quoting them verbatim.** `security.sec` requires a
non-forgeable operator artifact for a risk acceptance (D-ENV-AUTH); this entry is written by the
operator's assistant on their instruction, which is the strongest artifact this workflow
provides. If it must be genuinely non-forgeable later, re-issue it as an operator-authored
commit.

**Effect on the position:** `security.sec`'s dissent is preserved for the residual shell risk
(`docs/reviews/security-sec-m3-seat-tools.md`); SC1–SC3 are **adopted**, not skipped.

## D39 — The driver probes seat documents through a raw handle, because a harness session fails closed (2026-10-12)

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
**Alternatives:** (a) repair the producing op / rewrite the corrupt base on read —
rejected: a new write path, and #110 forbids one; (b) catch per wake and reopen
the harness — rejected: the bad seat still poisons the session before the healthy
seats are reached, so no work advances; (c) fix the producer inside vendored
`pi-main` — out of scope (pinned vendor, synced by `sync-pi.mjs`). **Status:**
adopted. **Evidence:** `demo/driversurvive.test.mjs` reproduces the exact failure
failing-first (`unresolvable path: ["generation","message","content",0]`, exit 1
against the committed driver) and passes after; full `demo/*.test.mjs` loop 40/40.

## D40 — The interactive client's data layer is separate from its screen, and a partial is not a turn (2026-10-13)

**Decision:** build the interactive client (M4) on a **pure view model** and a
**single read-only read API**, and keep the in-flight partial out of the
transcript model entirely. Concretely:

- `src/viewmodel.mjs` derives turns, collapse state, and the peer navigation graph
  as pure functions over entry/queue records. The peer graph keeps **direction**
  (`sent` vs `received`), because org edges are directional and collapsing them
  would discard the permission the graph exists to show.
- `src/readapi.mjs` is the one importable reader (`readSeatList`, `readQueueItems`,
  `readRigHealth`, `readLiveState`). It is read-only by construction — no harness,
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

**Alternatives:** (a) render the partial as a normal entry — rejected: it would be
indistinguishable from committed history and could be replayed after a crash;
(b) keep the peer graph inside the CLI — rejected: any client needs it, and D21's
whole point is one implementation; (c) choose the TUI now — deferred: the screen
is still the operator's call (STATUS.md, "Decisions needed", #2).

**Status:** adopted; the screen choice remains open. **Evidence:**
`demo/viewmodel.test.mjs` and `demo/livestream.test.mjs` (the latter falsified by
disabling the partial publication), full `demo/*.test.mjs` loop 49/49.

## D41 — A seat may claim a NAMED item, without weakening the held guard (2026-10-13)

**Decision:** `claim_work` takes an optional `itemId`. With no id it keeps the existing
oldest-QUEUED behavior; with an id it claims that specific item only if it is `queued` and
addressed to the caller. The eligibility whitelist is the **same** as the oldest-first path,
so a `held` (non-claimable) item cannot be claimed by id either.

**Rationale:** a queue whose only claim rule is "oldest first" cannot express operator
priority. On 2026-10-13 the PIECE-1 spike (#209) was the operator's explicit START-NOW, but ~20
older queued items sat ahead of it; the work was done via a direct `send` and could **not** be
marked done, because `complete_work` refuses a non-claimed item. `lead` ruled the fix (#214) as
claim-by-id, its own item rather than folded into the `held` state (#90).

**Alternatives:** (a) a priority-mark that reorders the queue — rejected: it only *moves* work,
it does not let an already-bypassed item be *recorded*; (b) fold into #90 — rejected: one
concern per change, and the `held` state is a different concern; (c) leave oldest-only —
rejected: it is the reported defect.

**Status:** adopted. **Evidence:** `demo/rearmclaim.test.mjs` (failing-first: a NAMED newer item
is claimed while an older item stays queued; a `held` item is refused by id), suite 50/50.

## D42 — Concurrent store writes on the send path are retried, not dropped (2026-10-13)

**Decision:** `send` wraps its store commit in a retry helper (`src/storewrite.mjs`), so two CLI
processes writing one store cannot silently lose a message to an entry-id collision. A write that
still cannot be delivered becomes a guided error, not the raw `ID n already belongs to entry`.

**Rationale:** running `send pm` and `send impl` concurrently made one exit
`{"ok":false,"error":"ID 10051 already belongs to entry"}` and the message was **never
delivered**. `genlock` serialises generation *slots*, not store writes, so nothing stopped two
processes allocating the same next entry id.

**Alternatives:** (a) a process-wide store lock — deferred as the heavier change; retrying the
observed conflict is smaller and sufficient for the reported case; (b) do nothing — rejected: a
silent drop is the worst outcome; (c) fix it inside pi-durable — out of scope (pinned vendor,
synced by `sync-pi.mjs`).

**Status:** adopted, with a known limit. **Limit:** only the `send` write path is covered;
`up` and `run` are not yet. **Evidence:** `demo/storewrite.test.mjs` (failing-first collision,
then retried/pass).

## D43 — `worktree` refuses a dirty source rather than forking a partial tree (2026-10-13)

**Decision:** `node cli.mjs worktree <path>` checks the source tree for uncommitted changes and
REFUSES, naming the offending path, when any exist. A clean source proceeds unchanged.

**Rationale:** an isolated worktree forks from HEAD. The operator's uncommitted direct work
(ROADMAP 7/8: `src/readapi.mjs`, `src/viewmodel.mjs`) was absent from the seat worktree, and a
seat's new `src/readapi.mjs` collided with the live 8.9 KB shared read API (#240). A seat cannot
see — and can silently clobber — work it never knew existed; failing loud at fork time prevents
it.

**Alternatives:** (a) carry the working tree into the fork — deferred: larger, and the shared
`node_modules` junction already makes installs hazardous; (b) warn only — rejected: a warning a
run proceeds past is the failure mode being fixed.

**Status:** adopted. **Evidence:** `demo/worktree.test.mjs` (failing-first: a dirty source
produces no silent HEAD-only checkout; a clean source proceeds).

## D44 — A corrupt `pi.live` is repaired by RETIRING its incarnation; a viewer must tolerate it (2026-10-14)

**Decision:** when a seat's `pi.live` document cannot be materialized (P5/#110:
`unresolvable path: ["generation","message","content",0]`), the repair is to **retire** the corrupt
incarnation (storage `document.retire`), so `readLiveState` finds no current document and reads it as
idle `{}`; the next run re-creates a clean one. Independently, a **viewer must never let one
unreadable document kill it** — `readLiveState` catches, warns once, and returns `{}`.

**Rationale:** `impl`'s conversation was wedged — `send` and `reset` both threw, and `stop`+`resume`
did not clear it. A chord root-replace delta `["r", {}]` did **not** reset the materialization base
(the orphaned append is still replayed), so it did not help; only retiring the incarnation removed the
corruption. The viewer rule is the same P5 principle the `run` driver already follows (probe, skip,
report) applied to `log --follow`/`watch`, which crashed on the corrupt seat.

**Alternatives:** (a) root-replace — rejected: it appended atop the orphan and still threw; (b) delete
or recreate the conversation — rejected: loses history and needs registry surgery; (c) hand-edit SQLite
— rejected: outside durig's storage API and the zero-durig-SQL rule.

**Status:** adopted. **Evidence:** `scripts/repair-pi-live.mjs` (run on conversation 9; `watch --once`
silent afterward, `reset impl` succeeded). A first-class `repair` verb is not yet built — a candidate
item.

## D45 — A resident broker reacts to in-process commits; D11's conclusion, not its evidence, is superseded (2026-10-14)

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
**Boundary:** the broker adds **no socket and no new trust boundary** — the trigger
is an in-process callback and the broker only calls `conv.submit` through the
harness it already owns. Per the #238 gate, a `security.sec` position is required
**before code** only if a socket is added later; none is. The broker is the single
long-lived writer, so the cross-process write races of F24/D42 do not arise inside
it.
**No-wake-storm invariants** (PUSH-ARCHITECTURE §3.3, held by `src/scheduler.mjs`):
changes coalesce to one pass; a change during a pass marks the next pass dirty
rather than being lost; a global floor separates pass starts; a per-seat cooldown
stops a repeatedly re-woken stalled claim from hot-looping; the wake text stays
fixed (`WAKE_CONTENT`); an operator-stopped seat is never resurrected; a corrupt
`pi.live` never kills the pass.
**Numbering note:** this is D45. D40–D44 already exist on the operator's
integration line (D44 is the `pi.live` repair there), so the broker entry takes
the next free label rather than colliding.
**Status:** adopted (operator-directed). **Evidence:** `demo/scheduler.test.mjs`
proves the pure coalescing/floor/cooldown rules and wires them to a real harness
commit stream; `demo/run.test.mjs`, `demo/driversurvive.test.mjs`,
`demo/stalledclaim.test.mjs`, `demo/supervisor.test.mjs` stay green.

## D46 — `up` auto-starts the broker, TTY-gated; at most one per database (2026-10-14)

**Decision:** `up` starts the resident broker (D45) for an **interactive** run —
stdout is a TTY, the same rule the human views use (D19) — and never for a piped or
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
cleared on signal/timeout — without it D45's "resident" claim held only for bounded
runs.
**Boundary:** the child is spawned with this command's `cwd` and `env`, and writes
only `<db>.broker.json` and `<db>.broker.log`. No socket, no egress, no new trust
boundary, so no `security` consult is triggered (consistent with D45).
**Status:** adopted (operator-directed). **Evidence:** `demo/autostart.test.mjs`
(`--no-serve`/piped opt out; `--serve` starts a broker that stays resident; `run` and
a second `serve` fail closed; `up --serve` is idempotent; `serve --stop` reaps it and
clears the state; the log shows no unsettled await); full `demo/*.test.mjs` 50/50.

## D47 — `revise_work` and `cancel_work`: the queue can be curated, and `cancelled` is terminal (2026-10-14)

**Decision:** add two Router tools and one terminal status.
- `revise_work(itemId, {subject?, body?})` — the item's **sender or holder** may update a
  **queued** (unclaimed) item; a claimed item is being acted on and refuses revision.
- `cancel_work(itemId, reason)` — either party may cancel a non-terminal item to a terminal
  `cancelled` status, recording the reason on the item.
- `cancelled` joins `done` as terminal, tested by one helper `isTerminalItem(item)`. Every place
  that used to test `status !== "done"` now uses it: `peek_queue`'s non-terminal view, `watchview`'s
  `routed`, and `supervisor`'s `applyEscalations`. The driver already ignores it (it wakes only
  `queued` items and stalled `claimed` runs).
**Why:** F36 — a triage of `selfdev.sqlite` found ~40 of 60 active items stale or mere bookkeeping,
and the queue had no move to cancel a stale item or edit an item's description. The only paths were
"complete it as if done" or let a seat grind it, and the resident broker (D45), waking oldest-first,
does exactly the latter. A queue that cannot be edited accumulates interred work.
**Bounds (why these two parties):** revision is limited to unclaimed work so a run is never changed
under the seat acting on it; cancellation is limited to the two parties so no third seat can
silently drop a routed item. Neither verb generates a notice — the transition and `cancelReason`
are the record — so cancellation cannot itself spawn queue traffic.
**Status:** adopted. **Evidence:** `demo/curate.test.mjs`; full `demo/*.test.mjs` 51/51.

## D48 — Recover the lost worktree, and make shared-tree safety structural (2026-10-14)

**Decision:** three things.
1. **Recover the lost tranche.** The repo split kept the worktree's COMMITTED work and lost its
   UNCOMMITTED work. Branch **`pi-rebase` (commit `3bf61b1`)** held it; each feature is adapted onto
   current `main` as a one-concern item (#307 claim-by-id, #308 worktree dirty-source guard, #309
   `held`+hold/release, #310 store-write retry, #311 event feed, #312 bounded `peek_queue`), plus F34
   (#299). Recover by ADAPTING onto current `main` — never by restoring a whole snapshot file.
2. **Shared-tree safety is structural-first.** Per-task git worktrees are the load-bearing isolation;
   the seatguard git-refusal is a NON-LOAD-BEARING backstop; seats get a documented failing-first
   recipe (run the test RED before the fix) so a revert is rarely needed. A regex denylist must never
   be the thing standing between a seat and the operator's uncommitted work.
3. **Per-worktree dependencies stay on npm** (`npm ci --prefer-offline`), not pnpm.
**Why:** the split lost uncommitted work while keeping commits; and the research
(`docs/Shared_Working_Tree_Safety_Research.md`) shows regex denylists miss 69-98.6% of bypasses for
their target operation and prompt-only rules demonstrably fail — a seat ran `git stash;` and wiped the
whole tree, and a Codex user watched `git restore` run after repeated "never touch git" instructions.
The earlier `node_modules` JUNCTION is the catastrophic pattern (git followed it and deleted main's
source); Git for Windows here is 2.42.0, below the 2.54.0 that fixed `git worktree remove` following
junctions. Measured: `npm ci --prefer-offline` = 12 s / 111 MB, and a fresh worktree ran the
committed suite 52-53; pnpm exited 1 on ignored build scripts.
**Status:** adopted (operator-confirmed: per-task worktrees; npm chosen after measurement).
**Evidence:** `docs/Shared_Working_Tree_Safety_Research.md`; suite 55/56; the per-worktree measurement.

## D49 — Phase 2 of the per-task worktree isolation, and the Job-Object helper (2026-10-14)

**Decision:** #330 Phase 2 landed as six one-concern items (#351–#356): worktree-per-task lifecycle
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
`0x2000` at offset 16; any other size yields `STATUS_HEAP_CORRUPTION` (0xC0000374) — the cause of the
first two failed attempts. This is a deliberate dependency to review at merge; a native addon is the
alternative if the helper proves too fragile.

**Status:** adopted (operator's pointer; delegate-driven). **Evidence:**
`demo/worktree-lifecycle.test.mjs` (19/19, exit 0), `demo/job-object.test.mjs` (exit 0), qa
verifications #365/#367/#369/#371/#373/#376 (PASS); `docs/Shared_Working_Tree_Safety_Research.md` §5.

## D50 — Commit authority moves to the developer (2026-10-14)

**Decision:** the seat that accepts a work item commits its OWN work to its item's branch;
the operator no longer integrates or commits it. Push stays operator-only: `git push` is still
refused unless the operator relaunches durig with `DURIG_ALLOW_PUSH=1`, which the delegate may
then use after committing the item work.

**Why:** D43/D48 were built on the assumption that the operator integrates/commits — the seat
produces files in its worktree and the operator folds them into the tree (that assumption is
stated outright in `src/confine.mjs`: “a seat produces files in its worktree and the operator
integrates them”). With per-task git worktrees now the load-bearing isolation (D48/D49), a
seat's commit is confined to its own item's branch, so the manual operator-commit step is a
round-trip that adds no safety. Commit authority therefore moves to the developer: whichever
seat accepts the item commits that item's work and keeps the history legible, preserving the
scoped-addition safety (explicit-path staging only).

**What is unchanged:** publishing (push) still requires operator authorization; the scoped-commit
safety stands — a seat stages only the explicit paths it changed (unscoped `git add -A` /
`git add .` remain denied), and destructive git (reset/checkout/restore/revert/clean/stash,
branch delete) remains refused.

**Supersedes:** the “operator integrates/commits” assumption in **D43** (worktree refuses a
dirty source) and **D48** (recover the lost worktree), insofar as those entries assumed the
operator is the committer. The worktree-isolation guarantees those entries made are unaffected;
only the commit-authority assumption is replaced.

**Status:** adopted (implemented as 1a/1b/1e). **Evidence:** `src/confine.mjs` (the `git push`
denial is conditional on `unless: () => operatorGranted("DURIG_ALLOW_PUSH")`, and
`operatorGranted` reads `process.env[name] === "1"`); `constitution.txt` P2 Authority: “commit
your own item's work and keep the history legible; never push or publish — the operator holds
push capability (grantable via DURIG_ALLOW_PUSH=1 to the delegate)”; per-seat trailer and
`rig.selfdev.json`/`rig.starter.json` `constitutionInline` regenerated byte-for-byte to match
(#386). Docs changed: `docs/DECISIONS.md`. node --check N/A (docs only).

## D51 — The five Qwen seats move to `zai-org/GLM-5.3-Flash` (2026-10-15)

**Finding:** the operator asked to replace the Qwen family (`Qwen/Qwen3.6-35B-A3B`) with a cheaper
output-token model, naming a fallback chain: `XiaomiMiMo/MiMo-V2.6-Flash` →
`zai-org/GLM-5.3-Flash` → `deepseek-ai/DeepSeek-V4.1-Flash`.

**Decision:** set the five Qwen seats — `impl`, `qa`, `advocate`, `auditor`, `designer` — to
`zai-org/GLM-5.3-Flash`, and apply with `up --refresh`.

**Why GLM, not MiMo or DeepSeek-V4.1-Flash:** MiMo has a documented past failure and was reverted —
it ran `impl` briefly (commit `f7eeb0a`), then `789ead6` returned `impl` to Qwen, and ROADMAP item 42
records "MiMo wandering" — so the chain's first branch triggers and MiMo is skipped. GLM's known
drawbacks (it ignores `cache_control`, ROADMAP item 18; a third-party vLLM long-decode report) are not
*worse* than DeepSeek-V4.1-Flash's documented degeneration into tool-call-as-text repetition loops
(commit `8b20832`), so the chain's second branch does not trigger. Model-family diversity for
independent verification is preserved: GLM (Zhipu) differs from the DeepSeek authors (`pm`/`lead`).

**What is unchanged:** the per-seat model is config, not code — no tool, schema, or write path changed.
`up --refresh` re-applies model + instructions + cwd; it does **not** write a context reset, so the five
seats run GLM over their prior Qwen history until `reset <seat>` is run (the contamination boundary the
operator may still choose).

**Evidence:** `rig.selfdev.json` (five `"model"` fields) and `node cli.mjs up rig.selfdev.json
--refresh` reporting all nine seats `refreshed`; `node -e "require('./rig.selfdev.json')"` parses and
lists no `Qwen`. No push.

**Status:** adopted.

## D52 — PIECE 3 corrected: the broker is a separate resident process that OWNS the session, so the socket path is live (2026-10-15)

**Context (correction, item #411):** the earlier registration of PIECE 3 (#238) carried a flawed
phrasing — recorded as "owns the harness in-process" — that let D45/D46 conclude "no socket, so no
security consult". #238 was cancelled and re-registered as #411 with the corrected architecture:
the resident broker is a **separate resident process** created via `pi.open`, and it **owns the
session lifecycle** (`waitForEmpty`/`sendMessage`), which is what `docs/PUSH-ARCHITECTURE.md` §3.2
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
handshake — D30's D-ENV-AUTH finding means same-Windows-user is not a control; surface bound to
status/wake/subscribe; explicit non-goal: never general remote access; lifecycle cleanup binds to
the D46 pidfile). S1–S7 of that position are the acceptance hooks the implementation must falsify.

**What is NOT decided here:** the socket implementation itself stays gated on this position + a
failing-first demo proving the broker delivers a change to a waiting session it owns (separate
resident process, loopback-only). No socket code has landed; nothing observable changes for the
rig until it does.

**Status:** recorded as a GATE decision (position precedes entry, per the item's gate order). Not
yet implemented.

## D53 — Concurrency clarified: three layers, and only the store/harness is single-writer (CLARIFICATION, 2026-10-15)

**Clarification (records the lead's A1 statement; no new decision):** durig's concurrency is three
layers, and exactly one of them is single-writer, so "concurrency" is not what the single-writer rule
forbids. The rule is a **store/harness** rule, not a **files** rule.

- **Files — concurrent (intended).** Each seat edits its own per-task worktree; concurrent editing is
  the point, not a hazard, because the work is isolated and merged later (D49, `src/worktree.mjs`).
- **Generation slots — capped at N.** `DURIG_MAX_CONCURRENT_SEATS=N` leases N cross-process generation
  slots via `src/genlock.mjs` (D12); N concurrent seats may run, no more.
- **Store/harness — ONE writer per DB.** The store and its harness are single-writer: two `send`
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


## D54 — HELD: a non-claimable queue state with one explicit release transition (2026-10-15)

**Decision:** a held queue state — non-claimable (the claim/wake predicates are whitelist-by-status, so a held item is never claimed and never woken for), entered by hold_work, left by exactly ONE explicit sender transition (
elease_work → queued); no auto-release. A stale claimed item that cannot proceed is parked so the driver does not re-wake it, but nothing silently re-queues it.
**Why:** registered-but-not-ready work previously had to masquerade as claimable (a queue row that was claimed but could not progress), which the driver then re-woke repeatedly. held gives a parked item a real, non-terminal, unclaimable state (#86).
**Status:** adopted (recovered with the lost-tranche work, #309/D48). **Evidence:** the held/
elease_work tools and holderOf/status whitelists in src/rig.mjs; the held-not-claimable-by-id guard is D41.

## D55 — Coordinator read gap: option B — thin-context return keyed by read capability, not role (2026-10-15)

**Decision:** an over-threshold claim result travels per the seat's READ capability, not by role: a seat with NO read tool (pm/lead) gets the full body INLINE (inlineBody: true), because it cannot open a path; a read-capable seat gets the structured head + a path to cwd/.durig/<itemId>.md and reads the body back itself. Over the threshold the return is a DELIBERATE STRUCTURED SELECTION (id + path + the from/to/subject/status head), not a mid-body byte cut. F9 removals are untouched (a coordinator without read tools is not given read tools here).
**Why:** a path a coordinator cannot open is worse than a body — found live on #100, where pm deferred rather than guess; the capability-keyed fallback reconciles the thin-context borrow with #124 (lead #144 option B).
**Status:** adopted. **Evidence:** src/rig.mjs 	hinResultText + the claim_work caller passing { inlineBody: !hasReadTool }; demo/thincontext.test.mjs (over-threshold returns the path for a read-capable seat; small claims stay inline; I ran it, exit 0).

## D56 — Git state-mutation block at the guard layer (2026-10-15) — with a code flag

**Decision (as scoped):** state-mutating git is blocked at the GUARD layer (src/seatguard.mjs beforeTool, the same layer as the push refusal) for all seats; READ-ONLY git (status/log/diff/show/rev-parse) stays allowed, because a seat reverting committed code would silently diverge its worktree.
**CODE FLAG (contradiction — recorded rather than asserted blindly):** the decision as supplied listed commit and merge/
ebase among the blocked verbs. The CURRENT code does NOT block those: git commit is ALLOWED by design (D50 moved commit authority to the developer; demo/confine.test.mjs asserts "git commit is allowed"), and merge/
ebase are not in the deny list. What IS actually blocked (verified in src/confine.mjs DENIED_COMMANDS, and by demo/confine.test.mjs/demo/seatguard.test.mjs, both exit 0): 
reset, checkout, switch, 
restore, 
revert, clean, stash, branch -D, unscoped add -A/add ., and push (push exempt only with the operator's DURIG_ALLOW_PUSH=1), plus the -C <path> forms (including `git switch` and `git -C <path> switch`). If merge/
ebase (and reverting commit) are intended to be blocked, that is a NEW change to request — it is not current behaviour.
**Status:** adopted for the code-true core (destructive git + push blocked, read-only allowed); the commit/merge/rebase clauses flagged as not code-true and NOT recorded as current behaviour.

## D57 — U7 poll-first: the interactive client stays poll-based; Level 2 resident server deferred (2026-10-15)

**Decision:** the interactive client's update path remains POLL-based; Level 2 (a resident server/push path) stays DEFERRED. A <=0.75 s poll meets "immediately" for TURN-based content (a turn is a coarse, slow event; pushing cannot meaningfully beat polling for it). Re-open Level 2 only on a DEMONSTRATED flow-breaking lag in actual use.
**Why:** smallest unblock — push adds a socket/trust surface and a resident server for events that arrive at turn granularity, where poll already lands in time.
**Status:** adopted (deferred Level 2). **Evidence:** the 750 ms poll loop in cli.mjs cmdWatch (setTimeout(r, 750)); demo/watch.test.mjs.

## D58 — Failure recovery vs diagnosis are TWO concerns: escalation in the supervisor, malformed-tool-call as one cause-class (2026-10-15)

**Decision:** escalation lives in the SUPERVISOR (src/supervisor.mjs planEscalations/applyEscalations), not the driver, surfaced as a 
epeated_failure notice; malformed_tool_call is ONE class defined by CAUSE (harness call-arg validation/parse), surfaced via the metrics count + a bounded notice, preferring a structured error kind. A diagnosis signal ADDS a signal only and never blocks the call.
**Why:** recovery (re-drive a stranded/held item) and diagnosis (why it keeps failing) have different owners and cadence; conflating them had a single mechanism trying to do both (#145).
**Status:** adopted (the supervisor escalation pass is code-true: attention.mjs emits kind: "repeated_failure"/last_run_failed, the supervisor plans and applies them). **Evidence:** src/supervisor.mjs, src/attention.mjs, demo/supervisor.test.mjs, demo/malformedcall.test.mjs.

## D59 — P6 quint model as a DECISION entry: formal assurance over the liveness invariant (2026-10-15)

**Decision:** P6 (quint model) is a DECISION entry — formal assurance over the already-found liveness invariant: "no non-terminal item is permanently unwoken". One property, stated and (once modelled) checked, POST-#118 (i.e. after the thin-context/claim contract that #118 half-2 established).
**Why:** the invariant is the property all the driver/broker wake rules protect; a formal model makes the assurance explicit and checkable rather than asserted in prose.
**Status:** recorded (decision to pursue the formal model; the invariant is ROADMAP item 42 / P6). Not yet implemented.

## D60 — Worktree automation: creation is a backlog item, cleanup stays manual (2026-10-15)

**Decision:** per-task WORKTREE CREATION is a backlog item — a --worktree <path|auto> flag with a deterministic path, which must NOT create an F12 cwd/DURIG_SEAT_ROOT mismatch window. WORKTREE CLEANUP stays MANUAL.
**Why:** safety — automated removal collides with the F8 junction hazard, MAX_PATH, and uncommitted work in the worktree; manual cleanup is where the operator can see what is being removed (#175, against D48/D49).
**Status:** decision recorded (creation flagged as backlog; cleanup remains manual). Partial automation to date is the #473 broker wake-path worktree (on-claim create / on-complete remove in src/broker.mjs); the standing --worktree CLI backlog item is separate and unchanged.

## D61 — TUI screen model: a scrollback/pipes-preserving screen; Level 2 resident server deferred (2026-10-15)

**Decision:** the interactive client's screen model is a MAIN SCREEN that preserves scrollback and pipes — it does NOT own an alternate screen (that loses scrollback and pipes, and is the worst-supported combination with tmux, consistent with D21/D22; no multiplexer). Level 2 (a resident server shared by >1 viewer / remote access / 38b) is DEFERRED.
**Why:** the client must not regress the piped/JSON contract or break a terminal multiplexer; the deferred Level 2 is gated on felt sub-poll latency, a second viewer, or a remote-access need that does not exist yet.
**Status:** decision recorded. C3 (src/tui/client.mjs - a headless renderTui/Frame, no storage/harness/driver import, proven by demo/tui-client.test.mjs, exit 0) is built; the U1 driver + ui.mjs entrypoint (#480) are now BUILT too - src/tui/driver.mjs and the root ui.mjs entrypoint exist, proven by demo/ui-driver.test.mjs and demo/tui-conversation.test.mjs - so the earlier "(not built yet)" note is SUPERSEDED. Not pushed.

**Layer-accurate correction (lead ruling #666, 2026-10-16) -- D61's "does NOT own an alternate screen" was over-strong.** It conflated two layers. The accurate statement:
- **Two layers.** (a) The **in-TUI frame rendering** (`renderTui`/`Frame`, headless-only in C3 `src/tui/client.mjs`) is governed by D61 -- it preserves scrollback and pipes at the painting layer. (b) The **entrypoint terminal handoff** (the U1 `ui.mjs` entrypoint) uses the ALT SCREEN -- it declares ``ENTER_ALT "\\x1b[?1049h"`` / ``LEAVE_ALT "\\x1b[?1049l"`` in `src/tui/restore.mjs` (lines 13-14) and wires the terminal via `createTerminalScreen`'s `screen.enter()` on start and a restore-once `screen.restore()` (LEAVE_ALT + cursor + raw-mode off) on EVERY exit path -- not a "driver's onCleanup" argument.
- **Residual, recorded honestly.** While the entrypoint holds the alt screen, scrollback is NOT available DURING the session -- it is restored on EXIT. So "preserves scrollback" is true ACROSS the session boundary and FALSE during it. Not papered over.
- **Direction (ruled).** ACCEPT the alt-screen entrypoint -- it is the conventional, correct handoff for a full-screen TUI (clean restore on exit, no scrollback pollution), and the properties actually required (D21: a separate non-interactive-cli entrypoint; D22: no multiplexer) are PRESERVED. The accurate statement is: "the entrypoint uses the alt screen for a clean handoff; scrollback survives the session boundary (restored on exit), not during the session." RE-OPEN only if scrollback-DURING-session becomes a hard requirement -- then the entrypoint's alt-screen use is itself revisited.
- **Optional note.** The in-TUI screen painting does NOT depend on the alt screen for its scrollback property; the handoff does.

## D62 — Doc-acceptance policy: every new capability carries its own doc acceptance (2026-10-15)

**Decision:** every new/changed capability carries DOC ACCEPTANCE in its own item — the docs/FEATURES.md row, verified by the item's partner-check (qa) — rather than a separate doc chore after the fact. Design/research reports ARE their own docs; decisions go to docs/DECISIONS.md with their WHY.
**Why:** a capability that ships without its provable doc entry is a silent gap; making acceptance part of the item closes it where the work is verified, and matches the scribe's project-level truth role (docs-ownership norm, SELFDEV/WORKFLOWS).
**Status:** adopted (this session's doc-gate items #390/#398/#401/#468–#471/#508/#540 follow it). Files: docs/SELFDEV.md, docs/WORKFLOWS.md, docs/FEATURES.md.

## D63 — Broker lifecycle is an append-only audit log (2026-10-16)

**Decision:** `<db>.broker.log` records `START pid=<pid>` when the wake loop begins, and
`EXIT pid=<pid> reason=stop|signal|max-duration|max-passes passes=<n>` before it returns.
**Why:** `stoppedBy` reached stdout only, so once the process was gone the log could not answer "why
did the broker stop?" — a `serve --stop` was indistinguishable from a crash or a bound. A `START` with
no matching `EXIT` now means an abnormal death (a kill or a throw), because the EXIT line is written
synchronously before the loop returns.
**Status:** adopted; commit `484a571`; proof `demo/broker-log.test.mjs` (RED then GREEN) and
`demo/broker-cooperative-stop.test.mjs` (asserts `reason=stop`).

## D64 — Degeneration guard: the broker auto-resets a seat whose run outgrows its bounds (2026-10-16)

**Decision:** the broker's supervise pass assesses each seat's CURRENT run (entries above the last
`pi.user` wake) and, when it outgrows a conservative, operator-tunable bound (tool-turns / context
tokens / step-repetition / malformed tool calls), writes the EXISTING reset boundary via
`conversation.reset`; the next wake re-anchors the seat from its durable instructions.
**Why:** durig MEASURED `step-repetition` and `malformed-tool-call` but nothing ACTED on them, so a seat
could loop for hours (F29; seen live when `impl` degraded to word salad and wrote junk files).
Idempotent (a page already ending in `pi.reset` is skipped); judged per RUN, so an old degenerate run
behind a wake does not reset forever; bounded, not destructive (the transcript is durable). It resets
BETWEEN runs — a mid-run cut is a recorded residual gap, not part of this decision.
**Status:** adopted; commit `ae96445`; pure detector `src/degeneration.mjs`
(`demo/degeneration.test.mjs`), action `planResets`/`applyResets` in `src/supervisor.mjs`, wired in
`cli.mjs` `superviseOnce`.

## D65 — The broker's pass wait is scoped to the seats it woke, and ends on a commit (2026-10-16)

**Decision:** `drivePass` no longer calls `harness.waitForIdle(context)` (which resolves only when
EVERY ownerless conversation is idle). It waits only on the conversations THIS pass submitted a wake
to, and when the loop supplies its commit signal it races that wait against the next wake-relevant
commit, so a pass ends as soon as a run settles or new work lands. The F11 invariant is preserved by
one global `harness.waitForIdle(context)` drain at `runWakeLoop` exit — the single place it belongs —
so the harness is never closed with a live run. `createWakeSignal` gains `race(promise)`, which drops
the losing side (a leaked keepalive per pass would accumulate).

**Why:** the global per-pass wait parked the whole loop on the slowest run, so a seat that settled
early was not re-woken for its remaining queued work until the last run finished — `status` showed
idle seats with queued work while one run was in flight (observed live: `PASS 5` at 02:26Z, then no
`PASS 6` for ~58 min; a `serve --stop` requested at 02:29Z could not be honoured). The wake-relevant
commit stream (src/scheduler.mjs) already tells the loop exactly when a submission settles or the queue
changes; the pass wait must not ignore it. Measured effect: a cooperative stop under load settles in
~1.8s where the notes recorded multi-minute blocked passes.

**Status:** adopted; commit `b81e171`; proof `demo/broker-liveness.test.mjs` (RED: 1 fast wake in 2s →
GREEN: 2nd wake ~27ms in while the other seat still generates), plus `PASS <n> ms=<dur> woke=<a,b>`
per-pass observability in `<db>.broker.log`. Whole `demo/*.test.mjs` suite green (81/81). The
`idle_with_queued_work` notice is unchanged; a distinct "queued work, no live lease, aged" notice is
still a recorded follow-up, not part of this decision.

## D66 — The workspace switch is a seat tool, not a process-global broker root (2026-10-16)

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
(create → idempotent reuse → per-seat cwd beats `DURIG_SEAT_ROOT` → remove), amended
`demo/seattools.test.mjs`, and the full suite green (82/82). OPEN (operator-raised, delegate-owned):
whether per-seat worktree isolation should be on by default, opt-in, or opt-out — a consult to the
`advocate` seat and competitor research are in flight; this decision records the MECHANISM only, not
the default.

## D67 — Per-seat workspace isolation: the advocate's default recommendation (2026-10-16, RECOMMENDATION)

**Recommendation (advocate, recorded as SA-13 in docs/SELF-ADMIN.md):** make per-item workspace
isolation the DEFAULT, not advisory — conditionally ON by default when the workspace is a git repo;
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
   passes without exercising the change — the W2 false-pass. This is the one conditional.
2. **No silent fallback.** If `DURIG_SEAT_ROOT` remains a fallback for unprepared seats, it must log
   a one-line stderr note naming the root.

**Status:** recorded as a recommendation, NOT yet adopted or implemented. The mechanism (the
`prepare_workspace` tool, D66) is landed and currently advisory. The fail-closed gate plus the two
conditions is the delegate-owned next item; the operator/lead ratifies the default.

## D68 — The broker intent-inbox: deliver intent without stopping the broker (2026-10-16)

**Decision:** a producer spools operator intent as one atomic JSON file in `<db>.broker.inbox/`; the
broker drains the spool at the START of each pass and submits each intent as a real operator input to
its target conversation. An undeliverable intent is dead-lettered to `<db>.broker.inbox.error/` with
its reason, never retried forever. The producer (`intent.mjs`, a separate entrypoint like `ui.mjs`,
D21) never opens the store. Each drain is logged `INTENT delivered=<n> dead=<n>`.

**Why:** the resident broker is the single store writer, so a `send` (which opens its own harness)
required `serve --stop` to deliver intent — interrupting in-flight runs (the delegate hit this
consulting the `advocate`). The F35 stop file proved a file side-channel reaches a resident broker
portably; the inbox generalizes it from "stop" to "tell". Draining before `harness.inspect` makes the
new submission visible to the same pass, so the seat is not also submitted a fixed wake.

**Status:** adopted; proof `demo/broker-inbox.test.mjs` (drain delivers + clears; unknown seat and
unreadable file are dead-lettered; `runWakeLoop` drains through `drivePass`; the producer is pinned as
not opening storage). The `cli.mjs send --async` alias is deferred until `cli.mjs` frees — it currently
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

**Status:** adopted (delegate), commits `f086382` + `c38815f` (detect) and `7d62929` (re-drive);
verified by `demo/degeneration.test.mjs` and `demo/scheduler.test.mjs` (RED before each) and against the
real stored entry `35382` (`pseudo-tool-call=1>=1`). The reset clears that seat's cooldown so the next
pass re-wakes it, rather than leaving a freshly-reset seat idle (observed: the reset alone left impl
idle for 80 s until the process was restarted).
The recurrence is a model/provider format fault (`deepseek-ai/DeepSeek-V4.1-Flash` via deepinfra,
`openai-completions`); the operator keeps that model, so durig remediates rather than swapping it.

## D78 — Repetitive degenerate PROSE is a degenerate run: detect by text, not by tool structure (2026-10-16)

**Decision.** An assistant turn that fills its message TEXT with one short sentence repeated past a
small bound (>=5 occurrences of a normalized sentence of <=60 chars in a SINGLE turn; fenced code
blocks ignored) is **degenerate on the first occurrence**. `assessRun` counts it
(`degenerate-text=N>=1`) and the supervisor resets the seat through the existing reset boundary, with a
handoff that names the fault ("you are looping on your own output ... state each next action once").
Detection is pure (`textDegeneration` / `countDegenerateTextTurns` in `src/attention.mjs`), consumed by
`src/degeneration.mjs`, acted on by `src/supervisor.mjs`.

**Why.** Observed live 2026-10-16: `impl` filled entry `36368` with "Let me emit. Emit. OK. Go. Now."
~30 times, then STILL emitted a structured tool call. Every structural signal the guard had read clean —
`tool-turns`, identical-call `repeats`, harness `malformed` rejections, and the D77 `pseudo-tool-call`
tags were all below their bounds — and the `step-repetition` metric measures repeated TOOL CALLS (0.05,
"ok"), not repeated PROSE. So the run burned minutes per turn, unhastened: exactly the F29 class the
guard exists to catch, because the detector only ever looked at tool-call structure. A run can be
structurally valid and still be thrashing.

**Grounding trap.** The supervisor feeds RAW `scanEntries` items, where `entry.model` is an ARRAY
(`[message]`). The `log` command unwraps it to `entry.model = entry.model[0]`. Testing a detector
against `log`-shaped entries silently blinds every `messageOf`-based signal; test against the raw shape.

**Status: REVERTED (delegate, same day).** The prose heuristic false-positived on real, coherent seat
transcripts the moment it went live: on the broker's first pass it reset `lead`, `advocate`, `scribe`,
and `auditor` (`pi.reset` at 2026-10-16T21:20:32Z). Sentence-fragment analysis over markdown has poor
lexical diversity even in healthy prose (a lead ruling: 123 fragments, 33 unique), and the fragment
length cap discards the varied sentences and keeps the repeated ones — so "distinct-sentence ratio"
cannot separate a word-salad loop from a normal long document. The wiring (`degenerate-text` in
`assessRun`, the reset handoff) and the `textDegeneration`/`countDegenerateTextTurns` helpers were
removed, restoring the pre-D78 guard. **Lesson:** a heuristic that resets context must be validated
against the REAL seat pages of every seat (all false positives zero) BEFORE it is enabled, not just
against synthetic fixtures; and "a false positive costs one reset" is false when the heuristic fires on
every seat. The F29 prose loop still needs a signal that does not parse prose — e.g. a per-turn
wall-clock latency bound (impl's degenerate turns ran 56 s then 122 s while healthy turns ran seconds).


## D79 — Land the complete-but-uncommitted #624 `cli.mjs` artifact and clean the shared tree (2026-10-16)

**Decision.** The operator rules that the complete-but-uncommitted work in the shared tree lands on
`main`, AHEAD of other queued items: `cli.mjs` + `demo/init.test.mjs` (#624 `cmdInit` — clean under
`node --check`, `demo/init.test.mjs` exits 0, row #624 `done`, yet in NO commit),
`docs/SEAT-LIFECYCLE.md` (#819 scribe, after its #823 verify), and the `docs/ROADMAP.md` edit (fold into
the item whose registration it records). Routing is `pm`'s; the priority intent was delivered through the
broker inbox.

**Why.** `cli.mjs` in no commit is the gate blocking items 69/70/71/74/78. NEXT had reserved it to "the
owner or an operator ruling"; the operator gave that ruling. Landing it clears the tree and unblocks the
blocked batch, so the next session starts from committed state.

**Status:** adopted; routed to `pm` (intent delivered 2026-10-16T21:39:38Z). Explicit-path commits only;
never push.

## D80 — Enable reasoning for the DeepSeek seats (`thinkingLevel: "high"`), 2026-10-16

**Decision.** `rig.selfdev.json` now declares `thinkingLevel: "high"` on the five **DeepSeek** seats
(pm, impl, lead, scribe, devtools). Applied live via a broker-safe stop → `up rig.selfdev.json --refresh
--no-serve` → `reset impl` (entry `38233`) → broker restart; committed `f579bb2`. The GLM seats (qa,
advocate, auditor, designer) were left unset.

**Why.** Every DeepSeek seat ran with no `thinkingLevel`, so pi-ai's DeepSeek branch
(`@earendil-works/pi-ai/dist/api/openai-completions.js:668-679`) sent `thinking:{type:"disabled"}` and
omitted `reasoning_effort`; every recent `impl` assistant entry carried `usage.reasoning: 0` and the
seat narrated its own degeneration ("I looped again without acting…"). ROADMAP 43(a) had already
predicted exactly this: the "let me do it" monologue is thinking with nowhere to go but the visible
content. The plumbing (per-seat `thinkingLevel` → `configure` → AgentState) already existed
(`cli.mjs:548/566`; item #635); the value was simply never set, and item #134 was `deferred`. The
`reset impl` was written because a degenerate turn self-conditions every later turn (ROADMAP 44).

**Note / open.** The exact DeepInfra `reasoning_effort` wire type for DeepSeek (string level name vs
integer 1–100) is UNVERIFIED; the vendored `THINKING_LEVEL_MAP` maps only `{off:"none"}` and passes the
other levels through by name. The request-trace item (**#920**, ROADMAP 43c) is the tool that will
confirm it.

**Status:** applied and committed; effectiveness is measured by the `step-repetition` metric (README:
"measures repeated tool calls", so a prose-only loop is its documented blind spot).

## D81 — A cooldown-suppressed wake is re-scheduled, not dropped (delegate, 2026-10-16)

**Decision.** When a broker wake pass drops a real candidate because the seat is inside its per-seat
cooldown (`WakeScheduler.seatFilter`), the loop now records when that seat becomes eligible and runs a
revisit pass then. `driveOnce` reports each dropped candidate via a new `onSuppressed(name)` callback;
`WakeScheduler.msUntilSeatReady(name)` returns the remaining cooldown; `runWakeLoop` schedules the
earliest deadline and, in its idle wait, marks itself dirty at that time (recomputed every pass so a
stale deadline cannot spin the loop; the wait is clamped to ≥ 1 ms).

**Why.** The load-bearing rule is that only a wake-relevant commit or a reset runs a pass. A seat whose
run settles INSIDE the cooldown window triggers a settle-commit pass, gets filtered out by the
cooldown, and then — with no further commit — sits with queued work until an unrelated commit happens
(the "general revisit gap"; observed in the sixth and eighth passes as an idle seat with queued work).
The reset path was already special-cased (`7d62929` clears the cooldown); this generalizes it to the
normal-settle case without weakening the cooldown's anti-hot-loop purpose.

**Alternatives.** (a) Drop the cooldown entirely — rejected: it throttles a repeatedly re-woken stalled
claim. (b) Poll for eligible seats every pass — rejected: burns passes and still needs the eligibility
clock. (c) Have the cooldown expire fire a timer inside `WakeScheduler` — rejected: the scheduler is
pure with respect to `now` (the loop owns time), so the deadline belongs to the loop.

**Proof.** `demo/broker-cooldown-revisit.test.mjs`: one seat, two queued items, a 1500 ms cooldown; the
first wake lands at once and the run settles inside the cooldown, so the settle pass must drop it. RED
against pre-fix code (1 wake in 3000 ms); GREEN after (second wake ~1545 ms in, no external commit).
Affected demos (scheduler, broker, broker-liveness, broker-wake-return, run, stalledclaim,
driversurvive) stay green.

**Status:** implemented and committed (delegate pass).

## D82 — A spooled intent forces a broker pass (delegate, 2026-10-16)

**Decision.** A resident broker now treats a non-empty `<db>.broker.inbox` like a wake-relevant change:
when the wake loop is idle (`!scheduler.shouldRun`) and the inbox has a pending intent file, it marks
itself dirty and runs a pass, which drains the inbox (`drainIntentInbox` runs at the START of a pass).

**Why.** `intent.mjs` exists so the delegate can deliver operator intent WITHOUT stopping the broker
(no second store writer). But `drainIntentInbox` only ran inside a pass, and a resident broker ran a
pass only on a wake-relevant store commit or a reset. A producer never touches the store, so on an idle
broker the operator's intent sat in the inbox until an unrelated commit happened to run a pass —
observed this session when the CRLF/EOL ruling did not reach `pm` after a restart. This is the remaining
half of item 66 ("drain each pass" was not enough; the inbox must FORCE a pass).

**Alternatives.** (a) Have the producer write to the store — rejected: that is the second-writer class
the whole intent-inbox mechanism avoids. (b) Watch the directory with `fs.watch` — rejected: adds a
platform-specific watch and an event source to clean up, and the loop already re-checks every ~1 s when
a dbPath is set. (c) Poll the inbox on a timer regardless of dirtiness — rejected: the idle re-check
plus the dirty gate is exactly this, and `readIntentFiles` is cheap (an `existsSync` + directory read).

**Proof.** `demo/broker-intent-wake.test.mjs`: one seat, no queued work, the broker idle; the test spools
an intent with `writeIntent` and asserts the broker logs `INTENT delivered=1 dead=0`. RED against pre-fix
code (no delivery in 3000 ms), GREEN after. No spin risk: `drainIntentInbox` submits+unlinks or
dead-letters every file, so the inbox is empty after the pass.

**Status:** implemented and committed (delegate pass).

## D83 — Operator ruling: CRLF/EOL stance for the byte-equality tests (#944 / #328 / #766), 2026-10-16

**Decision (the operator's).** `lead`'s #948 policy split is accepted, and the operator has ruled:
- **APPROVED:** make the byte-equality assertions EOL-insensitive (normalize CRLF→LF before comparing)
  in `demo/commit-model.test.mjs`, `demo/seat-commit-instructions.test.mjs`, `demo/starter.test.mjs` —
  `lead`'s option 1; this is the fix for #766/#977.
- **APPROVED:** add a `.gitattributes` — the narrow/file-scoped form (`eol=lf` on the specific tested
  files), NOT repo-wide. A repo-wide `* text=auto eol=lf` is expressly NOT approved.
- **Unchanged:** #975 (stale selfdev test — re-point/drop the `constitutionInline` assertion) and #976
  (starter content drift — re-sync the inline) stay as their own items per `lead` #948.

**Why.** #328 was logged with an explicit operator "do not start" hold on normalizing endings / adding
`.gitattributes` (ROADMAP.md:61-62). `lead` declined to reverse an operator hold unilaterally and
escalated. The operator lifted the hold for this scope only, while declining the stop-the-world
repo-wide rewrite (same class as the held #994 whole-tree Prettier normalize).

**Consequences.** `impl` may now land the EOL-insensitive fix and the file-scoped `.gitattributes`; the
repo-wide EOL rewrite and the #994 normalize still await an operator-declared quiet window.

**Status:** ruled and delivered to `pm` (intent `opr-20261016-eol-policy-944`).

## D84 — Compaction follow-up: guard-authoritative threshold, masking-first ordering, verifier isolation (delegate, 2026-10-17)

**Decision.** The operator's compaction follow-up (`docs/reviews/context-compaction-followup.md`) is
folded in as follows:
- **Threshold:** the inherited pi-durable default (auto threshold ≈ `contextWindow − reserveTokens` ≈
  1.03M for our 1M-configured models) is NOT the basis. The ordered context-pressure guard
  (RANK 4 / #62) is authoritative and must set the platform threshold *above* its own trigger; the
  trigger is ~60–70% of each model's **measured effective** window (report first cut 180–250K).
  (ROADMAP 27 amendment.)
- **Cheapest-first ordering:** mask → summarise → fresh session. Masking is exposed via pi-durable's
  **existing** `ContextEdit { action: "omit" | "replace" }` (ROADMAP 92).
- **Compaction safety:** 28a is blocked on a degenerate stop reason and on a dirty item worktree; the
  summary is a fixed structured schema with a token floor and pinned constraints (93); compaction
  count is capped with a forced fresh session past the cap (94); the summarizer treats in-context
  content as untrusted (95).
- **Verifier isolation:** fresh context is a correctness property — a verifier must not inherit the
  author's summary; retries isolate with a structured failure handoff (96).
- **Evaluation:** probes (recall/artifact/continuation/decision) + replay from the append-only store;
  this also measures the effective window (97).

**Why.** Grounded in `docs/reviews/context-compaction-followup.md` (each external claim carries a URL
+ evidence class). The decisive fact: our configured 1M window makes automatic compaction effectively
unreachable, while the vendor's own GLM-5.3-Flash evaluation stops at 300K and the DeepSeek-V4
precision band is 150–250K.

**Design choice vs established practice (the distinction the report flags).** Most of this is
practice-synthesis, NOT controlled result: the "forbid compaction on uncommitted work" invariant is a
sound synthesis with no controlled study; the retry-isolation rule is inference; the 15× multi-agent
figure does not transfer cleanly (a broker queue of long-lived seats is closer to the 4× agent
multiplier); and masking's advantage is domain-specific (verbose tool output) — our seats' succinct
queue traffic is the regime where summarization is competitive, so the ordering must be revisited
when file tools land (ROADMAP item 4). The report's own **unverified** list (DeepSeek
`reasoning_content` counting, served-vs-advertised window, summary-submission racing,
compaction-count vs GPU starvation, fork-vs-isolate outcome) is carried into the roadmap items rather
than treated as settled.

**Two internals resolved during processing:** masking is already available (`ContextEdit`,
`pi-durable/dist/types.d.ts:262`) — item 92 is exposure, not invention; and `Usage.reasoning` is a
subset of `output` (provider-side input accounting still unmeasured).

**Status:** accepted; ROADMAP items 27/28/30b/RANK 4 amended and 92–97 raised (registered, not
scheduled); delivered to `pm` for sequencing.

## D85 — Language drift is a degeneration cause: reset the seat (delegate, 2026-10-17)

**Decision.** A seat's reply written predominantly in CJK (non-English) is now its own degeneration
cause. `isLanguageDriftTurn`/`countLanguageDriftTurns` (`src/attention.mjs`) judge the VISIBLE reply
text — CJK ideographs/kana vs Latin letters, code spans excluded — tripping at ≥40 CJK characters AND a
≥0.5 CJK share of letters. `assessRun` (`src/degeneration.mjs`) reports `language-drift`, and the
supervisor resets the seat with an English-only handoff.

**Why.** The constitution's P3 Language rule is one line in a large system prompt; a Chinese-family
model (GLM/Qwen) drifts back to its native script under load, and a drifted turn self-conditions every
later turn — so an English directive alone cannot fix it. Observed live: `qa` (GLM-5.3-Flash) completed
#1085 and emitted a long Chinese recap. The reset clears the contaminated context, which is the only
thing that breaks the self-conditioning loop. This is the D77 shape (a fault the repetition/malformed
counts cannot see, because the run is otherwise structurally clean), not the reverted D78 prose
heuristic: it reads the reply's SCRIPT, a categorical property, and the two thresholds keep a quoted CJK
string or a CJK code fixture from tripping it.

**Alternatives.** (a) Instruction-only (strengthen the prompt) — rejected as insufficient: the rule
already existed and failed. (b) Model change — trades away the verifier-independence (different family)
guarantee; an operator/lead call, not a default. (c) Ratio over total characters — rejected:
punctuation/spaces skew it; letters-only (CJK vs Latin) is the language signal.

**Proof.** `demo/degeneration.test.mjs`: a predominantly-CJK reply trips `language-drift` and is reset;
a short CJK quotation and a CJK code span do NOT (negative fixtures); the supervisor's English-only
handoff is asserted. RED before (the export is absent → import fails), GREEN after; full suite 102/0.

**Status:** implemented and committed (delegate pass).

## D86 — Landing is agent-owned with a per-type merge checklist; verify later, do not over-automate (2026-10-17)

**Decision.** Landing a branch onto `main` is an **agent responsibility** defined by the **W6** workflow
(`docs/WORKFLOWS.md`) and the checklist in `docs/runbooks/merge.md`: a **universal** gate (item id + one
concern + explicit paths; independent review of the artifact; `node --check`; the covering demo with
failing-first evidence; clean merge; no push; never merge a snapshot branch) plus a **type block**
(bugfix / feature / research-spike / docs-only). There is deliberately **no `land` verb, no broker hook,
no auto-merge**. Verification is **later and read-only**: the delegate re-runs the branch audit
(the `merge.md` Diagnose block) and closes the gap measured by **ROADMAP item 100** (unlanded-verified
count + time-to-land).

**Why.** The 2026-10-17 audit found 15 branches with verified-but-unlanded work: landing was a **batched,
untriggered step with no visibility**, so completions outpaced it and the branches accumulated while the
store read `done`. The operator prefers **better agent instructions + trust, verified later**, over more
machinery inside the broker/supervisor/durig itself (a stated, deliberately-unarticulated discomfort with
over-automating the system's own operation).

**Alternatives.** (a) Auto-land on `complete_work` — rejected: more broker/supervisor machinery, against
the operator preference, and it would bypass the per-type gate. (b) A blocking `check` gate — rejected
for now: verification is periodic, not stop-the-world, and an upstart project should not add ceremony
that has not demonstrated value. (c) Leave it unwritten — rejected: the runbook + W6 are the instruction
half, and item 100 is the value test.

**Value test.** If item 100's unlanded count stays near 0 without prompting, the process earns its place;
if it regularly exceeds a threshold, the landing step wants a different trigger — not more process.

**Status:** docs landed (`d1326da`); ROADMAP item 100 registered; the one-time landing pass routed to
`pm` (`opr-20261017-landing-pass` + pre-flight `opr-20261017-landing-preflight`).
## D87 — Degenerate PROSE is detected by a NAMED-PATTERN registry, validated against real pages, 2026-10-16

**Decision.** Revive the prose-degeneration guard as a small NAMED-PATTERN registry (`TEXT_PATTERNS` in
`src/attention.mjs`): each pattern is a **pure predicate over ONE assistant turn's text**. `assessRun`
counts matches PER PATTERN and the reason names it (`degenerate-text=<pattern>=N`); `src/supervisor.mjs`
gives the prose cause its own named reset handoff. Adding a future shape is one new entry, not a change
to the detector, the supervisor, or the test plumbing. The first (and only) pattern is
`short-sentence-wall`: a turn whose longest **unbroken** run of short (<= 30-char) sentences is >= 60
long while using <= 20 distinct phrases — the observed shape `Emit. OK. Go. Now.` / `Completing:`.

**Why a wall, not a fragment count.** D78 counted ABSOLUTE repetition of sentence fragments (>= 5), and
a healthy long document repeats fragments constantly, so it false-reset five healthy seats. The wall
metric is structural: healthy prose breaks the run with longer sentences and varies its short ones, so
it does not fire; a real loop is a wall of near-identical micro-sentences.

**Evidence (real pages, not fixtures).** `scripts/degen-scan.mjs` over the live selfdev store: 5636
assistant turns scanned, **26 matched, 0 false positives** (every match is an emit/completing/deferring/
read/issue wall or an XML tool-call-as-text blob). `demo/degeneration-text.test.mjs` pins 3 POSITIVE and
6 NEGATIVE turns pulled from the store (`demo/fixtures/degenerate-text/`).

**Correction to D78's evidence.** D78 cited "a lead ruling: 123 fragments, 33 unique" as proof that
healthy prose has low fragment diversity. That turn is entry `36004`, and it is ITSELF degenerate: it
ends in a wall of ~60 identical `Completing:` sentences (measured: longest short-sentence run 64, 5
distinct). So D78's "false positive" on `lead` was a TRUE positive, and its diversity argument rested on
a degenerate sample. The genuinely healthy turns v1 also reset (`advocate` 36335, `scribe` 35168/35231,
`auditor` 22137) are the negatives the registry is proved against.

**Status:** adopted (item #875). D78's detector `97a3c6d` stays reverted (`449e870`); this is a distinct
design, validated before enabling as D78's lesson requires.

## D88 — Defer the external PM adapter; elevate the task interface + storage format (operator, 2026-10-17)

**Decision.** An external PM adapter is **deferred** and its backlog items are **parked** (ROADMAP
116–123); the only PM work elevated is the **task interface + storage format** (ROADMAP 115): one stable
`TaskSource` contract and a versioned `Task` schema, used by the internal queue and, when prioritized, by
an external adapter. `RigQueue` stays the execution system of record; the external PM is a **human front
door + status mirror** (PM → queue intake; queue → PM status). Design of record: `docs/PM-ADAPTERS.md`.

**Why.** The whole motivation for an external PM is **a human adding and organizing work** — an interface
concern, not agent throughput. The research (`docs/reviews/llm-agent-project-management-tools.md` +
`-followup.md`) established feasibility and practice but no outcome evidence, so the benefit is unproven;
building the adapter first would be high-cost, low-observed-value. The interface/schema is low-regret: it
is useful internally (stable contract, versioned schema) and makes a future adapter a translation layer
rather than a migration. The research also showed the human's organization is lost without a
`priority`/`rank` the queue honors and an `assignee` distinct from the seat `to`.

**Alternatives.** (a) Build the MCP adapter first — rejected: unproven value, and remote/HTTP vendor
servers conflict with the no-seat-credential posture. (b) Treat the external PM as a peer system of
record — rejected: it makes a second writer to task state, against the single-writer discipline.
(c) Change nothing — rejected: the schema gap (no priority/order/human fields) is cheap to close now and
expensive after other code depends on the current shape.

**Status:** direction recorded; ROADMAP 115 elevated, 116–123 parked; `docs/PM-ADAPTERS.md` is the design
of record.

## D89 — Seat worktrees move out of the project root and must not inherit a dirty shared tree (delegate, 2026-10-17)

**Decision.** The project root should not accumulate `item-*` worktrees: `prepare_workspace`'s worktree
root moves to a single ignored location (a sibling `<root>.worktrees/`, or one hidden dir), and the
broker sweep covers it (ROADMAP 125). Immediately, 28 terminal-item worktrees + 2 verification scratch
were **relocated** to `../pi-opendurig.worktrees/` with `git worktree move` (no work discarded); the 5
live/held/deferred worktrees remain in `item-*`.

**Why.** Each claimed item gets its own git worktree (the isolation model), and they pile up because the
safe sweep removes **clean** orphans only, while `carryVisibleState` copies the shared tree's in-flight
changes into every new worktree — so most are *born dirty* and never swept. The clutter is filesystem-only
(the worktrees are gitignored) but it makes the workspace intimidating for a human to read.

**Alternatives.** (a) `git worktree remove` the dirty orphans — rejected: it would discard uncommitted
work (D60). (b) Archive each worktree's diff to a patch — heavier and lossier than `git worktree move`,
which keeps every file and branch. (c) Leave them — rejected: the operator asked for a tidy workspace.

**Status:** relocation done (28 + 2 moved, 5 kept); ROADMAP 125 registered;
`docs/runbooks/leaked-worktrees.md` documents the relocate-don't-destroy step.

## D90 — Runbook discoverability is onboarding: the entry point and the constitution must say the runbooks exist and when to consult them (delegate, 2026-10-17)

**Decision.** The delegate entry point (`AGENTS.md` clock-in + "Where to read further"), the durig skill
(`.agents/skills/durig/SKILL.md` clock-in + references), and the seat **P3 Runbooks** rule in
`constitution.txt` now name `docs/runbooks/` and its symptom index, and require **reading the matching
runbook before improvising** on an operating situation it covers — not only authoring one when a procedure
changes. The research runbook (`research-request.md`) is called out explicitly for commissioning research.

**Why.** On 2026-10-17 the delegate answered a research-consume question before running the
`research-request.md` **Diagnose** step and before writing the required prompt, because nothing in the
first-read path said the runbooks existed or when to use them. `docs/runbooks/README.md` states the intent
("a seat reads a runbook when woken into a situation it does not own"), but the constitution's P3 Runbooks
only covered *authoring*, and the entry point/skill pointed at `SELFDEV.md` and `NEXT.md`, not the runbook
set. A procedure nobody is told to read does not fire.

**Alternatives.** (a) Add machinery that auto-suggests a runbook from `status`/`check` — deferred:
executable `Diagnose` blocks are ROADMAP 85, and the immediate failure is discoverability, not retrieval.
(b) Leave the pointer only in `SELFDEV.md`'s References — rejected: a fresh session and a fresh seat read
the entry point/constitution first. (c) Prose reminder without the "before improvising" trigger — rejected:
the trigger is the part that fires when a situation arrives.

**Status:** committed (`fa4b22f`). The `constitution.txt` change is pending live application to seats via
a broker-safe `up --refresh` (dry-run confirms `constitution.changed=true`); recorded in `docs/NEXT.md`.

## D91 — A standing `security` seat, not only an external consult (delegate, 2026-10-17)

**Decision.** durig declares a 10th seat, `security` (GLM-5.3-Flash), owning threat models, trust
boundaries and secret hygiene. It is deliberately **not** a verifier — its name/role avoid `checkup`'s
`VERIFIER_TERMS`, and `checkup`'s own comment anticipates this ("a security seat audits its own surface")
— and it keeps full working tools. Edges are wired both ways and an ownership class added.

**Why.** Every trust-boundary review (a socket, an execution surface, a dependency, a write path) waited
on the operator routing an external consult, and no seat owned security: the team verifies *correctness*
(qa/auditor) but owns no threat model. The seat's first outputs show the gap was real —
`docs/runbooks/leaked-secret.md` (#1300), a HIGH finding that the commit path has no secret gate (#1315 →
**#1317**), and the ratified codemode position (#1321, `docs/reviews/security-codemode-position.md`).

**Alternatives.** (a) Keep the consult external-only — rejected: latency, no standing owner, no local
knowledge of durig's boundaries. (b) Assign security to `qa`/`auditor` — rejected: they verify
correctness, and `checkup` deliberately excludes a security seat from the verifier terms. (c) A seat with
no working capability — rejected: it must read code and write positions. Persona method borrowed from the
vendored agency-agents security personas (MIT; `vendor/eval/agency-agents/security/`), not invented.

**Status:** created and running (`rig.selfdev.json` `f701837`; broker pid 37376). The external
`security.sec` consult is superseded for durig's own surfaces; whether it is retired or kept for
compliance/live-ops depth is `lead`'s ruling (queue #1318).

## D92 — Codemode's ratified security position (ROADMAP 32 gate 1): E1–E14 ratified with C1–C3, six consult questions answered, gates G1–G8 (security #1295, recorded by scribe #1329, 2026-10-17)

**Decision.** The `security` seat's per-item position `docs/reviews/security-codemode-position.md`
(rev `4cba82f`, branch `security-item-1295`, item #1295, delivered #1321) is the ratified security
position for codemode, and ROADMAP 32's gate 1 ("a `security.sec` position" — new dependency, new
execution surface, its own audit sink) is satisfied by it. The position realizes the gate as: the
boundary's scope (per-script minted `api.*` over an effect broker, SC1 spine, D-ENV-AUTH same-user
fact); **E1–E14 ratified with three corrections** — C1: a thread escape with the same Windows user
reaches broker process memory (the store handle, the provider key in env), sharper than "language
isolation only"; C2: the audit sink records **denied** effects too, not only allowed ones (now gate
G1); C3: cite-by-reference library claims must be re-verified against the vendored library before the
fold into `docs/CODEMODE.md`; **all six consult questions answered** — Q1 mint+SC1 sufficient for T0
(read-only/compute), host containment REQUIRED before T1/T2; Q2 the audit sink is git-backed
append-only, readable broker-stopped, a prerequisite before ANY tier; Q3 `model.call` NOT minted in
the first cut (credential surface nameably unverified); Q4 `proc.exec` never the boundary, rejected
in T0/T1; Q5 containment without a runnable deny-demo does not exist; Q6 the mid-run bound is a
security control, live evidence = this seat's own 2026-10-17 turn-stall reset
(`turn-duration-ms=312487>=300000`); **gates G1–G8** (audit sink first, mid-run bound, bounds fail
closed, offline demo probes for E1/E3/E4/E7/E8/E11/E12/E14, ROADMAP 32's two-layer denial proof,
supply-chain pins, declared = granted = minted equality, deviation needs a new consult); and
**residual risk stated** (thread escape reaching broker memory; seat egress + credential surfaces
nameably unverified and unminted; the gate-1 fold still open until lead/pm folds).

**Why.** ROADMAP 32 gates codemode on a `security.sec` position with a two-layer denial proof. The
delegate-authored round (`docs/reviews/security-codemode-review.md`, E1–E14) was the input; the
position is a **different writer** ratifying it (two-eye principle), correcting what the round
under-stated (C1–C3) rather than accepting it on the delegate's authority. The six consult questions
were the open items; answering them fixes the boundary before any codemode tier lands. T0
(read-only/compute: `fs.read` + `fs.list`) is cleared conditionally; T1/T2 stay gated on host
containment + the audit sink (ROADMAP 128/129).

**Alternatives.** The position is the corrected form of the round: per-claim acceptance with the
corrections recorded, and the residual risks named rather than buried. Per the position's Routing
section, adoption and the fold into `docs/CODEMODE.md` gate 1 are **lead/pm's** call; the operator
has now made that call (impl #1298 folds the position and closes the gate — it does not decide C1–C3/
G1–G8, which are the seat's position; anything beyond gate 1 goes to lead).

**Status:** ratified by `security` (#1295, delivered #1321); recorded by `scribe` (#1329). Artifact:
`docs/reviews/security-codemode-position.md` @`4cba82f` (branch `security-item-1295`; carried in the
#1310 landing pass). Gate-1 close lands with impl's fold (#1298); T1/T2 are NOT released by this
entry (containment + audit sink still gated; T0's held items #1268/#1269/#1270 unchanged). No
executable check applies (a narrative decision log). LANDING NOTE: main's D91 is the delegate's
seat-creation entry; scribe's standing-surface/consult ruling (lead #1297 as revised by #1316,
branches scribe-item-1301/1323, currently numbered D91) must be renumbered (recommended D93) or
folded into D91 at landing to avoid a collision.


## D93 — The `security` seat's standing surface is runbook-only, and the external `security.sec` consult is on-escalation (lead #1297, revised by lead #1316; recorded by scribe #1301/#1323, 2026-10-17)

**Decision.** Q1 — STANDING SURFACE = RUNBOOK ONLY (TWO runbooks; no standing review set). The `security`
seat owns two runbooks under `docs/runbooks/`:
- `docs/runbooks/leaked-secret.md` — the failure-mode SYMPTOM: a secret was committed → detect/respond
  (ties #828 read-side detection + #837 redaction);
- `docs/runbooks/security-trust-boundary-review.md` — the review METHOD: how to review a trust boundary;
  reusable across reviews and broader than the leaked-secret scenario.
There is NO standing `docs/reviews/security-*.md` set — reviews remain per-item artifacts
(`docs/reviews/<topic>.md`), exactly as `qa`/`advocate` produce per-item reviews and own no standing set.
Q2 — `security.sec` CONSULT = ON-ESCALATION (not retired, not fully retained). The internal seat handles
routine security review (fast, free, always available); the external consult is engaged only when the
seat escalates (high-stakes, uncertain, or beyond the seat's depth). CAVEAT (operator-facing): if a
compliance requirement mandates independent external review regardless of the seat's judgment, that is a
STANDING (non-discretionary) trigger — the operator must name it; absent that, on-escalation is the
default. NOTE: capability `review`, not a verifier — so `security` does NOT take the verifier exemption
(it works in worktrees when it has a claimed item), consistent with lead's #1222 blast-radius ruling.

**Revised (#1316).** Lead's #1297 ruled "ONE runbook" (failure modes + review method); lead #1316 REVISED
that on the seat's content-based report: the review method gets its OWN runbook and `leaked-secret.md`
keeps ONLY the failure mode (the method section is MOVED, not duplicated). Rationale: ONE CONCERN PER
ARTIFACT — a failure-mode runbook and a review method are distinct concerns; bundling makes
`leaked-secret.md` do two jobs (respond to an incident AND teach a method). #1297's "one runbook" was a
minimality instinct; the method's broader scope (any trust boundary, not just secrets) is the deciding
factor. The new runbook must follow the runbook convention: front-matter per `_template.md`, a Diagnose
step, and a Verify step that has actually run; plus its README symptom/mechanism row.

**Why.** The smallest surface that makes the seat effective: runbooks for its failure modes and its
review method, satisfying P3 Runbooks (a failure mode the work covers gets a runbook), without the
maintenance burden of a standing review set. The consult is a depth/compliance backstop, not a routine
path.

**Alternatives.** Q1: (a) one runbook bundling failure mode + method — REVISED: two concerns in one
artifact; (b) both a runbook AND a standing `security-*.md` set — rejected: a standing namespace goes
stale and duplicates per-item reviews; (c) only a standing review set, no runbook — rejected: the team
has security failure modes and runbooks are symptom-indexed procedures. Q2: (a) retire the external
consult — rejected: it preserves depth the internal seat may lack on high-stakes/uncertain work;
(b) keep it as a routine path — rejected: it would duplicate the seat.

**Status:** ruling #1297 (as revised by #1316, delivered #1299/#1318) by `lead`; recorded by `scribe`
(#1301, amended #1323). Routed: #1300/#1315 → `security` authored `docs/runbooks/leaked-secret.md`;
#1322 → `security` authors `docs/runbooks/security-trust-boundary-review.md` (review method; front-matter
per `_template.md`, Diagnose, Verify actually run; README row) and REMOVES the method section from
`leaked-secret.md` (moved, not duplicated). OPEN FOR OPERATOR: the compliance caveat — name a mandated
independent external review and it becomes a standing (non-discretionary) `security.sec` trigger rather
than an escalation.

## D94 — Reduce crash exposure: reads get true read-only opens, writes go through the broker spool, `send` is retired (delegate, operator-accepted, 2026-10-17)

**Decision.** Three coordinated changes to shrink the surface a user command can use to crash durig:
(1) **Reads get true read-only opens** - every read verb (`ps`, `queue`, `status`, `log`, `events`,
`watch`, `metrics`, `check`, `config`, `ui.mjs`) must open the store without migration DDL / without
`BEGIN IMMEDIATE`, so a read cannot contend with the broker's single write lock. (2) **Writes go through
the broker** - generalise the `intent` inbox into the command spool (ROADMAP 71 / #912): every mutating
verb becomes a typed request the broker applies, its result read via `log`/`watch`/`events`. (3) **Retire
`send`** (and its bounded-send item #252): it already refuses while a broker drives and opens a full
writing harness - a second owner; its delivery job is `intent`.

**Why.** The 2026-10-17 ~17:29Z broker crash (`SessionFailed`, `wake-failed` qa/lead) is the
lock-contention class; the operator's directive is that a user command must not be able to crash durig.
The mechanism is VERIFIED in code: `openStore` -> `SqliteStorage.open` ->
`applySqliteMigrationsForSchema` runs a `BEGIN IMMEDIATE` transaction + `CREATE TABLE IF NOT EXISTS` on
every open (`vendor/pi-main/.../storage/sqlite/node.js:114`, `.../migrations.js`), against the broker's
single write lock, with a 5000 ms busy timeout. Splitting reads from writes lets reads stay fast and
lock-free while writes get true single-writer serialisation.

**Not verified (honesty).** The specific 17:29Z crash cause is UNVERIFIED: pi-durable throws a generic
`SessionFailed` and nothing in durig logs its nested `cause` (`grep .cause` in `src/`/`cli.mjs` is
empty), so the actual SQLite error was never captured. A required fix is to log `SessionFailed.cause`
on `wake-failed`.

**Alternatives.** (a) Route reads through the broker too - rejected: adds latency/complexity to solve
what a read-only open solves directly (reads were historically safe only semantically, not in the lock
sense). (b) Delete `send` outright - deferred in favour of a thin spool alias first (keeps the DX, zero
crash opportunity), then removal.

**Status:** accepted by the operator 2026-10-17; routed to `pm` (`opr-20261017-broker-routing`,
`opr-20261017-rulings-batch4`). Work items: ROADMAP 71 / #912 (spool, HELD -> prioritise), the
read-only-open fix, `send` retirement / #252. **Flagged gap:** `cmdUp` (`cli.mjs:476-760`) has NO broker
guard - `up --refresh` is not refused while a broker drives. No executable check applies yet.

**Addendum (2026-10-18, #1931) — `resume`/`doctor` stays a DOCUMENTED REFUSAL, not a spool op.** Of the
ROADMAP 71 residue, the `resume`/`doctor` settle path is deliberately NOT routed: with a broker alive,
the broker ALREADY settles stranded submissions itself — at startup (`reconcileBrokerStartup`) and at the
start of every pass (`reconcileStrandedSubmissions`, logged `STRANDED settled=N`) — so an external
`resume` has nothing to do, and routing it would add a second writer for work already done. The operator
accepted EITHER route-or-document; this records the choice. The refusal message now NAMES the reason
(`cli.mjs` `refuseWhileBrokerDrives("resume/doctor", <detail>)`) and points at
`docs/runbooks/resume-while-broker-runs.md`. (The sibling `up` residue, #1930, is a real second writer and
is being routed separately.)

## D95 — The degeneration guard judges per-turn causes on ASSISTANT turns and its context bound against the seat MODEL's effective window; saturation is recovered by `compact`, not reset (delegate, 2026-10-17)

**Decision.** `src/degeneration.mjs` `assessRun` must be corrected on four points: (1) per-turn causes
(`turnDurationMs` and any other duration-derived cause) read **assistant** turns ONLY — a `pi.tool-result`
entry's `durationMs` is TOOL time, not a model stall; (2) the run window must survive the broker's
per-turn `pi.user` wake (assess across the last N turns, or treat context pressure as a seat-level signal
that persists); (3) the context-pressure bound resolves from the seat's **model**, via the existing
`DURIG_CONTEXT_WINDOW` seam (`src/config.mjs` `declaredContextWindow(config, modelKey)`) and the
measured > declared > advertised denominator in `src/context.mjs` (ROADMAP 27) — not the fixed
`maxContextTokens: 400_000`; (4) the reset must be idempotent against the handle that writes it (the
broker's long-lived read handle must observe its own `pi.reset`, or the idempotence check is dead). The
recovery for a saturated seat is **`compact`** (summarize the prefix, keep the transcript), run by the
delegate/operator in an operator-declared broker-stop window — a seat cannot stop the broker it lives in.

**Why.** The 2026-10-17 `qa-context-degeneration` incident: qa degraded at **367,559** tokens while its
model `zai-org/GLM-5.3-Flash` **advertises ~1,048,576** — "advertised != usable" exactly as ROADMAP 27
warns — and the guard fired **0** times because the per-turn `pi.user` wake kept the run window at 1–2
turns so `contextTokens` never reached the fixed 400k. The SAME guard over-reset `impl` **285+** times:
`#72059` is a tool-result (`ran=123 fail=0`) at `durationMs=301,935` misread as a 5-minute model turn,
and the reset never stuck (20+ consecutive `pi.reset` ids 72099–72118) because the broker's read handle
did not see the reset it wrote.

**Alternatives.** (a) Lower the fixed constant — rejected: a guess that is wrong for every other model
(the whole point is that the usable window is a property of the weights, per ROADMAP 97/#1087).
(b) Add another prose pattern — rejected: the failure was not a text shape (D78 already taught this).

**Status:** routed to `pm` as **`#1703`/`#1704`/`#1705`** (+ model-bound addendum
`opr-20261017-degeneration-guard-model-bound`); **NOT landed** — queued to `impl`. Incident:
`docs/incidents/2026-10-17-qa-context-degeneration.md`; procedures: `docs/runbooks/degeneration-guard.md`,
`docs/runbooks/seat-reset.md` § Context saturation.

## D96 — Adopt the Microsoft Agent Governance Toolkit's fail-closed, ratchet, and agent-SRE patterns for durig's agent security and healing; reject its identity/mesh/compliance stack (delegate, 2026-10-17)

**Decision.** The operator-directed competitor review of `microsoft/agent-governance-toolkit`
(`docs/reviews/agent-governance-toolkit-review.md`, clone HEAD `cfb44576`, MIT) is accepted. Adopt into
the backlog: (a) a single **fail-closed** seat-action decision point (deny on evaluation error, no
fail-open flag) and a **structured refusal** shape (`rule_id`/version/action/timestamp); (b) a
**monotone risk/context ratchet** (grow-only, never lowered by a later quiet turn, inherited on
delegation) for the degeneration/context guard; (c) a **per-seat circuit breaker** that isolates a
repeatedly-failing seat until an explicit `reset`; (d) a **structured incident lifecycle** with typed
signals and dedup/correlation windows for `docs/incidents/` + `attention`; (e) **rollback + approval
fields** on runbook steps (extending ROADMAP 81–88/87, not replacing); (f) **behavioural chaos faults**
and rogue-detection **entropy/z-score** signals; (g) **orphan detection + credential rotation**; and
(h) an **advisory→blocking graduation gate** with rollback. Registered as ROADMAP **133–144**. A
follow-up addendum (same session) **corrected the first pass's rejection of "compliance mappings"**: the
**OWASP Agentic Top 10 (ASI01–ASI10)** is a directly applicable external checklist and is adopted —
ASI self-assessment (145), security-lint `check` rules (146), deny-by-default per-item budgets (147),
output screening for secrets + PII (148), reversibility-aware approval (149), and vendored-code
supply-chain hygiene (150) — registered as ROADMAP **145–150**; the enterprise certification mappings
(SOC2 / EU AI Act / NIST / ISO) remain out of scope. **Reject** its Ed25519/DID mesh, execution rings,
0–1000 trust scoring, multi-language SDKs, and multi-tenant isolation as wrong-layer for a
single-operator local rig; the least-privilege principle is already ROADMAP 60.

**Why.** durig had no single named deny-on-error contract, its degeneration detector is blind to the
chaotic (high-entropy) pole and can forget a signal once the assessment window moves, `src/supervisor.mjs`
escalates a failing seat but never isolates it, and the new `docs/incidents/` class has no dedup or
lifecycle. AGT's specs + Python/.NET/Go implementations supply verified designs for exactly these gaps.
The role split is unchanged: AGT governs actions inside a process; durig owns durability, the store,
seats, and the landing path, so nothing here replaces a durig component.

**Evidence class.** `observed` for AGT's design and implementation paths (specs, ADRs, and the
`agent-governance-python/...` modules cited per claim in the review); `inference` for the durig gap
mapping, which cites durig's own `src/` files. AGT is a **public preview**: quarantine is a removed stub
and the circuit breaker never enters `HALF_OPEN` (`docs/specs/AGENT-HYPERVISOR-EXECUTION-CONTROL-1.0.md`
§13; `AGENT-SRE-GOVERNANCE-1.0.md` §6.1) — so each adopt is validated against code, not the spec.

**Alternatives.** (a) Adopt AGT as a dependency — rejected: wrong layer (no durable queue/store/seats),
and Python/.NET/Go with no Windows-first story here. (b) Skip the review as too enterprise — rejected:
its fail-closed, ratchet, breaker, and incident-lifecycle designs are small, deterministic, and map
directly onto the live degeneration-guard (#1766–#1769) and crash-proofing (ROADMAP 78) work.

**Status:** accepted by the delegate per `docs/runbooks/competitor-review.md`; items registered
**not scheduled** (ROADMAP 133–150 after the addendum); sequencing intent `opr-20261017-agt-review`
delivered to `pm`. Review: `docs/reviews/agent-governance-toolkit-review.md`; comparators:
`docs/COMPETITORS.md`.

## D97 — A re-review of an already-reviewed project forks on the prior review's artifacts: missing any required artifact forces a full quality redo, not a freshness delta (delegate, 2026-10-17)

**Decision.** `docs/runbooks/competitor-review.md` prompt 3 splits "re-review" into two modes chosen by an
**objective artifact checklist**, not by the request's wording: (a) **quality redo** (the full deep brief)
when the prior review lacks any required artifact — header, surface-inventory table, "not read" list,
standards table, coverage matrix — or when a new concern/surface is in scope; (b) **freshness delta**
(unshallow fetch, diff `<old HEAD>..<new HEAD>`, re-check only the touched adopt/reject calls) only when
those artifacts exist. The Diagnose step routes an already-reviewed project to this fork; the anti-patterns
table names delta-only re-review of a deficient prior review.

**Why.** The delta prompt as first written said "read only what changed, do not re-read the unchanged
tree." The OWASP miss that motivated the runbook tightening lived in the **unchanged** tree, so a delta
re-review would have re-blessed a review that never ran the standards pass. A delta cannot find a miss in
unchanged code by construction, so the mode must key on the prior review's completeness, not on a desire
for cheapness.

**Alternatives.** (a) Always do a full deep review — rejected: expensive, and it defeats the pinned-HEAD
header's purpose. (b) Always delta — rejected: cannot repair a coverage miss (the OWASP case). (c) Judge
by the operator's phrasing ("re-review" vs "refresh") — rejected: the request's wording is not a reliable
signal of whether the prior review is complete.

**Status:** implemented in `docs/runbooks/competitor-review.md` (commit `7000634`); no re-review has run
yet, so the runbook's `last_verified` deliberately stays `unverified`.

## D99 — Cleanup and reclaim are bounded by the clean gate: never force past uncommitted content to free a branch (delegate, 2026-10-18)

**Decision.** A branch is deleted only when its work is **merged** (or patch-equivalent) AND its worktree
is **clean** — or its only content is approved, verifiable pure scratch (`verify-*`/`wt-*`) whose nested
worktrees are also clean. A dirty worktree is kept, and its branch with it. `--force`, `git clean`,
`git reset --hard`, and `git checkout --` are never used to make a worktree removable.

**Why.** On 2026-10-18 a mass reclaim of 58 locked terminal-item worktrees freed **0** — every one held
uncommitted content (11 tracked-only, 8 tracked+untracked, 39 untracked-only) — and an earlier pass KEPT
18 candidates because their nested verify trees held real probe scripts (e.g. `qa-probes-verdict.mjs`).
"Dirty" is the only available signal separating reclaimable scratch from real work, so forcing past it
would have silently destroyed verification artifacts. The clean gate is load-bearing, not an obstacle to
clear.

**Alternatives.** (a) `--force`/`git clean` to clear the sprawl — rejected: irreversible loss of
uncommitted work, and it is exactly the destructive class the operator forbade; (b) delete the branch and
leave the worktree — impossible (git refuses to delete a checked-out branch) and would orphan content;
(c) archive-then-remove every worktree — rejected as disproportionate for the ~12 that are actually in
use. The durable path is the **leak fix**: ROADMAP 76 audit surface + `complete_work` teardown + qa
verify-scratch cleanup, so fewer worktrees are dirty in the first place.

**Status:** adopted; procedure in `docs/runbooks/leaked-worktrees.md` § "Reclaiming a merged item-branch
pinned by a verify worktree" and `docs/runbooks/branch-cleanup.md` step 5.

## D100 — Compaction is applied by the broker through the command spool, not by an external writer (devtools, operator priority, 2026-10-18)

**Decision.** `compact` joins the command-spool vocabulary (`SPOOL_OPS`, ROADMAP 71 / #912): with a
broker alive, `cli.mjs compact` ROUTES the request (`op:compact`) through `<db>.broker.inbox` and AWAITS
the result at `<db>.broker.inbox.out/<requestId>.json`; the broker applies it with its OWN harness
(`src/broker.mjs` `applyRequest`). The direct path (a fresh harness) remains ONLY for the no-broker case.
The live-generation-lease guard does NOT block the broker's own compaction.

**Why.** pi-durable's compaction is BUILT to run alongside a live conversation: `conversation.compact()`
commits a `pi.compaction` task that summarizes an old prefix at a turn boundary and places a summary
entry (the transcript is kept). durig's old `compact` was an EXTERNAL writer — `refuseWhileBrokerDrives`
plus the live-lease guard meant a live rig could not compact at all. Routing through the spool gives one
writer and one scheduler (the invariants of `docs/COMMANDS-AND-THE-BROKER.md`), so compaction is a normal
write like any other, not a stop-the-world operation. The lease guard exists to stop an OUTSIDE writer
from rewriting a context head a running generation owns; the broker IS the owner and commits at the turn
boundary, so it must not be blocked by a guard aimed at outsiders.

**Alternatives.** (a) Keep refusing while the broker drives — rejected: it makes live compaction
impossible, which is the operator's complaint; (b) the in-broker cooperative halt (`src/halt.mjs`,
#1768/#1769) — rejected: halting a generation is a heavier, separate mechanism and pi-durable's native
background compaction needs no halt (cross-linked, not depended on); (c) QUEUE the compaction behind the
current generation (settle-then-compact) — kept only as a fallback if the native path proves to need it;
the broker applying its own op is already the single owner.

**Status:** adopted; `demo/compact-spool.test.mjs` proves a REAL `pi.compaction` entry lands via the
broker, a duplicate `requestId` applies once, and the seat is not aborted. Procedure:
`docs/runbooks/compact-a-seat.md`.

## D101 — The durable-TUI spike merges as a parallel, single-owner entrypoint before any attach (delegate, operator directive, 2026-10-18)

**Decision.** The `durable-tui` spike (the real pi `InteractiveMode` TUI on a pi-durable conversation;
`.spike/durable-tui/HANDOFF.md`) merges into durig in phases. **Phase 1 lands it as a NON-DEFAULT
entrypoint on its OWN store** (`npm run tui`; `ui.mjs`/`npm run ui` untouched) with a fail-closed guard
that refuses a store a broker owns. Attaching it to a real seat's conversation (ROADMAP 52 + 55) is
Phase 2; converging with `ui.mjs` is Phase 3. The Phase 0 scope ruling — per-seat Pi view (a) vs
multi-seat operator TUI (b) — precedes code, with (a) recommended first.

**Why.** durig's store has ONE writer (D42 / F24): the broker while it runs. `durig ui` is a read-only
viewer (D11) whose only write is the intent spool (D68). The spike is a *writer* — it opens storage and
a harness. Pointing it at `selfdev.sqlite` with the broker alive is the exact second-writer collision.
Landing it as a separate entrypoint on a separate store yields "both TUIs working during a slow
migration" at near-zero risk and defers the attach protocol (the security-gated part, ROADMAP 55) until
it is designed.

**Alternatives.** (a) Implement the adapter as a mode of `ui.mjs` immediately — rejected: couples the
new surface to the old before the ownership/write seam is solved. (b) Replace `ui.mjs` outright —
rejected: destroys the working read-only viewer and D11's fallback evidence. (c) Run the spike against
`selfdev.sqlite` while the broker drives — rejected: a second writer.

**Status:** delivered to `pm` (intent `66d95f69-17bf-4707-8c23-40326e7b8d70`) with
`docs/reviews/durable-tui-merge-plan.md` + `docs/reviews/durable-tui-gap-analysis.md`; Phase 0 scope
ruling and registration pending. The `@earendil-works/pi-coding-agent` dependency pin is a `devtools`
prerequisite.

## D102 — The durable TUI replaces `durig ui` as the multi-seat surface (scope b); team-status UX is a design consultation (operator, 2026-10-18)

**Decision.** The durable-TUI merge targets **scope (b)**: the real Pi `InteractiveMode` TUI becomes
durian-pi's multi-seat operator surface and replaces `ui.mjs` as the primary view. `ui.mjs` remains the
documented read-only fallback (D11). A **team-status viewport** is a required part of the surface. The
operator delegates its UX to `designer` and `advocate`: PM registers the consultation and routes it to
those two seats on unpause, and their written proposal (`docs/`, with a sketch) selects the layout.
Phase 2 selects no layout until that proposal is accepted. This decision sets (b) as the destination and
supersedes D101's "recommend (a) first" staging; the multi-conversation and attach work (ROADMAP 52 +
55) is in scope.

**Why.** (b) was the original intention for the durable TUI — one coherent place to run the team —
rather than bolting a second single-seat console onto the existing viewer. The operator judged a
whole-team status viewport essential to that surface but was explicit that its best UX is undecided,
hence a design consultation rather than a delegate guess.

**Alternatives.** (a) as the destination — rejected by the operator: it leaves the fleet view and the
interactive console as two separate products and does not fulfill the original intention. A bespoke
layout chosen by the delegate — rejected: UX is the design seats' ownership, and the operator asked for
their opinions.

**Status.** Ruled. The consultation intent is spooled (`92682546-ad8e-4406-9efb-c7b1208e38c3`) for PM to
route on unpause. Phase 1 (own-store, fail-closed base) proceeds unchanged. Phase 2 starts after the
designer/advocate UX proposal is accepted and the ROADMAP 55 security position is written.

## D103 — Product rebrand `durig` → `durian-pi`, with deprecated aliases for env vars and config paths (operator, 2026-10-18)

**Decision.** The product is renamed `durig` → `durian-pi` across all tracked text and identifiers:
`package.json` `name`; the 24 `DURIG_*` env vars become `DURIAN_PI_*`; `durig.config.json` becomes
`durian-pi.config.json`; `durig.config.default.json` / `durig.config.example.json` are renamed; the
`.durig/` scratch dir becomes `.durian-pi/`; `skills/durig/` and `.agents/skills/durig/` become
`durian-pi`; docs, demos and `.gitignore` follow. The config/env loader accepts the old `DURIG_*` names
and the old `durig.config.json` as deprecated aliases; the new name wins when both are set. The new
multi-seat TUI is named the **durian-pi TUI**.

**Why.** The operator renamed the repository to `Durian-Pi` and directed the product follow. A hard
identifier break strands the live selfdev rig and every documented command (`DURIG_DB`, `DURIG_SEAT_ROOT`,
`DURIG_MAX_CONCURRENT_SEATS`, …). Tested aliases make the rename complete while the running system
stays reachable; they are a supported feature with one documented deprecation, not a stub.

**Alternatives.** (a) Prose-only rename leaving env vars/paths as `DURIG_*` — rejected: not a rebrand,
and two names persist indefinitely. (b) Hard rename with no aliases — rejected: breaks the live rig,
scripts and runbooks simultaneously. (c) Delegate hand-edits the shared tree — rejected: the broker is
UP and seats run in worktrees, so the shared tree must not be mutated.

**Status.** Delivered to `pm` for registration (intent `9fa09419-2160-4b3b-b2eb-04bbd32c54e2`); owners:
devtools (env/config/paths/scripts), impl (code), scribe (docs), qa (verify). Acceptance: a demo proves
the new names load and the old aliases resolve (new wins); after the rename `git grep -i durig` returns
only the deliberate alias/deprecation sites; full `demo/*.test.mjs` + `npm run test:tui` green.

## D104 — A per-seat local provider lets one seat use a locally-served model (delegate, operator directive, 2026-10-18)

**Decision.** durig registers a second, OpenAI-compatible provider (`"local"`) alongside the default
when `DURIG_LOCAL_BASE_URL` is set; a seat whose model is `local/<id>` resolves to it while every other
seat keeps the default provider. New config keys: `DURIG_LOCAL_BASE_URL`, `DURIG_LOCAL_MODEL` (default
`local`) and `DURIG_LOCAL_CONTEXT` (default 65536). Implemented in `src/providers/local.mjs`, wired in
`cli.mjs` `buildModels`; the selfdev `qa` seat now uses `local/qwen36` (PolyStrata-served
Qwen3.6-35B-A3B).

**Why.** The operator's only funded inference was a local server (32 GB RAM / 24 GB VRAM); the DeepInfra
402 had stopped the whole team. durig built exactly ONE provider per process, so no seat could use a
second endpoint. The registry (`ModelsImpl`) already holds providers in a `Map`, and `resolveSeatModel`
already reads a registered `provider/modelId` prefix — so the enabling change is small, additive, and
off by default. Verified end-to-end: an isolated `send qa` returned the expected answer through
PolyStrata, `up --refresh` resolved `qa` to `local/qwen36` (without the provider it would have stayed
`deepinfra/local/qwen36`), and the full demo suite passed 142/142 with the broker stopped.

**Alternatives.** (a) Point the whole rig at local by changing `DURIG_PROVIDER` — rejected: moves every
seat, and still needs a provider registration. (b) Wait for the team — rejected: the team cannot run
until the provider is funded, and the operator directed the delegate. (c) Proxy or impersonate DeepInfra
— rejected: fragile and opaque.

**Status.** Implemented as operator-directed side work (`demo/local-provider.test.mjs`); `node --check`
clean. This is product code written by the delegate under an operator directive and still owes a seat's
independent review when the rig can run.

## D105 — A local-provider seat starts a NEW context for each new work item; the durable transcript is kept (operator policy, 2026-10-18)

**Decision.** A seat whose resolved model provider is `local` (D104) MUST draw a fresh context boundary
when it picks up a new work item, BEFORE working that item — so a prior item's turns never condition the
model on the next one. The boundary is the existing `pi.reset` mechanism (`resetSeatContext`,
`src/reset.mjs`): prior turns leave the model CONTEXT, the durable transcript is preserved, and the next
wake re-anchors the seat from its durable instructions plus the new queue item's body. Non-local seats
are unchanged. The invariant is: one boundary per NEW item, **never mid-item**, never across a `claimed`
item (a claim must survive the transition or the task is lost), and never while the seat holds a live
generation lease. What exactly counts as a "new" item, how a re-claim/deferred item is treated, and the
wake-path seam are the implementing seat's to design.

**Why.** A locally-served model runs with a small window (selfdev: 64k served via `DURIG_LOCAL_CONTEXT`)
on a single serialized GPU, and context rot degrades it well before the window fills
(`docs/Managing_Long_Context_Length.md`); carrying a finished item's transcript into the next item is
prefill cost plus reasoning contamination, and the local seats are the ones that have degenerated
(`qa-context-degeneration`). A fresh context re-anchored from the durable instructions + the new item's
grounding is both cheaper and more correct at a task boundary — the same reasoning as ROADMAP 29/30b,
made non-optional and scoped to the local fleet. It complements D95, which judges the guard's context
bound against the seat MODEL's effective window.

**Alternatives.** (a) Leave it a judgement call / operator-managed `reset` — rejected by the operator: a
policy that depends on someone remembering to call it is not a policy. (b) Apply fresh-per-item to ALL
seats — rejected: paid seats can keep a prompt-cache-warm context, and ROADMAP 29 leaves their cadence
to the `pm`/advocate practice. (c) `compact` instead of reset — rejected: compaction summarizes the old
turns *into* the next context, carrying forward whatever was wrong with them; a local seat needs a clean
boundary, not a summary of the prior item.

**Status.** Policy RULED and recorded. Enforcement is NOT implemented — today only the manual
`reset`/`clean` verb and the D64 degeneration guard draw a boundary. Routed to `pm` for registration +
routing; acceptance is a demo proving a local-provider seat gets a `pi.reset` boundary between two
consecutive work items while a non-local seat does not, plus `node --check`, the full suite, and a
non-author verify.

## D106 — D105 seam: local-provider per-item context reset (lead `#2158`, 2026-10-18)

**Decision.** The D105 enforcement seam is COMPOSED — signal and act are one seam:
- **SIGNAL = option (c):** `up` records the RESOLVED `provider` on the SEAT doc;
- **ACT:** the `pi.reset` boundary fires on the WAKE path in the broker, gated on that recorded field, between runs.

(c) and the broker act compose.

**Rejected.** (a) `cli.mjs` `superviseOnce` — reopens the writer slot closed in `#2031`/`#1817` and
puts the boundary outside the wake path; (b) broker `drivePass` reading each seat's `pi.agent` model
live on the HOT wake pass — a new cross-conversation read with no precedent plus a per-wake cost.

**cli.mjs writer slot.** NOT reopened as a general writer; the `up` provider field is a BOUNDED
single-field write, sequenced behind `impl-item-1907` (`#2017`) and coordinated with the D103 rebrand
(`#2110`/`#2144`). PREFER routing the `up` write through devtools' spool (`#1930`) so `cli.mjs` is
untouched; if the spool is not ready, the `up` half WAITS. No second concurrent `cli.mjs` writer.

**Safety override (wins over scope).** The live-lease refusal STANDS — never reset an in-flight /
claimed / leased seat; no mid-item boundary. Acceptance `#2125` governs.

**Relation.** Complements (does NOT supersede) the D105 rule recorded in `scribe-item-2124` @007f073
(MANAGED / decided-not-shipped); this entry records the SEAM now that it is being implemented (`#2123`).

**Status.** Ruled by `lead` (`#2158`); recorded for `impl` (`#2123`) with verification routed to
`auditor` (`#2125`). Lead's P1 note: the ruling rests on queue evidence, not a source re-read — `impl`
flags if the seats doc or the wake path contradicts it.
---

## D107 — A local-provider seat compacts its tool-call history WITHIN a long work item; the cross-item boundary stays a `pi.reset` (operator policy, 2026-10-18)

**Decision.** When a local-provider seat (D104) must work ONE item across many turns and will exceed
its small served window, it MUST compact the tool-call history so the information it learned SURVIVES
well enough to keep progressing — and do so REPEATEDLY until the item finishes. This is the **intra-item
complement to D105**: D105 draws a fresh `pi.reset` at the **cross-item** boundary (between two items),
whereas this covers the case where no clean boundary is available because the item is mid-flight.
D105's "`compact` instead of reset — rejected" is hereby SCOPED to the cross-item boundary; it does not
forbid intra-item compaction.

**How (the ordering is the invariant; D84 governs the mechanics):**
- **Mask before you summarize.** Omit/replace bulky TOOL RESULTS first (pi-durable `ContextEdit
  { action: "omit" | "replace" }`, ROADMAP 92) — keep the decision/path, drop the dump. Cheapest first.
- **Summarize at a phase transition**, not mid-reasoning (the best point is "after localizing the issue,
  before beginning the edit" — `docs/Managing_Long_Context_Length.md`); a fixed threshold can fire where
  context is hardest to summarize.
- **Preserve the pointers, not the bodies:** item id + claim state, artifact paths / branches / SHAs,
  acceptance criteria, and the decisions taken. Thin tool returns (`thinResultText`, FEATURES 167) mean
  there is less to carry. The summary is a structured schema with a token floor (ROADMAP 93) and the
  summarizer treats in-context content as untrusted (95).
- **Cap the repeats, then RE-ANCHOR.** Past the compaction cap, force a fresh session re-anchored from
  the durable instructions + the item and its artifacts (ROADMAP 94) — "repeat until degradation" becomes
  "repeat to a cap, then re-anchor".
- **Trigger on the MEASURED effective window**, not the advertised one (quantization shrinks effective
  long-context accuracy); this depends on `status` reporting the local seat's `window.denominator`, which
  is currently `null` (delegate defect filed).
- **Hard invariants carry over from D105:** never drop a `claimed` item across a compaction, never
  compact over a live generation lease, and a VERIFIER must not inherit an author's summary (D84/96).

**Why.** A 64k local seat on one serialized GPU cannot finish a turn-heavy item in one window; without
compaction it either hard-stops or, worse, keeps stale exploration that impairs reasoning long before the
window fills. Today the mechanism is the WRONG one and is not operator-controlled: durig passes no
compaction settings to `Harness.open`, so pi-durable's default applies — `reserveTokens 16384`,
`backgroundTokens 32768` — i.e. background compaction from **~25 %** and blocking at **~75 %** of the
served 64k window. Live evidence: `qa` carries five `pi.compaction` summaries while consuming only
~18.9k/64k. Recorded because relying on that accidental default is not a policy.

**Alternatives.** (a) `pi.reset` MID-item — rejected: it discards the in-progress work and can drop the
claim. (b) Let the seat exceed the window and hard-fail — rejected: no progress, and the failure lands
as a lost run. (c) Re-compact without a cap — rejected: unbounded summarization compounds loss; D84/94
caps and re-anchors.

**Status.** Policy RULED and recorded (operator, 2026-10-18). Enforcement is NOT implemented; route to
`pm` for registration + routing ALONGSIDE D105's `#2123` (the two are one reliability story: reset
between items, smart compaction within one). Acceptance: a demo proving a local seat compacts (mask →
summarize at a transition) and continues an item across a compacted boundary, a cap that forces a fresh
re-anchored session, a non-local seat unchanged, plus `node --check`, the full suite, and a non-author
verify. D106 is claimed by the unlanded `scribe-item-2169`; recorders must not reuse 106.

**D107 parameters — local-seat compaction thresholds (lead `#2243`, superseding `#2230`/`#2235`, reconciled with this entry via `#2249`/`#2250`, 2026-10-18).** This ELABORATES D107's mechanism — it is NOT a separate/competing decision. LOCAL seats only; non-local seats are unchanged.

- **Scope of replacement.** ONLY pi-durable's AUTOMATIC compaction policy is disabled/replaced. The triggers below are DURIG-LEVEL structured compaction (this entry); the repeats are durig-level.
- **Trigger.** Denominator = the MEASURED effective window (`#2231`), NOT nominal `DURIG_LOCAL_CONTEXT` — provisional nominal until a measurement exists. BACKGROUND slot = the MASK trigger at **80 %** (D84 WARN); BLOCKING slot = the SUMMARIZE/re-anchor threshold at **90 %** (D84 ABORT), only at/after 90 % AND at a phase transition. So: 80 % mask / 90 % summarize.
- **Repeat cap.** SUMMARIZE capped at **2 per item** (masks do not count — non-destructive); on the 3rd demand, FORCE a fresh re-anchored session (D107 item 4 / ROADMAP 94).
- **D84 alignment.** D84's guard thresholds ARE the compaction triggers; when `#62` lands the guard EMITS them and this policy READS them — one source, no double-fire.
- **Ordering (D107).** mask → summarize at a phase transition → preserve pointers → cap → re-anchor. This is what `#2233` (D107 implementation) builds.
- **Relation.** Intra-item only; the cross-item boundary stays D105's per-item `pi.reset` (`#2123`).

---

## D108 — Seats record durable, topic-organized notes for future agents at item completion and at a reset/compaction boundary; a curator validates and purges (operator directive, 2026-10-18)

**Decision.** Every seat MUST, before it completes a work item **or** crosses a reset/compaction
boundary, record the durable knowledge it gained that a future agent or seat will plausibly need again
— above all the answers it had to **discover with tool calls** — into **topic-organized note files**.
The transcript is not the vehicle: it gets compacted (D107), reset between items (D105), and is unread
by the next seat. The notes are the vehicle.

**What earns a note (all three must hold).**
- The fact was not already written down where a reader would find it in one step, and it took a tool
  call (or a chain of them) to establish.
- Another seat or item will plausibly need it again (durable, cross-item value).
- It has a **verifiable anchor**: a path + symbol/line, a command, a URL, or a commit/issue id.

Never record: a restatement of code one read returns; run-local or transient state (this run's pid, a
one-off count); or anything already in the note file.

**Shape of a note (machine-checkable by design).** One bullet per fact, carrying the question, the
answer, the **provenance**, the day/commit it was established, a `confirmed` vs `reported` marking
(only `confirmed` if the seat observed or re-ran it), and — where possible — a `staleIf` anchor check.
That anchor is what makes decay *mechanical*: a checker re-resolves the path+symbol (or the commit)
and flags or purges a note whose anchor no longer holds, instead of waiting for a human to re-read the
whole base.

**Topic files, and cross-seat access — YES.** Notes group into one file per topic
(`docs/notes/<topic>.md` by default; the team sets the exact path), so a reader can load a whole topic
at once and grep across topics. They are **shared across seats**, because the value is that an `impl`
lookup saves `qa`/`devtools` the same tool calls. Two constraints are inherent and must be designed
around, not assumed away:
- **Worktree isolation (D49).** A seat works in its own per-item worktree, so a notes file in the main
  tree is *invisible* in that worktree and a note written inside a worktree dies with it. The store must
  therefore live somewhere every seat resolves regardless of worktree — a repo-committed `docs/notes/`
  (visible once a worktree forks from a commit carrying it; a possibly-stale read) or an out-of-worktree
  shared directory resolved by an absolute path/env var (always current, not versioned). The team picks
  one and **states its staleness behavior**; a design that silently reads a stale or absent file is a
  defect, not a nuance.
- **One writer per file.** Concurrent seats must not interleave edits into one shared file; capture is
  append-only, or the curator is the single writer.

**Invalidation and a curator.** Information discovered yesterday is wrong today. The operator's
strongest point is that purge cannot be left to chance: decay is partly mechanical (re-resolve the
anchor / `staleIf`) and partly judgement (a source moved, an answer changed, two notes conflict). A
**curator** duty — a periodic review-and-purge pass over the base, with authority to delete — is part
of this tactic, not an optional extra. Whether that is a standing **seat** (the operator proposed one)
or a periodic duty on an existing seat (e.g. `scribe`) is the **operator's call** — new seats are the
operator's grant, so `pm` escalates it rather than creating one.

**Capture prompt (the improvement the operator asked for).** The seat instruction should read:
*before you finish — or before a reset/compaction boundary — record what you learned that is not
already written down; one line per fact: the question, the answer, and where it came from; a note
without provenance is not accepted; mark it `confirmed` only if you observed it; do not record what one
read returns or what is true only for this run; if a note you relied on was wrong or stale, correct or
delete it; keep the delta under a minute.* At a reset/compaction boundary, also write the short
handoff (what you were doing, what is done, what is next, any blocker) — reuse the existing
`resetSeatContext` handoff (`src/reset.mjs`); do not add a second boundary mechanism.

**Why.** The team's scarcest, most expensive resource is a seat's context and the tool calls that fill
it, and the same lookups recur across items and seats (the operator's framing: an agent will want to
retrieve a whole topic's previously-queried information at once). Today that knowledge lives only in a
transcript that is compacted, reset, and never read by the next seat — so it is found, then paid for
again. Provenance + `staleIf` + a curator turn the base from a wiki that rots into something checkable.

**Alternatives.** (a) Rely on the durable transcript — rejected: D105/D107 exist because the next
context does not carry it. (b) A free-form handoff in the completion message — rejected at this scale:
not topic-retrievable across seats, not checkable. (c) Curator-only capture (the notekeeper reads every
conversation) — rejected as the *sole* mechanism: the author has the context in hand and pays almost
nothing to record it, whereas a reader must re-derive it; the curator is for validation/purge, not
primary capture. (d) No staleness mechanism — rejected: an un-audited base actively misleads.

**Cross-refs.** D49 (per-item worktrees), D101–D103 (the durable-TUI/rebrand context this ships
alongside), D105 (cross-item reset), D107 (intra-item compaction), `src/reset.mjs` (the handoff
boundary).

**Status.** Operator directive, RULED and recorded. **Not implemented.** Routed to `pm` for
registration + decomposition + routing. Acceptance is FULL (no partial paths, no stubs): a seat that
completes an item leaves a topic note with provenance and a `staleIf` anchor; the base is readable from
a second seat while the first is in its own worktree; capture is wired to the reset/compaction
boundary; a validating/purge path exists; demos prove each, plus `node --check`, the full suite, and a
non-author verify.

---

## D109 — Agent-driven git runs are non-interactive; an interactive editor/pager/prompt must never block a seat or the delegate (operator directive, 2026-10-18)

**Decision.** Every git invocation driven by an AGENT — a durig seat or the external delegate — MUST be
non-interactive. Concretely:
- The agent environment exports `GIT_EDITOR=:` and `GIT_SEQUENCE_EDITOR=:` (git runs the editor through
the shell, so `:` is a no-op), `GIT_TERMINAL_PROMPT=0`, `GIT_MERGE_AUTOEDIT=no`, and a non-paging
  `GIT_PAGER=cat`/`PAGER=cat`.
- Agents commit with an explicit message (`-m` / `-F <file>`), amend with `--no-edit`, and merge with
  `--no-edit`. A bare `git commit` is a defect, not a convenience.
- The operator's OWN interactive `core.editor` is left untouched; the fix is scoped to agent runs.
- A short `git` skill (K3, `docs/reviews/agent-skills-review.md`) carries these as exact commands.

**Why.** The reported symptom is real and reproducible: `git var GIT_EDITOR` on this host returns
`"…Microsoft VS Code\bin\code" --wait`. Any `git commit` without `-m` therefore launches VS Code and,
because of `--wait`, BLOCKS the agent until a human closes the window. `GIT_TERMINAL_PROMPT=0` stops a
credential prompt from hanging a headless run the same way, and a pager can swallow output. The
non-interactive editor is the only fix that does not depend on every model remembering `-m` every
time; the practice layer is the belt to that suspenders.

**Where.** Three surfaces, all of which must carry the vars so a seat cannot lose them by tool choice:
the seat environment built by `makeSeatEnv` (`src/seattools.mjs`, wrapping `NodeExecutionEnv`); the
broker's own process env; and the launcher `scripts/serve-noroot.ps1` (convenience for the operator).

**Status.** Ruled (delegate, operator directive). NOT implemented. Routed to `pm`; acceptance is a run
whose bare `git commit` does not open an editor, plus `node --check`, the suite, and a non-author
verify.

---

## D110 — Worktree naming and location standard: one taxonomy, one root, outside the working tree (operator directive, 2026-10-18)

**Decision.** Worktrees follow ONE taxonomy and ONE resolved root.

| Class | Path | Name / branch | Lifetime | Owner |
|---|---|---|---|---|
| Durable per-item workspace | `<WORKTREE_ROOT>/item-<id>` | `item-<id>` (branch `<seat>-item-<id>`) | until the item is terminal | the seat; retired by `complete_work` |
| Verification scratch | `<WORKTREE_ROOT>/scratch/verify-<item>-<nonce>` | — | short | verifier |
| Throwaway / broker scratch | `<WORKTREE_ROOT>/scratch/wt-<item>-<sha>` | — | swept by the broker | broker |
| Archive (out of tree) | `<repo-parent>/<repo>.worktrees/` | preserved names | until reclaimed | operator |

**The `item-<id>` basename is LOAD-BEARING and must not be renamed:** `src/worktree.mjs`
`removeSeatWorkspace` recomputes `join(worktreeRoot, "item-<id>")`; `src/broker.mjs` parses
`/^item-(\d+)$/` off the path basename and the branch ref; the `prepare_workspace` row in
`docs/FEATURES.md` documents `<root>/item-<id>`. The drift is in the SCRATCH names and the ROOTS, not
the durable name.

**The root rule.** `WORKTREE_ROOT` is resolved ONCE (config/env `DURIG_WORKTREE_ROOT`) and defaults
**outside the repository working tree**. It is never the repo root and never a subdirectory of another
worktree. Creating a worktree inside the working tree is refused.

**Why.** The observed state is 173 registered worktrees with no single root: 69 directly in the repo
root, 67 in the `../pi-opendurig.worktrees/` archive, 9 under the OS temp dir, at least 4 NESTED inside
another item worktree (`pi-opendurig/item-1669/…`, `item-1631`, `item-1266`, `item-1236`), and a long
tail of one-offs. Today `prepare_workspace` defaults `worktreeRoot` to `process.cwd()`
(`src/seattools.mjs` / `cli.mjs`), so worktrees land INSIDE the working tree: they show as untracked
directories in `git status` (65 untracked `item-*` entries), they are swept by a careless `git add -A`,
and `carryVisibleState` (`src/worktree.mjs`, #998) exists precisely because a sibling `item-<id>`
appears in the source's status. A single out-of-tree root makes cleanup, sweeping, and status honest.

**Constraint.** The root change is a behaviour change with live artifacts (the 65 root `item-*` dirs)
and load-bearing cleanup regexes; the implementing item must ship a migration/compat path and prove the
broker's item-status sweep still finds the durable worktrees. It must not silently orphan an existing
worktree.

**Status.** Ruled (delegate, operator directive). NOT implemented. Routed to `pm`; acceptance is the
single resolved root, the refusal guard, cleanup/sweep parity, demos, `node --check`, the suite, and a
non-author verify.

---

## D111 — Every CLI/UI read is served by the broker's pi-durable instance through the read spool; no second store opener (operator directive, 2026-10-18)

**Decision.** When a broker is alive, the CLI's read verbs (`ps`, `queue`, `status`, `watch`, `log`,
`events`, `metrics`, `check`, `worktree audit`) and `ui.mjs` MUST read through the broker, not by
opening the store themselves. The broker serves a `read` spool op with its OWN `Storage`/
`viewState`, and the result lands in the command spool's existing result channel
(`<db>.broker.inbox.out/<requestId>.json`); `src/readclient.mjs` is the client half. Only when NO
broker is alive does a read verb open the store directly — it is then the sole owner.

**Why.** pi-durable is a library with **one owner per process**, and its own model is "one owner,
many clients". `SqliteStorage.document()` wraps a READ in `this.db.transaction(...)`, which is
`BEGIN IMMEDIATE` (`vendor/pi-main/packages/durable/src/storage/sqlite/storage.ts:552`, `.../sqlite/node.ts:146`)
— a WRITE lock even for a read. So a second process that opens the store (a `log --follow` / `watch` /
`ui.mjs` poll) takes the broker's write lock; the broker's `SqliteStorage` then waits out its 5 s busy
timeout and throws `SessionFailed`, poisoning the whole broker session (the 2026-10-18 wedges). The
library offers no cross-process socket, so the CLI cannot be an in-process client of the broker; the
spool is the client surface. This SUPERSEDES D94's rejection of routing reads through the broker for
the read path: a true read-only open is not a seam (`document()` still needs `BEGIN IMMEDIATE`, and
`SqliteStorageOptions` is `{prefix}` only), so the broker must be the only opener. D94's writes-through-
the-spool half stands.

**How.** `src/brokerread.mjs` is the closed set of read views (`seats`, `queue`, `roots`, `health`,
`live`, `entries`, `feed`, `document`, `exhausted`, `older`) applied by `dispatchRead` over the broker's
`probeStorage`; `read` joins `SPOOL_OPS`. The client sends the non-secret config subset only (never the
provider key). Coarse views, not a storage-method proxy: `readRigHealth` makes dozens of storage calls
per poll, and a round-trip per call would make `status` take minutes. The resident broker passes
`waitForWakes:false`, so its passes do not park on runs — a spooled read is answered at the next pass
(bounded by the ~1 s idle re-check).

**Trade-off (accepted).** A read now depends on a live broker answering: if the broker is truly hung, a
read waits/times out instead of reading a stale-ish store. That is the correct shape — a hung broker is
the incident, and a second opener is what wedged it.

**Status.** Implemented. Evidence: `demo/broker-read.test.mjs` (views equal the direct readapi calls; an
unknown view is dead-lettered; `readViaBroker` round-trips through the broker's instance);
`demo/command-spool.test.mjs` (vocabulary) and `demo/cli-broker-refuse.test.mjs` (read verbs work while a
broker drives) updated; live: `status`/`queue`/`ps`/`log` each drained an `INTENT delivered=1` from the
running broker.

## D112 — Broker failures are SCOPE-CLASSIFIED and the process has ONE storage connection; a stop is only "stopped" when the pid is gone (architect, item #2520, 2026-10-19)

**Context.** The broker review (`docs/reviews/architecture-broker-review.md`, item #2520) found the
live reliability cluster (repeated `PASS-FAILED SessionFailed … cause=Error: database is locked`) is not
a missing SQLite pragma — it is a **failure-scope** defect plus a **liveness-signal** defect. pi-durable's
failure model is terminal (`vendor/pi-main/packages/durable/src/errors.ts`: *"The Session failed … Reopen
the Session"*), while `runWakeLoop` retries the same dead Session forever and `drivePass` aborts the whole
pass on any single storage error. Separately, `serve --stop` can report `stopped:true` while the broker
still owns the store, because the heartbeat interval is cleared before the unbounded F11 drain
(`src/broker.mjs:1321-1322`) and `brokerAlive` treats a >60 s stale heartbeat as dead (`:1379`), so a
second writer is admitted into the 2026-10-16 double-writer corruption class.

**Decision.** Three durable rules, each with a recovery path:
1. **Failure is scoped and classified.** A per-seat failure is a `wake-failed` and MUST NOT abort the
   pass (invariant: a fault in seat X never stops seat Y). A terminal `SessionFailed` is NOT retried
   against the same Session; the broker MUST tear down and reopen the harness in-process (recover from
   committed state) — a bounded, jittered retry with a terminal diagnostic is reserved for genuinely
   retryable errors (ROADMAP 158).
2. **One owner ⇒ one connection.** The broker MUST NOT hold a second pi-durable connection
   (`probeStorage`); every read the broker serves — the `read` spool op, `readStoppedConvIds`,
   `readSeatRoots`, `superviseOnce` — is served from the harness's own `Storage`. This extends D111 from
   "no second *process* opener" to "no second *connection*", the invariant D111's own rationale states.
3. **Liveness, progress, and stopping are distinct signals.** `.broker.json` carries a `lastPassAt`
   progress leg and a `stopping` state; `serve --stop` reports `stopped:true` only when the pid is
   provably gone, and clears state with the pid guard (`clearBrokerState(dbPath, pid)`). "Alive" is never
   reported as "healthy" without progress.

**Alternatives considered.**
- *Retry harder / tune `busy_timeout`* (the rejected "missing pragma" theory): rejected — the failure is
  terminal in the Session, not a timeout, and the review's version probe shows the pinned semantics are
  already `BEGIN IMMEDIATE` + `busy_timeout`; a longer timeout only widens the window.
- *Treat `SessionFailed` as a crash and exit non-zero for a host to restart* (option B): correct once
  `src/host.mjs` exists, but no host exists today, so a crash is just a permanent outage; the in-process
  reopen (option A) is the reversible choice now and composes with B later.
- *Keep `probeStorage` as a cheap raw reader*: rejected — `SqliteStorage.document()` takes `BEGIN
  IMMEDIATE` even for a read, so the "raw reader" still takes the one write lock and can time out the
  harness's 5 s busy window (`PASS ms=5051` → `SessionFailed`).

**Consequences.** F2/F4/F6/F8/F1/F7/F9 in the review are retired by this decision's three rules; each has
its own failing-first demo in the review's disposition. Cost: a reopen path must preserve an in-flight
run's durability (pi-durable recovers from committed state, so the risk is bounded to a run that had not
committed); `status` grows one field. `probeStorage` removal is mechanical but touches
`readStoppedConvIds`/`readSeatRoots`/`superviseOnce` call sites and their demos.

**Status.** Proposed (architect review, item #2520). Implementation items are handed to `pm`; `lead`
rules scope if the failure-scope policy conflicts with scheduled work. Evidence so far: the review's
grep/`node --check`/demo baseline and the version probe (see the review's Evidence section). No
implementation is claimed here.


## D### — CARRY is an opt-in for direct callers; a seat's item worktree is a CLEAN HEAD checkout (lead #2648, 2026-10-19)

**Context.** The CARRY/teardown collision (incident
`docs/incidents/2026-10-19-worktree-carry-teardown-collision.md`): `createWorktree`'s CARRY (#506 /
ASK F) copied the source tree's visible dirty state into EVERY fork, while teardown is clean-only
(D60). So while the shared tree was dirty, a completed item's worktree was BORN dirty with foreign
paths and could never be removed — every completion leaked a tree and pinned its branch.

**Decision.** The seat path (`claimWorktree` → `prepareSeatWorkspace`) passes `carry: false`, so a
seat's item worktree is a **clean HEAD checkout** and its teardown works even while the shared tree is
dirty. CARRY remains an **explicit opt-in** (`carry: true`) for a direct caller that wants the
anti-stale guarantee (#240). The clean-only refusal (D60) is UNCHANGED — no carried path is ever
tolerated or force-removed. This **SUPERSEDES #506's seat-path carry** (the fork is no longer "a tree
neither git nor the operator tracks": it is HEAD plus an enumerated, returned carry list).

**Alternatives considered.** (1) Teardown tolerates carried-foreign paths — **rejected**: introduces a
data-loss surface (a fingerprint bug could discard a seat's real uncommitted work) against D60's
absolute rule. (3) An attention kind that surfaces the leak — **rejected**: it names the problem but
does not fix it.

**Status.** Accepted by `lead` (#2648, option 2 of #2360); implemented by `impl` (impl-item-2360
@`4813a50`): `src/worktree.mjs` `createWorktree` gains `carry` (default true) and the seat path passes
`carry: false`. Proof: `demo/worktree-carry-teardown.test.mjs` (new — seat fork born clean and
`removeClaimedWorktree` succeeds; opt-in carry still carries), `demo/worktree-recursive-carry.test.mjs`
and `demo/broker-dirty-fork.test.mjs` updated to the explicit `carry: true` path. Recorded by `scribe`
(#2658).
LANDING NOTE: D-number assigned at LAND TIME — D113 is taken (spool-op authorization, scribe-item-2219);
re-derive the next FREE D-number by scanning `docs/DECISIONS.md` at merge (do not hard-code).

## D113 — "Waiting on the operator" reuses the existing defer representation; visibility is a read-only derivation and the answer is one spool op (architect, item #2700, 2026-10-19)

**Context.** The operator backlog asks that "waiting on the operator" be **visible and answerable**
(operator-directives-2026-10-19-2 §3). The state already exists: `defer_work` (and the supervisor's
escalation) park an item as `status:"deferred"` + `deferredTo:"human"` + `question` + an append-only
`deferred` transition (`src/rig.mjs:115,692-700`), and `src/attention.mjs:359-366` already derives a
`deferred_awaiting_answer` notice. What is missing is (a) an operator-facing **read view** that names
this as "waiting on you", and (b) an **answer flow** — today only the **seat** can leave `deferred`
(`resume_work`, `src/rig.mjs:721-745`), and a `deferred` item is **never** re-woken by `selectWakes`,
so a dead seat strands it. Full design: `docs/reviews/architecture-operator-wait-visibility.md`.

**Decision.**
1. **Representation is reused, not extended.** `deferredTo === "human"` is the marker; an answer is
   recorded as one more entry in the EXISTING append-only `transitions` array (`{event:"answered",
   by:"operator"}`). No new field, no new document.
2. **Visibility is a read-only derivation** over the persisted queue (the D24 shape): a `waiting` view
   (operator vs seat, oldest-first, with `ageMs`), surfaced by `status` and `queue --waiting`, served
   through the broker's read spool (D111).
3. **The answer is one spool op** (`op:"answer"`, added to `SPOOL_OPS` at `src/broker.mjs:368`) that the
   broker applies with its OWN harness — the sanctioned extension (ROADMAP 71), not a new write path:
   append the `answered` transition + flip `deferred → claimed` (the `resume_work` flip) + deliver the
   text as an operator input. A resumed item is re-woken by the stalled-claim branch
   (`src/driver.mjs:56-64`), so the flow self-heals.

**Alternatives considered.**
- *Reuse `message` with zero new ops* (C1): no new vocabulary, but the resume depends on the seat acting,
  so a dead seat leaves the item `deferred` forever (the seed-incident class). Kept as the fallback if
  "no new write path" is read to bar a new op.
- *Add `item.answer` / an answers document* (C3): rejected — a new schema, forbidden by the constraint
  and contrary to D24's read-only ethos.
- *Have the CLI open a harness and write the resume itself* (C4): rejected — a second writer (the
  2026-10-16 corruption class); the write guard refuses it.

**Consequences.** No schema migration; the answer is durable and legible in the audit trail; the operator
can unblock a seat without the seat's cooperation. Cost: one op in the spool vocabulary and one read
view; the CLI grows `answer`/`queue --waiting` and `status` grows a headline. Open policy questions
(auto-resume vs seat-resume; seat-to-seat symmetry) are listed in the design doc §7 and are for `lead`.

**Status.** Proposed (exploration, item #2700). Not sequenced; `pm` sequences design then decomposition.
D-number uses the next free slot; scribe's pending D113 lands first and lead #2452 re-derives numbers at
land time. Evidence: the code citations above; no implementation is claimed.

