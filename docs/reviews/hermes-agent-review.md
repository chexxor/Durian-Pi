# hermes-agent (Nous Research) — competitor review (seat-persona / system-prompt surface)

**Why this project is in the set:** it is the only project in `vendor/eval/` that **treats the system prompt as a
tested artifact** — a committed snapshot of exactly what each surface sends, a CI test that fails when the snapshot is
stale, and a repository ruleset that requires a core-team approval to change that directory. It is also the only one
with a written **security model** (8 layers) and CWE-tagged code, which is what Do 5 exists to find.

## What it is (generated pin header — Do 2, from `node tools/vendor-pins.mjs --format header --project hermes-agent --tags`)

**Pinned HEAD:** `07f075c291bac85a3ae0746ffbb9730b26b0ddc1` (short `07f075c2`) · **commit date:** 2026-10-27T21:25:51-07:00 · **license:** MIT (read `vendor/eval/hermes-agent/LICENSE`; matched "Permission is hereby granted, free of charge") · **shallow clone:** true (a re-review needs `git fetch --unshallow origin` in place — do not delete the clone) · **latest remote tag:** `v2026.9.24` (highest of 64 version-like tag(s); 157 non-version tag(s) skipped (e.g. abandoned-rc.1-v0.21.6, abandoned-rc.1-v0.21.7) — `git -C vendor/eval/hermes-agent ls-remote --tags origin`) · **maturity:** _see below_ · **operator's question:** _how do we define seat system prompts so they are easy to edit before the rig starts, and which existing standard should we reuse?_

**Manifest versions (UNRELIABLE — cite the tag and the commit date, never these):** package.json "1.0.0" (name "hermes-agent"); pyproject.toml "0.0.0" (name "hermes-agent")
**Reproduce every field above with:**
```bash
git -C vendor/eval/hermes-agent rev-parse HEAD
git -C vendor/eval/hermes-agent log -1 --format=%cI
git -C vendor/eval/hermes-agent rev-parse --is-shallow-repository
cat vendor/eval/hermes-agent/LICENSE  # licence signature
git -C vendor/eval/hermes-agent ls-remote --tags origin   # tag
```

**Maturity judgement.** Very active — HEAD is one day before this review, and the release scheme is date-based
(`v2026.9.24`), with 64 version-like tags and **157 non-version tags the tool skipped** (abandoned release
candidates). The manifest contradiction is live: `package.json` says `1.0.0` and `pyproject.toml` says `0.0.0` for the
same package name — a version number that must not be read as maturity. The real maturity signal is the machinery:
a snapshot CI gate, a ruleset-protected directory, and a security model written down. That is a project further along
than its own version fields suggest. MIT → borrowable with attribution.

## Do 4 · surface inventory (walked with `node tools/competitor-brief.mjs --project hermes-agent`; 21,752 tracked files, 1,647 md files across 97 doc areas, 0.9 s)

| surface | opened? | what it yielded |
|---|---|---|
| `agent/system_prompt.py` (docstring, `:1-10`) | **yes, observed** | the system prompt is built **once per session and reused across turns** so the upstream prefix cache stays warm; **three tiers joined with `\n\n`**: `stable` (identity, guidance, env hints, coding brief, platform hints), `context` (workspace snapshot, caller `system_message`, context files), `volatile` (skills index, memory, `USER.md`, external memory provider, timestamp). It points at `references/system-prompt-invariant.md` — **that file is not in the clone** (`git ls-files \| grep -i system-prompt-invariant` → empty): a dangling design-doc reference at this pin |
| `scripts/ci/prompt_surface.py` | **yes, observed** | renders the model-facing surface **through production code** into `tests/fixtures/prompt_surface/`: system prompt + `tools[]`. Determinism is explicit: a throwaway `HERMES_HOME` with stock config, bundled skills synced, and **clock, host OS, network, tool availability and machine paths pinned** (`FIXED_NOW = 2026-01-15T12:00:00Z`, `SESSION_ID` derived from it, `:63-65`). The surface matrix is `(surface, platform, model family, cwd-is-code-workspace)` × 9 rows over 4 model families (`:45-62`) because "model names gate guidance blocks and the patch dialect" |
| `tests/ci/test_prompt_surface.py` | **yes, observed (1-55)** | `test_committed_prompt_surface_is_current`: re-renders and diffs the whole tree, and the failure message lists `stale:` / `not committed:` / `only in committed:` paths **plus the regenerate command**; docstring states the merge rule ("the snapshot path needs a hermes-agent-core approval"). `test_summary_names_the_surface_and_tool_that_changed`: mutates one prompt line and one tool description and asserts the summary **names the surface and the tool** — a test of the guard's *explanation quality* |
| `tests/fixtures/prompt_surface/surfaces.json` | **yes, observed** | per surface: `prompt_tokens` split `{context, stable, volatile}` (`cli-code.claude` = 134 / 1829 / 1528) + `tool_tokens` (11,242) + the tool list. A **token budget per tier**, per surface |
| `tests/fixtures/prompt_surface/prompts/*.txt`, `tools/*.json` | listed, `cli.claude`/`cli-code.claude` names observed | the snapshot is per (surface × model family), with model-specific variants (`patch.cli.gpt.json`, `tool_search.desktop.claude.json`) |
| `website/docs/user-guide/security.md` | **yes, observed (`:1-26`)** | "the security model has eight layers": user authorization; dangerous-command approval; file-write safety (denylist + optional sandbox); container isolation; MCP credential filtering; **context-file scanning for prompt injection in project files**; cross-session isolation with path-traversal-hardened cron paths; input sanitization of cwd args against an allowlist |
| CWE/standards tags in code | **yes, observed** | `gateway/session.py:610` (CWE-22, session id becomes a filename), `gateway/slash_commands_session.py:364` (CWE-639, caller not proven by `user_id` alone), `cron/scheduler.py:2472` ("Runtime backstop (CWE-200/522): fail closed BEFORE resolution"), `hermes_cli/service_manager.py:518` (CWE-59/CWE-367 symlink swap race), `gateway/pairing.py:4` ("Security properties (OWASP + NIST SP …)") |
| `agent/system_prompt.py:317-327` | **yes, observed** | "pinned skills are **operator guidance for the user's session, not payload for every internal fork**" — skills are excluded for delegate children, curator/review forks and gateway-hygiene agents; config/skill files read on the first build only "so the prompt stays byte-stable" |
| `website/docs/user-guide/features/skills.md`, `website/sidebars.ts` | advertised (description lines + brief rows) | "on-demand knowledge documents — progressive disclosure, agent-managed skills"; `skills/` + `optional-skills/` trees (creative 147+211 md, mlops 134, security 31) |
| `website/docusaurus.config.ts`, `website/sidebars.ts` | named by the brief's nav walk | the maintainers' order for the docs site; used to choose which doc tree to open rather than grepping |

**Not read, and why:** `website/i18n/**` (290 md — translated copies of the same pages; the brief collapses them);
`skills/creative`, `optional-skills/creative`, `optional-skills/mlops` except `obliteratus` (211+147+134 md —
domain skills, not the persona surface; one representative opened); `gateway/**` platform adapters (Telegram/Discord/
Signal integrations — out of the operator's question; their CWE tags were read where the grep surfaced them);
`evals/**` result summaries (`evals/core_tool_deferral/results/SUMMARY.md`, `evals/readtool/…` — relevant to our
verifier-family question (ROADMAP 189), flagged there rather than read here); `agent/conversation_compression.py`,
`agent/turn_recovery.py` (the 54- and 27-hit tier-A files — compression/turn-recovery internals, adjacent to the tier
model but not the persona contract); `.github/workflows/prompt-surface-diff.yml` (named in the generator docstring;
the workflow itself not opened — the mechanism is already established from the two Python files).

## Do 5 · standards-and-policies pass

The Do 5 pattern is now acronym-word-bounded (see the tool's comment: bare `ATF` matched inside **PLAT**`ATF`**ORM** —
36 lines of `MY_PLATFORM_*` in one hermes doc; measured 2026-10-28). With the corrected pattern, 120 files match; the
representatives opened, with what each actually claims:

| standard / control | cited (opened unless marked) | call for durian-pi |
|---|---|---|
| **CWE ids as inline review anchors** | `gateway/session.py:610`, `gateway/slash_commands_session.py:364`, `cron/scheduler.py:2472`, `hermes_cli/service_manager.py:518` — each names the weakness class **and the mitigation stance** ("fail closed BEFORE resolution") | **adopt** — one line of provenance per safety-relevant branch. Our analogue: cite the incident/decision id where a guard exists (we already do this in prose — `docs/incidents/…`, `D107` — but not in the code comment) |
| **OWASP Top 10 (2021) mapping table** inside a skill's reference doc | `optional-skills/security/web-pentest/references/vuln-taxonomy.md:66-70` (slot/context coverage table); `…/templates/pentest-report.md:43` adapts the OWASP Testing Guide | **adapt** — not the pentest content: the *shape* "a mapping table that says what is covered **and what is not**". Our version is a check-rule → incident/decision coverage table (ROADMAP 81/82) |
| **OWASP + NIST SP 800-** cited as the basis for a pairing protocol's security properties | `gateway/pairing.py:4` | **reject the specific** (we have no pairing protocol); **adopt the habit** of naming the basis next to the mechanism |
| **A written multi-layer security model as a user-facing doc** | `website/docs/user-guide/security.md:11-24` (8 layers) | **adopt** — we have `AGENTS.md` Non-negotiables and scattered runbooks; no single "here is every security boundary and its enforcement". The 6th layer (**context-file scanning for prompt injection**) is the one our vendored-eval rule is a special case of |
| **Dangerous-command approval list + fail-closed defaults** | `security.md` §"Dangerous Command Approval" (advertised at doc level; implementation not opened) | **adapt** — mark it half-verified; our `check` rules are repo-level, and our broker has approval-free `send`. Flag for the operator as a priority question, not adopt silently |
| **Dual-use skills: jailbreak / red-team / refusal-removal** | `optional-skills/security/godmode/SKILL.md` (33 pattern hits), `optional-skills/mlops/obliteratus/` (model-refusal research, 5+ hits, `references/analysis-modules.md` opened partially) | **reject for the rig, and record the governance question** — shipping operator-installable dual-use skills inside the same tree as benign skills, with no separate gate, is a policy choice durian-pi should make deliberately, not inherit |
| **Container isolation as the sandbox layer** | `security.md` layer 4 (Docker/Modal/Singularity) | **reject** — native-host-OS-only (D131). Note as a deliberate non-choice |

**Zero with its pattern, for the record:** no `ISO 27001`, `CIS Benchmark`, `EU AI Act` or `SOC 2` claim anywhere in
this clone's own docs (pattern above; the SOC-2-shaped hits were third-party pages in other clones).

## Adoptable practices

| # | practice | evidence path | durian-pi mechanism it would change | call |
|---|---|---|---|---|
| 1 | **A committed snapshot of the rendered prompt + tool schemas, per (surface × model family)**, regenerated through production code and gated by a test that lists the stale paths and the regenerate command | `scripts/ci/prompt_surface.py:1-24, 45-66`; `tests/ci/test_prompt_surface.py:1-42` | seat prompts are inline JSON strings (`rig.selfdev.json`) with **no artifact showing what a seat actually sends**; the parked `wip/seat-prompt-files` branch claims byte-identity by hand-check (12/12) | **adopt — the single most important item in this review.** A `demo/seat-prompt-surface.test.mjs` + committed `tests/fixtures/seat_surface/*.txt` would make every seat-prompt edit a reviewable diff of real prompt text, and would let the `wip/seat-prompt-files` branch be verified instead of trusted |
| 2 | **Determinism recipe** for such a snapshot: throwaway config dir, pinned clock, pinned host OS, pinned tool availability/paths, derived session id | `scripts/ci/prompt_surface.py:16-19, 63-66` | our suite's time/OS dependence (the `run-your-area` suite-env demo; D-something's serial fallback on Windows) | **adopt** — this is how a prompt snapshot avoids flaking, and it names *host OS* as a pinned input, which matches our "name the OS in every measurement" rule |
| 3 | **A test that checks the failure summary names the changed surface and tool** | `tests/ci/test_prompt_surface.py:46-55` | our seeded-bug gate checks that a guard fails; nothing checks that its message is *useful* | **adopt** — cheap, and it is the same discipline as D142 ("publish the pattern with the count") |
| 4 | **Three prompt tiers with token accounting per tier, per surface** (`context`/`stable`/`volatile`; 134/1829/1528 + 11,242 tool tokens) | `agent/system_prompt.py:4-8`; `surfaces.json` head | seat prompts have no structure and no cost view; ROADMAP 140 (context size) and 189 (verifier context) are decided blind | **adopt the accounting, adapt the tiers** — a per-seat token split is the input our cost/throughput ruling needs |
| 5 | **Byte-stability is a stated goal for cache warmth** (prompt built once/session; skills resolved on first build only; "byte-stable across model switches, compression and static-prefix restoration") | `agent/system_prompt.py:3-4, 319-321` | our seats re-read config at start; no stated stability contract | **adapt** — a cheap win: if the persona prefix never moves, provider prefix caching works and cost drops |
| 6 | **Sub-agent surfaces are deliberately narrower**: "pinned skills are operator guidance for the user's session, **not payload for every internal fork**" | `agent/system_prompt.py:322-324` | how a durian-pi seat's instructions propagate to a subagent/fork is undefined | **adopt** — answers a question our persona design has not asked yet: operator guidance ≠ subagent payload |
| 7 | **A design-invariant doc named from the code** (the docstring cites `references/system-prompt-invariant.md`) | `agent/system_prompt.py:8`; the file is **absent at this pin** | our invariants live in `docs/DECISIONS.md` prose; code cites nothing | **adopt the pattern, and let our guard catch it** — a cited-but-missing artifact is exactly what `check` should fail (ROADMAP 137/202). We get a negative control for free from this clone |
| 8 | **Approval-gated directory** for the prompt snapshot (repo ruleset requires core approval) | `tests/ci/test_prompt_surface.py` docstring + `scripts/ci/prompt_surface.py:11-12` | no path-level authority model in our repo (git hooks exist: `src/git-hooks`, D67) | **adapt** — a hook that warns/blocks when `rig.selfdev.json` seat prompts or `docs/NEXT.md` change without the tracked artifact updating |
| 9 | **Model-family-conditioned guidance and tool dialect, enumerated as a matrix you can see** (9 surfaces × 4 families, model-specific snapshot variants) | `scripts/ci/prompt_surface.py:45-62`; `tools/patch.cli.gpt.json` | seats pick a model but the persona is model-agnostic prose | **adapt later** — the matrix is the honest way to make "this seat runs a small local model" a first-class fact (D140) |
| 10 | **Security model as one doc, with every boundary named and its enforcement named** | `website/docs/user-guide/security.md:11-24` | scattered: `AGENTS.md` non-negotiables, runbooks, vendored-content rule | **adapt** — a `docs/SECURITY_MODEL.md`-shaped inventory; keep it short and cite the enforcement path per boundary |
| 11 | Dual-use skill trees shipped ungated | `optional-skills/security/godmode/SKILL.md`; `optional-skills/mlops/obliteratus/` | n/a | **reject**, and raise the governance question to the operator |
| 12 | Docker/Modal sandboxing | `security.md` layer 4 | n/a | **reject** (D131) |

## Coverage matrix — durian-pi against what hermes-agent claims

| capability they claim | durian-pi status | evidence |
|---|---|---|
| committed, CI-gated prompt/tool-surface snapshot | **lack** | nothing in `demo/` renders a seat prompt; `wip/seat-prompt-files` unverified |
| a guard that proves its own message names the change | **lack** (we check failure, not explanation) | `demo/` seeded-bug work |
| tiered prompt assembly with per-tier token accounting | **lack** | `rig.selfdev.json` inline strings |
| prompt byte-stability contract for cache warmth | **lack** | — |
| narrower prompt for sub-agents/forks | **lack (undefined)** | — |
| dangerous-command approval | **partial** — human grants for push/worktree by convention | `AGENTS.md` non-negotiables |
| prompt-injection/context-file scanning | **lack** (rule in prose for vendored content only) | `docs/COMPETITORS.md` |
| per-boundary security model doc | **partial** (runbooks + non-negotiables) | `docs/runbooks/README.md` |
| path-level merge authority for sensitive files | **partial** — `src/git-hooks` exists, no path ruleset | D67 |
| skills with progressive disclosure, agent-managed | **have** | `.agents/skills/*`, pi skills |
| multi-platform (telegram/discord/desktop) surfaces | **not-applicable** | our surfaces are CLI/TUI |

## Where it does not fit our constraints

It is a large multi-surface product (CLI, desktop, Telegram, Discord, cron, gateway) whose security layer assumes
container sandboxing and whose model routing assumes hosted providers. Our rig is one local orchestrator over pi with
a sqlite queue, so we should copy **the snapshot discipline and the tier/token accounting**, not the platform
machinery. Second: their snapshot spans a 9-surface × 4-family matrix — at 12 seats and 1 harness we need a much
smaller matrix, and the value is the same. Third: dual-use skill shipping is a policy we should not inherit by
accident.

## Recorded-decision check

- **D143 (persona ≠ memory ≠ routing):** adopt #4's `volatile` tier *contains* memory — we would adopt the
  accounting, not the mixing. Our seat file must not become a memory container.
- **D144 (generated + tracked beats prose):** adopt #1 is precisely that idea applied to prompts.
- **D142 (counts with patterns):** the ATF false-positive is a direct instance; the fix is recorded in the tool.
- **D131 (native host OS only):** reject #12; note that adopt #2 pins host OS as a *test input*, which is ours already.
- **D140 (verifier choice = cost/throughput/context):** adopt #4 feeds that ruling numbers it currently lacks.

**Follow-up (Do 9):** two questions are answerable inside this clone and belong to the next walk — open
`.github/workflows/prompt-surface-diff.yml` (how the PR summary is formatted) and the `dangerous command` pattern
list's implementation. No research-agent prompt needed. One question is for the **operator**: does durian-pi want a
path-level approval gate on seat-prompt changes (adopt #8), since that shifts authority, not just tooling.
