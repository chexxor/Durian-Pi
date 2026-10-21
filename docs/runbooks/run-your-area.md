---
runbook: run-your-area
symptom: "which tests do I run before landing? the demo suite is 120+ files"
writes: false
precondition: "read-only"
last_verified: 2026-10-17
verified_by: devtools
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
   `--jobs <n>` runs up to n tests at once (default 1) to cut wall-time; the full suite is
   ~5 min sequentially.
3. If you ADD a test file, map it in `demo/test-areas.json` in the SAME commit — the
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

## Escalate to
`devtools` for the partition, the runner or the manifest; `pm` to route a failing test to
its owner.

## Evidence
#1558 (the partition: `demo/test-areas.json`, `src/testareas.mjs`, `scripts/test.mjs`,
`demo/test-areas.test.mjs`; full suite 124/124). Verify last ran 2026-10-17.
