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
- **Read at:** clone `../vendor/eval/aider`, HEAD `5dc9490` (shallow, 2026-10-17)
- **What it is:** a terminal pair-programming agent (single repo, single agent). Not a multi-agent
  substrate — read it for its **edit-and-verify mechanics**: per-model edit formats, a ranked repository
  map, and a lint/test loop that repairs its own edits. Docs: `aider/website/docs/`; edit-format code:
  `aider/coders/`.
- **Review:** `docs/reviews/aider-review.md`.

| What it does | Why it is worth learning from | durig counterpart |
|---|---|---|
| **Per-model edit format** (`--edit-format`: whole/diff/diff-fenced/udiff) with defaults per model (`aider/website/docs/more/edit-formats.md`, `troubleshooting/edit-errors.md`) | One format does not fit every model; format is a first-class config knob | one exact-match `edit` tool for all seats — measure per model (ROADMAP 102) |
| **High-level diffs** — coherent code blocks, not surgical line edits; 30–50% fewer errors without it (`aider/website/docs/unified-diffs.md`) | The model edits better when the unit is a whole function | seat edit guidance |
| **Bounded flexible patching** — normalize a failed hunk to a real diff, split into sub-hunks, vary context (`unified-diffs.md`, `aider/coders/editblock_coder.py`) | 9× fewer apply failures with flexibility | `edit` is exact-match; take the strategies, **reject the `SequenceMatcher` similarity fallback** (silent wrong-region) |
| **Lint/test after every edit, auto-repair** (`--lint-cmd`/`--test-cmd`/`--auto-test`, `aider/website/docs/usage/lint-test.md`) | Catch a broken edit before it compounds | `node --check` + demo gate before accept (ROADMAP 106) |
| **Repository map** — graph-ranked, token-budgeted (~1k) symbol map sent every request (`aider/website/docs/repomap.md`) | Gives the model repo-wide context cheaply | seats `read`/search; a repo-map section for seat prompts (ROADMAP 113) |
| **Prompt-cache ordering + keepalive** (`aider/website/docs/usage/caching.md`) | Cache the stable prefix; ping to keep it warm | constitution-first byte-stable prefix; consider a keepalive (ROADMAP 114) |
| **Architect/editor split** (`aider/website/docs/usage/modes.md`, `config/editor.md`) | Planner and applier are different skills | gated on measured apply failure |
| **Keep context <~25k; drop irrelevant files** (`troubleshooting/edit-errors.md`) | Too much context makes models disobey the edit format | thin-context contract |

**Not to borrow:** whole-file edit as a default (returns the entire file), auto-commit-per-edit (conflicts
with one-commit-per-concern + explicit paths), and the raw fuzzy **similarity** fallback.

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

**Staleness alarm this sweep caught.** `metagpt`'s pinned commit date is **2026-01-21** while the other six are
2026-10-27/28 — the vendor-day invariant holds the clones, not the upstream, so a project that stopped committing
silently goes stale in the set. `--check` cannot see it (the table matches the clone); the pin table's *date column*
is what surfaces it. Re-clone before acting on that row.
