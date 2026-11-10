---
runbook: run-your-area
symptom: "which tests do I run before landing? the demo suite is 238 files"
writes: false
precondition: "read-only"
last_verified: 2026-10-28
verified_by: delegate
evidence: "#1558 (test-area partition); re-ran Diagnose/Do/Verify on 2026-10-28 on Linux: `--list` 238 tests / manifest covers all, `--area docs` 5 tests in 0.1 s, `--all` 238/238, and the new diff-derived path `tools/what-to-test.mjs --run` over a docs-only change: 15 derived guards in 11.8 s (5 direct guards in 5.3 s) against 41.8 s for the full suite"
check_rule: "demo/test-areas.test.mjs (the partition cannot silently rot)"
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
0. **Changed only docs? Derive the guards from the diff instead of running everything:**
   ```bash
   node tools/what-to-test.mjs            # classify the working tree: which tests NAME what you changed
   node tools/what-to-test.mjs --run      # run exactly that set (direct guards first)
   node tools/what-to-test.mjs --direct-only   # the sub-5-second "did I break the pointer / a runbook?" check
   ```
   Measured 2026-10-28 (Linux, this box): a docs-only edit derives **15 tests in 11.8 s** (5 direct in 5.3 s)
   against **41.8 s for all 238**. Two things this buys that a remembered area name does not: (a) it is derived
   from the demo sources — a test is selected when it contains the changed path, its directory, or its file name —
   so it cannot rot the way a hand-curated map rots; and (b) **`--area docs` is not the doc guard set**: it is 5
   tests, and the derived set also includes `demo/runbook-frontmatter.test.mjs` (area `check`),
   `demo/feature-row.test.mjs` / `demo/features-drift.test.mjs` (area `rig`), `demo/clockin-digest.test.mjs`
   (area `toolchain`) and more. Running `--area docs` alone is how a doc edit lands with a guard unexercised.
   The tool also scans changed text files for control bytes, zero-width characters and mojibake — invisible in
   review, fatal in a repro command (`docs/SELFDEV.md`, 2026-10-28).
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
node tools/what-to-test.mjs --paths=docs/NEXT.md --direct-only   # exit 0; names demo/next-pointer.test.mjs as a direct guard
```

## If it fails
- `unknown area "x"` → run `--list`; area names are the keys of `demo/test-areas.json`.
- `what-to-test.mjs` says **not doc-only** → a non-doc path is in the diff (including someone else's uncommitted
  file in a shared root); the gate is the full suite. It prints every changed path with its git status, so you can
  see whose change it is.
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

## When a red measures the machine rather than the behaviour (added 2026-11-10, #6057)

Two shapes measured in a live working tree. Both print as a behaviour red and neither is one.

1. **The demo inherits the operator's config file.** `cli.mjs` discovers a rig config from
   `$DURIG_CONFIG`, then `./durig.config.json`, then `./.durig/config.json` (`src/config.mjs:1-8`), so a
   demo that spawns the CLI with `...process.env` and a cwd inside the checkout reads whatever the
   operator declared. Measured 2026-11-10 at main tip 09a94b4c: `demo/provenance.test.mjs` asserted
   "nothing declared" and got `['durig.router','extensions/continuity.mjs']` straight out of the tree's
   own `durig.config.json`.
   Do: point the spawn at a config file the DEMO wrote - `DURIG_CONFIG: <tmp>/empty-config.json`. An
   empty file still EXISTS, so discovery stops there. Pin both directions: the empty file yields the
   built-in set, a file the demo wrote is read, and env beats the file. An assertion satisfiable only by
   "nothing declared" is vacuous until you also show the declared case arriving.
2. **The demo hashes a store another owner is writing.** A byte-identity check on a SQLite file taken
   before and after a read is a claim about the read only if no other owner is attached: a resident
   broker's pass commits between the two hashes, and a WAL checkpoint moves the main file.
   Do: gate the check on `brokerAliveFor(db)` (`src/readclient.mjs:22`), print a named
   `SKIP (MOVING SUBJECT - not a behaviour red) ... broker pid <n>`, and still run the read for its real-pages
   value. Prove the check is sensitive in a store the demo owns: a write moves the bytes, a read does not.

Verify (both run 2026-11-10 in the item worktree, exit 0):
- `node demo/provenance.test.mjs` with a `durig.config.json` declaring `DURIG_EXTENSIONS` present in the tree.
- `node cli.mjs serve --max-duration 45 &` on a scratch store, then `DURIG_DB=<that store> node demo/seat-turn-shape.test.mjs` -> the MOVING SUBJECT line, and after the serve window closes, `ok REAL STORE ... bytes unchanged`.

Do not fix a red of this class by loosening the assertion. The fix is to make the subject something the
demo owns, and to keep the assertion capable of failing.

## Evidence
#1558 (the partition: `demo/test-areas.json`, `src/testareas.mjs`, `scripts/test.mjs`,
`demo/test-areas.test.mjs`; full suite 124/124). Concurrency made the default on 2026-10-27:
238/238 in 41.6s at jobs=8, measured against 276.8s serially (`demo/test-runner-concurrency.test.mjs`
pins the default, the serial fallback, and the timeout bound). The diff-derived fast path (`tools/what-to-test.mjs`)
and the measurements above are from 2026-10-28, prompted by the operator burning three full suites on pointer
formatting — the fast path existed and was still missed, because an area name is not the same fact as "which
guards does MY change carry".
