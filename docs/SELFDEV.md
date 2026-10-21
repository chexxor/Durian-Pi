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
| `pm` | program manager | `deepseek-ai/DeepSeek-V4.1-Flash-1017` | intake, decomposition, routing, tracking |
| `impl` | implementation | `deepseek-ai/DeepSeek-V4.1-Flash-1017` | author for build items |
| `qa` | verifier | `zai-org/GLM-5.3-Flash` | independent; a DIFFERENT FAMILY from the author seats (GLM, not DeepSeek); shares a model with `auditor`, so `qa2` is the distinct third family |
| `qa2` | verifier (2) | `google/gemma-4-31B-it` | second verifier, third family |
| `lead` | technical lead | `deepseek-ai/DeepSeek-V4.1-Flash-1017` | scope/priority rulings; escalation target |
| `architect` | systems architect | `deepseek-ai/DeepSeek-V4.1-Flash-1017` | cross-cutting design, failure modes, durable decisions |
| `advocate` | workflow/design reviewer | `zai-org/GLM-5.3-Flash` | owns `WORKFLOWS.md`, `SELF-ADMIN.md` |
| `scribe` | documentation | `deepseek-ai/DeepSeek-V4-Flash-0731` | keeps `FEATURES.md`/`STATUS.md` true |
| `devtools` | toolchain | `deepseek-ai/DeepSeek-V4.1-Flash` | pi pin, `sync-pi.mjs` |
| `auditor` | second verifier | `zai-org/GLM-5.3-Flash` | do the tests prove it; edges |
| `designer` | CLI/UX | `zai-org/GLM-5.3-Flash` | surface and defaults |
| `security` | security engineer | `zai-org/GLM-5.3-Flash` | threat models, trust boundaries & secret hygiene; deliberately NOT a verifier (keeps working tools); owns `security-positions` |

## The author/verifier split (state it precisely)

The invariant is that **a verifier must not share a model family with the author of the change it
verifies** — not that any particular two names hold a particular pair of models. Today that reads:

- **authors** are `impl` (DeepSeek-V4.1-Flash-1017) and, for docs/tooling, `scribe` (DeepSeek-V4-Flash-0731) and
  `devtools` (`deepseek-ai/DeepSeek-V4.1-Flash`);
- **verifiers** are `qa` (GLM-5.3-Flash), `qa2` (gemma), and `auditor` (GLM-5.3-Flash).

So the pairwise requirement holds for the main loop (`impl` vs `qa`: DeepSeek vs GLM; `impl` vs
`auditor`: DeepSeek vs GLM; `scribe` vs `auditor`: DeepSeek vs GLM) — **but it does NOT hold everywhere,
and the exception is worth knowing: `qa2` (gemma) is the only verifier that differs from BOTH the DeepSeek
authors and the GLM pair (`qa`, `auditor`), so a `qa`- or `auditor`-authored check verified by `qa2` stays
cross-family.** Check the pair, do not trust a slogan: the old "GLM authors vs DeepSeek verifiers" reading
is **FALSE** after the 2026-10-19 model moves and must not be quoted as policy. **Since 2026-10-20 the
local provider is DOWN by operator direction** — `devtools` is back on the DeepInfra model it held before
the local move, and a `devtools`-authored tooling change verified by `qa` is DeepSeek vs GLM, i.e.
cross-family again (the shared-family exception above was a property of the local era, not a standing
rule). *(2026-10-21: `qa` moved `Qwen/Qwen3.6-35B-A3B` → `zai-org/GLM-5.3-Flash` for cost; `qa` and
`auditor` now share a model, so `qa2` is the only distinct verifier family.)*
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

## Operational pitfalls (learned driving the team, 2026-10-20)

Each of these cost real turns this session; they are habits, not trivia.

- **`queue`/`status` output is NOT pure JSON.** The CLI appends a trailing
  `note: N measure(s) out of band — see: node cli.mjs metrics` line, so `json.load(sys.stdin)` dies with
  `Extra data: line N column 1`. Redirect to a file and use `json.JSONDecoder().raw_decode`, or drop the
  last line. **Do not conclude the store is corrupt** — the JSON above it is fine.
- **`loadConfig()` does not return the config.** It returns `{config, source, defaultsSource}`; the effective
  values are under **`.config`**. Reading it as the config yields `undefined` for every key, which makes an
  ENABLED feature look disabled (this produced a wrong "the local provider is off" conclusion, briefly).
- **Git Bash mangles Windows-native flags and paths.** `robocopy <src> <dst> /MOVE` arrives as
  `C:/Program Files/Git/MOVE` (invalid), and `"...\$var"` yields a literal `$var` instead of expanding.
  Wrap native tools: `cmd //c "robocopy <src> <dst> /MOVE /E …"`, and never put `\` immediately before
  `$` inside double quotes.
- **Python's `open`/`json.dump` default to cp1252 on Windows — and that silently corrupts repo files.**
  A round-trip turned the em-dashes in `rig.selfdev.json`'s seat instructions into `\u00e2\u20ac\u201d`
  (double-encoded). Always `io.open(path, encoding="utf-8", newline="")` plus `ensure_ascii=False`, and
  **check the diff is 2 lines, not the whole file** — whole-file churn is the visible symptom. Prefer a
  byte-level replace of just the strings you mean to change over a JSON round-trip.
- **A hidden process has no window — say where its output goes.** Launching an installer or a model server
  with `-WindowStyle Hidden` keeps the session clean, but then the operator cannot see progress and
  "I don't see it running" is the *correct* reading of an empty screen. Name the log path in the same
  breath (`…/swift-setup.out`), and give them a one-liner: `Get-Content <log> -Tail 5 -Wait`.
- **A seat's model is read from `rig.selfdev.json` at wake (`cli.mjs:481`), not persisted per conversation.**
  A model change therefore needs **no `up --refresh`** — the next run picks it up. `up --refresh` re-points
  cwds; do not run it (a writing verb) while the broker drives, just to make a model change take effect.
- **Check the machine before blaming the rig.** Swift 1.5 IQ2_XS holds **~22 GB of experts in RAM** on this
  32 GB box (PolyStrata wants ~48 GB RAM+VRAM, so it runs in low-RAM mode). With ~1 GB free, forks fail
  (`cygheap read copy failed`, `Resource temporarily unavailable`) and *every* tool call looks broken.
  Measure: `GlobalMemoryStatusEx` in one python call; prefer one process per invocation.
- **A WEDGED broker and a STARVED broker look identical** (alive, fresh heartbeat, no pass, no genlock, empty
  log). Discriminator: stop the heavy local model and wait one pass — passes resume ⇒ starvation; nothing ⇒
  wedge (`runbooks/broker-down-or-stalled.md`). Get this right before writing a root cause; 2026-10-20 I
  nearly reported starvation as the cause after the model restart had already cleared it.

## Operational pitfalls (learned driving the team, 2026-10-20, second block)

- **A model change you only made in `rig.selfdev.json` changes nothing in the STORE.** The rig file is read
  at wake, but the queue, the recorded reset and every seat's context still describe the old model until
  `up rig.selfdev.json --refresh` writes them; `--dry-run` first names the exact resets (`resetEntryId`
  proves the write landed). Do not report a model move as done on the strength of the file diff.
- **`serve --stop` is a REQUEST, not a kill.** It returns `stopped:false` while a generation lease exists,
  and a stale stop request survives a forced kill — the restarted broker then exits after ONE pass with
  `"stoppedBy": "deadline"`. That is a consumed request, not a crash: start it again. Full recovery order
  (kill → prove pid dead → clear `*.genlock.*` → restart → confirm passes advance and
  `admitted_not_started` clears) is in `runbooks/broker-safe-change.md`.
- **Back up the store before any force stop.** `cp selfdev.sqlite .spike/store-backup-$(date +%Y%m%d-%H%M%S).sqlite`
  costs a second and is the only insurance against the outcome a restart cannot fix.
- **A `log <seat>` read can time out while the broker drives** (`SqliteStorage is closed` /
  `read seats: apply failed`). That is store contention, not corruption and not a dead seat: read
  `<db>.broker.log` (a plain file) for liveness, and retry the store read between passes.
- **Judge a model by its OUTPUT SHAPE, not its HTTP status.** `Qwen/Qwen3.6-35B-A3B` (the `qa` model)
  returns an EMPTY `content` at `max_tokens: 16` because its reasoning eats the budget, and leaks reasoning
  text into `content` at 512. A 16-token smoke test reads as "model broken"; it is not. Give a reasoning
  model room to finish before concluding a resolution failure.

## Local-model capacity: what a RAM upgrade does and does not buy (measured 2026-10-20)

Useful when the operator asks "can every seat run on the local model, and what does concurrency cost?".
Numbers below are OBSERVED on this box unless marked as an estimate.

| Item | Value | Source |
|---|---|---|
| This PC | 31.9 GB RAM, RTX 3090 24 GB VRAM, 16 logical CPUs | `Win32_ComputerSystem`, `nvidia-smi` |
| Swift 1.5 IQ2_XS weights on disk | **64.1 GB** (2 shards: 39.8 + 28.4 GB); packed experts **35.4 GB** | pack `experts.bin.src.json` |
| Older local pack (Qwen3.6-35B-A3B UD-Q3_K_M) | 16 GB | `PolyStrata-data/models/` |
| KV cache (8-bit, KV streaming) | **~13.7 KB of RAM per context token → ~0.9 GB per 64K conversation** | PolyStrata `docs/DETAILS.md` |
| Served concurrency, default | **ONE request at a time**, FIFO — every other seat queues | `serve/server.py:7`, `docs/BATCHING.md` |
| Served concurrency, opt-in | `"parallel": N` / `--batch N`, **up to 8 slots**; each slot has its own position and attention rows | `docs/BATCHING.md` |

**So: 96 GB is enough memory for the weights and several 64K contexts** (≈64 GB weights + 12 × 0.9 GB KV +
node/OS ≈ 76 GB) — but memory is not the binding constraint on CONCURRENCY. Two others are:

1. **The server serializes unless `"parallel": N` is set in `strata-swift-iq2_xs.json`.** Without it every
   seat waits its turn no matter how much RAM you buy; with it the engine caps at 8 slots, so 12 seats still
   queue above 8.
2. **The 3090's 24 GB VRAM is unchanged by a RAM upgrade,** and each batch slot's attention rows come out of
   the expert cache. A 64 GB model on a 24 GB card keeps most experts in RAM, so more concurrency competes
   for the same memory bandwidth.

**The price of concurrency, mechanically** (PolyStrata `docs/BATCHING.md`): a request alone keeps its
speculative/MTP guesses; as soon as a second request shares a window, **all slots write "a token each at a
time, without guesses"**. Measured on other cards, total throughput rises while per-request latency falls —
e.g. 1→4 chats at once: 312–333 → 428–430 tok/s total on an RTX 5090, and 79 (sequential) → 105 total on a
laptop. So N concurrent seats each get *materially less* than a single seat's rate, while the team's
aggregate rate improves modestly. With 12 seats on one 3090 expect aggregate tok/s to plateau well before
12× a single-seat rate.

### Which local model, if concurrency is the goal (PolyStrata inventory, read 2026-10-20)

The bar is VRAM, not RAM: **the batch slots come out of the room the experts would have** (PolyStrata
`docs/BATCHING.md`, `docs/QWEN36.md`). So the model that scales is the SMALLEST one whose experts still all
fit in the card, not the largest one the RAM can hold.

| Model (PolyStrata) | Weights | Engine / Windows | Slot cost | Why it matters here |
|---|---|---|---|---|
| Qwen3.6-35B-A3B UD-Q3_K_M | 16 GB (**already installed**) | `strata`/`strata-poly`, Windows | 45 KB/token fp32 → **1.5 GB per 32K slot**, 3.0 GB per 64K | leaves ~7 GB on a 3090 → 2–4 slots at 32K with the expert cache still full |
| Tiel Coder 35B-A3B UD-Q3_K_XL | 13.6–17.2 GB | `strata-poly`, Windows | same arch/slot maths | Ornith 1.5 tuned for coding agents, MTP draft block |
| Gemma 4 26B-A4B UD-Q3_K_M | 10.5–16.9 GB | `strata-poly`, Windows | 26B-A4B, less expert pressure | most VRAM headroom → most slots; tool calls in OpenAI's shape |
| LFM2.5-24B-A2B | 11–25 GB | `strata-poly` | **30 of 40 layers have no attention** → 128K costs only ~2 GB more than 32K | cheapest long-context slots; licence: commercial use only under $10M/yr revenue |
| Swift 1.5 IQ2_XS (the model we just took down) | 64 GB | `strata` | 13.7 KB/token host KV | experts can NOT fit 24 GB → concurrency buys little |
| GLM 5.3 Flash / DeepSeek V4 Flash | 79–114 / 91 GB | Linux only | large | ~50% experts from VRAM even on a 32 GB card; slots steal expert room |

**Measured scaling, by whether the experts fit** (PolyStrata's own numbers):
- R9700 32 GB, **every expert in VRAM**, `--batch 8`: 1→8 requests = **83.9 → 325.4 tok/s aggregate** (3.9×).
- RTX 3060 12 GB hybrid, 8K: 2/4/8 slots = 0.99×/**1.15×**/1.10× aggregate.
- RTX A4000 16 GB, 32K: 4 slots = **0.76×** — concurrency LOST throughput because each slot took 1.5 GB
  from the expert room. **This is the failure mode to avoid on a 24 GB card.**
- Single-request write speed with experts in VRAM: Qwen3.6 323 tok/s, Gemma 4 276, Ornith 264 (32K, benchmark).

**Measured on THIS box, from the engine's own log (`strata-swift-iq2_xs.log`) — the evidence that the
64 GB Swift model, not durig, was the RAM consumer:**
`strata serve: resident RAM: 19.52 GiB of experts in RAM` with `479,244 MB read from the file` since start
on a **31.9 GB** machine. So the engine alone held ~61% of RAM, and half a terabyte of expert traffic came
off the disk because the 24 GB card holds only a fraction of a 64 GB model. **That is what a RAM upgrade
buys: a higher resident-expert share and less disk traffic for THAT model — not concurrency.** PolyStrata
documents no quality benchmark at all (its tables are speed only), so any "model A reasons better than
model B" statement is UNVERIFIED here; the only quality signal in its docs is FAQ's Q3-vs-Q4 note ("take
Q4 if you have the memory", speeds within ~10% once the card holds the model). Windows support, per
`docs/FAQ.md`: Qwen3.6, Ornith 1.5, Gemma 4, Tiel Coder and Qwen3.8-Flash-Next — **LFM2.5 and MiniCPM-V are
NOT in that list**; GLM is Linux-only.

**Practical recipe on a 3090 (24 GB) + any amount of RAM:** pick a ≤17 GB quant of a 35B-A3B-class model, keep
`--max-context` at 32768 (64K halves the slot count), set `"parallel": N` with N chosen so
`N × slot GB < free VRAM` (2–3 at 64K, 3–4 at 32K for Q3_K_M), and cap durig with
`DURIG_MAX_CONCURRENT_SEATS` at that same N so seats queue in durig rather than inside the model. The engine
maxes at 8 slots, so 12 seats still queue above 8.

### Adding a second GPU on a narrow slot: what the evidence does and does not say (2026-10-20)

Operator hardware question: a Tesla P40 (24 GB, PCIe **3.0** x16) in an X570 board's **PCIe 4.0 x4** slot
beside an RTX 3090. Grounded answers from the PolyStrata tree (which is the authority for the engine, not
this doc):

- **The link is the SMALL problem.** Layer split is *pipeline* parallelism: "a token crosses from one card
  to the next **once per verify window** (a few hundred KB through pinned RAM), not twice per layer… cards
  on x4 or x1 slots work, and the PCIe share of each card is probed on its own link" (`docs/MULTI_GPU.md`).
  MEASURED on the closest rig in the docs — 2× RTX 3090, **GPU0 x16 + GPU1 x4**, IQ3_S: decode **137 tok/s**,
  prefill **1,798 tok/s** (`docs/MULTI_GPU.md`, community report #1447). So a 4-lane second card still pulls
  its weight.
- **The tuning penalty is real but bounded:** on x16 + x4 the auto placement can mis-place by pricing the
  narrow link's expert misses too high (2× 3090: K=31 at miss-cost ×4.20 gave **114–119 tok/s** against
  **130–136** at K=27, #2418) — ~12%, and `STRATA_SPLIT_UNIFORM=1` (with `"gpu_order": "as_given"`) or a
  manual `"layer_split"` fixes it. Symptoms are flat prefill across prompt lengths (an idle card) and a
  decode below what the layer sweep says.
- **The P40's real cost is the ARCHITECTURE, not the slot.** Pascal is compute capability 6.1, and
  PolyStrata needs 7.5: a P40 runs only on the **experimental CUDA 12 engine** (`engine-cuda12\`, opt-in via
  `--gpus`/`--cuda 12`), and **the engine is chosen per model by the OLDEST card** — so pairing it with a
  3090 moves the WHOLE model, including the 3090's layers, off the ready-made CUDA 13 engine. Measured
  single P40, IQ3_S: decode **30–33 tok/s** (0.1.30), **37–38** after the sm_61 changes; prompt 217–374
  tok/s. Vertical: 2× P40 layer split, IQ3_S 131K ctx: decode **35.0 tok/s** (19.6 on one card for IQ2_XS).
- **What this predicts for 3090 + P40:** in a pipeline split the steady-state rate is set by the slowest
  stage, and `auto` does price unequal stages (measured on 2× A4000 made unequal: the new rule chose K=20 and
  decode went 50.2 → 65.9 tok/s). So give the P40 FEWER layers than half, or the P40 stage throttles the
  3090. **UNVERIFIED:** nothing in the repo benchmarks a mixed 3090 + P40 pair, and nothing benchmarks a P40
  in an x4 slot. Treat the ~35–38 tok/s P40 figure as the ceiling for any split it takes an equal share of.
- **Non-PCIe gotchas to check before buying** (board/firmware, not PolyStrata): Above-4G decoding /
  Resizable BAR in BIOS, a 250 W EPS-8pin feed, **passive cooling** (server card — needs a fan shroud in a
  desktop case), no display output, and on most X570 boards the second x16-length slot is x4 from the
  CHIPSET, sharing its 4.0 x4 uplink with M.2/SATA/USB traffic.

### A second RTX 3090 in the x4 slot: what the numbers say (2026-10-20)

Answered from the PolyStrata tree; **no measurement exists for the x16-vs-x4 difference in isolation**, so
the two kinds of evidence are quoted separately rather than blended.

**One card vs two, same model (both cards on x16, 32K context, engine 0.1.26, medians of 3)** —
`bench/results/2026-09-29-rtx3090-epyc-milan/matrix.md`:

| | 1× 3090 | 2× 3090 auto | 2× 3090 best K | Δ decode |
|---|---:|---:|---:|---:|
| Coder IQ1_M, decode tok/s | **66.8** | 98.6 (K=19) | 103.3 (K=22) | **+48% … +55%** |
| Coder IQ1_M, prompt tok/s | 2,502 | 2,704 | — | +8% |
| IQ3_XXS, decode tok/s | 90.6 | 96.7 (K=24) | — | +7% |
| IQ3_XXS, prompt tok/s | **2,160** | **1,159** | — | **−46%** |

So a second card **often raises decode ~50% but does not reliably raise prefill — it can halve it.** Buy it for
decode and VRAM, never for prompt speed. (Those runs say in their own limits section: "Verify PCIe
generation/width under sustained load before claiming a direct x16-vs-x4 comparison.")

**The only x16 + x4 datapoint in the tree** (`docs/MULTI_GPU.md`, community #1447, 2× 3090, GPU0 PCIe 4.0
x16 + GPU1 x4, IQ3_S, `--resident-experts`, later engine): decode **137 tok/s**, prefill **1,798 tok/s** —
comfortably above the x16+x16 IQ3_S numbers above, though engine version, CPU and settings differ, so this
is suggestive, not a controlled comparison. The mechanism is documented: layer split moves "a few hundred
KB per verify window", so **the 4-lane link is not the bottleneck** for split traffic.

**Where the x4 gap DOES show up:**
- **Placement tax.** On x16 + x4 the `auto` split can mis-price the narrow link (2× 3090 measured 114–119
  tok/s at K=31 vs 130–136 at K=27, #2418) — ~12%, fixed by `STRATA_SPLIT_UNIFORM=1` (`"gpu_order":
  "as_given"`) or a manual `"layer_split"`.
- **Expert PCIe copies.** Link-miss scaling from the 4× gap makes the narrow card's missed-expert copies
  dearer; the engine probes each link and lowers that card's `--pcie-frac`, so more expert work lands on the
  CPU pool. Visible as lower decode on the narrow card's layer range, not as an error.
- **Chipset sharing.** On most X570 boards the second slot is x4 from the chipset, sharing its 4.0 x4 uplink
  with M.2/SATA/USB — a busy Gen4 NVMe competes.

**Decision rule that matters more than the slot:** "More cards pay off when the model's routed experts do
not fit the faster ones." A 16 GB Qwen3.6 Q3 fits ONE 3090 with room for slots, so a second 3090 adds almost
nothing for the concurrency-optimal model. It pays for the 64 GB Swift IQ2_XS (where one card holds a
fraction of the experts) — i.e. the second card buys the BIG model, not more concurrency.

### Two PolyStrata instances for twice the concurrency? (checked 2026-10-20 — no)

The idea fails three times over, each for a checkable reason:

1. **durig can only reach ONE local endpoint.** `src/providers/local.mjs` registers a single provider
   (`localProviderSpec` returns one `baseUrl` + one `modelId`, and its header says "durig builds exactly
   ONE provider per process, so every seat shares it"), and `src/seatmodel.mjs` resolves `local/<id>` to
   `provider:"local", modelId:"<id>"` — the id is sent to THAT baseUrl. A second instance on port 8081 is
   unreachable from the rig without a code change (a second provider id or a per-seat base URL).
2. **On one 3090 the two instances split the same 24 GB.** Each engine gets half the expert cache, so more
   experts fall back to CPU/disk and the GPU time-slices. PolyStrata's own docs anticipate exactly this:
   `POST /unload?wait=1` exists "so a second server can really free the card", and `before_load` is
   documented as "a command run before the model is loaded again, e.g. one that unloads another server's
   model" — i.e. two servers on one card TAKE TURNS, they do not run together.
3. **The supported way to widen concurrency is `"parallel": N` on ONE server.** PolyStrata's FAQ
   ("Can several people use one server at once?"): with `"parallel"` "it answers up to N together, with
   every model. On a card that holds most of the model's experts that writes more tokens a second in all:
   on an RTX 5090 four Qwen3.6 chats at once came at **428 tokens/s together, one alone at 312 to 333**".
   The engine caps at 8 slots.

On TWO cards two instances CAN be legitimate — but for different reasons than concurrency: one instance
with a layer split gives ONE model roughly twice the expert cache (see above), while two instances give you
two independent models (say a coder and a verifier) at one card each. That is a choice about models, not
about doubling slots, and durig cannot drive it from one rig today. Two engines also mean two copies of the
weights in RAM: fine for a 16 GB model, impossible for the 64 GB Swift model at 96 GB.

### What the DeepInfra bill says the local rig must do (usage file 2026-10, read 2026-10-20)

`deepinfra-usage-2026-10.csv`, 2026-10-01..2026-10-20 (19 days), $139.22 total, 8 models. The shape of the
load matters more than the total:

| Model | Cost | cached in | fresh in | out |
|---|---:|---:|---:|---:|
| **deepseek-ai/DeepSeek-V4.1-Flash** | **$60.83** | **7.307 B** | 119.9 M | 31.8 M |
| zai-org/GLM-5.3-Flash | $25.23 | 1.084 B | 107.3 M | 3.73 M |
| Qwen/Qwen3.6-35B-A3B | $25.16 | — | 246.4 M | 0.55 M |
| deepseek-ai/DeepSeek-V4-Flash-0731 | $24.07 | 1.099 B | 114.7 M | 3.80 M |
| deepseek-ai/DeepSeek-V4.1-Flash-1017 | $2.67 | 0.460 B | 8.4 M | 1.70 M |

**Per day for the seat we want to replace: ~385 M cached-in, ~6.3 M fresh-in, ~1.7 M output.** Two
consequences, both the opposite of intuition:

1. **Output is trivial; PREFILL is the workload.** 1.7 M output tokens/day is nothing (at 60 tok/s that is
   ~8 h of decode). The 385 M cached input tokens/day are the cost centre — and DeepInfra charges $0.004/M
   for them, i.e. nearly free, whereas a local server must either re-read them or serve them from its
   conversation cache. At a measured 1,800 tok/s prefill (the big Swift/Qwen3.8 model) 385 M/day is **59
   hours a day** — impossible. At 8,000 tok/s it is 13 h/day — feasible only with a high cache hit rate.
   **Any local plan must budget the conversation cache (`--conversation-cache-mib`/`-slots`) as a first-class
   part of the configuration, not an afterthought.**
2. **A layer split only speeds prefill when every expert is in VRAM.** `docs/MULTI_GPU.md` on the
   strata-poly models: "A longer prompt with experts outside VRAM is read a layer at a time for all its
   calls… the cards take turns… **So with no expert in VRAM two cards read a long prompt no faster than
   one.** What a split adds there is VRAM." On a 2×3090 rig that decides the model choice: a ~21 GB model
   fits both cards' 48 GB and gets the split's prefill gain; a 64–75 GB model does not, and its prefill
   stays single-card speed.

**SUPERSEDED ON QUALITY — read the BenchLM section below before acting on this table.** The speeds
stand; the model CHOICE here was made without benchmarks and is wrong for authoring seats.

**Ranked configurations for 2–4 concurrent seats (highest aggregate tokens/s first).** Measured points:
Qwen3.6-35B-A3B with every expert in VRAM writes **323 tok/s** alone and **83.9 → 173.5 → 252.0 → 325.4
tok/s** at 1/2/4/8 slots (R9700, Q4_K_XL); slot cost **1.5 GB per 32K** (3.0 GB per 64K) of VRAM;
prefill 4–5.8 k tok/s single-card. Estimates are marked.

| Config | Model | Slots @ context | Expected aggregate | Notes |
|---|---|---|---|---|
| **2×3090 + 64–96 GB RAM** | Qwen3.6-35B-A3B **UD-Q4_K_XL** (~21 GB) | 4 @ 32K (6 GB KV spread over 2 cards) | **~250–350 tok/s** (measured band for 4 slots; 2-card prefill ~8–10 k, ESTIMATE) | all experts in 48 GB → split speeds prefill too; best fit for the cached-prefix workload |
| 1×3090 + 32–96 GB RAM | Qwen3.6-35B-A3B **UD-Q3_K_M** (16 GB) | 4 @ 32K (22 GB total) | ~250 tok/s at 4 slots (measured 252) | RAM above ~32 GB buys nothing here; 64K allows only 2 slots |
| 2×3090 + 96 GB RAM | Tiel Coder 35B-A3B UD-Q3_K_XL (17 GB) | 4–6 @ 32K | ~250–350 tok/s (ESTIMATE) | same maths as the row above, coding-agent tune |
| 2×3090 + 96 GB RAM | Qwen3.8-Flash-Next **IQ3_S** (the "smart" option) | 2–4 @ 64K | decode ~137 tok/s measured at 1 slot; ~250–300 at 4 (ESTIMATE) | prefill stuck at ~1.8 k tok/s → 385 M cached tokens/day is NOT feasible without cache hits |
| 1×3090 + 96 GB RAM | Swift 1.5 IQ2_XS (64 GB) | 1–2 | ~100 tok/s (measured earlier session) | quality ceiling, but the fee workload would swamp its prefill |

**Query cost of the alternative:** at $139.22/19 days ≈ **$209/month** total, of which DeepSeek V4.1 Flash is
~$91 and the whole DeepSeek family ~$131. A used 3090 (~$600) plus RAM (~$200) pays back in roughly 8–10
months if local replaces the DeepSeek line, before electricity (~$25–30/month at 6 h/day of both cards).

**UNVERIFIED, and it is the load-bearing unknown:** nothing in PolyStrata or this repo measures whether
Qwen3.6-35B-A3B gives answers of DeepSeek-V4.1-Flash quality on this team's work. Its tables are speed only.
The only honest test is an A/B on real queue items — e.g. move the high-volume, low-judgment seats
(`scribe`, `pm`, `qa2`, `designer`) to local first and keep `impl`/`lead`/`architect` on DeepSeek until the
local results are inspected.

### Local model quality: benchmark figures + quantization (2026-10-20)

The config table above ranked local models on SPEED only. Capability scores and the quantisation penalty
change the recommendation. Scores below are BenchLM as of 2026-10-19 (`benchlm.ai/models/<slug>`); Agentic
and Coding are the two categories that match durig's work (tool use + a code change in a real repo).

| Model | Overall | Agentic | Coding | Rows that decide it |
|---|---|---|---|---|
| **DeepSeek V4.1 Flash 1017** (the seat to replace) | 65.7 (#35/226) | 61.7 (#24, 82nd pct) | **60.9 (#18, 89th pct)** | Terminal-Bench 2.1 **90.6%**, DeepSWE **77.0%**, NL2Repo **68.2%**, Codeforces 3471, ProgramBench 29.1% |
| Qwen3.8-Flash-Next (= the Swift 1.5 base) | 62.9 (#44) | **65.5 (#17, 88th pct)** | 51.6 (#42, 73rd pct) | SWE-bench Pro 62.5%, DeepSWE 58.7%, NL2Repo 48.1%, LiveCodeBench v6 91.9% |
| GLM-5.3-Flash | 58.5 (#59) | 56.9 (#37, 72nd pct) | 48.1 (#47, 69th pct) | Terminal-Bench 2.1 84.3%, SWE-bench (Vals) 92.0%, DeepSWE 63.4%, NL2Repo 56.3% |
| Qwen3.6-27B | 48.6 (#108) | 29.1 (#97, 26th pct) | 34.8 (#80, 47th pct) | SWE-bench Verified 77.2%, SWE-bench Pro 53.5%, Terminal-Bench 2.0 59.3%, NL2Repo 36.2% |
| Gemma 4 26B A4B | 45.6 (#121) | **not measured** | 30.9 (#94, 38th pct) | LiveCodeBench 77.1%, MRCRv2 44.1% — and see the trap below |
| **Qwen3.6-35B-A3B** (the speed pick above) | 43.5 (#128) | **30.2 (#96, 26th pct)** | 31.5 (#93, 39th pct) | SWE-bench Verified 73.4%, SWE-bench Pro 49.5%, Terminal-Bench 2.0 51.5%, **NL2Repo 29.4%** |
| LFM2.5-24B-A2B | 37.7 (#150) | 31.0 (#94, 28th pct) | 25.3 (not ranked) | SWE-bench Verified 51.0%, tau3 8.0%, IFEval 96.8% |

**What this says, plainly:**
1. **The fast local pick is NOT a DeepSeek replacement.** Qwen3.6-35B-A3B is 26th agentic percentile against
   DeepSeek's 82nd, and on NL2Repo (build a working repo from a description — the closest published analogue
   to a durig queue item) it scores **29.4% against DeepSeek's 68.2%**. It is a coding specialist relative to
   its own predecessors, but an independent comparison puts the MoE 4-20 points BELOW a dense 27B on coding
   benchmarks: **pick it for throughput, never for peak quality.**
2. **Qwen3.8-Flash-Next is the quality leader among the models PolyStrata can run here** — overall 62.9 vs
   65.7, agentic percentile HIGHER than DeepSeek (88 vs 82), coding lower (73 vs 89); SWE-bench Pro 62.5%
   even tops Claude Opus 4.6 Max (53.4) and its DeepSWE 58.7 beats DeepSeek-V4-Flash-0731 (54.4). Its CODING
   gap to V4.1-Flash-1017 is what a verifier and a human reviewer must absorb.
3. **Gemma 4 26B-A4B is a trap for coding agents:** SWE-bench Verified **17.4** (roughly 4-5x worse than
   Qwen3.6-35B-A3B) while its LiveCodeBench looks respectable at 77.1 — and Google omitted SWE-bench from its
   own table, which is why BenchLM's profile has NO agentic rows at all. Do not pick it on LiveCodeBench.
4. **GLM-5.3-Flash is closest on the coding rows** (Terminal-Bench 2.1 84.3 vs 90.6; NL2Repo 56.3 vs 68.2)
   and has 1M context — but PolyStrata needs 79-114 GB for it and has not run it on Windows.

**QUANTIZATION erodes all of the above, and it is the deciding variable here** (PolyStrata `docs/MODELS.md`,
`docs/QUANTS.md` — "same top token as Q8_0" is the repo's quality proxy):

| Size | RAM+VRAM requirement | Same top token as Q8_0 | Verdict |
|---|---:|---:|---|
| Q2_0 | 37.6 GB | - | fastest, "good" |
| IQ2_XS (**the Swift 1.5 file on this PC**) | 39.2 GB | below IQ3_S | fast, "better" — but a 2-bit size |
| IQ3_XXS | 47.0 GB | - | "great" |
| **IQ3_S** | **54.8 GB** | **87.7%** | "**best: matches the full model on the published tests**" |
| UD-Q4_K_XL (Unsloth family) | ~88 GB of RAM for all experts | 93.1% | more quality, doubles the memory and slows decode |

So the numbers quoted in the benchmark table are FULL-PRECISION capabilities; **Swift IQ2_XS and Qwen3.6
UD-Q3_K_M run BELOW them.** For Qwen3.8-Flash-Next the quality-per-byte pick is **IQ3_S**, not IQ2_XS — it
is the size the repo says matches the full model, and 54.8 GB still fits 96 GB with room for the OS and the
KV host copy. Swift's own benefit is token efficiency, not raw accuracy: at high thinking it holds ~89.6%
accuracy while cutting thinking tokens by 63.4%, which matters in an agent loop where every reasoning token
is latency.

**Revised recommendation for "replace DeepSeek V4.1 Flash across 2-4 concurrent seats":**
2x RTX 3090 + **96 GB RAM**, running **Qwen3.8-Flash-Next at IQ3_S** (54.8 GB requirement) with
`"parallel": 2-3` and a generous conversation cache. That is the configuration that keeps the quality gap as
small as locally possible while still holding 2-3 seat contexts. Expect 2-card decode in the 100-140 tok/s
range (measured 137 tok/s on a 2x3090 x16+x4 pair at one slot) and prefill near 1.8 k tok/s — the number that
decides whether 385 M cached-prefix tokens/day are affordable. If a cheaper rig is the goal, the **Coder variant** is the best quality-per-dollar local option —
`ISTA-DASLab/Qwen3.8-Flash-Next-GSQ-RCO-Coder-GGUF` (https://huggingface.co/ISTA-DASLab/Qwen3.8-Flash-Next-GSQ-RCO-Coder-GGUF),
PolyStrata's `docs/MODELS.md` "Coder" row. Verified from the model card (2026-10-20): half the routed
experts removed (256 of 512 per layer, 48 layers, 10 active), remaining weights at 3.5 bpw, **58.4 GB
total of which only 29.6 GB must be resident** (the 28.8 GB n-gram shard can be served from disk);
**SWE-bench Verified 79.20 vs the BF16 base's 82.80 = 95.7% retained**, LiveCodeBench v6 87.43 = 100%
retained, both at xhigh reasoning. The 2026-10-17 rebuild raised SWE-bench Verified from 75.60 (an
earlier 91% figure quoted in older notes is that superseded build). Its own card warns the reduction is
DIRECTED at code/agentic/vision/spatial and degrades elsewhere — so it is a coding seat, not a
generalist, and the unpruned GSQ-RCO release is the general-purpose choice.

**It IS the row PolyStrata's own MODELS.md calls "Coder (IQ1_M)"**, so the measured speeds apply to the
file we would install (RTX 5070 12 GB / Ryzen 5 7600 / 64 GB, `docs/MODELS.md`): **55 tok/s short chat,
43 tok/s at 128K context, 2,180 tok/s prompt read** -- slower to write than IQ2_XS (79/63) but far more
prefill-friendly per GB, with shard 1 at 29.6 GB and experts ~23 GB of RAM (runs on a 32 GB PC, 262K
context on 64 GB). PolyStrata puts an RTX 3090 at roughly **100-140 tok/s** for the Qwen3.8 sizes.

**Two doc defects found while checking this, so nobody repeats them as fact:** (a) PolyStrata's
`MODELS.md`/`DETAILS.md` still quote **91%/91.3% of SWE-bench Verified and 98.7-99% of LiveCodeBench**
for the Coder -- those are the pre-2026-10-17 build; the model card's current figures are **95.7% and
100%**; (b) the same page says the Coder "reads long prompts the fastest of all", but its own table has
Q2_0 at 2,650 tok/s against the Coder's 2,180 (that column is a 32K read; a 128K read is not in the
table, so the claim is at best unverified).

### Qwen3.8 variants per hardware configuration (2026-10-20)

Requirements from PolyStrata `docs/MODELS.md` + `docs/DETAILS.md`. A size fits when **RAM holds the experts
plus ~10 GB** (Windows + other programs); the dense part of shard 1 goes to the card.

| Variant | Download | RAM for experts | RAM+VRAM total | Quality / note |
|---|---:|---:|---:|---|
| **Coder (IQ1_M)** | shard 1 = 29.6 GB | ~23 GB | fits a 32 GB PC | 95.7% of base SWE-bench Verified, 100% LCB; weak outside code and non-English |
| Q2_0 | 66 GB | ~34 GB + 6 | 37.6 GB | fastest; "good" |
| IQ2_XS | 68 GB | ~36 GB + 6 | 39.2 GB | "a bit better"; **the Swift 1.5 file on this PC** |
| IQ3_XXS | 76 GB | ~43 GB + 6 | 47.0 GB | "best" of the small sizes |
| **IQ3_S** | largest of the four | ~50 GB + 6 | **54.8 GB** | **matches the full model on the published tests** |
| UD-IQ4_XS (Unsloth) | 94 GB | ~62 GB | ~72 GB | more quality, slower decode |
| UD-Q4_K_XL | 111 GB | ~72 GB | ~88 GB | 93.1% same-top-token vs Q8_0 |
| UD-Q5_K_XL / UD-Q6_K_XL / Q8_0 | 158 / 169 / 188 GB | ~98 / 108 / 126 GB | ~108 / 118 / 136 GB | needs 128-192 GB RAM |

Swift 1.5 (a fine-tune) exists in the SAME sizes as the original, with about the same RAM and speed per token,
and thinks much shorter before answering -- so wherever a size fits, "Swift <size>" is a drop-in.

| Your configuration | Fits resident (recommended first) | Only via low-RAM/disk streaming | 2-4 seat verdict |
|---|---|---|---|
| **1x3090 24 GB + 32 GB** (today) | **Coder** (23 GB experts); **Q2_0 / IQ2_XS** via low-RAM mapping | IQ3_XXS, IQ3_S (experts 43-50 GB > 32 GB RAM) | Coder or IQ2_XS/Swift IQ2_XS. 24 GB is the slot budget: expect 1-2 concurrent seats, decode in the doc's 3090 range (~100-140 tok/s single stream) |
| **1x3090 + 96 GB** | **IQ3_S** (54.8 GB, the quality pick), Q2_0/IQ2_XS/IQ3_XXS, Coder, Swift sizes; **UD-IQ4_XS (~72 GB)** too | UD-Q4_K_XL (~88 GB) only with nothing else running -- risky | IQ3_S, or Unsloth UD-IQ4_XS for more quality. ONE card, so 2-3 slots at 32K and decode bounded by that card |
| **2x3090 48 GB + 32 GB** | **Coder** only (23 GB experts) | Q2_0/IQ2_XS in low-RAM mode; IQ3_XXS/IQ3_S much slower | Fastest per byte for code, but the RAM ceiling blocks the good general sizes -- this pairing wastes the second card |
| **2x3090 48 GB + 96 GB** | **Everything through UD-IQ4_XS**; **IQ3_S is the sweet spot**; UD-Q4_K_XL with ~8 GB headroom | - | **Best for your goal**: IQ3_S (or Swift IQ3_S) with `"parallel": 2-3`; the split also raises prefill, which is what the token bill needs |

**Slot budget (why concurrency stays small above the model size):** slots are paid out of VRAM. A Qwen3.6 slot
costs 1.5 GB of VRAM per 32K of context (measured); Qwen3.8 keeps its KV in RAM above 64K (`--kv-resident
32768` keeps the hot part on the card; ~13.7 KB/token of host RAM is ~0.9 GB per 64K conversation). On a 24 GB
card the choice is always "model in VRAM" vs "slots in VRAM": a 54.8 GB requirement (IQ3_S) leaves room for
roughly 2-3 slots at 32K, not the engine's 8.

### Less-compressed Qwen3.8 variants: the disk + RAM arithmetic (2026-10-20)

PolyStrata's `setup.py` MODELS table is authoritative for what an install costs. **Disk is
`download + arena` (the pack duplicates the experts), not just the download**, and the arena cannot be
avoided in low-RAM mode either -- low-RAM maps experts from the pack's `experts.bin` rather than copying
them into RAM, so the file stays on disk.

| Variant | Download | Arena (pack) | Disk needed | RAM for resident experts | Runs on 32 GB + 24 GB *well*? |
|---|---:|---:|---:|---:|---|
| IQ2_XS (**installed today**, Swift) | 68.0 GB | 35.5 GB | ~104 GB | 48 GB (we had 32 → low-RAM) | No -- it already ran in low-RAM mode |
| IQ3_XXS | 75.8 GB | 42.9 GB | ~119 GB | 60 GB | No (low-RAM) |
| **IQ3_S** | 83.6 GB | 50.3 GB | **~135 GB** | **62 GB** | No (low-RAM); **yes at 96 GB** |
| UD-IQ4_XS | 93.7 GB | 59.5 GB | ~153 GB | ~72 GB | No |
| UD-Q4_K_XL | 111.3 GB | 77.0 GB | ~188 GB | ~88 GB | No |
| UD-Q5/Q6_K_XL, Q8_0 | 158-188 GB | 98-128 GB | 256-316 GB | 108-136 GB | No |

This PC on 2026-10-20: **C: 54.1 GB free, D: 135.1 GB free**. So no less-compressed size fits as-is.
Removing the Swift install (64 GB of GGUF + 35 GB pack) and the unused qwen36 pack/model (~16 GB) frees
~115 GB on C:, taking it to ~169 GB -- enough for IQ3_S (~135 GB, ~34 GB headroom) or UD-IQ4_XS (~153 GB).
`START-HERE.bat --data-dir D:\PolyStrata-data` can put the download on D: instead, but D:'s 135 GB fits
IQ3_S only with ~0 headroom.

**Consequence for the "which variant" question:** the compression ladder and the RAM ladder move together.
Below ~60 GB of RAM every 3-bit-and-up Qwen3.8 runs in low-RAM mode, where experts stream from the pack on
disk -- and that is exactly the state our Swift run was in (`resident RAM: 19.52 GiB` of a 35.5 GB arena,
479 GB read from disk). **CORRECTION (operator, 2026-10-20): low-RAM mode does NOT reduce capability.** It changes WHERE the
experts live (pack-mapped instead of copied into RAM) and therefore speed; the weights and the routing are
the same model. PolyStrata's own notes support this: the KV-streaming variant "reads exactly the same
values (only where the KV lives changes)", and the expert-placement switches that DO change bits are
called out explicitly (e.g. `--pcie-frac 0` changes answers; `STRATA_EXCHANGE_ROTATE` gives "tokens
identical"). The only genuine caveat is that GPU-vs-CPU compute paths can move the last bits, which is
not a capability change. So a less-compressed variant can be tested on 32 GB; the price is throughput,
not intelligence. The 96 GB upgrade is about speed and concurrency, not about making a size "work".

### IQ3_S: RAM, SSD and pagefile plan (measured from setup.py + this PC, 2026-10-20)

`setup.py` decides the disk need as
`to_fetch + (2 if the MTP draft is reused else 8) + (1 if vision) + (arena_gb + 1 if low_ram and no pack yet)`.
Measured inputs: `IQ3_S` = download **83.6 GB**, arena **50.3 GB**; `mtp/rt/experts.bin` already present
(MTP regenerated by previous installs), so the draft term is **2 GB**; `LOW_RAM_HEADROOM_GB = 10` and
`ram_gb` for IQ3_S is **62** (arena 50.3 + headroom).

| Plan | SSD needed | Where it fits today (C: 54.1 / D: 135.1 free) | RAM behaviour |
|---|---:|---|---|
| **32 GB RAM -> low-RAM mode** (pack mandatory) | **~138 GB** | **not D:** (135.1 < 138); **C:** only after removing the Swift install (99 GB) + unused qwen36 (~16 GB) -> ~169 GB free | experts mapped from `packs/iq3_s/experts.bin`; engine memory guard caps at ~31.9 GiB; GPU holds ~19 GB of the 50.3 GB arena (24 - ~5 - KV) |
| **96 GB RAM -> resident** | **~87 GB** | D: comfortably; C: after removing Swift only | all 50.3 GB of experts copied into RAM; no pack built -- **the RAM upgrade also saves ~51 GB of SSD** |

**Pagefile:** this PC has a FIXED 32 GB pagefile on C: (`Win32_PageFileSetting` 32768/32768, automatic
management OFF); measured usage at clock-out was 3.6 GB with an 11 GB peak. Two facts that answer "will it
eat my pagefile":
- **File-mapped expert pages are backed by the pack file, not the pagefile** -- mapping 31 GB of
  `experts.bin` is a file mapping, so Windows can drop those pages without writing them anywhere.
- **The engine guards its own commit** (`memory guard: limit 31.9 GiB (source: meminfo) ... floor 2560 MiB`
  in `strata-swift-iq2_xs.log`), so it does not try to commit more than RAM allows.
PolyStrata's own advice is a fixed **64 GB** pagefile (`PAGE_FILE_FIXED_MB`) because "the graphics card's
memory needs room there too (issue #60)" -- but on this PC that would cost another 32 GB **on C:**, which
is exactly the drive the low-RAM install needs. Cheapest correct order: put the pagefile on **D:** (or
leave it at 32 GB) and keep C: for the model; or take the 96 GB RAM route, where the install drops to ~87 GB
(fits D:), C: stays free, and pagefile pressure effectively disappears.
