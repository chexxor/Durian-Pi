> **D103 rename (2026-10-18):** this record predates the product rebrand `durig` → `durian-pi`; it keeps the old name so the audit trail stays truthful.

# durig incident reports

**Status:** working set. Audience: the **delegate**, the **operator**, and any seat reviewing project
history. An incident report is a **backward-looking, timestamped record** of something that broke —
what happened, why, and what durable change stops it recurring. It is *not* a runbook (that is *how to
respond* — `docs/runbooks/`) and *not* a review (that is forward-looking design/research —
`docs/reviews/`). A record is **appended to / re-reviewed**, never rewritten; if the analysis changes,
add a dated note rather than editing history.

## The one rule that makes these maintainable

The `docs/reviews/runbooks-sop-best-practices.md` finding applies here: **conventions without machinery
rot.** These reports stay true only because `check` enforces the surface (same seam as the runbook
rules `runbook-stale` / `runbook-unverified` in `src/checkup.mjs` §9). See "Rules" below.

## Front-matter (mandatory)

```yaml
---
incident: <slug>                      # filename stem after the date; stable id
date: YYYY-MM-DD
severity: sev1                        # sev1 = rig unusable / data risk | sev2 = a capability broken | sev3 = degraded
status: open                          # open | mitigated | resolved
symptom: "<the words a person would type>"
runbook: <runbook-stem|null>
fix: <"#NNN"|"<sha>"|null>
prevention: "<#NNN|check-rule|test|runbook|null>"
last_reviewed: YYYY-MM-DD
---
```

## Conventions

1. **One incident per file**, named `YYYY-MM-DD-<slug>.md`; the slug mirrors `incident:`.
2. **Fixed skeleton** (`_template.md`): Summary / Timeline / Impact / Root cause / Detection /
   Resolution / Prevention / Evidence / Links.
3. **Ground every claim** in `## Evidence` — a command, a store entry id, a commit, or a file:line.
   Mark **UNVERIFIED** explicitly rather than asserting a cause.
4. **`prevention: null` is honest** — an incident with no durable change says so; it is not a lesson.
5. **Pair with a runbook:** add one `## Evidence` line to the runbook that covers the symptom, and
   update the runbook if the procedure changed. The runbook is *how to respond*; the incident is *what
   happened*.
6. **Re-review on trigger, not calendar** — re-open or link a new report if the class recurs; do not
   rewrite the old one.

## Rules (enforced by `check`)

| Rule | Severity | Fails when |
|---|---|---|
| `incident-unindexed` | error | an incident file is missing from this index |
| `incident-runbook-missing` | error | `runbook:` names a file that does not exist |
| `incident-unresolved` | fix-now | `status: open` past the age band |
| `incident-no-prevention` | fix-now | `status: resolved` with `prevention: null` and `runbook: null` |

*(Rules proposed/routed; until they land, this table is advisory. Drop this note once they exist.)*

## Index

| Date | Sev | Incident | Symptom | Runbook | Status |
|---|---|---|---|---|---|
| 2026-10-17 | sev1 | [landing-safety](2026-10-17-landing-safety.md) | every `node cli.mjs` verb fails to load; the shared tree is left mid-merge | merge | resolved |
| 2026-10-17 | sev1 | [broker-crash](2026-10-17-broker-crash.md) | seats idle with queued work; no `serve` process; the broker log stops | broker-down-or-stalled | open |
| 2026-10-18 | sev1 | [broker-dormant-stalled](2026-10-18-broker-dormant-stalled.md) | the team has stopped working; the broker process is alive but its log stops | broker-down-or-stalled | mitigated |
| 2026-10-18 | sev1 | [broker-retry-hotloop](2026-10-18-broker-retry-hotloop.md) | the broker spins: `WAKE-RETRY … pass-threw` every ~0.5s, the intent inbox never drains, `serve --stop` is defeated | broker-down-or-stalled | mitigated |
| 2026-10-19 | sev2 | [worktree-carry-teardown-collision](2026-10-19-worktree-carry-teardown-collision.md) | a seat calls `complete_work` and its item worktree leaks, still dirty, still on its item branch | leaked-worktrees | open |
| 2026-10-19 | sev2 | [broker-mjs-one-line-collapse](2026-10-19-broker-mjs-one-line-collapse.md) | a source file was silently collapsed to one line (`src/broker.mjs` in the shared tree) | write-corruption-recovery | resolved |
| 2026-10-19 | sev2 | [read-op-regression](2026-10-19-read-op-regression.md) | `node cli.mjs watch`/reads fail with `unknown op: read`; the suite is RED on `main` | broker-down-or-stalled | mitigated |
| 2026-10-19 | sev2 | [read-storage-handle](2026-10-19-read-storage-handle.md) | `node cli.mjs` reads (`ps`/`queue`/`watch`) and `npm run ui` fail with `the broker has no storage handle (probeStorage)` | broker-down-or-stalled | mitigated |
| 2026-10-19 | sev2 | [pi-build-version-visibility](2026-10-19-pi-build-version-visibility.md) | a fresh worktree sees released `pi-durable` 1.1.0 while the shared tree runs the pinned vendored 1.3.0, so the same commit is GREEN in one and RED in the other | null | open |
| 2026-10-18 | sev2 | [seat-unwakeable-corrupt-doc](2026-10-18-seat-unwakeable-corrupt-doc.md) | a seat is never woken; `serve.err` repeats `wake-failed … unresolvable path` | store-corruption-recovery | resolved |
| 2026-10-18 | sev2 | [host-resource-exhaustion](2026-10-18-host-resource-exhaustion.md) | `node cli.mjs status`/`queue` dies with `FATAL ERROR: Zone Allocation failed`; the demo suite is flaky | null | resolved |
| 2026-10-18 | sev2 | [local-provider-empty-key](2026-10-18-local-provider-empty-key.md) | a seat on the local provider fails with `No API key for provider: local` after a broker restart | local-provider-down | mitigated |
| 2026-10-17 | sev1 | [live-worktree-reap](2026-10-17-live-worktree-reap.md) | a commit lands on `main` from a seat whose cwd fell back to the shared tree | leaked-worktrees | resolved |
| 2026-10-17 | sev1 | [seat-root-fallback-commit](2026-10-17-seat-root-fallback-commit.md) | a commit reached `main` and the shared tree moved to an item branch, no landing pass | leaked-worktrees | open |
| 2026-10-17 | sev2 | [empty-landing-window](2026-10-17-empty-landing-window.md) | the exclusive landing window closes with no branches landed | land | resolved |
| 2026-10-17 | sev2 | [ui-view-undefined](2026-10-17-ui-view-undefined.md) | `durig ui` paints `(poll failed: ...)` and nothing else | null | open |
| 2026-10-17 | sev2 | [qa-context-degeneration](2026-10-17-qa-context-degeneration.md) | a seat loops on a saturated context and burns tokens; the guard never resets it | degeneration-guard | mitigated |

## Template

New reports start from [`_template.md`](_template.md).
