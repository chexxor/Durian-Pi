# Research request — prompting LLMs for merge resolution and code edits (follow-up)

**Ask:** hand this to the operator's research agent. Report to
`docs/reviews/llm-prompting-for-git-merging-followup.md`.

This is the **follow-up** to `docs/reviews/llm-prompting-for-git-merging.md`. That first pass was strong
on the literature (edit-format benchmarks, SWE-agent's ACI, Merge-Bench's per-hunk patterns, vendor
tooling). This request asks the questions it left open, and grounds them in **durig's actual models,
harness, and the 2026-10-17 landing incident** the first pass could not see.

## Context

`durig` (`Pi-OpenDurig`) is a durable, multi-seat LLM agent rig built on `pi-durable`. A **single-writer
broker** drives a cross-seat **work queue**; **seats** are long-lived LLM conversations that claim items
and act in **isolated git worktrees**; a **delegate** operates on the human operator's behalf; a
**TUI/CLI** are the read surfaces. The store is an append-only SQLite.

**What we already believe and have adopted (first pass).** The report's conclusions are largely
actionable and we have folded the safe ones into `docs/runbooks/resolve-merge-conflict.md`:
deterministic-first (ours/theirs, rerere), 3-way base/ours/theirs context, per-hunk resolution with an
explicit **abstention** option, whole-file coherence + tests before accepting, and never resolving on the
shared tree. We also added a `git merge-tree --write-tree` pre-flight to `merge.md`'s orbit.

**What actually happened (the motivating incident, 2026-10-17).** A landing pass merged a **train of
verified branches** directly into the shared `main` working tree while the rig was live. When
`impl-item-714` conflicted, the tree held `.git/MERGE_HEAD` plus `<<<<<<<` markers in `src/checkup.mjs`;
because `cli.mjs` statically imports `checkup.mjs`, **every** `node cli.mjs` verb became a `SyntaxError`
until it was resolved. The conflict itself was routine and resolved to a **union** of both sides.
Full analysis: `docs/incidents/2026-10-17-landing-safety.md`.

**Our constraints (the first pass could not account for these):**
- **Models:** seats resolve to `deepseek-ai/DeepSeek-V4.1-Flash` and `zai-org/GLM-5.3-Flash` on
  DeepInfra-class hosts. The first pass's format tables cover GPT/Claude/Gemini/Qwen — **not our models**.
- **Harness:** `pi-durable` tools are `read`, `write`, `edit` (exact-match, LF-normalizing, returns a
  `patch`), and `powershell`. **There is no `apply_patch`.** Coordinator seats (`pm`, `lead`) have **no
  file tools at all**.
- **Platform:** native **Windows**, Git 2.55, no WSL/docker. **CRLF/EOL is a live hazard** (F32: an LF
  `oldText` never matches a CRLF file; the EOL policy is a recent operator ruling).
- **Norm:** measure-first; the operator's stated preference is **instructions + a later read-only audit,
  not new auto-merge automation**. Abstention maps to our `defer_work`.

## Questions

Answer each from external evidence where possible. Where a question is about *our* code/behaviour and is
not externally answerable, say so and mark it **internal — unverified** rather than guessing.

**A. Our models and edit formats (highest priority — the first pass omits them)**
1. What evidence exists for **DeepSeek-V4-class and GLM-5.3-class** models on edit format — anchored
   search-replace vs unified diff vs OpenAI's V4A `apply_patch`? If none, what is the accepted, cheapest
   method to measure **apply-exactness on our own repo** for a single model (task set, metrics, sample
   size)?
2. Structured-output/function-calling reliability of these models for a per-hunk **enum decision plus a
   free-form escape hatch**: known failure modes (emitting a diff when the resulting code was asked for,
   out-of-order hunks, invalid JSON)?
3. Does a full base/ours/theirs payload per hunk scale within a context window, and does it destabilize a
   byte-stable prompt-cache prefix (the constitution/persona is a fixed prefix)?

**B. Landing a TRAIN of branches — the case the first pass never addresses (its biggest omission)**
4. Prior art on **pre-flight/dry-run merge**: `git merge-tree --write-tree` (Git 2.38+), the `ort`
   strategy, in-memory 3-way merge, GitHub's merge queue. Is there tooling that computes the **conflict
   set for a set of branches at once**, without touching a working tree?
5. **Merge ordering to minimise conflicts**: evidence/practice on topological ordering, a conflict graph,
   or batch merge queues to sequence a landing train. Is there any accepted heuristic or tool?
6. For landing many branches, **merge vs rebase vs cherry-pick**: evidence on which minimises conflict and
   branch rot, and when `git merge --no-ff` is the right choice.
7. `git rerere`: what are the real hazards of a **stale auto-applied resolution**, and what is the safe,
   auditable configuration/workflow for a team (when to record, when to review, when to forget)?
8. Can a conflict be resolved **entirely in the object store** (no working-tree markers) and only a clean
   result materialised — the analogue of `merge-tree --write-tree` plus a resolved tree — so a shared
   working tree is never mid-merge? What is the closest existing workflow/tool?

**C. Conflict representation and prompt (we will apply this; details are unclear)**
9. `merge.conflictStyle` (`merge` / `diff3` / `zdiff3`): evidence on which representation yields better
   LLM/human resolution, and how it interacts with the 20-line-context 3-way format.
10. **Hunk sizing** for our real case (the `#714` conflict had ~75-line regions with additive/union
    semantics): how should large conflicts be chunked, and when is abstention or human escalation better
    than splitting?
11. **Hunk identity**: hashing vs rerere keys; keeping a per-hunk decision from drifting when markers are
    not numbered; handling renames/moves and files that mix conflict and non-conflict hunks.
12. The first pass's rule "enums where the choice set is closed, generation where it isn't" — is there a
    **taxonomy of edit intents** that tells us which operations should be closed-set enums?

**D. Deterministic-first tooling**
13. `mergiraf` / AST-aware merge for **JavaScript/JSON**: correctness evidence, licence, **native Windows**
    support, and failure modes. Other structural-merge tools for our stack.
14. Vendor apply-models (Morph, Cursor) and two-stage apply: is there any **open or local** apply model
    that runs on Node/Windows, or is the pattern impractical at our volume? Cost/latency evidence.
15. `git apply --3way` and fuzzy patching: exact failure modes and the correct pre-apply gate.

**E. Untrusted content and safety (not considered by the first pass)**
16. Conflict text comes from **branches, which may be untrusted**: what is known about **prompt injection**
    through conflict markers fed to a resolver, and what mitigations are established? Secret/PII leakage
    into merge/edit prompts?
17. Should the resolver run with reduced privilege / no network / a sandbox? Prior art.

**F. Evaluation and acceptance (we will apply this)**
18. How to build a **durig-specific** merge-resolution eval by replaying **our own past conflicts** from
    git history as ground truth: sampling, metrics (exact / normalised / AST, abstain, false-merge),
    sample size, and thresholds. The first pass warns exact match understates quality — what normalised or
    AST metric is accepted?
19. How should a **conflict-detection/ordering** tool (`merge-tree`) be evaluated — is there a benchmark
    for pre-flight conflict prediction?
20. What alert thresholds are reported in practice for **false merges that still pass tests**?

**G. Human/operator surface (our TUI)**
21. Prior art on presenting AI conflict resolutions for review: per-hunk confidence, accept/reject, and
    showing base/ours/theirs. How do GitKraken/Copilot/Cursor surface uncertainty? What makes a reviewing
    operator trust and verify a merge?
22. How should **abstentions** be surfaced so an unresolved conflict becomes a queued question
    (`defer_work`) rather than a silent stall?

**H. Edit-tool design in general (beyond merges)**
23. Read tool: evidence-based **centered-window** sizes (not whole file) for repo files of our size.
24. **Fuzzy matching**: how fuzzy is safe (whitespace-insensitive vs anchor-based bend); false-apply risk;
    can we get CRLF/EOL robustness (F32) without silently applying the wrong region?
25. **Lint/parse gate and revert-on-error** on every edit: which checks give the best accuracy/cost
    trade-off, and how does a "failing-first" test norm interact?
26. Planner/applier split: is the two-model pattern worth it at our volume? Any open/local options.

## Deliverable

`docs/reviews/llm-prompting-for-git-merging-followup.md`, with:

- A per-question answer, each grounded in an external source with a **URL** and an **evidence class**
  (`advertised-elsewhere` vs `observed`), or explicitly marked **unverified / internal**.
- A recommended **edit-format decision for our models**, with the measurement recipe to confirm it.
- A recommended **landing-train workflow** (pre-flight, ordering, scratch-worktree, abort-first) that
  keeps a shared working tree out of a conflicted state.
- A recommended **conflict-tool spec** (per-hunk enum + abstention + hash identity + whole-file coherence)
  and a build/don't-build call against existing tools.
- A recommended **deterministic-first cascade** for our stack, with Windows/git-2.55 specifics.
- An **evaluation design** replaying our own conflicts, with metrics and thresholds.
- Proposed **ROADMAP items** for durig (registered, not scheduled) — do not schedule them.
- An explicit list of anything you **could not verify**.

## Evidence discipline

- Every external claim cites a **URL** and states its class (`advertised-elsewhere` vs `observed`).
- Map every finding either to a concrete durig mechanism (`cli.mjs`, `src/seattools.mjs` tool surface,
  `src/checkup.mjs`, the broker, the store, the TUI) or name it **unverified**.
- Do not restate the first pass's conclusions as settled where this request asks for deeper evidence.

## Constraints

- **Written report only; do not modify code.**
- Baseline to read: `docs/reviews/llm-prompting-for-git-merging.md`,
  `docs/incidents/2026-10-17-landing-safety.md`, `docs/runbooks/merge.md`,
  `docs/runbooks/resolve-merge-conflict.md`, `docs/ROADMAP.md` items 100–101, and the vendored
  pi-durable `dist/tools/edit.js` (the exact-match edit that returns a `patch`).
- Prefer primary sources (papers, provider docs, first-party engineering blogs) over aggregators; say when
  a claim rests on a community report rather than a controlled result.

