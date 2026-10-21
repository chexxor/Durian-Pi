I'll research this properly — there's a concrete ecosystem around agent "skills" (the SKILL.md format), plus a body of research on which agent techniques actually work. Let me pull both.Now let me pull the substance from the key sources: Anthropic's authoring guide and the main academic surveys/studies.Let me round out the industry side — the leading published skill collections and the SkillsBench evidence — before synthesizing.Yes — and there's now a real evidence base to build on, not just vibes. Here's a synthesis of what the research says makes skills work, which skill *types* are empirically effective, and a concrete starter library you can drop into a harness.

---

## 1. What the evidence actually shows

The key finding: **curated skills help a lot, but inconsistently — and *how* you write them matters more than *how many* you have.**

| Study | Finding |
|---|---|
| **SkillsBench** (86 tasks, 11 domains, 7,308 trajectories) | Curated skills raised mean pass rate **+16.2 pp** (24.3% → 40.6%). The v1.1 release reports **+16.6 pp** (33.9% → 50.5%) [^4] [^6] |
| Same | **Self-generated skills gave no benefit** (−1.3 pp vs. no skills) — models can't yet reliably author the procedural knowledge they benefit from consuming [^4] |
| Same | **Focused** skills (2–3 modules) → +18.6 pp; **4+ skills** → only +5.9 pp. "Detailed" skills → +18.8 pp; "comprehensive" (exhaustive docs) → **−2.9 pp** [^4] |
| Same | **Skills as compute equalizers**: Claude Haiku 4.5 *with* skills (27.7%) beat Claude Opus 4.5 *without* (22.0%) [^4] |
| Same | **16 of 84 tasks had negative deltas** with skills — worst −39.3 pp, where the base model was already strong and skills introduced conflicting guidance [^4] |
| **SAGE** (RL skill library) | +8.9 pp scenario goal completion over GRPO, with **26% fewer steps and 59% fewer tokens** [^3] |
| **SEAgent** (autonomous discovery) | OSWorld success **11.3% → 34.5%** [^3] |
| **CUA-Skill** (structured execution graphs) | 57.5% SOTA on WindowsAgentArena [^3] |
| **Skill-library scaling** (Li 2026) | Multi-agent systems can be "compiled" into single-agent skill libraries — but beyond a **critical library size, skill-selection accuracy degrades sharply** [^3] |

**Domain variance is the headline:** skills help most where the base model lacks procedural grounding. SkillsBench showed healthcare **+51.9 pp**, manufacturing **+41.9 pp**, cybersecurity **+23.2 pp**, but software engineering only **+4.5 pp** and mathematics **+6.0 pp** [^4]. So a good collection is *front-loaded toward knowledge-poor domains*, not generic coding helpers.

---

## 2. Design rules that make a skill "well-written"

These are consistent across Anthropic's authoring guide [^1], the academic surveys [^3] [^4], and the empirical failure study [^2].

**Structure & progressive disclosure**
- `SKILL.md` = a table of contents + quick start, **not** a manual. Keep the body **under 500 lines** [^1].
- Three-level progressive disclosure: metadata preloaded (~dozens of tokens) → body on trigger → scripts/references on demand [^3].
- **Keep references one level deep** — nested chains cause the agent to `head -100` files and get incomplete info [^1].

**Frontmatter**
- `name`: ≤64 chars, lowercase/numbers/hyphens only; **gerund form** preferred (`processing-pdfs`, `analyzing-spreadsheets`) [^1] [^1].
- `description`: ≤1,024 chars, and must state **what it does AND when to use it** — it's the sole signal the agent uses to pick 1 skill from 100+ [^1].

**Degrees of freedom** — match specificity to task fragility:
- High freedom (prose guidance) when many approaches work
- Medium (parameterized scripts) when a preferred pattern exists
- Low (exact scripts, few params) when operations are fragile/sequence-critical [^1] [^1] [^1].

**Authoring process**
- **Build evals first**: run the task *without* the skill, document failures, write 3 test scenarios, establish a baseline, then write the *minimum* instructions to pass [^1].
- Develop with one model instance ("Claude A") authoring and a fresh instance ("Claude B") testing in real tasks — iterate on observed behavior [^1].
- Provide **a default, not a menu** — offering 5 libraries to pick from confuses the agent [^1].

**The counter-intuitive one:** the failure study found that **only 1.6% of failures were "wrong skill for the task"** — the dominant problem (68.8%) was skills inducing **task-implementation faults**: the agent mistook a *reusable example or default* for a *mandatory task requirement* [^2] [^2]. So **separate mandatory requirements from examples/templates/optional workflows**, explicitly.

---

## 3. Which skill *types* are empirically effective

Mapping the SoK's design patterns to evidence [^4]:

| Pattern | Evidence strength | Use it for |
|---|---|---|
| **Metadata-driven progressive disclosure** | Strong (the default architecture) | Almost everything — token efficiency + scales to large libraries |
| **Code-as-skill (executable scripts)** | Strong for determinism | Fragile, testable, repeatable operations (Voyager, CodeAct, SWE-agent) |
| **Workflow enforcement (gates/rules)** | Good for reliability | TDD, debugging, release checklists — auditable but can over-constrain |
| **Hybrid NL+code macros** | Good | Human-readable yet executable; the Claude Skills shape |
| **Self-evolving libraries** | **Weak / risky** | Self-generated skills gave *no* gain and can regress — gate hard before admission |
| **Meta-skills (skills that create skills)** | Cautious | Scales authoring, but has a "bootstrapping quality ceiling" |

---

## 4. A concrete starter collection

Given the evidence, I'd organize a harness library in three tiers. Names are in gerund form per convention.

### Tier A — Cross-cutting "meta" skills (highest leverage)
| Skill | What it does | Evidence basis |
|---|---|---|
| `managing-context` | Compression, compaction, masking, caching; detect lost-in-middle / poisoning / distraction | Context Bloat = 25.3% of efficiency regressions [^2] |
| `designing-tools` | Build tools agents actually use; architectural-reduction patterns | SoK tool-macro pattern [^4] |
| `managing-memory` | Short-term / long-term / graph memory architecture | SoK scope axis [^4] |
| `orchestrating-multi-agent` | Master-orchestrator, peer-to-peer, hierarchical patterns | Compilation/phase-transition finding [^3] |
| `evaluating-agents` | Build eval frameworks; negative tests | Explicit open challenge in both surveys [^3] |
| `creating-skills` | The `skill-creator` meta-skill (spec-compliant SKILL.md + eval loop) | Anthropic ships one [^5]; gate outputs though |

### Tier B — Domain skills (largest measured lift)
Prioritize **knowledge-poor domains** where the base model is weak: healthcare (+51.9 pp), manufacturing (+41.9 pp), cybersecurity (+23.2 pp), finance, and office/document work [^4]. Anthropic's document skills (`docx`, `pdf`, `pptx`, `xlsx`) are production-grade references here [^5].

### Tier C — Workflow / reliability skills
`test-driven-development`, `systematic-debugging`, `reviewing-code` (PR autofix), `building-mcp-servers`, `automating-web` (Playwright). **Note:** SWE-type skills showed the *smallest* benchmark lift (+4.5 pp), so keep these **short and lazy-load** their references [^4] [^2].

**Design tip from the SoK:** for web/GUI skills, encode **high-level intent** ("fill the departure field") rather than **low-level actions** ("click element id=departure-input") — the latter are brittle to UI drift [^4].

---

## 5. Where to source already-proven skills

Don't write everything yourself — these are the curated, community-adopted collections:

- **[anthropics/skills](https://github.com/anthropics/skills)** — official reference skills (Apache 2.0; the document skills are source-available) across Creative/Design, Development/Technical, Enterprise/Comms, and Documents [^5]
- **[agentskills.io specification](https://agentskills.io/specification)** — the open SKILL.md format spec [^7]
- **[VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills)** — hand-picked, explicitly *not* AI-generated, prioritizes team-published/community-adopted skills; compatible across Claude Code, Codex, Gemini CLI, Cursor, Copilot, Windsurf [^8]
- **[obra/superpowers](https://github.com/obra/superpowers)** — includes a `writing-skills` meta-skill [^9]
- **[SkillsMD registry](https://skillsmd.dev/)** and **[orchestra-research/AI-research-SKILLs](https://github.com/orchestra-research/AI-research-SKILLs)** — niche/domain registries [^10] [^11]

---

## 6. Failure modes to design against (from 125 confirmed failures)

**Functional failures** [^2]:
- Task-Implementation Fault — **68.8%** (incorrect fill 36.8%, omission 28.8%)
- Artifact Misplacement — **19.2%** (wrote output to wrong path)
- Environment Mismatch — **10.4%** (broken deps / state drift)
- Applicability Mismatch — only **1.6%**

**Efficiency regressions** [^2]:
- Excessive Procedure — **62.6%** (excessive verification 36.8%, heavy pipelines 16.5%)
- Context Bloat — **25.3%** (almost entirely the always-loaded skill body)
- Dependency Resolution — **12.1%**

**Practical implications** [^2]: keep always-loaded bodies short and lazy-load examples/templates; **condition verification scope on task uncertainty, change size, and budget** rather than prescribing exhaustive workflows; add skill↔task compatibility checks before selection.

---

## 7. Security — non-negotiable for a shared library

This is the part most harnesses get wrong. A large-scale analysis of 42,447 marketplace skills found **26.1% contain at least one vulnerability** (prompt injection, data exfiltration 13.3%, privilege escalation 11.8%, supply chain), and **script-bearing skills are 2.12× more likely to be vulnerable** than instruction-only skills [^3].

Recommended posture: static + semantic + sandbox + permission-manifest gates, with **graduated trust tiers** (unvetted community skills get instructions-only + full tool isolation; never grant script execution) and runtime monitoring for promotion/demotion [^3]. Note the survey authors flag this framework as a *proposal*, not empirically validated [^3] — but the threat data is empirical.

---

### My recommendation in one line
Build a **small, curated, human-reviewed library** (target ~10–20 focused skills, each 2–3 modules, bodies under 500 lines), **front-loaded toward knowledge-poor domains**, with a hard admission gate and provenance tiers — and **measure against a no-skill baseline per skill**, because ~1 in 5 tasks regresses when skills conflict with what the model already does well.

Want me to draft a spec-compliant `SKILL.md` template + an eval harness scaffold (the "build evals first" loop) you can drop into your repo?

**References**

[^1]: [Skill authoring best practices - Claude Platform Docs](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) (27%)
[^2]: [[2608.11888v1] Agent Skills Can Be Harmful: An Empirical Study of Skill-Induced Failures in LLM Agents](https://arxiv.org/html/2608.11888v1) (25%)
[^3]: [[2602.12430v4] Agent Skills for Large Language Models: Architecture, Acquisition, Security, and the Path Forward](https://arxiv.org/html/2602.12430v4) (24%)
[^4]: [[2602.20867v1] SoK: Agentic Skills -- Beyond Tool Use in LLM Agents](https://arxiv.org/html/2602.20867v1) (17%)
[^5]: [anthropics/skills GitHub Repo](https://github.com/anthropics/skills) (3%)
[^6]: [SkillsBench 1.1: Agent Skills Benchmark Release | SkillsBench](https://www.skillsbench.ai/blogs/skillsbench-1-1) (1%)
[^7]: [GitHub - agentskills/agentskills: Specification and documentation for ...](https://github.com/agentskills/agentskills) (1%)
[^8]: [VoltAgent/awesome-agent-skills GitHub Repo](https://github.com/VoltAgent/awesome-agent-skills) (1%)
[^9]: [anthropic-best-practices.md - writing-skills](https://github.com/obra/superpowers/blob/main/skills/writing-skills/anthropic-best-practices.md?plain=1) (0%)
[^10]: [SkillsMD — The Open Agent Skills Registry](https://skillsmd.dev/) (0%)
[^11]: [Orchestra-Research/AI-Research-SKILLs: Comprehensive ...](https://github.com/orchestra-research/AI-research-SKILLs) (0%)