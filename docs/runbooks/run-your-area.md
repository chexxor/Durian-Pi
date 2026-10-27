---
runbook: run-your-area
symptom: "which tests do I run before landing? the demo suite is 120+ files"
writes: false
precondition: "read-only"
last_verified: 2026-10-27
verified_by: delegate
evidence: "#1558 (test-area partition: demo/test-areas.json + src/testareas.mjs + scripts/test.mjs + demo/test-areas.test.mjs)"
check_rule: null
---

# Run your functional area — and the full gate before you land

## When to use
You are about to land a change and want the cheap check for YOUR functional area; or you
are QA and need the whole suite. The demo suite is one flat directory (`demo/*.test.mjs`)
of 120+ files, and running all of it is slow.

## Impact
Doing nothing: a change lands on a subset that never exercised the code it touched, and a
new test file rots the partition silently. The partition is only a convenience — **the
FULL suite is the pre-landing / QA gate; an area subset is NEVER sufficient evidence to
land.**

## Preconditions
None on the live store: each test builds its own temp store, so the suite is safe to run
while the broker is live. Run it from the repo root (the runner locates `demo/` relative
to itself).

## Diagnose (read-only)
```bash
node scripts/test.mjs --list
```
Prints each area and its test count, then `<n> tests on disk; manifest covers all of them`.
A `manifest ROTATED` line names the offending files: a new test not mapped, a mapped file
that no longer exists, or a file listed in two areas.

## Do
1. Run your area (pick the one your change touches):
   ```bash
   node scripts/test.mjs --area <broker|check|docs|guard|readapi|rig|toolchain|tui|worktree>
   ```
2. Before you land, run the FULL gate and report its summary as evidence:
   ```bash
   node scripts/test.mjs --all
   ```
   **It runs 8 at once by default and does not need a flag.** Measured on this box 2026-10-27 (238 tests):
   **276.8s serially vs 41.6s at the default 8, and 25.8s at `--jobs 16`** — the demos mostly WAIT on broker
   heartbeats and wake paths, so they overlap for free. The default is capped at 8 rather than every core
   because this machine also serves models and runs live seats: at 16 the suite is ~15s faster and becomes a
   load generator against the rig it is testing, which is how a timing-sensitive suite starts flaking exactly
   when it matters. Raise it with `--jobs 16` only when nothing else is running.
3. A hung test is bounded by `--timeout <ms>` (default 120000) and reported as `TIMEOUT`, never awaited. Slowest
   demo here is ~17s, so the bound is ~7x headroom; if you hit it, that is a real hang, not a slow machine.
4. If you ADD a test file, map it in `demo/test-areas.json` in the SAME commit — the
   coverage rule (`demo/test-areas.test.mjs`) fails the full gate otherwise.

## Verify
```bash
node scripts/test.mjs --list           # exit 0; "manifest covers all of them"
node scripts/test.mjs --area toolchain # exit 0 (the tooling's own area)
```

## If it fails
- `unknown area "x"` → run `--list`; area names are the keys of `demo/test-areas.json`.
- `manifest ROTATED: "demo/x.test.mjs" is on disk but not mapped` → add the file to an
  area in `demo/test-areas.json`.
- A test fails → read the tail the runner prints to stderr; the test file's own header
  says what it proves. Re-run it alone with `node demo/<name>.test.mjs`.
- `TIMEOUT <file>` → the demo never exited; the runner killed its whole process tree (on POSIX; on Windows only
  the direct child, so a broker it spawned may survive — check `ps` before re-running). A suite that never
  returns is worse than one that fails, which is why the bound exists.

## Escalate to
`devtools` for the partition, the runner or the manifest; `pm` to route a failing test to
its owner.

## Evidence
#1558 (the partition: `demo/test-areas.json`, `src/testareas.mjs`, `scripts/test.mjs`,
`demo/test-areas.test.mjs`; full suite 124/124). Concurrency made the default on 2026-10-27:
238/238 in 41.6s at jobs=8, measured against 276.8s serially (`demo/test-runner-concurrency.test.mjs`
pins the default, the serial fallback, and the timeout bound). Verify last ran 2026-10-27.
