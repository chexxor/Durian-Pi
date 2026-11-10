---
review: routing-predicate-and-the-check-rule
item: #5631
seat: architect
asked_by: pm
date: 2026-11-10
tree reviewed: main @ f192f543 (read via `git show main:<path>`); probe run in worktree item-5631
status: review-before-ship — RM-329 2/3 and 3/3 are NOT on main; this is a verdict on the design
        against the code as it is, plus a correction to two of the row's premises
---

# One predicate, two consumers: what RM-329 2/3 + 3/3 actually has to change

## 0. Two premises in the row are wrong, and both matter

**"(1) `brokerProcessAlive` must be introduced ONCE."** It already exists — `src/broker.mjs:2295`,
hardened against a recycled pid, with the fail-safe documented at `:2209-2214` (#3398: dead **only** on
`ESRCH`; anything else means alive, because a false-dead report admits a second writer, which is the
corruption class). It is consumed by `tools/broker-serve.mjs` (3 call sites). So the work is not
"introduce it" — it is **stop re-deriving it**.

**The duplicate the row is hunting for is real, and it is inside the same file.** `brokerAlive`
(`src/broker.mjs:2198-2214`) runs its own `process.kill(state.pid, 0)` with its own `err?.code !== "ESRCH"`
catch — the identical logic, written twice. Two predicates that must agree, maintained separately, is
exactly how a routing decision and a check rule drift apart. **Concrete fix:** keep the heartbeat-stale
guard in `brokerAlive` (it is the anti-recycled-pid leg and belongs there), then
`return brokerProcessAlive(state.pid)`. The merge is behaviour-preserving because both branches use the
same `!== "ESRCH"` rule — and that is provable: a demo enumerating `ESRCH`, `EPERM`, and an unseen code
must give the same verdict from both functions before and after.

**"(5) ... a stale state does NOT route a read through `readViaBroker`."** That half is already true,
and my probe shows it (case A: dead pid + fresh heartbeat → read answered in **373 ms** via `readLocal`).
What is missing is the **degraded** leg, and it is the expensive one.

## 1. The seam, as it stands

```
 readData (src/readclient.mjs:109)
   ├─ brokerAliveFor(dbPath)  ──▶ brokerAlive (broker.mjs:2198): heartbeat age + signal 0   [LIVENESS ONLY]
   │      true  ─▶ readViaBroker(..., { timeoutMs = 120_000 })   (:35 — the literal #5542 is about)
   │      false ─▶ readLocal
   └─ brokerHealth (broker.mjs:2239): LIVENESS + PROGRESS ─▶ printed by `status`, never ROUTED ON
```

`brokerHealth` already returns `up | degraded | down` with `progressTimeoutMs = streamTimeout +
BROKER_PROGRESS_MARGIN_MS` (`:2236`, `DEFAULT_PASS_TIMEOUT_MS = 300_000`, margin `60_000`). The classifier
exists. **No consumer routes on it.** That is the whole 2/3 leg: one line of routing plus a derived bound.

## 2. Measured, in an item worktree on main

`node tools/probes/routing-on-liveness-vs-progress.mjs` → **exit 0, 4 FAIL / 3 PASS**:

```
  PASS  A a read with a DEAD pid answered fast (exit 0, 373 ms) — routing did not go to the dead spool
  B live pid, heartbeat fresh, lastPassAt 6 h old -> exit ETIMEDOUT after 40050 ms; spool 0 -> 1
  FAIL  B a broker with a FROZEN lastPassAt still answered the read (it did not: exit ETIMEDOUT)
  FAIL  B the read resolved inside a DERIVED bound (<=30 s); it took 40050 ms
  C status under the same live-but-frozen state -> exit ETIMEDOUT after 40050 ms
  FAIL  C the operator's diagnostic verb answers while the broker is degraded
  FAIL  D `cli.mjs check` reports a finding for a broker state naming a DEAD pid (no such rule exists)
  PASS  E a live pid does not trigger the pid-not-running finding (vacuous while the rule does not exist)
  F predicate before resume: pid=... brokerAlive=true health=degraded
  PASS  F `resume` still refuses while the pid is alive — "resume/doctor refuses to run while a resident
        broker is driving ... a second ..."
```

Shape (b) reproduced deterministically on a 4-seat starter rig: a **live** pid, a **fresh** heartbeat, a
**frozen** `lastPassAt`. The read is routed to the spool (inbox goes 0 → 1), nothing drains it, and the
caller waits out the 120 s literal. `grep -rln "broker-state-pid-not-running" src demo docs` matches only
the spec file — the 3/3 rule is unimplemented, so criterion (5)'s negative half (E) is **vacuous** and
must not be reported as a pass.

**The trap the probe had to dodge, and every demo must:** the first run of this probe forged the state
file once, and by the third verb the forged heartbeat was older than the 60 s liveness gate
(`BROKER_HEARTBEAT_TIMEOUT_MS`, `src/broker.mjs:2195`), so `brokerAlive` read the state as dead and
`resume` **ran** — a false green. I re-measured with the heartbeat refreshed before each verb: F now
PASSes. `docs/runbooks/broker-down-or-stalled.md` #5829 already records this exact false negative; the
demo that ships with 2/3/3/3 must refresh the heartbeat per assertion or it will pass for the wrong
reason.

## 3. The failure mode the spec does not enumerate

**Contradiction → cascade.** If `degraded` refuses reads, then `cli.mjs status` — the verb the operator
uses to *see* the wedge — is itself refused. Measured: C, 40 s, ETIMEDOUT. A control surface that is
blinded by the condition it is supposed to reveal is worse than no control surface, because the operator
then reaches for the one thing that works: killing the broker, which is how a wedge becomes a restart
race. **Recovery:** the refusal must be *inside* the response, not a hard error — `status` answers within
the derived bound with `broker: {state:"degraded", reason, passAgeMs, progressTimeoutMs}` already present
and the store-derived sections marked `"queue": null, "queueUnavailable": "broker-degraded-no-progress"`.
The file-based legs (`readBrokerState`, `brokerHealth`, the census in #6294) never touch the store, so
they survive the wedge by construction.

**Loop.** If degraded never clears, every verb refuses forever. Recovery: the refusal names the remedy
in the same structure (`serve --stop`, or the census finding), and the check rule makes it visible in
`status` and notices. Fast refusal is what makes a permanent refusal survivable.

**Silent.** A cause that arrives after the caller left. Recovery: the bound is derived, so the cause
arrives in 10-30 s, and the demo asserts the refusal lands *inside* the bound (row criterion 2 — correct
and the most important one).

**Cascade via false-dead.** Routing on signal 0 alone (`brokerProcessAlive` without the heartbeat leg)
classifies a recycled pid as the broker, or a draining broker as dead, and either admits a second writer.
Recovery: routing must use `brokerAlive` (heartbeat AND pid), never `brokerProcessAlive` alone. The row's
"down → readLocal only with the pid proven gone" is right, but "proven gone" means the *conjunction*
(fresh-enough heartbeat plus `ESRCH`), not the pid probe.

**Contradiction between rules.** If the 3/3 check rule re-derives liveness instead of calling
`brokerAlive`, `check` and routing disagree about the same rig — a seat sees "up" in one place and
"down" in another. Recovery: the rule imports the predicate; the demo asserts both surfaces report the
same verdict for the same state file.

**Partial.** A refusal that opens the store to check it, or writes to the spool to ask politely. My probe
measured the spool going 0 → 1 on the refused path — i.e. today the routed read *does* write an intent
that nobody drains. The fix must assert: refused reads touch neither spool nor store.

## 4. Options, and the trade-off I accept

- **(a) Route on `brokerHealth`, three-way** — one predicate, one verdict, refusal with a structured
  code (`broker-degraded-no-progress`, `err.code` + `err.db` per the `NO_STORE_CAUSE` precedent at
  `src/readclient.mjs:74-79`). Cost: `status` must be re-designed so the diagnostic survives the refusal.
  **Accepted**, because the alternative is a 120 s wait that produces no cause.
- **(b) Keep liveness routing, just lower the bound to 10-30 s.** Cheap, one literal. Cost: the caller
  still gets a timeout, not a named cause, and the spool still accumulates undrained intents (#6294's
  census measures 9 of them on this rig right now). Rejected as a sole fix; kept as a *fallback floor* if
  (a) slips.
- **(c) On degraded, fall back to `readLocal`.** Rejected outright: it opens a second writer against a
  broker that is *alive* — `SqliteStorage.document()` takes `BEGIN IMMEDIATE` even for a read. The ruling
  in the row ("unavailable-and-LOUD by design") is correct and I am not going to soften it.

## 5. Concrete fix, per file

1. `src/broker.mjs:2198` — `brokerAlive` keeps the heartbeat-stale guard, then `return brokerProcessAlive(state.pid)`. Demo: `ESRCH`/`EPERM`/unknown code give identical verdicts before and after.
2. `src/readclient.mjs:109-111` — `readData` computes `brokerHealth(readBrokerState(dbPath), { streamTimeoutMs })` once and routes: `up` → `readViaBroker`; `degraded` → structured refusal (code `broker-degraded-no-progress`, `err.db`, ages in the message), **no spool write, no store open**; `down` → `readLocal`.
3. `src/readclient.mjs:35` — replace `timeoutMs = 120_000` with a derived bound: `Math.min(progressTimeoutMs, callerBound)`, default 10-30 s, and the number is *named in the demo* (row criterion 2).
4. A `broker-state-pid-not-running` check rule in `src/checkup.mjs` reading `<db>.broker.json` off-store (the `sharedTreeBranch`/`citations` pattern), which must survive an unreadable store and must call the same predicate, not re-derive it. Pair it with the spool census in #6294 as one family of broker-state rules, not two ad hoc ones.
5. Demo asserts the negative half: with a **live** pid the finding is absent and `resume` still refuses — measured PASS today, so the change must not break it.

## 6. Evidence

- `node tools/probes/routing-on-liveness-vs-progress.mjs` → exit 0; the 7 lines quoted above; scratch
  dirs created in the seat root and removed.
- `node --check tools/probes/routing-on-liveness-vs-progress.mjs` → exit 0.
- `node demo/runbook-frontmatter.test.mjs` and `node demo/runbook-rules.test.mjs` → exit 0 (the runbook
  I amended in #5630 still parses).
- Code read from main @ f192f543: `src/broker.mjs:2195, 2198-2214, 2236, 2239-2262, 2295, 2306`;
  `src/readclient.mjs:22, 35, 74-79, 109-111`; `cli.mjs:199-208` (`refuseWhileBrokerDrives`).
- Caveat: this worktree's `sync-pi --link` step failed, so it resolves `@earendil-works/pi-durable 1.3.0`
  from the lockfile while the seat root resolves 1.5.1. The measurements here are about the state file,
  the routing predicate and the spool — not pi-durable internals — but any suite comparison must name
  the tree.
