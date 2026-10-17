---
runbook: security-trust-boundary-review
symptom: "a dependency, execution surface, egress channel, write path or trust boundary is about to land — review it before the code"
writes: false
precondition: "read-only"
last_verified: 2026-10-17
verified_by: security
evidence: "#1322 (section-anchor conformance check against the #1295 codemode position at 4cba82f; Verify run 2026-10-17)"
check_rule: null
---

# Review a trust boundary (the method)

## When to use
- A change adds a dependency, an execution surface, an egress channel, a write path, or moves a trust
  boundary (broker/store single-writer; seat confinement SC1–SC3 + env allowlist; the `genlock`
  lease; per-item worktrees and the sweep; the spooled inbox; the constitution injection; the tool
  surface; codemode; any socket/daemon; egress; the credential surface).
- An incident or review asks "what was this boundary's position?" — and none exists.
- A seat is asked to run a security review and would otherwise improvise.

## Impact
Without the method, code crosses a boundary carrying controls that cannot fail (unfalsifiable
assertions), findings are noise (severity and exploit path missing), the review itself copies secret
values into durable logs, and positions appear after the code instead of before it — which is the one
ordering this seat is chartered to protect.

## Preconditions
Read-only: the review never writes — no broker verbs, no store writes. Its outputs are a per-item
artifact `docs/reviews/security-<topic>.md` and queue items. There is **no standing
`docs/reviews/security-*.md` set** (lead #1297, revised by #1318): only failure-mode runbooks plus
this method live in `docs/runbooks/`.

## Diagnose (read-only)
1. **Secret scan first** — before reading anything else in the change. The class-pattern table and
   the scan commands live in [leaked-secret.md](leaked-secret.md) (single home; this file links, not
   duplicates). Example probe:
   ```bash
   git grep -nE 'sk-ant-[A-Za-z0-9_-]{8,}|AKIA[A-Z0-9]{16}' -- . ':!docs/runbooks/leaked-secret.md'
   ```
   A hit stops the review: run `leaked-secret.md` — report-never-echo, rotation first — before
   continuing.
2. **Inventory the boundary** from the change itself:
   ```bash
   git diff --stat <base>...HEAD
   ```
   ```powershell
   Select-String -Path src\confine.mjs -Pattern 'ALLOWLIST|SECRET_NAME|operatorGranted'
   ```
   `[judgement]` then name, in prose, what listens / what writes / what reads across the proposed
   boundary; if the change adds a process, a socket or a scheduled task, list it from the change's
   own docs.

## Do
1. **Scope.** Name the surface — what listens, what the boundary is — and the governing environment
   facts (D-ENV-AUTH: every seat runs as the same Windows user, so **OS identity is a norm, not a
   control**; every control specified is app-layer and falsifiable by a check that can run and fail).
2. **Threat model table** — threat → proposed control → falsification probe, with the probe rules:
   - a probe is a command that can run and fail (demo suite, cli verb, `git grep`, `node --check`);
   - a control without a runnable probe is noise — cut it, or move it to residual risk by name;
   - a finding names severity, exploit path, and concrete fix — a line without all three is not a
     finding; prefer the false negative to the false positive on a heuristic;
   - two layers where cheap (cf. ROADMAP 32's two-layer denial proof).
3. **Non-goals and gates.** What the review does not cover; what must hold before the code lands,
   as numbered falsifiable gates.
4. **Posture checks:** default-deny, least privilege, fail closed, never rely on a single layer.
5. **Name unverified surfaces as unverified** (today: the seat egress path and the credential
   surface); never assume a control exists because a doc mentions one — that is exactly how a
   non-existing gate gets cited as if it held.
6. **Secrets hygiene during review:** never print, log or echo a value; report type, location and a
   redacted preview (≤4 leading chars). A burned secret routes to `leaked-secret.md`; removal alone
   is never sufficient — the provider value is rotated.
7. **Write the position BEFORE code** at `docs/reviews/security-<topic>.md` (shape:
   `security-sec-broker-socket.md`, `security-codemode-position.md`), commit with explicit paths
   only, then **report and propose** — route adoption to lead/pm; the reviewer does not adjudicate
   scope.
8. **Ratification provenance:** if ratifying another writer's round/consult, state who wrote what,
   and re-check cite-by-reference claims before declaring a gate closed (correction C3 in the
   codemode position is the standing example).

## Verify
The method is done only when its artifact **structurally** passes: a position carries `Scope`,
`Non-goals`, `Gates`, `Citations` headings, and its threat model (possibly in the ratified input
round) carries a `Threat model` heading:

```bash
git grep -cE '^## (Scope|Non-goals|Gates|Citations)' -- docs/reviews/security-<topic>.md   # expect a count >= 4
git grep -cE '^## Threat model' -- docs/reviews/security-<input-round>.md                # expect a count >= 1
```

This runbook's own Verify ran 2026-10-17 against the #1295 codemode pair (position at `4cba82f`,
input round `security-codemode-review.md`): both commands exited 0. Any future position must pass
the same two greps against its own artifact.

## If it fails
- **Secrets found by the scan:** stop; switch to `leaked-secret.md` (report-never-echo; rotation
  first; never paste the value into queue items, logs or commit messages).
- **A control cannot be made falsifiable:** it is not a control — move it to the position's residual
  risk section, named as residual; do not present it as an assertion that holds.
- **The boundary spans another seat's ownership:** defer the specific question with `defer_work`
  instead of guessing authority limits.
- **The artifact misses an anchor:** the review is not done — finish the missing section rather than
  weakening the Verify to pass it.

## Escalate to
- **lead/pm:** adoption, scope, landing; any deviation from a ratified position requires a **new**
  security consult before that code lands.
- **Operator:** rotation, publication status (push grant), spend decisions.
- **impl:** wire the probes into the demo suite as acceptance criteria — probes left in prose rot.

## Evidence
- Split, item #1322 (2026-10-17): the author's challenge was ruled correct (lead #1316, delivered
  as #1318 — #1297's "one runbook" wording revised); the method MOVED here from `leaked-secret.md`,
  not duplicated. Branch `security-item-1322` carries `82337e0` (the #1300 runbook commit) as
  ancestor via the item's own merge step.
- Verify actually ran 2026-10-17: the section-anchor conformance greps above executed against the
  codemode pair (`docs/reviews/security-codemode-position.md` @ `4cba82f` + the input round) —
  4 anchors in the position, `Threat model` in the round, both commands exit 0.
- Method exercised end-to-end by its own artifacts: `security-codemode-position.md` (E1–E14 ratified
  with corrections, Q1–Q6 answered, Gates G1–G8) and `leaked-secret.md`.
