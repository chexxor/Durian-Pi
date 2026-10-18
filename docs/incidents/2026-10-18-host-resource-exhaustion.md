---
incident: host-resource-exhaustion
date: 2026-10-18
severity: sev2
status: mitigated
symptom: "`node cli.mjs status`/`queue` dies with `FATAL ERROR: Zone Allocation failed`; the demo suite is flaky"
runbook: null
fix: null
prevention: "#2126 (suite robustness under low memory) + lead #2122 ruling"
last_reviewed: 2026-10-18
---

# Node processes cannot allocate past ~25-100 MB on a host with gigabytes free, breaking read commands and the demo suite

*Incident 2026-10-18; detected by the delegate running the checks; analysis by the delegate.*

## Summary
While verifying the broker fix, `node cli.mjs status` (and `queue`, `config`, `ps`) began dying with
`FATAL ERROR: Zone Allocation failed - process out of memory` after ~0.7 s at a **25-100 MB heap**;
`prettier --check` and `node cli.mjs format --check` died the same way; `bash` intermittently could not
fork (`fork: Resource temporarily unavailable`, `cygheap read copy failed … Win32 error 299`). The host
reported **5.68 GB free of 34.28 GB**, and a bare 150 MB `Buffer.alloc` failed. The rig itself stayed up
(the broker kept passing) — the blast radius is the **read/inspection surface and the test oracle**, not
the store. Root cause is **UNVERIFIED**: free physical RAM is not the constraint, so the mechanism is a
per-process/OS commit-charge, job-object, or handle limit rather than simple memory shortage.

## Timeline
- `17:1xZ` `node cli.mjs status` → `FATAL ERROR: Zone Allocation failed - process out of memory` (GC logs
  show a ~25 MB heap); repeated for `queue`, `config`, `ps`.
- `17:1xZ` `node -e "Buffer.alloc(150*1024*1024,1)"` → `RangeError: Failed to allocate memory`.
- `17:1xZ` `node -e "os.freemem()"` → **5.68 GB free / 34.28 GB total** (physical memory is NOT exhausted).
- `17:1xZ` shell forks fail: `fork: Resource temporarily unavailable`, `cygheap read copy failed, …
  Win32 error 299`, `fatal: Out of memory, calloc failed`.
- `17:4xZ` `node cli.mjs format --check src/broker.mjs …` → same `Zone Allocation failed` (exit 134).
- Full `demo/*.test.mjs` loop: **143 total, 139 pass, 4 fail**; the 4 (`land-helper`, `livestream`,
  `mergeguard`, `readboundary-corrupt-live`) each pass **standalone**, i.e. dense-loop flakiness.

## Impact
The delegate/operator could not read the rig or run the oracle reliably for ~30 min: read verbs failed
outright and the suite produced false negatives that had to be re-run in isolation. No store risk and no
broker impact (the broker, a separate long-lived process, kept advancing). `prettier`/`format` gates were
un-runnable.

## Root cause
**UNVERIFIED.** Evidence is inconsistent with physical-RAM exhaustion (5.68 GB free) and consistent with a
per-process or OS-wide **commit-charge / job-object memory cap** or handle exhaustion: allocations fail at
a few tens of MB, `Buffer.alloc(150 MB)` fails, and forks fail with `Win32 error 299` /
`calloc failed`. Candidate classes: a Windows Job Object memory limit on the tool's child processes; the
commit limit (RAM + pagefile) being saturated by many node/PowerShell processes; or a leaked-handle
condition from the session's many short-lived `node` launches. Not isolated.

## Detection
Human/tooling only — the failures surfaced as raw `Zone Allocation failed` stack traces and a non-zero
exit, not as a `status` attention. Lead ruled on the suite half (`#2122`: the failures are ENVIRONMENTAL
— they pass in isolation) and a robustness backlog item was registered (`#2126`). There is no `check`
rule that detects "host cannot allocate".

## Resolution
No durable fix. Recovery was opportunistic: runs succeed once memory pressure clears (retry the command
or the single demo in isolation). The delegate's read verbs were worked around by retrying and by reading
the broker log/store files directly.

## Prevention
- `#2126` (impl, backlog — HOLD): make the suite ROBUST under low commit — an explicit ENVIRONMENTAL
  failure instead of an opaque abort code, so a dense-loop failure is not mistaken for a code regression.
- Lead ruling `#2122` records the diagnosis protocol (re-run in isolation before treating a loop failure
  as real). A `check`/attention kind for "host allocation failing" would be the durable detection, but is
  not yet designed.

## Evidence
- `node -e "const os=require('os');console.log(os.freemem(),os.totalmem())"` → `5.68e9 / 34.28e9` bytes.
- `node -e "Buffer.alloc(150*1024*1024,1)"` → `RangeError: Failed to allocate memory` at
  `node:internal/buffer:1104`.
- `DURIG_DB=./selfdev.sqlite node cli.mjs status` → `FATAL ERROR: Zone Allocation failed - process out of
  memory`; `.spike/serve.err`-independent, exit 134.
- `node node_modules/prettier/bin/prettier.cjs --check …` → the same FATAL at a ~100 MB heap.
- Shell: `/usr/bin/bash: fork: retry: Resource temporarily unavailable`; `cygheap read copy failed …
  Win32 error 299`; `fatal: Out of memory, calloc failed`.
- Full loop with one retry per failure: `TOTAL=143 PASS=139 FAIL=4`; each of the 4 exits 0 when run
  alone.
- Lead `#2122` ruling + `#2126` registration (queue).

## Links
`docs/runbooks/broker-down-or-stalled.md` (the run the failure interrupted) ·
`docs/incidents/2026-10-18-broker-dormant-stalled.md` · queue `#2122`, `#2126`
