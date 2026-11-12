---
runbook: process-leak-reap
symptom: "RAM climbs while nothing is running; the suite is slow or a demo times out; the model server has no headroom; ps shows node processes with 0 CPU time"
writes: false
precondition: "read-only"          # the scan reads /proc only; it opens no store and runs no git
last_verified: 2026-11-12          # the Verify step below ran on 2026-11-12 (delegate session N38)
verified_by: delegate
evidence: "tools/process-leak-scan.mjs (commit 99e74c7e), demo/process-leak-guard.test.mjs; SELFDEV pitfalls 268, 290-292; measured 30 orphans / 2.42 GB, then 5 orphans / 310 MB after a 38-minute recurrence"
check_rule: null                   # OPEN: `cli.mjs check` has no rule for this yet — a tool no reader drifts silently
---

# Reap orphaned test-runner processes

## When to use
A suite run was killed or timed out, and afterwards the machine is slow: `free -m` shows little
available RAM, a demo that runs in 0.3 s takes 120 s, the verifier model server cannot load, or
`ps` shows dozens of `node` processes with `0:00:00` CPU time. This is the 2026-11-11 pitfall (#268)
in its measured form: a killed parent takes no children with it, so the children are reparented to the
systemd user session and nobody is watching them.

## Impact
On the host below (Linux, Fedora Linux 45, kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0)
30 reparented runners held **2.42 GB RSS** on a 96 GB box with **10.0 GB available**. That is enough to
make a suite, a preflight, or a model-server load false-red — and the red is then blamed on a branch or
a seat.

## Preconditions
None. The scan reads `/proc`; it opens no store, so it answers even when the broker is wedged. **Never**
kill by hand a pid you have not classified: the fleet's write leg (`cli.mjs serve`) and a supervised
suite child both look like node processes.

## Diagnose (read-only)
```bash
node tools/process-leak-scan.mjs            # 0.04-0.54 s on the host above
node tools/process-leak-scan.mjs --json     # machine-readable tail
pgrep -cf fake-broker                        # generation 2: fixture brokers whose demo is gone
```
The tool prints every suspect with age, RSS and a **verdict**: `ORPHAN`, or `KEPT: <reason>` — it never
silently skips. A pid is a candidate only if its cmdline matches the pattern, **no live ancestor** is a
shell/node/`timeout`, it is older than `--min-age` (default 120 s), it is not the broker named by
`<db>.broker.json`, and it is not this tool's own chain.

## Do
1. `node tools/process-leak-scan.mjs --kill` — SIGTERM (never SIGKILL) the confirmed orphans, wait a
   bounded 10 s, and report survivors. A survivor that ignores SIGTERM is a defect to name, not a
   process to destroy.
2. Re-scan: `node tools/process-leak-scan.mjs` must print `clean — no reparented test runner older than
   the min age`.
3. `[judgement]` If the orphans keep reappearing, the leak is in a demo's teardown, not in this tool.
   Find it by name: `grep -n "spawn(" demo/<the demo the orphans ran>.test.mjs` — the pattern is a child
   spawned with `spawn` and only an `exit` listener, with nothing killing it on teardown
   (`demo/local-slot-gate.test.mjs:103` is the documented case, pitfall 268).
4. `/tmp` residue is separate: `df -h /tmp` and `ls /tmp | grep -c durig` (measured 13,368 directories,
   6.5 GB). Fixture dirs are removed by the demo; they accumulate only when a run is killed mid-flight.

## Verify
```bash
node tools/process-leak-scan.mjs --strict; echo "exit=$?"   # 0 = clean, 1 = orphans present
node demo/process-leak-guard.test.mjs                       # 0.06 s, exit 0, "all pins hold"
```
Measured 2026-11-12: after `--kill`, `SIGTERM sent to 5 (failed 0); 0 still alive after 10 s`, and
`pgrep -cf fake-broker` returned `0`.

## If it fails
- `unsupported platform` / exit 2: there is no `/proc` (Windows). Classify by parent PID with
  `Get-Process` and name the OS in the report — seat tool names and process-death semantics differ by OS.
- A survivor after 10 s: do not SIGKILL. Read its cmdline, check whether it is the broker or a seat, and
  escalate — `cli.mjs status` shows the live generation set.
- If the scan reports an orphan that is actually a seat's verifier, the age threshold is too low for that
  rig: raise `--min-age`, do not widen the pattern.

## Escalate to
`lead` for the teardown defect itself (the demo that leaks), `operator` for the grant to land the fix.

## Evidence
- Measured 2026-11-12T12:3xZ: 30 orphans, 2.42 GB RSS, oldest 3 h 18 m, all `demo/broker.test.mjs`, 0 CPU
  time; `--kill` stopped all 30; available RAM 10,068 → 11,026 MB.
- Measured 2026-11-12T13:4xZ: 5 orphans, 310.56 MB (2 runners + 3 `fake-broker.mjs` fixture brokers, oldest
  39,391 s), 0 survivors after SIGTERM.
