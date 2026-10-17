# agency-agents vs our seats — persona & skill borrowing guide

**Date:** 2026-10-12 · **Read at:** `vendor/eval/agency-agents` HEAD `24485830`
(2026-06-29) · **Licence:** MIT ("attribution appreciated but not required").

**Repo:** https://github.com/AgentsRoomDev/agency-agents ("The Agency")

**One-line:** a catalogue of ~217–232 **Markdown agent personas** across 16
divisions, plus a tool-agnostic **converter/installer** that renders each persona
into Claude Code, Codex, Gemini, Qwen, Cursor, opencode, Aider, Windsurf, Kimi,
OpenClaw, Osaurus, Antigravity, Copilot, and Hermes formats — and a **NEXUS**
strategy layer of playbooks, runbooks, and handoff templates.

**Why this one is directly relevant:** it is the best public sample of
**persona/skill authoring at scale** we have looked at. Our seats are
`agent.yaml` + `guidance/role.md` + shared skills
(`the previous rig's agents/*`); this repo is a compatible, battle-tested
template for the *content and quality bar* of those persona files. Unlike
pi-multi-agent, nothing here is a runtime we would adopt — it is text we can
borrow from.

**Provenance note:** the catalogue's own README credits the Anthropic
"Agent Skills" `SKILL.md` convention for its Osaurus/Antigravity renderers
(`README.md`; `scripts/convert.sh:155`), i.e. the same convention our
`shared:grounding`/`shared:testing` skills use.

---

## 1. Seat-by-seat mapping (our rig → their best comparator)

Our seats come from `the previous rig's rig.yaml` and `agents/*`. For each,
the closest agency-agents file and the one thing worth taking.

| Our seat | Their closest file | Worth borrowing |
|---|---|---|
| `advise.lead` | `specialized/specialized-chief-of-staff.md`, `project-management/studio-producer.md` | chief-of-staff framing of "final call" + portfolio view |
| `program.pm` | `project-management/project-manager-senior.md`, `project-management/project-shepherd.md`, `product/product-sprint-prioritizer.md` | "quote EXACT requirements, don't add luxury features" as PM intake discipline |
| `domain.theorist` | `academic/academic-historian.md` | **confidence-level + source-type declaration** (see §3) |
| `domain.editor` | `engineering/engineering-code-reviewer.md` | blocker/suggestion/nit triage + "quote the spec, then the evidence" |
| `build.impl` / `impl2` | `engineering/engineering-minimal-change-engineer.md`, `engineering/engineering-senior-developer.md` | minimal-change discipline as an explicit persona trait |
| `build.qa` | `testing/testing-evidence-collector.md` | "default to finding 3–5 issues"; claims need evidence (see §3) |
| `build.qa2` | `testing/testing-reality-checker.md`, `specialized/specialized-model-qa.md` | independent-audit principle; default `NEEDS WORK`; severity-rated findings |
| `design.ux` | `design/design-whimsy-injector.md`, `design/design-ui-designer.md` | "every playful element must serve a function" — useful for a study tool |
| `learn.pedagogue` | `specialized/corporate-training-designer.md`, `product/product-behavioral-nudge-engine.md`, `academic/academic-psychologist.md` | learning-stall / confidence calibration framing |
| `learn.student` | *(no equivalent — keep ours)* | — |
| `security.sec` | `security/security-architect.md`, `security/security-appsec-engineer.md`, `security/security-senior-secops.md`, `security/security-compliance-auditor.md` | secrets-scan-on-every-change; threat-model + trust-boundary checklist |
| `devtools.dev` | `engineering/engineering-git-workflow-master.md`, `engineering/engineering-devops-automator.md` | safe-change/reversibility persona |
| `docs.scribe` | `engineering/engineering-technical-writer.md` | "document what shipped, not what was intended" |
| `workflows.advocate` | `product/product-feedback-synthesizer.md`, `specialized/specialized-developer-advocate.md` | friction-report voice |
| *(cross-cutting)* deliberation | `specialized/specialized-strategy-duel-agent.md` | explicit adversarial round structure + final verdict/recommendation |
| *(cross-cutting)* handoffs | `strategy/coordination/handoff-templates.md` | structured handoff + PASS/FAIL verdict templates (§4) |

No comparator maps to a type-theory/PL specialist — the academic division is
world-building ("Scholarly rigor for world-building, storytelling" per README),
so for `theorist` we borrow **method**, not domain content.

## 2. Persona file format — what we are missing

Their contribution template (`CONTRIBUTING.md`, "Agent File Structure") is a good
checklist. Frontmatter is `name`, `description`, `color`, `emoji`, `vibe`
(optional `services`); body sections:

```
Identity & Memory · Core Mission · Critical Rules ·
Technical Deliverables · Workflow Process · Communication Style ·
Learning & Memory · Success Metrics · Advanced Capabilities
```

Our `role.md` today is tight: **You own · Method · Output · Done means ·
Anti-patterns · Escalate when · Working with the PM**. That covers mission,
rules, and deliverables but **omits**:

- **Communication Style** — voice, example phrasing.
- **Success Metrics** — measurable outcome, not just a definition of done.
- **Learning & Memory** — recurring patterns the seat should accumulate.
- **Advanced Capabilities** — the moves a senior occupant has beyond the SOP.

Recommended change (small, one concern): add **Communication Style** and
**Success Metrics** to the role template; keep the existing sections. Do *not*
copy their length — their files run long and padded.

**Persona/Operations split.** Their converter splits `##` sections into
`SOUL.md` (identity/memory/communication/rules) vs `AGENTS.md` (mission/
deliverables/workflow/metrics) so the same source renders to many tools
(`scripts/convert.sh:319`, `scripts/lint-agents.sh` `classify_header_target`).
We have a single `role.md` and one runtime (pi), so this is **not worth
adopting** — but the *idea* that persona and operations are separable sections
is worth keeping in mind if we ever add a second runtime.

## 3. Verification & grounding — the strongest borrow

Three of their personas encode discipline we already hold as norms but have not
fully written into our skills:

1. **Evidence over claims** — `testing/testing-evidence-collector.md`: "If you
   can't see it working in a screenshot, it doesn't work"; *"Default to Finding
   Issues*: first implementations ALWAYS have 3-5+ issues minimum; a 'zero
   issues found' claim is a red flag."
2. **Default-to-fail certification** — `testing/testing-reality-checker.md`:
   default status `NEEDS WORK`/`FAILED`, "require overwhelming proof before
   production readiness", cross-check the earlier QA's findings rather than
   inheriting them.
3. **Independent-audit principle** — `specialized/specialized-model-qa.md`:
   "Never audit a model you participated in building"; every finding =
   *observation + evidence + impact + recommendation*, severity-rated; every
   analysis reproducible from raw inputs.
4. **Confidence labelling** — `academic/academic-historian.md`: "Always name
   your confidence level and source type" with an explicit scale
   (*well-documented / scholarly consensus / debated / speculative*) and
   "primary sources > secondary scholarship > popular history".

Our `shared:grounding` skill already says "cite page/section; fabricated
citations are the cardinal sin". The borrow is to add a **confidence/source-type
field** to the grounding skill and a **default-to-fail + minimum-N-evidence**
rule to `shared:testing` / `shared:peer-review`. That is a concrete improvement
to skills our seats already load, and it strengthens the product's grounding
promise (any textbook) without hard-coding TAPL.

## 4. Handoffs & verdicts — borrow the shapes

`strategy/coordination/handoff-templates.md` defines one **standard handoff**
metadata/context/deliverable block plus explicit **QA PASS** and **QA FAIL**
templates (attempt N of 3, evidence per acceptance criterion, "file(s) to
modify", fix instruction). `strategy/playbooks/phase-3-build.md` names the exact
loop: implement → Evidence Collector → PASS advance / FAIL return with feedback
/ escalate at 3.

This mirrors our pair-review closure rule and qa→impl loop. Two shapes are worth
lifting into `shared:delivery` (our delivery skill):

- A **handoff block** with `From/To`, context, affected files, acceptance
  criteria, evidence required.
- A **FAIL verdict** that must name the exact fix and files, not a summary.

Their `agents-orchestrator.md` also codifies retry-limits (`maximum 3 attempts
per task before escalation`) — we have the concept; naming the number explicitly
in the delivery skill removes ambiguity.

## 5. Quality/CI mechanisms (small, high-leverage)

| Mechanism | File | Use for us |
|---|---|---|
| Frontmatter + section lint (errors vs warnings, CRLF guard, <50-word body) | `scripts/lint-agents.sh` | a `role.md`/`SKILL.md` linter for our `agents/*` |
| **Near-duplicate detector** — entity-neutralised 8-word shingles, Jaccard, FAIL≥40%/WARN≥20% | `scripts/check-agent-originality.sh` | stops find-replace "re-skins" of personas/skills; directly applicable to our growing skill set |
| Division/tool manifests validated in CI | `divisions.json`, `tools.json`, `scripts/check-divisions.sh`, `scripts/check-tools.sh` | the "manifest is truth; CI fails on drift" pattern, if we catalogue skills |
| One-body-of-truth for a persona rendered to many targets | `scripts/convert.sh` | not needed today (single runtime) |

The **originality check is the single most reusable script here**: our skills and
seat roles are accumulating, and a cheap automated duplicate check would keep
them genuinely distinct — the same "one concern per change" spirit.

## 6. Sources they themselves cite

- **Format/ecosystem:** the Anthropic "Agent Skills" `SKILL.md` convention and
  `agentskills.io`-style layout (`README.md`, `scripts/convert.sh`), plus the
  Qwen sub-agent docs, MCP (`modelcontextprotocol.io`), and each target tool's
  own docs.
- **Domain agents** cite real references where relevant — e.g. MITRE ATT&CK
  `T1059/001` in a security persona, schema.org, WordPress `block.json`, vt100
  terminal docs.
- **Market/trend claims** in strategy docs lean on vendor market reports
  (MarketsandMarkets, Deloitte, PwC, G2, Mordor, Precedence). These are
  marketing-grade, not peer-reviewed.
- **Some "metrics" are invented puffery** — e.g. a whimsy persona's "reduces
  task-completion anxiety by 40%" (`README.md`) has no source. Treat every
  numeric success metric in their personas as illustrative, not evidenced; do
  **not** import such claims into our seats.

## 7. What NOT to borrow

- **Length and filler.** Their files are long and repetitive; our `role.md`
  files are deliberately tight. Adopt the *sections*, not the word count.
- **Invented success metrics.** Keep metrics measurable and self-generated.
- **Cross-tool converter.** Single runtime (pi) makes it dead weight.
- **Web-screenshot-specific QA** (`qa-playwright-capture.sh`): it assumes a
  browser UI. Our verification is command/citation based; take the *principle*
  (visual/objective evidence), not the tooling.
- **Their persona voice at face value.** Strong personality is good, but a
  grounded product must not adopt a persona that will answer from model
  memory — never trade grounding for character.

## 8. Verdict and recommended next steps

This is a **persona/skill content** comparator, not a substrate one. MIT terms
make adaptation fine with attribution. The high-value, low-risk borrows:

1. **Extend the role template** (`agents/*/guidance/role.md`) with
   *Communication Style* and *Success Metrics* sections.
2. **Strengthen `shared:grounding`** with a confidence/source-type field (from
   the historian persona).
3. **Strengthen `shared:testing` / `shared:peer-review`** with
   default-to-fail + minimum-N-issues-before-pass + independent-audit rule
   (Evidence Collector / Reality Checker / Model QA).
4. **Add the handoff + FAIL-verdict shapes** to `shared:delivery`, and name the
   retry limit.
5. **Borrow `check-agent-originality.sh`** as a linter for our skills/personas
   (adapted to our directories).

Each is one concern with a proving check; none changes the corpus or hard-codes
TAPL. If adopted, route the skill/role edits through the normal PM intake and
pair review (these touch taught behaviour and quality gates).

## 9. Adoption log (2026-10-12)

Implemented by the operator session (the rig's PM seat was not running at the
time; the durable item below is the tracking entry). All five borrows landed as
text-only, additive changes:

| # | Change | Where |
|---|---|---|
| 1 | `## Communication style` + `## Success metrics` on every seat | `the previous rig's agents/*/guidance/role.md` (15 seats) |
| 2 | Confidence + source-type labelling (`stated`/`derived`/`contested`, primary > secondary > recall) | `agents/shared/skills/grounding/SKILL.md` |
| 3 | Default-to-"not proven", boundary hunt, verify-independently | `agents/shared/skills/testing/SKILL.md`; `agents/shared/skills/peer-review/SKILL.md` (never review your own work) |
| 4 | Handoff block, FAIL-verdict shape, retry limit (3) | `agents/shared/skills/delivery/SKILL.md` |
| 5 | Persona/skill linter + originality check (entity-neutralised 8-word shingle Jaccard, FAIL≥40%/WARN≥20%) | `openrig/lint_agents.py` |

**Proving test:** `python openrig/test_lint_agents.py` (10 tests) and
`python openrig/lint_agents.py` — both PASS; 15 roles + 9 skills lint clean and
the worst overlap is 1.1%.

**Still owed to the team:** PM intake/tracking, and the appropriate review
(the skill edits touch our grounding and verification quality gates). The
change set is registered with `program.pm`; it is **not committed** pending that
review.

### Durig instance (same day)

These edits live in the OpenRig source; the **durig-format instance** carried
neither them nor the per-seat role text. Fixed:

- `durig/scripts/from-openrig.mjs` now inlines each seat's
  `agents/<seat>/guidance/role.md` (from `agent.yaml` `resources.guidance`) as a
  `# Role` block — previously dropped entirely.
- `durig/demo/converter.test.mjs` asserts the role persona is inlined.
- the generated rig spec was regenerated: 15 seats, same 15 edge groups,
  same constitution; every seat now carries the new sections + skill text.
- Applied live: `node cli.mjs up the generated rig spec --refresh` created
  `scribe`/`advocate` and refreshed 13 seats; 15/15 declared seats verified to
  carry `# Role` + `## Communication style` + `## Success metrics`.
- `node cli.mjs check the generated rig spec` — **0 error** (was `store-missing-seat`);
  two pre-existing `fix-now` remain (stray `worker`; single-model rig).
- Oracle: `demo/{converter,refresh,check,constitution}.test.mjs` all EXIT 0.
