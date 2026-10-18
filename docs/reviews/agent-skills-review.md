# Agent-skills review (delegate, 2026-10-18)

**Why this exists.** The operator asked us to (a) vendor the leading Agent-Skills collections for
evaluation, and (b) review *our* skills against them and against the evidence so our skills are
effectively written. This is delegate analysis — it changes no product code and registers no queue
item by itself; the work items it implies are delivered to `pm` separately.

**Method (read from the tree, not memory).**
- Vendored four collections under `vendor/eval/` (gitignored): `anthropic-skills`,
  `agentskills-spec`, `awesome-agent-skills`, `superpowers`.
- Read the format spec (`vendor/eval/agentskills-spec/docs/specification.mdx`), Anthropic's
  `skill-creator` (`vendor/eval/anthropic-skills/skills/skill-creator/SKILL.md`), and the
  `writing-skills`/`anthropic-best-practices` pair (`vendor/eval/superpowers/skills/writing-skills/`).
- Read the operator's research synthesis (`docs/research/llm-agent-skills-and-frameworks.md`).
- Inventoried our skills: `skills/durig/`, `skills/tui-design/`, `.agents/skills/durig/`, and the
  operator's global `~/.agents/skills/openrig-{cli,skills}`.

---

## 1. What we have

| Skill | Location | Format | Body | References | Evidence it works |
|---|---|---|---|---|---|
| `durig` ("Driving durig") | `skills/durig/SKILL.md` | valid frontmatter | 93 lines | none | none |
| `durig` ("Delegating to a durig team") | `.agents/skills/durig/SKILL.md` | valid frontmatter | 167 lines | none | none |
| `tui-design` | `skills/tui-design/SKILL.md` | valid frontmatter + `LICENSE`, `README.md` | 139 lines | 3 of 8 routed references exist | none |

Both `durig` files are instruction-only (no `scripts/`), which the security literature rates as the
lower-risk class (script-bearing skills are reported ~2.12× more likely to carry a vulnerability).
`tui-design` is a documented, licensed vendoring of `gfargo/tui-design-skill`, MIT, with a README
that states exactly what was kept and omitted — a good provenance pattern.

## 2. Findings (each grounded in a file read)

| # | Finding | Evidence | Severity |
|---|---|---|---|
| S1 | **Two different skills both named `durig`.** One is the CLI skill ("Driving durig", added `e1c57d6`), the other the delegate skill ("Delegating to a durig team", moved in `762d95f`). The `name` field is the agent's only selection signal; two skills claiming `durig` make triggering ambiguous and guarantee drift. | `skills/durig/SKILL.md:1-8` vs `.agents/skills/durig/SKILL.md:1-8`; the descriptions differ; both `name: durig` | High |
| S2 | **`tui-design`'s routing table sends the agent to references that are deliberately not vendored**, and the `SKILL.md` never says so. On trigger only `SKILL.md` loads, so an agent follows the table to `references/ecosystem-{go,rust,python,typescript}.md` / `cli-basics.md` and finds nothing. The omission is documented only in `README.md`, which is not loaded on trigger. | `skills/tui-design/SKILL.md:13-24` routes to 5 absent files; `git ls-files skills/tui-design/references/` lists only 3; `skills/tui-design/README.md` "Deliberately omitted" | High |
| S3 | **No skill has an eval, and nothing measures a skill against a no-skill baseline.** The evidence (SkillsBench; the 125-failure study) is that ~1 in 5 tasks *regresses* when a skill conflicts with what the model already does, and that the dominant failure is the agent mistaking an example for a mandatory requirement. We cannot tell which of our skills help. | no eval harness under `demo/` or `skills/`; research §1/§6 | High |
| S4 | **No convention for which root is canonical.** Skills live in both `skills/` and `.agents/skills/`; `durig` exists in both. The pi runtime loads `.agents/skills/` (the cross-runtime alias per `superpowers/skills/writing-skills/SKILL.md`). | `git ls-files skills/ .agents/` | Medium |
| S5 | **`openrig-cli` (operator-global) pins a version in its description** — `v0.6.6` — which rots as the CLI moves; version belongs in `metadata.version`, and the description should state what+when. | `~/.agents/skills/openrig-cli/SKILL.md:3` | Medium |
| S6 | **Bodies are within budget and use progressive disclosure where it exists** (`tui-design` delegates detail to `references/`, one level deep). `durig` bodies (93/167 lines) are well under the 500-line/spec guidance. This is the good part. | sizes above; spec "Keep your main SKILL.md under 500 lines" | — |
| S7 | **Descriptions mostly state what + when** (a spec requirement and the sole selection signal). The delegate skill's description is a strong example. | frontmatter of all three repo skills | — |
| S8 | **The vendored collections are evaluation material, not loadable skills.** `vendor/eval/` is gitignored and must not be put on the skill search path; the security literature reports ~26% of marketplace skills carry a vulnerability. Ours are instruction-only, so the primary risk is importing a collection indiscriminately. | `.gitignore:19`; research §7 | Medium |

## 3. Recommendations

1. **One name, one skill (S1).** Either merge the two `durig` docs into one entry point, or rename by
   audience and use the spec-preferred gerund form: `driving-durig` (CLI operator) and
   `delegating-to-durig` (external delegate). Each `name` must be unique across every skill root.
2. **Make the broken routes honest (S2).** In `tui-design/SKILL.md`, either vendor the omitted files
   or replace the five routes with one line: *"framework/ecosystem and CLI references are not
   vendored — durig is Node/pi-tui and its CLI is non-interactive (D21); see `README.md` for the
   omission rationale."* A routing table must never point at a file that cannot be loaded.
3. **Adopt an eval gate (S3).** Before adding or changing a skill, run its task without the skill,
   record the failure, then with it; keep the skill only if it moves an outcome. The
   `agentskills-spec` ships `skills-ref validate` for the format half; the behavioural half needs a
   small harness. This matches the operator's research recommendation (small, focused, measured).
4. **Pick one canonical root (S4)** and treat the other as a mirror or remove it. State it in a
   decision so it does not drift again.
5. **Normalise frontmatter (S5):** `name` (lowercase-hyphen, matches the directory), `description`
   (what + when, no volatile version), and `metadata.version` for anything that changes.
6. **Keep collections out of the load path (S8)**; pin each vendored collection by commit in a
   provenance note, exactly as `tui-design/README.md` does.
7. **A `git` skill is worth having but is not the reliability fix** for the editor problem — the
   environment fix is (see D109). Per the evidence, software-engineering procedure skills show the
   smallest measured lift, so keep it short and command-exact.

## 4. What the work items are

Delivered to `pm` as an intent, to be registered and routed:

- **K1 — skill set truth-up:** resolve S1 (duplicate `durig`), S2 (broken `tui-design` routes), S4
  (canonical root), S5 (frontmatter). Docs-only.
- **K2 — skill eval gate:** a small "run the task without the skill, then with it" harness plus a
  documented admission rule; S3. This is the one that makes the rest measurable.
- **K3 — `git` skill + agent git hygiene:** the environment fix is D109; the skill is the durable
  practice layer.

## 5. Disposition of this review

Delegate analysis. The `vendor/eval` clones are evaluation material (gitignored). No repo code or
skill was changed by this review; the recommendations are routed, not applied.
