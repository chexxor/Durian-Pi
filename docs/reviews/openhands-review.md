# openhands (Agent Canvas) — competitor review (seat-persona / system-prompt surface)

**Why this project is in the set:** the pinned clone is **Agent Canvas** (root `package.json` = `@openhands/agent-canvas`),
OpenHands' product surface, and it is the only project in the set that ships a **user-editable persona model with three
explicit modes** plus a **named agent-profile library** — the closest existing answer to "12 seats whose prompts should
be easy to edit before the rig starts". It also has a live security-governance integration (Do 5), and it lists **Pi** as
a hostable external agent, which makes it directly adjacent to durian-pi rather than merely comparable.

## What it is (generated pin header — Do 2, from `node tools/vendor-pins.mjs --format header --project openhands --tags`)

**Pinned HEAD:** `6354932e3d7f42c22687ad89f62bfb693b0d75e5` (short `6354932e`) · **commit date:** 2026-10-28T07:41:00Z · **license:** MIT (read `vendor/eval/openhands/LICENSE`; matched "Permission is hereby granted, free of charge") · **shallow clone:** true (a re-review needs `git fetch --unshallow origin` in place — do not delete the clone) · **latest remote tag:** `v1.34.0` (highest of 341 version-like tag(s); 259 non-version tag(s) skipped (e.g. master, nightly, next) — `git -C vendor/eval/openhands ls-remote --tags origin`) · **maturity:** _see below_ · **operator's question:** _how do we define seat system prompts so they are easy to edit before the rig starts, and which existing standard should we reuse?_

**Manifest versions (UNRELIABLE — cite the tag and the commit date, never these):** package.json "1.34.0" (name "@openhands/agent-canvas")
**Reproduce every field above with:**
```bash
git -C vendor/eval/openhands rev-parse HEAD
git -C vendor/eval/openhands log -1 --format=%cI
git -C vendor/eval/openhands rev-parse --is-shallow-repository
cat vendor/eval/openhands/LICENSE  # licence signature
git -C vendor/eval/openhands ls-remote --tags origin   # tag
```

**Maturity judgement.** Extremely active (HEAD same day as this review), 341 version-like tags and 259 non-version tags
(`master`, `nightly`, `next` — which is exactly why `ls-remote --tags | tail -1` lies; it printed `nightly` here). The
name trap is real and mine: the root manifest says `1.34.0` for `@openhands/agent-canvas`, so a reader who takes the
manifest as "the release" is reading the **sub-package** version; `v1.34.0` is also the highest tag, so the two agree
today by coincidence, not by contract. Treat this clone as **one product surface of a larger system** — the agent
runtime it drives lives in another repo (`OpenHands/software-agent-sdk`, cited in `docs/DefenseClaw.md:3`), which means
several behaviours here are **`advertised`** (UI over a server API) rather than observable in-tree.

## Do 4 · surface inventory (walked with `node tools/competitor-brief.mjs --project openhands`; 84 md files, 176 surface-named paths, README links walked in document order)

| surface | opened? | what it yielded |
|---|---|---|
| `README.md` → `docs/README.md`, `docs/architecture.md`, `AGENTS.md`, `README.windows.md` | README + link graph walked via the brief (dead links dropped) | the maintainers' order: self-hosting, **windows README** (a first-class Windows path — relevant to D131), AGENTS.md, docs index, architecture, development |
| `src/routes/agent-settings.tsx` | **yes, observed** | the persona contract: `PERSONA_KEY = "persona"` (`:113`); **`systemPromptMode: "standard" \| "append" \| "custom"`** (`:227`); write rule `fields.system_message_suffix = mode === "append" ? text : null; fields.persona = mode === "custom" ? text : null` (`:316-317`); precedence stated in code: **"A stored persona wins over stored instructions; the editor models one choice."** (`:147`); dirty-state checks treat non-`standard` modes explicitly (`:938-944`) |
| `.agents/skills/verify-openhands/references/feature-map/F13-agent-profiles.md` | **yes, observed (`:1-20`)** | **named agent profiles**: each is either an OpenHands agent (LLM profile, a system prompt, Model Router, tool set, parallel tool calls, MCP-server and secret scopes, condenser, verification, skills) or an **ACP external agent preset — "Claude Code, Codex, Gemini CLI, `Pi` or OpenCode"** with its launch command and "a model the agent itself reports". One profile active; the seeded `default` cannot be renamed/deleted and is the template new profiles copy; every claim carries a `Source:` list of implementation paths and sub-feature ids (`F13.list`, `F13.create`) |
| `.agents/skills/verify-openhands/SKILL.md` | **yes, observed (`:1-24`)** | front matter `name`, multi-line `description` with **quoted trigger phrases**, and a `triggers:` list (`/verify-openhands`, `feature map`, `verify feature`). Its rule: "Prove what a user sees, not that a route rendered or CI passed" — an isolated real stack, one browser kept alive, every user step a rerunnable command; a "daily pass" and "weekly feature audit" |
| `.agents/skills/**` (152 files; `references/feature-map/F18-skills.md`, `F19-plugins.md`, `references/backfills/2026-10-16-main-refresh.md`) | F13 + SKILL observed; F18/F19 named, not opened | a **maintained feature map of every user-facing feature**, ids + source paths + dated backfill notes, kept current by the skill itself |
| `src/utils/skill-scope.ts` | **yes, observed (`:1-14`)** | `SkillScope = "project" \| "personal" \| "public"` with `SKILL_SCOPE_ORDER`; and a legacy-rename guard: `.openhands/microagents/` is the **pre-rename skills directory**, kept as a marker because "dropping it would silently misfile legacy skills as 'public'" |
| `src/utils/skill-enablement.ts` | **yes, observed (`:1-10`)** | skill names come from a **catalog constant** (`SKILLS_CATALOG` from `@openhands/extensions`) in "catalog order" — enablement is a declared catalog, not a directory scan |
| `src/api/skills-service.ts`, `src/api/cloud/skills-service.api.ts`, `src/api/agent-server-adapter.ts` | listed by the brief (37-39 hits); not opened | skills are served by a remote/local **agent server**, so file-level behaviour here is a client of an API (→ `advertised`) |
| `docs/DefenseClaw.md` | **yes, observed (`:1-18`)** | integration with **DefenseClaw** (`cisco-ai-defense`): "a security governance layer for agentic AI runtimes — it scans skills and MCP servers before they run, inspects LLM traffic at runtime, and produces durable audit evidence", via a **Guardrail Proxy** (`:4000`) and a **Gateway Sidecar** (`:18970`), integrated **without code changes** to either project; its `Status:` block says it is purpose-built around a different runtime and names the overlap points, with a "Future work (code-level extensions)" section |
| `docs/`, `.github/`, `helm/agent-canvas/`, `examples/acp-docker` | inventory only | 8 md in `docs/` (index, architecture, self-hosting, development, DefenseClaw), a helm chart, a docker ACP example |

**Not read, and why:** `src/i18n/translation.json` (15 standards hits — a 34k-line locale catalog; the persona strings
were read where the grep pointed, `:34779` "Custom persona"); `__tests__/**` (52+ files — the tests are strong evidence
of the contracts and were read only where the brief surfaced them, `build-agent-profile-fields.test.ts:21`);
`website/**` (none in this clone); `src/components/features/skills/*` beyond the scope/enablement utils (UI plumbing);
the feature-map pages F18/F19 (representative-artifact rule satisfied by F13 + the skill's own SKILL.md);
`helm/`, `examples/acp-docker` (deployment, out of the persona question).

## Do 5 · standards-and-policies pass

Pattern is the word-bounded one (`\bOWASP\b|\bNIST\b|…|jailbreak|prompt injection`; see the tool's comment about
`ATF` ⊂ `PLATFORM`). Only **4 files** match in this clone — an honest small set:

| standard / control | cited (opened) | call for durian-pi |
|---|---|---|
| **Skill/MCP pre-run scanning + runtime LLM inspection + durable audit evidence** (DefenseClaw, an external governance layer) | `docs/DefenseClaw.md:3, 5, 9-18` | **adapt the control, not the vendor** — "scan a skill/MCP server before it runs" is a `check`-shaped control we do not have for `.agents/skills/` or MCP config; the *proxy* architecture is ours to reject (no proxy in a local rig), the *gate* is adoptable |
| **Integration documented as "no code changes to either project"**, with an explicit `Status:` block naming what the tool was built for and a separate "Future work (code-level extensions)" section | `docs/DefenseClaw.md:5` | **adopt the documentation discipline** — state fit and non-fit at the top of any borrowed mechanism; this is the opposite of the "quiet copy" this runbook warns about |
| **Verification through the real app, with evidence** (daily pass / weekly feature audit) | `.agents/skills/verify-openhands/SKILL.md:11-24` | **adopt the principle, adapt the scale** — durian-pi's QA is a repo suite + a seeded-bug gate; a "prove what the operator sees" pass over the TUI/broker is the missing tier (ROADMAP 189's verifier family wants exactly this corpus) |
| **A maintained feature map with ids + source paths** as the QA corpus | `references/feature-map/F13-agent-profiles.md` (`Source:` list, `F13.*` ids) | **adopt** — durian-pi's `docs/FEATURES.md` has rows and a drift test (`feature-row`, `features-drift`); their per-feature **id + source citation + sub-feature enumeration** is richer and is what a check rule can actually key on |
| No OWASP/NIST/ISO/CIS/SOC2/EU-AI-Act claim in this clone's own docs | 4 files matched, none asserting a framework mapping | recorded as a **zero with its pattern** |

## Adoptable practices

| # | practice | evidence path | durian-pi mechanism it would change | call |
|---|---|---|---|---|
| 1 | **Three persona modes — `standard` / `append` / `custom`** — stored in **different fields** (`persona` vs `system_message_suffix`), never both | `src/routes/agent-settings.tsx:227, 316-317` | seat prompt editing today is all-or-nothing (`rig.selfdev.json` `s.instructions`) | **adopt.** This is the shortest answer to the operator's ask: a seat can *add* guidance without owning the harness contract, and the mode is a named field a check rule can assert on |
| 2 | **Explicit precedence, written where it is enforced**: "A stored persona wins over stored instructions; the editor models one choice." | `agent-settings.tsx:147` | our config layering is implicit (`src/config.mjs`, `DURIG_*` vs `DURIAN_PI_*` D103) | **adopt** — one sentence in the code that enforces it, plus a test |
| 3 | **A named profile library with a protected seeded `default` that is also the template** | `feature-map/F13-agent-profiles.md:1-20` | `rig.selfdev.json` seats are ad-hoc; no "new seat copies X" contract | **adopt** — `default` seat + copy-on-create + non-deletable seed is the smallest thing that makes 12 seats manageable |
| 4 | **A profile = persona + LLM + tools + scopes + skills in one bundle; an external-agent preset is a first-class profile kind** | `F13-agent-profiles.md:3-8` | seats today: model + instructions only; subagents not modelled | **adopt the bundle shape**, and note that **`Pi` is one of their ACP presets** — durian-pi's harness is a hostable agent elsewhere, which is a positioning fact for the operator, not a feature to copy |
| 5 | **Skill scopes with an order (`project` > `personal` > `public`) and a legacy-path marker** so a rename does not silently misfile | `src/utils/skill-scope.ts:3-14` | our `.agents/skills/` has no scope model; D103 is exactly this bug class for env keys | **adopt the marker discipline** — keep the old name *visible* in the mapping, don't just switch the constant |
| 6 | **Enablement from a declared catalog in a stated order**, not from a directory scan | `src/utils/skill-enablement.ts:1-10` | skill availability here is filesystem order | **adapt** — a catalog makes "which skills does a seat get" reviewable and diffable |
| 7 | **Skill front matter with `triggers:` tokens** in addition to a quoted-phrase description | `.agents/skills/verify-openhands/SKILL.md:3-13` | `.agents/skills/*/SKILL.md` (ours) carry descriptions only | **adopt** — matches pi's skill discovery better than prose guessing |
| 8 | **A feature map keyed by ids, with `Source:` paths and sub-feature ids, maintained by a skill** | `verify-openhands/SKILL.md:1-24`; `feature-map/F13-agent-profiles.md` | `docs/FEATURES.md` rows + `demo/feature-row.test.mjs` | **adopt the id + source-citation shape** — it gives `check` rules something to key on beyond a name match |
| 9 | **QA = driving the real app with rerunnable commands + evidence, on a cadence** | `verify-openhands/SKILL.md:11-24` | `node scripts/test.mjs --all` (repo-level), no end-to-end tier | **adopt as a roadmap item, not a today change** — needs the broker up (blocked: no Linux launcher) |
| 10 | **A `Status:` block that states fit and non-fit of an integration up front** | `docs/DefenseClaw.md:5` | our reviews should adopt this heading shape; several of ours bury it | **adopt (documentation discipline)** |
| 11 | Guardrail **proxy** sidecar in front of the LLM | `docs/DefenseClaw.md:9-18` | n/a | **reject the architecture** (adds a network hop and a second runtime to a local rig); keep the *gate* idea |
| 12 | Docker-based isolated stack for the verification skill | `verify-openhands/SKILL.md` (`control-openhands` launches an isolated stack); `examples/acp-docker` | n/a | **reject the mechanism** (D131 native-host-OS-only); keep "isolated, rerunnable, evidence-producing" as the requirement |

## Coverage matrix — durian-pi against what Agent Canvas claims

| capability they claim | durian-pi status | evidence |
|---|---|---|
| persona mode choice (standard / append / custom) with field separation | **lack** | `rig.selfdev.json` |
| named seat/profile library with a protected default | **lack** (12 ad-hoc seats) | `rig.selfdev.json`, `docs/SELFDEV.md` |
| skill scoping (project/personal/public) + rename-safe mapping | **partial** — one dir, no scope; rename hazard live (D103) | `.agents/skills/`, `src/config.mjs` |
| declared skill catalog with order | **lack** | — |
| skill front-matter triggers | **partial** (description only) | `.agents/skills/*/SKILL.md` |
| end-to-end QA through the real app on a cadence | **lack** (repo suite only) | `scripts/test.mjs`; broker not running on this box |
| feature map with ids + source citations | **partial** (`docs/FEATURES.md` rows + drift tests) | `demo/feature-row.test.mjs`, `demo/features-drift.test.mjs` |
| skill/MCP pre-run security scanning | **lack** | — |
| durable audit evidence of LLM traffic | **partial** (spool/audit records, no LLM-traffic capture) | `docs/FEATURES.md` |
| hosting an external agent (incl. **Pi**) as a profile | **not-applicable / inverted** — we drive pi as the harness | `src/seatguard.mjs` |
| multi-user cloud + helm deployment | **not-applicable** | local sqlite rig |

## Where it does not fit our constraints

It is a browser product over an agent-server API with cloud/helm deployment; the persona is edited by a *human in a UI*,
which is a different editing model from a seat file a delegate edits in git. Several mechanisms here are **client-side
views of a remote runtime** (`skills-service`, `agent-server-adapter`), so their in-tree behaviour is `advertised`, not
`observed` — I did not treat them as implementations. The verification skill assumes Docker and a browser; both are
outside our rules (D131) even though the *pattern* is what we want.

## Recorded-decision check

- **D143 (persona ≠ memory ≠ routing):** adopt #1/#3 keep the persona bundle free of memory contents; their profile
  bundle includes LLM + tools + scopes, which is routing/config, not memory. Consistent — but #3 must not grow into a
  memory container; flag it in the ROADMAP wording.
- **D103 (half-applied renames):** adopt #5 is a direct counter-measure borrowed from their legacy-marker comment.
- **D131:** reject #12.
- **D140:** their "a model the agent itself reports" for external agents is a data point for the verifier ruling —
  self-reported model ≠ verified model; do not adopt without a check.
- **D144:** adopts #8/#10 are the generated/cited-artifact discipline again.

**Follow-up (Do 9):** open `src/routes/agent-profiles-settings.tsx` and
`src/api/agent-profiles-service/profile-field-support.ts` next walk — they define *which fields a profile may carry*,
which is the exact field list we need before choosing our seat-file schema. That is inside this clone, so no
research-agent prompt. One operator question: whether durian-pi wants scope-tiered skills (project/personal/rig) at all.
