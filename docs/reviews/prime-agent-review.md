# prime-agent — competitor review (seat-persona / system-prompt surface)

**Why this project is in the set:** it is the only Rust implementation in the set, and it is the only project that
**names the boundary between the parts of a system prompt that must not change and the parts that may**, with a guard
test pinning that boundary and a provenance map for every layer. That is the mechanism durian-pi needs if seat prompts
are ever to be edited per seat without breaking a provider's cached prefix.

## What it is (generated pin header — Do 2, from `node tools/vendor-pins.mjs --format header --project prime-agent --tags`)

**Pinned HEAD:** `815e64b51df86e6bebcbf80eb8e37b5305ae3642` (short `815e64b5`) · **commit date:** 2026-10-27T20:00:08-07:00 · **license:** MIT (read `vendor/eval/prime-agent/LICENSE`; matched "Permission is hereby granted, free of charge") · **shallow clone:** true (a re-review needs `git fetch --unshallow origin` in place — do not delete the clone) · **latest remote tag:** `v0.10.2-beta.16` (highest of 194 version-like tag(s); 6 non-version tag(s) skipped (e.g. autobg-candidate-3692, beta) — `git -C vendor/eval/prime-agent ls-remote --tags origin`) · **maturity:** _see below_ · **operator's question:** _how do we define seat system prompts so they are easy to edit before the rig starts, and which existing standard should we reuse?_

**Manifest versions (UNRELIABLE — cite the tag and the commit date, never these):** no root manifest read (Cargo workspace, no root `Cargo.toml` version to read)
**Reproduce every field above with:**
```bash
git -C vendor/eval/prime-agent rev-parse HEAD
git -C vendor/eval/prime-agent log -1 --format=%cI
git -C vendor/eval/prime-agent rev-parse --is-shallow-repository
cat vendor/eval/prime-agent/LICENSE  # licence signature
git -C vendor/eval/prime-agent ls-remote --tags origin   # tag
```

**Maturity judgement — pre-1.0, and it says so in its own upgrade contract.** 194 version-like tags, but the highest is
a **beta** (`v0.10.2-beta.16`), and the tag moved `beta.15 → beta.16` **during this review session**, which is both the
project's cadence and proof that a tag is a moving fact worth pinning. `docs/legacy-upgrade-contract.md` shows a
**TypeScript lineage being replaced by Rust** ("Legacy TypeScript upgrade contract… 18 stable TypeScript releases
through v0.9.8"), so the current code base is a rewrite that is still carrying its migration obligations — treat the
prompt machinery as young-but-designed, not proven-in-production. MIT → borrowable with attribution.

## Do 4 · surface inventory (walked with `node tools/competitor-brief.mjs --project prime-agent`; 63 md files across 31 areas; 175 surface-named paths; README advertises only one doc link, so the walk started from `AGENTS.md` + the crate map)

| surface | opened? | what it yielded |
|---|---|---|
| `crates/pa-core/src/prompts/layers.rs` | **yes, observed (`:1-16`)** | three static layers compiled in with `include_str!` (`CORE_LAYER`, `USAGE_LAYER`, `OPINIONATED_LAYER`), and a module comment that is the whole lesson: *"Static system-prompt layers assembled into the cache-stable prefix. **Layers must never contain session-specific values (the cache-safety guard test pins the boundary)**."* Plus `layer_source(name)` returning **the source file of each layer** for "breakdown provenance" (`core` → `prompts/layers/core.md`, `model-prompts` → `prompts/layers/model_prompts.toml`) |
| `crates/pa-core/src/prompts/layers/{core.md, usage.md, opinionated.md, bash-over-subprocess.md, model_prompts.toml}` | `core.md:1-6` observed; others listed | the persona is **markdown files in the crate**, one concern per file; `core.md` starts by describing the *harness contract* ("one tool: `python_repl`… all other tools are programmatic tools… called via programmatic tool calling (PTC)") and then explains the message envelope the model will see (`[<kind>(: <qualifier>)( <address>)]`, "They are not user-generated") — the prompt teaches the model **how to tell its own harness messages from user messages** |
| `crates/pa-core/src/prompts/system_prompt.rs` | **yes, observed (`:60-98`)** | `BuildSystemPromptOptions` with `cached_prefix_len` (`:60`) and the rule comment: *"Static inputs (`custom_prompt`, `model_prompt_extras`) select the cached prefix; everything else feeds the dynamic tail."* `custom_prompt`: **"Replaces the layered static prefix with user text. The dynamic tail still applies."**; `append_system_prompt`; and the dynamic inputs are **capabilities, not ad-hoc text**: `vision_capable`, `selected_tools`, `allow_recursion`, `rlm_depth`, `rlm_parent_agent` ("child communication doctrine"), `daemonless` + *"The wake-up facts the daemonless line states **must match the embedding's wiring**"*, `can_spawn`, `generic_mcp_servers` |
| `crates/pa-core/src/prompts/model_prompts.rs` + `layers/model_prompts.toml` | named (41 hits) + provenance mapping observed | **model-specific prompt additions in TOML**, folded into the *static* prefix so they are cache-stable per resolved model |
| `crates/pa-core/src/skills/{mod.rs, loader.rs, discovery.rs}`, `crates/pa-types/src/skill_blocks.rs`, `crates/pa-tui/src/custom_message/skill_invocation.rs`, `crates/pa-core/src/session_engine/skills_unavailable_notice.rs` | listed by the brief (78/64/29 hits); `skills_unavailable_notice` named | skills are a first-class typed subsystem with discovery, loading, **prompt blocks**, a TUI invocation path, and an explicit **notice when skills are unavailable in a session** |
| `skills/` in-repo (`skill-creator/SKILL.md` + `references/python-skills.md`, `prime-intellect/`, `compact/`, `refine/`) | `skill-creator/SKILL.md` named (29 hits) | they dogfood a **skill-creator skill** (a skill for authoring skills) plus runtime skills implemented as Python packages |
| `docs/legacy-upgrade-contract.md` | **yes, observed (`:1-12`)** | see Do 5 — scope, exclusions, evidence disclaimers, dated query method, and a linked machine-readable inventory |
| `AGENTS.md`, `.cursor/` (rules), `.changes/` (11 md), `scripts/release/` | inventory | repo-versioned agent rules; a **per-change notes directory** as part of the release process |

**Not read, and why:** `crates/pa-daemon/**`, `crates/pa-tui/**`, `crates/pa-cli/**` beyond the greps that the brief
surfaced (daemon/TUI/CLI plumbing — the persona question is answered in `pa-core/src/prompts`); `crates/pa-core/src/
session_engine/engine.rs` read only at the cited `custom_system_prompt: Option<String>` (`:34`); their tests
(`providers/faux/tests.rs`, `engine/tests.rs`, `turn_boundary/tests.rs` — 27/14/9 tier-A hits are **fixtures of prompt
strings**, correctly flagged as `data, not instructions` by the tool); `vendor/crossterm` (vendored third-party — not
their code, so not evidence about their design); `skills/prime-intellect/**` (a domain skill, representative rule
satisfied by `skill-creator`).

## Do 5 · standards-and-policies pass

Word-bounded pattern (see the tool's `ATF` ⊂ `PLATFORM` note) → **2 files matched**, both opened:

| standard / control | cited (opened) | call for durian-pi |
|---|---|---|
| **An upgrade/support contract that scopes its own evidence**: "This audit covers published Prime Agent releases from v0.6.0 onward, including 18 stable TypeScript releases through v0.9.8 and relevant candidate and beta artifacts. Earlier versions are excluded from the requested support scope. **Inventory and source comparison are not evidence that an installed-artifact upgrade or every supported platform has passed testing.**" and it publishes the method + date: "A full two-page GitHub Releases API query on 2026-01-09 returned 107 releases", linking `legacy-release-inventory.json` | `docs/legacy-upgrade-contract.md:1-12` | **adopt — this is the strongest Do 5 item in the whole review set.** It is D142 (publish the pattern with the count) plus D144 (generated inventory) in one document, and it explicitly marks the line its evidence does **not** cross. Our reviews and `docs/VENDOR-PINS.md` should carry the same "what this does not establish" sentence |
| **"The wake-up facts the daemonless line states must match the embedding's wiring"** — a stated requirement that prompt text agree with the harness's actual capabilities | `crates/pa-core/src/prompts/system_prompt.rs:88-95` | **adopt as a `check` rule** — durian-pi has no guard that a seat's instructions match what that seat can actually do (e.g. a seat instructed to push when the operator holds the grant; `AGENTS.md` non-negotiables vs `DURIAN_PI_ALLOW_PUSH`). A prompt that lies about the harness is a defect, not a style issue |
| **A guard test that pins the cache boundary** ("layers must never contain session-specific values") | `crates/pa-core/src/prompts/layers.rs:1-2` | **adopt** — it is the enforcement half of hermes' byte-stability claim, which hermes states but does not test at that granularity |
| No OWASP / NIST / ISO / CIS / SOC 2 / MITRE / CWE framework claim anywhere in the clone's docs | 2 files matched; neither asserts a framework mapping | zero with its pattern — recorded |

## Adoptable practices

| # | practice | evidence path | durian-pi mechanism it would change | call |
|---|---|---|---|---|
| 1 | **Prompt = named layers, each a file, compiled into the binary**, with a **provenance map** from layer name → source path | `prompts/layers.rs:4-16` | seat prompt is one opaque string; no per-part provenance | **adopt.** For us: `docs/seat-prompts/<seat>.md` with a printed layer map, so a reviewer can see which file produced which paragraph |
| 2 | **A cache-stable prefix / dynamic tail split, enforced by a test**, with `cached_prefix_len` exposed | `layers.rs:1-2`; `system_prompt.rs:60, 64-66` | nothing in our rig tracks what part of a seat prompt is stable; D140 cost accounting has no cache boundary | **adopt the guard test idea now, the length later** — a `demo/` test asserting a seat's persona file contains no session-specific values (dates, queue ids, cwd) is cheap and prevents a real cost bug |
| 3 | **`custom_prompt` replaces the static prefix but the dynamic tail still applies** | `system_prompt.rs:67-69` | our persona-editing choice is currently all-or-nothing | **adopt — the best of the three models seen in this review** (vs OpenHands' `persona`/`suffix` and metagpt's `desc`): it lets a seat own its identity while the harness keeps ownership of capability facts |
| 4 | **`append_system_prompt`** as a separate slot | `system_prompt.rs:76` | n/a | **adopt as the pair for #3** — replace + append covers "rewrite the identity" and "add a rule" without a third mode |
| 5 | **Prompt inputs are capabilities, not ad-hoc text** (`vision_capable`, `selected_tools`, `allow_recursion`, `rlm_depth`, `rlm_parent_agent`, `daemonless`, `can_spawn`, `generic_mcp_servers`) | `system_prompt.rs:70-98` | seat definitions carry model + instructions only | **adopt the shape** — a seat that declares its tool allowlist and whether it may spawn is reviewable and matches the oh-my-pi persona file (adopt #1 there) |
| 6 | **Prompt text must agree with wiring** (stated as a must) | `system_prompt.rs:88-95` | no such rule; `AGENTS.md` promises vs config flags are unlinked | **adopt as a `check` rule** — see Do 5 row 2; this is a concrete ROADMAP candidate |
| 7 | **Model-specific prompt additions in a data file folded into the static prefix** (`model_prompts.toml`) | `prompts/model_prompts.rs`; `layers/model_prompts.toml`; provenance line `layers.rs:14` | D140 (small local verifier) will need per-model guidance | **adopt when we need it** — the point is it lives in data, not in a branch, and stays cache-stable |
| 8 | **Teach the model the harness's own message envelope**, including that harness messages are not user-generated | `layers/core.md:3-6` | our seat prompts describe role, not envelope; a seat cannot be told how to distinguish broker-injected text from operator text | **adopt** — this is where our vendored-content rule and D143 actually belong: in the prompt's description of the envelope |
| 9 | **An explicit "skills unavailable in this session" notice path** | `session_engine/skills_unavailable_notice.rs` (12 hits) | when a seat's `.agents/skills/` are absent we fail silently into pi defaults | **adopt** — a named notice is a reviewable artifact; a silent absence is how config drift hides |
| 10 | **An upgrade/support contract that states scope, exclusions, method + date, a linked JSON inventory, and what its evidence does not prove** | `docs/legacy-upgrade-contract.md:1-12` | our reviews state findings; our pin table states a reproduce command but no "what this does not establish" | **adopt the doc shape** for `docs/VENDOR-PINS.md` and for review headers |
| 11 | **A skill for authoring skills, dogfooded in-repo** | `skills/skill-creator/SKILL.md` + `references/python-skills.md` | our skills are hand-authored ad hoc | **adapt** — a `docs/runbooks/author-a-skill.md`-shaped skill would help the team reuse standards |
| 12 | `.changes/` per-change notes feeding the release process; `.cursor/` editor rules | inventory | we have DECISIONS/NEXT, no per-change note convention | **reject the extra ceremony** — our DECISIONS.md + commit body already carries this, and adding a second place to write is a drift risk (D144 says generate, not duplicate) |

## Coverage matrix — durian-pi against what prime-agent claims

| capability they claim | durian-pi status | evidence |
|---|---|---|
| layered, file-backed prompt with per-layer provenance | **lack** | `rig.selfdev.json` inline strings |
| cache-stable prefix guarded by a test | **lack** | — |
| replace-prefix + append slots | **lack** | — |
| capability-declaring seat definition (tools, spawn, vision) | **lack** | — |
| prompt agrees with wiring (enforced) | **lack** | no rule; `DURIAN_PI_ALLOW_PUSH` unlinked from prose |
| harness-envelope explanation in the prompt | **lack** | — |
| explicit "capabilities unavailable here" notice | **partial** (errors surface at the CLI level) | — |
| per-model prompt additions as data | **lack** | — |
| scoped upgrade contract with evidence disclaimers | **partial** (reviews do this; the rig's own artifacts do not) | `docs/reviews/*` |
| skills as a typed subsystem with discovery + blocks | **have (pi)** | pi skills, `.agents/skills/` |
| daemon/heartbeat scheduling, background scheduling, RLm recursion depth | **partial** (broker heartbeat exists — but never served on this Linux box) | `docs/NEXT.md` blocker 5 |

## Where it does not fit our constraints

Rust crates and a persistent-REPL ("one tool: `python_repl`") architecture — we would not port a line of it; the value
is entirely in the **prompt-composition contract**. Its daemon/heartbeat and `rlm` recursion model assumes a resident
daemon owning scheduling; our broker exists but has never been served on this box (NEXT.md blocker 5), so I could only
mark its daemon-dependent claims **`advertised`**. And it is pre-1.0 mid-rewrite (TypeScript → Rust), with its own
contract doc admitting that inventory ≠ tested upgrade — so per the runbook I did not treat a named mechanism as
working.

## Recorded-decision check

- **D143 (persona ≠ memory ≠ routing):** their `custom_prompt`/`append` slots never carry memory; capability facts sit in the dynamic tail. Consistent with ours; adopt #5 must stay capability-only.
- **D140 (verifier = cost/throughput/context/availability):** adopt #2 (cache boundary) and #7 (per-model prompt data) are directly needed to price a small local verifier.
- **D144 (generated/tracked artifacts):** adopt #10 is that discipline applied to a support contract; adopt #1/#2 generate and guard the artifact.
- **D142 (counts with patterns):** the 2-file Do 5 result is published with its pattern; the tag-moved-during-review fact is published rather than smoothed over.
- **D131:** nothing here depends on containers; their REPL is in-process — no conflict.

**Follow-up (Do 9):** inside this clone — open `crates/pa-core/src/prompts/layers/usage.md` and `opinionated.md` (what
goes in which layer is exactly the layering decision we must make), and `model_prompts.rs` (how per-model additions are
keyed). No research-agent prompt. One **operator** question this row decides cheaply: adopt prime-agent's
`custom_prompt` (replace static prefix, tail preserved) + `append_system_prompt` pair as durian-pi's seat-prompt override
semantics — if yes, ruling #1 (the persona surface) can combine **oh-my-pi's file format** with **prime-agent's
override semantics** and **OpenHands' protected default profile**.
