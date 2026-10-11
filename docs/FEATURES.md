# durig — feature inventory

What durig does **today**, where each piece lives, and what proves it. This is
the "what exists" reference: `docs/ROADMAP.md` is what comes next,
`docs/DECISIONS.md` is why, `docs/MVP.md` is how to demo anything here, and
`docs/QUICKSTART.md` is how to start from nothing.

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
| **Work queue** | Cross-seat queue with an append-only transition trail and DONE notices back to the sender | `src/rig.mjs` `RigQueue`, `enqueueItem` | `demo/race.test.mjs`, `demo/persistence.test.mjs` |
| **Router tools** | The four tools every seat gets: `send_work`, `claim_work`, `complete_work`, `peek_queue` | `src/rig.mjs` `Router` | `demo/offline.mjs`, `demo/repeat-call.test.mjs` |
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
| `send <seat> <text>` | Steer a seat, wait for its reply, return it inline | `--stream` / `--no-stream` |
| `queue` | Dump every work item with status and transitions | |
| `log <seat> [limit]` | A seat's conversation, turn-grouped | `--follow`, `--full`, `--tool-bg`, `--theme dark\|light`, `--human`/`--json` |
| `watch` | Follow rig state — human dashboard on a TTY, NDJSON when piped | `--once`, `--human`/`--json` |
| `status` | One-shot per-seat health plus attention notices | |
| `check <rig.json>` | Audit a rig file **and** the store against the research gaps | `--human`/`--json` |
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
| `DEEPINFRA_API_KEY` | Ambient credential, read from env/config, never stored or printed |

Discovery order: `$DURIG_CONFIG`, then `./durig.config.json`, then
`./.durig/config.json`. `node cli.mjs config` prints the effective values and the
source; the API key is reduced to `set`/`unset` so it is always safe to log.
Provider options are imported from `../vendor/pi-deepinfra/models.ts` — the same
module the pi extension uses — so the catalog is single-sourced.

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
| **Zero durig SQL** | durig imports one storage opener and runs no SQL of its own | `cli.mjs:26` | architecture note, `docs/STATUS.md` |

## 6. Observability

| Feature | What it does | Where | Proof |
|---|---|---|---|
| **Attention** | Derives operator-visible notices from durable state: `idle_with_queued_work`, `last_run_failed` | `src/attention.mjs` | `demo/blocked.test.mjs` |
| **Watch dashboard** | Per-seat human view — who, current work, last words — with glyphs and colour; an empty dashboard can never look healthy | `src/watchview.mjs` | `demo/watchview.test.mjs` |
| **Seat highlights** | Reads each seat's latest words and tool call **storage-direct**, never opening a harness | `src/rigstory.mjs` | `demo/watchview.test.mjs` |
| **Cross-process live stream** | `watch` polls storage at 750 ms because SQLite has no cross-process notification | `cli.mjs` `cmdWatch` | `demo/watch.test.mjs` |
| **Turn-grouped transcript** | `log` groups entries into turns with timestamps and elapse deltas; tool output collapses to one line | `src/chatview.mjs` | `demo/chatlog.test.mjs` |

## 7. Auditing a rig (`check`)

`check` reads the rig file **and** the store, because a rig that looks correct in
the file can be running something else — the tutor-pi spec declared its
constitution inline while the store held a different one, so 13 seats ran without
their team culture and no command said so (D25).

Six rules with stable ids, each with a subject and the exact fix:

| Rule | Severity |
|---|---|
| `constitution-missing` | error |
| `constitution-not-applied` | error |
| `unreachable-seat` | error |
| `dangling-edge` | error |
| `no-verifier-seat` | fix-now |
| `single-model-rig` | fix-now |

Severity means **who can fix it**: `error` fails the run (exit 1, so a script can
gate on it), `fix-now` never does. A rule that cannot be judged is reported
**skipped with its reason** — never as a pass. Proof: `demo/check.test.mjs`.

## 8. Migration and interoperability

| Feature | What it does | Where | Proof |
|---|---|---|---|
| **OpenRig converter** | `rig.yaml` → durig v2 spec: seats, personas, skills, guidance, pod edges, **rig-level cross-pod edges**, coordinator send permissions, and the culture file as `constitutionInline` | `scripts/from-openrig.mjs` | `demo/converter.test.mjs` |
| **Migrated rig** | The 13-seat tutor-pi rig, generated and committed | `rigs/tutor-pi.rig.json` | `node cli.mjs check rigs/tutor-pi.rig.json` |
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

**19 offline tests** — one runnable proof per guarantee, each exit 0 on success:

```
blocked · chatlog · check · cli · config · constitution · eval · optimizer
persistence · race · refresh · repeat-call · seatmodel · singleflight
streamcli · streamview · syncpi · watch · watchview
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
- **The converter's rig-level edges** (item 1a, D26)
- **Verifier model diversity** — give `qa`/`qa2` a different model family (item 3)
- **`metrics`** — the measurement scorecard and the surface that makes it used (item 2, design in `docs/METRICS.md`)
- **Real seat tools** — read-only corpus access or edits plus a test runner, and `complete_work` carrying evidence a verifier can re-check (item 4, M3)
- **A deferral verb** — raise a blocking question and hand it to whoever can answer (item 5)
- **Termination and attempt semantics** — deadline, attempt cap, repetition detection (item 6)
- **Extracted view model and one shared read API** (items 7-8)
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
