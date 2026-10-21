# durian-pi runbooks (SOPs)

**Status:** working set. Audience: the **delegate** (operator-facing) and **seats** (a seat reads a
runbook when woken into a situation it does not own). A runbook is an operating procedure, not a design
doc: the design lives in `BROKER-ARCHITECTURE.md` / `BROKER-SUPERVISION.md` /
`COMMANDS-AND-THE-BROKER.md`; this directory is *what to do*.

**Reviewed against research:** `docs/reviews/runbooks-sop-best-practices.md`. The merge/conflict procedure
(`merge.md`, `resolve-merge-conflict.md`) additionally incorporates `docs/reviews/llm-prompting-for-git-merging.md`
(deterministic-first, per-hunk resolution with abstention, 3-way context). durian-pi's skeleton already
matched published practice; the research's real finding is that the missing part is **machinery** â€”
nothing enforces the conventions or detects rot, and the one guardrail that matters (never proceed on a
false `stopped` signal) is prose, which failed twice on 2026-10-16. The conventions below incorporate
that report; the machinery is ROADMAP items **81â€“88**.

## The one rule that shapes every runbook: single writer

The broker owns the store; a second `Harness`-opening verb while it runs is what corrupted the store
twice. Every writing procedure starts by **stopping the broker and confirming it exited**, and every
read-only procedure says so. See `COMMANDS-AND-THE-BROKER.md` Â§4.

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

## Topic docs — the map behind the procedures

Runbooks are *steps for one situation*. **Topic docs are the *model* of a functional area** — the
artifacts, their lifecycle, and which source is authoritative for each question — so a maintainer does
not have to reassemble that model from three runbooks and the code. They live at the `docs/` root, named
for the topic (`SEAT-LIFECYCLE.md`, `WORKFLOWS.md`, `BRANCH-AND-WORKTREE-LIFECYCLE.md`), and each carries
a **`How to re-verify this document`** section: literal commands whose output is the claim's proof.

| Topic doc | Covers | Runbooks it underlies |
|---|---|---|
| [../BRANCH-AND-WORKTREE-LIFECYCLE.md](../BRANCH-AND-WORKTREE-LIFECYCLE.md) | refs, worktrees, landing gates, prune paths, the store/rig pair, suite-verdict traps | land, branch-cleanup, leaked-worktrees, merge |
| [../SEAT-LIFECYCLE.md](../SEAT-LIFECYCLE.md) | a seat from create to retire | seat-reset, compact-a-seat, degeneration-guard |
| [../WORK-ITEM-LIFECYCLE.md](../WORK-ITEM-LIFECYCLE.md) | queue states and transitions, who may move an item, what wakes a seat, what is surfaced, why work gets stuck | stale-held-backlog, resume-while-broker-runs |

**Rule for a topic doc:** a claim without a command that proves it is not allowed — mark it `UNVERIFIED`
or drop it. That is what makes the doc audit-able instead of merely plausible.

**Periodic verification (the contract).** A verifier re-runs `How to re-verify this document`, then
bumps `last_verified` / `verified_by` / `evidence` in the header and fixes any claim the commands
contradict. The **claim** is wrong when they disagree — never "fix" the rig to match the doc.

> **CAVEAT — this is manual today.** The `runbook-stale`, `runbook-unverified` and
> `runbook-front-matter` rules EXIST in `src/checkup.mjs` but `cli.mjs` never passes a `runbooks`
> collection into `auditRig`, so `check` reports all three as `skipped — no runbook data was supplied`.
> Nothing automatically verifies runbooks OR topic docs yet; that wiring is the gap (routed to `pm`).
> Related false positive a verifier must know: `runbookFrontMatterProblems` expects TYPED front-matter
> (`writes` as a boolean), so a naive YAML parse of the files reports `writes: must be true or false` for
> **every** runbook — including all the pre-existing ones.

## Maintenance policy (from the research report)

- **Re-verify on trigger, not calendar:** re-run `Verify` when (a) an incident touched the procedure,
  (b) a file the runbook names changes, or (c) a `check` rule it references changes. (Calendar cadence is
  the published norm; trigger-based is our design choice â€” see the report Â§2.2.)
- **A failed runbook files a ticket immediately** â€” "inaccurate runbooks are treated like failed tests".
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
| **Precondition as prose only** | **The exact 2026-10-16 failure** â€” enforced in code instead |
| Too long / duplicates the design doc | Move background to the design doc |
| Untested steps | Treat inaccuracy as a failing test |
| More scaffolding than the executor can hold | Weak models lose under active-frame guidance |

## Index (symptom)

| Runbook | Use when | Writes? |
|---|---|---|
| [broker-down-or-stalled.md](broker-down-or-stalled.md) | seats idle with queued work; no `serve` process, or a fresh heartbeat with a stale `PASS` (dormant); log stops after a storage error or `database is locked` | yes |
| [broker-safe-change.md](broker-safe-change.md) | a model/constitution/reset change must apply without corrupting the store | yes |
| [store-corruption-recovery.md](store-corruption-recovery.md) | every write verb fails with `Session failed after a storage error`, or the broker repeats `wake-failed â€¦ unresolvable path` and one seat is never woken | yes |
| [store-secret-detected.md](store-secret-detected.md) | a `secret_detected` notice: secret-shaped content is in the committed store | no |
| [tool-result-redacted.md](tool-result-redacted.md) | a tool result shows a `[redacted by durian-pi: â€¦]` marker instead of its text | no |
| [constitution-amendment.md](constitution-amendment.md) | you edited (or will edit) `constitution.txt`, or the 3 constitution-mirror demos fail their starter === constitution.txt assertion | no |
| [seat-reset.md](seat-reset.md) | a seat is degenerate / looping / answering in the wrong language / emitting a tool call as text | yes |
| [write-corruption-recovery.md](write-corruption-recovery.md) | a `write` was refused as a one-line collapse, or a source file was silently collapsed to one line | maybe |
| [compact-a-seat.md](compact-a-seat.md) | a seat's context is saturated and a reset would lose durable context | yes |
| [format-before-commit.md](format-before-commit.md) | my diff shows whitespace or line-ending churn I did not intend | no |
| [degeneration-guard.md](degeneration-guard.md) | a seat was auto-reset (`pi.reset` naming `degenerate-text=...`); tell a real loop from a false positive, or add a shape | no |
| [leaked-worktrees.md](leaked-worktrees.md) | `git status`/`git worktree list` shows stray `item-*` | maybe |
| [tracked-files-missing-on-disk.md](tracked-files-missing-on-disk.md) | `git status` shows tracked DELETIONS nobody made; a whole directory (e.g. `scripts/`) is empty on disk while the index and `HEAD` still hold it | no |
| [stale-held-backlog.md](stale-held-backlog.md) | an effort has stalled with nothing broken; `held` rows are never released after their gates finish and no attention fires | no |
| [leaked-secret.md](leaked-secret.md) | an API key/token/private key/password sits in a commit, log, or the store | no |
| [prepare-workspace-etarget.md](prepare-workspace-etarget.md) | `prepare_workspace` fails: `npm ci --prefer-offline ... ETARGET notarget` for an `@earendil-works/*` pin | no |
| [prepare-workspace-refused.md](prepare-workspace-refused.md) | `prepare_workspace` returned `PREPARE_WORKSPACE_ERROR`, or refused: leftover dir, a branch another worktree holds, or a `base=` the item branch cannot honour | no |
| [security-trust-boundary-review.md](security-trust-boundary-review.md) | a dependency/execution surface/egress/write path/boundary is about to land â€” run the review method before the code | no |
| [merge.md](merge.md) | a completed branch is not on `main`, or you are about to land one | no |
| [branch-cleanup.md](branch-cleanup.md) | so many local git branches; merged branches were never pruned | no |
| [land.md](land.md) | a verified branch must go onto `main`; land it with the helper (never mid-merge) | no |
| [resolve-merge-conflict.md](resolve-merge-conflict.md) | a merge/landing pass stopped with conflict markers; the tree is mid-merge | no |
| [daemon-not-running.md](daemon-not-running.md) | the host daemon is down (items 61â€“64; pre-written) | yes |
| [local-provider-down.md](local-provider-down.md) | a `local/<id>` seat (`qa`/`devtools`) fails with `Connection error.` or `No API key for provider: local`; nothing listens on `127.0.0.1:8080` | no |
| [research-request.md](research-request.md) | you need external research | no |
| [competitor-review.md](competitor-review.md) | you want to learn from another project's tools/practices | no |
| [resume-while-broker-runs.md](resume-while-broker-runs.md) | you want to run `resume`/`doctor` but the broker is up | no |
| [request-trace.md](request-trace.md) | you need the ACTUAL request body durig sends (thinking / reasoning_effort / max_tokens / store), not the programmed config | no |
| [verifier-independence.md](verifier-independence.md) | a verifier wants to edit the artefact it is verifying, or is about to report an `artifact`/SHA it did not run — a verifier's only write is a report | no |

## Index (mechanism)

| Mechanism | Runbook(s) |
|---|---|
| Broker / `serve` | broker-down-or-stalled, broker-safe-change |
| Store / `pi.live` | store-corruption-recovery, store-secret-detected |
| Tool results | tool-result-redacted |
| Seats | seat-reset, compact-a-seat |
| Write guard / source files | write-corruption-recovery |
| Constitution / starter mirror | constitution-amendment |
| Worktrees | leaked-worktrees, prepare-workspace-etarget, prepare-workspace-refused |
| Missing files on disk | tracked-files-missing-on-disk |
| Stranded submissions / settle | resume-while-broker-runs, broker-down-or-stalled |
| Queue / parked work | stale-held-backlog |
| Credentials / secrets | leaked-secret |
| Review method | security-trust-boundary-review |
| Verification / verifier independence | verifier-independence |
| Merge / conflicts | merge, land, resolve-merge-conflict, branch-cleanup |
| Daemon / host | daemon-not-running |
| Local provider (PolyStrata) | local-provider-down, broker-down-or-stalled |
| Provider request body | request-trace |
| Research | research-request, competitor-review |

## Template

New runbooks start from [`_template.md`](_template.md). Proposed machinery: ROADMAP items **81â€“88**
(`runbook-stale`/`runbook-unverified` check rules, mandatory front-matter, the hard write guard, a
`--dry-run`, executable `Diagnose` blocks, verification provenance, a gated agent runtime, the daemon
runbook).
