---
incident: read-op-regression
date: 2026-10-19
severity: sev2
status: mitigated
symptom: "`node cli.mjs watch`/reads fail with `unknown op: read`; `demo/broker-read-nopass.test.mjs` is RED on `main`"
runbook: broker-down-or-stalled
fix: "3e17346"
prevention: "restore `read` as a UNION with `configure` (routed operator intent 2026-10-19); add a gate that a committed demo is green on `main` before a landing window"
last_reviewed: 2026-10-19
---

# `main` cannot serve a `read` intent: `c5daca5` dropped the op while its test and `brokerread.mjs` remain

*Incident 2026-10-19; detected by the delegate during a landing window; reproduced live by the operator.*

## Summary
`main` at `3d102a6` is internally inconsistent. Commit `c5daca5` ("fix(broker): reconcile WIP against
authoritative baseline (#2211)") removed the `read` spool op — the `import { dispatchRead }`, the
`"read"` entry in `SPOOL_OPS`, and the `op === "read"` handler in `applyRequest` — while **keeping** the
tracked `src/brokerread.mjs` (D111) and the committed `demo/broker-read-nopass.test.mjs` (#2321,
`615d64e`) that require it. Result: the suite is RED on `main` itself, and the broker dead-letters every
`read` intent, so `node cli.mjs watch` — the operator's window into the team — fails with
`read health: unknown op: read (known: message, stop, reset, compact, pause, unpause, configure)`.

## Timeline
- `615d64e` (#2321) adds `onlyReadIntents` + in-place read serving; `d058e0a` lands it (`SPOOL_OPS`
  includes `"read"`; `src/brokerread.mjs` from D111 is tracked).
- `c5daca5` ("reconcile WIP against authoritative baseline") applies the `configure` WIP and, in the same
  commit, **removes `"read"` from `SPOOL_OPS`** and the read handler, keeping `configure` only.
- `2026-10-19T02:40Z` the broker wedges on `qa conv 15`; the shared-tree `src/broker.mjs` is found
  collapsed to one line (separate incident `broker-mjs-one-line-collapse`).
- `~03:00Z` delegate runs a landing window for five clean+verified branches; `scripts/land.mjs --suite`
  REFUSES because `demo/broker-read-nopass.test.mjs` is RED on `main`; `main` is not advanced.
- `~03:10Z` broker restarted (pid `4796`); its first pass reports `INTENT delivered=2 dead=2` — the two
  dead are the pending `read` poll intents (unknown op).
- Operator runs `node cli.mjs watch` and gets `unknown op: read` — live confirmation.

## Impact
- `cli.mjs watch`/CLI reads are broken on any broker restarted from `main` (`src/readclient.mjs:37` sends
  `op:"read"`), removing the operator's team window.
- The landing suite gate is RED on `main`, so **no branch can be landed** with `--suite` until fixed;
  the five verified branches (`impl-item-2229`, `impl-item-2231`, `scribe-item-2260`, `scribe-item-2331`,
  `scribe-item-2332`) sit unlanded.
- No data loss; `src/brokerread.mjs` and the test are intact and the fix is a small re-add.

## Root cause
**VERIFIED (by diff).** `c5daca5` intentionally described `read` as "not an authoritative spool op" and
removed its wiring, but the other half of `main` still depends on it. The commit's own message lists the
removal; `git show c5daca5 -- src/broker.mjs` shows `SPOOL_OPS` changing
`[…, "read"]` → `[…, "configure"]` and the `op === "read"` branch being replaced by `op === "configure"`.
This is a post-verify regression: `#2321` was verified (`#2373`) and landed **before** `c5daca5`, so the
verify was valid for the code at the time; `c5daca5` then broke it.

## Detection
The landing gate (`scripts/land.mjs --suite`) surfaced it before any further landing — the strongest
available detector. It is otherwise invisible: `status` has no attention kind for "the suite is red on
`main`", and a fresh broker heartbeat is not health.

## Resolution
**Pending — routed, not landed.** Operator intent delivered to `pm` (`intent-read-op-regression.md`):
restore `read` as a UNION with `configure` — re-add `import { dispatchRead } from "./brokerread.mjs"`,
add `"read"` back to `SPOOL_OPS` alongside `"configure"`, and re-add the `op === "read"` handler in
`applyRequest` serving from `harness.storage` (NOT `probeStorage`) — then route a non-author verify and
land the five verified branches. Until it lands, the broker on `main` cannot serve reads.

## Resolution — 2026-10-19T03:22Z (operator-directed hotfix `3e17346`)
The delegate applied the union fix directly under the operator's directive (the read surface being dead
blinded both the operator and the delegate, so a backlog round-trip was not viable):
`src/broker.mjs` re-gained the `dispatchRead` import, `"read"` in `SPOOL_OPS` (before `"configure"`),
and the `op === "read"` handler; `demo/command-spool.test.mjs`'s closed-vocabulary assertion was
corrected to include `"configure"` (it was a **second** pre-existing red on `main`, masked because the
landing suite stopped at `broker-read-nopass` first). Full suite: **148/148** (`scripts/suite.mjs`).
Broker restarted (pid `12716`); `cli.mjs status`/`watch --once` return `"ok":true`. A non-author verify
is routed (`intent-verify-read-op-hotfix.md`); status stays `mitigated` until it passes.

## Prevention
- Land the read-op restoration with a non-author verify; `demo/broker-read-nopass.test.mjs` must be GREEN
  on the merged result.
- Add a gate that runs the committed suite on `main` before a landing window (currently a post-verify
  commit can leave `main` red with no attention notice).
- Treat `c5daca5`-style "reconcile against authoritative baseline" commits as high-risk: re-run the
  suite they affect (they touched a file with a committed, verified test).

## Evidence
- `git show c5daca5 -- src/broker.mjs` — `-…"read"` / `+…"configure"` in `SPOOL_OPS`; `op === "read"`
  handler replaced.
- `demo/broker-read-nopass.test.mjs` → `AssertionError: read poll 0 was served (unknown op: read …)`,
  exit 1, run **on `main`** (not a branch).
- Operator: `node cli.mjs watch` → `{"ok":false,"error":"read health: unknown op: read (known: …)"}`.
- `selfdev.sqlite.broker.log`: `START pid=4796` → `INTENT delivered=2 dead=2 dup=0`.
- `git ls-files src/brokerread.mjs` → tracked; `src/readclient.mjs:37` sends `op:"read"`.
- Landing refusal: `.spike/delegate/landing-20261019.out`.

## Links
`docs/runbooks/land.md` (the suite gate that caught it) · `docs/runbooks/broker-down-or-stalled.md` ·
`docs/incidents/2026-10-18-broker-retry-hotloop.md` (#2321's context) ·
`docs/incidents/2026-10-19-broker-mjs-one-line-collapse.md` (concurrent file collapse) ·
`src/brokerread.mjs`, `src/readclient.mjs`, `demo/broker-read-nopass.test.mjs`.
