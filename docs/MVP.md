# durig MVP definition and burn-down

Updated: 2026-10-08 (after repeat-call fix landed)

## MVP bar

"Functional for basic use-cases without major issues" means an operator
(human, or an LLM acting for them) can:

1. **Bootstrap a rig** from config — seats registered with personas and a
   constitution.
2. **Delegate work** between seats through the durable queue, with org-edge
   gating enforced.
3. **Trust durability** — kill/restart the daemon mid-flow; queue state and
   seat conversations survive and resume.
4. **See what is happening** — observe seat progress and spot a blocked or
   stuck seat without digging through logs.
5. **Survive messy operation** — concurrent claims never double-assign;
   errors return friendly structured states an LLM can react to.

## Burn-down order (risk-first)

| # | Item | Status | Proving test |
|---|------|--------|--------------|
| 0 | Repeat-call tolerant tools (`claim_work` overlay-proxy bug) | **DONE 2026-10-08** | `demo/repeat-call.test.mjs` |
| 1 | Persistence across daemon restart (JSONL storage, reopen same dir) | **DONE 2026-10-08** — first-run PASS; no code changes needed, pi-durable held up |
|   | Review recipe: `node demo/persistence.test.mjs` — expect `SURVIVED RESTART: item #1 [queued] "Ship the module"`, then `POST-RESTART WORKFLOW OK: item #1 -> done`, then `PERSISTENCE TEST PASS`, exit 0. The temp JSONL dir is created and removed by the test itself. Honest caveat: this simulates a clean close (`storage.close`), not a hard kill mid-write — a crash-during-write drill is a possible follow-up if we want belt-and-braces. |
| 2 | Concurrent-claim race safety | **DONE 2026-10-08** — first-run PASS; no code changes needed |
|   | Review recipe: `node demo/race.test.mjs` — expect `RACE OK: winner="ITEM #1 ..." loser=NO_QUEUED_WORK(isError:false) claimed-events=1` then `RACE TEST PASS`, exit 0. Two concurrent runs of the same seat contend for one item; exactly one wins, the loser gets a friendly non-error state, and the queue records exactly one claimed transition. |
| 3 | `durig watch` — streaming queue/transitions for the operator | **DONE 2026-10-09** — poll-based NDJSON stream (D11); found + dodged a real trap: pi-durable watches are in-process-only |
|   | Review recipe: `node demo/watch.test.mjs` — expect `WATCH OK: snapshot(seq1)=["First item"] live-update(seq2)=["First item","Second item"]` then `WATCH TEST PASS`, exit 0. Manual feel: `DURIG_DB=<db> node cli.mjs watch` in one terminal, `node cli.mjs queue` / a send in another; each change appears as a new JSON line within ~750 ms. `watch --once` prints one snapshot line and exits. |
| 4 | Blocked-seat surfacing — attention notice when a seat errors or idles with queued work | **DONE 2026-10-09** — `src/attention.mjs` (pure) + `durig status` cmd + attention carried in every `watch` line |
|   | Review recipe: `node demo/blocked.test.mjs` — expect `BLOCKED OK: notices=["idle/idle_with_queued_work","failed/last_run_failed"]` then `BLOCKED TEST PASS`, exit 0. Manual feel: `DURIG_DB=<db> node cli.mjs status` prints per-seat health; enqueue work for a seat that never runs and its notice appears in the next `watch` line within ~750 ms. Two notice kinds only: idle_with_queued_work (work waiting, nothing in flight) and last_run_failed (terminal unanswered run, reason attached). A seat actively running or settled-and-empty stays silent. |
| 5 | Quickstart doc — "boot a 2-seat rig in 5 minutes" | next | newcomer walkthrough followed verbatim |
| 5 | Quickstart doc — "boot a 2-seat rig in 5 minutes" | **DONE 2026-10-09** — `docs/QUICKSTART.md`; steps verified mechanically in faux mode (up idempotent, ps/status/send/queue/watch all behaved as written); live-mode branches marked explicitly where faux differs |
|   | Review recipe: open a fresh PowerShell, follow `docs/QUICKSTART.md` verbatim from Step 0 in faux mode; report any step that trips. Expected checkpoints: Step 2 prints created [pm, worker] then existing on rerun; Step 4 faux branch explains the empty queue and points at `demo/offline-v2.mjs`; Step 5 watch emits a health line immediately and on change. |
| 6 | Single-seat-at-a-time mode (`DURIG_MAX_CONCURRENT_SEATS=1`) — serve all seats from one local model (e.g. Qwen on a 24 GB GPU) | **DONE 2026-10-09** — `src/genlock.mjs` cross-process slot leases at the provider seam (D12); waiting-vs-stuck surfaced via lease files in status/watch |
|   | Review recipe: `node demo/singleflight.test.mjs` — expect `CAP OK: two concurrent seats finished with max 1 generation in flight`, then `SINGLEFLIGHT TEST PASS`, exit 0. Manual feel: `$env:DURIG_MAX_CONCURRENT_SEATS="1"; node cli.mjs send pm "..."` runs normally; while a LIVE generation holds the slot, another terminal's `status` shows attention `generation_in_flight`; simulate a wedged holder by writing a dead-pid JSON into `<db>.genlock.0` and status flips to `generation_stale`. Unset the env var and no lease machinery engages at all. |
| 6 | Single-seat-at-a-time mode (`maxConcurrentSeats: 1`) — lets the operator serve all seats from one local model (e.g. Qwen on a 24 GB GPU) instead of paying per-token at a hosted provider | after #4 | new test: two seats with pending work under the limit; assert at most one generation in flight at any instant (faux provider counts concurrent starts), both seats still finish, and a waiting seat is distinguishable from a stuck one (pairs with #4) |

#6 notes (scoped honestly):
- The limit must be enforced where generations are kicked off, not just in a
demo driver — otherwise it is theatre. Natural seam: the provider/runner
adapter durig already single-sources (`vendor/pi-deepinfra/models.ts` pattern);
a local Qwen endpoint is then just another provider entry.
- "Waiting for the GPU" must be surfaced as a distinct, healthy state, not
indistinguishable from "stuck" — design together with #4.
- MVP bar impact: this extends bar item 2 (delegate work) with a cost axis;
it does not change durability or race guarantees.

Rationale for the order: #1 and #2 are cheap tests that could each expose
real defects in the core promise; if either breaks, everything downstream is
built on sand. #3–#4 are the operator's eyes (without them real use is blind
flying). #5 ships only once the product underneath is trustworthy.

## Review recipes

Every change ships with a way for the operator to verify it personally:
a command to run, the expected output, and where the interesting evidence
appears (see repeat-call recipe in the session log / README examples).

## Explicitly out of MVP scope

Deferred from Core_Ideas.txt as before: constitutional-evolution search,
Big-Five injection, FIPA-ACL performatives, Contract Net auctions, dynamic
personas, blackboard architecture.

## Review recipe — real-model routing fix (D16, 2026-10-09)

Proves: seats actually route work through the queue with a real model.

```powershell
cd durig
$env:DURIG_PROVIDER="deepinfra"; $env:DURIG_DB="$PWD\scratch-review.sqlite"
node cli.mjs up rigs/tutor-pi.rig.json
node cli.mjs send pm "Delegate ONE small task to seat impl using send_work: implement a hello-world endpoint. Then reply ROUTED."
node cli.mjs queue                 # expect: #1 [queued] pm->impl ...
node cli.mjs send impl "Check your queue and handle any queued work."
node cli.mjs queue                 # expect: #1 done + #2 DONE notice impl->pm
Remove-Item scratch-review.sqlite*
```

Regression guard: `node demo/seatmodel.test.mjs` covers per-seat model strings;
the nine-demo suite covers everything else.

## Review recipe — config file + seat refresh (2026-10-10)

Why: an operator with no `DURIG_DB` ran `send pm` and the CLI acted on the
default `./rig.sqlite` instead of `tutor-pi.sqlite`; the rig "looked broken"
while being pointed at the wrong database.

```powershell
cd durig
Copy-Item durig.config.example.json durig.config.json   # edit paths as needed
node cli.mjs config            # proves source + resolved DURIG_DB
node cli.mjs up rigs/tutor-pi.rig.json --refresh   # re-apply prompts/edges
```

Regression guards: `node demo/config.test.mjs` (precedence, discovery, error
contract, secret redaction) and `node demo/refresh.test.mjs` (idempotent up,
--refresh repairs a stale prompt).

## Review recipe — pi main pin (D17, 2026-10-10)

```powershell
cd durig
node scripts/sync-pi.mjs                 # pin vs upstream tip (drift report)
node scripts/sync-pi.mjs --sync --link   # build pinned main + link it (~40s)
node demo/syncpi.test.mjs                # pin/args/drift/link-spec logic
node scripts/sync-pi.mjs --link          # re-link after any later --sync
node scripts/sync-pi.mjs --unlink        # restore released packages
```

Regression guard: the full demo suite must pass on released packages AND after
`--link`; that pair is what proves `toolText()`'s dual `content`/`output`.

## Review recipe — CLI contract + live view (2026-10-10)

`demo/cli.test.mjs` drives the real CLI in faux mode and locks the operator
contract: `up` (idempotent), `ps`, `queue`, `status`, `watch --once`, `send`,
`log`, `config`, every error path (exit 1 for bad arguments, exit 2 for an
unknown verb), and the non-`done` settle notice on stderr.

`demo/streamcli.test.mjs` covers the live view wiring across `--stream`,
`--no-stream`, and the non-tty default, asserting stdout stays one JSON
document in all three.

```powershell
cd durig
node demo/cli.test.mjs
node demo/streamcli.test.mjs
```

## Review recipe — human watch view (2026-10-10)

`node cli.mjs watch` renders a per-seat dashboard (who, role, current work,
last thing said) when stdout is a terminal, and keeps NDJSON when it is not.

```powershell
cd durig
$env:DURIG_DB = "<your rig>.sqlite"
node cli.mjs watch --once --human   # one snapshot, readable
node cli.mjs watch --once --json    # the same snapshot, machine contract
node demo/watchview.test.mjs        # formatters + CLI wiring, offline
```

Live proof used to validate the view: start `watch --human`, then `send pm` a
routing task and `send worker` to act on it — the panel moves through
`generation_in_flight` → `sent #1` → `has #1 queued` → `working on #1` → DONE
notice, and the `↳` line follows what each seat says.

Conventions and the survey behind them: `docs/RESEARCH.md`.

## Review recipe — read and follow a seat's conversation (2026-10-10)

`node cli.mjs log <seat> [limit] [--follow]` renders one seat's conversation
oldest-first, grouped into turns (operator message / agent message / tool call
plus its output) with a timestamp and an elapse delta on each turn. Tool output
is collapsed to one line with a signposted count; `--full` expands it and
`--tool-bg` adds pi's tinted tool background. `--follow` keeps it open and
prints each new turn as it commits; reads go straight to storage, so a viewer
never resumes scheduling.

```powershell
cd durig
$env:DURIG_DB = "<your rig>.sqlite"
node cli.mjs log pm --human          # history, readable
node cli.mjs log pm --follow         # history, then live
node cli.mjs log pm --json           # entries with text + raw provider message
node demo/chatlog.test.mjs           # rendering, contract, follow (offline)
```

Cross-process follow is polled at the same 750 ms interval as `watch`; SQLite
has no cross-process notification, so polling is the mechanism (see
docs/RESEARCH.md, "Live delivery of seat activity").
