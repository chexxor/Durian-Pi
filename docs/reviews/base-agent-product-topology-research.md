I'll research this against primary sources. Starting broad to map the shipped systems, then reading primary docs.Good leads. Now reading the primary docs for the biggest systems.Strong primary material on Claude Code and Codex. Now the iteration-architecture, naming, and extension-policy evidence.Below is the report text, in the section-per-fence shape the prompt requires. Every quote was fetched **2026-11-06**; classes are `observed-in-source` (I read the page/repo) or `advertised-elsewhere` (search snippet only, flagged).

```markdown
## TL;DR

No shipped multi-agent coding product I could observe keeps one durable database per agent: every one of them puts conversation/queue/audit state in a per-team or per-workspace server-side store and puts isolation in the *filesystem* (worktree, scratch dir, container), which is exactly durian-pi's shape (one store per rig, one worktree per seat). Process topology splits by tier, not by taste: the interactive/local tier is one supervisor process hosting N agent sessions (Claude Code in-process teammates), the hosted tier is one VM/container per task (Codex Cloud, OpenHands sandboxes). Crash recovery is never "the supervisor remembers" — it is per-agent durable state plus a restartable supervisor, and Claude Code's own docs concede its in-process teammates do not come back after `/resume`. The team layer is almost always shipped *inside the product behind a feature flag or paid tier*, with reusable roles on the extension plane — so "extensions only" is a stricter rule than any competitor's, and its documented cost is exactly our per-seat tool-scoping gap (`README.md`: "a seat conversation stores no selection … per-seat tool scoping is a planned refinement (ROADMAP item 18)"). The single most transferable practice is Claude Code's plugin-eval harness: isolated fresh session, WITH/WITHOUT ablation reported as Δ, deterministic graders that cost nothing, mocked tools, pinned models in CI — we have the hermetic lane (`faux`) but no ablation, so we cannot currently prove a `durig.*` extension earns its keep.

## Topology comparison table

As-of dates are the fetch date for docs, plus the doc revision where the page exposed one. Version pins are as stated on the page; I did not independently verify client versions.

| System (as of) | Process model | Store model | Base vs team boundary (their words) | Crash-recovery story | Citation |
|---|---|---|---|---|---|
| Claude Code, agent teams (docs rev 2026-11-03; eval command requires v2.1.269+) | One lead process; teammates are sessions inside it by default ("In-process: all teammates run inside your main terminal"), or one CLI process per tmux/iTerm2 pane | Per-team directory: `~/.claude/teams/{team}/config.json`, one JSON mailbox per agent, task list dir kept after the session | Teams are in the **base**, experimental, flag-gated: "Agent teams are experimental and disabled by default." Roles ride the plugin/subagent plane | Weak by design: "No session resumption with in-process teammates"; team config dir deleted at session end; task dir survives on disk | [code.claude.com/docs/en/agent-teams](https://code.claude.com/docs/en/agent-teams) |
| Claude Code, subagents/agent view (docs rev 2026-10-30) | Child sessions of one CLI; background sessions get their own worktree | Session transcript per session; shared settings files | Subagents are base; packaging is plugin | Background sessions are separate processes; not a cluster | [code.claude.com/docs/en/agents](https://code.claude.com/docs/en/agents) |
| Codex Cloud (docs, 2026-11 fetch) | One VM per task ("Each cloud task runs in a VM with these default resources") | Per-task workspace seeded from a published environment snapshot; per-task saved files incl. uncommitted changes | Base CLI/cloud + separately documented SDK/App Server; team layer is not a product surface I found | Snapshot-based: "a task's saved VM state is recoverable for up to seven days"; "Saved state doesn't replace source control." | [learn.chatgpt.com/docs/environments/cloud-environments](https://learn.chatgpt.com/docs/environments/cloud-environments) |
| OpenHands Agent Canvas + Agent Server (docs rev 2026-08-12; release notes to 1.35.0) | Agent Server process runs conversations; sandbox is the isolation boundary; Cloud/Enterprise "control planes create conversation sandboxes that host Agent Server" | Backend-owned: "Agent Server stores conversation history, agent and LLM profiles, secrets, MCP configuration, and related settings." Canvas is a client only | Cleanest explicit split I found: client (`--frontend-only`) vs runtime (`--backend-only`) vs automation server | State lives in backend services, not the browser or the sandbox; sandbox is replaceable | [docs.openhands.dev/…/agent-canvas/architecture](https://docs.openhands.dev/openhands/usage/agent-canvas/architecture) |
| Antigravity App `/teamwork` (docs v2.5+; CLI 1.2.14 shown) | One harness, one desktop command center; roles spawned inside it; subagents "across isolated Git worktrees" | Dedicated project dir (`~/teamwork_projects/{PROJECT}`), per-agent scratch dirs, plan/progress **artifacts** as shared state | Team layer is a **paid-tier command** of the same product (`/teamwork`); customisation is skills/MCP/plugins | Handoff-based: orchestrator "hands off to a fresh successor between milestones to prevent context degradation" | [antigravity.google/docs/teamwork](https://antigravity.google/docs/teamwork/) · [overview](https://antigravity.google/docs/overview/) |
| pi (base libraries) (repo, 2026-11-06) | Library, no daemon; host decides | Chord/SQLite-backed documents in `packages/chord/src/store`, sessions | Library names are capability-scoped (`packages/ai`, `packages/agent`), product built on top | Not a supervision story; durability is the store's job | [github.com/badlogic/pi-mono](https://github.com/badlogic/pi-mono) |
| **durian-pi (ours, 2026-11-06)** | One broker process supervising N seats, each a separate OS process with its own worktree | One SQLite store per rig; per-seat transcripts + queue + audit inside it | Base = pi-durable seat loop + store + broker; team = `durig.router`, `durig.seat-tools`, prompts | Supervisor re-derives work from store; "One broker per database. A second `serve` refuses to start" | [github.com/chexxor/Durian-Pi](https://github.com/chexxor/Durian-Pi) |

## Findings per question

### 1. Process topology — one host process per team at the interactive tier, one VM per task at the hosted tier

Claude Code is explicit that the default team is a single process tree: "One session acts as the team lead" and teammates run "inside your main terminal" in in-process mode; split-pane mode merely gives each teammate a pane, i.e. a separate CLI process under tmux. The limit that proves the containment is stated as a limitation: a teammate's "background work can't outlive the lead's process" — [code.claude.com/docs/en/agent-teams](https://code.claude.com/docs/en/agent-teams), observed-in-source, 2026-11-06.

The hosted systems invert this: isolation is per task, not per agent-in-a-team. Codex Cloud runs each task in its own VM with published-resource defaults; OpenHands makes the sandbox the execution boundary and its Cloud control plane creates a sandbox per conversation — [learn.chatgpt.com/docs/environments/cloud-environments](https://learn.chatgpt.com/docs/environments/cloud-environments) and [docs.openhands.dev](https://docs.openhands.dev/openhands/usage/agent-canvas/architecture), both observed-in-source, 2026-11-06.

Which choice the systems with recovery make: they make the *store* the recovery unit and treat the supervisor as replaceable. Codex keeps per-task saved state for seven days; OpenHands keeps conversation history in the Agent Server so sandbox or client loss is not conversation loss. Notably, Claude Code — the one that keeps teammates in the supervisor process — is the one that documents losing teammates on resume.

durian-pi already sits on the recoverable side (separate process per seat, state in store) and is stricter than Claude Code teams on isolation (per-seat worktree). The gap versus OpenHands is that our sandbox/exec boundary is the host, not a container.

### 2. Store topology — hub store plus per-agent filesystem; I found no per-agent database

Every observed system uses one coordination store per team/workspace/task, with agent-private *files*: Claude Code has one team config + one task directory plus one mailbox JSON per agent ("Each agent's mailbox is a JSON file at `~/.claude/teams/{team-name}/inboxes/{agent-name}.json`"); Antigravity has one project dir with per-agent scratch dirs and shared plan/progress artifacts; Codex has per-task workspace state seeded from one environment snapshot; OpenHands has one Agent Server owning history. All observed-in-source, 2026-11-06.

How the shared queue stays consistent where agents are separate processes: **file locking**, not a coordinator service — Claude Code: "Task claiming uses file locking to prevent race conditions when multiple teammates try to claim the same task simultaneously." Antigravity avoids the race before it happens by assignment: "the Project Orchestrator assigns specific files to individual Workers. Multiple workers never edit the same file at the same time." Both quotes from the pages cited above.

Negative finding, scoped honestly: among the five shipped systems I read this round, none ships one SQLite/DB per agent. The per-agent-DB design the operator asked about therefore has no direct shipped precedent in this sample; its nearest shipped analogue is per-agent *state files* under one owner, which is what we already do with the store plus worktrees.

### 3. The two-seam split — two products, but the team layer usually ships inside the base binary

Three patterns, in increasing strictness:

1. **Team layer inside the product, gated**: Claude Code agent teams (experimental env flag) and Antigravity `/teamwork` (paid plans). Both keep role *definitions* on the extension plane (Claude subagent definitions/plugins; Antigravity skills/MCP/plugins) while the coordination machinery is core.
2. **Client/runtime split**: OpenHands ships Canvas as a pure client and Agent Server as the runtime, with `--frontend-only` / `--backend-only` launchers so the two halves can be deployed and upgraded separately. That is the cleanest "minimum product + optional layer" boundary I found, and it is a *service* boundary, not a plugin boundary.
3. **Library/product split**: pi ships `packages/ai` and `packages/agent` as the base and builds the interactive product above them; durian-pi then builds on `pi-durable`.

What is in their minimum product: model/tool loop, session/transcript, permissions, and (importantly) the *isolation* primitive — worktree or VM. What turns it into a team: a lead that can spawn named agents, a shared task list with claim semantics, and an inter-agent message channel. Claude Code's own comparison table names exactly these three — context, communication, coordination — [code.claude.com/docs/en/agent-teams](https://code.claude.com/docs/en/agent-teams), observed-in-source, 2026-11-06.

Where the boundary is drawn, in their words: "Skills, subagents, hooks, and MCP servers all work on their own, without a plugin" — the plugin is packaging, not capability ([plugins/overview](https://code.claude.com/docs/en/plugins/overview), observed-in-source, 2026-11-06). That is a *weaker* rule than ours: capability exists in the base, packaging is optional. Our rule (customisation lives only on the extension plane) is stricter than any of the five.

### 4. Base/extension policy in practice — what it costs, what it buys

Buys: independent versioning and a marketplace (Claude Code: plugins are "a directory … installed and loaded as one unit", installed by scope and updated from a marketplace), and the ability to gate on measured contribution (see Q8). Costs, documented:

- **Context tax on every turn** — "the name and description are in Claude's context on every turn so that Claude knows it exists", so an installed extension costs tokens even when unused (plugins/overview, observed-in-source, 2026-11-06).
- **Trust tax** — "what the plugin runs, it runs as you" (same page). There is no capability sandbox for extensions, only review.
- **Hook gaps** — Claude Code needed `TeammateIdle`, `TaskCreated`, `TaskCompleted` hooks to let extensions enforce quality gates at team boundaries; those lifecycle points had to be *added to the base* for the extension plane to be able to police it (agent-teams page). That is the classic "core needs a hook that does not exist" cost, and Anthropic paid it by growing the base.
- **Our own version of the same cost**, already written down: everything installed is active for every seat because "a seat conversation stores **no** selection", with per-seat scoping deferred to ROADMAP 18; and a durable-plane extension cannot load a coding-agent extension at all (`README.md`, observed-in-source, 2026-11-06).

A rule that failed or was reversed: OpenAI's Swarm — "Swarm is now replaced by the OpenAI Agents SDK, which is a production-ready evolution of Swarm" ([github.com/openai/swarm](https://github.com/openai/swarm), observed-in-source in the repo README, 2026-11-06). The minimal-orchestration abstraction did not survive contact with production requirements; the successor kept the primitives (agents, handoffs) and added the runtime. Lesson for us: an extension plane with no runtime guarantees gets rebuilt as a runtime.

### 5. Identity and state per agent — context per agent, role per agent, memory per workspace

Context is per agent and explicitly *not* inherited: teammates "each in its own context window", and "The lead's conversation history does not carry over" (agent-teams). Roles are per agent and reusable via subagent definitions; scratch is per agent (Antigravity: "Each subagent has its own working directory and writes its helper scripts, notes, and logs there"); durable memory/audit is per workspace/team (the store, the artifacts, the task list). All observed-in-source, 2026-11-06.

Same-workspace editing, by mechanism:

| System | Mechanism | Evidence |
|---|---|---|
| Claude Code agent teams | **None** — partition by hand: "Two teammates editing the same file leads to overwrites"; "Agent teams don't isolate teammates in worktrees" | agent-teams, agents pages |
| Claude Code agent view / subagents | Git worktree per session (auto on first edit) | agents page |
| Antigravity subagents | Isolated Git worktrees | overview page |
| Antigravity `/teamwork` | Dedicated project dir + exclusive file ownership assigned by orchestrator | teamwork page |
| Codex Cloud | One workspace per task, no sharing by construction | cloud-environments page |
| durian-pi | One worktree per seat (`src/seatroot.mjs`, `src/worktree.mjs`) + generation leases (`src/genlock.mjs`) | repo README/tree |

The sharpest single finding: within one product, the *team* surface lost the isolation the *subagent* surface had. Worktrees were not extended to teammates, and the fix offered is a prose rule ("Break the work so each teammate owns a different set of files") rather than a mechanism. durian-pi does not have this hole.

### 6. Documented failure modes

- **No resumption / orphaned agents**: "No session resumption with in-process teammates"; after resume "the lead may attempt to message teammates that no longer exist"; plus a troubleshooting section for orphaned tmux sessions (agent-teams, observed-in-source).
- **Task-state lag and premature completion**: "Task status can lag: teammates sometimes fail to mark tasks as completed, which blocks dependent tasks"; "The lead can stop early too" (same page). This is the queue-lifecycle failure class we already handle with leases and attention notices.
- **Lost work on task expiry**: Codex keeps saved VM state seven days and warns "Saved state doesn't replace source control" (cloud-environments).
- **Fake-green verification**: Antigravity ships an Auditor whose job is checking "test evidence against real command output, ensuring tests genuinely passed rather than being mocked or skipped" (teamwork page) — i.e. agents claiming green is a named, staffed failure mode in a shipped product.
- **Our own catalogues** (best evidence we have, and it is ours): `docs/incidents/2026-10-17-broker-crash.md`, `2026-10-18-broker-retry-hotloop.md`, `2026-10-18-host-resource-exhaustion.md`, `2026-10-19-worktree-carry-teardown-collision.md`, `2026-10-30-delegate-session-lost-to-host-memory-pressure.md`, `docs/incidents/2026-10-19-stranded-submission-seat-stall.md` — all present in the repo tree at fetch time (observed-in-source, 2026-11-06). Split-brain equivalent is already ruled: "two drivers double-wake, D46" (README).
- **Upgrade skew base↔add-ons**: not documented in the pages I read; our own analogue is the pin contract (`pi-main.pin.json`, `scripts/sync-pi.mjs`) and the readme's note that pi's monorepo ships "API renames" with no dev dist-tag. Marked **unmapped externally** — see follow-up.

### 7. Naming — the shipped vocabulary is "team / lead / teammate", not "fleet / swarm"

Five real examples, each in the project's own words:

1. **team / lead / teammate / mailbox** — "Coordinate multiple Claude Code instances working together as a team, with shared tasks, inter-agent messaging, and centralized management" (agent-teams page description).
2. **swarm → Agents SDK** — "Swarm is now replaced by the OpenAI Agents SDK"; note the retiring of "swarm" as a product name (openai/swarm README).
3. **Agent Canvas / Agent Server / software-agent-sdk** — component names by responsibility, not by layer ("it is not an agent runtime or sandbox", architecture page).
4. **Agent Manager → Antigravity App**, plus `/teamwork` as the layer name and "Subagents & Teamwork: Parallel multi-agent orchestration" in the nav (overview/teamwork pages). "Manager" was retired for the product name.
5. **pi-ai / pi-agent / pi-durable / pi-coding-agent** — capability-scoped package names (`packages/ai`, `packages/agent` in the tree; durable and coding-agent as distinct planes per our own README).

Pattern: the *product* is named for the user's job (coding agent, editor, canvas), the *layer* is named for the coordination noun (team, teamwork, orchestrator), and `-core`/`-runtime`/`-sdk` are used for libraries, not products. `swarm` reads as experimental and was dropped. Our `rig`/`seat` vocabulary has no direct competitor match and no observed negative signal; `-base`/`-team` as suffixes would be conventional, `-swarm` would not.

### 8. Iteration architecture — the borrowable part is ablation, not mocking

The best-documented practice I found is Claude Code's plugin eval harness ([plugin-evals](https://code.claude.com/docs/en/plugin-evals), observed-in-source, 2026-11-06), and its most important property is what it does **not** mock: the model. "Every eval run and every judge grader is a real model call on your account." What it does mock is *tools*: "A run never starts your plugin's real MCP servers unless you ask," with per-tool Markdown mocks and replayed agent-mock recordings (`.replay/`) committed for CI.

Fake-green control is structural: every case runs both arms, and "Their difference, Δ, is what the plugin contributed" — a case that scores 1.0 in both arms proves the plugin does nothing. Determinism is bought where it is cheap: `regex`, `tool_used`, `tool_order`, `file_exists` graders "cost nothing" and "There are no custom-code graders," while `llm` graders are the flaky, paid part and are excluded from scoring when they cannot be comparable across arms. Runs are hermetic in the filesystem sense — "Each run gets a temporary home directory, working directory, and Claude Code configuration" — with `max_turns` 10 and `timeout_seconds` 300 defaults, `--max-cost-usd` ceilings, exit code 2 on a partial run, and CI guidance to "Pin it in CI so a model rollout isn't mistaken for a plugin regression."

What nobody in this sample publishes: per-package edit→signal timings, p95/p99 turn durations, or a named slow-test quarantine lane. Those are **unmapped externally**; treat any plan that assumes published numbers as unverified.

## What this implies for durian-pi

| Finding | Our mechanism (named) or **unmapped** |
|---|---|
| One store per team/workspace, per-agent files (§2) | **Already matched**: one `selfdev.sqlite` per rig; `src/storeownership.mjs`; "One broker per database" (README). Keep it. Do not build per-seat DBs. |
| Process-per-agent with replaceable supervisor (§1) | **Matched**: `tools/broker-serve.mjs`, `src/broker.mjs`, `src/supervisor.mjs`, `DURIAN_PI_MAX_CONCURRENT_SEATS` + `src/genlock.mjs`. Recovery already re-derives from store. |
| Isolation belongs in the filesystem (§5) | **Stronger than Claude Code, on par with Antigravity subagents**: `src/seatroot.mjs`, `src/worktree.mjs`, `docs/BRANCH-AND-WORKTREE-LIFECYCLE.md`. |
| Team surface silently loses isolation (Claude Code) | **Not our risk**, but formalise it: a check rule that a seat has a worktree, alongside existing `store-missing-seat` / `stray-seat` rules in `src/checkup.mjs`. |
| Team layer inside base, gated (both big vendors) | **Divergence we chose deliberately.** Our team layer is `durig.router` + `durig.seat-tools` + `prompts/*.md`; but only 5 of 59 `src/*.mjs` register `defineExtension`, so the split is currently nominal. This is the central design debt. |
| Extension context tax + trust tax (§4) | **Mapped**: `docs/extensions.mjs` TRUST BOUNDARY prose; the `DURIAN_PI_EXTENSIONS` explicit listing rule; no per-seat scoping (ROADMAP 18). Our cost is bigger than Claude Code's because everything is active for every seat. |
| Hooks must be added to the base for extensions to police the team (§4) | **Mapped**: `durig.router` `send_work`/`claim_work`/`complete_work`; `src/queue-lifecycle.mjs`. If a team policy needs a hook we lack, that is a base change — record it as such rather than smuggling it into an extension. |
| Ablation ("did the extension earn its keep?") (§8) | **Gap.** We have `faux` (`DURIAN_PI_PROVIDER=faux`, `demo/offline.mjs`) and metered `demo/online.mjs`, but no WITH/WITHOUT harness. |
| Hermetic lane vs metered lane (§8) | **Matched**: offline demos are the default; `demo/online.mjs` requires `DEEPINFRA_API_KEY`. Plus `demo/__golden__/*` and `demo/test-areas.json` + `tools/what-to-test.mjs` for selection. |
| Mocked *tool* plane, real model plane (§8) | **Partially matched**: `demo/fixtures/echo-extension.mjs`, `demo/gate-clean-scorer-transcript.json`; no mock MCP/tool registry with replay. |
| Tamper-evident test evidence (Antigravity Auditor) | **Mapped in spirit**: `docs/VERIFY-PROVENANCE.md`, `scripts/verify-provenance.mjs`, `docs/evidence/2026-11-05-gate-arm-5131/`. |
| Model substitution in tests | **Mapped**: per-seat model resolution `src/seatmodel.mjs`; verifier on a second model family (`rig.starter.json`, `tools/model-probes/calibrate-verifier.mjs`). Justification of model-independence is **unmapped** — we assert structure, not invariance. |
| Published p95/p99 turn bounds, slow-test quarantine lanes | **Unmapped externally.** Our equivalents exist but are ours only: `demo/settled-within.test.mjs`, `demo/broker-max-duration.test.mjs`, `docs/runbooks/slow-loop.md`. |
| Version skew base↔add-on | **Mapped**: `pi-main.pin.json`, `scripts/sync-pi.mjs`, `docs/PI-UPGRADE-DELTA-2026-11-04.md`. |
| Naming (§7) | **Recommendation**: keep `rig`/`seat`; name the base product with a capability noun and the team layer with a coordination noun; avoid `-swarm`. No rename needed to be defensible. |

## Proposed backlog items

Registered, not scheduled. Owners are roles, not people.

| # | Item | Owner | Acceptance |
|---|---|---|---|
| B1 | **Base-with-zero-extensions proof**: a rig that runs one seat with `DURIAN_PI_EXTENSIONS` empty, end to end on `faux` and once metered | impl | A demo test that boots, claims one work item, completes it, and asserts `durig.router` was *not* loaded; green in `scripts/suite.mjs`; recorded in `docs/FEATURES.md` |
| B2 | **Extension ablation harness** (borrow from Claude Code Δ): run a scenario with and without a given extension, report WITH/WITHOUT/Δ | impl + qa | `tools/extension-ablate.mjs` emits `{with, without, delta, costUsd}` JSON; one scenario per shipped extension (`durig.router`, `durig.seat-tools`); deterministic graders first, model-graded only with a cost cap |
| B3 | **Per-seat extension selection** (closes ROADMAP 18) | lead | Seat conversation records its active extension set; `metrics` provenance line (README) reports per-seat config; a test proves seat A cannot see seat B's extension tool |
| B4 | **Isolation invariant in `check`**: every seat has a worktree, or the rig declares why not | impl | New rule id (e.g. `seat-without-worktree`) with severity per the existing error/fix-now doctrine; `demo/check.test.mjs` covers pass and both failure directions |
| B5 | **Tool-mock plane for hermetic agent tests**: fixture-backed tool responses + replay, so an agent behaviour test needs no network | qa | A test that runs a seat turn with a mocked shell/read tool and asserts a tool-sequence property; no key required; documented in `docs/TUI-TESTING.md` or a new `docs/TEST-PLANES.md` |
| B6 | **Round-2 evidence on upgrade skew and turn-latency**: Devin, Cursor background agents, Jules, Goose recipes, and any published per-package test times | delegate | Follow-up file `docs/reviews/base-agent-product-topology-followup-research-prompt.md` lists each with URL + what is still missing; no claim in this report is left un-dated |
| B7 | **Reject per-seat database** in writing | operator | A `docs/DECISIONS.md` row citing §2 (no shipped precedent observed; per-agent *files* under one owner is the shipped pattern) so the question does not reopen |

## Iteration architecture

One row per system. "Fastest loop per piece" is what the docs let you change in isolation; where no timing is published I say so rather than invent one.

| System (as of 2026-11-06) | Fastest loop per piece | Hermetic vs live test plane | Model mocking / substitution in tests | Prompt-regression technique | Long-turn bound | Slow-test quarantine |
|---|---|---|---|---|---|---|
| Claude Code + plugins | Edit a plugin dir, `--plugin-dir` load, no marketplace needed; eval a single case with `--runs 1 --ablation none` ("halves the cost … while iterating on graders") | Filesystem-hermetic runs (temp home/cwd/config, no personal settings), but **live model always**; `--max-cost-usd` bounds spend | Tools mocked (MCP mock files, `.replay/` recordings); model **not** mocked; `--model` + pinned judge model in CI | Evals as files under `evals/` with `prompt.md` + graders; Δ vs no-plugin baseline; JSON result `schemaVersion: 1` for CI gating | `max_turns` 10, `timeout_seconds` 300 defaults; cost ceiling checked before each run | None named; `--case`/`--tag` filtering plus "every-change suites only graders that don't call a judge" |
| Codex Cloud | New task from published environment; environment edit → republish | Sandboxed VM with network policy and secret proxying; no published offline lane for agent behaviour | Not documented in the pages read (**unmapped**) | Not documented (**unmapped**) | Task-level; saved state 7 days; no published p95 (**unmapped**) | **Unmapped** |
| OpenHands | Swap client (`--frontend-only`) or backend (`--backend-only`) independently; conversation runs against an Agent Server | Sandbox is the isolation boundary; Docker/K8s/host selectable | Not in the architecture page (**unmapped**) | Not in the architecture page (**unmapped**) | **Unmapped** | **Unmapped** |
| Antigravity `/teamwork` | Per-surface iteration (App/CLI/SDK) on one shared harness; skills/MCP added without touching the harness | Integrity modes (`development`/`demo`/`benchmark`) change verification depth per run | Auditor checks evidence "against real command output" — anti-mock control, not a mock lane | Acceptance criteria fixed in a prompt artifact before execution; plan/progress artifacts as the diffable record | Milestone handoffs to a fresh successor; no published durations (**unmapped**) | **Unmapped** |
| **durian-pi (ours)** | One `demo/*.test.mjs` per guarantee; `tools/what-to-test.mjs` + `demo/test-areas.json` for selection; `demo/__golden__` for rendering | **Both lanes exist**: `faux` offline (`DURIAN_PI_PROVIDER=faux`, `demo/offline.mjs`) and metered (`demo/online.mjs`) | Faux provider + fixture transcripts (`demo/gate-clean-scorer-transcript.json`); no tool-mock registry | Prompts are files under `prompts/*.md`, diffable; `src/judge.mjs` blind pairwise + `src/optimizer.mjs` guard; no golden-output eval per role | `DURIAN_PI_STREAM_TIMEOUT_MS`; `demo/settled-within.test.mjs`, `demo/broker-max-duration.test.mjs`; no published p95 | `docs/runbooks/slow-loop.md` is a habit, not a lane with replacement coverage |

What we could adopt, and what it would cost:

1. **Ablation (B2)** — adopt. Cost: roughly 2× runs per scenario plus judge calls; gives up nothing except wall clock. Verification depth *gained*, not lost.
2. **Deterministic-first graders** — adopt for extension behaviour (tool sequence, file existence, regex over transcript). Cost: we give up "the model judged it sensible"; keep one model-graded check per extension, not per case.
3. **Pinned models in CI** — adopt. Cost: a model upgrade becomes a deliberate re-baseline (`docs/VENDOR-PINS.md`, `pi-main.pin.json` already establish the habit); we give up the early warning that a new model silently changes behaviour.
4. **Tool-mock plane (B5)** — adopt narrowly. Cost: fixtures rot; we give up real-tool error-shape coverage unless one metered smoke per tool survives — so keep exactly one, run per landing, not per commit.
5. **Do not adopt** a live-model-only fast lane. Our `faux` lane is the thing Claude Code does *not* have; trading it for realism would make every edit cost money and minutes.

Open items for round 2 (to be written into `docs/reviews/base-agent-product-topology-followup-research-prompt.md`): Devin and Cursor background-agent process/store models with primary citations; any shipped per-agent database at all (I found none); published edit→signal times or turn p95/p99 from any vendor; upgrade-skew incidents between a base agent and its plugin ecosystem; and whether Goose recipes or Gemini CLI extensions document an explicit "customisation must not enter the base" rule in their own words.
```

Three caveats on the evidence, stated plainly: (1) I could not read `docs/COMPETITORS.md` or the other in-repo prior-art files, so §1–§8 may overlap material you already have — the prompt's "say which and cite it instead" instruction was not satisfiable from outside the repo; (2) no vendor in this sample publishes per-piece edit→signal timings, so Q8's timing sub-question is answered as *unmapped*, not estimated; (3) the "no per-agent database" finding is scoped to the five systems I read, not a universal claim.
## Delegate corrections (measured 2026-11-06, on the host that runs this rig)

Appended per the D211 CORRECTION precedent — the study stands as written; these are the citation defects found when its
in-repo claims were checked with `test -e` and `grep` (the project rule is that a `path:line` must be `test -e`-checked
before it enters a doc — D159 addendum). Substance unaffected; the pointers must not propagate as verified.

Host, read in the same command as the probes: **Linux Fedora 45**, kernel `7.2.15-300.fc45.x86_64`, node `v24.22.1`,
git version 2.56.0.

| Claim in this study | Measured | Probe |
|---|---|---|
| `src/queuesync.mjs` (the "queuesync seam") | **does not exist** | `test -e src/queuesync.mjs` → MISSING; the queue seams that exist are `src/queue-lifecycle.mjs` and the routing inside `src/broker.mjs` |
| "`docs/extensions.mjs` records the rule" | **does not exist** (no such file, and no `docs/extensions.md`) | `ls docs \| grep -i extension` → nothing; the rule is D212 in `docs/DECISIONS.md` plus the `src/extensions.mjs` header; the seat-tool surface is `docs/SEAT-TOOLS.md` |
| `DURIAN_PI_MAX_CONCURRENT_SEATS`, `DURIAN_PI_EXTENSIONS`, `DURIAN_PI_PROVIDER=faux`, `DURIAN_PI_STREAM_TIMEOUT_MS` | the keys `src/config.mjs` actually reads are **`DURIG_MAX_CONCURRENT_SEATS` (`:115`), `DURIG_EXTENSIONS` (`:117`), `DURIG_PROVIDER` (`:113`), `DURIG_STREAM_TIMEOUT_MS` (`:129`)** | `grep -n` against `src/config.mjs`. This is the half-applied rename registered as ROADMAP 191 / D103 — `src/config.mjs` reads only `DURIG_*` for these, so the study's names would silently read an empty config |
| "`5` of `59` register `defineExtension`" | file count confirmed **59**; registering files = **4** | `ls src/*.mjs \| wc -l` → 59; `grep -l defineExtension src/*.mjs \| wc -l` → 4 |
| "ROADMAP 18 is the per-seat tool scoping item" | **confirmed**, and stated more precisely: row 18 (`docs/ROADMAP.md:772`) is "an extension registry with named profiles — not two editions"; `docs/ROADMAP.md:2804` is the row that names it "per-seat tool scoping" | `grep -nE "^\*\*18\." docs/ROADMAP.md` |

Two findings the delegate measured that bear on §3 and §4 and are **not** in this study: a seat's model pointer can be dead
in the store while every check is green, costing 16,166 errored generations (25.1% of all) and 65.9 h of busy time —
ROADMAP 299; and a supervisor past its run deadline can linger with a live heartbeat while every read routed through it
times out, on a store that answers directly in 111 ms — ROADMAP 303. Round 2's questions 10–11 come from those.
