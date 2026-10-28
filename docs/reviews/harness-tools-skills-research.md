# How harnesses make an agent's *own* tools and skills reusable — observed half (delegate, 2026-10-29, Linux)

**Question (the operator's, 2026-10-28):** *"I don't often see you using new tools you create, or new skills you
created."* What mechanism makes an agent-authored capability **durable and default** at our scale — one operator, one
repo, two hosts, no cloud backend, a small local model?
**Prompt:** `docs/reviews/harness-tools-skills-research-prompt.md` (Q1–Q9, deliverable shape, evidence discipline).
**Runbooks followed:** `docs/runbooks/research-request.md`, `docs/runbooks/competitor-review.md`.

> **This file is the observed half of the study, authored by the delegate, and is deliberately partial.** Every claim
> here comes from a tree that was open on this machine: the installed pi package and the nine pinned clones in
> `vendor/eval/` (`docs/VENDOR-PINS.md`; `node tools/vendor-pins.mjs --check` → PASS). The prompt's second system set —
> **Claude Code, OpenAI Codex CLI, Cursor, Cline, Goose** — needs public docs and issue trackers, i.e. web access the
> delegate does not have. Those five are **unexamined here**, and the questions this file cannot answer are collected in
> `docs/reviews/harness-tools-skills-followup-research-prompt.md` for the research agent. Do not treat the verdict below
> as the whole study.

## 1. Verdict up front

The defect is not "the agent forgets" — it is that **an instrument we wrote lives on a path the model is never shown.**
Every system in the observed set solves that with one of three mechanisms, and pi (our harness, `@1.4.0`) already ships
all three, unconfigured:

**Adopt (3).** (1) **Schema-registered repo tools** — put the instruments in the *tool list* via a project extension
under `.pi/extensions/` (`package-manager.ts:2484-2491` auto-discovers it once the project is trusted; `types.ts:1671`
`registerTool()`; `types.ts:579-640` `promptSnippet`/`promptGuidelines`/`exposure`/`defaultActive`). This is the only
observed mechanism that is in front of the model **on every request with zero retrieval burden**, which is exactly what
the small-model evidence says we need (oh-my-pi `6f3fbc94`, `.omp/skills/system-prompts/small-models.md`: *"A prompt
carries roughly 3–5 constraints before rules start displacing each other"*). (2) **`.pi/APPEND_SYSTEM.md`** — pi injects
it as the `addendum` system-prompt section, before project context and skills
(`system-prompt.ts:27-28,172`), and the project file *replaces* the user file rather than merging
(`docs/configuration.md:39`), so one ~10-line file carries the baseline commands and the standing prohibitions. (3) **A
`tool_call` guard that blocks** — `types.ts:1194-1264` fires before execution, can mutate args, and may return
`{block:true,reason}`; pi ships the pattern four times (`examples/extensions/permission-gate.ts`,
`protected-paths.ts`, `confirm-destructive.ts`, `dirty-repo-guard.ts`), and `permission-gate.ts` **blocks outright when
there is no UI** — the correct default for a delegate running unattended.

**Do not adopt (2).** (a) **Embedding/vector memory** (oh-my-pi `mnemopi`/`hindsight`, metagpt `11cdf466`
`metagpt/memory/longterm_memory.py:21-40` `recover_memory(role_id)`): it buys recall we can already get by grepping our
own 438 MB SQLite store and pi's session JSONLs, at a cost we cannot audit. (b) **A build-time immutable skill catalog /
cloud skills service** (openhands `6354932e` `src/api/skills-service.ts:29-40`: *"an immutable build-time snapshot …
baked into the bundle … does not change at runtime"*): that is precisely the failure class ROADMAP 233 is about — an
artifact that reads current and silently isn't.

## 2. Mechanism × system matrix

Legend: `obs` = code or doc opened in the tree · `adv` = claimed in that project's docs only · `—` = not found in the
time spent (not evidence of absence) · `partial` = the clone was searched and a file named but not fully read.
Pins are the short HEADs from `docs/VENDOR-PINS.md` (regenerate: `node tools/vendor-pins.mjs --write docs/VENDOR-PINS.md`).

| mechanism | pi 1.4.0 (installed) | oh-my-pi `6f3fbc94` | pi-subagents `31208242` | crewai `f3d0099d` | openhands `6354932e` | hermes-agent `07f075c2` | prime-agent `815e64b5` | aider `5dc9490b` | metagpt `11cdf466` | symphony `be10a1b7` |
|---|---|---|---|---|---|---|---|---|---|---|
| static list in the system prompt | obs `core/system-prompt.ts:150-186` (`<tools>` = `- name: snippet`) | obs `.omp/skills/system-prompts/` | obs `docs/agents.md` builtin table | obs `docs/edge/en/concepts/skills.mdx` | — | obs `agent/system_prompt.py` tiers (via `docs/COMPETITORS.md`) | obs `crates/pa-core/src/prompts/` (partial) | — | — | — |
| schema-registered tool | obs `types.ts:1671` + `ToolDefinition` `types.ts:579-640` | obs `docs/custom-tools.md` (`CustomToolAPI`) | obs `src/extension/declaration-pinning.ts:67` | obs `skills/tool.py` `LoadSkillTool` | — | obs `acp_adapter/tools.py` (partial) | obs `crates/pa-agent/src/agent_loop/tools.rs` (partial) | — | obs `examples/di/custom_tool.py` (partial) | obs `elixir/lib/symphony_elixir/*/agent_tool.ex` (partial) |
| dynamic activation (declared later) | obs `ToolExposure` `types.ts:516` (`deferred`,`hidden`) + `tool_search` BM25 `extensions/tool-search/tool.ts:1-36` + `setActiveTools` `agent-session.ts:1538` | obs `docs/custom-tools.md` `defaultActive`/`restrictToolNames` | — | obs `agent/core.py:604-609` "progressively activate them later" | — | — | obs `--no-skills` `crates/pa-cli/src/args.rs:155,361` | — | — | — |
| repo-scoped extension auto-discovery | obs `package-manager.ts:2484-2491` (`.pi/extensions/`, trust-gated) | obs `.omp/tools`, `.omp/plugins` (`docs/custom-tools.md`) | obs package manifest `pi.subagents.agents` (`docs/agents.md`) | obs `lib/cli/src/crewai_cli/templates/tool/` | — | — | obs packages provide skills/prompts/themes `command_registry.rs:183` | — | — | — |
| skill discovery (paths, recursion) | obs `skills.ts:117-119` + ancestor `.agents/skills` `package-manager.ts:475-492,2504-2516` | obs `.omp/skills/*/SKILL.md` on disk | obs `skills/pi-subagents/SKILL.md` | obs `skills/loader.py`,`parser.py` | obs `.agents/skills/<n>/SKILL.md` + `references/` + `scripts/` | partial (732 skill files) | obs builtin skills `client_settings.rs:167-170` | — | — | — |
| skill advertisement (name+description injected) | obs `skills.ts:280-305` (`<available_skills>`) | obs (same format) | obs | obs `skills/models.py:26-34` level 1 = frontmatter only | obs `skills-service.ts:18-33` (`description`,`triggers`) | — | — | — | — | — |
| on-demand load of the body | obs (read tool; body never injected) | obs | obs | obs **`load_skill` tool** `skills/tool.py:24,33-35` | obs `triggers:` `​.agents/skills/verify-openhands/SKILL.md:11-13` | — | — | — | — | — |
| forced load (explicit command) | obs `/skill:name` + `disable-model-invocation` `skills.ts:262,~365` | obs | obs | — | obs `triggers` include `/verify-openhands` | — | — | — | — | — |
| trust / enablement gate | obs `package-manager.ts:2465-2467,2484` (`projectTrusted`) + per-resource overrides | obs plugin enablement | obs "when the session declined Pi project trust, discovery ignores project agents" `docs/agents.md` | obs `allowed-tools` frontmatter `skills/models.py:81` | obs skills settings route + cloud enablement (`__tests__/routes/skills-settings.test.tsx`) | obs edit-approval `acp_adapter/edit_approval.py:1-6` | obs `enable_builtin_skills` | obs `--yes-always` `args.py:760` | — | — |
| precedence rule on name collision | obs user-vs-project resources; built-in replaced with a warning `resource-loader.ts:110-146` | obs "project packages shadow same-named user packages" | obs builtin < package < user < project, "project config wins" `docs/agents.md` | — | — | — | — | — | — | — |
| session transcript (greppable, carries tool args) | obs `docs/sessions.md:50-54` + our own extraction of `write` bodies from JSONL | obs `docs/memory.md` (summaries from "persisted sessions") | obs `src/runs/shared/child-session.ts` (partial) | — | — | — | — | obs plaintext chat + input-history files `args.py:271-287` | obs role memory store `memory/longterm_memory.py:31` | — |
| recall / search over past work | obs session picker: "search, rename, and delete", `/tree`, `/fork`, `--resume` `docs/sessions.md:11-30` | obs `recall`/`reflect`/`memory://` URLs `docs/memory.md` | obs run index `src/runs/background/terminal-run-index.ts` (partial) | — | — | — | — | obs input-history search (aider's own REPL history) | — | — |
| memory file with an injection budget | — | obs **`memories.summaryInjectionTokenLimit`**, `learn` → `learned.md` (newest-first, dedup, redacted, cap 100, injected next session) | — | obs skills cache `skills/cache.py` (partial) | — | obs `compression_marker.py` (partial) | — | — | obs | — |
| dangerous-verb guard on the agent's own tools | obs `on("tool_call")` `types.ts:1661` + `{block:true,reason}` + 4 example extensions | obs extension/hook API `docs/extensions.md` (partial) | — | — | partial (`src/api/agent-server-adapter.ts` confirmation plumbing, unread) | obs `edit_approval.py` `SENSITIVE_AUTO_APPROVE_NAMES` (`.env`, `id_rsa`), auto-approve policy incl. `ask` | — | partial `--dirty-commits` `args.py:446-449` | — | — |

**The single most consequential cell** is row 2 × column 1: pi has had a first-class, schema-registered,
project-scoped tool mechanism the entire time, and this project has never used it — `AGENTS.md` (clock-in step 4) and
`.agents/skills/delegating-to-durian-pi/SKILL.md` both route the delegate to `bash`-string invocations instead. That is
the whole operator complaint, resolved by a mechanism already installed.

## 3. Q1–Q6, one row per system (claim · citation · class)

### Q1 how a tool reaches the model
- **pi** — three layers, all editable: the provider tool array (schemas), plus a `<tools>` section of one-line
  `promptSnippet`s and a `rules` section built from per-tool `promptGuidelines` (`system-prompt.ts:110-124,150-186`).
  The **active** set is what is declared: `getActiveTools`/`setActiveTools` (`types.ts:512-516`,
  `agent-session.ts:1538-1547`); `ToolExposure` decides whether registration activates a tool, and `deferred`/`hidden`
  tools stay registered-but-undeclared (`types.ts:516,629`). The set is **mutable mid-session** — `setActiveTools()`,
  and `tool_search` promotes a deferred tool into the declaration for the next model call, recording the change in the
  transcript so it survives `/tree`, resume and fork (`extensions/tool-search/tool.ts:1-16`). *observed.*
- **oh-my-pi** — one tool registry holding built-ins + loaded custom modules; discovery merges capability providers
  (`~/.omp/agent/tools`, `.omp/tools`) with **other vendors' paths** (`~/.claude/tools`, `~/.codex/tools`) and plugin
  manifests, then registers through a generated extension (`docs/custom-tools.md`, `discoverAndLoadCustomTools`).
  Restricted sessions exclude custom tools unless `allowRestrictedCustomTools` **and** the name is in `toolNames`.
  *observed (docs page in-tree; loader code not opened → the code claim is `advertised`).*
- **crewai** — built-in + `BaseTool` subclasses, and a `load_skill` tool registered at runtime
  (`skills/tool.py:24`), names sanitised (`sanitize_tool_name`). *observed.*
- **aider / metagpt / symphony / openhands(UI)** — no schema-registry surface found in the time spent. *not found.*

### Q2 can the agent author a tool the *next* session calls as a tool
- **pi — yes, and it is a file, not a memory.** Any `.ts`/`.js` in `.pi/extensions/` is auto-discovered for a trusted
  project (`package-manager.ts:2484-2491` via `collectAutoExtensionEntries` `package-manager.ts:599-640`), and its
  `pi.registerTool()` call makes the tool appear with schema, snippet and guidelines (`loader.ts:292`, `types.ts:1671`).
  `examples/extensions/dynamic-tools.ts` shows registration at `session_start` **and** at runtime behind a command. A
  same-named built-in is replaced with a diagnostic naming both (`resource-loader.ts:110-146`). *observed.*
- **oh-my-pi — yes, strongest ergonomics**: a whole *directory vocabulary* for it (`.omp/tools`, `.omp/plugins`,
  `~/.claude/tools`, `~/.codex/tools`) — and it reads other harnesses' tool dirs, so one authored tool is portable
  across three harnesses. *observed (docs) / advertised (loader).*
- **pi-subagents — yes via a package**: agents are markdown files a package ships (`docs/agents.md` precedence table) and
  the package registers them as tools (`src/extension/declaration-pinning.ts:67`). *observed.*
- **crewai — yes via scaffolding**: `crewai skill create` writes a `skills/<name>/` skeleton with a frontmatter template
  (`lib/cli/src/crewai_cli/skills/main.py:24-56`); `templates/tool/` scaffolds an installable tool package. *observed.*
- **aider / symphony** — no mechanism found. *not found.*

### Q3 skills / instruction packs — lifecycle
- **pi** — discovery: a directory containing `SKILL.md` is a skill root and is **not recursed past**; root `.md` children
  load; otherwise recurse (`skills.ts:117-119`). Discovery is **ignore-file aware** (`.gitignore`, `.ignore`,
  `.fdignore`, `skills.ts:19` + `addIgnoreRules`), so a skill under a gitignored path is invisible — relevant to us:
  nothing may ever live in `.spike/` again if we want it advertised. Paths, in load order
  (`package-manager.ts:2484-2565`): project `.pi/skills` (trusted only) → project `.agents/skills` from **every ancestor
  up to the git root** (`collectAncestorAgentsSkillDirs` `package-manager.ts:475-492`) → user `~/.pi/agent/skills` →
  `~/.agents/skills`. Validation: description required, **≤1,024 chars** (`skills.ts:13,115-126`); name = frontmatter
  name else parent dir (`skills.ts:243-245`); a skill with warnings still loads unless the description is empty
  (`skills.ts:251`). Advertisement: `<available_skills>` name/description/location (`skills.ts:280-305`). Gating:
  `disable-model-invocation: true` removes the skill from the prompt entirely — then only `/skill:name` reaches it
  (`skills.ts:262` and the filter at the head of `formatSkillsForPrompt`). Project trust is the gate for project skills
  (`package-manager.ts:2465-2467`). *observed.*
- **crewai — the tiering we lack.** Disclosure levels `1|2|3` = frontmatter-only / full body / cataloged resource
  listing (`skills/models.py:4,26-34,103,117-123`), a per-agent `set_skills()` that keeps skills at level 1 and
  "progressively activate[s] them later" (`agent/core.py:600-619`), and a `load_skill` runtime tool for the model to
  raise the level itself (`skills/tool.py:24,33-35`). Frontmatter carries **`allowed-tools`, "pre-approved tool names
  the skill may use"** (`models.py:81`) — a capability grant attached to the instruction pack, which we have no word
  for. Usage is **telemetered** (`events/types/skill_events.py`, `SkillUsedEvent`) — i.e. their census question is
  answerable from the product, not from transcripts. *observed.*
- **openhands — trigger-based activation.** `.agents/skills/<name>/SKILL.md` frontmatter carries a `triggers:` list
  mixing a slash command (`/verify-openhands`) with literal phrases ("feature map"), and the description is written in
  the third person as a *use this when* clause; the skill dir also holds `references/guide.md`, `references/feature-map/`,
  `references/backfills/*.json` and `scripts/control-openhands.mjs` — **the skill ships its own instruments and evidence**
  (`.agents/skills/verify-openhands/SKILL.md:1-13`, file list from `git ls-files`). Catalog entries expose
  `name/description/triggers/category/license/compatibility` (`src/api/skills-service.ts:18-33`). *observed.*
- **pi-subagents — the precedence table we should copy verbatim**: builtin < installed package < user
  `~/.pi/agent/agents/**` < project `.pi/agents/**`, legacy `.agents/**` still read with project winning collisions,
  plus `agentScanDirs` (extra roots), `agentExcludeDirs` (prune), `agentScope: user|project|both`, and degradation to
  `user` when project trust was declined (`docs/agents.md`). *observed.*
- **prime-agent** — skills are a first-class resource with a kill switch (`--no-skills`, `-ns`) and
  `enable_builtin_skills`; packages provide skills, prompts and themes (`args.rs:155-156,351,361`;
  `client_settings.rs:167-170`; `command_registry.rs:183`). *observed (flags); partial (injection path unread).*
- **aider, metagpt, symphony** — **0 `SKILL.md` files in the index** (aider 691 files, metagpt 1,255): no skill surface
  at all. *observed absence.*

### Q4 what survives a session boundary
- **pi** — JSONL sessions under `~/.pi/agent/sessions/` **grouped by cwd**, relocatable by `--session-dir`,
  `PI_CODING_AGENT_SESSION_DIR` or the `sessionDir` setting; `--continue` = most recent for the cwd, `--resume` = a
  picker that can **search, rename, delete, sort, filter to named sessions**; `/tree` and `/fork` give intra-session
  branching; `--no-session` is ephemeral and cannot be resumed (`docs/sessions.md:11-54`). The transcript carries
  `toolName` and result content (`docs/session-format.md:92`) and **the tool-call arguments** — which is how this rig
  recovered full `write` bodies of deleted files (`docs/reviews/pi-harness-usage-audit-2026-10-28.md` §"The transcripts
  are a durable layer nobody used"). **No retention or size numbers are published** in the docs read. *observed.*
- **oh-my-pi** — a memory layer that is **off by default** with five backends (`off|local|hindsight|mnemopi|sharpshooter`),
  a named injection budget (`memories.summaryInjectionTokenLimit`), a `learn` tool writing newest-first, deduplicated,
  secret-redacted lessons capped at **100 entries** (each ≤2,000 chars + 400 chars context) **injected starting with the
  next session** — deliberately not mutating the running session's prompt-cache prefix — and `memory://` URLs so the
  agent can read the artifacts rather than trust the injection, including **generated skill playbooks** at
  `memory://root/skills/<name>/SKILL.md` (`docs/memory.md`). The local backend's guidance also states the precedence
  rule we should steal: *"Prefer repo state and user instruction when they conflict with memory; treat conflicting
  memory as stale."* *observed.*
- **aider** — the oldest, cheapest version: two plaintext files (chat history and input history, `args.py:271-287`),
  and commands the agent ran are appended to input history (`coders/base_coder.py:2474`). *observed.*
- **metagpt** — per-role long-term memory with explicit `recover_memory(role_id, rc)` on startup
  (`memory/longterm_memory.py:21-40`). *observed (interface only).*
- **pi-subagents** — background run index + child-session persistence (`src/runs/background/terminal-run-index.ts`,
  `src/runs/shared/child-session.ts`). *partial — named, not read.*

### Q5 anti-re-derivation specifically
- **crewai**: `load_skill` + level-1 catalog means the *list of what exists* is always in context and the body costs one
  call — the tiering is the anti-re-derivation device. *observed.*
- **pi**: `tool_search` (BM25 over tool metadata, `extensions/tool-search/tool.ts:1-36`, limit 8) reaches undeclared
  tools; `cache-stats.ts`/`cache-warmer.ts` exist for prompt-cache economics (unread); session picker search;
  `examples/extensions/todo.ts`, `bookmark.ts`, `summarize.ts`, `handoff.ts`, `custom-compaction.ts` are the
  recap/handoff pieces. *observed that they exist and are examples; their behaviour is `advertised`.*
- **pi-subagents**: `src/agents/proactive-skills.ts:6-8` — when a skill has been **referenced ≥ 2 times**, the package
  recommends running a subagent (default `reviewer`, cap 3 recommendations, hard cap 5). A product answer to "you keep
  doing the same measurement by hand". *observed.*
- **oh-my-pi**: `learn`/`recall`/`reflect`; consolidation runs in the background (`memory://` queue, `/memory sync`).
  *observed (docs).*
- **aider**: shell-shaped — input history recall. *observed.*
- **No observed instance** of memoised tool outputs or a command-results cache in any of the nine. *not found.*

### Q6 guardrails on the agent's own verbs
- **pi**: `tool_call` fires before execution with **mutable** `input` and may `{block:true, reason}`; later handlers see
  earlier mutations and nothing is re-validated after them (`types.ts:1194-1264`); `tool_result` can also be rewritten
  (`types.ts:1662`). Shipped examples: `permission-gate.ts` (regex list `rm -rf`, `sudo`, `chmod 777` → UI confirm,
  **blocked without UI**), `protected-paths.ts` (blocks write/edit to `.env`, `.git/`), `confirm-destructive.ts`
  (cancels `session_before_switch`/`_fork`), `dirty-repo-guard.ts`, `project-trust.ts`. Tool metadata even carries
  `destructiveHint`/`readOnlyHint`/"permission extensions can use them to decide which calls to confirm"
  (`types.ts:519-531`). *observed.*
- **hermes-agent**: pre-execution edit approval, deliberately **outside** the tool registry and bound per-runtime through
  a `ContextVar`, so CLI/gateway sessions bypass it by construction; `SENSITIVE_AUTO_APPROVE_NAMES` = `.env`,
  `.env.local`, `.env.production`, `id_rsa`, `id_ed25519`; an auto-approve policy of `ask`; `paths` (not the display
  `path`) is "the authoritative set for auto-approve checks" (`acp_adapter/edit_approval.py:1-45`). *observed.*
- **aider**: the guard is a *commit* guard, not a verb guard — `--dirty-commits` (default True) and `--yes-always`
  (`args.py:446-449,760`), plus a `.aiderignore` at the git root (`args.py:422-431`). *observed.*
- **No harness in this set blocks `git worktree prune` or `git clean -fd` by default.** The nearest are pi's example
  patterns and aider's dirty-commit default. Our 2026-10-28 ledger loss (36 → 1 registrations) has no upstream guard that
  would have stopped it; the closest writable one is pi's `tool_call` block. *observed.*

## 4. Evidence table (external claims)

| claim | source | class |
|---|---|---|
| pi auto-discovers `.pi/extensions/` for a trusted project; `registerTool()` puts the tool in the model's tool list | `@earendil-works/pi-coding-agent@1.4.0` `src/core/package-manager.ts:2484-2491`, `src/core/extensions/loader.ts:292`, `src/core/extensions/types.ts:1671` | observed (installed package; TS read from the shipped `.js.map` `sourcesContent`) |
| pi injects `.pi/APPEND_SYSTEM.md` as the `addendum` section, and the project file replaces the user file | pi `src/core/system-prompt.ts:27-28,172`; pi `docs/configuration.md:20-21,33-35,39` | observed (code) + advertised (docs) |
| pi admits skills may not be loaded by the model and prescribes `/skill:name` | pi `docs/skills.md` ("A model might fail to load a relevant skill, so use `/skill:name` when you need to force it") | advertised (maintainer) |
| pi sessions are per-cwd JSONL with a searchable picker, `/tree`, `/fork`, relocatable store | pi `docs/sessions.md:11-30,50-54` | advertised (maintainer, in-package docs) |
| pi tool-call transcripts carry `toolName` + result content | pi `docs/session-format.md:92` | advertised (maintainer) |
| pi transcript carries tool **arguments** (deleted files recoverable) | this rig: `docs/reviews/pi-harness-usage-audit-2026-10-28.md`; extraction over 87 transcripts | observed (us) |
| oh-my-pi discovers tools in `.omp/tools`, `~/.claude/tools`, `~/.codex/tools` and plugin registries; project packages shadow user | `oh-my-pi@6f3fbc94` `docs/custom-tools.md` "Discovery locations (loader API)" | advertised (in-tree docs; `packages/coding-agent/src/extensibility/custom-tools/loader.ts` not opened) |
| oh-my-pi has 5 memory backends, a named injection token cap, `learn` → 100-entry newest-first lessons injected next session, `memory://` reads, generated skill playbooks | `oh-my-pi@6f3fbc94` `docs/memory.md` | advertised (maintainer) |
| oh-my-pi maintainer guidance: a small-model prompt carries ~3–5 constraints; rules dilute; enforce in code | `oh-my-pi@6f3fbc94` `.omp/skills/system-prompts/small-models.md` | advertised (maintainer, written for their own prompts) |
| crewai skills have progressive disclosure levels 1–3, a `load_skill` tool, `allowed-tools` pre-approval, `SkillUsedEvent` telemetry, `crewai skill create` scaffold | `crewai@f3d0099d` `lib/crewai/src/crewai/skills/{models.py:4,26-34,81,103-123, tool.py:24-35, cache.py}`, `lib/crewai/src/crewai/agent/core.py:600-619`, `lib/cli/src/crewai_cli/skills/main.py:24-56` | observed |
| openhands ships `.agents/skills/` with `SKILL.md` + `references/` + `scripts/` and a `triggers:` list; catalog is an immutable build-time snapshot | `openhands@6354932e` `.agents/skills/verify-openhands/SKILL.md:1-13`, `src/api/skills-service.ts:18-40` | observed |
| hermes-agent gates edits per-runtime with a ContextVar, bypassable by design, with a sensitive-name list | `hermes-agent@07f075c2` `acp_adapter/edit_approval.py:1-45` | observed |
| prime-agent exposes `--no-skills`, `enable_builtin_skills`, and packages that provide skills/prompts/themes | `prime-agent@815e64b5` `crates/pa-cli/src/args.rs:155-156,351,361`, `client_settings.rs:167-170`, `command_registry.rs:183` | observed (flags/registry), partial (injection unread) |
| pi-subagents precedence builtin < package < user < project, trust-degraded discovery, `agentScanDirs`/`agentExcludeDirs` | `pi-subagents@31208242` `docs/agents.md` ("Where agents live", "Discovery notes") | advertised (maintainer docs) + observed (`src/extension/declaration-pinning.ts:67`) |
| pi-subagents recommends a subagent once a skill is referenced ≥2× | `pi-subagents@31208242` `src/agents/proactive-skills.ts:6-8` | observed |
| aider persists chat + input history files and records `/run` commands into input history; `.aiderignore`, `--dirty-commits`, `--yes-always` | `aider@5dc9490b` `aider/args.py:271-287,422-431,446-449,760`, `aider/coders/base_coder.py:2474` | observed |
| metagpt recovers per-role long-term memory at startup | `metagpt@11cdf466` `metagpt/memory/longterm_memory.py:21-40` | observed (interface) |
| aider, metagpt carry **no** `SKILL.md`; symphony carries 2 skill-ish hits | `git -C vendor/eval/<name> grep -l SKILL.md` counts | observed |
| upstream URLs and pins for all nine | `docs/VENDOR-PINS.md`, remotes read with `git -C vendor/eval/<n> config --get remote.origin.url` | observed |

## 5. Cost table (what each mechanism injects, per request)

Only the pi rows are measured on our own harness; the rest are marked. `1 token ≈ 4 B` is our own arithmetic, so token
columns are **estimates**.

| surface | mechanism | measured bytes | ≈ tokens/request | basis |
|---|---|---|---|---|
| `<available_skills>` for our 2 skills | pi skill advertisement | **1,167 B** | ~290 | rendered locally with the `formatSkillsForPrompt` shape (`skills.ts:280-305`) |
| one skill body | loaded only on demand | 10,963 B (`delegating-to-durian-pi`), 5,186 B (`driving-durian-pi`) | 0 standing | `stat` on `.agents/skills/*/SKILL.md` |
| description budget we are **not** using | pi cap 1,024 chars/skill | 256 and 219 used → **768 / 805 chars free** | — | `skills.ts:13` vs our frontmatter |
| `AGENTS.md` (project context) | pi context file | **5,765 B** | ~1,440 | `stat` |
| pi's built-in `docs` section | always injected unless a custom prompt | **1,142 B** | ~285 | measured from `system-prompt.ts` template with paths substituted |
| a `.pi/APPEND_SYSTEM.md` of ~10 baseline lines | proposed | ~1,200 B (design target) | ~300 | estimate, sized against the current baseline block in `docs/NEXT.md` |
| registering 6 instruments as tools | `promptSnippet` one-liner each | ~600 B (design target) | ~150 | estimate; pi renders `- name: snippet` per declared tool (`system-prompt.ts:160-165`) |
| crewai level-1 skill advertisement | frontmatter only | not measured | low | `skills/models.py:31` (level 1 = metadata only) — no number published |
| oh-my-pi memory injection | capped by config | not measurable here | **explicitly capped** | `memories.summaryInjectionTokenLimit` (`docs/memory.md`) — the only system found that names a per-injection token budget |
| hermes-agent prompt tiers | per-surface token counts published | 1,340 / 1,829 / 1,528 + 11,242 tool tokens | — | already recorded in `docs/COMPETITORS.md` §seven-clone sweep (their fixture, not ours) |

**The comparison that matters for us:** an always-injected instrument table (~300 tokens) costs about as much as the
skills advertisement pi already injects for two skills (~290 tokens) and about a fifth of what `AGENTS.md` already costs
us. Our standing injection today is roughly **2,050 B ≈ 510 tokens** before any of our own files are read.

## 6. Failure modes (Q8)

| failure | evidence | class |
|---|---|---|
| an advertised skill is never loaded | pi's own docs prescribe forcing it: "A model might fail to load a relevant skill, so use `/skill:name`" (`docs/skills.md`) | reported by maintainers |
| instruction surfaces dilute each other on small models | oh-my-pi `.omp/skills/system-prompts/small-models.md`: "roughly 3–5 constraints before rules start displacing each other"; "Code already neutralizes a failure mode? DELETE its rule" | reported by maintainers |
| an advertised-but-unused skill surface, priced | this rig: skills touched in **28 of 87** sessions while `docs/NEXT.md` was read in **75 of 87** (`docs/reviews/pi-harness-usage-audit-2026-10-28.md`) | observed (ours) |
| newly authored instruments get reused for 1–2 sessions, pointer-named ones for 6–21 | same audit; re-ran here (`tools/harness-usage-census.mjs`) | observed (ours) |
| **census numbers are corpus-scoped and the corpus is host-local** | re-run on 2026-10-29 on this host: **18 sessions / 2,356 tool calls / 267 ad-hoc (11.3%)** vs the 2026-10-28 figure of 87 sessions / 11,599 / 2,789 (24.0%). The 70 Windows-session transcripts are **not on this host** (`/mnt` shows no D: volume) | observed (ours) — correction to the audit's portability, see §7 of this file |
| agent-authored work vanishes silently | nine instruments lost; `git log --all --diff-filter=A` finds none; the harness transcript *does* hold their bodies (`pi-harness-usage-audit` §transcripts) | observed (ours) |
| a destructive verb runs unconditionally and destroys cross-OS evidence | 36 → 1 worktree registrations in one session (`docs/incidents/2026-10-28-cross-os-ledger-pruned-and-untracked-loss.md`) | observed (ours) |
| skill metadata is routinely malformed | validators exist and warn rather than fail: pi `skills.ts:115-126` (description required, ≤1,024), crewai `skills/models.py:43-79` (1–64 name, 1–1024 description, `requires`, `allowed-tools`) | inferred from maintainer code (they build lenient validators for exactly these fields) |
| a stale tool list caused a wrong action, upstream | **no evidence found** in any of the nine clones in the time spent | no evidence found |
| a subagent silently not inheriting skills/permissions | only `hermes-agent`'s operator-guidance line already recorded in `docs/COMPETITORS.md` ("pinned skills are operator guidance for the user's session, not payload for every internal fork") | advertised, single source |

## 7. What this study cost, and what is still wrong in our own numbers

- The pi half cost ~6 tool calls once the source was recovered: **the installed package's `.js.map` files carry
  `sourcesContent`**, so `dist/` is not opaque. Recipe (reproducible inline, deliberately **not landed** as an
  instrument): walk `dist/**/*.js.map`, skip `bundle/` and `node_modules/`, and for each map write `map.sources[i]`
  (leading `../` stripped) to `map.sourcesContent[i]` — 251 TS files for pi 1.4.0. The throwaway copy this session used
  was `.spike/extract-pi-src.mjs`, gitignored on purpose; if this becomes an instrument it needs a queue item, per 233.
  Citations in this file are to that extracted tree, i.e. **upstream `src/**` paths at pi 1.4.0**, and they will drift
  on a pi upgrade — re-extract rather than trusting the line numbers across versions.
- `tools/harness-usage-census.mjs` silently changes denominator per host. It printed **18 sessions / 11.3% ad-hoc**
  here and **87 / 24.0%** a day earlier when both hosts' transcripts were present. The tool does not name the corpus it
  is quoting. Fold the corpus into its own output (registered below as 237).
- Nine of the ten instruments named in this file as "ours" live in `tools/` and are reachable only as `bash` strings.
  That is the finding, not the recommendation; the recommendation is §8.

## 8. Recommendation for durian-pi (mapped to mechanisms in our tree)

Ranked by impact ÷ context cost. Every item is project-scoped (D157: nothing host-wide is delegated) and none of them
requires a new product feature. Register in `docs/ROADMAP.md` as **registered, not scheduled**.

1. **`.pi/extensions/delegate-instruments.mjs` — the instruments become tools.** `pi.registerTool()` once per instrument
   (`channel-preflight`, `broker-serve`, `queue-drain-audit`, `latency-budget`, `instrument-provenance`,
   `harness-usage-census`, `vendor-pins`), each with `promptSnippet` and `parameters`, so they appear in the tool list
   rather than in a file a session must remember. Mechanism precedent: pi `types.ts:1671` + auto-discovery
   `package-manager.ts:2484-2491`; shape to copy: `examples/extensions/dynamic-tools.ts`. *Acceptance:* a fresh session
   runs a baseline instrument without reading any doc; `harness-usage-census.mjs` shows each registered tool used in
   ≥5 distinct sessions and the ad-hoc share fall below its current 11.3% (Linux corpus). *Falsified if,* after 5
   sessions, the registered tools are unused and ad-hoc measurement holds steady.
2. **`.pi/APPEND_SYSTEM.md`, ~10 lines.** Instrument table + the six baseline commands + the standing rules ("no suite
   runs from this checkout until 232 lands", "re-inventory `git worktree list --porcelain` before and after any writing
   verb"). Mechanism: pi's `addendum` section (`system-prompt.ts:172`), which survives compaction and does not depend on
   a model choosing to read something; remember the project file **replaces** the user file (`configuration.md:39`).
   *Acceptance:* ≤40 lines, every line a command or a rule; injection ≤1.2 KB. *Falsified if* the pointer is still read
   in ~every session and the append file changes no behaviour (measure with the census's surface table).
3. **A `tool_call` guard for the verbs that took the ledger.** Adopt `examples/extensions/permission-gate.ts` verbatim
   in shape: regex list over `bash.input.command` for `git worktree prune|remove`, `git clean -fd`, and suite/test runs
   from this checkout; return `{block:true, reason}` and **block when there is no UI**. This is belt-and-braces for
   ROADMAP 232, not its substitute — the product half (`src/broker.mjs:1167` → `pruneWorktrees`) still has to land.
   *Acceptance:* a demo or a scripted session in which the guard refuses the command and the worktree registration count
   is unchanged across the session. *Falsified if* it blocks commands the runbooks tell us to run (false positives
   measured over the 18-session corpus).
4. **Rewrite the two skill `description:` fields in the openhands form** — "This skill should be used to …", plus the
   instrument keywords and trigger phrases — and consider `disable-model-invocation` for the delegate skill so it is
   reachable only by `/skill:` (the audit's finding is that advertisement is not consumption). Budget is measured, not
   guessed: **768 and 805 unused characters** of pi's 1,024 cap. Mechanism precedent:
   `openhands@6354932e .agents/skills/verify-openhands/SKILL.md:1-13`. *Acceptance:* grep for the six instrument names
   in the two `description:` fields returns them; skill consumption in the census rises.
5. **Promote transcript recall from `.scratch/` to a tracked instrument + runbook row** (`tools/transcript-recovery.mjs`
   — it already exists untracked, which is itself the 233 failure). Mechanism precedent: pi sessions picker search +
   `docs/sessions.md:11-30`; aider's history files. *Acceptance:* a `docs/runbooks/` symptom row ("a delegate-written
   file is gone and was never committed") pointing at the instrument.
6. **Copy pi-subagents' precedence and trust vocabulary into our own docs** rather than inventing one when the two-host
   workflow grows: builtin < package < user < project, project wins collisions, project surfaces ignored when trust is
   declined (`pi-subagents@31208242 docs/agents.md`). Keep as documentation for now.
7. **A capped, newest-first lessons file** (the shape of oh-my-pi's `learn` → `learned.md`: 100 entries, dedup,
   redacted, injected next session, 2,000-char cap) as the durable home for the "take notes on pitfalls" instruction we
   already have in `AGENTS.md`. Rank below 1–5 because it duplicates the ROADMAP/incident surfaces; if adopted, it must
   carry the same "treat conflicting memory as stale" rule oh-my-pi publishes.
8. **Do not adopt:** vector/embedding memory (oh-my-pi `mnemopi`/`hindsight`, metagpt long-term memory) and any
   build-time or cloud skill catalog (openhands `skills-service.ts:29-40`). Reasons are in §1; both make staleness
   invisible, which is our named failure class.

**Deferred pending the web half — now partly resolved (2026-10-29, same day).** The public-harness half landed as
`docs/reviews/harness-tools-skills-public-harnesses-research.md` (committed verbatim as `318838f5`), and five
`--depth 1` pins were granted and taken the same day: `codex d373d649`, `cline 51f63e4f`, `goose 775b3958`,
`claude-code-docs 58d6da1e`, `copilot-cli 84ee80ea` (rows generated in `docs/VENDOR-PINS.md`; `--check` PASS at 14
clones). Per-project `COMPETITORS.md` entries for the five now exist under *"The 2026-10-29 public-harness pins"*. **Two
corrections this half forced on the report above:** (1) "*no default or configurable intercept for `git worktree prune` /
`git clean -fd`*" was true of the ten observed systems but **not** of the field at large — GitHub Copilot CLI ships
`--deny-mode "command:git worktree prune"`, and its own tracker reports those rules **failing open** on a 10 s timeout
and on TCC denial ([#978](https://github.com/github/copilot-cli/issues/978)); (2) the report's own claim *"not one of the
five lets the agent register a callable tool that survives the session"* needs Goose's runtime recipe **write-back**
(`crates/goose/src/recipe/local_recipes.rs:155,194` at the pin) read against it — a capability that survives, though as
a recipe rather than a tool. Neither correction changes the recommendation's shape: an outer guard still cannot see our
broker's own `pruneWorktrees` call.

## 9. What we did not ask / could not answer here

Round 2 was routed as `docs/reviews/harness-tools-skills-followup-research-prompt.md` and is answered (with the
caveats above) in `docs/reviews/harness-tools-skills-public-harnesses-research.md`. **Round 3 is routed as
`docs/reviews/harness-tools-skills-followup-2-research-prompt.md`** — it carries a blocking evidence-repair task (50 of
that report's 64 in-body anchors point into a fetched corpus that was never delivered, and 3 of its URLs are dead; see
ROADMAP **243**) plus the six questions that remain web-only: injection budgets for the harnesses that hide theirs;
guard **defaults** vs opt-in and whether a repo commit propagates a guard to a teammate; **headless/CI** behaviour of an
approval request and of a hook that times out; whether approval state is stored out-of-band and inherited by a
non-interactive session; **capture-on-success** mechanisms and their verification prerequisites (feeds ROADMAP **240**);
and dual-host Windows/Linux distribution of instruction files.

Still unanswered from this file, and **now the delegate's own job at a pin rather than the research agent's** (operator
ruled research-first on 232, ROADMAP **241**): whether any shipped harness guards `git worktree prune` / `git clean -fd`
by default (none found in fifteen systems; Copilot CLI's opt-in deny rules are the nearest thing and fail open per its
own tracker), and how a shipped permission/policy engine actually stores and enforces a deny rule — readable now in
`vendor/eval/codex · d373d649`.

Still unanswered, and web-only: whether pi's `tool_search`/`deferred` exposure beats always-on registration at our
instrument count (needs a measured comparison, not a claim); pi's published retention/size policy for sessions (none
found in the docs read); whether `exposure:"hidden"` + `prepareLoadout` is a legitimate way to hide built-in tool
declarations we do not want; and whether `allowed-tools`-style per-skill capability grants exist in pi (not found in the
time spent).
