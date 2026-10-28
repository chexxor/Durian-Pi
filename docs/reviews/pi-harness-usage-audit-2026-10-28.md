# Does the pi harness actually improve my work session after session? (audit 2026-10-28T22:4xZ, delegate, Linux)

The operator's observation — "I don't often see you using new tools you create, or new skills" — is measurable. I mined the
harness's own session store instead of introspecting. Everything below is a count over real transcripts.

## Corpus

`~/.pi/agent/sessions/` keeps one JSONL per session **per working directory**. For this project: **17 Linux sessions**
(19 MB) + **70 Windows sessions** for the pre-move cwd
(`…/Users/Alex/.pi/agent/sessions/--C--Users-Alex-dsh-Projects-pi-opendurig--`, 83 MB) = **87 sessions, 102 MB, 11,599
tool calls**. Entry types seen: `session`, `message`, `model_change`, `thinking_level_change`, `compaction`, and (Windows)
`custom_message`. This layer had never been consulted by any durian-pi session. The census is now an instrument, not a
one-off: **`tools/harness-usage-census.mjs`** (read-only, 0.55 s over all 87 transcripts) prints every number below.

> **Corpus correction (re-measured 2026-10-28, this Linux host):** the corpus above is **two hosts**. On this box today
> `~/.pi/agent/sessions/` holds **18** session files for this cwd and no Windows set (no D: volume is mounted), so the
> same command prints **18 sessions / 2,356 tool calls / 267 ad-hoc (11.3%)** — not 87 / 11,599 / 24.0%. Both figures are
> true of their corpus; the instrument does not print which one it is quoting, which is registered as ROADMAP **237**.
> Quote a corpus with every percentage from this file.

## What is actually forced, and how often it is honoured

| surface | sessions (of 87) that touched it |
|---|---|
| `docs/NEXT.md` | **75 (86%)** |
| `.spike/` | 70 (80%) |
| `cli.mjs` | 71 |
| `demo/` | 63 |
| `docs/runbooks/` | 58 |
| `docs/DECISIONS.md` | 56 |
| `docs/ROADMAP.md` | 53 |
| `.agents/skills/` | **28 (32%)** |

The pointer works: it is read in 86% of sessions, which is exactly why instruments named in it get reused. Skills are
*advertised* every session but *consumed* in about a third.

## Instrument reuse vs re-measuring from scratch

| instrument | calls | distinct sessions (of 87) |
|---|---|---|
| `cli.mjs` | 2,909 | 71 |
| `scripts/suite.mjs` | 134 | 18 |
| `scripts/clockin.mjs` | 129 | 13 |
| `tools/queue-drain-audit.mjs` | 30 | 6 |
| `tools/broker-serve.mjs` | 71 | 4 |
| `tools/latency-budget.mjs` | 28 | 2 |
| `tools/channel-preflight.mjs` (created 2026-10-28) | 72 | **2** |
| `tools/instrument-provenance.mjs` (created 2026-10-28) | 11 | **1** |
| **ad-hoc measurement** (`node -e`, `sqlite3`, `node:sqlite`, `DatabaseSync`, ad-hoc `grep/cat` on the store) | **2,789 (24.0%)** | — |

(Counting `bash` calls only and the narrower ad-hoc pattern set gives 11,586 calls and **2,086 ad-hoc, 18%** — the same
finding with a smaller denominator. The instrument publishes the wider figure; both were measured, neither is hidden.)

Read honestly: reuse **does** carry across sessions for instruments that sit in the pointer's baseline (6–21 sessions each),
and does **not** happen for brand-new ones (1–2 sessions). Meanwhile **a quarter of all tool calls in 87 sessions are one-off
measurement code** — the single biggest recurring cost in this rig's history, and the reason instruments keep being
re-invented instead of re-run.

## Why skills under-deliver (harness behaviour, not project behaviour)

`docs/skills.md`: *"Pi advertises each available skill by name and description, then loads its full instructions only when
the task calls for them… **A model might fail to load a relevant skill, so use `/skill:name` when you need to force it.**"*
The harness itself documents the failure mode the operator sees. It is amplified here by the model I run on:
`PI_PROVIDER=strata PI_MODEL=iq3_s` — the delegate is on the **same small local model as the seats**. Opt-in surfaces
(skill bodies, 1,300-line roadmaps) are precisely what a small model skips; always-injected surfaces (`AGENTS.md`,
system-prompt additions, the tool list itself) are what it reliably uses.

## Unused project levers

`docs/configuration.md` says project config lives in `.pi/` — `.pi/settings.json`, `.pi/extensions/`, `.pi/skills/`,
`.pi/APPEND_SYSTEM.md`, `.pi/prompts/`, loaded after project trust. **This repo has no `.pi/` directory at all.** Host side:
`~/.pi/agent/skills/` and `~/.agents/skills/` are empty, and installed packages are only `npm:pi-deepinfra` (provider) and
`npm:awesome-pi-themes`. So every lever that could make my instruments *default* rather than *remembered* is unused.

## The transcripts are a durable layer nobody used — and it corrects a recorded finding

Extracting `write`/`edit` tool-call arguments out of the JSONL recovers **full file bodies** (script:
`.scratch/transcript-write-bodies.mjs`, validated on files still on disk):

```
18,985 B  write  tools/channel-preflight.mjs   (session 2026-10-28T19-11)
17,877 B  write  tools/broker-serve.mjs        (session 2026-10-28T14-54)
 6,643 B  write  tools/instrument-provenance.mjs (session 2026-10-28T19-47)
```

So "a delegate-authored file is unrecoverable unless it was committed" — the claim in
`docs/incidents/2026-10-28-cross-os-ledger-pruned-and-untracked-loss.md` and D156 — is **too strong**: the harness keeps the
bodies. Narrowed, still true, and re-verified now: the eight lost instruments have **no** `write` call in any of the 87
sessions' 12,115 Windows-set tool calls, only passing mentions; the Windows `selfdev.sqlite` mentions `worktree-cleanup` (5)
and `verify-sweep` (1) without bodies; `~/.dsh/sessions` has no match. They remain unrecovered — but the *class* of loss is
now recoverable, which is a different statement and should be recorded as such.

## Levers, ranked by certainty (all project-scoped; all need the operator's grant)

1. **`.pi/APPEND_SYSTEM.md` (~10 lines, zero retrieval burden).** The instrument table, the "never run the suite from the
   main checkout until 232 lands" rule, and the six read-only baseline commands — injected into every request, so they
   survive compaction and small-model skipping. This is the highest-certainty fix to the reuse problem.
2. **`.pi/extensions/delegate-instruments.mjs`.** `pi.registerTool()` for the instruments so they appear **in the tool list
   with schemas** instead of living in a file I must remember to read; a `before_agent_start` handler injecting a 3-line
   digest (worktree registrations, suite-membership drift, `queued=0`); and a `tool_call` guard that refuses
   `git worktree prune`, `git clean -fd` and suite runs on the main checkout — the exact verbs that destroyed the 36-row
   ledger. A guard at this layer would have prevented the incident, not just detected it.
3. **Force-load the skills that exist**: `/skill:delegating-to-durian-pi` at session start (the documented remedy), plus the
   description keywords already proposed as Edit A.
4. **`tools/transcript-recovery.mjs`** — promote the `.scratch` extractor, tracked, with a runbook row for the symptom
   "a delegate-written file is gone and was never committed".
5. **A pi package over git** so the Windows host (D131 dual-OS) gets the same skills, `.pi/` and instruments — today the
   two machines share the repo but not the workflow.

## What this audit cost

~35 min end to end, including two dead ends (`.dsh/sessions`, the Windows store bodies). The reusable part is now
**`tools/harness-usage-census.mjs`** (tracked) plus two extractors still in `.scratch/` (`transcript-write-bodies.mjs`,
`transcript-read-bodies.mjs`) — which is itself the argument for levers 1–2: an untracked instrument is a lost one, which is
what ROADMAP 233 says, and this session nearly did it again.

## Consumed 2026-10-28: the study this audit commissioned

The prompt drafted from this file (`docs/reviews/harness-tools-skills-research-prompt.md`) was executed **by the delegate
for the half readable on this machine** — installed pi `@1.4.0` (whose TypeScript is recoverable from the shipped
`.js.map` `sourcesContent`) plus the nine pinned clones: **`docs/reviews/harness-tools-skills-research.md`**. The public
harnesses (Claude Code, Codex CLI, Cursor, Cline, Goose) remain **unexamined** and are routed in
`docs/reviews/harness-tools-skills-followup-research-prompt.md`. Levers 1–5 above became ROADMAP **235–239** (registered,
not scheduled); the sweep rows are in `docs/COMPETITORS.md` §"The 2026-10-28 tool-and-skill lifecycle sweep". Two claims
in this audit were narrowed by the study: lever 3's description budget is measured (768/805 unused chars of pi's 1,024
cap), and lever 1's mechanism is pi's `addendum` section, where the project file **replaces** the user file
(`docs/configuration.md:39`) — a host-level file would be shadowed, which this file did not know.
