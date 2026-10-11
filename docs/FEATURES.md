# durig — feature inventory

What durig does **today**, where each piece lives, and what proves it. This is
the "what exists" reference: `docs/ROADMAP.md` is what comes next,
`docs/DECISIONS.md` is why, `docs/MVP.md` is how to demo anything here,
`docs/QUICKSTART.md` is how to start from nothing, and `docs/WORKFLOWS.md` is
what the whole thing is *for* — the workflows each feature serves, and the loop in
each that must never break.

Sections 1-10 describe what is **built**, each with the test or run that proves
it; anything carrying a stated limitation is marked **limited** in place.
Section 11 is planned, section 12 is deliberately absent.

## 1. The rig model

| Feature | What it does | Where | Proof |
|---|---|---|---|
| **Seats** | A named agent = one pi-durable conversation plus a registry entry (name, conversation id, role, capabilities) | `src/rig.mjs` `Seats`, `registerSeat`, `seatId` | `demo/cli.test.mjs`, `demo/constitution.test.mjs` |
| **Org edges** | Who may `send_work` to whom; **restrictive by default** when any edge is declared, "open" when none are | `src/rig.mjs` `Edges`, `assertSendAllowed` | `demo/offline-v2.mjs` (forbidden send refused) |
| **Capability tags** | Seats advertise tags; `send_work` can require one, and the refusal names what the target actually has | `src/rig.mjs` `assertSendAllowed` | `demo/offline-v2.mjs` |
| **Constitution** | One text injected into every seat's system prompt, read **per request** so a single edit re-arms all seats | `src/rig.mjs` `Constitution`, `section("durig-constitution", …)` | `demo/constitution.test.mjs`, `demo/offline-v2.mjs` |
| **Persona compilation** | `role`/`goal`/`backstory`/`constraints`/`capabilities`/`instructions` compile into one prompt | `src/rig.mjs` `compilePersona` | `demo/refresh.test.mjs` |
| **Work queue** | Cross-seat queue with an append-only transition trail and DONE notices back to the sender; `queued → claimed → done`, plus `claimed ↔ deferred` | `src/rig.mjs` `RigQueue`, `enqueueItem` | `demo/race.test.mjs`, `demo/persistence.test.mjs` |
| **Router tools** | The six tools every seat gets: `send_work`, `claim_work`, `complete_work`, `defer_work`, `resume_work`, `peek_queue` | `src/rig.mjs` `Router` | `demo/offline.mjs`, `demo/repeat-call.test.mjs`, `demo/defer.test.mjs` |
| **Deferral** | A seat parks a claimed item on a question instead of guessing or going quiet: to the human operator (visible in `status`/`watch`, nothing enqueued) or to a seat (edge-gated, enqueued as real work), then `resume_work` takes it back. Not terminal — an item parked with no way back would be worse than the prose it replaces | `src/rig.mjs` `defer_work`/`resume_work`, `src/attention.mjs` `deferred_awaiting_answer` | `demo/defer.test.mjs`, `demo/watchview.test.mjs` |
| **Protocol primer** | A short protocol section appended to every seat prompt, so a migrated persona knows the tools exist | `cli.mjs` `buildSeatPrompt` | `demo/refresh.test.mjs` |

The rig defines **four pi-durable documents** — `durig.seats`, `durig.edges`,
`durig.constitution`, `durig.queue` — and no other durig document: no
schema ownership, no migration, no SQL. The one piece of durig state outside the
store is the generation-slot lease files (`src/genlock.mjs`, D12).

## 2. Operating surface (CLI)

`cli.mjs` is the operator interface and the contract that LLM operators drive.
Every command prints **one JSON document**; human-readable output appears only on
a terminal (D19). It is non-interactive by decision (D21) and never prompts.

| Command | Does | Flags |
|---|---|---|
| `up <rig.json>` | Create/refresh seats, edges and constitution from a spec; idempotent | `--refresh` re-applies stored prompts and models |
| `ps` | Seat roster with conversation ids and roles | |
| `send <seat> <text>` | Steer a seat, wait for its reply, return it inline | `--stream` / `--no-stream`, `--body-file <path>` (or `-`), `--request-id <id>` (retry-safe) |
| `queue` | Dump every work item with status and transitions | |
| `log <seat> [limit]` | A seat's conversation, turn-grouped | `--follow`, `--full`, `--tool-bg`, `--theme dark\|light`, `--human`/`--json` |
| `watch` | Follow rig state — human dashboard on a TTY, NDJSON when piped | `--once`, `--human`/`--json` |
| `status` | One-shot per-seat health plus attention notices | |
| `check <rig.json>` | Audit a rig file **and** the store against the research gaps | `--human`/`--json` |
| `metrics [rig.json]` | Drift measures, each with its band, baseline and blind spot | `--window N\|all`, `--human`/`--json` |
| `optimize <text>` | Rewrite a draft instruction through the optimizer | |
| `config` | Show the effective settings and which source supplied each | |

Two operator-facing behaviours are load-bearing:

- **Wrong-database guard** — read commands name the resolved database and warn
  when it holds no seats, because a missing `DURIG_DB` otherwise looks exactly
  like a healthy quiet rig (D18).
- **Failure honesty** — errors come back as `{ok:false,error}` with a nonzero
  exit instead of a stack trace; a `send` that does not settle as `done` says so
  on stderr.

## 3. Configuration

One vocabulary for both the environment and the config file, resolved
**env → `durig.config.json` → built-in default**.

| Key | Meaning |
|---|---|
| `DURIG_DB` | Storage path (default `./rig.sqlite`) |
| `DURIG_PROVIDER` | `deepinfra` (default) or `faux` for offline runs |
| `DURIG_MODEL` | Default model for seats without their own |
| `DURIG_MAX_CONCURRENT_SEATS` | Cap concurrent generations rig-wide (unset = unlimited) |
| `DURIG_OPTIMIZE` | `on`: run each persona through the optimizer during `up` |
| `DURIG_EXTENSIONS` | Comma-separated pi-durable extension modules to install. A path that cannot load **fails the command** rather than being skipped, and `up` reports the names it installed. Proof: `demo/extensions.test.mjs` |
| `DURIG_STREAM_TIMEOUT_MS` | Total request timeout for one generation attempt. Unset = platform default (`openai` SDK, 600000 ms). The only harness setting durig exposes, because it is the only one with no default and a real reason to move in both directions. Proof: `demo/config.test.mjs` |
| `DEEPINFRA_API_KEY` | Ambient credential, read from env/config, never stored or printed |

Discovery order: `$DURIG_CONFIG`, then `./durig.config.json`, then
`./.durig/config.json`. `node cli.mjs config` prints the effective values and the
source; the API key is reduced to `set`/`unset` so it is always safe to log.
Provider options are imported from `src/providers/deepinfra-models.ts` — a vendored
copy of the module the pi extension uses — so the catalog is single-sourced and
durig stands alone (see `src/providers/PROVENANCE.md`).

## 4. Seats and models

| Feature | What it does | Where | Proof |
|---|---|---|---|
| **Per-seat model** | `seat.model` as `{provider}/{modelId}` or a bare id; a leading segment counts as the provider **only** when it names a registered provider, so slash-bearing ids like `zai-org/GLM-5.3-Flash` work bare | `src/seatmodel.mjs` | `demo/seatmodel.test.mjs` |
| **Live view** | A running generation streams to stderr so `send` shows progress without splitting the stdout contract | `src/streamview.mjs` | `demo/streamview.test.mjs`, `demo/streamcli.test.mjs` |
| **Generation slots** | Cross-process file leases cap concurrent generations; a live holder is healthy waiting, a dead holder is surfaced as stale | `src/genlock.mjs` | `demo/singleflight.test.mjs` |
| **Instruction optimizer** | Rewrites a draft instruction for clarity, with a **preservation guard** that falls back when the rewrite drops signal | `src/optimizer.mjs` | `demo/optimizer.test.mjs`, `demo/optimizer-eval.mjs` |
| **Blind judge** | Pairwise, position-randomised evaluation of two prompts | `src/judge.mjs` | `demo/eval.test.mjs` |

Per-seat models flow through both seat-creation paths (`up` and `up --refresh`)
from one helper (`src/seatmodel.mjs`), so the two paths cannot drift apart
(`demo/refresh.test.mjs`).

## 5. Durability and concurrency

| Feature | What it does | Where | Proof |
|---|---|---|---|
| **Persistent state** | Everything lives in SQLite through pi-durable; each CLI call opens storage, acts, closes | `cli.mjs` `openHarness` | `demo/persistence.test.mjs` |
| **Restart re-arm** | `harness.resume()` re-arms scheduling so queued work continues after a process restart | `cli.mjs` `openHarness` | `demo/persistence.test.mjs` |
| **Race safety** | Concurrent claims yield one winner and no double assignment | queue transitions | `demo/race.test.mjs` |
| **Repeat-call tolerance** | A replayed tool call returns current state instead of erroring on a settled overlay | `src/rig.mjs` | `demo/repeat-call.test.mjs` |
| **Request-idempotent send** | `send --request-id` makes one send one submission: a retry carrying the same id reuses the existing submission rather than generating again, and returns the original reply. The id is never derived from the text, because two deliberate identical sends are two requests | `cli.mjs` `cmdSend` | `demo/cli.test.mjs` |
| **Zero durig SQL** | durig imports one storage opener and runs no SQL of its own | `cli.mjs:26` | architecture note, `docs/STATUS.md` |

## 6. Observability

| Feature | What it does | Where | Proof |
|---|---|---|---|
| **Attention** | Derives operator-visible notices from durable state: `idle_with_queued_work`, `last_run_failed` | `src/attention.mjs` | `demo/blocked.test.mjs` |
| **Watch dashboard** | Per-seat human view — who, current work, last words — with glyphs and colour; an empty dashboard can never look healthy | `src/watchview.mjs` | `demo/watchview.test.mjs` |
| **Seat highlights** | Reads each seat's latest words and tool call **storage-direct**, never opening a harness | `src/rigstory.mjs` | `demo/watchview.test.mjs` |
| **Cross-process live stream** | `watch` polls storage at 750 ms because SQLite has no cross-process notification | `cli.mjs` `cmdWatch` | `demo/watch.test.mjs` |
| **Drift metrics** | Four measures over data already persisted, each declaring its band, evidence class and blind spot | `src/metrics.mjs`, `cli.mjs` `cmdMetrics` | `demo/metrics.test.mjs` |
| **Config provenance** | `metrics` reports the revision it ran at, whether the tree was dirty, and the active extension set — so a movement can be attributed to a change | `src/provenance.mjs` | `demo/provenance.test.mjs` |

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
  durig is absence of evidence, not evidence of cleanliness.

Scoping is deliberate: `git status -- .` counts only durig's own subtree, because
the usual layout has durig inside a larger repository — measured here, an
unscoped check reported 92 changed paths where durig's own subtree had 0, and a
flag that is always true is worse than no flag. Untracked files **do** count (a
new extension module is genuinely part of the active set and genuinely absent
from the revision); gitignored ones do not, which is why rig databases and
`node_modules` never make a reading dirty.

### Context growth over a seat's life (long context)

A seat is a **persistent conversation**: created once at `up` and reused for every
`send`, so its context accumulates across the whole project while its identity stays
fixed. Model accuracy degrades well before a context window is full, so "how long
has this seat been running" is a durability property, not a display detail.

What durig does today, stated as it actually is (ROADMAP items 27–30):

| Property | State | Where |
|---|---|---|
| Compaction | **Inherited and unexposed.** The platform compacts automatically and records each one as a `pi.compaction` entry carrying `reason ∈ {manual, threshold, overflow}`, and it also offers manual `Conversation.compact()` — but durig exposes no verb, so an operator can neither trigger one nor see that one happened. It deliberately does not override the automatic settings: `stream` is the only harness setting exposed, because it is the only one with no default | `src/config.mjs` `streamSettings` (24a); harness `types.ts` (items 27, 28a) |
| Duplicate turns on a retry | **Avoided.** A retry carrying `--request-id` reuses the existing submission, so it adds no second turn to the seat's context | `cli.mjs` `cmdSend` (24d) |
| Context pressure | **Not visible.** Nothing reports how full a seat's context is; the first signal is a seat behaving worse. Both inputs already exist in storage — per-entry `usage`, and `pi.compaction` markers that carry the reason | — (item 27) |
| Starting a fresh conversation | **Not possible.** Eleven commands, none of which resets a conversation, and `up --refresh` re-applies the prompt without touching it | — (item 28b) |

The honest summary: growth is *inherited and unexposed* rather than managed. The
measure is feasible without new instrumentation — assistant entries already carry
`usage` and a `cost` breakdown through `storage.scanEntries` — and a trigger belongs
per model, set from a *measured* effective window, because an advertised window is
not a usable one. Until items 27–28 land, read this section as the gap, not the
feature.

## 7. Auditing a rig (`check`)

`check` reads the rig file **and** the store, because a rig that looks correct in
the file can be running something else — the tutor-pi spec declared its
constitution inline while the store held a different one, so 13 seats ran without
their team culture and no command said so (D25).

Nine rules with stable ids, each with a subject and the exact fix:

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

`store-missing-seat` and `stray-seat` are the two directions of one disagreement
between the rig file and the store, and they are not symmetric. A seat the file
declares and the store does not hold **cannot receive work at all** (a send fails
with `unknown seat`), and the fix is `up` — so it is an `error`, like an
unapplied constitution. A seat the store holds and the file does not declare
still has a conversation, a stored persona and a working address, and `up` never
removes one, so it is a gap the operator closes by editing the file. Both
directions were found live at once on the tutor-pi rig (a stray `worker`, a
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
  against the CWD, so a path would only work from durig's own directory)
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

| Feature | What it does | Where | Proof |
|---|---|---|---|
| **OpenRig converter** | `rig.yaml` → durig v2 spec: seats, personas, skills, guidance, pod edges, **rig-level cross-pod edges**, coordinator send permissions, and the culture file as `constitutionInline` | `scripts/from-openrig.mjs` | `demo/converter.test.mjs` |
| **Migrated rig** | The 15-seat tutor-pi rig, generated and committed | `rigs/tutor-pi.rig.json` | `node cli.mjs check rigs/tutor-pi.rig.json` |
| **Pods** | Converted with a warning; pod **structure** is dropped — **limited** (deferred, ROADMAP item 11) | `scripts/from-openrig.mjs` | converter stderr warnings |
| **Persona and skill mapping** | name, role, model, skills, guidance and `delegates_to` map into the v2 spec without hand-editing | `scripts/from-openrig.mjs` | `docs/ACCEPTANCE.md` UAR-5 |

**Converter gap (D26) — fixed.** The converter used to ignore OpenRig's
rig-level `edges:` list, so `ux`, `sec` and `dev` had no outgoing edge at all and
`qa`/`qa2`/`student` lost their declared escalation path (`check` reported
`unreachable-seat`). Rig-level `escalates_to` / `collaborates_with` /
`can_observe` entries now reach the spec, pod-qualified ids are normalised, and
an unresolvable one is warned about rather than dropped in silence;
`demo/converter.test.mjs` proves it.

## 9. Upstream tracking

| Feature | What it does | Where |
|---|---|---|
| **Pinned pi main** | `pi-main.pin.json` records the exact upstream commit durig is validated against | `pi-main.pin.json` |
| **Drift report** | Default `sync-pi` mode: is the pin still upstream's tip? A failed lookup reports *unavailable*, never "up to date" | `scripts/sync-pi.mjs` |
| **Build from source** | Sparse clone of the four packages → `npm install` → build, reproducibly at the pin | `scripts/sync-pi.mjs --sync` |
| **Link / unlink** | Point `node_modules` at the built tree with `--no-save`, so `package.json` and a fresh clone stay on releases | `--link` / `--unlink` |
| **Re-pin deliberately** | `--update` moves the pin to main's tip, then rebuilds; the 19-demo suite is the regression gate | `--update` |
| **Field compatibility** | `toolText()` returns both `content` (1.1.0) and `output` (main), so one code path is correct on either | `src/rig.mjs` |

## 10. Proof surface

The entire check surface is the demos plus `node --check`; there is no build or
lint step.

**30 offline tests** — one runnable proof per guarantee, each exit 0 on success:

```
blocked · chatlog · check · cli · config · confine · constitution · converter
defer · eval · extensions · metrics · optimizer · persistence · primer
provenance · race · refresh · repeat-call · seatguard · seatmodel · seattools
singleflight · starter · streamcli · streamview · syncpi · watch · watchview
worktree
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

- **A hardened starter rig** so a new user gets a spec that passes `check` (item 1)
- **Dogfood durig on our own work** — run our coordination through it, log what
  breaks in `docs/DOGFOOD.md`, fix or backlog; six findings from the first session
  (item 10b, D31)
- **Publish durig as its own repository** — `git subtree split`, vendor the
  DeepInfra catalogue, pick a licence; repo only, no releases (item 22)
- **A `stray-seat` `check` rule** — the store holds a seat the spec does not declare,
  and `up` never removes one (item 10a)
- **An extension registry with named profiles** — one artifact, `core` / `recommended`
  / custom as configuration, each extension declaring its cost and blind spot
  (item 18), which is also what makes an extension toggle measurable (item 19)
- **Caveman as an optional extension** — a skill and a proxy for token reduction;
  a spike must first settle whether either applies to an in-process harness, and
  a `security.sec` position precedes its telemetry default (item 20)
- **Target workflows, written down** — who, trigger, the loop that must never break,
  what "done" means; without it "recommended" is taste (item 21)
- **A drill task set** so two configurations are comparable, which is what makes
  item 3's before/after measurement comparable rather than confounded (item 2)
- **Verifier model diversity** — give `qa`/`qa2` a different model family (item 3)
- **Real seat tools** — read-only corpus access or edits plus a test runner, and `complete_work` carrying evidence a verifier can re-check (item 4, M3)
- **A deferral verb** — raise a blocking question and hand it to whoever can answer (item 5)
- **Termination and attempt semantics** — deadline, attempt cap, repetition detection (item 6)
- **Extracted view model and one shared read API** (items 7-8)
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

- **Reputation, veto and quorum arbitration** — durig's seats have no adversarial
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
