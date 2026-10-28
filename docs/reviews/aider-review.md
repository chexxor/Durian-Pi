> **D103 rename (2026-10-18):** this record predates the product rebrand `durig` → `durian-pi`; it keeps the old name so the audit trail stays truthful.

# Competitor review — Aider (`Aider-AI/aider`)

*Read 2026-10-17 by the delegate. Clone pinned at HEAD `5dc9490bb35f9729ef2c95d00a19ccd30c26339c`
(`vendor/eval/aider`, shallow). Method: `docs/runbooks/competitor-review.md`.*

> **Re-verified 2026-10-28 — the pin is the same commit, and this review is missing required artifacts.**
> The clone had been removed from this machine; re-cloning (`--depth 1`) produced **the same HEAD**, because
> aider is dormant at this commit: `node tools/vendor-pins.mjs --freshness` reports **`CURRENT`** —
> `5dc9490b` IS upstream HEAD (commit date 2026-05-22; latest remote tag `v0.86.3.dev`). So the old date means
> the **project** is quiet, not that our artifact is stale, and a delta re-review would have found nothing new in
> the tree. The pin is now in the tracked table (`docs/VENDOR-PINS.md`, generated; `--check` → PASS, 8 clones).
> **This review does not satisfy the runbook's Verify list**: it has no generated pin header, no surface-
> inventory table, no "not read" list, no standards/coverage matrix. That makes a *quality redo* the lawful mode,
> not a delta — and since the operator's 2026-10-28 question (file-editing tools) could be answered without a
> full redo, I answered it and registered the redo instead of quietly skipping it: **ROADMAP 214**. The editing
> findings, the two corrections below, and the missing artifacts are in
> **`docs/reviews/edit-machinery-2026-10-28.md`**.

## What it is
Aider is a terminal pair-programming agent: it edits a git repo from natural language, using a
**per-model edit format**, a **repository map** for context, and a **lint/test loop** that repairs its own
edits. Its docs live in-tree at `aider/website/docs/`; its edit-format implementations live in
`aider/coders/`. It is not a multi-agent/durable-queue system, so nothing here replaces durig's substrate —
the value is in its **edit-and-verify mechanics**, which are the same problem durig's seats face.

## Adoptable practices

| Practice | Evidence (path in the clone) | durig counterpart — adopt / adapt / reject |
|---|---|---|
| **Per-model edit format**, user-selectable (`--edit-format`; whole / diff / diff-fenced / udiff) | `aider/website/docs/more/edit-formats.md`; `troubleshooting/edit-errors.md` ("try whole", "try architect") | **Adopt**: durig has one exact-match `edit` tool for every model. Measure DeepSeek/GLM apply-rate per format (follow-up A1) and select per model. Ties to ROADMAP 90 (`format` verb) for the EOL half. |
| **High-level diffs** — ask for coherent code blocks, not surgical line edits. **Corrected claim:** the tree does not say "30–50% fewer editing errors" — it says GPT-4 Turbo scored **20% → 61%** and a June model **26% → 59%** on 89 python refactoring tasks when the format changed, with laziness reduced **3×** (12 tasks → 4) | `aider/website/docs/unified-diffs.md:36-45`; `git grep -i "9x\|30-50\|apply failur"` at this pin returns no such claim (audio asset names only) | **Adopt, weaker than before**: prompt/guide our seats to emit substantive blocks and return the applied diff. The *task pass-rate* claim is real; an *edit-error-rate* claim is not in the tree, and §4 of the 2026-10-28 review shows aider's own corpus going the other way on malformed output for diff-style formats. |
| **Bounded flexible patching** — normalize a failed hunk to a real diff, split into sub-hunks, vary context | `aider/website/docs/unified-diffs.md`; `aider/coders/editblock_coder.py:133-181` (`perfect_or_whitespace`, spurious-blank-line drop, `try_dotdotdots`) | **Adapt, and correct the guard: the similarity fallback is dead code.** `editblock_coder.py:183` is a bare `return`; the `SequenceMatcher` tier (`replace_closest_edit_distance`, `:296-333`) sits *after* it at `:184-187` and its only call site is that unreachable line. The wrong-location risk we warned about is real in principle but **aider never runs it** — so there is nothing to reject there, and the mechanism to take is narrower than recorded: whitespace tolerance, blank-line drop, and `...` elision. Require a unique anchor and always show the applied diff (unchanged). |
| **Failure feedback that teaches the model** — a failed block is echoed, followed by *"Did you mean to match some of these actual lines from {path}?"* (`find_similar_lines`, threshold 0.6), an already-applied check (*"The REPLACE lines are already in {path}!"*), and *"The other N blocks were applied successfully. Don't re-send them."* | **observed 2026-10-28:** `aider/coders/editblock_coder.py:96-118`, `:602-624` | **Adopt — this is the mechanism for our measured failure class.** 153 of our 215 edit errors (71%) are anchor misses and pi's refusal names no candidate (`vendor/pi-main/.../edit-diff.ts:256`). See `docs/reviews/edit-machinery-2026-10-28.md` §2, ROADMAP **215**. |
| **Cross-file fallback** — if a block misses the named file, try every file in the chat | **observed 2026-10-28:** `aider/coders/editblock_coder.py:57-64` | **Reject.** The wrong-location hazard shipped as a feature; it would also defeat our per-item worktree isolation. |
| **Lint/test after every edit, then auto-repair** (`--lint-cmd`, `--test-cmd`, `--auto-test`) — `auto_lint = True` by default, and lint/test failures become a `reflected_message` the model must answer, capped at `max_reflections = 3` | `aider/website/docs/usage/lint-test.md`; **observed 2026-10-28:** `aider/coders/base_coder.py:100-101,105,1599-1622`, counter at `aider/io.py:231,989` | **Adopt**: a deterministic post-edit gate — `node --check` + the item's demo — before a change is accepted. This is the concrete form of the follow-up's item 5 and would have refused the 2026-10-17 conflicted `checkup.mjs`. |
| **Repository map** — ranked symbols map sent each request, token-budgeted (~1k default), graph-ranked | `aider/website/docs/repomap.md` | **Adopt (consider)**: durig seats navigate with `read`/`search`. A repo-map section is a context-selection upgrade for seat prompts; larger item, measure first. |
| **Prompt-cache ordering + keepalive** — cache system prompt, read-only files, repo map, editable files, in that order; `--cache-keepalive-pings` every 5 min | `aider/website/docs/usage/caching.md` | **Adopt**: matches our byte-stable-prefix rule (constitution first, variable content after). Consider a keepalive for long-lived seats. |
| **Keep context small** — above ~25k tokens models get distracted and disobey the edit format; drop irrelevant files | `aider/website/docs/troubleshooting/edit-errors.md` | **Adopt**: supports durig's thin-context contract; a concrete ceiling to cite in seat guidance. |
| **Architect/editor split** — a planner proposes, a separate editor model produces the edits | `aider/website/docs/usage/modes.md`; `aider/website/docs/config/editor.md` | **Adapt**: only if apply-failure is a *measured* bottleneck (follow-up H26); our `edit` already returns a patch. |
| **Per-edit auto-commit + `/undo`** — commit each AI change; commit dirty files before editing | `aider/website/docs/git.md` | **Adapt / mostly reject**: durig's norm is one commit per concern with explicit paths. A per-edit checkpoint would give undo, but must not pollute the landing history — consider a throwaway checkpoint ref, not auto-commits. |

## Where it does not fit
- **Whole-file edit format**: simple but returns the entire file each edit — costly and wasteful at our
  file sizes. Reject as a default.
- **Auto-commit per edit**: conflicts with the one-commit-per-concern and explicit-paths discipline that
  keeps durig's landing train auditable.
- **Substrate**: Aider is single-agent, single-repo, no durable queue, no seats, no verifier split — it
  does not replace any durig component; only the edit/verify mechanics transfer.
- **Python/CLI/Windows**: the CLI itself is out of scope; we read it for its mechanics, not to run it.

## What the clone's measured corpus adds (2026-10-28)

`aider/website/_data/*.yml` is committed benchmark output, not prose: 98 runs in `edit_leaderboard.yml`, 14 in
`quant.yml`, 20 in `architect.yml`, 44 in `code-in-json.yml`; the metrics are defined in
`aider/benchmark/benchmark.py:486-525`. Two readings from it that matter more than any format claim: (a) the
`quant.yml` run **"Ollama: fp16, 2k ctx"** collapses to `percent_cases_well_formed` **46.2%** with 165 malformed
responses while every other quantization stays 88.7–95.5% — a cramped context, not quantization, wrecks edit
formatting; (b) the paired `architect.yml` rows show the propose/then-edit split repairs only models that were
*already* malforming (`o1-mini`, already 100% well-formed, gains nothing). Full table and confound warnings:
`docs/reviews/edit-machinery-2026-10-28.md` §4.

## Where each claim lives (in the clone)
- `aider/website/docs/more/edit-formats.md`, `unified-diffs.md`, `repomap.md`, `git.md`
- `aider/website/docs/usage/{modes,lint-test,caching}.md`, `troubleshooting/edit-errors.md`
- `aider/coders/editblock_coder.py` (the flexible-patch implementation)

## Verdict
Aider is the strongest available reference for the *edit-and-verify* half of the follow-up research. Adopt
its per-model format selection, high-level-diff guidance, and post-edit lint/test gate; adapt its flexible
patching **without** the similarity fallback; treat the repo map and architect/editor split as
measure-first. None of it changes durig's substrate or its no-auto-merge posture.
