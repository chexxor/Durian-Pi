# durig runbooks (SOPs)

**Status:** working set. Audience: the **delegate** (operator-facing) and **seats** (a seat reads a
runbook when woken into a situation it does not own). A runbook is an operating procedure, not a design
doc: the design lives in `BROKER-ARCHITECTURE.md` / `BROKER-SUPERVISION.md` /
`COMMANDS-AND-THE-BROKER.md`; this directory is *what to do*.

**Reviewed against research:** `docs/reviews/runbooks-sop-best-practices.md`. durig's skeleton already
matched published practice; the research's real finding is that the missing part is **machinery** —
nothing enforces the conventions or detects rot, and the one guardrail that matters (never proceed on a
false `stopped` signal) is prose, which failed twice on 2026-10-16. The conventions below incorporate
that report; the machinery is ROADMAP items **81–88**.

## The one rule that shapes every runbook: single writer

The broker owns the store; a second `Harness`-opening verb while it runs is what corrupted the store
twice. Every writing procedure starts by **stopping the broker and confirming it exited**, and every
read-only procedure says so. See `COMMANDS-AND-THE-BROKER.md` §4.

## Front-matter (mandatory)

Every runbook opens with a machine-readable block so a seat, a human, or a `check` rule can retrieve it
and refuse on a mismatch before reading the body:

```yaml
---
runbook: broker-down-or-stalled      # the filename stem (the index key)
symptom: "seats idle with queued work; no serve process; log stops"
writes: true                         # does this procedure open a writing Harness?
precondition: "broker-stopped"       # "broker-stopped" | "read-only" | "none"
last_verified: 2026-10-16            # the date its Verify step last actually ran
verified_by: delegate
evidence: "items 54,66,68"           # the item(s)/commit(s) that proved it
check_rule: null                     # optional: the check rule that re-tests it
---
```

A runbook whose `Verify` has **never** run carries `last_verified: unverified` (see the marker below);
`check` (items 81/82) flags it rather than treating it as green.

## Conventions

1. **One situation per file**, named for the symptom a person would type: `broker-down-or-stalled.md`,
   not `troubleshooting.md`. The filename is the index key and is mirrored in `symptom:`.
2. **Fixed skeleton** (see `_template.md`): `When to use` / `Impact` / `Preconditions` / `Diagnose
   (read-only)` / `Do` / `Verify` / `If it fails` / `Escalate to` / `Evidence`.
3. **Commands are literal.** No pseudo-commands; a step is either a real command or prose explicitly
   marked `[judgement]`. Windows only (`node cli.mjs`), never `wsl`/`docker`.
4. **Stop before write.** A writing step names the stop-and-verify that precedes it. A runbook that needs
   the broker up only reads.
5. **Idempotent or explicitly one-shot.** A destructive step says which it is. Reuse `--request-id` /
   the inbox `requestId` where a retry is possible.
6. **Verified, not assumed.** A runbook is done when its `Verify` step has actually run; then record
   `last_verified` + evidence. Otherwise `last_verified: unverified`. **This set is currently largely
   unverified.**
7. **Small and stable.** Link out to the design doc; move any growing `Background` to the design doc.
8. **Ownership.** The delegate owns operator-surface runbooks; the team owns seat-runbooks; `scribe`
   keeps them true to the code like any other doc.

## Maintenance policy (from the research report)

- **Re-verify on trigger, not calendar:** re-run `Verify` when (a) an incident touched the procedure,
  (b) a file the runbook names changes, or (c) a `check` rule it references changes. (Calendar cadence is
  the published norm; trigger-based is our design choice — see the report §2.2.)
- **A failed runbook files a ticket immediately** — "inaccurate runbooks are treated like failed tests".
- **Enforcement (ROADMAP 81/82):** `check` rule `runbook-stale` (`error`) if `last_verified` is old
  *and* a named file changed since; `runbook-unverified` (`fix-now`) if `Verify` never ran.
- **Verification recording:** the `check` provenance line reports "runbooks verified against rev X"
  (ROADMAP 86).

## Agent execution (from the research report)

- **Structured header, prose body.** Machine-readable `precondition`; steps stay literal prose/commands.
- **The precondition is enforced in code, not prose** (ROADMAP 69): `up`/`reset`/`resume`/`send` must
  refuse while a broker is alive or a `serve --stop` did not return `stopped:true`. The runbook sentence
  is a comment on a guard that actually holds.
- **Do not build an executable runbook DSL yet.** The evidence (SOPBench) shows a paging runtime helps
  strong models but **harms weak ones** (59:237); it must be capability-gated and per-model checked
  (ROADMAP 87).
- **A `--dry-run`** for `up --refresh`/`reset` would let a seat review the diff before writing
  (ROADMAP 84).

## Anti-patterns (do not)

| Anti-pattern | Why it fails |
|---|---|
| Stale / describes a system that no longer exists | Sends the reader down dead ends; rot is a failing test |
| Multiple copies | One canonical, version-controlled file, linked from the alert |
| Prose pseudo-commands | Cannot be copy-pasted or executed |
| Hidden state | The reader cannot tell what the procedure assumes |
| No rollback | Leaves a half-applied write |
| **Precondition as prose only** | **The exact 2026-10-16 failure** — enforced in code instead |
| Too long / duplicates the design doc | Move background to the design doc |
| Untested steps | Treat inaccuracy as a failing test |
| More scaffolding than the executor can hold | Weak models lose under active-frame guidance |

## Index (symptom)

| Runbook | Use when | Writes? |
|---|---|---|
| [broker-down-or-stalled.md](broker-down-or-stalled.md) | seats idle with queued work; no `serve` process; log stops | yes |
| [broker-safe-change.md](broker-safe-change.md) | a model/constitution/reset change must apply without corrupting the store | yes |
| [store-corruption-recovery.md](store-corruption-recovery.md) | every write verb fails with `Session failed after a storage error` | yes |
| [seat-reset.md](seat-reset.md) | a seat is degenerate / looping / answering in the wrong language | yes |
| [degeneration-guard.md](degeneration-guard.md) | a seat was auto-reset (`pi.reset` naming `degenerate-text=...`); tell a real loop from a false positive, or add a shape | no |
| [leaked-worktrees.md](leaked-worktrees.md) | `git status`/`git worktree list` shows stray `item-*` | maybe |
| [daemon-not-running.md](daemon-not-running.md) | the host daemon is down (items 61–64; pre-written) | yes |
| [research-request.md](research-request.md) | you need external research | no |

## Index (mechanism)

| Mechanism | Runbook(s) |
|---|---|
| Broker / `serve` | broker-down-or-stalled, broker-safe-change |
| Store / `pi.live` | store-corruption-recovery |
| Seats | seat-reset |
| Worktrees | leaked-worktrees |
| Daemon / host | daemon-not-running |
| Research | research-request |

## Template

New runbooks start from [`_template.md`](_template.md). Proposed machinery: ROADMAP items **81–88**
(`runbook-stale`/`runbook-unverified` check rules, mandatory front-matter, the hard write guard, a
`--dry-run`, executable `Diagnose` blocks, verification provenance, a gated agent runtime, the daemon
runbook).
