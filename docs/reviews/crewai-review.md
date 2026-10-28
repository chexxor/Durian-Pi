# crewai — competitor review (seat-persona / system-prompt surface)

**Why this project is in the set:** the operator's redirect (2026-10-28) was *"can we copy patterns for defining
subagent system prompts from other projects with more mindshare? Maybe we can find some standards to re-use."*
CrewAI is the highest-mindshare project in the set that puts a **persona in a declarative file**, and it is also the
only one that ships an **instruction file for other vendors' coding agents** — the two surfaces our seat-persona
question is about. `docs/COMPETITORS.md` (ROADMAP 81) is the maintained list; this file is the per-project review
`docs/runbooks/competitor-review.md` Do 6 requires.

## What it is (generated pin header — Do 2, emitted by `node tools/vendor-pins.mjs --format header --project crewai --tags`)

**Pinned HEAD:** `f3d0099d34929b5421468d9dbbb57dbd0e67a0ba` (short `f3d0099d`) · **commit date:** 2026-10-28T01:49:03-03:00 · **license:** MIT (read `vendor/eval/crewai/LICENSE`; matched "Permission is hereby granted, free of charge") · **shallow clone:** true (a re-review needs `git fetch --unshallow origin` in place — do not delete the clone) · **latest remote tag:** `1.15.32` (highest of 253 version-like tag(s) — `git -C vendor/eval/crewai ls-remote --tags origin`) · **maturity:** _see below_ · **operator's question:** _how do we define seat system prompts so they are easy to edit before the rig starts, and which existing standard should we reuse?_

**Manifest versions (UNRELIABLE — cite the tag and the commit date, never these):** pyproject.toml no top-level version (name "crewai-workspace")
**Reproduce every field above with:**
```bash
git -C vendor/eval/crewai rev-parse HEAD
git -C vendor/eval/crewai log -1 --format=%cI
git -C vendor/eval/crewai rev-parse --is-shallow-repository
cat vendor/eval/crewai/LICENSE  # licence signature
git -C vendor/eval/crewai ls-remote --tags origin   # tag
```

**Maturity judgement.** Active to the commit date (HEAD is 2026-10-28, the day of this review) and versioned like a
product, not a spec: 253 version tags, a current release and a separate `edge` docs tree. Two traps that decide how
much of it is citable: (a) the docs site keeps **48 older release trees** — `docs/v1.15.32` is current with 772
files and 34,978 files in the clone are older releases, so a whole-`docs/` grep reads stale APIs as live; (b) the
default project layout changed under the current release — the CLI template now generates **JSONC crews**
(`agents/*.jsonc`, `crew.jsonc`) while `config/agents.yaml` is labelled **classic**
(`lib/cli/src/crewai_cli/templates/AGENTS.md:95`, observed). A review that copies `agents.yaml` as "the current
standard" copies the legacy layout. Licence MIT → borrowable with attribution.

## Do 4 · surface inventory (walked with `node tools/competitor-brief.mjs --project crewai`, 3.8 s, 38,894 tracked files)

| doc area / surface | opened? | what it yielded |
|---|---|---|
| `README.md` | yes (brief) | entry points; no persona contract itself |
| `docs/edge/en/concepts/agents.mdx` | **yes, observed** | the persona attribute table: `role`/`goal`/`backstory` with types (`:41-43`), and the three override slots `system_template`/`prompt_template`/`response_template` (`:57-59`); behaviour flags `inject_date` (`:65`), `respect_context_window` (`:63`); the deprecated list (`:104` of AGENTS.md mirrors it) |
| `lib/crewai/src/crewai/agent/core.py` | **yes, observed** | the `Agent` contract (`:217-235`); `system_template` field (`:280`); an **`llm_overlay` keyed by role**, re-resolved when input interpolation rewrites the role (`:495-538`, `overlay_llm_for(self.role, declared)` at `:538`) |
| `lib/crewai/src/crewai/utilities/prompts.py` | **yes, observed** | the prompt is **composed from named slices**: `COMPONENTS = Literal["role_playing","tools","no_tools","native_tools","task",…]` (`:48-56`), `slices = ["role_playing"] + tools` (`:99-105`), then `_build_skill_block() + _build_date_block()`; persona values are substituted at `:259-261` (`{goal}`,`{role}`,`{backstory}`) |
| `lib/crewai/src/crewai/translations/en.json` | yes (named by grep as the only holder of `role_playing`) | the persona scaffold text lives **outside code**, in a locale catalogue — the scaffold is data, translatable |
| `lib/cli/src/crewai_cli/templates/AGENTS.md` | **yes, observed (all 139 lines)** | a **generated coding-agent instruction file** shipped by `crewai create`; sections: session start (`:15`), check-before-writing (`:25`), eval loop (`:35`), deploy (`:52`), **what only the user can do** (`:64`), **definition of done** (`:73`), Reference (`:85`), **"Facts models get wrong"** (`:104`); tool-owned blocks spliced by `<!-- crewai-eval:start -->` / `:end` markers at `:34/:50` and `:76/:78` |
| `lib/cli/src/crewai_cli/templates/CLAUDE.md`, `CURSOR.md`, `GEMINI.md` | **yes, observed** | 5-8 line per-harness adapters that import one shared file (`@AGENTS.md`), each naming why it exists ("Claude Code loads this file and ignores `AGENTS.md`") |
| `lib/cli/src/crewai_cli/templates/crew/config/agents.yaml` | **yes, observed** | the persona file: two agents, keys `role`/`goal`/`backstory`, values carry **`{topic}` placeholders** filled from `kickoff(inputs=…)` |
| `lib/cli/src/crewai_cli/templates/declarative_flow/flow.yaml` | **yes, observed** | `schema: crewai.flow/v1` — a **versioned schema key** on the declarative file |
| `lib/crewai/src/crewai/skills/{loader,parser,registry}.py` + `docs/edge/en/concepts/skills.mdx:3` | loader observed; docs observed (advertised otherwise) | "Filesystem-based skill packages that inject domain expertise and instructions into agent prompts"; attach syntax `@<org-uuid>/<handle>@<version>`; resolve order `./skills/`, `~/.crewai/skills/`, download (from `AGENTS.md:114`, observed in the file, implementation only partly opened) |
| `.github/workflows/vulnerability-scan.yml` | **yes, observed (1-40)** | PR + push + weekly-cron scan; **actions pinned by full SHA with a version comment**; docs-only PRs excluded by an explicit `predicate-quantifier: every` filter with the reasoning in a comment |
| `lib/crewai/src/crewai/crew.py` | **yes, observed** | at this pin `:398-419` is `security_config` (fingerprinting), `checkpoint` (`CheckpointConfig`) and `tracing` — **not** the memory block an earlier note cited at those lines (see Corrections) |
| `docs/edge/en/concepts/tasks.mdx` | yes (`:307`) | `guardrail` / `guardrails` on a task — function or string description validating task output before the next task (`lib/crewai/src/crewai/task.py:261-270`, observed) |

**Not read, and why (the runbook requires this list):** the `docs/v1.15.*` release trees (48 dirs, 34,978 files —
deliberately not read: they are superseded APIs, and `docs/edge` + `docs/v1.15.32` cover current behaviour); the
`pt-BR`/`ko`/`ar` locale copies of every page (same content); `lib/crewai-tools` (85 md files — tools, not personas;
out of the operator's question); `lib/crewai-core/src/crewai_core/platform_catalog.py` (586 container-key hits — the
AMP platform app catalogue, enterprise-hosted, rejected as out of scope); `lib/crewai/tests/**` (fixtures, excluded by
the brief); the enterprise/AMP pages (`docs/edge/en/enterprise/*` — a hosted control plane we cannot run);
`docs/edge/en/observability/*` (third-party vendor pages); `crewai/rag/*` (knowledge, adjacent to memory, already
separated in D143).

## Do 5 · standards-and-policies pass (patterns in the tool's output, per standard)

The brief's Do 5 pattern (`OWASP|NIST|SP 800|CIS Benchmark|ISO 27001|ISO \d|SOC 2|EU AI Act|MITRE|ATF|ASIL|CWE|NVD|CVE-|responsible AI|AI safety|guardrail|threat model`) over the clone index found **2,746 matching files**; the
representative rows, with each one opened or named:

| standard / control the project maps to | stated coverage (cited) | call for durian-pi |
|---|---|---|
| **OWASP Top 10** | `docs/edge/en/mcp/security.mdx:149`: "Adhere to standard secure coding principles … (e.g., OWASP Top 10)" — **advertised advice to the reader, not a control set the framework implements**. No control-mapping table found in `docs/edge` (pattern above) | **reject the claim, adapt the artifact**: their security page is a checklist of *practices the agent must not skip*. We have no security runbook row for vendored/untrusted content — we do have the rule in `docs/COMPETITORS.md`, ungeneralized |
| **SOC 2 / HIPAA / GDPR** | only on third-party vendor pages (`docs/edge/en/observability/truefoundry.mdx:11`) — a vendor's claim, not CrewAI's control set | **reject** — no durian-pi counterpart; recording it would be decoration |
| **Dependency/vulnerability scanning as CI** | `.github/workflows/vulnerability-scan.yml` (observed): PR+push+weekly, action SHAs pinned, docs-only PRs skipped with the reason in a comment | **adapt** — we have no CI; the *shape* (a scheduled scan + docs-only exclusion + pinned action refs) maps onto a `check` rule / a nightly suite run. Registered with the review's ROADMAP block |
| **Task-output guardrails** | `docs/edge/en/concepts/tasks.mdx:307`, `lib/crewai/src/crewai/task.py:261-270` (observed): `guardrail` = function **or a string description** validating output; `tool_failure_policy="raise"` (`AGENTS.md:110`) | **adapt** — our `check` rules are static repo assertions; a per-claim verifier gate exists (the 189/seeded-bug work, ROADMAP 189) but has no "guardrail can be a plain-language criterion" tier. That tier is cheap and matches how our own runbooks phrase acceptance |
| **Eval gate that cannot be gamed** | `AGENTS.md:35-50`: `eval.jsonc` with criteria/assertions/disqualifiers and the rule "**Never loosen criteria to make a run pass**"; grades 1-5 per area; "after three rounds, change structure first" | **adopt** — this is a direct, citable statement of the rule our own suite has (D142's "publish the pattern with the count", the seeded-bug gate). It belongs in `docs/SELFDEV.md` as a borrowed rule with attribution |
| **Checkpointing / replay** | `lib/crewai/src/crewai/crew.py:402-410` (`checkpoint: CheckpointConfig | bool | None`, "True for defaults, False to opt out, None to inherit"); `crewai replay -t <task_id>` (`AGENTS.md:95`) | **adapt** — our audit trail (spool/compact-spool) records, it does not restore. "None = inherit, False = opt out" is the right three-state shape for any future rig checkpoint |

No NIST/CIS/ISO/EU-AI-Act mapping exists in this project's own docs at this pin (pattern above, 0 rows for those
tokens outside vendor pages) — recorded as a **zero with its pattern**, not as a shrug.

## Adoptable practices (Do 6 — each names the durian-pi mechanism it would change)

| # | practice (observed unless marked) | evidence path | durian-pi counterpart it would change | call |
|---|---|---|---|---|
| 1 | **Persona = named fields, not a blob**: `role` / `goal` / `backstory`, typed | `docs/edge/en/concepts/agents.mdx:41-43`; `templates/crew/config/agents.yaml:1-19` | `rig.selfdev.json` `s.instructions` (one string × 12 seats); `wip/seat-prompt-files` branch | **adopt** the triple as the minimum contract. Do not adopt the *file names* (D143) |
| 2 | **Three override slots** (`system_template`, `prompt_template`, `response_template`) so a seat overrides the scaffold without replacing the harness contract | `docs/edge/en/concepts/agents.mdx:57-59`; `utilities/prompts.py:69-77` | seat prompt editing today is all-or-nothing | **adopt** — gives "edit the persona, keep the protocol" which is exactly the operator's ask |
| 3 | **Prompt composed from named slices** (`role_playing` + tools variant + skill block + date block) with the scaffold text in a locale catalogue | `utilities/prompts.py:48-56, 99-105, 259-261`; `translations/en.json` | our seat prompt is one opaque string; runbook rules are injected by prose | **adapt** — slice names give a diff that *names* the part that changed, which is what hermes-agent's fixture guard polices (see its review) |
| 4 | **Parameterised personas** (`{topic}` filled from `kickoff(inputs=…)`), and the role re-resolved if interpolation changes it | `templates/crew/config/agents.yaml:3-5`; `agent/core.py:495-538` | seat prompts have no per-run inputs; our per-issue context is prose | **adapt** later — a `{...}` slot in a seat prompt must be validated *after* substitution, not before |
| 5 | **Model routing keyed by role name, with an overlay** and an explicit precedence ("the role's key wins over the model keys; with neither, declared") | `agent/core.py:247, 534-538` | `rig.selfdev.json` per-seat `model` (D140's cost/throughput ruling) | **adopt the precedence rule**, not the overlay machinery |
| 6 | **One shared instruction file + tiny per-harness adapters** (`CLAUDE.md`/`CURSOR.md`/`GEMINI.md` import `@AGENTS.md`, each saying why it exists) | `templates/CLAUDE.md:1-8`, `templates/CURSOR.md:1-6`, `templates/GEMINI.md:1-6` | `AGENTS.md` is hand-maintained for pi; seats have no shared file | **adopt** — this is the pattern for seat-level instructions across harnesses; one source, adapters say what they add |
| 7 | **Generated blocks inside a human file, marked** (`<!-- crewai-eval:start -->` twice) so a tool can rewrite its own block without clobbering prose | `templates/AGENTS.md:34,50,76,78` | `tools/vendor-pins.mjs` already uses BEGIN/END markers on `docs/VENDOR-PINS.md` (D144) | **adopt** — independent confirmation; extend it to `docs/NEXT.md`'s pin block and any generated seat contract |
| 8 | **"Facts models get wrong"** — a named section listing the API facts the agent's training data gets wrong, with the correction and where to check (`AGENTS.md:104-117`, plus the header rule "check the installed version … instead of your training data; if the docs and this file disagree, the docs win") | `templates/AGENTS.md:5-7, 104-117` | our `Do not:` pointer block and the `SELFDEV` pitfalls — which today carry *our* corrections, not a per-tool "your memory of this API is stale" section | **adopt** — this is the cheapest fix for the propagated-claim incidents (three measured false on 2026-10-28) |
| 9 | **Deprecated-options list inside the agent's own instructions** ("Deprecated agent options, don't add them: `reasoning`, `multimodal`, `allow_code_execution`, `function_calling_llm`") | `templates/AGENTS.md:111` | no equivalent guard against seats re-adding a removed rig option | **adopt** — a "do not add these" list per config surface, in the seat's file |
| 10 | **Definition-of-done and "what only the user can do" as sections of the persona file** (not of a separate runbook) | `templates/AGENTS.md:64-83` | `AGENTS.md` Non-negotiables + `NEXT.md` **Blocker:** (already ours); the split is that CrewAI puts it in the *seat's* file | **adopt** — our 12 seat prompts should each carry their own "definition of done" and "only the operator may" list |
| 11 | **Versioned schema key on declarative files** (`schema: crewai.flow/v1`) | `templates/declarative_flow/flow.yaml:1` | `rig.selfdev.json` has no schema version; `src/config.mjs` reads unversioned keys | **adopt** — one key, and it makes D103-class half-applied renames detectable |
| 12 | **Skills as versioned, resolvable packages** (`@org/handle@version`, resolve order local → user → download) | advertised: `docs/edge/en/concepts/skills.mdx:3`, `templates/AGENTS.md:114`; loader opened (`skills/loader.py:3`) but not fully walked | pi skills (`.agents/skills/*`), `docs/runbooks/competitor-review.md` pins | **adapt** — a pin table for skills (same shape as `docs/VENDOR-PINS.md`), no hosted registry |
| 13 | `code_execution_mode: "safe"` = Docker sandbox | `docs/edge/en/concepts/agents.mdx:62` | n/a | **reject** — conflicts with native-host-OS-only (D131); note it as a deliberate non-choice |
| 14 | AMP hosted control plane, repository agents, integrations catalogue | `templates/AGENTS.md:25-33`; `lib/crewai-core/src/crewai_core/platform_catalog.py` (not walked) | n/a | **reject** — hosted, org-scoped, and we run one local rig; would add a dependency we cannot verify |

## Coverage matrix — durian-pi against crewai's claimed control set

| capability they claim | durian-pi status | evidence |
|---|---|---|
| declarative persona file with typed fields | **lack** (inline JSON strings) | `rig.selfdev.json`; `wip/seat-prompt-files` unlanded |
| per-seat model choice | **have** | `rig.selfdev.json` per-seat `model`; `cli.mjs` config layering |
| prompt scaffold out of code, slice-named | **lack** | `utilities/prompts.py` comparison; ours is one string |
| skill packages with a resolution order | **have (partial)** — local `.agents/skills/`, no version pin | `docs/FEATURES.md` skills row |
| a coding-agent instruction file for other harnesses | **have** | `AGENTS.md`, `.agents/skills/*` |
| machine-verifiable definition of done | **have, stronger** | `node scripts/test.mjs --all` (238), seeded-bug gate, `check` rules |
| task-output guardrails incl. plain-language criteria | **lack** (static `check` rules only) | `src/checkup.mjs` rule set |
| run tracing / replay / checkpoint | **partial** — audit records, no restore | `docs/FEATURES.md` spool/compact-spool |
| memory with scopes and read-only slices | **lack** (deliberate: D143 keeps persona ≠ memory) | `docs/DECISIONS.md` D143 |
| dependency vulnerability scanning on a schedule | **lack** (no CI at all) | `.github/workflows/` absent in durian-pi |
| pinned CI refs | **not-applicable** until CI exists | — |
| Docker-sandboxed code execution | **not-applicable by rule** | D131 |

## Where it does not fit our constraints

CrewAI is a Python framework whose current story is a **hosted control plane** (AMP: tracing, evals, deploys, skill
registry). Our rig is a local sqlite+broker system on a single native OS, and our QA gate is a repo suite, not a
hosted judge. Take the **contracts** (the triple, the three slots, the slice names, the schema key, the adapter
pattern, the "facts you have wrong" section) and leave the platform. Second constraint: their default layout is
**JSONC, not YAML** — copying `agents.yaml` in 2026-10-28 copies their legacy form; the current contract is
`agents/*.jsonc` + `crew.jsonc` (`templates/AGENTS.md:95`).

## Recorded-decision check (no silent contradictions)

- **D143 (persona ≠ memory ≠ routing):** every adopt above touches persona only; routing adopt is the *precedence
  rule*, not an overlay store. Consistent.
- **D144 (generated + tracked beats prose):** #7 extends the same marker mechanism; no conflict.
- **D131 (native host OS only):** forces reject #13.
- **D140 (verifier choice is cost/throughput/context, not capability):** #5 adopts a precedence rule only, so no
  model-selection machinery is implied.

## Corrections this walk produced

The previous pointer (`docs/NEXT.md`, 2026-10-28T07:50Z block, now archived) cited "CrewAI loads memory config by
class name — `src/crewai/crew.py:400-419`". At this pin `lib/crewai/src/crewai/crew.py:398-419` is
`security_config` / `checkpoint` / `tracing`; memory at this pin is `crew.py:258-268` (`Memory | MemoryScope |
MemorySlice`, discriminated by `memory_kind`) and the class-name rooting statement lives in
`templates/AGENTS.md:112` ("Memory is rooted at the flow's class name"), which is **documentation**, not the code
they cited. The mechanism is real; the citation is not at this pin. Fixed here rather than propagated.

**Follow-up (Do 9):** `docs/reviews/crewai-followup-research-prompt.md` is not written — the open questions
(how their JSONC crew schema validates unknown keys; whether `llm_overlay` is user-visible config) are answerable by
opening two more files in this clone, so they belong to the next session's walk, not to the research agent.
