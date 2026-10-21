> **D103 rename (2026-10-18):** this record predates the product rebrand `durig` → `durian-pi`; it keeps the old name so the audit trail stays truthful.

# Security round — codemode for durig seats

**Status: delegate security round, 2026-10-17. This is the input to the `security.sec` position that
ROADMAP 32 / `docs/CODEMODE.md` gate 1 requires — it is not itself that position.** `security.sec` is an
external consult (three personas; same trust boundary as `docs/reviews/security-sec-broker-socket.md`);
the delegate cannot ratify its own review, so the controls below are proposed and must be
confirmed/corrected before codemode code lands. One concern: the codemode execution surface.

Sources folded in: `docs/CODEMODE.md` (the plan, source-checked), the operator's
`docs/CodeMode_JS_with_Effects_and_Policies.md` (the effect-broker design), the implemented boundary
`docs/SEAT-TOOLS.md` SC1–SC3 + `src/confine.mjs`, and the round-trip research
`docs/reviews/reducing-llm-agent-tool-calls-followup.md` (§2, §3, §6, §7), which is the *reason* codemode
is being considered at all.

## Scope: what listens, and what the boundary is

Codemode lets a seat author a JavaScript program that reaches the outside world only through a
**per-script minted capability object** (`api.*`), each method backed by an **effect broker** that
authorizes → budgets → optionally approves → executes → audits, with `revokeAll` in `finally`. Executors
delegate to durig's already-confined `ExecutionEnv` (SC1). This round covers: authority (what a script may
do), confinement (where), integrity (the audit record), availability (bounds), and the interaction with
the round-trip research.

**The controlling environment fact (D-ENV-AUTH, D30):** every seat runs as the **same Windows user**, so
OS identity is a norm, not a control. Codemode security therefore cannot rest on user identity; every
control below is app-layer and must be falsifiable by a check that can run and fail.

## Verified facts this round relies on (source-checked in `docs/CODEMODE.md`)

- The sandbox is `node:worker_threads` — a **thread in the same process**, not a process boundary.
- QuickJS-WASI: no Node APIs, filesystem, network, or timers; egress is only the injected globals.
- Library defaults are the hazard: `memoryLimitBytes` defaults to **unlimited** (beyond wasm32's 4 GiB);
  `timeoutMs` defaults to **300 000 ms**.
- `result.calls` records `{name, status, durationMs}` only — **no arguments and no output** — and a nested
  result never enters the transcript.
- The unmodified library exposes **`ALL_TOOLS`** (every callable tool, including ones the description
  omits) and `codemode.mode` is **visibility, not authorization**.
- Tool calls are **real** — nothing is rolled back; `models.*` exercises the session's credentials.

## Threat model and proposed controls (each falsifiable)

| # | Threat | Proposed control | Falsification probe |
|---|--------|------------------|---------------------|
| E1 | **Ambient-authority inheritance** — a script reaches a tool outside its policy via `tools`/`ALL_TOOLS`. | Mint **only** per-script capability objects; never inject `tools`/`models`; `codemode.mode` must be authorization, not visibility. | A script calls a tool not in its policy: it must be **undefined**, not denied-at-execution. Assert the sandbox global surface equals the minted set. |
| E2 | **Sandbox escape / VM breakout** — a QuickJS or WASM bug; the worker thread shares the broker process. | Treat thread isolation as **language isolation only**. Privileged tiers (write/exec) run under host containment (container/VM/AppContainer — the SC1-stronger option in `SEAT-TOOLS.md`). | State residual risk explicitly; if containment is absent, the position must record it and restrict the tier. |
| E3 | **Path escape** — symlink, `..`, NUL, or absolute path defeats a glob grant. | Resource predicates canonicalize (`realpath`) and reject `..`/NUL/absolute; **and** the executor re-checks through SC1. Enforced **twice**. | `readFile('/etc/passwd')` and a symlink inside the root pointing out: both refused; a demo proves each denial. |
| E4 | **Capability smuggling / duplication** — a script copies or stores a capability to use later. | Grants are **resource predicates, not handles**; `api` is frozen; the broker and grant objects are never handed to the sandbox; `once` grants self-revoke. | Attempt to duplicate/pass/retain a capability across scopes: no authority survives `revokeAll`. |
| E5 | **Credential abuse** — `models.*` spends the session's credentials on the script's behalf. | `model.call` is **not minted in the first cut**; if ever minted, allowlist + `maxCalls` + `maxUsd` + approval. | A script that calls an unminted model gets `EACCES`; no credential value is ever readable from the sandbox. |
| E6 | **`proc.exec` treated as the boundary** — an `argv[0]` allowlist is unsound (the PowerShell-allowlist class F4 flagged). | `proc.exec`, if exposed, is **a narrowing layer over an already-confined environment — never the boundary**; it delegates to SC1. | `exec('rm -rf /')` refused by the grant; a permitted `argv[0]` still runs confined. |
| E7 | **Unaudited effect footprint** — `result.calls` carries no args/output, so the effect record is lost and **P1 Evidence breaks** (a verifier cannot re-run what the author names). | The **broker audit sink is a prerequisite, not a nicety**: every request records `{kind, resource, decision, reason, budget, auditId}` to an append-only record. Per D30's precedent, prefer **git** (or the existing append-only store) over a new mutable surface. | Replay a script; assert every effect appears in the sink with its decision, and that a denied effect appears too. |
| E8 | **Unbounded execution (DoS)** — an omitted `memoryLimitBytes` / `timeoutMs` gives a 5-minute, 4 GiB VM. | **Both must be set deliberately** on every sandbox construction; default-**deny** (do not start) if unset; hard caps. | Construct a sandbox with defaults omitted: start must refuse loudly, not inherit 300 s/unlimited. |
| E9 | **Mid-run opaque loop** — a single long in-sandbox call is invisible to D64's bounds until the run settles. | **ROADMAP 128:** a **mid-run bound** on one sandbox call (wall-clock/heap), and surface `result.calls` duration in the completion evidence. | A script that loops past its bound must be detected **before** the run settles, or the residual gap named. |
| E10 | **Output/context flooding** — a large script result re-enters the model's context (the cost problem the research names). | Cap output at the broker; large results are written to a file and **only a handle returned**; enforce a context budget. | A script returning 10 000 rows yields a bounded handle, not the rows in context. |
| E11 | **Approval laundering** — batching swallows a human-approval gate (D32: never launder a human decision into seat-to-seat traffic). | Approval-required effects **cannot be batched**: the handler blocks on approval; a script cannot proceed past it. | A script whose next effect requires approval halts with a structured pending-approval outcome, not a silent allow. |
| E12 | **Irreversible side effects** — calls are real and not undone; a wrong program corrupts a worktree. | **Exclude irreversible effects from codemode** (commit, push, publish — push is already operator-gated in `confine.mjs`); keep them per-step. | A script attempting a git mutation is refused at the handler, not merely script-side. |
| E13 | **Supply chain** — a new dependency (`pi-codemode` + `quickjs-wasi`) and its build. | Pin versions; review for install scripts; `security.sec` position before adding (gate 1). | Dependency review recorded; no unreviewed postinstall. |
| E14 | **Declared-vs-granted mismatch** — the model is told it has capabilities it does not, or vice versa. | Emit the tool schema **from the same `Policy`** that mints the grants (one source of truth). | Schema and minted set compared programmatically: they must be equal. |

## What the round-trip research changes (codemode *as a way to cut tool calls*)

Codemode is being considered because it collapses **model round-trips**: loops, filtering, joins, retries,
and conditional branching move into the sandbox, and the currency that matters is **cost with the cache
split and context tokens, not call count** (`reducing-llm-agent-tool-calls-followup.md` §2). Three
security-relevant consequences follow, and they are the reason this round is more than a sandbox review:

1. **Efficiency trades observability, and that is a security property.** A batched execution is one opaque
   call — `result.calls` has no args/output (§6). That is exactly what E7's audit sink mitigates, and why
   **the sink (ROADMAP 129) must land before codemode**, not after: without it, a verifier cannot re-run
   what the author names (P1 Evidence), and a post-incident forensics pass has nothing to read.
2. **Batching shifts the degeneration surface off the current detectors.** The research's §6 verdict:
   reducing turns reduces exposure to tool-call-as-text and prose loops, and **adds** an opaque
   in-sandbox loop that D64 cannot see until the run settles (D64 computes bounds over entries above the
   last wake and resets between runs). E9/ROADMAP 128 is the control.
3. **Durability and audit both want the plan split into checkpointed nodes.** A single monolithic program
   is one un-checkpointed step — `resume()` cannot replay it, and its effect footprint is one blob. Binding
   plan nodes to pi-durable `defineTask` phases (**ROADMAP 127**) makes a crash replay completed nodes and
   re-run only the in-flight one, and gives the audit sink a per-node boundary. So the *durable* form of
   batching is also the *auditable* form.

**Batchability rule (from the research §7), enforced at the handler:** batch a step only if it is
**idempotent/side-effect-free**, has **no human-approval gate**, consumes **no blind rate limit**, and is
**not** the failing-first checkpoint. Commit/push/approval stay per-step (E11, E12).

## Proposed first cut: the read-only tier

The smallest capability surface that still delivers the round-trip win is a **T0 read-only/compute tier**:
`fs.read` + `fs.list` only — **no `fs.write`, no `proc.exec`, no `net.fetch`, no `model.call`**. The
read/analyze/filter loop is where most round-trips are spent, so T0 captures most of the benefit at the
smallest authority. Widen only in order, each gated by a recorded position:

- **T0** read-only/compute (this round's recommendation).
- **T1** write confined to the item's worktree (needs E7 audit sink + E8 bounds + SC1).
- **T2** `proc.exec` under approval (needs host containment, E2).

## Explicit non-goals

- **Not a permission system for the whole harness.** Codemode's broker governs *minted capabilities*; it
  does not replace the tool boundary or the ambient-authority analysis in `docs/SEAT-TOOLS.md`.
- **Not process isolation.** The worker thread is same-process (E2); containment is a separate requirement.
- **Not a substitute for SC1–SC3.** Executors delegate to the confined `ExecutionEnv`; SC1 is the spine.
- **No network in the first cut** (per `CODEMODE.md`), and no credential exercise (E5).

## Open questions for `security.sec` (the consult)

1. Given D-ENV-AUTH (same Windows user), are **minted per-script capability predicates + SC1** sufficient
   authority control, or is a distinct low-privilege OS user/containment required before any write tier?
2. **Where does the audit sink live** — git (D30's stated preference for an append-only record) or the
   existing store? It is a new write path and needs the position before code (D24/D27).
3. Is **`model.call`** (credential exercise) acceptable at all, and under what budget/approval?
4. Is **`proc.exec`** ever admitted, or does T0/T1 stand and exec is rejected outright?
5. What **host containment** (container/VM/AppContainer) is required before T1/T2, and does it change the
   residual-shell-risk dissent preserved in D30?
6. Does the **mid-run bound** (E9 / ROADMAP 128) belong in the security position as a control, or is it a
   reliability concern only?

## Consequence for implementation

Codemode code may proceed **only** against a ratified position, with E1–E14 wired as auditable checks (the
demo suite carries the E1/E3/E4/E7/E8/E11/E12 probes at minimum — offline, no network, no live spend). Any
deviation — minting `tools`/`models`, a sandbox with omitted bounds, an unaudited effect, `proc.exec` as a
boundary, a widened tier without a recorded position — requires a **new** `security.sec` consult before
that code lands.

**Routing:** hand this round to `security.sec`; on return, fold the ratified controls into
`docs/CODEMODE.md` gate 1, record a `D`-entry, and register the tier gates. Until then ROADMAP 32's gate 1
is **open**, and 128/129 remain codemode prerequisites (ROADMAP item 32; queue #1235).
