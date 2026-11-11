# durian-pi runbooks (SOPs)

**Status:** working set. Audience: the **delegate** (operator-facing) and **seats** (a seat reads a
runbook when woken into a situation it does not own). A runbook is an operating procedure, not a design
doc: the design lives in `BROKER-ARCHITECTURE.md` / `BROKER-SUPERVISION.md` /
`COMMANDS-AND-THE-BROKER.md`; this directory is *what to do*.

**Reviewed against research:** `docs/reviews/runbooks-sop-best-practices.md`. The merge/conflict procedure
(`merge.md`, `resolve-merge-conflict.md`) additionally incorporates `docs/reviews/llm-prompting-for-git-merging.md`
(deterministic-first, per-hunk resolution with abstention, 3-way context). durian-pi's skeleton already
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
| [../DISPOSITIONS.md](../DISPOSITIONS.md) | branch dispositions (decisions, not existence), the probe method, the append-only rule | branch-cleanup, land |
| [../WORK-ITEM-LIFECYCLE.md](../WORK-ITEM-LIFECYCLE.md) | queue states and transitions, who may move an item, what wakes a seat, what is surfaced, why work gets stuck | stale-held-backlog, resume-while-broker-runs |
| [run-your-area.md](run-your-area.md) | which tests do I run before landing? the demo suite is 238 files — and **for a doc-only edit, `node tools/what-to-test.mjs` derives the guards from the diff (15 tests / 11.8 s measured) instead of the full gate** | no |

**Rule for a topic doc:** a claim without a command that proves it is not allowed — mark it `UNVERIFIED`
or drop it. That is what makes the doc audit-able instead of merely plausible.

**Periodic verification (the contract).** A verifier re-runs `How to re-verify this document`, then
bumps `last_verified` / `verified_by` / `evidence` in the header and fixes any claim the commands
contradict. The **claim** is wrong when they disagree — never "fix" the rig to match the doc.

> **CAVEAT — this is manual today.** The `runbook-stale`, `runbook-unverified` and
> `runbook-front-matter` rules EXIST in `src/checkup.mjs` but `cli.mjs` never passes a `runbooks`
> collection into `auditRig`, so `check` reports all three as **`UNKNOWN (not judged) — no runbook data
> was supplied`** (#5767). **UNKNOWN is not a pass and not a skip**: a skip means the rule looked at a
> structure that legitimately does not exist (e.g. a rig with no `ownership` block); UNKNOWN means nothing
> was judged at all, so it must never be read as clean. Measured on the live rig: `node cli.mjs check
> /home/chexxor/Git/Durian-Pi/rig.json --db /home/chexxor/Git/Durian-Pi/selfdev.sqlite` -> exit 0, the
> render line reads `3 UNKNOWN (not judged)`, and each of the three rules prints its reason. Supplying
> runbook data flips them to `pass`/`fail` — `demo/runbook-rules.test.mjs` §5b asserts the two renders
> differ, so the distinction is testable and not a rename. Nothing automatically verifies runbooks OR
> topic docs yet; that wiring is the gap (routed to `pm`).
> Related false positive a verifier must know: `runbookFrontMatterProblems` expects TYPED front-matter
> (`writes` as a boolean), so a naive YAML parse of the files reports `writes: must be true or false` for
> **every** runbook — including all the pre-existing ones.

## Maintenance policy (from the research report)

- **Re-verify on trigger, not calendar:** re-run `Verify` when (a) an incident touched the procedure,
  (b) a file the runbook names changes, or (c) a `check` rule it references changes. (Calendar cadence is
  the published norm; trigger-based is our design choice — see the report §2.2.)
- **A failed runbook files a ticket immediately** — "inaccurate runbooks are treated like failed tests".
- **Enforcement (ROADMAP 81/82):** `check` rule `runbook-stale` (`error`) if `last_verified` is old
  *and* a named file changed since; `runbook-unverified` (`fix-now`) if `Verify` never ran.
- **Verification recording:** the `check` provenance line reports "runbooks verified against rev X"
  (ROADMAP 86).
- **Env-name fidelity (#5911, swept 2026-11-10 on tree `f192f543`):** every command in these runbooks must name
  the variable **the entry point it invokes actually reads**. Measured in that tree: `cli.mjs` (`cli.mjs:155`),
  `intent.mjs` (`intent.mjs:105`) and `scripts/land.mjs` (`scripts/land.mjs:248`) read `DURIG_DB`; 
  `scripts/clockin.mjs:379` is the only entry point that accepts `DURIAN_PI_DB`, and it takes it first. A command
  carrying a name the entry point ignores is not a typo - it silently runs against the fallback store, which is how
  a wrong store gets read as a quiet rig. 31 command lines across 14 runbooks were corrected in that sweep; the
  machine-side surfacing is `tools/broker-serve.mjs:153` (`legacy-env-set`), and ROADMAP 191 is the un-built
  single-alias resolver that would remove the discrepancy at the source. **And name the store in every line:**
  `durig.config.json` is gitignored (`.gitignore:12`) so it exists only in the shared root - measured in an item
  worktree, a bare `node cli.mjs status` falls back to `./rig.sqlite` (`durig.config.default.json:2`), not to the
  rig the operator meant.

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
| A command naming an env the entry point does not read | It runs, but against the fallback store - the procedure is silently about the wrong file (#5911) |
| Hidden state | The reader cannot tell what the procedure assumes |
| No rollback | Leaves a half-applied write |
| **Precondition as prose only** | **The exact 2026-10-16 failure** — enforced in code instead |
| Too long / duplicates the design doc | Move background to the design doc |
| Untested steps | Treat inaccuracy as a failing test |
| More scaffolding than the executor can hold | Weak models lose under active-frame guidance |

## Index (symptom)

| Runbook | Use when | Writes? |
|---|---|---|
| [slow-loop.md](slow-loop.md) | a change takes minutes-to-hours to verify; one test or area dominates wall-clock; a test is red **only** because it needs a key/network/a model; you are about to run the whole suite "to be safe"; or you are reviewing a design and need to state what it costs to iterate on it (the operator's fast-iteration policy, D213 — measured here: full suite **257/258 in 57.0 s**, `demo/cli.test.mjs` alone **20.1 s**, `demo/offline.mjs` full delegation loop **0.301 s**, model-call **p50 52 ms / p95 9.0 s**, and **185 generations (0.29%) holding 64.6% of generation busy time**) | no |
| [suite-red-standalone-green.md](suite-red-standalone-green.md) | a demo exits 0 alone but the suite prints `FAIL` or `TIMEOUT` for it; a red appears only while another suite run or a seat turn is live; the report's 8-line tail shows `signal: null, output: null` and no cause (measured 2026-11-10: one-file fixture reproduces the false TIMEOUT — demo exit 0, runner 60.1 s, exit 1; two concurrent `--all` runs drive `SwapFree` to 0 kB and manufacture one extra red) |
| [in-turn-read-hangs.md](in-turn-read-hangs.md) | a seat's turn hangs on `cli.mjs queue` / `status` / `scripts/clockin.mjs`; a broker window overruns its `--max-duration` bound while the log stops mid-pass; the read never returns and you cannot tell "the drain is stalled" from "the store is broken" | no |
| [session-start-cost.md](session-start-cost.md) | a session is spending its first 30–60 minutes re-deriving rig state an instrument already prints; you are about to hand-query `selfdev.sqlite`; or you are deciding how many seats to wake (each wake is the expensive verb, and a failed one deposits rows) | no |
| [workspace-move.md](workspace-move.md) | the rig's workspace moved machines or operating systems (fresh clone/copy, Linux box for a Windows rig, new user) — worktree registrations, seat cwds, the pin's links, or queue-cited commit shas do not resolve | yes |
| [cross-clone-object-recovery.md](cross-clone-object-recovery.md) | a cited commit sha resolves in no object store here; the workspace arrived from another machine/OS and the history did not travel; `git fsck --unreachable` reports commits anchored by no ref (urgent — `git gc` deletes them) | yes (`.git` only, never the store) |
| [verifier-model-server.md](verifier-model-server.md) | a seat's model is not what `rig.selfdev.json` claims; the model server lists an instance that no request can use (`Failed to load model`); you must change which model a provider serves, its context window, or free RAM for a second model; `check` reports `single-model-rig`; **or the GPUs are full and you want the metered arm instead** (price-first arming order, the exposure-vs-store-cap trap, the pair of pointer instruments that must move together) | yes (server only, not the store) |
| [verifier-model-server.md](verifier-model-server.md) §Activating a downloaded quantization (variant) without the GUI | a model download finished and the variant is in the catalog but **nothing can start it** (`variant`/`quantization`/`selected_variant` → `Unrecognized key(s)`; `lms load "model@q4_k_m"` → `Model not found`); or you need to know **which `.gguf` is actually live** (the API never says — the `llama-server --model` path does); or `unload` returns `missing_required_parameter` | yes (server only; the move is a reversible rename, and **ask first** — it changes what every seat's verifier model *is* while the model key stays identical) |
| [verifier-model-server.md](verifier-model-server.md) §A seat suddenly reports `metered-endpoint-unkeyed` | a family goes dark after an **operator credential rotation**: a verb prints `registration-refused … "causes":["metered-endpoint-unkeyed"]`, or seats on `verifier/…` fail **`no_model` before any request**. It is the **gitignored host config** (`$HOME/.config/durig/env`, plus the repo-root and seat-root `durig.config.json`) that lost the new key, or the verb was run without `--env-file=` — **it is NOT a roster fault and NOT a model/capacity fault**, and a roster edit cannot fix it. Check presence by COUNT (`grep -c -E '^DURIG_VERIFIER_API_KEY='`), and read the probe's `keyPresentInEnv` **field**, not its verdict: measured 2026-11-06 the arm probe says `ARMABLE` / **exit 0** with the key blanked | no |
| [verifier-leg-unfunded.md](verifier-leg-unfunded.md) | an auditor / `verifier/…` seat settles `unanswered` with `settledReason: "no_model"` in under a second and **zero tokens** — the verifier leg is **unfunded by operator ruling** (`DURIG_VERIFIER_API_KEY` deliberately unset), which is the HONEST state, not a bug to route around; the row includes the table that separates this from the credential-rotation case above, and the routing rule: send the verification to a funded seat (`qa`/`qa2`), never fabricate a verifier, never report a verification as done without evidence | no |
| [hygiene-and-dead-model-pointers.md](hygiene-and-dead-model-pointers.md) | a seat's shell call dies as `spawn powershell ENOENT` / `spawn pwsh ENOENT` (Windows shape: `spawn powershell.exe ENOENT`) and you need to know whether the HOST, the registration or the guard is at fault; a seat reports a test or a `git` command it never ran; `seat-shell-availability` blocks a start; a model swap left seats pointing at a model no loaded instance serves while `single-model-rig` still passes; you are asked whether seat hygiene is acceptable and the evidence is prose (measured here 2026-10-29: `bash` **0** entries, `powershell` 20,340 — hygiene is **unmeasured**, not good. The empty-tool-output/`result=null` shape named in an earlier draft of this row is **not present in this store** — 0 rows) | no |
| [git-form-refusal.md](git-form-refusal.md) | a seat's `git <verb>` dies with ``was NOT checked by this guard``, or a `git config` write dies naming `$HOME/.gitconfig` / `/etc/gitconfig` / `config.worktree`; you need to tell a **named** refusal (the guard looked, and refuses: shared-object-DB maintenance, plumbing that bypasses `git commit`, credential subsystem, interactive UI, foreign VCS) from an **unchecked** one, and you want the claim lists rather than a guess |
| [verifier-serving-headroom.md](verifier-serving-headroom.md) | a seat or verifier turn settles `unanswered` with reason `model_error` and the `check` notice carries **no cause** — the cause is the submission record's **`detail`** field (Step 0: `json_extract(record,'$.detail')`; there is no `detail` COLUMN), and 3 of the 4 measured cases were **compaction** casualties, not shape; a verifier turn dies at `stopReason=length` mid-review; a provider answers a tiny probe but refuses a real request; a turn fails in **~30 ms with ZERO tokens generated** (a strict-template refusal on the **verifier** engine — this rig's seat model accepted two consecutive `user` turns, measured 2026-11-05, so a shape read never explains a dead seat by itself); or you are about to spend GPU capacity on a model slot and need its KV cost (Step 2-4 are **HISTORICAL**: the verifier is a hosted endpoint now) | no |
| [docs-encoding-mojibake.md](docs-encoding-mojibake.md) | an em dash, section sign, ellipsis or arrow in a doc, a rig spec or a seat instruction reads as garbage, or a file shows a change you did not make | yes |
| [delegate-doc-hygiene.md](delegate-doc-hygiene.md) | an edit reported success but the text is not in the file; the NEXT pointer went red on its 200-line cap or its archive proof; a citation check flags findings you did not make; you quoted a commit sha that turns out not to exist; a `cat >> … <<'EOF'` ate its own body; **a roadmap or spec row quotes a number and nobody can tell whether it was measured or merely proposed** (INTENDED vs RESOLVED, #6077/#6080) | no |
| [decision-ledger-collisions.md](decision-ledger-collisions.md) | the decisions ledger reads green but two entries share one `D`-number, a heading still says `## D###`, the same ruling appears twice, or a `DECISIONS.md:<line>` pin lands on the wrong entry (measured 2026-11-11 on main: 13 colliding numbers, 8 placeholder headings, `doc-integrity-guard` exit 0 on all of it) | no |
| [broker-down-or-stalled.md](broker-down-or-stalled.md) | seats idle with queued work; no `serve` process, or a fresh heartbeat with a stale `PASS` (dormant); log stops after a storage error or `database is locked`; **or `cli.mjs status`/`queue` time out with `read health: timed out awaiting the broker's result` while a direct read of the store answers in milliseconds — the deadline linger, ROADMAP 303**; or a read verb HANGS to exit 124 with zero output while the store answers directly (#5663, section "Reads when the broker is gone or dark") | yes |
| [broker-safe-change.md](broker-safe-change.md) | a model/constitution/reset change must apply without corrupting the store | yes |
| [broker-down-or-stalled.md](broker-down-or-stalled.md) §2026-11-08 | `cli.mjs queue`/`status` return **nothing at all** (exit 124, 0 bytes, no error line) while a direct read of the store answers in milliseconds — the read verb blocks on the broker's stalled pass loop instead of failing; `genlock` is empty yet generations are still being created | no (read-only diagnose; the `Do` steps are unchanged) |

| [store-corruption-recovery.md](store-corruption-recovery.md) | every write verb fails with `Session failed after a storage error`, or the broker repeats `wake-failed … unresolvable path` and one seat is never woken | yes |
| [store-secret-detected.md](store-secret-detected.md) | a `secret_detected` notice: secret-shaped content is in the committed store | no |
| [tool-result-redacted.md](tool-result-redacted.md) | a tool result shows a `[redacted by durian-pi: …]` marker instead of its text | no |
| [store-probe-identity.md](store-probe-identity.md) | you are querying the store directly for a QUEUE item id, or a probe returned a plausible row whose namespace you have not checked | no |
| [pi-pin-update.md](pi-pin-update.md) | the pinned pi must move (an ordered update, or a release we skipped); a fresh worktree refuses the live store with `Durable SQLite schema version 2 is newer than supported version 1`; or a `git grep` over `vendor/pi-main` returned **0 hits** and you are about to conclude something is absent upstream. **A backup is the only rollback — `sync-pi --unlink` cannot open our schema-v2 store** | yes (the pin, the vendored build, `node_modules`; the store only via the backup/restore ladder) |

| [constitution-amendment.md](constitution-amendment.md) | you edited (or will edit) `constitution.txt`, or the 3 constitution-mirror demos fail their starter === constitution.txt assertion | no |
| [seat-reset.md](seat-reset.md) | a seat is degenerate / looping / answering in the wrong language / emitting a tool call as text | yes |
| [compaction-eval.md](compaction-eval.md) | a compaction threshold needs a MEASUREMENT: the compacted-vs-full delta or a model’s real window | no |
| [write-corruption-recovery.md](write-corruption-recovery.md) | a `write` was refused as a one-line collapse, or a source file was silently collapsed to one line | maybe |
| [compact-a-seat.md](compact-a-seat.md) | a seat's context is saturated and a reset would lose durable context | yes |
| [harness-compaction-guard.md](harness-compaction-guard.md) | `Auto-compaction failed: Summarization failed: generation hit the token cap and the summary is incomplete` in the delegate/interactive session | no |
| [continuation-notes.md](continuation-notes.md) | a seat cannot finish its item inside one context window; compaction summaries come back truncated ("Summarization hit the token limit") or are refused by the run cap before a request is sent; a seat woken into a fresh context starts from nothing; `cli.mjs status` returns tens of megabytes | yes (config edit; the diagnosis is read-only) |
| [compaction-acceptance-measure.md](compaction-acceptance-measure.md) | "truncated summaries dropped to zero" needs a number and a falsifier; the 100-compaction driver reports `0 markers placed`; a live tranche stalls at ~30 minutes and exits 1 | no |
| [milestone-gate.md](milestone-gate.md) | a milestone is claimed done and nobody can say what is left; ROADMAP §Milestones says ⏳ next and the only evidence is prose; an enforcement change landed and you need to know whether it closed the gap or moved it | no |
| [context-over-window.md](context-over-window.md) | a seat shows a `context_over_window` notice or `check` reports `context-over-window`; the `ctx` fraction prints over 1.0 and you need to know whether that number describes the seat's current head or a turn that already ended | no |
| [format-before-commit.md](format-before-commit.md) | my diff shows whitespace or line-ending churn I did not intend | no |
| [degeneration-guard.md](degeneration-guard.md) | a seat was auto-reset (`pi.reset` naming `degenerate-text=...`); tell a real loop from a false positive, or add a shape | no |
| [leaked-worktrees.md](leaked-worktrees.md) | `git status`/`git worktree list` shows stray `item-*` | maybe |
| [tracked-files-missing-on-disk.md](tracked-files-missing-on-disk.md) | `git status` shows tracked DELETIONS nobody made; a whole directory (e.g. `scripts/`) is empty on disk while the index and `HEAD` still hold it | no |
| [stale-held-backlog.md](stale-held-backlog.md) | an effort has stalled with nothing broken; `held` rows are never released after their gates finish and no attention fires | no |
| [stale-held-backlog.md](stale-held-backlog.md) §Umbrella rows are pointers, never gates | **a row can never be claimed** and the scan says `gate-cancelled:#<id>`; a dependent is stuck on a container row that was cancelled; you are about to `cancel_work` an umbrella whose children are all registered | no |
| [stale-held-backlog.md](stale-held-backlog.md) §If it fails | the parked-row audit refuses the store — `cannot open …: Durable SQLite schema version 2 is newer than supported version 1` — or the read times out, and you must separate a dependency/pin gap from a wedged broker before touching anything | no |
| [block-shape-refused.md](block-shape-refused.md) | a `send_work` carrying `block` dies naming a remedy (`may only carry queue constraints` / `must look like RM-<n>` / `reviewBy is mandatory for reason …`); you are parking a row and need the **reason → constraint-kind pairing** (`dependency` carries ONLY `queue` gates; a roadmap gate is `roadmap-gate` + an `RM-<n>` ref); or a batch of sends landed except one and you need to know that a refused send writes NOTHING and must be re-sent whole | no |
| [attach-a-gate.md](attach-a-gate.md) | you know a row must wait on another row, but you are neither its sender nor its recipient, and every way of writing that gate is refused or silently dropped (`revise_work` with `blockedBy` drops the whole call, including the body edit riding in it) | no |
| [intent-stuck-in-inbox.md](intent-stuck-in-inbox.md) | a spooled intent never lands; the pass reports `dead=N` but the payload is still in `<db>.broker.inbox`; a command vanishes with no verdict and no diagnostic | no |
| [leaked-secret.md](leaked-secret.md) | an API key/token/private key/password sits in a commit, log, or the store | no |
| [prepare-workspace-etarget.md](prepare-workspace-etarget.md) | `prepare_workspace` fails: `npm ci --prefer-offline ... ETARGET notarget` for an `@earendil-works/*` pin | no |
| [security-trust-boundary-review.md](security-trust-boundary-review.md) | a dependency/execution surface/egress/write path/boundary is about to land — run the review method before the code | no |
| [worktree-unlinked-deps.md](worktree-unlinked-deps.md) | `prepare_workspace` reports `DEPENDENCY NOT LINKED`, or a fresh worktree's suite fails demos that pass in the seat root | no |
| [prepare-workspace-refused.md](prepare-workspace-refused.md) | `prepare_workspace` returned `PREPARE_WORKSPACE_ERROR`, or refused: leftover dir, a branch another worktree holds, or a `base=` the item branch cannot honour | no |
| [merge.md](merge.md) | a completed branch is not on `main`, or you are about to land one | no |
| [branch-cleanup.md](branch-cleanup.md) | so many local git branches; merged branches were never pruned | no |
| [land.md](land.md) | a verified branch must go onto `main`; land it with the helper (never mid-merge) | no |
| [false-green-shell-prover.md](false-green-shell-prover.md) | a check you ran reported `exit 0` but you cannot say which command produced that 0; the same gate is reported as `1` somewhere else; your `Verify` block pipes the runner or reads `$?` after an intervening command (`git merge-base …; git log -1; echo $?`); or an `xargs … sh -c 'f="$1"'` suite loop prints `PASS ` with no filename — the item lands in `$0`, `$1` is empty, and `node ""` exits 0 | no |
| [resolve-merge-conflict.md](resolve-merge-conflict.md) | a merge/landing pass stopped with conflict markers; the tree is mid-merge | no |
| [daemon-not-running.md](daemon-not-running.md) | the host daemon is down (items 61–64; pre-written) | yes |
| [local-provider-down.md](local-provider-down.md) | a `local/<id>` seat (`qa`/`devtools`) fails with `Connection error.` or `No API key for provider: local`; nothing listens on `127.0.0.1:8080` | no |
| [research-request.md](research-request.md) | you need external research | no |
| [competitor-review.md](competitor-review.md) | you want to learn from another project's tools/practices | no |
| [resume-while-broker-runs.md](resume-while-broker-runs.md) | you want to run `resume`/`doctor` but the broker is up | no |
| [request-trace.md](request-trace.md) | you need the ACTUAL request body durig sends (thinking / reasoning_effort / max_tokens / store), not the programmed config | no |
| [per-row-marker.md](per-row-marker.md) | you must decide whether a held landing row's work actually landed on main, and choose a marker to probe for it — bare identifiers give false positives, whole added lines give false negatives | no |
| [spend-cap-tripped.md](spend-cap-tripped.md) | an item parks with reason `spend_cap_exceeded`; a seat or a probe refuses **before** sending with a cap, spent and projected number; a seat's compaction fails with `Summarization failed: spend_cap_exceeded` and the window never settles; you want to know where the store's money went and what is still unconfirmed | no |
| [verifier-independence.md](verifier-independence.md) | a verifier wants to edit the artefact it is verifying, or is about to report an `artifact`/SHA it did not run — a verifier's only write is a report; **or** a verify leg must state which kind of independence it has when author and verifier run the SAME model, and what a `local/` verifier re-point would break | no |
| [fleet-health-census.md](fleet-health-census.md) | you need a NUMBER for fleet failures and a TREND: "did compaction stop failing?", "which seat is producing them?" — counts that work while the broker is wedged | no |

## Index (mechanism)

| Mechanism | Runbook(s) |
|---|---|
| Broker / `serve` | broker-down-or-stalled, broker-safe-change |
| Store / `pi.live` | store-corruption-recovery, store-secret-detected, store-probe-identity |
| The suite gate reports a TIMEOUT for a demo that exited 0, or the failure report hides the cause | suite-red-standalone-green, slow-loop |
| Tool results | tool-result-redacted |
| Seats | seat-reset, compact-a-seat |
| A turn moved more tokens than the seat's window (`context_over_window`, `check` rule `context-over-window`), and whether that fraction is current at all | context-over-window, compact-a-seat, seat-reset, compaction-eval |
| Long-context eval | compaction-eval |
| Fleet outcome counts and failure families (generations, compaction), counted from the store without the broker | fleet-health-census |
| A verifier turn truncated at `length`, or refused in ~30 ms with zero tokens; KV cost and which GPU a model slot really owns | verifier-serving-headroom, compact-a-seat, hygiene-and-dead-model-pointers |
| A seat settles `unanswered` with `reason: model_error` and the attention notice names **no cause**; the submission's `detail` reads `Compaction failed: Summarization hit the token limit; the summary is incomplete` | verifier-serving-headroom (Step 0 + 0b: read the cause, then the headroom arithmetic), compact-a-seat, context-over-window, local-provider-down |
| Write guard / source files | write-corruption-recovery |
| Constitution / starter mirror | constitution-amendment |
| Worktrees | leaked-worktrees, prepare-workspace-etarget, worktree-unlinked-deps, prepare-workspace-refused |
| The pinned pi: the pin file, the vendored clone, tag-vs-tip policy, sparse-built packages, the schema-v2 lockout, and why a stale clone's 0 hits is not evidence — **and a seat whose live progress is coarser than it used to be, or whose tool results appear only after the commit lands (the seam emits at commit cadence, never per token)** | pi-pin-update, worktree-unlinked-deps, prepare-workspace-etarget, cross-clone-object-recovery |
| Git objects / shas cited from another machine | cross-clone-object-recovery, workspace-move |
| Which model/quantization a provider is actually serving (variant activation, unload-by-`instance_id`, model-server lifetime vs a live run) | verifier-model-server, model-server-broker-race |
| What a model call costs, where the money went, and what stops a call before it is sent (three cap axes, one ledger, locality of the endpoint) | spend-cap-tripped |
| Which model the rig NAMES vs which `.gguf` answers (dead pointer after a swap) | hygiene-and-dead-model-pointers, verifier-model-server |
| A strata/`local` endpoint answers `/v1/models` and `/health` (`loaded: true`) but the broker prints `BLOCK provider-local-completion-failed … timeout after 20s` and `START REFUSED` — the box is a single slot serving someone else at ~8 tok/s | local-provider-down (state 6), spend-cap-tripped |
| After a credential rotation the seats go dark though `status`/`check` are green — one `DURIG_LOCAL_API_KEY` arms one box, and the old key 401s on both | local-provider-down (state 7) |
| Many rows suddenly escalate to the human with reason `repeated_failure` while the seat's newest error is `401 … missing or wrong API key`; `SKIP <seat> reason=parked-deduped` with nothing to claim | local-provider-down (state 9, #6081: the class is `provider_auth` and it escalates nothing) |
| A woken seat dies `no_model` / `Model <provider>/<id> is not available` while `check` and the pointer demo are both green — the dead pointer is the **store's** per-conversation `pi.agent` pin (fix verb `up --refresh`, and it resets seat context) | hygiene-and-dead-model-pointers (Diagnose step 4, Do step 2b), seat-reset |
| A seat shell that cannot spawn on this host (217), and whether seat hygiene has ever been measured | hygiene-and-dead-model-pointers, workspace-move |
| A delegate-written file that was never committed | transcript-recovery (`tools/transcript-recovery.mjs`), tracked-files-missing-on-disk |
| Missing files on disk | tracked-files-missing-on-disk |
| Stranded submissions / settle | resume-while-broker-runs, broker-down-or-stalled |
| Queue / parked work | stale-held-backlog, block-shape-refused, attach-a-gate |
| An umbrella (container) row used as a `blockedBy` gate — `workable()`, `gate-cancelled`, `gate-open` | stale-held-backlog §Umbrella rows are pointers, never gates |
| The parked-row classifier (`tools/held-gate-audit.mjs`) cannot read the store: schema-version refusal vs broker timeout | stale-held-backlog §If it fails, pi-pin-update, worktree-unlinked-deps, broker-down-or-stalled |
| The broker receive path: what may enforce, who may write the audit sink, and a refused intent that never leaves the spool | intent-stuck-in-inbox, broker-down-or-stalled |
| Who may change a row: intent vs gate vs disposition, and the mint-only gate write path | attach-a-gate, stale-held-backlog |
| The structured park (`block`): reason → constraint-kind pairing, ref shapes (`#<id>` vs `RM-<n>` vs a `window` note), `reviewBy` defaults, and why a refused send does not half-land | block-shape-refused |
| Which reads are free and which verb is expensive; batching a brief; promoting a `.spike` probe into `tools/` | session-start-cost, verifier-serving-headroom, run-your-area |
| Credentials / secrets | leaked-secret |
| Review method | security-trust-boundary-review |
| Verification / verifier independence | verifier-independence |
| A verify leg on the same model as the author (which axes survive), and what a `local/` verifier re-point would make an instrument claim | verifier-independence, verifier-serving-headroom, hygiene-and-dead-model-pointers, local-provider-down |
| Merge / conflicts | merge, land, resolve-merge-conflict, branch-cleanup |
| Landing-row audit / per-row markers | per-row-marker |
| Daemon / host | daemon-not-running |
| Local provider (PolyStrata) | local-provider-down, broker-down-or-stalled |
| Provider request body | request-trace |
| Research | research-request, competitor-review |

## Template

New runbooks start from [`_template.md`](_template.md). Proposed machinery: ROADMAP items **81–88**
(`runbook-stale`/`runbook-unverified` check rules, mandatory front-matter, the hard write guard, a
`--dry-run`, executable `Diagnose` blocks, verification provenance, a gated agent runtime, the daemon
runbook).

