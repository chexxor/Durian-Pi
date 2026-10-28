# symphony (openai) — competitor review (seat-persona / system-prompt surface)

**Why this project is in the set:** it is the only project in `vendor/eval/` that makes **the agent's prompt and the
runtime config one versioned file** (`WORKFLOW.md`), and its loop is the same shape as this rig — tracker issue →
per-issue workspace → one agent session. Its spec is the rawest available material for the operator's question
(*"how do we define seat system prompts so they are easy to edit before the rig starts, and which standard do we
reuse?"*), because the file format is specified rather than implied.

## What it is (generated pin header — Do 2, from `node tools/vendor-pins.mjs --format header --project symphony --tags`)

**Pinned HEAD:** `be10a1b7f2bf7ee8e9a39364372f50a3d411e78c` (short `be10a1b7`) · **commit date:** 2026-09-15T15:24:03Z · **license:** Apache-2.0 (read `vendor/eval/symphony/LICENSE`; matched "Apache License Version 2.0") · **shallow clone:** true (a re-review needs `git fetch --unshallow origin` in place — do not delete the clone) · **latest remote tag:** `v0.0.3` (highest of 1 version-like tag(s) — `git -C vendor/eval/symphony ls-remote --tags origin`) · **maturity:** _see below_ · **operator's question:** _how do we define seat system prompts so they are easy to edit before the rig starts, and which existing standard should we reuse?_

**Manifest versions (UNRELIABLE — cite the tag and the commit date, never these):** no package manifest version read (Elixir project; `mix.exs` project version not parsed by this tool)
**Reproduce every field above with:**
```bash
git -C vendor/eval/symphony rev-parse HEAD
git -C vendor/eval/symphony log -1 --format=%cI
git -C vendor/eval/symphony rev-parse --is-shallow-repository
cat vendor/eval/symphony/LICENSE  # licence signature
git -C vendor/eval/symphony ls-remote --tags origin   # tag
```

**Maturity judgement — the spec runs ahead of the code, and that is the whole reason to read it before adopting.**
`SPEC.md` self-describes as **"Draft v1"** (`SPEC.md:1-12`) and the tag is `v0.0.3`; the only implementation in the
clone is `elixir/` (`README.md` points at `elixir/README.md`, and the brief's start-here walk finds exactly one local
doc link). Commit date 2026-09-15 — ~6 weeks quiet while the other six clones moved daily. So: **the format is
credible as a design; the runtime is a reference implementation, not a production one.** Apache-2.0 is borrowable with
attribution (and carries a patent grant, unlike the MIT projects in this set).

## Do 4 · surface inventory (walked with `node tools/competitor-brief.mjs --project symphony`; 24 tracked md files total, so the whole surface is small and readable)

| surface | opened? | what it yielded |
|---|---|---|
| `README.md`, `elixir/README.md` | yes | entry points; "copy the `commit`, `push`, `pull`, `land`, `linear` skills to your repo" (`elixir/README.md:45`) — the skills ship with the orchestrator |
| `SPEC.md` (**the contract**) | **yes, observed** | `:334` "`WORKFLOW.md` is a Markdown file with **OPTIONAL** YAML front matter"; `:344` delimiter rule; `:346` no front matter ⇒ whole file is the prompt body with an empty config; `:347` front matter MUST decode to a map, else error; `:352-353` normalized to `config` + `prompt_template`; `:355-365` the reserved top-level keys (`tracker`, `polling`, `workspace`, `hooks`, `agent`, `codex`); `:366` "**Unknown keys SHOULD be ignored for forward compatibility**"; `:369-374` extensions MAY add top-level keys and SHOULD document their schema, defaults, validation, and **whether changes apply dynamically or require restart**; `:495` the Markdown body IS the per-issue prompt template; `:560-575` **dynamic reload is REQUIRED** (re-read config + prompt on change, apply to future dispatch, in-flight sessions not force-restarted, "re-validate/reload defensively during runtime operations") |
| `elixir/WORKFLOW.md` | **yes, observed (front matter + body)** | front matter: `tracker` (kind/provider/required_labels/active_states/terminal_states), `polling.interval_ms`, `workspace.root`, `hooks.after_create` / `before_remove`, `agent.max_concurrent_agents` + `max_turns`, `codex.command` (model + sandbox flags inline), `approval_policy`, `thread_sandbox`, `turn_sandbox_policy`. Body = a per-state **operating program**: "## Related skills" (`:99-105`) names the skills each state must open, "## Status map" (`:108-118`) gives per-state behaviour, "## Step 0: Determine current ticket state and route" (`:120+`) |
| `elixir/lib/symphony_elixir/config.ex` | **yes, observed** | `@default_prompt_template` (`:8-20`) — a **built-in default prompt in code** that the file overrides, using `{{ issue.* }}` and `{% if %}` |
| `elixir/lib/symphony_elixir/prompt_builder.ex` | **yes, observed** | `@render_opts [strict_variables: true, strict_filters: true]` (`:7`); template parsed then rendered with only `attempt` and `issue` bound (`:17-24`); parse/render failures raise with the template echoed (`:34-40`) |
| `elixir/lib/symphony_elixir/workflow.ex` | yes (`:33`) | the typed pair `{config, prompt_template}` |
| `elixir/lib/symphony_elixir/config/schema.ex` | **yes, observed** | explicit validation per key (`validate_number(:interval_ms, greater_than: 0)` `:103`; `:max_turns` `:167`; `validate_change(:command, …)` `:217`) — the front matter is **typed and validated**, not free-form |
| `.codex/skills/{land,push,pull,commit,linear,debug,release}/SKILL.md` | **land observed** (`:1-14`, `:30`, `:78`, `:144`) | their own repo's skills use the `name:` + multi-line `description:` front matter ("use when asked to land, merge, or shepherd a PR to completion" — a **trigger clause in the description**), and the land skill runs a review loop that treats `## Codex Review — <persona>` comments as reviewer feedback (`:78`) |
| `elixir/AGENTS.md` | **yes, observed (30 lines)** | a short per-directory instruction file: environment, "Main quality gate: `make all` (format check, lint, coverage, dialyzer)", the WORKFLOW.md config rule, workspace-safety invariants ("Never run Codex turn cwd in source repo"), spec-alignment rules (implementation may be a superset, **must not conflict**, update the spec in the same change), and "For stateful changes, check startup, reload, restart, and failure recovery together before editing" |
| `elixir/docs/{logging.md,token_accounting.md}` | named, not opened | logging conventions + token accounting — adjacent to the persona question; on the not-read list below |

**Not read, and why:** `elixir/test/**` (not opened — see the Do 5 finding that nothing cites `SPEC.md`, so the tests
were not read as conformance evidence); `elixir/lib/symphony_elixir/{asana,github,gitlab,jira,linear}/*_tool.ex`
(tracker integrations, out of the operator's question); `elixir/docs/token_accounting.md` and `elixir/docs/logging.md`
(cost/logging surfaces; they matter to ROADMAP 189/140, not to personas — flagged for the verifier-family work);
`.codex/skills/{push,pull,commit,linear,debug,release}/SKILL.md` (only `land` opened as the representative; the others
are the same shape — a **representative-artifact** read, which is what Do 5's category rule requires, not a category
dismissal).

## Do 5 · standards-and-policies pass

The Do 5 pattern (`OWASP|NIST|SP 800|CIS Benchmark|ISO 27001|ISO \d|SOC 2|EU AI Act|MITRE|ATF|ASIL|CWE|NVD|CVE-|responsible AI|AI safety|guardrail|threat model`) over `*.md/*.mdx/*.yml/*.yaml/*.json` of this clone returns **exactly one
file** (`.codex/skills/land/SKILL.md:144`, "methodology + guardrails used" — prose about PR review, not a control
framework), and `git ls-files | grep -ci "security|threat"` = **0**. So there is **no external control framework
mapped here at all** — recorded with its pattern and counts, not guessed.

What this project *does* ship is a **normative spec in its own right**: `SPEC.md` contains **56 `MUST`, 59 `SHOULD`,
31 `MAY`** (counted with `grep -c` on the pinned file). That is the standard-shaped artifact worth studying, and the
finding that goes with it: **`git grep -l "SPEC" -- elixir/test` returns nothing** — no test names a clause, so the
56 MUSTs have no clause-level verification. That is durian-pi's own failure mode pointed at a competitor's spec
(`docs/runbooks/held-drain-audit-2026-10-28.md`: **0 of 39 runbooks fill `check_rule:`**; ROADMAP 81/82 propose the
wiring). It is evidence *for* 81/82, gathered from outside our repo.

| standard-shaped thing | cited | call |
|---|---|---|
| RFC-2119 keyword discipline in a design spec | `SPEC.md` (56/59/31 counts above) | **adopt** — our `docs/ROADMAP.md` acceptance lines and `docs/runbooks/*` Verify sections should use MUST/SHOULD/MAY deliberately; we already use them informally |
| "Unknown keys SHOULD be ignored for forward compatibility" + "extensions MUST document their schema, defaults, validation, and whether changes apply dynamically or need restart" | `SPEC.md:366, 369-374` | **adapt** — `src/config.mjs` today has a fixed key list and D103 shows a half-applied rename going unnoticed; forward-compat plus a documented extension rule is exactly the missing contract |
| Dynamic reload REQUIRED, scoped to *future* dispatch, in-flight sessions untouched | `SPEC.md:560-575` | **adopt the wording, not the machinery** — this is the sentence that decides what "edit the persona before the rig starts" means when the rig is already running |
| No external security/compliance mapping at all | 0 files (`security|threat`), 1 prose hit above | **reject as a model** — a spec-only project skipping the control pass is the same hole Do 5 exists to close; we do not copy it |

## Adoptable practices

| # | practice | evidence path | durian-pi mechanism it would change | call |
|---|---|---|---|---|
| 1 | **Persona and runtime config in one file**: YAML front matter = typed config, Markdown body = the prompt | `SPEC.md:334, 352-353, 495`; `elixir/WORKFLOW.md:1-40` | `rig.selfdev.json` (persona inline in JSON next to seat settings) and `wip/seat-prompt-files` | **adopt the shape** — a seat file whose head is config and whose body is the prompt. This is the single most direct answer to "easy to edit before the rig starts" |
| 2 | **Front matter is OPTIONAL; absent ⇒ the whole file is the prompt** | `SPEC.md:334, 346` | seat prompt authoring has no zero-config path | **adopt** — a low-ceremony default that still validates when a header *is* present (`:347` non-map YAML is an error) |
| 3 | **A built-in default template in code, overridable by the file** | `config.ex:8-20` | a seat with no `instructions` today gets nothing persona-shaped | **adopt** — the rig supplies a sane seat prompt; a seat file customises it |
| 4 | **Strict template rendering** (`strict_variables`, `strict_filters`), and the template echoed on failure | `prompt_builder.ex:7, 34-40` | seat prompts are plain strings; a typo in an interpolated name is invisible | **adopt** — this is the guard our pointer/pin prose currently covers only by convention. Fits the `{var}` question raised by crewai adopt #4 |
| 5 | **The prompt body is a *program***: status map → per-state behaviour → "## Related skills" naming which skill to open per state | `elixir/WORKFLOW.md:99-120` | `docs/NEXT.md` + runbooks are read by the *delegate*, and seats get prose rules in `s.instructions` | **adapt** — route runbook/skill selection from the seat's own file instead of hoping the seat remembers it |
| 6 | **Typed, validated config keys** (numbers > 0, `validate_change` on the command string) | `config/schema.ex:103, 139, 166-170, 216-217` | `src/config.mjs` key handling; `DURIG_*` vs `DURIAN_PI_*` (D103) | **adopt** — schema validation with named rules is what makes a config drift a failure rather than a surprise |
| 7 | **Reserved-keys list + unknown-keys-ignored + extension contract** | `SPEC.md:355-374` | `src/config.mjs` (`CONFIG_KEYS`), `docs/FEATURES.md` | **adopt** — the half of D103 that is a design rule, not a rename chore |
| 8 | **Reload semantics written down** (config + prompt re-read on change; applies to future dispatch; in-flight sessions not restarted) | `SPEC.md:560-575` | seat start/restart (`cli.mjs up|run`), `scripts/apply-commit-discipline.mjs` re-inline | **adopt the wording** — decide and document whether a seat persona edit needs a restart, in one sentence |
| 9 | **A per-directory `AGENTS.md` that states the quality gate and the invariants** (`make all` = format, lint, coverage, dialyzer; "Never run Codex turn cwd in source repo"; "check startup, reload, restart, and failure recovery together") | `elixir/AGENTS.md` (observed, 30 lines) | our `AGENTS.md` entry point + `docs/runbooks/run-your-area.md` | **adopt** — ours says which command is the gate; theirs shows the *short* form (30 lines) that a seat can actually hold |
| 10 | **Spec-alignment rule written into the agent's own instructions**: implementation may be a superset, must not conflict, update the spec in the same change | `elixir/AGENTS.md` (Codebase-Specific Conventions) | `docs/DECISIONS.md` + `docs/ROADMAP.md` drift; our "ground every claim" rule | **adopt** |
| 11 | **Skill description carries its trigger** ("use when asked to land, merge, or shepherd a PR to completion") | `.codex/skills/land/SKILL.md:3-6` | `.agents/skills/*/SKILL.md` front matter (our own skill descriptions are user-facing prose) | **adopt** — a trigger clause makes skill selection mechanical instead of lucky |
| 12 | **Sandbox/approval policy in the same file, per run** (`approval_policy: never`, `thread_sandbox: workspace-write`, `turn_sandbox_policy.networkAccess: true`) | `elixir/WORKFLOW.md:31-40` | durian-pi has no per-seat sandbox/approval tier; `AGENTS.md` non-negotiables are global | **adapt the *visibility*, reject the mechanism** — the values are Codex-specific and the sandbox is the vendor's; the adoptable part is that a seat's **authority** sits in the seat's file, next to its persona |

## Coverage matrix — durian-pi against what symphony's spec claims

| capability the spec claims | durian-pi status | evidence |
|---|---|---|
| one versioned file carrying prompt + runtime config | **lack** | `rig.selfdev.json`; `wip/seat-prompt-files` unlanded |
| schema-validated config with a documented extension rule | **lack** (fixed key list, no extension contract) | `src/config.mjs`; D103 |
| strict template variable checking on prompts | **lack** | seat prompts are plain strings |
| hot reload of prompt/config | **lack** (config read at seat start) | `cli.mjs`, `src/broker.mjs` |
| per-issue workspace isolation | **have** | `cli.mjs worktree`, `docs/runbooks/*` worktree hygiene |
| per-state routing of which procedure to follow | **partial** (delegate-side: `NEXT.md`, `docs/runbooks/README.md` symptom index) | `docs/runbooks/README.md` |
| a quality gate named in the seat's own file | **have** | `AGENTS.md` + `node scripts/test.mjs --all` |
| clause-level spec conformance tests | **lack (they also lack it)** | `git grep -l SPEC -- elixir/test` empty; our side: ROADMAP 81/82, `check_rule:` filled in 0/39 runbooks |
| security/threat control mapping | **they lack it; we partially have it** (vendored-content rule, `check` rules) | `docs/COMPETITORS.md`; `src/checkup.mjs` |
| tracker integrations (Linear/Jira/GitHub/GitLab/Asana) | **not-applicable** — our tracker is the sqlite queue | `src/broker.mjs`, `demo/` |
| Codex app-server runtime | **not-applicable** — pi harness | `src/seatguard.mjs`, `rig.selfdev.json` |

## Where it does not fit our constraints

It is Elixir/OTP and talks to a hosted tracker (Linear is the default), and its agent runtime is Codex in app-server
mode with vendor sandbox settings. We are Node + a local sqlite queue + pi, so the runtime is not reusable — only the
**file contract** and the **spec discipline** are. Second: the spec is Draft v1 with a single reference implementation
and 6 weeks of quiet (`v0.0.3`), so anything we adopt must stand on its own merits, not on "symphony does it".
Third: it has no test-to-clause mapping, so its conformance is unproven — the opposite of our suite-first discipline.

## Recorded-decision check

- **D143 (persona ≠ memory ≠ routing):** adopt #1 puts persona + *authority/config* together, not memory; memory stays
  out of the seat file. Consistent, and their `agent`/`codex` keys are config, not memory.
- **D131 (native host OS only):** adopt #12 rejects the sandbox mechanism; only its visibility is taken.
- **D144 (generated + tracked artifacts):** adopt #4 (strict rendering) is the same idea as `vendor-pins --check` —
  make drift fail loudly instead of documenting it.
- **D142 (publish the pattern with the count):** every count above carries its command.

**Follow-up (Do 9):** no research-agent prompt needed. The open questions are inside this clone: read
`elixir/docs/token_accounting.md` (relevant to ROADMAP 189's context/cost question) and one more SKILL.md
(`.codex/skills/linear/SKILL.md`) to confirm the front-matter contract is uniform. Do that in the next walk.
