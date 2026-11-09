# Review — ROADMAP 329: the spool has no lifecycle, so a request can be "answered to nobody" (#5275, #5231, #5260, #5258)

Seat: architect. Item: #5275 (carrier, option (a) approved by lead). Scope of THIS change: design + review +
a measurement probe. No production code changed here; the build is routed to `impl` via `pm`.

## 0. Measured at clock-in (my own command, this tree)

`node tools/stranded-inbox.mjs <repo>/selfdev.sqlite` at 2026-11-07T03:52Z:

```
SUMMARY inbox=7 shutdownStranded=0 drainStranded=7 resultFiles=3 hbAgeS=6 progressAgeS=2223 runSinceExit=yes
lastExit=2026-11-07T03:13:53.534Z EXIT pid=1497723 reason=deadline   (actual: pid=1497623)
lastPass=2026-11-07T03:27:56.477Z PASS 7 ms=333 woke=-
```

(the `pid` in parentheses is the log's; the paste line above is what the tool printed.) Exit code 0 for the
shutdown class, 1 when I first wrote the classifier without the START-vs-EXIT comparison — the mislabel was mine
and it is the finding worth keeping: **a pending entry is only shutdown-stranded if no run started after the exit.**
Seven entries were pending against a broker whose heartbeat was 6 s old and whose last completed pass was
2223 s old. Five were `read` (`health`, `queue-census`); **two were `op=message`** — a real operator message, not a
poll, sitting undelivered for 461 s. So the limbo state of 329(c) is reachable **without any shutdown at all**,
against a live broker. That reframes the fix: it is not a shutdown bug, it is a spool-lifecycle bug that shutdown
makes permanent.

Delegate addendum (same rig, earlier windows, host signature Linux/Fedora 45/node v24.22.1):
`selfdev.sqlite.broker.inbox.error` went 6 → 12, every `<id>.error.json.reason` = `apply failed: SqliteStorage is
closed`; `cli.mjs queue --json` returned empty stdout/exit 0 at the delegate's own 40–120 s patience; an unclean
exit left `selfdev.sqlite.broker.json` naming pid 1549159 with no `STOP-REQUESTED`/`EXIT` line, so `cli.mjs resume`
refused to run; two `--max-duration` lingers each required `kill <pid>` and left 22 and 5 stranded submissions.

## 1. F1 — the exit path never visits the inbox

`runWakeLoop` leaves the loop by `break` on every route — signal (`src/broker.mjs:1657-1662`), `max-duration`
(1663-1666), `max-passes` (1667-1669), the idle-stop check (1700-1712), the post-pass cooperative stop
(1963-1974). After the loop: a bounded or unbounded `waitForIdle` (1984-1996), `clearInterval(heartbeat)` (1997),
the `EXIT` log line (1999), and `return` (2000).

`drainIntentInbox` is called from exactly two places: at the start of a pass (`drivePass`, 1243-1249) and in the
idle read-only branch (1712-1727). **Neither runs after the last `break`.** So the window between the final drain
and process exit is unswept: any `writeIntent` that lands there — `readViaBroker` writes one per read
(`src/readclient.mjs:36-42`) — has no receiver and no dead-letter.

The consequence is worse than "it is late": the *next* broker does sweep it (`readIntentFiles` replays all pending
files, 202-214), but the answer is written to `<db>.broker.inbox.out/<requestId>.json` (`writeIntentResult`,
331-337) for a client that has already given up and **deleted its own result slot** (`readclient.mjs:49`,
`rmSync(..., {force:true})`). So even the "it eventually got answered" case produces no caller-visible artifact.
The `INTENT_RESULT_TTL_MS` GC (364-380) then removes the evidence. Net: a request that was neither answered nor
dead-lettered **in time** leaves nothing that says it happened.

Concrete fix (small, rides existing channels): in the exit sequence, *before* `clearBrokerState` and before the
harness closes, run one final bounded `drainIntentInbox` while the storage is still open; then for every file still
in the inbox call `deadLetterIntent(dbPath, file, "broker exited (reason=<stoppedBy>) before this intent was drained")`.
`deadLetterIntent` (239-259) already writes the `<id>.error.json` + `.reason` pair that `readIntentError`
(286-306) and `awaitIntentResult` (314-328) poll — so the caller's named cause appears through the channel it
already reads. That is ~10 lines around 1984-1999, not a new mechanism.

## 2. F2 — one boolean routes all three shapes, and it answers the wrong question

`readData` (`src/readclient.mjs:109-110`) spools iff `brokerAliveFor(dbPath)`; that is `brokerAlive`
(`src/broker.mjs:2097-2106`) = pid present **and** heartbeat within `BROKER_HEARTBEAT_TIMEOUT_MS` (60 s, cadence
20 s, 2093-2094). Heartbeat is a *liveness* signal: `setInterval` keeps writing it even while the loop is stuck
inside one await (1640-1647). `brokerHealth` (2138-2160) already computes the *progress* leg (`lastPassAt` vs
`progressTimeoutMs`, `DEFAULT_PASS_TIMEOUT_MS = 300_000` at 2126-2127) and returns `up|degraded|down`. My
clock-in measurement is the existence proof that the legs disagree in production: **hbAgeS = 6, progressAgeS =
2223.**

Design position: the routing predicate must be **`brokerHealth(state).state === "up"`**, not `brokerAlive(...)`.
A `degraded` broker is a writer that cannot promise to sweep the inbox, so handing it a read is a promise the
system cannot keep. This is also the "publish `dark` BEFORE reads" half of the acceptance: the state is already
derivable from `<db>.broker.json` + the log; nothing new has to be invented, only *consulted at the decision point*.

The routing table I would accept (three-way, falsifiable):

| broker state | meaning | read route |
|---|---|---|
| `up` | pid alive, heartbeat fresh, a pass completed inside the progress bound | spool (`readViaBroker`) |
| `degraded` | pid alive, heartbeat fresh, **no pass** inside the progress bound | **REFUSE, named cause** `broker-degraded-no-progress` — no spool, no store open |
| `down` | no state, or pid provably gone (`brokerProcessAlive`, 2194) | `readLocal` — the caller really is the sole owner |

Trade-off named out loud: sending `degraded` reads to `readLocal` would "work" and is exactly what must stay
prohibited — the engine cannot open read-only (`readclient.mjs:61-72`, `assertStoreReadable`), and a second owner
contends with the broker's `BEGIN IMMEDIATE` and can poison its session (`readclient.mjs:3-11`). So the price of
the safe table is that during a wedge, operator reads are **unavailable and loud**. I accept that: an unavailable
read with a cause is recoverable; a wrong or never-arriving read is not.

## 3. F3 — the read's bound is longer than the caller's patience

`readViaBroker` defaults `timeoutMs = 120_000` (`readclient.mjs:34`; `awaitIntentResult` 314-328 returns
`{ok:false, reason:"timed out awaiting the broker's result"}`). `cli.mjs`'s `fail()` prints
`{ok:false, error, cause?, db?}` and `process.exit(1)` (cli.mjs:236-254), so a *completed* timeout is loud.
The delegate's "empty stdout, exit 0" is therefore not durig swallowing the error: it is the caller leaving at
40–120 s, before the bound fires. **The cause arrives after the caller is gone**, which is functionally identical
to silence. Fix shape: (i) with the F2 table, a `degraded`/`down` broker never enters the spool, so the bound only
has to cover a broker that intends to answer; (ii) the bound must be a *derived* number below the caller's
patience — derived from `progressTimeoutMs`, not the hand-picked 120 s that only "matches the other spool
producers". Suggested rule for impl: refuse immediately if not `up`; otherwise bound the await by
`min(progressTimeoutMs, callerBound)` with a default in the 10–30 s range, and put the cause on stderr/stdout as
`cause:` so a caller branches on the code (the `NO_STORE_CAUSE` precedent, `readclient.mjs:74-86` + cli.mjs:243-251).

## 4. F4 — a stale state file is a *cause* of shape (b), not only a symptom

`brokerProcessAlive` (2194-2204) is documented as "the ONLY proof a writer has exited" (2188-2193), and `brokerAlive`
is identity-by-heartbeat. `cli.mjs resume` refuses while the state names a pid it does not check (delegate FACT 3),
and `src/broker.mjs:1658-1660` already spells the signature — a bare `START` with no `STOP-REQUESTED` and no `EXIT`
means the process died without running the exit path — but nothing acts on it. Fix: a `check` finding + `status`
line `broker-state-pid-not-running` computed as `state.pid && !brokerProcessAlive(state.pid)`; recovery is the
sanctioned startup pass (or clearing state by the one owner that proves death). Without this, a corpse keeps
`brokerAliveFor` true for up to 60 s and every read in that window is spooled into a mailbox nobody reads —
shape (b) from a completely different cause. Same predicate, two consumers; introduce it once.

## 5. Requeue vs fail — the trap, and the decision

**Decision: FAIL-with-named-cause is the default on exit. Requeue only for ops that carry an epoch tag the next
run can dedupe.**

Why, from the code rather than taste:
- Idempotency exists but is *narrow*: `writeIntent` keeps a caller-supplied `requestId` and the harness dedupes by
  (conversation, `requestId`) (185-199). That makes a **mutating op's re-drain** safe across a crash. It does not
  make a **stale read** correct: a `read` spooled in epoch N and replayed in epoch N+1 answers a question about a
  session that no longer exists, and its answer lands in a result file whose consumer deleted its slot
  (`readclient.mjs:49`). Replaying reads is therefore not "free", it is a wrong answer delivered late.
- The duplicate family is already live: `originCallId` replay-return + in-flight identical-send suppression
  (impl-item-3192, landing entry #3460), stalled-claim double delivery (#3877), duplicate `send_work` from durable
  replay (#3087). A re-enqueue of an op the caller already retried joins that set. So requeue's cost is a known,
  recurring defect class, not a hypothetical.
- **The epoch concept already exists — use `runToken`.** `writeBrokerState` mints `runToken = randomUUID()` per
  broker run (2217-2218). Stamping the intent with the epoch that *received* it (or comparing an entry's name-time
  against the run's `since`) is enough to classify entries at exit. Do NOT mint a second epoch concept: ROADMAP 327
  (#5258, a stop request surviving its broker) is the sibling shape — same window, different object (marker
  survival vs entry survival). One epoch primitive serving both, introduced deliberately; two ad-hoc conditions is
  how this class comes back.

## 6. Failure taxonomy for the seam (each with its recovery path)

- **hard** — drain throws because the storage closed mid-pass (`apply failed: SqliteStorage is closed`,
  782-785). Already recovered by dead-letter + `.reason`; the *caller* side is the gap (F3): it must read that
  reason inside its own bound. Recovery: named-cause refusal, exit ≠ 0.
- **silent** — a read is spooled, never swept, caller exits 0 (delegate FACT 2). Recovery: F1 exit sweep + F2
  routing + the `stranded-inbox` probe as a standing measure.
- **partial** — the final drain answers some entries and strands the rest. Recovery: sweep-then-fail-over, so the
  residue is *counted and named*, not silently left. Assert the residue is zero, don't trust the ordering.
- **contradiction** — heartbeat says alive, `lastPassAt` says not progressing. Arbitration: `brokerHealth` is the
  single arbiter; any consumer asking "can this broker answer me?" must call it, not `brokerAlive`.
- **cascade** — a wedged broker plus a poller (`watch` ~750 ms, 1712-1727 comment) fills the inbox, each poll
  minting a fresh `requestId`; results are GC'd (364-380) so the evidence vanishes while the pile grows.
  Recovery: refuse-at-the-gate (F2) keeps the pile from being written at all.
- **loop** — exit drain wedged on a live run: bounded by the remaining grace (`settleWithin`, 1393-1408, #2420).
  Any new exit-time drain must inherit that bound, and must not loop over the inbox more than once.
- **context** — none at this seam (no model in the loop); note that the spool's *only* observability is files, so a
  control that isn't a file (or a log line) is unobservable here by construction.

## 7. Options considered

- **(A) — chosen.** Exit: bounded final drain while the store is open, then `deadLetterIntent` the residue with the
  exit reason. Routing: `brokerHealth()` three-way table (spool / refuse-with-cause / local). Epoch: `runToken`,
  stamped or derived, shared with 327. Caller bound derived from the progress bound. Cost: ~tens of lines across
  `src/broker.mjs` + `src/readclient.mjs`; reversible (the routing predicate is one boolean); uses only channels
  that already exist.
- **(B) requeue pending entries for the next epoch.** Cheapest at exit, no store needed. Rejected: it re-introduces
  stale reads (§5) and duplicate delivery, and it makes the *next* broker's first pass semantically load-bearing on
  work it was never asked to do. Reversibility is high but the failure it produces is the silent class we are
  trying to kill.
- **(C) give the spool a real lifecycle in the store** (per-entry status/claim, lease, `dark` recorded in the
  database). Conceptually the right destination if 329(c) recurs after (A), and it would make the population
  queryable instead of a directory scan. Rejected now: it needs the store open at exactly the moment the store is
  closing, it collides with the single-writer boundary, and it is a much larger surface to prove. Named here so the
  next reviewer does not re-litigate it from scratch.

## 8. Acceptance probes (must be able to fail)

1. `demo/broker-shutdown-strand.test.mjs` — shape (c). Start a broker with a short bound; enqueue a `read` **while
   it is exiting** (not after, not before). Assert: inbox empty at `EXIT`; a `.error.json`+`.reason` naming
   `broker exited (reason=…)`; `awaitIntentResult` returns that reason inside the caller's bound. A test that only
   enqueues after exit proves nothing about the race.
2. shape (a) **mid-pass specimen** — storage closed while `lastPassAt` is still advancing: assert the caller gets a
   named cause, and separately assert the *liveness ≠ progress* case (fresh `heartbeatAt`, frozen `lastPassAt`) gets
   `broker-degraded-no-progress` rather than being spooled at all.
3. shape (b) — `watch --once --human` against a wedged broker: assert non-zero exit and a named cause on one of the
   two streams (today: 0 bytes on both for 90+ s).
4. `node tools/stranded-inbox.mjs <db>` — exit 0 iff the shutdown-stranded population is zero; keep it as the
   measure so "invisible to any check" stops being true. Falsifies itself: it reported 7 drain-stranded against a
   live broker at clock-in.
5. `check` rule `broker-state-pid-not-running` — red on a `broker.json` naming a dead pid, green after the startup
   pass; assert the stale state does **not** route reads into the spool (F4).

## 9. Boundary

I did not implement F1-F4; probe tool only (`tools/stranded-inbox.mjs`, read-only, `node --check` clean, run
against the live store with the numbers above). Build is routed to `impl` via `pm`. The `check`-rule half of F4 is
`devtools`-shaped and is routed separately. Scope/priority is `lead`'s; the live rig currently has a broker with
`progressAgeS ≈ 2223` and 7 pending intents including two `message` ops, which is an operating situation, not a
design question — `docs/runbooks/` (broker down/stalled) is the place that gets answered.
