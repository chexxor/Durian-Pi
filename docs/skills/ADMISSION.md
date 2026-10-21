# Skill admission rule (S3, lead ruling 2026-10-18)

Every skill under `.agents/skills/` (the canonical root, S4) is admitted by an **eval gate**: a
named, reproducible probe that is run WITHOUT the skill and then WITH it. A skill earns its place
only if it moves an outcome; a skill that does not is rejected and deleted. This is the behavioural
half of the gate; the format half is the SKILL.md spec itself (name/description/metadata, routing
tables that resolve).

## The admission rule

**"Moves an outcome"** = a NAMED, reproducible probe changes FAIL/underperform → PASS/improve.

**Admit a skill ONLY IF ALL of:**

1. A named probe FAILS without the skill;
2. the SAME probe PASSES with it;
3. the delta is reproducible (deterministic probes: 100%; non-deterministic: ≥ 2 of 3 runs);
4. NO other admitted probe regresses.

**Threshold:** ≥ 1 probe moves FAIL → PASS, and 0 regressions. PASS/FAIL is binary per probe.

**Reject:** 0 moved probes → REJECT and DELETE the skill.

**Gate on edit:** any edited skill re-runs its probe(s); if the delta disappears, remove or revert it.

**Evidence:** record the probe command + exit code (ROADMAP 48) — a claim about a skill is a claim
about a probe run.

## Why this gate

The evidence (SkillsBench; the 125-failure study) is that ~1 in 5 tasks *regresses* when a skill
conflicts with what the model already does, and the dominant failure is the agent mistaking an
example or default for a mandatory requirement. A skill that does not move an outcome is not
neutral — it is a regression risk. The gate makes "does this skill help?" a measured, reproducible
question instead of an assumption.

## The harness

`demo/skill-admission-gate.test.mjs` demonstrates the gate end-to-end: a probe that FAILS without
the fix and PASSES with it (RED-before baseline), the reproducibility check, and the 0-regression
check. A new or edited skill must pass its own probe(s) under the same rule before it is admitted.

## Canonical skill root (S4, lead ruling 2026-10-18)

`.agents/skills/` is the **canonical skill root**: it is the root the pi runtime actually loads, so
it is the single source of truth (edits take effect immediately, no sync). **Authors edit ONLY
`.agents/skills/`.**

`skills/` is NOT a second source of truth:

- Keep it ONLY as a **mirror** while something references it (D103 renames it in flight);
- a kept mirror MUST be **byte-identical** to `.agents/skills/`, enforced by a check
  (`demo/skill-mirror-check.test.mjs`);
- if nothing references a `skills/` entry, **remove it** — never a hand-maintained duplicate
  without a check.

Skill `name` fields are lowercase-hyphen and match their directory; `description` states what + when
and carries no volatile version (versions live in `metadata.version`).

## One name, one skill (S1)

**One name may name only one skill.** The review found two `durig` skills — `.agents/skills/driving-durian-pi/` (driving
the rig) and `.agents/skills/delegating-to-durian-pi/` (delegating to the rig) — both claiming the name `durig`. A
skill is loaded by name; two entries with the same name collide and make the loaded skill
ambiguous.

Per the lead ruling (2026-10-18), the post-rebrand names are `driving-durian-pi` and
`delegating-to-durian-pi`, both canonical in `.agents/skills/` (coordinated with the D103 rebrand
rename, #2109/#2111). That rename has LANDED (#2356): the two `durig` skills are now
`.agents/skills/driving-durian-pi` (CLI) and `.agents/skills/delegating-to-durian-pi` (delegate),
and `skills/durig/` is removed — the canonical root is the single source of truth. The result is
enforced by `demo/skill-names.test.mjs` (S1: one name per skill, `name` matches the directory) and
`demo/skill-mirror-check.test.mjs` (any kept mirror is byte-identical).

## Volatile versions (S5)

There is **no in-repo instance** of a skill pinning a volatile version in its `description`. The
review's S5 finding was the operator-global `~/.agents/skills/openrig-cli` skill (outside the
repo/seat root), which has since been renamed to `openrig-skills` and carries no version pin in its
description (it uses `metadata.openrig.stage`). Rule for the repo: a `description` states what + when
and never carries a volatile version — put anything that changes in `metadata.version`.
