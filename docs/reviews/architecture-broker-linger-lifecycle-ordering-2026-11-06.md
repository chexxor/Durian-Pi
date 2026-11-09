# RM-303 root cause — the broker's store-close and its loop-stop are ordered independently (2026-11-06; queue #5231 + addendum #5260; ROADMAP 303 / sibling 327)

**Scope.** Design review only. No code changed here. The ask was "name the lifecycle ordering fault" for the 303 linger, now 5/5 reproduced, and answer the ruling-relevant question the addendum poses. Every claim below cites a `path:line` I read in this worktree, or a measurement carried in `docs/ROADMAP.md:6078` (row 303) / `docs/ROADMAP.md:6102` (row 327). The probes in §7 are **specified and one is partly run** (see §7 P0); the others are RED-first specs for `impl`, not results.

---

## 1. The fault, in one sentence

> **The broker guarantees "never close the store while a run is live" (F11, `src/broker.mjs:1978-1996`) but has no inverse guarantee "never keep the loop once the store is closed"** — so close and exit are two independent acts, each can happen first, and **both orders are reachable**, each degrading a different operator surface.

That missing pairing is the lifecycle ordering fault. Three concrete ordering defects sit under it:

**F1 — `reopen()` closes before it can guarantee it can re-open.** `cli.mjs:2051-2071`: `handles.unsubscribe()`, then `await handles.harness.close(...)` (`:2060`), then `await handles.probeStorage.close(...)` (`:2065`), and only then `handles = await openHandles()` (`:2069`). The closes are unconditional; the open can throw. If it does, the assignment never happens, `cli.mjs:2070` rethrows, and the loop's catch at `src/broker.mjs:1890-1894` **only logs `HARNESS-REOPEN-FAILED` and continues** — leaving `h`, `p`, `r` (`src/broker.mjs:1884-1887`) bound to handles whose SqliteStorage is already closed. **Fix shape:** open-then-swap. Build the new handles first, close the old ones only after the new ones exist, and if the open fails, mark the run terminal (`stoppedBy="store-unrecoverable"`) rather than resuming against closed handles.

**F2 — a closed store is invisible to every counter that could end the run.** The two terminal counters are `reopenCap` (`src/broker.mjs:1871-1878`, entered only from a **thrown pass** with `isSessionFailed`) and `wakeRetryBudget` (`src/broker.mjs:1949-1962`, entered from `unactionedFailure = failedThisPass.size > 0 || passThrew`, `:1934`). Neither sees the failure that the 303 dead-letters record: `drainIntentInbox` catches each apply failure and converts it to a **dead-letter file** (`src/broker.mjs:782` — `deadLetterIntent(dbPath, file, \`apply failed: ${err?.message ?? err}\`)`), which the caller reports as a count, not a throw (`src/broker.mjs:1246-1248`). The read path is worse: the idle read-serve drain swallows its own failure into a diagnostic and `continue`s (`src/broker.mjs:1713-1719`). So an applier running against a closed store produces **no pass throw, no reopen attempt, no retry-budget burn, no terminal state** — it produces files in `<db>.broker.inbox.error/` and a fresh heartbeat. That is why the linger is *silent* rather than *terminal*: the failure class the store actually reports (closed) is classified as **data-plane noise**, never as **liveness loss**. **Fix shape:** a dead-letter whose reason matches a store-state class (`closed`, `SessionFailed`) must increment a counter that can end the run, and must be counted in `unactionedFailure`.

**F3 — the `.stop` file never arms a force bound, and the cooperative drain is unbounded by design.** `forceTimer` exists at exactly one site, inside `onSignal` (`cli.mjs:2094, 2101-2117`, `process.exit(0)` at `:2116`), and `onSignal` is reached only from `SIGINT`/`SIGTERM`. A `.stop` **file** deliberately does not raise a signal (`src/broker.mjs:1651-1654`), so the stop-request path has **no force fallback at all**. Its drain is then chosen at `src/broker.mjs:1992-1996`: bounded by remaining grace only when `stoppedBy === "deadline" || graceExpired()`; otherwise `await h.waitForIdle(context)` **unbounded** (the comment at `:1988-1991` says this is deliberate — F11, never close the harness over a live run). And the stopper refuses to escalate: `cli.mjs:1975-1988` prints `"did not exit within the stop grace; no forced kill — check status again"` and returns `stopped:false`. Net: on the stop-request path a broker that cannot settle is **unkillable by the operator's own verb**, which is exactly the measured `serve --stop` → `kill` sequence in row 303. **Fix shape:** arm the force timer for the stop-FILE path too (the file is a stop request, not a hint), or let `serve --stop` escalate to `process.kill` after a *second*, named grace — but only once the store's exit is made idempotent, or an escalation strands in-flight intents (row 327's mechanism).

**Adjacent doc/code drift found while reading F3.** `cli.mjs:1948-1949` promises "we give up to 60s for cooperative settlement"; the wait ceiling is `resolveStopGraceMs() + 5_000` (`cli.mjs:1956`) = **~10 s** against `STOP_GRACE_DEFAULT_MS = 5_000` (`cli.mjs:2006`). Either honour the 60 s the comment names or correct the comment; today the comment is the only place an operator learns the expected wait, and it is wrong by 6x.

---

## 2. Two linger sites, and the field that separates them

The measured record contains **two different signatures**, and conflating them is how a single "fix" re-breaks one:

| Site | Observable state | Mechanism | Evidence |
|---|---|---|---|
| **L-A — resting with CLOSED handles** (worst: destroys work) | loop alive, heartbeat fresh, `lastPassAt` frozen, no lock table, spooled reads **dead-lettered** | F1 + F2: loop resumed on closed handles, drain failures never terminal | 4 ops in `selfdev.sqlite.broker.inbox.error/` (`read health`, `read queue`), each `.reason` = `apply failed: SqliteStorage is closed` (`docs/ROADMAP.md:6078`, `docs/SELFDEV.md:2335`) — an applier ran, so the **loop was running** |
| **L-B — lingering AFTER the loop exited** (dark reads only) | `EXIT … reason=stop passes=15` logged, heartbeat interval cleared (`src/broker.mjs:1998`), process still alive | a ref'd keepalive outlives the loop: `createWakeSignal().wait()` arms `setInterval(() => {}, 1 << 30)` with **no `unref()`** (`src/scheduler.mjs:198-207`; the only `unref()` sites in `src/` are `broker.mjs:1647`, `genlock.mjs:225`), or `await handles.harness.close(...)` (`cli.mjs:2189`) never settles | row 327's pid 765129 printed its `EXIT` line and was still resident (`docs/ROADMAP.md:6102`) |

**Attribution defect to fix with the same stroke.** `broker.json`'s `heartbeatAt` is written only by the owning loop (`src/broker.mjs:1640-1647, 2217-2218`), and the file carries a `pid`. The 303 discriminator ("fresh `heartbeatAt` + frozen `lastPassAt`") does **not** currently assert `state.pid === <the pid you are diagnosing>`. In the 09:35–09:48 window a *second* broker had already started (row 327: `START pid=765129` at 09:34:10 while an earlier broker was still lingering), so a fresh heartbeat in that window is ambiguous evidence. This is the #3575 principle applied to this instrument: a fresh `heartbeatAt` may **accept** "some broker is alive", it must never **DECIDE** "this pid is working". Fix: `brokerHealth`'s liveness leg (`src/broker.mjs:2131-2141`) reports the pid it read, and the runbook/`tools/broker-serve.mjs --status` refuses the 303 verdict unless the pid matches.

---

## 3. 303 vs 327 — a shared pid is not a shared defect (say this so one condition does not break both)

| | **303** | **327** |
|---|---|---|
| defect class | **refusal to exit** (linger) | **marker survival** (a stop request outlives its run) |
| broken invariant | store-close and loop-stop must be paired (§1) | the stop file must be run-scoped (`runToken`/pid stamped at `START`) |
| fixing condition | bound/force the exit; keep the store open until the last consumer is done | `START` clears/restamps `<db>.broker.stop`; ignore a request from another run |
| what happens if you "merge" them | clearing the stop file on exit (327's remedy) does **nothing** for a broker that never reaches its exit path — the linger persists and reads stay dark; bounding the drain (303's remedy) does **nothing** for a request file written into a run that has not started yet — the next run is still gutted to `reason=stop passes=15` | symmetric |

They are siblings only in the log (`docs/ROADMAP.md:6102`, same pid, same window). Keep them as two rows with two conditions.

**Benign, not for a review cycle:** `{"spend":"catalog-refused","model":"google/gemini-3.1-pro","cause":"over-exposed"}` from `cli.mjs resume` / `demo/deepinfra-catalog.test.mjs` is a vendor catalog row refused by the validation layer, not a seat pin (12 seat models resolve across providers; 0 `documents` rows name it). The defect-shaped neighbour in the same log is `metered-endpoint-unkeyed`.

---

## 4. The ruling question (from #5260), answered

> On forced exit: refuse to keep the store open past the deadline (fail closed on reads), **or** keep the store open and refuse to linger?

**Position: keep the store open and refuse to linger. Do not fail closed on reads.**

- Row 303's own lesson is "**the store is the truth, and the broker is a router that can go dark while alive**", measured directly: a direct read-only open answered in **111 ms** while every broker-routed read timed out at 120 s. Failing the read surface closed would take a *diagnosable* symptom and make it *intentional and indistinguishable* — the operator can no longer tell "the broker is leaving" from "the store is broken", which is the exact confusion that cost ~50 minutes of pass budget and produced the temptation to write against a healthy store.
- Cost asymmetry: a lingering-but-readable broker loses **latency**; a closed-store-but-alive broker loses **facts** — and it loses them permanently, since the 4 dead-lettered reads are *destroyed*, not deferred.

**Which surface degrades, stated:** the **control/write** surface degrades, deliberately and legibly. At the stop deadline the broker (a) stops *accepting* new intents with a named refusal (`broker-stopping`, with the pid and the remaining grace), (b) **fails-or-requeues** whatever is already in the inbox rather than stranding it — that is ROADMAP **329**'s third shape ("an op enqueued during shutdown is stranded forever, silently") and it is the same fault seen from the queue side, so it belongs in this row's fix, not in a new one; and (c) answers every read that arrives until the instant the store actually closes. Reads never get a `SqliteStorage is closed`; they get either data or a named, actionable refusal.

**Invariant to adopt (the pairing that is missing):**
> **INV-CLOSE.** The store close is the **last** act of the process, after (i) the loop has stopped, (ii) every spooled intent is applied, dead-lettered with a reason, or re-queued, and (iii) no handle that can still be dereferenced points at a closed store. Nothing that can execute an intent may run after close; if the close itself hangs, the process must still exit within the force bound.

Reversible and cheap to honour: it changes ordering, not capability.

---

## 5. Failure modes with recovery paths (the enumeration the row currently lacks)

| # | Failure mode | Reachable via | Recovery path today | Recovery path required |
|---|---|---|---|---|
| M1 | Loop resumes on closed handles | `openHandles()` throws inside `reopen()` (F1) | none — loop continues, reads dead-letter | go terminal: `stoppedBy="store-unrecoverable"`, one named log line, exit |
| M2 | Closed-store apply failures never end the run | drain apply catch `:782`, read-drain catch `:1713-1719` (F2) | dead-letter files only | count store-state dead-letters in `unactionedFailure`; a bounded streak ends the run |
| M3 | Stop request never settles and cannot be escalated | `.stop` file + unbounded drain `:1992-1996`, no `forceTimer` (F3) | operator `kill` (manual, and it produces `passes=-` — row 328) | force bound on the file path, or an escalated `serve --stop`; log `reason=forced` with the **actual pass count** (row 328's shape) |
| M4 | Post-exit keepalive keeps a closed-store process resident | `scheduler.mjs:204` ref'd keepalive; unsettled `harness.close()` (`cli.mjs:2189`) | none observed | unref the keepalive once the loop has stopped, or `process.exit` after the finally completes and name it in the log |
| M5 | Intents enqueued during shutdown are stranded silently | exit path, no requeue | dead-letter at best | ROADMAP 329: fail-or-requeue pending inbox entries at exit, without creating duplicates (pair with the idempotent re-drain, `src/broker.mjs:733`) |
| M6 | 303 verdict attributed to the wrong pid | `heartbeatAt` read without the `pid` field | none | `brokerHealth`/`--status` print the pid beside the heartbeat age; runbook requires a match |
| M7 | Forced exit loses the run report | `cli.mjs:2101-2116` logs `passes=-` | none | report the real completed-pass count and the stop source (row 328) |

Cascade note: M1→M2 is the cascade (a closed store poisons every later intent), and its checkpoint is M5 — an intent that is re-queued rather than destroyed can be re-applied by the next broker, which is what makes the whole class recoverable instead of lossy.

---

## 6. Options and the trade-off I would accept

- **A. Pair close with exit (INV-CLOSE) + force-bound every stop path + terminal counters for store-state failures.** Chosen. Reversible, three small seams, keeps the read surface honest. Cost: a stop can take up to the force grace instead of hanging indefinitely, and a stopping broker answers with a named refusal instead of silence — i.e. it becomes *legibly* unavailable, which is the point.
- **B. Fail closed on reads past the deadline.** Rejected as the primary (loses facts, indistinguishable from M1, contradicts the row's own "the store is the truth" lesson). Acceptable **only** as an add-on after A, if reads turn out to keep landing during the close window itself.
- **C. Watchdog kills the pid from outside (supervisor `kill-on-wedge`).** Cheapest and it does restore service, but it is the wrong owner: it forces the `passes=-` record (M7), it is the path that leaves a stop request behind for the next run (row 327), and it destroys the in-flight evidence the fix needs. Accept as the **last** layer with a bounded grace, never as the answer.

Trade-off accepted: slightly longer, explicitly-reported shutdowns in exchange for no lost intents and no dark read surface.

---

## 7. Falsifiable probes (each can fail; P0 is already runnable)

- **P0 — the existing stop demo is green, so the gap is not there.** `node demo/broker-cooperative-stop.test.mjs` → **exit 0** (`PASS — B3/B4/B5/B6 broker stop verified`, 2026-11-06, this worktree). It asserts cooperative-stop *semantics*, never the force bound on the file path — so M3 is untested, which is why it shipped. Any fix must add a case to this file, not a new file.
- **P1 (M1, F1) — reopen atomicity.** Make the second `openHandles()` throw; assert the loop goes terminal with `stoppedBy="store-unrecoverable"` and that no further `drainIntentInbox` call is attempted with the previous handles. Today it logs `HARNESS-REOPEN-FAILED` (`src/broker.mjs:1891`) and continues — expect **RED**.
- **P2 (M2, F2) — closed store is terminal, not a count.** Point a live loop at a closed `SqliteStorage`; assert a bounded number of `apply failed: SqliteStorage is closed` dead-letters and then a terminal stop. Today the streak is unbounded — expect **RED**.
- **P3 (M3, F3) — stop file escalates.** `serve --stop` against a broker whose `waitForIdle` never settles must exit within the force grace with `EXIT … reason=forced passes=<n>`. Today it returns `stopped:false`, "no forced kill" (`cli.mjs:1985-1987`) — expect **RED**.
- **P4 (M5, 329) — nothing is stranded at exit.** Enqueue one `read` and one `message` intent during the shutdown window; assert each is applied, dead-lettered with a reason, or re-queued exactly once (no duplicate on re-drain, `src/broker.mjs:733`).
- **P5 (M6) — pid-bound liveness.** Write a `broker.json` whose `pid` is a *different* live process and assert the 303/314 discriminator refuses the "this broker is alive" verdict. Today `brokerAlive`/`brokerHealth` (`src/broker.mjs:2099-2141`) never compares the pid to the subject of the diagnosis — expect **RED**.

**Owner split (route via `pm`, not taken here):** M1/M2/M3/M7 are `impl` (all in `src/broker.mjs` + the `serve` finally in `cli.mjs`); M5 is 329's row and must be built with it; M6 belongs to 314's attention vocabulary, not a new taxonomy. This review adds no new row.
