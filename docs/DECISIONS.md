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
peek_queue) was never installed, so NO seat conversation ever had the durig tools.
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
