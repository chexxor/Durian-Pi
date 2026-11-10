---
review: store ownership is a process question; the routing answers it with a health question
item: #6402
seat: architect
asked_by: pm
date: 2026-11-11
tree reviewed: main (worktree item-6402)
probe: tools/probes/routing-on-liveness-vs-progress.mjs (exit 1, 6 measured failures; it previously printed FAIL lines and exited 0)
status: design position; impl builds (#6399), devtools builds (#6401)
---

# The defect: one gate, two questions

There are two different facts the read path needs, and today one predicate answers both:

- **Ownership** — is some *process* holding this store? That is answered only by the OS: `pidAlive(pid)` is dead iff the OS reports `ESRCH` (`src/broker.mjs:2340-2349`, the #3398 fail-safe: anything else, including EPERM, means alive).
- **Progress** — is the broker *advancing*? That is `brokerHealth` (`src/broker.mjs:2373-2393`): liveness leg plus `lastPassAt`.

`readData` uses the second to decide the first:

```
const state = readBrokerState(dbPath);
if (!brokerAlive(state)) return await readLocal(dbPath, fn);      // src/readclient.mjs:246
```

and `readLocal`'s write-mode guard is:

```
if (brokerAliveFor(dbPath) && liveGenerationLeases(dbPath).length > 0) throw readFailure(...)   // src/readclient.mjs:197
```

Measured, with a forged state naming the probe's own live pid and a 90-second-old heartbeat:

```
H pid 1128159: pidAlive=true brokerAliveFor=false
G live pid 1128159: route=local, exit 0 in 10520 ms
```

So a broker that is resident but wedged — the exact condition the routing exists to survive — is classified as **no owner**, and the CLI opens the store. The generation-lease test does not save it: a lease marks a *seat mid-generation inside the broker process*. The owner is the process. A wedged broker with zero live leases still owns the store, and `openNodeSqliteStorage` migrates and wraps every read in `BEGIN IMMEDIATE` (the reason `src/readonlystore.mjs` exists at all). A second owner on a live owner is the `SessionFailed` corruption class, and the fail-safe at `:2340` was written specifically to stop a false-dead report admitting a second writer.

# The fix, stated as a contract

Split the predicate into two outputs, and let each consumer use the one it needs:

```
brokerOwnership(state) -> { resident: pidAlive(state.pid),   // route decision
                            progress: brokerHealth(state).state }  // bound decision
```

- **resident, progressing** → spool, the long bound.
- **resident, not progressing** → spool with the short derived bound, then a structured **refusal**. Never a store open.
- **proven gone (`ESRCH`)** → local read, write-mode open allowed.

Inside `readLocal`, the write-mode open is gated on `!pidAlive(state.pid)` — not on heartbeat freshness and not on lease counts. The read-only open (`node:sqlite` with `readOnly: true`) stays allowed in every case: it cannot write, cannot migrate, cannot take the write lock.

`--local` is not an exception: it may take the read-only route while a pid exists; the write-mode route still requires the pid to be proven gone. An escape hatch that skips the ownership test is the hatch that corrupts.

# Failure modes, recovery, check

| failure | class | recovery | check |
|---|---|---|---|
| heartbeat-stale wedged broker read as "no owner" → write-mode open against a live process | cascade / corruption | gate on `pidAlive`; refuse instead of open | probe H (red today) |
| a degraded broker's store becomes unreadable, and `status` is the verb the operator uses to see the wedge | contradiction | the refusal carries the off-store payload: broker state, `hbAgeMs`, `passAgeMs`, spool counts, lease counts; store-derived sections labelled unavailable | probe C |
| two predicates drift — the routing and the check rule compute "alive" separately | contradiction | one predicate, two consumers; `resume`'s refusal already pins the F side | probe F |
| the derived bound computes to 0 or negative | silent | clamp: `bound = max(1000, min(DEGRADED_READ_TIMEOUT_MS, callerBound))`, and refuse rather than hang | probe B |
| the local path does not say how it got its number | silent | every route prints its route; the docstring already claims this (`src/readclient.mjs:230`) and the dead-pid path prints nothing | probe I (red today) |
| the operator retries a refused read forever | loop | the refusal names the remedy (`serve --stop`, then `--local`) and `check` reports the wedge | probe D |
| a negative assertion with no rule to test | false green | score "must not fire" assertions as failures until the rule exists | probe E |

The probe itself asserted both "the read succeeded" and "the read must refuse" at the same time — a probe that asserts the design and its opposite measures nothing. B now asserts a **verdict inside a derived bound**, which is what the design actually claims.

# Options and the trade-off

- **(a) keep the lease gate, refresh the heartbeat.** Rejected: it fixes the symptom. The gate is answering the wrong question.
- **(b) gate the direct open on process existence (`ESRCH`).** Chosen. One predicate, cheap, reversible: if it proves too strict, the read-only route is still available.
- **(c) forbid every direct open unless the broker is absent.** Rejected: a fresh rig has no broker, and the operator needs an escape hatch when the broker is gone.

The cost, said out loud: some reads that today succeed will refuse — a wedged broker's store becomes unreadable until it is stopped. Accepted, because reading a store through a second owner while it is wedged risks corrupting the thing the operator is trying to inspect, and the refusal carries the state they actually need.

# Registered separately

`docs/DECISIONS.md` has **two entries numbered D259** (lines 11417 and 11591) and D258 sits after D259. Number collisions are how an ADR becomes unreferenceable; routed to pm as a hygiene row. The decision above is written as D262 and marked provisional — the mint number is assigned at land.
