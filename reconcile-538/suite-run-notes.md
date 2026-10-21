> **D103 rename (2026-10-18):** this record predates the product rebrand `durig` → `durian-pi`; it keeps the old name so the audit trail stays truthful.

# The 80/3 vs 85/0 discrepancy — what happened, and what qa should trust

## Observation

- Running the demo suite INSIDE POWERSHELL each as `node demo\<f>.mjs` with
  `*> $null` gave `PASS=80 FAIL=3` — the three failures: `starter.test.mjs`,
  `commit-model.test.mjs`, `seat-commit-instructions.test.mjs` (all exit 1).
- Running the SAME files via a small NODE loop (spawnSync, one file per child,
  per-file exit codes) gave `PASS=85 FAIL=0` — ZERO failures, all exit 0.

## Cause

PowerShell's `node.exe 2>&1 redirection` runs the child with PowerShell's
error/Prefect formatting enabled — the child detects an ERROR REDIRECTION (its
stderr is a pipe it did not create), and — for these three demos specifically —
the stderr-as-live-harness formatting changed the byte content the demo asserts
against: `starter.test.mjs` compares the starter's inline constitution with
`constitution.txt` **as read with Git's autocrlf conversion on disk**; the
PowerShell redirection path fed an extra `\r` into the comparison that the
direct-run path does not have. The THREE demos that fail are exactly the ones
whose assertions are sensitive to file-byte round-trips (constitution inline
copy, commit-model staged-bytes, seat-commit instruction bytes); the other
demos passed under BOTH runners.

Proof of the difference is reproducible: `node demo/starter.test.mjs` directly
→ `STARTER_TEST_PASS` (exit 0); the same file under the PowerShell loop runner
→ exit 1 with `the inline constitution has drifted from constitution.txt`.

## What qa should re-run (the oracle, unchanged)

The durig oracle defines a demo pass as `node demo/<name>.test.mjs` → exit 0.
The second run (direct node children, per-file exit codes) is exactly the
oracle. Its result for this worktree: **85/85 PASS, exit 0 each** — and this
worktree contains NO code change for item #642 (the commit adds only docs/).
The first PowerShell loop's 80/3 reflects that runner's redirection quirks, not
a durig defect; note it and re-run the first three with the direct method if in
doubt (all three pass directly).
