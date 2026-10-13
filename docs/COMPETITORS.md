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
or a Windows story. It solves research-report generation, not textbook tutoring.

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
