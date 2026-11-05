---
name: driving-durian-pi
description: Drive the durian-pi multi-agent rig from the command line — create seats, route work, read state, and verify a change. Use when operating, dogfooding, or automating durian-pi (not when writing durian-pi's own source).
---

# Driving durian-pi

durig is a CLI that runs a team of LLM **seats** over a durable queue. Every command is
non-interactive, so this is safe to call from an agent or a script.

## The contract you must not break

- **stdout is one JSON document per command.** The human view appears only when stdout is a TTY
  (D19). Parse the JSON; never scrape the human view.
- **Read commands name the database they used.** `DURIG_DB` selects the store; without it the
  default is `./rig.sqlite`. If a command says it found no seats, the likely cause is the **wrong
  database**, not an empty rig (D18). Run `node cli.mjs config` to see what is actually in effect.
- **A non-zero exit means something.** `check` exits non-zero on an `error`-severity finding;
  `fix-now` findings never do. Gate on the exit code, not on reading prose.

## Habits that prevent the common wrong runs

- **Pass prompts with `--body-file`, not inline.** A backtick inside a shell argument is command
  substitution: the text arrives silently mangled *and the run still succeeds* (dogfood F1). Write
  the prompt to a file and use `node cli.mjs send <seat> --body-file <path>` (or `-` for stdin).
- **Use `--request-id` when a send may be retried.** A retry carrying the same id reuses the
  existing submission instead of generating again. Never derive the id from the text: two
  deliberate identical sends are two requests (D34).
- **Work enters by sending a seat; the CLI cannot enqueue.** `node cli.mjs queue` only *reads* the
  queue. Your request goes to a seat (`send pm "..."`) and that seat routes it with `send_work`.
  There is no `cli.mjs queue create`.

## The model in one screen

- **A seat is a pi-durable conversation** plus a registry entry (name, role, capabilities). A seat
  is addressed by its **bare name** (`send pm ...`) — the `name@rig` form belongs to a multi-rig
  manager, not to durig, and durig will not recognise it.
- **The queue is durable routed work:** `queued → claimed → done`, plus `claimed ↔ deferred`. A
  message informs; only a queue row assigns. Ask "does another seat have to act?" — if yes it needs
  a row.
- **Org edges are restrictive by default** once any are declared: a seat with no outgoing edge
  cannot initiate a send. `check` reports `unreachable-seat`.
- **A seat can park a question** with `defer_work` instead of guessing or going quiet — to another
  seat (edge-gated, enqueued) or to the human (visible in `status`, nothing enqueued).

## The loop

```bash
node cli.mjs config                       # which db, provider, model are in effect
node cli.mjs check <rig.json>             # audit the rig AND the store before running it
node cli.mjs worktree <path>              # an isolated checkout for a work item (see below)
node cli.mjs up <rig.json>                # create/refresh seats, edges, constitution
node intent.mjs pm --body-file <file>     # the blessed delivery path: spool a message, broker delivers it (D102)
node cli.mjs send pm "<task>" --body-file <file>   # DEPRECATED: opens a full writing harness; needs --body-file <path> with a SPACE
node cli.mjs queue                        # did it route?
node cli.mjs status                       # per-seat health + attention notices
node cli.mjs log <seat> 20                # what actually happened
node cli.mjs watch --once                 # a rig snapshot (human on a TTY, NDJSON piped)
```

**A broker must be running for a seat to wake** (`node --env-file="$HOME/.config/durig/env"
tools/broker-serve.mjs --start`); a spooled intent with the broker down is **pending, not lost**. A message never assigns
work — only a queue row does, and only a seat can create one (`D102`).

## The fast iteration loop (D213 — the operator's architecture policy)

Verify the smallest thing that covers the change, and know what each loop costs (Linux Fedora 45 `7.2.15-300.fc45.x86_64`,
node v24.22.1, measured 2026-11-05):

```bash
node scripts/test.mjs --list                    # areas + counts (0.1 s)
node scripts/test.mjs --area <area>             # one area: 1.2 s (docs) → 25.4 s (broker); prints the 5 slowest files
node tools/what-to-test.mjs --base=main --json  # the tests YOUR diff derives (plus scanFindings)
node demo/offline.mjs                           # a whole pm→worker→done delegation loop on MOCKED models, in 0.3 s
node scripts/test.mjs                           # the whole suite: 257/258 in 57.0 s — the merge gate, not the inner loop
```

The pieces are already separable (`demo/test-areas.json` + `src/testareas.mjs`; `demo/test-areas.test.mjs` fails any test the
manifest does not cover, so nothing hides by omission). Seat/agent **behavior** is testable with no model at all on the
`fauxProvider` plane — 77 of 258 demos do that, and scripted responses **drain in global call order across conversations**, which
is why ordering-sensitive faux tests rot. "We can't test that, it needs the LLM" is not an acceptable answer here. A real
model inside a test is an **opt-in lane with a declared budget** (a smaller/faster model is legitimate in test cases; the
cross-family author/verifier rule is a production staffing rule, D210/D211). Anything needing a **key, the network, a model
server, or a long sleep** belongs outside the default loop with its cost stated in seconds — `demo/deepinfra-catalog.test.mjs`
is today's live example of that rule being violated. Diagnose with `docs/runbooks/slow-loop.md`.

**Isolate the work.** Seats are confined to the `cwd` their rig declares. If a rig declares none,
seats resolve to durig's own working tree and can overwrite the operator's uncommitted work. Give
the rig a `cwd` pointing at a worktree:

```bash
node cli.mjs worktree C:/tmp/durig-dev/item-1
# then set "cwd": "C:/tmp/durig-dev/item-1/durig" (rig-level, or per seat)
```

The worktree is a detached checkout with `node_modules` bridged, so the demo suite runs there.

## What a seat may not do

- **Never push without authorization.** The `beforeTool` guard refuses `git push` unless the
  operator launched durig with `DURIG_ALLOW_PUSH=1`; a seat cannot grant itself this, because the
  grant is read from durig's own process environment, which a seat's command environment cannot
  reach.
- **WSL and Docker are refused structurally** on this host, as are `git reset --hard`,
  `git clean -f`, and `git checkout -- `.
- A refusal is legible and parkable: read the reason and `defer_work` on it rather than retrying
  variants of the command.

## Reading the state

- `check` = "is this rig structurally wrong?" — rules with severity by **who can fix it**.
- `metrics` = "is it getting worse?" — four measures, each declaring its band and **blind spot**;
  a reading it cannot judge says so (`no data`, `no baseline yet`, `silent`) rather than guessing.
- A rules finding it cannot judge is **skipped with a reason**, never reported as a pass.

## Where to read further

`docs/QUICKSTART.md` (guided walkthrough) · `docs/FEATURES.md` (what exists, where, and its proof)
· `docs/WORKFLOWS.md` (what durig is for) · `docs/SEAT-TOOLS.md` (the seat boundary) ·
`docs/STATUS.md` (current state and owed decisions) · `docs/runbooks/slow-loop.md` (what to run for a change, and how to
isolate the slow part — D213).

> **This skill is partly stale (2026-11-05).** It predates the broker era: it does not mention `DURIG_DB=./selfdev.sqlite`
> for this rig's store, the broker/spool model, `tools/broker-serve.mjs`, `tools/channel-preflight.mjs`, or the
> `rig.selfdev.json` self-dev rig, and its worktree examples use Windows paths. The current operating surface is in
> `docs/runbooks/session-start-cost.md` and `.agents/skills/delegating-to-durian-pi/SKILL.md`. Registered as ROADMAP **288**.
