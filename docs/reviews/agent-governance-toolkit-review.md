# Competitor review — Microsoft Agent Governance Toolkit (`microsoft/agent-governance-toolkit`)

*Read 2026-10-17 by the delegate. Clone pinned at HEAD `cfb44576824aab84bbceb9e94c667b975f128cd7`
(`vendor/eval/agent-governance-toolkit`, shallow, MIT). Method: `docs/runbooks/competitor-review.md`.
Scope asked for by the operator: what here can improve durig's **security** and the **healing /
self-recovery** of its agents.*

## What it is

AGT is a large (83 MB, ~930 in-tree Markdown files) **application-layer governance, identity, and SRE
toolkit for autonomous agents** — "policy enforcement, identity, sandboxing, and SRE ... one `pip
install`, any framework" (`README.md`). Its thesis is stated up front: prompt-level safety is "a polite
request to a stochastic system", so every tool call, message, and delegation is intercepted in
**deterministic application code before the wire** (`README.md` "The Problem"). Six subsystems, each
with an RFC-2119 spec and 25 ADRs (`docs/ARCHITECTURE.md`):

- **Agent OS** — policy engine, capability model, governance gate, **fail-closed** evaluation.
- **AgentMesh** — Ed25519/DID identity, trust scoring, delegation chains.
- **Agent Runtime / Hypervisor** — four execution rings, resource limits, kill switch, saga/compensation.
- **Agent SRE** — SLOs, error budgets, **circuit breakers**, chaos testing, incident detection, replay.
- **MCP Security Gateway** — tool-call interception, rate limiting.
- **Agent Hypervisor / Audit** — Merkle hash-chain logs, decision BOM.

It is **not** a durable queue, store, worker-supervisor, or multi-agent fleet substrate. It governs
what an agent *does* inside a process; durig owns durability, seats, the ledger, and the landing path.
So nothing here replaces durig — the value is in four reusable mechanisms for security and five for
healing, below.

**Honesty about the tree.** The project is a **public preview** and the specs run ahead of the code in
places: the `HALF_OPEN` circuit state "is wired through the enum ... however, no code path transitions
to HALF_OPEN" (`docs/specs/AGENT-SRE-GOVERNANCE-1.0.md` §6.1); quarantine "has been removed from the
implementation ... does not describe shipped behavior" (`AGENT-HYPERVISOR-EXECUTION-CONTROL-1.0.md`
§13). Claims below cite a **path per claim**, and the implementation paths I actually opened are named
where the spec and code diverge.

## Security — adoptable practices

| Practice | Evidence (path in the clone) | durig counterpart — adopt / adapt / reject |
|---|---|---|
| **Fail closed on every policy-evaluation error** — malformed context, backend timeout, regex-compile failure, any exception → **deny** with `error: true` in the audit; "no configuration flags to switch to fail-open" | `docs/adr/0013-fail-closed-on-policy-evaluation-errors.md`; `docs/ERROR_HANDLING.md` (`GovernanceError`); `docs/specs/AGENT-HYPERVISOR-EXECUTION-CONTROL-1.0.md` §19.1 | **Adopt**: durig's refusals are individual guards (`src/seatguard.mjs`, `src/confine.mjs`); there is no single decision point whose *evaluation failure* is defined to deny. The principle is already the culture (the hard write guard, ROADMAP 69) but not a named invariant. → **ROADMAP 133** |
| **Structured denial** carrying `rule_id`, `action`, `tool_name`, `policy_name`/`version`, `agent_id`, `timestamp` | `docs/ERROR_HANDLING.md` (`PolicyViolationError`); `docs/specs/AGENT-HYPERVISOR-EXECUTION-CONTROL-1.0.md` §19.2 | **Adapt**: a durig refusal is a string (`src/confine.mjs` "Commands a seat may never run"). Naming the rule makes a refusal auditable and teachable. → **ROADMAP 134** |
| **Monotone context ratchet** — an immutable `ContextEnvelope` whose sensitivity is a **max-lattice** (only ever rises) and whose restrictions are a **grow-only** set; a delegated child inherits the parent's restrictions and can add but never drop | `docs/security/context-accumulation-governance.md`; `agent-governance-python/agent-os/src/agent_os/policies/context_envelope.py` (`fold`, `apply_restrictions`) | **Adopt (the ratchet, not the classification)**: durig's degeneration/context guard (#1766–#1769) assesses at pass end and can forget a signal once the window moves; a monotone risk accumulator cannot be silently lowered by a later quiet turn. This also matches D95's "context pressure is a seat-level signal that persists". → **ROADMAP 135** |
| **Threat model per trust boundary** — four named boundaries (human→agent, agent→agent, agent→tool, agent→platform) analysed STRIDE-style | `docs/security/threat-model.md`; `docs/runbooks/security-trust-boundary-review.md` (durig) | **Adopt**: durig's security runbook is a *method* but has no fixed boundary taxonomy to walk. Add the four-boundary × STRIDE table as the runbook's checklist. → **ROADMAP 136** |
| **Approval gates on sensitive actions** — `require_approval` with named `approvers` | `README.md` policy example; `docs/tutorials/38-approval-workflows.md` | **Adapt**: durig's operator-grant is exactly this but is prose/`intent`, not a pending-approval state on the action. A `requires_approval` step status exists in their incident runbooks (§Healing). Fold into **ROADMAP 138**. |
| **Tamper-evident audit** — Merkle/hash chain over governance events; decision BOM (what policy was active, request, decision) | `docs/adr/0017-merkle-chain-for-audit-tamper-evidence.md`; `docs/tutorials/50-decision-bom.md`; `agent-governance-python/agent-sre/.../anomaly/rogue_detector.py` (`compute_hash` chains each assessment) | **Reject as mechanism, keep as principle**: a Merkle chain over a full event log is enterprise weight; durig's durable store + `src/provenance.mjs` already give attribution. The transferable part (a decision names the rule that produced it) is **ROADMAP 134**. |
| **Capability least-privilege / deny-by-default** (`mode: strict`, explicit allow rules) | `docs/operations/advisory-to-blocking-graduation.md`; `docs/specs/AGENT-OS-POLICY-ENGINE-1.0.md` | **Adapt**: already durig's direction (ROADMAP 60 "zero trust to zero agent", restrictive-by-default `edges`). This review reinforces it with a concrete **policy-document shape** rather than adding a mechanism. No new item; ties to 60. |
| **Commit-time secret scanning** (`.gitleaks.toml`, `.pre-commit-hooks.yaml`) | `.gitleaks.toml`, `.pre-commit-hooks.yaml`; `docs/security/scanning.md` | **Keep**: durig already delivered the commit-time secret gate (#1317, `src/seatguard.mjs` + `demo/commit-secrets.test.mjs`). No action; noted so the next reviewer does not re-propose it. |

## Healing / self-recovery — adoptable practices

| Practice | Evidence (path in the clone) | durig counterpart — adopt / adapt / reject |
|---|---|---|
| **Circuit breaker per agent** — `CLOSED`/`OPEN`, trip after N consecutive failures, `is_available` only true when CLOSED, **manual** `force_close`/`reset` in the preview; registry of open breakers | `docs/specs/AGENT-SRE-GOVERNANCE-1.0.md` §6; `agent-governance-python/agent-sre/src/agent_sre/cascade/circuit_breaker.py`, `.../incidents/circuit_breaker.py` | **Adopt**: durig's `src/supervisor.mjs` *escalates* after `REPEATED_FAILURE_STREAK` but never *isolates* the seat, so a broken seat keeps being woken. A breaker that **refuses a wake while OPEN** and closes only on an explicit `reset` is the missing actuator, and it pairs with the #1766 halt/RESOLVE core (halt, then require a cause-specific resolution). → **ROADMAP 137** |
| **Structured incident lifecycle** — `DETECTED→ACKNOWLEDGED→INVESTIGATING→MITIGATING→RESOLVED`, forward-only; typed `Signal` with a severity hint; **dedup window** (600 s) and **correlation window** (300 s) | `docs/specs/AGENT-SRE-GOVERNANCE-1.0.md` §14; `agent-governance-python/agent-sre/src/agent_sre/incidents/detector.py` | **Adopt**: durig created the `docs/incidents/` class on 2026-10-17 but detection is manual and `attention` notices have **no dedup or correlation**, so a repeat condition re-surfaces as a fresh notice. The signal→severity→dedup machinery is exactly what the class needs to become durable rather than narrative. → **ROADMAP 139** |
| **Executable incident runbooks** — YAML steps with `timeout_seconds`, `requires_approval`, **`rollback_action`**, and machine `trigger_conditions` on signal types | `agent-governance-python/agent-sre/src/agent_sre/incidents/runbooks/*.yaml`; `.../incidents/runbook.py`, `runbook_executor.py` | **Adapt, do not duplicate**: durig's `docs/runbooks/` are prose and ROADMAP 81–88 (esp. **87** the agent-executable runtime) already cover a gated executor. What this adds is **per-step rollback** and **approval gates** as first-class step fields. → **ROADMAP 140**, cross-linked to 87 — not a competing item. |
| **Chaos engineering for agents** — infra faults (latency/error/timeout) **and behavioural faults** (`DEADLOCK_INJECTION`, `CONTRADICTORY_INSTRUCTION`, `TRUST_PERTURBATION`), abort conditions, blast radius, a resilience score | `docs/specs/AGENT-SRE-GOVERNANCE-1.0.md` §7 | **Adapt**: durig's dogfood F-class findings and ROADMAP 67 (host chaos suite) cover process crash/hang/wedge; the library adds **agent-behaviour** faults (inject a degeneration, inject a contradictory directive) and a pass/fail **resilience score** rather than a bare exit code. → **ROADMAP 141** |
| **Rogue-agent detection** — tool-call **frequency z-score** over a sliding window + **action entropy** (flags *both* suspiciously repetitive and chaotic behaviour) + capability-profile violations | `docs/tutorials/05-agent-reliability.md`; `agent-governance-python/agent-sre/src/agent_sre/anomaly/rogue_detector.py` (`RogueDetectorConfig`: `entropy_low_threshold`, `entropy_high_threshold`, `frequency_z_threshold`) | **Adopt**: durig's `src/degeneration.mjs` counts repeats/tool-turns/malformed calls — good at the *repetitive* pole, blind to the *chaotic* pole (many distinct damaging calls). Entropy + a z-score are cheap, pure additions over data `attention.mjs` already derives. → **ROADMAP 142** |
| **Agent lifecycle** — heartbeat, **orphan detection** (silent past a threshold), short-lived credential rotation, decommission | `docs/tutorials/30-agent-lifecycle.md`; `agent-governance-python/agent-mesh/src/agentmesh/lifecycle/orphan_detector.py` | **Adapt**: durig has `docs/SEAT-LIFECYCLE.md` and a broker heartbeat, but no orphan report (a seat that is silent and owns nothing) and no credential-rotation path for the DeepInfra key. → **ROADMAP 143** |
| **Circuit breaker for event-sink delivery** — fail fast for a known-bad external sink (5 failures → OPEN, 60 s cooldown → probe) so a stalled sink cannot back up the producer | `docs/adr/0020-circuit-breaker-for-event-sink-delivery.md`; `agent-governance-python/agent-os/src/agent_os/event_sink.py` | **Adopt (consider)**: this is the shape the crash-proofing cluster wants for the broker's store-write path and any external sink (ROADMAP 78). Fold into **ROADMAP 137** as the delivery-facing half, not a separate item. |
| **Advisory→blocking graduation checklist with a rollback plan** — ≥2 weeks advisory with no false positives before enforcement; monitor deny rates for 48 h; documented path back to advisory | `docs/operations/advisory-to-blocking-graduation.md` | **Adopt**: this is the missing *process* for durig's "zero false positives before enabling" rule on the degeneration guard (#1766). It turns the rule into a dated gate with a rollback. → **ROADMAP 144** |

## Where it does not fit

- **Identity / mesh / execution rings / trust scoring.** Ed25519 DIDs, SPIFFE, delegation chains with a
  trust ceiling, four privilege rings, and a 0–1000 trust score (`docs/specs/AGENTMESH-IDENTITY-TRUST-1.0.md`,
  `AGENT-HYPERVISOR-EXECUTION-CONTROL-1.0.md`) solve inter-organisational zero-trust between mutually
  distrustful principals. durig is a single-operator local rig where the OS user is the boundary and the
  seat's reach is already set by `edges`/capabilities; importing PKI would add weight and a second source
  of truth for identity. **Reject as mechanism**; the least-privilege *principle* is already ROADMAP 60.
- **The full multi-language SDK / framework-adapter surface** (`agent-governance-{python,dotnet,golang,rust,typescript}`,
  LangChain/CrewAI/AutoGen adapters). We read it; we do not adopt it. durig has one runtime.
- **Compliance mappings** (SOC2, EU AI Act, NIST AI RMF, OWASP ASI) — out of scope for a selfdev rig.
- **Their benchmark claim.** The touted `<0.1 ms` is the **policy engine only**; `docs/LIMITATIONS.md` §3
  itself warns a mesh deployment adds 5–50 ms per governed interaction. Do not quote the fast number as
  end-to-end.
- **Spec-ahead-of-code.** Quarantine is a removed stub and `HALF_OPEN` is not entered
  (`AGENT-HYPERVISOR-EXECUTION-CONTROL-1.0.md` §13, `AGENT-SRE-GOVERNANCE-1.0.md` §6.1). Anything adopted
  must be validated against the code, not the spec.
- **It is not a substrate.** No durable queue, no crash recovery, no single-writer store, no seats, no
  landing/merge model. Every durig-internal durability and healing mechanism remains ours.

## Where each claim lives (in the clone)

- Architecture and model: `README.md`, `docs/ARCHITECTURE.md`, `docs/LIMITATIONS.md`, `docs/ERROR_HANDLING.md`.
- Security: `docs/adr/0013-fail-closed-on-policy-evaluation-errors.md`, `docs/adr/0017-...`,
  `docs/security/threat-model.md`, `docs/security/context-accumulation-governance.md`,
  `docs/operations/advisory-to-blocking-graduation.md`.
- Healing: `docs/specs/AGENT-SRE-GOVERNANCE-1.0.md`, `docs/specs/AGENT-HYPERVISOR-EXECUTION-CONTROL-1.0.md`,
  `docs/adr/0020-circuit-breaker-for-event-sink-delivery.md`, `docs/tutorials/{05,30}.md`,
  `docs/compliance/incident-response-workflow.md`.
- Implementation: `agent-governance-python/agent-os/src/agent_os/policies/context_envelope.py`,
  `.../policies/context_accumulation.py`, `.../src/agent_os/event_sink.py`,
  `.../agent-sre/src/agent_sre/anomaly/rogue_detector.py`,
  `.../agent-sre/src/agent_sre/incidents/{detector,runbook,runbook_executor}.py`,
  `.../agent-sre/src/agent_sre/incidents/runbooks/*.yaml`,
  `.../agent-mesh/src/agentmesh/lifecycle/orphan_detector.py`.

## Verdict

AGT is the best available reference for **action-layer governance and agent SRE** — a deterministic,
fail-closed enforcement posture plus a mature vocabulary for detecting, isolating, and recovering a
misbehaving agent. Adopt its **fail-closed invariant**, **structured denial**, **monotone risk ratchet**,
**per-seat circuit breaker**, **structured incident lifecycle with dedup/correlation**, and its
**chaos/rogue-detection signal design**; adapt its executable-runbook rollback/approval fields into the
existing ROADMAP 81–88 machinery; adopt its **OWASP Agentic Top 10 self-assessment** and policy-as-code
lint rules (see the Addendum); reject its identity/mesh/ring stack and the enterprise certification
mappings. Its accepted ideas are registered as ROADMAP 133–150.

## Addendum (2026-10-17, delegate) — OWASP ASI Top 10 and the broader policy surface

**Correction.** The first pass above rejected "compliance mappings" *en bloc* and never opened them. That
was too coarse. AGT maps to **three** OWASP standards, and one of them — the **OWASP Top 10 for Agentic
Applications 2026 (ASI01–ASI10)** — is a directly applicable external checklist for durig's own agents
(`docs/compliance/owasp-agentic-top10-architecture.md`, `docs/security/owasp-compliance.md`). The
enterprise *certification* mappings (SOC2, EU AI Act, NIST AI RMF, ISO 42001) remain out of scope, but
the ASI Top 10 and its **policy packs** are adopted below. AGT itself labels these "internal
self-assessment mapping[s], NOT a validated certification or third-party audit"
(`docs/compliance/owasp-agentic-top10-architecture.md` intro) — durig's own mapping must carry the same
label.

### The OWASP ASI Top 10 as durig's agent-security checklist

AGT rates itself **7/10 Full, 3/10 Partial** against ASI01–ASI10 and names a concrete control + evidence
path for each (`docs/compliance/owasp-agentic-top10-architecture.md`). The value for durig is the
taxonomy, not AGT's score: it names the failure classes a multi-agent rig actually has. Mapping durig's
existing controls onto it exposes real gaps:

| ASI risk | durig control today | Gap this exposes |
|---|---|---|
| **ASI01 Goal Hijack** | constitution + `edges`/capabilities; codemode gate | prompt/tool-input injection is not screened; confinement limits blast radius but does not detect goal override |
| **ASI02 Tool Misuse** | `src/confine.mjs` (path/command block), `src/seatguard.mjs` | no per-action allowlist with deny-all default; refusals are narrow guards, not one catalog |
| **ASI03 Identity / Privilege Abuse** | seat name + store; `edges`; seat-tool allowlist (`docs/SEAT-TOOLS.md`) | no least-privilege *per item*; no credential-use audit |
| **ASI04 Agentic Supply Chain** | vendored `vendor/pi-main`, `vendor/eval/*`, `vendor/pi-warden`; `scripts/sync-pi.mjs` pins | **no SBOM / dependency scan of vendored code** — a genuine gap |
| **ASI05 Unexpected Code Execution** | `src/confine.mjs` command block; codemode gate (ROADMAP 32) | static lint over seat-authored code is absent |
| **ASI06 Memory / Context Poisoning** | durable transcript; `src/degeneration.mjs`; D95 context bound | no `MemoryGuard`-style integrity check on the transcript/context read path; poisoning vs saturation are conflated |
| **ASI07 Insecure Inter-Agent Comm.** | single-writer store; `edges` routing (no network mesh) | low exposure by construction; trust is the store, not a wire |
| **ASI08 Cascading Failures** | `src/supervisor.mjs` escalation; broker single-writer | no circuit breaker (ROADMAP 137); no session tool-call/budget cap |
| **ASI09 Human-Agent Trust** | operator grants via `intent`; landing gate | approvals are not bound to an action digest, not expiry-checked (ROADMAP 138/149) |
| **ASI10 Rogue Agents** | `src/degeneration.mjs`, supervisor, `reset` (ROADMAP 137) | detectors are post-hoc and blind to the chaotic (high-entropy) pole (ROADMAP 142) |

**Adopt**: run this mapping as a dated `security`-seat self-assessment and re-run it on trigger (a new
execution surface, a landing-path change), exactly as the runbook maintenance policy already does →
**ROADMAP 145**.

### Policy packs worth mining for concrete rules

- **Deny-all-by-default posture with explicit numeric budgets** — every pack sets `default_action: deny`
  plus `max_tokens`, `max_tool_calls`, and a `confidence` floor per profile
  (`docs/compliance/owasp-asi-policy-mapping.md` "Default Posture by Pack"). durig's seats have no
  per-item tool/token budget; only the degeneration guard's high-water marks. → **ROADMAP 147**.
- **Per-risk named rules** — e.g. `asi08-session-tool-call-limit`, `asi06-context-budget-limit`,
  `asi10-charter-autonomous-loop`, `asi03-block-credentials-in-output`, `asi06-block-pii-ssn`
  (same table). These are concrete, testable control names to adopt against durig's own surfaces.
- **Policy-as-code static review** — AGT ships 14 lint rules over agent code, each mapped to ASI risks:
  `unguarded-tool-execution`, `no-tool-allowlist`, `missing-audit-logging`, `missing-pii-redaction`,
  `missing-trust-verification`, `no-prompt-injection-guards`, `stub-security-implementation`,
  `hardcoded-security-denylist`, `unsafe-deserialization`, `unbounded-collection`,
  `missing-circuit-breaker`, `ssrf-vulnerable-url`, `no-behavior-monitoring`,
  `missing-governance-middleware` (`agent-governance-python/agentmesh-integrations/copilot-governance/src/reviewer.ts`).
  **Adopt**: durig's `check` (`src/checkup.mjs`) is the natural home for a security-lint rule set over
  seat-authored code, with each finding labelled by ASI risk → **ROADMAP 146**.
- **Severity→exit behavior** — critical/high block merge; medium/low warn
  (`docs/security/scanning.md`). A useful shape for a `check` security rule.
- **Reversibility assessment** — classify an action `FULLY_REVERSIBLE`/`PARTIALLY`/`IRREVERSIBLE`/
  `UNKNOWN`, and require extra approval + a compensation plan for irreversible actions
  (`agent-governance-python/agent-os/src/agent_os/reversibility.py`; `ReversibilityLevel`,
  `_REVERSIBILITY_MAP`). durig's irreversible operations (branch deletion, force-landing, a broker
  stop) would benefit → **ROADMAP 149**.
- **Action-bound, fail-closed approval** — an approval must name the exact action digest, bind the
  policy version, expire, and reject replay (`docs/adr/0030-action-bound-approval-protocol.md`). The
  concrete hardening for ROADMAP 138.

### OWASP LLM Top 10 — read, mostly not adopted

AGT's own LLM mapping is **0 fully mitigated / 9 partial / 1 gap** and candidly names its widest gaps as
**output sanitization and sensitive-data protection** (`docs/compliance/owasp-llm-top10-mapping.md`
Executive Summary). That is the same finding as its agentic mapping, from a different angle: adopt the
*output-screening* control (credentials + PII) → **ROADMAP 148**, and read the LLM mapping as a
cross-check, not a separate backlog.

### What other policies to adopt (and what to leave)

**Adopt** (registered 145–150):

- **OWASP ASI Top 10 self-assessment** → 145.
- **Security-lint as `check` rules, mapped to ASI** → 146.
- **Per-item deny-by-default budget** (max tool calls, max tokens, confidence floor) → 147.
- **Output screening** for credentials **and PII** (durig redacts *tool results* only —
  `src/secretredact.mjs` is wired as the `afterTool` hook in `src/seatguard.mjs:20`, so assistant output
  is not screened) → 148.
- **Reversibility-aware approval** for irreversible operations → 149.
- **Supply-chain hygiene for vendored code** (SBOM / dependency scan of `vendor/pi-main`,
  `vendor/eval/*`, `vendor/pi-warden`; pin + provenance already exist via `scripts/sync-pi.mjs`) → 150.

**Leave** (wrong scale or already have a local equivalent): Ed25519/DID mesh, 0–1000 trust scoring and
`docs/security/trust-score-calibration.md`; multi-tenant / Kubernetes isolation
(`docs/security/tenant-isolation.md`); SOC2 / EU AI Act / NIST / ISO certification mappings;
vulnerability-disclosure process and post-market monitoring (a private single-operator rig); SBOM
*signing* infrastructure (mitigated here by pinning + `scripts/sync-pi.mjs --update --link`). The
**MemoryGuard** idea for ASI06 is noted but not registered — durig's transcript integrity is better
solved by the store's own write path, and adding a second integrity layer before that is measured would
be premature.

## Surface inventory (runbook step 4, added 2026-10-17 when the runbook was tightened)

The `competitor-review.md` runbook now requires this table and a "not read" list. Recorded after the
fact for this review, and it is the post-mortem of the miss: the first pass skipped several index
surfaces, and that is how the OWASP ASI material was missed.

| Doc area | Opened? | What it yielded |
|---|---|---|
| `README.md`, `docs/ARCHITECTURE.md`, `docs/index.md` | yes | what it is; subsystem map; the enforcement thesis |
| `docs/LIMITATIONS.md`, `docs/ERROR_HANDLING.md` | yes | honest gaps (spec ahead of code); structured errors → 134 |
| `docs/adr/` (index + `0013`,`0016`,`0017`,`0020`,`0030`) | partly | fail-closed (133), circuit breaker (137), approval protocol (149), Merkle (rejected) |
| `docs/specs/AGENT-SRE-GOVERNANCE-1.0.md`, `...HYPERVISOR...` | yes | circuit breaker, chaos, incidents, kill switch, failure semantics |
| `docs/security/{index,threat-model,context-accumulation-governance,owasp-compliance}` | yes | boundary taxonomy (136), ratchet (135), **OWASP pointer** |
| `docs/compliance/` index + `owasp-agentic-top10-architecture.md`, `owasp-asi-policy-mapping.md`, `owasp-llm-top10-mapping.md`, `incident-response-workflow.md` | **first pass: no; addendum: yes** | **the miss** — ASI Top 10, policy packs, budgets, output-screening gap (145–150) |
| `docs/operations/advisory-to-blocking-graduation.md` | yes | graduation gate (144) |
| `docs/tutorials/{05,30}` | yes | rogue detector, lifecycle/orphan |
| `examples/policy-templates/general-saas.yaml` | yes | deny-all default + numeric budgets |
| `agent-governance-python/.../{context_envelope,rogue_detector,event_sink,reversibility,incidents/*,lifecycle/orphan_detector}.py`, `.../copilot-governance/src/reviewer.ts` | yes | implementations + the 14 lint rules (146) |

**Not read (and why).** `docs/compliance/{soc2,eu-ai-act,nist-ai-rmf,iso-42001,cis-controls,nsa-mcp,mcp-owasp-top10,atf-conformance}-*`
(enterprise certification mappings — out of scope for a local rig); `docs/FAQ.md`, `docs/COMPARISON.md`
(vendor positioning); `docs/BENCHMARKS.md`, `benchmarks/`, `tests/` (we do not run the project's code —
read-only review); most of the ~55 `docs/tutorials/` and all of `docs/deployment/`,
`docs/integrations/` (cloud/framework-specific); `agent-governance-{dotnet,rust,golang}/` source beyond
the directory layout. These are named so a later reviewer can reopen them; none is **known** to change
the verdict, but only the compliance row above was an observed error.
