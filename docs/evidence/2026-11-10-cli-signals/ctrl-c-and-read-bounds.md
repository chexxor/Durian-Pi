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

Measured at `6cc13740` (Linux, Fedora Linux 45, kernel 7.2.15-300.fc45.x86_64, node v24.22.1, git 2.56.0):

```bash
node scripts/test.mjs --all --jobs 4        # 295/295 in 123.0 s
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

## I. The mutating verbs got the same bound (2026-11-11T00:2xZ, `6cc13740`)

The audit of the first completion request found the one hole the goal did not close: reads were bounded,
spool **writes** were not. `awaitIntentResult` (`cli.mjs:2007`) defaulted `timeoutMs = 15 * 60_000`, and
`pause --wait` (`cli.mjs:1982`) and `compactViaSpool` (`cli.mjs:1610`) called it with no progress check. Against a
broker resident but frozen inside a pass that is a 900 s silence — Ctrl-C rescued it via `stoppableSleep`, but the
verb never failed on its own.

| broker state | bound | why |
|---|---|---|
| `up` (advancing) | 900,000 ms | a compaction is real work |
| `degraded` (fresh heartbeat, no pass) | 10,000 ms | the same bound the read client uses |
| `down` (no resident broker) | 0 ms | nothing will apply it — say so now |

`intentWaitBoundMs` (`src/broker.mjs:2422`) is pure — state + `now` in, bound out — and `awaitIntentResult` re-reads
it every poll, so a broker that recovers mid-wait is not cut off. The failure names pid, health state, heartbeat
age, last-pass age, live generation leases and `docs/runbooks/broker-down-or-stalled.md`; the intent stays in the
spool rather than being silently discarded.

The live value, read without pausing the fleet (read-only store open, no config load — `loadConfig()` with no
`readFile` argument throws `TypeError: readFile is not a function`, `src/config.mjs:314`):

```bash
node --input-type=module -e 'import {readBrokerState, intentWaitBoundMs} from "./src/broker.mjs"; console.log(intentWaitBoundMs(readBrokerState("./selfdev.sqlite")))'
# -> {boundMs: 10000, health: {state: "degraded", reason: "no pass within the progress timeout",
#     pid: 562329, hbAgeMs: 17863, passAgeMs: 11209263, progressTimeoutMs: 360000}}
```

Pin: `node demo/mutate-intent-bound.test.mjs` — **PASS, 2.0 s** in the suite, no key, no network, no model. Three
legs: the pure bound function, the live `pause --wait` verb against a forged resident-but-frozen broker (non-zero
exit inside the bound, message names heartbeat age / "last completed pass never" / the runbook, request still in
`selfdev.sqlite.broker.inbox`), and the control that an advancing broker is NOT cut short — Ctrl-C there exits 130.

**Fresh wedge re-measurement at `6cc13740`** (`.spike/wedge-after.mjs`, 139,264 B store, forged resident-but-unanswered
broker, SIGINT at 1.5 s): `watch --once --json` 1707 ms → **130**, 203 ms after the signal; `status --json` 1709 ms →
**130**, 208 ms after; `queue --json --no-body` 1518 ms → **130**, 17 ms after.

**The NEXT.md cap, closed the honest way:** the record commit `c2c390e4` pushed `docs/NEXT.md` to 203 counted lines,
which tripped `demo/next-pointer.test.mjs` and `demo/clockin-digest.test.mjs` (both assert the enforced 200-line cap).
The pointer is now **195 lines** and the pinned-pi detail was moved **verbatim** to `docs/NEXT-ARCHIVE.md` (14,296 lines)
rather than deleted — the cap is met without losing the record.

## J. The stop audit had a leg that never wrote its receipt (2026-11-11T00:3xZ)

Re-running the broker area found a #2322 hole the read drain's timing exposed. `runWakeLoop` can see a stop in
three places, and only two of them wrote the receipt:

| leg | line | before | after |
|---|---|---|---|
| top of the loop | `src/broker.mjs:1851` | `STOP-REQUESTED source=signal` | unchanged |
| idle leg | `:1882` file / `:1889` signal | file only — a signal set `stoppedBy="signal"` with **no line** | receipt written for both |
| post-pass leg | `:2185` file / `:2192` signal | file only — same hole | receipt written for both |

Symptom: `node demo/broker-stop-audit.test.mjs` was **1/6 red** under `node scripts/test.mjs --area broker --jobs 4`
and **0/12 red** standalone. Under contention the pass in flight finishes before the loop reaches the top-of-loop
check, so the signal is noticed at the idle/post-pass leg — and the log closed with `EXIT reason=signal` and no
`STOP-REQUESTED`, i.e. a signalled broker indistinguishable from a crash. After writing the receipt on every leg:
**0/6 red** (re-measured with the same 6-run loop), **0/12** standalone.

Lesson, recorded as pitfall 257: a demo that is red only under concurrency is not automatically "the box, not the
code" (pitfall 254). Read the artifact the assertion is missing and find which path skipped writing it.
## K. The landing pass, 2026-11-11T00:4xZ (`main` 14ae744a, refs 43 -> 32, worktrees 35 -> 25)

Preflighted every ref against current `main` with `git merge-tree --write-tree main <ref>`, then landed the clean
set one at a time with the enforcement chokepoint, gate required:

```bash
for b in item-6381 item-6393 item-6363 item-6361 item-6176 verify-5180 item-6112 item-6466 item-6310 item-6223 item-6155 item-6365; do
  git merge-tree --write-tree main "$b" >/dev/null 2>&1 || { echo "$b CONFLICT"; continue; }
  node scripts/land.mjs "$b" --db ./selfdev.sqlite --changed-suite   # ok:true; gate = derived subset
done
git merge-base --is-ancestor <ref> main   # exit 0 for every one, checked individually
git worktree remove <path>; git branch -d <ref>      # 12 clean unlocked trees, nothing forced
```

**Proof the merged result is green, not the branch tip:** after the pass,
`node scripts/test.mjs --all --jobs 4` → **299/299 in 115.0 s** (Linux, Fedora Linux 45, kernel 7.2.15-300.fc45.x86_64,
node v24.22.1, git 2.56.0).

**One branch needed a resolution, and it was provably mechanical.** `item-6402` conflicted only in `docs/DECISIONS.md`;
the three merge stages show the base is a **prefix of both sides** (base 11,640 lines; ours 11,744 = base + D262 + D263;
theirs 11,676 = base + one entry). Union is therefore the only correct resolution, and the branch's own entry said
"the mint number is assigned at land" — it landed as **D264**. `git rerere` recorded the resolution.

**Not landable by a delegate, with the measurement that says so:**

| ref | conflict | why it is a re-cut, not a merge |
|---|---|---|
| item-5301, item-5301-resolved | `cli.mjs` | the import union is mechanical, but the branch's own `demo/worktree-reap.test.mjs` exits 1 on the merged tree: it asserts `dry.candidates`, and `reapWorktrees` (`src/broker.mjs:1333`) returns `reaped/counts/refusedSoleCarrier/kept` |
| item-6101 | `cli.mjs`, `src/rig.mjs`, `demo/test-areas.json` | its hold/release model collides with #6112/#6150 already on `main` — semantic |
| item-6162 | `docs/runbooks/stale-held-backlog.md`, `src/rig.mjs` | same collision with landed release-authority code |
| item-3570 | `docs/runbooks/stale-held-backlog.md` | front matter and body both edited; not a pure append on either side |
| item-6330 | `demo/runbook-diagnose.test.mjs` | it REMOVES skip-list entries `main` just added; a union would undo landed work |
| wip/seat-prompt-files | `cli.mjs`, `prompts/*` | dispositioned SUPERSEDED (#6178) |

**Correction to §H:** §H counted 43 refs / 35 worktrees at 23:5xZ. After this pass it is **32 refs / 25 worktrees**, 8
refs still ahead of `main`, all of them in the table above.

## L. Re-measured at `e7713ac5` (2026-11-11T01:1xZ), same host

Host measured with the measurement: Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1,
`git version 2.56.0`.

```bash
git for-each-ref --format='%(refname:short)' refs/heads/ | while read r; do [ "$r" != main ] && \
  [ "$(git rev-list --count main..$r)" -gt 0 ] && echo "$r ahead"; done
# -> item-3570, item-5301, item-5301-resolved, item-6101, item-6162, item-6330, wip/seat-prompt-files  (7, not 8)
DURIG_DB=./selfdev.sqlite node cli.mjs worktree audit --json   # total 25: seat-root 7, non-item 1, live 4, reapable 9, dirty 4, locked 0
DURIG_DB=./selfdev.sqlite node cli.mjs status >/dev/null       # exit 0, 2.45 s
DURIG_DB=./selfdev.sqlite node cli.mjs queue --json --no-body  # exit 0, 0.92 s
DURIG_DB=./selfdev.sqlite node cli.mjs watch --once --json     # exit 0, 1.10 s
DURIG_DB=./selfdev.sqlite node cli.mjs ps >/dev/null           # exit 0, 0.28 s
```

No broker is resident: `grep EXIT selfdev.sqlite.broker.log | tail -1` → `2026-11-11T00:33:26.032Z EXIT pid=562329
reason=max-duration passes=36`; no `selfdev.sqlite.broker.json`, no genlock. `intentWaitBoundMs(readBrokerState("./selfdev.sqlite"))`
→ `{boundMs: 0, health: {state: "down"}}`, so every mutating verb fails immediately rather than waiting.

**Two instruments corrected by re-measurement.** (a) `cli.mjs queue --id 6381 --json` *does* return the row — keys
`ids, rows, counts, attention, narrowed, items`, with `items.length === 1` and `narrowed: "payload"`; the trap is the
`rows: 6494` header, which is the census (pitfall 258, rewritten). (b) `pgrep node | wc -l` → `0` on this box with four
`cli.mjs serve` processes alive; `cat /proc/524238/comm` → `MainThread`, so name-matched pgrep is blind to node here and
only `pgrep -f "cli.mjs serve"` (5 hits) works (pitfall 260). Four such orphan serve processes are still running
(524238, 526388, 526934, 529245, ~5 h elapsed) with no broker state file — deliberately not killed; killing another
actor's process is the operator's call.

## Addendum 2026-11-11T08:2xZ (delegate, completion-audit rework, `main` = `16c95b20`)

The completion audit disapproved on two grounds; both are closed and re-measured here.

**1. The gate was red at HEAD.** `docs/NEXT.md` was 203 counted lines against the 200-line cap enforced by
`demo/next-pointer.test.mjs`. It is now **198 `wc -l` lines** (199 counted split lines — pitfall 261), and
`node demo/next-pointer.test.mjs` and `node demo/clockin-digest.test.mjs` both exit 0. The suite, run unpiped with the
exit captured, is **300/300 in 120.3 s, exit 0** at `16c95b20` (`.spike/suite-final3.out`; 113.4 s at the prior HEAD
`580c1343`). Host measured with the measurement: Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`,
node v24.22.1, `git version 2.56.0`.

**2. Spool-mutating verbs still defaulted to 15 minutes.** `cli.mjs awaitIntentResult` now defaults `timeoutMs = null`
and derives the bound from health on every poll via `intentWaitBoundMs` (`src/broker.mjs:2422` — 900 s for an advancing
broker, 10 s for a resident broker with a frozen pass, 0 for no broker), with `DURIG_INTENT_WAIT_MS` as the demo
override. `demo/mutate-intent-bound.test.mjs` pins all three legs: a forged frozen pass makes `pause --wait` **exit 1 in
678 ms** naming the cause and the remedy, and the advancing-broker control is not cut short (Ctrl-C → **130**).

**Live verb table at 08:1xZ, broker pid 2876055 resident and advancing** (`--no-probe --max-duration 7200 --yes-pm-wakes`,
started 08:13Z): `status --json` 10.129 s, `queue --json --no-body` 2.000 s, `watch --once --json` 1.938 s, `ps` 0.477 s,
`log pm 5` 1.273 s, unknown verb `verify --json` exit 2 in 0.304 s — all exit 0. SIGINT: `watch --follow --json` →
**exit 130, 353 ms** after the signal; `log pm --follow` → **130 in 175 ms**. The same probe reaped two 13-hour-orphaned
suite processes in 254–502 ms (pitfall 268).

**Still open, minted to `pm`:** #6604 (bound the exit drain when `--max-duration` expires), #6600/#6601 (`EXIT …
passes=-` reports a dash instead of the pass count), #6548 (`status` labels a bound-exit drain "degraded" on pass age
alone), #6598/#6599 (a check rule that fails when a `tools/model-probes/corpus.mjs` anchor is absent from `main`), and
intent `3c779f4a-5e23-4b96-a0f2-66f9c705fc4b` (reap suite-spawned CLI children). Measured again this window: broker pid
2658110 (`--max-duration 3600`) ran **1 h 32 m** past its bound; `serve --stop` answered "did not exit within the stop
grace; no forced kill"; `kill -TERM` produced `EXIT pid=2658110 reason=deadline passes=-` at 08:12:55Z and cleared the
state file.
