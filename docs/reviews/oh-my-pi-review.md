# oh-my-pi (omp) — competitor review (seat-persona / system-prompt surface)

**Why this project is in the set:** it is **in our own lineage** — a coding agent built on the pi package family
(`@oh-my-pi/pi-coding-agent`, README badges; docker target named `oh-my-pi/pi:dev`, `package.json:135`). Everything here
is a *delta on the harness durian-pi drives*, so it is the highest-transferability row in the vendor set — and the one
where "adopt" costs us the least, because the primitives are already ours.

## What it is (generated pin header — Do 2, from `node tools/vendor-pins.mjs --format header --project oh-my-pi --tags`)

**Pinned HEAD:** `6f3fbc94c567c0ac619c013dd15d718356eecba1` (short `6f3fbc94`) · **commit date:** 2026-10-27T22:48:30+01:00 · **license:** MIT (read `vendor/eval/oh-my-pi/LICENSE`; matched "Permission is hereby granted, free of charge") · **shallow clone:** true (a re-review needs `git fetch --unshallow origin` in place — do not delete the clone) · **latest remote tag:** `v18.13.2` (highest of 921 version-like tag(s) — `git -C vendor/eval/oh-my-pi ls-remote --tags origin`) · **maturity:** _see below_ · **operator's question:** _how do we define seat system prompts so they are easy to edit before the rig starts, and which existing standard should we reuse?_

**Manifest versions (UNRELIABLE — cite the tag and the commit date, never these):** package.json `null` (name "omp") — the root manifest has **no version at all**; the real published versions are per-package (`@oh-my-pi/pi-coding-agent`)
**Reproduce every field above with:**
```bash
git -C vendor/eval/oh-my-pi rev-parse HEAD
git -C vendor/eval/oh-my-pi log -1 --format=%cI
git -C vendor/eval/oh-my-pi rev-parse --is-shallow-repository
cat vendor/eval/oh-my-pi/LICENSE  # licence signature
git -C vendor/eval/oh-my-pi ls-remote --tags origin   # tag
```

**Maturity judgement.** Headline release cadence is the largest in the set — **921 version-like tags** — with HEAD one
day before this review. The root `package.json` carrying **no version field** is the trap this row teaches: a reviewer
reading "the manifest" gets nothing, while the project ships 12 versioned packages each with its own CHANGELOG (the
brief's start-here list found `packages/*/CHANGELOG.md` as the *de facto* index). Judge maturity from tag count + commit
date, and treat per-package changelogs as the truth about what changed. MIT → borrowable with attribution.

## Do 4 · surface inventory (walked with `node tools/competitor-brief.mjs --project oh-my-pi`; 670 md files across 36 doc areas; README links walked in document order)

| surface | opened? | what it yielded |
|---|---|---|
| `README.md` | **yes, observed (`:1-14`)** | "A coding agent with the IDE wired in" (`omp.sh`); npm badge points at `@oh-my-pi/pi-coding-agent`; README links go to LSP config, **Agent Hub**, slash-command internals, **magic keywords**, **vibe mode**, session operations — i.e. the docs order starts with *interaction machinery*, not a persona |
| `packages/coding-agent/src/prompts/agents/*.md` (`reviewer`, `scout`, `security-reviewer`, `task`, `seance`, `init`, `frontmatter`) | **yes, observed — `reviewer.md:1-12`** | **sub-personas are markdown files with front matter**, in the source tree: `name`, quoted `description`, **`tools:` as an explicit allowlist** (`read, find, grep, glob, bash, lsp, web_search, ast_grep`), **`spawns: scout`** (declared sub-agent graph), **`model: "@slow"`** (a role alias, not a model id), `output.properties.…` with `enum`, `metadata.description` — the sub-agent's **return contract is part of its definition** |
| `packages/coding-agent/src/prompts/agents/frontmatter.md` | **yes, observed (`:1-13`)** | the format's own **mustache template** (`{{jsonStringify name}}`, `{{#if spawns}}…`), covering `spawns`, `model`, `thinking-level`, `blocking`, `prewalk`, `advisor`, `autoloadSkills`, then `{{body}}` — the schema is a template, so docs and emitter cannot drift apart |
| `packages/coding-agent/src/prompts/advisor/*.md` (`system.md`, `boundary-guidance.md`, `context-files.md`, `memory-context.md`, `advise-tool.md`, `active-repo-watchdog.md`) | named by the brief; not opened | an **advisor** persona split into separate files per concern (boundary vs context vs memory) — persona composition by file granularity |
| `packages/coding-agent/src/config/model-presets.ts:347`, `src/extensibility/extensions/model-api.ts:27`, `types.ts:506` | **yes, observed (grep)** | **role aliases** (`@slow`, `slow: "@slow"` in `src/eval/completion-bridge.ts:65`) resolved by `resolveModelRoleValue`; comment at `model-presets.ts:347` notes an alias write "must see the state the write" — aliases are resolved against live config, not frozen |
| `docs/agent-hub.md` | **yes, observed (`:1-12`)** | **Agent Hub**: a TUI roster of subagents with per-agent activity and **usage**, transcript access, and **steering / revive / kill**; "The main agent is not listed because its conversation is the ambient session view"; **"discovers parked subagents from the current session's persisted artifacts when a session is resumed"** |
| `docs/toolconv/*.md` (12 dialects: anthropic, deepseek, gemini, gemma, glm-4.5, harmony, hermes, kimi-k2, minimax, pi-native, qwen3, xml) | `pi-native.md:110-122` observed; rest named | **per-model-family tool-call dialects documented as separate files**, including the provider fields each dialect carries (`thinkingBudgets`, `toolChoice`, `serviceTier`, `guardrailIdentifier/Version/Trace`, `kimiApiFormat`) |
| `docs/models.md` | **yes, observed (`:122, 241, 496, 988-989`)** | model **discovery and metadata**: guardrail fields as provider config; discovery falls back to OpenAI-compatible `GET /models`; explicitly **excludes task-specific modes** (`embedding`, `rerank`, `ocr`, `guardrail`, …) so a non-chat model can't be picked; "Missing, null, and unrecognized modes remain selectable so router aliases continue to work"; **128,000-token context default** when neither endpoint nor bundled reference supplies a limit; pricing unknown → represented by zero |
| `packages/coding-agent/src/prompts/tools/ratchet.md` | **yes, observed (`:19, 56`)** | a self-tuning loop tool with **evidence gates**: refuses to record a round when a guardrail has "fewer than 2 measured cases per split, e.g. unpriced models under a `cost_usd` hold"; "Slots that only errored force `rerun`, never `keep`"; an analyzer subagent must return `{"behavior", "evidence":[{trace, quote}], "diff", "expected_regressions"}` — **verbatim quoted evidence with trace paths is a required field** |
| `.omp/commands/{triage,review-prs,fix-issues,cleanup,release}.md` | listed by the brief (5 files) | **repo-versioned operator commands as markdown** — the reusable-standards artifact the operator asked about, living in the project |
| `docs/skills/*` (`authoring-extensions.md`, `authoring-hooks.md`, `authoring-marketplaces.md`, `examples/…`) | inventory | a **marketplace** concept for skills/extensions, with authoring docs and worked examples |

**Not read, and why:** `packages/coding-agent/**` beyond `src/prompts` and the two cited source lines (361 md — the
package's own docs; the persona question is answered by the prompt files themselves); `packages/tui/src/theme/glyph-bundle.json`
(standards hit was a glyph name — excluded as noise); `python/robomp/**` (docker-compose eval harness — rejected by D131,
and its mechanism is visible from the compose file names); `docs/vibe-mode.md`, `docs/magic-keywords.md`,
`docs/session-operations-*.md` (interaction features outside the persona question; named in the inventory);
`packages/mnemopi`, `packages/snapcompact`, `packages/catalog` (memory/context compaction — out of the D143 persona
question; flagged for the memory-v2 intent instead); `docs/toolconv/*` except `pi-native.md` (11 sibling dialect docs,
representative-artifact rule).

## Do 5 · standards-and-policies pass

Pattern: `\bOWASP\b|\bNIST\b|\bSP ?800\b|\bCIS Benchmark\b|\bISO ?27001\b|\bISO ?[0-9]+\b|\bSOC ?2\b|\bEU AI Act\b|\bMITRE\b|\bATF\b|\bASIL\b|\bCWE-\d|\bNVD\b|CVE-[0-9]|…|\bguardrail|attack surface|red team|jailbreak|prompt injection` → 25 files; the load-bearing ones opened:

| finding | cited (opened) | call for durian-pi |
|---|---|---|
| **"guardrail" = provider passthrough fields, not a policy** (`guardrailIdentifier`, `guardrailVersion`, `guardrailTrace` attach a Bedrock guardrail; copied through `streamSimple`) | `docs/models.md:122, 241, 988-989`; `docs/toolconv/pi-native.md:110-122` | **adapt** — they *delegate* the guardrail to the provider. Honest and cheap. Our analogue would be: if we ever adopt a guardrail, say whose it is and don't claim it as ours |
| **"prompt injection" in their docs means *injecting a prompt*, not defending against one** (`session bootstrap, prompt injection, subagent aliasing`; "caches a rendered `<mental_models>` block for prompt injection") | `docs/tools/retain.md:10, 18, 133` | **record as a vocabulary hazard** — the same phrase means attack and mechanism in adjacent projects (hermes uses it as a threat). Our reviews must state the sense. This is why D142 insists on publishing the pattern, not the conclusion |
| **No OWASP/NIST/ISO/CIS/SOC2/MITRE framework claim anywhere** | 25-file set, none asserting a mapping | zero with its pattern — recorded |
| **Evidence-quality gates written as tool rules**: minimum measured cases per split, errors never count as keeps, verbatim quotes with trace paths required in the sub-agent's return schema | `prompts/tools/ratchet.md:19, 56` | **adopt — the single best Do 5 item in this row.** Our verifier-family ruling (ROADMAP 189) needs exactly these rules: a verdict with < N measured cases is not a verdict; an error is not a pass; a claim without a quoted trace path is not evidence |
| **Model capability screening before selection** (task-specific modes excluded; unknown modes stay selectable so aliases work; context default declared) | `docs/models.md:496` | **adopt** — this is the missing pre-condition for running a small local verifier (D140): screen by declared mode, and declare the default you assume |

## Adoptable practices

| # | practice | evidence path | durian-pi mechanism it would change | call |
|---|---|---|---|---|
| 1 | **Sub-persona = a markdown file with front matter** (`name`, `description`, `tools` allowlist, `model` alias, `spawns`, `output` schema, `thinking-level`, `blocking`, `autoloadSkills`) + prose body | `packages/coding-agent/src/prompts/agents/reviewer.md:1-12` | seat prompts are **inline JSON strings** in `rig.selfdev.json`; the parked `wip/seat-prompt-files` branch is the same idea unverified | **adopt — this is the answer to the operator's question in our own lineage.** A seat file with this field set is editable before the rig starts, diffable, and checkable; and it is a format pi already understands |
| 2 | **The persona file also declares its tool allowlist and its return contract** | `reviewer.md:4, 9-12` | seats get harness-default tools; verifier output shape is convention, not declared | **adopt** — turns "what can this seat do and what must it give back" into a reviewable line |
| 3 | **Model as a role alias (`@slow`) resolved against live config** | `agents/reviewer.md:6`; `config/model-presets.ts:347`; `extensibility/extensions/model-api.ts:27` | `rig.selfdev.json` pins a model per seat | **adopt** — a seat says what it needs (`@thorough`, `@cheap`); the operator's 189 cost/throughput ruling then becomes a preset edit, not a 12-seat find/replace |
| 4 | **`spawns:` declares the sub-agent graph in the persona** | `reviewer.md:5` (`spawns: scout`) | subagents are ad-hoc tool calls | **adopt** — makes the delegation surface reviewable, and makes an unexpected subagent detectable |
| 5 | **The format's schema is itself a template** (`frontmatter.md` mustache) | `agents/frontmatter.md:1-13` | our `docs/FEATURES.md`-style docs drift from code (`demo/features-drift.test.mjs` exists because of it) | **adopt** — generate the doc from the emitter, per D144 |
| 6 | **Agent Hub: live subagent roster with usage, transcripts, steering/revive/kill, and resume-time discovery of parked subagents from persisted artifacts** | `docs/agent-hub.md:1-12` | our TUI shows seats/queue, not subagents; **orphaned/parked work is the operator's open intent** (`audit-15-orphans-and-5-parked`) | **adopt the resume-discovery idea first, and it is the cheapest item in this review** — an orphan audit is a query over persisted spool/session artifacts, and it directly serves a stranded operator intent |
| 7 | **Repo-versioned command files** (`.omp/commands/*.md`: triage, review-prs, fix-issues, cleanup, release) | `git ls-files .omp/commands` | our equivalents are `docs/runbooks/*` prose + CLI verbs | **adopt the shape** — a runbook step sequence that the harness can *run* is the reusable-standards artifact; keep our front matter (id, last_verified, done) |
| 8 | **Per-model tool-call dialects documented one file per family** (12 families) | `docs/toolconv/` | single pi dialect; D140 wants small local models | **adapt** — don't write a dialect layer; do record, per candidate verifier model, which dialect it needs, before choosing |
| 9 | **Capability/pricing screening with declared defaults** (excluded modes; `128000` context default; unknown price = zero, declared) | `docs/models.md:496` | seat model choice has no capability/cost check | **adopt the declared-default habit**; feeds 189 |
| 10 | **Evidence gates as tool rules** (min cases per split; errors never `keep`; quoted trace paths in the schema) | `prompts/tools/ratchet.md:19, 56` | seeded-bug gate + verifier judgement | **adopt** — see Do 5 table |
| 11 | Skills/extensions **marketplace** | `docs/skills/authoring-marketplaces.md` | n/a (single rig, local skills) | **reject for now** — distribution is not our problem; trust is |
| 12 | Docker image / compose eval harness | `package.json:135-144` | n/a | **reject** (D131) |

## Coverage matrix — durian-pi against what omp claims

| capability they claim | durian-pi status | evidence |
|---|---|---|
| persona file with front matter (tools, model alias, spawns, output contract) | **lack** (inline JSON; parked branch) | `rig.selfdev.json`, `wip/seat-prompt-files` |
| schema generated from a template | **lack** | `demo/features-drift.test.mjs` |
| model role aliases resolved at runtime | **lack** | `rig.selfdev.json` |
| subagent control surface (roster, usage, steering, kill) | **partial** (seats only, no subagents) | `tui.mjs`, `src/` |
| resume-time discovery of parked/orphan subagents | **lack** | operator intent `audit-15-orphans-and-5-parked` (stranded) |
| repo-versioned runnable commands | **partial** (runbooks are prose for a human/delegate) | `docs/runbooks/` |
| per-model dialect documentation | **lack** | — |
| model capability/pricing screening | **lack** | — |
| evidence gates on measurement | **partial** (seeded-bug gate; no min-sample rule) | `docs/FEATURES.md` |
| LSP / ast-grep tool surface | **lack** (delegated to pi) | pi tools |

## Where it does not fit our constraints

It is a **single-user interactive coding agent**: its multi-agent story is one session's subagents, not a standing team
with a queue and a store. Its Hub, goals, and slash commands assume a human at a keyboard; durian-pi's seats are driven
by a broker over sqlite and mostly run unattended. So the persona-file format, aliases and evidence gates transfer
directly, while the *interaction* machinery (vibe mode, magic keywords, hub keyboard) does not — our equivalent must be
TUI-visible and delegate-operable. It also assumes a docker dev image (`package.json:135`), which we reject (D131).

## Recorded-decision check

- **D143:** their persona file declares tools + model + return contract but **not** memory (memory is `packages/mnemopi`) — matches our separation exactly. Adopt #1 must not grow a memory field.
- **D140 (verifier = cost/throughput/context/availability):** adopts #3, #8, #9, #10 are all inputs to that pending ruling.
- **D144:** adopts #5/#6 are generated-artifact and query-over-artifacts discipline.
- **D131:** reject #12.
- **D142:** the "prompt injection" vocabulary collision is a direct argument for publishing patterns and sense together.

**Follow-up (Do 9):** inside this clone, next walk opens `packages/coding-agent/src/prompts/agents/task.md` +
`scout.md` (the default sub-agent), `src/prompts/advisor/system.md`, and the parked-subagent discovery code
(`git grep -n "parked" -- packages/coding-agent/src`) — the last one is a direct implementation reference for the
orphan audit. No research-agent prompt. One **operator** question: whether durian-pi adopts omp's persona-file shape as
the target format for the parked `wip/seat-prompt-files` branch — if yes, that decides ruling #1 (seat-persona surface)
without inventing our own format.
