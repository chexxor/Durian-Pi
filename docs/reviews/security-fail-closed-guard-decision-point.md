---
runbook: null
position: security-fail-closed-guard-decision-point
symptom: "a guard that cannot evaluate lets the action through, and nothing names that as a decision"
writes: false
precondition: "read-only probe of src/seatguard.mjs, src/confine.mjs, src/genlockreserve.mjs and the guard demos"
last_verified: 2026-11-09
verified_by: security
evidence: "item #1779, worktree item-1779 @HEAD: `node demo/seatguard.test.mjs` exit 0, `node demo/confine.test.mjs` exit 0, `node demo/commit-secrets.test.mjs` exit 0; fail-open sites at src/seatguard.mjs:42,50,282,355-374 and src/genlockreserve.mjs:78. Re-checked at main f192f543 (#6208): lines 42,50,362,78 hold verbatim; the collapse-detector catch moved 281 -> 282, which is why every citation here carries a re-check date; `git show --stat 5686be7` = 1 file, docs only; `grep -rn WORKTREE_ROOT --include=*.mjs src/` exit 1 (the #2425 seam does not exist yet)"
check_rule: null
---

# Fail closed where a boundary is decided; never let a heuristic's silence read as a check

This is the security position for ROADMAP **133** (fail-closed decision point) and **134** (structured refusal shape). It precedes code: nothing in `src/seatguard.mjs` or `src/confine.mjs` is changed here, and this row is not authority to change them. Serialization (one writer at a time, coordinated with `#166`, `#172`, `#1557`) is pm's sequencing, not something a released backlog row implies.

## Scope

One seam decides whether a seat action runs: `beforeTool(call, api, context)` in `src/seatguard.mjs:442`, which returns `{block: <string>}` or nothing. Behind it sit `refusalFor` (`src/confine.mjs:903`), `refusalForWrite` (`:268`), `refusalForSpoolPath` (`:400`), `commitSecretRefusal` (`:355`) and the root resolver `seatGraphRoot` (`:44`). The AGT invariant being borrowed (ADR-0013) is narrow: **an error in policy evaluation denies, and there is no flag that turns evaluation to fail-open.**

## The rule I am proposing, stated once

Every guard is one of two kinds, and the failure direction follows from the kind:

| Kind | Meaning | Required failure direction | Must also say |
|---|---|---|---|
| **Boundary** — root confinement, spool path, the git verb census, worktree identity, the genlock lease | decides whether an action may touch something it does not own | **deny** when evaluation cannot run | which rule denied, and why |
| **Heuristic** — the multi-line-collapse detector, the commit-diff token scan | raises confidence about a known incident shape | may fail open | that it **did not run**, in a machine-readable way |

The danger is not that a heuristic fails open. The danger is that a heuristic's silence is indistinguishable from a boundary check having passed. Today it is.

## Findings

### F-1 — the root resolver fails open, and the fallback is the shared tree
`src/seatguard.mjs:42` — "A snapshot that cannot be served leaves the fallback — fail-open, never blocking a write because the guard's own read hiccuped"; `:50` logs `SEATGUARD WARNING: seat cwd snapshot failed, using fallback root`.

- **Severity:** medium-high.
- **Exploit path:** the guard's decision depends on the seat's persisted cwd. If `api.snapshot(AgentDoc, …)` throws, resolution falls back to `resolveSeatRoot().root`. `complete_work` already "SILENTLY resets the seat's persisted cwd to the broker's cwd, the shared tree" (`src/seatguard.mjs:355`-area comment, the `#3961` note) — so under a degraded read the guard resolves to exactly the tree the guard exists to protect. A relative write or a commit then lands in the shared checkout, which is the `#3122` / commit-on-main class. No attacker is needed; a store hiccup is enough, and a seat that wants a write to succeed has an incentive not to notice the warning on stderr.
- **Fix:** when the root cannot be determined, **refuse the write/execute** and name the remedy (`prepare_workspace`). Fail-closed does not mean blocking ordinary work — it means the guard may not guess a root.
  **Correction (from #6206), the first draft was wrong:** I wrote that the `DURIAN_PI_WORKTREE_ROOT` seam (`#2425`) is the deterministic fallback. It is **registered, not built** — `grep -rn "WORKTREE_ROOT" --include="*.mjs" src/` returns nothing, exit 1; the only mentions are a comment in `demo/complete-teardown-root.test.mjs:23` and this doc. Until it exists, the only legitimate fallback is the resolution the guard already shares: `src/seatroot.mjs:11` (`persisted seat cwd -> DURIG_SEAT_ROOT -> process cwd`), fed by the broker-side call that created the worktree for the item id the queue handed the seat. If that cannot name a root, deny — do not guess.

### F-1b — a fallback root read from a seat-writable channel is fail-open wearing a fail-closed label
- **Severity:** high, because it looks like a fix.
- **Why:** `src/confine.mjs:28-32` states outright that every in-repo channel is seat-forgeable (D-ENV-AUTH: one OS user, so OS identity is a norm, not a control) and that the harness's own `process.env` is the only gate a seat cannot write for itself. `pickEnv` with `inheritEnv: false` (`src/confine.mjs:811-824`) makes a seat's command environment an allowlist-filtered subset **plus whatever the caller requests**, and `DURIG_SEAT_ROOT` is in the declared config inventory (`src/config.mjs:162`). The persisted cwd is written by `configure` (`src/seatroot.mjs:11`).
- **Exploit path:** a guard that resolves its fallback root from env or from the persisted cwd accepts a root the seat chose. "Refuse when the root is undeterminable" becomes "accept whatever the seat supplied" — the boundary is crossed while the code reads as fail-closed.
- **Fix:** the root comes from the broker process, for the item id the queue handed the seat. No env var, no persisted cwd, no seat-supplied value.
- **Probe that can fail:** set `DURIAN_PI_WORKTREE_ROOT` (or `DURIG_SEAT_ROOT`) in a seat shell call to an arbitrary path and assert a relative write is still refused against the broker-resolved root. Today nothing can be asserted, because the variable does not exist in `src/`.
- **Probe that can fail:** stub `api.snapshot` to throw, run a relative `write` through `beforeTool`, assert a block. Today it returns no block and prints a warning.

### F-2 — the collapse detector returns null when it cannot read
`src/seatguard.mjs:282` (281 when this was first measured; it shifted with the #3961 work): `catch { return null; // unreadable/no prior: not provably a collapse, so not refused }`.

- **Severity:** low. It is a heuristic and it is honest about being weak ("WEAK check deliberately").
- **Fix:** not a deny — a **reported non-check**. `refusalForWrite` should be able to return `{decision: "not-evaluated", reason: "prior state unreadable"}` so the seam can record that the rule did not run, rather than the absence of a refusal meaning the rule ran and was clean.

### F-3 — fail-open at the commit gate is already ratified; keep it, and mark the boundary of that ratification
`src/seatguard.mjs:362-374` returns `null` after printing `SEATGUARD WARNING: the commit-time secret scan could not run (…) — the commit proceeds UNSCANNED`, and `demo/commit-secrets.test.mjs:151` **asserts** that behaviour ("the commit is ALLOWED (fail-open is ratified at this point)").

- **Severity:** medium, and the reasoning is sound: the enforcement point depends on the same git whose failure opened the gate, so the commit could not have happened through that path anyway.
- **Position:** ratify it, and state the limit the code already records as a standing generalization: **any enforcement point that does not depend on the failing tooling must fail closed.** A broker-side receive hook that scans content the broker itself assembled has no excuse for fail-open. That hook is a new write/egress surface and needs its own position before it lands — I am naming it, not building it.
- **Probe that can fail:** a demo where the diff scan fails at an independent seam and the action is refused, not warned.

### F-4 — a stale genlock lease never blocks
`src/genlockreserve.mjs:78`: "a stale/dead one never blocks anyone (fail-open)", while `:41` says the cap "fails closed here".

- **Severity:** medium. The single-writer invariant is the store's core control; two drivers is corruption, and this rig has live precedent (the 2026-10-16 second-writer crash documented in `docs/runbooks/resume-while-broker-runs.md`).
- **Fix:** distinguish **confirmed-dead** (ESRCH says the owner process is gone) from **unknown** (lookup failed, no pid recorded, host unreachable). Confirmed-dead may release; unknown must not admit a second writer. This matches the liveness finding already landed in `#3743`: only ESRCH is dead, so unknown returns ALIVE.
- **Probe that can fail:** write a lease whose owner cannot be resolved, attempt a second reservation, assert refusal. Today the attempt succeeds.

### F-5 — nothing proves the rules ran
`beforeTool` returns either a block or nothing; nothing in the return path distinguishes "all rules evaluated and allowed" from "evaluation did not happen". `#3635` made every refusal name its own verb — that is prose, not a rule identity. ROADMAP 133's acceptance text is explicit: *a passing check proves the rules ran, not that evaluation was skipped*.

- **Severity:** medium (auditability, not direct compromise).
- **Fix:** the seam returns a verdict object on allow as well as deny: `{allowed: true, seam: "beforeTool", rules: ["git-census", "root-confinement", "spool-path", "commit-secret-scan"], notEvaluated: [...]}`. A demo asserts the list is non-empty and that a rule registered as `not-evaluated` is visible rather than silent.

## ROADMAP 134: the refusal shape, and the gate it opens

Minimum fields, in this order — anything more is scope creep:

1. `rule_id` — stable identifier for the rule that fired (the git census entry, the root guard, the spool guard).
2. `action` / `tool` — which call was refused.
3. `decision` — `deny` | `not-evaluated` (the second value is the one nobody can express today).
4. `source` — where the rule lives (`src/confine.mjs` DENIED_COMMANDS, config key).
5. `remedy` — the human-readable way out, which is already the strength of the current refusals.
6. `timestamp` and **the tree the decision applied to** — the seat root or worktree, because a refusal's correctness depends on which tree was in scope.

Two constraints, both mine and both non-negotiable:

- **The record carries a class, never a value.** A refusal record that embeds the offending token is a leak in the audit sink — the same rule the detection and redaction surfaces already obey.
- **The sink is a new write path.** Writing refusal records into the store crosses the single-writer boundary (A1). That part is **parked** and named: it needs its own position and its own gate before any code touches it. A refusal that is only a string printed to stderr is not a substitute for an audit record, but neither is an audit table bolted onto the broker without a decision about who may write it.

## Non-goals

- No new capability system, no agent identity, no policy language. durig is a single-operator local rig; AGT's identity/mesh/ring stack is wrong-layer (ROADMAP 133–144 framing).
- No fail-open configuration flag anywhere. If a guard must fail open, that is written in the code as a ratified exception with a reason, not exposed as a setting.
- Not this row: the serialization of guard edits. One writer at a time is a scheduling decision pm owns.

## Gates — before any 133/134 code lands

1. G0: the root a boundary guard resolves comes from the broker process, never from a seat-writable channel (env, persisted cwd, or a config value the seat can influence).
2. G1: every guard is labelled boundary or heuristic in its own comment, and the label drives its failure direction.
3. G2: a boundary guard that cannot evaluate **denies**. No exception without a ratified reason in the code.
4. G3: a heuristic that did not run reports `not-evaluated` in a machine-readable form.
5. G4: a demo asserting F-1's fix (stub the snapshot, expect a block) — failing first.
6. G5: genlock distinguishes confirmed-dead from unknown, with a demo.
7. G6: refusal records contain classes and rule ids, never values; and the sink's write authority is settled before the sink exists.
8. G7: any root fallback is traced to the broker in a demo; a fallback that cannot be traced to the broker is not a fallback.

## Re-runnable evidence

Ran on this worktree (`item-1779`, pi-durable 1.3.0 from the lockfile; **not** vendor/pi-main linked, so suite results are not comparable with a seat root that is):

```bash
node demo/seatguard.test.mjs        # exit 0 — "PASS — the guard holds"
node demo/confine.test.mjs          # exit 0 — "PASS — all confine canaries held"
node demo/commit-secrets.test.mjs   # exit 0 — includes the ratified fail-open assertion at :151
grep -n "fail-open\|fail-closed" src/seatguard.mjs src/confine.mjs src/genlockreserve.mjs src/worktree.mjs src/gitobject.mjs
```

That grep is the whole argument in one line: the rig already fails closed in some places (`src/confine.mjs:696` "fail-open-by-default is the defect this item is about"; `src/worktree.mjs:626`, `:1036`; `src/gitobject.mjs:110`) and fails open in others (`src/seatguard.mjs:42,50,282,355-374`; `src/genlockreserve.mjs:78`). What is missing is not intelligence, it is a named invariant that decides which direction is allowed where.

## Citations

- `docs/reviews/agent-governance-toolkit-review.md:55,56,146` — the AGT fail-closed and structured-denial practices, and the durig gap.
- `docs/ROADMAP.md:2621-2632` — items 133 and 134, owners, acceptance text.
- `src/seatguard.mjs:42,50,268-289,355-374,442-500`; `src/confine.mjs:696,837,903`; `src/genlockreserve.mjs:41,78`.
- `docs/runbooks/resume-while-broker-runs.md` — the second-writer incident that makes F-4 concrete.
- Related rows: `#3635` (refusals name their verb), `#3743` (only ESRCH is dead), `#3961` (degraded-cwd refusal), `#2425` (`DURIAN_PI_WORKTREE_ROOT` — REGISTERED, HELD, not built), `#5976`/`#6014` (evidence-tree verdict: the same "a cheap signal may accept but never decide" principle), `#6181`/`#6183`/`#6184`/`#6185` (the rows these gates bind).
