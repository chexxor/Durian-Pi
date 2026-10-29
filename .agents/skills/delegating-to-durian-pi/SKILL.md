---
name: delegating-to-durian-pi
description: Drive a durian-pi team on the operator's behalf — deliver the operator's intent to the team, read the rig's state with its existing instruments (channel-preflight, broker-serve, queue-drain-audit, latency-budget, instrument-provenance, review-cite-check, model-probes, vendor-pins) rather than re-deriving measurements, and verify the team's result. Use as an external delegate; you do not do the team's work, and the team's PM owns decomposition and routing.
---

# Delegating to a durian-pi team

**Read this if you are a delegate for the operator, not a member of the team.** First decide *which*
team: the workspace routing map is in the root `AGENTS.md`, and the durig **selfdev** team has its
own runbook — read `docs/NEXT.md` (current pointer) and `docs/SELFDEV.md` (runbook)
before this file.

durig is a CLI that runs a team of LLM **seats** over a durable queue. Every command is
non-interactive, so it is safe to call from an agent or a script.

## Your place in the triangle

- **The human operator** — owns intent, rulings, and grants (push, new seats). When a genuine
  scope/priority decision appears, escalate it rather than deciding it for them.
- **You (delegate)** — translate the operator's intent into a request to the team (normally to
  `pm`), observe, verify at the seams, report back, and escalate. You may drive the loop on the
  operator's behalf; you never become a seat.
- **Seats** — decompose, claim, implement, and verify. **Routing and decomposition are theirs.**
  You do not hand-route work, and you never claim, complete, or defer a queue item yourself.

## Clock in

1. Read the current pointer (`docs/NEXT.md`) and the runbook (`docs/SELFDEV.md`).
2. `git status --short -- .` — know what is uncommitted before you touch anything.
3. `DURIG_DB=<store> node cli.mjs status` — the attention notices and non-terminal work.
4. If you are in an **operating situation a runbook covers** (broker down/stalled, store corruption,
   a degenerate seat, leaked worktrees, a merge/conflict, or you need external research), read the
   matching `docs/runbooks/<symptom>.md` before improvising — the index is `docs/runbooks/README.md`,
   and `docs/runbooks/research-request.md` governs commissioning research.
5. Resume from the pointer; do not re-derive priority from the roadmap.

## The contract you must not break

- **stdout is one JSON document per command.** The human view appears only when stdout is a TTY
  (D19). Parse the JSON; never scrape the human view. Progress notices go to **stderr**, so never
  pipe `2>&1` into a JSON parser — it fails with "Extra data". Parse stdout alone.
- **Read commands name the database they used.** `DURIG_DB` selects the store; without it the
  default is `./rig.sqlite`. If a command says it found no seats, the likely cause is the **wrong
  database**, not an empty rig (D18). Run `node cli.mjs config` to see what is actually in effect.
- **A non-zero exit means something.** `check` exits non-zero on an `error`-severity finding;
  `fix-now` findings never do. Gate on the exit code, not on reading prose.

## Habits that prevent the common wrong runs

- **Reach the team through `pm`; the CLI cannot enqueue.** `node cli.mjs queue` only *reads* the
  queue. Deliver intent with `send pm --body-file <path>` and let `pm` route it with `send_work`.
- **Pass prompts with `--body-file`, not inline.** A backtick inside a shell argument is command
  substitution: the text arrives silently mangled *and the run still succeeds* (dogfood F1).
- **Use `--request-id` when a send may be retried.** A retry carrying the same id reuses the
  existing submission instead of generating again. Never derive the id from the text: two
  deliberate identical sends are two requests (D34).

- **`send` blocks until the seat's whole generation settles.** A heavy item (e.g. a from-source
  build plus a demo sweep) can run for many minutes; a harness timeout that kills it strands the
  seat mid-generation — recover with `node cli.mjs resume`, then drive short `--max-duration` chunks.

- **`up --refresh` re-points EVERY seat**, not the one you name. Re-pointing seats for one item
  moves the others too (including a paused item's seat); plan for it and re-point back when done.

## The team's model, in one screen

- **A seat is a pi-durable conversation** plus a registry entry (name, role, capabilities), created
  once at `up` and reused for every `send`. A seat is addressed by its **bare name** (`send pm ...`);
  the `name@rig` form belongs to a multi-rig manager, and durig will not recognise it.
- **The queue is durable routed work:** `queued → claimed → done`, plus `claimed ↔ deferred` and
  `queued/claimed/deferred → cancelled` (terminal, via `cancel_work`); `held` parks a claimed item
  without a question. An unclaimed item's subject/body can be corrected with `revise_work`. A
  message informs; only a queue row assigns.
- **Org edges are restrictive by default** once any are declared: a seat with no outgoing edge
  cannot initiate a send. `check` reports `unreachable-seat`.
- **A seat parks a question** with `defer_work` rather than guessing or going quiet — to another
  seat (edge-gated, enqueued) or to the human (visible in `status`, nothing enqueued).

## The loop

```bash
node cli.mjs config                       # which db, provider, model are in effect
node cli.mjs check <rig.json>             # audit the rig AND the store before running it
node cli.mjs worktree <path>              # an isolated checkout for a work item (see below)
node cli.mjs up <rig.json> [--refresh]    # create/refresh seats, edges, constitution
node cli.mjs send pm --body-file <file>    # deliver the operator's intent to the team
node cli.mjs queue                        # did it route?
node cli.mjs status                       # per-seat health + attention notices
node cli.mjs log <seat> 20                # what actually happened
node cli.mjs run [--watch]                 # drive the queue to quiescence once (--watch polls resident)
node cli.mjs serve [--max-duration <s>]    # resident broker: wake seats on a store change, no external clock
node cli.mjs watch --once                 # a rig snapshot (human on a TTY, NDJSON piped)
```

**Keep the queue moving — `run` vs `serve`.** `run` is a clock: it drives each seat with
queued work once and exits at quiescence (`--watch` stays resident, polling every 750 ms).
`serve` is the **broker**: one long-lived process that owns the harness and runs a wake pass
whenever the store changes, so a seat with queued work is woken with **no external clock**. It
reacts to the store's in-process commit stream (coalesced into one pass; a global floor plus a
per-seat cooldown so a re-woken stalled claim cannot hot-loop), runs the supervisor each pass,
and is bounded by `--max-duration` for a test or a tool cap. A `serve` restarted later still
drives work queued while nothing ran. Read-only viewers (`watch`, `log`) still never wake a
seat (D11); the broker is the single long-lived writer that *is* the harness (D45).

`up` on an interactive terminal **starts the broker automatically** (`--no-serve` opts out,
`--serve` forces it; `DURIG_NO_SERVE=1` for scripts). At most one broker runs per database;
`serve --stop` reaps it, and `run` refuses while one drives (two drivers double-wake).

**Concurrency is three layers, and only one of them is single-writer.** The **store/harness** is
single-writer: one broker owns the store per DB, and a second driver double-wakes (D45/D46) — never
run two drivers (`run` or `serve`) on one DB. The **files** are deliberately concurrent: each seat
edits its own per-task worktree (D49), which is what makes concurrent seats safe. The
**generations** are capped at `N = DURIG_MAX_CONCURRENT_SEATS` cross-process leases (`genlock`, D12).
Sanctioned model: **one broker owns the store and drives up to N seats, each in its own worktree**;
for genuinely independent drivers, use separate databases.

**Isolate the work.** A seat resolves to the `cwd` of the command that wakes it when its rig
declares no `cwd` (dogfood F12), so a run from durig's own tree can overwrite the operator's
uncommitted work. Give the run an isolated checkout:

```bash
node cli.mjs worktree C:/tmp/durig-dev/item-1
# then set "cwd" on the rig (or per seat), or set DURIG_SEAT_ROOT and re-point:
#   DURIG_SEAT_ROOT=<checkout> node cli.mjs up <rig.json> --refresh
```

The worktree is a detached checkout with **no `node_modules` present** — a fresh worktree has none
(`node_modules` is gitignored, not bridged), so you must install dependencies per-worktree before
the demo suite can run there.

**Dependencies are installed per worktree with `npm ci --prefer-offline` — never a junction.**
`src/worktree.mjs` does NOT create a `node_modules` junction to the source tree: the junction
bridge was **removed in #330** (see the code comments — "No junction: Git 2.42 on this host deletes
THROUGH a junction… install dependencies independently: `npm ci --prefer-offline` per worktree").
The per-worktree install is `installWorktreeDeps` (runs `npm ci --prefer-offline`, ~12 s / ~111 MB),
so an `npm install`/`sync-pi --link` inside a worktree affects only that worktree's own
`node_modules` — nothing flows into the live tree. The only remaining junction reference in
the code is a CLEANUP GUARD that refuses to `git worktree remove` a worktree containing a
junction/symlink (Git 2.42 deletes THROUGH junctions, risking the main tree) — it refuses, it
does not create one.

**The oracle is `demo/*.test.mjs` in the tree under test, and the count is not fixed** — the
committed tree and the operator's live tree can hold different numbers of demos (live can carry
uncommitted ones). Count it in the tree you are testing; do not trust README/FEATURES counts.

## What the seats may not do (context, not your instructions)

- **Never push without authorization.** The `beforeTool` guard refuses `git push` unless the
  operator launched durig with `DURIG_ALLOW_PUSH=1`; a seat cannot grant itself this.
- **WSL and Docker are refused structurally** on this host, as are `git reset --hard`,
  `git clean -f`, and `git checkout -- `.
- A refusal is legible and parkable: read the reason and `defer_work` on it rather than retrying
  variants of the command.

## Reading the state

- `check` = "is this rig structurally wrong?" — rules with severity by **who can fix it**.
- `metrics` = "is it getting worse?" — four measures, each declaring its band and **blind spot**;
  a reading it cannot judge says so (`no data`, `no baseline yet`, `silent`) rather than guessing.
- A rules finding it cannot judge is **skipped with a reason**, never reported as a pass.

## Instruments you already have — run them, do not re-derive the measurement

A third of what past delegates spent their session on was one-off measurement code: **24.0%** of all tool calls
in the audited corpus (87 measurement calls per session) and **11.1%** on this host alone
(`node tools/harness-usage-census.mjs ~/.pi/agent/sessions/--home-chexxor-Git-Durian-Pi--`, 0.55 s). Every
question below has already been instrumented; the numbers in the middle column are measured costs, so the
comparison is "seconds" vs "a session".

| Run it when you need the answer | Cost | What it answers, and what it refuses |
|---|---|---|
| `node tools/channel-preflight.mjs --db ./selfdev.sqlite --rig ./rig.selfdev.json` | 3.3 s | §1–§8: the four delivery links, whether a seat's **shell can even spawn** (§7), provider-era attribution (don't chase old `402`s), host-clock posture. It does **not** start anything. |
| `node tools/broker-serve.mjs --status` / `--dry-run` | 2.8 s / 2.9 s | Broker liveness, spool backlog, providers answered, and it **refuses** on `seat-shell-availability` and `live-tree-dirty`. A `--dry-run` previews **model and cwd resets only** — it names no removals, so it is not a safety check. |
| `node tools/queue-drain-audit.mjs --db ./selfdev.sqlite` | 1.0 s | Which `held` rows have every cited gate terminal, and which artifacts are **already fully on `main`** (prints ids). An orphan-candidate verdict is **not** a release recommendation — `pm` owns release/cancel. |
| `node tools/latency-budget.mjs --db ./selfdev.sqlite` | 3.0 s | The two wall-clock currencies (what machine time costs, and where it waits). Model speed is ~12.7% of machine time. |
| `node tools/instrument-provenance.mjs` | 46 ms | Does every cited/credited script exist in `git ls-files` (ROADMAP 233), and does the suite's disk set match git's. Exits 1 on drift — a deleted suite member is otherwise a **silent shrink** (`scripts/suite.mjs` enumerates the directory). |
| `node tools/review-cite-check.mjs --gate` | 1.3 s | Docs integrity across `docs/reviews` + `docs/incidents`: undefined/colliding footnote keys, `path:line` anchors resolved **at a pin**, asserted line counts vs the pin, dead URLs. `--gate` = the wrong-today set; `--fetch N` only if you accept that 403/429 are bot-blocks, not deaths. |
| `node tools/model-probes/gate.mjs <baseUrl> <model-id> <label> --plan` | 0 (then ~2 min per cell) | The only thing that certifies a **verifier model**: defect vs matched clean control vs clean-neutral, k≥3 majority cells, false alarms on controls. `--plan` prints the fit and pair tables and spends nothing. **Gate before flipping seats** — `check`'s `single-model-rig` is a string comparison, so clearing it without a gate is a green lie (`D137`). |
| `node tools/model-probes/cold-prefill.mjs [baseUrl] [model]` | minutes | What a seat's **first** turn costs vs a prefix-cached re-send, with `MemAvailable`/`SwapUsed`/load printed beside every row — a slow model and an out-of-RAM box look identical from the endpoint. |
| `node tools/edit-failure-rate.mjs` | seconds | How seats' edits actually fail (217's acceptance names it for its shell row). |
| `node tools/vendor-pins.mjs --check` | seconds | The competitor pins are at their recorded shas (14 clones) — cite at a pin, never by re-fetching a URL (anchors rot). |
| `node scripts/clockin.mjs` | 2.6 s | The clock-in digest, in one call. |
| `DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json` | seconds | The rig's structural rules. **Always name the rig**: a bare `check` pairs `rig.json` and reports findings about a rig nobody runs. |

Three habits that come with them: **name the host, OS and timezone on every measurement you report** (244 — a
number without them cannot be compared across this rig's two machines); **a cited script is a durable artifact**
— if you build an instrument, commit it or move it into `tools/`, because eight instruments credited as landed in
`docs/ROADMAP.md` are gone from disk and from git history entirely (233, recurred 2026-10-29); and **the
verifier's capability is a measurement, not a config choice** (`docs/runbooks/verifier-model-server.md`).

## Where to read further

`docs/SELFDEV.md` (the selfdev runbook) · `docs/NEXT.md` (current pointer) ·
`docs/runbooks/README.md` (operating procedures, symptom-indexed — **read the matching one before a
recovery or an external research request**) · `docs/QUICKSTART.md` · `docs/FEATURES.md` ·
`docs/WORKFLOWS.md` · `docs/SEAT-TOOLS.md` · `docs/STATUS.md` (history).
