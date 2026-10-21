---
runbook: daemon-not-running
symptom: "the broker is down and nothing restarts it (crash, reboot, or logout)"
writes: true
precondition: "none"
last_verified: unverified
verified_by: delegate
evidence: "ROADMAP 61-64 (design docs/BROKER-SUPERVISION.md)"
check_rule: null
---

# Daemon / host not running

**Pre-written.** The host daemon (ROADMAP items 61–64) is not built yet. This file records the procedure
it will expose so the surface is agreed before the code lands (`docs/BROKER-SUPERVISION.md` §11). Until
then the manual fallback is `broker-down-or-stalled.md`.

## When to use
The durable promise is that the broker survives a crash, a reboot, or a logout — and it does not,
because no supervisor restarts it. Symptom: the queue stops moving and no `cli.mjs serve` process exists.

## Impact
A dead broker stays dead; queued work and spooled intent wait indefinitely. Observed 2026-10-16: a
broker that died on a storage error stalled `impl` until a human restarted it.

## Preconditions
Once the daemon exists: none. A restart is the daemon's job and is idempotent.

## Diagnose (read-only)
```bash
DURIAN_PI_DB=./selfdev.sqlite node cli.mjs status
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.Name -eq 'node.exe' -and \$_.CommandLine -match 'cli.mjs serve' } | Select-Object ProcessId"
cat selfdev.sqlite.broker.down 2>/dev/null   # durable down marker (item 61) — present means an intended stop
```

## Do
The intended surface (items 61–64; `--user` is the default mode, `--system` opt-in):
```bash
durian-pi daemon status
durian-pi daemon restart
durian-pi daemon logs
```
A durable `<db>.broker.down` marker means an **intended** stop — clear it via `durian-pi up` / the daemon,
do not fight it.

## Verify
`durian-pi daemon status` reports `up pid=<n> pass=<n> hb_age=<ms>`; `status` shows seats waking.

## If it fails
Fall back to `broker-down-or-stalled.md` (manual start), and record why the daemon did not restart.

## Escalate to
operator — installing or granting the OS trigger.

## Evidence
Design: `docs/BROKER-SUPERVISION.md` §2/§3/§11. **Unverified** — the daemon does not exist yet.
