> **D103 rename (2026-10-18):** this record predates the product rebrand `durig` → `durian-pi`; it keeps the old name so the audit trail stays truthful.

# SECURITY POSITION — codemode for durig seats (T0 first cut)

**Status: ratified by the `security` seat, item #1295, 2026-10-17. This file realizes ROADMAP 32's
gate ("a `security.sec` position") as a per-item artifact in `docs/reviews/` — there is no standing
security-doc set (lead ruling #1297). It ratifies **with corrections** the delegate-authored round
`docs/reviews/security-codemode-review.md` (E1–E14), which is the input, not the position.

Ratification provenance: the round was authored by the delegate; this ratification is authored by a
different writer (the security seat), which is the two-eye principle. In-tree claims cited below were
verified by this seat in the item-1295 worktree (rev 7e5d16e); claims about the `quickjs-wasi` library
internals are **cite-by-reference** from `docs/CODEMODE.md` (verified by the delegate there) — this
seat re-verified none of the library source in this worktree. Nothing here prints a secret value.

## Scope

What listens: a `node:worker_threads` sandbox — a **thread in the broker process**, not a process
(cite-by-reference, E2). What crosses the boundary: a per-script **minted capability object `api.*`**
backed by an effect broker (authorize → budget → approve → execute → audit). The spine: executors
delegate to the confined `ExecutionEnv` (SC1, `src/confine.mjs`; verified this seat: env allowlist +
`SECRET_NAME` deny at L110/L122, push gated by the operator grant). Governing fact **D-ENV-AUTH**:
every seat runs as the same Windows user, so all controls below are app-layer and each carries a
falsification probe that can run and fail.

## Ratification of E1–E14 with corrections

Accepted **as written**: E1 (ambient authority), E3 (path escape, enforced twice), E4 (predicates not
handles), E5 (`model.call` unminted first cut), E6 (`proc.exec` never the boundary — F4's
PowerShell-allowlist unsoundness, corroborated in `src/confine.mjs` L17–30), E7 (audit sink
prerequisite — `result.calls` carries no args/output, cite-by-reference), E8 (bounds default-deny),
E10 (output flood cap), E11 (approval cannot be batched), E12 (irreversible effects excluded),
E13 (supply chain pin + install-script review), E14 (declared-vs-granted equality).

Correction C1 (E2): "treat thread isolation as language isolation only" is ratified, **and** the
residual is sharper than stated: a thread escape with the same Windows user reaches the broker
process memory — the store handle, the provider key in env. T0 reduces the motivated-attacker
surface but never proves containment (see Residual risk).

Correction C2 (E7): the sink must record **denied** effects too, not only allowed ones; the demo
probe asserts both (the round's own E7 probe already says so; this makes it a gate, G1).

Correction C3 (provenance): every cite-by-reference above must be re-verified against the vendored
library before `docs/CODEMODE.md` declares gate 1 closed — the fold step (lead/pm) re-runs the
line-level checks listed there.

## Answers to the consult's open questions

### Q1 — is mint + SC1 sufficient authority control?
For **T0 (read-only/compute: `fs.read` + `fs.list` only): yes**, conditional on predicates-not-handles
(E4), no ambient surface (E1), and always-set bounds (E8) — all falsifiable offline. For **T1 (write)
and T2 (exec): no** — a same-process, same-user escape holding a write/exec grant can damage
broker-owned state; **host containment is required before T1 lands**, named and deny-demoed in a new
position. Falsification: the E1/E3/E4 demo probes; plus T0's surface-limit probe (G7).

### Q2 — where does the audit sink live?
**Git-backed append-only**, not the live store. Reasons, independent of D30's precedent: (1) it must
be readable **while the broker is down/broker-stopped** — post-incident forensics cannot depend on the
single-writer harness; (2) the store is durig's operational state and rotating/resetting it must not
destroy the audit trail; (3) a commit-per-audit-boundary reviews like every other durable artifact
durig keeps. Prerequisite, not nicety: **the sink lands before any codemode tier** (G1 / ROADMAP 129).

### Q3 — is `model.call` acceptable?
**Not minted in the first cut** — default NO (it spends the session's credentials; E5's probe:
unminted call yields `EACCES`, no credential value ever readable from the sandbox). If ever minted:
per-call approval + `maxCalls` + `maxUsd` + allowlist, and **only after a new position** — a new
credential exercise is a new trust boundary, and the credential surface is currently **unverified**
(do not assume a control exists there).

### Q4 — is `proc.exec` ever admitted?
Never as the boundary (E6); rejected in T0 and T1. Admission beyond that is T2's business and requires
host containment **plus** a recorded position (G8). The PowerShell-allowlist class failure (F4,
corroborated in-tree) is standing evidence that an `argv[0]` list is narrowing, not confinement.

### Q5 — what host containment, and when?
Form is the implementer's pick — container, VM, or AppContainer — but **without a runnable
deny-demonstration in the demo suite, no containment exists**, and no write/exec tier may land.
Containment is the gate that separates T0 from T1/T2 (Q1). The demo probe can run and fail; a
placement assertion cannot.

### Q6 — does the mid-run bound belong in the security position?
**Yes — a control, not a nicety.** An in-sandbox loop is invisible to D64's per-turn bounds until the
run settles (the round's E9); the turn-stall that reset this seat on 2026-10-17
(`turn-duration-ms=312487>=300000`) is live evidence that opaque long turns already defeat wall-clock
oversight **without** codemode, and codemode would hide a loop inside a single even-longer call.
 ROADMAP 128's bound lands **with** codemode, not after (G2); probe: a looping script is detected
before the run settles, or the residual gap is named in the tier's position.

## Gates (all falsifiable; no codemode code lands until they hold)

### G1 — audit sink first
Append-only sink per Q2 records `{kind, resource, decision, reason, budget, auditId}` for **allowed
and denied** effects; lands before the first codemode tier (ROADMAP 129). Probe: replay a script;
every effect — including each denial — appears with its decision; run offline.

### G2 — mid-run bound
Per Q6 / ROADMAP 128: hard wall-clock/heap cap per sandbox call, detected before the run settles.
Probe: a looping script is killed at the cap and the outcome is visible in the completion surface.

### G3 — bounds fail closed
A sandbox construction with `memoryLimitBytes`/`timeoutMs` unset refuses to start (E8: the library's
unlimited/300 000 ms defaults are inherited only by mistake). Probe: omit both, expect a loud refusal.

### G4 — demo probes, offline
The demo suite carries at minimum E1/E3/E4/E7/E8/E11/E12/E14 probes, no network, no live credential
spend. A gate without a runnable probe is noise; these are the probes.

### G5 — the two-layer denial proof (ROADMAP 32's proof text)
One escape denied by the grant predicate, **another independently by the confined environment**, so
neither layer is load-bearing alone. Probe: the demo asserts both denials for the same script.

### G6 — supply chain
Dependency pinned; no unreviewed install scripts (E13). Probe: the lockfile pins
`pi-codemode`/`quickjs-wasi` and the review note records the install-script check.

### G7 — surface equality: declared = granted = minted
The tool schema is emitted from the same `Policy` that mints the grants; the minted global surface
contains nothing else (E1/E14). Probe: compare programmatically — schema set, granted set, and sandbox
global set must be equal; `tools`/`models` are absent (undefined), not denied-at-execution.

### G8 — deviation needs a new consult
Minting `tools`/`models`, omitting bounds, pushing to T0-only, an unaudited effect, a `proc.exec`
boundary — any deviation requires a **new** `security.sec` position before that code lands.

## Non-goals

- Not a permission system for the whole harness — codemode's broker governs *minted capabilities*
  only; `docs/SEAT-TOOLS.md` retains the ambient-authority analysis.
- Not process isolation (E2) — containment is a separate, demoed requirement.
- Not a substitute for SC1–SC3 — executors delegate to the confined `ExecutionEnv`; SC1 is the spine.
- No network in the first cut, no credential exercise (Q3/Q4) — egress and the credential surface
  remain **nameably unverified** and are untouched by this position.

## Residual risk (stated, not buried)

- **Thread escape** (E2/C1): same-process, same-user; if a quickjs/wasm escape occurs with a motivated
  payload, T0's read-only grants still do not fence a full-language escape reaching broker memory.
  Mitigations in force: T0 carries no write/exec/network authority, bounds (E8) cap blast radius, the
  audit sink (Q2) preserves forensics. Mitigations **not** in force: host containment (unavailable —
  the D30 residual-shell dissent stands).
- **Unverified surfaces named as such:** seat egress path and the credential surface have no verified
  mechanism (see `docs/CODEMODE.md`, `docs/BROKER-SUPERVISION.md`); this position mints neither.
- **Fold step open:** until lead/pm folds this position into `docs/CODEMODE.md` gate 1 (D-entry +
  tier-gate registration), gate 1 remains **open** in ROADMAP 32 even though its required artifact
  now exists.

## Routing

Position adoption and the gate-1 fold: **lead/pm** (D-entry in the broker architecture docs, tier-gate
registration, re-verification per C3). Implementation: **impl** — T0 only, under G1–G8. Deviation:
per G8, a new consult first. This seat reports and proposes; it does not adjudicate scope.

## Citations

- ROADMAP item 32 (gate + two-layer proof) and items 127/128/129 (durable plan nodes, mid-run bound,
  audit sink) — `docs/ROADMAP.md` L932–960, L2360+.
- Input round: `docs/reviews/security-codemode-review.md` (delegate, 2026-10-17) — ratified above.
- Shape precedent: `docs/reviews/security-sec-broker-socket.md`.
- Verified in-tree this session (rev 7e5d16e): `src/confine.mjs` (SC1/SC3, `SECRET_NAME` L110/L122,
  push guard L59–62), `src/config.mjs` (`describeConfig` set/unset), `docs/SEAT-TOOLS.md` SC1–SC3
  (cited in the round; spot-verified via `src/confine.mjs`).
- Cite-by-reference (delegate-verified in `docs/CODEMODE.md`; re-check before fold per C3):
  `worker_threads` same-process host; `memoryLimitBytes` unlimited default; `timeoutMs` 300 000 ms;
  `ALL_TOOLS` exposure; `result.calls` shape; 16 MB/256 KB output/store caps.
- Signal evidence for E9/Q6: turn-stall reset of the security seat on 2026-10-17
  (`turn-duration-ms=312487>=300000`), reported by the operator's clock-out banner.
