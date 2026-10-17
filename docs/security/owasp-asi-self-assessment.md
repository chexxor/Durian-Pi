# OWASP ASI Top 10 self-assessment for durig (ROADMAP 145)

- **Date:** 2026-10-17 · **Owner:** seat `security` · **Item:** #1800 (gates 146–150) · **Revision 1**
- **Standard:** OWASP Top 10 for Agentic Applications 2026, risks ASI01–ASI10. Taxonomy names and the
  table shape are read from the Microsoft Agent Governance Toolkit reference mapping
  (`vendor/eval/agent-governance-toolkit`, shallow clone HEAD `cfb44576`,
  `docs/compliance/owasp-agentic-top10-architecture.md`).
- **Disclaimer (carried per ROADMAP 145, adapted from AGT's own intro):** This document is durig's
  internal **self-assessment mapping, NOT a validated certification or third-party audit**. No external
  auditor has reviewed it. durig inherits the same caveat AGT carries.
- **Scope:** DOCS ONLY. No code changed, no guard file touched.
- **Trigger model (re-run policy):** re-run this mapping on (a) a **new execution surface** (codemode
  tier, control socket, host daemon), (b) a **landing-path change**, or (c) a **store-adjacent change**
  (single-writer broker, spooled inbox). Same trigger policy as `docs/runbooks/competitor-review.md`.

## Coverage summary

Ratings lexicon (each falsifiable by the named check): **Full** = a mechanism exists and is enforced at
the boundary the risk names. **Partial** = a mechanism exists with a named hole. **Gap** = no mechanism.
**N/A** = the risk needs a surface durig does not have.

| Risk | durig control today | Evidence | Rating | Named gap | Gated backlog |
|---|---|---|---|---|---|
| ASI01 Agent Goal Hijack — adversarial input overrides the agent's goal | Constitution + operating protocol injected every request; untrusted tool results redacted before reuse (`afterTool`) | `src/secretredact.mjs`, `src/seatguard.mjs:20` | **Partial** | Queue bodies and vendor/reference docs enter context unlabelled as untrusted; no input annotator, so a needle in untrusted content competes with the constitution on equal terms | #1801 (lint), #1803 |
| ASI02 Tool Misuse — tools invoked in unintended ways | Per-seat tool rosters; SC1–SC3 confinement (path/command block) on the shell and file tools; refusals observable | `src/confine.mjs`, `docs/SEAT-TOOLS.md` | **Partial** | No single tool catalog with a deny-all default allowlist; guards are per-surface, not one reviewed control (verified live: `read` refused a vendor path, shell reached it — two tools, two rules) | #1801 |
| ASI03 Identity / Privilege Abuse — privileges beyond the seat's role | Broker-issued seat identity on every item (`from` is set by the broker, not the seat); delegation scoped by advertised capabilities and `requires`; env allowlist on spawned shells | `src/broker.mjs` (store), `src/seatguard.mjs`, D-ENV-AUTH | **Partial** | All seats run as one Windows OS user — OS identity is a norm, not a control; the **egress path and credential surface are UNVERIFIED** (`docs/CODEMODE.md`, `docs/BROKER-SUPERVISION.md`); no credential-use audit | #1803 (output screening) |
| ASI04 Agentic Supply Chain | Third-party code is vendored, **pinned**, and fetched through a provenance script; provenance note exists for pi-warden | `scripts/sync-pi.mjs`, `docs/PROVENANCE-pi-warden.md`, `package.json` pin | **Partial** | No dependency/vulnerability inventory over the vendored trees (`vendor/pi-main`, `vendor/eval/*`, `vendor/pi-warden`); an un-inventoried tree would be invisible | #1805 |
| ASI05 Unexpected Code Execution | No seat-authorable code-execution surface is live; codemode T2 (`proc.exec`) is gated on a ratified security position + host containment; shell access is path-confined | `src/confine.mjs`; `docs/CODEMODE.md`; ROADMAP 32 / items #1268–#1270 | **Partial** | No static lint over seat-authored code; no sandbox design ratified for a future T2 — the position must precede the surface | #1801, codemode T0–T2 |
| ASI06 Memory / Context Poisoning — stored content corrupts future decisions | Durable transcripts in a single-writer store; degeneration detector high-water marks; D95 context window bound; reset is a run boundary | `src/degeneration.mjs`; `docs/incidents/2026-10-17-qa-context-degeneration.md` | **Partial** | No integrity/injection screening on the context **write** path (Masking/constitution-pinning/compaction caps are ROADMAP 92–96, still held); saturation (session growth) and poisoning (hostile content) are resolved by the same code today | #1803 |
| ASI07 Insecure Inter-Agent Communication | Seats never open a channel to each other: all routing is through the single-writer broker store, which stamps the sender and resolves `edges`; no inter-agent wire exists | `src/broker.mjs`; ROADMAP (`edges`) | **Full** | Residual falsifier, not a hole: if a second store driver or a network mesh ever lands, this rolls back to Partial and the ASI07 row must be re-run | — |
| ASI08 Cascading Agent Failures | Single-writer broker prevents concurrent-writer cascade; supervisor escalates repeated failures; per-seat wall-clock turn bound (proven live 2026-10-17 by the security seat's own reset) | `src/supervisor.mjs`; broker guard (#1589 lineage) | **Partial** | No per-seat circuit breaker or per-item budget: one stubborn seat can burn compute until a **wall-clock**, not a **budget**, catches it — the trigger that caught the security seat itself is time, not cost | #1802, #1781 |
| ASI09 Human-Agent Trust Exploitation | Operator-only grants (`intent`, push capability); irreversible-ish verbs route to a human via item parking; landing requires a declared quiet window | `docs/SELFDEV.md`; broker/`landing` gates | **Partial** | Approvals are not **action-bound**: no digest, no expiry, no replay rejection — an operator "yes" once defensible cannot be re-tied to the exact action it approved (ROADMAP 138/149) | #1804 |
| ASI10 Rogue Agents — an agent deviates from intended behaviour | Degeneration detector + reset lineage; supervisor notices repeated failure; wall-clock bound halts a wedged turn | `src/degeneration.mjs`; ROADMAP 42 | **Partial** | Detectors run after the fact and are blind to the high-entropy pole (ROADMAP 142); no quarantine concept — halt is cooperative, and the in-broker halt actuator ([B] of #1766) is still queued | #1767–#1769, #1781 |
| *(durig extension, not an official ASI11 — mirrors AGT's traceability note)* Agent action traceability | Every item is a store row with an id; every completion must carry re-checkable evidence; every commit names its item id(s) | broker store; ROADMAP 48 | **Partial** | No tamper-evident chain — store and `git` histories are durable but not hash-linked records | — |

**Official ASI coverage at this date: 1/10 Full, 9/10 Partial, 0 Gap.**
For comparison, AGT claims 7/10 Full; durig's agent fleet is younger and wider-purposed, and the honest
number is lower. The single Full (ASI07) holds only because durig **refuses the surface** the risk
names — that is a legitimate "covered by absence" but it is fragile in exactly the way the falsifier
column says.

## The four risks ROADMAP already flags (detail)

These four carry the largest residual risk and motivated the 146–150 registrations.

### ASI04 — supply chain
Pinning + provenance is real but scans nothing: no SBOM, no vulnerability lookup, no inventory report,
so a compromised pinned artifact goes unnoticed inside our pins. Falsification probe: run today's
`check`/scripts and observe that no scan output names the vendored trees — that absence is the gap
#1805 must close.

### ASI06 — memory/context poisoning vs saturation
The one live mechanism (`degeneration.mjs`) treats session growth and hostile content with one knob.
The committed incident report shows the saturation pole is real (qa context degeneration, item
#1703–#1705). Falsification probe: nothing in the write path rejects or digest-checks a poisoned
entry before it sits in a transcript's context window (ROADMAP 92–96 held).

### ASI08 — cascading failures / no breaker-budget
There is no per-item `max_tool_calls`/`max_tokens` so a wedged item is bounded by **time** (the same
wall-clock bound that reset this seat on the day this document was written) and by human attention,
not by cost. Falsification probe: exceed the guard's high-water marks on a live item — nothing halts
the run with the budget named as the cause; #1802/#1781 must make that fail.

### ASI09 — approvals not action-bound
durig gates landings, grants and dangerous verbs through the operator, but an approval is not bound to
the action's digest and never expires — approval is by conversation, not by protocol. Falsification
probe: ask `check`/the broker whether an approval record ties a digest; today none does; #1804 (with
ROADMAP 138/149) must make it exist.

## How this gates 146–150 (proposed sequencing — pm owns the call)

| Order | Item | Risk row it closes | Rationale |
|---|---|---|---|
| 1 | #1802 (147) per-item deny-by-default budget | ASI08 | The only run-control gap with an observed live trigger; extends the #1766 halt core |
| 2 | #1803 (148) output screening for credentials + PII | ASI01/ASI03 | Closes the credential-egress hole in assistant output; smallest diff of the five |
| 3 | #1804 (149) reversibility-aware approval | ASI09 | Must precede any expansion of irreversible verbs; extends ROADMAP 138 |
| 4 | #1801 (146) security-lint `check` rules | ASI02/ASI05 | Enforcement machinery over the other items' patterns; needs `checkup.mjs` serialization first |
| 5 | #1805 (150) vendored-tree inventory + scan | ASI04 | No observed exploit path today (trees are pinned and read-only); bounded last |

Non-goals (unchanged from ROADMAP, out of scope with the AGT addendum): Ed25519/DID identity mesh,
trust scoring, multi-tenant/K8s isolation, enterprise certification mappings (SOC2/ISO/EU-AI-Act),
SBOM **signing** and disclosure processes. AGT's physical-agents profile is not applicable — durig's
agents act on a repository, not the physical world.

## Surface inventory and "not read" list (per `docs/runbooks/competitor-review.md`)

**Opened:** AGT `docs/compliance/owasp-agentic-top10-architecture.md` (full read);
durig `docs/reviews/agent-governance-toolkit-review.md` and its ASI table; `docs/COMPETITOR*.md` AGT
entry; `docs/ROADMAP.md` 133–150; `docs/runbooks/competitor-review.md`; `docs/security/*` did not
exist before this document. **Directory-listed only:** the remaining 18 files in AGT's compliance
directory (NIST/CIS/ISO/SOC2/EU-AI-Act/MCP mappings — out of scope per the non-goals above).

**Not read, named:** AGT's Python/TS source cited second-hand from the reference doc's own Evidence
lines (`memory_guard.py`, `reversibility.py`, `reviewer.ts`, etc. — unopened); AGT
`owasp-asi-policy-mapping.md` and `owasp-llm-top10-mapping.md` (rules `asi08-session-tool-call-limit`,
`asi03-block-credentials-in-output`…) — **must be opened before #1801/#1802 start**, not relied on from
this document. durig's own `src/confine.mjs`/`src/seatguard.mjs`/`src/degeneration.mjs` are cited from
the committed review table and ROADMAP; a deep re-read is due at the first 146–150 implementation.

## Re-check (how a verifier re-runs this)

1. Pin check: `git -C vendor/eval/agent-governance-toolkit rev-parse HEAD` prints a hash that
   starts `cfb44576`; if the clone moved, re-run the tile rows against the new HEAD.
2. The list of opened/not-read above must still be true; adding a vendored tree is a trigger.
3. Coverage counters: `check` today produces **no** ASI-labelled findings (per rule-MAP item 146
   not started) and this session's wall-clock bound is recorded against ASI08. Re-run on trigger.
