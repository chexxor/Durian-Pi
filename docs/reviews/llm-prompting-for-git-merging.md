What are the most efficient techniques for prompting an LLM Agent to resolve a git merge and/or edit code files? I feel like providing a diff-application tool would be effective and asking the agents to produce file diffs. And for merging git branches, we might be able to find an existing tool that allows an LLM agent to send a single command that states how to resolve each conflict chunk in a file, like "resolve file.html Left, Left, Right, Left"
What does academic research and industry practices say about this?


-----------

I'll research both the academic literature and current industry practice on this.Good starting material. Now let me dig into the primary sources.Now let me look at agent-interface research and existing tooling.Let me pull the primary sources on agent-computer interfaces and Aider's diff findings.## Short answer

Both of your intuitions are supported by the evidence — but the literature says the *tool surface* matters less than three things: (1) whether the model gets tight, machine-checkable feedback after every edit, (2) whether it's allowed to abstain, and (3) whether the format is one it saw heavily in pretraining. Your "resolve file.html Left, Left, Right, Left" idea is essentially MergeBERT's original formulation and is arguably the best-supported design in the merge literature.

---

## 1. Editing code files: what actually moves the needle

### Edit format: the honest state of the evidence

The cleanest controlled study is **Diff-XYZ** (Oct 2025), which holds task context fixed and varies only the edit representation [^2]. Apply exact-match (how often the produced edit applies correctly):

| Model | unified diff | udiff (relaxed header) | verbose ADD/DEL markers | search-replace |
|---|---|---|---|---|
| GPT-4o | 0.86 | 0.85 | 0.82 | **0.94** |
| GPT-4.1 | 0.90 | 0.92 | 0.91 | **0.96** |
| Claude 4 Sonnet | 0.95 | 0.95 | 0.95 | **0.97** |
| Gemini 2.5 Flash | 0.90 | 0.91 | 0.79 | **0.95** |
| Qwen2.5-Coder-32B | 0.84 | 0.83 | 0.83 | **0.92** |
| Qwen2.5-Coder-7B | 0.58 | 0.57 | 0.57 | **0.75** |

[^2] [^2]

Conclusions worth internalizing:
- **Search-replace (Aider-style SEARCH/REPLACE blocks) wins for capable models**, mainly because each replacement is independent — an error in one edit doesn't invalidate the others [^2].
- **Unified diff is close behind and is far more robust in the small-model regime** (Qwen 0.5B scores 0.01 on udiff and 0.00 on search-replace — small models are just bad at editing, period) [^2].
- **Verbose markers hurt.** Replacing `+`/`-` with `ADD`/`DEL`/`CON` to avoid token collisions made things *worse*, not better [^2].
- **Don't strip the `@@ -a,b +c,d @@` headers.** Even though the applier ignores the numbers, they act as scaffolding that makes models emit hunks in file order; removing them causes out-of-order hunks [^2].
- Failure mode to watch: models sometimes emit *a diff* when you asked for the *resulting code* — >10% of GPT-4.1's errors in the Apply task [^2].

Note a real tension: **Aider measured the opposite ordering** for older models. Switching GPT-4 Turbo from SEARCH/REPLACE to unified diffs took its benchmark score from 20% → 61% and cut "lazy comment" outputs 3× [^4]; June GPT-4 went 26% → 59% [^4]. Aider's theory is that a format consumed by a rigid program (patch) makes the model behave more rigorously, and that unified diff is simply the most common diff format in pretraining data [^4] [^4]. The reconciliation is that format wins are **model- and generation-specific** — measure on your own model. Aider reports format choice swinging accuracy and cost 2–3× in published benchmarks, and its own leaderboards treat edit format as a first-class configuration knob per model [^6] [^7].

Aider also reports two practical wins that are easy to miss: **"high-level diff" prompting** (telling the model the intent before the patch) avoids a 30–50% increase in editing errors, and **flexible/fuzzy patching** avoids a 9× increase in errors on their Exercism benchmark [^4] [^d36656#296]. Never wrap code in JSON if you can avoid it [^4].

### The tool interface: SWE-agent's ACI is the canonical reference

SWE-agent's paper is essentially a controlled study of exactly your question [^3]:

- **One consolidated edit command**, not shell redirection or `sed`. Line-range + replacement text, no arithmetic, multi-line in a single action [^3].
- **The file viewer auto-updates after every edit**, so the agent sees the effect without spending a turn [^3].
- **A linter gate on every edit** (flake8 with a small set of syntax/indentation/undefined-name codes). Invalid edits are *discarded and reverted*, and the agent is told to try again [^3].

Ablations on SWE-bench Lite: no editor → 10.3%; editor → 15.0%; editor **with linting** → **18.0%** [^3] [^3]. Two more findings that transfer directly to your design:

- **Viewer window size matters in both directions** — 30 lines drops to 14.3%, showing the entire file drops to 12.7%. Give a *centered window*, not the whole file [^3].
- **The rejection message contents matter.** SWE-agent found it needed all three of: the error type, a snippet of what the edit *would* have looked like, and a snippet of the original content. Omit the error type → misdiagnosis; omit the new snippet → agent re-issues the same command; omit the original snippet → agent edits against stale content from several turns ago [^3].

### Where the major vendors landed (they disagree, deliberately)

| Vendor | Editing primitive |
|---|---|
| Anthropic (text editor tool) | `view`, `str_replace` (exact string match), `insert`, `create`, `undo_edit` [^8] |
| OpenAI (Codex / GPT-5.x) | `apply_patch`, a structured "V4A" diff envelope supporting add/update/delete/move, applied then reported back on for iterative multi-step editing [^5] [^9] |
| Cursor / Morph / Roo / avante | Two-stage: a strong model emits a *fuzzy* edit; a cheap, fast **apply model** turns it into an exact patch |

The two-stage pattern is the one most relevant to your "provide a diff-application tool" instinct — and it's the strongest form of it. Morph reports 98% first-pass apply accuracy for its Fast Apply model vs 86% for Claude search-replace, 85% for Cursor's apply, and 80% for Aider [^10]. Treat that as a vendor benchmark, not neutral science [^24], but the architectural lesson stands: **decouple "decide the change" from "produce a mechanically valid patch,"** and let the applier be tolerant (fuzzy anchor matching, whitespace-insensitive) rather than demanding byte-exact context.

### Practical prompting checklist for file edits

1. Use **anchored search-replace with unique, distinctive anchors** for strong models; fall back to unified diff for weaker/local models [^2].
2. **Read before write**, and re-read after — always show the post-edit region in the tool result [^3].
3. **Fail loudly and informatively.** A rejected edit should return the error, the attempted result, and the current truth [^3].
4. **Lint/compile on every edit** and refuse to apply invalid edits [^3].
5. Keep edits **small and local** — one concern per call.
6. Keep the `@@` headers; skip exotic marker sets [^2].
7. Consider a **cheap dedicated apply model** if you're generating many edits at volume [^10].

---

## 2. Git merges: your per-chunk resolution command is the literature's favored design

### It has a name: primitive merge patterns

MergeBERT formulated merge resolution as **classification over a set of primitive merge patterns extracted from real merge commits** — "choose the left text," "choose the right," "choose the base," "concatenate the left and right," etc. — rather than free-form generation, reporting 63–68% accuracy [^11] [^1] [^12]. That is *exactly* your `resolve file.html Left, Left, Right, Left`. MergeGen reframed it as generation and did slightly better; DeepMerge restricted output to lines drawn from one side or the other; Gmerge was a k-shot GPT-3 wrapper; ChatMerge used a classifier with a ChatGPT fallback [^1].

And it's a **proven human interface**: VS Code and most Git GUIs put exactly three actions above each conflict block — Accept Current Change, Accept Incoming Change, Accept Both Changes [^13]. Your command is just that UI, made machine-callable. Note the enum needs at least four options (left / right / base / both-concat), because MergeBERT's patterns include concatenation and base [^1].

**Design cautions for that command:**
- You need a **stable hunk identifier**. Conflict markers aren't numbered, so index-based commands (`Left, Left, Right`) drift if the file changes. Hash each conflict chunk (git's `rerere` already does exactly this: it hashes the conflicted working-tree file and stores the resolution keyed by that hash) so the tool can verify it's resolving the chunk the model thinks it is [^14] [^15].
- **Per-hunk independence is a real risk.** Each chunk may be locally right and globally wrong (duplicate definitions, conflicting imports, one side renamed a symbol). Add a whole-file coherence pass after the mechanical resolutions.
- Keep **abstention** as an explicit token. See below — this is the single most important finding.

### What current LLM research says about accuracy (and why you should prompt for abstention)

**Merge-Bench / LLMergeJ** (2026) is the most useful recent study: 7,938 conflict hunks, 11 languages, each hunk represented as a 3-way diff with 20 lines of pre/post context, exactly as git/diff3 does it, with the developer's committed resolution as ground truth [^1] [^1].

Their prompt is worth copying almost verbatim [^1]:
- "You are a merge conflict resolution expert."
- **"Return the entire snippet (including full context)"** — not just the resolution.
- "Do not modify the context at all and preserve the spacing as is."
- **"Think in terms of intent and semantics that both sides of the merge are trying to achieve."**
- **"If you are not sure how to resolve the conflict or if the intent is ambiguous, please return the same snippet with the conflict."**

Zero-shot results on Java conflicts (exact text match / normalized match / no-resolution / wrong code):

| Model | Exact match | Normalized match | Kept conflict (abstained) | Different code |
|---|---|---|---|---|
| Gemini 2.5 Pro | **54.7%** | **62.5%** | 3.4% | 34.1% |
| o3 Pro | 46.1% | 54.3% | 10.6% | 35.1% |
| Claude Opus 4 | 44.4% | 51.2% | 21.2% | 27.6% |
| Grok 4 | 33.4% | 39.7% | 42.4% | 17.9% |
| Qwen3 32B | 13.2% | 16.9% | 71.8% | 11.1% |
| Qwen3-14B SFT | 36.6% | 44.7% | 19.2% | 36.1% |
| **LLMergeJ 14B (GRPO)** | **48.8%** | **58.9%** | 5.6% | 35.5% |

[^1]

Three takeaways:
1. **Frontier models resolve roughly half to two-thirds of conflicts correctly zero-shot.** That's useful as an assistant, not as an unattended auto-merger.
2. **A 14B model with GRPO beats models 20× its size** — the paper's reward was `reasoning + format + resolution`, where resolution gives 1.0 for exact match, 0.5 for normalized match, **0.1 for preserving the conflict**, and 0 for anything else. The group-relative averaging deliberately makes "preserve the conflict" beat "guess wrong," so the model learns to abstain rather than hallucinate a merge [^1] [^1]. If you're fine-tuning, that reward shape is the actionable insight; if you're prompting, ask for the same behavior explicitly.
3. **Exact-match understates quality** — the authors note it rejects semantically equivalent code, so normalized/AST comparison is a lower bound on correctness, and developers legitimately resolve similar conflicts differently [^1] [^1]. Don't over-index on leaderboard exact-match.

### Industry practice

| Approach | Examples | Notes |
|---|---|---|
| Drop-in `git mergetool` plugin | `claude-mergetool`, `ai-mergetool` | Standard BASE/LOCAL/REMOTE/MERGED interface, builds a prompt from the three files, pipes to an agent CLI, writes MERGED, falls back to a real mergetool on failure [^16] [^17] |
| Cloud agent on the PR | GitHub Copilot cloud agent | "@copilot Merge in main and resolve the conflicts" in a comment; the agent resolves, **checks that the build and tests still pass**, then pushes [^18]. A one-click "Fix with Copilot" button followed in April 2026 [^19] |
| Editor-integrated | Copilot in VS Code, Cursor, GitKraken | Inline per-conflict resolution, same accept-left/right/both affordances humans use [^20] [^25] |
| CI / Actions | `syncwright`, `conflict-resolver-ai` | Detect + resolve + explain on PRs [^21] [^22] |
| Deterministic-first cascade | `melt`, mergiraf, `git rerere` | Tree-sitter AST-aware structural merge → replay of recorded human resolutions → manual fallback [^23] [^14] |

The deterministic-first pattern is underrated: merge conflicts occur in roughly **20% of merges in open-source projects** [^26], and a large fraction are mechanical (adjacent additions, import lists, formatting). `mergiraf`'s AST-aware merge resolves those without an LLM at all, `git rerere` replays resolutions you've already made [^23] [^14], and per-path `git checkout --ours/--theirs` handles trivial cases. Spend LLM tokens on the residue.

---

## 3. Synthesis: what I'd actually build

**For code edits:**
1. A read tool that returns a *centered window* (not the whole file) [^3].
2. An edit tool that accepts **anchored search-replace** (strong models) or unified diff, applies fuzzily, lints/parses the result, **reverts on error**, and returns `{error type, attempted result, current file region}` on rejection [^3] [^d36656#296].
3. Prompt with a format description **plus one example**, and state the intent before the patch [^2] [^4].
4. Optionally split planner and applier across two models [^10].

**For merges:**
1. Run deterministic resolution first (structural merge, `rerere`, per-path ours/theirs) [^23].
2. For the residue, feed the model **base + ours + theirs with ~20 lines of surrounding context**, as 3-way diffs [^1].
3. Have it emit a **per-hunk decision sequence over an enum** — `Left | Right | Base | Both` — which is the MergeBERT formulation [^1] and mirrors the VS Code UI [^13], **plus a free-form escape hatch** for hunks the enum can't express (which the research shows happen: MergeGen had to switch from classification to generation to do better [^1]).
4. Key each decision by a **hash of the conflict chunk**, rerere-style, so indices can't drift [^14].
5. **Explicitly authorize abstention** — "return the conflict unchanged if the intent is ambiguous" — and weight it as a positive outcome, because that's what made a 14B model competitive with frontier models [^1] [^1].
6. **Verify with the build and test suite** before accepting, exactly as Copilot's cloud agent does [^18]. Also run a whole-file coherence check, since per-hunk independence doesn't guarantee a consistent file.
7. Re-read the whole merged file at the end — context-preserving whole-snippet output is what the best-performing prompt asks for [^1].

One meta-point: the two halves of your question pull in opposite directions. For **code editing**, the evidence favors *generative* formats (diffs / search-replace) with a tolerant applier. For **merges**, the evidence favors *discriminative* formats (pick-a-side per hunk) with an abstention option. That's not a contradiction — it's because a merge conflict hands the model a small, closed set of intent-preserving choices, while a code edit does not. Design accordingly: enums where the choice set is closed, generation where it isn't.

**References**

[^1]: [[2605.25890v1] Merge-Bench: Resolve Merge Conflicts with Large Language Models](https://arxiv.org/html/2605.25890v1) (32%)
[^2]: [[2510.12487v2] Diff-XYZ: A Benchmark for Evaluating Diff Understanding](https://arxiv.org/html/2510.12487v2) (25%)
[^3]: [[2405.15793v3] SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering](https://arxiv.org/html/2405.15793v3) (18%)
[^4]: [Unified diffs make GPT-4 Turbo 3X less lazy | aider](https://aider.chat/docs/unified-diffs.html) (5%)
[^5]: [Apply Patch | OpenAI API](https://developers.openai.com/api/docs/guides/tools-apply-patch) (2%)
[^6]: [website/tool-engineering/llm-edit-format-selection.md at main ... - GitHub](https://github.com/agentpatterns-ai/website/blob/main/tool-engineering/llm-edit-format-selection.md) (1%)
[^7]: [Aider LLM Leaderboards](https://aider.chat/docs/leaderboards/) (1%)
[^8]: [Text editor tool - Claude Platform Docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/text-editor-tool) (1%)
[^9]: [Apply Patch System | openai/codex | DeepWiki](https://deepwiki.com/openai/codex/5.4-apply-patch-system) (1%)
[^10]: [Morph Fast Apply vs Claude, Cursor, Aider & String Replace](https://www.morphllm.com/comparisons) (1%)
[^11]: [Program Merge Conflict Resolution via Neural Transformers](https://arxiv.org/abs/2109.00084) (1%)
[^12]: [M BERT: PROGRAM MERGE CONFLICT RESOLU N TRANSFORMERS - OpenReview](https://openreview.net/pdf?id=WXwg_9eRQ0T) (1%)
[^13]: [Resolve merge conflicts in VS Code](https://code.visualstudio.com/docs/sourcecontrol/merge-conflicts) (1%)
[^14]: [Rerere](https://git-scm.com/book/en/v2/Git-Tools-Rerere) (1%)
[^15]: [Mastering Git Rerere: Solving Repetitive Merge Conflicts ...](https://www.thisdot.co/blog/mastering-git-rerere-solving-repetitive-merge-conflicts-with-ease) (1%)
[^16]: [GitHub - 9999years/claude-mergetool: Automated Git/jj merge conflict ...](https://github.com/9999years/claude-mergetool) (1%)
[^17]: [GitHub - pfcoperez/ai-mergetool: git merge tool (like meld, kdiff3 and ...](https://github.com/pfcoperez/ai-mergetool) (1%)
[^18]: [Ask @copilot to resolve merge conflicts on pull requests](https://github.blog/changelog/2026-03-26-ask-copilot-to-resolve-merge-conflicts-on-pull-requests/) (1%)
[^19]: [Fix merge conflicts in three clicks with Copilot cloud agent](https://github.blog/changelog/2026-04-13-fix-merge-conflicts-in-three-clicks-with-copilot-cloud-agent/) (1%)
[^20]: [Resolving Merge Conflicts with AI: Copilot, Cursor & Claude](https://www.deployhq.com/git/resolving-merge-conflicts-with-ai) (1%)
[^21]: [AI-powered Git merge conflict resolution tool - GitHub](https://github.com/NeuBlink/syncwright) (1%)
[^22]: [Conflict Resolver AI — LLM-Powered Merge Conflict Resolution](https://github.com/marketplace/actions/conflict-resolver-ai-llm-powered-merge-conflict-resolution) (1%)
[^23]: [melt | Skills Marketplace · LobeHub](https://lobehub.com/skills/paulnsorensen-easy-cheese-melt) (1%)
[^24]: [Benchmarks | Morph](https://www.morphllm.com/benchmarks/fast-apply) (0%)
[^25]: [AI-Assisted Merge Conflict Resolution: How GitKraken ...](https://www.linkedin.com/pulse/ai-assisted-merge-conflict-resolution-how-gitkraken-eliminates-lpmxc) (0%)
[^26]: [LLM-powered Merge Conflict Resolution - PyTexas Meetup](https://www.pytexas.org/meetup/past_meetups/llm-powered-merge-conflict-resolution/) (0%)

