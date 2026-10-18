---
runbook: resume-while-broker-runs
symptom: "I want to run resume/doctor but the broker is up; should I stop it?"
writes: false
precondition: "read-only"
last_verified: 2026-10-18
verified_by: devtools
evidence: "#1931 (documented refusal; the broker reconciles stranded submissions at startup and every pass)"
check_rule: null
---

# `resume`/`doctor` while the broker is running: do NOT stop the broker for it

## When to use
You see stranded/idle seats and reach for `resume` (or its alias `doctor`), but a resident broker is
driving the store and the verb REFUSES:

```
resume/doctor refuses to run while a resident broker is driving <db> (pid N): … the broker settles
stranded submissions ITSELF — at startup and at the start of every pass (logged "STRANDED settled=N") —
so there is nothing for an external resume to do while it drives … See docs/runbooks/resume-while-broker-runs.md.
```

## Impact
If you do nothing: nothing is lost — the broker already performs this recovery. The mistake to avoid is
STOPPING a live broker to run `resume`: that is exactly the second-writer pattern (an external process
settling submissions while the broker owns the store) that crashed the broker and corrupted two
`pi.live` run-control documents on 2026-10-16 (ROADMAP 71 / docs/COMMANDS-AND-THE-BROKER.md §5).

## Preconditions
None — this is a read-only decision. Do not stop the broker.

## Diagnose (read-only)
```bash
DURIG_DB=./selfdev.sqlite node cli.mjs status
tail -12 selfdev.sqlite.broker.log      # look for STRANDED settled=N / RECONCILE lines
```
The broker settles a `queued`/`placed` submission whose run task is terminal at **startup**
(`reconcileBrokerStartup`) and at the **start of every pass** (`reconcileStrandedSubmissions`), logging
`STRANDED settled=N`. If a seat is stalled, first check whether the broker is merely DORMANT (a fresh
heartbeat but a stale `PASS`) — that is `broker-down-or-stalled.md` case (b), not a `resume` problem.

## Do
1. Do NOT run `serve --stop` to get a `resume` through. With the broker alive, `resume`/`doctor` is
   redundant.
2. If the broker is ALIVE but not passing, restart it (its startup pass re-settles and re-wakes):
   follow `broker-down-or-stalled.md` (case b) — terminate the wedged pid only when no `genlock` is held,
   then restart.
3. Only when NO broker is running is `resume`/`doctor` the right verb:
   ```bash
   DURIG_DB=./selfdev.sqlite node cli.mjs resume
   ```

## Verify
```bash
tail -8 selfdev.sqlite.broker.log
```
Expect `STRANDED settled=N` (or a clean pass) and the previously stalled seats generating. The durable
proof is the settled submission's terminal status, visible in `status`/`log`.

## If it fails
- The broker is down and seats are stranded → `broker-down-or-stalled.md` (run `resume`, then restart).
- A storage error killed the session → `store-corruption-recovery.md`.
- A single seat will not run → `seat-reset.md`.

## Escalate to
`devtools` for the settle path or the refusal; `pm` to sequence a change to it.

## Evidence
#1931 (2026-10-18): chose the DOCUMENTED REFUSAL over routing `resume` as a spool op, because the broker
already applies the same settle every pass — routing would be redundant work AND a second writer. The
refusal message (`cli.mjs` `refuseWhileBrokerDrives` for `resume/doctor`) names this reason and this
runbook. Decision recorded in `docs/DECISIONS.md` (D101).
