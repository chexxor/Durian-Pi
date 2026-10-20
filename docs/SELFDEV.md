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
| `qa` | verifier | `Qwen/Qwen3.6-35B-A3B` | independent; a DIFFERENT FAMILY from the author seats (Qwen, not DeepSeek) |
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
- **verifiers** are `qa` (`Qwen/Qwen3.6-35B-A3B`), `qa2` (gemma), and `auditor` (GLM-5.3-Flash).

So the pairwise requirement holds for the main loop (`impl` vs `qa`: DeepSeek vs Qwen; `impl` vs
`auditor`: DeepSeek vs GLM; `scribe` vs `auditor`: DeepSeek vs GLM) — **but it does NOT hold everywhere,
and the exception is worth knowing: `qa2` (gemma) is the only verifier that differs from BOTH DeepSeek
authors and Qwen `qa`, so a `qa`-authored check verified by `qa2` stays in-family only if the content is
gemma's own.** Check the pair, do not trust a slogan: the old "GLM authors vs DeepSeek verifiers" reading
is **FALSE** after the 2026-10-19 model moves and must not be quoted as policy. **Since 2026-10-20 the
local provider is DOWN by operator direction** — `qa` and `devtools` are back on DeepInfra models they
held before the local move, and a `devtools`-authored tooling change verified by `qa` is DeepSeek vs
Qwen, i.e. cross-family again (the shared-family exception above was a property of the local era, not a
standing rule).
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
