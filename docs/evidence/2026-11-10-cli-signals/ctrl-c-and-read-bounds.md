# Every CLI verb answers or fails fast, and Ctrl-C ends the verb (measured)

**Goal:** "Make every durian-pi CLI verb answer or fail fast against a team that is running or
stopped — no 120 s silence — and make Ctrl-C actually terminate the command that is running."
(ROADMAP **314**; the broker-read half is row **#6160**; decision recorded as **D262**.)

**Host for every number below**, measured with the measurement
(`uname -s && uname -r && (. /etc/os-release && echo "$PRETTY_NAME") && node -v && git --version`):
**Linux**, **Fedora Linux 45 (Forty Five)**, kernel `7.2.15-300.fc45.x86_64`, node **v24.22.1**,
`git version 2.56.0`. No hostname appears in this file.

**Commits:** `41000315` (signal seam + bounded reads + the read-only store shim + 4 demos),
`c32557cb` (an interrupted verb exits 130), and this session's `src/cli-seam.mjs` (install the seam
before the import graph resolves). Baseline for every BEFORE number: **`e06626af`**, the tip before
the seam, run in its own detached worktree
(`git worktree add --detach .spike/baseline-signals e06626af`).

## How it was measured

Three instruments, all in gitignored `.spike/` (promotion into `tools/` needs a `lead` row —
ROADMAP 312):

- `.spike/sigint-probe.mjs` — per verb: run it once un-signalled, then raise **SIGINT** at 50 % of
  that duration, then **SIGTERM**. Every run is bounded by an outer `kill` so the measurement itself
  cannot hang. The "handler before the seam" column is **retrieved, not remembered**: the probe
  greps `git show <baseline>:cli.mjs` for `process.on("SIGINT"` inside each `cmd<Verb>` body.
  Both trees ran it against the **same** 139,264 B store made by `node cli.mjs up rig.starter.json`.
- `.spike/wedge-before.mjs` / `.spike/wedge-after.mjs` — the identical forged wedge: a real store, a
  `<db>.broker.json` naming a pid that is genuinely alive, `heartbeatAt` fresh, `lastPassAt: null`,
  nothing draining the spool. No fleet, no key, no network.
- `.spike/seam-window.mjs` / `.spike/seam-install-time.mjs` — raise SIGINT at 120…450 ms and record
  how the process actually left. `performance.now()` inside `src/cli-seam.mjs` says the handler is
  registered at **271 ms** after process start.

## A. The wedge: the bug and its cure, one row pair

`SIGINT` raised **1,500 ms** into the verb, same 139 KB store, same forged broker state.

| Verb | BEFORE (`e06626af`) | AFTER (current `main`) |
|---|---|---|
| `watch --once --json` | wall **120,547 ms**, exit **1** — the signal landed **119,043 ms before the process gave up**. Ctrl-C flipped a `stopping` flag on a loop already parked in an await | wall **1,518 ms**, exit **130**, **15 ms** after the signal |
| `status --json` | wall 1,514 ms, died by signal (`signal:SIGINT`), **0 bytes**, no report line | wall 1,515 ms, exit **130**, **14 ms** after |
| `queue --json --no-body` | wall 1,513 ms, died by signal, no code to branch on | wall 1,521 ms, exit **130**, **20 ms** after |

Resident verbs, same scratch store, signal at ~5 s into a 10 s window:

| Verb | BEFORE: SIGINT → exit | AFTER: SIGINT → exit | signal-to-exit |
|---|---|---|---|
| `watch --json` (follow) | 10,096 ms → **0** | 10,029 ms → **130** | 22 ms |
| `log pm 5 --follow` | 10,056 ms → **0** | 10,030 ms → **130** | 23 ms |
| `run --watch --max-duration 10` | 5,660 ms → **0** | 5,430 ms → **130** | 22 ms |
| `serve --max-duration 10` | 5,223 ms → **0** | 5,171 ms → **130** | 19 ms |

BEFORE, a resident verb *did* stop — it just exited **0**, indistinguishable from a verb that
finished the work. That is how a wedged rig hides: the caller sees success and keeps waiting.
`serve` on a scratch store, SIGINT at 4 s, printed
`{"ok":true,"command":"serve","passes":1,"stoppedBy":"signal"}` and the broker log said the truth:

```
2026-11-10T22:47:46.935Z STOP-REQUESTED source=signal pid=835526
2026-11-10T22:47:46.935Z EXIT pid=835526 reason=signal passes=1
```

## B. Per verb: which handler existed before the seam

`cli.mjs` verbs and their SIGINT disposition in `git show e06626af:cli.mjs` (grepped from the
source, not recalled):

| Verb | Handler in `e06626af` | Node's default applied? | Today |
|---|---|---|---|
| `status`, `queue`, `ps`, `config`, `metrics` | none | yes — silent signal death | seam → **130** |
| `watch`, `log`, `events` | own `stopping = true` flag | no, but the flag never reached the await | seam → **130**, loop checks `isStopping()` each poll |
| `run --watch`, `serve` | own `process.on("SIGINT")` | no | seam owns the flag; the verb only names *why* it stopped (`cli.mjs:1821`, `:1895`) |
| `send`, `up`, `reset`, `resume` | none / own | yes | seam → **130** if interrupted, **0** if already finished |
| `ui.mjs` | own `quit` at `ui.mjs:315-316` | no | unchanged (headless `ui.mjs` exits **2**: it needs a TTY) |
| `tui.mjs` | none (`grep -nE "SIGINT\|SIGTERM" tui.mjs` → no hits) | yes | unmapped beyond `--help`; recorded as an open item |

The early window, measured on `cli.mjs ps` (`node .spike/seam-window.mjs`, both trees):

| SIGINT at | BEFORE `e06626af` | AFTER (seam installed at 271 ms) |
|---|---|---|
| 120 ms | `signal:SIGINT`, 130 ms wall | `signal:SIGINT`, 130 ms wall |
| 200 ms | `signal:SIGINT`, 208 ms | `signal:SIGINT`, 213 ms |
| 250 ms | `signal:SIGINT`, 259 ms | `signal:SIGINT`, 259 ms |
| 300 ms | `signal:SIGINT`, 303 ms | **130**, 507 ms |
| 350 ms | `signal:SIGINT`, 362 ms | **130**, 509 ms |
| 400 ms | 0 (verb had finished), 387 ms | **130**, 513 ms |

Honest limit: ESM cannot run code before its import graph resolves, so the first **~270 ms** is
still node's default disposition. That is a fast death (≤ 320 ms), not a silence; pinning a report
line there needs a separate entry file — a seam, not a patch (D212).

## C. The live rig: reads answered while a broker is resident

`node tools/broker-serve.mjs --start --max-duration 600` (preflight: 0 blocking, 5 notes) → broker
pid **562329**, live generation leases held by seats. Every verb wrapped in `timeout`:

| Verb | wall | exit | served by |
|---|---|---|---|
| `status --json` | 4,758 ms | 0 | broker |
| `queue --json --no-body` | 2,587 ms | 0 | broker |
| `watch --once --human` | 2,212 ms | 0 | broker |
| `ps` | 878 ms | 0 | broker |
| `log pm 5` | 1,950 ms | 0 | broker |
| `status --local --json` | 3,133 ms | 0 | store, labelled: `note: --local read health from the store directly while broker pid 562329 is resident; 3 generation lease(s) live (qa, qa, qa)` |
| `watch --json` + SIGINT at 4 s | 4,079 ms | **130** | **79 ms after the signal** |

The broker served those reads out of band: `grep -c READ-DRAIN ./selfdev.sqlite.broker.log` = **38**,
e.g. `READ-DRAIN served=1 dead=0 dup=0 ms=792`, and the read spool was empty afterwards
(`selfdev.sqlite.broker.inbox` = 0 files).

## D. What the seam does **not** cover — stated, not smoothed over

1. **The first ~270 ms** (see §B). Bounded death, no report line.
2. **A blocked event loop delays the grace.** A 100 ms heartbeat probe
   (`.spike/block-window-probe.mjs`) shows a ~250–350 ms block during module load and, in one run, a
   **~2.5 s** block inside a broker read that had to read and parse a multi-MB result file. The
   force-exit timer (`gracefulMs` 1,500 ms for verbs; `resolveStopGraceMs() + 3000` for `serve` and
   `run --watch`) can only fire when the loop is free. Every read in §C still answered in under 5 s,
   so nothing here is a 120 s silence — but the bound is "bounded by the blocking call in flight",
   not a hard wall. Making the result read non-blocking is the next cheap step.
3. **`ui.mjs` / `tui.mjs` are separate surfaces.** `ui.mjs:315-316` registers `quit` on
   SIGINT/SIGTERM (verified with `grep -nE "SIGINT|SIGTERM" ui.mjs`); headless `ui.mjs` exits 2
   because it needs a TTY. `tui.mjs` registers nothing and is unmapped beyond `--help`.
4. **Result-channel GC is per-pass.** `gcIntentResults` (`src/broker.mjs:417`, called in the pass at
   `src/broker.mjs:1361`) is not on the read-drain path, so a wedged pass leaves multi-MB answer
   files in `<db>.broker.inbox.out/` past the 10-minute `INTENT_RESULT_TTL_MS` until a pass runs.
   Measured: ten ~29 MB files present while the pass clock was frozen. This is the same territory as
   the architect's design position in `docs/reviews/architecture-exit-drain-6391.md` (branch
   `item-6381`, rows **#6391/#6390**): the exit path must *account* for the spool without touching
   the store. Not implemented here — that is the team's row. The file is **on the branch, not on `main`**: read it
   with `git show item-6381:docs/reviews/architecture-exit-drain-6391.md` (verified 23:4xZ; first lines `review: the
   exit path must account for the spool without touching the store` / `item: #6391`).

## E. The gates that now pin this

```bash
node scripts/test.mjs --all --jobs 4        # 294/294 in 117.6 s
node scripts/test.mjs --all --jobs 8        # 293/294 in 85.1 s — demo/checkup-citation.test.mjs red,
                                          #   green standalone (exit 0); SwapFree 72 kB: contention,
                                          #   see docs/runbooks/suite-red-standalone-green.md
node demo/cli-sigint-exits.test.mjs         # 4.99 s: watch --once / status / queue exit 130 in
                                          #   128/125/122 ms of the signal; `ps` interrupted at 320 ms
                                          #   exits 130 in 508 ms; the broker-less read answers, exit 0
node demo/read-drain-out-of-band.test.mjs   # 213 ms
node demo/read-intent-interrupt.test.mjs    # 3.9 s
node demo/readonly-store-parity.test.mjs    # 222 ms, 15 views byte-identical
node scripts/test.mjs --area broker --jobs 8  # 73/73 in 23.1 s
```

## F. The regression the read drain caused, found and closed (2026-11-10T23:5xZ)

The out-of-band drain adds a `setInterval(readDrainMs)` to `runWakeLoop`. That timer is `unref()`'d
so it cannot keep a process alive, but it **did** change the wake loop's timing, and one demo noticed:

```bash
for i in $(seq 1 12); do node demo/cooldown-skip-line.test.mjs >/dev/null 2>&1 || f=$((f+1)); done
# HEAD (fd09f919)              -> 4/12 red
# src/broker.mjs from e06626af -> 0/12 red
# HEAD with readDrainMs = 0    -> 0/12 red   (isolates the new timer as the trigger)
```

The mechanism, read off the raw `<db>.broker.log` stamps: the seat is woken at `t`, the loop parks in
`signal.wait(1000)` twice, and pass 3 arrives at `t + 2000 ms` — exactly the cooldown boundary.
`seatReady` is `now - last >= seatCooldownMs` (`src/scheduler.mjs:160-164`), so the verdict is decided
by sub-millisecond jitter, and adding a timer is enough to move it. The fix is **not** to loosen the
assertion: `WakeScheduler` and `runWakeLoop` already take an injected `now` (`src/scheduler.mjs:77`,
`src/broker.mjs:1641`), so the demo now drives a virtual clock whose `signal.wait(ms)` advances `now`
instead of sleeping. Result: **0/15 red, 0.193 s** (was ~2.2 s and flaky). The assertion still checks
the real thing — one `SKIP impl reason=cooldown remaining=1s` line between two wakes.

Lesson for the next pass: a demo that passes once is not evidence. Run the demos a change can shift
**10+ times** before calling a suite green, and bisect a new timing knob by setting it to 0.

## G. The spool's dead-letters, read and explained (task 1 of this goal)

`node tools/broker-serve.mjs --status` at 23:4xZ on this box: **0 pending** intents in
`selfdev.sqlite.broker.inbox`, **61** in `selfdev.sqlite.broker.inbox.error`. Every one was read
(both the payload and its `.reason` sidecar):

| reason | count | what it means |
|---|---|---|
| `apply failed: SqliteStorage is closed` | 59 | the broker's harness handle was closed when the read was applied; retried up to `INTENT_RETRY_LIMIT` = 3 (`src/broker.mjs:246`, the retry log line at `src/broker.mjs:868-869`) and then dead-lettered |
| `apply failed after 4 attempts: SqliteStorage is closed` | 1 | same leg, one attempt over the limit |
| `apply failed: unknown read view: status (known: seats, queue, …)` | 1 | the client sent `view:"status"`; `src/brokerread.mjs:114` is the throw. No code on `main` sends that view today (`grep -rn 'view: *"status" src/ cli.mjs` → no hits) |

All 61 are `op: "read"`, dated 2026-11-06T04:01:55Z → 2026-11-10T17:13:02Z. **Nothing was re-sent**: a
read intent is a snapshot request whose answer is only useful to the client that is still waiting, and
those CLI processes are long gone — re-spooling them would deliver answers to nobody. The read-only
shim (`--local`) is the path that answers without the broker, and the out-of-band drain (§B) is what
keeps the broker from dead-lettering reads again while a pass is stuck.

## H. Branch dispositions, measured at 23:5xZ on this box (43 refs, `main` = `f897ea8a`)

`git merge-tree --write-tree main <ref>` — exit 0 means **no textual conflict**; it does NOT mean the merged tree
passes the suite (`item-5301-resolved` merged clean in an earlier window and its own demo was red).

| disposition | refs |
|---|---|
| merges clean (35) | item-1158, 3087, 5604, 5631, 5912, 5995, 6057, 6063, 6064, 6066, 6106, 6112, 6150, 6155, 6162, 6176, 6177, 6208, 6216, 6223, 6279, 6290, 6310, 6317, 6328, 6361, 6363, 6365, 6381, 6393, 6404, 6429, 6466, seatroot/linux, verify-5180 |
| **conflicts** (7) | item-3570 (`docs/runbooks/stale-held-backlog.md`) · item-5301 (`cli.mjs`) · **item-5301-resolved (`cli.mjs`)** · item-6101 (`cli.mjs`, `demo/test-areas.json`, `src/rig.mjs`) · item-6330 (`demo/runbook-diagnose.test.mjs`) · item-6402 (`docs/DECISIONS.md`) · wip/seat-prompt-files (`cli.mjs`, `rig.selfdev.json`) |

**Correction to the record:** `docs/NEXT.md` said `item-5301-resolved` "merges clean". It no longer does — the signal
seam and the read-bound work moved `cli.mjs` after that branch was cut, so `git merge-tree` reports
`CONFLICT (content): Merge conflict in cli.mjs`. Four of the seven conflicts are in `cli.mjs` for exactly that reason:
anything a seat branched off `cli.mjs` before 17:54Z must be re-cut against the seam. None of these branches touch the
signal seam, so nothing in this goal depends on landing them — landing them is the PM/lead's routing call.
