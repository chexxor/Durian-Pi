I'll start by reading the attached documents.I have both prompts. The parent report (observed half) is done; this is the **public-harnesses follow-up** — Claude Code, Codex CLI, Cursor, Cline, Goose. Let me research it against primary sources.Search results are thin; fetching primary docs directly.Claude Code is well documented. Now Codex CLI, Cursor, Cline, Goose.# `docs/reviews/harness-tools-skills-public-harnesses-research.md`

**Report type:** outside comparison for the parent (observed half). **Method:** vendor docs only — no clones were made, so **every claim below is class `advertised-elsewhere`**; there are no `observed` cells in this half. Line ranges are from the fetched pages, which are saved under `inputs/fetched/`.

---

> ### Delegate consumption note (2026-10-29) — added by the delegate; the report body below is unmodified
>
> **Provenance.** Received from the operator's research agent, untracked, and committed **verbatim** as `318838f5`
> before any amendment, so the artifact is attributable and durable (`docs/ROADMAP.md` 233 / D156: an untracked report is
> a lost report). The first line of this file is the agent's own narration, left in place for the same reason.
>
> **The Method line's premise changed the same day.** "No clones were made" was true on arrival. The operator then
> granted `--depth 1` cloning and five pins now exist: `vendor/eval/codex d373d649` (**full Rust source**, `codex-rs/`),
> `cline 51f63e4f` (full TS monorepo), `goose 775b3958` (full Rust + `documentation/docs/`), `claude-code-docs 58d6da1e`
> (**CHANGELOG/docs only**), `copilot-cli 84ee80ea` (**README/install.sh/changelog only**). Rows are generated in
> `docs/VENDOR-PINS.md`; `node tools/vendor-pins.mjs --check` → PASS at 14 clones. **Consequence: `observed` cells are now
> obtainable for three of the five, and this half still has none.** Reading those trees against the claims below is
> ROADMAP **241** — which the operator gated ahead of 232 ("*Do more research before proceeding onto roadmap 232*",
> D158). Do not treat any row below as behaviour until then.
>
> **Citation integrity, measured on the file as committed.** 64 distinct in-body markers, 14 defined, **50 dangling**
> (`[^542f21#49]`-style anchors into a fetched corpus that was never delivered — `inputs/fetched/` does not exist in this
> repo), and **3 dead URLs**, all Goose (`…/getting-started/using-extensions`, `…/goose-architecture/extensions-design`,
> `…/guides/recipes/recipe-reference`, all HTTP 404 on 2026-10-29); the resolvable equivalents are in the pin, e.g.
> `vendor/eval/goose/documentation/docs/tutorials/recipes-tutorial.md`. Repairs are routed as Task A of
> `docs/reviews/harness-tools-skills-followup-2-research-prompt.md` and registered as ROADMAP **243**.
>
> **What the delegate re-confirmed on the live vendor pages on 2026-10-29** (so the findings survive even where the
> anchors do not): Claude Code's "scales at 1% of the model's context window", "truncated at 1,536 characters", "first
> 5,000 tokens of each" inside a "combined budget of 25,000 tokens", `/skill-doctor`, `/run-skill-generator`, `/verify`;
> Codex `config-advanced`'s `project_doc_max_bytes`, `project_doc_fallback_filenames`, `thread.skills.truncated`,
> `skill.injected`, `history.jsonl`, `hooks.json`, `PreToolUse`; Cursor's `beforeShellExecution`, `failClosed`,
> `pluginPaths` and the decisive sentence that with `failClosed: true` "hook failures (crash, timeout, non-zero exit code,
> no output) block the action instead of allowing it through" — **so the default is fail-open** — and "Keep rules under
> 500 lines" as guidance, not enforcement.
>
> **Two contradictions, recorded rather than quietly folded.** (1) Against the observed half: "*no default or
> configurable intercept for `git worktree prune` / `git clean -fd`*" holds across the ten observed systems, but GitHub
> Copilot CLI ships `--deny-mode "command:git worktree prune"` — and its own tracker reports those rules **failing open**
> on a 10 s timeout and on TCC denial ([#978](https://github.com/github/copilot-cli/issues/978)), with no way to reload a
> changed rules file without restarting the session ([#4438](https://github.com/github/copilot-cli/issues/4438)). (2)
> Against this report's own second bullet: Goose writes capabilities back at runtime
> (`crates/goose/src/recipe/local_recipes.rs:155,194` at the pin) — a repo-discovered capability that *does* get created
> mid-session, though as a recipe rather than a callable tool.

## 1. Verdict up front

The public harnesses **do converge on three of the delegate's mechanisms**, but they converge on them in a different order of importance than we ranked them, and on one mechanism we do not have at all:

- **Converged, and worth adopting as-is:** a repo-committed instruction file loaded at session start (all five) [^1] [^3] [^6] [^8]; and a **blocking pre-tool-call hook** as the outer guard for destructive verbs — Claude Code, Cursor and Codex all ship one with an explicit deny path [^1] [^5] [^3].
- **Converged but with a twist we must copy:** capability discovery is **file-based, not registration-based**. Not one of the five lets the *agent* register a callable tool that survives the session. What all five do instead is advertise only a **one-line description** of a repo-discovered capability and load the body on demand [^2] [^6] [^8].
- **What the industry actually does about agent-authored capability — and it is not what we registered.** Claude Code's `/run-skill-generator` and `/verify` make the agent **write the recipe into the repo as a skill file after a successful ad-hoc run**, so "later runs and other agents follow the same steps" [^542f21#49]. That is the only shipped answer to our exact failure ("instruments newly created get 1–2 sessions of use"), and it is a *capture* mechanism, not a *registration* mechanism. It also comes with the forcing function we lack: a commit-time instruction that runs the recorded skill before each commit [^2].
- **Adopt 3:** (1) description-only advertising of repo-discovered instruments + on-demand body load; (2) the `verify`-style **capture-on-success** step that writes an instrument's recipe into the repo as part of the run that used it; (3) the blocking `tool_call` guard, but installed for the git verbs as a *deny rule plus hook*, because Claude Code's own docs warn the hook's `if` filter is best-effort and the permission layer is the real gate [^20106b#405].
- **Do not adopt 2:** (a) always-injected rule sprawl with per-file toggles (Cursor/Cline style) — no budget, no truncation policy, and Cline's own docs concede rules "consume context tokens" with no cap [^d32e06#246]; (b) runtime dynamic extension activation (Goose `enable_extension`) as a *durability* mechanism — Goose itself documents that dynamically enabled extensions are **session-only** [^04a0b7#427], which reproduces our 1–2-session failure exactly.
- **One cell that changes our roadmap (§7):** we registered project-extension `registerTool()` instruments as the top item. That is **parochial**. Every harness here treats a runtime-registered tool as a human/plugin act, and treats an *agent-authored* capability as a file. Keep `registerTool()` for the ~6 stable instruments; move *authored* instruments onto the skill-file path.

---

## 2. Mechanism × system matrix

| Mechanism | Claude Code | Codex CLI | Cursor | Cline | Goose |
|---|---|---|---|---|---|
| Static prompt list | n/a (tools are native) | n/a | n/a | n/a | n/a |
| Schema-registered tool | MCP server + plugin [^1] | MCP in `config.toml` [^3] | MCP [^5389e9#27] | MCP [^d32e06#63] | MCP = extension [^9] |
| Dynamic activation mid-session | skill load; `reloadSkills` on `SessionStart` [^20106b#1169, 1184-1197] | not found | `workspaceOpen` returns `pluginPaths` [^5] | not found | Extension Manager `enable_extension`, session-only [^04a0b7#45, 427] |
| Repo-scoped extension | `.claude/skills/`, `.claude/settings.json`, plugins [^2] | `.codex/config.toml`, `<repo>/.codex/hooks.json` [^3] [^3] | `.cursor/rules`, `.cursor/hooks.json` [^6] [^5] | `.clinerules/` [^d32e06#148] | not found (global `~/.config/goose/config.yaml`) [^04a0b7#305] |
| Skill/instruction discovery | `.claude/skills`, parents to repo root, nested lazy [^2] | `AGENTS.md` walk to project root [^3] | `.cursor/rules` + nested `AGENTS.md` [^6] | `.clinerules/`, `.cline/rules/`, `.cursorrules`, `.windsurfrules`, `AGENTS.md`, `~/.agents/AGENTS.md` [^8] | Skills platform extension [^04a0b7#46] |
| Advertisement (what's injected) | name + description listing [^2]; budget 1% of context [^542f21#1043] | "limited amount of project guidance in the first turn", `project_doc_max_bytes` [^3]; skills list with `truncated` metric [^3] | description of non-`alwaysApply` rules [^6] | whole rule body unless `paths:` [^8] | extension trait `instructions()` [^10] |
| On-demand load | yes, body on invoke, stays [^2] | not found | agent reads `@file` with tools, never inlined [^5389e9#216] | no (whole file) | yes, via Skills extension [^04a0b7#46] |
| Forced load | `/skill-name`; commit-time `verify`/`simplify` [^2] [^2] | not found | `@rule` manual include [^5389e9#142] | toggle + `/newrule` [^8] | recipe `prompt`/`instructions` [^4] |
| Trust gate | workspace trust; `allowed-tools` ungated [^542f21#516] | project `.codex/` ignored unless trusted [^3d9c8f#177] | hooks need trusted workspace [^5f6188#593] | not found | malware scan before activation [^04a0b7#16] |
| Precedence | enterprise > personal > project; plugin namespaced [^2] | closest `config.toml` wins [^3d9c8f#175] | Team > Project > User; nested `AGENTS.md` more specific wins [^5389e9#396, 446] | workspace > global [^d32e06#174] | recipe `extensions` replaces defaults [^4] |
| Session transcript | JSONL; `transcript_path` in every hook input [^20106b#666, 686] | `history.jsonl`, `history.persistence`, `max_bytes` [^3] | `transcript_path` / `CURSOR_TRANSCRIPT_PATH` [^5f6188#651, 1286] | not found | Chat Recall [^04a0b7#43] |
| Recall / search tool | not found (grep the JSONL) | not found | `@`-mention + rules | not found | Chat Recall: "search conversation content across all your session history" [^04a0b7#43] |
| Memory file (every turn) | `CLAUDE.md` [^20106b#1026] | `AGENTS.md` | rules `alwaysApply: true` [^6] | no-frontmatter rules [^d32e06#350] | Top of Mind: "inject persistent instructions... every turn" [^04a0b7#49] |
| Dangerous-command guard | `PreToolUse` deny + permission rules [^20106b#96-114, 405] | `PreToolUse` hook + `rules` execpolicy [^3] [^3] | `beforeShellExecution` allow/deny/ask [^5] | not found (hooks deferred to SDK plugins [^11]) | not found |
| Injection budget, explicit | 1% context skill listing; 1,536 ch/desc; 5k/skill & 25k after compaction; 10k ch hook context [^542f21#1043, 512] [^20106b#942] | `project_doc_max_bytes` [^3d9c8f#891] | "keep under 500 lines" guidance only [^5389e9#244] | none [^d32e06#246] | none |

---

## 3. Q1–Q4 per system

### 3.1 Claude Code

**(a) Who registers what.** Four distinct surfaces with different registration owners. `CLAUDE.md` is static, loaded at session start, no script [^20106b#1026]. Skills are `.claude/skills/<name>/SKILL.md` files discovered from enterprise, personal, project, nested, added-directory, plugin and claude.ai-synced locations [^2]; discovery walks parents up to the repo root, and a worktree searches only to the worktree root, falling back to the main checkout's skills when the worktree has none [^542f21#159]. Hooks are JSON in settings files, with a separate location table for user/project/local/managed/plugin/skill/subagent [^1]. MCP tools appear as ordinary tools named `mcp__<server>__<tool>` [^1].

**(b) A user-authored tool callable as a tool next session?** Yes, but never by the agent registering it: via an MCP server or a **plugin**. A skill's bundled `scripts/` are "executed, not loaded" [^2] — they are bash invocations, not schemas. The one agent-authored path that *does* cross the session boundary as a capability is the recipe-recording skill: `/verify` and `/run-skill-generator` write `.claude/skills/verify/SKILL.md` or `.claude/skills/run-<name>/` after a successful run, "so later runs and other agents follow the same steps", and Claude "edits the recorded file only when it steered a run wrong... so you can commit the file without per-session diffs" [^542f21#49].

**(c) Hook events and blocking.** ~30 events including `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolBatch`, `PreCompact`, `InstructionsLoaded`, `WorktreeCreate`, `WorktreeRemove`, `PermissionRequest` [^1]. `PreToolUse` blocks via exit 2 [^1] or `hookSpecificOutput.permissionDecision: "deny"` [^1], can rewrite input with `updatedInput`, and merges with precedence `deny > defer > ask > allow`. The distinguishing feature is `"onFailure": "block"`: without it a crashed, missing or timed-out hook **fails open** [^1]. The docs also state the `if` filter is best-effort because `$()` and backticks defeat static matching, and tell you to use the permission system for a hard gate [^1].

**(d) Published caps.** Skill listing scales at **1% of the model's context window**, per-entry `description`+`when_to_use` capped at **1,536 characters**, and when the listing overflows, Claude Code "drops descriptions starting with the skills you invoke least" [^2]. After compaction it re-attaches the most recent invocation of each skill, keeping the first **5,000 tokens** of each within a combined **25,000-token** budget [^542f21#512]. Hook `additionalContext` is capped at **10,000 characters** with no override [^1].

### 3.2 OpenAI Codex CLI

**Layering.** `AGENTS.md` is discovered by walking up to a project root (default marker `.git`, configurable via `project_root_markers`) and Codex "includes a limited amount of project guidance in the first turn"; two knobs — `project_doc_max_bytes` and `project_doc_fallback_filenames` [^3] [^3]. Project-scoped `.codex/config.toml` layers are walked root→cwd with the closest file winning, and are **ignored entirely when the project is untrusted** — including project rules and project hooks [^3].

**Hooks.** Loaded from `~/.codex/hooks.json`, `~/.codex/config.toml`, `<repo>/.codex/hooks.json`, `<repo>/.codex/config.toml`, or inline `[hooks]` tables; the documented example is a `PreToolUse` matcher `^Bash$` running a policy script [^3]. I did not read Codex's hooks event/semantics page, so **the block verb and fail-open behaviour are `not verified` for Codex** — do not port our guard on the strength of this report alone.

**Approvals and sandbox.** Two layers: sandbox mode (what is technically possible) and approval policy (when it must ask) [^7]. `.git`, `.agents`, `.codex`, `.aws` are read-only even inside writable roots, recursively [^7]. For command-specific policy the docs point at `rules` — "If you want Codex to skip specific commands (for example, block `git commit` outside the sandbox), use rules" [^3] — plus `approval_policy = { granular = {...} }` with a `skill_approval` category [^dccefb#400]. An `auto_review` reviewer agent evaluates only actions that already need approval, and its prompt-build/review/parse failures **fail closed** [^7].

**Cross-session state.** `history.jsonl` under `CODEX_HOME`, toggled by `[history] persistence` and capped by `history.max_bytes` (example 100 MiB, oldest entries dropped) [^3]. Transcripts are on disk and greppable; whether `history.jsonl` carries full tool arguments is **not verified here**.

**The most useful finding for us** is not a feature but a metric name: Codex instruments `thread.skills.enabled_total`, `thread.skills.kept_total`, `thread.skills.truncated`, and `skill.injected` by status [^3]. A vendor shipping a *truncation counter* and a *per-skill injection outcome* is telling you the advertised list gets cut and that injections fail — i.e. they treat this as an operational defect class, not a feature.

### 3.3 Cursor

**Rules.** `.cursor/rules/*.mdc`, version-controlled, four activation modes driven by three frontmatter fields (`alwaysApply`, `description`, `globs`), with the fourth being manual `@`-mention [^6]. When applied, contents go at the start of the model context [^6]. Precedence Team → Project → User, merged, earlier wins conflicts [^5389e9#396]. Nested `AGENTS.md` files merge with more specific winning [^5389e9#446].

**The mechanism we should copy, and its failure mode.** `@file` references inside a rule are **not inlined**: "A file mention like `@migration-template.sql` tells Agent where to look, and Agent reads the file with its tools when it needs the content. The file's contents are not inlined into the prompt" [^5389e9#216], restated in the FAQ [^5389e9#464]. That is exactly the context budget we want and exactly the hole that produces "rule says follow the template; agent never opened the template".

**Guard.** `.cursor/hooks.json` at project or user level, `beforeShellExecution` returns `permission: allow|deny|ask` with a `matcher` regex tested against the **full command string**; exit 2 blocks; crashes/timeouts/non-zero other than 2 **fail open** unless `failClosed: true` [^5] [^5] [^5]. Project hooks require a trusted workspace and are checked in [^5]. Cursor also loads Claude Code-format third-party hooks [^5f6188#97].

**Dynamic registration.** `workspaceOpen` can return `pluginPaths` — absolute plugin directories to load for that workspace [^5]. That is a repo-conditional capability loader, not an agent-authoring path.

### 3.4 Cline

**Rules.** Workspace `.clinerules/` or `.cline/rules/`, global `~/Documents/Cline/Rules`, and it auto-detects `.cursorrules`, `.windsurfrules`, `AGENTS.md`, `~/.agents/AGENTS.md` — the most permissive multi-format reader of the five [^8]. The only conditional is `paths:` glob frontmatter; no frontmatter means **always active**, and `paths: []` means never [^8]. Invalid YAML **fails open**, activating the rule with raw content visible [^d32e06#352]. Every rule has a UI toggle [^d32e06#211].

**Cost.** No cap, only an admonition: "Rules consume context tokens. Avoid lengthy explanations or pasting entire style guides" [^d32e06#246]. Hooks are not documented on the rules page — it redirects to SDK Plugins [^11], so a Cline pre-tool guard is **not found** at the rule/feature level.

### 3.5 Goose

**Extensions are MCP servers**, global in `~/.config/goose/config.yaml` under an `extensions:` map with `enabled: true` [^9], with no repo-scoped layer documented — a distribution gap for our dual-OS repo. Extensions are also *instruction carriers*: the `Extension` trait has `instructions()` alongside `tools()`, so an extension injects its own prompt text [^10].

**Dynamic activation is the root of our own bug.** The Extension Manager platform extension is "enabled by default" and lets the model `enable_extension` mid-session [^04a0b7#45]; the docs then warn: "Any extensions enabled dynamically are only enabled for the current session. To keep extensions enabled between sessions, see Enabling/Disabling Extensions" [^04a0b7#427]. Goose has built the exact mechanism we thought we wanted and has had to document its session-only nature.

**Two mechanisms worth citing.** `Chat Recall` — "Search conversation content across all your session history" [^04a0b7#43] — is a recall *tool*, not a grep habit. `Top of Mind` — "inject persistent instructions into goose's working memory every turn" [^04a0b7#49] — is an every-turn injection with, as far as these pages show, **no budget**.

**Recipes** package `instructions`, `prompt`, `extensions`, `parameters`, and a `retry` block with shell success checks and an `on_failure` command [^4] [^4]; recipe discovery is cwd plus `GOOSE_RECIPE_PATH` plus a GitHub repo [^4]. Recipes are the closest thing here to a tracked script with a pass/fail contract — a `suite.mjs` with a schema.

**Guard.** None found: goose "operates autonomously by default... can execute commands and modify files without your approval", with permission modes and per-tool permissions as the control surface [^9]. No git-verb interception documented.

---

## 4. Evidence table

| # | Claim | URL | Class |
|---|---|---|---|
| 1 | Hook locations incl. committable project settings | https://code.claude.com/docs/en/hooks | advertised-elsewhere |
| 2 | `PreToolUse` deny / exit 2 / `onFailure: block` / best-effort `if` | https://code.claude.com/docs/en/hooks | advertised-elsewhere |
| 3 | Skill locations, discovery, nested lazy load | https://code.claude.com/docs/en/skills | advertised-elsewhere |
| 4 | Description-only advertising; 1% budget; 1,536-char cap; least-invoked dropped first | https://code.claude.com/docs/en/skills | advertised-elsewhere |
| 5 | Compaction re-attach 5k/skill, 25k total | https://code.claude.com/docs/en/skills | advertised-elsewhere |
| 6 | `/run-skill-generator` and `/verify` write recipes into the repo; commit-time forcing | https://code.claude.com/docs/en/skills | advertised-elsewhere |
| 7 | `/skill-doctor` reports never-invoked skills and per-skill context cost | https://code.claude.com/docs/en/skills | advertised-elsewhere |
| 8 | `AGENTS.md` walk, `project_doc_max_bytes`, trusted-project gate | https://learn.chatgpt.com/docs/config-file/config-advanced | advertised-elsewhere |
| 9 | Codex hook file locations; `PreToolUse` matcher example | same | advertised-elsewhere |
| 10 | `history.jsonl`, `history.persistence`, `max_bytes` | same | advertised-elsewhere |
| 11 | `thread.skills.truncated`, `skill.injected` metrics | same | advertised-elsewhere |
| 12 | Sandbox/approval split; protected `.git`/`.agents`/`.codex` paths | https://developers.openai.com/codex/agent-approvals-security | advertised-elsewhere |
| 13 | Rules activation matrix; `@file` not inlined; precedence; nested `AGENTS.md` | https://cursor.com/docs/context/rules | advertised-elsewhere |
| 14 | `beforeShellExecution` allow/deny/ask; fail-open default; `failClosed`; deferred merge order | https://cursor.com/docs/hooks | advertised-elsewhere |
| 15 | `.clinerules` + cross-tool formats; `paths:` conditional; fail-open YAML; no cap | https://docs.cline.bot/features/cline-rules | advertised-elsewhere |
| 16 | Cline hooks deferred to SDK Plugins | https://docs.cline.bot/customization/hooks.md | advertised-elsewhere |
| 17 | Extensions = MCP; `config.yaml` shape; `enable_extension` session-only; Chat Recall; Top of Mind; Skills extension | https://block.github.io/goose/docs/getting-started/using-extensions | advertised-elsewhere |
| 18 | `Extension::instructions()` injects prompt text | https://block.github.io/goose/docs/goose-architecture/extensions-design | advertised-elsewhere |
| 19 | Recipe schema incl. `retry`/`checks`; recipe search path | https://block.github.io/goose/docs/guides/recipes/recipe-reference | advertised-elsewhere |
| 20 | Skills unused unless explicitly stated (user report) | https://github.com/github/copilot-cli/issues/978 | reported-by-users |
| 21 | `disable-model-invocation` makes a skill unreachable through the skill tool (user report) | https://github.com/github/copilot-cli/issues/4438 | reported-by-users |
| 22 | Skill list not persisted across sessions (user report) | https://github.com/anthropics/claude-code/issues/57776 | reported-by-users |
| 23 | Skill invoked from subagent doesn't inherit parent grant (user report) | https://github.com/anthropics/claude-code/issues/59968 | reported-by-users |

---

## 5. Cost table (Q5 — injection budget)

| System | Injected every request | On demand | Published cap? | Basis |
|---|---|---|---|---|
| Claude Code | skill **names + descriptions** only; `CLAUDE.md`; hook `additionalContext` when a hook fires | skill body, `@file` contents | **Yes**: listing = 1% of context window; 1,536 ch per description; 10,000 ch per hook context string | docs, explicit [^542f21#1043] [^20106b#942] |
| Codex CLI | `AGENTS.md` first-turn guidance; enabled-skills list | skill body, MCP tools | **Partial**: `project_doc_max_bytes` is a per-file cap, default value not on the pages read; a `truncated` metric exists | docs [^3d9c8f#891, 700] |
| Cursor | `alwaysApply` rule bodies; descriptions of the others | rule body when globbed/selected; `@file` targets | **No** — "keep rules under 500 lines" is guidance | docs [^5389e9#244] |
| Cline | every rule **body** without `paths:` | path-scoped rules | **No** — prose warning only | docs [^d32e06#246] |
| Goose | extension `instructions()`; Top of Mind; enabled-skills list | skills, Chat Recall results | **No** | docs [^10] [^04a0b7#49] |

**Denominator for "is ~500 standing tokens a lot?"** Claude Code's default budget is 1% of the context window — for a 200k-token model that is ~2,000 tokens of skill listing, i.e. 500 standing tokens is about **a quarter** of the whole advertised-capability budget, and roughly 1.3 descriptions at the 1,536-character per-entry cap (~380 tokens). Put differently: our pointer file plus two skills' descriptions is a normal size; adding a third and fourth *description* is where a harness starts dropping the least-used ones [^542f21#1042]. That is the number to argue with, not the token count in isolation. `estimate, unverified` for the 380-token conversion (characters/4).

---

## 6. Failure modes (Q7)

| Failure | Where | Class |
|---|---|---|
| Advertised skills never invoked, so the listing is pure cost | Claude Code ships `/skill-doctor` specifically to list never-invoked skills and their context cost | **reported-by-maintainers** (product surface exists to fix it) [^542f21#780] |
| Advertised description silently **removed** when the listing overflows | least-invoked skills lose descriptions first, "which removes the keywords Claude needs to match your request" | **reported-by-maintainers** [^542f21#1042] |
| Advertised list **truncated** at render time | Codex instruments `thread.skills.truncated` and `skill.injected` by status | **reported-by-maintainers** (metric implies the event) [^3] |
| Skill present but not injected | "The skill is active on the CLI side... but the harness has never injected its list into any..." | **reported-by-users** [^12] |
| Skill loadable by the user but unreachable by the model | `disable-model-invocation: true` resolves against the model-filtered list | **reported-by-users** [^13] |
| Skills not used unless explicitly named | "Copilot will not trigger the skill use unless told to" | **reported-by-users** [^14] |
| Capability mismatch inside one system | typing `/skill` bypasses `PreToolUse` for the `Skill` tool, which is why `UserPromptExpansion` exists | **reported-by-maintainers** (documented workaround) [^20106b#1380] |
| Rule references a template the agent never opens | `@file` is not inlined; agent "reads the file with its tools when it needs the content" | **advertised-elsewhere** (documented design, predictable failure) [^5389e9#216] |
| Malformed rule activates anyway | invalid YAML "fails open. The rule activates with raw content visible" | **reported-by-maintainers** [^d32e06#352] |
| Agent-authored capability evaporates at session end | dynamically enabled extensions are session-only | **reported-by-maintainers** [^04a0b7#427] |
| Stale tool list causing a wrong *action* | **no evidence found** for any of the five; the user reports above are about capabilities not being used, not about a stale entry causing a destructive or wrong action | no evidence found |

The last row matters for our incident review: our 36-row worktree ledger was lost to an **unguarded verb**, not a stale list. The literature supports "capability goes unused"; it does not support "stale capability caused the damage". Keep those as two separate roadmap items.

---

## 7. Does this change the delegate's ranked recommendation?

**Yes on one item, no on the rest.**

The delegate ranked *project-extension instruments* (`registerTool()`) first and rejected embedding/vector memory and build-time/cloud skill catalogs. The evidence:

1. **Embeddings/vector memory — rejection upheld.** None of the five uses retrieval for rules or skills. All five select by *file location + glob + one-line description* [^2] [^6] [^d32e06#350]. Goose's `Chat Recall` is session-history search [^04a0b7#43], not semantic memory. Rejecting vector memory is not parochial; it is the industry position.
2. **Build-time/cloud skill catalogs — rejection upheld.** Every catalog mechanism here is file-in-repo with a *local* discovery path [^2] [^3] [^6] [^d32e06#159]. Catalogs exist (Claude plugins, Cursor marketplaces) but they are distribution conveniences layered on repo files, and Claude Code's plugin skills are explicitly namespaced so they cannot collide with project ones [^542f21#188].
3. **Project-extension instruments — amend.** Runtime registration is not the mechanism any of these harnesses uses for *agent-authored* capability; Goose is the only one with model-callable registration, and it is session-scoped by design [^04a0b7#427]. The mechanism the industry uses is **file + description-only advertisement + lazy body**, plus Claude Code's capture-after-success writer [^542f21#49]. So: keep `registerTool()` for the six stable instruments that already get 6–21 sessions of use, but do **not** make it the home for newly authored ones — the authored ones need to land as files in a discovered directory, or they inherit Goose's session-only fate.
4. **New, ranked above the hook: the extraction step.** A capture step inside the session that used the ad-hoc code is the only mechanism here that addresses the *24% one-off measurement* number directly. Our `tools/harness-usage-census.mjs` can detect the moment (a `node:sqlite`/`databaseSync` call that duplicates a tracked script) but nothing currently *writes the tool*. Claude Code's `/verify` pattern — write the recipe only when the run succeeded, and only when the recorded recipe was wrong — is the falsifiable version of "make instruments default-in-sight" [^542f21#49].
5. **Guard: amend the shape, not the decision.** Adopt the blocking `tool_call` guard, but pair every hook with a *deny rule*, because both Claude Code and Cursor document fail-open defaults for crashed/timed-out hooks [^1] [^5f6188#874]. A guard that silently disappears when its script is missing is not the outer-layer equivalent of the prune we lost the ledger to.

**Ranked, by impact ÷ standing-context cost** (the ordering the follow-up prompt asked for):

| Rank | Mechanism | Impact | Standing cost | Why this rank |
|---|---|---|---|---|
| 1 | `verify`-style **capture-on-success** into a discovered skills dir | high (attacks the 24%) | 0 until next session, then one description | only mechanism with a closed loop; no per-turn cost while unused |
| 2 | **Description-only advertising** of authored instruments (replace body-in-pointer) | high (28/87 → ?) | ~40–80 tok/instrument | cheapest possible advertisement; matches every vendor |
| 3 | **Blocking `tool_call` guard + deny rules** for `git clean -fd`, `git worktree prune`, `rm -rf`, `git push` | incident-class | ~0 (no per-request injection) | cheap because hooks inject nothing unless they fire |
| 4 | **`APPEND_SYSTEM.md`** project instruction file | medium | ~300–500 tok every request | real, but it is the surface with the least evidence of changing behaviour; Cursor/Cline's always-on rules are the weakest-documented performers here |
| 5 | Transcript recall command | medium-low | 0 | Goose ships it as a tool [^04a0b7#43]; we already grep in 0.55 s, so the delta is discoverability, not capability |

**Falsifiers** (per the on-landing runbook): #1 is falsified if, over the next 30 sessions, instruments created by the capture step still show ≤2 sessions of use while pointer-named ones stay ≥6 — that would mean the problem is *invocation*, not *capture*, and the budget should move to #2 and #3. #2 is falsified if the description-only listing never grows past ~10 entries, in which case the 1% budget is irrelevant at our scale and the simpler pointer file wins on maintenance.

---

## 8. What we did not ask (for the follow-up prompt)

1. **Codex hooks block semantics.** Verified only that `PreToolUse` hooks and locations exist [^3]; the deny verb, exit codes, fail-open behaviour and the `rules`/execpolicy grammar are unread. Do not port our guard to Codex assumptions.
2. **Does `~/.codex/history.jsonl` contain tool arguments?** If it does, Codex is a second recovery source for our nine lost instruments; if it contains only prompts, it is not.
3. **Cline hooks.** Documented only as "see SDK Plugins" [^11]; the event list and whether any pre-execution deny exists is unresolved.
4. **Cursor skills page** (`cursor.com/docs/skills`) — not read. Whether Cursor has converged on `SKILL.md` would materially strengthen or weaken the "industry converged on Agent Skills" claim.
5. **Cline Memory Bank** — cited in the nav [^d32e06#79], never read. It may be a memory-file mechanism with a documented size discipline, which is the one cell in §5 that could move.
6. **No default for `project_doc_max_bytes`** — the cap exists, the number does not appear on the page read.
7. **Observed half.** Every cell here is `advertised-elsewhere`. The prompt's evidence discipline prefers a shallow clone pinned in `docs/VENDOR-PINS.md`; none of these five is cloned, so no `observed` claim has been made and none should be inferred from this report. If a cell is going to be load-bearing in `docs/ROADMAP.md`, clone and pin it first — `claude-code`, `codex` (open source), `goose`, `cline` are all clonable; Cursor is not.

**Landing checklist not performed here** (no writes): `docs/ROADMAP.md` registration for items 1–3 of §7 as *registered, not scheduled*; a `docs/COMPETITORS.md` entry per system; cross-link from §9 of the parent report; and the follow-up prompt containing §8 above.

**References**

[^1]: [Hooks reference - Claude Code Docs](https://code.claude.com/docs/en/hooks) (34%)
[^2]: [Extend Claude with skills - Claude Code Docs](https://code.claude.com/docs/en/skills) (22%)
[^3]: [Advanced Configuration | ChatGPT Learn](https://learn.chatgpt.com/docs/config-file/config-advanced) (10%)
[^4]: [Recipe Reference Guide | goose | Your open source AI agent](https://block.github.io/goose/docs/guides/recipes/recipe-reference) (9%)
[^5]: [Hooks | Cursor Docs](https://cursor.com/docs/hooks) (7%)
[^6]: [Rules | Cursor Docs](https://cursor.com/docs/context/rules) (6%)
[^7]: [Agent approvals & security | ChatGPT Learn](https://developers.openai.com/codex/agent-approvals-security) (6%)
[^8]: [Rules - Cline](https://docs.cline.bot/features/cline-rules) (3%)
[^9]: [Using Extensions | goose | Your open source AI agent](https://block.github.io/goose/docs/getting-started/using-extensions) (2%)
[^10]: [Extensions Design | goose | Your open source AI agent](https://block.github.io/goose/docs/goose-architecture/extensions-design) (1%)
[^11]: [hooks.md](https://docs.cline.bot/customization/hooks.md) (0%)
[^12]: [[Bug] Skills injected in system prompt not persisted across ...](https://github.com/anthropics/claude-code/issues/57776) (0%)
[^13]: [disable-model-invocation: true makes a skill unreachable ...](https://github.com/github/copilot-cli/issues/4438) (0%)
[^14]: [Skills are not used unless explicitely stated · Issue #978](https://github.com/github/copilot-cli/issues/978) (0%)