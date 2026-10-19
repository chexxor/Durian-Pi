# The durian-pi selfdev team — operator-delegate runbook

Read `docs/NEXT.md` first; this file is the standing reference behind it.

## Who this is for

A **delegate for the operator**: an agent external to the team that does not do seat work. The
three-actor model (operator / delegate / seats) is in `../AGENTS.md`. This runbook is the *durian-pi*
instance of it — the team whose job is building durian-pi itself.

The team in this workspace is the **durian-pi selfdev** team (`selfdev.sqlite`, `rig.selfdev.json`) — the
team that builds durian-pi itself.

## The team

**Twelve seats — and the table below is RE-DERIVED from `rig.selfdev.json`, not remembered.** A model
change is an operator action that lands as a commit (`a5a4d00`, `e4d0222` both moved seats in one day), so
any hand-copied table rots within hours. Verify before relying on it:

```bash
python -c "import json;[print(s['name'], s.get('model')) for s in json.load(open('rig.selfdev.json'))['seats']]"
```

| Seat | Role | Model (live, `rig.selfdev.json`) | Notes |
|---|---|---|---|
| `pm` | program manager | `deepseek-ai/DeepSeek-V4.1-Flash` | intake, decomposition, routing, tracking |
| `impl` | implementation | `deepseek-ai/DeepSeek-V4.1-Flash` | author for build items |
| `qa` | verifier | `local/qwen36` | independent; a DIFFERENT FAMILY from the author seats |
| `qa2` | verifier (2) | `google/gemma-4-31B-it` | second verifier, third family |
| `lead` | technical lead | `deepseek-ai/DeepSeek-V4.1-Flash` | scope/priority rulings; escalation target |
| `architect` | systems architect | `deepseek-ai/DeepSeek-V4.1-Flash` | cross-cutting design, failure modes, durable decisions |
| `advocate` | workflow/design reviewer | `zai-org/GLM-5.3-Flash` | owns `WORKFLOWS.md`, `SELF-ADMIN.md` |
| `scribe` | documentation | `deepseek-ai/DeepSeek-V4-Flash-0731` | keeps `FEATURES.md`/`STATUS.md` true |
| `devtools` | toolchain | `local/qwen36` | pi pin, `sync-pi.mjs` |
| `auditor` | second verifier | `zai-org/GLM-5.3-Flash` | do the tests prove it; edges |
| `designer` | CLI/UX | `zai-org/GLM-5.3-Flash` | surface and defaults |
| `security` | security engineer | `zai-org/GLM-5.3-Flash` | threat models, trust boundaries & secret hygiene; deliberately NOT a verifier (keeps working tools); owns `security-positions` |

## The author/verifier split (state it precisely)

The invariant is that **a verifier must not share a model family with the author of the change it
verifies** — not that any particular two names hold a particular pair of models. Today that reads:

- **authors** are `impl` (DeepSeek-V4.1-Flash) and, for docs/tooling, `scribe` (DeepSeek-V4-Flash-0731) and
  `devtools` (`local/qwen36`);
- **verifiers** are `qa` (`local/qwen36`), `qa2` (gemma), and `auditor` (GLM-5.3-Flash).

So the pairwise requirement holds for the main loop (`impl` vs `qa`: DeepSeek vs local/qwen; `impl` vs
`auditor`: DeepSeek vs GLM; `scribe` vs `auditor`: DeepSeek vs GLM) — **but it does NOT hold everywhere,
and the exception is worth knowing: `devtools` and `qa` are BOTH `local/qwen36`**, so a `devtools`-authored
tooling change verified by `qa` is verified on the author's own family. Route such a verify to `auditor`
(GLM) or `qa2` (gemma) instead. Check the pair, do not trust a slogan: the old "GLM authors vs DeepSeek
verifiers" reading is **FALSE** after the 2026-10-19 model moves and must not be quoted as policy.
`security` stays outside the split by design (`VERIFIER_TERMS` does not match its name, so it keeps
`write`/`edit`/`shell`).

*(2026-10-19: this table previously listed `impl`/`qa`/`devtools` on the old Qwen pair and omitted `qa2`
and `architect` entirely, while claiming "Ten seats" — the docs defect is recorded as a row in
`docs/FEATURES.md` §4 and is why the derivation command is now inline.)*

## Running it

The CLI is non-interactive and emits one JSON document per command. Two things must be right: the
**store** (`DURIAN_PI_DB`) and the **seat root** (where seats may read and write).

```bash
cd durian-pi
export DURIAN_PI_DB=./selfdev.sqlite          # the selfdev store (NOT rig.sqlite)
export DEEPINFRA_API_KEY=...              # real runs need it
node cli.mjs ps                           # seats present?
node cli.mjs status                       # attention + non-terminal work
node cli.mjs queue                        # the backlog
node cli.mjs run                          # drive to quiescence
node cli.mjs run --watch                   # stay resident
node intent.mjs pm --body-file <file>  # deliver operator intent via the spool (the broker delivers; never inline)
node cli.mjs log impl 30                   # what actually happened
```

**The store and the rig must be passed as a PAIR — `selfdev.sqlite` + `rig.selfdev.json`.** The repo
also holds `rig.json`, and `cli.mjs check` **defaults to `rig.json`**, so a bare `check` pairs the selfdev
store with the wrong rig and reports seat-shape findings (`store-missing-seat`, `stray-seat`,
`no-verifier-seat`, `single-model-rig`, `seat-without-capabilities`) that describe a rig nobody runs.
Always name the rig: `DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json`. A `check` verdict
without an explicit rig is not evidence about this rig.

**The seat root is not declared in `rig.selfdev.json`.** A seat resolves to the `cwd` of the
write-side command that wakes it (dogfood F12), so running from `durian-pi/` lets seats edit the live
tree. Isolate first:

```bash
node cli.mjs worktree C:/tmp/durian-pi-dev/<item>       # a checkout; its cwd is <item>/durian-pi
DURIAN_PI_SEAT_ROOT=<that>/durian-pi DURIAN_PI_DB=./selfdev.sqlite node cli.mjs up rig.selfdev.json --refresh
DURIAN_PI_SEAT_ROOT=<that>/durian-pi DURIAN_PI_DB=./selfdev.sqlite node cli.mjs run --watch
```

`up --refresh` re-points each seat's persisted `cwd`; the F12 guard fails closed if `DURIAN_PI_SEAT_ROOT`
disagrees with what a seat already has, so re-point rather than guessing.

## How to find the next item (do not re-derive it)

Priority is **not** the top of the 1300-line roadmap. It is:

1. `docs/NEXT.md` — the current pointer, refreshed every session.
2. `DURIAN_PI_DB=./selfdev.sqlite node cli.mjs queue` — the non-terminal rows
   (`queued`/`claimed`/`deferred`).
3. `node cli.mjs status` → `attention` — what the substrate already flags
   (`queue-ageing`, `admitted_not_started`, `generation_stale`, `deferred_awaiting_answer`).
4. `docs/WORK-ITEM-LIFECYCLE.md` — when the next item is **blocked or parked**: the queue's states and
   transitions, what wakes a seat (and what does not), and the read-only audit that finds `held` rows
   whose gates already cleared. Procedure: `docs/runbooks/stale-held-backlog.md`.

The join of (1) and (2) is the answer; the roadmap supplies the *why* behind the id. When the queue
and `NEXT.md` disagree, trust the queue and correct `NEXT.md`.

## Known blocker

**#110 (P5): `run` dies on an unresolvable path** — `unresolvable path:
["generation","message","content",0]` from a corrupt `pi.live` document (dogfood F14). While it
dies, no claimed work is re-woken and nothing downstream can progress. Fix #110 first; see
`docs/NEXT.md` and roadmap *"Deadlock and liveness prevention"* P5.

## Operational pitfalls (learned driving the team, 2026-10-13)

- **Do not poll or wait on a background seat run; the operator notifies you when it completes.**
  Dispatch a heavy write as a backgrounded `run` (or spool a message via `intent.mjs` and read the
  reply from `log`/`status`), note the pid and the output file, and continue with read-only
  work or hand back. Long bounded `sleep`/`tasklist` monitor loops waste the session and were
explicitly retired by the operator (2026-10-15). When the operator says a run is done, read its
  `.out` (the JSON `settledStatus`) and the queue row, then take the next step.

- **Two CLI *drivers* on one store is the anti-pattern — not concurrency itself.** The
  store/harness is single-writer: two write-side processes collided on an entry id
  (`ID n already belongs to entry`) and one message was *silently dropped* (dogfood F24).
  The write path retries (#310, D42), but `up`/`run` are not covered, and two drivers
  double-wake (D45). This is why writes go through the broker spool (`intent.mjs`) while the
  broker drives. This is a *store* rule, not a *files* rule: per-task worktrees let
  different seats edit concurrently, and `genlock` already leases N cross-process
  generation slots (`DURIAN_PI_MAX_CONCURRENT_SEATS`). The sanctioned concurrency is **one
  broker (`serve`) owning the store and driving up to N seats**, each in its own
  worktree; for genuinely independent drivers, use separate databases.
- **A write-side process killed by the harness tool cap strands the seat.** Recover with
  `node cli.mjs resume`; avoid long-lived backgrounded writes — drive heavy work as short
  `run --max-duration` chunks, or spool a message via `intent.mjs` (dogfood F19, #252).
- **A seat can degenerate into a repetition loop** (pseudo tool-calls emitted as
  text) and leave a claimed item stalled. `resume` finds nothing (the run ended);
  recover with `node cli.mjs reset <seat> <handoff>`, then re-drive (dogfood F29,
  #275). Re-drive immediately if a run's reply ends in malformed `<tool calls>` text.
- **An isolated worktree forks from HEAD.** The operator's *uncommitted* work is
  invisible to seats and can be silently clobbered (dogfood F23). `worktree` now
  refuses a dirty source (#255, D43); commit before forking.
- **Coordinators (`pm`, `lead`) cannot read or write files** (B1 gap, #156). Route
  any doc/file task to a file-capable seat (`impl`, `scribe`, `devtools`); a
  coordinator asked to edit a file will (correctly) refuse rather than fabricate.
- **Operator priority cannot be expressed by oldest-first claiming.** Use
  `claim_work({ itemId })` (claim-by-id, #239) to claim a specific item; otherwise
  START-NOW work spooled via `intent.mjs` still stays `queued` (dogfood F18/F20).
- **A seat's worktree is not the live tree.** `ps`/`status` now show each seat's
  `root` (#261) — read it before trusting a "live" claim (dogfood F21).
- **Never mutate the shared working tree.** The tree holds other seats' and the operator's
  uncommitted work; running `git stash`, `git reset`, `git checkout --`, `git restore`,
  or `git clean` destroys work that may not be recoverable. For failing-first verification,
  run the test RED BEFORE the code change (order of operations), or use a throwaway detached
  worktree / temp copy (see `docs/failing-first-recipe.md`).
- **When `edit` misses, re-read the exact region — do not shell-edit source.** The
  tool requires an exact match including newlines, and `src/rig.mjs` is CRLF-only, so
  an LF `oldText` never matches; a seat that then patches with PowerShell/Python makes
  it worse (dogfood F32). Re-read the region with `read`, then retry the edit.
- **Never let a `pi-durable` doc proxy escape `api.commit`.** Read the plain fields
  inside the callback; a returned proxy throws `Cannot use a settled overlay` once the
  commit settles (dogfood F33; `claim_work` documents the pattern).
- **Keep the seat root clean.** Scratch patchers (`fix_peek.py`), dump files, and
  `peek_block.txt` left in the tree pollute the diff and the operator's integration
  (observed on F32). Write scratch under `.spike/` and remove it, or use a temp dir.
- **Scan docs for stray control bytes before a write-through lands.** A shell-escape write
  can drop a control character where a letter belonged (a `0x07` BEL / `0x08` BS replacing the
  leading letter of a word) — found in `docs/DECISIONS.md` where "add"/"apply"/"attention"/
  "branch" had arrived as `0x07`/`0x08`+`dd`/`pply`/`ttention`/`ranch`. Before committing a docs
  edit made through a shell, scan the touched region for stray control bytes (0x01–0x08,
  0x0B–0x1F; 0x0A/0x0D are line endings and are fine) so a stray byte is caught rather than
  committed. Prefer writing docs through the `write`/`edit` tools over a shell heredoc or
  `Add-Content` that can interpolate control characters.

## Docs ownership: who writes which documentation

Documentation is written by **whoever has the most knowledge of the topic**, not by a single
docs role:

- **Developer / implementation docs** (a feature's design rationale, a module's behaviour) are
  written by the seat that did the work — **`impl`**.
- **Project management and project-ownership docs** (roadmap, priorities, what is in/out of
  scope, coordination records) are written by **`pm`**.
- **Quality-assurance and architecture-level docs** (how verification proves a change, why the
  architecture is shaped the way it is) are written by **`qa`** and **`lead`**.
- **Security positions** (threat models, trust boundaries, secret hygiene — `docs/reviews/security-*.md`)
  are written by the seat that owns them — **`security`** (ownership class `security-positions`).

**The `scribe` seat's scope** is narrower and downstream of that:

- Manages the **project-level** surfaces — `docs/FEATURES.md`, `docs/STATUS.md` and the README —
  keeping them true to what the code and tests actually do.
- **Audits, edits and contributes to** the developer docs above (correcting claims that no
  longer match the code), but does not *replace* the owning seat's authorship.
- Is responsible for **delegating and pushing for** the docs other seats should create and own:
  when a seat's change ships without the doc its topic warrants, the scribe routes the doc item
  back to the owning seat (or records the gap) rather than silently writing it on theirs.

Anyone may write a doc another seat owns, but the owner is accountable for keeping it true; the
scribe keeps the project-level truth and chases the owner for what is missing.

## Clock in / clock out

See `../AGENTS.md`. Short form: read `NEXT.md` → read this file → `git status --short -- .` →
`status` → resume. On exit: update `NEXT.md`, record a durable decision's *why* in `DECISIONS.md`.

## Research escalations

The operator has a **specialized research agent** that can be handed initial-research tasks manually.
When a seat (or the delegate) needs background research to do its work — competitor surveys, prior
art, API/library behaviour — ask the operator to route the research question to that agent rather
than spending seat turns guessing. Record what comes back as a doc and cite it in the item that
needed it. (Operator note, 2026-10-15.)

## References

- **`docs/WORK-ITEM-LIFECYCLE.md`** — the queue's states and transitions, who may move an item, what
  wakes a seat, and the stuck taxonomy; read it before touching a parked/held item (procedure:
  `docs/runbooks/stale-held-backlog.md`).
- **`docs/BRANCH-AND-WORKTREE-LIFECYCLE.md`** — the model behind a landing or pruning pass: refs,
  worktrees, the three landing gates and which source is authoritative for each, the prune paths, and
  the suite-verdict traps. Read it before `land.md` / `branch-cleanup.md` / `leaked-worktrees.md`.
- `docs/Agent_Onboarding_Research.md` — why this runbook exists (the cold-start research).
- `docs/DOGFOOD.md` — the findings that created it (F12 seat root, F13 claimed≠held, F14 corruption).
- `docs/ROADMAP.md` — *"Deadlock and liveness prevention"* (P1–P6) and
  *"New-session onboarding for seats"* (O1–O4).
- `.agents/skills/driving-durian-pi/SKILL.md` — driving the CLI.
- `docs/runbooks/` — operating procedures (broker down/stall, safe spec change, store recovery, seat
  reset, leaked worktrees, the pre-written daemon runbook, and how to commission research). Read the
  matching runbook before improvising a recovery; the set is largely **unverified** until ROADMAP item
  85 runs its `Diagnose` blocks.
