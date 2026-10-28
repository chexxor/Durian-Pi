# Research prompt — do scope-tiered skills (project / personal / rig) earn their cost for durian-pi?

**Status: deferred by the operator, 2026-10-28 (D146): "We need more research on the value of this for our project, so
not right now."** This file is the request, prepared per `docs/runbooks/research-request.md` Do 1, so the operator can
route it when it is worth a slot. **Nothing in durian-pi has changed on the strength of it.** Write-up only — do not
modify code while answering.

## Context

durian-pi is a local, single-operator rig that runs a small team of persistent CLI agents ("seats") over a sqlite work
queue. Each seat is a `pi` coding-agent session; seat instructions currently live as inline JSON strings in
`rig.selfdev.json`. Instructions reach a seat from several places at once: the rig's `AGENTS.md`, `.agents/skills/*/SKILL.md`
(discovered from the working tree), `docs/runbooks/**`, and per-seat instructions. There is **no scope model** for
skills today: whatever is in `.agents/skills/` reaches every seat in that workspace.

The competitor sweep (`docs/COMPETITORS.md`, "The 2026-10-28 seven-clone sweep") found one project with an explicit
scope order — OpenHands Agent Canvas: `SkillScope = "project" | "personal" | "public"` with
`SKILL_SCOPE_ORDER = [project, personal, public]` (`vendor/eval/openhands src/utils/skill-scope.ts:3-14`), plus a
legacy-path marker kept because "dropping it would silently misfile legacy skills as 'public'". Two adjacent
observations, both cited in the reviews: OpenHands also keeps a **declared skill catalog** in a stated order
(`src/utils/skill-enablement.ts:1-10`) rather than scanning directories, and oh-my-pi resolves prompt templates from
**user-level and project-level directories** with the source labelled (`(user)`, `(project)`, `(project:frontend)` —
`packages/coding-agent/src/config/prompt-templates.ts`).

We are **not** asking whether scope tiers are nice. We are asking whether they pay for themselves at our scale — one
operator, one repo, ~12 seats, ~4 skills, no cloud, no plugin distribution.

## Questions

1. What do systems that ship scope tiers actually use the tiers **for**, in their own words? Look for the motivating
   problem in each: multi-user sharing, credential/secret scoping, distribution/marketplace, per-repo customization,
   or precedence when two skills share a name. Prefer primary sources (design docs, spec text, changelogs, issue
   threads) over marketing pages.
2. When two skills at different scopes have the **same name or overlapping trigger**, what resolution rule do they
   implement, and what failure modes are documented (shadowing, silent disabling, drift after a rename)? Any incident
   reports or bug threads count as strong evidence.
3. What does a scope tier cost to **maintain** — per-scope install/uninstall paths, per-scope enablement state, per-scope
   docs, UI surface for showing which scope a skill came from? Any evidence of teams removing the feature as
   over-engineering.
4. Is there evidence that scope tiers matter for **agent-instruction security** specifically — i.e. that a personal or
   global skill overriding a project one is a realistic injection/privilege path, or the reverse (project skills
   polluting a user's other repos)? Cite threat models, advisories, or CVEs if any exist; say plainly if none do.
5. For a rig our size, is there a **smaller mechanism** that gets most of the value we would want: a per-scope label
   with no precedence rules, an explicit catalog/enablement list, a single "rig-level vs repo-level" split, or nothing at
   all with a single directory plus per-seat allowlists? Any published postmortems or "we simplified this" write-ups.
6. What does our own situation suggest, given constraints: **no cloud backend, no plugin marketplace, one operator, a
   native-host-OS-only rule, and seat instructions we may move into files** (see `docs/NEXT.md`, ruling 1)? If the
   evidence is that scope tiers only pay off with distribution or multi-user use, say so explicitly.

## Deliverable

Write `docs/reviews/skill-scope-tiers-research.md` with these sections:

1. **Verdict up front** — adopt / adopt-a-smaller-variant / reject-for-now, in one paragraph with the reason.
2. **What the tiers are for** — Question 1, one row per system, each with its own cited motivation.
3. **Precedence and its failure modes** — Question 2, with the rule each system implements and any named incident.
4. **Cost side** — Question 3.
5. **Security argument, if any** — Question 4, with an explicit "no evidence found" line if that is the answer.
6. **Smaller alternatives** — Question 5, each with what it buys and what it costs at our scale.
7. **Recommendation for durian-pi** — mapped to a mechanism in our tree (`.agents/skills/`, `rig.selfdev.json`,
   `docs/runbooks/competitor-review.md`) or an explicit "change nothing", plus what would change our mind later.

## Evidence discipline

Every external claim carries a **URL** and its class: `observed-externally` (a file/text I read), `advertised-elsewhere`
(the project's own docs claim it, unverified), or `inferred`. Name the version/commit/date for every cited artifact —
pins move within a day in this space (measured: five of our seven vendored clones went behind upstream in one day,
`node tools/vendor-pins.mjs --freshness`). Any finding that does not map to a decision in Questions 1-6 should be
labelled "not applicable to durian-pi" rather than padded in. Do not cite our own `docs/COMPETITORS.md` as evidence; it
is the starting point, not the source.

## Constraints

Written report only; do not modify code, do not clone into `vendor/eval/` (that directory is pinned by
`docs/VENDOR-PINS.md` and re-cloning is the delegate's call per `docs/runbooks/competitor-review.md` Do 0), and do not
open a seat/queue item. Native host OS only — a sandboxed/demo install is not required to answer.
