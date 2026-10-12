# The durig selfdev team — operator-delegate runbook

Read `docs/NEXT.md` first; this file is the standing reference behind it.

## Who this is for

A **delegate for the operator**: an agent external to the team that does not do seat work. The
three-actor model (operator / delegate / seats) is in `../AGENTS.md`. This runbook is the *durig*
instance of it — the team whose job is building durig itself.

There are two rigs in this workspace. Do not confuse them:

| Rig | What it is | Store | Rig file |
|---|---|---|---|
| **tutor-pi** (OpenRig) | the live product team | `tutor-pi.sqlite` | managed by OpenRig, not this CLI |
| **durig selfdev** | the team that builds durig | `selfdev.sqlite` | `rig.selfdev.json` |

Everything below is the **selfdev** team.

## The team

Nine seats (`node cli.mjs ps`), with the author/reviewer pairs the culture requires:

| Seat | Role | Model | Notes |
|---|---|---|---|
| `pm` | program manager | DeepSeek-V4.1-Flash | intake, decomposition, routing, tracking |
| `impl` | implementation | DeepSeek-V4-Flash-0731 | author for build items |
| `qa` | verifier | Qwen3.6-35B-A3B | independent; different model family from authors |
| `lead` | technical lead | DeepSeek-V4.1-Flash | scope/priority rulings; escalation target |
| `advocate` | workflow/design reviewer | Qwen3.6-35B-A3B | owns `WORKFLOWS.md`, `SELF-ADMIN.md` |
| `scribe` | documentation | DeepSeek-V4-Flash-0731 | keeps `FEATURES.md`/`STATUS.md` true |
| `devtools` | toolchain | DeepSeek-V4.1-Flash | pi pin, `sync-pi.mjs` |
| `auditor` | second verifier | Qwen3.6-35B-A3B | do the tests prove it; edges |
| `designer` | CLI/UX | Qwen3.6-35B-A3B | surface and defaults |

## Running it

The CLI is non-interactive and emits one JSON document per command. Two things must be right: the
**store** (`DURIG_DB`) and the **seat root** (where seats may read and write).

```bash
cd durig
export DURIG_DB=./selfdev.sqlite          # the selfdev store (NOT rig.sqlite)
export DEEPINFRA_API_KEY=...              # real runs need it
node cli.mjs ps                           # seats present?
node cli.mjs status                       # attention + non-terminal work
node cli.mjs queue                        # the backlog
node cli.mjs run                          # drive to quiescence
node cli.mjs run --watch                   # stay resident
node cli.mjs send pm --body-file <file>    # deliver the operator's intent (never inline)
node cli.mjs log impl 30                   # what actually happened
```

**The seat root is not declared in `rig.selfdev.json`.** A seat resolves to the `cwd` of the
`run`/`send` command that wakes it (dogfood F12), so running from `durig/` lets seats edit the live
tree. Isolate first:

```bash
node cli.mjs worktree C:/tmp/durig-dev/<item>       # a checkout; its cwd is <item>/durig
DURIG_SEAT_ROOT=<that>/durig DURIG_DB=./selfdev.sqlite node cli.mjs up rig.selfdev.json --refresh
DURIG_SEAT_ROOT=<that>/durig DURIG_DB=./selfdev.sqlite node cli.mjs run --watch
```

`up --refresh` re-points each seat's persisted `cwd`; the F12 guard fails closed if `DURIG_SEAT_ROOT`
disagrees with what a seat already has, so re-point rather than guessing.

## How to find the next item (do not re-derive it)

Priority is **not** the top of the 1300-line roadmap. It is:

1. `docs/NEXT.md` — the current pointer, refreshed every session.
2. `DURIG_DB=./selfdev.sqlite node cli.mjs queue` — the non-terminal rows
   (`queued`/`claimed`/`deferred`).
3. `node cli.mjs status` → `attention` — what the substrate already flags
   (`queue-ageing`, `admitted_not_started`, `generation_stale`, `deferred_awaiting_answer`).

The join of (1) and (2) is the answer; the roadmap supplies the *why* behind the id. When the queue
and `NEXT.md` disagree, trust the queue and correct `NEXT.md`.

## Known blocker

**#110 (P5): `run` dies on an unresolvable path** — `unresolvable path:
["generation","message","content",0]` from a corrupt `pi.live` document (dogfood F14). While it
dies, no claimed work is re-woken and nothing downstream can progress. Fix #110 first; see
`docs/NEXT.md` and roadmap *"Deadlock and liveness prevention"* P5.

## Clock in / clock out

See `../AGENTS.md`. Short form: read `NEXT.md` → read this file → `git status --short -- .` →
`status` → resume. On exit: update `NEXT.md`, record a durable decision's *why* in `DECISIONS.md`.

## References

- `docs/Agent_Onboarding_Research.md` — why this runbook exists (the cold-start research).
- `docs/DOGFOOD.md` — the findings that created it (F12 seat root, F13 claimed≠held, F14 corruption).
- `docs/ROADMAP.md` — *"Deadlock and liveness prevention"* (P1–P6) and
  *"New-session onboarding for seats"* (O1–O4).
- `.agents/skills/durig/SKILL.md` — driving the CLI.
