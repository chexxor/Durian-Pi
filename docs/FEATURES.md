# durian-pi — feature inventory

What durian-pi does **today**, where each piece lives, and what proves it. This is
the "what exists" reference: `docs/ROADMAP.md` is what comes next,
`docs/DECISIONS.md` is why, `docs/MVP.md` is how to demo anything here,
`docs/QUICKSTART.md` is how to start from nothing, and `docs/WORKFLOWS.md` is
what the whole thing is *for* — the workflows each feature serves, and the loop in
each that must never break.

Sections 1-10 describe what is **built**, each with the test or run that proves
it; anything carrying a stated limitation is marked **limited** in place.
Section 11 is planned, section 12 is deliberately absent.

## 1. The rig model

| Feature | What it does | Where | Proof | Surface |
|---|---|---|---|---|
| **Seats** | A named agent = one pi-durable conversation plus a registry entry (name, conversation id, role, capabilities) | `src/rig.mjs` `Seats`, `registerSeat`, `seatId` | `demo/cli.test.mjs`, `demo/constitution.test.mjs` | `cli` |
| **Org edges** | Who may `send_work` to whom; **restrictive by default** when any edge is declared, "open" when none are | `src/rig.mjs` `Edges`, `assertSendAllowed` | `demo/offline-v2.mjs` (forbidden send refused) | `cli` |
| **Capability tags** | Seats advertise tags; `send_work` can require one, and the refusal names what the target actually has | `src/rig.mjs` `assertSendAllowed` | `demo/offline-v2.mjs` | `cli` |
| **Constitution** | One text injected into every seat's system prompt, read **per request** so a single edit re-arms all seats | `src/rig.mjs` `Constitution`, `section("durig-constitution", …)` | `demo/constitution.test.mjs`, `demo/offline-v2.mjs` | `cli` |
| **Persona compilation** | `role`/`goal`/`backstory`/`constraints`/`capabilities`/`instructions` compile into one prompt | `src/rig.mjs` `compilePersona` | `demo/refresh.test.mjs` | `cli` |
| **Work queue** | Cross-seat queue with an append-only transition trail and DONE notices back to the sender; `queued → claimed → done`, plus `claimed ↔ deferred` | `src/rig.mjs` `RigQueue`, `enqueueItem` | `demo/race.test.mjs`, `demo/persistence.test.mjs` | `cli` |
| **Router tools** | The eight tools every seat gets: `send_work`, `claim_work`, `complete_work`, `defer_work`, `resume_work`, `revise_work`, `cancel_work`, `peek_queue`. `claim_work({ itemId })` additionally claims a **named** item (must be `queued` and addressed to the caller; a `held` item is not claimable by id) | `src/rig.mjs` `Router` | `demo/offline.mjs`, `demo/repeat-call.test.mjs`, `demo/defer.test.mjs`, `demo/rearmclaim.test.mjs`, `demo/curate.test.mjs` | `cli` |
| **Deferral** | A seat parks a claimed item on a question instead of guessing or going quiet: to the human operator (visible in `status`/`watch`, nothing enqueued) or to a seat (edge-gated, enqueued as real work), then `resume_work` takes it back. Not terminal — an item parked with no way back would be worse than the prose it replaces. `deferred_awaiting_answer` splits human- vs seat-parked and names the newest human-parked item | `src/rig.mjs` `defer_work`/`resume_work`, `src/attention.mjs` `deferred_awaiting_answer` | `demo/defer.test.mjs`, `demo/watchview.test.mjs` | `cli` |
| **Queue curation** | A stale/superseded item can be cancelled (`cancel_work`, by its sender or holder) and an unclaimed item's subject/body revised (`revise_work`); `cancelled` is terminal alongside `done`, so the driver never wakes for it and it is not counted as non-terminal work | `src/rig.mjs` `isTerminalItem`/`revise_work`/`cancel_work` | `demo/curate.test.mjs` | `cli` |
| **Protocol primer** | A short protocol section appended to every seat prompt, so a migrated persona knows the tools exist | `cli.mjs` `buildSeatPrompt` | `demo/refresh.test.mjs` | `cli` |

The rig defines **four pi-durable documents** — `durig.seats`, `durig.edges`,
`durig.constitution`, `durig.queue` — and no other durian-pi document: no
schema ownership, no migration, no SQL. The one piece of durian-pi state outside the
store is the generation-slot lease files (`src/genlock.mjs`, D12).

## 2. Operating surface (CLI)

`cli.mjs` is the operator interface and the contract that LLM operators drive.
Every command prints **one JSON document**; human-readable output appears only on
a terminal (D19). It is non-interactive by decision (D21) and never prompts.

| Command | Does | Flags | Surface |
|---|---|---|---|
| `init` | Scaffold a bare install so `up` can follow: write `rig.json` (a verbatim copy of the hardened starter `rig.starter.json` — seats pm/impl/qa/lead, edges, inline constitution — with only a `_readme` provenance note changed) and `durian-pi.config.json` (the shipped defaults materialized from `durian-pi.config.default.json`). npm-init-like: **refuses** (exit 1, naming the file) when either file already exists, checked rig-then-config and refused BEFORE any write, so a refusal never leaves a torn half-scaffold and never clobbers an existing file; the seed is audited through the same `auditRig` `check` uses (absent-store basis), so a drifted starter fails `init` loudly instead of scaffolding garbage. The scaffold audits clean (`check rig.json` exit 0, store rules skipped). Proof: `demo/init.test.mjs` | | `cli` |
| `up <rig.json>` | Create/refresh seats, edges and constitution from a spec; idempotent | `--refresh` re-applies stored prompts, models **and** each seat's working directory | `cli` |
| `worktree <path>` | Create an isolated per-item checkout for seats to write in. Forks the **visible state**: a dirty source no longer refuses — the uncommitted content is carried into the fork and returned as `{carried}` (and logged by the broker), so isolation does not depend on a pristine tree (#506), while the anti-stale rule keeps the fork matching what the tree visibly holds (#240). Deleted-but-uncommitted paths stay deleted. Dependencies are installed per worktree (`npm ci --prefer-offline`), never bridged with a `node_modules` junction (Git 2.42 deletes *through* junctions) | `--source <dir>` | `cli` |
| `ps` | Seat roster with conversation ids and roles, each seat's configured `model`, and its worktree `root` when a non-default cwd is persisted | | `cli` |
| `send <seat> <text>` | Steer a seat, wait for its reply, return it inline — **DEPRECATED** (stderr notice, #1585): prefer the spool, `node intent.mjs <seat> --body-file <file>` (the broker delivers) + `log`/`status` for the reply; being retired | `--stream` / `--no-stream`, `--body-file <path>` (or `-`), `--request-id <id>` (retry-safe) | `cli` |
| `resume` | (alias `doctor`) advance admitted-but-not-progressing submissions — a run admitted but never scheduled | | `cli` |
| `run` | Drive the rig to quiescence: wake each seat that has queued work OR a stalled claim (a claimed item whose run died), hold the harness until the runs settle; exits at quiescence | `--watch` stays resident | `cli` |
| `serve` | The resident broker: own the harness and run a wake pass on each store change (no external clock); runs the supervisor each pass; writes `<db>.broker.log`. `up` auto-starts it on a TTY | `--max-duration <seconds>` bounds wall-clock; `--stop` reaps a running broker cooperatively | `cli` |
| `reset <seat> [handoff]` | (alias `clean`) break a seat out of a degenerate context by writing a `pi.reset` boundary; the durable transcript is preserved | | `cli` |
| `compact <seat> [instructions]` | Summarize a seat's OLDER context into a `pi.compaction` summary entry (the transcript is preserved; only the model context shrinks). With a broker alive it ROUTES through the command spool (`op:compact`, #1904) so the broker applies it live — the rig keeps running; with no broker it opens its own harness and refuses a live generation lease | | `cli` |
| `stop <seat> [reason]` | Emergency-stop: halt a seat's in-flight run across processes, settle it terminal as `aborted: <reason>`, release the lease | | `cli` |
| `queue` | Dump every work item with status and transitions; a `summary` gives counts by status plus the notices count, so notices are distinguishable from work | `--active`, `--status <s>`, `--all` | `cli` |
| `events` | Durable read-only event feed with a monotonic `seq` cursor; a reconnect from the last `seq` resumes rather than replaying. No harness attach, nothing written | `--since <seq>`, `--follow` | `cli` |
| `log <seat> [limit]` | A seat's conversation, turn-grouped. `--follow` also shows the in-flight **partial** as streaming — a `partial` object on JSON, a live region on a TTY — always distinct from committed turns | `--follow`, `--full`, `--tool-bg`, `--theme dark\|light`, `--human`/`--json` | `cli` |
| `watch` | Follow rig state — human dashboard on a TTY, NDJSON when piped, with a per-seat `streaming` field and row | `--once`, `--human`/`--json` | `cli` |
| `ui` | The read-only interactive TUI. Separate entrypoint: run `node ui.mjs` (or `npm run ui`); `cli.mjs` stays non-interactive (D21). Seat list + a rich full conversation view | `q`/Ctrl+C quit; `r` refresh; `↑↓`/`j`/`k` select/scroll; `Enter` open the selected seat's conversation; `Esc` back; `i` type an intent to the focused seat (an OVERLAY on the current view — `Enter` send, `Esc` cancel) | `tui` |
| `intent` | Spool a message to a seat for the resident broker to deliver WITHOUT stopping it. Separate entrypoint: `node intent.mjs` (or `npm run intent`); the producer never opens the store | `<seat> --body-file <path\|->`, `--request-id <id>` | `cli` |
| `status` | One-shot per-seat health plus attention notices; like `ps` it also surfaces each seat's `model` and its worktree `root` when a non-default cwd is persisted. Each seat row carries `lastActivity` — the seat's newest ACTIVITY timestamp (`#2229`; ISO-8601), absent when the seat has none | | `cli` |
| `check <rig.json>` | Audit a rig file **and** the store against the research gaps | `--human`/`--json` | `cli` |
| `metrics [rig.json]` | Drift measures, each with its band, baseline and blind spot | `--window N\|all`, `--human`/`--json` | `cli` |
| `optimize <text>` | Rewrite a draft instruction through the optimizer | | `cli` |
| `config` | Show the effective settings and which source supplied each | | `cli` |
| `format [--check] [-- <paths>]` | Format **explicit** files with the pinned prettier (a devDependency, loaded on demand), so style is consistent and whitespace/EOL churn stops leaking into diffs. Paths are required: no glob and no default tree, so a seat formats the files it changed, after its edits and before `git add`/commit. `--check` is a gate that writes nothing and exits non-zero on an unformatted file (sit it beside `node --check` in the demo loop). Deliberately **not** an on-write formatter (formatting between a seat's read and its edit makes the exact-match `oldText` stale) and **not** a global git hook (a hook rewrites files outside the staged set). The one-time whole-tree normalize is a separate, gated, stop-the-world change. Tool choice, pin and config: `docs/FORMATTER.md`; proof: `demo/format.test.mjs` | `--check` | `cli` |

Five operator-facing behaviours are load-bearing:

- **Wrong-database guard** — read commands name the resolved database and warn
  when it holds no seats, because a missing `DURIAN_PI_DB` otherwise looks exactly
  like a healthy quiet rig (D18).
- **Failure honesty** — errors come back as `{ok:false,error}` with a nonzero
  exit instead of a stack trace; a `send` that does not settle as `done` says so
  on stderr.
- **Seat-root guard** — a write-side `send`/`run` whose `DURIAN_PI_SEAT_ROOT`
  disagrees with a seat's persisted working directory **fails closed**, naming
  both paths and the fix. A seat's cwd is resolved once at `up` time and
  persisted; without this guard an operator who re-points a run at a new worktree
  silently writes into the old one and sees success (dogfood F12).
- **Command guard / commit authority (D50)** — every seat's shell command is
  checked against one denial list (`src/seatguard.mjs` `beforeTool` for the
  tool layer, `src/confine.mjs` `refusalFor` for the environment — one policy,
  so the two cannot drift). Read-only git (`status`/`log`/`diff`/`show`/`rev-parse`)
  passes; **`git commit` is allowed**, scoped and `-C` forms included; `git push`
  **is refused** unless the operator granted `DURIAN_PI_ALLOW_PUSH=1` in durian-pi's own
  environment (a seat's own inline assignment cannot forge it); and every
  destructive form — `reset`, `checkout`, `restore`, `revert`, `clean`, `stash`,
  `branch -D`, and unscoped `add -A`/`add .` — is refused with the reason as a
  `block`, so a seat reads it and `defer_work`s instead of retrying variants.
  Proof: `demo/confine.test.mjs` (every form + the `git commit;` separator
  canaries), `demo/seatguard.test.mjs` (push refused by default, the operator's
  grant allows only push, nothing else widens).
- **Help and exit contract** — `help` and `--help` print the usage text to
  **stderr** and exit 0, emitting no stdout JSON; bare `cli.mjs`, `-h`, and an
  unknown verb print `{"ok":false,"usage":...}` to stdout and exit 2
  (`demo/cli-help.test.mjs`, `demo/cli.test.mjs`).

## 3. Configuration

One vocabulary for both the environment and the config files, resolved
**env → `durian-pi.config.json` → `durian-pi.config.default.json` (shipped) → built-in
default** — a fresh install runs with no hand-written config at all (#491 C6):
the shipped defaults file rides with the artifact (also looked up anchored to
durian-pi's own install directory), ships `DURIAN_PI_MAX_CONCURRENT_SEATS=1` so a bare
install cannot stampede a local model, and `node cli.mjs config` names where
each value came from (`defaultsSource`).

| Key | Meaning |
|---|---|
| `DURIAN_PI_DB` | Storage path (default `./rig.sqlite`) — the shipped defaults file sets `./rig.sqlite` explicitly so the floor is visible, not implied |
| `DURIAN_PI_SEAT_ROOT` | Fallback working directory for seats at `up` time (keeps a rig file portable by naming no host path). Persisted per seat, so a later write-side `send`/`run` with a different value **fails closed** rather than silently using the old tree |
| `DURIAN_PI_PROVIDER` | `deepinfra` (default) or `faux` for offline runs |
| `DURIAN_PI_MODEL` | Default model for seats without their own |
| `DURIAN_PI_MAX_CONCURRENT_SEATS` | Cap concurrent generations rig-wide (unset = unlimited). **Shipped default: `1`** (#491 C6) — serialize rather than stampede a local model; an operator opts in to more |
| `DURIAN_PI_OPTIMIZE` | `on`: run each persona through the optimizer during `up` |
| `DURIAN_PI_EXTENSIONS` | Comma-separated pi-durable extension modules to install. A path that cannot load **fails the command** rather than being skipped, and `up` reports the names it installed. Proof: `demo/extensions.test.mjs` |
| `DURIAN_PI_STREAM_TIMEOUT_MS` | Total request timeout for one generation attempt. Unset = platform default (`openai` SDK, 600000 ms). The only harness setting durian-pi exposes, because it is the only one with no default and a real reason to move in both directions. Proof: `demo/config.test.mjs` |
| `DEEPINFRA_API_KEY` | Ambient credential, read from env/config, never stored or printed |

Discovery order: `$DURIAN_PI_CONFIG`, then `./durian-pi.config.json`, then
`./.durian-pi/config.json`; the shipped defaults file is additionally looked up
anchored to durian-pi's install directory (`durian-pi.config.default.json`)
(#491 C6). `node cli.mjs config` prints the effective values, the source, and
`defaultsSource`; the API key is reduced to `set`/`unset` so it is always safe to
log. Proof: `demo/config.test.mjs` — merge order (env > file > defaults), a
fresh CWD with no runtime config still gets the shipped floor, malformed
defaults fail loudly, and the wiring is asserted in cli.mjs's real load path.

Store-open failures name the store: every verb goes through one storage-open
wrapper, so a failure reads `cannot open <resolved DB_PATH>: <cause>` (same
JSON contract `{ok:false,error}` and exit 1 as any CLI failure) instead of bare
sqlite wording that leaves the operator guessing which store was in play
(#491 C7). The interactive `durian-pi ui` renders the same wording on its failure
path. Proof: `demo/errorwording.test.mjs` — directory-as-DB through the real
CLI, exit 1, the exact resolved path in the error text before the cause.
Provider options are imported from `src/providers/deepinfra-models.ts` — a vendored
copy of the module the pi extension uses — so the catalog is single-sourced and
durian-pi stands alone (see `src/providers/PROVENANCE.md`).

## 4. Seats and models

| Feature | What it does | Where | Proof | Surface |
|---|---|---|---|---|
| **Per-seat model** | `seat.model` as `{provider}/{modelId}` or a bare id; a leading segment counts as the provider **only** when it names a registered provider, so slash-bearing ids like `zai-org/GLM-5.3-Flash` work bare | `src/seatmodel.mjs` | `demo/seatmodel.test.mjs` | cli |
| **`security` seat / capability** | The rig's security engineer: owns threat models, trust boundaries and secret hygiene (capabilities `security` + `review`). Deliberately **NOT a verifier** — its name/role avoid `VERIFIER_TERMS`, so `seatsAreVerifier` leaves it alone and `toolRemovalsFor` keeps its `write`/`edit`/`shell` (it can read code and write its positions). Model `zai-org/GLM-5.3-Flash`, independent of the DeepSeek authors. Edged to every seat and back; ownership class `security-positions`. | `rig.selfdev.json` (`security` seat, `f701837`), `src/checkup.mjs` `seatsAreVerifier`/`VERIFIER_TERMS`, `src/seattools.mjs` `toolRemovalsFor` | `node cli.mjs ps` on `selfdev.sqlite` (10 seats); `node demo/seatmodel.test.mjs` | rig |
| **Live view** | A running generation streams to stderr so `send` shows progress without splitting the stdout contract | `src/streamview.mjs` | `demo/streamview.test.mjs`, `demo/streamcli.test.mjs` | cli |
| **Generation slots** | Cross-process file leases cap concurrent generations; a live holder is healthy waiting, a dead holder is surfaced as stale | `src/genlock.mjs` | `demo/singleflight.test.mjs` | cli |
| **Instruction optimizer** | Rewrites a draft instruction for clarity, with a **preservation guard** that falls back when the rewrite drops signal | `src/optimizer.mjs` | `demo/optimizer.test.mjs`, `demo/optimizer-eval.mjs` | cli |
| **Blind judge** | Pairwise, position-randomised evaluation of two prompts | `src/judge.mjs` | `demo/eval.test.mjs` | cli |

Per-seat models flow through both seat-creation paths (`up` and `up --refresh`)
from one helper (`src/seatmodel.mjs`), so the two paths cannot drift apart
(`demo/refresh.test.mjs`).

## 5. Durability and concurrency

| Feature | What it does | Where | Proof | Surface |
|---|---|---|---|---|
| **Persistent state** | Everything lives in SQLite through pi-durable; each CLI call opens storage, acts, closes | `cli.mjs` `openHarness` | `demo/persistence.test.mjs` | cli |
| **Restart re-arm** | `harness.resume()` re-arms scheduling so queued work continues after a process restart | `cli.mjs` `openHarness` | `demo/persistence.test.mjs` | cli |
| **Race safety** | Concurrent claims yield one winner and no double assignment | queue transitions | `demo/race.test.mjs` | cli |
| **Repeat-call tolerance** | A replayed tool call returns current state instead of erroring on a settled overlay | `src/rig.mjs` | `demo/repeat-call.test.mjs` | cli |
| **Request-idempotent send** | `send --request-id` makes one send one submission: a retry carrying the same id reuses the existing submission rather than generating again, and returns the original reply. The id is never derived from the text, because two deliberate identical sends are two requests | `cli.mjs` `cmdSend` | `demo/cli.test.mjs` | cli |
| **Self-driving queue** (`run`) | Wakes each seat that has queued work and nothing advancing it, holds the harness open until the runs it started settle, and exits at quiescence — the clock the queue was missing. A driver, not a wake inside the Router tools, because a stateless `send` closes its harness before a tool-woken run could finish (F11) | `src/driver.mjs`, `cli.mjs` `cmdRun` | `demo/run.test.mjs` | cli |
| **Resident broker** (`serve`) | One long-lived process that owns the harness and wakes seats from the store's in-process commit stream — no external clock. The scheduler coalesces a burst of commits into one pass, floors pass starts, and cools off a per-seat retry so a re-woken stalled claim cannot hot-loop; the supervisor runs each pass. Restarted later, it still drives work queued while nothing ran. It is the single long-lived writer that *is* the harness (D45); read-only viewers still never wake a seat (D11). **Sanctioned concurrency — one writer per DB, N seats:** the store/harness is single-writer (one broker owns the store; a second `serve` or a `run` refuses while one drives, D46 — two drivers double-wake), while the *files* are deliberately concurrent (each seat edits its own per-task worktree, D49) and the *generations* are capped at `N = DURIAN_PI_MAX_CONCURRENT_SEATS` leased cross-process by `genlock` (D12). Sanctioned model: **one broker owns the store and drives up to N seats, each in its own worktree**; never two drivers on one DB; genuinely independent drivers use separate databases | `src/broker.mjs`, `src/scheduler.mjs`, `cli.mjs` `cmdServe` | `demo/broker.test.mjs`, `demo/scheduler.test.mjs`, `demo/autostart.test.mjs` | cli |
| **Broker auto-start** (`up`) | A TTY `up` leaves the queue self-driving by starting the broker; a piped/scripted `up` never silently spawns a daemon. At most one broker per database (`<db>.broker.json`, the genlock pid convention); a second broker and `run` refuse while one drives (two drivers double-wake); `serve --stop` reaps it | `cli.mjs` `cmdUp`/`ensureBroker`/`cmdStopBroker`, `src/broker.mjs` | `demo/autostart.test.mjs` | cli |
| **Stalled-claim re-wake** | Also wakes a seat holding a `claimed` item whose run died (no in-flight submission, no live lease), so an abandoned claim is re-driven with no human send. An operator-`stop`ped claim is never re-woken — the guard reads, read-only, the abort fact `stop` already writes — and a live/in-flight run is never double-woken | `src/driver.mjs` `selectWakes`, `cli.mjs` `cmdRun` | `demo/stalledclaim.test.mjs` | cli |
| **Thin-context return** | A claim's `result` text returns a PATH, not an inline body, once it exceeds a threshold, so the coordinator's context is not flooded; the coordinator reads the file | `src/rig.mjs` `thinResultText` | `demo/thincontext.test.mjs` | cli |
| **Emergency stop** (`stop`) | Halts a seat's in-flight run across processes by killing the live generation-lease holder, settles the submission terminal as `aborted: <reason>`, aborts the run's task, and releases the lease; a second stop is a no-op | `cli.mjs` `cmdStop` | `demo/stop.test.mjs` | cli |
| **Context reset** (`reset`/`clean`) | Writes a `pi.reset` boundary so prior turns leave a seat's context without deleting the durable transcript — the fix for a degenerate turn that has self-conditioned the history | `cli.mjs` `cmdReset` | `demo/reset.test.mjs` | cli |
| **Context compaction** (`compact`) | Summarizes a seat's OLDER turns into a `pi.compaction` summary entry so the model context shrinks WITHOUT losing the durable transcript; the verb drives the compaction task to completion and proves the summary entry landed (no enqueue-and-exit stub). With a broker alive it is applied by the broker through the command spool (#1904), live | `cli.mjs` `cmdCompact`, `src/broker.mjs` `op:compact` | `demo/compact.test.mjs`, `demo/compact-spool.test.mjs` | cli |
| **Resume a stranded run** (`resume`/`doctor`) | Advances admitted-but-not-progressing submissions, so a run that was admitted but never scheduled is re-armed instead of looking idle (F11) | `cli.mjs` `cmdResume` | `demo/resume.test.mjs` | cli |
| **No DONE-of-DONE** | A DONE notice cannot generate another DONE notice, so the notice chain terminates instead of echoing | `src/rig.mjs` `isDoneNotice` | `demo/notices.test.mjs` | cli |
| **Seat-root guard** | A write-side `send`/`run` whose `DURIAN_PI_SEAT_ROOT` disagrees with a seat's persisted cwd fails closed, naming both paths and the fix; view-only commands and `up --refresh` are unaffected (dogfood F12) | `cli.mjs` `openHarness` | `demo/seatroot.test.mjs` | cli |
| **Concurrent store writes** | The `send` path is made safe for two CLI processes writing one store: a lost entry-id collision is retried instead of dying raw; a message that cannot be delivered is a guided refusal, not `ID n already belongs to entry`. **Known limit:** the `up`/`run` write paths are not yet covered | `src/storewrite.mjs` | `demo/storewrite.test.mjs` | cli |
| **Dirty-source carry (amends F23 refusal, ASK F #506)** | `worktree` forks the visible state instead of failing closed on a dirty tree: uncommitted tracked edits + untracked files are copied into the fork, uncommitted deletions stay deleted, and the carried set is returned (`createWorktree(...).carried`) and logged by the broker — so one seat's in-progress work can no longer block another seat's worktree claim, and the fork is enumerated, not a “tree neither git nor the operator tracks”. **Never carries a linked worktree into a worktree (#998):** a sibling `item-<id>` or the just-created target appears in the source's status as an untracked directory; those roots are excluded from the carry so the fork never copies a whole foreign checkout and never self-copies into its own source (`cp(repo/item-2, repo/item-2/item-2)` → `ERR_FS_CP_EINVAL`) | `src/worktree.mjs` `carryVisibleState` | `demo/worktree.test.mjs` (amended F23 section), `demo/broker-dirty-fork.test.mjs`, `demo/worktree-recursive-carry.test.mjs` | cli |
| **Per-task worktree lifecycle** | One worktree + branch per item: create-on-claim, `git worktree lock` while the item runs, remove on completion. `npm ci --prefer-offline` per worktree (never a junction); git-identity validation (`--show-toplevel` == the tree, `--absolute-git-dir` != `--git-common-dir`, `.git` is a file); rebase-before-merge with `rerere`; cleanup only via `git worktree remove`, refusing a dirty tree or any junction | `src/worktree.mjs` | `demo/worktree-lifecycle.test.mjs` | cli |
| **Seat-prepared workspace (`prepare_workspace`)** | The workspace switch is a seat TOOL, not the broker: called after `claim_work` and before any filesystem work, it creates the item's isolated git worktree at `<root>/item-<id>` and persists THAT conversation's cwd to it via `configure`, so `makeSeatEnv` resolves each seat to its own tree. The broker no longer sets a process-global `DURIAN_PI_SEAT_ROOT` (which pointed every seat woken in one pass at one worktree) or creates worktrees itself. Idempotent on rerun (an existing worktree is reused, so a resume never nests one inside another, #506); `complete_work` retires it with `force:false`, so uncommitted work is never discarded. A dirty shared tree still forks + carries + reports (`carryVisibleState`), so isolation holds while seats are mid-edit | `src/seattools.mjs` `prepareWorkspace`, `src/worktree.mjs` `prepareSeatWorkspace`/`removeSeatWorkspace`, `src/rig.mjs` `complete_work`, `constitution.txt` | `demo/prepare-workspace.test.mjs`, `demo/broker-dirty-fork.test.mjs` | cli |
| **Job-Object process reaping** | Windows has no SIGTERM; the seat's process tree is reaped by a Job Object (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) and the worktree is removed only after the tree is confirmed dead | `src/job-object.mjs` | `demo/job-object.test.mjs` | cli |
| **Degeneration guard (D64, #874, #875)** | The broker's supervise pass resets a seat whose CURRENT run outgrows a conservative bound, writing the existing `pi.reset` boundary via `conversation.reset` so the next wake re-anchors the seat from its durable instructions. Two causes beyond tool-turn/context-token/step-repetition/malformed-call: a **per-turn wall-clock bound** as its own cause (#874) reading `AssistantMessage.durationMs` (a high 5-minute threshold, so a legitimately slow turn is never reset — a run that badly OUTGROWS a bound is), and a **named-pattern prose registry** (#875) where each pattern is a PURE predicate over one assistant turn's text, named in the reason as `degenerate-text=<name>=<count>>=<bound>` and proven against real turn fixtures (positive = real loop, negative = healthy turn). Diagnosis / adding a pattern: `docs/runbooks/degeneration-guard.md` | `src/degeneration.mjs`, `src/attention.mjs` `TEXT_PATTERNS`/`matchTextPatterns`, `src/supervisor.mjs`, `scripts/degen-scan.mjs` | `demo/degeneration-duration.test.mjs`, `demo/degeneration-text.test.mjs`, `docs/runbooks/degeneration-guard.md` | cli |
| **Scratch-worktree landing helper (`scripts/land.mjs`)** | A landing pass never leaves the shared tree mid-merge: the helper merges the named branches into a SCRATCH DETACHED worktree, runs the suite there (`--suite`), and advances `main` only by a clean fast-forward once the result is clean (2026-10-17 landing-safety incident: a conflicted `src/checkup.mjs` in the shared tree killed every `node cli.mjs` verb). It is also the pre-flight ENFORCEMENT chokepoint (#1164 Q3): refuses to land on a tree with tracked modifications, on a tree already mid-merge, and on a held genlock slot; a conflict STOPS and reports the conflicted paths. Not built on purpose: a hunk-picker / `apply_patch` (conflicts needing SYNTHESIS cannot be produced by selection); any conflict tool is gated on measured incidence (ROADMAP 100) | `scripts/land.mjs` | `demo/land-helper.test.mjs`, `docs/runbooks/merge.md` | cli |
| **Broker observability and bounds** | The broker writes `<db>.broker.log`; each `PASS` logs its DURATION and the seats woken (`PASS <n> ms=<dur> woke=<a,b>`) so a long pass that waited is legible, not guessed; `serve --max-duration` bounds wall-clock and exits; `serve --stop` settles cooperatively under load instead of a forced kill. A pass waits only on the conversations it woke and ends early on a wake-relevant commit (D65), so one slow run does not delay re-waking a seat that already settled | `src/broker.mjs`, `cli.mjs` | `demo/broker-liveness.test.mjs`, `demo/broker-log.test.mjs`, `demo/broker-max-duration.test.mjs`, `demo/broker-cooperative-stop.test.mjs` | cli |
| **Bounded retry + `PASS-FAILED` legibility (ROADMAP 78 remainder)** | A PERSISTENTLY-throwing pass is bounded by the retry backoff, never hot-looped: a storage error thrown before `drainIntentInbox` used to mark the scheduler dirty whenever the inbox was non-empty, so `shouldRun` re-triggered a pass every floor tick (the `WAKE-RETRY ... pass-threw` ~0.5 s loop, all `in=60000ms`) and `serve --stop` could not terminate it (post-reboot broker pid 5840). Now the inbox-driven re-trigger respects the backoff, the throwing path honors `.stop`, and each thrown pass logs `PASS-FAILED <error> cause=<chain>` so a failing pass is legible instead of a silent retry (#2237, ROADMAP 78 remainder; qa artifact #2417) | `src/broker.mjs` | `demo/broker-hotloop-bound.test.mjs` | cli |
| **Command spool** (`node intent.mjs`) | Deliver operator intent to a seat WITHOUT stopping the broker, now as TYPED OPS: the producer writes one atomic JSON request to `<db>.broker.inbox/` and never opens the store; the broker drains the spool at the START of each pass and APPLIES it with its own harness. The request is typed — `SPOOL_OPS` (`src/broker.mjs`) is today `message` (an absent `op` defaults to it), `stop` (settle to `aborted: <reason>`, in-process, no pid kill), `reset` (draw the shared `pi.reset` boundary), `compact` (route a live compaction through the broker, #1904), `pause`/`unpause` (ROADMAP 131), `configure` (set a seat's model), and `read` (serve a viewer read from the broker's own storage — see the next row); an unknown `op` is dead-lettered, never applied. Each applied request records its outcome at `<db>.broker.inbox.out/<requestId>.json` — the RESULT CHANNEL — which is also the IDEMPOTENCY LEDGER: a duplicate `requestId` on re-drain applies once. An unknown seat or failed submit is dead-lettered to `<db>.broker.inbox.error/` with its reason. `intent.mjs` is the producer (`--op`, `--reason`, `--handoff`; mints/prints the `requestId`). | `src/broker.mjs` `writeIntent`/`drainIntentInbox`/`SPOOL_OPS`, `intent.mjs` | `demo/broker-inbox.test.mjs`, `demo/command-spool.test.mjs` | cli |
| **Broker-served reads** | When a broker is alive, EVERY read verb (`ps`, `queue`, `status`, `watch`, `log`, `events`, `metrics`, `check`, `worktree audit`) and `ui.mjs` read through the broker's OWN pi-durable instance via the `read` spool op instead of opening a second store. `SqliteStorage.document()` takes `BEGIN IMMEDIATE` even for a read, so a separate opener steals the broker's write lock and poisons its session (`SessionFailed`) — the 2026-10-18 wedges. `src/brokerread.mjs` applies a closed view set (`seats`/`queue`/`roots`/`health`/`live`/`entries`/`feed`/`document`/`exhausted`/`older`) over the broker's storage; `src/readclient.mjs` is the client. Only when NO broker is alive does a verb open the store directly (it is then the sole owner). Since `#2321` (landed `main d058e0a`), a spooled `op:"read"` intent is served IN PLACE by the broker's idle loop WITHOUT forcing a wake/supervisor pass (the `onlyReadIntents` gate), so a polling viewer (`watch`/`ui.mjs`) no longer hammers the broker with one pass per poll. D111 | `src/brokerread.mjs`, `src/readclient.mjs`, `src/broker.mjs` `op:read`, `cli.mjs`, `ui.mjs`, `src/tui/readstate.mjs` | `demo/broker-read.test.mjs`, `demo/cli-broker-refuse.test.mjs` | cli |
| **`send` deprecation** | `send` is DEPRECATED in favour of the command spool: it prints a stderr notice and is being retired (7ecf275, #1585). It opens a FULL writing harness (a second owner), so it refuses while a broker drives anyway; the replacement is the spool (`node intent.mjs <seat> --body-file <file>`, which the broker drains as operator input) plus `log`/`status` for the reply. `send_work` (the seat routing tool) is unrelated and stays | `cli.mjs` `cmdSend` | `demo/cli.test.mjs` | cli |
| **Concurrent seat attribution** | With N generation slots, each lease and `status` names the generation's own seat (AsyncLocalStorage), not the last-woken seat (fixes F34 under concurrency) | `src/genlock.mjs` | `demo/broker-seat-attr.test.mjs` | cli |
| **Coordinator queue listing** | `peek_queue(all=true)` returns the full non-terminal listing uncapped, so a coordinator with no read tool can groom the queue | `src/rig.mjs` | `demo/coordinator-queue.test.mjs` | cli |
| **Zero durian-pi SQL** | durian-pi imports one storage opener and runs no SQL of its own | `cli.mjs:26` | architecture note, `docs/STATUS.md` | cli |

## 6. Observability

| Feature | What it does | Where | Proof | Surface |
|---|---|---|---|---|
| **Attention** | Derives operator-visible notices from durable state: `idle_with_queued_work`, `last_run_failed`, `admitted_not_started` (a submission admitted but never scheduled), `deferred_awaiting_answer` — which **splits human- vs seat-parked** and names the newest human-parked item | `src/attention.mjs` | `demo/blocked.test.mjs`, `demo/stranded.test.mjs`, `demo/defer.test.mjs` | cli |
| **Watch dashboard** | Per-seat human view — who, current work, last words — with glyphs and colour; an empty dashboard can never look healthy | `src/watchview.mjs` | `demo/watchview.test.mjs` | cli |
| **Interactive TUI (`node ui.mjs`)** | A full-screen read-only session over the same readapi/viewmodel seam as `watch`. The **seat list** shows the selected row in reverse video + `▸`; **Enter opens that seat's conversation** — a rich full-height view of its stream (operator/agent turns, tool calls, thinking, and a streaming block), with `↑↓` scrolling and `Esc` back to the list; `i` types an intent to the focused seat in an input OVERLAY that sits on the current view (it never replaces it, and send/`Esc` returns to that view). Alt-screen with raw-mode/cursor/buffer restore on every exit path. Separate entrypoint — `cli.mjs` stays non-interactive (D21) | `ui.mjs`, `src/tui/driver.mjs`, `src/tui/client.mjs`, `src/tui/viewmode.mjs` | `demo/tui-conversation.test.mjs`, `demo/tui-input-overlay.test.mjs`, `demo/ui-driver.test.mjs`, `demo/tui-client.test.mjs` | `tui` |
| **TUI context line** (`ctx`) | ROADMAP 98 (#1108) — the TUI renders ONE seat's context consumption (item 27's measure, `src/context.mjs`) as a header line, owning NO measure/denominator logic. The three-state denominator (measured > declared > advertised) TRAVELS WITH THE VALUE, so a fraction is never shown without naming its window. Five states: measured ≤100% (`ctx 31.4%/300k`), measured >100% (tokens + basis word + UNCLAMPED percent, e.g. `ctx 314K/300K eff · 105%`), declared (`·decl`), advertised-only (full word, percent WITHHELD — no `%`), and missing usage (`ctx n/a`, never `0%`). Bands `[high]` (60–90%) and `[crit]` (≥90%) render only when a percent renders. Width ladder: the atomic unit (basis-badge, denominator, percent) drops together, the raw token count always survives, and the line is never cut mid-string. Part 2 of #1108 (the TUI read-surface wiring) is HELD | `src/tui/ctxline.mjs` | `demo/ctxline.test.mjs` | `tui` |
| **Seat highlights** | Reads each seat's latest words and tool call **storage-direct**, never opening a harness | `src/rigstory.mjs` | `demo/watchview.test.mjs` | cli |
| **Shared read API** | One read-only seat/queue/health/live seam that every viewer and any future client imports (`watch`, `log`, `status`, `check`, `metrics` share it), so a client can read the store without opening a harness | `src/readapi.mjs` | exercised by every viewer demo | both |
| **Cross-process live stream** | `watch` polls storage at 750 ms because SQLite has no cross-process notification | `cli.mjs` `cmdWatch` | `demo/watch.test.mjs` | cli |
| **Live partial (streaming)** | The in-flight assistant partial read from the conversation's `pi.live` document, rendered distinctly from committed turns in `log --follow` and `watch`; it is never emitted as an entry, so a rewritten or withdrawn partial cannot be replayed as history | `src/readapi.mjs` `readLiveState`, `src/viewmodel.mjs` `partialView`, `src/chatview.mjs` `formatPartial` | `demo/livestream.test.mjs` | cli |
| **Tool-role palette (U4)** | The chat/transcript surface renders tool rows/output with pi's role vocabulary (`toolPendingBg`/`toolSuccessBg`/`toolErrorBg`/`toolTitle`/`toolOutput`), per theme, from `THEME_ROLES`/`themeToolRoles`; success/failure is also carried by glyph, never by hue alone. **Accepted known limitation (lead ruling #669):** the palette is DERIVED on the existing 256-color ramp family — `toolPendingBg` IS the pre-existing `TOOL_BG` token (kept, not replaced), success/error are one-step derivatives on the same ramp (darker on the dark ramp / lighter on the light), `toolTitle`/`toolOutput` are fg-level `dim`; it is NOT copied from pi's theme files, because `<pi-coding-agent>`'s `dark.json`/`light.json` are not vendored in this checkout and no upstream hexes could be copied. A re-hex is only a CONDITIONAL, triggered follow-up if the operator later decides to vendor pi's theme files (revision-pinned) — it is not planned or in-progress work | `src/chatview.mjs` `THEME_ROLES`/`themeToolRoles` | `demo/tui-roles.test.mjs` | `both` |
| **Peer navigation graph** | Who sent to / received from whom, derived from the queue's `from`/`to` with direction kept (org edges are directional); exposed on `status`/`watch` so a client can switch to a peer without re-deriving it | `src/viewmodel.mjs` `peerGraph`, `peerTargets` | `demo/viewmodel.test.mjs` | cli |
| **Drift metrics** | Four measures over data already persisted, each declaring its band, evidence class and blind spot | `src/metrics.mjs`, `cli.mjs` `cmdMetrics` | `demo/metrics.test.mjs` | cli |
| **Config provenance** | `metrics` reports the revision it ran at, whether the tree was dirty, and the active extension set — so a movement can be attributed to a change | `src/provenance.mjs` | `demo/provenance.test.mjs` | cli |

### Drift metrics (`metrics`)

`check` asks "is this rig structurally wrong?"; `metrics` asks "is it getting
worse?" — from the messages, tool calls and queue transitions the store already
holds, so it is a read-only query rather than new instrumentation (D24). It writes
nothing, opens no socket and adds no table.

| Measure | Evidence class | Reads |
|---|---|---|
| `step-repetition` | direct | a tool call repeating one the seat made within its last 3 calls |
| `unverified-completions` | proxy | `complete_work` with no retrieval call in the same turn |
| `queue-ageing` | direct | minutes since the oldest queued item last changed state |
| `pass-failed` | direct | `PASS-FAILED` lines the broker wrote to `<db>.broker.log` in the last 24h (ROADMAP 78) |
| `shared-reviewer-model` | config-derived | a verifier seat sharing an author's model |

Every value travels with its band, baseline, unit and blind spot, and a reading
that cannot be judged says so rather than guessing: `no data`, `no baseline yet`,
`silent`, `unknown`. No tool calls is not "0% repetition"; no completions is not
"0% unverified".

Notices ride the attention channel above rather than claiming a surface: they
reach `status` and the `watch` footer **only when a measure has moved**, and only
for the three admissible measures — `shared-reviewer-model` stays out because it
is already visible as a `check` rule. Notices carry `scope` alongside `seat`, and
the per-seat glyph path excludes rig- and queue-scoped notices explicitly.

Cost: one scan shared with the watch highlights (0.9–1.4 ms for 14 seats × 24
entries, against a 750 ms poll). `--window all` widens the scan deliberately.
Proof: `demo/metrics.test.mjs`.

#### Provenance: what was live when these numbers were made

A movement is only attributable if the reading names the configuration that
produced it, so `metrics` also reports **the revision it ran at**, **whether the
tree was dirty**, and **the active extension set** (ROADMAP item 19).

```
config  rev fb0007e DIRTY (uncommitted changes: this revision does not describe what ran) · active: durig.router
```

Git is already the append-only change log — a rig is driven by a committed spec —
so this reads it instead of adding a store write path. `security.sec` preferred
exactly that, because a write path would add a mutable, untrusted attribution
surface while git is hash-chained and append-only. Two honesty rules it asked
for, and both are the load-bearing assertions in the test:

- **A dirty tree is a flag, not a footnote.** The revision then does not describe
  what ran, so printing the hash alone would imply more than it can support.
- **No repository is `unknown`, never `clean`.** A published or vendored copy of
  durian-pi is absence of evidence, not evidence of cleanliness.

Scoping is deliberate: `git status -- .` counts only durian-pi's own subtree, because
the usual layout has durian-pi inside a larger repository — measured here, an
unscoped check reported 92 changed paths where durian-pi's own subtree had 0, and a
flag that is always true is worse than no flag. Untracked files **do** count (a
new extension module is genuinely part of the active set and genuinely absent
from the revision); gitignored ones do not, which is why rig databases and
`node_modules` never make a reading dirty.

### Context growth over a seat's life (long context)

A seat is a **persistent conversation**: created once at `up` and reused for every
`send`, so its context accumulates across the whole project while its identity stays
fixed. Model accuracy degrades well before a context window is full, so "how long
has this seat been running" is a durability property, not a display detail.

What durian-pi does today, stated as it actually is (ROADMAP items 27–30):

| Property | State | Where |
|---|---|---|
| Compaction | **Inherited; exposed via the `compact` verb.** The platform compacts automatically and records each one as a `pi.compaction` entry carrying `reason ∈ {manual, threshold, overflow}`, and it also offers manual `Conversation.compact()`. durian-pi now exposes `compact` (commands table): with a broker alive it ROUTES through the command spool (`op:compact`, #1904) so the broker applies it live; with no broker it opens its own harness and refuses a live generation lease — the guard is for OUTSIDE writers only. It deliberately does not override the automatic settings: `stream` is the only harness setting exposed, because it is the only one with no default | `src/config.mjs` `streamSettings` (24a); harness `types.ts` (items 27, 28a); `cli.mjs` `cmdCompact`, `src/broker.mjs` `SPOOL_OPS`/`op:compact` |
| Duplicate turns on a retry | **Avoided.** A retry carrying `--request-id` reuses the existing submission, so it adds no second turn to the seat's context | `cli.mjs` `cmdSend` (24d) |
| Context pressure | **Partly visible.** `status` reports each seat's `consumed` tokens and a `window` (candidates measured/declared/advertised + a `fraction`), and the TUI context line renders it. `#2231` resolves the declared window for LOCAL seats, so the denominator is null only when no window can be resolved (a non-local seat with no declared/advertised window). The inputs already exist in storage — per-entry `usage`, and `pi.compaction` markers that carry the reason | `src/readapi.mjs` (#2231), `src/context.mjs`, `src/tui/ctxline.mjs` |
| Starting a fresh conversation | **Not possible.** Eleven commands, none of which resets a conversation, and `up --refresh` re-applies the prompt without touching it | — (item 28b) |
| Local-seat context (D105) | **Managed (decided; enforcement in flight).** A seat whose RESOLVED model provider is `local` (D104) draws a fresh context boundary before working each NEW work item — one `pi.reset` per new item, never mid-item, never across a `claimed` item, never over a live generation lease; the durable transcript is kept and the wake re-anchors from the durable instructions + the item body. Non-local (paid) seats unchanged. **Not yet enforced in code** — the wake-path boundary is routed to `impl` (#2123); today only the manual `reset`/`clean` verb and the D64 degeneration guard draw a boundary | `src/reset.mjs` `resetSeatContext`; `docs/DECISIONS.md` D104/D105; impl #2123 (enforcement, pending) | pending D105 demo |

The honest summary: growth is *inherited and only partly exposed* rather than managed — compaction is now triggerable, but the context-pressure measure and the per-model trigger are not built. The
measure is feasible without new instrumentation — assistant entries already carry
`usage` and a `cost` breakdown through `storage.scanEntries` — and a trigger belongs
per model, set from a *measured* effective window, because an advertised window is
not a usable one. Until items 27–28 land, read this section as the gap, not the
feature.

## 7. Auditing a rig (`check`)

`check` reads the rig file **and** the store, because a rig that looks correct in
the file can be running something else — a rig spec declared its
constitution inline while the store held a different one, so 13 seats ran without
their team culture and no command said so (D25).

Fourteen rules with stable ids, each with a subject and the exact fix:

| Rule | Severity |
|---|---|
| `constitution-missing` | error |
| `constitution-not-applied` | error |
| `unreachable-seat` | error |
| `dangling-edge` | error |
| `store-missing-seat` | error |
| `stray-seat` | fix-now |
| `no-verifier-seat` | fix-now |
| `single-model-rig` | fix-now |
| `seat-without-capabilities` | fix-now |
| `runbook-stale` | error |
| `runbook-unverified` | fix-now |
| `ownership-seat-missing` | error |
| `verification-without-evidence` | fix-now |
| `feature-row-missing` | fix-now |

The last five are the maintenance rules. `runbook-stale` (error) fires when a runbook was verified
before a file it names changed, and `runbook-unverified` (fix-now) when its `Verify` has never run
(#964, ROADMAP 81a; proof `demo/runbook-rules.test.mjs`). `ownership-seat-missing` (error) fires when
an ownership class names an owner seat the rig does not declare (#714; proof `demo/ownership.test.mjs`).
`verification-without-evidence` (fix-now) fires when a verification task is completed with only an
acknowledgement and no re-runnable evidence — `complete_work` now carries an `evidence` field for it
(#715; proof `demo/check-evidence.test.mjs`). `feature-row-missing` (fix-now) fires when a `feat`
commit landed with no `docs/FEATURES.md` row and no explicit "no feature surface" note (D62 /
ROADMAP 46's FEATURES-row half; proof `demo/feature-row.test.mjs`) — the machine-checked form of the
merge gate's Feature row. The rule's input is plain data the CALLER reads from git
(`src/featuredocs.mjs`), so it is SKIPPED with its reason until a caller supplies it.

`store-missing-seat` and `stray-seat` are the two directions of one disagreement
between the rig file and the store, and they are not symmetric. A seat the file
declares and the store does not hold **cannot receive work at all** (a send fails
with `unknown seat`), and the fix is `up` — so it is an `error`, like an
unapplied constitution. A seat the store holds and the file does not declare
still has a conversation, a stored persona and a working address, and `up` never
removes one, so it is a gap the operator closes by editing the file. Both
directions were found live at once on the live rig (a stray `worker`, a
missing `scribe`), which is why the rule covers both rather than reporting half a
real problem while looking complete.

Severity means **who can fix it**: `error` fails the run (exit 1, so a script can
gate on it), `fix-now` never does. A rule that cannot be judged is reported
**skipped with its reason** — never as a pass. Proof: `demo/check.test.mjs`.

### The hardened starter (`rig.starter.json`)

Rules with no passing rig to copy only tell a new user what they did wrong.
`rig.starter.json` is the configuration the rules describe, so a fresh copy of it
reports **no findings**:

- four generic seats (`pm`, `impl`, `qa`, `lead`) — no corpus or domain baked in,
  because swapping the textbook is meant to be a config change, and a starter that
  mentioned TAPL would contradict that
- an inline constitution, so the file is self-contained (`constitution` resolves
  against the CWD, so a path would only work from durian-pi's own directory)
- a verifier seat on a **second model family** (`qa`), because one model for every
  seat makes a shared blind spot systemic — and a verifier is where that costs most
- an outgoing edge for every seat: work down, reports back, escalation to `lead`

`demo/starter.test.mjs` is the proof, and its controls are the point: "0 findings"
is also what `check` reports when every rule is *skipped*, so the test breaks a copy
of the starter six ways (the second model removed, a seat left stranded, an edge to
a nonexistent seat, the verifier renamed, a store created but never `up`-ed, and a seat
left without capabilities) and requires each rule to fire. It also asserts the inline
constitution still matches `constitution.txt`, so the two copies cannot drift apart.

It also carries a **coverage ledger**: every rule in `RULES` must name the control that
exercises it, so a rule can no longer arrive uncovered - which is how
`seat-without-capabilities` first shipped with only an ad-hoc manual check - and an entry for
a rule that no longer exists fails too, so a renamed rule cannot leave its control orphaned
while still reading as coverage.

## 8. Migration and interoperability

| Feature | What it does | Where | Proof | Surface |
|---|---|---|---|---|
| **OpenRig converter** | `rig.yaml` → durian-pi v2 spec: seats, personas (each seat's `guidance/role.md`), skills, guidance, pod edges, **rig-level cross-pod edges**, coordinator send permissions, and the culture file as `constitutionInline` | `scripts/from-openrig.mjs` | `demo/converter.test.mjs` | cli |
| **Starter rig** | The packaged 4-seat starter rig | `rig.starter.json` | `node cli.mjs check rig.starter.json` | cli |
| **Pods** | Converted with a warning; pod **structure** is dropped — **limited** (deferred, ROADMAP item 11) | `scripts/from-openrig.mjs` | converter stderr warnings | cli |
| **Persona and skill mapping** | name, role, **`resources.guidance` (`guidance/role.md`) inlined as `# Role`**, model, skills (names + content), pod/team guidance and `delegates_to` map into the v2 spec without hand-editing | `scripts/from-openrig.mjs` | `demo/converter.test.mjs`, `docs/ACCEPTANCE.md` UAR-5 | cli |

**Converter gap (D26) — fixed.** The converter used to ignore OpenRig's
rig-level `edges:` list, so `ux`, `sec` and `dev` had no outgoing edge at all and
`qa`/`qa2`/`student` lost their declared escalation path (`check` reported
`unreachable-seat`). Rig-level `escalates_to` / `collaborates_with` /
`can_observe` entries now reach the spec, pod-qualified ids are normalised, and
an unresolvable one is warned about rather than dropped in silence;
`demo/converter.test.mjs` proves it.

**Converter role.md gap — fixed.** The converter inlined the pod SOP, the rig
norms and the shared skills but **dropped each seat's `guidance/role.md`**, so
the migrated spec carried no per-seat persona. It now reads the agent's declared
`resources.guidance` and inlines the file(s) as a `# Role` block ahead of the pod
context; `demo/converter.test.mjs` asserts the persona text reaches the spec, and
the generated spec was regenerated (`up --refresh` re-applies
it to the live store).

## 9. Upstream tracking

| Feature | What it does | Where | Surface |
|---|---|---|---|
| **Pinned pi main** | `pi-main.pin.json` records the exact upstream commit durian-pi is validated against. Rebased 2026-10-13 to `7d75a0e` (main tip, 42 commits, includes Release v1.2.0); spike break list EMPTY, committed tree 47/47 GREEN, live tree 49/49 | `pi-main.pin.json` | cli |
| **Drift report** | Default `sync-pi` mode: is the pin still upstream's tip? A failed lookup reports *unavailable*, never "up to date" | `scripts/sync-pi.mjs` | cli |
| **Build from source** | Sparse clone of the five tracked packages → `npm install` → build, reproducibly at the pin | `scripts/sync-pi.mjs --sync` | cli |
| **Link / unlink** | Point `node_modules` at the built tree with `--no-save`, so `package.json` and a fresh clone stay on releases | `--link` / `--unlink` | cli |
| **Pinned pi build in worktrees** | A prepared worktree runs `npm ci --prefer-offline` and THEN `node scripts/sync-pi.mjs --link` to point `node_modules` at the built vendor/pi-main tree — the PINNED pi build, not the released registry set that a plain `npm ci` resolves from HEAD's lockfile (e.g. `@earendil-works/pi-durable@1.1.0`, which can differ from the production set built from the pin). This reproduces the production dependency set in every seat/verify worktree (#2412) | `src/worktree.mjs` (post-install `--link`), `scripts/sync-pi.mjs` | `demo/worktree-lifecycle.test.mjs`, `demo/syncpi.test.mjs` (link-spec logic) | cli |
| **Re-pin deliberately** | `--update` moves the pin to main's tip, then rebuilds; the demo suite is the regression gate (50 in the worktree after this session's fixes; 49 live) | `--update` | cli |
| **Field compatibility** | `toolText()` returns both `content` (1.1.0) and `output` (main), so one code path is correct on either | `src/rig.mjs` | cli |

## 10. Proof surface

The entire check surface is the demos plus `node --check`; there is no build or
lint step.

**123 offline test demos** — one runnable proof per guarantee, each exit 0 on success. (Measured on
this checkout: 123 `demo/*.test.mjs` files — the suite is every `demo/*.test.mjs`, the exact set
`scripts/land.mjs --suite` runs; at the broker upgrade `234e06e` it was 115, validated 115/0 with the
TUI suite 15/15 on pin `8efd314f`.) The full enumeration:

```
autostart · blocked · broker · broker-cooldown-revisit ·
broker-cooperative-stop · broker-dirty-fork · broker-inbox ·
broker-intent-wake · broker-liveness · broker-log ·
broker-max-duration · broker-reconcile · broker-seat-attr ·
broker-strand · broker-wakepath · broker-wake-return ·
broker-worktree-sweep · chatlog · check · check-autodiscover ·
check-evidence · cli · cli-broker-refuse · cli-help · commit-model ·
commit-secrets · compact · config · confine · constitution ·
context-measure · converter · coordinator-queue · curate · defer ·
degeneration · degeneration-duration · degeneration-text ·
driversurvive · driversurvive-pre · dry-run · errorwording · eval ·
events · extensions · f34 · format · genlock-hardening · init ·
instance-key · job-object · land-helper · livestream · malformedcall ·
mergeguard · metrics · notices · optimizer · ownership · peekqueue ·
persistence · pitui · prepare-workspace · primer · provenance · race ·
readapi · readboundary-corrupt-live · rearmclaim · refresh ·
repeat-call · reset · resume · run · runbook-rules · sanitize ·
scheduler · seat-commit-instructions · seatguard · seatmodel ·
seatroot · seattools · secretdetect · secretredact · secrets ·
singleflight · stalledclaim · starter · stop · stoprequest ·
storewrite · stranded · streamcli · streamview · structuredhead ·
supervisor · syncpi · textwidth · thincontext · thinkinglevel ·
tui-backfill · tui-buffer · tui-client · tui-conversation ·
tui-golden · tui-input · tui-input-overlay · tui-multipane ·
tui-restore · tui-roles · tui-sync-output · tui-thinking ·
tui-toolblock · ui-driver · up-model-reset · viewmodel · watch ·
watchview · worktree · worktree-lifecycle · worktree-recursive-carry ·
worktree-reuse-deps · worktree-sweep ·
```

**4 runnable demo programs:**

| Demo | Shows |
|---|---|
| `demo/offline.mjs` | The full delegation loop on the faux provider |
| `demo/offline-v2.mjs` | Org edges and capability gating (a forbidden send is refused) |
| `demo/online.mjs` | Real DeepInfra traffic end to end (needs `DEEPINFRA_API_KEY`) |
| `demo/optimizer-eval.mjs` | Optimizer effectiveness: preservation guard plus blind judge |

## 11. Planned (not built)

Pointers, not promises — each is an item in `docs/ROADMAP.md`.

- **Dogfood durian-pi on our own work** — run our coordination through it, log what
  breaks in `docs/DOGFOOD.md`, fix or backlog; twelve findings (F1–F12) so far
  (item 10b, D31)
- **Publish durian-pi as its own repository** — `git subtree split`, vendor the
  DeepInfra catalogue, pick a licence; repo only, no releases (item 22)
- **An extension registry with named profiles** — one artifact, `core` / `recommended`
  / custom as configuration, each extension declaring its cost and blind spot
  (item 18), which is also what makes an extension toggle measurable (item 19)
- **Caveman as an optional extension** — a skill and a proxy for token reduction;
  a spike must first settle whether either applies to an in-process harness, and
  a `security.sec` position precedes its telemetry default (item 20)
- **A drill task set** so two configurations are comparable, which is what makes
  item 3's before/after measurement comparable rather than confounded (item 2)
- **Verifier model diversity** — give `qa`/`qa2` a different model family (item 3)
- **Real seat tools** — read-only corpus access or edits plus a test runner, and `complete_work` carrying evidence a verifier can re-check (item 4, M3)
- **Termination and attempt semantics** — deadline, attempt cap, repetition detection (item 6)
- **Context pressure visibility** — per-seat tokens against the seat's model, plus the
  compactions the harness already records with a reason, feeding `computeMetrics` (item 27)
- **A context-reduction surface** — expose the manual compaction the harness already
  provides and records (28a), then a fresh-conversation verb that keeps the seat's identity,
  carries the persona and any claimed item across, and never deletes the old transcript
  (28b)
- **The fresh-session practice** — when compacting is enough and when to start fresh, who
  decides, and what the operator sees (item 29)
- **Pods design** (item 11) and an **interactive client** (item 17, M4)

## 12. Deliberately not built

Decided against with reasons in `docs/DECISIONS.md` and `docs/ROADMAP.md`, so a
reader does not mistake absence for an oversight.

- **Reputation, veto and quorum arbitration** — durian-pi's seats have no adversarial
  objective and no competing claims over scarce resources (D23)
- **Flat peer swarms** — the topology the evidence is most consistent about avoiding
- **Textual interaction inside `cli.mjs`** — would break the JSON contract the
  seats drive (D21)
- **Alternate-screen TUI with in-place collapsing** — loses scrollback and pipes,
  and is the worst-supported combination with tmux
- **Terminal multiplexing as a dependency** — no per-seat terminal exists (D22)
- **Real push instead of polling** — SQLite has no cross-process notification
- **Telemetry, egress, or a new write path for measurement** — measurement is
  derived from data already persisted (D24); each would need a security consult
- **A `--fix` mode for `check`** — a config change is a hypothesis whose direction
  is recorded first (D24/D25)
- **A composite rig score** — Goodhart; no single number may gate a change

## Diagnostics

- **`DURIAN_PI_DEBUG=1` prints the error stack** on a CLI failure; the default output
  stays the byte-stable one-line message. Added because `fail()` discarded the
  stack, which made the `run --watch` crash untraceable across several cycles.
- **Thin-context returns carry a bounded preview plus a path.** A claim over the
  inline limit returns the head (<= `TOOL_RESULT_INLINE_LIMIT` chars) *and* the path
  to `cwd/.durian-pi/<id>.md`, because a coordinator seat has no read tool and a bare
  path made the body unreadable to it (found live on #100).
