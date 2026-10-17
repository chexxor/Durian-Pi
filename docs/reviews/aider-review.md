# Competitor review — Aider (`Aider-AI/aider`)

*Read 2026-10-17 by the delegate. Clone pinned at HEAD `5dc9490bb35f9729ef2c95d00a19ccd30c26339c`
(`vendor/eval/aider`, shallow). Method: `docs/runbooks/competitor-review.md`.*

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
| **High-level diffs** — ask for coherent code blocks, not surgical line edits; **30–50% fewer editing errors** without it | `aider/website/docs/unified-diffs.md` | **Adopt**: prompt/guide our seats to emit substantive blocks; return the applied diff so the change is reviewable. |
| **Bounded flexible patching** — normalize a failed hunk to a real diff, split into sub-hunks, vary context | `aider/website/docs/unified-diffs.md`; `aider/coders/editblock_coder.py` (`replace_most_similar_chunk`, `try_dotdotdots`, `do_replace`) | **Adapt, with a guard**: Aider's finale is a `SequenceMatcher` **similarity** match that silently binds to the most-similar region — exactly the wrong-location risk in the follow-up (H24). Take the normalize/sub-hunk strategies; **reject raw similarity fallback**; require a unique anchor and always show the applied diff. |
| **Lint/test after every edit, then auto-repair** (`--lint-cmd`, `--test-cmd`, `--auto-test`) | `aider/website/docs/usage/lint-test.md` | **Adopt**: a deterministic post-edit gate — `node --check` + the item's demo — before a change is accepted. This is the concrete form of the follow-up's item 5 and would have refused the 2026-10-17 conflicted `checkup.mjs`. |
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

## Where each claim lives (in the clone)
- `aider/website/docs/more/edit-formats.md`, `unified-diffs.md`, `repomap.md`, `git.md`
- `aider/website/docs/usage/{modes,lint-test,caching}.md`, `troubleshooting/edit-errors.md`
- `aider/coders/editblock_coder.py` (the flexible-patch implementation)

## Verdict
Aider is the strongest available reference for the *edit-and-verify* half of the follow-up research. Adopt
its per-model format selection, high-level-diff guidance, and post-edit lint/test gate; adapt its flexible
patching **without** the similarity fallback; treat the repo map and architect/editor split as
measure-first. None of it changes durig's substrate or its no-auto-merge posture.
