# Wake trigger and gate closure — architecture review of #6665

Date: 2026-11-11. Reviewer: architect. Question as routed by pm: *"When a gate closes, the dependent stays asleep. Rule: does a gate-closing queue write dirty the scheduler, or must the scheduler read the store each turn?"*

Everything below is either a command I ran in this worktree (`/home/chexxor/Git/Durian-Pi/item-6664`, branch `item-6664`) or a line I read. Probes are in `tools/probes/`.

## 1. The answer in one line

**Neither option is the defect.** A gate-closing write through the broker's own harness already dirties the scheduler and a pass does run; the seat then sleeps because the *wake selection predicate* suppresses it — the parked signature is `id:status` only, so a parked row whose gate became unresolvable has a byte-identical signature and is skipped. Option 2 as posed cannot be built: the pass reads the harness's **cached** document, and a write made outside that harness is invisible to it, so a store-derived tick would poll a stale view and add passes for no gain.

## 2. The trigger chain as it actually is

| What can start a pass | Where | Measured |
|---|---|---|
| A wake-relevant commit on the broker's own harness | `src/scheduler.mjs:26` (`WAKE_DOC_KINDS = durig.queue, durig.seats`), `:50-58` (submissions also count), `:113-115` (`notify`) | publication `document:durig.queue` → `isWakeRelevantCommit` true → `scheduler.dirty` true |
| A non-`read` intent in the spool inbox | `src/broker.mjs:1908-1932` | operator `pause`/`compact` route through the spool when a broker is live (`cli.mjs:1972`, `cli.mjs:1635`), so they dirty |
| A due per-seat cooldown revisit | `src/broker.mjs:1866-1869` | code path, not independently exercised |
| The forced first pass after start | `src/broker.mjs:1724` | code path |

Everything else is sleep: the idle loop waits on `signal.wait(min(delayUntilReady, 1000 ms))` (`src/broker.mjs:1941-1957`) — that tick re-checks for `.stop` and the cooldown deadline, it does **not** run a pass.

What a pass reads: `harness.snapshot(RigQueue)` (`src/broker.mjs:1368`). What decides the wake: `selectWakes` (`src/driver.mjs:91-140`).

## 3. Measurements

**Probe 1 — `tools/probes/gate-close-wake-6665.mjs` (exit 1, the gap reproduced).** A queue write through the harness dirties the scheduler. After consuming a pass, an *external* connection writes the same queue doc; the broker's observer sees nothing: `scheduler.dirty` false, `shouldRun()` false, while the pure driver still names `impl` as a wake candidate. Wakeable state, no trigger — the exact shape pm described.

**Probe 2 — `tools/probes/harness-view-freshness-6665.mjs` (exit 1).** Connection A writes row #1 `held`; connection B sets it `queued`. A's `snapshot` still reads `held` (twice); a third connection reads `queued`; and A's *next* commit does not clobber B's write (the store still reads `queued`). So the external write is neither seen nor overwritten — it is simply invisible to the running broker. This is not a 1.3.0 quirk: the vendored 1.5.1 the rig links to caches the same way — `snapshot` returns `this.#documents.get(id)` when present and only the session's own writer advances that cache (`vendor/pi-main/packages/durable/dist/session/session.js:415-427`).

**Probe 3 — `tools/probes/parked-gate-signature-6665.mjs` (exit 1, pure, no harness).** Row #101 `held`, gate `[100]`. Signature before: `101:held`. After the parent is **cancelled**: `101:held`. After the parent is **done**: `101:held`. First pass wakes `impl:parked`; the pass after the parent closes wakes nobody. `src/driver.mjs:69-75` builds `${id}:${status}`; `src/scheduler.mjs:146-152` wakes only when that string changes. The gate is not in the string.

So the chain is: cancel/complete commits → scheduler dirty → pass runs → `selectWakes` evaluates the dependent → `parkedChanged` returns false → `SKIP impl reason=parked-deduped` (`src/broker.mjs:2304-2308`). The event arrives; the predicate throws it away.

## 4. Failure modes, each with its recovery

1. **Silent — a stranded gate is invisible.** A parked row whose gate names a cancelled row never wakes, never gets repaired, and appears only as a `SKIP` line in the broker log nobody reads. 23 such rows exist in the live queue (`tools/probes/stranded-gate-census-6664.mjs`, exit 1, snapshot 2026-11-11T13:32:14Z). Recovery: put the derived gate state in the signature, and emit a named diagnostic line per stranded gate so it reaches `status`/checkup rather than the log.
2. **Cascade — cancelling a parent strands dependents with no notice.** `cancelItem` notifies only the sender and recipient of the cancelled row (`src/rig.mjs:204-240`); dependents are never told. Recovery: notify each dependent whose gate names the cancelled id, at cancel time, with the resolver named.
3. **Contradiction — two truths about the queue.** A resident broker's view and the store disagree whenever a second connection writes. Recovery: refuse second writers (already enforced for `up`, `resume`, `reset`, `send` via `refuseWhileBrokerDrives`, `cli.mjs:213`, `:665`, `:1385`, `:1541`, `:2496`) and make the refusal list explicit in the runbook; a probe that opens its own harness must be read-only (P5/#110).
4. **Loop — a heartbeat that dirties every tick.** Any "check the store each turn" design re-runs passes with nothing to do; #2237 measured ~80 passes/min from `watch` polls and the hot loop that took the broker down. Recovery: dirty only on a *changed signature*, never on a tick, and keep the global floor (`minIntervalMs` 500).
5. **Version-blind contract — the wake subscription can die at the first commit.** `src/commitstream.mjs` attaches with the 1.5.1 observer-object form. In the npm-pinned 1.3.0 (`node_modules/@earendil-works/pi-durable/dist/session/session.js:371`) `observeCommits` takes a *function* and is the session's **internal** listener channel: an object is stored as a listener, the first publish throws `listener is not a function`, and because internal listener errors call `this.fail(error)`, the whole session dies. My worktree resolves 1.3.0 while the root resolves the vendored 1.5.1 (`node_modules/@earendil-works/pi-durable` → `../../vendor/pi-main/packages/durable`); the probe hit exactly this `SessionFailed`. Recovery: feature-detect the contract at attach and fail **loudly at attach time**, naming the version, instead of dying at the first commit.
6. **Partial — the trigger fires, the decision is wrong, nothing says so.** Today a suppressed wake leaves only a `SKIP` line. Recovery: the suppression is already structured (`onSkip`, #4171); surface it in `status`/checkup as an attention row, not just a log line.

## 5. Options considered, and the trade-off I accept

- **A. Make every queue verb explicitly mark the scheduler dirty** (pm's option 1). Rejected: the trigger already exists for every write the broker can legitimately make, so this adds a second owner of the dirty bit (against D11's single-writer discipline) and still misses the parked-dedup suppression, which is where the loss actually happens.
- **B. Have the scheduler derive "queue changed" from the store each turn** (pm's option 2). Rejected on measurement: the harness's `snapshot` is session-cached, so a store-derived tick reads the stale doc; a raw storage read is a second reader (P5/#110) and the polling cadence is exactly what hot-looped the broker in #2237.
- **C. A bounded state-derived heartbeat inside the pass** — dirty only when a wake signature computed from the doc the pass *already* reads changes. Acceptable as a backstop; costs no extra read. Trade-off accepted: a few extra idempotent passes in exchange for not depending on the commit stream being the only signal.
- **D. Fix the predicate and the notice** — gate state in the parked signature, cancel-time dependent notification, a named stranded-gate diagnostic. Smallest change, closes the observed gap, reversible. **Recommended.**

Reversibility test: D touches a signature string and a notification path; both are observable in the log and revertible by one commit. A and B change who owns the trigger, which is not cheap to unwind.

## 6. Concrete fixes, with the file to touch

1. `src/driver.mjs:69-75` — `parkedSignature` becomes `${id}:${status}:${gateState}` where `gateState` is derived by the *same* helper the release path already uses (`deadGateId`, `src/rig.mjs:312`): `open` (gate still queued), `resolved` (gate terminal and satisfied), `stranded` (gate names a cancelled row). One derived state, one source, so the driver and the release refusal cannot disagree.
2. `src/rig.mjs:204-240` — `cancelItem` notifies every dependent whose `blockedBy` names the cancelled id, naming the resolver. Without this, the stranded row has no owner.
3. `src/broker.mjs` pass — emit `GATE-STRANDED item=<id> gate=<id> by=<seat>` alongside the existing `SKIP` lines, so the condition is greppable and can become a checkup rule (`src/checkup.mjs` has 23 rules today; none of WORK-ITEM-SCHEMA §8's five is implemented).
4. `src/commitstream.mjs` — assert the observer contract at attach and refuse with the version named; a wake subscription that silently dies is a dormancy with no symptom.

## 7. What this is *not*

Not a missing trigger, not a polling problem, not a scheduler bug. The scheduler coalesces and throttles correctly; the event arrives. The loss is in wake *selection* and in the absence of a home for the stranded-gate fact.

## 8. Falsifiable probes

| Probe | Exit now | Exit after the fix |
|---|---|---|
| `node tools/probes/parked-gate-signature-6665.mjs` | 1 (gate invisible in the signature, no wake) | 0 |
| `node tools/probes/gate-close-wake-6665.mjs` | 1 (wakeable work, clean scheduler after an external write) | 1 until second-writer enforcement covers probes; the assertion names the external-write case explicitly |
| `node tools/probes/harness-view-freshness-6665.mjs` | 1 (broker view stale) | stays 1 by design: the finding is the reason second writers are refused, not a bug to fix |
