# durig

A minimal multi-agent rig layer built on [@earendil-works/pi-durable](https://github.com/earendil-works/pi/tree/main/packages/durable).
Started 2026-10-07 as the candidate replacement for OpenRig after a
six-way comparison survey (see `../docs/ORCHESTRATION-COMPARISON.md`).

## What it is

Seats (named agent conversations), a durable cross-seat work queue with an
append-only audit trail, org-edge send permissions, capability tags, and a
constitution injected into every seat's system prompt. All state lives in
pi-durable documents changed atomically with the transcripts that produce
them.

## Quick start

```powershell
cd durig
npm install --ignore-scripts

# offline smoke (no keys, no network)
node demo/offline.mjs        # full delegation loop
node demo/offline-v2.mjs     # edge + capability gate

# operate a rig (see docs/QUICKSTART.md for the guided walkthrough)
node cli.mjs up rig.v2.json            # bootstrap seats (idempotent)
node cli.mjs ps                        # roster
node cli.mjs send pm "hello"           # steer a seat; waits; returns reply
node cli.mjs queue                     # dump work queue
node cli.mjs status                    # per-seat health + attention notices
node cli.mjs watch                     # live NDJSON stream of queue + attention
node cli.mjs watch --once              # one snapshot line, then exit
node cli.mjs log pm 20                 # tail a seat transcript
node cli.mjs check rig.v2.json         # audit a rig against the research gaps

# real model traffic (needs DEEPINFRA_API_KEY in env)
node demo/online.mjs
```

## Auditing a rig

`check` reads the rig file **and** the store, because a rig that looks right in
the file can still be running something else: the tutor-pi spec declared its
constitution inline while the store held a different one, so all 13 seats ran
without the team culture and nothing anywhere reported it.

```powershell
node cli.mjs check rigs/tutor-pi.rig.json --human   # readable report
node cli.mjs check rigs/tutor-pi.rig.json           # JSON (the contract)
```

Every finding carries a stable rule id, a subject, and the exact fix. Severity
says **who can fix it**: `error` means the rig cannot do its job until the file
changes, and `check` exits nonzero so a script can gate on it; `fix-now` is a gap
the operator can close, and never fails a run. Rules: `constitution-missing`,
`constitution-not-applied`, `unreachable-seat`, `dangling-edge`,
`no-verifier-seat`, `single-model-rig`. A rule it cannot judge (no store to
declare whether a matched, or an unread database) is reported as **skipped with
its reason**, never as a pass.

## Configuration

| File / env | Purpose |
|---|---|
| `rig.v2.json` | Rig spec: seats (`name`, `role`, `goal`, `constraints`, `backstory`, `capabilities`, `model` — bare id or `{provider}/{modelId}`, e.g. `deepinfra/meta-llama/Llama-3.3-70B-Instruct`; a leading segment is the provider only when it names a registered provider, so slash-containing ids like `zai-org/GLM-5.3-Flash` work bare —, `instructions`), `edges` (send permissions), `constitution` (file path) |
| `constitution.txt` | Priority-ordered team rules; highest applicable rule governs |
| `DURIG_DB` | Storage path (default `./rig.sqlite`) |
| `DURIG_PROVIDER` | `deepinfra` (default) or `faux` for offline runs |
| `DURIG_MODEL` | Default model id for seats without their own |
| `DEEPINFRA_API_KEY` | Ambient credential; read from env only, never stored |
| `DURIG_OPTIMIZE` | `on`: `up` runs each seat's persona through the instruction optimizer (one model call per seat) before storing; provenance recorded. See D13. |
| `DURIG_MAX_CONCURRENT_SEATS` | Cap concurrent GENERATIONS across all seats (unset = unlimited). `1` serializes them so one local model (e.g. Qwen on a 24 GB GPU) can serve the whole rig. Waiting-vs-stuck is surfaced via lease files: `status`/`watch` report `generation_in_flight` (holder seat + since) or `generation_stale` (dead holder). See DECISIONS D12. |

Provider options are imported from `../vendor/pi-deepinfra/models.ts` — the
same module the pi-deepinfra extension feeds to pi — so catalog and serializer
compat stay single-sourced. Node 24 type-strips that TS module on import.

## Layout

```
src/rig.mjs           core: Seats/Edges/Constitution/RigQueue docs + Router tools
src/attention.mjs     pure blocked-seat detection (feeds status + watch)
src/checkup.mjs       pure rig audit rules + the human report (`cli.mjs check`)
src/ansi.mjs          the one ANSI palette the human views share
src/config.mjs        env > durig.config.json > defaults; `cli.mjs config`
demo/cli.test.mjs     the CLI contract: every command, exit code, error path
demo/watchview.test.mjs  the human watch view: extraction, layout, wiring
src/rigstory.mjs      read each seat's latest words + tool call from storage
src/watchview.mjs     render a rig snapshot for a human (TUI pair to watch)
src/chatview.mjs      render one seat's conversation for a human
demo/chatlog.test.mjs  chat rendering + --follow streaming
demo/constitution.test.mjs  a spec's constitution reaches the rig (inline or file)
demo/check.test.mjs   rig audit rules + the drift regression + CLI exit codes
demo/converter.test.mjs  OpenRig rig.yaml -> v2 spec: rig-level edges, ids, personas
docs/STATUS.md        start here: current state, decisions needed, resume facts
docs/FEATURES.md      what durig does today, where each piece lives, and its proof
docs/ROADMAP.md       milestones + the research gap analysis
docs/METRICS.md       metrics design: measures, surfacing, scope, traps (not built)
scripts/sync-pi.mjs   build + link pi's main branch at a pinned commit
pi-main.pin.json      the pinned upstream commit durig is validated against
src/seatmodel.mjs     per-seat {provider}/{modelId} resolution
src/optimizer.mjs     instruction optimizer + preservation guard (D13, D14)
src/judge.mjs         blind pairwise prompt judge (D14)
src/genlock.mjs       cross-process generation slot leases (MVP #6, D12)
cli.mjs               operator CLI (JSON output; LLM-friendly contract)
demo/*.test.mjs       one runnable proof per guarantee:
                        repeat-call.test.mjs    duplicate tool calls stay friendly
                        persistence.test.mjs    state survives storage close/reopen
                        race.test.mjs           concurrent claims: one winner, no double-assign
                        watch.test.mjs          cross-process live stream works
                        blocked.test.mjs        idle-with-work and failed runs surface as attention
                        singleflight.test.mjs   generation cap holds across concurrent seats
demo/offline*.mjs     faux-model delegation loops (no keys needed)
demo/online.mjs       real DeepInfra end-to-end test
demo/optimizer-eval.mjs    optimizer effectiveness benchmark (guard + blind judge)
demo/eval.test.mjs    mechanics test for the guard and judge
scripts/from-openrig.mjs   OpenRig rig.yaml -> durig v2 converter (pods, skills, guidance, rig-level edges)
rigs/tutor-pi.rig.json    the migrated 13-seat tutor-pi rig
docs/                 QUICKSTART, FEATURES, MVP burn-down, STATUS, ROADMAP, METRICS, decisions D1-D26, research
```

## Status

**MVP complete (2026-10-09)** — all six burn-down items done and proven:
seats with personas and constitution injection; durable cross-seat queue with
append-only audit trail; org-edge send permissions and capability tags;
restart-survival; concurrent-claim race safety; operator visibility via
`status` + streaming `watch` with blocked-seat attention notices; and the
single-generation-at-a-time mode for serving a whole rig from one local model.
Known gaps vs OpenRig are tracked in ../docs/ORCHESTRATION-COMPARISON.md;
the post-MVP backlog lives in docs/MVP.md.

## Tracking pi's main branch

`@earendil-works/pi-durable` ships from a fast-moving monorepo (14 commits past
the last release within a day, including API renames). There is **no dev/nightly
npm dist-tag**, so `main` is the dev channel and must be **built from source**.
`pi-main.pin.json` records the exact commit durig is validated against.

```powershell
node scripts/sync-pi.mjs            # drift: is the pin still upstream's tip?
node scripts/sync-pi.mjs --sync     # clone+install+build the pinned commit (~40s)
node scripts/sync-pi.mjs --link     # point node_modules at the built packages
node scripts/sync-pi.mjs --update   # move the pin to main's tip, then rebuild
node scripts/sync-pi.mjs --unlink   # back to the released packages
```

`--link` uses `npm install --no-save`, so **`package.json` is never modified**
and nothing un-installable-by-others can be committed. The build tree lives in
`vendor/pi-main/` (gitignored, reproducible from the pin). A plain `npm install`
reverts to the released packages.

The tool-result field is returned as **both** `content` (1.1.0) and `output`
(current main) by `toolText()` in `src/rig.mjs`, so durig is correct on either.
