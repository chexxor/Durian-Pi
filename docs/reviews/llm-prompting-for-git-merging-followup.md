

I'll start by checking the sandbox for the baseline docs the request references, then begin research.No durig baseline docs are present in the sandbox — only the request itself. I'll note internal claims as unverified. Continuing research.Good material. Now filling the remaining gaps.One more research pass to close the remaining gaps.Final gap-filling pass.## Note on the deliverable

The sandbox contains only the request itself — none of the baseline documents it cites (`docs/reviews/llm-prompting-for-git-merging.md`, `docs/reviews/landing-safety-2026-10-17.md`, `docs/runbooks/merge.md`, `docs/runbooks/resolve-merge-conflict.md`, `docs/ROADMAP.md`, the vendored `pi-durable dist/tools/edit.js`). The workspace is also read-only, so I cannot create `docs/reviews/llm-prompting-for-git-merging-followup.md`. **The report is delivered below**; every question about durig's own code/behaviour is marked **internal — unverified** because I could not read those files.

Evidence classes used: **observed** (controlled benchmark / peer-reviewed / primary docs) and **advertised-elsewhere** (vendor or community claim).

---

# A. Our models and edit formats

### A1. Edit-format evidence for DeepSeek-V4-class and GLM-5.3-class

| Finding | Source | Class |
|---|---|---|
| No controlled edit-format benchmark (Diff-XYZ-style) exists for DeepSeek-V4.1-Flash or GLM-5.3-Flash specifically. Diff-XYZ covers GPT/Claude/Gemini/Qwen only. | [Diff-XYZ](https://arxiv.org/html/2510.12487v1) [^1] | observed (absence) |
| DeepSeek's own harness ("dsh") ships **string-level `edit`/`write` tools but no diff-applier**; the diff-applier is a third-party bolt-on (`dsh-patch-apply`, `dsh-patch-edit-plus`). This is indirect evidence that DeepSeek's native edit surface is exact-match string edit, not structured patch. | [dsh-patch-apply](https://github.com/JohnXu22786/apply-patch), [dsh-patch-edit-plus](https://github.com/drscrewdriver/dsh-patch-edit-plus) | advertised-elsewhere |
| GLM-5.3-Flash: 320B total / 18B active, natively multimodal, first-party claim of "approaching Claude Opus 4.8 on coding and agentic benchmarks". No edit-format data. | [NVIDIA NIM modelcard](https://build.nvidia.com/z-ai/glm-5-3-flash/modelcard), [z.ai blog](https://z.ai/blog/glm-5.3-flash) | advertised-elsewhere |
| DeepSeek-V4.1-Flash: 552B MoE, 8B prefill / 16B decode active, 1M context, $0.22/M in, $0.007/M cached in, $0.66/M out; open-weight MIT. | [llm-stats](https://llm-stats.com/models/deepseek-v4.1-flash), [Morph](https://www.morphllm.com/deepseek-v4) | advertised-elsewhere |
| Vendor practice deliberately matches format to model family: "apply_patch fails on models outside the GPT family, str_replace on whitespace…". | [Harness engineering](https://medium.com/@wasowski.jarek/harness-engineering-apply-patch-vs-str-replace-vs-unified-diff-the-edit-format-as-a-harness-92ce33b45c1d) | advertised-elsewhere |

**Cheapest accepted method to measure apply-exactness on our repo** (adapted from Diff-XYZ's controlled design [^1]):

- **Task set:** sample N edit tasks from our own repo where the *target* edit is already known from git history (replay real commits). Hold context fixed and vary **only** the format string. 150–300 tasks gives usable per-format confidence; Merge-Bench used 7,938 hunks and ConflictBench 180 scenarios for reference scale [^2], [^3].
- **Formats:** (1) unified diff, (2) unified diff with relaxed header, (3) anchored search-replace, (4) whatever `edit`/`write` native surface pi-durable exposes. **Do not test OpenAI V4A** unless a model in the family is known to emit it — Diff-XYZ-style results show format wins are family-specific [^1].
- **Metrics:** Apply EM (did the edit apply exactly and produce the intended bytes), parse-failure rate, and a "wrong-region apply" count (see H24). Report per-format and per-model, ≥2 samples per task at temperature > 0.
- **Caveat:** two independent readouts of Diff-XYZ disagree on the exact per-model numbers (the first pass reported search-replace winning; the primary table read here shows search-replace Apply EM flat at 0.57 across large models while udiff reaches 0.84–0.95). Treat the *qualitative* conclusions as reliable and re-derive any number you rely on from the paper directly.

**Robust qualitative conclusions (observed):** udiff is the safest high-apply-rate format for capable models (0.84–0.95 Apply EM); small models collapse on all formats (Qwen-0.5B ≈ 0.00–0.01); verbose `ADD/DEL/CON` markers *help small models generate* but are not a reliable apply win; **removing `@@` hunk headers causes distribution shift and out-of-order hunks** [^1], [^1]. Aider's opposing result (unified diffs beat SEARCH/REPLACE for GPT-4 Turbo, 20%→61%) remains a counter-data-point [^4].

### A2. Structured-output reliability for a per-hunk enum + escape hatch

| Failure mode | Evidence | Class |
|---|---|---|
| Model emits a *diff* when the *resulting code* was requested (>10% of GPT-4.1 Apply-task errors in Diff-XYZ) | [Diff-XYZ](https://arxiv.org/html/2510.12487v1) [^1] | observed |
| Out-of-order hunks when numeric hunk headers are stripped | [Diff-XYZ](https://arxiv.org/html/2510.12487v1) [^1] | observed |
| Invalid Markdown / missing fence: LLMergeJ tracks "Invalid Markdown" as a separate failure category (0.0% for the trained 14B, non-zero for zero-shot models) | [Merge-Bench](https://homes.cs.washington.edu/~mernst/pubs/merge-bench-icpr2026.pdf) [^2] | observed |
| DeepSeek supports JSON mode (`response_format={"type":"json_object"}`, requires the word "json" + an example in the prompt) and tool-call **strict mode is Beta** — schema-compliance is not guaranteed | [DeepSeek JSON](https://api-docs.deepseek.com/guides/json_mode/), [DeepSeek tool calls](https://api-docs.deepseek.com/guides/tool_calls/), [strict mode](https://deepseek-usa.ai/docs/api/) | observed (docs) |
| GLM supports function calling + structured JSON output via OpenAI tools format; AWS Bedrock model card confirms structured JSON output | [Z.AI struct-output](https://docs.z.ai/guides/capabilities/struct-output), [Bedrock GLM-5.3](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-zai-glm-5-3.html) | observed (docs) |

**Design implication:** do not rely on the enum being emitted as valid JSON. Prefer the Merge-Bench pattern — *return the whole snippet with the conflict markers replaced*, and parse the result structurally — over asking for a JSON object per hunk [^2]. If you do want an enum, validate with a strict parser and treat a parse failure as an **abstention**, not a retry loop (see F18).

### A3. Payload scale and prompt-cache stability

| Finding | Source | Class |
|---|---|---|
| DeepSeek context caching is **automatic prefix matching on disk**; a request only hits cache if it *fully matches a cache-prefix unit*. The stable prefix must come first. | [DeepSeek KV cache](https://api-docs.deepseek.com/guides/kv_cache/) | observed (docs) |
| Prefix caching is **strictly positional** — injecting any per-session token before a byte-stable block destroys the cache for that block. | [deepseek-harness discussion #4749](https://github.com/deepseek-ai/deepseek-harness/discussions/4749) | advertised-elsewhere |
| Cache granularity reported as 256-token increments (community, not documented). | [r/DeepSeek](https://www.reddit.com/r/DeepSeek/comments/1tqiy76/deepseek_v4flash_prompt_prefix_caching_floor_256/) | advertised-elsewhere |
| DeepInfra exposes an explicit `prompt_cache_key` for tagging; otherwise automatic prefix matching. | [DeepInfra prompt caching](https://docs.deepinfra.com/chat/prompt-caching) | observed (docs) |

**Answer:** a full base/ours/theirs payload per hunk is fine at 1M context [^5], but it **does** destabilise a byte-stable prefix *if you interleave variable content before the persona*. Put the constitution/persona first, unchanged, then all per-hunk variable content after it. Merge-Bench's own caps are the right guard: **≤20 lines per side, conflict ≤512 tokens** [^2].

---

# B. Landing a train of branches

### B4. Pre-flight / dry-run merge

| Capability | Mechanism | Source | Class |
|---|---|---|---|
| Merge without touching index or working tree; returns a toplevel tree OID + conflicted-file info + messages | `git merge-tree --write-tree <b1> <b2>` (default since Git 2.38) | [git-merge-tree](https://git-scm.com/docs/git-merge-tree) [^6] | observed (docs) |
| **Compute the conflict set for many merges in one invocation** | `--stdin` — sections repeat per input line, NUL-separated; exit 0 for all, non-zero only if it cannot complete all | [git-merge-tree](https://git-scm.com/docs/git-merge-tree) [^6], [^6] | observed (docs) |
| Same features as real merge: 3-way content merge, rename detection, dir/file conflicts, recursive ancestor consolidation | — | [git-merge-tree](https://git-scm.com/docs/git-merge-tree) [^6] | observed (docs) |
| Cross-PR conflict prediction by overlapping file/line changes | GitHub Action `pr-conflict-detector` | [pr-conflict-detector](https://github.com/github-community-projects/pr-conflict-detector) | advertised-elsewhere |
| Merge queue: temporary branch with latest + queued changes, validated together | GitHub merge queue | [GitHub blog](https://github.blog/news-insights/product-news/github-merge-queue-is-generally-available/), [docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue) | observed (docs) |

**Critical parsing rules** (from the docs' own "Mistakes to avoid"): parse the *conflicted-file info* section, not the tree; do **not** treat an empty conflicted-file list as clean — check exit status; conflict types are many-to-many with paths; and **do not re-merge the stage OIDs** — show the file from the toplevel tree instead, which preserves branch annotations and original filenames [^6].

**Answer to "is there tooling that computes the conflict set for a set of branches at once, without touching a working tree": yes — `git merge-tree --stdin --write-tree`** [^6]. This is the single most important finding for your landing-train workflow.

### B5. Merge ordering to minimise conflicts

| Finding | Source | Class |
|---|---|---|
| GitHub merge queue **auto-detects conflicting PRs and removes them**, re-forming groups | [GitHub blog](https://github.blog/engineering/engineering-principles/how-github-uses-merge-queue-to-ship-hundreds-of-changes-every-day/) | advertised-elsewhere |
| Merge-train batching that is **overlap-aware** (knows which files each member touches) vs deterministic entry order; the latter "only discovers conflicts by spending a trial" | [fabrik issue #2047](https://github.com/handarbeit/fabrik/issues/2047) | advertised-elsewhere |
| PR **prioritisation** research: a probabilistic model predicts build outcomes in a merge pipeline to optimise throughput | [arXiv 2508.08342](https://arxiv.org/abs/2508.08342) | observed |
| Claim that an ordering "minimises the number of conflict resolutions and defines an optimised integration order" | [ResearchGate](https://www.researchgate.net/publication/360230888_Improving_Integration_Process_Efficiency_through_Pull_Request_Prioritization) | advertised-elsewhere |
| Refactorings are involved in **22% of merge conflicts** | [SANER 2019](https://users.encs.concordia.ca/~nikolaos/publications/SANER_2019.pdf) | observed |

**Answer:** there is **no single accepted heuristic or tool** for optimal landing-train ordering. The closest practical model is: build a **conflict graph** from `merge-tree --stdin` over candidate pairs, then order to minimise pairwise overlap (GitHub's remove-and-reform behaviour is the production analogue) [^7]. Mark this as *practice, not settled science*.

### B6. Merge vs rebase vs cherry-pick

| Finding | Source | Class |
|---|---|---|
| merge and cherry-pick both use three-way merge and can **fail to report a conflict when changes logically clash** (silent code duplication) | [Medium deep-dive](https://hitzhangjie.medium.com/how-git-cherry-pick-works-a-deep-dive-into-a-silent-code-duplication-bug-3a321c0ab516) | advertised-elsewhere |
| `--no-ff` preserves merge topology so `--first-parent` gives a clean bisectable history | [apenwarr](https://apenwarr.ca/log/20080323-a-tale-of-five-merges-part-3-git-merge), [HN](https://news.ycombinator.com/item?id=24686888) | advertised-elsewhere |
| No controlled study comparing conflict rates across merge/rebase/cherry-pick was found | — | unverified |

**Answer:** for a **landing train into a shared `main`**, `git merge --no-ff` is the defensible choice: it preserves a first-parent spine for bisection and audit [^8], [^9], and it does not rewrite the verified branch's commits (rebase/cherry-pick create new commits and new 3-way merges that can silently duplicate code [^10]). There is **no empirical conflict-rate evidence** favouring one — treat as convention.

### B7. `git rerere` hazards and safe configuration

| Hazard / rule | Source | Class |
|---|---|---|
| `rerere.autoUpdate=true` **stages** reused resolutions — a merge with only known conflicts can complete without you ever seeing them | [Git Automation](https://www.git-automation.com/conflict-resolution-safe-merge-operations/rerere-conflict-automation/rerere-autoupdate-and-safe-defaults/) [^11] | observed (docs) |
| **Recommended default: `rerere.enabled=true`, `rerere.autoUpdate=false`** for anything that ships; autoupdate on only for throwaway/CI test builds | [Git Automation](https://www.git-automation.com/conflict-resolution-safe-merge-operations/rerere-conflict-automation/rerere-autoupdate-and-safe-defaults/) [^11] | advertised-elsewhere |
| rerere matches by **conflict content, not path** — the same hunk in two files shares a resolution; review with `git rerere diff` catches the rare exception | [Git Automation](https://www.git-automation.com/conflict-resolution-safe-merge-operations/rerere-conflict-automation/rerere-autoupdate-and-safe-defaults/) [^11] | observed |
| Expiry defaults: **60 days resolved / 15 days unresolved**; tune to branch lifetime (180 d long-lived topics) | [Git Automation](https://www.git-automation.com/conflict-resolution-safe-merge-operations/rerere-conflict-automation/rerere-autoupdate-and-safe-defaults/) [^11] | observed (docs) |
| rerere records the conflicted file then the resolved file; git **refuses to auto-finalise** a rerere-helped operation | [Git SCM book](https://git-scm.com/book/en/v2/Git-Tools-Rerere), [Medium](https://medium.com/@porteneuve/fix-conflicts-only-once-with-git-rerere-7d116b2cec67) | observed |
| Review habit: `merge.conflictStyle=zdiff3` + alias running `git rerere status; git rerere diff` after each conflicted stop | [Git Automation](https://www.git-automation.com/conflict-resolution-safe-merge-operations/rerere-conflict-automation/rerere-autoupdate-and-safe-defaults/) [^11] | advertised-elsewhere |

**Safe, auditable team workflow:** enabled=true, autoUpdate=**false**, expiry matched to branch lifetime, mandatory `git rr` review before staging, and never autoupdate on a branch that ships [^11].

### B8. Resolving entirely in the object store

**Yes — this is documented plumbing.** The canonical workflow:

```
NEWTREE=$(git merge-tree --write-tree $BRANCH1 $BRANCH2) || { echo "conflicts" 1>&2; exit 1; }
NEWCOMMIT=$(git commit-tree $NEWTREE -F message.txt -p $BRANCH1 -p $BRANCH2)
git update-ref $BRANCH1 $NEWCOMMIT
```

[^6]

For a conflicted merge, `NEWTREE` carries the conflicted-file info + messages, not just a tree OID [^6]. A resolver can therefore work on blobs in the object store and materialise a **clean resolved tree**, committing with `commit-tree` + `update-ref` — the shared working tree is **never mid-merge**. The closest existing tools that follow this shape are `git merge-tree --write-tree` itself and GitHub's merge queue temporary branch [^12]. **This is the single strongest architectural answer to the 2026-10-17 incident.**

---

# C. Conflict representation and prompt

### C9. `merge.conflictStyle`

| Finding | Source | Class |
|---|---|---|
| `merge` = two sides only; `diff3` adds `|||||||` + original base; `zdiff3` also removes common lines from the conflict zone | [git merge-config](https://git-scm.com/docs/merge-config), [Ductile](https://www.ductile.systems/zdiff3/), [Adam Johnson](https://adamj.eu/tech/2023/12/29/git-conflict-display-zdiff3/) | observed (docs) |
| Merge-Bench's winning prompt feeds a **diff3-style 3-way** with 20 lines of pre/post context — i.e. it includes the base | [Merge-Bench](https://homes.cs.washington.edu/~mernst/pubs/merge-bench-icpr2026.pdf) [^2] | observed |
| ConflictAgent feeds the **diff3 conflict block** to both solver and judge | [arXiv 2607.27674](https://arxiv.org/html/2607.27674v1) [^13] | observed |
| No controlled study measuring *LLM* resolution accuracy as a function of conflict style was found | — | unverified |

**Answer:** both leading LLM merge benchmarks use **diff3 (base included)** [^2], [^13]. Human-facing sources favour **zdiff3** [^14], [^15]. Since your rig is LLM-first with a human audit surface, `zdiff3` gives the LLM the base *and* gives the reviewing operator the cleaner view [^11]. No evidence distinguishes `diff3` from `zdiff3` for LLM accuracy specifically.

### C10. Hunk sizing (the ~75-line union regions)

| Guidance | Source | Class |
|---|---|---|
| Cap each side and the ground truth at **20 lines**; discard conflicts >512 tokens; **prevent a hunk spanning multiple conflicts** | [Merge-Bench](https://homes.cs.washington.edu/~mernst/pubs/merge-bench-icpr2026.pdf) [^2] | observed |
| Abstain when intent is ambiguous rather than guess | [Merge-Bench prompt](https://homes.cs.washington.edu/~mernst/pubs/merge-bench-icpr2026.pdf) [^2] | observed |
| 14B model with abstention reward beat models 20× larger | [Merge-Bench](https://homes.cs.washington.edu/~mernst/pubs/merge-bench-icpr2026.pdf) [^2], [^2] | observed |
| Purely additive/union regions: GitHub UI offers "Accept Both Changes" as a first-class action | [GitHub docs](https://github.blog/developer-skills/github-education/beginners-guide-to-github-merging-a-pull-request/) | observed (docs) |

**Answer:** for #714's ~75-line additive regions, **do not split blindly**. Additive/union semantics are exactly the closed-set case where a single `Both` decision is correct and safe (C12). Split only when the region contains *independent* concerns; escalate to human when the region exceeds the 20-line/512-token caps *and* is not purely additive — because splitting creates the local-right/global-wrong risk (see C11/B-below).

### C11. Hunk identity and drift

| Mechanism | Source | Class |
|---|---|---|
| rerere records the conflicted working-tree file and keys the resolution by **content hash**; matches by content, not path | [git-rerere](https://git-scm.com/docs/git-rerere), [Git Automation](https://www.git-automation.com/conflict-resolution-safe-merge-operations/rerere-conflict-automation/rerere-autoupdate-and-safe-defaults/) [^11] | observed |
| Rename info lives in merge-tree's *informational messages*, not the conflicted-file list; re-merging stage OIDs loses the original filename | [git-merge-tree](https://git-scm.com/docs/git-merge-tree) [^6] | observed (docs) |

**Answer:** hash each conflict chunk (rerere's model) rather than indexing by position — indices drift the moment a preceding hunk is resolved [^16], [^17]. For files mixing conflict and non-conflict hunks, key by **file path + chunk hash**, and require the tool to verify the hash matches before applying a decision. Handle renames by carrying the rename pair from merge-tree's informational messages [^6].

### C12. Taxonomy of edit intents: when is the choice set closed?

| Finding | Source | Class |
|---|---|---|
| MergeBERT defines **nine primitive patterns** — choose O (base) / A / B, concatenate A+B, and those combinations with O-tokens removed | [ASE paper](https://raw.githubusercontent.com/DJjjjhao/ase-merge/master/Merge%20Conflict%20Resolution-%20Classification%20or%20Generation.pdf) [^18], [^18] | observed |
| Classification **cannot produce new tokens**; generation can, and can interleave at token level | [ASE paper](https://raw.githubusercontent.com/DJjjjhao/ase-merge/master/Merge%20Conflict%20Resolution-%20Classification%20or%20Generation.pdf) [^18], [^18] | observed |
| Refactoring operations are involved in 22% of conflicts — i.e. many conflicts are rename/extract/move, which are *not* expressible as choose-a-side | [SANER 2019](https://users.encs.concordia.ca/~nikolaos/publications/SANER_2019.pdf) | observed |

**Answer — the closed-set test:** an operation is a safe enum when its correct result is **a subsequence/concatenation of the three inputs** (choose left, right, base, or both). It is **not** closed when it requires new tokens, intra-line interleaving, or a rename/move reconciliation. That maps directly onto MergeBERT's nine patterns as the closed set [^18] and MergeGen's generation as the escape hatch [^18]. Your `Left, Left, Right, Left` command is a **four-value enum** (add `Base` and `Both`) and needs a free-form escape hatch for the ~22% refactoring-flavoured conflicts.

---

# D. Deterministic-first tooling

### D13. Mergiraf / AST-aware merge for JS/JSON

| Property | Finding | Source | Class |
|---|---|---|---|
| JS support | JavaScript `.js/.jsx/.mjs/.cjs` supported | [mergiraf.org/languages](https://mergiraf.org/languages.html) [^19] | observed (docs) |
| JSON support | JSON `.json` supported as a declarative format | [mergiraf.org/languages](https://mergiraf.org/languages.html) [^19] | observed (docs) |
| Architecture | tree-sitter parse + GumTree tree matching (spork-style) | [mergiraf.org/architecture](https://mergiraf.org/architecture.html) | observed (docs) |
| Failure modes | Order-dependent insertions left as conflicts; duplicate JSON keys → conflict; formatting/content merge is best-effort | [mergiraf.org/conflicts](https://mergiraf.org/conflicts.html) [^20], [^20], [^20], [^20] | observed (docs) |
| Safety posture | "Errs on the side of caution and retains conflict markers" in suspicious cases; offers `mergiraf review` | [mergiraf.org](https://mergiraf.org/) | observed (docs) |
| **Windows support** | Installation page does **not** list OSes/architectures; release notes explicitly mention macOS binaries | [mergiraf.org/installation](https://mergiraf.org/installation.html) [^21], [Codeberg releases](https://codeberg.org/mergiraf/mergiraf/releases) | **unverified** |
| License | Not found in the pages read | — | **unverified** |

**Answer:** mergiraf covers JS+JSON and is conservative, which suits a deterministic-first cascade. **Windows support and license are unverified and must be confirmed before adoption** (it is Rust; a Windows binary may or may not ship). If Windows is unsupported, this fails the platform constraint. Related work: semistructured merge tools (JDime, IntelliMerge, FSTMerge, AutoMerge) — but these **abstain heavily** (see F20) [^13].

### D14. Open/local apply models

| Option | Nature | Source | Class |
|---|---|---|---|
| Morph Fast Apply | 7B, hosted API, 10,500 tok/s, 98% claimed; ~4,500 tok/s via OpenRouter | [Morph](https://www.morphllm.com/fast-apply-model), [OpenRouter](https://openrouter.ai/morph/morph-v2) | advertised-elsewhere |
| Morph comparison vs Claude/Cursor/Aider | 98% vs 86% / 85% / 80% | [Morph comparisons](https://www.morphllm.com/comparisons) | advertised-elsewhere (vendor benchmark) |
| Relace Apply | vendor apply model, "closed-form algorithm for merging code" | [Relace](https://relace.ai/old/blog/relace-apply-3) | advertised-elsewhere |
| kortix-ai/fast-apply | **7B and 1.5B models released for local use** | [kortix-ai/fast-apply](https://github.com/kortix-ai/fast-apply) | advertised-elsewhere |
| Aider architect/editor | two-model planner/applier split | [Aider](https://aider.chat/2024/09/26/architect.html) | advertised-elsewhere |

**Answer:** the only **open/local** apply option found is kortix-ai's 7B/1.5B models [^22]. Morph and Relace are hosted (network dependency — conflicts with a no-network resolver, E17). **No option was found that runs on Node/Windows without a GPU.** At your volume, the pattern is likely impractical unless apply-failures are a measured bottleneck. **Cost/latency evidence beyond vendor claims: unverified.**

### D15. `git apply --3way` and fuzzy patching

| Behaviour | Source | Class |
|---|---|---|
| `--3way` needs the patch to record blob identity **and** those blobs to be available locally; otherwise the 3-way attempt does not run | [git-apply](https://git-scm.com/docs/git-apply) [^23] | observed (docs) |
| Implies `--index`; **incompatible with `--reject`**; leaves conflict markers in working-tree files | [git-apply](https://git-scm.com/docs/git-apply) [^23] | observed (docs) |
| Default is **atomic** — if any hunk fails, the whole patch fails and the tree is untouched | [git-apply](https://git-scm.com/docs/git-apply) [^23] | observed (docs) |
| `-C<n>` requires ≥n context lines to match; by default **no context is ever ignored** (no fuzz factor) | [git-apply](https://git-scm.com/docs/git-apply) [^23] | observed (docs) |
| `--whitespace=error` refuses to apply on whitespace errors | [git-apply](https://git-scm.com/docs/git-apply) [^23] | observed (docs) |
| Context-free patches require `--unidiff-zero`, which is **discouraged** | [git-apply](https://git-scm.com/docs/git-apply) [^23] | observed (docs) |

**Exact failure mode relevant to F32:** an LLM diff generated against **working-tree content** (CRLF) but whose blob hashes refer to LF-normalised repo content will have **mismatched blob identity → the 3-way fallback cannot run → silent atomic failure**, or, with `--reject`, partial application. **Correct pre-apply gate:** `git apply --check` first, ensure `core.autocrlf`/`.gitattributes` normalise consistently [^24], and never use `--reject` in an automated path (it is incompatible with `--3way` and produces `.rej` files) [^23].

---

# E. Untrusted content and safety

### E16. Prompt injection through conflict markers

| Finding | Source | Class |
|---|---|---|
| No study specifically on injection via **conflict markers** was found | — | **unverified** |
| But code comments, READMEs, issue descriptions, and config files are **established IPI vectors** for coding agents | [CodeIPI eval](https://ukgovernmentbeis.github.io/inspect_evals/evals/ipi_coding_agent/), [systematisation of 78 studies](https://arxiv.org/html/2601.17548v1), [NVIDIA AGENTS.md](https://developer.nvidia.com/blog/mitigating-indirect-agents-md-injection-attacks-in-agentic-environments/) | observed |
| Query-agnostic IPI against coding agents | [QueryIPI](https://arxiv.org/abs/2510.23675) | observed |
| **CamoLeak** (CVE-2025-59145, CVSS 9.6): hidden markdown comments in a PR description made Copilot Chat exfiltrate private source and secrets — a real, first-party-confirmed case of untrusted PR content driving an agent | [Legit Security](https://www.legitsecurity.com/blog/camoleak-critical-github-copilot-vulnerability-leaks-private-source-code), [CSO](https://www.csoonline.com/article/4069887/github-copilot-prompt-injection-flaw-leaked-sensitive-data-from-private-repos.html) | observed |
| GitHub's own guidance on reducing indirect-injection risk in VS Code | [GitHub blog](https://github.blog/security/vulnerability-research/safeguarding-vs-code-against-prompt-injections/) | observed (docs) |

**Answer:** conflict text is **branch-controlled content** — treat it as untrusted data. Established mitigations: wrap it in an explicit data envelope (never as instructions), keep the persona/constitution prefix byte-stable and authoritative, strip/neutralise markdown-hidden constructs, and require the resolver to emit *only* a code snippet (Merge-Bench format [^2]) so injected prose has no channel to act through. For secret/PII leakage, CamoLeak is the proof that the exfil channel is real [^25].

### E17. Reduced privilege / sandbox

| Guidance | Source | Class |
|---|---|---|
| Sandbox = restrict filesystem, **network egress**, resources | [Augment](https://www.augmentcode.com/guides/agent-execution-sandbox), [NVIDIA](https://developer.nvidia.com/blog/practical-security-guidance-for-sandboxing-agentic-workflows-and-managing-execution-risk/) | advertised-elsewhere |
| SandboxEval: test suite for untrusted-code execution safety | [arXiv 2504.00018](https://arxiv.org/abs/2504.00018) | observed |
| gVisor/Kata isolation for LLM-generated code | [ARMO](https://www.armosec.io/blog/ai-agent-sandboxing-progressive-enforcement-guide/) | advertised-elsewhere |
| Real incident: an agent ran `rm -rf /` while "cleaning up a merge conflict" | [arXiv 2604.13536](https://arxiv.org/html/2604.13536v2) | observed |

**Answer:** yes — the resolver should run with no network and least privilege, and the tool surface should be read-conflict + write-resolution only (no shell) [^26], [^27]. **On native Windows without WSL/docker, how to achieve this is internal — unverified.** The documented options (gVisor, Kata, Docker) all assume a Linux container runtime [^28].

---

# F. Evaluation and acceptance

### F18. A durig-specific eval replaying our own conflicts

**Method (adopted from Merge-Bench's test-free paradigm):**

1. **Extract** real conflicts from our git history as 3-way hunks with **20 lines of pre/post context**, preventing a hunk from spanning multiple conflicts [^2].
2. **Ground truth** = the developer's committed resolution. **Discard** hunks with missing/repeated context, or where the resolution is larger than left+base+right (signals new code) [^2].
3. **Metrics** (five mutually exclusive categories): Equivalent Text, Code-Normalized Equivalent, Conflict (abstained), Different Code, Invalid Markdown [^2].
4. **Normalized match** = remove comments + standardise whitespace (language-specific for Python/Ruby); described as a **proxy for AST comparison and a lower bound on correctness** [^2]. For a stronger AST metric, CodeBLEU combines n-gram + AST + data-flow match and correlates better with human judgement than BLEU [^29], [^30].
5. **Sample size:** Merge-Bench 7,938 hunks [^2]; ConflictBench 180 scenarios / 136 true conflicts [^3]; ConflictAgent n=292 human-labelled for judge calibration [^13]. For durig, ~150–300 real conflicts is a workable floor.
6. **Judge calibration (essential):** calibrate any LLM judge against human labels **before** using it, and require **zero false-accepts**; ConflictAgent achieved 100% precision at 64.6% recall, making all reported rates conservative lower bounds [^13].
7. **Structural validity must be deterministic, not LLM-judged:** ConflictAgent found the LLM judge **accepted 4 of 5 structurally invalid resolutions** [^13].

**Thresholds:** report exact match as a floor and normalized match as the headline; treat abstention as a *positive* category [^2].

### F19. Evaluating conflict detection / ordering

| Benchmark | What it measures | Source | Class |
|---|---|---|---|
| ConflictBench | 180 Java scenarios, 136 labelled true conflicts; 3 novel metrics; runs 5 state-of-the-art tools | [JSS 2024](https://par.nsf.gov/servlets/purl/10515800), [GitHub](https://github.com/UBOWENVT/ConflictBench) | observed |
| ConGra | graded conflict-complexity benchmarking of merge tools | [arXiv 2409.14121](https://arxiv.org/html/2409.14121v1) | observed |
| pr-conflict-detector | cross-PR overlap prediction | [GitHub](https://github.com/github-community-projects/pr-conflict-detector) | advertised-elsewhere |

**Answer:** yes — ConflictBench is the accepted third-party benchmark for merge-tool evaluation [^3], and it explicitly labels true vs false conflicts. For your `merge-tree` pre-flight, evaluate it as a **classifier**: predicted-conflict-set vs actual merge outcome, scored precision/recall against the labelled true/false conflicts [^3].

### F20. Alert thresholds for false merges that still pass tests

| Finding | Source | Class |
|---|---|---|
| No industry-standard numeric alert threshold for "false merges that pass tests" was found | — | **unverified** |
| Semantic conflicts (merged code violating a branch's spec) are a recognised class, detectable via **generated unit tests** (SAM) | [arXiv 2310.02395](https://arxiv.org/abs/2310.02395) | observed |
| ConflictLens: LLM method for detecting semantic conflicts | [SEKE'25](https://ksiresearch.org/seke/seke25paper/paper012.pdf) | observed |
| Silent rename-drop: a wrong merge strategy dropped 40 renamed files with **no conflict shown** | [TheCodeForge](https://thecodeforge.io/devops/git-merge-strategies/) | advertised-elsewhere |
| ConflictAgent structural validity 95.8% on true conflicts, but 4/5 invalid outputs passed the LLM judge | [arXiv 2607.27674](https://arxiv.org/html/2607.27674v1) [^13] | observed |

**Answer:** no accepted threshold exists. The defensible norm is **structural validity = 100%** (parse + no markers + no duplicate declarations [^13]) as a hard gate, plus a semantic-conflict check via the test suite [^31], [^32]. Anything below 100% structural validity should block the landing.

---

# G. Human/operator surface

### G21. Presenting AI resolutions for review

| Practice | Source | Class |
|---|---|---|
| GitKraken: "AI suggests or generates; developer reviews in context; developer accepts, adjusts, or rejects" | [LinkedIn/GitKraken](https://www.linkedin.com/pulse/ai-assisted-merge-conflict-resolution-how-gitkraken-eliminates-lpmxc) | advertised-elsewhere |
| GitKraken V11.2 offers **suggested fixes with explanations and confidence levels** | [ComponentSource](https://www.componentsource.com/news/2025/07/08/resolve-merge-conflicts-faster-ai) | advertised-elsewhere |
| VS Code / Git GUIs: three actions per conflict block — Accept Current / Incoming / Both | [GitHub docs](https://github.blog/developer-skills/github-education/beginners-guide-to-github-merging-a-pull-request/) | observed (docs) |
| Conflict Resolver AI surfaces resolutions "with explanations — not just blind `<<<<<<< HEAD` removal" | [Marketplace](https://github.com/marketplace/actions/conflict-resolver-ai-llm-powered-merge-conflict-resolution) | advertised-elsewhere |
| Supporting "Use Base" as a first-class action is an open request where diff3 is enabled | [gittyup #707](https://github.com/Murmele/gittyup/issues/707) | advertised-elsewhere |

**Answer:** the trust-building pattern is consistent: **show base/ours/theirs, show the per-hunk decision, show a confidence/explanation, and keep accept/adjust/reject in the operator's hands** [^33], [^34]. A per-hunk confidence is what GitKraken ships [^34]; Merge-Bench's abstention category is the honest way to represent low confidence [^2].

### G22. Surfacing abstentions as `defer_work`

**Answer:** an abstention is a **first-class, positive outcome**, not a stall [^2], [^2]. When the resolver returns the conflict unchanged (or exhausts retries [^13]), the harness should emit a `defer_work` item carrying: file path, chunk hash (C11), the base/ours/theirs payload, and the model's stated reason. That makes the unresolved conflict a **queued question** visible on the TUI rather than a silent block — directly preventing the failure class where a mid-merge shared tree broke every `cli.mjs` verb.

---

# H. Edit-tool design in general

### H23. Read tool: centered-window sizes

| Window | SWE-bench Lite resolved | Source | Class |
|---|---|---|---|
| 100 lines | **18.0%** | [SWE-agent](https://arxiv.org/abs/2405.15793) [^35] | observed |
| 30 lines | 14.3% (−3.7) | [SWE-agent](https://arxiv.org/abs/2405.15793) [^35] | observed |
| Full file | 12.7% (−5.3) | [SWE-agent](https://arxiv.org/abs/2405.15793) [^35] | observed |

**Answer:** use a **centered ~100-line window**, not the whole file [^35]. Whole-file reads are worse than both a 100-line and a 30-line window.

### H24. How fuzzy is safe (and the F32 CRLF hazard)

| Finding | Source | Class |
|---|---|---|
| Fuzzy hunk matching can bind to a **nearby but wrong** similar-looking region and report success; corruption visible only in the returned diff | [hermes-agent #93698](https://github.com/NousResearch/hermes-agent/issues/93698) | advertised-elsewhere |
| Smart quotes/em-dashes fell through to the most permissive fuzzy strategy, risking incorrect matches | [hermes-agent #6831](https://github.com/NousResearch/hermes-agent/issues/6831) | advertised-elsewhere |
| Fuzzy anchor fallback silently splices a misaligned edit instead of failing | [oh-my-pi #10454](https://github.com/can1357/oh-my-pi/issues/10454) | advertised-elsewhere |
| Too little context → wrong place; too much → spurious failures | [Neil Fraser](https://neil.fraser.name/writing/patch/) | advertised-elsewhere |
| `git apply -C<n>`: by default **no context is ever ignored**; `--ignore-whitespace` only affects context lines | [git-apply](https://git-scm.com/docs/git-apply) [^23], [^23] | observed (docs) |

**Answer:** the **safe** fuzz is *whitespace/EOL-insensitive exact matching on a unique anchor* — never positional or similarity-based fallback. Concretely: normalise CRLF/LF before matching (fixes F32), require the anchor to occur **exactly once** in the file, and reject with an explicit error if not. Every fuzzy fallback in the wild reported here was a *silent wrong-location apply* [^36], [^37] — exactly the failure mode you must not ship.

### H25. Lint/parse gate and revert-on-error

| Finding | Source | Class |
|---|---|---|
| flake8 gate with selected codes (F821/F822/F831/E111/E112/E113/E999/E902); **invalid edits are reverted** | [SWE-agent](https://arxiv.org/abs/2405.15793) [^35] | observed |
| Editor without linting 15.0% → **with linting 18.0%** | [SWE-agent](https://arxiv.org/abs/2405.15793) [^35] | observed |
| Rejection message needs **all three**: error type, attempted result, original content | [SWE-agent](https://arxiv.org/abs/2405.15793) [^35] | observed |
| Structural gate for Java: no leftover markers, parses, no duplicate declarations | [arXiv 2607.27674](https://arxiv.org/html/2607.27674v1) [^13] | observed |

**Answer:** for JS/JSON the cheapest high-value gate is **`node --check` / parse + no leftover conflict markers + no duplicate declarations**, revert on failure, and return the three-part message [^35], [^13]. This directly addresses the 2026-10-17 incident: `src/checkup.mjs` with embedded `<<<<<<<` markers **fails a parse gate**, so a lint-gated edit path would have refused to leave the tree in that state. A "failing-first" test norm composes well — the gate catches syntax, the test catches semantics [^31].

### H26. Planner/applier split at our volume

| Finding | Source | Class |
|---|---|---|
| Aider architect/editor: reasoning model proposes, editor model produces edits | [Aider](https://aider.chat/2024/09/26/architect.html) | advertised-elsewhere |
| Morph Fast Apply: decouple "decide the change" from "produce a valid patch" | [Morph](https://www.morphllm.com/fast-apply-model) | advertised-elsewhere |
| Open/local applier: kortix 7B/1.5B | [kortix-ai](https://github.com/kortix-ai/fast-apply) | advertised-elsewhere |

**Answer:** worth it only if apply-failure rate is a **measured** bottleneck (A1's recipe measures exactly that). At your volume, a single capable model + a strict apply gate is likely cheaper than a second model, and the only open applier needs a GPU you do not have [^22].

---

# Recommended decisions

## 1. Edit-format decision (with measurement recipe)

**Recommendation:** default to **anchored search-replace with a unique, EOL-normalised anchor and a strict parse gate**; keep unified diff (with `@@` headers intact) as the fallback format for any model that under-performs. Do **not** introduce OpenAI V4A `apply_patch` — no evidence supports it for DeepSeek/GLM families, and vendor practice confirms format-family coupling [^38].

**Confirm with the A1 recipe:** replay ~150–300 real repo edits, hold context fixed, vary only format, measure Apply EM + parse-failure + wrong-region rate, per model, ≥2 samples/task. This is the only way to settle a question the literature cannot answer for these two models.

## 2. Landing-train workflow

1. **Pre-flight, no working tree:** `git merge-tree --stdin --write-tree` over the candidate pairs to compute the conflict set [^6].
2. **Order** the train by a conflict graph built from that output; sequence to minimise pairwise file overlap (GitHub's remove-and-reform analogue) [^7].
3. **Land in a scratch worktree**, never the shared tree — this is the direct fix for 2026-10-17.
4. **Abort-first:** on any conflict, resolve **in the object store** (`merge-tree` → resolve blobs → `commit-tree` → `update-ref` [^6]); the shared tree is never mid-merge.
5. `--no-ff` to preserve a bisectable first-parent spine [^8].
6. `rerere.enabled=true`, `rerere.autoUpdate=false`; review with `git rr` before staging [^11].

## 3. Conflict-tool spec — build vs don't-build

| Component | Call |
|---|---|
| Per-hunk decision over `{Left, Right, Base, Both}` + free-form escape hatch, keyed by **chunk hash** | **Build** — the four-value enum plus hash identity is the MergeBERT/VS Code-proven design [^18], [^ebc043] |
| Abstention → `defer_work` | **Build** — this is the highest-value single behaviour [^2], [^2] |
| Whole-file coherence + parse gate + tests before accept | **Build** — mandatory, deterministic, not LLM-judged [^13] |
| Pre-flight conflict computation | **Don't build** — use `git merge-tree --stdin` [^6] |
| Structural merge of JS/JSON | **Adopt if Windows+license verified** — mergiraf [^5b94a2], else don't build |

## 4. Deterministic-first cascade (Windows / Git 2.55)

1. `git merge-tree --stdin --write-tree` pre-flight (object store) [^6].
2. `git rerere` replay with `autoUpdate=false` + review [^11].
3. Per-path `git checkout --ours/--theirs` for trivial cases.
4. Structural merge (mergiraf) for JS/JSON **only if** Windows+license verified — **unverified** [^21].
5. LLM per-hunk resolver with abstention for the residue.
6. Parse gate + tests + whole-file coherence; else `defer_work`.

**Windows/Git-2.55 specifics:** enforce a single EOL policy via `.gitattributes` + `core.autocrlf` [^24]; ensure blobs referenced by any `git apply --3way` exist locally or the 3-way fallback will silently not run [^23]; do not use `--reject` in automated paths [^23].

## 5. Evaluation design

Replay real conflicts as 20-line-context 3-way hunks with the developer's resolution as ground truth [^2]; report the five categories (Exact / Normalized / Conflict / Different / Invalid Markdown) [^2]; use CodeBLEU as the AST-aware metric [^29]; calibrate any LLM judge to **zero false-accepts** before use [^13]; keep the structural gate deterministic [^13]. **Threshold: structural validity must be 100% before a landing is accepted** (F20).

---

# Proposed ROADMAP items (registered, not scheduled)

| # | Item |
|---|---|
| 1 | Edit-format measurement harness for DeepSeek-V4.1-Flash / GLM-5.3-Flash (A1 recipe) |
| 2 | Object-store landing-train workflow: `merge-tree --stdin` → resolve → `commit-tree`/`update-ref` |
| 3 | Conflict-graph ordering for landing trains |
| 4 | Per-hunk resolver tool: 4-value enum + escape hatch + chunk-hash identity + abstention |
| 5 | Deterministic parse gate (markers + `node --check` + duplicate declarations) with revert-on-error |
| 6 | EOL/CRLF-safe anchored search-replace edit path (F32) |
| 7 | `defer_work` abstention surface in the TUI |
| 8 | rerere policy: autoUpdate=false + `git rr` review norm |
| 9 | Untrusted-conflict-content envelope + no-network resolver (Windows mechanism TBD) |
| 10 | Conflict-replay eval harness with calibrated judge |

---

# Explicitly unverified / internal

1. **All durig-internal claims** — the baseline docs were not in the sandbox; `cli.mjs`, `src/seattools.mjs`, `src/checkup.mjs`, the broker, store, TUI, and `dist/tools/edit.js` could not be read.
2. **Windows support and license for mergiraf** [^21], [^39].
3. **Edit-format accuracy for DeepSeek-V4.1-Flash / GLM-5.3-Flash** — no benchmark exists.
4. **Diff-XYZ exact per-model numbers** — two readouts disagree; re-derive from the paper before relying on any figure.
5. **A controlled study of conflict *style* vs LLM resolution accuracy** — not found.
6. **Empirical conflict-rate comparison of merge vs rebase vs cherry-pick** — not found.
7. **Cost/latency of apply models beyond vendor claims** [^40].
8. **Any accepted numeric alert threshold for false merges that pass tests** — none found.
9. **Prompt injection specifically via conflict markers** — not studied; the general IPI vectors are established [^41].
10. **A Windows-native no-network sandbox mechanism** for the resolver.
11. **Optimal landing-train ordering algorithm** — no accepted heuristic found; the conflict-graph approach is practice, not settled.

If you can place the baseline documents in the workspace, I can map each finding to the specific durig mechanisms and tighten items 1–2 of the unverified list.

**References**

[^1]: [[2510.12487v1] Diff-XYZ: A Benchmark for Evaluating Diff Understanding](https://arxiv.org/html/2510.12487v1) (7%)
[^2]: [merge-bench-icpr2026.pdf](https://homes.cs.washington.edu/~mernst/pubs/merge-bench-icpr2026.pdf) (32%)
[^3]: [The Journal of Systems & Software ConflictBench](https://par.nsf.gov/servlets/purl/10515800) (0%)
[^4]: [Unified diffs make GPT-4 Turbo 3X less lazy](https://aider.chat/docs/unified-diffs.html) (0%)
[^5]: [DeepSeek-V4.1-Flash Benchmarks, Pricing & Context Window](https://llm-stats.com/models/deepseek-v4.1-flash) (0%)
[^6]: [Git - git-merge-tree Documentation](https://git-scm.com/docs/git-merge-tree) (14%)
[^7]: [How GitHub uses merge queue to ship hundreds of ...](https://github.blog/engineering/engineering-principles/how-github-uses-merge-queue-to-ship-hundreds-of-changes-every-day/) (0%)
[^8]: [The reason to squash commits is more than just keeping ...](https://news.ycombinator.com/item?id=24686888) (0%)
[^9]: [A tale of five merges, part 3: 'git merge'](https://apenwarr.ca/log/20080323-a-tale-of-five-merges-part-3-git-merge) (0%)
[^10]: [Don't Let Git Cherry-Pick Trick You! Deep Dive into That Hard ...](https://hitzhangjie.medium.com/how-git-cherry-pick-works-a-deep-dive-into-a-silent-code-duplication-bug-3a321c0ab516) (0%)
[^11]: [rerere Autoupdate and Safe Defaults – Git Automation rerere with and without autoupdate Should autoupdate be on here? Expiry settings for different branch lifetimes](https://www.git-automation.com/conflict-resolution-safe-merge-operations/rerere-conflict-automation/rerere-autoupdate-and-safe-defaults/) (7%)
[^12]: [GitHub merge queue is generally available - The GitHub Blog](https://github.blog/news-insights/product-news/github-merge-queue-is-generally-available/) (1%)
[^13]: [[2607.27674v1] Can Large Language Models Resolve Real Java Merge Conflicts? An Evaluation with a Calibrated LLM-as-Judge](https://arxiv.org/html/2607.27674v1) (8%)
[^14]: [Better Git Conflicts with zdiff3 - Ductile Systems](https://www.ductile.systems/zdiff3/) (1%)
[^15]: [Git: Improve conflict display with the zdiff3 style - Adam Johnson](https://adamj.eu/tech/2023/12/29/git-conflict-display-zdiff3/) (1%)
[^16]: [Rerere](https://git-scm.com/book/en/v2/Git-Tools-Rerere) (1%)
[^17]: [Git - git-rerere Documentation](https://git-scm.com/docs/git-rerere) (1%)
[^18]: [raw.githubusercontent.com](https://raw.githubusercontent.com/DJjjjhao/ase-merge/master/Merge%20Conflict%20Resolution-%20Classification%20or%20Generation.pdf) (5%)
[^19]: [Supported languages - Mergiraf](https://mergiraf.org/languages.html) (0%)
[^20]: [Conflicts solved, limitations - Mergiraf](https://mergiraf.org/conflicts.html) (3%)
[^21]: [Installation - Mergiraf](https://mergiraf.org/installation.html) (1%)
[^22]: [kortix-ai/fast-apply](https://github.com/kortix-ai/fast-apply) (0%)
[^23]: [Git - git-apply Documentation](https://git-scm.com/docs/git-apply) (5%)
[^24]: [Configuring Git to handle line endings - GitHub Docs](https://docs.github.com/en/get-started/git-basics/configuring-git-to-handle-line-endings) (1%)
[^25]: [GitHub Copilot prompt injection flaw leaked sensitive data from private ...](https://www.csoonline.com/article/4069887/github-copilot-prompt-injection-flaw-leaked-sensitive-data-from-private-repos.html) (0%)
[^26]: [What Is an Agent Execution Sandbox?](https://www.augmentcode.com/guides/agent-execution-sandbox) (0%)
[^27]: [Practical Security Guidance for Sandboxing Agentic Workflows and ...](https://developer.nvidia.com/blog/practical-security-guidance-for-sandboxing-agentic-workflows-and-managing-execution-risk/) (0%)
[^28]: [AI Agent Sandboxing & Progressive Enforcement](https://www.armosec.io/blog/ai-agent-sandboxing-progressive-enforcement-guide/) (0%)
[^29]: [CodeBLEU: a Method for Automatic Evaluation of Code Synthesis](https://arxiv.org/abs/2009.10297) (0%)
[^30]: [codebleu · PyPI](https://pypi.org/project/codebleu/) (0%)
[^31]: [[2310.02395] Detecting Semantic Conflicts with Unit Tests](https://arxiv.org/abs/2310.02395) (1%)
[^32]: [Detecting Semantic Conflicts with Unit Tests - arXiv.org](https://arxiv.org/pdf/2310.02395) (1%)
[^33]: [AI-Assisted Merge Conflict Resolution: How GitKraken ...](https://www.linkedin.com/pulse/ai-assisted-merge-conflict-resolution-how-gitkraken-eliminates-lpmxc) (0%)
[^34]: [Resolve Merge Conflicts Faster with AI](https://www.componentsource.com/news/2025/07/08/resolve-merge-conflicts-faster-ai) (0%)
[^35]: [[2405.15793] SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering](https://arxiv.org/abs/2405.15793) (6%)
[^36]: [[Bug]: patch/V4A fuzzy hunk match can bind to wrong ...](https://github.com/NousResearch/hermes-agent/issues/93698) (1%)
[^37]: [Edit tool: fuzzy anchor fallback silently applies a misaligned ...](https://github.com/can1357/oh-my-pi/issues/10454) (0%)
[^38]: [apply_patch vs str_replace vs unified diff: the edit format as ...](https://medium.com/@wasowski.jarek/harness-engineering-apply-patch-vs-str-replace-vs-unified-diff-the-edit-format-as-a-harness-92ce33b45c1d) (0%)
[^39]: [Releases - mergiraf/mergiraf](https://codeberg.org/mergiraf/mergiraf/releases) (1%)
[^40]: [Morph Fast Apply vs Claude, Cursor, Aider & String Replace](https://www.morphllm.com/comparisons) (0%)
[^41]: [CodeIPI: Indirect Prompt Injection for Coding Agents](https://ukgovernmentbeis.github.io/inspect_evals/evals/ipi_coding_agent/) (1%)


---------------


Here is the Durig Project, for you to reference: https://github.com/chexxor/Pi-OpenDurig



---------------


I have the repo. Now let me read the actual durig mechanisms the report must map to.Let me read the remaining durig surfaces: confinement, the roadmap, the working-tree safety research, and the seat guard.Let me read the shared-working-tree safety research, the roadmap tail (items 100–101), and check for the named runbooks.I've read the repo. This resolves almost every "internal — unverified" item from the follow-up report — and it surfaces **four corrections that change the recommendations**, including one that invalidates a step the first pass told you to adopt. Below is the grounded follow-up report (delivered inline; the workspace is read-only so I could not create `docs/reviews/llm-prompting-for-git-merging-followup.md`).

---

# Follow-up report, grounded in `Pi-OpenDurig` (`main`)

Sources read directly: repo tree + README [^1], `src/seattools.mjs` [^2], `src/checkup.mjs` [^3], `cli.mjs` [^4], `src/worktree.mjs` [^5], `src/confine.mjs` [^6], `src/seatguard.mjs` [^7], `docs/ROADMAP.md` [^8], `docs/runbooks/README.md` [^9], `docs/Shared_Working_Tree_Safety_Research.md` [^10], `docs/failing-first-recipe.md` [^11], `docs/SEAT-TOOLS.md` [^12].

---

## 0. Corrections — where the repo contradicts the first/follow-up report

**C1 (decisive). The recommended deterministic-first step "per-path `git checkout --ours/--theirs`" is refused by durig's own guard.** `DENIED_COMMANDS` matches `/git\s+checkout\b/i` and refuses it with "would change the seat's working tree or HEAD" [^f8e6f0#47]. `git reset`, `git restore`, `git clean`, `git stash`, `git revert`, and `git branch -D` are refused too [^6], as are the `git -C <path> …` redirects [^6]. **`git merge`, `git rebase`, `git apply`, `git worktree`, and `git merge-tree` are *not* denied.** So any resolver that runs as a seat cannot use `checkout --ours/--theirs`; the ours/theirs primitive has to move to the operator/delegate path, or be replaced by a `read`+`write` of the chosen blob content.

**C2. The named baseline artifacts do not exist on `main`.** The follow-up request says the safe conclusions were "folded into `docs/runbooks/resolve-merge-conflict.md`" and a pre-flight was "added to `merge.md`'s orbit", and names `docs/reviews/llm-prompting-for-git-merging.md`, `docs/reviews/landing-safety-2026-10-17.md`, and "ROADMAP items 100–101". **None of these appear in the tree I read.** `docs/runbooks/` holds only `README.md`, `_template.md`, `broker-down-or-stalled.md`, `broker-safe-change.md`, `daemon-not-running.md`, `format-before-commit.md`, `leaked-worktrees.md`, `research-request.md`, `seat-reset.md`, `store-corruption-recovery.md` [^1], and the runbook index lists five runbooks with no merge runbook [^9]. `docs/reviews/` holds no merge report [^1]. ROADMAP's highest numbered items are 91–99 (plus 92–97, O1–O4, 60–67, 73–88) [^8] [^8]. **Treat those five citations as unverified; if the files exist they are on another branch or were never committed.**

**C3. The incident mechanism is confirmed exactly, and is worse than "one verb".** `cli.mjs` statically imports `auditRig` from `./src/checkup.mjs` [^28e1af#71], and `src/seattools.mjs` imports `seatsAreVerifier` from `./checkup.mjs` [^21242c#17]. `checkup.mjs` imports only `./ansi.mjs` [^6b0a97#25]. A `<<<<<<<` marker left in `checkup.mjs` therefore breaks **both** `cli.mjs` *and the seat-tools extension module* — which is why "every `node cli.mjs` verb" was a `SyntaxError`. A merge conflict in `checkup.mjs` is a single point of failure for the whole CLI surface.

**C4. `docs/SEAT-TOOLS.md` is stale against `src/worktree.mjs` on the node_modules bridge.** SEAT-TOOLS says the worktree "bridges `node_modules` with a junction" [^12]; `worktree.mjs` says the bridge was **removed in #330** and each worktree instead runs `npm ci --prefer-offline` (~12 s, ~111 MB), because "Git 2.42 on this host deletes THROUGH a junction, which would destroy the live tree's node_modules" [^5] [^769730#243]. The code is the safer of the two; the doc is the drift. This matters because the research doc's junction hazard [^10] is already fixed in code.

---

## 1. The actual tool surface (the substrate every recommendation must fit)

| Fact | Value | Source |
|---|---|---|
| Seat tools | `read`, `write`, `edit` (exact-match), `shell` (**PowerShell**), `prepare_workspace` | [^2] |
| `bash` | deliberately absent (Windows Git Bash is an undeclared dependency) | [^2] |
| `apply_patch` | **does not exist** — confirmed | [^2] |
| Coordinator seats (`pm`, `lead`) | lose `read`+`write`+`edit`+`shell`+`prepare_workspace` (`COORDINATOR_REMOVALS`) | [^21242c#151] |
| Verifier seats | lose `write`+`edit`; keep `read`, `shell`, `prepare_workspace` | [^21242c#141] |
| Shell confinement | `exec` forces `cwd = confinedRoot`, `inheritEnv: false`, allowlisted env | [^6] |
| Write guard | refuses stray control bytes and a multi-line-source→one-line collapse | [^7] |
| Default model | `zai-org/GLM-5.3-Flash`; DeepSeek-V4.1-Flash is the observed `impl` model | [^28e1af#121], [^8] |

**Two consequences the first pass could not see:**

1. **A `defer_work` to a coordinator cannot carry a file.** `pm`/`lead` have *no* `read` tool [^21242c#151], and the code already reasons about this: an over-threshold tool result must arrive **inline** for a seat that cannot dereference [^2]. So the abstention surface (question G22) must embed the base/ours/theirs payload and chunk hash **in the deferral text**, not as a path.
2. **The edit tool is exact-match and LF-normalizing, returning a `patch`.** That is the format the first pass's Diff-XYZ table says is *mid-tier*, and it collides with F32/CRLF (below).

---

## 2. Per-question resolution (A–H), now grounded

### A. Our models and edit formats

**A1 — evidence for DeepSeek-V4-class / GLM-5.3-class edit format: none exists, and the repo already contains the measurement rig to get it.** No controlled edit-format benchmark covers these two families (Diff-XYZ covers GPT/Claude/Gemini/Qwen) [^6eee92#236-242]. What the repo adds:
- The measurement recipe from the first pass (replay real repo edits, hold context fixed, vary only format) maps cleanly onto durig because **git history is the ground truth and the demo suite is the harness** — durig already has a "failing-first" discipline and a per-item worktree to run it in [^a126f1#296].
- durig's own **format verb is already a registered, unscheduled roadmap item** (`node cli.mjs format [--check] [-- <paths>]`, item 90), proposed precisely because the tree is mixed-indent and EOL drift is live [^8]. The edit-format measurement should ride the same item.
- **Do not adopt V4A `apply_patch`** — there is no `apply_patch` in the harness [^2], and adding one for a non-GPT family has no supporting evidence.

**A2 — structured output / per-hunk enum reliability.** DeepSeek supports JSON mode but tool-call strict mode is Beta; GLM supports structured output via the OpenAI tools format (both `observed`-docs, from the first pass). The durig-specific consequence: **the enum should not be the tool-call schema.** Because `defer_work` carries only a text question and coordinator seats cannot read files [^21242c#151], the highest-reliability shape is Merge-Bench's: *return the whole resolved snippet with the markers replaced*, and let durig parse it — not a JSON object per hunk.

**A3 — payload scale and cache stability.** The repo settles this: the constitution is read **per request**, so one edit "invalidates **every seat's cached prefix at once**", and DeepInfra retention is 5 min/1 h with a `prompt_cache_key` [^8]. **Answer: a full base/ours/theirs payload per hunk is fine at the configured window, but it must go *after* the byte-stable prefix** (persona + `constitution.txt` + the PROTOCOL primer [^4]), never interleaved before it. Note the configured window is **1,048,576** in the curated catalog for both models, while Z.AI's own operating point is 300K [^8] — so "fits the window" is not the same as "is usable".

### B. Landing a train of branches

**B4 — pre-flight with no working tree: yes, and it is the fix for the incident.** `git merge-tree --stdin --write-tree` computes the conflict set for many merges in one invocation and is **not** in `DENIED_COMMANDS` [^6], so it is available on the operator path. This is the single strongest architectural answer to the 2026-10-17 incident: the shared tree never enters `MERGE_HEAD`.

**B5 — ordering.** No accepted heuristic; the conflict-graph approach is practice, not settled science (first pass). durig has the ingredients — `RigQueue` carries `from`/`to` and a status machine [^1].

**B6 — merge vs rebase vs cherry-pick.** `git merge` and `git rebase` are both permitted by the guard; `git checkout` (needed to move branches) is **not** [^f8e6f0#47]. `rebaseItemBranch` exists but requires a checked-out branch [^5], while `prepareSeatWorkspace` creates worktrees **detached** [^769730#124] — so the rebase helper is currently unreachable from a seat worktree. For the operator's landing, `--no-ff` is the defensible choice (first pass).

**B7 — rerere hazards: durig's current setting is already the safe one, with a caveat.** `claimWorktree` enables rerere via `git -C <wt> config rerere.enabled true` [^5], and `autoUpdate` is **not** set → default `false`, which is exactly the auditable default the first pass recommends. **Caveat:** that `git config` writes to the *common* `.git/config`, so it is repo-wide, not per-worktree — the `rr-cache` and the setting are shared across all seats' worktrees.

**B8 — resolving entirely in the object store: yes, and it is the direct fix.** `merge-tree --write-tree` → resolve blobs → `git commit-tree` → `git update-ref` touches no working tree; none of those verbs is denied [^6]. This is the change that keeps a shared tree out of a conflicted state while the rig is live. **Add the missing guard the repo doesn't yet have:** nothing prevents a *seat* from running `git merge` in the shared tree if its cwd were ever pointed there — but `prepare_workspace`/`makeSeatEnv` confine seats to their own worktree, and `makeSeatEnv` **fails closed** to read-only for an unknown conversation [^2].

**New hazard the repo reveals (not in the first pass):** `createWorktree` forks `HEAD` **and then carries the shared tree's visible (dirty) state into the new worktree** via `carryVisibleState`, which copies every dirty path that exists on disk [^5]. An unmerged file shows as `UU` in `git status --porcelain` and **would be copied into the new seat worktree with its `<<<<<<<` markers**. So a worktree created while the shared tree is mid-merge *propagates the conflict*. `prepareSeatWorkspace`'s reuse path is idempotent, but the carry path is not conflict-aware.

### C. Conflict representation and prompt

**C9 — `merge.conflictStyle`.** Both leading LLM merge benchmarks feed a **diff3-style 3-way (base included)** (first pass); no study measures LLM accuracy by style. durig does not currently pin `merge.conflictStyle` anywhere I could find. Recommendation unchanged: set `zdiff3` for the operator's review surface and feed the model base+ours+theirs.

**C10 — hunk sizing for `#714`'s ~75-line additive regions.** Merge-Bench caps each side at 20 lines / 512 tokens and prevents a hunk spanning multiple conflicts. For purely additive/union regions, a single `Both` decision is the safe closed-set case; escalate rather than blind-split beyond the caps.

**C11 — hunk identity.** Hash the conflict chunk (rerere's model), key by path+hash. durig's guard denies `git checkout`, so a decision tool cannot "re-check out" a file to re-read it; the chunk hash must be computed from the file the resolver already read via the `read` tool.

**C12 — closed-set taxonomy.** Unchanged: enum where the correct result is a subsequence/concat of {base, ours, theirs}; generation where it needs new tokens (refactoring is ~22% of conflicts). The enum needs four values (Left/Right/Base/Both), not the two in the request's example.

### D. Deterministic-first tooling

**D13 — mergiraf.** JS+JSON supported, conservative, tree-sitter+GumTree; **Windows support and licence remain unverified** (first pass). **New durig constraint:** even if mergiraf were adopted, it would run as a `shell` (PowerShell) command inside the confined env [^6] — feasible, but its own subprocess behaviour under `inheritEnv:false`/`cwd=root` is untested.

**D14 — open/local apply models.** Only kortix-ai's 7B/1.5B are open/local; Morph and Relace are hosted (network egress, which durig's env strips anyway). **Verdict: impractical at this volume.** durig already has a two-stage shape in spirit — `edit` returns a `patch` [^21242c#124].

**D15 — `git apply --3way`.** `git apply` is **not** denied [^6], so it is available; the first-pass failure modes stand (blob-identity mismatch, atomic failure, `--reject` incompatible with `--3way`). **CRLF is the live risk** (F32, below).

### E. Untrusted content and safety

**E16 — injection through conflict text.** No conflict-marker-specific study (first pass). durig already has the relevant posture: the constitution is a priority-ordered, byte-stable prefix [^4], and the shell env is allowlisted with secret-shaped names refused [^6]. **Add:** treat base/ours/theirs as untrusted data, emit only a code snippet, and strip markdown-hidden constructs.

**E17 — reduced privilege / no network: durig already does this, natively, without Docker/WSL.** This is a genuine strength the first pass could not see:
- Path confinement via a decorating `ExecutionEnv` covering *both* the file tools and `exec` [^6].
- `inheritEnv:false` + a 12-name allowlist; `SECRET_NAME` refuses key/token/secret-shaped vars even if requested [^6].
- **No network capability** is minted (codemode's first cut adds none [^8]); the guard refuses `wsl`/`docker` structurally [^6].
- Verifier seats work on a **disposable snapshot** and cannot mutate the artifact they verify [^6], [^12].
- The write guard refuses the two observed corruption shapes [^7].
- **The residual, stated plainly in-repo:** a verifier's *shell* can still write, bounded only by the disposable worktree [^12], and every seat runs as the same Windows user (`D-ENV-AUTH`), so the confinement is filesystem-semantic, not OS-identity [^6].

**Windows-native no-network sandbox: durig's answer is "the env decorator + allowlist + structural refusals", not a VM.** The research doc confirms VM-grade isolation is unreachable without Docker/WSL, and that Codex's Windows restricted-token approach leaves `%TEMP%`/`Everyone`-SID gaps [^10] [^a126f1#210]. This closes the first pass's unverified item #10 **partially** — a mechanism exists and is implemented; it is process/filesystem confinement, not a sandbox.

### F. Evaluation and acceptance

**F18 — a durig-specific merge eval.** Build it by replaying durig's own past conflicts; the repo gives the ground truth (git history) and the runner (the demo suite, one runnable proof per guarantee [^1]). Metrics and thresholds unchanged (Exact / Normalized / Conflict / Different / Invalid Markdown; structural validity must be 100%). **Reuse `src/judge.mjs`** — durig already has a blind pairwise judge used for the optimizer [^8a6e7a#549] — but calibrate it, because the first pass's ConflictAgent finding is that an LLM judge accepted 4 of 5 structurally invalid resolutions. Keep the structural gate deterministic.

**F19 — evaluating conflict detection/ordering.** ConflictBench is the accepted third-party benchmark (first pass); score `merge-tree --stdin` as a classifier.

**F20 — alert thresholds for false merges that pass tests.** No industry standard exists (first pass). The defensible gate: structural validity 100% + the test suite.

### G. Human/operator surface

**G21 — presenting resolutions.** The trust pattern (show base/ours/theirs, per-hunk decision, confidence, accept/adjust/reject) is unchanged. **durig-specific:** the read surface is `status`/`watch` attention notices riding the existing channel [^1], and the TUI loads a seat's transcript (roadmap item 89) [^8]. A per-hunk confidence should surface as an attention notice, not a new screen — durig's design rule is "nothing is drawn while everything is in band" [^1].

**G22 — abstentions as `defer_work`.** This maps **exactly**. `defer_work(itemId, question[, to])` parks a claimed item and surfaces `deferred_awaiting_answer` on the attention channel [^8]. Two durig constraints: (a) coordinator seats cannot read files, so the question must be self-contained [^21242c#151]; (b) a deferral that `to` a seat goes through `assertSendAllowed` [^8], so the escalation target must be edge-reachable.

### H. Edit-tool design in general

**H23 — centered-window reads.** SWE-agent's numbers stand (100-line window best). **durig-specific:** the `read` tool is pi-durable's; the seam that must respect this is the same one the thin-context contract already uses — `thinResultText` returns a path past a threshold [^8], and `toolText()` is the single formatting seam [^8]. A centered-window read is a change to that seam, not a new tool.

**H24 — fuzzy matching and CRLF (F32).** **The repo confirms F32 as a live, named hazard**: `edit` is LF-normalizing, `core.autocrlf=true` with no consistent `.gitattributes` produced the `starter.test.mjs` CRLF/LF drift (#328), and item 90 exists because "an LF `oldText` never matches a CRLF `rig.mjs`" [^8] [^8]. **The safe fuzz is whitespace/EOL-insensitive exact matching on a unique anchor — never positional or similarity-based fallback.** durig's own failing-first recipe already encodes "refuse what you cannot resolve" [^11], and the research doc's enumeration of bypass classes shows why any similarity fallback is a silent-wrong-region risk [^10].

**H25 — lint/parse gate and revert-on-error.** SWE-agent's flake8 gate (+3% absolute) stands. **durig's equivalent is `node --check` + no leftover conflict markers + no duplicate declarations.** The repo makes this concrete: a parse gate on `src/checkup.mjs` would have refused to leave the 2026-10-17 tree in a state where **every CLI verb** was a `SyntaxError` [^28e1af#71], [^21242c#17]. The `seatguard` write refusals are the existing precedent for a deterministic gate that reverts and explains [^7]. "Failing-first" is already a durig norm with a pasteable recipe [^11].

**H26 — planner/applier split.** Only worth it if apply-failure is a *measured* bottleneck (first pass). durig's `edit` returns a `patch` [^21242c#124], which is already the "applier produces a mechanically valid patch" half.

---

## 3. Updated recommendations for durig's actual stack

### 3.1 Edit-format decision

**Default to anchored search-replace with a unique, EOL-normalized anchor and a deterministic parse gate; keep unified diff (with `@@` headers) as the fallback.** Do **not** add `apply_patch`. Confirm with the A1 measurement recipe run through the demo suite, riding roadmap item 90's `format` verb so the EOL policy is fixed once [^8].

### 3.2 Landing-train workflow (the fix for 2026-10-17)

1. **Pre-flight, no working tree:** `git merge-tree --stdin --write-tree` over the candidate pairs [^6].
2. **Order** by a conflict graph from that output.
3. **Land in a scratch worktree, never the shared tree** — durig already has `node cli.mjs worktree` and the per-item lifecycle [^5], [^4].
4. **Abort-first:** on any conflict, resolve in the **object store** (`merge-tree` → resolve → `commit-tree` → `update-ref`); the shared tree never enters `MERGE_HEAD`.
5. `--no-ff` to preserve a bisectable spine.
6. `rerere.enabled=true`, `autoUpdate=false` — **already durig's setting** [^5]; add the `git rr` review norm.
7. **New:** make `carryVisibleState` conflict-aware — refuse (or warn) when a carried path is unmerged, so a worktree created mid-merge does not inherit markers [^5].

### 3.3 Conflict-tool spec — build vs don't-build, corrected

| Component | Call |
|---|---|
| Per-hunk decision over `{Left, Right, Base, Both}` + free-form escape hatch, keyed by **chunk hash** | **Build** |
| Abstention → `defer_work`, **payload inline** (coordinators cannot read) | **Build** [^21242c#151] |
| Deterministic parse gate + whole-file coherence + tests before accept | **Build** — mandatory |
| Pre-flight conflict computation | **Don't build** — `git merge-tree --stdin` [^6] |
| **ours/theirs via `git checkout --ours/--theirs`** | **Do not use — denied by durig's guard** [^f8e6f0#47]. Implement as read+write of the chosen blob, or move it to the operator path |
| Structural merge of JS/JSON (mergiraf) | **Adopt only if Windows+licence verified** (unverified) |

### 3.4 Deterministic-first cascade, corrected for Windows / Git 2.55 / durig's guard

1. `git merge-tree --stdin --write-tree` pre-flight (object store) — *allowed*.
2. `git rerere` replay, `autoUpdate=false` + `git rr` review — *already enabled* [^5].
3. **Chosen-side resolution via read+write of blob content** (not `git checkout --ours/--theirs`, which the guard refuses [^f8e6f0#47]).
4. Structural merge (mergiraf) for JS/JSON **only if** Windows+licence verified.
5. LLM per-hunk resolver with abstention for the residue.
6. Parse gate (`node --check`) + tests + whole-file coherence; else `defer_work`.

**Windows/Git-2.55 specifics:** enforce one EOL policy via `.gitattributes` + `core.autocrlf` (#328, F32) [^8]; keep worktree paths short (MAX_PATH) [^a126f1#402]; never `git apply --reject` in an automated path; ensure any `--3way` blobs exist locally.

### 3.5 Evaluation design

Replay durig's own conflicts as 20-line-context 3-way hunks; report the five categories; reuse but calibrate `src/judge.mjs` [^8a6e7a#549]; keep the structural gate deterministic; **structural validity must be 100% before a landing is accepted.** Run it through the demo suite's one-runnable-proof-per-guarantee convention [^1].

---

## 4. Proposed ROADMAP items (registered, not scheduled — `pm` sequences)

| # | Item |
|---|---|
| 1 | Edit-format measurement harness for DeepSeek-V4.1-Flash / GLM-5.3-Flash (rides item 90's `format` verb) |
| 2 | Object-store landing-train workflow: `merge-tree --stdin` → resolve → `commit-tree`/`update-ref` |
| 3 | Conflict-graph ordering for landing trains |
| 4 | Per-hunk resolver: 4-value enum + escape hatch + chunk-hash identity + inline abstention via `defer_work` |
| 5 | Deterministic parse gate (`node --check` + no markers + no duplicate declarations) with revert-on-error |
| 6 | **Make `carryVisibleState` conflict-aware** (do not carry an unmerged path into a new worktree) |
| 7 | A merge runbook (`docs/runbooks/resolve-merge-conflict.md`) + a `merge.md` pre-flight section — **these do not exist today** |
| 8 | Chosen-side resolution without `git checkout` (read+write of blob content), since the guard refuses checkout |
| 9 | Untrusted-conflict-content envelope (base/ours/theirs as data; snippet-only output) |
| 10 | Conflict-replay eval harness with a calibrated judge, reusing `src/judge.mjs` |

---

## 5. Explicitly unverified / still open

1. **`docs/reviews/llm-prompting-for-git-merging.md`, `docs/reviews/landing-safety-2026-10-17.md`, `docs/runbooks/merge.md`, `docs/runbooks/resolve-merge-conflict.md`, and "ROADMAP items 100–101" are not present on `main` as I read it** — see C2. I read the default branch; they may exist elsewhere.
2. **mergiraf Windows support and licence** — unverified (first pass).
3. **Edit-format accuracy for DeepSeek-V4.1-Flash / GLM-5.3-Flash** — no benchmark exists.
4. **Diff-XYZ per-model numbers** — two readouts disagree; re-derive before relying.
5. **A controlled study of conflict *style* vs LLM accuracy** — not found.
6. **Empirical conflict-rate comparison of merge/rebase/cherry-pick** — not found.
7. **Whether `git config rerere.enabled true` from a worktree is truly repo-wide** — the code path implies it writes the common config [^5]; not confirmed against a live multi-worktree repo.
8. **A Windows-native no-network sandbox** — durig has filesystem confinement + env allowlist, not a sandbox; VM-grade is unreachable without Docker/WSL [^a126f1#210].
9. **Prompt injection specifically via conflict markers** — not studied.
10. **Optimal landing-train ordering** — no accepted heuristic.

If you can tell me the branch where the merge runbooks and the `landing-safety-2026-10-17` review live, I'll map the incident analysis to the exact steps and tighten C2.

**References**

[^1]: [chexxor/Pi-OpenDurig GitHub Repo](https://github.com/chexxor/Pi-OpenDurig) (5%)
[^2]: [raw.githubusercontent.com](https://raw.githubusercontent.com/chexxor/Pi-OpenDurig/main/src/seattools.mjs) (4%)
[^3]: [raw.githubusercontent.com](https://raw.githubusercontent.com/chexxor/Pi-OpenDurig/main/src/checkup.mjs) (1%)
[^4]: [raw.githubusercontent.com](https://raw.githubusercontent.com/chexxor/Pi-OpenDurig/main/cli.mjs) (5%)
[^5]: [raw.githubusercontent.com](https://raw.githubusercontent.com/chexxor/Pi-OpenDurig/main/src/worktree.mjs) (9%)
[^6]: [raw.githubusercontent.com](https://raw.githubusercontent.com/chexxor/Pi-OpenDurig/main/src/confine.mjs) (24%)
[^7]: [raw.githubusercontent.com](https://raw.githubusercontent.com/chexxor/Pi-OpenDurig/main/src/seatguard.mjs) (8%)
[^8]: [raw.githubusercontent.com](https://raw.githubusercontent.com/chexxor/Pi-OpenDurig/main/docs/ROADMAP.md) (33%)
[^9]: [raw.githubusercontent.com](https://raw.githubusercontent.com/chexxor/Pi-OpenDurig/main/docs/runbooks/README.md) (1%)
[^10]: [raw.githubusercontent.com](https://raw.githubusercontent.com/chexxor/Pi-OpenDurig/main/docs/Shared_Working_Tree_Safety_Research.md) (7%)
[^11]: [raw.githubusercontent.com](https://raw.githubusercontent.com/chexxor/Pi-OpenDurig/main/docs/failing-first-recipe.md) (1%)
[^12]: [raw.githubusercontent.com](https://raw.githubusercontent.com/chexxor/Pi-OpenDurig/main/docs/SEAT-TOOLS.md) (3%)



---------------

Here is the merge doc: https://github.com/chexxor/Pi-OpenDurig/blob/main/docs/runbooks/merge.md.
Here is the landing safety doc: https://github.com/chexxor/Pi-OpenDurig/blob/main/docs/reviews/landing-safety-2026-10-17.md

---------------


I'll read the attached prompt document and both linked docs.I now have the three durig artifacts that were missing from the sandbox. Two of my previous corrections (C2, and part of C1) are **overturned** — the runbook, the incident review, and ROADMAP 100–101 all exist and are substantive. I've re-grounded the follow-up report on them.

The workspace is read-only, so I cannot create `docs/reviews/llm-prompting-for-git-merging-followup.md`; **the report is delivered inline below** in the exact section order the request specifies.

---

# Retractions first (what the new docs change)

| Prior claim | Status now | Evidence |
|---|---|---|
| "`docs/runbooks/merge.md`, `landing-safety-2026-10-17.md`, ROADMAP 100–101 do not exist on `main`" | **WRONG — retracted.** All three exist and are substantive. | [^1] [^2] [^3] [^3] |
| "`merge-tree --write-tree` pre-flight added to `merge.md`" | **Not in the file I read.** `merge.md`'s Diagnose block uses only `git branch`, `git rev-list`, `git worktree list`. The claimed pre-flight is absent. | [^1] |
| "ours/theirs via `git checkout --ours/--theirs`" | Still refused by the guard (C1 stands); the runbook instead resolves inside the merge commit or aborts. | [^1] |
| "#714 resolved to a union; a side-picking enum is sufficient" | **Corrected by the incident review itself:** the union "was semantic, not ours-or-theirs… needed **synthesis**, so a side-picking chunk tool alone would have been wrong." | [^2] |

Also flagging two **internal discrepancies** I observed and could not resolve:
- The request says the adopted conclusions live in `docs/runbooks/resolve-merge-conflict.md`, but I could not confirm that file exists on `main` (my tree read of `docs/runbooks/` did not list it). **internal — unverified.**
- `merge.md` frontmatter declares `writes: false` while its Do section performs `git merge` on the shared tree — presumably "no store writes", but the metadata understates the working-tree blast radius. **internal — observed inconsistency.** [^1] [^1]

---

# Per-question answers

## A. Our models and edit formats

**A1 — DeepSeek-V4-class / GLM-5.3-class edit-format evidence.** No controlled edit-format benchmark covers these families; Diff-XYZ covers GPT/Claude/Gemini/Qwen only — *observed (absence)* [^6eee92#236-242]. The repo's own tool surface settles the practical question: `edit` is exact-match, LF-normalizing, returns a `patch`, and **there is no `apply_patch`** [^21242c#121-127]. So V4A is not merely unevidenced for these models — it is unavailable without building it. Aider's counter-result (unified diff beat SEARCH/REPLACE for GPT-4 Turbo, 20%→61%) is *advertised-elsewhere* and family-specific [^d36656].

**Cheapest accepted measurement recipe on our repo** (adapted from Diff-XYZ's controlled design [^6eee92#268-278]) — and it should ride ROADMAP item 90's `format` verb, which already exists because "an LF `oldText` never matches a CRLF `rig.mjs`" [^6c3124#495-512]:
- **Task set:** replay ~150–300 real durig commits (git history is ground truth); hold context fixed and vary **only** the format string.
- **Formats:** unified diff (headers intact) · unified diff (relaxed header) · anchored search-replace · native exact-match `edit`.
- **Metrics:** Apply EM, parse-failure rate, and a **wrong-region apply** count (H24).
- **Scale reference:** Merge-Bench 7,938 hunks; ConflictBench 180 scenarios [^1f177f#4-5] [^fa99db].
- **Caveat:** two readouts of Diff-XYZ disagree on exact numbers; re-derive before relying [^6eee92#279-289].

**A2 — structured output for enum + escape hatch.** DeepSeek JSON mode works but tool-call strict mode is Beta; GLM supports structured JSON via the OpenAI tools format — *observed (docs)*. Durig-specific consequence: **do not make the enum the tool-call schema.** Because coordinator seats have no file tools, a deferral must be self-contained [^21242c#151], so the reliable shape is Merge-Bench's: return the whole resolved snippet with markers replaced, and parse it [^1f177f#7-7]. Known failure modes to guard: emitting a diff when the resulting code was requested (>10% of GPT-4.1 Apply errors) and out-of-order hunks when `@@` headers are stripped [^6eee92#279-289] [^6eee92#350-366].

**A3 — payload scale and cache stability.** A full base/ours/theirs payload per hunk fits the configured 1,048,576 window, but Z.AI's own operating point is 300K, so "fits" ≠ "usable" [^6c3124#1342-1352]. **Yes, it destabilizes a byte-stable prefix if interleaved before it** — the constitution is read per request and invalidates every seat's cached prefix at once [^6c3124#810-821]. Put persona + `constitution.txt` + PROTOCOL primer first, unchanged, then all variable content [^28e1af#398-412]. Merge-Bench's caps are the right guard: ≤20 lines/side, conflict ≤512 tokens [^1f177f#4-5].

## B. Landing a train of branches

**B4 — pre-flight with no working tree: yes.** `git merge-tree --stdin --write-tree` computes the conflict set for many merges in one invocation and is **not** in `DENIED_COMMANDS` [^b84e52#284-347] [^f8e6f0#34-79]. **This is the fix the incident review is reaching for but does not name** — and note it is *not yet* in `merge.md`, despite the request saying it was added [^1]. Parsing rules: parse the conflicted-file section not the tree; don't treat an empty list as clean — check exit status; never re-merge the stage OIDs [^b84e52#468-518].

**B5 — ordering.** No accepted heuristic exists; the conflict-graph approach is practice, not settled science. GitHub's merge queue auto-detects conflicting PRs and removes them, re-forming groups — the production analogue [^3d481a]. durig has the ingredients: `RigQueue` carries `from`/`to` and a status machine.

**B6 — merge vs rebase vs cherry-pick.** No controlled conflict-rate study found — **unverified**. For a landing train, `--no-ff` is defensible: it preserves a bisectable first-parent spine and does not rewrite verified commits [^17752e]. The runbook already mandates exactly this [^1]. Note `git checkout` (needed to move branches) is guard-denied, and `prepareSeatWorkspace` creates worktrees **detached**, so `rebaseItemBranch` (which needs a checked-out branch) is unreachable from a seat [^769730#124] [^769730#563-573].

**B7 — rerere hazards.** durig's setting is already the safe one: `rerere.enabled true` set in `claimWorktree`, `autoUpdate` unset → default `false` [^769730#552-556]. Recommended team posture: enabled=true, autoUpdate=**false**, expiry matched to branch lifetime, mandatory `git rr` review, never autoupdate on a shipping branch [^844855#65-76]. **Caveat:** that config writes the *common* `.git/config`, so it is repo-wide across all seat worktrees — **internal — unverified against a live multi-worktree repo.**

**B8 — resolve entirely in the object store: yes, and it is the strongest architectural answer.** `merge-tree --write-tree` → resolve blobs → `git commit-tree` → `git update-ref`; none of those verbs is denied [^b84e52#420-453] [^f8e6f0#34-79]. The shared tree never enters `MERGE_HEAD`. This directly satisfies the incident review's Acceptance: "A landing pass never exposes a `MERGE_HEAD`/conflicted working tree to the live rig" [^2]. **New hazard the repo reveals:** `createWorktree` forks HEAD and then carries the shared tree's *dirty* state into the new worktree via `carryVisibleState`; an unmerged `UU` file **would be copied with its markers** — so a worktree created mid-merge propagates the conflict [^769730#154-188].

## C. Conflict representation and prompt

**C9 — `merge.conflictStyle`.** Both leading LLM merge benchmarks feed a **diff3-style 3-way (base included)** — *observed* [^1f177f#4-5] [^4b9107#336-351]. Human-facing sources favour **zdiff3** [^0b3a81]. No study measures LLM accuracy *by style* — **unverified.** durig pins neither; set `zdiff3` for the operator surface and feed base+ours+theirs.

**C10 — hunk sizing for #714's ~75-line additive regions.** Merge-Bench caps each side at 20 lines / 512 tokens and prevents a hunk spanning multiple conflicts [^1f177f#4-5]. For purely additive regions, a single `Both` decision is the safe closed-set case. **But the incident review is the decisive local evidence:** the #714 union "needed synthesis, so a side-picking chunk tool alone would have been wrong" [^2]. Split only when concerns are independent; escalate beyond the caps.

**C11 — hunk identity.** Hash the conflict chunk (rerere's model), key by path+hash; rerere matches by **content, not path**, so review with `git rerere diff` [^844855#165-167] [^acb3f4]. Because the guard denies `git checkout`, the resolver cannot re-checkout to re-read — the chunk hash must be computed from the file it already read via `read`. Carry renames from merge-tree's informational messages, which re-merging stage OIDs loses [^b84e52#468-518].

**C12 — closed-set taxonomy.** MergeBERT's nine primitive patterns (choose O/A/B, concat A+B, and combinations) are the closed set [^dac7e3#260-267]; classification **cannot produce new tokens**, generation can [^dac7e3#93-102]. Refactorings are involved in **22%** of conflicts and are not expressible as choose-a-side — *observed* (SANER 2019). The enum needs **four values** (Left/Right/Base/Both), plus a free-form escape hatch for the synthesis case #714 actually hit.

## D. Deterministic-first tooling

**D13 — mergiraf.** JS (`.js/.jsx/.mjs/.cjs`) and JSON supported; tree-sitter + GumTree; conservative — "errs on the side of caution and retains conflict markers" — *observed (docs)* [^5b94e2#26-26] [^5b94e2#44-52]. Failure modes: order-dependent insertions left as conflicts; duplicate JSON keys → conflict [^9d2cf6#86-87] [^9d2cf6#333-353]. **Windows support and licence remain unverified** [^56245e#11-14]. Even if adopted, it would run as a PowerShell command under `cwd=root`, `inheritEnv:false` [^f8e6f0#297-313].

**D14 — apply models.** Only kortix-ai's 7B/1.5B are open/local [^1683c6]; Morph (98% claimed) and Relace are hosted — *advertised-elsewhere, vendor benchmark* [^cb6264] [^cd20e7] — and network egress is stripped anyway. **Impractical at this volume** (4 conflicts / 15 branches in the motivating pass [^2]).

**D15 — `git apply --3way`.** `git apply` is not denied [^f8e6f0#34-79]. Failure modes: needs blob identity **and** locally-available blobs or the 3-way fallback silently does not run; atomic (whole patch fails); incompatible with `--reject`; `-C<n>` never ignores context by default [^4b4394#279-287] [^4b4394#309-315] [^4b4394#333-338]. **CRLF is the live risk** — `core.autocrlf=true` with no consistent `.gitattributes` already produced the `starter.test.mjs` drift (#328) [^6c3124#61-62]. Correct gate: `git apply --check` first; never `--reject` in an automated path.

## E. Untrusted content and safety

**E16 — injection via conflict text.** No conflict-marker-specific study found — **unverified.** But code comments, READMEs, and PR descriptions are established IPI vectors for coding agents, and **CamoLeak** (CVE-2025-59145, CVSS 9.6) is a first-party-confirmed case of hidden PR-content driving Copilot to exfiltrate private source — *observed* [^79f2e9]. Mitigation: wrap base/ours/theirs in an explicit data envelope, keep the byte-stable persona prefix authoritative [^28e1af#449-454], strip markdown-hidden constructs, and require **snippet-only** output so injected prose has no channel [^1f177f#7-7].

**E17 — reduced privilege / no network: durig already does this natively, without Docker/WSL.** This is a genuine strength the first pass could not see: path confinement decorating *both* file tools and `exec` [^f8e6f0#159-325]; `inheritEnv:false` + 12-name allowlist with secret-shaped vars refused [^f8e6f0#110-127]; **no network capability minted** and `wsl`/`docker` structurally refused [^f8e6f0#35-36] [^6c3124#773-774]; verifier seats work on a disposable snapshot [^f8e6f0#348-350]. **Stated residual:** a verifier's *shell* can still write, bounded only by the disposable worktree, and every seat runs as the same Windows user — confinement is filesystem-semantic, not OS-identity [^1529f8#63-65] [^f8e6f0#9-10]. VM-grade isolation is unreachable without Docker/WSL [^a126f1#210]. This **partially closes** the first pass's unverified item: a mechanism exists and is implemented; it is confinement, not a sandbox.

## F. Evaluation and acceptance

**F18 — durig-specific eval.** Replay durig's own past conflicts as 20-line-context 3-way hunks with the developer's committed resolution as ground truth; discard hunks where the resolution exceeds left+base+right (signals new code) [^1f177f#4-5]. Five metrics: Equivalent / Code-Normalized Equivalent / Conflict (abstained) / Different Code / Invalid Markdown [^1f177f#10-10]. Use CodeBLEU for the AST-aware metric [^9a66a6]. **Reuse but calibrate `src/judge.mjs`** — ConflictAgent found an LLM judge accepted **4 of 5 structurally invalid resolutions**, so keep the structural gate deterministic [^4b9107#466-477]. Run it through durig's one-runnable-proof-per-guarantee demo convention [^8a6e7a#552-559]. Durig's **`node --check` per changed `.mjs` is already the runbook's gate** [^1].

**F19 — evaluating conflict detection/ordering.** ConflictBench is the accepted third-party benchmark (180 Java scenarios, 136 labelled true conflicts) [^fa99db]. Score `merge-tree --stdin` as a **classifier**: predicted conflict set vs actual outcome, precision/recall.

**F20 — alert thresholds for false merges that pass tests.** No industry standard found — **unverified.** The defensible gate: **structural validity 100%** + the test suite [^4b9107#336-351]. ROADMAP 100 is the local measurement that would surface the trend: unlanded-verified count and time-to-land, explicitly "a measurement, not an automation" [^3].

## G. Human/operator surface

**G21 — presenting resolutions.** The trust pattern is consistent: show base/ours/theirs, per-hunk decision, confidence/explanation, keep accept/adjust/reject with the operator — *advertised-elsewhere* [^a2eea9] [^69d151]. **durig-specific:** surface per-hunk confidence as an **attention notice** on the existing `status`/`watch` channel, not a new screen — durig's rule is "nothing is drawn while everything is in band" [^8a6e7a#404-407].

**G22 — abstentions as `defer_work`.** Maps exactly: `defer_work(itemId, question[, to])` parks a claimed item and surfaces `deferred_awaiting_answer` [^6c3124#321-348]. Two constraints: coordinators cannot read files, so the question must be **self-contained** [^21242c#151]; a deferral `to` a seat goes through `assertSendAllowed`, so the target must be edge-reachable [^6c3124#331-336]. The landing-safety review's own escalation pattern is the template — "stop and report; send the branch back for a rebase and name the conflict" [^1].

## H. Edit-tool design in general

**H23 — centered-window reads.** SWE-agent: 100-line window 18.0%, 30-line 14.3%, full file 12.7% — *observed* [^54b1dd#347-366]. durig-specific: implement as a change to the existing seam (`thinResultText` / `toolText()`), not a new tool [^6c3124#286-291].

**H24 — fuzzy matching and CRLF (F32).** The repo confirms F32 as live and named: `edit` is LF-normalizing, `core.autocrlf=true` caused the `starter.test.mjs` drift, and item 90 exists because an LF `oldText` never matches a CRLF file [^6c3124#495-512] [^6c3124#61-62]. **Safe fuzz = whitespace/EOL-insensitive exact matching on a unique anchor — never positional or similarity-based fallback.** Every fuzzy fallback in the wild reported here was a silent wrong-location apply [^bf9db5] [^ac2482]. durig's failing-first recipe already encodes "refuse what you cannot resolve" [^02b70a#97-102].

**H25 — lint/parse gate.** SWE-agent's flake8 gate moved 15.0% → 18.0%, reverting invalid edits and returning {error type, attempted result, original content} [^54b1dd#347-366] [^54b1dd#1241-1260]. durig's equivalent — **`node --check` + no leftover markers + no duplicate declarations** — is *already in `merge.md`* as a gate row [^1]. The 2026-10-17 incident is the proof case: a parse gate on `src/checkup.mjs` would have refused a tree where every CLI verb was a `SyntaxError` [^2]. `seatguard`'s write refusals are the existing precedent for a deterministic gate that reverts and explains [^754c94#134-159].

**H26 — planner/applier split.** Only if apply-failure is a *measured* bottleneck. durig's `edit` returning a `patch` is already the applier half [^21242c#124]; the only open applier needs a GPU [^1683c6].

---

# Recommended edit-format decision

**Default to anchored search-replace with a unique, EOL-normalized anchor and a deterministic parse gate; keep unified diff (with `@@` headers intact) as fallback. Do not add `apply_patch`** — it does not exist in the harness [^21242c#121-127] and is unevidenced for these families. Confirm with the A1 recipe, run through the demo suite and riding ROADMAP item 90's `format` verb so the EOL policy is fixed once [^6c3124#495-512].

# Recommended landing-train workflow

1. **Pre-flight, no working tree:** `git merge-tree --stdin --write-tree` over the candidate pairs — allowed, and **not yet in `merge.md`** [^b84e52#284-347] [^1].
2. **Order** by a conflict graph from that output [^3d481a].
3. **Land in a scratch/detached worktree, never the shared tree** — the runbook already prefers this for multi-branch passes [^1]; `node cli.mjs worktree` exists [^28e1af#745-761].
4. **Abort-first, resolve in the object store** (`merge-tree` → resolve → `commit-tree` → `update-ref`); the shared tree never enters `MERGE_HEAD` [^b84e52#420-453].
5. `--no-ff` [^1].
6. `rerere.enabled=true`, `autoUpdate=false` — **already durig's setting** [^769730#552-556]; add the `git rr` review norm.
7. **New:** make `carryVisibleState` conflict-aware — refuse to carry an unmerged path into a new worktree [^769730#154-188].
8. Honor the incident review's two other items: lazy-import `checkup` in `cli.mjs` so a mid-merge module degrades `check` not every verb, and add a **`.git/MERGE_HEAD` startup guard that must not itself depend on `checkup`** [^2].

# Recommended conflict-tool spec — build / don't-build

| Component | Call |
|---|---|
| Per-hunk decision over `{Left, Right, Base, Both}` + free-form escape hatch, keyed by chunk hash | **Build** [^dac7e3#260-267] |
| Abstention → `defer_work`, **payload inline** (coordinators cannot read) | **Build** [^21242c#151] [^6c3124#321-348] |
| Whole-file coherence + `node --check` + tests before accept | **Build** — already the runbook gate [^1] |
| Pre-flight conflict computation | **Don't build** — `git merge-tree --stdin` [^b84e52#284-347] |
| ours/theirs via `git checkout --ours/--theirs` | **Do not use — guard-denied**; resolve in-commit or via read+write of blob content [^f8e6f0#47] [^1] |
| Structural merge (mergiraf) | **Adopt only if Windows + licence verified** (unverified) [^56245e#11-14] |

**Calibration note on the enum:** the incident review is the local authority and it says a side-picking tool **alone would have been wrong** for #714 [^2]. So the escape hatch is not optional — it is the path #714 actually took.

# Recommended deterministic-first cascade (Windows / Git 2.55)

1. `merge-tree --stdin --write-tree` pre-flight — *allowed* [^f8e6f0#34-79].
2. `rerere` replay, `autoUpdate=false` + `git rr` review — *already enabled* [^769730#552-556].
3. Chosen-side resolution via read+write of blob content (not `git checkout --ours/--theirs`).
4. Structural merge (mergiraf) for JS/JSON **only if** Windows+licence verified.
5. LLM per-hunk resolver with abstention for the residue.
6. `node --check` + demo + whole-file coherence; else `defer_work`.

**Windows/Git-2.55 specifics:** enforce one EOL policy via `.gitattributes` + `core.autocrlf` (#328) [^6c3124#61-62]; keep worktree paths short (MAX_PATH) [^a126f1#402]; never `git apply --reject` in an automated path; ensure `--3way` blobs exist locally.

# Evaluation design

Replay durig's own conflicts as 20-line-context 3-way hunks; report the five categories [^1f177f#10-10]; CodeBLEU for AST-awareness [^9a66a6]; reuse but calibrate `src/judge.mjs` to zero false-accepts [^4b9107#466-477]; keep the structural gate deterministic; **structural validity must be 100% before a landing is accepted** [^4b9107#336-351]. Feed ROADMAP 100's unlanded-verified count and time-to-land as the trend measure [^3].

# Proposed ROADMAP items (registered, not scheduled)

| # | Item |
|---|---|
| 1 | Edit-format measurement harness for DeepSeek-V4.1-Flash / GLM-5.3-Flash (rides item 90) |
| 2 | Object-store landing-train workflow: `merge-tree --stdin` → resolve → `commit-tree`/`update-ref` |
| 3 | Conflict-graph ordering for landing trains |
| 4 | Per-hunk resolver: 4-value enum + escape hatch + chunk-hash identity + inline abstention |
| 5 | Deterministic parse gate (`node --check` + no markers + no duplicate declarations) with revert-on-error |
| 6 | Make `carryVisibleState` conflict-aware |
| 7 | Add the `merge-tree` pre-flight to `merge.md` (claimed but absent) + author `resolve-merge-conflict.md` |
| 8 | Chosen-side resolution without `git checkout` |
| 9 | Untrusted-conflict-content envelope (data-not-instructions; snippet-only output) |
| 10 | Conflict-replay eval harness with a calibrated judge |

# Explicitly unverified / still open

1. `docs/reviews/llm-prompting-for-git-merging.md` (first pass) and `docs/runbooks/resolve-merge-conflict.md` — **not read / not confirmed to exist**.
2. mergiraf Windows support and licence [^56245e#11-14].
3. Edit-format accuracy for DeepSeek-V4.1-Flash / GLM-5.3-Flash — no benchmark exists.
4. Diff-XYZ exact per-model numbers — two readouts disagree.
5. Conflict *style* vs LLM accuracy — no controlled study.
6. Empirical conflict-rate comparison of merge/rebase/cherry-pick — not found.
7. Whether `git config rerere.enabled true` is truly repo-wide across worktrees — code implies yes, not confirmed live.
8. A Windows-native *no-network sandbox* — durig has confinement, not a sandbox.
9. Prompt injection specifically via conflict markers — not studied.
10. Optimal landing-train ordering — no accepted heuristic.
11. The `merge.md` `writes: false` frontmatter vs its shared-tree writes — internal inconsistency, unexplained.

---

**Bottom line:** the two docs you just supplied are better than my previous reconstruction. The runbook already encodes the right rules (exclusive window, `--no-ff`, abort-first, scratch worktree, `node --check`); the incident review already names the blast-radius fix (lazy `checkup` import + `MERGE_HEAD` guard) and the measure-first posture. The three things still genuinely missing are (a) the **`merge-tree` pre-flight** the request believes was added, (b) **object-store resolution** so the shared tree is never mid-merge, and (c) a **`carryVisibleState` conflict guard**. Those are the highest-value additions, and none of them requires new auto-merge automation — consistent with the operator's stated preference.

**References**

[^1]: [docs/runbooks/merge.md](https://github.com/chexxor/Pi-OpenDurig/blob/main/docs/runbooks/merge.md) (50%)
[^2]: [docs/reviews/landing-safety-2026-10-17.md](https://github.com/chexxor/Pi-OpenDurig/blob/main/docs/reviews/landing-safety-2026-10-17.md) (30%)
[^3]: [docs/ROADMAP.md](https://github.com/chexxor/Pi-OpenDurig/blob/main/docs/ROADMAP.md) (20%)


