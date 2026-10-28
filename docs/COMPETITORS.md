> **D103 rename (2026-10-18):** this record predates the product rebrand `durig` → `durian-pi`; it keeps the old name so the audit trail stays truthful.

# Comparators we can learn from

Other multi-agent / durable-agent systems whose **design and architecture**
decisions are worth reading, with the concrete mechanism and where it lives.
This is a maintained list, not a feature-page summary: a claim here cites a file
in that project's own tree.

The deep feature matrix over our substrate candidates (OpenRig, agent-fleet +
pi-durable, tuios, hermes-agent) lives in the project workspace,
`../docs/ORCHESTRATION-COMPARISON.md`; this file records the *reusable lessons*.

**How to add an entry.** Clone the project read-only under
`../vendor/eval/<name>/` (the project already keeps comparators there), pin the
commit you read, and cite a path per claim. One row per decision, with the durig
counterpart it should change or inform.

**Do not type a pin by hand.** `vendor/eval/` is gitignored, so the pin must land in a tracked file the moment
you clone — emit it, and check it:

```bash
node tools/vendor-pins.mjs --format header --project <name> --tags   # the review's header block, paste verbatim
node tools/vendor-pins.mjs --write docs/VENDOR-PINS.md --tags        # regenerate the tracked pin table
node tools/vendor-pins.mjs --check                                  # table == clones, and the table is tracked
```

`docs/VENDOR-PINS.md` is the generated list of every vendored clone with its HEAD, commit date, licence (read from
the clone's own `LICENSE`/`COPYING`), shallow-ness and highest version tag. Older entries below cite clones that
have since been removed from this machine (`aider`, `agent-governance-toolkit`, the agent-skills set) — their pins
now live only in prose, which is exactly what `--check` reports as a NOTE and ROADMAP 202 would make a finding.

---

## agent-fleet — `chankov/agent-fleet`

- **Repo:** https://github.com/chankov/agent-fleet
- **Read at:** clone `../vendor/eval/agent-fleet`, HEAD `7c34dde`
- **What it is:** pi-first multi-agent fleet — a thin dispatcher over specialist
  personas, an on-disk **Verification Contract**, and a documented engineering
  methodology (`docs/PHILOSOPHY.md`). It is the *source* of the **AF+PD** column
  in `../docs/ORCHESTRATION-COMPARISON.md` (AF over pi-durable); the integration is
  assembly we would own, not an existing stack.
- **Adopt-or-build analysis:** `ARCH-COMPARISON-agent-fleet.md` (layer map,
  goal-by-goal, and why adopting it would not replace durig).

| What it does | Why it is worth learning from | durig counterpart |
|---|---|---|
| **Thin-context dispatcher** — research/subagent output goes to disk; the hub resumes a specialist with *paths, not bodies* | The coordinator's context window is the scarce resource; keeping dumps out is what lets one hub run a whole fleet | durig seats already write to disk, but our tool results still return bodies; the lesson is the *return* contract |
| **Proportionality as a ratcheting task tier** — `trivial/small/feature/project` **is** the budget; it survives the next user message; raising it needs a stated `reason` | A turn-scoped size that resets on every correction is how their post-mortem saw a 13-minute change stay open 47 hours | durig's PM `S/M/L` timebox is turn-scoped; the lesson is to **latch** the tier per task |
| **Verification Contract on disk** — `agent-fleet.runtime-result/v1` with orthogonal `execution / changes / verification / acceptance`, bound to task, revision, command, integer exit status and evidence | Separates "changed but unverified" from "failed", so a claim cannot be read as a pass | durig's pair review + qa re-run is behavioural; the lesson is a **structured result shape** |
| **Drift watchdog** — in-flight observation of the JSON event stream; deterministic rules (out-of-scope writes, tool-call loops, consecutive failures) escalate to one cheap LLM judge that can terminate a run as `drift_stop` | Our ROADMAP 43 (degenerate loop) and 42 (supervisor) are exactly this; theirs is **deterministic-first, model-second** | ROADMAP 42/43 — read this before designing the supervisor |
| **Context-pressure guard with ordering** — warn at 80%, abort the pre-model continuation at 90%, **wait for `agent_settled`**, then one compaction | Compacting before the result is persisted loses it; the *ordering* is the invariant, not the threshold | ROADMAP 27/28 (context visibility / reduction) |
| **No automatic retry (single-flight recovery)** — a hard rule; retries are explicit and human-authorized | The conservative pole opposite durig's `resume` / stalled-claim re-wake; worth weighing rather than assuming | durig `resume` + the stalled-claim re-wake |
| **Independent axes** — work mode (`operator`/`orchestrator`) × native roster × peer topology, switched live, no implicit coupling | Three orthogonal knobs, each with its own switch | durig folds all of these into one seat spec |
| **External-blocker stop** — a specialist emits `EXTERNAL_BLOCKED: …` and the hub refuses the next dispatch until a human is addressed, instead of approximating the missing fact | Names "I need something outside my reach" as a gated stop rather than hours of scripts and fixtures | durig's `defer_work` (ROADMAP 5, done) — the closest existing match |

**Where each claim lives** (agent-fleet's own tree): `docs/ARCHITECTURE.md`
("Fleet hierarchy", "Task-tier budgets", "Runtime acceptance and recovery",
"Drift watchdog", "Context pressure and recovery", "One Hub runtime, independent
axes") and `docs/PHILOSOPHY.md` ("Deterministic process, room for judgment",
"Proportionality is part of the methodology").

**What it does not give us:** it is pi-coding-agent-side (harnesses/extensions),
not a durable-queue substrate, so the AF+PD integration is work we would own; and
its Windows posture is unverified (`../docs/ORCHESTRATION-COMPARISON.md` footnote [2]).

---

## pi-multi-agent — `jwangkun/Pi-Multi-Agent`

- **Repo:** https://github.com/jwangkun/Pi-Multi-Agent
- **Read at:** clone `../vendor/eval/pi-multi-agent`, HEAD `d2fef0f` (2026-06-07), MIT.
- **What it is:** a TypeScript multi-agent **orchestration library** + Express/WS
  server + Next.js dashboard (plan → agent cluster → 4-dim evaluation → replan),
  unrelated to `@earendil-works/pi`. No durable queue, no seats, no skills, no
  grounding. Full matrix and evidence: `ARCH-COMPARISON-pi-multi-agent.md`.
- **Adopt-or-build:** do not adopt (different layer) and do not borrow its
  sandbox (see security, below). Read it for two mechanisms we lack.

| What it does | Why it is worth learning from | durig counterpart |
|---|---|---|
| **5-strategy model routing** — complexity / tool-aware / specialty-match / cost-optimized / direct (`src/models/router.ts`) | Matches cost+capability to the sub-task, not to the speaker | one model per seat — a real gap |
| **4-dimension scored quality gate + replan/retry** — accuracy/completeness/consistency/format, threshold, retry (`src/orchestration/deep-evaluator.ts`, `AgentCluster.executePlan`) | Turns "looks done" into a pass/fail number | QA re-run + pair review (no score) |
| **Clarify-before-execute** — `/api/clarify` returns `WAITING_INPUT` + a `uiSchema` form (`server/index.ts:457`) | Mechanises "ask for the missing decision" | a norm, not a gate |
| **JSON-schema-validated agent output** (`src/workflow/structured-output.ts`, `runtime.ts`) | Machine-checkable handoffs | free-text handoffs |
| **Budgeted, generated-JS workflow engine** — `agent()/parallel()/pipeline()/phase()/log()` under `vm`, token budget + concurrency cap (`src/workflow/*.ts`) | Reproducible pipelines with a hard ceiling; **same API as `vekexasia/pi-extensible-workflows`, uncited** | no script layer today |
| **Atomic session snapshot + stale-running expiry** (`server/session-store.ts`: tmp+rename, `expireStaleRunningSessions`) | Cheap crash-safety for finished sessions | durable substrate is stronger; the tmp+rename write is a good pattern |

**Security red flags (negative example — consult `security.sec` before reusing
anything):** `vm` is not a security boundary but is sold as one; `code_executor`
runs `new Function('sandbox','with(sandbox){…}')` (arbitrary in-process JS);
`web_scraper` fetches any model-supplied URL (SSRF); the API has **no auth** with
`app.use(cors())`; provider keys live in server config.

**What it does not give us:** durability, seat/pod topology, skills, grounding,
or a Windows story. It solves research-report generation, not a grounded domain with real users.

---

## agency-agents — `AgentsRoomDev/agency-agents`

- **Repo:** https://github.com/AgentsRoomDev/agency-agents · MIT ("attribution appreciated").
- **Read at:** clone `../vendor/eval/agency-agents`, HEAD `24485830` (2026-06-29).
- **What it is:** ~217–232 Markdown **agent personas** across 16 divisions, a
  tool-agnostic converter/installer, and a NEXUS strategy layer (playbooks,
  runbooks, handoff templates). No runtime, no queue, no grounding — it is
  **persona/skill content**, not a substrate. Full guide:
  `ARCH-COMPARISON-agency-agents.md`.
- **Adopt-or-build:** borrow selectively (MIT). Best public sample of persona
  authoring at scale; our seats are already the same shape
  (`agents/*/agent.yaml` + `guidance/role.md` + shared skills).

| What it does | Why it is worth learning from | our counterpart |
|---|---|---|
| **Persona template**: Identity & Memory · Core Mission · Critical Rules · Deliverables · Workflow · **Communication Style** · **Learning & Memory** · **Success Metrics** · Advanced Capabilities (`CONTRIBUTING.md`) | Sections our `role.md` omits (voice, metrics, memory); adopt the shape, not the length | role template in `agents/*/guidance/role.md` |
| **Evidence-over-claims QA** — "screenshots don't lie", default to finding 3–5 issues, a "zero issues" claim is a red flag (`testing/testing-evidence-collector.md`) | Turns our "verify with evidence" norm into a minimum before a pass | `shared:testing`, `shared:peer-review` |
| **Default-to-fail certification** — default `NEEDS WORK`, require overwhelming proof, re-cross-check the prior QA rather than inherit it (`testing/testing-reality-checker.md`) | Our qa2/auditor independence, made explicit | `qa2` role + `shared:peer-review` |
| **Independent audit** — never audit your own work; findings = observation + evidence + impact + recommendation, severity-rated; reproducible (`specialized/specialized-model-qa.md`) | A crisp auditor contract | `build.qa2` / auditor |
| **Confidence + source-type labelling** — "name your confidence level and source type", primary > secondary > popular (`academic/academic-historian.md`) | Extends our citation rule with a confidence scale | `shared:grounding` |
| **Structured handoff + PASS/FAIL verdict templates**, named retry limit (3) (`strategy/coordination/handoff-templates.md`, `strategy/playbooks/phase-3-build.md`) | Our pair-review closure and qa→impl loop want these exact shapes | `shared:delivery` |
| **Originality/lint CI** — entity-neutralised 8-word shingle Jaccard, FAIL≥40%/WARN≥20%; frontmatter+section lint (`scripts/check-agent-originality.sh`, `scripts/lint-agents.sh`) | Cheap automated duplicate check as our skill set grows | new linter over `agents/*` |

**Not to borrow:** their files' length/filler; invented success metrics (e.g.
"reduces anxiety 40%", unsourced); the cross-tool converter (we run one
runtime); browser-screenshot QA tooling; any persona voice bought at the cost of
grounding. Their market-trend docs cite vendor reports (MarketsandMarkets,
Deloitte, PwC, G2) — marketing-grade, not evidence.

**What it does not give us:** a runtime, durability, or grounding. It is
reference text for our seats.

---

## aider — `Aider-AI/aider`

- **Repo:** https://github.com/Aider-AI/aider
- **Read at:** clone `../vendor/eval/aider`, HEAD `5dc9490` (shallow, 2026-10-17; **re-cloned and re-pinned to the same commit 2026-10-28 — `--freshness` says `CURRENT`, so aider is dormant at `5dc9490b`, latest remote tag `v0.86.3.dev`**; the pin now lives in the tracked table `docs/VENDOR-PINS.md`)
- **What it is:** a terminal pair-programming agent (single repo, single agent). Not a multi-agent
  substrate — read it for its **edit-and-verify mechanics**: per-model edit formats, a ranked repository
  map, and a lint/test loop that repairs its own edits. Docs: `aider/website/docs/`; edit-format code:
  `aider/coders/`.
- **Review:** `docs/reviews/aider-review.md`.

| What it does | Why it is worth learning from | durig counterpart |
|---|---|---|
| **Per-model edit format** (`--edit-format`: whole/diff/diff-fenced/udiff) with defaults per model (`aider/website/docs/more/edit-formats.md`, `troubleshooting/edit-errors.md`) | One format does not fit every model; format is a first-class config knob | one exact-match `edit` tool for all seats — measure per model (ROADMAP 102) |
| **High-level diffs** — coherent code blocks, not surgical line edits. **Claim corrected 2026-10-28:** the tree says task score went **20% → 61%** (GPT-4 Turbo) and **26% → 59%** on 89 python refactoring tasks, laziness down **3×** — not "30–50% fewer errors", a figure that appears nowhere in the clone (`aider/website/docs/unified-diffs.md:36-45`) | The model edits better when the unit is a whole function | seat edit guidance |
| **A failed edit is answered with candidates** — "Did you mean to match some of these actual lines from {path}?", an already-applied check, and "The other N blocks were applied successfully. Don't re-send them." (`aider/coders/editblock_coder.py:96-118`, `:602-624`) — **observed 2026-10-28** | 71% of our edit errors are anchor misses (153 of 215 — `tools/edit-failure-rate.mjs`) and pi's refusal names no candidate (`edit-diff.ts:256`) | the seat `edit` seam in `src/seattools.mjs` (ROADMAP **215**) |
| **In-turn lint/test + bounded self-repair** — `auto_lint` default on, failures fed back as a `reflected_message`, `max_reflections = 3` (`aider/coders/base_coder.py:100-101,1599-1622`) | Gates the edit while the turn is still open; our gates are post-hoc | seat-side `node --check` + the item's demo after each edit (ROADMAP **218**) |
| **Bounded flexible patching** — normalize a failed hunk to a real diff, split into sub-hunks, vary context (`unified-diffs.md`, `aider/coders/editblock_coder.py:133-181`). **Claim corrected 2026-10-28:** "9× fewer apply failures" is not in the clone. **And the similarity fallback is dead code** — a bare `return` at `editblock_coder.py:183` puts `replace_closest_edit_distance` (`:184-187`) past the end of the function's live path | Take the narrow strategies (whitespace tolerance, blank-line drop, `...` elision); there is nothing to reject at the similarity tier because aider never reaches it | `edit` is exact-match + silent typography-fold (`edit-diff.ts:34-53,221-243`) |
| **Lint/test after every edit, auto-repair** (`--lint-cmd`/`--test-cmd`/`--auto-test`, `aider/website/docs/usage/lint-test.md`) | Catch a broken edit before it compounds | `node --check` + demo gate before accept (ROADMAP 106) |
| **Repository map** — graph-ranked, token-budgeted (~1k) symbol map sent every request (`aider/website/docs/repomap.md`) | Gives the model repo-wide context cheaply | seats `read`/search; a repo-map section for seat prompts (ROADMAP 113) |
| **Prompt-cache ordering + keepalive** (`aider/website/docs/usage/caching.md`) | Cache the stable prefix; ping to keep it warm | constitution-first byte-stable prefix; consider a keepalive (ROADMAP 114) |
| **Architect/editor split** (`aider/website/docs/usage/modes.md`, `config/editor.md`) | Planner and applier are different skills | gated on measured apply failure |
| **Keep context <~25k; drop irrelevant files** (`troubleshooting/edit-errors.md`) | Too much context makes models disobey the edit format | thin-context contract |

**Not to borrow:** whole-file edit as a default (returns the entire file), auto-commit-per-edit (conflicts
with one-commit-per-concern + explicit paths), and the **cross-file fallback** — a block that misses the named
file is tried against every file in the chat (`aider/coders/editblock_coder.py:57-64`, observed 2026-10-28),
which is the wrong-location hazard in feature form. (The `SequenceMatcher` **similarity** fallback we used to
list here is **dead code** at this pin — `editblock_coder.py:183` returns before it. Nothing to reject.)

**What it does not give us:** a runtime, durability, queue, seats, or verifier split. Edit/verify
mechanics only.

---

## agent-governance-toolkit — `microsoft/agent-governance-toolkit`

- **Repo:** https://github.com/microsoft/agent-governance-toolkit · MIT.
- **Read at:** clone `../vendor/eval/agent-governance-toolkit`, HEAD `cfb44576` (shallow, 2026-10-17).
- **What it is:** an application-layer **governance + agent-SRE** toolkit — deterministic, fail-closed
  policy interception for tool calls, Ed25519/DID identity, execution rings, kill switch/saga, SLOs,
  circuit breakers, chaos testing, incident detection, and structured incident runbooks. Six subsystems,
  each with an RFC-2119 spec + 25 ADRs. Not a durable queue/store/fleet substrate, and a **public
  preview** (spec runs ahead of code: quarantine is a removed stub, `HALF_OPEN` is never entered).
- **Review:** `docs/reviews/agent-governance-toolkit-review.md`.
- **Adopt-or-build:** do not adopt (different layer); read it for four **security** mechanisms and five
  **healing** mechanisms. Registered as ROADMAP 133–144.

| What it does | Why it is worth learning from | durig counterpart |
|---|---|---|
| **Fail closed on every policy-evaluation error** — any exception → deny; no fail-open flag (`docs/adr/0013-...`) | A passing check must mean the rules *ran*, not that evaluation was skipped | durig refusals are per-guard, not one decision point with a deny-on-error invariant (ROADMAP 133) |
| **Structured denial** (`rule_id`, `action`, `policy_version`, `agent_id`) (`docs/ERROR_HANDLING.md`) | A refusal that names its rule is auditable and teachable | string refusal messages in `src/confine.mjs` (ROADMAP 134) |
| **Monotone context ratchet** — max-lattice sensitivity + grow-only restrictions, inherited on delegation (`docs/security/context-accumulation-governance.md`, `.../policies/context_envelope.py`) | A signal raised once must not be silently lowered by a later quiet turn | pass-end degeneration assessment can forget a signal once the window moves (ROADMAP 135) |
| **Threat model per trust boundary** (human→agent→agent→tool→platform, STRIDE) (`docs/security/threat-model.md`) | A fixed boundary checklist beats a prose method | `security-trust-boundary-review.md` has the method, no fixed taxonomy (ROADMAP 136) |
| **Per-seat circuit breaker** — trip after N failures, `is_available` only when CLOSED, manual close (`docs/specs/AGENT-SRE-GOVERNANCE-1.0.md` §6, `.../cascade/circuit_breaker.py`) | Isolate a broken seat instead of re-waking it forever | `src/supervisor.mjs` escalates but never isolates (ROADMAP 137) |
| **Structured incident lifecycle + typed signals + dedup/correlation windows** (`docs/specs/AGENT-SRE-GOVERNANCE-1.0.md` §14, `.../incidents/detector.py`) | Turns a notice stream into durable, non-duplicating incidents | `docs/incidents/` exists but detection is manual; `attention` has no dedup (ROADMAP 139) |
| **Executable runbooks with per-step rollback + approval gates + trigger conditions** (`.../incidents/runbooks/*.yaml`, `runbook_executor.py`) | Rollback and approval as first-class step fields | prose runbooks + ROADMAP 81–88/87 executor (ROADMAP 140) |
| **Chaos faults incl. behavioural** (`DEADLOCK_INJECTION`, `TRUST_PERTURBATION`) + abort conditions + resilience score (`AGENT-SRE-GOVERNANCE-1.0.md` §7) | Test the agent failure modes a process-crash test cannot reach | ROADMAP 67 host chaos suite is process-level (ROADMAP 141) |
| **Rogue detection** — frequency z-score + action entropy (repetitive *and* chaotic) + capability violations (`.../anomaly/rogue_detector.py`) | Catches the chaotic pole the repeat-counter is blind to | `src/degeneration.mjs` counts repeats/turns only (ROADMAP 142) |
| **Advisory→blocking graduation checklist** (`docs/operations/advisory-to-blocking-graduation.md`) | Turns "no false positives before enabling" into a dated gate + rollback | the degeneration guard's zero-false-positive rule is currently prose (ROADMAP 144) |

**Not to borrow:** Ed25519/DID mesh, execution rings, trust scoring 0–1000, the multi-language SDK
sprawl, the enterprise certification (SOC2 / EU AI Act / NIST / ISO) mappings, and the `<0.1 ms` policy-engine figure quoted as end-to-end overhead
(`docs/LIMITATIONS.md` §3). Wrong layer for a single-operator local rig; the least-privilege principle
is already ROADMAP 60.

**What it does not give us:** any durable queue, single-writer store, crash recovery, seats, or
landing/merge model — every durig-internal durability and recovery mechanism stays ours.

**Policy surface (OWASP).** AGT also maps to the **OWASP Agentic Top 10 (ASI01-ASI10)**, the OWASP
LLM Top 10, and the OWASP MCP Top 10, and ships four policy packs (`examples/policy-templates/`)
plus 14 static review rules mapped to ASI risks (`.../copilot-governance/src/reviewer.ts`). The
**ASI Top 10 is a directly applicable external checklist** for durig and is adopted (self-assessment,
deny-by-default budgets, security lint, output screening, reversibility-aware approval, vendored-code
supply chain) - see the review Addendum and ROADMAP **145-150**. The enterprise certification
mappings stay out of scope.

---

## The 2026-10-28 seven-clone sweep (seat-persona / system-prompt surface)

Seven clones, all pinned on one vendor day (`2026-10-27/28`), all reviewed end-to-end against **one** question: *how do
we define seat system prompts so they are easy to edit before the rig starts, and which existing standard can we reuse?*
Full reviews: `docs/reviews/{crewai,symphony,hermes-agent,openhands,metagpt,oh-my-pi,prime-agent}-review.md`. Pins,
licence signatures and highest tags: `docs/VENDOR-PINS.md` (generated; `node tools/vendor-pins.mjs --check`).
Orientation for every walk started with `node tools/competitor-brief.mjs --project <name>` — **not** with a grep.

**Where the seven land (the answer we can offer before the ruling).** Nobody in this set invents a persona DSL. The
convergent shape is *a file with front matter, three override slots, and capability declarations*:

| piece | whose | shape |
|---|---|---|
| the file format | **oh-my-pi** | markdown + front matter: `name`, `description`, `tools:` allowlist, `model: "@slow"` (a **role alias**), `spawns:`, `output.properties` (the return contract) — `packages/coding-agent/src/prompts/agents/reviewer.md:1-12` |
| the override semantics | **prime-agent** | `custom_prompt` *replaces the static prefix, dynamic tail still applies*; `append_system_prompt` adds a rule — `crates/pa-core/src/prompts/system_prompt.rs:64-76` |
| the protected default | **openhands** | a seeded `default` profile, non-renameable, which is the template new profiles copy — `.agents/skills/verify-openhands/references/feature-map/F13-agent-profiles.md:1-20` |
| the reviewable artifact | **hermes-agent** | a committed snapshot of the **rendered** prompt + tool schemas per (surface × model family), regenerated through production code, gated by a test that prints the stale paths and the regenerate command — `scripts/ci/prompt_surface.py`, `tests/ci/test_prompt_surface.py:1-55` |
| the cache contract | **prime-agent** + **hermes-agent** | static layers "must never contain session-specific values (**the cache-safety guard test pins the boundary**)", `cached_prefix_len`; hermes builds the prompt once/session for prefix-cache warmth — `prompts/layers.rs:1-2`, `agent/system_prompt.py:3-8` |
| the truth rule | **prime-agent** | "the wake-up facts the daemonless line states **must match the embedding's wiring**" — the prompt may not claim a capability the harness did not grant — `system_prompt.rs:88-95` |

**Rows worth their own line (mechanism → our counterpart).**

| project | what it does (cited) | why it matters here | our counterpart |
|---|---|---|---|
| crewai | Persona = `role` / `goal` / `backstory` in `agents.yaml`; system prompt composed from **named slices** with `system_template` / `prompt_template` / `response_template` override slots (`crewai/lib/crewai/src/crewai/utilities/prompts.py`) | Editable-before-start personas in plain YAML, and an override seam that does not require rewriting the protocol | seat `instructions` as one opaque string (`rig.selfdev.json`); `wip/seat-prompt-files` |
| crewai | Generates **`AGENTS.md` / `CLAUDE.md` / `CURSOR.md` / `GEMINI.md`** adapters for one project (`crewai-tools`) | One authored artifact, N harnesses — the same problem we have with `AGENTS.md` vs pi's config | `AGENTS.md`, `.agents/skills/` |
| symphony | `WORKFLOW.md`: YAML front matter (config) + Markdown body (prompt), rendered with `strict_variables: true` / `strict_filters: true` (`prompt_builder.ex`); repo-versioned | Config and prompt in **one reviewable file**, and strict rendering that fails loudly on a typo instead of rendering empty | our runbook front matter (id/last_verified/done) is the same instinct, for docs not prompts |
| symphony | A `SPEC.md` written in RFC keywords, but **no test-to-clause conformance evidence found** in the repo | A spec that outruns its tests is design, not proof — mark it `advertised` | ROADMAP 137/202 (`check` rules over claims) |
| hermes-agent | Prompt tiers `stable` / `context` / `volatile`, each with **token counts per surface** (`tests/fixtures/prompt_surface/surfaces.json`: `context` 134 / `stable` 1829 / `volatile` 1528, + 11,242 tool tokens) | Seat prompt cost is currently unmeasured, and the 189 verifier ruling is being decided without it | ROADMAP 140, 189 |
| hermes-agent | A test that checks the **failure summary names the surface and tool that changed** (`tests/ci/test_prompt_surface.py:46-55`) | Our seeded-bug gate proves a guard fails, never that its message is useful | D142 (publish the pattern with the count) |
| hermes-agent | "pinned skills are **operator guidance for the user's session, not payload for every internal fork**" | Answers a question our persona design has not asked: what a subagent does *not* inherit | subagents (undefined today) |
| openhands | `systemPromptMode: standard \| append \| custom`, stored in **different fields** (`persona` vs `system_message_suffix`), with precedence stated where enforced ("a stored persona wins over stored instructions", `src/routes/agent-settings.tsx:147, 316-317`) | The smallest vocabulary that covers "add a rule" vs "replace the identity", with no ambiguous state | seat prompt override semantics (none) |
| openhands | Skill **scopes** `project > personal > public`, plus a legacy-path marker because "dropping it would silently misfile legacy skills as 'public'" (`src/utils/skill-scope.ts:3-14`) | Exactly D103's half-applied-rename bug class, solved with a marker instead of a switch | `src/config.mjs`, `DURIG_*`/`DURIAN_PI_*` |
| openhands | **DefenseClaw** integration: scans skills and MCP servers **before they run**, inspects LLM traffic, emits audit evidence — no code changes to either project (`docs/DefenseClaw.md:3-18`) | A pre-run gate on skills/MCP that we do not have for `.agents/skills/` | nothing; ROADMAP 203 |
| metagpt | Persona = a framework constant, `PREFIX_TEMPLATE = "You are a {profile}, named {name}, your goal is {goal}."`, with a `desc` escape hatch that replaces it (`metagpt/roles/role.py:51, 325-331`) | The pattern we are trying not to become: editing a persona means editing source | seat prompts in code vs data |
| metagpt | `docs/.well-known/skills.yaml` declares each skill with `x-prerequisite.configurations` — the **env keys a skill needs**, typed, with links | Our skills declare nothing; D103 is precisely "a required setting nothing declares" | `.agents/skills/*/SKILL.md` front matter; ROADMAP 204 |
| metagpt | **0 hits** for OWASP/NIST/CWE/guardrail/prompt-injection across its own `.md`/`.py` (pattern published in the review) | 28k prompt-template directories and no threat model at all — volume is not maturity | our own "zero with its pattern" discipline |
| oh-my-pi | **Agent Hub**: subagent roster with usage, transcripts, steering/revive/kill, and it "discovers **parked** subagents from the current session's persisted artifacts when a session is resumed" (`docs/agent-hub.md:1-12`) | The orphan audit the operator asked for (`audit-15-orphans-and-5-parked`) is a **query over artifacts we already keep** | TUI, spool/audit records; ROADMAP 205 |
| oh-my-pi | `.omp/commands/{triage,review-prs,fix-issues,cleanup,release}.md` — repo-versioned **runnable** commands | Our runbooks are prose for a human/delegate; theirs are steps the harness runs | `docs/runbooks/*`; ROADMAP 206 |
| oh-my-pi | 12 per-model **tool-call dialect** docs (`docs/toolconv/*`) and model **capability screening** that excludes `embedding`/`rerank`/`ocr`/`guardrail` modes, with a declared `128000` context default (`docs/models.md:496`) | The pre-conditions for running a small local verifier (D140) | `docs/reviews/verifier-model-survey-2026-10-27.md` |
| prime-agent | Prompt **layers** as files + a `layer_source()` provenance map (`crates/pa-core/src/prompts/layers.rs:4-16`) | Which paragraph came from which file — the reviewability we lack | seat prompts |
| prime-agent | Evidence gates: refuses a round "with fewer than 2 measured cases per split"; "slots that only errored force `rerun`, never `keep`"; the analyzer must return **verbatim quotes with trace paths** (`src/prompts/tools/ratchet.md:19, 56`) | Rules our verifier family (189) needs and does not have | seeded-bug gate |
| prime-agent | `docs/legacy-upgrade-contract.md:1-12`: scope, exclusions, method+date ("a full two-page GitHub Releases API query on 2026-10-09 returned 107 releases"), a linked JSON inventory, and "**inventory and source comparison are not evidence** that an installed-artifact upgrade … has passed testing" | The evidence-disclaimer sentence our own generated artifacts should carry | `docs/VENDOR-PINS.md` |

**Not to borrow (recorded so the next reader does not re-litigate):** CrewAI's `knowledge/sources/agents/` auto-ingest
(no gate on what enters context); Symphony's untested RFC-keyword spec as evidence of behaviour; hermes-agent's Docker/
Modal container isolation layer (`security.md` layer 4) and its shipped dual-use skills
(`optional-skills/security/godmode/`, `obliteratus`); OpenHands' guardrail-proxy sidecar and helm/cloud deployment;
metagpt's agent-authored skills and hard-coded package-relative spec paths; oh-my-pi's Docker dev image and skill
marketplace; prime-agent's persistent-REPL architecture and a second per-change-notes directory duplicating
`docs/DECISIONS.md`.

**Freshness: corrected the same day it was first written.** The sweep's first read was "`metagpt`'s pinned commit is
2026-01-21 while the other six are 2026-10-27/28, so our metagpt clone has gone stale." **Wrong**, and worth recording
because a date column invites exactly that mistake: `node tools/vendor-pins.mjs --freshness` (clone HEAD vs
`git ls-remote origin HEAD`) shows **metagpt's pin IS upstream's HEAD** — the *project* is dormant, the *clone* is
current. The same run shows **five of the seven clones are already behind upstream** (`crewai`, `hermes-agent`,
`oh-my-pi`, `openhands`, `prime-agent` moved within a day of being cloned). Operator ruling 2026-10-28 (D146): a
**behind** clone is re-cloned or removed with a dated note; a **dormant** project stays as a labelled reference. Decided
per clone by the verdict word, never by reading the date.

## What the seven say about *formatting* a system-level prompt (standards vs de-facto vs missing)

The operator asked directly whether there is a common pattern or standard for a system-level prompt **and its model,
tools and security items**. Answer, in three registers — and the third one is the honest part.

**(a) A real external standard exists for the *skill* surface, not the persona surface.** We already normalised against
it: the Agent Skills format specification (`docs/reviews/agent-skills-review.md`, read at
`vendor/eval/agentskills-spec/docs/specification.mdx`; that clone is now gone, so its pin is prose and
`--check` NOTEs it). Our `.agents/skills/*/SKILL.md` front matter is spec-valid per that review.
**AGENTS.md as a repo-level instruction convention is de-facto standard by adoption — 5 of 7 clones carry one**
(`hermes-agent`, `oh-my-pi`, `openhands`, `crewai`, `prime-agent` have it at the repo root; `symphony` and `metagpt` do
not, and both put instructions elsewhere: `WORKFLOW.md` and code).

**(b) The persona-file vocabulary has converged without any body ratifying it.** The recurring key set, with the
citation for each:

| key | who | shape |
|---|---|---|
| `name`, `description` | oh-my-pi, crewai (`role`/`goal`/`backstory` instead of prose), openhands profiles, prime-agent layers (by file name) | identity + the selection signal |
| `tools:` allowlist | **oh-my-pi** (`agents/reviewer.md:4`), **openhands** (`agentProfileSupportsTools`) | capability granted in the definition, not inherited silently |
| `model:` as a **role alias** | **oh-my-pi** (`model: "@slow"`, `resolveModelRoleValue`); **aider** (older review: per-model edit format) | the definition states a *need*; the operator maps it |
| `output:` structured return contract | **oh-my-pi** (`output.properties.…enum`, `metadata.description`); **prime-agent**'s analyzer takes `schema=CHANGE` with `evidence[{trace,quote}]`; **agent-fleet** (older review) ships a versioned `Verification Contract` | the return shape is **JSON-Schema/JTD-shaped** — oh-my-pi even codegens TypeScript from JTD (`src/tools/jtd-to-typescript.ts`) |
| `spawns:` / recursion facts | **oh-my-pi** (`spawns: scout`); **prime-agent** (`allow_recursion`, `rlm_depth`, `rlm_parent_agent`, `can_spawn`) | the sub-agent graph is declared, and depth/parenthood are prompt inputs |
| scope + precedence | **openhands** (`project` > `personal` > `public`; `systemPromptMode`), **prime-agent** (`custom_prompt` vs `append_system_prompt`), **oh-my-pi** (`getProjectPromptsDir`/`getPromptsDir`, `source: "(user)" / "(project)"`) | replace vs append, and which layer wins |
| protected default | **openhands** (seeded `default`, non-deletable, the copy template) | the thing a new seat is cloned from |
| a schema you can validate against | **nobody** for personas — prime-agent's `frontmatter.md` is a mustache *emitter*, crewai/metagpt use typed models (`YamlModel`) around config, not a public schema | the closest thing to validation is codegen from a template |

**(c) Security items are the gap, and naming it is the useful answer.** Across seven projects there is **no shared
vocabulary for putting security into a persona definition**. What exists, and no more:

| what they do | cited | limit |
|---|---|---|
| **enforcement-gated fields** — a profile field is only *offered* where the backend enforces it: `agentProfileSupportsSecretRefs` ("cloud launches do not enforce a profile's secret scope yet"), `…SupportsTools` ("cloud launches ignore a profile's tools for now"), `…SupportsSkills`, `…SupportsRouter` | `openhands src/api/agent-profiles-service/profile-field-support.ts:1-21` | the strongest security-shaped pattern in the set: **if the runtime does not enforce it, do not let the definition claim it** — and it is *not* in the persona file, it is in the field layer |
| **prompt facts must match wiring** + session capability inputs | `prime-agent crates/pa-core/src/prompts/system_prompt.rs:88-98` | runtime-computed, not authored per seat |
| **CWE ids as inline anchors on safety branches** ("fail closed BEFORE resolution"), an 8-layer security doc, and a **ruleset that requires core-team approval to change the prompt-snapshot dir** | `hermes-agent gateway/session.py:610`, `cron/scheduler.py:2472`, `website/docs/user-guide/security.md:11-24`, `tests/ci/test_prompt_surface.py` docstring | repo-level and process-level — nothing a seat author can declare |
| **guardrails as provider passthrough** (`guardrailIdentifier/Version/Trace` copied to Bedrock) | `oh-my-pi docs/models.md:122, 241`; `docs/toolconv/pi-native.md:110-122` | the guardrail is *someone else's*; the docs do not claim otherwise, which is the part to copy |
| **a third-party pre-run gate bolted on** (scans skills + MCP before they run, emits audit evidence) | `openhands docs/DefenseClaw.md:3-18` | registered as ROADMAP 203; the gate exists, ours does not |
| **nothing** | — | **no project declares, in the persona/seat definition: what needs human approval, which paths it may write, what its blast radius is, or which threat model applies.** CrewAI's `knowledge/` auto-ingest and metagpt's agent-authored skills go the *other* way. That gap is durian-pi's opening (and is why ruling 3 — approval gates on seat-prompt edits — has no precedent to copy and must be built)

## The 2026-10-28 tool-and-skill lifecycle sweep (what makes an agent-authored capability durable and default)

One question, nine pinned clones (`docs/VENDOR-PINS.md`, all cited by short HEAD) **plus our own installed harness**
(`@earendil-works/pi-coding-agent@1.4.0`, whose TypeScript is readable because the shipped `.js.map` files carry
`sourcesContent`). The question was **not** the 2026-10-28 question (persona/system-prompt *format*); it is
**lifecycle**: who registers a capability, what the model is told about it on every request, and what survives a session
boundary. Report: `docs/reviews/harness-tools-skills-research.md` (observed half) →
`docs/reviews/harness-tools-skills-followup-research-prompt.md` (the public harnesses: Claude Code, Codex CLI, Cursor,
Cline, Goose — **unexamined here**). Registered as ROADMAP **235–239**; five rejected-with-reason rows are in the report §8.

| project | mechanism found (cited) | why it matters here | our counterpart |
|---|---|---|---|
| **pi 1.4.0 (our harness)** | project extension auto-discovery `.pi/extensions/` when trusted — `src/core/package-manager.ts:2484-2491` + `collectAutoExtensionEntries:599-640`; `pi.registerTool()` `src/core/extensions/types.ts:1671` with `promptSnippet`/`promptGuidelines`/`exposure`/`defaultActive` (`:579-640`); `.pi/APPEND_SYSTEM.md` → the `addendum` prompt section (`src/core/system-prompt.ts:27-28,172`), project file **replaces** the user file (`docs/configuration.md:39`) | the only mechanism that is in front of a **small local model** on every request with no retrieval burden — and it has never been switched on here (`ls .pi` → absent) | `tools/*.mjs` invoked as `bash` strings; `.agents/skills/`; no `.pi/` → ROADMAP 235, 236 |
| **pi 1.4.0** | `tool_call` fires pre-execution with mutable `input` and `{block:true,reason}`; **blocks when there is no UI** in the shipped example — `types.ts:1194-1264`, `examples/extensions/permission-gate.ts`, `protected-paths.ts`, `confirm-destructive.ts`, `dirty-repo-guard.ts`; `destructiveHint` metadata exists for exactly this (`types.ts:519-531`) | the outer-layer equivalent of the guard 232 needs inside the product; the no-UI default is the right posture for an unattended delegate | the 36→1 worktree-ledger loss (`docs/incidents/2026-10-28-cross-os-ledger-pruned-and-untracked-loss.md`) → ROADMAP 238 |
| **pi 1.4.0** | `ToolExposure = direct\|model-only\|codemode\|deferred\|hidden` (`types.ts:516`) + a BM25 `tool_search` that promotes a *deferred* tool into the declaration for the next call, recorded in the transcript so it survives `/tree`, resume, fork (`src/extensions/tool-search/tool.ts:1-16,30-36`) | the cheap alternative to always-on registration: pay ~0 standing tokens, pay one call when needed — unmeasured which wins at 7 instruments | follow-up prompt Q8 |
| **oh-my-pi `6f3fbc94`** | a **memory layer with a named injection budget**: 5 backends (`off` default), `memories.summaryInjectionTokenLimit`, a `learn` tool writing newest-first, deduped, secret-redacted lessons **capped at 100** and injected **starting next session**, `memory://` URLs so the agent reads the artifact instead of trusting the injection, and *generated* skill playbooks (`docs/memory.md`) | the only system found that states a per-injection token budget — the number our own injection debate lacks; its "treat conflicting memory as stale" rule is the precedence we would need | ROADMAP 236 (budget), the `AGENTS.md` clock-out note "take notes on pitfalls" (no durable surface today) |
| **oh-my-pi `6f3fbc94`** | maintainer guidance for tiny models: *"a prompt carries roughly 3–5 constraints before rules start displacing each other"*, "Code already neutralizes a failure mode? **DELETE** its rule" (`.omp/skills/system-prompts/small-models.md`); skills that ship their **own scripts** (`.omp/skills/tool-prompt-optimization/scripts/probe.ts`) | we run the delegate on the **same small model as the seats**, so "add more instructions" is the wrong lever and "register the instrument / block the verb" is the right one | `.agents/skills/*/SKILL.md` descriptions (236), `tools/` instruments (235) |
| **crewai `f3d0099d`** | progressive disclosure levels **1\|2\|3** (frontmatter-only → full body → resource catalogue) with a `load_skill` tool the model calls to raise the level, `allowed-tools` frontmatter as a **pre-approved tool grant**, and `SkillUsedEvent` telemetry (`lib/crewai/src/crewai/skills/models.py:4,26-34,81`, `skills/tool.py:24-35`, `agent/core.py:600-619`); `crewai skill create` scaffolds a skill (`lib/cli/src/crewai_cli/skills/main.py:24-56`) | skill use is *measurable from the product*, which is the only reason our "24% re-derivation" number could be computed at all; and a capability grant attached to an instruction pack is a concept our skills have no word for | ROADMAP 236 (tiering + description form), 237 (measuring use) |
| **openhands `6354932e`** | a skill directory that carries its own **references, feature map, evidence JSON and control script**, plus frontmatter `triggers:` (a slash command *and* literal phrases) and a description written as "This skill should be used to …" (`.agents/skills/verify-openhands/SKILL.md:1-13`, `scripts/control-openhands.mjs`); but the public catalog is an **immutable build-time snapshot** baked into the bundle (`src/api/skills-service.ts:29-40`) | the first half is the shape of a skill that survives a session boundary; the second half is 233's failure class wearing a version number — the reason we rejected a build-time/cloud catalog | `.agents/skills/delegating-to-durian-pi/SKILL.md` → ROADMAP 236 |
| **hermes-agent `07f075c2`** | edit approval bound **per-runtime through a `ContextVar`**, so CLI and gateway sessions bypass it by construction; `SENSITIVE_AUTO_APPROVE_NAMES` (`.env`, `id_rsa`); the authoritative path set is `paths`, not the display `path` (`acp_adapter/edit_approval.py:1-45`) | the exact way a guard becomes theatre: correct mechanism, selectively wired. Any guard we ship must state which surfaces it covers and which bypass it | ROADMAP 238 acceptance (name the bypasses) |
| **pi-subagents `31208242`** | a four-level precedence table — builtin < installed package < user `~/.pi/agent/agents/**` < project `.pi/agents/**`, legacy `.agents/**` still read with project winning collisions — plus `agentScanDirs`, `agentExcludeDirs`, `agentScope`, and discovery that **degrades to user scope when project trust is declined** (`docs/agents.md`); agents registered as tools (`src/extension/declaration-pinning.ts:67`); "a skill referenced ≥2 times ⇒ recommend a subagent" (`src/agents/proactive-skills.ts:6-8`) | the collision/trust vocabulary our dual-host plan needs and does not have; and a product-side nudge against re-derivation, which is our measured defect | ROADMAP 236 (vocabulary), the two-host workflow lever in `docs/reviews/pi-harness-usage-audit-2026-10-28.md` |
| **aider `5dc9490b`** | no skill surface at all (0 `SKILL.md` in 691 tracked files); the durable layer is two **plaintext files** — chat history and input history (`aider/args.py:271-287`), with `/run` commands appended to input history (`aider/coders/base_coder.py:2474`) — and its only guard is a *commit* guard (`--dirty-commits` `args.py:446-449`, `--yes-always` `:760`) plus `.aiderignore` at the git root (`:422-431`) | the cheapest possible cross-session layer, greppable by anyone: the same property that let us recover deleted `write` bodies out of pi's JSONL transcripts | ROADMAP 239 (`tools/transcript-recovery.mjs`) |
| **metagpt `11cdf466`** | per-role long-term memory with explicit `recover_memory(role_id, rc)` at startup (`metagpt/memory/longterm_memory.py:21-40`); 0 `SKILL.md` | the recovery-per-actor framing matches our per-seat model, but there is no injection budget and no inspection surface — rejected with reason | rejected: report §1 |
| **symphony `be10a1b7`** | no skill surface (2 skill-ish hits); `WORKFLOW.md` front matter carries tracker/workspace/hooks config for the runner | re-confirms that "agent rig" and "skill lifecycle" are orthogonal: a queue-driven rig can have none of this | our own `rig.selfdev.json` + `docs/NEXT.md` |

**Two findings only a sweep shows (publish them so nobody re-learns them).**
1. **Our harness was the strongest system in the comparison, and we had not opened it.** The `dist/` build looks opaque,
   but its `.js.map` files embed `sourcesContent`, so 251 upstream `.ts` files are recoverable read-only; the whole pi
   half of this sweep cost ~6 tool calls once that was known. Recorded recipe: walk `dist/**/*.js.map`, write
   `sources[i]` → `sourcesContent[i]`. Citations in the report are to **pi 1.4.0 upstream paths** and drift on a pi
   upgrade — re-extract, never trust the line numbers across versions.
2. **Nobody guards the verbs that hurt us.** Across ten systems: no default or configurable intercept for
   `git worktree prune` / `git clean -fd`. pi ships the *hook* and three example policies; the policy itself is ours to
   write. Do not report a harness-side guard as 232's fix — the broker's own `pruneWorktrees` call
   (`src/broker.mjs:1167` → `src/worktree.mjs:649`) runs where no outer extension can see it.
2. **Correction to finding 2, same day, and a second correction to this correction (also same day).** "No configurable
   intercept" is wrong for GitHub Copilot CLI: it ships command-pattern deny rules (`--deny-mode "command:git worktree prune"`,
   plus `sandbox:workspace-write`). What replaced it, and what the delegate then got wrong: an earlier version of this entry
   attributed the fail-open behaviour to issues **#978/#4438**, fetched them, and found their titles are about *skills*, not
   hooks — **#978 is "Skills are not used unless explicitely stated"** and **#4438 is "`disable-model-invocation: true` makes a
   skill unreachable, not manual-only"** (both correctly cited by the round-2 report for *those* claims; the mis-attribution
   was the delegate's, and the report's own hooks claims sit on an undefined anchor). The fail-open behaviour is nevertheless
   real and documented, at numbers the delegate fetched and title-checked on 2026-10-28:
   [#2893](https://github.com/github/copilot-cli/issues/2893) *"preToolUse hooks silently bypassed under parallel tool calls
   (timeout->allow fallback + serial dispatch…)"* and
   [#3590](https://github.com/github/copilot-cli/issues/3590) *"PreToolUse hook `permissionDecision: "ask"` auto-approved by TUI
   since v1.0.53"* (copies sha256-pinned in `inputs/fetched/MANIFEST.md` §3). So the shape we want — deny rule read from the
   repo, enforced by the harness, fail-closed — **exists in the field**, and its own tracker shows guards silently degrading.
   The 232 conclusion stands unchanged: the broker's own `pruneWorktrees` call runs where no outer harness can see it, so an
   outer guard is belt-and-braces only. **Protocol change this forced:** fetch the cited page/issue and read its title before
   repeating a claim (`docs/runbooks/research-request.md` Do 5, D159).

## The 2026-10-28 public-harness pins (five clones: source-grade for three, docs-grade for two)

Operator granted the clones (`--depth 1`) on 2026-10-28 so the public-harness half of the tool/skill-lifecycle
study could stop resting on fetched pages. Pins are generated in `docs/VENDOR-PINS.md`; `node
tools/vendor-pins.mjs --check` → **PIN CHECK PASS (14 clones)**. **No observed pass has been run on any of these
five yet** — the round-2 report (`docs/reviews/harness-tools-skills-public-harnesses-research.md`) is entirely
`advertised-elsewhere`, and its claims citing `vendor/eval/<name> · <head>` are doc claims made *near* a pin, not
behaviour read from that pin. That gap is ROADMAP **241**.

| clone | pin | license | what is actually in the tree | grade |
|---|---|---|---|---|
| `codex` | `d373d649` | Apache-2.0 | **full Rust source** (`codex-rs/`) + `docs/` — the only one of the five whose policy/approval engine, hook-trust storage and AGENTS.md budget are readable at a pin | source — **partial observed pass run 2026-10-28**, guard axis + git-plane policy only:
`docs/reviews/codex-enforcement-design-2026-10-28.md`. Permission profiles, the network tier and where `plugin_trust` is
persisted are unread, so this is **not** a full review and no row of it may be cited as a behaviour claim about Codex |
| `cline` | `51f63e4f` | Apache-2.0 | full TS monorepo (`apps/`, `sdk/`) — rule merge order and `paths:`-conditional discovery are readable | source |
| `goose` | `775b3958` | Apache-2.0 | full Rust (`crates/`) + `documentation/docs/` (the vendor-site paths the round-2 report cited are **404**; the repo paths are the resolvable ones) | source |
| `claude-code-docs` | `58d6da1e` | UNRECOGNISED (`LICENSE.md`) | **CHANGELOG + docs + plugins + mods only — no implementation.** Can never yield `observed`; it does yield changelog-grade evidence, which is better than marketing copy | docs |
| `copilot-cli` | `84ee80ea` | UNRECOGNISED (`LICENSE.md`) | **README + `install.sh` + changelog only** (596 KB — the small size is correct; the CLI is closed). Useful chiefly as a public **issue tracker**, each issue fetched and title-checked 2026-10-28 (`inputs/fetched/MANIFEST.md` §3): **#2893** preToolUse silently bypassed (`timeout->allow` fallback + parallel dispatch) · **#3590** `permissionDecision: "ask"` auto-approved · **#2540** **plugin-defined `hooks.json` hooks never fire, in the main session or subagents** · **#5098** adding `sandbox.userPolicy.filesystem` paths stops a `sessionStart` hook · **#4438** `disable-model-invocation` makes a skill unreachable rather than manual-only · **#978** skills unused unless explicitly named | docs |

**What the pins change, right now, without an observed pass:**
1. **ROADMAP 241 exists because `codex` is now readable.** The operator ruled *research before 232*: before the
   broker's destructive-call fix is scheduled, read what a shipped permission/policy engine looks like end-to-end —
   a policy engine, an approval-policy ladder, deny rules read from config, and trust persisted **out-of-band** (in
   an `mcp-oauth`-shape, outside config and outside git, so `git diff` never shows a permission grant). `codex-rs/`
   answers whether that design is copyable for a broker, or only borrowable in shape. **A second reason, from that
   tracker:** [#2540](https://github.com/github/copilot-cli/issues/2540) *"Plugin-defined preToolUse hooks (hooks.json)
   do not fire - neither in main session nor subagents"* and
   [#5098](https://github.com/github/copilot-cli/issues/5098) *"sessionStart hook stops running after adding
   `sandbox.userPolicy.filesystem` paths"* — i.e. **which plane a guard is declared on, and what config is present,
   decides whether it runs at all**. That is the failure mode D158's package-installed guard must be tested against:
   a guard that is *installed* and *not firing* looks identical to one that is working.
2. **Capture-on-success (ROADMAP 240) has a second instance, and it is readable.** Goose writes recipes into a
   recipe library at runtime (`crates/goose/src/recipe/local_recipes.rs:155,194` — `generate_recipe_filename` +
   save), and ships a documented *"recipe cookbook generator"* pattern that mines past sessions into recipes
   (`documentation/blog/2025-10-08-recipe-cookbook-generator/index.md`). Read the caveats before citing it as a
   success: that page carries an explicit update — *"the public Recipe Cookbook submission program has ended"* — so
   this is **a vendor tutorial of a wound-down program**, not a supported feature. It is the closest prior art to the
   mechanism our own usage audit ranks first, and it is a *prompt*, which means its output quality is unaudited.
3. **Two clones will never produce `observed`, and that must be said in the row.** `claude-code-docs` and
   `copilot-cli` are docs/issue trees. A future review must not report a CHANGELOG line as observed behaviour; where
   Claude Code behaviour matters (the `/skill-doctor` cost report, the `/run-skill-generator` → `/verify` loop, the
   15-minute compaction window), it is either `advertised-elsewhere` or something we run on a host and label
   `observed` honestly — and Claude Code is not installed on this rig.
4. **The guard-failure asymmetry, now partly `observed` (`codex` only, guard axis).** Of five guard/rule designs the delegate
   could inspect, **four fail open**: Codex's `PreToolUse` yields `should_block:false` on a hook error, malformed JSON,
   exit-2-without-a-reason, or an unsupported `permissionDecision` (`hooks/src/events/pre_tool_use.rs`, `parse_completed` —
   the vendor's own tests are named `unsupported_permission_decision_fails_open` and `deprecated_approve_decision_fails_open`),
   while its **rule loader fails loud** (`core/src/exec_policy.rs:244-271`); Copilot CLI fails open on a 10 s timeout and on
   TCC denial is not the mechanism — the tracker names a **`timeout->allow` fallback** (#2893) and an auto-approved `ask` (#3590);
   Cursor's `failClosed` is **opt-in** (docs); Cline *activates* a rule whose frontmatter failed to parse (*"Cline **fails open**.
   The rule activates with raw content visible"* — docs, quoted verbatim in `inputs/fetched/MANIFEST.md` §2). **pi fails closed** — `emitToolCall` carries no
   try/catch (`src/core/extensions/runner.ts:1248-1266`) and the caller re-throws as `Extension failed, blocking execution`
   (`src/core/agent-session.ts:668-680`). ~~Nobody in the sample is both non-fatal and closed~~ — **corrected by research round 3
   (2026-10-28): that sentence is too simple.** Copilot CLI's command `preToolUse` **fails closed** on crash/non-zero-exit/invalid
   JSON, and the *same* guard flipped direction between releases (reporter's repro at **v1.0.18** let a malformed hook through;
   the maintainer at **v1.0.57**: "those errors now **deny** instead of silently passing", #2540). The axis is per-event and
   per-version, not a vendor property. Codex guards the git plane
   by **reachability** rather than verb-matching (`core-plugins/src/git_policy.rs:7-85`: 18 stripped `GIT_*` variables,
   `-c safe.bareRepository=explicit`, and a throwaway `GIT_DIR` repo for agent-initiated git). Table, citations and what this
   changes for ROADMAP **232**/**238**: `docs/reviews/codex-enforcement-design-2026-10-28.md`.

## What research round 3 changed (2026-10-28) — first `observed` guard evidence for Goose, and the trust invariant we should copy

Deliverable: `docs/reviews/harness-tools-skills-public-harnesses-research-r3.md` (landed byte-for-byte from the transcript).
Verification: `docs/reviews/harness-tools-skills-r3-delegate-notes-2026-10-28.md` + `inputs/fetched/MANIFEST.md` §4 —
**91 of 94 quoted fragments located in the delegate's own fetches**; 15 residual legacy anchors remain unresolvable, and one
citation (`aaif-goose` on the Goose recipe page) does not support its claim.

| goose · `775b3958` | **guard plane — `observed` at the pin, the first we have for Goose** |
|---|---|
| where the rule lives | hooks: plugin-discovered, **project-scoped at `<project>/.agents/plugins/<name>/hooks/hooks.json`**, user-scoped at `~/.agents/plugins/` (`documentation/docs/guides/context-engineering/hooks.md`), following the **Open Plugins hooks specification**; permissions: `crates/goose/src/config/permission.rs:21-24` → `AlwaysAllow / AskBefore / NeverAllow` |
| who can write it | the docs' only control is a warning — "Run trusted hooks only" — i.e. **advice, not a gate** |
| what happens when it breaks | a **model** decides approvals (`permission/permission_judge.rs`, prompt `prompts/permission_judge.md`); in that judge, a tool-call entry it cannot parse is **skipped**, not denied (`:103 None // Skip requests with errors in tool_call`) — so a judge with no opinion is indistinguishable from a judge that errored |
| the real control | per-tool permission levels plus a **model judge**, and the state is **global** (`~/.config/goose/config.yaml`), while hooks are project-scoped — the two planes do not share a trust story |
| correction this forces | the round-2 report's Goose `not found` for hooks is wrong (its site mirror has no hooks page; the repo does), and so is its Q3 "nothing repo-scoped" for plugins/hooks. **Goose is not guard-less.** |

**The one design durian-pi should copy, from Codex, observed at the pin** (`codex-rs/hooks/src/config_rules.rs:8-14`, enforced at
`:24-30`): *"Project, managed, and plugin layers can discover hooks, but they do not get to write user hook state"* — trust is
`HookStateToml { enabled, trusted_hash, trusted_content_hash }` (`config/src/hook_config.rs:30-37`), written only from the
`User`/`SessionFlags` layers and keyed to a **content hash**. **A repository may carry a guard; it may not enable or bless
itself.** pi has the same idea one magnitude coarser — project `.pi/extensions` load only when `isProjectTrusted()`
(`pi@1.4.0 · src/core/package-manager.ts:2465,2484`; untrusted storage throws, `:1783`) — but that is **one boolean for the whole
directory, settable by a CLI flag** (`src/cli/args.ts:242`), with no per-component state and no re-review on edit. Registered as
ROADMAP **245**.

**Also registered from this round:** ROADMAP **246** — a guard that is *listed as active* while not running is the failure mode
the Copilot CLI tracker documents three ways (#2540 plugin hooks never fire; #5098 a sandbox-config change silently stops a
hook; #3590 `ask` rendered as allow), so the guard must emit **a per-decision record a reviewer can read**, not a log line.
ROADMAP **240**'s "how do we know a recipe worked?" question **remains open**: the working summary of round 3 pointed at a Goose
`checks/*.sh` exit-code mechanism, but that text is **not in the landed deliverable**, and neither `goose_scraper.md` nor any
`checks` field in the recipe reader exists at `goose · 775b3958` (checked 2026-10-28: `find vendor/eval/goose -name "*scraper*"` →
nothing; `grep checks vendor/eval/goose/crates/goose/src/recipes/` → nothing). **Do not register a mechanism that cannot be
found.** See the truncation note in `docs/reviews/harness-tools-skills-r3-delegate-notes-2026-10-28.md` §5.
